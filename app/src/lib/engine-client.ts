/** Talks to the in-browser engine (src/engine/worker.ts). Only loaded by the web build. */

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

function start(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL("../engine/worker.ts", import.meta.url), { type: "module", name: "valosight-engine" });
  w.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve(e.data.result);
    else p.reject(new Error(e.data.error));
  };
  w.onerror = (e) => {
    const err = new Error(`The Valosight engine stopped: ${e.message || "unknown error"}. Reload the page to restart it.`);
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    worker = null;
  };
  return (worker = w);
}

export function call<T>(method: string, args: unknown[] = [], transfer: Transferable[] = []): Promise<T> {
  const w = start();
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, method, args }, transfer);
  });
}

/** Ask the browser not to clear the vault when the device runs low on space. */
export async function persist(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function storageInfo(): Promise<{ persisted: boolean; usage: number | null; quota: number | null }> {
  try {
    const [persisted, est] = await Promise.all([navigator.storage?.persisted?.() ?? false, navigator.storage?.estimate?.()]);
    return { persisted: !!persisted, usage: est?.usage ?? null, quota: est?.quota ?? null };
  } catch {
    return { persisted: false, usage: null, quota: null };
  }
}
