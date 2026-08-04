/* ==========================================================================
   ui/sheet.js — a bottom sheet. Canvas-drawn rows with a spring slide-in,
   plus one small DOM escape hatch (`promptText`) for the save string, which
   genuinely needs a real text field the OS keyboard can talk to.

   ROUTED THROUGH ui/text.js IN STAGE 5. The sheet was never the worst offender
   — it draws an opaque panel, so its brown-on-cream was legible by
   construction — but it hand-rolled four font stacks and, more usefully, gave
   its labels, notes and right-hand words no width handling at all. A long note
   ran straight under the right-hand status word with no ellipsis. `over` keeps
   the panel unscrimmed and checks the ink against it exactly; `maxWidth`
   divides the row so the two columns cannot collide.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { clamp, roundRect } from '../engine/draw.js';
import { Spring } from '../engine/spring.js';
import { drawText } from './text.js';
import { INK, SURF, R, SP, PRESS, type } from './tokens.js';
import { tactile, card, createPresses, stitchedDivider } from './surface.js';

/* THE PANEL AND ROW COLOURS ARE TOKENS NOW (stage 9). They were `#fdf3df` and
   `#f7e7cd`, which are `surface-low` and `surface-container` to within a couple
   of channel steps — and were also typed out, slightly differently, in
   ui/shop.js, ui/kennel.js and ui/install.js. The sheet is fully opaque, so
   `over` still gives the contrast check an exact answer rather than a bound. */
const PANEL = SURF.card;
const ROW = SURF.row;

const W = BALANCE.view.W;
const H = BALANCE.view.H;

export function createSheet(opts = {}) {
  const reduced = !!opts.reduced;
  const slide = new Spring(0, reduced ? 90 : 130, reduced ? 20 : 16);
  let cfg = null;
  let bottomInset = 0;
  /* ---- the tactile press on a row that acts on DOWN -------------------
     `scenes/room.js` fires `sheetAction` on the down event, so a row is often
     gone by the frame after it is touched. A held press therefore cannot be
     shown, and pretending otherwise would be a state nobody ever sees. What IS
     worth having is the other half of the treatment: the 4-unit bottom edge,
     which makes a row an OBJECT rather than a coloured band, plus a brief
     compression at the moment of the tap so the touch is acknowledged even on
     the rows that stay (Settings toggles re-open the sheet in place).
     `press(id)` starts that flash; it decays on its own. */
  const presses = createPresses(reduced);
  let flashId = '';
  let flashT = 0;

  const rowH = 52;
  const pad = SP.gutter;

  function height() {
    const rows = cfg ? cfg.rows.length : 0;
    return 66 + rows * rowH + pad + bottomInset;
  }
  function topY() {
    return H - height() * slide.x;
  }

  const sheet = {
    get isOpen() { return !!cfg; },
    get title() { return cfg ? cfg.title : ''; },
    setInset(v) { bottomInset = v; },

    open(config) { cfg = config; slide.to(1); return sheet; },
    close() { slide.to(0); return sheet; },

    /** acknowledge a tap on a row — see the note on `presses` above */
    press(id) {
      if (!id || id === '__backdrop' || id === '__sheet') return;
      flashId = id; flashT = PRESS.dur * 2.2;
      presses.set(id, true);
    },

    update(dt) {
      slide.step(dt);
      if (flashT > 0) {
        flashT -= dt;
        /* release halfway through, so the row compresses and springs back
           rather than snapping open the instant it is touched */
        if (flashT <= PRESS.dur * 1.1) presses.set(flashId, false);
        if (flashT <= 0) { flashId = ''; presses.clear(); }
      }
      presses.update(dt);
      if (cfg && slide.t === 0 && slide.x < 0.01) cfg = null;
    },

    hit(x, y) {
      if (!cfg || slide.x < 0.35) return null;
      const top = topY();
      if (y < top) return { id: '__backdrop' };
      const y0 = top + 58;
      for (let i = 0; i < cfg.rows.length; i++) {
        const ry = y0 + i * rowH;
        if (y >= ry && y <= ry + rowH) return cfg.rows[i];
      }
      return { id: '__sheet' };
    },

    draw(g) {
      if (!cfg || slide.x < 0.002) return;
      const c = g.ctx;
      const top = topY();
      const a = clamp(slide.x, 0, 1);
      /* backdrop */
      c.save();
      c.fillStyle = SURF.scrim(0.44 * a);
      c.fillRect(0, 0, W, H);
      c.restore();
      /* the panel, with the WARM soft shadow. It had none: a full-width sheet
         with a hairline and no shadow sits ON the room rather than over it, and
         a grey shadow in a room this warm would read as a pasted-on UI element
         (which is the same complaint that produced ui/text.js's warm plates). */
      card(c, 0, top, W, height() + 24, { r: R.lg, fill: PANEL, fade: a });
      c.save();
      /* grabber */
      c.fillStyle = INK.soft(0.30);
      roundRect(c, W / 2 - 20, top + 9, 40, 4, 2); c.fill();
      c.restore();

      drawText(g, cfg.title, {
        ...type('titleMd', { weight: 700 }),
        x: pad + 2, y: top + 36, anchor: 'free', align: 'left',
        ink: INK.heading, over: PANEL,
        maxWidth: W - pad * 2 - 4, fade: a,
      });
      /* THE STITCHED DIVIDER, under the title. The rug in the room is stitched,
         so a dashed rule is the same hand rather than a table border — and it
         separates the title from the rows without the extra weight of a solid
         line across a warm cream panel. */
      stitchedDivider(c, pad, top + 54, W - pad, { fade: a * 0.85 });

      const y0 = top + 58;
      for (let i = 0; i < cfg.rows.length; i++) {
        const r = cfg.rows[i];
        const ry = y0 + i * rowH;
        /* EVERY ROW IS A TACTILE OBJECT NOW: a 4-unit bottom edge instead of a
           flat coloured band. The rows are the pressable controls on this
           surface, and they gave no press feedback at all before. */
        const f = tactile(c, {
          x: pad, y: ry + 4, w: W - pad * 2, h: rowH - 12, r: R.md,
          p: presses.at(r.id), face: ROW, fade: a,
        });
        const cy = ry + 24 + f.dy;
        /* THE ROW IS TWO COLUMNS, and they used to be able to overlap: a long
           note ran straight under the right-hand word with nothing to stop it.
           The label/note column now ends where the status column begins. */
        const rightW = r.right ? 108 : 0;
        const leftW = W - pad * 2 - 32 - rightW;
        drawText(g, r.label, {
          ...type('labelMd', { weight: 700 }),
          x: pad + 16, y: cy + (r.note ? -7 : 0), anchor: 'free',
          align: 'left', ink: INK.body, over: ROW,
          maxWidth: leftW, fade: a,
        });
        if (r.note) {
          drawText(g, r.note, {
            ...type('labelSm', { weight: 500, track: 0 }),
            x: pad + 16, y: cy + 10, anchor: 'free', align: 'left',
            ink: INK.soft(), over: ROW,
            maxWidth: leftW, fade: a,
          });
        }
        /* `right` is the WORD-SCALE status of the need this row serves — the
           care sheet is the original's inspect screen. The words live here as
           well as beside the bubble meters, and that is deliberate: this is the
           surface she is on when she is deciding what to do about it. */
        if (r.right) {
          drawText(g, r.right, {
            ...type('labelMd', { weight: 800 }),
            x: W - pad - 16, y: cy, anchor: 'free', align: 'right',
            ink: INK.heading, over: ROW,
            maxWidth: rightW, fade: a,
          });
        }
      }
    },

    /**
     * The one DOM element in the game. A textarea is the only sane way to
     * hand a long save string to and from the OS keyboard / clipboard.
     */
    promptText({ title, value = '', placeholder = '', readOnly = false, onSubmit }) {
      /* THE ONE PLACE TOKENS HAVE TO REACH INTO CSS STRINGS. The audit found
         colours hardcoded inside these `cssText` templates, which is exactly
         where a token pass stops if it only looks at `fillStyle`. Interpolated
         from ui/tokens.js so the save dialog matches the sheet it came out of.
         The type is the ramp too, via the same steps the canvas uses. */
      const T = type('labelMd', { weight: 700 });
      const host = document.createElement('div');
      host.setAttribute('data-pp-prompt', '');
      host.style.cssText = 'position:fixed;inset:0;z-index:50;display:flex;align-items:center;'
        + `justify-content:center;background:${SURF.scrim(0.55)};padding:${SP.margin}px;`
        + 'font:500 13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
      const box = document.createElement('div');
      box.style.cssText = `background:${SURF.card};border-radius:${R.md}px;padding:${SP.gutter}px;`
        + `width:100%;max-width:330px;box-shadow:0 12px 40px ${SURF.scrim(0.35)};`;
      const h = document.createElement('div');
      h.textContent = title;
      h.style.cssText = `font-weight:700;color:${INK.heading};margin-bottom:10px;`
        + `font-size:${type('titleMd').size}px;`;
      const ta = document.createElement('textarea');
      ta.value = value; ta.placeholder = placeholder; ta.readOnly = readOnly;
      ta.spellcheck = false;
      ta.style.cssText = `width:100%;height:110px;border-radius:${R.sm}px;`
        + `border:1px solid ${SURF.border(0.28)};`
        + `padding:10px;font:500 11px ui-monospace,SFMono-Regular,Menlo,monospace;color:${INK.body};`
        + `background:${SURF.chrome};resize:none;-webkit-user-select:text;user-select:text;`;
      const row = document.createElement('div');
      row.style.cssText = `display:flex;gap:${SP.base}px;margin-top:12px;`;
      const mk = (label, primary) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.style.cssText = `flex:1;padding:11px;border-radius:${R.sm}px;border:0;`
          + `font:${T.weight} ${T.size}px inherit;`
          + (primary ? `background:${SURF.chipWarm};color:${INK.onWarm};`
            : `background:${SURF.row};color:${INK.body};`);
        return b;
      };
      const cancel = mk('Close', false);
      const ok = mk(readOnly ? 'Copy' : 'Load', true);
      const done = () => { host.remove(); };
      cancel.onclick = done;
      ok.onclick = async () => {
        if (readOnly) {
          try { await navigator.clipboard.writeText(ta.value); } catch (e) { ta.select(); }
          if (onSubmit) onSubmit(ta.value);
          done();
        } else {
          if (onSubmit) {
            const res = onSubmit(ta.value);
            /* the one error state in the game: a save code that will not parse */
            if (res === false) { ta.style.borderColor = SURF.error; return; }
          }
          done();
        }
      };
      row.append(cancel, ok);
      box.append(h, ta, row);
      host.append(box);
      /* the prompt must not leak taps into the canvas */
      host.addEventListener('pointerdown', (e) => e.stopPropagation());
      host.addEventListener('touchstart', (e) => e.stopPropagation());
      document.body.append(host);
      if (!readOnly) setTimeout(() => ta.focus(), 30);
      else { ta.select(); }
      return { close: done, el: host };
    },
  };

  return sheet;
}

export default createSheet;
