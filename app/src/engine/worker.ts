/**
 * Runs the engine off the main thread, so reading a large export never freezes the page.
 * The dashboard talks to it through engine-client.ts with {id, method, args} messages.
 */
import * as fx from "./fx";
import { SourceError, readUploadsAsync } from "./source";
import { Vault, VaultError } from "./vault";

/** This worker's global scope (typed as a Worker: same postMessage/onmessage shape, without the webworker lib). */
const scope = self as unknown as Worker;
let vault: Promise<Vault> | null = null;
const open = () => (vault ??= Vault.open().catch((e) => {
  vault = null;
  throw new Error(`This browser won't let Valosight store data (${(e as Error)?.message ?? "storage unavailable"}). Private windows often block it.`);
}));

const num = (v: unknown) => Number(v);

type Handler = (v: Vault, ...args: any[]) => unknown;
const handlers: Record<string, Handler> = {
  accounts: (v) => v.accounts(),
  account: async (v, acc) => (await v.need(num(acc)), v.accountDetail(num(acc))),
  records: async (v, acc, ds) => (await v.need(num(acc)), v.records(num(acc), String(ds))),
  snapshots: async (v, acc, ds) => (await v.need(num(acc)), v.snapshotHistory(num(acc), String(ds))),
  deleteAccount: async (v, acc) => {
    await v.need(num(acc));
    await v.deleteAccount(num(acc));
    return { ok: true };
  },
  annotations: async (v, acc, kind) => (await v.need(num(acc)), v.annotations(num(acc), String(kind))),
  setAnnotations: async (v, acc, kind, items) => {
    await v.need(num(acc));
    if (!items || typeof items !== "object") throw new VaultError('Expected {"items": {key: value}}');
    await v.setAnnotations(num(acc), String(kind), items);
    return { ok: true };
  },
  imports: (v) => v.imports(),
  import: async (v, items: [string, ArrayBuffer][], password?: unknown) => {
    // The password (for a protected zip) is only used here, in memory, and never stored.
    const exports = await readUploadsAsync(
      items.map(([n, b]) => [n, new Uint8Array(b)]),
      typeof password === "string" && password ? password : undefined,
    );
    const out = [];
    for (const e of exports) out.push(await v.importExport(e));
    return out;
  },
  settings: (v) => v.settings(),
  saveSettings: (v, s) => v.setSettings(s ?? {}),
  fx: (v, bases, quotes) => fx.rates(v.db, fx.cleanCodes(bases), fx.cleanCodes(quotes)),
  fxSync: (v, body) => fx.sync(v.db, body ?? {}),
  backup: (v) => v.backup(),
  restore: (v, file: Blob) => v.restore(file),
};

scope.onmessage = async (e: MessageEvent<{ id: number; method: string; args: unknown[] }>) => {
  const { id, method, args } = e.data;
  try {
    const h = handlers[method];
    if (!h) throw new Error(`Unknown request: ${method}`);
    const result = await h(await open(), ...(args ?? []));
    scope.postMessage({ id, ok: true, result });
  } catch (err) {
    const known = err instanceof VaultError || err instanceof SourceError || err instanceof fx.FxError;
    const message = err instanceof Error ? err.message : String(err);
    scope.postMessage({ id, ok: false, error: known ? message : `Something went wrong: ${message}` });
    if (!known) console.error(err);
  }
};
