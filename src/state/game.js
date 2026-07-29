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

export const SCHEMA_VERSION = 2;

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
    tricks: {},
    aptitude: {
      disc: clamp(breed.aptitude.disc + jitter(), 0, 1),
      agility: clamp(breed.aptitude.agility + jitter(), 0, 1),
      obedience: clamp(breed.aptitude.obedience + jitter(), 0, 1),
    },
    wear: { collar: null, accessory: null },
    log: [],
  };
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
    inventory: { food: {}, care: {}, toys: ['ball'], accessories: [] },
    unlocks: { breeds: [dog.breedId], items: [], rooms: ['room'] },
    contests: {
      disc: { rank: 0, wins: 0, lastEntryAt: 0, entriesToday: 0 },
      agility: { rank: 0, wins: 0, lastEntryAt: 0, entriesToday: 0 },
      obedience: { rank: 0, wins: 0, lastEntryAt: 0, entriesToday: 0 },
    },
    walks: { lastWalkAt: 0, walksToday: 0, found: [] },
    flags: { seenIntro: false, namedFirstDog: false },
    settings: { sound: true, reducedMotion: 'auto', mic: false },
  };
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

  /* ---- MOOD: fast, in-memory only -----------------------------------
     Never persisted: a mood that survives a cold start is not a mood, it's
     a grudge. On load it starts at the baseline affection implies. */
  function baseline() {
    const d = dog();
    const n = d.needs;
    const unmet = clamp(1 - (n.hunger + n.thirst + n.cleanliness) / 3, 0, 1);
    return clamp(MD.baseBias + d.affection * MD.baseFromAffection - unmet * MD.needWeight, 0.03, 1);
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
    const before = d.affection;
    /* milestone ratchet: crossing a threshold raises the floor permanently */
    for (const m of A.milestones) {
      if (next >= m.at && d.affectionFloor < m.floor) d.affectionFloor = m.floor;
    }
    /* continuous ratchet */
    const ratio = next * A.floorRatio;
    if (ratio > d.affectionFloor) d.affectionFloor = Math.min(1, ratio);
    /* THE RULE */
    d.affection = clamp(Math.max(d.affectionFloor, next), 0, 1);
    if (d.affection !== before) {
      if (reason && Math.abs(d.affection - before) > 0.02) api.log('affection', reason);
      onChange();
    }
    return d.affection;
  }

  /* ---- the slow-axis ledger ----------------------------------------- */
  function ledger(now) {
    const d = dog();
    if (!d.bond) d.bond = { day: -1, earned: 0, showedUp: false, care: {}, session: 0, sessionAt: 0 };
    const today = dayIndex(now === undefined ? Date.now() : now);
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
      mood = clamp(mood + delta, 0, 1);
      return mood;
    },
    setMood(v) { mood = clamp(v, 0, 1); return mood; },
    /** an unwelcome touch dents mood — but never below the baseline the bond
        has earned. Annoyed, never resentful. */
    dentMood(amount) {
      mood = Math.max(baseline(), mood - (amount === undefined ? MD.badTouch : amount));
      return mood;
    },
    /** call once per frame: mood drifts toward the baseline affection sets */
    stepMood(dt) {
      const b = baseline();
      const rate = mood > b ? MD.fallRate : MD.riseRate;
      mood += (b - mood) * (1 - Math.exp(-rate * dt));
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
      if (delta > 0) api.addTrust(delta * A.trustPerAffection);
      affPulse = Math.min(1, affPulse + Math.abs(delta) * 20);
      return setAffection(d.affection + delta, reason);
    },
    setAffection,

    /**
     * The "distinct sessions beat session length" lever. Each kind pays at
     * most once per local day and is still subject to the day cap.
     *   'showUp'  first launch of the day
     *   'reunion' after an 8h+ absence, on top of showUp
     *   'care:feed' | 'care:water' | 'care:wash' | 'care:brush'
     *   'toy'     a fetched toy (repeatable, day-capped)
     * @returns the affection actually paid
     */
    awardDay(kind, now) {
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
      if (!(amount > 0)) return 0;
      const dayRoom = Math.max(0, D.cap - b.earned);
      const paid = Math.min(amount, dayRoom);
      if (paid <= 0) return 0;
      b.earned += paid;
      if (kind === 'showUp') b.showedUp = true;
      if (once && kind && kind.indexOf('care:') === 0) b.care[kind] = 1;
      api.addAffectionRaw(paid);
      return paid;
    },

    /** a touch after a long quiet gap starts a new petting session */
    noteTouch(now) {
      const b = ledger(now);
      const t = now === undefined ? Date.now() : now;
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
      affPulse += (0 - affPulse) * (1 - Math.exp(-BALANCE.ui.meter.pulseDecay * dt));
    },

    addTrust(delta) {
      const d = dog();
      d.trust = clamp(d.trust + delta, 0, 1);
      onChange();
      return d.trust;
    },

    addNeed(key, delta) {
      const d = dog();
      if (!(key in d.needs)) return 0;
      d.needs[key] = clamp(d.needs[key] + delta, 0, 1);
      onChange();
      return d.needs[key];
    },
    setNeed(key, v) {
      const d = dog();
      if (!(key in d.needs)) return 0;
      d.needs[key] = clamp(v, 0, 1);
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
      const cur = d.needs[spec.key];
      /* never claw back progress a better tool already made */
      const target = Math.min(Math.max(spec.max, cur), cur + delta);
      d.needs[spec.key] = clamp(target, 0, 1);
      onChange();
      return d.needs[spec.key];
    },
    /** how much of a bowl she will actually eat, from how hungry she is */
    appetite() {
      const P = BALANCE.needs.appetite;
      return clamp(P.min + (1 - dog().needs.hunger) * P.span, 0, 1);
    },

    /* ---- coat: dirt regions + gloss --------------------------------- */
    get dirt() {
      const d = dog();
      if (!Array.isArray(d.dirt) || d.dirt.length !== DIRT_REGIONS) {
        d.dirt = new Array(DIRT_REGIONS).fill(clamp(1 - d.needs.cleanliness, 0, 1));
      }
      return d.dirt;
    },
    /** @returns mean dirt 0..1 */
    get dirtMean() {
      const a = api.dirt;
      let s = 0;
      for (let i = 0; i < a.length; i++) s += a[i];
      return a.length ? s / a.length : 0;
    },
    setDirt(i, v) {
      const a = api.dirt;
      if (i < 0 || i >= a.length) return 0;
      a[i] = clamp(v, 0, 1);
      onChange();
      return a[i];
    },
    /** spread new dirt over the coat — paid by ACTIVITY, never by the clock */
    soil(amount, rng = sharedRng) {
      const a = api.dirt;
      for (let i = 0; i < a.length; i++) {
        a[i] = clamp(a[i] + amount * rng.range(0.45, 1.55), 0, 1);
      }
      api.addNeed('cleanliness', -amount);
      onChange();
      return api.dirtMean;
    },
    /** wash/brush finished: reconcile the mask with the cleanliness word */
    syncCleanliness() {
      const d = dog();
      d.needs.cleanliness = clamp(1 - api.dirtMean, 0, 1);
      onChange();
      return d.needs.cleanliness;
    },
    get gloss() { const d = dog(); return typeof d.gloss === 'number' ? d.gloss : 0.3; },
    addGloss(delta) {
      const d = dog();
      d.gloss = clamp(api.gloss + delta, 0, 1);
      onChange();
      return d.gloss;
    },

    addCoins(n) { state.player.coins = Math.max(0, state.player.coins + n); onChange(); return state.player.coins; },
    addTrainerPoints(n) { state.player.trainerPoints = Math.max(0, state.player.trainerPoints + n); onChange(); return state.player.trainerPoints; },

    setFlag(key, v) { state.flags[key] = v; onChange(); },
    setSetting(key, v) { state.settings[key] = v; onChange(); },

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
      d.log.push({ at: Date.now(), kind, note: note || '' });
      while (d.log.length > BALANCE.save.logCap) d.log.shift();
      onChange();
    },

    markSeen(now = Date.now()) { state.lastSeenAt = now; onChange(); },

    /* ---- derived --------------------------------------------------- */
    /**
     * The per-frame mood bag. `mood.mood` is the FAST channel and is what
     * drives everything visible; `mood.affection` is the slow bond and is
     * never drawn. Mutated in place — do not retain it across frames.
     */
    get mood() {
      const d = dog();
      const n = d.needs;
      moodBag.mood = mood;
      moodBag.baseline = baseline();
      moodBag.affection = d.affection;
      moodBag.floor = d.affectionFloor;
      moodBag.trust = d.trust;
      moodBag.needs = n;
      moodBag.wellbeing = clamp((n.hunger + n.thirst + n.cleanliness + n.energy) / 4, 0, 1);
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
