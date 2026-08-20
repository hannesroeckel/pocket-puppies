/* ==========================================================================
   ui/howto.js — HOW THIS BIT WORKS, SAID ONCE.

   The brief, from the person the game was made for, after playing 8.17.0:

     "we need an explanation on the disc in the game. one doesnt really know
      what to do. in general we should always include a tutorial for any
      feature/mode in the game."

   Both halves matter. The disc game was the immediate complaint — three
   invisible things at once (that she flicks, that she taps, and that the tap is
   TIMED) — but the general rule is the more valuable one, so this is a layer
   rather than a paragraph in `dog/disc.js`.

   ONE CARD, ONE RULE
   ------------------
   The card opens on the first frame of a mode's own surface, the first time that
   mode is ever opened, and never again unless she asks. It is dismiss-only.

   NOT AFTER A MISTAKE. The obvious alternative — explain it once she has failed
   — is forbidden by SCOPE's non-negotiable that "losing must never feel like
   rebuke". Kind words cannot rescue that structure: a card that arrives after a
   dropped disc IS the game telling her she did it wrong, whatever it says.

   NOT ON THE FIRST LAUNCH. `docs/GIFT-READY.md` §4.1: "no UI clutter, no
   tutorial in front of it". The naming beat and the reunion are excluded by
   `howtoContext()` in scenes/room.js, so the first thing she ever sees is still
   a puppy. The first card she can possibly meet is one she opened a mode to get.

   WHY THE `?` IS IN ONE PLACE AND NOT SEVEN
   -----------------------------------------
   The way back in is a single chip at the top-right of the safe area, mirroring
   the back circle at the top-left — drawn and hit-tested here, once, for every
   mode. The alternative was a chip per surface: seven hit rects, seven layouts,
   seven chances for `ui/reach.js` to report a violation. This layer already
   knows which mode is open, because the room hands it that on every frame.

   WHAT IS NOT IN HERE
   -------------------
   Modes that explain themselves get no card, and that list was drawn up by
   reading each one rather than by taste:

     - FEED / WATER / WASH already set sequential gesture hints ("Slide his bowl
       over", then "Hold the bag over the bowl"). A card would repeat itself two
       seconds early.
     - THE SHOP is a priced list with a purse on it.
     - THE TRICK LIST *is* an explainer — four authored lines per trick. A card
       explaining the explainer is the clutter GIFT-READY warns about, so the
       trick list is a STEP on the training card instead.
     - PETTING, and this one is deliberate: GIFT-READY 2.4 is closed on the
       observed fact that touching him is the first thing anyone does.
     - THE PAW SHAKE, because §26.1 chose discovery on purpose: "a puppy paws at
       you long before it means anything, and discovering that is nicer than
       being told".
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { clamp, TAU } from '../engine/draw.js';
import { makeSprings } from '../engine/spring.js';
import { drawText, measure } from './text.js';
import { INK, SURF, type } from './tokens.js';
import { card as drawCard, tactile, createPresses } from './surface.js';

const VW = BALANCE.view.W;
const VH = BALANCE.view.H;
const U = BALANCE.ui.howto;

/* ==========================================================================
   THE COPY. Every line is a function of pronouns, because the dog's are hers to
   choose — `capitalise(P.they)` + `${P.s}` / `${P.has}` / `${P.is}` rather than
   hand-built `P.they === 'he' ? ... : ...` triples, which is how `dog/disc.js`
   ended up with a ternary whose two branches were identical.

   Every step is a THING HER FINGER DOES, in the order she does it, and measured
   at its longest pronoun expansion so "they" does not wrap.
   ========================================================================== */
const cap = (w) => (w ? w[0].toUpperCase() + w.slice(1) : w);

export const HOWTO = {
  disc: {
    title: () => 'Catching the disc',
    steps: [
      () => 'Flick the disc up-screen',
      (P) => `${cap(P.they)} run${P.s} to get under it`,
      (P) => `Tap as it drops to ${P.them}`,
    ],
    note: (P) => `${cap(P.they)} always get${P.s} there — you time the jump`,
  },
  ring: {
    title: () => 'In the ring',
    steps: [
      () => 'The judge calls a trick',
      (P) => `Give the signal — ${P.they} do${P.s} the rest`,
      (P) => `No stroking — this bit is ${P.theirs}`,
    ],
    note: () => 'A bath first: grooming is marked too',
  },
  train: {
    title: () => 'Teaching a trick',
    steps: [
      (P) => `Draw the signal above ${P.them}`,
      () => 'Then guide the pose with a finger',
      () => 'Reward while it is happening',
      () => 'Tricks shows what to teach',
    ],
    note: (P) => `A few goes over a few days and ${P.they} ${P.has} it`,
  },
  walk: {
    title: () => 'Going out',
    steps: [
      (P) => `Clip the lead on ${P.them}`,
      () => 'Tap a place, or draw a route',
      (P) => `${cap(P.they)} go${P.s} out alone`,
      (P) => `${cap(P.they)} come${P.s} back with something`,
    ],
    note: (P) => `Close the app if you like — ${P.they} will be back`,
  },
  brush: {
    title: () => 'Brushing',
    steps: [
      (P) => `Stroke down the way the coat lies`,
      () => 'Upwards is a bad spot',
      () => 'A glossy coat counts in the ring',
    ],
    note: (P) => `${cap(P.they)} will tell you if you go wrong`,
  },
  kennel: {
    title: () => 'Your dogs',
    steps: [
      () => 'Tap a dog to bring them in',
      () => 'Caring for them earns care points',
      () => 'Care points bring things home',
    ],
    note: () => 'Coins cannot buy anything on this list',
  },
  collection: {
    title: (P) => `What ${P.they} brought home`,
    steps: [
      () => 'Tap a thing to put it on the sill',
      () => 'Tap it again to put it away',
      () => 'A bell or a ribbon can be worn',
    ],
    note: () => 'A second one of anything sells for coins',
  },
};

/** every id that has a card, for the gates and for the settings row */
export const HOWTO_IDS = Object.keys(HOWTO);

export function createHowto(opts = {}) {
  const game = opts.game;
  const reduced = !!opts.reduced;
  const sound = opts.sound || (() => {});
  const sp = makeSprings(['card', 'chip'], reduced);
  const press = createPresses(reduced);

  let id = '';            // the card on screen, '' for none
  let context = '';       // the mode currently open, '' for the plain room
  let t = 0;
  /* WHETHER THE CHIP IS HOLDING THE GESTURE, as a fact rather than as an
     animation. The first version asked `press.at('chip') > 0`, which is the
     EASED press value — it starts at zero and ramps over `PRESS.dur` — so a tap
     whose down and up land in the same frame read as "never pressed" and the ?
     did nothing. Real on a phone (a fast tap is one frame), and caught by the
     gate driving down and up without stepping between them. */
  let chipDown = false;

  const P = () => game.pron;
  const entry = () => (id && HOWTO[id]) || null;

  /* ---- geometry ------------------------------------------------------
     The height is computed from the number of steps rather than fixed, because
     the training card has four and brushing has two, and a fixed box would
     either crop one or leave a hole in the other. `kennel.js` has the cautionary
     tale: a sentence measured at 334 units in a 116-unit slot, shrunk to
     `minSize`, ellipsised to "She goes to someone wh…", and only ever caught by
     cropping in on a render. */
  function cardBox() {
    const e = entry();
    const n = e ? e.steps.length : 0;
    const h = U.padTop + n * U.stepGap + (e && e.note ? U.noteGap : 0) + U.padBottom;
    return { x: (VW - U.w) / 2, y: Math.max(U.minTop, (VH - h) / 2 - 40), w: U.w, h };
  }
  function doneBox() {
    const b = cardBox();
    return { x: b.x + (b.w - U.done.w) / 2, y: b.y + b.h - U.done.h - U.done.inset,
      w: U.done.w, h: U.done.h };
  }
  /* THE WAY BACK IN, mirroring the way out. `contest.ring.back` is the one place
     the whole game puts "get me out of here" (top-left); this is the same circle
     on the other side, and it is the same size so the pair reads as a pair. */
  function chipAt(view) {
    const B = BALANCE.contest.ring.back;
    /* the back circle's own y already clears the safe-area top on every device
       the room has been measured on; mirroring x is the whole of the geometry,
       and mirroring it rather than choosing a new number is why the pair reads
       as a pair. `view` is accepted and unused so the signature can grow if a
       device ever needs it. */
    return { x: VW - B.x, y: B.y, r: B.r };
  }
  function inRect(r, x, y) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

  /* ---- opening and closing ------------------------------------------- */
  function open(which) {
    if (!which || !HOWTO[which]) return false;
    id = which;
    chipDown = false;
    t = 0;
    sp.card.set(0).to(1);
    press.clear();
    sound('perk');   // the same small attention noise every panel opens with
    return true;
  }

  function close() {
    if (!id) return false;
    /* MARKED SEEN ON THE WAY OUT, not on the way in: a card she never dismissed
       — because the app was closed, or the phone locked, or she wandered off —
       is a card she did not read, and she should meet it again. */
    if (game && game.markHowtoSeen) game.markHowtoSeen(id);
    id = '';
    sp.card.to(0);
    press.clear();
    return true;
  }

  /**
   * THE ROOM TELLS THIS LAYER WHERE SHE IS, every frame, and this decides
   * whether that is worth a card. One integration point, so a new mode gets an
   * explainer by adding a line to `howtoContext()` and an entry to `HOWTO` —
   * and not by threading a chip and a hit rect through another surface.
   */
  function setContext(which) {
    const next = HOWTO[which] ? which : '';
    if (next === context) return;
    context = next;
    if (context && game && !game.seenHowto(context)) open(context);
    /* the mode closed under an open card (she pressed the back button through
       it, or the walk moved on): the card goes with it */
    else if (!context && id) { id = ''; sp.card.to(0); }
  }

  function update(dt) {
    t += dt;
    for (const k in sp) sp[k].step(dt);
    press.update(dt);
    sp.chip.to(context && !id ? 1 : 0);
  }

  /* ---- pointer -------------------------------------------------------
     WHEN THE CARD IS OPEN IT TAKES EVERYTHING. That is what `modal` means to
     `scenes/room.js`'s arbiter, and it is why a tap anywhere outside the card
     closes it rather than falling through to the mode underneath — a tap that
     reaches the disc through an explanation of the disc is a tap she did not
     mean. */
  function pointer(ev) {
    if (id) {
      if (ev.type === 'down') {
        press.set('done', inRect(doneBox(), ev.x, ev.y));
        return true;
      }
      if (ev.type === 'move') return true;
      if (ev.type === 'up' || ev.type === 'cancel') {
        press.clear();
        if (t > 0.18) close();
        return true;
      }
      return true;
    }
    /* closed: the chip is the only thing this layer owns, and it claims a touch
       that STARTS on it and nothing else (§21.5's rule for the Tricks pill) */
    if (!context) { chipDown = false; return false; }
    if (ev.type === 'down') {
      const ch = chipAt(ev.view);
      if (Math.hypot(ev.x - ch.x, ev.y - ch.y) <= ch.r + 8) {
        chipDown = true;
        press.set('chip', true);
        return true;
      }
      return false;
    }
    if (!chipDown) return false;
    if (ev.type === 'move') return true;
    /* up or cancel: it owns the gesture it started, and only an `up` opens */
    const wanted = ev.type === 'up';
    chipDown = false;
    press.clear();
    if (wanted) { open(context); return true; }
    return true;
  }

  /* ---- draw ---------------------------------------------------------- */
  function drawChip(g) {
    const a = clamp(sp.chip.x, 0, 1);
    if (a < 0.02) return;
    const c = g.ctx;
    const ch = chipAt(g.view);
    c.save();
    c.globalAlpha = a * 0.72;
    c.fillStyle = SURF.chrome;
    c.beginPath(); c.arc(ch.x, ch.y, ch.r, 0, TAU); c.fill();
    c.restore();
    drawText(g, '?', {
      ...type('titleMd', { weight: 800 }),
      x: ch.x, y: ch.y + 7, anchor: 'free', align: 'center',
      ink: INK.heading, over: SURF.chrome, fade: a,
    });
  }

  function draw(g) {
    const a = clamp(sp.card.x, 0, 1);
    if (a < 0.02) { drawChip(g); return; }
    const e = entry() || HOWTO.disc;
    const c = g.ctx;
    const b = cardBox();
    /* the room behind it goes quiet. Not dark — this is a card, not a modal
       dialog, and the dog is still there */
    c.save();
    c.globalAlpha = a * U.scrim;
    c.fillStyle = SURF.scrim(1);
    c.fillRect(-40, -40, VW + 80, VH + 80);
    c.restore();

    drawCard(c, b.x, b.y, b.w, b.h, { r: U.r, fill: SURF.card, fade: a });
    drawText(g, e.title(P()), {
      ...type('titleMd', { weight: 800 }),
      x: VW / 2, y: b.y + 38, anchor: 'free', align: 'center',
      ink: INK.heading, over: SURF.card, fade: a, maxWidth: b.w - 40,
    });

    let y = b.y + U.padTop;
    e.steps.forEach((line, i) => {
      /* a number, then the words. The number is the only thing in the game that
         counts anything at the player, and it counts her fingers rather than
         the dog — SCOPE forbids bars and scores, not step 1 of 3. */
      const nx = b.x + U.numX;
      c.save();
      c.globalAlpha = a * 0.9;
      c.fillStyle = SURF.chipWarm;
      c.beginPath(); c.arc(nx, y - 5, U.numR, 0, TAU); c.fill();
      c.restore();
      drawText(g, String(i + 1), {
        ...type('labelSm', { weight: 800 }),
        x: nx, y: y, anchor: 'free', align: 'center',
        ink: INK.heading, over: SURF.chipWarm, fade: a,
      });
      drawText(g, line(P()), {
        ...type('labelMd', { weight: 500 }),
        x: nx + U.numR + U.numGap, y, anchor: 'free', align: 'left',
        ink: INK.body, over: SURF.card, fade: a,
        maxWidth: b.w - (U.numX + U.numR + U.numGap) - U.textRight,
      });
      y += U.stepGap;
    });

    if (e.note) {
      drawText(g, e.note(P()), {
        ...type('labelSm', { weight: 500 }),
        x: VW / 2, y: y + 12, anchor: 'free', align: 'center',
        ink: INK.soft(0.85), over: SURF.card, fade: a, maxWidth: b.w - 36,
      });
    }

    const db = doneBox();
    tactile(c, {
      x: db.x, y: db.y, w: db.w, h: db.h, r: db.h / 2,
      face: SURF.chipStrong, fade: a, press: press.at('done'),
    });
    drawText(g, 'Got it', {
      ...type('labelMd', { weight: 800 }),
      x: db.x + db.w / 2, y: db.y + db.h / 2 + 6, anchor: 'free', align: 'center',
      ink: INK.onStrong, over: SURF.chipStrong, fade: a, maxWidth: db.w - 16,
    });
  }

  return {
    setContext,
    open,
    close,
    update,
    pointer,
    draw,
    get isOpen() { return !!id; },
    /* the arbiter's word for "nothing else may open right now" */
    get modal() { return !!id; },
    get owns() { return !!id; },
    get context() { return context; },
    get id() { return id; },
    /* the reachability assertion needs to know about the one control this layer
       owns while the card is shut; the card's own button is centred and cannot
       land under the nav */
    reachProbe() { return doneBox(); },
    /**
     * DID ANY OF IT HAVE TO BE SHRUNK OR CUT, for tools/howtogate.py.
     *
     * `ui/text.js` never clips: it shrinks to `minSize` and then ellipsises, so
     * a line that is too long does not look broken — it looks like slightly
     * smaller text, or like a sentence that ends in "…". `kennel.js` shipped
     * exactly that ("She goes to someone wh…") and only a render caught it.
     * This measures every line the card draws, with the same options it draws
     * them with, and reports what `measure()` had to do about it.
     */
    audit(g) {
      const e = entry();
      if (!g || !e) return null;
      const b = cardBox();
      const rows = [];
      const take = (text, o, want) => {
        const m = measure(g, text, o);
        rows.push({
          text, got: m.str, size: +m.size.toFixed(2), want,
          cut: m.str !== text, shrunk: m.size < want - 0.01,
        });
      };
      const t1 = type('titleMd', { weight: 800 });
      take(e.title(P()), { ...t1, x: VW / 2, y: b.y + 38, align: 'center', maxWidth: b.w - 40 },
        t1.size);
      const t2 = type('labelMd', { weight: 500 });
      const stepW = b.w - (U.numX + U.numR + U.numGap) - U.textRight;
      e.steps.forEach((line) => {
        take(line(P()), { ...t2, x: b.x + U.numX + U.numR + U.numGap, y: 0,
          align: 'left', maxWidth: stepW }, t2.size);
      });
      if (e.note) {
        const t3 = type('labelSm', { weight: 500 });
        take(e.note(P()), { ...t3, x: VW / 2, y: 0, align: 'center', maxWidth: b.w - 36 }, t3.size);
      }
      return { id, box: b, rows };
    },
    get debug() {
      return {
        id, context, open: !!id,
        seen: HOWTO_IDS.filter((k) => game && game.seenHowto(k)),
        box: cardBox(), done: doneBox(),
      };
    },
  };
}

export default createHowto;
