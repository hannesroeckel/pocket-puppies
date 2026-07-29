/* ==========================================================================
   dog/anim/index.js — named action clips + the registry.

   A clip is data + two functions. It writes TARGETS ONLY (`spring.to`) and
   occasionally impulses (`spring.kick`), never final values, so it composes
   with the base mood underneath and the petting overlay on top.

   Clip shape:
     { id, dur, cd, weight(ctx)->number, init?(ctx), update(u, dt, ctx) }
       u    0..1 progress
       ctx  { rig, s, rng, flags, poi, lookAt, blink, spawn, shiver,
              affection, sinceTouch, reduced }

   Stage 3 (training) adds trick clips with registerClip(); it must not edit
   this file's existing entries.
   ========================================================================== */
import { smooth, plateau, hump, clamp } from '../../engine/draw.js';

export const CLIPS = Object.create(null);

export function registerClip(clip) {
  CLIPS[clip.id] = clip;
  return clip;
}

/* ---- idle repertoire (ported from spike A) --------------------------- */

registerClip({
  id: 'lookAround', dur: 3.4, cd: 5.5,
  weight: () => 3.2,
  init(ctx) {
    ctx.flags.a = ctx.rng.pick(ctx.poi);
    ctx.flags.b = ctx.rng.pick(ctx.poi);
  },
  update(u, dt, ctx) {
    const { s, flags } = ctx;
    if (u < 0.10) { /* settle */ }
    else if (u < 0.42) ctx.lookAt(flags.a.x, flags.a.y);
    else if (u < 0.76) { ctx.lookAt(flags.b.x, flags.b.y); if (!flags.bk) { flags.bk = 1; ctx.blink(1); } }
    else {
      ctx.rig.gaze.yaw += (0 - ctx.rig.gaze.yaw) * (1 - Math.exp(-6 * dt));
      ctx.rig.gaze.pitch += (0.05 - ctx.rig.gaze.pitch) * (1 - Math.exp(-6 * dt));
    }
    s.perk.to(0.18);
    s.earBack.to(-0.05);
  },
});

registerClip({
  id: 'headTilt', dur: 2.6, cd: 7.5,
  weight: () => 2.4,
  init(ctx) { ctx.flags.d = ctx.rng.sign(); },
  update(u, dt, ctx) {
    const { s, flags } = ctx;
    const env = plateau(u, 0.20, 0.34);
    s.tilt.to(flags.d * 0.26 * env);
    s.yaw.t = s.yaw.t + flags.d * 0.10 * env;
    s.eyeOpen.to(1.06);
    s.brow.to(0.45 * env);
    s.perk.to(0.22 * env);
    if (u > 0.30 && !flags.bk) { flags.bk = 1; ctx.blink(1); }
  },
});

registerClip({
  id: 'yawn', dur: 2.9, cd: 22,
  weight: (ctx) => (ctx.affection < 0.5 ? 2.0 : 0.7),
  update(u, dt, ctx) {
    const { s, flags } = ctx;
    if (u < 0.16) {                       /* anticipation: gather */
      const a = smooth(u / 0.16);
      s.squash.to(0.05 * a); s.headLift.to(-3 * a); s.eyeOpen.to(1 - 0.35 * a);
    } else if (u < 0.52) {                /* the yawn */
      const b = smooth((u - 0.16) / 0.36);
      s.mouth.to(0.30 + 0.70 * hump(b * 0.96));
      s.tongue.to(0.85 * hump(b));
      s.eyeOpen.to(0.06);
      s.eyeSmile.to(0.55);
      s.headLift.to(9 * b); s.pitch.t = 0.48 * b;
      s.squash.to(-0.075 * b);
      s.earBack.to(0.55 * b);
      s.brow.to(0.7 * b);
      s.wagAmp.to(0.05);
    } else if (u < 0.78) {                /* settle / follow-through */
      const d = smooth((u - 0.52) / 0.26);
      s.mouth.to(0.30 * (1 - d)); s.tongue.to(0.2 * (1 - d));
      s.eyeOpen.to(0.10 + 0.95 * d);
      s.eyeSmile.to(0.55 * (1 - d));
      s.headLift.to(9 * (1 - d) - 2.5 * d);
      s.squash.to(-0.075 * (1 - d) + 0.05 * d);
      s.earBack.to(0.55 * (1 - d));
      if (d > 0.5 && !flags.bk) { flags.bk = 1; ctx.blink(2); }
    } else {
      const e = smooth((u - 0.78) / 0.22);
      s.squash.to(0.05 * (1 - e));
      s.headLift.to(-2.5 * (1 - e));
    }
  },
});

registerClip({
  id: 'shake', dur: 1.9, cd: 15,
  weight: (ctx) => (ctx.reduced ? 0 : 1.6),
  update(u, dt, ctx) {
    const { s, flags } = ctx;
    if (u < 0.16) {                        /* anticipation */
      const a = smooth(u / 0.16);
      s.squash.to(0.06 * a); s.tilt.to(-0.10 * a); s.earBack.to(0.2 * a);
      s.eyeOpen.to(1 - 0.55 * a);
    } else if (u < 0.68) {
      const b = (u - 0.16) / 0.52;
      const env = Math.exp(-b * 2.1) * (1 - smooth(Math.max(0, (b - 0.75) / 0.25)));
      const f = Math.sin(b * Math.PI * 2 * 5.6);
      s.tilt.to(f * 0.30 * env);
      s.roll.to(-f * 0.10 * env);
      s.sway.to(f * 4.2 * env);
      s.earL.kick(f * dt * 160 * env);
      s.earR.kick(-f * dt * 160 * env);
      s.eyeOpen.to(0.22);
      s.squash.to(0.04 * env);
      s.wagAmp.to(0.35);
      s.mouth.to(0.10 * env);
      if (b > 0.05 && !flags.sp) {
        flags.sp = 1;
        for (let i = 0; i < 5; i++) {
          ctx.spawn('spark', ctx.rig.pose.headX + ctx.rng.range(-28, 28), ctx.rig.pose.headY + ctx.rng.range(-18, 18));
        }
      }
    } else {
      const d = smooth((u - 0.68) / 0.32);
      s.tilt.to(0); s.roll.to(0); s.sway.to(0);
      s.eyeOpen.to(0.22 + 0.85 * d);
      s.earBack.to(0);
      s.smile.t = Math.max(s.smile.t, 0.4 * d);
    }
  },
});

registerClip({
  id: 'sitDown', dur: 1.7, cd: 16,
  weight: (ctx) => (ctx.s.sit.t < 0.5 ? 1.5 : 0),
  update(u, dt, ctx) {
    const { s, flags } = ctx;
    s.sit.to(1);
    if (u < 0.20) s.pitch.t = 0.10;
    if (u > 0.16 && u < 0.42) s.squash.to(0.05 * hump((u - 0.16) / 0.26));
    if (u > 0.34 && !flags.bk) { flags.bk = 1; ctx.blink(1); s.tailUp.to(0.3); }
    s.perk.to(0.10);
  },
});

registerClip({
  id: 'standUp', dur: 1.5, cd: 12,
  weight: (ctx) => (ctx.s.sit.t > 0.5 ? 1.7 : 0),
  update(u, dt, ctx) {
    const { s, flags } = ctx;
    if (u < 0.14) { s.squash.to(0.07 * smooth(u / 0.14)); s.headLift.to(-2); }
    else { s.sit.to(0); s.squash.to(-0.03); }
    if (u > 0.30 && !flags.k) { flags.k = 1; s.lift.kick(24); s.earL.kick(1.6); s.earR.kick(-1.6); }
    s.perk.to(0.25);
  },
});

registerClip({
  id: 'sniff', dur: 3.1, cd: 9,
  weight: () => 1.9,
  update(u, dt, ctx) {
    const { s, flags } = ctx;
    const env = plateau(u, 0.18, 0.28);
    s.pitch.t = -0.80 * env;
    s.headLift.to(-9 * env);
    s.yaw.t = s.yaw.t + Math.sin(u * 13.5) * 0.16 * env;
    s.eyeOpen.to(1 - 0.30 * env);
    s.earBack.to(-0.10 * env);
    if (env > 0.5) {
      const ph = Math.sin(u * 54);
      s.noseTw.to(ph * 0.9);
      s.mouth.to(0.03 + 0.03 * Math.abs(ph));
    } else s.noseTw.to(0);
    if (u > 0.86 && !flags.bk) { flags.bk = 1; ctx.blink(1); }
  },
});

registerClip({
  id: 'stretch', dur: 2.7, cd: 24,
  weight: () => 1.1,
  update(u, dt, ctx) {
    const { s, flags } = ctx;
    if (u < 0.22) { const a = smooth(u / 0.22); s.squash.to(0.06 * a); s.headLift.to(-3 * a); }
    else if (u < 0.62) {
      const b = smooth((u - 0.22) / 0.40);
      s.squash.to(-0.13 * b);
      s.tailUp.to(0.9 * b);
      s.pitch.t = -0.35 * b;
      s.headLift.to(-11 * b);
      s.roll.to(0.05 * b);
      s.eyeOpen.to(1 - 0.75 * b);
      s.mouth.to(0.20 * b); s.tongue.to(0.5 * b);
      s.earBack.to(0.30 * b);
    } else {
      const d = smooth((u - 0.62) / 0.38);
      s.squash.to(-0.13 * (1 - d)); s.tailUp.to(0.9 * (1 - d));
      s.pitch.t = -0.35 * (1 - d); s.headLift.to(-11 * (1 - d));
      s.roll.to(0.05 * (1 - d)); s.eyeOpen.to(0.25 + 0.85 * d);
      s.mouth.to(0.20 * (1 - d)); s.tongue.to(0.5 * (1 - d));
      s.earBack.to(0.30 * (1 - d));
      if (d > 0.55 && !flags.k) { flags.k = 1; s.lift.kick(16); ctx.blink(2); }
    }
  },
});

/* ---- bids for attention -------------------------------------------------
   Tagged `bid:true`. The director guarantees roughly 1 in 8 self-initiated
   actions is one of these: looking straight at the player is what makes her
   feel needed, and it's the behaviour that turns an animation into a pet.
   ---------------------------------------------------------------------- */
registerClip({
  id: 'askAttention', dur: 3.0, cd: 11, bid: true,
  weight: (ctx) => (ctx.sinceTouch > 9 ? 1.0 : 0.22),
  update(u, dt, ctx) {
    const { s, flags } = ctx;
    ctx.lookAt(190, 980);
    const env = plateau(u, 0.16, 0.3);
    s.eyeOpen.to(1 + 0.14 * env);
    s.brow.to(0.85 * env);
    s.tilt.to(0.13 * env * Math.sin(u * 3.1));
    s.perk.to(0.55 * env);
    s.wagAmp.to(0.16 + 0.30 * env);
    s.wagSpd.to(2.2 + 5.0 * env);
    s.smile.t = Math.max(s.smile.t, 0.55 * env);
    s.mouth.to(0.10 * env);
    s.earBack.to(-0.16 * env);
    if (u > 0.28 && !flags.bk) { flags.bk = 1; ctx.blink(1); }
    if (u > 0.5 && !flags.h) { flags.h = 1; s.lift.kick(14); }
  },
});

registerClip({
  id: 'wagBurst', dur: 1.9, cd: 6,
  weight: (ctx) => 0.7 + ctx.affection * 3.0,
  update(u, dt, ctx) {
    const { s, flags } = ctx;
    const env = plateau(u, 0.14, 0.34);
    s.wagAmp.to(0.16 + 0.34 * env);
    s.wagSpd.to(2.2 + 7.5 * env);
    s.perk.to(0.42 * env);
    s.smile.t = Math.max(s.smile.t, 0.45 * env);
    s.tailUp.to(0.45 * env);
    if (u > 0.2 && !flags.k) { flags.k = 1; s.lift.kick(18 + ctx.affection * 16); }
    if (u > 0.55 && !flags.k2 && ctx.affection > 0.5) { flags.k2 = 1; s.lift.kick(20); }
  },
});

registerClip({
  id: 'scratch', dur: 2.4, cd: 19,
  weight: () => 1.2,
  init(ctx) { ctx.flags.d = ctx.rng.sign(); },
  update(u, dt, ctx) {
    const { s, flags } = ctx;
    const env = plateau(u, 0.18, 0.26);
    s.hindKick.to(0.85 * env);
    s.tilt.to(flags.d * 0.20 * env);
    s.pitch.t = -0.20 * env;
    s.eyeOpen.to(1 - 0.55 * env);
    s.earBack.to(0.28 * env);
    s.sway.to(flags.d * 2.5 * env);
    s.mouth.to(0.10 * env);
    if (u > 0.8 && !flags.bk) { flags.bk = 1; ctx.blink(2); s.earL.kick(2.2); }
  },
});

registerClip({
  id: 'bidWhine', dur: 2.6, cd: 14, bid: true,
  weight: (ctx) => (ctx.sinceTouch > 6 ? 0.9 : 0.20),
  update(u, dt, ctx) {
    const { s, flags } = ctx;
    /* holds eye contact with the player — the whole point of a bid */
    ctx.lookAt(195, 1010);
    const env = plateau(u, 0.18, 0.30);
    s.eyeOpen.to(1 + 0.18 * env);
    s.brow.to(0.95 * env);
    s.tilt.to(0.20 * env * Math.sin(u * 2.2 + 0.6));
    s.perk.to(0.30 * env);
    s.earBack.to(-0.22 * env);
    /* a low, slow, hopeful wag rather than an excited one */
    s.wagAmp.to(0.20 + 0.16 * env);
    s.wagSpd.to(1.8 + 1.6 * env);
    s.tailUp.to(0.10 * env);
    s.mouth.to(0.16 * env + 0.05 * Math.sin(u * 9.0) * env);
    s.smile.t = Math.max(s.smile.t, 0.30 * env);
    s.headLift.to(-2.5 * env);
    if (u > 0.22 && !flags.bk) { flags.bk = 1; ctx.blink(1); }
    if (u > 0.60 && !flags.w) { flags.w = 1; s.lift.kick(9); ctx.sound('whine'); }
  },
});

/* ---- irritation reactions (bad-spot petting) --------------------------- */
registerClip({
  id: 'sneeze', dur: 1.5, cd: 4,
  weight: () => 0,                 // reaction only, never self-initiated
  update(u, dt, ctx) {
    const { s, flags } = ctx;
    if (u < 0.34) {                // wind-up: head rises, eyes squeeze
      const a = smooth(u / 0.34);
      s.pitch.t = -0.42 * a;
      s.headLift.to(-7 * a);
      s.eyeOpen.to(1 - 0.86 * a);
      s.noseTw.to(Math.sin(u * 70) * 1.1);
      s.mouth.to(0.12 * a);
      s.squash.to(-0.05 * a);
    } else if (u < 0.52) {         // the sneeze
      const b = (u - 0.34) / 0.18;
      if (!flags.s) {
        flags.s = 1;
        s.headLift.kick(52); s.pitch.kick(2.6);
        s.squash.kick(2.2);
        s.earL.kick(7.0); s.earR.kick(-6.2);
        ctx.blink(2);
        ctx.sound('sneeze');
        for (let i = 0; i < 6; i++) {
          ctx.spawn('spark', ctx.rig.pose.muzX + ctx.rng.range(-16, 16), ctx.rig.pose.muzY + ctx.rng.range(-6, 10));
        }
      }
      s.mouth.to(0.55 * (1 - b));
      s.eyeOpen.to(0.08);
    } else {                        // recover, shake it off
      const d = smooth((u - 0.52) / 0.48);
      s.eyeOpen.to(0.08 + 0.98 * d);
      s.mouth.to(0.08 * (1 - d));
      s.noseTw.to(Math.sin(u * 30) * 0.4 * (1 - d));
      s.headLift.to(0);
      s.pitch.t = 0.05 * d;
      if (d > 0.5 && !flags.bk) { flags.bk = 1; ctx.blink(1); }
    }
  },
});

registerClip({
  id: 'shakeOff', dur: 1.6, cd: 4,
  weight: () => 0,
  update(u, dt, ctx) {
    const { s, flags } = ctx;
    const shake = ctx.rig.mo.shake;
    if (u < 0.14) {
      const a = smooth(u / 0.14);
      s.squash.to(0.05 * a); s.earBack.to(0.5 * a);
      s.eyeOpen.to(1 - 0.30 * a);
    } else if (u < 0.70) {
      const b = (u - 0.14) / 0.56;
      const env = Math.exp(-b * 2.3) * (1 - smooth(Math.max(0, (b - 0.75) / 0.25)));
      const f = Math.sin(b * Math.PI * 2 * 6.1);
      s.tilt.to(f * 0.26 * env * shake);
      s.roll.to(-f * 0.09 * env * shake);
      s.sway.to(f * 3.6 * env * shake);
      s.earL.kick(f * dt * 150 * env);
      s.earR.kick(-f * dt * 132 * env);
      s.eyeOpen.to(0.30);
      s.earBack.to(0.5);
      s.wagAmp.to(0.08);
      if (b > 0.05 && !flags.s) { flags.s = 1; ctx.sound('shake'); }
    } else {
      const d = smooth((u - 0.70) / 0.30);
      s.tilt.to(0); s.roll.to(0); s.sway.to(0);
      s.eyeOpen.to(0.30 + 0.80 * d);
      s.earBack.to(0.5 * (1 - d));
    }
  },
});

registerClip({
  id: 'pawPull', dur: 1.1, cd: 3,
  weight: () => 0,
  update(u, dt, ctx) {
    const { s, flags } = ctx;
    const env = plateau(u, 0.14, 0.40);
    /* draws the paw in and leans away from the hand */
    s.pitch.t = -0.34 * env;
    s.headLift.to(-4 * env);
    s.sit.to(Math.max(s.sit.t, 0.42 * env));
    s.eyeOpen.to(1 + 0.10 * env);
    s.earBack.to(0.36 * env);
    if (u > 0.12 && !flags.k) {
      flags.k = 1;
      const side = ctx.rng.next() < 0.5 ? 0 : 1;
      ctx.rig.pawLift[side].kick(13);
      s.tilt.kick(side ? 0.8 : -0.8);
      ctx.sound('nip');
    }
    if (u > 0.55 && !flags.bk) { flags.bk = 1; ctx.blink(1); }
  },
});

/* ---- stage 2: cruelty reaction + the toy bid ---------------------------
   CRUELTY GETS AN IMMEDIATE PHYSICAL REACTION AND NOTHING THAT PERSISTS
   (research §2 / SCOPE.md principle 5). A toy flicked down at her startles
   her for about a second. There is no score penalty, no guilt line, and no
   memory of it: the dog must never resent her.
   ---------------------------------------------------------------------- */
registerClip({
  id: 'flinch', dur: 1.25, cd: 2.5,
  weight: () => 0,                 // reaction only, never self-initiated
  update(u, dt, ctx) {
    const { s, flags } = ctx;
    if (u < 0.10) {
      /* the recoil: all impulse, so it is visible in the very first frame */
      if (!flags.k) {
        flags.k = 1;
        s.squash.kick(2.4);
        s.headLift.kick(-26);
        s.earBack.kick(3.8);
        s.eyeOpen.kick(2.6);
        ctx.blink(1);
      }
      s.eyeOpen.to(1.20);
    } else if (u < 0.52) {
      const b = smooth((u - 0.10) / 0.42);
      /* shrinks: sits back, head tucked, ears flat, NO smile at all */
      s.sit.to(Math.max(s.sit.t, 0.62 * b));
      s.squash.to(0.08 * b);
      s.headLift.to(-9 * b);
      s.pitch.t = -0.38 * b;
      s.earBack.to(0.92 * b);
      s.eyeOpen.to(1.18);
      s.eyeSmile.to(0);
      s.smile.to(0.10);
      s.brow.to(0.95 * b);
      s.wagAmp.to(0.04);
      s.wagSpd.to(1.1);
      s.tailUp.to(-0.18 * b);
    } else {
      /* recovers on her own — quickly, and all the way */
      const d = smooth((u - 0.52) / 0.48);
      s.sit.to(0.62 * (1 - d));
      s.headLift.to(-9 * (1 - d));
      s.pitch.t = -0.38 * (1 - d) + 0.06 * d;
      s.earBack.to(0.92 * (1 - d));
      s.eyeOpen.to(1.18 - 0.18 * d);
      s.smile.to(0.10 + 0.45 * d);
      s.brow.to(0.95 * (1 - d) + 0.3 * d);
      s.wagAmp.to(0.04 + 0.20 * d);
      s.wagSpd.to(1.1 + 2.4 * d);
      s.tailUp.to(-0.18 * (1 - d) + 0.16 * d);
      if (d > 0.55 && !flags.bk) { flags.bk = 1; ctx.blink(1); s.earL.kick(2.4); }
    }
  },
});

registerClip({
  /* SHE DROPS THE TOY AT YOUR FEET. Played by dog/toy.js when she actually
     gives it up — one of the three bids the research names by hand, and it
     counts toward the director's 1-in-N bid quota because it is tagged. */
  id: 'bidToy', dur: 2.3, cd: 5, bid: true,
  weight: () => 0,                 // driven by dog/toy.js, not self-initiated
  update(u, dt, ctx) {
    const { s, flags } = ctx;
    ctx.lookAt(195, 995);
    const env = plateau(u, 0.14, 0.34);
    s.eyeOpen.to(1 + 0.14 * env);
    s.brow.to(0.80 * env);
    s.perk.to(0.50 * env);
    s.earBack.to(-0.18 * env);
    s.smile.t = Math.max(s.smile.t, 0.65 * env);
    s.mouth.to(0.20 * env + 0.08 * Math.sin(u * 11) * env);
    s.tongue.to(0.55 * env);
    /* a hopeful wag, and a paw nudging the ball forward */
    s.wagAmp.to(0.30 + 0.34 * env);
    s.wagSpd.to(4.0 + 8.0 * env);
    s.tailUp.to(0.42 * env);
    if (u > 0.20 && !flags.p) {
      flags.p = 1;
      ctx.rig.pawLift[ctx.rng.next() < 0.5 ? 0 : 1].kick(9);
      s.tilt.kick(0.28);
      ctx.sound('yip');
    }
    if (u > 0.30 && !flags.bk) { flags.bk = 1; ctx.blink(1); }
    if (u > 0.62 && !flags.h) { flags.h = 1; s.lift.kick(11); }
  },
});

registerClip({
  id: 'earFlick', dur: 1.1, cd: 8,
  weight: () => 1.4,
  init(ctx) { ctx.flags.d = ctx.rng.sign(); },
  update(u, dt, ctx) {
    const { s, flags } = ctx;
    if (u > 0.1 && !flags.k) {
      flags.k = 1;
      (flags.d < 0 ? s.earL : s.earR).kick(ctx.rng.range(4.5, 7.5) * -flags.d);
      s.tilt.kick(flags.d * 0.5);
    }
    s.perk.to(0.14 * plateau(u, 0.2, 0.4));
    if (u > 0.55 && !flags.bk) { flags.bk = 1; ctx.blink(1); }
  },
});

export const CLIP_IDS = Object.keys(CLIPS);
/** clips that are bids for attention — the director enforces a 1-in-N ratio */
export const bidIds = () => Object.keys(CLIPS).filter((id) => CLIPS[id].bid);
export default CLIPS;
