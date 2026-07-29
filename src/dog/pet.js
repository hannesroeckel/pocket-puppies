/* ==========================================================================
   dog/pet.js — petting: the stroke-impulse field, zone detection, and the
   per-zone response overlay.

   Four things make this petting rather than a +1 button with a nice shader:

   1. THE FIELD. Every pointer move deposits a decaying impulse in rig-local
      space and every silhouette point is displaced by the sum. The body
      genuinely dents and follows the finger.
   2. SWEET AND BAD SPOTS. Behind the ears, the chin, the chest and the base
      of the neck are lovely. The muzzle, the tail and the paws are not:
      they irritate, and she recoils, sneezes, shakes her head or nips.
      Bad spots pay almost nothing but never subtract — annoyed, never
      resentful (principle 1).
   3. SPEED AND RHYTHM. Slow long strokes build contentment. Frantic
      scribbling becomes overstimulation then annoyance. Rapid poking makes
      her back off.
   4. LEANING OUTLASTS THE STROKE. A liked stroke biases the whole rest pose
      toward where the finger was for ~1.7s after you let go.

   TWO PAYOUTS, TWO TIME CONSTANTS (stage 2). A stroke pays into MOOD (fast,
   visible, unsaved) and into AFFECTION (slow, saved, session- and day-capped
   in state/game.js) at rates that differ by ~130x. The quality multiplier is
   shared. Everything the body does here reads off mood, not the bond.

   hooks: { onAffection(amt, zone), onTapAffection(amt, zone),
            onMood(amt, zone), onMoodDent(amt, zone),
            onSpawn(kind, lx, ly), onTap(zone, clipId, kind), onMiss(vx, vy) }
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { Spring, approach, makeSprings } from '../engine/spring.js';
import { clamp, lerp, pt } from '../engine/draw.js';
import { rng as sharedRng } from '../engine/rng.js';

const B = BALANCE.pet;
const PR = B.press;
const RH = B.rhythm;
const IR = B.irritate;
const ZONES = B.zones;
const ZONE_IDS = Object.keys(ZONES);

export function createPetting(rig, opts = {}) {
  const reduced = !!opts.reduced;
  const rng = opts.rng || sharedRng;
  const hooks = opts.hooks || {};
  const s = rig.springs;
  const D = rig.dims;
  const RM = BALANCE.reducedMotion;

  /* one activation spring per zone */
  const zone = {};
  for (const id of ZONE_IDS) {
    const spec = ZONES[id].spring || B.zoneSpring;
    zone[id] = new Spring(0, spec[0] * (reduced ? RM.stiffScale : 1),
      spec[1] * (reduced ? RM.dampScale : 1));
  }
  const mood = makeSprings(['pet', 'glow', 'overstim', 'irritate', 'content', 'lean', 'recoil'], reduced);

  /* ---- stroke-impulse field ----------------------------------------- */
  const presses = [];
  const _out = [0, 0];

  function addPress(lx, ly, dx, dy, str, r) {
    if (presses.length > PR.max - 1) presses.shift();
    presses.push({ lx, ly, dx, dy, str, r });
  }
  function stepPresses(dt) {
    const k = Math.exp(-dt * PR.decay);
    for (let i = presses.length - 1; i >= 0; i--) {
      presses[i].str *= k;
      if (presses[i].str < PR.minStr) presses.splice(i, 1);
    }
  }
  function deformPoint(x, y, ox, oy, gain) {
    const wx = x + ox, wy = y + oy;
    let dx = 0, dy = 0;
    for (let i = 0; i < presses.length; i++) {
      const p = presses[i];
      const ddx = wx - p.lx, ddy = wy - p.ly;
      const f = Math.exp(-(ddx * ddx + ddy * ddy) / (p.r * p.r));
      dx += (p.dx * PR.pushGain - ddx * PR.pinchGain) * p.str * f;
      dy += (p.dy * PR.pushGain - ddy * PR.pinchGain) * p.str * f;
    }
    _out[0] = x + dx * gain; _out[1] = y + dy * gain;
    return _out;
  }

  /* ---- input + rhythm state ----------------------------------------- */
  const IN = {
    down: false, on: false, zone: '', kind: '',
    lx: 0, ly: 0, vx: 0, vy: 0,
    lastPressX: 0, lastPressY: 0,
    moved: false,
  };
  let energy = 0;
  let hold = 0;
  let sinceTouch = 0;
  /* rhythm */
  let speed = 0;              // smoothed rig units / second
  let lastDirX = 0;
  const flips = [];           // timestamps of direction reversals
  const pokes = [];           // timestamps of quick taps
  let clock = 0;
  /* lean memory: survives the stroke */
  const leanAt = { x: 0, y: 0 };
  let leanT = 0;

  /* ---- zones -------------------------------------------------------- */
  const zoneList = [];
  function anchor(part) {
    const P = rig.pose;
    switch (part) {
      case 'head': return { x: P.headX, y: P.headY, hx: D.headHW, hy: D.headHH };
      case 'muz': return { x: P.muzX, y: P.muzY, hx: rig.breed.proportions.muzzleW / 2, hy: rig.breed.proportions.muzzleH / 2 };
      case 'neck': return { x: lerp(P.bodyX, P.headX, 0.5), y: P.bodyY + D.neckDY - 4, hx: P.bodyHW, hy: P.bodyHH };
      case 'body': return { x: P.bodyX, y: P.bodyY, hx: P.bodyHW, hy: P.bodyHH };
      case 'tail': {
        const tn = P.tailNodes;
        const t = tn.length > 3 ? tn[3] : pt(70, -130);
        return { x: t.x + 4, y: t.y + 4, hx: 1, hy: 1 };
      }
      case 'paw': return { x: P.bodyX, y: -8, hx: P.bodyHW, hy: 1 };
      default: return { x: 0, y: 0, hx: 1, hy: 1 };
    }
  }
  function computeZones() {
    zoneList.length = 0;
    for (const id of ZONE_IDS) {
      const z = ZONES[id];
      const a = anchor(z.part);
      zoneList.push({
        id, kind: z.kind, gain: z.gain, r: z.r, pri: z.pri || 1,
        x: a.x + z.at[0] * a.hx,
        y: a.y + z.at[1] * a.hy,
      });
    }
  }
  /**
   * Resolve a part anchor in rig-local space. Exposed for stage 2's care
   * actions, which place dirt regions and the coat grain against the same
   * anchors the petting zones use — so a dirt patch sits on the shoulder even
   * while the shoulder is being dented by a stroke.
   * @param part 'head'|'muz'|'neck'|'body'|'tail'|'paw'
   * @returns {{x,y,hx,hy}} centre and half-extents, rig-local
   */
  function anchorFor(part) { return anchor(part); }
  function hitZone(lx, ly) {
    let best = null, bd = 1e9;
    for (let i = 0; i < zoneList.length; i++) {
      const z = zoneList[i];
      /* divide by priority so a head zone wins where it overlaps the chest */
      const d = Math.hypot(lx - z.x, ly - z.y) / (z.r * z.pri);
      if (d < bd) { bd = d; best = z; }
    }
    return bd < B.hitSlop ? { zone: best, d: bd } : null;
  }
  const kindOf = (id) => (ZONES[id] ? ZONES[id].kind : '');

  /* ---- fur ruffle --------------------------------------------------- */
  function ruffle(lx, ly, ux, uy, mag) {
    const FU = BALANCE.fur;
    for (const part of ['body', 'head']) {
      for (const f of rig.fur[part]) {
        if (f.px === undefined) continue;
        const dd = (f.px - lx) * (f.px - lx) + (f.py - ly) * (f.py - ly);
        const ff = Math.exp(-dd / FU.kickFalloff);
        if (ff > 0.02) {
          const tangential = -Math.sin(f.pa) * ux + Math.cos(f.pa) * uy;
          f.sp.kick(tangential * ff * mag * FU.kickGain);
        }
      }
    }
  }

  /* ---- rhythm ------------------------------------------------------- */
  function noteMove(dxl, seg, dt) {
    if (seg > 0.4) {
      const dir = Math.sign(dxl);
      if (dir !== 0 && lastDirX !== 0 && dir !== lastDirX) flips.push(clock);
      if (dir !== 0) lastDirX = dir;
    }
    while (flips.length && clock - flips[0] > RH.reversalWindow) flips.shift();
  }
  const scribble = () => clamp(flips.length / RH.scribbleAt, 0, 1);
  /* poking is repeated quick TAPS. One touch is never poking, so the count
     is offset by pokeMin before it means anything. */
  const pokeLevel = () => clamp((pokes.length - RH.pokeMin) / Math.max(1, RH.pokeAt - RH.pokeMin), 0, 1);
  /** 1 = slow deliberate stroke, 0 = fast */
  const slowness = () => 1 - clamp((speed - RH.slowSpeed) / (RH.fastSpeed - RH.slowSpeed), 0, 1);

  /* ================================================================== */
  const pet = {
    zones: zoneList, presses, IN,
    get level() { return mood.pet.x; },
    get glow() { return mood.glow.x; },
    get energy() { return energy; },
    get zoneSprings() { return zone; },
    get sinceTouch() { return sinceTouch; },
    get active() { return IN.down || mood.pet.x > 0.02; },
    get overstim() { return mood.overstim.x; },
    get irritation() { return mood.irritate.x; },
    get contentment() { return mood.content.x; },
    get rhythm() {
      return {
        speed: +speed.toFixed(1), scribble: +scribble().toFixed(2),
        slowness: +slowness().toFixed(2), poke: +pokeLevel().toFixed(2),
        flips: flips.length, pokes: pokes.length,
      };
    },
    computeZones, hitZone, deformPoint, addPress, kindOf,
    anchor: anchorFor,
    /** Let another layer register displeasure through the same channel a bad
        spot uses — stage 2's brush does this for a stroke against the grain,
        so the complaint reads identically to petting her nose. */
    irritate(amount) { mood.irritate.kick(amount); },
    /** the stroke-field ruffle, for tools that aren't a bare hand */
    ruffle,

    /* ---- pointer, in rig-local coords ------------------------------- */
    down(lx, ly, vx, vy) {
      IN.down = true; IN.moved = false;
      IN.lx = lx; IN.ly = ly; IN.vx = vx; IN.vy = vy;
      IN.lastPressX = lx; IN.lastPressY = ly;
      sinceTouch = 0;
      lastDirX = 0;
      const h = hitZone(lx, ly);
      IN.on = !!h;
      IN.zone = h ? h.zone.id : '';
      IN.kind = h ? h.zone.kind : '';
      if (IN.on) {
        hold = B.holdOnDown;
        energy = Math.max(energy, B.downEnergy);
        addPress(lx, ly, 0, 0, PR.downStr, PR.downRadius);
        /* FIRST VISIBLE REACTION UNDER 80ms: impulses, not targets. The ear
           pair and the (very fast) pupil springs move within a frame or two. */
        s.earL.kick(1.6); s.earR.kick(-1.3);
        const dx = clamp((lx - rig.pose.headX) / 60, -1, 1);
        const dy = clamp((ly - rig.pose.headY) / 60, -1, 1);
        s.pupilX.kick(dx * 26); s.pupilY.kick(dy * 20);
      } else {
        rig.lookAtVirtual(vx, vy);
        s.earL.kick(-2.6); s.earR.kick(2.9);
        s.perk.kick(2.2);
        s.eyeOpen.kick(1.6);
        s.pupilX.kick(clamp((lx - rig.pose.headX) / 60, -1, 1) * 30);
        rig.blinkNow(1);
        s.wagAmp.kick(0.6); s.wagSpd.kick(4);
        if (hooks.onMiss) hooks.onMiss(vx, vy);
      }
      return { hit: IN.on, zone: IN.zone, kind: IN.kind };
    },

    move(lx, ly, vx, vy) {
      if (!IN.down) return null;
      const dxl = lx - IN.lx, dyl = ly - IN.ly;
      const seg = Math.hypot(dxl, dyl);
      IN.lx = lx; IN.ly = ly; IN.vx = vx; IN.vy = vy;
      if (seg > 0) IN.moved = true;
      noteMove(dxl, seg, 0);

      const h = hitZone(lx, ly);
      IN.on = !!h;
      if (!h) return null;

      if (h.zone.id !== IN.zone) {
        IN.zone = h.zone.id;
        IN.kind = h.zone.kind;
        s.earL.kick(0.8); s.earR.kick(-0.6);
      }
      hold = B.holdOnMove;
      const gain = clamp(seg / 9.0, 0, 1.25);
      energy = clamp(Math.max(energy, B.energyFloor) + gain * 0.55, 0, B.energyMax);

      /* deformation impulse */
      const pd = Math.hypot(lx - IN.lastPressX, ly - IN.lastPressY);
      if (pd > PR.minTravel && seg > 0.01) {
        const ux = dxl / seg, uy = dyl / seg;
        const mag = clamp(seg * 0.85, PR.magMin, PR.magMax);
        const r = PR.radius[IN.zone] !== undefined ? PR.radius[IN.zone] : PR.radius._default;
        addPress(lx, ly, ux * mag, uy * mag,
          clamp(PR.strBase + seg * PR.strPerUnit, PR.strBase, PR.strMax), r);
        IN.lastPressX = lx; IN.lastPressY = ly;
        ruffle(lx, ly, ux, uy, mag);
      }

      /* remember where a LIKED stroke happened; the lean outlives the touch */
      if (IN.kind !== 'bad') {
        leanAt.x = lx; leanAt.y = ly;
        leanT = B.lean.hold;
      }

      /* --- the two axes, paid at very different rates ---------------
         Quality (zone x slowness x not-overstimulated) is shared, because a
         slow stroke behind the ears is both nicer *now* and better for the
         bond. The RATES differ by ~130x: mood moves in seconds, the bond
         moves over days. */
      const A = BALANCE.affection;
      const MD = BALANCE.mood;
      const travel = Math.min(seg, A.maxSegPerFrame);
      const mult = Math.max(0, (h.zone.gain || 1)
        * (1 + slowness() * RH.contentBonus)
        * (1 - mood.overstim.x * RH.overstimPenalty));
      /* MOOD — fast, visible, unsaved */
      if (IN.kind === 'bad') {
        if (hooks.onMoodDent) hooks.onMoodDent(travel * MD.perStrokeUnit * 0.25, IN.zone);
      } else if (hooks.onMood) {
        hooks.onMood(travel * MD.perStrokeUnit * mult, IN.zone);
      }
      /* AFFECTION — slow, saved, session- and day-capped in state/game.js */
      const paid = travel * A.perStrokeUnit * mult;
      if (paid > 0 && hooks.onAffection) hooks.onAffection(paid, IN.zone);

      /* hearts only where it's actually nice */
      if (hooks.onSpawn && IN.kind !== 'bad' && mood.overstim.x < 0.6
        && rng.next() < seg * B.heartChancePerUnit * (0.5 + (rig.drive.mood || 0))) {
        hooks.onSpawn(rng.next() < 1 - B.sparkleShare ? 'heart' : 'spark', lx, ly);
      }
      return { zone: IN.zone, kind: IN.kind, seg };
    },

    up(tap) {
      IN.down = false;
      hold = Math.max(hold, B.holdOnUp);
      lastDirX = 0;
      if (tap && IN.on && IN.zone) {
        /* a tap, not a stroke: this is what "rapid poking" is made of */
        pokes.push(clock);
        while (pokes.length && clock - pokes[0] > RH.pokeWindow) pokes.shift();
        pet.tapReact(IN.zone);
        return { tap: IN.zone };
      }
      return { tap: null };
    },

    cancel() { IN.down = false; IN.on = false; hold = Math.max(hold, B.holdOnUp); },

    /* ---- distinct per-zone tap reactions ---------------------------- */
    tapReact(zid) {
      sinceTouch = 0;
      const kind = kindOf(zid);
      const zg = ZONES[zid].gain || 1;
      if (hooks.onTapAffection) {
        hooks.onTapAffection(BALANCE.affection.tapGain * zg, zid);
      }
      if (kind === 'bad') {
        if (hooks.onMoodDent) hooks.onMoodDent(BALANCE.mood.badTouch, zid);
      } else if (hooks.onMood) {
        hooks.onMood(BALANCE.mood.tapGain * zg, zid);
      }
      let clip = null;
      const shake = rig.mo.shake;

      if (kind === 'bad') {
        /* ---- irritation, not delight ---- */
        mood.irritate.kick(4.0);
        mood.recoil.kick(10 * shake);
        s.eyeOpen.kick(2.2);            // eyes WIDEN, they don't soften
        s.earBack.kick(2.6);
        if (zid === 'muz') {
          s.noseTw.kick(30); rig.blinkNow(2);
          s.headLift.kick(-46); s.squash.kick(1.5);
          s.earL.kick(6.0); s.earR.kick(-5.1);
          s.tilt.kick(1.5);
          clip = 'sneeze';
          if (hooks.onSpawn) for (let i = 0; i < 4; i++) hooks.onSpawn('spark', rig.pose.muzX + rng.range(-11, 11), rig.pose.muzY + rng.range(-9, 4));
        } else if (zid === 'tail') {
          s.yaw.kick(5.2); s.wagAmp.kick(-1.2);
          s.sway.kick(-4 * shake);
          clip = 'shakeOff';
        } else if (zid === 'paw') {
          const side = IN.lx < rig.pose.bodyX ? 0 : 1;
          rig.pawLift[side].kick(14);
          s.pitch.kick(-2.2); s.tilt.kick(side ? 1.5 : -1.5);
          rig.blinkNow(1);
          clip = 'pawPull';
        }
        if (hooks.onTap) hooks.onTap(zid, clip, kind);
        return;
      }

      /* ---- pleasant ---- */
      if (zid === 'ear' || zid === 'head') {
        s.lift.kick(26); rig.blinkNow(1);
        s.eyeSmile.kick(3.2); s.smile.kick(2.4);
        s.earL.kick(3.4); s.earR.kick(-3.0);
        clip = 'wagBurst';
        if (hooks.onSpawn) hooks.onSpawn('heart', rig.pose.headX + rng.range(-11, 11), rig.pose.headY - 18);
      } else if (zid === 'chin' || zid === 'neck') {
        s.pitch.kick(-1.8); s.headLift.kick(-16);
        s.eyeSmile.kick(3.6); s.melt.kick(1.4);
        s.earBack.kick(1.6);
        clip = 'wagBurst';
        if (hooks.onSpawn) hooks.onSpawn('heart', rig.pose.muzX + rng.range(-9, 9), rig.pose.muzY - 6);
      } else if (zid === 'back') {
        s.squash.kick(1.6); s.lift.kick(14);
        s.pitch.kick(1.8); s.earL.kick(2.4); s.earR.kick(-2.1);
        clip = 'wagBurst';
      } else if (zid === 'chest') {
        s.sit.to(1); s.pitch.kick(2.4); s.hindKick.kick(2.0);
        s.eyeSmile.kick(2.6);
        clip = 'sitDown';
      } else if (zid === 'belly') {
        s.sit.to(1); s.pitch.kick(2.8); s.hindKick.kick(2.6);
        s.tongue.kick(2.0);
        clip = 'sitDown';
      }
      if (hooks.onTap) hooks.onTap(zid, clip, kind);
    },

    /* ==================================================================
       LAYER 4 — the petting overlay. Targets only, on top of base+clip.
       ================================================================== */
    apply(dt, moodState) {
      clock += dt;
      sinceTouch += dt;
      energy = approach(energy, 0, B.energyDecay, dt);
      if (hold > 0) hold -= dt;
      else if (!IN.down) { IN.zone = ''; IN.kind = ''; }
      if (leanT > 0) leanT -= dt;
      const activeZone = (IN.down && IN.on) ? IN.zone : (hold > 0 ? IN.zone : '');
      const activeKind = activeZone ? kindOf(activeZone) : '';
      const e = clamp(energy, 0, 1);

      /* --- rhythm integration ------------------------------------- */
      const instant = IN.down ? Math.hypot(IN.lx - IN.lastPressX, IN.ly - IN.lastPressY) / Math.max(dt, 1e-4) : 0;
      speed = approach(speed, IN.down ? instant : 0, RH.speedSmooth, dt);
      while (flips.length && clock - flips[0] > RH.reversalWindow) flips.shift();
      while (pokes.length && clock - pokes[0] > RH.pokeWindow) pokes.shift();

      const scrib = scribble();
      const over = mood.overstim;
      over.to(clamp(over.t + (IN.down && scrib > 0.35 ? RH.overstimRise : -RH.overstimFall) * dt * 2.4, 0, 1));
      const cont = mood.content;
      const wantContent = (activeKind === 'sweet' || activeKind === 'ok')
        ? slowness() * e * (1 - scrib * 0.9) : 0;
      cont.to(approach(cont.t, wantContent, IN.down ? RH.contentRise : RH.contentFall, dt));

      /* irritation: bad spots, overstimulation, and being poked */
      const wantIrr = clamp(
        (activeKind === 'bad' ? e : 0) * 1.0
        + over.x * 0.65
        + pokeLevel() * 0.55, 0, 1);
      mood.irritate.to(approach(mood.irritate.t, wantIrr,
        wantIrr > mood.irritate.t ? IR.rise : IR.fall, dt));

      mood.pet.to(e);
      mood.glow.to(IN.down ? 1 : 0);
      mood.lean.to(leanT > 0 ? B.lean.weight * clamp(leanT / B.lean.hold, 0, 1) : 0);
      mood.recoil.to(0);
      for (const key in mood) mood[key].step(dt);
      for (const id of ZONE_IDS) {
        zone[id].to(id === activeZone ? e : 0);
        zone[id].step(dt);
      }
      stepPresses(dt);

      const pv = mood.pet.x;
      const irr = mood.irritate.x;
      const overs = over.x;
      const lean = mood.lean.x;
      const recoil = mood.recoil.x;

      /* feed the rig's drive channels. `mood` is the fast axis and is what
         the body reads; `affection` is kept alongside for anything that wants
         the long game (stage 3's obedience rolls, for one). */
      const moodNow = clamp(moodState.mood === undefined ? moodState.affection : moodState.mood, 0, 1);
      rig.drive.petLevel = pv;
      rig.drive.mood = moodNow;
      rig.drive.affection = clamp(moodState.affection, 0, 1);
      rig.drive.wiggle = zone.tail.x * (1 - irr) + zone.chest.x * 0.5;

      const z = (id) => zone[id].x;
      const sweet = z('ear') + z('chin') + z('neck') + z('chest');
      const anyZone = ZONE_IDS.reduce((acc, id) => acc + zone[id].x, 0);
      if (pv < 0.004 && anyZone < 0.004 && irr < 0.004 && lean < 0.004 && recoil < 0.004) return;

      const m = moodNow;
      const t = rig.t;
      /* how much of the response is pleasure vs annoyance */
      const nice = clamp(1 - irr, 0, 1);
      const bliss = pv * nice;

      /* ---------- global: pleasure ---------- */
      s.melt.to(bliss * (0.55 + z('ear') * 0.35 + z('back') * 0.25 + mood.content.x * 0.45));
      s.squash.to(bliss * 0.05 + z('back') * 0.04);
      s.wagAmp.to(0.09 + m * 0.20 + bliss * 0.34 + sweet * 0.20 - irr * 0.10);
      s.wagSpd.to(1.5 + m * 3.4 + bliss * 7.5 + sweet * 4.5 + irr * 2.0);
      s.eyeSmile.to(clamp(m * 0.20 + bliss * 0.85 - irr * 0.62, 0, 1));
      s.eyeOpen.to(clamp(1 - bliss * 0.80 + irr * 0.34 + overs * 0.20, 0.06, 1.25));
      s.smile.to(clamp(0.34 + m * 0.44 + bliss * 0.55 - irr * 0.45, 0, 1));
      s.brow.to(clamp(m * 0.22 + bliss * 0.55 + irr * 0.30, 0, 1));
      /* airplane ears = bliss; pinned-back-and-tense = irritation. Both push
         earBack, so the eyes and mouth are what disambiguate. */
      s.earBack.to(bliss * (0.62 + z('ear') * 0.28) + irr * 0.55);
      s.perk.to(m * 0.30 - bliss * 0.12 + irr * 0.22);
      s.tailUp.to(m * 0.20 + bliss * 0.30 + z('tail') * 0.30 * nice - irr * 0.25);
      if ((m > 0.34 || bliss > 0.5) && irr < 0.4) {
        s.mouth.to(0.14 + 0.10 * Math.sin(t * 8.4) + bliss * 0.10);
        s.tongue.to(clamp(0.35 + m * 0.45, 0, 1));
      }

      /* ---------- LEAN OUTLASTS THE STROKE ----------
         A liked stroke biases the resting pose toward where the finger was
         for ~1.7s afterwards, so she is still leaning when you let go. */
      if (lean > 0.004) {
        const dxh = clamp((leanAt.x - rig.pose.headX) / 52, -1.2, 1.2);
        const dyh = clamp((leanAt.y - rig.pose.headY) / 52, -1.2, 1.2);
        s.yaw.t = clamp(s.yaw.t * (1 - lean) + dxh * 1.05 * lean, -1.3, 1.3);
        s.pitch.t = clamp(s.pitch.t * (1 - lean * 0.7) + (0.18 - dyh * 0.30) * lean, -1.0, 1.0);
        s.headPush.to(Math.max(s.headPush.t, lean * 0.55));
        s.tilt.to(s.tilt.t * (1 - lean * 0.6) + clamp(dxh * 0.22, -0.30, 0.30) * lean);
        s.pupilX.to(clamp(s.pupilX.t * (1 - lean) + dxh * lean, -1, 1));
        s.pupilY.to(clamp(s.pupilY.t * (1 - lean) + dyh * lean, -1, 1));
      }

      /* ---------- RECOIL: pull the head AWAY from an unwelcome finger ---- */
      if (irr > 0.05) {
        const awayX = clamp((rig.pose.headX - IN.lx) / 50, -1.2, 1.2);
        const k = irr * IR.recoil;
        s.yaw.t = clamp(s.yaw.t * (1 - k * 0.7) + awayX * 0.85 * k, -1.3, 1.3);
        s.pitch.t = clamp(s.pitch.t * (1 - k * 0.6) - 0.30 * k, -1.0, 1.0);
        s.headLift.to(s.headLift.t + k * 5.5);
        s.pupilX.to(clamp(s.pupilX.t * (1 - k) + awayX * k, -1, 1));
        /* overstimulated: shrink away and stiffen rather than melt */
        s.melt.to(s.melt.t * (1 - k));
        s.sway.to(s.sway.t - awayX * 3.0 * k * rig.mo.shake);
      }

      /* ---------- SWEET SPOT: behind the ears ---------- */
      if (z('ear') > 0.004) {
        const zv = z('ear') * nice;
        const dxh = clamp((IN.lx - rig.pose.headX) / 46, -1.2, 1.2);
        const dyh = clamp((IN.ly - (rig.pose.headY - 6)) / 46, -1.2, 1.2);
        s.yaw.t = clamp(s.yaw.t * (1 - zv) + dxh * 1.15 * zv, -1.3, 1.3);
        s.pitch.t = clamp(s.pitch.t * (1 - zv) + (0.34 - dyh * 0.42) * zv, -1.0, 1.0);
        s.headPush.to(zv * (0.6 + dxh * 0.5));
        s.headLift.to(-zv * 4.5);
        s.tilt.to(s.tilt.t * (1 - zv) + clamp(dxh * 0.30, -0.34, 0.34) * zv);
        s.eyeOpen.to(clamp(1 - zv * 0.94, 0.05, 1));
        s.earBack.to(Math.max(s.earBack.t, zv * 0.92));
        s.melt.to(Math.max(s.melt.t, zv * 0.92));
      }

      /* ---------- top of the head: pleasant, not transcendent ---------- */
      if (z('head') > 0.004) {
        const zv = z('head') * nice;
        const dxh = clamp((IN.lx - rig.pose.headX) / 46, -1.2, 1.2);
        s.yaw.t = clamp(s.yaw.t * (1 - zv * 0.7) + dxh * 0.85 * zv, -1.3, 1.3);
        s.pitch.t = clamp(s.pitch.t * (1 - zv * 0.8) + 0.26 * zv, -1.0, 1.0);
        s.headPush.to(Math.max(s.headPush.t, zv * 0.4));
        s.eyeOpen.to(clamp(1 - zv * 0.62, 0.1, 1));
        s.melt.to(Math.max(s.melt.t, zv * 0.5));
      }

      /* ---------- SWEET SPOT: chin ---------- */
      if (z('chin') > 0.004) {
        const zv = z('chin') * nice;
        s.pitch.t = clamp(s.pitch.t * (1 - zv) + (-0.46) * zv, -1.0, 1.0);
        s.headLift.to(s.headLift.t - zv * 7);
        s.eyeOpen.to(clamp(1 - zv * 0.90, 0.05, 1));
        s.eyeSmile.to(Math.max(s.eyeSmile.t, zv * 0.9));
        s.earBack.to(Math.max(s.earBack.t, zv * 0.80));
        s.melt.to(Math.max(s.melt.t, zv * 0.85));
        s.mouth.to(Math.max(s.mouth.t, 0.10 + 0.06 * Math.sin(t * 5.2)));
        s.perk.to(s.perk.t + zv * 0.18);
      }

      /* ---------- SWEET SPOT: base of the neck ---------- */
      if (z('neck') > 0.004) {
        const zv = z('neck') * nice;
        s.melt.to(Math.max(s.melt.t, zv * 0.95));
        s.pitch.t = clamp(s.pitch.t * (1 - zv * 0.8) + 0.40 * zv, -1.0, 1.0);
        s.squash.to(s.squash.t + zv * 0.06);
        s.eyeOpen.to(clamp(1 - zv * 0.92, 0.04, 1));
        s.eyeSmile.to(Math.max(s.eyeSmile.t, zv * 0.85));
        s.earBack.to(Math.max(s.earBack.t, zv * 0.88));
        s.roll.to(s.roll.t + clamp((IN.lx - rig.pose.bodyX) / 60, -1, 1) * 0.05 * zv);
        s.tailUp.to(s.tailUp.t + zv * 0.22);
      }

      /* ---------- back / shoulders ---------- */
      if (z('back') > 0.004) {
        const zb = z('back') * nice;
        s.squash.to(s.squash.t + zb * 0.075);
        s.roll.to(s.roll.t + clamp((IN.lx - rig.pose.bodyX) / 60, -1, 1) * 0.045 * zb);
        s.pitch.t = s.pitch.t * (1 - zb * 0.6) + 0.22 * zb;
        s.tailUp.to(s.tailUp.t + zb * 0.28);
      }

      /* ---------- SWEET SPOT: chest (sit back, pant) ---------- */
      if (z('chest') > 0.004) {
        const zl = z('chest') * nice;
        s.sit.to(Math.max(s.sit.t, clamp(zl * 1.4, 0, 1)));
        s.pitch.t = s.pitch.t * (1 - zl) + 0.62 * zl;
        s.headLift.to(s.headLift.t + zl * 5);
        s.hindKick.to(zl * 0.85);
        s.mouth.to(Math.max(s.mouth.t, 0.24 + 0.16 * Math.sin(t * 11.5)));
        s.tongue.to(Math.max(s.tongue.t, 0.85));
        s.eyeSmile.to(Math.max(s.eyeSmile.t, zl * 0.85));
        s.eyeOpen.to(clamp(1 - zl * 0.7, 0.1, 1));
        s.roll.to(s.roll.t - zl * 0.035);
        s.earBack.to(Math.max(s.earBack.t, zl * 0.6));
      }

      /* ---------- belly (rolls back further) ---------- */
      if (z('belly') > 0.004) {
        const zl = z('belly') * nice;
        s.sit.to(Math.max(s.sit.t, clamp(zl * 1.5, 0, 1)));
        s.pitch.t = s.pitch.t * (1 - zl) + 0.74 * zl;
        s.hindKick.to(Math.max(s.hindKick.t, zl * 1.0));
        s.tongue.to(Math.max(s.tongue.t, 0.95));
        s.mouth.to(Math.max(s.mouth.t, 0.28 + 0.18 * Math.sin(t * 12.5)));
        s.eyeOpen.to(clamp(1 - zl * 0.72, 0.1, 1));
      }

      /* ---------- BAD SPOT: muzzle / nose ---------- */
      if (z('muz') > 0.004) {
        const zm = z('muz');
        s.noseTw.to(Math.sin(t * 52) * 1.05 * zm);
        s.mouth.to(Math.max(s.mouth.t, 0.16 + 0.14 * Math.abs(Math.sin(t * 9.4))));
        s.eyeOpen.to(clamp(1 + zm * 0.14, 0.2, 1.25));
        s.eyeSmile.to(s.eyeSmile.t * (1 - zm));
        s.headLift.to(s.headLift.t + zm * 4);
        s.earBack.to(Math.max(s.earBack.t, zm * 0.7));
      }

      /* ---------- BAD SPOT: tail ---------- */
      if (z('tail') > 0.004) {
        const zt = z('tail');
        /* she whips round to look at what you're doing back there */
        s.yaw.t = clamp(s.yaw.t * (1 - zt) + 1.20 * zt, -1.3, 1.3);
        s.tilt.to(s.tilt.t * (1 - zt) + 0.20 * zt);
        s.eyeOpen.to(clamp(1 + zt * 0.10, 0.2, 1.25));
        s.squash.to(s.squash.t + zt * 0.05);
        s.tailUp.to(s.tailUp.t - zt * 0.30);
        s.sway.to(s.sway.t - zt * 2.4 * rig.mo.shake);
      }

      /* ---------- BAD SPOT: paws ---------- */
      if (z('paw') > 0.004) {
        const zp = z('paw');
        const side = IN.lx < rig.pose.bodyX ? 0 : 1;
        rig.pawLift[side].to(Math.max(rig.pawLift[side].t, zp * 1.15));
        s.pitch.t = s.pitch.t * (1 - zp) + (-0.50) * zp;
        s.headLift.to(s.headLift.t - zp * 5);
        s.eyeOpen.to(clamp(1 + zp * 0.12, 0.3, 1.25));
        s.tilt.to(s.tilt.t + (side ? 0.18 : -0.18) * zp);
        s.sit.to(Math.max(s.sit.t, zp * 0.35));
      }
    },
  };

  return pet;
}

export default createPetting;
