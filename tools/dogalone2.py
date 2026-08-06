"""
tools/dogalone2.py — THE DOG ALONE IS UNCHANGED, byte for byte, in lockstep.

Same claim as `dogalone.py`, different method, because the first method could
not be trusted. That one runs the pre-fix tree to completion, then this one,
and compares per-frame hashes of a canvas region. Run that way it reported 310
of 1170 frames differing — while the SAME frames, stepped side by side and
compared as whole images, were bit-identical. A harness whose answer depends
on whether the two runs are interleaved is not measuring the code.

So this one holds both trees open at once, advances them one frame at a time
together, and compares the PNG bytes of the whole page. No hashing, no region,
no sequential drift: if a single pixel anywhere differs, the bytes differ.

Both trees get the same three neutralisations, before any script runs:

  requestAnimationFrame  stubbed, so the loop never advances on its own and
                         every frame comes from an explicit step()
  Date.now               frozen, because state/game.js defaults a dozen
                         arguments to it and the bond ledger and need decay
                         would otherwise advance with real time
  dust motes             switched off (they advance once per DRAW, not per
                         step, so a second draw of the "same" frame moves them)

and all three care prop layers are suppressed, so the dog is drawn with NO
bowl present at all — through every pose the action puts him in: standing and
watching, folding down, head deep into a bowl that isn't there, licking,
shaking, pushing back up, and idle at either end.

Usage:
    py tools/dogalone2.py --before C:\\path\\to\\pre-fix\\tree [breeds]
Exit code 0 = every frame of every breed was byte-identical.
"""
import sys, os, json, asyncio, functools, http.server, socketserver, threading, pathlib

ROOT = str(pathlib.Path(__file__).resolve().parent.parent)
BREEDS_ALL = ["shiba", "cockapoo", "schnoodle"]


class _Q(socketserver.ThreadingTCPServer):
    allow_reuse_address = False
    daemon_threads = True

    def handle_error(self, *a):
        pass


def serve(root):
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=root)
    srv = _Q(("127.0.0.1", 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return "http://127.0.0.1:%d" % srv.server_address[1]


PIN = ("window.requestAnimationFrame = function () { return 0; };"
       "window.cancelAnimationFrame = function () {};"
       "Date.now = function () { return 1767225600000; };")

SETUP = """() => {
  const sc = window.__pp.loop.scene;
  const noop = () => {};
  sc.care.drawBehind = noop;
  sc.care.drawMid = noop;
  sc.care.drawFront = noop;
  window.__pp.BALANCE.particles.motes = 0;
  sc.resize(window.__pp.app);
  return { t: +window.__pp.loop.t.toFixed(6), frames: window.__pp.loop.frames };
}"""


async def openpg(br, base, breed, dpr):
    ctx = await br.new_context(viewport={"width": 390, "height": 844},
                               device_scale_factor=dpr, is_mobile=True, has_touch=True)
    pg = await ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.type + ": " + m.text)
          if m.type == "error" else None)
    await pg.add_init_script(PIN)
    await pg.goto("%s/index.html?breed=%s" % (base, breed))
    await pg.wait_for_function("() => window.__pp && window.__pp.loop && window.__pp.loop.scene")
    await pg.evaluate("() => window.__pp.skipIntro('Alfie')")
    await pg.evaluate("() => window.__pp.loop.stop()")
    await pg.evaluate("() => window.__pp.step(1/60, 90)")
    await pg.evaluate("""() => { window.__pp.setNeed('hunger', 0.05);
                                 window.__pp.setNeed('thirst', 0.05); }""")
    await pg.evaluate("() => window.__pp.step(1/60, 30)")
    clock = await pg.evaluate(SETUP)
    return ctx, pg, clock, errs


async def run(br, a_base, b_base, breed, dpr, out):
    ca, pa, cla, ea = await openpg(br, a_base, breed, dpr)
    cb, pb, clb, eb = await openpg(br, b_base, breed, dpr)
    marks, diffs, n = [], [], 0

    async def steps(k, label, hashed=True):
        nonlocal n
        marks.append((label, n))
        for _ in range(k):
            await pa.evaluate("() => window.__pp.step(1/60, 1)")
            await pb.evaluate("() => window.__pp.step(1/60, 1)")
            n += 1
            if not hashed:
                continue
            sa = await pa.screenshot()
            sb = await pb.screenshot()
            if sa != sb:
                diffs.append([n, label])

    async def both(js, arg=None):
        if arg is None:
            await pa.evaluate(js)
            await pb.evaluate(js)
        else:
            await pa.evaluate(js, arg)
            await pb.evaluate(js, arg)

    S = await pa.evaluate("() => window.__pp.BALANCE.care")
    st = S["stage"]
    await steps(40, "idle-before")
    for mode in ("feed", "water"):
        home = st["bowlHome"] if mode == "feed" else st["waterHome"]
        pourer = S["feed"]["sackHome"] if mode == "feed" else S["water"]["jugHome"]
        over = [st["bowlTarget"][0], st["bowlTarget"][1] - 80]
        await both("(m) => window.__pp.care(m)", mode)
        await steps(10, mode + "-open")
        await both("(a) => window.__pp.drag({from: a[0], to: a[1], steps: 16})",
                   [home, st["bowlTarget"]])
        await steps(30, mode + "-placed-upright")
        await both("(a) => window.__pp.drag({from: a[0], to: a[1], steps: 16, hold: 3.6})",
                   [pourer, over])
        await steps(300, mode + "-through-the-action")
        await both("() => window.__pp.stopCare()")
        await steps(40, mode + "-at-rest")
    await steps(30, "idle-after")

    ok = (not diffs) and cla == clb and not ea and not eb
    out[breed] = {
        "framesCompared": n, "differingFrames": len(diffs),
        "firstDifference": diffs[0] if diffs else None,
        "clockBefore": cla, "clockAfter": clb, "sameClock": cla == clb,
        "segments": [{"label": l, "atFrame": i} for l, i in marks],
        "consoleBefore": ea, "consoleAfter": eb,
        "pass": ok,
    }
    print("  %-10s %s  %d frames compared in lockstep, %d differ  (clock %s)"
          % (breed, "PASS" if ok else "FAIL", n, len(diffs),
             "matched" if cla == clb else "DIFFERENT"))
    if diffs:
        print("     first difference at frame %d (%s)" % (diffs[0][0], diffs[0][1]))
    await ca.close()
    await cb.close()
    return ok


async def main():
    if "--before" not in sys.argv:
        print("need --before <path to the pre-fix tree>")
        sys.exit(2)
    before = sys.argv[sys.argv.index("--before") + 1]
    dpr = 3
    if "--dpr" in sys.argv:
        dpr = int(sys.argv[sys.argv.index("--dpr") + 1])
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

    a_base, b_base = serve(before), serve(ROOT)
    from playwright.async_api import async_playwright
    out, ok = {}, True
    print("dog alone, lockstep: before=%s  after=%s  dpr=%d" % (before, ROOT, dpr))
    async with async_playwright() as p:
        br = await p.chromium.launch()
        for breed in breeds:
            ok = await run(br, a_base, b_base, breed, dpr, out) and ok
            with open(os.path.join(ROOT, "tools", "dogalone2.json"), "w") as fh:
                json.dump(out, fh, indent=1)
        await br.close()
    out["allPass"] = ok
    with open(os.path.join(ROOT, "tools", "dogalone2.json"), "w") as fh:
        json.dump(out, fh, indent=1)
    print("ALL PASS — the dog alone is byte-identical" if ok else "FAILED")
    sys.exit(0 if ok else 1)


asyncio.run(main())
