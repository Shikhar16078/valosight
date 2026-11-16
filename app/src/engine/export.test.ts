/**
 * End-to-end import tests on a whole Riot export (read-only): the fabricated demo player by default,
 * or a real export with RIOTVAULT_TEST_ZIP=/path/to/export.zip. The file is only read, and its hash is
 * checked afterwards.
 * Run: cd app && npm test
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prefix, req, type RecordRow } from "./db";
import { readUploads, type Export } from "./source";
import { Vault } from "./vault";

const ZIP = process.env.RIOTVAULT_TEST_ZIP || resolve(__dirname, "../../../test/demo-export/Demo_Player-DEMO.zip");
const NAME = ZIP.split("/").pop()!;

let bytes: Uint8Array;
let hash: string;
let base: Export;
let raw: Map<string, unknown>;
let v: Vault;

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const read = () => readUploads([[NAME, bytes]])[0];
const file = <T = any>(suffix: string): [string, T] => {
  const hit = [...raw].find(([p]) => p.toLowerCase().endsWith(suffix));
  if (!hit) throw new Error(`the export has no ${suffix}`);
  return hit as [string, T];
};
const count = async (ds: string, acc = 1) => (await req(v.db.transaction("records").objectStore("records").count(prefix(acc, ds)))) as number;

/** A copy of the export with some files changed. */
function variant(mutate: (files: Map<string, any>) => void, name = "variant"): Export {
  const files = new Map([...raw].map(([p, x]) => [p, structuredClone(x)]));
  mutate(files);
  return { name, files: new Map([...files].map(([p, x]) => [p, strToU8(JSON.stringify(x))])) };
}

beforeAll(() => {
  bytes = new Uint8Array(readFileSync(ZIP));
  hash = sha(bytes);
  base = read();
  const dec = new TextDecoder();
  raw = new Map([...base.files].filter(([p]) => p.endsWith(".json")).map(([p, b]) => [p, JSON.parse(dec.decode(b) || "null")]));
});
afterAll(() => {
  expect(sha(new Uint8Array(readFileSync(ZIP))), "the source export was modified!").toBe(hash);
});
beforeEach(async () => {
  v = await Vault.open(`export-${Math.random()}`);
});

describe(`a whole export (${NAME})`, () => {
  it("keeps every record on the first import", async () => {
    const r = await v.importExport(base);
    expect(r.new_account).toBe(true);
    for (const [suffix, ds] of [
      ["atlas_login_event_uc.json", "riotaccount/atlas_login_event"],
      ["account_audit_events_v2_uc.json", "riotaccount/account_audit_events_v2"],
      ["valorant_match_history_uc.json", "valorant/valorant_match_history"],
      ["valorant_payment_event_uc.json", "valorant/valorant_payment_event"],
      ["valorant_purchase_event_uc.json", "valorant/valorant_purchase_event"],
      ["penalty_history.json", "penalties/penalty_history"],
    ])
      expect(await count(ds), ds).toBe(file<unknown[]>(suffix)[1].length);
    const all = (await req(v.db.transaction("records").objectStore("records").getAll())) as RecordRow[];
    const known = new Set(["riotaccount/atlas_login_event", "riotaccount/account_audit_events_v2", "valorant/valorant_match_history", "valorant/valorant_payment_event", "valorant/valorant_purchase_event", "penalties/penalty_history"]);
    expect(all.filter((x) => known.has(x.dataset) && x.t === null)).toEqual([]);
  });

  it("adds nothing when the same export is imported again", async () => {
    await v.importExport(base);
    const r = await v.importExport(read());
    expect(r.already_imported).toBe(true);
    expect([r.totals.new, r.totals.updated]).toEqual([0, 0]);
  });

  it("merges a newer export without losing what Riot dropped, and an older one can't undo it", async () => {
    await v.importExport(base);
    const logins0 = await count("riotaccount/atlas_login_event");
    const newer = (f: Map<string, any>) => {
      const [lg, logins] = file<any[]>("atlas_login_event_uc.json");
      const later = { event_time_utc: "2026-11-01 10:00:00", event_type: "Login", ip_address: "192.0.2.77", product: "VALORANT" };
      // Riot dropped the oldest half, and the same new event appears twice in this export.
      f.set(lg, [...[...logins].sort((a, b) => (a.event_time_utc < b.event_time_utc ? -1 : 1)).slice(Math.floor(logins.length / 2)), later, later]);
      const [pay, pays] = file<any[]>("valorant_payment_event_uc.json");
      f.set(pay, [...pays, { ...pays[0], player_facing_purchase_id: "NEWID1", payment_time_utc: "2026-11-02 00:00:00" }]);
      const [pen, pens] = file<any[]>("penalty_history.json");
      f.set(pen, [{ ...pens[0], status: "CHANGED_STATUS" }, ...pens.slice(1)]);
    };
    const r = await v.importExport(variant(newer, "newer"));
    expect(r.datasets["riotaccount/atlas_login_event"].new).toBe(2);
    expect(await count("riotaccount/atlas_login_event")).toBe(logins0 + 2); // the dropped half is kept
    expect(r.datasets["valorant/valorant_payment_event"].new).toBe(1);
    expect(r.datasets["penalties/penalty_history"].updated).toBe(1);

    const again = await v.importExport(variant(newer, "newer"));
    expect(again.totals.new + again.totals.updated).toBe(0);
    const older = await v.importExport(read());
    expect(older.totals.new + older.totals.updated).toBe(0);
    expect((await v.records(1, "penalties/penalty_history")).map((x) => x.status)).toContain("CHANGED_STATUS");
  });

  it("keeps a second account and a game it has never seen apart", async () => {
    await v.importExport(base);
    const other = (f: Map<string, any>) => {
      const [ai, info] = file<Record<string, unknown>>("account_info.json");
      f.set(ai, { ...info, username: "someoneelse", game_name: "Other", tagline: "EUW" });
      f.set("leagueoflegends/lol_match_history_uc.json", [
        { match_id: "A", game_start_time: "2025-01-01T10:00:00Z", champion: "Ahri" },
        { match_id: "B", game_start_time: "2025-01-02T10:00:00Z", champion: "Lux" },
      ]);
    };
    const r = await v.importExport(variant(other, "other"));
    expect(r.new_account).toBe(true);
    expect(await v.accounts()).toHaveLength(2);
    const recs = await v.records(r.account_id, "leagueoflegends/lol_match_history");
    expect(recs.map((x) => x.champion)).toEqual(["Ahri", "Lux"]);
    expect(recs[0]._t?.startsWith("2025-01-01T10:00")).toBe(true);
  });

  it("finds two exports inside one zip", async () => {
    const files: Record<string, Uint8Array> = {};
    for (const [p, b] of base.files) {
      files[`A/${p}`] = b;
      files[`B/${p}`] = p.endsWith("account_info.json") ? strToU8(JSON.stringify({ ...file("account_info.json")[1], username: "second" })) : b;
    }
    const exps = readUploads([["bundle.zip", zipSync(files)]]);
    expect(exps).toHaveLength(2);
    for (const e of exps) await v.importExport(e);
    expect(await v.accounts()).toHaveLength(2);
  });
});
