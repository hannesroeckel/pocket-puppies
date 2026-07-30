/* ==========================================================================
   dog/toy.js — throwing a toy, and the dog deciding what to do about it.

   FRONTAL-CAMERA-SAFE BY CONSTRUCTION (SCOPE.md / research §1.5). The flick
   throws UP-SCREEN; the toy arcs AWAY from the viewer and scales down; the dog
   turns and runs "into" the screen — vertical squash plus uniform scale fakes
   the foreshortening — and then comes back growing larger. The lateral
   component of a flick is clamped hard, because a toy crossing the frame needs
   the side rig we deliberately did not build.

   THE UNCERTAINTY IS THE MECHANIC. Sometimes she brings it back, sometimes she
   settles down to chew it, sometimes she loses interest halfway and comes back
   with nothing. A toy that always returns is a vending machine.

   Two cruelty cases get an IMMEDIATE PHYSICAL REACTION and no score penalty
   (research §2: the original punished teasing and hitting the pet with toys):
     - a toy flicked down AT her: flinch, recoil, ears flat, a hurt look
     - repeated fake throws: she stops buying it, sits, and stares at you
   Neither leaves a mark. She must never resent her.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { makeSprings, approach } from '../engine/spring.js';
import { TAU, clamp, lerp, smooth, hump, easeOut3, ell } from '../engine/draw.js';
import { rng as sharedRng } from '../engine/rng.js';
import { drawBall } from '../scenes/props.js';

const T = BALANCE.toy;
const N = BALANCE.needs;

export function createToy(rig, opts = {}) {
  const game = opts.game;
  const idle = opts.idle;
  const rng = opts.rng || sharedRng;
  const reduced = !!opts.reduced;
  const spawn = opts.spawn || (() => {});
  const sound = opts.sound || (() => {});
  const toast = opts.toast || (() => {});
  const soil = opts.soil || (() => {});
  const s = rig.springs;
  const sp = makeSprings(['toyDog', 'flinch'], reduced);

  /* ---- toy ----------------------------------------------------------- */
  const toy = {
    x: T.home[0], y: T.home[1],
    scale: 1, spin: 0, floor: T.home[1] + 15,
    held: false, inMouth: false, visible: true,
  };
  let state = 'idle';           // idle|held|fly|out|chase|arrive|chew|back|settle|refuse
  let stT = 0;
  let outcome = '';             // fetch|chew|bored
  let unasked = false;
  let flyFrom = { x: 0, y: 0 };
  let flyTo = { x: 0, y: 0 };
  let flyDur = 0.8;
  let flyPower = 0;
  let strideP = 0;
  let chaseDur = 0.8;
  let backDur = 0.9;
  let outIn = 0;                // countdown to an unasked retrieval
  let hitCd = 0;
  const teases = [];
  let clock = 0;
  let refuseT = 0;
  let hint = '';

  /* flick sampling */
  const trail = [];

  /* ================================================================== */
  function reset(toHome) {
    state = 'idle'; stT = 0; outcome = ''; unasked = false;
    toy.inMouth = false; toy.visible = true; toy.scale = 1;
    if (toHome) { toy.x = T.home[0]; toy.y = T.home[1]; }
    toy.floor = toy.y + 15;
    /* restart the "she'll go and get it herself" countdown; without this a
       toy that ends up up-screen is chased on the very next frame */
    outIn = rng.span(T.unaskedAfter);
    sp.toyDog.to(0);
  }

  function grab(vx, vy) {
    toy.held = true;
    state = 'held'; stT = 0;
    trail.length = 0;
    trail.push({ x: vx, y: vy, t: clock });
    sound('toy-pick');
  }

  /** velocity from the tail of the drag trail, in virtual units/second */
  function flickVel() {
    if (trail.length < 2) return { vx: 0, vy: 0 };
    const last = trail[trail.length - 1];
    let first = trail[0];
    for (let i = trail.length - 1; i >= 0; i--) {
      if (last.t - trail[i].t <= T.flick.sampleWindow) first = trail[i];
      else break;
    }
    const dt = Math.max(0.016, last.t - first.t);
    return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
  }

  function release() {
    toy.held = false;
    const v = flickVel();
    const up = -v.vy;                       // up-screen is negative y

    /* ---- CRUELTY: a toy flicked DOWN at her ------------------------- */
    const h = rig.headWorld();
    const onDog = Math.hypot(toy.x - h.x, toy.y - h.y) < T.hit.r;
    if (up < 40 && onDog && hitCd <= 0) {
      /* reset FIRST, then react: hitReaction() drops the ball where it should
         land and sets how long she leaves it alone, and reset() would undo both */
      reset(false);
      hitReaction();
      return;
    }

    if (up < T.flick.minUp) {
      /* not really a throw: it drops where it is. Counts as a fake-out. */
      teases.push(clock);
      while (teases.length && clock - teases[0] > T.tease.window) teases.shift();
      if (teases.length >= T.tease.at) { refuse(); return; }
      reset(false);
      sound('toy-drop');
      return;
    }
    teases.length = 0;

    /* ---- a real throw ---------------------------------------------- */
    flyPower = clamp((up - T.flick.minUp) / (T.flick.maxUp - T.flick.minUp), 0, 1);
    flyFrom = { x: toy.x, y: toy.y };
    /* NEVER LATERAL. The sideways component is kept only as a hint of
       personality — 46 virtual units at the very most. */
    const lateral = clamp(v.vx * 0.05, -46, 46);
    flyTo = {
      x: clamp(toy.x + lateral, 54, 336),
      y: lerp(toy.y - 90, T.fly.vanishY, easeOut3(flyPower)),
    };
    flyDur = lerp(T.fly.dur[0], T.fly.dur[1], flyPower);
    state = 'fly'; stT = 0;
    sound('toy-throw');

    /* exertion + dirt: play is what makes her dirty, not the clock */
    soil(N.dirt.perThrow);
    game.addNeed('energy', -N.exert.energyPerThrow);
    game.addNeed('hunger', -N.exert.hungerPerThrow);
    game.addNeed('thirst', -N.exert.thirstPerThrow);

    /* she tracks it going up — ears, eyes, the whole head */
    rig.lookAtVirtual(flyTo.x, flyTo.y);
    s.perk.kick(3.4);
    s.earL.kick(4.2); s.earR.kick(-3.8);
    s.eyeOpen.kick(2.4);
    rig.blinkNow(1);
  }

  /** CRUELTY — an immediate physical reaction, and nothing that persists. */
  function hitReaction() {
    hitCd = T.hit.cd;
    /* `recoil` belongs to dog/pet.js, not to the rig's spring set — the flinch
       here is our own channel plus the shared rig springs. */
    sp.flinch.set(0); sp.flinch.kick(T.hit.flinch * 13);
    s.squash.kick(2.2);
    s.eyeOpen.kick(3.2);          // eyes WIDEN — this is a fright, not a sulk
    s.earBack.kick(4.6);
    s.earL.kick(6.5); s.earR.kick(-6.0);
    s.headLift.kick(-30);
    s.sit.to(1);
    rig.blinkNow(2);
    game.dentMood(0.10);
    sound('yelp');
    /* The ball drops at her feet, and she LEAVES IT THERE for a while. Without
       this she trots straight off to fetch the thing that just hit her, which
       cancels the flinch and reads as if nothing happened. */
    toy.x = clamp(rig.x + (toy.x > rig.x ? 44 : -44), 40, 350);
    toy.y = 782;
    toy.floor = toy.y + 15;
    toy.scale = 1;
    outIn = T.unaskedAfter[1] + 5;
    if (idle) { idle.cancel(2.2); idle.play('flinch'); }
    /* NO score penalty, NO guilt line, NO memory of it. She is startled for
       about a second and then she is fine, because the dog never resents her. */
  }

  /** TEASING — she stops buying the fake throw and just looks at you. */
  function refuse() {
    teases.length = 0;
    state = 'refuse'; stT = 0;
    refuseT = 2.4;
    reset(false);
    state = 'refuse';
    if (idle) { idle.cancel(2.6); idle.play('bidWhine'); }
    sound('huff');
  }

  /** roll for what she actually does with it. Weighted, never certain. */
  function rollOutcome() {
    const O = T.outcome;
    const mood = game.moodLevel;
    const trust = game.dog.trust;
    const energy = game.dog.needs.energy;
    const tired = 1 - energy;
    const wFetch = Math.max(0.02, O.fetchBase + mood * O.fetchPerMood + trust * O.fetchPerTrust);
    const wChew = Math.max(0.02, O.chewBase + energy * O.chewPerEnergy);
    const wBored = Math.max(0.02, O.boredBase + tired * O.boredPerTired);
    const tot = wFetch + wChew + wBored;
    const r = rng.next() * tot;
    if (r < wFetch) return 'fetch';
    if (r < wFetch + wChew) return 'chew';
    return 'bored';
  }

  function startChase(asked) {
    unasked = !asked;
    outcome = unasked ? 'fetch' : rollOutcome();
    state = 'chase'; stT = 0;
    chaseDur = rng.span(T.run.out);
    strideP = 0;
    sp.toyDog.to(1);
    if (idle) idle.cancel(3.4);
    sound('scamper');
  }

  /* ================================================================== */
  function update(dt, mood) {
    clock += dt;
    stT += dt;
    if (hitCd > 0) hitCd -= dt;
    if (refuseT > 0) refuseT -= dt;
    toy.spin += dt * (state === 'fly' ? T.fly.spin * (0.4 + flyPower) : 0);

    if (state === 'refuse' && refuseT <= 0) { state = 'idle'; stT = 0; }

    if (state === 'fly') {
      const u = clamp(stT / flyDur, 0, 1);
      const e = easeOut3(u);
      toy.x = lerp(flyFrom.x, flyTo.x, e);
      /* the arc plus the recede: y travels toward the vanishing point and the
         scale shrinks, which is what sells "away from the viewer" */
      toy.y = lerp(flyFrom.y, flyTo.y, e) - hump(u) * T.fly.arc * (0.4 + flyPower);
      toy.scale = lerp(1, lerp(0.86, T.fly.minScale, flyPower), e);
      toy.floor = lerp(T.home[1] + 15, flyTo.y + 12, e);
      /* she watches it the whole way */
      rig.lookAtVirtual(toy.x, toy.y);
      if (u >= 1) {
        state = 'out'; stT = 0;
        toy.y = flyTo.y; toy.floor = flyTo.y + 10;
        outIn = rng.span(T.unaskedAfter);
        sound('toy-land');
        /* the chase begins of her own accord after a beat of decision */
        startChase(true);
      }
      return;
    }

    if (state === 'out') {
      /* the toy is abandoned out there. Sooner or later she goes and gets it
         unprompted — which is one of the research's named bids for attention. */
      outIn -= dt;
      if (outIn <= 0) startChase(false);
      return;
    }

    if (state === 'chase') {
      const u = clamp(stT / chaseDur, 0, 1);
      sp.toyDog.to(1);
      strideP += dt * T.run.strideRate;
      soil(N.dirt.perPlaySecond * dt);
      if (outcome === 'bored' && u > 0.55) {
        /* loses interest halfway. Stops, sniffs the floor, wanders back. */
        state = 'back'; stT = 0;
        backDur = rng.span(T.run.back);
        toy.inMouth = false;
        if (idle) idle.play('sniff');
        return;
      }
      if (u >= 1) {
        stT = 0;
        if (outcome === 'chew') { state = 'chew'; chewFor = rng.span(T.chewDur); }
        else { toy.inMouth = true; state = 'back'; backDur = rng.span(T.run.back); }
        sound('toy-grab');
      }
      return;
    }

    if (state === 'chew') {
      soil(N.dirt.perPlaySecond * dt * 0.4);
      if (stT > chewFor) {
        /* she brings it back, but on her own terms: she keeps hold of it and
           drops it near herself, pleased with the whole business */
        toy.inMouth = true;
        state = 'back'; stT = 0;
        backDur = rng.span(T.run.back);
      }
      return;
    }

    if (state === 'back') {
      const u = clamp(stT / backDur, 0, 1);
      sp.toyDog.to(1 - u);
      strideP += dt * T.run.strideRate * 1.05;
      soil(N.dirt.perPlaySecond * dt);
      if (u >= 1) { state = 'settle'; stT = 0; drop(); }
      return;
    }

    if (state === 'settle') {
      sp.toyDog.to(0);
      if (stT > 1.4) { state = 'idle'; stT = 0; outIn = rng.span(T.unaskedAfter); }
      return;
    }

    if (state === 'idle' && !toy.held) {
      /* A TOY LEFT OUT THERE IS AN INVITATION. If she abandoned it mid-chase
         (or it just landed and nobody did anything), she goes and gets it on
         her own after a while and drops it at her feet — which is exactly the
         research's "drops a toy at your feet" bid for attention. */
      const abandoned = toy.y < 660;
      if (abandoned) {
        outIn -= dt;
        if (outIn <= 0) startChase(false);
      }
    }
  }
  let chewFor = 3;

  function drop() {
    const fetched = outcome === 'fetch';
    if (toy.inMouth) {
      /* AT HER FEET if she's giving it up; near herself if she isn't */
      toy.x = fetched ? rig.x + rng.range(-22, 22) : rig.x + rng.range(-58, -30);
      toy.y = fetched ? 792 : 748;
      toy.floor = toy.y + 15;
      toy.scale = 1;
      toy.inMouth = false;
    }
    if (fetched) {
      game.addMood(BALANCE.mood.gain.toy);
      game.awardDay('toy');
      game.log('play', unasked ? 'brought you the ball' : 'fetched the ball');
      /* dropping a toy at her feet IS a bid for attention */
      if (idle) idle.play('bidToy');
      const h = rig.headWorld();
      for (let i = 0; i < (reduced ? 2 : 4); i++) {
        spawn('heart', h.x + rng.range(-22, 22), h.y + rng.range(-18, 6));
      }
      sound('proud-yip');
    } else if (outcome === 'chew') {
      game.addMood(BALANCE.mood.gain.toy * 0.55);
      game.log('play', 'kept the ball for herself');
      if (idle) idle.play('wagBurst');
    } else {
      game.addMood(BALANCE.mood.gain.toy * 0.25);
      game.log('play', 'lost interest halfway');
    }
  }

  /* ================================================================== */
  /*  apply — rig TARGETS only, plus the depth channel                  */
  /* ================================================================== */
  function apply(dt, mood) {
    const d = sp.toyDog.x;
    const fl = clamp(sp.flinch.x * 0.077, 0, 1);

    /* ---- the flinch from being hit by a toy ---- */
    if (fl > 0.01) {
      /* she pulls back and away — the whole body, not just the head */
      const awayX = toy.x > rig.x ? -1 : 1;
      s.sway.to(s.sway.t + awayX * T.hit.retreat * fl * rig.mo.shake);
      s.headLift.to(s.headLift.t - 6 * fl);
      s.pitch.to(clamp(s.pitch.t * (1 - fl * 0.6) - 0.34 * fl, -1, 1));
      s.yaw.to(clamp(s.yaw.t * (1 - fl * 0.5) + awayX * 0.7 * fl, -1.3, 1.3));
      s.eyeOpen.to(clamp(s.eyeOpen.t + 0.22 * fl, 0, 1.25));
      s.eyeSmile.to(s.eyeSmile.t * (1 - fl));
      s.smile.to(s.smile.t * (1 - fl * 0.8));
      s.earBack.to(Math.max(s.earBack.t, fl * 0.9));
      s.tailUp.to(s.tailUp.t - 0.5 * fl);
      s.wagAmp.to(s.wagAmp.t * (1 - fl * 0.8));
    }

    if (state === 'refuse') {
      /* teased once too often: she sits down and looks straight at you */
      const k = clamp(refuseT / 2.4, 0, 1);
      s.sit.to(Math.max(s.sit.t, k));
      rig.lookAtVirtual(195, 985);
      s.eyeOpen.to(1 + 0.10 * k);
      s.brow.to(Math.max(s.brow.t, 0.75 * k));
      s.wagAmp.to(0.10);
      s.wagSpd.to(1.4);
      s.earBack.to(Math.max(s.earBack.t, 0.20 * k));
    }

    /* ...but not while she is still flinching: an excited "where did it go"
       right after being hit is the wrong animal entirely */
    if (fl < 0.05 && (state === 'fly' || (state === 'idle' && stT < 0.4))) {
      /* tracks the toy up-screen: nose up, ears forward, primed */
      s.perk.to(Math.max(s.perk.t, 0.6));
      s.earBack.to(Math.min(s.earBack.t, -0.15));
      s.eyeOpen.to(Math.max(s.eyeOpen.t, 1.12));
      s.wagAmp.to(Math.max(s.wagAmp.t, 0.5));
      s.wagSpd.to(Math.max(s.wagSpd.t, 10));
      s.tailUp.to(Math.max(s.tailUp.t, 0.5));
      s.lift.to(Math.max(s.lift.t, 4));
    }

    if (d < 0.004) {
      /* fully back at the front of the room */
      rig.x = rig.home.x;
      rig.s = rig.home.s;
      rig.y = rig.home.y;
      rig.sy = 1;
      if (state === 'settle') {
        /* drops it and looks up for the verdict */
        const u = clamp(stT / 1.4, 0, 1);
        rig.lookAtVirtual(195, 980);
        s.perk.to(Math.max(s.perk.t, 0.5 * (1 - u * 0.4)));
        s.eyeSmile.to(Math.max(s.eyeSmile.t, 0.55));
        s.smile.to(Math.max(s.smile.t, 0.7));
        s.mouth.to(Math.max(s.mouth.t, 0.26 + 0.12 * Math.sin(rig.t * 13)));
        s.tongue.to(Math.max(s.tongue.t, 0.75));
        s.wagAmp.to(Math.max(s.wagAmp.t, 0.66));
        s.wagSpd.to(Math.max(s.wagSpd.t, 13));
        s.tailUp.to(Math.max(s.tailUp.t, 0.6));
        rig.drive.pant = 0.5 * (1 - u * 0.5);
      } else {
        rig.drive.pant = 0;
      }
      return;
    }

    /* ================= RUNNING INTO THE SCREEN =================
       No side rig, no gait cycle: uniform scale shrinks, `rig.sy` squashes
       vertically, and the paws alternate. The eye reads that as depth. */
    const R = T.run;
    const bob = Math.sin(strideP) ;
    rig.s = rig.home.s * lerp(1, R.minScale, d);
    rig.y = lerp(rig.home.y, T.fly.vanishY + 96, d) + Math.abs(bob) * -R.strideAmp * d;
    rig.x = lerp(rig.home.x, toy.x, d * 0.62) + Math.sin(strideP * 0.5) * 3.2 * d * rig.mo.shake;
    rig.sy = 1 - d * R.squash + bob * 0.045 * d;

    /* a running dog seen from behind: rump up, head low, tail streaming */
    s.squash.to(s.squash.t + d * 0.05 + bob * 0.03 * d);
    s.headLift.to(s.headLift.t - d * 10);
    s.pitch.to(clamp(s.pitch.t * (1 - d) + (-0.34) * d, -1, 1));
    s.earBack.to(Math.max(s.earBack.t, d * 0.75));
    s.eyeOpen.to(clamp(s.eyeOpen.t - d * 0.18, 0.1, 1.25));
    s.mouth.to(Math.max(s.mouth.t, d * (0.22 + 0.1 * Math.abs(bob))));
    s.tongue.to(Math.max(s.tongue.t, d * 0.8));
    s.tailUp.to(Math.max(s.tailUp.t, d * 0.85));
    s.wagAmp.to(Math.max(s.wagAmp.t, d * 0.35));
    s.wagSpd.to(Math.max(s.wagSpd.t, 4 + d * 6));
    s.sit.to(0);
    rig.drive.pant = d * 0.7;
    /* the paws */
    rig.pawLift[0].to(Math.max(0, Math.sin(strideP)) * 1.1 * d);
    rig.pawLift[1].to(Math.max(0, Math.sin(strideP + Math.PI)) * 1.1 * d);
    s.hindKick.to(0.5 * d);

    /* she's facing away, so the head yaws toward wherever the toy is */
    if (state === 'chase' || state === 'chew') {
      const dx = clamp((toy.x - rig.x) / 90, -1, 1);
      s.yaw.to(clamp(s.yaw.t * (1 - d * 0.6) + dx * 0.5 * d, -1.3, 1.3));
    }
    if (state === 'chew') {
      /* head down, worrying at it, rump swaying */
      const w = Math.sin(rig.t * 8.4);
      s.headLift.to(s.headLift.t - 16 * d);
      s.pitch.to(clamp(s.pitch.t * (1 - d) + (-0.85) * d, -1, 1));
      s.tilt.to(s.tilt.t + w * 0.18 * d * rig.mo.shake);
      s.mouth.to(Math.max(s.mouth.t, 0.24 + Math.abs(w) * 0.22));
      s.sway.to(s.sway.t + Math.sin(rig.t * 3.2) * 3.4 * d * rig.mo.shake);
      rig.pawLift[0].to(0); rig.pawLift[1].to(0);
      rig.drive.pant = d * 0.4;
    }
    if (state === 'back') {
      /* coming back: head up, proud, ears free */
      s.headLift.to(s.headLift.t + d * 6);
      s.pitch.to(clamp(s.pitch.t + 0.18 * (1 - d), -1, 1));
      s.earBack.to(s.earBack.t * 0.7);
      s.tailUp.to(Math.max(s.tailUp.t, 0.7));
      s.wagAmp.to(Math.max(s.wagAmp.t, 0.55));
      s.wagSpd.to(Math.max(s.wagSpd.t, 12));
      if (toy.inMouth) s.mouth.to(Math.max(s.mouth.t, 0.30));
    }
  }

  /* ================================================================== */
  function pointer(ev, l) {
    if (state === 'chase' || state === 'chew' || state === 'back' || state === 'fly') return false;
    if (ev.type === 'down') {
      if (!toy.visible) return false;
      const r = T.r * 2.2;
      if (Math.hypot(ev.x - toy.x, (ev.y - toy.y) * 1.25) < r) {
        grab(ev.x, ev.y);
        return true;
      }
      return false;
    }
    if (ev.type === 'move' && toy.held) {
      toy.x = clamp(ev.x, 30, 360);
      toy.y = clamp(ev.y, 200, 820);
      toy.floor = Math.max(toy.y + 15, 700);
      trail.push({ x: ev.x, y: ev.y, t: clock });
      while (trail.length > 12) trail.shift();
      /* she follows it while it is in her hand: this is the anticipation */
      rig.lookAtVirtual(toy.x, toy.y);
      return true;
    }
    if ((ev.type === 'up' || ev.type === 'cancel') && toy.held) {
      if (ev.type === 'cancel') { toy.held = false; reset(false); return true; }
      release();
      return true;
    }
    return false;
  }

  /* ================================================================== */
  /* WHICH toy is on the rug. Stage 4's walks are the only thing that adds to
     `inventory.toys`, so whatever he carried home from the woods is what he
     now fetches — which is what makes a find a real unlock. Unknown ids fall
     back to the ball inside drawBall(). */
  const variant = () => (game && game.activeToy ? game.activeToy : 'ball');

  function draw(g) {
    const c = g.ctx;
    if (!toy.visible) return;
    if (toy.inMouth) {
      /* carried: sits at the muzzle and scales with her */
      const P = rig.pose;
      const mx = rig.x + P.muzX * rig.s;
      const my = rig.y + (P.muzY + 6) * rig.s * (rig.sy || 1);
      drawBall(c, mx, my, 0.72 * rig.s / rig.home.s * (rig.sy || 1), toy.spin, undefined, variant());
      return;
    }
    const held = toy.held ? 1 : 0;
    if (held) {
      /* a soft ring under the hand, so it is obvious the ball can be flung */
      c.save();
      c.globalAlpha = 0.22;
      const gr = c.createRadialGradient(toy.x, toy.y, 2, toy.x, toy.y, 44);
      gr.addColorStop(0, 'rgba(255,246,214,0.9)');
      gr.addColorStop(1, 'rgba(255,246,214,0)');
      c.fillStyle = gr;
      c.beginPath(); c.arc(toy.x, toy.y, 44, 0, TAU); c.fill();
      c.restore();
    }
    drawBall(c, toy.x, toy.y - held * 4, toy.scale * (1 + held * 0.06), toy.spin, toy.floor, variant());
  }

  /* ================================================================== */
  return {
    get toy() { return toy; },
    get state() { return state; },
    get outcome() { return outcome; },
    /** true while she is away from her spot — the room suppresses petting */
    get busy() { return state === 'chase' || state === 'chew' || state === 'back' || state === 'fly'; },
    get held() { return toy.held; },
    get depth() { return sp.toyDog.x; },
    update(dt, mood) { update(dt, mood); for (const k in sp) sp[k].step(dt); },
    apply, pointer, draw,
    /** stage 5's disc game reuses this: throw programmatically */
    throwUp(power = 0.6) {
      toy.x = rig.x + rng.range(-20, 20);
      toy.y = 760;
      trail.length = 0;
      trail.push({ x: toy.x, y: toy.y + 120, t: clock - 0.05 });
      trail.push({ x: toy.x, y: toy.y, t: clock });
      flyPower = power;
      flyFrom = { x: toy.x, y: toy.y };
      flyTo = { x: clamp(toy.x + rng.range(-30, 30), 54, 336), y: lerp(toy.y - 90, T.fly.vanishY, easeOut3(power)) };
      flyDur = lerp(T.fly.dur[0], T.fly.dur[1], power);
      state = 'fly'; stT = 0;
      soil(N.dirt.perThrow);
      game.addNeed('energy', -N.exert.energyPerThrow);
      game.addNeed('hunger', -N.exert.hungerPerThrow);
      game.addNeed('thirst', -N.exert.thirstPerThrow);
      return true;
    },
    reset,
    get debug() {
      return {
        state, outcome, unasked, held: toy.held,
        at: [Math.round(toy.x), Math.round(toy.y)], scale: +toy.scale.toFixed(3),
        depth: +sp.toyDog.x.toFixed(3), inMouth: toy.inMouth,
        rigS: +rig.s.toFixed(3), rigSy: +(rig.sy || 1).toFixed(3), rigY: Math.round(rig.y),
        teases: teases.length, flinch: +sp.flinch.x.toFixed(2),
      };
    },
  };
}

export default createToy;
