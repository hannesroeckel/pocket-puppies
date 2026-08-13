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
import { SCHEMA_VERSION, newState, DIRT_REGIONS, newTrick, trickLevelFromReps } from './game.js';
import { FIND_BY_ID, walkState } from './walks.js';
import { contestState } from './contest.js';
import { dayIndex } from './time.js';
/* The ONE remaining read of breed aptitude in the codebase, and it exists
   purely to UNDO it: MIGRATIONS[5] has to know what breed term an old save's
   roll was created with in order to subtract it back out. Nothing creates a
   dog from this any more (SCOPE.md: "Breed is COSMETIC"). */
import { getBreed } from '../dog/breeds.js';

const KEY = BALANCE.save.key;

/**
 * Normalise the learned-word map to `{ [signalId]: {word, alts[], n} }`.
 *
 * During stage 3's build this field briefly held a LOUDNESS/PITCH ENVELOPE
 * (`{dur, loud, pitch}`) from an approach that could never work on the target
 * device — the real phone grants the microphone and then delivers zero samples
 * (WebKit 185448), so there was nothing to analyse. Any such entry is dropped
 * rather than migrated: there is no meaningful conversion from an envelope to
 * a word, and a dropped word costs the player one re-teach of an opt-in extra.
 */
function normVoice(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const slots = BALANCE.train.signal.ids;
  for (const sig of Object.keys(raw)) {
    if (!slots.includes(sig)) continue;
    const v = raw[sig];
    const word = typeof v === 'string' ? v : (v && typeof v.word === 'string' ? v.word : '');
    if (!word.trim()) continue;                       // legacy envelope: drop it
    const alts = (v && Array.isArray(v.alts) ? v.alts : [])
      .filter((a) => typeof a === 'string' && a.trim())
      .slice(0, Math.max(0, BALANCE.train.voice.maxAlts - 1));
    out[sig] = { word: word.trim().toLowerCase(), alts, n: (v && v.n > 0) ? v.n | 0 : 1 };
  }
  return out;
}

/* ---- migrations -------------------------------------------------------
   Add an entry per version bump. `migrate` runs them in order until the
   save reaches SCHEMA_VERSION. A missing key must always be filled in here
   rather than defended against at every read site.
   --------------------------------------------------------------------- */
/* every id the collar slot may legally hold: the earned ones and the bought
   ones, from the two tables that define them. Used by MIGRATIONS[6]. */
const WEARABLE_IDS = new Set([
  ...BALANCE.economy.unlocks.filter((u) => u.kind === 'wear').map((u) => u.id),
  ...BALANCE.economy.shop.items.filter((i) => i.kind === 'wear').map((i) => i.id),
]);

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

  /* ---- v2 -> v3 : stage 3 (training + tricks) ------------------------
     Adds the trick ledger and the (opt-in, usually empty) voice prototype
     map. A v1 or v2 save has `tricks: {}` already, so in practice this is a
     no-op that exists to normalise anything hand-edited — and to guarantee
     that a save written before stage 3 loads with a dog who simply hasn't
     learned anything yet. */
  3: (s) => {
    for (const d of (s.dogs || [])) {
      if (!d.tricks || typeof d.tricks !== 'object' || Array.isArray(d.tricks)) d.tricks = {};
      for (const id of Object.keys(d.tricks)) {
        const raw = d.tricks[id] || {};
        const t = { ...newTrick(), ...raw };
        /* §4's documented shape was {level, learnedAt, cue}: derive the fields
           stage 3 added rather than throwing away a level someone already had */
        if (!(t.reps > 0) && t.level > 0) {
          t.reps = BALANCE.train.learn.levelAt[Math.min(t.level, 3) - 1] || 0;
        }
        t.level = trickLevelFromReps(t.reps);
        if (t.cue && !BALANCE.train.signal.ids.includes(t.cue)) { t.cue = ''; t.cueConf = 0; }
        if (t.cue && !(t.cueConf > 0)) t.cueConf = BALANCE.train.learn.confNew;
        d.tricks[id] = t;
      }
      d.cueVoice = normVoice(d.cueVoice);
    }
    /* the mic stays OFF until she asks for it (ARCHITECTURE §9) */
    if (!s.settings) s.settings = {};
    if (typeof s.settings.mic !== 'boolean') s.settings.mic = false;
    s.v = 3;
    return s;
  },

  /* ---- v3 -> v4 : stage 4 (walks + discovery) -------------------------
     Adds the ACTIVE-WALK record — the three numbers that let a walk survive
     the app being killed (`startedAt`, `dur`, `seed`; see state/walks.js) —
     plus the day index `walksToday` belongs to, a lifetime total, and
     `inventory.activeToy`, which is how a found toy becomes the toy he
     actually fetches.

     A stage-1/2/3 save has `walks: {lastWalkAt, walksToday, found:[]}` from
     §4's original shape. It keeps all three. `walksToday` is deliberately NOT
     trusted across the bump: it belonged to a day index that was never
     recorded, so it is stamped with today rather than silently counting an old
     day's walks against this one. Nothing is lost — the worst case is one
     extra walk being available on the day of the update, which is a gift. */
  4: (s) => {
    if (!s.walks || typeof s.walks !== 'object') s.walks = {};
    const w = s.walks;
    if (typeof w.lastWalkAt !== 'number' || !Number.isFinite(w.lastWalkAt)) w.lastWalkAt = 0;
    if (!Array.isArray(w.found)) w.found = [];
    /* the log used to be undefined-shaped; normalise the entries we can read
       and drop anything that is not a find this build knows about */
    w.found = w.found.map((it) => {
      if (typeof it === 'string') return { at: 0, id: it, route: '' };
      if (it && typeof it === 'object' && typeof it.id === 'string') {
        return { at: Math.max(0, +it.at || 0), id: it.id, route: typeof it.route === 'string' ? it.route : '' };
      }
      return null;
    }).filter((it) => it && FIND_BY_ID[it.id]);
    if (typeof w.total !== 'number' || !Number.isFinite(w.total)) {
      /* best available estimate of a lifetime count: what is in the log */
      w.total = w.found.length;
    }
    w.day = dayIndex(Date.now());
    w.walksToday = 0;
    if (w.active === undefined) w.active = null;

    if (!s.inventory || typeof s.inventory !== 'object') s.inventory = {};
    if (!Array.isArray(s.inventory.toys) || !s.inventory.toys.length) s.inventory.toys = ['ball'];
    if (typeof s.inventory.activeToy !== 'string'
      || s.inventory.toys.indexOf(s.inventory.activeToy) < 0) {
      s.inventory.activeToy = s.inventory.toys[0] || 'ball';
    }
    if (!s.unlocks || typeof s.unlocks !== 'object') s.unlocks = { breeds: [], items: [], rooms: ['room'] };
    if (!Array.isArray(s.unlocks.items)) s.unlocks.items = [];
    /* anything already in the log counts as collected, so an old save's shelf
       is populated rather than starting empty */
    for (const it of w.found) if (s.unlocks.items.indexOf(it.id) < 0) s.unlocks.items.push(it.id);
    s.v = 4;
    return s;
  },

  /* ---- v4 -> v5 : stage 5 (contests + economy) ------------------------
     Three changes, and the first one is the interesting one.

     1. THE BREED TERM IS STRIPPED OUT OF `aptitude`, RATHER THAN RE-ROLLED.
        SCOPE.md stage 5 overrides ARCHITECTURE §4: aptitude may carry per-DOG
        jitter but must carry no per-BREED bias, because the gift puppy is a
        Schnoodle and the Cockapoo is the saving-up reward, and neither may be
        the mechanically worse obedience dog.

        An existing save's roll was `breed.aptitude[k] + jitter`. Re-rolling it
        would throw away the individual — this dog's own small quirk, which is
        the part that is WANTED. So the migration RE-CENTRES:

            new = clamp(0.5 + (old - breed.aptitude[k]), 0, 1)

        which recovers exactly the jitter and discards exactly the bias. For
        the Shiba (obedience 0.40) that moves every existing dog from a
        0.28-0.52 band to a 0.38-0.62 one — i.e. the breed penalty is lifted
        and nobody's individuality is lost. Guarded so a breed the build no
        longer knows about leaves the number alone rather than corrupting it.

     2. THE CURRENCY IS RENAMED `trainerPoints` -> `carePoints`, and the value
        carries across. "Trainer points" described the wrong thing: they are
        not earned by training, they are earned by looking after him. Nothing
        had ever paid any out, so in practice this is a rename of a zero — but
        a hand-edited or imported save may have one and it is kept.

     3. `contests` is reshaped for the ladder, and AGILITY'S RECORD IS DROPPED
        because Agility is cut (SCOPE stage 5) and a dead key in a save file is
        a promise to build it. `disc` stays: it is reframed as catch-and-leap
        and may still ship. `contestState()` repairs whatever obedience record
        was there, so an old `{rank, wins, lastEntryAt, entriesToday}` simply
        becomes a Beginner with no history rather than being thrown away. */
  5: (s) => {
    /* ---- 1. the breed term ---- */
    for (const d of (s.dogs || [])) {
      if (!d.aptitude || typeof d.aptitude !== 'object') continue;
      let breed = null;
      try { breed = getBreed(d.breedId); } catch (e) { breed = null; }
      const bias = (breed && breed.aptitude) || null;
      for (const k of ['disc', 'agility', 'obedience']) {
        const old = +d.aptitude[k];
        if (!Number.isFinite(old)) { d.aptitude[k] = 0.5; continue; }
        const term = bias && Number.isFinite(+bias[k]) ? +bias[k] : null;
        /* no breed data to undo: leave the individual exactly as it is rather
           than inventing a correction */
        if (term === null) continue;
        d.aptitude[k] = Math.min(1, Math.max(0, 0.5 + (old - term)));
      }
    }

    /* ---- 2. the currencies ---- */
    if (!s.player || typeof s.player !== 'object') s.player = {};
    const p = s.player;
    if (typeof p.coins !== 'number' || !Number.isFinite(p.coins)) {
      p.coins = BALANCE.economy.startCoins;
    }
    p.coins = Math.max(0, Math.floor(p.coins));
    const legacy = Number.isFinite(+p.trainerPoints) ? Math.max(0, Math.floor(+p.trainerPoints)) : 0;
    if (typeof p.carePoints !== 'number' || !Number.isFinite(p.carePoints)) p.carePoints = legacy;
    p.carePoints = Math.max(0, Math.floor(p.carePoints));
    delete p.trainerPoints;
    /* a fresh daily ledger, stamped with today. The same reasoning as v4's
       `walksToday`: it belonged to a day index that was never recorded, so the
       worst case is one extra day's allowance on update day — a gift. */
    p.careDay = { day: dayIndex(Date.now()), earned: 0, once: {} };

    /* ---- 3. the contest records ---- */
    if (!s.contests || typeof s.contests !== 'object') s.contests = {};
    delete s.contests.agility;
    contestState(s, Date.now());
    s.v = 5;
    return s;
  },

  /* ---- v5 -> v6 : stage 6 (shop + kennel) ----------------------------
     THE STATE SHAPE DID NOT GROW. `inventory.food` / `.care` / `.accessories`,
     `unlocks.items` / `.breeds`, `dogs[]`, `activeDogId` and `dog.wear` were
     all put there by stage 1 and have been merged forward ever since. What
     changed is that stage 6 is the first code that WRITES to them, and a
     reader that only ever read them tolerated types a writer cannot.

     `inv.food[id] = n` against a string does nothing and reports nothing. So
     the bump exists to make the types true on disk before the shop touches
     them, rather than to add a field:

       1. the three inventory containers are coerced to their real types, and
          anything unrecognisable is replaced rather than repaired — an
          inventory nobody can parse is not a save worth rescuing, and losing
          `{}` costs nothing;
       2. `unlocks.items` / `.breeds` likewise, and the ACTIVE dog's breed is
          guaranteed to be in `unlocks.breeds` (a save could otherwise say she
          owns a dog of a breed she has not unlocked, which the kennel would
          then offer to unlock for her);
       3. every dog gets a `wear` object, because `equipWear` writes
          `wear.collar` and stage 1 only guaranteed `wear` on dogs it made;
       4. TWO ROWS LEAVE `BALANCE.economy.unlocks` (`bedBasket`,
          `roomSeaside`) and nothing has to be done about it — unlocks are
          DERIVED from `carePoints` on every read and were never stored. That
          is worth saying out loud: it is why trimming the table cannot cost
          anybody anything they had earned.

     Care points, coins, the bond, names, tricks and voices are not touched. */
  6: (s) => {
    const inv = (s.inventory && typeof s.inventory === 'object' && !Array.isArray(s.inventory))
      ? s.inventory : (s.inventory = {});
    if (!inv.food || typeof inv.food !== 'object' || Array.isArray(inv.food)) inv.food = {};
    if (!inv.care || typeof inv.care !== 'object' || Array.isArray(inv.care)) inv.care = {};
    if (!Array.isArray(inv.accessories)) inv.accessories = [];
    inv.accessories = inv.accessories.filter((x) => typeof x === 'string' && x);
    if (!Array.isArray(inv.toys) || !inv.toys.length) inv.toys = ['ball'];
    /* counts are integers, and a negative or NaN count is zero */
    for (const bag of [inv.food, inv.care]) {
      for (const k of Object.keys(bag)) {
        const n = Math.floor(+bag[k]);
        if (!Number.isFinite(n) || n <= 0) delete bag[k];
        else bag[k] = n;
      }
    }

    if (!s.unlocks || typeof s.unlocks !== 'object' || Array.isArray(s.unlocks)) s.unlocks = {};
    for (const k of ['breeds', 'items', 'rooms']) {
      if (!Array.isArray(s.unlocks[k])) s.unlocks[k] = [];
      s.unlocks[k] = s.unlocks[k].filter((x) => typeof x === 'string' && x);
    }
    if (!s.unlocks.rooms.length) s.unlocks.rooms = ['room'];

    const dogs = Array.isArray(s.dogs) ? s.dogs : (s.dogs = []);
    for (const d of dogs) {
      if (!d || typeof d !== 'object') continue;
      if (!d.wear || typeof d.wear !== 'object' || Array.isArray(d.wear)) d.wear = { collar: null, accessory: null };
      /* A LEGACY COLLAR ID IS DROPPED, not kept. Stage 1 wrote `collar: 'red'`
         into `wear` and nothing ever read it, so the string was free to mean
         anything; stage 6 gives that slot real ids and a real palette, and a
         value outside `BALANCE.ui.wear` would draw as the fallback colour —
         i.e. she would appear to be wearing a red collar she had never
         earned, which is exactly the promise the 90-point unlock makes. */
      if (typeof d.wear.collar !== 'string' || !WEARABLE_IDS.has(d.wear.collar)) d.wear.collar = null;
      if (typeof d.breedId === 'string' && d.breedId
          && s.unlocks.breeds.indexOf(d.breedId) < 0) s.unlocks.breeds.push(d.breedId);
    }
    s.v = 6;
    return s;
  },

  /* ---- v6 -> v7 : the save tracked time once, and needed to track it twice
     Queue items 4 and 7, which have one root cause. `lastSeenAt` was stored
     for the SAVE, so it answered "when was the app last open?" and was then
     used to answer "how long has she been away from this dog?" — a different
     question with a different answer the moment there are two dogs.

     Every dog gets his own `lastSeenAt`, SEEDED FROM THE APP CLOCK. That is
     the honest conversion: an old save genuinely does not know when she last
     picked up each dog, and the one thing that must not happen is inventing a
     gap — a migration that seeded 0, or `bornAt`, would fire a full-intensity
     reunion for a dog she was playing with five minutes before she updated.
     Seeding from `lastSeenAt` means the first launch after this migration
     greets everybody exactly as the old build would have, and the per-dog
     clocks diverge from there, which is the only place they can honestly
     start diverging.

     Nothing else moves. Needs, affection, floors, tricks and coins are
     untouched: this bump adds a clock, it does not spend anything. */
  7: (s) => {
    const dogs = Array.isArray(s.dogs) ? s.dogs : [];
    const seed = Number.isFinite(+s.lastSeenAt) ? +s.lastSeenAt : Date.now();
    for (const d of dogs) {
      if (!d || typeof d !== 'object') continue;
      if (!Number.isFinite(+d.lastSeenAt) || +d.lastSeenAt <= 0) d.lastSeenAt = seed;
    }
    s.v = 7;
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
    if (!d.tricks || typeof d.tricks !== 'object' || Array.isArray(d.tricks)) d.tricks = {};
    for (const id of Object.keys(d.tricks)) {
      d.tricks[id] = { ...newTrick(), ...(d.tricks[id] || {}) };
    }
    d.cueVoice = normVoice(d.cueVoice);
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
  /* ---- stage 4 fields ----
     `walkState` repairs the whole walks block, including an active-walk record
     with a poisoned duration or a start time in the future, and rolls the day
     boundary. It is called here so a hand-edited or imported save can never put
     a walk the progress function cannot read in front of the first frame. */
  walkState(out);
  /* ---- stage 5 fields ----
     Same reasoning as `walkState` above: `contestState` repairs the whole
     obedience record — a class index out of range, a NaN best score, a
     champScores array that has grown past its window — and rolls the day
     boundary, so a hand-edited or imported save can never put a record the
     ladder cannot read in front of the first frame. The player block gets the
     same treatment because `carePoints` gates content: a NaN there would
     silently lock or unlock every breed in the game. */
  out.player = out.player || {};
  out.player.coins = Math.max(0, Math.floor(Number.isFinite(+out.player.coins)
    ? +out.player.coins : BALANCE.economy.startCoins));
  out.player.carePoints = Math.max(0, Math.floor(Number.isFinite(+out.player.carePoints)
    ? +out.player.carePoints : 0));
  if (!out.player.careDay || typeof out.player.careDay !== 'object') {
    out.player.careDay = { day: dayIndex(Date.now()), earned: 0, once: {} };
  }
  delete out.player.trainerPoints;
  contestState(out);
  if (!Array.isArray(out.inventory.toys) || !out.inventory.toys.length) out.inventory.toys = ['ball'];
  if (typeof out.inventory.activeToy !== 'string'
    || out.inventory.toys.indexOf(out.inventory.activeToy) < 0) {
    out.inventory.activeToy = out.inventory.toys[0] || 'ball';
  }
  if (!Array.isArray(out.unlocks.items)) out.unlocks.items = [];
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
