/* ==========================================================================
   dog/part.js — A FURRED PART, AND EVERYTHING THAT MAKES IT READ AS COAT.

   WHY THIS EXISTS. `dog/side.js` drew its own coat and the verdict was "that
   looks horrible", then — after the tufted mass was shared — "no it still
   doesnt look like a proper dog, especially comparing to how he looks in the
   current game". The measurement behind that: `dog/draw.js` had 28 drawing
   functions and the profile used 2 of them.

   The frontal dog's coat is not one thing. It is FIVE, layered:

     1. the TUFT PROFILE     a precomputed scalloped displacement along the
                             outline — |sin(pi*c*u)|^pow, phase-warped and
                             amplitude-modulated so it reads as a coat rather
                             than as a machined ripple
     2. the SCALLOP          a gentler wave on the silhouette itself
     3. the FRINGE           overlapping soft lobes drawn BEHIND the part,
                             poking past the edge at irregular intervals. This
                             is what stops a tufted outline reading as a single
                             scalloped cutout
     4. the FLYAWAY          thin low-alpha arcs straddling the rim, outside the
                             clip, genuinely breaking the edge
     5. the CLUMPS           interior texture: fanned tapered strands, or a
                             scatter of little arcs for a curly breed

   Any one of them alone is a blob. That is what the profile was.

   MOVED, NOT REWRITTEN. Every line of arithmetic below came out of
   `dog/draw.js` character for character. What changed is that the numbers it
   used to close over — the outline, the fur type, the palette, the per-part
   phase and salts — are now constructor arguments, so a second view of the dog
   can build parts of its own. `tools/bowlpixels.py` and `tools/breedproof.py`
   exist to prove that: a pure extraction must come out pixel-identical.

   THE PER-PART CONSTANTS ARE PASSED IN, NOT DERIVED FROM A KEY. `draw.js` chose
   its tuft phase, its fringe salt and its flyaway salt with `key === 'head'`,
   which cannot extend to a profile with five parts. They are arguments now, and
   the frontal renderer passes exactly the values it always used — that is what
   keeps the extraction byte-identical rather than merely close.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import {
  TAU, clamp, lerp, pt, ell, rgba, ribbon, resampleClosed, loopNormals,
} from '../engine/draw.js';

const FU = BALANCE.fur;

/** deterministic 0..1 jitter — the coat must look the same every frame */
export function hash1(i, salt) {
  const v = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

/** a soft rounded fur lobe: base -> tapered tip, no corners anywhere */
export function lobe(c, bx, by, ax, ay, len, w) {
  const nx = -ay, ny = ax;
  const mx = bx + ax * len * 0.5, my = by + ay * len * 0.5;
  const tx = bx + ax * len, ty = by + ay * len;
  const tw = w * 0.34;
  c.beginPath();
  c.moveTo(bx + nx * w, by + ny * w);
  c.quadraticCurveTo(mx + nx * w * 0.95, my + ny * w * 0.95, tx + nx * tw, ty + ny * tw);
  c.quadraticCurveTo(tx + ax * tw * 1.5, ty + ay * tw * 1.5, tx - nx * tw, ty - ny * tw);
  c.quadraticCurveTo(mx - nx * w * 0.95, my - ny * w * 0.95, bx - nx * w, by - ny * w);
  c.closePath();
}

/** sample a built outline at parameter u -> [x, y, nx, ny] */
export function sampleOutline(b, u) {
  const p = b.p, norms = b.n, n = p.length;
  const fi = ((u % 1) + 1) % 1 * n;
  const i0 = Math.floor(fi) % n, i1 = (i0 + 1) % n, ft = fi - Math.floor(fi);
  return [
    lerp(p[i0].x, p[i1].x, ft), lerp(p[i0].y, p[i1].y, ft),
    lerp(norms[i0].x, norms[i1].x, ft), lerp(norms[i0].y, norms[i1].y, ft),
  ];
}

/**
 * ONE FURRED PART.
 *
 * @param o.outline    the part's silhouette, closed, in part-local units
 * @param o.furType    an entry from dog/draw.js's FUR_TYPE table
 * @param o.pal        the resolved palette (`rig.pal`)
 * @param o.clumps     the interior clump list (`rig.fur.body` / `.head`), or []
 * @param o.tuftPhase  per-part phase, so two parts are never in lockstep
 * @param o.tuftK      `bodyScale` / `headScale` — tuft depth for this part
 * @param o.skirtRefH  the half-height the skirt ramp is measured against
 * @param o.fringeSalt / o.flySalt   per-part jitter salts
 * @param o.fringeK    `fringe.headScale` for a clipped part, else 1
 */
export function createFurredPart(o) {
  const furType = o.furType;
  const pal = o.pal;
  const clumps = o.clumps || [];
  const sub = furType.resample || FU.resample;
  const base = resampleClosed(o.outline, sub);
  const n = base.length;
  /* scratch buffers, reused every frame — zero allocation in the hot path */
  const b = { p: base.map(() => pt(0, 0)), o: base.map(() => pt(0, 0)), n: null };

  /* ==================================================================
     THE TUFT PROFILE — precomputed, because it is a pure function of the
     outline parameter u and therefore never changes. Zero trig per frame.

     |sin(pi*c*u)|^pow is a run of convex arcs meeting at cusps: a scalloped,
     cloud-like edge. A phase warp makes the lobes uneven and an amplitude
     modulation makes them different sizes, so it reads as a coat rather than
     as a machined ripple. The mean is removed so tufting does not silently
     inflate the dog, then a small net outward bias is added back because a
     curly coat genuinely does add bulk.
     ================================================================== */
  const TU = furType.tuft || null;
  let tuftProfile = null;
  if (TU) {
    const raw = new Float32Array(n);
    const ph = o.tuftPhase || 0;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const uu = u + TU.warp * Math.sin(u * TAU * 2 + ph);
      let v = Math.pow(Math.abs(Math.sin(Math.PI * TU.cycles * uu + ph)), TU.pow);
      v *= 1 + TU.mod * Math.sin(u * TAU * 3 + ph * 1.7);
      if (TU.oct2) {
        v += TU.oct2 * Math.pow(Math.abs(Math.sin(Math.PI * TU.cyc2 * uu + ph * 2.3)), TU.pow);
      }
      raw[i] = v; sum += v;
    }
    const mean = sum / n;
    const net = TU.net === undefined ? 0.30 : TU.net;
    const out = new Float32Array(n);
    /* THE SKIRT. A wiry breed in a schnauzer trim has a two-zone outline:
       sleek over the back and ribs, then long coat hanging below where the
       ribcage curves under. That pattern break IS the breed — a wiry dog drawn
       as uniform fluff reads as a generic doodle. So tuft depth ramps from
       sleek at the spine to full at the skirt. `skirt: 0` = uniform. */
    const skirt = TU.skirt || 0;
    const phh = o.skirtRefH || 1;
    const partK = o.tuftK === undefined ? 1 : o.tuftK;
    for (let i = 0; i < n; i++) {
      /* partK and the skirt MULTIPLY. They used to not: `k = lerp(...)`
         overwrote partK outright, so any breed that set `skirt` silently threw
         away its own `bodyScale` and `headScale`. */
      let k = partK;
      if (skirt) {
        const ny = clamp(base[i].y / phh, -1, 1);        // -1 top, +1 bottom
        k *= lerp(1 - skirt, 1 + skirt * 0.45, (ny + 1) / 2);
      }
      out[i] = TU.amp * (raw[i] - mean + net) * k;
    }
    tuftProfile = out;
  }

  /**
   * BUILD the part into pose space: scale, warp, scallop, tuft, pet, outline.
   * Returns the shared buffer — the same object every frame, by design.
   */
  function build(pet, sx, sy, ox, oy, gain, warp, wet) {
    const p = b.p, ol = b.o;
    /* 1. scale into pose space (+ optional warp for head yaw/pitch) */
    for (let i = 0; i < n; i++) {
      let x = base[i].x * sx, y = base[i].y * sy;
      if (warp) { const w = warp(x, y); x = w[0]; y = w[1]; }
      p[i].x = x; p[i].y = y;
    }
    /* 2. outward normals of the live shape */
    let norms = loopNormals(p);
    b.n = norms;
    /* 3. gentle fur scallop on the silhouette itself (never a spike) */
    const S = FU.scallop, amp = S.amp * furType.scallop;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const w = Math.sin(u * S.cycles * TAU + S.phase) * 0.62
        + Math.sin(u * (S.cycles + 4) * TAU + 0.4) * 0.38;
      p[i].x += norms[i].x * w * amp;
      p[i].y += norms[i].y * w * amp;
    }
    /* 3b. THE TUFTED SILHOUETTE. Wet fur collapses, so a soaked curly dog
           loses most of its tufting — which is a large part of why the bath
           reads as a bath and not as a blue filter. */
    if (TU) {
      const k = 1 - clamp(wet || 0, 0, 1) * 0.68;
      for (let i = 0; i < n; i++) {
        const d = tuftProfile[i] * k;
        p[i].x += norms[i].x * d;
        p[i].y += norms[i].y * d;
      }
      /* the dark outline has to hug the TUFTED shape, not the smooth one it
         was derived from, or every cusp grows a dark spur. */
      norms = loopNormals(p);
      b.n = norms;
    }
    /* 4. petting deformation — the body dents and follows the finger */
    if (pet) {
      for (let i = 0; i < n; i++) {
        const d = pet.deformPoint(p[i].x, p[i].y, ox, oy, gain);
        p[i].x = d[0]; p[i].y = d[1];
      }
    }
    /* 5. outline pass = the same shape pushed out along its normals */
    const ow = 2.0;
    for (let i = 0; i < n; i++) {
      ol[i].x = p[i].x + norms[i].x * ow;
      ol[i].y = p[i].y + norms[i].y * ow;
    }
    return b;
  }

  /* ==================================================================
     ART FIX 1 — fur clumps as soft lobes, tucked inside the silhouette.
     Positions are resolved against the live outline, so they follow body
     curvature and every petting dent for free.
     ================================================================== */
  function fur(c, hh, ox, oy, wet) {
    if (!clumps.length) return;
    const p = b.p, norms = b.n;
    /* WET FUR LIES DOWN. Flattening the clumps is most of what makes a wet
       dog read as wet rather than as a dog with a blue filter on it. */
    const flat = 1 - clamp(wet || 0, 0, 1) * 0.62;
    const len = FU.lobeLen * hh * furType.lobe * flat;
    const wid = len * FU.lobeWide;
    for (let k = 0; k < clumps.length; k++) {
      const f = clumps[k];
      const fi = f.t * n;
      const i0 = Math.floor(fi) % n, i1 = (i0 + 1) % n, ft = fi - Math.floor(fi);
      const px = lerp(p[i0].x, p[i1].x, ft), py = lerp(p[i0].y, p[i1].y, ft);
      const nx = lerp(norms[i0].x, norms[i1].x, ft), ny = lerp(norms[i0].y, norms[i1].y, ft);
      /* tangent along the outline: the lobe lies ALONG the body curve */
      const tx = -ny, ty = nx;
      const L = len * f.scale, W = wid * f.scale;
      /* base tucked inside the silhouette */
      const bx = px - nx * W * FU.inset, by = py - ny * W * FU.inset;
      const swirl = f.sp.x * FU.kickAngle;
      const dir0 = f.curl;
      /* axis: mostly tangential, biased inward, nudged by the stroke spring */
      let ax = tx * dir0 - nx * 0.42, ay = ty * dir0 - ny * 0.42;
      const aL = Math.hypot(ax, ay) || 1; ax /= aL; ay /= aL;
      const ca = Math.cos(swirl * 0.10), sa = Math.sin(swirl * 0.10);
      const rx = ax * ca - ay * sa, ry = ax * sa + ay * ca;

      /* cache for pet.js's fur ruffle */
      f.px = bx + ox; f.py = by + oy; f.pa = Math.atan2(ry, rx);

      /* A CURLY coat's interior texture is not straight strands — it is a
         scatter of little arcs. Same principle (thin, low-alpha, along the
         body curve), different mark.

         WHY THESE ARE SHORT, FAT AND FAINT. The first pass drew long thin
         high-contrast arcs and rendered they read as PEN SCRIBBLE — legible
         individual strokes, like someone had written on the dog. A curl's read
         is a soft crescent of shading, so: the sweep is under ~100 degrees, the
         stroke is WIDE (a wide low-alpha stroke is a soft band, a thin one is a
         line), the alpha is halved, and the shadow pair is offset by a fraction
         of the stroke width so the two never separate into two visible marks. */
      const CU = furType.curl;
      if (CU) {
        c.lineWidth = CU.width;
        c.lineCap = 'round';
        const cr = L * CU.radius;
        const shOff = CU.width * (CU.shade === undefined ? 0.55 : CU.shade);
        for (let j = 0; j < CU.arcs; j++) {
          const h1 = hash1(k * 7 + j, 2.2), h2 = hash1(k * 7 + j, 8.6);
          /* spread the arcs across the clump footprint, along the outline */
          const off = (j - (CU.arcs - 1) / 2) * W * 0.85 + (h1 - 0.5) * W * 0.5;
          const cx = bx + tx * off + rx * L * (0.20 + h2 * 0.42);
          const cy = by + ty * off + ry * L * (0.20 + h2 * 0.42);
          const a0 = Math.atan2(ry, rx) + (h1 - 0.5) * 1.5;
          const sweep = CU.sweep * (0.75 + h2 * 0.5);
          const dir = (j + k) % 2 ? 1 : -1;
          const rr = cr * (0.7 + h1 * 0.6);
          /* a shadow arc behind, offset a hair, then the light arc: the pair
             is what gives a curl its roundness */
          c.strokeStyle = rgba(pal.coatSh, CU.alpha * FU.shadowAlpha * 1.6 * furType.alpha);
          c.beginPath();
          c.arc(cx + rx * shOff, cy + ry * shOff, rr, a0 - sweep / 2 * dir, a0 + sweep / 2 * dir, dir < 0);
          c.stroke();
          c.strokeStyle = rgba(pal.coatHi, CU.alpha * furType.alpha);
          c.beginPath();
          c.arc(cx, cy, rr, a0 - sweep / 2 * dir, a0 + sweep / 2 * dir, dir < 0);
          c.stroke();
        }
        continue;
      }

      /* A single wide lobe reads as a flat facet — which is the "nub" failure
         wearing a different costume. Draw each clump as a few THIN tapered
         strands, fanned along the body curve: overlapping thin strands at low
         alpha are what actually read as fur. */
      const ns = FU.strands;
      const sw = W * FU.strandWide;
      const strand = (j, tint, alpha, lenScale) => {
        const fan = (ns > 1 ? (j / (ns - 1) - 0.5) : 0) * FU.fan;
        const cf = Math.cos(fan), sf = Math.sin(fan);
        const dx2 = rx * cf - ry * sf, dy2 = rx * sf + ry * cf;
        const off = (j - (ns - 1) / 2) * sw * 1.6;
        const taper = 1 - Math.abs(ns > 1 ? (j / (ns - 1) - 0.5) : 0) * 0.55;
        c.fillStyle = rgba(tint, alpha);
        lobe(c, bx + tx * off, by + ty * off, dx2, dy2, L * taper * lenScale, sw);
        c.fill();
      };
      /* shadow pass slightly behind: depth, never an outline */
      for (let j = 0; j < ns; j++) {
        strand(j, pal.coatSh, FU.contrast * FU.shadowAlpha * furType.alpha, 1.04);
      }
      for (let j = 0; j < ns; j++) {
        strand(j, pal.coatHi, FU.contrast * furType.alpha, 1.0);
      }
    }
  }

  /**
   * THE UNDER-FRINGE. Overlapping soft lobes drawn BEHIND the part, poking
   * past the silhouette at irregular intervals. This is what stops a tufted
   * outline reading as a single scalloped cutout: the edge gains depth and
   * breaks in places the main path does not, which is how real coat reads.
   * Drawn before the part's own outline pass, so the part always covers their
   * roots and they can never look like separate blobs.
   */
  function fringe(c, hh, wet) {
    const FR = furType.fringe;
    if (!FR) return;
    const salt = o.fringeSalt || 0;
    const partK = o.fringeK === undefined ? 1 : o.fringeK;
    const k = (1 - clamp(wet || 0, 0, 1) * 0.70) * partK;
    const r0 = FR.r * hh * k;
    /* Below about a unit a fringe lobe cannot read as coat depth at any device
       scale — it is pure cost. A close-clipped part (a schnauzer head) drops out
       here entirely and gets its broken edge from the tuft profile instead. */
    if (r0 < 1.0) return;
    const N = FR.n;
    const px = [], py = [], pr = [];
    for (let j = 0; j < N; j++) {
      const h1 = hash1(j, salt), h2 = hash1(j, salt + 9.1);
      const u = (j + FR.jitter * (h1 - 0.5)) / N;
      const s = sampleOutline(b, u);
      const rr = r0 * (0.60 + h2 * 0.80);
      px.push(s[0] + s[2] * rr * FR.out);
      py.push(s[1] + s[3] * rr * FR.out);
      pr.push(rr);
    }
    /* every dark rim first, then every coat lobe — interleaving them would let
       one lobe's dark rim print over its neighbour's coat.

       THE RIM IS A FRACTION OF THE LOBE, NEVER A FIXED OFFSET, and a
       TRANSLUCENT rim is a halo rather than a line. Both of those were how the
       Schnoodle's shoulders and hips came back as semi-transparent grey blobs
       floating outside the outline — they were not fur, they were rim. */
    const rimA = FR.rimAlpha === undefined ? FR.alpha : FR.rimAlpha;
    const rimK = FR.rimK === undefined ? 0.42 : FR.rimK;
    const rimMax = FR.rimMax === undefined ? 1.9 : FR.rimMax;
    c.fillStyle = pal.line;
    c.globalAlpha = rimA;
    for (let j = 0; j < N; j++) {
      c.beginPath(); c.arc(px[j], py[j], pr[j] + Math.min(rimMax, pr[j] * rimK), 0, TAU); c.fill();
    }
    c.globalAlpha = 1;
    c.fillStyle = pal.coatMid;
    for (let j = 0; j < N; j++) { c.beginPath(); c.arc(px[j], py[j], pr[j], 0, TAU); c.fill(); }
  }

  /**
   * FLYAWAY CURLS. Individual curls straddling the rim, drawn OUTSIDE the
   * silhouette clip so they genuinely break the edge. These are the hairs that
   * sell "fluffy" — but they are thin, low-alpha arcs, because anything solid
   * poking out of a dog reads as a growth (ARCHITECTURE §6 defect 1).
   */
  function flyaway(c, hh, wet) {
    const FL = furType.fly;
    if (!FL) return;
    const k = 1 - clamp(wet || 0, 0, 1) * 0.80;
    const L = FL.len * hh * k;
    if (L < 0.6) return;
    const salt = o.flySalt || 0;
    c.lineWidth = FL.width;
    c.lineCap = 'round';
    for (let j = 0; j < FL.n; j++) {
      const h1 = hash1(j, salt), h2 = hash1(j, salt + 4.3), h3 = hash1(j, salt + 7.7);
      const u = (j + 0.8 * (h1 - 0.5)) / FL.n;
      const s = sampleOutline(b, u);
      const ang = Math.atan2(s[3], s[2]);
      const cr = L * (0.55 + h2 * 0.65);
      const cx = s[0] + s[2] * cr * 0.42, cy = s[1] + s[3] * cr * 0.42;
      const sweep = FL.sweep * (0.7 + h3 * 0.6);
      const dir = j % 2 ? 1 : -1;
      c.strokeStyle = rgba(j % 3 ? pal.coatHi : pal.coatSh, FL.alpha * (0.6 + h2 * 0.5));
      c.beginPath();
      c.arc(cx, cy, cr, ang - sweep / 2 * dir, ang + sweep / 2 * dir, dir < 0);
      c.stroke();
    }
  }

  return {
    build, fur, fringe, flyaway,
    /** the live buffer: `.p` the tufted path, `.o` the outline pass, `.n` normals */
    get buf() { return b; },
    /** the resampled source outline, before any pose is applied */
    get base() { return base; },
    get count() { return n; },
  };
}

/* ==========================================================================
   A LEG.

   Moved out of dog/draw.js unchanged. It was `drawLeg` and it closed over the
   palette, `D.pawScale` and the breed's front stocking; those are an options bag
   now so the profile view can draw legs with it too.

   WHY THE PROFILE NEEDED THIS. Its first legs were capsules — a stroked line
   with a round cap — and against a dog whose front legs taper from the hip,
   carry a bowed knee, and end in a pale paw with two toe lines, they read as
   furniture. The taper is the tell: "the outline tapers to nothing at the hip,
   so the leg emerges from under the body instead of being a tube drawn on top
   of the chest" is the note that was already in here, and it is exactly what a
   profile leg needs too.
   ========================================================================== */
/* ==================================================================
   Legs
   ================================================================== */
export function drawLimb(c, hx, hy, px, py, bow, w, dark, pawScale, o) {
  const pal = o.pal;
  const D = { pawScale: o.pawScale === undefined ? 1 : o.pawScale };
  const stockingFront = o.stocking || null;
  const mx = (hx + px) / 2, my = (hy + py) / 2;
  const dx = px - hx, dy = py - hy, L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L, ny = dx / L;
  const kx = mx + nx * bow, ky = my + ny * bow;
  const nodes = [pt(hx, hy), pt(kx, ky), pt(lerp(kx, px, 0.55), lerp(ky, py, 0.55)), pt(px, py)];
  const ws = [w, w * 0.84, w * 0.72, w * 0.66];
  /* the outline tapers to nothing at the hip, so the leg emerges from under
     the body instead of being a tube drawn on top of the chest */
  const outlineTaper = [0, 0.55, 1, 1];
  c.beginPath(); ribbon(c, nodes, ws.map((v, i) => v + 2.0 * outlineTaper[i]));
  c.fillStyle = pal.line; c.globalAlpha = dark ? 0.9 : 0.85; c.fill(); c.globalAlpha = 1;
  c.beginPath(); ribbon(c, nodes, ws);
  /* coatMid, not coat: the body's lower half is already shaded, so a
     full-brightness leg pops off the chest */
  /* `o.tint` / `o.tintFar` let a caller choose the leg's coat. The frontal dog
     passes neither and gets `coatMid`/`coatSh` exactly as before — its body's
     lower half is already shaded, so a full-brightness leg would pop off the
     chest. In PROFILE the flank is bright all the way down, so the same two
     colours read as four dark socks bolted to a pale dog. */
  c.fillStyle = dark ? (o.tintFar || pal.coatSh) : (o.tint || pal.coatMid); c.fill();
  if (!dark && stockingFront) {
    c.beginPath(); ribbon(c, [nodes[1], nodes[2], nodes[3]],
      [ws[1] * 0.26, ws[2] * 0.34, ws[3] * 0.50]);
    c.fillStyle = pal[stockingFront.color];
    c.globalAlpha = stockingFront.alpha; c.fill(); c.globalAlpha = 1;
  }
  const ps = (pawScale === undefined ? 1 : pawScale) * D.pawScale;
  const pr = w * 1.06 * ps;
  c.fillStyle = pal.line; ell(c, px, py - 1.2, pr + 1.8, pr * 0.80 + 1.8); c.fill();
  c.fillStyle = dark ? pal.creamSh : pal.cream; ell(c, px, py - 1.6, pr, pr * 0.80); c.fill();
  if (!dark) {
    c.strokeStyle = rgba(pal.line, 0.42); c.lineWidth = 1.3;
    c.beginPath(); c.moveTo(px - pr * 0.34, py - 1.6); c.lineTo(px - pr * 0.34, py + pr * 0.5); c.stroke();
    c.beginPath(); c.moveTo(px + pr * 0.34, py - 1.6); c.lineTo(px + pr * 0.34, py + pr * 0.5); c.stroke();
  }
}

export default createFurredPart;
