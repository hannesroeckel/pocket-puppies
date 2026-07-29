/* ==========================================================================
   engine/loop.js — the ONLY requestAnimationFrame in the game.

   Scene contract (architecture §3):
     { id, async enter(app, params), exit(app), update(app, dt, t),
       draw(app, g), pointer(app, ev), resize?(app) }

   dt arrives in SECONDS, already clamped to BALANCE.loop.dtMax (1/30).
   The clamp is not optional: a backgrounded tab hands you a multi-second
   delta and un-clamped springs integrate straight to infinity. That killed
   the 3D spike.
   ========================================================================== */
import BALANCE from '../state/balance.js';

const L = BALANCE.loop;

export function createLoop(app, g) {
  let scene = null;
  let running = false;
  let raf = 0;
  let last = 0;
  let t = 0;               // total simulated seconds
  let frames = 0;

  const work = [];         // ms spent in update+draw
  const interval = [];     // ms between presented frames

  function push(arr, v) {
    arr.push(v);
    if (arr.length > L.statWindow) arr.shift();
  }

  function pct(arr, p) {
    if (!arr.length) return 0;
    const s = arr.slice().sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * p))];
  }

  /** One simulation + draw step at an exact dt. Used by rAF and by tests. */
  function step(dt) {
    dt = Math.min(dt, L.dtMax);
    if (!(dt > 0)) dt = L.dtFallback;
    t += dt;
    frames++;
    const t0 = performance.now();
    if (app.input) app.input.tick(dt);
    if (scene && scene.update) scene.update(app, dt, t);
    if (scene && scene.draw) scene.draw(app, g);
    push(work, performance.now() - t0);
    return dt;
  }

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (!last) { last = now; return; }
    push(interval, now - last);
    const dt = (now - last) / 1000;
    last = now;
    step(dt);
  }

  function onVisibility() {
    if (document.hidden) {
      last = 0;                      // discard the gap
    } else {
      last = 0;
      if (running && !raf) raf = requestAnimationFrame(frame);
    }
  }
  document.addEventListener('visibilitychange', onVisibility);

  const loop = {
    get scene() { return scene; },
    get t() { return t; },
    get frames() { return frames; },

    start() {
      if (running) return;
      running = true; last = 0;
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },

    /** Swap scenes. Awaits the new scene's enter(). */
    async mount(next, params) {
      if (scene && scene.exit) { try { scene.exit(app); } catch (e) { console.error(e); } }
      scene = next;
      if (app.input) app.input.setHandler(next ? (ev) => { if (scene && scene.pointer) scene.pointer(app, ev); } : null);
      if (next && next.enter) await next.enter(app, params || {});
      last = 0;
      return next;
    },

    resize() { if (scene && scene.resize) scene.resize(app); },

    /** Deterministic driver for tests: n fixed steps, no wall clock involved. */
    stepFixed(dt, n = 1) { for (let i = 0; i < n; i++) step(dt); },

    /** Simulation only, no draw. For long behavioural tests (idle variety). */
    stepSim(dt, n = 1) {
      dt = Math.min(dt, L.dtMax);
      if (!(dt > 0)) dt = L.dtFallback;
      for (let i = 0; i < n; i++) {
        t += dt; frames++;
        if (app.input) app.input.tick(dt);
        if (scene && scene.update) scene.update(app, dt, t);
      }
    },

    get stats() {
      return {
        frames,
        workMedian: +pct(work, 0.5).toFixed(2),
        workP95: +pct(work, 0.95).toFixed(2),
        workMax: +(work.length ? Math.max(...work) : 0).toFixed(2),
        frameMedian: +pct(interval, 0.5).toFixed(2),
        frameP95: +pct(interval, 0.95).toFixed(2),
        samples: work.length,
      };
    },
    resetStats() { work.length = 0; interval.length = 0; },
  };

  return loop;
}

export default createLoop;
