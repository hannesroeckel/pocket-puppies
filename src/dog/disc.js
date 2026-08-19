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
  ready: (P) => `Flick the disc up — never sideways`,
  tapNow: (P) => `Tap to make ${P.them} jump`,
  caught: (P) => `${P.they === 'they' ? 'Caught' : 'Caught'} it!`,
  missed: (P) => `${P.they === 'they' ? 'They' : (P.they === 'he' ? 'He' : 'She')} just missed it`,
  tooSoon: (P) => `A little early`,
  tooLate: (P) => `A little late`,
  gateHunger: (P) => `${P.they === 'he' ? 'He is' : (P.they === 'she' ? 'She is' : 'They are')} too hungry to be leaping about`,
  gateThirst: (P) => `${P.they === 'he' ? 'He needs' : (P.they === 'she' ? 'She needs' : 'They need')} a drink first`,
  best: (n) => `Best: ${n.toFixed(2)}`,
  paid: (n) => `+${n} coins`,
  none: () => 'Just for fun',
  done: () => 'Done',
  leave: () => 'Leave',
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
  let t = 0;                  // seconds in the current phase
  let gate = null;
  let round = null;
  let hint = '';

  /* ---- the disc ---------------------------------------------------- */
  const disc = { x: 0, y: 0, scale: 1, spin: 0, held: false, floor: 0, gone: false };
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
    beat = '';
    phase = '';
    round = null;
    leap = null;
    disc.held = false;
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
    leap = null;
    disc.gone = false;
    disc.held = false;
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
    /* NEVER LATERAL. The same ±46 clamp the toy uses, for the same reason. */
    const lateral = clamp(v.vx * 0.05, -46, 46);
    const fly = {
      from: { x: disc.x, y: disc.y },
      to: { x: clamp(disc.x + lateral, 54, 336), y: lerp(disc.y - 120, D.fly.vanishY, smooth(power)) },
      dur: lerp(D.fly.dur[0], D.fly.dur[1], power),
      power,
    };
    round.fly = fly;
    phase = 'fly';
    t = 0;
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
  function flightAt(u) {
    const f = round.fly;
    const hangHalf = clamp(+D.fly.hang || 0.34, 0, 0.9) / 2;
    const mid = clamp(+D.fly.hangAt || 0.42, 0.15, 0.8);
    let rise;
    if (u < mid - hangHalf) {
      rise = smooth(u / Math.max(0.001, mid - hangHalf));          // going up
    } else if (u < mid + hangHalf) {
      rise = 1;                                                     // hanging
    } else {
      /* the fall is quicker than the rise (`** 1.5`), so the disc spends its
         last stretch low — in the band a leap can actually meet it — rather
         than gliding down through the whole second half of the flight */
      const f2 = (u - (mid + hangHalf)) / Math.max(0.001, 1 - mid - hangHalf);
      rise = 1 - smooth(clamp(f2, 0, 1)) ** 0.72;
    }
    /* it comes back down to HEAD HEIGHT, not to the floor: that is the height a
       dog meets a disc at, and it is what the leap is aimed through */
    const headY = rig.y + (rig.pose.headY - rig.dims.headHH * 1.2) * rig.s * (rig.sy || 1);
    const restY = Math.min(f.from.y, headY);
    const y = lerp(restY, f.to.y, rise) - hump(rise) * D.fly.arc * (0.4 + f.power);
    /* ---- AND IT COMES DOWN TO HIM ---------------------------------------
       The x used to run from her hand to the throw's target and stay there, so
       the disc hung and fell 135 units to the right of his head and he caught it
       without moving. He is the one catching it: as the disc falls, its x
       converges on his head. Which is also why the lateral clamp on the throw
       matters and not more — the drift decides where it goes UP, and he is where
       it comes DOWN. */
    const headX = rig.x + rig.pose.headX * rig.s;
    const outX = lerp(f.from.x, f.to.x, smooth(Math.min(1, u * 1.35)));
    const fall = clamp((u - (mid + hangHalf)) / Math.max(0.001, 1 - mid - hangHalf), 0, 1);
    const x = lerp(outX, headX, smooth(fall));
    /* ---- DEPTH IS NOT HEIGHT, AND THIS IS THE DIFFERENCE ----------------
       Scale was driven straight off `rise`, so as the disc came back down to
       his head it grew back to full size — i.e. it flew away from the camera
       and then returned TO the camera, which is not where he is standing. He
       is across the room. So depth rises with the throw and only eases part of
       the way back (`depthKeep`): the disc stays far, and lands at his head
       still small. Caught by a gate assertion that the disc is drawn smaller at
       the catch than it was in her hand, which it was not. */
    const keep = clamp(+D.fly.depthKeep || 0.8, 0, 1);
    const depth = Math.max(rise, keep * (u < mid ? rise : 1));
    return { x, y, rise, depth };
  }

  /* ================================================================== */
  /*  THE TAP, AND THE LEAP                                             */
  /* ================================================================== */
  /** when in the flight the disc is catchable, in seconds from the throw */
  function idealAt() { return round.fly.dur * clamp(+D.window.at || 0.62, 0, 1); }

  function tapped() {
    if (phase !== 'fly' || leap) return false;
    const err = t - idealAt();
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
      if (phase === 'fly' || phase === 'leap') {
        const u = clamp(t / round.fly.dur, 0, 1);
        const at = flightAt(u);
        disc.x = at.x;
        disc.y = at.y;
        disc.scale = lerp(1, D.fly.minScale, smooth(at.depth) * (0.5 + round.fly.power * 0.5));
        disc.spin += dt * D.fly.spin * (0.4 + round.fly.power);
        disc.floor = Math.min(VH - 40, at.y + 200 * (1 - at.rise) + 24);
        rig.lookAtVirtual(disc.x, disc.y);
        /* he takes it out of the air: once caught, the disc goes with him */
        if (leap && leap.caught && leap.t > (+D.leap.dur || 0.95) * 0.42) disc.gone = true;
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
      if (phase === 'settle' && t > 0.85) {
        round.i++;
        nextThrow();
      }
    }
  }

  /**
   * THE LEAP, WRITTEN AS TARGETS. `TRICK_POSE.jump` is the pose stage 3 tuned,
   * driven here on this layer's own clock — with the airborne middle stretched
   * by `leap.hold` so a catch reads as a catch and not as a bounce.
   */
  function apply(dt) {
    if (!beat || !leap) return;
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
  function drawBack(g) {
    const w = clamp(sp.field.x, 0, 1);
    if (w < 0.004) return;
    const c = g.ctx;
    c.save();
    c.globalAlpha = w * U.dim;
    c.fillStyle = SURF.scrim(1);
    c.fillRect(0, 0, VW, VH);
    c.restore();
  }

  /** the disc, and everything over him */
  function drawOver(g) {
    const w = clamp(sp.field.x, 0, 1);
    if (w < 0.004) return;
    const c = g.ctx;

    if (beat === 'play' && !disc.gone) drawDisc(c, w);

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
  function drawDisc(c, a) {
    /* BIGGER THAN A BALL, AND LESS SQUASHED THAN IT WAS. At the ball's 16-unit
       radius and a 0.34 minimum flatten, the disc at the far end of its flight
       was an eight-pixel red line that read as an object on the window sill
       rather than as a disc in the air. A disc is a wider object than a ball to
       begin with, and the squash has to stop while it is still a disc. */
    const r = TOY.r * disc.scale * (+D.fly.drawR || 1.5);
    const flat = clamp(0.34 + 0.66 * (1 - disc.scale), 0, 1) * (+D.fly.flatten || 0.55);
    c.save();
    c.globalAlpha = a;
    /* the receding shadow, which is the other half of the depth trick */
    c.fillStyle = `rgba(104,58,32,${(0.20 * disc.scale).toFixed(3)})`;
    ell(c, disc.x + 2, disc.floor, r * 1.1, r * 0.34); c.fill();
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
    drawText(g, gate && !gate.ok ? COPY.leave() : (gate && gate.practice ? COPY.practice() : COPY.enter()), {
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
    get beat() { return beat; },
    get phase() { return phase; },
    get hint() { return hint; },
    start, stop, update, apply, pointer, drawBack, drawOver,

    /* ---- harness drivers: deterministic, never sleep-and-hope ---- */
    /** enter the round without hunting for the button */
    enterRound() { if (beat === 'entry') { begin(); return true; } return false; },
    /** throw at a known power, so a gate can aim */
    throwAt(power = 0.7) {
      if (beat !== 'play' || phase !== 'ready') return false;
      const up = TOY.flick.minUp + (TOY.flick.maxUp - TOY.flick.minUp) * clamp(power, 0, 1);
      trail.length = 0;
      trail.push({ x: disc.x, y: disc.y + up * 0.1, t: clock - 0.1 });
      trail.push({ x: disc.x, y: disc.y, t: clock });
      disc.held = true;
      release();
      return phase === 'fly';
    },
    /** how long until the disc is catchable, in seconds (negative = missed it) */
    get untilCatch() { return beat === 'play' && round && round.fly ? idealAt() - t : NaN; },
    /** tap now */
    tap() { return tapped(); },
    get result() { return round && round.result ? { ...round.result } : null; },

    get debug() {
      const r = discState(game.state);
      return {
        beat, phase, t: +t.toFixed(3),
        field: +sp.field.x.toFixed(3),
        disc: { x: Math.round(disc.x), y: Math.round(disc.y), s: +disc.scale.toFixed(3), gone: disc.gone },
        /* THE THROW ITSELF, so the "never lateral" rule can be asserted where it
           is applied rather than inferred from the disc's position over time —
           which cannot be done cleanly, because the disc legitimately converges
           on his head as it falls. */
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
