/* ==========================================================================
   scenes/outdoors.js — THE TWO PLACES HE COMPETES IN.

   WHY THIS EXISTS. Both contests used to happen in the living room with the
   lights turned down: the trial put a mat and a spotlight on the rug, and the
   disc field dimmed the wall. The human's words, which are the whole brief:

     "when we change to disc we should change to a different background that
      shows outdoors. same goes for when we go the ring. this should then be a
      proper competition space and not the living room again"

   TWO PLACES, NOT ONE. A park is loose, sunlit and empty; a show ring is mown,
   roped and watched. Sharing one background between them would say that
   competing and playing are the same occasion, and the whole point of the trial
   is that it is an occasion.

   THREE RULES THESE SCENES OBEY
   -----------------------------
   1. THE FLOOR LINE DOES NOT MOVE. `BALANCE.view.floorY` is where the room's
      wall meets its floor, and it is what `rig.floorV`, the bowl's base, every
      planted paw and the reach line are all resolved against. The grass meets
      the sky on that exact line, so the dog stands in the park exactly where he
      stands in the room, and nothing about his placement, his shadow or the
      reachable play area changes. This is the one line in this file that is not
      allowed to be prettier.

   2. THE DOG IS NOT RELIT. His shading was tuned over eight stages and
      re-verified against the bowl, three breeds and every trick; a background
      change may not touch it. So there is no outdoor tint on him, deliberately,
      and the scenes are painted to sit under a warmly-lit dog rather than
      demanding he change.

   3. BAKED, LIKE THE ROOM. Drawn once into an offscreen canvas and blitted, so
      the per-frame cost is one `drawImage` — the same trick `scenes/room.js`
      uses and for the same reason.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import { TAU, ell, roundRect } from '../engine/draw.js';

const VW = BALANCE.view.W;
const VH = BALANCE.view.H;
const FLOOR = BALANCE.view.floorY;

/* ---- palettes. Scene art, not design tunables (ARCHITECTURE §11 G) ------
   Chosen against the room's own warmth rather than against a photograph: the
   room is #f9e9cd walls and #d59a62 boards, so an outdoor green that is too
   cold makes the dog look pasted on. These greens are yellow-leaning for that
   reason, and the sky is the same blue the window already shows. */
const PARK = {
  skyTop: '#a8d3e8', skyLow: '#d8ecf2',
  hillFar: '#b9d3b0', hillNear: '#9dc394',
  treeDark: '#6f9a6a', treeLight: '#84ac74',
  grassTop: '#8fbb6f', grassMid: '#7fae62', grassLow: '#6b9a52',
  mown: 'rgba(255,255,255,0.10)',
  daisy: '#fdf6e6', daisyEye: '#f0c95c',
  sun: 'rgba(255,246,214,0.34)',
};
const RING = {
  skyTop: '#9ecbe4', skyLow: '#dbeaf0',
  hillFar: '#bcd2b4', hillNear: '#a3c398',
  treeDark: '#6b9668', treeLight: '#80a873',
  grassTop: '#93bd74', grassMid: '#82b064', grassLow: '#6d9a54',
  /* the mown stripes a show ring is always cut into — this is the single
     strongest cue that a patch of grass is a RING and not a field */
  stripe: 'rgba(255,255,255,0.075)',
  post: '#e8dcc2', postSh: '#c9b795',
  rope: '#d8c9a6',
  buntA: '#cf6e58', buntB: '#f3e0c2', buntC: '#87a89c', buntD: '#e0b06a',
  /* NO MAT COLOUR HERE. dog/contest.js owns the mat — it fades with the trial's
     own spring and has to match the card and the ribbon — and this file draws
     only the trodden ground under it. Three mat colours sat here until the ring
     was rendered and it became obvious that two files painting one mat is one
     file too many. */
  /* the crowd on the far side of the rope: four muted clothes and one head
     tone, drawn soft and translucent. Never faces — a row of faces at this size
     is a smear, and a row of soft shapes is a crowd. */
  wear: ['#7d8a9c', '#9c8b7d', '#8a9c85', '#a3909c'],
  skin: 'rgba(90,78,68,0.62)',
};

/* ==========================================================================
   THE OTHER THREE ROADS (8.31.0).

   She has picked park / high street / river / woods on the map since stage 4,
   and the pick has always been real: `state/walks.js` blends a per-route weight
   into every find, so the woods really do hand back pinecones and the high
   street really does drop coins. What she SAW was the same stretch of grass
   every time — one `drawStrip`, one palette, four names. The choice was honest
   in the loot and invisible in the world.

   EACH PALETTE IS TAKEN FROM THE MAP SHE CHOSE IT ON. `ui/routemap.js` already
   draws four little places on the paper — the park has round trees and a bench,
   the high street has awnings over shopfronts and a lamp post, the river has a
   wooden bridge and reeds, the woods have conifers and a mushroom. Inventing a
   second visual language for the same four words would mean the map promised
   one thing and the road delivered another, so the strips quote the map: the
   same greens, the same awning colours, the same firs.

   AND THEY ARE ALL YELLOW-LEANING, for the reason PARK's note gives above: the
   dog is not relit out here either, so a road too cold makes him look pasted on.
   The high street is the hardest of the three for that reason — a real pavement
   is grey, and grey is exactly what a warm dog cannot stand on — so its stone
   is a warm sand rather than concrete.
   ========================================================================== */
const WOODS = {
  skyTop: '#9fbcc8', skyLow: '#c9d8c2',
  hillFar: '#9db08f', hillNear: '#7f9670',
  firDark: '#40603f', firMid: '#4f7349', firLight: '#628a55',
  trunk: '#6b4a2e',
  grassTop: '#6d8a52', grassMid: '#5c7845', grassLow: '#4b663a',
  /* the track winding in, which is the woods' equivalent of the mown band */
  track: 'rgba(198,168,118,0.50)',
  fern: 'rgba(52,78,42,0.55)',
  shroomCap: '#c25b46', shroomStem: '#f3e6cd',
};
const HIGH = {
  skyTop: '#b6cfe0', skyLow: '#e8e0cf',
  /* three brick tones so a terrace is a TERRACE and not one long building */
  brickA: '#c98f6e', brickB: '#b4806b', brickC: '#d3a179',
  brickD: '#9c6a4c',
  roof: '#8a6656',
  pane: '#9ec4cd', paneLit: '#f2d9a0',
  /* the awnings are `routemap`'s own two, plus the garland's gold */
  awnA: '#cf6e58', awnB: '#87a89c', awnC: '#e0b06a',
  /* WARM STONE, NOT CONCRETE. See the note above — a grey pavement is the one
     surface in this game a warmly-lit dog cannot stand on. */
  paveTop: '#d3c6ae', paveMid: '#c6b8a0', paveLow: '#b6a88f',
  joint: 'rgba(122,102,78,0.26)',
  kerb: '#e2d7c2',
  lamp: '#7c6a54', lampGlass: '#f6e2a8',
};
const RIVER = {
  skyTop: '#a8d3e8', skyLow: '#dcecea',
  hillFar: '#b0c9a6', hillNear: '#93b489',
  treeDark: '#6f9a6a', treeLight: '#84ac74',
  /* the far bank, then the water, then the towpath he is actually walking on */
  farBank: '#8aa87c',
  water: '#7fb0c4', waterD: '#6a9ab2', waterHi: 'rgba(255,255,255,0.45)',
  pathTop: '#c9b48e', pathMid: '#bda882', pathLow: '#a89370',
  grassTop: '#8fbb6f', grassMid: '#7da85f', grassLow: '#6b9a52',
  reed: '#5f7f4a', reedHead: '#9a7a4a',
};

/* ---- shared ground ----------------------------------------------------- */
/**
 * Sky, hills, a treeline and grass, meeting at `FLOOR`.
 *
 * `x0`/`x1` come from the view's bleed, exactly as the room's do: the canvas is
 * wider than the design width so a device with a different aspect has something
 * to show at the edges rather than a seam.
 */
function ground(c, P, x0, x1, by, phase) {
  const w = x1 - x0;
  /* sky */
  const sky = c.createLinearGradient(0, -by, 0, FLOOR);
  sky.addColorStop(0, P.skyTop);
  sky.addColorStop(1, P.skyLow);
  c.fillStyle = sky;
  c.fillRect(x0, -by, w, FLOOR + by);

  /* CLOUDS, AND THEY ARE NOT DECORATION. Two thirds of both places is sky, and
     an empty gradient gave the disc nothing to climb past — a throw rising 400
     units through flat blue reads as a disc shrinking, not a disc going up.
     `phase` moves them, so the park's sky is not the ring's sky.

     ONE PATH PER CLOUD, FILLED ONCE, AND NOT THROUGH `ell`. Four separate
     translucent ellipses darkened along every overlap and read as a stack of
     lenses; `ell` cannot be used to union them either, because it opens its own
     path — the first attempt at a union silently kept only the last lobe and put
     five white lozenges in the sky. So `c.ellipse` directly, one `beginPath`,
     one `fill`: a flat cloud with no seams. */
  for (let i = 0; i < 5; i++) {
    const cx = x0 + w * ((i + 0.5) / 5 + Math.sin(phase + i * 2.2) * 0.06);
    const cy = 84 + Math.abs(Math.sin(phase * 1.5 + i * 1.9)) * 130;
    const r = 40 + Math.sin(phase + i * 1.1) * 13;
    c.save();
    c.globalAlpha = 0.55;
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.ellipse(cx, cy, r * 1.55, r * 0.46, 0, 0, TAU);
    c.ellipse(cx - r * 0.62, cy - r * 0.16, r * 0.66, r * 0.42, 0, 0, TAU);
    c.ellipse(cx + r * 0.28, cy - r * 0.34, r * 0.82, r * 0.56, 0, 0, TAU);
    c.ellipse(cx + r * 1.00, cy - r * 0.06, r * 0.54, r * 0.34, 0, 0, TAU);
    c.fill();
    c.restore();
  }

  /* two hill bands, the far one paler — aerial perspective, one line each */
  /* SAMPLED EVERY 8 UNITS, not every 26. At 26 the polyline's flat segments were
     visible as facets along the skyline — a hill made of five straight lines
     reads as a paper cut-out. `phase` shifts both harmonics, so the park and the
     ring are not the same hills with different furniture on them. */
  c.fillStyle = P.hillFar;
  c.beginPath();
  c.moveTo(x0, FLOOR - 96);
  for (let x = x0; x <= x1; x += 8) {
    c.lineTo(x, FLOOR - 96 - Math.sin(phase + x * 0.008) * 26 - Math.sin(phase * 2 + x * 0.021) * 9);
  }
  c.lineTo(x1, FLOOR); c.lineTo(x0, FLOOR); c.closePath(); c.fill();
  c.fillStyle = P.hillNear;
  c.beginPath();
  c.moveTo(x0, FLOOR - 54);
  for (let x = x0; x <= x1; x += 8) {
    c.lineTo(x, FLOOR - 54 - Math.sin(1.7 + phase + x * 0.011) * 17 - Math.sin(phase + x * 0.027) * 6);
  }
  c.lineTo(x1, FLOOR); c.lineTo(x0, FLOOR); c.closePath(); c.fill();

  /* a treeline: rounded clumps, two tones, sitting ON the horizon */
  for (let i = 0; i < 26; i++) {
    const x = x0 + (i + 0.5) * (w / 26) + Math.sin(phase + i * 2.7) * 7;
    const r = 21 + Math.sin(phase + i * 1.3) * 7;
    const y = FLOOR - 34 + Math.sin(phase * 3 + i * 0.9) * 4;
    c.fillStyle = i % 3 === 0 ? P.treeLight : P.treeDark;
    ell(c, x, y, r, r * 0.74); c.fill();
    c.fillStyle = i % 3 === 0 ? P.treeDark : P.treeLight;
    ell(c, x - r * 0.3, y - r * 0.24, r * 0.52, r * 0.40); c.fill();
  }

  /* grass, and the line it meets the sky on is FLOOR exactly */
  const gr = c.createLinearGradient(0, FLOOR, 0, VH + by);
  gr.addColorStop(0, P.grassTop);
  gr.addColorStop(0.42, P.grassMid);
  gr.addColorStop(1, P.grassLow);
  c.fillStyle = gr;
  c.fillRect(x0, FLOOR, w, VH + by - FLOOR);
}

/** little tufts, so the grass is not a flat wash where he stands */
function tufts(c, x0, x1, seedRng, tint) {
  c.strokeStyle = tint;
  c.lineWidth = 1.6;
  c.lineCap = 'round';
  for (let i = 0; i < 150; i++) {
    const x = x0 + seedRng.next() * (x1 - x0);
    const y = FLOOR + 8 + seedRng.next() * (VH - FLOOR - 8);
    const h = 4 + (y - FLOOR) / (VH - FLOOR) * 7;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + (seedRng.next() - 0.5) * 3, y - h);
    c.stroke();
  }
}

/* ==========================================================================
   THE PARK — where the disc game happens.

   Loose and empty: no rope, no mat, nothing to perform on. The one piece of
   furniture is a mown band across the middle distance, which does the same job
   the room's rug does — it tells the eye where the ground he is standing on is.
   ========================================================================== */
export function drawPark(c, view, rng) {
  const bx = view.bleedX + 8, by = view.bleedY + 8;
  const x0 = -bx, x1 = VW + bx;
  ground(c, PARK, x0, x1, by, 0);

  /* a lighter mown band, wide and low, as the ground he plays on */
  c.save();
  c.fillStyle = PARK.mown;
  c.beginPath();
  ell(c, VW / 2, FLOOR + 190, (x1 - x0) * 0.62, 128);
  c.fill();
  c.restore();

  tufts(c, x0, x1, rng, 'rgba(74,104,58,0.30)');

  /* daisies, sparse and only in the near half, because detail in the distance
     reads as noise at this size */
  for (let i = 0; i < 16; i++) {
    const x = x0 + rng.next() * (x1 - x0);
    const y = FLOOR + 90 + rng.next() * (VH - FLOOR - 90);
    const s = 0.7 + rng.next() * 0.5;
    c.fillStyle = PARK.daisy;
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU;
      ell(c, x + Math.cos(a) * 3.1 * s, y + Math.sin(a) * 3.1 * s, 2.1 * s, 1.7 * s, a); c.fill();
    }
    c.fillStyle = PARK.daisyEye;
    ell(c, x, y, 1.5 * s, 1.3 * s); c.fill();
  }

  /* the sun, from the opposite side to the room's window, so the two places do
     not read as the same light */
  const sg = c.createRadialGradient(VW * 0.16, 96, 10, VW * 0.16, 96, 300);
  sg.addColorStop(0, PARK.sun);
  sg.addColorStop(1, 'rgba(255,246,214,0)');
  c.fillStyle = sg;
  c.fillRect(x0, -by, x1 - x0, FLOOR + 200);
}

/* ==========================================================================
   THE SHOW RING — where the obedience trial happens.

   Everything here says "this is being judged": the grass is cut in stripes, the
   ring is roped off with posts, there is bunting, there is a mat to perform on,
   and there are people watching (implied, never drawn as faces — a crowd of
   faces at this size is a smear, and a row of soft shapes is a crowd).
   ========================================================================== */
export function drawRing(c, view, rng) {
  const bx = view.bleedX + 8, by = view.bleedY + 8;
  const x0 = -bx, x1 = VW + bx;
  ground(c, RING, x0, x1, by, 2.05);

  /* THE CROWD, on the far side of the rope: soft overlapping shapes at the
     horizon. Deliberately faceless and deliberately low-contrast — they are the
     reason it is an occasion, not something to look at. */
  /* THEY WERE INVISIBLE AT FIRST TRY. Thirty-four green-grey shapes at 0.30 over
     a green treeline is a crowd nobody can see, which is a crowd that isn't
     doing its one job. So: they stand ON the horizon rather than above it, they
     are a head taller, and they wear four muted colours — a real crowd is
     colourful even at a hundred metres. Still faceless, still soft-edged, still
     nothing to look at. */
  for (let i = 0; i < 34; i++) {
    const x = x0 + (i + 0.5) * ((x1 - x0) / 34) + Math.sin(i * 3.1) * 6;
    const h = 24 + Math.sin(i * 1.7) * 6;
    const feet = FLOOR + 2 + Math.sin(i * 0.7) * 2;
    c.globalAlpha = 0.42;
    c.fillStyle = RING.wear[i % RING.wear.length];
    ell(c, x, feet - h * 0.34, 7.2, h * 0.42); c.fill();
    c.fillStyle = RING.skin;
    c.beginPath(); c.arc(x, feet - h * 0.86, 4.4, 0, TAU); c.fill();
    c.globalAlpha = 1;
  }

  /* MOWN STRIPES, converging slightly, which is what makes it a ring rather
     than a lawn. Drawn as wedges from the horizon so they read as perspective
     without anything here knowing what perspective is. */
  c.save();
  c.beginPath();
  c.rect(x0, FLOOR, x1 - x0, VH + by - FLOOR);
  c.clip();
  for (let i = -7; i <= 7; i += 2) {
    c.fillStyle = RING.stripe;
    c.beginPath();
    c.moveTo(VW / 2 + i * 26, FLOOR);
    c.lineTo(VW / 2 + (i + 1) * 26, FLOOR);
    c.lineTo(VW / 2 + (i + 1) * 96, VH + by);
    c.lineTo(VW / 2 + i * 96, VH + by);
    c.closePath();
    c.fill();
  }
  c.restore();

  tufts(c, x0, x1, rng, 'rgba(64,96,50,0.26)');

  /* THE ROPE, on posts, running across just below the horizon. It is what puts
     him INSIDE something. */
  const ropeY = FLOOR + 26;
  const posts = [];
  for (let x = x0 + 18; x <= x1; x += 96) posts.push(x);
  c.strokeStyle = RING.rope;
  c.lineWidth = 2.4;
  c.lineCap = 'round';
  for (let i = 0; i < posts.length - 1; i++) {
    const a = posts[i], b = posts[i + 1];
    c.beginPath();
    c.moveTo(a, ropeY);
    /* a real sag between each pair, or it reads as a drawn line */
    c.quadraticCurveTo((a + b) / 2, ropeY + 9, b, ropeY);
    c.stroke();
  }
  for (const x of posts) {
    c.fillStyle = RING.postSh;
    roundRect(c, x - 3, ropeY - 4, 6, 34, 3); c.fill();
    c.fillStyle = RING.post;
    roundRect(c, x - 3, ropeY - 6, 5, 32, 2.5); c.fill();
  }

  /* BUNTING above it, the same paper the room's garland is made of — she has
     seen these flags before, which is what makes the place feel like hers. */
  const buntY = FLOOR - 78;
  const cols = [RING.buntA, RING.buntB, RING.buntC, RING.buntD];
  c.strokeStyle = 'rgba(120,74,44,0.30)';
  c.lineWidth = 1.4;
  c.beginPath();
  for (let i = 0; i <= 40; i++) {
    const u = i / 40;
    const x = x0 + (x1 - x0) * u;
    const y = buntY + Math.sin(u * Math.PI) * -18 + 18;
    if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
  }
  c.stroke();
  for (let i = 0; i < 16; i++) {
    const u = (i + 0.5) / 16;
    const x = x0 + (x1 - x0) * u;
    const y = buntY + Math.sin(u * Math.PI) * -18 + 18;
    c.fillStyle = cols[i % cols.length];
    c.beginPath();
    c.moveTo(x - 6.5, y); c.lineTo(x + 6.5, y); c.lineTo(x, y + 13);
    c.closePath(); c.fill();
  }

  /* THE MAT he performs on. The trial already draws its own mat in
     `dog/contest.js`, so this is the ground UNDER it — a slightly worn patch,
     which is what a ring floor looks like by the third class of the day. */
  c.save();
  c.globalAlpha = 0.5;
  c.fillStyle = 'rgba(255,246,214,0.20)';
  ell(c, VW / 2, FLOOR + 176, 196, 104); c.fill();
  c.restore();
}



/* ==========================================================================
   THE STROLL STRIP — the park as a SEAMLESS TILE, for a walk you can watch.

   Asked for directly: "cant we now not use the side profile to have an actual
   walk instead of just sending the dogs away?"

   WHY THIS IS A DIFFERENT FUNCTION AND NOT `drawPark` WITH AN OFFSET. `drawPark`
   is baked once at screen width and blitted; every shape in it is placed by
   ABSOLUTE x — hills at `sin(x * 0.008)`, clumps at `i * (w / 26)`, tufts at
   random x. Scrolling that means either redrawing 26 clumps and 150 tufts every
   frame (the most expensive thing in the game, per §32.2 rule 3) or tiling a bake
   whose left and right edges do not match, which is a visible seam sliding past
   every few seconds.

   So this is periodic BY CONSTRUCTION: every wave is a function of `u = x / w`
   with a WHOLE NUMBER of cycles, and every scattered thing is placed at a hashed
   `u` and drawn again one tile to the right when it would straddle the join. Draw
   it twice, offset by `w`, and there is no seam to find.

   It is deliberately NOT the same picture as `drawPark`: a strolling dog passes
   things, so this has more of them, and the mown ellipse and the single sun that
   anchor a static scene are gone.

   THE HORIZON IS A CLEAN CUT, BY CONSTRUCTION. The grass is a full-width
   `fillRect` from `floorY` down and it is drawn AFTER the hills and the
   treeline, so no shape survives across the line however the clumps happen to
   be hashed. A caller wanting two parallax planes can therefore blit the two
   halves of ONE bake at two different rates with nothing to cut in half — which
   is the whole reason `dog/stroll.js` needs one canvas rather than two, and it
   is why this note is here rather than there.

   FOUR ROADS, ONE FUNCTION (8.31.0). `o.place` is the route she drew, and it is
   the ONLY thing that varies: every road obeys the same two structural rules,
   because both of them are load-bearing for the blit rather than for the look.

     1. PERIODIC BY CONSTRUCTION. Waves are `sin(TAU * k * u)` with a whole `k`;
        anything scattered sits at a hashed `u` and is drawn again one tile over
        when it straddles the join. `strollgate` asserts the join is an ordinary
        pixel column, per place, because "it looked fine" is what shipped a seam
        the first time.
     2. NOTHING CROSSES THE HORIZON. The ground is a full-width fill from
        `floor` down, drawn after everything above it. This is why the high
        street's lamp posts stand ON the horizon rather than in front of it, and
        why the river's near reeds start below it: a shape spanning the line
        would be cut in half and its two halves would then scroll at different
        speeds, which is the one artefact the two-plane blit cannot survive.

   THE PARK IS UNTOUCHED. It is the road every walk has shown since 8.22.0, so
   it is byte-for-byte what it was and the three new ones are new code.
   ========================================================================== */
const STRIP_PAL = { park: PARK, woods: WOODS, high: HIGH, river: RIVER, ring: RING };

export function drawStrip(c, w, h, o = {}) {
  const place = STRIP_PAL[o.place] ? o.place : (o.palette === 'ring' ? 'ring' : 'park');
  if (place === 'woods') return stripWoods(c, w, h, o);
  if (place === 'high') return stripHigh(c, w, h, o);
  if (place === 'river') return stripRiver(c, w, h, o);
  return stripPark(c, w, h, o);
}

/** the deterministic hash every road places its scatter at */
const shash = (i, s) => {
  const v = Math.sin((i + 1) * 12.9898 + s * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

/**
 * A WAVE THAT CLOSES ON ITSELF, filled down to `floor`. Shared because the seam
 * rule is shared: `k1`/`k2` are whole numbers of cycles across the tile, and the
 * polyline is sampled in a whole number of STEPS so a sample lands on u = 1
 * exactly. Stepping `x += 6` instead is what once cut a thin triangular notch
 * out of the skyline at any tile width that was not a multiple of six.
 */
function ridge(c, w, floor, yAt, amp, k1, k2, fill) {
  const N = Math.max(24, Math.ceil(w / 6));
  c.fillStyle = fill;
  c.beginPath();
  c.moveTo(0, floor);
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const y = yAt - Math.sin(TAU * k1 * u) * amp - Math.sin(TAU * k2 * u + 1.7) * amp * 0.36;
    c.lineTo(u * w, y);
  }
  c.lineTo(w, floor); c.closePath(); c.fill();
}

/** the vertical gradient every road's ground is filled with */
function groundFill(c, w, h, floor, top, mid, low) {
  const gr = c.createLinearGradient(0, floor, 0, h);
  gr.addColorStop(0, top);
  gr.addColorStop(0.42, mid);
  gr.addColorStop(1, low);
  c.fillStyle = gr;
  c.fillRect(0, floor, w, h - floor);
}

/**
 * CLOUDS, HASHED AND WRAPPED — lifted verbatim out of the park strip so the
 * other three roads can have a sky too. The park's was the only one, which made
 * the river in particular look like an unfinished page: two thirds of that
 * screen is sky and there was nothing in it.
 *
 * The wrap is the whole point and it is the bug this file already paid for
 * once: a cloud straddling the join used to be CLIPPED, so a tile that was
 * seamless everywhere else showed a hard vertical line down two thirds of the
 * screen, sliding past every few seconds. Each lobe reaches 1.55r from centre,
 * hence the 2.4r cull.
 */
function stripClouds(c, w, floor, n, alpha) {
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n + (shash(i, 3.1) - 0.5) * 0.08;
    const cy = floor * (0.10 + shash(i, 7.7) * 0.42);
    const r = floor * (0.055 + shash(i, 11.3) * 0.03);
    for (const dx of [0, w, -w]) {
      const cx = u * w + dx;
      if (cx < -r * 2.4 || cx > w + r * 2.4) continue;
      c.save();
      c.globalAlpha = alpha;
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.ellipse(cx, cy, r * 1.55, r * 0.46, 0, 0, TAU);
      c.ellipse(cx - r * 0.62, cy - r * 0.16, r * 0.66, r * 0.42, 0, 0, TAU);
      c.ellipse(cx + r * 0.28, cy - r * 0.34, r * 0.82, r * 0.56, 0, 0, TAU);
      c.fill();
      c.restore();
    }
  }
}

/** the sky every road starts with */
function skyFill(c, w, floor, top, low) {
  const sky = c.createLinearGradient(0, 0, 0, floor);
  sky.addColorStop(0, top);
  sky.addColorStop(1, low);
  c.fillStyle = sky;
  c.fillRect(0, 0, w, floor);
}

/**
 * WHAT TIME IT IS, OUT HERE (8.31.0). The room learned the hour in 8.30.0 and
 * the road did not, so an evening walk went down a midday street — which was
 * immediately the most obviously wrong thing in the game.
 *
 * It is a wash and NOT the room's treatment, deliberately. Indoors the light
 * had to reach the art because a sunbeam has to be able to be absent; out here
 * there is no sunbeam to remove, so the cheap thing is the right thing. Applied
 * to the whole tile at the end, INSIDE the bake, so it costs nothing per frame.
 *
 * The dog is not relit out here either (§32 rule 2), which is why `dim` is
 * capped well below the room's: he is 250 units of a 844-unit screen out here
 * and a dark road under a bright dog reads worse than a merely dusky one.
 */
function stripLight(c, w, h, o) {
  const L = o.light;
  if (!L || !(L.dim > 0.004)) return;
  c.save();
  c.globalAlpha = Math.min(L.dim, 0.30);
  c.fillStyle = '#241d3a';
  c.fillRect(0, 0, w, h);
  c.restore();
}

function stripPark(c, w, h, o = {}) {
  const P = PARK;
  const floor = o.floorY === undefined ? h * 0.62 : o.floorY;
  const hash = (i, s) => {
    const v = Math.sin((i + 1) * 12.9898 + s * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };

  /* sky */
  const sky = c.createLinearGradient(0, 0, 0, floor);
  sky.addColorStop(0, P.skyTop);
  sky.addColorStop(1, P.skyLow);
  c.fillStyle = sky;
  c.fillRect(0, 0, w, floor);

  /* CLOUDS: hashed u, so the same tile always has the same sky — AND WRAPPED,
     which they were not.
     This is the one thing in here that was periodic by construction everywhere
     except in the piece with the most sky behind it. Every wave closes on itself
     and every tree clump is redrawn one tile over, but a cloud straddling the
     join was simply CLIPPED — so the first stroll rendered with a hard vertical
     line down two thirds of the screen, sliding past every few seconds, from a
     tile that was otherwise perfectly seamless. It cost nothing to find and it
     was invisible in the static review shots the tile was signed off on
     (`review/stroll-0..3.png` put the join over GRASS). */
  stripClouds(c, w, floor, 7, 0.5);

  /* TWO HILL BANDS, as whole numbers of cycles across the tile. That is the
     entire seam trick: sin(2*PI*k*u) closes on itself at u = 1. */
  /* SAMPLED IN A WHOLE NUMBER OF STEPS, NOT EVERY 6 UNITS. `x += 6` only lands
     on `w` when the tile happens to be a multiple of 6: at any other width the
     last sample fell short and the closing `lineTo(w, floor)` cut a thin
     triangular NOTCH out of the skyline at the right-hand edge — a seam that
     appeared and disappeared with the device's width, which is the worst kind.
     Stepping `i / N` puts a sample on u = 1 exactly, where the wave closes. */
  const band = (yAt, amp, k1, k2, fill) => {
    const N = Math.max(24, Math.ceil(w / 6));
    c.fillStyle = fill;
    c.beginPath();
    c.moveTo(0, floor);
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const y = yAt - Math.sin(TAU * k1 * u) * amp - Math.sin(TAU * k2 * u + 1.7) * amp * 0.36;
      c.lineTo(u * w, y);
    }
    c.lineTo(w, floor); c.closePath(); c.fill();
  };
  band(floor - h * 0.13, h * 0.035, 2, 5, P.hillFar);
  band(floor - h * 0.07, h * 0.022, 3, 7, P.hillNear);

  /* the treeline: clumps at hashed u, redrawn one tile over when they straddle */
  const trees = Math.max(8, Math.round(w / 68));
  for (let i = 0; i < trees; i++) {
    const u = (i + 0.5) / trees + (hash(i, 2.7) - 0.5) * 0.5 / trees;
    const r = h * (0.026 + hash(i, 5.5) * 0.012);
    const y = floor - h * 0.045 + (hash(i, 9.1) - 0.5) * h * 0.012;
    for (const dx of [0, w, -w]) {
      const x = u * w + dx;
      if (x < -r * 2 || x > w + r * 2) continue;
      c.fillStyle = i % 3 === 0 ? P.treeLight : P.treeDark;
      ell(c, x, y, r * 1.3, r * 0.96); c.fill();
      c.fillStyle = i % 3 === 0 ? P.treeDark : P.treeLight;
      ell(c, x - r * 0.4, y - r * 0.3, r * 0.66, r * 0.5); c.fill();
    }
  }

  /* grass */
  const gr = c.createLinearGradient(0, floor, 0, h);
  gr.addColorStop(0, P.grassTop);
  gr.addColorStop(0.42, P.grassMid);
  gr.addColorStop(1, P.grassLow);
  c.fillStyle = gr;
  c.fillRect(0, floor, w, h - floor);

  /* TUFTS AND DAISIES, hashed so the tile is stable and WRAPPED so the join
     hides — which the comment claimed and the code did not do. Both sat at a
     hashed x and were drawn once, so one straddling the edge was clipped in half
     and its other half never appeared on the far side. A half daisy is small;
     it is also exactly the kind of small that the eye finds instantly once it is
     sliding past every few seconds. */
  c.strokeStyle = 'rgba(74,104,58,0.30)';
  c.lineWidth = 1.6; c.lineCap = 'round';
  const n = Math.max(30, Math.round(w / 9));
  for (let i = 0; i < n; i++) {
    const hx = hash(i, 17.3) * w;
    const y = floor + 6 + hash(i, 23.9) * (h - floor - 8);
    const len = 4 + (y - floor) / (h - floor) * 8;
    const lean = (hash(i, 31.1) - 0.5) * 3;
    for (const dx of [0, w, -w]) {
      const x = hx + dx;
      if (x < -6 || x > w + 6) continue;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + lean, y - len);
      c.stroke();
    }
  }
  for (let i = 0; i < Math.round(n / 7); i++) {
    const hx = hash(i, 41.7) * w;
    const y = floor + (h - floor) * (0.35 + hash(i, 43.3) * 0.6);
    const s = 0.8 + hash(i, 47.1) * 0.5;
    for (const dx of [0, w, -w]) {
      const x = hx + dx;
      if (x < -7 * s || x > w + 7 * s) continue;
      c.fillStyle = PARK.daisy;
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU;
        ell(c, x + Math.cos(a) * 3.1 * s, y + Math.sin(a) * 3.1 * s, 2.1 * s, 1.7 * s, a);
        c.fill();
      }
      c.fillStyle = PARK.daisyEye;
      ell(c, x, y, 1.5 * s, 1.3 * s); c.fill();
    }
  }
  stripLight(c, w, h, o);
}

/* ==========================================================================
   THE WOODS — the darkest road, and the one that reads fastest.

   A CONIFER WALL INSTEAD OF ROUND CLUMPS, which is the whole silhouette
   difference: the park's treeline is a row of soft ellipses and this is a row
   of triangles, so the two are told apart at a glance and at speed. Two rows of
   them, the far one paler and shorter, because one row of firs is a fence.
   ========================================================================== */
function stripWoods(c, w, h, o = {}) {
  const P = WOODS;
  const floor = o.floorY === undefined ? h * 0.62 : o.floorY;

  skyFill(c, w, floor, P.skyTop, P.skyLow);
  /* fewer and fainter than the park's: most of this sky ends up behind firs */
  stripClouds(c, w, floor, 5, 0.34);
  ridge(c, w, floor, floor - h * 0.12, h * 0.030, 2, 5, P.hillFar);
  ridge(c, w, floor, floor - h * 0.07, h * 0.020, 3, 7, P.hillNear);

  /* TWO ROWS OF FIRS, hashed and wrapped. Their bases sit ON `floor` so the
     ground fill below covers the join — nothing crosses the horizon. */
  const fir = (count, seed, scale, dark, light, baseLift) => {
    const n = Math.max(6, Math.round(w / count));
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n + (shash(i, seed) - 0.5) * 0.7 / n;
      const hh = h * scale * (0.82 + shash(i, seed + 3.3) * 0.42);
      const halfW = hh * 0.34;
      const base = floor + baseLift;
      for (const dx of [0, w, -w]) {
        const x = u * w + dx;
        if (x < -halfW * 2 || x > w + halfW * 2) continue;
        c.fillStyle = i % 3 === 0 ? light : dark;
        /* three stacked tiers, the routemap's own fir shape */
        for (let t = 0; t < 3; t++) {
          const ty = base - (hh * 0.30) * t;
          const tw = halfW * (1 - t * 0.24);
          c.beginPath();
          c.moveTo(x, ty - hh * 0.52);
          c.lineTo(x + tw, ty);
          c.lineTo(x - tw, ty);
          c.closePath(); c.fill();
        }
      }
    }
  };
  fir(58, 2.7, 0.085, P.firDark, P.firMid, -h * 0.020);
  fir(44, 6.1, 0.115, P.firMid, P.firLight, 0);

  groundFill(c, w, h, floor, P.grassTop, P.grassMid, P.grassLow);

  /* THE TRACK he is walking on — a soft band across the near ground, which is
     what the mown ellipse does for the park: it tells the eye where the floor
     is. Periodic because it is a straight band with a wave on its edges. */
  c.save();
  c.beginPath();
  const tTop = floor + (h - floor) * 0.34;
  const tBot = floor + (h - floor) * 0.86;
  const N = Math.max(24, Math.ceil(w / 6));
  c.moveTo(0, tTop);
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    c.lineTo(u * w, tTop + Math.sin(TAU * 2 * u) * (h - floor) * 0.030);
  }
  for (let i = N; i >= 0; i--) {
    const u = i / N;
    c.lineTo(u * w, tBot + Math.sin(TAU * 3 * u + 1.1) * (h - floor) * 0.026);
  }
  c.closePath();
  c.fillStyle = P.track; c.fill();
  c.restore();

  /* ferns along the track, and the occasional mushroom */
  c.strokeStyle = P.fern; c.lineWidth = 1.8; c.lineCap = 'round';
  const nf = Math.max(26, Math.round(w / 11));
  for (let i = 0; i < nf; i++) {
    const hx = shash(i, 17.3) * w;
    const y = floor + 8 + shash(i, 23.9) * (h - floor - 10);
    const len = 5 + (y - floor) / (h - floor) * 9;
    for (const dx of [0, w, -w]) {
      const x = hx + dx;
      if (x < -8 || x > w + 8) continue;
      for (let k = -1; k <= 1; k++) {
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + k * len * 0.5, y - len);
        c.stroke();
      }
    }
  }
  for (let i = 0; i < Math.max(3, Math.round(w / 210)); i++) {
    const hx = shash(i, 41.7) * w;
    const y = floor + (h - floor) * (0.45 + shash(i, 43.3) * 0.48);
    const s = 0.9 + shash(i, 47.1) * 0.6;
    for (const dx of [0, w, -w]) {
      const x = hx + dx;
      if (x < -8 * s || x > w + 8 * s) continue;
      c.fillStyle = P.shroomStem;
      roundRect(c, x - 1.2 * s, y - 4 * s, 2.4 * s, 5 * s, 1.1 * s); c.fill();
      c.fillStyle = P.shroomCap;
      ell(c, x, y - 4 * s, 4.4 * s, 3.0 * s); c.fill();
    }
  }
  stripLight(c, w, h, o);
}

/* ==========================================================================
   THE HIGH STREET — the only road with no grass on it.

   A TERRACE ABOVE THE HORIZON AND PAVING BELOW IT. The buildings stand ON the
   horizon rather than in front of it, which is both correct parallax (they are
   the far plane, at a third of the ground's speed) and the only arrangement the
   two-plane blit allows — a shopfront crossing the floor line would be sawn in
   half and its halves would slide apart.

   THE LAMP POSTS ARE UP THERE WITH THEM for the same reason, and it is the one
   place this road tells a small lie: a lamp post is a near object and this one
   is drawn far. It reads correctly anyway because there is a whole terrace
   behind it at the same speed, and the alternative was no lamp post at all.
   ========================================================================== */
function stripHigh(c, w, h, o = {}) {
  const P = HIGH;
  const floor = o.floorY === undefined ? h * 0.62 : o.floorY;

  skyFill(c, w, floor, P.skyTop, P.skyLow);
  /* high and sparse: the terrace takes the bottom third of this sky */
  stripClouds(c, w, floor * 0.72, 4, 0.30);

  /* THE TERRACE. Hashed widths and heights off one running position, wrapped —
     and the run is closed by construction: the shop that straddles the join is
     drawn again one tile over, so the street continues rather than restarting. */
  const unit = Math.max(46, w / Math.max(4, Math.round(w / 78)));
  const shops = Math.max(4, Math.round(w / unit));
  for (let i = 0; i < shops; i++) {
    const bw = unit * (0.86 + shash(i, 5.5) * 0.26);
    const bh = h * (0.15 + shash(i, 9.1) * 0.10);
    const face = [P.brickA, P.brickB, P.brickC][i % 3];
    for (const dx of [0, w, -w]) {
      const x = i * unit + dx;
      if (x < -bw * 1.4 || x > w + bw * 1.4) continue;
      const top = floor - bh;
      /* body */
      c.fillStyle = P.brickD; roundRect(c, x, top, bw - 3, bh, 2); c.fill();
      c.fillStyle = face; roundRect(c, x + 1.4, top + 1.6, bw - 5.8, bh - 2, 2); c.fill();
      /* roofline */
      c.fillStyle = P.roof; roundRect(c, x - 1.5, top - 3.5, bw, 5, 2); c.fill();
      /* upstairs window, sometimes lit — a lit window is what says people */
      const litUp = shash(i, 13.7) > 0.62;
      c.fillStyle = litUp ? P.paneLit : P.pane;
      roundRect(c, x + bw * 0.22, top + bh * 0.16, bw * 0.24, bh * 0.20, 1.4); c.fill();
      roundRect(c, x + bw * 0.56, top + bh * 0.16, bw * 0.24, bh * 0.20, 1.4); c.fill();
      /* the shopfront glass */
      c.fillStyle = P.pane;
      roundRect(c, x + bw * 0.14, floor - bh * 0.36, bw * 0.66, bh * 0.26, 1.6); c.fill();
      /* THE AWNING, which is what makes it read as a high street at all
         (routemap.js says the same thing about its own) */
      const aw = [P.awnA, P.awnB, P.awnC][(i * 2 + 1) % 3];
      const ay = floor - bh * 0.42;
      c.fillStyle = aw;
      c.beginPath();
      c.moveTo(x + bw * 0.10, ay);
      c.lineTo(x + bw * 0.86, ay);
      c.lineTo(x + bw * 0.80, ay + bh * 0.11);
      c.lineTo(x + bw * 0.16, ay + bh * 0.11);
      c.closePath(); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.26)';
      for (let s = 0; s < 3; s++) {
        c.fillRect(x + bw * (0.20 + s * 0.20), ay, bw * 0.08, bh * 0.11);
      }
    }
  }
  /* lamp posts, sparser than the shops and on their own rhythm */
  const lamps = Math.max(2, Math.round(w / 210));
  for (let i = 0; i < lamps; i++) {
    const u = (i + 0.5) / lamps;
    const lh = h * 0.13;
    for (const dx of [0, w, -w]) {
      const x = u * w + dx;
      if (x < -12 || x > w + 12) continue;
      c.strokeStyle = P.lamp; c.lineWidth = 2.2; c.lineCap = 'round';
      c.beginPath(); c.moveTo(x, floor); c.lineTo(x, floor - lh); c.stroke();
      c.fillStyle = P.lampGlass;
      ell(c, x, floor - lh - 3, 3.6, 4.4); c.fill();
    }
  }

  groundFill(c, w, h, floor, P.paveTop, P.paveMid, P.paveLow);

  /* the kerb, hard against the horizon, and paving joints below it */
  c.fillStyle = P.kerb;
  c.fillRect(0, floor, w, Math.max(2, (h - floor) * 0.035));

  c.strokeStyle = P.joint; c.lineWidth = 1.2;
  /* SLABS, IN WHOLE COLUMNS ACROSS THE TILE, which is what keeps them seamless:
     a joint every `w / cols` closes on itself where a joint every N units would
     not. Three courses, each offset, so it reads as paving and not as graph
     paper. */
  const cols = Math.max(4, Math.round(w / 62));
  const courses = 3;
  for (let r = 0; r < courses; r++) {
    const y0 = floor + (h - floor) * (0.10 + r * 0.30);
    const y1 = floor + (h - floor) * (0.10 + (r + 1) * 0.30);
    c.beginPath(); c.moveTo(0, y0); c.lineTo(w, y0); c.stroke();
    for (let i = 0; i < cols; i++) {
      const x = ((i + (r % 2) * 0.5) / cols) * w;
      c.beginPath(); c.moveTo(x, y0); c.lineTo(x, y1); c.stroke();
    }
  }
  stripLight(c, w, h, o);
}

/* ==========================================================================
   THE RIVER — a band of water between him and the far bank.

   THE WATER IS BELOW THE HORIZON, which means it is in the NEAR plane and
   scrolls at his own speed. That is correct rather than convenient: he is
   walking along a towpath and the river runs beside him, so it should go past
   at the pace the ground does. Everything above the horizon — the far bank and
   its trees — stays in the slow plane where it belongs.
   ========================================================================== */
function stripRiver(c, w, h, o = {}) {
  const P = RIVER;
  const floor = o.floorY === undefined ? h * 0.62 : o.floorY;

  skyFill(c, w, floor, P.skyTop, P.skyLow);
  /* the openest sky of the four — nothing tall stands on this road */
  stripClouds(c, w, floor, 7, 0.52);
  ridge(c, w, floor, floor - h * 0.13, h * 0.032, 2, 5, P.hillFar);
  ridge(c, w, floor, floor - h * 0.06, h * 0.018, 3, 7, P.hillNear);

  /* the far bank's treeline: the park's round clumps, smaller and cooler, so
     the two roads are told apart by what is UNDER them rather than by this */
  const trees = Math.max(8, Math.round(w / 74));
  for (let i = 0; i < trees; i++) {
    const u = (i + 0.5) / trees + (shash(i, 2.7) - 0.5) * 0.5 / trees;
    const r = h * (0.020 + shash(i, 5.5) * 0.010);
    const y = floor - h * 0.038 + (shash(i, 9.1) - 0.5) * h * 0.010;
    for (const dx of [0, w, -w]) {
      const x = u * w + dx;
      if (x < -r * 2 || x > w + r * 2) continue;
      c.fillStyle = i % 3 === 0 ? P.treeLight : P.treeDark;
      ell(c, x, y, r * 1.3, r * 0.96); c.fill();
    }
  }

  groundFill(c, w, h, floor, P.grassTop, P.grassMid, P.grassLow);

  /* THE FAR BANK, a strip of grass on the other side, then the water, then the
     towpath. Three bands, all full width, so nothing can straddle anything. */
  const wTop = floor + (h - floor) * 0.10;
  const wBot = floor + (h - floor) * 0.46;
  c.fillStyle = P.farBank;
  c.fillRect(0, floor, w, wTop - floor);

  const wg = c.createLinearGradient(0, wTop, 0, wBot);
  wg.addColorStop(0, P.waterD); wg.addColorStop(0.5, P.water); wg.addColorStop(1, P.waterD);
  c.fillStyle = wg;
  c.beginPath();
  const N = Math.max(24, Math.ceil(w / 6));
  c.moveTo(0, wTop);
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    c.lineTo(u * w, wTop + Math.sin(TAU * 2 * u) * (h - floor) * 0.016);
  }
  for (let i = N; i >= 0; i--) {
    const u = i / N;
    c.lineTo(u * w, wBot + Math.sin(TAU * 3 * u + 0.8) * (h - floor) * 0.020);
  }
  c.closePath(); c.fill();

  /* ripples — short horizontal dashes at hashed u, wrapped */
  c.strokeStyle = P.waterHi; c.lineWidth = 1.6; c.lineCap = 'round';
  const nr = Math.max(14, Math.round(w / 26));
  for (let i = 0; i < nr; i++) {
    const hx = shash(i, 31.1) * w;
    const y = wTop + (wBot - wTop) * (0.15 + shash(i, 33.7) * 0.7);
    const len = 6 + shash(i, 37.3) * 12;
    for (const dx of [0, w, -w]) {
      const x = hx + dx;
      if (x < -len - 4 || x > w + len + 4) continue;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + len, y); c.stroke();
    }
  }

  /* the towpath he is on */
  const pg = c.createLinearGradient(0, wBot, 0, h);
  pg.addColorStop(0, P.pathTop); pg.addColorStop(0.5, P.pathMid); pg.addColorStop(1, P.pathLow);
  c.fillStyle = pg;
  c.fillRect(0, wBot - 1, w, h - wBot + 1);

  /* REEDS ALONG THE NEAR EDGE, and they start BELOW the water line rather than
     on it: a reed rooted above `wBot` would be standing in the middle of the
     river, and one crossing `floor` would be sawn in half by the blit. */
  const nq = Math.max(16, Math.round(w / 18));
  for (let i = 0; i < nq; i++) {
    const hx = shash(i, 17.3) * w;
    const y = wBot + shash(i, 23.9) * (h - wBot) * 0.34;
    const len = 12 + shash(i, 29.5) * 14;
    const lean = (shash(i, 31.1) - 0.5) * 6;
    for (const dx of [0, w, -w]) {
      const x = hx + dx;
      if (x < -10 || x > w + 10) continue;
      c.strokeStyle = P.reed; c.lineWidth = 1.7; c.lineCap = 'round';
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + lean, y - len); c.stroke();
      if (shash(i, 43.3) > 0.66) {
        c.fillStyle = P.reedHead;
        ell(c, x + lean, y - len - 2, 1.5, 3.4); c.fill();
      }
    }
  }
  stripLight(c, w, h, o);
}

export default { drawPark, drawRing, drawStrip };
