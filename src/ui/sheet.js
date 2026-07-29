/* ==========================================================================
   ui/sheet.js — a bottom sheet. Canvas-drawn rows with a spring slide-in,
   plus one small DOM escape hatch (`promptText`) for the save string, which
   genuinely needs a real text field the OS keyboard can talk to.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { clamp, roundRect, smooth } from '../engine/draw.js';
import { Spring } from '../engine/spring.js';

const W = BALANCE.view.W;
const H = BALANCE.view.H;

export function createSheet(opts = {}) {
  const reduced = !!opts.reduced;
  const slide = new Spring(0, reduced ? 90 : 130, reduced ? 20 : 16);
  let cfg = null;
  let bottomInset = 0;

  const rowH = 52;
  const pad = 16;

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

    update(dt) {
      slide.step(dt);
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
      c.save();
      /* backdrop */
      c.fillStyle = `rgba(48,24,12,${(0.44 * a).toFixed(3)})`;
      c.fillRect(0, 0, W, H);
      /* panel */
      c.fillStyle = '#fdf3df';
      roundRect(c, 0, top, W, height() + 24, 22); c.fill();
      c.strokeStyle = 'rgba(124,74,47,0.18)'; c.lineWidth = 1.2;
      roundRect(c, 0, top, W, height() + 24, 22); c.stroke();
      /* grabber */
      c.fillStyle = 'rgba(124,74,47,0.26)';
      roundRect(c, W / 2 - 20, top + 9, 40, 4, 2); c.fill();
      /* title */
      c.fillStyle = '#5d3018';
      c.textAlign = 'left'; c.textBaseline = 'middle';
      c.font = '700 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      c.fillText(cfg.title, pad + 2, top + 34);
      /* rows */
      const y0 = top + 58;
      for (let i = 0; i < cfg.rows.length; i++) {
        const r = cfg.rows[i];
        const ry = y0 + i * rowH;
        c.fillStyle = 'rgba(233,149,79,0.10)';
        roundRect(c, pad, ry + 4, W - pad * 2, rowH - 8, 13); c.fill();
        c.textAlign = 'left';
        c.fillStyle = '#5d3018';
        c.font = '600 13.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        c.fillText(r.label, pad + 16, ry + (r.note ? rowH / 2 - 7 : rowH / 2));
        if (r.note) {
          c.fillStyle = 'rgba(93,48,24,0.62)';
          c.font = '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
          c.fillText(r.note, pad + 16, ry + rowH / 2 + 9);
        }
        /* `right` is the WORD-SCALE status of the need this row serves — the
           care sheet is the original's inspect screen. Words, never bars. */
        if (r.right) {
          c.textAlign = 'right';
          c.fillStyle = 'rgba(93,48,24,0.86)';
          c.font = '700 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
          c.fillText(r.right, W - pad - 16, ry + rowH / 2);
          c.textAlign = 'left';
        }
      }
      c.restore();
    },

    /**
     * The one DOM element in the game. A textarea is the only sane way to
     * hand a long save string to and from the OS keyboard / clipboard.
     */
    promptText({ title, value = '', placeholder = '', readOnly = false, onSubmit }) {
      const host = document.createElement('div');
      host.setAttribute('data-pp-prompt', '');
      host.style.cssText = 'position:fixed;inset:0;z-index:50;display:flex;align-items:center;'
        + 'justify-content:center;background:rgba(48,24,12,.55);padding:22px;'
        + 'font:500 13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
      const card = document.createElement('div');
      card.style.cssText = 'background:#fdf3df;border-radius:18px;padding:16px;width:100%;'
        + 'max-width:330px;box-shadow:0 12px 40px rgba(48,24,12,.35);';
      const h = document.createElement('div');
      h.textContent = title;
      h.style.cssText = 'font-weight:700;color:#5d3018;margin-bottom:10px;font-size:15px;';
      const ta = document.createElement('textarea');
      ta.value = value; ta.placeholder = placeholder; ta.readOnly = readOnly;
      ta.spellcheck = false;
      ta.style.cssText = 'width:100%;height:110px;border-radius:12px;border:1px solid rgba(124,74,47,.28);'
        + 'padding:10px;font:500 11px ui-monospace,SFMono-Regular,Menlo,monospace;color:#4a2a14;'
        + 'background:#fffaf0;resize:none;-webkit-user-select:text;user-select:text;';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;margin-top:12px;';
      const mk = (label, primary) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.style.cssText = 'flex:1;padding:11px;border-radius:12px;border:0;font:700 13px inherit;'
          + (primary ? 'background:#e9954f;color:#3a1c0c;' : 'background:rgba(124,74,47,.12);color:#5d3018;');
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
            if (res === false) { ta.style.borderColor = '#d9707d'; return; }
          }
          done();
        }
      };
      row.append(cancel, ok);
      card.append(h, ta, row);
      host.append(card);
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
