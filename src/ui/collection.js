/* ==========================================================================
   ui/collection.js — WHAT HE HAS BROUGHT HOME, and where it lives.

   WHY THIS EXISTS. Walks were the discovery pillar and they worked: he goes
   out, he comes back muddier and carrying something. But only four of the
   seventeen finds were ever usable — the toys — and everything else piled up
   invisibly. The human played it and said so:

     "It would be great if the items the dog collects during a walk were also
      ones that one could then use afterwards. Currently, they are only being
      collected in the room without being able to use them. and when the room
      fills up it just gets messy. we also need a storage for these items that
      hides them from the room if wanted."   (docs/FEEDBACK-QUEUE.md 6)

   Two things were wrong, and they are different. The room had no STORAGE — it
   drew the last seven distinct finds and silently dropped the rest, so the
   collection filled up and then began losing things out of the back. And most
   finds had no PURPOSE, which stage 6 already established is worse than never
   promising one at all (ARCHITECTURE 17.5, the two inert unlock rows).

   SO EVERY FIND NOW ANSWERS "WHAT IS THIS FOR":

     a toy       he fetches it. Already true, and untouched.
     a photo     it is a dog he met, and the album says which, where and when.
     everything  it is nice to look at, and SHE decides whether it is out on
     else        the sill or put away in the box.
     a duplicate a few coins (state/walks.js) — "selling walk finds" is where
                 SCOPE stage 5 says coins come from, and it means the second
                 daisy is not litter either.

   THIS IS NOT DECOR AND MUST NOT BECOME IT. Decor is earned with care points
   and never bought (SCOPE stage 6, and the queue is explicit about it). Finds
   are a third category: not bought, not gated, just found. Arranging them
   costs nothing, which is why there is no price and no chip anywhere in here.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { clamp, roundRect, TAU } from '../engine/draw.js';
import { Spring } from '../engine/spring.js';
import { drawText } from './text.js';
import { INK, SURF, R, type } from './tokens.js';
import { tactile, card, stitchedDivider, createPresses } from './surface.js';
import { drawFind } from '../scenes/props.js';
import { PRESS } from './tokens.js';

const W = BALANCE.view.W;
const H = BALANCE.view.H;
const CL = BALANCE.ui.collection;

const PANEL = SURF.card;
const ROW = SURF.row;
const SLOT = SURF.rowOff;
const PILL = SURF.chip;
const SCRIM = 0.44;

export const COPY = {
  title: () => 'What he has brought home',
  onSill: () => 'ON THE SILL',
  inBox: () => 'IN THE BOX',
  album: () => 'DOGS HE HAS MET',
  boxEmpty: () => 'Nothing put away',
  sillEmpty: () => 'The sill is empty — tap something below to put it out',
  /* the album line. `where` is the route he met them on, which is the detail
     that makes it a memory rather than a row in a table. */
  metAt: (name, where) => (where ? `${name}, ${where}` : name),
  metAgain: (n) => (n > 1 ? `met ${n} times` : ''),
  nothingYet: (P) => `${P.they === 'they' ? 'They have' : (P.they === 'he' ? 'He has' : 'She has')} not found anything yet`,
  hintTakeWalk: () => 'Take him for a walk and he will bring something back',
  full: () => 'The sill is full — put something away first',
  /* the chip on a wearable find. "Worn" rather than "Take off", because the
     chip is a STATE she toggles and not a command — the same reason the shop
     says OWNED rather than "buy again". */
  wear: () => 'Wear',
  worn: () => 'Worn',
};

/** where the four routes are, in words, for the album */
const WHERE = { park: 'in the park', high: 'on the high street', river: 'by the river', woods: 'in the woods' };

export function createCollection(opts = {}) {
  const game = opts.game;
  const reduced = !!opts.reduced;
  const sound = opts.sound || (() => {});
  const toast = opts.toast || (() => {});
  /** id -> the words for a find, from dog/walk.js's COPY (one vocabulary) */
  const nameOf = opts.nameOf || ((id) => id);
  const metName = opts.metName || ((met) => met);

  const slide = new Spring(0, reduced ? 96 : 132, reduced ? 20 : 16);
  const presses = createPresses(reduced);
  let open = false;
  let bottomInset = 0;
  let flashId = '';
  let flashT = 0;
  /* resolved on open and after every change: three lists and nothing derived
     at draw time, so the layout and the hit test cannot disagree */
  let sill = [], box = [], album = [];
  let canWear = new Set(), worn = '';

  const pad = CL.pad;

  /** the three lists, resolved from state — never derived at draw time, so the
      layout and the hit test cannot come to different answers */
  function refresh() {
    sill = game.onShow();
    box = game.inBox();
    album = game.album();
    /* WHAT HE CAN WEAR, AND WHAT HE IS WEARING. The two `gift` finds — the
       brass bell and the red ribbon — are the only finds that go on his collar,
       and until the accessory slot was drawn they were the two with no purpose
       at all (ARCHITECTURE 23.7). A wearable thing can be on the sill, in the
       box, or on the dog, and the third is not exclusive with the other two:
       he wears it, and the shelf keeps its place. */
    canWear = new Set(game.accessories ? game.accessories() : []);
    worn = game.wornAccessory || '';
  }

  /* ---- LAYOUT ---------------------------------------------------------
     THE PANEL IS AS TALL AS ITS CONTENTS, not as tall as the screen. The shop
     and the kennel are full-height because their lists are fixed and long; this
     one holds anything from nothing to nine ornaments and four dogs, and
     rendering it full-height with two things in the box left two thirds of the
     screen as an empty cream field with a Done button stranded in it.

     Every section is measured from the one above, because the middle one grows:
     a full box is three rows and an empty one is a line of type, and a fixed y
     for the album sits on top of the box in one of those two cases. */
  function boxRows() { return Math.max(1, Math.ceil(box.length / CL.cols)); }
  function boxH() { return box.length ? boxRows() * CL.slotH : CL.emptyH; }
  function albumH() { return album.length ? album.length * CL.albumRowH : CL.emptyH; }
  function contentH() {
    return CL.headH
      + CL.labelH + CL.slotH + CL.gap          // the sill
      + CL.labelH + boxH() + CL.gap            // the box
      + CL.labelH + albumH() + CL.gap          // the album
      + CL.closeH + CL.bottomPad + bottomInset;
  }
  /** the panel never grows past the screen; past that, Done clamps as before */
  function height() { return Math.min(H, contentH()); }
  function topY() { return H - height() * clamp(slide.x, 0, 1); }

  function sillLabelY() { return topY() + CL.headH + CL.labelH / 2; }
  function sillRect() {
    return { x: pad, y: topY() + CL.headH + CL.labelH, w: W - pad * 2, h: CL.slotH };
  }
  function boxLabelY() { return sillRect().y + CL.slotH + CL.gap + CL.labelH / 2; }
  function boxTop() { return sillRect().y + CL.slotH + CL.gap + CL.labelH; }
  function albumLabelY() { return boxTop() + boxH() + CL.gap + CL.labelH / 2; }
  function albumTop() { return boxTop() + boxH() + CL.gap + CL.labelH; }

  /** the i-th slot inside a grid that starts at `y` */
  function slotRect(y, i) {
    const cw = (W - pad * 2 - CL.slotGap * (CL.cols - 1)) / CL.cols;
    const col = i % CL.cols, row = Math.floor(i / CL.cols);
    return {
      x: pad + col * (cw + CL.slotGap), y: y + row * CL.slotH,
      w: cw, h: CL.slotH - CL.slotGap,
    };
  }
  /** the little WEAR / WORN chip on a wearable tile, or null */
  function wearChip(r, id) {
    if (!canWear.has(id)) return null;
    const w = CL.chipW, h = CL.chipH;
    return { x: r.x + r.w - w - 4, y: r.y + 4, w, h, id };
  }

  /** the i-th thing standing on the sill, laid out along it */
  function sillSlot(i) {
    const r = sillRect();
    const step = (r.w - 16) / BALANCE.walk.find.onShow;
    return { x: r.x + 8 + i * step, y: r.y + 6, w: step, h: r.h - 12 };
  }
  function closeRect() {
    const y = albumTop() + albumH() + CL.gap;
    return {
      x: pad, w: W - pad * 2, h: CL.closeH,
      y: Math.min(y, H - bottomInset - CL.bottomPad - CL.closeH),
    };
  }
  function hit(r, ev) {
    return ev.x >= r.x && ev.x <= r.x + r.w && ev.y >= r.y && ev.y <= r.y + r.h;
  }

  function press(id) { flashId = id; flashT = CL.flash; presses.set(id, true); }

  const panel = {
    get isOpen() { return open; },
    get modal() { return open; },
    get active() { return open || slide.x > 0.01; },
    COPY,
    setInset(v) { bottomInset = v; },

    start() {
      open = true;
      refresh();
      slide.to(1);
      sound(CL.sfx.open);
    },
    stop() {
      if (!open) return;
      open = false;
      slide.to(0);
      sound(CL.sfx.close);
    },
    toggle() { if (open) panel.stop(); else panel.start(); },

    update(dt) {
      slide.step(dt);
      if (flashT > 0) {
        presses.set(flashId, flashT > CL.flash - PRESS.dur * 1.1);
        flashT = Math.max(0, flashT - dt);
        if (flashT === 0) { presses.clear(); flashId = ''; }
      }
      presses.update(dt);
    },

    /** @returns true if the event was consumed — it consumes everything */
    pointer(ev) {
      if (!open) return false;
      if (ev.type !== 'down') return true;
      if (ev.y < topY() + 6) { panel.stop(); return true; }
      if (hit(closeRect(), ev)) { panel.stop(); return true; }
      /* TAP TO PUT AWAY, TAP TO PUT OUT. One gesture, both directions, and no
         drag: a drag on a phone-sized grid is a way to drop things by accident,
         and there is nothing here worth the precision. */
      for (let i = 0; i < sill.length; i++) {
        const q = wearChip(sillSlot(i), sill[i]);
        if (q && hit(q, ev)) {
          press(sill[i]);
          game.equipAccessory(worn === sill[i] ? '' : sill[i]);
          sound(CL.sfx.wear);
          refresh();
          return true;
        }
      }
      for (let i = 0; i < sill.length; i++) {
        if (hit(sillSlot(i), ev)) {
          press(sill[i]);
          game.setOnShow(sill[i], false);
          sound(CL.sfx.put);
          refresh();
          return true;
        }
      }
      const by = boxTop();
      /* THE CHIP IS TESTED BEFORE THE TILE IT SITS ON. Otherwise tapping "Wear"
         would put the thing away instead, which is the same class of mistake as
         a toast covering its own subject: the control that is on top has to be
         the control that answers. */
      for (let i = 0; i < box.length; i++) {
        const q = wearChip(slotRect(by, i), box[i]);
        if (q && hit(q, ev)) {
          press(box[i]);
          game.equipAccessory(worn === box[i] ? '' : box[i]);
          sound(CL.sfx.wear);
          refresh();
          return true;
        }
      }
      for (let i = 0; i < box.length; i++) {
        if (hit(slotRect(by, i), ev)) {
          press(box[i]);
          const r = game.setOnShow(box[i], true);
          if (r.full) toast(COPY.full());
          else sound(CL.sfx.put);
          refresh();
          return true;
        }
      }
      return true;
    },

    draw(g) {
      if (slide.x < 0.002) return;
      const c = g.ctx;
      const a = clamp(slide.x, 0, 1);
      const top = topY();

      c.save();
      c.fillStyle = SURF.scrim(SCRIM * a);
      c.fillRect(0, 0, W, H);
      c.restore();
      card(c, 0, top, W, H - top + 24, { r: R.lg, fill: PANEL, fade: a });

      c.save();
      c.fillStyle = SURF.border(0.26);
      roundRect(c, W / 2 - 20, top + 9, 40, 4, 2); c.fill();
      c.restore();
      stitchedDivider(c, pad, top + CL.headH - 10, W - pad, { fade: a * 0.85 });

      drawText(g, COPY.title(), {
        ...type('titleMd', { weight: 800 }),
        x: pad + 2, y: top + 32, anchor: 'free', align: 'left',
        ink: INK.heading, over: PANEL, fade: a, maxWidth: W - pad * 2 - 8,
      });

      /* ---- THE SILL, drawn as the shelf it is ------------------------- */
      const sr = sillRect();
      c.save();
      c.fillStyle = SLOT;
      roundRect(c, sr.x, sr.y, sr.w, sr.h, R.md); c.fill();
      /* the shelf's front edge, so it reads as a surface things stand ON
         rather than a tray they sit IN */
      c.fillStyle = SURF.border(0.30);
      roundRect(c, sr.x + 6, sr.y + sr.h - 7, sr.w - 12, 3, 1.5); c.fill();
      c.restore();
      for (let i = 0; i < sill.length; i++) {
        const q = sillSlot(i);
        const dy = presses.at(sill[i]) * 2;
        c.save();
        c.globalAlpha = a;
        c.fillStyle = 'rgba(104,58,32,0.16)';
        c.beginPath();
        c.ellipse(q.x + q.w / 2, q.y + q.h - 10 + dy, 9, 2.6, 0, 0, TAU);
        c.fill();
        drawFind(c, sill[i], q.x + q.w / 2, q.y + q.h - 12 + dy, CL.glyph, i);
        c.restore();
        const wq = wearChip(q, sill[i]);
        if (wq) {
          const on = worn === sill[i];
          c.save();
          tactile(c, { x: wq.x, y: wq.y, w: wq.w, h: wq.h, r: R.full,
                      p: 0, face: on ? SURF.chipStrong : SURF.chip, fade: a });
          c.restore();
          drawText(g, on ? COPY.worn() : COPY.wear(), {
            ...type('labelSm', { weight: 800 }),
            x: wq.x + wq.w / 2, y: wq.y + wq.h / 2, anchor: 'free', align: 'center',
            ink: on ? INK.onStrong : INK.body, over: on ? SURF.chipStrong : SURF.chip,
            fade: a, maxWidth: wq.w - 4,
          });
        }
      }
      if (!sill.length) {
        drawText(g, COPY.sillEmpty(), {
          ...type('labelSm', { weight: 500, track: 0 }),
          x: W / 2, y: sr.y + sr.h / 2, anchor: 'free', align: 'center',
          ink: INK.soft(0.8), over: SLOT, fade: a, maxWidth: sr.w - 24,
        });
      }
      drawText(g, COPY.onSill(), {
        ...type('labelSm', { weight: 800 }),
        x: pad + 2, y: sillLabelY(), anchor: 'free', align: 'left',
        ink: INK.soft(0.9), over: PANEL, fade: a, maxWidth: 200,
      });

      /* ---- THE BOX ---------------------------------------------------- */
      drawText(g, COPY.inBox(), {
        ...type('labelSm', { weight: 800 }),
        x: pad + 2, y: boxLabelY(), anchor: 'free', align: 'left',
        ink: INK.soft(0.9), over: PANEL, fade: a, maxWidth: 200,
      });
      const by = boxTop();
      if (!box.length) {
        drawText(g, sill.length ? COPY.boxEmpty() : COPY.hintTakeWalk(), {
          ...type('labelSm', { weight: 500, track: 0 }),
          x: pad + 2, y: by + CL.emptyH / 2, anchor: 'free', align: 'left',
          ink: INK.faint(0.75), over: PANEL, fade: a, maxWidth: W - pad * 2 - 8,
        });
      }
      for (let i = 0; i < box.length; i++) {
        const q = slotRect(by, i);
        const f = tactile(c, {
          x: q.x, y: q.y, w: q.w, h: q.h, r: R.md,
          p: presses.at(box[i]), face: ROW, fade: a,
        });
        c.save();
        c.globalAlpha = a;
        /* THE GLYPH SITS ABOVE ITS NAME, and the room's sill is what says where
           "above" is: `drawSill` puts the contact shadow 11 units BELOW the
           anchor, so a find is drawn from about 20 above it to 11 below it and
           the anchor is near the base rather than the middle. Both were first
           drawn six units apart at the bottom of the slot, then thirteen, and
           the type went straight through the bell both times — a collision no
           contrast check can see, because both halves are legible on their own.
           Measured against the glyph's real extent, not nudged again. */
        drawFind(c, box[i], q.x + q.w / 2, q.y + f.dy + q.h - CL.nameBand - 8, CL.glyph, i);
        c.restore();
        const wq = wearChip(q, box[i]);
        if (wq) {
          const on = worn === box[i];
          c.save();
          tactile(c, { x: wq.x, y: wq.y + f.dy, w: wq.w, h: wq.h, r: R.full,
                      p: 0, face: on ? SURF.chipStrong : SURF.chip, fade: a });
          c.restore();
          drawText(g, on ? COPY.worn() : COPY.wear(), {
            ...type('labelSm', { weight: 800 }),
            x: wq.x + wq.w / 2, y: wq.y + f.dy + wq.h / 2, anchor: 'free', align: 'center',
            ink: on ? INK.onStrong : INK.body, over: on ? SURF.chipStrong : SURF.chip,
            fade: a, maxWidth: wq.w - 4,
          });
        }
        drawText(g, nameOf(box[i]), {
          ...type('labelSm', { weight: 600, track: 0 }),
          x: q.x + q.w / 2, y: q.y + f.dy + q.h - CL.nameBand / 2 - 2, anchor: 'free', align: 'center',
          ink: INK.body, over: ROW, fade: a, maxWidth: q.w - 6,
        });
      }

      /* ---- THE ALBUM --------------------------------------------------
         A photo of a dog he met is the one find that could never be an
         ornament, and the queue names it directly: "an album of dogs he met is
         a lovely thing; an anonymous flower on the rug is not". */
      drawText(g, COPY.album(), {
        ...type('labelSm', { weight: 800 }),
        x: pad + 2, y: albumLabelY(), anchor: 'free', align: 'left',
        ink: INK.soft(0.9), over: PANEL, fade: a, maxWidth: 220,
      });
      const ay = albumTop();
      if (!album.length) {
        drawText(g, COPY.hintTakeWalk(), {
          ...type('labelSm', { weight: 500, track: 0 }),
          x: pad + 2, y: ay + CL.emptyH / 2, anchor: 'free', align: 'left',
          ink: INK.faint(0.75), over: PANEL, fade: a, maxWidth: W - pad * 2 - 8,
        });
      }
      for (let i = 0; i < album.length; i++) {
        const m = album[i];
        const ry = ay + i * CL.albumRowH;
        c.save();
        c.fillStyle = ROW;
        roundRect(c, pad, ry, W - pad * 2, CL.albumRowH - 6, R.md); c.fill();
        c.globalAlpha = a;
        drawFind(c, m.id, pad + 26, ry + (CL.albumRowH - 6) / 2 + 6, CL.glyph * 0.9, i);
        c.restore();
        drawText(g, COPY.metAt(metName(m.met), WHERE[m.route] || ''), {
          ...type('labelMd', { weight: 700 }),
          x: pad + 50, y: ry + (CL.albumRowH - 6) / 2, anchor: 'free', align: 'left',
          ink: INK.body, over: ROW, fade: a, maxWidth: W - pad * 2 - 60 - 70,
        });
        const again = COPY.metAgain(m.times);
        if (again) {
          drawText(g, again, {
            ...type('labelSm', { weight: 500, track: 0 }),
            x: W - pad - 14, y: ry + (CL.albumRowH - 6) / 2, anchor: 'free', align: 'right',
            ink: INK.faint(0.8), over: ROW, fade: a, maxWidth: 70,
          });
        }
      }

      const cl = closeRect();
      c.save();
      tactile(c, { x: cl.x, y: cl.y, w: cl.w, h: cl.h, r: R.full, p: 0, face: PILL, fade: a });
      c.restore();
      drawText(g, 'Done', {
        ...type('labelMd', { weight: 800 }),
        x: cl.x + cl.w / 2, y: cl.y + cl.h / 2, anchor: 'free', align: 'center',
        ink: INK.body, over: PILL, fade: a, maxWidth: cl.w - 10,
      });
    },

    get debug() {
      return {
        open, weight: +slide.x.toFixed(3),
        sill: sill.slice(), box: box.slice(),
        album: album.map((m) => ({ met: m.met, route: m.route, times: m.times })),
        canWear: Array.from(canWear), worn,
        /* the WEAR chips' own rects. Published because a gate has to be able to
           tap the control rather than sweep the screen looking for it, and
           because the thing being asserted is that the CHIP answers and not the
           tile underneath it — which needs both rects to be known. */
        /* and the tiles themselves, for the same reason */
        slots: sill.map((id, i) => ({ id, ...sillSlot(i) }))
          .concat(box.map((id, i) => ({ id, ...slotRect(boxTop(), i) })))
          .map((q) => ({ id: q.id, x: +q.x.toFixed(1), y: +q.y.toFixed(1),
                         w: +q.w.toFixed(1), h: +q.h.toFixed(1) })),
        chips: sill.map((id, i) => wearChip(sillSlot(i), id))
          .concat(box.map((id, i) => wearChip(slotRect(boxTop(), i), id)))
          .filter(Boolean)
          .map((q) => ({ id: q.id, x: +q.x.toFixed(1), y: +q.y.toFixed(1), w: q.w, h: q.h })),
        close: closeRect(),
      };
    },
  };

  return panel;
}

export default createCollection;
