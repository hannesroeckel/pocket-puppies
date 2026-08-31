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

  /* ======================================================================
     COCKAPOO — Cocker Spaniel x Poodle.
     The read is ROUND AND SOFT: a nearly circular skull, a short blunt
     muzzle, very big round dark eyes set level, a fluffy topknot, and long
     wavy ears hung LOW (spaniel ears are set at about eye level, not on the
     crown) that fall past the jaw and frame the face. Tail carried up as a
     plume — emphatically not a Shiba curl.
     ====================================================================== */
  cockapoo: {
    id: 'cockapoo',
    name: 'Cockapoo',

    /* apricot, the signature cockapoo colour. Blacks go rust and whites go
       warm cream on a real coat, so nothing here is a pure value. */
    palette: {
      coat: '#d9a56f',
      coatShade: '#b07f4c',
      cream: '#f4e6cd',
      nose: '#1f1d1c',          // broad black nose
      eye: '#241a14',
      tongue: '#f08e97',
      blush: '#f08284',
      pad: '#e6a79b',
    },

    proportions: {
      headScale: 1.14,
      bodyW: 104, bodyH: 92,
      headW: 96, headH: 92,     // as tall as wide: the teddy-bear skull
      legLen: 30, legW: 13.4,   // short and thick, lost in coat
      earH: 80, earW: 30,       // long curtains: fall well below the jaw
      muzzleW: 46, muzzleH: 32, // short, BROAD and deep — the "muff"
      eyeSize: 1.28,            // the big round dark eye is the whole charm
      eyeSpacing: 0.40,         // wide set: ~1.5 eye-widths apart
      tailCurl: 0.10,           // sabre, NOT curled over the back
      tailLen: 0.95,
      tailCarry: -0.26,         // level to slightly above the back
      tailPlume: 1.55,          // a plume, not a whip
      neckRuff: 1.30,
      pawScale: 1.16,           // oversized paws: a genuine breed tell
      anchors: {
        neckDY: -0.34,
        neckOverlap: 13,
        muzzleY: 0.46,
        eyeY: 0.00,             // level, low on the face: puppyish
        browY: -0.32,
        /* THE SINGLE MOST-VIOLATED FACT ABOUT THIS BREED: spaniel ears are
           set AT OR BELOW EYE LEVEL, on the flat of the cheekbone, not on the
           crown. Drawing them high is what makes a cockapoo read as a Yorkie
           or a show-trim poodle. `eyeY` is 0, so `earY` sits with it. */
        earX: 0.94,             // outside the skull: the ears define the width
        earY: -0.10,
        shoulderX: 0.37,
        pawX: 0.40,
        hipX: 0.69,
        hindPawX: 0.85,
        tailBase: [0.60, 0.06],
        cheekY: 0.36,
      },
    },

    silhouette: {
      front: {
        body: {
          origin: [0.5000, 0.5000], box: [104, 92], pts: [
            [0.5000, 0.0235], [0.6884, 0.0452], [0.8595, 0.1405], [0.9764, 0.3027], [1.0134, 0.5000],
            [0.9712, 0.6952], [0.8573, 0.8573], [0.6921, 0.9638], [0.5000, 1.0049], [0.3025, 0.9769],
            [0.1297, 0.8703], [0.0202, 0.6988], [-0.0052, 0.5000], [0.0459, 0.3119], [0.1609, 0.1609],
            [0.3190, 0.0630],
          ],
        },
        bib: {
          origin: [0.5000, 0.3000], box: [48, 62], pts: [
            [0.5000, -0.0296], [0.7676, 0.0365], [0.9556, 0.2369], [1.0051, 0.5000], [0.9297, 0.7481],
            [0.7417, 0.9186], [0.5000, 0.9704], [0.2609, 0.9141], [0.0781, 0.7436], [0.0051, 0.5000],
            [0.0521, 0.2414], [0.2350, 0.0410],
          ],
        },
        head: {
          origin: [0.5000, 0.5000], box: [96, 92], pts: [
            [0.5000, 0.0154], [0.6922, 0.0450], [0.8690, 0.1382], [0.9913, 0.3005], [1.0268, 0.5000],
            [0.9832, 0.6962], [0.8643, 0.8572], [0.6936, 0.9582], [0.5000, 0.9934], [0.3026, 0.9673],
            [0.1301, 0.8626], [0.0208, 0.6946], [-0.0156, 0.5000], [0.0127, 0.3021], [0.1254, 0.1327],
            [0.3039, 0.0358],
          ],
        },
        /* the groomer's "muff": scissored into a disc around the nose */
        muzzle: {
          origin: [0.5000, 0.4200], box: [46, 32], pts: [
            [0.5000, -0.0199], [0.7952, 0.0352], [1.0046, 0.2351], [1.0516, 0.5000], [0.9849, 0.7545],
            [0.7755, 0.9338], [0.5000, 0.9801], [0.2253, 0.9326], [0.0175, 0.7533], [-0.0484, 0.5000],
            [-0.0022, 0.2364], [0.2056, 0.0364],
          ],
        },
        /* the chain renderer builds the hanging ear from a spring chain and
           the width profile in EAR_STYLE; these keys stay because the seam
           requires them and because ear:'prick' must remain expressible. */
        ear: {
          origin: [0.5000, 0.1000], box: [30, 72], pts: [
            [0.5000, 0.0000], [0.6589, 0.0560], [0.7753, 0.2437], [0.8100, 0.5000], [0.7753, 0.7563],
            [0.6589, 0.9440], [0.5000, 1.0000], [0.3411, 0.9440], [0.2247, 0.7563], [0.1900, 0.5000],
            [0.2247, 0.2437], [0.3411, 0.0560],
          ],
        },
        earInner: {
          origin: [0.5000, 0.1000], box: [30, 72], pts: [
            [0.5000, 0.0000], [0.6210, 0.0836], [0.6928, 0.3434], [0.6928, 0.6566], [0.6210, 0.9164],
            [0.5000, 1.0000], [0.3790, 0.9164], [0.3072, 0.6566], [0.3072, 0.3434], [0.3790, 0.0836],
          ],
        },
      },
    },

    markings: [
      /* a cream chest, soft-edged so it reads as paler coat, not a bib decal */
      { shape: 'patch', where: 'body', outline: 'bib', color: 'cream', grad: 'bib', deform: 0.75, feather: 0.20 },
      /* a gentle darker saddle: apricot coats are darker along the spine */
      { shape: 'ellipse', where: 'body', at: [0, -0.78], size: [0.82, 0.42], color: 'coatSh', alpha: 0.16, soft: 1.0 },
      { shape: 'ellipse', where: 'body', at: [0.70, -0.04], size: [0.30, 0.54], color: 'coatSh', alpha: 0.09, mirror: true, soft: 1.0 },
      /* pale muzzle + cheeks: the light "teddy" face */
      { shape: 'ellipse', where: 'head', at: [0.56, 0.34], size: [0.26, 0.22], color: 'creamMid', alpha: 0.55, rot: 0.20, mirror: true, soft: 0.95, tag: 'cheek' },
      { shape: 'ellipse', where: 'head', at: [0, 0.42], size: [0.44, 0.28], color: 'creamMid', alpha: 0.40, soft: 1.0 },
      { shape: 'stocking', where: 'legFront', color: 'creamMid', alpha: 0.42, from: 0.30 },
      { shape: 'tailUnder', color: 'cream', alpha: 0.20 },
    ],

    fur: {
      type: 'wavy',
      clump: {
        body: { at: [0.10, 0.17, 0.235, 0.30, 0.37, 0.45, 0.55, 0.63, 0.70, 0.765, 0.83, 0.90], scale: 1.05 },
        head: { at: [0.24, 0.31, 0.38, 0.44, 0.56, 0.62, 0.69, 0.76], scale: 0.92 },
      },
    },

    ear: 'floppy',

    /* a fluffy topknot: the tuft of curl on the crown that a groomer leaves
       when they scissor a teddy-bear trim */
    furnishings: [
      {
        kind: 'fluff', tag: 'topknot', layer: 'under', at: [0, -0.74],
        color: 'coat', shade: 'coatSh',
        tuftAmp: 3.0, tuftCycles: 12, tuftPow: 0.72,
        /* a broad low dome: the groomer leaves the crown full and blends it
           into the ears so head and ears read as one round mass */
        path: [
          [-0.60, 0.20], [-0.56, 0.02], [-0.42, -0.14], [-0.22, -0.24],
          [0, -0.27], [0.22, -0.24], [0.42, -0.14], [0.56, 0.02],
          [0.60, 0.20], [0.34, 0.30], [0, 0.33], [-0.34, 0.30],
        ],
      },
    ],

    temperament: { energy: 0.66, focus: 0.52, friendliness: 0.92 },
    aptitude: { disc: 0.58, agility: 0.60, obedience: 0.68 },
  },

  /* ======================================================================
     SCHNOODLE — Miniature Schnauzer x Poodle. THE GIFT PUPPY.

     REDIRECTED, on direct feedback about this dog: "the problem with the
     schnoodle is that it looks angry and not cute — we have to change that.
     also I would not want to make it grey but rather a nice warm brown."

     The read is now ROUND, SOFT, YOUNG AND SWEET — a warm auburn doodle puppy —
     and every part of the old read (a squarer skull, a flat crown, a long blunt
     muzzle, deep-set eyes under heavy pale brows, a harsh wiry jacket, a stark
     silver furnishing mask) has been taken out rather than softened, because
     each of those was a faithful rendering of the ADULT breed standard and the
     adult breed standard describes a stern working terrier.

     What still makes him a schnoodle and not the Cockapoo, all of it carried by
     volume and silhouette rather than by colour:
       - warmer and REDDER (auburn #b4703f vs her pale apricot #d9a56f);
       - a SCRUFFIER coat (fur.type 'tousled' vs her 'wavy' — coarser, more
         irregular tufting and twice the curl definition);
       - a slightly LONGER muzzle (35 deep vs her 32) carrying a soft
         same-colour beard that hangs just past the jaw and breaks the chin
         silhouette;
       - SEMI-FLOPPED ears — a folded knuckle at the base and half her length —
         against her long straight curtains;
       - brow tufts, which she has none of.
     ====================================================================== */
  schnoodle: {
    id: 'schnoodle',
    name: 'Schnoodle',

    /* WARM RED-BROWN — auburn/copper, and ONE COLOUR ALL OVER.
       ------------------------------------------------------------------
       This replaces salt-and-pepper, on direct feedback: "I would not want to
       make it grey but rather a nice warm brown." Brown and apricot schnoodles
       are entirely real, so nothing about the breed is given up.

       It also fixes two things the grey was costing us:

       1. THE ROOM. Three passes were spent warming a grey toward the amber
          window because the dog "sat visibly apart from the scene" — a grey dog
          in a warm room reads as cut out of a different picture, and no amount
          of nudging the grey a few degrees toward the lamp fixes that. A coat
          that is genuinely warm belongs in the space at the root, so all of
          that compensation is now deleted rather than tuned.

       2. THE FURNISHINGS. Four passes were spent on "the brows look like pale
          patches stuck on his face", and every one of them treated it as an
          edge-quality or a shading problem. It was neither: it was CONTRAST.
          Stark `cream` (#e9e1cd, luminance ~226) laid on mid-grey (~142) is an
          84-point step, and an 84-point step is a different material no matter
          how its edge is drawn. The reference photo has no contrasting
          furnishings at all — the face is one warm colour.
          So `cream` here is not a cream. It is the coat's own hue, ~25 points
          lighter: the beard, moustache and brows are still there as VOLUME and
          SILHOUETTE, but they are the same dog. The whole "pale mask" problem
          stops existing rather than getting another edge treatment.

       And note what is NOT here any more: no coatHi/line/line2 overrides (the
       derived ramp is already warm now), no `creamHi` (nothing on this dog
       should be the whitest object in frame), and no muzHi/muzMid/muzSh. Those
       three drew the DARK FACIAL MASK, and the reference has none — omitting
       them lets derivePalette default the muzzle to the cream ramp, which is
       exactly the "slightly lighter warm tone on the muzzle" of the photo. */
    palette: {
      coat: '#b4703f',           // auburn / copper: the whole dog
      coatShade: '#8a4a28',      // deeper auburn — spine, saddle, form shade
      /* the furnishing tone: the SAME hue, only slightly lighter. Also drives
         the muzzle ramp, the chest and the paws, which is the point — one
         colour everywhere. */
      cream: '#cd8a55',
      nose: '#241b18',           // dark button nose
      eye: '#2a1d16',            // warm near-black
      tongue: '#ee8d96',
      blush: '#dd8878',
      pad: '#c58a6c',
      extra: {
        /* THE FURNISHING TONE, on its own key.
           The beard, moustache and brows want to be a few points lighter than
           the coat than `cream` is, or they stop reading as masses at all and the
           schnauzer character disappears entirely — and rendered at `cream` it
           did: the face came back as a plain round doodle. But `cream` also
           drives the MUZZLE ramp, the chest and the paws, and lightening those
           by the same amount rebuilds the Cockapoo's pale muff on his face,
           which is the one thing that has to stay different.
           So the two are separated. This is 39 luminance points off the coat
           (the old cream-on-grey was 84, i.e. more than twice as far), same hue,
           so it reads as hair catching the light rather than as a patch. */
        furn: '#d69a63',
        furnSh: '#a86e3a',
        /* AND THE BROW GETS ITS OWN, HALFWAY AGAIN. Four tones were rendered side
           by side for this one shape — `furn` (39 points off the coat), `cream`
           (25), this (12), and no brow at all — because it is the feature the
           original feedback was actually about.
             39pt: a discrete tan LOZENGE on the forehead. The old complaint in a
                   quieter voice.
             25pt: better, still legible as two applied ovals.
             12pt: raised fur that happens to be catching a little more light —
                   present, nameable as a brow, sitting IN the coat.
             none: marginally the cleanest dome of the four, and the most faithful
                   to the reference photo, but it costs the schnauzer note
                   entirely and pushes him toward being a plain doodle, which is
                   the one differentiation risk the brief calls out.
           12 points it is. Reverting to no brow at all is a one-line change
           (delete the brow entry in `furnishings`) if that call goes the other
           way — the comparison render is at
           C:	mp\ppworkrow-final3.png. */
        browTone: '#c17d4a',
      },
    },

    /* the beard and moustache are drawn ON TOP of the face, so the mouth has to
       be drawn on top of THEM or there is no mouth at all — see face.mouthOver
       in dog/draw.js. And the corners lift half again as far as a Shiba's, the
       line is wider and the sag between centre and corner is shallower, so the
       mouth arcs UP even at rest. That upturn is on the cute list and it is the
       one thing on this face that never needed changing. */
    face: {
      mouthOver: true,
      noseOver: true,
      /* THE EYES GO ON TOP OF THE BROWS. The brows are drawn after the face so
         they can overhang the skull line, and they were therefore biting notches
         out of the top of the eye with their tuft peaks and their dark rim — the
         eye came out as a thin crescent with the highlight stranded low in it,
         which reads as sly, not hooded. With the lens deferred the brow can rest
         on the lash line (which is the anatomy) and the eye still renders whole.
         See face.eyesOver in dog/draw.js. */
      eyesOver: true,
      /* AND THE GLINT STAYS A GLINT — the lid-narrowing guard is what stops a
         squint turning the specular into a white bar that reads as sclera, and
         it is active for any breed that sets this key at all. So the key STAYS;
         only the scale comes up, 0.86 -> 0.94, because a clear catchlight in a
         big dark eye is most of what makes an animal read as alive and young.
         Still under 1.0 (the Cockapoo's implicit value), so his glint is a hair
         tighter than hers. */
      eyeHi: 0.94,
      /* ROUND, NOT ALMOND. The global BALANCE.rig.eyeTilt lifts the outer corner
         by 0.05 rad, and balance.js annotates that number as "higher reads as a
         stern glare". Almond-rather-than-round is on the anger list and a stern
         glare is the whole complaint, so this dog's eyes sit level. Opt-in
         capability (see drawEyePair) — every other breed keeps the global. */
      eyeTilt: 0,
      /* down from 1.14. A large blunt nose is correct for an adult schnauzer and
         it was pulling the muzzle heavy and long; the reference is a puppy with
         a small dark BUTTON nose, and a small nose leaves the short muzzle
         reading short. */
      noseSize: 1.02,
      /* THE SMILE IS NOT TOUCHED. It is the one thing on this face that already
         reads right — a clear upturn at rest — and it is the game's primary mood
         channel. Identical to the previous pass, deliberately. */
      mouth: { w: 1.34, lift: 1.85, dip: 0.58, philtrum: 0.45, weight: 1.15 },
    },

    /* ---- proportions: THE CUTENESS GEOMETRY -----------------------------
       The previous pass chased the adult breed standard — "strong and
       rectangular, its width diminishing from ears to eyes" — and got what the
       standard describes: a stern adult working terrier. The feedback is that
       he "looks angry and not cute", and the reference is a PUPPY.

       Neoteny is a short, closed list, and every item on it is a number in this
       block. Large round eyes; set WIDE; set LOW on the face so there is a big
       rounded dome above them; a SHORT muzzle; rounded everywhere. The Cockapoo
       in this file already hits all of them and is well liked, so the numbers
       below are deliberately read off her and then pushed a step further on eye
       size, because the reference photo's eyes are enormous.

       What still separates the two dogs after this: he is redder and warmer, his
       muzzle is deeper (35 vs her 32) and carries a same-colour beard, his coat
       is scruffier (fur.type 'tousled' vs her 'wavy'), his ears are SEMI-flopped
       and half her length, and his skull is a touch taller than wide where hers
       is wider than tall.
       ------------------------------------------------------------------- */
    proportions: {
      headScale: 1.12,
      bodyW: 104, bodyH: 88,
      /* was 92x96 with a FLAT CROWN and straight sides. The flat crown was the
         single most severe thing on the dog: it put hard angles at the top
         corners of the head, and "no hard angles anywhere" is most of the
         reference. Now near-square and fully rounded in the silhouette — still
         a hair taller than wide, which is what keeps him off the Cockapoo's
         wider-than-tall circle. */
      headW: 94, headH: 95,
      legLen: 33, legW: 12.8,
      /* BIGGER AND LOWER-SET. Small ears perched on the crown left the head
         outline bare at the sides, so the skull read as a standalone block; in
         the reference the ears hang beside the face and FRAME it, and a framed
         face is a rounder face. Still barely half the Cockapoo's 80 — he is
         semi-flopped, she has curtains. */
      earH: 60, earW: 34,
      /* SHORT. 42 deep was "at least as long as the skull: the brick", i.e. the
         long muzzle on the anger list. 35 is short and blunt — but still deeper
         than the Cockapoo's 32, which is the "slightly longer muzzle carrying a
         soft beard" that keeps them apart. */
      muzzleW: 44, muzzleH: 35,
      /* BIG AND ROUND. 1.34 was authored as "oval and deep-set" — deep-set is a
         scowl, and the socket shadow that produced it is deleted from `markings`
         below. This is the largest eye in the file, on purpose: the reference has
         big round very dark eyes and they are the whole read. The Corgi ties it
         at 1.44 for the same reason and from his own reference, which is fine —
         it is the gift puppy's eye that must not be beaten, not shared. */
      eyeSize: 1.44,
      /* WIDE. 0.375 was explicitly "still closer than the cockapoo's 0.40" —
         close-set eyes are an anger cue and there is no reason to want one. */
      eyeSpacing: 0.425,
      tailCurl: 0.12,
      tailLen: 0.92,
      tailCarry: -0.44,          // set high, carried up, jaunty
      tailPlume: 1.05,           // fuller than the old wiry whip
      neckRuff: 1.22,            // fuller ruff: rounder, softer join
      pawScale: 1.12,            // oversized puppy paws
      anchors: {
        neckDY: -0.35,
        neckOverlap: 12,
        muzzleY: 0.42,           // DROPPED, so the forehead above the eyes grows
        /* LOWER STILL (more positive is lower). Eyes low on the face leaving a
           big rounded dome above them is the strongest single cute cue after eye
           size, and it is exactly what the Cockapoo does at 0.00. */
        eyeY: 0.03,
        browY: -0.30,
        /* out to the edge of the skull and DOWN off the crown, so the leather
           hangs beside the face instead of standing on top of it. With
           EAR_STYLE.semi now `behind: true` the root wants to be far enough out
           that the head's fur edge covers it and the hanging part still clears
           the cheek. */
        earX: 0.92,
        earY: -0.22,
        shoulderX: 0.37,
        pawX: 0.40,
        hipX: 0.69,
        hindPawX: 0.85,
        tailBase: [0.60, 0.06],
        cheekY: 0.36,
      },
    },

    silhouette: {
      front: {
        /* AN EGG, NOT A BARREL. The first pass was a near-circle in a 104x88
           box, and once the wiry skirt filled the lower half the flanks ran as
           two long near-vertical walls: rendered, he read as a RECTANGLE beside
           the cockapoo's soft mass. A schnauzer IS a square dog, but the softness
           has to come from somewhere and on a puppy it comes from the barrel.
           So: narrow through the shoulders, widest low at y 0.61, and a fully
           rounded rump — no segment long enough to read as a straight side. */
        body: {
          origin: [0.5000, 0.5000], box: [104, 88], pts: [
            [0.5000, 0.0260], [0.6560, 0.0520], [0.8010, 0.1380], [0.9080, 0.2760], [0.9700, 0.4400],
            [0.9900, 0.6100], [0.9480, 0.7820], [0.8360, 0.9080], [0.6620, 0.9800], [0.5000, 1.0000],
            [0.3380, 0.9800], [0.1640, 0.9080], [0.0520, 0.7820], [0.0100, 0.6100], [0.0300, 0.4400],
            [0.0920, 0.2760], [0.1990, 0.1380], [0.3440, 0.0520],
          ],
        },
        bib: {
          origin: [0.5000, 0.3000], box: [42, 60], pts: [
            [0.5000, -0.0246], [0.7469, 0.0352], [0.9215, 0.2355], [0.9639, 0.5000], [0.9014, 0.7519],
            [0.7268, 0.9269], [0.5000, 0.9754], [0.2752, 0.9232], [0.1046, 0.7481], [0.0439, 0.5000],
            [0.0845, 0.2392], [0.2551, 0.0389],
          ],
        },
        /* A HIGH ROUNDED DOME. The outline it replaces was authored off the
           adult breed standard — flat crown, straight sides, "width diminishing
           slightly from ears to eyes, and again to the tip of the nose" — and it
           is the reason nothing else on this face could be rescued. A flat crown
           meeting straight sides puts a hard corner at each top corner of the
           skull, and hard angles read as severity in any species; the standard
           is describing an adult working terrier, and the target is a puppy.

           So: a superellipse (exponent 2.16, generated not hand-tweaked, so the
           curvature is continuous and there is no segment anywhere long enough
           to read as a straight side), widest a little ABOVE eye level, crown
           broad and full, tapering ~14% to a softly rounded chin. That taper is
           the only thing left of "diminishing toward the nose", and at 14% it
           reads as a rounded jaw rather than as a wedge.

           This is the big rounded forehead/dome from the reference, and combined
           with anchors.eyeY 0.03 and muzzleY 0.42 it is what puts a genuine
           expanse of forehead above the eyes. */
        head: {
          origin: [0.5000, 0.5000], box: [94, 95], pts: [
            [0.5000, 0.0000], [0.6827, 0.0280], [0.8287, 0.1093], [0.9349, 0.2368], [0.9922, 0.4012],
            [0.9863, 0.5988], [0.9155, 0.7632], [0.8016, 0.8907], [0.6623, 0.9720], [0.5000, 1.0000],
            [0.3377, 0.9720], [0.1984, 0.8907], [0.0845, 0.7632], [0.0137, 0.5988], [0.0078, 0.4012],
            [0.0651, 0.2368], [0.1713, 0.1093], [0.3173, 0.0280],
          ],
        },
        /* A SHORT ROUNDED MUFF, not the old blunt wedge as deep as it was wide.
           Same generator, exponent 2.06 (so almost a circle) in a 44x35 box:
           wider than deep, which is what makes a muzzle read short. Still deeper
           than the Cockapoo's 32 — that is the deliberate remaining difference
           between the two faces. */
        muzzle: {
          origin: [0.5000, 0.4200], box: [44, 35], pts: [
            [0.5000, 0.0000], [0.7422, 0.0652], [0.9225, 0.2449], [1.0000, 0.5000], [0.9267, 0.7551],
            [0.7439, 0.9348], [0.5000, 1.0000], [0.2561, 0.9348], [0.0733, 0.7551], [0.0000, 0.5000],
            [0.0775, 0.2449], [0.2578, 0.0652],
          ],
        },
        ear: {
          origin: [0.5000, 0.1200], box: [32, 46], pts: [
            [0.5000, 0.0000], [0.6813, 0.0513], [0.8141, 0.2409], [0.8500, 0.5000], [0.8141, 0.7591],
            [0.6813, 0.9487], [0.5000, 1.0000], [0.3187, 0.9487], [0.1859, 0.7591], [0.1500, 0.5000],
            [0.1859, 0.2409], [0.3187, 0.0513],
          ],
        },
        earInner: {
          origin: [0.5000, 0.1200], box: [32, 46], pts: [
            [0.5000, 0.0000], [0.6348, 0.0783], [0.7132, 0.3426], [0.7132, 0.6574], [0.6348, 0.9217],
            [0.5000, 1.0000], [0.3652, 0.9217], [0.2868, 0.6574], [0.2868, 0.3426], [0.3652, 0.0783],
          ],
        },
      },
    },

    /* ---- markings: MOSTLY DELETIONS ------------------------------------
       Nine of the entries that used to be here existed to build a salt-and-
       pepper MASK — a dark crown, a dark wedge between the eyes, a shadowed
       socket under each brow, a pale temple, a pale socket, a strong pale cheek
       and a field of peppering ticks. Every one of them was contrast machinery,
       and three of them were on the anger list outright (brow overhang shadow,
       high-contrast dark-over-light around the eye, a dark band closing the eyes
       toward each other).

       The reference face is ONE WARM COLOUR. So the mask is gone rather than
       retuned, and what is left is only the shading that gives the body volume.
       Deleted, for the record: the `ticks` peppering, the dark crown ellipse, the
       dark inter-eye wedge, the deep-set socket shadow, and the pale temple.
       ------------------------------------------------------------------- */
    markings: [
      /* the chest, now only a touch lighter than the coat — "fairly uniform all
         over" is the reference, so this reads as a soft pale chest rather than
         as a bib */
      { shape: 'patch', where: 'body', outline: 'bib', color: 'cream', grad: 'bib', deform: 0.75, feather: 0.24 },
      /* THE TINY WHITE CHEST FLASH IS CUT. It is in the reference photo, and it
         was tried three ways and looked wrong every time: fully feathered it is a
         radial gradient, and a radial gradient on a coat reads as a LIGHT SOURCE
         (it rendered as a glowing spot, i.e. the "pale thing stuck on him"
         failure this whole pass exists to remove); given a harder edge it reads
         as a pale BUTTON sewn to his chest. At the size he is actually seen — the
         dog is about a third of a 390x844 screen — there is no version of a
         6-pixel pale disc that reads as fur.
         The dominant instruction in the reference is "fairly uniform all over",
         and the `bib` patch above already lifts the chest a little. So the chest
         stays quiet, and the one detail that could not survive the rendering
         style is dropped rather than shipped as an artifact. */
      /* a gentle saddle. Down from alpha 0.30: that strength was carrying the
         salt-and-pepper's strong dark back, and on a uniform auburn coat it just
         reads as a dirty stripe. */
      { shape: 'ellipse', where: 'body', at: [0, -0.74], size: [0.86, 0.46], color: 'coatSh', alpha: 0.17, soft: 1.0 },
      { shape: 'ellipse', where: 'body', at: [0.70, -0.06], size: [0.32, 0.56], color: 'coatSh', alpha: 0.11, mirror: true, soft: 1.0 },
      /* A FAINT WARM LIFT AROUND EACH EYE. tag:'eye' pins it to the lens through
         every pose (see the anim hook in drawFace). Kept, but only just: on a
         real dog the hair right around the eye is a shade lighter, and a barely
         perceptible warm halo helps a very dark lens read as a wet eye rather
         than a hole. It is `creamMid`, which is now a warm mid-brown ~20 points
         off the coat, so it cannot become a pale patch. */
      { shape: 'ellipse', where: 'head', at: [0.425, 0.03], size: [0.235, 0.15], color: 'creamMid', alpha: 0.10, mirror: true, soft: 1.0, tag: 'eye' },
      /* soft warm cheeks flanking the muzzle. Down from alpha 0.60: at that
         strength they were half of the "pale patches on his face" read, and they
         were there to close a continuous silver field that no longer exists. */
      { shape: 'ellipse', where: 'head', at: [0.58, 0.30], size: [0.255, 0.225], color: 'creamMid', alpha: 0.26, rot: 0.22, mirror: true, soft: 1.0, tag: 'cheek' },
      /* down from 0.66 for the same reason: warm socks, not white ones */
      { shape: 'stocking', where: 'legFront', color: 'creamMid', alpha: 0.30, from: 0.24 },
      { shape: 'tailUnder', color: 'cream', alpha: 0.22 },
    ],

    /* 'tousled', not 'wiry' — see the FUR_TYPE note in dog/draw.js. `wiry`
       exists to keep a clipped head SMOOTH so a rectangular skull can read, and
       both of those are things this dog is no longer trying to be. */
    fur: {
      type: 'tousled',
      clump: {
        body: { at: [0.11, 0.18, 0.25, 0.32, 0.40, 0.48, 0.56, 0.64, 0.71, 0.78, 0.86, 0.93], scale: 1.06 },
        head: { at: [0.24, 0.31, 0.38, 0.45, 0.55, 0.62, 0.69, 0.76], scale: 0.96 },
      },
    },

    ear: 'semi',

    /* ---- THE SCHNAUZER NOTES, AS VOLUME ----------------------------------
       Beard, moustache and brow tufts all survive — they are what stops him
       being a cockapoo — but they are now made of the dog's own hair (`furn`,
       39 luminance points off the coat) instead of a stark silver field 84
       points off it. The shapes do the work; the colour stays out of the way.
       Order still matters: the moustache flares off the muzzle, the beard hangs
       below the jaw from behind it, and the brows sit above the eyes. What is
       gone is the ink rim, the contact shadow, the temple furnishing and the
       brow bristle — see each entry.
       --------------------------------------------------------------------- */
    furnishings: [
      /* BEARD — a rectangle that WIDENS as it comes forward and hangs below
         the jaw by about the depth of the muzzle. It must not be a round ball
         (the "Bouvier head") and must not pinch under the eyes (the
         "hourglass beard", the most-cited grooming error). So: wide flares at
         the sides, a FLAT wide bottom, and no taper to a point.
         Deliberately anchored low enough to leave the mouth visible — see the
         note in the report; a real beard hides the mouth, but the mouth is
         this game's primary mood channel. */
      {
        /* SMALLER, ROUNDER, AND THE SAME COLOUR AS THE DOG.
           The shape survives — he still carries a beard, which is half of why
           he is a schnoodle and not a cockapoo — but three things change.
           It is shallower (bottom +0.46 not +0.59) because the muzzle above it
           is now short, and a full-depth beard under a short muzzle is all chin.
           The bottom corners are pulled in so the outline is a rounded lobe
           rather than the broad flat rectangle the adult breed standard wants:
           the standard is avoiding the "round-ball Bouvier head", which is an
           adult grooming fault and not a thing a puppy can commit.
           And it is `cream`, which is now a warm mid-brown 25 points off the
           coat instead of an 84-point cream — so it reads as a mass of slightly
           lighter hair catching the light, which is what a beard is, rather than
           as a bib pinned to his chin.
           The mouth still lands on it (face.mouthOver draws last), so the smile
           is still a dark line on a lighter field. */
        kind: 'fluff', tag: 'beard', layer: 'over', at: [0, 0.635],
        color: 'furn', shade: 'furnSh', shadeIn: 0.26,
        /* rounder scallops than the old 2.6/13/1.0: pow below 1 gives round
           bumps where pow above 1 gives points, and points are the harsh wiry
           coat he is no longer wearing */
        tuftAmp: 2.4, tuftCycles: 14, tuftPow: 0.80,
        path: [
          [-0.22, -0.21], [-0.34, -0.09], [-0.43, 0.06], [-0.465, 0.22],
          [-0.415, 0.35], [-0.28, 0.425], [-0.12, 0.458], [0, 0.462],
          [0.12, 0.458], [0.28, 0.425], [0.415, 0.35], [0.465, 0.22],
          [0.43, 0.06], [0.34, -0.09], [0.22, -0.21], [0.10, -0.26],
          [0, -0.27], [-0.10, -0.26],
        ],
        wisp: {
          n: 7, from: [0, 0.42], spanX: 0.34, len: 0.13, angle: 1.35,
          spread: 0.5, curl: 0.30, color: 'furnSh', alpha: 0.26, width: 1.6,
        },
      },
      /* MOUSTACHE — the hair beside and above the nose, combed forward and
         down so that front-on it blends into the beard: ONE mass interrupted
         by the nose, never two separate features. */
      {
        /* pulled outward and UP so the pair flanks the nose without closing
           over the mouth — the first placement buried it */
        /* Vertically BOXED IN: it must clear the bottom of the eye above and
           the mouth below, or it swallows one of them. Pushed too high once
           and it covered the eyes completely.
           AND IT MUST NOT SWALLOW THE NOSE. At at:[0.30,...] the inner ends
           reached in to x≈2 on a nose that is only ±7.5 wide, so all that was
           left of a black nose was a 4-unit sliver — the render came back with
           a dog that had no nose, and a nose is half of what makes a muzzle
           read as a face. The inner edge is now held at x≈7, just outside the
           nose, so the pair flanks it exactly as a groomed moustache does. */
        /* DROPPED to follow the muzzle. anchors.muzzleY went 0.34 -> 0.42 to grow
           the forehead, so the whole muzzle sits ~4 units lower and the pair has
           to travel with it or it detaches from the nose it is supposed to flank.
           Softened too (pow 1.15 -> 0.82): pointy is the harsh coat, round is
           this one. */
        kind: 'fluff', tag: 'moustache', layer: 'over', at: [0.330, 0.300], mirror: true,
        color: 'furn', shade: 'furnSh', shadeIn: 0.22,
        tuftAmp: 2.0, tuftCycles: 11, tuftPow: 0.82,
        path: [
          [-0.180, -0.052], [-0.020, -0.126], [0.152, -0.122], [0.286, -0.042],
          [0.304, 0.070], [0.190, 0.174], [0.020, 0.220], [-0.132, 0.188],
          [-0.190, 0.084],
        ],
        wisp: {
          n: 5, from: [0.24, 0.02], spanX: 0.08, len: 0.14, angle: 0.60,
          spread: 0.7, curl: 0.4, color: 'furnSh', alpha: 0.30, width: 1.6,
        },
      },
      /* THE TEMPLE FURNISHING IS DELETED.
         It was added last pass to join the brow, cheek, moustache and beard into
         ONE continuous silver field, because the brows were reading as isolated
         pale islands. That was a sound fix for a salt-and-pepper dog: the pale
         had to stop being islands, so the dark was isolated instead.
         It has no job on a warm brown dog. There is no pale field to connect —
         the face is one colour, so the brow cannot be an island in it. Keeping a
         pale wedge up the side of each eye would just reintroduce, in a new
         place, the exact "patches stuck on his face" read that all of this is
         meant to remove. Deleted rather than retuned. */
      /* NO EYEBROWS. Removed on direct instruction from the recipient's partner
         after reviewing the warm-brown puppy: "delete the eyebrows from the
         schnoodle".

         Kept here because it cost four passes to learn: the ORIGINAL brow pair
         carried four separate anger cues at once, and each had been argued into
         place on anatomical grounds without anyone checking what the assembled
         face actually said —
           1. it slanted DOWN TOWARD THE CENTRE (the strongest anger signal in any
              species), reasoned as "a pleased dog lifts the OUTER brow" — true of
              the movement, but that same geometry AS A RESTING SHAPE is a scowl;
           2. it overhung and shaded the eye (contact shadow + shadeUnder);
           3. it was inked — a hard dark line directly above a pale mass directly
              above the eye, i.e. dark-over-light around the eye, which is a scowl;
           4. it was an 84-point pale step on grey — the "patch stuck on his face".

         A soft level rounded tuft in the coat's own tone fixed all four and was
         the version reviewed. The call went the other way: brow-less is the
         cleanest dome and the closest to the reference photo. The trade accepted
         is that he reads as a plain doodle rather than carrying a schnauzer note;
         the beard and moustache still break his jaw silhouette.

         If it is ever wanted back, git history has the tuft: the entry sat here
         and used color 'browTone', shade 'furnSh', rim 0.05, shadeUnder 0.15,
         tuftAmp 1.05 / tuftCycles 17 / tuftPow 0.70, at [0.425, -0.255], mirrored,
         with a level rounded-arch path and no wisps. `browTone` remains in the
         palette and `face.browY` is still honoured, so restoring it is additive. */
    ],

    temperament: { energy: 0.78, focus: 0.58, friendliness: 0.80 },
    aptitude: { disc: 0.62, agility: 0.70, obedience: 0.66 },
  },

  /* ======================================================================
     CORGI — Pembroke Welsh Corgi. Dog four (8.24.0), from the human's own
     reference sheet (`docs/reference/character-sheet-corgi.png`).

     THE READ IS EARS AND A BLAZE. Front-on, this dog is two enormous erect
     ears and a white stripe up the middle of an orange face, and every number
     below is in service of one of those two things. Measured off the sheet's
     front view rather than guessed:

       - the widest point of the whole animal is at 7% of his HEIGHT, and it is
         144 of his 145 pixels of width. The ears ARE the silhouette. They are
         also taller than the skull, which no other breed here does;
       - the eyes sit 0.31 of the body width apart, centre to centre, and are
         0.10 of it across — so a hair over three eye-widths of gap. Wide;
       - a WHITE blaze runs from the muzzle up over the forehead, white cheeks
         and jaw below the eye line, white chest, white front legs.

     THE CONTRAST IS THE BREED, and this is the one place the Schnoodle's hard-
     won lesson does NOT transfer. That dog's four failed passes were about a
     stark pale mask on a coat whose reference had no contrasting furnishings at
     all, so `cream` there became the coat's own hue 25 points lighter. Here the
     reference is a genuine bicolour: near-white against orange, 90 luminance
     points, drawn with a hard clean edge. Softening it would be inventing a
     dog. What carries over is the FEATHERING technique, not the low contrast —
     the blaze and bib are feathered into the coat so they read as fur that is
     white rather than as paint applied on top.

     Against the Shiba, who is the other prick-eared orange dog here: the ears
     are half again as tall (66 vs 44) and much wider (34 vs 29), the legs are a
     quarter shorter (24 vs 32 — the breed's headline), the tail is a stub
     (tailLen 0.42 against his 1.0 curled plume), the markings are WHITE against
     his cream urajiro, and the blaze is a shape the Shiba has nowhere.
     ====================================================================== */
  corgi: {
    id: 'corgi',
    name: 'Corgi',

    /* sampled off the sheet's front view, not chosen: the lit face reads
       #f7b05f, the shaded flank #d88f48, and #e89b4a is the mid the two sit
       either side of. `cream` is NEAR-WHITE (#fdf6ec, luminance ~244) because
       the reference's markings are white — the only breed in this file whose
       cream really is one. */
    palette: {
      coat: '#e89b4a',
      coatShade: '#c2712f',
      cream: '#fdf6ec',
      nose: '#2a211c',           // small black button
      eye: '#241f19',
      tongue: '#f08e97',
      blush: '#f08284',
      /* the salmon of the inner ear and the paw pads, sampled at #f9b6a4. It
         matters more on this dog than on any other: those ears are the biggest
         single shape on him and the lining is a third of each one. */
      pad: '#f2a897',
    },

    /* ---- face: ROUND EYES, AND THE REASON IS ALREADY WRITTEN DOWN --------
       The first render of this dog came back with small narrow heavily-lidded
       eyes that read as a squint, and the Schnoodle's entry above diagnoses that
       exact failure at length: `BALANCE.rig.eyeTilt` lifts the outer corner by
       0.05 rad and balance.js annotates the number as "higher reads as a stern
       glare", almond-rather-than-round is on its anger list, and a specular that
       survives the lid is most of what makes an animal look alive.
       So this dog opts out of the global tilt the same way, and its catchlight
       comes up. The reference's eyes are big, perfectly round and very glossy,
       and they are the first thing anybody looks at.
       ------------------------------------------------------------------- */
    face: {
      eyeTilt: 0,
      eyeHi: 0.96,
      /* the reference nose is a small neat black button on a short muzzle, and
         the default 1.14 was drawing it heavy enough to lengthen the face */
      noseSize: 1.04,
    },

    proportions: {
      headScale: 1.14,
      /* broader than the Shiba and no deeper: a corgi front-on is a wide dog on
         short legs, and the width has to come from the barrel because the legs
         are too short to spread */
      bodyW: 108, bodyH: 88,
      headW: 94, headH: 86,      // wider than tall: the broad foxy skull
      /* THE HEADLINE NUMBER. 24 against the Shiba's 32 and the Schnoodle's 33 —
         a quarter shorter than any other dog here. Achondroplasia is the whole
         breed and it is the one thing that must survive at 60 units on a phone. */
      legLen: 24, legW: 13.2,
      /* AND THE OTHER HEADLINE, TWICE THE SHIBA'S EAR IN BOTH DIRECTIONS.
         Authored at 66x34 first, rendered, and it came back as a Shiba with
         slightly perky ears — because the reference was measured wrong by eye.
         Measured properly off the sheet instead: each ear is 69 of the dog's 145
         pixels of width, and the pair spans 144 of them. So one ear is very
         nearly HALF THE WIDTH OF THE WHOLE ANIMAL, its base is almost as wide as
         it is tall, and 37 of the dog's 218 pixels of height are ear standing
         clear above the crown.
         84x48 against the Shiba's 44x29 is what that measures to. It looks like
         a typo in a table of numbers and it is what the art draws. */
      earH: 84, earW: 48,
      muzzleW: 42, muzzleH: 30,  // short, blunt, and wider than deep
      /* up from 1.22 after the first render: see `face` above. This is now level
         with the Schnoodle, who is the roundest-eyed dog in the file and the one
         that survived the "looks angry and not cute" pass. */
      eyeSize: 1.44,
      /* 0.46 of the head half-width. Measured: 0.31 of the body width apart on a
         sheet where the eye is 0.10 of it — three eye-widths of gap. */
      eyeSpacing: 0.46,
      /* A STUB. Pembrokes are born bobtailed, and the reference draws a short
         low fluffy tail rather than a plume or a curl. `tailLen` 0.42 is the
         shortest in the file by a distance; `tailCurl` 0.10 keeps it off the
         back, where a Shiba's 0.72 puts it. */
      tailCurl: 0.10, tailLen: 0.42, tailCarry: -0.06, tailPlume: 1.20,
      neckRuff: 1.24,            // the reference's chest and neck ruff is full
      pawScale: 1.06,
      anchors: {
        neckDY: -0.35,
        neckOverlap: 12,
        muzzleY: 0.44,
        eyeY: 0.00,
        browY: -0.34,
        /* PRICK EARS SIT ON TOP OF THE SKULL, not beside it — the opposite of
           the Cockapoo's `earY: -0.10`, and further up than the Shiba's -0.72,
           because these ones stand well clear of the crown.
           THE ROOT HAS TO BE INSIDE THE SKULL, and this is where the second pass
           went wrong. `earX` was pushed to 0.92 to spread the pair to the edge of
           the head, which is where the reference's ear CENTRES are — and it
           rendered with a visible gap of room between each ear and the head,
           because at x = 0.92 of the half-width the skull's own outline has
           already curved up out of the way, so the base was hanging in mid-air
           beside a dog. A prick ear is drawn as a rigid triangle from its
           anchor (`earChain` is null for `prick`), so nothing closes that gap for
           you the way `behind: true` closes it for a hanging ear.
           0.74 x -0.68 puts the base a few units INSIDE the silhouette on both
           axes, where the head's own fur scallop covers the join. The pair still
           spans the animal, because the ears are 48 wide and lean outward — the
           span comes from their SIZE now, which is what the reference actually
           draws, rather than from moving the roots apart. */
        earX: 0.74,
        earY: -0.68,
        shoulderX: 0.37,
        pawX: 0.40,
        hipX: 0.70,
        hindPawX: 0.86,
        tailBase: [0.60, 0.10],
        cheekY: 0.36,
      },
    },

    silhouette: {
      front: {
        /* generated superellipses (exponent in the comment), so the curvature is
           continuous and no segment is long enough to read as a straight side —
           the lesson the Schnoodle's flat crown paid for */
        /* exponent 2.20: a broad barrel, squarer than an ellipse */
        body: {
          origin: [0.5000, 0.5000], box: [108, 88], pts: [
            [0.5000, 0.0000], [0.6885, 0.0275], [0.8346, 0.1076], [0.9387, 0.2337], [0.9931, 0.3982],
            [0.9931, 0.6018], [0.9387, 0.7663], [0.8346, 0.8924], [0.6885, 0.9725], [0.5000, 1.0000],
            [0.3115, 0.9725], [0.1654, 0.8924], [0.0613, 0.7663], [0.0069, 0.6018], [0.0069, 0.3982],
            [0.0613, 0.2337], [0.1654, 0.1076], [0.3115, 0.0275],
          ],
        },
        bib: {
          origin: [0.5000, 0.3000], box: [46, 62], pts: [
            [0.5000, 0.0000], [0.7584, 0.0640], [0.9360, 0.2416], [1.0000, 0.5000], [0.9360, 0.7584],
            [0.7584, 0.9360], [0.5000, 1.0000], [0.2416, 0.9360], [0.0640, 0.7584], [0.0000, 0.5000],
            [0.0640, 0.2416], [0.2416, 0.0640],
          ],
        },
        /* exponent 2.30: the broadest skull in the file, and the squarest */
        head: {
          origin: [0.5000, 0.5000], box: [94, 86], pts: [
            [0.5000, 0.0000], [0.6967, 0.0263], [0.8405, 0.1034], [0.9412, 0.2263], [0.9934, 0.3909],
            [0.9934, 0.6091], [0.9412, 0.7737], [0.8405, 0.8966], [0.6967, 0.9737], [0.5000, 1.0000],
            [0.3033, 0.9737], [0.1595, 0.8966], [0.0588, 0.7737], [0.0066, 0.6091], [0.0066, 0.3909],
            [0.0588, 0.2263], [0.1595, 0.1034], [0.3033, 0.0263],
          ],
        },
        muzzle: {
          origin: [0.5000, 0.4200], box: [42, 30], pts: [
            [0.5000, 0.0000], [0.7543, 0.0655], [0.9345, 0.2457], [1.0000, 0.5000], [0.9345, 0.7543],
            [0.7543, 0.9345], [0.5000, 1.0000], [0.2457, 0.9345], [0.0655, 0.7543], [0.0000, 0.5000],
            [0.0655, 0.2457], [0.2457, 0.0655],
          ],
        },
        /* THE EAR IS AUTHORED, NOT GENERATED, and it is the only shape on this
           dog that is. A superellipse cannot be this: the reference ear is a
           broad-based triangle whose SIDES ARE CONVEX and whose tip is a small
           tight round — an isoceles shape with a bulge, not a lozenge and not a
           cone. Twelve points rather than the Shiba's six, because the tip round
           needs three of them to itself or it comes back as a corner, and the
           whole read of this dog is these two shapes.
           `origin` puts local (0,0) low and slightly inboard of centre, which is
           where the leather actually meets the skull. */
        ear: {
          origin: [0.4700, 0.9400], box: [34, 66], pts: [
            [0.0300, 1.0000], [0.0000, 0.7100], [0.0850, 0.4300], [0.2300, 0.2000],
            [0.3700, 0.0600], [0.5000, 0.0000], [0.6300, 0.0600], [0.7700, 0.2000],
            [0.9150, 0.4300], [1.0000, 0.7100], [0.9700, 1.0000], [0.5000, 1.0400],
          ],
        },
        /* the lining, held well inside the leather so the outer edge always reads
           as coat. A third of the ear, which is what the reference shows. */
        earInner: {
          origin: [0.4700, 0.9400], box: [34, 66], pts: [
            [0.1900, 0.9300], [0.1700, 0.7000], [0.2400, 0.4600], [0.3400, 0.2700],
            [0.4300, 0.1600], [0.5000, 0.1200], [0.5700, 0.1600], [0.6600, 0.2700],
            [0.7600, 0.4600], [0.8300, 0.7000], [0.8100, 0.9300], [0.5000, 0.9700],
          ],
        },
      },
    },

    markings: [
      /* the white chest. `feather` 0.14 is the LOWEST of the four breeds that
         have a bib: this is a real white marking with a real edge, not a paler
         area of coat, so it is feathered just enough to read as fur. */
      { shape: 'patch', where: 'body', outline: 'bib', color: 'cream', grad: 'bib', deform: 0.75, feather: 0.14 },
      /* THE BLAZE — the shape that makes this dog a corgi at a glance.
         A tall narrow ellipse up the centre line of the face, from the muzzle to
         the crown. It is an `ellipse` rather than a `patch` because `patch` can
         only name one of the six outlines the rig publishes (`rig.sil` in
         dog/rig.js) and a blaze is not one of them; a 0.15 x 0.86 ellipse at
         x 0 IS a stripe, and `soft` 0.5 feathers its long edges into the coat
         without softening it into a smear. Drawn before the cheeks and the brow
         dots so those sit on top of it, which is the order the reference reads.

         NARROWED from 0.15 to 0.11 on the third render. At 0.15 — with `soft`
         adding two wider feathered passes on top — the stripe plus the white
         muzzle below it left more white on the face than orange, and the dog read
         as a white-faced breed with ginger patches rather than a ginger dog with
         a blaze. The reference is unambiguous about which way round that is: the
         blaze is a stripe you notice, not the field it sits in. */
      { shape: 'ellipse', where: 'head', at: [0, -0.06], size: [0.11, 0.82], color: 'cream', alpha: 0.95, soft: 0.45 },
      /* the white lower face — cheeks and jaw below the eye line, meeting the
         blaze so the two read as one white mask with an orange forehead above it.
         0.46 wide, down from 0.52, for the same reason as the blaze. */
      { shape: 'ellipse', where: 'head', at: [0, 0.48], size: [0.46, 0.32], color: 'cream', alpha: 0.90, soft: 0.8 },
      { shape: 'ellipse', where: 'head', at: [0.44, 0.40], size: [0.26, 0.24], color: 'cream', alpha: 0.72, rot: 0.24, mirror: true, soft: 0.9, tag: 'cheek' },
      /* THE TWO PALE DOTS ABOVE THE EYES. A real Pembroke tell, clearly drawn in
         the reference, and the cheapest possible expressiveness: `tag: 'brow'`
         pins them to the brow animation, so they rise and fall with his mood
         exactly as the Shiba's cream brows do. Small and soft — at 0.13 x 0.08
         they are dots, and a dot that grew into a lozenge would be the
         Schnoodle's whole four-pass problem again. */
      { shape: 'ellipse', where: 'head', at: [0.40, -0.40], size: [0.13, 0.08], color: 'cream', alpha: 0.80, rot: 0.20, mirror: true, soft: 0.7, tag: 'brow' },
      /* a darker saddle and flank shading, so the barrel is a volume. Same
         strengths as the Shiba's — this is form, not marking. */
      { shape: 'ellipse', where: 'body', at: [0, -0.80], size: [0.86, 0.44], color: 'coatSh', alpha: 0.20, soft: 0.9 },
      { shape: 'ellipse', where: 'body', at: [0.70, -0.06], size: [0.30, 0.54], color: 'coatSh', alpha: 0.11, mirror: true, soft: 1.0 },
      /* WHITE FRONT LEGS, not socks. `from` 0.10 takes the white almost to the
         shoulder, which is what the reference draws and is a stronger version of
         the Shiba's 0.34 stockings; `cream` rather than `creamMid` and alpha
         0.88 rather than 0.55, because these are white legs on an orange dog. */
      { shape: 'stocking', where: 'legFront', color: 'cream', alpha: 0.88, from: 0.10 },
      { shape: 'tailUnder', color: 'cream', alpha: 0.42 },
    ],

    /* `short`, like the Shiba: the reference is a smooth-coated dog with a
       fluffy ruff, not a doodle. The ruff comes from `neckRuff` 1.24 and the
       clump list below, not from a curly fur type. */
    fur: {
      type: 'short',
      clump: {
        body: { at: [0.15, 0.21, 0.29, 0.35, 0.44, 0.56, 0.65, 0.71, 0.79, 0.85], scale: 1.02 },
        head: { at: [0.30, 0.38, 0.44, 0.56, 0.62, 0.70], scale: 0.90 },
      },
    },

    ear: 'prick',

    /* herding dog: keen and quick, and the friendliest of the prick-eared pair.
       Cosmetic either way — `newDog` has not read `aptitude` since stage 5 (see
       the note there), and it is here because the breed seam's schema says so. */
    temperament: { energy: 0.80, focus: 0.62, friendliness: 0.82 },
    aptitude: { disc: 0.52, agility: 0.66, obedience: 0.74 },
  },

  /* ======================================================================
     GOLDEN RETRIEVER — dog five (8.24.0), from
     `docs/reference/character-sheet-golden.png`.

     THE READ IS ONE PALE GOLD COLOUR AND A BROKEN OUTLINE. There is not a
     single marking on this dog in the reference — no bib, no mask, no socks,
     nothing but a barely lighter chest — and the entire character is carried by
     the SHAPE of the edge: a scalloped, fluffed contour all the way round, a
     round skull with a full crown, short rounded ears hanging flat beside the
     face, and a plume tail.

     THE ONE REAL RISK ON THIS DOG IS THE COCKAPOO, and it has to be named
     rather than hoped away. She is apricot #d9a56f; he is #f4c489. Same hue
     family (33 degrees against 33), 30 luminance points apart, and both are
     fluffy pale floppy-eared puppies. Colour alone will not tell them apart at
     a third of a 390-unit screen. So the separation is put entirely into
     geometry and texture, and each of these is a deliberate step AWAY from her
     rather than an independent choice:

       - EARS: 56 deep against her 80, and set at `earY -0.32` against her
         -0.10. Hers are long spaniel curtains hung at eye level that fall past
         the jaw and frame the face; his are short rounded flaps set high on the
         skull that stop at the cheek. This is the single biggest difference and
         it is why his came out at barely two thirds of hers.
       - MUZZLE: 46 wide and 34 deep against her 46 x 32, and `muzzleY` 0.38
         against her 0.46 — a longer face carried higher, where hers is the
         scissored "muff" disc pushed low.
       - FUR: `curly` against her `wavy`. That table's `curly` is a tighter,
         rounder, deeper lobe with 46 fringe pieces to her 40, which is what
         draws the broken contour the reference has everywhere.
       - EYES: 1.20 against her 1.28, spaced 0.43 against her 0.40. Slightly
         smaller and slightly wider — a retriever's face is broader and less
         doll-like than a teddy-bear trim's.
       - AND NO TOPKNOT. She has a `furnishings` fluff on the crown, which is a
         groomer's mark. He has none: his crown is full because the coat is,
         which is `neckRuff` and the fur type, not a scissored shape.
     ====================================================================== */
  golden: {
    id: 'golden',
    name: 'Golden Retriever',

    /* sampled off the sheet: crown #fdd4a1, lit face #facc92, shaded flank
       #dba162. Nothing here is a pure value and nothing is white — the palest
       thing on him is `cream`, and it is only 20 points off the coat, because a
       uniform dog is the whole instruction. */
    palette: {
      coat: '#f4c489',
      coatShade: '#d79f61',
      /* barely lighter than the coat, and that is the point. Cf. the Schnoodle's
         note: on a dog whose reference has no contrasting markings, a `cream`
         that is genuinely cream builds a pale mask nobody asked for. This one
         drives the chest, the muzzle ramp and the paws, all of which the
         reference draws as the same gold as the rest of him. */
      cream: '#fde0ba',
      nose: '#241d19',           // small dark button, and the only dark on him
      eye: '#241a14',
      tongue: '#f2939b',
      blush: '#e89a86',
      pad: '#e5ab88',
    },

    /* THE SAME EYE FIX AS THE CORGI, for the same reason and found in the same
       render: the global `rig.eyeTilt` lifts the outer corner into a glare, and
       on a face this pale a small dark lidded eye reads as a cross little dot.
       Round, level, and glossy. See the Corgi's `face` note for the full
       argument — it is the Schnoodle's, twice removed. */
    face: {
      eyeTilt: 0,
      eyeHi: 0.98,               // the glossiest eye in the file: the reference's is
      noseSize: 1.06,
    },

    proportions: {
      /* UP FROM 1.14 after the first render. The reference's head is close to
         half the height of the whole animal — a retriever puppy is mostly head
         and feet — and at 1.14 he came back correctly coloured, correctly fluffy
         and slightly weaselly, because the skull was not carrying the frame. */
      headScale: 1.20,
      bodyW: 106, bodyH: 92,
      headW: 96, headH: 92,      // round: as tall as wide
      legLen: 30, legW: 13.6,    // lost in coat, like hers
      /* SHORT AND ROUND, and this is the number that keeps him off the Cockapoo.
         56 against her 80. Hers are curtains that fall past the jaw; his stop at
         the cheek. `floppy` is still the right STYLE — the leather hangs flat
         from a high set, which is a retriever — it is just much shorter. */
      /* 64 after the first render, up from 56. At 56 the leather did not clear
         the cheek and the pair read as two flat pads applied to the sides of his
         head rather than as ears that hang — which is EAR_STYLE.semi's
         documented failure ("two hard pointed flaps standing off the head")
         arriving by a different route. It is still a long way short of the
         Cockapoo's 80, and the SET is what really separates them: see `earY`. */
      earH: 64, earW: 36,
      /* a touch deeper and wider than hers (46x32), carried higher: a retriever
         has a real muzzle where a teddy-bear trim has a disc */
      muzzleW: 46, muzzleH: 34,
      eyeSize: 1.40,             // up from 1.20; see `face` above
      eyeSpacing: 0.43,
      tailCurl: 0.08,            // straight, not curled
      tailLen: 1.02,
      tailCarry: -0.20,          // level with the back, the retriever's carry
      tailPlume: 1.70,           // the fullest plume in the file
      neckRuff: 1.34,            // the ruff IS his crown and chest
      pawScale: 1.18,            // big soft feet
      anchors: {
        neckDY: -0.34,
        neckOverlap: 13,
        /* HIGHER THAN HERS (0.46). The muzzle sits further up the face, which
           lengthens it visually and is most of why he does not read as a
           cockapoo with the lights up. */
        muzzleY: 0.38,
        eyeY: 0.00,
        browY: -0.32,
        /* SET HIGH AND WIDE. `earY -0.32` against her -0.10: a retriever's ear
           is set at or above eye level on the side of a round skull, which with
           `earH` 56 leaves it hanging to about the cheek. Getting this wrong in
           the other direction — low and long — is precisely how he would become
           her. */
        earX: 0.88,
        earY: -0.32,
        shoulderX: 0.37,
        pawX: 0.40,
        hipX: 0.69,
        hindPawX: 0.85,
        tailBase: [0.60, 0.06],
        cheekY: 0.36,
      },
    },

    silhouette: {
      front: {
        /* exponent 2.12 — very nearly an ellipse. The scallop that makes this dog
           look like this comes from `fur.type: 'curly'`, not from the outline;
           the outline's job is to be a clean round mass underneath it. */
        body: {
          origin: [0.5000, 0.5000], box: [106, 92], pts: [
            [0.5000, 0.0000], [0.6817, 0.0285], [0.8295, 0.1112], [0.9366, 0.2400], [0.9928, 0.4041],
            [0.9928, 0.5959], [0.9366, 0.7600], [0.8295, 0.8888], [0.6817, 0.9715], [0.5000, 1.0000],
            [0.3183, 0.9715], [0.1705, 0.8888], [0.0634, 0.7600], [0.0072, 0.5959], [0.0072, 0.4041],
            [0.0634, 0.2400], [0.1705, 0.1112], [0.3183, 0.0285],
          ],
        },
        bib: {
          origin: [0.5000, 0.3000], box: [46, 60], pts: [
            [0.5000, 0.0000], [0.7568, 0.0646], [0.9354, 0.2432], [1.0000, 0.5000], [0.9354, 0.7568],
            [0.7568, 0.9354], [0.5000, 1.0000], [0.2432, 0.9354], [0.0646, 0.7568], [0.0000, 0.5000],
            [0.0646, 0.2432], [0.2432, 0.0646],
          ],
        },
        /* exponent 2.14, in a square box: the round retriever skull */
        head: {
          origin: [0.5000, 0.5000], box: [96, 92], pts: [
            [0.5000, 0.0000], [0.6834, 0.0282], [0.8308, 0.1102], [0.9371, 0.2384], [0.9929, 0.4026],
            [0.9929, 0.5974], [0.9371, 0.7616], [0.8308, 0.8898], [0.6834, 0.9718], [0.5000, 1.0000],
            [0.3166, 0.9718], [0.1692, 0.8898], [0.0629, 0.7616], [0.0071, 0.5974], [0.0071, 0.4026],
            [0.0629, 0.2384], [0.1692, 0.1102], [0.3166, 0.0282],
          ],
        },
        muzzle: {
          origin: [0.5000, 0.4200], box: [46, 34], pts: [
            [0.5000, 0.0000], [0.7517, 0.0664], [0.9336, 0.2483], [1.0000, 0.5000], [0.9336, 0.7517],
            [0.7517, 0.9336], [0.5000, 1.0000], [0.2483, 0.9336], [0.0664, 0.7517], [0.0000, 0.5000],
            [0.0664, 0.2483], [0.2483, 0.0664],
          ],
        },
        /* the chain renderer builds the hanging ear from `EAR_STYLE.floppy`'s
           width profile, so these two are mostly the seam's requirement rather
           than the drawn shape — see the same note on the Cockapoo. Kept as a
           short rounded lobe so anything that reads them directly gets the right
           silhouette. */
        ear: {
          origin: [0.5000, 0.1000], box: [34, 52], pts: [
            [0.5000, 0.0000], [0.6589, 0.0560], [0.7753, 0.2437], [0.8100, 0.5000], [0.7753, 0.7563],
            [0.6589, 0.9440], [0.5000, 1.0000], [0.3411, 0.9440], [0.2247, 0.7563], [0.1900, 0.5000],
            [0.2247, 0.2437], [0.3411, 0.0560],
          ],
        },
        earInner: {
          origin: [0.5000, 0.1000], box: [34, 52], pts: [
            [0.5000, 0.0000], [0.6210, 0.0836], [0.6928, 0.3434], [0.6928, 0.6566], [0.6210, 0.9164],
            [0.5000, 1.0000], [0.3790, 0.9164], [0.3072, 0.6566], [0.3072, 0.3434], [0.3790, 0.0836],
          ],
        },
      },
    },

    /* ---- markings: ALMOST NOTHING, ON PURPOSE ---------------------------
       The reference has no markings at all. What is here is FORM — the shading
       that makes a pale round animal read as a volume rather than a silhouette —
       plus the faint heart-shaped chest the sheet does draw. Every alpha is the
       lowest of any breed in this file, and if any of them starts reading as a
       patch the answer is to lower it further, not to soften its edge.
       ------------------------------------------------------------------- */
    markings: [
      /* the chest, a whisper. `feather` 0.26 is the highest in the file: on a
         uniform dog the bib must have no findable edge anywhere. */
      { shape: 'patch', where: 'body', outline: 'bib', color: 'cream', grad: 'bib', deform: 0.75, feather: 0.26 },
      /* a gentle saddle. 0.14, below even the Schnoodle's 0.17 — a pale gold coat
         shows a dark stripe far more readily than an auburn one. */
      { shape: 'ellipse', where: 'body', at: [0, -0.76], size: [0.84, 0.44], color: 'coatSh', alpha: 0.14, soft: 1.0 },
      { shape: 'ellipse', where: 'body', at: [0.70, -0.04], size: [0.30, 0.54], color: 'coatSh', alpha: 0.09, mirror: true, soft: 1.0 },
      /* a barely-there warm lift around each eye, `tag: 'eye'` so it tracks the
         lens through every pose. Same trick and the same reasoning as the
         Schnoodle's: it is what stops a very dark eye on a pale face reading as
         a hole punched in him. */
      { shape: 'ellipse', where: 'head', at: [0.43, 0.00], size: [0.23, 0.15], color: 'creamMid', alpha: 0.12, mirror: true, soft: 1.0, tag: 'eye' },
      /* the lighter muzzle and cheeks the sheet does draw, at half the
         Cockapoo's strength (she is 0.55) because his coat is 30 points paler
         and the same alpha on it is a visible pale patch */
      { shape: 'ellipse', where: 'head', at: [0, 0.40], size: [0.42, 0.28], color: 'cream', alpha: 0.26, soft: 1.0 },
      { shape: 'ellipse', where: 'head', at: [0.54, 0.32], size: [0.26, 0.22], color: 'cream', alpha: 0.22, rot: 0.20, mirror: true, soft: 0.95, tag: 'cheek' },
      /* NO STOCKINGS. Every other breed here has them and he must not: the
         reference's legs are the same gold as the rest of him, and a pale sock
         on a pale dog is the one marking that cannot help but read as applied. */
      { shape: 'tailUnder', color: 'cream', alpha: 0.18 },
    ],

    /* `curly`, not `wavy`. The reference's contour is broken everywhere — crown,
       cheeks, chest, haunches, tail — and `curly` is the table's tighter, rounder,
       deeper lobe: 46 fringe pieces to `wavy`'s 40, four curl arcs to three.
       This is one of the five things keeping him off the Cockapoo, and it is the
       one that does the most work at small sizes, because a broken outline
       survives being 120 units tall and a hue difference does not. */
    fur: {
      type: 'curly',
      clump: {
        body: { at: [0.10, 0.17, 0.235, 0.30, 0.37, 0.45, 0.55, 0.63, 0.70, 0.765, 0.83, 0.90], scale: 1.08 },
        head: { at: [0.24, 0.31, 0.38, 0.44, 0.56, 0.62, 0.69, 0.76], scale: 0.94 },
      },
    },

    ear: 'floppy',

    /* NO `furnishings`. The Cockapoo has a topknot because a groomer left her
       one; a retriever is not groomed and his full crown comes from the coat
       itself. Adding a fluff here would be borrowing her single most
       recognisable shape. */

    temperament: { energy: 0.74, focus: 0.66, friendliness: 0.96 },
    aptitude: { disc: 0.78, agility: 0.58, obedience: 0.80 },
  },

};

export const BREED_IDS = Object.keys(BREEDS);

export function getBreed(id) {
  return BREEDS[id] || BREEDS.shiba;
}

export default BREEDS;
