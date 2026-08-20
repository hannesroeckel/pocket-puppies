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

export default { drawPark, drawRing };
