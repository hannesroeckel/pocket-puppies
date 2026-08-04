/* ==========================================================================
   ui/tokens.js — THE ONE PLACE THE GAME'S CHROME NAMES A COLOUR.

   WHY THIS EXISTS. An audit before this file counted 245 colour literals in
   the UI layer, and they were not 245 colours — they were about twelve
   colours typed out from memory, slightly differently, in nine modules:

     "the card"    #fdf3df  #fff2e1  #fff8f3  #f6e8d2  #f4e6d0  #f7e7cd
     "the ink"     #5d3018 (x25)  #4a2a14  #3a1c0c  #6b3a24
     "soft ink"    rgba(93,48,24, .42 .48 .58 .60 .62 .66 .72 .76 .80)

   Nine alphas of one brown, each picked by eye at a different keystroke. None
   of it looked broken. None of it looked like one product either, and that is
   the whole complaint: consistency is not a colour, it is the absence of
   twelve near-misses.

   `docs/DESIGN-REF.md` supplied a systematised Material-3 warm set that lands
   within a couple of channel steps of what was already on screen, so this is
   CONSOLIDATION, not a repaint. The values live in `BALANCE.ui.tokens` (every
   tunable in balance.js, per §1); this module gives them ergonomic names, the
   semantic role aliases the migration needs, and the small derived helpers.

   HOW TO USE IT:
     import { INK, SURF, R, type } from './tokens.js';
     c.fillStyle = SURF.card;
     drawText(g, label, { ...type('labelMd'), ink: INK.body, over: SURF.card });

   RULES.
   1. No module outside this one may write a colour literal for CHROME.
   2. SCENE ART IS NOT CHROME and is out of scope, deliberately. The room's
      wall, floor and rug (`scenes/room.js` C), the hand-drawn route map, every
      prop and every breed coat stay where they are — `scenes/room.js:46`
      already drew that line ("scene art, not a design tunable") and it is the
      right line. Tokenising a painting does not make it consistent, it makes
      it beige. What was inconsistent was the CHROME sitting on top.
   3. Token values must stay in the two formats `ui/text.js`'s `parseColor`
      accepts — `#rrggbb` or `rgba()`. It does not parse `#rrggbbaa` or named
      colours, and would silently return black.

   DARK MODE. `index.html` pins `<meta name="color-scheme" content="light">`,
   so the target phone being set to dark cannot recolour the one DOM input or
   the save-code textarea. Everything else is canvas, drawn in these values, so
   the game looks the same in both — which is what we want for a warm sunlit
   room. There is no dark theme and this file is not the place to start one.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { rgba } from '../engine/draw.js';

const TK = BALANCE.ui.tokens;

/* ---- the raw token groups, re-exported under short names --------------- */
export const C = TK.color;
export const TYPE = TK.type;
export const R = TK.radius;
export const SP = TK.space;
export const PRESS = TK.press;
export const SHADOW = TK.shadow;
export const WELL = TK.well;
export const STITCH = TK.stitch;
export const NEEDS = TK.needs;

/* ---- alpha helper ------------------------------------------------------
   `engine/draw.js` already had `rgba(hex, a)`; naming it here means the nine
   hand-picked alphas of one brown collapse to one base and a number, and a
   reader can see at a glance that `INK.soft(0.62)` and `INK.soft(0.66)` were
   never meant to be different colours. */
export const alpha = rgba;

/* ==========================================================================
   SEMANTIC ROLES — what the migration actually renames to.

   Each line records the literal it replaces, because the useful thing about a
   consolidation is being able to check it did not change the look by accident.
   ========================================================================== */

/** ink. Type and glyphs. */
export const INK = {
  /** body copy and row labels.            was #5d3018 (x25) */
  body: C.onSurface,
  /** secondary copy: notes, sub-labels.   was rgba(93,48,24, .58-.80) */
  soft: (a) => (a === undefined ? C.onSurfaceVariant : alpha(C.onSurfaceVariant, a)),
  /** the greyed-out state: locked, unaffordable, unavailable. */
  faint: (a = 0.55) => alpha(C.onSurfaceVariant, a),
  /** headings and primary emphasis.       was #5d3018 at weight 700-800 */
  heading: C.primary,
  /** ink that sits ON a warm/filled chip. was #3a1c0c (x6) */
  onWarm: C.deepBark,
  /** ink on a dark scrim (the naming beat, the reveal). was #ffeccd/#fff3d8 */
  onDark: C.inverseOnSurface,
  /** ink on a FILLED primary button (SURF.chipStrong) */
  onStrong: C.inverseOnSurface,
  /** drawn glyphs — nav icons, coin, paw. was #6b3a24 (x4) */
  glyph: C.primary,
};

/** surfaces. Ground, cards, rows, chips. */
export const SURF = {
  /** the page ground behind chrome.       (new; the room draws its own art) */
  ground: C.surface,
  /** a panel or sheet.                    was #fdf3df (x6) */
  card: C.surfaceLow,
  /** a row inside a panel.                was #f7e7cd (x3) */
  row: C.surfaceContainer,
  /** a row that is unavailable.           was #efe3d2 (x2) */
  rowOff: C.surfaceDim,
  /** translucent cream chrome over art.   was #fff8ea (x6) */
  chrome: C.surface,
  /** a recessed well: meter tracks, insets. was rgba(120,66,42,0.22) */
  well: C.surfaceHighest,
  /** the warm call-to-action chip.        was #e9954f (x4) */
  chipWarm: C.secondaryContainer,
  /**
   * A FILLED primary button — dark, with `INK.onStrong` cream on it.
   *
   * The supplied palette has no saturated orange, which is what the install
   * card's primary button used (`#d9a45e`). Its two buttons therefore came out
   * of the token set at nearly the same lightness (`#fed6a7` vs `#fde5bf`),
   * differing only in saturation, which is not enough to say "this is the
   * action". Material 3's own answer for a filled button is the `primary` role
   * with light ink on it, and that reads as more decisive here than the orange
   * did — so the primary action is now the darkest thing on the card rather
   * than the most saturated.
   */
  chipStrong: C.primary,
  /** a disabled chip.                     was #d8c8b2 (x2) */
  chipOff: C.surfaceDim,
  /** a secondary chip / footer pill.      was #f0dfc2 (x4) */
  chip: C.surfaceHigh,
  /** hairline borders on chrome.          was rgba(124,74,47,0.18) */
  border: (a = 0.18) => alpha(C.outline, a),
  /** the stitched-divider ink.            was #d6c3b7 */
  divider: C.outlineVariant,
  /** the full-screen scrim behind a modal. was rgba(48,24,12,0.44) etc */
  scrim: (a = 0.44) => alpha(C.deepBark, a),
  /** error, and it is used once: a rejected save code. was #d9707d */
  error: C.error,
};

/**
 * THE CONSERVATIVE NOMINAL BACKGROUND for translucent chrome.
 *
 * The name pill and the needs panel are cream drawn at alpha ~0.30 over the
 * room's wall, so nothing knows exactly what an ink composites against. Before
 * this constant every caller guessed, and guessed differently: `ui/hud.js`
 * FILLED `#fff8ea` but checked contrast against `#f6e8d2`, and `ui/nav.js`
 * used a third value again.
 *
 * The guess must err DARK. `ui/text.js` moves a dark ink further from its
 * background when the check fails, so naming a background darker than the real
 * one can only over-darken the type — legible either way. Naming one lighter
 * than the truth is how you ship cream on cream.
 */
export const NOMINAL = C.surfaceHighest;

/* ==========================================================================
   type
   ========================================================================== */
/**
 * Spread a ramp step into `ui/text.js` options.
 *
 *   drawText(g, s, { ...type('labelSm'), x, y, ink: INK.body })
 *
 * `lineScale` comes from the step's own line-height rather than one global
 * 1.32, which is the point of taking a ramp: 12/16 and 48/56 do not want the
 * same leading. `track` is letter-spacing in em — see `ui/text.js` for the
 * Safari feature-detect and why a miss is harmless.
 */
export function type(step, extra) {
  const t = TYPE[step];
  if (!t) throw new Error('ui/tokens: no type step ' + step);
  return {
    size: t.size,
    weight: t.weight,
    track: t.track,
    lineScale: t.line / t.size,
    ...extra,
  };
}

/** the ramp step names, for a verification sweep */
export const STEPS = Object.keys(TYPE);

export default { C, INK, SURF, TYPE, R, SP, PRESS, SHADOW, WELL, STITCH, NEEDS, type, alpha, NOMINAL };
