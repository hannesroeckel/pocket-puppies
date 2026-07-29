/* ==========================================================================
   dog/rig.js — part hierarchy + spring set. POSES ARE SET VIA TARGETS ONLY.

   The pose pipeline (architecture §6) is:
       base mood  ->  idle director  ->  action clip  ->  petting overlay
   Every one of those layers writes `spring.to(...)` and nothing else. Only
   `rig.update()` resolves springs into final values. That is why nothing in
   this dog ever pops.

   Properties that must survive any refactor (they are the "alive" feeling):
     - ear angular-velocity kicks derived from the head's ACTUAL measured
       per-frame rotation/translation, not from the pose targets
     - the tail as a spring chain where each joint inherits the previous
       joint's deviation
     - organic fbm weight-shift so the idle never reads as a loop
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { Spring, makeSprings, stepAll } from '../engine/spring.js';
import { createNoise, rng as sharedRng } from '../engine/rng.js';
import { clamp, lerp, smoother, hump, pt, derivePalette } from '../engine/draw.js';
import { getBreed } from './breeds.js';

const R = BALANCE.rig;

const SPRING_NAMES = [
  'sit', 'lift', 'sway', 'roll', 'squash', 'melt', 'perk',
  'pupilX', 'pupilY',
  'yaw', 'pitch', 'tilt', 'headLift', 'headPush',
  'earL', 'earR', 'earBack',
  'eyeOpen', 'eyeSmile', 'brow', 'mouth', 'smile', 'tongue', 'noseTw',
  'wagAmp', 'wagSpd', 'tailUp',
  'pawLiftL', 'pawLiftR', 'hindKick',
];

/** normalised outline -> rig-local points */
function toLocal(sil, w, h) {
  return sil.pts.map(([x, y]) => pt((x - sil.origin[0]) * w, (y - sil.origin[1]) * h));
}

/** Resolve every dimension the renderer needs from breed proportions. */
export function resolveDims(breed) {
  const P = breed.proportions, A = P.anchors;
  const bodyHW = P.bodyW / 2, bodyHH = P.bodyH / 2;
  const headHW = P.headW * P.headScale / 2, headHH = P.headH * P.headScale / 2;
  const bodyY = -(P.legLen + bodyHH);
  const neckDY = A.neckDY * bodyHH;         // negative: the neck leaves upward
  /* Head offset chosen so the head bottom sinks `neckOverlap` units BELOW the
     body top. Derivation, with headY measured down from the neck point:
       want   headY    = bodyY - bodyHH - headHH + overlap
       neckY            = bodyY + neckDY
       headOffset       = neckY - headY = neckDY + bodyHH + headHH - overlap
     Getting this sign wrong leaves the head floating above the shoulders. */
  const headOffset = neckDY + bodyHH + headHH - A.neckOverlap;
  const eyeW = headHW * 0.245 * P.eyeSize;
  return {
    bodyHW, bodyHH, bodyY, bodyW: P.bodyW, bodyH: P.bodyH,
    headHW, headHH, headOffset, neckDY,
    muzY: A.muzzleY * headHH,
    eyeX: P.eyeSpacing * headHW, eyeY: A.eyeY * headHH,
    eyeW, eyeH: eyeW * 1.13,
    browX: 0.50 * headHW, browY: A.browY * headHH,
    earX: A.earX * headHW, earY: A.earY * headHH,
    shoulderX: A.shoulderX * bodyHW, pawX: A.pawX * bodyHW,
    hipX: A.hipX * bodyHW, hindPawX: A.hindPawX * bodyHW,
    tailBase: [A.tailBase[0] * bodyHW, A.tailBase[1] * bodyHH],
    cheekY: A.cheekY * headHH,
    legLen: P.legLen, legW: P.legW,
    neckRuff: P.neckRuff, tailCurl: P.tailCurl, tailLen: P.tailLen,
  };
}

export function createRig(opts = {}) {
  const breed = typeof opts.breed === 'string' ? getBreed(opts.breed) : (opts.breed || getBreed('shiba'));
  const reduced = !!opts.reduced;
  const rng = opts.rng || sharedRng;
  const noise = createNoise(rng.fork(11));
  const RM = BALANCE.reducedMotion;

  const dims = resolveDims(breed);
  const pal = derivePalette(breed.palette);

  /* ---- silhouettes in rig-local units ------------------------------- */
  const F = breed.silhouette.front;
  const P = breed.proportions;
  const sil = {
    body: toLocal(F.body, P.bodyW, P.bodyH),
    bib: toLocal(F.bib, F.bib.box[0] * P.bodyW / F.body.box[0], F.bib.box[1] * P.bodyH / F.body.box[1]),
    head: toLocal(F.head, P.headW * P.headScale, P.headH * P.headScale),
    muzzle: toLocal(F.muzzle, P.muzzleW, P.muzzleH),
    ear: toLocal(F.ear, P.earW, P.earH),
    earInner: F.earInner ? toLocal(F.earInner, P.earW, P.earH) : null,
  };

  /* ---- springs ------------------------------------------------------ */
  const s = makeSprings(SPRING_NAMES, reduced);
  s.eyeOpen.set(1);
  s.wagAmp.set(0.16);
  s.wagSpd.set(2.0);
  const pawLift = [s.pawLiftL, s.pawLiftR];

  /* ---- tail spring chain (each joint inherits the previous deviation) */
  const T = R.tail;
  const tail = {
    rel: new Array(T.n), vel: new Array(T.n), dev: new Array(T.n),
    base: T.base, curl: T.curl * (dims.tailCurl / 0.72),
  };
  for (let i = 0; i < T.n; i++) {
    tail.rel[i] = i === 0 ? tail.base : tail.curl;
    tail.vel[i] = 0; tail.dev[i] = 0;
  }

  /* ---- fur clump slots (persistent springs; positions resolved live) - */
  const fur = { body: [], head: [] };
  for (const part of ['body', 'head']) {
    const spec = breed.fur.clump[part];
    if (!spec) continue;
    spec.at.forEach((t, i) => {
      fur[part].push({
        t,
        scale: spec.scale,
        curl: (i % 2 ? 1 : -1),
        sp: new Spring(0, BALANCE.springs.fur[0] * (reduced ? RM.stiffScale : 1),
          BALANCE.springs.fur[1] * (reduced ? RM.dampScale : 1)),
      });
    });
  }

  /* ---- pose cache (written every frame, read by dog/draw.js) --------- */
  const pose = {
    bodyX: 0, bodyY: dims.bodyY, bodyHW: dims.bodyHW, bodyHH: dims.bodyHH, bodyRot: 0,
    headX: 0, headY: dims.bodyY + dims.neckDY - dims.headOffset, headRot: 0,
    yaw: 0, pitch: 0,
    muzX: 0, muzY: 0,
    tailNodes: [], eyeOpenEff: 1, sit: 0, breathe: 0,
    pupilX: 0, pupilY: 0,
    neckX: 0, neckY: 0,
    lastHX: undefined, lastHY: undefined, lastHR: undefined,
  };

  const gaze = { yaw: 0, pitch: 0, t: 0 };

  const rig = {
    breed, dims, pal, sil, springs: s, pawLift, tail, fur, pose, gaze, reduced,
    /* placement in virtual space */
    x: R.place.x, y: R.place.y, s: R.place.scale,
    /* Non-uniform vertical scale, default 1. This is how the frontal rig fakes
       FORESHORTENING: running "into" the screen is `s` shrinking while `sy`
       squashes, and the reunion's nose-at-the-lens is `s` overshooting while
       `sy` stretches. dog/draw.js applies it. Never used by stage 1. */
    sy: 1,
    /* the resting placement, so a sequence can always spring back to it */
    home: { x: R.place.x, y: R.place.y, s: R.place.scale },
    t: 0,
    /* Per-frame drive written by pet.js / care.js before update().
         mood       the FAST channel — what visibly drives her body
         affection  the SLOW bond, kept for anything that wants the long game
       Stage 1 only had `affection` and used it for both. */
    drive: { petLevel: 0, mood: 0, affection: 0, wiggle: 0, pant: 0 },
    /* motion multipliers for prefers-reduced-motion */
    mo: {
      parallax: reduced ? RM.parallaxScale : 1,
      shake: reduced ? RM.shakeScale : 1,
      wobble: reduced ? RM.wobbleScale : 1,
    },
    /* scalars */
    blinkT: 0, blinkQ: 0, blinkDur: R.blinkDur, blink: 0,
    breath: 0, breathSpd: 1,
    wagPhase: 0, kickPhase: 0, wigglePhase: 0, shiverT: 0,

    /* ---- gaze ----------------------------------------------------- */
    headWorld() {
      return { x: rig.x + pose.headX * rig.s, y: rig.y + pose.headY * rig.s };
    },
    lookAtVirtual(vx, vy) {
      const h = rig.headWorld();
      const dx = (vx - h.x) / (148 * rig.s), dy = (vy - h.y) / (150 * rig.s);
      gaze.yaw = clamp(dx * 1.55, -1.25, 1.25);
      gaze.pitch = clamp(-dy * 1.15, -0.95, 1.0);
    },
    blinkNow(n) {
      if (rig.blinkT <= 0) { rig.blinkT = rig.blinkDur; rig.blinkQ = (n || 1) - 1; }
    },
    shiver() { if (rig.mo.shake > 0) rig.shiverT = R.shiverDur; },

    /* ==================================================================
       LAYER 1 — base mood pose. Neutral targets only.

       `m` IS THE FAST MOOD CHANNEL, NOT THE BOND. Everything visible here —
       tail amplitude and speed, ear height, eye openness, the mouth, the perk
       — reads off mood, which responds within seconds and decays toward a
       baseline that affection sets. Stage 1 drove this from `affection`
       directly, which is why the bond had to move fast to make the dog look
       alive, which is why the bond maxed out in one session.
       ================================================================== */
    base(mood, dt) {
      const m = clamp(mood.mood === undefined ? mood.affection : mood.mood, 0, 1);
      gaze.t += dt;
      const G = R.gazeDrift;
      /* micro-saccades + slow drift so the stare is never dead */
      const sy = noise.fbm(gaze.t * G.yawRate + 7) * G.yawAmp;
      const sp = noise.fbm(gaze.t * G.pitchRate + 19) * G.pitchAmp;
      const tYaw = clamp(gaze.yaw + sy, -1.3, 1.3);
      const tPitch = clamp(gaze.pitch + sp + 0.03, -1.0, 1.0);
      /* THE EYES LEAD THE HEAD: same target, but the pupil springs are ~3x
         faster, so the gaze always arrives first and the head catches up. */
      s.pupilX.to(clamp(tYaw, -1, 1));
      s.pupilY.to(clamp(-tPitch, -1, 1));
      s.yaw.to(tYaw);
      s.pitch.to(tPitch);
      s.tilt.to(noise.fbm(gaze.t * G.tiltRate + 3) * G.tiltAmp);
      /* independent per-ear drift so the pair never moves in lockstep */
      const E = R.earDrift;
      s.earL.to(noise.fbm(gaze.t * E.rate + 3.1) * E.amp);
      s.earR.to(noise.fbm(gaze.t * E.rate * 1.23 + E.phase) * E.amp);
      s.headLift.to(0);
      s.headPush.to(0);
      s.eyeOpen.to(1 + m * 0.05);
      s.eyeSmile.to(m * 0.20);
      s.brow.to(m * 0.22);
      s.smile.to(0.34 + m * 0.44);
      s.mouth.to(m > 0.55 ? 0.06 + 0.05 * Math.sin(rig.t * 6.2) : 0);
      s.tongue.to(0);
      s.noseTw.to(0);
      s.earBack.to(-m * 0.05);
      s.perk.to(m * 0.30);
      s.melt.to(0);
      s.squash.to(0);
      s.sway.to(0);
      s.roll.to(0);
      s.lift.to(0);
      s.tailUp.to(m * 0.20);
      s.wagAmp.to(0.09 + m * 0.20);
      s.wagSpd.to(1.5 + m * 3.4);
      s.hindKick.to(0);
      pawLift[0].to(0); pawLift[1].to(0);
    },

    /* ==================================================================
       Resolve: step every spring, then compute the pose cache.
       ================================================================== */
    update(dt) {
      rig.t += dt;

      /* --- breathing: asymmetric (quick in, slow out) --- */
      rig.breathSpd = lerp(R.breathSpdIdle, R.breathSpdPet,
        clamp(rig.drive.petLevel * 0.6 + rig.drive.mood * 0.35 + rig.drive.pant, 0, 1));
      rig.breath += dt * rig.breathSpd;
      const bp = rig.breath % 1;
      const breathe = bp < R.breathIn ? smoother(bp / R.breathIn) : 1 - smoother((bp - R.breathIn) / (1 - R.breathIn));
      pose.breathe = breathe;

      /* --- blink lane --- */
      if (rig.blinkT > 0) {
        rig.blinkT -= dt;
        rig.blink = hump(1 - clamp(rig.blinkT / rig.blinkDur, 0, 1));
        if (rig.blinkT <= 0 && rig.blinkQ > 0) { rig.blinkQ--; rig.blinkT = rig.blinkDur; }
      } else rig.blink = 0;

      /* --- springs --- */
      stepAll(s, dt);
      for (const part of ['body', 'head']) for (const f of fur[part]) f.sp.step(dt);

      /* --- organic weight shift (fbm, never a loop) --- */
      const W = R.wobble;
      const wob = noise.fbm(rig.t * W.rate1) * rig.mo.wobble;
      const wob2 = noise.fbm(rig.t * W.rate2 + 40) * rig.mo.wobble;

      /* --- body --- */
      const sit = s.sit.x, melt = s.melt.x;
      const sq = s.squash.x + melt * 0.16 + breathe * 0.020;
      pose.sit = sit;
      pose.bodyHH = dims.bodyHH * (1 - sq * 0.55) * (1 + sit * 0.03);
      pose.bodyHW = dims.bodyHW * (1 + sq * 0.34) * (1 + sit * 0.06);
      pose.bodyY = dims.bodyY + sit * 17 + melt * 7 - s.lift.x - s.perk.x * 3
        + (dims.bodyHH - pose.bodyHH) + wob * W.y;
      pose.bodyX = s.sway.x + wob2 * W.x;
      pose.bodyRot = s.roll.x + wob * W.rot;

      /* wiggle when the rump is being fussed */
      rig.wigglePhase += dt * lerp(R.wiggleRate[0], R.wiggleRate[1], rig.drive.wiggle);
      if (rig.drive.wiggle > 0.02) {
        pose.bodyX += Math.sin(rig.wigglePhase) * rig.drive.wiggle * R.wiggleAmp * rig.mo.shake;
      }

      /* happy shiver */
      if (rig.shiverT > 0) {
        rig.shiverT -= dt;
        const sv = clamp(rig.shiverT / R.shiverDur, 0, 1) * rig.mo.shake;
        pose.bodyX += Math.sin(rig.t * R.shiverRate[0]) * R.shiverAmp * sv;
        pose.bodyRot += Math.sin(rig.t * R.shiverRate[1]) * R.shiverRot * sv;
      }

      /* --- head placement (follows the body, with lag) --- */
      pose.yaw = clamp(s.yaw.x, -R.yawClamp, R.yawClamp);
      pose.pitch = clamp(s.pitch.x, -R.pitchClamp, R.pitchClamp);
      const neckX = pose.bodyX + Math.sin(pose.bodyRot) * (-dims.neckDY);
      const neckY = pose.bodyY + dims.neckDY * Math.cos(pose.bodyRot)
        - (dims.bodyHH - pose.bodyHH) * 0.55;
      /* published so dog/draw.js can bridge the shoulders to the head when a
         care action drives the head right down into a bowl (rig.drive.neck) */
      pose.neckX = neckX; pose.neckY = neckY;
      pose.headX = neckX + pose.yaw * 7 + s.headPush.x * 6;
      pose.headY = neckY - dims.headOffset - s.headLift.x + sit * 2 + melt * 5
        - pose.pitch * 3 + breathe * 0.8 - s.perk.x * 4;
      pose.headRot = s.tilt.x + pose.bodyRot * 0.55 + pose.yaw * 0.05;

      /* --- SECONDARY MOTION: ears kicked by the head's REAL measured
             per-frame rotation and translation (not by its targets) --- */
      const hvx = pose.headX - (pose.lastHX === undefined ? pose.headX : pose.lastHX);
      const hvy = pose.headY - (pose.lastHY === undefined ? pose.headY : pose.lastHY);
      const hvr = pose.headRot - (pose.lastHR === undefined ? pose.headRot : pose.lastHR);
      pose.lastHX = pose.headX; pose.lastHY = pose.headY; pose.lastHR = pose.headRot;
      const inv = dt > 0.0001 ? 1 / dt : 0;
      const K = R.earKick;
      const swingL = clamp(-hvx * inv * K.lateral - hvr * inv * K.rotation + hvy * inv * K.vertical, -K.clamp, K.clamp);
      const swingR = clamp(hvx * inv * K.lateral + hvr * inv * K.rotation + hvy * inv * K.vertical, -K.clamp, K.clamp);
      s.earL.kick(swingL * dt * K.gain);
      s.earR.kick(swingR * dt * K.gain);

      /* --- tail: spring chain + travelling wave + inherited deviation --- */
      rig.wagPhase += dt * s.wagSpd.x * Math.PI;
      const amp = s.wagAmp.x;
      for (let i = 0; i < T.n; i++) {
        const wave = Math.sin(rig.wagPhase - i * T.waveLag) * amp * (i === 0 ? 1.0 : T.waveTipShare);
        let tgt = (i === 0 ? tail.base - s.tailUp.x * 0.45 : tail.curl) + wave;
        if (i > 0) tgt += tail.dev[i - 1] * T.inherit;   /* <- the inheritance */
        const k = i === 0 ? T.k[0] : T.k[1];
        const d = i === 0 ? T.d[0] : T.d[1];
        const h1 = Math.min(dt, T.subDt);
        tail.vel[i] += ((tgt - tail.rel[i]) * k - tail.vel[i] * d) * h1;
        if (dt > T.subDt) {
          const rest = dt - T.subDt;
          tail.vel[i] += ((tgt - tail.rel[i] - tail.vel[i] * rest) * k - tail.vel[i] * d) * rest;
        }
        tail.rel[i] += tail.vel[i] * dt;
        tail.dev[i] = tail.rel[i] - (i === 0 ? tail.base : tail.curl);
      }
      /* node positions — base buried INSIDE the rump (art fix 2) */
      let tx = pose.bodyX + dims.tailBase[0] * (pose.bodyHW / dims.bodyHW);
      let ty = pose.bodyY + dims.tailBase[1] * (pose.bodyHH / dims.bodyHH);
      pose.tailNodes.length = 0;
      pose.tailNodes.push(pt(tx, ty));
      let ang = 0;
      for (let i = 0; i < T.n; i++) {
        ang += tail.rel[i];
        tx += Math.cos(ang) * T.len[i] * dims.tailLen;
        ty += Math.sin(ang) * T.len[i] * dims.tailLen;
        pose.tailNodes.push(pt(tx, ty));
      }

      /* --- eyes --- */
      pose.eyeOpenEff = clamp(clamp(s.eyeOpen.x, 0, 1.25) * (1 - rig.blink), 0, 1.25);
      /* gaze offset relative to where the head has actually got to: this is
         the visible "eyes led, head followed" lag. */
      pose.pupilX = clamp(s.pupilX.x - pose.yaw * 0.72, -1.1, 1.1);
      pose.pupilY = clamp(s.pupilY.x + pose.pitch * 0.62, -1.1, 1.1);

      /* --- muzzle world position (zone tests + particles) --- */
      const px = R.parallax;
      const mYaw = pose.yaw * rig.mo.parallax;
      pose.muzX = pose.headX + Math.cos(pose.headRot) * (mYaw * px.muzzle)
        - Math.sin(pose.headRot) * (dims.muzY - pose.pitch * px.vMuz);
      pose.muzY = pose.headY + Math.sin(pose.headRot) * (mYaw * px.muzzle)
        + Math.cos(pose.headRot) * (dims.muzY - pose.pitch * px.vMuz);

      rig.kickPhase += dt * R.kickRate;
    },
  };

  return rig;
}

export default createRig;
