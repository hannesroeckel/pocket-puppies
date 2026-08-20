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
   THE FIRST VERSION OF THIS FILE DREW ITS OWN COAT, and the verdict on it was
   "that looks horrible". It was: one sine-modulated outline and a few interior
   arcs, against a frontal dog whose coat is a contact shadow, a dark rim outside
   the fill, the fill, and a form shade inside it — tufted once at construction
   and tuned across eight stages against defects that were only ever found by
   looking. It reused the frontal coat's NUMBERS and none of its DRAWING, so it
   read as a knock-off of our own dog, which is what it was.

   So `buildFluff` and `fluffMass` moved out of dog/draw.js into dog/coat.js and
   BOTH VIEWS CALL THEM. Everything here is shared: the tufted mass, the derived
   palette (`rig.pal`, including `line` — the contour the first attempt had no
   idea it was missing), `breed.proportions` for how big the parts are, and
   `FUR_TYPE` for how deep the scallop is. What is NOT shared is the silhouette,
   which is the one thing the two views are supposed to disagree about.

   THE SHAPES ARE NORMALISED POLYGONS, in the same [-1..1] space `breed.furnishings`
   uses for its paths, scaled by half-extents at construction. So a Shiba's
   profile is a Shiba's proportions and there is no second table of sizes.

   He must read as the same dog seen from a different side. That is the whole
   test, and it is not one a gate can make — it is one to look at.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { TAU, clamp, pt, hump, ell } from '../engine/draw.js';
import { FUR_TYPE } from './draw.js';
import { buildFluff, fluffMass } from './coat.js';

const S = BALANCE.side;

/* ==========================================================================
   THE SILHOUETTES, as normalised polygons in [-1..1].

   +x is FORWARD (the nose end) and +y is DOWN, so every shape below is drawn
   nose-right and mirrored by the caller's transform — one set of numbers rather
   than two. Scaled by the part's half-extents at construction.

   These twelve-or-so points per shape are the entire art direction of the
   profile, and they are what the render-and-look loop moves.
   ========================================================================== */
const SHAPE = {
  /* the body: a bean with a DEEP CHEST FORWARD and a tucked belly behind it,
     which is what makes a puppy read as a puppy rather than as a sausage */
  body: [
    [0.98, -0.18], [0.74, -0.72], [0.30, -0.94], [-0.20, -0.98],
    [-0.66, -0.82], [-0.94, -0.42], [-1.00, 0.10], [-0.82, 0.56],
    [-0.40, 0.72], [0.10, 0.80], [0.56, 0.92], [0.90, 0.52],
  ],
  /* the head: a dome, a stop, and a short muzzle carrying the nose */
  head: [
    [-0.10, -1.00], [0.42, -0.88], [0.72, -0.60], [0.96, -0.40],
    [1.14, -0.06], [0.98, 0.28], [0.62, 0.46], [0.20, 0.62],
    [-0.34, 0.76], [-0.82, 0.52], [-1.00, 0.04], [-0.90, -0.52],
  ],
  /* one ear: a long soft lobe, wider at the bottom than the top */
  ear: [
    [-0.52, -0.86], [0.16, -0.94], [0.62, -0.58], [0.78, 0.00],
    [0.72, 0.56], [0.34, 0.90], [-0.24, 0.96], [-0.68, 0.62],
    [-0.86, 0.06], [-0.80, -0.48],
  ],
  /* the tail: a plume, fat at the tip */
  tail: [
    [-0.90, 0.10], [-0.52, -0.52], [0.06, -0.82], [0.62, -0.66],
    [0.92, -0.14], [0.86, 0.44], [0.36, 0.82], [-0.28, 0.76],
    [-0.76, 0.52],
  ],
  /* the pale chest and belly, inside the body's front half */
  chest: [
    [0.86, -0.10], [0.52, -0.44], [0.06, -0.50], [-0.36, -0.30],
    [-0.52, 0.14], [-0.30, 0.60], [0.20, 0.80], [0.66, 0.60],
    [0.88, 0.26],
  ],
};

export function createSideDog(rig) {
  const breed = rig.breed;
  const P = breed.proportions;
  const pal = rig.pal;
  const fur = FUR_TYPE[breed.fur.type] || FUR_TYPE.short;
  const tuft = fur.tuft || { cycles: 12, amp: 3, pow: 0.7 };

  /* ---- THE PROFILE'S OWN PROPORTIONS -------------------------------------
     Derived from the frontal numbers, never typed in: a breed that is wider
     face-on is longer in profile, and nothing has two sources of truth. */
  const g = {
    bodyHW: P.bodyW * S.body.long,
    bodyHH: P.bodyH * S.body.deep,
    headHW: P.headW * P.headScale * S.head.w,
    headHH: P.headH * P.headScale * S.head.h,
    earHW: P.earW * S.ear.w,
    earHH: P.earH * S.ear.h,
    tailHW: P.bodyW * S.tail.w * (P.tailLen || 1),
    tailHH: P.bodyH * S.tail.h,
    legLen: P.legLen * S.leg.len,
    legW: P.legW * S.leg.w,
  };

  /* ---- TUFTED ONCE, AT CONSTRUCTION --------------------------------------
     `buildFluff` bakes the scalloped contour, the dark rim outside it, and the
     smooth base the contact shadow is traced round. It is static in part-local
     space — which is exactly why the frontal dog can bake its furnishings to
     bitmaps, and why nothing here re-tufts per frame. */
  function tuftOf(shape, hw, hh, salt, o = {}) {
    const poly = shape.map((q) => pt(q[0] * hw, q[1] * hh));
    return buildFluff(poly, salt,
      (tuft.amp || 3) * (o.amp === undefined ? 1 : o.amp) * (o.scale || 1),
      Math.max(3, (tuft.cycles || 12) * (o.cycleScale === undefined ? 1 : o.cycleScale)),
      tuft.pow || 0.7, o.rim);
  }

  const geo = {
    body: tuftOf(SHAPE.body, g.bodyHW, g.bodyHH, 7.1, { scale: tuft.bodyScale || 1 }),
    head: tuftOf(SHAPE.head, g.headHW, g.headHH, 3.3),
    ear: tuftOf(SHAPE.ear, g.earHW, g.earHH, 23.5, { amp: 0.9 }),
    tail: tuftOf(SHAPE.tail, g.tailHW, g.tailHH, 31.7, { amp: 1.1, cycleScale: 0.7 }),
    chest: tuftOf(SHAPE.chest, g.bodyHW * S.cream.w, g.bodyHH * S.cream.h, 19.3,
      { amp: 0.5, cycleScale: 0.8, rim: 0.35 }),
  };

  /* the specs the shared mass reads: a contact shadow under each part and a form
     shade inside it, which together are what stop a mass reading as a cut-out */
  const SPEC = {
    body: { contact: { alpha: 0.16, dy: 0.10 }, shadeIn: 0.30 },
    head: { contact: { alpha: 0.14, dy: 0.12 }, shadeIn: 0.26 },
    ear: { contact: { alpha: 0.18, dy: 0.06 }, shadeUnder: 0.34 },
    tail: { shadeIn: 0.28 },
    chest: { shadeUnder: 0.18 },
  };

  /** the gait: a bound, per the reference's four keys */
  function pose(phase, run) {
    const ph = ((phase % 1) + 1) % 1;
    const a = ph * TAU;
    const L = S.gait;
    const lift = hump(ph) * L.bob * run;
    const leg = (base, off) => {
      const q = (ph + off) % 1;
      const sw = Math.sin(q * TAU);
      return {
        dx: sw * L.reach * run,
        dy: -Math.max(0, Math.sin(q * TAU)) * L.paw * run,
        len: base * (1 - Math.abs(sw) * L.foreshorten * run),
      };
    };
    return {
      lift,
      front: [leg(g.legLen, L.lagFar), leg(g.legLen, 0)],
      hind: [leg(g.legLen * S.leg.hind, 0.5 + L.lagFar), leg(g.legLen * S.leg.hind, 0.5)],
      headDY: -lift * 0.30 + Math.sin(a - 0.6) * L.headBob * run,
      tail: Math.sin(a * 2) * L.tail * run,
      ear: Math.sin(a - 1.1) * L.ear * run,
    };
  }

  /** one part's mass, at a position, through the SHARED pipeline */
  function mass(c, key, x, y, rot, hw, hh, main, dark, alpha) {
    c.save();
    c.translate(x, y);
    if (rot) c.rotate(rot);
    fluffMass(c, SPEC[key], geo[key], 1, main, dark, hw, hh, alpha, pal);
    c.restore();
  }

  /** a leg: a stub with a rim, because the reference has no joints */
  function drawLeg(c, hx, hy, l, main, dark, wide) {
    const w = g.legW * (wide || 1);
    const x = hx + l.dx;
    const y = hy + l.len + l.dy;
    c.save();
    c.lineCap = 'round';
    /* the rim first and wider, then the coat on top — the same "dark outside the
       fill" order the tufted mass uses */
    for (const pair of [[dark, w + 3.4], [main, w]]) {
      c.strokeStyle = pair[0];
      c.lineWidth = pair[1];
      c.beginPath();
      c.moveTo(hx, hy);
      c.quadraticCurveTo(hx + l.dx * 0.55, hy + l.len * 0.55, x, y);
      c.stroke();
    }
    const pr = w * S.leg.paw;
    c.fillStyle = dark;
    ell(c, x, y, pr + 1.7, pr * 0.80 + 1.7); c.fill();
    c.fillStyle = main;
    ell(c, x, y, pr, pr * 0.80); c.fill();
    c.restore();
  }

  /** the muzzle tip, the nose, the mouth and the one eye */
  function drawFace(c, hx, hy, a) {
    const mx = hx + g.headHW * S.muzzle.x;
    const my = hy + g.headHH * S.muzzle.y;
    const mw = P.muzzleW * S.muzzle.w, mh = P.muzzleH * S.muzzle.h;

    /* the pale muzzle, sitting ON the face rather than stuck to the front of it */
    c.save();
    c.globalAlpha = a * 0.92;
    c.fillStyle = pal.muzMid || pal.cream;
    ell(c, mx, my, mw, mh); c.fill();
    c.restore();

    /* the nose: a dark bean at the tip, the strongest single mark on him */
    c.fillStyle = pal.nose;
    ell(c, mx + mw * S.nose.x, my - mh * S.nose.y, mw * S.nose.r, mw * S.nose.r * 0.88); c.fill();

    /* the mouth, a soft line back from under the nose */
    c.save();
    c.strokeStyle = pal.mouth || pal.line;
    c.globalAlpha = a * 0.8; c.lineWidth = 2.1; c.lineCap = 'round';
    c.beginPath();
    c.moveTo(mx + mw * 0.52, my + mh * 0.34);
    c.quadraticCurveTo(mx + mw * 0.02, my + mh * 0.74, mx - mw * 0.44, my + mh * 0.44);
    c.stroke();
    c.restore();

    /* THE EYE, and there is one of them. Sized off the frontal eye and then
       HALVED: face-on you read two small eyes in a wide face, and the same
       radius in profile is a saucer — which is exactly what the first render
       put on the side of his head. */
    const ex = hx + g.headHW * S.eye.x;
    const ey = hy + g.headHH * S.eye.y;
    const er = g.headHW * 0.245 * (P.eyeSize || 1) * S.eye.r;
    c.fillStyle = pal.eye;
    ell(c, ex, ey, er, er * 1.06); c.fill();
    c.fillStyle = pal.eyeHi || '#ffffff';
    ell(c, ex + er * 0.36, ey - er * 0.42, er * 0.32, er * 0.28); c.fill();
    /* the brow: the frontal dog's expression lives in it */
    c.save();
    c.strokeStyle = pal.coatSh; c.globalAlpha = a * 0.5;
    c.lineWidth = 2.6; c.lineCap = 'round';
    c.beginPath();
    c.moveTo(ex - er * 1.0, ey - er * 2.0);
    c.quadraticCurveTo(ex + er * 0.2, ey - er * 2.7, ex + er * 1.3, ey - er * 1.8);
    c.stroke();
    c.restore();
  }

  /**
   * DRAW HIM. `y` is THE GROUND HE STANDS ON, not his centre — the same contract
   * `rig.y` has (`rig.floorV`), because a profile dog whose origin was his middle
   * would need every caller to know how tall he is.
   */
  function draw(gg, o = {}) {
    const c = gg.ctx;
    const s = o.s === undefined ? rig.s : o.s;
    const face = (o.face || -1) < 0 ? -1 : 1;
    const run = clamp(o.run === undefined ? 1 : o.run, 0, 1);
    const a = o.alpha === undefined ? 1 : o.alpha;
    const p = pose(o.phase || 0, run);
    const main = pal.coat, dark = pal.line;

    c.save();
    c.globalAlpha = a;
    c.translate(o.x || 0, o.y || 0);
    c.scale(face * s, s);
    c.lineJoin = 'round';

    /* the contact shadow on the ground — smaller and fainter the higher he is.
       Drawn BEFORE the lift is applied, because the shadow stays on the floor. */
    const sh = clamp(1 - p.lift / Math.max(1, S.gait.bob), 0.4, 1);
    c.save();
    c.globalAlpha = a * S.shadow.alpha * sh;
    c.fillStyle = S.shadow.ink;
    ell(c, 0, 0, g.bodyHW * S.shadow.w * sh, g.bodyHH * S.shadow.h * sh); c.fill();
    c.restore();

    c.translate(0, -p.lift);
    const bodyY = -(g.legLen + g.bodyHH * 0.82);
    const headX = g.bodyHW * S.head.fwd;
    const headY = bodyY - g.bodyHH * S.head.up + p.headDY;
    const hipY = bodyY + g.bodyHH * 0.40;

    /* far legs, the tail, then the body over both */
    drawLeg(c, g.bodyHW * S.leg.shoulderX * 0.80, hipY, p.front[0], pal.coatSh, dark, 0.94);
    drawLeg(c, -g.bodyHW * S.leg.hipX * 0.80, hipY, p.hind[0], pal.coatSh, dark, 0.94);
    mass(c, 'tail', -g.bodyHW * S.tail.x, bodyY - g.bodyHH * S.tail.y,
      S.tail.angle + p.tail, g.tailHW, g.tailHH, main, dark, a);
    mass(c, 'body', 0, bodyY, 0, g.bodyHW, g.bodyHH, main, dark, a);
    mass(c, 'chest', g.bodyHW * 0.34, bodyY + g.bodyHH * 0.30, 0,
      g.bodyHW * S.cream.w, g.bodyHH * S.cream.h, pal.cream, pal.creamSh, a * S.cream.alpha);

    /* near legs in front of the body */
    drawLeg(c, g.bodyHW * S.leg.shoulderX, hipY, p.front[1], main, dark, 1);
    drawLeg(c, -g.bodyHW * S.leg.hipX, hipY, p.hind[1], main, dark, 1);

    /* the head over the shoulders, the face, then the ear over all of it */
    mass(c, 'head', headX, headY, 0, g.headHW, g.headHH, main, dark, a);
    drawFace(c, headX, headY, a);
    mass(c, 'ear', headX - g.headHW * S.ear.x, headY + g.headHH * S.ear.y,
      S.ear.angle + p.ear, g.earHW, g.earHH, main, dark, a);

    c.restore();
  }

  return {
    draw,
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
