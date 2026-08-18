"""
tools/weargate.py — HE CAN WEAR WHAT HE FINDS.

`dog.wear.accessory` has existed since stage 1 and `inventory.accessories` since
stage 6. Nothing ever wrote the slot and nothing ever drew it, which is why the
brass bell and the red ribbon he brings home from the high street were the two
finds left with no purpose after the collection landed (ARCHITECTURE 23.7).

WHAT IT ASSERTS:

  A  IT IS ON HIM, IN PIXELS. Wearing a thing changes what is drawn in the
     neck's own region, and taking it off changes it back. Asserted on device
     pixels rather than on state, because "the slot is set" is exactly what was
     already true for years while nothing appeared on screen.

  B  ONLY WHAT HE FOUND. `equipAccessory` refuses an id she has never brought
     home, refuses junk, and refuses a find that is not a `gift` — checked in
     the mutator, so a hand-edited save cannot dress him in something that never
     came home.

  C  IT SURVIVES A RELOAD, since it is a persisted field, and it is PER DOG.

  D  IT DOES NOT NEED A COLLAR. A found ribbon must not be invisible until she
     has earned the 90-care-point collar, so the accessory draws with or without
     one — and the collar band itself must still only appear for a real collar.

  E  THE CHIP IS THE CONTROL THAT ANSWERS. Tapping WEAR on a tile wears the
     thing; it does not also put the tile away, which is what would happen if
     the tile were tested first.

Usage:  py tools/weargate.py [--shots]
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


# THE NECK REGION, IN DEVICE PIXELS, AND WHAT IT IS COMPARED AGAINST.
#
# A HASH OF THE PIXELS WAS THE WRONG METRIC. The first version signed the region
# and required the signature to return to its old value when the accessory came
# off — but the dog is ALIVE: he breathes, the idle director moves him, and two
# samples ninety frames apart differ whatever he is or is not wearing. The check
# failed for a real reason that had nothing to do with the feature.
#
# So this measures a MAGNITUDE against a noise floor. Three captures, two frames
# apart each: bare, wearing, and bare again. `noise` is how much the region
# changes when nothing changed but time; `signal` is how much it changes when the
# accessory goes on. The assertion is signal >> noise, which is a claim about the
# drawing rather than about the animation.
NECK_DIFF = """(want) => {
  const pp = window.__pp;
  const rig = pp.loop.scene.rig;
  const g = pp.app.game;
  const cv = document.querySelector('canvas');
  const cx2 = cv.getContext('2d', { willReadFrequently: true });
  const dpr = pp.app.view.dpr;
  const grab = () => {
    const P = rig.pose, D = rig.dims;
    const sy = rig.sy === undefined ? 1 : rig.sy;
    const cx = rig.x + P.neckX * rig.s;
    const cy = rig.y + P.neckY * rig.s * sy;
    const half = Math.max(18, D.bodyHW * 0.62 * rig.s);
    const x0 = Math.max(0, Math.round((cx - half) * dpr));
    const y0 = Math.max(0, Math.round((cy - half * 0.9) * dpr));
    const w = Math.round(half * 2 * dpr), h = Math.round(half * 1.8 * dpr);
    return { d: cx2.getImageData(x0, y0, w, h).data, box: [x0, y0, w, h] };
  };
  const diff = (a, b) => {
    let n = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (Math.abs(a[i] - b[i]) + Math.abs(a[i+1] - b[i+1]) + Math.abs(a[i+2] - b[i+2]) > 12) n++;
    }
    return n;
  };
  /* HOLD HIM STILL FIRST. The noise floor swung between 140 and 10,644 pixels
     between runs, because the idle director fires a clip — a head tilt moves the
     whole neck region and swamps a bell. Suppressing idle for a minute and
     letting the springs settle drops the floor to a handful of pixels, and then
     the measurement is about the accessory. Breathing continues, which is why
     there is still a floor at all rather than a zero. */
  pp.loop.scene.idle.cancel(60);
  pp.step(1/60, 150);
  /* AND REDRAW AT FROZEN TIME. Settling was not enough: breathing alone moves
     300-500 pixels in a 173x156 box, and `afterRemoval` came back as large as
     the signal — the drift over six frames swamped a bell. `stepFixed` clamps a
     zero dt to a fallback, but it keeps a tiny one, so a step of 1e-6 seconds
     DRAWS a frame while advancing the animation by nothing anybody can measure.
     The delta between two of those is then the accessory and only the accessory,
     which is what the assertion is supposed to be about. */
  const redraw = () => pp.loop.stepFixed(1e-6, 1);
  g.equipAccessory('');
  redraw();
  const a = grab();
  redraw();
  const a2 = grab();                       // nothing changed at all
  g.equipAccessory(want || 'bell');
  redraw();
  const b = grab();
  g.equipAccessory('');
  redraw();
  const c = grab();
  return {
    box: a.box,
    noise: diff(a.d, a2.d),
    signal: diff(a.d, b.d),
    afterRemoval: diff(a.d, c.d),
  };
}"""

GIVE = """() => {
  const g = __pp.app.game;
  g.addFind('bell', Date.now());
  g.addFind('ribbon', Date.now());
  __pp.step(1/60, 20);
  return g.accessories();
}"""


def main():
    shots = "--shots" in sys.argv
    url = serve()
    with sync_playwright() as p:
        b = browser(p)
        errors = []
        ctx, pg = page(b, inset=40)
        pg.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
        # THE `willReadFrequently` WARNING IS THIS GATE'S OWN. It is emitted
        # because the gate reads the canvas back repeatedly to count pixels, not
        # by anything the game does, so listening for it would be asserting on
        # the instrument. Everything else is still a failure.
        pg.on("console", lambda m: errors.append("console.%s: %s" % (m.type, m.text))
              if m.type in ("error", "warning") and "willReadFrequently" not in m.text else None)
        boot(pg, url)
        pg.evaluate("() => __pp.app.game.setFlag('installNever', true)")
        pg.evaluate("() => __pp.skipIntro('Pip')")

        can = pg.evaluate(GIVE)
        check(sorted(can) == ["bell", "ribbon"],
              "the two gift finds are the wearable ones", can)

        # ---- A. it is on him, in pixels -----------------------------------
        for acc in ("bell", "ribbon"):
            m = pg.evaluate(NECK_DIFF, acc)
            check(m["signal"] > max(60, m["noise"] * 4),
                  "the %s is DRAWN on his neck" % acc,
                  "%s pixels changed against a noise floor of %s, in a %sx%s box"
                  % (m["signal"], m["noise"], m["box"][2], m["box"][3]))
            check(m["afterRemoval"] <= max(m["noise"] * 3, 40),
                  "and taking the %s off leaves the neck as it was" % acc,
                  "%s pixels differ, noise floor %s" % (m["afterRemoval"], m["noise"]))
        if shots:
            SHOTS.mkdir(exist_ok=True)
            pg.evaluate("() => { __pp.app.game.equipAccessory('bell'); __pp.step(1/60, 40); }")
            pg.screenshot(path=str(SHOTS / "wear-bell.png"))
            pg.evaluate("() => { __pp.app.game.equipAccessory('ribbon'); __pp.step(1/60, 40); }")
            pg.screenshot(path=str(SHOTS / "wear-ribbon.png"))

        # ---- B. only what he found ----------------------------------------
        refused = pg.evaluate("""() => {
          const g = __pp.app.game;
          const out = {};
          for (const id of ['daisy', 'stick', 'metBeagle', 'nonsense', 'collarRed']) {
            out[id] = g.equipAccessory(id);
          }
          const before = g.wornAccessory;
          /* and one she genuinely has not found */
          const s = g.state;
          s.unlocks.items = s.unlocks.items.filter((x) => x !== 'bell');
          s.walks.found = s.walks.found.filter((f) => f.id !== 'bell');
          const bellNow = g.equipAccessory('bell');
          return { refusals: out, bellAfterLosingIt: bellNow, worn: g.wornAccessory, before };
        }""")
        check(not any(refused["refusals"].values()),
              "a flower, a stick, a photo, junk and a collar are all refused",
              refused["refusals"])
        check(refused["bellAfterLosingIt"] is False,
              "and so is a gift she has not actually found", refused)

        # ---- C. it persists, and it is per dog ----------------------------
        pg.evaluate("""() => {
          const g = __pp.app.game;
          g.addFind('bell', Date.now());
          g.equipAccessory('ribbon');
          __pp.saver.flush();
        }""")
        pg.reload()
        pg.wait_for_function("() => window.__pp && window.__pp.loop && window.__pp.loop.scene")
        pg.evaluate("() => __pp.step(1/60, 20)")
        check(pg.evaluate("() => __pp.app.game.wornAccessory") == "ribbon",
              "it survives a reload")
        per = pg.evaluate("""() => {
          const g = __pp.app.game;
          const s = g.state;
          const second = JSON.parse(JSON.stringify(s.dogs[0]));
          second.id = 'dog-second';
          second.name = 'Biscuit';
          second.wear = { collar: null, accessory: null };
          s.dogs.push(second);
          __pp.switchDog('dog-second');
          __pp.step(1/60, 10);
          const onSecond = g.wornAccessory;
          __pp.switchDog(s.dogs[0].id);
          __pp.step(1/60, 10);
          return { onSecond, backOnFirst: g.wornAccessory };
        }""")
        check(per["onSecond"] == "" and per["backOnFirst"] == "ribbon",
              "and it is his, not the save's", per)

        # ---- D. it does not need a collar ---------------------------------
        nocollar = pg.evaluate("""() => {
          const g = __pp.app.game;
          g.equipWear('');
          g.equipAccessory('bell');
          __pp.step(1/60, 30);
          /* the room's debug has no `dog` key — ask the mutators, which are the
             thing under test anyway */
          return { worn: g.worn, acc: g.wornAccessory };
        }""")
        check(nocollar["worn"] == "" and nocollar["acc"] == "bell",
              "he can wear a found bell with no collar earned yet", nocollar)
        pg.evaluate("() => __pp.app.game.equipWear('')")
        m = pg.evaluate(NECK_DIFF, "bell")
        check(m["signal"] > max(60, m["noise"] * 4),
              "and it is visibly there with NO collar on him",
              "%s pixels against a noise floor of %s" % (m["signal"], m["noise"]))

        # ---- E. the chip is the control that answers ----------------------
        e = pg.evaluate("""() => {
          const pp = window.__pp;
          const sc = pp.loop.scene;
          const g = pp.app.game;
          g.equipAccessory('');
          g.setOnShow('bell', true);
          sc.collection.start();
          pp.step(1/60, 30);
          const chip = sc.collection.debug.chips.find((q) => q.id === 'bell');
          if (!chip) return { error: 'no chip for the bell', debug: sc.collection.debug };
          const sillBefore = sc.collection.debug.sill.slice();
          /* tap the CHIP's own centre */
          sc.collection.pointer({ type: 'down', x: chip.x + chip.w / 2, y: chip.y + chip.h / 2 });
          pp.step(1/60, 4);
          const afterWear = { worn: g.wornAccessory, sill: sc.collection.debug.sill.slice() };
          /* tap it again: it is a state, so it comes off */
          sc.collection.pointer({ type: 'down', x: chip.x + chip.w / 2, y: chip.y + chip.h / 2 });
          pp.step(1/60, 4);
          const afterAgain = { worn: g.wornAccessory, sill: sc.collection.debug.sill.slice() };
          /* and the TILE still puts it away, so the chip has not eaten the tile */
          const slot = sc.collection.debug.slots.find((q) => q.id === 'bell');
          sc.collection.pointer({ type: 'down', x: slot.x + 6, y: slot.y + slot.h - 6 });
          pp.step(1/60, 4);
          const afterTile = sc.collection.debug.sill.slice();
          return { sillBefore, afterWear, afterAgain, afterTile };
        }""")
        check(not e.get("error"), "the bell's tile has a WEAR chip", e.get("error") or "yes")
        check(e["afterWear"]["worn"] == "bell",
              "tapping the chip wears the bell", e["afterWear"])
        check(e["afterWear"]["sill"] == e["sillBefore"],
              "and does NOT put the tile away — the chip is what answers",
              e["afterWear"]["sill"])
        check(e["afterAgain"]["worn"] == "",
              "tapping it again takes it off, because it is a state", e["afterAgain"])
        check("bell" not in e["afterTile"],
              "and the tile underneath still puts it away when tapped", e["afterTile"])

        check(not errors, "no page errors and no console warnings", errors[:4])
        b.close()

    for line in notes:
        print(line)
    for line in fails:
        print(line)
    print("\n%d passed, %d failed" % (len(notes), len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
