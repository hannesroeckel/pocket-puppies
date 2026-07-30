/* ==========================================================================
   engine/spring.js — the spring primitive (extracted verbatim from spike A).
   Semi-implicit Euler, SUBSTEPPED so it stays stable at large dt and snappy
   at small dt. Everything the dog does resolves through these: layers write
   TARGETS ONLY, springs produce the final value. Nothing ever pops.
   ========================================================================== */
import BALANCE from '../state/balance.js';

const S = BALANCE.springStep;

const fin = (v) => (typeof v === 'number' ? v === v && v !== Infinity && v !== -Infinity
  : Number.isFinite(+v));

/* ==========================================================================
   WHY THESE GUARDS EXIST — this is the worst instance of the NaN hole that
   `state/game.js` documents, and the only one that never recovers.

   A spring is a feedback loop: `x += v*h` where `v` derives from `t - x`. Once
   ANY of x/t/v is NaN, every subsequent frame recomputes NaN from NaN, so the
   spring is dead for the rest of the session and there is no path back. Since
   ~40 of these produce every value the dog is drawn from, one bad target from
   one careless caller does not glitch a limb — **the whole animal disappears
   and stays gone until the app is relaunched.**

   Two different policies, on purpose:
     to/set/kick  REJECT a bad input and leave the spring alone, so a bad
                  caller is a no-op rather than a snap to zero (a snap to zero
                  is a visible pop, which §6 forbids).
     step         SELF-HEAL. If a spring is somehow already poisoned — by a
                  corrupt save, or by a caller that reached in and assigned
                  `.x` directly — recover to the last sane target instead of
                  propagating. This turns "the dog vanished forever" into "the
                  dog glitched for one frame", which is the difference between
                  a fatal bug and a cosmetic one.

   Cost: one finite check per call, not per substep. Measured at 1.1ms median
   frame work with all of stage 3 running, i.e. inside the noise.
   ========================================================================== */
export class Spring {
  constructor(v = 0, k = 110, d = 14) {
    this.x = v; this.t = v; this.v = 0;
    this.k = k; this.d = d;
  }
  to(t) { if (fin(t)) this.t = +t; return this; }
  set(v) { if (fin(v)) { this.x = +v; this.t = +v; this.v = 0; } return this; }
  kick(a) { if (fin(a)) this.v += +a; return this; }
  step(dt) {
    /* self-heal before integrating, so a poisoned spring cannot survive a
       single frame (see the block comment above) */
    if (!fin(this.t)) this.t = fin(this.x) ? this.x : 0;
    if (!fin(this.x)) { this.x = this.t; this.v = 0; }
    if (!fin(this.v)) this.v = 0;
    if (!fin(dt) || dt <= 0) return this.x;
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
  /* the same trap, and this one drives rig.x/y/s — the placement channels the
     spin and the come-when-called lean borrow. A NaN here teleports the dog out
     of the frame rather than merely deforming her. */
  if (!fin(cur)) return fin(target) ? +target : 0;
  if (!fin(target) || !fin(rate) || !fin(dt) || dt <= 0) return +cur;
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
