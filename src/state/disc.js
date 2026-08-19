/* ==========================================================================
   state/disc.js — THE DISC GAME'S MODEL. Pure, testable, no dog in it.

   SCOPE.md stage 5, verbatim, because every decision below comes from it:

     "Not a distance fetch; that needs a rig we deliberately didn't build. She
      flicks the disc up-screen, he tracks it upward from the front, and she
      times a tap for the leap and catch. Score by height and airtime rather
      than distance zone. Reuses the frontal-safe throw built for toys in
      stage 2. Ship it if budget allows; Obedience is the one that must be
      right."

   THERE IS NO DISC LADDER, AND THAT IS THE SAME DOCUMENT'S DOING. Its
   non-negotiables cut, outright: "rank ladders per contest type". So Disc has
   no classes, no promotion, no rivals and no placing — Obedience keeps the one
   ladder in the game, and this is a thing she is good at rather than a second
   staircase to climb. What it keeps is a personal best, a daily count for
   pacing, and coins.

   WHAT IT SHARES WITH THE TRIAL, AND WHY
   --------------------------------------
   `groomDelta` and `poiseDelta` come straight out of state/contest.js rather
   than being reimplemented here:

     - GROOMING IS MARKED IN A CONTEST. That is the load-bearing detail that
       makes the stage-2 care loop earn its place (SCOPE stage 5), and it would
       be strange for it to count in the ring and not on the field.
     - `poiseDelta` is aptitude-agnostic arithmetic — it takes a number. Disc
       passes `aptitude.disc`, which has existed per-dog since stage 1 and has
       never been read by anything. Per-DOG jitter only: `dog/breeds.js` still
       carries a per-breed `aptitude.disc` and nothing here may ever read it
       (SCOPE: "Per-breed bias is forbidden", and her dream breeds must never
       be mechanically inferior).

   THE SCORE IS OUT OF 10.00 TO TWO DECIMALS, like the trial's, because the
   precision is the point there and the two numbers should feel like siblings.
   ========================================================================== */
import BALANCE from './balance.js';
import { clamp } from '../engine/draw.js';
import { dayIndex } from './time.js';
import { groomDelta, poiseDelta } from './contest.js';

const D = BALANCE.disc;
const num = (v, f = 0) => { const n = +v; return Number.isFinite(n) ? n : f; };

/* ==========================================================================
   THE SAVE RECORD

   `contests.disc` has existed since stage 1 as a four-field stub in the
   pre-ladder shape — `{rank, wins, lastEntryAt, entriesToday}` — written once
   and read by nothing except the generic new-day reset in state/time.js. Two of
   those fields describe a ladder that is not being built, so they go.

   Repaired on every read, exactly as `contestState` is: a save can arrive from
   an older build, a hand edit or a half-written flush, and a NaN in here would
   otherwise reach the arithmetic below.
   ========================================================================== */
export function discState(state, now = Date.now()) {
  if (!state.contests || typeof state.contests !== 'object') state.contests = {};
  let r = state.contests.disc;
  if (!r || typeof r !== 'object' || Array.isArray(r)) r = state.contests.disc = {};
  r.plays = Math.max(0, Math.floor(num(r.plays, 0)));
  r.best = clamp(num(r.best, 0), 0, 10);
  r.catches = Math.max(0, Math.floor(num(r.catches, 0)));
  r.thrown = Math.max(0, Math.floor(num(r.thrown, 0)));
  r.lastPlayAt = Math.max(0, num(r.lastPlayAt, 0));
  r.entriesToday = Math.max(0, Math.floor(num(r.entriesToday, 0)));
  /* the same LOCAL-midnight day index the trial and the walk use, never UTC */
  const today = dayIndex(num(now, Date.now()));
  if (!Number.isFinite(num(r.day, NaN))) r.day = today;
  if (Number.isFinite(today) && r.day !== today) { r.day = today; r.entriesToday = 0; }
  return r;
}

/**
 * MAY HE PLAY RIGHT NOW, and if not, what does he need?
 *
 * The trial's gate, minus the one term that does not apply: `entryCheck` also
 * refuses an `untrained` dog, because a trial asks for tricks. Disc asks him to
 * jump at a disc, which is not a trick and needs no teaching — refusing a dog
 * for not knowing `sit` would be a wall for no reason.
 *
 * Hunger and thirst stay, and the reason codes are deliberately the SAME
 * strings the trial uses, so `scenes/room.js`'s `onNeed` router already knows
 * what to do with them without a line being added to it.
 *
 * `practice` is not a refusal. Past the daily count she can still play; it just
 * does not pay, and nothing says "no" (SCOPE: "daily entry limits are fine as
 * pacing, but never as a wall she hits and resents").
 */
export function discEntryCheck(game, { now = Date.now() } = {}) {
  const r = discState(game.state, now);
  const d = game.dog;
  const practice = r.entriesToday >= num(BALANCE.contest.perDay, 3);
  const G = BALANCE.contest.gate;
  if (d.needs.hunger < num(G.hunger, 0.55)) {
    return { ok: false, reason: 'hunger', need: 'hunger', practice };
  }
  if (d.needs.thirst < num(G.thirst, 0.55)) {
    return { ok: false, reason: 'thirst', need: 'thirst', practice };
  }
  return { ok: true, reason: '', need: '', practice };
}

/* ==========================================================================
   ONE THROW

   "Score by height and airtime rather than distance zone." So three terms, and
   the third is the one that makes it a game rather than a slot machine:

     height   how far up-screen the disc actually went, 0..1. Hers: it comes
              out of the flick, so a limp flick scores less than a real one.
     airtime  how long he was off the ground for, as a share of the longest
              leap he is capable of. Also hers, indirectly — a late tap makes
              him leap from further into the disc's fall and he is up for less
              of it.
     timing   how close the tap was to the moment the disc was catchable.

   A MISS STILL SCORES SOMETHING. `missCredit` is not generosity, it is the
   non-negotiable: "losing must never feel like rebuke ... A bad score is him
   being distracted or her needing more practice." A zero for a near miss reads
   as a rebuke; 0.18 of a catch reads as "nearly".
   ========================================================================== */
export function scoreThrow(o = {}) {
  const caught = !!o.caught;
  const height = clamp(num(o.height, 0), 0, 1);
  const airtime = clamp(num(o.airtime, 0), 0, 1);
  /* `timing` arrives as the ABSOLUTE error in seconds; 0 is perfect */
  const err = Math.abs(num(o.timing, D.window.grace));
  const timing = clamp(1 - err / Math.max(0.001, num(D.window.grace, 0.30)), 0, 1);
  if (!caught) {
    /* how nearly she had it still counts, because "nearly" is information and
       a flat zero is a telling-off */
    return clamp(num(D.score.missCredit, 0.18) * (0.35 + 0.65 * timing), 0, 1);
  }
  const W = D.score;
  const v = num(W.base, 0.42)
    + num(W.height, 0.30) * height
    + num(W.airtime, 0.16) * airtime
    + num(W.timing, 0.12) * timing;
  return clamp(v, 0, 1);
}

/** the round's performance, 0..1 — a plain mean, because every throw is one throw */
export function roundPerformance(throwScores) {
  const xs = (Array.isArray(throwScores) ? throwScores : []).map((v) => clamp(num(v, 0), 0, 1));
  if (!xs.length) return 0;
  let sum = 0;
  for (const v of xs) sum += v;
  return clamp(sum / xs.length, 0, 1);
}

/**
 * THE FINAL NUMBER, 0.00–10.00, built the same way the trial's is: performance
 * takes `perfSpan` of it and the last stretch is grooming and poise. Sharing
 * that shape is deliberate — the two scores should be comparable, and a bath
 * should be as obviously a good idea before a disc round as before a trial.
 */
export function discScore({ performance = 0, cleanliness = 1, gloss = 0.5, aptitude = 0.5 } = {}) {
  const span = num(BALANCE.contest.perfSpan, 9.4);
  const perfPoints = clamp(num(performance, 0), 0, 1) * span;
  const groom = groomDelta(cleanliness, gloss);
  const poise = poiseDelta(aptitude);
  return {
    performance: +clamp(num(performance, 0), 0, 1).toFixed(4),
    perfPoints: +perfPoints.toFixed(3),
    groom: +groom.toFixed(3),
    poise: +poise.toFixed(3),
    total: +clamp(perfPoints + groom + poise, 0, 10).toFixed(2),
  };
}

/**
 * WHAT A ROUND PAYS, IN COINS.
 *
 * A band table rather than a placing, because there is no field to place
 * against — and bands read honestly on a surface with no rivals on it: she can
 * see what the next one is worth. Sized against the trial's Beginner prizes
 * (100/50/30) so neither activity is the obvious way to farm.
 *
 * A practice round pays nothing and is never refused.
 */
export function discPrize(score, { practice = false } = {}) {
  if (practice) return 0;
  const s = clamp(num(score, 0), 0, 10);
  for (const [at, coins] of D.prize) if (s >= at) return Math.max(0, Math.floor(coins));
  return 0;
}

/** the word for a score, for the card. Never a grade, and never a rebuke. */
export function discWord(score) {
  const s = clamp(num(score, 0), 0, 10);
  for (const [at, word] of D.words) if (s >= at) return word;
  return D.words[D.words.length - 1][1];
}

export default {
  discState, discEntryCheck, scoreThrow, roundPerformance, discScore, discPrize, discWord,
};
