"""
tools/findsgate.py — EVERY FIND HAS A HOME AND A PURPOSE. Queue item 6.

  "It would be great if the items the dog collects during a walk were also ones
   that one could then use afterwards. Currently, they are only being collected
   in the room without being able to use them. and when the room fills up it
   just gets messy. we also need a storage for these items that hides them from
   the room if wanted."

WHAT IT ASSERTS:

  A  NOTHING IS LITTER. A duplicate of ANY find pays coins, not just a duplicate
     toy — which is what "some finds are real and some are litter" was measuring
     without knowing it. And something new comes first: an owned find is
     weighted down in the roll rather than excluded, so the collection fills up
     without the woods running out of woods things.

  B  THE ROOM IS HERS TO ARRANGE. The sill draws what she has PUT OUT, capped;
     the box holds the rest; tapping moves things either way and it persists. A
     full sill refuses politely instead of pushing the oldest thing off the end.

  C  A PHOTO IS A DOG HE MET. The album names each one and where they met, which
     is the "keepsake with a stated purpose" the queue asked for, and photos no
     longer take an ornament's place on the shelf.

  D  THE SILL OPENS IT. `walk.COPY.shelfSome` was written for this tap in stage 4
     and had never been wired to anything.

  E  IT FITS. Done stays inside the safe area at every inset a shipping phone
     reports — which is also how `setInset` was found to be DEAD for every panel
     in the game, because `loop.resize()` only ever ran on an orientation change.

  F  OLD SAVES KEEP THEIR SHELF. The v8 migration seeds `display` with the same seven
     things the room was already drawing, so nobody's furniture moves.

Usage:  py tools/findsgate.py [--shots]
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


# Give him a plausible haul: five ornaments, two toys, two photos.
GIVE = """(ids) => {
  const g = __pp.app.game;
  for (const id of ids) g.addFind(id, Date.now());
  const d = __pp.dbg();
  return { onShow: g.onShow(), inBox: g.inBox(), album: g.album().map((m) => m.met) };
}"""

OPEN = """() => {
  const sc = __pp.loop.scene;
  const SH = __pp.BALANCE.walk.shelf;
  const T = __pp.BALANCE.ui.collection.tapPad;
  const x = SH.at[0] + 20, y = SH.at[1];
  sc.pointer(__pp.app, { type: 'down', x, y, id: 1, dx: 0, dy: 0, speed: 0, dist: 0, moved: false });
  __pp.loop.stepFixed(1/60, 30);
  return __pp.dbg().collection;
}"""

ORNAMENTS = ['daisy', 'buttercup', 'bluebell', 'pebble', 'feather', 'conker', 'glove', 'bell', 'ribbon']
TOYS = ['stick', 'tennis']
PHOTOS = ['metBeagle', 'metPoodle']


def main():
    shots = "--shots" in sys.argv
    url = serve()
    with sync_playwright() as p:
        b = browser(p)
        ctx, pg = page(b, inset=40)
        errors, requests = [], []
        pg.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
        pg.on("console", lambda m: errors.append("console.%s: %s" % (m.type, m.text))
              if m.type in ("error", "warning") else None)
        pg.on("request", lambda r: requests.append(r.url)
              if not r.url.startswith(url) and not r.url.startswith("data:") else None)
        boot(pg, url)
        pg.evaluate("() => __pp.app.game.setFlag('installNever', true)")
        pg.evaluate("() => __pp.skipIntro('Pip')")

        # ---- A. nothing is litter -----------------------------------------
        dup = pg.evaluate("""() => {
          const B = __pp.BALANCE.walk.find;
          const mk = (fresh, kind) => ({ id: 'x', kind, toy: kind === 'toy' ? 'stick' : '', fresh });
          /* the roller is pure, so ask it directly: two walks over the same
             route, the second one with everything already owned */
          return { dupCoins: B.dupCoins, ownedWeight: B.ownedWeight };
        }""")
        check(dup["dupCoins"] > 0 and dup["ownedWeight"] < 1,
              "a duplicate is worth coins and something new is weighted first", dup)
        rolls = pg.evaluate("""async () => {
          const m = await import('/src/state/walks.js');
          const active = { route: 'park', mix: { park: 1 }, seed: 12345, startedAt: 0, mins: 30, dayCount: 1 };
          const virgin = m.rollFinds(active, 1, { owned: [] });
          const owned = new Set(virgin.finds.map((f) => f.id));
          const again = m.rollFinds(active, 1, { owned });
          return {
            firstCoins: virgin.coins, secondCoins: again.coins,
            firstFresh: virgin.finds.filter((f) => f.fresh).length,
            secondFresh: again.finds.filter((f) => f.fresh).length,
            secondDupes: again.finds.filter((f) => !f.fresh).length,
            secondKinds: again.finds.filter((f) => !f.fresh).map((f) => f.kind),
          };
        }""")
        check(rolls["secondCoins"] > rolls["firstCoins"],
              "walking the same route again pays MORE coins, because duplicates sell",
              rolls)
        check(any(k != 'toy' for k in rolls["secondKinds"]) or rolls["secondDupes"] == 0,
              "and a non-toy duplicate is one of the things that pays", rolls)

        # ---- B. the room is hers to arrange -------------------------------
        got = pg.evaluate(GIVE, ORNAMENTS + TOYS + PHOTOS)
        cap = pg.evaluate("() => __pp.BALANCE.walk.find.onShow")
        check(len(got["onShow"]) == cap,
              "the sill fills to its cap by itself and stops", "%s of %s" % (len(got["onShow"]), cap))
        check(len(got["inBox"]) == len(ORNAMENTS) - cap,
              "the overflow waits in the box instead of pushing the first thing off",
              got["inBox"])
        check(all(i not in got["onShow"] for i in TOYS + PHOTOS),
              "toys and photos do not take an ornament's place on the shelf", got["onShow"])
        # a full sill refuses politely
        full = pg.evaluate("(id) => __pp.app.game.setOnShow(id, true)", got["inBox"][0])
        check(full.get("full") is True and full.get("ok") is False,
              "a full sill refuses rather than silently dropping something", full)
        # tap to put away, tap to put out — and it persists
        away = got["onShow"][0]
        pg.evaluate("(id) => __pp.app.game.setOnShow(id, false)", away)
        check(away in pg.evaluate("() => __pp.app.game.inBox()"),
              "putting something away moves it to the box", away)
        pg.evaluate("(id) => __pp.app.game.setOnShow(id, true)", away)
        check(away in pg.evaluate("() => __pp.app.game.onShow()"),
              "and putting it back out works", away)
        drawn = pg.evaluate("() => { __pp.step(1/60, 2); return __pp.app.game.onShow(); }")
        check(len(drawn) == cap, "the room draws exactly what she has put out", drawn)

        # ---- C. the album -------------------------------------------------
        album = pg.evaluate("() => __pp.app.game.album()")
        check(len(album) == 2, "every dog he has met is in the album", album)
        check(all(a["met"] for a in album), "and each one is named", album)

        # ---- D. the sill opens it -----------------------------------------
        d = pg.evaluate(OPEN)
        check(d["open"], "tapping the sill opens the collection", d["open"])
        check(len(d["sill"]) == cap and len(d["box"]) == len(ORNAMENTS) - cap,
              "and it shows the same arrangement the room does",
              {"sill": d["sill"], "box": d["box"]})
        check(len(d["album"]) == 2, "and the album", d["album"])

        # ---- E. it fits, at every inset -----------------------------------
        for inset in (0, 20, 40, 80):
            c2, p2 = page(b, inset=inset)
            boot(p2, url)
            p2.evaluate("() => __pp.app.game.setFlag('installNever', true)")
            p2.evaluate("() => __pp.skipIntro('Pip')")
            p2.evaluate(GIVE, ORNAMENTS + TOYS + PHOTOS)
            dd = p2.evaluate(OPEN)
            got_inset = p2.evaluate("() => __pp.app.view.safe.bottom / __pp.app.view.vs")
            cl = dd["close"]
            floor = 844 - inset
            check(abs(got_inset - inset) < 1,
                  "inset %s: the panel was told about the home bar" % inset, got_inset)
            check(cl["y"] + cl["h"] <= floor,
                  "inset %s: Done is clear of the home bar" % inset,
                  "bottom %.0f vs floor %s" % (cl["y"] + cl["h"], floor))
            if shots and inset == 40:
                SHOTS.mkdir(exist_ok=True)
                p2.screenshot(path=str(SHOTS / "collection.png"))
                p2.evaluate("() => { const c = __pp.loop.scene.collection;"
                            "  if (c) c.stop(); }")
                p2.evaluate("() => __pp.step(1/60, 40)")
                p2.screenshot(path=str(SHOTS / "collection-room.png"))
            c2.close()

        # ---- F. old saves keep their shelf --------------------------------
        mig = pg.evaluate("""async () => {
          const m = await import('/src/state/save.js');
          const s = JSON.parse(JSON.stringify(__pp.app.game.state));
          s.v = 7;
          delete s.walks.display;
          const got = m.migrate(s);
          return { v: got.v, display: got.walks.display };
        }""")
        # AGAINST `SCHEMA_VERSION`, NOT AGAINST 8. Pinning the number here made
        # this gate fail the moment the next migration landed (v9, the disc
        # game's record) while the product was perfectly correct — the same
        # mistake `timegate` made and had fixed, in a second place nobody
        # checked. A gate that has to be edited on every schema bump is a gate
        # that will be edited wrong.
        now_v = pg.evaluate("async () => (await import('/src/state/game.js')).SCHEMA_VERSION")
        check(mig["v"] == now_v, "a v7 save migrates to the current schema",
              "reached v%s of v%s" % (mig["v"], now_v))
        check(len(mig["display"]) == cap,
              "and keeps a shelf of exactly what the room was already drawing", mig["display"])
        walked = pg.evaluate("""async () => {
          const m = await import('/src/state/save.js');
          const out = {};
          for (let v = 1; v <= 9; v++) {
            const s = JSON.parse(JSON.stringify(__pp.app.game.state));
            s.v = v;
            try { out[v] = m.migrate(s).v; } catch (e) { out[v] = 'threw: ' + e.message; }
          }
          return out;
        }""")
        check(all(v == now_v for v in walked.values()),
              "every older save migrates to v%s" % now_v, walked)

        check(not errors, "no page errors and no console warnings", errors[:4])
        check(not requests, "no external requests", requests[:4])
        b.close()

    for line in notes:
        print(line)
    for line in fails:
        print(line)
    print("\n%d passed, %d failed" % (len(notes), len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
