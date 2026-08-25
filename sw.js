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
/* stage 8 changed rig.js, care.js, main.js, room.js, audio.js and balance.js —
   the floating-bowl floor fix and the iOS silent-switch override. NO new file:
   the silent-session audio is generated as a data URI in engine/audio.js
   precisely so it needs no asset, no fetch and no entry below. The PRECACHE list
   is therefore unchanged (`py tools/check-precache.py`: 49 entries, matches the
   tree) but the generation MUST still move, or every one of those six modules is
   served from the old cache for ever and the fix ships to nobody. A previous
   stage nearly shipped a 404-offline regression by forgetting exactly this. */
/* THE RULE THIS NUMBER TAUGHT US: a revert must never walk it backwards. When
   8.2.0 was reverted, reverting the commit also reverted this constant to 8.1.0
   — and a phone already holding the 8.2.0 cache would then have kept serving the
   withdrawn version for ever, because the worker only rebuilds when the cache
   NAME changes and has no notion of "newer". The revert shipped as 8.3.0 for
   exactly that reason. Always forward, never back.

   HISTORY OF THE BOWL, because the number records it:
     8.2.0  split the vessel across the dog — fixed food-painted-over-the-muzzle,
            but hooked the far half in behind the WHOLE dog, so an upright dog had
            a bowl buried in his chest. Upright is most of the time and eating is
            a few seconds, so that was the worse of the two failures.
     8.3.0  the revert. Unsplit bowl, shipped forward, and this is what the
            phones in the field are holding.
     8.4.0  the split comes back AT THE RIGHT DEPTH (§19.5): `dog/draw.js` gained
            a `mid` callback, so `care.drawMid` threads the vessel/interior/far
            rim/food between his body and his head, `care.drawFront` carries only
            the near rim and `care.drawBehind` only the fur pile. The muzzle goes
            into the vessel (8.2.0's intent) AND his torso no longer occludes it.

   8.5.0 — THE DESIGN-SYSTEM PASS, ON TOP OF THE 8.4.0 BOWL.

   TWO MODULES ARE NEW — `src/ui/tokens.js` and `src/ui/surface.js` — so this
   generation MUST move and both MUST appear in PRECACHE below. Every UI module
   now imports tokens.js; if it were missing from the list the game would boot
   fine online and, offline, fail to resolve an import in `ui/nav.js`, `ui/hud.js`,
   `ui/meter.js`, `ui/sheet.js`, `ui/shop.js`, `ui/kennel.js` and `ui/install.js`
   at once — i.e. a blank screen on the plane, from one forgotten line.
   `py tools/check-precache.py` now expects 51 entries.

   WHY 8.5.0 AND NOT THE 9.0.0 THIS BRANCH USED TO CARRY. While the design pass
   was unmerged it numbered itself 9.0.0, chosen when master was still on the
   reverted 8.3.0. Master then shipped the real bowl fix as 8.4.0. 9.0.0 was
   never deployed anywhere — no phone has ever held a `pp-cache-v9.0.0` — so
   collapsing it to 8.5.0 walks nothing backwards for any real device, and it
   keeps the deployed line contiguous: 8.3.0 (live) -> 8.4.0 (bowl) -> 8.5.0
   (bowl + design pass). What must never happen is landing AT OR BELOW 8.4.0,
   which would leave a phone that took the bowl fix serving it for ever with no
   design pass on top.

   8.6.0 (§19.7): the fourth bowl defect — his chin outside the vessel and
   below it. The vessel's own art changed (SPREAD, and a foot instead of a
   point) and the eating stoop changed with it, so a phone holding 8.5.0 would
   otherwise serve the narrow bowl for ever. Forward only, as always: 8.5.0
   went out, so this is 8.6.0 and never anything at or below it.

   8.21.0: ALL THREE DOGS WALK OUT AS HIS OWN ART. `side-shiba.webp` completes
   the set — prick ears, a curled tail and cream points, which is a genuinely
   different silhouette from the two doodles rather than a recolour. The drawn
   profile (`dog/side.js`) is no longer visible anywhere in the game: it stays as
   the fallback for any breed added later without a sheet, which is a real path
   and is asserted by `tools/walkgate.py` rather than assumed.
   `py tools/check-precache.py` now expects 68 entries.

   8.20.0: THE PROFILE DOG IS THE HUMAN'S OWN ART. Four new entries and two of
   them are IMAGES, which is a first for this project: the dog has been drawn from
   springs since stage 1, and `src/assets/side-*.webp` are painted sheets. They
   went in because the drawn profile was rejected twice and he made better ones
   ("i built the side view of the schnoodle with chatgpt as yours looked bad").
   Two breeds have sheets; the Shiba has none and falls back to the drawn profile,
   which is why `dog/side.js` was kept. `py tools/check-precache.py` now expects 67
   entries and now also checks `.webp`, because a sheet on disk and absent from
   this list is a dog who vanishes the moment the phone goes offline.

   8.19.0: THE DOG CAN BE SEEN FROM THE SIDE. FIVE NEW MODULES, and four of them
   are load-bearing for the dog you already have: `dog/part.js` (the coat),
   `dog/coat.js` (the tufted mass), `dog/face.js` (eye, nose, mouth) and
   `dog/coatstate.js` (muddy, soapy, wet, glossy) all came OUT of `dog/draw.js`,
   which now imports them. A phone that took this generation without them would
   fail to resolve an import and show a blank screen — the exact failure 8.5.0's
   note describes, and the reason this list is checked rather than trusted.
   `dog/side.js` is the fifth and is the only one nothing imports yet: it is the
   profile dog, complete and rendering, waiting on the walk to use it. It ships
   because a module the tree contains and the cache does not is a 404 waiting for
   whoever wires it up. `py tools/check-precache.py` now expects 63 entries.

   The frontal dog is BYTE-IDENTICAL across all of it: seven extraction batches,
   each proven with `breedproof` and `bowlpixels` before the next began.

   8.18.0: HE CATCHES IT, AND SHE IS TOLD HOW (schema v10). ONE NEW MODULE —
   `src/ui/howto.js` — so this generation MUST move and it MUST appear in
   PRECACHE below: `scenes/room.js` and `main.js` both import it unconditionally,
   and a phone that took this generation without it would fail to resolve the
   import offline and show a blank screen. SCHEMA v10 adds `flags.howto`, the set
   of modes she has been shown; `MIGRATIONS[10]` fills it empty, which means an
   existing save is offered each card once — deliberately, because the person
   playing that save is the one who said "one doesnt really know what to do".
   `dog/disc.js` and `state/balance.js` move with it: he runs to the disc, leaps
   properly, and takes it in his mouth. `py tools/check-precache.py` now expects
   58 entries.

   8.17.0: THE CONTESTS HAPPEN SOMEWHERE ELSE. ONE NEW MODULE —
   `src/scenes/outdoors.js` — so this generation MUST move and it MUST appear in
   PRECACHE below: `scenes/room.js` imports it unconditionally, and a phone that
   took this generation without it would fail to resolve the import offline and
   show a blank screen (the failure 8.5.0's note describes). `dog/contest.js` and
   `state/balance.js` move with it — the ring's indoor dim wash is gone and its
   spotlight is a third of the strength, because the trial is outdoors in daylight
   now. No schema change: where he competes is not something a save records.
   `py tools/check-precache.py` now expects 57 entries.

   8.16.1: THE DISC COULD NOT BE THROWN. `scenes/room.js` routed only `down` to
   the disc layer, so the flick's trail of `move` events and its `up` never
   arrived: she could pick the disc up and nothing else could happen. Reported
   from the phone within minutes of 8.16.0 going out. No new module, no schema
   change — one branch in each of the move/up/cancel paths.

   8.16.0: THE DISC GAME (schema v9). TWO NEW MODULES — `src/dog/disc.js` and
   `src/state/disc.js` — so this generation MUST move and both MUST appear in
   PRECACHE below: `scenes/room.js` and `state/game.js` import them
   unconditionally, and a phone that took this generation without them would
   fail to resolve an import offline and show a blank screen. That is the
   failure 8.5.0's note describes, and it is why this list is checked rather
   than trusted (`py tools/check-precache.py` now expects 56 entries).

   The save's `contests.disc` stub is reshaped by MIGRATIONS[9]: `rank` and
   `wins` are dropped because both describe a rank ladder, and SCOPE's
   non-negotiables cut "rank ladders per contest type" outright.

   8.15.0: DECOR ON THE CARE LADDER. Two earned rows that change the baked room
   art — `state/balance.js` and `scenes/room.js` move; no new module, no schema
   change (unlocks are DERIVED from `carePoints` and were never stored, which is
   why trimming or extending that table costs nobody anything they had earned).
   A phone holding 8.14.0 has a ladder with one decor row on it.

   8.14.0: HE CAN WEAR WHAT HE FINDS. `state/game.js`, `dog/draw.js`,
   `scenes/room.js`, `ui/collection.js` and the wear tunables move; no new module
   and no schema change — `dog.wear.accessory` has been in the save since stage 1
   and was never written to. A phone holding 8.13.0 has a bell and a ribbon it
   cannot put on him.

   8.13.0: HE GIVES YOU HIS PAW. `dog/pet.js` and `scenes/room.js` move; no new
   module and no schema change. A phone holding 8.12.0 answers a tap on his paw
   with irritation, which is the defect.

   8.12.0: A TOAST NO LONGER COVERS THE THING IT IS TALKING ABOUT. `ui/toast.js`,
   `scenes/room.js` and the toast tunables move; no new module and no schema
   change. A phone holding 8.11.0 still puts "Biscuit is full" on top of the bowl.

   8.11.0: FOUR MORE THINGS IN THE SHOP, EACH OF WHICH DOES SOMETHING. No new
   module and no schema change, but `state/balance.js`, `dog/care.js`,
   `state/time.js`, `dog/toy.js`, `scenes/props.js` and `ui/shop.js` all move, and
   a phone holding 8.10.0 would show a twelve-row shop it cannot honour — the
   rows come from balance.js and the EFFECTS come from the modules. Forward only.

   8.10.0: EVERY FIND HAS A HOME AND A PURPOSE (schema v8). `src/ui/collection.js`
   is a NEW MODULE and MUST appear in PRECACHE below — `scenes/room.js` imports it
   unconditionally, so a phone that took this generation without it would fail to
   resolve the import offline and show a blank screen. The room now draws what she
   has PUT OUT rather than the last seven of everything, and a duplicate find of
   any kind pays coins, so a phone holding 8.9.0 keeps a shelf that silently drops
   things out of the back. `py tools/check-precache.py` now expects 54 entries.

   Note the version is 8.10.0 and not 8.9.1: this is a schema bump and a new
   surface, not a patch. String comparison is never used on these — the cache name
   is matched exactly and old generations are deleted by prefix — so a two-digit
   minor is safe.

   8.9.0: THE SAVE TRACKS TIME PER DOG (schema v7). Needs now decay for EVERY
   dog rather than only the one in the room, and the reunion runs on the longer
   of two gaps — how long the app was shut, and how long since she was last with
   THIS dog. A phone holding 8.8.0 keeps a second dog frozen in time and greets a
   fortnight-neglected dog flatly, so this must go out as a new cache. The
   migration seeds every dog's clock from the app clock, which is the only
   seeding that cannot invent a gap and fire a reunion nobody earned.

   8.8.0: THE TRAINING SCREEN SAYS WHAT IT CONTAINS. `src/ui/tricklist.js` is a
   NEW MODULE and MUST appear in PRECACHE below — `scenes/room.js` imports it
   unconditionally, so a phone that took this generation without it would fail to
   resolve the import offline and get a blank screen, which is the exact failure
   8.5.0's note describes. Sit and lie down also stopped sharing one gesture
   (`dog/anim/tricks.js`, `dog/train.js`), so a phone holding 8.7.1 would keep
   teaching both with one stroke for ever. Forward only, as always.
   `py tools/check-precache.py` now expects 53 entries.

   8.7.1: THE REACHABLE PLAY AREA (ui/reach.js). A ball dropped after he was hit
   with it landed at a hardcoded y 782, which is inside the nav's hit rect on the
   target iPhone, so the touch went to the bar and the ball could never be picked
   up again — the punishment for an accidental hit was losing the toy for good.
   The ball's home was already 61% behind the bar on first launch. Every
   interactive prop is now clamped to a bound derived from the bar's real
   geometry and `env(safe-area-inset-bottom)`, and a per-frame assertion says so.
   A phone holding 8.6.0 has the unreachable ball, so this must go out as a new
   cache. 8.7.0 is reserved for a sibling branch landing at the same time; this
   is 8.7.1 to avoid two different builds claiming one cache name. Forward only,
   as always. */
const VERSION = '8.21.0';
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
  /* ---- THE PROFILE SPRITES ------------------------------------------
     The human's own art (docs/reference/side-walk-*.png, sliced by
     tools/make-sidesprites.py). WebP because the sheets are soft gradients over
     flat areas, which is PNG's worst case: 111KB against 923KB for one breed,
     and everything here is precached for offline so every byte is permanent.
     Safari has decoded WebP since iOS 14. */
  './src/assets/side-meta.js',
  './src/assets/side-cockapoo.webp',
  './src/assets/side-schnoodle.webp',
  './src/assets/side-shiba.webp',
  './src/dog/sidesprite.js',
  './src/dog/care.js',
  './src/dog/coat.js',
  './src/dog/coatstate.js',
  './src/dog/face.js',
  './src/dog/part.js',
  './src/dog/side.js',
  './src/dog/contest.js',
  './src/dog/disc.js',
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
  './src/scenes/outdoors.js',
  './src/scenes/props.js',
  './src/scenes/room.js',
  './src/state/balance.js',
  './src/state/contest.js',
  './src/state/disc.js',
  './src/state/game.js',
  './src/state/save.js',
  './src/state/time.js',
  './src/state/walks.js',
  './src/ui/hud.js',
  './src/ui/howto.js',
  './src/ui/install.js',
  './src/ui/meter.js',
  './src/ui/naming.js',
  './src/ui/nav.js',
  /* the reachable play area. Imported by main, the room, the nav, the toy, care
     and the walk — forgetting it would 404 the whole game offline, not one
     feature, which is why `tools/check-precache.py` exists. */
  './src/ui/reach.js',
  './src/ui/routemap.js',
  './src/ui/sheet.js',
  /* stage 6. Two new modules mean two new lines here, and forgetting them is
     exactly the failure the note at the fetch handler describes: the game
     would boot online and 404 the shop and the kennel on a plane. */
  './src/ui/shop.js',
  './src/ui/kennel.js',
  './src/ui/tricklist.js',
  './src/ui/collection.js',
  /* stage 9, the design-system pass. `tokens.js` is imported by every module in
     this directory, so of the 51 entries it is the single most expensive one to
     forget. */
  './src/ui/surface.js',
  './src/ui/tokens.js',
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
