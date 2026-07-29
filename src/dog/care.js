/* ==========================================================================
   dog/care.js — the four care actions: FEED, WATER, WASH, BRUSH.

   Every one of them is a thing she DOES, not a button that plays a canned
   animation:

     FEED   drag the bowl into place, then hold the sack over it to pour.
            Kibble piles up piece by piece. The dog comes to the bowl and eats
            head-down, one bite at a time, and THE TAIL RISES AS THE HUNGER
            FILLS. Portion size scales with appetite (research §4): a famished
            dog clears the bowl, a full dog sniffs it and wanders off.
     WATER  the same shape with the jug — and the lapping is its own foley
            beat: a fast tongue, the surface dropping, drips off the muzzle.
     WASH   REUSES THE PETTING STROKE FIELD. Dirt is a per-region mask and her
            strokes genuinely erase it where she strokes. Foam builds under her
            finger. The shake-off at the end, spraying droplets, is the payoff.
     BRUSH  the stroke field again, but the coat has a GRAIN. With the grain
            raises gloss; against the grain is a BAD SPOT and gets a complaint.

   PIPELINE POSITION — DELIBERATE DEVIATION (see ARCHITECTURE §11.8).
   `care.apply()` runs AFTER `pet.apply()`, not before it:
       rig.base -> idle.update -> pet.apply -> care.apply -> rig.update
   During feed and water the action owns the head, and petting must not be able
   to yank her muzzle out of the bowl. During wash and brush care writes almost
   no pose at all, so the petting response still reads through completely.
   Every layer here still writes TARGETS ONLY.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { Spring, makeSprings, approach } from '../engine/spring.js';
import { TAU, clamp, lerp, smooth, hump, plateau, ell, rgba } from '../engine/draw.js';
import { rng as sharedRng } from '../engine/rng.js';
import { drawBowl, drawSack, drawJug, drawBrush, drawSoap, drawDropRing, PC } from '../scenes/props.js';

const C = BALANCE.care;
const ST = C.stage;
const N = BALANCE.needs;

/* particle kinds */
const K_KIBBLE = 0, K_WATER = 1, K_FOAM = 2, K_DROP = 3, K_TUFT = 4, K_SPARK = 5;

export function createCare(rig, opts = {}) {
  const game = opts.game;
  const pet = opts.pet;
  const idle = opts.idle;
  const rng = opts.rng || sharedRng;
  const reduced = !!opts.reduced;
  const spawn = opts.spawn || (() => {});
  const sound = opts.sound || (() => {});
  const toast = opts.toast || (() => {});
  const s = rig.springs;
  const RM = BALANCE.reducedMotion;
  const partScale = reduced ? RM.particleScale : 1;

  /* care-owned springs */
  const sp = makeSprings(['prop', 'tip', 'fill', 'eat', 'lap', 'suds', 'wet', 'gloss', 'care', 'brushA', 'flinch'], reduced);

  let mode = '';
  let phase = '';
  let phaseT = 0;
  let t = 0;
  let hint = '';
  let hintT = 0;
  let finishedNeed = false;

  /* ---- props --------------------------------------------------------- */
  const bowl = { x: ST.bowlHome[0], y: ST.bowlHome[1], tx: 0, ty: 0, held: false, placed: false, kind: 'food' };
  const pourer = { x: 0, y: 0, held: false, over: 0, shown: false };
  let fill = 0;               // 0..1 bowl contents
  let served = 0;             // how much was poured in total this session
  let ripple = 0;
  let biteIn = 0;
  let bites = 0;
  let appetite = 1;   // sampled once, when she puts her head down

  /* ---- the coat model (live even when no care action is running) ------
     A dirty dog is dirty in the room, not only in the bath. `dirt` is the
     live array from state/game.js — one source of truth, no mirror. */
  const coat = {
    regions: C.wash.regions,
    dirt: game ? game.dirt : new Array(C.wash.regions.length).fill(0),
    foam: new Array(C.wash.regions.length).fill(0),
    wet: 0, suds: 0, gloss: game ? game.gloss : 0.3, sheen: 0,
    dirtMean: 0,
  };

  /* ---- brush state --------------------------------------------------- */
  const brush = { x: 0, y: 0, ang: 0, press: 0, down: false, cd: 0, bad: 0, good: 0, tufts: 0 };
  const pile = [];            // brushed-out fur that stays on the floor

  /* ---- particles ----------------------------------------------------- */
  const parts = [];
  function pp(k, x, y, vx, vy, size, dur, extra) {
    if (parts.length > 190) parts.shift();
    parts.push({
      k, x, y, vx, vy, s: size, life: 0, dur,
      rot: rng.range(0, TAU), rv: rng.range(-3, 3),
      ph: rng.range(0, TAU), a: 1, ...(extra || {}),
    });
  }

  /* ================================================================== */
  /*  geometry helpers                                                  */
  /* ================================================================== */
  /** a dirt region's centre in RIG-LOCAL space (for stroke hit tests) */
  function regionLocal(i) {
    const r = coat.regions[i];
    const a = pet.anchor(r.part);
    return { x: a.x + r.at[0] * a.hx, y: a.y + r.at[1] * a.hy, r: r.r };
  }
  /** virtual-space position of a rig-local point */
  function toV(lx, ly) { return { x: rig.x + lx * rig.s, y: rig.y + ly * rig.s }; }

  /**
   * THE COAT GRAIN. A frontal coat lies downward and fans outward from the
   * spine, so the grain at a point is (mostly down) + (radially away from the
   * midline). Brushing along it is lovely; brushing against it is a bad spot.
   * @returns unit vector in rig-local space
   */
  function grainAt(lx, ly) {
    const G = C.brush.grain;
    const head = pet.anchor('head');
    const body = pet.anchor('body');
    const useHead = Math.hypot(lx - head.x, ly - head.y) < head.hy * 1.15;
    const a = useHead ? head : body;
    const out = clamp((lx - a.x) / Math.max(1, a.hx), -1, 1);
    let gx = out * G.out;
    let gy = G.down;
    const L = Math.hypot(gx, gy) || 1;
    return { x: gx / L, y: gy / L };
  }

  function setHint(txt) { if (txt !== hint) { hint = txt; hintT = 0; } }

  function goPhase(p) { phase = p; phaseT = 0; }

  /* ================================================================== */
  /*  lifecycle                                                         */
  /* ================================================================== */
  function start(kind) {
    if (!N.fills[kind]) return false;
    mode = kind;
    t = 0;
    finishedNeed = false;
    sp.care.to(1);
    parts.length = 0;
    /* yesterday's brushed-out fur should not still be on the floor today */
    pile.length = 0;
    brush.bad = 0; brush.good = 0; brush.tufts = 0; brush.down = false;
    served = 0; bites = 0; biteIn = 0; ripple = 0;
    coat.dirt = game.dirt;

    if (kind === 'feed' || kind === 'water') {
      bowl.kind = kind === 'feed' ? 'food' : 'water';
      const home = kind === 'feed' ? ST.bowlHome : ST.waterHome;
      bowl.x = home[0];
      bowl.y = home[1];
      bowl.held = false; bowl.placed = false;
      fill = 0;
      sp.fill.set(0); sp.prop.set(0); sp.tip.set(0);
      pourer.shown = false; pourer.held = false; pourer.over = 0;
      const ph = kind === 'feed' ? C.feed.sackHome : C.water.jugHome;
      pourer.x = ph[0]; pourer.y = ph[1];
      goPhase('place');
      setHint(kind === 'feed' ? 'Slide her bowl over' : 'Slide her water bowl over');
    } else if (kind === 'wash') {
      sp.wet.to(1); sp.suds.set(0);
      for (let i = 0; i < coat.foam.length; i++) coat.foam[i] = 0;
      goPhase('wet');
      setHint('');
      sound('water-on');
    } else if (kind === 'brush') {
      sp.gloss.set(game.gloss);
      goPhase('brush');
      setHint('Brush the way her coat lies');
    }
    /* she notices something is happening, whatever it is */
    if (idle) idle.cancel(2.4);
    s.earL.kick(3.2); s.earR.kick(-2.8);
    s.perk.kick(1.4);
    rig.blinkNow(1);
    return true;
  }

  function stop() {
    if (!mode) return;
    /* washing and brushing own the cleanliness word; reconcile on the way out */
    if (mode === 'wash') game.syncCleanliness();
    mode = '';
    phase = '';
    sp.care.to(0);
    sp.wet.to(0);
    sp.suds.to(0);
    sp.tip.to(0);
    pourer.held = false;
    bowl.held = false;
    brush.down = false;
    setHint('');
  }

  /** the payoff is over; hold the beat, then leave of our own accord */
  function finish(word) {
    goPhase('finish');
    if (word) toast(word);
    if (!finishedNeed) {
      finishedNeed = true;
      game.addMood(BALANCE.mood.gain[mode] || 0.25);
      game.awardDay('care:' + mode);
      game.log('care', mode);
    }
    /* a completed care action is worth a burst of hearts, wherever she is */
    const h = rig.headWorld();
    const n = Math.round(4 * partScale);
    for (let i = 0; i < n; i++) spawn('heart', h.x + rng.range(-26, 26), h.y + rng.range(-22, 6));
    if (idle) idle.play('wagBurst');
  }

  /* ================================================================== */
  /*  pointer — returns true when care CONSUMED the event                */
  /*  (wash and brush return false so the petting field still gets it)   */
  /* ================================================================== */
  function pointer(ev, l) {
    if (!mode) return false;

    /* the leave affordance, top-right, drawn by drawOver() */
    if (ev.type === 'down' && ev.x > 318 && ev.y > 40 && ev.y < 84) {
      stop();
      return true;
    }

    if (mode === 'feed' || mode === 'water') {
      if (ev.type === 'down') {
        /* the pourer is on top, so test it first */
        if (pourer.shown && Math.hypot(ev.x - pourer.x, ev.y - pourer.y) < 46) {
          pourer.held = true;
          return true;
        }
        if (!bowl.placed && Math.hypot(ev.x - bowl.x, (ev.y - bowl.y) * 1.7) < 44) {
          bowl.held = true;
          sound('bowl-lift');
          return true;
        }
        /* tapping the dog during the eat phase is petting, not a prop drag */
        return phase === 'place' || phase === 'pour';
      }
      if (ev.type === 'move') {
        if (pourer.held) {
          pourer.x = clamp(ev.x, 26, 364);
          pourer.y = clamp(ev.y, 300, 812);
          return true;
        }
        if (bowl.held) {
          bowl.x = clamp(ev.x, 34, 356);
          bowl.y = clamp(ev.y, 600, 816);
          return true;
        }
        return false;
      }
      if (ev.type === 'up' || ev.type === 'cancel') {
        if (pourer.held) { pourer.held = false; return true; }
        if (bowl.held) {
          bowl.held = false;
          const d = Math.hypot(bowl.x - ST.bowlTarget[0], (bowl.y - ST.bowlTarget[1]) * 1.5);
          if (d < ST.snap && phase === 'place') {
            bowl.placed = true;
            sp.prop.set(0); sp.prop.kick(9);
            sound('bowl-set');
            goPhase('pour');
            pourer.shown = true;
            setHint(mode === 'feed' ? 'Hold the bag over the bowl' : 'Tip the jug over the bowl');
          }
          return true;
        }
        return false;
      }
      return false;
    }

    /* ---- WASH + BRUSH: the stroke field does the work, so never consume ---
       These two are petting with a tool on the end. The room feeds the same
       event to dog/pet.js afterwards, so the deformation field, the sweet and
       bad spots, the rhythm and the leaning all still work while she scrubs. */
    if (mode === 'wash' || mode === 'brush') {
      if (ev.type === 'down') {
        brush.down = true;
        brush.x = ev.x; brush.y = ev.y;
        /* a new stroke must not measure travel from where the last one ended */
        lastL = { x: l.x, y: l.y };
      }
      if (ev.type === 'up' || ev.type === 'cancel') {
        brush.down = false;
        /* `good` is NOT reset here: the bliss of being brushed properly has to
           survive between strokes or she snaps back to neutral every time the
           finger lifts. It ebbs away in update() instead. */
        lastL = null;
      }
      if (ev.type === 'move') {
        brush.x = ev.x; brush.y = ev.y;
        if (mode === 'wash' && phase === 'scrub') scrub(l, ev);
        if (mode === 'brush' && phase === 'brush') stroke(l, ev);
      }
      return false;
    }
    return false;
  }

  /* ---- WASH: the strokes erase the dirt where she strokes ------------- */
  let lastL = null;
  function scrub(l, ev) {
    const W = C.wash;
    if (!lastL) { lastL = { x: l.x, y: l.y }; return; }
    const dx = l.x - lastL.x, dy = l.y - lastL.y;
    const seg = Math.hypot(dx, dy);
    lastL.x = l.x; lastL.y = l.y;
    if (seg <= 0.01) return;
    const travel = Math.min(seg, 16);
    let erased = 0;
    for (let i = 0; i < coat.regions.length; i++) {
      const rl = regionLocal(i);
      const d = Math.hypot(l.x - rl.x, l.y - rl.y);
      const f = clamp(1 - d / W.scrubRadius, 0, 1);
      if (f <= 0) continue;
      const before = coat.dirt[i];
      if (before > 0) {
        game.setDirt(i, before - travel * W.scrubPerUnit * f);
        erased += before - coat.dirt[i];
      }
      coat.foam[i] = clamp(coat.foam[i] + travel * W.foamPerUnit * f, 0, 1);
    }
    /* cleanliness tracks the mask continuously, so the WORD changes live */
    if (erased > 0) game.syncCleanliness();
    /* foam under the finger */
    if (rng.chance(clamp(seg * 0.10, 0, 0.7))) {
      pp(K_FOAM, ev.x + rng.range(-9, 9), ev.y + rng.range(-9, 9),
        rng.range(-6, 6), rng.range(-16, -4), rng.range(2.6, 6.2), rng.range(0.7, 1.5));
    }
    if (erased > 0.004) sound('scrub');
  }

  /* ---- BRUSH: the grain matters --------------------------------------- */
  function stroke(l, ev) {
    const B = C.brush;
    if (!lastL) { lastL = { x: l.x, y: l.y }; return; }
    const dx = l.x - lastL.x, dy = l.y - lastL.y;
    const seg = Math.hypot(dx, dy);
    lastL.x = l.x; lastL.y = l.y;
    if (seg <= 0.35) return;
    const ux = dx / seg, uy = dy / seg;
    /* the brush turns to follow the stroke */
    sp.brushA.to(Math.atan2(uy, ux) - Math.PI / 2);
    brush.press = 1;

    /* is the finger even on her? */
    const hit = pet.hitZone(l.x, l.y);
    if (!hit) return;

    const g = grainAt(l.x, l.y);
    const dot = ux * g.x + uy * g.y;
    const travel = Math.min(seg, 16);

    if (dot > B.withAt) {
      /* ---- with the grain: gloss rises visibly ---- */
      const q = clamp((dot - B.withAt) / (1 - B.withAt), 0, 1);
      game.addGloss(travel * B.glossPerUnit * (0.5 + q * 0.5));
      game.fillNeed('brush', travel * B.cleanPerUnit);
      /* brushing also lifts loose dirt, just never all of it */
      for (let i = 0; i < coat.regions.length; i++) {
        const rl = regionLocal(i);
        const f = clamp(1 - Math.hypot(l.x - rl.x, l.y - rl.y) / 34, 0, 1);
        if (f > 0 && coat.dirt[i] > 0.12) game.setDirt(i, coat.dirt[i] - travel * 0.004 * f);
      }
      brush.good += travel;
      brush.bad = 0;
      /* loose fur comes out in little tufts */
      if (brush.tufts < B.tuftPile && rng.chance(travel * B.tuftPerUnit)) {
        brush.tufts++;
        pp(K_TUFT, ev.x + rng.range(-6, 6), ev.y + rng.range(-4, 4),
          rng.range(-9, 9), rng.range(-14, -2), rng.range(3.4, 6.0), rng.range(1.6, 2.6));
      }
      if (rng.chance(travel * 0.035 * partScale)) {
        pp(K_SPARK, ev.x + rng.range(-14, 14), ev.y + rng.range(-14, 14),
          0, rng.range(-16, -5), rng.range(2.2, 4.2), rng.range(0.5, 0.9));
      }
      game.addMood(travel * BALANCE.mood.perStrokeUnit * 0.35);
      if (brush.good > 90) { brush.good = 0; sound('brush'); }
    } else if (dot < B.againstAt && brush.cd <= 0) {
      /* ---- AGAINST the grain: a bad spot, and she says so ---- */
      complain();
    }
  }

  function complain() {
    const B = C.brush;
    brush.cd = B.complainCd;
    brush.bad++;
    brush.good = 0;
    /* the complaint goes through the SAME channel a bad spot uses, so it
       reads identically to petting her nose: irritation, recoil, a look */
    pet.irritate(B.complainIrritate);
    sp.flinch.set(0); sp.flinch.kick(9);
    s.earBack.kick(3.4);
    s.eyeOpen.kick(2.0);
    s.earL.kick(4.4); s.earR.kick(-3.9);
    rig.blinkNow(1);
    game.dentMood();
    sound('grumble-brush');
    if (brush.bad >= B.hadEnoughAt) {
      brush.bad = 0;
      /* she has had enough of that and pulls away — a physical reaction,
         never a score penalty. She is not sulking; she just moved. */
      if (idle) idle.play('pawPull');
      s.sit.to(1);
      setHint('She likes it downward, the way it lies');
    }
  }

  /* ================================================================== */
  /*  update: props, phases, particles                                  */
  /* ================================================================== */
  function update(dt, mood) {
    t += dt;
    coat.gloss = game.gloss;
    coat.dirt = game.dirt;
    coat.dirtMean = game.dirtMean;
    coat.sheen += dt * C.brush.sheenSpeed;
    hintT += dt;
    if (brush.cd > 0) brush.cd -= dt;
    brush.press = approach(brush.press, brush.down ? 1 : 0, 9, dt);
    if (!brush.down) brush.good = approach(brush.good, 0, C.brush.goodDecay, dt);
    ripple = approach(ripple, 0, 2.4, dt);
    /* foam dries off slowly wherever she stopped scrubbing */
    if (mode !== 'wash') {
      for (let i = 0; i < coat.foam.length; i++) coat.foam[i] = Math.max(0, coat.foam[i] - dt * 0.7);
    }
    coat.wet = sp.wet.x;
    coat.suds = sp.suds.x;
    if (!mode && sp.care.x < 0.002 && !parts.length && !pile.length) { stepSprings(dt); return; }

    if (mode) phaseT += dt;

    if (mode === 'feed') updateFeed(dt);
    else if (mode === 'water') updateWater(dt);
    else if (mode === 'wash') updateWash(dt);
    else if (mode === 'brush') updateBrush(dt);

    /* the props chase where they should be */
    if (mode === 'feed' || mode === 'water') {
      if (bowl.placed && !bowl.held) {
        bowl.x = approach(bowl.x, ST.bowlTarget[0], 16, dt);
        bowl.y = approach(bowl.y, ST.bowlTarget[1], 16, dt);
      } else if (!bowl.held && !bowl.placed) {
        const home = mode === 'feed' ? ST.bowlHome : ST.waterHome;
        bowl.x = approach(bowl.x, home[0], 9, dt);
        bowl.y = approach(bowl.y, home[1], 9, dt);
      }
      if (pourer.shown && !pourer.held) {
        const home = mode === 'feed' ? C.feed.sackHome : C.water.jugHome;
        pourer.x = approach(pourer.x, home[0], 7, dt);
        pourer.y = approach(pourer.y, home[1], 7, dt);
      }
    }

    updateParts(dt);
    stepSprings(dt);
  }

  function stepSprings(dt) {
    for (const k in sp) sp[k].step(dt);
  }

  /* ---- FEED ---------------------------------------------------------- */
  function updateFeed(dt) {
    const F = C.feed;
    if (phase === 'place') {
      if (phaseT > 4 && !bowl.held) setHint('Slide her bowl over — drag it to the ring');
      return;
    }
    if (phase === 'pour') {
      /* HOLD THE SACK OVER THE BOWL. Tipping is the drag itself: hold it
         above the bowl and it tips and pours. */
      const overX = Math.abs(pourer.x - bowl.x) < F.pourWidth;
      const above = pourer.y < bowl.y - 10;
      const pouring = pourer.held && overX && above && fill < 1;
      pourer.over = approach(pourer.over, pouring ? 1 : 0, 10, dt);
      sp.tip.to(pouring ? 1 : 0);
      if (pouring) {
        const add = F.pourRate * dt;
        fill = clamp(fill + add, 0, 1);
        served += add;
        sp.fill.to(fill);
        /* falling kibble */
        if (rng.chance(dt * 26)) {
          const px = pourer.x + rng.range(-7, 7) + 16;
          pp(K_KIBBLE, px, pourer.y + 16, rng.range(-14, 14), rng.range(20, 70),
            rng.range(3.4, 5.0), 1.4, { land: bowl.y - 10 });
        }
        if (rng.chance(dt * 5)) sound('kibble-pour');
      }
      sp.fill.to(fill);
      /* she'll start eating on her own once there's enough in there and the
         pouring has stopped — the dog decides, which is worth a lot */
      const enough = fill > Math.min(0.9, game.appetite() * 0.55);
      if (enough && !pourer.held) {
        if (phaseT > 0.1) {
          goPhase('approach');
          pourer.shown = false;
          setHint('');
        }
      } else if (fill >= 1 && !pourer.held) {
        goPhase('approach');
        pourer.shown = false;
      }
      return;
    }
    if (phase === 'approach') {
      /* the beat where she commits: looks at the bowl, ears forward, then down */
      if (phaseT > 0.85) {
        goPhase('eat');
        biteIn = 0.18;
        /* PORTION SIZE IS DECIDED BY HOW HUNGRY SHE IS *NOW* (research §4): a
           famished dog clears the bowl, a full one has a couple of mouthfuls
           and wanders off. Sampling it once matters — recomputing it as she
           eats makes the appetite chase itself down and she stops half-fed. */
        appetite = game.appetite();
        sound('eat-start');
      }
      return;
    }
    if (phase === 'eat') {
      biteIn -= dt;
      if (biteIn <= 0) {
        biteIn = rng.span(F.biteEvery);
        bites++;
        sp.eat.set(0); sp.eat.kick(11);
        /* one bite: bowl down, hunger up. THE TAIL RISES AS IT FILLS. */
        const eat = Math.min(fill, F.bitePerBowl);
        fill = clamp(fill - eat, 0, 1);
        sp.fill.to(fill);
        game.fillNeed('feed', eat * F.needPerBowl);
        game.addMood(eat * 0.5);
        sound('crunch');
        /* the odd piece flicks out of the bowl */
        if (rng.chance(0.30)) {
          pp(K_KIBBLE, bowl.x + rng.range(-16, 16), bowl.y - 12,
            rng.range(-40, 40), rng.range(-70, -30), rng.range(3.0, 4.4), 1.3,
            { land: bowl.y + 12 });
        }
      }
      const full = game.dog.needs.hunger >= 0.995;
      const appetiteDone = served > 0 && (1 - fill / Math.max(0.01, served)) >= appetite;
      if (fill <= 0.003 || full || appetiteDone) { goPhase('lick'); sound('lick'); }
      return;
    }
    if (phase === 'lick') {
      if (phaseT > C.feed.lickBowl) {
        finish(game.dog.needs.hunger > 0.85
          ? (game.isNamed ? game.dog.name + ' is full' : 'She is full')
          : 'That helped');
      }
      return;
    }
    if (phase === 'finish' && phaseT > C.finishHold) stop();
  }

  /* ---- WATER --------------------------------------------------------- */
  function updateWater(dt) {
    const W = C.water;
    if (phase === 'place') {
      if (phaseT > 4 && !bowl.held) setHint('Slide her water bowl over');
      return;
    }
    if (phase === 'pour') {
      const overX = Math.abs(pourer.x - bowl.x) < W.pourWidth;
      const above = pourer.y < bowl.y - 10;
      const pouring = pourer.held && overX && above && fill < 1;
      pourer.over = approach(pourer.over, pouring ? 1 : 0, 10, dt);
      sp.tip.to(pouring ? 1 : 0);
      if (pouring) {
        fill = clamp(fill + W.pourRate * dt, 0, 1);
        served = Math.max(served, fill);
        ripple = 1;
        if (rng.chance(dt * 40)) {
          pp(K_WATER, pourer.x + 26 + rng.range(-3, 3), pourer.y - 8,
            rng.range(-6, 6), rng.range(60, 130), rng.range(1.8, 3.4), 1.2,
            { land: bowl.y - 10 });
        }
        if (rng.chance(dt * 4)) sound('water-pour');
      }
      sp.fill.to(fill);
      const enough = fill > Math.min(0.9, 0.35);
      if (enough && !pourer.held && phaseT > 0.1) {
        goPhase('approach'); pourer.shown = false; setHint('');
      }
      return;
    }
    if (phase === 'approach') {
      if (phaseT > 0.75) { goPhase('drink'); biteIn = 0.12; sound('lap'); }
      return;
    }
    if (phase === 'drink') {
      biteIn -= dt;
      if (biteIn <= 0) {
        biteIn = rng.span(W.lapEvery);
        bites++;
        sp.lap.set(0); sp.lap.kick(15);
        const sip = Math.min(fill, W.lapPerSip);
        fill = clamp(fill - sip, 0, 1);
        sp.fill.to(fill);
        game.fillNeed('water', sip * W.needPerBowl);
        game.addMood(sip * 0.9);
        ripple = 1;
        /* THE SLOP OF DRINKING — the named foley win */
        sound('lap');
        const n = rng.int(W.dropletsPerLap[0], W.dropletsPerLap[1]);
        for (let i = 0; i < n * partScale; i++) {
          pp(K_WATER, bowl.x + rng.range(-12, 12), bowl.y - 14,
            rng.range(-40, 40), rng.range(-90, -40), rng.range(1.6, 2.8), 0.7,
            { land: bowl.y - 8 });
        }
      }
      const quenched = game.dog.needs.thirst >= 0.995;
      if (fill <= 0.004 || quenched) { goPhase('shakeMuzzle'); }
      return;
    }
    if (phase === 'shakeMuzzle') {
      if (phaseT < 0.05) {
        /* flicks the drips off her muzzle */
        const m = rig.headWorld();
        for (let i = 0; i < Math.round(10 * partScale); i++) {
          const a = rng.range(-Math.PI, 0.2);
          const v = rng.range(70, 180);
          pp(K_DROP, m.x + rng.range(-10, 10), m.y + 22,
            Math.cos(a) * v, Math.sin(a) * v, rng.range(1.8, 3.2), rng.range(0.4, 0.8));
        }
        sound('shake');
      }
      if (phaseT > 0.9) {
        finish(game.dog.needs.thirst > 0.85
          ? (game.isNamed ? game.dog.name + ' has had a good drink' : 'A good drink')
          : 'Better');
      }
      return;
    }
    if (phase === 'finish' && phaseT > C.finishHold) stop();
  }

  /* ---- WASH ---------------------------------------------------------- */
  function updateWash(dt) {
    const W = C.wash;
    if (phase === 'wet') {
      if (phaseT < 0.06) {
        /* the sluice: water down the whole dog */
        for (let i = 0; i < Math.round(26 * partScale); i++) {
          pp(K_WATER, rig.x + rng.range(-70, 70), rig.y - 300 + rng.range(-40, 40),
            rng.range(-8, 8), rng.range(180, 340), rng.range(1.8, 3.4), rng.range(0.5, 0.9),
            { land: rig.y - 6 });
        }
      }
      if (phaseT > W.wetDur * 0.5 && sp.suds.t < 0.5) {
        sp.suds.to(1);
        /* foam over the whole coat to start with, so there is something to
           work with even where she hasn't scrubbed yet */
        for (let i = 0; i < coat.foam.length; i++) coat.foam[i] = 0.34;
        sound('suds');
      }
      if (phaseT > W.wetDur) {
        goPhase('scrub');
        setHint('Scrub the dirt out — stroke where it is muddy');
      }
      return;
    }
    if (phase === 'scrub') {
      /* foam slowly slides off where she is not working */
      for (let i = 0; i < coat.foam.length; i++) {
        coat.foam[i] = Math.max(0, coat.foam[i] - dt * W.foamFade);
      }
      if (rng.chance(dt * 2.2 * sp.suds.x * partScale)) {
        const rl = regionLocal(rng.int(0, coat.regions.length - 1));
        const v = toV(rl.x, rl.y);
        pp(K_FOAM, v.x + rng.range(-10, 10), v.y, rng.range(-4, 4), rng.range(-9, -2),
          rng.range(2.4, 5.0), rng.range(0.8, 1.6));
      }
      if (coat.dirtMean <= W.rinseAt) {
        if (phaseT > 0.6) { goPhase('rinse'); setHint(''); sound('water-on'); }
      } else if (phaseT > 6 && hintT > 5) {
        setHint('Scrub the dirt out — stroke where it is muddy');
      }
      return;
    }
    if (phase === 'rinse') {
      /* the rinse washes the foam down and off */
      sp.suds.to(Math.max(0, 1 - phaseT / (W.rinseDur * 0.8)));
      for (let i = 0; i < coat.foam.length; i++) {
        coat.foam[i] = Math.max(0, coat.foam[i] - dt * 1.5);
      }
      if (rng.chance(dt * 34 * partScale)) {
        pp(K_WATER, rig.x + rng.range(-64, 64), rig.y - 300 + rng.range(-30, 30),
          rng.range(-6, 6), rng.range(200, 360), rng.range(1.6, 3.0), rng.range(0.4, 0.8),
          { land: rig.y - 6 });
      }
      if (phaseT > W.rinseDur) {
        /* every last speck goes: only the bath reaches "Beautiful" */
        for (let i = 0; i < coat.dirt.length; i++) game.setDirt(i, 0);
        game.syncCleanliness();
        goPhase('shake');
        sound('shake-big');
      }
      return;
    }
    if (phase === 'shake') {
      /* THE PAYOFF: the shake-off, spraying droplets */
      if (phaseT < 0.05) {
        const n = Math.round(W.droplets * partScale);
        const bx = rig.x, by = rig.y - 150;
        for (let i = 0; i < n; i++) {
          const a = rng.range(0, TAU);
          const v = rng.span(W.dropletSpeed);
          pp(K_DROP, bx + rng.range(-40, 40), by + rng.range(-90, 90),
            Math.cos(a) * v, Math.sin(a) * v * 0.7 - 40,
            rng.range(1.8, 3.6), rng.span(W.dropletLife));
        }
        if (idle) idle.cancel(2.6);
      }
      /* a second, smaller spray on the rebound reads as a real shake */
      if (phaseT > 0.55 && phaseT < 0.60) {
        for (let i = 0; i < Math.round(W.droplets * 0.45 * partScale); i++) {
          const a = rng.range(0, TAU);
          const v = rng.span(W.dropletSpeed) * 0.7;
          pp(K_DROP, rig.x + rng.range(-34, 34), rig.y - 170 + rng.range(-70, 70),
            Math.cos(a) * v, Math.sin(a) * v * 0.7 - 30,
            rng.range(1.6, 3.0), rng.span(W.dropletLife) * 0.8);
        }
      }
      sp.wet.to(Math.max(0, 1 - (phaseT - 0.4) / W.wetFade));
      if (phaseT > W.shakeDur) {
        game.addGloss(0.42);
        for (let i = 0; i < Math.round(10 * partScale); i++) {
          spawn('spark', rig.x + rng.range(-52, 52), rig.y - 190 + rng.range(-90, 60));
        }
        finish(game.isNamed ? game.dog.name + ' is beautiful' : 'Beautiful');
      }
      return;
    }
    if (phase === 'finish') {
      sp.wet.to(0);
      if (phaseT > C.finishHold) stop();
    }
  }

  /* ---- BRUSH --------------------------------------------------------- */
  function updateBrush(dt) {
    const B = C.brush;
    sp.gloss.to(game.gloss);
    /* tufts settle into a little pile on the floor */
    if (phase === 'brush') {
      if (game.gloss >= B.doneAt) {
        goPhase('gleam');
        setHint('');
      } else if (phaseT > 26) {
        goPhase('gleam');
      }
      return;
    }
    if (phase === 'gleam') {
      if (phaseT < 0.06) {
        if (idle) idle.play('stretch');
        for (let i = 0; i < Math.round(12 * partScale); i++) {
          spawn('spark', rig.x + rng.range(-58, 58), rig.y - 200 + rng.range(-100, 70));
        }
      }
      if (phaseT > 1.5) {
        finish(game.gloss > 0.9
          ? (game.isNamed ? game.dog.name + ' gleams' : 'She gleams')
          : 'Coat looking better');
      }
      return;
    }
    if (phase === 'finish' && phaseT > C.finishHold) stop();
  }

  /* ---- particles ----------------------------------------------------- */
  function updateParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt;
      if (p.life >= p.dur) {
        /* a tuft that ran out of life has landed */
        if (p.k === K_TUFT && pile.length < C.brush.tuftPile) {
          pile.push({ x: p.x, y: Math.min(p.y, BALANCE.view.H - 26), s: p.s, rot: p.rot });
        }
        parts.splice(i, 1);
        continue;
      }
      if (p.k === K_KIBBLE) {
        p.vy += 620 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.land !== undefined && p.y >= p.land && p.vy > 0) {
          p.y = p.land; p.vy *= -0.32; p.vx *= 0.5;
          if (Math.abs(p.vy) < 26) { p.life = p.dur - 0.12; p.vy = 0; }
        }
        p.rot += p.rv * dt;
      } else if (p.k === K_WATER) {
        p.vy += 520 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.land !== undefined && p.y >= p.land) { p.life = p.dur; }
      } else if (p.k === K_DROP) {
        p.vy += 460 * dt;
        p.vx *= 1 - dt * 1.1;
        p.x += p.vx * dt; p.y += p.vy * dt;
      } else if (p.k === K_FOAM) {
        p.x += (p.vx + Math.sin(p.ph + p.life * 4.2) * 9) * dt;
        p.y += p.vy * dt;
        p.vy *= 1 - dt * 0.6;
      } else if (p.k === K_TUFT) {
        p.vy += 90 * dt;
        p.vy = Math.min(p.vy, 44);
        p.x += (p.vx + Math.sin(p.ph + p.life * 2.1) * 11) * dt;
        p.y += p.vy * dt;
        p.rot += p.rv * 0.25 * dt;
      } else if (p.k === K_SPARK) {
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vy += 30 * dt;
      }
    }
  }

  /* ================================================================== */
  /*  apply — rig TARGETS only. Runs AFTER pet.apply (see the header).   */
  /* ================================================================== */
  function apply(dt, mood) {
    const w = sp.care.x;
    rig.drive.neck = 0;
    if (w < 0.002) return;

    if (mode === 'feed' || mode === 'water') applyBowl(dt, w);
    else if (mode === 'wash') applyWash(dt, w);
    else if (mode === 'brush') applyBrush(dt, w);
  }

  /** blend a spring target toward `v` by weight `k`, targets only */
  function bias(spring, v, k) { spring.to(spring.t * (1 - k) + v * k); }

  function applyBowl(dt, w) {
    const cfg = mode === 'feed' ? C.feed : C.water;
    const eating = phase === 'eat' || phase === 'lick' || phase === 'drink';
    const approaching = phase === 'approach';

    if (phase === 'place' || phase === 'pour') {
      /* SHE WATCHES THE PROP MOVE. This is most of why dragging a bowl feels
         physical rather than like operating a menu. */
      if (C.gazeFollow) {
        const px = pourer.shown && pourer.held ? pourer.x : bowl.x;
        const py = pourer.shown && pourer.held ? pourer.y : bowl.y;
        rig.lookAtVirtual(px, py);
      }
      const keen = clamp(1 - game.dog.needs[N.fills[mode].key], 0, 1);
      bias(s.perk, 0.30 + keen * 0.45, w);
      bias(s.earBack, -0.18 * keen, w);
      bias(s.eyeOpen, 1.06 + keen * 0.10, w);
      bias(s.wagAmp, 0.20 + keen * 0.42 + sp.fill.x * 0.25, w);
      bias(s.wagSpd, 2.4 + keen * 5.5 + sp.fill.x * 4.0, w);
      bias(s.tailUp, 0.16 + keen * 0.30, w);
      if (keen > 0.4) bias(s.mouth, 0.10 + 0.06 * Math.sin(t * 8.0), w * 0.7);
      return;
    }

    if (approaching) {
      /* commits: head forward and down, ears pinned forward */
      const u = smooth(phaseT / 0.85);
      rig.lookAtVirtual(bowl.x, bowl.y);
      bias(s.perk, 0.5 * (1 - u), w);
      bias(s.sit, 0, w);
      bias(s.headLift, -(u * C.headDown * 0.55), w);
      s.pitch.to(s.pitch.t * (1 - w * u) + C.headPitch * 0.85 * w * u);
      bias(s.earBack, 0.30 * u, w);
      bias(s.eyeOpen, 1 - 0.30 * u, w);
      bias(s.squash, 0.05 * u, w);
      rig.drive.neck = u * w * 0.6;
      return;
    }

    if (eating) {
      const drink = mode === 'water';
      const bite = clamp((drink ? sp.lap.x : sp.eat.x) * 0.11, 0, 1.4);
      /* HEAD DOWN INTO THE BOWL. The rig has no drawn neck, so
         rig.drive.neck asks dog/draw.js to bridge the gap — without it the
         head reads as having slid down over the chest. */
      const down = C.headDown + bite * cfg.bobDepth;
      bias(s.headLift, -down, w);
      s.pitch.to(s.pitch.t * (1 - w) + C.headPitch * w);
      bias(s.sit, 0, w);
      bias(s.squash, 0.10 + bite * 0.05, w);
      bias(s.lift, -3, w);
      bias(s.earBack, 0.34 + bite * 0.22, w);
      /* Half-lidded, not shut. Squeezing the eyes below ~0.6 makes the pale
         brow markings above them read AS the eyes, which is very strange. */
      bias(s.eyeOpen, 0.80 - bite * 0.10, w);
      bias(s.eyeSmile, 0.34, w);
      bias(s.perk, 0, w);
      rig.drive.neck = w;
      /* the yaw wanders a little, as a nose in a bowl does */
      s.yaw.to(s.yaw.t * (1 - w * 0.6) + Math.sin(t * 1.7) * 0.10 * w);

      if (drink) {
        /* LAPPING: the tongue does the work, fast */
        bias(s.mouth, 0.16 + bite * 0.20, w);
        bias(s.tongue, clamp(0.35 + bite * 0.75, 0, 1.3), w);
        bias(s.noseTw, Math.sin(t * 22) * 0.25, w);
      } else {
        /* CHEWING: slower, with the jaw working */
        bias(s.mouth, 0.14 + Math.abs(Math.sin(t * 9.5)) * 0.22 + bite * 0.20, w);
        bias(s.tongue, 0.18 + bite * 0.30, w);
        bias(s.noseTw, Math.sin(t * 13) * 0.35, w);
      }

      /* THE TAIL RISES AS THE NEED FILLS — the whole point of the beat */
      const filled = clamp(game.dog.needs[N.fills[mode].key], 0, 1);
      const rise = clamp((filled - cfg.tailFrom) / (1 - cfg.tailFrom), 0, 1);
      bias(s.tailUp, 0.12 + rise * 0.78, w);
      bias(s.wagAmp, 0.14 + rise * 0.52, w);
      bias(s.wagSpd, 2.2 + rise * 9.5, w);

      if (phase === 'lick') {
        /* licks the bowl clean: faster, shallower bobs, tongue right out */
        const lick = 0.5 + 0.5 * Math.sin(phaseT * 17);
        bias(s.headLift, -(C.headDown - 4 + lick * 6), w);
        bias(s.tongue, 1.15, w);
        bias(s.mouth, 0.30 + lick * 0.16, w);
        bias(s.eyeSmile, 0.5, w);
      }
      return;
    }

    if (phase === 'shakeMuzzle') {
      const u = clamp(phaseT / 0.9, 0, 1);
      const env = Math.exp(-u * 2.6);
      const f = Math.sin(u * TAU * 5.4);
      bias(s.headLift, -40 * (1 - u), w);
      s.pitch.to(s.pitch.t * (1 - w) + (-0.3 + u * 0.5) * w);
      bias(s.tilt, f * 0.24 * env * rig.mo.shake, w);
      bias(s.noseTw, f * 0.9 * env, w);
      bias(s.mouth, 0.14 * env, w);
      bias(s.earBack, 0.4 * env, w);
      s.earL.kick(f * dt * 120 * env);
      s.earR.kick(-f * dt * 104 * env);
      rig.drive.neck = w * (1 - u) * 0.5;
      return;
    }

    if (phase === 'finish') {
      /* head comes up and she looks straight at her: the thank-you */
      const u = smooth(clamp(phaseT / 0.7, 0, 1));
      rig.lookAtVirtual(195, 990);
      bias(s.headLift, -C.headDown * 0.8 * (1 - u), w);
      s.pitch.to(s.pitch.t * (1 - w * u) + 0.12 * w * u);
      bias(s.eyeSmile, 0.7 * u, w);
      bias(s.smile, 0.8 * u, w);
      bias(s.tongue, 0.5 * (1 - u * 0.4), w);
      bias(s.mouth, 0.20 + 0.10 * Math.sin(t * 10), w);
      bias(s.perk, 0.42 * u, w);
      bias(s.wagAmp, 0.60, w);
      bias(s.wagSpd, 11, w);
      bias(s.tailUp, 0.62, w);
      rig.drive.neck = w * (1 - u);
    }
  }

  function applyWash(dt, w) {
    const W = C.wash;
    const wet = sp.wet.x;
    if (phase === 'wet' || phase === 'rinse') {
      /* being sluiced: eyes shut, ears flat, head tucked, a shiver */
      const u = phase === 'wet' ? clamp(phaseT / W.wetDur, 0, 1) : clamp(phaseT / W.rinseDur, 0, 1);
      const env = plateau(u, 0.18, 0.30);
      bias(s.eyeOpen, 0.10, w * env);
      bias(s.earBack, 0.85, w * env);
      bias(s.headLift, -9, w * env);
      s.pitch.to(s.pitch.t * (1 - w * env) + (-0.18) * w * env);
      bias(s.squash, 0.06, w * env);
      bias(s.sit, 0.34, w * env);
      bias(s.wagAmp, 0.06, w * env);
      bias(s.wagSpd, 1.4, w * env);
      bias(s.mouth, 0.05, w * env);
      if (phase === 'wet' && phaseT < 0.12) rig.shiver();
      return;
    }
    if (phase === 'scrub') {
      /* she mostly enjoys it — the petting overlay is doing the real work
         here, so care only adds the wet-dog notes on top */
      bias(s.earBack, 0.42 * wet, w);
      bias(s.eyeOpen, 1 - 0.20 * wet, w * 0.6);
      bias(s.sit, 0.22, w * 0.5);
      return;
    }
    if (phase === 'shake') {
      /* THE PAYOFF ANIMATION. Bigger and longer than the idle shakeOff, and
         it drives the droplet spray in update(). */
      const u = clamp(phaseT / W.shakeDur, 0, 1);
      const shake = rig.mo.shake;
      const env = Math.exp(-u * 1.9) * (1 - smooth(Math.max(0, (u - 0.80) / 0.20)));
      const f = Math.sin(u * TAU * 7.4);
      const f2 = Math.sin(u * TAU * 5.1 + 1.1);
      bias(s.tilt, f * 0.40 * env * shake, w);
      bias(s.roll, -f * 0.14 * env * shake, w);
      bias(s.sway, f * 6.4 * env * shake, w);
      bias(s.squash, 0.05 + f2 * 0.05 * env, w);
      bias(s.eyeOpen, 0.20, w * env);
      bias(s.earBack, 0.70, w * env);
      bias(s.wagAmp, 0.30 + 0.30 * env, w);
      bias(s.wagSpd, 6 + 8 * env, w);
      bias(s.mouth, 0.12 * env, w);
      s.earL.kick(f * dt * 190 * env);
      s.earR.kick(-f * dt * 168 * env);
      rig.drive.wiggle = Math.max(rig.drive.wiggle, env * 0.7);
      if (u > 0.80) {
        /* and then the proud look */
        const d = smooth((u - 0.80) / 0.20);
        rig.lookAtVirtual(195, 985);
        bias(s.eyeSmile, 0.75 * d, w);
        bias(s.smile, 0.85 * d, w);
        bias(s.perk, 0.55 * d, w);
        bias(s.eyeOpen, 0.20 + 0.9 * d, w);
      }
      return;
    }
    if (phase === 'finish') {
      rig.lookAtVirtual(195, 985);
      bias(s.eyeSmile, 0.7, w);
      bias(s.smile, 0.85, w);
      bias(s.perk, 0.5, w);
      bias(s.wagAmp, 0.55, w);
      bias(s.wagSpd, 10, w);
      bias(s.tailUp, 0.6, w);
    }
  }

  function applyBrush(dt, w) {
    const B = C.brush;
    const fl = clamp(sp.flinch.x * 0.11, 0, 1);
    if (phase === 'brush') {
      /* stroking WITH the grain is bliss: she settles and half-closes her
         eyes. Against it, the flinch spring pulls her away from the brush. */
      const good = clamp(brush.good / 70, 0, 1);
      bias(s.melt, good * 0.55, w * 0.8);
      bias(s.eyeOpen, 1 - good * 0.42 + fl * 0.30, w * 0.7);
      bias(s.eyeSmile, good * 0.55 - fl * 0.5, w * 0.7);
      bias(s.earBack, good * 0.45 + fl * 0.5, w * 0.7);
      bias(s.sit, 0.30, w * 0.4);
      bias(s.tailUp, 0.20 + good * 0.35, w * 0.6);
      bias(s.wagAmp, 0.18 + good * 0.30, w * 0.6);
      if (fl > 0.02) {
        /* pull the head away from the brush — the same shape as a bad spot */
        const awayX = clamp((rig.pose.headX - (brush.x - rig.x) / rig.s) / 50, -1.2, 1.2);
        s.yaw.to(clamp(s.yaw.t * (1 - fl) + awayX * 0.9 * fl, -1.3, 1.3));
        s.pitch.to(clamp(s.pitch.t * (1 - fl * 0.6) - 0.26 * fl, -1, 1));
        bias(s.headLift, s.headLift.t + fl * 6, 1);
        bias(s.squash, 0.04 * fl, 1);
      }
      return;
    }
    if (phase === 'gleam' || phase === 'finish') {
      rig.lookAtVirtual(195, 985);
      bias(s.eyeSmile, 0.72, w);
      bias(s.smile, 0.82, w);
      bias(s.perk, 0.5, w);
      bias(s.tailUp, 0.55, w);
      bias(s.wagAmp, 0.5, w);
      bias(s.wagSpd, 9, w);
    }
  }

  /* ================================================================== */
  /*  drawing                                                           */
  /* ================================================================== */
  /** props + particles that belong IN FRONT of the dog (bowls, kibble) */
  function drawFront(g) {
    const c = g.ctx;
    const w = sp.care.x;

    /* the brushed-out fur pile persists on the floor while brushing */
    if (pile.length) {
      c.save();
      for (const q of pile) {
        c.globalAlpha = 0.55;
        c.fillStyle = rgba(rig.pal.coatHi, 0.75);
        ell(c, q.x, q.y, q.s * 1.5, q.s * 0.72, q.rot); c.fill();
        c.globalAlpha = 0.30;
        c.fillStyle = rgba(rig.pal.coatSh, 0.6);
        ell(c, q.x, q.y + 1.4, q.s * 1.1, q.s * 0.42, q.rot); c.fill();
      }
      c.globalAlpha = 1;
      c.restore();
    }

    if (w > 0.004 && (mode === 'feed' || mode === 'water')) {
      const cfg = mode === 'feed' ? C.feed : C.water;
      c.save();
      c.globalAlpha = clamp(w, 0, 1);
      /* the drop ring, while there is still something to place */
      if (!bowl.placed) {
        const d = Math.hypot(bowl.x - ST.bowlTarget[0], (bowl.y - ST.bowlTarget[1]) * 1.5);
        const hot = clamp(1 - d / (ST.snap * 2.4), 0, 1);
        drawDropRing(c, ST.bowlTarget[0], ST.bowlTarget[1] + 8, ST.targetR, t, hot, w);
      }
      /* The bowl. It grows a little once placed: it is nearer the camera down
         there, and a bigger rim occludes more of her muzzle when she eats. */
      const lift = bowl.held ? 5 : 0;
      const base = bowl.placed ? ST.placedScale : ST.bowlScale;
      const bs = base * (1 + sp.prop.x * 0.012) * (bowl.held ? 1.05 : 1);
      drawBowl(c, bowl.x, bowl.y - lift, bs, bowl.kind, sp.fill.x, t, ripple);
      c.restore();
    }

    drawParts(c);

    if (w > 0.004 && (mode === 'feed' || mode === 'water')) {
      c.save();
      c.globalAlpha = clamp(w, 0, 1);
      if (pourer.shown) {
        const tip = sp.tip.x;
        if (mode === 'feed') drawSack(c, pourer.x, pourer.y, 1.0, tip);
        else drawJug(c, pourer.x, pourer.y, 1.0, tip);
        /* the stream, while it is actually pouring */
        if (pourer.over > 0.05) {
          const sx = pourer.x + (mode === 'feed' ? 14 : 27);
          const sy = pourer.y + (mode === 'feed' ? 14 : -8);
          c.globalAlpha = w * pourer.over * 0.9;
          if (mode === 'water') {
            const grad = c.createLinearGradient(sx, sy, sx, bowl.y - 10);
            grad.addColorStop(0, 'rgba(195,228,234,0.95)');
            grad.addColorStop(1, 'rgba(143,196,206,0.35)');
            c.strokeStyle = grad;
            c.lineWidth = 3.4 + Math.sin(t * 22) * 0.7;
            c.beginPath();
            c.moveTo(sx, sy);
            c.quadraticCurveTo(sx + 2, (sy + bowl.y) / 2, bowl.x + 1, bowl.y - 12);
            c.stroke();
          }
        }
        c.globalAlpha = clamp(w, 0, 1);
        if (!pourer.held && phase === 'pour') {
          drawDropRing(c, bowl.x, bowl.y - 62, 22, t * 1.4, 0, w * 0.6);
        }
      }
      c.restore();
    }

    /* the brush follows her finger */
    if (w > 0.004 && mode === 'brush' && (brush.down || brush.press > 0.02)) {
      c.save();
      c.globalAlpha = clamp(w * (0.35 + brush.press * 0.65), 0, 1);
      drawBrush(c, brush.x, brush.y + 10, 1.0, sp.brushA.x, brush.press);
      c.restore();
    }
    /* the soap bottle sits by her while she is being washed */
    if (w > 0.004 && mode === 'wash') {
      c.save();
      c.globalAlpha = clamp(w, 0, 1) * 0.95;
      drawSoap(c, 44, 764, 1.0, sp.suds.x * 0.4);
      c.restore();
    }
  }

  function drawParts(c) {
    if (!parts.length) return;
    c.save();
    for (const p of parts) {
      const u = p.life / p.dur;
      if (p.k === K_KIBBLE) {
        c.globalAlpha = u > 0.85 ? 1 - (u - 0.85) / 0.15 : 1;
        c.fillStyle = PC.kibble;
        ell(c, p.x, p.y, p.s, p.s * 0.78, p.rot); c.fill();
        c.fillStyle = PC.kibbleL;
        ell(c, p.x - 1, p.y - 1.2, p.s * 0.36, p.s * 0.26, 0); c.fill();
      } else if (p.k === K_WATER) {
        c.globalAlpha = 0.85 * (1 - u * 0.35);
        c.fillStyle = '#b6dee6';
        ell(c, p.x, p.y, p.s * 0.72, p.s * 1.7, 0); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.75)';
        ell(c, p.x - p.s * 0.2, p.y - p.s * 0.4, p.s * 0.26, p.s * 0.6, 0); c.fill();
      } else if (p.k === K_DROP) {
        const a = u < 0.12 ? u / 0.12 : 1 - Math.max(0, (u - 0.6) / 0.4);
        c.globalAlpha = clamp(a, 0, 1) * 0.92;
        const ang = Math.atan2(p.vy, p.vx);
        c.save(); c.translate(p.x, p.y); c.rotate(ang);
        c.fillStyle = '#cfe9ee';
        ell(c, 0, 0, p.s * 2.0, p.s * 0.78, 0); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.85)';
        ell(c, p.s * 0.4, -p.s * 0.16, p.s * 0.7, p.s * 0.3, 0); c.fill();
        c.restore();
      } else if (p.k === K_FOAM) {
        const a = u < 0.18 ? smooth(u / 0.18) : 1 - smooth((u - 0.18) / 0.82);
        c.globalAlpha = a * 0.9;
        c.fillStyle = PC.foam;
        ell(c, p.x, p.y, p.s, p.s * 0.94); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.95)';
        ell(c, p.x - p.s * 0.30, p.y - p.s * 0.34, p.s * 0.30, p.s * 0.26); c.fill();
        c.strokeStyle = 'rgba(190,225,232,0.55)'; c.lineWidth = 0.8;
        ell(c, p.x, p.y, p.s, p.s * 0.94); c.stroke();
      } else if (p.k === K_TUFT) {
        c.globalAlpha = (u < 0.1 ? u / 0.1 : 1) * 0.75;
        c.fillStyle = rgba(rig.pal.coatHi, 0.85);
        ell(c, p.x, p.y, p.s * 1.4, p.s * 0.66, p.rot); c.fill();
        c.fillStyle = rgba(rig.pal.coat, 0.5);
        ell(c, p.x, p.y, p.s * 0.8, p.s * 0.34, p.rot); c.fill();
      } else if (p.k === K_SPARK) {
        const a = hump(u);
        c.globalAlpha = a;
        c.fillStyle = '#fff6d2';
        const q = p.s * (0.6 + a * 0.7);
        c.beginPath();
        c.moveTo(p.x, p.y - q);
        c.quadraticCurveTo(p.x + q * 0.18, p.y - q * 0.18, p.x + q, p.y);
        c.quadraticCurveTo(p.x + q * 0.18, p.y + q * 0.18, p.x, p.y + q);
        c.quadraticCurveTo(p.x - q * 0.18, p.y + q * 0.18, p.x - q, p.y);
        c.quadraticCurveTo(p.x - q * 0.18, p.y - q * 0.18, p.x, p.y - q);
        c.closePath(); c.fill();
      }
    }
    c.globalAlpha = 1;
    c.restore();
  }

  /** the water sheet, the leave affordance, and the one-line hint */
  function drawOver(g) {
    const w = sp.care.x;
    if (w < 0.004) return;
    const c = g.ctx;
    const VW = BALANCE.view.W, VH = BALANCE.view.H;

    /* the sluice: a soft vertical sheet over the dog while she is rinsed */
    const sheet = (mode === 'wash' && (phase === 'wet' || phase === 'rinse'))
      ? plateau(clamp(phaseT / (phase === 'wet' ? C.wash.wetDur : C.wash.rinseDur), 0, 1), 0.2, 0.3) : 0;
    if (sheet > 0.01) {
      c.save();
      c.globalAlpha = sheet * 0.30;
      const gr = c.createLinearGradient(0, 120, 0, VH);
      gr.addColorStop(0, 'rgba(214,240,246,0.85)');
      gr.addColorStop(0.5, 'rgba(180,222,232,0.35)');
      gr.addColorStop(1, 'rgba(180,222,232,0)');
      c.fillStyle = gr;
      c.fillRect(rig.x - 96, 120, 192, VH - 120);
      c.globalAlpha = sheet * 0.5;
      c.strokeStyle = 'rgba(255,255,255,0.5)';
      c.lineWidth = 1.2;
      for (let i = 0; i < 9; i++) {
        const x = rig.x - 80 + i * 20 + Math.sin(t * 6 + i) * 3;
        c.beginPath(); c.moveTo(x, 130); c.lineTo(x - 5, VH - 90); c.stroke();
      }
      c.restore();
    }

    /* leave affordance — she must always be able to walk away from a chore */
    c.save();
    c.globalAlpha = clamp(w, 0, 1) * 0.62;
    c.fillStyle = '#fff8ea';
    c.beginPath(); c.arc(342, 62, 17, 0, TAU); c.fill();
    c.globalAlpha = clamp(w, 0, 1) * 0.8;
    c.strokeStyle = '#7c4a2f'; c.lineWidth = 2.0; c.lineCap = 'round';
    c.beginPath();
    c.moveTo(336, 56); c.lineTo(348, 68);
    c.moveTo(348, 56); c.lineTo(336, 68);
    c.stroke();
    c.restore();

    /* the hint: one quiet line, never a checklist */
    if (hint) {
      c.save();
      const a = clamp(w, 0, 1) * clamp(hintT / 0.5, 0, 1) * 0.82;
      c.globalAlpha = a;
      c.fillStyle = '#fff0d4';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = '500 12.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      c.shadowColor = 'rgba(48,24,12,0.65)'; c.shadowBlur = 6; c.shadowOffsetY = 1;
      c.fillText(hint, VW / 2, BALANCE.ui.care.hintY);
      c.restore();
    }
  }

  /* ================================================================== */
  const care = {
    get active() { return !!mode || sp.care.x > 0.01; },
    get mode() { return mode; },
    get phase() { return phase; },
    get hint() { return hint; },
    get coat() { return coat; },
    get weight() { return sp.care.x; },
    get bowl() { return bowl; },
    get fill() { return fill; },
    /** true while the action owns the whole surface (no nav, no petting UI) */
    get modal() { return !!mode; },
    start, stop, update, apply, pointer, drawFront, drawOver,
    /** activity soils the coat — dirt never comes from the clock alone */
    soil(amount) { game.soil(amount, rng); },
    resetStroke() { lastL = null; },
    get debug() {
      return {
        mode, phase, phaseT: +phaseT.toFixed(2), fill: +fill.toFixed(3),
        served: +served.toFixed(3), bites,
        dirt: coat.dirt.map((d) => +d.toFixed(3)),
        dirtMean: +coat.dirtMean.toFixed(3),
        foam: coat.foam.map((f) => +f.toFixed(2)),
        gloss: +game.gloss.toFixed(3),
        wet: +sp.wet.x.toFixed(3), suds: +sp.suds.x.toFixed(3),
        w: +sp.care.x.toFixed(3), parts: parts.length, pile: pile.length,
        brushGood: Math.round(brush.good), brushBad: brush.bad,
        placed: bowl.placed, bowlAt: [Math.round(bowl.x), Math.round(bowl.y)],
      };
    },
  };
  return care;
}

export default createCare;
