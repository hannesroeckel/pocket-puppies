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
import { drawText, measure } from './text.js';
import { type } from './tokens.js';

const U = BALANCE.ui.toast;

/** the type the stack is drawn in — one definition, used by both paths below */
const STYLE = () => ({ ...type('labelMd', { weight: 700 }) });

/**
 * HOW FAR THE STACK MUST RISE to clear `avoid`, or 0. Its own function because
 * the probe a gate uses and the draw a player sees have to agree exactly — a
 * harness that recomputes the layout is checking itself.
 */
function liftFor(g, baseY, avoid, text) {
  if (!avoid || !(avoid.w > 0) || !(avoid.h > 0)) return 0;
  const box = measure(g, text, STYLE());
  const halfW = box.w / 2 + U.padX;
  const cx = BALANCE.view.W / 2;
  /* BOTH AXES, OR IT IS NOT COVERING ANYTHING. The first version compared only
     the vertical bands, so a ball sitting at x 310 — off to the right of a
     centred 185-unit toast that never touched it — still pushed the stack 65
     units up the screen. Moving out of the way of something you were not on top
     of is its own defect: the message ends up somewhere unexpected for no
     reason a player could ever see. */
  if (cx + halfW <= avoid.x || cx - halfW >= avoid.x + avoid.w) return 0;
  const top = baseY - box.h / 2 - U.padY;
  const bottom = baseY + box.h / 2 + U.padY;
  const clear = U.avoidGap;
  if (bottom <= avoid.y - clear || top >= avoid.y + avoid.h + clear) return 0;
  return Math.max(0, Math.min(U.avoidMaxLift, bottom - (avoid.y - clear)));
}

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
    /**
     * WHERE A TOAST WOULD LAND, without drawing one. For the placement gate:
     * "the defect is placement, not readability", so the thing that has to be
     * asserted is a rectangle, and it comes from the same `liftFor` and the
     * same `measure` the real draw uses.
     */
    probe(g, baseY, avoid, text) {
      const lift = liftFor(g, baseY, avoid, text);
      const box = measure(g, text, { ...STYLE(), x: BALANCE.view.W / 2, y: baseY - lift, anchor: 'free' });
      return {
        x: box.x0 - U.padX, y: box.y0 - U.padY,
        w: box.w + U.padX * 2, h: box.h + U.padY * 2,
        lift: +lift.toFixed(2),
      };
    },
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
     * @param avoid an optional rect `{x, y, w, h}` the stack must not cover —
     *   the thing the message is ABOUT. See below.
     */
    draw(g, baseY, avoid) {
      if (!items.length) return;
      /* ---- A MESSAGE MUST NOT OBSCURE ITS OWN SUBJECT (queue item 5) -----
         "the 'Biscuit is full' toast sits directly over the bowl it refers
         to", and in Play a toast covered the very ball it named. Both were
         perfectly legible — `ui/text.js` guarantees that — so no contrast gate
         could see it: the defect is placement, and the only thing that knows
         the subject's rect is the caller.

         The whole stack lifts as one, by exactly the overlap plus a margin, so
         the messages never reorder or jump about relative to each other. It
         lifts UP because everything a toast talks about is at the bottom of the
         screen (the bowls, the ball, the nav) and the room above him is empty
         wall — and it is bounded, because a toast that climbs onto his face to
         get out of the way of a bowl has solved nothing. */
      baseY -= liftFor(g, baseY, avoid, items[0].text);
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
          /* ON THE RAMP (stage 9): `label-md`, 14/20/600, at weight 700. The
             hardcoded 13.5 was fine and arbitrary; this is the same size the
             sheet rows use, which is the point of having a ramp — a toast and a
             row label are the same rank of thing and should not differ by half a
             pixel for no reason. `U.size` stays in balance.js as the override
             hook it always was. */
          ...type('labelMd', { weight: 700 }),
          x: BALANCE.view.W / 2,
          y: baseY - i * U.step - (1 - a) * 6,
          anchor: 'free',
          padX: U.padX,
          padY: U.padY,
          fade: clamp(a, 0, 1),
        });
      }
    },
  };
}

export default createToasts;
