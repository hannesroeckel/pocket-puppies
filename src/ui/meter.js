/* ==========================================================================
   ui/meter.js — the heart glyph (used by the particle system) and the bubble
   meters for CARE NEEDS.

   THERE IS NO AFFECTION METER IN THIS FILE, AND THAT IS THE POINT.

   Until stage 9 there was one: `drawAffectionMeter`, unmounted, guarded by a
   comment saying it must never be mounted, and still `export default`. That is
   a guarantee made of etiquette. One `import meter from './meter.js'` and the
   bond is a number again — and the guard comment was already being read as
   permission ("it's fine, it exists, it's just not on yet").

   So it is deleted, along with the generic `drawBar` it shared a shape with.
   The REASONING is what deserved to survive, not the code:

   `docs/nintendogs-design-reference.md` §2 found the original deliberately
   shipped NO affection readout at all. Hunger, thirst and coat were inspectable
   as words; the bond was legible only off the animal — tail speed, ear position,
   whether he approaches, whether he obeys first time. The research's own words:
   *"Do not build an affection bar."* We built one in stage 1 and removed it on
   that evidence, and `docs/DESIGN-REF.md` refused the supplied mock's `Happy
   90%` bar for the same reason.

   A bond you can watch a number for is a bond you optimise instead of a
   creature you read. And a number for the bond is a number for NEGLECT, which
   is how a pet game starts accusing someone who had a busy week. "He never
   resents her" is a principle this project has spent six stages protecting.

   If you are reaching for this file to show affection, happiness, mood or a
   bond: don't. Not as a bar, not as a bubble, not as a percentage, not as a
   ring. The needs below are inspectable because she can DO something about
   them. The bond is not a need and is not a stat.
   ========================================================================== */
import { clamp, TAU, mix } from '../engine/draw.js';
import { INK, SURF, NEEDS, C, R, type, alpha } from './tokens.js';
import { insetWell, roundSub, card, stitchedDivider } from './surface.js';
import { drawText, luminance, parseColor } from './text.js';

export function heartPath(c, x, y, s, rot) {
  c.save(); c.translate(x, y); c.rotate(rot || 0); c.scale(s, s);
  c.beginPath();
  c.moveTo(0, 0.62);
  c.bezierCurveTo(-1.04, -0.16, -0.66, -1.06, 0, -0.44);
  c.bezierCurveTo(0.66, -1.06, 1.04, -0.16, 0, 0.62);
  c.closePath();
  c.restore();
}

/* ==========================================================================
   BUBBLE METERS — CARE NEEDS ONLY (stage 9)
   ==========================================================================

   The mock's treatment: a small filled circular icon, a short inset progress
   track, a tiny uppercase label. Adopted for hunger, thirst and coat — the
   three the original itself surfaced, and the three that have a BUTTON.

   READ THE FILE HEADER ABOVE BEFORE ADDING A FOURTH BAR. There is no happiness
   meter, no affection meter and no bond meter, and the reason is not taste:
   `docs/nintendogs-design-reference.md` §2 found the original deliberately
   shipped no affection readout at all, because a bond you can watch a number
   for is a bond you optimise instead of a creature you read. Quantifying it
   also quantifies NEGLECT, which is how a pet game starts accusing someone who
   had a busy week — and "he never resents her" is a principle this project has
   spent six stages protecting. `drawAffectionMeter` is not "above, unmounted"
   any more — stage 9 DELETED it, along with the generic `drawBar` it shared a
   shape with (see the file header). Do not read this row-drawing function as the
   place to reintroduce either one: it takes a `row` from a fixed table and there
   is no row for the bond, by construction.

   ENERGY IS HERE AS A WORD AND NOT AS A BAR, which is a deliberate line rather
   than an omission — see the note on `BALANCE.ui.tokens.needs`. Nothing she can
   press restores it, so a fill fraction for it would be a number to watch and
   not act on. The three that have a button get a bar; the one that has no
   button gets the sentence it always had.

   THE WORDS STAY. Every row carries `game.describeNeed(key)` beside its bar,
   because the original's scale says things a percentage cannot: "Famished" is
   not 12%, and a bar alone would have quietly dropped the best writing in the
   game.
   ========================================================================== */

/* the glyph inside a bubble. Drawn, not fonted — nothing to download. */
const BUBBLE_GLYPH = {
  /** hunger: a bowl, the same shape the nav uses, so they read as one object */
  bowl(c, x, y, r) {
    c.beginPath();
    c.moveTo(x - r, y - r * 0.22);
    c.bezierCurveTo(x - r * 0.9, y + r * 0.82, x - r * 0.4, y + r, x, y + r);
    c.bezierCurveTo(x + r * 0.4, y + r, x + r * 0.9, y + r * 0.82, x + r, y - r * 0.22);
    c.closePath(); c.fill();
    c.beginPath(); c.ellipse(x, y - r * 0.28, r * 1.04, r * 0.32, 0, 0, TAU); c.fill();
  },
  /** thirst: a droplet */
  drop(c, x, y, r) {
    c.beginPath();
    c.moveTo(x, y - r);
    c.bezierCurveTo(x + r * 0.86, y - r * 0.06, x + r * 0.7, y + r * 0.86, x, y + r * 0.86);
    c.bezierCurveTo(x - r * 0.7, y + r * 0.86, x - r * 0.86, y - r * 0.06, x, y - r);
    c.closePath(); c.fill();
  },
  /** coat: a brush — a back with bristles */
  brush(c, x, y, r) {
    roundSub(c, x - r * 0.88, y - r * 0.82, r * 1.76, r * 0.74, r * 0.3, true); c.fill();
    c.lineWidth = r * 0.2; c.lineCap = 'round';
    for (let i = -2; i <= 2; i++) {
      c.beginPath();
      c.moveTo(x + i * r * 0.36, y - r * 0.04);
      c.lineTo(x + i * r * 0.36, y + r * 0.78);
      c.stroke();
    }
  },
  /** energy: a crescent — rest, not a battery. A battery is a resource. */
  moon(c, x, y, r) {
    c.beginPath(); c.arc(x, y, r * 0.9, 0, TAU);
    c.arc(x + r * 0.52, y - r * 0.2, r * 0.82, 0, TAU, true);
    c.closePath(); c.fill('evenodd');
  },
};

/** ink that reads on a given accent — the accents run light (sky) to dark
    (caramel), so this is picked rather than assumed. */
function onAccent(accent) {
  return luminance(parseColor(accent)) > 0.45
    ? mix(accent, C.deepBark, 0.70)
    : C.inverseOnSurface;
}

/**
 * One bubble-meter row.
 *
 * @param row   a BALANCE.ui.tokens.needs.rows entry
 * @param level 0..1 satisfied, or null for a row that has no bar
 * @param word  game.describeNeed(key) — the original's scale
 * @returns the row height consumed
 */
export function drawNeedRow(g, x, y, w, row, level, word, fade) {
  const c = g.ctx;
  const N = NEEDS;
  const bx = x + N.padX + N.bubbleR;
  const cy = y + N.rowH / 2;
  const textX = bx + N.bubbleR + N.bubbleGap;
  const rightX = x + w - N.padX;
  const hasBar = row.bar !== false && level !== null && level !== undefined;

  /* ---- the bubble: a filled circle, the accent, one glyph --------------- */
  c.save();
  c.globalAlpha = fade;
  c.fillStyle = row.accent;
  c.beginPath(); c.arc(bx, cy, N.bubbleR, 0, TAU); c.fill();
  /* a hairline so a pale accent (sky-blue) still has an edge on cream */
  c.strokeStyle = alpha(C.deepBark, 0.14); c.lineWidth = 1;
  c.beginPath(); c.arc(bx, cy, N.bubbleR, 0, TAU); c.stroke();
  const gi = onAccent(row.accent);
  c.fillStyle = gi; c.strokeStyle = gi;
  const glyph = BUBBLE_GLYPH[row.icon];
  if (glyph) glyph(c, bx, cy, N.bubbleR * 0.52);
  c.restore();

  /* ---- the label, tiny and uppercase ----------------------------------- */
  const labelY = hasBar ? y + 11 : cy;
  drawText(g, row.label.toUpperCase(), {
    ...type('labelSm'), size: 9.5,
    x: textX, y: labelY, anchor: 'free', align: 'left',
    ink: INK.soft(), over: SURF.card, maxWidth: (rightX - textX) * 0.52, fade,
  });

  /* ---- the WORD, right-aligned. The thing a bar cannot say. ------------- */
  drawText(g, word, {
    ...type('labelSm'), size: 10.5,
    x: rightX, y: labelY, anchor: 'free', align: 'right',
    ink: INK.body, over: SURF.card, maxWidth: (rightX - textX) * 0.46, fade,
  });

  /* ---- the inset track ------------------------------------------------- */
  if (hasBar) {
    const tw = rightX - textX;
    const ty = y + N.rowH - N.padY - N.trackH + 1;
    c.save();
    c.globalAlpha = fade;
    insetWell(c, textX, ty, tw, N.trackH, N.trackH / 2);
    const lvl = clamp(level, 0, 1);
    /* below `lowAt` the fill warms toward `low`. A NUDGE, NOT AN ALERT: no
       badge, no count, no red dot. Research §3 — a "1" on a pet is guilt, and
       guilt is the top reason people delete these games. */
    const fill = lvl < N.lowAt ? mix(row.accent, N.low, 0.55) : row.accent;
    const fw = Math.max(N.trackH, tw * lvl);
    c.fillStyle = fill;
    roundSub(c, textX, ty, fw, N.trackH, N.trackH / 2, true); c.fill();
    /* one gloss line, so the fill reads as a filled thing and not a flat block */
    c.fillStyle = 'rgba(255,255,255,0.34)';
    roundSub(c, textX + 1, ty + 1, Math.max(1.5, fw - 2), N.trackH * 0.34,
      N.trackH * 0.17, true); c.fill();
    c.restore();
  }
  return N.rowH;
}

/**
 * The inspect panel: three bubble meters and one word row, on a real card.
 *
 * It is a CARD now rather than cream at alpha 0.30 over the wall. That was the
 * right call when the panel held only words — a word survives a vague
 * background — but a 6-unit track and a pale sky-blue fill do not, and the old
 * panel also passed a nominal `over` colour that was not the colour it actually
 * filled (see ui/tokens.js NOMINAL). Opaque means the contrast check is exact.
 *
 * @returns { x, y, w, h } so the caller can stack under it instead of guessing
 *          an offset — the hint line used to clear this panel with a hardcoded
 *          +106 that had to be re-measured by cropping in on a screenshot.
 */
export function drawNeedsPanel(g, x, y, game, fade = 1) {
  const c = g.ctx;
  const N = NEEDS;
  const w = N.panelW;
  const h = N.rows.length * N.rowH + N.padY * 2;
  if (fade > 0.002) {
    card(c, x, y, w, h, { r: R.md, fade: fade * 0.97 });
    let ry = y + N.padY;
    for (let i = 0; i < N.rows.length; i++) {
      const row = N.rows[i];
      const lvl = row.bar === false ? null : game.dog.needs[row.key];
      ry += drawNeedRow(g, x, ry, w, row, lvl, game.describeNeed(row.key), fade);
      /* the stitched divider between rows — the rug is already stitched, so a
         dashed rule reads as the same hand rather than as a table border */
      if (i < N.rows.length - 1) {
        stitchedDivider(c, x + N.padX, ry - 0.5, x + w - N.padX, { fade: fade * 0.7 });
      }
    }
  }
  return { x, y, w, h };
}

/* NO DEFAULT EXPORT, deliberately. This module's default used to be
   `drawAffectionMeter`, which meant the one thing that must never be drawn was
   also the easiest thing in the file to import. The two named exports above are
   the whole public surface: `heartPath` for the particle system and
   `drawNeedsPanel` for the inspect panel. `describeLevel` and `drawBar` were
   removed with it — both were dead, and `drawBar` was a generic unlabelled bar,
   i.e. exactly the shape someone would reach for to put the bond on screen. */
