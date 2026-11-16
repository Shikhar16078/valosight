/**
 * The vault: accounts, imports, de-duplicated records and snapshots, stored in this browser
 * Nothing here touches the network.
 */
import { SPECS, canonical, datasetId, guessTimeField, isObj, parseTime, recordKeys, specFor, splitDupKey, type Spec } from "./datasets";
import { STORES, done, openDb, prefix, req, type AccountRow, type DatasetRow, type ImportRow, type RecordRow, type SnapshotRow } from "./db";
import { contentHash, type Export } from "./source";

export class VaultError extends Error {
  constructor(msg: string, public status = 400) {
    super(msg);
  }
}

export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");

const MAX_DEPTH = 900; // files nested deeper than this are skipped (the limit the retired Python engine had)
const utf8 = new TextDecoder("utf-8", { fatal: true }); // also drops a leading BOM, like utf-8-sig

/** JSON.parse that, like Python, reads NaN / Infinity (invalid JSON some tools write) as null. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    const fixed = text.replace(/"(?:[^"\\]|\\.)*"|-?\bInfinity\b|\bNaN\b/g, (m) => (m[0] === '"' ? m : "null"));
    if (fixed === text) throw e;
    return JSON.parse(fixed);
  }
}

function tooDeep(v: unknown): boolean {
  const stack: [unknown, number][] = [[v, 1]];
  while (stack.length) {
    const [x, d] = stack.pop()!;
    if (d > MAX_DEPTH) return true;
    if (Array.isArray(x)) for (const y of x) stack.push([y, d + 1]);
    else if (isObj(x)) for (const y of Object.values(x)) stack.push([y, d + 1]);
  }
  return false;
}

const isEmpty = (v: unknown) => v == null || (Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length);
const asciiLower = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
const cmp = (a: string | null | undefined, b: string | null | undefined) => ((a ?? "") < (b ?? "") ? -1 : (a ?? "") > (b ?? "") ? 1 : 0);
/** SQLite order: NULL before every string. */
const cmpNullFirst = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? -1 : b === null ? 1 : cmp(a, b));

/**
 * The newest event in an export, used to decide which of two exports is newer.
 * Only Riot's known event datasets count, and dates in the future are ignored: an expiry date or a
 * bad value in some other file must not make an export look newer than every later one.
 */
export function exportWatermark(specs: Map<string, Spec>, times: Map<string, (string | null)[]>): string | null {
  const limit = new Date(Date.now() + 86_400_000).toISOString().replace(/\.\d{3}Z$/, ".000Z");
  const known: string[] = [];
  const other: string[] = [];
  for (const [ds, ts] of times)
    for (const t of ts) {
      if (!t || t > limit) continue;
      other.push(t);
      if (ds in SPECS && specs.get(ds)!.time) known.push(t);
    }
  const pick = known.length ? known : other;
  return pick.length ? pick.reduce((a, b) => (b > a ? b : a)) : null;
}

export interface DatasetStat {
  mode: string;
  in_file: number;
  new: number;
  updated: number;
  existing: number;
}

export class Vault {
  constructor(public db: IDBDatabase) {}

  static async open(name?: string, factory?: IDBFactory) {
    return new Vault(await openDb(name, factory));
  }

  private tx(stores: string[], mode: IDBTransactionMode = "readonly") {
    return this.db.transaction(stores, mode);
  }

  async exists(acc: number): Promise<boolean> {
    return (await req(this.tx(["accounts"]).objectStore("accounts").count(acc))) > 0;
  }

  async need(acc: number) {
    if (!Number.isInteger(acc) || !(await this.exists(acc))) throw new VaultError("Account not found", 404);
  }

  // ------------------------------------------------------------------ import
  async importExport(exp: Export) {
    // 1. Parse and fingerprint everything first: a transaction can't wait on anything but the database.
    const parsed = new Map<string, unknown>();
    const skipped: { file: string; reason: string }[] = [];
    for (const [path, raw] of exp.files) {
      const ds = datasetId(path);
      if (!ds) continue;
      let payload: unknown;
      try {
        payload = parseJson(utf8.decode(raw) || "null");
      } catch {
        skipped.push({ file: path, reason: "not valid JSON" });
        continue;
      }
      if (tooDeep(payload)) {
        skipped.push({ file: path, reason: "nested too deeply" });
        continue;
      }
      if (isEmpty(payload)) continue;
      const prev = parsed.get(ds);
      parsed.set(ds, Array.isArray(payload) && Array.isArray(prev) ? [...prev, ...payload] : payload); // same file under different folder casing
    }

    const rawInfo = parsed.get("riotaccount/account_info");
    const info = isObj(rawInfo) ? rawInfo : {};
    const str = (k: string) => String(info[k] || "").trim();
    const [name, tag] = [str("game_name"), str("tagline")];
    const username = str("username") || (name && tag ? `${name}#${tag}` : name);
    if (!username) throw new VaultError("account_info.json has no username; this does not look like a Riot export.");

    const specs = new Map<string, Spec>();
    const times = new Map<string, (string | null)[]>();
    for (const [ds, payload] of parsed) {
      let s = specFor(ds, payload);
      if (s.mode !== "snapshot" && !s.time) s = { ...s, time: guessTimeField(payload as unknown[]) };
      specs.set(ds, s);
      if (s.mode !== "snapshot") times.set(ds, (payload as unknown[]).map((r) => (s.time && isObj(r) ? parseTime(r[s.time]) : null)));
    }
    const watermark = exportWatermark(specs, times);
    const rank = watermark ?? "";
    const hash = await contentHash(exp);
    const prepared = new Map<string, { keys: [string, number][]; data: string[] } | string>();
    for (const [ds, payload] of parsed) {
      if (specs.get(ds)!.mode === "snapshot") prepared.set(ds, canonical(payload));
      else prepared.set(ds, { keys: await recordKeys(specs.get(ds)!, payload as unknown[]), data: (payload as unknown[]).map(canonical) });
    }

    // 2. Merge in one transaction: all of it lands, or none of it does.
    const tx = this.tx(["accounts", "imports", "records", "snapshots", "datasets"], "readwrite");
    const finished = done(tx);
    finished.catch(() => {}); // awaited below; this only stops an early abort counting as unhandled
    const S = {
      accounts: tx.objectStore("accounts"),
      imports: tx.objectStore("imports"),
      records: tx.objectStore("records"),
      snapshots: tx.objectStore("snapshots"),
      datasets: tx.objectStore("datasets"),
    };
    try {
      const found = (await req(S.accounts.index("ulc").get(asciiLower(username)))) as AccountRow | undefined;
      const created = !found;
      const acc = found
        ? found.id!
        : ((await req(S.accounts.add({ username, ulc: asciiLower(username), created_at: nowIso() } satisfies AccountRow))) as number);
      const dup = (await req(S.imports.index("hash").get([acc, hash]))) as ImportRow | undefined;
      // A record changes only when this export is at least as new as the one that stored it.
      // Re-importing an export seen before never changes anything (so an old export imported again
      // can't undo a newer one), and an export with no dates never overrides stored data.
      const mayUpdate = !!rank && !dup;
      const importRow: ImportRow = { account_id: acc, imported_at: nowIso(), source_name: exp.name, content_hash: hash, watermark, archive_path: null, stats: null };
      const imp = (await req(S.imports.add(importRow))) as number;

      const stats: Record<string, DatasetStat> = {};
      for (const [ds, payload] of parsed) {
        const s = specs.get(ds)!;
        const prevDs = (await req(S.datasets.get([acc, ds]))) as DatasetRow | undefined;
        await req(S.datasets.put({ account_id: acc, dataset: ds, mode: s.mode, time_field: s.time ?? prevDs?.time_field ?? null } satisfies DatasetRow));
        const prep = prepared.get(ds)!;

        if (typeof prep === "string") {
          const snaps = (await req(S.snapshots.getAll(prefix(acc, ds)))) as SnapshotRow[];
          const prev = latestSnapshot(snaps);
          if (!prev || prev.data !== prep) await req(S.snapshots.put({ account_id: acc, dataset: ds, import_id: imp, wm: watermark, data: prep } satisfies SnapshotRow));
          stats[ds] = { mode: "snapshot", in_file: 1, new: +!prev, updated: +(!!prev && prev.data !== prep), existing: +(!!prev && prev.data === prep) };
          continue;
        }

        const rows = new Map<string, RecordRow>();
        const id = (k: string, o: number) => `${k}\u0000${o}`;
        for (const r of (await req(S.records.getAll(prefix(acc, ds)))) as RecordRow[]) rows.set(id(r.rkey, r.occ), r);
        const ts = times.get(ds)!;
        let added = 0, upd = 0, same = 0;
        for (let i = 0; i < prep.keys.length; i++) {
          const [k, occ] = prep.keys[i];
          const data = prep.data[i];
          let old = rows.get(id(k, occ));
          if (!old && s.mode === "keyed" && (await this.adopt(S.records, rows, id, acc, ds, k, occ, data))) old = rows.get(id(k, occ));
          if (!old) {
            const row: RecordRow = { account_id: acc, dataset: ds, rkey: k, occ, t: ts[i], data, wm: watermark, first_import: imp, last_import: imp };
            rows.set(id(k, occ), row);
            await req(S.records.put(row));
            added++;
          } else if (old.data !== data && mayUpdate && (old.wm ?? "") <= rank) {
            Object.assign(old, { data, t: ts[i], wm: watermark, last_import: imp });
            await req(S.records.put(old));
            upd++;
          } else {
            old.last_import = Math.max(old.last_import ?? 0, imp);
            if ((old.wm ?? "") < rank) old.wm = watermark;
            await req(S.records.put(old));
            same++;
          }
        }
        stats[ds] = { mode: s.mode, in_file: (payload as unknown[]).length, new: added, updated: upd, existing: same };
      }

      const sum = (k: keyof DatasetStat) => Object.values(stats).reduce((n, v) => n + (v[k] as number), 0);
      const result = {
        import_id: imp,
        id: imp,
        account_id: acc,
        username,
        new_account: created,
        source_name: exp.name,
        watermark,
        imported_at: importRow.imported_at,
        already_imported: !!dup,
        datasets: stats,
        skipped,
        totals: { in_file: sum("in_file"), new: sum("new"), updated: sum("updated"), existing: sum("existing") },
      };
      await req(S.imports.put({ ...importRow, id: imp, stats: JSON.stringify(result) }));
      await finished;
      return result;
    } catch (e) {
      try {
        tx.abort();
      } catch {
        /* already finished */
      }
      await finished.catch(() => {});
      throw e;
    }
  }

  /**
   * Re-key a stored keyed record whose identity form changed between exports.
   * A key that was unique becomes "<key>#<hash>" when Riot repeats it, and older versions of the
   * app stored keys with a blank field that way too. Without this, either change would leave the
   * stored record behind as a duplicate.
   */
  private async adopt(store: IDBObjectStore, rows: Map<string, RecordRow>, id: (k: string, o: number) => string, acc: number, ds: string, k: string, occ: number, data: string) {
    const bare = splitDupKey(k);
    let src: string;
    if (bare !== null) {
      const old = rows.get(id(bare, 0));
      if (!old || old.data !== data) return false;
      src = bare;
    } else {
      const matches = [...rows.values()].filter((r) => r.rkey.startsWith(`${k}#`) && splitDupKey(r.rkey) === k).map((r) => r.rkey);
      if (matches.length !== 1) return false;
      src = matches[0];
    }
    const row = rows.get(id(src, 0));
    if (row) {
      await req(store.delete([acc, ds, src, 0]));
      rows.delete(id(src, 0));
      Object.assign(row, { rkey: k, occ });
      await req(store.put(row));
      rows.set(id(k, occ), row);
    }
    return true;
  }

  // ------------------------------------------------------------------- reads
  async accounts() {
    const tx = this.tx(["accounts", "imports", "snapshots"]);
    const accs = (await req(tx.objectStore("accounts").getAll())) as AccountRow[];
    const out = [];
    for (const a of accs.sort((x, y) => x.id! - y.id!)) {
      const snap = latestSnapshot((await req(tx.objectStore("snapshots").getAll(prefix(a.id!, "riotaccount/account_info")))) as SnapshotRow[]);
      const prof = snap ? (JSON.parse(snap.data) as Record<string, unknown>) : {};
      const imps = (await req(tx.objectStore("imports").index("account").getAll(a.id!))) as ImportRow[];
      const last = imps.sort((x, y) => y.id! - x.id!)[0];
      out.push({
        id: a.id!,
        username: a.username,
        game_name: (prof.game_name as string) ?? null,
        tagline: (prof.tagline as string) ?? null,
        added_at: a.created_at,
        last_import: last?.imported_at ?? null,
        data_until: last?.watermark ?? null,
      });
    }
    return out;
  }

  async snapshot(acc: number, ds: string) {
    const s = latestSnapshot((await req(this.tx(["snapshots"]).objectStore("snapshots").getAll(prefix(acc, ds)))) as SnapshotRow[]);
    return s ? JSON.parse(s.data) : null;
  }

  async snapshotHistory(acc: number, ds: string) {
    const rows = (await req(this.tx(["snapshots"]).objectStore("snapshots").getAll(prefix(acc, ds)))) as SnapshotRow[];
    return rows
      .sort((a, b) => cmpNullFirst(a.wm, b.wm) || a.import_id - b.import_id)
      .map((r) => ({ import_id: r.import_id, watermark: r.wm, data: JSON.parse(r.data) }));
  }

  async accountDetail(acc: number) {
    const tx = this.tx(["accounts", "datasets", "records", "snapshots"]);
    const a = (await req(tx.objectStore("accounts").get(acc))) as AccountRow | undefined;
    if (!a) return null;
    const dsRows = ((await req(tx.objectStore("datasets").getAll(prefix(acc)))) as DatasetRow[]).sort((x, y) => cmp(x.dataset, y.dataset));
    const datasets = [];
    for (const d of dsRows) {
      let count = 1, first: string | null = null, last: string | null = null;
      if (d.mode !== "snapshot") {
        const recs = (await req(tx.objectStore("records").getAll(prefix(acc, d.dataset)))) as RecordRow[];
        count = recs.length;
        for (const r of recs) {
          if (r.t === null) continue;
          if (first === null || r.t < first) first = r.t;
          if (last === null || r.t > last) last = r.t;
        }
      }
      const spec = SPECS[d.dataset];
      datasets.push({ dataset: d.dataset, mode: d.mode, time_field: d.time_field, count, first, last, label: spec?.label ?? null, known: !!spec });
    }
    const snaps = (await req(tx.objectStore("snapshots").getAll(prefix(acc)))) as SnapshotRow[];
    const byDs = new Map<string, SnapshotRow[]>();
    for (const s of snaps) byDs.set(s.dataset, [...(byDs.get(s.dataset) ?? []), s]);
    const snapshots: Record<string, unknown> = {};
    for (const [ds, list] of byDs) snapshots[ds] = JSON.parse(latestSnapshot(list)!.data);
    return { id: acc, username: a.username, datasets, snapshots, imports: await this.imports(acc) };
  }

  async records(acc: number, ds: string) {
    const rows = (await req(this.tx(["records"]).objectStore("records").getAll(prefix(acc, ds)))) as RecordRow[];
    rows.sort((a, b) => (a.t === null ? 1 : 0) - (b.t === null ? 1 : 0) || cmp(a.t, b.t) || cmp(a.rkey, b.rkey) || a.occ - b.occ);
    return rows.map((r) => {
      const v = JSON.parse(r.data);
      const d: Record<string, unknown> = isObj(v) ? v : { value: v };
      d._t = r.t;
      d._import = r.first_import;
      return d;
    });
  }

  async imports(acc?: number) {
    const tx = this.tx(["imports", "accounts"]);
    const store = tx.objectStore("imports");
    const rows = (await req(acc ? store.index("account").getAll(acc) : store.getAll())) as ImportRow[];
    const names = new Map(((await req(tx.objectStore("accounts").getAll())) as AccountRow[]).map((a) => [a.id!, a.username]));
    return rows
      .sort((a, b) => b.id! - a.id!)
      .map((r) => {
        const s = r.stats ? JSON.parse(r.stats) : {};
        return {
          id: r.id!,
          account_id: r.account_id,
          username: names.get(r.account_id) ?? "",
          imported_at: r.imported_at,
          source_name: r.source_name,
          watermark: r.watermark,
          totals: s.totals ?? null,
          datasets: s.datasets ?? null,
          already_imported: s.already_imported ?? false,
        };
      });
  }

  // ------------------------------------------------------------ annotations
  async annotations(acc: number, kind: string) {
    const rows = (await req(this.tx(["annotations"]).objectStore("annotations").getAll(prefix(acc, kind)))) as { key: string; value: string }[];
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  /** Set many keys at once; a null/empty value removes the key. */
  async setAnnotations(acc: number, kind: string, items: Record<string, unknown>) {
    const clean: [string, string | null][] = Object.entries(items).map(([k, v]) => {
      if (v != null && !["string", "number"].includes(typeof v)) throw new VaultError("Annotation values must be text.");
      return [String(k), v == null ? null : String(v)];
    });
    const tx = this.tx(["annotations"], "readwrite");
    const s = tx.objectStore("annotations");
    for (const [key, value] of clean) {
      if (value === null || value === "") s.delete([acc, kind, key]);
      else s.put({ account_id: acc, kind, key, value });
    }
    await done(tx);
  }

  async settings(): Promise<Record<string, unknown>> {
    const rows = (await req(this.tx(["settings"]).objectStore("settings").getAll())) as { key: string; value: unknown }[];
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async setSettings(values: Record<string, unknown>) {
    const tx = this.tx(["settings"], "readwrite");
    for (const [key, value] of Object.entries(values)) tx.objectStore("settings").put({ key, value: JSON.parse(JSON.stringify(value ?? null)) });
    await done(tx);
    return this.settings();
  }

  async deleteAccount(acc: number) {
    const tx = this.tx(["records", "snapshots", "datasets", "annotations", "imports", "accounts"], "readwrite");
    for (const s of ["records", "snapshots", "datasets", "annotations"]) tx.objectStore(s).delete(prefix(acc));
    const imps = tx.objectStore("imports");
    for (const k of await req(imps.index("account").getAllKeys(acc))) imps.delete(k);
    tx.objectStore("accounts").delete(acc);
    await done(tx);
  }

  // ---------------------------------------------------------- backup / restore
  /** The whole vault as one gzipped JSON file, so it can be moved to another browser or device. */
  async backup(app = "Valosight"): Promise<Blob> {
    const tx = this.tx([...STORES]);
    const stores: Record<string, unknown[]> = {};
    for (const s of STORES) stores[s] = await req(tx.objectStore(s).getAll());
    const json = JSON.stringify({ format: BACKUP_FORMAT, version: 1, app, created_at: nowIso(), stores });
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Response(stream).blob();
  }

  /** Replace everything in this vault with a backup file's contents. */
  async restore(file: Blob) {
    let doc: { format?: string; version?: number; stores?: Record<string, unknown> };
    try {
      const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
      const body = head[0] === 0x1f && head[1] === 0x8b ? file.stream().pipeThrough(new DecompressionStream("gzip")) : file.stream();
      doc = JSON.parse(await new Response(body).text());
    } catch {
      throw new VaultError("That file isn't a Valosight backup.");
    }
    if (doc?.format !== BACKUP_FORMAT || !isObj(doc.stores)) throw new VaultError("That file isn't a Valosight backup.");
    if ((doc.version ?? 0) > 1) throw new VaultError("This backup was made by a newer version of Valosight. Update the app, then try again.");
    const stores = doc.stores as Record<string, unknown>;
    for (const s of STORES) {
      const rows = stores[s] ?? [];
      if (!Array.isArray(rows) || !rows.every((r) => validRow(s, r))) throw new VaultError("This backup is damaged. Your vault was not changed.");
    }
    const tx = this.tx([...STORES], "readwrite");
    try {
      for (const s of STORES) {
        const os = tx.objectStore(s);
        os.clear();
        for (const row of (stores[s] as unknown[]) ?? []) os.put(row);
      }
      await done(tx);
    } catch (e) {
      try {
        tx.abort();
      } catch {
        /* already rolled back */
      }
      throw new VaultError(`This backup couldn't be restored (${(e as Error)?.message ?? "invalid data"}). Your vault was not changed.`);
    }
    const accounts = ((stores.accounts as unknown[]) ?? []).length;
    return { accounts };
  }
}

export const BACKUP_FORMAT = "valosight-vault";

/** The fields each table needs, checked before a restore clears anything. */
const SHAPES: Record<string, Record<string, "number" | "string">> = {
  accounts: { id: "number", username: "string", ulc: "string", created_at: "string" },
  imports: { id: "number", account_id: "number" },
  records: { account_id: "number", dataset: "string", rkey: "string", occ: "number", data: "string" },
  snapshots: { account_id: "number", dataset: "string", import_id: "number", data: "string" },
  datasets: { account_id: "number", dataset: "string", mode: "string" },
  annotations: { account_id: "number", kind: "string", key: "string", value: "string" },
  settings: { key: "string" },
  fx_daily: { base: "string", quote: "string", day: "string", rate: "number" },
  fx_latest: { base: "string", quote: "string", rate: "number" },
};

function validRow(store: string, row: unknown): boolean {
  return isObj(row) && Object.entries(SHAPES[store]).every(([k, t]) => typeof row[k] === t);
}

/** The newest snapshot: highest watermark (no watermark counts as oldest), then the latest import. */
function latestSnapshot(rows: SnapshotRow[]): SnapshotRow | null {
  let best: SnapshotRow | null = null;
  for (const r of rows) if (!best || cmpNullFirst(r.wm, best.wm) > 0 || (r.wm === best.wm && r.import_id > best.import_id)) best = r;
  return best;
}
