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

/** Local midnight-based day index (NOT UTC — she lives in a timezone). */
export function dayIndex(ms) {
  const d = new Date(ms);
  return Math.floor((ms - d.getTimezoneOffset() * 60e3) / 86400e3);
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
  let last = state.lastSeenAt || now;

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

  /* needs decay (energy recovers) */
  for (const key in T.needDecayPerHour) {
    const per = T.needDecayPerHour[key];
    if (!per) continue;
    game.addNeed(key, -per * capped);
  }

  /* affection: a small "missed you" dip, bounded, and the mutator refuses to
     go below the floor no matter what we pass it */
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

  state.lastSeenAt = now;
  game.touch();

  return {
    hours: +hours.toFixed(3),
    cappedHours: +capped.toFixed(3),
    capped: hours > T.maxDecayHours,
    reunion: hours >= T.reunionAfterHours,
    newDay,
    /* >0 means the device clock had moved backwards and we refused to trust it */
    clockSkewMs: clockSkew,
  };
}

/** Human-readable gap, for the reunion line stage 2 will show. */
export function describeGap(hours) {
  if (hours < 1) return 'a little while';
  if (hours < 2) return 'an hour';
  if (hours < 24) return `${Math.round(hours)} hours`;
  const d = Math.round(hours / 24);
  return d === 1 ? 'a day' : `${d} days`;
}

export default { applyElapsed, timeOfDay, isNewDay, dayIndex, describeGap };
