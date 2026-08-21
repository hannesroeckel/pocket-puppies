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
import { TAU, clamp, lerp, pt, hump, ell } from '../engine/draw.js';
import { FUR_TYPE } from './draw.js';
import { buildFluff, fluffMass } from './coat.js';
import { createFurredPart, drawLimb } from './part.js';
import { drawEye, drawNose, drawMouth } from './face.js';
import { drawSoil, drawFoam, drawWet, drawGloss } from './coatstate.js';
import { crClosed, ribbon } from '../engine/draw.js';

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
  /* ONE EAR, AND IT HANGS. The first shape was a fat oval and it read as a slice
     of bread stuck to his cheek: an ear is NARROW where it joins the skull and
     heavy at the bottom, and it hangs BEHIND the jaw rather than over it. So the
     top is pinched, the bottom is a broad rounded weight, and the whole thing is
     taller than it is wide. */
  ear: [
    [-0.34, -1.00], [0.24, -0.92], [0.52, -0.52], [0.62, 0.06],
    [0.74, 0.58], [0.46, 0.92], [-0.10, 1.00], [-0.62, 0.78],
    [-0.80, 0.24], [-0.72, -0.34], [-0.56, -0.78],
  ],
  /* AN ERECT EAR, for a breed that has them. The Shiba came back wearing a
     spaniel's hanging lobe, which is the "all dogs matter" failure in one
     picture: `breed.ear` is `prick`, `floppy` or `semi` and the frontal renderer
     has honoured that from stage 1. A prick ear is narrow at the tip, widens to
     the base, and stands ON the crown rather than hanging beside the jaw. */
  earUp: [
    [0.02, -1.00], [0.34, -0.52], [0.56, 0.10], [0.60, 0.66],
    [0.20, 1.00], [-0.34, 0.94], [-0.62, 0.48], [-0.52, -0.20],
    [-0.24, -0.72],
  ],
  /* the tail: a plume, fat at the tip */
  tail: [
    [-0.90, 0.10], [-0.52, -0.52], [0.06, -0.82], [0.62, -0.66],
    [0.92, -0.14], [0.86, 0.44], [0.36, 0.82], [-0.28, 0.76],
    [-0.76, 0.52],
  ],
  /* ---- THE FURNISHINGS, IN PROFILE -------------------------------------
     AND THIS IS NEW ART, NOT AN EXTRACTION. Worth being exact about, because
     every other batch of this work was a move: a breed's furnishing `path` is
     authored in FRONTAL head-local space, where a beard is a symmetric mass
     spanning both cheeks under a muzzle pointing at you. Side-on it is a wedge
     hanging off one jaw. There is no transform between those two shapes — they
     are different drawings of the same fur.

     What IS taken from the breed, so a Schnoodle cannot be a Schnoodle face-on
     and something else in profile: whether it has the furnishing at all, its
     colour and shade keys, and its tuft amplitude, cycles and power. Matched by
     the `tag` the breed table already carries. */
  beard: [
    [0.72, -0.60], [0.30, -0.80], [-0.28, -0.70], [-0.66, -0.30],
    [-0.72, 0.30], [-0.40, 0.82], [0.16, 1.00], [0.62, 0.72],
    [0.86, 0.10],
  ],
  moustache: [
    [0.86, -0.44], [0.34, -0.78], [-0.30, -0.62], [-0.70, -0.10],
    [-0.52, 0.56], [0.06, 0.86], [0.62, 0.62], [0.92, 0.14],
  ],
  /* the pale chest and belly, inside the body's front half */
  chest: [
    [0.86, -0.10], [0.52, -0.44], [0.06, -0.50], [-0.36, -0.30],
    [-0.52, 0.14], [-0.30, 0.60], [0.20, 0.80], [0.66, 0.60],
    [0.88, 0.26],
  ],
};

/** the breed's mouth multipliers, defaulting to 1 exactly as dog/draw.js does */
function MKof(breed) {
  const m = (breed.face && breed.face.mouth) || {};
  const d = (v) => (v === undefined ? 1 : v);
  return { w: d(m.w), lift: d(m.lift), dip: d(m.dip), philtrum: d(m.philtrum), weight: d(m.weight) };
}

export function createSideDog(rig) {
  const breed = rig.breed;
  const P = breed.proportions;
  const pal = rig.pal;
  const fur = FUR_TYPE[breed.fur.type] || FUR_TYPE.short;
  /* WHICH EAR THIS DOG HAS. `prick` stands on the crown; `floppy` and `semi`
     hang beside the jaw. Read off `breed.ear`, the same declarative capability
     dog/draw.js's EAR_STYLE table reads, so a breed cannot have two answers. */
  const prick = (breed.ear || 'prick') === 'prick';
  const EAR = prick ? S.ear.prick : S.ear.drop;
  const tuft = fur.tuft || { cycles: 12, amp: 3, pow: 0.7 };

  /* ---- THE PROFILE'S OWN PROPORTIONS -------------------------------------
     Derived from the frontal numbers, never typed in: a breed that is wider
     face-on is longer in profile, and nothing has two sources of truth. */
  const g = {
    bodyHW: P.bodyW * S.body.long,
    bodyHH: P.bodyH * S.body.deep,
    headHW: P.headW * P.headScale * S.head.w,
    headHH: P.headH * P.headScale * S.head.h,
    earHW: P.earW * EAR.w,
    earHH: P.earH * EAR.h,
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

  /* ---- THE FOUR BIG MASSES ARE REAL FURRED PARTS -------------------------
     Not tufted outlines with arcs drawn on them — the actual thing dog/part.js
     builds for the frontal dog: the tuft profile, the scallop, the fringe of
     lobes behind the edge, the flyaway curls straddling the rim, and the
     interior clumps. That fringe is the layer whose absence made the first two
     attempts read as a cutout however the polygons were moved.

     Each gets its own tuft phase and its own salts, so no two parts of him are
     scalloped in lockstep — the same reason the frontal head and body use 2.39
     and 0.41. `clumps` is the same list the frontal part uses for that region,
     so the interior texture is this breed's own coat and not a generic one. */
  const partOf = (outline, o) => createFurredPart({
    outline,
    furType: fur,
    pal,
    clumps: o.clumps || [],
    tuftPhase: o.phase,
    tuftK: o.tuftK,
    skirtRefH: o.refH,
    fringeSalt: o.salt,
    fringeK: o.fringeK === undefined ? 1 : o.fringeK,
    flySalt: o.salt + 1.9,
  });
  const poly = (shape, hw, hh) => shape.map((q) => pt(q[0] * hw, q[1] * hh));
  const T = fur.tuft || {};
  const parts = {
    body: partOf(poly(SHAPE.body, g.bodyHW, g.bodyHH),
      { phase: 0.41, tuftK: T.bodyScale, refH: g.bodyHH, salt: 1.3, clumps: rig.fur.body }),
    head: partOf(poly(SHAPE.head, g.headHW, g.headHH),
      { phase: 2.39, tuftK: T.headScale, refH: g.headHH, salt: 3.7,
        fringeK: fur.fringe ? fur.fringe.headScale : 1, clumps: rig.fur.head }),
    /* THE EAR IS A PART NOW, not a rotated lobe. It is the single loudest wrong
       thing in the first two renders, and the reason is that an ear is mostly
       COAT EDGE — it is nearly all silhouette, so it needs the fringe more than
       the body does. */
    ear: partOf(poly(prick ? SHAPE.earUp : SHAPE.ear, g.earHW, g.earHH),
      { phase: 1.07, tuftK: T.headScale, refH: g.earHH, salt: 5.9 }),
    tail: partOf(poly(SHAPE.tail, g.tailHW, g.tailHH),
      { phase: 4.11, tuftK: T.bodyScale, refH: g.tailHH, salt: 8.2 }),
  };
  /** the breed's own furnishing entry for a tag, or null */
  function furnOf(tag) {
    return (breed.furnishings || []).find((f) => f.tag === tag && f.kind === 'fluff') || null;
  }
  /* set by drawFace, consumed after the furnishings — see `mouthOver` */
  let lateMouth = null;
  const FURN = ['beard', 'moustache'].map((tag) => {
    const f = furnOf(tag);
    if (!f) return null;
    const W = S.furn[tag];
    const hw = P.muzzleW * S.muzzle.w * W.w, hh = P.muzzleH * S.muzzle.h * W.h;
    return {
      tag, f, hw, hh,
      geo: buildFluff(SHAPE[tag].map((q) => pt(q[0] * hw, q[1] * hh)),
        tag === 'beard' ? 41.3 : 47.9,
        f.tuftAmp === undefined ? 2.4 : f.tuftAmp,
        f.tuftCycles || 12, f.tuftPow || 0.8, f.rim),
      spec: { shadeIn: f.shadeIn, contact: { alpha: 0.14, dy: 0.08 } },
    };
  }).filter(Boolean);

  /* the pale chest stays a plain tufted mass: it is an INTERIOR patch, so it has
     no edge to break and a fringe on it would poke lobes through the flank */
  const geo = {
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

  /**
   * ONE FURRED PART, IN THE FRONTAL RENDERER'S OWN LAYER ORDER.
   *
   * Copied from `draw.js`'s body pass, because the order IS the look: fringe
   * behind the silhouette so the edge breaks irregularly, then the outline pass,
   * then the fill, then everything else clipped INSIDE the silhouette so no
   * texture can protrude, then the flyaway curls outside the clip on purpose.
   */
  function furred(c, key, x, y, rot, hh, fill, alpha, coat, region) {
    const P2 = parts[key];
    const wet = coat ? clamp(coat.wet || 0, 0, 1) : 0;
    const b = P2.build(null, 1, 1, x, y, 1, null, wet);
    c.save();
    c.globalAlpha = alpha;
    c.translate(x, y);
    if (rot) c.rotate(rot);
    P2.fringe(c, hh, 0);
    c.beginPath(); crClosed(c, b.o, 1);
    c.fillStyle = pal.line; c.fill();
    c.beginPath(); crClosed(c, b.p, 1);
    c.fillStyle = fill; c.fill();
    c.save(); c.clip();
    P2.fur(c, hh, x, y, wet);
    /* THE CARE STATE, INSIDE THE CLIP AND IN THE FRONTAL DOG'S OWN ORDER: wet
       and gloss are lighting, so they go under the dirt — muck sits ON the coat,
       and painting it first let the rim light wash it out (the first render of a
       filthy dog came back spotless). */
    if (coat && region) {
      const hw2 = key === 'head' ? g.headHW : g.bodyHW;
      drawWet(c, coat, hw2, hh, null);
      drawGloss(c, coat, hw2, hh, null);
      drawSoil(c, coat, region, hw2, hh, null);
      drawFoam(c, coat, region, hw2, hh, null);
    }
    c.restore();
    P2.flyaway(c, hh, wet);
    c.restore();
  }

  /**
   * THE NECK — the join, without which the head is a ball on a chest.
   *
   * NOT an extraction, and worth being straight about that: `dog/draw.js`'s
   * `drawNeck` is written against the frontal pose — a short column from the
   * withers to the underside of a head directly above them — and the profile's
   * neck runs forward as well as up. What IS shared is the rule, which is the
   * part that matters:
   *
   *   "NO outline pass: the neck is always sandwiched between two outlined
   *    shapes, and a dark border on it reads as a separate collar-shaped object
   *    rather than as part of the animal. Shape and shading only."
   *
   * So: a ribbon from the withers to the back of the jaw, darker at the throat,
   * and no contour anywhere.
   */
  function neck(c, bodyY, hx, hy) {
    const N = S.neck || {};
    const x0 = g.bodyHW * (N.fromX === undefined ? 0.52 : N.fromX);
    const y0 = bodyY - g.bodyHH * (N.fromY === undefined ? 0.34 : N.fromY);
    const x1 = hx - g.headHW * (N.toX === undefined ? 0.22 : N.toX);
    const y1 = hy + g.headHH * (N.toY === undefined ? 0.40 : N.toY);
    const w0 = g.bodyHH * (N.w0 === undefined ? 0.70 : N.w0);
    const w1 = g.headHH * (N.w1 === undefined ? 0.52 : N.w1);
    const nodes = [pt(x0, y0), pt(lerp(x0, x1, 0.4), lerp(y0, y1, 0.4)),
      pt(lerp(x0, x1, 0.75), lerp(y0, y1, 0.75)), pt(x1, y1)];
    c.save();
    c.beginPath();
    ribbon(c, nodes, [w0, lerp(w0, w1, 0.45), lerp(w0, w1, 0.8), w1]);
    const ng = c.createLinearGradient(0, y0 - w0, 0, y1 + w1);
    ng.addColorStop(0, pal.coat);
    ng.addColorStop(1, pal.coatSh);
    c.fillStyle = ng;
    c.fill();
    c.restore();
  }

  /** a plain tufted mass, for the interior patches that have no edge to break */
  function mass(c, key, x, y, rot, hw, hh, main, dark, alpha) {
    c.save();
    c.translate(x, y);
    if (rot) c.rotate(rot);
    fluffMass(c, SPEC[key], geo[key], 1, main, dark, hw, hh, alpha, pal);
    c.restore();
  }

  /**
   * A LEG — the frontal renderer's own, through dog/part.js's `drawLimb`.
   *
   * The first two attempts stroked a line with a round cap, and against a dog
   * whose legs taper from the hip, bow at the knee and end in a pale paw with
   * two toe lines, a capsule reads as furniture. `bow` is what makes it a limb
   * rather than a rod, and here it comes off the stride: the leg bends most as
   * it swings under him and straightens as it takes his weight.
   */
  function leg(c, hx, hy, l, dark, wide) {
    const w = g.legW * (wide || 1);
    const px = hx + l.dx;
    const py = hy + l.len + l.dy;
    /* he is drawn nose-right, so a positive bow always bends the knee FORWARD */
    const bow = (S.leg.bow || 4) * (0.35 + Math.abs(l.dx) / Math.max(1, S.gait.reach));
    drawLimb(c, hx, hy, px, py, bow * (l.dx >= 0 ? 1 : -1), w, dark, S.leg.paw,
      { pal, pawScale: 1, stocking: null, tint: pal.coat, tintFar: pal.coatMid });
  }

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
    leg(c, g.bodyHW * S.leg.shoulderX * 0.80, hipY, p.front[0], true, 0.94);
    leg(c, -g.bodyHW * S.leg.hipX * 0.80, hipY, p.hind[0], true, 0.94);
    /* THE TAIL IS CARRIED THE WAY THE BREED CARRIES IT. `tailCurl` is 0.72 on
       the Shiba and about 0.1 on the two doodles — the difference between a tail
       curled over the back and a plume held out behind — and `tailCarry` (negative
       on both doodles) lowers the base angle. Both are already in the breed table
       and the frontal dog already reads them; the profile just did not. */
    const carry = (P.tailCurl || 0) * (S.tail.curl || 1.15)
      + (P.tailCarry || 0) * (S.tail.carry || 0.55);
    furred(c, 'tail', -g.bodyHW * S.tail.x, bodyY - g.bodyHH * S.tail.y,
      S.tail.angle - carry + p.tail, g.tailHH, main, a);
    furred(c, 'body', 0, bodyY, 0, g.bodyHH, main, a, o.coat, 'body');
    mass(c, 'chest', g.bodyHW * 0.34, bodyY + g.bodyHH * 0.30, 0,
      g.bodyHW * S.cream.w, g.bodyHH * S.cream.h, pal.cream, pal.creamSh, a * S.cream.alpha);

    /* near legs in front of the body */
    leg(c, g.bodyHW * S.leg.shoulderX, hipY, p.front[1], false, 1);
    leg(c, -g.bodyHW * S.leg.hipX, hipY, p.hind[1], false, 1);

    /* the join, then the head over the shoulders, the face, then the ear */
    neck(c, bodyY, headX, headY);
    furred(c, 'head', headX, headY, 0, g.headHH, main, a, o.coat, 'head');
    drawFace(c, headX, headY, a);
    /* the beard and the moustache, over the face and under the ear */
    for (const F of FURN) {
      const W = S.furn[F.tag];
      c.save();
      c.translate(headX + g.headHW * W.x, headY + g.headHH * W.y);
      fluffMass(c, F.spec, F.geo, 1, pal[F.f.color] || pal.cream,
        pal[F.f.shade] || pal.creamSh, F.hw, F.hh, a, pal);
      c.restore();
    }
    if (lateMouth) {
      const L = lateMouth;
      drawMouth(c, L.at[0], L.at[1], 0, L.at[2], 0, L.opts);
      lateMouth = null;
    }
    furred(c, 'ear', headX - g.headHW * EAR.x, headY + g.headHH * EAR.y,
      EAR.angle + p.ear, g.earHH, main, a);

    c.restore();
  }

  /**
   * THE FACE — the real one, from dog/face.js.
   *
   * The first profile drew its own: a dark ellipse with a white dot for an eye, a
   * bean for a nose, a quadratic for a mouth. The functions below are the ones
   * eight stages of looking produced — an authored lid shape, a catchlight that
   * slides further than the lens, an eight-point nose with a specular, and a
   * mouth carrying five per-breed multipliers. Same code as face-on; only the
   * geometry it is handed is different, and only ONE eye is handed to it.
   */
  function drawFace(c, hx, hy, a) {
    const mx = hx + g.headHW * S.muzzle.x;
    const my = hy + g.headHH * S.muzzle.y;
    const mw = P.muzzleW * S.muzzle.w, mh = P.muzzleH * S.muzzle.h;
    /* `dog/face.js` sizes the nose and the mouth off `D.muzY`, which in the
       frontal rig is the muzzle's POSITION on the head, not its size — quirky,
       but it is what those functions were tuned against. Feeding it the profile
       muzzle's HEIGHT gave a nose 31 units wide on a 24-unit muzzle: he came back
       wearing sunglasses. So it is scaled off the profile muzzle's own half-width
       instead, which is the dimension a nose is actually proportional to. */
    const opts = { pal, D: { muzY: mw * S.muzzle.face }, R: BALANCE.rig,
      faceCap: breed.face || {}, MK: MKof(breed) };

    /* the pale muzzle, sitting ON the face rather than stuck to the front of it */
    c.save();
    c.globalAlpha = a * 0.92;
    c.fillStyle = pal.muzMid || pal.cream;
    ell(c, mx, my, mw, mh); c.fill();
    c.restore();

    /* THE MOUTH FIRST, then the nose over it: the nose is the nearer object and
       a mouth line crossing it reads as a crack. `smi` comes from the rig's own
       smile spring, so he smiles in profile for the same reasons he does face-on.

       UNLESS THE BREED WEARS A BEARD. `face.mouthOver` exists for exactly this
       and draw.js says why: "a breed whose beard and moustache cover the jaw
       otherwise has no mouth at all ... the mouth is this game's primary mood
       channel, so on such a breed it is the LAST thing drawn". Same rule here —
       `lateMouth` is picked up after the furnishings. */
    const smi = clamp(rig.springs.smile ? rig.springs.smile.x : 0.4, 0, 1);
    const mouthAt = [mx + mw * S.mouth.x, my + mh * S.mouth.y, smi];
    if ((breed.face || {}).mouthOver) lateMouth = { at: mouthAt, opts };
    else drawMouth(c, mouthAt[0], mouthAt[1], 0, smi, 0, opts);
    drawNose(c, mx + mw * S.nose.x, my - mh * S.nose.y, opts);

    /* ONE EYE, and the lid shape is what makes it an eye rather than a lens.
       `side` is -1 so the authored asymmetry faces the nose. */
    const ex = hx + g.headHW * S.eye.x;
    const ey = hy + g.headHH * S.eye.y;
    const ew = g.headHW * S.eye.w * (P.eyeSize || 1);
    const eh = ew * S.eye.aspect;
    drawEye(c, ex, ey, ew, eh, 1, smi * 0.5, S.eye.tilt, -1, null, opts);

    /* the brow: the frontal dog's expression lives in it */
    c.save();
    c.strokeStyle = pal.coatSh; c.globalAlpha = a * 0.5;
    c.lineWidth = 2.6; c.lineCap = 'round';
    c.beginPath();
    c.moveTo(ex - ew * 0.5, ey - eh * 1.1);
    c.quadraticCurveTo(ex + ew * 0.1, ey - eh * 1.5, ex + ew * 0.65, ey - eh * 1.0);
    c.stroke();
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
          headHW: +g.headHW.toFixed(1), headHH: +g.headHH.toFixed(1),
          earHW: +g.earHW.toFixed(1), earHH: +g.earHH.toFixed(1),
          legLen: +g.legLen.toFixed(1) },
        atQuarter: { lift: +p.lift.toFixed(2), frontDX: +p.front[1].dx.toFixed(2) },
      };
    },
  };
}

export default createSideDog;
