/* ==========================================================================
   ui/toast.js — transient one-line messages drawn on the canvas.
   No DOM, so it can't fight the canvas for pointer events.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { clamp, smooth, roundRect } from '../engine/draw.js';

const U = BALANCE.ui.toast;

export function createToasts() {
  const items = [];
  return {
    show(text, dur) {
      items.push({ text, life: 0, dur: dur || U.dur });
      while (items.length > U.maxStack) items.shift();
    },
    clear() { items.length = 0; },
    get count() { return items.length; },
    update(dt) {
      for (let i = items.length - 1; i >= 0; i--) {
        items[i].life += dt;
        if (items[i].life >= items[i].dur) items.splice(i, 1);
      }
    },
    draw(g, baseY) {
      if (!items.length) return;
      const c = g.ctx;
      const W = BALANCE.view.W;
      c.save();
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = '600 13.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const u = it.life / it.dur;
        const a = u < U.fade ? smooth(u / U.fade) : (u > 1 - U.fade ? smooth((1 - u) / U.fade) : 1);
        const y = baseY - i * 34 - (1 - a) * 6;
        const w = Math.min(W - 48, c.measureText(it.text).width + 34);
        c.globalAlpha = a * 0.88;
        c.fillStyle = 'rgba(58,30,16,0.82)';
        roundRect(c, (W - w) / 2, y - 15, w, 30, 15); c.fill();
        c.globalAlpha = a;
        c.fillStyle = '#ffeccd';
        c.fillText(it.text, W / 2, y);
      }
      c.globalAlpha = 1;
      c.restore();
    },
  };
}

export default createToasts;
