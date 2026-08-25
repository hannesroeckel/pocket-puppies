"""
tools/walkgate.py — HE WALKS OUT, AND THE ROOM SURVIVES IT.

Beat 2.5, the departure: the one thing the whole side-profile effort was for. He
trots out of the room in profile instead of blinking out of it.

WHAT IT ASSERTS, and every one of these is a bug that happened:

  A  HE IS THERE AT THE START. The first render of this beat was an EMPTY ROOM —
     the sprite sheet had not decoded, `sprite.draw` returned false, and nothing
     drew anything instead. The sheet now starts decoding when the lead comes out,
     and the drawn profile stands in if it still is not ready.

  B  ONE DOG PER DEPARTURE. Deciding per frame gave a POP: frame 0 was the drawn
     profile and frame 1 the sprite. The choice is locked when she presses Set off.

  C  HE ACTUALLY TRAVELS, AND ONLY ONE WAY. He starts where he was standing and
     ends off frame, and never moves backwards on the way — a dog who decelerates
     into the doorway has changed his mind.

  D  THERE IS NEVER TWO OF HIM. `hidesDog` must be true for the whole departure,
     or the frontal dog stands on the rug while the profile one walks out.

  E  THE ROOM DOES NOT HAND HIM OUT WHILE HE IS LEAVING. `busy` covers the
     departure, so a tap cannot reach the petting field and stroke a dog who is
     not being drawn.

  F  THE ABSENCE STILL STARTS. `away` becomes true exactly once, when he is gone,
     and the walk's own clock (state/walks.js) is untouched by any of it — the
     departure is inside the walk, not added to it.

  G  LEAVING THE SCENE MID-DEPARTURE IS SAFE. He is simply out.

Usage:  py tools/walkgate.py [--shots]
Exit code 0 = every check passed.
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _drive import serve, browser, page, boot
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = ROOT / "review"
fails, notes = [], []


def check(ok, label, detail=""):
    (notes if ok else fails).append(("PASS" if ok else "FAIL") + "  " + label
                                    + (("  — " + str(detail)) if detail else ""))
    return ok


def main():
    shots = "--shots" in sys.argv
    url = serve()
    with sync_playwright() as p:
        b = browser(p)
        errors = []

        def fresh(breed="schnoodle", wait=900):
            ctx, pg = page(b, inset=40)
            pg.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
            pg.on("console", lambda m: errors.append("console.%s: %s" % (m.type, m.text))
                  if m.type == "error" else None)
            boot(pg, url)
            pg.evaluate("() => __pp.app.game.setFlag('installNever', true)")
            pg.evaluate("() => __pp.skipIntro('Pip')")
            pg.evaluate("(bd) => { __pp.app.game.state.dogs[0].breedId = bd; }", breed)
            pg.evaluate("() => __pp.app.nav.go('room', { switched: true })")
            pg.wait_for_function("() => window.__pp.loop.scene.rig")
            pg.evaluate("() => __pp.step(1/60, 30)")
            pg.evaluate("() => __pp.loop.scene.startWalk()")
            pg.evaluate("() => __pp.step(1/60, 40)")
            # REAL time, not stepped time: an <img> decode needs event-loop turns,
            # and `_drive.PIN` freezes the clock the loop runs on.
            if wait:
                pg.wait_for_timeout(wait)
            return ctx, pg

        # ---- A / B / C / D / E: the departure itself ----------------------
        ctx, pg = fresh()
        walked = pg.evaluate("""() => {
          const pp = window.__pp, sc = pp.loop.scene;
          pp.setOff();
          const d0 = pp.dbg().walk;
          const kinds = new Set([d0.sideKind]);
          const xs = [];
          let hidden = 0, busy = 0, frames = 0;
          /* sample the whole departure */
          for (let i = 0; i < 200 && (pp.dbg().walk.leaving); i++) {
            const d = pp.dbg().walk;
            kinds.add(d.sideKind);
            xs.push(d.leaveU);
            if (sc.walk.hidesDog) hidden++;
            if (sc.walk.busy) busy++;
            frames++;
            pp.step(1/60, 1);
          }
          const after = pp.dbg().walk;
          return {
            kinds: [...kinds], startKind: d0.sideKind, frames,
            hidden, busy, first: xs[0], last: xs[xs.length - 1],
            monotonic: xs.every((v, i) => i === 0 || v >= xs[i - 1]),
            awayAfter: after.away, leavingAfter: after.leaving,
          };
        }""")
        check(walked["frames"] > 40,
              "the departure lasts long enough to watch",
              "%s frames" % walked["frames"])
        check(len(walked["kinds"]) == 1,
              "ONE dog for the whole departure — no swap mid-walk", walked["kinds"])
        check(walked["startKind"] in ("sprite", "drawn"),
              "and it is a real profile dog from frame one", walked["startKind"])
        check(walked["monotonic"] and walked["first"] < 0.1 and walked["last"] > 0.8,
              "he travels one way, from where he stood to off frame",
              "u %.2f -> %.2f, monotonic=%s"
              % (walked["first"], walked["last"], walked["monotonic"]))
        check(walked["hidden"] == walked["frames"],
              "the frontal dog is hidden for every frame of it — never two of him",
              "%s of %s" % (walked["hidden"], walked["frames"]))
        check(walked["busy"] == walked["frames"],
              "and the room counts him busy, so a tap cannot pet a dog who is not drawn",
              "%s of %s" % (walked["busy"], walked["frames"]))
        check(walked["awayAfter"] and not walked["leavingAfter"],
              "when he is gone the absence begins", walked)
        ctx.close()

        # ---- F: the walk's own clock is untouched by the departure --------
        ctx, pg = fresh()
        clock = pg.evaluate("""() => {
          const pp = window.__pp;
          const before = pp.app.game.walkProgress();
          pp.setOff();
          const atStart = pp.app.game.walkProgress();
          let g = 0;
          while (g++ < 300 && pp.dbg().walk.leaving) pp.step(1/60, 1);
          const atEnd = pp.app.game.walkProgress();
          return {
            activeBefore: !!(before && before.active),
            activeAtStart: !!(atStart && atStart.active),
            durAtStart: atStart.active ? atStart.active.dur : null,
            durAtEnd: atEnd.active ? atEnd.active.dur : null,
          };
        }""")
        check(not clock["activeBefore"] and clock["activeAtStart"],
              "the walk starts when she sets off, not when he finishes leaving", clock)
        check(clock["durAtStart"] == clock["durAtEnd"],
              "and the departure adds nothing to its length — it is INSIDE the walk",
              [clock["durAtStart"], clock["durAtEnd"]])
        ctx.close()

        # ---- the Shiba has no sheet and must still walk out ---------------
        ctx, pg = fresh(breed="shiba")
        shiba = pg.evaluate("""() => {
          const pp = window.__pp;
          pp.setOff();
          const d = pp.dbg().walk;
          let g = 0, frames = 0;
          while (g++ < 300 && pp.dbg().walk.leaving) { frames++; pp.step(1/60, 1); }
          return { kind: d.sideKind, frames, away: pp.dbg().walk.away };
        }""")
        check(shiba["kind"] == "drawn",
              "a breed with no sheet walks out as the DRAWN profile", shiba)
        check(shiba["frames"] > 40 and shiba["away"],
              "and its departure is the same length and still starts the absence", shiba)
        ctx.close()

        # ---- G: leaving the scene mid-departure ---------------------------
        ctx, pg = fresh()
        bail = pg.evaluate("""() => {
          const pp = window.__pp, sc = pp.loop.scene;
          pp.setOff();
          pp.step(1/60, 20);
          const mid = pp.dbg().walk.leaving;
          /* out of the scene entirely, the way the back button does it */
          pp.app.nav.go('room', { switched: true });
          return { mid };
        }""")
        pg.wait_for_function("() => window.__pp.loop.scene.rig")
        pg.evaluate("() => __pp.step(1/60, 30)")
        after = pg.evaluate("() => { const d = __pp.dbg().walk; "
                            "return { away: d.away, leaving: d.leaving, "
                            "hides: __pp.loop.scene.walk.hidesDog }; }")
        check(bail["mid"], "control: the departure really was mid-flight")
        check(after["away"] and not after["leaving"],
              "leaving the scene mid-departure means he is simply out", after)
        check(after["hides"], "and the room still knows not to draw him", after)

        if shots:
            SHOTS.mkdir(exist_ok=True)
            pg.screenshot(path=str(SHOTS / "walk-away.png"))
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
