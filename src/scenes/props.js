/* ==========================================================================
   scenes/props.js — the room's physical objects, drawn not fonted.

   Scene ART, not design tunables (ARCHITECTURE §11 G): geometry and colour
   ramps live here, the numbers a designer would turn live in BALANCE.care.

   These are shared between the baked room decor and the live care actions —
   the bowl she drags into place is the same bowl that sits by the wall, which
   is most of why picking it up feels like touching the room rather than
   opening a menu.
   ========================================================================== */
import { TAU, clamp, lerp, ell, roundRect, rgba } from '../engine/draw.js';

export const PC = {
  teal: '#87a89c', tealD: '#6c8b80', tealL: '#a9c4b8',
  clay: '#d09a63', clayL: '#e5b98d', clayD: '#b57c47',
  cream: '#f6e6c9', shadow: 'rgba(104,58,32,0.20)',
  water: '#8fc4ce', waterL: '#c3e4ea', waterD: '#6ea6b3',
  kibble: '#c08a4d', kibbleD: '#a9743f', kibbleL: 'rgba(255,235,190,0.5)',
  sack: '#e2cba4', sackD: '#c4a87f', sackBand: '#cf6e58',
  foam: 'rgba(255,255,255,0.80)',
  wood: '#c98a63', woodD: '#a06a45',
  bristle: '#e9d3ac', bristleD: '#c2a67c',
};

/* deterministic kibble scatter so a bowl doesn't shimmer between frames */
const KIBBLE = [
  [-13, -11, 4.4], [-5, -13, 4.8], [4, -12, 4.4], [12, -10, 4.0], [-9, -8, 4.2],
  [1, -7.6, 4.6], [9, -8.4, 4.1], [-16, -8, 3.4], [16, -7.6, 3.2], [-2, -10.5, 4.3],
  [7, -13.5, 3.8], [-11, -13.8, 3.6], [14, -13, 3.4], [-18, -11, 3.0], [18, -10.5, 3.0],
  [-6, -5.5, 3.9], [5, -5.2, 4.0], [-14, -5.0, 3.3], [13, -5.4, 3.2], [0, -3.6, 3.6],
  [-9, -2.6, 3.2], [8, -2.8, 3.1], [-3, -15.5, 3.4], [3, -16.0, 3.2],
];

/* ---- THE BOWL'S OWN GEOMETRY, PUBLISHED ------------------------------
   `drawBowl` draws around its own origin, so "the bowl is standing on the
   floor" is a statement about these three offsets and nothing else. They
   used to be magic numbers inside the path below, which is how a bowl came
   to be positioned at chest height and nobody could say by how much it was
   floating (ARCHITECTURE §16.9). Anything that places a bowl, and anything
   that verifies where a bowl ended up, reads them from here.

   All three are in the bowl's own local units, before `s`:
     BOWL_BASE  the underside — the point that must touch the floor
     BOWL_WELL  the food/water surface — where a muzzle has to reach
     BOWL_TOP   the top of the rim plate — the highest drawn pixel
   ---------------------------------------------------------------------- */
export const BOWL_BASE = 18;
export const BOWL_WELL = -8;
export const BOWL_TOP = -17.5;

/* ---- THE BOWL IS DRAWN IN TWO PIECES, AND A HEAD GOES BETWEEN THEM ----
   A near-frontal bowl is not one sprite. The camera sees, front to back:

       the NEAR rim and the near outer wall     <- nearer than a muzzle in it
       the food / water surface                 <- the muzzle is IN this
       the far interior wall and the FAR rim    <- behind the muzzle

   Painted as one sprite after the dog — which is what stage 8 did — the food
   ellipse lands on top of the nose and he reads as standing BEHIND a full
   bowl rather than eating out of it. Every geometric assertion still passed,
   because the geometry was never wrong: the muzzle really was 18 units inside
   the bowl. Only the compositing was (ARCHITECTURE §19.2).

   So `layer` splits the SAME drawing, never a second copy of it:

     'back'   everything: shadow, vessel, interior, contents, far rim
     'front'  the same paint again, CLIPPED to the near region below —
              the near rim plus the outer wall under it, and nothing else
     'all'    one pass, for a bowl with nothing in front of it (the resting
              bowls by the wall, a bowl in her hand mid-drag)

   'front' re-paints rather than drawing its own shape, so the two layers
   cannot drift apart and there is no seam to antialias: within the clip the
   pixels are the ones 'all' would have produced. The one thing it must skip
   is the contact shadow, which is translucent and would double-darken.
   ---------------------------------------------------------------------- */
/* ---- HOW WIDE THE VESSEL IS, AND WHY IT IS NOT 1 (§19.7) --------------
   A DOG'S BOWL IS WIDER THAN THE DOG'S FACE. This one was not, and that is
   the fourth defect the human found on his phone: "the chin of the dog goes
   through the bowl and shows out underneath it as well".

   The vessel's DEPTH is not free. `solveEatGeometry` pins its base to the
   floor and its food surface to his muzzle, so the drawn distance between
   those two is whatever this dog's stoop makes it — about 36-43 virtual
   units — whatever numbers are written here. Its WIDTH is free, and it is
   the only thing that is: SPREAD multiplies every x in the drawing and
   nothing else, so it cannot move the base off the floor, cannot change the
   solved scale, and cannot change the food surface's height. That is the
   whole reason the fix is on this axis.

   Measured, at the deepest drink frame, in the vessel's own units
   (`C:\tmp\ppchin\deep.py`): his face reaches out to |x| = 52 (Shiba), 49
   (Cockapoo) and 41 (Schnoodle) below the near lip, against a vessel that
   stopped at 30. Below the lip line it therefore came out past the rim on
   both sides with nothing to hide behind — not drawn in front of the near
   wall, but outside the region the near wall can ever cover. Widening is the
   only answer to that; a bigger 'front' layer cannot cover ground the vessel
   does not stand on.

   Sized by rendering, not by arithmetic. Swept at 1.0 / 1.25 / 1.40 / 1.45 /
   1.55 / 1.75 / 2.10 with the new gate reading every frame and the crop
   looked at each time: 1.75 reaches zero on its own but the vessel stops
   reading as a bowl and starts reading as a canoe, and it buries his front
   paws. 1.55 with the foot below, and with the smaller stoop §19.7 also
   makes, is clear on all three breeds and still sits inside his paws.
   See ARCHITECTURE §19.7.
   ---------------------------------------------------------------------- */
const SPREAD = (typeof globalThis !== 'undefined' && +globalThis.__ppSpread) || 1.55;
const RIM_RX = 30 * SPREAD, RIM_CY = -8, RIM_RY = 9.5;
const WELL_RX = 24.5 * SPREAD, WELL_CY = -7, WELL_RY = 7;
/** every authored x in the vessel's art goes through here */
const SX = (x) => x * SPREAD;

/* ---- THE VESSEL HAS A FOOT, AND THAT IS HALF THE FIX (§19.7) ----------
   The wall used to run in one curve from each rim tip to a single lowest
   POINT at x = 0 — the silhouette of a funnel, not of a bowl. Two things
   followed from it, and both were visible:

     * at the rim tips the vessel had ZERO height, so the near wall had
       nothing to occlude with exactly where his cheeks crossed it. Widening
       alone left two sharp magenta slivers in the gate's mask, at the tips,
       on every breed — the tips move outwards but they stay points.
     * widened, a pointed lens stops reading as a bowl and starts reading as
       a canoe.

   A bowl of revolution standing on a floor has a BASE OF SOME WIDTH, and its
   silhouette between the rim and that base is a wall of real height at every
   x it covers. That is what this draws now, and `BOWL_BASE` still means what
   it meant: the underside ellipse's lowest point, the pixel that touches the
   floor, unmoved at 18.
   ---------------------------------------------------------------------- */
const FOOT_RX = RIM_RX * 0.54, FOOT_RY = 3.2;
const FOOT_CY = BOWL_BASE - FOOT_RY;

/** the outer vessel wall below the rim plate — the bowl's silhouette */
function bowlBodyPath(c) {
  c.moveTo(-RIM_RX, RIM_CY);
  c.bezierCurveTo(-RIM_RX * 0.96, 3, -FOOT_RX * 1.34, 12.4, -FOOT_RX, FOOT_CY);
  /* the underside, through its lowest point at BOWL_BASE */
  c.ellipse(0, FOOT_CY, FOOT_RX, FOOT_RY, 0, Math.PI, 0, true);
  c.bezierCurveTo(FOOT_RX * 1.34, 12.4, RIM_RX * 0.96, 3, RIM_RX, RIM_CY);
}

/**
 * THE NEAR HALF OF THE VESSEL: everything between the well's near lip and the
 * base. This is the piece that has to be in front of a muzzle dipped into the
 * bowl, and it is the only piece that does.
 *
 * Bounded below by the body silhouette and above by the well's near arc, with
 * the rim plate's two tips closed off by the short chords out to ±RIM_RX. The
 * arc is the line that crosses the muzzle; without it the nose has nothing to
 * disappear behind and no amount of depth in the numbers will read.
 */
export function bowlNearPath(c) {
  c.beginPath();
  bowlBodyPath(c);
  c.lineTo(WELL_RX, WELL_CY);
  c.ellipse(0, WELL_CY, WELL_RX, WELL_RY, 0, 0, Math.PI, false);
  c.lineTo(-RIM_RX, RIM_CY);
  c.closePath();
}

/**
 * BELOW THE NEAR LIP: the half-plane-ish region under the well's near arc,
 * extended sideways past the vessel and downwards past its base.
 *
 * This is the region in which NOTHING OF HIS MUZZLE MAY SHOW. Above the near
 * lip his face is legitimately in the open air over the bowl; the moment it
 * crosses that arc it is meant to be inside the vessel, and the vessel — near
 * wall or far wall — is what the eye must see instead. §19.7's defect was
 * exactly this and only this: his jaw was wider than the arc, so past ±WELL_RX
 * it came out below the line into open floor, and the near wall could never
 * have covered it because the near wall does not extend that far.
 *
 * Published, like `bowlNearPath` and `bowlSilhouette`, so `tools/bowlpixels.py`
 * asks props.js where the line is rather than re-deriving an ellipse and then
 * agreeing with itself. `reach` is how far past the vessel to carry the line;
 * the default covers any muzzle the three breeds can present.
 */
export function bowlBelowLipPath(c, reach = 400) {
  c.beginPath();
  c.moveTo(-reach, WELL_CY);
  c.lineTo(-WELL_RX, WELL_CY);
  /* the near (lower) arc, right to left, so the region below it is enclosed */
  c.ellipse(0, WELL_CY, WELL_RX, WELL_RY, 0, Math.PI, 0, true);
  c.lineTo(reach, WELL_CY);
  c.lineTo(reach, reach); c.lineTo(-reach, reach);
  c.closePath();
}

/**
 * INSIDE THE BOWL: the whole vessel's fully-opaque footprint, FILLED in the
 * current style (two fills, because the rim plate and the outer wall overlap
 * and one nonzero-wound path would cancel in the overlap).
 *
 * Published for the same reason BOWL_BASE/WELL/TOP are: a verifier that wants
 * to ask "is this device pixel inside the bowl?" must not re-derive the shape.
 * `tools/bowlpixels.py` rasterises this under drawBowl's own transform and
 * asserts that no pixel of his TORSO survives anywhere inside it — the check
 * that no amount of geometry could make, and the one that would have caught
 * §19.2's seam before it reached a phone.
 *
 * It deliberately excludes the contact shadow, which is translucent: the floor
 * legitimately shows through that, so it is not "inside the bowl".
 */
export function bowlSilhouette(c) {
  c.beginPath(); bowlBodyPath(c); c.closePath(); c.fill();
  c.beginPath(); c.ellipse(0, RIM_CY, RIM_RX, RIM_RY, 0, 0, TAU); c.fill();
}

/**
 * A dog bowl.
 * @param kind  'food' | 'water'
 * @param fill  0..1 contents
 * @param t     seconds, for the water surface wobble
 * @param ripple 0..1 recent disturbance (a lap, a poured stream)
 * @param layer 'all' | 'back' | 'front'  (see the note above)
 */
export function drawBowl(c, bx, by, s, kind, fill = 0, t = 0, ripple = 0, layer = 'all') {
  const water = kind === 'water';
  const front = layer === 'front';
  c.save();
  c.translate(bx, by);
  c.scale(s, s);
  if (front) { bowlNearPath(c); c.clip(); }

  /* the contact shadow is translucent, so the front pass must not lay a
     second copy of it over the back pass's */
  if (!front) {
    /* the contact shadow hugs the FOOT now, not the old pointed underside */
    c.fillStyle = PC.shadow; ell(c, SX(2), BOWL_BASE - 1.5, FOOT_RX * 1.30, 5.0); c.fill();
  }

  const g = c.createLinearGradient(SX(-30), -14, SX(30), 14);
  g.addColorStop(0, water ? PC.tealL : PC.clayL);
  g.addColorStop(0.5, water ? PC.teal : PC.clay);
  g.addColorStop(1, water ? PC.tealD : PC.clayD);
  c.fillStyle = g;
  c.beginPath(); bowlBodyPath(c); c.closePath(); c.fill();

  /* the inner well */
  c.fillStyle = water ? '#f0f2e6' : PC.cream; ell(c, 0, RIM_CY, RIM_RX, RIM_RY); c.fill();
  c.fillStyle = water ? PC.tealD : '#a97141'; ell(c, 0, WELL_CY, WELL_RX, WELL_RY); c.fill();

  const f = clamp(fill, 0, 1);
  /* the contents live inside the well, which is entirely behind the near lip:
     the front pass would only be re-laying translucent highlights on the clip
     edge, so it skips them */
  if (f > 0.01 && !front) {
    c.save();
    ell(c, 0, WELL_CY, WELL_RX, WELL_RY); c.clip();
    if (water) {
      /* the surface sits higher as the bowl fills, and wobbles */
      const surf = lerp(1.5, -7.5, f);
      const wob = Math.sin(t * 5.1) * (0.5 + ripple * 1.9);
      const wg = c.createLinearGradient(0, surf - 6, 0, 4);
      wg.addColorStop(0, PC.waterL); wg.addColorStop(0.5, PC.water); wg.addColorStop(1, PC.waterD);
      c.fillStyle = wg;
      c.beginPath();
      c.moveTo(SX(-26), surf + wob);
      c.bezierCurveTo(SX(-9), surf - 1.6 - wob, SX(9), surf + 1.6 + wob, SX(26), surf - wob);
      c.lineTo(SX(26), 12); c.lineTo(SX(-26), 12); c.closePath(); c.fill();
      /* specular band + a ring or two from the last disturbance */
      c.fillStyle = 'rgba(255,255,255,0.55)';
      ell(c, SX(-8), surf + 0.6, SX(8) * (0.7 + f * 0.5), 1.7, -0.12); c.fill();
      ell(c, SX(9), surf + 2.2, SX(4.6), 1.2, 0.16); c.fill();
      if (ripple > 0.02) {
        c.strokeStyle = `rgba(255,255,255,${(0.5 * ripple).toFixed(3)})`;
        c.lineWidth = 1.1;
        for (let i = 0; i < 2; i++) {
          const rr = 5 + (1 - ripple) * 15 + i * 7;
          c.beginPath(); c.ellipse(0, surf + 2, SX(rr), rr * 0.30, 0, 0, TAU); c.stroke();
        }
      }
    } else {
      /* kibble piles up from the bottom: reveal pieces in a stable order.
         SPREAD WIDE, not heaped in the middle. Once the food moved behind him
         (§19) his muzzle covers the centre of the well, so a mound pooled at
         x=0 reads as an empty bowl the moment he puts his head in it. The
         spread runs out to the well's own edge instead — it is clipped to the
         well either way, and it can no longer end up over his nose, because
         this whole block is now painted before he is. */
      const n = Math.round(f * KIBBLE.length);
      const wide = SPREAD * (1.12 + f * 0.10);
      c.fillStyle = PC.kibbleD;
      ell(c, 0, lerp(2, -8, f), SX(23.4) * (0.60 + f * 0.40), 6.4 * (0.5 + f * 0.5)); c.fill();
      for (let i = 0; i < n; i++) {
        const k = KIBBLE[i];
        c.fillStyle = PC.kibble;
        ell(c, k[0] * wide, k[1] * f + (1 - f) * 2, k[2], k[2] * 0.78, i * 0.7); c.fill();
      }
      c.fillStyle = PC.kibbleL;
      for (let i = 0; i < n; i += 3) {
        const k = KIBBLE[i];
        ell(c, k[0] * wide - 1, k[1] * f + (1 - f) * 2 - 1.4, k[2] * 0.36, k[2] * 0.26, 0); c.fill();
      }
    }
    c.restore();
  }

  /* THE FAR RIM's highlight — behind anything dipped into the bowl */
  if (!front) {
    c.strokeStyle = 'rgba(255,255,255,0.45)'; c.lineWidth = 1.6;
    c.beginPath();
    c.ellipse(0, RIM_CY, RIM_RX, RIM_RY, 0, Math.PI * 1.05, Math.PI * 1.85);
    c.stroke();
  }
  /* THE NEAR LIP — the edge a muzzle disappears behind. Drawn once, by
     whichever pass is the frontmost one, so the translucent line is never
     laid down twice. */
  if (layer !== 'back') {
    c.strokeStyle = 'rgba(104,58,32,0.22)'; c.lineWidth = 1.5;
    c.beginPath();
    c.ellipse(0, WELL_CY, WELL_RX, WELL_RY, 0, Math.PI * 0.08, Math.PI * 0.92);
    c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.30)'; c.lineWidth = 1.1;
    c.beginPath();
    c.ellipse(0, RIM_CY + 0.6, RIM_RX - SX(1), RIM_RY - 1, 0, Math.PI * 0.12, Math.PI * 0.88);
    c.stroke();
  }
  c.restore();
}

/** The kibble sack. `tip` 0..1 rotates it mouth-down so it pours. */
export function drawSack(c, x, y, s, tip = 0) {
  c.save();
  c.translate(x, y);
  c.rotate(tip * 2.05);
  c.scale(s, s);
  c.fillStyle = PC.shadow; ell(c, 3, 26, 20, 6); c.fill();
  const g = c.createLinearGradient(-18, -26, 18, 26);
  g.addColorStop(0, '#f0e0c0'); g.addColorStop(0.5, PC.sack); g.addColorStop(1, PC.sackD);
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(-15, -22);
  c.quadraticCurveTo(-20, 4, -14, 24);
  c.quadraticCurveTo(0, 29, 14, 24);
  c.quadraticCurveTo(20, 4, 15, -22);
  c.quadraticCurveTo(0, -27, -15, -22);
  c.closePath(); c.fill();
  /* folded-over neck */
  c.fillStyle = PC.sackD;
  roundRect(c, -15, -26, 30, 8, 3); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.35)';
  roundRect(c, -13, -25, 26, 2.4, 1.2); c.fill();
  /* band + a paw print, because it is a bag of dog food */
  c.fillStyle = PC.sackBand;
  roundRect(c, -16, -4, 32, 9, 2); c.fill();
  c.fillStyle = 'rgba(255,245,225,0.92)';
  ell(c, 0, 2.4, 3.0, 2.3); c.fill();
  for (let i = -1; i <= 1; i++) { ell(c, i * 3.0, -1.4, 1.15, 1.5, i * 0.3); c.fill(); }
  c.restore();
}

/** The watering jug. `tip` 0..1 rotates it spout-down. */
export function drawJug(c, x, y, s, tip = 0) {
  c.save();
  c.translate(x, y);
  c.rotate(-tip * 1.15);
  c.scale(s, s);
  c.fillStyle = PC.shadow; ell(c, 3, 22, 18, 5.5); c.fill();
  const g = c.createLinearGradient(-16, -20, 16, 22);
  g.addColorStop(0, PC.tealL); g.addColorStop(0.55, PC.teal); g.addColorStop(1, PC.tealD);
  /* handle */
  c.strokeStyle = PC.tealD; c.lineWidth = 4.6; c.lineCap = 'round';
  c.beginPath(); c.moveTo(-11, -8); c.quadraticCurveTo(-25, -2, -12, 12); c.stroke();
  /* spout */
  c.fillStyle = PC.tealD;
  c.beginPath();
  c.moveTo(10, -10); c.quadraticCurveTo(26, -12, 30, -19);
  c.lineTo(33, -14); c.quadraticCurveTo(27, -4, 12, -1);
  c.closePath(); c.fill();
  /* body */
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(-13, -14);
  c.quadraticCurveTo(-16, 6, -11, 20);
  c.quadraticCurveTo(0, 24, 11, 20);
  c.quadraticCurveTo(16, 6, 13, -14);
  c.quadraticCurveTo(0, -19, -13, -14);
  c.closePath(); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.30)';
  ell(c, -5, -4, 4.2, 10, -0.16); c.fill();
  c.fillStyle = '#f0f2e6';
  roundRect(c, -13, -18, 26, 5.5, 2.4); c.fill();
  c.restore();
}

/** The brush. Angled along the stroke, bristles trailing. */
export function drawBrush(c, x, y, s, ang, press = 0) {
  c.save();
  c.translate(x, y);
  c.rotate(ang);
  c.scale(s, s);
  c.fillStyle = 'rgba(104,58,32,0.22)';
  roundRect(c, -13, 4 + press * 1.5, 26, 7, 3.5); c.fill();
  /* bristles first, so the block sits on top of them */
  c.strokeStyle = PC.bristleD; c.lineWidth = 1.5; c.lineCap = 'round';
  for (let i = -4; i <= 4; i++) {
    const bx = i * 2.7;
    c.beginPath(); c.moveTo(bx, 1); c.lineTo(bx + i * 0.35, 8 + press * 2.2); c.stroke();
  }
  const g = c.createLinearGradient(0, -9, 0, 3);
  g.addColorStop(0, '#dda06d'); g.addColorStop(1, PC.woodD);
  c.fillStyle = g;
  roundRect(c, -13, -8, 26, 11, 4.5); c.fill();
  c.fillStyle = 'rgba(255,248,232,0.40)';
  roundRect(c, -11, -7, 22, 2.6, 1.3); c.fill();
  c.fillStyle = PC.bristle;
  roundRect(c, -12, 1.4, 24, 2.6, 1.3); c.fill();
  c.restore();
}

/** A bar of soap / shampoo bottle, for the wash stage dressing. */
export function drawSoap(c, x, y, s, squeeze = 0) {
  c.save();
  c.translate(x, y);
  c.scale(s * (1 + squeeze * 0.06), s * (1 - squeeze * 0.08));
  c.fillStyle = PC.shadow; ell(c, 2, 20, 13, 4.5); c.fill();
  const g = c.createLinearGradient(-10, -20, 10, 18);
  g.addColorStop(0, '#bfe3e8'); g.addColorStop(0.55, '#8fc4ce'); g.addColorStop(1, '#6ea6b3');
  c.fillStyle = g;
  roundRect(c, -10, -14, 20, 32, 7); c.fill();
  c.fillStyle = '#f6f2e2';
  roundRect(c, -5, -21, 10, 8, 3); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.42)';
  roundRect(c, -7.5, -10, 5, 20, 2.5); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.85)';
  ell(c, 0, 4, 6.5, 5); c.fill();
  c.fillStyle = '#8fc4ce';
  ell(c, 0, 4, 4.4, 3.4); c.fill();
  c.restore();
}

/**
 * The ball toy. `spin` rotates the stripes; `s` fakes distance.
 *
 * `variant` (stage 4) is which fetch toy he currently has — the thing he
 * brought home from a walk becomes the thing he fetches, which is what makes a
 * find a real unlock rather than a line of text. Unknown variants fall back to
 * the ball, so an older save (or a future find) can never draw nothing.
 */
export function drawBall(c, bx, by, s, spin = 0, shadowAt, variant) {
  const v = variant && variant !== 'ball' ? variant : '';
  if (shadowAt !== undefined) {
    c.fillStyle = `rgba(104,58,32,${(0.22 * clamp(s, 0.2, 1)).toFixed(3)})`;
    ell(c, bx + 2, shadowAt, 16 * s, 5 * s); c.fill();
  }
  c.save();
  c.translate(bx, by);
  c.scale(s, s);
  c.rotate(spin);
  if (v === 'stick') { stickShape(c, 1.35); c.restore(); return; }
  if (v === 'pinecone') { coneShape(c, 1.30); c.restore(); return; }
  if (v === 'tennis') {
    const tg = c.createRadialGradient(-6, -7, 2, 0, 0, 20);
    tg.addColorStop(0, '#e8f59a'); tg.addColorStop(0.5, '#cbe062'); tg.addColorStop(1, '#9ab73c');
    c.fillStyle = tg; ell(c, 0, 0, 16, 16); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.86)'; c.lineWidth = 2.1;
    c.beginPath(); c.arc(-13, 0, 15, -0.95, 0.95); c.stroke();
    c.beginPath(); c.arc(13, 0, 15, Math.PI - 0.95, Math.PI + 0.95); c.stroke();
    c.strokeStyle = 'rgba(96,116,40,0.42)'; c.lineWidth = 1.5; ell(c, 0, 0, 16, 16); c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.5)'; ell(c, -6, -7, 4.4, 3.0, -0.6); c.fill();
    c.restore(); return;
  }
  if (v === 'squeaky') { duckShape(c, 1.15); c.restore(); return; }
  const g = c.createRadialGradient(-6, -7, 2, 0, 0, 20);
  g.addColorStop(0, '#f7f0dd'); g.addColorStop(0.42, '#e8dcc0'); g.addColorStop(1, '#c9b28c');
  c.fillStyle = g; ell(c, 0, 0, 16, 16); c.fill();
  c.save(); ell(c, 0, 0, 16, 16); c.clip();
  c.fillStyle = '#cf6e58';
  c.beginPath(); c.moveTo(-18, -4); c.quadraticCurveTo(0, -11, 18, -4);
  c.lineTo(18, 4); c.quadraticCurveTo(0, -3, -18, 4); c.closePath(); c.fill();
  c.fillStyle = PC.teal;
  c.beginPath(); c.moveTo(-18, 8); c.quadraticCurveTo(0, 1, 18, 8);
  c.lineTo(18, 13); c.quadraticCurveTo(0, 6, -18, 13); c.closePath(); c.fill();
  c.restore();
  c.strokeStyle = 'rgba(124,74,47,0.38)'; c.lineWidth = 1.6; ell(c, 0, 0, 16, 16); c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.6)'; ell(c, -6, -7, 4.6, 3.2, -0.6); c.fill();
  c.restore();
}

/* ==========================================================================
   STAGE 4 — the leash, the finds, and the paw-print trail.

   All ART, not design tunables (ARCHITECTURE §11 G): the geometry and colour
   ramps are here, the numbers a designer would turn are in BALANCE.walk.
   ========================================================================== */
export const WC = {
  strap: '#c25b46', strapD: '#9c4032', strapL: '#e08067',
  brass: '#e0b25c', brassD: '#a97f33', brassL: '#f6dda0',
  stitch: 'rgba(255,240,214,0.72)',
  paper: '#fdf3df', paperSh: '#e6d2ac', ink: '#6b3a24',
  leaf: '#7f9f74', leafD: '#5f7d57', stem: '#84a179',
  petal: '#fdf6e6', yolk: '#f0c355', bluebell: '#8b93cf',
  bark: '#a8763f', barkD: '#7d5527',
  stone: '#b7b0a2', stoneD: '#8e887c', stoneL: '#dad4c6',
  wool: '#cf6e58', woolD: '#a94d3c',
  photo: '#fffaf0',
};

/** a wobbly hand-drawn line: the whole charm of the map beat */
export function inkLine(c, pts, wob = 0, ph = 0) {
  if (!pts.length) return;
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const w = wob ? Math.sin(i * 1.7 + ph) * wob : 0;
    const w2 = wob ? Math.cos(i * 2.3 + ph * 1.3) * wob : 0;
    c.lineTo(pts[i][0] + w, pts[i][1] + w2);
  }
}

/**
 * THE LEASH — the object the whole prepare beat is about.
 *
 * `(cx, cy)` is the CLIP end, i.e. the thing under her finger. The strap trails
 * up and off the top of the frame, so it reads as hanging from her hand rather
 * than floating: there is no arm to draw and none is needed.
 */
export function drawLeash(c, cx, cy, s, anchorX, sway = 0, t = 0, glow = 0) {
  c.save();
  /* the strap: two control points so it hangs with real slack */
  const ax = anchorX + sway * 10;
  const midX = (ax + cx) / 2 + sway * 26 + Math.sin(t * 1.7) * 3;
  const midY = (cy - 40) * 0.52 + 28;
  const strap = (col, w) => {
    c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round';
    c.beginPath();
    c.moveTo(ax, -46);
    c.bezierCurveTo(ax + sway * 12, midY * 0.5, midX, midY, cx, cy - 12 * s);
    c.stroke();
  };
  strap('rgba(104,58,32,0.20)', 9.5 * s);
  strap(WC.strapD, 7.4 * s);
  strap(WC.strap, 5.4 * s);
  c.setLineDash([4.5 * s, 5 * s]);
  strap(WC.stitch, 1.1 * s);
  c.setLineDash([]);

  /* a soft halo while it is the live thing to drag */
  if (glow > 0.01) {
    const gr = c.createRadialGradient(cx, cy, 2, cx, cy, 46 * s);
    gr.addColorStop(0, `rgba(255,246,214,${(0.34 * glow).toFixed(3)})`);
    gr.addColorStop(1, 'rgba(255,246,214,0)');
    c.fillStyle = gr;
    c.beginPath(); c.arc(cx, cy, 46 * s, 0, TAU); c.fill();
  }

  c.translate(cx, cy);
  c.scale(s, s);
  c.rotate(sway * 0.30);
  /* the collar: a soft loop, so what she is holding reads as "for the dog" */
  c.strokeStyle = WC.strapD; c.lineWidth = 6.2;
  c.beginPath(); c.ellipse(0, 8, 13, 9.5, 0, 0, TAU); c.stroke();
  c.strokeStyle = WC.strap; c.lineWidth = 4.2;
  c.beginPath(); c.ellipse(0, 8, 13, 9.5, 0, 0, TAU); c.stroke();
  c.strokeStyle = WC.strapL; c.lineWidth = 1.3;
  c.beginPath(); c.ellipse(0, 6.6, 12, 8.4, 0, Math.PI * 1.05, Math.PI * 1.9); c.stroke();
  /* the brass clip */
  const bg = c.createLinearGradient(-5, -14, 5, 4);
  bg.addColorStop(0, WC.brassL); bg.addColorStop(0.55, WC.brass); bg.addColorStop(1, WC.brassD);
  c.fillStyle = bg;
  roundRect(c, -3.6, -15, 7.2, 15, 3); c.fill();
  c.strokeStyle = WC.brassD; c.lineWidth = 2.2;
  c.beginPath(); c.arc(0, -1.5, 5.4, Math.PI * 0.15, Math.PI * 0.9, true); c.stroke();
  c.fillStyle = WC.brassL; roundRect(c, -2.4, -13.6, 2.0, 10, 1); c.fill();
  /* a little name tag, because it is HIS leash */
  c.fillStyle = WC.brass; ell(c, 7.5, 13, 4.6, 5.2, 0.2); c.fill();
  c.fillStyle = WC.brassL; ell(c, 6.6, 11.6, 2.0, 2.2, 0.2); c.fill();
  c.restore();
}

/** the collar he wears once it is clipped on */
export function drawCollar(c, x, y, hw, s) {
  c.save();
  c.translate(x, y);
  c.strokeStyle = WC.strapD; c.lineWidth = 5.6 * s; c.lineCap = 'round';
  c.beginPath(); c.ellipse(0, 0, hw, hw * 0.30, 0, 0.10, Math.PI - 0.10); c.stroke();
  c.strokeStyle = WC.strap; c.lineWidth = 3.8 * s;
  c.beginPath(); c.ellipse(0, 0, hw, hw * 0.30, 0, 0.10, Math.PI - 0.10); c.stroke();
  c.fillStyle = WC.brass; ell(c, 0, hw * 0.30, 4.2 * s, 4.8 * s); c.fill();
  c.fillStyle = WC.brassL; ell(c, -0.8 * s, hw * 0.30 - 1.2 * s, 1.8 * s, 2.0 * s); c.fill();
  c.restore();
}

/* ---- the finds ---------------------------------------------------------
   One small icon each, drawn not fonted. They have to be recognisable at
   ~24px in his mouth and at ~16px on the shelf, so every one of them is a
   silhouette first and detail second (research §7: "recognisable in
   silhouette from across the room").
   -------------------------------------------------------------------- */
function stemFlower(c, petal, centre, n = 6, pr = 6.2) {
  c.strokeStyle = WC.stem; c.lineWidth = 2.0; c.lineCap = 'round';
  c.beginPath(); c.moveTo(1, 14); c.quadraticCurveTo(-2, 6, 0, -1); c.stroke();
  c.fillStyle = WC.leaf;
  ell(c, -5, 7, 4.6, 2.4, -0.5); c.fill();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    c.fillStyle = petal;
    ell(c, Math.cos(a) * 5.4, Math.sin(a) * 5.4 - 2, pr * 0.62, pr * 0.42, a); c.fill();
  }
  c.fillStyle = centre; ell(c, 0, -2, 3.4, 3.2); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.5)'; ell(c, -1, -3, 1.4, 1.2); c.fill();
}
function stickShape(c, k = 1) {
  c.save(); c.scale(k, k); c.rotate(-0.32);
  c.strokeStyle = WC.barkD; c.lineWidth = 5.4; c.lineCap = 'round';
  c.beginPath(); c.moveTo(-14, 3); c.quadraticCurveTo(0, -2, 14, 1); c.stroke();
  c.strokeStyle = WC.bark; c.lineWidth = 3.4;
  c.beginPath(); c.moveTo(-14, 3); c.quadraticCurveTo(0, -2, 14, 1); c.stroke();
  c.strokeStyle = WC.barkD; c.lineWidth = 2.6;
  c.beginPath(); c.moveTo(4, 0); c.lineTo(11, -7); c.stroke();
  c.beginPath(); c.moveTo(-6, 1); c.lineTo(-11, -5); c.stroke();
  c.strokeStyle = 'rgba(255,240,214,0.34)'; c.lineWidth = 1.0;
  c.beginPath(); c.moveTo(-12, 1.6); c.quadraticCurveTo(0, -3.2, 12, 0); c.stroke();
  c.restore();
}
function coneShape(c, k = 1) {
  c.save(); c.scale(k, k);
  c.fillStyle = WC.barkD;
  c.beginPath(); c.ellipse(0, 1, 7.4, 11, 0, 0, TAU); c.fill();
  for (let r = 0; r < 5; r++) {
    for (let q = -1; q <= 1; q++) {
      const y = -8 + r * 4.2;
      const x = q * (5.2 - r * 0.4) + (r % 2 ? 1.8 : 0);
      c.fillStyle = r % 2 ? WC.bark : '#946233';
      ell(c, x, y, 3.0 - r * 0.15, 2.2, 0); c.fill();
    }
  }
  c.fillStyle = 'rgba(255,240,214,0.26)'; ell(c, -3, -6, 2.2, 1.6, -0.4); c.fill();
  c.restore();
}
function duckShape(c, k = 1) {
  c.save(); c.scale(k, k);
  c.fillStyle = '#e8b93f';
  ell(c, 1, 5, 11, 8.4); c.fill();
  ell(c, -6, -4, 6.6, 6.2); c.fill();
  c.fillStyle = '#f2cf6e'; ell(c, -7, -6, 3.2, 2.6, -0.4); c.fill();
  c.fillStyle = '#e0784a';
  c.beginPath(); c.moveTo(-11, -3.4); c.quadraticCurveTo(-18, -2.2, -16, 0.6);
  c.quadraticCurveTo(-13, 0.4, -10, -0.6); c.closePath(); c.fill();
  c.fillStyle = '#4a352a'; ell(c, -7.4, -5.6, 1.2, 1.4); c.fill();
  c.fillStyle = '#d9a72f';
  c.beginPath(); c.moveTo(4, 2); c.quadraticCurveTo(12, -1, 11, 6); c.quadraticCurveTo(7, 6, 4, 4); c.closePath(); c.fill();
  c.restore();
}
function photoShape(c, coat, ear, k = 1) {
  c.save(); c.scale(k, k);
  c.fillStyle = 'rgba(104,58,32,0.20)'; roundRect(c, -9, -10, 20, 24, 2); c.fill();
  c.fillStyle = WC.photo; roundRect(c, -11, -12, 22, 26, 2); c.fill();
  c.save();
  roundRect(c, -8.5, -9.5, 17, 17, 1.4); c.clip();
  const sky = c.createLinearGradient(0, -10, 0, 8);
  sky.addColorStop(0, '#cfe4dd'); sky.addColorStop(1, '#e9dcbe');
  c.fillStyle = sky; c.fillRect(-9, -10, 18, 18);
  /* the dog he met: a silhouette, facing out, because that is the joke */
  c.fillStyle = coat;
  ell(c, 0.5, 5, 5.6, 4.4); c.fill();
  ell(c, 0.5, -1.4, 4.2, 3.9); c.fill();
  if (ear === 'floppy') {
    ell(c, -4.0, -0.6, 2.0, 3.4, 0.25); c.fill();
    ell(c, 5.0, -0.6, 2.0, 3.4, -0.25); c.fill();
  } else if (ear === 'long') {
    ell(c, -4.2, 1.2, 2.2, 4.6, 0.16); c.fill();
    ell(c, 5.2, 1.2, 2.2, 4.6, -0.16); c.fill();
  } else {
    c.beginPath(); c.moveTo(-4.2, -3.0); c.lineTo(-2.4, -7.2); c.lineTo(-0.6, -3.4); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(4.8, -3.0); c.lineTo(3.2, -7.2); c.lineTo(1.4, -3.4); c.closePath(); c.fill();
  }
  c.fillStyle = 'rgba(255,255,255,0.85)';
  ell(c, -1.4, -1.8, 0.9, 1.0); c.fill(); ell(c, 2.4, -1.8, 0.9, 1.0); c.fill();
  c.restore();
  c.strokeStyle = 'rgba(124,74,47,0.22)'; c.lineWidth = 0.8;
  roundRect(c, -8.5, -9.5, 17, 17, 1.4); c.stroke();
  c.restore();
}

/**
 * A found thing. `id` is a BALANCE.walk.finds entry; anything unknown draws a
 * small wrapped parcel rather than nothing, so a future find can never render
 * as an invisible reward.
 */
export function drawFind(c, id, x, y, s = 1, t = 0) {
  c.save();
  c.translate(x, y);
  c.scale(s, s);
  switch (id) {
    case 'daisy': stemFlower(c, WC.petal, WC.yolk, 7, 7.0); break;
    case 'buttercup': stemFlower(c, '#f7d264', '#b98a2c', 5, 6.6); break;
    case 'bluebell': {
      c.strokeStyle = WC.stem; c.lineWidth = 2.0; c.lineCap = 'round';
      c.beginPath(); c.moveTo(2, 14); c.quadraticCurveTo(-1, 4, -2, -8); c.stroke();
      for (let i = 0; i < 4; i++) {
        const by = -6 + i * 4.6, bx = -2 + (i % 2 ? 4.2 : -3.4);
        c.fillStyle = i % 2 ? WC.bluebell : '#7b83c0';
        c.beginPath();
        c.moveTo(bx, by); c.quadraticCurveTo(bx + 3.4, by + 2, bx + 1.6, by + 5.4);
        c.quadraticCurveTo(bx - 1.2, by + 6.4, bx - 2.6, by + 4.2);
        c.quadraticCurveTo(bx - 3.0, by + 1.4, bx, by); c.closePath(); c.fill();
      }
      break;
    }
    case 'stick': stickShape(c); break;
    case 'pinecone': coneShape(c); break;
    case 'tennis': {
      const tg = c.createRadialGradient(-3, -4, 1, 0, 0, 11);
      tg.addColorStop(0, '#e8f59a'); tg.addColorStop(0.5, '#cbe062'); tg.addColorStop(1, '#9ab73c');
      c.fillStyle = tg; ell(c, 0, 1, 9.6, 9.6); c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.86)'; c.lineWidth = 1.5;
      c.beginPath(); c.arc(-8, 1, 9, -0.95, 0.95); c.stroke();
      c.beginPath(); c.arc(8, 1, 9, Math.PI - 0.95, Math.PI + 0.95); c.stroke();
      break;
    }
    case 'squeaky': duckShape(c); break;
    case 'pebble': {
      c.fillStyle = 'rgba(104,58,32,0.18)'; ell(c, 1, 9, 9, 3); c.fill();
      const pg = c.createLinearGradient(-8, -6, 8, 8);
      pg.addColorStop(0, WC.stoneL); pg.addColorStop(0.55, WC.stone); pg.addColorStop(1, WC.stoneD);
      c.fillStyle = pg;
      c.beginPath();
      c.moveTo(-9, 1); c.quadraticCurveTo(-8, -7, 1, -7.4);
      c.quadraticCurveTo(9.4, -7, 9, 1.6); c.quadraticCurveTo(6, 7.4, -1, 7.2);
      c.quadraticCurveTo(-8, 6.6, -9, 1); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.42)'; c.lineWidth = 1.1;
      c.beginPath(); c.moveTo(-6, -2.4); c.quadraticCurveTo(0, -5.6, 6, -2.6); c.stroke();
      break;
    }
    case 'feather': {
      c.save(); c.rotate(-0.42);
      c.fillStyle = '#f3ead5';
      c.beginPath();
      c.moveTo(0, -13); c.quadraticCurveTo(7.4, -2, 1.4, 12);
      c.quadraticCurveTo(-6.4, -1, 0, -13); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(146,120,90,0.6)'; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(0, -13); c.quadraticCurveTo(2, 0, 1.4, 13); c.stroke();
      c.strokeStyle = 'rgba(146,120,90,0.30)'; c.lineWidth = 0.7;
      for (let i = 0; i < 6; i++) {
        const yy = -10 + i * 3.6;
        c.beginPath(); c.moveTo(0.6, yy); c.lineTo(-3.6 + i * 0.5, yy + 2.6); c.stroke();
        c.beginPath(); c.moveTo(1.0, yy); c.lineTo(4.8 - i * 0.5, yy + 2.6); c.stroke();
      }
      c.restore();
      break;
    }
    case 'conker': {
      c.fillStyle = 'rgba(104,58,32,0.18)'; ell(c, 1, 9, 8, 2.8); c.fill();
      const cg = c.createRadialGradient(-3, -4, 1, 0, 0, 11);
      cg.addColorStop(0, '#a4602c'); cg.addColorStop(0.6, '#7c421c'); cg.addColorStop(1, '#5a2d12');
      c.fillStyle = cg; ell(c, 0, 1, 9, 8.6); c.fill();
      c.fillStyle = '#e6d3ae'; ell(c, -0.6, 4.4, 4.0, 3.0); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.42)'; ell(c, -3.6, -3.4, 2.6, 1.8, -0.5); c.fill();
      break;
    }
    case 'glove': {
      c.fillStyle = WC.woolD;
      roundRect(c, -7, -2, 14, 15, 5); c.fill();
      roundRect(c, -7, -9, 14, 9, 4.5); c.fill();
      c.fillStyle = WC.wool;
      roundRect(c, -6, -8, 12, 18, 4.5); c.fill();
      c.fillStyle = WC.woolD; roundRect(c, -6, 8, 12, 4.4, 2.2); c.fill();
      /* the thumb */
      c.fillStyle = WC.wool;
      c.save(); c.rotate(-0.5); roundRect(c, -11, -3, 5.6, 9, 2.8); c.fill(); c.restore();
      c.strokeStyle = 'rgba(255,240,214,0.34)'; c.lineWidth = 0.9;
      for (let i = 0; i < 3; i++) {
        c.beginPath(); c.moveTo(-5, -4 + i * 4.4); c.lineTo(5, -5 + i * 4.4); c.stroke();
      }
      break;
    }
    case 'bell': {
      const bg2 = c.createLinearGradient(-8, -9, 8, 9);
      bg2.addColorStop(0, WC.brassL); bg2.addColorStop(0.5, WC.brass); bg2.addColorStop(1, WC.brassD);
      c.fillStyle = bg2;
      c.beginPath();
      c.moveTo(-8.4, 6); c.quadraticCurveTo(-8, -8, 0, -9.4);
      c.quadraticCurveTo(8, -8, 8.4, 6); c.closePath(); c.fill();
      c.fillStyle = WC.brassD; roundRect(c, -9.4, 5, 18.8, 4.2, 2.1); c.fill();
      c.fillStyle = '#6b4a14'; ell(c, 0, 9.6, 2.4, 2.4); c.fill();
      c.strokeStyle = WC.brassD; c.lineWidth = 1.6;
      c.beginPath(); c.arc(0, -10.4, 3.0, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.5)'; ell(c, -3.4, -3.4, 1.8, 3.4, -0.2); c.fill();
      break;
    }
    case 'ribbon': {
      const rw = 0.5 + 0.5 * Math.sin(t * 2.1);
      c.fillStyle = '#cf6e58';
      c.beginPath();
      c.moveTo(0, 0); c.quadraticCurveTo(-11, -8 - rw, -12, 0);
      c.quadraticCurveTo(-11, 7 + rw, 0, 0); c.closePath(); c.fill();
      c.beginPath();
      c.moveTo(0, 0); c.quadraticCurveTo(11, -8 + rw, 12, 0);
      c.quadraticCurveTo(11, 7 - rw, 0, 0); c.closePath(); c.fill();
      c.fillStyle = '#b85a48';
      c.beginPath(); c.moveTo(-1.4, 1); c.quadraticCurveTo(-5, 9, -7.6, 13); c.lineTo(-3.4, 12); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(1.4, 1); c.quadraticCurveTo(5, 9, 7.6, 13); c.lineTo(3.4, 12); c.closePath(); c.fill();
      c.fillStyle = '#e08067'; ell(c, 0, 0, 3.2, 3.0); c.fill();
      break;
    }
    case 'metBeagle': photoShape(c, '#a97141', 'long'); break;
    case 'metPoodle': photoShape(c, '#6b5a4a', 'floppy'); break;
    case 'metSpaniel': photoShape(c, '#c98a52', 'floppy'); break;
    case 'metLurcher': photoShape(c, '#8a8378', 'prick'); break;
    default: {
      /* a wrapped parcel: an unknown find must still look like a present */
      c.fillStyle = 'rgba(104,58,32,0.18)'; ell(c, 1, 10, 9, 3); c.fill();
      c.fillStyle = PC.teal; roundRect(c, -8.5, -7, 17, 16, 3); c.fill();
      c.fillStyle = '#cf6e58'; c.fillRect(-2, -7, 4, 16);
      c.fillStyle = '#cf6e58'; c.fillRect(-8.5, -1, 17, 3.6);
      c.fillStyle = '#e08067'; ell(c, -3.2, -8.4, 3.6, 2.6, -0.4); c.fill();
      ell(c, 3.2, -8.4, 3.6, 2.6, 0.4); c.fill();
      break;
    }
  }
  c.restore();
}

/** a paw print, for the absence beat's trail */
export function drawPawPrint(c, x, y, s, rot = 0, alpha = 1) {
  c.save();
  c.globalAlpha = alpha;
  c.translate(x, y);
  c.rotate(rot);
  c.scale(s, s);
  c.fillStyle = 'rgba(120,72,44,0.55)';
  ell(c, 0, 1.6, 3.4, 2.9); c.fill();
  for (let i = -1; i <= 1; i++) {
    ell(c, i * 3.0, -2.4, 1.25, 1.55, i * 0.32); c.fill();
  }
  c.restore();
}

export function drawBone(c, bx, by, rot) {
  c.save(); c.translate(bx, by); c.rotate(rot);
  c.fillStyle = 'rgba(104,58,32,0.18)'; roundRect(c, -19, 3, 40, 8, 4); c.fill();
  c.fillStyle = '#f4e6cb';
  roundRect(c, -16, -4, 34, 9, 4.5); c.fill();
  ell(c, -16, -5, 7, 6); c.fill(); ell(c, -16, 3, 6.4, 5.6); c.fill();
  ell(c, 18, -5, 7, 6); c.fill(); ell(c, 18, 3, 6.4, 5.6); c.fill();
  c.strokeStyle = 'rgba(124,74,47,0.32)'; c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(-13, -8); c.quadraticCurveTo(-22, -9, -22, -3);
  c.quadraticCurveTo(-23, 4, -16, 4); c.stroke();
  c.fillStyle = 'rgba(210,180,140,0.5)'; roundRect(c, -8, 1.4, 20, 2.6, 1.3); c.fill();
  c.restore();
}

/**
 * The drag affordance: a soft pulsing ring that says "put it here" without a
 * word of UI. `hot` 0..1 is how close the dragged prop is to snapping.
 */
export function drawDropRing(c, x, y, r, t, hot = 0, alpha = 1) {
  const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
  c.save();
  c.globalAlpha = alpha * (0.30 + pulse * 0.22 + hot * 0.34);
  c.strokeStyle = '#fff2c8';
  c.lineWidth = 2.0 + hot * 1.6;
  c.setLineDash([7, 6]);
  c.lineDashOffset = -t * 14;
  c.beginPath(); c.ellipse(x, y, r * (1 + hot * 0.06), r * 0.36 * (1 + hot * 0.06), 0, 0, TAU); c.stroke();
  c.setLineDash([]);
  c.globalAlpha = alpha * (0.10 + hot * 0.16);
  const g = c.createRadialGradient(x, y, 2, x, y, r);
  g.addColorStop(0, 'rgba(255,244,205,0.9)');
  g.addColorStop(1, 'rgba(255,244,205,0)');
  c.fillStyle = g;
  c.save(); c.translate(x, y); c.scale(1, 0.36); c.translate(-x, -y);
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  c.restore();
  c.restore();
}

export default {
  drawBowl, drawSack, drawJug, drawBrush, drawSoap, drawBall, drawBone, drawDropRing, PC,
  /* stage 4 */
  drawLeash, drawCollar, drawFind, drawPawPrint, inkLine, WC,
  /* stage 6 */
  BOWL_BASE, BOWL_WELL, BOWL_TOP,
  /* stage 8b: the near/far split (§19.2) and the depth seam (§19.5) */
  bowlNearPath, bowlSilhouette,
  /* §19.7: the line his muzzle may not show below */
  bowlBelowLipPath,
};
