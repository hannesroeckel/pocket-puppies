/* ==========================================================================
   dog/disc.js — THE DISC GAME: catch and leap.

   SCOPE.md stage 5's design, built at last:

     "She flicks the disc up-screen, he tracks it upward from the front, and she
      times a tap for the leap and catch. Score by height and airtime rather
      than distance zone. Reuses the frontal-safe throw built for toys in stage
      2."

   WHAT SHE ACTUALLY DOES, per throw:

     1. the disc is in her hand at the bottom of the screen. She FLICKS it
        up-screen — the same gesture, and the same `BALANCE.toy.flick` numbers,
        that stage 2 tuned against a real thumb.
     2. it rises away from the viewer, scaling down, and HANGS near the top.
        He tracks it: `rig.lookAtVirtual` every frame, which is the whole of
        "he tracks it upward from the front".
     3. as it falls back toward him she TAPS, and he leaps.
     4. inside the window he catches it. Outside it he does not, and the miss
        still scores something, because "losing must never feel like rebuke".

   THREE THINGS THIS FILE DELIBERATELY DOES NOT DO
   -----------------------------------------------
   NO LATERAL THROW. The disc's sideways drift is clamped to ±46 units exactly
   as the toy's is: throwing across the screen needs the side-profile rig that
   was deliberately never built, and a disc is the most tempting thing in the
   game to throw sideways.

   NO `train.perform`. The leap drives `TRICK_POSE.jump` directly, with this
   layer's own clock. Going through a performance would put the obedience roll,
   `chanceOf` and a latency in front of the leap — correct for a trial, fatal for
   a timing game, where the jump has to happen on the frame she asked for it.

   NO LADDER. `state/disc.js` explains why in full: SCOPE's non-negotiables cut
   "rank ladders per contest type" outright. There is a personal best, a daily
   count, and coins.

   PIPELINE POSITION. `apply()` runs where `care.apply` / `train.apply` / the
   trial's do, i.e. after `pet.apply()`, and it writes TARGETS ONLY. The room
   skips `toy.apply` while this layer is `busy`, because the toy layer resets the
   rig's placement channels every idle frame and would fight the leap.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { makeSprings } from '../engine/spring.js';
import { TAU, clamp, lerp, smooth, hump, ell } from '../engine/draw.js';
import { rng as sharedRng } from '../engine/rng.js';
import { TRICK_POSE } from './anim/tricks.js';
import { drawText } from '../ui/text.js';
import { INK, SURF, R as RAD, type, NOMINAL } from '../ui/tokens.js';
import { card as drawCard, tactile } from '../ui/surface.js';
import {
  discState, discEntryCheck, scoreThrow, roundPerformance, discScore, discPrize, discWord,
} from '../state/disc.js';

const D = BALANCE.disc;
const U = D.ui;
const TOY = BALANCE.toy;
const RING = BALANCE.contest.ring;
const VW = BALANCE.view.W;
const VH = BALANCE.view.H;

/* ==========================================================================
   COPY — every player-facing string, pronouns from `game.pron` at call time.
   ========================================================================== */
const COPY = {
  title: () => 'Disc',
  entryLine: (P) => `Flick it up and time ${P.their} jump`,
  enter: () => 'Play a round',
  practice: () => 'Just for fun',
  practiceNote: (P) => `${P.they === 'they' ? 'They have' : (P.they === 'he' ? 'He has' : 'She has')} had ${P.their} three for today — this one is for fun`,
  /* "NEVER SIDEWAYS" IS GONE, AND ITS ABSENCE IS THE FEATURE. It was the toy
     rig's prohibition, inherited wholesale: a ball thrown across the room needed
     a dog who could run across the room, and there wasn't one. He covers ground
     now, so a sideways flick is not a mistake — it is the interesting throw, and
     this line was telling her off for the one thing the new mechanic added. The
     BALL's hint in scenes/room.js still says "never sideways", and the two
     deliberately differ now. */
  ready: () => 'Flick the disc up-screen',
  /* WHEN THE GATE IS SHUT, THE BUTTON IS THE FIX — copied from contest.js, whose
     note explains why: pressing it takes her to the bowl rather than telling her
     no twice. This panel had a button labelled "Leave" that called `onNeed` and
     opened the food bowl, so it said one thing and did another. */
  gateGo: (P, reason) => ({
    hunger: `Feed ${P.them} first`,
    thirst: `Water ${P.them} first`,
  }[reason] || 'Not today'),
  /* "when it drops" rather than just "tap": the timing IS the game, and the one
     line that is on screen while she is playing should say so. */
  tapNow: (P) => `Tap as it drops to ${P.them}`,
  caught: () => 'Caught it!',
  missed: (P) => `${P.they === 'they' ? 'They' : (P.they === 'he' ? 'He' : 'She')} just missed it`,
  tooSoon: (P) => `A little early`,
  tooLate: (P) => `A little late`,
  gateHunger: (P) => `${P.they === 'he' ? 'He is' : (P.they === 'she' ? 'She is' : 'They are')} too hungry to be running about`,
  gateThirst: (P) => `${P.they === 'he' ? 'He needs' : (P.they === 'she' ? 'She needs' : 'They need')} a drink first`,
  best: (n) => `Best: ${n.toFixed(2)}`,
  paid: (n) => `+${n} coins`,
  none: () => 'Just for fun',
  done: () => 'Done',
  /* NO 'Leave' ANY MORE. It labelled the shut-gate button, which then called
     `onNeed` and opened the food bowl — the button said one thing and did
     another. `gateGo` above is the fix, copied from contest.js. */
};

export function createDisc(rig, opts = {}) {
  const game = opts.game;
  const idle = opts.idle;
  const rng = opts.rng || sharedRng;
  const reduced = !!opts.reduced;
  const spawn = opts.spawn || (() => {});
  const sound = opts.sound || (() => {});
  const toast = opts.toast || (() => {});
  /** the shut-gate router: room.js turns a reason into the care action that fixes it */
  const onNeed = opts.onNeed || (() => {});
  const s = rig.springs;

  const sp = makeSprings(['field', 'card', 'panel', 'flash'], reduced);

  /* ---- the beat ---------------------------------------------------- */
  let beat = '';              // '' | 'entry' | 'play' | 'card'
  let phase = '';             // ready | fly | leap | settle
  let clock = 0;
  let t = 0;                  // seconds in the current PHASE
  /* SECONDS SINCE THE DISC LEFT HER HAND, which is a different clock from `t`
     and has to be. The miss branch sets `phase = 'settle'` and `t = 0`, and while
     the flight was read off `t` that reset sent the disc back to the start of its
     own arc: it flew a second time, from her hand, and never landed. One clock
     for "how long has this beat been going" and one for "where is the disc". */
  let flyT = 0;
  let gate = null;
  let round = null;
  let hint = '';

  /* ---- the disc ---------------------------------------------------- */
  /* `held` is HER hand; `mouth` is HIS. Two different things holding the same
     disc, and conflating them is how a caught disc ends up back on her thumb. */
  const disc = { x: 0, y: 0, scale: 1, spin: 0, held: false, mouth: false,
                 floor: 0, gone: false, down: false };
  const trail = [];

  /* ---- the leap, on its own clock ---------------------------------- */
  let leap = null;            // { t, dur, caught, at }

  /* the bag `TRICK_POSE.jump` wants, allocated once and mutated in place —
     the same shape dog/train.js builds for the same poses */
  const px = {
    rig, s, pawLift: rig.pawLift, reduced, rng, sound, spawn,
    flags: { side: 1, dir: 1 }, info: {},
  };

  const P = () => game.pron;
  function setHint(v) { hint = v; }

  /* ================================================================== */
  /*  ENTERING                                                          */
  /* ================================================================== */
  function start() {
    if (beat) return false;
    gate = discEntryCheck(game);
    beat = 'entry';
    t = 0;
    sp.field.to(1);
    sp.panel.set(0).to(1);
    setHint('');
    return true;
  }

  function stop(quiet) {
    const wasPlaying = beat === 'play';
    /* HE GOES BACK WHERE THE ROOM EXPECTS HIM. The run moves `rig.x`, and every
       other layer — the petting field, the bowl's reach, the trial's mat — is
       written against `rig.home`. Leaving mid-round while he is 58 units off
       centre would hand the next scene a dog standing beside himself. */
    rig.x = rig.home.x;
    rig.sy = 1;
    beat = '';
    phase = '';
    round = null;
    leap = null;
    disc.held = false;
    disc.mouth = false;
    disc.down = false;
    disc.gone = true;
    trail.length = 0;
    sp.field.to(0); sp.card.to(0); sp.panel.to(0);
    setHint('');
    /* AN ABANDONED ROUND COSTS NOTHING AND BANKS NOTHING, exactly as an
       abandoned trial does (ARCHITECTURE 15.1 deviation 7): the daily count is
       spent when a round FINISHES, so walking away is free. */
    if (wasPlaying && !quiet) toast(COPY.none());
  }

  function begin() {
    round = {
      throwsWanted: Math.max(1, Math.floor(+D.throws || 5)),
      i: 0,
      scores: [],
      caught: 0,
      practice: !!(gate && gate.practice),
      done: false,
      result: null,
    };
    beat = 'play';
    sp.panel.to(0);
    nextThrow();
    sound('perk');
  }

  function nextThrow() {
    if (round.i >= round.throwsWanted) { tally(); return; }
    phase = 'ready';
    t = 0;
    flyT = 0;
    leap = null;
    disc.gone = false;
    disc.held = false;
    disc.mouth = false;
    disc.down = false;
    disc.scale = 1;
    disc.spin = 0;
    /* in her hand, at the bottom right — the same corner the ball rests in, so
       the gesture starts where her thumb already is */
    disc.x = TOY.homeX;
    disc.y = VH - 150;
    disc.floor = disc.y + 16;
    setHint(COPY.ready(P()));
  }

  /* ================================================================== */
  /*  THE FLICK — the toy's gesture, and the toy's numbers               */
  /* ================================================================== */
  function grabbed(x, y) {
    const rx = TOY.r * TOY.grab.r;
    return Math.hypot(x - disc.x, (y - disc.y) * TOY.grab.aspect) < rx;
  }

  /** the same trailing-window velocity read dog/toy.js uses (`flickVel`) */
  function flickVel() {
    if (trail.length < 2) return { vx: 0, vy: 0 };
    const last = trail[trail.length - 1];
    let first = trail[0];
    for (let i = trail.length - 1; i >= 0; i--) {
      if (last.t - trail[i].t <= TOY.flick.sampleWindow) first = trail[i];
      else break;
    }
    const dt = Math.max(0.016, last.t - first.t);
    return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
  }

  function release() {
    const v = flickVel();
    const up = -v.vy;
    trail.length = 0;
    disc.held = false;
    if (up < TOY.flick.minUp) {
      /* not a throw. No scolding, no penalty, no throw spent: it is still in
         her hand and the hint says what to do. */
      disc.y = VH - 150;
      disc.floor = disc.y + 16;
      setHint(COPY.ready(P()));
      sound('toy-drop');
      return;
    }
    const power = clamp((up - TOY.flick.minUp) / (TOY.flick.maxUp - TOY.flick.minUp), 0, 1);
    /* ---- WHERE IT COMES DOWN, AND WHAT THE SIDEWAYS FLICK NOW DOES ------
       The lateral drift is the same ±46 the toy uses, and it is still a DRIFT
       rather than an aim: this is a disc thrown up for a dog, not a disc thrown
       at a target.

       WHAT CHANGED IS WHAT IT IS MEASURED FROM. It used to be `disc.x + lateral`
       — her hand plus the drift — which put every landing within 46 units of the
       BOTTOM-RIGHT CORNER she throws from, 152 units away from where he stands.
       That was invisible while the disc curved back onto his head at the end.
       With the curve gone he was left running at a cap of 58 units toward a disc
       that came down a screen-width away: he caught it, because the catch is
       decided by her timing, but it plainly did not look like catching.

       So the landing is measured from HIM: up out of her hand, across, and down
       to one side of the dog. The drift decides WHICH side and how far, `reach`
       covers it with room to spare, and the sideways flick is now the throw that
       makes him work rather than the throw that was forbidden. */
    /* AND THE DRIFT IS WIDER THAN THE TOY'S. The ball keeps ±46 because a ball
       that lands out of his reach is a ball he cannot fetch without a walk cycle.
       The disc's whole point is that he covers ground for it, so `D.fly.drift` is
       the wider band and `leap.reach` is sized to cover all of it. At ±46 the run
       was 25 units and invisible — a dog shuffling. */
    const cap = Math.max(0, +D.fly.drift || 46);
    const lateral = clamp(v.vx * 0.05, -cap, cap);
    /* inside the band he can stand in with all of him on screen — see
       `leap.edge`, which was measured off his own silhouette rather than guessed */
    const landing = clamp(rig.home.x + lateral, runLo(), runHi());
    /* ---- HOW HIGH IT GOES, MEASURED FROM THE LINE HIS JAWS REACH --------
       This was `lerp(disc.y - 120, vanishY, power)`: her hand for a weak flick,
       an absolute 300 for a hard one. Both numbers were tuned when the disc came
       down to his RESTING head height, and both broke the moment the leap got
       taller — his jaws now reach y 295, a 0.85 flick peaked at 317, and the disc
       therefore "fell" 22 units UPWARD into the catch. It read as a disc bobbing
       at chest height and it made the hang and the catch the same moment.
       So the apex is measured from the catch line: `minRise` above it for the
       weakest throw that counts, `vanishY` for a full one. There is no flick that
       peaks below the height he is jumping to. */
    const jaws = catchLine();
    const apex = Math.min(jaws - (+D.fly.minRise || 90),
      lerp(jaws - (+D.fly.minRise || 90), +D.fly.vanishY || 110, smooth(power)));
    const fly = {
      from: { x: disc.x, y: disc.y },
      to: { x: landing, y: apex },
      dur: lerp(D.fly.dur[0], D.fly.dur[1], power),
      power,
      lateral,
    };
    round.fly = fly;
    phase = 'fly';
    t = 0;
    /* the flight clock starts HERE, at the release, not at the start of the beat */
    flyT = 0;
    setHint(COPY.tapNow(P()));
    sound(U.sfx.throw);
    if (idle) idle.cancel(2.4);
    s.perk.kick(3.4); s.earL.kick(4.2); s.earR.kick(-3.8); s.eyeOpen.kick(2.4);
    rig.blinkNow(1);
  }

  /* ================================================================== */
  /*  THE FLIGHT — up, a hang, and back down into his reach              */
  /* ================================================================== */
  /**
   * WHERE THE DISC IS, at 0..1 through its flight.
   *
   * A DISC HANGS, AND A BALL DOES NOT. `dog/toy.js` uses `hump(u)` and the whole
   * arc is over before anybody could aim at it; that is right for a ball
   * disappearing up-screen and useless for a timing game. This holds it near the
   * apex for `hang` of the flight, then brings it back DOWN into the zone he can
   * leap into — which is what makes the catch a catch rather than a guess.
   */
  /**
   * WHERE HIS JAWS ARE AT THE TOP OF A LEAP.
   *
   * The disc is aimed at this line, and it is the whole reason the leap is worth
   * watching: at `leap.height` 2.45 he clears 88 units, so a disc that arrives
   * at his RESTING head height (which is what it used to do) is a disc he does
   * not have to leave the ground for. `catchShare` meets it a little below the
   * peak because he is still rising there, which is both what a dog does and the
   * kinder of the two.
   */
  function catchLine() {
    const lift = (+BALANCE.rig.trick.hopHeight || 36)
      * (+D.leap.height || 1) * (+D.leap.catchShare || 0.86) * rig.s;
    const headY = rig.y + (rig.pose.headY - rig.dims.headHH * 1.2) * rig.s * (rig.sy || 1);
    return headY - lift;
  }

  /** how long after the tap his jaws are at `catchLine()` */
  function apexDelay() {
    return (+D.leap.dur || 0.95) * clamp(+D.leap.apexAt || 0.45, 0.1, 0.9);
  }

  /**
   * WHERE THE DISC IS, at 0..1 through its flight — and past 1, on its way to
   * the grass.
   *
   * A DISC HANGS, AND A BALL DOES NOT. `dog/toy.js` uses `hump(u)` and the whole
   * arc is over before anybody could aim at it; that is right for a ball
   * disappearing up-screen and useless for a timing game. This holds it near the
   * apex for `hang` of the flight, then brings it back DOWN through the line his
   * jaws reach — arriving there at exactly u = 1.
   *
   * AND IT DOES NOT STOP THERE. The first build clamped u at 1, so the disc came
   * to a dead halt at head height and hung in the air until the leap deleted it:
   * the catch had no moment and the miss had no consequence. Past u = 1 it keeps
   * falling, at the same speed it arrived with, until it is lying on the grass.
   */
  function flightAt(u) {
    const f = round.fly;
    const catchY = catchLine();
    /* ---- past the catch line: still falling, and nothing catches it ----- */
    if (u > 1) {
      const tail = clamp(+D.fly.fallTail || 0.42, 0.1, 1);
      const over = clamp((u - 1) / tail, 0, 1);
      const ground = groundLine();
      /* AND IT COMES BACK TOWARD THE CAMERA AS IT LANDS. Depth is scale on this
         rig, and a disc lying on the grass beside his paw is at HIS depth — so
         holding `depthKeep` all the way down left a full-size dog standing over
         a disc drawn at 0.56, which read as a disc a long way behind him. The
         first version of the flight had the opposite bug (it grew back to full
         size in her face while it was still in the distance), so this eases only
         over the last stretch, and only to where he is. */
      const keep = clamp(+D.fly.depthKeep || 0.82, 0, 1);
      return {
        x: lerp(f.from.x, f.to.x, smooth(Math.min(1, u * 1.35))),
        y: lerp(catchY, ground, over * over),
        rise: 0, depth: lerp(keep, clamp(+D.fly.landDepth || 0.22, 0, 1), smooth(over)), over,
      };
    }
    const hangHalf = clamp(+D.fly.hang || 0.34, 0, 0.9) / 2;
    const mid = clamp(+D.fly.hangAt || 0.42, 0.15, 0.8);
    let rise;
    if (u < mid - hangHalf) {
      rise = smooth(u / Math.max(0.001, mid - hangHalf));          // going up
    } else if (u < mid + hangHalf) {
      rise = 1;                                                     // hanging
    } else {
      /* the fall is quicker than the rise, so the disc spends its last stretch
         low — in the band a leap can actually meet it — rather than gliding down
         through the whole second half of the flight */
      const f2 = (u - (mid + hangHalf)) / Math.max(0.001, 1 - mid - hangHalf);
      rise = 1 - smooth(clamp(f2, 0, 1)) ** 0.72;
    }
    /* ---- IT GOES UP FROM HER HAND AND COMES DOWN TO HIS JAWS ------------
       Two different heights, and using one for both was a real bug caught by a
       gate looking for something else. `rise` used to run between
       `min(from.y, catchY)` and the apex, so on the frame she let go the disc
       jumped 244 units up the screen to the line it would eventually come back
       down to, and then eased up from there. It read as a fast throw and was
       actually a teleport — and it left the disc sitting at the catch line, at a
       standstill, for the first half-second of every flight.
       So: on the way up the base is HER HAND, on the way down it is his jaws.
       `rise` is 1 across the whole hang, so the two bases meet at the apex and
       the swap is invisible. */
    const base = u < mid ? f.from.y : catchY;
    const y = lerp(base, f.to.y, rise) - hump(rise) * D.fly.arc * (0.4 + f.power);
    /* ---- WHERE IT COMES DOWN IS WHERE SHE AIMED IT ----------------------
       The x used to converge on his head through the fall, which meant the throw
       had no consequence: wherever she flicked it, it curved back to him and he
       caught it without moving. He is the one catching it, so the disc keeps its
       own line and HE runs under it — see `run()`. The lateral clamp on the
       throw is what keeps that line inside the distance he can cover. */
    const x = lerp(f.from.x, f.to.x, smooth(Math.min(1, u * 1.35)));
    /* ---- DEPTH IS NOT HEIGHT, AND THIS IS THE DIFFERENCE ----------------
       Scale was driven straight off `rise`, so as the disc came back down it
       grew back to full size — i.e. it flew away from the camera and then
       returned TO the camera, which is not where he is standing. He is across
       the room. So depth rises with the throw and only eases part of the way
       back (`depthKeep`): the disc stays far, and arrives at his jaws still
       small. Caught by a gate assertion that the disc is drawn smaller at the
       catch than it was in her hand, which it was not. */
    const keep = clamp(+D.fly.depthKeep || 0.8, 0, 1);
    const depth = Math.max(rise, keep * (u < mid ? rise : 1));
    return { x, y, rise, depth, over: 0 };
  }

  /** where a missed disc comes to rest: the grass just in front of his paws */
  function groundLine() {
    return Math.min(VH - 92, rig.y - 6);
  }

  /* ================================================================== */
  /*  THE TAP, AND THE LEAP                                             */
  /* ================================================================== */
  /** when in the flight the disc is catchable, in seconds from the throw */
  /**
   * WHEN TO TAP, IN SECONDS FROM THE THROW.
   *
   * One leap before the disc gets here. The flight is built so the disc crosses
   * `catchLine()` at exactly its own duration, and the leap takes `apexDelay()`
   * to put his jaws on that line, so the moment is the difference between them.
   *
   * This used to be a SHARE of the flight (`window.at` 0.86), which quietly made
   * a floaty 1.7s throw and a flat 1.05s one two different games: the same
   * fraction is a quarter of a second apart in the hand. The subtraction is the
   * same physical fact for both.
   */
  function idealAt() { return Math.max(0.12, round.fly.dur - apexDelay()); }
  /** how far into the FLIGHT we are, which is never the phase clock */
  function flightT() { return flyT; }

  function tapped() {
    if (phase !== 'fly' || leap) return false;
    const err = flightT() - idealAt();
    const caught = Math.abs(err) <= (+D.window.half || 0.16);
    leap = { t: 0, dur: +D.leap.dur || 0.95, caught, err, at: t };
    phase = 'leap';
    /* HIS AIRTIME IS THE OVERLAP, not a constant. A tap at the right moment puts
       him in the air across the whole catchable window; an early one has him
       coming down as the disc arrives. That is what SCOPE means by scoring
       airtime, and it is a number she can feel. */
    const half = (+D.window.half || 0.16);
    const overlap = clamp(1 - Math.abs(err) / Math.max(0.001, half * 2), 0, 1);
    const score = scoreThrow({
      caught,
      height: round.fly.power,
      airtime: overlap,
      timing: err,
    });
    round.scores.push(score);
    if (caught) {
      round.caught++;
      sound(U.sfx.catch);
      const n = reduced ? 3 : 6;
      const h = rig.headWorld();
      for (let i = 0; i < n; i++) spawn('heart', h.x + rng.range(-24, 24), h.y + rng.range(-22, 6));
      setHint(COPY.caught(P()));
    } else {
      sound(U.sfx.miss);
      setHint(err < 0 ? COPY.tooSoon(P()) : COPY.tooLate(P()));
    }
    sp.flash.set(0); sp.flash.to(1);
    return true;
  }

  /* ================================================================== */
  /*  THE ROUND'S END                                                   */
  /* ================================================================== */
  function tally() {
    const d = game.dog;
    const performance = roundPerformance(round.scores);
    const brk = discScore({
      performance,
      cleanliness: d.needs.cleanliness,
      gloss: game.gloss,
      /* PER-DOG jitter only. `dog/breeds.js` still carries a per-breed
         `aptitude.disc` and this must never read it (SCOPE: her dream breeds
         must never be mechanically inferior). */
      aptitude: (d.aptitude && d.aptitude.disc) || 0.5,
    });
    const score = brk.total;
    const prize = discPrize(score, { practice: round.practice });
    const banked = game.recordDisc({
      score, prize, practice: round.practice,
      caught: round.caught, thrown: round.scores.length,
    });
    /* the bond through the same channel a trial uses, and never the play ledger:
       paying `awardDay('toy')` here would make the disc game a way to farm the
       bond that petting is metered for. */
    game.awardDay('contest');
    game.addMood(score >= 8.2 ? BALANCE.contest.mood.win
      : score >= 6.8 ? BALANCE.contest.mood.place : BALANCE.contest.mood.ran);
    round.result = { ...banked, breakdown: brk, word: discWord(score), caught: round.caught,
      thrown: round.scores.length, scores: round.scores.slice() };
    round.done = true;
    beat = 'card';
    t = 0;
    sp.card.set(0); sp.card.to(1);
    sound(U.sfx.card);
    setHint('');
  }

  /* ================================================================== */
  /*  UPDATE                                                            */
  /* ================================================================== */
  function update(dt) {
    clock += dt;
    t += dt;
    for (const k in sp) sp[k].step(dt);
    if (!beat) return;

    if (beat === 'play') {
      if (phase === 'fly' || phase === 'leap' || phase === 'settle') {
        /* THE FLIGHT IS NOT CLAMPED AT 1 ANY MORE. Past its own duration the
           disc is below the line his jaws reach and on its way to the grass,
           which is what makes a miss a thing she can see rather than a disc that
           evaporates. It keeps being stepped through `settle` for the same
           reason: the throw is over, the disc is still in the air. */
        flyT += dt;
        const u = flyT / round.fly.dur;
        if (!disc.mouth) {
          const at = flightAt(u);
          disc.x = at.x;
          disc.y = at.y;
          disc.scale = lerp(1, D.fly.minScale, smooth(at.depth) * (0.5 + round.fly.power * 0.5));
          disc.spin += dt * D.fly.spin * (0.4 + round.fly.power) * (disc.down ? 0.12 : 1);
          /* ---- THE SHADOW GOES ON THE GRASS ----------------------------
             It used to hang 200 units under the disc wherever the disc was, which
             indoors was close enough to a floor and in a field is a grey smudge
             following it around the sky. A cast shadow belongs on the ground, and
             on the ground it is also the most useful thing on the screen: it is
             how she can see WHERE the disc is coming down and roughly when. */
          disc.floor = groundLine() + 10;
          if (at.over >= 1 && !disc.down) {
            /* it has landed. Lying on the grass in front of him is the whole
               feedback: nobody says anything about it. */
            disc.down = true;
            disc.floor = disc.y + 10;
            sound('toy-land');   // the ball's own landing, because it is one
          }
          rig.lookAtVirtual(disc.x, disc.y);
        }
        /* ---- HE TAKES IT OUT OF THE AIR --------------------------------
           At the apex of a caught leap the disc stops being a falling object and
           becomes a thing in his mouth: drawn at his muzzle, carried through the
           landing, and handed back for the next throw. It used to simply set
           `gone` and vanish mid-frame, which is why the catch never read as a
           catch — there was no moment at which he had it. */
        if (leap && leap.caught && !disc.mouth
          && leap.t >= apexDelay() * (+D.leap.catchShare || 0.86)) {
          disc.mouth = true;
          disc.down = false;
          s.mouth.to(0.06);
          if (!reduced) rig.drive.wiggle = Math.max(rig.drive.wiggle || 0, 0.4);
        }
        if (u >= 1 && phase === 'fly') {
          /* she never tapped. Not a scolding — he watched it land. */
          round.scores.push(scoreThrow({ caught: false, timing: (+D.window.grace || 0.3) }));
          setHint(COPY.missed(P()));
          sound(U.sfx.miss);
          phase = 'settle';
          t = 0;
        }
      }
      if (phase === 'leap') {
        leap.t += dt;
        if (leap.t >= leap.dur) { phase = 'settle'; t = 0; }
      }
      /* THE SETTLE IS LONGER WHEN HE HAS IT, because a dog who has just caught
         something stands there with it. `leap.hold2` is that pause; a miss keeps
         the old 0.85 so the round does not drag on a bad throw. */
      const settleFor = disc.mouth ? (0.85 + (+D.leap.hold2 || 0.6)) : 0.85;
      if (phase === 'settle' && t > settleFor) {
        round.i++;
        nextThrow();
      }
    }
  }

  /* ================================================================== */
  /*  THE RUN — how he gets under it                                     */
  /* ================================================================== */
  /**
   * HE GOES TO THE DISC. IT DOES NOT COME TO HIM.
   *
   * The player's words were "i want the dog to actually catch the disc instead
   * of just staying in place": the disc's x used to converge on his head, so the
   * throw had no consequence and he never moved. Now the disc keeps the line she
   * threw it on and he covers the difference.
   *
   * IT IS NOT A SECOND SKILL. `reach` and `runSpeed` are sized so he is always
   * under it before it arrives — the throw's own lateral clamp (`release`) is
   * inside `reach`, and `reach / runSpeed` is a third of the shortest flight. She
   * can miss the timing; she cannot mis-aim. A run she could lose would be a
   * second way to fail at one gesture, and "losing must never feel like rebuke".
   *
   * A FRONTAL RIG HAS NO WALK CYCLE, so the run is sold the way the reunion
   * sells one (§13.4): small bounds, a squash on each landing, and the ears left
   * behind. Nothing here rotates him, because there is no side of him to show.
   */
  /** the band he may stand in: his own width, kept on screen */
  function runLo() { return Math.max(0, +D.leap.edge || 136); }
  function runHi() { return VW - Math.max(0, +D.leap.edge || 136); }

  function run(dt) {
    if (!round || !beat) return;
    const home = rig.home.x;
    const reach = Math.max(0, +D.leap.reach || 58);
    /* under it, not at it: his HEAD is what has to be beneath the disc, and the
       head sits `pose.headX` off his own origin. Any other beat and he is on his
       way back to the middle — carrying it, if he caught it. */
    const want = (phase === 'fly' || phase === 'leap')
      ? clamp(clamp(round.fly.to.x - rig.pose.headX * rig.s, home - reach, home + reach),
        runLo(), runHi())
      : home;
    /* THE STRETCH IS BORROWED, SO IT IS GIVEN BACK. `rig.sy` is a per-frame drive
       that whoever owns the pose writes; the leap stretches it and this is the
       only place that puts it back, so a round cannot leave him tall. */
    if (!leap) rig.sy = 1;
    const step = Math.max(0, +D.leap.runSpeed || 196) * dt;
    const dx = clamp(want - rig.x, -step, step);
    rig.x += dx;
    /* the bounds, only while he is actually covering ground */
    const B = D.leap.bound || {};
    const speed = Math.abs(dx) / Math.max(dt, 1e-6) / Math.max(1, +D.leap.runSpeed || 196);
    if (speed > 0.12 && phase === 'fly' && !reduced) {
      const b = Math.abs(Math.sin(clock * (+B.rate || 12.5)));
      s.hop.to(Math.max(s.hop.t, b * (+B.lift || 7.5) * speed));
      s.squash.to((+B.squash || 0.05) * (1 - b) * speed);
      s.perk.to(Math.max(s.perk.t, 0.5 * speed));
      s.earBack.to(-0.3 * speed * Math.sign(dx || 1));
      s.tailUp.to(Math.max(s.tailUp.t, 0.5 * speed));
    }
  }

  /**
   * THE LEAP, WRITTEN AS TARGETS. `TRICK_POSE.jump` is the pose stage 3 tuned,
   * driven here on this layer's own clock — with the airborne middle stretched
   * by `leap.hold` so a catch reads as a catch and not as a bounce.
   */
  function apply(dt) {
    if (!beat) return;
    /* HE GETS HIMSELF UNDER IT FIRST. Runs on every frame of the round, leap or
       no leap — the old guard returned early unless he was mid-jump, which is
       fine for a dog who never goes anywhere.

       ON THE ONE RULE THIS COMES CLOSE TO: SCOPE says "no side-profile rig is
       being built ... if any later stage finds itself wanting one, stop and raise
       it rather than quietly building one". This does not want one. He is
       translated along x and bounced; there is no gait cycle, no side of him is
       ever drawn, and nothing here rotates him. That is the same licence
       `TRICK_POSE.spin` takes to trot a circle and the reunion takes to cross
       the room. A real run cycle would need the raise, and would still be v2. */
    run(dt);
    if (!leap) return;
    const raw = clamp(leap.t / leap.dur, 0, 1);
    /* stretch the middle: `jump`'s altitude peaks at u≈0.45, so holding the
       clock either side of that keeps him up there long enough to meet a disc */
    const hold = clamp(+D.leap.hold || 0, 0, 0.6);
    let u = raw;
    if (hold > 0) {
      const lo = 0.45 - hold / 2, hi = 0.45 + hold / 2;
      if (raw > lo && raw < hi) u = 0.45;
      else if (raw >= hi) u = lerp(0.45, 1, (raw - hi) / Math.max(0.001, 1 - hi));
      else u = lerp(0, 0.45, raw / Math.max(0.001, lo));
    }
    const k = clamp(sp.field.x, 0, 1);
    TRICK_POSE.jump(px, k, u);
    /* HIGHER THAN A TRICK JUMP, because this one is going somewhere. `leap.height`
       was declared in BALANCE and then never applied — rendering the catch showed
       a dog who barely left the rug reaching a disc above his head. The pose
       writes `hop` as a TARGET, so this scales that target rather than setting a
       value, and the spring still does the work. */
    const lift = +D.leap.height || 1;
    if (lift !== 1) s.hop.to(s.hop.t * lift);
    /* ---- AND HE REACHES FOR IT ------------------------------------------
       "jumping slightly" was two faults, not one: the altitude, above, and the
       shape. A dog going up for a disc EXTENDS — nose up, body long, mouth open
       to take it. `jump` is authored as a bounce on the spot and keeps him
       tucked, which is right for a trick and wrong here. So on the way up he
       stretches (`sy` past 1 is how this rig says "long", §12.6), his head comes
       further up, and his mouth opens before it closes on the disc. */
    const airborne = clamp((u - 0.20) / 0.45, 0, 1) * (1 - clamp((u - 0.62) / 0.38, 0, 1));
    if (airborne > 0.001 && !reduced) {
      rig.sy = 1 + 0.055 * airborne;
      s.headLift.to(s.headLift.t + 3.2 * airborne);
      if (!disc.mouth) s.mouth.to(Math.max(s.mouth.t, 0.42 * airborne));
      s.tongue.to(Math.max(s.tongue.t, 0.5 * airborne));
    }
    /* he holds it once he has it: a shut mouth is what carrying looks like */
    if (disc.mouth) s.mouth.to(0.06);
  }

  /* ================================================================== */
  /*  POINTER                                                           */
  /* ================================================================== */
  function pointer(ev) {
    if (!beat) return false;

    /* the way out, in the one place the whole game puts it */
    if (ev.type === 'down' && Math.hypot(ev.x - RING.back.x, ev.y - RING.back.y) < RING.back.r + 8) {
      stop(true);
      return true;
    }

    if (beat === 'entry') {
      if (ev.type === 'down') {
        const box = enterBox();
        if (inRect(box, ev.x, ev.y)) {
          if (gate && !gate.ok) { onNeed(gate.need); stop(true); return true; }
          begin();
          return true;
        }
        /* a tap outside the panel is "not now", said by leaving quietly */
        if (ev.y < panelTop() - 10) { stop(true); return true; }
      }
      return true;
    }

    if (beat === 'card') {
      if (ev.type === 'down' && t > 0.45) stop(true);
      return true;
    }

    /* ---- in play ---- */
    if (phase === 'ready') {
      if (ev.type === 'down' && grabbed(ev.x, ev.y)) {
        disc.held = true;
        trail.length = 0;
        trail.push({ x: ev.x, y: ev.y, t: clock });
        return true;
      }
      if (ev.type === 'move' && disc.held) {
        disc.x = clamp(ev.x, TOY.dragX[0], TOY.dragX[1]);
        disc.y = clamp(ev.y, 380, VH - 60);
        disc.floor = disc.y + 16;
        trail.push({ x: ev.x, y: ev.y, t: clock });
        while (trail.length > 12) trail.shift();
        rig.lookAtVirtual(disc.x, disc.y);
        return true;
      }
      if ((ev.type === 'up' || ev.type === 'cancel') && disc.held) { release(); return true; }
      return true;
    }
    /* IN THE AIR, ANYWHERE IS THE TAP. A timing game must not also be a game of
       hitting a small target: the whole screen is the button. */
    if (phase === 'fly' && ev.type === 'down') { tapped(); return true; }
    return true;
  }

  /* ================================================================== */
  /*  GEOMETRY                                                          */
  /* ================================================================== */
  function panelTop() { return U.panelY - U.panelH / 2 + (1 - sp.panel.x) * 26; }
  function enterBox() {
    const w = U.enter.w, h = U.enter.h;
    return { x: (VW - w) / 2, y: panelTop() + U.panelH - h - U.enter.inset, w, h };
  }
  function inRect(r, x, y) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

  /* ================================================================== */
  /*  DRAW                                                              */
  /* ================================================================== */
  /** the field wash, behind him */
  /**
   * NOTHING, NOW — AND THAT IS THE POINT.
   *
   * This used to dim the living room, which was the whole of the disc "field":
   * the room with the lights down. `scenes/outdoors.js` draws a park and
   * `scenes/room.js` crossfades it in behind him on this layer's own `weight`,
   * so there is a place to play in and nothing to dim. Kept as a no-op rather
   * than deleted because the room calls it in the draw order where a disc
   * layer's background belongs, and that call site is worth keeping if the park
   * ever wants something in front of the grass and behind the dog.
   */
  function drawBack() { /* the park is the background now — see scenes/outdoors.js */ }

  /** the disc, and everything over him */
  function drawOver(g) {
    const w = clamp(sp.field.x, 0, 1);
    if (w < 0.004) return;
    const c = g.ctx;

    /* ---- THE DISC, WHEREVER IT IS ---------------------------------------
       In the air, on the grass, or in his mouth. The mouth case is placed from
       the POSE rather than from a stored position, so it rides his landing squash
       and his walk back to the middle instead of floating where the catch
       happened — the same anchor `walk.js` hangs a carried find from
       (`walk.home.carryAt`), and for the same reason it is BELOW the muzzle: at
       the muzzle it sits over his open mouth and reads as chewing. */
    if (beat === 'play' && !disc.gone) {
      if (disc.mouth) {
        const M = D.leap.mouthAt || [1, 22];
        const Ps = rig.pose;
        disc.x = rig.x + (Ps.muzX + M[0]) * rig.s;
        disc.y = rig.y + (Ps.muzY + M[1]) * rig.s * (rig.sy || 1);
        disc.floor = disc.y;                 // no cast shadow on the ground
        disc.scale = (+D.leap.mouthScale || 0.82);
      }
      drawDisc(c, w, disc.mouth);
    }

    /* one pip per throw, filled as they are taken */
    if (beat === 'play') {
      const n = round.throwsWanted;
      const total = (n - 1) * U.pipGap;
      for (let i = 0; i < n; i++) {
        const x = VW / 2 - total / 2 + i * U.pipGap;
        const taken = i < round.scores.length;
        c.save();
        c.globalAlpha = w * (taken ? 0.95 : 0.42);
        c.fillStyle = taken ? SURF.chipWarm : SURF.border(0.6);
        c.beginPath(); c.arc(x, U.pipY, U.pipR, 0, TAU); c.fill();
        c.restore();
      }
    }

    if (beat === 'entry') drawPanel(g, c, w);
    if (beat === 'card') drawResult(g, c, w);

    /* the way out, drawn where every other way out is drawn */
    if (beat !== 'card') {
      c.save();
      c.globalAlpha = w * 0.62;
      c.fillStyle = SURF.chrome;
      c.beginPath(); c.arc(RING.back.x, RING.back.y, RING.back.r, 0, TAU); c.fill();
      c.globalAlpha = w * 0.85;
      c.strokeStyle = INK.glyph; c.lineWidth = 2.0; c.lineCap = 'round';
      const d2 = RING.back.r * 0.34;
      c.beginPath();
      c.moveTo(RING.back.x + d2 * 0.5, RING.back.y - d2);
      c.lineTo(RING.back.x - d2 * 0.5, RING.back.y);
      c.lineTo(RING.back.x + d2 * 0.5, RING.back.y + d2);
      c.stroke();
      c.restore();
    }

    if (hint && beat === 'play') {
      drawText(g, hint, {
        ...type('labelMd', { weight: 700 }),
        anchor: 'top', y: U.hintY, ink: INK.onDark, fade: w,
        maxWidth: VW - 120,
      });
    }
  }

  /**
   * THE DISC. Drawn in code like everything else, and drawn as an ELLIPSE THAT
   * FLATTENS with height: a disc seen from below is a circle and a disc at eye
   * level is a line, so squashing it as it rises is what says "this is going
   * away from you" on a rig that has no perspective camera.
   */
  function drawDisc(c, a, inMouth) {
    /* BIGGER THAN A BALL, AND LESS SQUASHED THAN IT WAS. At the ball's 16-unit
       radius and a 0.34 minimum flatten, the disc at the far end of its flight
       was an eight-pixel red line that read as an object on the window sill
       rather than as a disc in the air. A disc is a wider object than a ball to
       begin with, and the squash has to stop while it is still a disc. */
    const r = TOY.r * disc.scale * (+D.fly.drawR || 1.5);
    const flat = clamp(0.34 + 0.66 * (1 - disc.scale), 0, 1) * (+D.fly.flatten || 0.55);
    c.save();
    c.globalAlpha = a;
    /* the receding shadow, which is the other half of the depth trick. Not while
       it is in his mouth: a disc he is holding casts its shadow on him, not on
       the grass 200 units below. */
    if (!inMouth) {
      /* smaller and fainter the higher it is, which is what a shadow does and
         what makes it readable as height rather than as a second disc */
      const up = clamp((disc.floor - disc.y) / 520, 0, 1);
      const near = 1 - up * 0.62;
      c.fillStyle = `rgba(74,96,58,${(0.30 * near).toFixed(3)})`;
      ell(c, disc.x + 3, disc.floor, r * 1.25 * near, r * 0.40 * near); c.fill();
    }
    c.translate(disc.x, disc.y);
    c.rotate(Math.sin(disc.spin * 0.5) * 0.18);
    c.scale(1, lerp(1, 0.34, flat));
    /* the body: a warm coral disc with a lighter well, so it reads at 8 units */
    c.fillStyle = '#e07a5f';
    ell(c, 0, 0, r, r); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.30)';
    ell(c, 0, 0, r * 0.62, r * 0.62); c.fill();
    c.fillStyle = '#c8613f';
    ell(c, 0, 0, r * 0.40, r * 0.40); c.fill();
    c.strokeStyle = 'rgba(120,50,30,0.45)'; c.lineWidth = Math.max(1, r * 0.08);
    ell(c, 0, 0, r, r); c.stroke();
    c.restore();
  }

  /** the entry panel: what it is, what it pays, and one button */
  function drawPanel(g, c, a) {
    const top = panelTop();
    const x = (VW - U.panelW) / 2;
    drawCard(c, x, top, U.panelW, U.panelH, { r: U.panelR, fill: SURF.card, fade: a });
    const r = discState(game.state);
    drawText(g, COPY.title(), {
      ...type('titleMd', { weight: 800 }),
      x: VW / 2, y: top + 34, anchor: 'free', align: 'center',
      ink: INK.heading, over: SURF.card, fade: a, maxWidth: U.panelW - 40,
    });
    drawText(g, COPY.entryLine(P()), {
      ...type('labelMd', { weight: 500 }),
      x: VW / 2, y: top + 66, anchor: 'free', align: 'center',
      ink: INK.soft(0.85), over: SURF.card, fade: a, maxWidth: U.panelW - 40,
    });
    if (r.best > 0) {
      drawText(g, COPY.best(r.best), {
        ...type('labelSm', { weight: 800 }),
        x: VW / 2, y: top + 96, anchor: 'free', align: 'center',
        ink: INK.body, over: SURF.card, fade: a, maxWidth: U.panelW - 40,
      });
    }
    /* the gate, said as him needing something */
    const line = gate && !gate.ok
      ? (gate.reason === 'hunger' ? COPY.gateHunger(P()) : COPY.gateThirst(P()))
      : (gate && gate.practice ? COPY.practiceNote(P()) : '');
    if (line) {
      drawText(g, line, {
        ...type('labelSm', { weight: 500, track: 0 }),
        x: VW / 2, y: top + 128, anchor: 'free', align: 'center',
        ink: INK.faint(0.8), over: SURF.card, fade: a, maxWidth: U.panelW - 44,
      });
    }
    const box = enterBox();
    tactile(c, { x: box.x, y: box.y, w: box.w, h: box.h, r: U.enter.r, p: 0,
      face: SURF.chipStrong, fade: a });
    drawText(g, gate && !gate.ok ? COPY.gateGo(P(), gate.reason)
      : (gate && gate.practice ? COPY.practice() : COPY.enter()), {
      ...type('labelMd', { weight: 800 }),
      x: box.x + box.w / 2, y: box.y + box.h / 2, anchor: 'free', align: 'center',
      ink: INK.onStrong, over: SURF.chipStrong, fade: a, maxWidth: box.w - 16,
    });
  }

  /** the card: the number, the word, and what it paid */
  function drawResult(g, c, a) {
    const w = clamp(sp.card.x, 0, 1) * a;
    if (w < 0.01 || !round || !round.result) return;
    const top = U.cardY - U.cardH / 2;
    const x = (VW - U.cardW) / 2;
    drawCard(c, x, top, U.cardW, U.cardH, { r: U.cardR, fill: SURF.card, fade: w });
    const res = round.result;
    drawText(g, res.score.toFixed(2), {
      ...type('displayLg', { weight: 800 }),
      x: VW / 2, y: top + 66, anchor: 'free', align: 'center',
      ink: INK.heading, over: SURF.card, fade: w, maxWidth: U.cardW - 40,
    });
    drawText(g, res.word, {
      ...type('titleMd', { weight: 700 }),
      x: VW / 2, y: top + 116, anchor: 'free', align: 'center',
      ink: INK.body, over: SURF.card, fade: w, maxWidth: U.cardW - 40,
    });
    drawText(g, `${res.caught} of ${res.thrown} caught`, {
      ...type('labelSm', { weight: 600, track: 0 }),
      x: VW / 2, y: top + 146, anchor: 'free', align: 'center',
      ink: INK.soft(0.85), over: SURF.card, fade: w, maxWidth: U.cardW - 40,
    });
    drawText(g, res.prize > 0 ? COPY.paid(res.prize) : COPY.none(), {
      ...type('labelMd', { weight: 800 }),
      x: VW / 2, y: top + 178, anchor: 'free', align: 'center',
      ink: res.prize > 0 ? INK.heading : INK.faint(0.8), over: SURF.card, fade: w,
      maxWidth: U.cardW - 40,
    });
  }

  /* ================================================================== */
  /*  API                                                               */
  /* ================================================================== */
  const api = {
    COPY,
    get active() { return !!beat || sp.field.x > 0.01; },
    get modal() { return !!beat; },
    /** the room skips `toy.apply` while this is true, or the toy fights the leap */
    get busy() { return !!beat; },
    get owns() { return !!beat; },
    /** the crossfade weight, which is what the room dissolves the park in on */
    get weight() { return sp.field.x; },
    /** the one-line description, for the More sheet's row. Said once, here. */
    entryNote() { return COPY.entryLine(P()); },
    get beat() { return beat; },
    get phase() { return phase; },
    get hint() { return hint; },
    start, stop, update, apply, pointer, drawBack, drawOver,

    /* ---- harness drivers: deterministic, never sleep-and-hope ---- */
    /** enter the round without hunting for the button */
    enterRound() { if (beat === 'entry') { begin(); return true; } return false; },
    /** throw at a known power, so a gate can aim */
    /**
     * A FLICK, AIMED. `side` is -1..1 across the lateral clamp, and it exists
     * because the run cannot be tested without it: a dead-straight flick lands
     * where he already is, and the whole question is whether he goes to a disc
     * that does not come to him. Same code path as a thumb — a trail, then
     * `release()`.
     */
    throwAt(power = 0.7, side = 0) {
      if (beat !== 'play' || phase !== 'ready') return false;
      const up = TOY.flick.minUp + (TOY.flick.maxUp - TOY.flick.minUp) * clamp(power, 0, 1);
      /* `side` is a SHARE OF THE DRIFT, not an angle: 1 means "as far to the
         right as a flick can send it". Expressed through the same `vx * 0.05`
         `release()` reads, so the harness aims by the number the product uses
         rather than by a hand-tuned wrist angle — at 0.42 of `up` it could only
         ever produce a third of the band, and the run under test looked like a
         shuffle when the code was right. */
      const across = clamp(side, -1, 1) * (+D.fly.drift || 46) * 20;
      trail.length = 0;
      trail.push({ x: disc.x - across * 0.1, y: disc.y + up * 0.1, t: clock - 0.1 });
      trail.push({ x: disc.x, y: disc.y, t: clock });
      disc.held = true;
      release();
      return phase === 'fly';
    },
    /** how long until the disc is catchable, in seconds (negative = missed it) */
    get untilCatch() { return beat === 'play' && round && round.fly ? idealAt() - flightT() : NaN; },
    /** tap now */
    tap() { return tapped(); },
    get result() { return round && round.result ? { ...round.result } : null; },

    get debug() {
      const r = discState(game.state);
      return {
        beat, phase, t: +t.toFixed(3),
        field: +sp.field.x.toFixed(3),
        disc: { x: Math.round(disc.x), y: Math.round(disc.y), s: +disc.scale.toFixed(3),
          gone: disc.gone, mouth: disc.mouth, down: disc.down },
        /* WHERE HE IS, because "he goes to it" is the whole change and it is not
           observable from the disc. `off` is how far from home he has run; the
           catch line is what the flight is aimed at. */
        him: {
          x: Math.round(rig.x), off: Math.round(rig.x - rig.home.x),
          hop: +s.hop.x.toFixed(2), sy: +(rig.sy || 1).toFixed(3),
          catchY: Math.round(catchLine()), apexIn: +apexDelay().toFixed(3),
        },
        /* THE THROW ITSELF, so the lateral clamp can be asserted where it is
           applied rather than inferred from the disc's position over time. */
        fly: round && round.fly ? {
          fromX: Math.round(round.fly.from.x), toX: Math.round(round.fly.to.x),
          dur: +round.fly.dur.toFixed(3), power: +round.fly.power.toFixed(3),
        } : null,
        round: round ? {
          i: round.i, wanted: round.throwsWanted, scores: round.scores.map((v) => +v.toFixed(3)),
          caught: round.caught, practice: round.practice, done: round.done,
        } : null,
        leap: leap ? { t: +leap.t.toFixed(3), caught: leap.caught, err: +leap.err.toFixed(3) } : null,
        untilCatch: +(api.untilCatch || 0).toFixed(3),
        gate, hint,
        saved: { best: r.best, plays: r.plays, entriesToday: r.entriesToday,
          catches: r.catches, thrown: r.thrown },
      };
    },
  };

  return api;
}

export default createDisc;
