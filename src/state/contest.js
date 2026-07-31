/* ==========================================================================
   state/contest.js — THE OBEDIENCE TRIAL, AS A MODEL.

   Pure functions and one state repairer. Nothing here draws, nothing here
   ticks, and nothing here imports the dog layer — exactly the split
   `state/walks.js` uses, and for the same reasons:

     - the SCORE can be computed and checked without a canvas, which is how
       "a clean dog and a filthy dog at equal skill" gets MEASURED rather than
       asserted;
     - the PROGRAMME the judge calls is deterministic from a seed, so a trial
       is replayable and a statistical run over 4000 trials is possible;
     - the LADDER is arithmetic, so "days, not months" is a calculation rather
       than a hope.

   WHAT IS DELIBERATELY NOT HERE
   -----------------------------
   No active-trial record is persisted. A walk survives the app being killed
   because absence IS the mechanic; a trial is 45-90 seconds of her actually
   watching him, and resuming one from a cold start would be strange. So a
   trial abandoned mid-way costs NOTHING — the entry is only counted when the
   trial finishes. She can never lose an entry to a crash, a phone call, or
   changing her mind, and there is no state to migrate.

   THE TWO RULES THAT OUTRANK FAITHFULNESS (SCOPE.md)
   --------------------------------------------------
   1. BREED IS COSMETIC. Nothing in this file reads a breed. `poise` comes
      from the per-DOG aptitude roll and nothing else.
   2. LOSING IS NEVER A REBUKE. There is no demotion at any score, `ignore`
      still scores, and the practice round past the daily cap exists so the
      cap is pacing rather than a wall.
   ========================================================================== */
import BALANCE from './balance.js';
import { clamp } from '../engine/draw.js';
import { dayIndex } from './time.js';

const K = BALANCE.contest;

/* ---- numeric guards, same policy as state/game.js: REJECT, don't coerce -- */
const num = (v, f = 0) => {
  const n = typeof v === 'number' ? v : +v;
  return Number.isFinite(n) ? n : f;
};
const clampNum = (v, a, b, f = a) => clamp(num(v, f), a, b);

/* ---- the ladder -------------------------------------------------------- */
export const CLASSES = K.classes;
export const CLASS_IDS = CLASSES.map((c) => c.id);
export const CLASS_BY_ID = {};
for (const c of CLASSES) CLASS_BY_ID[c.id] = c;

/** the class at a ladder index, clamped — an out-of-range index is not fatal */
export function classAt(i) {
  return CLASSES[clamp(Math.round(num(i, 0)), 0, CLASSES.length - 1)];
}
export function classIndex(id) {
  const i = CLASS_IDS.indexOf(id);
  return i < 0 ? 0 : i;
}
export const isTop = (i) => Math.round(num(i, 0)) >= CLASSES.length - 1;

/* ==========================================================================
   the persisted block
   ========================================================================== */
/**
 * Repair `state.contests.obedience` and roll its day boundary. Called on
 * EVERY read, exactly as `walkState` is, so nothing downstream has to defend
 * itself against a hand-edited save or a day that turned over while the app
 * was open.
 *
 * @returns the repaired record
 */
export function contestState(state, now = Date.now()) {
  if (!state.contests || typeof state.contests !== 'object') state.contests = {};
  let r = state.contests.obedience;
  if (!r || typeof r !== 'object') { r = {}; state.contests.obedience = r; }

  r.classIdx = clamp(Math.round(num(r.classIdx, 0)), 0, CLASSES.length - 1);
  r.entries = Math.max(0, Math.round(num(r.entries, 0)));
  r.wins = Math.max(0, Math.round(num(r.wins, 0)));
  r.rank = Math.max(0, Math.round(num(r.rank, 0)));
  r.best = clampNum(r.best, 0, 10, 0);
  r.lastEntryAt = Math.max(0, num(r.lastEntryAt, 0));
  r.entriesToday = Math.max(0, Math.round(num(r.entriesToday, 0)));
  r.won = !!r.won;
  /* the last few CHAMPIONSHIP scores, which is what the >= 9.00 standing is
     measured over. Trimmed here so the array can never grow without bound. */
  if (!Array.isArray(r.champScores)) r.champScores = [];
  r.champScores = r.champScores
    .map((v) => clampNum(v, 0, 10, 0))
    .slice(-K.champion.holdWindow);

  /* the day boundary, at LOCAL midnight (never UTC — architecture §5) */
  const today = dayIndex(num(now, Date.now()));
  if (Number.isFinite(today) && r.day !== today) {
    r.day = today;
    r.entriesToday = 0;
  }
  if (!Number.isFinite(r.day)) r.day = Number.isFinite(today) ? today : 0;
  return r;
}

/* ==========================================================================
   THE ENTRY GATE — "not hungry, not parched"
   ==========================================================================
   Research §6: entry requires a dog that is not hungry and not parched. The
   thresholds are BALANCE.inspect's own word boundaries, so `word` below is
   literally what the HUD would say about him and the copy can offer the right
   bowl by name.

   IT MUST READ AS LOOKING AFTER HIM, NEVER AS A PUNISHMENT (SCOPE stage 5).
   That is a copy problem, solved in dog/contest.js's COPY — but the shape of
   this return is what makes the warm version writable: it hands back the NEED
   and its WORD, so the offer can be "a bowl first" rather than "entry denied".
*/
/**
 * @returns {{ ok, reason:''|'hunger'|'thirst'|'untrained', need, practice }}
 *   `practice` is true when today's entries are used up: the trial still runs,
 *   it simply pays nothing and cannot promote.
 */
export function entryCheck(game, { knows = 1, now = Date.now() } = {}) {
  const d = game.dog;
  const r = contestState(game.state, now);
  const practice = r.entriesToday >= K.perDay;
  if (!(knows > 0)) {
    return { ok: false, reason: 'untrained', need: '', practice };
  }
  if (num(d.needs.hunger, 1) < K.gate.hunger) {
    return { ok: false, reason: 'hunger', need: 'hunger', practice };
  }
  if (num(d.needs.thirst, 1) < K.gate.thirst) {
    return { ok: false, reason: 'thirst', need: 'thirst', practice };
  }
  return { ok: true, reason: '', need: '', practice };
}

/* ==========================================================================
   THE PROGRAMME
   ==========================================================================
   Deterministic from a seeded rng, so the same seed always produces the same
   trial — which is what makes a scoring run reproducible and a screenshot
   repeatable. Shaped like `state/walks.js rollFinds`, on purpose (ARCHITECTURE
   §14.2 asks stage 5's reward roll to take the same shape).

   The judge picks FAIRLY, which is a real constraint and not a courtesy:
     - only tricks this dog actually has (`repertoire()` already filters to
       `reps > 0`, best-first by live reliability);
     - a HOLD is never asked of a transient trick — you cannot hold a jump —
       and the duration asked for is a share of what he can genuinely manage
       (dog/train.js `holdFor`), so deeper practice is asked for MORE and still
       passes rather than being punished for its own depth;
     - no trick is called twice while an unused one remains.
*/
/**
 * @param classId  ladder class
 * @param rep      dog/train.js `repertoire()` — [{id, level, reliability,
 *                 holdFor, transient, ...}], best first
 * @param rng      a seeded engine/rng.js stream
 * @returns [{ kind, pick, asks:[{id, hold}] }]
 */
export function buildProgramme(classId, rep, rng) {
  const plan = K.programme[classId] || K.programme.beginner;
  const pool = (rep || []).filter((t) => t && t.id);
  if (!pool.length) return [];

  /* he will actually answer to what he KNOWS; anything he has merely touched
     is a fallback so a barely-trained dog still gets a trial rather than a
     refusal */
  const known = pool.filter((t) => t.level >= 1);
  const src = known.length ? known : pool;
  const holdable = src.filter((t) => !t.transient);

  /* draw without replacement from a shuffled bag, refilled when it empties —
     so a dog with three tricks is asked for all three before any repeats */
  let bag = [];
  const draw = (from) => {
    const list = from && from.length ? from : src;
    if (!bag.length) bag = src.slice();
    /* prefer something still in the bag that is also in `list` */
    const both = bag.filter((t) => list.indexOf(t) >= 0);
    const use = both.length ? both : list;
    const pickIdx = Math.min(use.length - 1, (rng.next() * use.length) | 0);
    const got = use[pickIdx];
    const bi = bag.indexOf(got);
    if (bi >= 0) bag.splice(bi, 1);
    return got;
  };

  const rounds = [];
  for (const kind of plan) {
    if (kind === 'free') {
      /* SHE chooses. This is the one real decision in a trial and it is where
         depth pays, so it must not be made for her. */
      rounds.push({ kind, pick: 'her', asks: [] });
      continue;
    }
    if (kind === 'hold') {
      const t = draw(holdable.length ? holdable : src);
      rounds.push({
        kind, pick: 'judge',
        asks: [{ id: t.id, hold: askedHold(classId), can: num(t.holdFor, 0) }],
      });
      continue;
    }
    if (kind === 'seq') {
      const a = draw(src);
      const b = draw(src.filter((x) => x.id !== a.id));
      rounds.push({ kind, pick: 'judge', asks: [{ id: a.id, hold: 0 }, { id: b.id, hold: 0 }] });
      continue;
    }
    const t = draw(src);
    rounds.push({ kind: 'call', pick: 'judge', asks: [{ id: t.id, hold: 0 }] });
  }
  return rounds;
}

/**
 * How long the judge asks a trick to be held. THE CLASS SETS IT, NOT THE DOG:
 * a standard is a standard, which is the only way practice depth can be worth
 * anything. dog/train.js's `holdFor` runs 0.55s at level 0 to 3.25s at level
 * 3, so Beginner's 0.90s is met by almost anything and the Championship's
 * 3.10s is met by a level-3 trick and nothing else.
 */
export function askedHold(classId) {
  const c = CLASS_BY_ID[classId] || CLASSES[0];
  return +num(c.hold, 1).toFixed(2);
}

/* ==========================================================================
   MARKING
   ========================================================================== */
/**
 * How long GETTING INTO POSITION unavoidably took, in seconds — the allowance
 * the judge adds to par before marking speed.
 *
 * MEASURED, AND IT WAS A REAL UNFAIRNESS. `perf.latency` runs from the start of
 * the performance, and `chainFor` makes him sit and then lie down before he can
 * roll over. That arrived at 3.5-5.2s against a `slow` of 2.90, so a roll over
 * scored zero speed marks EVERY TIME, purely for being a trick with a
 * prerequisite — and the free window, where deep tricks are meant to pay, was
 * the round that suffered most. A judge does not penalise a dog for lying down
 * first, and neither does this.
 *
 * The sum is the real cost dog/train.js charges: one `latency.chain` to decide
 * to move, the clip's own duration, and the 0.05 beat between links.
 */
export function chainPar(ids) {
  const L = BALANCE.train.latency;
  let s = 0;
  for (const id of (ids || [])) {
    const spec = TRICKS_DUR[id];
    s += L.chain + 0.05 + (spec === undefined ? 0.45 : spec);
  }
  return +s.toFixed(3);
}
/* the clip durations, by id. Taken from BALANCE.train.clip rather than by
   importing dog/anim/tricks.js, because the STATE layer must not depend on the
   dog layer — the same separation state/walks.js keeps. `standUp` is a posture
   rather than a trick and costs only the beat, which is why it is 0. */
const TRICKS_DUR = { ...BALANCE.train.clip, standUp: 0 };
/** how deep a trick is, 0..1, from how demanding it is AND how well practised */
export function depthOf(id, level) {
  const d = clampNum(K.depth[id], 1, 3, 1);
  const lv = clampNum(level, 0, 3, 0);
  return clamp(K.free.depthShare * ((d - 1) / 2) + (1 - K.free.depthShare) * (lv / 3), 0, 1);
}

/** the free window's multiplier: shallow tricks still score, deep ones win */
export function freeMul(id, level) {
  return K.free.floor + (1 - K.free.floor) * depthOf(id, level);
}

/**
 * Mark ONE asked trick, 0..1.
 *
 * @param r  a dog/train.js performance result:
 *           { asked, trick, correct, outcome, latency, held, holdKept }
 * @param o  { hold: seconds asked for (0 = none), par: extra seconds allowed }
 */
export function markAsk(r, o = {}) {
  const M = K.mark;
  if (!r) return 0;
  /* HE LOOKED AT SOMETHING ELSE. Never a nil — he is a dog, and a zero here
     would read as the game telling her he is a bad dog. */
  if (r.outcome === 'ignore') return M.ignoreCredit;

  const wantHold = num(o.hold, 0) > 0;
  /* with no hold to mark, its share is redistributed rather than lost */
  let wC = M.correct, wS = M.speed, wH = wantHold ? M.hold : 0;
  if (!wantHold) {
    const share = M.hold / (M.correct + M.speed);
    wC += M.correct * share; wS += M.speed * share;
  }
  const tot = wC + wS + wH;

  /* HE DID A TRICK, JUST NOT THAT ONE. Partial credit, warmly. */
  const base = r.correct ? 1 : M.wrongCredit;

  /* speed, against a par that a sequence's second trick is given more of */
  const par = M.par + Math.max(0, num(o.par, 0));
  const slow = M.slow + Math.max(0, num(o.par, 0));
  const lat = num(r.latency, slow);
  const speed = lat < 0 ? 0 : clamp((slow - lat) / Math.max(0.01, slow - par), 0, 1);

  /* THE HOLD: the share of what the JUDGE ASKED FOR that he actually managed.
     Deliberately NOT `holdKept` — that flag means "he held it for as long as
     HE can", and dog/train.js is told to release him at the asked duration
     when the ask is the shorter of the two (so a round never drags). Scoring
     the flag would therefore award full marks to a dog who managed 0.55s of a
     3.10s Championship hold, which is the exact thing this round exists to
     measure. `held / asked` is always the honest number. */
  let hold = 0;
  if (wantHold) {
    hold = clamp(num(r.held, 0) / Math.max(0.01, num(o.hold, 1)), 0, 1);
  }

  let mark = base * (wC + wS * speed + wH * hold) / tot;
  /* he got there, he just thought about it first */
  if (r.outcome === 'hesitate') mark *= M.hesitate;
  return clamp(mark, 0, 1);
}

/**
 * Mark a whole round, 0..1.
 * @param round  from buildProgramme (plus `asks[i].level` for a free round)
 * @param results the performance results, in order
 */
export function markRound(round, results) {
  if (!round) return 0;
  const rs = results || [];
  /* the allowance each answer earns for the position it had to get into first */
  const par = (r) => chainPar(r && r.chain);
  if (round.kind === 'seq') {
    const a = markAsk(rs[0], { hold: 0, par: par(rs[0]) });
    /* ...plus the extra the second half of a sequence gets for following the
       first without a pause */
    const b = markAsk(rs[1], { hold: 0, par: par(rs[1]) + K.mark.chainAllowance });
    return clamp((a + b) / 2, 0, 1);
  }
  const ask = round.asks[0] || {};
  const m = markAsk(rs[0], { hold: ask.hold || 0, par: par(rs[0]) });
  /* THE FREE WINDOW: the deeper the trick, the more the same execution is
     worth. A flawless sit still scores; it just does not win a Championship. */
  if (round.kind === 'free') return clamp(m * freeMul(ask.id, ask.level), 0, 1);
  return m;
}

/** the weighted mean of the round marks — the performance, 0..1 */
export function performance(rounds, marks) {
  let sw = 0, s = 0;
  for (let i = 0; i < (rounds || []).length; i++) {
    const w = K.weight[rounds[i].kind] || 1;
    sw += w;
    s += w * clampNum(marks[i], 0, 1, 0);
  }
  return sw > 0 ? clamp(s / sw, 0, 1) : 0;
}

/* ==========================================================================
   GROOMING — the load-bearing detail
   ==========================================================================
   "Judged on performance AND grooming. Dirty/filthy -> points deducted;
   clean/beautiful -> bonus" (research §6.3). This is what makes the stage-2
   care loop earn its place rather than be a chore list: a bath before a trial
   is an obvious good idea she works out for herself, and it is worth up to
   1.70 points of swing, which is more than a whole class of the ladder.
*/
const step = (table, v) => {
  for (const [at, out] of table) if (v >= at) return out;
  return table[table.length - 1][1];
};

/** the signed grooming delta, in SCORE points */
export function groomDelta(cleanliness, gloss) {
  return +(step(K.groom.coat, clampNum(cleanliness, 0, 1, 0))
    + step(K.groom.gloss, clampNum(gloss, 0, 1, 0))).toFixed(3);
}

/** the per-DOG poise term. NEVER a breed term. */
export function poiseDelta(aptitude) {
  return +((clampNum(aptitude, 0, 1, 0.5) - 0.5) * 2 * K.poise).toFixed(3);
}

/**
 * THE SCORE: 0.00 - 10.00, to two decimals.
 *
 *   score = performance * perfSpan + grooming + poise
 *
 * `perfSpan` is 9.40, not 10: a flawless run on a NORMAL coat lands at 9.40
 * and the last 0.60 has to come from grooming. That is why >9.60 — the
 * Championship win — is unreachable on a dirty dog however well he performs,
 * and it is the whole reason grooming is in the brief.
 */
export function finalScore({ performance: p, cleanliness, gloss, aptitude }) {
  const raw = clampNum(p, 0, 1, 0) * K.perfSpan
    + groomDelta(cleanliness, gloss)
    + poiseDelta(aptitude);
  return +clamp(raw, 0, 10).toFixed(2);
}

/** the same sum, itemised — the result card shows its working */
export function scoreBreakdown({ performance: p, cleanliness, gloss, aptitude }) {
  const perf = +(clampNum(p, 0, 1, 0) * K.perfSpan).toFixed(2);
  const groom = groomDelta(cleanliness, gloss);
  const poise = poiseDelta(aptitude);
  return {
    performance: +clampNum(p, 0, 1, 0).toFixed(4),
    perfPoints: perf,
    groom: +groom.toFixed(2),
    poise: +poise.toFixed(2),
    total: +clamp(perf + groom + poise, 0, 10).toFixed(2),
  };
}

/* ==========================================================================
   THE FIELD
   ==========================================================================
   No other dogs are simulated and none is ever drawn — they are four numbers
   and a name each. That is enough for a placing to mean something and it costs
   nothing, which is the correct trade for a contest that is really about the
   dog in the room.
*/
/** roughly-normal, from a seeded uniform stream */
function gauss(rng) {
  return (rng.next() + rng.next() + rng.next() - 1.5) * 1.15;
}

/** @returns [{name, score}] for the rivals only, best first */
export function rollRivals(classId, rng, field = K.field) {
  const c = CLASS_BY_ID[classId] || CLASSES[0];
  const n = Math.max(0, Math.round(num(field, K.field)) - 1);
  const names = K.rivals.slice();
  const out = [];
  for (let i = 0; i < n; i++) {
    const ni = Math.min(names.length - 1, (rng.next() * names.length) | 0);
    const name = names.splice(ni, 1)[0] || 'A good dog';
    out.push({ name, score: +clamp(c.rival.mean + c.rival.sd * gauss(rng), 0, 10).toFixed(2) });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** 1-indexed placing. TIES GO TO HIM — the judge liked him better. */
export function placeIn(score, rivals) {
  let above = 0;
  for (const r of (rivals || [])) if (r.score > score) above++;
  return above + 1;
}

export const promotes = (placing) => num(placing, 99) <= K.promoteAt;

/** prize in COINS. Nothing below third pays, exactly as the original. */
export function prizeFor(classId, placing) {
  const c = CLASS_BY_ID[classId] || CLASSES[0];
  const i = Math.round(num(placing, 99)) - 1;
  return (i >= 0 && i < c.prize.length) ? c.prize[i] : 0;
}

/* ==========================================================================
   THE CHAMPIONSHIP
   ==========================================================================
   ">= 9.00 average to hold, > 9.60 to win" (research §6.3). Both numbers are
   kept because they give the ceiling a real name.

   "Hold" is a STANDING, NOT A RANK SHE CAN LOSE. Demoting a class for a bad
   day is precisely the rebuke SCOPE.md forbids, so `holding: false` costs
   nothing but the words on the card — and the words are about him needing more
   practice, never about her.
*/
export function champStanding(scores) {
  const list = (scores || []).slice(-K.champion.holdWindow).map((v) => clampNum(v, 0, 10, 0));
  if (!list.length) return { avg: 0, holding: false, n: 0, need: K.champion.holdWindow };
  const avg = +(list.reduce((a, b) => a + b, 0) / list.length).toFixed(2);
  return {
    avg,
    /* the standing is only claimed once there is a full window to claim it on */
    holding: list.length >= K.champion.holdWindow && avg >= K.champion.holdAt,
    n: list.length,
    need: Math.max(0, K.champion.holdWindow - list.length),
  };
}

export const winsChampionship = (score) => num(score, 0) > K.champion.winAt;

/* ==========================================================================
   THE LADDER, AS ARITHMETIC
   ==========================================================================
   "Compress the grind to days, not months." This function is the proof: give
   it a per-entry probability of placing top-three and it returns how many days
   the Championship is away at `perDay` entries a day. It exists so the claim
   in the notes is a calculation rather than a hope, and so a later tuning pass
   can check it in one call.
*/
export function ladderDays(pPlace = 0.75, perDay = K.perDay) {
  const steps = CLASSES.length - 1;               // promotions needed
  const entriesPerStep = 1 / clamp(num(pPlace, 0.75), 0.05, 1);
  const entries = steps * entriesPerStep;
  return {
    promotions: steps,
    entriesPerPromotion: +entriesPerStep.toFixed(2),
    entriesExpected: +entries.toFixed(2),
    perDay,
    days: +(entries / Math.max(1, perDay)).toFixed(2),
  };
}

export default {
  CLASSES, CLASS_IDS, CLASS_BY_ID, classAt, classIndex, isTop,
  contestState, entryCheck, buildProgramme, askedHold,
  markAsk, markRound, performance, depthOf, freeMul,
  groomDelta, poiseDelta, finalScore, scoreBreakdown,
  rollRivals, placeIn, promotes, prizeFor,
  champStanding, winsChampionship, ladderDays,
};
