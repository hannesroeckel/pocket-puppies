/* ==========================================================================
   ui/nav.js — the bottom navigation row.

   Canvas-drawn pills with a real hit test, so scenes never need DOM. The
   `items` list is data: stage 2..6 add entries and wire them to app.nav.go().
   Buttons whose target scene isn't registered yet are drawn dimmed and
   report `available:false` — the room scene toasts "coming soon".
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { clamp, roundRect, TAU, rgba } from '../engine/draw.js';

const N = BALANCE.ui.nav;
const W = BALANCE.view.W;

/* tiny glyphs, drawn not fonted, so there is nothing to download */
const GLYPH = {
  care(c, x, y, r) {          // bowl
    c.beginPath(); c.moveTo(x - r, y - r * 0.25);
    c.bezierCurveTo(x - r * 0.9, y + r * 0.8, x - r * 0.4, y + r, x, y + r);
    c.bezierCurveTo(x + r * 0.4, y + r, x + r * 0.9, y + r * 0.8, x + r, y - r * 0.25);
    c.closePath(); c.fill();
    c.beginPath(); c.ellipse(x, y - r * 0.3, r * 1.05, r * 0.34, 0, 0, TAU); c.fill();
  },
  walk(c, x, y, r) {          // lead / hook
    c.lineWidth = r * 0.38; c.lineCap = 'round';
    c.beginPath(); c.arc(x, y - r * 0.35, r * 0.55, Math.PI * 0.15, Math.PI * 0.95, true); c.stroke();
    c.beginPath(); c.moveTo(x + r * 0.5, y - r * 0.2);
    c.quadraticCurveTo(x + r * 0.2, y + r * 0.9, x - r * 0.6, y + r * 0.8); c.stroke();
  },
  train(c, x, y, r) {         // paw
    c.beginPath(); c.ellipse(x, y + r * 0.35, r * 0.66, r * 0.52, 0, 0, TAU); c.fill();
    for (let i = -1; i <= 1; i++) {
      c.beginPath(); c.ellipse(x + i * r * 0.52, y - r * 0.42, r * 0.21, r * 0.28, i * 0.3, 0, TAU); c.fill();
    }
  },
  play(c, x, y, r) {          // ball
    c.beginPath(); c.arc(x, y, r * 0.82, 0, TAU); c.fill();
    c.save(); c.beginPath(); c.arc(x, y, r * 0.82, 0, TAU); c.clip();
    c.globalAlpha = 0.45; c.fillStyle = '#fff';
    c.beginPath(); c.moveTo(x - r, y - r * 0.2);
    c.quadraticCurveTo(x, y - r * 0.72, x + r, y - r * 0.2);
    c.lineTo(x + r, y + r * 0.1); c.quadraticCurveTo(x, y - r * 0.4, x - r, y + r * 0.1);
    c.closePath(); c.fill(); c.restore();
  },
  shop(c, x, y, r) {          // bag
    roundRect(c, x - r * 0.7, y - r * 0.35, r * 1.4, r * 1.3, r * 0.25); c.fill();
    c.lineWidth = r * 0.24;
    c.beginPath(); c.arc(x, y - r * 0.35, r * 0.42, Math.PI, 0); c.stroke();
  },
  settings(c, x, y, r) {      // heart-in-gear-ish: three dots
    for (let i = -1; i <= 1; i++) { c.beginPath(); c.arc(x + i * r * 0.62, y, r * 0.20, 0, TAU); c.fill(); }
  },
};

export function createNav(items, opts = {}) {
  const nav = {
    items,
    y: 0, h: N.h,
    pressed: '',
    /** call when the safe-area inset changes */
    layout(safeBottom) {
      nav.h = N.h;
      nav.y = BALANCE.view.H - N.h - Math.max(6, safeBottom) - 6;
    },
    bounds(i) {
      const n = items.length;
      const pad = N.pad;
      const total = W - pad * 2;
      const bw = (total - N.gap * (n - 1)) / n;
      return { x: pad + i * (bw + N.gap), y: nav.y, w: bw, h: nav.h };
    },
    /**
     * The whole nav band is a hit target: the gaps between pills would
     * otherwise fall through to the play surface, so a thumb landing between
     * two buttons pokes the room instead of pressing anything. Inside the
     * band, the nearest pill wins.
     */
    hit(x, y) {
      if (y < nav.y || y > nav.y + nav.h) return null;
      let best = null, bd = Infinity;
      for (let i = 0; i < items.length; i++) {
        const b = nav.bounds(i);
        const d = Math.abs(x - (b.x + b.w / 2));
        if (d < bd) { bd = d; best = items[i]; }
      }
      return best;
    },
    draw(g) {
      const c = g.ctx;
      c.save();
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const b = nav.bounds(i);
        const dim = it.available === false;
        const down = nav.pressed === it.id;
        c.globalAlpha = down ? 0.52 : (dim ? 0.30 : 0.40);
        c.fillStyle = '#fff8ea';
        roundRect(c, b.x, b.y, b.w, b.h, N.r); c.fill();
        c.globalAlpha = dim ? 0.14 : 0.22;
        c.strokeStyle = '#7c4a2f'; c.lineWidth = 1.2;
        roundRect(c, b.x, b.y, b.w, b.h, N.r); c.stroke();
        c.globalAlpha = dim ? 0.52 : 0.92;
        const cx = b.x + b.w / 2, cy = b.y + b.h * 0.40;
        c.fillStyle = '#6b3a24'; c.strokeStyle = '#6b3a24';
        const glyph = GLYPH[it.icon || it.id];
        if (glyph) glyph(c, cx, cy, N.iconR);
        c.globalAlpha = dim ? 0.55 : 0.95;
        c.fillStyle = '#5d3018';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.font = '600 9.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        c.fillText(it.label.toUpperCase(), cx, b.y + b.h * 0.80);
      }
      c.globalAlpha = 1;
      c.restore();
    },
  };
  nav.layout(opts.safeBottom || 0);
  return nav;
}

export default createNav;
