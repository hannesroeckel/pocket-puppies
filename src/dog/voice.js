/* ==========================================================================
   dog/voice.js — CALLING HIM. Opt-in, gesture-triggered, and nothing in the
   game may depend on it.

   WHY IT IS BUILT THIS WAY (docs/PLATFORM-RISKS.md, "MEASURED ON THE REAL
   DEVICE")
   -------------------------------------------------------------------------
   The target phone was probed — iOS 18.7, Safari 26.5.2, installed to the
   Home Screen — and it reversed both of the predictions this file was
   originally written against:

     `SpeechRecognition`  predicted blocked in installed PWAs
                          -> ACTUALLY WORKS, full accurate transcript
     raw mic samples      predicted fine as a fallback
                          -> ACTUALLY BROKEN: permission granted, live
                             "iPhone Microphone" track, ZERO samples ever
                             (WebKit bug 185448)

   So the old "mic as a loudness/pitch envelope sensor" design is unbuildable
   — there is nothing to analyse — and the technique that *is* available is
   the one we had written off. This file is therefore single-shot recognition,
   in exactly the configuration that was proven on the device:

       continuous: false      interimResults: false      maxAlternatives: 1

   `continuous` mode remains untested on iOS and is not used. Recognition is
   SERVER-SIDE, so it needs the network, and this game must work in a tunnel —
   every no-network and error path degrades to tap **in silence**.

   WHAT SURVIVES FROM THE OLD FILE, AND IT IS THE IMPORTANT PART
   ------------------------------------------------------------
   1. THE DEFENSIVE INSTINCT. The old code did not trust `getUserMedia`
      resolving; it probed for real samples. The same suspicion applies here:
      a `start()` that resolves and then never fires `result`, `error` or
      `end` is the same class of lie, so there is a watchdog, and a couple of
      dead runs retire the feature for the session rather than leaving a
      "listening" indicator up forever.
   2. THE DESIGN INTENT. **He decides whether to come based on mood and
      trust, not on recognition accuracy.** She calls, his ears prick, and he
      chooses. Recognition only ever produces a *signal*; dog/train.js rolls
      the same mood-and-trust obedience roll it rolls for a hand signal. A
      mishearing therefore reads as him being distracted, never as broken
      software.
   3. NOTHING AMBIENT. There is no always-on listening and no mic indicator
      burning in the background of a puppy game. One press, one utterance,
      one answer, mic off.

   Every failure degrades SILENTLY: no console errors, no dialogs, no toast
   unless the player is standing in the settings sheet looking at the row.
   Taps remain the primary path and are never described as a fallback.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { clamp } from '../engine/draw.js';

const V = BALANCE.train.voice;

/* ==========================================================================
   WORD MATCHING — envelope-independent, so it is fully testable with no
   microphone in the room (and is what `inject()` exercises).
   ========================================================================== */

/** lowercase, strip everything that is not a letter or a space, collapse */
export function normWord(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Levenshtein, iterative, two rows — these strings are a handful of chars */
function lev(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    const t = prev; prev = cur; cur = t;
  }
  return prev[b.length];
}

/** 0..1 similarity between two already-normalised words */
export function wordSim(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const n = Math.max(a.length, b.length);
  return n ? clamp(1 - lev(a, b) / n, 0, 1) : 0;
}

/**
 * How well a heard utterance matches a remembered word. The transcript is
 * matched whole AND token-by-token, so "sit down, good boy" still finds
 * "sit" — people do not speak in single words, and refusing to hear them
 * would read as the software being fussy rather than as the dog being a dog.
 * @returns 0..1
 */
export function utteranceSim(transcript, word) {
  const t = normWord(transcript);
  const w = normWord(word);
  if (!t || !w) return 0;
  let best = wordSim(t, w);
  for (const tok of t.split(' ')) {
    if (tok.length < V.minWordLen) continue;
    const s = wordSim(tok, w);
    if (s > best) best = s;
  }
  return best;
}

/**
 * Best remembered word for a heard utterance.
 * @param transcript what was heard
 * @param words      { [signalId]: {word, ...} } — game.cueVoice
 * @returns { sig, sim, second, ambiguous } — sig '' when nothing is close
 */
export function matchWord(transcript, words) {
  let sig = '', sim = 0, second = 0;
  for (const key of Object.keys(words || {})) {
    const rec = words[key];
    if (!rec) continue;
    /* the canonical word plus the previous few sayings of it */
    const cands = typeof rec === 'string' ? [rec]
      : [rec.word].concat(Array.isArray(rec.alts) ? rec.alts : []);
    let s = 0;
    for (const w of cands) {
      if (!w) continue;
      const v = utteranceSim(transcript, w);
      if (v > s) s = v;
    }
    if (s <= 0) continue;
    if (s > sim) { second = sim; sim = s; sig = key; }
    else if (s > second) second = s;
  }
  return { sig, sim, second, ambiguous: !!sig && (sim - second) < V.match.ambiguous };
}

/* ==========================================================================
   THE RECOGNISER
   ========================================================================== */
export function createVoice(opts = {}) {
  const onHeard = opts.onHeard || (() => {});
  const onState = opts.onState || (() => {});

  /* off | listening | heard | denied | unavailable | offline | quiet | error */
  let state = 'off';
  let rec = null;
  let listenT = 0;          // watchdog clock for the run in flight
  let cooldown = 0;
  let deadRuns = 0;         // starts that produced nothing at all, back to back
  let retired = false;      // we have stopped offering it for this session
  let lastText = '';
  let lastAt = 0;
  let heardCount = 0;
  let armed = false;        // the player has opted in
  let pending = null;       // resolve fn for the promise listen() handed out

  const SR = (() => {
    try { return window.SpeechRecognition || window.webkitSpeechRecognition || null; }
    catch (e) { return null; }
  })();
  const supported = !!SR;

  function setState(next) {
    if (state === next) return;
    state = next;
    try { onState(state); } catch (e) { /* a listener must never break audio */ }
  }

  /** true when there is no point even trying: recognition is server-side */
  function offline() {
    try { return navigator.onLine === false; } catch (e) { return false; }
  }

  function settle(result) {
    const p = pending;
    pending = null;
    if (p) { try { p(result); } catch (e) { /* ignore */ } }
    return result;
  }

  function teardown() {
    if (!rec) return;
    try { rec.onresult = rec.onerror = rec.onend = rec.onstart = rec.onnomatch = null; } catch (e) { /* ignore */ }
    try { rec.abort(); } catch (e) { /* ignore */ }
    rec = null;
  }

  /**
   * ONE utterance. MUST be called from inside a real user gesture — iOS will
   * not prompt otherwise, and an ambient recogniser is not something a puppy
   * game should ever own.
   *
   * @returns Promise<{ ok, transcript, reason }> — `ok:false` is a completely
   *   normal answer and the caller must treat it as "nothing happened",
   *   never as an error.
   */
  function listen() {
    if (retired || !supported) return Promise.resolve(settleNow('unavailable'));
    if (state === 'listening') return Promise.resolve({ ok: false, transcript: '', reason: 'busy' });
    if (cooldown > 0) return Promise.resolve({ ok: false, transcript: '', reason: 'busy' });
    /* NO NETWORK, NO RECOGNITION. Say nothing about it: the game is designed
       to be complete on a plane, and an error toast on a plane is the exact
       failure this whole file is written to avoid. */
    if (offline()) return Promise.resolve(settleNow('offline'));

    try {
      rec = new SR();
      /* THE EXACT CONFIGURATION PROVEN ON THE DEVICE. Do not "improve" these:
         `continuous` is untested on iOS and `interimResults` is documented
         unreliable there. */
      rec.continuous = false;
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      try { rec.lang = V.lang || navigator.language || 'en-US'; } catch (e) { /* ignore */ }
    } catch (e) {
      retire();
      return Promise.resolve(settleNow('unavailable'));
    }

    let got = false;
    const promise = new Promise((resolve) => { pending = resolve; });

    rec.onresult = (ev) => {
      got = true;
      deadRuns = 0;
      let text = '';
      try {
        const r = ev.results && ev.results[0] && ev.results[0][0];
        text = (r && r.transcript) || '';
      } catch (e) { text = ''; }
      finish(text);
    };
    rec.onnomatch = () => { got = true; deadRuns = 0; finish(''); };
    rec.onerror = (ev) => {
      got = true;
      const err = (ev && ev.error) || '';
      /* Every one of these is an expected answer, not a bug. */
      if (err === 'not-allowed' || err === 'service-not-allowed') { armed = false; settleNow('denied'); }
      else if (err === 'network') settleNow('offline');
      else if (err === 'audio-capture') { retire(); settleNow('unavailable'); }
      else if (err === 'no-speech' || err === 'aborted') settleNow('quiet');
      else settleNow('error');
      teardown();
    };
    rec.onend = () => {
      /* THE 185448-SHAPED FAILURE, TRANSPLANTED. A run that ends having
         produced neither a result nor an error is the recogniser lying to us
         the way the microphone did. A couple of those and we stop offering it
         rather than leaving a listening dot up forever. */
      if (!got) {
        deadRuns++;
        if (deadRuns >= V.deadRuns) retire();
        settleNow('quiet');
      }
      teardown();
    };

    try {
      listenT = 0;
      setState('listening');
      rec.start();
    } catch (e) {
      /* `start()` throws if one is already running, or if the page lost its
         gesture. Neither is worth a word to the player. */
      teardown();
      return Promise.resolve(settleNow('error'));
    }
    return promise;
  }

  /** a run that produced a transcript (possibly empty) */
  function finish(text) {
    const clean = normWord(text);
    cooldown = V.cooldown;
    teardown();
    if (!clean) { settleNow('quiet'); return; }
    lastText = clean;
    lastAt = Date.now();
    heardCount++;
    setState('heard');
    const out = { ok: true, transcript: clean, reason: '' };
    try { onHeard(clean); } catch (e) { /* a listener must never break the loop */ }
    settle(out);
  }

  /** end the run in a non-hearing state and answer the caller */
  function settleNow(reason) {
    cooldown = Math.max(cooldown, V.cooldown * 0.5);
    setState(reason);
    return settle({ ok: false, transcript: '', reason });
  }

  /** stop offering the feature for this session, in silence */
  function retire() {
    retired = true;
    armed = false;
    setState('unavailable');
  }

  /** per-frame: the watchdog and the cooldown. Cheap, and always safe to call. */
  function update(dt) {
    if (cooldown > 0) cooldown = Math.max(0, cooldown - dt);
    if (state !== 'listening') return;
    listenT += dt;
    if (listenT > V.maxListen) {
      /* neither result nor error nor end inside the window: the same lie */
      deadRuns++;
      if (deadRuns >= V.deadRuns) retire();
      teardown();
      settleNow('quiet');
    }
  }

  /** the player opting in. Does NOT prompt — the prompt belongs to `listen()`,
      which runs inside the gesture that presses "call him". */
  function arm(on) {
    if (!supported || retired) { armed = false; return false; }
    armed = !!on;
    if (!armed) { teardown(); setState('off'); }
    return armed;
  }

  function abort() {
    teardown();
    if (state === 'listening') settleNow('quiet');
  }

  return {
    get supported() { return supported; },
    get state() { return state; },
    /** the player has opted in AND it has not retired itself */
    get armed() { return armed && !retired && supported; },
    get listening() { return state === 'listening'; },
    /** true once we know it will never work here — used to word the settings row */
    get retired() { return retired || !supported; },
    /** momentary: it needs the network and there is none right now */
    get offline() { return offline(); },
    get lastText() { return lastText; },
    get lastAt() { return lastAt; },
    get heard() { return heardCount; },
    /** 0..1, purely for the little pulsing dot while a run is in flight. There
        is no real level available — raw samples do not flow on the device. */
    get level() { return state === 'listening' ? clamp(listenT / V.maxListen, 0, 1) : 0; },

    arm, listen, abort, update,

    /**
     * TEST HOOK. Feed a transcript straight in, so the whole voice path —
     * matching, mis-hearing, word learning, the obedience roll — is verifiable
     * deterministically on a machine with no microphone and no network.
     */
    inject(text) {
      const clean = normWord(text);
      if (!clean) { setState('quiet'); return false; }
      lastText = clean;
      lastAt = Date.now();
      heardCount++;
      setState('heard');
      try { onHeard(clean); } catch (e) { /* ignore */ }
      return true;
    },
    /** TEST HOOK: force a terminal state, to exercise the degrade paths */
    simulate(reason) {
      if (reason === 'unavailable') retire();
      else setState(reason);
      return state;
    },

    get debug() {
      return {
        state, supported, armed: armed && !retired, retired,
        offline: offline(), heard: heardCount, deadRuns,
        last: lastText, cooldown: +cooldown.toFixed(2),
      };
    },
  };
}

export default createVoice;
