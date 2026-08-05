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
import { drawText } from '../ui/text.js';
import {
  drawBowl, drawSack, drawJug, drawBrush, drawSoap, drawDropRing, PC,
  BOWL_BASE, BOWL_WELL,
} from '../scenes/props.js';
import { resolveDims, stance, plantedSoleLocal } from './rig.js';

const C = BALANCE.care;
const ST = C.stage;
/* stage 6: the bought care tools live in the economy, not in `care` */
const SHOP = BALANCE.economy.shop;
const N = BALANCE.needs;

/* ---- WHERE A PLACED BOWL ACTUALLY SITS -------------------------------
   SOLVED PER DOG, in `solveBowl()` below, from the rig's own geometry — not
   typed here and not typed in BALANCE either.

   THIS IS THE FIX FOR THE FLOATING BOWL. Stage 7's bowlTarget was a literal,
   [178, 644], with nothing tying it to the rug: it drifted 40 virtual units
   into the air and the only way to find out was to look at it (ARCHITECTURE
   §16.9). A literal cannot be checked against anything, so it cannot be
   wrong in a way that shows up. Now:

     the floor  comes from `rig.stance()` — where his paws actually are
     the y      comes from the floor minus the bowl's own published base
                offset, so the base IS the floor by construction
     the scale  comes from where the stoop actually gets his muzzle to

   and all three change with the breed, which is the point: three breeds are
   landing that differ in muzzle length, ear type and body mass. */

/* particle kinds */
const K_KIBBLE = 0, K_WATER = 1, K_FOAM = 2, K_DROP = 3, K_TUFT = 4, K_SPARK = 5;

/** every mutator in this file goes through here (§11.2: no NaN, ever) */
function num(v, d) { const n = +v; return Number.isFinite(n) ? n : d; }

/* ==========================================================================
   SOLVE THE EATING GEOMETRY FOR ONE DOG — pure, and now the ONLY copy.

   `main.js`'s `solveFor()` (the breed-independence proof) used to hold a second
   hand-copy of this arithmetic so it could run against proportions no rig has.
   Two copies of a solve is two answers, and the whole defect below was two
   definitions of one floor, so it calls this instead.

   THE ORDER MATTERS, and the correction to it is the fix:

     1. THE FLOOR IS THE ROOM'S. `rig.floorV` — one line, derived from where the
        room stands this dog and from his own standing paw.
     2. Decide how far the HEAD may drop: a share of this dog's own
        head-to-belly room, measured in the crouch it is spent in.
     3. Ask where HIS PAWS WILL BE — the PLANTED sole, through the same
        `plantedSoleLocal()` that `rig.update()` resolves. With `pawPlant: 1`
        that is the floor from (1), exactly.
     4. Put the bowl's BASE on that, its FOOD SURFACE at the muzzle, and let
        the SCALE span the two — and say so out loud if the scale had to clamp,
        because a clamped scale means the base is NOT on the floor.

   WHAT WAS WRONG, AND WHY EVERY ASSERTION PASSED ANYWAY. Step 3 did not exist.
   The floor came from the STANDING stance and the bowl's base was then checked
   against that same standing number — self-consistent, and the wrong reference.
   In the eating pose the drawn sole is 23-26 virtual units lower (the sphinx's
   forward splay plus the stoop's lean), so the bowl stood on a floor line
   roughly a paw's height above the paws, and read as held up to his muzzle.
   Measured on all three breeds, `C:\tmp\pp8\floor1.py`:

       breed      bowl base   drawn sole   gap
       shiba        719.78      743.12    +23.34
       cockapoo     720.69      746.89    +26.20
       schnoodle    720.01      745.34    +25.33

   `A_bowlBaseOnFloor` reported PASS at 805/805 frames with a gap of 0.001 the
   whole time. An invariant that compares a number against itself is worse than
   no check at all, because it produces confident numbers (ARCHITECTURE §18.2).
   ========================================================================== */
export function solveEatGeometry(proportions, place, floorVIn) {
  const C2 = BALANCE.care, S = C2.stoop, ST2 = C2.stage;
  const dims = resolveDims({ proportions });
  const homeY = num(place && place.y, BALANCE.rig.place.y);
  const homeS = num(place && place.s, BALANCE.rig.place.scale);
  const posture = { sit: S.sit, down: S.down, squash: S.squash, pitch: C2.headPitch };

  /* 1. the floor, from the room */
  const stand = stance(dims, {});
  const floorV = Number.isFinite(+floorVIn) ? +floorVIn
    : homeY + stand.pawSole * homeS;

  /* 2. the head budget, measured in the pose it is spent in. `rig.headRoom` is
        the standing figure and it flatters: folding into the stoop moves the
        belly and the chin by different amounts and costs ~7 rig units of
        clearance before the head has dropped at all. */
  const crouched = stance(dims, { ...posture, headLift: 0 });
  const room = crouched.bodyBottom - crouched.headBottom;
  const maxDrop = room * num(C2.headMaxShare, 0.82);
  const drop = Math.max(0, Math.min(room * num(C2.headDownShare, 0.77), maxDrop));

  /* where that puts him, before any bite dips him deeper. The forward
     commitment moves the whole animal, so it moves the ruler. */
  const eat = stance(dims, { ...posture, headLift: -drop });
  const eatY = homeY + num(S.fwd, 0);
  const eatS = homeS * (1 + num(S.near, 0));
  const muzHY = num(proportions && proportions.muzzleH, 0) / 2;
  const muzBottomV = eatY + (eat.muzY + muzHY) * eatS;

  /* 3. WHERE HIS PAWS WILL ACTUALLY BE. The planted sole, same expression the
        renderer resolves — so the bowl is placed against the dog that gets
        drawn rather than against a standing one who is not there. */
  const plant = clamp(num(S.pawPlant, 1), 0, 1);
  const soleAuthoredV = eatY + eat.pawSole * eatS;
  const soleEatV = lerp(soleAuthoredV, floorV, plant);
  const soleStandV = homeY + stand.pawSole * homeS;

  /* 4. the bowl stands where his paws stand */
  const wellV = muzBottomV - num(ST2.dipInto, 2);
  const span = BOWL_BASE - BOWL_WELL;
  const range = Array.isArray(ST2.scaleRange) ? ST2.scaleRange : [1.1, 1.95];
  const raw = (soleEatV - wellV) / span;
  const scale = clamp(Number.isFinite(raw) ? raw : range[0], range[0], range[1]);
  /* A CLAMPED SCALE IS A FAILURE, NOT A SAFETY NET — but be exact about WHICH
     failure, because being vague here is how the last one hid.

     The base stays on the floor either way: `targetY` is written as
     `soleEatV - BOWL_BASE * scale`, so `targetY + BOWL_BASE * scale` is
     `soleEatV` whatever `scale` turns out to be. What a clamp breaks is the
     OTHER end — the food surface stops meeting his muzzle. Too small a clamp
     leaves the surface below his nose and he reads as sniffing at a bowl he
     never touches; too large buries his face past `dipInto`.

     Seen, not deduced: rendering with `pawPlant: 0` forces `raw` to 2.30-2.56
     against a 1.95 ceiling, and the crop shows a trough swallowing his paws
     with his nose resting above the rim (`C:\tmp\pp8\shots\cmp-*-p00-*`). So
     this is reported and the gate fails on it rather than clamping in silence
     the way stage 7 did. */
  const scaleClamped = !Number.isFinite(raw) || Math.abs(raw - scale) > 1e-9;

  return {
    room, drop, maxDrop, scale, scaleClamped, rawScale: raw,
    /* the ONE floor, and the sole that has to agree with it */
    floorV: soleEatV,
    roomFloorV: floorV,
    soleStandV, soleEatV, soleAuthoredV, plant,
    /* the base sits ON that floor by construction: this is the only place the
       bowl's y is ever computed, and it cannot be written without the floor
       being in the expression */
    targetY: soleEatV - BOWL_BASE * scale,
    wellV: soleEatV - span * scale,
    muzBottomV,
    predict: {
      bodyBottomV: eatY + eat.bodyBottom * eatS,
      headBottomV: eatY + eat.headBottom * eatS,
      muzBottomV,
      soleV: soleEatV,
    },
  };
}

export function createCare(rig, opts = {}) {
  const game = opts.game;
  /* PRONOUNS COME FROM THE DOG, NOT FROM THE COPY.
     The naming beat already reads game.dog.sex — it asks "What will you call
     HIM?" for a male puppy (see ui/naming.js). Every hint in this file then
     hard-coded "her", so the Schnoodle — who is male, and is the puppy this
     game exists to hand over — was misgendered by the first sentence of the
     first care action, one beat after being named. Same source, same answer. */
  const male = () => !!(game && game.dog && game.dog.sex === 'm');
  const HIS = () => (male() ? 'his' : 'her');
  const HE = () => (male() ? 'He' : 'She');
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

  /* care-owned springs. `stoop` is the eating crouch's own envelope: the
     posture channels it drives are rig springs and smooth themselves, but the
     small forward lean writes rig.y / rig.s, which are final values, so it
     needs a spring of its own or the lean would pop (same reason
     dog/train.js springs its `call` step). */
  const sp = makeSprings(['prop', 'tip', 'fill', 'eat', 'lap', 'suds', 'wet', 'gloss', 'care', 'brushA', 'flinch', 'stoop'], reduced);

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
  /* WHERE THE BOWL IS ACTUALLY DRAWN this frame. Resolved in update() rather
     than inside drawFront so the geometry exists whether or not anyone drew,
     and so `debug` reports the bowl that is on screen instead of the bowl
     BALANCE asked for. The floating bowl survived stage 7 partly because
     those were two different bowls and nothing compared them (§16.9). */
  let bowlDrawY = bowl.y;
  let bowlScaleNow = ST.bowlScale;

  /* ==================================================================
     SOLVE THE EATING GEOMETRY FOR THIS DOG.

     Run once per care action, before the bowl is drawn. Everything it needs
     comes from `rig.stance()` and `rig.headRoom`, so it knows nothing about
     any breed and nothing about the Shiba it happened to be tuned against.

     THE ORDER MATTERS and it is the whole lesson of §16.9:
       1. decide how far the HEAD may drop — a share of this dog's own
          head-to-belly room, so it can never sink into his chest;
       2. ask where that, plus the stoop, actually puts his MUZZLE;
       3. put the bowl's FOOD SURFACE there;
       4. put the bowl's BASE on the floor, and let the SCALE be whatever
          spans the two.
     Stage 7 did it the other way round — it chose a head drop, saw the muzzle
     end up at chest height, and moved the bowl up to meet it. That is how a
     bowl comes to be hanging in mid-air: nothing in the chain ever mentioned
     the floor.
     ================================================================== */
  let geo = null;

  function solveBowl() {
    /* THE ARITHMETIC LIVES ABOVE, AND NOWHERE ELSE. All this does is hand it
       this dog and this room: his proportions, where the room stands him, and
       the room's own floor line — which is `rig.floorV`, the same number
       `rig.update()` plants his paws on. */
    geo = solveEatGeometry(rig.breed.proportions, rig.home, rig.floorV);
    /* write the answers back so BALANCE still tells the truth to anything
       reading it — the drop ring, the snap test and the harness all do
       (documented deviation, ARCHITECTURE §17.5 item 1 / §18.1) */
    ST.placedScale = geo.scale;
    ST.bowlFloorY = geo.floorV;
    ST.bowlTarget[1] = geo.targetY;
    return geo;
  }
  /** the solved head drop, in rig units. Falls back to a solve if asked early. */
  function headDrop() { return (geo || solveBowl()).drop; }
  /** the hard ceiling on TOTAL head drop, bob included. Never exceeded. */
  function maxHeadDrop() { return (geo || solveBowl()).maxDrop; }

  function resolveBowlDraw() {
    const lift = bowl.held ? 5 : 0;
    const base = bowl.placed ? ST.placedScale : ST.bowlScale;
    bowlScaleNow = base * (1 + sp.prop.x * 0.012) * (bowl.held ? 1.05 : 1);
    bowlDrawY = bowl.y - lift;
  }

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
    sp.stoop.set(0);
    coat.dirt = game.dirt;

    if (kind === 'feed' || kind === 'water') {
      /* SOLVE BEFORE ANYTHING IS PLACED. The drop ring, the snap radius and
         the bowl's resting chase all read ST.bowlTarget, so the answer has to
         exist before the first frame she can drag on. */
      solveBowl();
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
      setHint(kind === 'feed' ? `Slide ${HIS()} bowl over` : `Slide ${HIS()} water bowl over`);
    } else if (kind === 'wash') {
      sp.wet.to(1); sp.suds.set(0);
      for (let i = 0; i < coat.foam.length; i++) coat.foam[i] = 0;
      goPhase('wet');
      setHint('');
      sound('water-on');
    } else if (kind === 'brush') {
      sp.gloss.set(game.gloss);
      goPhase('brush');
      setHint(`Brush the way ${HIS()} coat lies`);
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
    /* stand up on the way out, whatever beat we were interrupted in */
    sp.stoop.to(0);
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
      /* THE OATMEAL SOAP (stage 6): he minds the bath less. Mood only — the
         cleanliness it reaches and the care points it pays are untouched, so a
         player with no coins is not washing him worse. */
      if (mode === 'wash' && game.hasTool && game.hasTool('soapOat')) {
        game.addMood(num(SHOP.soapMood, 0));
      }
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
      /* THE SOFTER BRUSH (stage 6). A bought TOOL is a nicer way to do the
         thing, never a reason to have waited to do it: it multiplies the gloss
         a stroke earns and changes nothing else — not the need it fills, not
         the care points it pays, not the grain she has to follow. */
      game.addGloss(travel * B.glossPerUnit * (0.5 + q * 0.5) * toolMul('brushSoft', SHOP.brushGloss));
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
      setHint(`${HE()} likes it downward, the way it lies`);
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
      resolveBowlDraw();
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
      if (phaseT > 4 && !bowl.held) setHint(`Slide ${HIS()} bowl over — drag it to the ring`);
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
      if (phaseT > 4 && !bowl.held) setHint(`Slide ${HIS()} water bowl over`);
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
    /* A DRIVE, WRITTEN EVERY FRAME, exactly like `drive.neck` above it: only
       the two bowl actions have a prop standing on the floor, so only they
       claim his paws. Everything else in the game keeps stage 7's paws
       untouched, byte for byte.

       THE CONDITION IS drawFront's CONDITION, deliberately and exactly: the
       claim on his paws lasts precisely as long as there is a bowl drawn on the
       floor for them to agree with (`w > 0.004 && feed|water`, see drawFront).
       Holding it any longer would pin his paws for ~0.9s after the bowl has
       gone, which is a pose change with nothing on screen to justify it; ending
       it any sooner puts the bowl back in the air. The new assertion A checks
       the same window, so the gate and the renderer cannot disagree about which
       frames are being claimed (§18.2). */
    rig.plantShare = (mode === 'feed' || mode === 'water')
      ? clamp(num(C.stoop.pawPlant, 1), 0, 1) * clamp(w, 0, 1) : 0;
    if (w < 0.002) {
      /* HAND THE PLACEMENT BACK. `toy.apply` is skipped for the whole of
         `care.active` now, so once the care weight is spent nobody else is
         going to put rig.x/y/s back — and the stoop's forward lean is the
         first thing care has ever moved them with. By here the spring has
         unwound to within a fraction of a unit, so this is a tidy-up rather
         than a jump. */
      if (sp.stoop.x > 0.0001 || rig.y !== rig.home.y || rig.s !== rig.home.s) {
        sp.stoop.set(0);
        rig.y = rig.home.y; rig.s = rig.home.s;
      }
      return;
    }

    if (mode === 'feed' || mode === 'water') applyBowl(dt, w);
    else if (mode === 'wash') applyWash(dt, w);
    else if (mode === 'brush') applyBrush(dt, w);
  }

  /* a bought tool's multiplier, or 1. Guarded: a missing game, a missing
     mutator and a NaN tunable all resolve to "she does not have it", which is
     the safe answer in both directions. */
  function toolMul(id, mul) {
    if (!game || !game.hasTool || !game.hasTool(id)) return 1;
    const m = +mul;
    return Number.isFinite(m) && m > 0 ? m : 1;
  }
  /* `num` is now a module-level helper, shared with `solveEatGeometry` above */

  /** blend a spring target toward `v` by weight `k`, targets only */
  function bias(spring, v, k) { spring.to(spring.t * (1 - k) + v * k); }

  /* ====================================================================
     THE EATING STOOP — the body's half of the reach.

     `k` is 0..1: how far into the crouch he is. Everything here is a TARGET
     (§6) except the forward lean, which is a placement and is lerped from a
     spring so it cannot pop.

     Why the body and not the head: at rest his head's bottom edge is 100
     virtual units above his belly's, so a head-only reach spends its whole
     budget before it gets anywhere near the rug — which is exactly what
     stage 2's 132 units and stage 7's 74 units both did. The torso's bottom
     edge only moves on `sit`, `down`, `melt` and `lift` (rig.update
     compensates `squash` to keep the paws planted), and `down` brings the
     front-paw splay, the leg bow and the hind tuck with it for free.

     THE FORWARD LEAN IS WHY THE toy.apply GUARD MATTERS. `toy.apply` rewrites
     rig.x/y/s back to home on every idle frame and runs after this, so before
     scenes/room.js added `care.active` to its guard, these two lines were
     silently erased every frame — see ARCHITECTURE §16.9.
     ==================================================================== */
  function stoopTo(k, w) {
    const S = C.stoop;
    const kw = clamp(k, 0, 1);
    bias(s.sit, S.sit * kw, w);
    bias(s.down, S.down * kw, w);
    bias(s.squash, S.squash * kw, w);
    /* `lift` raises the body, so the stoop must not fight it */
    bias(s.lift, 0, w);
    sp.stoop.to(kw);
    const lean = sp.stoop.x * w;
    rig.y = lerp(rig.y, rig.home.y + S.fwd, lean);
    rig.s = lerp(rig.s, rig.home.s * (1 + S.near), lean);
  }

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
      /* standing, watching, weight still over all four paws */
      stoopTo(0, w);
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
      /* THE COMMIT, and the order is the whole point: the body goes down
         FIRST and the neck follows it. `u` drives the crouch on a smoothed
         ramp and the head lags it (u^1.6), so what she sees is a dog folding
         its front end down and then reaching, not a head being winched. */
      const u = smooth(clamp(phaseT / 0.85, 0, 1));
      rig.lookAtVirtual(bowl.x, bowl.y);
      stoopTo(u, w);
      bias(s.perk, 0.5 * (1 - u), w);
      const lag = Math.pow(u, 1.6);
      bias(s.headLift, -(lag * headDrop()), w);
      s.pitch.to(s.pitch.t * (1 - w * lag) + C.headPitch * 0.85 * w * lag);
      bias(s.earBack, 0.30 * u, w);
      bias(s.eyeOpen, 1 - 0.30 * u, w);
      rig.drive.neck = lag * w * 0.7;
      return;
    }

    if (eating) {
      const drink = mode === 'water';
      const bite = clamp((drink ? sp.lap.x : sp.eat.x) * 0.11, 0, num(C.bobPeak, 1.4));
      /* HEAD DOWN INTO THE BOWL. The rig has no drawn neck, so
         rig.drive.neck asks dog/draw.js to bridge the gap — without it the
         head reads as having slid down over the chest. */
      stoopTo(1, w);
      /* THE CLAMP THAT MAKES ASSERTION B TRUE ON EVERY FRAME, for any breed
         and any bob: the total never passes this dog's own ceiling. */
      const down = Math.min(headDrop() + bite * cfg.bobDepth, maxHeadDrop());
      bias(s.headLift, -down, w);
      s.pitch.to(s.pitch.t * (1 - w) + C.headPitch * w);
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
        bias(s.headLift, -Math.min(headDrop() - 4 + lick * 6, maxHeadDrop()), w);
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
      /* the drips come off before he gets up, so he is still part-way down */
      stoopTo(lerp(1, C.stoop.rise, smooth(u)), w);
      bias(s.headLift, -headDrop() * 0.85 * (1 - u), w);
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
      /* head comes up, he gets back on all four paws, and he looks straight at
         her: the thank-you. The stoop unwinds a little AHEAD of the head so he
         pushes up off his elbows rather than levitating out of the crouch. */
      const u = smooth(clamp(phaseT / 0.7, 0, 1));
      rig.lookAtVirtual(195, 990);
      stoopTo(1 - Math.min(1, u * 1.25), w);
      bias(s.headLift, -headDrop() * 0.9 * (1 - u), w);
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
      /* The bowl, at the position update() resolved. It grows once placed: it
         is nearer the camera down there, and the taller rim is what occludes
         the lower muzzle when he noses into it. */
      drawBowl(c, bowl.x, bowlDrawY, bowlScaleNow, bowl.kind, sp.fill.x, t, ripple);
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

    /* THE HINT: one quiet line, never a checklist.
       Routed through ui/text.js in stage 5. It was bare cream over whatever the
       room happened to have behind it, with a drop shadow standing in for a
       contrast guarantee — the identical defect to the hud's hint line, and the
       exact failure that helper exists to make impossible. The 0.82 style alpha
       is gone too: the guarantee is defined at full opacity, and the fade-in is
       a transition. */
    if (hint) {
      drawText(g, hint, {
        x: VW / 2, y: BALANCE.ui.care.hintY, anchor: 'top',
        size: 12.5, weight: 600,
        fade: clamp(w, 0, 1) * clamp(hintT / 0.5, 0, 1),
      });
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
        /* THE FLOATING-BOWL NUMBERS, straight from the values that draw it —
           `bowlScaleNow` is the scale actually passed to drawBowl this frame,
           so `bowlBaseY` is where the bowl's underside really is and not where
           BALANCE hoped it would be. Verification reads these (§16.9). */
        bowlScaleNow: +bowlScaleNow.toFixed(4),
        bowlBaseY: +(bowlDrawY + BOWL_BASE * bowlScaleNow).toFixed(2),
        bowlWellY: +(bowlDrawY + BOWL_WELL * bowlScaleNow).toFixed(2),
        bowlFloorY: ST.bowlFloorY,
        stoop: +sp.stoop.x.toFixed(3),
        /* ---- WHAT THE EYE ACTUALLY COMPARES (stage 8) -------------------
           `soleLiveY` is the bottom edge of the paw dog/draw.js is drawing
           THIS FRAME, from the same `pose.pawSole` the renderer uses and now
           including the breed's pawScale. THIS is the floor the bowl has to
           agree with, and asserting against it is the check that would have
           caught the defect the old `bowlFloorY` comparison certified as
           passing 805 frames out of 805 (ARCHITECTURE §18.2). */
        soleLiveY: +(rig.y + rig.pose.pawSole * rig.s
          * (rig.sy === undefined ? 1 : rig.sy)).toFixed(2),
        roomFloorY: +rig.floorV.toFixed(2),
        plantShare: +(+rig.plantShare || 0).toFixed(3),
        /* a clamped scale means no allowed bowl size can both stand on the
           floor and reach his muzzle — i.e. the base is OFF the floor. Loud. */
        scaleClamped: geo ? !!geo.scaleClamped : false,
        rawScale: geo ? +geo.rawScale.toFixed(4) : null,
        /* THE SOLVE, so a harness can check that what rig.stance() predicted
           is what rig.update() actually produced. If those two ever drift the
           bowl is being placed against a dog that does not exist. */
        geo: geo ? {
          headRoom: +geo.room.toFixed(2), headDrop: +geo.drop.toFixed(2),
          maxDrop: +geo.maxDrop.toFixed(2),
          share: +(geo.drop / Math.max(0.001, geo.room)).toFixed(3),
          scale: +geo.scale.toFixed(4), floorV: +geo.floorV.toFixed(2),
          targetY: +geo.targetY.toFixed(2), wellV: +geo.wellV.toFixed(2),
          soleStandV: +geo.soleStandV.toFixed(2), soleEatV: +geo.soleEatV.toFixed(2),
          predictBodyBottomY: +geo.predict.bodyBottomV.toFixed(2),
          predictHeadBottomY: +geo.predict.headBottomV.toFixed(2),
          predictMuzBottomY: +geo.predict.muzBottomV.toFixed(2),
          /* the sole the solve PREDICTED. `G` compares it against the sole
             rig.update() produced, so the bowl can never again be placed
             against a dog who is not the one being drawn. */
          predictSoleY: +geo.predict.soleV.toFixed(2),
          roomFloorV: +geo.roomFloorV.toFixed(2),
          soleAuthoredV: +geo.soleAuthoredV.toFixed(2),
          unplantedSink: +(geo.soleAuthoredV - geo.roomFloorV).toFixed(2),
        } : null,
      };
    },
  };
  return care;
}

export default createCare;
