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
    if inset:
        # THE INSET IS READ BACK OUT OF THE DOM, not out of a variable: index.html
        # keeps a 1px #safeprobe whose padding is env(safe-area-inset-*), and
        # main.js measures it. A headless browser reports zero for all four, so
        # the lever a notched phone pulls is that element's padding-bottom.
        pg.add_init_script(
            "addEventListener('DOMContentLoaded', () => {"
            "  const el = document.getElementById('safeprobe');"
            f"  if (el) el.style.paddingBottom = '{inset}px';"
            "});")
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
    pg.evaluate("() => { const b = document.getElementById('boot');"
                "        if (b) b.classList.add('gone'); }")
    pg.evaluate("() => window.__pp.loop.stepFixed(1/60, 8)")
    return pg
