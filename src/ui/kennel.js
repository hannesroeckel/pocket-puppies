/* ==========================================================================
   ui/kennel.js — the kennel. CARE POINTS ONLY, AND NOT ONE PRICE.

   Two jobs:
     1. show her dogs and let her swap which one is in the room;
     2. be the place the Cockapoo is adopted — for 400 CARE POINTS and for
        nothing else. There is no coin figure anywhere on this surface, no
        "or pay", and no code path that reads `game.coins`. The shop is the
        surface with a purse on it; this is the surface with her standing on
        it. One currency each is how the rule gets taught without a lecture.

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

   Copy is pronoun-parameterised per dog from `game.pron` and from each
   roster entry's own `pron`: the gift puppy is a male Schnoodle and the
   Cockapoo is female, so this surface has both on screen at once and cannot
   use a single pronoun for "the dog".

   Text goes through ui/text.js. There is not one `fillText` in this file.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { clamp, roundRect, TAU, smooth, lerp } from '../engine/draw.js';
import { Spring } from '../engine/spring.js';
import { drawText } from './text.js';
import { getBreed, BREEDS } from '../dog/breeds.js';
import { collarGlyph, WEAR_COLOUR } from './shop.js';

const W = BALANCE.view.W;
const H = BALANCE.view.H;
const K = BALANCE.ui.kennel;
const EK = BALANCE.economy.kennel;

const SCRIM = 0.52;
const PANEL = '#fdf3df';
const CARD = '#f7e7cd';
const CARD_ON = '#f6dfb4';
const CARD_OFF = '#efe3d2';
const CHIP = '#e9954f';
const CHIP_OFF = '#d8c8b2';

const cap = (w) => (w ? w[0].toUpperCase() + w.slice(1) : w);

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

  newTitle: 'A Cockapoo puppy',
  newLocked: (short) => `${short} more care points`,
  newLockedNote: 'She goes to someone who is already looking after a dog well.',
  newReady: 'She is ready to come home',
  /* SHORT ON PURPOSE: it shares the line with the 'Bring her home' chip, and
     the long version truncated to "You earn...". The four words that matter
     are the ones that say this is not a purchase. */
  newReadyNote: 'Nothing to pay.',
  adopt: 'Bring her home',
  atGate: (at) => `${at} care points`,

  knock: 'Someone is at the door.',
  reveal: 'A Cockapoo puppy, looking for a home.',
  settle: (P) => `She is yours too. ${cap(P.they)} will want to meet her.`,

  earned: 'What looking after him has earned',
  earnedNone: 'Look after him and things start turning up here.',
  locked: (short) => `${short} to go`,
  wear: 'Wear',
  worn: 'On',
  take: 'Off',
  full: 'Two is plenty',
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

  /* the adoption beat */
  let beat = '';          // '' | 'knock' | 'reveal' | 'settle'
  let beatT = 0;
  let newDogId = '';
  /* the switch beat: a short hold so swapping dogs is a decision landing, not
     a screen blinking */
  let switchTo = '';
  let switchT = 0;

  let roster = [];
  let earned = [];
  let adopt = { ok: false, reason: '', short: 0, at: 0, points: 0 };

  const pad = K.pad;

  function topY() { return H * (1 - clamp(slide.x, 0, 1)); }
  function listTop() { return topY() + K.headH; }

  function refresh() {
    roster = game.roster();
    adopt = game.adoptCheck();
    const pts = game.carePoints;
    /* the breed rows are NOT in this list: the Cockapoo has a card of her own
       directly above it, and a milestone listed twice reads as two rewards */
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
  function cardRect(i) {
    return { x: pad, y: listTop() + i * (K.cardH + K.cardGap), w: W - pad * 2, h: K.cardH };
  }
  function newCardRect() {
    const i = roster.length;
    return { x: pad, y: listTop() + i * (K.cardH + K.cardGap), w: W - pad * 2, h: K.cardH };
  }
  function adoptChipRect() {
    const r = newCardRect();
    return { x: r.x + r.w - 128 - 12, y: r.y + r.h - 40, w: 128, h: 30 };
  }
  function cardChipRect(i) {
    const r = cardRect(i);
    return { x: r.x + r.w - 84 - 12, y: r.y + (r.h - 30) / 2, w: 84, h: 30 };
  }
  function earnedTop() {
    const n = roster.length + (showNewCard() ? 1 : 0);
    return listTop() + n * (K.cardH + K.cardGap) + 16;
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
  /** the Cockapoo gets a card until she is actually in the roster */
  function showNewCard() {
    return roster.length < Math.max(1, Math.floor(EK.max))
      && !roster.some((d) => d.breedId === EK.adoptBreed);
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
      if (flashT > 0) flashT = Math.max(0, flashT - dt);
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
        if (!made) { beat = ''; beatT = 0; glow.to(0); toast(COPY.full); }
        return;
      }
      if (beat === 'reveal' && beatT >= B.reveal) {
        beat = 'settle'; beatT = 0;
        sound(K.sfx.settle);
        return;
      }
      if (beat === 'settle' && beatT >= B.settle) {
        beat = ''; beatT = 0;
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
            sound(K.sfx.knock);
          } else {
            sound(K.sfx.deny);
            /* the refusal is stated in CARE POINTS. There is no second way. */
            toast(adopt.reason === 'locked' ? COPY.newLocked(adopt.short) : COPY.full);
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
      c.fillStyle = `rgba(44,22,10,${(SCRIM * a).toFixed(3)})`;
      c.fillRect(0, 0, W, H);
      c.fillStyle = PANEL;
      roundRect(c, 0, top, W, H - top + 24, 24); c.fill();
      c.strokeStyle = 'rgba(124,74,47,0.18)'; c.lineWidth = 1.2;
      roundRect(c, 0, top, W, H - top + 24, 24); c.stroke();
      c.fillStyle = 'rgba(124,74,47,0.26)';
      roundRect(c, W / 2 - 20, top + 9, 40, 4, 2); c.fill();

      /* HER STANDING — care points, and nothing else, is the only figure on
         this surface. The shop draws a purse; this draws what her care says. */
      const sr = standingRect();
      c.fillStyle = '#eee2c8';
      roundRect(c, sr.x, sr.y, sr.w, sr.h, sr.h / 2); c.fill();
      /* a small paw mark rather than a coin, so the two currencies never share
         an icon */
      c.fillStyle = '#a8763f';
      c.beginPath(); c.ellipse(sr.x + 15, sr.y + sr.h / 2 + 2, 4.4, 3.4, 0, 0, TAU); c.fill();
      for (let i = -1; i <= 1; i++) {
        c.beginPath(); c.ellipse(sr.x + 15 + i * 4.0, sr.y + sr.h / 2 - 3.4, 1.7, 2.1, i * 0.3, 0, TAU); c.fill();
      }

      /* ---- the dog cards ---- */
      for (let i = 0; i < roster.length; i++) {
        const d = roster[i];
        const r = cardRect(i);
        c.fillStyle = d.active ? CARD_ON : CARD;
        roundRect(c, r.x, r.y, r.w, r.h, 15); c.fill();
        if (d.active) {
          c.strokeStyle = 'rgba(201,86,63,0.42)'; c.lineWidth = 1.6;
          roundRect(c, r.x, r.y, r.w, r.h, 15); c.stroke();
        }
        portrait(c, r.x + 20 + K.portraitR, r.y + r.h / 2, d.breedId, d.worn, flashId === d.id ? flashT / K.flash : 0);
        if (!d.active) {
          const q = cardChipRect(i);
          c.fillStyle = CHIP;
          roundRect(c, q.x, q.y, q.w, q.h, q.h / 2); c.fill();
        }
      }

      /* ---- the Cockapoo card ---- */
      if (showNewCard()) {
        const r = newCardRect();
        const ready = adopt.ok;
        c.fillStyle = ready ? CARD : CARD_OFF;
        roundRect(c, r.x, r.y, r.w, r.h, 15); c.fill();
        if (ready) {
          /* a warm ring on the one card that is a milestone, so it does not
             read as another row */
          c.strokeStyle = 'rgba(233,149,79,0.75)'; c.lineWidth = 1.8;
          roundRect(c, r.x, r.y, r.w, r.h, 15); c.stroke();
        }
        newPortrait(c, r.x + 20 + K.portraitR, r.y + r.h / 2, ready, a);
        const q = adoptChipRect();
        c.fillStyle = ready ? CHIP : CHIP_OFF;
        roundRect(c, q.x, q.y, q.w, q.h, q.h / 2); c.fill();
      }

      /* ---- the earned list ---- */
      for (let i = 0; i < earned.length; i++) {
        const e = earned[i];
        const r = earnedRect(i);
        c.fillStyle = e.got ? CARD : CARD_OFF;
        roundRect(c, r.x, r.y, r.w, r.h, 11); c.fill();
        if (e.kind === 'wear') {
          c.save();
          c.globalAlpha = e.got ? 1 : 0.34;
          collarGlyph(c, r.x + 22, r.y + r.h / 2, e.id);
          c.restore();
        } else {
          c.save();
          c.globalAlpha = e.got ? 0.9 : 0.30;
          c.fillStyle = e.kind === 'breed' ? '#c9563f' : (e.kind === 'stock' ? '#8a5a2c' : '#7ba36a');
          c.beginPath(); c.arc(r.x + 22, r.y + r.h / 2, 6.2, 0, TAU); c.fill();
          c.restore();
        }
        if (e.wearable && e.got) {
          const q = earnedChipRect(i);
          c.fillStyle = e.worn ? CHIP_OFF : CHIP;
          roundRect(c, q.x, q.y, q.w, q.h, q.h / 2); c.fill();
        }
      }

      const cl = closeRect();
      c.fillStyle = '#f0dfc2';
      roundRect(c, cl.x, cl.y, cl.w, cl.h, cl.h / 2); c.fill();
      c.restore();

      /* ================= type ================= */
      drawText(g, COPY.title, {
        x: pad + 2, y: top + 36, anchor: 'free', align: 'left',
        size: 17, weight: 800, ink: '#5d3018', over: PANEL, fade: a,
        maxWidth: W - pad * 2 - 150,
      });
      drawText(g, COPY.standing(game.describeCare(), game.carePoints), {
        x: sr.x + sr.w - 12, y: sr.y + sr.h / 2, anchor: 'free', align: 'right',
        size: 11.5, weight: 800, ink: '#5d3018', over: '#eee2c8', fade: a,
        maxWidth: sr.w - 32,
      });

      for (let i = 0; i < roster.length; i++) {
        const d = roster[i];
        const r = cardRect(i);
        const bg = d.active ? CARD_ON : CARD;
        const lx = r.x + 20 + K.portraitR * 2 + 16;
        const lw = r.w - (lx - r.x) - (d.active ? 78 : 104);
        drawText(g, d.name || COPY.unnamed, {
          x: lx, y: r.y + 30, anchor: 'free', align: 'left',
          size: 15, weight: 800, ink: '#5d3018', over: bg, fade: a, maxWidth: lw,
        });
        drawText(g, breedName(d.breedId), {
          x: lx, y: r.y + 50, anchor: 'free', align: 'left',
          size: 11, weight: 600, ink: 'rgba(93,48,24,0.76)', over: bg, fade: a, maxWidth: lw,
        });
        drawText(g, d.worn ? COPY.wearing(wornName(d.worn)) : COPY.wearNothing, {
          x: lx, y: r.y + 68, anchor: 'free', align: 'left',
          size: 10.5, weight: 500, ink: 'rgba(93,48,24,0.66)', over: bg, fade: a, maxWidth: lw,
        });
        if (d.active) {
          drawText(g, COPY.here, {
            x: r.x + r.w - 14, y: r.y + r.h / 2, anchor: 'free', align: 'right',
            size: 10.5, weight: 800, ink: 'rgba(93,48,24,0.62)', over: bg, fade: a, maxWidth: 70,
          });
        } else {
          const q = cardChipRect(i);
          drawText(g, COPY.bring, {
            x: q.x + q.w / 2, y: q.y + q.h / 2, anchor: 'free', align: 'center',
            size: 11.5, weight: 800, ink: '#3a1c0c', over: CHIP, fade: a, maxWidth: q.w - 8,
          });
        }
      }

      if (showNewCard()) {
        const r = newCardRect();
        const ready = adopt.ok;
        const bg = ready ? CARD : CARD_OFF;
        const lx = r.x + 20 + K.portraitR * 2 + 16;
        const lw = r.w - (lx - r.x) - 20;
        drawText(g, COPY.newTitle, {
          x: lx, y: r.y + 26, anchor: 'free', align: 'left',
          size: 15, weight: 800, ink: '#5d3018', over: bg, fade: a, maxWidth: lw,
        });
        /* the GOAL, stated as a number she is saving toward — care points are a
           currency she can see; what they say about her is the word above */
        drawText(g, ready ? COPY.newReady : `${game.carePoints} / ${adopt.at} care points`, {
          x: lx, y: r.y + 46, anchor: 'free', align: 'left',
          size: 12, weight: 700,
          ink: ready ? '#8a4b22' : '#5d3018', over: bg, fade: a, maxWidth: lw,
        });
        drawText(g, ready ? COPY.newReadyNote : COPY.newLockedNote, {
          x: lx, y: r.y + 64, anchor: 'free', align: 'left',
          size: 10.5, weight: 500, ink: 'rgba(93,48,24,0.72)', over: bg, fade: a,
          maxWidth: lw - 130,
        });
        const q = adoptChipRect();
        drawText(g, ready ? COPY.adopt : COPY.newLocked(adopt.short), {
          x: q.x + q.w / 2, y: q.y + q.h / 2, anchor: 'free', align: 'center',
          size: 11, weight: 800,
          ink: ready ? '#3a1c0c' : '#5d3018', over: ready ? CHIP : CHIP_OFF,
          fade: a, maxWidth: q.w - 8,
        });
      }

      drawText(g, COPY.earned, {
        x: pad + 4, y: earnedTop() + 4, anchor: 'free', align: 'left',
        size: 11.5, weight: 800, ink: 'rgba(93,48,24,0.80)', over: PANEL, fade: a,
        maxWidth: W - pad * 2 - 8,
      });
      for (let i = 0; i < earned.length; i++) {
        const e = earned[i];
        const r = earnedRect(i);
        const bg = e.got ? CARD : CARD_OFF;
        const rightW = (e.wearable && e.got) ? 76 : 62;
        drawText(g, e.name, {
          x: r.x + 40, y: r.y + r.h / 2 - 7, anchor: 'free', align: 'left',
          size: 12, weight: 700,
          ink: e.got ? '#5d3018' : 'rgba(93,48,24,0.62)', over: bg, fade: a,
          maxWidth: r.w - 40 - rightW,
        });
        drawText(g, e.note || '', {
          x: r.x + 40, y: r.y + r.h / 2 + 8, anchor: 'free', align: 'left',
          size: 9.5, weight: 500, ink: 'rgba(93,48,24,0.60)', over: bg, fade: a,
          maxWidth: r.w - 40 - rightW,
        });
        if (e.wearable && e.got) {
          const q = earnedChipRect(i);
          drawText(g, e.worn ? COPY.take : COPY.wear, {
            x: q.x + q.w / 2, y: q.y + q.h / 2, anchor: 'free', align: 'center',
            size: 10.5, weight: 800, ink: e.worn ? '#5d3018' : '#3a1c0c',
            over: e.worn ? CHIP_OFF : CHIP, fade: a, maxWidth: q.w - 6,
          });
        } else if (!e.got) {
          drawText(g, COPY.locked(e.short), {
            x: r.x + r.w - 12, y: r.y + r.h / 2, anchor: 'free', align: 'right',
            size: 10, weight: 700, ink: 'rgba(93,48,24,0.58)', over: bg, fade: a,
            maxWidth: 58,
          });
        }
      }

      drawText(g, COPY.close, {
        x: cl.x + cl.w / 2, y: cl.y + cl.h / 2, anchor: 'free', align: 'center',
        size: 12.5, weight: 800, ink: '#5d3018', over: '#f0dfc2', fade: a,
        maxWidth: cl.w - 10,
      });
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
        roster: roster.map((d) => ({ id: d.id, name: d.name, breedId: d.breedId, sex: d.sex, active: d.active, worn: d.worn })),
        earned: earned.map((e) => ({ id: e.id, at: e.at, got: e.got, short: e.short, worn: !!e.worn })),
        showNew: showNewCard(),
      };
    },
  };

  function standingRect() { return { x: W - pad - 148, y: topY() + 22, w: 148, h: 28 }; }

  function breedName(id) {
    const b = BREEDS[id];
    if (b && b.name) return b.name;
    /* THE BREED ART IS BEING BUILT IN PARALLEL. `getBreed` falls back to the
       Shiba for an id it does not have yet, which is the breed seam working as
       ARCHITECTURE §11.3 intends — a new breed is a DATA entry, and this
       surface needs no change when it lands. Until then the name comes from
       the unlocks table so the card never claims to be a Shiba. */
    const u = BALANCE.economy.unlocks.find((x) => x.kind === 'breed' && x.id === id);
    if (u) return u.name;
    return id === EK.adoptBreed ? COPY.newTitle : cap(String(id || ''));
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
    c.fillStyle = 'rgba(124,74,47,0.10)';
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
      c.strokeStyle = WEAR_COLOUR[worn] || '#c9563f';
      c.lineWidth = r * 0.15; c.lineCap = 'round';
      c.beginPath(); c.arc(0, r * 0.30, r * 0.56, Math.PI * 0.22, Math.PI * 0.78); c.stroke();
    }
    if (flash > 0) {
      c.globalAlpha = flash * 0.5;
      c.fillStyle = '#fff6df';
      c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill();
    }
    c.restore();
  }

  /** the not-yet-adopted card's portrait: a shape behind a door, until she is */
  function newPortrait(c, x, y, ready, a, scale) {
    const r = K.portraitR * (scale || 1);
    c.save();
    c.translate(x, y);
    c.fillStyle = ready ? 'rgba(233,149,79,0.22)' : 'rgba(124,74,47,0.10)';
    c.beginPath(); c.arc(0, 2, r + 2, 0, TAU); c.fill();
    c.fillStyle = ready ? '#f6dfb4' : '#e5d8c4';
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
      c.fillStyle = 'rgba(93,48,24,0.42)';
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
    if (beat === 'knock') { u = clamp(beatT / Math.max(0.001, B.hold), 0, 1); line = COPY.knock; }
    else if (beat === 'reveal') { u = clamp(beatT / Math.max(0.001, B.reveal), 0, 1); line = COPY.reveal; }
    else { u = clamp(beatT / Math.max(0.001, B.settle), 0, 1); line = COPY.settle(game.pron); }
    /* fade in fast, hold, fade out at the very end of the last beat */
    const fade = beat === 'settle'
      ? clamp(Math.min(u / 0.12, (1 - u) / 0.18), 0, 1)
      : clamp(Math.min(u / 0.16, 1), 0, 1);

    c.save();
    /* near-opaque: the panel is not drawn behind this, but the ROOM is */
    c.fillStyle = `rgba(38,20,10,${(0.93 * clamp(beat === 'knock' ? u * 2.2 : 1, 0, 1)).toFixed(3)})`;
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
      x: W / 2, y: H * 0.66, anchor: 'free', align: 'center',
      size: 15.5, weight: 700, ink: '#ffeccd', plate: 'auto',
      fade, maxWidth: W - 56,
    });
  }

  return kennel;
}

export default createKennel;
