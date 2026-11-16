/**
 * Exchange rates, downloaded only when the user turns on automatic rates.
 *
 * Past rates (one per business day) and today's rate are the European Central Bank's reference rates;
 * currencies the ECB doesn't cover get today's rate from open.er-api.com.
 *
 * The web app reads them from static files published on Valosight's own site (`/rates/…`, built by
 * scripts/fetch-rates.mjs), so it never contacts a third party and every visitor downloads the same
 * files: the request says nothing about anyone. `download` (the live APIs) is no longer used by the
 * app; only its tests still call it. Everything is cached in the vault, so a sync downloads only what is missing.
 */
import { done, prefix, req, type FxDailyRow, type FxLatestRow } from "./db";

const FRANKFURTER = "https://api.frankfurter.dev/v1";
const OPEN_ER = "https://open.er-api.com/v6/latest";
/** Currencies the ECB publishes. Others only get today's rate, from open.er-api. */
export const ECB = new Set(["AUD", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP", "HKD", "HUF", "IDR", "ILS", "INR", "ISK", "JPY", "KRW", "MXN", "MYR", "NOK", "NZD", "PHP", "PLN", "RON", "SEK", "SGD", "THB", "TRY", "USD", "ZAR"]);
const STALE_MS = 12 * 3600_000;

export class FxError extends Error {}

export type Getter = (url: string) => Promise<any>;

export const httpGet: Getter = async (url) => {
  const host = url.split("/")[2];
  let r: Response;
  try {
    r = await fetch(url, { headers: { Accept: "application/json" }, credentials: "omit", referrerPolicy: "no-referrer" });
  } catch (e) {
    throw new FxError(`Couldn't reach ${host}: ${(e as Error).message}`);
  }
  if (!r.ok) throw new FxError(`Couldn't reach ${host}: ${r.status}`);
  try {
    return await r.json();
  } catch {
    throw new FxError(`Couldn't reach ${host}: bad response`);
  }
};

export const cleanCodes = (codes: unknown): string[] =>
  [...new Set((Array.isArray(codes) ? codes : []).map((c) => String(c).toUpperCase()).filter((c) => /^[A-Z]{3}$/.test(c)))].sort();

const today = () => new Date().toISOString().slice(0, 10);
export const shift = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export interface Plan {
  daily: [string, string[], string][];
  latest: [string, string][];
}

/** What a sync needs to download, from what is already cached (read-only). */
export async function plan(db: IDBDatabase, bases: string[], quotes: string[], start: string, force = false): Promise<Plan> {
  const tx = db.transaction(["fx_daily", "fx_latest"]);
  const daily: Plan["daily"] = [];
  const latest: Plan["latest"] = [];
  const now = Date.now();
  for (const b of bases) {
    const qs = quotes.filter((q) => q !== b);
    // Coverage is checked per currency: a newly added one has no history even if others do.
    const need = new Map<string, string[]>();
    for (const q of qs.filter((q) => ECB.has(b) && ECB.has(q))) {
      const keys = (await req(tx.objectStore("fx_daily").getAllKeys(prefix(b, q)))) as [string, string, string][];
      const a = keys[0]?.[2], z = keys[keys.length - 1]?.[2];
      const add = (from: string) => need.set(from, [...(need.get(from) ?? []), q]);
      if (force || a === undefined || a > shift(start, 4)) add(start);
      else if (z < shift(today(), -4)) add(shift(z, 1));
    }
    for (const [from, q] of [...need].sort(([x], [y]) => (x < y ? -1 : 1))) daily.push([b, q.sort(), from]);
    for (const q of qs) {
      const row = (await req(tx.objectStore("fx_latest").get([b, q]))) as FxLatestRow | undefined;
      const fresh = row?.fetched_at && now - Date.parse(row.fetched_at) < STALE_MS;
      if (force || !fresh) latest.push([b, q]);
    }
  }
  return { daily, latest };
}

/** Fetch what `plan` asked for. Network only; failures are reported, not thrown. */
export async function download(todo: Plan, get: Getter = httpGet) {
  const t = today();
  const rows: FxDailyRow[] = [];
  const latest: FxLatestRow[] = [];
  const errors: string[] = [];
  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
  for (const [b, qs, from] of todo.daily) {
    if (from > t) continue;
    try {
      const d = await get(`${FRANKFURTER}/${from}..${t}?base=${b}&symbols=${qs.join(",")}`);
      for (const [day, rs] of Object.entries((d?.rates ?? {}) as Record<string, Record<string, number>>))
        for (const [q, v] of Object.entries(rs)) rows.push({ base: b, quote: q, day, rate: Number(v) });
    } catch (e) {
      errors.push(msg(e));
    }
  }
  const byBase = new Map<string, string[]>();
  for (const [b, q] of todo.latest) byBase.set(b, [...(byBase.get(b) ?? []), q]);
  const fetched = new Date().toISOString();
  for (const [b, qs] of byBase) {
    const ecb = qs.filter((q) => ECB.has(b) && ECB.has(q));
    const rest = qs.filter((q) => !ecb.includes(q));
    if (ecb.length) {
      try {
        const d = await get(`${FRANKFURTER}/latest?base=${b}&symbols=${ecb.join(",")}`);
        for (const [q, v] of Object.entries((d?.rates ?? {}) as Record<string, number>))
          latest.push({ base: b, quote: q, rate: Number(v), as_of: d?.date ?? null, source: "ECB via frankfurter.dev", fetched_at: fetched });
      } catch (e) {
        errors.push(msg(e));
        rest.push(...ecb);
      }
    }
    if (rest.length) {
      try {
        const d = await get(`${OPEN_ER}/${b}`);
        if (d?.result !== "success") throw new FxError(`open.er-api.com has no rates for ${b}`);
        const asOf = new Date(Number(d.time_last_update_unix ?? 0) * 1000).toISOString().slice(0, 10);
        for (const q of rest)
          if (q in (d.rates ?? {})) latest.push({ base: b, quote: q, rate: Number(d.rates[q]), as_of: asOf, source: "open.er-api.com", fetched_at: fetched });
      } catch (e) {
        errors.push(msg(e));
      }
    }
  }
  return { rows: rows.filter((r) => Number.isFinite(r.rate)), latest: latest.filter((r) => Number.isFinite(r.rate)), errors };
}

export type JsonGet = (path: string) => Promise<any>;

/** Same-origin JSON fetch for the published rate files. */
export const siteGet: JsonGet = async (path) => {
  let r: Response;
  try {
    r = await fetch(path, { credentials: "omit", cache: "no-cache" });
  } catch {
    throw new FxError("Couldn't load exchange rates: you seem to be offline. Saved and manual rates still work.");
  }
  if (!r.ok) throw new FxError(`Couldn't load exchange rates (${r.status}).`);
  return r.json();
};

const sig = (x: number) => Number(x.toPrecision(8));

/** Like `download`, but from the rate files published with the app. All rates are EUR- or USD-based; others are cross rates. */
export async function downloadStatic(todo: Plan, get: JsonGet = siteGet) {
  const t = today();
  const rows: FxDailyRow[] = [];
  const latest: FxLatestRow[] = [];
  const errors = new Set<string>();
  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const years = new Map<number, Promise<{ rates?: Record<string, Record<string, number>> } | null>>();
  const year = (y: number) => {
    if (!years.has(y))
      years.set(
        y,
        get(`/rates/ecb/${y}.json`).catch((e) => {
          errors.add(msg(e));
          return null;
        }),
      );
    return years.get(y)!;
  };
  for (const [b, qs, from] of todo.daily) {
    if (from > t) continue;
    for (let y = Number(from.slice(0, 4)); y <= Number(t.slice(0, 4)); y++) {
      const d = await year(y);
      for (const [day, rs] of Object.entries(d?.rates ?? {})) {
        if (day < from || day > t) continue;
        const eb = b === "EUR" ? 1 : rs[b];
        for (const q of qs) {
          const eq = q === "EUR" ? 1 : rs[q];
          if (eb > 0 && eq > 0) rows.push({ base: b, quote: q, day, rate: sig(eq / eb) });
        }
      }
    }
  }
  if (todo.latest.length) {
    try {
      const idx = await get("/rates/latest.json");
      const fetched = new Date().toISOString();
      const pick = (table: { rates?: Record<string, number> } | undefined, home: string, c: string) => (c === home ? 1 : table?.rates?.[c]);
      for (const [b, q] of todo.latest) {
        const ecb = ECB.has(b) && ECB.has(q);
        const table = ecb ? idx?.ecb : idx?.other;
        const home = ecb ? "EUR" : "USD";
        const rb = pick(table, home, b), rq = pick(table, home, q);
        if (rb && rq && rb > 0 && rq > 0)
          latest.push({ base: b, quote: q, rate: sig(rq / rb), as_of: table.date ?? null, source: ecb ? "ECB via frankfurter.dev" : "open.er-api.com", fetched_at: fetched });
        else errors.add(`No published rate for ${b} → ${q}.`);
      }
    } catch (e) {
      errors.add(msg(e));
    }
  }
  return { rows, latest, errors: [...errors] };
}

export async function store(db: IDBDatabase, rows: FxDailyRow[], latest: FxLatestRow[]) {
  const tx = db.transaction(["fx_daily", "fx_latest"], "readwrite");
  for (const r of rows) tx.objectStore("fx_daily").put(r);
  for (const r of latest) tx.objectStore("fx_latest").put(r);
  await done(tx);
}

/** Cached rates: daily[base][quote] = [[day, rate], …] (oldest first) and latest[base][quote]. */
export async function rates(db: IDBDatabase, bases: string[], quotes: string[]) {
  const tx = db.transaction(["fx_daily", "fx_latest"]);
  const out: { daily: Record<string, Record<string, [string, number][]>>; latest: Record<string, Record<string, Omit<FxLatestRow, "base" | "quote">>> } = { daily: {}, latest: {} };
  for (const b of bases)
    for (const q of quotes) {
      if (q === b) continue;
      const days = (await req(tx.objectStore("fx_daily").getAll(prefix(b, q)))) as FxDailyRow[];
      if (days.length) (out.daily[b] ??= {})[q] = days.map((r) => [r.day, r.rate]);
      const r = (await req(tx.objectStore("fx_latest").get([b, q]))) as FxLatestRow | undefined;
      if (r) (out.latest[b] ??= {})[q] = { rate: r.rate, as_of: r.as_of, source: r.source, fetched_at: r.fetched_at };
    }
  return out;
}

/** Plan, download (no transaction held while waiting on the network), then store. The web app uses the published files. */
export async function sync(
  db: IDBDatabase,
  body: { bases?: unknown; quotes?: unknown; start?: unknown; force?: unknown },
  fetchRates: (todo: Plan) => ReturnType<typeof download> = (todo) => downloadStatic(todo),
) {
  const bases = cleanCodes(body.bases), quotes = cleanCodes(body.quotes);
  let start = String(body.start ?? "2020-01-01").slice(0, 10);
  if (!bases.length || !quotes.length || !/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new FxError('Expected {"bases": ["PHP"], "quotes": ["INR"], "start": "YYYY-MM-DD"}');
  if (start < "1999-01-04") start = "1999-01-04"; // first ECB reference rate
  const todo = await plan(db, bases, quotes, start, !!body.force);
  const { rows, latest, errors } = await fetchRates(todo);
  await store(db, rows, latest);
  return { days: rows.length, latest: latest.length, errors, skipped: !(todo.daily.length || todo.latest.length) };
}
