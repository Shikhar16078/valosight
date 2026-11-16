import { AnimatePresence, motion } from "motion/react";
import { Sens, usePrivacy } from "../lib/privacy";
import { SOFT } from "../components/anim";
import { CheckCircle2, FileArchive, FolderOpen, KeyRound, Loader2, OctagonAlert, UploadCloud, WifiOff, XCircle } from "lucide-react";
import { useOffline } from "../lib/pwa";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { useAccount } from "../lib/account";
import { api, type ImportInfo, type ImportResult } from "../lib/api";
import { useSettings } from "../lib/settings";
import { titleCase } from "../lib/valorant";
import { Badge, Card, Page } from "../components/ui";

type State = { kind: "password"; files: { name: string; file: File }[]; label: string; wrong: boolean } | { kind: "idle" } | { kind: "uploading"; p: number; label: string } | { kind: "working"; label: string } | { kind: "done"; results: ImportResult[] } | { kind: "error"; msg: string };

async function filesFromDrop(e: DragEvent): Promise<{ name: string; file: File }[]> {
  const out: { name: string; file: File }[] = [];
  const walk = async (entry: any, path: string): Promise<void> => {
    if (entry.isFile) {
      const file: File = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ name: path + file.name, file });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch: any[];
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const b of batch) await walk(b, `${path}${entry.name}/`);
      } while (batch.length);
    }
  };
  const items = [...e.dataTransfer.items].map((i) => (i as any).webkitGetAsEntry?.()).filter(Boolean);
  if (items.length) for (const it of items) await walk(it, "");
  else for (const f of [...e.dataTransfer.files]) out.push({ name: f.name, file: f });
  return out;
}

export function Imports({ onImported }: { onImported: (accountId: number) => void }) {
  const { refresh } = useAccount();
  const { f } = useSettings();
  const pv = usePrivacy();
  const [state, setState] = useState<State>({ kind: "idle" });
  const [history, setHistory] = useState<ImportInfo[]>([]);
  const [drag, setDrag] = useState(false);
  const zipRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);

  const offline = useOffline();
  const loadHistory = () => api.imports().then(setHistory).catch(() => {});
  useEffect(() => {
    loadHistory();
  }, []);

  const busy = useRef(false);
  const run = async (files: { name: string; file: File }[], password?: string) => {
    files = files.filter((x) => !/(^|\/)(\.DS_Store|__MACOSX)/.test(x.name));
    // One import at a time: a second drop or a repeated change event while one runs is ignored.
    if (!files.length || busy.current) return;
    busy.current = true;
    const label = files.length === 1 ? files[0].name : `${files.length} files`;
    setState({ kind: "uploading", p: 0, label });
    try {
      const results = await api.upload(files, (p) => setState(p < 1 ? { kind: "uploading", p, label } : { kind: "working", label }), password);
      pv.setHidden(true); // a fresh import starts private
      setState({ kind: "done", results });
      await refresh();
      loadHistory();
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      // A password-protected zip: ask for its password and try again with the same files.
      if (/^PASSWORD_(REQUIRED|WRONG)/.test(msg)) setState({ kind: "password", files, label, wrong: msg.startsWith("PASSWORD_WRONG") });
      else setState({ kind: "error", msg });
    } finally {
      busy.current = false;
    }
  };

  return (
    <Page code="07 / Import" title="Import a Riot export" sub="Drop the .zip Riot emailed you, or its extracted folder. Re-importing is always safe — only new records are added.">
      <Card span={12} pad={false}>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setDrag(false);
            run(await filesFromDrop(e));
          }}
          className={`m-4 flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors ${drag ? "border-accent bg-accent-soft" : "border-line-strong"}`}
        >
          <AnimatePresence mode="wait">
            {state.kind === "uploading" || state.kind === "working" ? (
              <motion.div key="busy" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, transition: { duration: SOFT.out } }} transition={{ duration: SOFT.in, ease: SOFT.ease }} className="w-full max-w-md">
                <Loader2 className="mx-auto animate-spin text-accent" size={34} />
                <div className="mt-3 font-display text-lg font-semibold">{state.kind === "uploading" ? "Reading files…" : "Sorting, de-duplicating & merging…"}</div>
                <div className="mt-1 truncate text-muted">{state.label}</div>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-panel-2">
                  {state.kind === "uploading" ? (
                    <div className="h-full bg-accent transition-[width] duration-300 ease-out" style={{ width: `${state.p * 100}%` }} />
                  ) : (
                    <motion.div className="h-full w-1/3 bg-accent" animate={{ x: ["-100%", "300%"] }} transition={{ repeat: Infinity, duration: 1.1, ease: "easeInOut" }} />
                  )}
                </div>
              </motion.div>
            ) : (
              <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: SOFT.out } }} transition={{ duration: SOFT.in, ease: SOFT.ease }}>
                <UploadCloud className="mx-auto text-accent" size={40} />
                <div className="mt-3 font-display text-xl font-semibold">Drop your Riot data export here</div>
                <div className="mt-1 text-muted">A .zip file, an extracted folder, or a folder holding several accounts' exports</div>
                <div className="mt-5 flex flex-wrap justify-center gap-3">
                  <button onClick={() => zipRef.current?.click()} className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 font-medium text-white hover:brightness-110">
                    <FileArchive size={16} /> Choose .zip
                  </button>
                  <button onClick={() => dirRef.current?.click()} className="flex items-center gap-2 rounded-lg border border-line-strong px-4 py-2 font-medium hover:bg-panel-2">
                    <FolderOpen size={16} /> Choose folder
                  </button>
                </div>
                <div className="mt-4 text-[12.5px] text-faint">Files stay on this device. Your original zip/folder is only read, never changed.</div>
                {offline === "ready" && (
                  <div className="mt-1.5 inline-flex items-center gap-1.5 text-[12.5px] text-win">
                    <WifiOff size={13} /> Ready offline: you can disconnect from the internet before importing.
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
          <input
            ref={zipRef}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(e) => {
              const fl = [...(e.target.files ?? [])];
              e.target.value = "";
              run(fl.map((file) => ({ name: file.name, file })));
            }}
          />
          <input
            ref={dirRef}
            type="file"
            hidden
            {...({ webkitdirectory: "", directory: "" } as any)}
            onChange={(e) => {
              const fl = [...(e.target.files ?? [])];
              e.target.value = "";
              run(fl.map((file) => ({ name: (file as any).webkitRelativePath || file.name, file })));
            }}
          />
        </div>
      </Card>

      <NotABackup />

      <AnimatePresence>
        {state.kind === "password" && <PasswordPrompt key="password" label={state.label} wrong={state.wrong} onSubmit={(pw) => run(state.files, pw)} onCancel={() => setState({ kind: "idle" })} />}
        {state.kind === "error" && (
          <motion.div key="error" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: SOFT.out } }} transition={{ duration: SOFT.in, ease: SOFT.ease }} className="panel col-span-12 flex items-start gap-3 border-accent/40 bg-accent-soft p-5">
            <XCircle className="mt-0.5 shrink-0 text-accent" />
            <div>
              <div className="font-semibold">That didn't import</div>
              <div className="text-muted">{state.msg}</div>
            </div>
          </motion.div>
        )}
        {state.kind === "done" &&
          state.results.map((r) => (
            <motion.div key={r.import_id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: SOFT.out } }} transition={{ duration: SOFT.in, ease: SOFT.ease }} className="panel corner col-span-12 p-5">
              <div className="flex flex-wrap items-center gap-3">
                <CheckCircle2 className="text-win" />
                <div className="font-display text-xl font-semibold"><Sens>{pv.name(r.username)}</Sens></div>
                {r.new_account ? <Badge tone="info">new account added</Badge> : <Badge>existing account updated</Badge>}
                {r.already_imported && <Badge tone="warn">this exact export was imported before</Badge>}
                <button onClick={() => onImported(r.account_id)} className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white">
                  Open dashboard →
                </button>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 sm:max-w-lg">
                {[
                  { k: "new", label: "New records", tone: "text-win" },
                  { k: "updated", label: "Updated", tone: "text-warn" },
                  { k: "existing", label: "Already had", tone: "text-muted" },
                ].map((x, i) => (
                  <motion.div key={x.k} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.08 }} className="rounded-lg bg-panel-2 px-3 py-2">
                    <div className={`num text-2xl ${x.tone}`}>{(r.totals as any)[x.k].toLocaleString("en")}</div>
                    <div className="text-[12px] text-muted">{x.label}</div>
                  </motion.div>
                ))}
              </div>
              <details className="mt-4">
                <summary className="cursor-pointer text-[13px] text-muted">Per file</summary>
                <table className="mt-2 w-full text-[13px]">
                  <tbody>
                    {Object.entries(r.datasets ?? {}).map(([ds, s]) => (
                      <tr key={ds} className="border-b border-line last:border-0">
                        <td className="py-1.5">{titleCase(ds.split("/")[1])}</td>
                        <td className="num py-1.5 text-right text-win">+{s.new}</td>
                        <td className="num py-1.5 text-right text-warn">{s.updated ? `~${s.updated}` : ""}</td>
                        <td className="num py-1.5 text-right text-muted">{s.existing}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {r.skipped.length > 0 && <div className="mt-2 text-[12.5px] text-warn">Skipped: {r.skipped.map((s) => `${s.file} (${s.reason})`).join(", ")}</div>}
              </details>
            </motion.div>
          ))}
      </AnimatePresence>

      <Card span={12} title="Import history" pad={false}>
        <table className="w-full text-[13.5px]">
          <thead>
            <tr className="bg-panel-2 text-left text-[11.5px] uppercase tracking-[0.08em] text-muted">
              <th className="px-4 py-2.5">When</th>
              <th className="px-4 py-2.5">Account</th>
              <th className="px-4 py-2.5">Source</th>
              <th className="px-4 py-2.5">Data up to</th>
              <th className="px-4 py-2.5 text-right">New</th>
              <th className="px-4 py-2.5 text-right">Updated</th>
              <th className="px-4 py-2.5 text-right">Already had</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id} className="border-b border-line last:border-0">
                <td className="num px-4 py-2.5">{f.dateTime(h.imported_at)}</td>
                <td className="px-4 py-2.5 font-medium"><Sens>{pv.name(h.username)}</Sens></td>
                <td className="px-4 py-2.5 text-muted">
                  <Sens>{pv.secret(h.source_name)}</Sens>
                </td>
                <td className="num px-4 py-2.5">{f.date(h.watermark)}</td>
                <td className="num px-4 py-2.5 text-right text-win">{h.totals?.new.toLocaleString("en")}</td>
                <td className="num px-4 py-2.5 text-right text-warn">{h.totals?.updated.toLocaleString("en")}</td>
                <td className="num px-4 py-2.5 text-right text-muted">{h.totals?.existing.toLocaleString("en")}</td>
              </tr>
            ))}
            {!history.length && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted">
                  No imports yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </Page>
  );
}

/** Valosight reads exports; it doesn't keep them safe. Said plainly, in danger red, where people import. */
function NotABackup() {
  return (
    <div role="note" className="col-span-12 flex items-start gap-3 rounded-[14px] border border-loss/40 bg-loss-soft p-4 sm:p-5">
      <OctagonAlert size={20} className="mt-0.5 shrink-0 text-loss" />
      <div className="min-w-0 text-[13.5px]">
        <div className="font-display text-[15px] font-semibold text-loss">Keep your Riot export. Valosight is not a backup.</div>
        <p className="mt-1 text-muted">
          Valosight only reads your export and shows it to you. We never receive or store your data: there is no copy on any server, and we can't recover
          anything for you.{" "}
          What you import is kept only in this browser, and it's gone if you clear site data, switch browser or device, or the browser frees up space.{" "}
          <b className="text-text">Don't delete the zip Riot sent you</b> because you've imported it here. Keep it somewhere safe (and the Valosight
          backup from Settings too, if you like).
        </p>
      </div>
    </div>
  );
}

/** Asks for a protected zip's password. It is passed to the engine once, in memory, and never stored. */
function PasswordPrompt({ label, wrong, onSubmit, onCancel }: { label: string; wrong: boolean; onSubmit: (pw: string) => void; onCancel: () => void }) {
  const [pw, setPw] = useState("");
  const [shake, setShake] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!wrong) return;
    setShake((n) => n + 1);
    input.current?.select(); // ready to retype
  }, [wrong]);
  return (
    <motion.form
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, transition: { duration: 0.2 } }}
      transition={{ duration: SOFT.in, ease: SOFT.ease }}
      onSubmit={(e) => {
        e.preventDefault();
        if (pw) onSubmit(pw);
      }}
      className="panel corner col-span-12 p-5"
    >
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <KeyRound size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">This zip is password-protected</div>
          <div className="text-[13px] text-muted">
            Enter the password for <span className="font-medium text-ink">{label}</span>. It's used only to open the file on this device and is never saved.
          </div>
          <motion.div key={shake} animate={shake ? { x: [0, -8, 8, -5, 5, 0] } : undefined} transition={{ duration: 0.4 }} className="mt-3 flex flex-wrap items-center gap-2">
            <input
              ref={input}
              type="password"
              autoFocus
              autoComplete="off"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              aria-label="Zip password"
              aria-invalid={wrong}
              placeholder="Password"
              className={`field min-w-[220px] flex-1 rounded-lg border bg-panel-2 px-3 py-2 outline-none sm:max-w-sm ${wrong ? "border-loss" : "border-line"}`}
            />
            <button type="submit" disabled={!pw} className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white disabled:opacity-40">
              Unlock and import
            </button>
            <button type="button" onClick={onCancel} className="rounded-lg border border-line px-3 py-2 text-[13px] text-muted hover:text-ink">
              Cancel
            </button>
          </motion.div>
          <AnimatePresence>
            {wrong && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="pt-2 text-[12.5px] text-loss">That password didn't open the zip. Check it and try again.</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.form>
  );
}
