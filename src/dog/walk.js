/* ==========================================================================
   dog/walk.js — WALKS, REFRAMED. Four beats and not one frame of gait.

   THE CONSTRAINT THAT SHAPED EVERYTHING, AND WHAT BECAME OF IT. This file was
   written against "the rig is NEAR-FRONTAL ONLY; there is no side-profile rig and
   none is being built", and it said that a later stage wanting a gait cycle must
   stop and re-read SCOPE rather than quietly build one. That happened, in that
   order: it was raised, and on 2026-08-20 the answer was yes —

     "Actually I do want a side and back profile of the dogs ... these new views
      would make improve the game a lot"

   There is a profile dog now (`dog/sidesprite.js`, the human's own art, with
   `dog/side.js` as the drawn fallback), and the FIVE-line change it bought this
   file is beat 2.5: he trots out of the room instead of blinking out of it.

   EVERYTHING ELSE STAYED, and deliberately. A walk is still not a side-scroll:

     - the ABSENCE is the point. Watching a dog walk for four minutes is not
       better than missing him for four minutes.
     - the RETURN STAYS FRONTAL. He comes home muddy, and mud is a per-region
       wash on a drawn dog — a painted sheet cannot get dirty. The one beat where
       his state is the whole payload is the one beat that must not be a sprite.

   So a walk is:

     1 PREPARE   the leash comes out and he goes ELECTRIC. This is the payload
                 of the whole feature. It is a frontal animation the existing
                 rig does beautifully, it should be the most joyful thing in
                 the game after the reunion, and most of this file is it.
     2 ROUTE     she picks or draws a route on a hand-drawn map (ui/routemap.js).
                 Different routes bias what comes back. A few real minutes, and
                 ALWAYS endable early.
     3 ABSENCE   the room is empty, and deliberately a little melancholy. She
                 can close the app entirely — iOS suspends JS completely, so
                 progress is a pure function of wall-clock time recomputed on
                 resume (state/walks.js, which also holds the clock-tamper
                 guard). Nothing in this file ticks a walk forward.
     4 RETURN    he comes back MUDDIER, TIREDER, HAPPIER, AND CARRYING
                 SOMETHING. Discovery lives entirely in what he brings home.

   anticipation -> absence -> return. Emotionally stronger than watching a dog
   walk sideways, and a fraction of the art.

   DEPTH IS SCALE ON THIS RIG (ARCHITECTURE §12.6). The return is `rig.s`
   growing from 0.4x with a per-stride `rig.sy` squash — the same trick the
   reunion and the toy chase use, and the reason no new silhouette was needed.

   PIPELINE POSITION. `walk.apply()` runs after `train.apply()`, i.e. in the
   care/train slot, because prepare and return own the body the way a care
   action does. `toy.apply` is skipped while the walk owns her, for the same
   reason stage 3 skips it during a spin. Every layer here writes TARGETS ONLY
   (plus explicit placement writes during the return, exactly as the reunion
   does).

   PLAYER-FACING COPY LIVES IN `COPY` BELOW, AND ONLY THERE — including the
   strings ui/routemap.js draws, which are injected into it. Pronouns come from
   `game.pron` at call time: the gift puppy is a male Schnoodle and a later dog
   may not be, so no string in this file may hardcode one.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { Spring, makeSprings, approach } from '../engine/spring.js';
/* THE PROFILE DOG, for the departure only — see `drawOff` below. The sprite is
   the human's own art and the drawn one is the fallback for a breed with no
   sheet; both take the same arguments, so this file does not care which it has. */
import { createSideSprite, hasSideSprite } from './sidesprite.js';
import { createSideDog } from './side.js';
import { TAU, clamp, lerp, smooth, smoother, hump, easeOut3, easeOutBack, roundRect, ell } from '../engine/draw.js';
import { rng as sharedRng } from '../engine/rng.js';
import { capitalise } from '../state/game.js';
import { blend, dominant, describeRemaining, FIND_BY_ID } from '../state/walks.js';
import { createRouteMap } from '../ui/routemap.js';
import { drawText, drawStack, safeBand, font } from '../ui/text.js';
import { drawLeash, drawCollar, drawFind, drawPawPrint, WC } from '../scenes/props.js';
/* the reachable play area: what he carries home lands inside it, and so does
   the one control this beat has. See ui/reach.js. */
import reach from '../ui/reach.js';

const W = BALANCE.walk;
const P4 = W.prep;
const HM = W.home;
const AW = W.away;
const WK = W;
const VW = BALANCE.view.W;
const VH = BALANCE.view.H;

/* ==========================================================================
   COPY — every player-facing string in stage 4, in one place.
   `P` is game.pron ({they, them, their, is, has, s}), `n` is his name or ''.
   NEVER write a pronoun into a string; interpolate P.
   ========================================================================== */
const COPY = {
  /* ---- beat 1: prepare ---- */
  leashOut: (P) => `The lead is out`,
  clipOn: (P) => `Clip it on ${P.them}`,
  clipOnAgain: (P) => `${capitalise(P.they)} ${P.is} not going to stand still — clip it on`,
  clipped: (P, n) => `${n || capitalise(P.they)} ${P.is} ready`,
  fizzLow: (P) => `${capitalise(P.they)} ${P.has} seen it`,
  fizzMid: (P) => `${capitalise(P.they)} cannot keep ${P.their} feet still`,
  fizzHigh: (P) => `${capitalise(P.they)} ${P.is} beside ${P.self}`,
  tiredOut: (P) => `${capitalise(P.they)} ${P.is} tired, but ${P.they} still want${P.s} to go`,
  notNow: (P) => `Another time then`,

  /* ---- beat 2: the map (injected into ui/routemap.js) ---- */
  mapTitle: () => 'Where shall we go?',
  mapHint: () => 'Tap a place, or draw a route with your finger',
  setOff: () => 'Set off',
  /* beat 2.5: he is walking out. Said while he is still on screen, so the room
     is not claiming he is here (the idle hint's "<name> is here" was showing over
     a dog halfway out of the door). */
  offGo: (P, n) => `Off ${P.they} go${P.s}`,
  routeName: (r) => ({
    park: 'the park', high: 'the high street', river: 'the river', woods: 'the woods',
  }[r] || r),
  /** how long, in words — a walk is never a countdown clock */
  durWords: (sec) => {
    const m = sec / 60;
    if (m < 1.6) return 'a minute or two';
    if (m < 2.6) return 'a couple of minutes';
    if (m < 3.6) return 'about three minutes';
    if (m < 4.6) return 'about four minutes';
    return 'a good long walk';
  },
  mapChoice: (route, mix, dur, drawn) => {
    const names = Object.keys(mix).filter((k) => mix[k] > 0.12);
    const where = names.length > 1
      ? COPY.routeName(route) + ' and beyond'
      : COPY.routeName(route);
    return `${drawn ? 'Your route' : 'Round'} ${drawn ? 'through ' : ''}${where} — ${COPY.durWords(dur)}`;
  },

  /* ---- beat 3: absence ---- */
  awayTitle: (P, n, route) => `${n || capitalise(P.they)} ${P.is} out at ${COPY.routeName(route)}`,
  awayWhen: (P, words) => capitalise(words),
  awayQuiet: () => 'The room is very quiet',
  bringHome: (P) => `Bring ${P.them} home`,
  /* ...and it must never read as a punishment for cutting it short */
  broughtEarly: (P, n) => `${n || capitalise(P.they)} came straight back`,
  awayBusy: (P) => `${capitalise(P.they)} ${P.is} out on a walk`,
  /* she closed the app and he finished while it was shut */
  homeWhileAway: (P, n) => `${n || capitalise(P.they)} ${P.is} back`,

  /* ---- beat 4: return ---- */
  homeMuddy: (P, n) => `${n || capitalise(P.they)} ${P.is} filthy and delighted`,
  homeTired: (P, n) => `${n || capitalise(P.they)} ${P.has} had a lovely time`,
  broughtHome: (P, n, thing) => `${n || capitalise(P.they)} brought ${thing} home`,
  metSomeone: (P, who) => `${capitalise(P.they)} made friends with ${who}`,
  gotCoins: (n) => (n === 1 ? 'A coin in the gutter' : `${n} coins`),
  newToy: (P, thing) => `${thing} — ${P.theirs} now`,
  bathHint: (P) => `${capitalise(P.they)} could do with a bath`,

  /* ---- the finds. Nouns, so `broughtHome` can wrap them. ---- */
  find: {
    daisy: 'a daisy', buttercup: 'a buttercup', bluebell: 'a bluebell',
    stick: 'a very good stick', pinecone: 'a pinecone', tennis: 'a tennis ball',
    squeaky: 'a squeaky duck', pebble: 'a smooth pebble', feather: 'a feather',
    conker: 'a conker', glove: 'somebody’s lost glove', bell: 'a little brass bell',
    ribbon: 'a red ribbon',
    metBeagle: 'a photo of a beagle', metPoodle: 'a photo of a poodle',
    metSpaniel: 'a photo of a spaniel', metLurcher: 'a photo of a lurcher',
  },
  /** the dog he met, for the "made friends with" line */
  met: { beagle: 'a beagle', poodle: 'a poodle', spaniel: 'a spaniel', lurcher: 'a lurcher' },
  findName: (id) => COPY.find[id] || 'something',
  /** the shelf caption, when she taps the collection */
  shelfEmpty: (P) => `Nothing on the shelf yet`,
  shelfSome: (P, k) => `${k} thing${k === 1 ? '' : 's'} ${P.they} brought home`,
};

/* ---- art constants (scene art, not design tunables — §11 G) ------------ */
const C = {
  ink: '#5d3018', card: 'rgba(255,248,234,0.94)', cardLine: 'rgba(124,74,47,0.20)',
  /* OPAQUE, so `over` can be checked exactly. The card stays at 0.94 because
     6% of backdrop cannot move #5d3018-on-cream (9.9:1) below the 4.5 target,
     but a button label has less headroom, so its plate is solid. */
  btn: '#fff8ea',
  gold: '#e9954f', goldD: '#d7823c',
  cool: 'rgba(86,106,142,',
  quiet: 'rgba(34,26,44,',
  hint: 'rgba(255,240,212,0.95)',
};

const bias = (sp, v, k) => sp.to(sp.t * (1 - k) + v * k);

/* ========================================================================== */
export function createWalk(rig, opts = {}) {
  const game = opts.game;
  const pet = opts.pet;
  const idle = opts.idle;
  const rng = opts.rng || sharedRng;
  const reduced = !!opts.reduced;
  const spawn = opts.spawn || (() => {});
  const sound = opts.sound || (() => {});
  const toast = opts.toast || (() => {});
  const busyElsewhere = opts.busyElsewhere || (() => false);
  const s = rig.springs;
  const RM = BALANCE.reducedMotion;
  const motion = reduced ? 0.48 : 1;
  const partScale = reduced ? RM.particleScale : 1;

  const sp = makeSprings(['walkW', 'fizz', 'homeIn', 'carry'], reduced);
  /* the leash's own two position springs — it is a dangled object, so it wants
     the overshoot a critically-damped `approach` would take away */
  const LK = BALANCE.springs.leash;
  const lx = new Spring(P4.rest[0], LK[0] * (reduced ? RM.stiffScale : 1), LK[1] * (reduced ? RM.dampScale : 1));
  const ly = new Spring(P4.from[1], LK[0] * (reduced ? RM.stiffScale : 1), LK[1] * (reduced ? RM.dampScale : 1));

  let beat = '';                 // '' | 'prep' | 'map' | 'home'  ('away' below)
  let away = false;              // he is out. Kept separate: it is a STATE, not a beat.
  /* THE DEPARTURE. `off` counts up while he trots out of frame; the profile dog
     is built lazily on the first walk, because most sessions never take one and a
     sprite sheet is 111KB of decode nobody asked for. */
  let off = -1;
  let sprite = null;             // the human's sheet, if this breed has one
  let drawn = null;              // the drawn profile: fallback, and the Shiba
  let sideKind = '';
  /* WHICH DOG THE DEPARTURE IS USING, decided once when she presses Set off and
     not revisited. Deciding per frame produced a POP: frame 0 was the drawn
     profile because the sheet had not decoded, and frame 1 onward was the sprite.
     One departure, one dog — consistency beats a better second half. */
  let lockedDrawn = false;
  let t = 0;                     // seconds in the current beat
  let clock = 0;                 // monotonic, own
  let hint = '';
  let hintT = 0;

  /* ---- prepare ---- */
  const leash = { x: P4.rest[0], y: P4.from[1], held: false, sway: 0, vx: 0, on: false };
  let fizz = 0;                  // the raw envelope; sp.fizz smooths it
  let hopIn = 0;
  let spinT = 0, spinIn = 0;
  let clipT = -1;                // >=0 once clipped: the snap-and-wiggle hold
  let sinceTouch = 0;
  let bloom = 0;
  let showHint = 0;

  /* ---- return ---- */
  let stride = 0;
  let carried = [];              // the finds he is bringing in
  let dropped = [];              // { id, x, y, life } — on the rug, this session
  let card = null;               // { lines:[], id, life }
  let pantFor = 2.6;
  let homeK = 0;                 // how excited the homecoming is
  let reunionAfter = 0;
  const homeCbs = [];

  /* ---- absence ---- */
  let prog = 0;                  // recomputed from the wall clock, never ticked
  let route = 'park';
  let remainWords = '';

  /* the map overlay. Its copy comes from COPY, so stage 4 has ONE copy table. */
  const map = createRouteMap({
    reduced,
    copy: {
      mapTitle: COPY.mapTitle, mapHint: COPY.mapHint, setOff: COPY.setOff,
      routeName: COPY.routeName, mapChoice: COPY.mapChoice,
    },
    onSetOff: (mix, dur, path) => setOff(mix, dur, path),
    onCancel: () => { map.close(); beat = 'prep'; t = 0; setHint(COPY.clipOn(game.pron)); },
  });

  const Pn = () => game.pron;
  const nm = () => (game.isNamed ? game.dog.name : '');
  function setHint(txt) { if (txt !== hint) { hint = txt; hintT = 0; } }

  /* ================================================================== */
  /*  geometry                                                          */
  /* ================================================================== */
  /** his collar, in VIRTUAL space — where the clip has to land */
  function collarAt() {
    const b = pet.anchor ? pet.anchor('body') : { x: 0, y: -60, hx: 40, hy: 60 };
    const lxr = b.x;
    const lyr = b.y + b.hy * P4.collar.y;
    return {
      x: rig.x + lxr * rig.s * (rig.sx === undefined ? 1 : rig.sx),
      y: rig.y + lyr * rig.s * (rig.sy === undefined ? 1 : rig.sy),
      hw: b.hx * P4.collar.w,
      local: { x: lxr, y: lyr },
    };
  }

  /* ================================================================== */
  /*  BEAT 1 — PREPARE                                                  */
  /* ================================================================== */
  function start() {
    if (away) { toast(COPY.awayBusy(Pn())); return false; }
    if (busyElsewhere()) return false;
    beat = 'prep';
    /* START THE SHEET DECODING NOW. The departure is two beats away — the lead,
       then the map — which is seconds of real time, and it is the difference
       between him walking out and him being absent for the first five frames of
       walking out (which is what the first render showed). */
    ensureSide();
    t = 0;
    fizz = 0;
    sp.fizz.set(0);
    sp.walkW.to(1);
    leash.held = false; leash.on = false; leash.sway = 0; leash.vx = 0;
    /* it swings in from off the top of the frame, so it reads as her having
       taken it off a hook rather than as a UI element appearing */
    lx.set(P4.from[0]); ly.set(P4.from[1]);
    lx.to(P4.rest[0]); ly.to(P4.rest[1]);
    clipT = -1;
    bloom = 0;
    showHint = 0;
    sinceTouch = 0;
    if (idle) idle.cancel(4.0);
    /* he notices it INSTANTLY. Impulses, not targets, so it is moving in the
       first frame — the same trick as the reunion's notice beat. */
    s.earL.kick(8.0); s.earR.kick(-7.4);
    s.perk.kick(3.8);
    s.eyeOpen.kick(3.0);
    s.pupilY.kick(-18);
    rig.blinkNow(1);
    sound('perk');
    setHint(COPY.leashOut(Pn()));
    return true;
  }

  /** the fizz ceiling: he is tired, or it is his fourth walk today */
  function fizzCap() {
    let cap = 1;
    if (game.dog.needs.energy < P4.tiredAt) cap = Math.min(cap, P4.tiredCap);
    if (game.walkedEnoughToday) cap = Math.min(cap, P4.overCap);
    return cap;
  }

  function clipItOn() {
    if (leash.on) return false;
    leash.on = true;
    leash.held = false;
    clipT = 0;
    bloom = 1;
    sound('boop');
    rig.shiver();
    s.hop.kick(9.0 * motion);
    rig.drive.wiggle = 1;
    game.addMood(0.10);
    const h = rig.headWorld();
    for (let i = 0; i < Math.round(5 * partScale); i++) {
      spawn('spark', h.x + rng.range(-30, 30), h.y + rng.range(-26, 10));
    }
    setHint(COPY.clipped(Pn(), nm()));
    return true;
  }

  /* ================================================================== */
  /*  BEAT 2 -> 3 — SET OFF                                             */
  /* ================================================================== */
  function setOff(mix, dur, path) {
    map.close();
    const a = game.startWalk({ mix, dur, path, rng });
    /* HE WALKS OUT NOW. `away` is deferred to the end of the departure: while
       `off` is running he is still HERE, just in profile and on his way. The room
       hides the frontal dog for both (`hidesDog`), so there is never a moment
       with two of him on screen. */
    off = 0;
    ensureSide();
    /* the sheet has had the lead beat and the map to decode in; if it still is
       not here, this departure is the drawn dog's from beginning to end */
    lockedDrawn = !(sprite && sprite.ready);
    sideKind = lockedDrawn ? 'drawn' : 'sprite';
    setHint(COPY.offGo(Pn(), nm()));
    away = false;
    beat = '';
    t = 0;
    route = a.route;
    prog = 0;
    leash.on = false;
    sp.walkW.to(0);
    if (idle) idle.cancel(2.0);
    sound('scamper');
    return a;
  }

  /* ================================================================== */
  /*  BEAT 3 — ABSENCE (a pure function of the wall clock)              */
  /* ================================================================== */
  /**
   * Pick a walk back up. Called on scene entry when a save has one running,
   * and that is the whole "survives being fully closed" path: nothing was
   * ticking, `startedAt` was persisted, and progress is derived here.
   */
  function resume() {
    const wp = game.walkProgress();
    if (!wp.active) return false;
    away = true;
    beat = '';
    t = 0;
    leash.on = false;
    route = wp.active.route;
    prog = wp.progress;
    map.pick(route, true);
    sp.walkW.to(0);
    return true;
  }

  /** end it early. NEVER penalised: he still comes home with something. */
  function bringHome(opts = {}) {
    if (!away) return false;
    const wp = game.walkProgress();
    if (!wp.active) { away = false; return false; }
    arrive({ early: !wp.done, ...opts });
    return true;
  }

  /* ================================================================== */
  /*  BEAT 4 — RETURN                                                   */
  /* ================================================================== */
  /**
   * He is home. Applies the walk's costs and rewards through the game
   * mutators (never by poking fields), then plays the arrival.
   * @param opts { early, after }  `after` = a reunion intensity to play once
   *   the return has landed, for when she was gone long enough to earn one.
   */
  function arrive(opts = {}) {
    const now = Date.now();
    const wp = game.walkProgress(now);
    if (!wp.active) return false;
    const a = wp.active;
    const p = clamp(wp.progress, 0, 1);
    /* the deterministic roll — same seed, same result, however many resumes */
    const res = game.walkFinds(p, now);

    /* ---- what it cost him. ALL through the ratcheted mutators. ------- */
    const dirt = BALANCE.needs.dirt.perWalk * p * blend(a.mix, W.cost.dirtRoute, 1);
    game.soil(dirt, rng);
    game.addNeed('energy', -W.cost.energy * p);
    game.addNeed('hunger', -W.cost.hunger * p);
    game.addNeed('thirst', -W.cost.thirst * p);
    /* he had a lovely time: mood is the fast axis, the bond gets the ledger */
    game.addMood(W.cost.mood * (0.55 + 0.45 * p));
    game.addTrust(W.cost.trust);
    game.awardDay('walk', now);

    /* ---- what he brought home -------------------------------------- */
    carried = [];
    const lines = [];
    let newToy = '';
    for (const f of res.finds) {
      const added = game.addFind({ ...f, route: a.route }, now);
      if (!added) continue;
      carried.push(f);
      if (added.unlockedToy) newToy = added.unlockedToy;
    }
    if (res.coins > 0) game.addCoins(res.coins);
    game.log('walk', 'came home from the ' + a.route
      + (carried.length ? ' with ' + carried.map((f) => f.id).join(', ') : ''));

    /* the card that names it. First find headlines; a met dog gets its own
       line because meeting someone is the point of a photo. */
    if (carried.length) {
      lines.push(COPY.broughtHome(Pn(), nm(), COPY.findName(carried[0].id)));
      const metOne = carried.find((f) => f.met);
      if (metOne) lines.push(COPY.metSomeone(Pn(), COPY.met[metOne.met] || 'another dog'));
      else if (carried.length > 1) lines.push('...and ' + COPY.findName(carried[1].id));
      if (newToy) lines.push(COPY.newToy(Pn(), COPY.findName(carried.find((f) => f.toy === newToy).id)));
      if (res.coins > 0) lines.push(COPY.gotCoins(res.coins));
    }
    card = { lines, id: carried.length ? carried[0].id : '', life: 0, hold: true };

    /* ---- bank the walk and play the arrival ------------------------ */
    game.endWalk(now);
    away = false;
    beat = 'home';
    t = 0;
    stride = 0;
    homeK = clamp(0.35 + p * 0.45 + game.affection * 0.30, 0, 1);
    reunionAfter = clamp(+opts.after || 0, 0, 1);
    pantFor = lerp(HM.pantFor[0], HM.pantFor[1], p);
    sp.walkW.set(1);
    sp.homeIn.set(1);
    sp.homeIn.to(0);
    sp.carry.set(1);
    if (idle) idle.cancel(HM.beats.settle + 1.2);
    sound('scamper');
    return true;
  }

  function finishHome() {
    beat = '';
    sp.walkW.to(0);
    rig.x = rig.home.x; rig.y = rig.home.y; rig.s = rig.home.s;
    rig.sy = 1; rig.sx = 1;
    rig.drive.pant = 0;
    /* the dirt is the point: give her the nudge, once, warmly */
    if (game.dirtMean > 0.34) toast(COPY.bathHint(Pn()));
    const after = reunionAfter;
    reunionAfter = 0;
    for (const cb of homeCbs) { try { cb({ after, carried: carried.slice() }); } catch (e) { /* a listener must not break the beat */ } }
  }

  function stop() {
    /* leaves an ACTIVE walk alone on purpose: `stop` tears the layer down, it
       does not cancel a walk he is actually on. Only `bringHome` ends one. */
    if (beat === 'home') finishHome();
    /* a departure interrupted by leaving the scene simply completes: he IS out */
    if (off >= 0) { off = -1; away = true; }
    beat = '';
    map.close();
    sp.walkW.to(0);
    leash.held = false;
    hint = '';
  }

  /* ================================================================== */
  /*  update                                                            */
  /* ================================================================== */
  function update(dt, mood) {
    clock += dt;
    hintT += dt;
    /* KEEP THE IDLE DIRECTOR OUT OF THIS. `walk.apply` runs after
       `idle.update`, so the gaze it writes always wins — but an idle CLIP
       writes `s.pitch` and `s.yaw` directly, and this layer deliberately does
       not (it drives them through `lookAtVirtual` so the head TRACKS the lead
       rather than snapping to a pose). Measured: 3.7s into the prepare beat the
       first clip after the initial cancel drove pitch from +1.0 to -0.4 — he
       stopped looking at the lead and started sniffing the floor. */
    if (beat === 'prep' || beat === 'map' || beat === 'home') { if (idle) idle.cancel(0.9); }
    /* THE DEPARTURE, and `away` only becomes true when he is actually gone. The
       absence beat is a pure function of the wall clock (state/walks.js) and was
       already started by `startWalk`, so nothing about the walk's duration
       depends on how long this takes — he is simply visible for the first two
       seconds of it. */
    if (off >= 0) {
      off += dt;
      if (offU() >= 1) { off = -1; away = true; }
    }
    if (bloom > 0) bloom = Math.max(0, bloom - dt * 3.4);
    for (let i = dropped.length - 1; i >= 0; i--) dropped[i].life += dt;
    if (card) {
      /* held back until he has actually put the thing down: the card was
         appearing on the first frame of the arrival, which announced the
         reward before he had walked in with it */
      if (!card.hold) card.life += dt;
      if (card.life > BALANCE.ui.findCard.dur) card = null;
    }

    /* ---- ABSENCE: derived, never accumulated ----------------------- */
    if (away) {
      const wp = game.walkProgress();
      if (!wp.active) { away = false; }
      else {
        prog = wp.progress;
        route = wp.active.route;
        remainWords = describeRemaining(prog);
        /* he finishes while she is watching — the same code path as finishing
           while the app was shut, which is why there is only one of them */
        if (wp.done) { arrive({}); }
      }
    }

    if (beat === 'prep') {
      t += dt;
      sinceTouch += dt;
      /* the leash tracks the finger while held; otherwise it swings home */
      if (!leash.held) { lx.step(dt); ly.step(dt); leash.x = lx.x; leash.y = ly.x; }
      else { lx.set(leash.x); ly.set(leash.y); }
      leash.sway = approach(leash.sway, clamp(-leash.vx * 0.0040, -0.55, 0.55), 9, dt);
      leash.vx *= Math.pow(0.02, dt);

      /* ---- FIZZ: the anticipation envelope ------------------------
         Rises just from the lead being out, faster while it is near him, and
         fastest while she waggles it. This is the whole mechanic of the beat:
         he is not playing a canned animation, he is reacting to an object. */
      if (clipT < 0) {
        const cAt = collarAt();
        const near = Math.hypot(leash.x - cAt.x, leash.y - cAt.y) < P4.nearR ? 1 : 0;
        let rise = P4.fizzRise + near * P4.fizzNear;
        fizz += rise * dt;
        fizz -= P4.fizzFall * dt * (near ? 0 : 1) * 0.5;
        fizz = clamp(fizz, 0, fizzCap());
      }
      sp.fizz.to(clamp(fizz, 0, 1));

      /* the bounce. A hop is an impulse, not a loop — and `hop` is an existing
         posture channel, so there is no new art anywhere in this. */
      const f = sp.fizz.x;
      if (clipT < 0 && f > P4.up) {
        hopIn -= dt;
        if (hopIn <= 0) {
          hopIn = lerp(P4.hopEvery[1], P4.hopEvery[0], f);
          const h = lerp(P4.hopHeight[0], P4.hopHeight[1], f) * motion;
          s.hop.kick(11 * h);
          s.squash.kick(-1.1 * h);
          if (rng.chance(0.34)) sound('whine');
        }
        /* ...and at full fizz he whips round on the spot. On a frontal rig a
           turn is the silhouette NARROWING (§12.6 / stage 3's roll-over), not a
           drawing of his side, which does not exist. */
        if (f > P4.electric && spinIn <= 0 && spinT <= 0) {
          spinIn = rng.span(P4.spinEvery);
        }
        spinIn -= dt;
        if (spinIn <= 0 && spinT <= 0 && f > P4.electric) { spinT = 0.46; spinIn = rng.span(P4.spinEvery); }
      }
      if (spinT > 0) spinT = Math.max(0, spinT - dt);

      /* the hint: a ghost arrow from the lead to his collar, after a beat */
      if (clipT < 0 && t > P4.hintAfter) showHint = Math.min(1, showHint + dt * 2.2);
      else showHint = Math.max(0, showHint - dt * 3);
      if (clipT < 0) {
        if (t > P4.offerAfter) setHint(COPY.clipOnAgain(Pn()));
        else if (fizzCap() < 0.9 && t > 1.6) setHint(COPY.tiredOut(Pn()));
        else if (f > P4.electric) setHint(COPY.fizzHigh(Pn()));
        else if (f > P4.up) setHint(COPY.fizzMid(Pn()));
        else if (t > 0.9) setHint(COPY.clipOn(Pn()));
      }

      /* clipped: a short snap-and-wiggle hold, then the map */
      if (clipT >= 0) {
        clipT += dt;
        if (clipT > P4.clipHold) { beat = 'map'; t = 0; map.open(); }
      }
    }

    if (beat === 'map') {
      t += dt;
      lx.step(dt); ly.step(dt);
    }

    if (beat === 'home') {
      t += dt;
      const B = HM.beats;
      stride += dt * HM.strideRate * (t < B.in ? 1 : Math.max(0, 1 - (t - B.in) * 1.4));
      /* HOW FAR UP THE ROAD HE STILL IS. An eased function of `t`, not a
         spring: the spring reached home in ~0.4s and threw away the 1.55s the
         beat is given, so he was at full size before he had arrived. Same
         reason the reunion eases its bolt rather than letting the spring
         choose the timing. */
      const dIn = 1 - easeOut3(clamp(t / B.in, 0, 1));
      sp.homeIn.set(dIn);
      if (t >= B.drop && sp.carry.t > 0.5) {
        /* he drops it: the carry spring falling is the arc */
        sp.carry.to(0);
        sound('toy-land');
        for (const f of carried) {
          dropped.push({
            id: f.id,
            x: HM.dropTo[0] + rng.range(-HM.dropSpread, HM.dropSpread) + dropped.length * 4,
            y: reach.clampY(HM.dropTo[1] + rng.range(-6, 6), HM.dropR),
            life: 0, s: 1,
          });
          while (dropped.length > 6) dropped.shift();
        }
      }
      if (t >= B.proud && t - dt < B.proud) {
        sound('proud-yip');
        if (card) card.hold = false;
        const h = rig.headWorld();
        for (let i = 0; i < Math.round(lerp(HM.hearts[0], HM.hearts[1], homeK) * partScale); i++) {
          spawn('heart', h.x + rng.range(-34, 34), h.y + rng.range(-30, 6));
        }
        toast(game.dirtMean > 0.40 ? COPY.homeMuddy(Pn(), nm()) : COPY.homeTired(Pn(), nm()));
      }
      if (t >= B.settle) finishHome();
    }

    map.update(dt);
    for (const q in sp) sp[q].step(dt);
  }

  /* ================================================================== */
  /*  apply — the pose. Targets only, except the return's placement.     */
  /* ================================================================== */
  function apply(dt, mood) {
    const w = sp.walkW.x;
    if (w < 0.004 && beat !== 'home') return;

    if (beat === 'prep' || beat === 'map') {
      /* `fizz` is deliberately under-damped, so it overshoots 1 — that
         overshoot IS "he cannot contain himself". Bounded so nothing downstream
         gets an absurd target. */
      const f = clamp(sp.fizz.x, 0, 1.08);
      const k = w;                    // blend weight while the layer fades in
      /* HE WATCHES THE LEAD. Everything else in this beat is decoration on top
         of that one fact — a dog that tracks the object is alive, a dog that
         plays an excited animation at the camera is a puppet. */
      if (beat === 'prep') rig.lookAtVirtual(leash.x, leash.y + 8);

      /* ears hard forward, eyes wide, brows up: the "yes? YES?" face */
      bias(s.perk, 0.30 + f * 0.62, k);
      bias(s.earBack, -0.16 - f * 0.44, k);
      /* WIDE EYES, not a happy squint. The first pass squinted them shut at
         high fizz (eyeSmile 0.70) and he read as a contented dog dozing rather
         than an electric one — and it hid the pupils, which are the only thing
         that shows he is watching the lead. */
      bias(s.eyeOpen, 1.08 + f * 0.24, k);
      bias(s.brow, 0.38 + f * 0.60, k);
      bias(s.eyeSmile, 0.14 + f * 0.26, k);
      bias(s.smile, 0.52 + f * 0.44, k);
      bias(s.mouth, 0.10 + f * 0.40 + (f > P4.up ? 0.10 * Math.sin(clock * 15) : 0), k);
      bias(s.tongue, Math.max(0, (f - P4.up) / (1 - P4.up)) * 1.05, k);
      /* the tail goes before anything else does, and then does not stop */
      bias(s.tailUp, 0.36 + f * 0.62, k);
      bias(s.wagAmp, 0.22 + f * 0.86, k);
      bias(s.wagSpd, 3.4 + f * 17, k);
      /* he is not sitting down for this */
      bias(s.sit, 0, k);
      bias(s.down, 0, k);
      bias(s.melt, 0, k);

      /* the front end lifts and the paws scrabble. `hop` carries the height
         (kicked in update), so this is only the lateral business. */
      if (f > P4.up * 0.6) {
        const sc = Math.sin(clock * lerp(5.2, 11.5, f));
        const amp = (f - P4.up * 0.6) / (1 - P4.up * 0.6);
        bias(rig.pawLift[0], Math.max(0, sc) * 0.95 * amp, k);
        bias(rig.pawLift[1], Math.max(0, -sc) * 0.95 * amp, k);
        bias(s.hindKick, 0.42 * amp, k);
        /* CRANING UP AT IT — but only a little. 4.5 rig units was inside the
           noise; 15 was the OTHER failure, and it is the one ARCHITECTURE §12.6
           warns about: it lifted the head clear of the shoulders and the
           semi-transparent neck bridge under it read as a pale ghost column,
           i.e. a disembodied head again. This rig has no drawn neck, so "he is
           looking up at it" has to be sold by the GAZE (which is emphatic
           already) and by the BOUNCE — the hop raises the head and the body
           together, so it can never open a gap. */
        bias(s.headLift, 3.2 * amp * f, k);
        rig.drive.wiggle = Math.max(rig.drive.wiggle, amp * f * 0.95);
        rig.drive.pant = Math.max(rig.drive.pant, (f - 0.4) * 1.2);
      }
      /* lean toward the lead, so the whole body points at it */
      const cAt = collarAt();
      const dxv = clamp((leash.x - cAt.x) / 130, -1, 1);
      /* LEAN AT IT. 6.5 units was invisible; 13 plus a real head tilt is a dog
         whose whole body is pointed at the thing in her hand, which is most of
         what makes the beat read from a still frame. */
      bias(s.sway, dxv * 13 * f, k);
      bias(s.tilt, dxv * 0.16 * f, k);

      /* THE SPIN. sx narrowing + a yaw whip = he turned round, on a rig that
         cannot draw its own side. */
      if (spinT > 0) {
        const u = 1 - spinT / 0.46;
        rig.sx = 1 - Math.sin(u * Math.PI) * 0.62 * motion;
        bias(s.yaw, Math.sin(u * TAU) * 1.15, 1);
        bias(s.tilt, Math.sin(u * TAU) * 0.16, 1);
      } else rig.sx = 1;

      /* the clip lands: a whole-body wiggle and a bounce */
      if (clipT >= 0) {
        const u = clamp(clipT / P4.clipHold, 0, 1);
        rig.drive.wiggle = Math.max(rig.drive.wiggle, (1 - u) * 1.0);
        bias(s.eyeSmile, 0.95, 1);
        bias(s.mouth, 0.5, 1);
        bias(s.tongue, 1.0, 1);
        bias(s.wagAmp, 1.05, 1);
        bias(s.wagSpd, 21, 1);
        if (u < 0.2) rig.lookAtVirtual(195, 1000);
      }
      return;
    }

    if (beat !== 'home') return;

    /* ================================================================
       THE RETURN. Depth is scale: he starts small at the back of the room
       and grows. No gait cycle, no side rig, and the eye reads it as a dog
       trotting in because the thing it actually tracks is the scale change
       and the per-stride vertical squash.
       ================================================================ */
    const B = HM.beats;
    const d = sp.homeIn.x;                 // 1 = still up the road, 0 = home
    const bob = Math.sin(stride);
    rig.s = rig.home.s * lerp(1, HM.fromScale, d);
    rig.y = rig.home.y + HM.fromY * d + Math.abs(bob) * -HM.strideAmp * (1 - d * 0.4) * motion;
    rig.x = rig.home.x + Math.sin(stride * 0.5) * HM.strideAmp * 0.7 * d * rig.mo.shake;
    rig.sy = 1 + bob * 0.05 * (1 - d) * motion - d * 0.06;
    rig.sx = 1;

    const tired = clamp(1 - game.dog.needs.energy, 0, 1);
    const pant = clamp(1 - Math.max(0, t - B.drop) / pantFor, 0, 1);
    rig.drive.pant = pant * (0.55 + 0.45 * tired);
    rig.drive.neck = Math.max(rig.drive.neck || 0, (1 - d) * 0.35);

    if (t < B.drop) {
      /* coming in: head level and low, ears back, tail going, tongue out */
      rig.lookAtVirtual(195, 980);
      s.perk.to(0.30 + (1 - d) * 0.22);
      s.earBack.to(0.22 + 0.30 * (1 - d));
      s.headLift.to(-2 + bob * 1.6 * (1 - d));
      s.pitch.to(clamp(0.06 + 0.14 * (1 - d), -1, 1));
      s.eyeOpen.to(1.0 + 0.12 * (1 - d));
      /* MOUTH SHUT ROUND WHATEVER HE IS CARRYING. The first pass had it wide
         open with the tongue out and the found thing drawn over the top, which
         read as him chewing a postage stamp. If his mouth is empty he can pant
         like the reunion does; if it is not, he cannot, and that is the tell
         that he is carrying something. */
      const hasIt = carried.length > 0;
      s.eyeSmile.to(hasIt ? 0.30 : 0.52);
      s.smile.to(hasIt ? 0.52 : 0.86);
      s.mouth.to(hasIt ? 0.06 : 0.34 + 0.14 * pant * Math.sin(clock * 13));
      s.tongue.to(hasIt ? 0 : 0.85 + 0.25 * pant);
      s.noseTw.to(hasIt ? 0.16 * Math.sin(clock * 9) : 0);
      s.tailUp.to(0.82);
      s.wagAmp.to(lerp(0.5, 0.95, homeK));
      s.wagSpd.to(lerp(9, 17, homeK));
      rig.pawLift[0].to(Math.max(0, bob) * 0.85 * (1 - d * 0.3));
      rig.pawLift[1].to(Math.max(0, -bob) * 0.85 * (1 - d * 0.3));
      s.hindKick.to(0.55 * (1 - d));
      s.sit.to(0); s.down.to(0);
      rig.drive.wiggle = Math.max(rig.drive.wiggle, (1 - d) * 0.30);
      return;
    }

    if (t < B.proud) {
      /* the drop: the head dips and the mouth opens */
      const u = clamp((t - B.drop) / (B.proud - B.drop), 0, 1);
      const dip = hump(clamp(u * 2.2, 0, 1));
      rig.lookAtVirtual(HM.dropTo[0], HM.dropTo[1] + 30);
      s.headLift.to(-8 * dip);
      s.pitch.to(clamp(-0.34 * dip, -1, 1));
      /* and now it opens, which is what makes the thing fall out */
      s.mouth.to(0.14 + 0.52 * dip);
      s.tongue.to(0.35 + 0.35 * dip);
      s.earBack.to(0.10);
      s.perk.to(0.28);
      s.eyeSmile.to(0.42);
      s.smile.to(0.78);
      s.tailUp.to(0.74);
      s.wagAmp.to(0.62); s.wagSpd.to(11);
      rig.drive.neck = Math.max(rig.drive.neck || 0, dip * 0.6);
      return;
    }

    /* PROUD, then settling. The look up at the camera is a bid, and it should
       read as one: eye contact, ears up, tail flat out. */
    const u = clamp((t - B.proud) / (B.settle - B.proud), 0, 1);
    const calm = smooth(u);
    rig.lookAtVirtual(195, 1000 - calm * 40);
    s.perk.to(lerp(0.62, 0.36, calm) * (1 - tired * 0.35));
    s.headLift.to(lerp(HM.proudLift * 9, 0, calm));
    s.earBack.to(lerp(-0.34, -0.05, calm));
    s.pitch.to(clamp(lerp(0.22, 0.06, calm), -1, 1));
    s.eyeOpen.to(lerp(1.14, 1.0 - tired * 0.20, calm));
    s.eyeSmile.to(lerp(0.88, 0.40, calm));
    s.brow.to(lerp(0.72, 0.30, calm));
    s.smile.to(lerp(0.95, 0.68, calm));
    s.mouth.to(lerp(0.34, 0.12, calm) + 0.14 * pant * Math.sin(clock * 12));
    s.tongue.to(lerp(0.95, 0.25, calm) + pant * 0.3);
    s.tailUp.to(lerp(0.92, 0.5, calm));
    s.wagAmp.to(lerp(lerp(0.6, 1.02, homeK), 0.34, calm));
    s.wagSpd.to(lerp(lerp(11, 19, homeK), 5.0, calm));
    rig.drive.wiggle = Math.max(rig.drive.wiggle, (1 - calm) * 0.55);
    rig.pawLift[0].to(0); rig.pawLift[1].to(0);
    s.hindKick.to(0);
    /* AND HE IS TIRED. He sinks a little as it wears off — the walk cost him
       something, and that is what makes it feel like it happened. */
    /* AND HE IS TIRED. Sinking, heavier blinks, ears settling back down: the
       walk cost him something, and that is what makes it feel like it happened
       rather than like a menu that paid out. */
    s.melt.to(calm * tired * 0.62);
    s.squash.to(calm * tired * 0.10);
    s.perk.to(Math.min(s.perk.t, lerp(0.62, 0.30 - tired * 0.18, calm)));
    if (calm > 0.75 && tired > 0.3 && rng.chance(dt * 0.9)) rig.blinkNow(1);
  }

  /* ================================================================== */
  /*  draw                                                              */
  /* ================================================================== */
  /** BEHIND the dog: the melancholy of an empty room, and today's treasures */
  function drawBack(g) {
    const c = g.ctx;
    if (away) {
      const a = clamp(0.55 + prog * 0.45, 0, 1);
      /* THE LIGHT GOES OUT OF THE ROOM. A cool veil plus a little darkness —
         the game is a warm light design, so cooling it is what reads as absence
         rather than as night. */
      c.fillStyle = C.cool + (AW.chill * a).toFixed(3) + ')';
      c.fillRect(-40, -40, VW + 80, VH + 80);
      c.fillStyle = C.quiet + (AW.dim * a).toFixed(3) + ')';
      c.fillRect(-40, -40, VW + 80, VH + 80);
      /* the dent in the rug where he usually is */
      c.save();
      c.globalAlpha = 0.52;
      const gr = c.createRadialGradient(rig.home.x, rig.home.y - 6, 4, rig.home.x, rig.home.y - 6, 104);
      gr.addColorStop(0, 'rgba(72,42,24,0.66)');
      gr.addColorStop(0.62, 'rgba(72,42,24,0.22)');
      gr.addColorStop(1, 'rgba(72,42,24,0)');
      c.fillStyle = gr;
      c.save(); c.translate(rig.home.x, rig.home.y - 6); c.scale(1, 0.30);
      c.translate(-rig.home.x, -(rig.home.y - 6));
      c.beginPath(); c.arc(rig.home.x, rig.home.y - 6, 96, 0, TAU); c.fill();
      c.restore();
      c.restore();
      /* a couple of tufts of fur he left behind. Very small, very sad. */
      c.strokeStyle = 'rgba(255,240,214,0.30)'; c.lineWidth = 1.3; c.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const fx = rig.home.x - 30 + i * 26, fy = rig.home.y - 12 + (i % 2) * 7;
        c.beginPath(); c.moveTo(fx, fy); c.quadraticCurveTo(fx + 4, fy - 5, fx + 9, fy - 3); c.stroke();
      }
    }
    /* what he has brought home today, still lying on the rug */
    for (const it of dropped) {
      const pop = clamp(it.life / 0.34, 0, 1);
      c.save();
      c.globalAlpha = clamp(1 - Math.max(0, it.life - 200) / 3, 0, 1);
      drawFind(c, it.id, it.x, it.y, HM.dropScale * (pop < 1 ? easeOutBack(pop, 2.2) : 1), it.life);
      c.restore();
    }
  }

  /* ==================================================================
     BEAT 2.5 — THE DEPARTURE
     ==================================================================
     He trots out of the room instead of blinking out of it. This is the only
     thing the profile dog is used for, and the only thing this file needed him
     for: the absence and the frontal return are unchanged.

     THE SPRITE IF THERE IS ONE, THE DRAWN DOG IF NOT. Two breeds have sheets and
     the Shiba does not; `hasSideSprite` decides and both take the same arguments,
     so nothing below knows which it got. Built on the first walk rather than at
     construction, because most sessions never take one and a sheet is 111KB of
     decode nobody asked for. */
  function ensureSide() {
    if (sprite || drawn) return;
    if (hasSideSprite(rig.breed.id)) {
      sprite = createSideSprite(rig);
      sideKind = sprite ? 'sprite' : '';
    }
    if (!sprite) { drawn = createSideDog(rig); sideKind = 'drawn'; }
  }

  /**
   * WHICH PROFILE DOG TO DRAW THIS FRAME.
   *
   * The sheet is fetched and decoded asynchronously, and the first render of the
   * departure caught that: frame 0 was an EMPTY ROOM. `sprite.draw` returns false
   * before the image is ready, and nothing was drawing anything instead — he
   * simply was not there for the first few frames of walking out.
   *
   * Two answers, both needed. `ensureSide` is now called when the LEAD COMES OUT
   * rather than at Set off, so the sheet has the whole prepare beat and the map to
   * decode in. And if it still is not ready, the drawn profile stands in — built
   * lazily here, because on any normal run it is never built at all.
   */
  function activeSide() {
    if (!lockedDrawn && sprite && sprite.ready) return sprite;
    if (!drawn) { drawn = createSideDog(rig); }
    return drawn;
  }

  /** how far through the departure, 0..1 */
  function offU() {
    return off < 0 ? 0 : clamp(off / Math.max(0.2, WK.off.dur), 0, 1);
  }

  /**
   * DRAW HIM LEAVING. He starts where he was standing and walks off frame-left,
   * fading only over the last stretch — a dog who dissolves in the middle of the
   * room is a ghost, and one who is still solid at the frame edge is a cut.
   */
  function drawOff(g) {
    if (off < 0) return;
    const side = activeSide();
    if (!side) return;
    const u = offU();
    const O = WK.off;
    /* HE LEAVES AT A WALKING PACE. `easeOut3` was wrong in a way the first render
       made obvious: it front-loads everything, so he SHOT across the rug and then
       crept out. A dog walking out of a room accelerates once, from standing, and
       then holds his speed until he is gone. So: ease in over the first `ramp` of
       the beat, constant after, and never decelerate — a dog who slows down as he
       reaches the door has changed his mind. */
    const K = clamp(O.ramp === undefined ? 0.24 : O.ramp, 0.02, 0.9);
    const raw = u < K ? (u * u) / (2 * K) : u - K / 2;
    const pace = raw / (1 - K / 2);
    const x = lerp(rig.home.x, -O.exit, pace);
    /* the gait runs on DISTANCE, not on time, or he moonwalks: a stride has to be
       a stride whatever the frame rate did */
    const travelled = (rig.home.x + O.exit) * pace;
    const phase = travelled / Math.max(1, O.stride);
    side.draw(g, {
      x,
      y: rig.floorV,
      s: rig.home.s * O.scale,
      face: -1,
      phase,
      run: 1,
      alpha: clamp((1 - u) / Math.max(0.01, O.fade), 0, 1),
    });
  }

  /** IN FRONT of the dog: the lead, the collar, and whatever is in his mouth */
  function drawFront(g) {
    const c = g.ctx;
    drawOff(g);
    if (beat === 'prep' || beat === 'map') {
      /* the collar goes on before the lead is drawn over it */
      if (leash.on) {
        const cAt = collarAt();
        drawCollar(c, cAt.x, cAt.y, cAt.hw * rig.s * 0.5, rig.s / rig.home.s);
      }
      const held = leash.held ? 1 : 0;
      drawLeash(c, leash.x, leash.y, P4.scale * (1 + held * 0.05),
        P4.rest[0], leash.sway, clock,
        clipT < 0 ? clamp(0.35 + held * 0.5, 0, 1) : 0);

      /* the ghost hint: an arrow from the lead to his collar */
      if (showHint > 0.02 && clipT < 0) {
        const cAt = collarAt();
        c.save();
        c.globalAlpha = showHint * 0.5 * (0.6 + 0.4 * Math.sin(clock * 3.4));
        c.strokeStyle = C.hint; c.lineWidth = 2.4; c.lineCap = 'round';
        c.setLineDash([6, 7]); c.lineDashOffset = -clock * 16;
        c.beginPath();
        c.moveTo(leash.x, leash.y + 14);
        c.quadraticCurveTo((leash.x + cAt.x) / 2, (leash.y + cAt.y) / 2 + 40, cAt.x, cAt.y - 6);
        c.stroke();
        c.setLineDash([]);
        c.beginPath();
        c.ellipse(cAt.x, cAt.y, 26, 12, 0, 0, TAU);
        c.stroke();
        c.restore();
      }
      if (bloom > 0.02) {
        const cAt = collarAt();
        const r = 92 * (0.5 + (1 - bloom) * 0.8);
        c.save();
        c.globalAlpha = bloom * 0.5;
        const gr = c.createRadialGradient(cAt.x, cAt.y, 2, cAt.x, cAt.y, r);
        gr.addColorStop(0, 'rgba(255,250,226,0.95)');
        gr.addColorStop(1, 'rgba(255,242,206,0)');
        c.fillStyle = gr;
        c.beginPath(); c.arc(cAt.x, cAt.y, r, 0, TAU); c.fill();
        c.restore();
      }
      return;
    }

    /* the return: what he is carrying, in his mouth and then arcing down */
    if (beat === 'home' && carried.length) {
      const cy = sp.carry.x;
      if (cy > 0.01) {
        const Ps = rig.pose;
        const mx = rig.x + (Ps.muzX + HM.carryAt[0]) * rig.s;
        const my = rig.y + (Ps.muzY + HM.carryAt[1]) * rig.s * (rig.sy || 1);
        const tx = HM.dropTo[0], ty = HM.dropTo[1];
        const u = 1 - cy;
        const x = lerp(mx, tx, u);
        const y = lerp(my, ty, u) - hump(u) * HM.dropArc;
        /* ONE thing in his mouth. A dog carries one thing at a time, and
           drawing three of them stacked read as him eating a postage stamp. */
        const k = rig.s / rig.home.s;
        drawFind(g.ctx, carried[0].id, x, y, HM.carryScale * k, clock);
      }
    }
  }

  /** OVER everything: the absence panel, the find card, and the map */
  function drawOver(g) {
    const c = g.ctx;

    if (away) drawAwayPanel(g);
    if (card && card.lines.length) drawCard(g);

    /* THE ANTICIPATION LINE. Through ui/text.js, which means: a backing plate
       whose alpha is SOLVED so this clears 4.5:1 against anything behind it
       (it was 1.22:1 cream-on-cream), positioned relative to the SAFE-AREA top
       edge rather than a hard y=82, and shrunk to fit rather than clipped.
       `fade` is the transition only — never a style, or the contrast the plate
       just guaranteed is given straight back. */
    if ((beat === 'prep') && hint) {
      drawText(g, hint, {
        anchor: 'top', y: P4.hintTop,
        size: 13, weight: 600,
        fade: clamp(hintT * 2.4, 0, 1),
      });
      /* a way out that is never a dead end */
      c.save();
      c.globalAlpha = 0.85;
      c.fillStyle = 'rgba(255,248,232,0.88)';
      c.beginPath(); c.arc(BALANCE.ui.map.back.x, BALANCE.ui.map.back.y, BALANCE.ui.map.back.r, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(124,74,47,0.28)'; c.lineWidth = 1.3;
      c.beginPath(); c.arc(BALANCE.ui.map.back.x, BALANCE.ui.map.back.y, BALANCE.ui.map.back.r, 0, TAU); c.stroke();
      c.strokeStyle = C.ink; c.lineWidth = 2.2; c.lineCap = 'round';
      const bx = BALANCE.ui.map.back.x, by = BALANCE.ui.map.back.y;
      c.beginPath(); c.moveTo(bx - 5, by - 5); c.lineTo(bx + 5, by + 5); c.stroke();
      c.beginPath(); c.moveTo(bx + 5, by - 5); c.lineTo(bx - 5, by + 5); c.stroke();
      c.restore();
    }

    map.draw(g);
  }

  /**
   * "BRING HIM HOME", INSIDE THE REACHABLE PLAY AREA.
   *
   * Authored at y 744 to sit BELOW his empty spot — at 690 the button covered
   * the dent in the rug, which is the one thing the absence beat is about. But
   * the nav is drawn and hit-tested during `away` (that is deliberate: `More`,
   * and therefore renaming, has to stay available while he is out), and
   * `scenes/room.js` offers a touch to `nav.hit()` BEFORE `walk.pointer()`. At
   * y 744 with h 46 the button spans 721..767 and the bar's hit rect starts at
   * 730, so 37 of its 46 units pressed TRAIN or WALK instead. Tapping "Bring
   * him home" opened Training.
   *
   * One function, called by the draw AND the hit test, so the button that is
   * drawn is the button that is pressed.
   */
  function bringHomeBox() {
    const B = AW.bringHome;
    return { x: B.x, y: reach.clampY(B.y, B.h / 2), w: B.w, h: B.h, r: B.r };
  }

  function drawAwayPanel(g) {
    const c = g.ctx;
    const B = bringHomeBox();
    /* THE PAW TRAIL. Decoration that happens to show progress; the words
       beside it are what actually says how long. */
    /* CREAM, not brown: the brown print colour was invisible on a darkened
       rug, so these are drawn as light prints on the floorboards instead. */
    c.save();
    for (let i = 0; i < AW.prints; i++) {
      const u = (i + 0.5) / AW.prints;
      const on = prog >= u;
      const px = 52 + u * (VW - 104);
      const py = AW.printY + Math.sin(u * 6.0) * 7;
      c.globalAlpha = on ? 0.92 : 0.26;
      c.fillStyle = on ? '#fff1cf' : '#fff1cf';
      c.save();
      c.translate(px, py);
      c.rotate(1.05 + Math.sin(u * 4) * 0.2);
      c.scale(1.25, 1.25);
      ell(c, 0, 1.6, 3.4, 2.9); c.fill();
      for (let q = -1; q <= 1; q++) { ell(c, q * 3.0, -2.4, 1.25, 1.55, q * 0.32); c.fill(); }
      c.restore();
    }
    c.restore();

    /* THE ABSENCE COPY. One backing plate under all three lines — the absence
       beat cools and darkens the room by a variable amount (`AW.chill`/`dim`
       scale with progress), so the backdrop these words sit on is literally
       different every second they are on screen. That is precisely the case a
       hand-tuned shadow cannot cover and a solved plate can. */
    drawStack(g, [
      { text: COPY.awayQuiet(), size: 12.5, weight: 500, ink: '#ffe9cd' },
      { text: COPY.awayTitle(Pn(), nm(), route), size: 15, weight: 700, ink: '#fff3d8' },
      { text: COPY.awayWhen(Pn(), remainWords || describeRemaining(prog)), size: 12.5, weight: 600, ink: '#ffe9cd' },
    ], { anchor: 'top', y: AW.panelTop });

    /* bring him home — ALWAYS available, and never penalised. The plate is its
       own card, so the label passes `over` and the helper checks the contrast
       against that exactly instead of adding a scrim on top of a button. */
    c.save();
    c.fillStyle = C.btn;
    roundRect(c, B.x - B.w / 2, B.y - B.h / 2, B.w, B.h, B.r); c.fill();
    c.strokeStyle = 'rgba(124,74,47,0.28)'; c.lineWidth = 1.4;
    roundRect(c, B.x - B.w / 2, B.y - B.h / 2, B.w, B.h, B.r); c.stroke();
    c.restore();
    drawText(g, COPY.bringHome(Pn()), {
      x: B.x, y: B.y + 0.5, size: 14, weight: 700,
      ink: C.ink, over: C.btn, maxWidth: B.w - 24,
    });
  }

  function drawCard(g) {
    const c = g.ctx;
    const U = BALANCE.ui.findCard;
    const u = card.life / U.dur;
    const a = card.life < U.fade ? smooth(card.life / U.fade)
      : (u > 1 - U.fade / U.dur ? smooth((U.dur - card.life) / U.fade) : 1);
    const h = 34 + card.lines.length * 19;
    const x = (VW - U.w) / 2, y = U.y - (1 - a) * 8;
    c.save();
    c.globalAlpha = clamp(a, 0, 1);
    c.shadowColor = 'rgba(48,24,12,0.34)';
    c.shadowBlur = 16; c.shadowOffsetY = 5;
    c.fillStyle = C.card;
    roundRect(c, x, y, U.w, h, U.r); c.fill();
    c.shadowBlur = 0; c.shadowOffsetY = 0;
    c.strokeStyle = C.cardLine; c.lineWidth = 1.3;
    roundRect(c, x, y, U.w, h, U.r); c.stroke();
    /* the thing itself, drawn — a reward you cannot see is not a reward */
    if (card.id) {
      c.save();
      c.translate(x + 32, y + h / 2);
      const pop = clamp(card.life / 0.4, 0, 1);
      const k = pop < 1 ? easeOutBack(pop, 2.6) : 1 + Math.sin(card.life * 2.2) * 0.03;
      drawFind(c, card.id, 0, 0, 1.5 * k, card.life);
      c.restore();
    }
    c.restore();
    /* the lines, over the card we just drew. `over` means the contrast is
       checked against the card exactly and NO extra plate is added — the
       hand-drawn paper is the look, and the helper must not scrim it. The
       secondary lines were `rgba(93,48,24,0.70)`, which the helper resolves
       against the card rather than leaving it to luck. */
    for (let i = 0; i < card.lines.length; i++) {
      drawText(g, card.lines[i], {
        x: x + 62, y: y + 22 + i * 19, align: 'left',
        size: i === 0 ? 13 : 11.5, weight: i === 0 ? 700 : 500,
        ink: i === 0 ? C.ink : 'rgba(93,48,24,0.70)',
        over: C.card, maxWidth: U.w - 74, fade: clamp(a, 0, 1),
      });
    }
  }

  /* ================================================================== */
  /*  input                                                             */
  /* ================================================================== */
  /**
   * @param ev    normalised pointer event, VIRTUAL space
   * @param local rig-local coords of the same point
   * @returns true if the walk consumed it
   */
  function pointer(ev, local) {
    if (map.isOpen) return map.pointer(ev);

    if (away) {
      const B = bringHomeBox();
      if (ev.type === 'down') {
        if (Math.abs(ev.x - B.x) <= B.w / 2 && Math.abs(ev.y - B.y) <= B.h / 2) {
          const early = !game.walkProgress().done;
          bringHome();
          if (early) toast(COPY.broughtEarly(Pn(), nm()));
          return true;
        }
      }
      /* every other touch on an empty room is absorbed: there is nothing to
         pet, and letting it fall through to the petting field would register
         strokes on a dog who is not there */
      return true;
    }

    if (beat === 'prep') {
      const bk = BALANCE.ui.map.back;
      if (ev.type === 'down' && Math.hypot(ev.x - bk.x, ev.y - bk.y) <= bk.r + 12) {
        toast(COPY.notNow(Pn()));
        stop();
        return true;
      }
      if (ev.type === 'down') {
        sinceTouch = 0;
        /* pick the lead up if she touched near it... */
        if (Math.hypot(ev.x - leash.x, ev.y - leash.y) < 62) {
          leash.held = true;
          leash.x = ev.x; leash.y = ev.y;
          sound('perk');
          return true;
        }
        /* ...and a tap on HIM clips it on, because making her aim precisely at
           a collar on a bouncing dog would be a dexterity test, not a moment */
        if (Math.abs(local.x) < 100 && local.y > -240 && local.y < 60) {
          clipItOn();
          return true;
        }
        return true;
      }
      if (ev.type === 'move' && leash.held) {
        leash.vx = (ev.x - leash.x) / Math.max(1 / 240, 1 / 60);
        /* waggling it is what really winds him up */
        fizz = clamp(fizz + Math.hypot(ev.x - leash.x, ev.y - leash.y) * P4.fizzPerUnit, 0, fizzCap());
        leash.x = ev.x; leash.y = ev.y;
        return true;
      }
      if ((ev.type === 'up' || ev.type === 'cancel') && leash.held) {
        leash.held = false;
        const cAt = collarAt();
        if (Math.hypot(leash.x - cAt.x, leash.y - cAt.y) < P4.clipR) clipItOn();
        else { lx.set(leash.x); ly.set(leash.y); lx.to(P4.rest[0]); ly.to(P4.rest[1]); }
        return true;
      }
      return true;
    }

    if (beat === 'home') {
      /* the arrival is skippable, like every other beat in this game */
      if (ev.type === 'down' && t > 0.5) { finishHome(); return true; }
      return true;
    }
    return false;
  }

  /* ================================================================== */
  return {
    get beat() { return away ? 'away' : beat; },
    get active() { return away || beat !== '' || sp.walkW.x > 0.01; },
    /** true while the walk owns the whole surface (chrome hides) */
    get modal() { return beat === 'prep' || beat === 'map' || beat === 'home'; },
    /** true while she must not be petted / fed / trained */
    /* THE DEPARTURE COUNTS AS BUSY. `hidesDog` is true while he walks out, so
       without this the room would happily hand a tap to the petting field and
       stroke a dog who is not being drawn. */
    get busy() {
      return away || off >= 0 || beat === 'home' || beat === 'prep' || beat === 'map';
    },
    /** true while the room must not draw the dog at all */
    /* THE FRONTAL DOG IS HIDDEN WHILE HE IS LEAVING TOO, or there are two of him
       on screen: one standing on the rug and one walking out of the door. */
    get hidesDog() { return away || off >= 0; },
    /** true while the walk gets the pointer ahead of everything but the sheet */
    get owns() { return beat === 'prep' || beat === 'map' || beat === 'home'; },
    get away() { return away; },
    get weight() { return sp.walkW.x; },
    get fizz() { return sp.fizz.x; },
    get progress() { return away ? prog : 0; },
    get route() { return route; },
    get hint() { return hint; },
    get map() { return map; },
    get carried() { return carried.slice(); },
    get dropped() { return dropped.slice(); },
    /** the collection, for the room's shelf */
    collection() { return game.findCollection(); },
    COPY,

    start, stop, resume, setOff, bringHome, arrive, clipItOn,
    update, apply, pointer, drawBack, drawFront, drawOver,
    /** notified when a return has finished landing; `after` is a reunion to play */
    onHome(fn) {
      homeCbs.push(fn);
      return () => { const i = homeCbs.indexOf(fn); if (i >= 0) homeCbs.splice(i, 1); };
    },
    /** verification hook: wind the fizz straight up without waggling anything */
    setFizz(v) { fizz = clamp(+v || 0, 0, 1); sp.fizz.set(fizz); return fizz; },

    /**
     * WHAT THE PER-FRAME REACHABLE-AREA ASSERTION SEES (ui/reach.js).
     *
     * The one control the absence beat has — LIVE while he is away, because
     * that is precisely when the nav is drawn over it and gets the touch first —
     * and everything he carried home. The finds have no hit test of their own,
     * so they are reported `live: false`; the bound still applies to them
     * because being half behind a pill is a defect even when it is only a
     * visual one, and the payoff of a whole walk is the wrong thing to hide.
     */
    reachProbe() {
      const B = bringHomeBox();
      const out = [{
        id: 'bringHome', state: away ? 'away' : 'off',
        x: B.x, y: B.y, rx: B.w / 2, ry: B.h / 2, live: !!away,
      }];
      for (let i = 0; i < dropped.length; i++) {
        out.push({
          id: 'find', state: dropped[i].id,
          x: dropped[i].x, y: dropped[i].y, rx: HM.dropR, ry: HM.dropR, live: false,
        });
      }
      return out;
    },

    get debug() {
      return {
        beat: away ? 'away' : (beat || 'off'),
        w: +sp.walkW.x.toFixed(3),
        fizz: +sp.fizz.x.toFixed(3), fizzRaw: +fizz.toFixed(3), cap: +fizzCap().toFixed(2),
        leash: [Math.round(leash.x), Math.round(leash.y)], held: leash.held, on: leash.on,
        clipT: +clipT.toFixed(2), spin: +spinT.toFixed(2),
        away, prog: +prog.toFixed(3), route, remain: remainWords,
        /* THE DEPARTURE. Note `beat` already says the string 'off' for "no beat
           is running", which is a different thing entirely — hence `leaving`. */
        leaving: off >= 0, leaveU: off < 0 ? 0 : +offU().toFixed(3), sideKind,
        t: +t.toFixed(2), homeIn: +sp.homeIn.x.toFixed(3), carry: +sp.carry.x.toFixed(3),
        carried: carried.map((f) => f.id), dropped: dropped.map((d) => d.id),
        /* WHERE they are, for tools/placegate.py: the ids alone cannot say whether
           a find is being drawn in the park, and the band they land in is mostly
           dog. */
        droppedAt: dropped.map((d) => [Math.round(d.x), Math.round(d.y)]),
        card: card ? card.lines : null,
        walksToday: game.walksToday, total: game.walksTotal,
        coins: game.state.player.coins,
        collection: Array.from(game.findCollection()),
        activeToy: game.activeToy,
        map: map.debug,
      };
    },
  };
}

export default createWalk;
