"""
tools/roadsoundgate.py — THE ROAD YOU CAN HEAR (8.32.0).

Asked for directly: *"i also want to add some ambient sounds to the walk,
adapted to the route that is taken"*.

Two layers, and the second is what stops the first becoming furniture: a BED per
road (`engine/sfx.js BEDS`) that says where he is, and sparse one-shot EVENTS
that say something is alive there. `engine/audio.js bed()` is the first
sustained sound this engine has ever held, so most of what is asserted here is
about it being HELD SAFELY rather than about it being audible.

WHAT IT ASSERTS:

  A  FOUR ROADS, FOUR BEDS. Each route resolves to its own bed name and its own
     event list, and the bank can answer every one of them — `audio.pending`
     stays empty, which is the ledger every stage has used to say what the bank
     still owes.

  B  IT IS HELD, AND THEN IT IS LET GO. A bed is live while the road is on
     screen and gone once the road has faded. Checked through all three ways out
     the stroll already has — the way out, leaving the scene, and the walk ending
     underneath it — because a bed that survives any of them is a river playing
     under a living room.

  C  NOTHING PLAYS BEFORE A GESTURE. `bed()` obeys the same no-autoplay rule as
     `play()`: no context, no bed, and no entry in `pending` either, because "we
     were locked" is not a debt.

  D  THE TOGGLE IS STILL THE AUTHORITY. Sound off STOPS every bed rather than
     muting it — a bed behind a zeroed master is inaudible and still running, for
     a player who has just asked for silence.

  E  IT RIDES THE DISSOLVE. The bed's gain follows the road's own fade, so the
     sound arrives and leaves exactly as the picture does, and no event fires
     while the living room is still half the screen.

  F  IT CAN FAIL. A gate that cannot fail is decoration (§27): a bed name the
     bank cannot answer must come back dead AND be recorded as owed.

Usage:  py tools/roadsoundgate.py
Exit code 0 = every check passed.
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _drive import serve, browser, page, boot
from playwright.sync_api import sync_playwright

fails, notes = [], []


def check(ok, label, detail=""):
    (notes if ok else fails).append(("PASS" if ok else "FAIL") + "  " + label
                                    + (("  — " + str(detail)) if detail else ""))
    return ok


ONTO_ROAD = """(route) => {
  const pp = window.__pp;
  if (pp.app.game.walkActive) pp.app.game.cancelWalk();
  pp.loop.scene.startWalk();
  pp.step(1/60, 20);
  pp.setOff(route, 600);
  let g = 0;
  while (g++ < 400 && pp.dbg().walk.leaving) pp.step(1/60, 1);
  pp.step(1/60, 90);
  return pp.dbg().walk.stroll;
}"""


def main():
    url = serve()
    with sync_playwright() as p:
        b = browser(p)
        errors = []

        def fresh():
            ctx, pg = page(b, inset=40)
            pg.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
            pg.on("console", lambda m: errors.append("console.%s: %s" % (m.type, m.text))
                  if m.type == "error" else None)
            boot(pg, url)
            pg.evaluate("() => __pp.app.game.setFlag('installNever', true)")
            pg.evaluate("() => __pp.skipIntro('Pip')")
            pg.evaluate("() => __pp.app.nav.go('room', { switched: true })")
            pg.wait_for_function("() => window.__pp.loop.scene.rig")
            pg.evaluate("() => __pp.step(1/60, 30)")
            return ctx, pg

        # ---- C : NOTHING BEFORE A GESTURE ---------------------------------
        # Taken FIRST, on a page whose context has never been unlocked, because
        # it is the one check that stops existing the moment anything touches
        # the screen.
        ctx, pg = fresh()
        locked = pg.evaluate("""() => {
          const a = __pp.app.audio;
          const before = a.debug.running;
          const h = a.bed('road-park', { gain: 0.5 });
          return { running: before, live: !!h.live, beds: a.bedsLive,
                   pending: a.pending.slice() };
        }""")
        check(not locked["running"],
              "control: the context really is still locked at this point", locked)
        check(not locked["live"] and locked["beds"] == 0,
              "C: NOTHING PLAYS BEFORE A GESTURE — a bed asked for while locked "
              "comes back dead", locked)
        check("road-park" not in locked["pending"],
              "...and it is not recorded as owed either: 'we were locked' is not "
              "a debt the bank has", locked["pending"])

        # unlock the way a thumb does, then take everything else
        pg.evaluate("() => { __pp.app.audio.unlock(); }")
        pg.wait_for_timeout(250)
        ready = pg.evaluate("() => __pp.app.audio.debug.running")

        # ---- A : four roads, four beds ------------------------------------
        model = pg.evaluate("""async () => {
          const sfx = await import('/src/engine/sfx.js');
          const S = __pp.BALANCE.walk.stroll.sound;
          const rows = [];
          for (const r of ['park', 'woods', 'high', 'river']) {
            const cfg = S.road[r];
            rows.push({
              route: r, bed: cfg.bed, of: cfg.of.slice(),
              hasBed: !!sfx.BEDS[cfg.bed],
              hasAll: cfg.of.every((n) => !!sfx.resolve(n)),
            });
          }
          return { rows, beds: sfx.bedNames() };
        }""")
        seen = set()
        for row in model["rows"]:
            check(row["hasBed"], "the bank can answer the %s's bed (%s)"
                  % (row["route"], row["bed"]), row)
            check(row["hasAll"], "...and every one-shot on that road", row)
            seen.add(row["bed"])
        check(len(seen) == 4,
              "A: FOUR ROADS, FOUR DIFFERENT BEDS — no two routes sound the same",
              sorted(seen))
        ctx.close()

        if not ready:
            check(False, "the audio context unlocked, so the rest can be checked",
                  "it did not; every check below would be vacuous")
        else:
            # ---- B / E : held while the road is up, let go when it goes ----
            for route in ("woods", "river"):
                ctx, pg = fresh()
                pg.evaluate("() => { __pp.app.audio.unlock(); }")
                pg.wait_for_timeout(200)
                held = pg.evaluate(ONTO_ROAD, route)
                live = pg.evaluate("() => __pp.app.audio.bedsLive")
                check(held.get("bedLive") and live == 1,
                      "B: the %s's bed is held while the road is on screen" % route,
                      {"bed": held.get("bed"), "live": live})
                check(held.get("bed") == "road-" + route,
                      "...and it is that road's bed, not another one's", held.get("bed"))
                # 300 FRAMES, NOT 120, AND THE DIFFERENCE IS NOT ARBITRARY. The
                # bed is released on the same test the TILE is — "the road has
                # finished fading" — and that spring is at 0.007 after two
                # seconds and 0 after five. Asserting at 120 frames failed while
                # the code was correct, which is a gate measuring its own
                # impatience. The sound is inaudible long before then: the gain
                # rides `solid(w)`, so at w 0.007 it is under a hundredth.
                gone = pg.evaluate("""() => {
                  const pp = window.__pp, sc = pp.loop.scene;
                  const B = pp.BALANCE.ui.map.back;
                  const send = (type) => sc.pointer(pp.app, {
                    type, x: B.x, y: B.y, id: 1, dx: 0, dy: 0, speed: 0, dist: 0, moved: false });
                  send('down'); send('up');
                  pp.step(1/60, 300);
                  const d = pp.dbg().walk.stroll;
                  return { beds: pp.app.audio.bedsLive, on: d.on, w: d.w, tile: !!d.tile };
                }""")
                check(not gone["on"] and gone["beds"] == 0,
                      "B: ...and the way out lets it go — no road playing under "
                      "the living room", gone)
                check(not gone["tile"],
                      "...and the road's BITMAP goes with its sound, on the same "
                      "test — a full-screen canvas is ~14MB and iOS caps the "
                      "total (§32.2)", gone)
                ctx.close()

            # leaving the SCENE mid-stroll is the second way out
            ctx, pg = fresh()
            pg.evaluate("() => { __pp.app.audio.unlock(); }")
            pg.wait_for_timeout(200)
            pg.evaluate(ONTO_ROAD, "high")
            bail = pg.evaluate("""() => {
              const pp = window.__pp;
              const was = pp.app.audio.bedsLive;
              pp.app.nav.go('room', { switched: true });
              pp.step(1/60, 60);
              return { was, now: pp.app.audio.bedsLive };
            }""")
            check(bail["was"] == 1 and bail["now"] == 0,
                  "B: leaving the screen mid-stroll stops the road too", bail)
            ctx.close()

            # ---- D : the toggle is the authority ---------------------------
            ctx, pg = fresh()
            pg.evaluate("() => { __pp.app.audio.unlock(); }")
            pg.wait_for_timeout(200)
            pg.evaluate(ONTO_ROAD, "park")
            off = pg.evaluate("""() => {
              const pp = window.__pp;
              const was = pp.app.audio.bedsLive;
              pp.app.audio.setEnabled(false);
              const now = pp.app.audio.bedsLive;
              pp.app.audio.setEnabled(true);
              return { was, now };
            }""")
            check(off["was"] == 1 and off["now"] == 0,
                  "D: SOUND OFF STOPS THE ROAD rather than muting it — a bed "
                  "behind a zeroed master is still running", off)
            ctx.close()

            # ---- E : the sound rides the dissolve --------------------------
            ctx, pg = fresh()
            pg.evaluate("() => { __pp.app.audio.unlock(); }")
            pg.wait_for_timeout(200)
            ride = pg.evaluate("""() => {
              const pp = window.__pp;
              if (pp.app.game.walkActive) pp.app.game.cancelWalk();
              pp.loop.scene.startWalk();
              pp.step(1/60, 20);
              pp.setOff('river', 600);
              let g = 0;
              while (g++ < 400 && pp.dbg().walk.leaving) pp.step(1/60, 1);
              /* one frame onto the road: the dissolve has barely started */
              pp.step(1/60, 2);
              const early = pp.dbg().walk.stroll;
              pp.step(1/60, 120);
              const settled = pp.dbg().walk.stroll;
              return { earlyW: early.w, earlyNext: early.nextEvent,
                       settledW: settled.w, settledNext: settled.nextEvent };
            }""")
            check(ride["earlyW"] < 0.5 and ride["settledW"] > 0.9,
                  "control: the road really does dissolve in rather than cut", ride)
            check(ride["earlyNext"] > 0,
                  "E: nothing happens on the road while the living room is still "
                  "half the picture", ride)
            ctx.close()

        # ---- F : it can fail ----------------------------------------------
        ctx, pg = fresh()
        pg.evaluate("() => { __pp.app.audio.unlock(); }")
        pg.wait_for_timeout(200)
        bad = pg.evaluate("""() => {
          const a = __pp.app.audio;
          const h = a.bed('road-nowhere');
          return { live: !!h.live, beds: a.bedsLive, pending: a.pending.slice() };
        }""")
        check(not bad["live"] and bad["beds"] == 0,
              "F CONTROL: a bed the bank cannot answer comes back dead", bad)
        check("road-nowhere" in bad["pending"],
              "...and IS recorded as owed, which is how every stage has been told "
              "what the bank still lacks", bad["pending"])
        # and the real names are not in that ledger
        clean = pg.evaluate("""() => {
          const pp = window.__pp;
          const a = pp.app.audio;
          const S = pp.BALANCE.walk.stroll.sound;
          for (const r of Object.keys(S.road)) {
            a.bed(S.road[r].bed).stop();
            for (const n of S.road[r].of) a.play(n);
          }
          return a.pending.filter((n) => n.indexOf('road-') === 0 && n !== 'road-nowhere');
        }""")
        check(clean == [],
              "and NONE of the real road sounds is owed — every bed and every "
              "one-shot resolves", clean)
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
