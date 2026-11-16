/**
 * Read a Riot data export from a .zip or from the files of an extracted folder.
 *
 * Everything happens in memory on this device; files are only ever read. A folder may hold one or
 * several exports (one per account); each is found by its riotAccount/account_info.json file.
 * Only .json files (and .zip files that may hold an export) are read, within fixed size limits,
 * so a hostile or broken archive cannot exhaust memory.
 */
import { unzipSync } from "fflate";

export const ACCOUNT_INFO = "riotaccount/account_info.json";
const IGNORED_PARTS = new Set(["__macosx", ".ds_store", "thumbs.db", "desktop.ini"]);
const WANTED = [".json", ".zip", ".csv"]; // .csv: Riot includes a readme.csv

/** Size limits; mutable only so tests can lower them. */
export const LIMITS = {
  file: 1024 ** 3, // one file
  total: 2 * 1024 ** 3, // everything read from one source, after decompression
  entries: 50_000,
  ratio: 200, // compressed -> uncompressed, for entries over 1 MB (zip bombs)
};

export class SourceError extends Error {}

export interface Export {
  name: string;
  files: Map<string, Uint8Array>; // relative posix path -> bytes
}

const enc = new TextEncoder();

/** Identifies an export by its contents, so importing the same one twice is recognised. */
export async function contentHash(exp: Export): Promise<string> {
  const paths = [...exp.files.keys()].sort((a, b) => {
    const x = a.toLowerCase(), y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  });
  const parts: Uint8Array[] = [];
  for (const p of paths) {
    parts.push(enc.encode(p.toLowerCase()), new Uint8Array([0]));
    parts.push(new Uint8Array(await crypto.subtle.digest("SHA-256", exp.files.get(p)! as BufferSource)));
  }
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", all)), (x) => x.toString(16).padStart(2, "0")).join("");
}

function clean(path: string): string | null {
  const parts = path.replace(/\\/g, "/").split("/").filter((p) => p !== "" && p !== ".");
  if (!parts.length || parts.some((p) => IGNORED_PARTS.has(p.toLowerCase()) || p.startsWith("._"))) return null;
  if (parts.includes("..")) return null;
  return parts.join("/");
}

/** Running total of bytes and files read from one source. */
export class Budget {
  bytes = 0;
  entries = 0;
  take(size: number) {
    this.bytes += size;
    this.entries += 1;
    if (this.bytes > LIMITS.total || this.entries > LIMITS.entries)
      throw new SourceError("This export is far larger than any Riot export; it was not imported.");
  }
}

const wanted = (p: string) => WANTED.some((w) => p.toLowerCase().endsWith(w));

function fromZipBytes(data: Uint8Array, budget: Budget): Map<string, Uint8Array> {
  const names = new Map<string, string>(); // name in archive -> cleaned path
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(data, {
      filter(f) {
        const p = clean(f.name);
        if (f.name.endsWith("/") || !p || !wanted(p) || f.originalSize > LIMITS.file) return false;
        if (f.originalSize > 1024 ** 2 && f.originalSize > LIMITS.ratio * Math.max(f.size, 1))
          throw new SourceError("This archive is compressed suspiciously well (a possible zip bomb); it was not imported.");
        budget.take(f.originalSize);
        names.set(f.name, p);
        return true;
      },
    });
  } catch (e) {
    if (e instanceof SourceError) throw e;
    throw new SourceError(names.size ? `Could not read the archive: ${(e as Error).message}` : "This file is not a valid .zip archive.");
  }
  const out = new Map<string, Uint8Array>();
  for (const [name, bytes] of Object.entries(raw)) out.set(names.get(name)!, bytes);
  return out;
}

/** If a folder holds export zips (and no loose export), unpack them. */
function expandZips(files: Map<string, Uint8Array>, budget: Budget): Map<string, Uint8Array> {
  if ([...files.keys()].some((p) => p.toLowerCase().endsWith(ACCOUNT_INFO))) return files;
  const out = new Map([...files].filter(([p]) => !p.toLowerCase().endsWith(".zip")));
  for (const [p, b] of files)
    if (p.toLowerCase().endsWith(".zip"))
      for (const [q, c] of fromZipBytes(b, budget)) if (!q.toLowerCase().endsWith(".zip")) out.set(`${p}/${q}`, c);
  return out;
}

export function splitExports(files: Map<string, Uint8Array>, defaultName: string, budget = new Budget()): Export[] {
  files = expandZips(files, budget);
  const roots = [...new Set([...files.keys()].filter((p) => p.toLowerCase().endsWith(ACCOUNT_INFO)).map((p) => p.slice(0, p.length - ACCOUNT_INFO.length)))].sort(
    (a, b) => b.length - a.length,
  );
  if (!roots.length) throw new SourceError("No Riot export found. Expected a riotAccount/account_info.json file inside the zip or folder.");
  const exports: Export[] = [];
  const taken = new Set<string>();
  for (const r of roots) {
    const sub = new Map<string, Uint8Array>();
    for (const [p, b] of files) if (p.startsWith(r) && !taken.has(p)) sub.set(p.slice(r.length), b);
    for (const p of sub.keys()) taken.add(r + p);
    let name = r ? r.replace(/\/+$/, "").split("/").pop()! : defaultName;
    if (name.toLowerCase().endsWith(".zip")) name = name.slice(0, -4);
    exports.push({ name: name || defaultName, files: sub });
  }
  return exports;
}

const baseName = (p: string) => p.replace(/\\/g, "/").split("/").pop() ?? p;
const stripExt = (n: string) => n.replace(/\.[^.]*$/, "");

/** Split chosen files (path or file name, bytes) into Exports; a single .zip is unpacked. */
export function readUploads(items: [string, Uint8Array][]): Export[] {
  const budget = new Budget();
  if (items.length === 1 && items[0][0].toLowerCase().endsWith(".zip"))
    return splitExports(fromZipBytes(items[0][1], budget), stripExt(baseName(items[0][0])), budget);
  const files = new Map<string, Uint8Array>();
  for (const [name, data] of items) {
    const p = clean(name);
    if (p && wanted(p)) {
      budget.take(data.length);
      files.set(p, data);
    }
  }
  const first = (files.keys().next().value ?? "export").split("/")[0];
  return splitExports(files, first, budget);
}
