/* ==========================================================================
   ui/reach.js — THE REACHABLE PLAY AREA. One bottom line, derived, read by all.

   WHAT WENT WRONG, AND WHY A NUMBER WAS NEVER GOING TO FIX IT.

   The toy's resting positions were absolute virtual y values — 736 at home,
   782 after a flinch, 792 after a fetch — and not one of them knew the nav
   existed. The nav's band, meanwhile, is not a constant either: it is derived
   from `env(safe-area-inset-bottom)`, so its top edge is at y 768 on a phone
   with no notch and at y 734 on the iPhone this is a gift for. Stage 9 also
   moved it, by taking the bar from eight pills to five and `h` from 58 to 60.

   So three hardcoded ball positions were being compared, by nobody, against a
   line that moves with the device AND with the design. On the target phone the
   flinch drop landed at 782, which is 48 units INSIDE the band — and because
   `scenes/room.js` dispatches `nav.hit()` before `toy.pointer()`, a touch on
   the ball pressed TRAIN instead of picking it up. The ball was gone for good:
   the auto-retrieval only fires for `toy.y < 660` and `reset(true)` is never
   called, so the punishment for accidentally hitting him with the ball was
   losing the ball permanently. The ball's own HOME had 61% of its hit area
   under the bar from the very first launch; its centre pressed MORE.

   THE SHAPE OF THE FIX IS THE BOWL'S. `rig.floorV` is the one line the room's
   floor is, and four bowl defects were caused by things resolving against a
   private copy of it instead. This is the same idea for the BOTTOM OF WHAT A
   THUMB CAN TOUCH, and the same rule: one definition, everyone reads it, and
   the number nobody has to remember is the number nobody can get wrong.

   TWO LINES, NOT ONE. `rig.floorV` and `reach.bottom` are deliberately
   separate and they answer different questions:

     rig.floorV     WHERE THINGS STAND. Room space, fake perspective, breed
                    dependent (719.8-721.8 across the three that ship). A prop
                    is authored against it because that is what makes it look
                    like it is on the floor.
     reach.bottom   WHERE A THUMB STOPS. View space, device dependent, moves
                    ~34 units between a notched phone and a flat one. It is a
                    BOUND, not an anchor.

   They cannot be merged, because on the target phone the bound is ABOVE the
   floor: reach.bottom is 722 and floorV is 721.8, and once a prop's hit radius
   is taken off that, nothing can sit on the floor toward the viewer and still
   be touchable. The foreground below the reach line belongs to the nav. So the
   sharing is a CONTRACT rather than a merge: props are AUTHORED as offsets
   from `rig.floorV` (`BALANCE.toy.rest`, `BALANCE.care.bowlHome`, ...) and then
   every one of them is passed through `clampY()` before it is written. Where
   there is room the authored design is byte-for-byte what it always was; where
   there is not, the bound wins and says so.

   HOW TO USE IT — this is the whole API a future prop needs:

       import reach from '../ui/reach.js';
       p.y = reach.clampY(rig.floorV + REST_OFFSET, p.hitHalfH);

   and, so the per-frame assertion can see it:

       reach.watch('mything', () => ({ id:'mything', state, x, y, rx, ry, live }));

   THE NAV'S GEOMETRY LIVES HERE TOO, and `ui/nav.js` imports it rather than
   keeping its own copy. That is the part that makes this hold: the bar and the
   bound are computed by the same two functions from the same inset, so they
   cannot drift apart the way the ball and the bar did.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { PRESS } from './tokens.js';

const V = BALANCE.view;
const N = BALANCE.ui.nav;
const RE = BALANCE.ui.reach;

/* ==========================================================================
   the nav's geometry — the one copy
   ========================================================================== */
/**
 * The top of the nav's RESTING FACE, in virtual units.
 *
 * `PRESS.edge` is subtracted because the tactile bottom edge hangs BELOW the
 * face, so a pill reserves `h + edge`; `minInset` keeps the bar off the very
 * bottom on a device that reports no inset at all; `gapBelow` is the clearance
 * left under the edge. On the target iPhone (inset 40) this is 734, and the
 * pill's lowest pixel lands at 798 with the safe band ending at 804.
 */
export function navFaceTop(safeBottom) {
  const sb = Number.isFinite(+safeBottom) ? +safeBottom : 0;
  return V.H - N.h - PRESS.edge - Math.max(N.minInset, sb) - N.gapBelow;
}

/**
 * The nav's FULL HIT RECT — which is bigger than the drawn band, and is the
 * rect that actually steals touches. `ui/nav.js`'s `hit()` accepts
 * `nav.y - hitUp .. nav.y + h + edge + hitDown`, and the whole width, because
 * the gaps between pills resolve to the nearest pill rather than falling
 * through. So the rect is full-bleed in x on purpose: clamping a prop in x
 * buys nothing.
 */
export function navRect(safeBottom) {
  const y = navFaceTop(safeBottom) - N.hitUp;
  return { x: 0, y, w: V.W, h: N.h + PRESS.edge + N.hitUp + N.hitDown };
}

/** the bottom of the reachable play area for a given inset */
export function reachBottomFor(safeBottom) {
  return navRect(safeBottom).y - RE.margin;
}

/* ==========================================================================
   the live line
   ========================================================================== */
const probes = [];

const reach = {
  /** the inset this was last resolved against, in VIRTUAL units */
  safeBottom: 0,
  /** the nav's hit rect, live */
  nav: navRect(0),
  /** the top of the nav's drawn face, live — what the player sees */
  navFace: navFaceTop(0),
  /** THE LINE. No interactive prop's hit area may extend below this. */
  bottom: reachBottomFor(0),
  /** and the top, for symmetry: below the HUD and the toast lane */
  top: RE.top,

  /**
   * Resolve against a safe-area inset. Called from `main.js`'s `resize()` —
   * the one place that reads `env(safe-area-inset-*)` — so every prop and the
   * nav itself are answering to the same inset on the same frame.
   */
  set(safeBottom) {
    const sb = Number.isFinite(+safeBottom) ? +safeBottom : 0;
    reach.safeBottom = sb;
    reach.nav = navRect(sb);
    reach.navFace = navFaceTop(sb);
    reach.bottom = reachBottomFor(sb);
    return reach.bottom;
  },

  /**
   * THE ONE CALL. Clamp a prop's centre so that its hit area's bottom clears
   * the reach line. `halfH` is the prop's hit half-height — not its drawn
   * radius: the thing that has to be reachable is the area a thumb is tested
   * against, and for the ball those differ by 12 units.
   */
  clampY(y, halfH = 0) {
    const h = Number.isFinite(+halfH) ? +halfH : 0;
    const lo = reach.top + h;
    const hi = reach.bottom - h;
    /* a hit area taller than the whole band: centre it rather than return NaN
       or an inverted clamp. Nothing ships that big; a future prop might. */
    if (hi < lo) return (reach.top + reach.bottom) / 2;
    return Math.min(Math.max(y, lo), hi);
  },

  /** the deepest a prop of this hit half-height may ever sit */
  deepestFor(halfH = 0) {
    return reach.bottom - (Number.isFinite(+halfH) ? +halfH : 0);
  },

  /** does this hit rect intersect the nav's? The invariant, as one predicate. */
  hitsNav(x, y, rx, ry) {
    const n = reach.nav;
    const ox = Math.min(x + rx, n.x + n.w) - Math.max(x - rx, n.x);
    const oy = Math.min(y + ry, n.y + n.h) - Math.max(y - ry, n.y);
    return ox > 0 && oy > 0 ? oy : 0;
  },

  /**
   * How the room's floor line sits relative to the reach line. Positive means
   * the floor is BELOW the bound, i.e. the foreground of the room is not the
   * player's — which is true on the target phone, and is the reason the two
   * concepts are a contract rather than one number.
   */
  floorGap(floorV) {
    return Number.isFinite(+floorV) ? +floorV - reach.bottom : NaN;
  },

  /* ---- the per-frame assertion ------------------------------------------
     Every interactive prop registers a probe; `tick()` runs them all and
     accumulates. It NEVER logs and NEVER throws: a console error in her hands
     is worse than the defect it would be reporting, and the counters are what
     the verification harness reads. `reach.report()` is the whole result. */
  watch(id, fn) {
    probes.push({ id, fn });
    return function unwatch() {
      const i = probes.findIndex((p) => p.fn === fn);
      if (i >= 0) probes.splice(i, 1);
    };
  },
  resetProbes() { probes.length = 0; },
  get probeCount() { return probes.length; },

  frames: 0,
  /** id:state -> the worst overlap ever seen, for props the nav can steal */
  live: Object.create(null),
  /** the same, ignoring whether the nav is currently on screen */
  any: Object.create(null),
  liveHits: 0,
  anyHits: 0,

  tick() {
    reach.frames++;
    for (let i = 0; i < probes.length; i++) {
      let r;
      try { r = probes[i].fn(); } catch (e) { r = null; }
      if (!r) continue;
      const list = Array.isArray(r) ? r : [r];
      for (let j = 0; j < list.length; j++) {
        const it = list[j];
        if (!it || !Number.isFinite(it.y)) continue;
        const oy = reach.hitsNav(it.x, it.y, it.rx || 0, it.ry || 0);
        if (oy <= 0) continue;
        const key = (it.id || probes[i].id) + ':' + (it.state || '-');
        const rec = {
          id: it.id || probes[i].id, state: it.state || '-',
          x: +(+it.x).toFixed(1), y: +(+it.y).toFixed(1),
          rx: it.rx || 0, ry: it.ry || 0,
          overlap: +oy.toFixed(2), frame: reach.frames,
          navTop: reach.nav.y, safeBottom: reach.safeBottom,
        };
        reach.anyHits++;
        if (!reach.any[key] || reach.any[key].overlap < oy) reach.any[key] = rec;
        if (it.live) {
          reach.liveHits++;
          if (!reach.live[key] || reach.live[key].overlap < oy) reach.live[key] = rec;
        }
      }
    }
  },

  resetAudit() {
    reach.frames = 0;
    reach.liveHits = 0; reach.anyHits = 0;
    reach.live = Object.create(null);
    reach.any = Object.create(null);
  },

  /** what the harness reads */
  report() {
    return {
      safeBottom: reach.safeBottom,
      navFaceTop: +reach.navFace.toFixed(2),
      navHit: [+reach.nav.y.toFixed(2), +(reach.nav.y + reach.nav.h).toFixed(2)],
      bottom: +reach.bottom.toFixed(2),
      top: reach.top,
      margin: RE.margin,
      frames: reach.frames,
      probes: probes.length,
      liveHits: reach.liveHits,
      anyHits: reach.anyHits,
      live: Object.keys(reach.live).map((k) => reach.live[k]),
      any: Object.keys(reach.any).map((k) => reach.any[k]),
    };
  },

  /** every prop's rect this frame, whether or not it offends — for eyeballing */
  snapshot() {
    const out = [];
    for (let i = 0; i < probes.length; i++) {
      let r;
      try { r = probes[i].fn(); } catch (e) { r = null; }
      if (!r) continue;
      const list = Array.isArray(r) ? r : [r];
      for (let j = 0; j < list.length; j++) {
        const it = list[j];
        if (!it || !Number.isFinite(it.y)) continue;
        out.push({
          id: it.id || probes[i].id, state: it.state || '-', live: !!it.live,
          x: +(+it.x).toFixed(1), y: +(+it.y).toFixed(1),
          rx: it.rx || 0, ry: it.ry || 0,
          hitBottom: +(+it.y + (it.ry || 0)).toFixed(1),
          clear: +(reach.bottom - (+it.y + (it.ry || 0))).toFixed(1),
          overlap: +reach.hitsNav(it.x, it.y, it.rx || 0, it.ry || 0).toFixed(2),
        });
      }
    }
    return out;
  },
};

export default reach;
