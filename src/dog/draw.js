/* ==========================================================================
   dog/draw.js — renders a rig from a breed's silhouettes + palette + markings.

   Nothing here knows what a Shiba is. Proportions come from breed data,
   colours are derived from eight palette keys, outlines come from
   silhouette.front, and coat patterns come from the `markings` list.
   Capability differences are declarative tables (EAR_STYLE, FUR_TYPE).

   Three art fixes vs spike A live in here:
     1. Fur clumps are soft, low-contrast lobes resolved against the LIVE
        deformed outline (so they follow curvature and petting dents) and
        drawn INSIDE a clip of the silhouette — they can no longer protrude
        as pale nubs. The furry read comes from a gentle scallop on the
        silhouette itself plus a shadow ridge behind each lobe.
     2. The tail's base is buried inside the rump, its outline tapers to
        nothing over the first joints, and a soft root blend carries the coat
        gradient across the join.
     3. Proportions are puppy: see dog/breeds.js.
   ========================================================================== */
import BALANCE from '../state/balance.js';
import {
  TAU, clamp, lerp, pt, ell, crClosed, ribbon, resampleClosed, loopNormals, mix, rgba,
} from '../engine/draw.js';

const R = BALANCE.rig;
const FU = BALANCE.fur;

/* declarative capability tables — extend these, never special-case a breed */
const FUR_TYPE = {
  short: { scallop: 1.0, lobe: 1.0, alpha: 1.0 },
  long: { scallop: 2.3, lobe: 1.7, alpha: 1.15 },
  curly: { scallop: 1.7, lobe: 1.25, alpha: 0.9 },
  wiry: { scallop: 1.4, lobe: 0.85, alpha: 0.8 },
};
const EAR_STYLE = {
  prick: { spread: 0.30, back: 0.62, droop: 0, scaleY: 1 },
  floppy: { spread: 0.62, back: 0.28, droop: 1.05, scaleY: 1.08 },
};

export function createDogRenderer(rig) {
  const pal = rig.pal;
  const D = rig.dims;
  const furType = FUR_TYPE[rig.breed.fur.type] || FUR_TYPE.short;
  const earStyle = EAR_STYLE[rig.breed.ear] || EAR_STYLE.prick;
  const creamTail = mix(pal.cream, pal.coat, R.tail.creamMix);

  /* ---- static resampled outlines (scaled per frame, never rebuilt) ---- */
  const sub = FU.resample;
  const base = {
    body: resampleClosed(rig.sil.body, sub),
    head: resampleClosed(rig.sil.head, sub),
  };
  /* scratch buffers, reused every frame — zero allocation in the hot path */
  const buf = {
    body: { p: base.body.map(() => pt(0, 0)), o: base.body.map(() => pt(0, 0)), n: null },
    head: { p: base.head.map(() => pt(0, 0)), o: base.head.map(() => pt(0, 0)), n: null },
  };

  /* ---- gradients (local space, cached across frames) ------------------ */
  let G = null;
  function initGrads(c) {
    const hw = D.bodyHW, hh = D.bodyHH, khw = D.headHW, khh = D.headHH;
    G = {};
    G.body = c.createLinearGradient(-hw * 0.78, -hh * 1.20, hw * 0.66, hh * 1.20);
    G.body.addColorStop(0, pal.coatHi);
    G.body.addColorStop(0.34, pal.coat);
    G.body.addColorStop(0.78, pal.coatMid);
    G.body.addColorStop(1, pal.coatSh);

    G.bodyShade = c.createLinearGradient(0, -hh * 1.16, 0, hh * 1.20);
    G.bodyShade.addColorStop(0, 'rgba(255,240,205,0.24)');
    G.bodyShade.addColorStop(0.42, 'rgba(255,240,205,0)');
    G.bodyShade.addColorStop(0.72, 'rgba(140,70,32,0.06)');
    G.bodyShade.addColorStop(1, 'rgba(140,70,32,0.24)');

    G.bib = c.createLinearGradient(0, -hh * 0.60, 0, hh * 1.16);
    G.bib.addColorStop(0, pal.creamSh);
    G.bib.addColorStop(0.3, pal.creamMid);
    G.bib.addColorStop(1, pal.cream);

    G.head = c.createLinearGradient(-khw * 0.76, -khh * 1.09, khw * 0.63, khh);
    G.head.addColorStop(0, pal.coatHi);
    G.head.addColorStop(0.36, pal.coat);
    G.head.addColorStop(0.8, pal.coatMid);
    G.head.addColorStop(1, pal.coatSh);

    G.muz = c.createLinearGradient(0, -D.muzY - 4, 0, D.muzY + 6);
    G.muz.addColorStop(0, pal.creamMid);
    G.muz.addColorStop(0.45, pal.cream);
    G.muz.addColorStop(1, pal.creamSh);

    /* ART FIX 2 — the tail gradient starts at the RUMP's colour so the coat
       carries across the join instead of banding. */
    const tb = D.tailBase;
    G.tail = c.createLinearGradient(tb[0], D.bodyY + tb[1], tb[0] + 66, D.bodyY + tb[1] - 58);
    G.tail.addColorStop(0, pal.coatSh);
    G.tail.addColorStop(0.22, pal.coatMid);
    G.tail.addColorStop(0.62, pal.coat);
    G.tail.addColorStop(1, pal.coatHi);

    G.tailRoot = c.createRadialGradient(0, 0, 1, 0, 0, R.tail.rootBlend.r);
    G.tailRoot.addColorStop(0, rgba(pal.coatMid, R.tail.rootBlend.alpha));
    G.tailRoot.addColorStop(0.55, rgba(pal.coatMid, R.tail.rootBlend.alpha * 0.5));
    G.tailRoot.addColorStop(1, rgba(pal.coatMid, 0));

    const ruffR = hw * 0.44 * D.neckRuff;
    G.ruff = c.createRadialGradient(0, 0, 1, 0, 0, ruffR);
    G.ruff.addColorStop(0, rgba(pal.creamMid, 0.95));
    G.ruff.addColorStop(0.5, rgba(pal.creamMid, 0.62));
    G.ruff.addColorStop(0.82, rgba(pal.creamMid, 0.20));
    G.ruff.addColorStop(1, rgba(pal.creamMid, 0));

    G.shadow = c.createRadialGradient(0, 0, 2, 0, 0, hw * 1.16);
    G.shadow.addColorStop(0, 'rgba(96,52,26,0.30)');
    G.shadow.addColorStop(0.45, 'rgba(96,52,26,0.15)');
    G.shadow.addColorStop(1, 'rgba(96,52,26,0)');

    G.rim = c.createLinearGradient(hw * 1.15, -hh * 1.6, -hw * 0.6, hh);
    G.rim.addColorStop(0, 'rgba(255,244,214,0.42)');
    G.rim.addColorStop(0.42, 'rgba(255,244,214,0.06)');
    G.rim.addColorStop(1, 'rgba(255,244,214,0)');

    G.headShade = c.createLinearGradient(0, -khh * 1.05, 0, khh);
    G.headShade.addColorStop(0, 'rgba(255,244,214,0.30)');
    G.headShade.addColorStop(0.44, 'rgba(255,244,214,0)');
    G.headShade.addColorStop(1, 'rgba(150,76,34,0.22)');
  }

  /* ==================================================================
     Part outline builder: scale -> scallop -> deform -> outline offset
     ================================================================== */
  function buildPart(key, pet, sx, sy, ox, oy, gain, warp) {
    const src = base[key], b = buf[key], n = src.length;
    const p = b.p, o = b.o;
    /* 1. scale into pose space (+ optional warp for head yaw/pitch) */
    for (let i = 0; i < n; i++) {
      let x = src[i].x * sx, y = src[i].y * sy;
      if (warp) { const w = warp(x, y); x = w[0]; y = w[1]; }
      p[i].x = x; p[i].y = y;
    }
    /* 2. outward normals of the live shape */
    const norms = loopNormals(p);
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
      o[i].x = p[i].x + norms[i].x * ow;
      o[i].y = p[i].y + norms[i].y * ow;
    }
    return b;
  }

  /* ==================================================================
     ART FIX 1 — fur clumps as soft lobes, tucked inside the silhouette.
     Positions are resolved against the live outline, so they follow body
     curvature and every petting dent for free.
     ================================================================== */
  function drawFur(c, part, b, hh, ox, oy) {
    const list = rig.fur[part];
    if (!list.length) return;
    const p = b.p, norms = b.n, n = p.length;
    const len = FU.lobeLen * hh * furType.lobe;
    const wid = len * FU.lobeWide;
    for (let k = 0; k < list.length; k++) {
      const f = list[k];
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
      const dir = f.curl;
      /* axis: mostly tangential, biased inward, nudged by the stroke spring */
      let ax = tx * dir - nx * 0.42, ay = ty * dir - ny * 0.42;
      const aL = Math.hypot(ax, ay) || 1; ax /= aL; ay /= aL;
      const ca = Math.cos(swirl * 0.10), sa = Math.sin(swirl * 0.10);
      const rx = ax * ca - ay * sa, ry = ax * sa + ay * ca;

      /* cache for pet.js's fur ruffle */
      f.px = bx + ox; f.py = by + oy; f.pa = Math.atan2(ry, rx);

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

  /** a soft rounded fur lobe: base -> tapered tip, no corners anywhere */
  function lobe(c, bx, by, ax, ay, len, w) {
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

  /* ==================================================================
     Markings — interpreted from breed data, no hardcoded patterns.
     ================================================================== */
  function drawMarkings(c, where, hw, hh, pet, ox, oy, anim) {
    const list = rig.breed.markings;
    for (let i = 0; i < list.length; i++) {
      const mk = list[i];
      if (mk.where !== where) continue;
      const baseA = mk.alpha === undefined ? 1 : mk.alpha;
      if (mk.shape === 'patch') {
        const outline = rig.sil[mk.outline];
        if (!outline) continue;
        const sx = hw / D.bodyHW, sy = hh / D.bodyHH;
        const pts = [];
        for (const q of outline) {
          const d = pet ? pet.deformPoint(q.x * sx, q.y * sy, ox, oy, mk.deform || 0.75)
            : [q.x * sx, q.y * sy];
          pts.push(pt(d[0], d[1]));
        }
        /* feathered edge: a wider ghost pass under the real one, so the coat
           fades into the cream instead of meeting it at a hard line */
        const fe = mk.feather || 0;
        if (fe > 0) {
          c.beginPath();
          crClosed(c, pts.map((q) => pt(q.x * (1 + fe), q.y * (1 + fe * 0.7))), 1);
          c.fillStyle = mk.grad === 'bib' ? G.bib : pal[mk.color];
          c.globalAlpha = baseA * 0.34; c.fill();
        }
        c.beginPath(); crClosed(c, pts, 1);
        c.fillStyle = mk.grad === 'bib' ? G.bib : pal[mk.color];
        c.globalAlpha = baseA; c.fill();
        c.globalAlpha = 1;
      } else if (mk.shape === 'ellipse') {
        const sides = mk.mirror ? [1, -1] : [1];
        const soft = mk.soft || 0;
        /* soft markings are drawn as concentric passes: big+faint to
           small+solid. Cheap, and it reads as fur rather than a sticker. */
        const passes = soft > 0
          ? [[1 + soft * 0.42, 0.26], [1 + soft * 0.19, 0.46], [1, 1]]
          : [[1, 1]];
        for (const sd of sides) {
          let x = mk.at[0] * hw * sd, y = mk.at[1] * hh;
          let rx = mk.size[0] * hw, ry = mk.size[1] * hh;
          const rot = (mk.rot || 0) * sd;
          if (anim && mk.tag && anim[mk.tag]) {
            const a = anim[mk.tag](sd, x, y, rx, ry);
            x = a[0]; y = a[1]; rx = a[2]; ry = a[3];
          }
          c.fillStyle = pal[mk.color];
          for (const [grow, af] of passes) {
            c.globalAlpha = baseA * af;
            ell(c, x, y, rx * grow, ry * grow, rot); c.fill();
          }
          c.globalAlpha = 1;
        }
      }
    }
  }

  function markingFor(shape, where) {
    return rig.breed.markings.find((m) => m.shape === shape && (where === undefined || m.where === where));
  }
  const stockingFront = markingFor('stocking', 'legFront');
  const tailUnderMk = markingFor('tailUnder');

  /* ==================================================================
     Tail
     ================================================================== */
  function drawTail(c) {
    const T = R.tail;
    const nodes = rig.pose.tailNodes;
    if (nodes.length < 2) return;
    const fl = 1 + rig.springs.wagAmp.x * 0.10;
    const ws = [], ow = [];
    for (let i = 0; i < nodes.length; i++) {
      ws.push(T.wid[Math.min(i, T.wid.length - 1)] * fl);
      /* ART FIX 2: the first joints get NO outline — they're buried in the rump */
      const taper = clamp((i - T.rootHide) / 1.6, 0, 1);
      ow.push(ws[i] + 2.0 * taper);
    }
    c.beginPath(); ribbon(c, nodes, ow);
    c.fillStyle = pal.line; c.globalAlpha = 0.85; c.fill(); c.globalAlpha = 1;

    c.beginPath(); ribbon(c, nodes, ws);
    c.fillStyle = G.tail; c.fill();

    /* cream underside — starts late and fades in, so it never bands */
    if (tailUnderMk) {
      const from = T.creamFrom;
      const inner = [], iw = [];
      for (let i = from; i < nodes.length; i++) {
        const px = nodes[Math.max(0, i - 1)], nx = nodes[Math.min(nodes.length - 1, i + 1)];
        const dx = nx.x - px.x, dy = nx.y - px.y, L = Math.hypot(dx, dy) || 1;
        inner.push(pt(nodes[i].x + (dy / L) * ws[i] * 0.34, nodes[i].y - (dx / L) * ws[i] * 0.34));
        iw.push(ws[i] * 0.40 * clamp((i - from) / 1.2, 0.25, 1));
      }
      if (inner.length > 2) {
        c.beginPath(); ribbon(c, inner, iw);
        c.fillStyle = creamTail;
        c.globalAlpha = tailUnderMk.alpha;
        c.fill(); c.globalAlpha = 1;
      }
    }

    /* soft floof on the last joints */
    for (let i = nodes.length - 2; i < nodes.length; i++) {
      const a = Math.atan2(nodes[i].y - nodes[i - 1].y, nodes[i].x - nodes[i - 1].x);
      for (const sd of [-1, 1]) {
        const aa = a + sd * 1.28;
        lobe(c, nodes[i].x, nodes[i].y, Math.cos(aa), Math.sin(aa), T.floofLen, T.floofW);
        c.fillStyle = rgba(pal.coatHi, 0.30);
        c.fill();
      }
    }
  }

  /** soft root blend drawn AFTER the body: carries the coat across the join */
  function drawTailRoot(c) {
    const nodes = rig.pose.tailNodes;
    if (nodes.length < 2) return;
    const n = nodes[1];
    c.save();
    c.translate(n.x, n.y);
    c.fillStyle = G.tailRoot;
    c.beginPath(); c.arc(0, 0, R.tail.rootBlend.r, 0, TAU); c.fill();
    c.restore();
  }

  /* ==================================================================
     Legs
     ================================================================== */
  function drawLeg(c, hx, hy, px, py, bow, w, dark, pawScale) {
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
    c.fillStyle = dark ? pal.coatSh : pal.coatMid; c.fill();
    if (!dark && stockingFront) {
      c.beginPath(); ribbon(c, [nodes[1], nodes[2], nodes[3]],
        [ws[1] * 0.26, ws[2] * 0.34, ws[3] * 0.50]);
      c.fillStyle = pal[stockingFront.color];
      c.globalAlpha = stockingFront.alpha; c.fill(); c.globalAlpha = 1;
    }
    const ps = pawScale === undefined ? 1 : pawScale;
    const pr = w * 1.06 * ps;
    c.fillStyle = pal.line; ell(c, px, py - 1.2, pr + 1.8, pr * 0.80 + 1.8); c.fill();
    c.fillStyle = dark ? pal.creamSh : pal.cream; ell(c, px, py - 1.6, pr, pr * 0.80); c.fill();
    if (!dark) {
      c.strokeStyle = rgba(pal.line, 0.42); c.lineWidth = 1.3;
      c.beginPath(); c.moveTo(px - pr * 0.34, py - 1.6); c.lineTo(px - pr * 0.34, py + pr * 0.5); c.stroke();
      c.beginPath(); c.moveTo(px + pr * 0.34, py - 1.6); c.lineTo(px + pr * 0.34, py + pr * 0.5); c.stroke();
    }
  }

  /* ==================================================================
     Face
     ================================================================== */
  function drawEye(c, ex, ey, w, h, open, smi, tiltA, side, lead) {
    const hh = h * 0.5 * clamp(open, 0.02, 1.25);
    const topC = -hh * 1.36;
    const botC = hh * 1.36 * (1 - smi * 1.92);
    /* THE EYES LEAD THE HEAD: the lens slides inside the socket ahead of the
       head rotation. There is no visible sclera, so moving the lens itself is
       what reads as "she looked". */
    const EL = R.eyeLead;
    if (lead) { ex += lead[0] * w * EL.shiftX; ey += lead[1] * h * EL.shiftY; }
    c.save();
    c.translate(ex, ey); c.rotate(tiltA * side);
    c.beginPath();
    c.moveTo(-w / 2, 0);
    c.quadraticCurveTo(w * 0.11 * side, topC, w / 2, 0);
    c.quadraticCurveTo(-w * 0.11 * side, botC, -w / 2, 0);
    c.closePath();
    c.restore();
    c.fillStyle = pal.eye; c.fill();
    c.strokeStyle = pal.eye; c.lineWidth = 2.1; c.lineJoin = 'round'; c.stroke();
    /* catchlights on the same screen side in both eyes: one light source */
    const hv = clamp((open - 0.30) / 0.70, 0, 1) * (1 - smi * 0.62);
    if (hv > 0.02) {
      c.save(); c.translate(ex, ey); c.rotate(tiltA * side);
      /* catchlight slides further than the lens: cheap parallax inside the eye */
      const cx = lead ? lead[0] * w * EL.catchlight * 0.5 : 0;
      const cy = lead ? lead[1] * hh * EL.catchlight * 0.5 : 0;
      c.fillStyle = pal.eyeHi; c.globalAlpha = 0.96 * hv;
      ell(c, w * 0.19 - cx, -hh * 0.40 - cy, w * 0.21, hh * 0.29, -0.45); c.fill();
      c.globalAlpha = 0.50 * hv;
      ell(c, -w * 0.20, hh * 0.34, w * 0.11, hh * 0.15, 0.3); c.fill();
      c.globalAlpha = 1; c.restore();
    }
  }

  function drawMouth(c, mx, my, op, smi, tg) {
    const cw = D.muzY * 0.62 + smi * 3.2;
    const lipY = my;
    if (op > 0.03) {
      const oh = op * 20;
      const mouthPath = () => {
        c.beginPath();
        c.moveTo(-cw + mx, lipY - 1);
        c.quadraticCurveTo(mx, lipY - 3.5, cw + mx, lipY - 1);
        c.bezierCurveTo(cw * 0.95 + mx, lipY + oh * 0.72, cw * 0.45 + mx, lipY + oh, mx, lipY + oh);
        c.bezierCurveTo(-cw * 0.45 + mx, lipY + oh, -cw * 0.95 + mx, lipY + oh * 0.72, -cw + mx, lipY - 1);
        c.closePath();
      };
      mouthPath();
      c.fillStyle = pal.mouth; c.fill();
      const tl = oh * (0.42 + tg * 0.5);
      c.save();
      mouthPath(); c.clip();
      c.fillStyle = pal.tongue;
      ell(c, mx, lipY + oh - tl * 0.30, cw * 0.78, tl * 0.92); c.fill();
      c.strokeStyle = pal.tongueSh; c.lineWidth = 1.6;
      c.beginPath(); c.moveTo(mx, lipY + oh - tl * 1.1); c.lineTo(mx, lipY + oh); c.stroke();
      c.restore();
      /* little teeth, but only on a properly open mouth — on a small grumble
         they read as a comedy grimace */
      const th = clamp((op - 0.30) / 0.45, 0, 1);
      if (th > 0.02) {
        c.fillStyle = '#fffaf0';
        const tw2 = 0.16 * th, td = 3.2 * th;
        c.beginPath(); c.moveTo(mx - cw * (0.42 + tw2), lipY - 0.5); c.lineTo(mx - cw * (0.42 - tw2), lipY - 0.5);
        c.lineTo(mx - cw * 0.42, lipY + td); c.closePath(); c.fill();
        c.beginPath(); c.moveTo(mx + cw * (0.42 - tw2), lipY - 0.5); c.lineTo(mx + cw * (0.42 + tw2), lipY - 0.5);
        c.lineTo(mx + cw * 0.42, lipY + td); c.closePath(); c.fill();
      }
      c.strokeStyle = pal.line; c.lineWidth = 2.0;
      c.beginPath(); c.moveTo(-cw + mx, lipY - 1);
      c.quadraticCurveTo(mx, lipY - 3.5, cw + mx, lipY - 1); c.stroke();
    }
    /* the classic shiba "w" — corners RISE with the smile, so a neutral
       face never reads as a frown */
    const dip = 2.6 - smi * 1.1;
    const corner = -2.2 - smi * 5.6 + (op > 0.03 ? 1.4 : 0);
    c.strokeStyle = pal.line; c.lineWidth = 2.2; c.lineCap = 'round';
    c.beginPath();
    c.moveTo(mx, lipY - 5.0);
    c.quadraticCurveTo(mx - cw * 0.52, lipY + dip, mx - cw, lipY + corner);
    c.stroke();
    c.beginPath();
    c.moveTo(mx, lipY - 5.0);
    c.quadraticCurveTo(mx + cw * 0.52, lipY + dip, mx + cw, lipY + corner);
    c.stroke();
    c.lineWidth = 1.8;
    c.beginPath(); c.moveTo(mx, lipY - 9.5); c.lineTo(mx, lipY - 5.2); c.stroke();
  }

  function drawEar(c, side, yawv, back, flick, scaleF) {
    const px = R.parallax;
    const far = clamp(-yawv * side, 0, 1);
    const near = clamp(yawv * side, 0, 1);
    const bx = side * D.earX + yawv * px.ear;
    const by = D.earY + Math.abs(yawv) * 2;
    const baseA = side * earStyle.spread + back * side * earStyle.back + flick + earStyle.droop * side;
    const sx = (1 - far * px.earFar + near * px.earNear) * scaleF;
    const sy = (1 - back * 0.16 - far * 0.06) * scaleF * earStyle.scaleY;
    c.save();
    c.translate(bx, by);
    c.rotate(baseA);
    c.scale(side * sx, sy);
    c.beginPath();
    crClosed(c, rig.sil.ear.map((p) => pt(p.x * 1.10, p.y * 1.06 - 1.2)), 1);
    c.fillStyle = pal.line; c.fill();
    c.beginPath(); crClosed(c, rig.sil.ear, 1);
    const eg = c.createLinearGradient(-D.earX * 0.4, 4, D.earX * 0.35, -R.tail.floofLen * 6);
    eg.addColorStop(0, pal.coatSh); eg.addColorStop(0.55, pal.coatMid); eg.addColorStop(1, pal.coatDeep);
    c.fillStyle = eg; c.fill();
    if (rig.sil.earInner) {
      c.beginPath(); crClosed(c, rig.sil.earInner, 1);
      c.fillStyle = pal.inner; c.fill();
      c.beginPath(); crClosed(c, rig.sil.earInner.map((p) => pt(p.x * 0.62, p.y * 0.76)), 1);
      c.fillStyle = 'rgba(255,236,225,0.55)'; c.fill();
    }
    c.restore();
  }

  function drawFace(c, mood, petLevel) {
    const P = rig.pose, s = rig.springs, px = R.parallax, mo = rig.mo.parallax;
    const yawv = P.yaw, pitchv = P.pitch;
    const open = P.eyeOpenEff, smi = clamp(s.eyeSmile.x, 0, 1);
    const fEye = yawv * px.eye * mo, fMuz = yawv * px.muzzle * mo, fBrow = yawv * px.brow * mo;
    const vEye = -pitchv * px.vEye, vMuz = -pitchv * px.vMuz, vBrow = -pitchv * px.vBrow;
    const fl = clamp(yawv, 0, 1) * mo, fr = clamp(-yawv, 0, 1) * mo;
    const brw = s.brow.x;

    /* the gaze lead, in eye-local units */
    const lead = [P.pupilX, P.pupilY];
    const EL = R.eyeLead;

    /* cream cheeks + brow markings, driven by breed data */
    drawMarkings(c, 'head', D.headHW, D.headHH, null, 0, 0, {
      cheek: (sd, x, y, rx, ry) => [
        x + yawv * px.cheek * mo, y + vMuz * 0.5,
        rx * (1 - (sd > 0 ? fl : fr) * px.farShrink), ry,
      ],
      /* brows follow the eyes, not the head */
      brow: (sd, x, y, rx, ry) => [
        x + fBrow + lead[0] * D.eyeW * EL.shiftX * EL.brow,
        y + vBrow - brw * 2.5 + lead[1] * D.eyeH * EL.shiftY * EL.brow,
        rx * (1 - (sd > 0 ? fl : fr) * px.farShrink), ry + brw * 1.1,
      ],
    });

    /* muzzle */
    const mcx = fMuz, mcy = D.muzY + vMuz;
    c.save(); c.translate(mcx, mcy);
    c.scale(1 - Math.abs(yawv) * px.muzSquash * mo, 1);
    c.beginPath(); crClosed(c, rig.sil.muzzle, 1);
    c.fillStyle = G.muz; c.fill();
    c.strokeStyle = rgba(pal.creamSh, 0.30); c.lineWidth = 1.2; c.stroke();
    c.restore();

    /* eyes */
    drawEye(c, -D.eyeX + fEye, D.eyeY + vEye, D.eyeW * (1 - fl * px.farShrink), D.eyeH, open, smi, R.eyeTilt, -1, lead);
    drawEye(c, D.eyeX + fEye, D.eyeY + vEye, D.eyeW * (1 - fr * px.farShrink), D.eyeH, open, smi, R.eyeTilt, 1, lead);

    /* nose */
    const nsx = mcx + s.noseTw.x * 1.4, nsy = mcy - D.muzY * 0.40 + Math.abs(s.noseTw.x) * 0.6;
    const nw = D.muzY * 0.42;
    c.save(); c.translate(nsx, nsy);
    c.beginPath();
    crClosed(c, [pt(0, -nw * 0.78), pt(nw * 0.89, -nw * 0.61), pt(nw, nw * 0.17), pt(nw * 0.42, nw * 0.75),
      pt(0, nw * 0.83), pt(-nw * 0.42, nw * 0.75), pt(-nw, nw * 0.17), pt(-nw * 0.89, -nw * 0.61)], 1);
    c.fillStyle = pal.nose; c.fill();
    c.fillStyle = 'rgba(255,255,255,0.32)';
    ell(c, -nw * 0.30, -nw * 0.33, nw * 0.39, nw * 0.24, -0.4); c.fill();
    c.restore();

    /* mouth */
    drawMouth(c, mcx, mcy + D.muzY * 0.44, clamp(s.mouth.x, 0, 1), clamp(s.smile.x, 0, 1), clamp(s.tongue.x, 0, 1.4));

    /* blush */
    const bl = clamp((mood - 0.42) / 0.58, 0, 1) * 0.5 + petLevel * 0.35;
    if (bl > 0.03) {
      c.fillStyle = rgba(pal.blush, 0.30 * clamp(bl, 0, 1));
      ell(c, -D.headHW * 0.70 + yawv * px.eye * mo, D.headHH * 0.10 + vEye * 0.6, D.headHW * 0.22, D.headHH * 0.13, -0.2); c.fill();
      ell(c, D.headHW * 0.70 + yawv * px.eye * mo, D.headHH * 0.10 + vEye * 0.6, D.headHW * 0.22, D.headHH * 0.13, 0.2); c.fill();
    }
  }

  /* ==================================================================
     The dog
     ================================================================== */
  function draw(g, pet, mood) {
    const c = g.ctx;
    const P = rig.pose, s = rig.springs;
    const petLevel = pet ? pet.level : 0;
    const aff = mood === undefined ? 0 : mood;

    c.save();
    c.translate(rig.x, rig.y);
    c.scale(rig.s, rig.s);
    if (!G) initGrads(c);

    const sit = P.sit;

    /* ---- contact shadow ---- */
    c.save();
    const shSpread = 1 + s.sit.x * 0.10 + s.squash.x * 0.20;
    c.translate(P.bodyX * 0.45, 0);
    c.scale(shSpread, 0.26 * (1 - clamp(s.lift.x, 0, 20) / 70));
    c.fillStyle = G.shadow;
    c.beginPath(); c.arc(0, 0, D.bodyHW * 1.16, 0, TAU); c.fill();
    c.restore();

    /* ---- tail (behind the body) ---- */
    drawTail(c);

    /* ---- hind legs ---- */
    const hipY = P.bodyY + P.bodyHH * R.leg.hindHipAt;
    const kick = Math.sin(rig.kickPhase) * s.hindKick.x;
    const hw = P.bodyHW;
    drawLeg(c, P.bodyX - D.hipX, hipY - 6, P.bodyX - D.hindPawX, -5 + sit * 3 - Math.max(0, kick) * 7,
      -(4 + sit * 15), D.legW * 0.86, true, 1);
    drawLeg(c, P.bodyX + D.hipX, hipY - 6, P.bodyX + D.hindPawX, -5 + sit * 3 + Math.min(0, kick) * 7,
      (4 + sit * 15), D.legW * 0.86, true, 1);

    /* ---- haunches (reads as "sitting") ---- */
    if (sit > 0.02) {
      c.globalAlpha = clamp(sit, 0, 1);
      c.fillStyle = pal.line;
      ell(c, P.bodyX + hw * 0.80, hipY - 14, hw * 0.40, hw * 0.46, 0.12); c.fill();
      ell(c, P.bodyX - hw * 0.80, hipY - 14, hw * 0.40, hw * 0.46, -0.12); c.fill();
      c.fillStyle = pal.coatMid;
      ell(c, P.bodyX + hw * 0.80, hipY - 15, hw * 0.36, hw * 0.42, 0.12); c.fill();
      ell(c, P.bodyX - hw * 0.80, hipY - 15, hw * 0.36, hw * 0.42, -0.12); c.fill();
      c.globalAlpha = 1;
    }

    /* ---- body ---- */
    const sxB = P.bodyHW / D.bodyHW, syB = P.bodyHH / D.bodyHH;
    const b = buildPart('body', pet, sxB, syB, P.bodyX, P.bodyY, 1.0, null);
    c.save();
    c.translate(P.bodyX, P.bodyY);
    c.rotate(P.bodyRot);
    /* outline */
    c.beginPath(); crClosed(c, b.o, 1);
    c.fillStyle = pal.line; c.fill();
    /* fill */
    c.beginPath(); crClosed(c, b.p, 1);
    c.fillStyle = G.body; c.fill();
    /* everything below is CLIPPED to the silhouette: fur can never protrude */
    c.save(); c.clip();
    c.fillStyle = G.bodyShade;
    c.fillRect(-D.bodyHW * 1.4, -D.bodyHH * 1.6, D.bodyHW * 2.8, D.bodyHH * 3.2);
    drawMarkings(c, 'body', P.bodyHW, P.bodyHH, pet, P.bodyX, P.bodyY, null);
    drawFur(c, 'body', b, D.bodyHH, P.bodyX, P.bodyY);
    c.fillStyle = G.rim;
    c.fillRect(-D.bodyHW * 1.4, -D.bodyHH * 1.6, D.bodyHW * 2.8, D.bodyHH * 3.2);
    c.restore();
    c.restore();

    /* ---- ART FIX 2: blend the tail root into the rump ---- */
    drawTailRoot(c);

    /* ---- front legs ---- */
    const fHipY = P.bodyY + P.bodyHH * R.leg.frontHipAt;
    for (let i = 0; i < 2; i++) {
      const sd = i === 0 ? -1 : 1;
      const lf = rig.pawLift[i].x;
      const pawX = P.bodyX + sd * D.pawX + sd * sit * 2 + lf * sd * 3;
      const pawY = -1 + sit * R.leg.sitLift - lf * R.leg.liftAmt;
      drawLeg(c, P.bodyX + sd * D.shoulderX, fHipY - 4, pawX, pawY,
        sd * (R.leg.bow + sit * R.leg.sitBow + lf * R.leg.liftBow), D.legW, false, 1 + lf * 0.06);
    }

    /* ---- cream chest ruff over the leg tops ----
       A soft radial falloff, NOT the spike's three hard ellipses: those read
       as two pale lobes with a dark seam between them. */
    c.save();
    c.translate(P.bodyX, P.bodyY + P.bodyHH * 0.70);
    c.scale(1, 0.58);
    c.fillStyle = G.ruff;
    c.beginPath(); c.arc(0, 0, D.bodyHW * 0.44 * D.neckRuff, 0, TAU); c.fill();
    c.restore();

    /* ---- occlusion where the head meets the chest ---- */
    c.save();
    c.globalAlpha = 0.16; c.fillStyle = '#6b3a24';
    ell(c, P.headX * 0.85, P.headY + D.headHH * 0.98, D.headHW * 0.57, D.headHH * 0.28); c.fill();
    c.globalAlpha = 1;
    c.restore();

    /* ---- head group ---- */
    c.save();
    c.translate(P.headX, P.headY);
    c.rotate(P.headRot);

    const farIsLeft = P.yaw < 0;
    const earScale = 1 + s.perk.x * 0.06;
    if (farIsLeft) drawEar(c, -1, P.yaw, s.earBack.x, s.earL.x, earScale);
    else drawEar(c, 1, P.yaw, s.earBack.x, s.earR.x, earScale);

    /* pseudo-3D silhouette skew + pitch foreshortening */
    const yawSkew = P.yaw * R.parallax.skew * rig.mo.parallax;
    const warp = (x, y) => [
      x + yawSkew * (1 - Math.abs(x) / D.headHW * 0.45),
      y * (1 - P.pitch * R.parallax.pitchSquash) - P.pitch * R.parallax.pitchShift,
    ];
    const hb = buildPart('head', pet, 1, 1, P.headX, P.headY, 1.0, warp);
    c.beginPath(); crClosed(c, hb.o, 1);
    c.fillStyle = pal.line; c.fill();
    c.beginPath(); crClosed(c, hb.p, 1);
    c.fillStyle = G.head; c.fill();
    c.save(); c.clip();
    c.fillStyle = G.headShade;
    c.fillRect(-D.headHW * 1.3, -D.headHH * 1.3, D.headHW * 2.6, D.headHH * 2.6);
    drawFur(c, 'head', hb, D.headHH, P.headX, P.headY);
    drawFace(c, aff, petLevel);
    c.fillStyle = G.rim;
    c.fillRect(-D.headHW * 1.3, -D.headHH * 1.3, D.headHW * 2.6, D.headHH * 2.6);
    c.restore();

    if (farIsLeft) drawEar(c, 1, P.yaw, s.earBack.x, s.earR.x, earScale);
    else drawEar(c, -1, P.yaw, s.earBack.x, s.earL.x, earScale);

    c.restore();  /* head group */
    c.restore();  /* dog */
  }

  return { draw, get grads() { return G; } };
}

export default createDogRenderer;
