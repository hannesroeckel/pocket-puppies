"""
tools/shopgate.py — EVERY ROW IN THE SHOP DOES SOMETHING. Queue item 2.

The item set its own rule and it is the binding one: "every item must do
something. Stage 6 cut two unlock rows for being empty, on the principle that an
earned reward that does nothing is worse than one never promised. Do not add
anything cosmetic-but-inert."

So this gate does not check that four rows appeared. It checks that owning each
one CHANGES A MEASURABLE THING, and that not owning it changes nothing:

  kibbleGood  a bowl fills more of him per mouthful
  combCurly   brushing a CURLY coat raises gloss faster than the soft brush,
              and does nothing extra on the Shiba, which is what it is for
  soapRose    the gloss he has fades slower per hour away
  ropeTug     the fetch roll tilts toward chewing and away from bringing it back

Plus the two rules the shop itself is built on, re-checked because a bigger
catalogue is exactly when they get broken:

  - COINS STILL CANNOT REACH A CARE UNLOCK, at any price.
  - THE SHOP STILL DOES NOT SCROLL: twelve rows and Done fit above the home bar
    at every inset a shipping phone reports.

Usage:  py tools/shopgate.py [--shots]
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


GIVE_COINS = "(n) => __pp.app.game.addCoins(n)"
BUY = "(id) => __pp.app.game.buyItem(id)"

# feed him a whole bowl and report how much hunger it actually restored
FEED = """() => {
  const g = __pp.app.game;
  g.setNeed('hunger', 0.2);
  const before = g.dog.needs.hunger;
  __pp.care('feed');
  /* the bowl is dragged into place and tipped in by the real care layer */
  __pp.drag({ from: [300, 700], to: [195, 690], steps: 16 });
  let guard = 0;
  while (guard++ < 900) {
    __pp.step(1/60, 4);
    const d = __pp.dbg().care;
    if (!d || !d.mode) break;
  }
  return { before: +before.toFixed(4), after: +g.dog.needs.hunger.toFixed(4) };
}"""

# brush him for a fixed distance and report the gloss gained
BRUSH = """() => {
  const g = __pp.app.game;
  g.addGloss(-1);
  const before = g.gloss;
  __pp.care('brush');
  for (let i = 0; i < 8; i++) __pp.stroke({ zone: 'back', amp: 30, steps: 24 });
  const after = g.gloss;
  __pp.stopCare();
  __pp.step(1/60, 10);
  return { gained: +(after - before).toFixed(5) };
}"""


def main():
    shots = "--shots" in sys.argv
    url = serve()
    with sync_playwright() as p:
        b = browser(p)
        errors = []

        def fresh(breed=None):
            ctx, pg = page(b, inset=40)
            pg.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
            pg.on("console", lambda m: errors.append("console.%s: %s" % (m.type, m.text))
                  if m.type in ("error", "warning") else None)
            boot(pg, url)
            pg.evaluate("() => __pp.app.game.setFlag('installNever', true)")
            pg.evaluate("() => __pp.skipIntro('Pip')")
            pg.evaluate(GIVE_COINS, 5000)
            return ctx, pg

        # ---- the catalogue -------------------------------------------------
        ctx, pg = fresh()
        rows = pg.evaluate("() => __pp.app.game.shopStock().map((r) => r.id)")
        check(len(rows) == 12, "the shop stocks twelve things", len(rows))
        for want in ("kibbleGood", "combCurly", "soapRose", "ropeTug"):
            check(want in rows, "%s is on the shelf" % want)

        # ---- kibbleGood: a bowl fills more of him --------------------------
        plain = pg.evaluate(FEED)
        pg.evaluate(BUY, "kibbleGood")
        good = pg.evaluate(FEED)
        gp = plain["after"] - plain["before"]
        gg = good["after"] - good["before"]
        check(gg > gp * 1.15, "the good kibble fills more of him per bowl",
              "%.3f of him vs %.3f" % (gg, gp))
        ctx.close()

        # ---- combCurly: only on a coat the brush cannot reach --------------
        # the gift puppy is a Schnoodle, whose fur type is not 'short'
        ctx, pg = fresh()
        curly_kind = pg.evaluate("() => __pp.loop.scene.rig.breed.fur.type")
        base = pg.evaluate(BRUSH)
        pg.evaluate(BUY, "combCurly")
        combed = pg.evaluate(BRUSH)
        check(combed["gained"] > base["gained"] * 1.3,
              "the comb brings a curly coat up faster (%s)" % curly_kind,
              "%.4f vs %.4f" % (combed["gained"], base["gained"]))
        # ...and it stacks with nothing
        pg.evaluate(BUY, "brushSoft")
        both = pg.evaluate(BRUSH)
        check(abs(both["gained"] - combed["gained"]) < combed["gained"] * 0.02,
              "owning the brush as well does not stack on top of the comb",
              "%.4f vs %.4f" % (both["gained"], combed["gained"]))
        ctx.close()

        # the Shiba is the coat the soft brush was tuned on, so the comb is
        # deliberately no better there — which is the honest version of "for a
        # curly coat the brush cannot reach"
        ctx, pg = page(b, inset=40)
        boot(pg, url)
        pg.evaluate("() => __pp.app.game.setFlag('installNever', true)")
        pg.evaluate("() => { __pp.app.game.state.dogs[0].breedId = 'shiba'; }")
        pg.reload()
        pg.wait_for_function("() => window.__pp && window.__pp.loop && window.__pp.loop.scene")
        pg.evaluate("() => __pp.skipIntro('Pip')")
        pg.evaluate(GIVE_COINS, 5000)
        short_kind = pg.evaluate("() => __pp.loop.scene.rig.breed.fur.type")
        sbase = pg.evaluate(BRUSH)
        pg.evaluate(BUY, "combCurly")
        scomb = pg.evaluate(BRUSH)
        check(short_kind == "short", "the Shiba's coat is the short one", short_kind)
        check(abs(scomb["gained"] - sbase["gained"]) < max(1e-6, sbase["gained"] * 0.02),
              "and the comb does nothing extra on a short coat",
              "%.4f vs %.4f" % (scomb["gained"], sbase["gained"]))
        ctx.close()

        # ---- soapRose: the shine lasts ------------------------------------
        ctx, pg = fresh()
        plain_dull = pg.evaluate("""() => {
          const g = __pp.app.game;
          g.addGloss(1);
          const before = g.gloss;
          __pp.fakeAway(12);
          return +(before - g.gloss).toFixed(5);
        }""")
        pg.evaluate(BUY, "soapRose")
        soaped_dull = pg.evaluate("""() => {
          const g = __pp.app.game;
          g.addGloss(1);
          const before = g.gloss;
          __pp.fakeAway(12);
          return +(before - g.gloss).toFixed(5);
        }""")
        check(soaped_dull < plain_dull * 0.8,
              "rose soap makes the shine last through an absence",
              "lost %.4f vs %.4f over 12 hours" % (soaped_dull, plain_dull))

        # ---- ropeTug: he would rather tug it ------------------------------
        odds = pg.evaluate("""() => {
          const K = __pp.BALANCE.toy.kinds;
          return { rope: K.ropeTug, stick: K.stick, ball: K.ball || null };
        }""")
        check(odds["rope"]["fetch"] < 1 and odds["rope"]["chew"] > 1,
              "the rope tug is weighted away from fetching and toward chewing", odds["rope"])
        check(odds["ball"] is None,
              "and the plain ball is not in the table at all, so it is unchanged")
        tilt = pg.evaluate("""() => {
          /* READ THE RULE, DO NOT SAMPLE IT. Forty throws each took ten minutes
             and reported nothing at all, because the loop was watching for a
             `dbg().toy.outcome` that had already been cleared by the time it
             looked. `dog/toy.js` now publishes the three weights it rolls
             against, which is the thing the item is actually about: "different
             odds of return, so play varies". */
          const g = __pp.app.game;
          g.buyItem('ropeTug');
          /* HE CAN ONLY HOLD A TOY HE OWNS: `setActiveToy` refuses an id that is
             not in `inventory.toys`, and refuses it SILENTLY, so asking for the
             stick left the rope tug in his mouth and the gate compared the rope
             against itself. The stick is a walk find, so this is how she gets
             one. Caught because `toyState.variant` now says what he is actually
             holding. */
          g.addFind('stick', Date.now());
          const out = {};
          for (const toy of ['ball', 'ropeTug', 'stick']) {
            g.setActiveToy(toy);
            __pp.step(1/60, 2);
            /* the room calls it `toyState`, not `toy` */
            const d = __pp.dbg().toyState;
            out[toy] = { variant: d.variant, odds: d.odds };
            if (d.variant !== toy) out[toy].WRONG = 'asked for ' + toy;
          }
          return out;
        }""")
        check(tilt["ball"]["variant"] == "ball" and tilt["ropeTug"]["variant"] == "ropeTug",
              "the toy he is playing with reaches the roll at all", tilt)
        check(tilt["ropeTug"]["odds"]["fetch"] < tilt["ball"]["odds"]["fetch"],
              "he is less likely to bring the rope tug back than the ball",
              "%.3f vs %.3f" % (tilt["ropeTug"]["odds"]["fetch"], tilt["ball"]["odds"]["fetch"]))
        check(tilt["ropeTug"]["odds"]["chew"] > tilt["ball"]["odds"]["chew"],
              "and more likely to settle down and tug it",
              "%.3f vs %.3f" % (tilt["ropeTug"]["odds"]["chew"], tilt["ball"]["odds"]["chew"]))
        check(tilt["stick"]["variant"] == "stick", "he is actually holding the stick",
              tilt["stick"])
        check(tilt["stick"]["odds"]["fetch"] > tilt["ball"]["odds"]["fetch"],
              "and a stick is the opposite: sticks are for fetching",
              "%.3f vs %.3f" % (tilt["stick"]["odds"]["fetch"], tilt["ball"]["odds"]["fetch"]))
        ctx.close()

        # ---- the two rules the shop is built on ---------------------------
        ctx, pg = fresh()
        pg.evaluate(GIVE_COINS, 10_000_000)
        blocked = pg.evaluate("""() => {
          /* ASSERT THE STATE, NOT THE RETURN VALUE. `buyItem` reports a refusal
             as an OBJECT — `{ok: false, reason: 'unlock'}` — which is perfectly
             truthy, so the first version of this check "found" that ten million
             coins bought four care unlocks while the very same call reported the
             coins untouched. The refusals were correct; the gate was not. */
          const g = __pp.app.game;
          const coins0 = g.coins;
          const inv0 = JSON.stringify(g.state.inventory);
          const unl0 = JSON.stringify(g.state.unlocks);
          const said = {};
          for (const u of __pp.BALANCE.economy.unlocks) {
            const r = g.buyItem(u.id);
            said[u.id] = r && r.ok === true;
          }
          return {
            claimedOk: Object.keys(said).filter((k) => said[k]),
            spent: coins0 - g.coins,
            invChanged: inv0 !== JSON.stringify(g.state.inventory),
            unlChanged: unl0 !== JSON.stringify(g.state.unlocks),
            coins: g.coins,
          };
        }""")
        check(not blocked["claimedOk"], "no care unlock reports a successful purchase", blocked)
        check(blocked["spent"] == 0, "not one coin moves", blocked["spent"])
        check(not blocked["invChanged"] and not blocked["unlChanged"],
              "and nothing enters the inventory or the unlock set", blocked)
        for inset in (0, 20, 40, 80):
            c2, p2 = page(b, inset=inset)
            boot(p2, url)
            p2.evaluate("() => __pp.app.game.setFlag('installNever', true)")
            p2.evaluate("() => __pp.skipIntro('Pip')")
            d = p2.evaluate("""() => {
              const sc = __pp.loop.scene;
              sc.shop.start();
              __pp.step(1/60, 40);
              return sc.shop.debug;
            }""")
            geo = p2.evaluate("""() => {
              const S = __pp.BALANCE.ui.shop;
              const n = __pp.app.game.shopStock().length;
              return { bottom: S.headH + n * S.rowH + 8 + 40, rows: n };
            }""")
            floor = 844 - inset
            check(geo["bottom"] <= floor,
                  "inset %s: twelve rows and Done fit without scrolling" % inset,
                  "%s vs floor %s" % (geo["bottom"], floor))
            if shots and inset == 40:
                SHOTS.mkdir(exist_ok=True)
                p2.screenshot(path=str(SHOTS / "shop.png"))
            c2.close()
        ctx.close()

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
