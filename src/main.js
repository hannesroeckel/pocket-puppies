/* ==========================================================================
   main.js — boot: load the save, apply elapsed-time decay, install the loop,
   mount the first scene.

   `app` is the object every scene receives:
     { game, input, audio, nav, canvas, ctx, dpr, reduced, view }
   ========================================================================== */
import BALANCE from './state/balance.js';
import { clamp, createG } from './engine/draw.js';
import { createLoop } from './engine/loop.js';
import { createInput } from './engine/input.js';
import { createAudio } from './engine/audio.js';
import { rng } from './engine/rng.js';
import { createGame, newState } from './state/game.js';
import { load, createSaver, requestPersistence, isStandalone, exportSave, importSave, writeNow, clear as clearSave } from './state/save.js';
import { applyElapsed, timeOfDay } from './state/time.js';
import { createRoomScene } from './scenes/room.js';

const V = BALANCE.view;

/* ---- canvas + view ---------------------------------------------------- */
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d', { alpha: false });

const view = {
  cw: 0, ch: 0, cssW: 0, cssH: 0, dpr: 1, vs: 1, offX: 0, offY: 0,
  bleedX: 0, bleedY: 0,
  safe: { top: 0, right: 0, bottom: 0, left: 0 },
};

function readSafeArea() {
  const p = document.getElementById('safeprobe');
  if (!p) return;
  const s = getComputedStyle(p);
  view.safe.top = parseFloat(s.paddingTop) || 0;
  view.safe.bottom = parseFloat(s.paddingBottom) || 0;
  view.safe.left = parseFloat(s.paddingLeft) || 0;
  view.safe.right = parseFloat(s.paddingRight) || 0;
}

function resize() {
  view.cssW = Math.max(1, window.innerWidth);
  view.cssH = Math.max(1, window.innerHeight);
  view.dpr = clamp(window.devicePixelRatio || 1, V.dprMin, V.dprMax);
  view.cw = Math.round(view.cssW * view.dpr);
  view.ch = Math.round(view.cssH * view.dpr);
  canvas.width = view.cw;
  canvas.height = view.ch;
  canvas.style.width = view.cssW + 'px';
  canvas.style.height = view.cssH + 'px';
  view.vs = Math.min(view.cssW / V.W, view.cssH / V.H);
  view.offX = (view.cssW - V.W * view.vs) / 2;
  view.offY = (view.cssH - V.H * view.vs) / 2;
  view.bleedX = view.offX / view.vs + 3;
  view.bleedY = view.offY / view.vs + 3;
  readSafeArea();
}

/* ---- reduced motion --------------------------------------------------- */
function resolveReduced(settings) {
  if (settings && settings.reducedMotion === 'on') return true;
  if (settings && settings.reducedMotion === 'off') return false;
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch (e) { return false; }
}

/* ---- boot ------------------------------------------------------------- */
async function boot() {
  resize();

  const loaded = load();
  const fresh = !loaded;
  const state = loaded || newState(Date.now(), { rng });

  const saver = createSaver(() => state);
  const game = createGame(state, { onChange: () => saver.schedule() });

  /* elapsed-time decay runs BEFORE the first frame */
  const elapsed = applyElapsed(game, Date.now());

  const reduced = resolveReduced(state.settings);
  const audio = createAudio(state.settings);
  const g = createG(ctx, view);

  /* scene registry — stages 2..6 register their scenes here */
  const scenes = { room: createRoomScene() };
  /* Installed to the Home Screen? iOS ITP exempts installed web apps from the
     7-day storage sweep, so this flag is a data-integrity signal, not a growth
     metric. Surfaced only — a later stage explains it to the player. */
  const standalone = isStandalone();

  const app = {
    game, audio, canvas, ctx, view, reduced, g, standalone,
    get dpr() { return view.dpr; },
    input: null, nav: null, loop: null,
    /** false is the expected answer on iOS; nothing may depend on it */
    storagePersisted: false,
    elapsed, timeOfDay: timeOfDay(),
    scenes,
  };

  const loop = createLoop(app, g);
  app.loop = loop;

  app.nav = {
    has(id) { return !!scenes[id]; },
    register(id, scene) { scenes[id] = scene; },
    /** returns false if the scene isn't built yet — the caller toasts */
    go(id, params) {
      const s = scenes[id];
      if (!s) return false;
      loop.mount(s, params);
      return true;
    },
    get current() { return loop.scene ? loop.scene.id : ''; },
  };

  const input = createInput(canvas, view);
  app.input = input;
  input.onFirstGesture(() => {
    audio.unlock();
    /* fire-and-forget; a false result is normal on iOS and must not warn */
    requestPersistence().then((ok) => { app.storagePersisted = ok; });
  });

  window.addEventListener('resize', () => { resize(); loop.resize(); });
  window.addEventListener('orientationchange', () => setTimeout(() => { resize(); loop.resize(); }, 120));

  if (fresh) game.log('born', 'came home');
  await loop.mount(scenes.room, { reunion: elapsed.reunion && !fresh });
  loop.start();
  saver.schedule();

  /* ---- dev / verification hook -------------------------------------
     Deterministic drivers on purpose: animation is verified by STEPPING
     the sim, never by sleeping and hoping. */
  window.__pp = {
    version: 1,
    app, loop, view, saver, BALANCE,
    get reduced() { return reduced; },
    get standalone() { return standalone; },
    get elapsed() { return elapsed; },
    get state() { return state; },
    dbg: () => (loop.scene && loop.scene.debug) || null,
    stats: () => loop.stats,
    resetStats: () => loop.resetStats(),
    /** advance the simulation by exactly n steps of dt seconds */
    step: (dt = 1 / 60, n = 1) => { loop.stepFixed(dt, n); return loop.scene.debug; },
    /** simulation only, no draw — for long behavioural tests */
    stepSim: (dt = 1 / 60, n = 1) => { loop.stepSim(dt, n); return loop.scene.debug; },
    /** synthetic stroke over a named zone, stepped deterministically */
    stroke({ zone = 'back', amp = 26, steps = 36, dt = 1 / 60, wobble = 6 } = {}) {
      const scene = loop.scene;
      const d = scene.debug;
      const z = d.zones.find((q) => q.id === zone);
      if (!z) throw new Error('no zone ' + zone);
      /* keep the sweep inside the zone, or the stroke wanders into its
         neighbours and the result measures the wrong zone */
      amp = Math.min(amp, z.r * scene.rig.s * 0.5);
      const rig = scene.rig;
      const toV = (lx, ly) => ({ x: rig.x + lx * rig.s, y: rig.y + ly * rig.s });
      const send = (type, v, moved) => {
        input.state.lastX = v.x; input.state.lastY = v.y;
        scene.pointer(app, { type, x: v.x, y: v.y, id: 1, dx: 0, dy: 0, speed: 0, dist: 0, moved: !!moved });
      };
      send('down', toV(z.x - amp / rig.s, z.y));
      loop.stepFixed(dt, 1);
      for (let i = 0; i < steps; i++) {
        const u = i / (steps - 1);
        const sweep = Math.sin(u * Math.PI * 2) * amp;
        const v = toV(z.x + sweep / rig.s, z.y + Math.sin(u * Math.PI * 4) * wobble / rig.s);
        send('move', v, true);
        loop.stepFixed(dt, 1);
      }
      send('up', toV(z.x, z.y), true);
      loop.stepFixed(dt, 1);
      return scene.debug;
    },
    /** single tap on a zone */
    tap({ zone = 'muz', dt = 1 / 60 } = {}) {
      const scene = loop.scene;
      const z = scene.debug.zones.find((q) => q.id === zone);
      const rig = scene.rig;
      const v = { x: rig.x + z.x * rig.s, y: rig.y + z.y * rig.s };
      scene.pointer(app, { type: 'down', x: v.x, y: v.y, id: 1, dx: 0, dy: 0, speed: 0, dist: 0, moved: false });
      loop.stepFixed(dt, 2);
      scene.pointer(app, { type: 'up', x: v.x, y: v.y, id: 1, dx: 0, dy: 0, speed: 0, dist: 0, moved: false });
      loop.stepFixed(dt, 2);
      return scene.debug;
    },
    exportSave: () => exportSave(state),
    importSave: (s) => importSave(s),
    saveNow: () => saver.flush(),
    wipe: () => clearSave(),
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
