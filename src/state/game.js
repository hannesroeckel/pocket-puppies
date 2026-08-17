/* ==========================================================================
   state/game.js — the save object, its mutators, and derived getters.

   NON-NEGOTIABLE (architecture §4):
     - No scene ever writes a need or affection field directly. Everything
       goes through a mutator here.
     - `affection = Math.max(affectionFloor, next)` is enforced INSIDE the
       mutator, so the ratchet cannot be bypassed by a caller that forgets.
       The dog never resents her.

   TWO AXES, DIFFERENT TIME CONSTANTS (research §2; stage 2 fix) ------------

     mood       FAST (seconds), NOT persisted. Everything you can see — tail
                amplitude and speed, ear height, eye openness, mouth, posture,
                willingness to initiate — reads off `mood`. It decays toward a
                baseline that AFFECTION sets, so a bonded dog rests happy.
     affection  SLOW (days), persisted, effectively monotonic upward. It sets
                the mood baseline and the reunion intensity. It is never drawn.
     trust      SLOWER still. Stage 3 gates advanced tricks on it.

   Stage 1 conflated mood and affection, so ~50 strokes in one sitting took
   the bond from 0.30 to 0.98. Affection now carries a per-session diminishing
   return AND a daily cap, and turning up on a new day pays a bonus — because
   the design wants distinct sessions, not long ones.
   ========================================================================== */
import BALANCE from './balance.js';
import { clamp } from '../engine/draw.js';
/* NOTE: `dog/breeds.js` is deliberately NOT imported here any more. It was
   imported for exactly one thing — rolling `aptitude` from the breed — and
   SCOPE.md stage 5 forbids that term. The state layer now has no knowledge of
   breeds beyond storing an id, which is the correct shape for a game where
   breed is cosmetic. (state/save.js still imports it, once, to UNDO the term
   in an old save; see MIGRATIONS[5].) */
import { rng as sharedRng } from '../engine/rng.js';
import { dayIndex } from './time.js';
import { contestState, classAt, isTop, champStanding } from './contest.js';
import {
  walkState, startWalk as startWalkModel, walkProgress as walkProgressModel,
  endWalk as endWalkModel, cancelWalk as cancelWalkModel, rollFinds,
  collected as collectedFinds, FIND_BY_ID, isShelvable, metDogs,
} from './walks.js';

export const SCHEMA_VERSION = 8;

/** how many dirt regions a coat has — dog/care.js renders and erases these */
export const DIRT_REGIONS = BALANCE.care.wash.regions.length;

/* ---- fresh state ------------------------------------------------------ */
export function newDog(now, opts = {}) {
  const G = BALANCE.gift;
  /* SHE ARRIVES UNNAMED. The naming moment is the emotional centre of first
     launch, so the default is the empty string, not a placeholder. Breed and
     sex come from BALANCE.gift — a one-line change until the human confirms. */
  const {
    breedId = G.breedId, name = '', sex = G.sex, rng = sharedRng,
  } = opts;
  const jitter = () => clamp(rng.range(-0.12, 0.12), -0.12, 0.12);
  return {
    id: 'dog-' + now.toString(36),
    name, breedId, sex, bornAt: now,
    /* ---- WHEN SHE WAS LAST WITH *THIS* DOG (queue item 4) ---------------
       The save used to track time once, globally, and that is not the same
       question. Play with the Cockapoo every day for a fortnight and the game
       knew she had been here yesterday, so the Schnoodle greeted her flatly
       after two weeks apart — exactly the moment the reunion exists for.

       IT IS THE BOND'S CLOCK, NOT THE BODY'S. Needs decay off the app clock
       (`state.lastSeenAt`), which advances for every dog whether or not he is
       the one in the room; this advances only when she is actually with him,
       and the reunion is driven from whichever of the two gaps is longer. */
    lastSeenAt: now,
    needs: { hunger: 0.82, thirst: 0.86, cleanliness: 0.94, energy: 0.90 },
    affection: BALANCE.affection.start,
    affectionFloor: BALANCE.affection.startFloor,
    trust: 0.05,
    /* per-region coat dirt, 0..1. Dirt accrues from ACTIVITY, not from time. */
    dirt: new Array(DIRT_REGIONS).fill(0),
    /* coat gloss, raised by brushing along the grain, fades over days */
    gloss: 0.55,
    /* the slow-axis ledger: what the bond has already earned today */
    bond: { day: dayIndex(now), earned: 0, showedUp: false, care: {}, session: 0, sessionAt: 0 },
    /* what she has learned, and WHAT SHE THINKS EACH CUE MEANS (stage 3).
       See newTrick() — `cue` may be wrong, and that is the point. */
    tricks: {},
    /* voice prototypes per cue slot: {dur, loud, pitch, n}. Opt-in extra;
       an empty map is the normal, complete, tap-only game. */
    cueVoice: {},
    /* ---- BREED IS COSMETIC. THIS OVERRIDES ARCHITECTURE §4. --------------
       §4 said aptitude is "rolled at adopt from breed + jitter". SCOPE.md
       stage 5 drops the breed term outright, and the reason is specific
       rather than aesthetic: the gift puppy is a Schnoodle and the Cockapoo is
       the saving-up reward, so if either turned out to be a mechanically worse
       obedience dog the game would have told her that her favourite dog is the
       wrong dog. Unacceptable.

       PER-DOG JITTER IS KEPT, and is good: it is what makes an individual feel
       like an individual, and it is worth at most +/-0.12 of a 0.10-weighted
       term in the obedience roll (BALANCE.train.obey.perAptitude) and +/-0.12
       of ten points in a trial score (BALANCE.contest.poise). It can flavour a
       dog; it can never decide a class.

       `BREEDS[x].aptitude` still exists — it is part of the §11.3 breed-seam
       schema and MIGRATIONS[5] needs it to UNDO the term an old save was
       created with — but nothing reads it to create a dog any more. */
    aptitude: {
      disc: clamp(0.5 + jitter(), 0, 1),
      agility: clamp(0.5 + jitter(), 0, 1),
      obedience: clamp(0.5 + jitter(), 0, 1),
    },
    wear: { collar: null, accessory: null },
    log: [],
  };
}

/* ---- a trick, as she understands it ------------------------------------
   `reps` is quality-weighted practice, `level` is derived from it, and `cue`
   is WHAT SHE THINKS THE SIGNAL WAS — which can be the wrong signal, or the
   right signal on the wrong trick. `cueConf` is how strongly she believes it,
   and it is what patience erodes when she has got it wrong.
   ---------------------------------------------------------------------- */
export function newTrick() {
  return {
    level: 0, reps: 0,
    cue: '', cueConf: 0,
    learnedAt: 0, lastAt: 0,
    sessReps: 0, sessAt: 0, dayAt: -1,
    asked: 0, ok: 0,
  };
}

/** level 0..3 from quality-weighted reps (BALANCE.train.learn.levelAt) */
export function trickLevelFromReps(reps) {
  const at = BALANCE.train.learn.levelAt;
  /* NaN >= anything is false, so an unguarded NaN silently returned level 0 —
     i.e. "he has forgotten every trick" — rather than failing loudly */
  const r = Number.isFinite(+reps) ? +reps : 0;
  let lv = 0;
  for (let i = 0; i < at.length; i++) if (r >= at[i]) lv = i + 1;
  return lv;
}

export function newState(now = Date.now(), opts = {}) {
  const dog = newDog(now, opts);
  return {
    v: SCHEMA_VERSION,
    createdAt: now,
    lastSeenAt: now,
    /* ---- TWO CURRENCIES, AND THEY NEVER MEET (SCOPE stage 5) ------------
       `coins` are skill and luck: contest placings and selling walk finds.
       `carePoints` are attentiveness: they are earned ONLY by looking after
       him, they buy nothing, and they are the only thing that unlocks a breed
       or a piece of decor. There is no exchange rate and no mutator below
       converts one into the other — see `spendCoins` and `awardCare`.
       `careDay` is the daily ledger the points are paid through, so a marathon
       cannot substitute for coming back tomorrow (the same shape as `bond`). */
    player: {
      coins: BALANCE.economy.startCoins,
      carePoints: 0,
      careDay: { day: dayIndex(now), earned: 0, once: {} },
    },
    dogs: [dog],
    activeDogId: dog.id,
    /* `activeToy` is which of the fetch toys is currently on the rug. Stage 4's
       walks are the only thing that adds to `toys`, so what he brought home
       genuinely becomes the thing he fetches. */
    inventory: { food: {}, care: {}, toys: ['ball'], activeToy: 'ball', accessories: [] },
    unlocks: { breeds: [dog.breedId], items: [], rooms: ['room'] },
    /* ---- CONTESTS -------------------------------------------------------
       AGILITY IS CUT (SCOPE stage 5) and its key is gone with it — its
       top-down route map IS the mechanic and it fights this rig hardest. Disc
       keeps a stub because it is reframed as catch-and-leap and may still
       ship. `obedience` is the real one; `state/contest.js contestState()`
       repairs and day-rolls it on every read, exactly as `walkState` does. */
    contests: {
      disc: { rank: 0, wins: 0, lastEntryAt: 0, entriesToday: 0 },
      obedience: {
        classIdx: 0, day: dayIndex(now), entriesToday: 0, entries: 0,
        wins: 0, best: 0, lastEntryAt: 0, champScores: [], won: false,
      },
    },
    /* `active` is the walk he is on RIGHT NOW, and it is the whole reason a
       walk survives the app being killed: it stores when he left and how long
       for, and progress is recomputed from the wall clock on resume. See
       state/walks.js. `day` is the local-midnight index `walksToday` belongs to. */
    walks: {
      lastWalkAt: 0, walksToday: 0, found: [], active: null, day: dayIndex(now), total: 0,
      /* ---- WHAT IS OUT ON THE SILL, AND IN WHAT ORDER (queue item 6) -----
         The room used to display the last seven distinct finds and silently
         drop the rest, which is how a collection becomes a floor that fills:
         "when the room fills up it just gets messy. we also need a storage for
         these items that hides them from the room if wanted."

         This is HER arrangement. An empty array means nothing is out yet and
         the newest finds fill the sill by themselves (`display` is topped up
         in `addFind`), so she never has to open the box to have a room worth
         looking at — but the moment she wants to choose, the choice is hers
         and it persists. Toys are not in here: they live on the rug, because
         that is where a toy is. Photos are not either: they are the album. */
      display: [],
    },
    flags: { seenIntro: false, namedFirstDog: false },
    settings: { sound: true, reducedMotion: 'auto', mic: false },
  };
}

/* ---- pronouns, resolved AT RUNTIME from per-dog data --------------------
   The gift puppy is male; a second dog may be female. Copy therefore may never
   hardcode a pronoun — it asks `game.pron` and interpolates. Anything that is
   not 'm' or 'f' falls back to they/them, which is why `is` and `s` are in the
   table too: "they are" / "he is", "they sit" / "he sits".
   ---------------------------------------------------------------------- */
export const PRONOUNS = {
  m: { they: 'he', them: 'him', their: 'his', theirs: 'his', self: 'himself', is: 'is', has: 'has', s: 's' },
  f: { they: 'she', them: 'her', their: 'her', theirs: 'hers', self: 'herself', is: 'is', has: 'has', s: 's' },
  n: { they: 'they', them: 'them', their: 'their', theirs: 'theirs', self: 'themselves', is: 'are', has: 'have', s: '' },
};
/** 'He' from 'he' — for copy that starts a sentence with a pronoun */
export const capitalise = (w) => (w ? w[0].toUpperCase() + w.slice(1) : w);

/* ==========================================================================
   NUMERIC GUARDS — why every mutator below runs its arguments through these.

   `engine/draw.js`'s clamp is `v < a ? a : (v > b ? b : v)`. Every comparison
   against NaN is false, so **clamp passes NaN and undefined straight through**.
   That made a single careless caller able to poison persisted state:

       game.setMood(undefined)      -> mood = undefined
       game.addNeed('hunger', NaN)  -> needs.hunger = NaN

   and the damage did not surface at the call site. It surfaced frames later in
   the rig (a spring target of NaN makes the whole animal vanish), or launches
   later, because the poisoned value had already been written to localStorage
   by the debounced saver. A bad caller must not be able to do that.

   The policy is REJECT, NOT COERCE: a nonsense delta leaves the field alone
   and returns the current value, so a bug is a no-op rather than a silent
   rewrite to zero (which would look like progress being erased — much worse
   than nothing happening on this project in particular).
   ========================================================================== */
/** @returns a finite number, or `fallback` */
export const num = (v, fallback = 0) => {
  const n = typeof v === 'number' ? v : +v;
  return Number.isFinite(n) ? n : fallback;
};
/** clamp that can never return NaN or undefined */
export const clampNum = (v, a, b, fallback = a) => clamp(num(v, fallback), a, b);
/** true only for a real, usable numeric input */
const ok = (v) => Number.isFinite(typeof v === 'number' ? v : +v);

/* ---- repairing a save that was written BEFORE these guards existed -------
   The guards stop new corruption; they cannot undo corruption already sitting
   on disk. This runs once per load and puts every numeric field back inside
   its domain, preferring the *stored* value wherever it is usable so nothing
   legitimate is thrown away. ------------------------------------------- */
export function sanitiseDog(d) {
  if (!d || typeof d !== 'object') return d;
  const fresh = () => ({ hunger: 0.82, thirst: 0.86, cleanliness: 0.94, energy: 0.90 });
  if (!d.needs || typeof d.needs !== 'object') d.needs = fresh();
  const def = fresh();
  for (const k of Object.keys(def)) d.needs[k] = clampNum(d.needs[k], 0, 1, def[k]);
  d.affectionFloor = clampNum(d.affectionFloor, 0, 1, BALANCE.affection.startFloor);
  d.affection = Math.max(d.affectionFloor, clampNum(d.affection, 0, 1, BALANCE.affection.start));
  d.trust = clampNum(d.trust, 0, 1, 0);
  d.gloss = clampNum(d.gloss, 0, 1, 0.55);
  if (!Array.isArray(d.dirt) || d.dirt.length !== DIRT_REGIONS) {
    d.dirt = new Array(DIRT_REGIONS).fill(clampNum(1 - num(d.needs.cleanliness, 1), 0, 1, 0));
  } else {
    for (let i = 0; i < d.dirt.length; i++) d.dirt[i] = clampNum(d.dirt[i], 0, 1, 0);
  }
  if (d.aptitude && typeof d.aptitude === 'object') {
    for (const k of ['disc', 'agility', 'obedience']) d.aptitude[k] = clampNum(d.aptitude[k], 0, 1, 0.5);
  }
  if (d.tricks && typeof d.tricks === 'object' && !Array.isArray(d.tricks)) {
    for (const id of Object.keys(d.tricks)) {
      const t = d.tricks[id];
      /* drop anything that is not a real trick: a junk record would show up in
         the cue legend and in the repertoire a contest asks from */
      if (!BALANCE.train.roster.includes(id)) { delete d.tricks[id]; continue; }
      if (!t || typeof t !== 'object') { delete d.tricks[id]; continue; }
      t.reps = Math.max(0, num(t.reps, 0));
      t.level = trickLevelFromReps(t.reps);
      t.cueConf = clampNum(t.cueConf, 0, 1, 0);
      if (typeof t.cue !== 'string' || !t.cue) { t.cue = ''; t.cueConf = 0; }
      for (const k of ['learnedAt', 'lastAt', 'sessReps', 'sessAt', 'asked', 'ok']) t[k] = Math.max(0, num(t[k], 0));
      t.dayAt = num(t.dayAt, -1);
    }
  } else d.tricks = {};
  if (d.bond && typeof d.bond === 'object') {
    d.bond.day = num(d.bond.day, -1);
    d.bond.earned = Math.max(0, num(d.bond.earned, 0));
    d.bond.session = Math.max(0, num(d.bond.session, 0));
    d.bond.sessionAt = Math.max(0, num(d.bond.sessionAt, 0));
    if (!d.bond.care || typeof d.bond.care !== 'object') d.bond.care = {};
  }
  if (!Array.isArray(d.log)) d.log = [];
  return d;
}

/**
 * Map a bond-ledger `awardDay` kind onto a care-points kind. Kept as one
 * table so the two ledgers can never disagree about what an act of care is.
 * Anything not in the economy table pays nothing, which is how `contest` is
 * worth zero care points without needing a special case.
 */
function careKindFor(kind) {
  if (kind.indexOf('care:') === 0) return kind.slice(5);
  if (kind.indexOf('trick:') === 0 || kind.indexOf('learn:') === 0) return 'trick';
  return kind;
}

/* ---- the game api ---------------------------------------------------- */
export function createGame(state, opts = {}) {
  const onChange = opts.onChange || (() => {});
  const A = BALANCE.affection;
  const MD = BALANCE.mood;
  let affPulse = 0;

  function dog() {
    return state.dogs.find((d) => d.id === state.activeDogId) || state.dogs[0];
  }

  /* ---- THE INVENTORY, GUARANTEED TO BE THE RIGHT SHAPE ----------------
     Stage 6 is the first code that WRITES to `inventory.food`, `.care` and
     `.accessories`. `state/save.js` merges the inventory object forward from
     base, so those keys always exist on a fresh normalise — but a save
     hand-edited, half-written, or produced by a build that stored something
     else there can still hand us a string where a map should be, and
     `inv.food[id] = n` on a string silently does nothing while reporting
     success. MIGRATIONS[6] repairs this on load; this is the same repair at
     the point of use, so a shop cannot be defeated by a bad save either way. */
  function invOf() {
    const inv = state.inventory || (state.inventory = {});
    if (!inv.food || typeof inv.food !== 'object' || Array.isArray(inv.food)) inv.food = {};
    if (!inv.care || typeof inv.care !== 'object' || Array.isArray(inv.care)) inv.care = {};
    if (!Array.isArray(inv.accessories)) inv.accessories = [];
    if (!Array.isArray(inv.toys) || !inv.toys.length) inv.toys = ['ball'];
    return inv;
  }

  /* Repair anything already poisoned on disk before a single frame runs. A
     save written by a build without the guards below can legitimately contain
     `affection: null`; the rig would then render nothing at all. */
  for (const d of (state.dogs || [])) sanitiseDog(d);
  invOf();
  if (!state.unlocks || typeof state.unlocks !== 'object') state.unlocks = { breeds: [], items: [], rooms: ['room'] };
  if (!Array.isArray(state.unlocks.items)) state.unlocks.items = [];
  if (!Array.isArray(state.unlocks.breeds)) state.unlocks.breeds = [];
  if (!state.flags || typeof state.flags !== 'object') state.flags = {};

  /* ---- MOOD: fast, in-memory only -----------------------------------
     Never persisted: a mood that survives a cold start is not a mood, it's
     a grudge. On load it starts at the baseline affection implies. */
  /* Every read here is guarded too, not just the writes: the baseline is
     recomputed 60x/second and feeds `mood`, so one bad field anywhere upstream
     would otherwise turn the whole visible animal into NaN. */
  function baseline() {
    const d = dog();
    const n = d.needs || {};
    const unmet = clampNum(1 - (num(n.hunger, 1) + num(n.thirst, 1) + num(n.cleanliness, 1)) / 3, 0, 1, 0);
    return clampNum(MD.baseBias + num(d.affection, 0) * MD.baseFromAffection - unmet * MD.needWeight,
      0.03, 1, MD.baseBias);
  }
  let mood = baseline();

  /** The bag handed to rig.base() and pet.apply() every frame. Mutated in
      place rather than reallocated — this is read 60x/second. */
  const moodBag = {
    mood, baseline: mood,
    affection: 0, floor: 0, trust: 0,
    needs: null, wellbeing: 1,
  };

  /** The one place affection is ever written. */
  function setAffection(next, reason) {
    const d = dog();
    const before = num(d.affection, 0);
    /* A nonsense target must not be allowed to move the RATCHET, which is
       permanent and unrecoverable — that is the one write in this file that
       cannot be undone, so it gets the guard before anything else happens. */
    if (!ok(next)) return d.affection;
    next = clamp(+next, 0, 1);
    d.affectionFloor = clampNum(d.affectionFloor, 0, 1, BALANCE.affection.startFloor);
    /* milestone ratchet: crossing a threshold raises the floor permanently */
    for (const m of A.milestones) {
      if (next >= m.at && d.affectionFloor < m.floor) d.affectionFloor = m.floor;
    }
    /* continuous ratchet */
    const ratio = next * A.floorRatio;
    if (ratio > d.affectionFloor) d.affectionFloor = Math.min(1, ratio);
    /* THE RULE */
    d.affection = clampNum(Math.max(d.affectionFloor, next), 0, 1, d.affectionFloor);
    if (d.affection !== before) {
      if (reason && Math.abs(d.affection - before) > 0.02) api.log('affection', reason);
      onChange();
    }
    return d.affection;
  }

  /* ---- the slow-axis ledger ----------------------------------------- */
  function ledger(now) {
    const d = dog();
    if (!d.bond || typeof d.bond !== 'object') {
      d.bond = { day: -1, earned: 0, showedUp: false, care: {}, session: 0, sessionAt: 0 };
    }
    /* A NaN `now` used to reach dayIndex() and come back NaN — and since
       `NaN !== NaN`, the ledger then "rolled over to a new day" on EVERY call,
       silently uncapping the daily affection cap that the whole anti-grind
       design rests on. Guarded here rather than at nine call sites. */
    const today = dayIndex(num(now, Date.now()));
    if (!Number.isFinite(today)) return d.bond;
    d.bond.earned = Math.max(0, num(d.bond.earned, 0));
    d.bond.session = Math.max(0, num(d.bond.session, 0));
    if (!d.bond.care || typeof d.bond.care !== 'object') d.bond.care = {};
    if (d.bond.day !== today) {
      d.bond.day = today;
      d.bond.earned = 0;
      d.bond.showedUp = false;
      d.bond.care = {};
      d.bond.session = 0;
      onChange();
    }
    return d.bond;
  }

  /**
   * Gate a would-be affection gain through the session diminishing return and
   * the daily cap. This is the anti-grind lever: the session total converges
   * on `session.cap` however long she keeps stroking, and the day cannot pay
   * out more than `day.cap` in total, so a marathon can never substitute for
   * coming back tomorrow.
   */
  function meter(raw, now) {
    if (!(raw > 0)) return raw;
    const b = ledger(now);
    const S = A.session;
    /* diminishing return within the session */
    const damped = raw * Math.exp(-b.session / Math.max(1e-6, S.soft));
    const sessionRoom = Math.max(0, S.cap - b.session);
    const dayRoom = Math.max(0, A.day.cap - b.earned);
    const paid = Math.min(damped, sessionRoom, dayRoom);
    if (paid <= 0) return 0;
    b.session += paid;
    b.earned += paid;
    return paid;
  }

  const api = {
    get state() { return state; },
    get dog() { return dog(); },
    get affection() { return dog().affection; },
    get affectionFloor() { return dog().affectionFloor; },
    get affectionPulse() { return affPulse; },

    /* ---- MOOD (fast, unsaved) --------------------------------------- */
    get moodLevel() { return mood; },
    get moodBaseline() { return baseline(); },
    /** direct bumps: petting quality, a completed care action, the reunion */
    addMood(delta) {
      if (!Number.isFinite(+delta)) return mood;
      mood = clamp(mood + (+delta), 0, 1);
      return mood;
    },
    /* `clamp` passes NaN and undefined straight through, so a single bad caller
       used to be able to set mood to `undefined` and take every consumer of it
       down with it — silently, several frames later. Guarded at the mutator,
       which is the only place mood is ever written. */
    setMood(v) {
      if (!Number.isFinite(+v)) return mood;
      mood = clamp(+v, 0, 1);
      return mood;
    },
    /** an unwelcome touch dents mood — but never below the baseline the bond
        has earned. Annoyed, never resentful. */
    dentMood(amount) {
      /* `Math.max(x, NaN)` is NaN, so an unguarded NaN here poisoned mood just
         as effectively as setMood(undefined) did. */
      const a = amount === undefined ? MD.badTouch : num(amount, MD.badTouch);
      mood = clampNum(Math.max(baseline(), num(mood, baseline()) - a), 0, 1, baseline());
      return mood;
    },
    /** call once per frame: mood drifts toward the baseline affection sets */
    stepMood(dt) {
      const b = baseline();
      /* self-healing: if mood has somehow gone bad, snap it to the baseline
         rather than propagating NaN into every spring target for the rest of
         the session. This is the frame loop; it must never be the thing that
         keeps a poisoned value alive. */
      if (!ok(mood)) { mood = b; return mood; }
      const d = num(dt, 0);
      if (d <= 0) return mood;
      const rate = mood > b ? MD.fallRate : MD.riseRate;
      mood = clampNum(mood + (b - mood) * (1 - Math.exp(-rate * d)), 0, 1, b);
      return mood;
    },

    /* ---- mutators -------------------------------------------------- */
    /**
     * @param delta raw affection. POSITIVE deltas are metered through the
     *   session/day ledger; negative ones (the "missed you" dip) are not.
     * @returns the affection AFTER the write
     */
    addAffection(delta, reason) {
      if (!(delta > 0) && !(delta < 0)) return dog().affection;
      const d = dog();
      if (delta > 0) {
        const paid = meter(delta);
        if (paid <= 0) return d.affection;
        affPulse = Math.min(1, affPulse + paid * 90);
        api.addTrust(paid * A.trustPerAffection);
        return setAffection(d.affection + paid, reason);
      }
      affPulse = Math.min(1, affPulse + Math.abs(delta) * 6);
      return setAffection(d.affection + delta, reason);
    },
    /** raw, unmetered — for migrations and the day bonuses below */
    addAffectionRaw(delta, reason) {
      const d = dog();
      if (!ok(delta)) return d.affection;
      delta = +delta;
      if (delta > 0) api.addTrust(delta * A.trustPerAffection);
      affPulse = Math.min(1, num(affPulse, 0) + Math.abs(delta) * 20);
      return setAffection(num(d.affection, 0) + delta, reason);
    },
    setAffection,

    /**
     * The "distinct sessions beat session length" lever. Each kind pays at
     * most once per local day and is still subject to the day cap.
     *   'showUp'  first launch of the day
     *   'reunion' after an 8h+ absence, on top of showUp
     *   'care:feed' | 'care:water' | 'care:wash' | 'care:brush'
     *   'toy'     a fetched toy (repeatable, day-capped)
     *   'trick:sit' | 'trick:beg' | ...   a rewarded training rep
     *   'learn:sit' | ...                 the moment a trick first lands
     * @returns the affection actually paid
     */
    awardDay(kind, now) {
      /* every branch below does `kind.indexOf(...)`, which throws outright on a
         number — the one mutator in this file that could take the frame down
         rather than merely corrupt something */
      if (typeof kind !== 'string' || !kind) return 0;
      /* ---- CARE POINTS RIDE ALONG HERE, AND ONLY HERE ------------------
         `awardDay` already IS the attentiveness ledger — one call site set,
         already day-boundaried, already correct — so paying care points from
         anywhere else would be two ledgers that could drift. They are paid
         BEFORE the affection logic and through their OWN cap, because the two
         caps are different sizes and care points must not stop the moment the
         bond has had its fill for the day. Nothing else in the game calls
         `awardCare`, and a contest calls neither. */
      api.awardCare(careKindFor(kind), now);
      const b = ledger(now);
      const D = A.day;
      let amount = 0;
      let once = true;
      if (kind === 'showUp') { amount = D.showUpBonus; if (b.showedUp) amount = 0; }
      else if (kind === 'reunion') { amount = D.reunionBonus; }
      else if (kind && kind.indexOf('care:') === 0) {
        amount = D.careBonus;
        if (b.care[kind]) amount = 0;
      } else if (kind === 'toy') { amount = D.toyBonus; once = false; }
      /* A WALK IS A BONDING EVENT, not a chore — being taken out and brought
         home safe is worth more than a fetched ball and less than a whole care
         action. Repeatable (three a day is normal) and still day-capped. */
      else if (kind === 'walk') { amount = D.walkBonus; once = false; }
      /* A TRIAL IS A BONDING MOMENT AT ANY SCORE. Paid identically on a last
         place and on a win, because the thing that bonded them was doing it
         together, not the number. This is the ONLY ledger a contest touches:
         `careKindFor('contest')` resolves to a care-points value of zero. */
      else if (kind === 'contest') { amount = D.contestBonus; once = false; }
      /* TRAINING PAYS THROUGH THE SAME DAILY LEDGER as everything else, so an
         afternoon of drilling cannot outrun the day cap (stage 2's §12.1). */
      else if (kind && kind.indexOf('trick:') === 0) { amount = D.trickBonus; once = false; }
      else if (kind && kind.indexOf('learn:') === 0) {
        amount = D.learnBonus;
        if (b.care[kind]) amount = 0;   // the same once-a-day map serves both
      }
      if (!(amount > 0)) return 0;
      const dayRoom = Math.max(0, D.cap - b.earned);
      const paid = Math.min(amount, dayRoom);
      if (paid <= 0) return 0;
      b.earned += paid;
      if (kind === 'showUp') b.showedUp = true;
      if (once && kind && (kind.indexOf('care:') === 0 || kind.indexOf('learn:') === 0)) b.care[kind] = 1;
      api.addAffectionRaw(paid);
      return paid;
    },

    /** a touch after a long quiet gap starts a new petting session */
    noteTouch(now) {
      const b = ledger(now);
      const t = num(now, Date.now());
      b.sessionAt = Math.max(0, num(b.sessionAt, 0));
      if (b.sessionAt && (t - b.sessionAt) / 1000 > A.session.gapEndsSession) b.session = 0;
      b.sessionAt = t;
      /* SITTING DOWN AND ACTUALLY TOUCHING HIM IS CARE. Once a day, like the
         other care actions — it is turning up and paying attention, not a
         per-stroke drip, so it cannot be farmed by tapping. */
      api.awardCare('petSession', now);
    },
    /** what this session has earned so far (verification + debug) */
    get bondLedger() {
      const b = ledger();
      return { day: b.day, earned: +b.earned.toFixed(4), session: +b.session.toFixed(4), showedUp: !!b.showedUp };
    },

    /** kept for stage-1 callers. The fast drift lives on MOOD now, so this is
        a near-no-op unless BALANCE.affection.idleDrainPerSec is raised. */
    drainAffection(dt) {
      const d = dog();
      if (!(A.idleDrainPerSec > 0)) return d.affection;
      if (d.affection <= d.affectionFloor) return d.affection;
      return setAffection(d.affection - dt * A.idleDrainPerSec);
    },
    decayAffectionPulse(dt) {
      const d = num(dt, 0);
      if (!ok(affPulse)) { affPulse = 0; return; }
      if (d <= 0) return;
      affPulse = clampNum(affPulse + (0 - affPulse) * (1 - Math.exp(-BALANCE.ui.meter.pulseDecay * d)), 0, 1, 0);
    },

    addTrust(delta) {
      const d = dog();
      if (!Number.isFinite(+delta)) return d.trust;
      d.trust = clamp((Number.isFinite(+d.trust) ? +d.trust : 0) + (+delta), 0, 1);
      onChange();
      return d.trust;
    },

    addNeed(key, delta) {
      const d = dog();
      if (!d.needs || !(key in d.needs)) return 0;
      if (!ok(delta)) return d.needs[key];
      d.needs[key] = clampNum(num(d.needs[key], 1) + (+delta), 0, 1, 1);
      onChange();
      return d.needs[key];
    },
    /**
     * The same need on EVERY dog. `applyElapsed` and `decayLive` use this, and
     * the distinction is the whole of queue item 7: needs are physical and
     * recoverable, so they pass with time for a dog she is not looking at, and
     * a bowl of food fixes them in seconds. Freezing them made the second dog
     * a doll rather than an animal.
     *
     * THE BOND IS NOT IN HERE and must not be. Affection and trust are not
     * recoverable, which is what the ratcheting floor protects, and what "he
     * never resents her" means. Nothing in this method touches them.
     */
    addNeedAll(key, delta) {
      if (!ok(delta)) return 0;
      let n = 0;
      for (const d of state.dogs) {
        if (!d.needs || !(key in d.needs)) continue;
        d.needs[key] = clampNum(num(d.needs[key], 1) + (+delta), 0, 1, 1);
        n++;
      }
      if (n) onChange();
      return n;
    },
    /** coat gloss dulls on every dog, for the same reason */
    addGlossAll(delta) {
      if (!ok(delta)) return 0;
      for (const d of state.dogs) d.gloss = clampNum(num(d.gloss, 0.55) + (+delta), 0, 1, 0.55);
      onChange();
      return state.dogs.length;
    },
    /**
     * How long since she was last with a given dog, in hours. Falls back to the
     * app clock for a dog that predates the per-dog field, which is what
     * MIGRATIONS[7] fills in anyway — belt and braces, because this feeds the
     * reunion and a wrong answer here is a flat greeting after a fortnight.
     */
    gapHoursFor(id, now = Date.now()) {
      const d = state.dogs.find((x) => x.id === id) || dog();
      const t = num(d && d.lastSeenAt, 0) || num(state.lastSeenAt, 0) || num(now, 0);
      return Math.max(0, (num(now, Date.now()) - t) / 3600e3);
    },
    setNeed(key, v) {
      const d = dog();
      if (!d.needs || !(key in d.needs)) return 0;
      if (!ok(v)) return d.needs[key];
      d.needs[key] = clamp(+v, 0, 1);
      onChange();
      return d.needs[key];
    },
    /**
     * Fill the need a care action serves, respecting that action's ceiling —
     * the brush reaches "Clean", only the bath reaches "Beautiful".
     * @param action 'feed'|'water'|'wash'|'brush'
     */
    fillNeed(action, delta) {
      const spec = BALANCE.needs.fills[action];
      if (!spec) return 0;
      const d = dog();
      const cur = clampNum(d.needs[spec.key], 0, 1, 0);
      if (!ok(delta)) return cur;
      /* never claw back progress a better tool already made */
      const target = Math.min(Math.max(spec.max, cur), cur + (+delta));
      d.needs[spec.key] = clampNum(target, 0, 1, cur);
      onChange();
      return d.needs[spec.key];
    },
    /** how much of a bowl she will actually eat, from how hungry she is */
    appetite() {
      const P = BALANCE.needs.appetite;
      return clampNum(P.min + (1 - num(dog().needs.hunger, 1)) * P.span, 0, 1, P.min);
    },

    /* ---- coat: dirt regions + gloss --------------------------------- */
    get dirt() {
      const d = dog();
      if (!Array.isArray(d.dirt) || d.dirt.length !== DIRT_REGIONS) {
        d.dirt = new Array(DIRT_REGIONS).fill(clampNum(1 - num(d.needs.cleanliness, 1), 0, 1, 0));
      }
      return d.dirt;
    },
    /** @returns mean dirt 0..1 */
    get dirtMean() {
      const a = api.dirt;
      let s = 0;
      for (let i = 0; i < a.length; i++) s += num(a[i], 0);
      return a.length ? clampNum(s / a.length, 0, 1, 0) : 0;
    },
    setDirt(i, v) {
      const a = api.dirt;
      const idx = num(i, -1) | 0;
      if (idx < 0 || idx >= a.length) return 0;
      if (!ok(v)) return a[idx];
      a[idx] = clamp(+v, 0, 1);
      onChange();
      return a[idx];
    },
    /** spread new dirt over the coat — paid by ACTIVITY, never by the clock */
    soil(amount, rng = sharedRng) {
      if (!ok(amount)) return api.dirtMean;
      const amt = +amount;
      const a = api.dirt;
      for (let i = 0; i < a.length; i++) {
        a[i] = clampNum(num(a[i], 0) + amt * rng.range(0.45, 1.55), 0, 1, 0);
      }
      api.addNeed('cleanliness', -amt);
      onChange();
      return api.dirtMean;
    },
    /** wash/brush finished: reconcile the mask with the cleanliness word */
    syncCleanliness() {
      const d = dog();
      d.needs.cleanliness = clampNum(1 - api.dirtMean, 0, 1, d.needs.cleanliness);
      onChange();
      return d.needs.cleanliness;
    },
    get gloss() { const d = dog(); return clampNum(d.gloss, 0, 1, 0.3); },
    addGloss(delta) {
      const d = dog();
      if (!ok(delta)) return api.gloss;
      d.gloss = clampNum(api.gloss + (+delta), 0, 1, api.gloss);
      onChange();
      return d.gloss;
    },

    /* ==================================================================
       TRICKS — stage 3. Every write to what she knows goes through here.

       Three fields carry the whole design:
         reps      quality-weighted practice. Reward timing changes its value,
                   drilling one trick in one sitting damps it, and the first
                   rep on a new day is worth more. That is how "3-4 reps,
                   spread across sessions" is implemented.
         cue       WHAT SHE THINKS THE SIGNAL IS. It can be the wrong signal,
                   and the same signal can end up on the wrong trick.
         cueConf   how strongly she believes that, i.e. what patience erodes.
       ================================================================== */
    /** her record for a trick, creating it on first write. Read-only callers
        should use `trick()` which never mutates. */
    trickRecord(id) {
      const d = dog();
      if (!d.tricks || typeof d.tricks !== 'object') d.tricks = {};
      /* ONLY A REAL TRICK MAY BE RECORDED. A junk id used to create a junk
         record that persisted, showed up as a row in the cue legend, and became
         an askable entry in `repertoire()` — which stage 5's judge would then
         try to perform. Returns a detached record so callers still get an
         object to write into and simply have it discarded. */
      if (!BALANCE.train.roster.includes(id)) return newTrick();
      if (!d.tricks[id]) { d.tricks[id] = newTrick(); onChange(); }
      return d.tricks[id];
    },
    /** @returns the record, or a fresh zeroed one that is NOT stored */
    trick(id) {
      const d = dog();
      return (d.tricks && d.tricks[id]) || newTrick();
    },
    get tricks() { const d = dog(); return d.tricks || (d.tricks = {}); },
    trickLevel(id) { return api.trick(id).level | 0; },
    /** she will attempt it on a cue */
    isLearned(id) { return api.trick(id).level >= 1; },
    /** every trick she has any practice at all in */
    practised() {
      const t = api.tricks;
      return Object.keys(t).filter((id) => t[id] && t[id].reps > 0);
    },
    /** every trick she will actually perform on a cue */
    known() {
      const t = api.tricks;
      return Object.keys(t).filter((id) => t[id] && t[id].level >= 1);
    },
    /**
     * One repetition of practice.
     * @param id trick id
     * @param quality 0..1 — reward timing (BALANCE.train.reward.quality)
     * @param now epoch ms
     * @returns {{reps, level, leveledUp, weight, damped, freshDay}}
     */
    trickRep(id, quality, now) {
      const L = BALANCE.train.learn;
      const t = api.trickRecord(id);
      const when = num(now, Date.now());
      const today = dayIndex(when);
      /* self-heal a rep count that a previous build may have poisoned: `reps`
         is the field that carries every trick's progress, and a NaN in it reads
         to the player as the dog having forgotten everything. */
      t.reps = Math.max(0, num(t.reps, 0));
      t.sessReps = Math.max(0, num(t.sessReps, 0));
      t.sessAt = Math.max(0, num(t.sessAt, 0));
      /* a long enough gap and this is a new sitting, so full-value reps again */
      if (!t.sessAt || (when - t.sessAt) / 1000 > L.sessionGap) t.sessReps = 0;
      const freshDay = t.dayAt !== today;
      /* a nonsense quality is worth the "missed the window" value, not NaN and
         not a free full-value rep */
      let w = clampNum(quality, 0, 1.5, BALANCE.train.reward.quality.none);
      let damped = false;
      /* DRILLING ONE TRICK IN ONE SITTING IS INEFFICIENT — she gets bored, and
         this is what spreads learning across sessions without ever requiring a
         long one. */
      if (t.sessReps >= L.sessionSoft) { w *= L.sessionDamp; damped = true; }
      /* ...and sleeping on it helps */
      if (freshDay) w *= L.newDayBonus;
      const before = t.level;
      t.reps = Math.max(0, t.reps + w);
      t.level = trickLevelFromReps(t.reps);
      t.sessReps++;
      t.sessAt = when;
      t.dayAt = today;
      t.lastAt = when;
      if (t.level >= 1 && !t.learnedAt) t.learnedAt = when;
      onChange();
      return {
        reps: +t.reps.toFixed(3), level: t.level, leveledUp: t.level > before,
        weight: +w.toFixed(3), damped, freshDay,
      };
    },
    /**
     * Bind a cue to a trick. `conf` starts lower for a mis-association, which
     * is why a wrong idea is easier to talk her out of than a right one.
     */
    bindCue(id, sig, conf) {
      const t = api.trickRecord(id);
      /* only a real signal slot may ever be bound: a typo'd or undefined `sig`
         would otherwise create a cue nothing can trigger and nothing can clear,
         which reads as him having permanently forgotten the trick */
      if (sig && !BALANCE.train.signal.ids.includes(sig)) return t.cue;
      t.cue = sig || '';
      t.cueConf = t.cue ? clampNum(conf, 0, 1, BALANCE.train.learn.confNew) : 0;
      onChange();
      return t.cue;
    },
    /** reinforce or erode a binding. Clears the cue once she stops believing it. */
    nudgeCueConf(id, delta) {
      const t = api.trickRecord(id);
      if (!t.cue) return 0;
      if (!ok(delta)) return clampNum(t.cueConf, 0, 1, 0);
      t.cueConf = clampNum(num(t.cueConf, 0) + (+delta), 0, 1, 0);
      if (t.cueConf <= BALANCE.train.recover.clearAt) {
        /* she has stopped thinking that signal means this. The PRACTICE stays:
           she still knows how to do it, she just no longer has a word for it. */
        t.cue = ''; t.cueConf = 0;
      }
      onChange();
      return t.cueConf;
    },
    forgetCue(id) {
      const t = api.trickRecord(id);
      t.cue = ''; t.cueConf = 0;
      onChange();
    },
    /** every trick that currently believes `sig` is its cue */
    tricksForCue(sig) {
      const t = api.tricks;
      return Object.keys(t).filter((id) => t[id] && t[id].cue === sig);
    },
    cueFor(id) { return api.trick(id).cue || ''; },
    /** lifetime ask/obey tally — stage 5 reads this, and so does the debug */
    noteAsk(id, ok) {
      const t = api.trickRecord(id);
      t.asked++;
      if (ok) t.ok++;
      onChange();
      return t;
    },
    /** WORDS, NEVER BARS — for both of these (SCOPE principle 2) */
    describeTrickLevel(id) {
      const t = api.trick(id);
      const scale = BALANCE.train.words.level;
      const v = t.level > 0 ? t.level : (t.reps > 0 ? 0.5 : 0);
      for (const [at, word] of scale) if (v >= at) return word;
      return scale[scale.length - 1][1];
    },
    describeCueConf(id) {
      const t = api.trick(id);
      for (const [at, word] of BALANCE.train.words.conf) if (t.cueConf >= at) return word;
      return '';
    },
    /* ---- the words he has learned (opt-in extra; empty is the normal case)
       A word is remembered against a SIGNAL SLOT, not against a trick, so a
       spoken cue resolves through exactly the same `cue -> trick` table a hand
       signal does — which means mis-association, ambiguity and recovery all
       have one implementation and voice can never drift out of step with tap.
       `alts` keeps a few different sayings so recognition wobble is tolerated;
       an empty map is the normal, complete, tap-only game. ---------------- */
    get cueVoice() {
      const d = dog();
      if (!d.cueVoice || typeof d.cueVoice !== 'object' || Array.isArray(d.cueVoice)) d.cueVoice = {};
      return d.cueVoice;
    },
    /** @returns the remembered word for a signal slot, or '' */
    wordFor(sig) {
      const r = api.cueVoice[sig];
      return (r && typeof r === 'object' && typeof r.word === 'string') ? r.word : '';
    },
    /** every signal slot that has a word attached */
    spokenCues() {
      const m = api.cueVoice;
      return Object.keys(m).filter((k) => api.wordFor(k));
    },
    /**
     * Remember a word for a cue slot. The newest saying wins as the canonical
     * one and the previous few are kept as alternates, so "sit" and a slightly
     * mangled "set" both still find it.
     * @returns the stored record, or null if there was nothing usable
     */
    learnWord(sig, word) {
      const w = String(word == null ? '' : word).toLowerCase().trim();
      if (!sig || !w) return null;
      const map = api.cueVoice;
      const cur = map[sig];
      const alts = [];
      if (cur && typeof cur === 'object') {
        if (cur.word && cur.word !== w) alts.push(cur.word);
        for (const a of (Array.isArray(cur.alts) ? cur.alts : [])) {
          if (a && a !== w && alts.indexOf(a) < 0) alts.push(a);
        }
      }
      map[sig] = {
        word: w,
        alts: alts.slice(0, Math.max(0, BALANCE.train.voice.maxAlts - 1)),
        n: ((cur && cur.n) | 0) + 1,
      };
      onChange();
      return map[sig];
    },
    forgetWord(sig) {
      const m = api.cueVoice;
      if (m[sig]) { delete m[sig]; onChange(); }
    },
    clearVoice() { const d = dog(); d.cueVoice = {}; onChange(); },

    /* ==================================================================
       WALKS — stage 4. The offline-safe model itself lives in
       state/walks.js (pure functions, no tick); these are the MUTATORS, so
       nothing outside this file writes `state.walks`, `inventory` or
       `unlocks` for a walk. Needs, dirt, mood, affection and trust still go
       through the existing ratcheted mutators above — a walk is not allowed
       its own back door into them.
       ================================================================== */
    /** the repaired walks block (day boundary checked on every read) */
    get walks() { return walkState(state); },
    /** the walk he is on right now, or null */
    get walkActive() { return walkState(state).active; },
    get walksToday() { return walkState(state).walksToday; },
    get walksTotal() { return walkState(state).total; },
    /** he has already had a good few today — thins the finds, never refuses */
    get walkedEnoughToday() { return walkState(state).walksToday >= BALANCE.walk.perDay; },
    /**
     * Set off. @param opts {mix|route, dur, path, rng, now}
     * @returns the active record
     */
    startWalk(opts = {}) {
      const a = startWalkModel(state, opts);
      api.log('walk', 'set off for the ' + a.route);
      onChange();
      return a;
    },
    /** where the walk has got to — the ONLY progress function */
    walkProgress(now) { return walkProgressModel(state, num(now, Date.now())); },
    /** roll (deterministically) what he is bringing home at this progress */
    walkFinds(progress, now) {
      const p = walkProgressModel(state, num(now, Date.now()));
      if (!p.active) return { finds: [], coins: 0, route: '', mix: {} };
      const at = progress === undefined ? p.progress : clampNum(progress, 0, 1, p.progress);
      return rollFinds(p.active, at, { owned: collectedFinds(state) });
    },
    /** bank the walk: clears `active`, bumps `walksToday` at local midnight */
    endWalk(now) {
      const done = endWalkModel(state, num(now, Date.now()));
      onChange();
      return done;
    },
    cancelWalk() { cancelWalkModel(state); onChange(); },

    /**
     * He brought something home. THIS is where a find becomes a real unlock:
     *   - it joins the dated collection log (`walks.found`, capped)
     *   - the first of its kind joins `unlocks.items`, which is what the room
     *     shelf displays, so the collection is visible in the world
     *   - a `toy` find joins `inventory.toys` AND becomes the toy on the rug,
     *     so what he found is what he now fetches
     * @returns {{id, fresh, unlockedToy}} or null for a junk id
     */
    addFind(find, now) {
      const id = typeof find === 'string' ? find : (find && find.id);
      const spec = FIND_BY_ID[id];
      if (!spec) return null;                       // never persist a junk find
      const w = walkState(state);
      const t = num(now, Date.now());
      if (!state.unlocks || typeof state.unlocks !== 'object') state.unlocks = { breeds: [], items: [], rooms: ['room'] };
      if (!Array.isArray(state.unlocks.items)) state.unlocks.items = [];
      if (!state.inventory || typeof state.inventory !== 'object') state.inventory = {};
      if (!Array.isArray(state.inventory.toys) || !state.inventory.toys.length) state.inventory.toys = ['ball'];

      const fresh = state.unlocks.items.indexOf(id) < 0;
      if (fresh) state.unlocks.items.push(id);
      w.found.push({ at: t, id, route: (find && find.route) || (w.active ? w.active.route : '') });
      while (w.found.length > BALANCE.walk.find.logCap) w.found.shift();

      let unlockedToy = '';
      if (spec.toy && state.inventory.toys.indexOf(spec.toy) < 0) {
        state.inventory.toys.push(spec.toy);
        unlockedToy = spec.toy;
      }
      /* whatever he just carried in is what he wants thrown */
      if (spec.toy) state.inventory.activeToy = spec.toy;

      /* ---- IT GOES OUT ON THE SILL, IF THERE IS ROOM (queue item 6) ------
         A new thing should be somewhere she can see it without her having to
         go and arrange it — the beat is "he brought something home", and an
         invisible reward is the inert-unlock mistake stage 6 already paid for
         (ARCHITECTURE 17.5). But it never PUSHES anything off: once the sill
         is full, the newest finds wait in the box until she makes room, which
         is what stops the room filling up on its own. */
      if (fresh && isShelvable(id)) {
        if (!Array.isArray(w.display)) w.display = [];
        if (w.display.indexOf(id) < 0 && w.display.length < BALANCE.walk.find.onShow) {
          w.display.push(id);
        }
      }
      onChange();
      return { id, fresh, unlockedToy };
    },
    /** every distinct thing he has ever brought home */
    findCollection() { return collectedFinds(state); },

    /* ==================================================================
       THE COLLECTION — WHAT IS OUT, WHAT IS PUT AWAY, AND WHO HE HAS MET

       Queue item 6. Three answers to "what is this find FOR":
         a toy    he fetches it (already true — `inventory.toys`)
         a photo  it is a dog he met, and the album says so (`album()`)
         anything else  it is nice to look at, and she decides whether it is
                        out on the sill or in the box (`display`)
       and a duplicate of any of them is coins (state/walks.js `rollFinds`).
       ================================================================== */
    /** what is standing on the sill right now, in her order */
    onShow() {
      const w = walkState(state);
      const owned = collectedFinds(state);
      if (!Array.isArray(w.display)) w.display = [];
      /* filtered through what she actually owns, so an imported or edited save
         cannot put a thing on the shelf that was never found */
      return w.display.filter((id) => owned.has(id) && isShelvable(id))
        .slice(0, BALANCE.walk.find.onShow);
    },
    /** everything she owns that COULD stand on the sill but is not out */
    inBox() {
      const out = new Set(api.onShow());
      return Array.from(collectedFinds(state))
        .filter((id) => isShelvable(id) && !out.has(id));
    },
    /** the dogs he has met, newest first — the album */
    album() {
      return metDogs(state).sort((a, b) => (b.at || 0) - (a.at || 0));
    },
    /**
     * Put something out, or put it away. One method, because it is one
     * decision, and it returns what actually happened rather than a boolean:
     * a full sill is not a failure, it is a thing she needs told.
     * @returns {{ok, out, full}}
     */
    setOnShow(id, out) {
      const w = walkState(state);
      if (!Array.isArray(w.display)) w.display = [];
      if (!isShelvable(id) || !collectedFinds(state).has(id)) return { ok: false, out: false, full: false };
      const at = w.display.indexOf(id);
      if (out) {
        if (at >= 0) return { ok: true, out: true, full: false };
        if (w.display.length >= BALANCE.walk.find.onShow) return { ok: false, out: false, full: true };
        w.display.push(id);
      } else {
        if (at < 0) return { ok: true, out: false, full: false };
        w.display.splice(at, 1);
      }
      onChange();
      return { ok: true, out: !!out, full: false };
    },
    get activeToy() {
      const inv = state.inventory || {};
      const id = typeof inv.activeToy === 'string' ? inv.activeToy : 'ball';
      return (Array.isArray(inv.toys) && inv.toys.indexOf(id) >= 0) ? id : 'ball';
    },
    setActiveToy(id) {
      const inv = state.inventory || (state.inventory = {});
      if (!Array.isArray(inv.toys)) inv.toys = ['ball'];
      if (typeof id !== 'string' || inv.toys.indexOf(id) < 0) return api.activeToy;
      inv.activeToy = id;
      onChange();
      return id;
    },

    /* ==================================================================
       THE ECONOMY — TWO CURRENCIES, AND THE SEPARATION IS THE DESIGN

       COINS       skill and luck. Contest placings, selling walk finds.
                   Spend on toys, treats, care tools, collars, decor.
       CARE POINTS attentiveness. Earned ONLY by looking after him. They buy
                   NOTHING. They are the only thing that unlocks a breed, a
                   room or a piece of shop stock.

       "Money is skill and luck; points are attentiveness. She cannot buy her
       way to the Cockapoo, and she cannot grind contests for a new rug."
       (SCOPE stage 5, research §7.)

       THAT SEPARATION IS ENFORCED BY THERE BEING NO CODE TO BREAK IT:
         - there is no `spendCarePoints`, and there must never be one;
         - there is no exchange function in either direction;
         - `spendCoins` touches `coins` and nothing else;
         - `awardCare` touches `carePoints` and nothing else;
         - `careUnlocks()` reads `carePoints` and NEVER reads `coins`.
       A stage-6 shop that wants to sell an unlock is asking for the one thing
       this stage exists to prevent. Sell OBJECTS for coins; gate CONTENT on
       care points.
       ================================================================== */
    get coins() { return Math.max(0, Math.floor(num(state.player.coins, 0))); },
    addCoins(n) {
      const cur = api.coins;
      state.player.coins = cur;
      if (!ok(n)) return cur;
      state.player.coins = Math.max(0, Math.floor(cur + (+n)));
      onChange();
      return state.player.coins;
    },
    /** can she afford this? A pure question — nothing is written. */
    canAfford(n) {
      const cost = Math.max(0, Math.floor(num(n, 0)));
      return api.coins >= cost;
    },
    /**
     * Spend coins. THE MUTATOR ARCHITECTURE §14.2 ASKED FOR.
     *
     * Refuses rather than clamps, for the same reason every other mutator in
     * this file rejects instead of coercing: a purchase that silently went
     * through at a different price, or took the balance to zero because the
     * cost was NaN, is a bug the player pays for. A refusal is a no-op the
     * caller can see.
     *
     * @param n a non-negative integer cost
     * @returns {{ ok, coins, spent, short }} — `short` is how much she is
     *   missing, so a shop can say "82 more" rather than "no"
     */
    spendCoins(n) {
      const cur = api.coins;
      state.player.coins = cur;
      /* STRICTER THAN `ok()` ON PURPOSE, AND A GATE CAUGHT WHY. `ok()` coerces
         before testing, so `+null` and `+''` are both a finite 0 — which meant
         `spendCoins(null)` returned `{ok:true, spent:0}` and a shop with a
         missing price handed the item over for free. Money is the one field
         where a coercion is worse than a refusal, so this demands a real
         number and rejects everything else outright. */
      if (typeof n !== 'number' || !Number.isFinite(n)) {
        return { ok: false, coins: cur, spent: 0, short: 0 };
      }
      const cost = Math.floor(n);
      /* a NEGATIVE cost is not a refund. Refunds go through addCoins, where
         they are visible; a negative spend is a caller bug and would be a
         money printer. */
      if (cost < 0) return { ok: false, coins: cur, spent: 0, short: 0 };
      if (cost === 0) return { ok: true, coins: cur, spent: 0, short: 0 };
      if (cost > cur) return { ok: false, coins: cur, spent: 0, short: cost - cur };
      state.player.coins = cur - cost;
      onChange();
      return { ok: true, coins: state.player.coins, spent: cost, short: 0 };
    },

    /* ---- care points ------------------------------------------------- */
    get carePoints() { return Math.max(0, Math.floor(num(state.player.carePoints, 0))); },
    /** raw, unledgered — for migrations and tests only */
    addCarePoints(n) {
      const cur = api.carePoints;
      state.player.carePoints = cur;
      if (!ok(n)) return cur;
      state.player.carePoints = Math.max(0, Math.floor(cur + (+n)));
      onChange();
      return state.player.carePoints;
    },
    /** the daily care ledger, repaired and day-rolled on every read */
    careLedger(now) {
      const p = state.player || (state.player = {});
      if (!p.careDay || typeof p.careDay !== 'object') p.careDay = { day: -1, earned: 0, once: {} };
      const L = p.careDay;
      L.earned = Math.max(0, num(L.earned, 0));
      if (!L.once || typeof L.once !== 'object') L.once = {};
      const today = dayIndex(num(now, Date.now()));
      /* the same NaN trap the bond ledger fell into: `NaN !== NaN`, so an
         unguarded bad clock rolls the day over on EVERY call and uncaps the
         cap the whole anti-grind design rests on */
      if (Number.isFinite(today) && L.day !== today) {
        L.day = today; L.earned = 0; L.once = {};
        onChange();
      }
      if (!Number.isFinite(L.day)) L.day = Number.isFinite(today) ? today : 0;
      return L;
    },
    /**
     * Pay care points for an act of care, through the daily ledger.
     *
     * @param kind 'showUp' | 'reunion' | 'petSession' | 'toy' | 'walk' |
     *             'trick' | 'contest' | 'care:feed|water|wash|brush'
     *   `contest` is in the table AT ZERO, on purpose: a placing is skill, and
     *   skill does not unlock content. Calling it is legal and pays nothing,
     *   which is the separation stated as a number rather than as a comment.
     * @returns the points actually paid
     */
    awardCare(kind, now) {
      if (typeof kind !== 'string' || !kind) return 0;
      const E = BALANCE.economy.care;
      const L = api.careLedger(now);
      const key = kind.indexOf('care:') === 0 ? kind.slice(5) : kind;
      const amount = num(E[key], -1);
      if (amount < 0) return 0;                       // not a kind we pay for
      /* the once-a-day set: the four care actions, showing up, the greeting
         and a petting session. Walks, toys and training reps are repeatable. */
      const once = key === 'showUp' || key === 'reunion' || key === 'petSession'
        || key === 'feed' || key === 'water' || key === 'wash' || key === 'brush';
      if (once && L.once[key]) return 0;
      const room = Math.max(0, E.dayCap - L.earned);
      const paid = Math.min(amount, room);
      if (paid <= 0) return 0;
      L.earned += paid;
      if (once) L.once[key] = 1;
      api.addCarePoints(paid);
      return paid;
    },
    /** what today has earned (verification + debug) */
    get careToday() {
      const L = api.careLedger();
      return { day: L.day, earned: L.earned, cap: BALANCE.economy.care.dayCap, once: { ...L.once } };
    },
    /**
     * What her care has unlocked, and what is next.
     *
     * READS `carePoints` AND NOTHING ELSE. There is deliberately no `coins`
     * anywhere in this function — that is the demonstration that a fortune
     * cannot buy the Cockapoo, and it is the thing a stage-6 kennel must not
     * work around.
     */
    careUnlocks() {
      const pts = api.carePoints;
      const table = BALANCE.economy.unlocks;
      const unlocked = table.filter((u) => pts >= u.at);
      const next = table.find((u) => pts < u.at) || null;
      return {
        points: pts,
        unlocked: unlocked.map((u) => ({ ...u })),
        next: next ? { ...next, short: next.at - pts } : null,
        word: api.describeCare(),
      };
    },
    /** is this care-gated id unlocked? Coins can never make this true. */
    isUnlocked(id) {
      const u = BALANCE.economy.unlocks.find((x) => x.id === id);
      if (!u) return false;
      return api.carePoints >= u.at;
    },
    /** WORDS, NEVER A BAR — what her care says about her, not a score */
    describeCare() {
      const pts = api.carePoints;
      for (const [at, word] of BALANCE.economy.careWords) if (pts >= at) return word;
      return BALANCE.economy.careWords[BALANCE.economy.careWords.length - 1][1];
    },

    /** DEPRECATED alias kept for ARCHITECTURE §11.2's published surface. The
        currency was renamed to `carePoints` in schema v5 because "trainer
        points" describes the wrong thing: they are not earned by training. */
    addTrainerPoints(n) { return api.addCarePoints(n); },

    /* ==================================================================
       THE SHOP — stage 6. COINS BUY OBJECTS. THAT IS ALL THIS DOES.

       `buyItem` is the only way anything enters the inventory, and it is
       where the one absolute rule is ENFORCED rather than trusted:

         1. the id must be in BALANCE.economy.shop.items — you cannot buy
            something that is not for sale, including by id-guessing an
            unlock;
         2. the id must NOT be in BALANCE.economy.unlocks — a care unlock is
            not purchasable at any price, and `ITEM_IS_UNLOCK` below refuses
            it before a single coin moves;
         3. a row's `needs` (a care unlock) must already be EARNED. Coins
            cannot satisfy it, because the check reads `isUnlocked`, which
            reads `carePoints` and nothing else.

       Stage 5 proved the currencies were separate by there being no code to
       break it. This is the code, and it still cannot.
       ================================================================== */
    /** the catalogue row for an id, or null */
    shopItem(id) {
      if (typeof id !== 'string' || !id) return null;
      return BALANCE.economy.shop.items.find((x) => x.id === id) || null;
    },
    /** does this id name a CARE unlock? Then coins may never touch it. */
    isCareUnlockId(id) {
      return !!BALANCE.economy.unlocks.find((x) => x.id === id);
    },
    /**
     * The shop's shelf, resolved. `locked` is a CARE gate, never a coin one:
     * `afford` and `locked` are computed from different currencies and are
     * reported separately so a surface can never conflate them.
     */
    shopStock() {
      const S = BALANCE.economy.shop;
      return S.items.map((it) => {
        const need = it.needs || '';
        const locked = need ? !api.isUnlocked(need) : false;
        const owned = api.ownedCount(it.id);
        const cap = it.kind === 'treat' ? S.maxTreats : 1;
        return {
          ...it,
          owned,
          full: owned >= cap,
          locked,
          /* what the row needs from her CARE, if anything */
          needsAt: locked ? (BALANCE.economy.unlocks.find((u) => u.id === need) || {}).at || 0 : 0,
          needsShort: locked
            ? Math.max(0, ((BALANCE.economy.unlocks.find((u) => u.id === need) || {}).at || 0) - api.carePoints)
            : 0,
          /* ...and what it needs from her PURSE. Two numbers, never one. */
          afford: api.canAfford(it.cost),
          short: Math.max(0, Math.floor(num(it.cost, 0)) - api.coins),
        };
      });
    },
    /** how many of a shop id she owns (0 or 1 for anything not a treat) */
    ownedCount(id) {
      const it = api.shopItem(id);
      if (!it) return 0;
      const inv = invOf();
      if (it.kind === 'treat') return Math.max(0, Math.floor(num(inv.food[id], 0)));
      if (it.kind === 'toy') return inv.toys.indexOf(id) >= 0 ? 1 : 0;
      if (it.kind === 'wear') return inv.accessories.indexOf(id) >= 0 ? 1 : 0;
      return Math.max(0, Math.floor(num(inv.care[id], 0)));
    },
    /** does she own this care tool? (dog/care.js asks) */
    hasTool(id) { return api.ownedCount(id) > 0; },

    /**
     * Buy one. Hardened to the §13.4 standard: a bad argument is a REFUSAL,
     * never a free item — `spendCoins(null)` once handed goods over for
     * nothing because `+null` is 0, and this is the caller that would have
     * done it.
     *
     * @returns {{ ok, reason, short, item, coins, owned }}
     *   reason: '' | 'unknown' | 'unlock' | 'locked' | 'full' | 'poor'
     */
    buyItem(id) {
      const fail = (reason, extra) => ({
        ok: false, reason, short: 0, item: null, coins: api.coins, owned: 0, ...(extra || {}),
      });
      /* RULE 2 FIRST, before anything else can go wrong: a care unlock is not
         for sale. This is checked ahead of the catalogue lookup on purpose —
         if an unlock id ever appeared in the shop table by mistake, this
         still refuses it. */
      if (api.isCareUnlockId(id)) return fail('unlock');
      const it = api.shopItem(id);
      if (!it) return fail('unknown');
      const cost = Math.floor(num(it.cost, NaN));
      if (!Number.isFinite(cost) || cost < 0) return fail('unknown');
      /* RULE 3: a care gate. Reads carePoints; cannot be paid off. */
      if (it.needs && !api.isUnlocked(it.needs)) {
        const u = BALANCE.economy.unlocks.find((x) => x.id === it.needs) || { at: 0 };
        return fail('locked', { needsShort: Math.max(0, u.at - api.carePoints) });
      }
      const S = BALANCE.economy.shop;
      const cap = it.kind === 'treat' ? Math.max(1, Math.floor(num(S.maxTreats, 1))) : 1;
      const owned = api.ownedCount(id);
      if (owned >= cap) return fail('full', { owned });
      const pay = api.spendCoins(cost);
      if (!pay.ok) return fail('poor', { short: pay.short });

      const inv = invOf();
      if (it.kind === 'treat') {
        const give = Math.max(1, Math.floor(num(it.give, 1)));
        inv.food[id] = Math.min(cap, owned + give);
      } else if (it.kind === 'toy') {
        if (inv.toys.indexOf(id) < 0) inv.toys.push(id);
      } else if (it.kind === 'wear') {
        if (inv.accessories.indexOf(id) < 0) inv.accessories.push(id);
      } else {
        inv.care[id] = 1;
      }
      /* `unlocks.items` is the lifetime record of what she has ever owned, so
         a consumable that runs out is still remembered */
      if (state.unlocks.items.indexOf(id) < 0) state.unlocks.items.push(id);
      onChange();
      return { ok: true, reason: '', short: 0, item: { ...it }, coins: api.coins, owned: api.ownedCount(id) };
    },

    /**
     * Give him a treat. A count comes off the inventory and he gets a mood
     * lift — and NOT ONE CARE POINT, which is the separation from the other
     * direction: pleasing him is not the same as looking after him, and a
     * player with coins must not be able to buy her way up the care scale.
     */
    giveTreat(id) {
      const it = api.shopItem(id);
      if (!it || it.kind !== 'treat') return { ok: false, reason: 'unknown', left: 0 };
      const inv = invOf();
      const have = Math.max(0, Math.floor(num(inv.food[id], 0)));
      if (have <= 0) return { ok: false, reason: 'none', left: 0 };
      inv.food[id] = have - 1;
      const T = BALANCE.economy.shop.treat;
      const lift = num(id === 'treatGood' ? T.goodMood : T.plainMood, 0.2);
      api.addMood(lift);
      /* deliberately no awardCare(...) call of any kind here */
      onChange();
      return { ok: true, reason: '', left: inv.food[id], mood: lift };
    },

    /** how many treats of any kind she has to hand */
    get treatsLeft() {
      const inv = invOf();
      return BALANCE.economy.shop.items
        .filter((x) => x.kind === 'treat')
        .reduce((n, x) => n + Math.max(0, Math.floor(num(inv.food[x.id], 0))), 0);
    },

    /**
     * Put something on his collar slot. Accepts a bought accessory OR an
     * EARNED one (`collarRed` is a care unlock, not a purchase), which is why
     * this checks both sources — and why buying can never produce the earned
     * one and earning can never produce a bought one.
     */
    wearable() {
      const inv = invOf();
      const out = [{ id: '', name: 'Nothing', from: 'none' }];
      for (const u of BALANCE.economy.unlocks) {
        if (u.kind === 'wear' && api.isUnlocked(u.id)) out.push({ id: u.id, name: u.name, from: 'earned' });
      }
      for (const id of inv.accessories) {
        const it = api.shopItem(id);
        if (it) out.push({ id, name: it.name, from: 'bought' });
      }
      return out;
    },
    /** @returns true if it was applied */
    equipWear(id) {
      const d = dog();
      if (!d.wear || typeof d.wear !== 'object') d.wear = { collar: null, accessory: null };
      if (id === '' || id === null || id === undefined) { d.wear.collar = null; onChange(); return true; }
      if (typeof id !== 'string') return false;
      if (!api.wearable().some((w) => w.id === id)) return false;
      d.wear.collar = id;
      onChange();
      return true;
    },
    get worn() {
      const d = dog();
      return (d.wear && typeof d.wear.collar === 'string') ? d.wear.collar : '';
    },

    /* ==================================================================
       THE KENNEL — stage 6. CARE POINTS ONLY, AND NO PRICE ANYWHERE.
       ================================================================== */
    /** the roster, with just enough for a surface to draw a card each */
    roster() {
      return state.dogs.map((d) => ({
        id: d.id, name: d.name, breedId: d.breedId, sex: d.sex,
        active: d.id === state.activeDogId,
        affection: num(d.affection, 0),
        worn: (d.wear && typeof d.wear.collar === 'string') ? d.wear.collar : '',
        pron: PRONOUNS[d.sex] || PRONOUNS.n,
      }));
    },
    /**
     * May she adopt right now, and if not, exactly what is missing? `reason`
     * is never 'poor' — there is no price. The only thing that can be short
     * here is care points.
     */
    adoptCheck() {
      const K = BALANCE.economy.kennel;
      const u = BALANCE.economy.unlocks.find((x) => x.id === K.adoptId) || { at: 0, name: '' };
      const pts = api.carePoints;
      if (state.dogs.length >= Math.max(1, Math.floor(num(K.max, 2)))) {
        return { ok: false, reason: 'full', short: 0, at: u.at, points: pts };
      }
      if (state.dogs.some((d) => d.breedId === K.adoptBreed)) {
        return { ok: false, reason: 'already', short: 0, at: u.at, points: pts };
      }
      if (!api.isUnlocked(K.adoptId)) {
        return { ok: false, reason: 'locked', short: Math.max(0, u.at - pts), at: u.at, points: pts };
      }
      return { ok: true, reason: '', short: 0, at: u.at, points: pts };
    },
    /**
     * Adopt her. SPENDS NOTHING — not coins, and not care points either.
     * Care points are a lifetime total that gates content; they are not a
     * balance and there is deliberately no `spendCarePoints` anywhere in this
     * file. Passing the gate does not consume it, so she keeps the standing
     * she earned and the unlock is permanent (ARCHITECTURE §15.6).
     *
     * @returns the new dog's public shape, or null if refused
     */
    adoptDog(now = Date.now(), opts = {}) {
      const chk = api.adoptCheck();
      if (!chk.ok) return null;
      const K = BALANCE.economy.kennel;
      /* ids are derived from the clock and the first dog took `dog-<t36>`, so a
         same-millisecond adopt would collide. Suffix until it does not. */
      const d = newDog(num(now, Date.now()), {
        breedId: K.adoptBreed, sex: K.adoptSex, name: '', rng: opts.rng,
      });
      let n = 1;
      while (state.dogs.some((x) => x.id === d.id)) { d.id = 'dog-' + num(now, 0).toString(36) + '-' + (++n); }
      state.dogs.push(d);
      if (state.unlocks.breeds.indexOf(d.breedId) < 0) state.unlocks.breeds.push(d.breedId);
      state.flags.adoptedAt = num(now, Date.now());
      onChange();
      return { id: d.id, name: d.name, breedId: d.breedId, sex: d.sex };
    },
    /**
     * Make another dog the one in the room. The CALLER remounts the scene —
     * scenes/room.js builds the rig, the renderer, petting, idle and every
     * care layer from `game.dog` in `enter()`, so a remount is how a different
     * breed and a different set of needs actually arrive. Mutating the id
     * under a live scene would leave a Shiba rig wearing a Cockapoo's state.
     */
    switchDog(id, now = Date.now()) {
      if (typeof id !== 'string' || !id) return false;
      if (id === state.activeDogId) return false;
      if (!state.dogs.some((d) => d.id === id)) return false;
      /* STAMP THE DOG SHE IS LEAVING, and only him. His gap starts here; the
         incoming dog's gap is still running and is read by scenes/room.js on
         the remount, which is what decides whether he gets a reunion or a
         quiet hello. Stamping the arrival here would destroy the very number
         the greeting is chosen from. */
      const leaving = dog();
      if (leaving) leaving.lastSeenAt = num(now, Date.now());
      state.activeDogId = id;
      onChange();
      return true;
    },

    /* ==================================================================
       CONTESTS — stage 5. The MODEL is state/contest.js (pure, testable);
       these are the mutators, so nothing outside this file writes
       `state.contests`. Coins are paid through `addCoins`, the bond through
       `awardDay`, and CARE POINTS ARE NOT PAID AT ALL.
       ================================================================== */
    /** the repaired obedience record (day boundary checked on every read) */
    get contest() { return contestState(state); },
    /** the class he is in, as data */
    contestClass() {
      const r = contestState(state);
      const c = classAt(r.classIdx);
      return {
        ...c, index: r.classIdx, top: isTop(r.classIdx),
        entries: r.entries, wins: r.wins, best: r.best, won: !!r.won,
        standing: champStanding(r.champScores),
      };
    },
    /** entries left today. Past zero a trial is a PRACTICE ROUND, not a wall. */
    get contestEntriesLeft() {
      return Math.max(0, BALANCE.contest.perDay - contestState(state).entriesToday);
    },
    /**
     * Bank a finished trial.
     *
     * @param o { score, placing, prize, practice, promoted, won }
     * @returns what actually changed, for the result card and the harness
     */
    recordContest(o = {}, now) {
      const r = contestState(state, num(now, Date.now()));
      const score = clampNum(o.score, 0, 10, 0);
      const placing = Math.max(1, Math.round(num(o.placing, 99)));
      const practice = !!o.practice;
      const before = r.classIdx;

      r.lastEntryAt = num(now, Date.now());
      if (score > r.best) r.best = score;

      /* A PRACTICE ROUND CHANGES NOTHING BUT THE BEST SCORE. Past the daily
         cap the ring is quiet, not closed: she still gets a whole trial and a
         real number, it simply does not pay or promote. That is pacing; a
         refusal would be a wall she hits and resents. */
      if (practice) {
        onChange();
        return {
          score, placing, practice: true, prize: 0, promoted: false,
          classIdx: r.classIdx, wasClassIdx: before, won: false,
        };
      }

      r.entries++;
      r.entriesToday++;
      if (placing === 1) r.wins++;

      /* the Championship standing is measured over the last few TOP-CLASS
         scores only — a Beginner 9.8 is not a Championship average */
      let won = false;
      if (isTop(before)) {
        r.champScores.push(score);
        while (r.champScores.length > BALANCE.contest.champion.holdWindow) r.champScores.shift();
        if (o.won) { won = !r.won; r.won = true; }
      }

      /* PROMOTION ONLY. THERE IS NO DEMOTION AT ANY SCORE, EVER. */
      let promoted = false;
      if (o.promoted && !isTop(before)) { r.classIdx = before + 1; promoted = true; }

      const prize = Math.max(0, Math.floor(num(o.prize, 0)));
      if (prize > 0) api.addCoins(prize);
      /* AND NOT ONE CARE POINT. See the block comment above `get coins`. */

      api.log('contest', 'scored ' + score.toFixed(2) + ' in ' + classAt(before).name);
      onChange();
      return {
        score, placing, practice: false, prize, promoted,
        classIdx: r.classIdx, wasClassIdx: before, won,
        standing: champStanding(r.champScores),
      };
    },

    /* a non-string key would land on the object as "undefined" and then be
       persisted forever, so both of these refuse one */
    setFlag(key, v) {
      if (typeof key !== 'string' || !key) return;
      if (!state.flags || typeof state.flags !== 'object') state.flags = {};
      state.flags[key] = v; onChange();
    },
    setSetting(key, v) {
      if (typeof key !== 'string' || !key) return;
      if (!state.settings || typeof state.settings !== 'object') state.settings = {};
      state.settings[key] = v; onChange();
    },

    /* ---- the name ---------------------------------------------------
       She arrives unnamed and *she* names her. A save created before naming
       is completely valid — everything below tolerates name === ''. */
    get isNamed() { const n = dog().name; return !!(n && n.trim()); },
    /** what to call her in copy when she has no name yet */
    get displayName() {
      const d = dog();
      if (d.name && d.name.trim()) return d.name.trim();
      return d.sex === 'm' ? 'the puppy' : 'the puppy';
    },
    /**
     * The active dog's pronoun set — `{they, them, their, theirs, self, is,
     * has, s}`, lowercase. NO PLAYER-FACING STRING MAY HARDCODE A PRONOUN:
     * the gift puppy is male and a later dog may not be, so copy interpolates
     * this at runtime. Use `capitalise()` for sentence starts and `P.s` for
     * verb agreement ("he sit" + P.s -> "he sits", "they sit" + '' -> "they sit").
     */
    get pron() {
      const d = dog();
      return PRONOUNS[d.sex] || PRONOUNS.n;
    },
    setName(name) {
      const d = dog();
      const clean = String(name || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, BALANCE.ui.naming.maxLen);
      if (!clean) return '';
      const first = !api.isNamed;
      d.name = clean;
      if (first) {
        state.flags.namedFirstDog = true;
        api.log('named', 'you called her ' + clean);
      } else {
        api.log('renamed', 'now called ' + clean);
      }
      onChange();
      return clean;
    },

    log(kind, note) {
      const d = dog();
      if (!Array.isArray(d.log)) d.log = [];
      d.log.push({ at: Date.now(), kind: String(kind || ''), note: String(note || '') });
      while (d.log.length > BALANCE.save.logCap) d.log.shift();
      onChange();
    },

    /**
     * SHE IS HERE, WITH THIS DOG, NOW. Stamps both clocks, because there are
     * two and they answer different questions:
     *
     *   state.lastSeenAt  when the APP was last open. Drives the offline decay
     *                     and the day boundary, for every dog equally.
     *   dog.lastSeenAt    when she was last with THIS dog. Drives the reunion,
     *                     and only advances for the dog in the room — which is
     *                     the whole of queue item 4.
     *
     * A NaN in either would make every decay, the reunion trigger and the day
     * boundary NaN at once, and it would be persisted.
     *
     * (This method was very nearly written twice. A second `markSeen` added to
     * this literal for the per-dog clock sat forty lines above and was silently
     * dead — a duplicate key in an object literal is the LAST one, with no
     * warning from anywhere, and the reunion simply never stamped. One method,
     * both clocks.)
     */
    markSeen(now = Date.now()) {
      const t = num(now, Date.now());
      if (t <= 0) return 0;
      state.lastSeenAt = t;
      const d = dog();
      if (d) d.lastSeenAt = t;
      onChange();
      return t;
    },

    /* ---- derived --------------------------------------------------- */
    /**
     * The per-frame mood bag. `mood.mood` is the FAST channel and is what
     * drives everything visible; `mood.affection` is the slow bond and is
     * never drawn. Mutated in place — do not retain it across frames.
     */
    get mood() {
      const d = dog();
      const n = d.needs;
      /* THE LAST LINE OF DEFENCE. Everything visible reads off this bag 60x a
         second, so it is guarded even though every writer above is: one NaN
         reaching a spring target makes the entire animal disappear, and a
         vanished dog is the worst possible failure mode this game has. */
      moodBag.mood = clampNum(mood, 0, 1, baseline());
      moodBag.baseline = baseline();
      moodBag.affection = clampNum(d.affection, 0, 1, 0);
      moodBag.floor = clampNum(d.affectionFloor, 0, 1, 0);
      moodBag.trust = clampNum(d.trust, 0, 1, 0);
      moodBag.needs = n;
      moodBag.wellbeing = clampNum((num(n.hunger, 1) + num(n.thirst, 1)
        + num(n.cleanliness, 1) + num(n.energy, 1)) / 4, 0, 1, 1);
      return moodBag;
    },

    /**
     * Words, not bars. Needs ARE inspectable (the original showed them);
     * affection is NOT, and there is deliberately no describeAffection().
     */
    describeNeed(key) {
      const scale = BALANCE.inspect[key];
      if (!scale) return '';
      const v = dog().needs[key];
      for (const [at, word] of scale) if (v >= at) return word;
      return scale[scale.length - 1][1];
    },
    /** the brush's own word-scale readout. Still a word, never a bar. */
    describeGloss() {
      const scale = BALANCE.inspect.gloss;
      const v = api.gloss;
      for (const [at, word] of scale) if (v >= at) return word;
      return scale[scale.length - 1][1];
    },

    /** the need that most wants attention, or '' if she's content */
    pressingNeed() {
      const d = dog();
      let worst = '', wv = BALANCE.needs.noticeAt;
      for (const k of ['hunger', 'thirst', 'cleanliness']) {
        if (d.needs[k] < wv) { wv = d.needs[k]; worst = k; }
      }
      return worst;
    },

    /** notify save.js without changing anything (used after time decay) */
    touch() { onChange(); },
  };

  return api;
}

export default createGame;
