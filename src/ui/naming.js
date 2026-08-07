/* ==========================================================================
   ui/naming.js — the first-run naming beat.

   The puppy arrives UNNAMED and *she* names it. That moment is the emotional
   centre of first launch (SCOPE.md stage 6), so this deliberately has almost
   no chrome: no card, no title bar, no buttons row, no progress dots. A warm
   scrim so the puppy is still visible and still moving, two quiet lines, and
   then one bare text field on an underline.

   Three things it must get right:
     - the puppy is ON SCREEN and ALIVE throughout. She is not naming a form
       field, she is naming the animal she can see.
     - she can skip. A save with no name is completely valid; the beat simply
       offers itself again next launch, and Settings can name or rename at any
       time. Nothing is gated on it.
     - tapping advances. Anyone who has read the line already should not have
       to sit and wait for it.

   The single text input is a real DOM element on purpose — it is the only way
   to get the OS keyboard, autocapitalisation and the return key.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { clamp, smooth, roundRect } from '../engine/draw.js';
import { drawText, plateAlpha } from './text.js';
import { capitalise } from '../state/game.js';
/* `alpha` comes in as `tint`: this module has used `let alpha` for the overlay
   fade since stage 1, and importing a function under that name shadowed it
   silently — the module still parsed and threw `alpha is not a function` only
   when the naming beat actually drew, which is the first screen of the game. */
import { INK as TOK, C, type, alpha as tint } from './tokens.js';

const NA = BALANCE.ui.naming;
const VW = BALANCE.view.W;
const VH = BALANCE.view.H;

/* Vertical layout, in virtual units. Everything lives in the top third: the
   puppy's ears reach y~373 and NO COPY MAY SIT ACROSS HER FACE — she is the
   thing being looked at. The scrim darkens the top so cream text still reads
   over the pale window. */
const LINE_Y = {
  line: 246, ask: 200, field: 252, cue: 330, skip: VH - 84,
  /* the reveal, named rather than inlined at 252/296 */
  reveal: 252, revealSub: 296,
};
/* the beat's one ink, and the SCRIM ALPHA SOLVED FOR IT. `plateAlpha` returns
   the smallest alpha at which a plate of this colour gives this ink 4.5:1
   against the worst possible background — pure black or pure white showing
   through. The scrim is drawn at that alpha, so it is the guarantee and no
   pill is needed over the one moment in the game that must have no chrome. */
const INK = TOK.onDark;
/* THE SCRIM IS DELIBERATELY NOT `deep-bark`, AND THIS IS THE ONE DOCUMENTED
   EXCEPTION TO "no chrome names its own colour" (ui/tokens.js rule 1).
   `deep-bark` (#2A1C14) is the deepest SURFACE shadow — the colour a card casts.
   This is not a surface: it is a full-screen vignette whose job is to take the
   room down far enough that a single cream line is the only thing in the world,
   and it has to go deeper than any surface token is allowed to. It also carries
   the beat's entire contrast guarantee, because `SCRIM_A` is solved against it
   and no plate is drawn over the one moment that must have no chrome at all.
   Swapping it for a lighter token would silently raise the solved alpha and make
   this beat darker to compensate — a worse result reached by a tidier route. */
const SCRIM = '#1a0d06';
const SCRIM_A = plateAlpha(INK, SCRIM);
/* the warm highlight: the caret, and the name once she has typed it */
const WARM = C.secondaryContainer;

export function createNaming(opts = {}) {
  /* NO HARDCODED PRONOUN. "Her new name" was wrong on screen for a male gift
     puppy; the pronoun comes from per-dog data at draw time (§13.5). */
  const pron = () => (opts.game ? opts.game.pron : { their: 'their' });
  const game = opts.game;
  const reduced = !!opts.reduced;
  const onDone = opts.onDone || (() => {});
  const onName = opts.onName || (() => {});

  let open = false;
  let mode = 'first';
  let stage = 0;           // index into the line sequence
  let t = 0;               // seconds in the current stage
  let alpha = 0;           // overlay fade
  let lines = [];
  let el = null;           // the DOM input host
  let input = null;
  let revealName = '';
  let closing = false;

  /* the copy. Second person, present tense, no exclamation marks — the beat
     carries itself and punctuation shouting over it makes it cheaper. */
  function script() {
    /* SUBJECT AND OBJECT ARE DIFFERENT WORDS, and the rename line needs the
       SUBJECT. This beat had one local holding the object pronoun and used it
       for both lines, which is right for "what will you call HIM" and wrong for
       "what should HE be called" — so renaming an already-named dog asked
       **"What should him be called?"**, and "What should her be called?" for a
       female. Rendered and read; no gate covers grammar.

       Taken from `game.pron` rather than a local ternary, which is what
       state/game.js asks every caller to do: the pronoun table is one place and
       a ternary at each site is how the two forms drifted apart here. */
    const P = game.pron;
    const they = P.they;                        // he  / she  — the SUBJECT
    const them = P.them;                        // him / her  — the OBJECT
    const They = capitalise(they);
    if (mode === 'rename') {
      return [{ text: game.isNamed ? 'What should ' + they + ' be called?' : 'What will you call ' + them + '?', ask: true }];
    }
    return [
      { text: 'Someone came for you.', hold: NA.beats[0] },
      { text: They + "'s yours.", hold: NA.beats[1] },
      { text: 'What will you call ' + them + '?', ask: true },
    ];
  }

  /* ---- the one DOM element ------------------------------------------- */
  function makeInput(view) {
    if (el) return;
    el = document.createElement('div');
    el.setAttribute('data-pp-name', '');
    el.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;z-index:40;'
      + 'pointer-events:none;display:flex;align-items:center;justify-content:center;';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'pointer-events:auto;display:flex;flex-direction:column;align-items:center;gap:0;';
    input = document.createElement('input');
    input.type = 'text';
    input.maxLength = NA.maxLen;
    input.autocomplete = 'off';
    input.autocapitalize = 'words';
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Name your puppy');
    input.value = mode === 'rename' && game.isNamed ? game.dog.name : '';
    /* bare: no box, no fill, just a line to write on */
    input.style.cssText = `background:transparent;border:0;border-bottom:1.5px solid ${tint(INK, 0.42)};`
      + `outline:none;text-align:center;color:${INK};caret-color:${WARM};`
      + `font:${type('headlineMd').weight} ${type('headlineMd').size}px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;`
      + 'width:230px;padding:6px 4px 8px;letter-spacing:.01em;'
      + '-webkit-user-select:text;user-select:text;';
    const submit = () => {
      const v = (input.value || '').trim();
      if (!v) return;
      commit(v);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });
    input.addEventListener('input', () => { /* redrawn from draw() each frame */ });
    wrap.append(input);
    el.append(wrap);
    /* never let a tap on the field reach the canvas underneath */
    for (const ev of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'click']) {
      el.addEventListener(ev, (e) => e.stopPropagation());
    }
    document.body.append(el);
    place(view);
    setTimeout(() => { try { input.focus(); } catch (e) { /* ignore */ } }, 60);
  }

  /** keep the DOM field lined up with the canvas copy at any viewport */
  function place(view) {
    if (!el || !input) return;
    const vs = view ? view.vs : 1;
    input.style.fontSize = (26 * vs).toFixed(1) + 'px';
    input.style.width = (232 * vs).toFixed(0) + 'px';
    /* The field sits in the UPPER third, under the question line and clear of
       her ears. Two reasons it cannot go lower: the copy must never sit across
       the puppy's face, and on iOS the OS keyboard covers roughly the bottom
       45% of the screen the moment the field takes focus. */
    const cy = view ? (view.offY + LINE_Y.field * vs) : LINE_Y.field;
    el.style.alignItems = 'flex-start';
    el.style.paddingTop = Math.max(0, cy) + 'px';
  }

  function killInput() {
    if (el) { try { el.remove(); } catch (e) { /* ignore */ } }
    el = null; input = null;
  }

  /* ---- lifecycle ----------------------------------------------------- */
  function start(m, view) {
    mode = m || 'first';
    lines = script();
    stage = 0;
    t = 0;
    open = true;
    closing = false;
    revealName = '';
    alpha = 0;
    if (lines[0] && lines[0].ask) makeInput(view);
  }

  function commit(v) {
    const named = game.setName(v);
    if (!named) return;
    revealName = named;
    killInput();
    stage = lines.length;      // -> the reveal
    t = 0;
    onName(named);
  }

  /** she chose not to name it yet. Entirely valid; we just get out of the way. */
  function skip() {
    killInput();
    closing = true;
    t = 0;
  }

  function close() {
    killInput();
    open = false;
    closing = false;
    alpha = 0;
    onDone(revealName);
  }

  /* ---- update -------------------------------------------------------- */
  function update(dt) {
    if (!open) return;
    t += dt;
    const target = closing ? 0 : 1;
    alpha += (target - alpha) * (1 - Math.exp(-(reduced ? 5 : 6.5) * dt));
    if (closing && alpha < 0.02) { close(); return; }

    if (revealName) {
      /* the reveal: her name, held, then out of the way */
      if (t > NA.revealHold) closing = true;
      return;
    }
    const line = lines[stage];
    if (line && !line.ask && t > (line.hold || 2.4)) advance();
  }

  function advance() {
    if (revealName || closing) return;
    const line = lines[stage];
    if (line && line.ask) return;      // the ask waits for her, not the clock
    stage = Math.min(stage + 1, lines.length - 1);
    t = 0;
    if (lines[stage] && lines[stage].ask) makeInput(null);
  }

  /* ---- pointer ------------------------------------------------------- */
  function pointer(ev, view) {
    if (!open || closing) return false;
    if (ev.type !== 'down') return true;
    if (revealName) { closing = true; return true; }
    const line = lines[stage];
    if (line && line.ask) {
      /* the "not yet" affordance, low and quiet at the bottom */
      if (ev.y > LINE_Y.skip - 30 && ev.y < LINE_Y.skip + 28) { skip(); return true; }
      /* a tap on the field area focuses it (iOS wants a real gesture) */
      if (input) { try { input.focus(); } catch (e) { /* ignore */ } }
      return true;
    }
    advance();
    return true;
  }

  /* ---- draw ---------------------------------------------------------- */
  function draw(g, view) {
    if (!open && alpha < 0.01) return;
    const c = g.ctx;
    const a = clamp(alpha, 0, 1);
    place(view);

    /* A WARM SCRIM, NOT A BLACKOUT. She has to be able to see the puppy moving
       while she decides — that is the entire point of the beat — so the puppy
       keeps a pool of light and only the surroundings go down. */
    c.save();
    const gr = c.createRadialGradient(VW / 2, 560, 90, VW / 2, 520, 620);
    gr.addColorStop(0, `rgba(38,20,10,${(0.08 * a).toFixed(3)})`);
    gr.addColorStop(0.55, `rgba(38,20,10,${(0.44 * a).toFixed(3)})`);
    gr.addColorStop(1, `rgba(30,15,7,${(0.70 * a).toFixed(3)})`);
    c.fillStyle = gr;
    c.fillRect(0, 0, VW, VH);
    /* AND THE TOP GOES FURTHER DOWN, BECAUSE THE SCRIM IS THE GUARANTEE.
       This beat draws no plate behind its copy, on purpose: a pill over the
       emotional centre of first launch is chrome where there must be none
       (stage 4 made that call for the title and it is the right one). But
       `plate: 'none'` with no `over` means the helper guarantees NOTHING, and
       the previous gradient resolved to only ~0.36 alpha at the copy's y —
       so cream over the pale wall and the sunlit window computed to about
       2.0:1, which is the project's recurring failure wearing a third costume.

       The fix is not a pill. It is to make the beat's OWN SCRIM as strong as
       the plate would have been: `SCRIM_A` is `plateAlpha(ink, '#1a0d06')`,
       i.e. the alpha ui/text.js SOLVES for cream to clear 4.5:1 against the
       worst possible background. The scrim then does the plate's job as art,
       and the guarantee is measured rather than hoped for. Held flat across
       the whole copy band (down to y=352) and only then released. */
    const tb = c.createLinearGradient(0, 0, 0, 440);
    /* derived from SCRIM rather than re-typing it four times: the band and the
       vignette have to be the same colour or the seam shows */
    tb.addColorStop(0, tint(SCRIM, Math.min(0.82, SCRIM_A + 0.10) * a));
    tb.addColorStop(0.45, tint(SCRIM, Math.min(0.80, SCRIM_A + 0.08) * a));
    tb.addColorStop(0.80, tint(SCRIM, (SCRIM_A + 0.02) * a));
    tb.addColorStop(1, tint(SCRIM, 0));
    c.fillStyle = tb;
    c.fillRect(0, 0, VW, 440);

    /* AND THE BOTTOM BAND, FOR THE SAME REASON AND BY THE SAME METHOD.
       The band above guarantees the copy down to y=440. `not yet` lives at
       `LINE_Y.skip` = VH-84 = 760, which is nowhere near it, so it inherited
       only the radial's ~0.44 over the rug — and the rug is STRIPED, so the
       word straddled a teal stripe and a cream one. Measured off the render:
       1.95:1. Half of it read and half of it vanished, which is worse than
       uniformly faint because it looks like a rendering artefact rather than
       like something you are meant to be able to press.

       It is a real tap target (see `pointer`), so it does not get to be
       decorative-faint — the note on the drawText call below already said so
       and raised its alpha from 0.42 to 0.72, which moved it from invisible to
       merely illegible, because alpha was never the variable that mattered.

       Same remedy as the top, and deliberately NOT a pill: hold `SCRIM_A` —
       the alpha ui/text.js SOLVES for this ink to clear 4.5:1 against the worst
       background — flat across the skip line's own band. Nothing here is
       hand-tuned; it is the same solved constant the top band uses.

       It starts at 660, below the rug's far edge and well below his paws
       (~y 540-570), so the pool of light he sits in is untouched. The beat's
       whole point is that she can watch him while she decides. */
    const bb = c.createLinearGradient(0, 660, 0, 748);
    bb.addColorStop(0, tint(SCRIM, 0));
    bb.addColorStop(0.62, tint(SCRIM, (SCRIM_A + 0.02) * a));
    bb.addColorStop(1, tint(SCRIM, Math.min(0.80, SCRIM_A + 0.06) * a));
    c.fillStyle = bb;
    c.fillRect(0, 660, VW, VH - 660);
    c.restore();

    c.save();
    c.textAlign = 'center';
    c.textBaseline = 'middle';

    if (revealName) {
      /* HER NAME, large and quiet, and then it gets out of the way. Through the
         helper so it shrinks to the safe band rather than running to the edges
         — `maxLen: 14` does not guarantee that at every viewport — and so the
         name is centred and clamped by the same code as everything else.
         No plate: the scrim above is the guarantee. */
      const u = clamp(t / 0.7, 0, 1);
      const sc = 1 + (1 - smooth(u)) * 0.10;
      c.restore();
      drawText(g, revealName, {
        ...type('headlineLg'), size: type('headlineLg').size * sc,
        x: VW / 2, y: LINE_Y.reveal,
        ink: INK, plate: 'none', maxWidth: VW - 64,
        fade: a * smooth(clamp(t / 0.45, 0, 1)),
      });
      drawText(g, mode === 'rename' ? `${capitalise(pron().their)} new name` : 'Hello, ' + revealName, {
        ...type('labelMd'),
        x: VW / 2, y: LINE_Y.revealSub,
        ink: INK, plate: 'none', maxWidth: VW - 64,
        fade: a * smooth(clamp((t - 0.5) / 0.6, 0, 1)),
      });
      return;
    }

    const line = lines[stage] || lines[0];
    const fade = smooth(clamp(t / NA.lineFade, 0, 1));
    /* THE TITLE, through ui/text.js (retrofitted in stage 4).
       It was `fillText(..., VW/2, ...)` with a drop shadow, and it read as
       off-centre because VW/2 is the centre of the DESIGN SPACE while the
       scrim's pool of light — the thing the eye actually measures "centred"
       against — is a radial gradient centred elsewhere. Going through the
       helper also clamps the line inside the SAFE horizontal band and shrinks
       it to fit rather than letting a long name run to the edges, which
       `maxLen: 14` alone does not guarantee at every viewport.
       `plate: 'none'` because the beat already draws its own warm scrim and a
       second plate on top of it would be chrome over the one moment in the
       game that must have none. */
    drawText(g, line.text, {
      x: VW / 2, y: line.ask ? LINE_Y.ask : LINE_Y.line,
      ...type('titleMd', { weight: 500 }), ink: INK,
      plate: 'none', fade: a * fade * 0.96,
      maxWidth: VW - 56,
    });
    /* drawText save/restores, so textAlign/textBaseline are still the
       centre/middle set at the top of this block */

    if (line.ask) {
      /* the underline is drawn by the DOM field; here we only add the two
         quiet affordances around it */
      const typed = input && input.value ? input.value.trim() : '';
      c.restore();
      drawText(g, typed ? 'Press return' : 'Type a name', {
        ...type('labelSm', { weight: 700, track: 0.04 }),
        x: VW / 2, y: LINE_Y.cue,
        ink: typed ? WARM : INK, plate: 'none',
        fade: a * fade * (typed ? 1 : 0.62),
      });
      /* "not yet" is a real tap target (see `pointer`), so it is not allowed to
         be decorative-faint — it was at 0.42 and reading it required knowing it
         was there. It stays the quietest thing on screen and stays legible. */
      drawText(g, 'not yet', {
        ...type('labelSm', { weight: 600, track: 0 }),
      x: VW / 2, y: LINE_Y.skip,
        ink: INK, plate: 'none', fade: a * fade * 0.72,
      });
      return;
    }
    c.restore();
    /* the faintest possible "tap to go on" — present, never insistent. This one
       IS decorative: it repeats an affordance the whole screen already has (any
       tap advances), so it is the one place a low alpha is honest. */
    drawText(g, 'tap', {
      ...type('labelSm', { weight: 600, track: 0 }),
      x: VW / 2, y: VH - 118,
      ink: INK, plate: 'none',
      fade: a * fade * 0.34 * (0.6 + 0.4 * Math.sin(t * 2.1)),
    });
  }

  return {
    get isOpen() { return open; },
    get active() { return open || alpha > 0.01; },
    get mode() { return mode; },
    get stage() { return stage; },
    get asking() { return !!(open && lines[stage] && lines[stage].ask && !revealName); },
    get named() { return revealName; },
    start, close, skip, update, draw, pointer,
    /** verification hook: name it without a keyboard */
    submit(v) { commit(v); },
    resize(view) { place(view); },
    get debug() {
      return {
        open, mode, stage, t: +t.toFixed(2), alpha: +alpha.toFixed(3),
        asking: !!(lines[stage] && lines[stage].ask), revealName, closing,
        line: (lines[stage] && lines[stage].text) || '',
      };
    },
  };
}

export default createNaming;
