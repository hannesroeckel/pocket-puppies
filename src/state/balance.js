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
     The puppy arrives UNNAMED — the naming moment is the emotional centre
     of first launch (SCOPE.md stage 6).
     CONFIRMED by the human: the gift puppy is a male SCHNOODLE. He is the
     dog she meets on first launch and names, so he is the hero asset — the
     beard, moustache and eyebrows in dog/breeds.js get the polish budget.
     The cockapoo is the second dog, offered later via the kennel.
     NOTE: feminine copy is still hardcoded in several strings across
     care.js / room.js / hud.js / game.js. That pronoun sweep is tracked
     separately; nothing added for these breeds assumes a gender.
     ------------------------------------------------------------------- */
  gift: {
    /* THE GIFT PUPPY. Her dream breed — a warm auburn schnoodle. Was 'shiba'
       only while the breed art lived on a branch; the Shiba stays in the game
       as the reference breed the renderer was built against. */
    breedId: 'schnoodle',
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

       A PLACED BOWL STANDS ON THE FLOOR, and `bowlTarget`'s y is DERIVED from
       that rather than typed in — `dog/care.js` computes it as
           bowlFloorY - BOWL_BASE * placedScale
       from the offsets `scenes/props.js` publishes. Stage 7 shipped a bowl
       hanging ~40 virtual units clear of the rug (ARCHITECTURE §16.9) because
       this y was a literal that nobody could check against anything; now
       changing `placedScale` moves the bowl to keep its base on the floor, and
       floating again would take editing `bowlFloorY` on purpose.

       `bowlFloorY` is the floor line at the placed bowl's depth. It is a touch
       BELOW `rig.place.y` (706) because the bowl sits between and just forward
       of the front paws, and on this rig nearer the camera means lower (§12.6).
       `placedScale` is up from stage 7's 1.15 for the same reason: a bowl down
       there is nearer the lens, and the taller rim it gets is also what lets a
       muzzle reach the food without the head having to travel to the rug. */
    stage: {
      bowlHome: [66, 626], waterHome: [306, 610],
      /* BOTH OF THESE ARE SOLVED PER DOG, not authored. `dog/care.js`
         `solveBowl()` writes the answers back here on every care action, so
         anything reading BALANCE still sees the truth — these literals are
         only what an unsolved build would show. See `scaleRange` below. */
      bowlTarget: [178, 700], bowlFloorY: 726, placedScale: 1.42,
      /* HOW THE SOLVE WORKS, and why there is no y in this file any more.
           the floor  = where his paws are STANDING, from rig.stance()
           the scale  = whatever makes the food surface meet his muzzle at the
                        depth the stoop actually gets it to
         A Schnoodle with a longer muzzle reaches further and gets a slightly
         shallower bowl; a heavier dog's belly line moves and the head budget
         moves with it. Typed numbers could only ever be right for one of the
         three breeds, and stage 7's were right for none of them. */
      /* HOW DEEP HIS NOSE GOES INTO THE FOOD, in virtual units. This is the
         one number in the solve that is about the BOWL rather than the dog,
         which is why it stays a literal: a muzzle level with the rim reads as
         sniffing at it, and the rim occluding the lower muzzle is what reads
         as eating from it (§12.6 — on a frontal rig, occlusion is depth).
         Tuned by looking at five candidates; 2 was the first guess and made a
         bowl so shallow it sat under his chin like a saucer. */
      dipInto: 16,
      /* a solved scale outside this is a bug, clamped — and the clamp is
         reported as a FAILURE, never used as a safety net (see care.js).
         The ceiling moved 1.95 -> 2.20 with §19.7's smaller stoop: a head that
         folds 0.68 of its room instead of 0.77 leaves a LARGER gap between the
         food surface and the floor, and the vessel has to span it, so the
         honest solve now lands at 1.75 (Shiba) to 2.05 (Schnoodle). The band
         is a bug detector, not a design limit; leaving it at 1.95 would have
         clamped the gift puppy's own bowl and lifted its base off the floor. */
      scaleRange: [1.10, 2.20],
      targetR: 34, snap: 44,
      bowlScale: 0.86,
      /* THE GRAB ELLIPSES, AND THE DRAG RANGES. Six magic numbers inside
         care.js's `pointer()` until the reachable-play-area work (ui/reach.js)
         needed to know how tall each prop's touch area is in order to keep it
         off the nav. `grabAspect` 1.7 makes the bowl's grab wide and shallow,
         which is right for a shallow object seen from slightly above.

         The drag ranges are UNCHANGED numbers (600..816, 300..812) that used to
         be inline. They are deliberately NOT the reachable play area: a care
         action hides the nav and gets the pointer before it, and the bowl's drop
         target is `rig.floorV - BOWL_BASE * scale`, which on a large inset sits
         BELOW the reach line. Clamping this range to it made the target
         unreachable and killed feeding outright — see the note at the top of
         dog/care.js. The reachable play area governs the two RESTING bowls the
         room draws, which are the only ones the player sees with the bar up. */
      grabR: 44, grabAspect: 1.7,
      bowlDragX: [34, 356], bowlDragTop: 600, bowlDragBottom: 816,
      pourGrabR: 46, pourDragX: [26, 364], pourDragTop: 300, pourDragBottom: 812,
    },
    /* the dog's gaze follows a dragged prop — this is most of why it feels
       physical rather than like a menu */
    gazeFollow: true,

    /* ---- THE EATING STOOP (stage 6; replaces stage 2's head-only reach) ----

       A dog that reaches a bowl on the floor commits its whole front end. The
       shoulders drop, the chest comes down and forward, the front legs splay,
       and only THEN does the neck extend so the muzzle gets to the food. Head
       travel alone cannot cover the distance and stage 2 proved it twice: at
       132 units the head group ended up entirely over the body (a disembodied
       head on the rug) and at 74 units it was the same bug, milder, plus a bowl
       parked at chest height to meet it (ARCHITECTURE §16.9).

       So the BODY is the primary motion. `sit` and `down` are the only two
       channels that actually move the torso's bottom edge — `squash` cannot,
       because rig.update compensates it to keep the paws planted — and `down`
       brings the front-paw splay, the leg bow and the hind tuck along with it,
       so the crouch costs the renderer nothing new. `fwd` / `near` are the
       small forward commitment: on this rig nearer the camera is lower and
       bigger (§12.6), and this is the same trick `rig.trick.call` uses for
       "he came over".

       MEASURED, not guessed. At rest the head's bottom edge sits 100 virtual
       units above the belly's, and 74 units of head drop is 99 of them — which
       is the whole defect in one line. `headDown` is now well inside that
       budget and the stoop carries the rest. */
    stoop: {
      sit: 1.0,          // the haunches go down first
      down: 0.92,        // ...then the elbows: a deep sphinx, not a flop
      squash: 0.05,      // the chest spreads a little as it settles
      fwd: 7,            // rig.y, virtual units nearer the camera
      near: 0.030,       // rig.s gain to match — depth is scale
      rise: 0.55,        // how much of it survives the shake-the-drips beat
      /* HOW FIRMLY HIS PAWS STAY ON THE FLOOR WHILE HE FOLDS, 0..1.
         1 = the drawn sole stays exactly on `rig.floorY` — the line the bowl
         is standing on — for every frame of the stoop, which is what a dog
         reaching into a bowl actually does and what makes the bowl read as
         resting on the rug. 0 = stage 7's behaviour, the paws splaying 23-26
         virtual units below that floor while the bowl stayed on it.

         This is not a nudge applied to the bowl: the bowl's y and scale are
         still solved from the floor and the muzzle, and the solve now predicts
         the PLANTED sole through the same `plantedSoleLocal()` that
         `rig.update()` resolves. Turning this down does not float the bowl, it
         grows it. The base stays on the floor at any value (it is written as
         `sole - BOWL_BASE * scale`); what turning this down actually costs is
         the MUZZLE REACH, because the bowl has to get taller to bring the food
         up to a head that has not moved. Past ~0.45 the solved scale runs into
         `scaleRange`, the food surface stops meeting his nose, and the new gate
         fails loudly on the clamp instead of shipping a dog that mimes eating.
         At 0 — stage 7's paws — the solve wants 2.30-2.56 against a 1.95
         ceiling on the three shipping breeds. */
      pawPlant: 1,
    },
    /* HOW FAR THE HEAD DROPS once the stoop has done its work, in rig units,
       and how far it pitches over. `headDown` came DOWN from stage 7's 74: the
       body is carrying the travel now, so the head only has to finish the
       reach, and keeping it inside the budget above is what keeps his chest
       and front legs visible underneath his chin. `headPitch` went the other
       way — a deeper nose-down costs nothing (pitchClamp is 1.1), moves the
       muzzle without moving the head group, and is what reads as "he is nosing
       into it" rather than "his face is resting on it". */
    /* A SHARE OF HIS OWN HEAD ROOM, not a count of rig units. `rig.headRoom`
       is how far this dog's head bottom can fall before it reaches his belly,
       and it differs by breed — so the ONE number that decides whether the
       head sinks into the torso is now expressed against the thing it has to
       stay inside. 0.70 leaves 30% of the chest showing under his chin at the
       resting eating depth; `headMaxShare` is the hard ceiling once the
       per-bite bob is added on top, so assertion B holds on every frame for
       any proportions. Stage 7's `headDown: 52` was 0.88 of the Shiba's room
       and would have been over 1.0 on a deeper-chested dog. */
    /* 0.77 -> 0.68 (§19.7). HIS FACE MAY NOT BE DRAWN BELOW THE FLOOR HE IS
       STANDING ON — and at 0.77 the Schnoodle's beard was, by 8.4 virtual
       units, measured at the deepest drink frame. Nothing about the VESSEL can
       answer that: `solveEatGeometry` pins the base to `rig.floorV`, so the
       bowl's lowest drawn pixel IS the floor, and anything of him below that
       line has no bowl to be inside of, at any width. That is the "and shows
       out underneath it as well" half of the report, and it is a POSE fault,
       not a bowl fault.

       Lifting the head is self-correcting rather than compensating: the solve
       re-derives the vessel against the new muzzle height, so the food surface
       still meets his nose at exactly `dipInto` and the bowl simply gets
       taller to span the larger gap to the floor. He reads as no less
       committed to the bowl — the RELATIONSHIP is invariant — he is just not
       folded so far that his chin goes through the floor.

       0.68 was chosen by measuring, not by arithmetic: a static model of the
       beard's reach (its authored `at` + path, times headHH) under-predicts
       the drawn overhang by ~19 virtual units, because the drink bob and
       `headPitch` swing it down after the solve has finished. Swept at 0.77 /
       0.70 / 0.63 with the new gate reading every frame, then 0.68 against the
       whole action rather than one frame -- which found the last of it, and
       found that THE BOB IS THE BINDING CONSTRAINT, not the resting stoop: at
       0.68/0.73 the resting pose cleared the floor and the deepest bite still
       put 40-54 px of beard through it, in a 43x8 device-pixel sliver sitting
       exactly on the bowl's base line. So the pair below is set from the
       CEILING down (see `headMaxShare`) and this is the ceiling minus the
       bob's budget. ARCHITECTURE §19.7. */
    headDownShare: 0.64,
    /* THE HARD CEILING, and it is enforced where the value is USED, not where
       it is solved. `dog/care.js applyBowl` clamps `headDrop + bite * bobDepth`
       to `headRoom * headMaxShare` on every frame, so no bite, no lick and no
       future tweak to the bob can put the head into the chest on any breed.

       The first attempt budgeted for the bob at SOLVE time by subtracting a
       guess from the ceiling, which is a different and much weaker thing: the
       breed-independence sweep found a chest 25% shallower than the Shiba's
       where it left 0.8 virtual units of clearance at the bottom of a bite,
       and the Shiba only passed because it happened to have room to spare. A
       bound that holds for the dog you tested is not a bound.

       §19.7 moved this DOWN WITH `headDownShare`, keeping the same 0.05 of
       room between them. The gap is the bob's budget, not an absolute
       position: left at 0.82 while the resting depth came up to 0.68, a bite
       or a lap could still have dipped 0.14 of his head room past the resting
       pose and put the beard back through the floor on exactly the frames
       nobody screenshots.

       IT IS THIS NUMBER, NOT `headDownShare`, THAT §19.7 IS REALLY ABOUT. The
       deepest frame of a bite is the lowest his face ever goes, so it is the
       frame the floor invariant has to hold on; the resting stoop only has to
       stay under it. 0.665 puts the deepest bite about 2.5 virtual units clear
       of the floor on the Schnoodle, measured on the worst frame of the whole
       action rather than on one chosen frame. `headDownShare` is then set from
       here downwards, taking the lift out of the BOB in preference to the
       resting stoop -- because the solved vessel is sized off the resting
       stoop, so the bowl grows for all three breeds if the lift is taken
       there and grows for none of them if it is taken here. */
    headMaxShare: 0.665,
    /* HOW BIG A BITE ACTUALLY GETS. `applyBowl` dips the head by
       `bite * bobDepth` where `bite` is a KICKED spring clamped to this, so
       the deepest frame of a bite is 1.4x the nominal bob — and the ceiling
       above has to budget for the deepest frame, not the nominal one.
       It did not, and the breed-independence sweep (C:	mp\pp8reedproof.py)
       caught it: on a chest 25% shallower than the Shiba's, the head reached
       the belly at the bottom of a bite with 0.8 virtual units to spare. The
       Shiba had enough room to hide it. */
    bobPeak: 1.4,
    /* an ANGLE, so this one is breed-independent and stays a literal */
    headPitch: -0.92,
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
    /* WHERE THE BALL COMES TO REST, AS OFFSETS BELOW THE ROOM'S FLOOR LINE.
       These were absolute y values — 736 at home, 792 at her feet, 748 when she
       kept it, 782 after a flinch — and not one of them knew the nav existed.
       On the target iPhone the bar's hit rect starts at y 730, so the flinch
       drop sat 48 units inside it, `scenes/room.js` gave the touch to the bar
       before the toy, and the ball was gone for good: auto-retrieval only fires
       below y 660 and nothing ever calls `reset(true)`. Losing the ball was the
       price of accidentally hitting him with it.

       Now every one of them is `rig.floorV + offset` passed through
       `reach.clampY()` (ui/reach.js). The offsets below reproduce the old
       absolute numbers to within 0.25 on all three breeds, so on a device with
       room the composition is unchanged; on the target phone the reach line
       binds and they compress against it, which is correct — the foreground
       below that line belongs to the nav, not to the player.

         home    the resting spot on the rug, front right
         feet    she gave it up: at her feet, nearest the viewer
         own     she kept it: near herself, a little further back
         flinch  dropped where she flinched, and left there for a while */
    homeX: 330,
    rest: { home: 14, feet: 70, own: 26, flinch: 60 },
    r: 16,
    /* THE GRAB ELLIPSE, which is not the drawn ball: `r * grab.r` wide and
       `r * grab.r / grab.aspect` tall, so 35.2 x 28.16 around a 16-unit ball.
       Here rather than inline in dog/toy.js because the reachable-area clamp
       has to know the HIT half-height — the 12-unit difference between the two
       is the difference between a ball whose bottom third is under the bar and
       one that clears it. */
    grab: { r: 2.2, aspect: 1.25 },
    /* how far a held ball may be dragged sideways; its vertical range is the
       reachable play area itself, so there is no number for it here */
    dragX: [30, 360],
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
    /* ---- AND WHAT HE IS PLAYING WITH TILTS IT (queue item 2) -------------
       The roll used mood, trust and energy and knew nothing about the object,
       so every toy played identically and "a new toy" was a new silhouette and
       nothing else. These are multipliers on the three weights, defaulting to
       1, so a toy that is not listed behaves exactly as everything did before.

       A rope tug is for tugging: he brings it back less and settles down to
       chew it more, which is the point of owning one rather than a strictly
       better ball. A stick is the opposite — sticks are for fetching. */
    kinds: {
      ropeTug: { fetch: 0.55, chew: 1.9, bored: 0.9 },
      stick: { fetch: 1.25, chew: 0.9, bored: 0.9 },
      squeaky: { fetch: 0.9, chew: 1.4, bored: 0.8 },
    },
    chewDur: [2.6, 4.6],
    /* if she doesn't get it back, the dog eventually fetches it unasked —
       which is also one of the research's named bids for attention */
    unaskedAfter: [5.0, 10.0],
    /* HOW FAR UP-SCREEN COUNTS AS "OUT THERE" — measured from the ball's home
       slot, not from an absolute y. This was `toy.y < 660` inside dog/toy.js,
       which meant 76 units above the then-hardcoded home of 736. Once home
       became derived the two parted company and a ball lying at her feet read as
       abandoned, so she fetched it unprompted on a loop. Same 76 units, said
       once, relative to the thing it was always relative to. */
    awayAbove: 76,
    /* CRUELTY: a toy thrown AT her gets an immediate physical reaction and
       no persistent penalty. She must never resent her. */
    hit: { r: 46, flinch: 1.0, retreat: 7.0, cd: 1.2 },
    /* teasing: flicks that never leave her feet */
    tease: { window: 6.0, at: 3 },
  },

  /* ==========================================================================
     THE DISC GAME (stage 9) — catch and leap.

     SCOPE stage 5: "She flicks the disc up-screen, he tracks it upward from the
     front, and she times a tap for the leap and catch. Score by height and
     airtime rather than distance zone."

     NO CLASSES, NO RIVALS, NO PLACING. The same document's non-negotiables cut
     "rank ladders per contest type" outright, so Obedience keeps the one ladder
     and this is a thing she gets good at. What is here is a personal best, a
     daily count for pacing, and coins.

     THE FLICK IS THE TOY'S FLICK. `BALANCE.toy.flick` (minUp 210, maxUp 1500)
     is what stage 2 tuned against a real thumb on the real device, and a second
     set of numbers for the same gesture is a second thing to get wrong. Only
     the disc's own flight and the catch window live here.
     ========================================================================== */
  disc: {
    /* how many throws make a round. Five is two minutes at most: SCOPE's "a
       session is 90 seconds or 20 minutes, both valid" cuts both ways, and a
       contest she cannot finish in a bus queue is a contest she will not enter. */
    throws: 5,

    /* ---- THE DISC'S FLIGHT --------------------------------------------
       Longer and higher than a ball's throw, and it HANGS: `hang` is the share
       of the flight spent near the apex, which is the part she is timing
       against. A ball's arc is `hump()` and is over before you can aim at it.

       `vanishY` is deliberately ABOVE the toy's 470: a disc thrown properly
       goes further, and the catch has to happen while it is still on screen. */
    fly: {
      dur: [1.05, 1.70],        // seconds, weak flick -> full flick
      /* the top of its arc at full power, and the LEAST it must clear the line
         his jaws reach by. See the note in `release()`: 300 was tuned against a
         disc that came down to his resting head, and with a real leap under it
         the arc peaked below the catch and the fall ran upward. */
      vanishY: 116,
      minRise: 92,
      hang: 0.30,               // share of the flight held near the apex
      /* WHERE THE HANG IS CENTRED, as a share of the flight — and it is a
         DIFFERENT number from `window.at`, which is when the disc is catchable.
         Driving both from one value put the catch at the apex: he was leaping
         at a disc 300 units above his head and half a screen away, which
         scored fine and read as nonsense. The hang is early; the catch is on
         the way down, when the disc is within a leap of him. */
      hangAt: 0.42,
      arc: 44,                  // extra rise on the way, virtual units
      minScale: 0.46,           // how small it gets at the far end
      /* HOW MUCH OF ITS DISTANCE THE DISC KEEPS ON THE WAY DOWN. He is across
         the room, not at the camera, so a disc falling to his head must stay
         far away — at 0 it would grow back to full size in her face, which is
         what the first build did. */
      depthKeep: 0.82,
      /* HOW IT IS DRAWN, as opposed to where it is. `drawR` multiplies the
         ball's 16-unit radius: a disc is a wider object, and at 1.0 it was an
         unreadable speck at the far end of the flight. `flatten` caps how much
         the ellipse is squashed with depth — a disc seen edge-on is a line, and
         a line is not a disc. Both came out of rendering the catch and looking
         at it. */
      drawR: 1.55,
      flatten: 0.55,
      spin: 9.5,
      /* HOW LONG IT TAKES TO REACH THE GRASS after it has fallen through the
         line his jaws reach, as a share of the flight. The disc used to stop
         dead there and hang in the air until the leap deleted it, so a miss had
         nothing to look at; it lands now, and lies where it landed until she
         throws again. */
      fallTail: 0.42,
      /* HOW FAR TO EITHER SIDE OF HIM IT CAN COME DOWN. The toy's ±46 exists
         because a ball out of his reach is a ball he cannot fetch — there is no
         walk cycle to go and get it. The disc is the opposite case: him covering
         ground is the thing she asked for, so this is the wide band and
         `leap.reach` is sized to cover all of it with room left over. */
      /* 88 was too far: at the extreme left landing he ran to x 74 and his own
         left edge went off the screen. He is about 85 units wide either side of
         his origin, so this is the widest drift that keeps all of him on a
         384-unit screen with his run clamped to `leap.reach`. */
      drift: 76,
      /* where the depth ends up once it is lying on the grass at his feet — see
         the note in `flightAt`'s landing branch */
      landDepth: 0.22,
    },

    /* ---- THE CATCH WINDOW ---------------------------------------------
       `half` is the half-width of the window in seconds — inside it, he takes
       the disc out of the air. `grace` is the wider span the SCORE cares about,
       so a tap that misses by a hair scores better than one that misses by a
       mile.

       A REAL THUMB, NOT A FRAME. 0.16 either side is ~10 frames at 60fps, which
       is generous by the standards of a timing game and correct by the standards
       of an eight-year-old on a phone on a bus.

       THERE IS NO `at` ANY MORE, and its absence is the point. It used to say
       where in the flight the disc was catchable, as a share — 0.86 — and the
       disc stopped dead at that height and waited for him. The disc now falls
       through his reach and keeps going, so the moment to tap is not a share of
       anything: it is "one leap before the disc gets here", i.e. the flight's
       own duration minus how long the leap takes to reach his jaws. `idealAt()`
       in dog/disc.js is that subtraction, and it means a slow floaty throw and a
       hard flat one are both timed against the same physical fact rather than
       against the same fraction. */
    window: { half: 0.16, grace: 0.30 },

    /* ---- THE LEAP, AND THE RUN THAT GETS HIM UNDER IT -------------------
       `TRICK_POSE.jump` is driven directly rather than through
       `train.perform`, because a performance's timing comes from the obedience
       roll and a timing game needs the leap to happen NOW. `dur` is the pose's
       own clock; `hold` stretches the airborne part so the catch reads as a
       catch rather than as a bounce.

       WHY THESE NUMBERS CHANGED. The player's words: "i want the dog to
       actually catch the disc instead of just staying in place and jumping
       slightly". All three parts of that were true and each had its own cause:

         - JUMPING SLIGHTLY. `height` was 1.45, so 1.45 x `rig.trick.hopHeight`
           (36) = 52 units of lift on a dog whose head is already 200 units up.
           A trick jump is a bounce on the spot; this one is going somewhere.
         - STAYING IN PLACE. The disc's x used to converge onto his head during
           the fall, so wherever she aimed it, it came to him. Now HE goes to it
           — `reach` is how far he will travel and `runSpeed` is how fast, and
           the two are sized so he is always under it in time. Her skill stays
           the timing of the tap and nothing else: a run she could lose would be
           a second thing to fail at, and losing must never feel like rebuke.
         - NOT ACTUALLY CATCHING. The disc used to stop dead at his resting head
           height and hang there until the apex of the hop deleted it. It falls
           through the catch line now, and if he does not take it out of the air
           it carries on to the grass and lies there — a miss she can see.

       `catchShare` is where on the way up his jaws close: 0.86 of full lift
       rather than 1.0, so the disc is met a little below the very peak. That is
       both what a dog actually does and the more forgiving of the two, since he
       is still rising when it arrives.

       `apexAt` is the point on the leap's own clock the catch is aimed at, and
       it is what `idealAt()` subtracts from the flight to decide when the tap
       should come. It is 0.45 because `TRICK_POSE.jump`'s altitude peaks at
       u 0.45 and `hold` spreads that peak either side of it. */
    leap: {
      dur: 0.95, hold: 0.22,
      height: 2.45, catchShare: 0.86, apexAt: 0.45,
      /* the run: units either side of home he will cover, and how fast. `reach`
         is `fly.drift` plus a margin, so there is no throw he cannot get under;
         `runSpeed` clears the whole of `reach` in half a second, against a
         shortest flight of 1.05s. He is never late, by construction. */
      reach: 84, runSpeed: 214,
      /* HOW CLOSE TO THE EDGE HE MAY GET, and it is not a guess: his silhouette
         was measured off the canvas in the park, over three breeds, by scanning
         the head band for coat-coloured pixels. 135 units to the left ear, 106
         to 118 to the right, on a 390-unit screen. At `reach` alone he ran to
         x 106 and the render came back with his left ear cut flat against x 0.
         Both the landing and the run are clamped to [edge, VW - edge], which
         makes the band ASYMMETRIC — his home is 14 units left of centre, so
         there is more room to his right — and she will never see that, because
         all she sees is him arriving under the disc. */
      edge: 136,
      /* the bounds of the run itself. A frontal rig has no walk cycle, so a
         trot is sold as small bounds with the ears loose behind them — the same
         trick the reunion uses to bring him across the room (§13.4). */
      /* `lift` IS IN HOP UNITS, NOT PIXELS, and getting that wrong is worth the
         note: at 7.5 it read as "seven and a half units of bounce" and was
         actually seven and a half TIMES a full trick jump — 270 units — so he
         pogoed across the grass between throws. It never showed up in a
         screenshot because the run is over before the frame anyone photographs;
         it showed up as `catchLine()` swinging 254 units while the disc hung, in
         a gate assertion about something else. A real trot is a sixth of a jump. */
      bound: { rate: 12.5, lift: 0.16, squash: 0.05 },
      /* how long he holds it in his jaws before it goes back to her hand, and
         where it sits: `mouthAt` is a rig-local offset from the muzzle, the same
         shape `walk.home.carryAt` uses and for the same reason — at +10 it sat
         over his open mouth and read as chewing rather than carrying. */
      hold2: 0.62, mouthAt: [1, 14], mouthScale: 0.72,
    },

    /* ---- WHAT A THROW IS WORTH, 0..1 ---------------------------------
       Height and airtime are SCOPE's two named terms; timing is the third
       because it is the thing she is actually doing. `missCredit` is the
       non-negotiable in a number: "losing must never feel like rebuke". */
    score: { base: 0.42, height: 0.30, airtime: 0.16, timing: 0.12, missCredit: 0.18 },

    /* coins by band. Sized against the trial's Beginner prizes (100/50/30) so
       neither activity is the obvious way to farm. */
    prize: [[9.20, 120], [8.20, 80], [6.80, 45], [4.00, 22], [0, 10]],

    /* the word on the card. A word, never a grade. */
    words: [
      [9.20, 'Every one of them'],
      [8.20, 'He was flying'],
      [6.80, 'A good afternoon'],
      [4.00, 'He had fun'],
      [0, 'Next time'],
    ],

    /* ---- the surface. Reuses the ring's back button on purpose: "get me out of
       here is in one place in the whole game" (§20 of the ring block above). */
    ui: {
      /* KEPT, UNREAD, like the ring's own `dim`. This dimmed the living room to
         make a "field" out of it; the field is a park now (scenes/outdoors.js)
         and there is nothing to dim — see the no-op `drawBack` in dog/disc.js. */
      dim: 0.20,
      hintY: 96,
      cardY: 300, cardW: 306, cardH: 214, cardR: 22,
      panelY: 330, panelW: 306, panelH: 234, panelR: 22,
      enter: { inset: 36, w: 224, h: 46, r: 23 },
      pipY: 150, pipR: 5, pipGap: 16,      // one pip per throw, filled as they go
      sfx: { throw: 'toy-throw', catch: 'proud-yip', miss: 'huff', card: 'praise' },
    },
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
    /* ---- BEAT 2.5: THE DEPARTURE ------------------------------------
       He trots out of frame instead of blinking out of it. The only beat that
       uses the profile dog, and the reason `dog/side.js` and the sprite sheets
       exist at all.

       `dur` is short on purpose: this is a send-off, not a journey. The absence
       is the point of the feature and the clock for it started the moment she
       pressed Set off (state/walks.js), so these two seconds are inside the
       walk, not added to it.

       `stride` is HOW FAR HE TRAVELS PER GAIT CYCLE. Driving the cycle off
       distance rather than off time is what stops him moonwalking — a stride has
       to be a stride whatever the frame rate did. Measured against the sheet: his
       four frames cover about one body length, and he is ~150 units tall. */
    off: { dur: 2.1, exit: 150, stride: 92, scale: 1, fade: 0.28, ramp: 0.24 },

    /* ---- BEAT 2.75: THE STROLL --------------------------------------
       "cant we now not use the side profile to have an actual walk instead of
       just sending the dogs away?" — the first half-minute of the walk, watched,
       with the things he passes tappable. What she taps is what he keeps, so a
       find is DISCOVERED rather than awarded by a timer (docs/STROLL-PLAN.md).

       IT IS INSIDE THE WALK, NEVER ADDED TO IT. The clock started at Set off
       (state/walks.js) and nothing here touches it, so watching can only ever
       cost her the seconds she chose to spend watching. `maxFrac` is what stops
       a half-minute stroll eating a third of a short walk, and the beat ends
       early rather than overrunning if the walk itself finishes first. */
    stroll: {
      dur: 30, minDur: 12,
      /* never more than this much of the walk it is the beginning of */
      maxFrac: 0.34,
      fade: 0.45,               // the dissolve into the road and back out of it
      /* WHERE THE DISSOLVE IS FINISHED. `Spring.x` approaches its target
         asymptotically and never arrives, so using the weight directly as an
         alpha left the ROOM SHOWING THROUGH THE ROAD for ever — the portrait,
         the window frame and the rug's rings, ghosting in the sky. Measured a
         second in it was still 15%, which is not a ghost, it is the living room.
         The alpha is the weight divided by this and clamped, so the road is
         genuinely opaque from here on and the dissolve is the part that reads. */
      opaqueAt: 0.74,
      /* HE TROTS AT A FIXED X AND THE WORLD GOES PAST HIM. `at` is well left of
         centre, so most of the screen is the ground he has not reached yet —
         which is where the things she can tap come from. */
      at: 150,
      /* HE IS SMALLER OUT HERE THAN HE IS IN THE ROOM, and that is a decision
         rather than a slip. `rig.place.scale` is 1.34 and the sheets are 250
         units tall, so at the room's scale he is 335 units of a 844-unit screen
         — which is right for a close-up pet sim and wrong for a travelling shot:
         the first render was a dog filling the frame with no road left to walk
         along and every find he passed hidden behind him. 0.62 leaves the road
         visible, which is the thing this beat is actually about. The departure
         keeps scale 1 because it is the SAME SHOT as the room; the stroll is a
         cut to somewhere else, and the dissolve carries the change.
         `groundY` stands him a little further up the grass for the same reason —
         it puts the whole find band in front of the horizon and behind him. */
      scale: 0.62, groundY: -24,
      speed: 92,                // virtual units per second, the ground at his feet
      /* the same stride the departure uses: the gait runs on DISTANCE, so a
         stride is a stride whatever the frame rate did */
      stride: 92,
      /* the sky, the hills and the treeline, as a fraction of the near speed.
         Under `prefers-reduced-motion` this becomes 0 and the sky simply holds
         still — two thirds of the screen stops moving, which is what
         `reducedMotion.parallaxScale: 0` asks for. */
      farK: 0.34,
      /* WHAT HE PASSES. `depth` 0..1 is how near the camera a find is, and it
         sets all three of the things that have to agree for depth to read: how
         far up the grass it sits, how big it is, and how fast it goes by. */
      depth: [0.30, 1.0],
      /* WHERE THE BAND SITS, relative to `rig.floorV` — i.e. up the grass,
         between the middle distance and his own feet.
         MEASURED AGAINST THE REACH LINE, not chosen. Every find is a tap target
         and goes through `reach.clampY()` with `hitRy` as its half-height, and
         on the target phone (inset 40) that bound is 722 - 46 = 676. An earlier
         -26 put the near end at 694, so EVERY find from depth 0.72 up was
         clamped to the same y and the whole depth spread collapsed onto one
         line — three parallax planes drawn as one, and nothing in a single
         frame to show it. -52 keeps the near end at ~668 and the clamp is a
         guard again rather than the thing deciding the composition. */
      bandY: [-104, -52],
      findScale: [0.88, 1.24],
      driftK: [0.74, 1.0],
      /* WHEN each find is level with him, as a fraction of the stroll. Kept off
         both ends so the first one is not already going past as the road fades
         in and the last one is gone before it fades out. */
      passAt: [0.18, 0.82],
      /* THE TAP, AND IT IS DELIBERATELY LOOSE. A find drifting past at ~90
         units/s with a 20-unit radius is a dexterity test on a phone, so the
         box is a WINDOW either side rather than a pixel test — the same shape
         as the disc's ±0.16s catch window. `hitR` is ~0.7s of drift. */
      hitR: 62, hitRy: 46,
      /* and the ring under an untaken find, which is the whole affordance */
      ringR: 22, ringRate: 2.4,
      hintFor: 4.2,
    },

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
      /* WHERE IT LANDS. 726 straddled the nav's top edge on the target phone:
         a find carried home from the woods came to rest with its lower half
         behind the CARE and PLAY pills, which is a poor look for the payoff of
         a whole walk. Now `dropTo[1]` is what it always was and the landing is
         put through `reach.clampY()` with `dropR` as the half-height, so the
         thing he was proud of is entirely on screen. */
      dropTo: [196, 726],             // where it lands, virtual space
      dropSpread: 34,
      dropR: 20,                      // a find's drawn half-height AT dropScale
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
      /* ---- A DUPLICATE IS COINS, WHATEVER IT IS -------------------------
         This paid out for a duplicate TOY only, so a second daisy, pebble or
         photo was worth nothing and did nothing: "some finds are real and some
         are litter, with nothing telling her which"
         (docs/FEEDBACK-QUEUE.md 6). SCOPE stage 5 already says coins come from
         "contest placings; selling walk finds" — this is that, and it means
         every single thing he carries home is either a new thing on the shelf
         or a few coins in the purse. Nothing is ever inert. */
      dupCoins: 3,
      /* ...and the FIRST of a kind still comes first. Owned finds are weighted
         down rather than excluded: the woods should still mostly hand back
         woods things, and a collection that refuses to give her a second
         conker stops feeling like a place and starts feeling like a checklist.
         At 0.45 a full collection still pays coins on every walk. */
      ownedWeight: 0.45,
      /* how many things may stand on the sill at once. The rest live in the
         box; which is which is HER choice (ui/collection.js), which is the
         other half of item 6 — "the room should be hers to arrange, not a
         floor that silently fills". */
      onShow: 7,
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
      /* ---- THE "DOWN" SIGNAL IS AN L ----------------------------------
         Sit and lie down used to share one gesture (`headDown`) and were told
         apart by whether he was already sitting. He is the only one who can
         see that difference, so on screen the two lessons were the same
         stroke — reported by the human as the training screen's real defect
         (docs/FEEDBACK-QUEUE.md 1).

         Lie down now has the shape of the actual hand signal: down over the
         head, then a flat sweep along the floor. Detected in two phases
         rather than from the net vector, because an L's net vector is a
         diagonal and would read as a sloppy sweep across the body.

         THREE NUMBERS AND NO CORNER, which took two failed attempts to arrive
         at and is worth recording, because both failures were the same
         mistake: trying to find the elbow from a path whose points are not
         kept.

           1. Elbow = the first point `fall` units below the start. On a real
              stroke that is near the TOP of the descent, so the whole rest of
              the fall was then counted against the flat leg — a clean
              69-down-60-across L came out fall 13.8, drop 55.3, flat 60, and
              was rejected for 60 < 55.3 x 1.15.
           2. Elbow = the deepest point so far, frozen once the hand had moved
              sideways from it. The flat leg runs at CONSTANT depth, so every
              segment of it tied the deepest point and dragged the elbow along
              underneath the finger: the sideways distance from it was always
              zero and the corner never latched at all.

         So the corner is not measured. The shape is: it started over his head,
         it FELL, and it FINISHED out to the side. `outShare` is what keeps a
         sloppy sit out — a 60-unit downward stroke that wanders 20 units
         sideways is a sit drawn badly, not a request to lie down, and at 0.5
         it stays a sit until it is going more than halfway across as far as it
         is going down. */
      downSweep: { fall: 13, flat: 17, outShare: 0.5 },
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
      /* KEPT, UNREAD. These two dimmed and cooled the living room to say "this
         is a trial now". The trial happens in a show ring outdoors since
         scenes/outdoors.js, and the place says it instead — see the note in
         dog/contest.js `drawBack`. Left here because deleting them would take
         that note's subject with it. */
      dim: 0.26, chill: 0.16,
      /* the pool of light on the mat, drawn UNDER the dog and over the ground.
         `spotOutdoor` is what is left of a stage light once the stage is a
         field in daylight: enough to lift the mown grass, not enough to read as
         a lamp. */
      spot: { at: [186, 660], r: 268, alpha: 0.30 },
      spotOutdoor: 0.34,
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
    /* EVERY ROW HERE IS CONSUMED BY REAL CODE. Stage 5 left six rows and stage
       6 found that the complaint "a table nothing consumes" would have survived
       a shop and a kennel being built, because three of them described things
       that are out of scope for the gift (GIFT-READY §3 rules out room variety
       and decor variety outright). A reward she has EARNED that does nothing is
       worse than a reward that was never promised, so the table now lists only
       what stage 6 actually delivers:

         collarRed   -> ui/kennel.js puts it on him; dog/draw.js draws it
         rugBlue     -> scenes/room.js repaints the rug
         cockapoo    -> ui/kennel.js adopts her
         shiba       -> ui/kennel.js adopts him, by the same code path
         treatsGood  -> ui/shop.js stocks a row that coins alone can never reach

       `bedBasket` and `roomSeaside` are gone rather than deferred. They can
       come back the day something renders them. */
    unlocks: [
      /* ---- DECOR LIVES HERE AND NOWHERE ELSE (queue item 2) --------------
         He asked for room decoration twice. Both times it was correctly kept
         OUT of the shop — "sell objects for coins, gate content on care points",
         so coins must never buy a nicer room — and both times the redirection
         was recorded and then not acted on, which left the ladder holding a
         single decor row (the blue rug) and the request unmet rather than
         refused. Two more now, and the spacing is the point: something lands
         every couple of days of attentive play.

           90   a red collar          she looked after him from the start
           150  a paper garland       the first thing the ROOM gains
           220  a soft blue rug
           400  a Cockapoo puppy      the big one, and nothing crowds it
           650  a portrait of him     the room gains HIM
           1100 the good treats
           1600 a Shiba Inu puppy     the last one, and the top of the ladder

         THE SHIBA IS THE THIRD DOG, AND HE WAS ALREADY DRAWN.
         `dog/breeds.js` has carried a complete Shiba entry since stage 1 — he is
         the reference breed the whole renderer was built against — and stage 8
         gave him a painted profile sheet (`src/assets/side-shiba.webp`) alongside
         the other two. He was nonetheless UNREACHABLE: not the gift breed, not on
         this ladder, and `economy.kennel` named exactly one adoptable breed. A
         finished dog that no player can ever meet is the same defect as an earned
         reward that does nothing (17.5), from the other end.

         1600 rather than something sooner, for two reasons. It is the next step
         in the spacing the rest of the ladder already keeps (~1.6x each time:
         90, 150, 220, 400, 650, 1100 → 1750, and 1600 is inside that band), and
         it is exactly `careWords`' threshold for **devoted** — so the last thing
         her care unlocks lands on the frame the game starts using its warmest
         word for her. That coincidence is deliberate; the two numbers should be
         changed together or not at all.

         `bedBasket` and `roomSeaside` were cut in stage 6 "rather than
         deferred... they can come back when there is something to draw"
         (17.5). That is the bar these two clear: each is drawn, and each
         visibly changes the baked room art on the frame it is earned. */
      { id: 'collarRed', kind: 'wear', at: 90, name: 'A red collar',
        note: 'For looking after him from the start' },
      /* `swatch` is THE COLOUR OF THE ACTUAL OBJECT, and it exists because the
         kennel drew this row's mark from its KIND. Kind 'decor' meant a green
         dot — beside the words "A soft blue rug". The wear rows in the same
         column already show the real thing's colour (`collarGlyph` reads
         `ui.wear`, which is also what dog/draw.js paints), so one column was
         carrying two different colour meanings and the clash was legible: a red
         crescent that means "this collar is red" sitting directly above a green
         dot that does not mean "this rug is green".
         This value is `RUG.blue.a` from scenes/room.js — the colour she will
         actually see on the floor when it lands. Optional: 'stock' has no single
         real colour ("the good treats"), so it keeps its category brown. */
      { id: 'garland', kind: 'decor', at: 150, name: 'A paper garland',
        swatch: '#cf6e58', note: 'Little flags across the wall' },
      { id: 'rugBlue', kind: 'decor', at: 220, name: 'A soft blue rug',
        swatch: '#6f93a8', note: 'The room warms up a little' },
      /* ---- A BREED ROW CARRIES THE PUPPY IT UNLOCKS ---------------------
         `breedId` and `sex` used to live in `economy.kennel` as `adoptBreed` and
         `adoptSex` — one adoptable breed, spelled once, in a different object
         from the row that gated it. That was fine while there was exactly one,
         and it is precisely what made the second one impossible: adding a row
         meant nothing, because the kennel never looked at the rows.
         They are here now, so a breed is a DATA ENTRY on this ladder in the same
         way a breed is a data entry in dog/breeds.js (ARCHITECTURE 11.3), and
         `state/game.js adoptCheck()` walks these in order.
         `sex` drives pronouns only — nothing mechanical reads it, and no copy in
         ui/kennel.js hardcodes a pronoun, so flipping one of these is a one-key
         change with no other consequence. */
      { id: 'cockapoo', kind: 'breed', at: 400, name: 'A Cockapoo puppy',
        breedId: 'cockapoo', sex: 'f',
        note: 'Someone new, once he is properly settled' },
      { id: 'portrait', kind: 'decor', at: 650, name: 'A portrait of him',
        swatch: '#b4703f', note: 'The picture on the shelf becomes him' },
      { id: 'treatsGood', kind: 'stock', at: 1100, name: 'The good treats',
        note: 'The shop starts stocking the nice ones' },
      /* THE THIRD DOG. Male, so the kennel reads he / she / he — chosen only
         because two of one and one of the other is less of a pattern than the
         alternative; see the `sex` note above for how cheap it is to change. */
      { id: 'shiba', kind: 'breed', at: 1600, name: 'A Shiba Inu puppy',
        breedId: 'shiba', sex: 'm',
        note: 'Once the other two are settled' },
      /* ---- FOUR AND FIVE (8.24.0) --------------------------------------
         Two more breeds, from the human's own art — the same source the profile
         sheets came from ("i built the side view ... with chatgpt as yours looked
         bad"), and the same arrangement: his front view is the REFERENCE that
         `dog/breeds.js`'s data was authored against, and his side sheet is the
         asset the walk composites.

         2400 and 3400 KEEP THE LADDER'S OWN RHYTHM, and that was a decision
         rather than an extrapolation. The spacing has been about x1.6 since stage
         6 (90, 150, 220, 400, 650, 1100, 1600) and the alternative on the table
         was to pull all four dogs inside a fortnight — 400/800/1300/1900 — so
         that a child meets everybody sooner. The human chose the existing
         rhythm knowing what it costs: at the ~150-205 care points an attentive
         day earns, the Corgi is around day 12-16 and the Golden around day
         17-23. Recorded because the temptation to "fix" a number that looks far
         away is exactly how a deliberately slow ladder gets quietly sped up.

         `careWords` tops out at 1600/devoted, so both of these sit ABOVE the last
         word the game has for her. That is fine and is worth saying: the words
         describe how she is looking after them, and there is nothing warmer than
         devoted to say. They are not a rank. */
      { id: 'corgi', kind: 'breed', at: 2400, name: 'A Corgi puppy',
        breedId: 'corgi', sex: 'f',
        note: 'For looking after all three' },
      { id: 'golden', kind: 'breed', at: 3400, name: 'A Golden Retriever puppy',
        breedId: 'golden', sex: 'm',
        note: 'The last of them' },
    ],
    /* the word-scale for how well she is looking after him. WORDS, NEVER A
       BAR — care points are a number she can see (they are a currency), but
       what they SAY about her is a word. */
    careWords: [[1600, 'devoted'], [700, 'attentive'], [220, 'settled in'], [0, 'getting to know each other']],

    /* ================================================================
       THE SHOP (stage 6) — COINS ONLY, AND OBJECTS ONLY.

       THE ONE ABSOLUTE RULE: sell OBJECTS for coins, gate CONTENT on care
       points. Nothing in this list may share an id with anything in
       `unlocks` above, and `state/game.js buyItem()` refuses any id that
       does — so the rule is enforced by code rather than by everyone
       remembering it. Stage 5 verified that 10,000,000 coins unlocks
       nothing; stage 6's job was to still be true afterwards.

       DELIBERATELY SMALL. The original's hundreds of SKUs were 2005
       retention scaffolding (research §7) and every one of them was a
       reason to open a menu instead of touching the dog. Nine rows, each of
       which does something you can see:

         kind 'toy'    joins `inventory.toys` and can be the toy on the rug
         kind 'treat'  a count in `inventory.food`; giving one is a real beat
         kind 'tool'   a count in `inventory.care`; changes a care action
         kind 'wear'   joins `inventory.accessories`; goes on his collar slot

       `needs` names a care unlock that must be EARNED before the row can be
       bought at all. That is the two currencies cooperating without ever
       touching: care points decide what the shop is allowed to stock, coins
       pay for the goods. There is no path the other way.
       ================================================================ */
    shop: {
      /* what a walk-and-a-placing day earns, for calibrating prices: a walk
         pays 18-40 and an obedience placing 30-120, so ~120 coins a day is a
         normal haul and nothing here should take more than about two days */
      items: [
        { id: 'bone', kind: 'toy', name: 'A chew bone', cost: 55,
          note: 'He can fetch this one instead of the ball' },
        { id: 'treatPlain', kind: 'treat', name: 'Bag of biscuits', cost: 25,
          /* ONE CLAUSE, NO TERMINAL STOP, like the eleven notes around it. This
             read 'Five of them. He will hear the bag.' — the only note in the
             shop with a full stop at the end of it, which on screen made this
             one row look like it had been written by someone else. */
          give: 5, note: 'Five of them — he will hear the bag' },
        { id: 'treatGood', kind: 'treat', name: 'The good treats', cost: 60,
          give: 5, needs: 'treatsGood',
          note: 'The ones from behind the counter' },
        { id: 'brushSoft', kind: 'tool', name: 'A softer brush', cost: 70,
          note: 'Brushing brings his coat up faster' },
        { id: 'soapOat', kind: 'tool', name: 'Oatmeal soap', cost: 45,
          note: 'He minds the bath less' },
        { id: 'collarBlue', kind: 'wear', name: 'A blue collar', cost: 35,
          note: 'Plain, and it suits him' },
        { id: 'collarGreen', kind: 'wear', name: 'A green collar', cost: 35,
          note: 'A bit smarter' },
        /* ---- FOUR MORE THINGS, AND EVERY ONE OF THEM DOES SOMETHING ------
           Queue item 2, under the rule the queue itself sets: "every item must
           do something. Stage 6 cut two unlock rows for being empty, on the
           principle that an earned reward that does nothing is worse than one
           never promised. Do not add anything cosmetic-but-inert."

           So each of these hooks into a system that already exists, and the
           gate asserts the EFFECT rather than the row:

             kibbleGood  feeding fills more of him (dog/care.js)
             combCurly   brushing raises gloss faster than the soft brush does,
                         and it is the only tool that helps a CURLY coat
             soapRose    the gloss it leaves fades slower (state/time.js), which
                         is what makes it show up in an obedience score days
                         later — grooming is marked (SCOPE stage 5)
             ropeTug     a toy with its own odds: he would rather tug it than
                         give it back, which is "different odds of return, so
                         play varies" from the item

           DECOR IS STILL NOT IN HERE. He asked for room decoration too, and
           stage 6 deliberately kept decor on the CARE-POINT ladder so coins
           cannot buy a nicer room. Unchanged. */
        { id: 'kibbleGood', kind: 'tool', name: 'The good kibble', cost: 65,
          note: 'A proper meal — it fills him up' },
        { id: 'combCurly', kind: 'tool', name: 'A detangling comb', cost: 80,
          note: 'For a curly coat the brush cannot reach' },
        { id: 'soapRose', kind: 'tool', name: 'Rose soap', cost: 70,
          note: 'His coat keeps its shine for days' },
        { id: 'ropeTug', kind: 'toy', name: 'A rope tug', cost: 50,
          note: 'He would rather tug it than give it back' },
        { id: 'collarTag', kind: 'wear', name: 'A collar with a tag', cost: 90,
          note: 'His name on a little brass disc' },
      ],
      /* how much a bought tool actually changes its care action. Small on
         purpose: a tool may be a nicer way to do the thing, never a reason to
         have waited to do it. */
      brushGloss: 1.35,         // gloss per stroke, multiplier
      /* ---- WHAT THE STAGE-9 TOOLS ARE WORTH -------------------------
         Each is a multiplier on a thing that already existed, so the
         effect is measurable rather than described. `combCurly` is the
         biggest of the three because it is the only one gated on the
         coat: two of the three breeds are curly and the soft brush was
         tuned on the Shiba. */
      kibbleFill: 1.45,      // hunger restored per mouthful of the good kibble
      combGloss: 1.7,        // brushing a CURLY coat with the comb
      soapGlossKeep: 0.55,   // multiplier on gloss decay per hour
      soapMood: 0.16,           // extra mood from a bath, absolute
      /* a treat: a real beat, not an inventory decrement. He gets the reward
         clip, a mood lift, and it is worth NO care points — being pleased is
         not the same as being looked after (that is the whole separation). */
      treat: { mood: 0.20, plainMood: 0.20, goodMood: 0.34, cooldown: 6 },
      /* consumables she can stack. A cap so a rich player cannot buy a year of
         treats and never think about it again. */
      maxTreats: 20,
    },

    /* ================================================================
       THE KENNEL (stage 6) — CARE POINTS ONLY, AND NO PRICES ON IT.

       Where a second and a third dog are adopted and where she swaps between
       them. Adopting is deliberately NOT a row tap: `ui/kennel.js` runs a short
       beat for it, because "adopting a second dog is a real milestone, not a
       menu" (SCOPE stage 6) and a milestone that resolves in one frame is a
       menu with better copy. The beat runs UNCHANGED for the third — the same
       knock, the same glow, the same lines with a different name and different
       pronouns in them, because the second dog is not more of an occasion than
       the last one.
       ================================================================ */
    kennel: {
      /* EVERY BREED dog/breeds.js DRAWS, and no more: the Schnoodle, the
         Cockapoo, the Shiba, the Corgi and the Golden. Was 2 (which capped the
         kennel below the art that already existed), then 3.
         It is a SEPARATE number from the count of breed rows on the ladder on
         purpose: the rows say what she can earn, this says how many dogs the
         room and the kennel layout can hold. Raising it without adding a row
         unlocks nothing; adding a row without raising it is refused with
         `reason: 'full'` rather than silently ignored.
         FIVE IS THE LAYOUT'S CEILING, not a round number. `ui/kennel.js` sizes
         its cards to the space left over after the earned list and the Done
         button, and at five it has come down to its 64-unit floor with about
         ten units to spare on a 40-unit-inset phone. A sixth would need the
         panel to scroll, and nothing in this game scrolls. */
      max: 5,
      /* `adoptId` / `adoptBreed` / `adoptSex` USED TO BE HERE. They are now
         per-row on `economy.unlocks` (see the breed rows there): with one
         adoptable breed a single triple was the same thing said more simply,
         and with two it was the reason a finished, drawn, precached Shiba could
         not be reached by any code path in the game. */
      beat: {
        hold: 0.55,             // the pause before the door opens
        reveal: 1.9,            // the puppy comes out
        settle: 2.6,            // ...and the name prompt follows
      },
      /* switching dogs remounts the room, so the other dog gets a real arrival
         rather than a cross-fade. This is the pause before that happens. */
      switchHold: 0.42,
    },
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
    /* ---- stage 6 ----
       The eating stoop's envelope. Deliberately a little SLOWER and softer
       than `sit`/`down` (42/46) so the small forward lean it drives arrives
       just behind the crouch: he folds down first and settles toward the
       bowl second, which is the difference between committing to a meal and
       being pushed into one. */
    stoop:    [34, 11],
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
    /* the stroll dissolving in and out. Slow and dead-flat: this one crossfades
       the WHOLE SCREEN between the room and the road, and a full-surface
       dissolve that overshoots reads as a flicker rather than as a place. */
    strollW:  [30, 14],
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
    /* ---- the disc game (stage 9). `makeSprings` throws on a name that is not
       in this table, which is how the disc layer failed to boot the first time
       it was run — a guard doing exactly its job. `field` is slower than the
       ring's wash because the disc field is a lighter dim and should not snap;
       `flash` is the catch/miss beat and wants to be quick and over. */
    field:    [34, 12],     // the disc field's wash
    panel:    [110, 15],    // the entry panel arriving (the board's numbers)
    flash:    [150, 16],    // the catch or the miss, briefly
    mark:     [150, 11],    // the round's pip landing
  },
  springStep: { h: 0.008, maxSub: 6, minDt: 0.009 },

  /* ---- rig motion ---------------------------------------------------- */
  /* ==================================================================
     THE PROFILE DOG (dog/side.js)

     Raised and approved after eight stages of not having one: "Actually I do
     want a side and back profile of the dogs". Built against
     `docs/reference/side-run-cycle.png`.

     EVERY NUMBER IN HERE IS A MULTIPLIER ON A FRONTAL PROPORTION, never an
     absolute. `breed.proportions` already says how big this dog's head and body
     and legs are, per breed, and a second set of absolute sizes would mean a
     Shiba in profile and a Shiba face-on were two different dogs. So this block
     is the ART DIRECTION — what changes when you walk around him — and the
     breed table stays the single source of truth for how big he is.
     ================================================================== */
  side: {
    /* a puppy in profile is LONGER than he is wide face-on, and his chest is
       deeper than his flank is tall */
    body: { long: 0.62, deep: 0.40 },
    /* the head is huge and sits forward and high, over the shoulders */
    head: { w: 0.44, h: 0.42, fwd: 0.52, up: 0.62 },
    /* the muzzle is the FRONT OF THE FACE now, not a shape stuck on it */
    muzzle: { w: 0.30, h: 0.24, x: 0.62, y: 0.30, face: 1.05 },
    /* `face` is the muzzle dimension dog/face.js sizes the nose and mouth off
       (it reads it as `D.muzY`); `mouth` is where the mouth sits on the muzzle */
    nose: { x: 0.72, y: 0.12, r: 0.30 },
    mouth: { x: 0.10, y: 0.42 },
    /* WHERE THE FURNISHINGS SIT IN PROFILE. New art, matched to the breed's own
       furnishing entry by tag — see the note in side.js's SHAPE block. */
    /* SIZED OFF THE MUZZLE, and the first go was not: at `w 0.62` of the BREED's
       muzzle width the beard came out twice the width of the PROFILE muzzle
       (which is `muzzle.w` 0.30 of the same number) and buried the whole face in
       a pale blob. These are multiples of the profile muzzle's own half-extents. */
    furn: {
      beard: { w: 1.15, h: 1.30, x: 0.44, y: 0.52 },
      moustache: { w: 0.62, h: 0.52, x: 0.60, y: 0.28 },
    },
    /* the eye is drawn by dog/face.js now, which wants a WIDTH and a lid
       aspect rather than a radius: `w` across, `aspect` how tall against that,
       `tilt` the lid rotation that gives him his expression. */
    eye: { x: 0.30, y: -0.02, w: 0.26, aspect: 1.02, tilt: 0.10 },
    /* one ear, hanging off the near cheek, swinging with the stride */
    /* ONE EAR, AND IT IS NOT A PLANK. At w 0.62 / h 0.92 and barely rotated it
       came out as tall as his whole body, hanging down the middle of him over the
       front legs — the single worst thing in the first two renders. It is a lobe
       lying back along the cheek: half the size, well behind the eye, and rotated
       enough to follow the jaw. */
    /* AND IT HAS TO HANG PAST THE SKULL. At `y -0.06` the whole ear sat INSIDE
       the head's outline, so it read as a pale patch on the cheek rather than as
       an ear: what makes an ear an ear from the side is that its silhouette
       BREAKS the head's. Lower, taller, and only lightly laid back. */
    /* MEASURED, not guessed. At h 0.74 the ear came out 44.4 half-units against
       a head of 44.7 — as tall as his whole skull and only 31 wide, which is why
       it read as a tongue hanging to his chest. A drop ear is about 60% of head
       height and reasonably broad, and it wants to hang from behind the eye with
       its bottom just past the jaw so its silhouette BREAKS the head's. */
    ear: {
      /* A DROP EAR hangs from behind the eye with its bottom past the jaw, so
         its silhouette BREAKS the head's — which is what makes it read as an ear
         side-on rather than as a pale patch on the cheek. */
      drop: { w: 0.52, h: 0.44, x: 0.22, y: 0.44, angle: 0.18 },
      /* AN ERECT EAR stands on the crown: above the head's centre, barely
         behind it, tipped back a little. Its `y` is NEGATIVE, which is the whole
         difference — everything else here is the same kind of number. */
      prick: { w: 0.54, h: 0.46, x: 0.34, y: -0.56, angle: 0.24 },
    },
    /* the tail read as a SECOND RUMP at 0.30 x 0.46 — a scalloped mass the size
       of his hindquarters, at mid-height. A plume is small, high and behind. */
    /* `curl` and `carry` are how much `breed.proportions.tailCurl` / `tailCarry`
       rotate the plume: a Shiba's 0.72 curl lifts it over the back, a doodle's
       0.1 leaves it out behind. */
    tail: { x: 0.88, y: 0.54, w: 0.19, h: 0.26, angle: -1.15, curl: 1.15, carry: 0.55 },
    /* the legs: stubs, no joints (the reference has none), with the hind pair
       a little longer and the paw a little wider than the leg */
    /* thicker than the frontal legs, not thinner: in profile a leg is a whole
       limb rather than a strip of one, and at 1.05 they read as wire. Shorter,
       too — the reference puppy is low to the ground. */
    /* RETUNED FOR A REAL LIMB. `len 0.98 / w 1.55 / paw 0.70` were tuned against
       the first renderer, which stroked a line with a round cap: to read as a leg
       at all, a capsule has to be thick. `drawLimb` (dog/part.js, the frontal
       dog's own leg) tapers from the hip, bows at the knee and draws its own pale
       paw at `w * 1.06 * paw` — so the old width came back as four boots with a
       mitten on each. Thinner, longer, and a paw barely wider than the ankle.
       `bow` is the knee: without it a leg is a rod. */
    leg: { len: 1.34, w: 0.78, hind: 1.04, paw: 0.44, bow: 5.0,
      shoulderX: 0.56, hipX: 0.68 },
    /* THE NECK: withers to the back of the jaw, wider at the chest end, and
       drawn with NO contour — see the rule quoted in side.js's `neck`. */
    neck: { fromX: 0.52, fromY: 0.34, toX: 0.22, toY: 0.40, w0: 0.70, w1: 0.52 },
    cream: { w: 0.44, h: 0.42, alpha: 0.85 },
    shadow: { ink: 'rgba(74,58,42,0.22)', alpha: 1, w: 0.92, h: 0.16 },
    /* ---- THE SPRITE SHEETS (dog/sidesprite.js) ------------------------
       The human drew the profile dog himself after the drawn one was rejected
       twice, so `assets/side-*.webp` is art and this is how it is placed.

       `height` is HOW TALL HE IS IN VIRTUAL UNITS at `rig.s === 1`, measured off
       the drawn profile — 150 units — so swapping between the sprite and the
       drawn dog cannot change the size of the animal. The shadow is ours: the
       painted ones were keyed out by the slicer because a painted shadow cannot
       shrink when he leaves the ground. */
    /* `height` IS HOW TALL HE IS IN VIRTUAL UNITS at `rig.s === 1`, and 150 was a
       guess that came back as a small dog next to the frontal one. Derived
       instead: the frontal body is `bodyHW` 64.5 half-units, so 129 across; the
       same body in profile is a bit over twice as long, ~280; and the sheets are
       1.12 wide for every 1 tall, so 280 / 1.12 = 250. He is the same animal seen
       from the side, which is the entire claim the profile has to make. */
    sprite: { height: 250, shadowW: 0.32, shadowH: 0.055 },

    /* ---- THE GAIT ----------------------------------------------------
       A BOUND, not a trot, because that is what the reference draws: two
       extended frames and two gathered ones, both front legs together. A trot
       (diagonal pairs) is what a dog on a lead actually does and it is the
       obvious next variant, but the art contract is the reference.

       `lagFar` is why he reads as four legs rather than two: the far leg of a
       pair is a fraction of a cycle behind the near one. */
    gait: {
      hz: 2.1,            // cycles per second at a normal trot
      bob: 9,             // how far the whole dog lifts, once per cycle
      stretch: 0.5,       // body lengthening on the extension
      /* how far a paw travels fore and aft. 13 was tuned against legs a third
         shorter; on a real limb the four frames came back nearly identical, and
         a bound whose frames look the same is a dog on a conveyor belt. */
      reach: 19,
      paw: 7,             // how far it comes off the ground
      foreshorten: 0.22,  // how much a leg shortens as it swings under him
      lagFar: 0.08,       // the far leg of a pair, behind the near one
      headBob: 3.2,
      tail: 0.22,
      ear: 0.30,
    },
  },

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
    /* ---- hanging-ear spring chains (declarative, keyed by breed.ear) ----
       A prick ear is one rigid triangle and needs no chain. A HANGING ear is
       the best secondary-motion opportunity on the whole animal: it has
       weight, it lags, it swings past the head and comes back. So a floppy
       ear is a spring chain exactly like the tail — each joint inherits the
       previous joint's deviation — driven by the SAME `earL`/`earR`/`earBack`
       springs everything already kicks. That is why every existing clip,
       petting response and the reunion get floppy motion for free.

         n          joints in the chain
         k / d      per-joint stiffness / damping ([root, rest])
         inherit    how much of joint i-1's deviation joint i picks up
         waveLag    phase lag of the driving swing down the chain
         hang       RELATIVE resting angle per joint, in the canonical ear
                    frame where +x is outward from the skull and +y is down.
                    Cumulative sum = the hanging curve.
         swing      how much of the earL/earR spring the root joint takes
         backSweep  how far `earBack` sweeps the whole ear up and off the cheek
         flop       extra tip deviation from a big MEASURED head shake
         spread     base offset outward, x ear half-width
       ------------------------------------------------------------------- */
    earChain: {
      /* A LONG SPANIEL EAR. It hangs FLAT AND CLOSE against the cheek — a
         cockapoo ear standing away from the head like a running spaniel is a
         named amateur tell — so the rest curve is very nearly vertical, with
         only a slight outward set at the attachment. */
      floppy: {
        n: 5, k: [128, 152], d: [12.5, 11.2], inherit: 0.42, waveLag: 0.34,
        hang: [1.26, 0.11, 0.07, 0.04, 0.03], swing: 0.95, backSweep: 0.52,
        flop: 0.30,
      },
      /* A SEMI-FLOPPED DOODLE EAR: it leaves the skull at a slant, KNUCKLES
         over, and hangs down beside the face.
         `hang` is a chain of RELATIVE angles in a frame where 0 is straight
         outward and +pi/2 is straight down, so the cumulative angle is what you
         actually see. The previous table read [-0.40, 1.52, 0.30, 0.18] — the
         root segment ran at -23 DEGREES, i.e. up and outward, for its whole
         length before anything folded. Rendered, that put a hard straight edge
         out to +15 units of x while still rising, and the pair came back as two
         angular flaps sticking out sideways like leaves. It was authored as "a
         lifted cartilaginous base", which is a correct description of an adult
         button ear and is not what a young doodle wears.
         Now: root at 40 degrees (out and already descending), a firm knuckle to
         93 degrees at the first joint, then hanging down and drifting a couple of
         degrees inward so the leather lies along the cheek and FRAMES the face.
         The bend at the base is what still reads as semi-flopped rather than as
         the Cockapoo's straight vertical curtain. */
      /* AND THE FOLD IS SPREAD OVER FIVE JOINTS, NOT CONCENTRATED IN ONE.
         With n=4 and the bend all at the first joint, the ribbon renderer had
         only four segments to describe a 55-degree turn, so it drew two long
         straight facets meeting at a corner — which is precisely the "angular
         flap" read, and no amount of moving the anchor fixes a shape that has a
         visible crease in it. Five shorter segments turning ~25 degrees each
         describe the same total fold as a CURVE. (The Cockapoo gets away with
         n=5 and near-zero relative angles because a straight hang needs no
         segments to be smooth; a folded one does.) */
      semi: {
        n: 5, k: [186, 138], d: [14.0, 11.0], inherit: 0.34, waveLag: 0.28,
        hang: [0.48, 0.72, 0.34, 0.16, 0.10], swing: 0.62, backSweep: 0.40,
        flop: 0.24,
      },
    },
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
           /* ---- stage 8: PLANTED PAWS -----------------------------------
              Master switch for `rig.update()`'s floor planting. When the layer
              that owns the pose sets `rig.plantShare`, the planted front paw's
              sole resolves against `rig.floorV` — the room's floor — instead
              of the authored offsets above, and the legs take up the slack.

              The offsets above are NOT wrong; they are what a lie-down looks
              like when there is nothing on the floor to disagree with. They
              became wrong the moment a bowl had to stand on the same floor:
              `sitLift` + `downPawY` plus the stoop's forward lean put the
              drawn sole 23-26 virtual units below the line the bowl was
              standing on, on all three breeds (ARCHITECTURE §18.2).

              Set false to get stage 7's paws back for a like-for-like look. */
           plantOnFloor: true,
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
    /* ====================================================================
       DESIGN TOKENS (stage 9) — THE ONE PLACE THE LOOK IS DEFINED.

       Before this block, nine modules improvised their own cream, their own
       brown and their own border alpha: `#fff8ea`, `#fff8f3`, `#fdf3df`,
       `#f6e8d2`, `#f4e6d0`, `#f7e7cd` were all "the card colour", and
       `#7c4a2f`, `#6b3a24`, `#5d3018`, `#4a2a14` were all "the ink". They
       are close enough that nothing looked broken and far enough apart that
       nothing looked like one product. `docs/DESIGN-REF.md` supplied a
       systematised Material-3 warm set that is very near what was already
       there, so this is consolidation rather than a repaint.

       Read through `src/ui/tokens.js`, which gives these ergonomic names and
       the derived values (dark-mode ink, alpha helpers). Nothing outside that
       module should name a colour.

       WHY THE DATA IS HERE AND THE DRAWING IS NOT. §11.1(G) already settled
       this for the dog's colour ramps: numbers a person might tune live in
       balance.js, and the code that applies them lives with the thing it
       draws. So the hexes, sizes and durations are here; `ui/surface.js` owns
       the tactile press, the warm shadow, the inset well and the stitched
       divider that consume them.
       ==================================================================== */
    tokens: {
      /* ---- palette (docs/DESIGN-REF.md §TAKE) --------------------------
         Material-3 role names kept verbatim, because the point of taking a
         systematised set is to stop inventing private names for the same
         colour. `on*` is ink, `surface*` is ground, `*Container` is a filled
         chip or a raised card. */
      color: {
        primary: '#815129',
        primaryContainer: '#9d693e',
        secondary: '#765933',
        secondaryContainer: '#fed6a7',
        tertiary: '#914635',

        surface: '#fff8f3',
        surfaceLowest: '#ffffff',
        surfaceLow: '#fff2e1',
        surfaceContainer: '#ffebcf',
        surfaceHigh: '#fde5bf',
        surfaceHighest: '#f8dfba',
        surfaceDim: '#efd7b2',

        onSurface: '#251a03',
        onSurfaceVariant: '#51443b',
        outline: '#84746a',
        outlineVariant: '#d6c3b7',

        inverseSurface: '#3c2e15',
        inverseOnSurface: '#ffeed8',
        error: '#ba1a1a',
        errorContainer: '#ffdad6',

        /* the four NAMED ACCENTS. Each one means exactly one thing, and the
           discipline is the value: a coral that only ever means affection is
           information, a coral used for decoration is noise. */
        coralToy: '#F2A291',    // hearts, affection — NEVER as a meter (see §2)
        mintGrass: '#A8D5BA',   // outdoors, walks
        skyBlue: '#B9E0FF',     // water, energy
        deepBark: '#2A1C14',    // deepest shadow; already the boot colour
      },

      /* ---- type ramp ---------------------------------------------------
         DECISION 2 in docs/DESIGN-REF.md: the mock's ramp, the SYSTEM font
         stack. No Plus Jakarta Sans, self-hosted or otherwise — zero extra
         bytes, nothing to precache, no flash of unstyled text, and one fewer
         thing that can fail offline.

         `line` is the mock's line-height in px; ui/text.js divides it by
         `size` to get its box height, so a step carries its own leading
         instead of inheriting one global 1.32. `track` is letter-spacing in
         em (see ui/text.js for the Safari feature-detect).

         Virtual design space is 390 wide and the target device is 390 CSS px,
         so these px sizes land at the mock's intended size on her phone. */
      type: {
        displayLg:  { size: 48, line: 56, weight: 800, track: -0.02 },
        headlineLg: { size: 32, line: 40, weight: 700, track: 0 },
        headlineMd: { size: 28, line: 36, weight: 700, track: 0 },
        titleMd:    { size: 20, line: 28, weight: 600, track: 0 },
        bodyLg:     { size: 18, line: 26, weight: 400, track: 0 },
        bodyMd:     { size: 16, line: 24, weight: 400, track: 0 },
        labelMd:    { size: 14, line: 20, weight: 600, track: 0.01 },
        labelSm:    { size: 12, line: 16, weight: 700, track: 0.05 },
      },

      /* ---- radii & spacing --------------------------------------------
         The mock gives 1rem / 2rem / 3rem / full. `sm` is an ADDITION and
         documented as one: a 6px-tall progress track cannot have a 16px
         radius, and `full` on something that thin is the same as sm anyway. */
      radius: { sm: 8, md: 16, lg: 32, xl: 48, full: 9999 },
      space:  { base: 8, gutter: 16, card: 24, margin: 20 },

      /* ---- the tactile press (ui/surface.js) ---------------------------
         The best idea in the supplied design, and the reason it is worth
         reproducing in Canvas2D: a control with a visible bottom edge that
         compresses under a thumb reads as an OBJECT rather than a rectangle
         that changed colour. `.tactile-button` is border-bottom 4px -> 1px
         with translateY(2px) over 100ms.

         Net geometry, reproduced exactly: at rest the face sits at y with a
         4-unit edge below it (bottom at y+h+4); pressed, the face sits at
         y+2 with a 1-unit edge (bottom at y+h+3). So the top sinks 2 and the
         bottom lifts 1, which is what makes it feel like compression rather
         than a slide.

         `dur` is the ease-out ramp. `reducedDur` is 0 rather than "slower":
         prefers-reduced-motion is a request for less MOTION, not less
         FEEDBACK, so the press snaps to its final state and stays every bit
         as informative. */
      press: { edge: 4, edgeDown: 1, sink: 2, dur: 0.10, reducedDur: 0 },

      /* ---- the warm soft shadow ----------------------------------------
         `0 12px 32px -4px rgba(131,83,43,.12)`. WARM, never grey: a neutral
         grey shadow in a room this warm reads as a UI element pasted over the
         art, which is the exact complaint that produced ui/text.js's warm
         plates. Canvas2D has no shadow SPREAD, so `inset` reproduces the
         `-4px` by casting from a path shrunk by 4 — see ui/surface.js. */
      shadow: { dy: 12, blur: 32, inset: 4, color: 'rgba(131,83,43,0.12)' },

      /* ---- inset wells --------------------------------------------------
         `inset 0 2px 4px rgba(0,0,0,.05-.1)` for anything recessed: meter
         tracks, the search field, a pressed-in chip. */
      well: { dy: 2, blur: 4, alpha: 0.10, alphaSoft: 0.05 },

      /* ---- the stitched divider ----------------------------------------
         2px dashed. It suits this game specifically: the rug in the room is
         already stitched, so a dashed rule reads as the same hand rather than
         as a border. */
      stitch: { w: 2, dash: [5, 5], color: '#d6c3b7' },

      /* ---- BUBBLE METERS — CARE NEEDS ONLY ----------------------------
         DECISION 1 in docs/DESIGN-REF.md, and the one hard line in this whole
         pass: hunger, thirst and coat get a bar. THE BOND NEVER DOES.

         Three, not four. ENERGY IS DELIBERATELY ABSENT and it is not an
         oversight: nothing she can do restores it. It recovers by itself with
         rest (BALANCE.time decay is NEGATIVE for energy) and is spent by
         play and walks, so a bar for it would be a number she can watch and
         cannot act on — which is the "meter to optimise" failure the whole
         rejection in DESIGN-REF §1 is about, just wearing a different label.
         It stays a WORD (`Bouncy`/`Normal`/`Tired`/`Sleepy`), which describes
         him instead of scoring her. The other three each have a button.

         The words stay next to the bars for all four, because the words are
         the original's own scale and they say things a fill fraction cannot
         ("Famished" is not 12%).

         `accent` is one named colour per need, held to the accent discipline
         above: thirst is sky-blue because it is water; hunger is the caramel
         `primaryContainer` because it is food; coat is `tertiary`, the warm
         rust of a brush. coral-toy is absent ON PURPOSE — it means affection,
         and affection has no meter. */
      needs: {
        rows: [
          { key: 'hunger',      label: 'Hunger', accent: '#9d693e', icon: 'bowl',  bar: true },
          { key: 'thirst',      label: 'Thirst', accent: '#B9E0FF', icon: 'drop',  bar: true },
          { key: 'cleanliness', label: 'Coat',   accent: '#914635', icon: 'brush', bar: true },
          { key: 'energy',      label: 'Energy', accent: '#84746a', icon: 'moon',  bar: false },
        ],
        /* the track width is DERIVED from the panel, not stored: a stored width
           and a stored panel width are two numbers that have to agree, and the
           one that loses the argument is always the one that leaves a 3-unit
           sliver of track hanging past the label. */
        panelW: 206, rowH: 32, padX: 12, padY: 9,
        bubbleR: 10, bubbleGap: 8, trackH: 6,
        /* below this the fill warms toward `low` — a nudge, never a red alert.
           No badge, no count, no dot: research §3, a "1" on a pet is guilt. */
        lowAt: 0.28, low: '#c9563f',
      },
    },

    meter: { w: 82, h: 30, pad: 14, pulseDecay: 2.6, pulsePerUnit: 0.004 },
    /* ROUTED THROUGH ui/text.js IN STAGE 5 — it was the lowest-contrast text
       left in the game, which stage 4's notes had already flagged. `size`,
       `padX`/`padY` and `step` are the pill's geometry; the plate's ALPHA is
       not here any more because it is no longer a number anyone chooses — the
       helper solves it against the worst possible background. */
    /* ---- TOASTS, AND KEEPING OFF THE THING THEY ARE TALKING ABOUT ------
       Queue item 5: "the 'Biscuit is full' toast sits directly over the bowl it
       refers to", and in Play a toast covered the very ball it named. Both were
       perfectly legible, which is why no contrast gate could see it — the defect
       is placement, and the only layer that knows the subject is the caller.

       `avoidGap` is the clearance the stack keeps from the subject's rect;
       `avoidMaxLift` is how far it will move to get it. The cap matters more
       than the gap: a toast that climbs onto his face to avoid a bowl has not
       solved anything, so past this it is better to overlap the prop a little
       than to land somewhere absurd.

       `bowlRect` and `toyRect` are half-extents around each thing's own draw
       position — [halfWidth, above, below] for a bowl, which is drawn from its
       base, and [halfWidth, halfHeight] for the ball. */
    toast: {
      dur: 1.9, fade: 0.32, y: 118, maxStack: 3, size: 13.5, padX: 15, padY: 7, step: 34,
      avoidGap: 10, avoidMaxLift: 96,
      /* MEASURED OFF THE RENDER, not guessed. The first pair were [34, 30, 12],
         which is a third of the width the bowl is actually drawn at — the toast
         cleared it anyway, so the gate passed while the rect was describing
         something much smaller than the thing it was protecting. A placed bowl
         spans about 95 units either side of its centre and stands ~34 above its
         base point. The ball is 16 units of radius plus its shadow. */
      bowlRect: [95, 34, 14], toyRect: [22, 22],
    },
    /* STAGE 9 CUT THE NAV FROM EIGHT PILLS TO FIVE (Care/Play/Train/Walk/More).
       Eight across 390 left 40.5 units each — under the 44 tap-target
       guideline, and stage 6 shipped it knowing that. Five give 68.4:

         (390 - pad*2 - gap*4) / 5 = (390 - 24 - 24) / 5 = 68.4

       `h` went 58 -> 60 because there is now room for it, and because the
       tactile edge (tokens.press.edge) hangs below the face: `layout()`
       subtracts it so the pill's bottom edge lands at 798 with the target
       device's 40px bottom inset, i.e. inside the safe band with 6 to spare.

       `label` is GONE as a tunable: the label is now the type ramp's `label-sm`
       step (12/16/700, +0.05em) via ui/tokens.js `type('labelSm')`. The old hard
       9.5 existed to survive seven pills. `r` is superseded by tokens.radius.md
       and kept only so an old save's layout maths cannot shift.

       `minInset`, `gapBelow`, `hitUp` and `hitDown` were four magic numbers
       inside ui/nav.js's `layout()` and `hit()`, which is exactly how the
       reachability defect below survived: a bar whose geometry lives nowhere is
       a bar nothing can be laid out AROUND. They are now read by ui/reach.js,
       which is the one place that computes both the bar's rect and the bottom
       of the reachable play area, so the two cannot drift apart.
         minInset  the inset assumed on a device that reports none
         gapBelow  clearance left under the tactile edge
         hitUp     slop ABOVE the face that still counts as a press
         hitDown   slop below the edge, likewise */
    nav: { h: 60, gap: 6, pad: 12, r: 15, iconR: 12,
           minInset: 6, gapBelow: 6, hitUp: 4, hitDown: 2 },

    /* ---- THE REACHABLE PLAY AREA (ui/reach.js) -------------------------
       The bottom of what a thumb can touch. DERIVED from the nav's hit rect —
       itself derived from `nav` above plus `env(safe-area-inset-bottom)` — and
       then pulled up by `margin`. Every interactive prop is clamped to it.

       Why this block is three numbers and not a coordinate: the ball's resting
       positions used to be absolute (736 / 782 / 792), the bar's top edge moves
       34 units between a notched phone and a flat one, and stage 9 moved it
       again by going from eight pills to five. Nothing compared the two, so on
       the target iPhone a ball dropped after a flinch landed 48 units inside
       the bar and a touch on it pressed TRAIN. See the header of ui/reach.js.

       `margin` is the finger clearance between a prop's hit area and the bar's
       — 8 virtual units, which is 8 CSS px at this width. `top` is the other
       end of the same band and is the value the ball's drag clamp already
       used, kept so nothing above the fold moved. */
    reach: { margin: 8, top: 200 },

    /* WHAT A COLLAR LOOKS LIKE. Here rather than in either place that draws
       one, because BOTH draw one: `dog/draw.js` puts it on his neck and
       `ui/shop.js` / `ui/kennel.js` put it on a row and a portrait, and a
       shop swatch that did not match the collar on the dog would be a small
       lie in the one place the player is deciding. `collarRed` is the EARNED
       one (90 care points); the rest are bought. */
    wear: {
      /* ---- A FOUND ACCESSORY, ON HIS COLLAR -----------------------------
         `drawFind` draws these at shelf size — about 24 units for a bell — and a
         24-unit bell on a 28-unit collar band is a cowbell, so they are scaled
         down to about the size of the `collarTag` disc the same block draws.

         PER ACCESSORY, BECAUSE THEY HANG DIFFERENTLY. One shared offset put both
         at 0.30 of the collar's half-width below the neck joint, and rendering it
         showed why that is wrong: the bell hangs BELOW the chest ruff and reads
         perfectly, while the ribbon — wider, flatter — was drawn at the same
         point and almost entirely swallowed by the fur. A bow sits lower and
         bigger; a bell dangles. `y` is a share of the collar's half-width. */
      accessory: {
        bell: { s: 0.42, y: 0.30 },
        ribbon: { s: 0.62, y: 0.52 },
      },
      collarRed: '#c9563f',
      collarBlue: '#5d90ad',
      collarGreen: '#7ba36a',
      collarTag: '#8d6a4a',
    },

    /* ---- the shop (stage 6) -------------------------------------------
       Eight rows at 58 plus a header and a Done button comes to 604 of the
       844 the screen has, so THE SHOP DOES NOT SCROLL. That is a constraint
       on the catalogue, not a thing to solve with a scroll view: a shop you
       cannot see the bottom of is the retention scaffolding research §7 warns
       about, and a list that fits is a list she can hold in her head.

       `sfx` MAPS ONTO THE STAGE-7 BANK and invents nothing. engine/audio.js
       records every unresolved name in `audio.pending`, which stage 7 got to
       empty for the first time — a made-up `ui-open` would put it back. So
       these are real recipes chosen for what they mean: a bought object is
       SET DOWN (`bowl-set`), a refusal is him huffing (`huff`), a treat is a
       `crunch`, and a collar going on makes him `perk` up. */
    shop: {
      /* ROW HEIGHT CAME DOWN FROM 58 TO 54 SO TWELVE ROWS STILL FIT.
         The no-scroll rule above is the constraint, and it is arithmetic, not
         taste: header 62 + 12 x 54 + a 40-unit Done + 8 of gap is 758, against
         a floor of 804 on the target phone (844 less its 40-unit home bar). At
         the old 58 the twelfth row put Done at 798 and left six units, which is
         not a margin. Thirteen rows do not fit at any row height worth reading,
         so the catalogue is full: the next thing added has to replace
         something. */
      pad: 14, headH: 62, rowH: 54, rowGap: 6,
      chipW: 62, chipH: 28,
      flash: 0.28,              // the press highlight, seconds
      sfx: {
        open: 'cue', close: 'pat-soft', buy: 'bowl-set', deny: 'huff',
        give: 'crunch', wear: 'perk',
      },
    },

    /* ---- the kennel (stage 6) -----------------------------------------
       NO PRICES ON THIS SURFACE, EVER. The only number it shows is care
       points, and the only number the shop shows is coins; between them that
       is how a player learns the rule without being lectured.

       `sfx.reveal` and `sfx.settle` carry the adoption beat. `praise` then
       `proud-yip` is the same pairing the reunion uses for its payoff, which
       is the right family of sound for meeting somebody. */
    kennel: {
      pad: 14, headH: 62,
      /* `cardH` IS NOW A CEILING, NOT A HEIGHT. ui/kennel.js sizes a dog card to
         the space the earned list and the Done button leave, clamped between
         these two: 92 is what the surface has always drawn and is what one to
         four cards still get exactly, and 64 is the floor below which the three
         lines of a card (name, breed, collar) stop fitting. Five dogs land at
         about 74. See `cardH()` in that file for why the alternative — letting
         the Done button's clamp slide it under the last earned rows — was the
         worst of the options. */
      cardH: 92, cardMinH: 64, cardGap: 8,
      rowH: 46,                 // the earned-list rows
      portraitR: 30,
      flash: 0.28,
      sfx: {
        open: 'cue', close: 'pat-soft', deny: 'huff', pick: 'perk',
        knock: 'sit-thump', reveal: 'praise', settle: 'proud-yip',
      },
    },
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
    train: {
      hintY: 82, legendTop: 132, rowH: 19, glyphR: 11, maxRows: 8,
      /* THE LEAVE AFFORDANCE. Was three hardcoded numbers inside train.js's
         draw (§1: every tunable lives here), which is also how the defect
         below went unseen for six stages — a button nobody could find in this
         file is a button nobody lays anything out around.

         `hintGap` is the clearance the hint line must keep from it. The hint
         is centred on the screen and the button is not, so the hint's usable
         width is twice the distance from centre to the button's near edge:
         a long instruction used to run UNDER the X and lose its last two
         words ("...show him what it means" read as "...show him what it mea").
         Deriving the width from the button means moving one cannot re-break
         the other. */
      close: { x: 342, y: 62, r: 17, hintGap: 9 },
      /* ---- THE TRICK LIST (ui/tricklist.js) ---------------------------
         The legend above says what he THINKS a signal means. Nothing said
         what there was to teach at all: the eight hints only ever appeared as
         a ghost gesture that cycled one at a time after three seconds of
         stillness, so the ladder could only be found by stopping and waiting
         — "we also need more descriptions for the player regarding the
         tricks. currently its just a guessing" (docs/FEEDBACK-QUEUE.md 1b).

         `open` is the pill that opens it, and it sits UNDER the signal pad
         (which ends at `pad.bottom` 306) on the opposite side from the "call
         him" bubble at (44, 430). It is deliberately not in the top row: the
         hint line is centred and its width is already derived from the leave
         button, so a second thing up there would have taken words off the
         first instruction in the beat. */
      tricks: {
        open: { x: 16, y: 320, w: 96, h: 34, r: 17 },
        /* rowH carries FOUR lines — name, what he does, how to ask, and (only
           for the two floor tricks, and only while he is not on the floor) why
           not. At 78 the fourth line sat four units off the bottom edge and
           looked like it had fallen out of the row; 82 gives it room and still
           fits eight rows plus Done above the home bar at every inset, because
           ui/tricklist.js fits the height rather than trusting this number. */
        pad: 14, headH: 58, rowH: 82, rowGap: 6, closeH: 42, closeGap: 10,
        /* the lowest a row may reach. The list is a full-height sheet and the
           nav is hidden behind it, so the only floor is the safe area — but
           `rowH` is fitted to what is left rather than typed in, so a ninth
           trick shortens the rows instead of pushing Done off the screen. */
        bottomPad: 12,
      },
    },
    /* the route map. A CUTE HAND-DRAWN MAP, not a UI: the paper, the wobble in
       the ink and the little house are the whole charm of the beat. */
    map: {
      top: 96, bottom: 700, pad: 16,
      /* the title and the hint sit INSIDE the paper: above it they were dark
         brown drawn over the dimmed room, which is the cream-on-cream mistake
         in the other direction */
      titleY: 102, hintY: 123, choiceY: 706,
      /* how far the paper runs on BELOW `bottom`, so it finishes underneath the
         Set-off pill instead of behind it. The pill's lowest pixel — including
         the 4-unit tactile edge — is at setOff.y + setOff.h/2 + edge/2 = 781;
         the paper's bottom is (top - 26) + (bottom - top + cardTail), so 119
         puts it at 793 and leaves 12 units of paper under the button. At the
         old value of 96 the paper stopped at 770 and the button hung off it.
         Ceiling: the safe-area bottom is at 844 - 40 = 804. */
      cardTail: 119,
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
    /* ---- THE EXPLAINER CARD (ui/howto.js) ------------------------------
       "in general we should always include a tutorial for any feature/mode in
       the game". One card, sized from its CONTENT: the training card has four
       steps and brushing has two, and a fixed height would either crop one or
       leave a hole in the other.

       `w` is 306, the same width as the disc's entry panel and the trial's card,
       because three different card widths on one phone reads as three different
       apps. The step lines were written against it at their longest pronoun
       expansion ("they/them/their"), which is the check `kennel.js` learned to
       do the hard way — a sentence measured at 334 units in a 116-unit slot,
       ellipsised to "She goes to someone wh…", caught only by looking. */
    howto: {
      w: 306, r: 22, minTop: 96,
      padTop: 82,        // from the card's top to the FIRST step's baseline
      stepGap: 40,       // between step baselines
      noteGap: 34,       // extra room when there is a closing line
      padBottom: 84,     // room for the note's descenders and the button
      /* the step column: a numbered pip and then the words. Tightened from
         34/12 after `tools/howtogate.py` measured every line and found most of
         them being SHRUNK from 14px to between 11.5 and 13.5 to fit — which
         `ui/text.js` does silently, so the card looked fine and was quietly a
         different size on every row. Between this and shorter copy, every line
         is now drawn at its intended size. */
      numX: 30, numR: 11, numGap: 9, textRight: 16,
      done: { w: 132, h: 44, inset: 22 },
      /* the room goes quiet behind it, not dark: this is a card, and the dog is
         still the thing on the screen */
      scrim: 0.22,
    },

    /* ---- THE COLLECTION (ui/collection.js) -----------------------------
       Opened by tapping the window sill, which is where his things already
       stand — the affordance is the shelf itself rather than a sixth pill in
       a nav bar the design pass just cut to five.

       `slotH` carries a glyph and its name; `cols` at 4 gives a slot 84 units
       wide, which is what "somebody's lost glove" needs at labelSm before it
       ellipsises. The album's rows are single-line, so they are shorter. */
    collection: {
      pad: 14, headH: 52, gap: 10, labelH: 22,
      /* THREE columns, not four. At four a slot is 84 units wide and the
         longest name in the find table shrank to the type floor and ellipsised
         anyway; at three it is 115 and every name fits. `slotH` carries a glyph
         ABOVE its name — they were six units apart at the bottom of the slot,
         which drew the type straight through the bell. */
      slotH: 78, slotGap: 8, cols: 3, glyph: 0.92,
      /* the name's band at the bottom of a slot, and the glyph's anchor above
         it. A find is drawn from about 20 units ABOVE its anchor to 11 below
         (scenes/props.js, and `drawSill` puts its contact shadow at +11), so
         the anchor is near the base and 'centre it' is the wrong instinct.
         Two rounds of nudging drew the type through the bell before this was
         measured rather than guessed. */
      nameBand: 20, glyphDrop: 30,
      albumRowH: 40, emptyH: 30, closeH: 42, bottomPad: 12,
      /* the WEAR chip on a wearable find's tile. Small: it shares a 115-unit
         slot with a glyph and a name, and it is the third thing in there. */
      chipW: 44, chipH: 20,
      flash: 0.28,
      /* the sill's own hit rect in the room, which is what opens all this.
         Derived from `walk.shelf` rather than typed again — the shelf moved
         once already, and a tap target that has to be kept in step by hand is
         the same class of defect as the ball behind the nav bar. */
      tapPad: [18, 22, 22, 16],
      sfx: { open: 'cue', close: 'pat-soft', put: 'bowl-set', wear: 'perk' },
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

  /* ---- sound (stage 7) ------------------------------------------------
     The DESIGN tunables only. The oscillator frequencies and envelope shapes
     are art data and live in `engine/sfx.js`, by the precedent §11.1(G) set for
     colour ramps: nobody adjusts a formant from a spreadsheet, and moving them
     here would make this file unreadable without making anything tunable. */
  audio: {
    master: 0.62,          // the one output gain. Nintendogs was QUIET.

    /* ---- PLAYING THROUGH THE iPHONE SILENT SWITCH -------------------
       Sound was reported working on the laptop and silent on the iPhone. That
       was NOT a bug: it was the physical ringer switch, which mutes WebAudio in
       Safari exactly as ARCHITECTURE §16.8 says it does. Nothing was broken.

       Overriding it is a deliberate product decision, taken because the
       recipient normally leaves her phone on silent — so the alternative is a
       pet that never makes a sound for the person this game was built for, and
       that reads as broken rather than as respectful. A dog you cannot hear is
       most of the dog missing: the panting, the claw-clicks, his own voice.

       engine/audio.js starts a fraction of a second of generated silence on a
       looping `playsinline` <audio> element inside the same gesture that resumes
       the AudioContext, which moves iOS's audio session from *ambient* (ringer
       switch applies) to *playback* (it does not). WebAudio then rides along.

       WHAT MAKES THIS SAFE TO DO. The in-game toggle is the authority: sound off
       RELEASES the session rather than muting it, and that choice persists in
       `state.settings.sound`. Going hidden releases it too. It starts only from
       a real gesture and it plays silence, so there is no moment the game makes
       a noise she did not ask for. Set false to hand the switch back. */
    overrideSilentSwitch: true,
    /* the silence itself, generated in code — no asset, no fetch, no precache
       entry. A quarter second at 8kHz mono 8-bit is ~2KB of base64. */
    silentSession: { seconds: 0.25, rate: 8000 },
    lead: 0.012,           // schedule this far ahead of `currentTime`; a sound
                           // scheduled at exactly `now` can start mid-buffer
                           // and click on the attack
    /* a limiter after the master, so a dozen overlapping voices sound loud
       rather than broken on a phone speaker */
    limiter: { threshold: -9, knee: 7, ratio: 6, attack: 0.004, release: 0.16 },
    maxVoices: 22,         // recipes allowed in flight per `window` seconds
    window: 0.35,
    /* PER-NAME RETRIGGER FLOOR, in seconds. Petting fires on every tap and a
       stroke can tap faster than an ear enjoys; without this the pats
       machine-gun. A trailing '-' matches a whole family. */
    throttle: {
      default: 0.035,
      'pet-': 0.085,
      'grumble-': 0.20,
      scamper: 0.26,
      crunch: 0.10,
      lap: 0.11,
      perk: 0.14,
      cue: 0.06,
      shake: 0.30,
      suds: 0.34,
      scrub: 0.16,
      brush: 0.16,
      'water-on': 0.60,
      'water-pour': 0.40,
      pant: 0.9,
    },
    /* per-name / per-family gain trims, for when one sound is a hair loud in
       the mix and nothing else should move */
    gain: { pet: 1.0, grumble: 1.0, trick: 1.0 },

    /* ---- PER-DOG VOCAL IDENTITY ------------------------------------
       Research §1.9: pitch-shifting a shared bank per dog "does enormous work
       for individuality at near-zero asset cost". These are the spreads two
       different dogs can sit apart by; the value for a given dog is derived
       from his persisted id, so it is stable for ever and costs no save field.
       `semis` is the headline: ±4.5 semitones is most of an octave of range
       across dogs while keeping every one of them sounding like a puppy. */
    voice: {
      semis: 4.5,          // ± semitones of larynx pitch
      bright: 0.22,        // ± formant placement (a small dog is not just high)
      raspLo: 0.10, raspHi: 0.42,    // how much breath is in his voice
      wobLo: 0.35, wobHi: 1.25,      // vibrato depth, most audible in a whine
      lenLo: 0.90, lenHi: 1.12,      // speech rate, so two yips never share a grid
    },

    /* CONTENTED PANTING. Research §1.9 names it and no existing layer asked for
       it, so `scenes/room.js` emits it off the rig's own `drive.pant` channel.
       Sparse on purpose: this is the one sound that repeats without her doing
       anything, which makes it the one sound that can become irritating. */
    pant: { enabled: true, at: 0.34, every: [2.6, 4.8], gain: 0.85 },
  },

  /* ---- installing to the home screen (stage 7) ------------------------
     NOT a growth banner. iOS ITP deletes all script-writable storage after
     seven days of Safari use without a visit, and installed web apps are
     exempt — so this is the mitigation for the highest-severity risk in the
     project (docs/PLATFORM-RISKS.md Risk 1), and the copy says so honestly.
     Every number here exists to stop it ever nagging. */
  install: {
    maxShows: 2,           // TOTAL, for the lifetime of the save. Not per week.
    /* WHEN. Naming him is the moment she has something to lose, so that is the
       floor — but the first launch is a one-shot moment (GIFT-READY §4: "no UI
       clutter, no tutorial in front of it"), so the first ask waits a long time
       and lets her have the dog to herself first.
       An EARLIER draft gated this on `affection >= 0.34`, which was wrong in a
       way worth recording: affection is metered per session and per day (§12.1),
       so 0.34 is about four days of play — i.e. the prompt would have arrived
       AFTER the seven-day storage window it exists to beat. The gate that
       protects a save must not be slower than the thing that deletes it. */
    firstDelay: 80,        // seconds in-scene on the FIRST launch
    delay: 22,             // seconds in-scene on any later launch
    gapDays: 3,            // days between the first showing and the second
    /* The card, in virtual units. `h` is generous on purpose: at 178 the
       "Tap Share, then Add to Home Screen" line — the only ACTIONABLE line on
       the card — ran underneath the buttons and was unreadable. Caught by
       rendering it and looking; invisible in any amount of state inspection. */
    card: { w: 318, h: 216, y: 186, r: 22, pad: 22, btnH: 40, btnGap: 9 },
    fade: 0.42,            // seconds to slide/fade in and out
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
