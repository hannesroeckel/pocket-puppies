/* ==========================================================================
   ui/hud.js — the top strip: the dog's name, the hint line, and the needs.

   THERE IS NO AFFECTION METER, AND THERE MUST NOT BE ONE.
   The original deliberately made hunger, thirst and fur inspectable while
   leaving the bond invisible: you read it off the animal's body — tail
   amplitude and speed, ear position, whether she approaches or retreats,
   whether she holds eye contact. A bar turns that reading into a number and
   the relationship into a progress meter. (ARCHITECTURE §11.)

   Affection still exists in state and still sets the mood baseline, which is
   what drives posture, tail, ears, eyes and mouth. It is simply never drawn.

   NEEDS ARE WORDS, NEVER BARS — the original's own scales, from
   BALANCE.inspect via game.describeNeed(). They appear when she asks for them
   (tap the name) or for a few seconds when something actually wants doing.
   No badge, no red dot, no count: a "1" on a pet is guilt, and guilt is the
   top reason people delete pet games (research §3).

   The name pill is absent until the puppy HAS a name. She arrives unnamed and
   the naming beat (ui/naming.js) is the emotional centre of first launch, so
   nothing here may put a placeholder in its place.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { clamp, smooth, roundRect } from '../engine/draw.js';

const W = BALANCE.view.W;
const M = BALANCE.ui.meter;
const SS = BALANCE.ui.status;

/* label -> need key. "Fur" not "Cleanliness", because that is what it was. */
const ROWS = [
  ['Hunger', 'hunger'],
  ['Thirst', 'thirst'],
  ['Fur', 'cleanliness'],
  ['Energy', 'energy'],
];

export function createHud(game, opts = {}) {
  let hintText = opts.hint || '';
  let hintStage = 0;
  let hintFade = 1;
  let statusT = 1e9;          // seconds since the needs panel was asked for
  let visible = true;
  let box = { x: 0, y: 0, w: 0, h: 0 };

  const hud = {
    get hint() { return hintText; },
    setHint(t) { hintText = t; hintFade = 0; },
    set visible(v) { visible = !!v; },
    get visible() { return visible; },
    /** progressive hints — these describe the dog, they don't score her */
    bumpHint(affection) {
      const at = BALANCE.ui.hintAt;
      if (hintStage === 0 && affection > at[0]) { hintStage = 1; hud.setHint('Try her chin, her chest, behind her ears'); }
      else if (hintStage === 1 && affection > at[1]) { hintStage = 2; hud.setHint('She leans into your hand'); }
    },
    /** show the word-scale needs panel for a few seconds */
    showNeeds() { statusT = 0; },
    get needsShowing() { return statusT < SS.dur; },
    /** the name pill is the inspect affordance */
    hit(x, y) {
      if (!visible) return null;
      if (x >= box.x - 6 && x <= box.x + box.w + 6 && y >= box.y - 6 && y <= box.y + box.h + 6) return 'name';
      return null;
    },
    update(dt) {
      hintFade = Math.min(1, hintFade + dt * 2.2);
      if (statusT < 1e8) statusT += dt;
    },

    draw(g, view) {
      if (!visible) return;
      const c = g.ctx;
      const top = Math.max(14, view.safe.top / view.vs + 12);
      const left = Math.max(14, view.safe.left / view.vs + 14);
      const d = game.dog;
      const named = game.isNamed;

      /* ---- name pill: the only persistent chrome, and only once named --- */
      c.save();
      c.font = '700 12.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      const label = named ? d.name : 'How is she?';
      const nw = c.measureText(label).width + 26;
      box = { x: left, y: top, w: nw, h: M.h };
      c.globalAlpha = named ? 0.30 : 0.22;
      c.fillStyle = '#fff8ea';
      roundRect(c, left, top, nw, M.h, 15); c.fill();
      c.globalAlpha = 0.18; c.strokeStyle = '#7c4a2f'; c.lineWidth = 1.2;
      roundRect(c, left, top, nw, M.h, 15); c.stroke();
      c.globalAlpha = named ? 1 : 0.72;
      c.fillStyle = '#5d3018';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(label, left + nw / 2, top + M.h / 2 + 0.5);
      c.restore();

      /* ---- the needs, in WORDS ---- */
      if (statusT < SS.dur) {
        const u = statusT / SS.dur;
        const a = u < SS.fade / SS.dur ? smooth(statusT / SS.fade)
          : (u > 1 - SS.fade / SS.dur ? smooth((SS.dur - statusT) / SS.fade) : 1);
        drawNeeds(c, left, top + M.h + 8, clamp(a, 0, 1));
      }

      /* ---- hint ---- */
      if (hintText) {
        c.save();
        c.globalAlpha = 0.72 * hintFade;
        c.fillStyle = '#fff0d4';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.font = '500 12.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        c.shadowColor = 'rgba(48,24,12,0.6)'; c.shadowBlur = 5; c.shadowOffsetY = 1;
        c.fillText(hintText, W / 2, top + M.h + (statusT < SS.dur ? 96 : 20));
        c.restore();
      }
    },
  };

  /**
   * The inspect panel. Four labels, four words, no geometry that could be
   * mistaken for a quantity. Deliberately NOT a list of chores: it says how
   * she is, in the language the original used.
   */
  function drawNeeds(c, x, y, a) {
    const rowH = SS.gap;
    const w = 148;
    const h = ROWS.length * rowH + 16;
    c.save();
    c.globalAlpha = a * 0.30;
    c.fillStyle = '#fff8ea';
    roundRect(c, x, y, w, h, 13); c.fill();
    c.globalAlpha = a * 0.16;
    c.strokeStyle = '#7c4a2f'; c.lineWidth = 1.1;
    roundRect(c, x, y, w, h, 13); c.stroke();
    c.textBaseline = 'middle';
    for (let i = 0; i < ROWS.length; i++) {
      const [label, key] = ROWS[i];
      const ry = y + 8 + rowH * i + rowH / 2;
      c.globalAlpha = a * 0.66;
      c.fillStyle = '#5d3018';
      c.textAlign = 'left';
      c.font = '600 10.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      c.fillText(label, x + 12, ry);
      /* the WORD. The only thing that ever quantifies a need. */
      c.globalAlpha = a * 0.95;
      c.textAlign = 'right';
      c.font = '700 10.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      c.fillText(game.describeNeed(key), x + w - 12, ry);
    }
    c.restore();
  }

  return hud;
}

export default createHud;
