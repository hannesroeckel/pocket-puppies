"""
tools/sideshots.py — LOOK AT THE PROFILE DOG.

A camera, not a gate. It loads tools/side-preview.html, draws `dog/side.js` at the
same four phases `docs/reference/side-run-cycle.png` shows, and saves the sheet so
the two can be put side by side. That comparison is the only test that matters
for this file: he has to read as the same dog seen from a different side, and no
assertion can tell me whether he does.

Usage:  py tools/sideshots.py [--breed cockapoo] [--scale 1.35] [--muddy|--wet]
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _drive import serve, browser, page
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = ROOT / "review"


def arg(name, default):
    if name in sys.argv:
        v = sys.argv[sys.argv.index(name) + 1]
        try:
            return float(v)
        except ValueError:
            return v
    return default


def main():
    breed = arg("--breed", "cockapoo")
    scale = float(arg("--scale", 1.35))
    url = serve()
    SHOTS.mkdir(exist_ok=True)
    with sync_playwright() as p:
        b = browser(p)
        ctx = b.new_context(viewport={"width": 1774, "height": 887}, device_scale_factor=1)
        pg = ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append("%s: %s" % (m.type, m.text))
              if m.type == "error" else None)
        pg.goto(url + "/tools/side-preview.html")
        pg.wait_for_function("() => !!window.__side")
        # THE COAT STATE IS NOT A HANDFUL OF SCALARS. `drawSoil` needs
        # `coat.regions` — the breed-independent dirt region table out of
        # BALANCE.care.wash — plus a per-region `dirt` array. A synthetic
        # `{dirt: 0.8}` paints nothing at all, which is exactly what the first
        # muddy render showed: a spotless dog and no error anywhere.
        mud = "--muddy" in sys.argv
        soak = "--wet" in sys.argv
        coat = None
        if mud or soak:
            coat = pg.evaluate("""([mud, soak]) => {
              const W = __side.BALANCE.care.wash;
              const n = W.regions.length;
              return {
                regions: W.regions,
                dirt: new Array(n).fill(mud ? 0.85 : 0.12),
                foam: new Array(n).fill(0),
                wet: soak ? 0.9 : 0,
                gloss: 0,
              };
            }""", [mud, soak])
        info = pg.evaluate(
            "([b, s, coat]) => __side.render(b, __side.keys, { scale: s, coat })",
            [breed, scale, coat])
        tag = "-muddy" if mud else ("-wet" if soak else "")
        pg.locator("#cv").screenshot(path=str(SHOTS / ("side-%s%s.png" % (breed, tag))))
        print("breed :", info.get("breed"))
        print("geom  :", info.get("geom"))
        print("errors:", errs[:4] or "none")
        b.close()
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
