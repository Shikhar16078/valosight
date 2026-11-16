/**
 * The skin catalogue: every VALORANT weapon skin with its weapon, edition, images, levels and variants, from
 * /game/catalog.json (published at build time by scripts/fetch-game.mjs from valorant-api.com). Images are served
 * from this site under /media/ (api/media.js), so the browser never contacts a third party.
 *
 * Optional: when the file is missing (offline build, API down) everything falls back to the estimates in
 * lib/valorant.ts, so callers must handle `null`.
 */
import { lazyJson } from "./lazy-json";
import { setOfficialActs } from "./valorant";

export interface Tier {
  name: string;
  rank: number;
  color: string | null;
  icon: string | null;
}
/** As published: [name, weapon, tier index (-1 none), theme, icon skin id | null, level kinds, chromas]. */
type RawSkin = [string, string, number, string | null, string | null, string[], [string, string, number][]];
interface Raw {
  version: string | null;
  tiers: Tier[];
  skins: RawSkin[];
  themes?: Record<string, string>;
  acts?: [string, string][];
  bundles?: [string, string][];
  passCards?: [string, string][];
  currencies?: [string, string][];
}

export interface Chroma {
  /** "Variant 2 Red"; "" for the base look */
  label: string;
  image: string | null;
  swatch: string | null;
}
export interface CatalogSkin {
  name: string;
  weapon: string;
  edition: Tier | null;
  theme: string | null;
  image: string | null;
  /** Upgrade levels, level 1 first ("" for the base level, else VFX / Animation / Finisher / …). */
  levels: string[];
  chromas: Chroma[];
}
/** A purchase name resolved against the catalogue. */
export interface SkinMatch {
  skin: CatalogSkin;
  /** the level bought, when the name says "Level N" */
  level: number | null;
  /** the variant bought, when the name names one */
  chroma: Chroma | null;
  /** the best picture for this purchase: the variant's render, else the skin's icon */
  image: string | null;
}
export interface SkinCatalog {
  version: string | null;
  /** Riot's editions (Select, Deluxe, Premium, Exclusive, Ultra) with their colour and icon */
  editions: Tier[];
  skins: CatalogSkin[];
  find: (itemName: string | null | undefined) => SkinMatch | null;
  /** a collection's name ("Evori Dreamwings"), from a skin's theme */
  themeName: (theme: string | null | undefined) => string | null;
  /** Riot's act calendar: every act's key ("E9A3", "S2026A4") and start (UTC ms), oldest first */
  acts: { key: string; start: number }[];
  /** a store bundle's art, from a purchase name like "Flower Bundle" */
  findBundle: (itemName: string | null | undefined) => { name: string; image: string } | null;
  /** a battle pass's picture (one of its player cards, wide), by act key ("E7A1", "S2026A5") */
  passImage: (act: string | null | undefined) => string | null;
  /** a currency's icon, from the name in purchases ("Kingdom Credits", "Character Recruitment Token") */
  currencyIcon: (name: string | null | undefined) => string | null;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function buildCatalog(raw: Raw): SkinCatalog {
  const skins: CatalogSkin[] = raw.skins.map(([name, weapon, tier, theme, iconId, levels, chromas]) => {
    const variants = chromas.map(([label, id, flags]) => ({
      label,
      image: flags & 1 ? `/media/weaponskinchromas/${id}/fullrender.png` : null,
      swatch: flags & 2 ? `/media/weaponskinchromas/${id}/swatch.png` : null,
    }));
    return {
      name,
      weapon,
      edition: raw.tiers[tier] ?? null,
      theme,
      // The base variant's full render first: some skins' own icon is valorant-api's grey "missing" placeholder.
      image: variants[0]?.image ?? (iconId ? `/media/weaponskins/${iconId}/displayicon.png` : null),
      levels,
      chromas: variants,
    };
  });
  const byName = new Map(skins.map((s) => [norm(s.name), s]));
  const cache = new Map<string, SkinMatch | null>();
  const find = (itemName: string | null | undefined): SkinMatch | null => {
    if (!itemName) return null;
    const key = norm(itemName);
    if (cache.has(key)) return cache.get(key)!;
    // "Reaver Odin", "Reaver Odin Level 3", "Reaver Odin Level 4 (Variant 1 Red)" (Riot sometimes cuts the end off).
    // Some levels carry a description too ("… Level 4 Kill Banner").
    const m = /^(.*?)(?: level (\d+)(?: [^(]*)?)?(?: \(([^)]*)\)?)?$/.exec(key);
    const skin = m ? byName.get(m[1]) : undefined;
    let out: SkinMatch | null = null;
    if (skin) {
      const v = m![3] ? norm(m![3]) : "";
      // Riot sometimes cuts the name off: match the start, but only once it says at least "Variant N".
      const chroma = v ? (skin.chromas.find((c) => c.label && (norm(c.label) === v || (/^variant \d+/.test(v) && norm(c.label).startsWith(v)))) ?? null) : null;
      out = { skin, level: m![2] ? Number(m![2]) : null, chroma, image: chroma?.image ?? skin.image };
    }
    cache.set(key, out);
    return out;
  };
  const themes = raw.themes ?? {};
  const acts = (raw.acts ?? []).map(([key, d]) => ({ key, start: Date.parse(`${d}T00:00:00Z`) })).filter((a) => Number.isFinite(a.start));
  const bundles = new Map((raw.bundles ?? []).map(([name, id]) => [norm(name), { name, image: `/media/bundles/${id}/displayicon.png` }]));
  const findBundle = (itemName: string | null | undefined) => {
    if (!itemName) return null;
    const k = norm(itemName);
    return bundles.get(k) ?? bundles.get(k.replace(/ bundle$/, "")) ?? null;
  };
  const passCards = new Map(raw.passCards ?? []);
  const passImage = (act: string | null | undefined) => (act && passCards.has(act) ? `/media/playercards/${passCards.get(act)}/wideart.png` : null);
  const currencies = raw.currencies ?? [];
  const currencyIcon = (name: string | null | undefined) => {
    const n = norm(name ?? "");
    if (!n) return null;
    // Whole names only (singular or plural), plus the one Riot spells differently in purchases.
    const ALIAS: Record<string, string> = { "character recruitment token": "agent token" };
    const one = (x: string) => x.replace(/s$/, "");
    const want = ALIAS[one(n)] ?? one(n);
    const hit = currencies.find(([cn]) => one(norm(cn)) === want);
    return hit ? `/media/currencies/${hit[1]}/displayicon.png` : null;
  };
  return { passImage, currencyIcon, version: raw.version, editions: raw.tiers, skins, find, themeName: (t) => (t ? (themes[t] ?? null) : null), acts, findBundle };
}

// Battle passes are named from the act they were bought in: use Riot's real act dates once the catalogue loads.
const useCatalog = lazyJson<Raw, SkinCatalog>("/game/catalog.json", (raw) => (Array.isArray(raw.skins) ? buildCatalog(raw) : null), (cat) => setOfficialActs(cat.acts));

/** The catalogue, or null while it loads or when it isn't available. Loaded once, on first use. */
export function useSkinCatalog(): SkinCatalog | null {
  return useCatalog() ?? null;
}
/** Start downloading the catalogue at boot (same-origin, no personal data), so pictures don't wait on it. */
useSkinCatalog.preload = useCatalog.preload;
