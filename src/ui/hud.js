/* ==========================================================================
   ui/hud.js — the top strip: the dog's name and the hint line.

   THERE IS NO AFFECTION METER, AND THAT IS DELIBERATE.
   The original deliberately made hunger, thirst and fur inspectable while
   leaving the bond invisible: you read it off the animal's body — tail
   amplitude and speed, ear position, whether she approaches or retreats,
   whether she holds eye contact. A bar turns that reading into a number and
   the relationship into a progress meter. (See ARCHITECTURE §11; this
   reverses the "affection meter" line in the original stage-1 brief.)

   Affection still exists in state and still drives posture, tail, ears, eyes
   and mouth. It is simply never drawn.

   When stage 2 adds an inspect affordance it must use WORDS, not bars —
   BALANCE.inspect holds the original's four-and-five-step scales, and
   describeNeed() in state/game.js resolves them.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { roundRect } from '../engine/draw.js';

const W = BALANCE.view.W;
const M = BALANCE.ui.meter;

export function createHud(game, opts = {}) {
  let hintText = opts.hint || '';
  let hintStage = 0;
  let hintFade = 1;

  const hud = {
    get hint() { return hintText; },
    setHint(t) { hintText = t; hintFade = 0; },
    /** progressive hints — these describe the dog, they don't score her */
    bumpHint(affection) {
      const at = BALANCE.ui.hintAt;
      if (hintStage === 0 && affection > at[0]) { hintStage = 1; hud.setHint('Try her chin, her chest, behind her ears'); }
      else if (hintStage === 1 && affection > at[1]) { hintStage = 2; hud.setHint('She leans into your hand'); }
    },
    update(dt) { hintFade = Math.min(1, hintFade + dt * 2.2); },

    draw(g, view) {
      const c = g.ctx;
      const top = Math.max(14, view.safe.top / view.vs + 12);
      const left = Math.max(14, view.safe.left / view.vs + 14);
      const d = game.dog;

      /* name pill — the only persistent chrome */
      c.save();
      c.font = '700 12.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      const nw = c.measureText(d.name).width + 26;
      c.globalAlpha = 0.30; c.fillStyle = '#fff8ea';
      roundRect(c, left, top, nw, M.h, 15); c.fill();
      c.globalAlpha = 0.18; c.strokeStyle = '#7c4a2f'; c.lineWidth = 1.2;
      roundRect(c, left, top, nw, M.h, 15); c.stroke();
      c.globalAlpha = 1;
      c.fillStyle = '#5d3018';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(d.name, left + nw / 2, top + M.h / 2 + 0.5);
      c.restore();

      /* hint */
      if (hintText) {
        c.save();
        c.globalAlpha = 0.72 * hintFade;
        c.fillStyle = '#fff0d4';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.font = '500 12.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        c.shadowColor = 'rgba(48,24,12,0.6)'; c.shadowBlur = 5; c.shadowOffsetY = 1;
        c.fillText(hintText, W / 2, top + M.h + 20);
        c.restore();
      }
    },
  };
  return hud;
}

export default createHud;
