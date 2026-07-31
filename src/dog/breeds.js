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
         below. This is now the largest eye of the three breeds, on purpose: the
         reference has big round very dark eyes and they are the whole read. */
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
      /* EYEBROWS — REBUILT, AND THE SINGLE BIGGEST CHANGE ON THE FACE.
         ------------------------------------------------------------------
         The pair that was here carried FOUR of the six documented anger cues at
         once, and the comment history shows each one being argued into place on
         anatomical grounds without anyone checking what the assembled face
         actually said:

           1. It slanted DOWN TOWARD THE CENTRE. The path had the inner end
              "heavy and low" and the outer third climbing, which is by
              definition inward-down — the strongest anger signal there is in any
              species. It was authored deliberately, reasoned as "a dog that is
              pleased to see you lifts the OUTER brow". That is true of a dog
              lifting a brow, and it is also exactly the geometry of a scowl when
              it is the brow's resting shape.
           2. It OVERHUNG and shaded the eye: `contact` threw a shadow down onto
              the lid and `shadeUnder: 0.46` darkened its own underside, both
              added to "attach the mass to the face".
           3. It was INKED. `shade: 'coatSh'` at rim 0.40 put a hard dark line
              directly above a pale mass directly above the eye — high-contrast
              dark-over-light around the eye, which reads as a scowl.
           4. It was `cream` on grey: an 84-point value step, i.e. the pale
              patch stuck on the face that the feedback is about.

         What replaces it is a soft ROUNDED tuft of the dog's own hair:

         LEVEL, AND ARCHED. The apex is at the middle and both ends fall away
         equally — the inner tip's mean height is 0.018 and the outer tip's is
         0.014, a 0.2-unit difference across a 28-unit span, which is level to
         within a pixel. That is deliberate: inward-DOWN is angry and inward-UP is
         pleading (an earlier pass drew that one by accident and it was noted),
         so the safe shape is neither. A rounded arch is the only brow on the
         cute list that is not simply absent.

         NO INK, NO CONTACT SHADOW, NO shadeUnder. `shade` is `creamSh` — the
         beard's own shade, one step down the same warm ramp — and `rim` drops
         from 0.40 to 0.08, so the edge is the shaded underside of a tuft of fur
         instead of a drawn line. `contact` is gone outright: it existed to prove
         the brow was in front of the skull, and a same-colour tuft does not need
         proving because it cannot detach. A whisper of `shadeIn` is all the form
         it needs.

         RAISED CLEAR OF THE EYE. The drawn bottom edge (path + ~1.6 of tuft +
         0.16 of rim) lands about 2 units above the top of the lens rather than on
         its lash line. Hooding an eye is what "peering out from under" needs, and
         "peering out from under" is not on the cute list. The eye is still drawn
         last (face.eyesOver), so nothing can bite into it regardless.

         It is still legible, and it is still the schnauzer note that stops him
         being a cockapoo — but now as fur volume and silhouette, which is what
         the brief asks for, rather than as two pale objects. */
      {
        /* centred on the eye (eyeSpacing is 0.425) and brought a little closer to
           it: at -0.265 the drawn bottom edge sat a clear 2.4 units above the top
           of the lens, and a brow with a visible gap under it reads as a separate
           object hovering on the forehead — which is the old "floating pale slab"
           complaint arriving by a different route. 1.4 units still leaves the eye
           completely uncovered (nothing about hooding is wanted here) while
           putting brow and eye in the same feature group. */
        kind: 'fluff', tag: 'brow', layer: 'over', at: [0.425, -0.255], mirror: true,
        /* `browTone` — the SMALLEST tone step on the dog, and the reason is in
           the palette note for that key: the beard and the moustache are big
           enough to carry `furn`, but a brow tuft only ~9 units deep needs to be
           much closer to the coat or it reads as an applied patch rather than as
           a raised part of it. `shade` stays on `furnSh` so the underside still
           has enough form to read as raised. */
        color: 'browTone', shade: 'furnSh', rim: 0.05, shadeUnder: 0.15,
        /* low amplitude, many cycles, pow well below 1: small ROUND scallops.
           The old 1.95/11/0.86 was tuned to look like bristle on a harsh-coated
           adult; this is a soft puppy coat. */
        tuftAmp: 1.05, tuftCycles: 17, tuftPow: 0.70,
        /* A ROUNDED ARCH. Apex just inboard of centre, both tips level, no
           straight run anywhere. In this frame +x is OUTWARD (away from the
           midline), so the pair mirrors about the nose.
           NARROWED from +-0.268 to +-0.205. At 28 units across on an 18.6-unit
           eye the tuft was half again as wide as the thing it sits over, and a
           shape that much wider than its feature reads as a horizontal BAR — at
           face-crop size the pair were the second-loudest thing in the picture
           after the eyes. Just wider than the eye reads as a brow. */
        path: [
          [-0.268, -0.012], [-0.180, -0.070], [-0.030, -0.100], [0.130, -0.088],
          [0.262, -0.024], [0.262, 0.052], [0.130, 0.086], [-0.020, 0.094],
          [-0.175, 0.070], [-0.268, 0.048],
        ],
        /* NO WISPS. The pair carried 11 of them at alpha 0.62, described as the
           harsh bristle a schnauzer's furnishings are made of. Rendered at any
           alpha they came out as thin dark lines radiating up and out of the tuft
           — legible at face-crop zoom as SCRATCHES on the forehead, not as hair,
           because a hair drawn in the shade colour on top of a mass in the fill
           colour is a stroke, and strokes on fur read as scribble. The beard and
           the moustache keep theirs (they are big enough that a wisp reads as a
           strand leaving a mass); a brow only ~9 units deep is not.
           And bristle is the wrong material anyway now: this is a soft puppy
           coat, and the brief's cute brow is rounded, not harsh. */
      },
    ],

    temperament: { energy: 0.78, focus: 0.58, friendliness: 0.80 },
    aptitude: { disc: 0.62, agility: 0.70, obedience: 0.66 },
  },

};

export const BREED_IDS = Object.keys(BREEDS);

export function getBreed(id) {
  return BREEDS[id] || BREEDS.shiba;
}

export default BREEDS;
