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

/** The zip is password-protected. The message starts with a code the page recognises (errors cross the
 * worker boundary as text): PASSWORD_REQUIRED (none given) or PASSWORD_WRONG. */
export class PasswordError extends SourceError {
  constructor(public code: "PASSWORD_REQUIRED" | "PASSWORD_WRONG") {
    super(code === "PASSWORD_REQUIRED" ? "PASSWORD_REQUIRED: This zip is password-protected." : "PASSWORD_WRONG: That password didn't open the zip.");
  }
}

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

/** Many small, very compressible entries can add up to a bomb that no single entry reveals: checks one
 * archive's running total (from its listing, before anything is inflated) against its size. */
function checkArchiveTotal(total: number, archiveBytes: number) {
  if (total > 64 * 1024 ** 2 && total > LIMITS.ratio * archiveBytes)
    throw new SourceError("This archive is compressed suspiciously well (a possible zip bomb); it was not imported.");
}

const wanted = (p: string) => WANTED.some((w) => p.toLowerCase().endsWith(w));

function fromZipBytes(data: Uint8Array, budget: Budget): Map<string, Uint8Array> {
  const names = new Map<string, string>(); // name in archive -> cleaned path
  let total = 0;
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(data, {
      filter(f) {
        const p = clean(f.name);
        if (f.name.endsWith("/") || !p || !wanted(p) || f.originalSize > LIMITS.file) return false;
        if (f.originalSize > 1024 ** 2 && f.originalSize > LIMITS.ratio * Math.max(f.size, 1))
          throw new SourceError("This archive is compressed suspiciously well (a possible zip bomb); it was not imported.");
        budget.take(f.originalSize);
        checkArchiveTotal((total += f.originalSize), data.length);
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
    if (p.toLowerCase().endsWith(".zip")) {
      if (zipEncrypted(b)) throw new SourceError("There's a password-protected zip inside this one. Unzip the outer file and import the protected zip on its own.");
      for (const [q, c] of fromZipBytes(b, budget)) if (!q.toLowerCase().endsWith(".zip")) out.set(`${p}/${q}`, c);
    }
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

/** True when the zip has encrypted entries (general-purpose flag bit 0 in its central directory). */
export function zipEncrypted(d: Uint8Array): boolean {
  if (d.length < 22) return false;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  // Walks the central directory from `o`; null when the entries don't line up there.
  const walk = (o: number, n: number): boolean | null => {
    while (n > 0) {
      if (o < 0 || o + 46 > d.length || v.getUint32(o, true) !== 0x02014b50) return null;
      if (v.getUint16(o + 8, true) & 1) return true;
      o += 46 + v.getUint16(o + 28, true) + v.getUint16(o + 30, true) + v.getUint16(o + 32, true);
      n--;
    }
    return false;
  };
  for (let i = d.length - 22; i >= Math.max(0, d.length - 65557); i--) {
    if (v.getUint32(i, true) !== 0x06054b50) continue;
    const n = v.getUint16(i + 10, true);
    const size = v.getUint32(i + 12, true);
    const o = v.getUint32(i + 16, true);
    if (o === 0xffffffff || n === 0xffff) break; // zip64: fall back to the first local header
    // Where the listing says, else just before the end record (data prepended to the zip shifts the offsets).
    return walk(o, n) ?? walk(i - size, n) ?? false;
  }
  // No end record we can use (zip64, or not a zip): only trust a local header at the very start.
  return d.length >= 30 && v.getUint32(0, true) === 0x04034b50 && (v.getUint16(6, true) & 1) === 1;
}

/**
 * Unpack a password-protected zip (ZipCrypto or AES) with zip.js, loaded only when needed. Workers and
 * WebAssembly are off (the CSP allows neither): inflating uses the browser's DecompressionStream and AES
 * uses Web Crypto. The same limits as a plain zip apply, and output sizes are checked as well.
 */
async function fromEncryptedZip(data: Uint8Array, password: string, budget: Budget): Promise<Map<string, Uint8Array>> {
  const zip = await import("@zip.js/zip.js");
  zip.configure({ useWebWorkers: false, useCompressionStream: true });
  const reader = new zip.ZipReader(new zip.Uint8ArrayReader(data));
  const out = new Map<string, Uint8Array>();
  try {
    let entries;
    try {
      entries = await reader.getEntries();
    } catch {
      throw new SourceError("This file is not a valid .zip archive.");
    }
    if (entries.length > LIMITS.entries) throw new SourceError("This export is far larger than any Riot export; it was not imported.");
    let checked = false;
    let total = 0;
    for (const e of entries) {
      if (e.directory) continue;
      const p = clean(e.filename);
      if (!p || !wanted(p) || e.uncompressedSize > LIMITS.file) continue;
      if (e.uncompressedSize > 1024 ** 2 && e.uncompressedSize > LIMITS.ratio * Math.max(e.compressedSize, 1))
        throw new SourceError("This archive is compressed suspiciously well (a possible zip bomb); it was not imported.");
      budget.take(e.uncompressedSize);
      checkArchiveTotal((total += e.uncompressedSize), data.length);
      let bytes: Uint8Array;
      // The listed sizes come from the archive itself and can lie: stop inflating as soon as an entry
      // writes more than it claimed, instead of letting the buffer grow until the worker runs out of memory.
      const capped = new zip.Uint8ArrayWriter();
      const write = capped.writeUint8Array.bind(capped);
      const lie = () => new SourceError("This archive's contents don't match its listing; it was not imported.");
      let written = 0;
      let overflow = false;
      capped.writeUint8Array = async (chunk: Uint8Array) => {
        written += chunk.length;
        if (written > e.uncompressedSize || written > LIMITS.file) {
          overflow = true;
          throw lie();
        }
        return write(chunk);
      };
      try {
        bytes = await e.getData(capped, { password: e.encrypted ? password : undefined, checkSignature: true });
      } catch (err) {
        // zip.js may wrap the writer's error, so check the flag rather than the error.
        const m = String((err as Error)?.message ?? err);
        // Too much output (or zip.js's own "Invalid uncompressed size") means a lying listing, unless a wrong
        // password could explain it: ZipCrypto's check is weak (a wrong password inflates garbage), AES's isn't.
        const weak = e.encrypted && (e as { zipCrypto?: boolean }).zipCrypto !== false && !checked;
        if ((overflow || /uncompressed size/i.test(m)) && !weak) throw lie();
        // A wrong ZipCrypto password passes its 1-byte check about 1 time in 256 and only fails later (bad
        // data or checksum), so any failure reading an encrypted entry means "wrong password".
        if (e.encrypted || /password/i.test(m)) throw new PasswordError("PASSWORD_WRONG");
        throw new SourceError(`Could not read the archive: ${m}`);
      }
      if (bytes.length > e.uncompressedSize || bytes.length > LIMITS.file) throw new SourceError("This archive's contents don't match its listing; it was not imported.");
      checked ||= e.encrypted;
      out.set(p, bytes);
    }
    if (!checked && entries.some((e) => e.encrypted)) {
      // Nothing we read was encrypted, but some entries are: still make sure the password is right.
      const e = entries.find((x) => x.encrypted && !x.directory);
      try {
        if (e && !e.directory) await e.getData(new zip.Uint8ArrayWriter(), { password, checkPasswordOnly: true });
      } catch {
        throw new PasswordError("PASSWORD_WRONG");
      }
    }
  } finally {
    await reader.close().catch(() => {});
  }
  return out;
}

/**
 * Like readUploads, but also opens a password-protected zip: without a password it throws
 * PasswordError("PASSWORD_REQUIRED"), with a wrong one PasswordError("PASSWORD_WRONG").
 */
export async function readUploadsAsync(items: [string, Uint8Array][], password?: string): Promise<Export[]> {
  if (items.length === 1 && items[0][0].toLowerCase().endsWith(".zip") && zipEncrypted(items[0][1])) {
    if (!password) throw new PasswordError("PASSWORD_REQUIRED");
    const budget = new Budget();
    return splitExports(await fromEncryptedZip(items[0][1], password, budget), stripExt(baseName(items[0][0])), budget);
  }
  for (const [name, data] of items)
    if (name.toLowerCase().endsWith(".zip") && zipEncrypted(data))
      throw new SourceError(`${baseName(name)} is password-protected. Import it on its own (choose just that zip) so Valosight can ask for its password.`);
  return readUploads(items);
}
