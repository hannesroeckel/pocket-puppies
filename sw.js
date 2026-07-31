/* ==========================================================================
   sw.js — precache everything, serve it cache-first, update atomically.

   WHY THIS FILE IS A DATA-INTEGRITY FEATURE, NOT POLISH.

   iOS's Intelligent Tracking Prevention deletes ALL script-writable storage —
   localStorage, IndexedDB, *and the service worker registration itself* — after
   seven days of Safari use without a first-party visit. Installed home-screen
   web apps are exempt. So the job here is twofold:

     1. Make the game work with no network at all, so it opens in a tunnel, on a
        plane, or at her parents' house.
     2. Be one of the two things that makes installing worth doing (the other is
        the install prompt in `src/ui/install.js`), because installing is what
        actually stops her losing the dog.

   THREE RULES THIS FILE KEEPS, AND WHY EACH ONE IS LOAD-BEARING.

   A. ONE GENERATION PER CACHE, AND A PAGE LOAD NEVER STRADDLES TWO.
      The game is ~40 unbundled ES modules with no build step, so "half old,
      half new" is a real and very ugly failure: `room.js` from v3 calling into
      `train.js` from v4 would throw somewhere deep and look like a broken
      puppy. Everything is precached into `pp-cache-v<VERSION>` in `install`,
      and **nothing is ever added to a cache at runtime**. A generation is
      therefore exactly the list below, frozen at install time. Runtime caching
      is precisely the mechanism that mixes generations, so there is none.

   B. INSTALL IS ALL-OR-NOTHING.
      `install` fails if ANY asset fails to fetch, which leaves the previous
      worker active and the previous cache intact. A deploy she catches
      mid-flight (GitHub Pages publishes files one at a time) therefore cannot
      produce a broken generation — the install just fails and is retried later,
      and she keeps playing the version she already has.

   C. THE UPDATE LANDS BETWEEN SESSIONS, NEVER DURING ONE.
      There is deliberately **no unconditional `skipWaiting()`**. A new worker
      waits. The page keeps being served by the old worker out of the old cache
      for the whole of the current session, so what she is playing cannot change
      under her. `src/main.js` posts `skip-waiting` only when the app goes
      HIDDEN and the save has already been flushed; the swap then happens with
      nobody looking, and the next launch is entirely the new version.

   AND THE ONE RULE ABOUT HER SAVE: this file never touches it. The save lives
   in localStorage, which no cache operation can reach, and `caches.delete` is
   only ever called on keys carrying our own prefix — so a stray cache belonging
   to anything else on the origin is left alone.

   NO NOTIFICATIONS. There is no `push` and no `notificationclick` handler here
   and there must never be one: GIFT-READY.md §3 excludes notifications
   outright, because they are the fastest way to turn a present into a chore.
   ========================================================================== */

/* ---- BUMP THIS ON EVERY DEPLOY ----------------------------------------
   The whole update path hangs off this one string. Changing it makes the
   browser see a byte-different `sw.js`, which starts a new install into a new
   cache; leaving it alone while changing a module would serve the module from
   the old cache forever. */
const VERSION = '7.0.0';
const PREFIX = 'pp-cache-v';
const CACHE = PREFIX + VERSION;

/* ---- everything the game is ------------------------------------------
   Hand-maintained on purpose: there is no build step (ARCHITECTURE §1), so a
   generated list would need a generator in the deploy path. `tools/check-precache.py`
   diffs this against the tree so a module added in a later stage cannot be
   silently left out — which would break offline for that one file only, i.e.
   the worst kind of bug to notice. */
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/apple-touch-icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './src/main.js',
  './src/dog/anim/index.js',
  './src/dog/anim/tricks.js',
  './src/dog/breeds.js',
  './src/dog/care.js',
  './src/dog/contest.js',
  './src/dog/draw.js',
  './src/dog/idle.js',
  './src/dog/pet.js',
  './src/dog/reunion.js',
  './src/dog/rig.js',
  './src/dog/toy.js',
  './src/dog/train.js',
  './src/dog/voice.js',
  './src/dog/walk.js',
  './src/engine/audio.js',
  './src/engine/draw.js',
  './src/engine/input.js',
  './src/engine/loop.js',
  './src/engine/rng.js',
  './src/engine/sfx.js',
  './src/engine/spring.js',
  './src/scenes/props.js',
  './src/scenes/room.js',
  './src/state/balance.js',
  './src/state/contest.js',
  './src/state/game.js',
  './src/state/save.js',
  './src/state/time.js',
  './src/state/walks.js',
  './src/ui/hud.js',
  './src/ui/install.js',
  './src/ui/meter.js',
  './src/ui/naming.js',
  './src/ui/nav.js',
  './src/ui/routemap.js',
  './src/ui/sheet.js',
  './src/ui/text.js',
  './src/ui/toast.js',
  /* the real-device capability probe. Cheap, and it is the thing that will
     eventually answer whether a save survived a week (PLATFORM-RISKS), so it
     should still open with no signal. */
  './probe.html',
  './probe.webmanifest',
];

/* ==========================================================================
   install — fetch every asset fresh, all or nothing
   ========================================================================== */
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    /* `cache: 'reload'` bypasses the HTTP cache, so a deploy is never masked by
       a 10-minute GitHub Pages max-age. `addAll` is already all-or-nothing, but
       it is opaque about WHICH entry failed, and a silent offline hole in one
       module is the bug this whole file exists to prevent — so fetch them
       individually and name the casualty. */
    const results = await Promise.all(PRECACHE.map(async (url) => {
      try {
        const req = new Request(url, { cache: 'reload' });
        const res = await fetch(req);
        /* an opaque or error response cached is a landmine that only goes off
           offline, which is the one moment there is no way to recover */
        if (!res || !res.ok) return url + ' -> ' + (res ? res.status : 'no response');
        await cache.put(url, res.clone());
        return null;
      } catch (err) {
        return url + ' -> ' + (err && err.message ? err.message : 'fetch failed');
      }
    }));
    const failed = results.filter(Boolean);
    if (failed.length) {
      /* Throwing fails the install. The OLD worker stays active with the OLD
         cache, so she keeps a complete working game rather than getting a
         half-updated one. */
      await caches.delete(CACHE);
      throw new Error('precache incomplete (' + failed.length + '): ' + failed.join(', '));
    }
    /* deliberately NO self.skipWaiting() here — see rule C in the header */
  })());
});

/* ==========================================================================
   activate — drop older generations, then take over
   ========================================================================== */
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => {
      /* ONLY our own caches, ever. Something else on this origin owning a cache
         is not our business, and deleting it would be a bug with no upside. */
      if (k.indexOf(PREFIX) !== 0 || k === CACHE) return Promise.resolve(false);
      return caches.delete(k);
    }));
    await self.clients.claim();
  })());
});

/* ==========================================================================
   fetch — cache-first for the shell, and never write to the cache
   ========================================================================== */
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;      // nothing third-party exists
  /* a Range request (media) served from a full cached body is a subtle
     correctness bug; the game has no media, so decline rather than guess */
  if (req.headers.has('range')) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);

    /* A NAVIGATION ALWAYS RESOLVES TO THE APP SHELL. `start_url` is '.', an
       installed app may be launched at './' or './index.html', and a stray
       query string (`?utm=`, an iOS re-launch parameter) must not miss. */
    if (req.mode === 'navigate') {
      const shell = (await cache.match('./index.html')) || (await cache.match('./'));
      if (shell) return shell;
    }

    /* ignore the query string when matching: the modules are imported without
       one, but a reload can add cache-busting parameters */
    const hit = (await cache.match(req)) || (await cache.match(req, { ignoreSearch: true }));
    if (hit) return hit;

    /* Not part of this generation (`spike-*.html`, `review/*`, a stage that
       forgot to add itself to PRECACHE). Go to the network — and do NOT cache
       the result, because a cache is one whole generation and adding to it
       after install is exactly how generations get mixed. */
    try {
      return await fetch(req);
    } catch (err) {
      /* offline and unknown. A navigation still gets the game rather than the
         browser's dinosaur; anything else honestly fails. */
      if (req.mode === 'navigate') {
        const shell = (await cache.match('./index.html')) || (await cache.match('./'));
        if (shell) return shell;
      }
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});

/* ==========================================================================
   messages — the page's half of the update handshake
   ========================================================================== */
self.addEventListener('message', (e) => {
  const d = e.data || {};
  /* main.js sends this ONLY once the app is hidden and the save is flushed */
  if (d.type === 'skip-waiting') { self.skipWaiting(); return; }
  if (d.type === 'version' && e.source) {
    e.source.postMessage({ type: 'version', version: VERSION, cache: CACHE });
  }
});
