/* ==========================================================================
   dog/reunion.js — the greeting on return.

   "The greeting-on-return is the emotional payoff of the entire real-time
   system and it is one animation. Build it early, tune it obsessively, and
   scale its intensity by time-away x affection. This is the highest
   return-on-effort asset in the whole project."   — research §1.7

   FIVE BEATS, and the order matters more than any single one of them:

     1 NOTICE   her head snaps round and then EVERYTHING STOPS. A held beat of
                stillness. This is recognition, and it is the beat most people
                leave out — without it the run reads as a loop starting, not as
                her realising it's you.
     2 COMMIT   the whole body gathers: crouch, scrabbling paws, tail already
                going flat out, a bark. She decides.
     3 BOLT     she comes AT THE CAMERA. The rig's own scale grows and `rig.sy`
                oscillates per stride: no side rig, no gait cycle, and it still
                reads as a dog running at you, because the thing the eye
                actually tracks is the scale change.
     4 BOOP     a scale overshoot with her nose at the lens, a screen shake and
                a soft contact bloom. iOS has no haptics (PLATFORM-RISKS), so
                weight has to be sold with scale and light.
     5 SETTLE   and then it takes her a MOMENT. Two decaying bounces, a wiggle,
                panting, hearts, the tail refusing to stop. Snapping straight
                back to idle would throw away everything the run earned.

   Intensity k = time_away x affection (state/time.js reunionIntensity). At
   k=0 it is a pleased trot toward the camera; at k=1 it is a torpedo.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { makeSprings, approach } from '../engine/spring.js';
import { TAU, clamp, lerp, smooth, hump, easeOut3 } from '../engine/draw.js';
import { rng as sharedRng } from '../engine/rng.js';

const RU = BALANCE.reunion;

export function createReunion(rig, opts = {}) {
  const game = opts.game;
  const idle = opts.idle;
  const rng = opts.rng || sharedRng;
  const reduced = !!opts.reduced;
  const spawn = opts.spawn || (() => {});
  const sound = opts.sound || (() => {});
  const s = rig.springs;
  const sp = makeSprings(['camScale', 'camY', 'bolt'], reduced);

  let on = false;
  let t = 0;
  let k = 0;                 // intensity 0..1
  let phase = '';
  let stride = 0;
  let shakeAmp = 0;
  let bloom = 0;
  let barked = 0;
  let booped = 0;
  let heartsLeft = 0;
  let heartIn = 0;
  const shake = { x: 0, y: 0 };
  const B = RU.beats;

  /* reduced motion keeps the whole beat structure — it is the choreography
     that carries the emotion — and only takes the violence out of it */
  const RM = BALANCE.reducedMotion;
  const motion = reduced ? 0.45 : 1;
  const partScale = reduced ? RM.particleScale : 1;

  function start(intensity, hours) {
    on = true;
    t = 0;
    k = clamp(intensity === undefined ? 0.5 : intensity, 0, 1);
    phase = 'notice';
    stride = 0;
    shakeAmp = 0;
    bloom = 0;
    barked = 0;
    booped = 0;
    rig._reunionLaunched = 0;
    heartsLeft = Math.round(lerp(RU.hearts[0], RU.hearts[1], k) * partScale);
    heartIn = B.bolt;
    sp.camScale.set(rig.home.s);
    sp.camY.set(rig.home.y);
    sp.bolt.set(0);
    /* she was doing something; she is not any more */
    if (idle) idle.cancel(8);
    /* MOOD, not the bond: she is over the moon right now. The bond gets its
       own, much smaller, once-a-day reward from the room. */
    game.addMood(BALANCE.mood.gain.reunion * (0.55 + k * 0.45));
    return true;
  }

  function stop() {
    on = false;
    phase = '';
    shake.x = 0; shake.y = 0;
    rig.x = rig.home.x;
    rig.y = rig.home.y;
    rig.s = rig.home.s;
    rig.sy = 1;
    rig.drive.pant = 0;
  }

  /* ================================================================== */
  function update(dt) {
    if (!on) { for (const q in sp) sp[q].step(dt); return; }
    t += dt;

    /* --- phase machine --- */
    if (t < B.notice) phase = 'notice';
    else if (t < B.commit) phase = 'commit';
    else if (t < B.boop) phase = 'bolt';
    else if (t < B.boop + 0.22) phase = 'boop';
    else if (t < B.settle) phase = 'settle';
    else { stop(); return; }

    /* --- the bolt: the target the scale spring is chasing --- */
    if (phase === 'notice') {
      sp.camScale.to(rig.home.s);
      sp.camY.to(rig.home.y);
      sp.bolt.to(0);
    } else if (phase === 'commit') {
      /* a tiny gather AWAY from the camera before she launches — the
         anticipation that makes the bolt land */
      const u = smooth((t - B.notice) / (B.commit - B.notice));
      sp.camScale.to(rig.home.s * (1 - 0.045 * u * motion));
      sp.camY.to(rig.home.y - 5 * u * motion);
      sp.bolt.to(0);
      stride += dt * RU.strideRate * 0.4;
    } else if (phase === 'bolt') {
      const u = clamp((t - B.commit) / (B.boop - B.commit), 0, 1);
      const peakS = lerp(rig.home.s, lerp(RU.scale[0], RU.scale[1], k), motion);
      const peakY = rig.home.y + lerp(RU.dropY[0], RU.dropY[1], k) * motion;
      sp.camScale.to(lerp(rig.home.s, peakS, easeOut3(u)));
      sp.camY.to(lerp(rig.home.y, peakY, easeOut3(u)));
      sp.bolt.to(u);
      stride += dt * RU.strideRate;
      if (!barked && u > 0.10) { barked = 1; sound('bark'); }
      if (barked === 1 && u > 0.62) { barked = 2; sound('bark'); }
    } else if (phase === 'boop') {
      /* the overshoot: nose at the lens */
      const u = clamp((t - B.boop) / 0.22, 0, 1);
      const peakS = lerp(rig.home.s, lerp(RU.scale[0], RU.scale[1], k), motion);
      sp.camScale.to(peakS * (1 + 0.085 * hump(u) * motion));
      sp.bolt.to(1);
      stride += dt * RU.strideRate * 0.6;
      if (!booped) {
        /* fire exactly once, on whichever frame first lands in the beat — a
           `u < 0.08` window can be stepped straight over at 60fps */
        booped = 1;
        shakeAmp = lerp(RU.boopShake[0], RU.boopShake[1], k) * rig.mo.shake;
        bloom = 1;
        sound('boop');
        /* a burst right at the lens */
        const n = Math.round(4 * partScale);
        for (let i = 0; i < n; i++) {
          spawn('spark', rig.x + rng.range(-40, 40), rig.y - 200 * (rig.s / rig.home.s) + rng.range(-40, 30));
        }
      }
    } else if (phase === 'settle') {
      /* Two decaying bounces on the way back, then rest. The spring is
         underdamped, so asking for home and nudging it twice is enough. */
      const u = clamp((t - (B.boop + 0.22)) / (B.settle - B.boop - 0.22), 0, 1);
      sp.camScale.to(rig.home.s);
      sp.camY.to(rig.home.y);
      sp.bolt.to(clamp(1 - u * 1.6, 0, 1));
      stride += dt * RU.strideRate * (1 - u) * 0.7;
      const bounceAt = [0.10, 0.34];
      for (let i = 0; i < RU.settleBounces && i < bounceAt.length; i++) {
        const a = bounceAt[i];
        if (u >= a && u < a + 0.02) {
          sp.camScale.kick(1.5 * (1 - i * 0.45) * k * motion);
          s.lift.kick(16 * (1 - i * 0.4) * (0.5 + k));
        }
      }
    }

    /* hearts stream out through the bolt and the settle */
    if (heartsLeft > 0 && t > B.commit) {
      heartIn -= dt;
      if (heartIn <= 0) {
        heartIn = rng.range(0.10, 0.26);
        heartsLeft--;
        const hs = rig.s / rig.home.s;
        spawn('heart', rig.x + rng.range(-46, 46) * hs, rig.y - 190 * hs + rng.range(-40, 30));
      }
    }

    /* screen shake decays fast — a thump, never a wobble */
    shakeAmp = approach(shakeAmp, 0, RU.shakeDecay, dt);
    if (shakeAmp > 0.02) {
      shake.x = rng.range(-1, 1) * shakeAmp;
      shake.y = rng.range(-1, 1) * shakeAmp * 0.7;
    } else { shake.x = 0; shake.y = 0; shakeAmp = 0; }
    bloom = approach(bloom, 0, 4.2, dt);

    for (const q in sp) sp[q].step(dt);
  }

  /* ================================================================== */
  /*  apply — runs LAST in the pipeline, so it owns the body outright    */
  /* ================================================================== */
  function apply(dt, mood) {
    if (!on) return;
    const bolt = sp.bolt.x;

    /* placement: the scale IS the camera here */
    rig.s = sp.camScale.x;
    rig.y = sp.camY.x;
    const hs = rig.s / rig.home.s;

    if (phase === 'notice') {
      const u = clamp(t / B.notice, 0, 1);
      /* THE SNAP. Not a target — an impulse, so it is moving in frame one. */
      if (t < dt * 1.5) {
        rig.lookAtVirtual(195, 1000);
        s.earL.kick(9.5); s.earR.kick(-9.0);
        s.perk.kick(4.6);
        s.eyeOpen.kick(3.4);
        s.pupilX.kick(28); s.pupilY.kick(-22);
        rig.blinkNow(1);
        sound('perk');
      }
      rig.lookAtVirtual(195, 1000);
      /* ...AND THEN NOTHING MOVES. Everything is held still while it lands. */
      s.perk.to(0.72);
      s.eyeOpen.to(1.20);
      s.brow.to(0.9);
      s.earBack.to(-0.42);
      s.sway.to(0);
      s.roll.to(0);
      s.squash.to(0);
      s.sit.to(0);
      s.melt.to(0);
      s.mouth.to(0.05);
      s.eyeSmile.to(0.10);
      s.smile.to(0.45);
      /* except the tail, which gives her away before the rest of her moves */
      s.tailUp.to(0.30 + u * 0.45);
      s.wagAmp.to(0.10 + smooth(clamp((u - 0.45) / 0.55, 0, 1)) * 0.55);
      s.wagSpd.to(1.6 + smooth(clamp((u - 0.45) / 0.55, 0, 1)) * 11);
      rig.pawLift[0].to(0); rig.pawLift[1].to(0);
      rig.drive.pant = 0;
      return;
    }

    if (phase === 'commit') {
      const u = smooth((t - B.notice) / (B.commit - B.notice));
      rig.lookAtVirtual(195, 1005);
      /* gathers: crouches down over the front end, paws scrabbling */
      s.squash.to(0.09 * u);
      s.headLift.to(-6 * u);
      s.pitch.to(clamp(-0.10 - 0.22 * u, -1, 1));
      s.earBack.to(-0.30 + 0.55 * u);
      s.eyeOpen.to(1.16 - 0.10 * u);
      s.eyeSmile.to(0.25 * u);
      s.smile.to(0.6 + 0.3 * u);
      s.mouth.to(0.18 + 0.30 * u);
      s.tongue.to(0.5 * u);
      s.perk.to(0.72 - 0.2 * u);
      s.tailUp.to(0.75 + 0.22 * u);
      s.wagAmp.to(lerp(RU.wag.amp[0], RU.wag.amp[1], k) * (0.7 + 0.3 * u));
      s.wagSpd.to(lerp(RU.wag.spd[0], RU.wag.spd[1], k) * (0.7 + 0.3 * u));
      /* the scrabble */
      const sc = Math.sin(stride * 3.1);
      rig.pawLift[0].to(Math.max(0, sc) * 0.75 * u);
      rig.pawLift[1].to(Math.max(0, -sc) * 0.75 * u);
      s.hindKick.to(0.6 * u);
      s.sway.to(Math.sin(stride * 2.2) * 2.2 * u * rig.mo.shake);
      rig.sy = 1 - 0.03 * u;
      /* the launch */
      if (u > 0.86 && !rig._reunionLaunched) {
        rig._reunionLaunched = 1;
        s.lift.kick(26 * (0.6 + k * 0.6));
        s.squash.kick(-1.6);
        sound('launch');
      }
      rig.drive.pant = 0.35 * u;
      return;
    }

    if (phase === 'bolt' || phase === 'boop') {
      const u = phase === 'boop' ? 1 : clamp((t - B.commit) / (B.boop - B.commit), 0, 1);
      rig.lookAtVirtual(195, 1010);
      /* PER-STRIDE VERTICAL SQUASH is the whole foreshortening trick */
      const bob = Math.sin(stride);
      const amp = lerp(RU.strideAmp[0], RU.strideAmp[1], k) * motion;
      rig.sy = 1 + bob * 0.055 * bolt * motion;
      rig.x = rig.home.x + Math.sin(stride * 0.5) * amp * 0.5 * rig.mo.shake;
      rig.y = sp.camY.x - Math.abs(bob) * amp * bolt;

      s.squash.to(0.05 + Math.abs(bob) * 0.06 * bolt);
      /* Keep the head DOWN on the shoulders. Lifting it even a few rig units
         opens a visible gap between head and body once the scale is at 2.3x —
         the frontal rig has no drawn neck, so any daylight there reads as the
         head having come off. `drive.neck` below bridges whatever is left. */
      s.headLift.to(-1 + bob * 2.2 * bolt);
      rig.drive.neck = Math.max(rig.drive.neck || 0, bolt * 0.85);
      s.pitch.to(clamp(0.10 + 0.18 * bolt, -1, 1));
      /* airplane ears: back and flat, the way a dog runs at you */
      s.earBack.to(0.30 + 0.55 * bolt);
      s.eyeOpen.to(1.02 - 0.22 * bolt);
      s.eyeSmile.to(0.55 + 0.25 * bolt);
      s.smile.to(0.95);
      s.mouth.to(0.44 + Math.abs(bob) * 0.16);
      s.tongue.to(1.15);
      s.brow.to(0.5);
      s.perk.to(0.35);
      s.tailUp.to(0.98);
      s.wagAmp.to(lerp(RU.wag.amp[0], RU.wag.amp[1], k));
      s.wagSpd.to(lerp(RU.wag.spd[0], RU.wag.spd[1], k));
      /* the legs, alternating hard */
      rig.pawLift[0].to(Math.max(0, bob) * 1.25 * bolt);
      rig.pawLift[1].to(Math.max(0, -bob) * 1.25 * bolt);
      s.hindKick.to(0.85 * bolt);
      s.tilt.to(Math.sin(stride * 0.5 + 0.7) * 0.07 * bolt * rig.mo.shake);
      rig.drive.wiggle = Math.max(rig.drive.wiggle, bolt * 0.35);
      rig.drive.pant = 0.9 * bolt;

      if (phase === 'boop') {
        /* nose right on the glass: stretch up, eyes half shut, huge grin */
        const bu = clamp((t - B.boop) / 0.22, 0, 1);
        const env = hump(bu);
        rig.sy = 1 + env * 0.10 * motion;
        s.pitch.to(clamp(0.34 + env * 0.30, -1, 1));
        s.headLift.to(-2 + env * 3);
        s.eyeOpen.to(0.42 - env * 0.20);
        s.eyeSmile.to(0.95);
        s.mouth.to(0.62);
        s.earBack.to(0.9);
        s.noseTw.to(Math.sin(t * 40) * 0.5);
      }
      return;
    }

    /* ---- SETTLE: and it takes her a moment ---- */
    const u = clamp((t - (B.boop + 0.22)) / (B.settle - B.boop - 0.22), 0, 1);
    const calm = smooth(u);
    rig.sy = 1 + Math.sin(stride) * 0.03 * (1 - calm) * motion;
    rig.x = rig.home.x + Math.sin(stride * 0.7) * 2.6 * (1 - calm) * rig.mo.shake;
    rig.lookAtVirtual(195, 995 - calm * 60);

    /* the wiggle: she cannot keep still, and it fades rather than stops */
    rig.drive.wiggle = Math.max(rig.drive.wiggle, (1 - calm) * 0.85);
    s.sway.to(Math.sin(stride * 1.6) * 3.4 * (1 - calm) * rig.mo.shake);
    s.roll.to(Math.sin(stride * 1.1) * 0.05 * (1 - calm) * rig.mo.shake);
    s.squash.to(0.05 * (1 - calm));
    s.headLift.to(0);
    rig.drive.neck = Math.max(rig.drive.neck || 0, (1 - calm) * 0.5);
    s.pitch.to(clamp(0.24 - calm * 0.14, -1, 1));
    s.earBack.to(lerp(0.72, 0.05, calm));
    s.eyeOpen.to(lerp(0.80, 1.0, calm));
    s.eyeSmile.to(lerp(0.90, 0.42, calm));
    s.smile.to(lerp(0.95, 0.70, calm));
    s.brow.to(lerp(0.55, 0.30, calm));
    s.perk.to(lerp(0.30, 0.42, calm));
    s.tailUp.to(lerp(0.92, 0.55, calm));
    s.wagAmp.to(lerp(lerp(RU.wag.amp[0], RU.wag.amp[1], k), 0.34, calm));
    s.wagSpd.to(lerp(lerp(RU.wag.spd[0], RU.wag.spd[1], k), 5.5, calm));
    /* OUT OF BREATH. The panting is what makes the run read as effort. */
    const pantFor = lerp(RU.pantDur[0], RU.pantDur[1], k);
    const pant = clamp(1 - (t - (B.boop + 0.22)) / pantFor, 0, 1);
    rig.drive.pant = pant;
    s.mouth.to(lerp(0.16, 0.40, pant) + 0.14 * pant * Math.sin(t * (13 + k * 5)));
    s.tongue.to(lerp(0.30, 1.05, pant));
    rig.pawLift[0].to(Math.max(0, Math.sin(stride)) * 0.35 * (1 - calm));
    rig.pawLift[1].to(Math.max(0, -Math.sin(stride)) * 0.35 * (1 - calm));
    s.hindKick.to(0.3 * (1 - calm));
    s.sit.to(0);
  }

  /**
   * The contact bloom at the boop. iOS gives us no haptics, so the thump has
   * to be sold with light and scale (PLATFORM-RISKS: "compensate with audio and
   * with visual weight — camera shake, brief scale overshoot").
   */
  function drawOver(g) {
    if (bloom < 0.02) return;
    const c = g.ctx;
    const P = rig.pose;
    const mx = rig.x + P.muzX * rig.s;
    const my = rig.y + P.muzY * rig.s * (rig.sy || 1);
    const r = 168 * (0.6 + (1 - bloom) * 0.9);
    c.save();
    c.globalAlpha = bloom * 0.52;
    const gr = c.createRadialGradient(mx, my, 2, mx, my, r);
    gr.addColorStop(0, 'rgba(255,250,226,0.95)');
    gr.addColorStop(0.42, 'rgba(255,242,206,0.28)');
    gr.addColorStop(1, 'rgba(255,242,206,0)');
    c.fillStyle = gr;
    c.beginPath(); c.arc(mx, my, r, 0, TAU); c.fill();
    c.restore();
  }

  return {
    get active() { return on; },
    get phase() { return phase; },
    get intensity() { return k; },
    get progress() { return on ? clamp(t / RU.beats.settle, 0, 1) : 0; },
    get shake() { return shake; },
    start, stop, update, apply, drawOver,
    get debug() {
      return {
        on, phase, k, t: +t.toFixed(2),
        scale: +rig.s.toFixed(3), sy: +(rig.sy || 1).toFixed(3), y: Math.round(rig.y),
        bolt: +sp.bolt.x.toFixed(3), shake: +shake.x.toFixed(2), bloom: +bloom.toFixed(2),
        wag: +s.wagAmp.x.toFixed(2), pant: +rig.drive.pant.toFixed(2),
      };
    },
  };
}

export default createReunion;
