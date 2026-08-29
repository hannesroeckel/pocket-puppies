/* ==========================================================================
   ui/kennel.js — the kennel. CARE POINTS ONLY, AND NOT ONE PRICE.

   Two jobs:
     1. show her dogs and let her swap which one is in the room;
     2. be the place a puppy is adopted — for CARE POINTS and for nothing else.
        There is no coin figure anywhere on this surface, no "or pay", and no
        code path that reads `game.coins`. The shop is the surface with a purse
        on it; this is the surface with her standing on it. One currency each is
        how the rule gets taught without a lecture.

   IT DOES NOT KNOW WHICH PUPPY IS ON OFFER, AND MUST NOT.
   It asks `game.adoptCheck()`, which answers with a `row` — the next breed on
   `BALANCE.economy.unlocks` she does not already own, with its name, its cost
   and its pronouns. Everything below is drawn and spoken from that row.

   This is not abstraction for its own sake: it is what was broken. The Cockapoo
   was named in this file's COPY three times, in `showNewCard`, and in
   `economy.kennel.adoptBreed`, so the Shiba — a complete breed in dog/breeds.js
   with a painted profile sheet, precached and gate-tested for eight stages — had
   no path into the game at all. There was nowhere to put him. Now there is a
   ladder row, and a second one after it would need no change here either.

   ADOPTING IS A BEAT, NOT A ROW TAP. "Adopting a second dog is a real
   milestone, not a menu" (SCOPE stage 6), and a milestone that resolves on
   the same frame as the tap is a menu with warmer copy. So there is a knock,
   a pause, a reveal, and then she is handed over to the room — where the
   naming beat opens on its own, because `scenes/room.js enter()` already
   opens it for any dog with no name. The most important moment in this file
   is one it deliberately does not own.

   WHAT IT DOES NOT DO: it never spends care points. Passing 400 does not
   consume 400 — care points are a lifetime total that gates content, not a
   balance, and there is no `spendCarePoints` in `state/game.js` and must
   never be one (ARCHITECTURE §15.6). She keeps the standing she earned.

   Copy is pronoun-parameterised per dog from `game.pron`, from each roster
   entry's own `pron`, and from the offered row's `pron`: the gift puppy is a
   male Schnoodle and the Cockapoo and the Shiba are both female, so this surface
   can have all three on screen at once and cannot use a single pronoun for
   "the dog". Not one string below contains "he", "she", "him" or "her".

   Text goes through ui/text.js. There is not one `fillText` in this file.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { clamp, roundRect, TAU, smooth, lerp } from '../engine/draw.js';
import { Spring } from '../engine/spring.js';
import { drawText, measure } from './text.js';
import { INK, SURF, C, R, PRESS, type, alpha } from './tokens.js';
import { tactile, createPresses } from './surface.js';
import { getBreed, BREEDS } from '../dog/breeds.js';
import { collarGlyph, WEAR_COLOUR } from './shop.js';

const W = BALANCE.view.W;
const H = BALANCE.view.H;
const K = BALANCE.ui.kennel;
const EK = BALANCE.economy.kennel;

/* THE SAME SIX CHROME ROLES ui/shop.js HAS, and until now the same six hexes
   typed out a second time — see the note at the top of that file. The two
   surfaces are meant to be siblings, so the one place they must agree is the
   place they were each guessing. */
const SCRIM = 0.44;
const PANEL = SURF.card;
const CARD = SURF.row;
/* the card of the dog who is IN THE ROOM. `#f6dfb4` is surface-highest typed
   from memory — and typed twice in this file, once here and once as the
   not-yet-adopted puppy's medallion, for two unrelated reasons. */
const CARD_ON = C.surfaceHighest;
const CARD_OFF = SURF.rowOff;
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
/* the standing pill and the Done chip were `#eee2c8` and `#f0dfc2`; the shop
   spelled the same two pills `#f3e3c6` and `#f0dfc2`. One role, one token. */
const PILL = SURF.chip;
/* the press highlight over a tapped portrait. Was `#fff6df`, warm near-white. */
const FLASH = SURF.chrome;

const cap = (w) => (w ? w[0].toUpperCase() + w.slice(1) : w);
/* 'Three is plenty'. Sparse on purpose: the kennel holds three dogs and the
   words run out one past any cap this game will ever have. Past the end the
   toast falls back to the digit, which is ugly but never wrong. */
const NUM_WORD = ['No', 'One', 'Two', 'Three', 'Four'];

export const COPY = {
  title: 'Your dogs',
  /* her standing, as a WORD plus the number. The word is what it says about
     her; the number is there because it is a currency she is saving. */
  standing: (word, pts) => `${cap(word)} · ${pts}`,
  here: 'Here now',
  bring: 'Bring in',
  unnamed: 'Not named yet',
  /* per-dog, so two dogs of different sexes read correctly on one screen */
  says: (P, aff) => `${cap(P.they)} ${P.is} ${aff}`,
  wearing: (name) => `Wearing ${name.toLowerCase()}`,
  wearNothing: 'No collar',

  /* THE ROW'S OWN NAME — 'A Cockapoo puppy', then 'A Shiba Inu puppy'. It was
     this literal, which is half of why the Shiba was unreachable: the card could
     only ever announce one dog. The fallback is for a row with no `name`, which
     the ladder should never contain but which must not render as `undefined`. */
  newTitle: (row) => (row && row.name) || 'A new puppy',
  /* the TOAST version, which has a whole line to itself and can afford the units */
  newLocked: (short) => `${short} more care points`,
  /* AND THE CHIP VERSION, WHICH CANNOT.
     The chip is 128 wide with a 120-unit text slot, and this string has been
     quietly shrinking in it since stage 6: the Cockapoo's worst case, '400 more
     care points', renders at 10.5 rather than 12. It was survivable at three
     digits. It is not at four — 8.24.0 put breed gates at 2400 and 3400, and
     `tools/kennelgate.py` measured '2380 more care points' at exactly 9.5, which
     is `BALANCE.ui.type.minSize`: the point where ui/text.js stops shrinking and
     starts ELLIPSISING. One more digit and the chip on the card a new player
     sees would have read '2380 more care poi…', which is this file's original
     sin ("She goes to someone wh…") committed a second time in the same place.

     `COPY.locked` — the idiom the earned rows immediately below this card have
     always used — is the fix, and it is a better line than the one it replaces
     rather than a compromise: the units are already stated on the row above it
     ('1020 / 2400 care points'), so 'more care points' was the third mention of
     them inside one card. One phrasing for "not yet, and by how much", used on
     every locked thing on the surface. Renders at the full 12 at any gate this
     ladder will ever carry. */
  lockedChip: (short) => `${short} to go`,
  /* SHORT ON PURPOSE, for the same reason `newReadyNote` below is — and this
     one was MISSED when that decision was made, which is why it shipped broken.
     It shares its line with the `320 more care points` chip, so its slot is
     `lw - 130` = 116 units. Measured with ui/text.js's own `measure()`:

       'She goes to someone who is already looking after a dog well.'  334  ✗
       'Earned by looking after him.'                                  154  ✗
       'Earned, not bought.'                                           108  ✓
       'By caring for him.'                                             96  ✓

     At 334 in a 116 slot the helper shrank it to `minSize` and then ellipsised,
     and it rendered as **"She goes to someone wh…"** — a sentence that says
     nothing, on the card a new player sees first. Caught by cropping in on the
     render, not by any gate; nothing was clipped and no contrast check failed,
     so nothing was there to fail.

     The lost sentence's MEANING is what deserved to survive, so it is recorded
     here: she goes to someone who is already looking after a dog well. The
     replacement keeps the part the other two lines do not already carry —
     line 2 gives the count and the chip gives the gap, so this gives the HOW.
     Widening the slot would mean narrowing the chip or restacking a 92-unit
     card, and neither is worth it for one row. */
  /* NO TERMINAL FULL STOP, here or in `newReadyNote`. The row-note slot is
     period-free everywhere else in the game — all eleven of the shop's item
     notes and every 'earned' note below — and these two were the exceptions.
     It showed: the adoption card carried 'She is ready to come home' with no
     stop directly above 'Nothing to pay.' with one, in the same card, two
     lines apart. Sentences that stand alone (`knock`, `reveal`, `earnedNone`)
     keep their stops; notes that label a row do not. */
  /* `P` is the pronoun of the dog SHE ALREADY HAS — care points come from
     looking after the one in the room. Was the literal 'By caring for him',
     which was true only while the resident could only be the Schnoodle.
     Still inside the 116-unit slot documented above: 'By caring for them' is
     the longest of the three at 18 characters. */
  newLockedNote: (P) => `By caring for ${P.them}`,
  /* `P` here is the OFFERED puppy's pronoun, not the resident's.
     `P.is` RATHER THAN A TYPED "is" — that is what the field is in the table
     for. "They is ready to come home" is what a typed one produces, and the
     first draft of this line had it: parameterising the pronoun and leaving its
     verb behind is the specific mistake `PRONOUNS` carries `is`, `has` and `s`
     to prevent (state/game.js). Caught by tools/kennelgate.py measuring every
     row against they/them, not by reading it. */
  newReady: (P) => `${cap(P.they)} ${P.is} ready to come home`,
  /* SHORT ON PURPOSE: it shares the line with the 'Bring her home' chip, and
     the long version truncated to "You earn...". The four words that matter
     are the ones that say this is not a purchase. */
  newReadyNote: 'Nothing to pay',
  adopt: (P) => `Bring ${P.them} home`,
  atGate: (at) => `${at} care points`,

  knock: 'Someone is at the door.',
  reveal: (row) => `${(row && row.name) || 'A puppy'}, looking for a home.`,
  /* `Pnew` is the arriving puppy, `Pres` the dog already in the room. Two
     pronouns, because with three breeds the pair can be he/she, she/he or he/he
     and no single string covers them. For the Cockapoo arriving to the Schnoodle
     this resolves to exactly the sentence that shipped before, character for
     character, which is the check that the parameterisation changed nothing.

     THE SHIBA ARRIVING TO THE SCHNOODLE SAYS "He is yours too. He will want to
     meet him." — grammatical, and mildly ambiguous about which `he` is which.
     Substituting the RESIDENT'S NAME was tried and rejected on measurement, not
     taste: this line is `bodyMd` 16 in a 334-unit band and the pronoun version
     is already at about 350, so it shrinks a little as shipped. `ui.naming.maxLen`
     is 14, and "She is yours too. Wolfgangamade will want to meet her." measures
     near 440 — ui/text.js would take the type down to roughly 12 to fit it. A
     four-point shrink on the most important line in the adoption beat is a worse
     trade than one repeated pronoun, and it would only bite on the longest names,
     which is the least predictable kind of layout bug. */
  settle: (Pnew, Pres) => `${cap(Pnew.they)} ${Pnew.is} yours too. ${cap(Pres.they)} will want to meet ${Pnew.them}.`,

  /* THESE TWO WERE ALREADY WRONG, and not because of anything on this pass.
     They were literals with "him" in them, and the moment the Cockapoo was
     adoptable the kennel could show "What looking after him has earned" while a
     female dog was the one in the room. The pronoun sweep balance.js's `gift`
     note defers ("feminine copy is still hardcoded in several strings ... tracked
     separately") never reached this file.
     Fixed here rather than left for that sweep because tools/kennelgate.py now
     asserts that no literal on this surface contains a typed pronoun, and an
     assertion with two grandfathered exceptions in it is not an assertion. Both
     stay inside their slots at they/them — the widest expansion is one character
     longer than "him". */
  earned: (P) => `What looking after ${P.them} has earned`,
  earnedNone: (P) => `Look after ${P.them} and things start turning up here.`,
  locked: (short) => `${short} to go`,
  wear: 'Wear',
  worn: 'On',
  take: 'Off',
  /* the kennel's own cap, in words, because 'Two is plenty' was a literal that
     had to be edited the day the cap moved — and a toast that says the wrong
     number is worse than one that says none */
  full: (n) => `${NUM_WORD[n] || n} is plenty`,
  close: 'Done',
  switched: (name) => `${name || 'Your dog'} is in the room`,
};

/**
 * @param opts { game, reduced, sound, toast, blocked, onSwitch, onAdopted }
 *   `blocked(who)` is scenes/room.js's `surfaceBlockedFor`, never a private
 *   guard (ARCHITECTURE §14.1).
 *   `onSwitch(id)` and `onAdopted(id)` are the room remounting itself: the rig,
 *   the renderer, petting, idle and every care layer are built from
 *   `game.dog` in `enter()`, so a different breed only actually arrives by
 *   going through there. This file does not touch the rig.
 */
export function createKennel(opts = {}) {
  const game = opts.game;
  const reduced = !!opts.reduced;
  const sound = opts.sound || (() => {});
  const toast = opts.toast || (() => {});
  const blocked = opts.blocked || (() => '');
  const onSwitch = opts.onSwitch || (() => {});
  const onAdopted = opts.onAdopted || (() => {});

  const slide = new Spring(0, reduced ? 96 : 132, reduced ? 20 : 16);
  const glow = new Spring(0, reduced ? 40 : 62, reduced ? 16 : 11);
  let open = false;
  let bottomInset = 0;
  let t = 0;
  let flashId = '';
  let flashT = 0;
  /* THE TACTILE PRESS RIDES ON THE FLASH. The cards, the earned rows and the
     chips are pressable objects now (ui/surface.js) and a press needs a clock —
     but this file already had one, and `flashId` already records what she
     touched. Driving the compression off it in update() adds no second input
     path and no second answer to that question; the flash goes on doing exactly
     what it did. */
  const presses = createPresses(reduced);

  /* the adoption beat */
  let beat = '';          // '' | 'knock' | 'reveal' | 'settle'
  let beatT = 0;
  let newDogId = '';
  /* WHO THE BEAT IS ABOUT, captured at the knock and held until it ends.
     It cannot read `adopt.row` while it runs: `adoptDog()` is called at the
     REVEAL and `refresh()` immediately after it, so from that frame on
     `adopt.row` is the NEXT puppy on the ladder — and the reveal line would
     announce the Shiba over a Cockapoo walking out of the glow. With one
     adoptable breed that bug was unreachable (the row simply went null), which
     is exactly the kind of thing a second one exposes. */
  let beatRow = null;
  /* the resident dog's pronoun, also captured at the knock: the settle line
     speaks about both dogs, and by the time it draws, the roster has a second
     one in it. */
  let beatHostPron = null;
  /* the switch beat: a short hold so swapping dogs is a decision landing, not
     a screen blinking */
  let switchTo = '';
  let switchT = 0;

  let roster = [];
  let earned = [];
  let adopt = { ok: false, reason: '', short: 0, at: 0, points: 0, row: null };

  const pad = K.pad;

  function topY() { return H * (1 - clamp(slide.x, 0, 1)); }
  function listTop() { return topY() + K.headH; }
  /* the cap, guarded the same way state/game.js guards it, so the toast and the
     refusal can never disagree about how many dogs are plenty */
  function kennelMax() { return Math.max(1, Math.floor(+EK.max || 2)); }

  function refresh() {
    roster = game.roster();
    adopt = game.adoptCheck();
    const pts = game.carePoints;
    /* the breed rows are NOT in this list: whichever puppy is next has a card of
       their own directly above it, and a milestone listed twice reads as two
       rewards. This filter is also what keeps the Shiba's 1600 row from
       appearing in the earned list as a third bullet the moment he is added —
       one card, one dog, and the ladder's other five rows below it. */
    earned = BALANCE.economy.unlocks.filter((u) => u.kind !== 'breed').map((u) => ({
      ...u,
      got: pts >= u.at,
      short: Math.max(0, u.at - pts),
      /* a wearable that is EARNED can be put on from here. Nothing on this
         surface can be bought, so there is no price to draw next to it. */
      wearable: u.kind === 'wear',
      worn: u.kind === 'wear' && game.worn === u.id,
    }));
  }

  /* ---- layout ------------------------------------------------------ */
  /**
   * HOW TALL A DOG CARD IS, WHICH IS NOT A CONSTANT ANY MORE.
   *
   * It was `K.cardH` — a flat 92 — and that was correct for as long as the
   * kennel held two dogs. At five it is not: 62 of header, five cards at 100
   * apiece, the earned heading, five earned rows at 46, and a Done button 52 up
   * from the bottom comes to 902 units on a screen that is 844 minus a 40-unit
   * safe-area inset. The Done button's own `Math.min` clamp would have hidden
   * that by sliding it up UNDER the last two earned rows, which is the worst
   * possible failure: the panel would look fine and one control would be
   * unreachable behind another.
   *
   * NOTHING IN THIS GAME SCROLLS, and that is a design property rather than an
   * omission — no surface in the tree has a scroll offset, because a child
   * hunting for a row below the fold is a child who does not find it. So the
   * cards give way instead, and they give way ONLY when they have to: the
   * clamp's ceiling is the same 92 the panel has always used, so at one, two,
   * three or four cards every pixel of this surface is where it was. The
   * shrink is reachable at five and nowhere else.
   *
   * Derived from the LIVE inset and the LIVE earned-list length, not from the
   * 844x390 the numbers above were worked out on, so a taller notch or a
   * sixth earned row tightens the cards rather than hiding the button.
   *
   * `K.headH` rather than `listTop()`: the panel slides in from the bottom, and
   * a layout that read the animated top would resize every card on every frame
   * of the open.
   */
  function cardH() {
    const n = Math.max(1, roster.length + (showNewCard() ? 1 : 0));
    /* what the Done button and the earned list need below the cards */
    const below = 16 + 22 + earned.length * K.rowH + 10 + 52;
    const avail = H - bottomInset - K.headH - below;
    const step = Math.floor(avail / n);
    return clamp(step - K.cardGap, K.cardMinH, K.cardH);
  }
  function cardStep() { return cardH() + K.cardGap; }
  function cardRect(i) {
    return { x: pad, y: listTop() + i * cardStep(), w: W - pad * 2, h: cardH() };
  }
  function newCardRect() {
    const i = roster.length;
    return { x: pad, y: listTop() + i * cardStep(), w: W - pad * 2, h: cardH() };
  }
  function adoptChipRect() {
    const r = newCardRect();
    /* 40 up from the bottom of a 92 card; the same PROPORTION of a short one, so
       the chip does not walk off the card as it shrinks */
    return { x: r.x + r.w - 128 - 12, y: r.y + r.h - Math.round(r.h * 0.435), w: 128, h: 30 };
  }
  function cardChipRect(i) {
    const r = cardRect(i);
    return { x: r.x + r.w - 84 - 12, y: r.y + (r.h - 30) / 2, w: 84, h: 30 };
  }
  /**
   * THE THREE TEXT BASELINES ON A CARD, as fractions of its height.
   *
   * 30 / 50 / 68 of 92 is what the surface shipped with, and they are kept as
   * exact fractions of it so a 92-unit card is bit-identical and a 74-unit one
   * compresses evenly instead of having its last line hang off the bottom.
   */
  function cardLines(h) {
    return [h * (30 / 92), h * (50 / 92), h * (68 / 92)];
  }
  function newCardLines(h) {
    return [h * (26 / 92), h * (46 / 92), h * (64 / 92)];
  }
  function earnedTop() {
    const n = roster.length + (showNewCard() ? 1 : 0);
    return listTop() + n * cardStep() + 16;
  }
  function earnedRect(i) {
    return { x: pad, y: earnedTop() + 22 + i * K.rowH, w: W - pad * 2, h: K.rowH - 6 };
  }
  function earnedChipRect(i) {
    const r = earnedRect(i);
    return { x: r.x + r.w - 56 - 10, y: r.y + (r.h - 26) / 2, w: 56, h: 26 };
  }
  function closeRect() {
    const y = earnedTop() + 22 + earned.length * K.rowH + 10;
    return { x: pad, y: Math.min(y, H - 52 - bottomInset), w: W - pad * 2, h: 38 };
  }
  /**
   * THE NEXT PUPPY GETS A CARD UNTIL SHE IS ACTUALLY IN THE ROSTER — and then
   * the one after that takes its place.
   *
   * Both halves of the old test now live in `game.adoptCheck()`: `row` is null
   * once every breed on the ladder is in the kennel, and `reason` is 'full' once
   * the roster is at `economy.kennel.max`. Asking the model rather than
   * re-deriving it here is what stops the card and the tap disagreeing — the two
   * used to answer the question from different data (`EK.adoptBreed` here,
   * `adoptCheck` there), which was survivable only because there was exactly one
   * right answer.
   *
   * EXACTLY ONE CARD, even when she can afford two. Reaching 1600 in one stretch
   * unlocks the Cockapoo AND the Shiba, and stacking both would put four cards
   * on a panel that fits three and turn "the big one, and nothing crowds it"
   * into a shopping list. She takes them in ladder order, one milestone each.
   */
  function showNewCard() {
    return !!adopt.row && adopt.reason !== 'full';
  }
  function hit(r, ev) {
    return ev.x >= r.x && ev.x <= r.x + r.w && ev.y >= r.y && ev.y <= r.y + r.h;
  }

  const kennel = {
    get isOpen() { return open; },
    get modal() { return open; },
    get active() { return open || slide.x > 0.01; },
    /** true while the adoption beat is running: nothing may interrupt it */
    get busy() { return !!beat; },
    get beat() { return beat; },
    COPY,
    setInset(v) { bottomInset = v; },

    start() {
      const why = blocked('kennel');
      if (why) return why;
      open = true;
      refresh();
      slide.to(1);
      sound(K.sfx.open);
      return '';
    },
    stop() {
      if (!open) return;
      if (beat) return;               // never close out from under the beat
      open = false;
      slide.to(0);
      sound(K.sfx.close);
    },
    toggle() { if (open) { kennel.stop(); return ''; } return kennel.start(); },

    update(dt) {
      t += dt;
      slide.step(dt);
      glow.step(dt);
      if (flashT > 0) {
        /* down for the first `PRESS.dur * 1.1`, then released, so the card
           compresses and springs back while the highlight is still fading —
           rather than staying squashed for the whole 0.28s (the same shape
           ui/sheet.js uses for a row that acts on the down event) */
        presses.set(flashId, flashT > K.flash - PRESS.dur * 1.1);
        flashT = Math.max(0, flashT - dt);
        if (flashT === 0) presses.clear();
      }
      presses.update(dt);
      if (open && !beat) refresh();

      /* ---- the switch hold ---- */
      if (switchTo) {
        switchT += dt;
        if (switchT >= EK.switchHold) {
          const id = switchTo;
          switchTo = ''; switchT = 0;
          if (game.switchDog(id)) {
            const d = game.roster().find((x) => x.id === id);
            open = false; slide.set(0);
            onSwitch(id, d);
          }
        }
        return;
      }

      /* ---- the adoption beat ---- */
      if (!beat) return;
      beatT += dt;
      const B = EK.beat;
      if (beat === 'knock' && beatT >= B.hold) {
        beat = 'reveal'; beatT = 0;
        glow.to(1);
        sound(K.sfx.reveal);
        /* SHE IS CREATED HERE, at the reveal, not at the tap: if anything were
           ever to interrupt the beat, a half-finished adoption that had already
           written a dog into the save would be the worst possible outcome. */
        const made = game.adoptDog(Date.now());
        newDogId = made ? made.id : '';
        refresh();
        if (!made) {
          beat = ''; beatT = 0; beatRow = null; beatHostPron = null;
          glow.to(0); toast(COPY.full(kennelMax()));
        }
        return;
      }
      if (beat === 'reveal' && beatT >= B.reveal) {
        beat = 'settle'; beatT = 0;
        sound(K.sfx.settle);
        return;
      }
      if (beat === 'settle' && beatT >= B.settle) {
        beat = ''; beatT = 0;
        beatRow = null; beatHostPron = null;
        glow.to(0);
        const id = newDogId;
        newDogId = '';
        open = false; slide.set(0);
        /* hand her to the room. It rebuilds everything from `game.dog` and,
           because she has no name, opens the naming beat by itself. */
        if (id && game.switchDog(id)) onAdopted(id);
      }
    },

    /** @returns true if the event was consumed */
    pointer(ev) {
      if (!open) return false;
      if (beat || switchTo) return true;        // the beat owns everything
      if (ev.type !== 'down') return true;
      if (ev.y < topY() + 6) { kennel.stop(); return true; }
      if (hit(closeRect(), ev)) { kennel.stop(); return true; }

      for (let i = 0; i < roster.length; i++) {
        if (roster[i].active) continue;
        if (hit(cardRect(i), ev) || hit(cardChipRect(i), ev)) {
          flashId = roster[i].id; flashT = K.flash;
          sound(K.sfx.pick);
          switchTo = roster[i].id; switchT = 0;
          return true;
        }
      }
      if (showNewCard()) {
        /* the whole card is the target, chip included — a milestone should not
           need a precise thumb */
        const r = newCardRect();
        if (hit(r, ev)) {
          flashId = 'new'; flashT = K.flash;
          if (adopt.ok) {
            beat = 'knock'; beatT = 0;
            /* WHO IS AT THE DOOR, PINNED NOW. See the note on `beatRow`: from
               the reveal onward `adopt.row` has moved on to the next puppy. */
            beatRow = adopt.row;
            beatHostPron = game.pron;
            sound(K.sfx.knock);
          } else {
            sound(K.sfx.deny);
            /* the refusal is stated in CARE POINTS. There is no second way. */
            toast(adopt.reason === 'locked' ? COPY.newLocked(adopt.short) : COPY.full(kennelMax()));
          }
          return true;
        }
      }
      for (let i = 0; i < earned.length; i++) {
        const e = earned[i];
        if (!e.wearable || !e.got) continue;
        if (hit(earnedChipRect(i), ev) || hit(earnedRect(i), ev)) {
          flashId = e.id; flashT = K.flash;
          if (game.equipWear(e.worn ? '' : e.id)) { sound(K.sfx.pick); refresh(); }
          else sound(K.sfx.deny);
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

      /* THE BEAT OWNS THE SCREEN ALONE. Drawing the panel underneath it was a
         real defect and an instructive one: `adoptDog()` runs at the REVEAL,
         so the roster refreshes and her card appears — and at 0.80 scrim it
         read straight through, which meant the player met her as a list row a
         second before the beat introduced her. A milestone cannot be spoiled
         by its own bookkeeping. Nothing behind it is drawn at all. */
      if (beat) { drawBeat(g); return; }

      c.save();
      c.fillStyle = SURF.scrim(SCRIM * a);
      c.fillRect(0, 0, W, H);
      c.fillStyle = PANEL;
      roundRect(c, 0, top, W, H - top + 24, 24); c.fill();
      c.strokeStyle = SURF.border(); c.lineWidth = 1.2;
      roundRect(c, 0, top, W, H - top + 24, 24); c.stroke();
      c.fillStyle = SURF.border(0.26);
      roundRect(c, W / 2 - 20, top + 9, 40, 4, 2); c.fill();

      /* HER STANDING — care points, and nothing else, is the only figure on
         this surface. The shop draws a purse; this draws what her care says. */
      const sr = standingRect(g);
      c.fillStyle = PILL;
      roundRect(c, sr.x, sr.y, sr.w, sr.h, sr.h / 2); c.fill();
      /* a small paw mark rather than a coin, so the two currencies never share
         an icon */
      c.fillStyle = '#a8763f';
      c.beginPath(); c.ellipse(sr.x + 15, sr.y + sr.h / 2 + 2, 4.4, 3.4, 0, 0, TAU); c.fill();
      for (let i = -1; i <= 1; i++) {
        c.beginPath(); c.ellipse(sr.x + 15 + i * 4.0, sr.y + sr.h / 2 - 3.4, 1.7, 2.1, i * 0.3, 0, TAU); c.fill();
      }

      /* ---- the dog cards ----
         EVERY CARD, ROW AND CHIP ON THIS SURFACE IS A TACTILE OBJECT NOW: a
         4-unit bottom edge that compresses under the thumb. It matters more here
         than anywhere: this is the surface where she picks up a dog and puts
         another one down, and a card with weight is the same claim the game
         makes about the creature on it. The edge hangs in the gaps the layout
         already left (8 between cards, 6 between earned rows), so nothing moves.

         `*Dy` is kept per index because the type is a SECOND pass below: content
         has to sink WITH its face or the label floats while the card goes down,
         which is the one mistake ui/surface.js returns `dy` to prevent. */
      const cardDy = [];
      let newDy = 0;
      for (let i = 0; i < roster.length; i++) {
        const d = roster[i];
        const r = cardRect(i);
        /* one press per CARD, shared with its chip: the whole card is the hit
           target (chip included), so they compress as one object */
        const p = presses.at(d.id);
        const f = tactile(c, {
          x: r.x, y: r.y, w: r.w, h: r.h, r: R.md, p,
          face: d.active ? CARD_ON : CARD,
        });
        cardDy[i] = f.dy;
        if (d.active) {
          /* THE RING THAT SAYS "THIS ONE IS IN THE ROOM". It was
             `rgba(201,86,63,0.42)` — the collar red, re-typed as an rgba. It is
             not a collar, and ui/tokens.js's rule about the named accents is
             that a colour which only ever means one thing is information: so
             this takes the systematised warm-red accent, `tertiary`, and the
             collar red goes back to meaning a collar. */
          c.strokeStyle = alpha(C.tertiary, 0.42); c.lineWidth = 1.6;
          roundRect(c, r.x, r.y + f.dy, r.w, r.h, R.md); c.stroke();
        }
        portrait(c, r.x + 20 + K.portraitR, r.y + f.dy + r.h / 2, d.breedId, d.worn, flashId === d.id ? flashT / K.flash : 0);
        if (!d.active) {
          const q = cardChipRect(i);
          tactile(c, { x: q.x, y: q.y, w: q.w, h: q.h, r: R.full, p, face: CHIP });
        }
      }

      /* ---- the next puppy's card ---- */
      if (showNewCard()) {
        const r = newCardRect();
        const ready = adopt.ok;
        const p = presses.at('new');
        const f = tactile(c, {
          x: r.x, y: r.y, w: r.w, h: r.h, r: R.md, p,
          face: ready ? CARD : CARD_OFF,
        });
        newDy = f.dy;
        if (ready) {
          /* a warm ring on the one card that is a milestone, so it does not
             read as another row. It was `rgba(233,149,79,0.75)` — the old chip
             orange — and the chip token is a pale peach now, which as a 1.8-unit
             STROKE over a cream card would be a ring nobody can see. A ring
             needs a warm with weight in it, so this is `primaryContainer`. */
          c.strokeStyle = alpha(C.primaryContainer, 0.75); c.lineWidth = 1.8;
          roundRect(c, r.x, r.y + f.dy, r.w, r.h, R.md); c.stroke();
        }
        newPortrait(c, r.x + 20 + K.portraitR, r.y + f.dy + r.h / 2, ready, a);
        const q = adoptChipRect();
        tactile(c, { x: q.x, y: q.y, w: q.w, h: q.h, r: R.full, p, face: ready ? CHIP : CHIP_OFF });
      }

      /* ---- the earned list ---- */
      const earnedDy = [];
      for (let i = 0; i < earned.length; i++) {
        const e = earned[i];
        const r = earnedRect(i);
        const p = presses.at(e.id);
        const f = tactile(c, {
          x: r.x, y: r.y, w: r.w, h: r.h, r: R.md, p,
          face: e.got ? CARD : CARD_OFF,
        });
        earnedDy[i] = f.dy;
        if (e.kind === 'wear') {
          c.save();
          c.globalAlpha = e.got ? 1 : 0.34;
          collarGlyph(c, r.x + 22, r.y + f.dy + r.h / 2, e.id);
          c.restore();
        } else {
          c.save();
          c.globalAlpha = e.got ? 0.9 : 0.30;
          /* the object's own colour when it has one (`swatch`), the category's
             colour when it does not. See the note on `unlocks` in balance.js:
             the wear rows beside these show the real item's colour, so a dot
             here that meant "decor" rather than "blue" read as a wrong swatch
             rather than as a category. Breed rows are filtered out of this list
             above, so only 'decor' and 'stock' ever reach here. */
          c.fillStyle = e.swatch || (e.kind === 'stock' ? '#8a5a2c' : '#7ba36a');
          c.beginPath(); c.arc(r.x + 22, r.y + f.dy + r.h / 2, 6.2, 0, TAU); c.fill();
          c.restore();
        }
        if (e.wearable && e.got) {
          const q = earnedChipRect(i);
          tactile(c, { x: q.x, y: q.y, w: q.w, h: q.h, r: R.full, p, face: e.worn ? CHIP_OFF : CHIP });
        }
      }

      const cl = closeRect();
      /* Done is tactile too. Nothing can be SEEN pressing it — the panel closes
         on the same down event — but the bottom edge is what makes it a button
         rather than a cream band, which is ui/sheet.js's argument for its rows. */
      tactile(c, { x: cl.x, y: cl.y, w: cl.w, h: cl.h, r: R.full, p: 0, face: PILL });
      c.restore();

      /* ================= type ================= */
      drawText(g, COPY.title, {
        ...type('titleMd', { weight: 800 }),
        x: pad + 2, y: top + 36, anchor: 'free', align: 'left',
        ink: INK.heading, over: PANEL, fade: a,
        /* derived from the pill rather than a hardcoded 150, so the two can
           never both think they own the same strip of header */
        maxWidth: standingRect(g).x - pad - 10,
      });
      drawText(g, COPY.standing(game.describeCare(), game.carePoints), {
        ...type('labelSm', { weight: 800 }),
        x: sr.x + sr.w - 12, y: sr.y + sr.h / 2, anchor: 'free', align: 'right',
        ink: INK.body, over: PILL, fade: a,
        maxWidth: sr.w - 32,
      });

      for (let i = 0; i < roster.length; i++) {
        const d = roster[i];
        const r = cardRect(i);
        const bg = d.active ? CARD_ON : CARD;
        const lx = r.x + 20 + K.portraitR * 2 + 16;
        const lw = r.w - (lx - r.x) - (d.active ? 78 : 104);
        /* the sink of the face this type sits on — the card and its chip share
           one press, so one offset serves the whole card */
        const dy = cardDy[i] || 0;
        drawText(g, d.name || COPY.unnamed, {
          ...type('labelMd', { weight: 800 }),
          x: lx, y: r.y + dy + 30, anchor: 'free', align: 'left',
          ink: INK.body, over: bg, fade: a, maxWidth: lw,
        });
        drawText(g, breedName(d.breedId), {
          ...type('labelSm', { weight: 600, track: 0 }),
          x: lx, y: r.y + dy + 50, anchor: 'free', align: 'left',
          ink: INK.soft(0.76), over: bg, fade: a, maxWidth: lw,
        });
        drawText(g, d.worn ? COPY.wearing(wornName(d.worn)) : COPY.wearNothing, {
          ...type('labelSm', { weight: 500, track: 0 }),
          x: lx, y: r.y + dy + 68, anchor: 'free', align: 'left',
          ink: INK.soft(0.66), over: bg, fade: a, maxWidth: lw,
        });
        if (d.active) {
          drawText(g, COPY.here, {
            ...type('labelSm', { weight: 800 }),
            x: r.x + r.w - 14, y: r.y + dy + r.h / 2, anchor: 'free', align: 'right',
            ink: INK.soft(0.62), over: bg, fade: a, maxWidth: 70,
          });
        } else {
          const q = cardChipRect(i);
          drawText(g, COPY.bring, {
            ...type('labelSm', { weight: 800 }),
            x: q.x + q.w / 2, y: q.y + dy + q.h / 2, anchor: 'free', align: 'center',
            ink: INK.onStrong, over: CHIP, fade: a, maxWidth: q.w - 8,
          });
        }
      }

      if (showNewCard()) {
        const r = newCardRect();
        const ready = adopt.ok;
        const bg = ready ? CARD : CARD_OFF;
        const lx = r.x + 20 + K.portraitR * 2 + 16;
        const lw = r.w - (lx - r.x) - 20;
        const dy = newDy;
        /* the OFFERED puppy's pronoun. `adopt.row.pron` is resolved in
           state/game.js from the ladder row's `sex`, the same way a roster
           entry's is resolved from the dog's — a puppy who does not exist yet
           still has to be spoken about correctly. */
        const NP = (adopt.row && adopt.row.pron) || game.pron;
        drawText(g, COPY.newTitle(adopt.row), {
          ...type('labelMd', { weight: 800 }),
          x: lx, y: r.y + dy + 26, anchor: 'free', align: 'left',
          ink: INK.body, over: bg, fade: a, maxWidth: lw,
        });
        /* the GOAL, stated as a number she is saving toward — care points are a
           currency she can see; what they say about her is the word above.
           `#8a4b22` for the ready state was `primary` typed from memory. */
        drawText(g, ready ? COPY.newReady(NP) : `${game.carePoints} / ${adopt.at} care points`, {
          ...type('labelSm', { weight: 700, track: 0 }),
          x: lx, y: r.y + dy + 46, anchor: 'free', align: 'left',
          ink: ready ? INK.heading : INK.body, over: bg, fade: a, maxWidth: lw,
        });
        drawText(g, ready ? COPY.newReadyNote : COPY.newLockedNote(game.pron), {
          ...type('labelSm', { weight: 500, track: 0 }),
          x: lx, y: r.y + dy + 64, anchor: 'free', align: 'left',
          ink: INK.soft(0.72), over: bg, fade: a,
          maxWidth: lw - 130,
        });
        const q = adoptChipRect();
        drawText(g, ready ? COPY.adopt(NP) : COPY.lockedChip(adopt.short), {
          ...type('labelSm', { weight: 800 }),
          x: q.x + q.w / 2, y: q.y + dy + q.h / 2, anchor: 'free', align: 'center',
          ink: ready ? INK.onStrong : INK.body, over: ready ? CHIP : CHIP_OFF,
          fade: a, maxWidth: q.w - 8,
        });
      }

      /* the dog IN THE ROOM, whoever that is — care points come from looking
         after him, or her, or them */
      drawText(g, COPY.earned(game.pron), {
        ...type('labelSm', { weight: 800, track: 0 }),
        x: pad + 4, y: earnedTop() + 4, anchor: 'free', align: 'left',
        ink: INK.soft(0.80), over: PANEL, fade: a,
        maxWidth: W - pad * 2 - 8,
      });
      for (let i = 0; i < earned.length; i++) {
        const e = earned[i];
        const r = earnedRect(i);
        const bg = e.got ? CARD : CARD_OFF;
        const rightW = (e.wearable && e.got) ? 76 : 62;
        const dy = earnedDy[i] || 0;
        /* a milestone she has not reached is the SAME greyed-out state the shop
           draws on a row coins cannot reach: 0.62 and 0.58 of one brown were
           never meant to be two colours. */
        drawText(g, e.name, {
          ...type('labelSm', { weight: 700 }),
          x: r.x + 40, y: r.y + dy + r.h / 2 - 7, anchor: 'free', align: 'left',
          ink: e.got ? INK.body : INK.faint(), over: bg, fade: a,
          maxWidth: r.w - 40 - rightW,
        });
        drawText(g, e.note || '', {
          ...type('labelSm', { weight: 500, track: 0 }),
          x: r.x + 40, y: r.y + dy + r.h / 2 + 8, anchor: 'free', align: 'left',
          ink: INK.soft(0.60), over: bg, fade: a,
          maxWidth: r.w - 40 - rightW,
        });
        if (e.wearable && e.got) {
          const q = earnedChipRect(i);
          drawText(g, e.worn ? COPY.take : COPY.wear, {
            ...type('labelSm', { weight: 800 }),
            x: q.x + q.w / 2, y: q.y + dy + q.h / 2, anchor: 'free', align: 'center',
            ink: e.worn ? INK.body : INK.onStrong,
            over: e.worn ? CHIP_OFF : CHIP, fade: a, maxWidth: q.w - 6,
          });
        } else if (!e.got) {
          drawText(g, COPY.locked(e.short), {
            ...type('labelSm', { weight: 700 }),
            x: r.x + r.w - 12, y: r.y + dy + r.h / 2, anchor: 'free', align: 'right',
            ink: INK.faint(), over: bg, fade: a,
            maxWidth: 58,
          });
        }
      }

      /* the same button as the shop's Done, which was 13/800 there and 12.5/800
         here — one control, two spellings, which is what the ramp is for */
      drawText(g, COPY.close, {
        ...type('labelMd', { weight: 800 }),
        x: cl.x + cl.w / 2, y: cl.y + cl.h / 2, anchor: 'free', align: 'center',
        ink: INK.body, over: PILL, fade: a,
        maxWidth: cl.w - 10,
      });
    },

    /**
     * MEASURE EVERY LINE THE ADOPTION CARD AND THE BEAT WILL DRAW, in the slot it
     * will draw it in, and report whether ui/text.js had to shrink or cut it.
     *
     * The same shape `ui/howto.js audit()` returns, and here for the same reason
     * — except that this file is where the lesson was learned. A note measured at
     * 334 units was drawn into a 116-unit slot and shipped as **"She goes to
     * someone wh…"**: nothing was clipped, no contrast check failed, and no gate
     * existed that could have failed. Only cropping in on a render caught it.
     *
     * It exists NOW because the copy stopped being literals. Every line on the
     * card is a function of a ladder row and a pronoun table, so "it fits" is no
     * longer a property of six strings somebody once looked at — it has to hold
     * for every row on the ladder crossed with he/she/they, and the widest of
     * those combinations is not obvious by eye. `tools/kennelgate.py` walks them.
     *
     * `row` and `pron` are ARGUMENTS rather than live state, so a probe can ask
     * about the Shiba's card without the save having to reach 1600 first.
     */
    audit(g, row = adopt.row, pron = null, host = null) {
      if (!g) return null;
      const P = pron || (row && row.pron) || game.pron;
      const HP = host || game.pron;
      const r = newCardRect();
      const lx = r.x + 20 + K.portraitR * 2 + 16;
      const lw = r.w - (lx - r.x) - 20;
      const q = adoptChipRect();
      const rows = [];
      const take = (slot, text, o, want) => {
        const m = measure(g, text, o);
        rows.push({
          slot, text, got: m.str, size: +m.size.toFixed(2), want,
          cut: m.str !== text, shrunk: m.size < want - 0.01,
        });
      };
      const tMd = type('labelMd', { weight: 800 });
      const tSm = type('labelSm', { weight: 700, track: 0 });
      const tSmL = type('labelSm', { weight: 500, track: 0 });
      const tChip = type('labelSm', { weight: 800 });
      const tBody = type('bodyMd', { weight: 700 });
      take('title', COPY.newTitle(row),
        { ...tMd, x: lx, y: 0, align: 'left', maxWidth: lw }, tMd.size);
      take('ready', COPY.newReady(P),
        { ...tSm, x: lx, y: 0, align: 'left', maxWidth: lw }, tSm.size);
      take('goal', `${game.carePoints} / ${row ? row.at : 0} care points`,
        { ...tSm, x: lx, y: 0, align: 'left', maxWidth: lw }, tSm.size);
      /* THE 116-UNIT SLOT. `lw - 130` is the line the note shares with the
         '320 more care points' chip, and it is the one that shipped cut. */
      take('lockedNote', COPY.newLockedNote(HP),
        { ...tSmL, x: lx, y: 0, align: 'left', maxWidth: lw - 130 }, tSmL.size);
      take('readyNote', COPY.newReadyNote,
        { ...tSmL, x: lx, y: 0, align: 'left', maxWidth: lw - 130 }, tSmL.size);
      take('chip', COPY.adopt(P),
        { ...tChip, x: 0, y: 0, align: 'center', maxWidth: q.w - 8 }, tChip.size);
      take('chipLocked', COPY.lockedChip(row ? Math.max(0, row.at - game.carePoints) : 0),
        { ...tChip, x: 0, y: 0, align: 'center', maxWidth: q.w - 8 }, tChip.size);
      /* the two beat lines, in the beat's own band */
      take('knock', COPY.knock,
        { ...tBody, x: W / 2, y: 0, align: 'center', maxWidth: W - 56 }, tBody.size);
      take('reveal', COPY.reveal(row),
        { ...tBody, x: W / 2, y: 0, align: 'center', maxWidth: W - 56 }, tBody.size);
      take('settle', COPY.settle(P, HP),
        { ...tBody, x: W / 2, y: 0, align: 'center', maxWidth: W - 56 }, tBody.size);
      /* the earned-list heading, which is about the RESIDENT and was a literal
         with "him" in it until this pass */
      take('earnedHead', COPY.earned(HP),
        { ...type('labelSm', { weight: 800, track: 0 }), x: pad + 4, y: 0,
          align: 'left', maxWidth: W - pad * 2 - 8 }, tSm.size);
      take('earnedNone', COPY.earnedNone(HP),
        { ...type('labelSm', { weight: 500, track: 0 }), x: pad + 4, y: 0,
          align: 'left', maxWidth: W - pad * 2 - 8 }, tSm.size);
      return { row: row ? row.breedId : '', card: r, chip: q, rows };
    },

    get debug() {
      return {
        open, weight: +slide.x.toFixed(3), beat, beatT: +beatT.toFixed(2),
        switchTo, carePoints: game.carePoints,
        /* THE ASSERTION THIS SURFACE EXISTS TO PASS: it knows what coins are
           and it never uses them. A test reads this and the shop's `carePoints`
           to show that neither surface's DECISIONS depend on the other's
           currency. */
        coinsSeen: game.coins,
        adopt: { ...adopt },
        /* WHO THE CARD IS OFFERING, and who the running beat is about. Two
           separate answers on purpose: they differ for the whole reveal and
           settle, and a gate that could only see one of them could not catch the
           reveal announcing the wrong puppy. */
        offering: adopt.row ? adopt.row.breedId : '',
        beatBreed: beatRow ? beatRow.breedId : '',
        max: kennelMax(),
        /* THE CARD GEOMETRY, because it is no longer a constant a caller can read
           off BALANCE. `K.cardH` is a ceiling now (see `cardH()`), so anything
           that computes where to tap has to ask the surface rather than the
           table — tools/kennelgate.py tapped `K.cardH * i` and would have started
           missing the moment a fifth dog shrank the rows. */
        cardH: cardH(), cardStep: cardStep(), listTop: K.headH,
        roster: roster.map((d) => ({ id: d.id, name: d.name, breedId: d.breedId, sex: d.sex, active: d.active, worn: d.worn })),
        earned: earned.map((e) => ({ id: e.id, at: e.at, got: e.got, short: e.short, worn: !!e.worn })),
        showNew: showNewCard(),
      };
    },
  };

  /**
   * THE STANDING PILL SIZES TO ITS CONTENT.
   *
   * It was a fixed 148 wide. On the type ramp the label went 10.5 -> 12, and
   * `Getting to know each other · 20` stopped fitting — ui/text.js did exactly
   * what it promises and ellipsised rather than overflowing, but what it had to
   * drop was the END of the string, which is THE CARE-POINTS NUMBER. That is
   * the only number this surface is allowed to show (§15.6: no prices in the
   * kennel), so truncating it is the one thing the pill must not do.
   *
   * Widening is the honest fix rather than shrinking the type back: the longest
   * standing word is "Getting to know each other", and a pill sized for it is
   * a pill that fits every shorter one too. Clamped so it can never crowd the
   * title, which now takes its own maxWidth from this rect.
   */
  function standingRect(g) {
    const w0 = 148;
    if (!g) return { x: W - pad - w0, y: topY() + 22, w: w0, h: 28 };
    const m = measure(g, COPY.standing(game.describeCare(), game.carePoints),
      { ...type('labelSm', { weight: 800 }), x: 0, y: 0 });
    const w = clamp(m.w + 34, w0, W - pad * 2 - 104);
    return { x: W - pad - w, y: topY() + 22, w, h: 28 };
  }

  function breedName(id) {
    const b = BREEDS[id];
    if (b && b.name) return b.name;
    /* A BREED ROW CAN LAND BEFORE ITS ART. `getBreed` falls back to the Shiba
       for an id it does not have yet, which is the breed seam working as
       ARCHITECTURE §11.3 intends — a new breed is a DATA entry, and this
       surface needs no change when it lands. Until then the name comes from
       the unlocks table so the card never claims to be a Shiba.
       All three breeds on the ladder now have art, so neither fallback is
       reachable in the shipping game; they stay because the ladder is data and
       the next row added to it may again arrive first. */
    const u = BALANCE.economy.unlocks.find((x) => x.kind === 'breed'
      && (x.breedId || x.id) === id);
    if (u) return u.name;
    return cap(String(id || ''));
  }
  function wornName(id) {
    const u = BALANCE.economy.unlocks.find((x) => x.id === id);
    if (u) return u.name;
    const it = game.shopItem(id);
    return it ? it.name : 'a collar';
  }

  /** a soft portrait: the breed's own coat colour, its ears, and its collar */
  function portrait(c, x, y, breedId, worn, flash) {
    const b = getBreed(breedId);
    const p = b.palette || {};
    const r = K.portraitR;
    c.save();
    c.translate(x, y);
    /* the soft ring the portrait sits in is CHROME — a hairline, not a coat.
       Everything below it, from the cream down, is the breed's own palette with
       a fallback, and deliberately stays a literal: tokenising a coat would make
       every dog beige. */
    c.fillStyle = SURF.border(0.10);
    c.beginPath(); c.arc(0, 2, r + 2, 0, TAU); c.fill();
    c.fillStyle = p.cream || '#f6e7cf';
    c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill();
    /* ears, then head — enough of a silhouette to tell two dogs apart without
       this file knowing anything about how either of them is drawn */
    c.fillStyle = p.coatShade || p.coat || '#c98a4b';
    for (const sd of [-1, 1]) {
      c.beginPath();
      c.ellipse(sd * r * 0.60, -r * 0.46, r * 0.30, r * 0.42, sd * 0.42, 0, TAU);
      c.fill();
    }
    c.fillStyle = p.coat || '#d99a55';
    c.beginPath(); c.ellipse(0, r * 0.04, r * 0.70, r * 0.64, 0, 0, TAU); c.fill();
    c.fillStyle = p.cream || '#f6e7cf';
    c.beginPath(); c.ellipse(0, r * 0.30, r * 0.36, r * 0.26, 0, 0, TAU); c.fill();
    c.fillStyle = p.nose || '#3a2418';
    c.beginPath(); c.ellipse(0, r * 0.22, r * 0.11, r * 0.085, 0, 0, TAU); c.fill();
    c.fillStyle = p.eye || '#33221a';
    for (const sd of [-1, 1]) {
      c.beginPath(); c.ellipse(sd * r * 0.26, -r * 0.06, r * 0.075, r * 0.095, 0, 0, TAU); c.fill();
    }
    if (worn) {
      /* the fallback was `#c9563f`, which is `BALANCE.ui.wear.collarRed` typed
         out again — and a collar in the portrait that did not match the collar on
         the dog is exactly the small lie balance.js's note warns about */
      c.strokeStyle = WEAR_COLOUR[worn] || WEAR_COLOUR.collarRed;
      c.lineWidth = r * 0.15; c.lineCap = 'round';
      c.beginPath(); c.arc(0, r * 0.30, r * 0.56, Math.PI * 0.22, Math.PI * 0.78); c.stroke();
    }
    if (flash > 0) {
      c.globalAlpha = flash * 0.5;
      c.fillStyle = FLASH;
      c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill();
    }
    c.restore();
  }

  /** the not-yet-adopted card's portrait: a shape behind a door, until she is */
  function newPortrait(c, x, y, ready, a, scale) {
    const r = K.portraitR * (scale || 1);
    c.save();
    c.translate(x, y);
    /* the MEDALLION is chrome — the same ring and disc the dog portraits sit in,
       warmed when she is ready and dimmed when she is not, so it matches the card
       around it in both states. Only the silhouette below is art. */
    c.fillStyle = ready ? alpha(SURF.chipWarm, 0.22) : SURF.border(0.10);
    c.beginPath(); c.arc(0, 2, r + 2, 0, TAU); c.fill();
    c.fillStyle = ready ? C.surfaceHighest : SURF.rowOff;
    c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill();
    /* a puppy shape, no breed detail: the art is not hers yet and a portrait
       that guessed would be a promise this file cannot keep.
       ONE alpha for the whole silhouette, not per shape — three translucent
       ellipses overlapping made the ears read as darker patches ON the head
       rather than behind it, which at reveal size looked like a mistake. */
    c.save();
    c.globalAlpha = ready ? 0.62 : 0.30;
    c.fillStyle = '#8a4b22';
    c.beginPath();
    for (const sd of [-1, 1]) {
      c.ellipse(sd * r * 0.56, -r * 0.34, r * 0.26, r * 0.44, sd * 0.52, 0, TAU);
    }
    c.ellipse(0, r * 0.06, r * 0.62, r * 0.58, 0, 0, TAU);
    c.fill();
    c.restore();
    if (!ready) {
      /* a small keyhole rather than a padlock: a padlock says "pay"; a door
         says "not yet" */
      c.fillStyle = INK.soft(0.42);
      c.beginPath(); c.arc(0, r * 0.02, r * 0.15, 0, TAU); c.fill();
      c.beginPath(); c.moveTo(-r * 0.07, r * 0.06); c.lineTo(r * 0.07, r * 0.06);
      c.lineTo(r * 0.04, r * 0.34); c.lineTo(-r * 0.04, r * 0.34); c.closePath(); c.fill();
    }
    c.restore();
  }

  /** THE MILESTONE. Deliberately almost nothing on screen: a warm glow, one
      line at a time, and no controls at all — there is nothing to decide. */
  function drawBeat(g) {
    const c = g.ctx;
    const B = EK.beat;
    let u = 0, line = '';
    /* BOTH LINES COME FROM THE CAPTURED ROW, never from `adopt` — which by now
       describes whoever is next after this one. `game.pron` is the fallback for
       the host only if the knock somehow ran without capturing it. */
    const NP = (beatRow && beatRow.pron) || game.pron;
    const HP = beatHostPron || game.pron;
    if (beat === 'knock') { u = clamp(beatT / Math.max(0.001, B.hold), 0, 1); line = COPY.knock; }
    else if (beat === 'reveal') { u = clamp(beatT / Math.max(0.001, B.reveal), 0, 1); line = COPY.reveal(beatRow); }
    else { u = clamp(beatT / Math.max(0.001, B.settle), 0, 1); line = COPY.settle(NP, HP); }
    /* fade in fast, hold, fade out at the very end of the last beat */
    const fade = beat === 'settle'
      ? clamp(Math.min(u / 0.12, (1 - u) / 0.18), 0, 1)
      : clamp(Math.min(u / 0.16, 1), 0, 1);

    c.save();
    /* near-opaque: the panel is not drawn behind this, but the ROOM is. Same
       scrim token as the panel's backdrop, at a much higher alpha — it was a
       third brown (`rgba(38,20,10,…)`) for the same job. */
    c.fillStyle = SURF.scrim(0.93 * clamp(beat === 'knock' ? u * 2.2 : 1, 0, 1));
    c.fillRect(0, 0, W, H);
    /* the glow she comes out of. On this rig warmth and scale do the work that
       a drawn door would need art for. */
    const gl = glow.x;
    if (gl > 0.01) {
      const cy = H * 0.42;
      const rr = lerp(40, 210, smooth(gl));
      const rad = c.createRadialGradient(W / 2, cy, 4, W / 2, cy, rr);
      rad.addColorStop(0, `rgba(255,232,190,${(0.80 * gl).toFixed(3)})`);
      rad.addColorStop(0.55, `rgba(240,186,120,${(0.30 * gl).toFixed(3)})`);
      rad.addColorStop(1, 'rgba(240,186,120,0)');
      c.fillStyle = rad;
      c.beginPath(); c.arc(W / 2, cy, rr, 0, TAU); c.fill();
      /* she arrives at SIZE. The first pass drew her at the same 30px radius
         the list rows use, which made the milestone look like a row that had
         floated into the middle of the screen. */
      newPortrait(c, W / 2, cy, true, 1, lerp(1.4, 2.7, smooth(gl)));
    }
    c.restore();

    drawText(g, line, {
      ...type('bodyMd', { weight: 700 }),
      x: W / 2, y: H * 0.66, anchor: 'free', align: 'center',
      ink: INK.onDark, plate: 'auto',
      fade, maxWidth: W - 56,
    });
  }

  return kennel;
}

export default createKennel;
