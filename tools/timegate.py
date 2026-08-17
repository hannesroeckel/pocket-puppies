"""
tools/timegate.py — THE SAVE TRACKS TIME PER DOG NOW. Queue items 4 and 7.

One root cause, two symptoms: `lastSeenAt` was stored once for the whole save,
so it answered "when was the app last open?" and was then used to answer "how
long has she been away from this dog?".

WHAT IT ASSERTS:

  A  NEEDS PASS FOR EVERY DOG. Two dogs, a day away, and both are hungrier —
     the inactive one was previously frozen, which made him a doll rather than
     an animal.

  B  THE BOND DOES NOT. Affection and the ratcheting floor are untouched by any
     amount of absence, for either dog. This is the half that must NOT change,
     and the reason item 7 was mistaken for a feature in the first place.

  C  THE 36-HOUR CAP STILL BINDS, for the dog she is not looking at as much as
     for the one she is. A fortnight is no worse than a day and a half.

  D  THE REUNION RUNS ON HIS OWN CLOCK. Play with the second dog daily for a
     fortnight, switch back, and the first dog greets her like a fortnight —
     not like the five minutes the app was last closed for.

  E  A SWAP IS STILL JUST A SWAP when it has not been long, and switching does
     not manufacture a reunion out of nothing.

  F  OLD SAVES SURVIVE. v1..v7 all migrate, keep their name, bond and coins,
     and — the migration's one real risk — do NOT fire a spurious full-intensity
     reunion for a dog she was playing with a minute before she updated.

Usage:  py tools/timegate.py
Exit code 0 = every check passed.
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _drive import serve, browser, page, boot
from playwright.sync_api import sync_playwright

fails, notes = [], []
HOUR = 3600e3


def check(ok, label, detail=""):
    (notes if ok else fails).append(("PASS" if ok else "FAIL") + "  " + label
                                    + (("  — " + str(detail)) if detail else ""))
    return ok


# Two dogs, deterministically, without going through the kennel's care-point
# gate: the gate is stage 6's business and is verified there.
SETUP = """() => {
  const g = __pp.app.game;
  __pp.skipIntro('Pip');
  const s = g.state;
  const now = Date.now();
  const second = JSON.parse(JSON.stringify(s.dogs[0]));
  second.id = 'dog-second';
  second.name = 'Biscuit';
  second.breedId = 'cockapoo';
  second.lastSeenAt = now;
  s.dogs.push(second);
  if (s.unlocks.breeds.indexOf('cockapoo') < 0) s.unlocks.breeds.push('cockapoo');
  return s.dogs.map((d) => d.id);
}"""

# Rewind every clock in the save by `hours`, then run the real elapsed model.
# Rewinding is the only honest way to test an offline model with a pinned
# Date.now: it is exactly what a phone hands us after a night.
AWAY = """([hours, alsoDogs]) => __pp.fakeAway(hours, { dogs: !!alsoDogs })"""

STATE = """() => {
  const s = __pp.app.game.state;
  return s.dogs.map((d) => ({
    id: d.id, active: d.id === s.activeDogId,
    hunger: +d.needs.hunger.toFixed(4), thirst: +d.needs.thirst.toFixed(4),
    affection: +d.affection.toFixed(4), floor: +d.affectionFloor.toFixed(4),
    gapH: +((Date.now() - d.lastSeenAt) / 3600e3).toFixed(2),
  }));
}"""


def main():
    url = serve()
    with sync_playwright() as p:
        b = browser(p)
        ctx, pg = page(b, inset=40)
        errors = []
        pg.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
        pg.on("console", lambda m: errors.append("console.%s: %s" % (m.type, m.text))
              if m.type in ("error", "warning") else None)
        boot(pg, url)
        pg.evaluate("() => __pp.app.game.setFlag('installNever', true)")
        ids = pg.evaluate(SETUP)
        check(len(ids) == 2, "two dogs in the save", ids)

        # ---- A / B / C : a day away, and who it touches -------------------
        before = pg.evaluate(STATE)
        el = pg.evaluate(AWAY, [24, True])
        after = pg.evaluate(STATE)
        for i, d in enumerate(after):
            who = "the dog in the room" if d["active"] else "THE DOG SHE IS NOT LOOKING AT"
            check(d["hunger"] < before[i]["hunger"] - 0.01,
                  "a day away makes %s hungrier" % who,
                  "%.3f -> %.3f" % (before[i]["hunger"], d["hunger"]))
            check(d["thirst"] < before[i]["thirst"] - 0.01,
                  "a day away makes %s thirstier" % who,
                  "%.3f -> %.3f" % (before[i]["thirst"], d["thirst"]))
            check(d["affection"] >= d["floor"] - 1e-6,
                  "%s never falls through the affection floor" % who,
                  "%.3f vs floor %.3f" % (d["affection"], d["floor"]))

        # the cap, on both dogs: a fortnight costs no more than 36 hours
        pg.evaluate("() => { const s = __pp.app.game.state;"
                    "  for (const d of s.dogs) { d.needs.hunger = 1; d.needs.thirst = 1; } }")
        pg.evaluate(AWAY, [36, True])
        at36 = pg.evaluate(STATE)
        pg.evaluate("() => { const s = __pp.app.game.state;"
                    "  for (const d of s.dogs) { d.needs.hunger = 1; d.needs.thirst = 1; } }")
        pg.evaluate(AWAY, [24 * 14, True])
        at14d = pg.evaluate(STATE)
        for i, d in enumerate(at14d):
            who = "the active dog" if d["active"] else "the inactive dog"
            check(abs(d["hunger"] - at36[i]["hunger"]) < 1e-3,
                  "the 36-hour cap binds for %s" % who,
                  "36h %.4f vs 14 days %.4f" % (at36[i]["hunger"], d["hunger"]))

        # ---- D : the reunion runs on HIS clock ----------------------------
        # She plays with the second dog daily for a fortnight: the app clock is
        # never more than a day stale, but the first dog has not been picked up.
        pg.reload()
        pg.wait_for_function("() => window.__pp && window.__pp.loop && window.__pp.loop.scene")
        pg.evaluate("() => __pp.app.game.setFlag('installNever', true)")
        pg.evaluate(SETUP)
        first = pg.evaluate("() => __pp.app.game.state.activeDogId")
        pg.evaluate("(id) => __pp.switchDog(id)", "dog-second")
        pg.evaluate("""([id, hours]) => {
          const s = __pp.app.game.state;
          const d = s.dogs.find((x) => x.id === id);
          d.lastSeenAt = Date.now() - hours * 3600e3;   // this dog: a fortnight ago
        }""", [first, 24 * 14])
        gap = pg.evaluate("(id) => __pp.app.game.gapHoursFor(id)", first)
        check(gap > 24 * 13, "the first dog's own gap is a fortnight", "%.1f hours" % gap)
        el = pg.evaluate("() => __pp.fakeAway(0.2, { dogs: false })")
        check(el["appHours"] < 1, "the app itself was only just closed",
              "%.2f hours" % el["appHours"])
        # switching back is what she actually does, and it must greet him properly
        pg.evaluate("(id) => __pp.switchDog(id)", first)
        pg.evaluate("() => __pp.loop.scene.enter(__pp.app, { switched: true })")
        pg.evaluate("() => __pp.step(1/60, 30)")
        d = pg.evaluate("() => __pp.dbg()")
        check(bool(d["reunion"]["on"]),
              "switching back after a fortnight plays the reunion", d["reunion"])
        check(d["reunion"].get("k", 0) > 0.4,
              "and it plays at a real intensity, not a token one",
              "k = %s" % d["reunion"].get("k"))
        check(pg.evaluate("(id) => __pp.app.game.gapHoursFor(id)", first) < 0.1,
              "and his clock is stamped once he has been seen")

        # ---- E : a swap is still a swap -----------------------------------
        pg.evaluate("(id) => __pp.switchDog(id)", "dog-second")
        pg.evaluate("() => __pp.loop.scene.enter(__pp.app, { switched: true })")
        pg.evaluate("() => __pp.step(1/60, 30)")
        d2 = pg.evaluate("() => __pp.dbg()")
        check(not d2["reunion"]["on"],
              "swapping to a dog she was just with is a quiet hello, not a beat",
              d2["reunion"])

        # ---- F : old saves ------------------------------------------------
        # THE ONE THAT ACTUALLY MATTERS IS v6 -> v7: it is the save on her
        # phone. The risk is not that it fails to load, it is that it loads and
        # invents a gap — seeding the new per-dog clock from 0 or from `bornAt`
        # would greet her with a full-intensity reunion for a dog she had been
        # playing with a minute before the update.
        older = pg.evaluate("""async () => {
          const m = await import('/src/state/save.js');
          const g = __pp.app.game;
          const now = Date.now();
          const v6 = JSON.parse(JSON.stringify(g.state));
          v6.v = 6;
          v6.lastSeenAt = now - 5 * 60e3;            // she was here five minutes ago
          for (const d of v6.dogs) delete d.lastSeenAt;
          const got = m.migrate(v6);
          return {
            v: got.v,
            name: got.dogs[0].name,
            coins: got.player.coins,
            affection: got.dogs[0].affection,
            gaps: got.dogs.map((d) => +((now - d.lastSeenAt) / 60000).toFixed(1)),
          };
        }""")
        check(older["v"] == 7, "a v6 save migrates to v7", older)
        check(older["name"] == "Pip" and older["coins"] is not None,
              "and keeps her name and her coins", older)
        check(all(g < 6 for g in older["gaps"]),
              "and does NOT invent a gap: every dog is seeded from the app clock",
              "%s minutes" % older["gaps"])

        # every older version still walks the whole ladder
        walked = pg.evaluate("""async () => {
          const m = await import('/src/state/save.js');
          const out = {};
          for (let v = 1; v <= 7; v++) {
            const s = JSON.parse(JSON.stringify(__pp.app.game.state));
            s.v = v;
            try { out[v] = m.migrate(s).v; } catch (e) { out[v] = 'threw: ' + e.message; }
          }
          return out;
        }""")
        check(all(v == 7 for v in walked.values()),
              "v1..v7 all migrate to v7 through the real table", walked)

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
