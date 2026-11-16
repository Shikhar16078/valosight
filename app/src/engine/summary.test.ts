/**
 * The per-dataset record summary (count, first, last) kept in the `datasets` store, which
 * `accountDetail` reads instead of every record. Each case checks it against a brute-force count over
 * the stored records (what `accountDetail` used to compute), and that the stored summary is already
 * correct, so opening an account never has to repair it.
 * Run: cd app && npm test
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { strToU8 } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prefix, req, type DatasetRow, type RecordRow } from "./db";
import { readUploads, type Export } from "./source";
import { Vault } from "./vault";

const INFO = "riotAccount/account_info.json";
const LOGINS = "riotAccount/atlas_login_event_uc.json";
const PEN = "penalties/penalty_history.json";
const PAY = "valorant/valorant_payment_event_uc.json";
const ODD = "something/new_file.json"; // a file Riot may add: list, then object, then list again

const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
const login = (days: number, ip = "10.0.0.1") => ({ event_time_utc: ago(days), event_type: "Login", ip_address: ip, product: "VALORANT" });
const penalty = (days: number, status = "ACTIVE", scope: string | null = "VALORANT") => ({ date_issued: ago(days), restriction_type: "CHAT_RESTRICTION", restriction_reason: "Toxicity", scope, status });
const pay = (id: string, days: number, amount = 1) => ({ player_facing_purchase_id: id, payment_time_utc: ago(days), amount });

function exp(files: Record<string, unknown>, username = "tester", name = "exp"): Export {
  const all: Record<string, unknown> = { [INFO]: { username, game_name: "Tester", tagline: "T1" }, ...files };
  return { name, files: new Map(Object.entries(all).map(([p, x]) => [p, strToU8(JSON.stringify(x))])) };
}

let v: Vault;
let n = 0;
beforeEach(async () => {
  v = await Vault.open(`summary-${++n}-${Math.random()}`);
});
afterEach(() => v.db.close());

const imp = (files: Record<string, unknown>, username?: string) => v.importExport(exp(files, username));

/** What accountDetail reported before the summary was stored: every record read and counted. */
async function brute(vault: Vault, acc: number) {
  const tx = vault.db.transaction(["datasets", "records"]);
  const ds = ((await req(tx.objectStore("datasets").getAll(prefix(acc)))) as DatasetRow[]).sort((a, b) => (a.dataset < b.dataset ? -1 : 1));
  const out = [];
  for (const d of ds) {
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
    out.push({ dataset: d.dataset, mode: d.mode, count, first, last });
  }
  return out;
}

const datasetRows = async (vault: Vault, acc: number) => (await req(vault.db.transaction("datasets").objectStore("datasets").getAll(prefix(acc)))) as DatasetRow[];

/** accountDetail matches the brute force, and the stored summary of every list dataset was already right. */
async function check(vault: Vault, acc = 1) {
  const want = await brute(vault, acc);
  for (const d of await datasetRows(vault, acc)) {
    if (d.mode === "snapshot") continue;
    const w = want.find((x) => x.dataset === d.dataset)!;
    expect({ dataset: d.dataset, count: d.count, first: d.first, last: d.last }, "stored summary").toEqual({ dataset: w.dataset, count: w.count, first: w.first, last: w.last });
  }
  const got = (await vault.accountDetail(acc))!.datasets.map(({ dataset, mode, count, first, last }) => ({ dataset, mode, count, first, last }));
  expect(got).toEqual(want);
  expect(want.length).toBeGreaterThan(0);
}

describe("dataset summary", () => {
  it("is right after a first import, a re-import and an import that updates records", async () => {
    const first = { [LOGINS]: [login(9), login(8), login(8)], [PEN]: [penalty(7)], [PAY]: [pay("P1", 9), pay("P2", 6)], [ODD]: [{ a: 1 }, { a: 2 }] };
    await imp(first);
    await check(v);
    expect((await imp(first)).already_imported).toBe(true);
    await check(v);
    // Newer export: a payment moves later (its time changes on update), a penalty changes, new logins.
    const r = await imp({ [LOGINS]: [login(8), login(1)], [PEN]: [penalty(7, "EXPIRED")], [PAY]: [pay("P1", 2), pay("P2", 6)], [ODD]: [{ a: 3 }] });
    expect(r.totals.updated).toBeGreaterThan(0);
    await check(v);
    // An older export again: nothing reverts, the summary stays right.
    await imp(first);
    await check(v);
  });

  it("follows a file that turns from a list into an object and back", async () => {
    await imp({ [LOGINS]: [login(9)], [ODD]: [{ a: 1 }, { a: 2 }] });
    await imp({ [LOGINS]: [login(5)], [ODD]: { a: 1 } });
    await check(v);
    await imp({ [LOGINS]: [login(2)], [ODD]: [{ a: 4 }] });
    await check(v);
  });

  it("is right after rows keyed by older app versions are adopted", async () => {
    const p = penalty(8, "ACTIVE", null);
    await imp({ [LOGINS]: [login(9)], [PEN]: [p, penalty(20)] });
    const tx = v.db.transaction("records", "readwrite");
    const store = tx.objectStore("records");
    const oldKeys: string[] = [];
    for (const r of (await req(store.getAll(prefix(1, "penalties/penalty_history")))) as RecordRow[]) {
      if (!r.data.includes('"scope":null')) continue;
      store.delete([r.account_id, r.dataset, r.rkey, r.occ]);
      store.put({ ...r, rkey: `${r.rkey}#${"0".repeat(32)}` });
      oldKeys.push(`${r.rkey}#${"0".repeat(32)}`);
    }
    await new Promise((ok) => (tx.oncomplete = ok));
    expect(oldKeys).toHaveLength(1);
    await imp({ [LOGINS]: [login(1)], [PEN]: [{ ...p, status: "EXPIRED" }, penalty(20)] });
    const keys = ((await req(v.db.transaction("records").objectStore("records").getAll(prefix(1, "penalties/penalty_history")))) as RecordRow[]).map((r) => r.rkey);
    expect(keys).toHaveLength(2); // adopted, not duplicated
    expect(keys).not.toContain(oldKeys[0]);
    await check(v);
    // A key that becomes repeated re-keys the stored one.
    await imp({ [LOGINS]: [login(9)], [PAY]: [pay("P1", 9)] });
    await imp({ [LOGINS]: [login(0.5)], [PAY]: [pay("P1", 9), pay("P1", 9, 2)] });
    await check(v);
  });

  it("is right for the account left after another is deleted", async () => {
    const a = (await imp({ [LOGINS]: [login(3), login(2)] })).account_id;
    const b = (await imp({ [LOGINS]: [login(4)], [PEN]: [penalty(6)] }, "other")).account_id;
    await v.deleteAccount(a);
    expect(await v.accountDetail(a)).toBeNull();
    expect(await datasetRows(v, a)).toEqual([]);
    await check(v, b);
  });

  it("is rebuilt on restore, from new and from older backups", async () => {
    await imp({ [LOGINS]: [login(9), login(3)], [PEN]: [penalty(5)], [PAY]: [pay("P1", 4)] });
    await imp({ [LOGINS]: [login(2)], [PEN]: [penalty(5, "EXPIRED")] }, "other");
    const doc = JSON.parse(await new Response((await v.backup()).stream().pipeThrough(new DecompressionStream("gzip"))).text());

    const restoreInto = async (stores: unknown) => {
      const other = await Vault.open(`summary-restore-${Math.random()}`);
      await other.restore(new Blob([JSON.stringify({ ...doc, stores })]));
      for (const acc of [1, 2]) {
        await check(other, acc);
        expect(await other.accountDetail(acc)).toEqual(await v.accountDetail(acc));
      }
      other.db.close();
    };
    await restoreInto(doc.stores); // a backup made by this version
    const strip = (d: DatasetRow) => ({ account_id: d.account_id, dataset: d.dataset, mode: d.mode, time_field: d.time_field });
    await restoreInto({ ...doc.stores, datasets: doc.stores.datasets.map(strip) }); // an older backup, without the summary
    await restoreInto({ ...doc.stores, datasets: doc.stores.datasets.map((d: DatasetRow) => ({ ...d, count: 999, first: "x", last: "y" })) }); // a wrong one
  });

  it("is computed and saved once for a vault written before it was kept", async () => {
    await imp({ [LOGINS]: [login(9), login(3)], [PEN]: [penalty(5)], [ODD]: [{ a: 1 }] });
    const want = await v.accountDetail(1);
    // Strip the summary, as a vault from an older version would have it.
    const tx = v.db.transaction("datasets", "readwrite");
    for (const d of (await req(tx.objectStore("datasets").getAll())) as DatasetRow[]) {
      const { count: _c, first: _f, last: _l, ...old } = d;
      tx.objectStore("datasets").put(old);
    }
    await new Promise((ok) => (tx.oncomplete = ok));
    expect((await datasetRows(v, 1)).some((d) => "count" in d)).toBe(false);
    expect(await v.accountDetail(1)).toEqual(want);
    await check(v); // written back: every list dataset has its summary again
    // And imports on top of a healed (or never-healed) vault keep it right.
    await imp({ [LOGINS]: [login(1)], [PEN]: [penalty(5, "EXPIRED")] });
    await check(v);
  });

  it("matches on the whole demo export", async () => {
    const zip = new Uint8Array(readFileSync(resolve(__dirname, "../../../test/demo-export/Demo_Player-DEMO.zip")));
    const read = () => readUploads([["Demo_Player-DEMO.zip", zip]])[0];
    await v.importExport(read());
    await check(v);
    await v.importExport(read());
    await check(v);
  });
});

describe("batched import writes", () => {
  it("a write that fails aborts the whole import and is reported", async () => {
    await imp({ [LOGINS]: [login(9), login(8)], [PEN]: [penalty(7)] });
    const before = { imports: (await v.imports()).length, detail: await v.accountDetail(1), logins: await v.records(1, "riotaccount/atlas_login_event") };
    // Make record writes fail asynchronously (add on an existing key is a ConstraintError), as a
    // full disk would: the request errors after it was queued, not when it was made.
    const proto = IDBObjectStore.prototype;
    const put = proto.put;
    proto.put = function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      return this.name === "records" ? this.add(value, key) : put.call(this, value, key);
    };
    try {
      await expect(imp({ [LOGINS]: [login(9), login(8), login(1)], [PEN]: [penalty(7, "EXPIRED")] })).rejects.toMatchObject({ name: "ConstraintError" });
    } finally {
      proto.put = put;
    }
    expect((await v.imports()).length).toBe(before.imports);
    expect(await v.accountDetail(1)).toEqual(before.detail);
    expect(await v.records(1, "riotaccount/atlas_login_event")).toEqual(before.logins);
    await check(v);
  });
});
