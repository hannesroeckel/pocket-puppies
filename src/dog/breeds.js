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
     The read is CHEEKY AND CHARACTERFUL, and it lives entirely in the
     facial furniture: a squarer skull, a longer blunt muzzle, a BEARD that
     hangs below the jaw, a moustache flaring off the muzzle, and bushy
     EYEBROWS that project forward over the eyes. Coat is wiry-curly, so the
     silhouette breaks into uneven wisps rather than round ringlets.
     Semi-erect button ears: the base stands up off the skull and the leather
     folds forward — which also keeps him instantly distinguishable from the
     cockapoo in silhouette alone.
     ====================================================================== */
  schnoodle: {
    id: 'schnoodle',
    name: 'Schnoodle',

    /* SALT-AND-PEPPER. Each hair is banded light/dark, which at any distance
       averages to a cool mid grey — so the base coat is that average, and the
       banding is implied by the curl texture rather than drawn hair by hair.
       The furnishings (brows, beard, chest, legs) are markedly PALER, which
       is the single most recognisable thing about the colour. */
    palette: {
      /* SALT-AND-PEPPER IN A WARM ROOM. The first pass took the breed standard
         literally and used a neutral-cool grey; rendered in this room — which is
         lit amber from a window — he read as a cut-out from a different picture
         and sat visibly apart from the scene. Real banded grey hair under warm
         light averages to a warm greige, so every grey here carries a little of
         the room's amber. It is still unmistakably salt-and-pepper (compare the
         Shiba's #e9954f), it just belongs in the space. */
      /* WARMED AND LIFTED AGAIN. He was still sitting cooler and darker than
         the room: a grey dog in an amber room reads as cut out of a different
         picture and pasted in, however correct the grey is. Salt-and-pepper is
         the breed and stays — this is the same hue family, moved a few degrees
         toward the lamp and lifted about 8% in value, so the window light has
         something to catch. Next to the Cockapoo's apricot he is still
         unmistakably the grey dog. */
      coat: '#968d7c',           // the optical AVERAGE of the banded hairs
      coatShade: '#6b6355',      // spine / saddle
      cream: '#e9e1cd',          // the pale furnishings — the recognisable bit
      nose: '#211e1b',
      eye: '#2b2119',            // warm near-black, not the old cool #231e1b
      tongue: '#ee8d96',
      blush: '#e0968c',
      pad: '#b8a898',
      extra: {
        /* the highlight is what the window catches; keeping it cool was most of
           why he looked lit by a different lamp than the room */
        coatHi: '#c8bfa8',
        /* the ink warmed too: a near-neutral outline on a warmed coat in an
           amber room is the last thing holding him at a colder temperature */
        line: '#39322a',
        line2: '#4b4338',
        /* THE BROWS ARE THE PERSONALITY, so they get their own pale. Drawn in
           `cream` with a creamSh rim and an inner shade they came out grey and
           washed into the mask — the one feature that has to shout was the
           quietest thing on the face. On a real salt-and-pepper the brows and
           beard are the whitest hair on the dog. */
        creamHi: '#f7f1df',
        /* THE FACIAL MASK, INVERTED. It used to run light at the bridge and
           DARKEST at the lip (muzSh #474338) — so the one part of the muzzle
           left visible between the moustache and the beard was the darkest
           thing on the dog, framed by cream on three sides. Rendered, that
           window read as a gaping black hole and it was the first thing the eye
           landed on: the single biggest reason he looked miserable rather than
           cheeky.
           So the ramp now runs DARK AT THE BRIDGE (which is what the pale brows
           need to contrast against, and what actually carries the salt-and-
           pepper mask) and PALE AT THE LIP, where the beard hair starts on a
           real dog. Any gap the swinging beard opens up now shows pale muzzle,
           not a hole. */
        muzHi: '#575046',        // top: the dark bridge, under the brows
        muzMid: '#767060',
        muzSh: '#a4998a',        // bottom: the pale lip field
      },
    },

    /* the beard and moustache are drawn ON TOP of the face, so the mouth has to
       be drawn on top of THEM or there is no mouth at all — see face.mouthOver
       in dog/draw.js. And this is the cheeky dog: the corners lift half again
       as far as a Shiba's, the line is wider and the sag between centre and
       corner is shallower, so the mouth arcs UP even at rest. */
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
      /* AND THE GLINT STAYS A GLINT. 0.86 of the default, and it now narrows
         with the lid, so a petting squint gets a small bright spot instead of a
         white bar that reads as sclera. Big dark eye, small bright highlight —
         the Cockapoo's balance, on a more almond eye. */
      eyeHi: 0.86,
      noseSize: 1.14,     // a schnauzer nose is large and blunt
      mouth: { w: 1.34, lift: 1.85, dip: 0.58, philtrum: 0.45, weight: 1.15 },
    },

    proportions: {
      headScale: 1.10,
      bodyW: 104, bodyH: 88,
      /* TALLER THAN WIDE. The number one error on this breed is a round head;
         the front view has to read as a vertical rectangle. The flat crown is
         in the silhouette, the corners are built by the brows and beard. */
      headW: 92, headH: 96,
      legLen: 35, legW: 12.8,    // square and leggier: the jacket is short
      earH: 46, earW: 32,        // small V, folding forward
      muzzleW: 44, muzzleH: 42,  // at least as long as the skull: the brick
      /* AT 1.12/0.34 HE LOOKED WORRIED. Small close-set eyes under a heavy pale
         brow is the anatomy of anxiety, and next to the cockapoo's 1.28 the
         difference read as mood rather than as breed. These stay smaller and
         more almond than the cockapoo's — that IS the breed — but only just. */
      eyeSize: 1.34,             // oval and deep-set, but this is a PUPPY
      eyeSpacing: 0.375,         // still closer than the cockapoo's 0.40
      tailCurl: 0.12,
      tailLen: 0.92,
      tailCarry: -0.44,          // set high, carried up, jaunty
      tailPlume: 0.90,           // wiry coats carry a thin whippy tail
      neckRuff: 1.08,
      pawScale: 1.04,
      anchors: {
        neckDY: -0.35,
        neckOverlap: 12,
        muzzleY: 0.34,           // set high: leaves the jaw free for the beard
        eyeY: -0.03,             // dropped: a low eye is a puppy eye
        browY: -0.34,
        earX: 0.68,
        earY: -0.62,             // set HIGH: a button ear folds from the skull
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
        /* FLAT CROWN, straight sides, width diminishing toward the nose —
           "strong and rectangular, its width diminishing slightly from ears
           to eyes, and again to the tip of the nose". 18 points, because a
           flat plane needs more of them than a curve does. */
        head: {
          origin: [0.5000, 0.5000], box: [92, 96], pts: [
            [0.5000, 0.0083], [0.6704, 0.0120], [0.8471, 0.0597], [0.9590, 0.1897], [0.9867, 0.3465],
            [0.9740, 0.5893], [0.9225, 0.7753], [0.8044, 0.9295], [0.6469, 0.9866], [0.5000, 0.9920],
            [0.3529, 0.9877], [0.1948, 0.9308], [0.0765, 0.7761], [0.0255, 0.5894], [0.0138, 0.3466],
            [0.0422, 0.1903], [0.1540, 0.0608], [0.3300, 0.0128],
          ],
        },
        /* a blunt wedge, deep as it is wide: the schnauzer foreface */
        muzzle: {
          origin: [0.5000, 0.3800], box: [44, 42], pts: [
            [0.5000, -0.0100], [0.7592, 0.0225], [0.9459, 0.2261], [0.9707, 0.5000], [0.9371, 0.7685],
            [0.7504, 0.9613], [0.5000, 0.9900], [0.2500, 0.9606], [0.0640, 0.7678], [0.0307, 0.5000],
            [0.0552, 0.2268], [0.2412, 0.0231],
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

    markings: [
      /* the pale chest and underside — salt-and-pepper dogs are much lighter
         underneath, and it is what stops a grey dog reading as flat */
      { shape: 'patch', where: 'body', outline: 'bib', color: 'cream', grad: 'bib', deform: 0.75, feather: 0.22 },
      /* the dark saddle is strong on a salt-and-pepper: back and flanks are
         markedly darker than the furnishings */
      { shape: 'ellipse', where: 'body', at: [0, -0.72], size: [0.88, 0.50], color: 'coatSh', alpha: 0.30, soft: 0.95 },
      { shape: 'ellipse', where: 'body', at: [0.70, -0.06], size: [0.32, 0.56], color: 'coatSh', alpha: 0.14, mirror: true, soft: 1.0 },
      /* THE PEPPERING. Sparse ticks over the saddle and hips only.
         SMALLER AND FAINTER than the first pass: at r 1.7 / alpha 0.42 the pale
         half of the pair read as scattered white lint on the shoulders rather
         than as banded hair, and the light colour is pulled off pure so it
         cannot pop. Peppering is a texture you notice second, not first. */
      { shape: 'ticks', where: 'body', at: [0, -0.52], size: [0.74, 0.34], n: 30, r: 1.15, alpha: 0.26, colors: ['#332f2a', '#cfc8b9'] },
      /* A DARK CROWN AND MASK, so the pale brows read against it. Extended DOWN
         over the brow band: at -0.70 x 0.30 it stopped at y -0.40 of the head
         and the brows sit at -0.30, so the one place the mask existed to create
         contrast was the one place it did not reach — and once the coat was
         warmed and lightened the cream brows started dissolving into the
         forehead. A schnauzer's skull cap is dark down to the brow line. */
      { shape: 'ellipse', where: 'head', at: [0, -0.60], size: [0.66, 0.42], color: 'coatSh', alpha: 0.38, soft: 1.0 },
      /* DEEP-SET EYES: the socket is shadowed under the brow ridge. Without
         this the eyes read as big and bright, which is a cockapoo. Held to
         0.09 and lifted clear of the lens, though — at 0.13 sitting across the
         eye it was dimming the one feature that has to carry warmth, and a dim
         eye under a heavy brow is a sad dog however cheeky the mouth is. */
      { shape: 'ellipse', where: 'head', at: [0.375, -0.17], size: [0.26, 0.12], color: 'coatSh', alpha: 0.09, mirror: true, soft: 1.0 },
      /* THE PALE SOCKET. tag:'eye' pins it to the lens through every pose (see
         the anim hook in drawFace). Without it the black eye sat on mid-grey
         mask with the brow's own shadow rim touching its upper lash, the two
         darks fused, and what was left read as a squint. `at` deliberately
         mirrors eyeSpacing / anchors.eyeY exactly. */
      /* TURNED DOWN from 0.28. This was a crutch for a problem that no longer
         exists: it existed to stop the black eye fusing with the brow's shadow
         rim, and the eye is now drawn ON TOP of the brow (face.eyesOver), so
         nothing can touch it. At 0.28 it was one more pale cloud in an upper
         face that already has brows, cheeks and a moustache competing, and the
         whole region read as undifferentiated fluff. Kept faint: a real
         salt-and-pepper does lift the hair right around the eye. */
      { shape: 'ellipse', where: 'head', at: [0.375, -0.03], size: [0.215, 0.135], color: 'creamMid', alpha: 0.15, mirror: true, soft: 1.0, tag: 'eye' },
      /* pale cheek furnishings flanking the muzzle */
      { shape: 'ellipse', where: 'head', at: [0.56, 0.34], size: [0.22, 0.20], color: 'creamMid', alpha: 0.55, rot: 0.22, mirror: true, soft: 0.9, tag: 'cheek' },
      { shape: 'stocking', where: 'legFront', color: 'creamMid', alpha: 0.66, from: 0.24 },
      { shape: 'tailUnder', color: 'cream', alpha: 0.22 },
    ],

    fur: {
      type: 'wiry',
      clump: {
        body: { at: [0.11, 0.18, 0.25, 0.32, 0.40, 0.48, 0.56, 0.64, 0.71, 0.78, 0.86, 0.93], scale: 1.0 },
        head: { at: [0.26, 0.33, 0.40, 0.47, 0.55, 0.63, 0.71, 0.78], scale: 0.88 },
      },
    },

    ear: 'semi',

    /* ---- THE PERSONALITY --------------------------------------------------
       Everything that makes a schnauzer face a schnauzer face. Order matters:
       the moustache flares off the muzzle, the beard hangs below the jaw from
       behind it, and the brows sit over the eyes and are allowed to overhang
       the skull line. `wisp` adds the bristle that stops a brow reading as a
       pillow — a schnauzer's furnishings are harsh-coated, not downy.
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
        /* RAISED AND SHORTENED vs the first pass, for two reasons.
           Down at at:[0,0.82] reaching to +0.71 it hung to y≈81 on a head whose
           jaw is at y≈53 — half a head below the chin. Rendered, that is not a
           beard, it is a bib: it swallowed the whole chest and the pale chest
           marking with it.
           And its TOP edge started below the mouth, which left the mouth
           stranded on bare muzzle. Now the top reaches up under the moustache,
           so the mouth (drawn last, see face.mouthOver) lands on beard hair and
           reads as a dark line on cream instead of dark on dark. */
        kind: 'fluff', tag: 'beard', layer: 'over', at: [0, 0.60],
        color: 'cream', shade: 'creamSh', shadeIn: 0.30,
        tuftAmp: 2.6, tuftCycles: 13, tuftPow: 1.0,
        /* narrow where it leaves the jaw, WIDENING forward and down, and a
           broad flat bottom. No taper to a point: that is the round-ball
           beard the reference warns about. */
        path: [
          [-0.24, -0.20], [-0.37, -0.06], [-0.49, 0.10], [-0.55, 0.30],
          [-0.50, 0.46], [-0.32, 0.55], [-0.13, 0.585], [0, 0.59],
          [0.13, 0.585], [0.32, 0.55], [0.50, 0.46], [0.55, 0.30],
          [0.49, 0.10], [0.37, -0.06], [0.24, -0.20], [0.11, -0.25],
          [0, -0.26], [-0.11, -0.25],
        ],
        wisp: {
          n: 7, from: [0, 0.55], spanX: 0.40, len: 0.14, angle: 1.35,
          spread: 0.5, curl: 0.30, color: 'creamSh', alpha: 0.34, width: 1.6,
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
        kind: 'fluff', tag: 'moustache', layer: 'over', at: [0.345, 0.205], mirror: true,
        color: 'cream', shade: 'creamSh', shadeIn: 0.26,
        tuftAmp: 2.2, tuftCycles: 10, tuftPow: 1.15,
        path: [
          [-0.190, -0.055], [-0.020, -0.135], [0.160, -0.130], [0.300, -0.045],
          [0.320, 0.075], [0.200, 0.185], [0.020, 0.235], [-0.140, 0.200],
          [-0.200, 0.090],
        ],
        wisp: {
          n: 5, from: [0.24, 0.02], spanX: 0.08, len: 0.15, angle: 0.60,
          spread: 0.7, curl: 0.4, color: 'creamSh', alpha: 0.44, width: 1.6,
        },
      },
      /* EYEBROWS — THE PERSONALITY.
         Two separate tufts joined at a midline parting, reading as a shallow
         gull-wing from the front. They start on the brow BONE (roughly behind
         the eye), sweep forward and outward, and are LONGEST TOWARD THE NOSE —
         so the inner lobe is the big one and the outer lobe is small and
         higher, which is what puts the diagonal "outer corner down to the
         nose" line in and produces the quizzical down-the-nose look.
         They overhang and shade the eye; they must never bury it. */
      {
        /* DROPPED ONTO THE EYE. At -0.33 the brow's bottom edge stopped about
           two units clear of the eye's top, so it read as a pale slab FLOATING
           above a small dark eye — brow and eye as two separate features with a
           shadow gap between them, which is the anatomy of a worried face. A
           real schnauzer brow physically overhangs and shades the eye; landing
           it on the top of the eye is what turns "worried" into "peering out
           from under".
           BUT A FURNISHING'S DRAWN EDGE IS NOT ITS AUTHORED EDGE. buildFluff
           pushes the path out along its normals by up to ~2.7 units of tuft and
           then lays a 2-unit dark rim outside that, so the visible bottom of
           this brow falls about 4.5 units below the path. At -0.205 it reached
           past the middle of the eye and hid it almost completely. -0.295 puts
           the mean edge on the eye's top lash line with the tuft peaks dipping
           a couple of units in: hooded, not buried. */
        /* RAISED to -0.335 and given an INK EDGE.
           Raised, because the eye is now drawn on top of the brow
           (face.eyesOver) — so the brow no longer has to be jammed down onto
           the lid to look like it overhangs. It can sit where a brow ridge
           actually is and still read as hooding, because the lens crosses in
           front of its lower edge.
           Inked, because every other feature in this game has an outline — the
           nose, the mouth, the whole silhouette — and the furnishings did not.
           Drawn in pale-on-pale (creamSh) the brows, cheeks and moustache
           dissolved into ONE cream cloud round the face and the brows stopped
           being a feature you could name. A thin dark edge is what makes them
           read as two drawn tufts, and it is also how they are drawn on paper.
           BUT NOT A FULL INK LINE. At `line2` the ragged tuft profile traced
           the outline as a hard zigzag and the pair came back as two scribbled
           pale RECTANGLES floating high on the forehead — outlined shapes, not
           hair, and separated from the eye again. `coatSh` is dark enough to
           separate brow from forehead and from the cheek fluff, light enough
           that the edge still reads as the shaded underside of a tuft. */
        /* AND DROPPED BACK ONTO THE LID — with light, not with position.
           Inked and raised, the pair came back as pale grey-white irregular
           patches FLOATING above the eyes: they read as smudges or torn paper
           because nothing in the picture said they were attached to the head.
           The temptation is to push them down onto the eye, but that is how the
           eye got crushed into a slit twice before. What actually attaches a
           mass to a face is SHADOW: `contact` throws a soft shadow from the brow
           down onto the lid (so the brow is demonstrably in front of the skull,
           overhanging it) and `shadeUnder` darkens its own underside (so it is a
           rounded overhanging form, lit from above, rather than a flat cutout
           lit from below as `shadeIn` was doing). The brow now frames the eye
           from above and never covers it — the eye is still drawn last. */
        /* AND THE BROW IS THE SAME HAIR AS THE BEARD. `creamHi` made it the
           brightest thing on the dog — brighter than the beard, brighter than
           the chest — and a near-white patch on a mid-grey skull separates from
           it whatever else is done to the edge: that is most of the "torn paper"
           read. On a real salt-and-pepper the brows and the beard are one
           furnishing colour. Now they match, the face reads as ONE dog, and the
           brow is legible because of its shadow and its edge rather than because
           it is the whitest object in frame. */
        kind: 'fluff', tag: 'brow', layer: 'over', at: [0.45, -0.292], mirror: true,
        color: 'cream', shade: 'coatSh', rim: 0.52, shadeUnder: 0.46,
        contact: { dy: 0.062, alpha: 0.30, color: 'coatSh' },
        /* HARSH-COATED, not downy. A shallow tuft profile rendered as two flat
           white slabs stuck over the eyes; a schnauzer brow is bristle, so the
           amplitude is high, the cycles many and the power >1 (pointy notches
           rather than round scallops). The wisps carry the rest.
           THE RAGGED EDGE STAYS. It was tuned down to 1.55/8 to try to make the
           wedge shape survive, and the result was two flat pale patches with no
           bristle at all — legible as shapes, dead as character. Bushy is the
           point; the shape is carried by the anchor and the lifted outer tip,
           not by a clean outline. */
        /* Softened from 2.5/12/1.30. With a rim dark enough to define the mass,
           a high-amplitude pointy profile stops reading as bristle and starts
           reading as a zigzag border drawn round a patch. The bristle now comes
           from the wisps, which is where it belongs — those are actual hairs. */
        /* SOFTENED AGAIN, to a mid-tone scallop. At 2.0/10/1.05 the profile
           still cusps (pow > 1) on a shape only ~16 units deep, and ten coarse
           cusps round a small pale mass is not bristle, it is a TORN EDGE — the
           single biggest reason these read as ripped paper. More cycles, less
           amplitude and a power below 1 give a run of small round scallops:
           soft hair against the coat. The bristle still comes from the wisps.
           BUT NOT SMOOTH EITHER. Taken all the way to 1.45/15/0.74 the pair
           came back as two flat pale BANDAGES: fifteen tiny ripples round a
           small shape is a straight edge at viewing size. What reads as hair is
           CLUMP-scale — bumps a few units wide and a couple deep, the same
           relative coarseness the beard has and gets away with. */
        tuftAmp: 1.95, tuftCycles: 11, tuftPow: 0.86,
        /* A WEDGE, not a puff. In this frame +x is outward, so the INNER end
           (-x, toward the nose) is the thick, long one — brows are longest
           toward the nose — and the outer end is thin.
           HELD DELIBERATELY SHALLOW. Sloping the pair steeply down toward the
           centre gave a genuinely ANGRY dog on the first render; the brief
           asks for cheeky. So the slope is gentle, the whole brow is lifted
           clear of the eye, and the bottom edge only clips the eye's top
           quarter — enough to hood it, not enough to scowl or to bury it. */
        /* inner edge held back from the midline so the pair reads as TWO
           tufts with a parting, not one bristly band across the whole face.
           THE OUTER TIP LIFTS. The old path was near-symmetric — a flat lens —
           and a flat brow over a dark eye is expressionless at best; what the
           render actually showed was the INNER ends sitting highest, which is
           precisely the raised-inner-brow of a pleading dog. Now the mass is
           thick from the nose end through the middle (brows are longest toward
           the nose) and thins to a tip that sits HIGHER than the rest, so the
           pair arches. That is the quizzical, ears-up, up-to-something read the
           reference calls scruffy and characterful. */
        /* AND BIGGER. A schnauzer's brows are the most prominent thing on the
           head — shaggy awnings, not eyebrow pencil — and at the first size
           they simply did not have enough area to carry an expression on a
           50-unit-wide skull. Scaled ~14% and re-anchored so the bottom edge
           still lands on the eye's top lash. */
        /* AND IT ARCHES OUTWARD. Level, the pair reads as two bars laid over the
           eyes and the face goes deadpan — correct anatomy, no opinion. A dog
           that is pleased to see you lifts the OUTER brow (raising the inner one
           is the pleading face, which is what an earlier pass accidentally drew).
           So the outer third climbs while the inner end stays heavy and low: a
           gentle diagonal running up and away from the nose. Still shallow —
           steepen it the other way and he is angry. */
        path: [
          [-0.330, -0.120], [-0.148, -0.186], [0.021, -0.190], [0.191, -0.208],
          [0.330, -0.244], [0.362, -0.126], [0.246, -0.028], [0.064, 0.072],
          [-0.127, 0.119], [-0.308, 0.084],
        ],
        wisp: {
          n: 11, from: [0.02, -0.185], spanX: 0.30, len: 0.20, angle: -0.95,
          spread: 1.00, curl: 0.55, color: 'creamSh', alpha: 0.62, width: 2.0,
        },
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
