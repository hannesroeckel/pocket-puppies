/* ==========================================================================
   ui/tricklist.js — WHAT THERE IS TO TEACH, said out loud.

   WHY THIS EXISTS. Training shipped with eight tricks, a teaching prompt for
   each of them, and no way to read any of it. The prompts only ever surfaced
   as the ghost gesture hint, which waits three seconds for stillness and then
   cycles through whatever is possible from his current posture, one at a time
   — so the only way to learn what the game contains was to stop playing and
   wait. The human played it and reported exactly that: "we also need more
   descriptions for the player regarding the tricks. currently its just a
   guessing" (docs/FEEDBACK-QUEUE.md 1b).

   FOUR THINGS PER TRICK, AND THEY ANSWER FOUR DIFFERENT QUESTIONS:

     what it is called      "Lie down"
     what he does           "He folds onto his front, head still up"
     how to ask             "Stroke down over the head, then on along the floor"
     how well he knows it   "learning" — a WORD, from the same five the cue
                            legend uses. Never a bar and never a count.

   and a fifth line only when the gesture cannot be read from where he is
   standing this second ("He needs to be lying down first"), which flips back
   the moment he moves. That is deliberately not a lock: nothing here is drawn
   greyed out, because a trick he could do two seconds from now is not locked,
   and a locked door with no explanation is the thing this panel exists to
   delete.

   NOT THE CUE LEGEND, and the two must never be merged (the queue is explicit).
   The legend is HIS understanding of a signal and can be wrong; this is the
   roster and is always true. Different questions, different surfaces.

   THE ROWS ARE NOT PRESSABLE. Every other list in the game is a shelf of things
   to buy, wear or adopt, so ui/surface.js's tactile edge belongs on them. These
   are sentences. Giving them a press treatment would promise an action that
   does not exist, which is the same complaint stage 6 settled by cutting two
   inert unlock rows (ARCHITECTURE §17.5).
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { clamp, roundRect } from '../engine/draw.js';
import { Spring } from '../engine/spring.js';
import { drawText } from './text.js';
import { INK, SURF, R, type } from './tokens.js';
import { tactile, card, stitchedDivider } from './surface.js';

const W = BALANCE.view.W;
const H = BALANCE.view.H;
const TL = BALANCE.ui.train.tricks;

const PANEL = SURF.card;
const ROW = SURF.row;
const PILL = SURF.chip;
/* the same scrim weight the shop and the kennel put over the room */
const SCRIM = 0.44;

export function createTrickList(opts = {}) {
  const reduced = !!opts.reduced;
  const sound = opts.sound || (() => {});
  /** () => [{ id, name, does, hint, know, started, ready, needs }] */
  const lessons = opts.lessons || (() => []);
  /** the panel's own copy, which lives in dog/train.js's COPY block */
  const copy = opts.copy || {};
  const pron = opts.pron || (() => ({ they: 'they', them: 'them', their: 'their', is: 'are', has: 'have', s: '' }));

  const slide = new Spring(0, reduced ? 96 : 132, reduced ? 20 : 16);
  let open = false;
  let bottomInset = 0;
  let rows = [];

  const pad = TL.pad;

  function topY() { return H * (1 - clamp(slide.x, 0, 1)); }
  function listTop() { return topY() + TL.headH; }
  /**
   * THE ROW HEIGHT IS FITTED, NOT TYPED. Eight tricks fit at the authored
   * height with room to spare, but the roster is a table anyone may add to —
   * and the failure of a typed height is that Done walks off the bottom of the
   * screen, which is unrecoverable on a phone with no back gesture into a
   * canvas. Shrinking the rows is a worse-looking list; losing the way out is
   * a trap.
   */
  function rowH() {
    const room = H - bottomInset - TL.bottomPad - TL.closeH - TL.closeGap - (listTop());
    const n = Math.max(1, rows.length);
    return Math.min(TL.rowH, Math.floor(room / n));
  }
  function rowRect(i) {
    const h = rowH();
    return { x: pad, y: listTop() + i * h, w: W - pad * 2, h: h - TL.rowGap };
  }
  function closeRect() {
    const y = listTop() + rows.length * rowH() + TL.closeGap;
    return {
      x: pad, w: W - pad * 2, h: TL.closeH,
      y: Math.min(y, H - bottomInset - TL.bottomPad - TL.closeH),
    };
  }
  function hit(r, ev) {
    return ev.x >= r.x && ev.x <= r.x + r.w && ev.y >= r.y && ev.y <= r.y + r.h;
  }

  const panel = {
    get isOpen() { return open; },
    /** owns the whole surface while it is up — dog/train.js consults this */
    get modal() { return open; },
    get active() { return open || slide.x > 0.01; },
    setInset(v) { bottomInset = v; },

    start() {
      open = true;
      rows = lessons();
      slide.to(1);
      sound(BALANCE.ui.shop.sfx.open);
    },
    stop() {
      if (!open) return;
      open = false;
      slide.to(0);
      sound(BALANCE.ui.shop.sfx.close);
    },
    toggle() { if (open) panel.stop(); else panel.start(); },

    update(dt) {
      slide.step(dt);
      /* HIS POSTURE MOVES WHILE SHE IS READING. The "needs" line and the level
         words are live state, and a snapshot taken at open would tell her he
         needs to be lying down while he is lying down in front of her. */
      if (open) rows = lessons();
    },

    /** @returns true if the event was consumed — it consumes everything */
    pointer(ev) {
      if (!open) return false;
      if (ev.type !== 'down') return true;
      /* three ways out, the same three the install card was given: the pill,
         the backdrop above the panel, and the way she came in */
      if (ev.y < topY() + 6) { panel.stop(); return true; }
      if (hit(closeRect(), ev)) { panel.stop(); return true; }
      return true;
    },

    draw(g) {
      if (slide.x < 0.002) return;
      const c = g.ctx;
      const a = clamp(slide.x, 0, 1);
      const top = topY();
      const h = rowH();

      c.save();
      c.fillStyle = SURF.scrim(SCRIM * a);
      c.fillRect(0, 0, W, H);
      c.restore();
      card(c, 0, top, W, H - top + 24, { r: R.lg, fill: PANEL, fade: a });

      c.save();
      /* the grabber, so it reads as a sheet she can push away */
      c.fillStyle = SURF.border(0.26);
      roundRect(c, W / 2 - 20, top + 9, 40, 4, 2); c.fill();
      /* the row faces, before any type, so `over: ROW` is true of what is
         actually behind the ink */
      for (let i = 0; i < rows.length; i++) {
        const r = rowRect(i);
        c.fillStyle = ROW;
        roundRect(c, r.x, r.y, r.w, r.h, R.md); c.fill();
      }
      const cl = closeRect();
      tactile(c, { x: cl.x, y: cl.y, w: cl.w, h: cl.h, r: R.full, p: 0, face: PILL });
      c.restore();

      stitchedDivider(c, pad, top + TL.headH - 8, W - pad, { fade: a * 0.85 });

      drawText(g, copy.tricksTitle ? copy.tricksTitle(pron()) : 'Tricks', {
        ...type('titleMd', { weight: 800 }),
        x: pad + 2, y: top + 32, anchor: 'free', align: 'left',
        ink: INK.heading, over: PANEL, fade: a,
        maxWidth: W - pad * 2 - 100,
      });

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const r = rowRect(i);
        /* the level word is right-aligned and sized for its longest value, and
           the name column stops where it starts — the two-column collision
           ui/sheet.js and ui/shop.js each had to fix once already */
        const knowW = 76;
        const leftW = r.w - 28 - knowW - 10;
        drawText(g, row.name, {
          ...type('labelMd', { weight: 700 }),
          x: r.x + 14, y: r.y + 17, anchor: 'free', align: 'left',
          ink: INK.body, over: ROW, fade: a, maxWidth: leftW,
        });
        /* HOW WELL HE KNOWS IT, IN WORDS — the same five the cue legend uses,
           so an untaught trick reads "new" here and nowhere else has to say it.
           The ink is the only thing `started` changes: a level he has actually
           reached is emphasis, "new" is not. */
        drawText(g, row.know, {
          ...type('labelSm', { weight: 800 }),
          x: r.x + r.w - 14, y: r.y + 18, anchor: 'free', align: 'right',
          ink: row.started ? INK.heading : INK.faint(), over: ROW, fade: a,
          maxWidth: knowW,
        });
        /* WHAT HE DOES — the line that was nowhere in the game before, and it
           is drawn for every trick whether or not he has tried it.

           The first version put "he has not tried this one yet" here instead
           for anything untaught, which rendering it immediately showed to be
           the original defect wearing a new coat: on first open all eight rows
           said that and not one of them said what a trick WAS. The right-hand
           word already carries "new". */
        drawText(g, row.does, {
          ...type('labelSm', { weight: 500, track: 0 }),
          x: r.x + 14, y: r.y + 38, anchor: 'free', align: 'left',
          ink: INK.soft(0.82), over: ROW, fade: a, maxWidth: r.w - 28,
        });
        /* how to ask for it */
        drawText(g, row.hint, {
          ...type('labelSm', { weight: 600, track: 0 }),
          x: r.x + 14, y: r.y + 56, anchor: 'free', align: 'left',
          ink: INK.body, over: ROW, fade: a, maxWidth: r.w - 28,
        });
        /* ...and, only when it will not work from where he is, why not */
        if (row.needs) {
          drawText(g, row.needs, {
            ...type('labelSm', { weight: 500, track: 0 }),
            x: r.x + 14, y: r.y + 74, anchor: 'free', align: 'left',
            ink: INK.faint(0.7), over: ROW, fade: a, maxWidth: r.w - 28,
          });
        }
      }

      drawText(g, copy.tricksClose ? copy.tricksClose() : 'Done', {
        ...type('labelMd', { weight: 800 }),
        x: cl.x + cl.w / 2, y: cl.y + cl.h / 2, anchor: 'free', align: 'center',
        ink: INK.body, over: PILL, fade: a, maxWidth: cl.w - 10,
      });
    },

    get debug() {
      return {
        open, weight: +slide.x.toFixed(3),
        rowH: rowH(),
        /* the whole point of the panel, in a form a gate can assert */
        rows: rows.map((r) => ({
          id: r.id, know: r.know, started: r.started, ready: r.ready,
          does: r.does, hint: r.hint, needs: r.needs,
        })),
        close: closeRect(),
      };
    },
  };

  return panel;
}

export default createTrickList;
