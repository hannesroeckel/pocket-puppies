"""
tools/breedproof.py — THE EATING GEOMETRY HOLDS FOR BREEDS NOBODY HAS DRAWN.

THE LAST CITED-BUT-MISSING GATE. `C:\\tmp\\pp8\\breedproof.py` is cited in
ARCHITECTURE §17.2 and §18.6 as the proof that the stoop is derived from SHARES
of each dog's own proportions rather than from absolute units measured on the
Shiba. It was never committed and it is gone from this machine, so this is
rebuilt from what those sections record — which is only possible because they
recorded the numbers as well as the claims (§27).

WHAT §17.2 ACTUALLY CLAIMS, and it is not "the bowl is in the right place":

    was `headDown: 74` (units)      is `headDownShare` (a share of THIS dog's
                                       own head-to-belly room)
    was `placedScale: 1.15`         is derived from the muzzle
    —                               `headMaxShare`, a hard ceiling clamped
                                       WHERE THE VALUE IS USED
    —                               `bobPeak`, the deepest frame of a bite,
                                       which the ceiling must budget for

The consequence, and the thing this file exists to check, is that THE HEAD NEVER
SINKS INTO THE BELLY — on any frame, for any proportions. §17.2 records that the
first version budgeted the bob at SOLVE time by subtracting a guess from the
ceiling, and that this left a chest 25% shallower than the Shiba's with **0.8
virtual units** of clearance at the bottom of a bite: "a bound that holds for the
dog you tested is not a bound." The fix was to clamp the TOTAL at APPLY time
(`dog/care.js`: `const down = Math.min(headDrop() + bite * cfg.bobDepth,
maxHeadDrop())`). That clamp is what this gate is really watching.

WHY IT MUTATES THE BREED TABLE RATHER THAN CALLING `__pp.solveFor()`. `solveFor`
exists and runs the real solve against arbitrary proportions — but it is a PURE
SOLVE. It answers "what would the arithmetic decide", not "what did the renderer
actually draw", and §18.2's whole defect was the arithmetic and the renderer
disagreeing about where the floor was while both were self-consistent. So this
gate mutates `BREEDS[id].proportions` in the live page, remounts the room so
`createRig` rebuilds `dims` from it, VERIFIES THE RIG PICKED THE CHANGE UP
(`rig.dims` / `rig.headRoom` must move, and the gate fails if they do not), then
drives a REAL feed and reads the numbers `dog/draw.js` is drawing from:

    headBottom = rig.y + (rig.pose.headY + rig.dims.headHH) * rig.s * rig.sy
    bodyBottom = rig.y + (rig.pose.bodyY + rig.pose.bodyHH) * rig.s * rig.sy

`draw.js` uses `D.headHH` (dims — the head is not squashed) and `P.bodyHH`
(pose — the body is), which is why those two are read from different objects; and
the conversion to room space is the same one `care.debug.soleLiveY` uses, `rig.y +
local * rig.s * sy`, so the number is in the same units §18.5 quoted.

TWO GESTURES, NOT ONE. The action is "drag the bowl into place, THEN hold the
sack over it to pour" (`dog/care.js`), and a gate that only does the first sits in
the `pour` phase for its whole run and measures the geometry of a dog who never
ate. Both points come from where the things actually are — `dbg().care.bowlAt`
and `BALANCE.care.feed.sackHome` — never from a guessed point. Copied from
`tools/bowlgate.py`'s `RUN`, deliberately, because that is the lesson it paid for.

AND HE IS MADE HUNGRY FIRST. Without `setNeed('hunger', 0.12)` he eats a short
meal and the run collects ~90 eating frames; hungry, it collects ~530. The
assertion is over EVERY frame, so a short meal is a smaller sample making the
same claim — which §27.4 says is exactly what a gate may not do quietly.

-------------------------------------------------------------------------------
THIS GATE CAN FAIL, AND IT IS RUN THE OTHER WAY ROUND TO PROVE IT (§27.4)
-------------------------------------------------------------------------------
The rule from §27 is that a gate which cannot be made to fail is zero by
construction and must be demoted to a reported number. So the head-vs-belly
assertion is tested by breaking the dog on purpose, and the results are MEASURED,
not asserted from the armchair (numbers are the schnoodle at inset 40):

    injected fault                            worst clearance
    ------------------------------------------------------------------
    (none)                                          +32.1     PASS
    anchors.neckOverlap x8                          -17.9     CAUGHT
      a breed whose neck swallows its own chest: the head-to-belly room
      goes NEGATIVE (-8 standing), so there is no budget to spend and the
      head bottom is already below the belly bottom. A pure breed-data
      fault, through the same mutate-and-remount path the gate uses.
    headDownShare = headMaxShare = 1.35            -37.1     CAUGHT
      spending 135% of a budget of 100% — the §17.2 failure mode stated
      as directly as it can be stated.

    bobDepth x20   (a CONTROL that must NOT fail)  +29.7     HOLDS
      the deepest bite gets 20x deeper and the clearance falls by 1.5
      units and then STOPS, because `maxHeadDrop()` catches it at apply
      time. This is the positive evidence that the clamp §17.2 describes
      is in the path and is load-bearing, rather than the assertion
      passing because nothing ever pushes on it.

So the number moves, in both directions, for the right reasons. It is asserted.

-------------------------------------------------------------------------------
WHAT IS ASSERTED, AND WHAT IS ONLY REPORTED
-------------------------------------------------------------------------------
  A  THE HEAD NEVER SINKS INTO THE BELLY, on every frame of the whole action,
     for every breed x distortion. Asserted. Proven able to fail, above.
  B  HE GETS TO THE FOOD AT ALL — the action reaches its eating phase rather
     than sitting in `pour` for ever. Asserted, including for the distortions
     whose scale clamps: a clamped scale is a badly-placed bowl, not a hung
     action, and the two must not be confused.
  C  THE CLAMP IS LOUD, NOT SILENT (§18.6). Where the solved scale falls
     outside `scaleRange`, `care.debug.scaleClamped` must be true on every
     on-screen frame — and where it falls inside, false. A future breed that
     cannot be fed says so instead of floating.
     HONEST LIMIT: `care.js` computes that flag as `|raw - clamp(raw)| > 1e-9`,
     so checking `rawScale` against `scaleRange` is close to restating its own
     line. What it does buy is that the flag is REACHED and PUBLISHED under
     proportions that break it, and that it stays false for all three shipping
     breeds — which is the half `bowlgate.py` covers and the half it does not.
  D  HOW MANY OF THE NINE DISTORTIONS CLAMP. Reported, never asserted: §18.6
     records six of nine, but that count is a property of the distortion
     magnitudes chosen here, and this file's magnitudes are not the lost
     file's. Printed so the direction of travel is visible.

Usage:  py tools/breedproof.py [--fast] [--breed id]
        --fast   one breed (the schnoodle), feed only
Exit code 0 = every check passed.
"""
import sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _drive import serve, browser, page, boot
from playwright.sync_api import sync_playwright

BREEDS = ["shiba", "cockapoo", "schnoodle"]

# ---------------------------------------------------------------------------
# THE NINE SYNTHETIC DISTORTIONS. Every one is a MULTIPLIER on the breed's own
# authored value, never an absolute — a distortion written in absolute units
# would be the exact mistake §17.2 is about, committed by the thing testing it.
# `p` multiplies a top-level proportion; `a` multiplies an entry in `anchors`.
# ---------------------------------------------------------------------------
DISTORTIONS = [
    ("longMuzzle",  {"muzzleH": 2.00, "muzzleW": 1.50}, {}),
    ("shortMuzzle", {"muzzleH": 0.40, "muzzleW": 0.60}, {}),
    ("tallBody",    {"bodyH": 1.50}, {}),
    ("squatBody",   {"bodyH": 0.55}, {}),
    ("hugeHead",    {"headScale": 1.50}, {}),
    ("tinyHead",    {"headScale": 0.55}, {}),
    ("longLegs",    {"legLen": 2.20}, {}),
    ("shortLegs",   {"legLen": 0.35}, {}),
    ("combined",    {"headScale": 1.45, "muzzleH": 1.90, "muzzleW": 1.40,
                     "bodyH": 0.58, "legLen": 0.40}, {}),
]

fails, notes, reports = [], [], []


def check(ok, label, detail=""):
    (notes if ok else fails).append(("PASS" if ok else "FAIL") + "  " + label
                                    + (("  — " + str(detail)) if detail else ""))
    return ok


# ---------------------------------------------------------------------------
# APPLY A DISTORTION AND REBUILD THE RIG FROM IT.
#
# The original values are stashed on `window.__ppOrig` the first time a breed is
# touched and EVERY key is restored from that stash before the new multipliers
# go on. The first cut restored only the keys it was about to change, so the
# distortions accumulated silently down the list and case nine was measuring
# cases one-through-nine at once — the numbers looked plausible the whole time,
# which is how that class of bug survives.
#
# The remount is `app.nav.go('room')`, which runs `scenes/room.js`'s `enter` and
# so calls `createRig({ breed: app.game.dog.breedId })` again; `createRig` calls
# `resolveDims` on the LIVE breed object, so the mutation is picked up. `enter`
# is async and `nav.go` does not await it, hence the microtask yield before
# anything is read.
# ---------------------------------------------------------------------------
SET = """async ([id, mul, anch]) => {
  const m = await import('/src/dog/breeds.js');
  const p = m.BREEDS[id].proportions;
  if (!window.__ppOrig) window.__ppOrig = {};
  if (!window.__ppOrig[id]) window.__ppOrig[id] = JSON.parse(JSON.stringify(p));
  const o = window.__ppOrig[id];
  for (const k in o) if (k !== 'anchors') p[k] = o[k];
  for (const k in o.anchors) p.anchors[k] = o.anchors[k];
  for (const k in mul) p[k] = o[k] * mul[k];
  for (const k in anch) p.anchors[k] = o.anchors[k] * anch[k];
  window.__pp.app.game.state.dogs[0].breedId = id;
  window.__pp.app.nav.go('room');
  await new Promise((r) => setTimeout(r, 40));
  window.__pp.step(1/60, 4);
  const rig = window.__pp.loop.scene.rig;
  /* THE SIGNATURE THE CALLER REQUIRES TO HAVE MOVED. It is the WHOLE of
     `rig.dims` plus the muzzle box read back through `rig.breed`, and it is
     deliberately not a hand-picked field or two.

     The first cut compared bodyHH / headHH / legLen / headRoom, and the two
     MUZZLE distortions failed it while visibly working — `muzzleW/H` do not
     go through `resolveDims` at all. `solveEatGeometry` reads
     `proportions.muzzleH` straight off the breed object, so the only proof the
     rig saw a muzzle change is that `rig.breed.proportions` IS the mutated
     object. Reading it back off `rig.breed` proves exactly that, and it is why
     the whole dims blob is hashed rather than four fields anybody picked. */
  return {
    id: rig.breed.id,
    bodyHH: +rig.dims.bodyHH.toFixed(3), headHH: +rig.dims.headHH.toFixed(3),
    legLen: +rig.dims.legLen.toFixed(3), headOffset: +rig.dims.headOffset.toFixed(3),
    /* rig.headRoom is `stance().bodyBottom - stance().headBottom` on THIS dog's
       dims: the single number the whole share system is a share OF. */
    headRoom: +rig.headRoom.toFixed(3),
    sig: JSON.stringify([rig.dims, rig.breed.proportions.muzzleH,
                         rig.breed.proportions.muzzleW,
                         rig.breed.proportions.anchors.neckOverlap]),
  };
}"""

# ---------------------------------------------------------------------------
# ONE WHOLE CARE ACTION, FRAME BY FRAME. Not sampled: both bowl defects that
# shipped were visible on a subset of frames and invisible on the ones anybody
# looked at (§18.2).
# ---------------------------------------------------------------------------
RUN = """([mode, maxFrames]) => {
  const pp = window.__pp;
  /* make him hungry, or the meal is short and the sample is small */
  pp.setNeed('hunger', 0.12); pp.setNeed('thirst', 0.12);
  pp.care(mode);
  const at = pp.dbg().care.bowlAt;
  pp.drag({ from: at, to: [195, 690], steps: 18 });
  pp.step(1/60, 8);
  const C = pp.BALANCE.care;
  const home = mode === 'feed' ? C.feed.sackHome : C.water.jugHome;
  pp.drag({ from: home, to: [195, 640], steps: 16, hold: 2.2 });

  const rig = pp.loop.scene.rig;
  let frames = 0, on = 0, eat = 0, clamped = 0, nonFinite = 0;
  let minAll = 1e9, minAllAt = -1, minEat = 1e9, minEatAt = -1;
  /* THE SETTLED WINDOW. At the shipping `bobDepth` the worst eating frame is
     not the deepest bite — it is one of the first ~20 frames of the phase,
     while the stoop spring is still arriving. That is a real measurement and
     it would be hidden by a single minimum, so the bite regime is tracked
     separately from frame 60 on. The bobDepth control in the self-test is
     what shows the bite taking over once it is big enough to. */
  let minSet = 1e9, minSetAt = -1;
  let geo = null, raw = null, range = null, phases = {};

  while (frames++ < maxFrames) {
    pp.step(1/60, 1);
    const d = pp.dbg().care;
    if (!d || !d.mode) break;              /* the action closed itself */
    on++;
    phases[d.phase] = (phases[d.phase] || 0) + 1;

    /* THE SAME CONVERSION `care.debug.soleLiveY` USES. `sy` is the non-uniform
       vertical squash; it is 1 in the room, and reading it rather than assuming
       it is how the sole check learned to include `pawScale`. */
    const k = rig.s * (rig.sy === undefined ? 1 : rig.sy);
    const headBottom = rig.y + (rig.pose.headY + rig.dims.headHH) * k;
    const bodyBottom = rig.y + (rig.pose.bodyY + rig.pose.bodyHH) * k;
    const clear = bodyBottom - headBottom;
    if (!Number.isFinite(clear)) nonFinite++;
    if (clear < minAll) { minAll = clear; minAllAt = on; }
    /* THE DEEPEST FRAME OF A BITE IS IN HERE BY CONSTRUCTION: every eating
       frame is scanned, and the bob is what makes one of them the deepest.
       That the bob is really what sets this number is not assumed — the
       self-test drives `feed.bobDepth` up and watches it fall. */
    if (d.phase === 'eat' || d.phase === 'drink' || d.phase === 'lick') {
      eat++;
      if (clear < minEat) { minEat = clear; minEatAt = eat; }
      if (eat > 60 && clear < minSet) { minSet = clear; minSetAt = eat; }
    }
    if (d.scaleClamped) clamped++;
    if (geo === null && d.geo) { geo = d.geo; raw = d.rawScale; range = C.stage.scaleRange; }
  }
  pp.stopCare();
  pp.step(1/60, 20);
  return {
    frames: on, eatFrames: eat, clamped, nonFinite, phases,
    minAll: minAll > 1e8 ? null : +minAll.toFixed(3), minAllAt,
    minEat: minEat > 1e8 ? null : +minEat.toFixed(3), minEatAt,
    minSettled: minSet > 1e8 ? null : +minSet.toFixed(3), minSettledAt: minSetAt,
    geo, rawScale: raw, scaleRange: range,
  };
}"""


def drive(pg, bid, name, mul, anch, modes, tag):
    """One distortion: apply it, prove the rig took it, then feed him."""
    d = pg.evaluate(SET, [bid, mul, anch])
    out = []
    for mode in modes:
        r = pg.evaluate(RUN, [mode, 2400])
        lab = "%s / %s / %s" % (tag, name, mode)

        # --- the rig really is the distorted dog ---------------------------
        check(d["id"] == bid, "%s: the dog really is a %s" % (lab, bid), d["id"])

        # --- B. he gets to the food ---------------------------------------
        check(r["eatFrames"] > 0, "%s: he reached the eating phase" % lab,
              "%s frames, phases %s" % (r["frames"], r["phases"]))
        check(r["nonFinite"] == 0, "%s: every frame produced a finite clearance" % lab,
              r["nonFinite"])

        # --- A. the head never sinks into the belly ------------------------
        m = r["minEat"] if r["minEat"] is not None else r["minAll"]
        check(m is not None and m > 0,
              "%s: the head never sank into the belly" % lab,
              "worst clearance %s at eating frame %s of %s (%s frames on "
              "screen); worst once settled %s at eating frame %s"
              % (m, r["minEatAt"], r["eatFrames"], r["frames"],
                 r["minSettled"], r["minSettledAt"]))

        # --- C. the clamp is loud rather than silent -----------------------
        raw, rng = r["rawScale"], r["scaleRange"]
        clamped_expected = raw is None or not (rng[0] - 1e-9 <= raw <= rng[1] + 1e-9)
        if clamped_expected:
            check(r["clamped"] == r["frames"] and r["frames"] > 0,
                  "%s: the scale clamped and SAID SO on every frame" % lab,
                  "rawScale %s outside %s, scaleClamped on %s/%s frames"
                  % (raw, rng, r["clamped"], r["frames"]))
        else:
            check(r["clamped"] == 0,
                  "%s: the scale fitted, and was not reported clamped" % lab,
                  "rawScale %s inside %s" % (raw, rng))
        out.append((name, mode, d, r, clamped_expected))
    return out


def selftest(pg, bid):
    """
    CAN THE HEAD-VS-BELLY ASSERTION FAIL? Two faults that must be caught and one
    control that must not be. Run last, on its own page, because both faults
    leave the game in a state no player can reach.
    """
    lines, caught = [], []
    base = pg.evaluate(SET, [bid, {}, {}])
    r = pg.evaluate(RUN, ["feed", 2400])
    lines.append("      (none)                              clearance %+8.3f  "
                 "over %d eating frames" % (r["minEat"], r["eatFrames"]))
    clean = r["minEat"]

    # 1. a breed whose neck overlap swallows its own chest -> negative room
    d = pg.evaluate(SET, [bid, {}, {"neckOverlap": 8.0}])
    r = pg.evaluate(RUN, ["feed", 2400])
    caught.append(("anchors.neckOverlap x8", r["minEat"], r["minEat"] < 0))
    lines.append("      anchors.neckOverlap x8              clearance %+8.3f  "
                 "(headRoom %s)  %s" % (r["minEat"], base and d["headRoom"],
                                        "CAUGHT" if r["minEat"] < 0 else "NOT CAUGHT"))

    # 2. spend more of the budget than exists — the §17.2 failure mode
    pg.evaluate(SET, [bid, {}, {}])
    pg.evaluate("() => { const c = __pp.BALANCE.care;"
                "  window.__ppBal = { dn: c.headDownShare, mx: c.headMaxShare };"
                "  c.headDownShare = 1.35; c.headMaxShare = 1.35; }")
    r = pg.evaluate(RUN, ["feed", 2400])
    caught.append(("headDownShare = headMaxShare = 1.35", r["minEat"], r["minEat"] < 0))
    lines.append("      headDownShare/headMaxShare = 1.35   clearance %+8.3f  %s"
                 % (r["minEat"], "CAUGHT" if r["minEat"] < 0 else "NOT CAUGHT"))
    pg.evaluate("() => { const c = __pp.BALANCE.care;"
                "  c.headDownShare = window.__ppBal.dn; c.headMaxShare = window.__ppBal.mx; }")

    # 3. THE CONTROL. A 20x bite must cost clearance and then be caught by the
    #    apply-time ceiling — positive evidence that the clamp is in the path.
    pg.evaluate("() => { window.__ppBob = __pp.BALANCE.care.feed.bobDepth;"
                "        __pp.BALANCE.care.feed.bobDepth *= 20; }")
    pg.evaluate(SET, [bid, {}, {}])
    r = pg.evaluate(RUN, ["feed", 2400])
    bob = r["minEat"]
    lines.append("      feed.bobDepth x20 (CONTROL)         clearance %+8.3f  "
                 "%s, and still clear" % (bob, "fell %.3f" % (clean - bob)))
    pg.evaluate("() => { __pp.BALANCE.care.feed.bobDepth = window.__ppBob; }")

    for label, v, ok in caught:
        check(ok, "SELF-TEST: an injected fault (%s) IS caught by the "
                  "head-vs-belly assertion" % label, "clearance %+.3f" % v)
    check(bob > 0 and bob < clean,
          "SELF-TEST (control): a 20x bite costs clearance and is then caught by "
          "the apply-time ceiling, so the §17.2 clamp is in the path",
          "%.3f -> %.3f" % (clean, bob))
    return lines


def main():
    fast = "--fast" in sys.argv
    only = None
    if "--breed" in sys.argv:
        only = sys.argv[sys.argv.index("--breed") + 1]
    breeds = [only] if only else (["schnoodle"] if fast else BREEDS)
    modes = ("feed",) if fast else ("feed", "water")

    t0 = time.time()
    url = serve()
    clampTable, frameTotal, eatTotal, runs = [], 0, 0, 0
    with sync_playwright() as p:
        b = browser(p)
        errors = []
        for bid in breeds:
            ctx, pg = page(b, inset=40)
            pg.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
            boot(pg, url)
            pg.evaluate("() => __pp.skipIntro('Pip')")
            pg.evaluate("() => __pp.app.game.setFlag('installNever', true)")

            # ---- the undistorted breed, as the control line ---------------
            base = pg.evaluate(SET, [bid, {}, {}])
            for row in drive(pg, bid, "asAuthored", {}, {}, modes, bid):
                nm, mode, d, r, exp = row
                frameTotal += r["frames"]; eatTotal += r["eatFrames"]; runs += 1
                clampTable.append((bid, nm, mode, r["rawScale"], exp, r["minEat"],
                                   r["minSettled"], r["frames"], r["eatFrames"]))

            for name, mul, anch in DISTORTIONS:
                for row in drive(pg, bid, name, mul, anch, modes, bid):
                    nm, mode, d, r, exp = row
                    # THE RIG MUST HAVE MOVED. Without this the whole file could
                    # be measuring nine copies of the same undistorted dog and
                    # reporting nine passes (§27.4: derive it, do not type it).
                    check(d["sig"] != base["sig"],
                          "%s / %s: the rig was actually rebuilt from the "
                          "distorted proportions" % (bid, nm),
                          "headRoom %s -> %s, bodyHH %s -> %s, headHH %s -> %s, "
                          "legLen %s -> %s" % (base["headRoom"], d["headRoom"],
                                               base["bodyHH"], d["bodyHH"],
                                               base["headHH"], d["headHH"],
                                               base["legLen"], d["legLen"]))
                    frameTotal += r["frames"]; eatTotal += r["eatFrames"]; runs += 1
                    clampTable.append((bid, nm, mode, r["rawScale"], exp, r["minEat"],
                                       r["minSettled"], r["frames"], r["eatFrames"]))
            ctx.close()

        # ---- can this gate fail? -------------------------------------------
        ctx, pg = page(b, inset=40)
        pg.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
        boot(pg, url)
        pg.evaluate("() => __pp.skipIntro('Pip')")
        pg.evaluate("() => __pp.app.game.setFlag('installNever', true)")
        stlines = selftest(pg, breeds[-1])
        ctx.close()

        check(not errors, "no page errors", errors[:4])
        b.close()

    # ---- the report -------------------------------------------------------
    print("THE HEAD NEVER SINKS INTO THE BELLY — worst clearance per case.")
    print("`worst` is over EVERY eating frame; `settled` skips the first 60, "
          "where the\nstoop spring is still arriving. Frame counts are the ones "
          "actually driven.")
    print("  %-10s %-12s %-6s %9s %9s %9s %6s %6s %s"
          % ("breed", "distortion", "mode", "rawScale", "worst", "settled",
             "frames", "eating", "scale"))
    for bid, nm, mode, raw, exp, m, ms, fr, ef in clampTable:
        print("  %-10s %-12s %-6s %9s %9s %9s %6s %6s %s"
              % (bid, nm, mode, raw, m, ms, fr, ef, "CLAMPED" if exp else "fits"))

    per = {}
    for bid, nm, mode, raw, exp, m, ms, fr, ef in clampTable:
        if nm == "asAuthored" or mode != "feed":
            continue
        per.setdefault(bid, []).append(exp)
    print()
    for bid, v in per.items():
        print("  %s: %d of %d synthetic distortions clamp `scaleRange` "
              "(§18.6 records six of nine)" % (bid, sum(1 for x in v if x), len(v)))
    print("\nSELF-TEST — can the head-vs-belly assertion fail?")
    for line in stlines:
        print(line)
    print("\n%d care actions driven, %d frames with a bowl on screen, "
          "%d of them eating frames" % (runs, frameTotal, eatTotal))
    print("wall time %.1fs\n" % (time.time() - t0))

    for line in notes:
        print(line)
    for line in fails:
        print(line)
    print("\n%d passed, %d failed" % (len(notes), len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
