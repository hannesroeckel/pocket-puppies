/* ==========================================================================
   state/game.js — the save object, its mutators, and derived getters.

   NON-NEGOTIABLE (architecture §4):
     - No scene ever writes a need or affection field directly. Everything
       goes through a mutator here.
     - `affection = Math.max(affectionFloor, next)` is enforced INSIDE the
       mutator, so the ratchet cannot be bypassed by a caller that forgets.
       The dog never resents her.
   ========================================================================== */
import BALANCE from './balance.js';
import { clamp } from '../engine/draw.js';
import { getBreed } from '../dog/breeds.js';
import { rng as sharedRng } from '../engine/rng.js';

export const SCHEMA_VERSION = 1;

/* ---- fresh state ------------------------------------------------------ */
export function newDog(now, { breedId = 'shiba', name = 'Mochi', sex = 'f', rng = sharedRng } = {}) {
  const breed = getBreed(breedId);
  const jitter = () => clamp(rng.range(-0.12, 0.12), -0.12, 0.12);
  return {
    id: 'dog-' + now.toString(36),
    name, breedId, sex, bornAt: now,
    needs: { hunger: 0.82, thirst: 0.86, cleanliness: 0.94, energy: 0.90 },
    affection: BALANCE.affection.start,
    affectionFloor: BALANCE.affection.startFloor,
    trust: 0.05,
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
    inventory: { food: {}, care: {}, toys: [], accessories: [] },
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
  let affPulse = 0;

  function dog() {
    return state.dogs.find((d) => d.id === state.activeDogId) || state.dogs[0];
  }

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

  const api = {
    get state() { return state; },
    get dog() { return dog(); },
    get affection() { return dog().affection; },
    get affectionFloor() { return dog().affectionFloor; },
    get affectionPulse() { return affPulse; },

    /* ---- mutators -------------------------------------------------- */
    addAffection(delta, reason) {
      if (!(delta > 0) && !(delta < 0)) return dog().affection;
      affPulse = Math.min(1, affPulse + Math.abs(delta) * 6);
      const d = dog();
      if (delta > 0) api.addTrust(delta * A.trustPerAffection);
      return setAffection(d.affection + delta, reason);
    },
    setAffection,
    /** idle drift toward the floor; never below it (the mutator guarantees it) */
    drainAffection(dt) {
      const d = dog();
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

    addCoins(n) { state.player.coins = Math.max(0, state.player.coins + n); onChange(); return state.player.coins; },
    addTrainerPoints(n) { state.player.trainerPoints = Math.max(0, state.player.trainerPoints + n); onChange(); return state.player.trainerPoints; },

    setFlag(key, v) { state.flags[key] = v; onChange(); },
    setSetting(key, v) { state.settings[key] = v; onChange(); },

    log(kind, note) {
      const d = dog();
      d.log.push({ at: Date.now(), kind, note: note || '' });
      while (d.log.length > BALANCE.save.logCap) d.log.shift();
      onChange();
    },

    markSeen(now = Date.now()) { state.lastSeenAt = now; onChange(); },

    /* ---- derived --------------------------------------------------- */
    get mood() {
      const d = dog();
      const n = d.needs;
      return {
        affection: d.affection,
        floor: d.affectionFloor,
        trust: d.trust,
        needs: n,
        /* 0..1 overall wellbeing; stage 2 hangs mood expressions off this */
        wellbeing: clamp((n.hunger + n.thirst + n.cleanliness + n.energy) / 4, 0, 1),
      };
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

    /** notify save.js without changing anything (used after time decay) */
    touch() { onChange(); },
  };

  return api;
}

export default createGame;
