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
import { getBreed } from '../dog/breeds.js';
import { rng as sharedRng } from '../engine/rng.js';
import { dayIndex } from './time.js';
import {
  walkState, startWalk as startWalkModel, walkProgress as walkProgressModel,
  endWalk as endWalkModel, cancelWalk as cancelWalkModel, rollFinds,
  collected as collectedFinds, FIND_BY_ID,
} from './walks.js';

export const SCHEMA_VERSION = 4;

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
  const breed = getBreed(breedId);
  const jitter = () => clamp(rng.range(-0.12, 0.12), -0.12, 0.12);
  return {
    id: 'dog-' + now.toString(36),
    name, breedId, sex, bornAt: now,
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
    aptitude: {
      disc: clamp(breed.aptitude.disc + jitter(), 0, 1),
      agility: clamp(breed.aptitude.agility + jitter(), 0, 1),
      obedience: clamp(breed.aptitude.obedience + jitter(), 0, 1),
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
    player: { coins: 0, trainerPoints: 0 },
    dogs: [dog],
    activeDogId: dog.id,
    /* `activeToy` is which of the fetch toys is currently on the rug. Stage 4's
       walks are the only thing that adds to `toys`, so what he brought home
       genuinely becomes the thing he fetches. */
    inventory: { food: {}, care: {}, toys: ['ball'], activeToy: 'ball', accessories: [] },
    unlocks: { breeds: [dog.breedId], items: [], rooms: ['room'] },
    contests: {
      disc: { rank: 0, wins: 0, lastEntryAt: 0, entriesToday: 0 },
      agility: { rank: 0, wins: 0, lastEntryAt: 0, entriesToday: 0 },
      obedience: { rank: 0, wins: 0, lastEntryAt: 0, entriesToday: 0 },
    },
    /* `active` is the walk he is on RIGHT NOW, and it is the whole reason a
       walk survives the app being killed: it stores when he left and how long
       for, and progress is recomputed from the wall clock on resume. See
       state/walks.js. `day` is the local-midnight index `walksToday` belongs to. */
    walks: { lastWalkAt: 0, walksToday: 0, found: [], active: null, day: dayIndex(now), total: 0 },
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

/* ---- the game api ---------------------------------------------------- */
export function createGame(state, opts = {}) {
  const onChange = opts.onChange || (() => {});
  const A = BALANCE.affection;
  const MD = BALANCE.mood;
  let affPulse = 0;

  function dog() {
    return state.dogs.find((d) => d.id === state.activeDogId) || state.dogs[0];
  }

  /* Repair anything already poisoned on disk before a single frame runs. A
     save written by a build without the guards below can legitimately contain
     `affection: null`; the rig would then render nothing at all. */
  for (const d of (state.dogs || [])) sanitiseDog(d);

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
      onChange();
      return { id, fresh, unlockedToy };
    },
    /** every distinct thing he has ever brought home */
    findCollection() { return collectedFinds(state); },
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

    addCoins(n) {
      const cur = Math.max(0, num(state.player.coins, 0));
      state.player.coins = cur;
      if (!ok(n)) return cur;
      state.player.coins = Math.max(0, Math.floor(cur + (+n)));
      onChange();
      return state.player.coins;
    },
    addTrainerPoints(n) {
      const cur = Math.max(0, num(state.player.trainerPoints, 0));
      state.player.trainerPoints = cur;
      if (!ok(n)) return cur;
      state.player.trainerPoints = Math.max(0, Math.floor(cur + (+n)));
      onChange();
      return state.player.trainerPoints;
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

    /* `lastSeenAt` is the input to the whole elapsed-time model. A NaN here
       would make every decay, the reunion trigger and the day boundary NaN at
       once — and it would be persisted. */
    markSeen(now = Date.now()) {
      const t = num(now, Date.now());
      if (t <= 0) return;
      state.lastSeenAt = t;
      onChange();
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
