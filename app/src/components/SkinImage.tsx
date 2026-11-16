import { useState } from "react";
import { useSettings } from "../lib/settings";
import { SOFT_CSS } from "./anim";

/**
 * An item picture from the game catalogue (lib/skins.ts, passes.ts, accessories.ts), served by this site under
 * /media/. Loads lazily, fades in once decoded, and leaves its space empty (no broken-image icon) if the picture
 * can't be loaded. With Settings → Item pictures off it renders nothing and requests nothing.
 */
export function SkinImage({ src, className = "", fit = "contain" }: { src: string | null | undefined; className?: string; /** "cover" fills the box, cropping the edges (banner art) */ fit?: "contain" | "cover" }) {
  const { settings } = useSettings();
  // The load state belongs to one picture: a reused slot given a new src starts over (no stale "error"/"ok").
  const [st, setSt] = useState<{ src: string | null | undefined; state: "loading" | "ok" | "error" }>({ src, state: "loading" });
  const state = st.src === src ? st.state : "loading";
  if (st.src !== src) setSt({ src, state: "loading" });
  if (!src || state === "error" || settings.pictures === false) return <span aria-hidden className={className} />;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onLoad={() => setSt({ src, state: "ok" })}
      onError={() => setSt({ src, state: "error" })}
      className={`${fit === "cover" ? "object-cover" : "object-contain"} transition-[opacity,transform] ${SOFT_CSS} ${state === "ok" ? "scale-100 opacity-100" : "scale-95 opacity-0"} ${className}`}
    />
  );
}
