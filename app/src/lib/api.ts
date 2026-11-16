export type Rec = Record<string, any> & { _t: string | null; _import: number };

export interface Account {
  id: number;
  username: string;
  game_name?: string;
  tagline?: string;
  added_at: string;
  last_import: string | null;
  data_until: string | null;
}

export interface DatasetInfo {
  dataset: string;
  mode: "keyed" | "multiset" | "snapshot";
  time_field: string | null;
  count: number;
  first: string | null;
  last: string | null;
  label: string | null;
  known: boolean;
}

export interface DatasetStat {
  mode: string;
  in_file: number;
  new: number;
  updated: number;
  existing: number;
}

export interface ImportInfo {
  id: number;
  account_id: number;
  username: string;
  imported_at: string;
  source_name: string;
  watermark: string;
  totals?: { in_file: number; new: number; updated: number; existing: number };
  datasets?: Record<string, DatasetStat>;
  already_imported: boolean;
}

export interface ImportResult extends ImportInfo {
  import_id: number;
  new_account: boolean;
  skipped: { file: string; reason: string }[];
}

export interface FxLatest {
  rate: number;
  as_of: string | null;
  source: string;
  fetched_at: string;
}
/** daily[base][quote] = [[day, rate], …] oldest first; latest[base][quote] = today's rate. */
export interface FxRates {
  daily: Record<string, Record<string, [string, number][]>>;
  latest: Record<string, Record<string, FxLatest>>;
}

export interface AccountDetail {
  id: number;
  username: string;
  datasets: DatasetInfo[];
  snapshots: Record<string, any>;
  imports: ImportInfo[];
}

/** The engine runs in this browser, in a Web Worker (src/engine). Loaded on first use. */
const engine = () => import("./engine-client");

async function local<T>(method: string, args: unknown[] = [], transfer: Transferable[] = []): Promise<T> {
  return (await engine()).call<T>(method, args, transfer);
}

const recCache = new Map<string, Promise<Rec[]>>();

export const api = {
  accounts: () => local<Account[]>("accounts"),
  account: (id: number) => local<AccountDetail>("account", [id]),
  records: (id: number, ds: string) => {
    const k = `${id}|${ds}`;
    if (!recCache.has(k)) {
      const p = local<Rec[]>("records", [id, ds]);
      p.catch(() => recCache.delete(k));
      recCache.set(k, p);
    }
    return recCache.get(k)!;
  },
  clearCache: () => recCache.clear(),
  annotations: (id: number, kind: string) => local<Record<string, string>>("annotations", [id, kind]),
  setAnnotation: (id: number, kind: string, key: string, value: string | null) => local("setAnnotations", [id, kind, { [key]: value }]),
  imports: () => local<ImportInfo[]>("imports"),
  settings: () => local<Record<string, any>>("settings"),
  saveSettings: (s: Record<string, any>) => local<Record<string, any>>("saveSettings", [s]),
  fx: (bases: string[], quotes: string[]) => local<FxRates>("fx", [bases, quotes]),
  fxSync: (bases: string[], quotes: string[], start: string, force = false) => local<FxSyncResult>("fxSync", [{ bases, quotes, start, force }]),
  deleteAccount: (id: number) => local("deleteAccount", [id]),
  /** `password` opens a password-protected zip; it goes to the engine in memory only and is never stored. */
  upload: (files: { name: string; file: File }[], onProgress: (p: number) => void, password?: string) => readAndImport(files, onProgress, password),
  /** The whole vault as one file, and putting one back. */
  backup: () => local<Blob>("backup"),
  restore: (file: File) => local<{ accounts: number }>("restore", [file]),
  storage: async () => (await engine()).storageInfo(),
};

export interface FxSyncResult {
  days: number;
  latest: number;
  errors: string[];
  skipped: boolean;
}

/** Read the chosen files in this tab and hand them to the engine. Nothing is uploaded anywhere. */
async function readAndImport(files: { name: string; file: File }[], onProgress: (p: number) => void, password?: string): Promise<ImportResult[]> {
  // Only files the engine would read are loaded into memory (a folder can hold videos, installers…).
  files = files.filter((f) => /\.(json|csv|zip)$/i.test(f.name));
  const total = files.reduce((n, f) => n + f.file.size, 0) || 1;
  let read = 0;
  const items: [string, ArrayBuffer][] = [];
  for (const f of files) {
    items.push([f.name, await f.file.arrayBuffer()]);
    read += f.file.size;
    onProgress(Math.min(read / total, 0.999));
  }
  onProgress(1);
  void (await engine()).persist();
  return local<ImportResult[]>("import", [items, password], items.map(([, b]) => b));
}
