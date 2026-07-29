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

/**
 * A dog bowl.
 * @param kind  'food' | 'water'
 * @param fill  0..1 contents
 * @param t     seconds, for the water surface wobble
 * @param ripple 0..1 recent disturbance (a lap, a poured stream)
 */
export function drawBowl(c, bx, by, s, kind, fill = 0, t = 0, ripple = 0) {
  const water = kind === 'water';
  c.save();
  c.translate(bx, by);
  c.scale(s, s);

  c.fillStyle = PC.shadow; ell(c, 2, 6, 34, 10); c.fill();

  const g = c.createLinearGradient(-30, -14, 30, 14);
  g.addColorStop(0, water ? PC.tealL : PC.clayL);
  g.addColorStop(0.5, water ? PC.teal : PC.clay);
  g.addColorStop(1, water ? PC.tealD : PC.clayD);
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(-30, -8);
  c.bezierCurveTo(-28, 10, -16, 18, 0, 18);
  c.bezierCurveTo(16, 18, 28, 10, 30, -8);
  c.closePath(); c.fill();

  /* the inner well */
  c.fillStyle = water ? '#f0f2e6' : PC.cream; ell(c, 0, -8, 30, 9.5); c.fill();
  c.fillStyle = water ? PC.tealD : '#a97141'; ell(c, 0, -7, 24.5, 7); c.fill();

  const f = clamp(fill, 0, 1);
  if (f > 0.01) {
    c.save();
    ell(c, 0, -7, 24.5, 7); c.clip();
    if (water) {
      /* the surface sits higher as the bowl fills, and wobbles */
      const surf = lerp(1.5, -7.5, f);
      const wob = Math.sin(t * 5.1) * (0.5 + ripple * 1.9);
      const wg = c.createLinearGradient(0, surf - 6, 0, 4);
      wg.addColorStop(0, PC.waterL); wg.addColorStop(0.5, PC.water); wg.addColorStop(1, PC.waterD);
      c.fillStyle = wg;
      c.beginPath();
      c.moveTo(-26, surf + wob);
      c.bezierCurveTo(-9, surf - 1.6 - wob, 9, surf + 1.6 + wob, 26, surf - wob);
      c.lineTo(26, 12); c.lineTo(-26, 12); c.closePath(); c.fill();
      /* specular band + a ring or two from the last disturbance */
      c.fillStyle = 'rgba(255,255,255,0.55)';
      ell(c, -8, surf + 0.6, 8 * (0.7 + f * 0.5), 1.7, -0.12); c.fill();
      ell(c, 9, surf + 2.2, 4.6, 1.2, 0.16); c.fill();
      if (ripple > 0.02) {
        c.strokeStyle = `rgba(255,255,255,${(0.5 * ripple).toFixed(3)})`;
        c.lineWidth = 1.1;
        for (let i = 0; i < 2; i++) {
          const rr = 5 + (1 - ripple) * 15 + i * 7;
          c.beginPath(); c.ellipse(0, surf + 2, rr, rr * 0.30, 0, 0, TAU); c.stroke();
        }
      }
    } else {
      /* kibble piles up from the bottom: reveal pieces in a stable order */
      const n = Math.round(f * KIBBLE.length);
      c.fillStyle = PC.kibbleD;
      ell(c, 0, lerp(2, -9, f), 21 * (0.55 + f * 0.45), 6.4 * (0.5 + f * 0.5)); c.fill();
      for (let i = 0; i < n; i++) {
        const k = KIBBLE[i];
        c.fillStyle = PC.kibble;
        ell(c, k[0] * (0.8 + f * 0.2), k[1] * f + (1 - f) * 2, k[2], k[2] * 0.78, i * 0.7); c.fill();
      }
      c.fillStyle = PC.kibbleL;
      for (let i = 0; i < n; i += 3) {
        const k = KIBBLE[i];
        ell(c, k[0] * (0.8 + f * 0.2) - 1, k[1] * f + (1 - f) * 2 - 1.4, k[2] * 0.36, k[2] * 0.26, 0); c.fill();
      }
    }
    c.restore();
  }

  c.strokeStyle = 'rgba(255,255,255,0.45)'; c.lineWidth = 1.6;
  c.beginPath(); c.ellipse(0, -8, 30, 9.5, 0, Math.PI * 1.05, Math.PI * 1.85); c.stroke();
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

/** The ball toy. `spin` rotates the stripes; `s` fakes distance. */
export function drawBall(c, bx, by, s, spin = 0, shadowAt) {
  if (shadowAt !== undefined) {
    c.fillStyle = `rgba(104,58,32,${(0.22 * clamp(s, 0.2, 1)).toFixed(3)})`;
    ell(c, bx + 2, shadowAt, 16 * s, 5 * s); c.fill();
  }
  c.save();
  c.translate(bx, by);
  c.scale(s, s);
  c.rotate(spin);
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

export default { drawBowl, drawSack, drawJug, drawBrush, drawSoap, drawBall, drawBone, drawDropRing, PC };
