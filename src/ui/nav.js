/* ==========================================================================
   ui/nav.js — the bottom navigation row.

   FIVE PILLS, NOT EIGHT (stage 9, decision 3 in docs/DESIGN-REF.md).

   Stage 6 ended with eight pills across 390 virtual units. That is 40.5 units
   each, and the note it left admitted the problem while shipping it: 40.5 is
   under the 44 tap-target guideline, and the mitigation was that the whole band
   is a hit target so a thumb landing in a gap still presses the NEAREST pill.
   Which is true, and is the wrong fix — it means a miss is silently resolved
   into a neighbour, so the failure mode of a cramped nav is not "nothing
   happened" but "the wrong screen opened". On a one-handed reach across the
   bottom of a 390-wide phone, that is the worst of the two.

   Five pills give 68.4 units each. The nearest-pill rule stays, because gaps
   should still not fall through to the dog, but it is now slop rather than
   structure.

   WHAT MOVED, AND NOTHING BECAME UNREACHABLE:
     Care  Play  Train  Walk  More
   `More` opens a sheet holding Shop, Dogs (the kennel), the Ring and Settings.
   Every one of those was one tap and is now two; none of them is a thing you
   reach mid-interaction, and all four were already sheet-shaped surfaces. The
   four kept on the bar are the four that ARE mid-interaction: feeding, playing,
   training and going out.

   `More` also stays reachable while he is out on a walk — see `navAction` in
   scenes/room.js. That matters because renaming lives behind Settings, and the
   away state is exactly when someone fiddles with settings.

   TACTILE PRESS (ui/surface.js). Every pill is a real object with a 4-unit
   bottom edge that compresses to 1 under a thumb. This replaced a globalAlpha
   nudge from 0.40 to 0.52, which is a thing you can only notice if you already
   know it is there.

   NO SOFT SHADOW HERE, on purpose: five 32-unit blurs per frame is a real cost
   for a shadow that would sit behind a control whose whole job is already to
   look raised. See the note in ui/surface.js.

   ROUTED THROUGH ui/text.js since stage 5 — the labels shrink to fit and their
   contrast is checked against the pill the nav itself drew rather than against
   a guess. Now on the ramp's `label-sm` (12/700/+0.05em), which is what makes a
   short uppercase word read as a LABEL instead of as cramped body copy; the old
   hard 9.5 was chosen to survive seven pills and no longer has to.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { clamp, TAU } from '../engine/draw.js';
import { drawText } from './text.js';
import { INK, SURF, C, R, PRESS, type } from './tokens.js';
import { tactile, createPresses, roundSub } from './surface.js';

const N = BALANCE.ui.nav;
const W = BALANCE.view.W;

/* tiny glyphs, drawn not fonted, so there is nothing to download */
const GLYPH = {
  care(c, x, y, r) {          // bowl
    c.beginPath(); c.moveTo(x - r, y - r * 0.25);
    c.bezierCurveTo(x - r * 0.9, y + r * 0.8, x - r * 0.4, y + r, x, y + r);
    c.bezierCurveTo(x + r * 0.4, y + r, x + r * 0.9, y + r * 0.8, x + r, y - r * 0.25);
    c.closePath(); c.fill();
    c.beginPath(); c.ellipse(x, y - r * 0.3, r * 1.05, r * 0.34, 0, 0, TAU); c.fill();
  },
  walk(c, x, y, r) {          // lead / hook
    c.lineWidth = r * 0.38; c.lineCap = 'round';
    c.beginPath(); c.arc(x, y - r * 0.35, r * 0.55, Math.PI * 0.15, Math.PI * 0.95, true); c.stroke();
    c.beginPath(); c.moveTo(x + r * 0.5, y - r * 0.2);
    c.quadraticCurveTo(x + r * 0.2, y + r * 0.9, x - r * 0.6, y + r * 0.8); c.stroke();
  },
  train(c, x, y, r) {         // paw
    c.beginPath(); c.ellipse(x, y + r * 0.35, r * 0.66, r * 0.52, 0, 0, TAU); c.fill();
    for (let i = -1; i <= 1; i++) {
      c.beginPath(); c.ellipse(x + i * r * 0.52, y - r * 0.42, r * 0.21, r * 0.28, i * 0.3, 0, TAU); c.fill();
    }
  },
  play(c, x, y, r) {          // ball
    c.beginPath(); c.arc(x, y, r * 0.82, 0, TAU); c.fill();
    c.save(); c.beginPath(); c.arc(x, y, r * 0.82, 0, TAU); c.clip();
    c.globalAlpha = 0.45; c.fillStyle = SURF.chrome;
    c.beginPath(); c.moveTo(x - r, y - r * 0.2);
    c.quadraticCurveTo(x, y - r * 0.72, x + r, y - r * 0.2);
    c.lineTo(x + r, y + r * 0.1); c.quadraticCurveTo(x, y - r * 0.4, x - r, y + r * 0.1);
    c.closePath(); c.fill(); c.restore();
  },
  /* MORE: three dots. The platform convention for "there is more behind this",
     and it deliberately does not try to depict the four things it holds — a
     glyph that means shop-and-kennel-and-ring-and-settings is a glyph that
     means nothing. */
  more(c, x, y, r) {
    for (let i = -1; i <= 1; i++) {
      c.beginPath(); c.arc(x + i * r * 0.62, y, r * 0.21, 0, TAU); c.fill();
    }
  },
  /* kept: the kennel's two-heads glyph, now used by the More sheet's row */
  dogs(c, x, y, r) {
    c.save();
    c.globalAlpha = 0.55;
    c.beginPath(); c.arc(x + r * 0.42, y - r * 0.10, r * 0.52, 0, TAU); c.fill();
    c.beginPath(); c.ellipse(x + r * 0.08, y - r * 0.62, r * 0.20, r * 0.28, -0.35, 0, TAU); c.fill();
    c.beginPath(); c.ellipse(x + r * 0.80, y - r * 0.60, r * 0.20, r * 0.28, 0.35, 0, TAU); c.fill();
    c.restore();
    c.beginPath(); c.arc(x - r * 0.34, y + r * 0.16, r * 0.56, 0, TAU); c.fill();
    c.beginPath(); c.ellipse(x - r * 0.72, y - r * 0.42, r * 0.22, r * 0.30, -0.38, 0, TAU); c.fill();
    c.beginPath(); c.ellipse(x + r * 0.04, y - r * 0.42, r * 0.22, r * 0.30, 0.38, 0, TAU); c.fill();
  },
};

export { GLYPH };

export function createNav(items, opts = {}) {
  const presses = createPresses(opts.reduced);
  let pressedId = '';

  const nav = {
    items,
    y: 0, h: N.h,
    /** the id of the surface currently open, drawn as the selected pill */
    active: '',
    get pressed() { return pressedId; },
    /** kept as an assignable property: scenes/room.js sets `nav.pressed = id` */
    set pressed(id) {
      if (pressedId && pressedId !== id) presses.set(pressedId, false);
      pressedId = id || '';
      if (pressedId) presses.set(pressedId, true);
      else presses.clear();
    },
    /** the tactile press needs a clock */
    update(dt) { presses.update(dt); },

    /** call when the safe-area inset changes */
    layout(safeBottom) {
      nav.h = N.h;
      /* the tactile edge hangs BELOW the face, so the face has to move up by it
         or the bottom edge eats into the home-bar clearance. The target device
         reports 40px bottom; at h=60 this puts the edge's bottom at 798 with
         the safe band ending at 804. */
      nav.y = BALANCE.view.H - N.h - PRESS.edge - Math.max(6, safeBottom) - 6;
    },
    bounds(i) {
      const n = items.length;
      const pad = N.pad;
      const total = W - pad * 2;
      const bw = (total - N.gap * (n - 1)) / n;
      return { x: pad + i * (bw + N.gap), y: nav.y, w: bw, h: nav.h };
    },
    /**
     * The whole nav band is a hit target: the gaps between pills would
     * otherwise fall through to the play surface, so a thumb landing between
     * two buttons pokes the room instead of pressing anything. Inside the
     * band, the nearest pill wins.
     *
     * The band now includes the tactile edge plus a little slop above, so the
     * bottom 4 units of a pill are pressable rather than decorative.
     */
    hit(x, y) {
      if (y < nav.y - 4 || y > nav.y + nav.h + PRESS.edge + 2) return null;
      let best = null, bd = Infinity;
      for (let i = 0; i < items.length; i++) {
        const b = nav.bounds(i);
        const d = Math.abs(x - (b.x + b.w / 2));
        if (d < bd) { bd = d; best = items[i]; }
      }
      return best;
    },
    draw(g) {
      const c = g.ctx;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const b = nav.bounds(i);
        const dim = it.available === false;
        const p = presses.at(it.id);
        const on = nav.active && nav.active === it.id;
        /* the SELECTED pill, from the mock's `secondary-container`. Real
           information: it says which surface is open, which an eight-pill bar
           had no room to say. */
        const face = on ? SURF.chipWarm : C.surfaceContainer;
        const f = tactile(c, {
          x: b.x, y: b.y, w: b.w, h: b.h, r: R.md, p, face,
          fade: dim ? 0.55 : 1,
        });
        /* the glyph, offset by the press so it sinks WITH the face */
        c.save();
        c.globalAlpha = dim ? 0.5 : 0.95;
        const gi = on ? INK.onWarm : INK.glyph;
        c.fillStyle = gi; c.strokeStyle = gi;
        const glyph = GLYPH[it.icon || it.id];
        if (glyph) glyph(c, b.x + b.w / 2, b.y + f.dy + b.h * 0.40, N.iconR);
        c.restore();
        /* the label, after the pill, so `over` is true of what is behind it */
        drawText(g, it.label.toUpperCase(), {
          ...type('labelSm'),
          x: b.x + b.w / 2, y: b.y + f.dy + b.h * 0.78, anchor: 'free',
          ink: on ? INK.onWarm : INK.body, over: face,
          maxWidth: b.w - 8, fade: dim ? 0.55 : 1,
        });
      }
    },
  };
  nav.layout(opts.safeBottom || 0);
  return nav;
}

export default createNav;
