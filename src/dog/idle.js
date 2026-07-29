/* ==========================================================================
   dog/idle.js — the idle director.

   Autonomy is the product here. Three independent lanes run at once:

     clips  — weighted, cooldown-gated actions, heavy penalty on repeats
     micro  — tiny self-initiated life so there is never more than
              ~BALANCE.idle.maxIdleGap seconds of true stillness
     reflex — blink and per-ear twitch, which never stop for anything

   Plus a quota: roughly 1 in `bidEveryN` self-initiated clips must be a BID
   FOR ATTENTION (she looks straight at the player). That bid is what makes
   the player feel needed rather than watched.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { CLIPS, bidIds } from './anim/index.js';
import { rng as sharedRng } from '../engine/rng.js';
import { clamp } from '../engine/draw.js';

const I = BALANCE.idle;
const R = BALANCE.rig;

export function createIdle(rig, opts = {}) {
  const rng = opts.rng || sharedRng;
  const poi = opts.poi || [{ x: 190, y: 900, w: 1 }];
  const spawn = opts.spawn || (() => {});
  const sound = opts.sound || (() => {});
  const s = rig.springs;

  let clip = null, clipT = 0, lastId = '';
  let nextIn = I.firstIn;
  const cool = Object.create(null);
  let flags = {};
  let blinkNext = 1.8, earNext = 2.4, microNext = rng.span(I.microEvery);
  let sinceBid = 0;               // self-initiated clips since the last bid
  let quiet = 0;                  // seconds since ANY visible self-initiated act
  const history = [];

  const ctx = {
    rig, s, rng, poi, flags,
    reduced: rig.reduced,
    affection: 0, sinceTouch: 0,
    lookAt: (x, y) => rig.lookAtVirtual(x, y),
    blink: (n) => rig.blinkNow(n),
    spawn: (kind, lx, ly) => spawn(kind, lx, ly),
    shiver: () => rig.shiver(),
    sound: (name) => sound(name),
  };

  /* ---- micro-behaviours: too small to deserve a clip, too important to
     leave out. One of these every 1-3s means the dog is never truly still. */
  const MICRO = [
    function earTwitch() {
      const side = rng.sign();
      (side < 0 ? s.earL : s.earR).kick(rng.range(2.4, 4.6) * rng.sign());
      if (rng.chance(0.35)) (side < 0 ? s.earR : s.earL).kick(rng.range(-1.6, 1.6));
    },
    function glance() {
      const p = rng.pick(poi);
      rig.lookAtVirtual(p.x + rng.range(-30, 30), p.y + rng.range(-24, 24));
      if (rng.chance(0.4)) rig.blinkNow(1);
    },
    function weightShift() {
      s.sway.kick(rng.range(-1.9, 1.9) * rig.mo.shake);
      s.roll.kick(rng.range(-0.05, 0.05) * rig.mo.shake);
    },
    function noseTwitch() {
      s.noseTw.kick(rng.range(6, 13) * rng.sign());
      if (rng.chance(0.5)) s.mouth.kick(0.5);
    },
    function breathHitch() {
      s.lift.kick(rng.range(3.5, 7));
      s.squash.kick(rng.range(0.2, 0.5));
    },
    function tailTick() {
      s.wagAmp.kick(rng.range(0.10, 0.30));
      s.wagSpd.kick(rng.range(0.8, 2.4));
    },
    function blinkPair() { rig.blinkNow(rng.chance(0.4) ? 2 : 1); },
    function tinyTilt() { s.tilt.kick(rng.range(-0.32, 0.32)); },
  ];

  function choose(forceBid) {
    const ids = Object.keys(CLIPS);
    const bids = bidIds();
    const pool = forceBid ? ids.filter((id) => CLIPS[id].bid) : ids;
    const ws = [];
    let tot = 0;
    for (const id of pool) {
      let w = CLIPS[id].weight(ctx);
      if ((cool[id] || 0) > 0) w = 0;
      if (id === lastId) w *= I.repeatPenalty;
      /* Bids are QUOTA-driven, not weight-driven: the forced pick below
         guarantees the 1-in-N floor, so natural selection is damped early in
         the cycle. Otherwise a neglected dog bids a third of the time, which
         reads as needy rather than needed. */
      if (!forceBid && CLIPS[id].bid) {
        w *= sinceBid < I.bidEveryN * I.bidDampUntil ? I.bidEarlyDamp : 1;
      }
      ws.push(w); tot += w;
    }
    if (tot <= 0.0001) {
      /* every bid is on cooldown: fall back to the general pool */
      return forceBid && bids.length ? choose(false) : null;
    }
    const r = rng.next() * tot;
    let acc = 0;
    for (let i = 0; i < pool.length; i++) {
      acc += ws[i];
      if (r <= acc) return pool[i];
    }
    return pool[0];
  }

  const idle = {
    get current() { return clip ? clip.id : ''; },
    get progress() { return clip ? clipT / clip.dur : 0; },
    get sinceBid() { return sinceBid; },
    get quiet() { return quiet; },
    get history() { return history.slice(); },
    get isBid() { return !!(clip && clip.bid); },

    /** Force a clip (tap reactions, stage 3 trick cues). */
    play(id) {
      const c = CLIPS[id];
      if (!c) return false;
      clip = c; clipT = 0; lastId = id;
      flags = {}; ctx.flags = flags;
      cool[id] = c.cd;
      quiet = 0;
      history.push(id);
      if (history.length > 40) history.shift();
      if (c.bid) sinceBid = 0; else sinceBid++;
      if (c.init) c.init(ctx);
      return true;
    },

    cancel(gap) {
      clip = null;
      nextIn = Math.min(I.maxIdleGap, gap !== undefined ? gap : rng.span(I.gapAfterAct));
    },

    /**
     * @param dt seconds
     * @param st { affection, petLevel, petDown, sinceTouch }
     */
    update(dt, st) {
      ctx.affection = st.affection;
      ctx.sinceTouch = st.sinceTouch;
      quiet += dt;

      for (const id in cool) if (cool[id] > 0) cool[id] -= dt;

      /* --- reflex lane: blink --- */
      blinkNext -= dt;
      if (blinkNext <= 0) {
        const busy = clip && (clip.id === 'yawn' || clip.id === 'shake' || clip.id === 'sneeze');
        if (rig.blinkT <= 0 && !busy) rig.blinkNow(rng.next() < 0.20 ? 2 : 1);
        blinkNext = rng.span(R.blinkEvery) * (1 - Math.min(1, st.petLevel) * R.blinkPetScale);
      }

      /* --- reflex lane: ears, always asymmetric --- */
      earNext -= dt;
      if (earNext <= 0) {
        const side = rng.sign();
        (side < 0 ? s.earL : s.earR).kick(rng.span(R.earTwitchMag) * rng.sign());
        if (rng.next() < 0.3) (side < 0 ? s.earR : s.earL).kick(rng.range(-2, 2));
        earNext = rng.span(R.earTwitchEvery);
      }

      /* --- petting suppresses clips (but not the reflex lanes) --- */
      if (st.petLevel > I.petSuppress || st.petDown) {
        /* Touching her ANSWERS a bid, so bids end. Reaction clips (weight 0 —
           sneeze, shakeOff, pawPull) and posture changes must run to term. */
        const isReaction = clip && clip.weight(ctx) === 0;
        if (clip && !isReaction && clip.id !== 'sitDown' && clip.id !== 'standUp') clip = null;
        nextIn = rng.span(I.gapWhilePet);
        microNext = rng.span(I.microEvery);
        return;
      }

      /* --- micro lane: no dead air --- */
      microNext -= dt;
      if (!clip && microNext <= 0) {
        rng.pick(MICRO)();
        quiet = 0;
        microNext = rng.span(I.microEvery);
      }

      /* --- clip lane --- */
      if (clip) {
        clipT += dt;
        const u = clipT / clip.dur;
        if (u >= 1) { clip = null; nextIn = Math.min(I.maxIdleGap, rng.span(I.gapAfterAct)); }
        else clip.update(u, dt, ctx);
      } else {
        nextIn -= dt;
        if (nextIn <= 0) {
          const forceBid = sinceBid >= I.bidEveryN - 1;
          const id = choose(forceBid);
          if (id) idle.play(id); else nextIn = 0.6;
        }
      }
    },
  };

  return idle;
}

export default createIdle;
