/* ==========================================================================
   engine/input.js — pointer normalisation, gesture disambiguation, stroke
   tracking. Scenes NEVER bind window listeners; they receive normalised
   events through `scene.pointer(app, ev)`.

   Event shape (contract §3):
     { type:'down'|'move'|'up'|'cancel'|'tap', x, y, id, dx, dy, speed, dist, moved, held }
   x/y are VIRTUAL design-space coordinates (390x844), not CSS pixels.
   ========================================================================== */
import BALANCE from '../state/balance.js';

export function createInput(canvas, view) {
  const state = {
    down: false, id: -1,
    x: 0, y: 0, px: 0, py: 0,
    dx: 0, dy: 0, speed: 0,
    dist: 0, downT: 0, moved: false,
    /* last position even after release, for hand-glow fadeout */
    lastX: 0, lastY: 0,
  };

  let handler = null;
  let firstGesture = null;

  function toVirtual(cx, cy) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (cx - r.left - view.offX) / view.vs,
      y: (cy - r.top - view.offY) / view.vs,
    };
  }

  function emit(type, extra) {
    if (!handler) return;
    handler({
      type,
      x: state.x, y: state.y, id: state.id,
      dx: state.dx, dy: state.dy, speed: state.speed,
      dist: state.dist, moved: state.moved, held: state.downT,
      ...extra,
    });
  }

  function onDown(ev) {
    if (state.down) return;
    if (firstGesture) { const f = firstGesture; firstGesture = null; try { f(); } catch (e) { /* ignore */ } }
    const v = toVirtual(ev.clientX, ev.clientY);
    state.down = true; state.id = ev.pointerId;
    state.x = state.px = state.lastX = v.x;
    state.y = state.py = state.lastY = v.y;
    state.dx = state.dy = state.speed = 0;
    state.dist = 0; state.downT = 0; state.moved = false;
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    emit('down');
    if (ev.cancelable) ev.preventDefault();
  }

  function onMove(ev) {
    if (!state.down || ev.pointerId !== state.id) return;
    const v = toVirtual(ev.clientX, ev.clientY);
    state.px = state.x; state.py = state.y;
    state.dx = v.x - state.px; state.dy = v.y - state.py;
    state.x = state.lastX = v.x; state.y = state.lastY = v.y;
    const seg = Math.hypot(state.dx, state.dy);
    state.dist += seg;
    state.speed = seg;
    if (state.dist > BALANCE.pet.tapMoveSlop) state.moved = true;
    emit('move');
    if (ev.cancelable) ev.preventDefault();
  }

  function onUp(ev) {
    const cancel = ev.type === 'pointercancel';
    if (!state.down || (ev.pointerId !== state.id && !cancel)) return;
    const wasTap = !state.moved;
    state.down = false;
    try { canvas.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    emit(cancel ? 'cancel' : 'up');
    if (!cancel && wasTap) emit('tap');
    state.id = -1;
    state.dx = state.dy = state.speed = 0;
    if (ev.cancelable && ev.preventDefault) ev.preventDefault();
  }

  function onLostCapture() {
    if (state.down) { state.down = false; state.id = -1; emit('cancel'); }
  }

  const stop = (e) => { if (e.cancelable) e.preventDefault(); };
  const passiveOff = { passive: false };

  canvas.addEventListener('pointerdown', onDown, passiveOff);
  canvas.addEventListener('pointermove', onMove, passiveOff);
  canvas.addEventListener('pointerup', onUp, passiveOff);
  canvas.addEventListener('pointercancel', onUp, passiveOff);
  canvas.addEventListener('lostpointercapture', onLostCapture);
  /* kill scroll / pinch-zoom / double-tap-zoom / pull-to-refresh / long-press menu */
  const docEvents = ['touchstart', 'touchmove', 'touchend', 'gesturestart', 'gesturechange', 'dblclick', 'contextmenu'];
  for (const t of docEvents) document.addEventListener(t, stop, passiveOff);

  return {
    state,
    /** the loop points this at the active scene */
    setHandler(fn) { handler = fn; },
    /** run `fn` on the next real user gesture (audio unlock, storage.persist) */
    onFirstGesture(fn) { firstGesture = fn; },
    /** seconds ticked by the loop so `held` is meaningful */
    tick(dt) { if (state.down) state.downT += dt; },
    destroy() {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('lostpointercapture', onLostCapture);
      for (const t of docEvents) document.removeEventListener(t, stop);
      handler = null;
    },
  };
}

export default createInput;
