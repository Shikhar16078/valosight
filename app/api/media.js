/**
 * /media/<path> → https://media.valorant-api.com/<path>, for item pictures (rewritten here by vercel.json).
 *
 * Why a function and not a plain rewrite: Vercel's external rewrites forward the visitor's IP (x-real-ip,
 * x-forwarded-for) to the destination, which would tell a third party which items each visitor owns. Here the
 * image is fetched as a fresh request carrying nothing about the visitor (scripts/media-path.mjs), then cached on
 * Vercel's CDN, so most requests never reach the function at all. It stores and logs nothing itself.
 *
 * Only known image paths are allowed, so it can't be used as an open proxy.
 *
 * Sizes: `<file>.png` is the original; `<file>.w<W>.webp` (W = 128, 256, 512 or 1024) is the same picture scaled
 * down to that width and converted to WebP here (sharp), so a tile downloads a few KB instead of up to ~1 MB of
 * PNG. Any other width is a 404. Each variant is cached on the CDN (until the next deployment clears it) and in
 * browsers for 30 days, so a conversion runs only on the first request for it in each region after a deploy.
 *
 * The request may carry only `path` (repeats must match) and nothing else: any extra query (`?x=1`, `?x=2`…) would be a new CDN
 * entry each time, letting anyone force endless fetches and conversions.
 */
import { fetchMedia } from "../scripts/media-path.mjs";

export async function GET(request) {
  const q = new URL(request.url).searchParams;
  // Only `path` (Vercel's rewrite may pass it more than once, always the same value); anything else is refused.
  const paths = q.getAll("path");
  const ok = paths.length > 0 && [...q.keys()].every((k) => k === "path") && paths.every((p) => p === paths[0]);
  const m = ok ? await fetchMedia(paths[0]) : { status: 404, cache: "public, max-age=3600" };
  const headers = { "Cache-Control": m.cache, "X-Content-Type-Options": "nosniff" };
  if (!m.body) return new Response(m.status === 404 ? "Not found" : "Upstream unavailable", { status: m.status, headers });
  return new Response(m.body, {
    headers: { ...headers, "Content-Type": m.type ?? "image/png", "CDN-Cache-Control": "public, max-age=31536000, immutable" },
  });
}
