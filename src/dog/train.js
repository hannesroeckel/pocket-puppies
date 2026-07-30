/* ==========================================================================
   dog/train.js — TRAINING: the ritual, the wobble, and the obedience roll.

   THE RITUAL (SCOPE.md stage 3, research §5)
   ------------------------------------------
        give the cue  ->  guide the pose with a finger  ->  reward in time

   1. CUE. A hand signal drawn in the air above her: tap, double-tap, hold,
      swipe up / down / left / right, or a circle. Eight arbitrary shapes.
      WHICH TRICK A SIGNAL MEANS IS LEARNED, NOT FIXED — that arbitrariness is
      what makes a wrong answer possible, and research is emphatic that the
      wrong answers are the charm.
   2. GUIDE. A gesture on her body, straight out of the DS trick table: stroke
      down over the head to sit; from a sit, the same stroke to lie down;
      stroke up the chest for beg; wiggle a paw for shake; circle low by the
      paws for spin; tap above the head for jump; sweep across a lying dog for
      roll over; press and hold her side for play dead. The posture is the
      prerequisite, not an XP gate: you cannot roll a standing dog over.
   3. REWARD. The window opens the instant the pose lands. Fill it quickly and
      the lesson lands properly; fill it late and it half-lands; miss it and
      she has had a nice time and learned almost nothing.

   THREE MECHANICS ARE LOAD-BEARING
   --------------------------------
   MIS-ASSOCIATION. At the moment of reward she decides what the signal meant.
   A long gap between signal and pose, a low mood, a dog who doesn't trust you
   yet, a scruffy signal, a late treat — any of them can attach the cue to the
   wrong trick, usually one she was doing a moment ago. It is visible (the cue
   legend is HER understanding, not your intention), it is legible (she does
   the wrong trick confidently and then asks for her treat), and it is
   recoverable (three patient correct reps and she lets the idea go).

   MISHEARING. A scruffy hand signal can be read as a neighbouring one — a lazy
   circle is a swipe, a slow double-tap is a hold. The signal read-back flashes
   what she THOUGHT you drew, so a mishearing is visible without a word of UI.
   This is why the tap path has the original's charm on its own and does not
   need the microphone to get it.

   RELIABILITY IS MOOD AND TRUST. `game.moodLevel` (fast) and `dog.trust`
   (slow) gate every roll. A happy bonded dog obeys first time. A flat one
   hesitates, guesses at a different trick, or looks out of the window. It
   never no-ops: "a no-op reads as a bug; a hesitation reads as a personality".

   NO XP BARS ANYWHERE. Progress is legible through her behaviour — how fast
   she answers, whether she gets it right, how eagerly — and where it needs
   words, it gets words (`knows it`, `steady`, `sharp`, `sure`, `muddled`).

   PIPELINE POSITION. `train.apply()` runs where `care.apply()` does, i.e.
   after `pet.apply()`, and the room skips `toy.apply()` while a performance
   owns the body (dog/toy.js resets rig placement every idle frame, which would
   fight the spin). Every layer here writes TARGETS ONLY.

   PLAYER-FACING COPY LIVES IN `COPY` BELOW, AND ONLY THERE. Pronouns come from
   `game.pron` at call time — the gift puppy is male, a later dog may not be,
   so no string in this file may hardcode one.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { makeSprings, approach } from '../engine/spring.js';
import { TAU, clamp, lerp, hump, ell, roundRect } from '../engine/draw.js';
import { rng as sharedRng } from '../engine/rng.js';
import { capitalise } from '../state/game.js';
import { TRICKS, TRICK_IDS, TRICK_POSE, trickName, endPosture } from './anim/tricks.js';
import { matchWord, utteranceSim, normWord } from './voice.js';

const T = BALANCE.train;
const SG = T.signal;
const O = T.obey;
const UI = BALANCE.ui.train;
const VW = BALANCE.view.W;

/* ==========================================================================
   COPY — every player-facing string in stage 3, in one place.
   `P` is game.pron ({they, them, their, is, has, s}), `n` is her name or ''.
   Never write a pronoun into a string; interpolate P.
   ========================================================================== */
const COPY = {
  enterFresh: (P) => `Draw a signal above ${P.them}, then show ${P.them} what it means`,
  enterKnown: (P) => `Give a signal — or teach ${P.them} a new one`,
  awaitGuide: () => 'Now guide the pose with a finger',
  rewardNow: () => 'Now — while it is still happening',
  rewardedCrisp: (P) => `${capitalise(P.they)} got that`,
  rewardedLate: (P) => `A bit late, but ${P.they} took it`,
  rewardMissed: (P) => `${capitalise(P.they)} waited for a treat`,
  learned: (P, n, t) => `${n || capitalise(P.they)} ${P.has} learned ${t}`,
  levelUp: (P, n, t, w) => `${t} — ${w}`,
  boredOfIt: (P) => `${capitalise(P.they)} ${P.has} had enough of that one for now`,
  needSit: (P) => `${capitalise(P.they)} need${P.s} to be sitting first`,
  needDown: (P) => `${capitalise(P.they)} need${P.s} to be lying down first`,
  needStand: (P) => `${capitalise(P.they)} need${P.s} to be standing`,
  unknownSignal: (P) => `${capitalise(P.they)} ${P.has} no idea what that means yet`,
  notInMood: (P) => `${capitalise(P.they)} ${P.is} not really in the mood`,
  guessed: (P, t) => `${capitalise(P.they)} guessed — ${t}`,
  /* MIS-ASSOCIATION, said warmly and about HER, never as an error */
  confusedNew: (P, t) => `${capitalise(P.they)} ${P.is} sure that signal means ${t}`,
  confusedAgain: (P, t) => `${capitalise(P.they)} still think${P.s} that means ${t}`,
  recovered: (P, t) => `${capitalise(P.they)} ${P.has} let go of ${t} for that one`,
  collision: (P, t) => `That signal already means ${t} to ${P.them}`,
  /* ---- VOICE. Every one of these is about HIM, never about the microphone
     or the network — a failure has to read as him being distracted. The only
     place the machinery is ever named is the settings row (scenes/room.js). */
  callListening: (P, n) => (n ? `Call ${n}` : `Say something to ${P.them}`),
  callWord: (P, t) => `Say a word for ${t}`,
  learnedWord: (P, w, t) => `“${w}” means ${t} now`,
  heardNothing: (P) => `${capitalise(P.they)} look${P.s} up, then away again`,
  heardUnknown: (P) => `${capitalise(P.they)} ${P.has} not heard that one before`,
  nameCame: (P, n) => `${n || capitalise(P.they)} come${P.s} straight over`,
  nameIgnored: (P) => `${capitalise(P.they)} heard you — and carried on`,
  padLabel: () => 'signal here',
  legendEmpty: (P) => `${capitalise(P.they)} ${P.has} not learned a signal yet`,
  legendTitle: (P) => `What ${P.they} think${P.s} you mean`,
};

/* ---- little art constants (scene art, not design tunables: §11 G) ------ */
const C = {
  ink: '#5d3018', pad: 'rgba(255,248,234,0.30)', padLine: 'rgba(124,74,47,0.30)',
  glyph: '#fff2d6', treat: '#d8a769', treatD: '#b7854b', treatL: '#f0d3a4',
  ring: 'rgba(255,246,214,0.95)', hint: 'rgba(255,240,212,0.95)',
};

/* ---- geometry helpers -------------------------------------------------- */
const bias = (sp, v, k) => sp.to(sp.t * (1 - k) + v * k);

export function createTraining(rig, opts = {}) {
  const game = opts.game;
  const pet = opts.pet;
  const idle = opts.idle;
  const rng = opts.rng || sharedRng;
  const reduced = !!opts.reduced;
  const spawn = opts.spawn || (() => {});
  const sound = opts.sound || (() => {});
  const toast = opts.toast || (() => {});
  const voice = opts.voice || null;
  const busyElsewhere = opts.busyElsewhere || (() => false);
  const s = rig.springs;

  const sp = makeSprings(['train', 'trickHold', 'spin', 'treat', 'nom', 'cueFlash', 'call'], reduced);

  /* the bag handed to every pose writer — allocated once, mutated in place */
  const px = {
    rig, s, pawLift: rig.pawLift, reduced, rng,
    flags: { side: 1, dir: 1 },
    /* pose writers publish anything the layer needs to draw here */
    info: { spinTh: 0, spinDepth: 0, spinEnv: 0 },
  };

  let on = false;
  let t = 0;                    // seconds the layer has been up
  let hint = '';
  let hintT = 0;
  let sinceInput = 0;
  let hintIdx = 0;
  let hintPose = '';            // the ghost gesture currently being suggested
  let confusedMark = 0;         // the "?" over her head
  /* ---- voice (opt-in extra) ---- */
  let lastWord = '';            // the last thing he heard, normalised
  let lastWordAt = -1e9;
  let pendingWord = '';         // a word waiting to be attached to a signal
  let voiceArmed = 0;           // seconds left to attach a heard word to a signal
  let calledAt = -1e9;          // when his name was last called
  let downHintCount = 0;
  let listeners = [];

  /* ---- the signal she was last given ------------------------------- */
  const cue = {
    sig: '',                    // what she READ (may differ from `drawn`)
    drawn: '', conf: 1,
    at: -1e9,                   // rig clock seconds
    misread: false,
    fromVoice: false,
  };
  let lastTapAt = -1e9;         // for double-tap detection
  let clock = 0;                // monotonic seconds, own clock

  /* ---- gesture capture ---------------------------------------------- */
  let cap = null;               // { where:'pad'|'dog', pts, t0, travel, turn, ... }
  const aboveTaps = [];         // timestamps of taps above her head (jump)

  /* ---- the performance --------------------------------------------- */
  let perf = null;
  /* true while a spin has borrowed the rig's placement channels, so they get
     handed back cleanly (dog/toy.js does the same thing for its chases) */
  let spinning = false;

  /* ================================================================== */
  /*  posture, derived from the rig so it can never desync              */
  /* ================================================================== */
  function posture() {
    if (s.down.x > 0.45 || (s.down.t > 0.5 && s.down.x > 0.30)) return 'down';
    if (s.sit.x > 0.45 || (s.sit.t > 0.5 && s.sit.x > 0.30)) return 'sit';
    return 'stand';
  }
  /**
   * The tricks she must get through first, in order, to satisfy a posture
   * prerequisite — sit before you lie down, lie down before you roll over.
   * A chain is not a lock: it is her getting into position, and it costs
   * latency, which is exactly what a contest should see.
   */
  function chainFor(id) {
    const spec = TRICKS[id];
    if (!spec) return [];
    const now = posture();
    /* already in the shape this trick ends in: nothing to get into */
    if (spec.ends === now) return [];
    const need = spec.prereq;
    if (!need || need === 'any' || need === now) return [];
    if (need === 'sit') return ['sit'];
    if (need === 'down') return now === 'stand' ? ['sit', 'lieDown'] : ['lieDown'];
    if (need === 'stand') return ['standUp'];      // a posture, not a trick
    return [];
  }

  /* ================================================================== */
  /*  hints                                                             */
  /* ================================================================== */
  function setHint(txt) { if (txt !== hint) { hint = txt; hintT = 0; } }
  const P = () => game.pron;

  /** the tricks whose guide gesture is possible from where she is right now */
  function teachable() {
    const now = posture();
    return TRICK_IDS.filter((id) => {
      const need = TRICKS[id].prereq;
      if (need === 'any') return true;
      if (need === now) return true;
      /* headDown chains sit->lieDown, so lieDown is offered from a sit only */
      return false;
    });
  }

  /* ================================================================== */
  /*  SIGNAL RECOGNITION                                                */
  /* ================================================================== */
  function startCapture(where, x, y, lx, ly) {
    cap = {
      where, t0: clock, dur: 0,
      x0: x, y0: y, x: x, y: y, lx0: lx, ly0: ly, lx, ly,
      travel: 0, turn: 0, lastAng: null,
      flipsY: 0, lastDirY: 0,
      zone: where === 'dog' ? zoneAt(lx, ly) : '',
      moved: false, holding: 0,
    };
  }
  function moveCapture(x, y, lx, ly) {
    if (!cap) return;
    const dx = x - cap.x, dy = y - cap.y;
    const seg = Math.hypot(dx, dy);
    if (seg > 0.001) {
      cap.travel += seg;
      if (seg > 1.2) {
        const ang = Math.atan2(dy, dx);
        if (cap.lastAng !== null) {
          let d = ang - cap.lastAng;
          while (d > Math.PI) d -= TAU;
          while (d < -Math.PI) d += TAU;
          cap.turn += d;
        }
        cap.lastAng = ang;
      }
      /* vertical reversals — what a paw wiggle is made of */
      const dirY = Math.sign(dy);
      if (Math.abs(dy) > 1.4 && dirY !== 0) {
        if (cap.lastDirY !== 0 && dirY !== cap.lastDirY) cap.flipsY++;
        cap.lastDirY = dirY;
      }
    }
    cap.x = x; cap.y = y; cap.lx = lx; cap.ly = ly;
    if (cap.travel > SG.tapTravel) cap.moved = true;
  }

  /**
   * Classify a finished pad gesture.
   * @returns {{sig, conf}} — conf 0..1, and a LOW conf is what lets her
   *   mishear it. A crisp signal is never misread.
   */
  function classifySignal(g) {
    const netX = g.x - g.x0, netY = g.y - g.y0;
    const net = Math.hypot(netX, netY);
    const dur = g.dur;
    const turn = Math.abs(g.turn);

    /* a circle first: it has lots of travel for very little displacement */
    if (turn > SG.circleTurn && g.travel > Math.max(SG.minSwipe, net * SG.circleRatio)) {
      return { sig: 'circle', conf: clamp(turn / TAU, 0.3, 1) * clamp(g.travel / (SG.minSwipe * 2.4), 0.4, 1) };
    }
    /* a stationary touch: tap, double-tap, or hold */
    if (g.travel < SG.tapTravel) {
      if (dur >= SG.holdDur) {
        return { sig: 'hold', conf: clamp(dur / (SG.holdDur * 2.2), 0.35, 1) };
      }
      if (dur < SG.tapDur) {
        const dbl = (clock - lastTapAt) < SG.doubleGap;
        lastTapAt = clock;
        return {
          sig: dbl ? 'double' : 'tap',
          /* a tap that nearly became a hold, or nearly a drag, is a scruffy tap */
          conf: clamp(1 - g.travel / SG.tapTravel, 0.3, 1) * clamp(1 - dur / SG.holdDur, 0.35, 1),
        };
      }
      /* between a tap and a hold: genuinely ambiguous, and she is allowed to
         be unsure about it */
      return { sig: 'hold', conf: 0.34 };
    }
    /* a swipe */
    if (net >= SG.minSwipe) {
      const straight = clamp(net / Math.max(1, g.travel), 0, 1);
      const axis = Math.abs(netX) > Math.abs(netY);
      const purity = axis ? Math.abs(netX) / Math.max(1, net) : Math.abs(netY) / Math.max(1, net);
      const sig = axis ? (netX > 0 ? 'right' : 'left') : (netY < 0 ? 'up' : 'down');
      const conf = clamp((straight - SG.straightAt) / (1 - SG.straightAt), 0, 1) * 0.55
        + clamp((purity - 0.6) / 0.4, 0, 1) * 0.30
        + clamp(net / (SG.minSwipe * 2.2), 0, 1) * 0.15;
      return { sig, conf: clamp(conf, 0.1, 1) };
    }
    /* a short scribble that is not a circle and not a swipe: nothing */
    return { sig: '', conf: 0 };
  }

  /**
   * SHE MAY MISHEAR A SCRUFFY SIGNAL. Crisp signals (conf -> 1) are never
   * misread, which is what keeps the tap path fair while leaving room for the
   * original's charm.
   */
  function maybeMisread(sig, conf) {
    const M = SG.misread;
    const sloppy = clamp(1 - conf / SG.crispAt, 0, 1);
    if (sloppy <= 0) return sig;
    const mood = game.moodLevel;
    const p = clamp(sloppy * (M.base + M.perSloppy * sloppy + (1 - mood) * M.perLowMood), 0, M.max);
    if (rng.next() >= p) return sig;
    const near = SG.neighbours[sig];
    if (!near || !near.length) return sig;
    return near[Math.min(near.length - 1, (rng.next() * near.length) | 0)];
  }

  /** register a signal (from the hand or, if she has learned it, from a word) */
  function giveSignal(drawn, conf, fromVoice) {
    const readSig = maybeMisread(drawn, conf);
    cue.drawn = drawn;
    cue.sig = readSig;
    cue.conf = conf;
    cue.at = clock;
    cue.misread = readSig !== drawn;
    cue.fromVoice = !!fromVoice;
    sp.cueFlash.set(0); sp.cueFlash.to(1); sp.cueFlash.kick(9);
    /* she looks at your hand and pricks her ears — first frame, as an impulse */
    s.earL.kick(4.2); s.earR.kick(-3.8);
    s.perk.kick(2.4);
    s.eyeOpen.kick(1.4);
    if (idle) idle.cancel(1.4);
    sound('cue');
    /* A word said just after a HAND signal is being taught as that signal's
       name. A word said as the cue itself obviously is not — re-arming there
       would swallow the next thing she says, so a voice cue closes the window
       instead of opening one. */
    voiceArmed = fromVoice ? 0 : T.guide.window;
    /* ASK: if she thinks she knows what it means, she answers. If a guide
       follows within the window, that answer becomes a lesson instead. */
    ask(readSig);
    return readSig;
  }

  /* ================================================================== */
  /*  WHAT DOES SHE THINK THAT MEANS?                                   */
  /* ================================================================== */
  /**
   * Resolve a signal to the trick SHE believes it means. Two bindings on one
   * signal is a real state (teaching a signal that is already taken), and when
   * they are close in confidence she genuinely guesses between them.
   */
  function trickForCue(sig) {
    if (!sig) return '';
    const ids = game.tricksForCue(sig);
    if (!ids.length) return '';
    if (ids.length === 1) return ids[0];
    ids.sort((a, b) => game.trick(b).cueConf - game.trick(a).cueConf);
    const top = game.trick(ids[0]).cueConf;
    const close = ids.filter((id) => top - game.trick(id).cueConf <= T.learn.ambiguousAt);
    if (close.length <= 1) return ids[0];
    /* she picks between the ones she is equally sure about, by weight */
    let tot = 0;
    for (const id of close) tot += Math.max(0.01, game.trick(id).cueConf);
    let r = rng.next() * tot;
    for (const id of close) {
      r -= Math.max(0.01, game.trick(id).cueConf);
      if (r <= 0) return id;
    }
    return close[0];
  }

  function distraction() {
    const D = O.distract;
    let d = clamp(pet ? pet.level : 0, 0, 1) * D.pet;
    if (busyElsewhere()) d += D.toy;
    if (game.pressingNeed()) d += D.need;
    return Math.min(D.max, d);
  }

  /**
   * The obedience model, exposed so a contest can pick a fair trick.
   * MOOD (fast) and TRUST (slow) are the gates — never affection directly.
   */
  function chanceOf(id) {
    const rec = game.trick(id);
    const lv = rec.level | 0;
    const mood = game.moodLevel;
    const trust = game.dog.trust;
    const apt = (game.dog.aptitude && game.dog.aptitude.obedience) || 0.5;
    const dis = distraction();
    const score = O.base + lv * O.perLevel + mood * O.perMood
      + trust * O.perTrust + apt * O.perAptitude - dis;
    const obey = clamp(score, O.min, O.max);
    const rest = 1 - obey;
    const others = game.practised().filter((x) => x !== id).length;
    const unsure = 3 - lv;
    let wH = Math.max(0.02, O.hesitate.base + lv * O.hesitate.perLevel + mood * O.hesitate.perMood);
    let wW = Math.max(0.02, O.wrong.base + others * O.wrong.perOther + unsure * O.wrong.perUnsure);
    let wI = Math.max(0.02, O.ignore.base + (1 - mood) * O.ignore.perLowMood + (1 - trust) * O.ignore.perLowTrust);
    if (!others) wW = 0.02;                     // she cannot guess what she has never done
    const tot = wH + wW + wI;
    return {
      obey: +obey.toFixed(4),
      hesitate: +(rest * wH / tot).toFixed(4),
      wrong: +(rest * wW / tot).toFixed(4),
      ignore: +(rest * wI / tot).toFixed(4),
      level: lv, mood: +mood.toFixed(3), trust: +trust.toFixed(3),
      distraction: +dis.toFixed(3),
      expectLatency: +expectedLatency(id, false).toFixed(3),
    };
  }

  function expectedLatency(id, hesitating) {
    const L = T.latency;
    const lv = game.trick(id).level | 0;
    const mood = game.moodLevel;
    return L.base + (1 - lv / 3) * L.perLevel + (1 - mood) * L.perLowMood
      + (hesitating ? (L.hesitate[0] + L.hesitate[1]) / 2 : 0);
  }

  /** how long she can hold a pose — practice DEPTH, which stage 5 scores */
  function holdFor(id) {
    const lv = game.trick(id).level | 0;
    return +(T.hold.base + lv * T.hold.perLevel).toFixed(3);
  }

  /* ================================================================== */
  /*  PERFORMANCE                                                       */
  /* ================================================================== */
  function beginPerf(o) {
    perf = {
      trick: o.trick, asked: o.asked || o.trick, sig: o.sig || '',
      taught: !!o.taught, judged: !!o.judged,
      state: 'wait', t: 0, wait: o.wait || 0,
      u: 0, latency: -1, reached: false,
      correct: o.trick === (o.asked || o.trick),
      hesitated: !!o.hesitated,
      outcome: o.outcome || (o.taught ? 'guided' : 'obey'),
      chain: (o.chain || []).slice(),
      holdFor: o.hold === undefined ? holdFor(o.trick) : o.hold,
      held: 0, holdKept: false,
      rewarded: false, quality: 0, rewardAt: -1,
      window: 0,
      done: false,
    };
    px.flags.side = o.side !== undefined ? o.side : (rng.next() < 0.5 ? 0 : 1);
    px.flags.dir = o.dir !== undefined ? o.dir : rng.sign();
    sp.trickHold.to(1);
    if (perf.hesitated && idle) idle.play('trick.hesitate');
    return perf;
  }

  /** she does the trick — or the first thing in the chain that leads to it */
  function launchTrick() {
    if (!perf) return;
    perf.state = 'move';
    perf.u = 0;
    perf.clipT = 0;
    if (idle) idle.play('trick.' + perf.trick);
    sound('trick-' + perf.trick);
  }

  /**
   * Ask for a trick by cue. Called by giveSignal, and by a heard word.
   * Runs the full roll: obey / hesitate-then-obey / wrong trick / distracted.
   */
  function ask(sig) {
    if (perf && !perf.done) return null;      // she is already busy answering
    const believed = trickForCue(sig);
    if (!believed) {
      /* A SIGNAL SHE HAS NEVER SEEN IS NOT A FAILURE — it is the first half of
         a lesson. She looks at your hand, expectant, and waits to be shown.
         Only once she has a vocabulary of her own does a blank get named as
         one, and even then it is said about her, not about the input. */
      if (idle) { idle.cancel(1.2); idle.play('trick.hesitate'); }
      setHint(game.known().length >= 2 ? COPY.unknownSignal(P()) : COPY.awaitGuide());
      s.perk.kick(2.0);
      return null;
    }
    return start(believed, { sig, asked: believed });
  }

  /**
   * Start a performance of `asked`, applying the obedience roll.
   * @param opts { sig, asked, judged, force }
   */
  function start(asked, o = {}) {
    if (perf && !perf.done) return null;
    const ch = chanceOf(asked);
    let outcome = 'obey';
    if (!o.force) {
      const r = rng.next();
      if (r < ch.obey) outcome = 'obey';
      else if (r < ch.obey + ch.hesitate) outcome = 'hesitate';
      else if (r < ch.obey + ch.hesitate + ch.wrong) outcome = 'wrong';
      else outcome = 'ignore';
    }
    game.noteAsk(asked, outcome === 'obey' || outcome === 'hesitate');

    if (outcome === 'ignore') {
      /* NEVER A NO-OP. She looks at you, then at something better. */
      confuse(COPY.notInMood(P()), false);
      notify({
        trick: '', asked, sig: o.sig || '', outcome: 'ignore', correct: false,
        latency: -1, quality: 0, held: 0, taught: false, judged: !!o.judged,
      });
      return null;
    }

    let doing = asked;
    if (outcome === 'wrong') {
      const others = game.practised().filter((x) => x !== asked);
      if (others.length) {
        /* prefer something she actually knows — a guess is a guess, not noise */
        const known = others.filter((x) => game.trick(x).level >= 1);
        const pool = known.length ? known : others;
        doing = pool[Math.min(pool.length - 1, (rng.next() * pool.length) | 0)];
      } else outcome = 'obey';
    }

    const chain = chainFor(doing);
    const hesitating = outcome === 'hesitate';
    const wait = T.latency.base
      + (1 - (game.trick(doing).level | 0) / 3) * T.latency.perLevel
      + (1 - game.moodLevel) * T.latency.perLowMood
      + (hesitating ? rng.span(T.latency.hesitate) : 0)
      + chain.length * T.latency.chain;

    const p = beginPerf({
      trick: doing, asked, sig: o.sig || '', judged: !!o.judged,
      hesitated: hesitating, outcome, chain, wait,
    });
    if (outcome === 'wrong') {
      /* she is CONFIDENT about it, which is what makes it read as her getting
         the wrong idea rather than as the game misfiring */
      setHint(COPY.guessed(P(), trickName(doing)));
    }
    return p;
  }

  /** the puzzled look, with an optional one-line explanation of her state */
  function confuse(msg, unknown) {
    if (idle) { idle.cancel(1.6); idle.play('trick.confused'); }
    confusedMark = 1;
    if (msg) setHint(msg);
    sound('whine');
  }

  /* ================================================================== */
  /*  GUIDING — the gesture that induces a pose                          */
  /* ================================================================== */
  /** which petting zone a rig-local point is in (may be '') */
  function zoneAt(lx, ly) {
    if (!pet) return '';
    const h = pet.hitZone(lx, ly);
    return h ? h.zone.id : '';
  }

  /** true if a virtual point is inside her personal space */
  function onDog(lx, ly) {
    const H = T.halo;
    return Math.abs(lx) < H.hx && ly > H.top && ly < H.bottom;
  }
  function abovehead(lx, ly) {
    const P2 = rig.pose;
    return ly < P2.headY - rig.dims.headHH * 0.45 && Math.abs(lx - P2.headX) < rig.dims.headHW * 1.5;
  }
  function nearPaws(lx, ly) {
    return ly > -34 && Math.abs(lx) < T.halo.hx;
  }

  /**
   * Classify a finished on-body gesture into a guide, then into a trick.
   * The POSTURE decides which trick a stroke means — sit and lie down share
   * one gesture, exactly as the DS did.
   */
  function classifyGuide(g) {
    const G = T.guide;
    const netX = g.lx - g.lx0, netY = g.ly - g.ly0;
    const net = Math.hypot(netX, netY);
    const straight = clamp(net / Math.max(1, g.travel), 0, 1);
    const now = posture();
    const zone = g.zone;

    /* ---- a circle low down by the paws: spin (research §5 — the DS taught
           this by waving a treat about at floor level) ---- */
    if (Math.abs(g.turn) > G.circleTurn && g.travel > G.minTravel * 2
      && nearPaws(g.lx0, g.ly0)) {
      return { guide: 'floorCircle', trick: 'spin' };
    }

    /* ---- press and hold on the flank: play dead (lying down only) ---- */
    if (!g.moved && g.dur >= G.holdFor
      && (zone === 'belly' || zone === 'back' || zone === 'chest' || zone === 'neck')) {
      return now === 'down'
        ? { guide: 'flankHold', trick: 'playDead' }
        : { guide: 'flankHold', trick: '', need: 'down' };
    }

    /* ---- a paw wiggled up and down: shake ---- */
    if (zone === 'paw' && g.flipsY >= G.wiggleFlips) {
      return { guide: 'pawWiggle', trick: 'shake' };
    }

    if (net >= G.minTravel && straight > G.straightAt) {
      const vertical = Math.abs(netY) > Math.abs(netX) * 1.1;
      /* ---- down over the head: sit, then lie down ---- */
      if (vertical && netY > 0 && (zone === 'head' || zone === 'ear' || zone === 'muz')) {
        if (now === 'stand') return { guide: 'headDown', trick: 'sit' };
        if (now === 'sit') return { guide: 'headDown', trick: 'lieDown' };
        return { guide: 'headDown', trick: '' };       // already down: nothing to do
      }
      /* ---- up the chest to the chin: beg ---- */
      if (vertical && netY < 0 && (zone === 'chest' || zone === 'chin' || zone === 'neck' || zone === 'belly')) {
        return { guide: 'chinUp', trick: 'beg' };
      }
      /* ---- across the body: roll over (lying down only) ----
         WHILE HE IS ALREADY DOWN, ANY horizontal sweep across him means this.
         The zone whitelist below is only consulted when he is NOT down, where
         it is needed to tell "you meant roll over, get him down first" apart
         from an idle sideways stroke.

         Measured, not assumed: requiring back/belly/chest/neck at the START of
         the sweep failed outright once he was lying down — the body flattens
         and widens, so a sweep aimed across his middle begins outside every one
         of those zones and the gesture was silently not recognised. This was
         the one guide of the eight that did not work from a real pointer path.
         The DS rule was simply "horizontal motion across the body while lying
         on the floor", and there is no rival horizontal gesture from `down`, so
         the loose test is also the faithful one. */
      if (!vertical && Math.abs(netX) > G.minTravel * 1.3) {
        if (now === 'down') return { guide: 'bodyAcross', trick: 'rollOver', dir: netX > 0 ? 1 : -1 };
        if (zone === 'back' || zone === 'belly' || zone === 'chest' || zone === 'neck') {
          return { guide: 'bodyAcross', trick: '', need: 'down' };
        }
      }
    }
    return { guide: '', trick: '' };
  }

  /** taps above the head accumulate into a jump */
  function noteAboveTap() {
    const G = T.guide;
    aboveTaps.push(clock);
    while (aboveTaps.length && clock - aboveTaps[0] > G.tapWindow) aboveTaps.shift();
    if (aboveTaps.length >= G.tapsFor) {
      aboveTaps.length = 0;
      return true;
    }
    /* she is already looking up, which is the anticipation */
    s.perk.kick(1.8);
    s.pitch.kick(0.9);
    if (idle) idle.cancel(1.2);
    return false;
  }

  /** the player has guided her into a trick: run it, and open the lesson */
  function guideInto(id, extra) {
    if (perf && !perf.done && !perf.taught) {
      /* she was mid-answer and you have stepped in to help: that IS the lesson */
      perf.done = true;
    }
    const chain = chainFor(id);
    /* Guiding does not need an obedience roll: you are physically putting her
       into the shape (research §5 — the stylus induced the pose). What she
       learns from it is a different question, decided at the reward. */
    const p = beginPerf({
      trick: id, asked: id, taught: true, outcome: 'guided',
      sig: (clock - cue.at) <= T.guide.window ? cue.sig : '',
      chain, wait: chain.length * T.latency.chain * 0.5 + 0.06,
      dir: extra && extra.dir,
    });
    setHint('');
    return p;
  }

  /* ================================================================== */
  /*  REWARD + THE LESSON                                               */
  /* ================================================================== */
  function reward() {
    if (!perf || !perf.reached || perf.rewarded || perf.judged) return false;
    const R = T.reward;
    const since = perf.rewardAt >= 0 ? (clock - perf.rewardAt) : 999;
    if (since > R.window) return false;
    perf.rewarded = true;
    perf.quality = since <= R.crisp ? R.quality.crisp
      : lerp(R.quality.crisp, R.quality.late, clamp((since - R.crisp) / (R.window - R.crisp), 0, 1));
    sp.nom.set(0); sp.nom.to(1); sp.nom.kick(8);
    sp.treat.to(0);
    if (idle) idle.play('trick.nom');
    /* praise is petting-shaped: hearts, a mood bump, a wag */
    game.addMood(BALANCE.mood.tapGain * 2.2);
    const h = rig.headWorld();
    const n = reduced ? 3 : 6;
    for (let i = 0; i < n; i++) spawn('heart', h.x + rng.range(-26, 26), h.y + rng.range(-26, 6));
    sound('praise');
    commit(perf.quality);
    setHint(perf.quality >= R.quality.crisp - 0.001 ? COPY.rewardedCrisp(P()) : COPY.rewardedLate(P()));
    return true;
  }

  /**
   * THE LESSON LANDS HERE. Practice always counts (she did the movement); what
   * the CUE ends up meaning is rolled for, and that roll is the whole
   * mis-association mechanic.
   */
  function commit(quality) {
    if (!perf || perf.committed) return;
    perf.committed = true;
    const id = perf.trick;
    const now = Date.now();

    /* ---- 1. practice ------------------------------------------------ */
    const rep = game.trickRep(id, quality, now);
    perf.rep = rep;

    /* ---- 2. THE ASSOCIATION ----------------------------------------
       This is where the wobble lives. Two ways a cue ends up on the wrong
       trick, and both of them are things a real dog does:

       a) TAUGHT REP, MIS-FILED. You signalled, you guided, you rewarded — and
          in the gap between the signal and the pose she connected the wrong
          two things. More likely with a long gap, a flat mood, a dog who does
          not trust you yet, a scruffy signal, or a late treat.
       b) YOU REWARDED THE WRONG ANSWER. She offered a different trick and got
          a treat for it, so now she is surer that is what the signal means.
          Nothing in the code has to be "wrong" for this to happen; you did it.
       ------------------------------------------------------------------- */
    let confused = false;
    let boundTo = '';
    const sig = perf.sig;
    if (sig) {
      const CF = T.confuse;
      let wrong = '';
      if (perf.taught) {
        const gap = perf.signalGap === undefined ? 0 : perf.signalGap;
        const sloppy = clamp(1 - cue.conf / SG.crispAt, 0, 1);
        const pConf = clamp(
          CF.base + gap * CF.perGapSec
          + (1 - game.moodLevel) * CF.perLowMood
          + (1 - game.dog.trust) * CF.perLowTrust
          + sloppy * CF.perSloppy
          + (1 - quality) * CF.perLateReward, 0, CF.max);
        perf.pConfuse = +pConf.toFixed(3);
        if (rng.next() < pConf) wrong = pickWrongAssociation(id);
      } else if (perf.outcome === 'wrong') {
        /* (b) — she guessed, you paid her for it */
        wrong = id;
      }
      if (wrong) {
        confused = true;
        boundTo = wrong;
        const already = game.trick(wrong).cue === sig;
        game.bindCue(wrong, sig, already
          ? Math.min(1, game.trick(wrong).cueConf + T.learn.confPerRep)
          : T.learn.confWrong);
        const line = already ? COPY.confusedAgain(P(), trickName(wrong)) : COPY.confusedNew(P(), trickName(wrong));
        setHint(line);
        toast(line);
        confusedMark = 1;
        game.log('trick', 'thinks that signal means ' + trickName(wrong));
      } else {
        /* the right idea: reinforce it, and TALK HER OUT of any other trick
           that thinks it owns this signal. Three patient reps is enough. */
        const rec = game.trick(id);
        boundTo = id;
        if (rec.cue === sig) game.nudgeCueConf(id, T.learn.confPerRep);
        else game.bindCue(id, sig, T.learn.confNew);
        for (const other of game.tricksForCue(sig)) {
          if (other === id) continue;
          const before = game.trick(other).cue;
          game.nudgeCueConf(other, -T.recover.perRep);
          if (before && !game.trick(other).cue) {
            toast(COPY.recovered(P(), trickName(other)));
            game.log('trick', 'let go of ' + trickName(other) + ' for that signal');
          }
        }
      }

      /* ---- IF SHE SAID A WORD AROUND THE SIGNAL, IT BECOMES ITS NAME ----
         The word is arbitrary (research §5) and it attaches to the SIGNAL, not
         to the trick — so a spoken cue resolves through the same `cue -> trick`
         table a drawn one does, and is mis-associated in exactly the same way.
         One mechanic, two input paths.

         DELIBERATELY OUTSIDE THE wrong/right BRANCH ABOVE. If the lesson got
         mis-filed, the word still names the signal; it is the signal's MEANING
         that went astray. That is precisely the DS failure — you say "sit", he
         learns the word perfectly, and it means "beg" to him now — and it is
         far more legible than silently declining to learn the word at all. */
      if (pendingWord && (clock - lastWordAt) < T.guide.window * 2) {
        const known = game.wordFor(sig);
        game.learnWord(sig, pendingWord);
        if (known !== pendingWord) {
          toast(COPY.learnedWord(P(), pendingWord, trickName(boundTo || id)));
        }
        game.log('trick', 'learned the word "' + pendingWord + '"');
      }
    }

    /* THE LESSON HAS LANDED, SO THE TEACHING WINDOW IS OVER. Leaving it open
       meant the next thing she said was swallowed as a name for a signal that
       had already been named — she calls him, nothing happens, and it reads as
       the microphone being broken. One signal, one word, then closed. */
    voiceArmed = 0;
    pendingWord = '';

    /* ---- 3. payouts, through the daily ledger ---------------------- */
    game.awardDay('trick:' + id);
    if (rep.leveledUp && rep.level === 1) {
      game.awardDay('learn:' + id);
      game.log('trick', 'learned ' + trickName(id));
      toast(COPY.learned(P(), game.isNamed ? game.dog.name : '', trickName(id)));
      if (idle) idle.play('wagBurst');
      const h = rig.headWorld();
      for (let i = 0; i < (reduced ? 4 : 9); i++) {
        spawn('spark', h.x + rng.range(-34, 34), h.y + rng.range(-30, 10));
      }
    } else if (rep.leveledUp) {
      toast(COPY.levelUp(P(), '', trickName(id), game.describeTrickLevel(id)));
    } else if (rep.damped) {
      /* she is bored of drilling this one — say it as HER state, and it is a
         nudge to go and do something else, never a penalty */
      setHint(COPY.boredOfIt(P()));
      if (idle && rng.chance(0.5)) idle.play('yawn');
    }

    perf.confused = confused;
    perf.boundTo = boundTo;
    notify({
      trick: id, asked: perf.asked, sig, outcome: perf.outcome,
      correct: perf.correct, latency: perf.latency, quality,
      held: perf.held, taught: perf.taught, judged: perf.judged,
      confused, boundTo, level: rep.level, reps: rep.reps,
    });
  }

  /**
   * What she mis-files the cue as. Prefers a trick she has just performed (her
   * short memory), then anything she has practised, then a plausible
   * neighbour — so the wrong answer is always something she can actually do,
   * which is what makes it read as a misunderstanding and not a glitch.
   */
  function pickWrongAssociation(intended) {
    const CF = T.confuse;
    const recent = memory.filter((m) => clock - m.at < CF.memory && m.id !== intended).map((m) => m.id);
    const practised = game.practised().filter((x) => x !== intended);
    const pool = recent.length ? recent : practised;
    if (!pool.length) {
      /* nothing to confuse it with yet: she mis-files it onto a trick she has
         at least been guided through once, else nothing happens at all */
      return '';
    }
    return pool[Math.min(pool.length - 1, (rng.next() * pool.length) | 0)];
  }

  /* what she has been doing lately — the raw material for a mis-association */
  const memory = [];
  function remember(id) {
    memory.push({ id, at: clock });
    while (memory.length > 8) memory.shift();
  }

  /* ---- listeners: stage 5 subscribes here --------------------------- */
  function notify(result) {
    for (const fn of listeners) { try { fn(result); } catch (e) { /* never break the loop */ } }
  }

  /* ================================================================== */
  /*  lifecycle                                                         */
  /* ================================================================== */
  function startMode() {
    if (busyElsewhere()) return false;
    on = true;
    t = 0;
    sinceInput = 0;
    hintIdx = 0;
    downHintCount = 0;
    sp.train.to(1);
    aboveTaps.length = 0;
    cue.sig = ''; cue.drawn = ''; cue.at = -1e9;
    setHint(game.known().length ? COPY.enterKnown(P()) : COPY.enterFresh(P()));
    if (idle) idle.cancel(1.2);
    s.earL.kick(3.0); s.earR.kick(-2.6);
    s.perk.kick(1.6);
    rig.blinkNow(1);
    sound('perk');
    return true;
  }

  function stopMode() {
    on = false;
    sp.train.to(0);
    setHint('');
    cap = null;
    /* a performance in flight is allowed to finish: yanking her out of a pose
       because the player closed a panel looks like a bug */
  }

  /* ================================================================== */
  /*  pointer — returns true when training CONSUMED the event            */
  /* ================================================================== */
  function pointer(ev, l) {
    if (!on) return false;
    const R = T.reward;

    /* the leave affordance, in the same place the care actions put it */
    if (ev.type === 'down' && ev.x > 318 && ev.y > 40 && ev.y < 84) {
      stopMode();
      return true;
    }

    /* ---- "CALL HIM" ----
       The ONLY way the microphone ever opens: one press, one utterance. This
       runs inside a real pointer event, which is the only context iOS will
       honour the prompt from. Never ambient. */
    if (ev.type === 'down' && onCallButton(ev.x, ev.y)) { callHim(); return true; }
    if (onCallButton(ev.x, ev.y) && (ev.type === 'up' || ev.type === 'move')) return true;

    const inPad = ev.y >= T.pad.top && ev.y <= T.pad.bottom;
    const her = onDog(l.x, l.y);

    if (ev.type === 'down') {
      sinceInput = 0;
      /* ---- REWARD FIRST. The window is short and she is waiting: a tap on
         her while the treat is out is always the treat, never a stroke. ---- */
      if (perf && perf.reached && !perf.rewarded && !perf.judged && her) {
        if (reward()) return true;
      }
      if (her) {
        startCapture('dog', ev.x, ev.y, l.x, l.y);
        /* taps above the head are the jump guide, so they must not fall
           through to the petting field as a miss */
        return false;                         // petting still gets it: guide == stroke
      }
      if (inPad) { startCapture('pad', ev.x, ev.y, l.x, l.y); return true; }
      return false;
    }

    if (ev.type === 'move') {
      if (!cap) return false;
      sinceInput = 0;
      moveCapture(ev.x, ev.y, l.x, l.y);
      return cap.where === 'pad';
    }

    if (ev.type === 'up' || ev.type === 'cancel') {
      const g = cap;
      cap = null;
      if (!g) return false;
      g.dur = clock - g.t0;
      if (ev.type === 'cancel') return g.where === 'pad';
      if (g.where === 'pad') {
        const { sig, conf } = classifySignal(g);
        if (sig) giveSignal(sig, conf, false);
        return true;
      }
      /* ---- on her body: a guide, a jump tap, or just a stroke ---- */
      if (!g.moved && g.dur < T.guide.holdFor && abovehead(g.lx0, g.ly0)) {
        if (noteAboveTap()) guideInto('jump');
        return true;
      }
      const res = classifyGuide(g);
      if (res.trick) {
        guideInto(res.trick, res);
        return true;
      }
      if (res.need) {
        /* the posture prerequisite, explained once she has tried twice — it
           teaches itself, so the line is a safety net, not a tutorial */
        downHintCount++;
        if (downHintCount >= 2) {
          setHint(res.need === 'down' ? COPY.needDown(P()) : COPY.needSit(P()));
          downHintCount = 0;
        }
        return false;
      }
      return false;
    }
    return false;
  }

  /* ================================================================== */
  /*  voice                                                             */
  /* ================================================================== */
  /**
   * A heard utterance (one transcript from one single-shot recognition).
   *
   * FOUR THINGS IT CAN BE, in priority order:
   *   1. the word for a signal you have just drawn -> he LEARNS it (this is
   *      the DS lightbulb, in the same shape: cause the behaviour, then name
   *      it, and the name is arbitrary so it can be wrong)
   *   2. HIS NAME -> not a cue at all. The come-when-called roll, on mood and
   *      trust (research §1.3, §2)
   *   3. a word he already knows -> that signal, straight into the same
   *      obedience roll a hand signal gets
   *   4. anything else -> ears up, a look, and nothing happens
   *
   * RECOGNITION ACCURACY NEVER DECIDES WHETHER HE OBEYS. It only decides
   * which signal he thinks he heard; mood and trust decide the rest. That is
   * why a mishearing reads as him being distracted rather than as the
   * software being broken.
   */
  function heard(text) {
    const word = normWord(text);
    lastWord = word;
    lastWordAt = clock;
    if (!word) { distracted(); return { kind: 'nothing' }; }

    const name = game.isNamed ? normWord(game.dog.name) : '';
    const isName = !!name && utteranceSim(word, name) >= T.voice.nameAccept;

    /* ---- 1. NAMING A SIGNAL YOU JUST DREW ---- */
    if (on && voiceArmed > 0 && cue.sig && !isName) {
      pendingWord = word;
      s.earL.kick(3.8); s.earR.kick(-3.4);
      s.perk.kick(1.6);
      s.eyeOpen.kick(1.2);
      /* it is not his yet: it becomes his when the lesson lands (commit) */
      return { kind: 'teach', word, sig: cue.sig };
    }

    /* ---- 2. HIS NAME ---- */
    if (isName) return callToAttention(word);

    /* ---- 3. A WORD HE KNOWS ---- */
    const m = matchWord(word, game.cueVoice);
    if (m.sig && m.sim >= T.voice.match.accept) {
      let sig = m.sig;
      /* TWO WORDS THAT SOUND ALIKE: he mishears, which is the authentic bit
         and is now a property of the words themselves rather than of a
         signal-processing threshold */
      if (m.ambiguous && rng.chance(0.5)) {
        for (const k of game.spokenCues()) {
          if (k === sig) continue;
          if (Math.abs(utteranceSim(word, game.wordFor(k)) - m.sim) < T.voice.match.ambiguous) { sig = k; break; }
        }
      }
      /* a poor match is a scruffy signal, and rides the SAME mishearing
         channel a scruffy hand signal rides — one implementation, not two */
      giveSignal(sig, clamp(m.sim, 0.32, 1), true);
      return { kind: 'cue', sig, word, sim: +m.sim.toFixed(3), misheard: sig !== m.sig };
    }

    /* ---- 4. HEARD SOMETHING, MADE NOTHING OF IT ---- */
    distracted(game.spokenCues().length ? COPY.heardUnknown(P()) : '');
    return { kind: 'unknown', word, sim: +m.sim.toFixed(3) };
  }

  /** ears up, a look at you, and then on with his day. Never an error. */
  function distracted(msg) {
    s.earL.kick(3.8); s.earR.kick(-3.4);
    s.perk.kick(1.4);
    s.eyeOpen.kick(1.1);
    if (idle) { idle.cancel(1.0); idle.play('trick.hesitate'); }
    if (on) setHint(msg || COPY.heardNothing(P()));
  }

  /**
   * SHE CALLS HIM AND HE DECIDES. The single readable probability roll
   * research §2 asks for, on the two gates that govern everything else here —
   * `game.moodLevel` and `dog.trust`, minus whatever else has his attention.
   * Recognition does not appear in it anywhere.
   */
  function callToAttention(word) {
    const A = T.voice.attend;
    const p = clamp(A.base + game.moodLevel * A.perMood + game.dog.trust * A.perTrust
      - distraction(), A.min, A.max);
    const came = rng.next() < p;
    calledAt = clock;
    if (idle) idle.cancel(1.8);
    /* the ears go first, as impulses, so he answers in frame 1 (§11.1 C) */
    s.earL.kick(6.4); s.earR.kick(-5.8);
    s.perk.kick(2.8);
    s.eyeOpen.kick(1.6);
    if (came) {
      /* he commits: eye contact, a big wag, and a step toward the camera.
         ON THIS RIG DEPTH IS SCALE (§12.6) — he gets BIGGER, he does not walk. */
      sp.call.set(0); sp.call.to(1); sp.call.kick(7);
      if (idle) idle.play('trick.ask');
      rig.lookAtVirtual(195, 990);
      game.addMood(BALANCE.mood.tapGain * 1.4);
      const h = rig.headWorld();
      for (let i = 0; i < (reduced ? 2 : 4); i++) {
        spawn('heart', h.x + rng.range(-22, 22), h.y + rng.range(-24, 4));
      }
      sound('perk');
      if (on) setHint(COPY.nameCame(P(), game.isNamed ? game.dog.name : ''));
    } else {
      /* NOT A NO-OP. He heard her — and something else was more interesting. */
      if (idle) idle.play('trick.confused');
      if (on) setHint(COPY.nameIgnored(P()));
    }
    notify({
      trick: '', asked: '', sig: '', outcome: came ? 'came' : 'ignore',
      correct: false, latency: -1, quality: 0, held: 0,
      taught: false, judged: false, confused: false, boundTo: '',
      called: true, word, chance: +p.toFixed(4),
    });
    return { kind: 'name', came, chance: +p.toFixed(4), word };
  }

  /**
   * Start one single-shot recognition. MUST be called from inside a real user
   * gesture. Everything about a failure is silent: the button simply stops
   * pulsing and the game carries on being a complete tap game.
   */
  function callHim() {
    if (!voice || !voice.armed || voice.listening) return false;
    /* he looks up the moment she reaches for it, before a word is spoken —
       the anticipation is most of what makes this feel like calling a dog */
    s.earL.kick(3.2); s.earR.kick(-2.8);
    s.perk.kick(1.4);
    if (on) setHint(COPY.callListening(P(), game.isNamed ? game.dog.name : ''));
    try {
      voice.listen().then((r) => {
        /* r.ok === false is a completely normal answer: denied, offline, a
           tunnel, or he simply heard nothing. Say nothing about any of it. */
        if (!r || !r.ok) { if (on && hint === COPY.callListening(P(), game.isNamed ? game.dog.name : '')) setHint(''); }
      }).catch(() => { /* never surfaces */ });
    } catch (e) { /* never surfaces */ }
    return true;
  }

  /** is a virtual point on the "call him" button? */
  function onCallButton(x, y) {
    if (!voice || !voice.armed) return false;
    const B = T.voice.button;
    return Math.hypot(x - B.x, y - B.y) <= B.r + 6;
  }

  /* ================================================================== */
  /*  update                                                            */
  /* ================================================================== */
  function update(dt, mood) {
    clock += dt;
    t += dt;
    hintT += dt;
    sinceInput += dt;
    if (voiceArmed > 0) voiceArmed -= dt;
    if (confusedMark > 0) confusedMark = Math.max(0, confusedMark - dt * 0.55);
    if (cap) cap.dur = clock - cap.t0;
    /* the recogniser's own watchdog + cooldown. Always safe to call, and it
       must be called even when nothing is listening so a dead run times out. */
    if (voice) voice.update(dt);
    /* the "he came when called" lean releases on its own */
    if (sp.call.t > 0 && clock - calledAt > T.voice.leanFor) sp.call.to(0);

    /* the treat is out whenever she is owed one */
    const owed = !!(perf && perf.reached && !perf.rewarded && !perf.judged && !perf.done);
    sp.treat.to(owed ? 1 : 0);

    /* ---- the ghost gesture hint (discoverability, one at a time) ---- */
    if (on && sinceInput > T.hintAfter && !perf) {
      const list = teachable();
      if (list.length) {
        const i = Math.floor((sinceInput - T.hintAfter) / T.hintCycle) % list.length;
        hintPose = list[i];
        if (!hint || hintT > T.hintCycle) setHint(TRICKS[hintPose].hint);
      }
    } else if (perf) hintPose = '';

    stepPerf(dt);
    for (const k in sp) sp[k].step(dt);
  }

  function stepPerf(dt) {
    if (!perf || perf.done) return;
    const R = T.reward;
    perf.t += dt;

    /* ---- THE REWARD WINDOW IS INDEPENDENT OF THE POSE ----
       A jump is over in a second, but the treat is still owed: she lands and
       waits. So the window closes on its own clock, and MISSING IT IS NOT A
       PUNISHMENT — she practised, just less usefully, and nothing tells her
       off for it. */
    if (perf.reached && !perf.rewarded && !perf.judged && !perf.windowClosed
      && perf.rewardAt >= 0 && clock - perf.rewardAt > R.window) {
      perf.windowClosed = true;
      setHint(COPY.rewardMissed(P()));
      if (perf.taught) commit(R.quality.none);
      else notifyUnrewarded();
    }

    if (perf.state === 'wait') {
      if (perf.t >= perf.wait) {
        /* work through the posture chain first: sit before you lie down */
        if (perf.chain.length) {
          const next = perf.chain.shift();
          if (next === 'standUp') {
            /* not a trick, just a posture: ask the rig to stand */
            s.sit.to(0); s.down.to(0);
            if (idle) idle.play('standUp');
            perf.wait = perf.t + T.latency.chain;
            return;
          }
          perf.chainDoing = next;
          perf.state = 'chainMove';
          perf.u = 0;
          if (idle) idle.play('trick.' + next);
          return;
        }
        launchTrick();
      }
      return;
    }

    if (perf.state === 'chainMove') {
      const id = perf.chainDoing;
      const dur = TRICKS[id].dur;
      perf.u = clamp(perf.u + dt / dur, 0, 1);
      if (perf.u >= 1) {
        remember(id);
        perf.state = 'wait';
        perf.wait = perf.t + 0.05;
        perf.chainDoing = '';
      }
      return;
    }

    if (perf.state === 'move') {
      const spec = TRICKS[perf.trick];
      perf.u = clamp(perf.u + dt / spec.dur, 0, 1);
      if (!perf.reached && perf.u >= spec.poseAt) {
        /* THE STOPWATCH STOPS HERE — this is what a contest scores */
        perf.reached = true;
        perf.latency = +perf.t.toFixed(3);
        perf.rewardAt = clock;
        perf.signalGap = cue.at > -1e8 ? +(clock - cue.at).toFixed(3) : 0;
        perf.confusedBefore = perf.sig ? trickForCue(perf.sig) : '';
        remember(perf.trick);
        if (!perf.judged) {
          setHint(COPY.rewardNow());
          if (idle) idle.play('trick.ask');
        }
        sound('trick-done');
      }
      if (perf.u >= 1) {
        perf.state = spec.transient ? 'release' : 'hold';
        perf.holdT = 0;
      }
      return;
    }

    if (perf.state === 'hold') {
      perf.holdT = (perf.holdT || 0) + dt;
      perf.held = +perf.holdT.toFixed(3);
      /* SHE CAN ONLY HOLD IT FOR AS LONG AS SHE HAS PRACTISED (research §5:
         "the more a trick is practiced, the longer the dog will hold the
         trick"). A rewarded hold gets a little extra, because she is pleased. */
      const limit = perf.holdFor + (perf.rewarded ? 0.4 : 0);
      if (perf.holdT >= limit) { perf.holdKept = true; perf.state = 'release'; }
      return;
    }

    if (perf.state === 'release') {
      sp.trickHold.to(0);
      perf.relT = (perf.relT || 0) + dt;
      /* wait for the lesson to have landed one way or the other before letting
         go of the performance, or a quick trick would end before the treat */
      const settled = perf.judged || !perf.reached || perf.rewarded || perf.windowClosed;
      if (perf.relT > T.fade * 1.6 && settled) {
        perf.done = true;
        if (!perf.committed && !perf.notified) notifyUnrewarded();
        /* leave her where the trick ended, and tell the room nothing else */
        if (on) setHint(game.known().length ? COPY.enterKnown(P()) : COPY.enterFresh(P()));
      }
      return;
    }
  }

  function notifyUnrewarded() {
    if (!perf || perf.notified) return;
    perf.notified = true;
    notify({
      trick: perf.trick, asked: perf.asked, sig: perf.sig, outcome: perf.outcome,
      correct: perf.correct, latency: perf.latency, quality: 0,
      held: perf.held, taught: perf.taught, judged: perf.judged,
      confused: false, boundTo: '',
    });
  }

  /* ================================================================== */
  /*  apply — TARGETS ONLY. Runs where care.apply runs.                 */
  /* ================================================================== */
  function apply(dt, mood) {
    const w = sp.train.x;
    const active = perf && !perf.done;

    /* ---- HE CAME WHEN CALLED ----
       A step toward the camera, done the only way this rig can do one: he gets
       BIGGER and drops a little (§12.6, "depth is scale"). It borrows the same
       placement channels the spin borrows and hands them back through the same
       code below, so there is exactly one place that can leave him displaced. */
    const cw = sp.call.x;
    if (cw > 0.004) {
      const CL = BALANCE.rig.trick.call;
      const soft = reduced ? 0.45 : 1;
      rig.s = lerp(rig.s, rig.home.s * (1 + CL.scale * soft), cw);
      rig.y = lerp(rig.y, rig.home.y + CL.drop * soft, cw);
      bias(s.perk, 0.5, cw * 0.6);
      bias(s.tailUp, 0.6, cw * 0.5);
      spinning = true;
    }

    if (!active) {
      /* nothing to hold: let the rest of the pipeline have her back, and put
         the placement channels the spin borrowed back where they belong */
      if (sp.trickHold.x < 0.02 && cw < 0.02) {
        if (Math.abs((rig.sx || 1) - 1) > 0.0005) rig.sx = approach(rig.sx || 1, 1, 8, dt);
        if (spinning) {
          rig.x = approach(rig.x, rig.home.x, 8, dt);
          rig.y = approach(rig.y, rig.home.y, 8, dt);
          rig.s = approach(rig.s, rig.home.s, 8, dt);
          rig.sy = approach(rig.sy === undefined ? 1 : rig.sy, 1, 8, dt);
          if (Math.abs(rig.x - rig.home.x) < 0.2 && Math.abs(rig.s - rig.home.s) < 0.002) {
            rig.x = rig.home.x; rig.y = rig.home.y; rig.s = rig.home.s; rig.sy = 1;
            spinning = false;
          }
        }
      }
      if (w > 0.004) applyMode(dt, w);
      return;
    }

    const k = sp.trickHold.x;
    const id = perf.state === 'chainMove' ? perf.chainDoing : perf.trick;
    const pose = TRICK_POSE[id];
    const u = perf.state === 'move' || perf.state === 'chainMove' ? perf.u : 1;
    if (pose && k > 0.001) {
      pose(px, clamp(k, 0, 1), u);
      if (id === 'spin' || id === 'rollOver' || id === 'playDead') spinning = true;
    }
    /* she keeps an eye on the player through the whole thing — that is what
       makes it feel like doing it FOR someone */
    if (perf.state === 'hold' || perf.state === 'release') {
      rig.lookAtVirtual(195, 990);
    }
    if (w > 0.004) applyMode(dt, w);
  }

  /** the small "we are training" overlay on her behaviour */
  function applyMode(dt, w) {
    if (perf && !perf.done) return;
    /* attentive, waiting for a signal: ears forward, eyes on your hand */
    bias(s.perk, 0.34, w * 0.5);
    bias(s.earBack, -0.10, w * 0.4);
    bias(s.eyeOpen, 1.06, w * 0.35);
    if (sinceInput < 1.4) rig.lookAtVirtual(cap ? cap.x : 195, cap ? cap.y : 940);
  }

  /* ================================================================== */
  /*  drawing                                                           */
  /* ================================================================== */
  /** the treat, the reward ring and the ghost gesture hint — in FRONT of her */
  function drawFront(g) {
    const c = g.ctx;
    const w = sp.train.x;
    const tr = sp.treat.x;

    /* ---- THE SPIN'S FLOOR SCUFF ----
       A frontal camera cannot show her back, so the far half of a spin is only
       a smaller, higher, squashed dog — which on its own reads as a sidestep.
       Drawing the path she is travelling fixes it: the eye follows the arc and
       reads a circle. (Cheap, and it doubles as the dust a real dog kicks up.) */
    if (perf && !perf.done && perf.trick === 'spin' && px.info.spinEnv > 0.02) {
      /* Her path is (home.x + rx*sin th, home.y - ry*(1-cos th)/2), which is an
         ellipse centred half a depth back, parameterised by phi = pi/2 - th.
         Getting that mapping wrong draws a mirrored arc that fights the
         motion, so it is derived rather than eyeballed. */
      const S = BALANCE.rig.trick.spin;
      const env = px.info.spinEnv;
      const soft = reduced ? 0.42 : 1;
      const rx = S.rx * soft;
      const ryh = (S.ry * soft) / 2;
      const cx = rig.home.x, cy = rig.home.y - ryh;
      const phi0 = Math.PI / 2, phi = Math.PI / 2 - px.info.spinTh;
      c.save();
      c.globalAlpha = env * S.scuff * 0.34;
      c.strokeStyle = 'rgba(120,74,44,0.9)';
      c.lineWidth = 2.0; c.setLineDash([4, 8]);
      c.beginPath(); c.ellipse(cx, cy, rx, Math.max(2, ryh), 0, 0, TAU); c.stroke();
      c.setLineDash([]);
      /* a brighter smear over the arc she has already covered */
      c.globalAlpha = env * S.scuff * 0.60;
      c.strokeStyle = 'rgba(255,242,208,0.9)';
      c.lineWidth = 3.2;
      c.beginPath();
      c.ellipse(cx, cy, rx, Math.max(2, ryh), 0, phi0, phi, true);
      c.stroke();
      c.restore();
    }

    /* ---- the treat she is owed ---- */
    if (tr > 0.01) {
      const p = rig.pose;
      const mx = rig.x + (p.muzX + 30) * rig.s;
      const my = rig.y + (p.muzY + 6) * rig.s * (rig.sy || 1);
      const pop = clamp(tr, 0, 1);
      const pulse = 1 + Math.sin(clock * 7) * 0.06;
      /* the window closing, drawn as a ring that shrinks — the only "timer" in
         the game, and it is about her waiting, not about a score */
      if (perf && perf.rewardAt >= 0 && !perf.rewarded) {
        const left = clamp(1 - (clock - perf.rewardAt) / T.reward.window, 0, 1);
        c.save();
        c.globalAlpha = pop * 0.75;
        c.strokeStyle = C.ring;
        c.lineWidth = 2.4;
        c.beginPath();
        c.arc(mx, my, 26 * pulse, -Math.PI / 2, -Math.PI / 2 + TAU * left);
        c.stroke();
        c.restore();
      }
      drawTreat(c, mx, my, pop * pulse);
    }

    /* ---- the ghost gesture hint: dotted arrow on her body ---- */
    if (w > 0.02 && hintPose && !perf && sinceInput > T.hintAfter) {
      const a = clamp((sinceInput - T.hintAfter) / 0.8, 0, 1) * T.hintAlpha * w;
      drawGuideGhost(c, hintPose, a);
    }

    /* ---- the "?" when she has no idea ---- */
    if (confusedMark > 0.02) {
      const h = rig.headWorld();
      drawQuery(c, h.x + 34 * rig.s, h.y - 52 * rig.s, 1.0, confusedMark);
    }
  }

  /** a little biscuit */
  function drawTreat(c, x, y, k) {
    if (k <= 0.01) return;
    const s2 = 1 * k;
    c.save();
    c.translate(x, y);
    c.scale(s2, s2);
    c.rotate(-0.24);
    c.fillStyle = 'rgba(104,58,32,0.20)';
    ell(c, 0, 7, 13, 4); c.fill();
    c.fillStyle = C.treatD;
    roundRect(c, -12, -8.5, 24, 17, 6); c.fill();
    c.fillStyle = C.treat;
    roundRect(c, -12, -10, 24, 17, 6); c.fill();
    c.fillStyle = C.treatL;
    roundRect(c, -8, -7, 8, 4, 2); c.fill();
    c.fillStyle = 'rgba(140,90,48,0.55)';
    ell(c, 3, 0, 2.2, 2.2); c.fill();
    ell(c, -4, 3, 1.8, 1.8); c.fill();
    ell(c, 6, -5, 1.6, 1.6); c.fill();
    c.restore();
  }

  /** a hand-drawn question mark, so there is no font dependency */
  function drawQuery(c, x, y, s2, a) {
    c.save();
    c.globalAlpha = clamp(a, 0, 1) * 0.9;
    c.translate(x, y - (1 - a) * 10);
    c.scale(s2, s2);
    c.strokeStyle = C.hint;
    c.lineWidth = 3.4; c.lineCap = 'round';
    c.shadowColor = 'rgba(48,24,12,0.5)'; c.shadowBlur = 4;
    c.beginPath();
    c.moveTo(-5, -9);
    c.bezierCurveTo(-5, -16, 7, -16, 6, -8);
    c.bezierCurveTo(5, -3, 0, -2, 0, 3);
    c.stroke();
    c.beginPath();
    c.arc(0, 9, 1.9, 0, TAU);
    c.fillStyle = C.hint; c.fill();
    c.restore();
  }

  /** the suggested guide gesture, drawn on her as a dotted path + fingertip */
  function drawGuideGhost(c, id, a) {
    if (a <= 0.01 || !pet || !TRICKS[id]) return;
    const spec = TRICKS[id];
    const anchor = (part) => pet.anchor(part);
    const toV = (lx, ly) => ({ x: rig.x + lx * rig.s, y: rig.y + ly * rig.s * (rig.sy || 1) });
    let from = null, to = null, kind = 'line';
    const head = anchor('head'), body = anchor('body'), muz = anchor('muz');
    if (spec.guide === 'headDown') {
      from = toV(head.x, head.y - head.hy * 0.55);
      to = toV(head.x, head.y + head.hy * 0.62);
    } else if (spec.guide === 'chinUp') {
      from = toV(body.x, body.y + body.hy * 0.55);
      to = toV(muz.x, muz.y + 8);
    } else if (spec.guide === 'pawWiggle') {
      const p = toV(body.x + body.hx * 0.42, -4);
      from = { x: p.x, y: p.y - 16 }; to = { x: p.x, y: p.y + 10 };
      kind = 'wiggle';
    } else if (spec.guide === 'bodyAcross') {
      from = toV(body.x - body.hx * 0.7, body.y + body.hy * 0.5);
      to = toV(body.x + body.hx * 0.7, body.y + body.hy * 0.5);
    } else if (spec.guide === 'flankHold') {
      from = toV(body.x + body.hx * 0.3, body.y + body.hy * 0.55);
      to = from; kind = 'hold';
    } else if (spec.guide === 'tapAbove') {
      from = toV(head.x, head.y - head.hy * 1.5);
      to = from; kind = 'taps';
    } else if (spec.guide === 'floorCircle') {
      from = toV(body.x, 16);
      to = from; kind = 'circle';
    }
    if (!from) return;
    const ph = (clock * 0.9) % 1;
    c.save();
    c.globalAlpha = clamp(a, 0, 1);
    c.strokeStyle = C.hint;
    c.lineWidth = 2.0; c.lineCap = 'round';
    c.setLineDash([3, 6]);
    if (kind === 'line' || kind === 'wiggle') {
      c.beginPath(); c.moveTo(from.x, from.y); c.lineTo(to.x, to.y); c.stroke();
    } else if (kind === 'circle') {
      c.beginPath(); c.ellipse(from.x, from.y, 30, 12, 0, 0, TAU); c.stroke();
    }
    c.setLineDash([]);
    /* the fingertip, travelling the path so the direction is unmistakable */
    let fx = from.x, fy = from.y;
    if (kind === 'line') { fx = lerp(from.x, to.x, ph); fy = lerp(from.y, to.y, ph); }
    else if (kind === 'wiggle') { fy = lerp(from.y, to.y, hump(ph)); }
    else if (kind === 'circle') { fx = from.x + Math.cos(ph * TAU) * 30; fy = from.y + Math.sin(ph * TAU) * 12; }
    else if (kind === 'taps') { fy = from.y - hump(ph) * 8; }
    else if (kind === 'hold') { /* stays put, pulses */ }
    const r = kind === 'hold' ? 8 + Math.sin(clock * 5) * 2 : 7;
    c.globalAlpha = clamp(a, 0, 1) * 1.4;
    c.fillStyle = 'rgba(255,246,214,0.55)';
    c.beginPath(); c.arc(fx, fy, r, 0, TAU); c.fill();
    c.strokeStyle = C.hint; c.lineWidth = 1.6;
    c.beginPath(); c.arc(fx, fy, r, 0, TAU); c.stroke();
    c.restore();
  }

  /** the pad, the legend, the hint and the read-back — OVER everything */
  function drawOver(g) {
    const w = sp.train.x;
    if (w < 0.004) return;
    const c = g.ctx;
    const busy = !!(perf && !perf.done);
    /* the chrome gets out of the way while she is actually doing something */
    const chrome = clamp(w, 0, 1) * (busy ? 0.35 : 1);

    /* ---- the signal pad ----
       A soft panel with corner marks rather than a dashed outline. The first
       version drew a full dashed rectangle and it cut straight across the
       window and the shelf, which read as a UI accident rather than as a place
       to draw. Corner ticks say "this area" without fencing off the room. */
    const pd = T.pad;
    const pw = VW - pd.inset * 2, ph = pd.bottom - pd.top;
    c.save();
    c.globalAlpha = chrome * 0.85;
    const pg = c.createLinearGradient(0, pd.top, 0, pd.bottom);
    pg.addColorStop(0, 'rgba(255,248,234,0.22)');
    pg.addColorStop(0.55, 'rgba(255,248,234,0.13)');
    pg.addColorStop(1, 'rgba(255,248,234,0.03)');
    c.fillStyle = pg;
    roundRect(c, pd.inset, pd.top, pw, ph, pd.r); c.fill();
    /* corner marks */
    c.globalAlpha = chrome * 0.55;
    c.strokeStyle = C.padLine; c.lineWidth = 1.6; c.lineCap = 'round';
    const mk = 16;
    const corner = (x, y, sx, sy) => {
      c.beginPath();
      c.moveTo(x + sx * mk, y);
      c.lineTo(x + sx * pd.r * 0.4, y);
      c.quadraticCurveTo(x, y, x, y + sy * pd.r * 0.4);
      c.lineTo(x, y + sy * mk);
      c.stroke();
    };
    corner(pd.inset, pd.top, 1, 1);
    corner(pd.inset + pw, pd.top, -1, 1);
    corner(pd.inset, pd.bottom, 1, -1);
    corner(pd.inset + pw, pd.bottom, -1, -1);
    c.restore();

    /* ---- the read-back: WHAT SHE THOUGHT YOU DREW ----
       If it differs from the shape you actually made, you can see her mishear
       it. No words needed. */
    const fl = sp.cueFlash.x;
    if (fl > 0.02 && cue.sig) {
      const a = clamp(fl, 0, 1) * (1 - clamp((clock - cue.at) / 1.1, 0, 1));
      if (a > 0.01) {
        drawSignalGlyph(c, VW / 2, (pd.top + pd.bottom) / 2, 34 * (0.8 + fl * 0.3),
          cue.sig, a * 0.9, cue.misread);
      }
    }

    /* ---- the legend: HER understanding, in words ---- */
    drawLegend(c, chrome);

    /* ---- one quiet hint line ---- */
    if (hint) {
      c.save();
      c.globalAlpha = clamp(w, 0, 1) * clamp(hintT / 0.4, 0, 1) * 0.86;
      c.fillStyle = C.hint;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = '600 12.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      c.shadowColor = 'rgba(48,24,12,0.65)'; c.shadowBlur = 6; c.shadowOffsetY = 1;
      c.fillText(hint, VW / 2, UI.hintY);
      c.restore();
    }

    /* ---- leave affordance (same shape and place as the care actions) ---- */
    c.save();
    c.globalAlpha = clamp(w, 0, 1) * 0.62;
    c.fillStyle = '#fff8ea';
    c.beginPath(); c.arc(342, 62, 17, 0, TAU); c.fill();
    c.globalAlpha = clamp(w, 0, 1) * 0.8;
    c.strokeStyle = '#7c4a2f'; c.lineWidth = 2.0; c.lineCap = 'round';
    c.beginPath();
    c.moveTo(336, 56); c.lineTo(348, 68);
    c.moveTo(348, 56); c.lineTo(336, 68);
    c.stroke();
    c.restore();

    /* ---- "CALL HIM" — the only microphone affordance in the game ----
       Drawn only when she has opted in AND the recogniser has not retired
       itself. It never appears as a fallback, an error, or a nag: it is a
       little extra button that is simply absent when it cannot work. */
    if (voice && voice.armed) drawCallButton(c, clamp(w, 0, 1));
  }

  /** a small speech-bubble button that pulses while it is listening */
  function drawCallButton(c, a) {
    const B = T.voice.button;
    const live = voice.listening;
    const pulse = live ? 1 + Math.sin(clock * 6.5) * 0.10 : 1;
    c.save();
    c.globalAlpha = a * (live ? 0.95 : 0.62);
    c.translate(B.x, B.y);
    c.scale(pulse, pulse);
    c.fillStyle = live ? '#fff3d8' : '#fff8ea';
    c.beginPath(); c.arc(0, 0, B.r, 0, TAU); c.fill();
    /* a speech bubble, drawn rather than typeset — no font dependency, and it
       says "say something" without saying "microphone" */
    c.strokeStyle = '#7c4a2f'; c.lineWidth = 2.0; c.lineJoin = 'round'; c.lineCap = 'round';
    c.globalAlpha = a * (live ? 1 : 0.78);
    roundRect(c, -9, -8, 18, 12, 4);
    c.stroke();
    c.beginPath();
    c.moveTo(-3.5, 4); c.lineTo(-1.5, 8.5); c.lineTo(1.5, 4);
    c.stroke();
    if (live) {
      /* three dots filling left-to-right: something is happening, and it is
         about waiting rather than about a level meter (there is no real level
         available — raw samples do not flow on the device) */
      const ph = (clock * 2.4) % 3;
      for (let i = 0; i < 3; i++) {
        c.globalAlpha = a * (ph >= i ? 0.95 : 0.30);
        c.beginPath(); c.arc(-4.5 + i * 4.5, -2, 1.6, 0, TAU);
        c.fillStyle = '#7c4a2f'; c.fill();
      }
    }
    c.restore();
  }

  /**
   * THE CUE LEGEND — the one piece of UI that makes mis-association visible.
   * Every row is a signal she has bound and the trick SHE thinks it means,
   * with how sure she is IN WORDS. Reading it is how you discover she has got
   * the wrong idea, and it is deliberately her list, not yours.
   */
  function drawLegend(c, a) {
    if (a < 0.02) return;
    const rows = [];
    for (const sig of SG.ids) {
      const ids = game.tricksForCue(sig);
      if (!ids.length) continue;
      ids.sort((x, y) => game.trick(y).cueConf - game.trick(x).cueConf);
      for (const id of ids) {
        rows.push({ sig, id, word: game.describeCueConf(id), lvl: game.describeTrickLevel(id) });
        if (rows.length >= UI.maxRows) break;
      }
      if (rows.length >= UI.maxRows) break;
    }
    const x0 = T.pad.inset + 18;
    let y = UI.legendTop;
    c.save();
    c.textBaseline = 'middle';
    /* THIS TEXT HAS TO BE READABLE OR THE MECHANIC IS INVISIBLE. The first
       version was cream at 0.62 alpha, and the room behind it is a warm CREAM
       wall — rendering it and looking at it, "He has not learned a signal yet"
       was essentially not there. Cream-on-cream is unfixable by nudging alpha,
       so the rows get the same treatment the hint line already uses: a soft
       dark drop shadow that gives every glyph its own contrast regardless of
       what is behind it. (The phone is in dark mode and this is a light design,
       so there is no system colour to lean on either — see PLATFORM-RISKS.) */
    c.shadowColor = 'rgba(48,24,12,0.72)';
    c.shadowBlur = 5;
    c.shadowOffsetY = 1;
    c.globalAlpha = a * 0.88;
    c.fillStyle = C.glyph;
    c.textAlign = 'left';
    c.font = '600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    c.fillText(rows.length ? COPY.legendTitle(P()).toUpperCase() : COPY.legendEmpty(P()), x0, y);
    y += 16;
    for (const r of rows) {
      drawSignalGlyph(c, x0 + 9, y, 9, r.sig, a * 0.98, false);
      c.globalAlpha = a * 0.98;
      c.fillStyle = C.glyph;
      c.font = '600 11.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      c.textAlign = 'left';
      c.fillText(trickName(r.id), x0 + 26, y);
      /* the confidence word is the quiet half of the row, but "muddled" is the
         tell that he has the wrong idea — so it stays legible, just softer */
      c.globalAlpha = a * 0.82;
      c.font = '500 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      c.textAlign = 'right';
      c.fillText(r.word + ' · ' + r.lvl, VW - T.pad.inset - 18, y);
      y += UI.rowH;
    }
    c.restore();
  }

  /**
   * A signal, drawn as a shape rather than typeset — a dot, two dots, a ring,
   * an arrow, a loop. `warn` outlines it when she has misread what you drew.
   */
  function drawSignalGlyph(c, x, y, r, sig, a, warn) {
    c.save();
    c.globalAlpha = clamp(a, 0, 1);
    c.translate(x, y);
    c.strokeStyle = warn ? '#ffd9a8' : C.glyph;
    c.fillStyle = warn ? '#ffd9a8' : C.glyph;
    c.lineWidth = Math.max(1.6, r * 0.16);
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.shadowColor = 'rgba(48,24,12,0.45)'; c.shadowBlur = r * 0.3;
    const arrow = (dx, dy) => {
      c.beginPath();
      c.moveTo(-dx * r, -dy * r); c.lineTo(dx * r, dy * r); c.stroke();
      c.beginPath();
      c.moveTo(dx * r, dy * r);
      c.lineTo(dx * r - (dx + dy) * r * 0.45, dy * r - (dy - dx) * r * 0.45);
      c.moveTo(dx * r, dy * r);
      c.lineTo(dx * r - (dx - dy) * r * 0.45, dy * r - (dy + dx) * r * 0.45);
      c.stroke();
    };
    if (sig === 'tap') { c.beginPath(); c.arc(0, 0, r * 0.32, 0, TAU); c.fill(); }
    else if (sig === 'double') {
      c.beginPath(); c.arc(-r * 0.34, 0, r * 0.28, 0, TAU); c.fill();
      c.beginPath(); c.arc(r * 0.34, 0, r * 0.28, 0, TAU); c.fill();
    } else if (sig === 'hold') {
      c.beginPath(); c.arc(0, 0, r * 0.30, 0, TAU); c.fill();
      c.globalAlpha = clamp(a, 0, 1) * 0.6;
      c.beginPath(); c.arc(0, 0, r * 0.66, 0, TAU); c.stroke();
    } else if (sig === 'up') arrow(0, -1);
    else if (sig === 'down') arrow(0, 1);
    else if (sig === 'left') arrow(-1, 0);
    else if (sig === 'right') arrow(1, 0);
    else if (sig === 'circle') {
      c.beginPath();
      c.arc(0, 0, r * 0.62, 0.5, 0.5 + TAU * 0.86);
      c.stroke();
      const th = 0.5 + TAU * 0.86;
      const hx = Math.cos(th) * r * 0.62, hy = Math.sin(th) * r * 0.62;
      c.beginPath();
      c.moveTo(hx, hy);
      c.lineTo(hx - Math.cos(th - 0.9) * r * 0.3, hy - Math.sin(th - 0.9) * r * 0.3);
      c.stroke();
    }
    c.restore();
  }

  /* ================================================================== */
  /*  the public surface                                                */
  /* ================================================================== */
  const api = {
    /* ---- room-facing ---- */
    get active() { return on || sp.train.x > 0.01; },
    get modal() { return on; },
    /** true while she is mid-trick: the room stops dog/toy.js resetting her */
    get busy() { return !!(perf && !perf.done); },
    get weight() { return sp.train.x; },
    get hint() { return hint; },
    start: startMode,
    stop: stopMode,
    update, apply, pointer, drawFront, drawOver,
    /** one heard transcript (dog/voice.js onHeard). Returns what he made of
        it: {kind:'teach'|'name'|'cue'|'unknown'|'nothing', ...} */
    heard,
    /** open the mic for ONE utterance. Must be inside a user gesture. */
    callHim,
    /** true while a single-shot recognition is in flight */
    get listening() { return !!(voice && voice.listening); },

    /* ================================================================
       STAGE 5 (OBEDIENCE TRIAL) INTERFACE
       ----------------------------------------------------------------
       A judge needs four things: what to ask for, how likely it is, how fast
       the answer came, and whether it was right. All four are here, and none
       of them needs the training UI to be up.
       ================================================================ */
    /**
     * Ask for a trick BY ID, bypassing cue interpretation entirely (the judge
     * says the word out loud; she does not have to read your hand).
     * @param id trick id
     * @param o  { judged:true } suppresses the treat, the hints and the
     *           reward window, so a contest scores the performance itself.
     *           { force:true } skips the obedience roll (demos, tutorials).
     * @returns the live performance object, or null if she ignored it / is busy
     */
    perform(id, o = {}) {
      if (!TRICKS[id]) return null;
      return start(id, { ...o, judged: o.judged !== false, sig: '' });
    },
    /** the live performance — poll it, or subscribe with onPerform */
    get performance() {
      if (!perf) return null;
      return {
        trick: perf.trick, asked: perf.asked, sig: perf.sig,
        state: perf.state, outcome: perf.outcome,
        correct: perf.correct, latency: perf.latency, reached: perf.reached,
        held: perf.held, holdFor: perf.holdFor, holdKept: perf.holdKept,
        rewarded: perf.rewarded, quality: +(perf.quality || 0).toFixed(3),
        taught: perf.taught, judged: perf.judged, done: perf.done,
      };
    },
    /**
     * Every result, as it lands: { trick, asked, sig, outcome, correct,
     * latency, quality, held, taught, judged, confused, boundTo, level, reps }.
     * `outcome` is 'obey' | 'hesitate' | 'wrong' | 'ignore' | 'guided'.
     */
    onPerform(fn) { listeners.push(fn); return () => { listeners = listeners.filter((f) => f !== fn); }; },
    /** the probability model, so a judge can pick a fair trick */
    chanceOf,
    /** seconds she can hold a pose — practice depth, which the trial scores */
    holdFor,
    /** what she can be asked to do, best first */
    repertoire() {
      return TRICK_IDS.map((id) => {
        const rec = game.trick(id);
        const ch = chanceOf(id);
        return {
          id, name: trickName(id), level: rec.level | 0,
          word: game.describeTrickLevel(id),
          cue: rec.cue, cueWord: game.describeCueConf(id),
          reps: +rec.reps.toFixed(2),
          asked: rec.asked, ok: rec.ok,
          reliability: ch.obey, holdFor: holdFor(id),
          prereq: TRICKS[id].prereq, transient: !!TRICKS[id].transient,
        };
      }).filter((r) => r.reps > 0).sort((a, b) => b.reliability - a.reliability);
    },
    /** the roster itself, for a judge that wants to teach as well as test */
    get roster() { return TRICK_IDS.map((id) => ({ id, name: trickName(id), ...TRICKS[id] })); },
    trickForCue,
    cueFor: (id) => game.cueFor(id),
    isLearned: (id) => game.isLearned(id),
    get posture() { return posture(); },

    /* ---- test / harness drivers (deterministic, never sleep-and-hope) ---- */
    /** deliver a signal as if it had been drawn perfectly */
    injectSignal(sig, conf) { return giveSignal(sig, conf === undefined ? 1 : conf, false); },
    /** guide her into a trick as if the gesture had been performed */
    injectGuide(id, extra) { return TRICKS[id] ? guideInto(id, extra) : null; },
    /** take the treat now */
    injectReward() { return reward(); },
    get cue() { return { ...cue }; },

    get debug() {
      const tricks = {};
      for (const id of TRICK_IDS) {
        const r = game.trick(id);
        if (!r.reps && !r.cue) continue;
        tricks[id] = {
          lv: r.level, reps: +r.reps.toFixed(2), cue: r.cue,
          conf: +r.cueConf.toFixed(2), asked: r.asked, ok: r.ok,
          word: game.describeTrickLevel(id), hold: holdFor(id),
        };
      }
      const cues = {};
      for (const sig of SG.ids) {
        const ids = game.tricksForCue(sig);
        if (ids.length) cues[sig] = ids.length === 1 ? ids[0] : ids.slice();
      }
      return {
        on, w: +sp.train.x.toFixed(3), posture: posture(),
        hint, hintPose,
        cue: { drawn: cue.drawn, read: cue.sig, misread: cue.misread, conf: +cue.conf.toFixed(2) },
        perf: api.performance,
        tricks, cues,
        known: game.known(),
        treat: +sp.treat.x.toFixed(2),
        voice: voice ? voice.debug : null,
        /* what he has heard and what he thinks each word means */
        words: (() => { const o = {}; for (const k of game.spokenCues()) o[k] = game.wordFor(k); return o; })(),
        lastWord, pendingWord, call: +sp.call.x.toFixed(3),
        memory: memory.map((m) => m.id),
      };
    },
  };

  return api;
}

export default createTraining;
