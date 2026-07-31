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
    /* CONFIRMED BY THE HUMAN: the gift puppy is male. Pronouns are resolved
       per-dog at runtime from this (state/game.js `game.pron`) — never
       hardcoded in copy, because a second dog may not be male. */
    sex: 'm',
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
      /* per rewarded training rep (repeatable, still day-capped). Learning a
         trick together is a bonding moment, so it pays a touch more than a
         fetched ball — but the day cap means an afternoon of drilling can
         never substitute for coming back tomorrow. */
      trickBonus: 0.005,
      /* the first time she gets a trick right on a NEW cue: a real milestone */
      learnBonus: 0.010,
      /* per completed walk (repeatable, still day-capped). Being taken out and
         brought home safe is worth more than a fetched ball and less than a
         whole care action. */
      walkBonus: 0.008,
      /* per finished trial (repeatable, still day-capped). Doing a thing
         TOGETHER in front of strangers is a bonding moment whatever the score,
         so this is paid on a last place exactly as on a win — and it is the
         only thing a contest pays into any ledger. It pays ZERO care points
         (BALANCE.economy.care.contest), which is the two-currency separation
         stated as a pair of numbers rather than as a promise. */
      contestBonus: 0.006,
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
      /* WALKS ARE THE MAIN SOURCE OF DIRT (SCOPE stage 4). Paid by
         dog/walk.js at `progress x BALANCE.walk.cost.dirtRoute[route]`, so a
         full trip through the river comes home properly filthy and a two-minute
         turn round the high street barely shows. Raised from stage 2's
         placeholder 0.10 after measuring: at 0.10 the mean dirt is below the
         first ink pass and a "muddy" dog rendered clean. */
      /* MEASURED, not guessed: a dirt ladder (0 / 0.25 / 0.45 / 0.7 / 1.0) was
         rendered and looked at. 0.42 puts a full walk in the park at "Normal"
         and a full walk along the river at "Dirty" — a visibly different dog
         from the one that left, which is the whole point of coming back muddy. */
      perWalk: 0.42,
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

  /* ---- WALKS ----------------------------------------------------------
     REFRAMED (SCOPE.md stage 4, research §8 judgement 1). There is NO
     side-profile rig and none is being built. The beat is:

         PREPARE  ->  ROUTE  ->  ABSENCE  ->  RETURN

     anticipation -> absence -> return, which is emotionally stronger than a
     side-scroller and costs a fraction of the art. Not one frame of walking
     animation exists anywhere in this feature, and if a later stage finds
     itself wanting one it must stop and re-read SCOPE.md.

     PREPARE is the payload: the leash comes out and he goes *electric*. It is a
     frontal animation the existing rig does beautifully and it should be the
     most joyful thing in the game after the reunion, so most of the numbers
     below belong to it.

     ABSENCE must survive the app being FULLY CLOSED (iOS suspends JS entirely
     — docs/PLATFORM-RISKS.md risk 3). Progress is therefore a pure function of
     `now - startedAt` computed on resume, never an accumulating tick, and
     state/walks.js carries the clock-tamper guard.
     ------------------------------------------------------------------- */
  walk: {
    /* A dog "should go for a walk at least once a day" (research §8). Past
       this he still goes — REFUSING IS A PUNISHMENT AND PUNISHING IS OFF-BRIEF
       (SCOPE principle 5) — he is simply less fizzy and finds less. */
    perDay: 3,
    fade: 0.42,                 // seconds for the walk layer to blend in/out

    /* ---- BEAT 1: PREPARE. Spend the effort here. -------------------- */
    prep: {
      /* The lead swings in from off the top of the frame, then hangs — it
         reads as her having taken it off a hook rather than as a UI element
         appearing, and there is no arm to draw.

         PLACED BY LOOKING. The first pass hung it at x=300, which put the clip
         and collar INSIDE the window pane: it read as a red ring hanging in the
         window rather than as a lead in the room. x=104 hangs it over plain
         wall to his left, clear of the window and the sill, and far enough from
         him that dragging it onto his collar is a real gesture across the
         screen rather than a twitch. */
      from: [104, -70], rest: [104, 306], scale: 1.0,
      /* FIZZ 0..1 is the anticipation envelope, and everything visible in this
         beat is a function of it. It rises just from the leash being out, rises
         faster while it is near him, and rises fastest while she waggles it. */
      fizzRise: 0.30,           // per second, leash merely visible
      fizzNear: 0.62,           // extra per second while within `nearR`
      fizzPerUnit: 0.0021,      // per virtual unit the leash is moved
      fizzFall: 0.22,           // ebbs if she puts it down and walks off
      nearR: 170,
      /* stages, so the pose escalates in readable steps rather than smearing */
      up: 0.30,                 // paws start leaving the floor
      electric: 0.62,           // bouncing, spinning, cannot keep still
      /* he is tired: fizz is capped (still keen, just less springy) */
      tiredAt: 0.28, tiredCap: 0.62,
      /* ...and so is the fifth walk of the day */
      overCap: 0.78,
      /* The bounce. A hop, not a gait cycle — `hop` is an existing channel.
         MEASURED, not guessed: `hop` is [128, 12.5], i.e. zeta 0.55, so a kick
         of 11 peaks at only 0.43 and moved the body 15 rig units — visible, but
         it read as a contented dog shifting its weight. 1.9 peaks at ~0.8 and
         moves him ~29 units, which is a dog leaving the floor. */
      hopEvery: [0.28, 0.54], hopHeight: [0.5, 1.9],
      spinEvery: [1.7, 3.1],
      /* clip it on: drop the leash within this of his collar */
      clipR: 96,
      clipHold: 0.85,           // the snap, the wiggle, then the map
      hintAfter: 3.2,
      /* WHERE THE ANTICIPATION LINE SITS, measured DOWN FROM THE SAFE-AREA TOP
         EDGE rather than from the top of the frame. It used to be a hard y=82,
         which on the target device (20px top inset) left it crowding the
         status bar, and it was cream drawn straight onto the cream wall at
         1.22:1 — see ui/text.js for why that is now impossible. */
      hintTop: 72,
      /* he is *still* going after this long — offer to just set off */
      offerAfter: 22,
      /* the collar ring he is drawn wearing while the leash is on */
      collar: { y: -0.30, w: 0.62 },
    },

    /* ---- BEAT 2: ROUTE ---------------------------------------------
       She picks OR DRAWS a route. Drawing is the distinctive, memorable half
       of the original mechanic and it needs no dog rig at all (research §8).
       The STAMINA-GATED REDRAW IS CUT — "frustrating and it teaches nothing".
       A drawn path is never rejected; it is simply matched to whatever it
       passes through, and its length sets the duration. */
    map: {
      /* duration in REAL seconds, from how far she drew */
      dur: [100, 300],
      /* path length in virtual units that reaches `dur[1]` */
      lenFull: 900,
      minLen: 40,               // shorter than this and it was a tap, not a draw
      sample: 7,                // virtual units between recorded path points
      maxPts: 90,
      /* how strongly a drawn path's region coverage biases the mix. A path
         that only clips a corner of the woods still counts a little. */
      touchR: 58,
      /* a tap inside a route's blob picks that route outright */
      tapR: 74,
    },

    /* ---- BEAT 3: ABSENCE -------------------------------------------
       The room is empty and DELIBERATELY A LITTLE MELANCHOLY. She may close
       the app entirely; nothing here ticks. */
    away: {
      /* the cool wash over the empty room */
      chill: 0.34, dim: 0.22, moteSlow: 0.45,
      /* The paw-print trail that fills as the walk runs. Decoration, not a
         bar — the word line above it is what actually says how long.
         PLACED BY LOOKING: at y=812 it was behind the nav pills and, in the
         brown of the print colour, invisible on a darkened rug. 596 is bare
         floorboards just below the skirting, and the prints are drawn cream. */
      prints: 9, printY: 596,
      /* words, never a countdown clock (SCOPE principle 2's spirit) */
      words: [[0.92, 'any moment now'], [0.72, 'back very soon'],
              [0.42, 'back in a little while'], [0, 'off up the road']],
      /* the centre of the three-line absence block, measured DOWN FROM THE
         SAFE-AREA TOP EDGE (ui/text.js). The three lines share one backing
         plate, because three abutting plates leave seams. */
      panelTop: 121,
      /* She can always end it early and is NEVER penalised for it. Sits BELOW
         his empty spot rather than on top of it — at y=690 the button covered
         the dent in the rug, which is the one thing the beat is about. */
      bringHome: { x: 195, y: 744, w: 214, h: 46, r: 23 },
    },

    /* ---- BEAT 4: RETURN --------------------------------------------
       Muddier, tireder, happier, and CARRYING SOMETHING. On this rig depth is
       scale (ARCHITECTURE §12.6): he arrives small and grows. No gait cycle. */
    home: {
      beats: { in: 1.55, drop: 2.35, proud: 3.55, settle: 5.6 },
      fromScale: 0.40, fromY: -104,   // where he starts, relative to home
      strideRate: 7.4, strideAmp: 4.2,
      /* The thing he is carrying, in his mouth and then on the rug. `carryAt`
         hangs it BELOW the muzzle: at +10 it sat over his open mouth and read
         as him chewing a stamp. His mouth is also held shut while he carries
         it, which is what a dog carrying something actually looks like. */
      carryAt: [2, 26],               // rig-local offset from the muzzle
      carryScale: 1.35,
      dropTo: [196, 726],             // where it lands, virtual space
      dropSpread: 34,
      dropScale: 1.25,
      dropArc: 44,
      /* the proud look up at the camera: a bid, and it should read as one */
      proudLift: 0.42,
      pantFor: [2.2, 4.6],
      hearts: [2, 7],
    },

    /* ---- what a walk COSTS ------------------------------------------
       All scaled by progress, so bringing him home early costs less and is
       therefore never a penalty. Dirt is the headline: RETURNING DIRTY IS A
       FEATURE — it is what gives her a reason to run a bath. */
    cost: {
      dirtRoute: { park: 1.0, high: 0.72, river: 1.38, woods: 1.24 },
      energy: 0.30, hunger: 0.15, thirst: 0.23,
      /* he had a lovely time. Mood is the fast axis; the bond gets its own
         once-a-day award through state/game.js's ledger. */
      mood: 0.44,
      /* trust grows a little from being taken out and brought home safe */
      trust: 0.010,
    },

    /* ---- DISCOVERY: the whole point of the feature ------------------
       "Discovery lives entirely in what he brings home." Route biases what
       comes back; walk length gates the rarer tiers, which is the original's
       "presents get rarer the farther from home" gradient (research §8)
       translated from map distance to walk length.

       HE ALWAYS COMES HOME WITH SOMETHING. `count.base` is 1 and nothing can
       reduce it — a short walk yields one common thing, never nothing, because
       an empty-mouthed return would make skipping feel like a punishment. */
    find: {
      count: { base: 1, at: [0.50, 0.88], bonusChance: 0.45 },
      /* tier gates by progress: tier 0 always, then these */
      tierAt: [0, 0.46, 0.84],
      /* past `perDay` walks the top tier stops appearing */
      overCapTier: 1,
      /* a `toy` find only pays out as a new toy once; after that it is a
         pleasant duplicate and the coin value goes up instead */
      dupCoins: 3,
      /* coins in his collar / dropped in the street. Stage 5 spends these. */
      coins: { per: [2, 10], route: { park: 1.0, high: 1.7, river: 0.85, woods: 1.05 } },
      /* the running collection kept in state.walks.found */
      logCap: 40,
    },
    /* THE TABLE. `w` is the per-route weight — this is the route bias, and it
       is deliberately readable as a matrix so it can be tuned by eye.
       `tier` gates on walk length. `toy` names the fetch toy it unlocks. `met`
       records the dog he met, which is what makes a photo a photo. */
    finds: [
      { id: 'daisy', kind: 'flower', tier: 0, w: { park: 40, high: 8, river: 20, woods: 14 } },
      { id: 'buttercup', kind: 'flower', tier: 0, w: { park: 26, high: 5, river: 26, woods: 10 } },
      { id: 'bluebell', kind: 'flower', tier: 1, w: { park: 8, high: 2, river: 10, woods: 30 } },
      { id: 'stick', kind: 'toy', tier: 0, w: { park: 18, high: 4, river: 22, woods: 38 }, toy: 'stick' },
      { id: 'pinecone', kind: 'toy', tier: 0, w: { park: 6, high: 2, river: 6, woods: 34 }, toy: 'pinecone' },
      { id: 'tennis', kind: 'toy', tier: 1, w: { park: 26, high: 16, river: 8, woods: 8 }, toy: 'tennis' },
      { id: 'squeaky', kind: 'toy', tier: 2, w: { park: 6, high: 22, river: 6, woods: 3 }, toy: 'squeaky' },
      { id: 'pebble', kind: 'keep', tier: 0, w: { park: 10, high: 6, river: 40, woods: 8 } },
      { id: 'feather', kind: 'keep', tier: 0, w: { park: 12, high: 6, river: 30, woods: 16 } },
      { id: 'conker', kind: 'keep', tier: 1, w: { park: 12, high: 3, river: 6, woods: 30 } },
      { id: 'glove', kind: 'keep', tier: 1, w: { park: 6, high: 30, river: 6, woods: 4 } },
      { id: 'bell', kind: 'gift', tier: 2, w: { park: 5, high: 26, river: 4, woods: 3 } },
      { id: 'ribbon', kind: 'gift', tier: 2, w: { park: 12, high: 20, river: 6, woods: 5 } },
      { id: 'metBeagle', kind: 'photo', tier: 0, w: { park: 30, high: 10, river: 8, woods: 6 }, met: 'beagle' },
      { id: 'metPoodle', kind: 'photo', tier: 0, w: { park: 8, high: 32, river: 6, woods: 4 }, met: 'poodle' },
      { id: 'metSpaniel', kind: 'photo', tier: 1, w: { park: 8, high: 6, river: 30, woods: 8 }, met: 'spaniel' },
      { id: 'metLurcher', kind: 'photo', tier: 1, w: { park: 6, high: 4, river: 8, woods: 30 }, met: 'lurcher' },
    ],
    /* the four places, in the order they are laid out on the map */
    routes: ['park', 'high', 'river', 'woods'],
    /* THE WINDOW SILL. What he has brought home is displayed in the room — the
       slow-drip decor reward research §1.10 asks for, and the reason a find is
       a real unlock rather than a line of text. The sill was chosen by looking:
       it is sunlit, it is the composition's focal point, and it is the one
       horizontal surface nothing else already stands on. */
    shelf: { at: [204, 318], step: 25, max: 7, scale: 0.92 },
  },

  /* ---- TRAINING + TRICKS ----------------------------------------------
     The ritual is CUE -> GUIDE -> REWARD (SCOPE.md stage 3, research §5):
     give the signal, guide the pose with a finger, reward at the right moment.

     Three things here are the design, not decoration:

     1. IT TAKES 3-4 REPS, SPREAD ACROSS SESSIONS. `learn.sessionSoft` damps
        the third-and-later rep of the SAME trick in one sitting, and
        `learn.newDayBonus` pays extra for the first rep on a new day. So
        cramming works but is inefficient, and nothing ever *requires* a long
        session (principle 3).
     2. THE WOBBLE IS THE CHARM. A cue can attach to the WRONG trick
        (`confuse.*`) and a sloppy hand signal can be MISREAD
        (`signal.misread.*`). Both are recoverable with patience
        (`recover.*`). Research §5: "this is one of the best mechanics in the
        game and it is nearly free to implement."
     3. RELIABILITY IS GATED BY MOOD AND TRUST (`obey.*`, `latency.*`), never
        by an XP bar. A happy, bonded dog obeys first time; a low-mood one
        hesitates, guesses, or looks away at something more interesting.
     ------------------------------------------------------------------- */
  train: {
    /* WHICH TRICKS EXIST is a design decision ("a compact set that each feel
       good beats a long list" — SCOPE stage 3), so the roster lives here.
       `dog/anim/tricks.js` holds the specs and ASSERTS at load that its keys
       still match this list, so the two can never drift apart.

       It is also the validation whitelist: `state/game.js` refuses to create a
       trick record for an id that is not in here. Without that, one careless
       `bindCue(undefined, 'tap')` wrote a junk trick into the save, and it then
       appeared as a row in the cue legend and as an askable trick in
       `repertoire()` — which stage 5's obedience judge would have tried to
       perform. Caught by rendering the poisoned state and looking at it. */
    roster: ['sit', 'lieDown', 'beg', 'shake', 'spin', 'jump', 'rollOver', 'playDead'],
    fade: 0.40,                 // seconds for the training layer to blend in/out
    /* THE SIGNAL PAD, in virtual design space: the empty air above her, where a
       hand signal is drawn. Touching HER is guiding or rewarding, never
       signalling — see `halo`. */
    pad: { top: 104, bottom: 306, r: 20, inset: 16 },
    /* her own space, rig-local: any touch in here is a guide or a reward */
    halo: { hx: 136, top: -330, bottom: 48 },
    /* discoverability: after a few seconds of nothing, one ghost gesture hint
       appears on her body — the possible gestures cycle by posture */
    hintAfter: 3.0,
    hintCycle: 5.5,
    hintAlpha: 0.34,

    /* ---- hand signals: eight arbitrary shapes ------------------------
       WHICH TRICK A SIGNAL MEANS IS LEARNED, NOT FIXED. That is the whole
       mis-association mechanic: the binding is arbitrary, so it can be
       wrong (research §5, "the word is arbitrary"). */
    signal: {
      ids: ['tap', 'double', 'hold', 'up', 'down', 'left', 'right', 'circle'],
      glyph: { tap: '·', double: ':', hold: 'o', up: '^', down: 'v', left: '<', right: '>', circle: 'O' },
      tapTravel: 15, tapDur: 0.38, doubleGap: 0.46, holdDur: 0.40,
      minSwipe: 28, straightAt: 0.70, circleTurn: 4.2, circleRatio: 1.9,
      /* below this the signal was sloppy and she may read it as a neighbour */
      crispAt: 0.62,
      misread: { base: 0.14, perSloppy: 0.38, perLowMood: 0.20, max: 0.46 },
      /* which signals look alike to a dog. A lazy circle is a swipe; a slow
         double-tap is a hold. */
      neighbours: {
        tap: ['double'], double: ['tap', 'hold'], hold: ['double'],
        up: ['down'], down: ['up'],
        left: ['right', 'circle'], right: ['left', 'circle'], circle: ['left', 'right'],
      },
    },

    /* ---- the guide: the stroke that INDUCES each pose ------------------
       Straight from the DS trick table (research §5). Thresholds are in
       rig-local units, the same space the petting zones live in. */
    guide: {
      minTravel: 19,            // rig units before a drag counts as a guide
      straightAt: 0.62,
      wiggleFlips: 2,           // direction reversals that count as a paw wiggle
      holdFor: 0.52,            // press-and-hold that counts as a flop
      tapsFor: 3,               // taps above the head that count as "jump"
      tapWindow: 1.5,
      circleTurn: 3.6,          // radians of turning for the floor circle
      /* how long after the signal a guide still counts as the SAME lesson */
      window: 3.8,
    },

    /* ---- reward timing MATTERS ---------------------------------------
       The window opens the instant she reaches the pose. Inside `crisp` the
       lesson lands properly; later still counts for about half; not at all
       and she barely learns anything from the rep. */
    reward: {
      window: 1.30,
      crisp: 0.52,
      quality: { crisp: 1.0, late: 0.55, none: 0.22 },
      treatR: 15,
      nomDur: 0.85,
    },

    /* ---- learning ---------------------------------------------------- */
    learn: {
      /* reps (quality-weighted) at which she reaches level 1 / 2 / 3 */
      levelAt: [3.0, 5.0, 8.0],
      /* full-value reps of the SAME trick per sitting, then heavy damping —
         she gets bored of drilling one thing, which is what spreads learning
         across sessions without ever punishing a short one */
      sessionSoft: 2,
      sessionDamp: 0.35,
      sessionGap: 300,          // seconds without a rep and the sitting resets
      newDayBonus: 1.25,        // sleep consolidates: first rep of a new day
      /* confidence in a cue binding */
      confNew: 0.62,            // a fresh, correct binding
      confPerRep: 0.16,         // grows with every correct repetition
      confWrong: 0.45,          // a MIS-ASSOCIATED binding starts here
      ambiguousAt: 0.22,        // two bindings this close and she guesses
    },

    /* ---- MIS-ASSOCIATION -------------------------------------------
       She attaches the cue to whatever she thinks just happened. A long gap
       between signal and pose, a low mood or a dog that doesn't trust you yet
       all make the wrong connection more likely. Research is emphatic that
       this imperfection is the charm. */
    confuse: {
      base: 0.10,
      perGapSec: 0.055,         // x seconds between the signal and the pose
      perLowMood: 0.24,
      perLowTrust: 0.16,
      perSloppy: 0.14,          // a vague signal is easier to mis-file
      /* REWARD TIMING TEACHES: a crisp reward makes the connection clear, a
         late one leaves room for her to file it under the wrong heading */
      perLateReward: 0.18,
      max: 0.44,
      /* she remembers what she was doing for this long, and a mis-file
         prefers one of those over a random trick */
      memory: 5.0,
    },

    /* ---- recovery: patience fixes it ------------------------------- */
    recover: {
      perRep: 0.12,             // conf a WRONG binding loses per correct rep
      clearAt: 0.14,            // below this she has stopped believing it
    },

    /* ---- obedience: mood and trust, not an XP bar ------------------ */
    obey: {
      base: 0.14,
      perLevel: 0.13,           // x level 1..3
      perMood: 0.34,
      perTrust: 0.16,
      /* THE PER-**DOG** APTITUDE, and never a per-breed one. SCOPE.md's
         "Breed is COSMETIC" overrides ARCHITECTURE §4: `newDog` rolls this as
         0.5 + jitter with NO breed term, and MIGRATIONS[5] re-centres an old
         save's roll to strip the term it was created with. Individuals differ;
         breeds do not, because the gift puppy is a Schnoodle and the Cockapoo
         is the saving-up reward, and neither may be the mechanically wrong dog. */
      perAptitude: 0.10,
      min: 0.03, max: 0.985,
      /* how the remaining probability splits when she does NOT obey cleanly */
      hesitate: { base: 0.45, perLevel: 0.10, perMood: 0.25 },
      wrong: { base: 0.25, perOther: 0.06, perUnsure: 0.08 },
      ignore: { base: 0.30, perLowMood: 0.70, perLowTrust: 0.30 },
      /* distraction subtracts from the roll — being touched, a ball in play,
         an unmet need she would rather you dealt with */
      distract: { pet: 0.30, toy: 0.40, need: 0.12, max: 0.60 },
    },

    /* ---- latency: what a contest judge scores --------------------- */
    latency: {
      base: 0.30,
      perLevel: 0.50,           // x (1 - level/3)
      perLowMood: 0.55,         // x (1 - mood)
      hesitate: [0.65, 1.45],   // the visible "looks at you, looks away" beat
      chain: 0.55,              // extra per posture she has to get into first
    },

    /* ---- holds: practice depth, not just breadth -----------------
       "The more a trick is practiced, the longer the dog will hold the trick"
       (research §5) — stage 5's obedience trial scores this. */
    hold: { base: 0.55, perLevel: 0.90, wobbleAt: 0.72 },

    /* ---- clip lengths (seconds) ---------------------------------- */
    clip: {
      sit: 1.05, lieDown: 1.30, beg: 1.25, shake: 1.15,
      spin: 1.55, jump: 0.95, rollOver: 1.75, playDead: 1.60,
      /* the little "did I get it right?" look afterwards */
      ask: 1.45, confused: 1.60,
    },

    /* ---- words, never bars (ARCHITECTURE §11 / SCOPE principle 2) --- */
    words: {
      conf: [[0.74, 'sure'], [0.42, 'fairly sure'], [0, 'muddled']],
      level: [[3, 'sharp'], [2, 'steady'], [1, 'knows it'], [0.01, 'learning'], [0, 'new']],
    },

    /* ---- VOICE: OPT-IN, SINGLE-SHOT SPEECH RECOGNITION ----------------
       The target phone was probed and reversed the prediction this used to be
       written against (docs/PLATFORM-RISKS.md, "MEASURED ON THE REAL DEVICE"):
       `SpeechRecognition` WORKS in the installed PWA, and the raw microphone
       is the thing that is broken (granted, live track, zero samples — WebKit
       185448). So the old envelope sensor is unbuildable and recognition is
       what we have.

       It is SERVER-SIDE, so it needs the network. Everything here is sized so
       that a failure costs nothing: one press, one utterance, and any refusal,
       error or tunnel degrades to tap IN SILENCE. Nothing in progression may
       depend on it. */
    voice: {
      lang: '',                 // '' = follow navigator.language
      maxListen: 6.0,           // watchdog: a run that says nothing at all
      /* consecutive runs that produce neither result nor error before we stop
         offering it for the session — the recogniser telling the same lie the
         microphone tells */
      deadRuns: 2,
      cooldown: 0.60,
      minWordLen: 2,            // tokens shorter than this are not words
      /* word match, 0..1 similarity. `accept` is deliberately forgiving: a
         mishearing must read as him being distracted, and refusing to hear
         anything reads as the software being fussy. */
      match: { accept: 0.58, ambiguous: 0.10 },
      /* how many different sayings of the same word he keeps. The tolerance
         this buys is also what lets two similar words collide, which is the
         authentic mis-hearing. */
      maxAlts: 3,
      /* hearing his own NAME is not a cue — it is the come-when-called roll
         (research §1.3). This is the similarity his name has to clear. */
      nameAccept: 0.66,
      /* p(he looks up and commits) = base + mood*perMood + trust*perTrust,
         clamped. NEVER a recognition-accuracy gate: he heard her, he decides. */
      attend: { base: 0.20, perMood: 0.46, perTrust: 0.26, min: 0.08, max: 0.97 },
      /* how long he holds the step-toward-you after coming when called */
      leanFor: 1.9,
      /* the "call him" button in the training overlay */
      button: { x: 40, y: 62, r: 21 },
    },
  },

  /* ---- CONTESTS: the Obedience Trial ----------------------------------
     THE PRIMARY CONTEST AND THE MECHANICAL PAYOFF OF THE TRAINING SYSTEM
     (SCOPE.md stage 5, research §6.3). Disc is reframed as catch-and-leap and
     ships only if there is budget; **Agility is cut** and must not be built —
     its top-down route map IS the mechanic and it fights this rig hardest.

     FOUR THINGS HERE ARE THE DESIGN, NOT DECORATION:

     1. SCORE 0.00-10.00 TO TWO DECIMALS. The precision is the point: it makes
        a 9.34 feel earned and a 9.61 feel like a triumph.
     2. JUDGED ON PERFORMANCE **AND** GROOMING. `groom` is a SIGNED delta
        around "Normal": dirty and filthy DEDUCT, clean and beautiful BONUS.
        This is what makes the stage-2 care loop earn its place rather than be
        a chore list — a bath before a trial is an obvious good idea she works
        out for herself. Its thresholds mirror BALANCE.inspect exactly, so the
        judge's WORD and the deduction can never disagree.
     3. NOTHING HERE PUNISHES. `mark.ignoreCredit` is deliberately non-zero (he
        looked at a bird; he is a dog, not a machine), there is NO demotion at
        any score, and past the daily entry cap a trial still runs as a
        practice round rather than being refused. "Losing must never feel like
        rebuke."
     4. THE LADDER IS DAYS, NOT MONTHS. See `economy` below for the arithmetic.
     ------------------------------------------------------------------- */
  contest: {
    /* ---- THE ENTRY GATE -------------------------------------------
       "Entry requires a dog that is not hungry and not parched" (research
       §6). These are the BALANCE.inspect word boundaries, so the gate is
       exactly "he is Hungry" / "he is Thirsty" and the copy can name the bowl.
       It must read as LOOKING AFTER HIM, never as a punishment — see COPY in
       dog/contest.js, which offers the bowl rather than refusing the entry. */
    gate: { hunger: 0.55, thirst: 0.55 },

    /* Three trials a day is the widely-repeated community figure (research
       §6, unconfirmed). Past it the ring is not CLOSED — she may still enter,
       it simply pays nothing and cannot promote, and is framed as a practice
       round. A cap she hits and resents is off-brief. */
    perDay: 3,

    /* ---- THE LADDER -------------------------------------------------
       Five classes, advancing on a TOP-THREE placing (research §6). `rival`
       is the field she is scored against: `mean` and `sd` of the other
       competitors' scores, which is the only thing that makes a placing mean
       something without simulating four other dogs. Deliberately readable as
       a table so the difficulty curve can be tuned by eye.

       `prize` is [1st, 2nd, 3rd] in COINS, from the original's shape
       (100/50/30 -> 200/100/60 -> 300/150/90 -> 400 -> 600). The 2nd and 3rd
       columns for Master and Championship were never recovered from a source
       (research §6 flags it), so they continue the same halving.

       `hold` is the DURATION THE JUDGE ASKS FOR, in seconds, and it belongs to
       the CLASS rather than to the dog — a standard is a standard. That is
       what turns research §5's "the more a trick is practised, the longer the
       dog will hold it" into a ladder: dog/train.js's `holdFor` grows
       0.55 -> 1.45 -> 2.35 -> 3.25s with practice depth, so a level-1 trick
       comfortably meets Open's 1.40s and manages less than half of the
       Championship's 3.10s. Depth is literally what buys the top classes. */
    classes: [
      { id: 'beginner', name: 'Beginner', hold: 0.90, rival: { mean: 6.30, sd: 0.62 }, prize: [100, 50, 30] },
      { id: 'open', name: 'Open', hold: 1.40, rival: { mean: 7.20, sd: 0.58 }, prize: [200, 100, 60] },
      { id: 'expert', name: 'Expert', hold: 2.00, rival: { mean: 7.95, sd: 0.54 }, prize: [300, 150, 90] },
      { id: 'master', name: 'Master', hold: 2.60, rival: { mean: 8.55, sd: 0.46 }, prize: [400, 200, 120] },
      { id: 'champion', name: 'Championship', hold: 3.10, rival: { mean: 9.10, sd: 0.34 }, prize: [600, 300, 180] },
    ],
    /** competitors in the ring INCLUDING him, so `field - 1` rivals are rolled */
    field: 5,
    /** a top-three placing promotes (research §6). 1-indexed. */
    promoteAt: 3,

    /* ---- THE CHAMPIONSHIP, AND WHY IT NEVER DEMOTES ------------------
       Research §6.3: maintain a >= 9.00 average to stay in the Championship,
       > 9.60 to win it. Both numbers are kept because they give the ceiling a
       real name — but "stay in" is implemented as a STANDING SHE HOLDS, not a
       rank she can lose. Dropping a class for a bad day is exactly the rebuke
       SCOPE.md forbids, so falling below 9.00 costs nothing except the words
       on the card. Winning is permanent. */
    champion: { holdAt: 9.00, holdWindow: 3, winAt: 9.60 },

    /* ---- THE PROGRAMME ----------------------------------------------
       What the judge calls, per class, in order.
         call  one trick, scored on correctness and speed
         hold  one trick, held for a judge-set duration (dog/train.js's
               `holdFor` grows 0.55s -> 3.25s with practice depth, which is
               what research §5 says the trial is really testing)
         seq   two tricks back to back — both must land
         free  THE FREE-PERFORMANCE WINDOW, where the deeper tricks earn the
               big points (see `free` below)
       Sized so a whole trial is roughly 45-90 seconds: a session is 90
       seconds or 20 minutes and both must be valid (SCOPE principle 3). */
    programme: {
      beginner: ['call', 'call', 'free'],
      open: ['call', 'hold', 'call', 'free'],
      expert: ['call', 'hold', 'seq', 'free'],
      master: ['call', 'hold', 'seq', 'hold', 'free'],
      champion: ['call', 'hold', 'seq', 'hold', 'free', 'free'],
    },
    /** how much each round kind counts toward the performance mean */
    weight: { call: 1.00, hold: 1.15, seq: 1.30, free: 1.55 },

    /* ---- MARKING ONE ROUND, 0..1 ------------------------------------
       `correct`/`speed`/`hold` are shares of one round's mark; the hold share
       is redistributed into the other two on a round with no hold. */
    mark: {
      correct: 0.60, speed: 0.26, hold: 0.14,
      /* at or under `par` seconds from the call to the pose landing, full
         speed marks; at or over `slow`, none. dog/train.js's modelled latency
         at level 2 / happy mood is ~1.3s, so par is genuinely reachable. */
      par: 1.15, slow: 2.90,
      /* HE DID A TRICK, BEAUTIFULLY, JUST NOT THAT ONE. Never a nil. */
      wrongCredit: 0.20,
      /* HE LOOKED AT SOMETHING. Also never a nil: he is a dog. */
      ignoreCredit: 0.08,
      /* he got there, he just thought about it first */
      hesitate: 0.90,
      /* a sequence's second trick gets this long added to par, because he has
         to get into position first (dog/train.js charges `latency.chain`) */
      chainAllowance: 0.60,
    },

    /* ---- THE FREE-PERFORMANCE WINDOW --------------------------------
       "Free performance is where advanced tricks earn the big points"
       (research §6.3). Two things count as depth and both are earned:
         DEPTH  how demanding the trick is (`depth` below) — a roll-over is
                worth more than a sit, and always was
         LEVEL  how deeply THIS dog has practised it (dog/train.js's level 0-3)
       A perfectly executed level-1 sit still scores; it just does not win a
       Championship, which is the whole shape research describes. */
    free: { floor: 0.55, depthShare: 0.50 },
    /** how demanding each trick is, 1..3. A design tunable, not art data. */
    depth: {
      sit: 1, lieDown: 1, shake: 2, beg: 2, spin: 2, jump: 2, rollOver: 3, playDead: 3,
    },

    /* ---- THE SCORE ---------------------------------------------------
       score = performance01 * perfSpan + groom + poise, clamped 0..10, 2 dp.

       `perfSpan` is 9.40 rather than 10 on purpose: a flawless run on a dog
       with a NORMAL coat lands at 9.40, and the last 0.60 has to come from
       grooming. That is what makes "bath before a trial" the obvious move
       without ever saying so, and it is why >9.60 (the Championship win) is
       unreachable on a dirty dog no matter how well he performs. */
    perfSpan: 9.40,

    /* GROOMING, as a SIGNED delta. Thresholds mirror BALANCE.inspect
       (cleanliness and gloss) so the word the judge says and the mark he gives
       are the same fact. */
    groom: {
      coat: [[0.90, 0.60], [0.70, 0.30], [0.45, 0.00], [0.20, -0.55], [0, -1.10]],
      gloss: [[0.86, 0.15], [0.62, 0.08], [0.34, 0.00], [0, -0.10]],
    },

    /* POISE: the per-DOG jitter, +/- this at aptitude 1 / 0. Small enough that
       it can never decide a class, big enough that two dogs feel like two
       dogs. NOT a breed term — see BALANCE.train.obey.perAptitude. */
    poise: 0.12,

    /* ---- HER PART IN IT ---------------------------------------------
       She may NOT pet him through a trial — in the original that was the
       point, it was the true test of whether the training had worked. What is
       forbidden is TOUCHING HIM; giving the cue is not (SCOPE.md stage 5:
       "What's forbidden during a trial is petting him through it, not
       tapping"). So the judge names the trick, and she may back him up with
       the signal she taught — by hand OR by voice, at exactly equal status.

       Assisting is ALWAYS OPTIONAL AND ALWAYS POSITIVE. There is no penalty
       for standing still and letting him answer the judge on his own, because
       a hands-off trial has to be winnable; and a signal he does not know just
       gets a look, never a deduction. */
    assist: {
      /* the window is `beats.call` — the length of the beat the judge's call
         hangs on screen for. One number, so the thing she can see and the
         thing she has time to do are the same thing by construction. */
      reliability: 0.14,      // added to p(obey) for that round
      speed: 0.16,            // seconds shaved off the latency roll
      /* WHERE A CUE MAY BE DRAWN. Generous on purpose: HIM is excluded by a
         real per-zone hit test (dog/contest.js uses `pet.hitZone`, the same
         test the petting field uses), so the pad does not have to keep its
         distance from him and can simply be "most of the screen". The first
         pass tried to keep clear with a box and overlapped the training
         layer's `halo`, which swallowed every cue as a touch on the dog. */
      pad: { top: 108, bottom: 470 },
      /* the "say it" bubble, only drawn when voice is opted in. Sits opposite
         the cue pad's centre so hand and voice are visibly the same offer. */
      button: { x: 44, y: 430, r: 21 },
    },

    /* ---- PACING (seconds) ------------------------------------------- */
    beats: {
      fade: 0.42,             // the ring wash blending in and out
      intro: 2.30,            // the judge's board arrives
      /* THE CALL BEAT **IS** THE ASSIST WINDOW. The judge names the trick and
         it hangs there for this long; a cue given inside it steadies him.
         Long enough to be a real chance, short enough to be a real beat. */
      call: 1.15,
      settle: 0.85,           // the round's mark, shown before moving on
      gap: 0.70,              // between rounds
      /* the free window: how long she has to pick before the judge nods him on
         and he simply does his best thing. Never a fail state. */
      choose: 6.5,
      tally: 1.70,            // the final score counting up
      maxRound: 9.0,          // watchdog: no round may hang the trial
    },

    /* ---- WHAT A TRIAL COSTS HIM: DELIBERATELY NOTHING ----------------
       Every other activity in the game charges needs — a walk costs energy,
       hunger and thirst; play costs energy. A trial charges NONE, and that is
       a decision rather than an omission: the entry gate already requires a
       fed and watered dog, so charging thirst for entering would mean the
       second trial of the day is gated by the first. That is a punishment
       loop, and punishing is off-brief (SCOPE principle 5). He gets a mood
       lift instead, and he gets it whatever the score. */
    mood: { win: 0.40, place: 0.28, ran: 0.20 },

    /* HOW FAST THE RING HOLDS HIS MOOD UP, per second. It can only ever return
       him to the mood she brought him in with, never exceed it — so this is a
       ceiling on the RATE, not a mood gift. Comfortably above the decay rate
       at any realistic baseline (0.085 * the gap), so the floor actually holds.
       See dog/contest.js `holdMood` for the measurement that made this
       necessary: without it a Championship programme ran his mood from 0.95
       down to 0.25 and the last round was a different game from the first. */
    ringLift: 0.30,

    /* ---- THE RING (scene art constants; §11 G) ----------------------- */
    ring: {
      dim: 0.26, chill: 0.16,        // the cool wash over the empty room
      /* the spotlight is drawn UNDER the dog and over the room, so the room
         dims and he does not — which is what a spotlight actually is */
      spot: { at: [186, 660], r: 268, alpha: 0.30 },
      mat: { at: [192, 708], r: [168, 70] },
      /* THE JUDGE'S BOARD, measured DOWN FROM THE SAFE-AREA TOP EDGE.
         `boardTop` clears the back button (y 62, r 20 -> ends at 82) rather
         than merely happening to miss it. */
      boardTop: 62, boardW: 300, boardH: 96, boardR: 18,
      /* the running score, also from the safe top edge */
      scoreTop: 176,
      /* the leave-the-ring button, the same place as the map's back button so
         "get me out of here" is in one place in the whole game */
      back: { x: 40, y: 62, r: 20 },
      /* the free-performance chips: HER choice, and the only real decision in
         a trial. Sat low, where the nav would be if it were not hidden. */
      chip: { y: 762, w: 84, h: 44, gap: 7, r: 14, max: 4 },
      /* the result card */
      card: { y: 366, w: 306, h: 246, r: 22 },
      /* THE ENTRY PANEL. Centred at 330 so it sits over the wall, the window
         and the shelf and stops CLEAR OF HIS HEAD (the rig's crown is around
         y 480) — placed by looking: at 386 it covered his face, which is the
         one thing a screen about entering him into a contest should not do. */
      panel: { y: 330, w: 306, h: 254, r: 22 },
      /* the button lives INSIDE the panel, `inset` up from its bottom edge.
         Derived rather than given an absolute y, because the first pass gave
         it one (686) and it ended up floating over the dog's paws with its
         label unreadable against his coat. One source of truth: the layer
         computes the same expression for the draw and for the hit test. */
      enter: { inset: 36, w: 224, h: 46, r: 23 },
    },

    /* the other competitors. Names only — no dogs are simulated, no rig is
       built for them, and none of them is ever drawn. */
    rivals: ['Biscuit', 'Otto', 'Marlow', 'Juno', 'Pepper', 'Wren', 'Alfie', 'Sable'],
  },

  /* ---- THE ECONOMY: TWO CURRENCIES, AND THE SEPARATION IS VERBATIM ----
     Research §7 calls this the strongest structural idea in the original, and
     it costs nothing to reproduce:

       COINS        contest placings, selling walk finds
                    -> toys, treats, care tools, collars, decor
       CARE POINTS  caring WELL — feeding, washing, brushing, walking,
                    training, turning up
                    -> nothing directly. They UNLOCK breeds, decor, shop stock.

     MONEY IS SKILL AND LUCK; POINTS ARE ATTENTIVENESS. She cannot buy her way
     to the Cockapoo and she cannot grind contests for a new rug. There is
     deliberately NO exchange rate, NO `spendCarePoints`, and NO code path
     anywhere that reads `coins` when deciding an unlock — see state/game.js,
     where the two live in different mutators that never call each other.

     COMPRESSED HARD. The original's top breed sat at 50,000 trainer points
     against a 200/day cap — a months-long grind built to retain a 2005
     handheld player. An attentive day here earns ~200 points (see below), so
     the whole ladder is DAYS:
        90  -> day 1     220 -> day 2     400 -> day 2-3 (the Cockapoo)
       700  -> day 4-5  1100 -> day 6-7
     ------------------------------------------------------------------- */
  economy: {
    /* what she starts with. Research §7 is emphatic that the original's
       "enough for one dog plus a little" is why the early game has stakes —
       but the first puppy here is a GIFT, not a purchase, so this is just
       pocket money and the first real coins come from a walk or a placing. */
    startCoins: 40,

    /* ---- CARE POINTS: what caring well is worth --------------------
       Paid through the SAME daily ledger the bond uses (state/game.js
       `awardCare`), so the shapes agree: distinct days beat long sessions,
       and no amount of drilling in one sitting outruns the cap. */
    care: {
      showUp: 20,             // turning up at all on a new day
      reunion: 15,            // ...after a long absence, on top
      feed: 25, water: 20, wash: 45, brush: 35,   // once each per day
      petSession: 15,         // a real petting session, once a day
      toy: 6,                 // per fetched toy (repeatable)
      walk: 30,               // per completed walk (repeatable)
      trick: 8,               // per rewarded training rep (repeatable)
      /* A CONTEST PAYS **ZERO** CARE POINTS. That is the separation, in a
         number. Placing is skill; points are attentiveness. */
      contest: 0,
      /* a day's ceiling. An attentive day reaches ~205 and a devoted one is
         capped here — high enough that nobody hits it in four minutes, which
         research §7 names as the exact way to teach someone to stop playing. */
      dayCap: 240,
    },

    /* ---- WHAT CARE POINTS UNLOCK -----------------------------------
       Read ONLY against `player.carePoints`. Stage 6 builds the shop and the
       kennel on top of this table; `kind` tells it which surface owns each
       row. `at` is the lifetime total, and unlocks are permanent.

       THE COCKAPOO IS THE SAVING-UP REWARD (SCOPE stage 6) and it is a CARE
       unlock, not a purchase. It sits at 400 — reachable on day 2 or 3 by
       someone who looks after him, and unreachable by someone with a fortune
       in coins, which is the entire point. */
    unlocks: [
      { id: 'collarRed', kind: 'decor', at: 90, name: 'A red collar' },
      { id: 'rugBlue', kind: 'decor', at: 220, name: 'A soft blue rug' },
      { id: 'cockapoo', kind: 'breed', at: 400, name: 'The Cockapoo' },
      { id: 'bedBasket', kind: 'decor', at: 700, name: 'A basket bed' },
      { id: 'treatsGood', kind: 'stock', at: 1100, name: 'The good treats' },
      { id: 'roomSeaside', kind: 'room', at: 1600, name: 'The seaside room' },
    ],
    /* the word-scale for how well she is looking after him. WORDS, NEVER A
       BAR — care points are a number she can see (they are a currency), but
       what they SAY about her is a word. */
    careWords: [[1600, 'devoted'], [700, 'attentive'], [220, 'settled in'], [0, 'getting to know each other']],
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
    /* ---- stage 3: two new POSTURE channels the tricks need ----
       `down` is lying down (the body sinks, the front legs splay forward, the
       haunches flatten) and `hop` is airborne (the body rises AND the paws
       come up with it, which is the difference between a jump and a dog on
       stilts). Everything else a trick needs already existed. */
    down:     [46, 11.5],
    hop:      [128, 12.5],
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
    /* stage 3: where a RAISED paw sits laterally. -1 tucked in under the chin
       (begging), 0 neutral, +1 swung out clear of the body (offering a paw).
       Scales with the lift, so a paw on the floor never moves. */
    pawOut:   [90, 12],
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
    /* ---- stage 3: training ---- */
    train:    [40, 12],     // training-layer blend weight
    trickHold: [52, 12],    // how firmly she is holding the pose
    spin:     [64, 12],     // the spin's circular travel envelope
    treat:    [150, 13],    // the treat popping into her view
    nom:      [160, 14],    // taking the treat
    cueFlash: [90, 13],     // the signal read-back flash
    /* he came when called: a step toward the camera. Soft and slightly
       under-damped, so he arrives with a little momentum rather than sliding
       into place — that overshoot is most of what makes it read as eager. */
    call:     [46, 9.5],
    /* ---- stage 4: walks ----
       `fizz` is the anticipation envelope and it is deliberately the springiest
       thing in the game after the reunion: low damping so it overshoots, which
       is what "he cannot contain himself" looks like as a number. */
    walkW:    [40, 12],     // walk-layer blend weight
    fizz:     [58, 9.0],
    leash:    [120, 14],    // the dangled leash settling
    homeIn:   [44, 11],     // how far up the road he still is, 1 -> 0
    carry:    [130, 13],    // the found thing, in his mouth and then dropped
    /* ---- stage 5: the ring ----
       Chrome, not anatomy, so these are stiffer and better damped than
       anything on the dog: a judge's board that overshoots reads as a UI
       element showing off. `mark` is the one exception — the pip that pops
       when a round is scored is allowed a little bounce, because it is the
       only feedback that round gets. */
    ringW:    [38, 12],     // the ring wash blending in and out
    board:    [110, 15],    // the judge's board arriving
    card:     [96, 14],     // the result card
    chip:     [120, 15],    // the free-window chips rising
    mark:     [150, 11],    // the round's pip landing
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
           pawSpread: 0.42, hindSpread: 0.72, hindOut: 0.88, sitLift: 6, liftAmt: 16,
           /* ---- stage 3 ----
              LYING DOWN: the body sinks `downDrop` rig units, the front paws
              splay outward and forward (nearer the camera, so slightly BELOW
              the floor line) and the hind paws tuck away behind her.
              AIRBORNE: the paws come up with the body, or she reads as a dog
              on stilts rather than a dog in the air. */
           downSpread: 13, downPawY: 5, downBow: 9, downHindTuck: 7,
           hopPawShare: 0.82,
           /* WHERE A RAISED PAW GOES SIDEWAYS, driven by the `pawOut` channel
              and scaled by how far the paw is off the floor — so nothing that
              only lifts a paw a little (idle kicks, running strides, the
              bad-spot paw pull) moves laterally at all, and stage 1 and 2
              behaviour is bit-for-bit unchanged.

              Both of these were measured by looking: a paw raised straight up
              lands against the cream bib and a cream paw simply vanishes, and
              a beg with the paws swung out reads as a T-pose rather than as
              begging. So SHAKE swings out clear of the body, and BEG tucks in
              under the chin. */
           liftOut: 26, liftOutFrom: 0.6 },
    /* the two new posture channels, in rig units */
    trick: {
      downDrop: 25,        // how far the body sinks when she lies down
      downSquash: 0.11,    // and how much it flattens
      downWiden: 0.13,
      hopHeight: 36,       // peak altitude of a jump
      hopSquash: 0.06,
      /* the spin: she trots a small circle. On this rig DEPTH IS SCALE
         (ARCHITECTURE §12.6), so the far half of the circle is smaller and
         squashed rather than drawn from behind. */
      /* The circle has to be BIG ENOUGH TO SEE. The first pass used rx 34 and
         a 13% scale change, and in a still frame it read as "the dog is
         standing slightly to the left" — so the travel, the depth and the head
         sweep were all pushed up, and the floor scuff was added to show the
         path she actually took (dog/train.js draws it). */
      spin: { rx: 50, ry: 19, scale: 0.21, squash: 0.13, turns: 1, lean: 0.13, scuff: 0.55 },
      /* roll over: the silhouette narrows as she goes over, which is how a
         frontal rig gets away with a roll at all */
      roll: { squashX: 0.42, rot: 1.15, paws: 1.25 },
      /* play dead: a flop onto her side, tongue out, one paw up */
      dead: { rot: 0.62, squashX: 0.14, tilt: 0.55, paw: 1.15 },
      /* CAME WHEN CALLED: a step toward the camera. There is no gait cycle and
         none is needed — bigger and slightly lower IS "he came over" on this
         rig (§12.6). Kept small: past ~0.16 he crops at the edges of frame. */
      call: { scale: 0.095, drop: 15 },
    },
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
    /* ROUTED THROUGH ui/text.js IN STAGE 5 — it was the lowest-contrast text
       left in the game, which stage 4's notes had already flagged. `size`,
       `padX`/`padY` and `step` are the pill's geometry; the plate's ALPHA is
       not here any more because it is no longer a number anyone chooses — the
       helper solves it against the worst possible background. */
    toast: { dur: 1.9, fade: 0.32, y: 118, maxStack: 3, size: 13.5, padX: 15, padY: 7, step: 34 },
    /* STAGE 5 added a SEVENTH pill (the ring), which cuts each one to about
       47 virtual units. `label` is here rather than hardcoded because
       ui/text.js shrinks to fit from it, so it is now a real tunable. */
    nav: { h: 58, gap: 6, pad: 12, r: 15, iconR: 11, label: 9.5 },
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
    /* the training overlay. THE LEGEND IS HER MENTAL MODEL, not a menu: each
       row is a signal she knows and the trick SHE thinks it means, in words.
       That is what makes a mis-association visible instead of mysterious. */
    train: { hintY: 82, legendTop: 132, rowH: 19, glyphR: 11, maxRows: 8 },
    /* the route map. A CUTE HAND-DRAWN MAP, not a UI: the paper, the wobble in
       the ink and the little house are the whole charm of the beat. */
    map: {
      top: 96, bottom: 700, pad: 16,
      /* the title and the hint sit INSIDE the paper: above it they were dark
         brown drawn over the dimmed room, which is the cream-on-cream mistake
         in the other direction */
      titleY: 102, hintY: 123, choiceY: 706,
      wobble: 1.9,          // how far the "hand-drawn" ink strays, virtual units
      wobbleRate: 3.1,
      house: [196, 640],
      setOff: { y: 754, w: 218, h: 50, r: 25 },
      back: { x: 40, y: 62, r: 20 },
      /* where each route's blob sits on the paper, and how big */
      blobs: {
        park: { at: [104, 250], r: [64, 52] },
        high: { at: [278, 214], r: [58, 48] },
        river: { at: [286, 424], r: [66, 50] },
        woods: { at: [96, 442], r: [62, 54] },
      },
    },
    /* the find card that names what he brought home */
    findCard: { y: 148, w: 260, h: 96, r: 20, dur: 4.6, fade: 0.42 },

    /* ---- CANVAS TEXT (ui/text.js) --------------------------------------
       Three legibility failures shipped before this block existed, all of them
       cream copy drawn straight over cream art. `contrast` is the promise the
       helper keeps: the backing plate's alpha is SOLVED so that the ink clears
       this ratio against the worst background that could ever be behind it —
       pure black or pure white showing through the plate. It is not a number
       anyone eyeballed, so raising it here really does make everything more
       legible rather than just darker.

       4.5 is WCAG AA for body text. Deliberately applied to display copy too:
       this is a phone held at arm's length in whatever light she is in. */
    text: {
      contrast: 4.5,
      /* the two plates. Warm, because a neutral grey scrim in a warm room
         reads as a UI element pasted on top of the art. */
      plateDark: '#241309',
      plateLight: '#fff6e4',
      /* above this luminance an ink counts as "light" and gets the dark plate */
      lightInkAt: 0.34,
      ink: '#fff0d4',
      size: 13, weight: 600,
      lineScale: 1.32,        // box height as a multiple of the font size
      padX: 9, padY: 4,
      radius: 11,
      feather: 7,             // how far the plate's edge fades out
      gap: 5,                 // between stacked lines
      /* SAFE AREA. The target device reports 20px top / 40px bottom; this is
         the extra breathing room ON TOP of the reported inset, because copy
         that sits exactly on the notch boundary still looks like a mistake. */
      margin: 10,
      /* type never shrinks below this, and ellipsises instead */
      minSize: 9.5,
    },
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
