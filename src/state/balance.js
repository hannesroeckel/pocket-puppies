/* ==========================================================================
   state/balance.js — EVERY tunable number in the game.
   If a designer might want to change it, it lives here. Nothing else has
   magic numbers (art geometry lives as *data* in dog/breeds.js).
   ========================================================================== */

export const BALANCE = {

  /* ---- virtual view -------------------------------------------------- */
  view: {
    W: 390,            // design-space width  (all scene coords are in these units)
    H: 844,            // design-space height
    floorY: 545,       // where the wall meets the floor
    dprMax: 2.25,      // fill-rate protection; the spike proved this holds 60fps
    dprMin: 1,
  },

  /* ---- loop ---------------------------------------------------------- */
  loop: {
    dtMax: 1 / 30,     // HARD clamp. A backgrounded tab must not fling springs.
    dtFallback: 1 / 60,
    statWindow: 240,   // frame-time samples kept for median/p95
  },

  /* ---- rng ----------------------------------------------------------- */
  rng: {
    seed: 20260728,    // idle variety is deterministic & testable
    roomSeed: 991177,  // baked room decoration
  },

  /* ---- persistence --------------------------------------------------- */
  save: {
    key: 'pocket-puppies:v1',
    debounceMs: 800,
    logCap: 40,        // dog.log ring buffer
  },

  /* ---- time & decay -------------------------------------------------- */
  time: {
    maxDecayHours: 36,          // principle 1: beyond this, nothing degrades
    reunionAfterHours: 8,
    needDecayPerHour: {         // 0..1 units lost per hour away
      hunger: 0.030,
      thirst: 0.042,
      cleanliness: 0.014,
      energy: -0.060,           // negative = energy RECOVERS while away
    },
    affectionDipPerHour: 0.004, // small "missed you" dip, never below the floor
    affectionDipMax: 0.10,
    /* clock-tamper guard: a lastSeenAt further ahead than this is not trusted */
    clockSkewGraceMs: 60e3,
  },

  /* ---- affection -----------------------------------------------------
     Affection is NEVER drawn as a bar (see ui/hud.js and ARCHITECTURE §11).
     It exists here because it drives posture, tail, ears, eyes and mouth —
     you read the bond off the animal's body, the way the original did.
     ------------------------------------------------------------------- */
  affection: {
    start: 0.06,
    startFloor: 0.04,
    perStrokeUnit: 0.00075,     // per rig-unit of travel
    maxSegPerFrame: 14,         // don't let one huge jump pay out
    tapGain: 0.012,
    idleDrainPerSec: 0.0075,    // drifts down toward the floor, never below
    floorRatio: 0.62,           // continuous ratchet: floor >= affection * this
    milestones: [               // permanent floor steps at bonding moments
      { at: 0.25, floor: 0.18 },
      { at: 0.50, floor: 0.38 },
      { at: 0.75, floor: 0.60 },
      { at: 1.00, floor: 0.82 },
    ],
    trustPerAffection: 0.22,    // trust grows at a fraction of affection gain
  },

  /* ---- inspect wording (words, never bars) --------------------------- */
  inspect: {
    hunger: [[0.85, 'Full'], [0.55, 'Normal'], [0.25, 'Hungry'], [0, 'Famished']],
    thirst: [[0.85, 'Quenched'], [0.55, 'Normal'], [0.25, 'Thirsty'], [0, 'Parched']],
    cleanliness: [[0.90, 'Beautiful'], [0.70, 'Clean'], [0.45, 'Normal'], [0.20, 'Dirty'], [0, 'Filthy']],
    energy: [[0.80, 'Bouncy'], [0.50, 'Normal'], [0.25, 'Tired'], [0, 'Sleepy']],
  },

  /* ---- petting ------------------------------------------------------- */
  pet: {
    energyDecay: 3.4,           // stroke energy falls off at this rate/s
    energyFloor: 0.30,          // touching at all is at least this intense
    energyGainPerUnit: 0.55 / 9.0,
    energyMax: 1.32,
    holdOnDown: 0.50,           // zone stays "active" this long after contact
    holdOnMove: 0.42,
    holdOnUp: 0.20,
    downEnergy: 0.22,
    zoneSpring: [54, 11.5],

    /* --- speed & rhythm ARE the mechanic ---------------------------
       Slow long strokes read as contentment. Frantic scribbling becomes
       overstimulation and then annoyance. Rapid poking makes her back off.
       Without this asymmetry petting is a +1 button with a nice shader. */
    rhythm: {
      speedSmooth: 7,
      slowSpeed: 26,            // rig units/s at or below = a slow, long stroke
      fastSpeed: 165,
      reversalWindow: 0.9,      // seconds of direction-flip history kept
      scribbleAt: 4,            // flips in that window that count as full scribble
      overstimRise: 0.95,
      overstimFall: 0.45,
      contentRise: 0.7,
      contentFall: 0.9,
      contentBonus: 0.40,       // affection bonus for slow strokes
      overstimPenalty: 0.80,    // affection reduction at full overstimulation
      pokeWindow: 1.6,
      pokeAt: 3,                // taps inside the window that make her back off
      pokeMin: 1,               // one touch is never poking
      pokeFall: 0.7,
    },

    /* --- a liked stroke biases the REST pose for a beat afterwards --- */
    lean: { hold: 1.7, weight: 0.60 },

    /* --- bad spots: irritation, recoil, sneeze, head-shake, paw pull -- */
    irritate: { rise: 1.20, fall: 0.55, recoil: 1.0, sneezeAt: 0.60, shakeAt: 0.72 },
    /* stroke-impulse field (the thing that dents the silhouette) */
    press: {
      max: 6,
      decay: 5.2,
      minStr: 0.015,
      minTravel: 3.2,           // rig units between impulses
      pushGain: 0.85,           // how much of the finger direction is applied
      pinchGain: 0.20,          // inward pull toward the finger
      magMin: 1.2, magMax: 8.0,
      strBase: 0.35, strPerUnit: 0.06, strMax: 1.0,
      radius: { head: 30, muz: 20, paw: 26, _default: 34 },
      downRadius: 30, downStr: 0.55,
    },
    /* ---- zone map --------------------------------------------------
       PETTING NEEDS BAD SPOTS, NOT JUST DIFFERENT SPOTS.
         sweet : behind the ears, chin, chest, base of the neck
         ok    : pleasant but unremarkable
         bad   : muzzle/nose, tail, paws -> irritation, recoil, sneeze,
                 head-shake, a soft nip
       `part` names the anchor to resolve against, `at` is a fraction of
       that part's half-extent, `gain` is the affection multiplier.
       Bad spots pay ALMOST nothing but never subtract: she is annoyed,
       never resentful (principle 1).

       `pri` resolves overlap. In a near-frontal rig the head genuinely
       occludes the top of the chest, so head zones must beat body zones
       where they overlap — otherwise stroking her chin registers as her
       back. Priority mirrors DRAW ORDER, which is what the player sees.
       -------------------------------------------------------------- */
    zones: {
      ear:   { r: 31, kind: 'sweet', part: 'head', at: [0, -0.62], gain: 1.30, pri: 1.18 },
      head:  { r: 27, kind: 'ok',    part: 'head', at: [0, -0.02], gain: 1.00, pri: 1.18 },
      chin:  { r: 20, kind: 'sweet', part: 'muz',  at: [0, 0.74],  gain: 1.20, pri: 1.22 },
      muz:   { r: 16, kind: 'bad',   part: 'muz',  at: [0, -0.34], gain: 0.20, pri: 1.30 },
      neck:  { r: 22, kind: 'sweet', part: 'body', at: [0, -0.46], gain: 1.15, pri: 1.00 },
      back:  { r: 24, kind: 'ok',    part: 'body', at: [0, -0.88], gain: 0.86, pri: 1.00 },
      chest: { r: 28, kind: 'sweet', part: 'body', at: [0, 0.42],  gain: 1.26, pri: 1.00 },
      belly: { r: 23, kind: 'ok',    part: 'body', at: [0, 0.94],  gain: 1.10, pri: 1.00 },
      tail:  { r: 27, kind: 'bad',   part: 'tail', at: [0, 0],     gain: 0.25, pri: 1.10 },
      paw:   { r: 25, kind: 'bad',   part: 'paw',  at: [0, 0],     gain: 0.22, pri: 1.05 },
    },
    hitSlop: 1.16,              // normalised distance still counted as a hit
    tapMoveSlop: 5,             // rig units of travel before it's a stroke not a tap
    heartChancePerUnit: 0.030,
    sparkleShare: 0.28,
  },

  /* ---- springs: [stiffness, damping] ---------------------------------
     Settling time is characterised by the envelope time constant
     tau = 1/(d/2) for an underdamped spring. THE EYES MUST LEAD THE HEAD —
     that ordering is the single thing that reads as alive rather than
     animated, so these three groups are deliberately staged:
        pupils  d=50 -> tau ~= 40ms   (arrive first)
        head    d=15 -> tau ~= 133ms  (follows)
        body    d=11-14 -> tau ~= 150-180ms (trails)
     ------------------------------------------------------------------- */
  springs: {
    /* posture */
    sit:      [42, 11.5],
    lift:     [150, 13],
    sway:     [80, 12],
    roll:     [58, 10.5],
    squash:   [130, 14],
    melt:     [46, 11],
    perk:     [70, 11],
    /* eyes — the fastest thing on the dog. Measured (not assumed): reaches
       63% of a step target in ~40ms. */
    pupilX:   [2800, 106],
    pupilY:   [2800, 106],
    /* head — measured ~140ms to 63%, so the gaze leads it by ~3.5x. See the
       note in ARCHITECTURE §11 on why this isn't taken all the way to 120ms. */
    yaw:      [190, 19],
    pitch:    [196, 19],
    tilt:     [62, 10],
    headLift: [120, 13],
    headPush: [70, 12],
    /* ears — an ASYMMETRIC pair on purpose. Different constants mean an
       identical impulse produces two different curves, so the two ears can
       never move in lockstep. */
    earL:     [145, 12],
    earR:     [161, 12.9],
    earBack:  [62, 11],
    /* face */
    eyeOpen:  [90, 13],
    eyeSmile: [80, 12],
    brow:     [90, 13],
    mouth:    [120, 15],
    smile:    [78, 12],
    tongue:   [105, 14],
    noseTw:   [260, 16],
    /* tail */
    wagAmp:   [46, 12],
    wagSpd:   [30, 11],
    tailUp:   [56, 11],
    /* legs */
    pawLiftL: [120, 13],
    pawLiftR: [120, 13],
    hindKick: [100, 12],
    /* petting */
    pet:      [58, 12],
    glow:     [95, 13],
    fur:      [176, 11],
    /* rhythm / mood channels */
    overstim: [40, 11],
    irritate: [52, 11],
    content:  [34, 10],
    lean:     [30, 9],
    recoil:   [96, 12],
  },
  springStep: { h: 0.008, maxSub: 6, minDt: 0.009 },

  /* ---- rig motion ---------------------------------------------------- */
  rig: {
    place: { x: 178, y: 706, scale: 1.34 },
    breathIn: 0.38,
    breathSpdIdle: 0.85, breathSpdPet: 1.75,
    eyeTilt: 0.05,          // outer-corner tilt; higher reads as a stern glare
    blinkDur: 0.14,
    blinkEvery: [1.5, 5.4],
    blinkPetScale: 0.45,
    earTwitchEvery: [1.9, 6.2],
    earTwitchMag: [3.0, 5.4],
    /* independent per-ear idle drift, so the pair is never symmetric */
    earDrift: { rate: 0.37, amp: 0.055, phase: 31.7 },
    /* how far the eye lens slides inside the socket when the gaze leads */
    eyeLead: { shiftX: 0.26, shiftY: 0.19, catchlight: 0.55, brow: 0.30 },
    /* ear angular-velocity kicks measured from the head's REAL per-frame rotation */
    earKick: { lateral: 0.0022, rotation: 0.06, vertical: 0.0011, clamp: 0.5, gain: 46 },
    /* idle weight shift (organic noise, not a loop) */
    wobble: { rate1: 0.24, rate2: 0.17, y: 0.8, x: 1.4, rot: 0.008 },
    gazeDrift: { yawRate: 0.33, yawAmp: 0.14, pitchRate: 0.29, pitchAmp: 0.10, tiltRate: 0.21, tiltAmp: 0.035 },
    yawClamp: 1.35, pitchClamp: 1.1,
    /* pseudo-3D head turn */
    parallax: { eye: 14, muzzle: 20, brow: 16, ear: 8, cheek: 15, skew: 6.5,
                vEye: 11, vMuz: 10, vBrow: 9, pitchSquash: 0.07, pitchShift: 3.0,
                farShrink: 0.30, earFar: 0.52, earNear: 0.10, muzSquash: 0.10 },
    shiverDur: 0.55, shiverAmp: 3.2, shiverRot: 0.030, shiverRate: [54, 47],
    wiggleRate: [3.0, 12.0], wiggleAmp: 5.5,
    kickRate: 9.5,
    /* tail spring chain */
    tail: {
      n: 6,
      len: [17, 16, 15, 13, 11, 9],
      wid: [15.2, 14.0, 12.7, 11.0, 9.2, 7.2, 5.4],
      base: -1.25, curl: 0.75,
      waveLag: 0.55, waveTipShare: 0.42,
      inherit: 0.32,                 // each joint inherits the previous deviation
      k: [150, 190], d: [13, 12.5],
      subDt: 0.02,
      /* --- ART FIX 2: anchor the tail INTO the rump --- */
      baseAt: [0.60, 0.06],          // fraction of body half-extent; well inside
      rootHide: 2,                   // first N nodes get no outline (buried)
      rootBlend: { r: 16, alpha: 0.58 },
      /* the cream underside must be a sheen, never a stripe */
      creamFrom: 3, creamAlpha: 0.24, creamMix: 0.56,
      floofLen: 6.4, floofW: 3.2,
    },
    /* legs */
    leg: { frontHipAt: 0.80, hindHipAt: 0.72, bow: 2.5, sitBow: 3, liftBow: 7,
           pawSpread: 0.42, hindSpread: 0.72, hindOut: 0.88, sitLift: 6, liftAmt: 16 },
  },

  /* ---- fur (ART FIX 1: clumps must read as fur, not nubs) -------------
     The furry read comes from soft low-contrast lobes lying ALONG the body
     curve inside the silhouette. The scallop on the outline is deliberately
     tiny — enough to break mathematical perfection, not enough to make the
     dog lumpy. (Raising it above ~0.5 makes the head read as a potato.)
     ------------------------------------------------------------------- */
  fur: {
    lobeLen: 0.165,        // × part half-height
    lobeWide: 0.52,        // clump footprint, × lobeLen
    strands: 3,            // thin strands per clump; 1 wide lobe reads as a facet
    strandWide: 0.30,      // × clump footprint
    fan: 0.42,             // radians of spread across the strands
    shadowAlpha: 0.40,     // × contrast, for the depth pass behind the strands
    inset: 0.80,           // how far INSIDE the silhouette the clump sits (0..1)
    contrast: 0.26,        // alpha of a pale strand against the coat. Low!
    scallop: { amp: 0.34, cycles: 7, phase: 1.7 },
    kickGain: 0.85, kickFalloff: 1500, kickAngle: 6.0,
    resample: 3,           // sub-samples per silhouette segment for deform+scallop
  },

  /* ---- idle director -------------------------------------------------
     Autonomy targets: never more than ~4s of TRUE idle without a
     self-initiated micro-behaviour, and roughly 1 in 8 self-initiated
     actions should be a bid for attention — that bid is what makes the
     player feel needed.
     ------------------------------------------------------------------- */
  idle: {
    firstIn: 1.6,
    gapAfterAct: [0.9, 2.6],
    gapWhilePet: [0.7, 1.6],
    gapAfterPoke: [1.4, 2.6],
    gapAfterTap: [1.6, 2.8],
    maxIdleGap: 3.4,       // hard ceiling: no dead air beyond this
    repeatPenalty: 0.18,
    petSuppress: 0.14,     // pet level above which big idles are suppressed
    askAttentionAfter: 9,  // seconds untouched before bids get heavily weighted
    /* micro-behaviour lane: tiny life between the real clips */
    microEvery: [1.1, 2.9],
    /* force a bid if this many non-bid clips have gone by (1 in 8) */
    bidEveryN: 8,
    bidEarlyDamp: 0.18,    // suppress natural bids early in the quota cycle
  },

  /* ---- particles ----------------------------------------------------- */
  particles: {
    max: 44,
    heartDur: [1.5, 2.3], sparkDur: [0.7, 1.15],
    vx: [-13, 13], vy: [-58, -34], gravity: 9,
    heartSize: [6.5, 11], sparkSize: [3, 5.5],
    sway: 15, swayRate: 3.1,
    ringDur: 0.5, ringGrow: 26,
    motes: 30, moteSpeed: [4, 13], moteRise: 0.5, moteDrift: 0.30,
  },

  /* ---- ui ------------------------------------------------------------ */
  ui: {
    meter: { w: 82, h: 30, pad: 14, pulseDecay: 2.6, pulsePerUnit: 0.004 },
    toast: { dur: 1.9, fade: 0.32, y: 118, maxStack: 3 },
    nav: { h: 58, gap: 6, pad: 12, r: 15, iconR: 11 },
    handGlow: { r: 52, rPet: 16, alpha: 0.30 },
    hintAt: [0.30, 0.80],
  },

  /* ---- reduced motion ------------------------------------------------ */
  reducedMotion: {
    stiffScale: 0.74,     // calmer springs
    dampScale: 1.30,      // no overshoot
    parallaxScale: 0.0,   // no pseudo-3D parallax
    shakeScale: 0.0,      // no shake / shiver / wiggle
    wobbleScale: 0.35,
    particleScale: 0.5,
    moteScale: 0.4,
  },
};

export default BALANCE;
