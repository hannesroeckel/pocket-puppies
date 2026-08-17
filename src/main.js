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
import { names as sfxNames, voiceFor as sfxVoiceFor } from './engine/sfx.js';
import { rng } from './engine/rng.js';
import { createGame, newState } from './state/game.js';
import { load, createSaver, requestPersistence, isStandalone, exportSave, importSave, writeNow, clear as clearSave } from './state/save.js';
import { applyElapsed, timeOfDay } from './state/time.js';
import { createRoomScene } from './scenes/room.js';
import { resolveDims, stance, headRoom } from './dog/rig.js';
/* the eating solve itself, so the breed-independence proof measures the code
   the game runs instead of a hand-copy of it (§18.2) */
import { solveEatGeometry } from './dog/care.js';
import { BOWL_BASE, BOWL_WELL } from './scenes/props.js';
import { BREED_IDS, getBreed } from './dog/breeds.js';
/* THE REACHABLE PLAY AREA. `resize()` below is the only place in the tree that
   reads `env(safe-area-inset-*)`, so it is the only place that can resolve the
   bottom of what a thumb can touch — see the header of ui/reach.js. */
import reach from './ui/reach.js';

const V = BALANCE.view;

/* ---- review affordance -------------------------------------------------
   `?breed=<id>` renders any breed for side-by-side comparison, and
   `?preview` (implied by ?breed) makes persistence a NO-OP for the session.
   A reviewer poking at breeds must never be able to overwrite the real dog,
   so the preview save path is disabled rather than merely discouraged.
   ---------------------------------------------------------------------- */
function readQuery() {
  let q;
  try { q = new URLSearchParams(location.search); } catch (e) { return { breed: '', preview: false, bad: '' }; }
  const raw = (q.get('breed') || '').trim().toLowerCase();
  const ok = raw && BREED_IDS.indexOf(raw) >= 0;
  return { breed: ok ? raw : '', bad: raw && !ok ? raw : '', preview: q.has('preview') || !!raw };
}

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
  /* THE ONE PLACE THE PLAY AREA IS RESOLVED, immediately after the one place
     the insets are read, and BEFORE any scene resizes — so the nav's own
     `layout()` and every prop's clamp are answering to the same inset on the
     same frame. `view.safe` is in CSS pixels and everything downstream is in
     virtual units, which is what `/ view.vs` is doing here and is the one
     conversion this bound needs to get right. */
  reach.set(view.safe.bottom / view.vs);
}

/* ---- reduced motion --------------------------------------------------- */
function resolveReduced(settings) {
  if (settings && settings.reducedMotion === 'on') return true;
  if (settings && settings.reducedMotion === 'off') return false;
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch (e) { return false; }
}

/* ==========================================================================
   THE SERVICE WORKER, AND THE UPDATE HANDSHAKE (stage 7)

   The worker itself is `/sw.js` and its header explains the caching rules. This
   half is the part that has to be right for HER: a build pushed while she is
   playing must never leave her on a half-old, half-new set of ES modules, and
   must never touch her save.

   THE RULE: THE SWAP HAPPENS WHILE NOBODY IS LOOKING.
     - The worker never calls `skipWaiting()` on its own, so a new version sits
       in `waiting` and the current session finishes entirely on the version it
       started with. What she is playing cannot change under her.
     - When the app goes HIDDEN we flush the save first, THEN tell the waiting
       worker to take over. The controller change therefore lands on a
       backgrounded page.
     - If we asked for that swap, we reload on the controller change — but only
       while hidden, and only if there was already a controller (the very first
       registration claiming the page is not an update and must not reload).
       Anything still pending is retried on the next hide.

   Why a reload is safe here: the save is already flushed to localStorage, which
   no cache operation can reach, and the game's whole model of elapsed time is a
   pure function of the wall clock (§5), so a reload is indistinguishable from
   her having closed and reopened the app — which is the most-tested path in the
   project.
   ========================================================================== */
function createPWA({ flush }) {
  const pwa = {
    supported: 'serviceWorker' in navigator,
    registered: false,
    updateWaiting: false,
    controlled: false,
    swVersion: '',
    error: '',
    askedSkip: false,
    reloading: false,
    lastCheck: 0,
  };
  if (!pwa.supported) return pwa;

  let reg = null;
  /* did the page already have a controller when we started? If not, the first
     `controllerchange` is this very first install claiming us, which is normal
     and must not trigger a reload. */
  const hadController = !!navigator.serviceWorker.controller;
  pwa.controlled = hadController;

  function noteWaiting() {
    /* a worker in `installed` with a controller present means "there is a newer
       version, and it is ready" */
    pwa.updateWaiting = !!(reg && reg.waiting && navigator.serviceWorker.controller);
  }

  /**
   * ASK WHICH GENERATION IS ACTUALLY SERVING US. This is the difference between
   * "a new version is deployed" and "a new version is what she is running", and
   * only the worker can answer it. Called after registration AND on every
   * controller change, because on a first-ever load neither a controller nor an
   * active worker exists yet at registration time — the first attempt lands on
   * nothing, which is exactly what it did before this function existed.
   */
  function askVersion() {
    const w = navigator.serviceWorker.controller || (reg && reg.active);
    if (!w) return false;
    try { w.postMessage({ type: 'version' }); } catch (e) { return false; }
    return true;
  }

  function takeUpdate() {
    if (!reg || !reg.waiting) return false;
    pwa.askedSkip = true;
    try { reg.waiting.postMessage({ type: 'skip-waiting' }); } catch (e) { return false; }
    return true;
  }

  navigator.serviceWorker.register('sw.js', { scope: './', updateViaCache: 'none' })
    .then((r) => {
      reg = r;
      pwa.registered = true;
      noteWaiting();
      r.addEventListener('updatefound', () => {
        const w = r.installing;
        if (!w) return;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed') noteWaiting();
        });
      });
      askVersion();
    })
    .catch((e) => {
      /* A FAILED REGISTRATION IS NOT FATAL. Offline still works for this session
         out of the HTTP cache, the game is unaffected, and the next launch tries
         again. It must not warn: iOS clears the registration on its own after a
         storage sweep, which is a normal thing that will happen. */
      pwa.error = (e && e.message) || 'registration failed';
    });

  navigator.serviceWorker.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.type === 'version') pwa.swVersion = d.version || '';
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    pwa.controlled = true;
    pwa.updateWaiting = false;
    askVersion();
    if (!pwa.askedSkip || !hadController) return;   // the first claim, not an update
    if (!document.hidden) return;                   // never reload in front of her
    pwa.reloading = true;
    try { location.reload(); } catch (e) { /* nothing sensible to do */ }
  });

  /** called on visibilitychange -> hidden, AFTER the save is flushed */
  pwa.onHidden = () => {
    try { flush(); } catch (e) { /* the saver already guards itself */ }
    if (pwa.updateWaiting) takeUpdate();
  };

  /** called on visibilitychange -> visible: is there a new deploy? */
  pwa.checkForUpdate = () => {
    const now = Date.now();
    if (!reg || now - pwa.lastCheck < 4 * 3600e3) return false;
    pwa.lastCheck = now;
    /* the ONLY network request the app ever makes, it is same-origin, it is to
       `sw.js` alone, and it fails silently with no signal */
    try { reg.update().catch(() => {}); } catch (e) { /* offline */ }
    return true;
  };

  pwa.takeUpdate = takeUpdate;
  pwa.askVersion = askVersion;
  pwa.get = () => reg;
  return pwa;
}

/* ---- boot ------------------------------------------------------------- */
async function boot() {
  resize();

  const qs = readQuery();
  const loaded = load();
  const fresh = !loaded;
  const state = loaded || newState(Date.now(), { rng, breedId: qs.breed || undefined });

  /* swap the breed on the live dog, without persisting it */
  if (qs.breed) {
    for (const d of state.dogs) d.breedId = qs.breed;
    if (state.unlocks && state.unlocks.breeds && state.unlocks.breeds.indexOf(qs.breed) < 0) {
      state.unlocks.breeds.push(qs.breed);
    }
  }

  /* In preview the saver is inert: same interface, no writes. */
  const saver = qs.preview
    ? { schedule() {}, flush() {}, destroy() {}, writes: 0, pending: false }
    : createSaver(() => state);
  const game = createGame(state, { onChange: () => saver.schedule() });

  /* elapsed-time decay runs BEFORE the first frame */
  const elapsed = applyElapsed(game, Date.now());

  const reduced = resolveReduced(state.settings);
  /* HIS VOICE IS DERIVED FROM HIS ID. `engine/sfx.js voiceFor` pitch-shifts a
     shared vocal bank per dog, which research §1.9 calls the cheapest large win
     for individuality — and because it comes from the persisted `id` it needs no
     save field, no schema bump, and it travels with an imported save. Passed as
     a getter so a later stage's kennel switching dogs switches the voice too. */
  const audio = createAudio(state.settings, { getDogId: () => game.dog.id });
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

  /* ---- THE AUDIO UNLOCK, AND ITS RETRY -------------------------------
     On iOS an AudioContext starts SUSPENDED and must be resumed inside a real
     user gesture; get it wrong and every sound in the game fails silently for
     ever (docs/PLATFORM-RISKS.md — confirmed on the target device). One attempt
     is not enough, because the first touch of a session can land while the page
     is still becoming interactive and a resume that quietly did not take leaves
     no trace. So: try on EVERY gesture until the context is genuinely `running`,
     verified by re-reading `ctx.state`, then stop listening.

     `capture: true` so it runs before the canvas handler swallows the event, and
     `touchend` as well as `pointerdown` because older WebKit has honoured the
     two differently. */
  const unlockOnGesture = () => {
    if (audio.ready) { stopUnlockRetry(); return; }
    audio.unlock();
    if (audio.ready) stopUnlockRetry();
  };
  function stopUnlockRetry() {
    window.removeEventListener('pointerdown', unlockOnGesture, true);
    window.removeEventListener('touchend', unlockOnGesture, true);
  }
  window.addEventListener('pointerdown', unlockOnGesture, true);
  window.addEventListener('touchend', unlockOnGesture, true);

  /* ---- the service worker + the update handshake --------------------- */
  const pwa = createPWA({ flush: () => saver.flush() });
  app.pwa = pwa;

  /* ---- lifecycle -----------------------------------------------------
     iOS suspends JavaScript outright when the app is backgrounded and can kill
     a backgrounded web app with no further events, so `visibilitychange` and
     `pagehide` are the only reliable save points (PLATFORM-RISKS Risk 3;
     `beforeunload` is not trustworthy here). The service-worker swap is
     deliberately bolted to the same moment, AFTER the flush. */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      /* SILENCE FIRST, and completely. Now that the game deliberately overrides
         the iPhone's ringer switch (BALANCE.audio.overrideSilentSwitch), a
         backgrounded tab holding an audio session open is exactly the failure
         that risks a puppy noise from her pocket in a meeting — so release the
         session and suspend the graph rather than trusting iOS to suspend our JS
         for us. Before `pwa.onHidden()`, which may hand over to a new worker. */
      audio.silenceForHidden();
      pwa.onHidden();
    } else {
      /* iOS also suspends the AudioContext when the app is backgrounded, and a
         context that comes back `suspended` or (Safari-only) `interrupted` is
         the second way sound dies silently. Coming back is a user action, so
         this is not autoplay; if the platform refuses, the next touch retries. */
      audio.resumeIfNeeded();
      if (!audio.ready) {
        window.addEventListener('pointerdown', unlockOnGesture, true);
        window.addEventListener('touchend', unlockOnGesture, true);
      }
      pwa.checkForUpdate();
    }
  });
  /* `pagehide` is NOT hooked here: `state/save.js createSaver` already flushes
     on it (and on visibilitychange). `pwa.onHidden` flushes again itself as its
     first act, which is what guarantees the ordering that matters — the save is
     on disk before the worker is told to take over, regardless of which
     listener the browser runs first. */

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
    version: 9,
    app, loop, view, saver, BALANCE, pwa,
    /* THE REACHABLE PLAY AREA, and its per-frame assertion. `reach.report()` is
       what the gate reads; `reach.snapshot()` is every prop's rect this frame
       whether or not it offends, which is what you look at when the count is
       zero and you want to know whether it is zero for the right reason. */
    reach,
    /* what ?breed= resolved to; `bad` is a rejected id (getBreed would have
       silently fallen back to a Shiba and hidden the typo) */
    query: qs, breeds: BREED_IDS,
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
      if (trick === 'sit') {
        for (let i = 0; i <= 12; i++) {
          pts.push(toV(head.x, head.y - head.hy * 0.5 + (head.hy * 1.15) * (i / 12)));
        }
      } else if (trick === 'lieDown') {
        /* THE L, AND THE HARNESS HAS TO DRAW IT TOO. This used to be the sit's
           stroke verbatim, because the two tricks shared a gesture and the
           posture told them apart — so every gate that taught a lie-down was
           really teaching whatever the dog's posture said. The lie-down has its
           own shape now (`headSweep`), and a harness that still drew the old
           one would teach a sit and report it as a lie-down. */
        const top = head.y - head.hy * 0.5;
        const corner = top + head.hy * 1.3;
        for (let i = 0; i <= 10; i++) pts.push(toV(head.x, top + (corner - top) * (i / 10)));
        for (let i = 1; i <= 8; i++) pts.push(toV(head.x - 60 * (i / 8), corner));
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
    /**
     * Put practice on the books WITHOUT animating it, through the real state
     * mutators (`trickRep`, `bindCue`) and nothing else.
     *
     * `teach()` above drives the whole ritual and is what PROVES the ritual
     * works — stage 3 measured it (§13.6: 3 reps across sessions, 5 crammed).
     * But a stage-5 gate needs a dog with six tricks at level 2-3, and paying
     * for ~200 drawn frames per rep to get there made a scoring sweep take
     * minutes. This is the same ledger, reached directly, and it deliberately
     * resets the per-sitting counters each rep so the reps are full value —
     * i.e. it produces exactly the dog that "trained him over several days"
     * produces, rather than a dog with impossible numbers.
     */
    learn(trick, sig, reps = 5) {
      if (!BALANCE.train.roster.includes(trick)) return null;
      for (let i = 0; i < reps; i++) {
        const rec = game.trickRecord(trick);
        rec.sessReps = 0; rec.sessAt = 0; rec.dayAt = -1;
        game.trickRep(trick, BALANCE.train.reward.quality.crisp, Date.now());
      }
      if (sig) game.bindCue(trick, sig, 0.95);
      return { id: trick, ...game.trick(trick) };
    },
    /** a trained dog in one call: the roster, spread across the eight signals */
    learnAll(reps = 5) {
      const plan = [['sit', 'down'], ['lieDown', 'left'], ['beg', 'up'],
        ['shake', 'right'], ['spin', 'circle'], ['jump', 'double'],
        ['rollOver', 'tap'], ['playDead', 'hold']];
      const out = {};
      for (const [id, sig] of plan) out[id] = __pp.learn(id, sig, reps);
      loop.stepFixed(1 / 60, 2);
      return out;
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

    /**
     * Fake an absence: rewind the clocks, re-run the decay, replay the greeting.
     *
     * AN ABSENCE IS AN ABSENCE FROM EVERY DOG. The per-dog `lastSeenAt` is what
     * the reunion runs on now, so rewinding only the app clock would fake a
     * visit that never happened — she would have been away nine hours and yet
     * have somehow seen him a moment ago. `dogs: false` is for the one case
     * that is genuinely different: she has been playing daily WITH THE OTHER
     * DOG, so the app is fresh and this one has been waiting.
     */
    fakeAway(hours = 9, { dogs = true } = {}) {
      const at = Date.now() - hours * 3600e3;
      state.lastSeenAt = at;
      if (dogs) for (const d of state.dogs) d.lastSeenAt = at;
      const el = applyElapsed(game, Date.now());
      app.elapsed = el;
      return el;
    },
    /** how long since she was last with a dog, in hours */
    gapFor(id) { return game.gapHoursFor(id || game.dog.id); },
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
    /* ---- stage 5 drivers: THE OBEDIENCE TRIAL -------------------------
       Deterministic like everything else here. In particular NOTHING WAITS ON
       A TIMER: a trial is a state machine driven by `update`, so the way to
       run one is to STEP it and watch the phase change. `runTrial()` is the
       whole thing end to end in one call, which is what makes a 400-trial
       scoring sweep practical. */
    /** open the entry panel (through the room's arbiter, never around it) */
    ring(on = true) {
      const sc = loop.scene;
      if (!sc.startContest) return false;
      if (on) { const r = sc.startContest(); loop.stepFixed(1 / 60, 2); return r; }
      sc.stopContest(); loop.stepFixed(1 / 60, 2); return true;
    },
    /** the entry gate, without opening anything */
    ringCheck() {
      const k = loop.scene.contest;
      return k ? k.check() : null;
    },
    /** skip the panel and go straight into the ring */
    enterRing() {
      const k = loop.scene.contest;
      if (!k) return null;
      if (!k.modal) loop.scene.startContest();
      loop.stepFixed(1 / 60, 2);
      const ok = k.enterRing();
      loop.stepFixed(1 / 60, 2);
      return ok ? k.debug : null;
    },
    /** what the judge is asking for right now */
    asking() { const k = loop.scene.contest; return k ? k.asking() : ''; },
    /** the free window's offer, deepest first */
    choices() { const k = loop.scene.contest; return k ? k.choices() : null; },
    /** give the steadying cue by id; omit to let him answer the judge alone */
    cueRing(sig) {
      const k = loop.scene.contest;
      if (!k) return false;
      const ok = k.injectCue(sig);
      loop.stepFixed(1 / 60, 1);
      return ok;
    },
    /**
     * DRAW the steadying cue for real, as a synthetic pointer path in the cue
     * pad, so the shared recogniser (dog/train.js `createSignalReader`) is
     * exercised rather than bypassed. This is the tap path, at full status.
     */
    cueDraw(sig, { dt = 1 / 60 } = {}) {
      const scene = loop.scene;
      const A = BALANCE.contest.assist.pad;
      const SGN = BALANCE.train.signal;
      const cx = 195, cy = (A.top + A.bottom) / 2;
      const send = (type, x, y, moved) => {
        input.state.lastX = x; input.state.lastY = y;
        scene.pointer(app, { type, x, y, id: 1, dx: 0, dy: 0, speed: 0, dist: 0, moved: !!moved });
      };
      const L = SGN.minSwipe * 1.9;
      const path = [];
      if (sig === 'up') for (let i = 0; i <= 10; i++) path.push([cx, cy + L / 2 - (L * i) / 10]);
      else if (sig === 'down') for (let i = 0; i <= 10; i++) path.push([cx, cy - L / 2 + (L * i) / 10]);
      else if (sig === 'left') for (let i = 0; i <= 10; i++) path.push([cx + L / 2 - (L * i) / 10, cy]);
      else if (sig === 'right') for (let i = 0; i <= 10; i++) path.push([cx - L / 2 + (L * i) / 10, cy]);
      else if (sig === 'circle') {
        for (let i = 0; i <= 22; i++) {
          const th = (i / 22) * Math.PI * 2;
          path.push([cx + Math.cos(th) * 34, cy + Math.sin(th) * 26]);
        }
      } else path.push([cx, cy]);
      send('down', path[0][0], path[0][1], false);
      loop.stepFixed(dt, 1);
      if (sig === 'hold') loop.stepFixed(dt, Math.ceil((SGN.holdDur + 0.1) / dt));
      for (let i = 1; i < path.length; i++) { send('move', path[i][0], path[i][1], true); loop.stepFixed(dt, 1); }
      send('up', path[path.length - 1][0], path[path.length - 1][1], path.length > 1);
      loop.stepFixed(dt, 1);
      if (sig === 'double') {
        send('down', cx, cy, false); loop.stepFixed(dt, 1);
        send('up', cx, cy, false); loop.stepFixed(dt, 1);
      }
      return loop.scene.contest.debug;
    },
    /** pick a trick in the free window */
    chooseFree(id) {
      const k = loop.scene.contest;
      if (!k) return false;
      const ok = k.choose(id);
      loop.stepFixed(1 / 60, 2);
      return ok;
    },
    /**
     * Run a whole trial to the result card.
     *
     * @param o.assist 'none' | 'hand' | 'auto' — 'hand' DRAWS the real cue
     *   through the pointer path, 'auto' injects it. Both are the same
     *   mechanic; drawing is slower and is what a screenshot run wants.
     *   'none' is the hands-off trial, which must be winnable.
     * @param o.free   which trick to pick in the free window: 'best' (deepest),
     *   an explicit trick id, or 'none' to let the window lapse.
     * @param o.sim    step without drawing (~15x cheaper) for statistics.
     */
    runTrial({ assist = 'auto', free = 'best', dt = 1 / 60, max = 90, sim = false } = {}) {
      const sc = loop.scene;
      const k = sc.contest;
      if (!k) return null;
      if (!k.modal) sc.startContest();
      loop.stepFixed(dt, 2);
      if (k.beat === 'entry' && !k.enterRing()) return { blocked: k.check() };
      const stepOne = () => { if (sim) loop.stepSim(dt, 1); else loop.stepFixed(dt, 1); };
      let guard = Math.round(max / dt);
      let cued = '';
      while (guard-- > 0 && k.beat === 'ring') {
        /* the free window: pick, or deliberately let it lapse */
        if (k.phase === 'choose' && free !== 'none') {
          const list = k.choices();
          const want = free === 'best' ? (list[0] && list[0].id) : free;
          if (want) { k.choose(want); continue; }
        }
        /* the call beat: back him up, at most once per round */
        if (k.phase === 'call' && assist !== 'none') {
          const id = k.asking();
          const sig = id ? game.cueFor(id) : '';
          if (sig && cued !== id) {
            cued = id;
            if (assist === 'hand') __pp.cueDraw(sig, { dt });
            else k.injectCue(sig);
            continue;
          }
        }
        if (k.phase !== 'call') cued = '';
        stepOne();
      }
      /* let the card land */
      for (let i = 0; i < 40 && !k.result; i++) stepOne();
      return k.result;
    },
    /** the trial state, the class, the standing, the live grooming delta */
    ringState() { const k = loop.scene.contest; return k ? k.debug : null; },

    /* ---- stage 5 drivers: THE ECONOMY ---------------------------------
       `purse()` is the one call that shows both currencies side by side, which
       is how "you cannot buy an unlock" gets demonstrated rather than claimed:
       pour coins in, and `unlocks` does not move. */
    purse() {
      return {
        coins: game.coins,
        carePoints: game.carePoints,
        careToday: game.careToday,
        unlocks: game.careUnlocks(),
        contest: { ...game.contest },
        cls: game.contestClass(),
        entriesLeft: game.contestEntriesLeft,
      };
    },
    coins: () => game.coins,
    addCoins: (n) => game.addCoins(n),
    /** the mutator ARCHITECTURE §14.2 asked for: {ok, coins, spent, short} */
    spendCoins: (n) => game.spendCoins(n),
    canAfford: (n) => game.canAfford(n),
    carePoints: () => game.carePoints,
    addCarePoints: (n) => game.addCarePoints(n),
    awardCare: (kind) => game.awardCare(kind),
    isUnlocked: (id) => game.isUnlocked(id),
    careUnlocks: () => game.careUnlocks(),

    /* ---- stage 6 drivers: SHOP + KENNEL --------------------------------
       The separation of the two currencies is the strongest structural idea
       in the design and it is now the first thing with code that could break
       it, so it gets the most drivers: everything below either moves ONE
       currency or reads what the other would allow, and nothing converts. */
    shop: () => (loop.scene.debug && loop.scene.debug.shop) || null,
    kennel: () => (loop.scene.debug && loop.scene.debug.kennel) || null,
    openShop() { const r = loop.scene.openShop && loop.scene.openShop(); loop.stepFixed(1 / 60, 6); return r; },
    openKennel() { const r = loop.scene.openKennel && loop.scene.openKennel(); loop.stepFixed(1 / 60, 6); return r; },
    /* buy through the MUTATOR, so a test exercises the same refusal path the
       shop surface does rather than a parallel one */
    buy: (id) => game.buyItem(id),
    stock: () => game.shopStock(),
    owned: (id) => game.ownedCount(id),
    giveTreat: (id) => game.giveTreat(id),
    wearable: () => game.wearable(),
    equipWear: (id) => game.equipWear(id),
    worn: () => game.worn,
    hasTool: (id) => game.hasTool(id),
    roster: () => game.roster(),
    /* ---- THE BREED-INDEPENDENCE PROOF ----------------------------------
       The eating pose was tuned by looking at the Shiba, which is the only
       breed in this tree. Three are landing that differ in muzzle length, ear
       type and body mass, so "it will still work" has to be checked rather
       than asserted. This runs `dog/care.js`'s solve — the same arithmetic,
       not a copy — against arbitrary proportions and reports whether the two
       invariants survive:
         A  the bowl's base lands exactly on the floor the rig reports
         B  the head's drop stays inside that dog's own head-to-belly room
       Both are true BY CONSTRUCTION, which is the point: the solve cannot
       express a floating bowl or a sunken head. This is how we find out if
       that is really so for proportions nobody has seen yet. */
    solveFor(proportions) {
      const C = BALANCE.care, S = C.stoop, ST = C.stage;
      /* THE SAME ARITHMETIC, AND NOW ACTUALLY SO. The comment above claimed
         this ran care.js's solve; it ran a hand-copy of it, which is how the
         two came to disagree about where the floor was. It calls the real one.
         (ARCHITECTURE §18.2) */
      const g = solveEatGeometry(proportions, BALANCE.rig.place);
      const dims = resolveDims({ proportions });
      const posture = { sit: S.sit, down: S.down, squash: S.squash, pitch: C.headPitch };
      const bob = Math.max(C.feed.bobDepth, C.water.bobDepth) * C.bobPeak;
      /* what the deepest bite ACTUALLY reaches, after applyBowl's clamp */
      const deepest = Math.min(g.drop + bob, g.maxDrop);
      const eat = stance(dims, { ...posture, headLift: -g.drop });
      const eatS = BALANCE.rig.place.scale * (1 + S.near);
      const span = BOWL_BASE - BOWL_WELL;
      const chestBelowChinAtRest = (eat.bodyBottom - eat.headBottom) * eatS;
      const chestBelowChinAtBob =
        (eat.bodyBottom - (eat.headBottom + (deepest - g.drop))) * eatS;
      const baseV = g.targetY + BOWL_BASE * g.scale;
      return {
        room: +g.room.toFixed(2), drop: +g.drop.toFixed(2),
        maxDrop: +g.maxDrop.toFixed(2), deepest: +deepest.toFixed(2),
        share: +(g.drop / g.room).toFixed(3),
        standingRoom: +headRoom(dims).toFixed(2),
        /* THE ROOM'S FLOOR, AND WHERE HIS PAWS LAND ON IT. These being equal
           is the invariant that matters and it is what `pawPlant` buys; the
           old `gap` compared the base against the number the base was
           computed from, so it was 0 whatever the render looked like. */
        roomFloorV: +g.roomFloorV.toFixed(2),
        soleEatV: +g.soleEatV.toFixed(2),
        soleAuthoredV: +g.soleAuthoredV.toFixed(2),
        soleStandV: +g.soleStandV.toFixed(2),
        plant: g.plant,
        /* how far the pose WOULD have sunk his paws below the floor unplanted:
           the defect, per breed, as one number */
        unplantedSink: +(g.soleAuthoredV - g.roomFloorV).toFixed(2),
        floorV: +g.floorV.toFixed(2), targetY: +g.targetY.toFixed(2),
        baseV: +baseV.toFixed(2),
        gapBaseVsSole: +(baseV - g.soleEatV).toFixed(4),
        /* THE REAL FAILURE MODE: a clamped scale means no bowl inside
           `scaleRange` can both stand on the floor and reach his muzzle. */
        scale: +g.scale.toFixed(4), scaleClamped: g.scaleClamped,
        rawScale: +g.rawScale.toFixed(4),
        scaleRange: ST.scaleRange,
        muzBottomV: +g.muzBottomV.toFixed(2), wellV: +g.wellV.toFixed(2),
        chestBelowChinAtRest: +chestBelowChinAtRest.toFixed(2),
        chestBelowChinAtBob: +chestBelowChinAtBob.toFixed(2),
        muzIntoBowl: +(g.muzBottomV - g.wellV).toFixed(2),
      };
    },
    /* READS THE BREED TABLE, not a global nobody ever set. This asked
       `window.__ppBreeds`, which is assigned nowhere in the tree, so it has
       always returned null and the breed-independence sweep silently skipped
       the three breeds that actually ship — testing only distortions of
       whichever dog happened to be loaded. Found while re-deriving the bowl
       assertions (§18.2); the live gate `C:\tmp\pp8\bowl3.py` covers all three
       breeds in the running game regardless. */
    breedProportions: (id) => {
      const b = getBreed(id);
      return b && b.proportions ? b.proportions : null;
    },
    adoptCheck: () => game.adoptCheck(),
    adopt: (now) => game.adoptDog(now === undefined ? Date.now() : now),
    switchDog: (id) => game.switchDog(id),
    /* tap a surface for real, as a pointer, so the hit tests are exercised */
    tapAt(x, y) {
      const sc = loop.scene;
      sc.pointer(app, { type: 'down', x, y, id: 1, dx: 0, dy: 0, speed: 0, dist: 0, moved: false });
      loop.stepFixed(1 / 60, 2);
      sc.pointer(app, { type: 'up', x, y, id: 1, dx: 0, dy: 0, speed: 0, dist: 0, moved: false });
      loop.stepFixed(1 / 60, 2);
      return loop.scene.debug;
    },
    /** set the ladder class directly, to photograph or measure one */
    setClass(i) {
      const r = game.contest;
      r.classIdx = Math.max(0, Math.min(BALANCE.contest.classes.length - 1, i | 0));
      saver.schedule();
      loop.stepFixed(1 / 60, 1);
      return game.contestClass();
    },
    /** set the coat and the gloss — this is how grooming gets measured */
    setCoat(cleanliness, gloss) {
      game.setNeed('cleanliness', cleanliness);
      const dirt = game.dirt;
      for (let i = 0; i < dirt.length; i++) game.setDirt(i, 1 - cleanliness);
      if (gloss !== undefined) game.addGloss(gloss - game.gloss);
      loop.stepFixed(1 / 60, 1);
      return {
        cleanliness: game.dog.needs.cleanliness, gloss: game.gloss,
        word: game.describeNeed('cleanliness'), glossWord: game.describeGloss(),
      };
    },
    /** fill him up so the entry gate is clear, without running a care action */
    setNeed(key, v) { game.setNeed(key, v); return game.dog.needs[key]; },

    /* ---- stage 7 drivers: SOUND ---------------------------------------
       Audibility cannot be verified in headless Chromium, so everything here
       exists to verify sound STRUCTURALLY: that the graph is built, that a
       recipe actually schedules nodes, that the context only reaches `running`
       after a gesture, and that the toggle really disconnects. */
    audio: () => app.audio.debug,
    /** what the bank can answer, and what the game has asked for and been owed */
    soundNames: () => sfxNames(),
    /** fire one sound by name. Returns false when it was genuinely refused. */
    playSound: (name, opts) => app.audio.play(name, opts),
    /**
     * COUNT THE NODES A RECIPE ACTUALLY CREATES. `play()` returning true only
     * proves nothing threw; this wraps the context's factory methods and counts
     * real oscillators, buffer sources, filters and gains, which is the closest
     * a headless run can get to "a sound happened".
     */
    countNodes(name, opts) {
      const c = app.audio.ctx;
      if (!c) return null;
      const kinds = ['createOscillator', 'createBufferSource', 'createBiquadFilter',
        'createGain', 'createDynamicsCompressor'];
      const seen = {};
      const orig = {};
      let started = 0;
      for (const k of kinds) {
        seen[k] = 0;
        orig[k] = c[k];
        c[k] = function patched(...a) {
          seen[k]++;
          const node = orig[k].apply(c, a);
          if (node && typeof node.start === 'function') {
            const s = node.start.bind(node);
            node.start = (...b) => { started++; return s(...b); };
          }
          return node;
        };
      }
      let ok = false;
      try { ok = app.audio.play(name, opts); } finally {
        for (const k of kinds) c[k] = orig[k];
      }
      const total = kinds.reduce((s, k) => s + seen[k], 0);
      return { name, ok, started, total, nodes: seen };
    },
    /** the toggle, through the real mutator + the real audio call */
    soundOn(on = true) {
      game.setSetting('sound', !!on);
      app.audio.setEnabled(!!on);
      return app.audio.debug;
    },
    /** his voice — the five axes, derived from the persisted dog id */
    voiceOf: (id) => sfxVoiceFor(id === undefined ? game.dog.id : id),

    /* ---- stage 7 drivers: PWA + INSTALL -------------------------------- */
    /** registration, which generation is serving us, and whether one waits */
    pwaState: () => ({
      supported: pwa.supported, registered: pwa.registered,
      controlled: pwa.controlled, updateWaiting: pwa.updateWaiting,
      swVersion: pwa.swVersion, error: pwa.error, askedSkip: pwa.askedSkip,
      controller: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
    }),
    /** take a waiting update NOW, the way going-hidden would */
    takeUpdate: () => pwa.takeUpdate(),
    /** what the sw says its version is */
    askSwVersion() {
      const c = navigator.serviceWorker && navigator.serviceWorker.controller;
      if (!c) return false;
      c.postMessage({ type: 'version' });
      return true;
    },
    /** the install card's whole policy, as numbers */
    installState: () => (loop.scene.install ? loop.scene.install.debug : null),
    /** open it regardless of the cadence (what the Settings row does) */
    showInstall() {
      if (!loop.scene.install) return false;
      const ok = loop.scene.install.force();
      loop.stepFixed(1 / 60, 20);
      return ok;
    },
    /** press one of its three doors: 'add' | 'later' | 'never' | 'scrim' */
    installTap(which = 'later') {
      const sc = loop.scene;
      if (!sc.install || !sc.install.isOpen) return false;
      /* through the real pointer path, so the geometry that was DRAWN is the
         geometry that is HIT — the lesson of §15.4 defect 5 */
      const B = BALANCE.install.card;
      const w = Math.min(B.w, V.W - 28);
      const x = (V.W - w) / 2;
      const y = Math.max(view.safe.top / view.vs + 14, B.y);
      const bh = 40, gap = 9, bw = (w - 52 - gap) / 2;
      const pt = which === 'add' ? [x + 26 + bw / 2, y + B.h - 26 - bh / 2]
        : which === 'later' ? [x + 26 + bw + gap + bw / 2, y + B.h - 26 - bh / 2]
          : which === 'never' ? [x + w / 2, y + B.h + 21]
            : [V.W / 2, 40];
      sc.pointer(app, { type: 'down', x: pt[0], y: pt[1], id: 1, dx: 0, dy: 0, speed: 0, dist: 0, moved: false });
      sc.pointer(app, { type: 'up', x: pt[0], y: pt[1], id: 1, dx: 0, dy: 0, speed: 0, dist: 0, moved: false });
      loop.stepFixed(1 / 60, 30);
      return sc.install.debug;
    },
    /** pretend she is running installed, to prove the card never appears */
    fakeStandalone(on = true) {
      app.standalone = !!on;
      loop.stepFixed(1 / 60, 4);
      return { standalone: app.standalone, install: loop.scene.install.debug };
    },

    exportSave: () => exportSave(state),
    importSave: (s) => importSave(s),
    saveNow: () => saver.flush(),
    wipe: () => clearSave(),
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
