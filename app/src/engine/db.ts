/**
 * The vault's storage: an IndexedDB database in this browser, on this device only.
 * The object stores mirror the tables of the retired Python engine's vault.db, so its data moves over as a backup file.
 */

export const STORES = ["accounts", "imports", "records", "snapshots", "datasets", "annotations", "settings", "fx_daily", "fx_latest"] as const;
export type StoreName = (typeof STORES)[number];

export interface AccountRow {
  id?: number;
  username: string;
  ulc: string; // username, ASCII-lowercased (SQLite NOCASE), for case-insensitive lookups
  created_at: string;
}
export interface ImportRow {
  id?: number;
  account_id: number;
  imported_at: string;
  source_name: string;
  content_hash: string;
  watermark: string | null;
  archive_path: string | null;
  stats: string | null;
}
export interface RecordRow {
  account_id: number;
  dataset: string;
  rkey: string;
  occ: number;
  t: string | null;
  data: string; // canonical JSON
  wm: string | null;
  first_import: number;
  last_import: number;
}
export interface SnapshotRow {
  account_id: number;
  dataset: string;
  import_id: number;
  wm: string | null;
  data: string;
}
export interface DatasetRow {
  account_id: number;
  dataset: string;
  mode: string;
  time_field: string | null;
}
export interface AnnotationRow {
  account_id: number;
  kind: string;
  key: string;
  value: string;
}
export interface FxDailyRow {
  base: string;
  quote: string;
  day: string;
  rate: number;
}
export interface FxLatestRow {
  base: string;
  quote: string;
  rate: number;
  as_of: string | null;
  source: string;
  fetched_at: string;
}

export const DB_NAME = "valosight";
const VERSION = 1;

export function openDb(name = DB_NAME, factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = factory.open(name, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      const acc = db.createObjectStore("accounts", { keyPath: "id", autoIncrement: true });
      acc.createIndex("ulc", "ulc", { unique: true });
      const imp = db.createObjectStore("imports", { keyPath: "id", autoIncrement: true });
      imp.createIndex("account", "account_id");
      imp.createIndex("hash", ["account_id", "content_hash"]);
      db.createObjectStore("records", { keyPath: ["account_id", "dataset", "rkey", "occ"] });
      db.createObjectStore("snapshots", { keyPath: ["account_id", "dataset", "import_id"] });
      db.createObjectStore("datasets", { keyPath: ["account_id", "dataset"] });
      db.createObjectStore("annotations", { keyPath: ["account_id", "kind", "key"] });
      db.createObjectStore("settings", { keyPath: "key" });
      db.createObjectStore("fx_daily", { keyPath: ["base", "quote", "day"] });
      db.createObjectStore("fx_latest", { keyPath: ["base", "quote"] });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error("Valosight is open in another tab that is out of date. Close other Valosight tabs and reload."));
  });
}

/** Await one IndexedDB request. Only IDB requests may be awaited inside a transaction, or it commits early. */
export function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("The change was cancelled."));
  });
}

/** Every key that starts with `prefix` in a store with an array keyPath. Arrays sort after all strings and numbers. */
export const prefix = (...p: (string | number)[]) => IDBKeyRange.bound(p, [...p, []]);
