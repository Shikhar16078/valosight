#!/usr/bin/env node
/**
 * Publishes VALORANT game data (weapon skins and their editions) as a static file next to the web app, from
 * the community valorant-api.com (unofficial, no key). Like the exchange rates, the browser only ever reads it
 * from Valosight's own site; images go through the /media/ rewrite (vercel.json, vite.config.ts), so no visitor
 * ever contacts a third party or reveals which skins they own.
 *
 *   public/game/catalog.json   every skin (name, weapon, edition, collection, picture, levels, variants), the
 *                              collections' names, every act's start date, the store bundles and a player card
 *                              per battle pass (its picture)
 *   public/game/passes.json    every battle pass's rewards, level by level (loaded only when a pass is opened)
 *   public/game/accessories.json  sprays, gun buddies, player cards and flex by name (for Kingdom Credits buys;
 *                              loaded only when there are some)
 *
 * Runs before every build and on demand (`npm run game`).
 * Usage: node scripts/fetch-game.mjs [--optional]   (--optional: never fail the build; keep any existing files)
 *
 * Weapons, editions, seasons and the game version are required; the rest (passes, bundles, accessories…) are
 * best effort, so one small endpoint failing never costs the skins. The files are written together or not at all.
 * Nothing in them changes unless the game data does, so the daily redeploy doesn't change the app's offline copy.
 */
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "game", "catalog.json");
const OUT_PASSES = join(dirname(OUT), "passes.json");
const OUT_ACCESSORIES = join(dirname(OUT), "accessories.json");
const API = "https://valorant-api.com/v1";
const MEDIA = "https://media.valorant-api.com/";
const optional = process.argv.includes("--optional");

async function get(path) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(`${API}/${path}`, { headers: { Accept: "application/json", "User-Agent": "Valosight game-data build" }, signal: AbortSignal.timeout(60_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()).data;
    } catch (e) {
      if (attempt >= 3) throw new Error(`${path}: ${e.message}`);
      await new Promise((ok) => setTimeout(ok, 1500 * attempt));
    }
  }
}

/** "Reaver Odin Level 4\r\n(Variant 1 Red)" → "Variant 1 Red"; the base chroma → "". */
const variant = (n) => (/\(([^)]*)\)\s*$/.exec(String(n ?? "").replace(/\s+/g, " "))?.[1] ?? "");
const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
/** ("EPISODE 9", "ACT III") → "E9A3"; ("V26", "ACT IV") → "S2026A4"; anything else (beta) → null. */
function actKey(parent, act) {
  const a = /ACT\s+([IVX]+|\d+)/i.exec(String(act ?? ""))?.[1]?.toUpperCase();
  const n = a ? (ROMAN[a] ?? Number(a)) : 0;
  if (!n) return null;
  const ep = /EPISODE\s+(\d+)/i.exec(String(parent ?? ""))?.[1];
  if (ep) return `E${ep}A${n}`;
  // Yearly seasons: "V26" today; "V2027" or "SEASON 2027" just in case Riot renames them.
  const yr = /^(?:V|SEASON\s*)(\d{2}|\d{4})$/i.exec(String(parent ?? "").trim())?.[1];
  return yr ? `S${yr.length === 2 ? `20${yr}` : yr}A${n}` : null;
}

/** A media URL as a path on our own site ("/media/…"), or null. Anything not on the media host is dropped. */
const media = (u) => (typeof u === "string" && u.startsWith(MEDIA) ? `/media/${u.slice(MEDIA.length)}` : null);

async function main() {
  const [weapons, tiers, version, seasons] = await Promise.all(["weapons", "contenttiers", "version", "seasons"].map(get));
  if (!Array.isArray(weapons) || weapons.length < 10 || !Array.isArray(tiers) || !Array.isArray(seasons)) throw new Error("unexpected answer from valorant-api.com");
  const extra = ["themes", "bundles", "contracts", "sprays", "playercards", "buddies", "playertitles", "currencies", "flex"];
  const got = await Promise.allSettled(extra.map(get));
  const missing = extra.filter((_, i) => got[i].status === "rejected");
  if (missing.length) console.warn(`game data: couldn't fetch ${missing.join(", ")}; continuing without them`);
  const [themes, bundles, contracts, sprays, cards, buddies, titles, currencies, flex] = got.map((r) => (r.status === "fulfilled" && Array.isArray(r.value) ? r.value : []));
  const byUuid = new Map(seasons.map((x) => [x.uuid, x]));
  const out = {
    version: version?.version ?? null,
    // Editions (content tiers); skins point at them by index.
    tiers: tiers.map((t) => ({ name: t.devName, rank: t.rank, color: t.highlightColor ? `#${String(t.highlightColor).slice(0, 6)}` : null, icon: media(t.displayIcon) })),
    // Compact: image paths are rebuilt from ids in the app (lib/skins.ts), and level names from the skin's name.
    //   [name, weapon, tier index (-1: none), theme, icon skin id | null, level kinds[], chromas [variant label, id, flags]]
    //   chroma flags: 1 = has a full render, 2 = has a swatch
    skins: weapons.flatMap((w) =>
      w.skins
        .filter((s) => !/^(Random Favorite|Standard )/i.test(s.displayName))
        .map((s) => [
          s.displayName,
          w.displayName,
          tiers.findIndex((t) => t.uuid === s.contentTierUuid),
          s.themeUuid ?? null,
          s.displayIcon ? s.uuid : null,
          (s.levels ?? []).map((l) => (l.levelItem ? String(l.levelItem).split("::").pop() : "")),
          (s.chromas ?? []).map((c) => [variant(c.displayName), c.uuid, (c.fullRender ? 1 : 0) | (c.swatch ? 2 : 0)]),
        ]),
    ),
  };
  // Collection (theme) names, for "Evori Dreamwings collection".
  out.themes = Object.fromEntries(themes.map((t) => [t.uuid, t.displayName]));
  // Every act's start, keyed like the app's act calendar: "E9A3" (episodes) or "S2026A4" (yearly seasons).
  const actSeasons = seasons.filter((x) => /Act$/.test(String(x.type)) && x.parentUuid && x.startTime);
  for (const x of actSeasons)
    if (!actKey(byUuid.get(x.parentUuid)?.displayName, x.displayName) && !/beta/i.test(byUuid.get(x.parentUuid)?.displayName ?? ""))
      console.warn(`::warning::game data: act "${byUuid.get(x.parentUuid)?.displayName} ${x.displayName}" has a name this script doesn't understand; update actKey()`);
  out.acts = actSeasons
    .map((x) => [actKey(byUuid.get(x.parentUuid)?.displayName, x.displayName), x.startTime.slice(0, 10)])
    .filter(([k]) => k)
    .sort((a, b) => a[1].localeCompare(b[1]));
  // Currencies: [name, id]; the icon is /media/currencies/<id>/displayicon.png (Kingdom Credits, agent tokens…).
  out.currencies = currencies.filter((c) => c.displayIcon).map((c) => [c.displayName, c.uuid]);
  // Store bundles: [name, id]; the art is rebuilt as /media/bundles/<id>/displayicon.png.
  out.bundles = bundles.filter((b) => b.displayIcon).map((b) => [b.displayName, b.uuid]);
  const passes = battlePasses({ contracts, seasons: byUuid, weapons, sprays, cards, buddies, titles, currencies });
  // A picture for each pass (valorant-api has no pass art): the last player card on its paid track, shown
  // as the card's wide banner (/media/playercards/<id>/wideart.png). Small, so it's in the main file.
  const wide = new Set(cards.filter((c) => c.wideArt).map((c) => c.uuid));
  out.passCards = Object.entries(passes)
    .map(([key, [, chapters]]) => [key, chapters.filter((c) => !c[0]).flatMap((c) => c[1]).filter((r) => r[0] === "c" && wide.has(r[2])).at(-1)?.[2]])
    .filter(([, id]) => id);
  if (out.skins.length < 500) throw new Error(`only ${out.skins.length} skins; refusing to publish`);
  // Accessories by name, as Riot writes them in purchases ("Revive Me, Jett! Spray"): [name, id(, 1 = spray has a
  // transparent icon)]. The app rebuilds the picture path per kind (lib/accessories.ts).
  const accessories = {
    s: sprays.filter((x) => x.fullTransparentIcon || x.displayIcon).map((x) => [x.displayName, x.uuid, x.fullTransparentIcon ? 1 : 0]),
    b: buddies.filter((x) => x.levels?.[0]?.displayIcon).map((x) => [x.displayName, x.levels[0].uuid]),
    c: cards.filter((x) => x.largeArt).map((x) => [x.displayName, x.uuid]),
    f: flex.filter((x) => x.displayIcon).map((x) => [x.displayName, x.uuid]),
  };
  // All three or none: write next to them, then swap in.
  mkdirSync(dirname(OUT), { recursive: true });
  const files = [[OUT, out], [OUT_PASSES, passes], [OUT_ACCESSORIES, accessories]];
  for (const [f, data] of files) writeFileSync(`${f}.tmp`, JSON.stringify(data));
  for (const [f] of files) renameSync(`${f}.tmp`, f);
  console.log(`game data: ${out.skins.length} skins, ${out.tiers.length} editions, ${out.acts.length} acts, ${out.bundles.length} bundles, ${Object.keys(passes).length} battle passes (game ${out.version ?? "?"})`);
}

/**
 * Every act's battle pass, keyed like the acts ("E7A1", "S2026A5"): { key: [contract name, chapters] }.
 *   chapter: [1 if epilogue else 0, premium-track rewards (one per level, in order), free rewards]
 *   reward:  [kind, name, image id | null]; the app rebuilds the picture from kind + id (lib/passes.ts):
 *     s skin (base variant's full render)   S skin (level icon)   b gun buddy   c player card   p spray
 *     P spray (plain icon)   r Radianite   t title (text only)   x anything else (no picture)
 */
function battlePasses({ contracts, seasons, weapons, sprays, cards, buddies, titles, currencies }) {
  const skinLevel = new Map();
  for (const w of weapons)
    for (const s of w.skins) {
      const render = s.chromas?.[0]?.fullRender ? s.chromas[0].uuid : null;
      for (const l of s.levels ?? []) skinLevel.set(l.uuid, [s.displayName, render, l.displayIcon ? l.uuid : null]);
    }
  const buddy = new Map(buddies.flatMap((b) => (b.levels ?? []).map((l) => [l.uuid, b.displayName])));
  const by = (list) => new Map(list.map((x) => [x.uuid, x]));
  const spray = by(sprays), card = by(cards), title = by(titles), currency = by(currencies);
  const reward = ({ type, uuid }) => {
    if (type === "EquippableSkinLevel" && skinLevel.has(uuid)) {
      const [name, render, icon] = skinLevel.get(uuid);
      return render ? ["s", name, render] : ["S", name, icon];
    }
    if (type === "EquippableCharmLevel" && buddy.has(uuid)) return ["b", buddy.get(uuid), uuid];
    if (type === "PlayerCard" && card.has(uuid)) return ["c", card.get(uuid).displayName, card.get(uuid).largeArt ? uuid : null];
    if (type === "Spray" && spray.has(uuid)) {
      const x = spray.get(uuid);
      return x.fullTransparentIcon ? ["p", x.displayName, uuid] : ["P", x.displayName, x.displayIcon ? uuid : null];
    }
    if (type === "Title" && title.has(uuid)) return ["t", title.get(uuid).titleText || title.get(uuid).displayName, null];
    if (type === "Currency" && currency.has(uuid)) return ["r", currency.get(uuid).displayName, uuid];
    return ["x", String(type).replace(/([a-z])([A-Z])/g, "$1 $2"), null];
  };
  const out = {};
  for (const c of contracts) {
    if (c.content?.relationType !== "Season") continue;
    const act = seasons.get(c.content.relationUuid);
    const key = act && actKey(seasons.get(act.parentUuid)?.displayName, act.displayName);
    if (!key) continue;
    out[key] = [
      c.displayName,
      (c.content.chapters ?? []).map((ch) => [ch.isEpilogue ? 1 : 0, (ch.levels ?? []).map((l) => reward(l.reward)), (ch.freeRewards ?? []).map(reward)]),
    ];
  }
  return out;
}

main().catch((e) => {
  if (optional && [OUT, OUT_PASSES, OUT_ACCESSORIES].every(existsSync)) {
    console.warn(`game data: offline, keeping the existing files (${e.message})`);
    return;
  }
  if (optional) {
    // On Vercel (a fresh checkout) this means a deploy without pictures and editions: say so loudly.
    console.warn(`::warning::game data: skipped (${e.message}); item pictures, editions and passes fall back to estimates`);
    return;
  }
  console.error(`game data: ${e.message}`);
  process.exit(1);
});
