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
    version: 4,
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
    /* ---- stage 2 drivers ---------------------------------------------
       Every one of these advances the sim deterministically. Nothing in the
       verification path sleeps and hopes. */
    /** run a care action: kind = 'feed'|'water'|'wash'|'brush' */
    care(kind) { return loop.scene.startCare ? loop.scene.startCare(kind) : false; },
    stopCare() { if (loop.scene.stopCare) loop.scene.stopCare(); },
    /** drag a care prop: a synthetic press-move-release in virtual space */
    drag({ from, to, steps = 14, dt = 1 / 60, hold = 0 } = {}) {
      const scene = loop.scene;
      const send = (type, x, y, moved) => {
        input.state.lastX = x; input.state.lastY = y;
        scene.pointer(app, { type, x, y, id: 1, dx: 0, dy: 0, speed: 0, dist: 0, moved: !!moved });
      };
      send('down', from[0], from[1], false);
      loop.stepFixed(dt, 1);
      for (let i = 1; i <= steps; i++) {
        const u = i / steps;
        send('move', from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u, true);
        loop.stepFixed(dt, 1);
      }
      if (hold > 0) {
        /* keep holding at the destination — this is how pouring works */
        const n = Math.round(hold / dt);
        for (let i = 0; i < n; i++) {
          send('move', to[0] + (i % 2 ? 0.4 : -0.4), to[1], true);
          loop.stepFixed(dt, 1);
        }
      }
      send('up', to[0], to[1], true);
      loop.stepFixed(dt, 1);
      return loop.scene.debug;
    },
    /** a flick: like drag, but the release velocity is what matters */
    flick({ from, to, steps = 6, dt = 1 / 120 } = {}) {
      const scene = loop.scene;
      const send = (type, x, y, moved) => {
        input.state.lastX = x; input.state.lastY = y;
        scene.pointer(app, { type, x, y, id: 1, dx: 0, dy: 0, speed: 0, dist: 0, moved: !!moved });
      };
      send('down', from[0], from[1], false);
      loop.stepFixed(dt, 1);
      for (let i = 1; i <= steps; i++) {
        const u = i / steps;
        send('move', from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u, true);
        loop.stepFixed(dt, 1);
      }
      send('up', to[0], to[1], true);
      loop.stepFixed(dt, 1);
      return loop.scene.debug;
    },
    /**
     * Close the first-launch naming beat deterministically. It owns the whole
     * surface for a few seconds after a name is submitted (the reveal hold),
     * so anything that pokes the room before it has finished is silently
     * swallowed — which cost an hour of stage-3 verification before this
     * existed. Always call it before driving the room.
     */
    skipIntro(name = 'Pip') {
      const sc = loop.scene;
      if (sc.naming && sc.naming.isOpen) sc.naming.submit(name);
      if (!game.isNamed) game.setName(name);
      if (sc.naming) sc.naming.close();
      loop.stepFixed(1 / 60, 4);
      return { named: game.isNamed, name: game.dog.name, naming: sc.naming ? sc.naming.debug : null };
    },

    /* ---- stage 3 drivers: TRAINING ------------------------------------
       Every one of these steps the simulation deterministically. Nothing here
       sleeps and hopes — animation and learning are verified by driving the
       clock, which is how every real bug on this project was caught. */
    /** enter / leave training mode */
    train(on = true) {
      const sc = loop.scene;
      if (!sc.startTrain) return false;
      if (on) { const r = sc.startTrain(); loop.stepFixed(1 / 60, 2); return r; }
      sc.stopTrain(); loop.stepFixed(1 / 60, 2); return true;
    },
    /** the trick ledger + what she thinks each signal means */
    tricks() {
      const d = loop.scene.debug;
      return d && d.train ? { tricks: d.train.tricks, cues: d.train.cues, known: d.train.known } : null;
    },
    /**
     * DRAW a hand signal for real, in the pad, as a synthetic pointer path —
     * so the gesture recogniser is exercised rather than bypassed.
     * @param sig  'tap'|'double'|'hold'|'up'|'down'|'left'|'right'|'circle'
     * @param sloppy 0..1 — how badly drawn. 0 is crisp; high values are what
     *   let her misread it, which is the tap path's own authentic mis-hearing.
     */
    signal(sig, { sloppy = 0, dt = 1 / 60 } = {}) {
      const scene = loop.scene;
      const B = BALANCE.train;
      const cx = 195, cy = (B.pad.top + B.pad.bottom) / 2;
      const send = (type, x, y, moved) => {
        input.state.lastX = x; input.state.lastY = y;
        scene.pointer(app, { type, x, y, id: 1, dx: 0, dy: 0, speed: 0, dist: 0, moved: !!moved });
      };
      const wob = () => (Math.random() - 0.5) * 26 * sloppy;
      const path = [];
      const L = B.signal.minSwipe * 1.9;
      if (sig === 'tap' || sig === 'double') path.push([cx, cy]);
      else if (sig === 'hold') path.push([cx, cy]);
      else if (sig === 'up') for (let i = 0; i <= 10; i++) path.push([cx + wob(), cy + L / 2 - (L * i) / 10]);
      else if (sig === 'down') for (let i = 0; i <= 10; i++) path.push([cx + wob(), cy - L / 2 + (L * i) / 10]);
      else if (sig === 'left') for (let i = 0; i <= 10; i++) path.push([cx + L / 2 - (L * i) / 10, cy + wob()]);
      else if (sig === 'right') for (let i = 0; i <= 10; i++) path.push([cx - L / 2 + (L * i) / 10, cy + wob()]);
      else if (sig === 'circle') {
        const turns = 1 - 0.30 * sloppy;      // a lazy circle is an arc
        for (let i = 0; i <= 22; i++) {
          const th = (i / 22) * Math.PI * 2 * turns;
          path.push([cx + Math.cos(th) * 34, cy + Math.sin(th) * 26]);
        }
      }
      send('down', path[0][0], path[0][1], false);
      loop.stepFixed(dt, 1);
      /* a double-tap is two taps inside the window; a hold is one long press */
      if (sig === 'hold') loop.stepFixed(dt, Math.ceil((BALANCE.train.signal.holdDur + 0.1) / dt));
      for (let i = 1; i < path.length; i++) {
        send('move', path[i][0], path[i][1], true);
        loop.stepFixed(dt, 1);
      }
      send('up', path[path.length - 1][0], path[path.length - 1][1], sig !== 'tap' && sig !== 'double' && sig !== 'hold');
      loop.stepFixed(dt, 1);
      if (sig === 'double') {
        send('down', cx, cy, false);
        loop.stepFixed(dt, 1);
        send('up', cx, cy, false);
        loop.stepFixed(dt, 1);
      }
      return loop.scene.debug.train.cue;
    },
    /** deliver a signal straight to the layer (for high-N statistical runs) */
    cue(sig, conf = 1) {
      const t = loop.scene.train;
      if (!t) return null;
      t.injectSignal(sig, conf);
      loop.stepFixed(1 / 60, 1);
      return loop.scene.debug.train;
    },
    /**
     * GUIDE her into a trick with a real gesture on her body, so the guide
     * recogniser is exercised. Falls back to the direct injection for tricks
     * whose gesture needs a posture she is not in.
     */
    guide(trick, { dt = 1 / 60, direct = false } = {}) {
      const scene = loop.scene;
      const t = scene.train;
      if (!t) return null;
      if (direct) { t.injectGuide(trick); loop.stepFixed(dt, 1); return scene.debug.train; }
      const rig = scene.rig, pet = scene.pet;
      const toV = (lx, ly) => ({ x: rig.x + lx * rig.s, y: rig.y + ly * rig.s * (rig.sy || 1) });
      const send = (type, v, moved) => {
        input.state.lastX = v.x; input.state.lastY = v.y;
        scene.pointer(app, { type, x: v.x, y: v.y, id: 1, dx: 0, dy: 0, speed: 0, dist: 0, moved: !!moved });
      };
      const head = pet.anchor('head'), body = pet.anchor('body'), muz = pet.anchor('muz');
      const G = BALANCE.train.guide;
      let pts = [];
      let taps = 0, hold = 0;
      if (trick === 'sit' || trick === 'lieDown') {
        for (let i = 0; i <= 12; i++) {
          pts.push(toV(head.x, head.y - head.hy * 0.5 + (head.hy * 1.15) * (i / 12)));
        }
      } else if (trick === 'beg') {
        for (let i = 0; i <= 12; i++) {
          const u = i / 12;
          pts.push(toV(body.x, body.y + body.hy * 0.6 - (body.hy * 0.6 - (muz.y + 6)) * u));
        }
      } else if (trick === 'shake') {
        /* a paw, wiggled up and down: reversals are what identify it */
        const px = body.x + body.hx * 0.42;
        for (let i = 0; i <= 24; i++) {
          pts.push(toV(px, -6 + Math.sin((i / 24) * Math.PI * 4) * 14));
        }
      } else if (trick === 'spin') {
        for (let i = 0; i <= 24; i++) {
          const th = (i / 24) * Math.PI * 2;
          pts.push(toV(body.x + Math.cos(th) * 30, 12 + Math.sin(th) * 12));
        }
      } else if (trick === 'jump') {
        taps = BALANCE.train.guide.tapsFor;
        pts = [toV(head.x, head.y - head.hy * 1.5)];
      } else if (trick === 'rollOver') {
        for (let i = 0; i <= 14; i++) {
          pts.push(toV(body.x - body.hx * 0.7 + (body.hx * 1.4) * (i / 14), body.y + body.hy * 0.5));
        }
      } else if (trick === 'playDead') {
        hold = G.holdFor + 0.12;
        pts = [toV(body.x + body.hx * 0.3, body.y + body.hy * 0.55)];
      }
      if (taps) {
        for (let k = 0; k < taps; k++) {
          send('down', pts[0], false); loop.stepFixed(dt, 1);
          send('up', pts[0], false); loop.stepFixed(dt, 2);
        }
      } else if (hold) {
        send('down', pts[0], false);
        loop.stepFixed(dt, Math.ceil(hold / dt));
        send('up', pts[0], false);
        loop.stepFixed(dt, 1);
      } else {
        send('down', pts[0], false);
        loop.stepFixed(dt, 1);
        for (let i = 1; i < pts.length; i++) { send('move', pts[i], true); loop.stepFixed(dt, 1); }
        send('up', pts[pts.length - 1], true);
        loop.stepFixed(dt, 1);
      }
      return loop.scene.debug.train;
    },
    /** tap her to hand over the treat (only lands inside the reward window) */
    reward() {
      const t = loop.scene.train;
      if (!t) return false;
      const ok = t.injectReward();
      loop.stepFixed(1 / 60, 2);
      return ok;
    },
    /**
     * ONE WHOLE TEACHING REP, deterministically: signal, wait, guide, wait,
     * reward. `delay` is the seconds between the pose landing and the treat —
     * which is how "reward timing matters" gets measured rather than asserted.
     */
    teach(trick, { signal = 'down', delay = 0.15, gap = 0.25, sloppy = 0, dt = 1 / 60, reward = true } = {}) {
      const t = loop.scene.train;
      if (!t) return null;
      __pp.signal(signal, { sloppy, dt });
      loop.stepFixed(dt, Math.max(1, Math.round(gap / dt)));
      __pp.guide(trick);
      /* step until the pose lands (bounded — never an open-ended wait) */
      let guard = 0;
      while (guard++ < 600) {
        const p = t.performance;
        if (p && p.reached) break;
        loop.stepFixed(dt, 1);
      }
      loop.stepFixed(dt, Math.max(0, Math.round(delay / dt)));
      if (reward) __pp.reward();
      /* let the lesson land */
      guard = 0;
      while (guard++ < 600) {
        const p = t.performance;
        if (!p || p.done) break;
        loop.stepFixed(dt, 1);
      }
      loop.stepFixed(dt, 4);
      return loop.scene.debug.train;
    },
    /**
     * Ask for a trick and run it to completion, returning what a contest judge
     * would score: outcome, latency (cue -> pose), correctness and hold.
     */
    ask(sig, { dt = 1 / 60, max = 12 } = {}) {
      const t = loop.scene.train;
      if (!t) return null;
      let result = null;
      const off = t.onPerform((r) => { if (!result) result = r; });
      t.injectSignal(sig, 1);
      let guard = 0;
      while (guard++ < Math.round(max / dt)) {
        loop.stepFixed(dt, 1);
        if (result) break;
      }
      off();
      return result;
    },
    /**
     * Ask, and advance with `stepSim` (simulation only, NO DRAW) instead of
     * `stepFixed`. Behaviourally identical for everything training does — the
     * pose pipeline, the obedience roll and the reward window all live in
     * update() — but roughly 15x cheaper, which is what makes high-N
     * statistical runs (mood gating, mis-association rates) practical.
     * Use `ask()` when a screenshot matters; this when only the numbers do.
     */
    askSim(sig, { dt = 1 / 60, max = 10 } = {}) {
      const t = loop.scene.train;
      if (!t) return null;
      let result = null;
      const off = t.onPerform((r) => { if (!result) result = r; });
      t.injectSignal(sig, 1);
      const n = Math.round(max / dt);
      for (let i = 0; i < n && !result; i++) loop.stepSim(dt, 1);
      off();
      return result;
    },
    /** stage 5's entry point: ask by trick id, judged (no treat, no hints) */
    perform(trick, { dt = 1 / 60, max = 12, judged = true, force = false } = {}) {
      const t = loop.scene.train;
      if (!t) return null;
      let result = null;
      const off = t.onPerform((r) => { if (!result) result = r; });
      const p = t.perform(trick, { judged, force });
      let guard = 0;
      while (guard++ < Math.round(max / dt)) {
        loop.stepFixed(dt, 1);
        if (result) break;
      }
      off();
      return result || (p ? { ignored: false, pending: true } : { outcome: 'ignore' });
    },
    /** the obedience model at the current mood/trust, without rolling it */
    chance(trick) {
      const t = loop.scene.train;
      return t ? t.chanceOf(trick) : null;
    },
    repertoire() {
      const t = loop.scene.train;
      return t ? t.repertoire() : null;
    },
    /** set the two gates directly, to measure what they actually do */
    setMood(v) { game.setMood(v); return game.moodLevel; },
    setTrust(v) { game.addTrust(v - game.dog.trust); return game.dog.trust; },
    /* ---- voice: verifiable with no microphone and no network ----------
       Recognition is single-shot and gesture-triggered, so there is nothing
       ambient to drive. `say()` feeds a transcript straight in, which is the
       whole path minus the recogniser itself; `voiceFail()` exercises each
       degrade branch explicitly. */
    voiceState() {
      const v = loop.scene.voice;
      return v ? v.debug : null;
    },
    /** opt in / out. Never prompts — the prompt belongs to the call gesture. */
    voiceOn(on = true) {
      const v = loop.scene.voice;
      if (!v) return false;
      v.arm(on);
      game.setSetting('mic', !!(on && v.armed));
      return { armed: v.armed, state: v.state };
    },
    voiceOff() { return __pp.voiceOn(false); },
    /** press "call him" for real, as a pointer event in the training overlay */
    callHim() {
      const B = BALANCE.train.voice.button;
      const scene = loop.scene;
      scene.pointer(app, { type: 'down', x: B.x, y: B.y, id: 1, dx: 0, dy: 0, speed: 0, dist: 0, moved: false });
      scene.pointer(app, { type: 'up', x: B.x, y: B.y, id: 1, dx: 0, dy: 0, speed: 0, dist: 0, moved: false });
      loop.stepFixed(1 / 60, 2);
      return loop.scene.voice ? loop.scene.voice.debug : null;
    },
    /** he hears this transcript. Returns what he made of it. */
    say(text) {
      const t = loop.scene.train;
      if (!t) return null;
      const r = t.heard(text);
      loop.stepFixed(1 / 60, 2);
      return r;
    },
    /** force a terminal voice state: 'denied'|'offline'|'error'|'quiet'|'unavailable' */
    voiceFail(reason) {
      const v = loop.scene.voice;
      if (!v) return null;
      v.simulate(reason);
      loop.stepFixed(1 / 60, 2);
      return v.debug;
    },

    /* ---- stage 4 drivers: WALKS ---------------------------------------
       Every one of these is deterministic. In particular NOTHING here sleeps
       to wait out a walk: a walk's progress is a pure function of
       `startedAt`, so the way to test it is to REWRITE `startedAt` and ask
       again — which is also exactly what happens when iOS suspends the app
       and she comes back later. */
    /** open the leash beat */
    walk(on = true) {
      const sc = loop.scene;
      if (!sc.startWalk) return false;
      if (on) { const r = sc.startWalk(); loop.stepFixed(1 / 60, 2); return r; }
      sc.stopWalk(); loop.stepFixed(1 / 60, 2); return true;
    },
    /** wind the anticipation up without waggling anything, for screenshots */
    fizz(v = 1, steps = 24) {
      const w = loop.scene.walk;
      if (!w) return null;
      w.setFizz(v);
      loop.stepFixed(1 / 60, steps);
      return w.debug;
    },
    /** waggle the leash for real, as a synthetic pointer path in the room */
    waggle({ reps = 3, dt = 1 / 60 } = {}) {
      const scene = loop.scene;
      const w = scene.walk;
      if (!w) return null;
      const P4 = BALANCE.walk.prep;
      const send = (type, x, y, moved) => {
        input.state.lastX = x; input.state.lastY = y;
        scene.pointer(app, { type, x, y, id: 1, dx: 0, dy: 0, speed: 0, dist: 0, moved: !!moved });
      };
      const [x0, y0] = [w.debug.leash[0], w.debug.leash[1]];
      send('down', x0, y0, false);
      loop.stepFixed(dt, 1);
      for (let r = 0; r < reps; r++) {
        for (let i = 0; i <= 12; i++) {
          const u = i / 12;
          send('move', x0 + Math.sin(u * Math.PI * 2) * 56, y0 + Math.sin(u * Math.PI * 4) * 26, true);
          loop.stepFixed(dt, 1);
        }
      }
      send('up', x0, y0, true);
      loop.stepFixed(dt, 1);
      return w.debug;
    },
    /** clip the lead on (the same call the drop and the tap both make) */
    clip() {
      const w = loop.scene.walk;
      if (!w) return null;
      w.clipItOn();
      loop.stepFixed(1 / 60, Math.ceil((BALANCE.walk.prep.clipHold + 0.1) * 60));
      return w.debug;
    },
    /** the route map: pick a place, or hand it a drawn path */
    route(id) {
      const w = loop.scene.walk;
      if (!w) return null;
      w.map.pick(id);
      loop.stepFixed(1 / 60, 2);
      return w.map.debug;
    },
    drawRoute(pts) {
      const w = loop.scene.walk;
      if (!w) return null;
      w.map.setPath(pts);
      loop.stepFixed(1 / 60, 2);
      return w.map.debug;
    },
    /** set off. `dur` in seconds; omit to use whatever the map worked out. */
    setOff(mix, dur) {
      const w = loop.scene.walk;
      if (!w) return null;
      const m = mix || w.map.mix;
      const a = w.setOff(m, dur === undefined ? w.map.dur : dur, w.map.path);
      loop.stepFixed(1 / 60, 2);
      return a;
    },
    /**
     * PRETEND THE APP WAS CLOSED FOR `mins` MINUTES MID-WALK. Rewinds the
     * walk's `startedAt` (and `lastSeenAt`) rather than sleeping, which is the
     * only honest way to test a model whose whole point is that it does not
     * tick. Returns the derived progress.
     */
    fakeWalkAway(mins = 4) {
      const w = state.walks && state.walks.active;
      if (!w) return null;
      w.startedAt -= mins * 60e3;
      state.lastSeenAt = Date.now() - mins * 60e3;
      /* MARK IT DIRTY. These drivers write `state` directly rather than through
         a mutator, so `onChange` never fires and a following `saveNow()` is a
         silent no-op — which made a reload test pass for the wrong reason
         until it was caught. Anything that fakes elapsed time must schedule. */
      saver.schedule();
      loop.stepFixed(1 / 60, 2);
      return game.walkProgress();
    },
    /** move the device clock BACKWARDS: the tamper guard must absorb it */
    fakeClockBack(mins = 30) {
      const w = state.walks && state.walks.active;
      if (!w) return null;
      w.startedAt += mins * 60e3;      // i.e. "started in the future"
      saver.schedule();
      const before = { startedAt: w.startedAt };
      const p = game.walkProgress();
      loop.stepFixed(1 / 60, 2);
      return { before, after: state.walks.active ? state.walks.active.startedAt : null, progress: p };
    },
    /** bring him home now (the always-available, never-penalised path) */
    bringHome() {
      const w = loop.scene.walk;
      if (!w) return null;
      w.bringHome();
      loop.stepFixed(1 / 60, 2);
      return w.debug;
    },
    /** run the whole return beat to its end */
    runHome({ dt = 1 / 60, sim = false } = {}) {
      const w = loop.scene.walk;
      if (!w) return null;
      const n = Math.ceil((BALANCE.walk.home.beats.settle + 0.4) / dt);
      for (let i = 0; i < n && w.beat === 'home'; i++) {
        if (sim) loop.stepSim(dt, 1); else loop.stepFixed(dt, 1);
      }
      return w.debug;
    },
    /** what he WOULD bring home, without moving anything */
    peekFinds(progress) { return game.walkFinds(progress); },
    walkState() { return loop.scene.walk ? loop.scene.walk.debug : null; },

    /** fake an absence: rewind lastSeenAt, re-run the decay, replay the greeting */
    fakeAway(hours = 9) {
      state.lastSeenAt = Date.now() - hours * 3600e3;
      const el = applyElapsed(game, Date.now());
      app.elapsed = el;
      return el;
    },
    /** replay the reunion at an explicit intensity, without waiting 8 hours */
    reunion(intensity = 0.8, hours = 12) {
      return loop.scene.playReunion ? loop.scene.playReunion(intensity, hours) : false;
    },
    /** name her without a keyboard */
    name(v) {
      if (loop.scene.naming && loop.scene.naming.isOpen) { loop.scene.naming.submit(v); return true; }
      return !!game.setName(v);
    },
    /** through the scene's arbiter, so a driver cannot stack two overlays */
    openNaming(mode = 'rename') {
      if (!loop.scene.openNaming) return false;
      const ok = loop.scene.openNaming(mode);
      loop.stepFixed(1 / 60, 2);
      return ok;
    },
    /** who owns the whole screen: '' | 'naming' | 'reunion' | 'walk' | 'away' */
    surface() { return loop.scene.surfaceOwner ? loop.scene.surfaceOwner() : ''; },
    exportSave: () => exportSave(state),
    importSave: (s) => importSave(s),
    saveNow: () => saver.flush(),
    wipe: () => clearSave(),
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
