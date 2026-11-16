/**
 * Password-protected zips: the demo export, re-packed with a password (AES-256 and the older ZipCrypto),
 * must import exactly like the plain zip; no password or a wrong one must ask again, never half-import.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter, configure } from "@zip.js/zip.js";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { PasswordError, readUploads, readUploadsAsync, zipEncrypted } from "./source";

const DEMO = resolve(__dirname, "../../../test/demo-export/Demo_Player-DEMO.zip");
const plain = new Uint8Array(readFileSync(DEMO));
configure({ useWebWorkers: false });

async function protect(password: string, zipCrypto: boolean): Promise<Uint8Array> {
  const w = new ZipWriter(new BlobWriter("application/zip"), { password, zipCrypto, encryptionStrength: 3 });
  for (const [name, bytes] of Object.entries(unzipSync(plain))) if (!name.endsWith("/")) await w.add(name, new Uint8ArrayReader(bytes));
  return new Uint8Array(await (await w.close()).arrayBuffer());
}
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof PasswordError ? e.code : `other: ${(e as Error).message}`;
  }
};

describe("password-protected zips", () => {
  for (const [kind, zipCrypto] of [
    ["AES-256", false],
    ["ZipCrypto", true],
  ] as const) {
    it(`opens ${kind} with the right password, and asks again otherwise`, async () => {
      const locked = await protect("s3cret pass", zipCrypto);
      expect(zipEncrypted(locked)).toBe(true);
      expect(await code(readUploadsAsync([["export.zip", locked]]))).toBe("PASSWORD_REQUIRED");
      expect(await code(readUploadsAsync([["export.zip", locked]], "nope"))).toBe("PASSWORD_WRONG");
      const [got] = await readUploadsAsync([["export.zip", locked]], "s3cret pass");
      const [want] = readUploads([["export.zip", plain]]);
      expect([...got.files.keys()].sort()).toEqual([...want.files.keys()].sort());
      for (const [p, b] of want.files) expect(Buffer.from(got.files.get(p)!).equals(Buffer.from(b)), p).toBe(true);
    });
  }

  it("leaves plain zips alone", async () => {
    expect(zipEncrypted(plain)).toBe(false);
    const [a] = await readUploadsAsync([["export.zip", plain]], "ignored");
    expect(a.files.size).toBe(readUploads([["export.zip", plain]])[0].files.size);
  });

  it("asks for a protected zip to be imported on its own", async () => {
    const locked = await protect("x", false);
    expect(await code(readUploadsAsync([["a.zip", locked], ["b.json", new TextEncoder().encode("{}")]]))).toMatch(/import it on its own/i);
  });

  it("still refuses a zip bomb behind a password", async () => {
    const w = new ZipWriter(new BlobWriter("application/zip"), { password: "x", encryptionStrength: 3 });
    await w.add("riotaccount/account_info.json", new TextReader("{}"));
    await w.add("big.json", new TextReader("[" + "0,".repeat(4 * 1024 ** 2) + "0]"));
    const bomb = new Uint8Array(await (await w.close()).arrayBuffer());
    expect(await code(readUploadsAsync([["bomb.zip", bomb]], "x"))).toMatch(/zip bomb/);
  });

  it("stops inflating an entry that writes more than its listing claims", async () => {
    const w = new ZipWriter(new BlobWriter("application/zip"), { password: "x", encryptionStrength: 3 });
    await w.add("riotaccount/account_info.json", new TextReader("[" + "1,".repeat(300_000) + "1]"));
    const z = new Uint8Array(await (await w.close()).arrayBuffer());
    // Rewrite the central directory's uncompressed size (offset 24 in the entry) to claim 1,000 bytes.
    const dv = new DataView(z.buffer);
    let hit = 0;
    for (let i = z.length - 46; i >= 0; i--)
      if (dv.getUint32(i, true) === 0x02014b50) {
        dv.setUint32(i + 24, 1000, true);
        hit++;
        break;
      }
    expect(hit).toBe(1);
    expect(await code(readUploadsAsync([["lie.zip", z]], "x"))).toMatch(/don't match its listing/);
  });

  it("refuses many small entries that add up to a bomb behind a password", async () => {
    const w = new ZipWriter(new BlobWriter("application/zip"), { password: "x", encryptionStrength: 3 });
    const mib = "0".repeat(1024 ** 2); // each entry alone stays under the per-entry check
    for (let i = 0; i < 70; i++) await w.add(`part${i}.json`, new TextReader(mib));
    const bomb = new Uint8Array(await (await w.close()).arrayBuffer());
    expect(await code(readUploadsAsync([["bomb.zip", bomb]], "x"))).toMatch(/zip bomb/);
  }, 30_000);
});
