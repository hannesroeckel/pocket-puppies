"""
tools/walkshots.py — WATCH HIM LEAVE.

Not a gate. A camera on beat 2.5, the departure: he trots out of the room in
profile instead of blinking out of it, which is the one thing the whole
side-profile effort was for.

  walk-off-0 .. walk-off-4   five frames across the departure
  walk-off-away              the room after he has gone

--breed SUFFIXES THE FILENAMES (`walk-off-corgi-0.png`). It did not, and with
one breed that was fine; with five it meant every run overwrote the last one's
pictures, so two sheets could never be compared side by side — which is the
only way to see that one of them is drawn at a different size or on a different
ground line. The default breed keeps the unsuffixed names so the shots already
in `review/` are replaced rather than joined by a near-duplicate set.

Usage:  py tools/walkshots.py [--breed schnoodle]
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _drive import serve, browser, page, boot
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = ROOT / "review"


def main():
    breed = sys.argv[sys.argv.index("--breed") + 1] if "--breed" in sys.argv else "schnoodle"
    tag = "" if breed == "schnoodle" else "-" + breed
    url = serve()
    SHOTS.mkdir(exist_ok=True)
    with sync_playwright() as p:
        b = browser(p)
        errs = []
        ctx, pg = page(b, inset=40)
        pg.on("pageerror", lambda e: errs.append("pageerror: %s" % e))
        pg.on("console", lambda m: errs.append("console.%s: %s" % (m.type, m.text))
              if m.type == "error" else None)
        boot(pg, url)
        pg.evaluate("() => __pp.app.game.setFlag('installNever', true)")
        pg.evaluate("() => __pp.skipIntro('Pip')")
        # the breed the sheet belongs to
        pg.evaluate("(b) => { __pp.app.game.state.dogs[0].breedId = b; }", breed)
        pg.evaluate("() => __pp.app.nav.go('room', { switched: true })")
        pg.wait_for_function("() => window.__pp.loop.scene.rig")
        pg.evaluate("() => __pp.step(1/60, 30)")

        # THROUGH THE REAL PATH: the lead, the map, Set off. Driving `setOff`
        # directly would skip the routing that decides he is going anywhere.
        started = pg.evaluate("""() => {
          const pp = window.__pp, sc = pp.loop.scene;
          sc.startWalk();
          pp.step(1/60, 40);
          return pp.dbg().walk || {};
        }""")
        print("after the lead:", {k: started.get(k) for k in ("beat", "away")})
        # WAIT FOR THE SHEET ON REAL TIME. `_drive.PIN` freezes `Date.now` and stubs
        # rAF, so stepping the loop does not give an <img> decode a chance to
        # complete — and the walk locks itself to the drawn dog if the sheet is not
        # ready when she sets off. In the real game the lead beat is seconds of wall
        # clock; here it has to be waited for explicitly or this tool would only
        # ever photograph the fallback.
        pg.wait_for_timeout(900)
        # `__pp.setOff` is the harness's own driver and goes through the map's
        # real callback, so the route is chosen the way a finger chooses it
        pg.evaluate("() => __pp.setOff()")
        st = pg.evaluate("() => __pp.dbg().walk || {}")
        print("after set off:", {k: st.get(k) for k in ("beat", "away", "leaving", "sideKind")})

        for i in range(5):
            pg.screenshot(path=str(SHOTS / ("walk-off%s-%d.png" % (tag, i))))
            pg.evaluate("() => __pp.step(1/60, 14)")
        # THE ROAD IS BETWEEN THEM NOW. Beat 2.75 (8.22.0) runs from the moment
        # he is out of the door until he is properly away, so stepping 60 frames
        # here photographed a sunlit park and called it "the room after he has
        # gone". `tools/strollgate.py --shots` is the camera on the road itself;
        # this one is still about the doorway and the quiet room on either side.
        pg.evaluate("() => __pp.strollThrough()")
        pg.evaluate("() => __pp.step(1/60, 60)")
        pg.screenshot(path=str(SHOTS / ("walk-off%s-away.png" % tag)))
        print("final:", pg.evaluate("() => { const d = __pp.dbg().walk || {}; "
                                    "return { away: d.away, off: d.off }; }"))
        print("errors:", errs[:4] or "none")
        b.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
