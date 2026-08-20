/* ==========================================================================
   dog/side.js — THE DOG IN PROFILE, AND HIS GAIT.

   THE RULE THIS FILE EXISTS BY. `docs/SCOPE.md` has said since 2026-07-29:

     "no side-profile rig is being built. If any later stage finds itself
      wanting one, stop and raise it rather than quietly building one — it is
      the single largest art task in the project and it was deliberately
      avoided."

   It was raised, and the answer was yes:

     "Actually I do want a side and back profile of the dogs, we even had a
      image with chatgpt generated for this as a reference. these new views
      would make improve the game a lot"

   So this is that view, built against `docs/reference/side-run-cycle.png` — four
   frames of the cockapoo bounding to the left.

   WHAT THE REFERENCE DECIDED
   --------------------------
   1. IT IS A REDRAW, NOT A ROTATION. From the side one ear is a scalloped mass
      over the cheek and the other does not exist; the muzzle stops being a
      front-on shape with a nose blob and becomes the OUTLINE of the face. There
      is no rotation of the frontal parts that produces any of that, which is why
      `dog/draw.js` is untouched by this file and every one of its 358 breed
      checks and its bowl pixel baselines still stand.

   2. THE LEGS HAVE NO JOINTS. They are soft stubs with a paw at the end, and the
      gait is sold by WHERE they are and HOW LONG they read — not by bending a
      knee. That is the single biggest saving in here: no IK, no skeleton, no
      per-breed joint tuning.

   3. IT IS A LOOP, NOT A POSE. Four keys — extended, gathered, extended,
      compressed — so what this file wants is a phase, and the standing pose is
      the loop held still at its gathered key.

   WHAT IS SHARED WITH THE FRONTAL DOG, AND WHY
   -------------------------------------------
   Everything except the shape: `breed.palette` for colour, `breed.proportions`
   for how big the parts are, and `FUR_TYPE` (exported from dog/draw.js) for how
   deep the scallop is and how dense the curl. A profile dog with its own coat
   numbers would drift away from the frontal one breed by breed; sharing the
   numbers means the two views can only disagree about silhouette, which is the
   thing they are supposed to disagree about.

   He must read as the same dog seen from a different side. That is the whole
   test, and it is not one a gate can make — it is one to look at.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { TAU, clamp, lerp, smooth, hump, ell } from '../engine/draw.js';
import { FUR_TYPE } from './draw.js';

const S = BALANCE.side;

/* a stable hash, so every curl and every scallop is in the same place on every
   frame and on every launch — the room's own trick (`BALANCE.rng.roomSeed`) */
function hash(i, salt) {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * A SCALLOPED CLOSED SHAPE — the coat motif, in profile.
 *
 * The frontal rig builds this from a sampled outline with lobes pushed along the
 * normal (`buildFluff`/`fluffMass` in dog/draw.js). Here the shapes are simple
 * enough — a bean, a dome, a stub — to walk the ellipse directly and modulate
 * the radius, which is the same read at a twentieth of the code.
 *
 * `cycles` and `amp` come from the breed's own `tuft` block, so a wavy coat
 * scallops loosely and a curly one tightly, exactly as it does face-on.
 */
function furShape(c, cx, cy, rx, ry, o = {}) {
  const t = o.tuft || { cycles: 12, amp: 3.0, pow: 0.7 };
  const amp = (o.amp === undefined ? 1 : o.amp) * (t.amp || 3) * (o.scale || 1);
  const cycles = Math.max(3, Math.round((t.cycles || 12) * (o.cycleScale || 1)));
  const rot = o.rot || 0;
  const salt = o.salt || 0;
  const n = Math.max(24, cycles * 6);
  c.beginPath();
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const a = u * TAU;
    /* two frequencies, the second at a third of the amplitude: one wave alone
       reads as a gear, and the frontal coat has the same second octave */
    const w = Math.sin(a * cycles + salt) * 1 + Math.sin(a * cycles * 2.1 + salt * 1.7) * 0.34;
    const j = 1 + (hash(i, salt) - 0.5) * 0.18;
    const r = 1 + (w * j * amp) / Math.max(rx, ry);
    const px = Math.cos(a) * rx * r;
    const py = Math.sin(a) * ry * r;
    const x = cx + px * Math.cos(rot) - py * Math.sin(rot);
    const y = cy + px * Math.sin(rot) + py * Math.cos(rot);
    if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
  }
  c.closePath();
}

/** the interior curl: short wide faint C-arcs, the frontal coat's own recipe */
function curls(c, cx, cy, rx, ry, coatShade, fur, salt, dens) {
  const k = fur.curl;
  if (!k) return;
  const n = Math.round(clamp((rx * ry) / 260, 3, 26) * (dens === undefined ? 1 : dens));
  c.save();
  c.strokeStyle = coatShade;
  c.globalAlpha = k.alpha * 1.15;
  c.lineWidth = k.width;
  c.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const u = hash(i, salt) * TAU;
    const v = 0.28 + hash(i, salt + 9) * 0.58;
    const x = cx + Math.cos(u) * rx * v;
    const y = cy + Math.sin(u) * ry * v;
    const r = Math.min(rx, ry) * k.radius * 0.30;
    const a0 = hash(i, salt + 3) * TAU;
    c.beginPath();
    c.arc(x, y, r, a0, a0 + k.sweep * 0.55);
    c.stroke();
  }
  c.restore();
}

export function createSideDog(rig) {
  const breed = rig.breed;
  const P = breed.proportions;
  const C = breed.palette;
  const fur = FUR_TYPE[breed.fur.type] || FUR_TYPE.short;
  const tuft = fur.tuft || { cycles: 12, amp: 3, pow: 0.7 };

  /* ---- THE PROFILE'S OWN PROPORTIONS -------------------------------------
     Derived from the frontal numbers rather than typed in, so a breed that is
     wider face-on is longer in profile and nothing has two sources of truth.
     The multipliers are the whole art direction of this file, and they were set
     by rendering him next to `docs/reference/side-run-cycle.png` and moving them
     until he matched: a puppy in profile is LONGER than he is wide face-on, his
     chest is low and deep, and his head is huge. */
  const g = {
    bodyHW: P.bodyW * S.body.long,
    bodyHH: P.bodyH * S.body.deep,
    headHW: P.headW * P.headScale * S.head.w,
    headHH: P.headH * P.headScale * S.head.h,
    muzHW: P.muzzleW * S.muzzle.w,
    muzHH: P.muzzleH * S.muzzle.h,
    earHW: P.earW * S.ear.w,
    earHH: P.earH * S.ear.h,
    legLen: P.legLen * S.leg.len,
    legW: P.legW * S.leg.w,
  };

  /**
   * WHERE EVERY PART IS, for a gait phase.
   *
   * `face` is -1 for "nose to the left", which is how the reference is drawn;
   * everything below is computed in a right-facing space and mirrored by the
   * caller's transform, so there is one set of numbers rather than two.
   *
   * `run` is how much of the gait is applied, 0..1 — 0 is the standing pose, and
   * the standing pose is deliberately not authored separately. It is the loop
   * held at its gathered key, which is what keeps a dog who stops mid-stride
   * from snapping into a different animal.
   */
  function pose(phase, run) {
    const ph = phase % 1;
    const a = ph * TAU;
    const L = S.gait;
    /* THE BODY BOB. A bound lifts the whole dog once per cycle; the reference's
       four frames are two extended and two gathered, which is a bound rather
       than a trot. `hump` gives the single arch. */
    const lift = hump(ph) * L.bob * run;
    const stretch = Math.sin(a) * L.stretch * run;
    /* THE LEGS, AS PAIRS. A bound throws both fronts forward together and both
       hinds back, so the pairs are half a cycle apart and the near/far legs of
       a pair are a small lag apart — which is what stops it reading as two legs
       instead of four. */
    const leg = (base, off) => {
      const p = (ph + off) % 1;
      const sw = Math.sin(p * TAU);
      return {
        /* along the ground: forward on the swing, back on the drive */
        dx: sw * L.reach * run,
        /* off the ground: only ever up, and only on the forward half */
        dy: -Math.max(0, Math.sin(p * TAU)) * L.paw * run,
        /* the stub shortens as it swings under him, which is the only
           foreshortening a jointless leg gets */
        len: base * (1 - Math.abs(sw) * L.foreshorten * run),
      };
    };
    return {
      lift,
      stretch,
      front: [leg(g.legLen, L.lagFar), leg(g.legLen, 0)],
      hind: [leg(g.legLen * S.leg.hind, 0.5 + L.lagFar), leg(g.legLen * S.leg.hind, 0.5)],
      /* the head rides the bob a little late, and dips on the drive */
      headDY: -lift * 0.34 + Math.sin(a - 0.6) * L.headBob * run,
      tail: Math.sin(a * 2) * L.tail * run,
      earSwing: Math.sin(a - 1.1) * L.ear * run,
    };
  }

  /** one leg: a soft stub with a paw, drawn from a hip toward the ground */
  function drawLeg(c, hx, hy, l, coat, dark, wide) {
    const w = g.legW * (wide || 1);
    const x = hx + l.dx;
    const y = hy + l.len + l.dy;
    c.save();
    c.strokeStyle = dark ? C.coatShade : coat;
    c.lineCap = 'round';
    c.lineWidth = w;
    c.beginPath();
    c.moveTo(hx, hy);
    /* a single soft bend toward the ground: no knee, per the reference */
    c.quadraticCurveTo(hx + l.dx * 0.55, hy + l.len * 0.55, x, y);
    c.stroke();
    /* the paw, a rounded blob a touch wider than the leg */
    c.fillStyle = dark ? C.coatShade : coat;
    ell(c, x, y, w * S.leg.paw, w * S.leg.paw * 0.78); c.fill();
    c.restore();
  }

  /**
   * DRAW HIM.
   *
   * `o = { x, y, s, face, phase, run, alpha }` — `y` is THE GROUND HE STANDS ON,
   * not his centre, which is the same contract `rig.y` has (`rig.floorV`). A
   * profile dog whose origin was his middle would need every caller to know how
   * tall he is.
   */
  function draw(gg, o = {}) {
    const c = gg.ctx;
    const s = o.s === undefined ? rig.s : o.s;
    const face = (o.face || -1) < 0 ? -1 : 1;
    const run = clamp(o.run === undefined ? 1 : o.run, 0, 1);
    const p = pose(o.phase || 0, run);
    const a = o.alpha === undefined ? 1 : o.alpha;

    c.save();
    c.globalAlpha = a;
    c.translate(o.x || 0, (o.y || 0) + p.lift);
    c.scale(face * s, s);

    /* ---- the contact shadow, which is what puts him ON something --------- */
    const sh = clamp(1 - p.lift / Math.max(1, S.gait.bob), 0.35, 1);
    c.save();
    c.globalAlpha = a * S.shadow.alpha * sh;
    c.fillStyle = S.shadow.ink;
    ell(c, 0, -p.lift, g.bodyHW * S.shadow.w * sh, g.bodyHH * S.shadow.h * sh); c.fill();
    c.restore();

    /* body geometry, in a space where the ground is y=0 and up is negative */
    const bodyCY = -(g.legLen + g.bodyHH * 0.86);
    const bodyCX = 0;
    const headCX = g.bodyHW * S.head.fwd;
    const headCY = bodyCY - g.bodyHH * S.head.up + p.headDY;

    /* ---- THE FAR LEGS, BEHIND EVERYTHING ------------------------------- */
    const shX = g.bodyHW * S.leg.shoulderX;
    const hipX = -g.bodyHW * S.leg.hipX;
    const hipY = bodyCY + g.bodyHH * 0.42;
    drawLeg(c, shX * 0.82, hipY, p.front[0], C.coat, true, 0.94);
    drawLeg(c, hipX * 0.82, hipY, p.hind[0], C.coat, true, 0.94);

    /* ---- THE TAIL, a curled plume off the rump ------------------------- */
    const tailX = -g.bodyHW * S.tail.x;
    const tailY = bodyCY - g.bodyHH * S.tail.y;
    c.save();
    c.translate(tailX, tailY);
    c.rotate((S.tail.angle + p.tail) * (P.tailCurl || 0.7));
    c.fillStyle = C.coat;
    furShape(c, -g.bodyHW * 0.10, 0, g.bodyHW * S.tail.w * (P.tailLen || 1),
      g.bodyHH * S.tail.h, { tuft, salt: 31, cycleScale: 0.55 });
    c.fill();
    c.strokeStyle = C.coatShade; c.lineWidth = 1.6; c.globalAlpha = a * 0.5; c.stroke();
    c.restore();

    /* ---- THE BODY ------------------------------------------------------ */
    c.fillStyle = C.coat;
    furShape(c, bodyCX, bodyCY, g.bodyHW * (1 + p.stretch * 0.02), g.bodyHH,
      { tuft, salt: 7, scale: tuft.bodyScale || 1 });
    c.fill();
    c.save(); c.globalAlpha = a * 0.55; c.strokeStyle = C.coatShade; c.lineWidth = 2;
    c.stroke(); c.restore();
    curls(c, bodyCX, bodyCY, g.bodyHW, g.bodyHH, C.coatShade, fur, 7);

    /* the chest and belly, pale — the same cream ramp the frontal dog carries */
    c.save();
    c.globalAlpha = a * S.cream.alpha;
    c.fillStyle = C.cream;
    furShape(c, g.bodyHW * 0.30, bodyCY + g.bodyHH * 0.34,
      g.bodyHW * S.cream.w, g.bodyHH * S.cream.h, { tuft, salt: 19, cycleScale: 0.8 });
    c.fill();
    c.restore();

    /* ---- THE NEAR LEGS ------------------------------------------------- */
    drawLeg(c, shX, hipY, p.front[1], C.coat, false, 1);
    drawLeg(c, hipX, hipY, p.hind[1], C.coat, false, 1);

    /* ---- THE HEAD ------------------------------------------------------ */
    c.fillStyle = C.coat;
    furShape(c, headCX, headCY, g.headHW, g.headHH, { tuft, salt: 3 });
    c.fill();
    c.save(); c.globalAlpha = a * 0.5; c.strokeStyle = C.coatShade; c.lineWidth = 2;
    c.stroke(); c.restore();
    curls(c, headCX, headCY, g.headHW, g.headHH, C.coatShade, fur, 3, 0.8);

    /* THE MUZZLE, which in profile is the outline of the face rather than a
       shape stuck on the front of it. Pale, like the frontal muzzle ramp. */
    const muzX = headCX + g.headHW * S.muzzle.x;
    const muzY = headCY + g.headHH * S.muzzle.y;
    c.fillStyle = C.cream;
    furShape(c, muzX, muzY, g.muzHW, g.muzHH, { tuft, salt: 12, amp: 0.55, cycleScale: 0.7 });
    c.fill();
    c.save(); c.globalAlpha = a * 0.4; c.strokeStyle = C.coatShade; c.lineWidth = 1.6;
    c.stroke(); c.restore();

    /* the nose: a dark bean at the tip, the reference's strongest single mark */
    c.fillStyle = C.nose;
    ell(c, muzX + g.muzHW * S.nose.x, muzY - g.muzHH * S.nose.y,
      g.muzHW * S.nose.r, g.muzHW * S.nose.r * 0.86); c.fill();

    /* the mouth line, and a tongue if he is running */
    c.save();
    c.strokeStyle = C.nose; c.globalAlpha = a * 0.75; c.lineWidth = 2.2; c.lineCap = 'round';
    c.beginPath();
    c.moveTo(muzX + g.muzHW * 0.62, muzY + g.muzHH * 0.30);
    c.quadraticCurveTo(muzX + g.muzHW * 0.10, muzY + g.muzHH * 0.62,
      muzX - g.muzHW * 0.34, muzY + g.muzHH * 0.40);
    c.stroke();
    c.restore();
    if (run > 0.35) {
      c.save();
      c.globalAlpha = a * clamp((run - 0.35) / 0.4, 0, 1);
      c.fillStyle = C.tongue;
      ell(c, muzX + g.muzHW * 0.16, muzY + g.muzHH * 0.72,
        g.muzHW * 0.30, g.muzHH * 0.34); c.fill();
      c.restore();
    }

    /* THE EYE — one of them. Big, dark, low, with the highlight the frontal
       face uses, because that highlight is most of what makes him a puppy. */
    const eyeX = headCX + g.headHW * S.eye.x;
    const eyeY = headCY + g.headHH * S.eye.y;
    const er = g.headHW * 0.245 * (P.eyeSize || 1) * S.eye.r;
    c.fillStyle = C.eye;
    ell(c, eyeX, eyeY, er, er * 1.04); c.fill();
    c.fillStyle = '#ffffff';
    ell(c, eyeX + er * 0.34, eyeY - er * 0.40, er * 0.34, er * 0.30); c.fill();
    /* the brow, which is what gives the frontal dog his expression */
    c.save();
    c.strokeStyle = C.coatShade; c.globalAlpha = a * 0.55; c.lineWidth = 2.4; c.lineCap = 'round';
    c.beginPath();
    c.moveTo(eyeX - er * 0.9, eyeY - er * 1.9);
    c.quadraticCurveTo(eyeX + er * 0.2, eyeY - er * 2.5, eyeX + er * 1.2, eyeY - er * 1.7);
    c.stroke();
    c.restore();

    /* ---- THE EAR, and there is only one ------------------------------- */
    const earX = headCX - g.headHW * S.ear.x;
    const earY = headCY + g.headHH * S.ear.y;
    c.save();
    c.translate(earX, earY);
    c.rotate(S.ear.angle + p.earSwing);
    c.fillStyle = C.coat;
    furShape(c, 0, g.earHH * 0.5, g.earHW, g.earHH,
      { tuft, salt: 23, cycleScale: 0.7, amp: 1.15 });
    c.fill();
    c.save(); c.globalAlpha = a * 0.45; c.strokeStyle = C.coatShade; c.lineWidth = 2;
    c.stroke(); c.restore();
    curls(c, 0, g.earHH * 0.5, g.earHW, g.earHH, C.coatShade, fur, 23, 0.7);
    c.restore();

    c.restore();
  }

  return {
    draw,
    /** the pose maths on its own, for gates and for anything that needs to know
        where his paws are without drawing him */
    pose,
    get geom() { return { ...g }; },
    get debug() {
      const p = pose(0.25, 1);
      return {
        breed: breed.id,
        geom: { bodyHW: +g.bodyHW.toFixed(1), bodyHH: +g.bodyHH.toFixed(1),
          headHW: +g.headHW.toFixed(1), legLen: +g.legLen.toFixed(1) },
        atQuarter: { lift: +p.lift.toFixed(2), frontDX: +p.front[1].dx.toFixed(2) },
      };
    },
  };
}

export default createSideDog;
