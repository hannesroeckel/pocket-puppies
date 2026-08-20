/* ==========================================================================
   dog/contest.js — THE OBEDIENCE TRIAL.

   The primary contest, and the mechanical payoff of the entire training
   system. One contest done beautifully beats three done thinly (SCOPE.md
   stage 5, research §6.3). Disc is reframed as catch-and-leap and ships only
   if there is budget; **Agility is cut and must not be built.**

   WHY IT IS A LAYER AND NOT A SCENE
   ---------------------------------
   The same reason care (§12), training (§13) and walks (§14) are layers: the
   trial is HIM, on the same rig, in the same room, with the same springs
   under him. Research §6.3 calls Obedience a "perfect fit" for a near-frontal
   camera precisely because the dog stands still and performs at you. A scene
   boundary would throw away the rig, the baked room canvas and the petting
   field, and buy nothing. `scenes/contest.js` is therefore not built.

   The room is DRESSED as a ring instead: cooled and dimmed, a spotlight drawn
   UNDER him (so the room dims and he does not), a mat on the rug, and a
   judge's board. That is a contest for the cost of four gradients.

   THE LOOP
   --------
     1  THE JUDGE CALLS a trick, out loud, by name. `train.perform(id,
        {judged:true})` asks BY ID, bypassing cue interpretation entirely —
        he does not have to read a hand, because the judge said the word.
     2  SHE MAY BACK HIM UP, inside the call beat, with the signal she taught
        him — BY HAND OR BY VOICE, at exactly equal status. That steadies him
        (`boost`) and he starts a little sooner (`hurry`).
     3  HE PERFORMS, and `onPerform` delivers what the judge scores.
     4  THE ROUND IS MARKED, 0..1 (state/contest.js).
   Then holds, a sequence, and a FREE WINDOW where SHE picks and the deeper
   tricks earn the big points.

   THE THING SHE MAY NOT DO IS TOUCH HIM
   -------------------------------------
   In the original that was the whole point: no stylus on the dog, which made
   the trial the true test of whether the training had actually worked. It is
   honoured literally here — a touch on him in the ring is absorbed and gets
   one warm line, once. What is NOT forbidden is TAPPING: SCOPE.md is explicit
   that "what's forbidden during a trial is petting him through it, not
   tapping", which is why the cue pad exists and why voice is never required.

   TWO RULES THAT OUTRANK FAITHFULNESS
   -----------------------------------
   1. LOSING IS NEVER A REBUKE. Read `COPY` below and check: there is not one
      line in this file that describes HER. A poor score is him being
      distracted, or a trick that wants more practice. He gets a mood lift on
      a last place. There is no demotion at any score. The daily cap does not
      close the ring, it makes the trial a practice round.
   2. BREED IS COSMETIC. Nothing here reads a breed, and the only per-dog
      term in the score is the `poise` jitter every dog rolls for itself.

   PLAYER-FACING COPY LIVES IN `COPY` BELOW, AND ONLY THERE. Pronouns come
   from `game.pron` at call time — the gift puppy is male and a later dog may
   not be, so no string in this file may hardcode one.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { makeSprings } from '../engine/spring.js';
import { TAU, clamp, lerp, smooth, hump, easeOut3, easeOutBack, roundRect, ell } from '../engine/draw.js';
import { rng as sharedRng } from '../engine/rng.js';
import { createRng } from '../engine/rng.js';
import { capitalise } from '../state/game.js';
import { trickName, TRICKS } from './anim/tricks.js';
import { createSignalReader } from './train.js';
import { utteranceSim } from './voice.js';
import {
  contestState, classAt, isTop, entryCheck, buildProgramme, askedHold,
  markRound, performance as perfMean, finalScore, scoreBreakdown, groomDelta,
  rollRivals, placeIn, promotes, prizeFor, champStanding, winsChampionship,
  freeMul,
} from '../state/contest.js';
import { drawText, drawStack, drawPlate, safeBand, measure } from '../ui/text.js';
/* CHROME ONLY — the ring's own art (ribbons, rosettes, the judge's board) is
   scene art and stays in `C` below. This is the one primary action. */
import { INK, SURF, PRESS } from '../ui/tokens.js';
import { primaryAction } from '../ui/surface.js';

const K = BALANCE.contest;
const R = K.ring;
const B = K.beats;
const VW = BALANCE.view.W;
const VH = BALANCE.view.H;

/* ==========================================================================
   COPY — every player-facing string in stage 5, in one place.
   `P` is game.pron ({they, them, their, is, has, s}), `n` is his name or ''.
   NEVER write a pronoun into a string; interpolate P.

   THE TEST THIS TABLE HAS TO PASS: not one line may describe HER. Every line
   about a poor result is about him being distracted or about a trick wanting
   more practice. No guilt, ever — it outranks faithfulness.
   ========================================================================== */
const COPY = {
  /* ---- the entry panel ---- */
  title: () => 'Obedience Trial',
  inClass: (name) => `${name} class`,
  entriesLeft: (n) => (n === 1 ? 'One entry left today' : `${n} entries left today`),
  practiceRound: () => 'The ring is quiet now — a practice round',
  practiceNote: (P) => 'No prize and no placing. Just the two of you.',
  bestSoFar: (s) => `Best so far ${s.toFixed(2)}`,
  noBest: (P) => `${capitalise(P.they)} ${P.has} not been in a ring yet`,
  standing: (avg) => `Championship average ${avg.toFixed(2)}`,
  standingHeld: () => 'Holding your place',
  standingSoon: (n) => (n === 1 ? 'One more trial to set an average' : `${n} more trials to set an average`),
  championIs: (P, n) => `${n || capitalise(P.they)} won the Championship`,
  enter: () => 'Into the ring',
  notToday: () => 'Not today',
  /* WHEN THE GATE IS SHUT, THE BUTTON BECOMES THE FIX. Pressing it takes her
     to the bowl or to the training corner rather than telling her no twice —
     which is the difference between a gate that reads as looking after him and
     one that reads as a locked door. */
  gateGo: (P, reason) => ({
    hunger: `Feed ${P.them} first`,
    thirst: `Water ${P.them} first`,
    untrained: 'Teach a trick first',
  }[reason] || 'Not today'),
  /* ---- the entry gate. IT OFFERS THE BOWL. It never refuses her. ---- */
  gateHunger: (P, n) => `${n || capitalise(P.they)} ${P.is} hungry — a bowl first`,
  gateThirst: (P, n) => `${n || capitalise(P.they)} ${P.is} thirsty — some water first`,
  gateNote: () => 'A trial is a long half hour on an empty stomach',
  gateUntrained: (P) => `${capitalise(P.they)} ${P.has} nothing to show the judge yet`,
  gateUntrainedNote: () => 'Teach a trick or two first — it only takes a few goes',

  /* ---- in the ring ---- */
  ringOpen: (P, n) => `${n || capitalise(P.they)} step${P.s} into the ring`,
  /* said by the room's arbiter when something else wants the screen */
  ringBusy: (P) => `${capitalise(P.they)} ${P.is} in the ring`,
  ringHands: () => 'Hands off from here — this bit is all his',
  ringHandsF: () => 'Hands off from here — this bit is all hers',
  judgeCalls: (t) => t,
  judgeHold: (t, s) => `${t} — and hold`,
  judgeSeq: (a, b) => `${a}, then ${b}`,
  judgeFree: () => 'Show me what you have taught him',
  judgeFreeF: () => 'Show me what you have taught her',
  cueHint: () => 'Give the signal if you like',
  cueHintVoice: () => 'Give the signal, or say the word',
  chooseHint: () => 'Pick one — the harder it is, the more it counts',
  /* ---- the marks. Every one of these is about HIM. ---- */
  markClean: (P) => 'Clean',
  markGood: (P) => 'Good',
  markSlow: (P) => 'A moment late',
  markShort: (P) => 'Let go early',
  markOther: (P, t) => `${t} instead`,
  markAway: (P) => `${capitalise(P.they)} looked away`,
  steadied: () => 'Steady',

  /* ---- the result ---- */
  place: (n) => ['First place', 'Second place', 'Third place', 'Fourth place', 'Fifth place'][n - 1] || `${n}th place`,
  noPlace: () => 'Out of the placings',
  perfLine: (v) => `Performance ${v.toFixed(2)}`,
  groomLine: (v, word) => `Grooming ${v >= 0 ? '+' : ''}${v.toFixed(2)} — ${word.toLowerCase()}`,
  coinsWon: (n) => (n === 1 ? '1 coin' : `${n} coins`),
  promoted: (name) => `Moving up to ${name}`,
  wonChampionship: () => 'Champion',
  /* the "you did not place" line. STILL ABOUT HIM, and still warm. */
  ranWell: (P, n) => `${n || capitalise(P.they)} did well out there`,
  ranDistracted: (P) => `${capitalise(P.they)} had one of those days`,
  ranClose: (P) => `${capitalise(P.they)} was not far off`,
  /* the grooming nudge, offered as an idea rather than as a fault */
  bathIdea: (P) => `A bath before the next one would show ${P.them} off`,
  practiceIdea: (t) => `${t} could do with a few more goes`,
  tapOn: () => 'Tap to carry on',
  leftEarly: () => 'Another day then',
};

/* ---- little art constants (scene art, not design tunables: §11 G) ------ */
const C = {
  board: '#3a2114', boardEdge: 'rgba(255,240,206,0.20)',
  ink: '#fff0d4', inkDim: 'rgba(255,240,212,0.72)',
  card: '#fff6e4', cardInk: '#5d3018',
  /* THE MAT, RECOLOURED FOR OUTDOORS. #7d9c90 over #5f7d72 was a cool blue-grey,
     chosen against the room's warm boards; on the show ring's grass it read as a
     puddle he was being asked to sit in. Warm sand with a trodden edge instead —
     the mat every ring in the country actually uses. */
  mat: '#d8c6a0', matEdge: '#ab9268',
  gold: '#e8b45c', goldD: '#bf8c37',
  ribbon: '#cf6e58', ribbonD: '#a8503d',
  chip: 'rgba(255,246,228,0.92)', chipDown: 'rgba(255,232,190,0.98)',
  teal: '#6c8b80',
  ok: '#8fc08a', meh: '#e3c07a', away: 'rgba(255,240,212,0.55)',
};

export function createContest(rig, opts = {}) {
  const game = opts.game;
  const pet = opts.pet;
  const idle = opts.idle;
  const train = opts.train;
  const voice = opts.voice || null;
  const rng = opts.rng || sharedRng;
  const reduced = !!opts.reduced;
  const spawn = opts.spawn || (() => {});
  const sound = opts.sound || (() => {});
  const toast = opts.toast || (() => {});
  /* WHERE A SHUT GATE SENDS HER. The layer does not open a care action itself
     — it does not own care — it says WHAT is wanted and lets scenes/room.js
     route it, which is also the only place allowed to take the surface. */
  const onNeed = opts.onNeed || (() => {});

  const sp = makeSprings(['ringW', 'board', 'card', 'chip', 'mark'], reduced);
  const reader = createSignalReader();

  /* ---- the trial ---------------------------------------------------- */
  let beat = '';                // '' | 'entry' | 'ring' | 'card'
  let phase = '';               // within 'ring': intro|call|await|mark|choose|tally
  let t = 0;                    // seconds in the current phase
  let clock = 0;                // monotonic, own
  let trial = null;             // the live trial
  let gate = null;              // the entry check, for the panel
  let hint = '';
  let scoreShown = 0;           // the tally animation
  let handsOffSaid = false;
  let unsub = null;
  let pending = null;           // the ask we are waiting on
  let listening = false;

  const Pn = () => game.pron;
  const nm = () => (game.isNamed ? game.dog.name : '');
  const setHint = (s) => { hint = s; };

  /* ================================================================== */
  /*  starting and stopping                                             */
  /* ================================================================== */
  /** how many tricks he could actually be asked for */
  function repertoire() {
    return train ? train.repertoire() : [];
  }

  /** open the entry panel. The room's arbiter has already said it may. */
  function start() {
    if (beat) return false;
    const rep = repertoire();
    gate = entryCheck(game, { knows: rep.length });
    beat = 'entry';
    phase = '';
    t = 0;
    sp.ringW.to(1);
    sp.board.set(0); sp.board.to(1);
    return true;
  }

  /** leave, at any point, with no cost of any kind */
  function stop(quiet) {
    const wasRing = beat === 'ring';
    if (unsub) { unsub(); unsub = null; }
    beat = ''; phase = ''; t = 0;
    trial = null; pending = null; gate = null;
    hint = '';
    handsOffSaid = false;
    reader.cancel();
    sp.ringW.to(0);
    sp.board.to(0);
    sp.card.to(0);
    sp.chip.to(0);
    /* NOTHING IS BANKED AND NOTHING IS CHARGED. An abandoned trial does not
       spend an entry, which is why there is no persisted trial record to
       migrate and why a phone call can never cost her anything. */
    if (wasRing && !quiet) toast(COPY.leftEarly());
    return true;
  }

  /* ================================================================== */
  /*  the trial itself                                                  */
  /* ================================================================== */
  function beginTrial() {
    const rep = repertoire();
    const cls = classAt(contestState(game.state).classIdx);
    /* deterministic from a seed, exactly like state/walks.js `rollFinds`, so
       a trial is replayable and a 4000-run statistical sweep is possible */
    const seed = (Date.now() ^ (contestState(game.state).entries * 2654435761)) & 0x7fffffff;
    const tr = createRng(seed);
    const rounds = buildProgramme(cls.id, rep, tr);
    if (!rounds.length) { stop(true); return false; }

    trial = {
      seed, rng: tr, cls, rounds, marks: [], results: [],
      i: 0, askIdx: 0, roundResults: [],
      assisted: false, assists: 0, watchdogs: 0,
      /* THE MOOD SHE BROUGHT HIM IN WITH. The ring holds him here for the
         duration and never lifts him above it — see `holdMood`. */
      mood0: game.moodLevel,
      practice: !!(gate && gate.practice),
      score: 0, done: false,
    };
    beat = 'ring';
    phase = 'intro';
    t = 0;
    scoreShown = 0;
    handsOffSaid = false;
    /* subscribe ONCE, for the whole trial. `perform` returns null on an
       ignore, so the callback is the only reliable channel (§13.2). */
    if (unsub) unsub();
    unsub = train.onPerform(onResult);
    setHint('');
    sound('perk');
    return true;
  }

  /**
   * THE RING DOES NOT WEAR HIM DOWN.
   *
   * Mood decays toward a baseline that a fresh dog's low affection puts at
   * about 0.16, at 0.085/s. MEASURED over a Championship programme: 0.95 at
   * the first call, ~0.25 by the last. Since mood gates every obedience roll,
   * the trial was quietly getting harder as it went, and the free window — the
   * round that is supposed to be the payoff — was hit hardest. She cannot
   * cheer him up either, because petting is the one thing a trial forbids.
   *
   * So the ring holds him AT THE LEVEL SHE BROUGHT HIM IN WITH. It never lifts
   * him above it, so mood is still entirely earned outside the ring and a flat,
   * unbonded dog still has a flat, unbonded trial — which is the gate working.
   * What it stops is the trial being a war of attrition against its own length.
   */
  function holdMood(dt) {
    if (beat !== 'ring' || !trial) return;
    const want = trial.mood0;
    const now = game.moodLevel;
    if (now >= want) return;
    game.addMood(Math.min(want - now, K.ringLift * Math.max(0, dt)));
  }

  const round = () => (trial && trial.rounds[trial.i]) || null;

  /** the trick currently being asked for, or '' */
  function askingId() {
    const r = round();
    if (!r || !r.asks[trial.askIdx]) return '';
    return r.asks[trial.askIdx].id;
  }

  /** what the judge's board says right now */
  function boardLine() {
    const r = round();
    if (!r) return '';
    if (r.kind === 'free' && !r.asks.length) {
      return game.dog.sex === 'f' ? COPY.judgeFreeF() : COPY.judgeFree();
    }
    if (r.kind === 'seq') {
      return COPY.judgeSeq(trickName(r.asks[0].id), trickName(r.asks[1].id));
    }
    const a = r.asks[trial.askIdx] || r.asks[0];
    if (!a) return '';
    if (a.hold > 0) return COPY.judgeHold(trickName(a.id), a.hold);
    return COPY.judgeCalls(trickName(a.id));
  }

  /* ---- the ask ---------------------------------------------------- */
  function fireAsk() {
    const r = round();
    if (!r) return;
    const a = r.asks[trial.askIdx];
    if (!a) return;
    /* the steadying cue, if she gave one inside the call beat. ALWAYS
       POSITIVE AND NEVER REQUIRED — see the header. */
    const boost = trial.assisted ? K.assist.reliability : 0;
    const hurry = trial.assisted ? K.assist.speed : 0;
    /* hold him for what the judge asked, or for what he can manage, whichever
       is SHORTER — so a round never drags, and a hold he cannot reach is
       scored honestly as `held / asked` rather than as a kept flag */
    const canHold = train.holdFor(a.id);
    const holdOpt = a.hold > 0 ? Math.min(canHold, a.hold) : undefined;
    pending = { id: a.id, at: clock };
    phase = 'await';
    t = 0;
    train.perform(a.id, { judged: true, boost, hurry, hold: holdOpt });
  }

  /** every performance result, as it lands */
  function onResult(res) {
    if (!trial || !pending || phase !== 'await') return;
    if (!res || !res.judged) return;
    /* the ignore case arrives with `asked` set and `trick` empty */
    if (res.asked && res.asked !== pending.id) return;
    pending = null;
    trial.roundResults.push(res);
    trial.results.push(res);

    const r = round();
    if (r && r.kind === 'seq' && trial.askIdx === 0) {
      /* straight on to the second half — a sequence is one breath */
      trial.askIdx = 1;
      phase = 'call';
      t = 0;
      trial.assisted = false;
      reader.cancel();
      return;
    }
    finishRound();
  }

  function finishRound() {
    const r = round();
    if (!r) return;
    const mark = markRound(r, trial.roundResults);
    trial.marks.push(mark);
    sp.mark.set(0); sp.mark.to(1);
    setHint(markWord(r, trial.roundResults, mark));
    phase = 'mark';
    t = 0;
  }

  /** ONE WARM WORD about what he just did. Never about her. */
  function markWord(r, results, mark) {
    const P = Pn();
    const last = results[results.length - 1];
    if (!last) return '';
    if (last.outcome === 'ignore') return COPY.markAway(P);
    if (!last.correct && last.trick) return COPY.markOther(P, trickName(last.trick));
    const a = r.asks[Math.min(trial.askIdx, r.asks.length - 1)] || {};
    if (a.hold > 0 && (last.held || 0) < a.hold - 0.12) return COPY.markShort(P);
    if (mark >= 0.88) return COPY.markClean(P);
    if (last.outcome === 'hesitate' || (last.latency || 0) > K.mark.par + 0.5) return COPY.markSlow(P);
    return COPY.markGood(P);
  }

  function nextRound() {
    trial.i++;
    trial.askIdx = 0;
    trial.roundResults = [];
    trial.assisted = false;
    reader.cancel();
    if (trial.i >= trial.rounds.length) { tally(); return; }
    const r = round();
    phase = r.pick === 'her' ? 'choose' : 'call';
    t = 0;
    sp.board.set(0.4); sp.board.to(1);
    if (r.pick === 'her') { sp.chip.set(0); sp.chip.to(1); setHint(COPY.chooseHint()); }
    else setHint(cueHint());
  }

  const cueHint = () => ((voice && voice.armed && !voice.retired) ? COPY.cueHintVoice() : COPY.cueHint());

  /* ---- SHE PICKS, in the free window -------------------------------- */
  /** the tricks offered in the free window, deepest first */
  function freeChoices() {
    const rep = repertoire();
    const known = rep.filter((x) => x.level >= 1);
    const src = known.length ? known : rep;
    return src
      .map((x) => ({ ...x, mul: freeMul(x.id, x.level) }))
      .sort((a, b) => b.mul - a.mul || b.reliability - a.reliability)
      .slice(0, R.chip.max);
  }

  function chooseFree(id) {
    const r = round();
    if (!r || r.kind !== 'free' || phase !== 'choose') return false;
    const rep = repertoire().find((x) => x.id === id);
    if (!rep) return false;
    r.asks = [{ id, hold: 0, level: rep.level }];
    /* CHOOSING IS PARTICIPATING. She pointed at what she wanted; that is a
       cue by any reasonable reading, so it steadies him exactly as a drawn
       signal does. One tap, one round — asking for the shape twice would be
       bookkeeping, not a game. */
    trial.assisted = true;
    trial.assists++;
    sp.chip.to(0);
    sp.board.set(0.4); sp.board.to(1);
    phase = 'call';
    t = 0;
    setHint('');
    sound('cue');
    return true;
  }

  /** she let the window pass: the judge nods him on, and nothing is lost */
  function freeTimeout() {
    const r = round();
    const best = freeChoices()[0];
    if (!best) { finishRound(); return; }
    r.asks = [{ id: best.id, hold: 0, level: best.level }];
    trial.assisted = false;
    sp.chip.to(0);
    sp.board.set(0.4); sp.board.to(1);
    phase = 'call';
    t = 0;
  }

  /* ---- the sum ------------------------------------------------------ */
  function tally() {
    const p = perfMean(trial.rounds, trial.marks);
    const d = game.dog;
    const brk = scoreBreakdown({
      performance: p,
      cleanliness: d.needs.cleanliness,
      gloss: game.gloss,
      aptitude: (d.aptitude && d.aptitude.obedience) || 0.5,
    });
    const score = brk.total;
    const rivals = rollRivals(trial.cls.id, trial.rng);
    const placing = placeIn(score, rivals);
    const prize = trial.practice ? 0 : prizeFor(trial.cls.id, placing);
    const won = isTop(contestState(game.state).classIdx) && winsChampionship(score);

    const banked = game.recordContest({
      score, placing, prize,
      practice: trial.practice,
      promoted: promotes(placing),
      won,
    });

    /* ---- WHAT A TRIAL PAYS -------------------------------------------
       COINS (skill and luck) through `recordContest` -> `addCoins`.
       The BOND through the once-a-day ledger, at ANY score, because the thing
       that bonded them was doing it together (ARCHITECTURE §14.2 requires the
       award to go through `awardDay`, never through a raw affection write).
       CARE POINTS: ZERO. That is the separation. */
    game.awardDay('contest');
    const lift = placing === 1 ? K.mood.win : (promotes(placing) ? K.mood.place : K.mood.ran);
    game.addMood(lift);

    trial.score = score;
    trial.brk = brk;
    trial.rivals = rivals;
    trial.placing = placing;
    trial.banked = banked;
    trial.won = banked.won;
    trial.groomWord = game.describeNeed('cleanliness');
    trial.done = true;
    phase = 'tally';
    t = 0;
    scoreShown = 0;
    setHint('');
    if (idle) { idle.cancel(0.6); idle.play(placing <= 3 ? 'wagBurst' : 'perkUp'); }
    sound(placing === 1 ? 'proud-yip' : 'praise');
  }

  function showCard() {
    beat = 'card';
    phase = '';
    t = 0;
    sp.card.set(0); sp.card.to(1);
    const P = Pn();
    if (trial.placing <= 3 && !reduced) {
      const h = rig.headWorld();
      for (let i = 0; i < (trial.placing === 1 ? 9 : 5); i++) {
        spawn('heart', h.x + rng.range(-30, 30), h.y + rng.range(-26, 6));
      }
    }
  }

  /* ================================================================== */
  /*  update                                                            */
  /* ================================================================== */
  function update(dt, mood) {
    clock += dt;
    t += dt;
    reader.tick(dt);
    for (const k in sp) sp[k].step(dt);
    if (!beat) return;
    holdMood(dt);

    if (beat === 'ring') {
      if (phase === 'intro') {
        if (t >= B.intro) { phase = 'call'; t = 0; setHint(cueHint()); }
        return;
      }
      if (phase === 'call') {
        /* THE CALL BEAT **IS** THE ASSIST WINDOW. */
        if (t >= B.call) fireAsk();
        return;
      }
      if (phase === 'await') {
        /* WATCHDOG. `perform` returns null while he is still finishing the
           last thing, and a trial that hangs is worse than a trial he fluffs.
           A timeout is recorded as him having looked away — which is a real
           outcome with a real (non-zero) mark, not an error. */
        if (t >= B.maxRound) {
          pending = null;
          trial.watchdogs++;
          const a = (round().asks[trial.askIdx]) || {};
          const miss = {
            trick: '', asked: a.id || '', outcome: 'ignore', correct: false,
            latency: -1, held: 0, judged: true,
          };
          trial.roundResults.push(miss);
          trial.results.push(miss);
          const r = round();
          if (r && r.kind === 'seq' && trial.askIdx === 0) {
            trial.askIdx = 1; phase = 'call'; t = 0; trial.assisted = false;
          } else finishRound();
        }
        return;
      }
      if (phase === 'mark') {
        if (t >= B.settle) { phase = 'gap'; t = 0; setHint(''); }
        return;
      }
      if (phase === 'gap') {
        if (t >= B.gap) nextRound();
        return;
      }
      if (phase === 'choose') {
        if (t >= B.choose) freeTimeout();
        return;
      }
      if (phase === 'tally') {
        const u = clamp(t / B.tally, 0, 1);
        /* the number climbs and settles rather than appearing — the two
           decimals are the moment, so they get an animation */
        scoreShown = trial.score * easeOut3(u);
        if (t >= B.tally + 0.35) showCard();
        return;
      }
    }
  }

  /* ================================================================== */
  /*  apply — TARGETS ONLY. Runs where care/train/walk apply.           */
  /* ================================================================== */
  function apply(dt, mood) {
    if (!beat) return;
    const w = sp.ringW.x;
    if (w < 0.01) return;
    /* The trial writes almost no pose: the whole point is that HE is doing the
       work through dog/train.js. All it adds is that he faces the judge —
       i.e. the camera — and stands a little more squarely than he idles. */
    const s = rig.springs;
    const k = w * (beat === 'ring' ? 1 : 0.5);
    s.perk.to(lerp(s.perk.t, 0.42, k * 0.5));
    if (phase === 'call' || phase === 'choose' || phase === 'intro') {
      /* he watches the judge's board — and the eyes lead the head there, as
         they lead everywhere else (§11 C). A fixed virtual point rather than
         the safe-area-resolved one, because `apply` has no view and a gaze
         target 20 units out is not a thing anyone can see. */
      rig.lookAtVirtual(VW / 2, 150);
    }
  }

  /* ================================================================== */
  /*  input                                                             */
  /* ================================================================== */
  function inPad(x, y) {
    const A = K.assist.pad;
    return y >= A.top && y <= A.bottom;
  }
  function chipBounds(i, n) {
    const CH = R.chip;
    const total = n * CH.w + (n - 1) * CH.gap;
    const x0 = (VW - total) / 2;
    return { x: x0 + i * (CH.w + CH.gap), y: CH.y - CH.h / 2, w: CH.w, h: CH.h };
  }
  const inBack = (x, y) => Math.hypot(x - R.back.x, y - R.back.y) <= R.back.r + 14;

  /**
   * The entry button, derived from the panel so the draw and the hit test can
   * never drift apart. `rise` is the panel's slide-in offset, which the hit
   * test deliberately IGNORES — a target that moves while it animates in is a
   * target she can miss for reasons she cannot see.
   */
  function enterBox() {
    const E = R.enter;
    return {
      x: VW / 2, y: R.panel.y + R.panel.h / 2 - E.inset,
      w: E.w, h: E.h, r: E.r,
    };
  }

  /**
   * @returns true if the contest consumed it. IT ALWAYS DOES while it owns the
   *   surface — a touch falling through to the petting field would be petting
   *   him through a trial, which is the one thing the trial forbids.
   */
  function pointer(ev, local) {
    if (!beat) return false;

    if (beat === 'entry') {
      if (ev.type !== 'down') return true;
      if (inBack(ev.x, ev.y)) { stop(true); return true; }
      const E = enterBox();
      const onEnter = Math.abs(ev.x - E.x) <= E.w / 2 && Math.abs(ev.y - E.y) <= E.h / 2 + 8;
      if (onEnter) {
        if (gate && !gate.ok) {
          /* THE GATE HANDS HER THE FIX rather than refusing twice. Leave the
             ring FIRST, so the surface is free for whatever `onNeed` opens —
             the arbiter is exclusive and would otherwise refuse it. */
          const reason = gate.reason;
          toast(gateLine());
          stop(true);
          onNeed(reason);
          return true;
        }
        beginTrial();
        return true;
      }
      /* a tap on the room around the panel leaves, quietly */
      const P2 = R.panel;
      const insidePanel = Math.abs(ev.x - VW / 2) <= P2.w / 2
        && Math.abs(ev.y - P2.y) <= P2.h / 2;
      if (!insidePanel) stop(true);
      return true;
    }

    if (beat === 'card') {
      if (ev.type === 'down' && t > 0.45) stop(true);
      return true;
    }

    /* ---- in the ring ---- */
    if (ev.type === 'down' && inBack(ev.x, ev.y)) { stop(); return true; }

    /* the free window's chips */
    if (phase === 'choose' && ev.type === 'down') {
      const list = freeChoices();
      for (let i = 0; i < list.length; i++) {
        const b = chipBounds(i, list.length);
        if (ev.x >= b.x && ev.x <= b.x + b.w && ev.y >= b.y - 8 && ev.y <= b.y + b.h + 8) {
          chooseFree(list[i].id);
          return true;
        }
      }
      return true;
    }

    /* the "say it" bubble */
    if (voice && voice.armed && !voice.retired && ev.type === 'down') {
      const VB = K.assist.button;
      if (Math.hypot(ev.x - VB.x, ev.y - VB.y) <= VB.r + 14) { listen(); return true; }
    }

    /* ---- SHE MAY NOT PET HIM THROUGH IT ------------------------------
       Said once, warmly, and about the trial rather than about her. Then the
       touch is simply absorbed.

       MEASURED, NOT GUESSED, AND THE FIRST VERSION WAS WRONG. This was a box
       (`|local.x| < 118 && local.y > -330`), copied from the training layer's
       `halo` — which is deliberately generous because it means "her personal
       space", not "her body". The cue pad's centre resolves to rig-local
       y = -321.6, INSIDE that box, so every cue she drew was absorbed as a
       touch on him and she got the hands-off line instead of the assist.
       Measured with a real drawn path; `injectCue` passed the whole time,
       which is exactly why the pointer path had to be driven for real.

       `pet.hitZone` is the same test the petting field itself uses, over the
       same ten zones, so "she touched him" now means precisely what it says
       and cannot drift from what a touch actually does. Erring the other way
       is the kind direction: a near-miss becomes a cue, never a scolding. */
    const onDog = !!(pet && pet.hitZone(local.x, local.y));
    if (onDog && ev.type === 'down') {
      if (!handsOffSaid) {
        handsOffSaid = true;
        toast(game.dog.sex === 'f' ? COPY.ringHandsF() : COPY.ringHands());
      }
      return true;
    }

    /* ---- the cue pad: tap and voice at exactly equal status ---------- */
    if (!inPad(ev.x, ev.y)) return true;
    if (ev.type === 'down') { reader.down(ev.x, ev.y); return true; }
    if (ev.type === 'move') { reader.move(ev.x, ev.y); return true; }
    if (ev.type === 'up') {
      const got = reader.up();
      if (got.sig) offerCue(got.sig);
      return true;
    }
    if (ev.type === 'cancel') { reader.cancel(); return true; }
    return true;
  }

  /**
   * She gave a signal. If it is the one HE associates with what the judge just
   * called, it steadies him.
   *
   * A signal he does not know, or one bound to a different trick, costs
   * NOTHING. Making a wrong cue a deduction would turn helping him into a
   * gamble, and stage 5's rule is that helping is always optional and always
   * positive.
   */
  function offerCue(sig) {
    if (phase !== 'call' || trial.assisted) return false;
    const id = askingId();
    if (!id) return false;
    if (game.cueFor(id) !== sig) {
      /* he looks at her hand, then back at the judge. No mark, no word. */
      rig.springs.earL.kick(3.0); rig.springs.earR.kick(-2.6);
      return false;
    }
    trial.assisted = true;
    trial.assists++;
    rig.springs.perk.kick(2.4);
    rig.springs.eyeOpen.kick(1.2);
    setHint(COPY.steadied());
    sound('cue');
    return true;
  }

  /* ---- voice: an EXTRA, never a requirement ------------------------- */
  function listen() {
    if (!voice || !voice.armed || voice.retired || listening) return false;
    listening = true;
    Promise.resolve(voice.listen()).then((r) => {
      listening = false;
      if (r && r.ok && r.transcript) heard(r.transcript);
    }).catch(() => { listening = false; });
    return true;
  }

  /**
   * A heard word, during a trial. Routed here by scenes/room.js INSTEAD of
   * `train.heard`, which would try to teach or to ask and would start a second
   * performance on top of the judged one.
   *
   * Matching is against the word she taught for THIS trick's signal, so voice
   * and hand resolve through exactly the same `cue -> trick` table and can
   * never drift apart.
   */
  function heard(text) {
    if (beat !== 'ring' || phase !== 'call') return { kind: 'nothing' };
    const id = askingId();
    if (!id) return { kind: 'nothing' };
    const sig = game.cueFor(id);
    const word = sig ? game.wordFor(sig) : '';
    if (!word) return { kind: 'unknown' };
    const sim = utteranceSim(text, word);
    if (sim >= BALANCE.train.voice.match.accept) {
      return offerCue(sig) ? { kind: 'cue', sig, sim } : { kind: 'nothing', sim };
    }
    return { kind: 'unknown', sim };
  }

  /** the gate's one line, which offers a bowl rather than refusing an entry */
  function gateLine() {
    const P = Pn();
    if (!gate) return '';
    if (gate.reason === 'hunger') return COPY.gateHunger(P, nm());
    if (gate.reason === 'thirst') return COPY.gateThirst(P, nm());
    if (gate.reason === 'untrained') return COPY.gateUntrained(P);
    return '';
  }

  /* ================================================================== */
  /*  drawing                                                           */
  /* ================================================================== */
  /** the ring wash: UNDER the dog, so the room dims and he does not */
  function drawBack(g) {
    const w = sp.ringW.x;
    if (w < 0.005) return;
    const c = g.ctx;
    const BX = (g.view && g.view.bleedX) || 0;
    const BY = (g.view && g.view.bleedY) || 0;
    c.save();
    /* THE WASH IS GONE, AND THAT IS THE POINT. This used to dim and cool the
       LIVING ROOM — `R.dim` over #241a2e and `R.chill` over #3d5a6b — because a
       trial held on the rug had to be signalled somehow, and turning the lights
       down was the only signal available. `scenes/outdoors.js` now puts him in a
       show ring, so the signal is the place: mown stripes, a rope, bunting and a
       crowd. Two washes over a sunlit field would only make the field look like a
       living room at dusk, which is exactly the complaint that got the ring
       built. `R.dim`/`R.chill` stay in BALANCE, unread, next to this note.

    /* the mat he performs on */
    const M = R.mat;
    c.globalAlpha = w * 0.90;
    c.fillStyle = C.mat;
    ell(c, M.at[0], M.at[1], M.r[0], M.r[1]); c.fill();
    c.globalAlpha = w * 0.55;
    c.strokeStyle = C.matEdge; c.lineWidth = 3;
    ell(c, M.at[0], M.at[1], M.r[0] - 7, M.r[1] - 5); c.stroke();
    c.setLineDash([6, 8]);
    c.globalAlpha = w * 0.35;
    c.strokeStyle = '#eef4ef'; c.lineWidth = 1.8;
    ell(c, M.at[0], M.at[1], M.r[0] - 18, M.r[1] - 12); c.stroke();
    c.setLineDash([]);

    /* WHAT THE SPOTLIGHT BECAME. It was a stage light: a hot pool on the rug
       that made the dimmed room recede. Outdoors at eleven in the morning there
       is no stage light, so the same radial does a job daylight really does do —
       it lifts the mown grass around the mat, the way an open field is brightest
       where nothing shades it. Same geometry, a third of the strength, and it is
       still drawn UNDER him so he is never the thing being tinted (rule 2 of
       scenes/outdoors.js). */
    const S = R.spot;
    const sa = S.alpha * R.spotOutdoor;
    const rg = c.createRadialGradient(S.at[0], S.at[1], 20, S.at[0], S.at[1], S.r);
    rg.addColorStop(0, `rgba(255,250,226,${(sa * w).toFixed(3)})`);
    rg.addColorStop(0.55, `rgba(255,248,220,${(sa * 0.42 * w).toFixed(3)})`);
    rg.addColorStop(1, 'rgba(255,248,220,0)');
    c.globalAlpha = 1;
    c.fillStyle = rg;
    c.save();
    c.translate(S.at[0], S.at[1]); c.scale(1, 0.68); c.translate(-S.at[0], -S.at[1]);
    c.beginPath(); c.arc(S.at[0], S.at[1], S.r, 0, TAU); c.fill();
    c.restore();
    c.restore();
  }

  function drawFront(g) { /* nothing in front of him: the ring is behind */ }

  /* ---- the judge's board ------------------------------------------- */
  function drawBoard(g) {
    const a = sp.board.x;
    if (a < 0.02 || beat !== 'ring') return;
    const c = g.ctx;
    const band = safeBand(g.view);
    const y0 = band.top + R.boardTop - (1 - a) * 22;
    const x0 = (VW - R.boardW) / 2;
    c.save();
    c.globalAlpha = clamp(a, 0, 1);
    /* an OPAQUE board, so ui/text.js can check its contrast exactly against a
       known colour and add no plate of its own (that is what `over` is for) */
    c.fillStyle = C.board;
    roundRect(c, x0, y0, R.boardW, R.boardH, R.boardR); c.fill();
    c.strokeStyle = C.boardEdge; c.lineWidth = 1.6;
    roundRect(c, x0 + 2.5, y0 + 2.5, R.boardW - 5, R.boardH - 5, R.boardR - 2.5); c.stroke();
    /* the little brass clip at the top, so it reads as a board and not a bar */
    c.fillStyle = C.goldD;
    roundRect(c, VW / 2 - 17, y0 - 5, 34, 10, 5); c.fill();
    c.fillStyle = C.gold;
    roundRect(c, VW / 2 - 15, y0 - 6, 30, 7, 3.5); c.fill();
    c.restore();

    /* the class, small; the call, large. Both `over` the known board colour. */
    drawText(g, trial ? trial.cls.name : '', {
      x: VW / 2, y: y0 + 20, anchor: 'free', size: 10.5, weight: 700,
      ink: C.inkDim, over: C.board, maxWidth: R.boardW - 34, fade: a,
    });
    const line = boardLine();
    const flash = phase === 'call' ? 1 + hump(clamp(t / 0.34, 0, 1)) * 0.06 : 1;
    drawText(g, line, {
      x: VW / 2, y: y0 + 48, anchor: 'free', size: 19 * flash, weight: 800,
      ink: C.ink, over: C.board, maxWidth: R.boardW - 26, fade: a,
    });
    /* the round counter, so the trial has a visible shape */
    const n = trial ? trial.rounds.length : 0;
    const i = trial ? Math.min(trial.i + 1, n) : 0;
    if (n) {
      drawText(g, `${i} of ${n}`, {
        x: VW / 2, y: y0 + R.boardH - 16, anchor: 'free', size: 10, weight: 600,
        ink: C.inkDim, over: C.board, fade: a * 0.9,
      });
    }
    /* the marks so far, as pips — words for the last one, shapes for the rest */
    drawPips(g, y0 + R.boardH + 13, a);
  }

  function drawPips(g, y, a) {
    if (!trial) return;
    const c = g.ctx;
    const n = trial.rounds.length;
    const step = 15;
    const x0 = VW / 2 - ((n - 1) * step) / 2;
    c.save();
    for (let i = 0; i < n; i++) {
      const done = i < trial.marks.length;
      const m = done ? trial.marks[i] : 0;
      c.globalAlpha = a * (done ? 0.95 : 0.30);
      c.fillStyle = done ? (m >= 0.75 ? C.ok : (m >= 0.4 ? C.meh : C.away)) : 'rgba(255,240,212,0.5)';
      const r = done ? 5 : 3.4;
      const pop = (done && i === trial.marks.length - 1) ? 1 + hump(sp.mark.x) * 0.5 : 1;
      c.beginPath(); c.arc(x0 + i * step, y, r * pop, 0, TAU); c.fill();
    }
    c.globalAlpha = 1;
    c.restore();
  }

  /* ---- the free window's chips: HER choice -------------------------- */
  function drawChips(g) {
    const a = sp.chip.x;
    if (a < 0.02 || beat !== 'ring') return;
    const c = g.ctx;
    const list = freeChoices();
    if (!list.length) return;
    for (let i = 0; i < list.length; i++) {
      const b = chipBounds(i, list.length);
      const rise = (1 - a) * 16;
      c.save();
      c.globalAlpha = a;
      c.fillStyle = C.chip;
      roundRect(c, b.x, b.y + rise, b.w, b.h, R.chip.r); c.fill();
      c.globalAlpha = a * 0.20;
      c.strokeStyle = '#7c4a2f'; c.lineWidth = 1.2;
      roundRect(c, b.x, b.y + rise, b.w, b.h, R.chip.r); c.stroke();
      c.restore();
      /* the name, then how much the depth is worth — three little paws, which
         is the whole "deeper tricks pay more" rule said without a word */
      drawText(g, trickName(list[i].id), {
        x: b.x + b.w / 2, y: b.y + rise + 17, anchor: 'free',
        size: 12, weight: 700, ink: C.cardInk, over: C.chip,
        maxWidth: b.w - 12, fade: a,
      });
      const pips = Math.max(1, Math.round(list[i].mul * 3));
      c.save();
      c.globalAlpha = a * 0.85;
      for (let p = 0; p < 3; p++) {
        c.fillStyle = p < pips ? C.ribbon : 'rgba(124,74,47,0.20)';
        c.beginPath();
        c.arc(b.x + b.w / 2 + (p - 1) * 9, b.y + rise + 32, 3.2, 0, TAU);
        c.fill();
      }
      c.restore();
    }
  }

  /* ---- the running score ------------------------------------------- */
  function drawScore(g) {
    if (beat !== 'ring' || phase !== 'tally') return;
    const band = safeBand(g.view);
    drawText(g, scoreShown.toFixed(2), {
      x: VW / 2, y: band.top + R.scoreTop + 120, anchor: 'free',
      size: 46, weight: 800, ink: C.ink,
    });
  }

  /* ---- the entry panel --------------------------------------------- */
  function drawPanel(g) {
    if (beat !== 'entry') return;
    const c = g.ctx;
    const a = clamp(sp.board.x, 0, 1);
    const P = Pn();
    const cls = game.contestClass();
    const st = cls.standing;
    const left = game.contestEntriesLeft;
    const Pn2 = R.panel;
    const x0 = (VW - Pn2.w) / 2;
    const y0 = Pn2.y - Pn2.h / 2 + (1 - a) * 18;

    /* the backdrop: the ring wash is already down, this is just the card */
    c.save();
    c.globalAlpha = a;
    c.fillStyle = C.card;
    roundRect(c, x0, y0, Pn2.w, Pn2.h, Pn2.r); c.fill();
    c.globalAlpha = a * 0.16;
    c.strokeStyle = '#7c4a2f'; c.lineWidth = 1.4;
    roundRect(c, x0, y0, Pn2.w, Pn2.h, Pn2.r); c.stroke();
    c.restore();

    drawText(g, COPY.title(), {
      x: VW / 2, y: y0 + 30, size: 18, weight: 800,
      ink: C.cardInk, over: C.card, maxWidth: Pn2.w - 40, fade: a,
    });
    drawText(g, COPY.inClass(cls.name), {
      x: VW / 2, y: y0 + 54, size: 12.5, weight: 600,
      ink: 'rgba(93,48,24,0.78)', over: C.card, maxWidth: Pn2.w - 40, fade: a,
    });

    /* a rosette if he has ever won the top class */
    if (cls.won) drawRosette(c, x0 + Pn2.w - 34, y0 + 34, 16, a);

    const rows = [];
    rows.push(cls.best > 0 ? COPY.bestSoFar(cls.best) : COPY.noBest(P));
    if (cls.top) {
      rows.push(st.n >= 1 ? COPY.standing(st.avg) : COPY.standingSoon(st.need));
      if (st.holding) rows.push(COPY.standingHeld());
      if (cls.won) rows.push(COPY.championIs(P, nm()));
    }
    rows.push(left > 0 ? COPY.entriesLeft(left) : COPY.practiceRound());
    if (left <= 0) rows.push(COPY.practiceNote(P));

    for (let i = 0; i < rows.length; i++) {
      drawText(g, rows[i], {
        x: VW / 2, y: y0 + 86 + i * 21, size: 12, weight: 500,
        ink: 'rgba(93,48,24,0.86)', over: C.card, maxWidth: Pn2.w - 36, fade: a,
      });
    }

    /* THE GATE, said as an offer. Drawn INSIDE the card so it is part of the
       same warm object rather than an error banner over it. */
    const can = !!(gate && gate.ok);
    if (!can && gate) {
      drawText(g, gateLine(), {
        x: VW / 2, y: y0 + Pn2.h - 92, size: 12.5, weight: 700,
        ink: C.cardInk, over: C.card, maxWidth: Pn2.w - 32, fade: a,
      });
      drawText(g, gate.reason === 'untrained' ? COPY.gateUntrainedNote() : COPY.gateNote(), {
        x: VW / 2, y: y0 + Pn2.h - 72, size: 11, weight: 500,
        ink: 'rgba(93,48,24,0.70)', over: C.card, maxWidth: Pn2.w - 32, fade: a,
      });
    }

    /* THE BUTTON, INSIDE THE PANEL. When the gate is shut it is not greyed out
       and dead — it carries the fix, so there is always exactly one obvious
       thing to press. */
    /* THE PRIMARY ACTION (stage 9). Was `C.ribbon` terracotta with a hand-rolled
       3px offset rect for a shadow — which was a tactile edge drawn by someone
       who had not been told there was a name for it. It is now the same
       `primaryAction()` object as the install card's "Got it" and the map's
       "Set off", so the biggest button on all three surfaces is one thing.
       Drawn at rest: the entry panel tracks no press state, and inventing one
       inside the contest module is not worth reaching into it for. */
    const E = enterBox();
    const label = can ? COPY.enter() : COPY.gateGo(P, gate ? gate.reason : '');
    const EB = primaryAction(c, {
      x: E.x - E.w / 2, y: E.y - E.h / 2 + (1 - a) * 18 - PRESS.edge / 2,
      w: E.w, h: E.h, r: E.r, fade: a,
    });
    drawText(g, label, {
      x: E.x, y: EB.y + EB.h / 2, size: 15, weight: 800,
      ink: INK.onStrong, over: SURF.chipStrong, maxWidth: E.w - 22, fade: a,
    });
  }

  /* ---- the result card --------------------------------------------- */
  function drawCard(g) {
    if (beat !== 'card' || !trial) return;
    const c = g.ctx;
    const a = clamp(sp.card.x, 0, 1);
    const CD = R.card;
    const x0 = (VW - CD.w) / 2;
    const y0 = CD.y - CD.h / 2 + (1 - a) * 20;
    const P = Pn();

    c.save();
    c.globalAlpha = a;
    c.fillStyle = C.card;
    roundRect(c, x0, y0, CD.w, CD.h, CD.r); c.fill();
    c.globalAlpha = a * 0.16;
    c.strokeStyle = '#7c4a2f'; c.lineWidth = 1.4;
    roundRect(c, x0, y0, CD.w, CD.h, CD.r); c.stroke();
    c.restore();

    if (trial.placing <= 3) drawRosette(c, x0 + CD.w - 38, y0 + 40, 21, a);

    drawText(g, trial.placing <= 5 ? COPY.place(trial.placing) : COPY.noPlace(), {
      x: VW / 2 - (trial.placing <= 3 ? 14 : 0), y: y0 + 28, size: 14, weight: 700,
      ink: 'rgba(93,48,24,0.82)', over: C.card, maxWidth: CD.w - 80, fade: a,
    });
    /* THE NUMBER. Two decimals, big, because that is the moment. */
    drawText(g, trial.score.toFixed(2), {
      x: VW / 2, y: y0 + 68, size: 40, weight: 800,
      ink: C.cardInk, over: C.card, fade: a,
    });

    /* THE WORKING, SHOWN. Grooming is a separate, signed line on purpose: it
       is the thing the trial is teaching, and folding it into a total would
       hide the lesson the care loop exists to earn. */
    drawText(g, COPY.perfLine(trial.brk.perfPoints), {
      x: VW / 2 - 68, y: y0 + 100, size: 11.5, weight: 600, align: 'center',
      ink: 'rgba(93,48,24,0.78)', over: C.card, maxWidth: 138, fade: a,
    });
    drawText(g, COPY.groomLine(trial.brk.groom, trial.groomWord), {
      x: VW / 2 + 68, y: y0 + 100, size: 11.5, weight: 600, align: 'center',
      ink: trial.brk.groom < 0 ? '#a8503d' : '#4b7a4a', over: C.card, maxWidth: 148, fade: a,
    });

    /* the field, so a placing is a place among dogs and not a bare ordinal */
    const rows = [{ name: nm() || 'Your puppy', score: trial.score, you: true }]
      .concat(trial.rivals.map((r) => ({ ...r, you: false })))
      .sort((x, y2) => y2.score - x.score)
      .slice(0, 4);
    for (let i = 0; i < rows.length; i++) {
      const yy = y0 + 128 + i * 19;
      const mine = rows[i].you;
      drawText(g, `${i + 1}. ${rows[i].name}`, {
        x: x0 + 26, y: yy, align: 'left', size: 11.5, weight: mine ? 800 : 500,
        ink: mine ? C.cardInk : 'rgba(93,48,24,0.66)', over: C.card, maxWidth: 170, fade: a,
      });
      drawText(g, rows[i].score.toFixed(2), {
        x: x0 + CD.w - 26, y: yy, align: 'right', size: 11.5, weight: mine ? 800 : 500,
        ink: mine ? C.cardInk : 'rgba(93,48,24,0.66)', over: C.card, fade: a,
      });
    }

    /* what it was worth, and where it leads */
    const tail = [];
    if (trial.banked.prize > 0) tail.push(COPY.coinsWon(trial.banked.prize));
    if (trial.banked.promoted) tail.push(COPY.promoted(classAt(trial.banked.classIdx).name));
    if (trial.won) tail.push(COPY.wonChampionship());
    if (!tail.length) tail.push(consolation());
    drawText(g, tail.join('  ·  '), {
      x: VW / 2, y: y0 + CD.h - 34, size: 12.5, weight: 700,
      ink: C.cardInk, over: C.card, maxWidth: CD.w - 30, fade: a,
    });
    /* ONE IDEA FOR NEXT TIME, never a fault. Offered only when there is a
       genuinely useful one, and phrased as a suggestion about him. */
    const idea = nextIdea();
    if (idea) {
      drawText(g, idea, {
        x: VW / 2, y: y0 + CD.h - 15, size: 10.5, weight: 500,
        ink: 'rgba(93,48,24,0.66)', over: C.card, maxWidth: CD.w - 30, fade: a,
      });
    }
    drawText(g, COPY.tapOn(), {
      x: VW / 2, y: y0 + CD.h + 26, size: 11, weight: 600,
      ink: C.ink, fade: a * clamp((t - 0.5) / 0.5, 0, 1),
    });
  }

  /** the line when there is no prize and no promotion. STILL ABOUT HIM. */
  function consolation() {
    const P = Pn();
    const gap = trial.rivals.length ? trial.rivals[2] : null;
    if (gap && trial.score > gap.score - 0.45) return COPY.ranClose(P);
    if (trial.score >= 6.5) return COPY.ranWell(P, nm());
    return COPY.ranDistracted(P);
  }

  /** the single most useful thing for next time, or '' */
  function nextIdea() {
    const P = Pn();
    /* grooming first, because it is the biggest single lever and the one the
       care loop is here to teach */
    if (trial.brk.groom < 0) return COPY.bathIdea(P);
    /* otherwise the trick that let him down most */
    let worstId = '', worst = 1.01;
    for (let i = 0; i < trial.rounds.length; i++) {
      const a = trial.rounds[i].asks[0];
      const m = trial.marks[i];
      if (a && a.id && m < worst) { worst = m; worstId = a.id; }
    }
    if (worstId && worst < 0.72) return COPY.practiceIdea(trickName(worstId));
    return '';
  }

  function drawRosette(c, x, y, r, a) {
    c.save();
    c.globalAlpha = a;
    /* the tails */
    c.fillStyle = C.ribbonD;
    c.beginPath();
    c.moveTo(x - r * 0.4, y + r * 0.5);
    c.lineTo(x - r * 0.75, y + r * 1.9); c.lineTo(x - r * 0.1, y + r * 1.5); c.closePath(); c.fill();
    c.beginPath();
    c.moveTo(x + r * 0.4, y + r * 0.5);
    c.lineTo(x + r * 0.75, y + r * 1.9); c.lineTo(x + r * 0.1, y + r * 1.5); c.closePath(); c.fill();
    /* the frill */
    c.fillStyle = C.ribbon;
    for (let i = 0; i < 10; i++) {
      const th = (i / 10) * TAU;
      ell(c, x + Math.cos(th) * r * 0.62, y + Math.sin(th) * r * 0.62, r * 0.42, r * 0.30, th); c.fill();
    }
    c.fillStyle = C.gold;
    c.beginPath(); c.arc(x, y, r * 0.52, 0, TAU); c.fill();
    c.fillStyle = C.goldD;
    c.beginPath(); c.arc(x, y, r * 0.52, 0, TAU); c.stroke();
    c.globalAlpha = a * 0.55;
    c.fillStyle = '#fff6e0';
    ell(c, x - r * 0.16, y - r * 0.2, r * 0.2, r * 0.12, -0.5); c.fill();
    c.restore();
  }

  /* ---- the back button + the voice bubble --------------------------- */
  function drawChrome(g) {
    if (!beat) return;
    const c = g.ctx;
    const a = clamp(sp.ringW.x, 0, 1) * (beat === 'card' ? 0.35 : 1);
    c.save();
    c.globalAlpha = a * 0.30;
    c.fillStyle = '#fff8ea';
    c.beginPath(); c.arc(R.back.x, R.back.y, R.back.r, 0, TAU); c.fill();
    c.globalAlpha = a * 0.85;
    c.strokeStyle = '#5d3018'; c.lineWidth = 2.2; c.lineCap = 'round';
    c.beginPath();
    c.moveTo(R.back.x + 5, R.back.y - 6);
    c.lineTo(R.back.x - 4, R.back.y);
    c.lineTo(R.back.x + 5, R.back.y + 6);
    c.stroke();
    c.restore();

    /* the "say it" bubble. Drawn ONLY when voice is opted in and working, so
       the tap path never looks like the degraded one. */
    if (beat === 'ring' && voice && voice.armed && !voice.retired) {
      const VB = K.assist.button;
      const live = listening || voice.listening;
      c.save();
      c.globalAlpha = a * (live ? 0.92 : 0.42);
      c.fillStyle = live ? '#ffe0a8' : '#fff8ea';
      c.beginPath(); c.arc(VB.x, VB.y, VB.r + (live ? hump((clock * 1.6) % 1) * 2.5 : 0), 0, TAU); c.fill();
      c.globalAlpha = a * 0.85;
      c.fillStyle = '#5d3018';
      /* three rising bars: a microphone without drawing a microphone */
      for (let i = -1; i <= 1; i++) {
        const h = 7 + Math.abs(i) * -2.5 + (live ? Math.sin(clock * 7 + i) * 2.2 : 0);
        roundRect(c, VB.x + i * 6 - 1.6, VB.y - h / 2, 3.2, h, 1.6); c.fill();
      }
      c.restore();
    }
  }

  function drawOver(g) {
    if (!beat) return;
    drawBoard(g);
    drawScore(g);
    drawChips(g);
    drawPanel(g);
    drawCard(g);
    drawChrome(g);
    /* the one hint line, anchored to the safe area like everything else */
    if (hint && beat === 'ring' && phase !== 'tally') {
      drawText(g, hint, {
        x: VW / 2, y: R.chip.y - 74, anchor: 'free', size: 12.5, weight: 600,
        ink: C.ink, fade: clamp(sp.ringW.x, 0, 1),
      });
    }
  }

  /* ================================================================== */
  return {
    /** true while the layer exists at all (including the fade out) */
    get active() { return !!beat || sp.ringW.x > 0.01; },
    /** true while it owns the whole surface — chrome hides, arbiter blocks */
    get modal() { return !!beat; },
    /** true while he must not be petted, fed, walked or trained */
    get busy() { return !!beat; },
    /** true while it gets the pointer ahead of everything but the sheet */
    get owns() { return !!beat; },
    get beat() { return beat; },
    get phase() { return phase; },
    get weight() { return sp.ringW.x; },
    get hint() { return hint; },
    get listening() { return listening; },
    COPY,

    start, stop, update, apply, pointer, heard, listen,
    drawBack, drawFront, drawOver,

    /* ---- test / harness drivers (deterministic; nothing sleeps) ------ */
    /** skip the entry panel and go straight into the ring */
    enterRing() {
      if (beat !== 'entry') return false;
      if (!gate || !gate.ok) return false;
      return beginTrial();
    },
    /** what the judge is asking for right now */
    asking() { return askingId(); },
    /** the free window's offer, deepest first */
    choices() { return freeChoices().map((x) => ({ id: x.id, level: x.level, mul: +x.mul.toFixed(3) })); },
    choose(id) { return chooseFree(id); },
    /** give the steadying cue directly (the pointer path is exercised too) */
    injectCue(sig) { return offerCue(sig); },
    /** the entry check, without opening anything */
    check() { return entryCheck(game, { knows: repertoire().length }); },

    get result() {
      if (!trial || !trial.done) return null;
      return {
        score: trial.score, placing: trial.placing, prize: trial.banked.prize,
        promoted: trial.banked.promoted, practice: trial.practice,
        won: trial.won, breakdown: trial.brk,
        marks: trial.marks.map((m) => +m.toFixed(4)),
        rivals: trial.rivals,
        assists: trial.assists, watchdogs: trial.watchdogs,
        rounds: trial.rounds.map((r) => ({ kind: r.kind, asks: r.asks.map((a) => ({ ...a })) })),
        results: trial.results.map((r) => ({
          asked: r.asked, trick: r.trick, outcome: r.outcome, correct: r.correct,
          latency: r.latency, held: r.held,
        })),
      };
    },

    get debug() {
      const cls = game.contestClass();
      return {
        beat: beat || 'off', phase, t: +t.toFixed(2), w: +sp.ringW.x.toFixed(3),
        hint, asking: askingId(),
        gate: gate ? { ...gate } : null,
        cls: { id: cls.id, name: cls.name, index: cls.index, best: cls.best, won: cls.won },
        standing: cls.standing,
        entriesLeft: game.contestEntriesLeft,
        coins: game.coins, carePoints: game.carePoints,
        trial: trial ? {
          seed: trial.seed, i: trial.i, n: trial.rounds.length,
          practice: trial.practice, assisted: trial.assisted, assists: trial.assists,
          watchdogs: trial.watchdogs,
          rounds: trial.rounds.map((r) => r.kind + ':' + r.asks.map((a) => a.id + (a.hold ? '@' + a.hold : '')).join('+')),
          marks: trial.marks.map((m) => +m.toFixed(3)),
          score: trial.score, placing: trial.placing,
          brk: trial.brk || null,
        } : null,
        groomNow: +groomDelta(game.dog.needs.cleanliness, game.gloss).toFixed(2),
      };
    },
  };
}

export default createContest;
