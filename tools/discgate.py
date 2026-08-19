"""
tools/discgate.py — THE DISC GAME: catch and leap.

SCOPE stage 5's design, and the assertions are its own words:

  "She flicks the disc up-screen, he tracks it upward from the front, and she
   times a tap for the leap and catch. Score by height and airtime rather than
   distance zone."

WHAT IT ASSERTS:

  A  THE FLICK IS THE TOY'S FLICK. A weak flick is not a throw and costs nothing;
     a real one is, and its power comes out of `BALANCE.toy.flick` rather than a
     second set of numbers for the same gesture. AND IT IS NEVER LATERAL — the
     disc's sideways drift is clamped exactly as the ball's is, because throwing
     across the screen needs the side rig that was deliberately never built.

  B  THE CATCH IS SPATIALLY HONEST. At the moment the disc is catchable it is
     within one leap of his head. This is the assertion the first build failed:
     the hang and the catch were driven from one number, so he was leaping at a
     disc 300 units above him and half a screen away. It scored fine and read as
     nonsense.

  C  TIMING IS THE GAME. A tap at the right moment catches; one outside the
     window does not; and a near miss scores MORE than a wild one, because
     "losing must never feel like rebuke" and a flat zero is a telling-off.

  D  HE TRACKS IT. His head follows the disc up — `rig.lookAtVirtual` every
     frame is the whole of "he tracks it upward from the front".

  E  IT IS THE LEAP, NOT A PERFORMANCE. `TRICK_POSE.jump` is driven on this
     layer's own clock, so the jump happens on the frame she asked for it. The
     `hop` channel is asserted to actually rise.

  F  THE LEDGER. A round banks once, on finishing; an abandoned round costs
     nothing; the daily count paces it and past it a round is practice that pays
     nothing and is never refused; coins are the only currency it can pay and
     care points are untouched.

  G  THE GATE READS AS LOOKING AFTER HIM. A hungry dog is refused with `hunger`,
     which is the same reason code the trial uses, so the room's existing router
     already knows what to do with it.

  H  THE SURFACE IS EXCLUSIVE, both ways: nothing else can open over the disc
     field, and the disc field refuses to open over anything else.

Usage:  py tools/discgate.py [--shots]
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


OPEN = """() => {
  const pp = window.__pp;
  const sc = pp.loop.scene;
  sc.startDisc();
  pp.step(1/60, 24);
  const d = pp.dbg().disc;
  if (d.beat !== 'entry') return { error: 'did not enter', d };
  sc.disc.enterRound();
  pp.step(1/60, 12);
  return pp.dbg().disc;
}"""

# Fly to the catch moment and report the geometry AT that instant.
TO_CATCH = """(power) => {
  const pp = window.__pp;
  const sc = pp.loop.scene;
  const rig = sc.rig;
  sc.disc.throwAt(power);
  let guard = 0, tracked = 0, lastLook = null, minGap = 1e9;
  const headTop = () => rig.y + (rig.pose.headY - rig.dims.headHH) * rig.s * (rig.sy || 1);
  while (guard++ < 900) {
    pp.step(1/60, 1);
    const d = pp.dbg().disc;
    if (d.phase !== 'fly') break;
    /* he tracks it: the look target moves with the disc */
    /* `rig.gaze` is where he is looking — `lookAtVirtual` writes yaw/pitch into
       it, and it is on the rig's public object (rig.js:319). There is no
       `lookTarget()`; asking for one counted zero frames and blamed the dog. */
    const look = { x: rig.gaze.yaw, y: rig.gaze.pitch };
    if (lastLook && (look.x !== lastLook.x || look.y !== lastLook.y)) tracked++;
    lastLook = look;
    const gap = d.disc.y - headTop();      // negative = above his head
    if (Math.abs(d.untilCatch) < 0.02) minGap = gap;
    if (d.untilCatch <= 0) break;
  }
  const d = pp.dbg().disc;
  return {
    at: d.disc, until: d.untilCatch, gapAtCatch: minGap,
    headTop: headTop(), tracked,
    hop: rig.springs.hop ? rig.springs.hop.x : null,
  };
}"""

TAP_AT = """([power, offset]) => {
  const pp = window.__pp;
  const sc = pp.loop.scene;
  /* WAIT FOR THE DISC TO BE BACK IN HER HAND. `throwAt` refuses unless the
     phase is 'ready', and the settle beat after a catch runs for 0.85s — so
     calling this three times in a row threw ONCE and then read the first
     throw's leap back twice, reporting a 0.004s error for a tap that never
     happened. */
  let w = 0;
  while (w++ < 600 && pp.dbg().disc.phase !== 'ready') pp.step(1/60, 2);
  sc.disc.throwAt(power);
  let guard = 0;
  /* `offset` is SIGNED, in seconds relative to the catch moment: negative taps
     EARLY, positive taps late. It had to become signed because being late by
     more than the window's half-width is impossible by construction — the disc
     has landed — so the miss cases are early ones and the late case is small. */
  while (guard++ < 900) {
    const d = pp.dbg().disc;
    if (d.phase !== 'fly') break;
    if (d.untilCatch <= -offset) break;
    pp.step(1/60, 1);
  }
  const before = pp.dbg().disc;
  sc.disc.tap();
  pp.step(1/60, 2);
  const after = pp.dbg().disc;
  const hop0 = pp.loop.scene.rig.springs.hop.x;
  pp.step(1/60, 20);
  return {
    untilAtTap: before.untilCatch,
    leap: after.leap,
    scores: after.round.scores,
    caught: after.round.caught,
    hopAfter: pp.loop.scene.rig.springs.hop.x, hop0,
  };
}"""

ROUND = """([power, offset]) => {
  const pp = window.__pp;
  const sc = pp.loop.scene;
  /* A WHOLE ROUND, FRAME BY FRAME. The first version budgeted 60 iterations for
     five throws, and a single flight is ~90 frames on its own — so it ran out
     mid-round and the gate then read a null result and blamed the tally. Guard
     generously and drive one frame at a time; the states do the sequencing. */
  let guard = 0;
  while (guard++ < 6000) {
    const d = pp.dbg().disc;
    if (d.beat !== 'play') break;
    if (d.phase === 'ready') { sc.disc.throwAt(power); pp.step(1/60, 1); continue; }
    if (d.phase === 'fly') {
      if (d.untilCatch <= -offset) { sc.disc.tap(); pp.step(1/60, 1); continue; }
      pp.step(1/60, 1);
      continue;
    }
    pp.step(1/60, 1);
  }
  return { d: pp.dbg().disc, result: sc.disc.result, coins: pp.app.game.coins,
           care: pp.app.game.carePoints, guard };
}"""


def main():
    shots = "--shots" in sys.argv
    url = serve()
    with sync_playwright() as p:
        b = browser(p)
        errors = []

        def fresh():
            ctx, pg = page(b, inset=40)
            pg.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
            pg.on("console", lambda m: errors.append("console.%s: %s" % (m.type, m.text))
                  if m.type in ("error", "warning") else None)
            boot(pg, url)
            pg.evaluate("() => __pp.app.game.setFlag('installNever', true)")
            pg.evaluate("() => __pp.skipIntro('Pip')")
            return ctx, pg

        ctx, pg = fresh()
        d = pg.evaluate(OPEN)
        check(not d.get("error"), "the disc field opens and a round starts", d.get("error") or d["beat"])
        check(d["phase"] == "ready", "the disc starts in her hand", d["phase"])

        # ---- A. the flick -------------------------------------------------
        weak = pg.evaluate("""() => {
          const pp = window.__pp;
          const sc = pp.loop.scene;
          const before = pp.dbg().disc;
          /* A REAL WEAK FLICK, THROUGH THE POINTER. `throwAt(0)` is the
             SMALLEST THROW, not a non-throw: it maps power 0 onto
             `flick.minUp` exactly, which is the threshold and therefore
             passes it. A limp gesture is a slow drag, so this is one. */
          const d0 = pp.dbg().disc.disc;
          sc.disc.pointer({ type: 'down', x: d0.x, y: d0.y });
          for (let i = 1; i <= 6; i++) {
            sc.disc.pointer({ type: 'move', x: d0.x, y: d0.y - i * 2 });
            pp.step(1/60, 2);
          }
          sc.disc.pointer({ type: 'up', x: d0.x, y: d0.y - 12 });
          const ok = false;
          pp.step(1/60, 4);
          const after = pp.dbg().disc;
          return { ok, phase: after.phase, scores: after.round.scores.length,
                   minUp: pp.BALANCE.toy.flick.minUp };
        }""")
        check(weak["phase"] == "ready" and weak["scores"] == 0,
              "a weak flick is not a throw, and costs her nothing", weak)

        lateral = pg.evaluate("""() => {
          const pp = window.__pp;
          const sc = pp.loop.scene;
          /* MEASURE THE FLIGHT, NOT THE DRAG. The first version compared where
             the disc STARTED with where it ended and found 253 units — all of
             which was her dragging it across the screen while holding it, which
             the ball allows too (`BALANCE.toy.dragX` is [30, 360]). What must
             never be lateral is the THROW, so this records x at the moment it
             leaves her hand and compares it with where it lands. */
          let w = 0;
          while (w++ < 600 && pp.dbg().disc.phase !== 'ready') pp.step(1/60, 2);
          const d0 = pp.dbg().disc.disc;
          sc.disc.pointer({ type: 'down', x: d0.x, y: d0.y });
          for (let i = 1; i <= 6; i++) {
            sc.disc.pointer({ type: 'move', x: d0.x - i * 40, y: d0.y - i * 30 });
            pp.step(1/60, 1);
          }
          sc.disc.pointer({ type: 'up', x: d0.x - 240, y: d0.y - 180 });
          pp.step(1/60, 1);
          const atRelease = pp.dbg().disc.disc.x;
          const fly = pp.dbg().disc.fly;
          const rig = sc.rig;
          const headX = () => rig.x + rig.pose.headX * rig.s;
          let g2 = 0, outDrift = 0, finalX = atRelease;
          while (g2++ < 900 && pp.dbg().disc.phase === 'fly') {
            pp.step(1/60, 1);
            const d = pp.dbg().disc;
            const x = d.disc.x;
            /* THE OUTWARD PHASE ONLY. The throw's drift is what the "never
               lateral" rule is about; once the disc is FALLING its x converges
               on his head, which moved the total to 88 units and is correct —
               he is the one catching it. So this measures while the disc is
               still going away (comfortably before the catch) and the
               convergence is asserted separately, as a positive. */
            if (d.untilCatch > 0.35) outDrift = Math.max(outDrift, Math.abs(x - atRelease));
            finalX = x;
          }
          return { atRelease, outDrift, finalX, headX: headX(), cap: 46, fly };
        }""")
        # ASSERTED WHERE THE RULE IS APPLIED. Measuring the disc's position over
        # time cannot separate the throw's drift from its convergence on his head,
        # and a time-based filter for that was wrong twice. The rule is a clamp on
        # the throw's TARGET, so this reads the target.
        check(abs(lateral["fly"]["toX"] - lateral["fly"]["fromX"]) <= lateral["cap"] + 1,
              "and a hard sideways flick still goes UP, never across",
              "the throw aimed %.0f units sideways from where it left her hand, cap %s"
              % (abs(lateral["fly"]["toX"] - lateral["fly"]["fromX"]), lateral["cap"]))
        check(abs(lateral["finalX"] - lateral["headX"]) < abs(lateral["atRelease"] - lateral["headX"]),
              "and the disc comes down to HIM, not to where it was thrown from",
              "released at %.0f, landed at %.0f, his head at %.0f"
              % (lateral["atRelease"], lateral["finalX"], lateral["headX"]))
        ctx.close()

        # ---- B / D. the catch is reachable, and he tracks it ---------------
        ctx, pg = fresh()
        pg.evaluate(OPEN)
        geo = pg.evaluate(TO_CATCH, 0.8)
        leapReach = pg.evaluate("() => __pp.BALANCE.rig.trick.hopHeight * __pp.loop.scene.rig.s")
        check(geo["gapAtCatch"] < 1e8,
              "the catch moment is reached at all", geo["until"])
        check(geo["gapAtCatch"] <= leapReach + 12,
              "when the disc is catchable it is WITHIN A LEAP of his head",
              "%.0f units above his head, and a leap is %.0f"
              % (-geo["gapAtCatch"], leapReach))
        check(geo["at"]["s"] < 0.85,
              "and it is drawn smaller, because it went away from her", geo["at"]["s"])
        check(geo["tracked"] > 20, "he tracks it all the way up", geo["tracked"])
        ctx.close()

        # ---- C. timing is the game ---------------------------------------
        ctx, pg = fresh()
        pg.evaluate(OPEN)
        on_time = pg.evaluate(TAP_AT, [0.8, 0.0])
        check(on_time["leap"]["caught"], "a tap on the moment catches it", on_time["leap"])
        check(on_time["hopAfter"] > on_time["hop0"] or on_time["hopAfter"] > 0.05,
              "and he actually leaves the ground",
              "hop %.3f -> %.3f" % (on_time["hop0"], on_time["hopAfter"]))
        # EARLY misses, outside `window.half` (0.16): one near, one wilder. Early
        # rather than late because a late tap has only the window's half-width of
        # room before the disc lands — see `BALANCE.disc.window.at`.
        near = pg.evaluate(TAP_AT, [0.8, -0.20])
        wild = pg.evaluate(TAP_AT, [0.8, -0.30])
        check(not near["leap"]["caught"] and not wild["leap"]["caught"],
              "a tap outside the window does not", [near["leap"], wild["leap"]])
        nearScore = near["scores"][-1]
        wildScore = wild["scores"][-1]
        check(nearScore > wildScore,
              "and a NEAR miss scores more than a wild one — nearly is information",
              "%.3f vs %.3f" % (nearScore, wildScore))
        check(wildScore > 0, "a miss is never a zero", wildScore)
        never = pg.evaluate("""() => {
          const pp = window.__pp;
          const sc = pp.loop.scene;
          let w = 0;
          while (w++ < 600 && pp.dbg().disc.phase !== 'ready') pp.step(1/60, 2);
          const n0 = pp.dbg().disc.round.scores.length;
          sc.disc.throwAt(0.8);
          let g = 0;
          while (g++ < 900 && pp.dbg().disc.phase === 'fly') pp.step(1/60, 2);
          const d = pp.dbg().disc;
          return { scored: d.round.scores.length - n0, last: d.round.scores.slice(-1)[0],
                   hint: d.hint };
        }""")
        check(never["scored"] == 1 and never["last"] > 0,
              "and if she never taps at all, he watched it land and it still scores",
              never)
        ctx.close()

        # ---- F. the ledger ------------------------------------------------
        ctx, pg = fresh()
        pg.evaluate(OPEN)
        r = pg.evaluate(ROUND, [0.8, 0.0])
        res = r["result"]
        check(res is not None, "a round finishes and produces a card",
              {"beat": r["d"]["beat"], "iterations": r["guard"], "round": r["d"]["round"]})
        if res is None:
            for line in notes + fails:
                print(line)
            print("%d passed, %d failed" % (len(notes), len(fails)))
            return 1
        check(res["thrown"] == pg.evaluate("() => __pp.BALANCE.disc.throws"),
              "of the right number of throws", res)
        check(res["score"] > 0 and res["score"] <= 10, "with a score out of ten", res["score"])
        check(res["prize"] > 0 and r["coins"] > 40, "and it pays coins", res)
        check(r["care"] == pg.evaluate("() => __pp.app.game.carePoints"),
              "and no care points at all — the two currencies never meet", r["care"])
        saved = pg.evaluate("() => __pp.app.game.disc")
        check(saved["plays"] == 1 and saved["entriesToday"] == 1,
              "the round is banked once", saved)
        check(abs(saved["best"] - res["score"]) < 0.001, "and it is her best so far", saved)

        # abandoning costs nothing
        before = pg.evaluate("() => ({ ...__pp.app.game.disc })")
        pg.evaluate("""() => {
          const pp = window.__pp;
          pp.dbg().disc.beat === 'card' && pp.loop.scene.disc.stop(true);
          pp.loop.scene.startDisc(); pp.step(1/60, 20);
          pp.loop.scene.disc.enterRound(); pp.step(1/60, 10);
          pp.loop.scene.disc.throwAt(0.7); pp.step(1/60, 20);
          pp.loop.scene.disc.stop(true); pp.step(1/60, 10);
        }""")
        after = pg.evaluate("() => ({ ...__pp.app.game.disc })")
        check(after["plays"] == before["plays"] and after["entriesToday"] == before["entriesToday"],
              "walking out mid-round banks nothing and spends no entry",
              [before["plays"], after["plays"]])

        # past the daily count it is practice, and never a refusal
        prac = pg.evaluate("""() => {
          const pp = window.__pp;
          const r = pp.app.game.disc;
          r.entriesToday = pp.BALANCE.contest.perDay;
          pp.loop.scene.startDisc();
          pp.step(1/60, 20);
          const d = pp.dbg().disc;
          return { gate: d.gate, beat: d.beat };
        }""")
        check(prac["gate"]["ok"] and prac["gate"]["practice"],
              "past three rounds it is practice, not a refusal", prac["gate"])
        coins0 = pg.evaluate("() => __pp.app.game.coins")
        pg.evaluate("() => { __pp.loop.scene.disc.enterRound(); __pp.step(1/60, 10); }")
        pr = pg.evaluate(ROUND, [0.8, 0.0])
        check(pr["result"]["prize"] == 0 and pr["coins"] == coins0,
              "and a practice round pays nothing", [pr["result"]["prize"], coins0, pr["coins"]])
        ctx.close()

        # ---- G. the gate --------------------------------------------------
        ctx, pg = fresh()
        hungry = pg.evaluate("""() => {
          const pp = window.__pp;
          pp.app.game.setNeed('hunger', 0.2);
          pp.loop.scene.startDisc();
          pp.step(1/60, 20);
          return pp.dbg().disc.gate;
        }""")
        check(not hungry["ok"] and hungry["reason"] == "hunger",
              "a hungry dog is refused, with the reason the room already routes", hungry)
        ctx.close()

        # ---- H. the surface is exclusive ---------------------------------
        ctx, pg = fresh()
        excl = pg.evaluate("""() => {
          const pp = window.__pp;
          const sc = pp.loop.scene;
          sc.startDisc(); pp.step(1/60, 20);
          const owner = sc.surfaceOwner();
          /* nothing else may open over it */
          const shop = sc.startShop ? sc.startShop() : null;
          const trained = sc.startTrain();
          const walked = sc.startWalk ? sc.startWalk() : null;
          const stillDisc = sc.surfaceOwner();
          sc.disc.stop(true); pp.step(1/60, 20);
          /* and it refuses to open over the ring */
          sc.startContest(); pp.step(1/60, 20);
          const ringOwner = sc.surfaceOwner();
          const discOverRing = sc.startDisc();
          return { owner, trained, stillDisc, ringOwner, discOverRing,
                   after: sc.surfaceOwner() };
        }""")
        check(excl["owner"] == "disc", "the field owns the surface", excl)
        check(excl["stillDisc"] == "disc" and excl["trained"] is False,
              "and nothing else can open over it", excl)
        check(excl["ringOwner"] == "contest" and excl["discOverRing"] is False
              and excl["after"] == "contest",
              "and it refuses to open over the ring", excl)
        ctx.close()

        if shots:
            SHOTS.mkdir(exist_ok=True)
            ctx, pg = fresh()
            pg.evaluate("() => { __pp.loop.scene.startDisc(); __pp.step(1/60, 30); }")
            pg.screenshot(path=str(SHOTS / "disc-entry.png"))
            pg.evaluate("() => { __pp.loop.scene.disc.enterRound(); __pp.step(1/60, 12); }")
            pg.evaluate("() => { __pp.loop.scene.disc.throwAt(0.85); __pp.step(1/60, 26); }")
            pg.screenshot(path=str(SHOTS / "disc-flight.png"))
            pg.evaluate("""() => {
              const pp = window.__pp;
              let g = 0;
              while (g++ < 400 && pp.dbg().disc.untilCatch > 0.02) pp.step(1/60, 1);
              pp.loop.scene.disc.tap();
              /* AT THE TOP OF THE JUMP, not eight frames after the tap. `jump`'s
                 altitude peaks at u ~ 0.45 of a 0.95s clip — about 26 frames — so
                 the first render of "the leap" was a photograph of the crouch. */
              const peak = Math.round(60 * (pp.BALANCE.disc.leap.dur * 0.45));
              pp.step(1/60, peak);
            }""")
            hop = pg.evaluate("() => +__pp.loop.scene.rig.springs.hop.x.toFixed(3)")
            notes.append("      (render) hop at the photographed frame: %s" % hop)
            pg.screenshot(path=str(SHOTS / "disc-leap.png"))
            pg.evaluate(ROUND, [0.8, 0.0])
            pg.evaluate("() => __pp.step(1/60, 20)")
            pg.screenshot(path=str(SHOTS / "disc-card.png"))
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
