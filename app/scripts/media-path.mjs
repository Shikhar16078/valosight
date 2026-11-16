/**
 * Which valorant-api.com media paths Valosight serves under /media/ (shared by the Vercel function in
 * api/media.js and the dev server in vite.config.ts): skin, variant, edition and bundle
 * images, and the battle-pass rewards and accessories (skin levels, gun buddies, player cards, sprays, flex,
 * currencies) only.
 *
 * Two forms per picture:
 * - `<folder>/<uuid>/<file>.png`: the original PNG, unchanged (bundle art is ~1 MB, renders ~30 KB).
 * - `<folder>/<uuid>/<file>.w<W>.webp`, W = 128, 256, 512 or 1024: the same picture scaled down to that width
 *   (never up) as WebP, many times smaller. The app asks for about twice the width it shows (retina); see
 *   `mediaUrl` in src/components/SkinImage.tsx. Only these widths exist, so the CDN caches a handful of variants
 *   per picture and the endpoint can't be made to resize to arbitrary sizes.
 */
export const MEDIA_HOST = "https://media.valorant-api.com/";
export const MEDIA_WIDTHS = [128, 256, 512, 1024];
const PATH =
  /^((?:weaponskins|weaponskinchromas|weaponskinlevels|contenttiers|bundles|buddylevels|playercards|sprays|currencies|flex)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(?:displayicon|fullrender|swatch|largeart|wideart|smallart|fulltransparenticon))(?:\.png|\.w(128|256|512|1024)\.webp)$/;

/** @param {string} path e.g. "weaponskins/<uuid>/displayicon.png" or "weaponskins/<uuid>/displayicon.w256.webp" */
export const mediaPathOk = (path) => PATH.test(path);

/** Largest picture we'll decode (pixels): valorant-api's biggest art is well under this; anything larger is refused. */
const MAX_PIXELS = 4096 * 4096;

/**
 * Fetches one allowed picture as a fresh request that carries nothing about the visitor (no IP, cookies or
 * referrer; redirects refused, PNG only). Shared by the Vercel function and the dev/preview server, so both behave
 * the same. A picture that doesn't exist upstream is cached briefly; an upstream outage is not cached at all.
 * For a `.w<W>.webp` path the original PNG is fetched the same way, then scaled to that width and re-encoded as
 * WebP here (sharp, loaded only when needed); a picture that fails to convert is an error and isn't cached.
 * @param {string} path
 * @returns {Promise<{ status: number, cache: string, body?: Uint8Array, type?: "image/png" | "image/webp" }>}
 */
export async function fetchMedia(path) {
  const missing = { status: 404, cache: "public, max-age=3600" };
  const m = PATH.exec(path);
  if (!m) return missing;
  const width = m[2] ? Number(m[2]) : 0;
  let r;
  try {
    r = await fetch(`${MEDIA_HOST}${m[1]}.png`, { headers: { Accept: "image/png" }, redirect: "error", signal: AbortSignal.timeout(15_000) });
  } catch {
    return { status: 502, cache: "no-store" };
  }
  if (r.status === 404) return missing;
  if (!r.ok || r.headers.get("content-type") !== "image/png") return { status: 502, cache: "no-store" };
  let png;
  try {
    png = new Uint8Array(await r.arrayBuffer());
  } catch {
    return { status: 502, cache: "no-store" };
  }
  // Images for a given id never change: keep them in browsers for a long time.
  const cache = "public, max-age=2592000, immutable";
  if (!width) return { status: 200, cache, body: png, type: "image/png" };
  try {
    const { default: sharp } = await import("sharp");
    const webp = await sharp(png, { limitInputPixels: MAX_PIXELS })
      .timeout({ seconds: 10 })
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 80, alphaQuality: 90, effort: 4 })
      .toBuffer();
    return { status: 200, cache, body: new Uint8Array(webp.buffer, webp.byteOffset, webp.byteLength), type: "image/webp" };
  } catch {
    return { status: 502, cache: "no-store" };
  }
}
