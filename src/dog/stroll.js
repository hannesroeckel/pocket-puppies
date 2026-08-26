/* ==========================================================================
   dog/stroll.js — BEAT 2.75. THE WALK SHE WATCHES, AND TAPS.

   Asked for directly, on 2026-08-25:

     "cant we now not use the side profile to have an actual walk instead of
      just sending the dogs away?"

   and, given four shapes, the one chosen was the one with her hands in it:
   a travelling scene where she TAPS the things he passes, so that a find is
   DISCOVERED rather than awarded by a timer.

   WHAT THIS BEAT IS NOT ALLOWED TO COST, AND WHY EACH ONE SURVIVED
   ---------------------------------------------------------------
   1. THE ABSENCE. The room goes quiet and cool, there is a dent in the rug and
      a few tufts of fur, and it is the only sad moment in the game — it is what
      makes the reunion land. So this is half a minute at the START of the walk
      and then he carries on without her, exactly as before.
   2. THE FRONTAL RETURN. He comes home muddy, and mud is a per-region wash on a
      DRAWN dog; a painted sheet cannot get dirty (ARCHITECTURE §33.3). The one
      beat where his state is the whole payload is never a sprite, so nothing
      here touches the return.
   3. CLOSE-THE-APP PROGRESS. A walk is a pure function of wall-clock time
      (state/walks.js) and iOS suspends JS completely. NOTHING IN HERE TICKS A
      WALK FORWARD. The stroll runs on its own seconds, inside the walk's
      duration, and if the walk finishes underneath it the stroll gets out of
      the way rather than holding the return up.

   SO IT CANNOT ADD TIME TO THE WALK, BY CONSTRUCTION. The clock started when
   she pressed Set off. Watching costs her the seconds she chose to spend
   watching and not one second of his.

   WHAT SHE TAPS IS PERSISTED IMMEDIATELY, NOT AT THE END. `game.walkPick` puts
   the id on the walk record itself (schema 11), because the app being closed in
   the middle of this is the ordinary case, not the edge one — and losing what
   she chose would feel worse than never having offered. If she taps nothing, or
   closes the app before she taps anything, `rollFinds` falls back to the full
   roll and he found something himself. There is no branch anywhere that pays
   out less for not watching.

   THE PICTURE: ONE BAKE, TWO PLANES, FOUR BLITS
   ---------------------------------------------
   `scenes/outdoors.js drawStrip` is periodic BY CONSTRUCTION — every wave is a
   whole number of cycles across the tile and every scattered thing is redrawn
   one tile over when it straddles the join — so the ground can scroll forever
   with no seam to find. It is baked ONCE, at exactly the canvas's own width, so
   that "one tile" and "one screen" are the same number of device pixels and the
   wrap is `x` and `x - cw` with no arithmetic to get wrong.

   The two parallax planes come out of that ONE canvas rather than two, because
   `drawStrip` lays the grass down as a full-width fill AFTER the hills and the
   treeline: nothing survives across the horizon, so the top half and the bottom
   half can be blitted at two different rates and there is no shape to cut in
   half. Two canvases would have been the obvious way and would have cost a
   second full-screen bitmap — and iOS caps TOTAL canvas memory rather than
   per-canvas size, which is the failure that shows up as a blank white
   rectangle and never as an error (§32.2). The room already holds two.

   The tile is released the moment the beat has faded out, for the same reason.

   DEPTH IS THREE THINGS AGREEING. A find that is further away must sit higher
   up the grass, be smaller, AND go past more slowly; any two of those without
   the third reads as a sticker sliding over a photograph. `depth` drives all
   three off one hashed number per find.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { makeSprings } from '../engine/spring.js';
import { TAU, clamp, lerp, smooth, hump, easeOutBack, makeOff } from '../engine/draw.js';
import { drawStrip } from '../scenes/outdoors.js';
import { drawFind } from '../scenes/props.js';
import reach from '../ui/reach.js';

const S = BALANCE.walk.stroll;
const VW = BALANCE.view.W;
const VH = BALANCE.view.H;
const FLOOR = BALANCE.view.floorY;
/* how tall the profile dog is at scale 1 — the sheets' own number, read from
   the same place dog/sidesprite.js reads it, so "the front of his head" below
   is derived from his real size rather than from a pair of offsets that happen
   to look right at one scale */
const SIDE_H = (BALANCE.side.sprite && BALANCE.side.sprite.height) || 250;
/* how long a tapped find takes to reach his mouth */
const POP = 0.42;
/** a positive remainder — the wrap, and `%` alone gets it wrong going left */
const mod = (v, m) => (m > 0 ? ((v % m) + m) % m : 0);
/**
 * HOW SOLID THE ROAD IS, from the layer's weight — and the ONE function all
 * three draw passes ask, so the ground, the finds, the dog and the chrome can
 * never disagree about how far through the dissolve they are.
 *
 * It is not the weight itself. `Spring.x` approaches its target asymptotically
 * and never arrives, so a spring used directly as an alpha leaves the room
 * showing through the road for ever. See `stroll.opaqueAt`.
 */
const solid = (w) => clamp(w / Math.max(0.05, S.opaqueAt), 0, 1);

/* ==========================================================================
   createStroll(rig, opts)
     opts.game     the state facade — `walkOffer`, `walkPick`, `walkProgress`
     opts.side     () => the profile dog to draw (the sprite, or the drawn one).
                   dog/walk.js owns that choice and locks it for one departure,
                   so this asks rather than deciding again and risking a swap
                   halfway down the road.
     opts.onEnd    (reason) => ... — the hand-off to the absence beat
   ========================================================================== */
export function createStroll(rig, opts = {}) {
  const game = opts.game;
  const rng = opts.rng;
  const reduced = !!opts.reduced;
  const sound = opts.sound || (() => {});
  const spawn = opts.spawn || (() => {});
  const onEnd = opts.onEnd || (() => {});
  /* the same halving dog/walk.js uses, and `farK` goes to ZERO — under
     `prefers-reduced-motion` the sky, the hills and the treeline simply hold
     still, so two thirds of the screen stops moving and only the ground he is
     walking on goes past. That is what `reducedMotion.parallaxScale: 0` means
     for a scene that is nothing but parallax. */
  const motion = reduced ? 0.48 : 1;
  const farK = reduced ? 0 : S.farK;

  const sp = makeSprings(['strollW'], reduced);

  let on = false;
  let t = 0;                     // seconds into the stroll — never a walk clock
  let dur = 0;
  let dist = 0;                  // virtual units of ground covered, for the gait
  let items = [];
  let hintT = 0;
  let ended = '';

  /* the bake, and the view it was baked for */
  let tile = null;
  let tileKey = '';
  let tileW = 0;                 // device px — one tile IS one canvas width
  let horizon = 0;               // device y of the virtual floor line

  /* the deterministic hash `drawStrip` uses, so a find's depth is stable for a
     given walk seed rather than re-rolled on a resume */
  const hash = (i, s) => {
    const v = Math.sin((i + 1) * 12.9898 + s * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };

  /* ================================================================== */
  /*  begin / end                                                       */
  /* ================================================================== */
  /**
   * START WATCHING. Called by dog/walk.js the moment he has finished trotting
   * out of the room, and it may DECLINE — a walk with almost no time left on it
   * gets no stroll at all, because a beat that ends four seconds after it
   * started is worse than no beat.
   *
   * @returns true if the stroll took the screen
   */
  function begin() {
    if (!game) return false;
    const wp = game.walkProgress();
    if (!wp.active) return false;

    /* HOW LONG, AND THE ONLY THREE THINGS THAT MAY SHORTEN IT: the authored
       length, the fraction of THIS walk it is allowed to be, and what is
       actually left to run. It is never lengthened by anything. */
    let d = Math.min(S.dur, Math.max(1, wp.active.dur) * S.maxFrac);
    if (d < S.minDur) d = S.minDur;
    d = Math.min(d, (wp.remainMs / 1000) * 0.92);
    if (!(d > 2)) return false;

    /* WHAT IS ON OFFER. Rolled once, here, from the walk record — so it is the
       set this walk would have handed over on its own, and her taps only decide
       WHICH of them he keeps. `walkOffer` ignores anything already picked, so
       this can never hand her own earlier taps back as a fresh offer. */
    const offer = game.walkOffer();
    items = buildItems(offer.finds || [], d, wp.active.seed || 1);

    on = true;
    ended = '';
    t = 0;
    dist = 0;
    dur = d;
    hintT = 0;
    sp.strollW.set(0);
    sp.strollW.to(1);
    return true;
  }

  /** lay the offered finds out along the road */
  function buildItems(finds, d, seed) {
    const n = finds.length;
    const out = [];
    for (let i = 0; i < n; i++) {
      const f = finds[i];
      /* WHEN he is level with it, spread across the middle of the beat. One
         find sits in the centre rather than at `passAt[0]`, or a short walk's
         single offer goes past in the first few seconds. */
      const u = n === 1
        ? (S.passAt[0] + S.passAt[1]) / 2
        : S.passAt[0] + (S.passAt[1] - S.passAt[0]) * (i / (n - 1));
      /* HOW NEAR THE CAMERA — STRATIFIED, not merely hashed.
         A plain hash per find is uniform ON AVERAGE and says nothing at all
         about any ONE walk: the first seed this was rendered with drew 0.99,
         0.93 and 0.96, i.e. three finds at the same distance, which is the one
         outcome that makes the depth work invisible. So the range is cut into
         `n` bands, each find gets a whole band, and the hash only jitters it
         WITHIN its band — variety by construction, and still identical on a
         reload because it is all off the walk's own seed. The band a find gets
         is rotated by the seed so the first thing she passes is not always the
         furthest away. */
      const k = (i + (seed % Math.max(1, n))) % n;
      const depth = lerp(S.depth[0], S.depth[1], (k + hash(i + seed % 97, 5.7)) / n);
      const y = reach.clampY(rig.floorV + lerp(S.bandY[0], S.bandY[1], depth), S.hitRy);
      out.push({
        id: f.id,
        at: u * d,
        depth,
        y,
        s: lerp(S.findScale[0], S.findScale[1], depth),
        drift: S.speed * motion * lerp(S.driftK[0], S.driftK[1], depth),
        x: -999,
        taken: false,
        pop: 0,
        fromX: 0, fromY: 0,
        life: hash(i, 19.1) * 6,   // so two daisies do not bob in lockstep
      });
    }
    return out;
  }

  /**
   * STOP WATCHING. `reason` is 'done' (it ran its course), 'left' (she tapped
   * the way out) or 'walk-over' (the walk itself finished underneath it, which
   * is the case that proves the stroll never holds the return up).
   *
   * It is idempotent, and it fades rather than cuts: the room comes back
   * underneath, and the absence wash is already on it by then.
   */
  function end(reason = 'done') {
    if (!on) return false;
    on = false;
    ended = reason;
    sp.strollW.to(0);
    onEnd(reason);
    return true;
  }

  /** tear it down with no fade and no hand-off — the scene is going away */
  function stop() {
    on = false;
    items = [];
    sp.strollW.set(0);
    tile = null;
    tileKey = '';
  }

  /* ================================================================== */
  /*  update                                                            */
  /* ================================================================== */
  function update(dt) {
    sp.strollW.step(dt);
    /* GIVE THE BITMAP BACK once it is off screen. A full-screen canvas on a 3x
       phone is ~14MB and iOS caps the total, so this one does not outlive the
       beat that opened it — the same rule scenes/room.js follows for the park
       and the ring bakes (§32.2). */
    if (!on && sp.strollW.x < 0.004 && tile) { tile = null; tileKey = ''; }
    if (!on) return;

    t += dt;
    hintT += dt;
    dist += S.speed * motion * dt;

    for (const it of items) {
      it.life += dt;
      /* WHERE IT IS: derived from the clock, never accumulated. He is standing
         still on the screen and the world is going past him, so a find that is
         level with him at `at` is `(t - at) * drift` to the right of him now —
         which is negative, i.e. still up the road, before that. */
      it.x = S.at + (t - it.at) * it.drift;
      if (it.taken && it.pop < 1) it.pop = Math.min(1, it.pop + dt / POP);
    }

    if (t >= dur) { end('done'); return; }

    /* AND IF THE WALK ITSELF FINISHED, GET OUT OF THE WAY. This is the guard
       that makes "the stroll is inside the walk" true rather than merely
       intended: a two-minute walk with a thirty-second stroll can only reach
       here if the clock was tampered with or the walk was very short, and in
       either case the return is more important than the scenery. */
    const wp = game.walkProgress();
    if (!wp.active || wp.done) end('walk-over');
  }

  /* ================================================================== */
  /*  input — a tap on something he is passing                          */
  /* ================================================================== */
  /**
   * THE HIT BOX IS A WINDOW, NOT A PIXEL TEST. A find drifting past at ~90
   * units/s with a 20-unit drawn radius is a dexterity test on a phone; `hitR`
   * is about seven tenths of a second of drift either side, which is the same
   * shape of answer as the disc's ±0.16s catch window rather than a bigger
   * circle bolted onto a small drawing.
   *
   * NEAREST WINS, so two finds overlapping never means the tap goes to whichever
   * happens to be earlier in the list.
   */
  function pointer(ev) {
    if (!on) return false;
    if (ev.type !== 'down') return true;      // it owns the surface while it is up

    const B = BALANCE.ui.map.back;
    if (Math.hypot(ev.x - B.x, ev.y - B.y) <= B.r + 12) { end('left'); return true; }

    let best = null, bd = Infinity;
    for (const it of items) {
      if (it.taken) continue;
      const dx = Math.abs(ev.x - it.x), dy = Math.abs(ev.y - it.y);
      if (dx > S.hitR || dy > S.hitRy) continue;
      /* normalised, so the box's two half-extents both mean "the edge" */
      const d = (dx / S.hitR) * (dx / S.hitR) + (dy / S.hitRy) * (dy / S.hitRy);
      if (d < bd) { bd = d; best = it; }
    }
    if (best) take(best);
    /* A MISS IS SILENT AND COSTS NOTHING. No sound, no penalty, no "you missed"
       — she is allowed to just touch the screen while she watches him walk. */
    return true;
  }

  /** he picks it up. The one place a pick is made, so the gate can drive taps. */
  function take(it) {
    if (!it || it.taken) return false;
    /* PERSISTED BEFORE ANYTHING ELSE HAPPENS. If this returns false the walk
       record would not keep it — the cap, or a duplicate — and pretending
       otherwise would show her a find that never comes home. */
    if (!game.walkPick(it.id)) return false;
    it.taken = true;
    it.pop = 0;
    it.fromX = it.x;
    it.fromY = it.y;
    sound('boop');
    const n = reduced ? 3 : 6;
    for (let i = 0; i < n; i++) {
      spawn('spark', it.x + (rng ? rng.range(-16, 16) : 0), it.y + (rng ? rng.range(-14, 10) : 0));
    }
    return true;
  }

  /* ================================================================== */
  /*  the bake                                                          */
  /* ================================================================== */
  /**
   * ONE TILE, EXACTLY ONE CANVAS WIDE.
   *
   * The strip is drawn across the virtual span that maps to device x 0..cw, so
   * the tile's period IS the canvas width in device pixels and wrapping is
   * `x` and `x - cw`. Baking it across the bleed instead (which is what the
   * room and the two outdoor places do) would have made the period WIDER than
   * the canvas that holds it, and the periodicity `drawStrip` was written for
   * would have been silently thrown away at the edges — a seam every few
   * seconds, from a tile that is genuinely seamless.
   */
  function ensureTile(view) {
    const key = [view.cw, view.ch, view.vs, view.offX, view.offY].join(':');
    if (tile && tileKey === key) return;
    const vLeft = -view.offX / view.vs;          // the virtual x of device x = 0
    const tileVW = view.cssW / view.vs;          // ...and how wide the canvas is
    const by = view.bleedY + 8;
    tile = makeOff(view.cw, view.ch);
    const c = tile.getContext('2d');
    c.setTransform(view.dpr * view.vs, 0, 0, view.dpr * view.vs,
      view.dpr * view.offX, view.dpr * view.offY);
    c.lineJoin = 'round'; c.lineCap = 'round';
    c.translate(vLeft, -by);
    drawStrip(c, tileVW, VH + by * 2, { floorY: FLOOR + by });
    tileKey = key;
    tileW = view.cw;
    /* the horizon in DEVICE pixels, rounded: the two planes are blitted as two
       source rects meeting on this line, and a fractional edge between them is
       a one-pixel band of whatever was underneath */
    horizon = Math.round((FLOOR * view.vs + view.offY) * view.dpr);
  }

  /* ================================================================== */
  /*  draw                                                              */
  /* ================================================================== */
  /** THE ROAD, under everything. Blitted in DEVICE space — it is a raster
      wrap, and doing it in virtual units would put the seam on a fractional
      pixel and shimmer it. */
  function drawBack(g) {
    const w = sp.strollW.x;
    if (w < 0.004) return;
    const c = g.ctx;
    ensureTile(g.view);
    if (!tile) return;
    const k = g.view.vs * g.view.dpr;
    /* ROUNDED TO WHOLE DEVICE PIXELS, and this is not tidiness.
       A fractional destination x makes `drawImage` RESAMPLE, so the two halves
       of the wrap no longer share an edge: the tile is seamless and the BLIT of
       it is not, and what you see is a soft one-pixel line sliding across the
       sky. The bake's own periodicity is asserted in pixels by
       `tools/strollgate.py`, which is why it was clear the remaining line had to
       be coming from here. Quantising the scroll to a device pixel at dpr 2-3
       costs nothing anybody can see. */
    const near = Math.round(mod(dist * k, tileW));
    const far = Math.round(mod(dist * farK * k, tileW));
    const lo = tileW > 0 ? tileW : 1;

    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = solid(w);
    /* the sky, the hills and the treeline */
    for (const dx of [far - lo, far]) {
      c.drawImage(tile, 0, 0, lo, horizon, dx, 0, lo, horizon);
    }
    /* ...and the ground he is walking on, going past faster */
    const gh = tile.height - horizon;
    if (gh > 0) {
      for (const dx of [near - lo, near]) {
        c.drawImage(tile, 0, horizon, lo, gh, dx, horizon, lo, gh);
      }
    }
    c.restore();
  }

  /**
   * THREE PASSES, AND THE MIDDLE ONE IS THE DOG.
   *
   *   1. the finds he has not reached — BEHIND him, because they are further up
   *      the grass than he is standing, and him passing in front of one is what
   *      makes it a thing he walked past rather than a sticker on the screen.
   *   2. him.
   *   3. what she has just taken — IN FRONT of him, and that is not symmetry,
   *      it is the fix for a real defect. A find passes at his own x, so the
   *      tap lands where he is: the first render had the pop, the arc and the
   *      sparks all drawn behind the dog, so she touched the one thing she was
   *      being asked to touch and the screen did nothing at all. A confirmation
   *      is the one thing that may never be occluded.
   */
  function drawFront(g) {
    const w = sp.strollW.x;
    if (w < 0.004) return;
    const c = g.ctx;
    const side = opts.side ? opts.side() : null;
    const a = solid(w);

    c.save();
    c.globalAlpha = a;
    for (const it of items) {
      if (it.taken || it.x < -60 || it.x > VW + 60) continue;
      drawOffered(c, it);
    }
    c.restore();

    if (side) {
      side.draw(g, {
        x: S.at,
        y: rig.floorV + S.groundY,
        s: rig.home.s * S.scale,
        face: -1,
        /* THE GAIT RUNS ON DISTANCE, not on time, or he moonwalks — the same
           rule (and the same stride) as the departure. */
        phase: dist / Math.max(1, S.stride),
        run: 1,
        alpha: a,
      });
    }

    c.save();
    c.globalAlpha = a;
    for (const it of items) {
      if (it.taken && it.pop < 1) drawTaken(c, it);
    }
    c.restore();
  }

  /** an untaken find: the ring under it is the whole affordance */
  function drawOffered(c, it) {
    const pulse = 0.5 + 0.5 * Math.sin(it.life * S.ringRate);
    const bob = Math.sin(it.life * 1.7) * 1.6;
    c.save();
    /* A SOFT RING ON THE GRASS, not a highlight on the find itself. It reads as
       "there is something here" from the far side of the screen, which is where
       she needs to read it — by the time a find is next to him she has less
       than a second left to decide. */
    c.globalAlpha = c.globalAlpha * (0.22 + 0.20 * pulse);
    c.strokeStyle = '#fff6dc';
    c.lineWidth = 2.0;
    c.beginPath();
    c.ellipse(it.x, it.y + 12 * it.s, S.ringR * it.s * (0.9 + 0.16 * pulse),
      S.ringR * 0.36 * it.s * (0.9 + 0.16 * pulse), 0, 0, TAU);
    c.stroke();
    c.restore();
    drawFind(c, it.id, it.x, it.y + bob, it.s, it.life);
  }

  /** ...and one she has tapped, on its way to his mouth */
  function drawTaken(c, it) {
    const u = smooth(clamp(it.pop, 0, 1));
    /* TO THE FRONT OF HIS HEAD. He is facing left, so that is left of him, and
       it is derived from where he is actually standing and how big he actually
       is rather than from two numbers that happen to look right at one scale. */
    const h = SIDE_H * rig.home.s * S.scale;
    const tx = S.at - h * 0.22, ty = rig.floorV + S.groundY - h * 0.62;
    const x = lerp(it.fromX, tx, u);
    const y = lerp(it.fromY, ty, u) - hump(u) * 34;
    /* A RING LEAVING THE SPOT IT CAME FROM. The room's own particle system is
       drawn BEFORE this layer (`drawParts` sits above `walk.drawFront` in
       scenes/room.js), so the sparks the tap spawns are behind the dog and
       cannot be relied on for the "got it" — this is the part that is always
       visible, and it is drawn where her finger actually was. */
    const ring = clamp(it.pop / 0.34, 0, 1);
    if (ring < 1) {
      c.save();
      c.globalAlpha = c.globalAlpha * (1 - ring) * 0.7;
      c.strokeStyle = '#fffaf0';
      c.lineWidth = 2.6 * (1 - ring * 0.6);
      c.beginPath();
      c.ellipse(it.fromX, it.fromY, 16 + ring * 46, (16 + ring * 46) * 0.42, 0, 0, TAU);
      c.stroke();
      c.restore();
    }
    c.save();
    c.globalAlpha = c.globalAlpha * (1 - u * u);
    const pop = it.pop < 0.28 ? easeOutBack(it.pop / 0.28, 2.4) : 1;
    drawFind(c, it.id, x, y, it.s * lerp(1.15, 0.55, u) * pop, it.life);
    c.restore();
  }

  /**
   * THE WAY OUT. The line of copy over it is dog/walk.js's — every player-facing
   * string in the walk lives in one `COPY` table and this file has none of them,
   * so it publishes `hintFade` and lets the owner of the words draw the words.
   */
  function drawOver(g) {
    const w = sp.strollW.x;
    if (!on || w < 0.2) return;
    const c = g.ctx;
    const B = BALANCE.ui.map.back;
    /* THE WAY OUT IS WHERE IT ALWAYS IS. The map's back button, the ring's
       "leave" and this are one place in the whole game, so "get me out of here"
       is never something she has to find. */
    c.save();
    c.globalAlpha = 0.85 * solid(w);
    c.fillStyle = 'rgba(255,248,232,0.88)';
    c.beginPath(); c.arc(B.x, B.y, B.r, 0, TAU); c.fill();
    c.strokeStyle = 'rgba(124,74,47,0.28)'; c.lineWidth = 1.3;
    c.beginPath(); c.arc(B.x, B.y, B.r, 0, TAU); c.stroke();
    c.strokeStyle = '#5d3018'; c.lineWidth = 2.2; c.lineCap = 'round';
    c.beginPath(); c.moveTo(B.x - 5, B.y - 5); c.lineTo(B.x + 5, B.y + 5); c.stroke();
    c.beginPath(); c.moveTo(B.x + 5, B.y - 5); c.lineTo(B.x - 5, B.y + 5); c.stroke();
    c.restore();
  }

  /**
   * HOW SOLIDLY THE ONE HINT SHOULD BE DRAWN, 0..1, and it goes to zero for
   * good after `hintFor` seconds — a line of instructions across a scene she is
   * meant to be WATCHING is the thing the explainer card exists to avoid
   * (ui/howto.js). It says it once and then gets out of the picture.
   */
  function hintFade() {
    if (!on || hintT >= S.hintFor) return 0;
    return clamp(hintT * 2.4, 0, 1)
      * clamp((S.hintFor - hintT) * 2.4, 0, 1)
      * solid(sp.strollW.x);
  }

  /* ================================================================== */
  /*  what the reachable-area assertion sees                            */
  /* ================================================================== */
  /**
   * The finds she can tap, reported LIVE ONLY while the nav could actually
   * steal the touch — which, during the stroll, it cannot: the beat is modal, so
   * `scenes/room.js` neither draws the bar nor hit-tests it, and `walk.owns`
   * hands the pointer here first. They are reported anyway, with `live: false`,
   * for the same reason the finds on the rug are: a tap target sliding under a
   * pill is a defect worth seeing even on the frame where nothing can go wrong.
   */
  function reachProbe() {
    if (!on) return [];
    const out = [];
    for (const it of items) {
      if (it.taken || it.x < -30 || it.x > VW + 30) continue;
      out.push({
        id: 'strollFind', state: it.id,
        x: it.x, y: it.y, rx: S.hitR, ry: S.hitRy, live: false,
      });
    }
    return out;
  }

  /* ================================================================== */
  return {
    get on() { return on; },
    /** true while any of the road is still on screen, fading in or out */
    get visible() { return on || sp.strollW.x > 0.004; },
    /** true once the road has all but replaced the room — the room's own props
        (the sill, the bowls, the ball, the dust) leave on this, exactly as they
        do for the park and the ring (§32.3) */
    get outdoors() { return sp.strollW.x > 0.5; },
    get weight() { return sp.strollW.x; },
    get picked() { return items.filter((i) => i.taken).map((i) => i.id); },
    get offered() { return items.map((i) => i.id); },

    begin, end, stop, update, pointer, take,
    drawBack, drawFront, drawOver, hintFade, reachProbe,

    /** verification hook: tap a find by index, without a pointer event */
    takeAt(i) { return take(items[i]); },

    get debug() {
      return {
        on, ended, t: +t.toFixed(2), dur: +dur.toFixed(2),
        w: +sp.strollW.x.toFixed(3), dist: Math.round(dist),
        tile: tile ? [tile.width, tile.height, horizon] : null,
        items: items.map((it) => ({
          id: it.id, at: +it.at.toFixed(2), x: Math.round(it.x), y: Math.round(it.y),
          depth: +it.depth.toFixed(2), taken: it.taken,
        })),
        picked: items.filter((i) => i.taken).map((i) => i.id),
      };
    },
  };
}

export default createStroll;
