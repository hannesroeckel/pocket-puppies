/* ==========================================================================
   engine/rng.js — seeded RNG + value noise.
   Deterministic on purpose: idle variety is testable, and the baked room
   decoration is identical on every load.
   ========================================================================== */
import BALANCE from '../state/balance.js';

export function createRng(seed = BALANCE.rng.seed) {
  let s = (seed | 0) || 1;
  const api = {
    /** 0..1 */
    next() { s = (s * 1664525 + 1013904223) & 0x7fffffff; return s / 0x7fffffff; },
    /** a..b float */
    range(a, b) { return a + api.next() * (b - a); },
    /** a..b inclusive int */
    int(a, b) { return Math.floor(api.range(a, b + 1)); },
    /** random element */
    pick(arr) { return arr[Math.min(arr.length - 1, (api.next() * arr.length) | 0)]; },
    /** true with probability p */
    chance(p) { return api.next() < p; },
    /** -1 or +1 */
    sign() { return api.next() < 0.5 ? -1 : 1; },
    /** pair from a [min,max] tuple */
    span(t) { return api.range(t[0], t[1]); },
    /** independent stream, so one consumer can't desync another */
    fork(salt = 1) { return createRng((s ^ (salt * 2654435761)) & 0x7fffffff); },
    reseed(v) { s = (v | 0) || 1; },
  };
  return api;
}

/** Smoothed value noise + fbm, driven by a seeded table. */
export function createNoise(rng) {
  const N = 512;
  const T = new Float32Array(N);
  for (let i = 0; i < N; i++) T[i] = rng.next() * 2 - 1;
  const smooth = (t) => t * t * (3 - 2 * t);
  function noise1(x) {
    const i = Math.floor(x), f = x - i;
    const a = T[((i % N) + N) % N], b = T[(((i + 1) % N) + N) % N];
    return a + (b - a) * smooth(f);
  }
  function fbm(x) {
    return noise1(x) * 0.62 + noise1(x * 2.17 + 13.3) * 0.26 + noise1(x * 4.61 + 41.7) * 0.12;
  }
  return { noise1, fbm };
}

/** The shared game stream (idle director, petting jitter, particles). */
export const rng = createRng(BALANCE.rng.seed);
export const noise = createNoise(rng.fork(7));

export default rng;
