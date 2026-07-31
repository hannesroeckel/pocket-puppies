/* ==========================================================================
   ui/toast.js — transient one-line messages drawn on the canvas.
   No DOM, so it can't fight the canvas for pointer events.

   ROUTED THROUGH ui/text.js IN STAGE 5. It was the last and most visible
   un-retrofitted text site in the game, and stage 4's own notes named it: "in
   FINAL-beat1-prepare-light.png the 'Pip it is' toast is the lowest-contrast
   text left on screen." It hand-rolled the font stack, drew `#ffeccd` at
   `globalAlpha 0.88` over a `rgba(58,30,16,0.82)` pill — an alpha somebody
   liked the look of rather than one that was solved for anything — and
   measured its own width to size that pill, so long copy could run off the
   edge on a narrow device. Nothing anchored it to the safe area.

   `drawText` now solves the plate alpha against the worst possible background,
   shrinks the type to the safe band, and clamps the box (not the baseline)
   inside it. The one thing this file must still do itself is the STACK: three
   toasts sit above one another and each needs its own pill, so it asks for one
   line at a time rather than using `drawStack`.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { clamp, smooth } from '../engine/draw.js';
import { drawText } from './text.js';

const U = BALANCE.ui.toast;

export function createToasts() {
  const items = [];
  return {
    show(text, dur) {
      /* THE SAME LINE TWICE IS NEVER WORTH TWO PILLS. Two sources can toast the
         same thing in one frame — the naming beat's `onDone` and an explicit
         call both said "Pip it is" on a real screenshot — and a stack of two
         identical pills reads as a glitch. A repeat refreshes the one that is
         already there instead. */
      const last = items[items.length - 1];
      if (last && last.text === text) { last.life = 0; last.dur = dur || U.dur; return; }
      items.push({ text, life: 0, dur: dur || U.dur });
      while (items.length > U.maxStack) items.shift();
    },
    clear() { items.length = 0; },
    get count() { return items.length; },
    /** what is on screen right now — the legibility gate reads this */
    get texts() { return items.map((i) => i.text); },
    update(dt) {
      for (let i = items.length - 1; i >= 0; i--) {
        items[i].life += dt;
        if (items[i].life >= items[i].dur) items.splice(i, 1);
      }
    },
    /**
     * @param baseY where the bottom-most toast sits, in virtual units. The
     *   room passes the nav's top edge, which is itself derived from the safe
     *   inset — and `drawText` clamps into the safe band on top of that, so a
     *   caller who gets this wrong can no longer push a toast off screen.
     */
    draw(g, baseY) {
      if (!items.length) return;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const u = it.life / it.dur;
        /* The fade is a TRANSITION, which ui/text.js is explicit about being
           unable to guarantee contrast through — contrast against a background
           you are dissolving into is not a thing that exists. It is short, and
           it is never a resting state. */
        const a = u < U.fade ? smooth(u / U.fade)
          : (u > 1 - U.fade ? smooth((1 - u) / U.fade) : 1);
        drawText(g, it.text, {
          x: BALANCE.view.W / 2,
          y: baseY - i * U.step - (1 - a) * 6,
          anchor: 'free',
          size: U.size,
          weight: 700,
          padX: U.padX,
          padY: U.padY,
          fade: clamp(a, 0, 1),
        });
      }
    },
  };
}

export default createToasts;
