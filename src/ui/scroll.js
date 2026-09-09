/* ==========================================================================
   ui/scroll.js — THE ONE SCROLLER, AND THE RULE IT IS ALLOWED TO BEND.

   WHY THIS EXISTS AT ALL, given that the rule was the opposite. Two surfaces
   wrote the rule down and both of them wrote down a reason:

     ui/kennel.js  "NOTHING IN THIS GAME SCROLLS, and that is a design property
                    rather than an omission — no surface in the tree has a
                    scroll offset, because a child hunting for a row below the
                    fold is a child who does not find it."
     balance.js    "THE SHOP DOES NOT SCROLL. That is a constraint on the
                    catalogue, not a thing to solve with a scroll view: a shop
                    you cannot see the bottom of is the retention scaffolding
                    research §7 warns about, and a list that fits is a list she
                    can hold in her head."

   Both are right, and NEITHER IS REPEALED HERE. What is repealed is the third
   thing, which nobody wrote down because it was not a decision: that a panel
   which outgrows the screen has no honest way to fail. The kennel's own note
   spells out what happens instead — the Done button's `Math.min` clamp slides
   it UP UNDER the last rows, "which is the worst possible failure: the panel
   would look fine and one control would be unreachable behind another." A
   sixth dog does that today, by 20 units at a 40-unit inset. So the choice was
   never "scroll or don't"; it was "scroll, or hide a control behind another
   one and call it a layout".

   THE THREE RULES THAT KEEP THE ORIGINAL REASONING INTACT
   -------------------------------------------------------
   1. IT ONLY SCROLLS WHEN IT MUST. `max` is `contentH - viewH` and is zero
      whenever the content fits, and a zero `max` makes every path in here
      inert: no offset, no affordance drawn, no gesture claimed. So every
      surface that fits today is pixel-for-pixel what it was, and the child who
      would have hunted below the fold is never given a fold to hunt below.
      This is the whole answer to the kennel's objection and it is why `can`
      is a derived fact rather than a flag anybody sets.

   2. IT SAYS THERE IS MORE. The objection was never "scrolling is bad", it was
      "she will not know". A list that scrolls draws a fade into the panel
      colour at the edge it continues past, plus a thumb that shows how much
      more there is — so "there is more below" is a thing on the screen rather
      than a thing she has to guess. Nothing below the fold is silent.

   3. IT IS NOT A LICENCE TO GROW THE CATALOGUE. The shop's note is about
      restraint, and restraint is a design decision that lives in SCOPE.md, not
      a thing to enforce by making the layout break. Twelve rows is still the
      catalogue; this file only means the thirteenth would be legible instead
      of hidden under the Done button.

   A TAP IS NOT A DRAG, AND THIS IS THE PART THAT COULD LOSE A DOG
   ---------------------------------------------------------------
   Every panel in this game commits on `down`. That is safe only while nothing
   scrolls: the moment a list moves under her finger, committing on `down`
   means a flick to see the bottom of the kennel ADOPTS somebody, and a flick
   down the shop SPENDS her coins. So a scrolling panel has to move its commit
   to the lift, and this file is what tells it whether the lift was a tap:

     down  -> `pointer` arms, and returns ''       (the panel starts its press)
     move  -> once past `slop`, it is a drag       (the panel drops its press)
     up    -> `dragged` says which it was          (the panel commits, or not)

   `dragged` deliberately SURVIVES the `up` that ends the gesture and is only
   cleared by the next `down`, because the panel reads it while handling that
   same `up`. Clearing it on release would make every drag look like a tap at
   exactly the moment the answer matters.

   THE CLOCK COMES FROM `update`, NOT FROM `performance.now()`. Velocity is
   measured as the offset's change per stepped frame, so a gate that steps
   1/60 by hand gets the same numbers a phone does. `tools/_drive.py` PINs the
   wall clock, and a fling that read the real clock would measure an infinite
   speed against a frozen one — the lesson `walkgate` learned the hard way.

   NO RUBBER BAND, ON PURPOSE. The offset is hard-clamped to 0..max, which
   makes "it can never show past either end" a thing a gate can assert in one
   line rather than a thing that is true within a tolerance that also has to be
   tuned. A soft overscroll is a phone-feel nicety; a list that cannot lose its
   last row is the requirement.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { clamp, roundRect, rgba } from '../engine/draw.js';

const SC = BALANCE.ui.scroll;

/**
 * createScroll({ reduced })
 *
 * A panel owns one of these, tells it the band its content may occupy and how
 * tall that content is, then subtracts `offset` from every rect it lays out.
 * Because hit-testing goes through the same rect functions the drawing does,
 * the two cannot disagree about where a row is.
 */
export function createScroll(opts = {}) {
  const reduced = !!opts.reduced;

  let top = 0;            // the top of the band, in virtual units
  let viewH = 0;          // how tall the band is
  let contentH = 0;       // how tall the thing inside it is
  let off = 0;            // how far the content has been pushed up
  let max = 0;

  let armed = false;      // a finger went down inside the band
  let dragging = false;   // ...and has since moved far enough to be a scroll
  let dragged = false;    // the gesture WAS a drag — read on the `up`
  let downY = 0;
  let downOff = 0;
  let vel = 0;            // units per second, for the fling
  let prevOff = 0;

  function clampOff() { off = clamp(off, 0, max); }

  const api = {
    /**
     * The band, and what is in it. Called every frame from the panel's
     * `update` and again at the top of its `pointer`, so a roster that changed
     * between two frames cannot leave the offset pointing past the end.
     */
    measure(bandTop, bandH, content) {
      top = bandTop;
      viewH = Math.max(0, bandH);
      contentH = Math.max(0, content);
      max = Math.max(0, contentH - viewH);
      clampOff();
      return api;
    },

    get offset() { return max > 0 ? off : 0; },
    get max() { return max; },
    /** the one question every caller asks: does this have to scroll at all? */
    get can() { return max > 0.5; },
    get dragging() { return dragging; },
    /** was the gesture that is ending a drag? Cleared by the next `down`. */
    get dragged() { return dragged; },
    get top() { return top; },
    get bottom() { return top + viewH; },
    get atTop() { return api.offset <= 0.5; },
    get atBottom() { return api.offset >= max - 0.5; },
    /** true while `y` is inside the band — a fixed header is not scrollable */
    inBand(y) { return y >= top && y <= top + viewH; },

    /**
     * Feed it the panel's pointer event BEFORE the panel acts on it.
     * @returns 'drag' while the gesture is a scroll, '' otherwise.
     */
    pointer(ev) {
      if (!ev) return '';
      if (ev.type === 'down') {
        /* a new gesture: nothing is known about it yet, and the previous
           gesture's verdict stops being the answer here.

           `armed` DOES NOT ASK WHETHER IT CAN SCROLL, and that is not an
           oversight. A finger that presses a row, slides 160 units and lifts
           somewhere else has not tapped that row — on a list that scrolls OR
           on one that fits. Gating `dragged` on `can` made the verdict depend
           on how many dogs happened to be in the kennel: the same gesture
           scrolled a six-dog list and swapped the dog in a five-dog one.
           Scrolling is what `dragging` is for; this is just "she moved". */
        armed = api.inBand(ev.y);
        dragging = false;
        dragged = false;
        downY = ev.y;
        downOff = off;
        vel = 0;
        return '';
      }
      if (ev.type === 'move') {
        if (!armed) return dragging ? 'drag' : '';
        /* past the slop it is no longer a tap, whatever the list does about it */
        if (Math.abs(ev.y - downY) > SC.slop) dragged = true;
        if (!dragging && dragged && api.can) dragging = true;
        if (!dragging) return '';
        off = downOff - (ev.y - downY);
        clampOff();
        return 'drag';
      }
      if (ev.type === 'up' || ev.type === 'cancel') {
        const was = dragging;
        armed = false;
        dragging = false;
        /* `dragged` is NOT cleared here — the panel is about to read it to
           decide whether this lift was a tap. `cancel` is never a tap, so it
           is marked as a drag whether or not the finger actually moved. */
        if (ev.type === 'cancel') dragged = true;
        if (!was || reduced) vel = 0;
        return was ? 'drag' : '';
      }
      return '';
    },

    /** let go of a gesture without an event — the panel is closing or busy */
    reset() {
      armed = false; dragging = false; dragged = false; vel = 0;
    },
    /** ...and put it back to the top, for a panel that is opening fresh */
    home() { off = 0; prevOff = 0; api.reset(); },

    update(dt) {
      if (!api.can) { off = 0; vel = 0; prevOff = 0; return; }
      if (dragging) {
        /* MEASURED OFF THE STEPPED CLOCK, so a gate stepping 1/60 by hand and a
           phone running at 60fps get the same fling. */
        if (dt > 0) vel = (off - prevOff) / dt;
        prevOff = off;
        return;
      }
      if (Math.abs(vel) > SC.minFling && !reduced) {
        vel = clamp(vel, -SC.maxFling, SC.maxFling);
        off += vel * dt;
        vel *= Math.exp(-SC.friction * dt);
        /* a fling that reaches an end STOPS there rather than bouncing: see
           the note on the missing rubber band */
        if (off <= 0 || off >= max) vel = 0;
        clampOff();
      } else {
        vel = 0;
      }
      prevOff = off;
    },

    /**
     * WHAT SAYS THERE IS MORE. Drawn by the panel AFTER its content and inside
     * no clip of its own, because it is the edge of the clip that it marks.
     *
     * `face` is the colour the content sits on, so the fade is the panel
     * itself closing over the content rather than a grey haze on top of it —
     * which is the difference between "this continues" and "this is disabled".
     *
     * @param o { x, w, face, alpha }
     */
    drawEdges(g, o = {}) {
      if (!api.can) return;
      const c = g.ctx;
      const a = clamp(o.alpha === undefined ? 1 : o.alpha, 0, 1);
      if (a <= 0.01) return;
      const face = o.face || '#ffffff';
      const x = o.x === undefined ? 0 : o.x;
      const w = o.w === undefined ? BALANCE.view.W : o.w;
      const bot = top + viewH;

      /* THE FADE, at whichever end the content carries on past. Its strength
         ramps in over the first `fadeH` units of travel so that arriving at an
         end is a thing she can see happening rather than a hard switch. */
      const below = max - api.offset;
      if (below > 0.5) {
        const k = clamp(below / SC.fadeH, 0, 1) * a;
        const gr = c.createLinearGradient(0, bot - SC.fadeH, 0, bot);
        gr.addColorStop(0, rgba(face, 0));
        gr.addColorStop(1, rgba(face, SC.fadeA * k));
        c.fillStyle = gr;
        c.fillRect(x, bot - SC.fadeH, w, SC.fadeH);
      }
      const above = api.offset;
      if (above > 0.5) {
        const k = clamp(above / SC.fadeH, 0, 1) * a;
        const gr = c.createLinearGradient(0, top + SC.fadeH, 0, top);
        gr.addColorStop(0, rgba(face, 0));
        gr.addColorStop(1, rgba(face, SC.fadeA * k));
        c.fillStyle = gr;
        c.fillRect(x, top, w, SC.fadeH);
      }

      /* THE THUMB, which is the part that says HOW MUCH more. A fade says the
         list continues; it does not say whether that is one row or nine, and
         "nearly there" is the thing that stops a child giving up halfway. It
         brightens under a finger so the drag has something that answers it. */
      const trackH = viewH - SC.barPad * 2;
      if (trackH > SC.barMinH) {
        const h = Math.max(SC.barMinH, trackH * clamp(viewH / Math.max(1, contentH), 0, 1));
        const u = max > 0 ? clamp(api.offset / max, 0, 1) : 0;
        const y = top + SC.barPad + (trackH - h) * u;
        const bx = x + w - SC.barPad - SC.barW;
        c.save();
        c.globalAlpha = a * (dragging ? SC.barA[1] : SC.barA[0]);
        c.fillStyle = SC.barInk;
        roundRect(c, bx, y, SC.barW, h, SC.barW / 2);
        c.fill();
        c.restore();
      }
    },

    /** clip to the band — everything drawn until `unclip` is inside it */
    clip(c, o = {}) {
      const x = o.x === undefined ? 0 : o.x;
      const w = o.w === undefined ? BALANCE.view.W : o.w;
      c.save();
      c.beginPath();
      /* the band is padded outward horizontally so a tactile bottom edge or a
         press highlight is not shaved off at the sides by a clip that exists
         for a vertical reason */
      c.rect(x - 4, top, w + 8, viewH);
      c.clip();
    },
    unclip(c) { c.restore(); },

    get debug() {
      return {
        can: api.can, off: +api.offset.toFixed(1), max: +max.toFixed(1),
        top: +top.toFixed(1), viewH: +viewH.toFixed(1),
        contentH: +contentH.toFixed(1),
        dragging, dragged, atTop: api.atTop, atBottom: api.atBottom,
      };
    },
  };

  return api;
}

export default createScroll;
