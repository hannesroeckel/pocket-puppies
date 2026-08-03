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
  'sit', 'down', 'hop', 'lift', 'sway', 'roll', 'squash', 'melt', 'perk',
  'pupilX', 'pupilY',
  'yaw', 'pitch', 'tilt', 'headLift', 'headPush',
  'earL', 'earR', 'earBack',
  'eyeOpen', 'eyeSmile', 'brow', 'mouth', 'smile', 'tongue', 'noseTw',
  'wagAmp', 'wagSpd', 'tailUp',
  'pawLiftL', 'pawLiftR', 'pawOut', 'hindKick',
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
    /* TAIL CARRIAGE, declarative. `tailCarry` shifts the base angle: negative
       carries the tail higher. `tailPlume` scales the soft floof at the tip,
       which is what turns a whip tail into a spaniel's plume. Both default to
       the Shiba's behaviour when a breed omits them. */
    tailCarry: P.tailCarry || 0,
    tailPlume: P.tailPlume === undefined ? 1 : P.tailPlume,
    /* oversized paws are a real breed tell on the doodle crosses */
    pawScale: P.pawScale === undefined ? 1 : P.pawScale,
  };
}

/* ==========================================================================
   STANCE — where a posture PUTS things, for a rig that does not exist yet.

   `rig.update()` resolves the live pose from springs. This resolves the same
   quantities from plain numbers, so a caller can ask "if he sat down this far
   and dropped his head that far, where would his muzzle be?" WITHOUT running
   a frame, and — the point — without knowing anything about the breed.

   THIS IS WHAT MAKES THE EATING POSE BREED-INDEPENDENT. Stage 6's first pass
   put the bowl at y=726 and the head drop at 52 rig units, both measured by
   looking at the Shiba. Three breeds are landing that differ in muzzle
   length, ear type and body mass, and every one of those numbers would have
   been wrong for two of them: a longer muzzle reaches further, a deeper chest
   moves the belly line the head must stay clear of, and shorter legs move the
   floor. So `dog/care.js` asks this instead of being told.

   Only the LOAD-BEARING terms are here. Breathing, the fbm weight shift, the
   shiver and the ear kicks are deliberately absent: they are small, they are
   noise by design, and a preview that included them would not be a preview.
   `C:\tmp\pp8\bowl2.py` asserts per frame that what this predicts matches
   what rig.update actually produced, so the two cannot drift apart quietly.

   All values are RIG-LOCAL, y down, 0 at the floor line.
   ========================================================================== */
/** the `sit` channel's body drop, shared with rig.update below */
const SIT_DROP = 17;
const SIT_HEAD = 2;

/* ==========================================================================
   THE DRAWN PAW, AND THE FLOOR — ONE EXPRESSION EACH.

   `dog/draw.js`'s drawLeg sizes the paw ellipse as

       pr = legW * 1.06 * (1 + lift*0.06 + down*0.10) * dims.pawScale

   and strokes its outline at `ell(px, py - 1.2, pr + 1.8, pr*0.80 + 1.8)`, so
   the LOWEST DRAWN PIXEL of a planted paw is `py + 0.6 + pr*0.80`.

   That expression used to exist in three places, and one of them — the
   published `pose.pawSole`, the number everything outside the renderer treats
   as "where the floor is" — omitted `dims.pawScale`. The two doodle crosses
   have deliberately oversized paws (cockapoo 1.16, schnoodle 1.12), so on the
   two breeds that ship alongside the Shiba the rig published a floor 2.0 and
   2.7 virtual units ABOVE the paw a player can see. Measured, both breeds, on
   the eating frame: `C:\tmp\pp8\floor1.py`. Now there is one copy of it and
   `stance()`, `rig.update()` and the bowl solve all read it.
   ========================================================================== */
/** the radius drawLeg will actually use for this paw */
export function pawRadius(dims, down = 0, lift = 0) {
  const ps = dims.pawScale === undefined ? 1 : dims.pawScale;
  return dims.legW * 1.06 * (1 + lift * 0.06 + down * 0.10) * ps;
}
/** the bottom edge of that paw — the contact point — from its anchor */
export function soleFor(pawY, pawR) { return pawY + 0.6 + pawR * 0.80; }
/**
 * WHERE HIS PAWS HAVE TO BE, in rig-local units, for a dog whose rig sits at
 * (`y`, `s`) in a room whose floor line is `floorV`.
 *
 * This is the ONE definition of "his paws are on the floor". `rig.update()`
 * resolves the live pose through it and `dog/care.js` predicts the eating pose
 * through it, so a prop placed on the floor and the paws standing on that same
 * floor cannot be answering to two different numbers — which is exactly the
 * defect this replaces (ARCHITECTURE §18.2).
 */
export function plantedSoleLocal(floorV, y, s) {
  const d = s || 1;
  return (floorV - y) / d;
}

export function stance(dims, ch = {}) {
  const R2 = BALANCE.rig;
  const TR = R2.trick;
  const LG = R2.leg;
  const sit = +ch.sit || 0;
  const dn = +ch.down || 0;
  const sq = +ch.squash || 0;
  const headLift = +ch.headLift || 0;      // NEGATIVE drops the head, as in the springs
  const pitch = +ch.pitch || 0;

  const bodyHH = dims.bodyHH * (1 - sq * 0.55) * (1 + sit * 0.03) * (1 - dn * TR.downSquash);
  const grew = dims.bodyHH - bodyHH;
  const bodyY = dims.bodyY + sit * SIT_DROP + dn * TR.downDrop + grew;
  const neckY = bodyY + dims.neckDY - grew * 0.55;
  const headY = neckY - dims.headOffset - headLift + sit * SIT_HEAD - pitch * 3;
  const muzY = headY + dims.muzY - pitch * R2.parallax.vMuz;
  const pawY = -1 + sit * LG.sitLift + dn * LG.downPawY;
  const pawR = pawRadius(dims, dn, 0);
  return {
    bodyY, bodyHH,
    bodyTop: bodyY - bodyHH,
    bodyBottom: bodyY + bodyHH,
    neckY, headY,
    headTop: headY - dims.headHH,
    headBottom: headY + dims.headHH,
    muzY,
    pawY,
    pawSole: soleFor(pawY, pawR),
  };
}

/**
 * How far the head's bottom edge may travel before it reaches the belly, on
 * THIS dog, standing. The whole floating-bowl defect is one number against
 * this one: stage 7 spent 99 virtual units of a 100-unit budget and then put
 * the bowl wherever the muzzle had ended up.
 */
export function headRoom(dims) {
  const st = stance(dims, {});
  return st.bodyBottom - st.headBottom;
}

export function createRig(opts = {}) {
  const breed = typeof opts.breed === 'string' ? getBreed(opts.breed) : (opts.breed || getBreed('shiba'));
  const reduced = !!opts.reduced;
  const rng = opts.rng || sharedRng;
  const noise = createNoise(rng.fork(11));
  const RM = BALANCE.reducedMotion;

  const dims = resolveDims(breed);
  const pal = derivePalette(breed.palette);

  /* ==================================================================
     THE ROOM'S FLOOR LINE, in virtual units.

     A FLOOR IS A PROPERTY OF THE ROOM, NOT OF THE DOG'S TRANSFORM. This is
     the line a planted paw rests on and the line a bowl standing on the floor
     rests on, and there is exactly one of it. It is DERIVED — from where the
     room stands this dog (`rig.place`) and from his own standing paw, so it
     moves with legs and paw size and cannot be typed wrong — but once derived
     it is a room constant that no pose may move.

     Writable, because a scene that carries the dog somewhere else in the room
     (walk.js's departure, toy.js's fetch, reunion.js's charge) is moving him
     to a different floor and owns saying so. Nothing does yet; they all switch
     planting off instead, which is the honest thing for a dog in mid-air.
     ================================================================== */
  const FLOOR_V = R.place.y + stance(dims, {}).pawSole * R.place.scale;

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
    base: T.base + dims.tailCarry, curl: T.curl * (dims.tailCurl / 0.72),
  };
  for (let i = 0; i < T.n; i++) {
    tail.rel[i] = i === 0 ? tail.base : tail.curl;
    tail.vel[i] = 0; tail.dev[i] = 0;
  }

  /* ==================================================================
     HANGING-EAR SPRING CHAINS (declarative: BALANCE.rig.earChain[breed.ear])

     A prick ear is a rigid triangle: `earChain` is null and every line below
     is skipped, so a prick-eared breed behaves EXACTLY as it did before.

     A hanging ear is the best secondary-motion opportunity on the animal, so
     it gets the tail's treatment: a chain where each joint inherits the
     previous joint's deviation, driven by the SAME `earL`/`earR`/`earBack`
     springs that every clip, every petting response and the reunion already
     kick. Nothing else in the codebase had to change to make ears flop.

     Angles live in a canonical per-ear frame: +x is OUTWARD from the head,
     +y is DOWN. dog/draw.js mirrors x for the left ear.
     ================================================================== */
  const EC = R.earChain ? R.earChain[breed.ear] : null;
  const earChain = EC ? [0, 1].map(() => ({
    rel: EC.hang.slice(), vel: new Array(EC.n).fill(0), dev: new Array(EC.n).fill(0),
  })) : null;
  /* segment lengths sum to the breed's authored ear height */
  const earSeg = EC ? (() => {
    const w = [];
    let tot = 0;
    for (let i = 0; i < EC.n; i++) { const v = 1 - i * 0.06; w.push(v); tot += v; }
    return w.map((v) => v / tot * P.earH);
  })() : null;

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
    tailNodes: [], eyeOpenEff: 1, sit: 0, down: 0, hop: 0, breathe: 0,
    /* per-ear chain node positions in the canonical (outward, down) ear frame.
       Empty for a prick-eared breed — dog/draw.js then uses the rigid path. */
    earNodes: earChain ? [[], []] : null,
    pupilX: 0, pupilY: 0,
    neckX: 0, neckY: 0,
    /* WHERE THE FLOOR IS, in rig-local units, for a planted front paw:
         pawY    the paw's own anchor
         pawSole the bottom edge of the drawn paw — the contact point
       dog/draw.js used to derive both privately, which meant nothing outside
       the renderer could say where the floor was. That is why stage 7 could
       not tell how far its bowl was floating and settled for "about 40"
       (ARCHITECTURE §16.9): the reference it compared against was the paw's
       ANCHOR, which is most of a paw above the rug. Anything placing a prop
       on the floor, and anything verifying one, reads these. */
    pawY: -1, pawSole: -1,
    lastHX: undefined, lastHY: undefined, lastHR: undefined,
  };

  const gaze = { yaw: 0, pitch: 0, t: 0 };

  const rig = {
    breed, dims, pal, sil, springs: s, pawLift, tail, fur, pose, gaze, reduced,
    /** this dog's head-to-belly budget, standing. See `headRoom` above. */
    get headRoom() { return headRoom(dims); },
    /** where a posture would put things on THIS dog, without running a frame */
    stance(ch) { return stance(dims, ch); },
    /* null for prick ears; a spring chain per ear otherwise */
    earChain, earSeg, earSpec: EC,
    /* placement in virtual space */
    x: R.place.x, y: R.place.y, s: R.place.scale,
    /* Non-uniform vertical scale, default 1. This is how the frontal rig fakes
       FORESHORTENING: running "into" the screen is `s` shrinking while `sy`
       squashes, and the reunion's nose-at-the-lens is `s` overshooting while
       `sy` stretches. dog/draw.js applies it. Never used by stage 1. */
    sy: 1,
    /* Horizontal companion to `sy`, default 1 (stage 3). A frontal rig cannot
       show its own back, so a ROLL OVER is sold by narrowing the silhouette as
       she goes over rather than by rotating a drawing of her front. Same rule
       as §12.6: on this rig, depth is scale. */
    sx: 1,
    /* the resting placement, so a sequence can always spring back to it */
    home: { x: R.place.x, y: R.place.y, s: R.place.scale },
    /** the room's floor line — see FLOOR_V above. One number, read by all. */
    floorV: FLOOR_V,
    /* HOW MUCH HIS PLANTED PAWS ARE HELD ON THAT FLOOR, 0..1, written per
       frame by whoever owns the pose — a drive, exactly like `drive.neck` and
       `wear`: the rig is told, it does not go and ask. 0 is the pose's own
       authored paw offsets, which is how every scene except the two bowl
       actions still behaves, byte for byte. */
    plantShare: 0,
    t: 0,
    /* Per-frame drive written by pet.js / care.js before update().
         mood       the FAST channel — what visibly drives her body
         affection  the SLOW bond, kept for anything that wants the long game
       Stage 1 only had `affection` and used it for both. */
    drive: { petLevel: 0, mood: 0, affection: 0, wiggle: 0, pant: 0 },
    /* WHAT HE IS WEARING, written per frame by scenes/room.js from
       `game.worn`. A drive, like `drive.neck`: the renderer is told, it does
       not go and ask, so dog/draw.js still imports nothing above itself. */
    wear: '',
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
      /* a raised paw's lateral bias is a per-action choice, so it resets like
         the lift it scales with */
      s.pawOut.to(0);
      /* AIRBORNE ALWAYS RETURNS TO THE GROUND. `sit` and `down` deliberately
         persist (a posture is a state she stays in until something changes it),
         but a jump is an event, so it is reset here like `lift` and `squash`. */
      s.hop.to(0);
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

      /* --- posture invariant: you cannot be LYING DOWN and not SITTING.
             Both channels persist by design, so without this the idle
             director's `standUp` (which only knows about `sit`) would leave her
             half-risen out of a lie-down. Enforced on the TARGETS, so the
             springs still resolve it smoothly. --- */
      if (s.sit.t < 0.5 && s.down.t > 0) s.down.to(0);

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
      /* stage 3 posture channels: lying down and airborne */
      const TR = R.trick;
      const dn = s.down.x, hp = s.hop.x;
      pose.sit = sit; pose.down = dn; pose.hop = hp;
      pose.bodyHH = dims.bodyHH * (1 - sq * 0.55) * (1 + sit * 0.03) * (1 - dn * TR.downSquash);
      pose.bodyHW = dims.bodyHW * (1 + sq * 0.34) * (1 + sit * 0.06) * (1 + dn * TR.downWiden);
      pose.bodyY = dims.bodyY + sit * SIT_DROP + melt * 7 - s.lift.x - s.perk.x * 3
        + dn * TR.downDrop - hp * TR.hopHeight
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

      /* --- the floor line (see the note on pose.pawY) ---
             The planted front paw, i.e. with no paw lift: a lifted paw is not
             touching anything, so it is not where the floor is. `sitLift` and
             `downPawY` both push the paw NEARER the camera and therefore lower
             (§12.6), which is real floor travel and not a paw sinking. The
             sole offset mirrors dog/draw.js's paw ellipse exactly. */
      const LGf = R.leg;
      pose.pawY = -1 + sit * LGf.sitLift + dn * LGf.downPawY - hp * TR.hopHeight * LGf.hopPawShare;
      const pawR = pawRadius(dims, dn, 0);
      pose.pawSole = soleFor(pose.pawY, pawR);

      /* --- PLANTED PAWS ------------------------------------------------
         A DOG FOLDING DOWN OVER A BOWL DOES NOT SINK THROUGH THE FLOOR. The
         authored offsets above (`sitLift`, `downPawY`, and the forward lean
         care.js writes into rig.y/rig.s) between them carried the drawn sole
         23-26 virtual units BELOW `floorV` in the eating pose on all three
         breeds — measured, not argued. The bowl was standing on `floorV`, so
         the bowl read as held up to his face (ARCHITECTURE §18.2).

         So when the layer that owns the pose says his paws are planted, they
         resolve against the ROOM's floor and the legs take up the difference.
         Contact is the invariant; the paw offset is what gives.

         `hop` overrides it to zero: a paw that has left the ground is not
         planted, and this must never pin an airborne dog's feet to the floor.
         NaN-hardened both ways — a bad `floorV` leaves the authored pose
         untouched rather than teleporting the legs. */
      const plantOn = LGf.plantOnFloor === undefined ? true : !!LGf.plantOnFloor;
      const share = +rig.plantShare;
      const plant = plantOn && Number.isFinite(share)
        ? clamp(share, 0, 1) * clamp(1 - hp, 0, 1) : 0;
      if (plant > 0.0001 && Number.isFinite(rig.floorV)) {
        const syNow = rig.sy === undefined ? 1 : rig.sy;
        const want = plantedSoleLocal(rig.floorV, rig.y, rig.s * syNow);
        if (Number.isFinite(want)) {
          pose.pawSole = lerp(pose.pawSole, want, plant);
          pose.pawY = pose.pawSole - 0.6 - pawR * 0.80;
        }
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
      pose.headY = neckY - dims.headOffset - s.headLift.x + sit * SIT_HEAD + melt * 5
        - pose.pitch * 3 + breathe * 0.8 - s.perk.x * 4;
      pose.headRot = s.tilt.x + pose.bodyRot * 0.55 + pose.yaw * 0.05;

      /* --- SECONDARY MOTION: ears kicked by the head's REAL measured
             per-frame rotation and translation (not by its targets) --- */
      const hvx = pose.headX - (pose.lastHX === undefined ? pose.headX : pose.lastHX);
      const hvy = pose.headY - (pose.lastHY === undefined ? pose.headY : pose.lastHY);
      const hvr = pose.headRot - (pose.lastHR === undefined ? pose.headRot : pose.lastHR);
      pose.lastHX = pose.headX; pose.lastHY = pose.headY; pose.lastHR = pose.headRot;
      /* published so hanging furniture (a beard, a moustache, a topknot) can
         TRAIL the head. Painted-on furniture is the tell that a face is a
         decal; a beard that swings a frame behind the jaw is not. */
      pose.headVX = hvx; pose.headVY = hvy; pose.headVR = hvr;
      const inv = dt > 0.0001 ? 1 / dt : 0;
      const K = R.earKick;
      const swingL = clamp(-hvx * inv * K.lateral - hvr * inv * K.rotation + hvy * inv * K.vertical, -K.clamp, K.clamp);
      const swingR = clamp(hvx * inv * K.lateral + hvr * inv * K.rotation + hvy * inv * K.vertical, -K.clamp, K.clamp);
      s.earL.kick(swingL * dt * K.gain);
      s.earR.kick(swingR * dt * K.gain);

      /* --- hanging ears: resolve the chains -------------------------------
         The root joint is driven by the ear spring everything else already
         kicks, so this inherits every existing ear impulse in the game. The
         driving swing decays down the chain while each joint ALSO inherits
         its parent's deviation — which is what makes the tip overshoot,
         lag and settle last instead of the whole ear rotating as one board. */
      if (earChain) {
        const back = s.earBack.x;
        /* a big head shake (measured, not scripted) adds real flop */
        const flop = clamp(Math.abs(hvr * inv) * 0.06 + Math.abs(hvx * inv) * 0.0016,
          0, 1.6) * EC.flop;
        for (let e = 0; e < 2; e++) {
          const ch = earChain[e];
          const sd = e === 0 ? -1 : 1;
          /* the ear's own spring: left ear reads earL, right reads earR. They
             have different stiffness by construction, so the pair can never
             move in lockstep. */
          const drive = (e === 0 ? s.earL.x : s.earR.x) * EC.swing;
          const nodes = pose.earNodes[e];
          nodes.length = 0;
          let ang = 0, x = 0, y = 0;
          nodes.push(pt(0, 0));
          for (let i = 0; i < EC.n; i++) {
            const wave = drive * Math.exp(-i * EC.waveLag);
            let tgt = EC.hang[i] + wave;
            /* earBack sweeps the whole ear up and back off the cheek */
            if (i === 0) tgt -= back * EC.backSweep;
            /* the tip carries the flop, the root barely notices it */
            if (i > 0) tgt += ch.dev[i - 1] * EC.inherit + flop * (i / EC.n) * sd * 0.5;
            const k = i === 0 ? EC.k[0] : EC.k[1];
            const d = i === 0 ? EC.d[0] : EC.d[1];
            const h1 = Math.min(dt, T.subDt);
            ch.vel[i] += ((tgt - ch.rel[i]) * k - ch.vel[i] * d) * h1;
            if (dt > T.subDt) {
              const rest = dt - T.subDt;
              ch.vel[i] += ((tgt - ch.rel[i] - ch.vel[i] * rest) * k - ch.vel[i] * d) * rest;
            }
            ch.rel[i] += ch.vel[i] * dt;
            ch.dev[i] = ch.rel[i] - EC.hang[i];
            ang += ch.rel[i];
            /* earBack also shortens the visible ear (it swings behind the head) */
            const seg = earSeg[i] * (1 - back * 0.16);
            x += Math.cos(ang) * seg;
            y += Math.sin(ang) * seg;
            nodes.push(pt(x, y));
          }
        }
      }

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
