"""
tools/discshots.py — LOOK AT THE CATCH.

Not a gate. A camera: it drives one real round through `scene.pointer` and saves
a frame at each moment that matters, because "he actually catches it" is a claim
about pixels and the only way to check it is to look.

  disc-01-ready     in her hand, before the flick
  disc-02-rise      the disc climbing, him tracking it
  disc-03-run       him covering ground to get under it
  disc-04-apex      the leap at full height, jaws at the disc
  disc-05-mouth     the disc in his mouth
  disc-06-carry     him back in the middle, still holding it
  disc-07-miss      a throw nobody tapped, lying on the grass

Usage:  py tools/discshots.py [--power 0.8] [--side 1]
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _drive import serve, browser, page, boot
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = ROOT / "review"


def arg(name, default):
    return float(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else default


def main():
    power = arg("--power", 0.85)
    side = arg("--side", 1.0)
    url = serve()
    SHOTS.mkdir(exist_ok=True)
    with sync_playwright() as p:
        b = browser(p)
        errors = []
        ctx, pg = page(b, inset=40)
        pg.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
        boot(pg, url)
        pg.evaluate("() => __pp.app.game.setFlag('installNever', true)")
        pg.evaluate("() => __pp.skipIntro('Pip')")
        # into a round, past the entry panel
        pg.evaluate("""() => {
          const sc = __pp.loop.scene;
          sc.startDisc(); __pp.step(1/60, 30);
          sc.disc.enterRound(); __pp.step(1/60, 150);
        }""")
        pg.screenshot(path=str(SHOTS / "disc-01-ready.png"))

        # THE FLICK, through the scene's own pointer path — the routing bug that
        # shipped 8.16.0 un-flickable is why nothing here calls disc.pointer.
        pg.evaluate("""([power, side]) => {
          const pp = window.__pp, sc = pp.loop.scene, d = pp.dbg().disc;
          sc.disc.throwAt(power, side);
        }""", [power, side])
        pg.evaluate("() => __pp.step(1/60, 18)")
        pg.screenshot(path=str(SHOTS / "disc-02-rise.png"))

        # run until he is actually moving, then shoot
        state = pg.evaluate("""() => {
          const pp = window.__pp;
          let g = 0, best = 0, at = 0;
          while (g++ < 200) {
            const x0 = pp.loop.scene.rig.x;
            pp.step(1/60, 1);
            const dx = Math.abs(pp.loop.scene.rig.x - x0);
            if (dx > best) { best = dx; at = g; }
            if (pp.dbg().disc.untilCatch < 0.30) break;
          }
          return { best: +best.toFixed(2), at, rigX: +pp.loop.scene.rig.x.toFixed(1),
                   homeX: +pp.loop.scene.rig.home.x.toFixed(1),
                   until: +pp.dbg().disc.untilCatch.toFixed(3) };
        }""")
        pg.screenshot(path=str(SHOTS / "disc-03-run.png"))

        # tap on the moment, then walk the leap forward frame by frame and shoot
        # the apex and the first frame he has it
        leap = pg.evaluate("""() => {
          const pp = window.__pp, sc = pp.loop.scene;
          let g = 0;
          while (g++ < 400 && pp.dbg().disc.untilCatch > 0.005) pp.step(1/60, 1);
          sc.pointer(pp.app, { type: 'down', x: 195, y: 520, id: 1,
                               dx: 0, dy: 0, speed: 0, dist: 0, moved: false });
          return pp.dbg().disc;
        }""")
        # the apex: highest hop
        apex = pg.evaluate("""() => {
          const pp = window.__pp;
          let best = -1, i = 0, seen = 0;
          while (i++ < 90) {
            pp.step(1/60, 1);
            const h = pp.loop.scene.rig.springs.hop.x;
            if (h > best) { best = h; seen = i; }
            if (pp.dbg().disc.disc.mouth) break;
          }
          return { hop: +best.toFixed(2), atFrame: seen, mouth: pp.dbg().disc.disc.mouth };
        }""")
        pg.screenshot(path=str(SHOTS / "disc-04-apex.png"))
        pg.evaluate("() => __pp.step(1/60, 6)")
        pg.screenshot(path=str(SHOTS / "disc-05-mouth.png"))
        pg.evaluate("() => __pp.step(1/60, 40)")
        pg.screenshot(path=str(SHOTS / "disc-06-carry.png"))

        # and a throw nobody taps
        miss = pg.evaluate("""() => {
          const pp = window.__pp, sc = pp.loop.scene;
          let w = 0;
          while (w++ < 600 && pp.dbg().disc.phase !== 'ready') pp.step(1/60, 2);
          sc.disc.throwAt(0.8, -1);
          let g = 0;
          while (g++ < 400 && !pp.dbg().disc.disc.down) pp.step(1/60, 1);
          return pp.dbg().disc;
        }""")
        pg.screenshot(path=str(SHOTS / "disc-07-miss.png"))

        print("run      : moved %s units in a frame, peak at frame %s" % (state["best"], state["at"]))
        print("           rig.x %s (home %s)" % (state["rigX"], state["homeX"]))
        print("leap     : %s" % leap.get("leap"))
        print("apex     : %s" % apex)
        print("miss     : %s" % miss.get("disc"))
        print("errors   : %s" % (errors[:3] or "none"))
        b.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
