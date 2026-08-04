/* ==========================================================================
   ui/install.js — the one honest reason to add this to the home screen.

   WHY THIS IS NOT A GROWTH BANNER. iOS's Intelligent Tracking Prevention
   deletes ALL script-writable storage — localStorage, IndexedDB and the service
   worker registration — after seven days of Safari use without a first-party
   visit, and **installed home-screen web apps are exempt** (see
   docs/PLATFORM-RISKS.md Risk 1, sourced). So in a browser tab her save is
   genuinely at risk, and installing is genuinely the fix. That makes this a
   data-integrity prompt, and it is allowed to exist only because it is true.

   FOUR RULES, AND EACH ONE IS THE DIFFERENCE BETWEEN A KINDNESS AND A NAG.

   1. IT SAYS THE REAL REASON. Not "install our app" — "adding him to your home
      screen is what keeps him safe", because that is literally what it does.
      No badge, no urgency, no countdown, and nothing is withheld from her if
      she says no. A generic banner would be a lie dressed as a feature.

   2. IT NEVER APPEARS WHEN SHE IS ALREADY INSTALLED. `app.standalone` is
      checked on every single frame it could draw, not once at boot, because a
      launch from the home-screen icon is exactly the case where showing it
      would make the game look like it does not know where it is.

   3. IT NEVER APPEARS UNTIL SHE HAS SOMETHING TO LOSE, AND NEVER IN FRONT OF A
      ONE-SHOT MOMENT. He must be NAMED — before that there is nothing to
      protect — and then it waits `firstDelay` (80s) into her first session so
      she gets the dog to herself, or the much shorter `delay` (22s) on any later
      launch. It routes through the room's `surfaceBlockedFor()` arbiter like
      every other surface (ARCHITECTURE §14.1), so it physically cannot open over
      the naming beat, the reunion, a walk or a trial.

      An earlier draft gated this on affection instead, and it was wrong in an
      instructive way: affection is metered per session and per day (§12.1), so
      the threshold was about four days of play — the prompt would have arrived
      after the seven-day storage window it exists to beat. A gate that protects
      a save must never be slower than the thing that deletes it.

   4. IT NEVER NAGS. Twice, ever, `gapDays` apart, and only if she neither
      dismissed it with "Don't ask again" nor installed. Dismissal is persisted
      in `state.flags`, which the save already carries and merges forward — no
      new required field, so no schema bump.

   AND: NO NOTIFICATION PERMISSION IS EVER REQUESTED HERE, or anywhere. Research
   §3 notes that installing is also what unlocks Web Push, and GIFT-READY §3
   excludes notifications outright. Installing buys her a safe save and nothing
   she has to answer to.

   All copy goes through `ui/text.js` (there are zero `fillText` calls outside
   it) and every pronoun comes from `game.pron`.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { clamp, roundRect } from '../engine/draw.js';
import { Spring } from '../engine/spring.js';
import { drawText } from './text.js';
/* `INK` is already a local const in this file (the card's strong ink), so the
   token group comes in as TOK rather than renaming a name that appears a dozen
   times below for no gain. */
import { INK as TOK, SURF, R, type } from './tokens.js';
import { tactile, softShadow } from './surface.js';

const I = BALANCE.install;
const VW = BALANCE.view.W;

/* the card is opaque, so `over` gives ui/text.js an exact contrast answer
   rather than a worst-case bound, and no plate is drawn on top of the paper.
   TOKENS (stage 9): every one of these was a hex typed out here that also
   existed, slightly differently, in ui/sheet.js, ui/shop.js and ui/kennel.js. */
const CARD = SURF.card;
const CARD_EDGE = SURF.border(0.20);
const BTN = SURF.chip;
const BTN_WARM = SURF.chipStrong;
const INK = TOK.body;
const INK_SOFT = TOK.soft();

/* ==========================================================================
   COPY — every player-facing string in this file, and nowhere else.
   Each one takes `P = game.pron` so no pronoun is hardcoded; the gift puppy is
   male and a later dog may not be.
   ========================================================================== */
export const COPY = {
  title: (P, name) => (name ? `Keep ${name} safe` : `Keep ${P.them} safe`),
  /* THE HONEST SPECIFIC REASON. It names the real mechanism without turning
     into a lecture, and it never suggests anything has gone wrong. */
  why: (P, name) => `Add ${P.them} to your home screen and ${P.they} stay${P.s} put.`,
  risk: () => 'In a browser tab, iPhone tidies away saved games after a week.',
  howIOS: () => 'Tap Share, then Add to Home Screen.',
  howGeneric: () => 'Your browser can add this as an app.',
  add: () => 'Add to home screen',
  gotIt: () => 'Got it',
  later: () => 'Not now',
  never: () => "Don't ask again",
  /* said once, warmly, after she does it — the only sentence here that is a
     thank-you rather than an explanation */
  done: (P, name) => `${name || 'He'} is safe now.`,
};

/**
 * @param o.game        state/game.js
 * @param o.standalone  () => boolean, live. NEVER cached.
 * @param o.reduced     prefers-reduced-motion
 * @param o.blocked     () => '' | the layer owning the surface. The room's
 *                      arbiter, passed in rather than re-derived.
 * @param o.toast       (msg) => void
 */
export function createInstall(o = {}) {
  const game = o.game;
  const reduced = !!o.reduced;
  const isStandalone = typeof o.standalone === 'function' ? o.standalone : () => false;
  const blocked = typeof o.blocked === 'function' ? o.blocked : () => '';
  const toast = typeof o.toast === 'function' ? o.toast : () => {};

  const slide = new Spring(0, reduced ? 96 : 132, reduced ? 22 : 15);
  let open = false;
  let sceneT = 0;
  let boxes = null;          // last drawn geometry, for the hit test
  let deferred = null;       // a captured `beforeinstallprompt`, where it exists
  let installedJustNow = false;

  /* ---- the platform's own install path, if it has one -----------------
     iOS has no programmatic install and never fires this — the Share sheet is
     the only way, which is why the copy names it. Chromium DOES fire it, and
     honouring it means the button really installs rather than explaining. */
  const onBip = (e) => {
    e.preventDefault();
    deferred = e;
  };
  try { window.addEventListener('beforeinstallprompt', onBip); } catch (e) { /* not supported */ }

  const flags = () => (game && game.state && game.state.flags) || {};
  const shows = () => {
    const n = +flags().installShown;
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };
  const lastAt = () => {
    const t = +flags().installAskedAt;
    return Number.isFinite(t) ? t : 0;
  };

  /**
   * THE WHOLE "NEVER NAG" POLICY, IN ONE FUNCTION, so there is exactly one
   * answer to "may this appear" and no caller can route around it.
   */
  function eligible(now) {
    if (!game) return false;
    /* 2 — already installed. Checked live, every frame. */
    if (isStandalone()) return false;
    /* 4 — she said don't ask again, or we have already asked our fill */
    if (flags().installNever) return false;
    if (shows() >= I.maxShows) return false;
    const since = now - lastAt();
    if (lastAt() && since < I.gapDays * 86400e3) return false;
    /* 3 — she must have something to lose, and be past the one-shot moments.
       NAMING HIM IS THE THRESHOLD: before that there is nothing to protect and
       the naming beat must have the screen to itself. After it, the wait is
       long on the first launch (she should get the dog to herself first) and
       short on any later one (she has already met him, and the seven-day
       storage clock is running). */
    if (!game.isNamed) return false;
    const launches = +(game.state.flags || {}).launches || 0;
    if (sceneT < (launches >= 2 ? I.delay : I.firstDelay)) return false;
    /* and never over another surface — the arbiter, not a private guard */
    if (blocked('install')) return false;
    return true;
  }

  function remember(kind) {
    if (!game) return;
    game.setFlag('installShown', shows() + 1);
    game.setFlag('installAskedAt', Date.now());
    if (kind === 'never') game.setFlag('installNever', true);
  }

  function close(kind) {
    if (!open) return;
    open = false;
    slide.to(0);
    remember(kind);
  }

  /* ---- the card's geometry: ONE expression, used by the draw AND the hit
     test, which is the lesson stage 5 paid for with a button floating over his
     paws (ARCHITECTURE §15.4 defect 5) ---------------------------------- */
  function layout(view) {
    const C = I.card;
    const w = Math.min(C.w, VW - 28);
    const x = (VW - w) / 2;
    /* anchored to the SAFE band, not the raw frame */
    const vs = (view && view.vs) || 1;
    const safeTop = ((view && view.safe && view.safe.top) || 0) / vs;
    const y = Math.max(safeTop + 14, C.y);
    const h = C.h;
    const bh = C.btnH;
    const bw = (w - C.pad * 2 - C.btnGap) / 2;
    /* THE BUTTON ROW IS PLACED FIRST and the copy is laid out in what is left,
       so a line can never end up underneath a button. That is exactly what
       happened when the two were positioned independently. */
    const btnTop = y + h - C.pad - bh;
    return {
      x, y, w, h, btnTop,
      glyph: { x: x + w / 2, y: y + 28, r: 15 },
      title: y + 62,
      why: y + 92,
      risk: y + 112,
      how: y + 140,
      copyBottom: btnTop - 8,
      primary: { x: x + C.pad, y: btnTop, w: bw, h: bh },
      secondary: { x: x + C.pad + bw + C.btnGap, y: btnTop, w: bw, h: bh },
      never: { x, y: y + h + 6, w, h: 30 },
    };
  }

  const api = {
    get isOpen() { return open; },
    get showing() { return open || slide.x > 0.01; },
    /** the arbiter asks this: the card owns the surface while it is up */
    get modal() { return open; },
    get shows() { return shows(); },
    get canPrompt() { return !!deferred; },
    COPY,

    /** for a test or a settings row: ask now, ignoring the cadence */
    force() {
      if (isStandalone()) return false;
      open = true;
      slide.to(1);
      return true;
    },

    update(dt, view) {
      sceneT += dt;
      slide.step(dt);
      if (!open && slide.t === 0 && slide.x < 0.01) boxes = null;
      if (open && isStandalone()) { open = false; slide.to(0); return; }
      /* IT RETRACTS, not just refuses to open. `eligible()` gates *opening*, and
         that is not the same guarantee: if anything else takes the surface while
         the card is already up, two modal states are stacked and the card is
         swallowing touches meant for the thing underneath. Retracting costs her
         nothing and is deliberately NOT recorded as one of the two asks — she
         never saw it, so it would be dishonest to spend one. */
      if (open && blocked('install')) { open = false; slide.to(0); return; }
      if (!open && eligible(Date.now())) {
        open = true;
        slide.to(1);
      }
      void view;
    },

    draw(g, view) {
      if (!open && slide.x < 0.01) return;
      const c = g.ctx;
      const L = layout(view);
      boxes = L;
      const k = clamp(slide.x, 0, 1);
      const P = game ? game.pron : { they: 'they', them: 'them', s: '' };
      const name = game && game.isNamed ? game.dog.name : '';

      c.save();
      /* a scrim, so the card reads as in front of the room without hiding him */
      c.globalAlpha = 0.34 * k;
      c.fillStyle = SURF.scrim(1);
      c.fillRect(-40, -40, VW + 80, BALANCE.view.H + 80);
      c.globalAlpha = 1;

      /* the card slides up a little as it fades in — reduced motion flattens
         the travel to almost nothing rather than removing the transition */
      const rise = (1 - k) * (reduced ? 6 : 26);
      c.globalAlpha = k;
      c.translate(0, rise);

      /* THE WARM SOFT SHADOW, replacing a hand-offset copy of the card in
         `rgba(84,46,20,0.20)` two units right and five down. That trick reads as
         a second card peeking out rather than as a shadow, because a hard-edged
         duplicate has no falloff. `0 12px 32px -4px rgba(131,83,43,.12)` does. */
      softShadow(c, L.x, L.y, L.w, L.h, I.card.r);
      c.fillStyle = CARD;
      roundRect(c, L.x, L.y, L.w, L.h, I.card.r);
      c.fill();
      c.strokeStyle = CARD_EDGE;
      c.lineWidth = 1.4;
      roundRect(c, L.x, L.y, L.w, L.h, I.card.r);
      c.stroke();

      /* a tiny home-screen glyph: a rounded tile with a puppy-ish face, which is
         a small echo of the real icon. Drawn, like everything else in this game. */
      const gx = L.glyph.x, gy = L.glyph.y, gr = L.glyph.r;
      /* THE TILE IS THE PALE CHIP, NOT THE BUTTON'S FACE. It used to share
         `BTN_WARM` with the primary button, which was fine while that was a
         mid-orange; now the primary is the dark filled `chipStrong`, and a face
         drawn in `deep-bark` on a `primary`-brown tile would be invisible. The
         two were only ever the same colour by coincidence. */
      c.fillStyle = SURF.chipWarm;
      roundRect(c, gx - gr, gy - gr, gr * 2, gr * 2, gr * 0.55);
      c.fill();
      const faceInk = TOK.soft(0.80);
      c.fillStyle = faceInk;
      c.beginPath(); c.arc(gx - 5, gy - 3, 2.5, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(gx + 5, gy - 3, 2.5, 0, Math.PI * 2); c.fill();
      c.beginPath();
      c.moveTo(gx - 5, gy + 5); c.quadraticCurveTo(gx, gy + 9.5, gx + 5, gy + 5);
      c.strokeStyle = faceInk;
      c.lineWidth = 1.8; c.lineCap = 'round';
      c.stroke();

      const cx = L.x + L.w / 2;
      drawText(g, COPY.title(P, name), {
        ...type('titleMd', { weight: 700 }),
        x: cx, y: L.title, anchor: 'free',
        ink: TOK.heading, over: CARD, maxWidth: L.w - 40,
      });
      drawText(g, COPY.why(P, name), {
        ...type('labelMd'),
        x: cx, y: L.why, anchor: 'free',
        ink: INK_SOFT, over: CARD, maxWidth: L.w - 34,
      });
      drawText(g, COPY.risk(), {
        ...type('labelMd'),
        x: cx, y: L.risk, anchor: 'free',
        ink: INK_SOFT, over: CARD, maxWidth: L.w - 34,
      });
      /* THE ONLY ACTIONABLE LINE ON THE CARD, on its own, in the strong ink, and
         clamped above the button row so it can never hide under it */
      drawText(g, deferred ? COPY.howGeneric() : COPY.howIOS(), {
        ...type('labelMd', { weight: 700 }),
        x: cx, y: Math.min(L.how, L.copyBottom), anchor: 'free',
        ink: INK, over: CARD, maxWidth: L.w - 30,
      });

      /* the two ways out. Neither is styled as a refusal — "Not now" is not a
         smaller, greyer, harder-to-hit target than the other one.
         BOTH ARE TACTILE NOW. The primary is the FILLED one (`chipStrong`, dark,
         with cream on it) rather than the most saturated one, because the
         supplied palette has no saturated orange and its two nearest chips were
         the same lightness — see the note on SURF.chipStrong. The hierarchy is
         now lightness, which survives being looked at in the dark. */
      const btn = (b, label, warm) => {
        const face = warm ? BTN_WARM : BTN;
        /* the buttons act on `down` and the card closes in the same frame, so a
           held press cannot be shown here — the EDGE is the half of the
           treatment that pays, and it is what makes these read as buttons
           rather than as two coloured lozenges. */
        const f = tactile(c, {
          x: b.x, y: b.y, w: b.w, h: b.h - 4, r: R.full, p: 0, face, border: 0,
        });
        drawText(g, label, {
          ...type('labelMd', { weight: 700 }),
          x: b.x + b.w / 2, y: b.y + f.dy + (b.h - 4) / 2, anchor: 'free',
          ink: warm ? TOK.onStrong : INK, over: face,
          maxWidth: b.w - 14,
        });
      };
      btn(L.primary, deferred ? COPY.add() : COPY.gotIt(), true);
      btn(L.secondary, COPY.later(), false);

      /* the third door, and it is a real one: below the card, quiet, and it
         means what it says. It sits on the SCRIM, not on the card, so it is the
         one line here that gets ui/text.js's own plate rather than an `over`. */
      drawText(g, COPY.never(), {
        ...type('labelSm', { weight: 600, track: 0 }),
        x: L.x + L.w / 2, y: L.never.y + 16, anchor: 'free', ink: TOK.onDark,
      });

      c.restore();
    },

    /**
     * @returns true if the event was consumed. The card owns the whole surface
     * while it is up, so everything is consumed — a stray touch must not reach
     * the petting field behind a scrim.
     */
    pointer(ev) {
      if (!open || !boxes) return false;
      if (ev.type !== 'down') return true;
      const inside = (b) => ev.x >= b.x && ev.x <= b.x + b.w && ev.y >= b.y && ev.y <= b.y + b.h;
      if (inside(boxes.never)) { close('never'); return true; }
      if (inside(boxes.secondary)) { close('later'); return true; }
      if (inside(boxes.primary)) {
        if (deferred) {
          /* the platform has a real install path (Chromium). Use it. */
          try {
            deferred.prompt();
            const d = deferred;
            deferred = null;
            if (d.userChoice && typeof d.userChoice.then === 'function') {
              d.userChoice.then((r) => {
                if (r && r.outcome === 'accepted') { installedJustNow = true; }
              }, () => {});
            }
          } catch (e) { /* nothing to do; the copy already explained the manual path */ }
        }
        close('acted');
        return true;
      }
      /* a tap on the card itself does nothing — it is not a dismiss target, so
         she cannot lose the explanation by aiming badly */
      if (inside(boxes)) return true;
      /* the scrim. Tapping away is the same as "Not now": always available,
         never punished. */
      close('later');
      return true;
    },

    /** said once, if the platform told us it worked */
    tick() {
      if (installedJustNow) {
        installedJustNow = false;
        const P = game ? game.pron : { they: 'they' };
        toast(COPY.done(P, game && game.isNamed ? game.dog.name : ''));
      }
    },

    destroy() {
      try { window.removeEventListener('beforeinstallprompt', onBip); } catch (e) { /* fine */ }
    },

    get debug() {
      return {
        open, showing: api.showing, slide: +slide.x.toFixed(3),
        shows: shows(), never: !!flags().installNever,
        launches: +(flags().launches) || 0,
        standalone: isStandalone(), sceneT: +sceneT.toFixed(1),
        eligible: eligible(Date.now()), canPrompt: !!deferred,
        blockedBy: blocked('install'),
      };
    },
  };

  return api;
}

export default createInstall;
