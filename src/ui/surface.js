/* ==========================================================================
   ui/surface.js — the four surface treatments taken from docs/DESIGN-REF.md,
   reproduced in Canvas2D so nothing is fetched.

     tactile()          a control with a compressing bottom edge
     softShadow()       the WARM soft shadow, never grey
     insetWell()        anything recessed
     stitchedDivider()  2px dashed, the same hand as the rug

   THE TACTILE PRESS IS THE POINT OF THIS FILE. DESIGN-REF calls it "the single
   best idea in the mock" and it is, because of what it does to a cozy game
   specifically: a rectangle that changes colour under a thumb is a state
   change, and a rectangle with a visible bottom edge that COMPRESSES is an
   object. This game is about a creature that has weight and springs; its
   buttons having weight too is not decoration, it is the same claim.

   The CSS is `border-bottom: 4px` -> `1px` plus `translateY(2px)` over 100ms.
   Reproduced exactly, in `tactile()`:

       at rest   face at y,   edge 4 below it   -> bottom edge at y+h+4
       pressed   face at y+2, edge 1 below it   -> bottom edge at y+h+3

   The top sinks 2 and the bottom rises 1, so the control gets SHORTER as well
   as lower. That asymmetry is what reads as compression rather than as a slide,
   and getting it wrong (moving both edges down together) is why a lot of
   "tactile" buttons feel like they are falling instead of squashing.

   WHAT IS NOT HERE, AND WHY. The mock's `.glass-overlay` (backdrop blur +
   translucent white) is not reproduced. Canvas2D has no backdrop filter, so it
   would mean reading the frame back and blurring it per frame — a real cost, at
   fill-rate the budget does not have (§1 caps DPR for exactly this reason), to
   arrive at an effect that is nearly invisible over a warm cream room. The
   sheet's opaque panel plus `SURF.scrim()` already does the job it was there to
   do, and does it at zero cost.
   ========================================================================== */
import { clamp, smooth, mix } from '../engine/draw.js';
import { C, SURF, SHADOW, WELL, STITCH, PRESS, R } from './tokens.js';

/* ==========================================================================
   paths
   ========================================================================== */
/**
 * A rounded-rect SUBPATH. `engine/draw.js`'s `roundRect` calls `beginPath()`,
 * which silently discards whatever compound path you were building — and the
 * inset well needs exactly such a compound path (an outer rect with an inner
 * hole). So this variant makes starting a new path a choice.
 */
export function roundSub(c, x, y, w, h, r, startNew) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  if (startNew) c.beginPath();
  c.moveTo(x + rr, y);
  c.lineTo(x + w - rr, y); c.quadraticCurveTo(x + w, y, x + w, y + rr);
  c.lineTo(x + w, y + h - rr); c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  c.lineTo(x + rr, y + h); c.quadraticCurveTo(x, y + h, x, y + h - rr);
  c.lineTo(x, y + rr); c.quadraticCurveTo(x, y, x + rr, y);
  c.closePath();
}

/* ==========================================================================
   press tracking
   ========================================================================== */
/**
 * Eased press progress, keyed by control id.
 *
 * A press is 0..1 and takes `PRESS.dur` (100ms) to travel, so releasing
 * mid-press reverses from where it actually is rather than snapping — which is
 * the difference between a button and a light switch.
 *
 * REDUCED MOTION SNAPS RATHER THAN SLOWS. `prefers-reduced-motion` asks for
 * less motion, not less feedback: a control that does not acknowledge a thumb
 * is broken, not calm. So the treatment stays and the tween goes
 * (`PRESS.reducedDur` is 0), which also means a reduced-motion player gets the
 * press faster, not slower.
 */
export function createPresses(reduced) {
  const dur = reduced ? PRESS.reducedDur : PRESS.dur;
  /** id -> { u: raw 0..1 linear progress, to: 0|1 } */
  const m = new Map();
  return {
    /** mark a control down (or not). Unknown ids are created on demand. */
    set(id, down) {
      if (!id) return;
      const e = m.get(id) || { u: 0, to: 0 };
      e.to = down ? 1 : 0;
      if (dur <= 0) e.u = e.to;
      m.set(id, e);
    },
    /** everything up */
    clear() { for (const e of m.values()) { e.to = 0; if (dur <= 0) e.u = 0; } },
    /** eased 0..1 for a control */
    at(id) {
      const e = m.get(id);
      return e ? smooth(e.u) : 0;
    },
    update(dt) {
      if (dur <= 0) return;
      const step = dt / dur;
      for (const e of m.values()) {
        if (e.u === e.to) continue;
        e.u = e.to > e.u ? Math.min(e.to, e.u + step) : Math.max(e.to, e.u - step);
      }
    },
    /** so a scene can drop state when it tears down */
    get size() { return m.size; },
  };
}

/* ==========================================================================
   the tactile control
   ========================================================================== */
/**
 * Draw a pressable face with a compressing bottom edge.
 *
 * @param o {
 *   x, y, w, h        the RESTING face box. The edge is drawn BELOW y+h, so a
 *                     control reserves h + PRESS.edge of vertical space.
 *   r                 corner radius (default R.md)
 *   p                 press progress 0..1 (from createPresses().at(id))
 *   face              face colour, a hex (default SURF.row)
 *   edge              edge colour, a hex. Default: the face mixed toward
 *                     deep-bark, so one token gives a matched pair and nobody
 *                     hand-picks a second brown.
 *   border            hairline alpha, or 0 for none
 *   fade              0..1 overall opacity
 * }
 * @returns { x, y, w, h, dy } the face box AS DRAWN — content must be offset by
 *          `dy` too, or the label stays put while the button sinks underneath
 *          it, which looks like a bug and is the one mistake this returns for.
 */
export function tactile(c, o) {
  const p = clamp(o.p || 0, 0, 1);
  const r = o.r === undefined ? R.md : o.r;
  const face = o.face || SURF.row;
  const depth = PRESS.edge + (PRESS.edgeDown - PRESS.edge) * p;
  const dy = PRESS.sink * p;
  const edge = o.edge || mix(face, C.deepBark, 0.26);
  const x = o.x, y = o.y + dy, w = o.w, h = o.h;
  const fade = o.fade === undefined ? 1 : clamp(o.fade, 0, 1);

  c.save();
  c.globalAlpha = fade;
  /* the edge first, as a taller rect behind the face: one rounded shape rather
     than a separate strip, so the bottom corners stay round at every depth */
  c.fillStyle = edge;
  roundSub(c, x, y, w, h + depth, r, true); c.fill();
  /* the face */
  c.fillStyle = face;
  roundSub(c, x, y, w, h, r, true); c.fill();
  if (o.border !== 0) {
    c.strokeStyle = SURF.border(o.border === undefined ? 0.18 : o.border);
    c.lineWidth = 1.1;
    roundSub(c, x, y, w, h, r, true); c.stroke();
  }
  c.restore();
  return { x, y, w, h, dy };
}

/**
 * THE PRIMARY ACTION — the one big button on a surface, drawn one way.
 *
 * Before stage 9 the game had three of these and they did not know about each
 * other: the install card's "Got it" was saturated orange `#d9a45e`, the route
 * map's "Set off" was `#e9954f` gold, and the ring's "Into the ring" was
 * `C.ribbon` terracotta — three different hues, three different shadow
 * treatments (none, a 1.4px stroke, a fake 3px offset rect), all meaning
 * exactly the same thing: *this is the button*.
 *
 * Now they are one call. The face is `SURF.chipStrong` — see the long note on
 * that token for why the primary action became the DARKEST thing on a surface
 * rather than the most saturated: the supplied palette has no saturated orange,
 * and two of its light containers differ only in saturation, which is not
 * enough to carry "press this".
 *
 * It is a `tactile()`, so the biggest button in the game is also the one that
 * most obviously behaves like an object under a thumb. Callers pass their own
 * press progress; a caller with no press tracking passes nothing and gets the
 * resting edge, which still unifies the look.
 *
 * NOTE ON GEOMETRY: like `tactile()`, this reserves `h + PRESS.edge` of
 * vertical space and `o.y` is the top of the RESTING FACE. Callers converting
 * from a plain `roundRect` should lift `y` by `PRESS.edge / 2` to keep the
 * optical centre where it was, and must offset their label by the returned
 * `dy` or the text will float while the button sinks.
 */
export function primaryAction(c, o) {
  return tactile(c, {
    ...o,
    r: o.r === undefined ? R.lg : o.r,
    face: o.face || SURF.chipStrong,
    /* no hairline: the face is already the darkest thing on the surface, and a
       border on it reads as a second, thinner edge fighting the real one */
    border: o.border === undefined ? 0 : o.border,
  });
}

/* ==========================================================================
   the warm soft shadow
   ========================================================================== */
/**
 * `0 12px 32px -4px rgba(131,83,43,.12)` — WARM, never grey.
 *
 * Canvas2D has no shadow SPREAD, so the `-4px` is reproduced by casting from a
 * path shrunk by `SHADOW.inset`. The caster is filled in the shadow's own
 * colour and is smaller than the face that will cover it, so it never shows.
 *
 * Call this BEFORE drawing the face, with the face's geometry.
 *
 * COST. `shadowBlur` at 32 virtual units is a real per-pixel cost at DPR 2-3,
 * so this is for CARDS AND PANELS — things that are few and mostly modal — and
 * deliberately not for the nav pills. Five blurred pills every frame would buy
 * a shadow nobody can see behind a control that already has a tactile edge.
 * The nav gets one shadow for the whole band instead.
 */
export function softShadow(c, x, y, w, h, r, o = {}) {
  const inset = o.inset === undefined ? SHADOW.inset : o.inset;
  const col = o.color || SHADOW.color;
  c.save();
  c.globalAlpha = o.fade === undefined ? 1 : clamp(o.fade, 0, 1);
  c.shadowColor = col;
  c.shadowOffsetY = o.dy === undefined ? SHADOW.dy : o.dy;
  c.shadowBlur = o.blur === undefined ? SHADOW.blur : o.blur;
  c.fillStyle = col;
  roundSub(c, x + inset, y + inset, Math.max(1, w - inset * 2),
    Math.max(1, h - inset * 2), Math.max(0, (r === undefined ? R.md : r) - inset), true);
  c.fill();
  c.restore();
}

/**
 * A card: warm shadow, face, hairline. The shape every panel in the game was
 * open-coding three slightly different ways.
 */
export function card(c, x, y, w, h, o = {}) {
  const r = o.r === undefined ? R.md : o.r;
  const fade = o.fade === undefined ? 1 : clamp(o.fade, 0, 1);
  if (o.shadow !== false) softShadow(c, x, y, w, h, r, { fade });
  c.save();
  c.globalAlpha = fade;
  c.fillStyle = o.fill || SURF.card;
  roundSub(c, x, y, w, h, r, true); c.fill();
  if (o.border !== 0) {
    c.strokeStyle = SURF.border(o.border === undefined ? 0.18 : o.border);
    c.lineWidth = 1.2;
    roundSub(c, x, y, w, h, r, true); c.stroke();
  }
  c.restore();
  return { x, y, w, h, r };
}

/* ==========================================================================
   inset wells
   ========================================================================== */
/**
 * `inset 0 2px 4px rgba(0,0,0,.05-.1)` — for anything recessed: a meter track,
 * a pressed-in chip, a slot something sits in.
 *
 * The shadow is cast INWARD by clipping to the well and then filling the region
 * OUTSIDE it (an outer rect with the well punched out, even-odd). The fill
 * itself lands entirely outside the clip so it is invisible; only its shadow,
 * offset down by 2, falls inside. That is a real inset shadow rather than a
 * gradient that approximates one, and it costs one small blur.
 */
export function insetWell(c, x, y, w, h, r, o = {}) {
  const rr = Math.min(r === undefined ? R.sm : r, w / 2, h / 2);
  const a = o.alpha === undefined ? WELL.alpha : o.alpha;
  c.save();
  if (o.fill !== 'none') {
    c.fillStyle = o.fill || SURF.well;
    roundSub(c, x, y, w, h, rr, true); c.fill();
  }
  roundSub(c, x, y, w, h, rr, true);
  c.clip();
  c.beginPath();
  c.rect(x - 60, y - 60, w + 120, h + 120);
  roundSub(c, x, y, w, h, rr, false);
  c.shadowColor = `rgba(0,0,0,${a.toFixed(3)})`;
  c.shadowOffsetY = o.dy === undefined ? WELL.dy : o.dy;
  c.shadowBlur = o.blur === undefined ? WELL.blur : o.blur;
  c.fillStyle = '#000';
  c.fill('evenodd');
  c.restore();
}

/* ==========================================================================
   the stitched divider
   ========================================================================== */
/**
 * 2px dashed. It suits THIS game rather than being a generic separator: the rug
 * in the room already has stitching around its edge, so a dashed rule reads as
 * the same hand that made the room instead of as a border from a component kit.
 */
export function stitchedDivider(c, x1, y, x2, o = {}) {
  c.save();
  c.strokeStyle = o.color || STITCH.color;
  c.lineWidth = o.w === undefined ? STITCH.w : o.w;
  c.lineCap = 'round';
  c.globalAlpha = o.fade === undefined ? 1 : clamp(o.fade, 0, 1);
  c.setLineDash(o.dash || STITCH.dash);
  c.beginPath();
  c.moveTo(x1, y);
  c.lineTo(x2, y);
  c.stroke();
  /* leaving a dash pattern on the shared context would dot the next thing that
     strokes — a silhouette, a leash, the map's ink */
  c.setLineDash([]);
  c.restore();
}

export default {
  tactile, primaryAction, softShadow, card, insetWell, stitchedDivider,
  createPresses, roundSub,
};
