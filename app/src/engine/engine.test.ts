/**
 * In-browser engine tests on small synthetic exports: no real Riot data needed.
 * Whole-export tests are in export.test.ts.
 * Run: cd app && npm test
 */
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseTime } from "./datasets";
import { prefix, req, type RecordRow } from "./db";
import * as fx from "./fx";
import { LIMITS, SourceError, contentHash, readUploads, type Export } from "./source";
import { Vault } from "./vault";

const INFO = "riotAccount/account_info.json";
const LOGINS = "riotAccount/atlas_login_event_uc.json";
const PEN = "penalties/penalty_history.json";
const PAY = "valorant/valorant_payment_event_uc.json";

/** A Riot-style UTC timestamp `days` before now (always in the past, so it counts toward the watermark). */
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
const login = (days: number, ip = "10.0.0.1", kind = "Login", extra: object = {}) => ({ event_time_utc: ago(days), event_type: kind, ip_address: ip, product: "VALORANT", ...extra });
const penalty = (days: number, status = "ACTIVE", scope: string | null = "VALORANT") => ({ date_issued: ago(days), restriction_type: "CHAT_RESTRICTION", restriction_reason: "Toxicity", scope, status });

const bytes = (v: unknown) => (v instanceof Uint8Array ? v : strToU8(JSON.stringify(v)));

/** Build an Export from {path: json-able}; account_info is added unless given. */
function exp(files: Record<string, unknown> = {}, username = "tester", name = "exp"): Export {
  const all: Record<string, unknown> = { [INFO]: { username, game_name: "Tester", tagline: "T1" }, ...files };
  return { name, files: new Map(Object.entries(all).map(([p, v]) => [p, bytes(v)])) };
}

const zip = (files: Record<string, unknown>) => zipSync(Object.fromEntries(Object.entries(files).map(([p, v]) => [p, bytes(v)])));

let v: Vault;
let n = 0;
beforeEach(async () => {
  v = await Vault.open(`test-${++n}`);
});
afterEach(() => v.db.close());

const imp = (files: Record<string, unknown>, username?: string) => v.importExport(exp(files, username));

/** Stored records of one dataset, ordered by time, then key. */
async function rows(ds: string, acc = 1) {
  const all = (await req(v.db.transaction("records").objectStore("records").getAll(prefix(acc, ds)))) as RecordRow[];
  all.sort((a, b) => ((a.t ?? "") < (b.t ?? "") ? -1 : (a.t ?? "") > (b.t ?? "") ? 1 : a.rkey < b.rkey ? -1 : 1));
  return all.map((r) => JSON.parse(r.data));
}
const count = async (store: string) => req(v.db.transaction(store).objectStore(store).count());

describe("merge", () => {
  it("re-import adds nothing and no extra snapshots", async () => {
    const files = { [LOGINS]: [login(5), login(4)], [PEN]: [penalty(3)] };
    await imp(files);
    const r = await imp(files);
    expect(r.already_imported).toBe(true);
    expect(r.totals.new + r.totals.updated).toBe(0);
    expect(await count("snapshots")).toBe(1);
  });

  it("newer export merges and older does not revert", async () => {
    const old = { [LOGINS]: [login(10), login(9)], [PEN]: [penalty(8)] };
    const neu = { [LOGINS]: [login(9), login(1), login(1)], [PEN]: [penalty(8, "EXPIRED")] }; // oldest dropped, one repeated
    await imp(old);
    const r = await imp(neu);
    expect(r.datasets["riotaccount/atlas_login_event"].new).toBe(2);
    expect(await rows("riotaccount/atlas_login_event")).toHaveLength(4); // the dropped one is kept
    expect(r.datasets["penalties/penalty_history"].updated).toBe(1);
    await imp(old);
    expect((await rows("penalties/penalty_history")).map((p) => p.status)).toEqual(["EXPIRED"]);
  });

  it("equal watermark updates but re-import does not revert", async () => {
    const t = login(5); // no new logins between the two exports, only a penalty status change
    const older = { [LOGINS]: [t], [PEN]: [penalty(8, "ACTIVE")] };
    await imp(older);
    await imp({ [LOGINS]: [t], [PEN]: [penalty(8, "EXPIRED")] });
    await imp(older);
    expect((await rows("penalties/penalty_history")).map((p) => p.status)).toEqual(["EXPIRED"]);
  });

  it("a future date in another file does not freeze updates", async () => {
    await imp({ [LOGINS]: [login(9)], [PEN]: [penalty(8)], "other/promo.json": [{ expiry_date: "2099-01-01 00:00:00", id: 1 }] });
    const r = await imp({ [LOGINS]: [login(9), login(1)], [PEN]: [penalty(8, "EXPIRED")] });
    expect(r.datasets["penalties/penalty_history"].updated).toBe(1);
    expect(r.watermark! < "2099").toBe(true);
  });

  it("an export without dates never overrides", async () => {
    await imp({ [LOGINS]: [login(9)], "other/thing.json": [{ id: 1, v: "a" }] });
    const r = await imp({ "other/thing.json": [{ id: 1, v: "b" }] });
    expect(r.watermark).toBeNull();
    expect(r.totals.updated).toBe(0);
  });

  it("a blank key field updates in place", async () => {
    await imp({ [LOGINS]: [login(9)], [PEN]: [penalty(8, "ACTIVE", null)] });
    await imp({ [LOGINS]: [login(1)], [PEN]: [penalty(8, "EXPIRED", null)] });
    expect((await rows("penalties/penalty_history")).map((p) => p.status)).toEqual(["EXPIRED"]);
  });

  it("rows keyed by older app versions are adopted", async () => {
    // Older versions gave a blank key field "<key>#<hash>"; simulate a vault written that way.
    const p = penalty(8, "ACTIVE", null);
    await imp({ [LOGINS]: [login(9)], [PEN]: [p] });
    const tx = v.db.transaction("records", "readwrite");
    const store = tx.objectStore("records");
    for (const r of (await req(store.getAll(prefix(1, "penalties/penalty_history")))) as RecordRow[]) {
      store.delete([r.account_id, r.dataset, r.rkey, r.occ]);
      store.put({ ...r, rkey: `${r.rkey}#${"0".repeat(32)}` });
    }
    await new Promise((ok) => (tx.oncomplete = ok));
    await imp({ [LOGINS]: [login(1)], [PEN]: [{ ...p, status: "EXPIRED" }] });
    expect((await rows("penalties/penalty_history")).map((x) => x.status)).toEqual(["EXPIRED"]);
  });

  it("a key that becomes repeated does not orphan", async () => {
    const pay = { player_facing_purchase_id: "P1", payment_time_utc: ago(9), amount: 1 };
    await imp({ [LOGINS]: [login(9)], [PAY]: [pay] });
    await imp({ [LOGINS]: [login(1)], [PAY]: [pay, { ...pay, amount: 2 }] });
    expect((await rows("valorant/valorant_payment_event")).map((x) => x.amount).sort()).toEqual([1, 2]);
  });

  it("a new field in login events updates, not duplicates", async () => {
    const a = login(9), b = login(8);
    await imp({ [LOGINS]: [a, b] });
    const r = await imp({ [LOGINS]: [{ ...a, country: "XX" }, { ...b, country: "XX" }, login(1)] });
    expect(r.datasets["riotaccount/atlas_login_event"].new).toBe(1);
    expect(await rows("riotaccount/atlas_login_event")).toHaveLength(3);
  });

  it("a repeated event in one export is kept and reordering is stable", async () => {
    const a = login(9), b = login(8);
    await imp({ [LOGINS]: [a, a, b] });
    const r = await imp({ [LOGINS]: [b, a, a] });
    expect(r.totals.new).toBe(0);
    expect(await rows("riotaccount/atlas_login_event")).toHaveLength(3);
  });

  it("a second account and an unknown dataset", async () => {
    await imp({ [LOGINS]: [login(3)] });
    const r = await v.importExport(
      exp(
        {
          "leagueoflegends/lol_match_history_uc.json": [
            { match_id: "A", game_start_time: "2025-01-01T10:00:00Z", playtime_seconds: 1500000000 },
            { match_id: "B", game_start_time: "2025-01-02T10:00:00Z", playtime_seconds: 1500000001 },
          ],
        },
        "someoneelse",
        "b",
      ),
    );
    expect(r.new_account).toBe(true);
    const recs = await v.records(r.account_id, "leagueoflegends/lol_match_history");
    expect(recs.map((x) => x.match_id)).toEqual(["A", "B"]);
    expect(String(recs[0]._t).startsWith("2025-01-01T10:00")).toBe(true); // not the duration field
  });

  it("username case and fallbacks", async () => {
    await imp({ [LOGINS]: [login(3)] }, "Tester");
    expect((await imp({ [LOGINS]: [login(2)] }, "tester")).new_account).toBe(false);
    const solo = await v.importExport({ name: "x", files: new Map([[INFO, bytes({ game_name: "Solo" })]]) });
    expect(solo.username).toBe("Solo");
    await expect(v.importExport({ name: "x", files: new Map([[INFO, strToU8('{"username": "   "}')]]) })).rejects.toThrow();
  });

  it("malformed files are skipped, not fatal", async () => {
    const deep = strToU8("[".repeat(100_000) + "]".repeat(100_000));
    const r = await imp({
      [LOGINS]: [login(3)],
      "x/scalar.json": strToU8("42"),
      "x/bool.json": strToU8("true"),
      "x/str.json": strToU8('"hello"'),
      "x/nan.json": strToU8('[{"v": NaN, "t": 1}]'),
      "x/deep.json": deep,
      "x/bom.json": new Uint8Array([0xef, 0xbb, 0xbf, ...strToU8('[{"a": 1}]')]),
      "x/bad.json": strToU8("{nope"),
    });
    expect((await v.records(1, "x/nan"))[0].v).toBeNull();
    expect(r.datasets["x/str"].mode).toBe("snapshot");
    expect(await v.records(1, "x/bom")).toHaveLength(1);
    const reasons = Object.fromEntries(r.skipped.map((s) => [s.file, s.reason]));
    expect(reasons).toHaveProperty(["x/bad.json"]);
    expect(reasons).toHaveProperty(["x/deep.json"]);
  });

  it("delete removes one account only", async () => {
    const a = (await imp({ [LOGINS]: [login(3)] })).account_id;
    const b = (await imp({ [LOGINS]: [login(3)] }, "other")).account_id;
    await v.setAnnotations(a, "ip", { "10.0.0.1": "mine" });
    await v.deleteAccount(a);
    expect(await v.exists(a)).toBe(false);
    for (const s of ["records", "snapshots", "datasets", "annotations"]) {
      const left = await req(v.db.transaction(s).objectStore(s).count(prefix(a)));
      expect(left, s).toBe(0);
    }
    expect((await v.imports()).every((i) => i.account_id === b)).toBe(true);
    expect(await v.records(b, "riotaccount/atlas_login_event")).toHaveLength(1);
  });

  it("reads have the shape the app expects", async () => {
    await imp({ [LOGINS]: [login(3), login(2)], [PEN]: [penalty(5)] });
    const [a] = await v.accounts();
    expect(a).toMatchObject({ id: 1, username: "tester", game_name: "Tester", tagline: "T1" });
    expect(a.data_until).toBeTruthy();
    const d = (await v.accountDetail(1))!;
    const logins = d.datasets.find((x) => x.dataset === "riotaccount/atlas_login_event")!;
    expect(logins).toMatchObject({ mode: "multiset", count: 2, known: true, label: "Login events" });
    expect(logins.first! < logins.last!).toBe(true);
    expect((d.snapshots["riotaccount/account_info"] as { username: string }).username).toBe("tester");
    const recs = await v.records(1, "riotaccount/atlas_login_event");
    expect(recs[0]._t! < recs[1]._t!).toBe(true);
    expect(recs[0]._import).toBe(1);
  });
});

describe("settings, annotations, backup", () => {
  it("annotations: set, bulk, remove, validate", async () => {
    await imp({ [LOGINS]: [login(3)] });
    await v.setAnnotations(1, "ip", { "1.2.3.4": "mine", "5.6.7.8": "not-me" });
    await v.setAnnotations(1, "ip", { "1.2.3.4": null });
    expect(await v.annotations(1, "ip")).toEqual({ "5.6.7.8": "not-me" });
    await expect(v.setAnnotations(1, "ip", { k: { a: 1 } })).rejects.toThrow(/text/);
  });

  it("settings round-trip", async () => {
    expect(await v.setSettings({ theme: "nebula", homeCurrencies: ["INR", "USD"] })).toEqual({ theme: "nebula", homeCurrencies: ["INR", "USD"] });
  });

  it("backup and restore move the whole vault", async () => {
    await imp({ [LOGINS]: [login(3)], [PEN]: [penalty(5)] });
    await v.setSettings({ theme: "nebula" });
    await v.setAnnotations(1, "ip", { "10.0.0.1": "mine" });
    const file = await v.backup();
    const other = await Vault.open(`test-restore-${n}`);
    await other.setSettings({ theme: "paper" });
    expect(await other.restore(file)).toEqual({ accounts: 1 });
    expect(await other.settings()).toEqual({ theme: "nebula" });
    expect(await other.annotations(1, "ip")).toEqual({ "10.0.0.1": "mine" });
    expect(await other.records(1, "riotaccount/atlas_login_event")).toEqual(await v.records(1, "riotaccount/atlas_login_event"));
    const again = await other.importExport(exp({ [LOGINS]: [login(3)], [PEN]: [penalty(5)] }));
    expect(again.account_id).toBe(1); // ids carry over, so the next import still merges
    other.db.close();
  });

  it("restore refuses other files and leaves the vault alone", async () => {
    await imp({ [LOGINS]: [login(3)] });
    await expect(v.restore(new Blob(["hello"]))).rejects.toThrow(/isn't a Valosight backup/);
    const broken = new Blob([JSON.stringify({ format: "valosight-vault", version: 1, stores: { accounts: [{ nope: 1 }] } })]);
    await expect(v.restore(broken)).rejects.toThrow(/damaged. Your vault was not changed/);
    expect(await v.accounts()).toHaveLength(1);
  });
});

describe("time parsing", () => {
  it("formats", () => {
    expect(parseTime("2024-05-01 10:00:00")).toBe("2024-05-01T10:00:00.000Z");
    expect(parseTime("2024-05-01T10:00:00z")).toBe("2024-05-01T10:00:00.000Z");
    expect(parseTime("2024-05-01T10:00:00+05")).toBe("2024-05-01T05:00:00.000Z");
    expect(parseTime("2024-05-01T10:00:00+05:30")).toBe("2024-05-01T04:30:00.000Z");
    expect(parseTime("1714557600.5")).toBe("2024-05-01T10:00:00.500Z");
    expect(parseTime(1714557600000)).toBe("2024-05-01T10:00:00.000Z");
    expect(parseTime(1714557600000000000)).toBe("2024-05-01T10:00:00.000Z");
    expect(parseTime("not a date")).toBeNull();
    expect(parseTime("2024-02-30")).toBeNull();
    expect(parseTime(true)).toBeNull();
  });
});

describe("source", () => {
  it("zip and extracted folder agree", async () => {
    const files = { [`Exp/${INFO}`]: { username: "u" }, [`Exp/${LOGINS}`]: [login(3)], "Exp/notes.txt": strToU8("ignored") };
    const fromZip = readUploads([["Exp.zip", zip(files)]])[0];
    const fromDir = readUploads(Object.entries(files).map(([p, b]) => [p, bytes(b)]))[0];
    expect(await contentHash(fromZip)).toBe(await contentHash(fromDir));
    expect([...fromZip.files.keys()].join(" ")).not.toContain("notes.txt");
    expect(fromZip.name).toBe("Exp");
  });

  it("two exports in one zip, and zips in a folder", () => {
    expect(readUploads([["bundle.zip", zip({ [`A/${INFO}`]: { username: "a" }, [`B/${INFO}`]: { username: "b" } })]])).toHaveLength(2);
    const inner = ["x", "y"].map((u) => zip({ [INFO]: { username: u } }));
    expect(readUploads([["d/x.zip", inner[0]], ["d/y.zip", inner[1]]])).toHaveLength(2);
  });

  it("rejects non-exports", () => {
    expect(() => readUploads([["x.zip", strToU8("not a zip")]])).toThrow(SourceError);
    expect(() => readUploads([["notes/readme.txt", strToU8("hi")]])).toThrow(SourceError);
  });

  it("unsafe paths are dropped", () => {
    const z = zip({ [INFO]: { username: "u" }, "../evil.json": [1], "/abs/evil2.json": [1], "__MACOSX/x.json": [1], "a\\..\\..\\evil3.json": [1] });
    const names = [...readUploads([["e.zip", z]])[0].files.keys()].join(" ");
    expect(names).not.toContain("..");
    expect(names.toLowerCase()).not.toContain("macosx");
  });

  it("a zip bomb is refused", () => {
    const z = zip({ [INFO]: { username: "u" }, "bomb.json": strToU8("0".repeat(20 * 1024 ** 2)) });
    expect(() => readUploads([["bomb.zip", z]])).toThrow(/zip bomb/);
  });

  it("total size limit", () => {
    const old = LIMITS.total;
    LIMITS.total = 1000;
    try {
      expect(() => readUploads([[`e/${INFO}`, strToU8('{"username": "u"}')], ["e/big.json", strToU8("[" + "1,".repeat(1000) + "1]")]])).toThrow(SourceError);
    } finally {
      LIMITS.total = old;
    }
  });
});

describe("exchange rates", () => {
  const today = new Date().toISOString().slice(0, 10);
  let calls: string[];
  const fake: fx.Getter = async (url) => {
    calls.push(url);
    if (url.includes("open.er-api")) return { result: "success", time_last_update_unix: 1794700952, rates: { AED: 0.0575 } };
    const want = new Set(url.split("symbols=")[1].split(",")); // answer only what was asked for, like the real API
    const pick = (rs: Record<string, number>) => Object.fromEntries(Object.entries(rs).filter(([q]) => want.has(q)));
    if (url.includes("/latest")) return { date: today, rates: pick({ INR: 1.48, USD: 0.0157 }) };
    return { rates: { "2024-01-05": pick({ INR: 1.49, USD: 0.018 }), [today]: pick({ INR: 1.48, USD: 0.0157 }) } };
  };
  beforeEach(() => {
    calls = [];
  });

  it("downloads once, then uses the cache", async () => {
    const todo = await fx.plan(v.db, ["PHP"], ["INR", "USD", "AED"], "2024-01-05");
    expect(todo.daily).toEqual([["PHP", ["INR", "USD"], "2024-01-05"]]); // AED isn't an ECB currency
    const { rows, latest, errors } = await fx.download(todo, fake);
    await fx.store(v.db, rows, latest);
    expect(errors).toEqual([]);
    const r = await fx.rates(v.db, ["PHP"], ["INR", "USD", "AED"]);
    expect(r.daily.PHP.INR[0]).toEqual(["2024-01-05", 1.49]);
    expect(r.latest.PHP.AED.source).toBe("open.er-api.com");
    expect(await fx.plan(v.db, ["PHP"], ["INR", "USD", "AED"], "2024-01-05")).toEqual({ daily: [], latest: [] });
  });

  it("a currency added later gets its own history", async () => {
    const first = await fx.download(await fx.plan(v.db, ["PHP"], ["INR"], "2024-01-05"), fake);
    await fx.store(v.db, first.rows, first.latest);
    expect((await fx.plan(v.db, ["PHP"], ["INR", "USD"], "2024-01-05")).daily).toEqual([["PHP", ["USD"], "2024-01-05"]]);
  });

  it("codes are validated", () => {
    expect(fx.cleanCodes(["php", "INR", "../x", "TOOLONG", null])).toEqual(["INR", "PHP"]);
  });

  it("a network failure is reported, not thrown", async () => {
    const down: fx.Getter = async () => {
      throw new fx.FxError("offline");
    };
    const r = await fx.download(await fx.plan(v.db, ["PHP"], ["INR"], "2024-01-05"), down);
    expect([r.rows, r.latest]).toEqual([[], []]);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("sync validates its input", async () => {
    const live = (todo: fx.Plan) => fx.download(todo, fake);
    await expect(fx.sync(v.db, { bases: [], quotes: ["INR"] }, live)).rejects.toThrow(fx.FxError);
    const r = await fx.sync(v.db, { bases: ["PHP"], quotes: ["INR"], start: "1990-01-01" }, live);
    expect(r.days).toBeGreaterThan(0);
    expect(calls[0]).toContain("1999-01-04..");
  });
});

describe("exchange rates from the published files", () => {
  const today = new Date().toISOString().slice(0, 10);
  const year = Number(today.slice(0, 4));
  const files: Record<string, unknown> = {
    [`/rates/ecb/${year - 1}.json`]: { base: "EUR", rates: { [`${year - 1}-06-03`]: { PHP: 60, INR: 90, USD: 1.1 } } },
    [`/rates/ecb/${year}.json`]: { base: "EUR", rates: { [`${year}-01-02`]: { PHP: 64, INR: 96, USD: 1.2 } } },
    "/rates/latest.json": {
      ecb: { base: "EUR", date: today, rates: { PHP: 65, INR: 97.5, USD: 1.25 } },
      other: { base: "USD", date: today, rates: { PHP: 52, AED: 3.67 } },
    },
  };
  let asked: string[];
  const site: fx.JsonGet = async (path) => {
    asked.push(path);
    if (!(path in files)) throw new fx.FxError(`missing ${path}`);
    return files[path];
  };
  beforeEach(() => {
    asked = [];
  });

  it("computes cross rates from the EUR and USD tables", async () => {
    const todo = await fx.plan(v.db, ["PHP"], ["INR", "EUR", "AED"], `${year - 1}-06-01`);
    const r = await fx.downloadStatic(todo, site);
    expect(r.errors).toEqual([]);
    expect(r.rows).toContainEqual({ base: "PHP", quote: "INR", day: `${year - 1}-06-03`, rate: 1.5 });
    expect(r.rows).toContainEqual({ base: "PHP", quote: "EUR", day: `${year}-01-02`, rate: 0.015625 });
    expect(r.latest.find((x) => x.quote === "INR")).toMatchObject({ rate: 1.5, source: "ECB via frankfurter.dev" });
    expect(r.latest.find((x) => x.quote === "AED")).toMatchObject({ rate: Number((3.67 / 52).toPrecision(8)), source: "open.er-api.com" });
    expect(asked.every((p) => p.startsWith("/rates/"))).toBe(true); // only our own site, never a third party
  });

  it("sync stores them and asks only for what is missing", async () => {
    const res = await fx.sync(v.db, { bases: ["PHP"], quotes: ["INR"], start: `${year - 1}-06-01` }, (t) => fx.downloadStatic(t, site));
    expect(res).toMatchObject({ days: 2, latest: 1, errors: [] });
    expect((await fx.rates(v.db, ["PHP"], ["INR"])).daily.PHP.INR).toEqual([[`${year - 1}-06-03`, 1.5], [`${year}-01-02`, 1.5]]);
  });

  it("a missing file is reported, not thrown", async () => {
    const r = await fx.downloadStatic(await fx.plan(v.db, ["PHP"], ["INR"], "2001-01-01"), site);
    expect(r.errors.some((e) => e.includes("/rates/ecb/2001.json"))).toBe(true);
  });
});
