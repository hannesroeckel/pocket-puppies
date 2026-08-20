/* ==========================================================================
   dog/coat.js — THE TUFTED MASS, SHARED BY EVERY VIEW OF THE DOG.

   These two functions were inside `dog/draw.js` for eight stages, because there
   was only ever one view of the dog and no reason for them to be anywhere else.
   Then the side profile was approved:

     "Actually I do want a side and back profile of the dogs"

   and the first attempt at it drew its own coat — one sine-modulated outline and
   a few interior arcs — which produced a knock-off of our own dog:

     "that looks horrible."

   It looked horrible because a coat is not an outline. It is a contact shadow, a
   dark rim OUTSIDE the fill, the fill itself, and a form shade inside it, with
   the silhouette tufted once at construction and never re-tufted per frame. That
   is what is in here, and it is what both views now call.

   MOVED, NOT REWRITTEN. Every line below is the code that drew the frontal dog,
   character for character, with one change: `fluffMass` takes the resolved
   palette as an argument instead of closing over it. `tools/bowlpixels.py` and
   `tools/breedproof.py` exist to prove that — a pure extraction has to come out
   pixel-identical, and if it does not then something broke and they say so.
   ========================================================================== */
import {
  TAU, pt, crClosed, resampleClosed, loopNormals, rgba,
} from '../engine/draw.js';

/**
 * A furnishing is ONE COHESIVE MASS with a tufted edge — authored as a
 * closed outline exactly like a silhouette, then broken along its normals
 * by the same |sin|^pow profile the coat uses.
 *
 * (The first attempt drew each furnishing as a cluster of overlapping
 * discs. Rendered, a white disc cluster on a dark muzzle reads
 * unmistakably as SOAP SUDS, not as a beard — the individual circles stay
 * legible and the eye names them. A single tufted path reads as hair.)
 *
 * Paths are static in head-local space, so every one is tufted ONCE here at
 * construction and only translated/scaled per frame.
 */
export function buildFluff(poly, salt, amp, cycles, pow, rim) {
  const rs = resampleClosed(poly, 4);
  const n = rs.length;
  const norms = loopNormals(rs);
  const raw = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    let v = Math.pow(Math.abs(Math.sin(Math.PI * cycles * u + salt)), pow);
    v *= 1 + 0.34 * Math.sin(u * TAU * 3 + salt * 1.9);
    raw[i] = v; sum += v;
  }
  const mean = sum / n;
  /* `rim` scales the dark edge. A flat 2 units is right on a beard 45 units
     deep and far too heavy on a brow only 10 deep: there, rim plus tuft is a
     dim grey skirt as thick as the pale mass it surrounds, and the brow stops
     reading as a brow and starts reading as a smudge. */
  const rw = 2.0 * (rim === undefined ? 1 : rim);
  const fill = [], dark = [];
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const d = amp * (raw[i] - mean + 0.34);
    const x = rs[i].x + norms[i].x * d, y = rs[i].y + norms[i].y * d;
    fill.push(pt(x, y));
    dark.push(pt(x + norms[i].x * rw, y + norms[i].y * rw));
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  /* `base` is the SMOOTH resampled contour, before tufting. A contact shadow
     traced round the ragged edge is just more ragged edge; traced round the
     smooth one it reads as the form's shadow on the face underneath. */
  return { fill, dark, base: rs, y0, y1 };
}


/**
 * ONE furnishing side's MASS — contact shadow, dark rim, fill, form shade —
 * in head-local coordinates.
 *
 * Pulled out of drawFurnishings so that the live path and the pre-baked path
 * below run the exact same drawing code and cannot drift apart. Everything
 * here is static in head-local space (see buildFluff), which is precisely
 * what makes the bake possible.
 */
export function fluffMass(c, f, geo, sd, main, dark, hw, hh, alpha, pal) {
  /* CONTACT SHADOW — what stops a furnishing reading as a decal.
     A pale mass laid on the face with no shadow under it has no stated
     relationship to the head: it hovers in front of the face. A brow
     physically OVERHANGS the brow ridge, so it throws a soft shadow down onto
     the lid — and drawing that shadow is what drops it back ONTO the lid
     without moving it down over the eye and re-crushing it (the opposite
     failure). Traced round the SMOOTH base contour, offset down, and mostly
     hidden behind the mass itself: all that shows is the crescent below the
     lower edge. */
  if (f.contact) {
    const CT = f.contact;
    const passes = CT.soft === false ? 1 : 2;
    for (let q = passes; q >= 1; q--) {
      c.globalAlpha = alpha * (CT.alpha || 0.20) / passes;
      c.save();
      c.translate((CT.dx || 0) * hw * sd, (CT.dy === undefined ? 0.06 : CT.dy) * hh * (q / passes));
      c.beginPath(); crClosed(c, geo.base, 1);
      c.fillStyle = pal[CT.color] || dark; c.fill();
      c.restore();
    }
    c.globalAlpha = alpha;
  }
  c.beginPath(); crClosed(c, geo.dark, 1);
  c.fillStyle = dark; c.fill();
  c.beginPath(); crClosed(c, geo.fill, 1);
  c.fillStyle = main; c.fill();
  /* a soft inner shade so the mass has volume rather than reading as a
     flat paper cutout stuck on the face */
  if (f.shadeIn || f.shadeUnder) {
    c.beginPath(); crClosed(c, geo.fill, 1);
    c.save(); c.clip();
    /* `shadeIn` shades from the TOP down, which is right for a beard
       hanging in the shadow of the jaw. It is backwards for a brow: an
       overhanging mass is LIT on top and dark underneath, and shading it
       the other way lights it from below — one more reason the brows read
       as pasted on rather than as part of the skull. `shadeUnder` runs the
       ramp the other way, and over the furnishing's OWN extent rather than
       the head's, so a shape only a fifth of a head deep actually gets the
       full ramp instead of a flat slice of it. */
    const sg = f.shadeUnder
      ? c.createLinearGradient(0, geo.y1, 0, geo.y0 - (geo.y1 - geo.y0) * 0.25)
      : c.createLinearGradient(0, -hh * 0.2, 0, hh * 0.5);
    sg.addColorStop(0, rgba(dark, f.shadeUnder || f.shadeIn));
    sg.addColorStop(1, rgba(dark, 0));
    c.fillStyle = sg;
    c.fillRect(-hw, -hh, hw * 2, hh * 2);
    c.restore();
  }
}
