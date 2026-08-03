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

/* ==========================================================================
   DECLARATIVE CAPABILITY TABLES — extend these, never special-case a breed.

   `fur.type` and `ear` in breed data are strings that index these tables.
   A breed says WHAT it is; the tables say what that MEANS to the renderer.

   --- how a curly coat is made to read as curly -------------------------
   The silhouette is what the eye reads first. Curly texture painted inside a
   smooth outline reads as a smooth dog with a pattern on it, so `tuft` breaks
   the OUTLINE itself into convex lobes meeting at soft cusps — the way a
   cloud reads as fluffy. Three cooperating layers:

     tuft    displaces the silhouette path along its normals by
             |sin(pi*cycles*u)|^pow — a run of convex arcs separated by
             cusps — with a phase warp and an amplitude modulation so the
             lobes are irregular rather than a machined ripple. This is the
             path used for the fill AND the clip AND the dark outline, so the
             whole shape is genuinely tufted, not decorated.
     fringe  overlapping lobes drawn BEHIND the part, poking past the
             outline at irregular places. Depth of coat, broken edge.
     curl    interior texture: stroked C-arcs instead of the short coat's
             straight tapered strands, plus flyaway curls straddling the rim.

   `resample` raises the silhouette point count for the breeds that need it —
   42 points cannot express 14 tufts. Absent = BALANCE.fur.resample (3).
   A profile with no `tuft` key takes the original code path exactly, which
   is why the Shiba is untouched.
   ========================================================================== */
const FUR_TYPE = {
  short: { scallop: 1.0, lobe: 1.0, alpha: 1.0 },
  long: { scallop: 2.3, lobe: 1.7, alpha: 1.15 },
  /* a loose open wave — cockapoo in a teddy-bear trim.
     NOTE on `fringe`: the radii are small and the count high ON PURPOSE. The
     first pass used ~18 big lobes pushed well outside the outline and the
     render came back with a visible RING OF BEADS around the dog — which is
     architecture §6 art defect 1 (fur reading as nubs) wearing a new
     costume. Many small lobes sitting mostly INSIDE the edge merge into one
     continuous broken contour instead of staying countable. */
  wavy: {
    scallop: 0.55, lobe: 1.30, alpha: 1.05, resample: 7,
    /* bodyScale > 1: the head came back convincingly scalloped and the body
       smooth beside it, because the body's outline is mostly hidden behind the
       ears, the legs and the chest ruff and only a strip of flank is ever read. */
    tuft: { cycles: 11, pow: 0.70, amp: 3.1, warp: 0.026, mod: 0.40, cyc2: 23, oct2: 0.30, bodyScale: 1.34 },
    fringe: { n: 40, r: 0.052, out: 0.16, alpha: 0.40, jitter: 0.75, headScale: 1.0 },
    /* short, wide and faint: see the note in drawFur. Long thin high-contrast
       arcs read as pen scribble on the coat, not as curl. */
    curl: { arcs: 3, sweep: 1.55, alpha: 0.15, width: 2.6, radius: 0.50, shade: 0.5 },
    fly: { n: 15, len: 0.055, alpha: 0.24, width: 1.4, sweep: 2.2 },
  },
  /* a tight springy curl — more lobes, rounder, deeper */
  curly: {
    scallop: 0.50, lobe: 1.18, alpha: 0.92, resample: 8,
    tuft: { cycles: 15, pow: 0.62, amp: 3.3, warp: 0.022, mod: 0.46, cyc2: 31, oct2: 0.34 },
    fringe: { n: 46, r: 0.046, out: 0.18, alpha: 0.42, jitter: 0.80, headScale: 1.0 },
    curl: { arcs: 4, sweep: 3.5, alpha: 0.28, width: 1.4, radius: 0.50 },
    fly: { n: 20, len: 0.048, alpha: 0.26, width: 1.3, sweep: 3.1 },
  },
  /* TOUSLED — loose soft curls, shaggy and irregular. The Schnoodle's coat.
     ---------------------------------------------------------------------
     He used to be `wiry`, and `wiry` is a clipped harsh jacket: its whole job is
     to keep the head SMOOTH (tuft headScale 0.42, fringe headScale 0.28) so a
     rectangular skull can read. That is the correct capability for an adult
     schnauzer in a show trim, and it was actively fighting the target — a bare
     hard-edged skull is severe, and the reference is a shaggy young doodle whose
     head outline is broken curl all the way round.

     It is not `curly` either: `curly` is a tight springy ringlet (4 arcs at
     sweep 3.5, alpha 0.28) and the reference is explicit that the curls are
     loose and soft, not tightly crimped.

     So this sits between the Cockapoo's `wavy` and `curly`, and is deliberately
     SCRUFFIER than `wavy` in the two places you can actually see it: the tuft
     profile is coarser and less regular (amp 3.6 vs 3.1, warp 0.040 vs 0.026,
     mod 0.55 vs 0.40), and the curl arcs are twice as pronounced (sweep 2.1 /
     alpha 0.19 vs 1.55 / 0.15). Head tufting is near-full, which is what rounds
     and softens the skull that `wiry` was keeping bare. That difference in
     texture is one of the four things keeping the two dogs apart. */
  tousled: {
    scallop: 0.60, lobe: 1.34, alpha: 1.0, resample: 8,
    tuft: { cycles: 14, pow: 0.66, amp: 3.6, warp: 0.040, mod: 0.55, cyc2: 29, oct2: 0.40,
      headScale: 0.92, bodyScale: 1.42 },
    fringe: { n: 44, r: 0.052, out: 0.15, alpha: 0.42, jitter: 0.88, headScale: 1.0 },
    /* wider and fainter than `curly`: a loose open curl, not a crimp */
    curl: { arcs: 3, sweep: 2.1, alpha: 0.19, width: 2.2, radius: 0.62, shade: 0.5 },
    fly: { n: 18, len: 0.058, alpha: 0.26, width: 1.35, sweep: 1.9 },
  },
  /* Harsh and scruffy: fewer, pointier, less regular tufts. A wiry coat does
     not curl into ringlets, it breaks into uneven wisps.
     `skirt` keeps the back sleek and hangs the coat low, and `headScale` is
     LOW because a schnauzer trim clips the head, ears, throat and cheeks very
     close — the fluff on this breed lives in the furnishings, and a smooth
     head is what lets the rectangular skull read at all. */
  wiry: {
    scallop: 0.62, lobe: 0.92, alpha: 0.86, resample: 7,
    /* `skirt` down from 0.55: ramping this hard from sleek spine to full skirt
       squared the barrel off into a slab with straight vertical sides. And
       `bodyScale` up, so the flank that IS visible breaks into tufts rather
       than running as one smooth wall — the boxiness was as much a missing
       broken edge as it was the outline underneath. */
    /* `pow` down from 1.30: at 1.3 the profile is near-zero almost everywhere
       with a few sharp spikes, which rendered as a SMOOTH wall with occasional
       notches rather than as a broken coat — the boxiness the report kept
       flagging was largely this. 1.02 still gives pointier, less regular lobes
       than the cockapoo's 0.70 (that is the wiry read) but they actually run
       the length of the flank. `bodyScale` up to 1.55 now that it is no longer
       being discarded by `skirt`, and `headScale` nudged to 0.42 so a clipped
       skull keeps a hint of texture without going fluffy. */
    tuft: { cycles: 13, pow: 1.02, amp: 3.4, warp: 0.048, mod: 0.62, cyc2: 27, oct2: 0.44, skirt: 0.34, headScale: 0.42, bodyScale: 1.55 },
    /* The fluff now has to come from the SILHOUETTE (see the partK fix and
       bodyScale), not from lobes floating outside it. So the fringe sits
       tighter to the edge (`out` 0.20 -> 0.08), is denser so the bumps merge
       into one broken contour instead of staying countable, and wears a thin
       OPAQUE ink rim instead of a wide translucent one. */
    fringe: { n: 40, r: 0.056, out: 0.12, alpha: 1, jitter: 0.95, headScale: 0.28,
      rimAlpha: 1, rimK: 0.20, rimMax: 1.1 },
    curl: { arcs: 3, sweep: 1.2, alpha: 0.16, width: 2.2, radius: 0.95, shade: 0.5 },
    fly: { n: 16, len: 0.062, alpha: 0.26, width: 1.3, sweep: 1.2 },
  },
};

/* ---- ear capability ----------------------------------------------------
   `spread`/`back`/`droop`/`scaleY` drive the RIGID path (a prick ear is one
   triangle and needs nothing more). `chain: true` switches to the spring
   chain built in rig.js from BALANCE.rig.earChain — a hanging ear is a
   multi-joint ribbon that swings, lags and flops.

   `zoneAt`/`zoneR` adjust the `ear` PETTING zone. The zone table in
   balance.js describes a pricked ear: a circle on the crown, where both ear
   bases are. Hang the ears down beside the face and that circle no longer
   covers the thing the player will actually reach for, so the capability
   moves and widens its own zone. prick = [0,0] x1, i.e. exactly as before.

   `width` is the ribbon half-width profile down the chain, x earW/2.
   `flatten` is how much `earBack` presses the leather against the skull. */
const EAR_STYLE = {
  prick: { spread: 0.30, back: 0.62, droop: 0, scaleY: 1, zoneAt: [0, 0], zoneR: 1 },
  /* A SPANIEL EAR IS LOBULAR: narrow at the attachment, widening downward,
     ROUNDED at the bottom. Drawing it as a tapering triangle is one of the
     named tells that makes a cockapoo read generic. So the width profile
     PEAKS LOW and stays wide to the tip instead of coming to a point. */
  floppy: {
    chain: true, behind: true, back: 0.10, zoneAt: [0, 0], zoneR: 1.75, zonePri: 1.34,
    width: [0.40, 0.74, 0.94, 1.00, 0.94, 0.68], flatten: 0.18,
    inner: 0.16,        // barely a sliver: a hanging ear shows almost no lining
    feather: 1.35,      // the ear coat is the LONGEST on the dog
  },
  /* A SEMI-FLOPPED DOODLE EAR: broad through the middle and ROUNDED at the
     tip, hanging beside the face.
     The width profile used to be [0.78, 1.00, 0.74, 0.42, 0.18] — peaking at
     the top and tapering to a point — which is a clipped adult button ear, and
     rendered together with the old outward-lifted hang angles it gave two hard
     pointed flaps standing off the head. A pointed taper is also the same
     "tapering triangle" fault this table already calls out by name for the
     spaniel ear directly above.
     So it now peaks LOW and stays wide to a rounded tip, like the floppy
     profile, just shorter. `inner` drops from 0.34 to 0.12 because a curly ear
     hanging beside the face shows almost no lining, and the visible sliver was
     drawing a pale line down the middle of each ear. */
  /* `behind: true`, copied from the spaniel ear above, and it is what finally
     made these read as ears rather than as flaps. Drawn in FRONT (as they were)
     the attachment is a visible ribbon end laid over the side of the skull, and
     there is nothing you can do to that seam: it is a hard edge across the head
     where no edge belongs. Drawn behind, the head's own scalloped fur boundary
     covers the root completely, and what you see is the part that hangs clear of
     the skull — which is also the part that frames the face. Combined with a
     narrow root (width[0] 0.34) there is simply no seam left to notice. */
  semi: {
    chain: true, behind: true, back: 0.16, zoneAt: [0, 0.06], zoneR: 1.45,
    width: [0.34, 0.62, 0.88, 1.00, 0.92, 0.62], flatten: 0.24,
    inner: 0.12, feather: 0.45, rim: 0.18,
    /* A CLIPPED EAR IS A SCALLOPED EDGE, NOT A ROW OF BEADS. `feather` is
       already low, which means few and small lobes — and a small lobe pushed
       most of the way outside the leather is exactly a nub, whereas a large
       one (the Cockapoo's, feather 1.35) overlaps its neighbours and merges.
       Tucking them under helped and was not enough, so this ear gives up
       applied lobes entirely and undulates its own outline instead. */
    tuck: 0.78,
    /* GENTLY. At amp 0.30 / 4.5 cycles the hem stopped being fur and became a
       POLYGON — long straight facets meeting in a deep concave notch near the
       root that read as a bite out of the ear. A fur edge is a small, frequent,
       shallow undulation; anything you can count the sides of is a shape.
       Nudged up to 11 cycles / amp 0.16 with more subdivision now that the coat
       is `tousled` rather than clipped `wiry`: still small and frequent (which is
       the rule above), just enough that the ear edge reads as curl and not as
       leather. More cycles, not more amplitude — that is what keeps it off the
       polygon. */
    scallop: { cycles: 11, pow: 0.72, amp: 0.16, sub: 9 },
  },
};

export { FUR_TYPE, EAR_STYLE };

export function createDogRenderer(rig) {
  const pal = rig.pal;
  const D = rig.dims;
  const PR = rig.breed.proportions;
  const furType = FUR_TYPE[rig.breed.fur.type] || FUR_TYPE.short;
  const earStyle = EAR_STYLE[rig.breed.ear] || EAR_STYLE.prick;
  const creamTail = mix(pal.cream, pal.coat, R.tail.creamMix);

  /* ==================================================================
     FACE CAPABILITY — declarative, like `ear` and `fur.type`.

     `eyesOver`   draw the EYES after the facial furnishings, for exactly the
                  same reason as `mouthOver`. A brow furnishing is a tufted
                  pale mass anchored over the eye, and it is drawn after the
                  face — so its tuft peaks and its dark rim were biting NOTCHES
                  out of the top of the eye. Measured on the Schnoodle: the
                  brow's visible bottom edge (path + up to 1.9 units of tuft +
                  a 2-unit rim) landed 8.6 units below the eye's top, which is
                  67% of the upper lid. What survived was a thin crescent with
                  the catchlight stranded at the bottom of it — and a narrow
                  eye with a bright patch under a heavy brow does not read as
                  hooded, it reads as SLY. Deferring the lens past the
                  furnishings means the brow may overhang as far as the anatomy
                  wants and the eye still renders whole: the brow then appears
                  to rest ON the eye's top lash, which is the "peering out from
                  under" read this breed needs, at no cost to eye area.
     `eyeHi`      scale on the specular highlight (default 1). See drawEye: the
                  highlight has to stay a SMALL bright spot on a large dark
                  lens. Anything bigger reads as visible sclera, which on a dog
                  reads as whale-eye — i.e. anxious or shifty.
     `mouthOver`  draw the mouth AFTER the facial furnishings instead of
                  under them. A breed whose beard and moustache cover the
                  jaw otherwise has no mouth at all: the furniture is drawn
                  on top of the face, so the only thing left visible between
                  moustache and beard is a window of dark muzzle — which
                  rendered as a gaping black hole and made the dog look
                  miserable. The mouth is this game's primary mood channel
                  (§12.1), so on such a breed it is the LAST thing drawn and
                  it reads as a dark line on the pale furnishings, which is
                  also how a cheeky schnauzer is drawn on paper.
     `mouth`      multipliers on the five numbers that carry the mouth's
                  expression. Every one defaults to 1, i.e. the Shiba's
                  original constants, so a breed that says nothing renders
                  byte-identically to before.
                    w         mouth width
                    lift      how far the corners rise (the cheeky knob)
                    dip       how deep the line sags between centre and corner
                    philtrum  length of the vertical lip line
                    weight    stroke weight
     ================================================================== */
  const faceCap = rig.breed.face || {};
  const MK = (() => {
    const m = faceCap.mouth || {};
    const d = (v) => (v === undefined ? 1 : v);
    return { w: d(m.w), lift: d(m.lift), dip: d(m.dip), philtrum: d(m.philtrum), weight: d(m.weight) };
  })();
  /* set by drawFace, consumed by draw() after the furnishings — see mouthOver */
  let lateMouth = null;
  /* set by drawFace, consumed by draw() after the furnishings — see eyesOver */
  let lateEyes = null;
  let lateNose = null;

  /* ---- static resampled outlines (scaled per frame, never rebuilt) ----
     A curly breed needs many more points than the Shiba's 42: you cannot
     express fifteen tufts on fourteen control points. */
  const sub = furType.resample || FU.resample;
  const base = {
    body: resampleClosed(rig.sil.body, sub),
    head: resampleClosed(rig.sil.head, sub),
  };
  /* scratch buffers, reused every frame — zero allocation in the hot path */
  const buf = {
    body: { p: base.body.map(() => pt(0, 0)), o: base.body.map(() => pt(0, 0)), n: null },
    head: { p: base.head.map(() => pt(0, 0)), o: base.head.map(() => pt(0, 0)), n: null },
  };

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
  const tuftProfile = {};
  if (TU) {
    for (const key of ['body', 'head']) {
      const n = base[key].length;
      const raw = new Float32Array(n);
      /* a per-part phase so the head and body are not in lockstep */
      const ph = key === 'head' ? 2.39 : 0.41;
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
         ribcage curves under. That pattern break IS the breed — a wiry dog
         drawn as uniform fluff reads as a generic doodle. So tuft depth ramps
         from sleek at the spine to full at the skirt. `skirt: 0` = uniform. */
      const skirt = TU.skirt || 0;
      const phh = key === 'head' ? D.headHH : D.bodyHH;
      /* A clipped head is a different length of coat from the body — and the
         reverse is true too. The body's silhouette is mostly OCCLUDED (ears,
         front legs, chest ruff, the rug), so only a narrow strip of flank is
         ever read; at the head's amplitude that strip came back looking smooth
         next to an emphatically scalloped skull. `bodyScale` lets a breed spend
         more tuft where less of it is visible, so the fluffy read is continuous
         head-to-rump. Both default to 1 = the old uniform behaviour. */
      const partK = key === 'head'
        ? (TU.headScale === undefined ? 1 : TU.headScale)
        : (TU.bodyScale === undefined ? 1 : TU.bodyScale);
      for (let i = 0; i < n; i++) {
        /* partK and the skirt MULTIPLY. They used to not: `k = lerp(...)`
           overwrote partK outright, so any breed that set `skirt` silently
           threw away its own `bodyScale` and `headScale`. That is why the
           Schnoodle's flank rendered as a smooth wall with the fluff living
           entirely in translucent lobes outside it (bodyScale 1.22 never
           applied), while its clipped head got 2-3x the tuft it asked for
           (headScale 0.30 never applied). Both numbers were written to fix
           exactly the defects that then got reported. */
        let k = partK;
        if (skirt) {
          const ny = clamp(base[key][i].y / phh, -1, 1);   // -1 top, +1 bottom
          k *= lerp(1 - skirt, 1 + skirt * 0.45, (ny + 1) / 2);
        }
        out[i] = TU.amp * (raw[i] - mean + net) * k;
      }
      tuftProfile[key] = out;
    }
  }

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

    /* muzHi/muzMid/muzSh default to the cream ramp; a breed with a dark facial
       mask overrides them in palette.extra */
    G.muz = c.createLinearGradient(0, -D.muzY - 4, 0, D.muzY + 6);
    G.muz.addColorStop(0, pal.muzHi);
    G.muz.addColorStop(0.45, pal.muzMid);
    G.muz.addColorStop(1, pal.muzSh);

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
  function buildPart(key, pet, sx, sy, ox, oy, gain, warp, wet) {
    const src = base[key], b = buf[key], n = src.length;
    const p = b.p, o = b.o;
    /* 1. scale into pose space (+ optional warp for head yaw/pitch) */
    for (let i = 0; i < n; i++) {
      let x = src[i].x * sx, y = src[i].y * sy;
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
      const prof = tuftProfile[key];
      const k = 1 - clamp(wet || 0, 0, 1) * 0.68;
      for (let i = 0; i < n; i++) {
        const d = prof[i] * k;
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
  function drawFur(c, part, b, hh, ox, oy, wet) {
    const list = rig.fur[part];
    if (!list.length) return;
    const p = b.p, norms = b.n, n = p.length;
    /* WET FUR LIES DOWN. Flattening the clumps is most of what makes a wet
       dog read as wet rather than as a dog with a blue filter on it. */
    const flat = 1 - clamp(wet || 0, 0, 1) * 0.62;
    const len = FU.lobeLen * hh * furType.lobe * flat;
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

      /* A CURLY coat's interior texture is not straight strands — it is a
         scatter of little arcs. Same principle (thin, low-alpha, along the
         body curve), different mark.

         WHY THESE ARE SHORT, FAT AND FAINT. The first pass drew long thin
         high-contrast arcs (sweep ~2.5 rad at width 1.4), and rendered they read
         as PEN SCRIBBLE — legible individual strokes, like someone had written
         on the dog. A curl's read is a soft crescent of shading, so: the sweep
         is under ~100 degrees, the stroke is WIDE (a wide low-alpha stroke is a
         soft band, a thin one is a line), the alpha is halved, and the shadow
         pair is offset by a fraction of the stroke width instead of a fixed
         1.1 units so the two never separate into two visible marks. */
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

  /** deterministic 0..1 jitter — the coat must look the same every frame */
  function hash1(i, salt) {
    const v = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453;
    return v - Math.floor(v);
  }

  /** sample the live outline at parameter u -> [x, y, nx, ny] */
  function sampleOutline(b, u) {
    const p = b.p, norms = b.n, n = p.length;
    const fi = ((u % 1) + 1) % 1 * n;
    const i0 = Math.floor(fi) % n, i1 = (i0 + 1) % n, ft = fi - Math.floor(fi);
    return [
      lerp(p[i0].x, p[i1].x, ft), lerp(p[i0].y, p[i1].y, ft),
      lerp(norms[i0].x, norms[i1].x, ft), lerp(norms[i0].y, norms[i1].y, ft),
    ];
  }

  /**
   * THE UNDER-FRINGE. Overlapping soft lobes drawn BEHIND the part, poking
   * past the silhouette at irregular intervals. This is what stops a tufted
   * outline reading as a single scalloped cutout: the edge gains depth and
   * breaks in places the main path does not, which is how real coat reads.
   * Drawn before the part's own outline pass, so the part always covers their
   * roots and they can never look like separate blobs.
   */
  function drawFringe(c, key, b, hh, wet) {
    const FR = furType.fringe;
    if (!FR) return;
    const salt = key === 'head' ? 3.7 : 1.3;
    const partK = key === 'head' ? (FR.headScale === undefined ? 1 : FR.headScale) : 1;
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
    /* every dark rim first, then every coat lobe — interleaving them would
       let one lobe's dark rim print over its neighbour's coat.

       THE RIM IS A FRACTION OF THE LOBE, NEVER A FIXED OFFSET. It used to be
       `pr + 1.9`, which is fine on a 3-unit lobe and catastrophic on a 0.7-unit
       one: a 34%-alpha disc almost three times the lobe's radius, sitting
       outside the silhouette with no coat inside it to hide behind. That is
       exactly what made the Schnoodle's shoulders and hips come back as
       semi-transparent grey blobs floating outside the outline — they were not
       fur, they were rim. Proportional, a rim can only ever read as its own
       lobe's edge, whatever the coat length. */
    /* AND A TRANSLUCENT RIM IS A HALO, NOT A LINE. The body's own outline is
       OPAQUE pal.line; a 34%-alpha disc of the same ink sitting just outside it
       does not read as the edge of a tuft, it reads as a compression halo
       around the dog — which is exactly how the Schnoodle's shoulders and hips
       came back. `rimAlpha` lets a coat ask for a proper ink edge instead, and
       `rimK`/`rimMax` keep that edge THIN, because an opaque rim as fat as the
       lobe would swallow the coat inside it. Defaults are the old numbers. */
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
   * silhouette clip so they genuinely break the edge. These are the hairs
   * that sell "fluffy" — but they are thin, low-alpha arcs, because anything
   * solid poking out of a dog reads as a growth (architecture §6 defect 1).
   */
  function drawFlyaway(c, key, b, hh, wet) {
    const FL = furType.fly;
    if (!FL) return;
    const k = 1 - clamp(wet || 0, 0, 1) * 0.80;
    const L = FL.len * hh * k;
    if (L < 0.6) return;
    const salt = key === 'head' ? 5.1 : 2.6;
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
        /* scale against the part this patch actually lives on. (This used to
           assume the body, so a head patch — a blaze, a beard — came out at
           body scale.) For where:'body' the arithmetic is unchanged. */
        const bw = mk.where === 'head' ? D.headHW : D.bodyHW;
        const bh = mk.where === 'head' ? D.headHH : D.bodyHH;
        const sx = hw / bw, sy = hh / bh;
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
      } else if (mk.shape === 'ticks') {
        /* BANDED-HAIR PEPPERING (salt-and-pepper). Each guard hair is banded
           dark/light/dark, which at any real viewing distance fuses into the
           flat grey the coat colour already is. So the flecks are a SPARSE
           scatter for texture, concentrated where the reference puts it (spine
           and hips) — speckling the whole dog evenly is the classic error. */
        const n = mk.n || 26;
        const cols = mk.colors || ['#2c2a28', '#e6e2da'];
        c.globalAlpha = baseA;
        for (let j = 0; j < n; j++) {
          const h1 = hash1(j, 31.4 + i * 3), h2 = hash1(j, 47.2 + i * 3), h3 = hash1(j, 59.9 + i * 3);
          const x = (mk.at[0] + (h1 - 0.5) * mk.size[0] * 2) * hw;
          const y = (mk.at[1] + (h2 - 0.5) * mk.size[1] * 2) * hh;
          const rr = (mk.r || 1.6) * (0.55 + h3 * 0.9);
          c.fillStyle = cols[j % cols.length];
          ell(c, x, y, rr, rr * 0.72, h1 * 3.1); c.fill();
        }
        c.globalAlpha = 1;
      }
    }
  }

  function markingFor(shape, where) {
    return rig.breed.markings.find((m) => m.shape === shape && (where === undefined || m.where === where));
  }
  const stockingFront = markingFor('stocking', 'legFront');
  const tailUnderMk = markingFor('tailUnder');

  /* ==================================================================
     THE COAT STATE — stage 2. `coat` is optional; with no coat argument
     the dog renders exactly as it did in stage 1.

       coat.regions  the dirt region table (part + fraction-of-half-extent)
       coat.dirt     0..1 per region — HER STROKES ERASE THIS
       coat.foam     0..1 per region — suds build where she scrubs
       coat.wet / coat.suds / coat.gloss / coat.sheen

     Dirt and foam are resolved in PART-LOCAL space (at x halfExtent), which
     is exactly the space the body and head groups are already drawn in, so
     no transform gymnastics and no drift when she is being dented.
     ================================================================== */
  const DIRT = { a: '#8a5f38', b: '#6b4526' };

  function drawSoil(c, coat, where, hw, hh) {
    if (!coat || !coat.regions) return;
    const wetK = 1 + clamp(coat.wet || 0, 0, 1) * 0.35;   // wet mud is darker
    for (let i = 0; i < coat.regions.length; i++) {
      const r = coat.regions[i];
      if (r.part !== where) continue;
      const d = clamp(coat.dirt[i] || 0, 0, 1);
      if (d < 0.012) continue;
      const x = r.at[0] * hw, y = r.at[1] * hh;
      const rr = r.r * (0.58 + d * 0.80);
      /* ---- STAGE 4 FIX: ONE FEATHERED SMUDGE, NOT THREE HARD PASSES -----
         The original three concentric ellipse fills each had a hard alpha edge,
         so between about 0.2 and 0.5 dirt they read as PALE CONCENTRIC RINGS —
         at a glance, bald patches or ringworm rather than muck. Caught by
         rendering a dirt ladder (0 / 0.25 / 0.45 / 0.7 / 1.0) and looking at
         it: only 1.0 read as a muddy dog, and stage 4's walks live in exactly
         the band that failed.

         A single radial gradient has no interior edge to read as a ring, and
         the alpha curve is raised so a half-dirty dog is visibly dirty rather
         than faintly discoloured. The DATA and the erase mechanic are
         untouched, so wash still works exactly as stage 2 built it. */
      /* A PLATEAU, then a feather. All-gradient was too diffuse — 0.45 and
         0.70 dirt rendered almost identically because the ink was spread over
         too large a radius. Holding the peak flat to 52% of the radius gives
         the smudge a solid middle (which is what makes it read as muck) while
         the outer feather keeps it edgeless (which is what stops it reading as
         a ring). Verified against the same ladder. */
      const peak = clamp(Math.pow(d, 0.72) * wetK, 0, 0.94);
      const R = rr * 1.16;
      const gr = c.createRadialGradient(x, y, rr * 0.05, x, y, R);
      gr.addColorStop(0, rgba(DIRT.b, peak));
      gr.addColorStop(0.52, rgba(DIRT.b, peak * 0.94));
      gr.addColorStop(0.74, rgba(DIRT.a, peak * 0.58));
      gr.addColorStop(0.90, rgba(DIRT.a, peak * 0.20));
      gr.addColorStop(1, rgba(DIRT.a, 0));
      c.globalAlpha = 1;
      c.fillStyle = gr;
      c.save();
      c.translate(x, y); c.scale(1, 0.86); c.rotate(i * 0.7); c.translate(-x, -y);
      ell(c, x, y, R, R); c.fill();
      c.restore();
      /* specks around the edge, so the smudge is not a perfect oval */
      c.globalAlpha = clamp(d * 0.46, 0, 0.7);
      c.fillStyle = DIRT.b;
      for (let k = 0; k < 4; k++) {
        const a = i * 1.7 + k * 1.9;
        ell(c, x + Math.cos(a) * rr * (0.86 + (k % 2) * 0.30),
          y + Math.sin(a) * rr * (0.68 + (k % 2) * 0.26),
          rr * 0.15, rr * 0.11, a); c.fill();
      }
    }
    c.globalAlpha = 1;
  }

  function drawFoam(c, coat, where, hw, hh) {
    if (!coat || !coat.suds || coat.suds < 0.02) return;
    for (let i = 0; i < coat.regions.length; i++) {
      const r = coat.regions[i];
      if (r.part !== where) continue;
      const f = clamp((coat.foam[i] || 0) * coat.suds, 0, 1);
      if (f < 0.02) continue;
      const x = r.at[0] * hw, y = r.at[1] * hh;
      const rr = r.r * (0.5 + f * 0.55);
      /* a cluster of overlapping bubbles, not one white blob */
      for (let k = 0; k < 6; k++) {
        const a = i * 2.1 + k * 1.05;
        const dd = rr * (0.2 + (k % 3) * 0.28);
        const br = rr * (0.34 - (k % 3) * 0.06);
        c.globalAlpha = clamp(f * 0.80, 0, 0.9);
        c.fillStyle = 'rgba(255,255,255,0.92)';
        ell(c, x + Math.cos(a) * dd, y + Math.sin(a) * dd * 0.8, br, br * 0.94); c.fill();
        c.globalAlpha = clamp(f * 0.9, 0, 1);
        c.fillStyle = 'rgba(255,255,255,0.98)';
        ell(c, x + Math.cos(a) * dd - br * 0.3, y + Math.sin(a) * dd * 0.8 - br * 0.32,
          br * 0.30, br * 0.26); c.fill();
      }
    }
    c.globalAlpha = 1;
  }

  /** wet: a cool wash, darker streaks, and a much stronger specular */
  function drawWet(c, coat, hw, hh) {
    const w = clamp(coat && coat.wet, 0, 1);
    if (!(w > 0.02)) return;
    c.globalAlpha = w * 0.20;
    c.fillStyle = '#4f6a72';
    c.fillRect(-hw * 1.4, -hh * 1.6, hw * 2.8, hh * 3.2);
    c.globalAlpha = w * 0.16;
    c.strokeStyle = '#3d565e';
    c.lineWidth = 1.6;
    for (let i = -5; i <= 5; i++) {
      const x = i * hw * 0.19;
      c.beginPath();
      c.moveTo(x, -hh * 1.1);
      c.quadraticCurveTo(x + 3, 0, x - 2, hh * 1.15);
      c.stroke();
    }
    c.globalAlpha = w * 0.34;
    c.fillStyle = 'rgba(255,255,255,0.9)';
    ell(c, hw * 0.42, -hh * 0.52, hw * 0.26, hh * 0.34, -0.5); c.fill();
    ell(c, -hw * 0.30, -hh * 0.20, hw * 0.13, hh * 0.20, -0.4); c.fill();
    c.globalAlpha = 1;
  }

  /** gloss: a specular bloom whose strength IS the brushing progress */
  function drawGloss(c, coat, hw, hh) {
    const gl = clamp(coat && coat.gloss, 0, 1);
    if (!(gl > 0.03)) return;
    /* the light in this room comes from the upper right (see the window) */
    c.globalAlpha = 0.06 + gl * 0.26;
    const g2 = c.createRadialGradient(hw * 0.40, -hh * 0.62, 2, hw * 0.40, -hh * 0.62, hw * 1.05);
    g2.addColorStop(0, 'rgba(255,250,228,0.85)');
    g2.addColorStop(0.45, 'rgba(255,246,214,0.22)');
    g2.addColorStop(1, 'rgba(255,246,214,0)');
    c.fillStyle = g2;
    c.fillRect(-hw * 1.4, -hh * 1.6, hw * 2.8, hh * 3.2);
    /* and a narrow band that travels, so a gleaming coat visibly shines */
    if (gl > 0.4) {
      const u = ((coat.sheen || 0) % 1);
      const y = lerp(-hh * 1.3, hh * 1.3, u);
      c.globalAlpha = (gl - 0.4) / 0.6 * 0.20;
      const g3 = c.createLinearGradient(0, y - hh * 0.34, 0, y + hh * 0.34);
      g3.addColorStop(0, 'rgba(255,252,236,0)');
      g3.addColorStop(0.5, 'rgba(255,252,236,0.95)');
      g3.addColorStop(1, 'rgba(255,252,236,0)');
      c.fillStyle = g3;
      c.fillRect(-hw * 1.4, y - hh * 0.34, hw * 2.8, hh * 0.68);
    }
    c.globalAlpha = 1;
  }

  /**
   * THE NECK BRIDGE. The frontal rig has no drawn neck: the head simply
   * overlaps the shoulders. That is fine until a care action drives the head
   * right down into a bowl, at which point the head reads as having detached
   * and slid down the chest. `rig.drive.neck` (0..1) asks for a tapered coat
   * shape from the shoulders to the base of the head, which puts the geometry
   * back. Drawn between the body and the front legs.
   */
  function drawNeck(c, k) {
    const P = rig.pose;
    const dx = P.headX - P.neckX, dy = (P.headY + D.headHH * 0.52) - P.neckY;
    const len = Math.hypot(dx, dy);
    if (len < 6) return;
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;
    const w0 = D.bodyHW * 0.50, w1 = D.headHW * 0.46;
    const nodes = [
      pt(P.neckX - ux * 6, P.neckY - uy * 6),
      pt(P.neckX + dx * 0.34, P.neckY + dy * 0.34),
      pt(P.neckX + dx * 0.72, P.neckY + dy * 0.72),
      pt(P.headX + ux * 4, P.headY + D.headHH * 0.52 + uy * 4),
    ];
    const ws = [w0, lerp(w0, w1, 0.42) * 1.02, lerp(w0, w1, 0.78), w1];
    c.save();
    c.globalAlpha = clamp(k, 0, 1);
    /* NO outline pass: the neck is always sandwiched between two outlined
       shapes, and a dark border on it reads as a separate collar-shaped object
       rather than as part of the animal. Shape and shading only. */
    c.beginPath(); ribbon(c, nodes, ws);
    const ng = c.createLinearGradient(P.neckX - w0, P.neckY, P.neckX + w0, P.neckY);
    ng.addColorStop(0, pal.coatSh);
    ng.addColorStop(0.42, pal.coatMid);
    ng.addColorStop(1, pal.coat);
    c.fillStyle = ng; c.fill();
    /* the cream throat carries down the front of the neck */
    c.beginPath();
    ribbon(c, nodes.map((q) => pt(q.x + nx * 2.5, q.y + ny * 2.5)), ws.map((v) => v * 0.42));
    c.fillStyle = rgba(pal.creamMid, 0.55); c.fill();
    /* soft shoulder blend so the neck melts into the chest instead of ending */
    const bg = c.createRadialGradient(P.neckX, P.neckY, 2, P.neckX, P.neckY, w0 * 1.5);
    bg.addColorStop(0, rgba(pal.coatMid, 0.72));
    bg.addColorStop(0.6, rgba(pal.coatMid, 0.30));
    bg.addColorStop(1, rgba(pal.coatMid, 0));
    c.fillStyle = bg;
    c.beginPath(); c.arc(P.neckX, P.neckY, w0 * 1.5, 0, TAU); c.fill();
    c.restore();
  }

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

    /* A PLUMED TAIL. A curly-coated breed carries a plume, not a whip: soft
       lobes down both sides of the whole tail rather than a little floof at
       the tip. Same fringe trick as the body and the ears. */
    const plume = D.tailPlume;
    const FRt = furType.fringe;
    if (FRt && plume > 1.05) {
      const xs = [], ys = [], rs = [];
      for (let i = Math.max(1, T.rootHide); i < nodes.length; i++) {
        const a = nodes[i - 1], b2 = nodes[i];
        const dx = b2.x - a.x, dy = b2.y - a.y, L = Math.hypot(dx, dy) || 1;
        const nx = -dy / L, ny = dx / L;
        for (const sgn of [-1, 1]) {
          const h1 = hash1(i * 2 + (sgn > 0 ? 1 : 0), 23.6);
          const rr = ws[i] * (0.44 + h1 * 0.34) * (plume - 0.2);
          xs.push(b2.x + nx * sgn * ws[i] * 0.72);
          ys.push(b2.y + ny * sgn * ws[i] * 0.72);
          rs.push(rr);
        }
      }
      c.fillStyle = pal.line; c.globalAlpha = FRt.alpha;
      for (let j = 0; j < xs.length; j++) { c.beginPath(); c.arc(xs[j], ys[j], rs[j] + 1.7, 0, TAU); c.fill(); }
      c.globalAlpha = 1;
      c.fillStyle = pal.coatMid;
      for (let j = 0; j < xs.length; j++) { c.beginPath(); c.arc(xs[j], ys[j], rs[j], 0, TAU); c.fill(); }
    }

    /* soft floof on the last joints */
    for (let i = nodes.length - 2; i < nodes.length; i++) {
      const a = Math.atan2(nodes[i].y - nodes[i - 1].y, nodes[i].x - nodes[i - 1].x);
      for (const sd of [-1, 1]) {
        const aa = a + sd * 1.28;
        lobe(c, nodes[i].x, nodes[i].y, Math.cos(aa), Math.sin(aa),
          T.floofLen * plume, T.floofW * plume);
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
  function drawEyePair(c, e) {
    const px = R.parallax;
    const [eX, fEye, eYv, fl, fr, open, smi, lead] = e;
    /* `face.eyeTilt` — OPT-IN, exactly like `face.eyeHi` above it.
       BALANCE.rig.eyeTilt is 0.05 rad of outer-corner lift, and its own comment
       in balance.js reads "higher reads as a stern glare". It is a global, and it
       is right for the Shiba; a breed that has to read as sweet rather than keen
       can flatten its own eyes toward round without touching anyone else's.
       Omitting the key resolves to the global, so the Shiba and the Cockapoo
       render byte-identically to before. */
    const tilt = faceCap.eyeTilt === undefined ? R.eyeTilt : faceCap.eyeTilt;
    drawEye(c, -eX + fEye, eYv, D.eyeW * (1 - fl * px.farShrink), D.eyeH, open, smi, tilt, -1, lead);
    drawEye(c, eX + fEye, eYv, D.eyeW * (1 - fr * px.farShrink), D.eyeH, open, smi, tilt, 1, lead);
  }

  /**
   * The nose. `face.noseSize` scales it (1 = the Shiba's muzY * 0.42).
   * Drawn on its own so a moustached breed can defer it past the furnishings:
   * a groomed moustache flanks the nose so closely that the tufted inner edge
   * of the pair was eating four units off each side of it, and a black nose
   * bitten down to a sliver is most of why the Schnoodle's muzzle stopped
   * reading as a face at all. On a real dog the nose sits proud ON the hair.
   */
  function drawNose(c, nsx, nsy) {
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

  function drawMouth(c, mx, my, op, smi, tg) {
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
  function drawEarChain(c, side, e, yawv, back, scaleF) {
    const nodes = rig.pose.earNodes && rig.pose.earNodes[e];
    if (!nodes || nodes.length < 3) return;
    const px = R.parallax;
    const far = clamp(-yawv * side, 0, 1);
    const near = clamp(yawv * side, 0, 1);
    const bx = side * D.earX + yawv * px.ear;
    const by = D.earY;
    /* A prick ear can afford `earFar` = 0.52 — a triangle at half width still
       reads as an ear. A HANGING ear at half width collapses into a nub on
       the far side of the face, which is exactly what the first render did.
       A hanging ear also foreshortens far less in reality: it is a curtain in
       the frontal plane, not a cone pointing away from the camera. */
    const sx = (1 - far * px.earFar * 0.34 + near * px.earNear * 0.6) * scaleF;
    const hw = PR.earW * 0.5;
    /* earBack presses the leather against the skull: narrower, not shorter —
       the chain already shortened it. */
    const flat = 1 - clamp(back, 0, 1) * earStyle.flatten;
    const prof = earStyle.width;
    const ws = [];
    for (let i = 0; i < nodes.length; i++) {
      ws.push(prof[Math.min(i, prof.length - 1)] * hw * flat);
    }
    c.save();
    c.translate(bx, by);
    c.scale(side * sx, scaleF);

    /* --- fluffy edge: overlapping lobes down both sides of the ear -------
       A curly-coated ear whose outline is a smooth taper reads as a leather
       flap. Same principle as the body fringe: break the edge. */
    const FR = furType.fringe;
    const feather = earStyle.feather || 0;
    if (FR && feather > 0 && !earStyle.scallop) {
      const cxs = [], cys = [], crs = [];
      /* SUB-SAMPLE each segment. One lobe pair per joint gives ten lobes on a
         long ear, which renders as a smooth leather flap with a scalloped
         hem. The ear coat is the longest hair on a cockapoo and has to read as
         a hanging curtain, so it needs many more, smaller, irregular lobes. */
      const SUB = 4;
      for (let i = 1; i < nodes.length; i++) {
        const a = nodes[i - 1], b2 = nodes[i];
        const dx = b2.x - a.x, dy = b2.y - a.y, L = Math.hypot(dx, dy) || 1;
        const nx = -dy / L, ny = dx / L;
        /* TUCK, AND JITTER ALONG THE EDGE — NOT ACROSS IT.
           Centring a lobe at (w - rr*0.30) leaves 70% of every disc outside the
           leather, and the old jitter displaced it DIAGONALLY, which on a short
           coat means each lobe pokes out by a different amount. Rendered on the
           Schnoodle that is a row of countable semicircular knobs down the ear —
           architecture §6 art defect 1 again, the same nub failure that was
           fixed on the Shiba's shoulders by tucking lobes inside the outline.
           So: `tuck` buries most of the disc under the leather (drawn after
           these, so it covers their roots) and only the cap breaks the edge,
           and the jitter runs TANGENTIALLY, which varies the SPACING of the
           scallops — irregular rhythm, even protrusion. The Cockapoo's long
           feathered ear keeps its old shallow tuck: there the lobes are large
           and dense enough to merge into a hem rather than stay countable. */
        const tk = earStyle.tuck === undefined ? 0.30 : earStyle.tuck;
        for (let t = 0; t < SUB; t++) {
          const u = (t + 0.5) / SUB;
          const mx = a.x + dx * u, my = a.y + dy * u;
          const w = lerp(ws[i - 1], ws[i], u);
          for (const sgn of [-1, 1]) {
            const idx = (i * SUB + t) * 2 + (sgn > 0 ? 1 : 0);
            const h1 = hash1(idx, 6.4 + e), h2 = hash1(idx, 11.2 + e);
            const rr = w * (0.20 + h2 * 0.24) * feather;
            const jt = (h1 - 0.5) * w * 0.28;
            cxs.push(mx + nx * sgn * (w - rr * tk) + (dx / L) * jt);
            cys.push(my + ny * sgn * (w - rr * tk) + (dy / L) * jt);
            crs.push(rr);
          }
        }
      }
      /* and a soft tip so the ear ends in hair, not in a rounded paddle */
      {
        const tipN = nodes[nodes.length - 1], pv = nodes[nodes.length - 2];
        const dx = tipN.x - pv.x, dy = tipN.y - pv.y, L = Math.hypot(dx, dy) || 1;
        for (let t = 0; t < 5; t++) {
          const h1 = hash1(t, 27.3 + e), h2 = hash1(t, 31.8 + e);
          const w = ws[ws.length - 1];
          cxs.push(tipN.x + (h1 - 0.5) * w * 1.5 + (dx / L) * w * 0.35 * h2);
          cys.push(tipN.y + (dy / L) * w * (0.15 + h2 * 0.45));
          crs.push(w * (0.24 + h1 * 0.26) * feather);
        }
      }
      /* proportional rim, for the reason spelled out in drawFringe: a fixed
         offset around a short-coated ear lobe is a translucent grey halo, and
         on the Schnoodle it was drawing exactly that around both ears.
         AND IT MUST BE THE COAT'S OWN RIM. This was still running the numbers
         drawFringe was fixed AWAY from (0.42 / 1.8) — so the wiry coat, which
         asks for a thin opaque ink edge (rimK 0.20, rimMax 1.1), was getting a
         rim nearly half as wide as the lobe around each of thirty-seven discs.
         A ring that heavy turns a scallop into a drawn circle: the nubs on the
         Schnoodle's ears were as much rim as they were lobe. */
      const rimK = FR.rimK === undefined ? 0.42 : FR.rimK;
      const rimMax = FR.rimMax === undefined ? 1.9 : FR.rimMax;
      c.fillStyle = pal.line;
      c.globalAlpha = FR.rimAlpha === undefined ? FR.alpha : FR.rimAlpha;
      for (let j = 0; j < cxs.length; j++) {
        c.beginPath(); c.arc(cxs[j], cys[j], crs[j] + Math.min(rimMax, crs[j] * rimK), 0, TAU); c.fill();
      }
      c.globalAlpha = 1;
      c.fillStyle = pal.coatMid;
      for (let j = 0; j < cxs.length; j++) { c.beginPath(); c.arc(cxs[j], cys[j], crs[j], 0, TAU); c.fill(); }
    }

    /* --- the leather itself ---
       A SCALLOPED HEM, NOT APPLIED LOBES. Discs laid along the edge only ever
       merge into a hem if they are big and dense (the Cockapoo's, feather 1.35).
       On a close-clipped ear they stay countable: even tucked three-quarters
       under the leather, a bend in the chain lets the outer side of the curve
       push them clear of the ribbon and they come back as a row of round knobs
       with an ink ring each — nubs, architecture §6 defect 1. The Cockapoo's
       own head succeeds by modulating its OUTLINE, so do that here: undulate
       the ribbon's half-width itself, with an independent phase per side so the
       two edges do not mirror, tapering to nothing at the root so the hem can
       never lift off the skull. The edge is then genuinely irregular and there
       is nothing outside the outline to read as a growth.
       It is also far cheaper: this replaces ~74 arc fills per ear per frame. */
    let inkPoly = null, hemPoly = null;
    if (earStyle.scallop) {
      const SC = earStyle.scallop;
      const SUB2 = SC.sub || 5;
      const bp = [], bw = [];
      for (let i = 0; i < nodes.length - 1; i++) {
        for (let t = 0; t < SUB2; t++) {
          const u = t / SUB2;
          bp.push(pt(lerp(nodes[i].x, nodes[i + 1].x, u), lerp(nodes[i].y, nodes[i + 1].y, u)));
          bw.push(lerp(ws[i], ws[i + 1], u));
        }
      }
      bp.push(nodes[nodes.length - 1]); bw.push(ws[ws.length - 1]);
      const m = bp.length;
      const iL = [], iR = [], hL = [], hR = [];
      for (let i = 0; i < m; i++) {
        const a = bp[Math.max(0, i - 1)], b2 = bp[Math.min(m - 1, i + 1)];
        const dx2 = b2.x - a.x, dy2 = b2.y - a.y, L2 = Math.hypot(dx2, dy2) || 1;
        const nx2 = -dy2 / L2, ny2 = dx2 / L2;
        const u = m > 1 ? i / (m - 1) : 0;
        const grow = Math.min(1, u * 3.2);
        for (let q = 0; q < 2; q++) {
          const sg2 = q ? -1 : 1;
          const ph = e * 1.7 + (q ? 2.37 : 0);
          const v = Math.pow(Math.abs(Math.sin(Math.PI * SC.cycles * u + ph)), SC.pow);
          const w2 = bw[i] * (1 + (v - 0.44) * SC.amp * grow);
          (q ? hR : hL).push(pt(bp[i].x + nx2 * sg2 * w2, bp[i].y + ny2 * sg2 * w2));
          /* the ink offset RAMPS IN. `ws.map(i===0?0:2.0)` was a hard step
             between node 0 and node 1, which on five widely-spaced nodes the
             spline smoothed away — but these are sub-sampled seven to a segment,
             so the step lands between two adjacent points and the outline
             answers with a sharp dark THORN jutting out of the ear root across
             the forehead. Ramped over the same span as the scallop, the ink
             simply emerges from under the skull. */
          const wi = w2 + 2.0 * grow;
          (q ? iR : iL).push(pt(bp[i].x + nx2 * sg2 * wi, bp[i].y + ny2 * sg2 * wi));
        }
      }
      iR.reverse(); hR.reverse();
      inkPoly = iL.concat(iR); hemPoly = hL.concat(hR);
    }
    if (inkPoly) { c.beginPath(); crClosed(c, inkPoly, 0.85); } else {
      c.beginPath(); ribbon(c, nodes, ws.map((v, i) => v + (i === 0 ? 0 : 2.0)));
    }
    c.fillStyle = pal.line; c.fill();
    if (hemPoly) { c.beginPath(); crClosed(c, hemPoly, 0.85); } else {
      c.beginPath(); ribbon(c, nodes, ws);
    }
    const tip = nodes[nodes.length - 1];
    const eg = c.createLinearGradient(0, 0, tip.x, tip.y);
    eg.addColorStop(0, pal.coatMid);
    eg.addColorStop(0.45, pal.coat);
    eg.addColorStop(1, pal.coatDeep);
    c.fillStyle = eg; c.fill();

    /* --- a light rim along the leading edge ---
       A short-coated ear is genuinely darker than the coat, but with no edge
       light a dark ear on a dark head reads as a HOLE rather than as a flap. */
    if (earStyle.rim) {
      const rn = [], rw = [];
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[Math.max(0, i - 1)], b2 = nodes[Math.min(nodes.length - 1, i + 1)];
        const dx = b2.x - a.x, dy = b2.y - a.y, L = Math.hypot(dx, dy) || 1;
        rn.push(pt(nodes[i].x + (-dy / L) * ws[i] * 0.70, nodes[i].y + (dx / L) * ws[i] * 0.70));
        rw.push(ws[i] * 0.20);
      }
      c.beginPath(); ribbon(c, rn, rw);
      c.fillStyle = rgba(pal.coatHi, earStyle.rim); c.fill();
    }

    /* --- inner ear, ONLY right at the attachment ---
       A hanging ear shows a sliver of lining where it leaves the skull and
       nothing below that, because the leather has folded over. Running the
       lining down three joints at 0.45 alpha drew a bright pink stripe down
       the whole length of the ear. Two joints, low alpha, hard taper. */
    if (earStyle.inner > 0 && nodes.length > 2) {
      const inNodes = [nodes[0], nodes[1], nodes[2]];
      c.beginPath();
      ribbon(c, inNodes, [ws[0] * earStyle.inner, ws[1] * earStyle.inner * 0.52, 0.4]);
      c.fillStyle = rgba(pal.inner, 0.24); c.fill();
    }

    /* --- curl texture along the leather --- */
    const CU = furType.curl;
    if (CU) {
      c.lineWidth = CU.width; c.lineCap = 'round';
      for (let i = 1; i < nodes.length; i++) {
        const h1 = hash1(i, 13.3 + e), h2 = hash1(i, 17.9 + e);
        const rr = ws[i] * 0.40 * (0.7 + h2 * 0.6);
        const ang = h1 * TAU;
        c.strokeStyle = rgba(pal.coatHi, CU.alpha * 0.9);
        c.beginPath();
        c.arc(nodes[i].x + (h1 - 0.5) * ws[i] * 0.5, nodes[i].y, rr, ang, ang + CU.sweep);
        c.stroke();
      }
    }
    c.restore();
  }

  function drawEar(c, side, yawv, back, flick, scaleF) {
    if (earStyle.chain) {
      drawEarChain(c, side, side < 0 ? 0 : 1, yawv, back, scaleF);
      return;
    }
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

  /* ==================================================================
     FACIAL FURNITURE (beard, moustache, eyebrows, topknot, chest bib fluff)

     Declarative and generic: a breed lists `furnishings`, each one a cluster
     of soft fluff blobs in head-local fractions, and the renderer interprets
     them. No breed is named here. A breed with no `furnishings` key draws
     nothing and costs nothing.

       kind    'fluff'  — overlapping soft lobes (the only kind so far)
       layer   'under'  drawn before the head fill, so it rises BEHIND the
                        crown (a topknot has to peek over the skull line)
               'over'   drawn after the silhouette clip is released, so it may
                        legitimately overhang the outline (a beard hangs below
                        the jaw; schnauzer brows project past the brow line)
       at      anchor, fractions of head half-extent
       blobs   [dx, dy, rx, ry, rot] each, same fractions — this is what makes
               a beard a beard rather than an oval
       tag     what animates it: 'brow' rises with the brow spring and tracks
               the gaze, 'beard'/'moustache' trail the head's MEASURED
               velocity so they swing, 'topknot' takes light head parallax
       mirror  draw both sides
     ================================================================== */
  /**
   * A furnishing is ONE COHESIVE MASS with a tufted edge — authored as a
   * closed outline exactly like a silhouette, then broken along its normals
   * by the same |sin|^pow profile the coat uses.
   *
   * (The first attempt drew each furnishing as a cluster of overlapping
   * discs. Rendered, a white disc cluster on a dark muzzle reads
   * unmistakably as SOAP SUDS, not as a beard — the individual circles stay
   * legible and the eye names them. A single tufted path reads as hair.)
   *
   * Paths are static in head-local space, so every one is tufted ONCE here at
   * construction and only translated/scaled per frame.
   */
  function buildFluff(poly, salt, amp, cycles, pow, rim) {
    const rs = resampleClosed(poly, 4);
    const n = rs.length;
    const norms = loopNormals(rs);
    const raw = new Float32Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      let v = Math.pow(Math.abs(Math.sin(Math.PI * cycles * u + salt)), pow);
      v *= 1 + 0.34 * Math.sin(u * TAU * 3 + salt * 1.9);
      raw[i] = v; sum += v;
    }
    const mean = sum / n;
    /* `rim` scales the dark edge. A flat 2 units is right on a beard 45 units
       deep and far too heavy on a brow only 10 deep: there, rim plus tuft is a
       dim grey skirt as thick as the pale mass it surrounds, and the brow stops
       reading as a brow and starts reading as a smudge. */
    const rw = 2.0 * (rim === undefined ? 1 : rim);
    const fill = [], dark = [];
    let y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const d = amp * (raw[i] - mean + 0.34);
      const x = rs[i].x + norms[i].x * d, y = rs[i].y + norms[i].y * d;
      fill.push(pt(x, y));
      dark.push(pt(x + norms[i].x * rw, y + norms[i].y * rw));
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    /* `base` is the SMOOTH resampled contour, before tufting. A contact shadow
       traced round the ragged edge is just more ragged edge; traced round the
       smooth one it reads as the form's shadow on the face underneath. */
    return { fill, dark, base: rs, y0, y1 };
  }

  /* precomputed furnishing geometry, per entry per side */
  const furnish = [];
  {
    const list = rig.breed.furnishings || [];
    const hw = D.headHW, hh = D.headHH;
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (f.kind !== 'fluff' || !f.path) continue;
      const sides = f.mirror ? [1, -1] : [1];
      const geo = {};
      for (const sd of sides) {
        const poly = f.path.map((q) => pt(q[0] * hw * sd, q[1] * hh));
        geo[sd] = buildFluff(poly, i * 7.3 + (sd > 0 ? 0 : 19.7),
          f.tuftAmp === undefined ? 2.4 : f.tuftAmp,
          f.tuftCycles || 9, f.tuftPow || 0.8, f.rim);
      }
      furnish.push({ f, sides, geo });
    }
  }

  /**
   * ONE furnishing side's MASS — contact shadow, dark rim, fill, form shade —
   * in head-local coordinates.
   *
   * Pulled out of drawFurnishings so that the live path and the pre-baked path
   * below run the exact same drawing code and cannot drift apart. Everything
   * here is static in head-local space (see buildFluff), which is precisely
   * what makes the bake possible.
   */
  function fluffMass(c, f, geo, sd, main, dark, hw, hh, alpha) {
    /* CONTACT SHADOW — what stops a furnishing reading as a decal.
       A pale mass laid on the face with no shadow under it has no stated
       relationship to the head: it hovers in front of the face. A brow
       physically OVERHANGS the brow ridge, so it throws a soft shadow down onto
       the lid — and drawing that shadow is what drops it back ONTO the lid
       without moving it down over the eye and re-crushing it (the opposite
       failure). Traced round the SMOOTH base contour, offset down, and mostly
       hidden behind the mass itself: all that shows is the crescent below the
       lower edge. */
    if (f.contact) {
      const CT = f.contact;
      const passes = CT.soft === false ? 1 : 2;
      for (let q = passes; q >= 1; q--) {
        c.globalAlpha = alpha * (CT.alpha || 0.20) / passes;
        c.save();
        c.translate((CT.dx || 0) * hw * sd, (CT.dy === undefined ? 0.06 : CT.dy) * hh * (q / passes));
        c.beginPath(); crClosed(c, geo.base, 1);
        c.fillStyle = pal[CT.color] || dark; c.fill();
        c.restore();
      }
      c.globalAlpha = alpha;
    }
    c.beginPath(); crClosed(c, geo.dark, 1);
    c.fillStyle = dark; c.fill();
    c.beginPath(); crClosed(c, geo.fill, 1);
    c.fillStyle = main; c.fill();
    /* a soft inner shade so the mass has volume rather than reading as a
       flat paper cutout stuck on the face */
    if (f.shadeIn || f.shadeUnder) {
      c.beginPath(); crClosed(c, geo.fill, 1);
      c.save(); c.clip();
      /* `shadeIn` shades from the TOP down, which is right for a beard
         hanging in the shadow of the jaw. It is backwards for a brow: an
         overhanging mass is LIT on top and dark underneath, and shading it
         the other way lights it from below — one more reason the brows read
         as pasted on rather than as part of the skull. `shadeUnder` runs the
         ramp the other way, and over the furnishing's OWN extent rather than
         the head's, so a shape only a fifth of a head deep actually gets the
         full ramp instead of a flat slice of it. */
      const sg = f.shadeUnder
        ? c.createLinearGradient(0, geo.y1, 0, geo.y0 - (geo.y1 - geo.y0) * 0.25)
        : c.createLinearGradient(0, -hh * 0.2, 0, hh * 0.5);
      sg.addColorStop(0, rgba(dark, f.shadeUnder || f.shadeIn));
      sg.addColorStop(1, rgba(dark, 0));
      c.fillStyle = sg;
      c.fillRect(-hw, -hh, hw * 2, hh * 2);
      c.restore();
    }
  }

  /* ---- THE FURNISHING BAKE -------------------------------------------
     MEASURED, at 390x844 DPR 3: drawFurnishings emitted 1072 of the
     Schnoodle's 2001 bezierCurveTo calls per frame — 54% of all the curve
     segments in the whole picture, for four small pale shapes. It is the single
     most expensive thing in the game, and it is entirely redundant work: a
     furnishing's tufted geometry is built ONCE at construction and is static in
     head-local space, so every frame was re-tracing the same ~1000 Catmull-Rom
     segments and rebuilding the same two-stop gradient to get the same pixels.

     So each side of each furnishing is rasterised once into a small offscreen
     canvas and blitted thereafter. Per frame that turns ~1072 bezierCurveTo,
     18 fills, 18 saves and 7 gradients into 7 drawImage calls.

     Correctness rules, so this can never change what the dog looks like:
       - the bake is keyed on the resolved COLOURS, so dirt and wet (which
         re-mix them) simply produce a different key;
       - it is only used when the entry is fully opaque, because overlapping
         internal layers composite differently under a group alpha;
       - when dirt or wet are active the live path runs instead, so a muddy or
         soaking dog is drawn exactly as before — that is the rare case and it
         is not where the frame budget is spent;
       - the raster scale is read back out of the live transform, so it is
         always 1 baked pixel per device pixel, and the only per-frame scaling
         applied to it (yaw foreshortening, wet cling) is < 1, i.e. a downscale.
     -------------------------------------------------------------------- */
  const bakes = new Map();
  const BAKE_MAX = 512;      // device px per side; a furnishing is far smaller

  function fluffBake(ent, i, sd, main, dark, K) {
    const key = i + '|' + sd + '|' + K.toFixed(3) + '|' + main + '|' + dark;
    const hit = bakes.get(key);
    if (hit !== undefined) return hit;
    const f = ent.f, geo = ent.geo[sd];
    const hw = D.headHW, hh = D.headHH;
    /* bounds: the dark rim is the outermost path, plus wherever the contact
       shadow is pushed to, plus a pixel of margin for the antialiased edge */
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of geo.dark) {
      if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x;
      if (q.y < y0) y0 = q.y; if (q.y > y1) y1 = q.y;
    }
    for (const q of geo.base) {
      if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x;
      if (q.y < y0) y0 = q.y; if (q.y > y1) y1 = q.y;
    }
    if (f.contact) {
      const CT = f.contact;
      const dx = (CT.dx || 0) * hw * sd, dy = (CT.dy === undefined ? 0.06 : CT.dy) * hh;
      x0 = Math.min(x0, x0 + dx); x1 = Math.max(x1, x1 + dx);
      y0 = Math.min(y0, y0 + dy); y1 = Math.max(y1, y1 + dy);
    }
    const pad = 2 / K + 1;
    x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
    const wpx = Math.ceil((x1 - x0) * K), hpx = Math.ceil((y1 - y0) * K);
    if (!(wpx > 0 && hpx > 0) || wpx > BAKE_MAX || hpx > BAKE_MAX) {
      bakes.set(key, null);            // implausible size: stay on the live path
      return null;
    }
    const cv = document.createElement('canvas');
    cv.width = wpx; cv.height = hpx;
    const bc = cv.getContext('2d');
    if (!bc) { bakes.set(key, null); return null; }
    bc.setTransform(K, 0, 0, K, -x0 * K, -y0 * K);
    fluffMass(bc, f, geo, sd, main, dark, hw, hh, 1);
    const out = { cv, x0, y0, w: x1 - x0, h: y1 - y0 };
    /* the key space is bounded in practice (7 sides x one scale x the pristine
       palette), but never let a resize storm grow it without limit */
    if (bakes.size > 64) bakes.clear();
    bakes.set(key, out);
    return out;
  }

  function drawFurnishings(c, layer, coat) {
    if (!furnish.length) return;
    const P = rig.pose, s = rig.springs, px = R.parallax, mo = rig.mo.parallax;
    const hw = D.headHW, hh = D.headHH;
    const yawv = P.yaw, pitchv = P.pitch;
    const brw = s.brow.x;
    const EL = R.eyeLead;
    /* the head's real per-frame velocity, published by rig.js — a beard that
       does not trail the head reads as a painted-on bib */
    const vx = P.headVX || 0, vr = P.headVR || 0;
    /* THE RASTER SCALE for the bake, sampled ONCE here — before any per-side
       transform. Read off the live matrix so it tracks dpr and window size by
       itself, and taken here rather than inside the loop because the per-side
       transform carries the yaw foreshortening, which changes every frame: keying
       the cache on that would rebake continuously and cost more than it saves.
       Rotation does not affect the magnitude, so hypot of the first column is the
       local->device scale. */
    let baseK = 0;
    if (c.getTransform) {
      const m = c.getTransform();
      const k = Math.hypot(m.a, m.b);
      if (k > 0.05 && k < 64) baseK = k;
    }
    /* furniture gets dirty too: a spotless white beard on a muddy dog is the
       same failure the dirt mask was written to fix, in miniature */
    let dirtK = 0;
    if (coat && coat.regions && coat.dirt) {
      let sum = 0, cnt = 0;
      for (let i = 0; i < coat.regions.length; i++) {
        if (coat.regions[i].part !== 'head') continue;
        sum += clamp(coat.dirt[i] || 0, 0, 1); cnt++;
      }
      if (cnt) dirtK = sum / cnt;
    }

    for (let i = 0; i < furnish.length; i++) {
      const ent = furnish[i];
      const f = ent.f;
      if ((f.layer || 'over') !== layer) continue;
      const tag = f.tag || '';
      const sides = ent.sides;
      let main = pal[f.color] || pal.coat;
      let dark = pal[f.shade] || pal.coatSh;
      if (dirtK > 0.02) {
        main = mix(main, '#7d5432', dirtK * 0.55);
        dark = mix(dark, '#5d3c22', dirtK * 0.45);
      }
      /* wet furniture clings: narrower and darker */
      const wet = coat ? clamp(coat.wet, 0, 1) : 0;
      const cling = 1 - wet * 0.34;
      if (wet > 0.02) { main = mix(main, '#6d7f86', wet * 0.30); dark = mix(dark, '#4a5b62', wet * 0.30); }

      for (const sd of sides) {
        let ax = (f.at[0] || 0) * hw * sd;
        let ay = (f.at[1] || 0) * hh;
        /* parallax + animation per tag */
        if (tag === 'brow') {
          /* A BROW FURNISHING RIDES ITS EYE — it is not a marking on the skull.
             A brow MARKING (the Shiba's) sits high on the forehead and correctly
             takes the forehead's parallax: px.brow, and only EL.brow of the gaze
             lead. A schnauzer brow physically OVERHANGS the eye, and if it takes
             a different pitch response from the eye it slides across it: at
             pitch 1 the eye rose 14.3 units and the brow only 10, so a brow
             tuned to hood the eye at rest covered half of it the moment he
             looked up — which is most of why he read as squinting and grim.
             Same channel as the eye, and the hood is then a fixed anatomical
             relationship in every pose. */
          ax += yawv * px.eye * mo + P.pupilX * D.eyeW * EL.shiftX;
          ay += -pitchv * px.vEye - brw * 4.2 + P.pupilY * D.eyeH * EL.shiftY;
        } else if (tag === 'beard' || tag === 'moustache') {
          ax += yawv * px.muzzle * mo - vx * 0.22 - vr * 26;
          ay += -pitchv * px.vMuz;
        } else if (tag === 'topknot') {
          ax += yawv * px.ear * mo - vx * 0.10;
          ay += -pitchv * px.vBrow * 0.6;
        } else {
          ax += yawv * px.cheek * mo;
          ay += -pitchv * px.vMuz * 0.6;
        }
        /* the far side of the face foreshortens, exactly like the markings */
        const towards = sd > 0 ? clamp(yawv, 0, 1) * mo : clamp(-yawv, 0, 1) * mo;
        const shrink = 1 - towards * px.farShrink;
        const alpha = (f.alpha === undefined ? 1 : f.alpha);
        const geo = ent.geo[sd];
        c.save();
        c.translate(ax, ay);
        c.scale(shrink * cling * (f.scale || 1), (f.scale || 1));
        c.globalAlpha = alpha;
        /* the pre-baked raster if this side is drawable from one — see the
           bake notes above; otherwise the identical live path via fluffMass */
        let bk = null;
        if (baseK > 0 && alpha === 1 && dirtK <= 0.02 && wet <= 0.02) {
          bk = fluffBake(ent, i, sd, main, dark, baseK * Math.max(1, f.scale || 1));
        }
        if (bk) c.drawImage(bk.cv, bk.x0, bk.y0, bk.w, bk.h);
        else fluffMass(c, f, geo, sd, main, dark, hw, hh, alpha);
        c.globalAlpha = 1;
        c.restore();
        /* a few wispy hairs sweeping out of the cluster — this is what makes
           a schnauzer eyebrow read as bristle rather than as a pillow */
        if (f.wisp) {
          const W2 = f.wisp;
          c.lineWidth = W2.width || 1.5;
          c.lineCap = 'round';
          c.strokeStyle = rgba(pal[W2.color] || main, W2.alpha === undefined ? 0.5 : W2.alpha);
          for (let k = 0; k < (W2.n || 4); k++) {
            const h1 = hash1(k, i * 7.1 + 21.4), h2 = hash1(k, i * 7.1 + 33.9);
            const t0 = (k / Math.max(1, (W2.n || 4) - 1) - 0.5) * 2;
            const sxp = ax + (W2.from[0] + t0 * (W2.spanX || 0.10)) * hw * sd * shrink;
            const syp = ay + (W2.from[1] + (h1 - 0.5) * 0.05) * hh;
            const len = (W2.len || 0.16) * hh * (0.7 + h2 * 0.6);
            const a0 = (W2.angle || -0.9) * sd + (h1 - 0.5) * (W2.spread || 0.7);
            c.beginPath();
            c.moveTo(sxp, syp);
            c.quadraticCurveTo(
              sxp + Math.cos(a0) * len * 0.55 * sd, syp + Math.sin(a0) * len * 0.55,
              sxp + Math.cos(a0 + (W2.curl || 0.4) * sd) * len * sd,
              syp + Math.sin(a0 + (W2.curl || 0.4) * sd) * len);
            c.stroke();
          }
        }
      }
    }
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
      /* THE SOCKET, moving in lockstep with the lens itself — same parallax,
         same gaze lead, so it can never slide off the eye it belongs to. This
         is what a dark-masked breed needs: a black eye on a mid-grey mask has
         so little contrast that it visually shrinks to a bead, and the fix is
         to lift the hair immediately around it (which is also what a real
         salt-and-pepper schnauzer's eye rim does) rather than to keep inflating
         the eye until it stops being the breed's eye. */
      eye: (sd, x, y, rx, ry) => [
        x + fEye + lead[0] * D.eyeW * EL.shiftX,
        y + vEye + lead[1] * D.eyeH * EL.shiftY,
        rx * (1 - (sd > 0 ? fl : fr) * px.farShrink), ry,
      ],
    });

    /* muzzle */
    const mcx = fMuz, mcy = D.muzY + vMuz;
    c.save(); c.translate(mcx, mcy);
    c.scale(1 - Math.abs(yawv) * px.muzSquash * mo, 1);
    c.beginPath(); crClosed(c, rig.sil.muzzle, 1);
    c.fillStyle = G.muz; c.fill();
    c.strokeStyle = rgba(pal.muzSh, 0.30); c.lineWidth = 1.2; c.stroke();
    c.restore();

    /* eyes — deferred past the facial furnishings on a heavy-browed breed, so
       the brow's tufted edge cannot carve the lens (see face.eyesOver) */
    const eAt = [D.eyeX, fEye, D.eyeY + vEye, fl, fr, open, smi, lead];
    if (faceCap.eyesOver) lateEyes = eAt;
    else drawEyePair(c, eAt);

    /* nose — deferred past the facial furnishings on a moustached breed */
    const nAt = [mcx + s.noseTw.x * 1.4, mcy - D.muzY * 0.40 + Math.abs(s.noseTw.x) * 0.6];
    if (faceCap.noseOver) lateNose = nAt;
    else drawNose(c, nAt[0], nAt[1]);

    /* mouth — deferred past the facial furnishings on a bearded breed */
    const mAt = [mcx, mcy + D.muzY * 0.44, clamp(s.mouth.x, 0, 1),
      clamp(s.smile.x, 0, 1), clamp(s.tongue.x, 0, 1.4)];
    if (faceCap.mouthOver) lateMouth = mAt;
    else drawMouth(c, mAt[0], mAt[1], mAt[2], mAt[3], mAt[4]);

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
  /**
   * @param mood 0..1 — the FAST channel (stage 2). Drives the blush and the
   *   warmth of the face. Stage 1 passed affection here; mood is what the body
   *   is supposed to read off, and it is what the room passes now.
   * @param coat optional coat state (dirt / foam / wet / suds / gloss). Absent
   *   is fine: the dog then renders exactly as it did in stage 1.
   */
  function draw(g, pet, mood, coat) {
    const c = g.ctx;
    const P = rig.pose, s = rig.springs;
    const petLevel = pet ? pet.level : 0;
    const aff = mood === undefined ? 0 : mood;
    const wet = coat ? clamp(coat.wet, 0, 1) : 0;

    c.save();
    c.translate(rig.x, rig.y);
    /* rig.sy is the FORESHORTENING channel: running into the screen squashes
       vertically while the uniform scale shrinks. 1 for a stage-1 dog.
       rig.sx is its horizontal twin (stage 3), which is how a roll-over reads
       on a rig that cannot show its own back. */
    c.scale(rig.s * (rig.sx === undefined ? 1 : rig.sx),
      rig.s * (rig.sy === undefined ? 1 : rig.sy));
    if (!G) initGrads(c);

    const sit = P.sit;
    /* stage 3 posture channels. `|| 0` so a rig built before them still draws. */
    const dn = P.down || 0, hop = P.hop || 0;
    const LG = R.leg, TR = R.trick;

    /* ---- contact shadow ---- */
    c.save();
    /* lying down spreads the contact patch; a jump shrinks and fades it, which
       is most of what sells "her paws have left the floor" */
    const shSpread = 1 + s.sit.x * 0.10 + s.squash.x * 0.20 + dn * 0.22;
    c.translate(P.bodyX * 0.45, 0);
    c.scale(shSpread, 0.26 * (1 - clamp(s.lift.x, 0, 20) / 70) * (1 - hop * 0.45));
    c.globalAlpha = 1 - hop * 0.42;
    c.fillStyle = G.shadow;
    c.beginPath(); c.arc(0, 0, D.bodyHW * 1.16, 0, TAU); c.fill();
    c.globalAlpha = 1;
    c.restore();

    /* ---- tail (behind the body) ---- */
    drawTail(c);

    /* ---- hind legs ---- */
    const hipY = P.bodyY + P.bodyHH * R.leg.hindHipAt;
    const kick = Math.sin(rig.kickPhase) * s.hindKick.x;
    const hw = P.bodyHW;
    /* LYING DOWN tucks the hind paws away behind her; AIRBORNE takes them up
       with the body, otherwise the legs stretch and she reads as a dog on
       stilts rather than a dog in the air. */
    const hindY = -5 + sit * 3 + dn * LG.downHindTuck - hop * TR.hopHeight * LG.hopPawShare;
    const hindIn = 1 - dn * 0.22;
    drawLeg(c, P.bodyX - D.hipX, hipY - 6, P.bodyX - D.hindPawX * hindIn, hindY - Math.max(0, kick) * 7,
      -(4 + sit * 15), D.legW * 0.86, true, 1);
    drawLeg(c, P.bodyX + D.hipX, hipY - 6, P.bodyX + D.hindPawX * hindIn, hindY + Math.min(0, kick) * 7,
      (4 + sit * 15), D.legW * 0.86, true, 1);

    /* ---- haunches (reads as "sitting") ----
       They fade out as she goes down: a lying dog has no haunch bulges, and
       leaving them in is what makes a lie-down read as a sit that slipped. */
    if (sit > 0.02 && dn < 0.98) {
      c.globalAlpha = clamp(sit * (1 - dn), 0, 1);
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
    const b = buildPart('body', pet, sxB, syB, P.bodyX, P.bodyY, 1.0, null, wet);
    c.save();
    c.translate(P.bodyX, P.bodyY);
    c.rotate(P.bodyRot);
    /* coat depth BEHIND the silhouette, so the edge breaks irregularly */
    drawFringe(c, 'body', b, D.bodyHH, wet);
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
    drawFur(c, 'body', b, D.bodyHH, P.bodyX, P.bodyY, wet);
    drawWet(c, coat, P.bodyHW, P.bodyHH);
    drawGloss(c, coat, P.bodyHW, P.bodyHH);
    c.fillStyle = G.rim;
    c.fillRect(-D.bodyHW * 1.4, -D.bodyHH * 1.6, D.bodyHW * 2.8, D.bodyHH * 3.2);
    /* DIRT GOES ON TOP OF THE LIGHTING, not under it: muck sits on the coat,
       so the rim light must not wash it out. (It did, and the first render of
       a filthy dog came back looking spotless.) */
    drawSoil(c, coat, 'body', P.bodyHW, P.bodyHH);
    drawFoam(c, coat, 'body', P.bodyHW, P.bodyHH);
    c.restore();
    /* individual curls breaking the rim — outside the clip on purpose */
    drawFlyaway(c, 'body', b, D.bodyHH, wet);
    c.restore();

    /* ---- ART FIX 2: blend the tail root into the rump ---- */
    drawTailRoot(c);

    /* ---- the neck, only when a care action has pulled the head down ---- */
    const neckK = rig.drive.neck || 0;
    if (neckK > 0.01) drawNeck(c, neckK);

    /* ---- front legs ----
       LYING DOWN splays them outward and slightly forward — forward on this
       camera means NEARER, so the paws go a little below the floor line and
       the leg bows out. That is the sphinx pose, and it is the whole reason a
       lie-down reads at all from the front. */
    const fHipY = P.bodyY + P.bodyHH * R.leg.frontHipAt;
    for (let i = 0; i < 2; i++) {
      const sd = i === 0 ? -1 : 1;
      const lf = rig.pawLift[i].x;
      /* the lateral term: a small natural outward drift with the lift, plus
         the `pawOut` channel scaled by how far off the floor the paw actually
         is. A paw on the ground never moves sideways, whatever pawOut says. */
      const hi = Math.max(0, lf - LG.liftOutFrom);
      const out = lf * 3 + hi * s.pawOut.x * LG.liftOut;
      const pawX = P.bodyX + sd * D.pawX + sd * sit * 2 + sd * out + sd * dn * LG.downSpread;
      /* the planted paw's y comes from rig.update now (pose.pawY) so the floor
         line is a published number rather than a private one; only the LIFT is
         per-leg, because only a lifted paw has left the floor */
      const pawY = P.pawY - lf * LG.liftAmt;
      drawLeg(c, P.bodyX + sd * D.shoulderX, fHipY - 4, pawX, pawY,
        sd * (LG.bow + sit * LG.sitBow + lf * LG.liftBow + dn * LG.downBow),
        D.legW, false, 1 + lf * 0.06 + dn * 0.10);
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

    /* ---- THE COLLAR (stage 6) ----
       Drawn between the chest and the head group, which is where a collar is.
       IT KNOWS NOTHING ABOUT THE BREED: it sits on the published neck joint
       (`pose.neckX/neckY`, the same point the neck bridge uses) and takes its
       width from `dims`, so a floppy-eared Cockapoo, a long-muzzled Schnoodle
       and the Shiba all get a collar on the neck rather than three hand-placed
       ones. It also follows the head DOWN into the bowl, because the neck
       joint does — which is the difference between a collar and a sticker. */
    const wearId = rig.wear || '';
    if (wearId) {
      const wc = BALANCE.ui.wear[wearId] || BALANCE.ui.wear.collarRed;
      const nx = P.neckX, ny = P.neckY;
      /* the head pulls the collar with it: sit it a little below the neck
         point, on the line toward the head, so it stays on the throat */
      const dx = P.headX - nx, dy = (P.headY + D.headHH * 0.42) - ny;
      const cx = nx + dx * 0.34, cy = ny + dy * 0.34;
      const hw = Math.min(D.bodyHW * 0.52, D.headHW * 0.80);
      c.save();
      c.translate(cx, cy);
      c.rotate(Math.atan2(dx, -dy) * 0.35 + P.bodyRot * 0.4);
      c.fillStyle = 'rgba(60,32,18,0.30)';
      ell(c, 0, 2.4, hw * 1.02, hw * 0.30); c.fill();
      c.fillStyle = wc;
      ell(c, 0, 0, hw, hw * 0.29); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.20)';
      ell(c, -hw * 0.16, -hw * 0.07, hw * 0.52, hw * 0.09); c.fill();
      if (wearId === 'collarTag') {
        c.fillStyle = '#e0b23f';
        c.beginPath(); c.arc(0, hw * 0.34, hw * 0.17, 0, TAU); c.fill();
        c.fillStyle = 'rgba(120,84,20,0.45)';
        c.beginPath(); c.arc(0, hw * 0.34, hw * 0.09, 0, TAU); c.fill();
      }
      c.restore();
    }

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
    /* LONG HANGING EARS GO BEHIND THE HEAD.
       Drawn in front, a pair of ear curtains falls across the cheeks and
       muzzle and the face disappears behind two flat paddles — which is what
       the first render did. Behind the skull they instead emerge at the sides
       and hang past the jaw, which is the silhouette that actually reads as a
       spaniel ear. A BUTTON ear is the opposite: it folds forward onto the
       temple, so it must stay in front (`behind: false`). */
    const earsBehind = !!earStyle.behind;
    if (earsBehind) {
      drawEar(c, -1, P.yaw, s.earBack.x, s.earL.x, earScale);
      drawEar(c, 1, P.yaw, s.earBack.x, s.earR.x, earScale);
    } else if (farIsLeft) drawEar(c, -1, P.yaw, s.earBack.x, s.earL.x, earScale);
    else drawEar(c, 1, P.yaw, s.earBack.x, s.earR.x, earScale);

    /* pseudo-3D silhouette skew + pitch foreshortening */
    const yawSkew = P.yaw * R.parallax.skew * rig.mo.parallax;
    const warp = (x, y) => [
      x + yawSkew * (1 - Math.abs(x) / D.headHW * 0.45),
      y * (1 - P.pitch * R.parallax.pitchSquash) - P.pitch * R.parallax.pitchShift,
    ];
    const hb = buildPart('head', pet, 1, 1, P.headX, P.headY, 1.0, warp, wet);
    drawFringe(c, 'head', hb, D.headHH, wet);
    /* a topknot rises from BEHIND the skull line, then the head covers its
       roots — drawn on top it would read as a hat */
    drawFurnishings(c, 'under', coat);
    c.beginPath(); crClosed(c, hb.o, 1);
    c.fillStyle = pal.line; c.fill();
    c.beginPath(); crClosed(c, hb.p, 1);
    c.fillStyle = G.head; c.fill();
    c.save(); c.clip();
    c.fillStyle = G.headShade;
    c.fillRect(-D.headHW * 1.3, -D.headHH * 1.3, D.headHW * 2.6, D.headHH * 2.6);
    drawFur(c, 'head', hb, D.headHH, P.headX, P.headY, wet);
    drawFace(c, aff, petLevel);
    drawWet(c, coat, D.headHW, D.headHH);
    drawGloss(c, coat, D.headHW, D.headHH);
    c.fillStyle = G.rim;
    c.fillRect(-D.headHW * 1.3, -D.headHH * 1.3, D.headHW * 2.6, D.headHH * 2.6);
    drawSoil(c, coat, 'head', D.headHW, D.headHH);
    drawFoam(c, coat, 'head', D.headHW, D.headHH);
    c.restore();
    drawFlyaway(c, 'head', hb, D.headHH, wet);

    /* facial furniture that is allowed to break the head silhouette — a
       schnauzer beard hangs well below the jaw, and eyebrows overhang. Drawn
       after the clip is released, or the silhouette would shave them off. */
    drawFurnishings(c, 'over', coat);

    /* THE NOSE AND MOUTH, LAST. On a bearded breed the furnishings have just
       covered the muzzle, so the two features that make a muzzle read as a face
       go on top of them (face.noseOver / face.mouthOver). Drawing them here also
       puts black and dark-line marks on PALE furnishing hair instead of on the
       dark facial mask, which is the whole reason they are legible at all. */
    /* THE EYES, on top of the brow that overhangs them. The brow is still
       drawn first, so it reads as sitting over the socket — but the lens is
       whole. See face.eyesOver. */
    if (lateEyes) { drawEyePair(c, lateEyes); lateEyes = null; }
    if (lateNose) { drawNose(c, lateNose[0], lateNose[1]); lateNose = null; }
    if (lateMouth) {
      drawMouth(c, lateMouth[0], lateMouth[1], lateMouth[2], lateMouth[3], lateMouth[4]);
      lateMouth = null;
    }

    if (!earsBehind) {
      if (farIsLeft) drawEar(c, 1, P.yaw, s.earBack.x, s.earR.x, earScale);
      else drawEar(c, -1, P.yaw, s.earBack.x, s.earL.x, earScale);
    }

    c.restore();  /* head group */
    c.restore();  /* dog */
  }

  return { draw, get grads() { return G; } };
}

export default createDogRenderer;
