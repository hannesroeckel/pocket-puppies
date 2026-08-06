"""
tools/bowlpixels.py — THE BOWL DEPTH GATE. Reads the screen, not the geometry.

WHY THIS FILE EXISTS
--------------------
Three rounds of geometric assertions passed while the screen was plainly
wrong. The muzzle really was 18 units inside the bowl; the bowl's base really
was on the floor; the stance really did predict the render. None of that could
see COMPOSITING, and compositing was the whole defect: the vessel's far half
was drawn behind the entire dog, so the moment he sat up his chest cut the
bowl in half and it read as half-buried in him.

Worse: every render anybody checked was an EATING frame, where the defect is
invisible because his head is down in the bowl and his body is up and behind
it. The state the human photographed — finished, sat back up, bowl still on
the floor — had never been drawn by anyone.

So this gate does two things no previous check did:

  1. It drives the WHOLE action, checkpoint to checkpoint, and asserts on
     EVERY frame — placing, pouring, approaching, eating, licking, FINISHING
     AND SITTING BACK UP, fading, and at rest. Not a sample. Interval
     sampling is what let the stage-2 disembodied head ship.

  2. It asserts on ACTUAL DEVICE PIXELS:

         NO PIXEL OF HIS TORSO MAY SURVIVE ANYWHERE INSIDE THE BOWL'S OUTLINE.

THE ASSERTION, EXACTLY
----------------------
`dog.draw`'s mid slot is a probe point as well as a fix. Four buffers are
grabbed from ONE real render — no second draw, so nothing drifts between them —
and all four sit on the same side of the grain overlay:

    R    in care.drawBehind, after it   the room and the rug: NO dog at all
    M0   at the top of the mid slot     R + his TORSO, and nothing of his head
    M1   at the bottom of the mid slot  M0 + the vessel's far half
    A    at the end of care.drawFront   the finished composite: room, dog,
                                        both halves of the vessel

A is NOT read after the step. room.js lays a full-screen grain pattern at
alpha 0.55 over the finished frame, which nudges nearly every byte; measured
there, "the torso is still showing" degenerates into "the grain missed this
pixel", and the broken order scored 16 defective pixels on a frame with a
third of the bowl visibly missing.

A fifth buffer is built independently, not taken from the render:

    REF  M0 with the far half drawn over it, from care.debug.bowlDraw
         — what the bowl region MUST look like before his head goes on.

Then, over the pixels inside the bowl's published silhouette (frames where an
opaque bowl is actually on screen):

    torso(p)   M0[p] != R[p]                   his body painted this pixel
    defect(p)  torso(p) and A[p] == M0[p] and A[p] != REF[p]
               his body painted it, the final image is still exactly his
               body's colour, and that is NOT what the bowl would have
               painted there.

The REF clause is what makes it tie-proof. Without it the test cannot tell a
buried bowl from a bowl whose cream matches a cream chest — and the cockapoo
produced exactly one such pixel in 29 million. With it, a colour tie is
excluded on the correct grounds: the screen is showing the right colour.

`defect` must be 0 on every frame. Two supporting statistics:

    backOverTorso(p)   torso(p) and M1[p] != M0[p]
               the fix doing its work: a pixel his body owned that the
               vessel's far half took back. Must be > 0 somewhere, or the
               torso never overlapped the bowl and the gate proved nothing.
    replayMismatch     M1[p] != REF[p]
               the self-check: if the independently drawn far half disagrees
               with the one in the render, `bowlDraw` is lying and every
               number here is suspect. Asserted to be 0.

`--old` re-creates §19.2's order on the same frames (the far half hooked into
`drawBehind`, before the whole dog) and measures the same statistic. If the
number does not invert between the two, the gate is not measuring anything
and says so.

Usage
-----
    py tools/bowlpixels.py                    # the fix, 3 breeds x feed/water
    py tools/bowlpixels.py --old              # the defect, to prove it is seen
    py tools/bowlpixels.py --dpr 3 --dark
    py tools/bowlpixels.py shiba              # one breed

Exit code 0 = every frame of every action passed.
"""
import sys, os, json, asyncio, functools, http.server, socketserver, threading, pathlib

ROOT = str(pathlib.Path(__file__).resolve().parent.parent)
PORT = 8823

BREEDS_ALL = ["shiba", "cockapoo", "schnoodle"]
ERODE = 2          # device px shaved off the silhouette, so its own antialiased
                   # edge (where the floor legitimately shows through a partly
                   # covered pixel) cannot be misread as fur inside the bowl
MIN_MASK_FRAMES = 120    # frames that must actually have a bowl to look inside
MIN_OVERLAP_FRAMES = 20  # frames where his body and the bowl must overlap at all
MAX_REPLAY_FRAC = 0.02   # the replay self-check is about the HARNESS, not the
                         # game: an independent re-render lands within a couple of
                         # LSBs over the flats but can differ by more along the
                         # vessel's antialiased edges, so it is asserted as a
                         # fraction OF THE CANDIDATE PIXELS -- the only ones its
                         # fidelity can change a verdict for. A reference built
                         # from the wrong condition does not hide here: it turns
                         # candidates into defects, which fails outright.
MIN_ALPHA = 0.99         # below this the bowl is mid cross-fade and the floor
                         # legitimately shows through it; those frames are
                         # counted and named, not fudged and not failed


# ---- server -------------------------------------------------------------
class _Q(socketserver.ThreadingTCPServer):
    # NOT allow_reuse_address: on Windows that lets a second server bind a port
    # a zombie from an interrupted run is still holding, and requests then go to
    # the dead one and the harness hangs at page load with no error at all. Ask
    # the OS for a free port instead.
    allow_reuse_address = False
    daemon_threads = True

    def handle_error(self, *a):
        pass


def serve(port, root):
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=root)
    srv = _Q(("127.0.0.1", 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return "http://127.0.0.1:%d" % srv.server_address[1]


# ---- the gate, installed once per page ---------------------------------
INSTALL = r"""async (old) => {
  const props = await import('/src/scenes/props.js');
  const sc = window.__pp.loop.scene, view = window.__pp.view;
  const cv = document.querySelector('canvas');
  const cx = cv.getContext('2d');
  const care = sc.care;
  const realBehind = care.drawBehind, realMid = care.drawMid, realFront = care.drawFront;
  const G = { props, sc, cv, cx, view, old: !!old,
              R: null, M0: null, M1: null, A: null, r: null };
  window.__bp = G;

  /* the region of interest: the bowl's own bounding box, plus a little */
  const roi = () => {
    const d = sc.debug.care, bs = d.bowlScaleNow || 1;
    const bx = care.bowl.x, baseY = d.bowlBaseY;
    const DX = (vx) => (view.offX + vx * view.vs) * view.dpr;
    const DY = (vy) => (view.offY + vy * view.vs) * view.dpr;
    const x0 = Math.max(0, Math.floor(DX(bx - 36 * bs)) - 6);
    const x1 = Math.min(cv.width, Math.ceil(DX(bx + 36 * bs)) + 6);
    const y0 = Math.max(0, Math.floor(DY(baseY - 40 * bs)) - 6);
    const y1 = Math.min(cv.height, Math.ceil(DY(baseY + 8 * bs)) + 6);
    return { x0, y0, W: Math.max(1, x1 - x0), H: Math.max(1, y1 - y0), bs, bx, baseY };
  };
  const grab = (r) => cx.getImageData(r.x0, r.y0, r.W, r.H).data;

  /* R: everything drawn before him. In --old mode the vessel's far half is
     hooked in HERE, which is exactly what §19.2 did. */
  care.drawBehind = (gg) => {
    realBehind(gg);
    if (G.old) realMid(gg);
    G.r = roi();
    G.R = grab(G.r);
    /* STALE BUFFERS ARE WORSE THAN NO BUFFERS. room.js only hands the slot
       over when the vessel is actually split around him, so on a frame where
       the bowl is in her hand the slot never runs and M0/M1 would still hold
       the previous frame's pixels. Cleared here, every frame, so the reader
       can tell "the slot did not run" from "the slot ran and found nothing". */
    G.M0 = null; G.M1 = null; G.A = null;
  };
  /* the mid slot: his body is down, his head is not. In --old mode the slot
     paints nothing (the bowl already went in behind him) and only probes. */
  care.drawMid = (gg) => {
    if (!G.r) G.r = roi();
    G.M0 = grab(G.r);
    if (!G.old) realMid(gg);
    G.M1 = grab(G.r);
  };
  /* A: THE COMPOSITE, TAKEN BEFORE THE OVERLAY.
     `scenes/room.js` lays a full-screen GRAIN PATTERN at alpha 0.55 plus three
     vignette gradients over the finished frame. Read the canvas after the step
     and almost every pixel has been nudged by the grain, so "A == M0" stops
     meaning "his body is still showing" and starts meaning "the grain happened
     to leave this byte alone" -- which made the first run of this gate report
     16 defective pixels on a frame where a third of the bowl was visibly
     missing, and would have made the fix's zero nearly meaningless.
     `care.drawFront` is the last layer that touches the bowl, so the composite
     is complete here: room, dog, both halves of the vessel, no grain, no hand
     glow, no UI. All four buffers now come from the same pass and the same
     side of the overlay. */
  care.drawFront = (gg) => {
    realFront(gg);
    if (G.r) G.A = grab(G.r);
  };
  return true;
}"""

STEP_AND_READ = r"""(cfg) => {
  window.__pp.step(1 / 60, 1);
  const G = window.__bp;
  const sc = G.sc, view = G.view, cx = G.cx, d = sc.debug.care;
  const out = {
    phase: d.phase, mode: d.mode, w: +(d.w || 0).toFixed(4),
    split: !!sc.care.bowlSplit, placed: !!d.placed,
    held: !!(sc.care.bowl && sc.care.bowl.held),
  };
  if (!G.R || !G.r) { out.skipped = 'dog not drawn'; return out; }
  if (!G.M0 || !G.A) {
    /* the slot did not run this frame: the vessel is not split around him, so
       the WHOLE bowl went down in the front pass, over all of him. Nothing of
       his can be inside it by construction. Counted, named, not asserted. */
    out.skipped = 'bowl not split (drawn whole, in front)';
    out.bowlOnScreen = !!(d.bowlDraw && d.bowlDraw.onScreen);
    return out;
  }
  const { x0, y0, W, H, bs, bx, baseY } = G.r;
  const R = G.R, M0 = G.M0, M1 = G.M1, A = G.A;

  /* ---- INSIDE THE BOWL ------------------------------------------------
     Two conditions, ANDed, and each is asked of the thing that knows:

       1. props.js's PUBLISHED SILHOUETTE says where the outline is. Not a
          colour guess and not a re-derivation of the path.
       2. THE GAME'S OWN drawBowl CALL, replayed on a scratch canvas from
          `care.debug.bowlDraw` with the same arguments and the same care-fade
          alpha, says whether the bowl is actually there and FULLY OPAQUE.

     (2) is what stops the gate testing a phantom. Ask only (1) and the mask
     survives after the action closes and the bowl has gone, so the dog stands
     "inside the bowl's outline" and every pixel of him reads as a defect. It
     also excludes a cross-dissolving bowl: at alpha 0.6 the floor and his
     chest legitimately show through, and the honest thing is to say so and
     count the frame as not-checked rather than to fail it or fudge it. */
  const bd = d.bowlDraw || {};
  const mkCanvas = () => {
    const q = document.createElement('canvas');
    q.width = W; q.height = H;
    const k = q.getContext('2d');
    k.setTransform(view.dpr * view.vs, 0, 0, view.dpr * view.vs,
                   view.dpr * view.offX - x0, view.dpr * view.offY - y0);
    return [q, k];
  };
  /* (1) the outline */
  const [, ms] = mkCanvas();
  ms.translate(bx, baseY - G.props.BOWL_BASE * bs);
  ms.scale(bs, bs);
  ms.fillStyle = '#fff';
  G.props.bowlSilhouette(ms);
  const SIL = ms.getImageData(0, 0, W, H).data;
  /* (2) the bowl the game actually drew -- same position, scale, kind, fill,
     time and ripple -- laid down at FULL opacity, so the mask is the bowl's
     own footprint and does not get nibbled away by the care fade. The fade is
     handled once, as a frame-level gate below, instead of per pixel: at alpha
     0.993 the double-painted rim overlap still reaches 255 while the rest of
     the vessel does not, which silently shrank the mask to a third of the
     bowl on exactly the "placed, upright, not yet eating" beat. */
  const opaqueEnough = !!bd.onScreen && bd.alpha >= cfg.minAlpha;
  const [, mo] = mkCanvas();
  let OPQ = null;
  if (opaqueEnough) {
    G.props.drawBowl(mo, bd.x, bd.y, bd.s, bd.kind, bd.fill, bd.t, bd.ripple, 'back');
    OPQ = mo.getImageData(0, 0, W, H).data;
  }
  out.bowlOnScreen = !!bd.onScreen;
  out.bowlAlpha = bd.alpha === undefined ? 0 : bd.alpha;
  let mask = new Uint8Array(W * H);
  for (let i = 0, q = 3; i < W * H; i++, q += 4) {
    mask[i] = (SIL[q] > 250 && OPQ && OPQ[q] > 254) ? 1 : 0;
  }
  for (let e = 0; e < cfg.erode; e++) {
    const nx = new Uint8Array(W * H);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        nx[i] = (mask[i] && mask[i - 1] && mask[i + 1] && mask[i - W] && mask[i + W]) ? 1 : 0;
      }
    }
    mask = nx;
  }

  /* ---- REF: THE CORRECT COMPOSITE, BUILT INDEPENDENTLY ------------------
     His body (M0) with the vessel's far half laid over it, drawn here from
     `care.debug.bowlDraw` rather than taken from the render. This is what the
     bowl region MUST look like before his head goes on.

     It exists to kill colour ties honestly. Testing "the final pixel still
     equals his body's colour" alone cannot tell a buried bowl from a bowl
     whose cream happens to match a cream chest -- and the cockapoo turned up
     exactly one such pixel in 29 million. With REF the question becomes
     "is the final pixel his body AND NOT what the bowl would have painted",
     which is false whenever the two colours agree, because then the screen is
     showing the right colour whatever produced it.

     Gated on bd.split, NOT on "a bowl is on screen": the slot only lays the far
     half down when the vessel is actually split around him. While it is still
     in her hand, or not yet placed, the WHOLE bowl goes down in the front pass
     instead and the slot paints nothing -- so compositing a far half into REF
     there invents a layer the render never drew.

     And gated on bd.split ALONE, not on the opacity used for the mask: while
     the care fade is running the vessel is still split and the slot still
     paints it, just see-through. Skipping REF there left the whole far half
     out of the reference on those frames and reported it as 4-5k px of
     replayMismatch -- the self-check correctly refusing to believe a
     reference that had been built from the wrong condition. */
  const slotPaints = !!bd.split;
  let REF = null;
  const buildRef = () => {
    if (REF) return REF;
    const [, rk] = mkCanvas();
    rk.save();
    rk.setTransform(1, 0, 0, 1, 0, 0);
    rk.putImageData(new ImageData(new Uint8ClampedArray(M0), W, H), 0, 0);
    rk.restore();
    if (slotPaints) {
      rk.globalAlpha = bd.alpha;
      G.props.drawBowl(rk, bd.x, bd.y, bd.s, bd.kind, bd.fill, bd.t, bd.ripple, 'back');
    }
    REF = rk.getImageData(0, 0, W, H).data;
    return REF;
  };
  out.slotPaints = slotPaints;

  const same = (P, Q, i) => P[i] === Q[i] && P[i + 1] === Q[i + 1] && P[i + 2] === Q[i + 2];
  /* REF is an INDEPENDENT re-render of the same paint, so comparing it needs a
     rounding tolerance: laying a gradient over a putImageData'd buffer lands
     within one least-significant bit of laying it over the live canvas, and
     4,199 px of a shiba's eating frame differed by exactly that -- rendered
     [247,233,208] vs replayed [247,233,209], both plainly the bowl's cream
     against fur at [226,141,75]. Two LSBs is far below anything visible and
     far above the rounding.
     `same` stays EXACT where it is meaningful: A and M0 come off the same
     canvas, so "his body's colour survived untouched" is a bit-for-bit claim. */
  const near = (P, Q, i) => Math.abs(P[i] - Q[i]) <= 2
    && Math.abs(P[i + 1] - Q[i + 1]) <= 2 && Math.abs(P[i + 2] - Q[i + 2]) <= 2;
  let maskPx = 0, torsoPx = 0, defect = 0, back = 0, tie = 0, replayMiss = 0;
  const cand = [];
  let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
  const samples = [];
  const rs = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const j = y * W + x;
      if (!mask[j]) continue;
      maskPx++;
      const i = j * 4;
      if (same(M0, R, i)) continue;      /* his body never painted this pixel */
      torsoPx++;
      const tookBack = !same(M1, M0, i); /* the vessel's far half repainted it */
      if (tookBack) back++;
      /* REF is only consulted for pixels that are CANDIDATES -- his body's
         colour survived here -- so it is built lazily. On the overwhelming
         majority of frames there are none and the replay is never rendered at
         all, which is the difference between the gate taking two minutes per
         action and five. */
      if (same(A, M0, i)) cand.push(i);
    }
  }
  if (cand.length) {
    buildRef();
    for (const i of cand) {
      const tookBack = !same(M1, M0, i);
      /* the replay self-check: in the current order the slot paints the far
         half, so M1 must agree with the independently drawn REF. If it does
         not, `bowlDraw` is lying about what was drawn and every number here is
         suspect. (In --old mode the slot paints nothing, so this is expected
         to differ and is reported but not asserted.) */
      if (!near(M1, REF, i)) {
        replayMiss++;
        if (rs.length < 4) rs.push({ i,
              his: [M0[i], M0[i+1], M0[i+2]],
              rendered: [M1[i], M1[i+1], M1[i+2]],
              replayed: [REF[i], REF[i+1], REF[i+2]] });
      }
      /* His body painted this pixel and the final image is still exactly his
         body's colour. THE DEFECT -- unless the bowl would have painted that
         same colour here anyway, in which case nothing is visibly wrong and
         the screen is right whatever produced it. That is a colour tie, and it
         is named rather than folded into either answer. */
      if (tookBack || near(A, REF, i)) { tie++; continue; }
      defect++;
      const px = (i / 4) % W, py = ((i / 4) - px) / W;
      if (px < bx0) bx0 = px; if (px > bx1) bx1 = px;
      if (py < by0) by0 = py; if (py > by1) by1 = py;
      if (samples.length < 4) {
        samples.push({ x: x0 + px, y: y0 + py,
                       room: [R[i], R[i + 1], R[i + 2]],
                       bowlWouldPaint: [REF[i], REF[i + 1], REF[i + 2]],
                       his: [M0[i], M0[i + 1], M0[i + 2]],
                       afterFarHalf: [M1[i], M1[i + 1], M1[i + 2]],
                       final: [A[i], A[i + 1], A[i + 2]] });
      }
    }
  }
  out.colourTiesNotCounted = tie;
  out.replayMismatchPx = replayMiss;
  /* as a fraction of THE MASK, not of the candidates: the candidate count is
     often 1-3, so a single pixel of edge rounding read as 33% or 100% and
     failed the run on a statistic about the harness. The mask is a stable
     ~21,700, and it is the denominator the check was calibrated against --
     a reference built from the wrong condition showed up at ~20% of it. */
  out.replayMismatchFrac = maskPx ? +(replayMiss / maskPx).toFixed(6) : 0;
  out.candidatePx = cand.length;
  if (rs.length) out.replaySamples = rs;
  out.bd = bd;
  if (samples.length) out.defectSamples = samples;
  out.maskPx = maskPx;
  out.torsoInMask = torsoPx;
  out.backOverTorso = back;
  out.defect = defect;
  out.defectFrac = maskPx ? +(defect / maskPx).toFixed(4) : 0;
  if (defect) out.defectBox = [x0 + bx0, y0 + by0, bx1 - bx0 + 1, by1 - by0 + 1];
  return out;
}"""

PROBE = """() => {
  const d = window.__pp.loop.scene.debug.care;
  return { phase: d.phase, mode: d.mode, w: +(d.w || 0).toFixed(4), placed: !!d.placed };
}"""

P_SEND = """(a) => {
  const sc = window.__pp.loop.scene, app = window.__pp.app;
  if (app.input && app.input.state) { app.input.state.lastX = a.x; app.input.state.lastY = a.y; }
  sc.pointer(app, { type: a.t, x: a.x, y: a.y, id: 1, dx: 0, dy: 0,
                    speed: 0, dist: 0, moved: !!a.moved });
}"""


class Run:
    """one action, driven frame by frame with the gate reading every frame"""

    def __init__(self, pg, erode):
        self.pg = pg
        self.cfg = {"erode": erode, "minAlpha": MIN_ALPHA}
        self.rows = []

    async def step(self, n=1):
        for _ in range(n):
            r = await self.pg.evaluate(STEP_AND_READ, self.cfg)
            self.rows.append(r)
        return self.rows[-1]

    async def send(self, t, x, y, moved=False):
        await self.pg.evaluate(P_SEND, {"t": t, "x": x, "y": y, "moved": moved})

    async def drag_open(self, frm, to, steps=18):
        await self.send("down", frm[0], frm[1])
        await self.step()
        for i in range(1, steps + 1):
            u = i / steps
            await self.send("move", frm[0] + (to[0] - frm[0]) * u,
                            frm[1] + (to[1] - frm[1]) * u, True)
            await self.step()

    async def hold(self, at, n, j=0.4):
        for i in range(n):
            await self.send("move", at[0] + (j if i % 2 else -j), at[1], True)
            await self.step()

    async def release(self, at):
        await self.send("up", at[0], at[1], True)
        await self.step()

    async def until(self, pred, cap=1500, then=0):
        for _ in range(cap):
            if pred(self.rows[-1]):
                if then:
                    await self.step(then)
                return self.rows[-1]
            await self.step()
        raise RuntimeError("phase never reached (last=%s)" % json.dumps(self.rows[-1]))


async def boot(pg, base, breed, nogt=False):
    if nogt:
        # THE FALLBACK PATH IN THE DEPTH SLOT, exercised rather than assumed.
        # Without getTransform the slot undoes the dog's translate+scale by
        # arithmetic instead. Engines that old are long gone from iOS, but an
        # untested branch in the middle of the compositing fix is exactly the
        # kind of thing that is wrong when someone finally runs it.
        await pg.add_init_script(
            "delete CanvasRenderingContext2D.prototype.getTransform;")
    await pg.goto("%s/index.html?breed=%s" % (base, breed))
    await pg.wait_for_function("() => window.__pp && window.__pp.loop && window.__pp.loop.scene")
    await pg.evaluate("() => window.__pp.skipIntro('Alfie')")
    await pg.evaluate("() => window.__pp.loop.stop()")
    await pg.evaluate("() => window.__pp.step(1/60, 90)")
    await pg.evaluate("""() => { window.__pp.setNeed('hunger', 0.05);
                                 window.__pp.setNeed('thirst', 0.05); }""")
    await pg.evaluate("() => window.__pp.step(1/60, 30)")


async def action(pg, mode, erode, old):
    """the WHOLE care action, start to finish, gated on every frame"""
    await pg.evaluate(INSTALL, old)
    S = await pg.evaluate("() => window.__pp.BALANCE.care")
    st = S["stage"]
    home = st["bowlHome"] if mode == "feed" else st["waterHome"]
    tgt = st["bowlTarget"]
    pourer = S["feed"]["sackHome"] if mode == "feed" else S["water"]["jugHome"]
    over = [tgt[0], tgt[1] - 80]

    r = Run(pg, erode)
    await pg.evaluate("(m) => window.__pp.care(m)", mode)
    await r.step(10)
    marks = {}

    # bowl carried out and set on the floor; he is still standing, watching
    await r.drag_open(home, tgt)
    await r.release(tgt)
    await r.step(30)
    marks["a-placed-upright"] = len(r.rows) - 1

    # pouring, held until care itself advances the phase
    await r.drag_open(pourer, over)
    marks["b-pouring"] = len(r.rows)
    n = 0
    while n < 600 and r.rows[-1]["phase"] == "pour":
        await r.hold(over, 1)
        n += 1
    await r.release(over)

    await r.until(lambda f: f["phase"] == "approach", then=26)
    marks["c-approach"] = len(r.rows) - 1
    await r.until(lambda f: f["phase"] in ("eat", "drink"), then=44)
    marks["d-eating"] = len(r.rows) - 1
    try:
        await r.until(lambda f: f["phase"] in ("lick", "shakeMuzzle"), then=18, cap=2500)
        marks["e-" + r.rows[-1]["phase"]] = len(r.rows) - 1
    except RuntimeError:
        pass
    # THE STATE HE PHOTOGRAPHED: head up, back on four paws, bowl still there
    await r.until(lambda f: f["phase"] == "finish", then=30, cap=2500)
    marks["f-finish-upright"] = len(r.rows) - 1
    await r.until(lambda f: f["w"] < 0.62, cap=2500)
    marks["g-fading"] = len(r.rows) - 1
    await r.until(lambda f: f["w"] < 0.005, cap=2500, then=40)
    marks["h-idle-home"] = len(r.rows) - 1
    return r.rows, marks


# the beats the mask MUST be non-empty on, or the gate never looked inside the
# bowl in the state that matters. `f-finish-upright` is the one he photographed.
MUST_COVER = ("a-placed-upright", "b-pouring", "c-approach", "d-eating",
              "f-finish-upright")
MIN_PER_PHASE = 15


def judge(rows, marks, old):
    checked = [f for f in rows if f.get("maskPx")]
    bad = [f for f in checked if f.get("defect")]
    overlap = [f for f in checked if f.get("torsoInMask")]
    took = [f for f in overlap if f.get("backOverTorso")]
    noBowl = [f for f in rows if not f.get("maskPx") and not f.get("bowlOnScreen")]
    fading = [f for f in rows if not f.get("maskPx") and f.get("bowlOnScreen")]
    worst = max(rows, key=lambda f: f.get("defect", 0))
    phases = sorted({f["phase"] for f in rows if f["phase"]})
    # per-phase coverage: the whole action, not a sample of it
    byPhase = {}
    for f in checked:
        p = f["phase"] or "(care closing)"
        byPhase.setdefault(p, [0, 0])
        byPhase[p][0] += 1
        byPhase[p][1] += 1 if f.get("defect") else 0
    # 'place' is the drag: the bowl is in her hand, floating over him, and is
    # drawn WHOLE in the front pass, so no part of him can be behind it by
    # construction. It is exempt from the per-phase floor for that reason,
    # not because it is inconvenient.
    thin = [p for p in phases if p != 'place'
            and byPhase.get(p, [0])[0] < MIN_PER_PHASE]
    cp = {k: {"phase": rows[i]["phase"], "w": rows[i]["w"],
              "bowlOnScreen": rows[i].get("bowlOnScreen"),
              "bowlAlpha": rows[i].get("bowlAlpha"),
              "maskPx": rows[i].get("maskPx", 0),
              "torsoInMask": rows[i].get("torsoInMask", 0),
              "backOverTorso": rows[i].get("backOverTorso", 0),
              "defect": rows[i].get("defect", 0)}
          for k, i in marks.items()}
    uncovered = [k for k in MUST_COVER if k in cp and not cp[k]["maskPx"]]
    res = {
        "frames": len(rows), "phases": phases,
        "framesChecked": len(checked),
        "framesNotChecked_noBowlOnScreen": len(noBowl),
        "framesNotChecked_bowlCrossFading": len(fading),
        "framesWhereHisBodyOverlapsTheBowl": len(overlap),
        "framesWhereTheFarHalfTookThosePixelsBack": len(took),
        "framesWithTorsoShowingInsideTheBowl": len(bad),
        "colourTiePixelsIgnoredWorstFrame": max((f.get("colourTiesNotCounted", 0)
                                                 for f in rows), default=0),
        # only over CHECKED frames: REF is only ever consulted there, so a
        # disagreement on a frame the gate does not look inside is noise
        "replayMismatchWorstFrame": max((f.get("replayMismatchPx", 0)
                                         for f in checked), default=0),
        "replayMismatchWorstAnyFrame": max((f.get("replayMismatchPx", 0)
                                            for f in rows), default=0),
        "replayMismatchWorstFrac": max((f.get("replayMismatchFrac", 0)
                                        for f in checked), default=0),
        "worstDefectPx": worst.get("defect", 0),
        "worstDefectFracOfBowl": worst.get("defectFrac", 0),
        "worstDefectPhase": worst.get("phase") if worst.get("defect") else None,
        "worstDefectBox": worst.get("defectBox"),
        "checkedPerPhase": {p: {"checked": v[0], "defectFrames": v[1]}
                            for p, v in sorted(byPhase.items())},
        "phasesWithTooFewCheckedFrames": thin,
        "beatsWithNoBowlToLookInside": uncovered,
        "perCheckpoint": cp,
        "worstReplayFrame": (lambda f: {"phase": f.get("phase"), "px": f.get("replayMismatchPx"),
                                        "bd": f.get("bd"), "samples": f.get("replaySamples")}
                             )(max(checked, key=lambda f: f.get("replayMismatchPx", 0)))
        if checked else None,
    }
    if old:
        # the control: the gate must SEE §19.2's defect, not merely fail to
        # find it in the fix
        res["pass"] = len(bad) > 0 and worst.get("defect", 0) > 200
        res["meaning"] = ("PASS here means the gate CAN see the defect: the old "
                          "order shows fur inside the bowl on %d of %d checked "
                          "frames, worst %d px (%.1f%% of the bowl)"
                          % (len(bad), len(checked), worst.get("defect", 0),
                             100 * worst.get("defectFrac", 0)))
    else:
        res["pass"] = (not bad and not uncovered and not thin
                       and res["replayMismatchWorstFrac"] <= MAX_REPLAY_FRAC
                       and len(checked) >= MIN_MASK_FRAMES
                       and len(overlap) >= MIN_OVERLAP_FRAMES
                       and len(took) >= MIN_OVERLAP_FRAMES)
        res["meaning"] = ("PASS means: on all %d frames where an opaque bowl was "
                          "on screen -- every beat from placing it to sitting back "
                          "up -- NO pixel of his torso survived inside the bowl's "
                          "outline. Not vacuous: his body was behind the bowl on "
                          "%d of those frames and the far half took those pixels "
                          "back on %d. %d frames were not checked because there "
                          "was no bowl on screen and %d because it was mid "
                          "cross-fade."
                          % (len(checked), len(overlap), len(took),
                             len(noBowl), len(fading)))
    return res


async def main():
    argv = [a for a in sys.argv[1:] if not a.startswith("--")]
    old = "--old" in sys.argv
    dark = "--dark" in sys.argv
    nogt = "--nogt" in sys.argv
    dpr = 3
    if "--dpr" in sys.argv:
        dpr = int(sys.argv[sys.argv.index("--dpr") + 1])
    breeds = argv[0].split(",") if argv else BREEDS_ALL
    base = serve(PORT + (1 if old else 0), ROOT)
    from playwright.async_api import async_playwright

    out, errs, ok = {}, [], True
    print("bowl depth gate — %s order, dpr %d, %s%s" %
          ("STAGE-8 (§19.2)" if old else "current", dpr, "dark" if dark else "light",
           ", NO getTransform (fallback path)" if nogt else ""))
    async with async_playwright() as p:
        br = await p.chromium.launch()
        for breed in breeds:
            ctx = await br.new_context(viewport={"width": 390, "height": 844},
                                       device_scale_factor=dpr, is_mobile=True,
                                       has_touch=True,
                                       color_scheme="dark" if dark else "light")
            pg = await ctx.new_page()
            pg.on("console", lambda m: errs.append(m.type + ": " + m.text)
                  if m.type == "error" else None)
            pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
            for mode in ("feed", "water"):
                await boot(pg, base, breed, nogt)
                rows, marks = await action(pg, mode, ERODE, old)
                r = judge(rows, marks, old)
                out["%s-%s" % (breed, mode)] = r
                ok = ok and r["pass"]
                print("\n%-10s %-5s %s  %d frames, phases %s"
                      % (breed, mode, "PASS" if r["pass"] else "FAIL",
                         r["frames"], ",".join(r["phases"])))
                for k in ("framesChecked", "framesNotChecked_noBowlOnScreen",
                          "framesNotChecked_bowlCrossFading",
                          "framesWhereHisBodyOverlapsTheBowl",
                          "framesWhereTheFarHalfTookThosePixelsBack",
                          "framesWithTorsoShowingInsideTheBowl",
                          "worstDefectPx", "worstDefectFracOfBowl", "worstDefectPhase",
                          "colourTiePixelsIgnoredWorstFrame", "replayMismatchWorstFrame",
                          "replayMismatchWorstAnyFrame", "replayMismatchWorstFrac",
                          "phasesWithTooFewCheckedFrames", "beatsWithNoBowlToLookInside"):
                    print("    %-42s %s" % (k, r[k]))
                print("    checked frames per phase: %s"
                      % json.dumps({p: v["checked"]
                                    for p, v in r["checkedPerPhase"].items()}))
                print("    per checkpoint (defect px inside the bowl):")
                for k in sorted(r["perCheckpoint"]):
                    c = r["perCheckpoint"][k]
                    print("      %-18s phase=%-12s a=%-6s bowlPx=%-6s his=%-6s took=%-6s DEFECT=%s"
                          % (k, c["phase"], c["bowlAlpha"], c["maskPx"],
                             c["torsoInMask"], c["backOverTorso"], c["defect"]))
            await ctx.close()
        await br.close()
    out["consoleErrors"] = errs
    out["allPass"] = ok and not errs
    tag = "old" if old else ("fix-nogt" if nogt else "fix")
    with open(os.path.join(ROOT, "tools", "bowlpixels-%s.json" % tag), "w") as fh:
        json.dump(out, fh, indent=1)
    print("\nconsole errors:", errs if errs else "none")
    print("ALL PASS" if out["allPass"] else "FAILED")
    sys.exit(0 if out["allPass"] else 1)


asyncio.run(main())
