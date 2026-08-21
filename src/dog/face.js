/* ==========================================================================
   dog/face.js — THE EYE, THE NOSE AND THE MOUTH.

   Moved out of dog/draw.js unchanged so the profile view can draw a real face
   instead of an approximation of one. Its first face was an ellipse with a dot
   on it; these three functions are the ones eight stages of looking produced:

     - the EYE is a lens with an authored LID SHAPE, not a circle, and its
       catchlight slides further than the lens does — cheap parallax inside the
       eye, which is what makes a glance read as a glance. The highlight is
       deliberately a small bright spot on a large dark lens: anything bigger
       reads as visible sclera, and visible sclera on a dog reads as whale-eye,
       i.e. anxious or shifty.
     - the NOSE is an eight-point closed curve with a soft specular, not a bean.
     - the MOUTH is the game's primary mood channel (ARCHITECTURE §12.1), with
       five per-breed multipliers on the numbers that carry its expression.

   What used to be closed over — the palette, the muzzle dimension, the breed's
   mouth multipliers and `BALANCE.rig` — is an options bag now. `dog/draw.js`
   keeps thin shims so all of its call sites are untouched, which is what lets
   `tools/bowlpixels.py` and `tools/breedproof.py` prove the move changed nothing.
   ========================================================================== */
import { TAU, clamp, lerp, pt, ell, crClosed, rgba } from '../engine/draw.js';

export function drawEye(c, ex, ey, w, h, open, smi, tiltA, side, lead, o) {
  const pal = o.pal, R = o.R, faceCap = o.faceCap || {};
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
    /* A SPECULAR MUST STAY SMALL, AND IT MUST SHRINK WITH THE LID.
       Both radii used to be authored off different axes: ry off `hh` (which
       collapses as the eye closes) but rx off `w` (which does not). So the
       moment the eye squinted — every petting frame, every happy blink — the
       highlight stopped being a round glint and became a WIDE WHITE BAR
       spanning 42% of the eye on a lens only a couple of units tall. On a
       narrowed eye that bar is indistinguishable from exposed sclera, and
       sclera is the single strongest "this dog is uneasy" cue there is. It is
       most of why the Schnoodle read as sly rather than pleased.
       `k` is how open the lid actually is; the highlight now narrows with it,
       so it stays a glint in every pose.
       OPT-IN, like every other face capability: a breed that does not set
       `face.eyeHi` resolves kx=1 and s=1 and renders byte-identically to
       before, so the Shiba and the Cockapoo (whose eyes both read correctly
       already) are untouched. */
    const HI = faceCap.eyeHi === undefined ? null : faceCap.eyeHi;
    const k = HI === null ? 1 : clamp(hh / Math.max(1e-4, h * 0.5), 0, 1.25);
    const kx = HI === null ? 1 : 0.52 + 0.48 * k;
    const s = HI === null ? 1 : HI;
    c.fillStyle = pal.eyeHi; c.globalAlpha = 0.96 * hv;
    ell(c, w * 0.19 - cx, -hh * 0.40 - cy, w * 0.21 * kx * s, hh * 0.29 * s, -0.45); c.fill();
    /* the bounce light off the cheek. Shrunk with the lid for the same
       reason: on a crescent eye this sits in the lower half, which is exactly
       where sclera would show on an anxious dog. */
    c.globalAlpha = 0.50 * hv * (HI === null ? 1 : 0.35 + 0.65 * k);
    ell(c, -w * 0.20, hh * 0.34, w * 0.11 * kx * s, hh * 0.15 * s, 0.3); c.fill();
    c.globalAlpha = 1; c.restore();
  }
}

/* the pair, so drawFace and the deferred `eyesOver` path cannot drift apart */
export function drawNose(c, nsx, nsy, o) {
  const pal = o.pal, D = o.D, faceCap = o.faceCap || {};
  const nw = D.muzY * 0.42 * (faceCap.noseSize === undefined ? 1 : faceCap.noseSize);
  c.save(); c.translate(nsx, nsy);
  c.beginPath();
  crClosed(c, [pt(0, -nw * 0.78), pt(nw * 0.89, -nw * 0.61), pt(nw, nw * 0.17), pt(nw * 0.42, nw * 0.75),
    pt(0, nw * 0.83), pt(-nw * 0.42, nw * 0.75), pt(-nw, nw * 0.17), pt(-nw * 0.89, -nw * 0.61)], 1);
  c.fillStyle = pal.nose; c.fill();
  c.fillStyle = 'rgba(255,255,255,0.32)';
  ell(c, -nw * 0.30, -nw * 0.33, nw * 0.39, nw * 0.24, -0.4); c.fill();
  c.restore();
}

export function drawMouth(c, mx, my, op, smi, tg, o) {
  const pal = o.pal, D = o.D, MK = o.MK;
  const cw = (D.muzY * 0.62 + smi * 3.2) * MK.w;
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
  const dip = (2.6 - smi * 1.1) * MK.dip;
  const corner = (-2.2 - smi * 5.6) * MK.lift + (op > 0.03 ? 1.4 : 0);
  c.strokeStyle = pal.line; c.lineWidth = 2.2 * MK.weight; c.lineCap = 'round';
  c.beginPath();
  c.moveTo(mx, lipY - 5.0);
  c.quadraticCurveTo(mx - cw * 0.52, lipY + dip, mx - cw, lipY + corner);
  c.stroke();
  c.beginPath();
  c.moveTo(mx, lipY - 5.0);
  c.quadraticCurveTo(mx + cw * 0.52, lipY + dip, mx + cw, lipY + corner);
  c.stroke();
  /* the philtrum grows DOWNWARD from a fixed top, so shortening it cannot
     slide the lip line off the muzzle */
  c.lineWidth = 1.8 * MK.weight;
  c.beginPath(); c.moveTo(mx, lipY - 5.2 - 4.3 * MK.philtrum); c.lineTo(mx, lipY - 5.2); c.stroke();
}

/**
 * A HANGING EAR. `rig.pose.earNodes[e]` is a spring chain resolved in rig.js
 * in a canonical frame where +x is outward from the skull and +y is down; we
 * mirror x for the near/far side exactly as the rigid ear does.
 *
 * The ear is the single best piece of secondary motion on a floppy breed, so
 * it is drawn as a real tapered ribbon over the chain rather than a rotated
 * sprite: the tip genuinely lags, overshoots and settles last.
 */
