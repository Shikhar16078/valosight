import { useState } from "react";
import { useSettings } from "../lib/settings";

/**
 * How big a picture to download: about twice the CSS width it's shown at (retina). /media/ serves each picture
 * scaled to these widths as WebP (scripts/media-path.mjs); "full" is the original PNG.
 * - xs (128 px): swatches, edition and currency icons
 * - sm (256 px): list rows, drawer rows, table thumbnails
 * - md (512 px): grid tiles and cards
 * - lg (1024 px): the Inspect windows' main picture
 */
export type ImageSize = "xs" | "sm" | "md" | "lg" | "full";
const WIDTH: Record<Exclude<ImageSize, "full">, number> = { xs: 128, sm: 256, md: 512, lg: 1024 };

/** The URL of `src` at `size`: our own /media/ PNGs become their resized WebP; anything else is left alone. */
export function mediaUrl(src: string, size: ImageSize = "md"): string {
  if (size === "full" || !src.startsWith("/media/") || !src.endsWith(".png")) return src;
  return `${src.slice(0, -4)}.w${WIDTH[size]}.webp`;
}

/**
 * Starts downloading a picture before it's shown (e.g. the next item in an Inspect window), so it appears at once.
 * Callers check Settings → Item pictures first: with pictures off nothing may be requested.
 */
export function preloadImage(src: string | null | undefined, size: ImageSize = "md") {
  if (!src || typeof Image === "undefined") return;
  const img = new Image();
  img.decoding = "async";
  img.src = mediaUrl(src, size);
}

type Load = "loading" | "ok" | "error";

/**
 * An item picture from the game catalogue (lib/skins.ts, passes.ts, accessories.ts), served by this site under
 * /media/ at the requested `size`. Loads lazily with a shimmer in its place, settles in once decoded (a picture already in the browser's cache
 * shows at once, with no fade), and leaves its space empty (no broken-image icon) if the picture can't be loaded;
 * a resized picture that fails falls back to the original once. With Settings → Item pictures off it renders
 * nothing and requests nothing.
 */
export function SkinImage({
  src,
  className = "",
  fit = "contain",
  size = "md",
}: {
  src: string | null | undefined;
  className?: string;
  /** "cover" fills the box, cropping the edges (banner art) */
  fit?: "contain" | "cover";
  /** download size, by the shown width × 2; see ImageSize */
  size?: ImageSize;
}) {
  const { settings } = useSettings();
  const sized = src ? mediaUrl(src, size) : src;
  // The load state belongs to one picture: a reused slot given a new src starts over (no stale "error"/"ok").
  const [st, setSt] = useState<{ src: string | null | undefined; url: string | null | undefined; state: Load; instant: boolean }>({ src: sized, url: sized, state: "loading", instant: false });
  const fresh = st.src === sized;
  if (!fresh) setSt({ src: sized, url: sized, state: "loading", instant: false });
  const url = fresh ? st.url : sized;
  const state: Load = fresh ? st.state : "loading";
  const instant = fresh && st.instant;
  if (!url || state === "error" || settings.pictures === false) return <span aria-hidden className={className} />;
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      // Already decoded (from the cache) when it mounts: show it now, without the fade-in.
      ref={(img) => {
        if (img && state === "loading" && img.complete && img.naturalWidth > 0) setSt((s) => (s.url === url && s.state === "loading" ? { ...s, state: "ok", instant: true } : s));
      }}
      onLoad={() => setSt((s) => (s.url === url && s.state === "loading" ? { ...s, state: "ok" } : s))}
      onError={() =>
        setSt((s) => {
          if (s.url !== url) return s;
          // A resized copy that fails (e.g. a conversion error) gets one try at the original.
          if (src && url !== src) return { ...s, url: src, state: "loading", instant: false };
          return { ...s, state: "error" };
        })
      }
      // Loading: a shimmer fills the picture's box. Loaded: it settles in (unless it came from the cache at once).
      className={`${fit === "cover" ? "object-cover" : "object-contain"} ${state === "ok" ? (instant ? "" : "pic-in") : "pic-loading"} ${className}`}
    />
  );
}
