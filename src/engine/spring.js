/* ==========================================================================
   engine/spring.js — the spring primitive (extracted verbatim from spike A).
   Semi-implicit Euler, SUBSTEPPED so it stays stable at large dt and snappy
   at small dt. Everything the dog does resolves through these: layers write
   TARGETS ONLY, springs produce the final value. Nothing ever pops.
   ========================================================================== */
import BALANCE from '../state/balance.js';

const S = BALANCE.springStep;

export class Spring {
  constructor(v = 0, k = 110, d = 14) {
    this.x = v; this.t = v; this.v = 0;
    this.k = k; this.d = d;
  }
  to(t) { this.t = t; return this; }
  set(v) { this.x = v; this.t = v; this.v = 0; return this; }
  kick(a) { this.v += a; return this; }
  step(dt) {
    let n = dt > S.minDt ? Math.ceil(dt / S.h) : 1;
    if (n > S.maxSub) n = S.maxSub;
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = (this.t - this.x) * this.k - this.v * this.d;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  }
}

/** critically-damped smoothing for slow drifts (cheap, never overshoots) */
export function approach(cur, target, rate, dt) {
  return cur + (target - cur) * (1 - Math.exp(-rate * dt));
}

/**
 * Build a named spring set from BALANCE.springs.
 * `reduced` applies prefers-reduced-motion: softer stiffness, more damping.
 */
export function makeSprings(names, reduced = false) {
  const R = BALANCE.reducedMotion;
  const out = {};
  for (const name of names) {
    const spec = BALANCE.springs[name];
    if (!spec) throw new Error(`spring "${name}" missing from BALANCE.springs`);
    let [k, d] = spec;
    if (reduced) { k *= R.stiffScale; d *= R.dampScale; }
    out[name] = new Spring(0, k, d);
  }
  return out;
}

/** Step every spring in a set. */
export function stepAll(set, dt) {
  for (const key in set) set[key].step(dt);
}

export default Spring;
