"""
tools/discgate.py — THE DISC GAME: catch and leap.

SCOPE stage 5's design, and the assertions are its own words:

  "She flicks the disc up-screen, he tracks it upward from the front, and she
   times a tap for the leap and catch. Score by height and airtime rather than
   distance zone."

WHAT IT ASSERTS:

  A  THE FLICK IS THE TOY'S FLICK, DRIVEN THROUGH THE ROOM. Every gesture here
     goes through `scene.pointer(app, ev)` — the door a thumb comes through —
     and never through `disc.pointer` directly. That distinction is not
     pedantry: the first build routed only `down` to the disc layer, so the
     trail and the release never arrived and THE DISC COULD NOT BE THROWN AT
     ALL, while this gate passed 31 checks by talking to the layer directly.
     Reported from the phone as "it seems like i cannot flick the disc at all". A weak flick is not a throw and costs nothing;
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


# EVERY GESTURE GOES THROUGH THE ROOM. `scene.pointer(app, ev)` is what the
# input layer calls; `disc.pointer` is the layer's own door and testing it
# proves only that the layer works when something remembers to knock.
FLICK = """([fromX, fromY, dx, dy, steps]) => {
  const pp = window.__pp;
  const sc = pp.loop.scene;
  const send = (type, x, y, moved) => sc.pointer(pp.app,
    { type, x, y, id: 1, dx: 0, dy: 0, speed: 0, dist: 0, moved: !!moved });
  send('down', fromX, fromY, false);
  pp.step(1/60, 1);
  for (let i = 1; i <= steps; i++) {
    send('move', fromX + dx * i / steps, fromY + dy * i / steps, true);
    pp.step(1/60, 1);
  }
  send('up', fromX + dx, fromY + dy, true);
  pp.step(1/60, 1);
  return pp.dbg().disc;
}"""

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

        # ---- A. the flick, THROUGH THE ROOM -------------------------------
        d0 = pg.evaluate("() => __pp.dbg().disc")
        real = pg.evaluate(FLICK, [d0["disc"]["x"], d0["disc"]["y"], 0, -170, 7])
        check(real["phase"] == "fly",
              "A REAL THUMB FLICK, through scene.pointer, throws the disc",
              {"phase": real["phase"], "fly": real["fly"]})
        check(real["fly"] and real["fly"]["power"] > 0.5,
              "and its power comes out of the gesture, not a constant",
              real["fly"])

        # a limp drag is not a throw, and costs her nothing
        pg.evaluate("""() => {
          const pp = window.__pp;
          let g = 0;
          while (g++ < 900 && pp.dbg().disc.phase !== 'ready') pp.step(1/60, 2);
        }""")
        d1 = pg.evaluate("() => __pp.dbg().disc")
        weak = pg.evaluate(FLICK, [d1["disc"]["x"], d1["disc"]["y"], 0, -12, 6])
        check(weak["phase"] == "ready",
              "a limp drag is not a throw, and costs her nothing",
              {"phase": weak["phase"], "scores": len(weak["round"]["scores"])})

        # ...and a hard SIDEWAYS flick comes down BESIDE HIM, not across the room.
        #
        # THIS ASSERTION USED TO MEASURE THE WRONG DISTANCE, and it passed anyway,
        # which is the more interesting half. It compared the landing with WHERE IT
        # LEFT HER HAND and called anything under 47 units "never across" — a
        # faithful reading of the old code, where `to.x` was `disc.x + lateral`.
        # Her hand is in the bottom-right corner, 152 units from where he stands,
        # so that clamp kept every disc near the CORNER rather than near the DOG,
        # and it only looked right because the disc then curved onto his head.
        # With the curve gone he was running at a cap of 58 toward a disc a
        # screen-width away. The landing is measured from HIM now, and so is this.
        d2 = pg.evaluate("() => __pp.dbg().disc")
        side = pg.evaluate(FLICK, [d2["disc"]["x"], d2["disc"]["y"], -240, -180, 6])
        check(side["phase"] == "fly", "a diagonal flick is still a throw", side["phase"])
        home = pg.evaluate("() => Math.round(__pp.loop.scene.rig.home.x)")
        drift = pg.evaluate("() => __pp.BALANCE.disc.fly.drift")
        reach = pg.evaluate("() => __pp.BALANCE.disc.leap.reach")
        offHim = abs(side["fly"]["toX"] - home)
        check(offHim <= drift + 1,
              "a hard sideways flick comes down within the drift OF HIM",
              "%s units to one side of him, cap %s" % (offHim, drift))
        check(reach >= drift,
              "and he can cover every landing the drift allows",
              "reach %s vs drift %s" % (reach, drift))

        # and a real TAP on the screen makes him leap — the other thumb gesture
        tapReal = pg.evaluate("""() => {
          const pp = window.__pp;
          const sc = pp.loop.scene;
          let g = 0;
          while (g++ < 900 && pp.dbg().disc.phase !== 'fly') pp.step(1/60, 2);
          let g2 = 0;
          while (g2++ < 900 && pp.dbg().disc.untilCatch > 0.01) pp.step(1/60, 1);
          sc.pointer(pp.app, { type: 'down', x: 195, y: 500, id: 1,
                               dx: 0, dy: 0, speed: 0, dist: 0, moved: false });
          pp.step(1/60, 2);
          return pp.dbg().disc;
        }""")
        check(tapReal["leap"] is not None,
              "and a real tap anywhere on the screen makes him leap", tapReal["leap"])

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


        # ---- F. HE GOES TO IT, AND HE COMES DOWN WITH IT -------------------
        #
        # The player, on 8.17.0: "i want the dog to actually catch the disc
        # instead of just staying in place and jumping slightly". Three separate
        # faults in one sentence, so three separate assertions — and each one is
        # measured on the thing she was looking at, not on the thing that caused
        # it.
        ctx, pg = fresh()
        pg.evaluate(OPEN)
        catch = pg.evaluate("""(side) => {
          const pp = window.__pp, sc = pp.loop.scene, rig = sc.rig;
          const home = rig.home.x;
          /* a full sideways flick: it comes down `fly.drift` to one side of him */
          sc.disc.throwAt(0.9, side);
          const land = pp.dbg().disc.fly.toX;
          let g = 0, far = 0, hop = 0;
          /* run him to it, watching how far he travels and how high he goes */
          while (g++ < 400 && pp.dbg().disc.untilCatch > 0.004) {
            pp.step(1/60, 1);
            far = Math.max(far, Math.abs(rig.x - home));
          }
          /* the tap, through the scene, on the moment */
          sc.pointer(pp.app, { type: 'down', x: 195, y: 520, id: 1,
                               dx: 0, dy: 0, speed: 0, dist: 0, moved: false });
          let gapAtCatch = 1e9, gotIt = false;
          let h = 0;
          while (h++ < 120) {
            pp.step(1/60, 1);
            hop = Math.max(hop, rig.springs.hop.x);
            const d = pp.dbg().disc;
            if (d.disc.mouth && !gotIt) {
              gotIt = true;
              /* how far his HEAD was from the disc when he took it */
              gapAtCatch = Math.abs((rig.x + rig.pose.headX * rig.s) - land);
              break;
            }
          }
          const held = pp.dbg().disc;
          /* and where the disc is drawn while he holds it: at his muzzle */
          const muz = { x: rig.x + rig.pose.muzX * rig.s,
                        y: rig.y + rig.pose.muzY * rig.s * (rig.sy || 1) };
          pp.step(1/60, 40);
          const later = pp.dbg().disc;
          return {
            home: Math.round(home), land: Math.round(land),
            ranTo: Math.round(far), gapAtCatch: Math.round(gapAtCatch),
            hop: +hop.toFixed(2), mouth: held.disc.mouth,
            fromMuzzle: Math.round(Math.hypot(held.disc.x - muz.x, held.disc.y - muz.y)),
            stillHolding: later.disc.mouth,
            cameBack: Math.round(Math.abs(rig.x - home)),
          };
        }""", 1)
        check(catch["ranTo"] > 40,
              "he COVERS GROUND to get under a sideways throw",
              "%s units from home, to a disc that came down %s units away"
              % (catch["ranTo"], abs(catch["land"] - catch["home"])))
        check(catch["gapAtCatch"] < 26,
              "and his head is under the disc when he takes it",
              "%s units off" % catch["gapAtCatch"])
        # the leap, in the units the pose is written in: `hop` 1.0 is a trick
        # jump, so anything at or under that is the "jumping slightly" she saw.
        check(catch["hop"] > 1.5,
              "the leap is a leap, not a hop",
              "hop %s (a trick jump is 1.0)" % catch["hop"])
        check(catch["mouth"] and catch["fromMuzzle"] < 34,
              "the disc ends up IN HIS MOUTH, drawn at his muzzle",
              "mouth=%s, %s units from the muzzle" % (catch["mouth"], catch["fromMuzzle"]))
        check(catch["stillHolding"],
              "he is still holding it after he lands — a catch has an after")
        check(catch["cameBack"] < catch["ranTo"],
              "and he brings it back toward the middle",
              "%s units from home, having run %s" % (catch["cameBack"], catch["ranTo"]))
        ctx.close()

        # ---- F2. ALL OF HIM STAYS ON THE SCREEN ---------------------------
        # The first run of this feature sent him to x 106 for a hard leftward
        # flick and the render came back with his left ear cut flat against x 0.
        # His silhouette was then MEASURED (135 units to the left ear, 106-118 to
        # the right, three breeds) and `leap.edge` is that measurement — so this
        # drives both extremes and asserts he never leaves the frame.
        ctx, pg = fresh()
        pg.evaluate(OPEN)
        edges = pg.evaluate("""(edge) => {
          const pp = window.__pp, sc = pp.loop.scene, rig = sc.rig;
          const VW = pp.BALANCE.view.W;
          const out = [];
          for (const side of [-1, 1]) {
            let w = 0;
            while (w++ < 900 && pp.dbg().disc.phase !== 'ready') pp.step(1/60, 2);
            sc.disc.throwAt(0.9, side);
            let lo = 1e9, hi = -1e9, g = 0;
            while (g++ < 300 && pp.dbg().disc.phase === 'fly') {
              pp.step(1/60, 1);
              lo = Math.min(lo, rig.x); hi = Math.max(hi, rig.x);
            }
            out.push({ side, lo: Math.round(lo), hi: Math.round(hi),
                       leftEdge: Math.round(lo - edge), rightEdge: Math.round(VW - (hi + edge)) });
          }
          return out;
        }""", pg.evaluate("() => __pp.BALANCE.disc.leap.edge"))
        for e in edges:
            check(e["leftEdge"] >= 0 and e["rightEdge"] >= 0,
                  "a full %s flick keeps all of him on screen"
                  % ("leftward" if e["side"] < 0 else "rightward"),
                  "stood between x %s and %s; %s units of him spare on the left, %s on the right"
                  % (e["lo"], e["hi"], e["leftEdge"], e["rightEdge"]))
        ctx.close()

        # ---- G. A MISS LANDS, AND THE ROOM GETS HIM BACK -------------------
        # The disc used to stop dead at head height and hang in the air until the
        # apex of the leap deleted it: the catch had no moment and the miss had no
        # consequence. It falls through and lands now.
        ctx, pg = fresh()
        pg.evaluate(OPEN)
        miss = pg.evaluate("""() => {
          const pp = window.__pp, sc = pp.loop.scene, rig = sc.rig;
          sc.disc.throwAt(0.85, -1);
          let g = 0, lowest = -1e9, hovered = 0, lastY = -1e9;
          while (g++ < 500) {
            pp.step(1/60, 1);
            const d = pp.dbg().disc;
            lowest = Math.max(lowest, d.disc.y);
            /* HOVERING IS THE OLD BUG, AND ONLY BELOW THE CATCH LINE IS THE
               OLD BUG. A disc HANGS near the apex on purpose — `fly.hang` is
               0.30 of the flight and that is the part she times against — so a
               standstill detector that watched the whole flight flagged 34
               frames of the intended design and called it the defect. What must
               never happen is the disc stopping where his jaws are and waiting
               to be collected, which is what it used to do. */
            if (Math.abs(d.disc.y - lastY) < 0.25 && !d.disc.down
              && d.disc.y > d.him.catchY - 10) hovered++;
            lastY = d.disc.y;
            if (d.disc.down) break;
          }
          const d = pp.dbg().disc;
          const ground = rig.y - 6;
          /* then leave the field mid-round, through the real back button, and
             see what state the room is handed. Driven with `scene.pointer` for
             the reason 8.16.1 exists: a gate that calls past the routing is not
             testing the routing. */
          const B = pp.BALANCE.contest.ring.back;
          sc.pointer(pp.app, { type: 'down', x: B.x, y: B.y, id: 1,
                               dx: 0, dy: 0, speed: 0, dist: 0, moved: false });
          pp.step(1/60, 30);
          return {
            down: d.disc.down, y: Math.round(d.disc.y), ground: Math.round(ground),
            scale: d.disc.s, hovered,
            rigBack: Math.round(Math.abs(rig.x - rig.home.x)), sy: rig.sy,
          };
        }""")
        check(miss["down"], "a throw nobody taps falls all the way to the grass", miss)
        check(abs(miss["y"] - miss["ground"]) <= 14,
              "and comes to rest at his feet, not in the air",
              "y %s, the grass at his paws is %s" % (miss["y"], miss["ground"]))
        check(miss["scale"] > 0.7,
              "drawn at his depth once it is down there, not still in the distance",
              miss["scale"])
        check(miss["hovered"] < 6,
              "and it never stops at his jaws waiting to be collected",
              "%s frames at a standstill at or below the catch line" % miss["hovered"])
        check(miss["rigBack"] == 0 and abs(miss["sy"] - 1) < 1e-6,
              "leaving mid-round hands the room a dog standing where it left him",
              miss)
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
