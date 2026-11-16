/**
 * What every battle pass offered, level by level, from /game/passes.json (published at build time by
 * scripts/fetch-game.mjs from valorant-api.com). Pictures are served from this site under /media/.
 *
 * Riot's data export says which passes were bought, never how far they were played, so this is the pass's
 * content, not the player's progress. Loaded on first use only (it's only needed once a pass is opened).
 */
import { lazyJson } from "./lazy-json";

export type RewardKind = "skin" | "buddy" | "card" | "spray" | "title" | "radianite" | "other";
export interface Reward {
  kind: RewardKind;
  name: string;
  image: string | null;
  /** the level that unlocks it (1-based, epilogue included), or null for a chapter's free rewards */
  level: number | null;
  free: boolean;
}
export interface PassChapter {
  /** 1-based; the epilogue counts on from the last chapter */
  n: number;
  epilogue: boolean;
  /** first and last level of the chapter */
  from: number;
  to: number;
  rewards: Reward[];
}
export interface BattlePass {
  key: string;
  /** Riot's name for the contract ("EVOLUTION: ACT 1", "Season 2026 // Act V") */
  name: string;
  chapters: PassChapter[];
  levels: number;
}

type RawReward = [string, string, string | null];
type Raw = Record<string, [string, [number, RawReward[], RawReward[]][]]>;

const KIND: Record<string, RewardKind> = { s: "skin", S: "skin", b: "buddy", c: "card", p: "spray", P: "spray", r: "radianite", t: "title", x: "other" };
const IMAGE: Record<string, (id: string) => string> = {
  s: (id) => `/media/weaponskinchromas/${id}/fullrender.png`,
  S: (id) => `/media/weaponskinlevels/${id}/displayicon.png`,
  b: (id) => `/media/buddylevels/${id}/displayicon.png`,
  c: (id) => `/media/playercards/${id}/largeart.png`,
  p: (id) => `/media/sprays/${id}/fulltransparenticon.png`,
  P: (id) => `/media/sprays/${id}/displayicon.png`,
  r: (id) => `/media/currencies/${id}/displayicon.png`,
};
/** "RADIANITE Points" → "Radianite Points"; other names are kept as Riot wrote them. */
const tidy = (kind: string, name: string) => (kind === "r" ? name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : name);

export function buildPasses(raw: Raw): Map<string, BattlePass> {
  const out = new Map<string, BattlePass>();
  for (const [key, [name, chapters]] of Object.entries(raw)) {
    let level = 0;
    const reward = ([k, n, id]: RawReward, lv: number | null): Reward => ({
      kind: KIND[k] ?? "other",
      name: tidy(k, n),
      image: id && IMAGE[k] ? IMAGE[k](id) : null,
      level: lv,
      free: lv === null,
    });
    const chs: PassChapter[] = chapters.map(([epi, levels, free], i) => {
      const from = level + 1;
      const rewards = levels.map((r) => reward(r, ++level));
      return { n: i + 1, epilogue: !!epi, from, to: level, rewards: [...rewards, ...free.map((r) => reward(r, null))] };
    });
    out.set(key, { key, name, chapters: chs, levels: level });
  }
  return out;
}

/** Every battle pass by act key ("E7A1", "S2026A5"), once `enabled`: undefined while loading, null when unavailable. */
export const useBattlePasses = lazyJson<Raw, Map<string, BattlePass>>("/game/passes.json", buildPasses);
