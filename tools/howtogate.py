"""
tools/howtogate.py — SHE IS TOLD HOW, ONCE, AND CAN ASK AGAIN.

The brief:

  "we need an explanation on the disc in the game. one doesnt really know what to
   do. in general we should always include a tutorial for any feature/mode in the
   game."

WHAT IT ASSERTS

  A  IT ARRIVES WHERE THE MODE IS. Opening the disc for the first time puts the
     disc card up; opening the ring puts the ring card up. Driven by opening the
     real modes, not by calling `howto.open()`.

  B  ONCE. Dismissed, it does not come back — and "dismissed" means she pressed
     it, not that it happened to be on screen when the app closed.

  C  SHE CAN ASK AGAIN. The `?` chip re-opens it, and the tap goes through
     `scene.pointer` — the routing, not the layer. This is the 8.16.1 lesson
     written as a test: the disc shipped un-flickable because its gate called
     `disc.pointer` directly and never touched the scene that routes to it.

  D  NOTHING OPENS UNDER IT. It is in `surfaceOwner()`, so care, training, the
     walk, the trial and the disc all refuse while it is up, and a tap on the dog
     does not reach the petting field through it.

  E  IT NEVER STANDS IN FRONT OF THE GIFT. No card during naming or the reunion
     (GIFT-READY: "no UI clutter, no tutorial in front of it"), and none at all in
     the plain room.

  F  IT FITS, AT THE LONGEST PRONOUNS. Every card is laid out and measured with
     "they/them/their" — the widest expansion — and every line must be inside the
     card with nothing ellipsised. This is `kennel.js`'s lesson: a sentence
     measured at 334 units in a 116-unit slot was shrunk and cut to "She goes to
     someone wh…", and only a render caught it.

  G  EVERY MODE THAT NEEDS ONE HAS ONE, and the copy is pronoun-correct — no card
     may contain a typed-in "he" or "his".

FAULT INJECTION: F is run a second time with a deliberately over-long step
pushed onto the disc card, and must report it as shrunk or ellipsised. Without
that, "every line fits" is a sentence about a check that could not fail: text.js
never clips, so bad copy comes out as slightly smaller text rather than as
anything a screenshot would flag.

Usage:  py tools/howtogate.py [--shots]
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


# open a mode the way she does, and report what the explainer layer did about it
OPEN_MODE = r"""(which) => {
  const pp = window.__pp, sc = pp.loop.scene;
  const go = {
    disc:  () => sc.startDisc(),
    ring:  () => sc.startContest(),
    train: () => sc.startTrain(),
    kennel: () => sc.openKennel(),
    collection: () => sc.openCollection ? sc.openCollection() : sc.collection.start(),
    brush: () => sc.startCare('brush'),
  }[which];
  if (!go) return { error: 'no such mode ' + which };
  go();
  pp.step(1/60, 24);
  const d = pp.dbg();
  return {
    context: sc.howtoContext(), owner: d.room ? d.room.owner : d.owner,
    howto: sc.howto.debug,
  };
}"""

# the widest pronouns, which is what the copy was written against
THEY = """() => {
  const g = __pp.app.game;
  g.state.dogs[0].sex = 'n';
  return g.pron.they;
}"""


def main():
    shots = "--shots" in sys.argv
    url = serve()
    with sync_playwright() as p:
        b = browser(p)
        errors = []

        def fresh(howto=True):
            ctx, pg = page(b, inset=40)
            pg.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
            pg.on("console", lambda m: errors.append("console.%s: %s" % (m.type, m.text))
                  if m.type in ("error", "warning") else None)
            boot(pg, url)
            pg.evaluate("() => __pp.app.game.setFlag('installNever', true)")
            # `howto: true` = show the cards, as a first-time save would. Every
            # other gate takes the default, which marks them seen.
            pg.evaluate("(h) => __pp.skipIntro('Pip', { howto: h })", howto)
            return ctx, pg

        # ---- A. it arrives where the mode is ------------------------------
        ctx, pg = fresh()
        ids = pg.evaluate("() => Object.keys(__pp.loop.scene.howto.debug.seen ? {} : {})")
        for mode in ("disc", "ring", "train", "kennel", "brush"):
            ctx2, pg2 = fresh()
            r = pg2.evaluate(OPEN_MODE, mode)
            check(not r.get("error") and r["howto"]["open"] and r["howto"]["id"] == mode,
                  "opening %s for the first time explains %s" % (mode, mode),
                  {"context": r.get("context"), "card": r["howto"]["id"]})
            ctx2.close()
        ctx.close()

        # ---- B. once ------------------------------------------------------
        ctx, pg = fresh()
        once = pg.evaluate("""() => {
          const pp = window.__pp, sc = pp.loop.scene, g = pp.app.game;
          sc.startDisc(); pp.step(1/60, 24);
          const first = sc.howto.debug.open;
          /* dismissed with a real tap on the button, through the scene */
          const db = sc.howto.debug.done;
          const at = { x: db.x + db.w / 2, y: db.y + db.h / 2 };
          sc.pointer(pp.app, { type: 'down', ...at, id: 1, dx: 0, dy: 0, speed: 0, dist: 0, moved: false });
          sc.pointer(pp.app, { type: 'up', ...at, id: 1, dx: 0, dy: 0, speed: 0, dist: 0, moved: false });
          pp.step(1/60, 20);
          const afterTap = sc.howto.debug.open;
          const saved = g.seenHowto('disc');
          /* leave, come back */
          const B = pp.BALANCE.contest.ring.back;
          sc.pointer(pp.app, { type: 'down', x: B.x, y: B.y, id: 1, dx: 0, dy: 0, speed: 0, dist: 0, moved: false });
          pp.step(1/60, 30);
          sc.startDisc(); pp.step(1/60, 30);
          return { first, afterTap, saved, again: sc.howto.debug.open };
        }""")
        check(once["first"], "the card is up on the first open", once)
        check(not once["afterTap"], "a tap on Got it dismisses it", once)
        check(once["saved"], "and the save remembers she has seen it", once)
        check(not once["again"], "so the second time she opens the disc, there is no card", once)

        # ---- C. she can ask again, through the routing --------------------
        again = pg.evaluate("""() => {
          const pp = window.__pp, sc = pp.loop.scene;
          /* the disc is open, the card is not: the chip is the way back in */
          const B = pp.BALANCE.contest.ring.back;
          const chip = { x: pp.BALANCE.view.W - B.x, y: B.y };
          const before = sc.howto.debug.open;
          sc.pointer(pp.app, { type: 'down', ...chip, id: 1, dx: 0, dy: 0, speed: 0, dist: 0, moved: false });
          sc.pointer(pp.app, { type: 'up', ...chip, id: 1, dx: 0, dy: 0, speed: 0, dist: 0, moved: false });
          pp.step(1/60, 16);
          return { before, after: sc.howto.debug.open, id: sc.howto.debug.id };
        }""")
        check(not again["before"] and again["after"] and again["id"] == "disc",
              "the ? chip re-opens it, tapped through scene.pointer", again)

        # ---- D. nothing opens under it -----------------------------------
        under = pg.evaluate("""() => {
          const pp = window.__pp, sc = pp.loop.scene;
          const owner = pp.dbg().owner;
          /* every other way in, while the card is up */
          const care = sc.startCare('feed');
          const train = sc.startTrain();
          const walk = sc.startWalk ? sc.startWalk() : false;
          const shop = sc.openShop();
          /* and a touch on the dog must not reach the petting field */
          const rig = sc.rig;
          sc.pointer(pp.app, { type: 'down', x: rig.x, y: rig.y - 120, id: 1,
                               dx: 0, dy: 0, speed: 0, dist: 0, moved: false });
          pp.step(1/60, 6);
          return { owner, care: !!care, train: !!train, walk: !!walk, shop: !!shop,
                   petting: !!(sc.pet && sc.pet.debug && sc.pet.debug.active),
                   stillOpen: sc.howto.debug.open };
        }""")
        check(under["owner"] == "howto",
              "the card owns the surface while it is up", under["owner"])
        check(not (under["care"] or under["train"] or under["walk"] or under["shop"]),
              "care, training, the walk and the shop all refuse to open under it", under)
        check(not under["petting"] and under["stillOpen"],
              "and a touch on the dog does not reach the petting field through it", under)
        ctx.close()

        # ---- A2. THE WALK'S CARD WAITS FOR THE MAP ------------------------
        # The rule's one named exception, and it is the rule's own logic: SCOPE
        # calls the leash anticipation "the payload of the whole feature", and a
        # card over it covers the thing it explains. The map is the first beat
        # that asks her for a gesture.
        ctx, pg = fresh()
        walk = pg.evaluate("""() => {
          const pp = window.__pp, sc = pp.loop.scene;
          sc.startWalk();
          pp.step(1/60, 30);
          const prep = { beat: pp.dbg().walk.beat, card: sc.howto.debug.open };
          /* hold the lead on until he is clipped and the map opens */
          const rig = sc.rig;
          let g = 0;
          while (g++ < 600 && pp.dbg().walk.beat === 'prep') {
            sc.pointer(pp.app, { type: 'down', x: rig.x, y: rig.y - 150, id: 1,
                                 dx: 0, dy: 0, speed: 0, dist: 0, moved: false });
            pp.step(1/60, 2);
          }
          pp.step(1/60, 20);
          return { prep, map: { beat: pp.dbg().walk.beat, card: sc.howto.debug.open,
                                id: sc.howto.debug.id } };
        }""")
        check(walk["prep"]["beat"] == "prep" and not walk["prep"]["card"],
              "no card over the lead going on — that beat is the payload", walk["prep"])
        check(walk["map"]["beat"] != "map" or (walk["map"]["card"] and walk["map"]["id"] == "walk"),
              "the walk is explained when the map opens", walk["map"])
        ctx.close()

        # ---- E. never in front of the gift -------------------------------
        ctx, pg = page(b, inset=40)
        pg.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
        boot(pg, url)
        pg.evaluate("() => __pp.app.game.setFlag('installNever', true)")
        pg.evaluate("() => __pp.step(1/60, 40)")
        gift = pg.evaluate("""() => {
          const pp = window.__pp, sc = pp.loop.scene;
          return { naming: !!(sc.naming && sc.naming.isOpen),
                   context: sc.howtoContext(), open: sc.howto.debug.open };
        }""")
        check(gift["naming"] and gift["context"] == "" and not gift["open"],
              "no card in front of the naming beat", gift)
        pg.evaluate("() => __pp.skipIntro('Pip', { howto: true })")
        pg.evaluate("() => __pp.step(1/60, 60)")
        room = pg.evaluate("""() => {
          const sc = __pp.loop.scene;
          return { context: sc.howtoContext(), open: sc.howto.debug.open };
        }""")
        check(room["context"] == "" and not room["open"],
              "and none at all in the plain room — it is a puppy, not a manual", room)
        ctx.close()

        # ---- F / G. it fits, at the longest pronouns ---------------------
        ctx, pg = fresh()
        pg.evaluate(THEY)
        pg.evaluate("() => __pp.app.nav.go('room', { switched: true })")
        pg.wait_for_function("() => window.__pp.loop.scene.rig")
        pg.evaluate("() => __pp.skipIntro('Pip', { howto: true })")
        fit = pg.evaluate("""() => {
          const pp = window.__pp, sc = pp.loop.scene, howto = sc.howto;
          const out = [];
          for (const id of pp.HOWTO_IDS) {
            howto.open(id);
            pp.step(1/60, 30);
            out.push(sc.probeHowto());
          }
          howto.close();
          pp.step(1/60, 6);
          return { out, VH: pp.BALANCE.view.H, pron: pp.app.game.pron.they };
        }""")
        check(fit["pron"] == "they", "measured at the widest pronouns", fit["pron"])
        for row in fit["out"]:
            b0 = row["box"]
            check(b0["y"] >= 0 and b0["y"] + b0["h"] <= fit["VH"],
                  "the %s card fits on the screen" % row["id"],
                  "top %s, bottom %s of %s" % (b0["y"], round(b0["y"] + b0["h"]), fit["VH"]))
            bad = [r for r in row["rows"] if r["cut"] or r["shrunk"]]
            check(not bad,
                  "and every line of it is drawn whole, at full size",
                  bad[:2] if bad else "%s lines" % len(row["rows"]))

        # FAULT INJECTION. `ui/text.js` never clips — it shrinks to `minSize` and
        # then ellipsises — so a line that is too long does not look broken, it
        # looks like slightly smaller text or a sentence ending in "…". A check
        # that cannot report that is not checking it, so here is one that must.
        inject = pg.evaluate("""() => {
          const pp = window.__pp, sc = pp.loop.scene;
          const steps = pp.HOWTO.disc.steps;
          const keep = steps.slice();
          steps.push(() => 'Flick the disc up-screen with your thumb and then wait for him to line himself up under it before you tap');
          sc.howto.open('disc');
          pp.step(1/60, 20);
          const probe = sc.probeHowto();
          sc.howto.close();
          pp.HOWTO.disc.steps = keep;
          pp.step(1/60, 6);
          return probe.rows.filter((r) => r.cut || r.shrunk);
        }""")
        check(len(inject) > 0,
              "INJECTED: an over-long line is reported as shrunk or cut",
              inject[:1])

        # the copy itself: no typed-in pronouns anywhere
        typed = pg.evaluate("""() => {
          const pp = window.__pp;
          const bad = [];
          const P = pp.app.game.pron;
          for (const id of pp.HOWTO_IDS) {
            const e = pp.HOWTO[id];
            const lines = [e.title(P), ...e.steps.map((f) => f(P))];
            if (e.note) lines.push(e.note(P));
            for (const s of lines) {
              if (/\\b(he|him|his|she|her|hers)\\b/i.test(s)) bad.push([id, s]);
            }
          }
          return bad;
        }""")
        check(not typed, "no card has a typed-in pronoun in it", typed[:3])

        if shots:
            SHOTS.mkdir(exist_ok=True)
            for id in ("disc", "train", "brush"):
                pg.evaluate("(id) => { const sc = __pp.loop.scene; sc.startDisc(); __pp.step(1/60, 20);"
                            " sc.howto.open(id); __pp.step(1/60, 30); }", id)
                pg.screenshot(path=str(SHOTS / ("howto-%s.png" % id)))
                pg.evaluate("() => { __pp.loop.scene.howto.close(); __pp.step(1/60, 10); }")
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
