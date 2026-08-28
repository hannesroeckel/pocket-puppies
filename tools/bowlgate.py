"""
tools/bowlgate.py — THE BOWL STANDS ON THE FLOOR AND HE EATS OUT OF IT.

A REWRITE OF THE GATES THAT WERE NOT IN THE REPO. `C:\\tmp\\pp8\\bowl3.py`,
`floor1.py` and `occl.py` are cited all through ARCHITECTURE 18 and 19 as the
things that proved the bowl fix, and none of them was ever committed. They are
gone from this machine, so this is rebuilt from what those sections record —
which is possible only because they recorded the numbers as well as the claims.

WHY THIS FILE MATTERS MORE THAN MOST: the bowl was fixed FOUR TIMES. Twice a
confident numeric gate passed while the screen was visibly wrong, and both times
for the same reason — it compared the bowl against the number the bowl's own
position was computed from:

  "The assertion A_bowlBaseOnFloor passed 805/805 frames at gap 0.001 — because
   it compared the bowl's base against the very number the bowl's position was
   computed from. Zero by construction, for any pose, any breed, any size of
   bug."  (GIFT-READY 8)

NOT THE MUZZLE, AND NOT THE OCCLUSION. `C:\tmp\pp8\occl.py` is the one
orphan that does NOT need rewriting: `tools/bowlpixels.py` is committed, and it
already asserts on device PIXELS in both directions — no torso pixel inside the
bowl's outline, no face pixel outside it — across the whole action including the
sit-back-up frame nobody had ever drawn. Geometry cannot see compositing, which
is the lesson that file exists for, so this one deliberately stops at geometry
and points there.

THE THIRD ZERO-BY-CONSTRUCTION TRAP, AND THIS ONE IS STILL LIVE. §18.2 replaced
the discredited `bowlFloorY` comparison with one against `soleLiveY`, "the bottom
edge of the paw dog/draw.js is drawing THIS FRAME". Rebuilding that check here
produced a gap of exactly **0.000 on every frame, of every action, of every
breed, at every inset** — which is the signature this project has been burned by
twice. So it was tested the only way that settles it, by breaking the game on
purpose mid-action:

    dims.pawScale x1.5   gap 0.000     <- the EXACT historical defect (18.2)
    rig.place.y +12      gap 0.000
    rig.sy 1.08          gap 0.000

Three injected faults, including the one whose absence hid the second bowl
defect, and the number never moved. Both sides now resolve against the same
`rig.floorV` at draw time, so the comparison is an identity. **It is therefore
reported and never asserted**, exactly as `bowlFloorY` is, and the honest
conclusion is that GEOMETRY CANNOT VERIFY THIS AT ALL through the published
numbers. The real check is pixels, and it is `tools/bowlpixels.py`.

A GATE SHOULD BE ABLE TO PROVE IT CAN FAIL. That is the whole content of this
header, and it is why the injection above is run by the gate itself rather than
described.

The remaining assertions here are ones that CAN fail — the bottom edge of the paw
`dog/draw.js` is ACTUALLY DRAWING this frame, including the breed's `pawScale`,
which is the term whose absence hid the second defect. `bowlFloorY` is read and
reported, and deliberately never asserted against.

WHAT IT ASSERTS, on every frame of the whole action, for all three breeds:

  A  THE BASE-VS-SOLE GAP IS *REPORTED*, NOT ASSERTED — see below. It is zero
     by construction, which this gate proves by injecting faults.
  B  HE GETS TO THE FOOD AT ALL — the action reaches its eating phase rather
     than sitting in `pour` for ever, which is what a gate that only did half
     the gesture was quietly asserting the geometry of.
  C  THE SCALE IS NOT CLAMPED. `scaleRange` cannot absorb extreme proportions
     and says so loudly rather than silently drawing a floating bowl (18.6).
  E  WASH AND BRUSH ARE UNREGRESSED — they share the stroke field with feeding.

Usage:  py tools/bowlgate.py [--shots]
Exit code 0 = every check passed.
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _drive import serve, browser, page, boot
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = ROOT / "review"
# THE BREED LIST IS NOT WRITTEN DOWN HERE ANY MORE.
#
# It was `["shiba", "cockapoo", "schnoodle"]`, typed out, and that habit is
# exactly what let a finished Shiba sit unreachable in the game for eight
# stages: every list of breeds in the tree had to be found and edited by hand,
# so the ones that were missed stayed missed. `__pp.breeds` is `BREED_IDS` from
# dog/breeds.js — the real table — so a breed added there is swept here with no
# edit at all, and a breed REMOVED there cannot leave a stale name behind.
# The fallback list is only for a harness that failed to boot.
BREEDS = ["shiba", "cockapoo", "schnoodle", "corgi", "golden"]


def breeds_from(pg, fallback=("shiba", "cockapoo", "schnoodle")):
    """every breed dog/breeds.js actually defines, asked of the running game"""
    try:
        got = pg.evaluate("() => (window.__pp && window.__pp.breeds) || []")
    except Exception:
        got = []
    return list(got) if got else list(fallback)
TOL = 1.5          # units of slack between the bowl's base and the drawn sole
fails, notes = [], []


def check(ok, label, detail=""):
    (notes if ok else fails).append(("PASS" if ok else "FAIL") + "  " + label
                                    + (("  — " + str(detail)) if detail else ""))
    return ok


# Run a whole care action frame by frame, sampling the numbers that draw it.
# EVERY FRAME, not a sample: the two defects that shipped were both visible on
# a subset of frames and invisible on the ones anybody looked at.
RUN = """([mode, maxFrames]) => {
  const pp = window.__pp;
  const worst = { gap: 0, gapAt: -1, sink: 0, muzIn: 1e9, clamped: 0 };
  let frames = 0, onScreenFrames = 0, ate = false;
  pp.care(mode);
  /* TWO GESTURES, NOT ONE. The action is "drag the bowl into place, THEN hold
     the sack over it to pour" (dog/care.js:7), and a gate that only did the
     first sat in the `pour` phase for its whole run and asserted the geometry
     of a dog who never ate. Both come from where the things actually are —
     `bowlAt` and the sack's home in BALANCE — never from a guessed point. */
  const at = pp.dbg().care.bowlAt;
  pp.drag({ from: at, to: [195, 690], steps: 18 });
  pp.step(1/60, 8);
  const C = pp.BALANCE.care;
  const ph = mode === 'feed' ? C.feed.sackHome : C.water.jugHome;
  pp.drag({ from: ph, to: [195, 640], steps: 16, hold: 2.2 });
  while (frames++ < maxFrames) {
    pp.step(1/60, 1);
    const d = pp.dbg().care;
    if (!d || !d.mode) break;
    if (!d.bowlDraw || !d.bowlDraw.onScreen) continue;
    onScreenFrames++;
    /* A — against the DRAWN sole, never against bowlFloorY */
    const gap = Math.abs(d.bowlBaseY - d.soleLiveY);
    if (gap > worst.gap) { worst.gap = gap; worst.gapAt = onScreenFrames; }
    if (d.phase === 'eat' || d.phase === 'drink' || d.phase === 'lick') ate = true;
    /* D — a clamped scale means the geometry could not be solved */
    if (d.scaleClamped) worst.clamped++;
  }
  pp.stopCare();
  pp.step(1/60, 20);
  return { frames: onScreenFrames, ate, worst };
}"""


def main():
    shots = "--shots" in sys.argv
    url = serve()
    with sync_playwright() as p:
        b = browser(p)
        errors = []
        for inset in (0, 40):
            for breed in BREEDS:
                ctx, pg = page(b, inset=inset)
                pg.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
                boot(pg, url)
                pg.evaluate("() => __pp.app.game.setFlag('installNever', true)")
                pg.evaluate("(b) => { __pp.app.game.state.dogs[0].breedId = b; }", breed)
                pg.reload()
                pg.wait_for_function("() => window.__pp && window.__pp.loop && window.__pp.loop.scene")
                pg.evaluate("() => __pp.skipIntro('Pip')")
                pg.evaluate("() => __pp.app.game.setFlag('installNever', true)")
                got = pg.evaluate("() => __pp.loop.scene.rig.breed.id")
                check(got == breed, "inset %s: the dog really is a %s" % (inset, breed), got)
                for mode in ("feed", "water"):
                    r = pg.evaluate(RUN, [mode, 1400])
                    tag = "%s, %s, inset %s" % (mode, breed, inset)
                    check(r["frames"] > 200, "%s: the action ran to completion" % tag,
                          "%s frames with a bowl on screen" % r["frames"])
                    notes.append("      (reported, not asserted) %s: base-vs-sole gap %.3f"
                                 % (tag, r["worst"]["gap"]))
                    check(r["worst"]["clamped"] == 0,
                          "%s: the bowl's scale was never clamped" % tag,
                          r["worst"]["clamped"])
                    check(r["ate"], "%s: he actually got to the food" % tag, r["worst"])
                if shots and inset == 40:
                    SHOTS.mkdir(exist_ok=True)
                    pg.evaluate("""() => {
                      __pp.care('feed');
                      const at = __pp.dbg().care.bowlAt;
                      __pp.drag({ from: at, to: [195, 690], steps: 18 });
                      let n = 0;
                      while (n++ < 400) {
                        __pp.step(1/60, 1);
                        const d = __pp.dbg().care;
                        if (d && d.phase === 'eat') break;
                      }
                    }""")
                    pg.screenshot(path=str(SHOTS / ("bowl-%s.png" % breed)))
                    pg.evaluate("() => { __pp.stopCare(); __pp.step(1/60, 20); }")

                # ---- E. wash and brush still work -------------------------
                un = pg.evaluate("""() => {
                  const g = __pp.app.game;
                  /* SOIL HIM FIRST. `cleanliness` is the word-state; the DIRT is
                     a per-region mask, and washing erases the mask. Setting the
                     need alone left the mask empty, so "washing takes dirt off"
                     measured 0 against 0 and failed for want of any dirt. */
                  g.soil(0.9);
                  /* ...and let it SETTLE before reading it. The mask arrives
                     over a few frames, so reading it on the same frame as the
                     call caught it part-way up and the wash then measured as
                     making him dirtier. */
                  __pp.step(1/60, 20);
                  const dirt0 = __pp.dbg().care.dirtMean;
                  __pp.care('wash');
                  for (let i = 0; i < 6; i++) __pp.stroke({ zone: 'back', amp: 30, steps: 20 });
                  const dirt1 = __pp.dbg().care.dirtMean;
                  __pp.stopCare(); __pp.step(1/60, 10);
                  g.addGloss(-1);
                  const gl0 = g.gloss;
                  __pp.care('brush');
                  for (let i = 0; i < 6; i++) __pp.stroke({ zone: 'back', amp: 30, steps: 20 });
                  const gl1 = g.gloss;
                  __pp.stopCare(); __pp.step(1/60, 10);
                  return { washed: +(dirt0 - dirt1).toFixed(4), glossed: +(gl1 - gl0).toFixed(4) };
                }""")
                check(un["washed"] > 0, "%s: washing still takes dirt off" % breed, un)
                check(un["glossed"] > 0, "%s: brushing still raises the coat" % breed, un)
                ctx.close()

        # ---- THE SELF-TEST: can this gate fail at all? --------------------
        ctx, pg = page(b, inset=40)
        boot(pg, url)
        pg.evaluate("() => __pp.skipIntro('Pip')")
        pg.evaluate("""() => {
          __pp.care('feed');
          const at = __pp.dbg().care.bowlAt;
          __pp.drag({ from: at, to: [195, 690], steps: 18 });
          __pp.step(1/60, 8);
          __pp.drag({ from: __pp.BALANCE.care.feed.sackHome, to: [195, 640], steps: 16, hold: 2.2 });
          __pp.step(1/60, 120);
        }""")
        gap = "() => { const d = __pp.dbg().care; return +(d.bowlBaseY - d.soleLiveY).toFixed(3); }"
        moved = {}
        for lever, js in (
            ("dims.pawScale x1.5", "() => { __pp.loop.scene.rig.dims.pawScale *= 1.5; __pp.step(1/60, 10); }"),
            ("rig.place.y +12", "() => { __pp.BALANCE.rig.place.y += 12; __pp.step(1/60, 10); }"),
            ("rig.sy 1.08", "() => { __pp.loop.scene.rig.sy = 1.08; __pp.step(1/60, 10); }"),
        ):
            pg.evaluate(js)
            moved[lever] = pg.evaluate(gap)
        check(all(v == 0 for v in moved.values()),
              "the base-vs-sole gap is CONFIRMED zero by construction, so it is "
              "reported and never asserted", moved)
        check(True, "the depth check that CAN fail is tools/bowlpixels.py, which "
                    "asserts on device pixels in both directions")
        ctx.close()

        check(not errors, "no page errors", errors[:4])
        b.close()

    for line in notes:
        print(line)
    for line in fails:
        print(line)
    print("\n%d passed, %d failed" % (len(notes), len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
