"""
tools/_drive.py — the small shared driver the training-clarity gates run on.

Not a gate itself. It boots the real tree over a real HTTP server in a real
browser at the design viewport, with `requestAnimationFrame` stubbed and
`Date.now` pinned, so every frame comes from an explicit step and nothing in
the save ledger advances with wall-clock time while a check is thinking.

The browser is the SYSTEM Chrome rather than a Playwright-managed build: this
machine cannot download one (the corporate network refuses), and the thing
being checked is canvas geometry and canvas type, which any recent Chromium
draws identically.
"""
import functools, http.server, socketserver, threading, pathlib, os

ROOT = str(pathlib.Path(__file__).resolve().parent.parent)

CHROME = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
]

PIN = ("window.requestAnimationFrame = function () { return 0; };"
       "window.cancelAnimationFrame = function () {};"
       "Date.now = function () { return 1767225600000; };")


class _Q(socketserver.ThreadingTCPServer):
    allow_reuse_address = False
    daemon_threads = True

    def handle_error(self, *a):
        pass


def serve(root=ROOT):
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=root)
    srv = _Q(("127.0.0.1", 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return "http://127.0.0.1:%d" % srv.server_address[1]


def browser(p):
    for exe in CHROME:
        if os.path.exists(exe):
            return p.chromium.launch(executable_path=exe)
    raise SystemExit("no system Chrome or Edge found")


def page(b, inset=0, dpr=2, reduced=False, dark=True):
    """A page at the design viewport, with a chosen safe-area inset."""
    ctx = b.new_context(
        viewport={"width": 390, "height": 844},
        device_scale_factor=dpr,
        is_mobile=True,
        has_touch=True,
        color_scheme="dark" if dark else "light",
        reduced_motion="reduce" if reduced else "no-preference",
    )
    pg = ctx.new_page()
    pg.add_init_script(PIN)
    # remembered so `boot` can apply it through the REAL resize path
    pg._pp_inset = inset
    return ctx, pg


def boot(pg, url, fresh=True):
    """Load the game and wait for the loop to exist. Returns the page."""
    if fresh:
        pg.goto(url + "/index.html")
        pg.evaluate("() => { try { localStorage.clear(); } catch (e) {} }")
    pg.goto(url + "/index.html")
    pg.wait_for_function("() => window.__pp && window.__pp.loop && window.__pp.loop.scene")
    # THE BOOT VEIL IS LIFTED BY ONE rAF, WHICH WE HAVE STUBBED. It is a full-
    # bleed opaque div, so every screenshot came back as the splash screen on a
    # dark brown field — the game was running correctly underneath it the whole
    # time. Lifted here rather than in each gate, because it is a property of
    # pinning the clock and not of anything being tested.
    # REMOVED, not faded: `.gone` is a 0.35s CSS opacity transition, and CSS
    # transitions run on real time — which stubbing rAF does not stop. A
    # screenshot taken promptly caught the splash still half-visible over the
    # game, which looked like a rendering bug in whatever was being tested.
    pg.evaluate("() => { const b = document.getElementById('boot');"
                "        if (b) b.remove(); }")
    pg.evaluate("() => window.__pp.loop.stepFixed(1/60, 8)")

    # ---- THE SAFE-AREA INSET, APPLIED THE WAY A ROTATION APPLIES IT --------
    # index.html keeps a 1px #safeprobe whose padding is env(safe-area-inset-*),
    # and main.js measures it; a desktop browser reports zero for all four, so
    # that element's padding is the lever a notched phone pulls.
    #
    # It used to be set from an init script on DOMContentLoaded, and that was a
    # RACE THAT USUALLY LOST: a module script is deferred, so it runs BEFORE
    # DOMContentLoaded with `readyState === 'interactive'`, which sends main.js
    # down its `else boot()` branch — it had already measured the probe by the
    # time the listener fired. On a cold page the two were close enough to look
    # fine, and on a second page in the same browser the inset was silently 0,
    # which quietly turned every "at inset 40" claim into "at inset 0".
    #
    # So: set it, then dispatch a real `resize`, which is the production path
    # (`main.js` listens for it, re-reads the probe, and hands the inset to
    # every panel through `scene.resize`). Deterministic, and it exercises the
    # code a rotation exercises.
    inset = getattr(pg, "_pp_inset", 0)
    if inset:
        pg.evaluate(
            "(v) => { const el = document.getElementById('safeprobe');"
            "  if (el) el.style.paddingBottom = v + 'px';"
            "  window.dispatchEvent(new Event('resize')); }", inset)
        pg.evaluate("() => window.__pp.loop.stepFixed(1/60, 4)")
        got = pg.evaluate("() => window.__pp.app.view.safe.bottom")
        if abs(got - inset) > 0.5:
            raise SystemExit("driver: asked for inset %s, the game read %s" % (inset, got))
    return pg
