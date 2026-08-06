"""
tools/dogalone.py — THE DOG ALONE IS UNCHANGED, byte for byte.

§19.5 restructured `dog/draw.js`'s entry point: `draw` now takes a `mid`
callback and calls it between the body/legs pass and the head/muzzle pass.
That is permitted only if it is a PURE REORDERING — nothing about how any part
of him looks on its own may move by a single pixel.

This proves it rather than arguing it. Two trees are served side by side (the
commit before the change, and this one), the SAME deterministic script is run
in both, and the whole canvas is SHA-256'd every frame with all three care
prop layers suppressed — so the dog is drawn with no bowl present at all,
through every pose the care action puts him in: standing and watching, folding
down, head deep in a bowl that isn't there, licking, shaking, pushing back up,
and idle at either end.

If the two hash streams are identical, the reorder changed nothing about him.
If they are not, the frame index and the phase are reported.

Determinism note: the dog is seeded from BALANCE.rng.seed, not from the clock
(`newDog` takes the shared seeded rng; `Date.now()` only reaches `id`/`bornAt`),
and the dust motes — the one thing that advances per DRAW rather than per step —
are switched off in both trees. Nothing else in the frame is stochastic.

Usage:
    py tools/dogalone.py --before C:\\path\\to\\pre-fix\\tree [breeds]
Exit code 0 = every hashed frame matched.
"""
import sys, os, json, asyncio, functools, http.server, socketserver, threading, pathlib

ROOT = str(pathlib.Path(__file__).resolve().parent.parent)
BREEDS_ALL = ["shiba", "cockapoo", "schnoodle"]


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


SETUP = r"""() => {
  const sc = window.__pp.loop.scene;
  /* NO BOWL, NO FUR PILE, NO KIBBLE: just him. All three prop layers are
     suppressed, so what is hashed is the dog and the room and nothing that
     §19.5 moved. `drawMid` does not exist on the pre-fix tree; assigning it
     there is harmless because nothing calls it. */
  const noop = () => {};
  sc.care.drawBehind = noop;
  sc.care.drawMid = noop;
  sc.care.drawFront = noop;
  /* dust motes advance once per DRAW, not per step, and are the only thing in
     the frame that could differ between two runs of the same script */
  window.__pp.BALANCE.particles.motes = 0;
  sc.resize(window.__pp.app);
  return true;
}"""

STEP_HASH = r"""async (n) => {
  const cv = document.querySelector('canvas');
  const cx = cv.getContext('2d');
  const out = [];
  for (let k = 0; k < n; k++) {
    window.__pp.step(1 / 60, 1);
    const d = cx.getImageData(0, 0, cv.width, cv.height);
    const h = await crypto.subtle.digest('SHA-256', d.data.buffer);
    const b = new Uint8Array(h);
    let s = '';
    for (let i = 0; i < 10; i++) s += b[i].toString(16).padStart(2, '0');
    const care = window.__pp.loop.scene.debug.care;
    out.push([s, care.phase || '', +(care.w || 0).toFixed(3)]);
  }
  return out;
}"""


async def boot(pg, base, breed):
    await pg.goto("%s/index.html?breed=%s" % (base, breed))
    await pg.wait_for_function("() => window.__pp && window.__pp.loop && window.__pp.loop.scene")
    await pg.evaluate("() => window.__pp.skipIntro('Alfie')")
    await pg.evaluate("() => window.__pp.loop.stop()")
    await pg.evaluate("() => window.__pp.step(1/60, 90)")
    await pg.evaluate("""() => { window.__pp.setNeed('hunger', 0.05);
                                 window.__pp.setNeed('thirst', 0.05); }""")
    await pg.evaluate("() => window.__pp.step(1/60, 30)")
    await pg.evaluate(SETUP)


async def script(pg, marks):
    """the same frames in both trees. `__pp.drag` is one evaluate and steps
    internally, so the two runs cannot drift apart."""
    S = await pg.evaluate("() => window.__pp.BALANCE.care")
    st = S["stage"]
    rows = []

    async def hashn(n, label):
        marks.append((label, len(rows)))
        rows.extend(await pg.evaluate(STEP_HASH, n))

    await hashn(50, "idle-before")
    for mode in ("feed", "water"):
        home = st["bowlHome"] if mode == "feed" else st["waterHome"]
        pourer = S["feed"]["sackHome"] if mode == "feed" else S["water"]["jugHome"]
        over = [st["bowlTarget"][0], st["bowlTarget"][1] - 80]
        await pg.evaluate("(m) => window.__pp.care(m)", mode)
        await hashn(10, mode + "-open")
        await pg.evaluate("(a) => window.__pp.drag({from: a[0], to: a[1], steps: 16})",
                          [home, st["bowlTarget"]])
        await hashn(40, mode + "-placed-upright")
        await pg.evaluate("(a) => window.__pp.drag({from: a[0], to: a[1], steps: 16, hold: 3.6})",
                          [pourer, over])
        # long enough to cover approach, eating, licking/shaking, finish, fade
        await hashn(430, mode + "-through-the-action")
        await pg.evaluate("() => window.__pp.stopCare()")
        await hashn(60, mode + "-at-rest")
    await hashn(40, "idle-after")
    return rows


async def main():
    if "--before" not in sys.argv:
        print("need --before <path to the pre-fix tree>")
        sys.exit(2)
    before = sys.argv[sys.argv.index("--before") + 1]
    dpr = 3
    if "--dpr" in sys.argv:
        dpr = int(sys.argv[sys.argv.index("--dpr") + 1])
    # the VALUES of --before/--dpr are positional-looking, so they have to be
    # excluded explicitly. Taking them as the breed list ran the whole proof
    # against a breed id of "C:\\tmp\\ppb2\\before", which silently dropped
    # ?breed= (and with it ?preview), so each tree booted a fresh unseeded save
    # minutes apart and 1069 of 1170 frames "differed".
    taken = {"--before", "--dpr"}
    argv, skip = [], False
    for a in sys.argv[1:]:
        if skip:
            skip = False
            continue
        if a in taken:
            skip = True
            continue
        if not a.startswith("--"):
            argv.append(a)
    breeds = argv[0].split(",") if argv else BREEDS_ALL
    a_base = serve(8841, before)
    b_base = serve(8842, ROOT)
    from playwright.async_api import async_playwright

    out, ok = {}, True
    print("dog-alone identity: before=%s  after=%s  dpr=%d" % (before, ROOT, dpr))
    async with async_playwright() as p:
        br = await p.chromium.launch()
        for breed in breeds:
            res = {}
            for tag, base in (("before", a_base), ("after", b_base)):
                ctx = await br.new_context(viewport={"width": 390, "height": 844},
                                           device_scale_factor=dpr, is_mobile=True,
                                           has_touch=True)
                pg = await ctx.new_page()
                marks = []
                await boot(pg, base, breed)
                res[tag] = (await script(pg, marks), marks)
                await ctx.close()
            A, mA = res["before"]
            B, mB = res["after"]
            diff = [i for i in range(min(len(A), len(B))) if A[i][0] != B[i][0]]
            same = len(A) == len(B) and not diff
            ok = ok and same
            out[breed] = {
                "frames": len(A), "framesAfter": len(B),
                "identicalFrames": min(len(A), len(B)) - len(diff),
                "differingFrames": len(diff),
                "firstDifferenceAt": diff[0] if diff else None,
                "firstDifferencePhase": (A[diff[0]][1], B[diff[0]][1]) if diff else None,
                "segments": [{"label": l, "at": i, "phase": A[i][1] if i < len(A) else None}
                             for l, i in mA],
                "pass": same,
            }
            print("  %-10s %s  %d frames hashed, %d identical, %d differ"
                  % (breed, "PASS" if same else "FAIL", len(A),
                     out[breed]["identicalFrames"], len(diff)))
            if diff:
                print("     first difference at frame %d (phase %s)"
                      % (diff[0], A[diff[0]][1]))
            # checkpoint after every breed: this run is long, and a stall two
            # breeds in should not cost the two that already passed
            with open(os.path.join(ROOT, "tools", "dogalone.json"), "w") as fh:
                json.dump(out, fh, indent=1)
        await br.close()
    out["allPass"] = ok
    with open(os.path.join(ROOT, "tools", "dogalone.json"), "w") as fh:
        json.dump(out, fh, indent=1)
    print("ALL PASS — the dog alone is pixel-identical" if ok else "FAILED")
    sys.exit(0 if ok else 1)


asyncio.run(main())
