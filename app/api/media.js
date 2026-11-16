/**
 * /media/<path> → https://media.valorant-api.com/<path>, for item pictures (rewritten here by vercel.json).
 *
 * Why a function and not a plain rewrite: Vercel's external rewrites forward the visitor's IP (x-real-ip,
 * x-forwarded-for) to the destination, which would tell a third party which items each visitor owns. Here the
 * image is fetched as a fresh request carrying nothing about the visitor (scripts/media-path.mjs), then cached on
 * Vercel's CDN, so most requests never reach the function at all. It stores and logs nothing itself.
 *
 * Only known image paths are allowed, so it can't be used as an open proxy.
 */
import { fetchMedia } from "../scripts/media-path.mjs";

export async function GET(request) {
  const m = await fetchMedia(new URL(request.url).searchParams.get("path") ?? "");
  const headers = { "Cache-Control": m.cache, "X-Content-Type-Options": "nosniff" };
  if (!m.body) return new Response(m.status === 404 ? "Not found" : "Upstream unavailable", { status: m.status, headers });
  return new Response(m.body, {
    headers: { ...headers, "Content-Type": "image/png", "CDN-Cache-Control": "public, max-age=31536000, immutable" },
  });
}
