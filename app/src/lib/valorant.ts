import type { Rec } from "./api";

export const DS = {
  info: "riotaccount/account_info",
  logins: "riotaccount/atlas_login_event",
  audit: "riotaccount/account_audit_events_v2",
  penalties: "penalties/penalty_history",
  payments: "valorant/valorant_payment_event",
  store: "valorant/valorant_purchase_event",
  matches: "valorant/valorant_match_history",
  transcripts: "valorant/valorant_audio_transcripts",
  vReports: "valorant/valorant_grouped_reports",
  lolReports: "leagueoflegends/grouped_reports",
  tftReports: "teamfighttactics/tft_grouped_reports",
  clash: "leagueoflegends/clash",
} as const;

const QUEUE: Record<string, string> = {
  Ranked: "Competitive",
  Competitive: "Competitive",
  Unrated: "Unrated",
  Swiftplay: "Swiftplay",
  Deathmatch: "Deathmatch",
  Hurm: "Team Deathmatch",
  "Spike Rush": "Spike Rush",
  Ggteam: "Escalation",
  Onefa: "Replication",
  Snowball: "Snowball Fight",
  Skirmish2V2: "Skirmish 2v2",
  Skirmishascension2V2: "Skirmish Ascension",
  Abilitydraftarena: "Ability Draft",
  Newmap: "New Map",
  "Not Applicable": "Range / Custom",
  Unknown: "Other",
};
export const queueName = (m: Rec) => {
  if (m.game_mode === "ShootingRange") return "Shooting Range";
  if (m.game_mode === "Custom Game") return "Custom Game";
  if (m.game_mode === "New Player Experience") return "Tutorial";
  return QUEUE[m.game_type] ?? m.game_type ?? "Other";
};
export const isRealMatch = (m: Rec) => m.game_mode !== "ShootingRange" && m.game_mode !== "New Player Experience";

export function matchMinutes(m: Rec): number | null {
  if (!m.game_start_time_utc || !m.game_end_time_utc) return null;
  const a = Date.parse(m.game_start_time_utc.replace(" ", "T") + "Z");
  const b = Date.parse(m.game_end_time_utc.replace(" ", "T") + "Z");
  const d = (b - a) / 60000;
  return Number.isFinite(d) && d >= 0 && d < 300 ? d : null;
}

const PAY: Record<string, string> = {
  adyen: "Adyen (method not specified)",
  "adyencomponents-card": "Card",
  paypalrest: "PayPal",
  paypal: "PayPal",
  xsolla: "Xsolla",
  codapay: "Codapay",
  paysafecard: "Paysafecard",
  razer: "Razer Gold",
  razergold: "Razer Gold",
  googleplay: "Google Play",
  applepay: "Apple Pay",
  gcash: "GCash",
  upi: "UPI",
  paytm: "Paytm",
};
export const payMethod = (m?: string) => {
  if (!m) return "Unknown";
  const k = m.toLowerCase();
  if (PAY[k]) return PAY[k];
  if (k.includes("card")) return "Card";
  if (k.includes("paypal")) return "PayPal";
  return m.charAt(0).toUpperCase() + m.slice(1);
};

export const amountPaid = (p: Rec) => (Number(p.real_currency_paid_x100) || 0) / 100;

const moneyFmt = new Map<string, Intl.NumberFormat>();
export function money(v: number, cur: string, digits = 0) {
  const k = cur + digits;
  if (!moneyFmt.has(k)) {
    try {
      moneyFmt.set(k, new Intl.NumberFormat("en", { style: "currency", currency: cur, maximumFractionDigits: digits, minimumFractionDigits: digits }));
    } catch {
      moneyFmt.set(k, new Intl.NumberFormat("en", { maximumFractionDigits: digits, minimumFractionDigits: digits }));
    }
  }
  const s = moneyFmt.get(k)!.format(v);
  return /[A-Za-z₹$€£¥₱]/.test(s) ? s : `${s} ${cur}`;
}
export const n0 = (v: number) => Math.round(v).toLocaleString("en");

const WEAPONS = [
  "Classic", "Shorty", "Frenzy", "Ghost", "Sheriff", "Bandit", "Stinger", "Spectre", "Bucky", "Judge",
  "Bulldog", "Guardian", "Phantom", "Vandal", "Marshal", "Outlaw", "Operator", "Ares", "Odin",
];
const MELEE_WORDS = /(knife|karambit|blade|axe|sword|yaiba|dagger|kunai|fan|hammer|bat|katana|melee|baton|claw|scythe|mace|staff|wrench|daggers|cleaver|tanto|bayonet)/i;
/** VALORANT's weapon classes, in buy-menu order (Bandit: sidearm added in 2026). */
export const WEAPON_CLASSES: { name: string; weapons: string[] }[] = [
  { name: "Sidearms", weapons: ["Classic", "Shorty", "Frenzy", "Ghost", "Bandit", "Sheriff"] },
  { name: "SMGs", weapons: ["Stinger", "Spectre"] },
  { name: "Shotguns", weapons: ["Bucky", "Judge"] },
  { name: "Rifles", weapons: ["Bulldog", "Guardian", "Phantom", "Vandal"] },
  { name: "Sniper rifles", weapons: ["Marshal", "Outlaw", "Operator"] },
  { name: "Machine guns", weapons: ["Ares", "Odin"] },
  { name: "Melee", weapons: ["Melee"] },
  { name: "Bundles & other", weapons: ["Bundle", "Accessory"] },
];
export const WEAPON_ORDER = WEAPON_CLASSES.flatMap((c) => c.weapons);
export const weaponClass = (weapon: string) => WEAPON_CLASSES.find((c) => c.weapons.includes(weapon))?.name ?? "Bundles & other";
export const EDITIONS = ["Select", "Deluxe", "Premium", "Exclusive", "Ultra", "Melee"];

export function weaponOf(name: string, cost = 0): string {
  for (const w of WEAPONS) if (new RegExp(`\\b${w.replace("/", "\\/")}\\b`, "i").test(name)) return w;
  if (MELEE_WORDS.test(name) || cost >= 3000) return "Melee";
  return "Accessory";
}

export const isVP = (r: Rec) => /valorant points/i.test(r.spent_currency_name ?? "");
const SRC: Record<string, string> = {
  Rotation: "Daily Store",
  "Bonus Shop": "Night Market",
  "Bundle Individual": "Bundle (single item)",
  Bundle: "Full Bundle",
  Accessory: "Accessory Store",
};

export interface VPItem {
  r: Rec;
  t: string;
  category: "Skin" | "Battle Pass" | "Bundle" | "Unknown";
  name: string;
  weapon: string;
  cost: number;
  where: string;
  pass?: string;
  /** true when the pass name was worked out from the purchase date */
  passEstimated?: boolean;
}

const UNNAMED_PASS = "Battle Pass (name not recorded)";

/** Act key used for matching: "E6A1" (Episodes) or "S2026A3" (yearly seasons, Riot code "V26"). */
function passKey(src: string): string | null {
  let m = /Ep(\d+)\s*Act\s*(\d+)/i.exec(src);
  if (m) return `E${+m[1]}A${+m[2]}`;
  m = /V(\d+)\s*Act\s*(\d+)/i.exec(src);
  if (m) return `S${2000 + +m[1]}A${+m[2]}`;
  return null;
}
const keyLabel = (k: string) => {
  const m = /^E(\d+)A(\d+)$/.exec(k);
  if (m) return `Episode ${m[1]} · Act ${m[2]}`;
  const n = /^S(\d+)A(\d+)$/.exec(k)!;
  return `Season ${n[1]} · Act ${n[2]}`;
};

export function passName(src: string): string {
  const k = passKey(src);
  return k ? keyLabel(k) : UNNAMED_PASS;
}

/**
 * Approximate act start dates (UTC). Episodes 1–9 ran 2020–2024; from 2025 Riot numbers seasons by year
 * ("V25" = Season 2025) with six acts. Later years are projected on the 2025 rhythm (same weekday, 52 weeks on).
 */
const EPISODE_ACTS: [string, string][] = [
  ["E1A1", "2020-06-02"], ["E1A2", "2020-08-04"], ["E1A3", "2020-10-13"],
  ["E2A1", "2021-01-12"], ["E2A2", "2021-03-02"], ["E2A3", "2021-04-27"],
  ["E3A1", "2021-06-22"], ["E3A2", "2021-09-08"], ["E3A3", "2021-11-02"],
  ["E4A1", "2022-01-11"], ["E4A2", "2022-03-01"], ["E4A3", "2022-04-26"],
  ["E5A1", "2022-06-22"], ["E5A2", "2022-08-23"], ["E5A3", "2022-10-18"],
  ["E6A1", "2023-01-10"], ["E6A2", "2023-03-07"], ["E6A3", "2023-04-25"],
  ["E7A1", "2023-06-27"], ["E7A2", "2023-08-29"], ["E7A3", "2023-10-31"],
  ["E8A1", "2024-01-09"], ["E8A2", "2024-03-05"], ["E8A3", "2024-04-30"],
  ["E9A1", "2024-06-25"], ["E9A2", "2024-08-27"], ["E9A3", "2024-10-22"],
];
const SEASON_2025 = ["2025-01-08", "2025-03-04", "2025-04-29", "2025-06-24", "2025-08-19", "2025-10-14"];

function actCalendar(untilYear: number): { key: string; start: number }[] {
  const out = EPISODE_ACTS.map(([key, d]) => ({ key, start: Date.parse(d + "T00:00:00Z") }));
  for (let y = 2025; y <= untilYear; y++)
    SEASON_2025.forEach((d, i) => out.push({ key: `S${y}A${i + 1}`, start: Date.parse(d + "T00:00:00Z") + (y - 2025) * 364 * 864e5 }));
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Name passes Riot didn't label, and 1,000 VP "Unknown" purchases that look like passes, from the purchase date:
 * a pass can only be bought while its act runs, and an act you already own a pass for is skipped.
 */
function inferPasses(all: VPItem[]) {
  const items = all.filter((x) => x.t); // an undated purchase can't be matched to an act
  const owned = new Set(items.map((x) => (x.category === "Battle Pass" ? passKey(String(x.r.transaction_source ?? "")) : null)).filter(Boolean) as string[]);
  const lastYear = Math.max(2025, ...items.map((x) => +x.t.slice(0, 4))) + 1;
  const cal = actCalendar(lastYear);
  const out = new Map<VPItem, string>();
  for (const it of [...items].sort((a, b) => a.t.localeCompare(b.t))) {
    const unnamedPass = it.category === "Battle Pass" && it.pass === UNNAMED_PASS;
    const unknownPass = it.category === "Unknown" && it.cost === 1000;
    if (!unnamedPass && !unknownPass) continue;
    const t = Date.parse(it.t) + 864e5; // a day of slack for timezones/launch-day buys
    let i = cal.findLastIndex((a) => a.start <= t);
    while (i >= 0 && i < cal.length - 1 && owned.has(cal[i].key) && cal[i + 1].start <= t + 30 * 864e5) i++;
    if (i < 0 || owned.has(cal[i].key)) continue;
    owned.add(cal[i].key);
    out.set(it, cal[i].key);
  }
  return out;
}

/**
 * Classify every VALORANT Points purchase and name the battle passes.
 * Pass naming looks at `all` (the full history) so a date filter doesn't change the answer.
 */
export function classifyAllVP(records: Rec[], all: Rec[] = records): VPItem[] {
  const allItems = all.filter(isVP).map(classifyVP);
  const inferred = inferPasses(allItems);
  const byId = new Map<string, VPItem>();
  for (const it of allItems) {
    const k = inferred.get(it);
    if (k) {
      it.category = "Battle Pass";
      it.name = "Battle Pass";
      it.weapon = "";
      it.where = "Battle Pass";
      it.pass = `${keyLabel(k)} (estimated)`;
      it.passEstimated = true;
    }
    if (it.r.transaction_id) byId.set(it.r.transaction_id, it);
  }
  if (records === all) return allItems;
  return records.filter(isVP).map((r) => byId.get(r.transaction_id) ?? classifyVP(r));
}

/** VP purchase groups, as the money and collection pages show and link them (`key` travels in click-throughs). */
export const VP_GROUPS: { category: VPItem["category"]; label: string; key: string }[] = [
  { category: "Skin", label: "Skins", key: "skins" },
  { category: "Battle Pass", label: "Battle passes", key: "passes" },
  { category: "Bundle", label: "Bundles", key: "bundles" },
  { category: "Unknown", label: "Unknown items", key: "unknown" },
];
export const vpGroupOf = (category: string) => VP_GROUPS.find((g) => g.category === category) ?? VP_GROUPS[3];

export function classifyVP(r: Rec): VPItem {
  const src = String(r.transaction_source ?? "").trim();
  const cost = Number(r.spent_currency_amount) || 0;
  const base = { r, t: r._t as string, cost };
  if (/battle pass/i.test(src) || /^BP /.test(r.item_type ?? ""))
    return { ...base, category: "Battle Pass", name: "Battle Pass", weapon: "", where: "Battle Pass", pass: passName(src) };
  if (r.item_type === "Bundle") return { ...base, category: "Bundle", name: r.item_name, weapon: "Bundle", where: SRC[src] ?? "Bundle" };
  if (!r.item_name || r.item_name === "Unknown" || /^CatalogEntry_/.test(r.item_name))
    return { ...base, category: "Unknown", name: cost === 1000 ? "Unknown item (likely Battle Pass)" : "Unknown item", weapon: "", where: SRC[src] ?? "Not recorded" };
  return { ...base, category: "Skin", name: r.item_name, weapon: weaponOf(r.item_name, cost), where: SRC[src] ?? (/^\d+$/.test(src) ? "Not recorded" : src || "Not recorded") };
}

const AUDIT: Record<string, { label: string; level: 0 | 1 | 2 }> = {
  CREATED: { label: "Account created", level: 1 },
  EMAIL: { label: "Email sent by Riot", level: 0 },
  EMAIL_VERIFIED: { label: "Email verified", level: 0 },
  DEVICE_TRUST: { label: "Device marked as trusted", level: 0 },
  DEVICE_TRUST_PURGE_ALL: { label: "Signed out of all devices", level: 1 },
  AUTH_FACTOR_CHANGE: { label: "2-step verification changed", level: 1 },
  USER_FIELD_CHANGED: { label: "Account detail changed", level: 1 },
  PASSWORD_CHANGE: { label: "Password changed", level: 1 },
  PASSWORD_RESET: { label: "Password reset via email", level: 1 },
  ANOMALOUS_ACTIVITY: { label: "Suspicious activity flagged by Riot", level: 2 },
  LINKED_IDENTITY_CREATED: { label: "External login linked", level: 1 },
  IDENTITY_LINK_SUCCESS: { label: "External login linked", level: 1 },
  FEDERATED_IDENTITY_CREATED: { label: "External login created (Google/Apple/etc.)", level: 1 },
};
const FIELD: Record<string, string> = {
  password: "Password",
  alias: "Riot ID",
  emailAddress: "Email address",
  emailStatus: "Email status",
  "mfa preference updated": "2-step verification preference",
  "active verified phone number": "Phone number",
};
/** Account-change categories, for filtering the security timeline. `on` = shown by default. */
export const AUDIT_KINDS = [
  { id: "flagged", label: "Flagged by Riot", on: true },
  { id: "password", label: "Password", on: true },
  { id: "email", label: "Email", on: true },
  { id: "riotid", label: "Riot ID", on: true },
  { id: "phone", label: "Phone", on: true },
  { id: "mfa", label: "2-step verification", on: true },
  { id: "linked", label: "Linked logins", on: true },
  { id: "devices", label: "Devices", on: true },
  { id: "account", label: "Account", on: true },
  { id: "riotmail", label: "Emails from Riot", on: false },
  { id: "other", label: "Other", on: false },
] as const;
export type AuditKind = (typeof AUDIT_KINDS)[number]["id"];

export function auditKind(r: Rec): AuditKind {
  const t = r.event_type ?? "";
  const d = r.event_type === "USER_FIELD_CHANGED" ? String(r.description ?? "") : "";
  if (t === "ANOMALOUS_ACTIVITY") return "flagged";
  if (t === "PASSWORD_CHANGE" || t === "PASSWORD_RESET" || d === "password") return "password";
  if (t === "EMAIL_VERIFIED" || d === "emailAddress" || d === "emailStatus") return "email";
  if (d === "alias") return "riotid";
  if (/phone/i.test(d)) return "phone";
  if (t === "AUTH_FACTOR_CHANGE" || /mfa/i.test(d)) return "mfa";
  if (/IDENTITY/.test(t)) return "linked";
  if (t.startsWith("DEVICE_TRUST")) return "devices";
  if (t === "CREATED" || t === "USER_FIELD_CHANGED") return "account";
  if (t === "EMAIL") return "riotmail";
  return "other";
}

export const isPwEvent = (a: Rec) => a.event_type === "PASSWORD_CHANGE" || a.event_type === "PASSWORD_RESET";
/**
 * Riot logs each password change twice: "user field changed: password" plus PASSWORD_CHANGE or
 * PASSWORD_RESET about a second later. Drops the generic twin so each change shows once.
 */
export function dedupeAudit(records: Rec[]): Rec[] {
  const pwTimes = records.filter(isPwEvent).map((a) => Date.parse(a._t ?? ""));
  return records.filter((a) => !(a.event_type === "USER_FIELD_CHANGED" && a.description === "password" && pwTimes.some((t) => Math.abs(t - Date.parse(a._t ?? "")) < 10_000)));
}

/**
 * Best win streak (`bw`, with its games in `best`) and worst losing streak (`bl`), in time order. Draws and
 * other results don't break a streak, so they're part of the run.
 */
export function winStreaks(games: Rec[]) {
  let bw = 0,
    bl = 0,
    cw = 0,
    cl = 0;
  let run: Rec[] = [],
    best: Rec[] = [];
  for (const g of [...games].sort((a, b) => (a._t ?? "").localeCompare(b._t ?? ""))) {
    if (g.game_outcome === "Win") {
      cw++;
      cl = 0;
      if (cw === 1) run = [];
      run.push(g);
      if (cw > bw) best = [...run];
    } else if (g.game_outcome === "Loss") {
      cl++;
      cw = 0;
    } else if (cw) run.push(g);
    bw = Math.max(bw, cw);
    bl = Math.max(bl, cl);
  }
  return { bw, bl, best: new Set(best) };
}

export function auditInfo(r: Rec) {
  const a = AUDIT[r.event_type] ?? { label: titleCase(r.event_type ?? "Event"), level: 0 as const };
  let label = a.label;
  if (r.event_type === "USER_FIELD_CHANGED" && r.description) label = `${FIELD[r.description] ?? titleCase(r.description)} changed`;
  return { label, level: a.level, detail: r.event_type === "EMAIL" ? r.description ?? "" : r.event_type === "USER_FIELD_CHANGED" ? "" : r.description ?? "" };
}

export const titleCase = (s: string) =>
  String(s)
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

/** A penalty in force right now. Exact match: "INACTIVE" must not count. */
export const isActivePenalty = (status: string | null | undefined) => /^\s*active\s*$/i.test(status ?? "");

export const PENALTY: Record<string, string> = {
  CHAT_RESTRICTION: "Text chat restricted",
  VOICE_RESTRICTION: "Voice chat restricted",
  PBE_LOGIN_RESTRICTION: "Queue / play timeout",
  QUEUE_DELAY: "Queue delay",
  RANKED_RESTRICTION: "Ranked restricted",
  GAME_BAN: "Game ban",
  PERMANENT_BAN: "Permanent ban",
};

/* ---------------- Radianite upgrades ---------------- */

export const isRP = (r: Rec) => /radianite/i.test(r.spent_currency_name ?? "");

export interface Upgrade {
  r: Rec;
  t: string;
  skin: string; // "Unknown skin" when Riot didn't record the name
  level: number | null;
  variant: { n: number; color: string } | null;
  perk: string | null;
  cost: number;
}

const LEVEL_RE = /^(.*?)\s+Level\s+(\d+)\s*$/i;
const VARIANT_RE = /\(\s*Variant\s+(\d+)\s*([^)]*)\)/i;

/**
 * Radianite item names look like
 *   "ChronoVoid Vandal Level 4\n(Variant 3 Black)"   colour variant
 *   "Nocturnum Classic Level 4\r\nKill each player…"   level + perk description
 */
export function parseUpgrade(r: Rec): Upgrade {
  const name = String(r.item_name ?? "").trim();
  const base = { r, t: r._t as string, cost: Number(r.spent_currency_amount) || 0 };
  const lines = name.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const m = lines.length ? LEVEL_RE.exec(lines[0]) : null;
  if (!m) return { ...base, skin: "Unknown skin", level: null, variant: null, perk: null };
  const rest = lines.slice(1);
  const vLine = rest.find((l) => VARIANT_RE.test(l));
  const v = vLine ? VARIANT_RE.exec(vLine) : null;
  const perk = rest.filter((l) => l !== vLine).join(" ") || null;
  return {
    ...base,
    skin: m[1].trim(),
    level: +m[2],
    variant: v ? { n: +v[1], color: (v[2] || `Variant ${v[1]}`).trim() } : null,
    perk,
  };
}

export interface SkinUpgrades {
  skin: string;
  maxLevel: number;
  variants: { n: number; color: string }[];
  perks: string[];
  events: Upgrade[]; // oldest first
  rp: number;
  count: number;
  first: string;
  last: string;
}

export function groupUpgrades(list: Upgrade[]): Map<string, SkinUpgrades> {
  const m = new Map<string, SkinUpgrades>();
  for (const u of list) {
    const e = m.get(u.skin) ?? { skin: u.skin, maxLevel: 0, variants: [], perks: [], events: [], rp: 0, count: 0, first: u.t, last: u.t };
    if (u.level) e.maxLevel = Math.max(e.maxLevel, u.level);
    if (u.perk && !e.perks.includes(u.perk)) e.perks.push(u.perk);
    if (u.variant && !e.variants.some((v) => v.n === u.variant!.n)) e.variants.push(u.variant);
    e.rp += u.cost;
    e.count++;
    e.events.push(u);
    if (u.t < e.first) e.first = u.t;
    if (u.t > e.last) e.last = u.t;
    m.set(u.skin, e);
  }
  for (const e of m.values()) {
    e.variants.sort((a, b) => a.n - b.n);
    e.events.sort((a, b) => (a.t ?? "").localeCompare(b.t ?? ""));
  }
  return m;
}

/* ---------------- Other currencies (Kingdom Credits, tokens, …) ---------------- */

const CURRENCY_UNIT: Record<string, { short: string; one: string; many: string }> = {
  "Kingdom Credits": { short: "KC", one: "Kingdom Credit", many: "Kingdom Credits" },
  "Character Recruitment Token": { short: "token", one: "recruitment token", many: "recruitment tokens" },
  "Free Agent Token": { short: "token", one: "free agent token", many: "free agent tokens" },
};
export const currencyUnit = (name: string) => CURRENCY_UNIT[name] ?? { short: name, one: name, many: name };

const ACCESSORY_KIND: [RegExp, string][] = [
  [/\bspray\b/i, "Spray"],
  [/\b(buddy|charm)\b/i, "Gun buddy"],
  [/\bcard\b/i, "Player card"],
  [/\btitle\b/i, "Player title"],
  [/\bflex\b/i, "Flex"],
];

export interface OtherItem {
  r: Rec;
  t: string;
  name: string;
  note: string | null;
  kind: string;
  cost: number;
  currency: string;
}

/** Turns Riot's internal labels (e.g. "Agentboardstatmodules", "CatalogEntry_…") into plain words. */
export function classifyOther(r: Rec): OtherItem {
  const src = String(r.transaction_source ?? "").trim();
  const raw = String(r.item_name ?? "").trim();
  const nameless = !raw || raw === "Unknown" || /^CatalogEntry_/i.test(raw) || /^Assorted /i.test(raw);
  const base = { r, t: r._t as string, cost: Number(r.spent_currency_amount) || 0, currency: String(r.spent_currency_name ?? "") };
  if (/character level|char bundle/i.test(`${src} ${r.item_type}`))
    return { ...base, kind: "Agent unlock", name: "Agent unlocked", note: nameless ? "Riot didn't record which agent" : raw };
  if (/agentboard|agent ?gear/i.test(src))
    return { ...base, kind: "Agent gear", name: nameless ? "Agent gear item" : raw, note: nameless ? "Riot didn't record the item name" : null };
  if (/accessory/i.test(src) || r.item_type === "Accessory") {
    const k = ACCESSORY_KIND.find(([re]) => re.test(raw))?.[1] ?? "Accessory";
    return { ...base, kind: k, name: nameless ? k : raw, note: nameless ? "Riot didn't record the item name" : null };
  }
  return { ...base, kind: titleCase(src || r.transaction_type || "Other"), name: nameless ? "Unnamed item" : raw, note: nameless ? "Riot didn't record the item name" : null };
}

/** Short human label for one upgrade, e.g. "Level 3" or "Variant 2 · Red". */
export function upgradeLabel(u: Upgrade): string {
  if (u.variant) return `Variant ${u.variant.n} · ${u.variant.color}`;
  if (u.level) return `Level ${u.level}`;
  return "Upgrade (not recorded)";
}

/* ---------------- Store value ---------------- */

/** Riot's regular weapon-skin prices (VP). Night Market prices are a discount on one of these. */
export const STANDARD_PRICES = [875, 1275, 1775, 2175, 2475, 2675, 2975];

/** Approximate edition from the price paid (melee priced separately). */
export function editionOf(cost: number, weapon: string): string {
  if (weapon === "Melee") return "Melee";
  if (cost <= 875) return "Select";
  if (cost <= 1275) return "Deluxe";
  if (cost <= 1775) return "Premium";
  if (cost <= 2175) return "Exclusive";
  return "Ultra";
}

/** Skin collection name, e.g. "Reaver Bandit" → "Reaver". */
export const collectionOf = (name: string, weapon: string) => name.replace(new RegExp(`\\s*\\b${weapon}\\b\\s*`, "i"), " ").trim();

/**
 * Estimated regular price of a Night Market buy.
 * 1) the full price you paid for another skin of the same collection (e.g. Reaver Odin → Reaver Bandit);
 * 2) otherwise the lowest standard price above what was paid.
 */
export function nightMarketBase(item: VPItem, all: VPItem[]): { base: number; how: "collection" | "tier" } {
  const col = collectionOf(item.name, item.weapon).toLowerCase();
  const peer = all.find(
    (x) => x !== item && x.category === "Skin" && x.where !== "Night Market" && x.weapon !== "Melee" && collectionOf(x.name, x.weapon).toLowerCase() === col && STANDARD_PRICES.includes(x.cost) && x.cost > item.cost,
  );
  if (peer) return { base: peer.cost, how: "collection" };
  return { base: STANDARD_PRICES.find((p) => p > item.cost) ?? item.cost, how: "tier" };
}
