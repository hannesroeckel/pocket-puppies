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
/* THE REACHABLE PLAY AREA. Every resting position below is authored as an
   offset from the room's floor line and then clamped to this — see the header
   of ui/reach.js for the defect that made it necessary. */
import reach from '../ui/reach.js';

const T = BALANCE.toy;
const N = BALANCE.needs;

/* the grab ellipse's half-extents. `rx` is what `pointer()` tests against and
   `ry` is what the reachable-area clamp has to respect: a ball clamped by its
   drawn radius still has the bottom third of its TOUCH area under the bar. */
const GRAB_RX = T.r * T.grab.r;
const GRAB_RY = GRAB_RX / T.grab.aspect;

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

  /**
   * WHERE A RESTING BALL GOES, for each of the four named slots.
   *
   * Authored as an offset from `rig.floorV` — the room's one floor line, the
   * same number the bowl and his planted paws resolve against — and then passed
   * through `reach.clampY()`, which is the bottom of what a thumb can touch.
   * The floor is the ANCHOR and the reach line is the BOUND; on the target
   * iPhone the bound is 28 units above the floor, so it binds and the four
   * slots compress against it. That is the correct answer rather than a
   * regrettable one: below that line the nav owns the pixels AND the touches.
   *
   * A function rather than four constants because the bound moves with the
   * device — a rotation or an inset change has to be picked up on the next
   * frame, not baked in at construction.
   */
  function restY(slot) {
    const floor = Number.isFinite(rig.floorV) ? rig.floorV : BALANCE.view.H - 120;
    return reach.clampY(floor + T.rest[slot], GRAB_RY);
  }

  /* ---- toy ----------------------------------------------------------- */
  const toy = {
    x: T.homeX, y: restY('home'),
    scale: 1, spin: 0, floor: restY('home') + 15,
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
    if (toHome) { toy.x = T.homeX; toy.y = restY('home'); }
    /* WHEREVER IT IS, IT HAS TO BE REACHABLE. `reset(false)` is the path a
       fake-out drop and a cancelled drag both take, and it used to leave the
       ball at whatever y the pointer last had — which on the target phone could
       be under the bar. Clamping here rather than only at the call sites means
       the invariant holds for a caller that has not been written yet. */
    toy.y = reach.clampY(toy.y, GRAB_RY);
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
       cancels the flinch and reads as if nothing happened.

       THIS IS THE SOFT-LOCK THE HUMAN FOUND ON HIS OWN PHONE. The drop was a
       hardcoded `782`, which is 48 units inside the bar's hit rect on the target
       iPhone; `scenes/room.js` offers the touch to the bar before the toy, so
       tapping the ball pressed TRAIN. And nothing could recover it — the
       unprompted retrieval only fires below y 660 and `reset(true)` has no
       callers — so the price of an accidental hit was losing the ball for good.
       A dog who must never resent her was punishing her instead.

       Now it is the `flinch` slot: the floor line plus an authored offset,
       clamped to the reachable play area. She still leaves it alone; the
       difference is that it is still there when she goes to pick it up. */
    toy.x = clamp(rig.x + (toy.x > rig.x ? 44 : -44), 40, 350);
    toy.y = restY('flinch');
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

  /**
   * THE THREE WEIGHTS, as their own function so the debug block and the roll
   * cannot disagree about them. A gate that samples 40 throws is measuring the
   * RNG as much as the design; reading the weights measures the design.
   */
  function weights() {
    const O = T.outcome;
    const mood = game.moodLevel;
    const trust = game.dog.trust;
    const energy = game.dog.needs.energy;
    const tired = 1 - energy;
    /* WHAT HE IS PLAYING WITH TILTS THE ROLL (BALANCE.toy.kinds). Absent from
       the table means 1, so every toy that shipped before behaves as it did. */
    const K = (T.kinds && T.kinds[variant()]) || null;
    const mul = (k) => (K && Number.isFinite(+K[k]) ? +K[k] : 1);
    return {
      fetch: Math.max(0.02, (O.fetchBase + mood * O.fetchPerMood + trust * O.fetchPerTrust) * mul('fetch')),
      chew: Math.max(0.02, (O.chewBase + energy * O.chewPerEnergy) * mul('chew')),
      bored: Math.max(0.02, (O.boredBase + tired * O.boredPerTired) * mul('bored')),
    };
  }

  /** roll for what she actually does with it. Weighted, never certain. */
  function rollOutcome() {
    const w = weights();
    const tot = w.fetch + w.chew + w.bored;
    const r = rng.next() * tot;
    if (r < w.fetch) return 'fetch';
    if (r < w.fetch + w.chew) return 'chew';
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

    /* THE BOUND IS LIVE, SO THE CLAMP HAS TO BE TOO.
       Found by this file's own per-frame assertion: `createToy` runs during
       `scene.enter`, and on a real phone the safe-area inset can arrive AFTER
       that — a rotation, a keyboard, or simply Safari settling its chrome. The
       constructor's `restY('home')` was therefore a snapshot of the bound as it
       was at boot, and at inset 40 the ball sat 26 units inside the bar for as
       long as nobody dropped it. Which is the whole defect again, one layer up:
       a position captured once against a line that moves.

       So it is re-asserted every frame, in the states where the toy owns its own
       position. Not while HELD (the drag clamps as it goes), not in the MOUTH
       (it rides the muzzle), and not in FLIGHT (the arc is recomputed from a
       start that was already clamped, and it only ever travels up-screen). */
    if (!toy.held && !toy.inMouth && state !== 'fly') {
      const y = reach.clampY(toy.y, GRAB_RY);
      if (y !== toy.y) { toy.floor += y - toy.y; toy.y = y; }
    }
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
      /* the shadow recedes with it. This read `T.home[1] + 15` — the ball's
         home floor — as a stand-in for "the near floor", which was wrong
         whenever the throw started anywhere else and is a fifth copy of a
         coordinate now that home is derived. The release point's own floor is
         both correct and self-anchoring. */
      toy.floor = lerp(flyFrom.y + 15, flyTo.y + 12, e);
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
      /* "OUT THERE" IS RELATIVE TO WHERE IT RESTS, not an absolute y.
         This was `toy.y < 660`, chosen when home was a hardcoded 736 — i.e. it
         meant "76 units up-screen from its resting spot". Once home is derived
         the two drifted apart, and the gate caught it at inset 80: with home
         clamped to 653.84 a ball lying AT HER FEET counted as abandoned, so she
         fetched it unprompted for ever. `awayAbove` is that same 76 units, said
         once, relative to the slot it was always relative to. */
      const abandoned = toy.y < restY('home') - T.awayAbove;
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
      /* AT HER FEET if she's giving it up; near herself if she isn't.
         Both were absolute (792 / 748) and both were inside the bar's hit rect
         on the target phone — the SUCCESSFUL fetch was the worst of the two, at
         792 with 82% of its grab ellipse under the bar. The x offsets are what
         actually carry "she gave it to you" versus "she kept it"; the y slots
         now hang off the floor line and are clamped, so where the reach line
         binds they read as the same depth, which is a loss of nuance rather
         than a loss of the ball. */
      toy.x = fetched ? rig.x + rng.range(-22, 22) : rig.x + rng.range(-58, -30);
      toy.y = restY(fetched ? 'feet' : 'own');
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
      /* the same two numbers the reachable-area clamp uses, so the area that is
         tested and the area that is kept clear of the bar are one ellipse */
      const r = GRAB_RX;
      if (Math.hypot(ev.x - toy.x, (ev.y - toy.y) * T.grab.aspect) < r) {
        grab(ev.x, ev.y);
        return true;
      }
      return false;
    }
    if (ev.type === 'move' && toy.held) {
      toy.x = clamp(ev.x, T.dragX[0], T.dragX[1]);
      /* THE HAND CANNOT PUT IT SOMEWHERE THE HAND CANNOT GET IT BACK FROM.
         This was `clamp(ev.y, 200, 820)` — 820 is 20 units past the bottom of
         the bar's hit rect, so a player could park the ball under the bar
         deliberately and never retrieve it. The vertical range IS the reachable
         play area now, both ends of it. */
      toy.y = reach.clampY(ev.y, GRAB_RY);
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
    /**
     * THE DEPTH-SORT LINE: the shallowest y a ball at rest can have.
     *
     * `scenes/room.js` decides whether to draw the ball in front of him or
     * behind him, and it used to compare against `rig.y - 8` — the rig origin,
     * 698. That happened to be below every resting slot while home was a
     * hardcoded 736, so a resting ball was always in front. Once the reachable
     * play area lifted the slots to 693.84 the test flipped, and a ball dropped
     * at his feet after a flinch was drawn BEHIND him — at x = rig.x + 44 that
     * put it entirely inside his silhouette. Reachable, and invisible, which for
     * a ball she has just been told about is barely better than gone.
     *
     * So the sort line is now the rest slots themselves: a ball at rest is at
     * his feet and in front, and anything above that is further into the room
     * and behind. Derived, so it cannot come apart from them again.
     */
    get restLine() {
      let m = Infinity;
      for (const k in T.rest) m = Math.min(m, restY(k));
      return m;
    },
    update(dt, mood) { update(dt, mood); for (const k in sp) sp[k].step(dt); },
    apply, pointer, draw,
    /** stage 5's disc game reuses this: throw programmatically */
    throwUp(power = 0.6) {
      toy.x = rig.x + rng.range(-20, 20);
      /* was a hardcoded 760, which is inside the bar's hit rect on the target
         phone: a programmatic throw that got interrupted would have left the
         ball unreachable. It starts at her feet, like a thrown ball does. */
      toy.y = restY('feet');
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
    /**
     * WHAT THE PER-FRAME ASSERTION SEES (ui/reach.js). The grab ellipse, its
     * state, and whether the nav can actually steal a touch on it right now —
     * `live` is false while she is carrying it or it is in the air, because
     * `pointer()` refuses those states outright and an unreachable ball nobody
     * is allowed to touch is not a defect.
     */
    reachProbe() {
      return {
        id: 'toy', state: toy.held ? 'held' : state,
        x: toy.x, y: toy.y, rx: GRAB_RX, ry: GRAB_RY,
        live: toy.visible && !toy.inMouth
          && state !== 'fly' && state !== 'chase' && state !== 'chew' && state !== 'back',
      };
    },
    get debug() {
      return {
        state, outcome, unasked, held: toy.held,
        /* WHAT THIS TOY MAKES LIKELY, as shares that sum to 1. The per-toy bias
           (BALANCE.toy.kinds) is a probability, so sampling throws measures the
           RNG as much as the rule; this is the rule. */
        variant: variant(),
        odds: (() => {
          const w = weights();
          const tot = w.fetch + w.chew + w.bored;
          return {
            fetch: +(w.fetch / tot).toFixed(4),
            chew: +(w.chew / tot).toFixed(4),
            bored: +(w.bored / tot).toFixed(4),
          };
        })(),
        at: [Math.round(toy.x), Math.round(toy.y)], scale: +toy.scale.toFixed(3),
        /* the grab ellipse and how much room it has left above the bar. A
           negative `clear` is the defect, per frame, as one number. */
        grab: [GRAB_RX, +GRAB_RY.toFixed(2)],
        reachClear: +(reach.bottom - (toy.y + GRAB_RY)).toFixed(2),
        restSlots: {
          home: +restY('home').toFixed(2), feet: +restY('feet').toFixed(2),
          own: +restY('own').toFixed(2), flinch: +restY('flinch').toFixed(2),
        },
        depth: +sp.toyDog.x.toFixed(3), inMouth: toy.inMouth,
        rigS: +rig.s.toFixed(3), rigSy: +(rig.sy || 1).toFixed(3), rigY: Math.round(rig.y),
        teases: teases.length, flinch: +sp.flinch.x.toFixed(2),
      };
    },
  };
}

export default createToy;
