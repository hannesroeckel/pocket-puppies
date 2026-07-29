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

  /* ---- the gift puppy ------------------------------------------------
     She arrives UNNAMED — the naming moment is the emotional centre of
     first launch (SCOPE.md stage 6). Breed and sex are not yet confirmed
     by the human, so they live here as a ONE-LINE change.
     ------------------------------------------------------------------- */
  gift: {
    breedId: 'shiba',
    sex: 'f',          // 'f' | 'm' — drives pronouns in ui/copy.js
  },

  /* ---- time & decay -------------------------------------------------- */
  time: {
    maxDecayHours: 36,          // principle 1: beyond this, nothing degrades
    reunionAfterHours: 8,
    /* Tuned to the research's §4 judgement table: Full -> Hungry in ~10h,
       Hungry -> Famished in ~11h more, Thirsty at ~8h. One feed per session
       is always enough and two are never needed. */
    needDecayPerHour: {         // 0..1 units lost per hour away
      hunger: 0.026,
      thirst: 0.040,
      /* DIRT ACCRUES FROM ACTIVITY, NOT FROM TIME (SCOPE.md stage 2). This is
         a whisper — ~0.036/day, so a fortnight away is one word-step — kept
         non-zero only so a long absence reads as a slightly dull coat. The
         real driver is BALANCE.needs.dirt.*, paid by play and walks. */
      cleanliness: 0.0015,
      energy: -0.060,           // negative = energy RECOVERS while away
    },
    /* also applied live, per second, while she is in the room: the original
       ran on the real clock and so do we. Invisible in a session by design. */
    liveDecay: true,
    /* A tiny "missed you" dip so the reunion feels earned. Deliberately small
       against a day's earnings (~0.05): absence must never visibly undo the
       bond (research §2: "Never let Bond visibly fall from absence"). */
    affectionDipPerHour: 0.0015,
    affectionDipMax: 0.030,
    /* gloss (brushing) fades slowly, so grooming is a weekly ritual */
    glossDecayPerHour: 0.010,
    /* clock-tamper guard: a lastSeenAt further ahead than this is not trusted */
    clockSkewGraceMs: 60e3,
  },

  /* ---- MOOD: the fast axis -------------------------------------------
     TWO AXES WITH DIFFERENT TIME CONSTANTS (research §2). Stage 1 conflated
     them, which is why ~50 strokes maxed the bond in one sitting.

       mood       fast (seconds), NOT saved. This is what visibly drives
                  posture, tail amplitude/speed, ear height, eye openness,
                  mouth and willingness to initiate. Decays toward a
                  BASELINE SET BY AFFECTION.
       affection  slow (days), saved, effectively monotonic. Drives the
                  mood baseline, reunion intensity, and forgiveness.

     So a deeply bonded dog *rests* happy, and any dog can be cheered up
     within seconds — but cheering it up is not the same as bonding with it.
     ------------------------------------------------------------------- */
  mood: {
    baseBias: 0.10,             // resting mood floor
    baseFromAffection: 0.62,    // baseline = baseBias + affection * this
    /* needs pull the baseline down: a hungry, filthy dog is not in the mood */
    needWeight: 0.30,
    fallRate: 0.085,            // toward baseline when above (tau ~12s)
    riseRate: 0.55,             // toward baseline when below (recovers faster)
    /* FAST: ~+0.10 after one second of stroking a sweet spot, topping out
       after four or five. Any quicker and mood is pinned at 1 the moment she
       is touched, which throws away all the range between a bonded dog at
       rest and an excited one. */
    perStrokeUnit: 0.0035,
    tapGain: 0.055,
    /* one-off bumps from care + play */
    gain: { feed: 0.30, water: 0.26, wash: 0.34, brush: 0.30, toy: 0.26, reunion: 0.55 },
    /* an unwelcome touch knocks mood down a little, briefly. Never below the
       baseline: irritation is a physical reaction, not a score penalty. */
    badTouch: 0.05,
  },

  /* ---- affection: the slow axis --------------------------------------
     Affection is NEVER drawn as a bar (see ui/hud.js and ARCHITECTURE §11).
     It exists because it sets the mood baseline and reunion intensity —
     you read the bond off the animal's body, the way the original did.

     PACING CONTRACT (this is the fix to stage 1's defect 1):
       - one long session of petting moves affection by ~0.03, not ~0.7
       - the day cap is ~0.05, so a marathon cannot substitute for showing up
       - "distinct sessions beat session length" (research §2) is implemented
         as day.showUpBonus: turning up at all on a new day is worth about
         half of what a whole session of petting can pay
       - 0.06 -> 0.75 ("deep bond") therefore takes ~15-20 days of visits
     ------------------------------------------------------------------- */
  affection: {
    start: 0.06,
    startFloor: 0.04,
    perStrokeUnit: 0.000045,    // per rig-unit of travel (was 0.00075)
    maxSegPerFrame: 14,         // don't let one huge jump pay out
    tapGain: 0.0009,
    /* PER-SESSION DIMINISHING RETURN. Each further unit earned this session
       is multiplied by exp(-earnedThisSession / soft), so the session total
       converges on `cap` however long she keeps stroking. */
    session: {
      soft: 0.012,
      cap: 0.030,
      /* no touch for this long ends the session, so a later visit on the
         same day still pays (up to the day cap) */
      gapEndsSession: 300,
    },
    /* DAILY LEDGER — resets at local midnight (state/time.js dayIndex) */
    day: {
      cap: 0.055,
      showUpBonus: 0.014,       // paid once a day, just for coming back
      careBonus: 0.005,         // per completed care action, max one each
      toyBonus: 0.004,          // per fetched toy
      reunionBonus: 0.010,      // on top of showUpBonus, after an 8h+ gap
    },
    idleDrainPerSec: 0,         // the fast drift lives on MOOD now, not here
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
    /* coat gloss, raised by brushing along the grain. Not one of the
       original's three axes — it is the brush's own readout, and it is a word
       for the same reason everything else is. */
    gloss: [[0.86, 'Gleaming'], [0.62, 'Glossy'], [0.34, 'Normal'], [0, 'Dull']],
  },

  /* ---- needs ----------------------------------------------------------
     hunger / thirst / cleanliness / energy, each 0..1 where 1 = satisfied.
     Sickness and the vet are CUT (SCOPE.md): they exist only to punish.
     ------------------------------------------------------------------- */
  needs: {
    /* the need each care action fills, and how far it can reach.
       `max` is the research's "different tools reach different maximum
       levels": the brush cannot get her to Beautiful, only the bath can. */
    fills: {
      feed: { key: 'hunger', max: 1.00 },
      water: { key: 'thirst', max: 1.00 },
      wash: { key: 'cleanliness', max: 1.00 },
      brush: { key: 'cleanliness', max: 0.88 },   // -> "Clean", never "Beautiful"
    },
    /* the need level below which the dog starts glancing at the relevant
       object of its own accord (a nudge, never a badge) */
    noticeAt: 0.50,
    /* ACTIVITY, not time, is what makes her dirty */
    dirt: {
      perThrow: 0.028,          // one toy throw
      perPlaySecond: 0.0020,    // while actually running about
      perWalk: 0.10,            // stage 4 pays this
    },
    /* exertion: play makes her hungrier and more tired (research §4) */
    exert: {
      energyPerThrow: 0.026,
      hungerPerThrow: 0.012,
      thirstPerThrow: 0.016,
    },
    /* how much of a bowl she eats: a Famished dog clears it, a Full dog
       sniffs and walks off (research §4, "portion size scaled with hunger") */
    appetite: { min: 0.18, span: 0.92 },
  },

  /* ---- care actions ---------------------------------------------------
     Each is 10-40s and GENUINELY INTERACTIVE — a drag, a hold, or the
     petting stroke field. None of them is a button that plays a canned
     animation. Wash and brush reuse dog/pet.js's field, as the design says.
     ------------------------------------------------------------------- */
  care: {
    fade: 0.42,                 // seconds for the care layer to fade in/out
    finishHold: 2.1,            // beat after the payoff before auto-exit
    /* Where the props live, in virtual design space. `bowlHome` / `waterHome`
       are exactly where scenes/room.js draws the resting bowls, so the bowl she
       picks up IS the bowl that was sitting by the wall.
       `bowlTarget` sits just in front of her paws: near enough to the camera
       that the bowl rim occludes her muzzle when the head goes down, which is
       what makes "her head is in the bowl" read on a frontal rig. */
    stage: {
      bowlHome: [66, 626], waterHome: [306, 610],
      bowlTarget: [178, 644], targetR: 34, snap: 44,
      bowlScale: 0.86, placedScale: 1.15,
    },
    /* the dog's gaze follows a dragged prop — this is most of why it feels
       physical rather than like a menu */
    gazeFollow: true,

    /* HOW FAR THE HEAD DROPS to reach a bowl at bowlTarget, in rig units, and
       how far it pitches over.

       TUNED BY LOOKING, and the first attempt was wrong in an instructive way:
       dropping the head far enough to reach a bowl standing on the floor in
       front of her paws (132 units) puts the head group entirely over the body,
       and the dog reads as a disembodied head on the rug. On a frontal rig the
       bowl has to come UP to the dog rather than the head going all the way
       down to the floor: 74 units of drop and a bowl at chest height reads as
       "her muzzle is in the bowl" and keeps the whole animal in frame. */
    headDown: 74,
    headPitch: -0.62,
    feed: {
      sackHome: [318, 664],
      pourRate: 0.62,           // bowl fill per second while tipping
      pourWidth: 52,            // how close to the bowl centre counts as over it
      kibbleMax: 24,            // rendered pieces at a full bowl
      biteEvery: [0.42, 0.62],  // seconds between bites
      bitePerBowl: 0.052,       // bowl emptied per bite
      needPerBowl: 1.15,        // hunger filled by a whole bowl
      bobDepth: 9.0,            // how far the head dips per bite
      tailFrom: 0.30,           // tail starts rising once this much is eaten
      lickBowl: 1.5,            // the lick-it-clean beat
    },
    water: {
      jugHome: [322, 650],
      pourRate: 0.80,
      pourWidth: 52,
      lapEvery: [0.19, 0.25],   // fast: lapping is much quicker than chewing
      lapPerSip: 0.020,
      needPerBowl: 1.15,
      bobDepth: 7.0,
      dropletsPerLap: [1, 3],
      shakeMuzzleAt: 0.92,      // finish: shakes the drips off the muzzle
    },
    wash: {
      /* dirt lives per REGION and her strokes erase it where she strokes */
      regions: [
        /* Kept OFF the eyes and off the middle of the muzzle: a dirt blob over
           an eye reads as a black eye, and one on the nose reads as damage
           rather than as muck. Crown and cheeks only. */
        { id: 'd1', part: 'head', at: [-0.48, -0.60], r: 21 },
        { id: 'd2', part: 'head', at: [0.52, -0.48], r: 20 },
        { id: 'd3', part: 'head', at: [-0.34, 0.52], r: 18 },
        { id: 'd4', part: 'body', at: [-0.52, -0.62], r: 26 },
        { id: 'd5', part: 'body', at: [0.54, -0.56], r: 26 },
        { id: 'd6', part: 'body', at: [-0.34, 0.24], r: 25 },
        { id: 'd7', part: 'body', at: [0.40, 0.34], r: 25 },
        { id: 'd8', part: 'body', at: [0.00, 0.86], r: 24 },
      ],
      wetDur: 1.25,             // the sluice of water that starts the bath
      scrubPerUnit: 0.0165,     // dirt erased per rig-unit of travel, at centre
      scrubRadius: 30,          // rig units of influence around the finger
      foamPerUnit: 0.030,
      foamFade: 0.16,           // foam alpha decay per second
      rinseAt: 0.14,            // mean dirt below this and the rinse unlocks
      rinseDur: 1.35,
      shakeDur: 1.7,            // THE PAYOFF
      droplets: 44,
      dropletSpeed: [90, 300],
      dropletLife: [0.5, 1.05],
      wetFade: 0.55,            // how fast the wet look dries off after the shake
      sudsSpots: 14,
    },
    brush: {
      /* THE GRAIN. A frontal coat lies downward and fans outward, so the
         grain at a point is (mostly down) + (radially away from the spine).
         Stroking along it is lovely; stroking against it is a BAD SPOT. */
      grain: { down: 0.78, out: 0.62 },
      withAt: 0.42,             // dot(strokeDir, grain) above this = with the grain
      againstAt: -0.34,         // below this = against it -> a complaint
      /* Per rig-unit of travel WITH the grain. Tuned by measuring: a stroke
         down her back is ~39 rig units, so a dull coat reaches a gleam in
         roughly 22 strokes / ~25 seconds of real brushing. The first pass was
         9x this and got there in six strokes, which made the whole action a
         button with extra steps. */
      glossPerUnit: 0.0009,
      cleanPerUnit: 0.0006,
      tuftPerUnit: 0.010,       // loose fur pulled out
      goodDecay: 0.9,           // how fast the "yes, there" bliss ebbs away
      tuftPile: 26,             // max tufts on the floor
      complainCd: 0.85,         // no more than one complaint this often
      complainIrritate: 2.2,
      hadEnoughAt: 3,           // complaints in a row before she pulls away
      doneAt: 0.96,             // gloss at which she is visibly gleaming
      sheenSpeed: 0.55,
      brushSize: 15,
    },
  },

  /* ---- toys -----------------------------------------------------------
     FRONTAL-CAMERA-SAFE. The flick throws UP-SCREEN, the toy arcs away and
     scales down, the dog runs "into" the screen (vertical squash + scale),
     then returns growing larger. NEVER LATERAL — that needs the side rig we
     deliberately did not build (SCOPE.md).

     The uncertainty IS the mechanic. A toy that always comes back is a
     vending machine.
     ------------------------------------------------------------------- */
  toy: {
    home: [330, 736],
    r: 16,
    /* the flick */
    flick: { minUp: 210, maxUp: 1500, lateralRatio: 0.85, sampleWindow: 0.11 },
    /* flight: y travels toward the vanishing point and scale shrinks */
    fly: { vanishY: 470, dur: [0.62, 1.05], minScale: 0.42, arc: 62, spin: 7.5 },
    /* the dog running into depth */
    run: { out: [0.55, 0.95], back: [0.60, 1.0], minScale: 0.62, squash: 0.24,
           strideRate: 7.2, strideAmp: 5.0 },
    /* outcome roll — weights, normalised at roll time */
    outcome: {
      fetchBase: 0.26, fetchPerMood: 0.40, fetchPerTrust: 0.16,
      chewBase: 0.30, chewPerEnergy: 0.10,
      boredBase: 0.26, boredPerTired: 0.34,
    },
    chewDur: [2.6, 4.6],
    /* if she doesn't get it back, the dog eventually fetches it unasked —
       which is also one of the research's named bids for attention */
    unaskedAfter: [5.0, 10.0],
    /* CRUELTY: a toy thrown AT her gets an immediate physical reaction and
       no persistent penalty. She must never resent her. */
    hit: { r: 46, flinch: 1.0, retreat: 7.0, cd: 1.2 },
    /* teasing: flicks that never leave her feet */
    tease: { window: 6.0, at: 3 },
  },

  /* ---- the reunion ----------------------------------------------------
     "The greeting-on-return is the emotional payoff of the entire real-time
     system and it is one animation." (research §1.7) Intensity scales by
     time_away x affection.
     ------------------------------------------------------------------- */
  reunion: {
    /* intensity k = hoursShare * hourWeight + affection * affWeight */
    hoursFull: 24,              // hours at which the time term saturates
    hourWeight: 0.45,
    affWeight: 0.55,
    /* beat boundaries in seconds */
    beats: { notice: 0.72, commit: 1.34, bolt: 2.42, boop: 2.62, settle: 6.4 },
    /* the bolt: rig scale and vertical travel at k=0 -> k=1 */
    scale: [1.72, 2.46],
    dropY: [26, 74],            // how far down the frame she comes
    strideRate: 8.6,
    strideAmp: [3.0, 7.5],
    boopShake: [2.2, 7.0],      // camera shake amplitude, virtual units
    shakeDecay: 7.5,
    settleBounces: 2,
    hearts: [4, 16],
    wag: { amp: [0.55, 1.05], spd: [11, 21] },
    /* she is out of breath afterwards and it takes a moment to settle */
    pantDur: [1.6, 3.4],
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
    /* ---- stage 2: care, toys, reunion ---- */
    prop:     [128, 15],    // a dragged bowl / sack / jug settling into place
    tip:      [90, 13],     // the pour tilt
    fill:     [40, 11],     // bowl contents level
    eat:      [150, 14],    // the per-bite head dip
    lap:      [260, 17],    // lapping is much faster than chewing
    suds:     [34, 11],
    wet:      [28, 11],
    gloss:    [22, 10],
    care:     [40, 12],     // care-layer blend weight
    brushA:   [120, 14],    // the brush's angle following the stroke
    camScale: [50, 12],     // the reunion "camera" (really the rig's own scale)
    camY:     [50, 12],
    bolt:     [78, 12],
    toyDog:   [86, 12],     // how far into the screen she has run
    flinch:   [130, 13],
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
    /* ...and keep suppressing them for this FRACTION of the quota cycle. The
       quota guarantees the floor; this stops natural picks pushing the ratio
       well above it, which reads as needy rather than needed. Measured: 0.5
       gave 1 bid in 5.6, 0.8 gives ~1 in 8. */
    bidDampUntil: 0.8,
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
    /* WORDS, NEVER BARS. The status line names the need and its word-state;
       BALANCE.inspect holds the original's scales. There is deliberately no
       affection readout of any kind. */
    status: { dur: 3.6, fade: 0.4, gap: 17 },
    /* the first-run naming beat: quiet, slow, almost no chrome */
    naming: {
      beats: [2.5, 2.4],        // "someone came for you" / "she's yours"
      lineFade: 0.85,
      inputDelay: 0.55,
      revealHold: 2.4,          // how long her new name hangs in the middle
      maxLen: 14,
    },
    care: { rowH: 56, iconR: 13, hintY: 96 },
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
