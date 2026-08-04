/* ==========================================================================
   ui/shop.js — the shop. COINS ONLY, OBJECTS ONLY.

   THE ONE ABSOLUTE RULE, and this file's whole job is to make it visible as
   well as true: **sell OBJECTS for coins; gate CONTENT on care points.** So:

     - the only number in the header is her PURSE. Care points are not shown
       here at all, on any row, in any state. The kennel shows those, and the
       kennel has no prices on it. Two surfaces, one currency each, is how a
       player learns the rule without being told it.
     - the row that needs a care unlock (`treatsGood`) says what it is WAITING
       for, in care-point terms, and never offers a price as an alternative.
       There is no "or 900 coins".
     - every purchase goes through `game.buyItem()`, which refuses any id that
       appears in `BALANCE.economy.unlocks` before a coin moves. This file
       could not sell the Cockapoo if it tried.

   Nothing here writes state directly. Everything is a `state/game.js`
   mutator, hardened against undefined/NaN there.

   All copy is pronoun-parameterised from `game.pron`, resolved per dog at
   runtime: the gift puppy is a male Schnoodle and the Cockapoo may be female,
   so the same shop is read by two different dogs' owners.

   Text goes through ui/text.js. There is not one `fillText` in this file.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { clamp, roundRect, TAU, rgba } from '../engine/draw.js';
import { Spring } from '../engine/spring.js';
import { drawText } from './text.js';
import { INK, SURF, R, PRESS, type } from './tokens.js';
import { tactile, createPresses } from './surface.js';
import { drawBone, drawBall, drawBrush, drawSoap } from '../scenes/props.js';

const W = BALANCE.view.W;
const H = BALANCE.view.H;
const S6 = BALANCE.ui.shop;

/* the panel is opaque, so `over` gives ui/text.js an exact contrast answer
   rather than a bound — the same reason ui/sheet.js publishes its colours.

   THESE ARE TOKENS NOW, and this file is one of the reasons the audit exists:
   every one of them was a hex typed out here AND, slightly differently, in
   ui/kennel.js and ui/sheet.js. `#fdf3df` / `#f7e7cd` / `#efe3d2` / `#e9954f` /
   `#d8c8b2` are surface-low, surface-container, surface-dim, the
   secondary-container chip and the disabled chip — six roles, three spellings.
   `SCRIM` keeps its name but is now only the base ALPHA: ui/tokens.js owns the
   colour under it, which also retires a `String.replace()` on a colour literal
   as the way this file animated its backdrop. */
const SCRIM = 0.44;
const PANEL = SURF.card;
const ROW = SURF.row;
const ROW_OFF = SURF.rowOff;
/* THE ACTIONABLE CHIP IS THE FILLED DARK BUTTON, NOT THE PALE ONE.
   It was `#e9954f`, a saturated orange, and the straight token swap to
   `secondary-container` (#fed6a7) made it a pale peach sitting on a
   `surface-container` (#ffebcf) row — a nine-step difference in one channel.
   RENDERED AND LOOKED AT: the chip had vanished. It read as a floating label,
   which is the worst possible outcome for the one control on the row that
   does something.
   `chipStrong` is Material's own answer (the `primary` role, filled, with
   light ink on it) and it is what ui/install.js's primary button uses, so the
   two most important buttons in the game now agree. The hierarchy is carried
   by LIGHTNESS rather than saturation, which is what survives a warm cream
   surface — and a dark chip on cream is unambiguous about being pressable. */
const CHIP = SURF.chipStrong;
const CHIP_OFF = SURF.chipOff;
/* the purse pill and the Done chip were `#f3e3c6` and `#f0dfc2`: two
   near-misses of one cream pill, which is the whole complaint in miniature */
const PILL = SURF.chip;
/* the press highlight on a tapped row. Was `#fff6df`, a warm near-white — the
   token for warm near-white chrome is `surface`. */
const FLASH = SURF.chrome;

export const COPY = {
  title: 'Shop',
  purse: (n) => `${n}`,
  /* pronoun-parameterised: `P` is game.pron for the dog currently in the room */
  emptyPurse: (P) => `Walks and the ring pay for this. Take ${P.them} out.`,
  bought: (name) => `${name} — bought`,
  short: (n) => `${n} more coin${n === 1 ? '' : 's'}`,
  owned: 'Owned',
  wear: 'Wear',
  worn: 'Worn',
  give: 'Give',
  gone: 'All gone',
  needs: (n) => `${n} care points`,
  lockNote: (short) => (short > 0
    ? `${short} more care points and the shop will stock these`
    : 'On the shelf now'),
  treatGiven: (P, name) => `${cap(P.they)} had a treat`,
  treatNone: 'None left',
  full: 'Enough for now',
  close: 'Done',
};

const cap = (w) => (w ? w[0].toUpperCase() + w.slice(1) : w);

/* THE COLLAR COLOURS, and they are the one place a shop item and a care
   unlock share a slot. That is deliberate and it is the rule demonstrated
   rather than bent: a plain collar is an OBJECT and costs coins; the red one
   is EARNED and cannot be bought at any price. Same neck, two currencies,
   no exchange. `WEAR_COLOUR` is also what dog/draw.js paints. */
export const WEAR_COLOUR = BALANCE.ui.wear;

export function collarGlyph(c, x, y, id) {
  const col = WEAR_COLOUR[id] || WEAR_COLOUR.collarBlue;
  c.save();
  c.translate(x, y - 1);
  c.strokeStyle = col; c.lineWidth = 5.2; c.lineCap = 'round';
  c.beginPath(); c.arc(0, 0, 8.6, Math.PI * 0.10, Math.PI * 0.90); c.stroke();
  if (id === 'collarTag') {
    c.fillStyle = '#e0b23f';
    c.beginPath(); c.arc(0, 11.5, 3.6, 0, TAU); c.fill();
  }
  c.restore();
}

/* tiny product glyphs, drawn not fonted — the same discipline as ui/nav.js.
   Each one reuses the prop the game already draws for that object, so a row
   shows the actual thing she is buying rather than an icon of it. Note the
   signatures differ (drawBone takes a rotation, not a scale), which is why
   these wrap rather than being called inline. */
function glyphFor(id, kind) {
  if (id === 'bone') {
    return (c, x, y) => { c.save(); c.translate(x, y); c.scale(0.62, 0.62); drawBone(c, 0, 0, -0.25); c.restore(); };
  }
  if (kind === 'toy') return (c, x, y) => drawBall(c, x, y, 0.46, 0);
  if (kind === 'wear') return (c, x, y) => collarGlyph(c, x, y, id);
  if (id === 'brushSoft') return (c, x, y) => drawBrush(c, x, y - 2, 0.5, -0.3);
  if (id === 'soapOat') return (c, x, y) => drawSoap(c, x, y, 0.6, 0.2);
  /* a treat: a little biscuit */
  return (c, x, y) => {
    c.save(); c.translate(x, y);
    c.fillStyle = '#c98a4b';
    roundRect(c, -11, -7, 22, 14, 5); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.35)';
    roundRect(c, -8, -5, 8, 4, 2); c.fill();
    c.fillStyle = '#8a5a2c';
    c.beginPath(); c.arc(-3, 1, 1.7, 0, TAU); c.fill();
    c.beginPath(); c.arc(4, -1, 1.7, 0, TAU); c.fill();
    c.restore();
  };
}

/**
 * @param opts { game, reduced, sound, toast, blocked }
 *   `blocked(who)` is scenes/room.js's `surfaceBlockedFor` — NOT a private
 *   guard. Stage 4 established that a layer with its own `if` cannot be told
 *   about layers added after it (ARCHITECTURE §14.1), and stage 5 paid for it.
 */
export function createShop(opts = {}) {
  const game = opts.game;
  const reduced = !!opts.reduced;
  const sound = opts.sound || (() => {});
  const toast = opts.toast || (() => {});
  const blocked = opts.blocked || (() => '');

  const slide = new Spring(0, reduced ? 96 : 132, reduced ? 20 : 16);
  let open = false;
  let bottomInset = 0;
  let t = 0;
  /* which row was last pressed, and how long ago — the only motion in here */
  let flashId = '';
  let flashT = 0;
  let rows = [];
  /* THE TACTILE PRESS RIDES ON THE FLASH. The rows and chips are pressable
     objects now (ui/surface.js), and a press needs a clock — but this file
     already had one, and it already knows what was tapped. Deriving the
     compression from `flashId`/`flashT` in update() means no second input path
     and no second answer to "which row did she touch"; the flash highlight goes
     on doing exactly what it did. */
  const presses = createPresses(reduced);

  const pad = S6.pad;
  const rowH = S6.rowH;

  function headH() { return S6.headH; }
  function listTop() { return topY() + headH(); }
  function height() { return H; }
  function topY() { return H * (1 - clamp(slide.x, 0, 1)); }

  /** rebuild the resolved rows. Cheap; called on open and after every buy. */
  function refresh() {
    rows = game.shopStock().map((it) => ({ ...it, glyph: glyphFor(it.id, it.kind) }));
  }

  function rowRect(i) {
    return { x: pad, y: listTop() + i * rowH, w: W - pad * 2, h: rowH - S6.rowGap };
  }
  /** the right-hand action chip, when a row has a second thing to do */
  function chipRect(i) {
    const r = rowRect(i);
    return { x: r.x + r.w - S6.chipW - 10, y: r.y + (r.h - S6.chipH) / 2, w: S6.chipW, h: S6.chipH };
  }
  function actionFor(row) {
    if (row.kind === 'treat' && row.owned > 0) return 'give';
    if (row.kind === 'wear' && row.owned > 0) return game.worn === row.id ? 'worn' : 'wear';
    return '';
  }

  const shop = {
    get isOpen() { return open; },
    /** owns the whole surface while it is up — scenes/room.js consults this */
    get modal() { return open; },
    get active() { return open || slide.x > 0.01; },
    COPY,
    setInset(v) { bottomInset = v; },

    start() {
      const why = blocked('shop');
      if (why) return why;
      open = true;
      refresh();
      slide.to(1);
      sound(S6.sfx.open);
      return '';
    },
    stop() {
      if (!open) return;
      open = false;
      slide.to(0);
      sound(S6.sfx.close);
    },
    toggle() { if (open) { shop.stop(); return ''; } return shop.start(); },

    update(dt) {
      t += dt;
      slide.step(dt);
      if (flashT > 0) {
        /* down for the first `PRESS.dur * 1.1`, then released — so the row
           compresses and springs back while the highlight is still fading,
           rather than staying squashed for the whole 0.28s or snapping open the
           instant it is touched (the same shape ui/sheet.js uses) */
        presses.set(flashId, flashT > S6.flash - PRESS.dur * 1.1);
        flashT = Math.max(0, flashT - dt);
        if (flashT === 0) presses.clear();
      }
      presses.update(dt);
      /* the purse and the care gate can both move while she is looking at it
         (a walk can finish, a trial can pay out), so the shelf is re-resolved
         rather than snapshotted at open */
      if (open) refresh();
    },

    /** @returns true if the event was consumed */
    pointer(ev) {
      if (!open) return false;
      if (ev.type !== 'down') return true;
      /* the close affordance, and the backdrop above the panel */
      if (ev.y < topY() + 6) { shop.stop(); return true; }
      const cl = closeRect();
      if (hit(cl, ev)) { shop.stop(); return true; }
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const act = actionFor(row);
        if (act === 'give' || act === 'wear') {
          if (hit(chipRect(i), ev)) { doAction(row, act); return true; }
        }
        if (hit(rowRect(i), ev)) { doBuy(row); return true; }
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
      c.fillStyle = PANEL;
      roundRect(c, 0, top, W, H - top + 24, 24); c.fill();
      c.strokeStyle = SURF.border(); c.lineWidth = 1.2;
      roundRect(c, 0, top, W, H - top + 24, 24); c.stroke();
      /* the grabber, so it reads as a sheet she can push away */
      c.fillStyle = SURF.border(0.26);
      roundRect(c, W / 2 - 20, top + 9, 40, 4, 2); c.fill();

      /* THE PURSE, and it is the only currency on this surface */
      const pr = purseRect();
      c.fillStyle = PILL;
      roundRect(c, pr.x, pr.y, pr.w, pr.h, pr.h / 2); c.fill();
      c.fillStyle = '#e0b23f';
      c.beginPath(); c.arc(pr.x + 15, pr.y + pr.h / 2, 7.5, 0, TAU); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.45)';
      c.beginPath(); c.arc(pr.x + 13, pr.y + pr.h / 2 - 2, 3, 0, TAU); c.fill();

      /* the row backings, before any type, so `over` is true of what is behind.
         EVERY ROW AND CHIP IS A TACTILE OBJECT NOW: a 4-unit bottom edge that
         compresses under the thumb, which is what makes a shelf read as things
         she can pick up rather than as coloured bands. The edge hangs in the
         6-unit `rowGap` the layout already left, so nothing moves. */
      const rowDy = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rowRect(i);
        const row = rows[i];
        const flash = flashId === row.id ? flashT / S6.flash : 0;
        /* one press per ROW, shared with its chip: the flash is keyed by row id
           and cannot tell a chip tap from a row tap, so both compress together —
           which is also how the highlight has always behaved. */
        const p = presses.at(row.id);
        const f = tactile(c, {
          x: r.x, y: r.y, w: r.w, h: r.h, r: R.md, p,
          face: row.locked ? ROW_OFF : ROW,
        });
        /* kept for the type pass below, which is a separate loop: content has to
           sink WITH the face or the label floats while the row goes down, and
           ui/surface.js returns `dy` for exactly that reason */
        rowDy[i] = f.dy;
        if (flash > 0) {
          c.globalAlpha = flash * 0.5;
          c.fillStyle = FLASH;
          roundRect(c, r.x, r.y + f.dy, r.w, r.h, R.md); c.fill();
          c.globalAlpha = 1;
        }
        /* the product glyph */
        c.save();
        c.globalAlpha = row.locked ? 0.42 : 1;
        c.fillStyle = '#8a5a2c'; c.strokeStyle = '#8a5a2c';
        row.glyph(c, r.x + 26, r.y + f.dy + r.h / 2);
        c.restore();
        /* the action chip */
        const act = actionFor(row);
        if (act) {
          const q = chipRect(i);
          tactile(c, {
            x: q.x, y: q.y, w: q.w, h: q.h, r: R.full, p,
            face: act === 'worn' ? CHIP_OFF : CHIP,
          });
        }
      }
      const cl = closeRect();
      /* Done is tactile too. Nothing can be SEEN pressing it — the sheet closes
         on the same down event — but the bottom edge is what makes it a button
         rather than a cream band, which is ui/sheet.js's argument for its rows. */
      tactile(c, { x: cl.x, y: cl.y, w: cl.w, h: cl.h, r: R.full, p: 0, face: PILL });
      c.restore();

      /* ---- type, all of it through ui/text.js ---- */
      drawText(g, COPY.title, {
        ...type('titleMd', { weight: 800 }),
        x: pad + 2, y: top + 36, anchor: 'free', align: 'left',
        ink: INK.heading, over: PANEL, fade: a,
        maxWidth: W - pad * 2 - 110,
      });
      drawText(g, COPY.purse(game.coins), {
        ...type('labelMd', { weight: 800 }),
        x: pr.x + pr.w - 12, y: pr.y + pr.h / 2, anchor: 'free', align: 'right',
        ink: INK.body, over: PILL, fade: a,
        maxWidth: pr.w - 34,
      });

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const r = rowRect(i);
        const bg = row.locked ? ROW_OFF : ROW;
        const act = actionFor(row);
        const rightW = act ? S6.chipW + 16 : 74;
        const leftX = r.x + 48;
        const leftW = r.w - 48 - rightW - 8;
        /* the sink of the face this type sits on. The row and its chip share one
           press, so one offset serves both columns. */
        const dy = rowDy[i] || 0;
        drawText(g, row.name, {
          ...type('labelMd', { weight: 700 }),
          x: leftX, y: r.y + dy + r.h / 2 - 8, anchor: 'free', align: 'left',
          ink: INK.body, over: bg, fade: a,
          maxWidth: leftW,
        });
        /* the note, or — for the care-gated row — what it is waiting for. Never
           both, and never a price as an alternative to the care points. */
        const note = row.locked ? COPY.lockNote(row.needsShort) : row.note;
        drawText(g, note, {
          ...type('labelSm', { weight: 500, track: 0 }),
          x: leftX, y: r.y + dy + r.h / 2 + 10, anchor: 'free', align: 'left',
          ink: INK.soft(0.74), over: bg, fade: a,
          maxWidth: leftW,
        });
        if (act) {
          drawText(g, act === 'give' ? `${COPY.give} (${row.owned})` : (act === 'worn' ? COPY.worn : COPY.wear), {
            ...type('labelSm', { weight: 800 }),
            x: chipRect(i).x + S6.chipW / 2, y: chipRect(i).y + dy + S6.chipH / 2,
            anchor: 'free', align: 'center',
            ink: act === 'worn' ? INK.body : INK.onStrong,
            over: act === 'worn' ? CHIP_OFF : CHIP, fade: a, maxWidth: S6.chipW - 6,
          });
        } else {
          /* the price — or OWNED, or the care gate. The gate is stated in care
             points because that is the only thing that can open it. */
          /* NO NUMBER AT ALL IN THE PRICE COLUMN FOR A LOCKED ROW. It used
             to print "1100 care points" there, which put a care figure in the
             one position on this surface that means "this is what it costs" —
             and the note underneath was already saying the same thing better.
             The price column is for coins; a row coins cannot reach has no
             price. */
          const label = row.locked ? ''
            : (row.full ? (row.kind === 'treat' ? COPY.full : COPY.owned) : `${row.cost}`);
          /* a WORD takes the small step, a PRICE takes the label step — the same
             split the old 10.5/14 pair was making by hand. The locked and
             unaffordable inks were 0.62 and 0.48 of one brown: they are the same
             state ("coins cannot reach this"), so they are one token. */
          if (label) drawText(g, label, {
            ...type(row.locked || row.full ? 'labelSm' : 'labelMd', { weight: 800 }),
            x: r.x + r.w - 14, y: r.y + dy + r.h / 2, anchor: 'free', align: 'right',
            ink: row.locked ? INK.faint() : (row.afford ? INK.body : INK.faint()),
            over: bg, fade: a, maxWidth: 84,
          });
        }
      }

      drawText(g, COPY.close, {
        ...type('labelMd', { weight: 800 }),
        x: cl.x + cl.w / 2, y: cl.y + cl.h / 2, anchor: 'free', align: 'center',
        ink: INK.body, over: PILL, fade: a,
        maxWidth: cl.w - 10,
      });
    },

    get debug() {
      return {
        open, weight: +slide.x.toFixed(3),
        coins: game.coins,
        /* deliberately included so a test can assert it: the shop knows the
           care-point total exists and never uses it for a price */
        carePoints: game.carePoints,
        rows: rows.map((r) => ({
          id: r.id, kind: r.kind, cost: r.cost, owned: r.owned,
          locked: r.locked, needs: r.needs || '', needsAt: r.needsAt,
          afford: r.afford, short: r.short, full: r.full,
          action: actionFor(r),
        })),
      };
    },
  };

  function purseRect() { return { x: W - pad - 92, y: topY() + 22, w: 92, h: 28 }; }
  function closeRect() {
    const y = listTop() + rows.length * rowH + 8;
    return { x: pad, y: Math.min(y, H - 54 - bottomInset), w: W - pad * 2, h: 40 };
  }
  function hit(r, ev) {
    return ev.x >= r.x && ev.x <= r.x + r.w && ev.y >= r.y && ev.y <= r.y + r.h;
  }

  function doBuy(row) {
    flashId = row.id; flashT = S6.flash;
    /* a locked row is a CARE message. It must never mention coins, or the
       player learns that the two are interchangeable. */
    if (row.locked) {
      sound(S6.sfx.deny);
      toast(COPY.lockNote(row.needsShort));
      return;
    }
    if (row.full) {
      sound(S6.sfx.deny);
      toast(row.kind === 'treat' ? COPY.full : COPY.owned);
      return;
    }
    const res = game.buyItem(row.id);
    refresh();
    if (res.ok) {
      sound(S6.sfx.buy);
      toast(COPY.bought(res.item.name));
      /* a bought collar goes straight on: the reward should be visible in the
         room, not filed in a list she has to find again */
      if (res.item.kind === 'wear') game.equipWear(res.item.id);
      /* ...and a bought toy becomes the toy on the rug, for the same reason */
      if (res.item.kind === 'toy' && game.setActiveToy) game.setActiveToy(res.item.id);
      return;
    }
    sound(S6.sfx.deny);
    if (res.reason === 'poor') toast(COPY.short(res.short));
    else if (res.reason === 'locked') toast(COPY.lockNote(res.needsShort || 0));
    else if (res.reason === 'full') toast(COPY.owned);
    /* 'unlock' and 'unknown' are programmer errors, not player states: no toast
       invents an explanation for something that should be impossible */
  }

  function doAction(row, act) {
    flashId = row.id; flashT = S6.flash;
    if (act === 'give') {
      const res = game.giveTreat(row.id);
      refresh();
      if (res.ok) {
        sound(S6.sfx.give);
        toast(COPY.treatGiven(game.pron, row.name));
        if (opts.onTreat) opts.onTreat(row.id, res.mood);
      } else { sound(S6.sfx.deny); toast(COPY.treatNone); }
      return;
    }
    if (act === 'wear') {
      if (game.equipWear(row.id)) { sound(S6.sfx.wear); refresh(); }
      else sound(S6.sfx.deny);
    }
  }

  return shop;
}

export default createShop;
