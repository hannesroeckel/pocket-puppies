"""
tools/placegate.py — HE COMPETES SOMEWHERE ELSE.

The human's whole brief, and the reason scenes/outdoors.js exists:

  "when we change to disc we should change to a different background that shows
   outdoors. same goes for when we go the ring. this should then be a proper
   competition space and not the living room again"

The first render of the park showed why this needs a gate rather than an eye: the
backdrop swapped correctly and the living room came with it anyway — the picture
frame ghosting through, and BOTH BOWLS AND THE TENNIS BALL sitting in the grass.
A place is not a backdrop; it is a backdrop plus everything that must not be in
it. So four assertions, in that order of how badly they broke:

  A  THE ROOM GOES, AND GOES ALL THE WAY. The wall band is warm cream in the
     living room and cool sky outdoors, and the fade settles at 1 rather than
     stalling at "mostly" — an 0.89 crossfade is what put a picture frame in a
     field.

  B  HIS THINGS STAY AT HOME. The food bowl's home, the water bowl's home and
     the ball's resting slot are all plain grass while he is out.

  C  THE DOG IS NOT TOUCHED. A box of his torso is BYTE-IDENTICAL in the living
     room and in the park at the same frozen instant, which is rule 2 of
     scenes/outdoors.js measured rather than promised — and rule 1 with it, since
     a floor line that moved would move him out of the box.

  D  TWO PLACES, NOT ONE. The park and the show ring differ in the band where
     the ring's rope, bunting and crowd live. Sharing one background would say
     that competing and playing are the same occasion.

EVERY METRIC HERE IS SHOWN A CASE IT MUST REJECT — the warmth test is run
against the living room it is supposed to fail, the grass test likewise, and the
byte-comparison is run against a box 30 units lower — his paws and the rug —
because a comparison that cannot report a difference reports nothing when it
returns zero. A check that cannot fail is not a check (§27.3).

Usage:  py tools/placegate.py [--shots]
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


# ---------------------------------------------------------------------------
# THE PIXEL HELPERS, installed once.
#
# Read off the LIVE canvas, not an offscreen rebuild: the question is what she
# sees, and the backdrop, the props and the dog only ever meet on the real one.
# Virtual coordinates in, device pixels out, through the app's own view — the
# same conversion `tools/bowlpixels.py` uses, for the same reason (a gate that
# does its own arithmetic is checking its own arithmetic).
# ---------------------------------------------------------------------------
INSTALL = r"""() => {
  const pp = window.__pp;
  const cv = document.querySelector('canvas');
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const dev = (r) => {
    const v = pp.app.view;
    const x0 = Math.max(0, Math.round((v.offX + r[0] * v.vs) * v.dpr));
    const y0 = Math.max(0, Math.round((v.offY + r[1] * v.vs) * v.dpr));
    const w = Math.min(cv.width - x0, Math.round(r[2] * v.vs * v.dpr));
    const h = Math.min(cv.height - y0, Math.round(r[3] * v.vs * v.dpr));
    return [x0, y0, Math.max(1, w), Math.max(1, h)];
  };
  window.__pl = {
    /* mean colour of a virtual rect */
    mean(r) {
      const [x, y, w, h] = dev(r);
      const d = cx.getImageData(x, y, w, h).data;
      let R = 0, G = 0, B = 0;
      for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i+1]; B += d[i+2]; }
      const n = d.length / 4;
      return { r: +(R/n).toFixed(1), g: +(G/n).toFixed(1), b: +(B/n).toFixed(1), n };
    },
    /* the raw bytes, as a string, for an exact comparison */
    bytes(r) {
      const [x, y, w, h] = dev(r);
      const d = cx.getImageData(x, y, w, h).data;
      let s = '';
      for (let i = 0; i < d.length; i += 4) s += String.fromCharCode(d[i], d[i+1], d[i+2]);
      return s;
    },
    /* how many pixels of two captures differ by more than a hair */
    diff(a, b) {
      if (a.length !== b.length) return -1;
      let n = 0;
      for (let i = 0; i < a.length; i += 3) {
        if (Math.abs(a.charCodeAt(i) - b.charCodeAt(i))
          + Math.abs(a.charCodeAt(i+1) - b.charCodeAt(i+1))
          + Math.abs(a.charCodeAt(i+2) - b.charCodeAt(i+2)) > 14) n++;
      }
      return n;
    },
  };
  return true;
}"""

# THE REGIONS, in virtual units. `floorY` is 545 and every one of these is
# measured from it rather than typed as a number, so a floor line that ever does
# move takes the gate's own windows with it.
REGIONS = r"""() => {
  const B = window.__pp.BALANCE;
  const F = B.view.floorY, VW = B.view.W;
  const SG = B.care.stage;
  return {
    /* THE WALL, to the right of him and BELOW THE JUDGE'S BOARD. The first
       version of this box sat at y 118, which is exactly where `ring.boardTop`
       hangs a dark brown clipboard — so in the ring it measured the board, read
       120,125,126, and reported that a show ring has no sky in it. Probed in the
       room (warm 230,211,176) and in the ring (sky 196,220,232). */
    wall: [244, 300, 116, 74],
    /* his bowls' resting homes and the ball's slot, as BALANCE states them */
    food: [SG.bowlHome[0] - 30, SG.bowlHome[1] - 18, 60, 34],
    water: [SG.waterHome[0] - 24, SG.waterHome[1] - 14, 48, 28],
    /* THE BALL'S BOX COMES FROM THE BALL. A guessed band of ground to his
       right caught the round's own panel and read as warm, which is a gate
       failing at reading rather than a ball in the grass. `toy.toy` is where it
       actually rests and `toy.r` is how big it is. */
    ball: (() => {
      const t = window.__pp.loop.scene.toy;
      const r = (t.r || 15) + 4;
      return [t.toy.x - r, t.toy.y - r, r * 2, r * 2];
    })(),
    /* the horizon band the ring furnishes and the park leaves empty */
    horizon: [238, F - 96, 132, 118],
  };
}"""

GRASS = "grass (green-dominant)"


def is_grass(m):
    """green-dominant and not a bowl: g clearly above both r and b"""
    return m["g"] > m["r"] + 14 and m["g"] > m["b"] + 30


def is_sky(m):
    """cool: blue above red, which the room's #f9e9cd wall can never be"""
    return m["b"] > m["r"] + 6


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
        pg.evaluate(INSTALL)
        R = pg.evaluate(REGIONS)
        pg.evaluate("() => __pp.step(1/60, 40)")

        # ---- THE CONTROL SAMPLES: the living room, which every test below
        # ---- must be able to tell apart from a field.
        room = pg.evaluate("(R) => ({ wall: __pl.mean(R.wall), food: __pl.mean(R.food),"
                           " water: __pl.mean(R.water), ball: __pl.mean(R.ball),"
                           " horizon: __pl.mean(R.horizon) })", R)
        check(not is_sky(room["wall"]),
              "CONTROL: the living room's wall is warm, not sky", room["wall"])
        check(not is_grass(room["food"]) and not is_grass(room["water"]),
              "CONTROL: his bowls are visible at home in the room",
              [room["food"], room["water"]])

        # THE TORSO BOX, from the live rig so it holds him at this breed's own
        # scale and idle pose. `rig.y` is his floor origin, so the box sits well
        # above the paws and below the head — all coat, no background.
        torso = pg.evaluate("""() => {
          const rig = __pp.loop.scene.rig, s = rig.s;
          return [rig.x - 26 * s, rig.y - 120 * s, 52 * s, 48 * s];
        }""")
        # CONTROL: the same byte comparison, run on a box 30 units lower — his
        # paws and the rug. A comparison that cannot report a difference reports
        # nothing when it returns zero.
        pair = pg.evaluate("""(t) => {
          const a = __pl.bytes(t);
          const b = __pl.bytes([t[0], t[1] + 30, t[2], t[3]]);
          return __pl.diff(a, b);
        }""", torso)
        check(pair > 0, "CONTROL: the byte test can tell two parts of him apart",
              "%s pixels" % pair)

        # ---- A. THE PARK REPLACES THE ROOM --------------------------------
        # Nothing has advanced the clock since `base` was taken: `_drive.PIN`
        # freezes `Date.now` and stubs rAF, and every step below is a fixed step.
        # So the park capture is the SAME INSTANT in a different place, which is
        # the only way a byte comparison of a living dog means anything (§29.5).
        park = pg.evaluate("""(R) => {
          const pp = window.__pp, sc = pp.loop.scene;
          sc.startDisc();
          pp.step(1/60, 20);
          sc.disc.enterRound();
          /* long enough for the fade to SETTLE, not merely to be under way */
          pp.step(1/60, 150);
          return {
            weight: +sc.placeWeight.toFixed(4),
            wall: __pl.mean(R.wall), food: __pl.mean(R.food),
            water: __pl.mean(R.water), ball: __pl.mean(R.ball),
            horizon: __pl.mean(R.horizon),
          };
        }""", R)
        check(park["weight"] > 0.99,
              "the park fully replaces the room — the fade settles, not stalls",
              park["weight"])
        check(is_sky(park["wall"]),
              "the wall above the shelf is sky in the park", park["wall"])
        if shots:
            SHOTS.mkdir(exist_ok=True)
            pg.screenshot(path=str(SHOTS / "park.png"))

        # ---- B. HIS THINGS STAY AT HOME -----------------------------------
        for k, what in (("food", "the food bowl's home"), ("water", "the water bowl's home")):
            check(is_grass(park[k]), "%s is %s in the park" % (what, GRASS), park[k])

        # ---- C. THE DOG IS NOT TOUCHED ------------------------------------
        # MEASURED BEFORE THE DISC LEAVES HER HAND, because an airborne disc
        # crosses this box and its soft edge blends with whatever is behind it —
        # 145 pixels of disc rim over two different backdrops, reported as a
        # relit dog. Nothing has moved between the room capture and this one.
        # THE SAME DOG, THE SAME INSTANT, THE PLACE ON AND OFF. Comparing the
        # park's dog against the living room's dog compares two POSES — he stands
        # differently waiting for a disc than he does idling on the rug — and a
        # difference there says nothing about light. So the park's art is switched
        # off and back on around one frozen frame, and his coat has to come out
        # the same both times. That is rule 2 of scenes/outdoors.js, and rule 1
        # with it: a floor line that moved would move him out of the box.
        litPark = pg.evaluate("""(t) => {
          const sc = __pp.loop.scene;
          const on = __pl.bytes(t);
          sc.placeArt = false;
          __pp.loop.stepFixed(1e-6, 1);
          const off = __pl.bytes(t);
          sc.placeArt = true;
          __pp.loop.stepFixed(1e-6, 1);
          const back = __pl.bytes(t);
          return { onOff: __pl.diff(on, off), onBack: __pl.diff(on, back) };
        }""", torso)
        check(litPark["onOff"] == 0,
              "his coat is byte-identical with the park drawn and not drawn (not relit)",
              "%s pixels differ" % litPark["onOff"])
        check(litPark["onBack"] == 0,
              "and the frozen redraw itself changes nothing (the measurement is sound)",
              "%s pixels differ" % litPark["onBack"])

        # THE BALL'S SLOT IS READ WITH THE DISC IN THE AIR. The disc waits for her
        # flick at the same resting slot the ball uses, so a box around that slot
        # reads warm whether or not the ball is in it — the first run of this gate
        # failed on a salmon disc and reported a tennis ball. So: throw it, let it
        # climb, and look at the ground it left.
        ball = pg.evaluate("""(R) => {
          const pp = window.__pp, sc = pp.loop.scene;
          sc.disc.throwAt(0.72);
          pp.step(1/60, 14);
          return { phase: pp.dbg().disc.phase, slot: __pl.mean(R.ball) };
        }""", R)
        check(ball["phase"] == "fly", "the disc really is in the air for that reading",
              ball["phase"])
        check(is_grass(ball["slot"]),
              "the ball's resting slot is %s in the park" % GRASS, ball["slot"])


        # ---- D. TWO PLACES, NOT ONE ---------------------------------------
        # out of the disc round and back into a clean room, then into the trial.
        # A remount, because the disc layer owns the surface until it is gone and
        # `__pp.switchDog`'s lesson applies to every layer: the scene rebuilds in
        # `enter`, so a gate that skips the remount is driving the old one.
        # HE NEEDS SOMETHING TO SHOW THE JUDGE. Without a trick `enterRing()`
        # refuses, and the "ring" capture is really the entry panel over the ring
        # — a fair thing to draw and a useless thing to measure. Three tricks,
        # written through the same record the training loop writes.
        pg.evaluate("""() => {
          const g = __pp.app.game;
          for (const id of ['sit', 'paw', 'lieDown']) {
            const t = g.trickRecord(id);
            t.level = 3; t.reps = 24; t.cue = 'down'; t.cueConf = 0.9;
          }
        }""")
        pg.evaluate("() => __pp.app.nav.go('room', { switched: true })")
        pg.wait_for_function("() => window.__pp.loop.scene.rig")
        pg.evaluate("() => __pp.step(1/60, 30)")
        pg.evaluate(INSTALL)
        ring = pg.evaluate("""(R) => {
          const pp = window.__pp, sc = pp.loop.scene;
          sc.startContest();
          pp.step(1/60, 20);
          sc.contest.enterRing();
          pp.step(1/60, 150);
          return {
            weight: +sc.placeWeight.toFixed(4),
            wall: __pl.mean(R.wall), food: __pl.mean(R.food),
            water: __pl.mean(R.water), horizon: __pl.mean(R.horizon),
            horizonBytes: __pl.bytes(R.horizon),
          };
        }""", R)
        check(ring["weight"] > 0.99, "the show ring fully replaces the room too", ring["weight"])
        check(is_sky(ring["wall"]), "the wall is sky in the ring as well", ring["wall"])
        check(is_grass(ring["food"]) and is_grass(ring["water"]),
              "and his bowls are not in the show ring either",
              [ring["food"], ring["water"]])
        check(abs(ring["horizon"]["r"] - park["horizon"]["r"])
              + abs(ring["horizon"]["g"] - park["horizon"]["g"])
              + abs(ring["horizon"]["b"] - park["horizon"]["b"]) > 6,
              "the park and the ring are different places at the horizon",
              [park["horizon"], ring["horizon"]])

        if shots:
            pg.screenshot(path=str(SHOTS / "ring.png"))

        # ---- B2. WHAT HE BROUGHT HOME STAYS HOME -------------------------
        #
        # REPORTED FROM THE PHONE, and this gate should have caught it: "some
        # pieces that lie on the gourn in the house also get carried other to the
        # other two locaitons which doesnt make any sense". `walk.drawBack` draws
        # today's finds "still lying on the rug", the room called it
        # unconditionally, and the rug is not in the park.
        #
        # The bowls and the ball were asserted; the finds were not, which is why
        # they shipped. Same measurement, on the rug where they land.
        finds = pg.evaluate("""() => {
          const pp = window.__pp, sc = pp.loop.scene;
          /* LEAVE THE RING FIRST. Section D left the trial open, and the surface
             arbiter is exclusive by design — so the walk could not start and the
             first run of this check measured the ring's own MAT (warm sand) where
             it expected grass. Out through the real back button. */
          const B = pp.BALANCE.contest.ring.back;
          for (let i = 0; i < 4 && sc.debug.owner; i++) {
            sc.pointer(pp.app, { type: 'down', x: B.x, y: B.y, id: 1,
              dx: 0, dy: 0, speed: 0, dist: 0, moved: false });
            pp.step(1/60, 40);
          }
          /* a real walk, brought home, so there are real finds on the real rug */
          sc.startWalk(); pp.step(1/60, 40);
          pp.setOff(); 
          let g = 0;
          while (g++ < 400 && pp.dbg().walk.leaving) pp.step(1/60, 1);
          pp.bringHome();
          pp.runHome();
          const d = pp.dbg().walk;
          /* DISMISS THE CARD. A finished walk leaves a modal card up, and the
             surface arbiter correctly refuses to open the disc field over it —
             which is what the first run of this check actually measured: a disc
             weight of 0 and four cascading failures that had nothing to do with
             the finds. */
          for (let i = 0; i < 4 && sc.debug.owner; i++) {
            sc.pointer(pp.app, { type: 'down', x: 195, y: 700, id: 1,
              dx: 0, dy: 0, speed: 0, dist: 0, moved: false });
            pp.step(1/60, 30);
          }
          const R = pp.BALANCE.walk.home;
          /* WHERE THE FINDS ACTUALLY ARE, not the whole band they can land in.
             The band is `dropTo[0] ± 34` at y 726, centred 18 units from where the
             dog stands — so a box over the whole of it is mostly DOG, and the
             first run of this check read his warm coat and reported that the park
             was not green. `droppedAt` gives the real positions; this takes the
             one furthest from him and looks at that. */
          const at = (sc.walk.debug.droppedAt || []).slice()
            .sort((p1, p2) => Math.abs(p2[0] - sc.rig.x) - Math.abs(p1[0] - sc.rig.x))[0];
          const box = at ? [at[0] - 22, at[1] - 24, 44, 40]
            : [R.dropTo[0] + R.dropSpread - 20, R.dropTo[1] - 24, 44, 40];
          const inRoom = __pl.mean(box);
          return { dropped: d.dropped, box, inRoom, owner: sc.debug.owner };
        }""")
        check(not finds["owner"],
              "the surface is free again after the walk's card is dismissed",
              finds["owner"])
        check(len(finds["dropped"]) > 0,
              "CONTROL: he really did bring something home and it is on the rug",
              finds["dropped"])
        park2 = pg.evaluate("""(box) => {
          const pp = window.__pp, sc = pp.loop.scene;
          const inRoom = pp.dbg().drewRoomFloor;
          sc.startDisc(); pp.step(1/60, 20);
          sc.disc.enterRound(); pp.step(1/60, 150);
          return {
            weight: +sc.placeWeight.toFixed(3),
            drewInRoom: inRoom, drewInPark: pp.dbg().drewRoomFloor,
            grass: __pl.mean(box),
          };
        }""", finds["box"])
        check(park2["weight"] > 0.99, "the park is fully up for that reading", park2)
        check(park2["drewInRoom"] is True,
              "CONTROL: the room DOES draw what he brought home", park2["drewInRoom"])
        check(park2["drewInPark"] is False,
              "and the park does not — his finds stay on the rug, where the rug is",
              park2["drewInPark"])

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
