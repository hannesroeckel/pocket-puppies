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

   ROUTED THROUGH ui/text.js IN STAGE 5. This file was the only one that read
   `view.safe` before the helper existed, but it still hand-rolled three font
   stacks and — the real problem — drew the HINT LINE as bare cream `#fff0d4` at
   alpha 0.72 with a drop shadow, straight over whatever art happened to be
   behind it. That is precisely the failure ui/text.js was built to make
   impossible, and a shadow is a hope that the art is light.

   The pill and the needs panel are different: they draw their own backing, so
   they pass `over` and get their INK checked against that known colour rather
   than acquiring a second scrim on top of a card that already reads fine.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { clamp, smooth, roundRect } from '../engine/draw.js';
import { capitalise } from '../state/game.js';
import { drawText, measure, safeBand } from './text.js';

/* the pill and the needs panel are translucent cream over the room's warm
   wall, so the WORST case an ink can composite against is close to the pill's
   own colour on white. Naming them here means the contrast check has a real
   number rather than a guess about what is behind. */
const PILL = 12.5;
const PILL_BG = '#f6e8d2';
const PANEL_BG = '#f6e8d2';

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
    /** progressive hints — these describe the dog, they don't score her.
        PRONOUN-PARAMETERISED (swept in stage 4): the gift puppy is male, so
        "Try her chin" was wrong on screen. `game.pron` is resolved per dog. */
    bumpHint(affection) {
      const at = BALANCE.ui.hintAt;
      const P = game.pron;
      if (hintStage === 0 && affection > at[0]) {
        hintStage = 1;
        hud.setHint(`Try ${P.their} chin, ${P.their} chest, behind ${P.their} ears`);
      } else if (hintStage === 1 && affection > at[1]) {
        hintStage = 2;
        hud.setHint(`${capitalise(P.they)} lean${P.s} into your hand`);
      }
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

      /* ---- name pill: the only persistent chrome, and only once named ---
         The pill is a translucent cream card over the wall, so the ink is
         checked against the LIGHTEST thing it can composite to — measured
         through the helper rather than assumed, and no extra plate is drawn
         over a card that is already doing the job. */
      const P = game.pron;
      const label = named ? d.name : `How ${P.is} ${P.they}?`;
      const m0 = measure(g, label, { x: 0, y: 0, size: PILL, weight: 700 });
      const nw = m0.w + 26;
      box = { x: left, y: top, w: nw, h: M.h };
      c.save();
      c.globalAlpha = named ? 0.30 : 0.22;
      c.fillStyle = '#fff8ea';
      roundRect(c, left, top, nw, M.h, 15); c.fill();
      c.globalAlpha = 0.18; c.strokeStyle = '#7c4a2f'; c.lineWidth = 1.2;
      roundRect(c, left, top, nw, M.h, 15); c.stroke();
      c.restore();
      drawText(g, label, {
        x: left + nw / 2, y: top + M.h / 2 + 0.5, anchor: 'free',
        size: PILL, weight: 700, ink: '#5d3018', over: PILL_BG,
        maxWidth: nw - 12, fade: named ? 1 : 0.72,
      });

      /* ---- the needs, in WORDS ---- */
      if (statusT < SS.dur) {
        const u = statusT / SS.dur;
        const a = u < SS.fade / SS.dur ? smooth(statusT / SS.fade)
          : (u > 1 - SS.fade / SS.dur ? smooth((SS.dur - statusT) / SS.fade) : 1);
        drawNeeds(g, left, top + M.h + 8, clamp(a, 0, 1));
      }

      /* ---- THE HINT LINE. THIS WAS THE DEFECT. ----
         Bare cream over whatever art is behind, with a drop shadow standing in
         for a contrast guarantee. Now a solved plate, and anchored DOWN FROM
         THE SAFE TOP EDGE rather than from the raw frame, so it cannot crowd
         the status bar on the target device. Full opacity at rest: the old
         0.72 was a style, and the helper's guarantee is defined at full
         opacity — `hintFade` is a transition and is allowed to pass through. */
      if (hintText) {
        drawText(g, hintText, {
          x: W / 2,
          /* clear of the needs panel when it is open: the panel is 4 rows plus
             padding = 84 units tall and starts 8 below the pill, so it ends at
             +92. 96 left the hint's plate touching its bottom edge — measured
             by cropping in on it. */
          y: (top - safeBand(view).top) + M.h + (statusT < SS.dur ? 106 : 20),
          anchor: 'top', size: 12.5, weight: 600, fade: clamp(hintFade, 0, 1),
        });
      }
    },
  };

  /**
   * The inspect panel. Four labels, four words, no geometry that could be
   * mistaken for a quantity. Deliberately NOT a list of chores: it says how
   * she is, in the language the original used.
   */
  function drawNeeds(g, x, y, a) {
    const c = g.ctx;
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
    c.restore();
    /* The panel is a card this function drew, so `over` checks the ink against
       it exactly and adds no plate. Both columns get a `maxWidth` so a long
       label and a long word can never overlap in the middle. */
    for (let i = 0; i < ROWS.length; i++) {
      const [label, key] = ROWS[i];
      const ry = y + 8 + rowH * i + rowH / 2;
      drawText(g, label, {
        x: x + 12, y: ry, anchor: 'free', align: 'left', size: 10.5, weight: 600,
        ink: '#5d3018', over: PANEL_BG, maxWidth: w * 0.52, fade: a,
      });
      /* the WORD. The only thing that ever quantifies a need. */
      drawText(g, game.describeNeed(key), {
        x: x + w - 12, y: ry, anchor: 'free', align: 'right', size: 10.5, weight: 700,
        ink: '#5d3018', over: PANEL_BG, maxWidth: w * 0.44, fade: a,
      });
    }
  }

  return hud;
}

export default createHud;
