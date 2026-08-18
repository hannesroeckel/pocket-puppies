"""
tools/bowlperf.py — frame cost, console cleanliness, external requests, dark
mode and prefers-reduced-motion, all measured WITH THE BOWL SPLIT.

The depth slot adds one getTransform + two setTransform per drawn frame while a
bowl is placed, and nothing at all otherwise. That is meant to be free; this
measures it on the frames it actually runs on rather than assuming.

Measured with the real loop running (not stepped), on the eating/finish part of
the action where the split is live, at DPR 2 and DPR 3.

Usage:  py tools/bowlperf.py [breeds]
"""
import sys, pathlib as _pl, os, json, asyncio, functools, http.server, socketserver, threading, pathlib

ROOT = str(pathlib.Path(__file__).resolve().parent.parent)
BUDGET = {"workMedian": 4.0, "workP95": 8.0}   # 60fps is 16.7ms; baseline was 1.7 / 2.3


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


async def measure(pg, base, breed, mode, label, out):
    await pg.goto("%s/index.html?breed=%s" % (base, breed))
    await pg.wait_for_function("() => window.__pp && window.__pp.loop && window.__pp.loop.scene")
    await pg.evaluate("() => window.__pp.skipIntro('Alfie')")
    await pg.evaluate("() => window.__pp.loop.stop()")
    await pg.evaluate("() => window.__pp.step(1/60, 60)")
    await pg.evaluate("""() => { window.__pp.setNeed('hunger', 0.05);
                                 window.__pp.setNeed('thirst', 0.05); }""")
    S = await pg.evaluate("() => window.__pp.BALANCE.care")
    st = S["stage"]
    home = st["bowlHome"] if mode == "feed" else st["waterHome"]
    pourer = S["feed"]["sackHome"] if mode == "feed" else S["water"]["jugHome"]
    over = [st["bowlTarget"][0], st["bowlTarget"][1] - 80]
    await pg.evaluate("(m) => window.__pp.care(m)", mode)
    await pg.evaluate("() => window.__pp.step(1/60, 10)")
    await pg.evaluate("(a) => window.__pp.drag({from: a[0], to: a[1], steps: 16})",
                      [home, st["bowlTarget"]])
    await pg.evaluate("(a) => window.__pp.drag({from: a[0], to: a[1], steps: 16, hold: 3.6})",
                      [pourer, over])
    # the real loop, on frames where the bowl is genuinely split across him
    split = await pg.evaluate("() => !!window.__pp.loop.scene.care.bowlSplit")
    await pg.evaluate("() => { window.__pp.loop.start(); window.__pp.resetStats(); }")
    await pg.wait_for_timeout(3500)
    s = await pg.evaluate("() => window.__pp.stats()")
    splitDuring = await pg.evaluate("() => !!window.__pp.loop.scene.care.bowlSplit")
    await pg.evaluate("() => window.__pp.loop.stop()")
    s["bowlSplitAtStart"] = split
    s["bowlSplitAtEnd"] = splitDuring
    s["pass"] = s["workMedian"] <= BUDGET["workMedian"] and s["workP95"] <= BUDGET["workP95"]
    out[label] = s
    print("  %-34s median %-6s p95 %-6s max %-6s frames %-5s split %s  %s"
          % (label, s["workMedian"], s["workP95"], s["workMax"], s["frames"],
             split, "PASS" if s["pass"] else "FAIL"))
    return s



# ---- LAUNCHING A BROWSER -------------------------------------------------
# `p.chromium.launch()` wants Playwright's OWN Chromium build. This machine
# cannot download one (the network refuses it), so every committed gate here
# was as unrunnable as the ones that were never committed at all. `_drive.py`
# resolves the SYSTEM Chrome or Edge instead, and that is the only difference.
def _launch(p):
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    import _drive
    return _drive.browser(p)

async def main():
    argv = [a for a in sys.argv[1:] if not a.startswith("--")]
    breeds = argv[0].split(",") if argv else ["schnoodle"]
    base = serve(8851, ROOT)
    from playwright.async_api import async_playwright

    out, errs, ext = {}, [], []
    async with async_playwright() as p:
        br = await _launch(p)
        for dpr in (2, 3):
            for scheme in ("light", "dark"):
                for reduced in (False, True):
                    ctx = await br.new_context(
                        viewport={"width": 390, "height": 844}, device_scale_factor=dpr,
                        is_mobile=True, has_touch=True, color_scheme=scheme,
                        reduced_motion="reduce" if reduced else "no-preference")
                    pg = await ctx.new_page()
                    pg.on("console", lambda m: errs.append(m.type + ": " + m.text)
                          if m.type == "error" else None)
                    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
                    pg.on("request", lambda r: ext.append(r.url)
                          if not r.url.startswith("http://127.0.0.1") else None)
                    for breed in breeds:
                        await measure(pg, base, breed, "feed",
                                      "dpr%d %s %s %s" % (dpr, scheme,
                                                          "reduced" if reduced else "motion",
                                                          breed), out)
                    await ctx.close()
        await br.close()
    out["consoleErrors"] = errs
    out["externalRequests"] = ext
    ok = all(v["pass"] for k, v in out.items() if isinstance(v, dict)) and not errs and not ext
    out["allPass"] = ok
    with open(os.path.join(ROOT, "tools", "bowlperf.json"), "w") as fh:
        json.dump(out, fh, indent=1)
    print("\nconsole errors:", errs if errs else "none")
    print("external requests:", ext if ext else "none")
    print("ALL PASS" if ok else "FAILED")
    sys.exit(0 if ok else 1)


asyncio.run(main())
