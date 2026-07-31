/* ==========================================================================
   engine/audio.js — the graph, the gesture unlock, and the policy.

   THE LANDMINE THIS FILE EXISTS TO DEFUSE. On iOS an `AudioContext` is created
   **suspended** and must be `resume()`d from inside a real user-gesture handler.
   Get that wrong and every sound in the game fails **silently, for ever** — no
   error, no warning, just a pet that makes no noise. It is confirmed on the
   target device (docs/PLATFORM-RISKS.md: "starts suspended; resume() in a
   gesture works"). So:

     - Nothing constructs a context until a gesture has actually happened.
     - `unlock()` does not trust `resume()`. It re-reads `ctx.state` afterwards
       and reports whether the resume really took; `main.js` keeps calling it on
       every touch until it has. A promise that resolves is not evidence.
     - Nothing autoplays. `play()` before a gesture is a no-op that returns
       false, and there is no ambience track to start.

   WHAT ELSE IS POLICY HERE, NOT DECORATION.

   THE TOGGLE REALLY SILENCES. `setEnabled(false)` sets the master gain to zero
   **and disconnects the master node from the output**, and `play()` returns
   early before building any graph at all. Three independent barriers, because
   "sound off" that still leaks one tail during the crossfade is a bug she would
   experience as the setting not working. It survives reloads because it is
   `state.settings.sound`, which `state/save.js` already persists and defaults.

   NO HAPTICS ANYWHERE. `navigator.vibrate` is confirmed absent on the target
   device, so nothing in the game may pair feedback with vibration — the reason
   `boop` and `sit-thump` carry a physical thump in the sound itself.

   NO NOTIFICATION SOUNDS, no reminders, no ambience that plays when she is not
   looking. GIFT-READY §3.

   The published surface from ARCHITECTURE §11.2 is unchanged and additive:
   `{ unlock(), ready, play(name, opts), setEnabled(on), voices, pending }`.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { resolve, voiceFor, NEUTRAL } from './sfx.js';

const AU = BALANCE.audio;

/**
 * @param settings  `state.settings` — read live, so a toggle takes effect at once
 * @param opts.getDogId  () => the ACTIVE dog's persisted id. His voice is
 *   derived from it (engine/sfx.js `voiceFor`), so it needs no save field, no
 *   schema bump, and it travels with an imported save.
 */
export function createAudio(settings = { sound: true }, opts = {}) {
  let ctx = null;
  let master = null;         // everything the game plays goes through this
  let limiter = null;        // ...and then through this, so overlaps cannot clip
  let connected = false;
  let tried = 0;             // how many gestures we have spent trying to unlock
  let lastState = 'none';
  const missing = new Set();
  const last = Object.create(null);   // name -> last play time, for the throttle
  let live = 0;              // recipes fired in the current window
  let liveAt = 0;
  const counts = { played: 0, dropped: 0, throttled: 0, muted: 0, failed: 0 };

  const getDogId = typeof opts.getDogId === 'function' ? opts.getDogId : null;

  function voice() {
    if (!getDogId) return NEUTRAL;
    try {
      const id = getDogId();
      return id === undefined || id === null ? NEUTRAL : voiceFor(id);
    } catch (e) { return NEUTRAL; }
  }

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      ctx = new AC();
    } catch (e) {
      ctx = null;
      return false;
    }
    try {
      /* A LIMITER, not a nicety. Petting a dog while he eats while the tap runs
         can put a dozen voices in flight, and unmanaged summing on a phone
         speaker does not sound loud — it sounds broken. */
      limiter = ctx.createDynamicsCompressor();
      const L = AU.limiter;
      limiter.threshold.value = L.threshold;
      limiter.knee.value = L.knee;
      limiter.ratio.value = L.ratio;
      limiter.attack.value = L.attack;
      limiter.release.value = L.release;
      limiter.connect(ctx.destination);

      master = ctx.createGain();
      master.gain.value = settings && settings.sound ? AU.master : 0;
      if (settings && settings.sound) { master.connect(limiter); connected = true; }
    } catch (e) {
      /* a context without a graph is worse than no context: play() would build
         nodes with nowhere to go */
      ctx = null; master = null; limiter = null;
      return false;
    }
    return true;
  }

  /**
   * Call from a REAL user gesture. Idempotent and cheap, so `main.js` calls it
   * on every touch until `ready` — which is the retry that makes this robust:
   * the first gesture on iOS is occasionally consumed by the page becoming
   * interactive, and a single attempt that quietly failed is exactly the
   * for-ever-silent failure this file is about.
   *
   * @returns true if the context is running RIGHT NOW.
   */
  function unlock() {
    tried++;
    if (!ctx && !build()) { lastState = 'unavailable'; return false; }
    lastState = ctx.state;
    if (ctx.state === 'running') return true;
    try {
      const p = ctx.resume();
      /* VERIFY, do not assume. A resolved promise is not the same as a running
         context on iOS; re-read the state and let the next gesture try again. */
      if (p && typeof p.then === 'function') {
        p.then(() => { lastState = ctx ? ctx.state : 'none'; },
          () => { lastState = 'refused'; });
      }
    } catch (e) {
      lastState = 'refused';
      return false;
    }
    lastState = ctx.state;
    return ctx.state === 'running';
  }

  /**
   * iOS puts the context into `suspended` — or Safari's own `interrupted` — when
   * the app is backgrounded or a phone call arrives. Coming back is a user
   * action, so resuming here is legitimate and is not autoplay; if the platform
   * refuses, the next touch picks it up.
   */
  function resumeIfNeeded() {
    if (!ctx || ctx.state === 'running') return;
    try { ctx.resume(); } catch (e) { /* the next gesture will retry */ }
  }

  function setEnabled(on) {
    const want = !!on;
    if (settings) settings.sound = want;
    if (!master) return want;
    try {
      master.gain.value = want ? AU.master : 0;
      /* AND cut the wire. Gain zero is a number somebody could ramp back over a
         tail; a disconnected node cannot make a sound at all. */
      if (want && !connected) { master.connect(limiter); connected = true; }
      else if (!want && connected) { master.disconnect(); connected = false; }
    } catch (e) { /* never let a setting throw */ }
    return want;
  }

  /** the retrigger floor for a name: petting can tap faster than ears like */
  function floorFor(name) {
    const T = AU.throttle;
    if (T[name] !== undefined) return T[name];
    for (const k in T) {
      if (k.length > 1 && k[k.length - 1] === '-' && name.indexOf(k) === 0) return T[k];
    }
    return T.default;
  }

  const api = {
    get ready() { return !!ctx && ctx.state === 'running'; },
    get ctx() { return ctx; },
    get master() { return master; },
    get state() { return ctx ? ctx.state : 'none'; },
    get enabled() { return !!(settings && settings.sound); },
    /** true once the graph exists at all, whether or not it is running */
    get built() { return !!ctx; },
    get connected() { return connected; },
    get voice() { return voice(); },
    unlock,
    resumeIfNeeded,
    setEnabled,

    /**
     * Per-name overrides, kept from stage 1's stub so a scene can install a
     * one-off sound without touching the bank. Consulted BEFORE
     * `engine/sfx.js`, so it is a real override rather than a fallback.
     */
    voices: Object.create(null),

    /**
     * Play a named sound. Silent and harmless in every failure mode: before a
     * gesture, with sound off, for an unknown name, or if the recipe throws.
     * @returns true only if something was actually scheduled.
     */
    play(name, o) {
      if (!name) return false;
      if (!settings || !settings.sound) { counts.muted++; return false; }
      /* NO AUTOPLAY. Nothing is built and nothing is scheduled before a
         gesture; the name is not even recorded as missing, because "we were
         locked" is not the same as "we owe you this sound". */
      if (!ctx || ctx.state !== 'running' || !connected) return false;

      const now = ctx.currentTime;
      const fl = floorFor(name);
      if (last[name] !== undefined && now - last[name] < fl) { counts.throttled++; return false; }

      /* polyphony cap, measured over a short window rather than by tracking
         node lifetimes: the point is to refuse a pile-up, not to be exact */
      if (now - liveAt > AU.window) { live = 0; liveAt = now; }
      if (live >= AU.maxVoices) { counts.dropped++; return false; }

      const opt = o || {};
      const custom = this.voices[name];
      const hit = custom ? { recipe: custom, gain: 1 } : resolve(name);
      if (!hit || !hit.recipe) {
        /* the ledger every earlier stage used to tell this one what it owed */
        if (!missing.has(name)) missing.add(name);
        return false;
      }

      const t = now + (opt.delay || 0) + AU.lead;
      const g = hit.gain * (opt.gain === undefined ? 1 : opt.gain);
      try {
        if (custom) custom(ctx, master, opt);
        else hit.recipe({ ctx, out: master, t, V: voice(), g });
        live++;
        last[name] = now;
        counts.played++;
        return true;
      } catch (e) {
        /* AUDIO MAY NEVER BREAK A FRAME. This is inside the draw/update path by
           way of the animation clips, so a thrown synth is a dropped frame at
           best and a dead scene at worst. */
        counts.failed++;
        return false;
      }
    },

    /** names asked for that the bank cannot answer — should stay empty now */
    get pending() { return [...missing]; },

    /** verification surface: everything the gate needs, and nothing secret */
    get debug() {
      return {
        state: ctx ? ctx.state : 'none',
        built: !!ctx, running: !!ctx && ctx.state === 'running',
        connected, enabled: !!(settings && settings.sound),
        tried, lastState, sampleRate: ctx ? ctx.sampleRate : 0,
        masterGain: master ? +master.gain.value.toFixed(3) : null,
        counts: { ...counts },
        voice: voice(),
        pending: [...missing],
      };
    },
  };

  return api;
}

export default createAudio;
