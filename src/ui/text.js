/* ==========================================================================
   ui/text.js — THE ONE PLACE CANVAS TEXT IS DRAWN.

   WHY THIS EXISTS. Three separate legibility failures shipped on this project,
   all of them the same failure:

     stage 3  the cue legend was cream (#fff2d6) over the cream signal pad and
              the sunlit window art. Effectively invisible.
     stage 4  the anticipation copy ("He cannot keep his feet still") was cream
              (#fff0d4) over the cream wall, at alpha 0.63, at a hard y=82 that
              takes no account of the notch.
     (and)    the naming title is positioned off a hardcoded VW/2 with no
              awareness of the safe area at all.

   The shared cause is CANVAS TEXT DRAWN STRAIGHT OVER BACKGROUND ART WITH NO
   CONTRAST GUARANTEE AND NO SAFE-AREA AWARENESS. A drop shadow is not a
   guarantee — it is a hope that the art behind happens to be light. Every one
   of the 32 fillText sites audited before this file existed re-declared the
   same font stack and made its own private guess about legibility.

   So this module makes three promises, and they are promises rather than
   conventions because they are enforced by construction:

   1. GUARANTEED MINIMUM CONTRAST, WHATEVER IS BEHIND.
      The backing plate is not a fixed alpha someone liked the look of. Given
      an ink colour and a plate colour, `plateAlpha()` SOLVES for the smallest
      alpha at which the WORST POSSIBLE background — pure black or pure white
      showing through the plate — still clears the target ratio. Because
      luminance is monotonic per channel, those two are genuinely the extremes,
      so clearing both clears everything. It cannot be defeated by art nobody
      has drawn yet, by a dark-mode phone, or by a scrim another layer adds.

   2. SAFE-AREA AWARENESS.
      `safeBand()` converts `env(safe-area-inset-*)` (read into `view.safe` by
      main.js) from CSS pixels into virtual units, and `anchor: 'top'|'bottom'`
      positions relative to that edge rather than to the raw frame. Copy is
      then clamped so its BOX — not its baseline — stays inside the band. The
      target device reports 20px top / 40px bottom.

   3. IT NEVER RUNS OFF THE EDGE.
      The type shrinks to fit the safe horizontal band, down to `minSize`, and
      ellipsises only after that. Nothing is ever clipped by the frame.

   WHAT THIS IS NOT. It is not a layout engine and it does not own the game's
   look. `over` lets a caller say "I have already drawn an opaque card here" —
   the contrast is then checked against that known colour exactly and no plate
   is drawn unless the check fails. That is how the find card and the route map
   keep their hand-drawn paper.

   HONEST LIMIT: the guarantee is defined at the text's full opacity. Text that
   is fading in or out is, unavoidably, low-contrast on the way through —
   contrast against a background you are dissolving into is not a thing that
   exists. Use `fade` for transitions, never as a style.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { clamp, roundRect } from '../engine/draw.js';

const T = BALANCE.ui.text;
const VW = BALANCE.view.W;
const VH = BALANCE.view.H;

/** the one font stack. It was written out 32 times before this line existed. */
export const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
export const font = (size, weight = 600) => `${weight} ${size}px ${FONT}`;

/* ==========================================================================
   colour + contrast (WCAG 2.1 relative luminance)
   ========================================================================== */
/** '#abc' | '#aabbcc' | 'rgb(..)' | 'rgba(..)' -> [r,g,b,a] with r,g,b in 0..1 */
export function parseColor(c) {
  if (Array.isArray(c)) return c;
  const s = String(c).trim();
  if (s[0] === '#') {
    let h = s.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    if (!Number.isFinite(n)) return [0, 0, 0, 1];
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
  }
  const m = s.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const p = m[1].split(',').map((v) => parseFloat(v));
    return [clamp((p[0] || 0) / 255, 0, 1), clamp((p[1] || 0) / 255, 0, 1),
      clamp((p[2] || 0) / 255, 0, 1), p.length > 3 && Number.isFinite(p[3]) ? clamp(p[3], 0, 1) : 1];
  }
  return [0, 0, 0, 1];
}

const linear = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

/** WCAG relative luminance of an [r,g,b] triple in 0..1 sRGB */
export function luminance(rgb) {
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
}

/** WCAG contrast ratio between two luminances */
export const ratio = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

/** contrast between two colours, given exactly (both opaque) */
export function contrast(a, b) {
  return ratio(luminance(parseColor(a)), luminance(parseColor(b)));
}

/** src composited over dst with alpha `a`, per channel, in sRGB (source-over) */
const composite = (src, dst, a) => [
  src[0] * a + dst[0] * (1 - a),
  src[1] * a + dst[1] * (1 - a),
  src[2] * a + dst[2] * (1 - a),
];

/**
 * THE GUARANTEE.
 *
 * Smallest alpha at which a plate of colour `plate` gives `ink` at least
 * `target` contrast **no matter what is behind it**.
 *
 * A plate of alpha `a` over an unknown background B shows
 * `E = a*P + (1-a)*B`. Luminance rises monotonically with every channel, so
 * over all B in [0,1]^3 the luminance of E is bounded by exactly two cases:
 * B = black and B = white. If the ink clears the target against BOTH, it
 * clears it against every background that can ever be drawn there — including
 * ones added later by a scrim, a dark-mode wall, or a stage nobody has built.
 *
 * Returns 1 if even an opaque plate cannot do it (an ink and plate too close
 * in luminance to be told apart), which callers treat as "pick a better plate".
 */
export function plateAlpha(ink, plate, target = T.contrast) {
  const key = ink + '|' + plate + '|' + target;
  const hit = ALPHA_CACHE.get(key);
  if (hit !== undefined) return hit;
  let I = parseColor(ink);
  const P = parseColor(plate);
  /* a translucent ink lands on the PLATE, so measure what actually reaches the
     eye rather than the nominal colour (see `inkFor`) */
  if (I[3] !== undefined && I[3] < 1) I = composite(I, P, I[3]);
  const li = luminance(I);
  const ok = (a) => {
    /* the two extremes: everything behind is black, or everything is white */
    const lo = luminance(composite(P, [0, 0, 0], a));
    const hi = luminance(composite(P, [1, 1, 1], a));
    /* the ink must sit OUTSIDE [lo, hi] — if it is inside, some background
       makes the plate the same luminance as the text and it vanishes */
    if (li >= hi) return ratio(li, hi) >= target;
    if (li <= lo) return ratio(li, lo) >= target;
    return false;
  };
  let a = 1;
  if (ok(1)) {
    /* binary search the smallest sufficient alpha. `ok` is monotonic in a
       because the [lo,hi] interval shrinks toward L(P) as a rises. */
    let lo = 0, hi = 1;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (ok(mid)) hi = mid; else lo = mid;
    }
    a = Math.min(1, hi + 0.005);          // a hair over the solved edge
  }
  if (ALPHA_CACHE.size > 128) ALPHA_CACHE.clear();
  ALPHA_CACHE.set(key, a);
  return a;
}
const ALPHA_CACHE = new Map();

/**
 * Nudge an ink until it clears `target` against a KNOWN opaque background,
 * by walking it away from that background's luminance. Used when a caller has
 * already drawn a card and wants no plate — the type gets darker or lighter
 * rather than acquiring a scrim it does not need.
 */
export function inkFor(ink, over, target = T.contrast) {
  const key = 'I' + ink + '|' + over + '|' + target;
  const hit = ALPHA_CACHE.get(key);
  if (hit !== undefined) return hit;
  const bg = parseColor(over);
  const lb = luminance(bg);
  let I = parseColor(ink);
  let out = ink;
  /* A TRANSLUCENT INK IS NOT ITS OWN COLOUR. `rgba(93,48,24,0.70)` reaches the
     eye as 70% of that brown plus 30% of the card underneath, which is a good
     deal lighter — and checking the nominal colour instead would report a
     contrast the player never actually gets. Since `over` is known and opaque,
     composite it for real before measuring. */
  if (I[3] !== undefined && I[3] < 1) {
    I = composite(I, bg, I[3]);
    out = `rgb(${Math.round(I[0] * 255)},${Math.round(I[1] * 255)},${Math.round(I[2] * 255)})`;
  }
  if (ratio(luminance(I), lb) < target) {
    /* walk toward black or white, whichever direction the background is not */
    const toward = lb > 0.18 ? [0, 0, 0] : [1, 1, 1];
    for (let i = 1; i <= 24; i++) {
      const k = i / 24;
      const c = composite(toward, I, k);
      if (ratio(luminance(c), lb) >= target) {
        out = `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
        break;
      }
      if (i === 24) out = lb > 0.18 ? '#000000' : '#ffffff';
    }
  }
  ALPHA_CACHE.set(key, out);
  return out;
}

/* ==========================================================================
   safe area
   ========================================================================== */
/**
 * The usable band, IN VIRTUAL UNITS. `view.safe` is in CSS pixels (read out of
 * an `env(safe-area-inset-*)` probe by main.js), and `view.vs` is the
 * virtual->CSS scale, so the division is the whole conversion.
 *
 * `T.margin` is added on top: sitting exactly on the notch boundary is legal
 * and still looks like a mistake.
 */
export function safeBand(view) {
  const vs = (view && view.vs) || 1;
  const s = (view && view.safe) || { top: 0, bottom: 0, left: 0, right: 0 };
  return {
    top: (s.top || 0) / vs + T.margin,
    bottom: VH - (s.bottom || 0) / vs - T.margin,
    left: (s.left || 0) / vs + T.margin,
    right: VW - (s.right || 0) / vs - T.margin,
  };
}

/**
 * Resolve a y in virtual units.
 *   anchor 'top'    — `y` is measured DOWN from the safe top edge
 *   anchor 'bottom' — `y` is measured UP from the safe bottom edge
 *   anchor 'free'   — `y` is absolute, and merely clamped into the band
 */
export function anchorY(view, y, anchor, half = 0) {
  const b = safeBand(view);
  let out = y;
  if (anchor === 'top') out = b.top + y;
  else if (anchor === 'bottom') out = b.bottom - y;
  return clamp(out, b.top + half, b.bottom - half);
}

/* ==========================================================================
   measuring
   ========================================================================== */
const MEASURE = new Map();
function widthOf(c, str, size, weight) {
  const key = weight + '|' + size + '|' + str;
  const hit = MEASURE.get(key);
  if (hit !== undefined) return hit;
  c.font = font(size, weight);
  const w = c.measureText(str).width;
  if (MEASURE.size > 400) MEASURE.clear();
  MEASURE.set(key, w);
  return w;
}

/** shrink-to-fit, then ellipsise. Returns { str, size, w } */
function fit(c, str, size, weight, maxW) {
  let s = size;
  let w = widthOf(c, str, s, weight);
  while (w > maxW && s > T.minSize) {
    s = Math.max(T.minSize, s - 0.5);
    w = widthOf(c, str, s, weight);
  }
  if (w <= maxW) return { str, size: s, w };
  /* still too wide at the floor: trim with an ellipsis rather than clip */
  let out = str;
  while (out.length > 1 && widthOf(c, out + '…', s, weight) > maxW) out = out.slice(0, -1);
  out += '…';
  return { str: out, size: s, w: widthOf(c, out, s, weight) };
}

/**
 * Where a string will land, without drawing it. Callers that need to hit-test
 * or stack lines use this so the geometry is computed exactly once.
 */
export function measure(g, str, o = {}) {
  const c = g.ctx;
  const view = g.view;
  const size = o.size || T.size;
  const weight = o.weight || T.weight;
  const align = o.align || 'center';
  const band = safeBand(view);
  const maxW = Math.min(o.maxWidth || (band.right - band.left), band.right - band.left);
  const f = fit(c, String(str), size, weight, maxW);
  const h = f.size * T.lineScale;
  let x = o.x === undefined ? VW / 2 : o.x;
  /* keep the BOX inside the band, not just the anchor point */
  if (align === 'center') x = clamp(x, band.left + f.w / 2, band.right - f.w / 2);
  else if (align === 'left') x = clamp(x, band.left, band.right - f.w);
  else x = clamp(x, band.left + f.w, band.right);
  const y = anchorY(view, o.y === undefined ? 0 : o.y, o.anchor || 'free', h / 2 + T.padY);
  const x0 = align === 'center' ? x - f.w / 2 : (align === 'left' ? x : x - f.w);
  return { str: f.str, size: f.size, w: f.w, h, x, y, align, weight, x0, y0: y - h / 2 };
}

/* ==========================================================================
   drawing
   ========================================================================== */
/**
 * Draw one line of copy, legibly, wherever it lands.
 *
 * @param g   the view-aware wrapper (needs `g.ctx` and `g.view`)
 * @param str the string
 * @param o   {
 *   x, y, anchor:'free'|'top'|'bottom', align:'center'|'left'|'right',
 *   size, weight, ink,
 *   over:   a KNOWN opaque backdrop colour. Contrast is then exact and no
 *           plate is drawn unless the ink fails against it (in which case the
 *           INK moves, not the background).
 *   plate:  'auto' (default) | 'none' | an explicit colour
 *   contrast: target ratio, default BALANCE.ui.text.contrast
 *   fade:   0..1 transition opacity. NOT a style — see the header.
 *   maxWidth
 * }
 * @returns the measured box, so callers can stack or hit-test.
 */
export function drawText(g, str, o = {}) {
  const c = g.ctx;
  const m = measure(g, str, o);
  const fade = o.fade === undefined ? 1 : clamp(o.fade, 0, 1);
  if (fade <= 0.002 || !m.str) return m;
  const target = o.contrast || T.contrast;
  let ink = o.ink || T.ink;

  c.save();
  c.textAlign = m.align;
  c.textBaseline = 'middle';

  if (o.over) {
    /* the caller has drawn an opaque backdrop: check exactly, move the INK if
       it fails, and never add a scrim on top of their card */
    ink = inkFor(ink, o.over, target);
  } else if (o.plate !== 'none') {
    const plateInk = (typeof o.plate === 'string' && o.plate !== 'auto')
      ? o.plate
      : (luminance(parseColor(ink)) > T.lightInkAt ? T.plateDark : T.plateLight);
    const a = plateAlpha(ink, plateInk, target);
    const padX = o.padX === undefined ? T.padX : o.padX;
    const padY = o.padY === undefined ? T.padY : o.padY;
    const px = m.x0 - padX;
    const py = m.y0 - padY;
    const pw = m.w + padX * 2;
    const ph = m.h + padY * 2;
    c.globalAlpha = a * fade;
    c.fillStyle = plateInk;
    /* the plate's own shadow, in its own colour, feathers the edge outward —
       so the core stays at the solved alpha (which is what the guarantee is
       about) while the boundary stops looking like a sticker */
    c.shadowColor = plateInk;
    c.shadowBlur = T.feather;
    roundRect(c, px, py, pw, ph, Math.min(ph / 2, T.radius));
    c.fill();
    c.shadowBlur = 0;
  }

  c.globalAlpha = fade;
  c.fillStyle = ink;
  c.font = font(m.size, m.weight);
  c.fillText(m.str, m.x, m.y);
  c.restore();
  return m;
}

/**
 * A bare backing plate, for a block this module cannot typeset itself.
 *
 * Stage 3's cue legend is the case: it interleaves drawn signal GLYPHS with
 * left- and right-aligned text, so it cannot go through `drawText` cell by
 * cell without acquiring a dozen little plates. Instead it asks for one plate
 * across the whole block and then draws its own content on top, with the same
 * guarantee: the alpha is solved for the worst possible background.
 *
 * @returns the plate colour, so the caller can pass it as `over` if it wants
 *          the contrast of its own content checked too.
 */
export function drawPlate(g, x, y, w, h, o = {}) {
  const c = g.ctx;
  const ink = o.ink || T.ink;
  const plateInk = o.plate
    || (luminance(parseColor(ink)) > T.lightInkAt ? T.plateDark : T.plateLight);
  const a = plateAlpha(ink, plateInk, o.contrast || T.contrast);
  const fade = o.fade === undefined ? 1 : clamp(o.fade, 0, 1);
  if (fade <= 0.002) return plateInk;
  c.save();
  c.globalAlpha = a * fade;
  c.fillStyle = plateInk;
  c.shadowColor = plateInk;
  c.shadowBlur = o.feather === undefined ? T.feather : o.feather;
  const r = o.radius === undefined ? T.radius : o.radius;
  roundRect(c, x, y, w, h, Math.min(r, h / 2));
  c.fill();
  c.restore();
  return plateInk;
}

/**
 * A stack of lines sharing one plate — the absence panel and the find card
 * both want this, and drawing three abutting plates leaves seams.
 * @param lines [{ text, size, weight, ink }]
 * @returns the box the stack occupied
 */
export function drawStack(g, lines, o = {}) {
  const c = g.ctx;
  const view = g.view;
  const fade = o.fade === undefined ? 1 : clamp(o.fade, 0, 1);
  const rows = (lines || []).filter((l) => l && l.text);
  if (!rows.length || fade <= 0.002) return null;
  const band = safeBand(view);
  const gap = o.gap === undefined ? T.gap : o.gap;
  const align = o.align || 'center';
  const maxW = Math.min(o.maxWidth || (band.right - band.left), band.right - band.left);
  const target = o.contrast || T.contrast;

  /* measure everything first: one plate needs the union of the boxes */
  const ms = rows.map((l) => {
    const size = l.size || o.size || T.size;
    const weight = l.weight || o.weight || T.weight;
    const f = fit(c, String(l.text), size, weight, maxW);
    return { ...f, weight, ink: l.ink || o.ink || T.ink, h: f.size * T.lineScale };
  });
  const totalH = ms.reduce((s, m) => s + m.h, 0) + gap * (ms.length - 1);
  const w = ms.reduce((s, m) => Math.max(s, m.w), 0);
  let x = o.x === undefined ? VW / 2 : o.x;
  if (align === 'center') x = clamp(x, band.left + w / 2, band.right - w / 2);
  const top = anchorY(view, o.y === undefined ? 0 : o.y, o.anchor || 'free', totalH / 2 + T.padY) - totalH / 2;
  const x0 = align === 'center' ? x - w / 2 : x;

  c.save();
  c.textAlign = align;
  c.textBaseline = 'middle';

  if (!o.over && o.plate !== 'none') {
    /* one plate for the whole block, solved against the LIGHTEST ink in it so
       every line in the stack clears the target, not just the average one */
    const plateInk = (typeof o.plate === 'string' && o.plate !== 'auto')
      ? o.plate
      : (luminance(parseColor(ms[0].ink)) > T.lightInkAt ? T.plateDark : T.plateLight);
    let a = 0;
    for (const m of ms) a = Math.max(a, plateAlpha(m.ink, plateInk, target));
    const padX = o.padX === undefined ? T.padX + 4 : o.padX;
    const padY = o.padY === undefined ? T.padY + 3 : o.padY;
    c.globalAlpha = a * fade;
    c.fillStyle = plateInk;
    c.shadowColor = plateInk;
    c.shadowBlur = T.feather;
    roundRect(c, x0 - padX, top - padY, w + padX * 2, totalH + padY * 2, T.radius);
    c.fill();
    c.shadowBlur = 0;
  }

  let y = top;
  for (const m of ms) {
    c.globalAlpha = fade * (m.alpha === undefined ? 1 : m.alpha);
    c.fillStyle = o.over ? inkFor(m.ink, o.over, target) : m.ink;
    c.font = font(m.size, m.weight);
    c.fillText(m.str, x, y + m.h / 2);
    y += m.h + gap;
  }
  c.restore();
  return { x, y: top + totalH / 2, w, h: totalH, x0, y0: top };
}

/**
 * Verification hook: what contrast does this ink actually achieve, in the
 * worst case, with the plate this module would draw? Used by the stage-4
 * legibility gate so the promise is measured rather than asserted.
 */
export function auditContrast(ink, plateInk, target = T.contrast) {
  const plate = plateInk
    || (luminance(parseColor(ink)) > T.lightInkAt ? T.plateDark : T.plateLight);
  const a = plateAlpha(ink, plate, target);
  const I = parseColor(ink);
  const P = parseColor(plate);
  const li = luminance(I);
  const lo = luminance(composite(P, [0, 0, 0], a));
  const hi = luminance(composite(P, [1, 1, 1], a));
  return {
    ink, plate, alpha: +a.toFixed(3),
    onBlack: +ratio(li, lo).toFixed(2),
    onWhite: +ratio(li, hi).toFixed(2),
    worst: +Math.min(ratio(li, lo), ratio(li, hi)).toFixed(2),
    pass: Math.min(ratio(li, lo), ratio(li, hi)) >= target,
  };
}

export default { drawText, drawStack, measure, safeBand, anchorY, contrast, plateAlpha, auditContrast, font, FONT };
