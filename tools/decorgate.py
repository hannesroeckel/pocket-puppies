"""
tools/decorgate.py — SHE EARNS SOMETHING AND THE ROOM CHANGES.

Queue item 2's other half. Room decoration was asked for twice, correctly kept
OUT of the shop both times — "sell objects for coins, gate content on care
points" — and both times the redirection was written down and not acted on, which
left one decor row on the ladder and the request unmet rather than refused.

WHAT IT ASSERTS:

  A  IT IS EARNED, NOT BOUGHT. Ten million coins buys neither, at any price, and
     nothing about the purse moves the ladder.

  B  IT APPEARS, IN PIXELS. Each unlock changes the BAKED room art — the wall for
     the garland, the shelf for the portrait — and below its threshold it does
     not. Asserted on the pixels of the prebuilt canvas, because "an earned
     reward that does nothing is worse than one never promised" (17.5) and a
     `swatch` in a table is not a room.

  C  IT ARRIVES ON THE FRAME IT IS EARNED. The room is baked once and cached, so
     the reward has to force a rebuild rather than waiting for a remount — and
     it must say WHICH thing arrived, not that something did.

  D  THE PORTRAIT IS OF HIM. It is painted from `breed.palette`, so a Schnoodle's
     portrait and a Cockapoo's differ, and SWITCHING DOGS repaints it — without
     announcing an unlock she did not just earn.

  E  THE LADDER READS IN ORDER, ascending by cost, because the kennel draws it in
     array order and a 150 sitting under a 220 is a table nobody can read.

Usage:  py tools/decorgate.py [--shots]
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


# A REGION OF THE BAKED ROOM CANVAS, counted in changed pixels.
#
# The room is drawn once into an offscreen canvas and blitted, so this reads that
# canvas rather than the screen: it is the thing the unlock is supposed to
# change, and it is free of the dog, the props and the animation that made
# measuring the accessory such a nuisance (29.5).
REGION = """([what, region]) => {
  const pp = window.__pp;
  const g = pp.app.game;
  const sc = pp.loop.scene;
  const px = () => {
    const cv = sc.roomCanvas;
    if (!cv) return null;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const v = pp.app.view;
    const sx = Math.round((region[0] * v.vs + v.offX) * v.dpr);
    const sy = Math.round((region[1] * v.vs + v.offY) * v.dpr);
    const sw = Math.round(region[2] * v.vs * v.dpr);
    const sh = Math.round(region[3] * v.vs * v.dpr);
    return { d: ctx.getImageData(sx, sy, sw, sh).data, box: [sx, sy, sw, sh] };
  };
  const diff = (a, b) => {
    let n = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (Math.abs(a[i] - b[i]) + Math.abs(a[i+1] - b[i+1]) + Math.abs(a[i+2] - b[i+2]) > 12) n++;
    }
    return n;
  };
  /* below the threshold */
  pp.setCarePoints(0);
  sc.rebuildRoom();
  const before = px();
  const lockedShows = g.isUnlocked(what);
  /* and above it */
  const need = pp.BALANCE.economy.unlocks.find((u) => u.id === what).at;
  pp.setCarePoints(need);
  sc.rebuildRoom();
  const after = px();
  return {
    need, lockedShows, unlockedShows: g.isUnlocked(what),
    changed: diff(before.d, after.d), box: before.box,
  };
}"""


def main():
    shots = "--shots" in sys.argv
    url = serve()
    with sync_playwright() as p:
        b = browser(p)
        errors = []
        ctx, pg = page(b, inset=40)
        pg.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
        pg.on("console", lambda m: errors.append("console.%s: %s" % (m.type, m.text))
              if m.type in ("error", "warning") and "willReadFrequently" not in m.text else None)
        boot(pg, url)
        pg.evaluate("() => __pp.app.game.setFlag('installNever', true)")
        pg.evaluate("() => __pp.skipIntro('Pip')")

        # ---- E. the ladder ------------------------------------------------
        ladder = pg.evaluate("() => __pp.BALANCE.economy.unlocks.map((u) => [u.id, u.at, u.kind])")
        ats = [r[1] for r in ladder]
        check(ats == sorted(ats), "the ladder reads in ascending order", ladder)
        decor = [r[0] for r in ladder if r[2] == "decor"]
        check(len(decor) == 3, "there are three decor rows on it now", decor)

        # ---- A. earned, not bought ----------------------------------------
        bought = pg.evaluate("""() => {
          const g = __pp.app.game;
          g.addCoins(10000000);
          const out = {};
          for (const id of ['garland', 'portrait']) out[id] = g.buyItem(id);
          return {
            claimed: Object.keys(out).filter((k) => out[k] && out[k].ok === true),
            garland: g.isUnlocked('garland'), portrait: g.isUnlocked('portrait'),
            coins: g.coins, care: g.carePoints,
          };
        }""")
        check(not bought["claimed"] and not bought["garland"] and not bought["portrait"],
              "ten million coins buys neither the garland nor the portrait", bought)

        # ---- B. it appears, in pixels -------------------------------------
        # the wall above the window for the garland; the shelf for the portrait
        for what, region, where in (
            ("garland", [0, 100, 390, 80], "the wall above the window"),
            ("portrait", [30, 150, 120, 110], "the picture on the shelf"),
        ):
            m = pg.evaluate(REGION, [what, region])
            check(not m["lockedShows"], "%s is locked below %s care points" % (what, m["need"]))
            check(m["unlockedShows"], "%s unlocks at %s" % (what, m["need"]))
            check(m["changed"] > 150,
                  "and %s changes %s" % (what, where),
                  "%s pixels of the baked room, in a %sx%s box"
                  % (m["changed"], m["box"][2], m["box"][3]))

        # ---- C. it arrives on the frame it is earned ----------------------
        live = pg.evaluate("""() => {
          const pp = window.__pp;
          const g = pp.app.game;
          const sc = pp.loop.scene;
          pp.setCarePoints(0);
          sc.rebuildRoom();
          pp.step(1/60, 4);
          sc.toasts.clear();
          const sigBefore = sc.decorSignature();
          /* she earns it while she is standing in the room, and nothing remounts */
          pp.setCarePoints(150);
          pp.step(1/60, 6);
          return {
            sigBefore, sigAfter: sc.decorSignature(),
            said: sc.toasts.texts.slice(),
          };
        }""")
        check(live["sigAfter"] != live["sigBefore"],
              "earning it rebuilds the room without a remount", live)
        check(any("flag" in t for t in live["said"]),
              "and the room says WHICH thing arrived", live["said"])

        # ---- D. the portrait is of him ------------------------------------
        who = pg.evaluate("""() => {
          const pp = window.__pp;
          const g = pp.app.game;
          const sc = pp.loop.scene;
          pp.setCarePoints(650);
          sc.rebuildRoom();
          pp.step(1/60, 2);
          const first = sc.decorSignature();
          const paletteFirst = sc.rig.breed.palette.coat;
          /* a second dog of another breed, then switch to him */
          const s = g.state;
          const second = JSON.parse(JSON.stringify(s.dogs[0]));
          second.id = 'dog-second'; second.name = 'Biscuit'; second.breedId = 'shiba';
          s.dogs.push(second);
          sc.toasts.clear();
          /* SWITCHING IS TWO STEPS, AND THE SECOND ONE IS THE POINT.
             `__pp.switchDog` only moves `activeDogId`; the RIG is built in
             `scenes/room.js`'s `enter`, and state/game.js says so directly —
             "mutating the id under a live scene would leave one dog's rig
             wearing another dog's state". A gate that skipped the remount read
             the first dog's palette back and called it a failure of the
             portrait. */
          __pp.switchDog('dog-second');
          __pp.app.nav.go('room', { switched: true });
          return { first, paletteFirst };
        }""")
        # the remount is async (`loop.mount` awaits `enter`), so wait for the
        # rig to actually be the other dog rather than counting frames and hoping
        pg.wait_for_function("() => window.__pp.loop.scene.rig"
                             " && window.__pp.loop.scene.rig.breed.id === 'shiba'")
        pg.evaluate("() => __pp.step(1/60, 10)")
        after = pg.evaluate("""() => {
          const sc = __pp.loop.scene;
          return { sig: sc.decorSignature(), coat: sc.rig.breed.palette.coat,
                   said: sc.toasts.texts.slice() };
        }""")
        check(after["sig"] != who["first"],
              "the portrait's signature follows the dog in the room",
              [who["first"], after["sig"]])
        check(after["coat"] != who["paletteFirst"],
              "and the two dogs really are different colours",
              [who["paletteFirst"], after["coat"]])
        check(not any("framed" in t for t in after["said"]),
              "switching dogs repaints it WITHOUT announcing an unlock she did not earn",
              after["said"])

        if shots:
            SHOTS.mkdir(exist_ok=True)
            pg.evaluate("""() => {
              const pp = window.__pp;
              pp.switchDog(pp.app.game.state.dogs[0].id);
            }""")
            pg.evaluate("() => __pp.step(1/60, 20)")
            pg.evaluate("() => { __pp.setCarePoints(0); __pp.loop.scene.rebuildRoom(); __pp.step(1/60, 10); }")
            pg.screenshot(path=str(SHOTS / "decor-none.png"))
            pg.evaluate("() => { __pp.setCarePoints(1200); __pp.loop.scene.rebuildRoom(); __pp.step(1/60, 10); }")
            pg.screenshot(path=str(SHOTS / "decor-all.png"))

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
