"""
tools/scrollgate.py — A PANEL THAT OUTGROWS THE SCREEN (8.29.0).

`src/ui/scroll.js`, used by the shop and the kennel. Two surfaces had written
down that nothing in this game scrolls, and both had written down a reason —
"a child hunting for a row below the fold is a child who does not find it", and
"a list that fits is a list she can hold in her head". Neither is repealed. What
is replaced is the third thing, which was never a decision: a panel that outgrew
its screen had no honest way to fail, and answered by letting `closeRect`'s own
`Math.min` clamp slide the Done button UP UNDER the last row.

WHAT IT ASSERTS, and every one is either a rule the feature was built around or
the way it could quietly stop being true:

  A  IT IS INERT WHEN THE CONTENT FITS. This is the whole answer to the
     objection above, so it is the first thing checked and it is checked
     positionally: at twelve shop rows and five dogs, `can` is false, the offset
     is zero, and every row is at exactly the y the pre-scroll arithmetic put it
     at. A surface that fits has no fold for a child to hunt below.

  B  ...AND IT SCROLLS WHEN IT MUST. With a sixth dog — measured at 20 units of
     overflow at a 40-unit inset, which is what used to hide the Done button —
     the list moves.

  C  A DRAG BUYS NOTHING AND ADOPTS NOBODY. THE HEADLINE. Every panel in this
     game used to commit on `down`, which is safe only while nothing moves under
     a finger: a flick to see the bottom of the kennel would otherwise swap the
     dog in the room or knock on the door, and a flick down the shelf would
     spend her coins. Driven as a REAL drag through `scene.pointer` — a press, a
     trail of moves, a lift — never by calling the layer's handler (8.16.1).

  D  ...AND A TAP STILL DOES. The other half of C: moving the commit to the lift
     is only correct if the lift still commits.

  E  IT CANNOT LOSE ANYTHING OFF EITHER END. The offset is hard-clamped, so no
     amount of dragging shows past the top or the bottom, and after scrolling to
     the end the LAST card is fully inside the band — "everything is reachable"
     stated as geometry rather than hoped for.

  F  THE HEADER AND THE WAY OUT NEVER TRAVEL. Her care points, her purse and the
     Done button are outside the band by construction; a scroll may not move
     them by one unit. This is the assertion that would have caught the bug the
     rewrite introduced and fixed — `closeRect` flowing off the earned rows,
     which now carry the offset, and therefore creeping up the screen as she
     scrolled down.

  G  SHE IS TOLD THERE IS MORE. The objection was never "scrolling is bad", it
     was "she will not know". Asserted ON PIXELS and against itself: read the
     bottom edge of the band, set the fade and the bar to zero, read it again.
     The difference IS the affordance, which makes the check its own fault
     injection — if it stops being drawn, the two reads match and this fails.

  H  IT CAN FAIL. A gate that cannot fail is decoration (§27). The controls here
     drag a list that does not scroll and assert nothing moved, and tap a row
     after a drag and assert nothing was bought.

Usage:  py tools/scrollgate.py [--shots]
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


def main():
    shots = "--shots" in sys.argv
    url = serve()
    with sync_playwright() as p:
        b = browser(p)
        errors = []

        def fresh(inset=40):
            ctx, pg = page(b, inset=inset)
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

        # ==================================================================
        #  A : INERT WHEN IT FITS — the shelf and the kennel as they ship
        # ==================================================================
        ctx, pg = fresh()
        fit = pg.evaluate("""() => {
          const pp = window.__pp;
          pp.openShop();
          pp.step(1/60, 30);
          const s = pp.shop();
          const S6 = pp.BALANCE.ui.shop;
          /* WHERE THE PRE-SCROLL ARITHMETIC PUT EACH ROW. `listTop` is the
             header height once the panel has finished sliding in, which is what
             `topY()` being 0 means. If the scroller is inert these are the rows'
             real positions to the unit. */
          const want = s.rows.map((r, i) => +(S6.headH + i * S6.rowH).toFixed(1));
          return { scroll: s.scroll, rowsAt: s.rowsAt, want, n: s.rows.length,
                   closeY: s.closeY };
        }""")
        check(fit["n"] == 12, "control: the shelf really is at its twelve rows", fit["n"])
        check(fit["scroll"]["can"] is False,
              "THE SHOP DOES NOT SCROLL AT TWELVE ROWS — the rule still holds "
              "where it always held", fit["scroll"])
        check(fit["scroll"]["off"] == 0 and fit["rowsAt"] == fit["want"],
              "...and every row is exactly where the pre-scroll arithmetic put it",
              "first mismatch: %s" % next((i for i in range(len(fit["want"]))
                                           if fit["rowsAt"][i] != fit["want"][i]), "none"))

        # THE BOUNDARY IS THE POINT, so this is checked at FIVE — the roster the
        # game actually ships a ceiling for, and the case the old note said was
        # "at its 64-unit floor with about ten units to spare". A kennel holding
        # one dog would prove nothing about whether anything moved.
        kfit = pg.evaluate("""() => {
          const pp = window.__pp;
          pp.tapAt(pp.BALANCE.view.W / 2, pp.shop().closeY + 19);   // Done
          pp.step(1/60, 20);
          while (pp.app.game.roster().length < 5) pp.addDog('D' + pp.app.game.roster().length);
          pp.openKennel();
          pp.step(1/60, 30);
          const k = pp.kennel();
          const want = k.roster.map((d, i) => +(k.listTop + i * k.cardStep).toFixed(1));
          return { scroll: k.scroll, cardsAt: k.cardsAt, want,
                   n: k.roster.length, cardH: k.cardH, closeY: k.closeY };
        }""")
        check(kfit["n"] == 5, "control: the kennel is at its shipped ceiling of five",
              kfit["n"])
        check(kfit["scroll"]["can"] is False,
              "THE KENNEL DOES NOT SCROLL AT FIVE DOGS — the case that ships is "
              "untouched", kfit["scroll"])
        check(kfit["cardsAt"] == kfit["want"],
              "...and every dog card is where it was before there was a scroller",
              [kfit["cardsAt"], kfit["want"]])
        check(kfit["cardH"] == 74,
              "...including the 74-unit card the five-dog layout shrank to",
              kfit["cardH"])

        # ---- H (control) : dragging something that does not scroll ---------
        still = pg.evaluate("""() => {
          const pp = window.__pp;
          const before = pp.kennel();
          pp.dragAt(pp.BALANCE.view.W / 2, 300, -220, 10);
          pp.step(1/60, 40);
          const after = pp.kennel();
          return { off: after.scroll.off, cardsBefore: before.cardsAt,
                   cardsAfter: after.cardsAt, closeBefore: before.closeY,
                   closeAfter: after.closeY };
        }""")
        check(still["off"] == 0 and still["cardsBefore"] == still["cardsAfter"],
              "CONTROL: hauling on a panel that fits moves nothing at all", still)
        ctx.close()

        # ==================================================================
        #  B / E / F : a sixth dog, which is what used to hide the button
        # ==================================================================
        ctx, pg = fresh()
        six = pg.evaluate("""() => {
          const pp = window.__pp;
          while (pp.app.game.roster().length < 6) pp.addDog('D' + pp.app.game.roster().length);
          pp.openKennel();
          pp.step(1/60, 30);
          const k = pp.kennel();
          return { scroll: k.scroll, cardsAt: k.cardsAt, closeY: k.closeY,
                   cardH: k.cardH, roster: k.roster.length };
        }""")
        check(six["roster"] == 6, "control: there really are six dogs", six)
        check(six["scroll"]["can"] is True and six["scroll"]["max"] > 0,
              "A SIXTH DOG SCROLLS instead of hiding the Done button under itself",
              six["scroll"])

        moved = pg.evaluate("""() => {
          const pp = window.__pp;
          const b = pp.kennel();
          /* drag UP: the content comes up, so the offset goes down the list */
          pp.dragAt(pp.BALANCE.view.W / 2, 420, -160, 10);
          pp.step(1/60, 60);            // let any fling settle
          const a = pp.kennel();
          return {
            off0: b.scroll.off, off1: a.scroll.off,
            cards0: b.cardsAt, cards1: a.cardsAt,
            close0: b.closeY, close1: a.closeY,
            atBottom: a.scroll.atBottom, max: a.scroll.max,
            bandTop: a.scroll.top, bandBot: a.scroll.top + a.scroll.viewH,
            lastCardBottom: a.cardsAt[a.cardsAt.length - 1] + a.cardH,
          };
        }""")
        check(moved["off1"] > moved["off0"] + 1,
              "a real drag moves the list", "%s -> %s" % (moved["off0"], moved["off1"]))
        check(moved["close0"] == moved["close1"],
              "THE WAY OUT DOES NOT TRAVEL WITH IT — Done is where it was",
              [moved["close0"], moved["close1"]])
        check(moved["off1"] <= moved["max"] + 0.5,
              "and it cannot be dragged past the end", moved)

        # ---- E : the far end is reachable, stated as geometry --------------
        ends = pg.evaluate("""() => {
          const pp = window.__pp;
          /* haul well past the end, repeatedly: the clamp is what has to hold */
          for (let i = 0; i < 6; i++) pp.dragAt(pp.BALANCE.view.W / 2, 500, -300, 8);
          pp.step(1/60, 60);
          const bot = pp.kennel();
          for (let i = 0; i < 8; i++) pp.dragAt(pp.BALANCE.view.W / 2, 300, 300, 8);
          pp.step(1/60, 60);
          const top = pp.kennel();
          return {
            bottomOff: bot.scroll.off, max: bot.scroll.max,
            lastBottom: bot.cardsAt[bot.cardsAt.length - 1] + bot.cardH,
            bandBot: +(bot.scroll.top + bot.scroll.viewH).toFixed(1),
            topOff: top.scroll.off, firstTop: top.cardsAt[0],
            bandTop: top.scroll.top,
          };
        }""")
        check(abs(ends["bottomOff"] - ends["max"]) < 1.0,
              "hauling past the bottom stops AT the bottom, never beyond it", ends)
        check(ends["lastBottom"] <= ends["bandBot"] + 0.5,
              "THE LAST DOG IS FULLY IN VIEW at the end of the list — everything "
              "is reachable", "card bottom %.1f vs band %.1f"
              % (ends["lastBottom"], ends["bandBot"]))
        check(ends["topOff"] == 0 and ends["firstTop"] >= ends["bandTop"] - 0.5,
              "...and hauling back stops at the top with the first dog whole", ends)
        ctx.close()

        # ==================================================================
        #  C : A DRAG ADOPTS NOBODY, AND A TAP STILL DOES
        # ==================================================================
        ctx, pg = fresh()
        kdrag = pg.evaluate("""() => {
          const pp = window.__pp, g = pp.app.game;
          /* EIGHT, not six, and deliberately: at six the overflow is 20 units,
             so a drag that failed to be recognised as a drag and a drag that
             was correctly clamped would look similar. With room to move, "it
             scrolled" and "it did not adopt" are two independent facts. */
          while (g.roster().length < 8) pp.addDog('D' + g.roster().length);
          pp.openKennel();
          pp.step(1/60, 30);
          const before = {
            active: g.roster().find((d) => d.active).id,
            dogs: g.roster().length,
            beat: pp.kennel().beat,
          };
          /* START THE DRAG ON A DOG CARD — the one that would be swapped in.
             A flick that begins on a control is the whole risk; a flick that
             begins on empty space would prove nothing. */
          const k = pp.kennel();
          const idx = k.roster.findIndex((d) => !d.active);
          const y = k.cardsAt[idx] + k.cardH / 2;
          pp.dragAt(pp.BALANCE.view.W / 2, y, -170, 10);
          pp.step(1/60, 60);
          return {
            before, startedOn: k.roster[idx].id, y,
            after: {
              active: g.roster().find((d) => d.active).id,
              dogs: g.roster().length,
              beat: pp.kennel().beat,
              switching: pp.kennel().switchTo,
            },
            off: pp.kennel().scroll.off,
          };
        }""")
        check(kdrag["off"] > 1, "control: that drag really did scroll the list", kdrag["off"])
        check(kdrag["after"]["active"] == kdrag["before"]["active"],
              "A FLICK STARTED ON A DOG CARD DOES NOT SWAP THE DOG IN THE ROOM",
              kdrag)
        check(not kdrag["after"]["beat"] and not kdrag["after"]["switching"],
              "...and starts no beat and no switch", kdrag["after"])

        # A CARD THAT IS ACTUALLY ON THE SCREEN. The first version of this took
        # `roster[1]` and tapped where the table said it was — which, after the
        # drag above, is 30 units ABOVE the band. The tap landed on the panel's
        # top edge and closed the kennel, and the check read as "the lift no
        # longer commits". A gate that taps somewhere the thing is not is the
        # same fault as the one 8.16.1 fixed, one level up.
        ktap = pg.evaluate("""() => {
          const pp = window.__pp, g = pp.app.game;
          const k = pp.kennel();
          const lo = k.scroll.top, hi = k.scroll.top + k.scroll.viewH;
          const idx = k.roster.findIndex((d, i) => !d.active
            && k.cardsAt[i] >= lo && k.cardsAt[i] + k.cardH <= hi);
          if (idx < 0) return { err: 'no visible card to tap', cardsAt: k.cardsAt, lo, hi };
          const want = k.roster[idx].id;
          const y = k.cardsAt[idx] + k.cardH / 2;
          const before = g.roster().find((d) => d.active).id;
          pp.tapAt(pp.BALANCE.view.W / 2, y);
          pp.step(1/60, 90);
          return { want, before, y, after: g.roster().find((d) => d.active).id };
        }""")
        check(not ktap.get("err"), "control: a dog card is on screen to be tapped", ktap)
        if not ktap.get("err"):
            check(ktap["after"] == ktap["want"] and ktap["after"] != ktap["before"],
                  "AND A TAP ON A CARD STILL BRINGS THAT DOG IN — the lift commits",
                  ktap)
        ctx.close()

        # ==================================================================
        #  C / D : the shop — a drag spends nothing, a tap still buys
        # ==================================================================
        # A REAL OVERFLOW WITHOUT INVENTING A THIRTEENTH ROW. The catalogue rule
        # says the next thing added has to replace something, and a gate is not
        # the place to break it. A large safe-area inset shrinks the band the
        # same way a new row would grow the content, and it is a real device
        # condition rather than a fake one.
        ctx, pg = fresh(inset=120)
        sdrag = pg.evaluate("""() => {
          const pp = window.__pp, g = pp.app.game;
          g.addCoins ? g.addCoins(9999) : (g.state.coins = 9999);
          pp.openShop();
          pp.step(1/60, 30);
          const s0 = pp.shop();
          const coins0 = g.coins;
          const owned0 = s0.rows.map((r) => r.owned);
          /* start the flick ON A ROW, which is what makes it a risk */
          const y = s0.rowsAt[1] + 20;
          pp.dragAt(pp.BALANCE.view.W / 2, y, -150, 10);
          pp.step(1/60, 60);
          const s1 = pp.shop();
          return {
            can: s0.scroll.can, max: s0.scroll.max, off: s1.scroll.off,
            coins0, coins1: g.coins,
            owned0, owned1: s1.rows.map((r) => r.owned),
            close0: s0.closeY, close1: s1.closeY,
          };
        }""")
        check(sdrag["can"] is True and sdrag["max"] > 0,
              "the shelf scrolls once the band is genuinely too short for it",
              {"max": sdrag["max"]})
        check(sdrag["off"] > 1, "control: the flick really did move it", sdrag["off"])
        check(sdrag["coins0"] == sdrag["coins1"] and sdrag["owned0"] == sdrag["owned1"],
              "A FLICK STARTED ON A SHOP ROW SPENDS NOTHING", sdrag)
        check(sdrag["close0"] == sdrag["close1"],
              "and Done stays put while the shelf moves under it", sdrag)

        stap = pg.evaluate("""() => {
          const pp = window.__pp, g = pp.app.game;
          const s = pp.shop();
          const lo = s.scroll.top, hi = s.scroll.top + s.scroll.viewH;
          const rowH = pp.BALANCE.ui.shop.rowH - pp.BALANCE.ui.shop.rowGap;
          /* the first affordable row that is not full, not care-locked, AND
             actually on the screen — the shelf is scrolled to the bottom by the
             flick above, so the table's idea of where row 0 is is 42 units off
             the top of the band */
          const i = s.rows.findIndex((r, j) => !r.locked && !r.full && r.afford
            && s.rowsAt[j] >= lo && s.rowsAt[j] + rowH <= hi);
          if (i < 0) return { err: 'nothing buyable on screen', rowsAt: s.rowsAt, lo, hi };
          const id = s.rows[i].id;
          const y = s.rowsAt[i] + rowH / 2;
          const before = { coins: g.coins, owned: g.ownedCount(id) };
          pp.tapAt(pp.BALANCE.view.W / 2, y);
          pp.step(1/60, 20);
          return { id, before, y, coins: g.coins, owned: g.ownedCount(id),
                   cost: s.rows[i].cost };
        }""")
        check(not stap.get("err"), "control: there is something she can afford", stap)
        if not stap.get("err"):
            # NOT `owned + 1`: a treat row buys a PACK (`treatPlain` lands five),
            # so the count is not the thing that is one-to-one with the tap. The
            # purse is — exactly the price, once.
            check(stap["coins"] == stap["before"]["coins"] - stap["cost"]
                  and stap["owned"] > stap["before"]["owned"],
                  "AND A TAP ON A ROW STILL BUYS IT — the lift commits, and the "
                  "purse moves by the price exactly once", stap)

        # ==================================================================
        #  G : she is told there is more, and turning it off removes it
        # ==================================================================
        edge = pg.evaluate("""() => {
          const pp = window.__pp;
          const SC = pp.BALANCE.ui.scroll;
          /* BACK TO THE TOP FIRST. The flick above left the shelf AT the
             bottom, where there is correctly nothing more below and therefore
             correctly no fade — the first version of this check sampled that
             state and read zero, which was the affordance being right rather
             than missing. */
          for (let i = 0; i < 8; i++) pp.dragAt(pp.BALANCE.view.W / 2, 200, 300, 8);
          pp.step(1/60, 60);
          const s = pp.shop();
          if (!s.scroll.can) return { err: 'not scrolling, nothing to mark' };
          if (!s.scroll.atTop) return { err: 'did not get back to the top', s: s.scroll };
          const cv = document.querySelector('canvas');
          const c = cv.getContext('2d');
          const dpr = cv.width / pp.BALANCE.view.W;
          /* the strip along the bottom edge of the band, THE FULL WIDTH of it —
             the fade spans the panel and the bar sits at its right-hand edge,
             and a box stopping at x 370 missed the bar entirely */
          const box = () => {
            const x = Math.round(12 * dpr);
            const w = Math.round(366 * dpr);
            const y = Math.round((s.scroll.top + s.scroll.viewH - SC.fadeH) * dpr);
            const h = Math.round(SC.fadeH * dpr);
            return Array.from(c.getImageData(x, y, w, h).data);
          };
          pp.step(1/60, 2);
          const withIt = box();
          const fa = SC.fadeA, ba = SC.barA.slice();
          SC.fadeA = 0; SC.barA[0] = 0; SC.barA[1] = 0;
          pp.step(1/60, 2);
          const without = box();
          SC.fadeA = fa; SC.barA[0] = ba[0]; SC.barA[1] = ba[1];
          pp.step(1/60, 2);
          let diff = 0;
          for (let i = 0; i < withIt.length; i += 4) {
            if (Math.abs(withIt[i] - without[i])
              + Math.abs(withIt[i+1] - without[i+1])
              + Math.abs(withIt[i+2] - without[i+2]) > 6) diff++;
          }
          return { diff, px: withIt.length / 4 };
        }""")
        check(not edge.get("err"),
              "control: the shelf is back at the top, so there IS more below to "
              "be told about", edge)
        if not edge.get("err"):
            check(edge["diff"] > 400,
                  "SHE IS TOLD THERE IS MORE BELOW — and turning the fade and the "
                  "bar off removes it, which is the control",
                  "%s pixels of %s changed in the strip" % (edge["diff"], edge["px"]))

        if shots:
            SHOTS.mkdir(exist_ok=True)
            pg.screenshot(path=str(SHOTS / "scroll-shop-more.png"))
        ctx.close()

        # ---- the kennel at six, photographed --------------------------------
        if shots:
            ctx, pg = fresh()
            pg.evaluate("""() => {
              const pp = window.__pp;
              while (pp.app.game.roster().length < 6) pp.addDog('D' + pp.app.game.roster().length);
              pp.openKennel(); pp.step(1/60, 30);
            }""")
            pg.screenshot(path=str(SHOTS / "scroll-kennel-six-top.png"))
            pg.evaluate("""() => {
              const pp = window.__pp;
              for (let i = 0; i < 4; i++) pp.dragAt(195, 500, -240, 8);
              pp.step(1/60, 60);
            }""")
            pg.screenshot(path=str(SHOTS / "scroll-kennel-six-bottom.png"))
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
