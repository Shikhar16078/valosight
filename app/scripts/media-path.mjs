/**
 * Which valorant-api.com media paths Valosight serves under /media/ (shared by the Vercel function in
 * api/media.js and the dev server in vite.config.ts): skin, variant, edition and bundle
 * images, and the battle-pass rewards and accessories (skin levels, gun buddies, player cards, sprays, flex,
 * currencies) only.
 */
export const MEDIA_HOST = "https://media.valorant-api.com/";
const PATH = /^(weaponskins|weaponskinchromas|weaponskinlevels|contenttiers|bundles|buddylevels|playercards|sprays|currencies|flex)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(displayicon|fullrender|swatch|largeart|wideart|smallart|fulltransparenticon)\.png$/;

/** @param {string} path e.g. "weaponskins/<uuid>/displayicon.png" */
export const mediaPathOk = (path) => PATH.test(path);

/**
 * Fetches one allowed picture as a fresh request that carries nothing about the visitor (no IP, cookies or
 * referrer; redirects refused, PNG only). Shared by the Vercel function and the dev/preview server, so both behave
 * the same. A picture that doesn't exist upstream is cached briefly; an upstream outage is not cached at all.
 * @param {string} path
 * @returns {Promise<{ status: number, cache: string, body?: Uint8Array }>}
 */
export async function fetchMedia(path) {
  const missing = { status: 404, cache: "public, max-age=3600" };
  if (!mediaPathOk(path)) return missing;
  let r;
  try {
    r = await fetch(`${MEDIA_HOST}${path}`, { headers: { Accept: "image/png" }, redirect: "error", signal: AbortSignal.timeout(15_000) });
  } catch {
    return { status: 502, cache: "no-store" };
  }
  if (r.status === 404) return missing;
  if (!r.ok || r.headers.get("content-type") !== "image/png") return { status: 502, cache: "no-store" };
  // Images for a given id never change: keep them in browsers for a long time.
  return { status: 200, cache: "public, max-age=2592000, immutable", body: new Uint8Array(await r.arrayBuffer()) };
}
