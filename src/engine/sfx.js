/* ==========================================================================
   engine/sfx.js — THE SOUND BANK. Every sound in the game is synthesised here.

   THE BRIEF (research §1.9): Nintendogs was *quiet*. Little music, lots of
   room. Distinct yips, whines, contented panting, the claw-click of paws on
   floorboards, a toy squeak, the slop of drinking water. So this is foley, not
   a soundtrack — there is no music in this file and there should never be. The
   loudest thing in the game is the dog.

   NO ASSET FILES, EVER (ARCHITECTURE §1). Everything below is oscillators and
   filtered noise, which is why the whole game is still a few hundred KB and why
   there is nothing to fail to download in a tunnel.

   THE ONE STRUCTURAL IDEA: **one shared vocal bank, pitch-shifted per dog.**
   Every bark, yip, whine, grumble and sigh goes through `vocal()`, and the
   per-dog identity (`voiceFor`) is applied inside it and nowhere else. That is
   what makes "his voice" a property of the animal rather than of forty separate
   recipes that would drift apart — and it costs one multiply. Research §1.9
   calls this out as doing "enormous work for individuality at near-zero cost",
   and it is the reason he sounds like the same individual every session.

   WHERE THE NUMBERS LIVE. The *design* tunables — master volume, the retrigger
   floors, how far apart two dogs' voices can be, the panting cadence, the
   per-family gain trims — are in `BALANCE.audio`. The oscillator frequencies
   and envelope shapes are **art data** and live here, by the same precedent
   ARCHITECTURE §11.1(G) set for colour ramps in `dog/breeds.js` and marking
   geometry in `dog/draw.js`: moving a bandpass centre frequency into
   `balance.js` would make that file unreadable without making anything
   tunable, because nobody adjusts a formant from a spreadsheet.
   ========================================================================== */
import BALANCE from '../state/balance.js';

const AU = BALANCE.audio;

/* ==========================================================================
   per-dog vocal identity
   ========================================================================== */
/** FNV-1a over the dog id. Any stable hash does; this one is short and honest. */
function hash(str) {
  let h = 0x811c9dc5;
  const s = String(str === undefined || str === null ? '' : str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 — small, decent, and deterministic, which is the whole point */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VOICE_CACHE = new Map();

/**
 * HIS VOICE. Derived from the dog's persisted `id`, so it is identical in every
 * session for ever without adding a single byte to the save — which also means
 * no schema bump and no migration, and an imported save from another device
 * brings the right voice with it.
 *
 * Five axes, all applied inside `vocal()`:
 *   pitch   — the obvious one: how high he is, in semitones either way
 *   bright  — formant placement. A small dog is not just a high dog.
 *   rasp    — how much breath is in the sound
 *   wob     — vibrato depth on the held sounds (whines especially)
 *   len     — a slight speech-rate difference, so two dogs' yips do not land
 *             on the same grid even at the same pitch
 */
export function voiceFor(dogId) {
  const key = String(dogId === undefined ? '' : dogId);
  const hit = VOICE_CACHE.get(key);
  if (hit) return hit;
  const V = AU.voice;
  const r = seeded(hash(key));
  const sym = () => r() * 2 - 1;
  const out = {
    id: key,
    semis: +(V.semis * sym()).toFixed(3),
    pitch: 1,
    bright: 1 + V.bright * sym(),
    rasp: V.raspLo + (V.raspHi - V.raspLo) * r(),
    wob: V.wobLo + (V.wobHi - V.wobLo) * r(),
    len: V.lenLo + (V.lenHi - V.lenLo) * r(),
  };
  out.pitch = Math.pow(2, out.semis / 12);
  if (VOICE_CACHE.size > 32) VOICE_CACHE.clear();
  VOICE_CACHE.set(key, out);
  return out;
}

/** the neutral voice, for anything that is not a dog (props, water, bowls) */
export const NEUTRAL = { id: '', semis: 0, pitch: 1, bright: 1, rasp: 0.2, wob: 0.7, len: 1 };

/* ==========================================================================
   primitives
   ========================================================================== */
const NOISE = new WeakMap();
/** two seconds of white noise, made once per context and reused by everything */
function noiseBuf(ctx) {
  let b = NOISE.get(ctx);
  if (b) return b;
  const n = Math.max(1, Math.floor(ctx.sampleRate * 2));
  b = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  NOISE.set(ctx, b);
  return b;
}

/**
 * One amplitude envelope, and the reason it is a function: WebAudio's
 * `exponentialRampToValueAtTime` throws on a target of exactly 0 and silently
 * does nothing from a value of exactly 0, which is the classic way a
 * hand-written synth ends up either crashing or emitting one flat click. So
 * every envelope here starts and ends at a small positive number.
 */
function env(p, t, dur, o) {
  const peak = Math.max(0.00012, o.gain === undefined ? 0.3 : o.gain);
  const a = Math.max(0.0006, Math.min(o.a === undefined ? 0.006 : o.a, dur * 0.55));
  p.setValueAtTime(0.00012, t);
  p.linearRampToValueAtTime(peak, t + a);
  if (o.sus !== undefined && o.sus > 0) {
    const dEnd = Math.min(dur * 0.9, a + (o.d === undefined ? 0.05 : o.d));
    p.linearRampToValueAtTime(Math.max(0.00012, peak * o.sus), t + dEnd);
  }
  p.exponentialRampToValueAtTime(0.00012, t + dur);
}

/** filtered noise: the backbone of every piece of foley in the game */
function noise(ctx, out, o) {
  const t = o.t;
  const dur = Math.max(0.012, o.dur);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf(ctx);
  src.loop = true;
  if (o.rate) src.playbackRate.value = o.rate;
  let node = src;
  if (o.f) {
    const bp = ctx.createBiquadFilter();
    bp.type = o.type || 'bandpass';
    bp.Q.value = o.q === undefined ? 1 : o.q;
    bp.frequency.setValueAtTime(Math.max(20, o.f), t);
    if (o.f2) bp.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + dur);
    node.connect(bp);
    node = bp;
  }
  if (o.hp) {
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = o.hp;
    node.connect(hp);
    node = hp;
  }
  const g = ctx.createGain();
  env(g.gain, t, dur, o);
  node.connect(g);
  g.connect(out);
  /* a random offset into the buffer, or every burst is the same burst */
  src.start(t, Math.random() * 1.7, dur + 0.06);
  try { src.stop(t + dur + 0.07); } catch (e) { /* already scheduled to end */ }
  /* amplitude modulation: what turns a hiss into scrubbing or panting */
  if (o.am) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = o.amHz || 9;
    const la = ctx.createGain();
    la.gain.value = Math.min(0.95, o.am) * (o.gain === undefined ? 0.3 : o.gain);
    lfo.connect(la);
    la.connect(g.gain);
    lfo.start(t);
    lfo.stop(t + dur + 0.03);
  }
  return g;
}

/** one oscillator with an optional pitch contour, filter and vibrato */
function tone(ctx, out, o) {
  const t = o.t;
  const dur = Math.max(0.012, o.dur);
  const osc = ctx.createOscillator();
  osc.type = o.type || 'triangle';
  const f0 = Math.max(20, o.f);
  osc.frequency.setValueAtTime(f0, t);
  if (o.fMid) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.fMid), t + dur * (o.midAt || 0.26));
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2 || f0), t + dur);
  } else if (o.f2) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + dur);
  }
  let node = osc;
  if (o.bp) {
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = Math.max(30, o.bp);
    f.Q.value = o.q === undefined ? 1.2 : o.q;
    node.connect(f);
    node = f;
  }
  if (o.lp) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = Math.max(40, o.lp);
    node.connect(f);
    node = f;
  }
  const g = ctx.createGain();
  env(g.gain, t, dur, o);
  node.connect(g);
  g.connect(out);
  if (o.vib) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = o.vibHz || 15;
    const la = ctx.createGain();
    la.gain.value = o.vib;
    lfo.connect(la);
    la.connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.03);
  }
  osc.start(t);
  try { osc.stop(t + dur + 0.03); } catch (e) { /* already scheduled */ }
  return g;
}

/**
 * THE SHARED VOCAL BANK — and the ONLY place the per-dog voice is applied.
 *
 * A dog's voice is a larynx tone plus a resonance plus breath, so that is
 * literally what this builds: a fundamental with a pitch contour, a quiet
 * second partial for buzz, and a band of noise whose level is how raspy this
 * particular animal is. Every vocal name in the bank is one call to this with
 * a different contour, which is why they all sound like the same dog.
 */
function vocal(ctx, out, V, o) {
  const t = o.t;
  const dur = Math.max(0.02, o.dur * V.len);
  const f = o.f * V.pitch;
  const f2 = (o.f2 || o.f) * V.pitch;
  const fMid = o.fMid ? o.fMid * V.pitch : 0;
  const gain = o.gain === undefined ? 0.26 : o.gain;
  const formant = (o.formant || 1450) * V.bright;

  tone(ctx, out, {
    t, dur, f, f2, fMid, midAt: o.midAt, type: o.type || 'triangle',
    gain, a: o.a, sus: o.sus, d: o.d, bp: formant, q: o.q === undefined ? 1.05 : o.q,
    vib: o.vib ? o.vib * V.wob * f * 0.018 : 0, vibHz: o.vibHz,
  });
  /* the buzz. Sawtooth an octave up through a tighter band: a pure tone reads
     as a whistle, and a dog is not a whistle. */
  tone(ctx, out, {
    t, dur: dur * 0.94, f: f * 1.99, f2: f2 * 1.99, fMid: fMid ? fMid * 1.99 : 0,
    midAt: o.midAt, type: 'sawtooth', gain: gain * (o.buzz === undefined ? 0.15 : o.buzz),
    a: o.a, sus: o.sus, bp: formant * 1.55, q: 2.2,
  });
  /* breath */
  const br = o.breath === undefined ? 0.75 : o.breath;
  if (br > 0) {
    noise(ctx, out, {
      t, dur: dur * 0.92, gain: gain * V.rasp * br,
      f: 1000 * V.bright, f2: 520 * V.bright, q: 0.85,
    });
  }
}

/* small foley helpers, used by several recipes each ---------------------- */

/** a soft body impact: the floor, a cushion, a paw landing */
function thud(ctx, out, t, { g = 0.34, f = 92, dur = 0.15, body = 0.55 } = {}) {
  tone(ctx, out, { t, dur, f, f2: f * 0.55, type: 'sine', gain: g, a: 0.003, lp: 320 });
  noise(ctx, out, { t, dur: dur * body, gain: g * 0.5, f: 220, f2: 110, q: 0.7, type: 'lowpass' });
}

/** the claw-click of one paw on a floorboard — the sound research asks for */
function claw(ctx, out, t, { g = 0.16, f = 3200 } = {}) {
  noise(ctx, out, { t, dur: 0.022, gain: g, f, f2: f * 0.55, q: 1.9, a: 0.001 });
  tone(ctx, out, { t, dur: 0.03, f: f * 0.42, f2: f * 0.2, type: 'triangle', gain: g * 0.4, a: 0.001 });
}

/** the collar tag: two dissonant partials, fast decay. Metal, not a chime. */
function jingle(ctx, out, t, { g = 0.11, n = 3, spread = 0.05 } = {}) {
  for (let i = 0; i < n; i++) {
    const tt = t + i * spread * (0.6 + Math.random() * 0.8);
    const f = 2650 + Math.random() * 1350;
    tone(ctx, out, { t: tt, dur: 0.09, f, f2: f * 0.94, type: 'triangle', gain: g, a: 0.001 });
    tone(ctx, out, { t: tt, dur: 0.06, f: f * 1.47, type: 'sine', gain: g * 0.5, a: 0.001 });
  }
}

/** fabric / fur rustle */
function rustle(ctx, out, t, { g = 0.1, dur = 0.18, f = 2100 } = {}) {
  noise(ctx, out, { t, dur, gain: g, f, f2: f * 0.45, q: 0.8, am: 0.5, amHz: 26 });
}

/** ceramic: a bowl. Two inharmonic partials is the whole trick. */
function ceramic(ctx, out, t, { g = 0.15, f = 1180 } = {}) {
  tone(ctx, out, { t, dur: 0.30, f, type: 'sine', gain: g, a: 0.001 });
  tone(ctx, out, { t, dur: 0.20, f: f * 1.51, type: 'sine', gain: g * 0.45, a: 0.001 });
  tone(ctx, out, { t, dur: 0.12, f: f * 2.36, type: 'sine', gain: g * 0.2, a: 0.001 });
}

/** a wet mouth sound: the slop of drinking, a lick, a lap */
function wet(ctx, out, t, { g = 0.2, dur = 0.1, f = 900, f2 = 320 } = {}) {
  noise(ctx, out, { t, dur, gain: g, f, f2, q: 1.5, a: 0.002 });
  tone(ctx, out, { t, dur: dur * 0.8, f: f * 0.45, f2: f2 * 0.5, type: 'sine', gain: g * 0.55, a: 0.002 });
}

/** air moving past something thrown */
function whoosh(ctx, out, t, { g = 0.16, dur = 0.26, f = 500, f2 = 1900 } = {}) {
  noise(ctx, out, { t, dur, gain: g, f, f2, q: 0.9, a: dur * 0.35, sus: 0.9 });
}

/** rubber squeak: the toy. A fast pitch rise is what makes it read as rubber. */
function squeak(ctx, out, t, { g = 0.17, dur = 0.13, f = 620, f2 = 1650 } = {}) {
  tone(ctx, out, { t, dur, f, fMid: f2, midAt: 0.55, f2: f2 * 0.82, type: 'triangle', gain: g, bp: f2 * 1.2, q: 2.2 });
  noise(ctx, out, { t, dur: dur * 0.5, gain: g * 0.18, f: 2600, f2: 1500, q: 1.2 });
}

/* ==========================================================================
   THE BANK
   Each recipe takes ({ ctx, out, t, V, g }) — `V` is the dog's voice, `g` a
   gain multiplier from BALANCE.audio.gain. Nothing here reads global state, so
   any recipe can be fired in isolation and verified.
   ========================================================================== */
export const RECIPES = {
  /* ---- vocal ---------------------------------------------------------- */
  /** the bread-and-butter happy noise */
  yip: (K) => vocal(K.ctx, K.out, K.V, {
    t: K.t, dur: 0.11, f: 620, fMid: 880, midAt: 0.22, f2: 690,
    gain: 0.30 * K.g, a: 0.005, formant: 1700,
  }),
  /** louder, lower, and with a real transient — used by the reunion */
  bark: (K) => {
    vocal(K.ctx, K.out, K.V, {
      t: K.t, dur: 0.17, f: 340, fMid: 470, midAt: 0.14, f2: 250,
      gain: 0.40 * K.g, a: 0.003, formant: 1150, q: 0.9, buzz: 0.30, breath: 0.9,
    });
    noise(K.ctx, K.out, { t: K.t, dur: 0.045, gain: 0.16 * K.g, f: 1500, f2: 700, q: 0.8, a: 0.001 });
  },
  /** the one that has to sound like asking, not complaining */
  whine: (K) => vocal(K.ctx, K.out, K.V, {
    t: K.t, dur: 0.58, f: 500, fMid: 780, midAt: 0.34, f2: 560,
    gain: 0.19 * K.g, a: 0.06, sus: 0.85, d: 0.22, formant: 1900,
    vib: 1.5, vibHz: 13, breath: 0.5,
  }),
  /** a hard exhale through the nose. Almost all breath, barely any tone. */
  huff: (K) => {
    noise(K.ctx, K.out, { t: K.t, dur: 0.22, gain: 0.20 * K.g, f: 700 * K.V.bright, f2: 340, q: 0.7, a: 0.006 });
    vocal(K.ctx, K.out, K.V, { t: K.t, dur: 0.14, f: 210, f2: 165, gain: 0.10 * K.g, a: 0.01, formant: 800, breath: 1.2 });
  },
  /** startled, and it must never sound like pain — short and up, not down */
  yelp: (K) => vocal(K.ctx, K.out, K.V, {
    t: K.t, dur: 0.13, f: 780, fMid: 1180, midAt: 0.16, f2: 900,
    gain: 0.28 * K.g, a: 0.002, formant: 2200, q: 1.4,
  }),
  /** contented, low, unbothered — the sound of being pleased with himself */
  praise: (K) => {
    vocal(K.ctx, K.out, K.V, {
      t: K.t, dur: 0.40, f: 330, fMid: 400, midAt: 0.3, f2: 260,
      gain: 0.17 * K.g, a: 0.05, sus: 0.8, d: 0.14, formant: 1050, breath: 1.0, vib: 0.5, vibHz: 7,
    });
    RECIPES.pant({ ...K, t: K.t + 0.34, g: K.g * 0.7 });
  },
  /** two yips, the second higher: the shape of showing off */
  'proud-yip': (K) => {
    vocal(K.ctx, K.out, K.V, { t: K.t, dur: 0.10, f: 640, fMid: 900, midAt: 0.2, f2: 720, gain: 0.29 * K.g, a: 0.004, formant: 1750 });
    vocal(K.ctx, K.out, K.V, { t: K.t + 0.13, dur: 0.12, f: 760, fMid: 1120, midAt: 0.2, f2: 860, gain: 0.31 * K.g, a: 0.004, formant: 1950 });
  },
  sneeze: (K) => {
    /* the intake, then the burst. Without the intake it is just a hiss. */
    noise(K.ctx, K.out, { t: K.t, dur: 0.07, gain: 0.07 * K.g, f: 600, f2: 1300, q: 0.7, a: 0.05, sus: 0.9 });
    noise(K.ctx, K.out, { t: K.t + 0.075, dur: 0.19, gain: 0.30 * K.g, f: 2600, f2: 800, q: 0.6, a: 0.002 });
    vocal(K.ctx, K.out, K.V, { t: K.t + 0.075, dur: 0.11, f: 560, f2: 300, gain: 0.14 * K.g, a: 0.002, formant: 1500 });
  },
  /** a tiny air-snap of teeth. Playful, never aggressive. */
  nip: (K) => {
    noise(K.ctx, K.out, { t: K.t, dur: 0.028, gain: 0.14 * K.g, f: 2400, f2: 1100, q: 1.6, a: 0.001 });
    vocal(K.ctx, K.out, K.V, { t: K.t + 0.01, dur: 0.07, f: 700, f2: 520, gain: 0.15 * K.g, a: 0.002, formant: 1900, breath: 0.4 });
  },
  /** CONTENTED PANTING — research §1.9 names it and nothing in the game asked
      for it, so `scenes/room.js` drives it off `rig.drive.pant`. Two puffs. */
  pant: (K) => {
    const w = 1 / K.V.len;
    noise(K.ctx, K.out, { t: K.t, dur: 0.085 * K.V.len, gain: 0.13 * K.g, f: 1250 * K.V.bright, f2: 620, q: 0.8, a: 0.012 });
    noise(K.ctx, K.out, { t: K.t + 0.135 * K.V.len, dur: 0.065 * K.V.len, gain: 0.09 * K.g, f: 950 * K.V.bright, f2: 1500, q: 0.9, a: 0.008 });
    tone(K.ctx, K.out, { t: K.t, dur: 0.07, f: 240 * K.V.pitch * w, f2: 180 * K.V.pitch, type: 'sine', gain: 0.035 * K.g, a: 0.01 });
  },
  /** displeasure, and specifically NOT a growl. He is annoyed, not resentful —
      which is principle 1 of the whole design, in a sound. */
  grumble: (K) => {
    tone(K.ctx, K.out, {
      t: K.t, dur: 0.42, f: 118 * K.V.pitch, f2: 96 * K.V.pitch, type: 'sawtooth',
      gain: 0.16 * K.g, a: 0.03, sus: 0.8, d: 0.14, lp: 620 * K.V.bright,
      vib: 9 * K.V.wob, vibHz: 26,
    });
    noise(K.ctx, K.out, { t: K.t, dur: 0.4, gain: 0.07 * K.g, f: 420, f2: 260, q: 0.9, a: 0.04, sus: 0.8, am: 0.6, amHz: 24 });
  },

  /* ---- body foley ----------------------------------------------------- */
  'sit-thump': (K) => {
    thud(K.ctx, K.out, K.t, { g: 0.30 * K.g, f: 96, dur: 0.16 });
    jingle(K.ctx, K.out, K.t + 0.01, { g: 0.07 * K.g, n: 2, spread: 0.04 });
  },
  flop: (K) => {
    thud(K.ctx, K.out, K.t, { g: 0.34 * K.g, f: 78, dur: 0.22, body: 0.75 });
    rustle(K.ctx, K.out, K.t + 0.01, { g: 0.11 * K.g, dur: 0.24, f: 1700 });
    jingle(K.ctx, K.out, K.t + 0.02, { g: 0.06 * K.g, n: 3, spread: 0.045 });
  },
  land: (K) => {
    thud(K.ctx, K.out, K.t, { g: 0.30 * K.g, f: 104, dur: 0.14 });
    claw(K.ctx, K.out, K.t + 0.008, { g: 0.13 * K.g });
    claw(K.ctx, K.out, K.t + 0.032, { g: 0.10 * K.g, f: 2700 });
    jingle(K.ctx, K.out, K.t + 0.015, { g: 0.07 * K.g, n: 2, spread: 0.04 });
  },
  launch: (K) => {
    whoosh(K.ctx, K.out, K.t, { g: 0.11 * K.g, dur: 0.2, f: 380, f2: 1500 });
    noise(K.ctx, K.out, { t: K.t, dur: 0.05, gain: 0.10 * K.g, f: 260, f2: 150, q: 0.7, a: 0.002 });
    vocal(K.ctx, K.out, K.V, { t: K.t, dur: 0.09, f: 300, f2: 380, gain: 0.11 * K.g, a: 0.004, formant: 1000, breath: 1.3 });
  },
  /** FOUR PAWS ON FLOORBOARDS. Uneven on purpose: a metronome reads as a
      machine, and a scamper is the one sound in the game that is pure gait. */
  scamper: (K) => {
    const n = 5 + ((Math.random() * 3) | 0);
    let t = K.t;
    for (let i = 0; i < n; i++) {
      claw(K.ctx, K.out, t, { g: (0.15 - i * 0.008) * K.g, f: 2600 + Math.random() * 1500 });
      t += 0.048 + Math.random() * 0.034;
    }
    noise(K.ctx, K.out, { t: K.t, dur: t - K.t, gain: 0.035 * K.g, f: 900, f2: 1400, q: 0.6, a: 0.03, sus: 0.8 });
  },
  /** the whole-body shake: fur, collar, and the flap of ears */
  shake: (K) => {
    rustle(K.ctx, K.out, K.t, { g: 0.15 * K.g, dur: 0.34, f: 2400 });
    jingle(K.ctx, K.out, K.t, { g: 0.11 * K.g, n: 6, spread: 0.052 });
  },
  /** the same, soaking wet, which is mostly a spray of water */
  'shake-big': (K) => {
    rustle(K.ctx, K.out, K.t, { g: 0.17 * K.g, dur: 0.46, f: 2000 });
    jingle(K.ctx, K.out, K.t, { g: 0.13 * K.g, n: 8, spread: 0.055 });
    noise(K.ctx, K.out, { t: K.t, dur: 0.5, gain: 0.17 * K.g, f: 2600, f2: 5200, q: 0.5, a: 0.02, sus: 0.7, am: 0.45, amHz: 17 });
  },
  /** his nose on the lens. iOS has no haptics, so this carries the thump. */
  boop: (K) => {
    tone(K.ctx, K.out, { t: K.t, dur: 0.1, f: 190, f2: 118, type: 'sine', gain: 0.26 * K.g, a: 0.002, lp: 420 });
    noise(K.ctx, K.out, { t: K.t, dur: 0.05, gain: 0.10 * K.g, f: 340, f2: 180, q: 0.8, a: 0.001 });
    noise(K.ctx, K.out, { t: K.t + 0.005, dur: 0.09, gain: 0.05 * K.g, f: 1500, f2: 900, q: 0.9, a: 0.008 });
  },
  /** an ear coming up. A tag tick, deliberately almost too quiet to notice —
      it is the sound of ATTENTION, and attention is not an announcement. */
  perk: (K) => {
    jingle(K.ctx, K.out, K.t, { g: 0.055 * K.g, n: 1 });
    noise(K.ctx, K.out, { t: K.t, dur: 0.05, gain: 0.035 * K.g, f: 1900, f2: 3000, q: 1.1, a: 0.006 });
  },
  /** a paw placed in a hand */
  'paw-offer': (K) => {
    noise(K.ctx, K.out, { t: K.t, dur: 0.07, gain: 0.11 * K.g, f: 700, f2: 340, q: 0.8, a: 0.004 });
    claw(K.ctx, K.out, K.t + 0.004, { g: 0.06 * K.g, f: 2200 });
    vocal(K.ctx, K.out, K.V, { t: K.t + 0.02, dur: 0.08, f: 560, f2: 640, gain: 0.09 * K.g, a: 0.006, formant: 1600, breath: 0.5 });
  },

  /* ---- her hand ------------------------------------------------------- */
  /** a pat. Quiet: petting fires this constantly, and a loud pat would be the
      single most irritating sound in the game. */
  pat: (K) => {
    noise(K.ctx, K.out, { t: K.t, dur: 0.055, gain: 0.075 * K.g, f: 420, f2: 220, q: 0.7, a: 0.002 });
    tone(K.ctx, K.out, { t: K.t, dur: 0.05, f: 150, f2: 105, type: 'sine', gain: 0.05 * K.g, a: 0.002, lp: 300 });
  },
  /** a pat on a place he loves — the pat plus a tiny pleased murmur */
  'pat-sweet': (K) => {
    RECIPES.pat(K);
    vocal(K.ctx, K.out, K.V, {
      t: K.t + 0.02, dur: 0.17, f: 300, fMid: 355, midAt: 0.3, f2: 268,
      gain: 0.10 * K.g, a: 0.03, sus: 0.85, d: 0.07, formant: 1050, breath: 0.8, vib: 0.4, vibHz: 8,
    });
  },
  /** the softest thing in the bank: a tap on a place he does not mind */
  'pat-soft': (K) => {
    noise(K.ctx, K.out, { t: K.t, dur: 0.045, gain: 0.055 * K.g, f: 380, f2: 210, q: 0.7, a: 0.002 });
  },
  /** the hand signal landing. A wooden tick — she is not tapping a button. */
  cue: (K) => {
    noise(K.ctx, K.out, { t: K.t, dur: 0.03, gain: 0.09 * K.g, f: 1100, f2: 600, q: 1.5, a: 0.001 });
    tone(K.ctx, K.out, { t: K.t, dur: 0.055, f: 640, f2: 420, type: 'triangle', gain: 0.07 * K.g, a: 0.001, lp: 1800 });
  },

  /* ---- food, water, bath, brush --------------------------------------- */
  'bowl-lift': (K) => {
    ceramic(K.ctx, K.out, K.t, { g: 0.10 * K.g, f: 1240 });
    noise(K.ctx, K.out, { t: K.t, dur: 0.08, gain: 0.05 * K.g, f: 900, f2: 1600, q: 0.9, a: 0.02 });
  },
  'bowl-set': (K) => {
    ceramic(K.ctx, K.out, K.t, { g: 0.15 * K.g, f: 1120 });
    thud(K.ctx, K.out, K.t, { g: 0.13 * K.g, f: 150, dur: 0.09, body: 0.4 });
  },
  /** dry kibble arriving in a ceramic bowl: many tiny grains, thinning out */
  'kibble-pour': (K) => {
    const n = 9;
    for (let i = 0; i < n; i++) {
      const t = K.t + i * (0.026 + Math.random() * 0.02);
      noise(K.ctx, K.out, {
        t, dur: 0.03, gain: (0.075 - i * 0.005) * K.g,
        f: 2200 + Math.random() * 2600, f2: 1200, q: 1.6, a: 0.001,
      });
    }
    ceramic(K.ctx, K.out, K.t + 0.03, { g: 0.045 * K.g, f: 1400 });
  },
  'eat-start': (K) => {
    wet(K.ctx, K.out, K.t, { g: 0.13 * K.g, dur: 0.09, f: 1100, f2: 420 });
    RECIPES.crunch({ ...K, t: K.t + 0.06, g: K.g * 0.8 });
  },
  /** THE CRUNCH. Granular, irregular, and short — it must not read as gravel. */
  crunch: (K) => {
    const n = 4 + ((Math.random() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const t = K.t + i * (0.032 + Math.random() * 0.026);
      noise(K.ctx, K.out, {
        t, dur: 0.035 + Math.random() * 0.02, gain: (0.13 - i * 0.012) * K.g,
        f: 1300 + Math.random() * 2200, f2: 700, q: 1.3, a: 0.001,
      });
    }
    tone(K.ctx, K.out, { t: K.t, dur: 0.08, f: 230, f2: 150, type: 'sine', gain: 0.045 * K.g, a: 0.003, lp: 420 });
  },
  lick: (K) => wet(K.ctx, K.out, K.t, { g: 0.16 * K.g, dur: 0.15, f: 1400, f2: 380 }),
  /** THE SLOP OF DRINKING WATER, which research §1.9 names explicitly */
  lap: (K) => {
    wet(K.ctx, K.out, K.t, { g: 0.19 * K.g, dur: 0.085, f: 1000, f2: 300 });
    tone(K.ctx, K.out, { t: K.t + 0.01, dur: 0.06, f: 430, f2: 190, type: 'sine', gain: 0.09 * K.g, a: 0.002, lp: 900 });
    noise(K.ctx, K.out, { t: K.t + 0.05, dur: 0.06, gain: 0.05 * K.g, f: 2400, f2: 1300, q: 1.1, a: 0.004 });
  },
  /** the tap running for the bath */
  'water-on': (K) => noise(K.ctx, K.out, {
    t: K.t, dur: 0.72, gain: 0.13 * K.g, f: 1500, f2: 2400, q: 0.45,
    a: 0.09, sus: 0.85, d: 0.2, am: 0.3, amHz: 6.5,
  }),
  /** water poured from a jug — narrower, and it falls in pitch as it empties */
  'water-pour': (K) => {
    noise(K.ctx, K.out, { t: K.t, dur: 0.42, gain: 0.11 * K.g, f: 1900, f2: 1100, q: 0.7, a: 0.05, sus: 0.85, am: 0.4, amHz: 11 });
    tone(K.ctx, K.out, { t: K.t, dur: 0.4, f: 620, f2: 430, type: 'sine', gain: 0.035 * K.g, a: 0.06, sus: 0.8, lp: 1400 });
  },
  /** a hand working shampoo into a coat */
  scrub: (K) => noise(K.ctx, K.out, {
    t: K.t, dur: 0.3, gain: 0.10 * K.g, f: 1800, f2: 3000, q: 0.6,
    a: 0.03, sus: 0.85, am: 0.7, amHz: 9.5,
  }),
  /** foam. High, fine, and it fades rather than stops. */
  suds: (K) => noise(K.ctx, K.out, {
    t: K.t, dur: 0.55, gain: 0.075 * K.g, f: 5200, f2: 3200, q: 0.4,
    a: 0.04, sus: 0.7, am: 0.55, amHz: 19,
  }),
  /** THE SWISH OF A BRUSH: up through the coat, then out of it */
  brush: (K) => {
    noise(K.ctx, K.out, { t: K.t, dur: 0.24, gain: 0.11 * K.g, f: 1200, f2: 2900, q: 0.7, a: 0.05, sus: 0.9 });
    noise(K.ctx, K.out, { t: K.t + 0.02, dur: 0.16, gain: 0.045 * K.g, f: 3400, f2: 1800, q: 1.1, a: 0.03 });
  },
  'grumble-brush': (K) => RECIPES.grumble(K),

  /* ---- the toy -------------------------------------------------------- */
  'toy-pick': (K) => squeak(K.ctx, K.out, K.t, { g: 0.15 * K.g }),
  'toy-grab': (K) => {
    squeak(K.ctx, K.out, K.t, { g: 0.17 * K.g, dur: 0.16, f: 560, f2: 1500 });
    noise(K.ctx, K.out, { t: K.t, dur: 0.05, gain: 0.07 * K.g, f: 900, f2: 500, q: 0.9, a: 0.002 });
  },
  'toy-drop': (K) => {
    tone(K.ctx, K.out, { t: K.t, dur: 0.11, f: 260, f2: 150, type: 'sine', gain: 0.16 * K.g, a: 0.002, lp: 600 });
    squeak(K.ctx, K.out, K.t + 0.015, { g: 0.06 * K.g, dur: 0.09, f: 700, f2: 950 });
  },
  'toy-throw': (K) => {
    whoosh(K.ctx, K.out, K.t, { g: 0.13 * K.g, dur: 0.28, f: 420, f2: 2100 });
    squeak(K.ctx, K.out, K.t, { g: 0.07 * K.g, dur: 0.1, f: 700, f2: 1200 });
  },
  /** a rubber ball bouncing: the pitch of a bounce RISES as it loses height */
  'toy-land': (K) => {
    for (let i = 0; i < 3; i++) {
      const t = K.t + i * (0.11 - i * 0.022);
      tone(K.ctx, K.out, {
        t, dur: 0.09 - i * 0.02, f: 250 + i * 70, f2: 150 + i * 50,
        type: 'sine', gain: (0.15 - i * 0.05) * K.g, a: 0.002, lp: 700,
      });
      noise(K.ctx, K.out, { t, dur: 0.03, gain: (0.05 - i * 0.016) * K.g, f: 1200, f2: 600, q: 1.0, a: 0.001 });
    }
  },

  /* ---- the moment a trick lands -------------------------------------- */
  /** DELIBERATELY NOT A JINGLE. A reward chime would be the one musical thing
      in a foley game, and it would turn "he did it" into "you scored". So it is
      him being pleased, plus his tail hitting the floor. */
  'trick-done': (K) => {
    RECIPES['proud-yip'](K);
    for (let i = 0; i < 3; i++) {
      thud(K.ctx, K.out, K.t + 0.16 + i * 0.13, { g: (0.11 - i * 0.02) * K.g, f: 84, dur: 0.11, body: 0.5 });
    }
  },
};

/* ==========================================================================
   name resolution — the families
   ========================================================================== */
/**
 * Petting fires `pet-<zone>` on every tap and `grumble-<zone>` on a bad spot,
 * and training fires `trick-<id>`. Rather than 21 near-identical recipes, the
 * families map onto shared ones with per-member trims — which also means a new
 * zone or a new trick gets a sensible sound for free instead of silence.
 */
const PET_ZONE = {
  /* sweet: he leans in and murmurs */
  ear: { r: 'pat-sweet', g: 1.05 }, chin: { r: 'pat-sweet', g: 1.0 },
  neck: { r: 'pat-sweet', g: 0.95 }, chest: { r: 'pat-sweet', g: 1.0 },
  /* ok: just the contact */
  head: { r: 'pat', g: 1.0 }, back: { r: 'pat', g: 0.95 }, belly: { r: 'pat', g: 1.05 },
  /* the bad spots normally arrive as `grumble-*`, but a tap can resolve here
     when the zone is not yet irritated, and silence would read as a dead spot */
  muz: { r: 'pat-soft', g: 1.0 }, tail: { r: 'pat-soft', g: 1.0 }, paw: { r: 'pat-soft', g: 1.0 },
};

/** the effort in his voice as each trick lands. Deeper trick, more effort. */
const TRICK_VOICE = {
  sit: { r: 'huff', g: 0.7 },
  lieDown: { r: 'huff', g: 0.85 },
  beg: { r: 'yip', g: 0.8 },
  shake: { r: 'yip', g: 0.7 },
  spin: { r: 'yip', g: 1.0 },
  jump: { r: 'launch', g: 1.0 },
  rollOver: { r: 'grumble', g: 0.5 },
  playDead: { r: 'whine', g: 0.55 },
};

/**
 * Resolve a name the game asks for into `{ recipe, gain }`, or null.
 *
 * Returning null is meaningful: `engine/audio.js` records it in `pending`, which
 * is how every previous stage handed this one a list of what it owed. A silent
 * fallback would have hidden that.
 */
export function resolve(name) {
  const trim = AU.gain || {};
  const direct = RECIPES[name];
  if (direct) return { recipe: direct, gain: trim[name] === undefined ? 1 : trim[name] };

  if (name.indexOf('pet-') === 0) {
    const z = PET_ZONE[name.slice(4)] || { r: 'pat', g: 1 };
    return { recipe: RECIPES[z.r], gain: z.g * (trim.pet === undefined ? 1 : trim.pet) };
  }
  if (name.indexOf('grumble-') === 0) {
    return { recipe: RECIPES.grumble, gain: trim.grumble === undefined ? 1 : trim.grumble };
  }
  if (name.indexOf('trick-') === 0) {
    const v = TRICK_VOICE[name.slice(6)] || { r: 'huff', g: 0.8 };
    return { recipe: RECIPES[v.r], gain: v.g * (trim.trick === undefined ? 1 : trim.trick) };
  }
  return null;
}

/** every name this bank can answer — the verification gate walks this list */
export function names() {
  const out = Object.keys(RECIPES);
  for (const z of Object.keys(PET_ZONE)) out.push('pet-' + z);
  for (const z of ['muz', 'tail', 'paw', 'brush']) out.push('grumble-' + z);
  for (const t of Object.keys(TRICK_VOICE)) out.push('trick-' + t);
  return out;
}

export default { RECIPES, resolve, names, voiceFor, NEUTRAL };
