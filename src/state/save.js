/* ==========================================================================
   state/save.js — localStorage persistence, forward migrations, export/import.

   iOS can evict web storage for infrequently-used sites, so (architecture §8):
     - write on every meaningful mutation, DEBOUNCED (~800ms)
     - write again on `visibilitychange` -> hidden and on `pagehide`
       (never rely on `beforeunload` on iOS — it is not fired reliably)
     - ask for navigator.storage.persist() after the first real interaction
     - ship export/import as a base64 string so a months-old bond can be
       rescued off this host
     - version every save and migrate FORWARD. Never break an old save.
   ========================================================================== */
import BALANCE from './balance.js';
import { SCHEMA_VERSION, newState } from './game.js';

const KEY = BALANCE.save.key;

/* ---- migrations -------------------------------------------------------
   Add an entry per version bump. `migrate` runs them in order until the
   save reaches SCHEMA_VERSION. A missing key must always be filled in here
   rather than defended against at every read site.
   --------------------------------------------------------------------- */
export const MIGRATIONS = {
  /* example for stage 2+:
  2: (s) => { s.inventory.care.brush = s.inventory.care.brush ?? 0; s.v = 2; return s; },
  */
};

export function migrate(raw) {
  let s = raw;
  let guard = 0;
  while ((s.v || 0) < SCHEMA_VERSION && guard++ < 50) {
    const next = (s.v || 0) + 1;
    const fn = MIGRATIONS[next];
    if (!fn) { s.v = next; continue; }   // no-op bump
    s = fn(s);
    if (s.v !== next) s.v = next;
  }
  return fillDefaults(s);
}

/** Fills anything a hand-edited or partial save is missing. */
function fillDefaults(s) {
  const base = newState(s.createdAt || Date.now());
  const out = { ...base, ...s };
  out.player = { ...base.player, ...(s.player || {}) };
  out.inventory = { ...base.inventory, ...(s.inventory || {}) };
  out.unlocks = { ...base.unlocks, ...(s.unlocks || {}) };
  out.contests = { ...base.contests, ...(s.contests || {}) };
  out.walks = { ...base.walks, ...(s.walks || {}) };
  out.flags = { ...base.flags, ...(s.flags || {}) };
  out.settings = { ...base.settings, ...(s.settings || {}) };
  if (!Array.isArray(out.dogs) || !out.dogs.length) { out.dogs = base.dogs; out.activeDogId = base.activeDogId; }
  for (const d of out.dogs) {
    d.needs = { ...base.dogs[0].needs, ...(d.needs || {}) };
    d.aptitude = { ...base.dogs[0].aptitude, ...(d.aptitude || {}) };
    d.wear = { ...base.dogs[0].wear, ...(d.wear || {}) };
    d.tricks = d.tricks || {};
    d.log = Array.isArray(d.log) ? d.log : [];
    if (typeof d.affection !== 'number') d.affection = base.dogs[0].affection;
    if (typeof d.affectionFloor !== 'number') d.affectionFloor = base.dogs[0].affectionFloor;
    if (typeof d.trust !== 'number') d.trust = 0;
    /* the ratchet is an invariant of the data, not just of the mutator */
    if (d.affection < d.affectionFloor) d.affection = d.affectionFloor;
  }
  if (!out.dogs.some((d) => d.id === out.activeDogId)) out.activeDogId = out.dogs[0].id;
  out.v = SCHEMA_VERSION;
  return out;
}

/* ---- read / write ----------------------------------------------------- */
export function load() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch (e) { return null; }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return migrate(parsed);
  } catch (e) {
    console.warn('save: corrupt, starting fresh', e);
    return null;
  }
}

export function writeNow(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.warn('save: write failed', e);
    return false;
  }
}

export function clear() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}

/* ---- debounced writer ------------------------------------------------- */
export function createSaver(getState) {
  let timer = 0;
  let dirty = false;
  let writes = 0;

  function flush() {
    if (timer) { clearTimeout(timer); timer = 0; }
    if (!dirty) return false;
    dirty = false;
    writes++;
    return writeNow(getState());
  }

  function schedule() {
    dirty = true;
    if (timer) return;
    timer = setTimeout(() => { timer = 0; flush(); }, BALANCE.save.debounceMs);
  }

  function onHide() { if (document.visibilityState === 'hidden') flush(); }
  function onPageHide() { flush(); }

  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onPageHide);
  /* belt and braces on desktop; iOS may never fire this */
  window.addEventListener('beforeunload', onPageHide);

  return {
    schedule, flush,
    get writes() { return writes; },
    get pending() { return dirty; },
    destroy() {
      flush();
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onPageHide);
    },
  };
}

/* ---- persistence request ---------------------------------------------
   ASSUME THIS DOES NOTHING ON iOS. `navigator.storage.persist()` is largely a
   Chromium/Gecko affordance; on iOS Safari it is not a real mitigation (see
   docs/PLATFORM-RISKS.md risk 1). A `false` return is the NORMAL case, not an
   error — never log it as one and never gate behaviour on it.

   What actually protects the save on iOS: being installed to the Home Screen
   (ITP exempts installed web apps) plus the export/import code below.
   --------------------------------------------------------------------- */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (navigator.storage.persisted && await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();   // false on iOS: expected
    }
  } catch (e) { /* not supported; nothing depends on this */ }
  return false;
}

/** Installed to the Home Screen? The only thing ITP actually exempts. */
export function isStandalone() {
  try {
    if (navigator.standalone) return true;
    return window.matchMedia('(display-mode: standalone)').matches
      || window.matchMedia('(display-mode: fullscreen)').matches
      || window.matchMedia('(display-mode: minimal-ui)').matches;
  } catch (e) { return false; }
}

/* ---- export / import (base64 JSON, UTF-8 safe) ----------------------- */
export function exportSave(state) {
  const json = JSON.stringify(state);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return 'PP1' + btoa(bin);
}

export function importSave(str) {
  if (typeof str !== 'string') throw new Error('not a save string');
  let s = str.trim().replace(/\s+/g, '');
  if (s.startsWith('PP1')) s = s.slice(3);
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const json = new TextDecoder().decode(bytes);
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.dogs)) {
    throw new Error('save string is not a Pocket Puppies save');
  }
  return migrate(parsed);
}

export default {
  load, writeNow, createSaver, exportSave, importSave, migrate, clear,
  requestPersistence, isStandalone,
};
