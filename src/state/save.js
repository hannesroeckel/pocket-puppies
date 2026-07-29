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
import { SCHEMA_VERSION, newState, DIRT_REGIONS } from './game.js';

const KEY = BALANCE.save.key;

/* ---- migrations -------------------------------------------------------
   Add an entry per version bump. `migrate` runs them in order until the
   save reaches SCHEMA_VERSION. A missing key must always be filled in here
   rather than defended against at every read site.
   --------------------------------------------------------------------- */
export const MIGRATIONS = {
  /* ---- v1 -> v2 : stage 2 (care + bonding) --------------------------
     Adds the coat model (per-region dirt + gloss) and the slow-axis bond
     ledger. A stage-1 save keeps its dog, its affection, its floor and its
     name — including the hard-coded "Mochi", which is now a name she chose
     rather than a default, and must not be wiped. */
  2: (s) => {
    if (!s.inventory) s.inventory = {};
    if (!Array.isArray(s.inventory.toys) || !s.inventory.toys.length) s.inventory.toys = ['ball'];
    for (const d of (s.dogs || [])) {
      if (typeof d.name !== 'string') d.name = '';
      /* seed the dirt mask from the cleanliness the save already had, so a
         grubby stage-1 dog arrives visibly grubby rather than spotless */
      const soil = Math.max(0, 1 - (d.needs && typeof d.needs.cleanliness === 'number' ? d.needs.cleanliness : 0.9));
      if (!Array.isArray(d.dirt)) d.dirt = new Array(DIRT_REGIONS).fill(soil);
      if (typeof d.gloss !== 'number') d.gloss = 0.50;
      if (!d.bond) d.bond = { day: -1, earned: 0, showedUp: false, care: {}, session: 0, sessionAt: 0 };
    }
    /* a stage-1 save was made under the old fast-affection economy, so its
       affection number is inflated relative to the new pacing. It is NOT
       clawed back: the bond is hers and the ratchet says it never falls.
       New earnings simply proceed at the new (slow) rate from wherever she is. */
    s.v = 2;
    return s;
  },
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
    /* ---- stage 2 fields ----
       An UNNAMED dog is a completely valid save: she arrives unnamed and the
       naming beat runs on the next launch. Never substitute a placeholder. */
    if (typeof d.name !== 'string') d.name = '';
    if (typeof d.sex !== 'string') d.sex = BALANCE.gift.sex;
    if (!Array.isArray(d.dirt) || d.dirt.length !== DIRT_REGIONS) {
      const soil = Math.max(0, 1 - d.needs.cleanliness);
      d.dirt = new Array(DIRT_REGIONS).fill(soil);
    }
    for (let i = 0; i < d.dirt.length; i++) {
      const v = +d.dirt[i];
      d.dirt[i] = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
    }
    if (typeof d.gloss !== 'number' || !Number.isFinite(d.gloss)) d.gloss = 0.50;
    d.bond = { day: -1, earned: 0, showedUp: false, care: {}, session: 0, sessionAt: 0, ...(d.bond || {}) };
    if (!d.bond.care || typeof d.bond.care !== 'object') d.bond.care = {};
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
