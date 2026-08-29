"""
tools/walkgate.py — HE WALKS OUT, AND THE ROOM SURVIVES IT.

Beat 2.5, the departure: the one thing the whole side-profile effort was for. He
trots out of the room in profile instead of blinking out of it.

WHAT IT ASSERTS, and every one of these is a bug that happened:

  0  EVERY BREED HAS A SHEET. He drew all three ("all dogs matter"), so no breed
     falls back to the drawn profile any more — and the fallback is asserted to be
     reachable anyway, for a breed added later.

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

  F  THE ABSENCE STILL STARTS, and the walk's own clock (state/walks.js) is
     untouched by any of it — the departure is inside the walk, not added to it.

     WHAT THE STROLL CHANGED HERE, AND WHY THIS FILE MOVED RATHER THAN THE ONE
     BEING TESTED. This gate used to assert `away` the instant the departure
     finished. Beat 2.75 (`dog/stroll.js`, 8.22.0) now sits between them: he
     walks out of the room and onto a road she can watch, and the absence starts
     when THAT ends. So the assertion is the same claim one beat later — he is
     never left in limbo, and every path out of the departure reaches the
     absence. `tools/strollgate.py` owns the road itself; this file's job is
     still the doorway, and it now checks the handover as well as the exit.

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
          /* AND THEN THE ROAD, AND THEN THE ABSENCE. `strollThrough` runs the
             stroll out without tapping anything, which is also the "she watched
             and touched nothing" case the fallback has to cover. */
          const onRoad = after.stroll.on;
          const done = pp.strollThrough();
          return {
            kinds: [...kinds], startKind: d0.sideKind, frames,
            hidden, busy, first: xs[0], last: xs[xs.length - 1],
            monotonic: xs.every((v, i) => i === 0 || v >= xs[i - 1]),
            awayAfter: after.away, leavingAfter: after.leaving,
            onRoad, awayAfterRoad: done.away, roadOn: done.stroll.on,
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
        check(walked["onRoad"] and not walked["leavingAfter"] and not walked["awayAfter"],
              "when he is out of the door he is on the road, not yet absent",
              walked)
        check(walked["awayAfterRoad"] and not walked["roadOn"],
              "and when the road ends the absence begins — no limbo between them",
              walked)
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

        # ---- EVERY BREED WALKS OUT AS HIS OWN ART ------------------------
        #
        # This assertion used to be the opposite: "a breed with no sheet walks out
        # as the DRAWN profile", tested on the Shiba, which was the one breed he
        # had not drawn. He drew it, so the Shiba is no longer the no-sheet case
        # and nothing in the game is. The invariant worth holding is the one he
        # stated — "all dogs matter" — so it is asserted directly.
        # THE BREED LIST CAME FROM A TYPED-OUT LITERAL, AND SAID "EVERY" (8.26.0).
        # It read `pp.app.breeds`, which is assigned NOWHERE — `BREED_IDS` is
        # published as `__pp.breeds` (main.js ~405), the way bowlgate, breedproof
        # and dogalone all read it. So the `||` fell through on every run since
        # this check was written and "EVERY breed in the game has a sheet" was
        # really "these three breeds I typed have a sheet". The Corgi and the
        # Golden were never in it.
        #
        # That is §35's defect exactly — a hardcoded breed list hiding a breed —
        # living inside the gate that exists to catch it. So the list is read from
        # the game AND the fallback is now a FAILURE rather than a silent default:
        # a gate may not quietly test less than it claims.
        ctx, pg = fresh()
        every = pg.evaluate("""async () => {
          const pp = window.__pp;
          const mod = await import('/src/dog/sidesprite.js');
          const ids = pp.breeds || [];
          return {
            ids,
            fromTheGame: Array.isArray(pp.breeds) && pp.breeds.length > 0,
            missing: ids.filter((id) => !mod.hasSideSprite(id)),
            /* AND THE FALLBACK IS STILL REACHABLE. With every breed covered, the
               drawn path has no breed to exercise it — so the question becomes
               whether it would still answer for a breed added later. */
            unknownFallsBack: mod.hasSideSprite('nosuchbreed') === false,
          };
        }""")
        check(every["fromTheGame"] and len(every["ids"]) >= 3,
              "the breed list came from the GAME, not from a literal in this file",
              every["ids"])
        check(not every["missing"],
              "EVERY breed in the game has a sheet of his own art", every)
        check(every["unknownFallsBack"],
              "and a breed with no sheet would still fall back to the drawn profile",
              every["unknownFallsBack"])

        # ---- AND EACH SHEET IS ANIMATED AS THE KIND OF THING IT IS -------
        #
        # The first three sheets are stand/step/stand/bound and the last two are a
        # four-frame alternating walk. `dog/sidesprite.js` adds the vertical bob
        # itself (every frame is drawn flat on one ground line), so a bound's
        # single lift applied to a walk sheet floats him for two frames and sinks
        # him for two, unrelated to his legs.
        #
        # ASSERTED ON THE DRAWN PIXELS, not on the config. Within one frame index
        # the sprite image cannot change, so any movement of the top of his ink IS
        # the bob — which makes "two lifts per cycle" measurable rather than
        # merely configured. A walk sheet spends exactly half a hump in each
        # quarter-cycle, so all four quarters swing by the same amount; a bound
        # sheet spends one whole hump across four, so they cannot.
        gaits = pg.evaluate("""async () => {
          const mod = await import('/src/dog/sidesprite.js');
          const W = 900, H = 700;
          const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
          const ctx = cv.getContext('2d', { willReadFrequently: true });
          const out = [];
          for (const id of (window.__pp.breeds || [])) {
            const sp = mod.createSideSprite({ breed: { id }, s: 1 });
            if (!sp) continue;
            await new Promise((r) => { const t = setInterval(() => {
              if (sp.ready || sp.failed) { clearInterval(t); r(); } }, 25); });
            if (!sp.ready) { out.push({ id, err: 'never decoded' }); continue; }
            const per = {};
            for (let i = 0; i < 64; i++) {
              const ph = i / 64;
              ctx.clearRect(0, 0, W, H);
              sp.draw({ ctx }, { x: W / 2, y: H - 60, s: 1.2, face: -1,
                                 phase: ph, run: 1, alpha: 1 });
              const d = ctx.getImageData(0, 0, W, H).data;
              let top = -1;
              for (let y = 0; y < H && top < 0; y++)
                for (let x = 0; x < W; x++)
                  if (d[(y * W + x) * 4 + 3] > 24) { top = y; break; }
              const f = sp.frameAt(ph, 1);
              (per[f] = per[f] || []).push(top);
            }
            const swing = Object.keys(per).sort().map(
              (f) => Math.max(...per[f]) - Math.min(...per[f]));
            out.push({ id, cycle: sp.cycle, hasStand: sp.hasStand,
                       bob: sp.debug.bob, swing,
                       even: Math.max(...swing) - Math.min(...swing) <= 1 });
          }
          return out;
        }""")
        for gt in gaits:
            if gt.get("err"):
                check(False, "%s: the sheet decoded" % gt["id"], gt["err"])
                continue
            walkish = gt["cycle"] == "walk"
            check(gt["even"] == walkish,
                  "%s: a '%s' sheet lifts %s per cycle, measured off his own pixels"
                  % (gt["id"], gt["cycle"], "twice" if walkish else "once"),
                  {"swing": gt["swing"], "bob": gt["bob"]})
            check(gt["hasStand"] == (gt["cycle"] == "bound"),
                  "%s: and it says whether frame 0 is a real stand" % gt["id"],
                  gt["hasStand"])
        check(len({g.get("cycle") for g in gaits}) == 2,
              "BOTH kinds of sheet are actually present, so neither branch is dead",
              sorted({g.get("cycle") for g in gaits}))

        # each of them actually completes a departure
        for breed in every["ids"]:
            ctx2, pg2 = fresh(breed=breed)
            one = pg2.evaluate("""() => {
              const pp = window.__pp;
              pp.setOff();
              const kind = pp.dbg().walk.sideKind;
              let g = 0, frames = 0;
              while (g++ < 300 && pp.dbg().walk.leaving) { frames++; pp.step(1/60, 1); }
              /* out of the door, down the road, and then out — every breed makes
                 the whole journey, not just the doorway */
              const road = pp.dbg().walk.stroll.on;
              const done = pp.strollThrough();
              return { kind, frames, road, away: done.away };
            }""")
            check(one["kind"] == "sprite" and one["frames"] > 40
                  and one["road"] and one["away"],
                  "%s walks out as the sprite, onto the road, and then is away" % breed,
                  one)
            ctx2.close()
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
