/* ==========================================================================
   dog/coatstate.js — MUDDY, SOAPY, WET, GLOSSY.

   The four washes that say what has happened to the coat. Moved out of
   dog/draw.js unchanged so the PROFILE view can wear them too — which it has to
   before the walk can use it, because the whole point of the walk is that he
   comes home with something on him.

   These were the easiest of the seven batches by a distance: between them they
   closed over exactly one thing (`rig.drive`), which is an argument now. Everything
   else was already a parameter or a literal.
   ========================================================================== */
import { TAU, clamp, lerp, ell, rgba } from '../engine/draw.js';
import { hash1 } from './part.js';

/* the two mud colours. They lived one line above `drawSoil` in dog/draw.js and
   were left behind by the move — the render came back with a ReferenceError
   rather than a spotless dog, which is the good failure mode. */
const DIRT = { a: '#8a5f38', b: '#6b4526' };

export function drawSoil(c, coat, where, hw, hh, o) {
  if (!coat || !coat.regions) return;
  const wetK = 1 + clamp(coat.wet || 0, 0, 1) * 0.35;   // wet mud is darker
  for (let i = 0; i < coat.regions.length; i++) {
    const r = coat.regions[i];
    if (r.part !== where) continue;
    const d = clamp(coat.dirt[i] || 0, 0, 1);
    if (d < 0.012) continue;
    const x = r.at[0] * hw, y = r.at[1] * hh;
    const rr = r.r * (0.58 + d * 0.80);
    /* ---- STAGE 4 FIX: ONE FEATHERED SMUDGE, NOT THREE HARD PASSES -----
       The original three concentric ellipse fills each had a hard alpha edge,
       so between about 0.2 and 0.5 dirt they read as PALE CONCENTRIC RINGS —
       at a glance, bald patches or ringworm rather than muck. Caught by
       rendering a dirt ladder (0 / 0.25 / 0.45 / 0.7 / 1.0) and looking at
       it: only 1.0 read as a muddy dog, and stage 4's walks live in exactly
       the band that failed.

       A single radial gradient has no interior edge to read as a ring, and
       the alpha curve is raised so a half-dirty dog is visibly dirty rather
       than faintly discoloured. The DATA and the erase mechanic are
       untouched, so wash still works exactly as stage 2 built it. */
    /* A PLATEAU, then a feather. All-gradient was too diffuse — 0.45 and
       0.70 dirt rendered almost identically because the ink was spread over
       too large a radius. Holding the peak flat to 52% of the radius gives
       the smudge a solid middle (which is what makes it read as muck) while
       the outer feather keeps it edgeless (which is what stops it reading as
       a ring). Verified against the same ladder. */
    const peak = clamp(Math.pow(d, 0.72) * wetK, 0, 0.94);
    const R = rr * 1.16;
    const gr = c.createRadialGradient(x, y, rr * 0.05, x, y, R);
    gr.addColorStop(0, rgba(DIRT.b, peak));
    gr.addColorStop(0.52, rgba(DIRT.b, peak * 0.94));
    gr.addColorStop(0.74, rgba(DIRT.a, peak * 0.58));
    gr.addColorStop(0.90, rgba(DIRT.a, peak * 0.20));
    gr.addColorStop(1, rgba(DIRT.a, 0));
    c.globalAlpha = 1;
    c.fillStyle = gr;
    c.save();
    c.translate(x, y); c.scale(1, 0.86); c.rotate(i * 0.7); c.translate(-x, -y);
    ell(c, x, y, R, R); c.fill();
    c.restore();
    /* specks around the edge, so the smudge is not a perfect oval */
    c.globalAlpha = clamp(d * 0.46, 0, 0.7);
    c.fillStyle = DIRT.b;
    for (let k = 0; k < 4; k++) {
      const a = i * 1.7 + k * 1.9;
      ell(c, x + Math.cos(a) * rr * (0.86 + (k % 2) * 0.30),
        y + Math.sin(a) * rr * (0.68 + (k % 2) * 0.26),
        rr * 0.15, rr * 0.11, a); c.fill();
    }
  }
  c.globalAlpha = 1;
}

export function drawFoam(c, coat, where, hw, hh, o) {
  if (!coat || !coat.suds || coat.suds < 0.02) return;
  for (let i = 0; i < coat.regions.length; i++) {
    const r = coat.regions[i];
    if (r.part !== where) continue;
    const f = clamp((coat.foam[i] || 0) * coat.suds, 0, 1);
    if (f < 0.02) continue;
    const x = r.at[0] * hw, y = r.at[1] * hh;
    const rr = r.r * (0.5 + f * 0.55);
    /* a cluster of overlapping bubbles, not one white blob */
    for (let k = 0; k < 6; k++) {
      const a = i * 2.1 + k * 1.05;
      const dd = rr * (0.2 + (k % 3) * 0.28);
      const br = rr * (0.34 - (k % 3) * 0.06);
      c.globalAlpha = clamp(f * 0.80, 0, 0.9);
      c.fillStyle = 'rgba(255,255,255,0.92)';
      ell(c, x + Math.cos(a) * dd, y + Math.sin(a) * dd * 0.8, br, br * 0.94); c.fill();
      c.globalAlpha = clamp(f * 0.9, 0, 1);
      c.fillStyle = 'rgba(255,255,255,0.98)';
      ell(c, x + Math.cos(a) * dd - br * 0.3, y + Math.sin(a) * dd * 0.8 - br * 0.32,
        br * 0.30, br * 0.26); c.fill();
    }
  }
  c.globalAlpha = 1;
}

/** wet: a cool wash, darker streaks, and a much stronger specular */
export function drawWet(c, coat, hw, hh, o) {
  const w = clamp(coat && coat.wet, 0, 1);
  if (!(w > 0.02)) return;
  c.globalAlpha = w * 0.20;
  c.fillStyle = '#4f6a72';
  c.fillRect(-hw * 1.4, -hh * 1.6, hw * 2.8, hh * 3.2);
  c.globalAlpha = w * 0.16;
  c.strokeStyle = '#3d565e';
  c.lineWidth = 1.6;
  for (let i = -5; i <= 5; i++) {
    const x = i * hw * 0.19;
    c.beginPath();
    c.moveTo(x, -hh * 1.1);
    c.quadraticCurveTo(x + 3, 0, x - 2, hh * 1.15);
    c.stroke();
  }
  c.globalAlpha = w * 0.34;
  c.fillStyle = 'rgba(255,255,255,0.9)';
  ell(c, hw * 0.42, -hh * 0.52, hw * 0.26, hh * 0.34, -0.5); c.fill();
  ell(c, -hw * 0.30, -hh * 0.20, hw * 0.13, hh * 0.20, -0.4); c.fill();
  c.globalAlpha = 1;
}

/** gloss: a specular bloom whose strength IS the brushing progress */
export function drawGloss(c, coat, hw, hh, o) {
  const gl = clamp(coat && coat.gloss, 0, 1);
  if (!(gl > 0.03)) return;
  /* the light in this room comes from the upper right (see the window) */
  c.globalAlpha = 0.06 + gl * 0.26;
  const g2 = c.createRadialGradient(hw * 0.40, -hh * 0.62, 2, hw * 0.40, -hh * 0.62, hw * 1.05);
  g2.addColorStop(0, 'rgba(255,250,228,0.85)');
  g2.addColorStop(0.45, 'rgba(255,246,214,0.22)');
  g2.addColorStop(1, 'rgba(255,246,214,0)');
  c.fillStyle = g2;
  c.fillRect(-hw * 1.4, -hh * 1.6, hw * 2.8, hh * 3.2);
  /* and a narrow band that travels, so a gleaming coat visibly shines */
  if (gl > 0.4) {
    const u = ((coat.sheen || 0) % 1);
    const y = lerp(-hh * 1.3, hh * 1.3, u);
    c.globalAlpha = (gl - 0.4) / 0.6 * 0.20;
    const g3 = c.createLinearGradient(0, y - hh * 0.34, 0, y + hh * 0.34);
    g3.addColorStop(0, 'rgba(255,252,236,0)');
    g3.addColorStop(0.5, 'rgba(255,252,236,0.95)');
    g3.addColorStop(1, 'rgba(255,252,236,0)');
    c.fillStyle = g3;
    c.fillRect(-hw * 1.4, y - hh * 0.34, hw * 2.8, hh * 0.68);
  }
  c.globalAlpha = 1;
}
