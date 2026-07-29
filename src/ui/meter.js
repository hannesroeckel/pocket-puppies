/* ==========================================================================
   ui/meter.js — heart glyph (used by the particle system) and the generic
   bar/word widgets stage 2 will reuse.

   NOTE: `drawAffectionMeter` exists but is NOT mounted anywhere, and must not
   be. The bond is deliberately not inspectable as a number — see the header
   of ui/hud.js. It is kept only because heartPath() lives here and because a
   later stage may want the same widget shape for a *needs* readout, which is
   allowed to be inspectable. If you are reaching for it to show affection,
   don't.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { clamp, roundRect, rgba } from '../engine/draw.js';

const M = BALANCE.ui.meter;

export function heartPath(c, x, y, s, rot) {
  c.save(); c.translate(x, y); c.rotate(rot || 0); c.scale(s, s);
  c.beginPath();
  c.moveTo(0, 0.62);
  c.bezierCurveTo(-1.04, -0.16, -0.66, -1.06, 0, -0.44);
  c.bezierCurveTo(0.66, -1.06, 1.04, -0.16, 0, 0.62);
  c.closePath();
  c.restore();
}

/**
 * @param opts { x, y, level 0..1, pulse 0..1, t, floor 0..1 }
 */
export function drawAffectionMeter(g, opts) {
  const c = g.ctx;
  const { x, y } = opts;
  const lvl = clamp(opts.level, 0, 1);
  const floor = clamp(opts.floor || 0, 0, 1);
  const pls = 1 + (opts.pulse || 0) * 0.13 + (lvl >= 0.999 ? 0.05 * Math.sin((opts.t || 0) * 4.2) : 0);

  c.save();
  c.globalAlpha = 0.30; c.fillStyle = '#fff8ea';
  roundRect(c, x, y, M.w, M.h, 15); c.fill();
  c.globalAlpha = 0.18; c.strokeStyle = '#7c4a2f'; c.lineWidth = 1.2;
  roundRect(c, x, y, M.w, M.h, 15); c.stroke();
  c.globalAlpha = 1;

  /* heart */
  const hx = x + 18, hy = y + 15;
  c.save(); c.translate(hx, hy); c.scale(pls, pls); c.translate(-hx, -hy);
  heartPath(c, hx, hy - 0.5, 11, 0);
  c.fillStyle = 'rgba(255,255,255,0.55)'; c.fill();
  c.save();
  heartPath(c, hx, hy - 0.5, 11, 0); c.clip();
  c.fillStyle = '#f2687e';
  c.fillRect(hx - 14, hy + 12 - 26 * lvl, 28, 26);
  c.fillStyle = 'rgba(255,255,255,0.30)';
  c.fillRect(hx - 14, hy + 12 - 26 * lvl, 28, 2.4);
  c.restore();
  heartPath(c, hx, hy - 0.5, 11, 0);
  c.strokeStyle = 'rgba(150,62,74,0.75)'; c.lineWidth = 1.8; c.stroke();
  c.restore();

  /* bar */
  const bx = x + 34, by = y + 11.5, bw = 34, bh = 7;
  c.fillStyle = 'rgba(120,66,42,0.22)';
  roundRect(c, bx, by, bw, bh, 3.5); c.fill();
  /* the ratchet floor, shown as a permanent ghost fill */
  if (floor > 0.01) {
    c.fillStyle = 'rgba(242,104,126,0.30)';
    roundRect(c, bx, by, Math.max(2, bw * floor), bh, 3.5); c.fill();
  }
  const bg = c.createLinearGradient(bx, 0, bx + bw, 0);
  bg.addColorStop(0, '#f6a0ac'); bg.addColorStop(1, '#f2687e');
  c.fillStyle = bg;
  roundRect(c, bx, by, Math.max(3.2, bw * lvl), bh, 3.5); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.45)';
  roundRect(c, bx + 1, by + 1, Math.max(2, bw * lvl - 2), 2.2, 1.1); c.fill();
  c.fillStyle = 'rgba(120,66,42,0.20)';
  for (let i = 1; i < 4; i++) c.fillRect(bx + bw * i / 4, by - 1.5, 1, bh + 3);
  c.restore();
}

/** Words, not bars: resolve a 0..1 need against BALANCE.inspect. */
export function describeLevel(scale, value) {
  for (const [at, word] of scale) if (value >= at) return word;
  return scale[scale.length - 1][1];
}

/** Generic labelled bar — stage 2's needs HUD (needs may be inspectable). */
export function drawBar(g, x, y, w, h, level, color, bg) {
  const c = g.ctx;
  c.fillStyle = bg || 'rgba(120,66,42,0.22)';
  roundRect(c, x, y, w, h, h / 2); c.fill();
  c.fillStyle = color;
  roundRect(c, x, y, Math.max(h, w * clamp(level, 0, 1)), h, h / 2); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.35)';
  roundRect(c, x + 1, y + 1, Math.max(2, w * clamp(level, 0, 1) - 2), h * 0.3, h * 0.15); c.fill();
}

export default drawAffectionMeter;
