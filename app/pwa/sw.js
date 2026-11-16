/*
 * Valosight service worker: keeps a copy of the app itself so it opens and works offline.
 *
 * It only ever stores the app's own files (code, styles, fonts, icons) and the public exchange-rate
 * files. It never sees your Riot export or your vault: those are read and stored by the page itself,
 * in this browser. It never contacts any other site.
 *
 * The build fills in VERSION and PRECACHE (every file of this release) — see vite.config.ts.
 */
const VERSION = "__VERSION__";
const PRECACHE = __PRECACHE__;
const CACHE = `valosight-${VERSION}`;
const RATES = "valosight-rates";

self.addEventListener("install", (event) => {
  // All or nothing: if any file fails, this version isn't installed and the previous one keeps working.
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith("valosight-") && key !== CACHE && key !== RATES) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

// Lets the page ask for a waiting update to take over ("Reload to update").
self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

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

  // App files are versioned by name, so the saved copy is always right.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && url.pathname.startsWith("/assets/")) {
            const copy = res.clone();
            event.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)));
          }
          return res;
        }),
    ),
  );
});
