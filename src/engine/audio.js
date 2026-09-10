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
       false, and so is `bed()` — see the note on that word below.

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

   NO NOTIFICATION SOUNDS AND NO REMINDERS. GIFT-READY §3.

   AND STILL NOTHING THAT PLAYS WHEN SHE IS NOT LOOKING — but that sentence used
   to read "no ambience", and as of 8.32.0 that would be a lie. `bed()` holds a
   SUSTAINED sound, which the walk uses for the road he is on. What keeps it
   inside the original promise is that it is owned by a beat rather than by the
   app: `dog/stroll.js` starts it when the road fades in, fades it with the same
   dissolve, and stops it when the road goes — half a minute, on screen, while
   she is watching. Nothing starts a bed at launch, on a timer, or in the
   background, and `visibilitychange -> hidden` suspends the context under it
   like everything else.

   BEWARE THE WORD "AMBIENT" IN THIS FILE. Everywhere below it means iOS's audio
   session CATEGORY — the one the ringer switch mutes — and not the sound of a
   place. The road sounds are called BEDS for exactly that reason: confusing the
   two would put the silent-switch work at risk, and that work is what makes the
   game audible at all for someone who keeps her phone on silent.

   The published surface from ARCHITECTURE §11.2 grows by one, additively:
   `{ unlock(), ready, play(name, opts), bed(name, opts), setEnabled(on),
      voices, pending }`.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { resolve, voiceFor, NEUTRAL, BEDS } from './sfx.js';

const AU = BALANCE.audio;

/* ==========================================================================
   PLAYING THROUGH THE iPHONE SILENT SWITCH.

   NOT A BUG FIX — A DELIBERATE OVERRIDE, AND NOW AN OPT-IN ONE. Sound was
   reported missing on iPhone and audible on the laptop; the cause was the
   physical ringer switch, exactly as ARCHITECTURE §16.8 documents. Nothing in
   this file was broken. The decision to override it is a product one: the
   recipient normally keeps her phone on silent, and a pet game that is
   permanently mute reads as broken rather than as respectful.

   IT IS OFF BY DEFAULT AS OF 8.25.0, on this report: "when playing the game all
   other audio such as music on the phone stops."

   That is not a regression, it is the PRICE of the override, and it had never
   been written down next to the benefit. Claiming *playback* is claiming the
   phone's audio, because *playback* is non-mixing by definition — so the game
   was silencing whatever was playing for as long as it was open, in exchange
   for being audible with the ringer off. Both halves are real and only one of
   them had been chosen deliberately.

   THERE IS NO OPTION THAT DOES BOTH. Native iOS can request *playback* with
   `mixWithOthers`; Safari exposes no such flag, and *ambient* — the only mixing
   category the web can ask for — is precisely the one the ringer switch mutes.
   So this is a genuine either/or, `state.settings.playOnSilent` is where it is
   decided, and the default is the one that does not reach into the rest of the
   phone. Settings says so in words and turns it back on in one tap.

   HOW IT WORKS. iOS gives a page's audio one of two session categories.
   WebAudio alone lands in *ambient*, which the ringer switch mutes. An
   `<audio>` ELEMENT that is actually playing moves the session to *playback*,
   which ignores the switch — and WebAudio output then rides along with it. So
   we start a fraction of a second of TRUE SILENCE on a looping `playsinline`
   element inside the same gesture that resumes the AudioContext.

   The silence is generated here as a data URI, so this costs no asset file, no
   fetch and no service-worker precache entry (§14.2: zero external requests).

   WHAT KEEPS THIS FROM BECOMING A PUPPY BARKING IN HER POCKET:
     - the in-game toggle is the authority. `setEnabled(false)` stops this
       element, so the session is RELEASED and not merely muted.
     - `visibilitychange -> hidden` stops it too (main.js), so a backgrounded
       game holds no audio session and leaks no battery.
     - it starts only from a real gesture, and it plays silence, so there is no
       moment where the game makes a sound she did not ask for.
   ========================================================================== */
/**
 * A RIFF/WAVE data URI of pure silence. 8-bit unsigned PCM, so a silent sample
 * is 128; a quarter second at 8kHz is ~2KB of base64 and costs nothing.
 *
 * It must be genuinely silent AUDIO rather than a `muted` element: a muted
 * element does not move the session category, which is the entire point.
 */
function silentWavUri(seconds, rate) {
  const sr = Math.max(8000, Math.round(+rate || 8000));
  const n = Math.max(1, Math.round(Math.max(0.02, +seconds || 0.25) * sr));
  const total = 44 + n;
  const b = new Uint8Array(total);
  const dv = new DataView(b.buffer);
  const wr = (o, s) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
  wr(0, 'RIFF'); dv.setUint32(4, total - 8, true); wr(8, 'WAVE');
  wr(12, 'fmt '); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);        // PCM
  dv.setUint16(22, 1, true);        // mono
  dv.setUint32(24, sr, true);
  dv.setUint32(28, sr, true);       // byte rate: mono, one byte per sample
  dv.setUint16(32, 1, true);        // block align
  dv.setUint16(34, 8, true);        // bits per sample
  wr(36, 'data'); dv.setUint32(40, n, true);
  for (let i = 0; i < n; i++) b[44 + i] = 128;
  let s = '';
  for (let i = 0; i < total; i++) s += String.fromCharCode(b[i]);
  return 'data:audio/wav;base64,' + btoa(s);
}

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
  /* EVERY SUSTAINED SOUND CURRENTLY PLAYING (8.32.0). One-shots need no such
     list — they end on their own — but a bed runs until somebody stops it, so
     the engine keeps the set that lets it stop them all: sound turned off, the
     context torn down, or a scene going away mid-walk. Each entry is that
     bed's own `stopAll`, which is idempotent. */
  const beds = new Set();
  const last = Object.create(null);   // name -> last play time, for the throttle
  let live = 0;              // recipes fired in the current window
  let liveAt = 0;
  const counts = { played: 0, dropped: 0, throttled: 0, muted: 0, failed: 0 };

  const getDogId = typeof opts.getDogId === 'function' ? opts.getDogId : null;

  /* ---- the silent element that owns the iOS audio session ------------- */
  let sessionEl = null;
  let sessionOn = false;
  let sessionFail = '';

  /**
   * THREE THINGS HAVE TO AGREE, and the middle one is new.
   *
   *   AU.overrideSilentSwitch   the capability exists at all (build-level)
   *   settings.playOnSilent     SHE HAS ASKED FOR IT (per save, default false)
   *   settings.sound            sound is on at all
   *
   * `playOnSilent` was added because claiming the session is not free: iOS's
   * *playback* category is non-mixing by definition, so for as long as the game
   * held it, whatever the phone was playing — music, a podcast — stopped. That
   * was reported from real use, and it is not a bug in this file: it is the
   * documented cost of the override, which nobody had weighed against the
   * benefit until somebody actually lost their music to a puppy.
   *
   * The web cannot have both. Native iOS can ask for *playback* WITH
   * `mixWithOthers`; Safari exposes no such option, and *ambient* — the only
   * mixing category available — is exactly the one the ringer switch mutes.
   * So it is a real either/or and it is now hers to make, defaulting to the
   * polite side.
   */
  function sessionWanted() {
    return !!AU.overrideSilentSwitch
      && !!(settings && settings.sound && settings.playOnSilent);
  }

  /**
   * SAY WHICH SESSION WE WANT, on the browsers that let us ask.
   *
   * `navigator.audioSession.type` is Safari 16.4+ and is the FIRST-CLASS way to
   * do what the silent `<audio>` element below does by side effect. Two reasons
   * to set it as well as keeping the element:
   *
   *   1. It makes the ambient case EXPLICIT. Without it, "we mix with your
   *      music" is merely the absence of the hack — and an absence is not
   *      something a reader or a gate can check. `type = 'ambient'` is a
   *      positive statement that this app does not want to interrupt anything.
   *   2. It is the only lever that works if a future WebKit stops letting a
   *      silent element move the category, which is a behaviour this file has
   *      always depended on and never been promised.
   *
   * Wrapped and swallowed: this is an enhancement, and every device without it
   * must keep the exact behaviour it had.
   */
  function declareSession() {
    try {
      const as = typeof navigator !== 'undefined' && navigator.audioSession;
      if (!as) return '';
      const want = sessionWanted() ? 'playback' : 'ambient';
      as.type = want;
      return want;
    } catch (e) { return ''; }
  }

  /**
   * Start (or restart) the silent looping element. The first call MUST come from
   * inside a real user gesture — it is called from `unlock()`, which is
   * gesture-only, so that holds by construction.
   *
   * Every failure is swallowed. This is an enhancement: a device that refuses it
   * must still get the ordinary WebAudio path, with the ringer switch behaving
   * exactly as it always did.
   */
  function ensureSession() {
    /* DECLARED EITHER WAY. When the override is off this is the call that says
       "ambient" out loud, so mixing is asserted rather than merely left to
       happen — see declareSession(). */
    declareSession();
    if (!sessionWanted()) return false;
    try {
      if (!sessionEl) {
        const S = AU.silentSession || {};
        const el = document.createElement('audio');
        /* playsinline in both spellings: without it older WebKit can treat an
           element that starts playing as a reason to go fullscreen. */
        el.setAttribute('playsinline', '');
        el.setAttribute('webkit-playsinline', '');
        el.loop = true;
        el.preload = 'auto';
        /* NOT `muted`, and NOT volume 0 — either leaves the session in *ambient*
           and makes the whole exercise pointless. The DATA is silent, so there
           is nothing to hear either way. */
        el.muted = false;
        el.volume = 1;
        el.src = silentWavUri(S.seconds, S.rate);
        /* IN THE DOCUMENT, on purpose. An <audio> element can play detached, but
           some WebKit builds will not start one that is not in the document, and
           a detached element is also invisible to any check that it exists — the
           first run of the audio gate reported "no element" while the session was
           in fact held, which is the wrong kind of surprise in this file.
           An <audio> with no `controls` renders no box, so this costs no layout;
           it is hidden from assistive tech because it is not content. */
        el.setAttribute('aria-hidden', 'true');
        el.tabIndex = -1;
        try { document.body.appendChild(el); } catch (e) { /* detached is still OK */ }
        sessionEl = el;
      }
      const p = sessionEl.play();
      if (p && typeof p.then === 'function') {
        p.then(() => { sessionOn = true; sessionFail = ''; },
          (e) => { sessionOn = false; sessionFail = (e && e.name) || 'refused'; });
      } else {
        sessionOn = true;
      }
      return true;
    } catch (e) {
      sessionFail = (e && e.name) || 'threw';
      return false;
    }
  }

  /**
   * RELEASE the session — stop it, and drop the source so nothing stays
   * decoded. Called by the toggle and by going hidden, because "silenced" has to
   * mean the phone is not holding an audio session open on our behalf. Muting a
   * still-playing element would keep the category flipped and keep the game in
   * the Now Playing state with nothing to show for it.
   */
  function stopSession() {
    sessionOn = false;
    /* hand the category back as we let the element go, so a phone whose music
       we interrupted gets it back on the same tap rather than at some later
       garbage-collection */
    declareSession();
    if (!sessionEl) return;
    try {
      sessionEl.pause();
      sessionEl.removeAttribute('src');
      sessionEl.load();
      /* and out of the document, so "sound off" leaves no trace of the override
         behind for anything to find or restart */
      if (sessionEl.parentNode) sessionEl.parentNode.removeChild(sessionEl);
    } catch (e) { /* a setting may never throw */ }
    sessionEl = null;
  }

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
      for (const st of [...beds]) st();
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
    /* THE SAME GESTURE DOES BOTH. The session flip only takes inside a real
       gesture, and this function is the one place the game guarantees it is in
       one — so start the silent element here, BEFORE the early return below.
       Putting it after would mean an already-running context (the common case
       after returning from the background) never re-armed the session. */
    ensureSession();
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
    /* re-arm the silent element too, or sound comes back from the background
       obeying the ringer switch again — the same defect, one background away.
       Silence needs no permission, and if the platform refuses it here the next
       touch runs `unlock()`, which tries again. */
    ensureSession();
    if (!ctx || ctx.state === 'running') return;
    try { ctx.resume(); } catch (e) { /* the next gesture will retry */ }
  }

  function setEnabled(on) {
    const want = !!on;
    if (settings) settings.sound = want;
    /* ---- THE TOGGLE IS THE AUTHORITY ---------------------------------
       We are deliberately overriding a device setting, so the one control she
       has inside the game must be absolute. Turning sound off RELEASES the iOS
       audio session rather than muting it: no held session, no Now Playing
       entry, nothing for the override to keep alive. Turning it back on re-arms
       from the tap itself, which is a real gesture and therefore allowed.

       Ordered so that the OFF path stops the session before anything else can
       fail, and so `settings.sound` — the persisted field (state/save.js) — is
       already written; that is what makes the choice survive a reload.

       IT BRANCHES ON `sessionWanted()`, NOT ON `want`. It used to read
       `if (want) ensureSession(); else stopSession()`, which was equivalent
       while sound was the only input to the decision and became wrong the moment
       `playOnSilent` was added: turning THAT off leaves `want` true, so the code
       took the ensure path, `ensureSession` returned early because the session
       was no longer wanted, and nothing ever called `stopSession`. The element
       stayed in the document holding *playback* — i.e. the one setting whose
       entire purpose is to give the phone's audio back would not have given it
       back until the next reload. Caught by asserting on `sessionEl` after the
       toggle rather than by trusting the flag next to it. */
    if (sessionWanted()) ensureSession(); else stopSession();
    if (!master) return want;
    try {
      /* AND STOP THE ROADS. A bed behind a zeroed master is inaudible but
         still running — oscillators, filters and an LFO per road, for a player
         who has just said she wants silence. Gain zero is a mute; this is off. */
      if (!want) { for (const st of [...beds]) st(); }
      master.gain.value = want ? AU.master : 0;
      /* AND cut the wire. Gain zero is a number somebody could ramp back over a
         tail; a disconnected node cannot make a sound at all. */
      if (want && !connected) { master.connect(limiter); connected = true; }
      else if (!want && connected) { master.disconnect(); connected = false; }
    } catch (e) { /* never let a setting throw */ }
    return want;
  }

  /**
   * GOING AWAY. Called from `visibilitychange -> hidden`. Releases the session
   * and suspends the graph, so a backgrounded game holds no audio session, keeps
   * no timers warm and cannot make a sound from her pocket. iOS suspends JS here
   * anyway, but relying on that is relying on a platform detail rather than
   * saying what we want.
   */
  function silenceForHidden() {
    stopSession();
    if (!ctx) return;
    try { ctx.suspend(); } catch (e) { /* the next gesture repairs it */ }
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
    silenceForHidden,
    /** is iOS's audio session ours right now? (verification + the debug row) */
    get sessionHeld() { return sessionOn; },

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

    /**
     * A SUSTAINED SOUND, WHICH THIS ENGINE HAS NEVER HAD (8.32.0).
     *
     * Everything else here is one-shot: `play()` schedules a recipe with an
     * envelope that ends, and nothing is ever handed back because nothing needs
     * stopping. A road has to keep going for half a minute and then stop, so it
     * needs an owner — this returns one.
     *
     * IT IS SILENT AND HARMLESS IN EVERY FAILURE MODE, exactly like `play()`,
     * and the handle is ALWAYS a real object even when nothing was built. A
     * caller that has to check whether it got a bed before it can turn one down
     * is a caller with a null check in its draw path, which is how audio ends up
     * breaking a frame — the thing the `try` in `play()` exists to prevent.
     *
     * THE HANDLE OWNS ITS OWN GAIN NODE, between the bed and `master`, so the
     * stroll can fade it with the same dissolve the road fades on without
     * touching anything the rest of the game is playing through.
     *
     * @returns {{ set(v):void, stop():void, live:boolean }}
     */
    bed(name, o) {
      const dead = { set() {}, stop() {}, get live() { return false; } };
      if (!name || !BEDS[name]) {
        if (name && !missing.has(name)) missing.add(name);
        return dead;
      }
      if (!settings || !settings.sound) return dead;
      /* the same no-autoplay rule as `play()`: nothing is built before a
         gesture, and "we were locked" is not a debt the bank owes */
      if (!ctx || ctx.state !== 'running' || !connected) return dead;

      const opt = o || {};
      let g = null;
      let stops = null;
      try {
        g = ctx.createGain();
        g.gain.value = opt.gain === undefined ? 0 : opt.gain;
        g.connect(master);
        stops = BEDS[name]({ ctx, out: g, t: ctx.currentTime + AU.lead }) || [];
      } catch (e) {
        counts.failed++;
        try { if (g) g.disconnect(); } catch (e2) { /* never mind */ }
        return dead;
      }
      beds.add(stopAll);
      let alive = true;

      function stopAll() {
        if (!alive) return;
        alive = false;
        beds.delete(stopAll);
        for (const s of stops) {
          /* a source stopped twice throws, and a source whose context has gone
             away throws differently — neither is worth a frame */
          try { s.stop(); } catch (e) { /* already done */ }
          try { s.disconnect(); } catch (e) { /* already done */ }
        }
        try { g.disconnect(); } catch (e) { /* already done */ }
      }

      return {
        set(v) {
          if (!alive || !g) return;
          const want = Math.max(0, Math.min(1, +v || 0));
          /* RAMPED, NOT ASSIGNED. This is called every frame from a spring, and
             a bare `.value =` per frame on a running graph is a zipper. */
          try {
            g.gain.setTargetAtTime(want, ctx.currentTime, AU.bedGlide);
          } catch (e) { /* the context went away underneath us */ }
        },
        stop: stopAll,
        get live() { return alive; },
      };
    },

    /** every road still playing — teardown and the gate both need this */
    get bedsLive() { return beds.size; },
    /** stop every bed, whatever owns it. The scene going away, or sound off. */
    stopBeds() { for (const s of [...beds]) s(); },

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
        /* the silent-switch override, as numbers a harness can assert on */
        overrideSilentSwitch: !!AU.overrideSilentSwitch,
        /* HER CHOICE, and what we asked the OS for as a result. `sessionType` is
           null where `navigator.audioSession` does not exist, which is most
           desktop browsers and every iOS below 16.4 — so a gate must assert on
           `sessionWanted` for behaviour and treat this as informational. */
        playOnSilent: !!(settings && settings.playOnSilent),
        sessionType: (() => {
          try { return (navigator.audioSession && navigator.audioSession.type) || null; }
          catch (e) { return null; }
        })(),
        sessionWanted: sessionWanted(),
        sessionHeld: sessionOn,
        sessionEl: !!sessionEl,
        sessionPaused: sessionEl ? !!sessionEl.paused : null,
        sessionLoop: sessionEl ? !!sessionEl.loop : null,
        sessionInline: sessionEl ? sessionEl.hasAttribute('playsinline') : null,
        sessionMuted: sessionEl ? !!sessionEl.muted : null,
        sessionSrcKind: sessionEl && sessionEl.getAttribute('src')
          ? sessionEl.getAttribute('src').slice(0, 22) : '',
        sessionFail,
        counts: { ...counts },
        voice: voice(),
        pending: [...missing],
      };
    },
  };

  return api;
}

export default createAudio;
