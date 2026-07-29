/* ==========================================================================
   dog/breeds.js — THE BREED SEAM.

   Adding a breed must be a data entry, not a renderer edit. dog/draw.js reads
   everything below generically: palette ramps are derived from eight base
   colours, proportions drive the rig dimensions, `silhouette.front` supplies
   normalised outlines, `markings` is an interpreted list, and capability
   differences (`ear`, `fur.type`) are declarative — never `if (breed === ...)`.

   Coordinate convention for silhouettes
   ------------------------------------
     pts:    array of [x,y] in 0..1, tracing the outline clockwise
     origin: the [x,y] inside that 0..1 box which is the part's local (0,0)
     box:    the authored pixel size, purely informational
   The renderer maps a point to rig units as
     lx = (x - origin[0]) * width, ly = (y - origin[1]) * height
   where width/height come from `proportions`. So proportions rescale the
   drawing without touching the outline data.

   `silhouette.side` is deliberately absent — stage 4 adds the side rig.
   ========================================================================== */

export const BREEDS = {

  shiba: {
    id: 'shiba',
    name: 'Shiba Inu',

    /* ---- palette: eight canonical keys; the render ramp is derived ------ */
    palette: {
      coat: '#e9954f',
      coatShade: '#c56d38',
      cream: '#fdf4e2',
      nose: '#413028',
      eye: '#33241d',
      tongue: '#f08e97',
      blush: '#f08284',
      pad: '#e69f95',
    },

    /* ---- proportions ----------------------------------------------------
       Puppy, not chunky adult: big head, short stubby legs, small soft
       muzzle, big eyes set low. `anchors` holds attachment points as
       fractions of the parent part's half-extent (stage-1 extension,
       documented in ARCHITECTURE §11).
       ------------------------------------------------------------------- */
    proportions: {
      headScale: 1.12,      // head silhouette + face block multiplier
      bodyW: 104, bodyH: 86,
      headW: 96, headH: 88, // base head box, scaled by headScale
      legLen: 32, legW: 12.6,
      earH: 44, earW: 29,
      muzzleW: 44, muzzleH: 36,
      eyeSize: 1.14,        // × derived base (headHW * 0.245)
      eyeSpacing: 0.44,     // × head half-width
      tailCurl: 0.72,
      tailLen: 1.0,
      neckRuff: 1.12,
      anchors: {
        neckDY: -0.35,      // × body half-height, where the neck leaves the body
        neckOverlap: 12,    // rig units the head sinks into the shoulders
        muzzleY: 0.40,      // × head half-height
        eyeY: -0.04,        // puppy: big eyes set LOW on the face
        browY: -0.36,
        earX: 0.68,         // × head half-width
        earY: -0.72,        // × head half-height
        shoulderX: 0.37,    // × body half-width
        pawX: 0.40,
        hipX: 0.69,
        hindPawX: 0.85,
        tailBase: [0.60, 0.06],
        cheekY: 0.36,
      },
    },

    /* ---- silhouettes (normalised) -------------------------------------- */
    silhouette: {
      front: {
        body: {
          origin: [0.5000, 0.4651], box: [100, 86], pts: [
            [0.5000, 0.0000], [0.7200, 0.0349], [0.8900, 0.1977], [0.9800, 0.4651], [1.0000, 0.7209],
            [0.9100, 0.9070], [0.7000, 0.9884], [0.5000, 1.0000], [0.3000, 0.9884], [0.0900, 0.9070],
            [0.0000, 0.7209], [0.0200, 0.4651], [0.1100, 0.1977], [0.2800, 0.0349],
          ],
        },
        /* chest urajiro: a narrow tapered shield, NOT a big oval decal */
        bib: {
          origin: [0.5000, 0.3030], box: [40, 66], pts: [
            [0.5000, 0.0000], [0.8250, 0.1212], [1.0000, 0.3939], [0.9750, 0.7273], [0.7500, 0.9394],
            [0.5000, 1.0000], [0.2500, 0.9394], [0.0250, 0.7273], [0.0000, 0.3939], [0.1750, 0.1212],
          ],
        },
        head: {
          origin: [0.5000, 0.5000], box: [96, 88], pts: [
            [0.5000, 0.0000], [0.7188, 0.0227], [0.8854, 0.1591], [0.9688, 0.3750], [1.0000, 0.6023],
            [0.9375, 0.8068], [0.7292, 0.9545], [0.5000, 1.0000], [0.2708, 0.9545], [0.0625, 0.8068],
            [0.0000, 0.6023], [0.0312, 0.3750], [0.1146, 0.1591], [0.2812, 0.0227],
          ],
        },
        muzzle: {
          origin: [0.5000, 0.4444], box: [42, 36], pts: [
            [0.5000, 0.0000], [0.8095, 0.0833], [1.0000, 0.3889], [0.9762, 0.7222], [0.7619, 0.9444],
            [0.5000, 1.0000], [0.2381, 0.9444], [0.0238, 0.7222], [0.0000, 0.3889], [0.1905, 0.0833],
          ],
        },
        ear: {
          origin: [0.4643, 0.9211], box: [28, 38], pts: [
            [0.0000, 1.0000], [0.0357, 0.4474], [0.2857, 0.0263], [0.6429, 0.0000], [0.9643, 0.4211],
            [1.0000, 1.0000],
          ],
        },
        /* inner ear, drawn as a fraction of the ear outline */
        earInner: {
          origin: [0.4643, 0.9211], box: [28, 38], pts: [
            [0.2143, 0.9474], [0.2321, 0.5263], [0.4107, 0.2368], [0.6071, 0.2368], [0.7679, 0.5526],
            [0.7857, 0.9474],
          ],
        },
      },
      /* side: added by stage 4 */
    },

    /* ---- markings: interpreted generically by dog/draw.js --------------
       shape:  'patch' (named outline) | 'ellipse' | 'stocking' | 'tailUnder'
       where:  'body' | 'head' | 'legFront' | 'legHind' | 'tail'
       at/size: fractions of that part's half-extent
       tag:    optional animation hook the renderer understands ('brow','cheek')
       ------------------------------------------------------------------ */
    markings: [
      /* urajiro — the cream underside that defines a Shiba.
         `feather` softens the edge into the coat (a decal-hard edge is what
         made the spike's pale areas read as patches stuck on top).
         `deform` is how much the petting field displaces the marking. */
      { shape: 'patch', where: 'body', outline: 'bib', color: 'cream', grad: 'bib', deform: 0.75, feather: 0.16 },
      /* saddle: darker back */
      { shape: 'ellipse', where: 'body', at: [0, -0.80], size: [0.86, 0.44], color: 'coatSh', alpha: 0.20, soft: 0.9 },
      /* flank shading, so the barrel reads as a volume not a blob */
      { shape: 'ellipse', where: 'body', at: [0.70, -0.06], size: [0.30, 0.54], color: 'coatSh', alpha: 0.10, mirror: true, soft: 1.0 },
      /* cheeks + brows */
      { shape: 'ellipse', where: 'head', at: [0.60, 0.38], size: [0.24, 0.21], color: 'creamMid', alpha: 0.80, rot: 0.22, mirror: true, soft: 0.85, tag: 'cheek' },
      { shape: 'ellipse', where: 'head', at: [0.44, -0.36], size: [0.17, 0.105], color: 'creamMid', alpha: 0.85, rot: 0.30, mirror: true, soft: 0.7, tag: 'brow' },
      /* darker mask over the crown */
      { shape: 'ellipse', where: 'head', at: [0, -0.72], size: [0.60, 0.30], color: 'coatSh', alpha: 0.14, soft: 1.0 },
      { shape: 'stocking', where: 'legFront', color: 'creamMid', alpha: 0.55, from: 0.34 },
      { shape: 'tailUnder', color: 'cream', alpha: 0.24 },
    ],

    /* ---- fur ----------------------------------------------------------
       `clump.at` are parametric positions (0..1) around the part outline.
       The renderer resolves them against the LIVE deformed outline, so the
       clumps follow body curvature and petting dents automatically, and it
       clips them inside the silhouette so they can never read as nubs.
       ----------------------------------------------------------------- */
    fur: {
      type: 'short',
      clump: {
        body: { at: [0.155, 0.215, 0.295, 0.355, 0.44, 0.56, 0.645, 0.705, 0.785, 0.845], scale: 1.0 },
        head: { at: [0.30, 0.38, 0.44, 0.56, 0.62, 0.70], scale: 0.86 },
      },
    },

    /* ---- ear capability (declarative, never breed-id special cases) ---- */
    ear: 'prick',

    /* ---- behaviour ----------------------------------------------------- */
    temperament: { energy: 0.72, focus: 0.44, friendliness: 0.58 },
    aptitude: { disc: 0.55, agility: 0.72, obedience: 0.40 },
  },

};

export const BREED_IDS = Object.keys(BREEDS);

export function getBreed(id) {
  return BREEDS[id] || BREEDS.shiba;
}

export default BREEDS;
