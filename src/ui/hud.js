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

   NEEDS MAY HAVE BARS. THE BOND MAY NOT. (Stage 9 — and this paragraph
   replaces an absolute that was drawn too widely.)

   Stage 2 wrote "needs are words, never bars", which bundled two very
   different things under one rule. `docs/DESIGN-REF.md` decision 1 unbundled
   them: hunger, thirst and coat are CHORES with buttons, and a bar for a chore
   is a glanceable answer to "is he fed" — the original surfaced exactly those
   three on its own care screen. The bond is not a chore, has no button, and
   gets no readout of any kind, for the reasons in the paragraph above.

   So the inspect panel is now three bubble meters and one word row (energy —
   nothing restores it on demand, so a fill fraction would be a number to watch
   and not act on). The WORDS DID NOT GO: every row still carries
   `game.describeNeed(key)` from BALANCE.inspect beside its bar, because
   "Famished" says something "12%" does not, and dropping the original's scale
   in favour of a fill fraction would have thrown away the best writing in the
   game to gain nothing.

   Still no badge, no red dot, no count: a "1" on a pet is guilt, and guilt is
   the top reason people delete pet games (research §3). A need below
   `tokens.needs.lowAt` warms its own fill and says nothing.

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
import { clamp, smooth } from '../engine/draw.js';
import { capitalise } from '../state/game.js';
import { drawText, measure, safeBand } from './text.js';
import { INK, SURF, R, PRESS, type } from './tokens.js';
import { tactile, createPresses } from './surface.js';
import { drawNeedsPanel } from './meter.js';

const W = BALANCE.view.W;
const M = BALANCE.ui.meter;
const SS = BALANCE.ui.status;

/* THE NEEDS ROWS MOVED TO `BALANCE.ui.tokens.needs`, with their accent colours
   and which of them get a bar. They are data now because the bubble meter in
   ui/meter.js and this panel both need to agree about them, and because the
   "which needs get a bar" question is the one decision in this file that has a
   research answer behind it (docs/DESIGN-REF.md decision 1) and should not be
   re-litigated by editing an array in a draw function. */

export function createHud(game, opts = {}) {
  let hintText = opts.hint || '';
  let hintStage = 0;
  let hintFade = 1;
  let statusT = 1e9;          // seconds since the needs panel was asked for
  let visible = true;
  let box = { x: 0, y: 0, w: 0, h: 0 };
  /* the name pill IS a pressable control — it is the inspect affordance — so it
     gets the same tactile treatment as everything else that can be pressed. It
     had no press feedback at all before, which is why tapping it and getting a
     panel 300ms later felt like a coincidence rather than a result. */
  const presses = createPresses(opts.reduced);
  let panelBox = null;

  const hud = {
    get hint() { return hintText; },
    setHint(t) { hintText = t; hintFade = 0; },
    set visible(v) { visible = !!v; },
    get visible() { return visible; },
    set pressed(down) { presses.set('name', !!down); },
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
      presses.update(dt);
    },

    draw(g, view) {
      if (!visible) return;
      const c = g.ctx;
      const top = Math.max(14, view.safe.top / view.vs + 12);
      const left = Math.max(14, view.safe.left / view.vs + 14);
      const d = game.dog;
      const named = game.isNamed;

      /* ---- name pill: the only persistent chrome, and only once named ---
         NOW A TACTILE CONTROL, because it is one: tapping it is how you inspect
         him. It used to be a translucent cream card with no press state at all,
         so the one discoverable affordance in the room gave no sign it had been
         hit. `over` is the pill's real face colour, so the contrast check is
         exact rather than the old split-brain (it FILLED #fff8ea and checked
         against #f6e8d2 — two guesses about one card). */
      const P = game.pron;
      const label = named ? d.name : `How ${P.is} ${P.they}?`;
      const ty = type('labelMd', { weight: 700 });
      const m0 = measure(g, label, { ...ty, x: 0, y: 0 });
      const nw = m0.w + 28;
      /* the hit box includes the tactile edge, so the bottom of the pill is
         pressable rather than decorative */
      box = { x: left, y: top, w: nw, h: M.h + PRESS.edge };
      const face = SURF.card;
      const f = tactile(c, {
        x: left, y: top, w: nw, h: M.h, r: R.md,
        p: presses.at('name'), face, fade: named ? 1 : 0.88,
      });
      drawText(g, label, {
        ...ty,
        x: left + nw / 2, y: top + f.dy + M.h / 2 + 0.5, anchor: 'free',
        ink: INK.body, over: face,
        maxWidth: nw - 14, fade: named ? 1 : 0.78,
      });

      /* ---- the needs: THREE BUBBLE METERS AND ONE WORD ----
         hunger / thirst / coat get a bar because each of them has a button;
         energy stays a word because nothing she can press restores it. There is
         no happiness row, no affection row and no bond row, and ui/meter.js
         carries the reason at length. */
      const panelY = top + M.h + PRESS.edge + 8;
      const showing = statusT < SS.dur;
      let panelH = 0;
      if (showing) {
        const u = statusT / SS.dur;
        const a = u < SS.fade / SS.dur ? smooth(statusT / SS.fade)
          : (u > 1 - SS.fade / SS.dur ? smooth((SS.dur - statusT) / SS.fade) : 1);
        panelBox = drawNeedsPanel(g, left, panelY, game, clamp(a, 0, 1));
        panelH = panelBox.h;
      }

      /* ---- THE HINT LINE. THIS WAS THE DEFECT. ----
         Bare cream over whatever art is behind, with a drop shadow standing in
         for a contrast guarantee. Now a solved plate, and anchored DOWN FROM
         THE SAFE TOP EDGE rather than from the raw frame, so it cannot crowd
         the status bar on the target device. Full opacity at rest: the old
         0.72 was a style, and the helper's guarantee is defined at full
         opacity — `hintFade` is a transition and is allowed to pass through. */
      if (hintText) {
        /* DERIVED, not a magic number. This used to be `+ 106`, arrived at by
           adding up four row heights by hand and then re-measuring by cropping
           in on a screenshot when the plate touched the panel's bottom edge.
           `drawNeedsPanel` returns its box, so the hint clears whatever the
           panel actually is — including after someone adds or removes a row. */
        const belowAbs = showing ? panelY + panelH : top + M.h + PRESS.edge;
        drawText(g, hintText, {
          ...type('labelMd'),
          x: W / 2,
          y: (belowAbs - safeBand(view).top) + 18,
          anchor: 'top', fade: clamp(hintFade, 0, 1),
        });
      }
    },
  };

  return hud;
}

export default createHud;
