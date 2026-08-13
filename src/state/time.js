/* ==========================================================================
   state/time.js — elapsed-time decay, day boundaries, time of day.

   Principle 1 in code: decay is CAPPED at BALANCE.time.maxDecayHours. Beyond
   the cap, nothing further degrades. Come back after two weeks and you get a
   hungry, slightly grubby, overjoyed dog — never a reproachful one. Affection
   dips a little (so reunion feels earned) but can never fall below the floor.
   ========================================================================== */
import BALANCE from './balance.js';
import { clamp } from '../engine/draw.js';

const T = BALANCE.time;
const HOUR = 3600e3;

/** a finite number, or the fallback — see state/game.js on why this is needed */
const num = (v, f = 0) => { const n = +v; return Number.isFinite(n) ? n : f; };

/** Local midnight-based day index (NOT UTC — she lives in a timezone). */
export function dayIndex(ms) {
  /* An unguarded NaN came back as NaN, and since `NaN !== NaN` every caller
     that compares day indices concluded "it is a new day" on every single
     call — which silently reset the daily affection ledger and uncapped the
     anti-grind design. Guarded at the source. */
  const t = num(ms, Date.now());
  const d = new Date(t);
  return Math.floor((t - d.getTimezoneOffset() * 60e3) / 86400e3);
}
export function isNewDay(prevMs, nowMs) {
  if (!prevMs) return true;
  return dayIndex(prevMs) !== dayIndex(nowMs);
}

/** 0..1 through the day plus a coarse phase name, for lighting later. */
export function timeOfDay(now = Date.now()) {
  const d = new Date(now);
  const t = (d.getHours() * 60 + d.getMinutes()) / 1440;
  let phase = 'day';
  if (t < 0.24) phase = 'night';
  else if (t < 0.34) phase = 'dawn';
  else if (t < 0.72) phase = 'day';
  else if (t < 0.82) phase = 'dusk';
  else phase = 'night';
  return { t, phase, hour: d.getHours() };
}

/**
 * Run once on load, before the first frame.
 * @returns {{hours:number, cappedHours:number, capped:boolean, reunion:boolean, newDay:boolean}}
 */
export function applyElapsed(game, now = Date.now()) {
  const state = game.state;
  /* `now` and `lastSeenAt` are the two inputs the entire offline model rests
     on. A bad value in either used to make every decay, the reunion trigger and
     the day boundary NaN at once — and `lastSeenAt` is persisted, so the
     corruption survived the relaunch that would otherwise have cleared it. */
  now = num(now, Date.now());
  let last = num(state.lastSeenAt, 0) || now;

  /* --- CLOCK-TAMPER GUARD ---------------------------------------------
     iOS suspends JS entirely in the background, so all offline progression
     is a pure function of wall-clock elapsed time — which means a device
     clock that moves BACKWARDS (manual change, timezone travel, DST) would
     otherwise produce a negative or absurd delta and send the decay maths
     strange. A lastSeenAt in the future is never legitimate: clamp it to
     now and treat the visit as zero elapsed rather than trusting the delta.
     (docs/PLATFORM-RISKS.md risk 3.) ------------------------------------ */
  let clockSkew = 0;
  if (last > now + T.clockSkewGraceMs) {
    clockSkew = last - now;
    last = now;
    state.lastSeenAt = now;
  }

  const elapsedMs = Math.max(0, now - last);
  const hours = elapsedMs / HOUR;
  const capped = Math.min(hours, T.maxDecayHours);

  /* ---- needs decay, FOR EVERY DOG (queue item 7) ----------------------
     This decayed the active dog only, through `addNeed` -> `dog()`, and it was
     reported as a feature: "he never resents her". That conflated two things.
     Needs are PHYSICAL and recoverable — they should pass with time for every
     dog, and a bowl of food fixes them in seconds. The bond is EMOTIONAL and
     not recoverable, and that is what the ratcheting floor protects. The
     principle was never "nothing changes while she is away"; it was "the
     relationship is never taken away from her".

     The 36-hour cap still applies to all of them, so a fortnight away is no
     worse than a day and a half for anybody. */
  for (const key in T.needDecayPerHour) {
    const per = T.needDecayPerHour[key];
    if (!per) continue;
    if (game.addNeedAll) game.addNeedAll(key, -per * capped);
    else game.addNeed(key, -per * capped);
  }

  /* coat gloss dulls while she's away, so grooming stays a ritual */
  if (capped > 0) {
    if (game.addGlossAll) game.addGlossAll(-T.glossDecayPerHour * capped);
    else if (game.addGloss) game.addGloss(-T.glossDecayPerHour * capped);
  }

  /* affection: a small "missed you" dip, bounded, and the mutator refuses to
     go below the floor no matter what we pass it. Deliberately tiny — the bond
     must never visibly fall from absence (research §2). */
  if (capped > 0.5) {
    const dip = Math.min(T.affectionDipMax, T.affectionDipPerHour * capped);
    game.addAffection(-dip);
  }

  const newDay = isNewDay(last, now);
  if (newDay) {
    state.walks.walksToday = 0;
    for (const k in state.contests) state.contests[k].entriesToday = 0;
    game.touch();
  }

  /* ---- THE REUNION RUNS ON THE LONGER OF THE TWO GAPS (queue item 4) ----
     `hours` above is how long the APP was shut. This dog may have been waiting
     far longer than that — she can play daily and still not have picked him up
     for a fortnight — and the reunion is about him, not about the app. Read
     his own clock before it is stamped, and take whichever gap is longer. */
  const dogHours = game.gapHoursFor ? game.gapHoursFor(game.dog.id, now) : hours;
  const gap = Math.max(hours, num(dogHours, hours));

  /* both clocks: the app's, and the one in the room. The others go on waiting,
     which is the entire point of the per-dog field. */
  if (game.markSeen) game.markSeen(now);
  else state.lastSeenAt = now;

  /* MOOD IS NOT PERSISTED. It starts wherever the bond and the current needs
     say it should — a mood that survives a cold start is a grudge, not a mood.
     (The reunion then drives it up hard, which is the whole point.) */
  if (game.setMood) game.setMood(game.moodBaseline);

  game.touch();

  const reunion = gap >= T.reunionAfterHours;
  return {
    /* `hours` is the gap the GREETING is chosen from — the longer of the two.
       `appHours` is how long the app itself was shut, kept separate because it
       is what the day boundary and the decay were computed from. */
    hours: +gap.toFixed(3),
    appHours: +hours.toFixed(3),
    dogHours: +num(dogHours, hours).toFixed(3),
    cappedHours: +capped.toFixed(3),
    capped: hours > T.maxDecayHours,
    reunion,
    newDay,
    /* the reunion's intensity input: time_away x affection (research §1.7).
       0..1, saturating at BALANCE.reunion.hoursFull hours. */
    intensity: reunion ? reunionIntensity(gap, game.affection) : 0,
    /* >0 means the device clock had moved backwards and we refused to trust it */
    clockSkewMs: clockSkew,
  };
}

/**
 * Reunion intensity: `time_away x affection`, exactly as the research asks.
 * At k=0 it's a pleased trot toward the camera; at k=1 it's a full-body
 * torpedo that takes a few seconds to calm down.
 */
export function reunionIntensity(hours, affection) {
  const RU = BALANCE.reunion;
  const timeShare = clamp(hours / RU.hoursFull, 0, 1);
  return +clamp(timeShare * RU.hourWeight + clamp(affection, 0, 1) * RU.affWeight, 0, 1).toFixed(3);
}

/**
 * Live decay: the original ran on the real clock and so do we, so needs move
 * (invisibly slowly) while she is in the room too. Keeps the offline model and
 * the live model consistent instead of having needs freeze whenever she looks.
 * Dirt is deliberately excluded here — dirt comes from ACTIVITY.
 */
export function decayLive(game, dt) {
  if (!T.liveDecay) return;
  const d = num(dt, 0);
  if (d <= 0) return;
  const perSec = d / 3600;
  /* EVERY DOG, here too. The offline model advancing all of them while the live
     model advanced only the one in the room would mean a long session quietly
     slowed the other dog's day down — the same freeze as item 7, just smaller
     and harder to see. */
  for (const key in T.needDecayPerHour) {
    const per = T.needDecayPerHour[key];
    if (!per) continue;
    if (game.addNeedAll) game.addNeedAll(key, -per * perSec);
    else game.addNeed(key, -per * perSec);
  }
  if (game.addGlossAll) game.addGlossAll(-T.glossDecayPerHour * perSec);
  else if (game.addGloss) game.addGloss(-T.glossDecayPerHour * perSec);
}

/** Human-readable gap, for the reunion line stage 2 will show. */
export function describeGap(hours) {
  if (hours < 1) return 'a little while';
  if (hours < 2) return 'an hour';
  if (hours < 24) return `${Math.round(hours)} hours`;
  const d = Math.round(hours / 24);
  return d === 1 ? 'a day' : `${d} days`;
}

export default {
  applyElapsed, timeOfDay, isNewDay, dayIndex, describeGap,
  reunionIntensity, decayLive,
};
