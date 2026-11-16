/*
 * Valosight service worker: keeps a copy of the app itself so it opens and works offline.
 *
 * It only ever stores the app's own files (code, styles, fonts, icons, game data), the public exchange-rate
 * files, and the item pictures you've looked at (public game art from this site's /media/, kept on your own
 * device in the "valosight-media" cache, which the page clears when you remove your data). It never sees
 * your Riot export or your vault: those are read and stored by the page itself, in this browser. It never
 * contacts any other site.
 *
 * The build fills in VERSION and PRECACHE (this release's files, minus rarely needed ones that are saved on
 * first use) — see vite.config.ts. Pictures are never precached.
 */
const VERSION = "__VERSION__";
const PRECACHE = __PRECACHE__;
const CACHE = `valosight-${VERSION}`;
const RATES = "valosight-rates";
const MEDIA = "valosight-media";
/** At most this many pictures are kept; the oldest saved go first. */
const MEDIA_MAX = 800;

self.addEventListener("install", (event) => {
  // All or nothing: if any file fails, this version isn't installed and the previous one keeps working.
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([CACHE, RATES, MEDIA]);
      for (const key of await caches.keys()) if (key.startsWith("valosight-") && !keep.has(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

// Lets the page ask for a waiting update to take over ("Reload to update").
// "clear-media": the page removed the user's data, so forget the saved pictures (see keepPicture for the race).
let mediaGen = 0;
self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
  if (event.data === "clear-media") {
    mediaGen++;
    event.waitUntil(caches.delete(MEDIA));
  }
});

/** Saves a picture, then drops the oldest ones over the limit (a cache lists its keys in the order they were saved). */
async function keepPicture(req, res) {
  const gen = mediaGen;
  const cache = await caches.open(MEDIA);
  await cache.put(req, res);
  // Cleared while this was being saved: don't bring a picture back into a cache the user just emptied.
  if (gen !== mediaGen) return void (await caches.delete(MEDIA));
  const keys = await cache.keys();
  for (const old of keys.slice(0, Math.max(0, keys.length - MEDIA_MAX))) await cache.delete(old);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    // Fresh page when online (revalidated, so a new release is never hidden by the HTTP cache), the saved copy when not.
    event.respondWith(fetch(req, { cache: "no-cache" }).catch(() => caches.match("/", { cacheName: CACHE }).then((r) => r || Response.error())));
    return;
  }

  if (url.pathname.startsWith("/rates/") || url.pathname.startsWith("/demo/")) {
    // Rates change daily and the demo export can change between releases: try the network (revalidated),
    // fall back to the last copy (the demo is also in this release's offline copy).
    event.respondWith(
      fetch(req, { cache: "no-cache" })
        .then((res) => {
          if (res.ok && url.pathname.startsWith("/rates/")) {
            const copy = res.clone();
            event.waitUntil(caches.open(RATES).then((c) => c.put(req, copy)));
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith("/media/")) {
    // A picture's address never changes what it shows: the saved copy first, else the network (good images are kept).
    event.respondWith(
      caches.match(req, { cacheName: MEDIA }).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const type = res.headers.get("content-type") ?? "";
            if (res.ok && res.type === "basic" && /^image\/(png|webp)\b/.test(type)) {
              const copy = res.clone();
              event.waitUntil(keepPicture(req, copy).catch(() => {}));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // App files are versioned by name (game data by its ?v= hash), so the saved copy is always right.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && (url.pathname.startsWith("/assets/") || (url.pathname.startsWith("/game/") && url.searchParams.has("v")))) {
            const copy = res.clone();
            event.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)));
          }
          return res;
        }),
    ),
  );
});
