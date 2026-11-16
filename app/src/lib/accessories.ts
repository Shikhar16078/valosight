/**
 * Sprays, gun buddies, player cards and flex by name, from /game/accessories.json (published at build time by
 * scripts/fetch-game.mjs from valorant-api.com), to picture things bought with Kingdom Credits. Pictures are
 * served from this site under /media/. Loaded on first use only.
 */
import { lazyJson } from "./lazy-json";

type Raw = { s?: [string, string, number][]; b?: [string, string][]; c?: [string, string][]; f?: [string, string][] };
export type Accessories = { image: (itemName: string | null | undefined) => string | null };

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function buildAccessories(raw: Raw): Accessories {
  const m = new Map<string, string>();
  for (const [n, id, t] of raw.s ?? []) m.set(norm(n), `/media/sprays/${id}/${t ? "fulltransparenticon" : "displayicon"}.png`);
  for (const [n, id] of raw.b ?? []) m.set(norm(n), `/media/buddylevels/${id}/displayicon.png`);
  for (const [n, id] of raw.c ?? []) m.set(norm(n), `/media/playercards/${id}/largeart.png`);
  for (const [n, id] of raw.f ?? []) m.set(norm(n), `/media/flex/${id}/displayicon.png`);
  return { image: (name) => (name ? (m.get(norm(name)) ?? null) : null) };
}

/** The accessories, once `enabled`: undefined while loading, null when unavailable. */
export const useAccessories = lazyJson<Raw, Accessories>("/game/accessories.json", buildAccessories);
