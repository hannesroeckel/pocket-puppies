/* ==========================================================================
   engine/draw.js — Canvas2D helpers + maths + colour ramps.
   The `g` object handed to scenes (`scene.draw(app, g)`) wraps the 2D context
   and carries the view transform. Everything here is pure / stateless.
   ========================================================================== */

export const TAU = Math.PI * 2;

/* ---- scalar maths ------------------------------------------------------ */
export const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const smoother = (t) => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
export const easeOut3 = (t) => 1 - Math.pow(1 - t, 3);
export const easeIn3 = (t) => t * t * t;
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutBack = (t, s = 1.9) => { const u = t - 1; return 1 + (s + 1) * u * u * u + s * u * u; };
export const easeOutElastic = (t) => (t <= 0 ? 0 : t >= 1 ? 1
  : Math.pow(2, -9 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1);
/** 0 -> 1 -> 0 */
export const hump = (t) => Math.sin(clamp(t, 0, 1) * Math.PI);
/** ramps in, holds, ramps out */
export function plateau(t, inT, outT) {
  if (t < inT) return smooth(t / inT);
  if (t > 1 - outT) return smooth((1 - t) / outT);
  return 1;
}
export const pt = (x, y) => ({ x, y });

/* ---- colour ----------------------------------------------------------- */
export function hex2rgb(h) {
  h = h.trim();
  if (h[0] === '#') h = h.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgb2hex(r, g, b) {
  const q = (v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  return '#' + q(r) + q(g) + q(b);
}
/** blend two hex colours; t=0 -> a, t=1 -> b */
export function mix(a, b, t) {
  const A = hex2rgb(a), B = hex2rgb(b);
  return rgb2hex(lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t));
}
export const lighten = (c, t) => mix(c, '#fff2d8', t);
export const darken = (c, t) => mix(c, '#2a160c', t);
/** hex + alpha -> rgba() string */
export function rgba(c, a) {
  const [r, g, b] = hex2rgb(c);
  return `rgba(${r},${g},${b},${(+a).toFixed(3)})`;
}

/* ---- paths ------------------------------------------------------------ */
/** Closed Catmull-Rom through `p`, emitted as cubic beziers. Organic shapes. */
export function crClosed(c, p, tension = 1) {
  const n = p.length;
  if (n < 3) return;
  c.moveTo(p[0].x, p[0].y);
  for (let i = 0; i < n; i++) {
    const p0 = p[(i - 1 + n) % n], p1 = p[i], p2 = p[(i + 1) % n], p3 = p[(i + 2) % n];
    c.bezierCurveTo(
      p1.x + (p2.x - p0.x) / 6 * tension, p1.y + (p2.y - p0.y) / 6 * tension,
      p2.x - (p3.x - p1.x) / 6 * tension, p2.y - (p3.y - p1.y) / 6 * tension,
      p2.x, p2.y);
  }
  c.closePath();
}
/** Open Catmull-Rom polyline. */
export function crOpen(c, p, tension = 1) {
  const n = p.length;
  if (n < 2) return;
  c.moveTo(p[0].x, p[0].y);
  for (let i = 0; i < n - 1; i++) {
    const p0 = p[i > 0 ? i - 1 : 0], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2 < n ? i + 2 : n - 1];
    c.bezierCurveTo(
      p1.x + (p2.x - p0.x) / 6 * tension, p1.y + (p2.y - p0.y) / 6 * tension,
      p2.x - (p3.x - p1.x) / 6 * tension, p2.y - (p3.y - p1.y) / 6 * tension,
      p2.x, p2.y);
  }
}
/** Tapered ribbon from a polyline + per-node half widths (tails, legs). */
export function ribbon(c, nodes, widths) {
  const n = nodes.length, left = [], right = [];
  for (let i = 0; i < n; i++) {
    const px = nodes[Math.max(0, i - 1)], nx = nodes[Math.min(n - 1, i + 1)];
    const dx = nx.x - px.x, dy = nx.y - px.y, L = Math.hypot(dx, dy) || 1;
    const nxv = -dy / L, nyv = dx / L, w = widths[i];
    left.push(pt(nodes[i].x + nxv * w, nodes[i].y + nyv * w));
    right.push(pt(nodes[i].x - nxv * w, nodes[i].y - nyv * w));
  }
  right.reverse();
  crClosed(c, left.concat(right), 0.85);
}
export function roundRect(c, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.lineTo(x + w - rr, y); c.quadraticCurveTo(x + w, y, x + w, y + rr);
  c.lineTo(x + w, y + h - rr); c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  c.lineTo(x + rr, y + h); c.quadraticCurveTo(x, y + h, x, y + h - rr);
  c.lineTo(x, y + rr); c.quadraticCurveTo(x, y, x + rr, y);
  c.closePath();
}
export function ell(c, x, y, rx, ry, rot) {
  c.beginPath();
  c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot || 0, 0, TAU);
}
/** 2-bone IK: returns the elbow/knee position. */
export function ik(hx, hy, px, py, l1, l2, sign) {
  const dx = px - hx, dy = py - hy;
  let d = Math.hypot(dx, dy);
  d = clamp(d, Math.abs(l1 - l2) + 0.02, l1 + l2 - 0.02);
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const base = Math.atan2(dy, dx) + Math.acos(cosA) * sign;
  return pt(hx + Math.cos(base) * l1, hy + Math.sin(base) * l1);
}

/**
 * Resample a closed point loop with Catmull-Rom interpolation.
 * Returns `sub` points per input segment. Used so silhouettes can be dented
 * by the petting field and scalloped for fur at a finer resolution than the
 * authored control points.
 */
export function resampleClosed(p, sub) {
  const n = p.length, out = [];
  for (let i = 0; i < n; i++) {
    const p0 = p[(i - 1 + n) % n], p1 = p[i], p2 = p[(i + 1) % n], p3 = p[(i + 2) % n];
    for (let s = 0; s < sub; s++) {
      const t = s / sub, t2 = t * t, t3 = t2 * t;
      out.push(pt(
        0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)));
    }
  }
  return out;
}

/** Outward normals for a closed loop (unit length, pointing away from centre). */
export function loopNormals(p) {
  const n = p.length, out = [];
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) { cx += p[i].x; cy += p[i].y; }
  cx /= n; cy /= n;
  for (let i = 0; i < n; i++) {
    const a = p[(i - 1 + n) % n], b = p[(i + 1) % n];
    let nx = b.y - a.y, ny = -(b.x - a.x);
    const L = Math.hypot(nx, ny) || 1;
    nx /= L; ny /= L;
    /* make sure it points outward */
    if ((p[i].x - cx) * nx + (p[i].y - cy) * ny < 0) { nx = -nx; ny = -ny; }
    out.push(pt(nx, ny));
  }
  return out;
}

/* ---- palette derivation ----------------------------------------------
   A breed only has to supply the eight canonical palette keys. The full
   render ramp is derived, so adding a breed stays a data entry.
   ---------------------------------------------------------------------- */
export function derivePalette(p) {
  const coat = p.coat, sh = p.coatShade, cream = p.cream;
  const out = {
    coat,
    coatHi: mix(coat, '#fff0cc', 0.44),
    coatMid: mix(coat, sh, 0.52),
    coatSh: sh,
    coatDeep: darken(sh, 0.22),
    cream,
    creamMid: mix(cream, sh, 0.13),
    creamSh: mix(cream, sh, 0.30),
    line: darken(sh, 0.40),
    line2: darken(sh, 0.30),
    nose: p.nose,
    eye: p.eye,
    eyeHi: '#fffaf0',
    tongue: p.tongue,
    tongueSh: darken(p.tongue, 0.20),
    mouth: darken(p.tongue, 0.68),
    inner: mix(p.blush, cream, 0.30),
    blush: p.blush,
    pad: p.pad,
  };
  if (p.extra) Object.assign(out, p.extra);
  return out;
}

/* ---- the `g` wrapper -------------------------------------------------- */
/**
 * View-aware wrapper handed to scenes. `g.ctx` is the raw 2D context;
 * `g.view` describes the virtual->device mapping.
 */
export function createG(ctx, view) {
  return {
    ctx,
    view,
    /** set the transform to virtual design space (390x844) */
    toVirtual(scale) {
      const s = scale === undefined ? view.dpr : scale;
      ctx.setTransform(s * view.vs, 0, 0, s * view.vs, s * view.offX, s * view.offY);
    },
    /** set the transform to raw device pixels */
    toDevice() { ctx.setTransform(1, 0, 0, 1, 0, 0); },
    save() { ctx.save(); }, restore() { ctx.restore(); },
    roundRect: (x, y, w, h, r) => roundRect(ctx, x, y, w, h, r),
    ell: (x, y, rx, ry, rot) => ell(ctx, x, y, rx, ry, rot),
    crClosed: (p, t) => crClosed(ctx, p, t),
    crOpen: (p, t) => crOpen(ctx, p, t),
    ribbon: (nodes, widths) => ribbon(ctx, nodes, widths),
    fill(style) { if (style) ctx.fillStyle = style; ctx.fill(); },
    stroke(style, w) { if (style) ctx.strokeStyle = style; if (w) ctx.lineWidth = w; ctx.stroke(); },
  };
}

/** Offscreen canvas of device-pixel size. */
export function makeOff(w, h) {
  const o = document.createElement('canvas');
  o.width = Math.max(1, w | 0); o.height = Math.max(1, h | 0);
  return o;
}
