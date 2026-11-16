/**
 * How each kind of Riot export file is stored and de-duplicated.
 *
 * Every file becomes a *dataset* named "<folder>/<file stem without _uc>", e.g.
 * "valorant/valorant_match_history". Known datasets get an explicit rule; any other file still
 * imports using safe defaults, so new games or new file types Riot adds later are never lost.
 *
 * Modes
 *   keyed     records have a natural ID; a newer export may update a record
 *   multiset  no ID; identical records are counted, so an event repeated inside one export is kept
 *             as many times as it appears there, while re-importing the same events never doubles
 *             them. When `key` is set it names the fields that identify an event, so a field Riot
 *             adds later updates the stored event instead of duplicating it
 *   snapshot  a single object (profile, report counts); one copy per change
 */

export type Mode = "keyed" | "multiset" | "snapshot";

export interface Spec {
  mode: Mode;
  key: string[];
  time: string | null;
  label: string | null;
}

const spec = (mode: Mode, key: string[] = [], time: string | null = null, label: string | null = null): Spec => ({ mode, key, time, label });

export const SPECS: Record<string, Spec> = {
  "riotaccount/account_info": spec("snapshot", [], null, "Account profile"),
  "riotaccount/atlas_login_event": spec("multiset", ["event_time_utc", "event_type", "ip_address", "product"], "event_time_utc", "Login events"),
  "riotaccount/account_audit_events_v1": spec("multiset", [], null, "Account audit events (v1)"),
  "riotaccount/account_audit_events_v2": spec("multiset", ["event_date", "event_type", "description"], "event_date", "Account security events"),
  "penalties/penalty_history": spec("keyed", ["date_issued", "restriction_type", "restriction_reason", "scope"], "date_issued", "Penalties"),
  "valorant/valorant_payment_event": spec("keyed", ["player_facing_purchase_id"], "payment_time_utc", "VALORANT payments"),
  "valorant/valorant_purchase_event": spec("keyed", ["transaction_id"], "purchase_date", "VALORANT store transactions"),
  "valorant/valorant_match_history": spec("keyed", ["game_id"], "game_start_time_utc", "VALORANT matches"),
  "valorant/valorant_audio_transcripts": spec("keyed", ["game_id", "transcript_created"], "transcript_created", "VALORANT voice transcripts"),
  "valorant/valorant_grouped_reports": spec("snapshot", [], null, "VALORANT reports"),
  "leagueoflegends/grouped_reports": spec("snapshot", [], null, "League of Legends reports"),
  "teamfighttactics/tft_grouped_reports": spec("snapshot", [], null, "TFT reports"),
  "leagueoflegends/clash": spec("snapshot", [], null, "League Clash profile"),
  "leagueoflegends/summoner": spec("snapshot", [], null, "League summoner"),
  "wildrift/wildrift_currency": spec("snapshot", [], null, "Wild Rift currency"),
  "wildrift/wildrift_inventory": spec("snapshot", [], null, "Wild Rift inventory"),
  "zendesk/zendesk_tickets": spec("snapshot", [], null, "Support tickets"),
};

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function datasetId(path: string): string | null {
  const p = path.toLowerCase();
  if (!p.endsWith(".json")) return null;
  const parts = p.slice(0, -5).split("/");
  let stem = parts[parts.length - 1];
  if (stem.endsWith("_uc")) stem = stem.slice(0, -3);
  const folder = parts.length > 1 ? parts[parts.length - 2] : "other";
  return `${folder}/${stem}`;
}

/** Known spec, coerced to the payload's actual shape (list -> multiset, anything else -> snapshot). */
export function specFor(ds: string, payload: unknown): Spec {
  const s = SPECS[ds];
  if (!Array.isArray(payload)) return spec("snapshot", [], null, s?.label ?? null);
  if (!s) return spec("multiset");
  return s.mode === "snapshot" ? spec("multiset", [], null, s.label) : s;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;
const NUM = /^\d+(\.\d+)?$/;
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function iso(ms: number): string | null {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  if (!Number.isFinite(ms) || y < 1 || y > 9999) return null;
  return `${pad(y, 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}Z`;
}

/** An ISO-8601 UTC string (millisecond precision), or null. */
export function parseTime(v: unknown): string | null {
  if (v == null || typeof v === "boolean") return null;
  if (typeof v === "number" || (typeof v === "string" && NUM.test(v.trim()))) {
    let n = Number(v);
    if (n > 1e17) n /= 1e9;
    else if (n > 1e14) n /= 1e6;
    else if (n > 1e11) n /= 1e3;
    if (!(n > 3e8 && n < 5e9)) return null;
    const us = Math.round(n * 1e6); // like Python: round to microseconds, then floor to milliseconds
    return iso(Math.floor(us / 1000));
  }
  if (typeof v !== "string") return null;
  const m = ISO.exec(v.trim());
  if (!m) return null;
  const [, y, mo, da, h, mi, s, frac, tz] = m;
  const Y = +y, M = +mo, D = +da, H = +(h ?? 0), MI = +(mi ?? 0), S = +(s ?? 0);
  const ms = +(frac ?? "0").slice(0, 3).padEnd(3, "0");
  if (Y < 1 || M < 1 || M > 12 || H > 23 || MI > 59 || S > 59) return null;
  const dt = new Date(0);
  dt.setUTCFullYear(Y, M - 1, D);
  dt.setUTCHours(H, MI, S, ms);
  if (dt.getUTCDate() !== D || dt.getUTCMonth() !== M - 1) return null; // e.g. 31 February
  let t = dt.getTime();
  if (tz && tz.toUpperCase() !== "Z") {
    const sign = tz[0] === "+" ? 1 : -1;
    const hh = +tz.slice(1, 3);
    const mm = tz.length > 3 ? +tz.slice(-2) : 0;
    t -= sign * (hh * 60 + mm) * 60_000;
  }
  return iso(t);
}

const TIME_HINT = /(time|date|created|timestamp)/i;
const NOT_TIME = /(seconds|_secs?$|_ms$|millis|duration|length|elapsed|played|start$)/i;

/**
 * Pick the field that dates each record in an unknown dataset.
 * Durations and offsets ("playtime_seconds", "time_start" inside a match) are numbers that would
 * parse as plausible dates, so they are never chosen.
 */
export function guessTimeField(records: unknown[]): string | null {
  const sample = records.slice(0, 50).filter(isObj);
  const keys = [...new Set(sample.flatMap((r) => Object.keys(r)))];
  for (const k of keys) {
    if (!TIME_HINT.test(k) || NOT_TIME.test(k)) continue;
    const vals = sample.map((r) => r[k]).filter((v) => v != null);
    if (vals.length && vals.every((v) => parseTime(v))) return k;
  }
  return null;
}

/** JSON with sorted keys and no spaces: the same text for the same data, whatever the key order. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : canonical(x))).join(",")}]`;
  if (isObj(v)) {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

export async function sha256(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  return hex(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

export const rhash = async (v: unknown) => (await sha256(canonical(v))).slice(0, 32);

/**
 * [key, occurrence] per record, used as the de-duplication identity.
 * keyed: the key fields; a key that is missing entirely, or repeated within one export, falls back
 * to "<key>#<content hash>" (see `splitDupKey`).
 * multiset: a hash of the `key` fields when given, else of the whole record.
 */
export async function recordKeys(s: Spec, records: unknown[]): Promise<[string, number][]> {
  const out: [string, number][] = [];
  const seen = new Map<string, number>();
  const next = (k: string) => {
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    out.push([k, n]);
  };
  if (s.mode === "keyed" && s.key.length && records.every(isObj)) {
    const recs = records as Record<string, unknown>[];
    const base = recs.map((r) => canonical(s.key.map((k) => r[k] ?? null)));
    const counts = new Map<string, number>();
    for (const b of base) counts.set(b, (counts.get(b) ?? 0) + 1);
    for (let i = 0; i < recs.length; i++) {
      const unique = counts.get(base[i]) === 1 && s.key.some((f) => recs[i][f] != null);
      next(unique ? base[i] : `${base[i]}#${await rhash(recs[i])}`);
    }
    return out;
  }
  for (let r of records) {
    if (s.key.length && isObj(r)) {
      const src = r;
      r = Object.fromEntries(s.key.filter((f) => f in src).map((f) => [f, src[f]]));
    }
    next(await rhash(r));
  }
  return out;
}

/** For a "<key>#<content hash>" identity, the bare key it was split from. */
export function splitDupKey(rkey: string): string | null {
  const i = rkey.lastIndexOf("#");
  if (i < 0) return null;
  const base = rkey.slice(0, i);
  return rkey.length - i - 1 === 32 && base.startsWith("[") ? base : null;
}
