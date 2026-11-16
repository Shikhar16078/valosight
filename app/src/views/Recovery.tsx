import { ArrowDown, ArrowUp, Check, ClipboardCopy, FileDown, Info, Plus, RotateCcw, Trash2, Wand2 } from "lucide-react";
import { PrivacyGate } from "../lib/privacy";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useRecords } from "../lib/account";
import { api } from "../lib/api";
import { freshItems, renderText, riotDate, suggest, TEMPLATE, TX_DEFAULT, txLine, txPaid, type RItem } from "../lib/recovery";
import type { Rec } from "../lib/api";
import { SOFT_CSS } from "../components/anim";
import { DS } from "../lib/valorant";
import { Badge, Card, Page, Segmented } from "../components/ui";

interface Draft {
  items: RItem[];
  numbered: boolean;
  skipEmpty: boolean;
  title: string;
}

const KIND = "recovery";
const KEY = "draft";

export function Recovery() {
  const { accountId, detail } = useAccount();
  const info = (detail?.snapshots[DS.info] ?? {}) as Record<string, any>;
  const clash = (detail?.snapshots[DS.clash] ?? {}) as Record<string, any>;
  const pay = useRecords(DS.payments, false);
  const store = useRecords(DS.store, false);
  const mh = useRecords(DS.matches, false);
  const logins = useRecords(DS.logins, false);
  const audit = useRecords(DS.audit, false);
  const pays = useMemo(() => pay.all.filter((p) => p.player_facing_purchase_id).sort((a, b) => (a._t ?? "").localeCompare(b._t ?? "")), [pay.all]);
  const loadingData = pay.loading || store.loading || mh.loading || logins.loading || audit.loading;

  const sug = useMemo(
    () =>
      suggest({
        detail,
        info,
        phoneMasked: clash.phone_number ?? null,
        payments: pay.all,
        store: store.all,
        matches: mh.all,
        logins: logins.all,
        audit: audit.all,
      }),
    [detail, pay.all, store.all, mh.all, logins.all, audit.all],
  );

  const [draft, setDraft] = useState<Draft | null>(null);
  // "none" only once the server has confirmed there is no saved draft: a failed or slow load
  // must never be mistaken for "nothing saved", or the fresh draft would overwrite the real one.
  const [load, setLoad] = useState<"pending" | "found" | "none" | "error">("pending");
  const [reload, setReload] = useState(0);
  const [saved, setSaved] = useState<"saved" | "saving" | "error" | null>(null);
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const dirty = useRef(false);
  const pending = useRef<{ acc: number; d: Draft } | null>(null);

  const flush = useCallback(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    window.clearTimeout(timer.current);
    api
      .setAnnotation(p.acc, KIND, KEY, JSON.stringify(p.d))
      .then(() => setSaved((s) => (pending.current ? s : "saved")))
      .catch(() => setSaved("error"));
  }, []);

  useEffect(() => {
    setDraft(null);
    setSaved(null);
    dirty.current = false;
    if (accountId == null) return;
    setLoad("pending");
    let live = true;
    api
      .annotations(accountId, KIND)
      .then((m) => {
        if (!live) return;
        let d: Draft | null = null;
        try {
          d = m[KEY] ? JSON.parse(m[KEY]) : null;
        } catch {
          d = null; // unreadable draft: start fresh
        }
        if (d?.items) {
          setDraft(d);
          setLoad("found");
        } else setLoad("none");
      })
      .catch(() => live && setLoad("error"));
    return () => {
      live = false;
      flush(); // switching account or leaving the page saves what was typed
    };
  }, [accountId, reload, flush]);

  useEffect(() => {
    if (load === "none" && draft === null && !loadingData) setDraft({ items: freshItems(sug), numbered: true, skipEmpty: true, title: "" });
  }, [load, draft, loadingData, sug]);

  useEffect(() => {
    if (!dirty.current || !draft || accountId == null) return;
    dirty.current = false;
    pending.current = { acc: accountId, d: draft };
    setSaved("saving");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 600);
  }, [draft, accountId, flush]);

  const update = (fn: (d: Draft) => Draft) => {
    dirty.current = true;
    setDraft((d) => (d ? fn(d) : d));
  };
  const setItem = (id: string, p: Partial<RItem>) => update((d) => ({ ...d, items: d.items.map((it) => (it.id === id ? { ...it, ...p } : it)) }));
  const move = (i: number, dir: -1 | 1) =>
    update((d) => {
      const items = [...d.items];
      const j = i + dir;
      if (j < 0 || j >= items.length) return d;
      [items[i], items[j]] = [items[j], items[i]];
      return { ...d, items };
    });

  const text = useMemo(() => (draft ? renderText(draft.items, draft) : ""), [draft]);
  const answered = draft?.items.filter((i) => i.kind === "q" && i.include && i.answer.trim()).length ?? 0;
  const total = draft?.items.filter((i) => i.kind === "q" && i.include).length ?? 0;

  const copy = async () => {
    let ok = true;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.readOnly = true;
      ta.style.cssText = "position:fixed;top:0;left:-9999px;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      ta.remove();
    }
    setCopied(ok ? "ok" : "fail");
    window.setTimeout(() => setCopied(null), ok ? 1800 : 4000);
  };
  const save = () => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const safe = String(info.username ?? "account").replace(/[^\w.-]+/g, "_");
    a.download = `riot-ownership-${safe}-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  };

  return (
    <Page
      code="09 / Recovery"
      title="Account ownership answers"
      sub="Riot support asks these questions to confirm you own an account. Answers are pre-filled from your vault — check and edit every one, then copy or save the text for your support ticket."
    >
      <PrivacyGate what="Ownership answers">
      <div className="panel col-span-12 flex items-start gap-3 border-warn/40 bg-warn-soft p-4 text-[13px]">
        <Info size={17} className="mt-0.5 shrink-0 text-warn" />
        <div>
          This text contains personal details (email, birthday, purchase IDs). Only send it to Riot through their official support site — never to anyone who messages you about your account. Card numbers and PINs are never filled in automatically; type only what Riot asks for.
        </div>
      </div>

      {!draft ? (
        <Card span={12}>
          {load === "error" ? (
            <div className="py-10 text-center text-muted">
              Couldn't load your saved answers, so nothing was changed.{" "}
              <button onClick={() => setReload((n) => n + 1)} className="font-medium text-accent underline underline-offset-2">
                Try again
              </button>
            </div>
          ) : (
            <div className="py-10 text-center text-muted">Preparing your answers…</div>
          )}
        </Card>
      ) : (
        <>
          <div className="col-span-12 min-w-0 space-y-3 xl:col-span-7">
            <div className="panel flex flex-wrap items-center gap-2 px-4 py-3">
              <span className="num text-[13px]">
                <b>{answered}</b>
                <span className="text-muted"> / {total} answered</span>
              </span>
              <span className="text-[12px] text-faint">{saved === "saving" ? "Saving…" : saved === "saved" ? "Draft saved" : saved === "error" ? "Couldn't save. Your next edit will retry." : ""}</span>
              <div className="ml-auto flex flex-wrap gap-2">
                <button
                  onClick={() => update((d) => ({ ...d, items: d.items.map((it) => (it.kind === "q" && !it.answer.trim() && sug[it.id]?.answer ? { ...it, answer: sug[it.id].answer } : it)) }))}
                  className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] hover:bg-panel-2"
                  title="Fill every empty answer that has a suggestion"
                >
                  <Wand2 size={14} /> Fill empty
                </button>
                <button
                  onClick={() => update((d) => ({ ...d, items: [...d.items, { id: `custom-${Date.now()}`, kind: "q", question: "New question", answer: "", include: true, custom: true }] }))}
                  className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] hover:bg-panel-2"
                >
                  <Plus size={14} /> Add question
                </button>
                <button
                  onClick={() => {
                    if (!confirmReset) {
                      setConfirmReset(true);
                      window.setTimeout(() => setConfirmReset(false), 4000);
                      return;
                    }
                    setConfirmReset(false);
                    update((d) => ({ ...d, items: freshItems(sug) }));
                  }}
                  title="Replace your edits and custom questions with Riot's questions and fresh suggestions"
                  className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] ${confirmReset ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:bg-panel-2 hover:text-ink"}`}
                >
                  <RotateCcw size={14} /> {confirmReset ? "Click again to discard edits" : "Start over"}
                </button>
              </div>
            </div>

            {draft.items.map((it, i) => {
              const s = sug[it.id];
              const tmpl = TEMPLATE.find((t) => t.id === it.id);
              if (it.kind === "section")
                return (
                  <div key={it.id} className={`panel flex items-start gap-3 px-4 py-3 ${it.include ? "" : "opacity-50"}`}>
                    <input type="checkbox" checked={it.include} onChange={(e) => setItem(it.id, { include: e.target.checked })} className="mt-1 accent-[var(--accent)]" aria-label="Include section heading" />
                    <AutoTextarea
                      value={it.question}
                      onChange={(v) => setItem(it.id, { question: v })}
                      label="Section heading"
                      max={200}
                      className="block w-full resize-none rounded-md bg-transparent font-display text-[14px] font-semibold uppercase tracking-wide outline-none hover:bg-panel-2 focus:bg-panel-2"
                    />
                    <Reorder i={i} n={draft.items.length} move={move} />
                  </div>
                );
              const suggestionDiffers = !!s?.answer && s.answer !== it.answer && !s.options?.includes(s.answer);
              return (
                <div key={it.id} className={`panel px-4 py-3 ${it.include ? "" : "opacity-50"}`}>
                  <div className="flex items-start gap-3">
                    <input type="checkbox" checked={it.include} onChange={(e) => setItem(it.id, { include: e.target.checked })} className="mt-1.5 accent-[var(--accent)]" aria-label="Include this question" />
                    <div className="min-w-0 flex-1">
                      <AutoTextarea
                        value={it.question}
                        onChange={(v) => setItem(it.id, { question: v.replace(/\n/g, " ") })}
                        label="Question text"
                        max={200}
                        className="block w-full resize-none rounded-md bg-transparent text-[13.5px] font-semibold leading-snug outline-none hover:bg-panel-2 focus:bg-panel-2"
                      />
                      {s?.options && (
                        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Quick answers">
                          {s.options.map((o) => {
                            const on = it.answer.trim() === o;
                            return (
                              <button
                                key={o}
                                type="button"
                                aria-pressed={on}
                                onClick={() => setItem(it.id, { answer: on ? "" : o })}
                                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-left text-[12.5px] transition-colors ${on ? "border-accent bg-accent-soft font-medium text-accent" : "border-line text-muted hover:border-line-strong hover:text-ink"}`}
                              >
                                {on && <Check size={13} />}
                                {o}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {it.id === "txIds" && pays.length > 0 && <TxPicker pays={pays} answer={it.answer} onChange={(answer) => setItem(it.id, { answer })} />}
                      <AutoTextarea value={it.answer} onChange={(v) => setItem(it.id, { answer: v })} placeholder={s?.options ? "Pick an option above, or write your own…" : "Your answer…"} label="Answer" />
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px]">
                        {it.answer.trim() && s?.answer && it.answer === s.answer && !s.options?.includes(it.answer.trim()) && <Badge tone="info">from your data</Badge>}
                        {!it.answer.trim() && <Badge tone="warn">needs your answer</Badge>}
                        {it.custom && <Badge>custom</Badge>}
                        {s?.hint && <span className="text-muted">{s.hint}</span>}
                        {suggestionDiffers && (
                          <button onClick={() => setItem(it.id, { answer: s!.answer })} className="text-accent hover:underline">
                            Use suggestion
                          </button>
                        )}
                        {tmpl && it.question !== tmpl.q && (
                          <button onClick={() => setItem(it.id, { question: tmpl.q })} className="text-muted hover:text-ink hover:underline">
                            Reset question text
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-center gap-1">
                      <Reorder i={i} n={draft.items.length} move={move} />
                      {it.custom && (
                        <button onClick={() => update((d) => ({ ...d, items: d.items.filter((x) => x.id !== it.id) }))} className="rounded p-1 text-faint hover:text-accent" aria-label="Delete question">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="col-span-12 xl:col-span-5">
            <div className="panel corner sticky top-[68px] flex max-h-[calc(100vh-88px)] flex-col">
              <div className="border-b border-line px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-display text-[15px] font-semibold uppercase tracking-[0.06em]">Preview</h2>
                  <span className="num text-[12px] text-muted">{text.length.toLocaleString("en")} characters</span>
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <Segmented value={draft.numbered ? "num" : "plain"} onChange={(v) => update((d) => ({ ...d, numbered: v === "num" }))} options={[{ value: "num", label: "Numbered" }, { value: "plain", label: "Plain" }]} />
                  <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
                    <input type="checkbox" checked={draft.skipEmpty} onChange={(e) => update((d) => ({ ...d, skipEmpty: e.target.checked }))} className="accent-[var(--accent)]" />
                    Hide unanswered
                  </label>
                </div>
                <label className="field mt-2.5 flex items-center gap-2 rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-[12.5px]">
                  <span className="shrink-0 text-muted">Title</span>
                  <input value={draft.title} onChange={(e) => update((d) => ({ ...d, title: e.target.value }))} placeholder="optional first line, e.g. Account recovery — Ticket #…" className="w-full bg-transparent outline-none placeholder:text-faint" />
                </label>
              </div>
              <pre className="scroll-thin min-h-[240px] flex-1 overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-[12.5px] leading-relaxed">{text}</pre>
              <div className="flex gap-2 border-t border-line p-3">
                <button onClick={copy} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 font-medium text-[var(--on-accent)] hover:brightness-110">
                  {copied === "ok" ? <Check size={16} /> : <ClipboardCopy size={16} />} {copied === "ok" ? "Copied" : copied === "fail" ? "Couldn't copy. Use Save .txt" : "Copy to clipboard"}
                </button>
                <button onClick={save} className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-line-strong px-3 py-2 font-medium hover:bg-panel-2">
                  <FileDown size={16} /> Save as .txt
                </button>
              </div>
            </div>
          </div>
        </>
      )}
      </PrivacyGate>
    </Page>
  );
}

function Reorder({ i, n, move }: { i: number; n: number; move: (i: number, d: -1 | 1) => void }) {
  return (
    <span className="flex flex-col">
      <button disabled={i === 0} onClick={() => move(i, -1)} className="rounded p-0.5 text-faint hover:text-ink disabled:opacity-20" aria-label="Move up">
        <ArrowUp size={14} />
      </button>
      <button disabled={i === n - 1} onClick={() => move(i, 1)} className="rounded p-0.5 text-faint hover:text-ink disabled:opacity-20" aria-label="Move down">
        <ArrowDown size={14} />
      </button>
    </span>
  );
}

/** Textarea that grows with its content (up to `max` px, then scrolls). */
function AutoTextarea({ value, onChange, placeholder, className, max = 320, label }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; max?: number; label?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    const h = el.scrollHeight + 2; // + borders
    el.style.height = `${Math.min(max, h)}px`;
    el.style.overflowY = h > max ? "auto" : "hidden";
  };
  useEffect(fit, [value, max]);
  useEffect(() => {
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  });
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={label}
      rows={1}
      className={className ?? "mt-1.5 block w-full resize-none rounded-lg border border-line bg-panel-2 px-3 py-2 text-[13.5px] leading-relaxed outline-none placeholder:text-faint focus:border-accent"}
    />
  );
}

/**
 * Pick which purchases go into the transaction-numbers answer. The answer text is the source of truth: a
 * purchase is ticked when its ID is in it, and ticking rebuilds the answer (oldest first). Scrolls inside a
 * fixed height, since an account can have hundreds of purchases.
 */
function TxPicker({ pays, answer, onChange }: { pays: Rec[]; answer: string; onChange: (answer: string) => void }) {
  const picked = useMemo(() => new Set(pays.filter((p) => answer.includes(String(p.player_facing_purchase_id))).map((p) => p.player_facing_purchase_id)), [pays, answer]);
  const set = (ids: Set<unknown>) => onChange(pays.filter((p) => ids.has(p.player_facing_purchase_id)).map(txLine).join("\n"));
  const toggle = (id: unknown) => {
    const n = new Set<unknown>(picked);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    set(n);
  };
  const btn = `rounded-full px-2 py-0.5 text-[12px] text-muted transition-colors ${SOFT_CSS} hover:bg-panel-2 hover:text-ink`;
  return (
    <div className="mt-2 rounded-lg border border-line">
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-2">
        <span className="num mr-auto text-[12.5px]">
          <b>{picked.size}</b>
          <span className="text-muted"> of {pays.length} purchases picked · oldest first</span>
        </span>
        <button type="button" className={btn} onClick={() => set(new Set(pays.slice(0, TX_DEFAULT).map((p) => p.player_facing_purchase_id)))}>
          Oldest {Math.min(TX_DEFAULT, pays.length)}
        </button>
        <button type="button" className={btn} onClick={() => set(new Set(pays.map((p) => p.player_facing_purchase_id)))}>
          Select all
        </button>
        <button type="button" className={btn} onClick={() => set(new Set())}>
          Select none
        </button>
      </div>
      <ul className="scroll-thin max-h-[280px] overflow-y-auto p-1.5">
        {pays.map((p) => {
          const on = picked.has(p.player_facing_purchase_id);
          return (
            <li key={String(p.player_facing_purchase_id)}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => toggle(p.player_facing_purchase_id)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors ${SOFT_CSS} hover:bg-panel-2 ${on ? "text-ink" : "text-muted"}`}
              >
                <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors ${SOFT_CSS} ${on ? "border-accent bg-accent text-[var(--on-accent)]" : "border-line-strong"}`}>
                  <Check size={11} strokeWidth={3} className={`transition-[opacity,transform] ${SOFT_CSS} ${on ? "scale-100 opacity-100" : "scale-50 opacity-0"}`} />
                </span>
                <span className="num min-w-0 flex-1 truncate">{String(p.player_facing_purchase_id)}</span>
                <span className="num shrink-0 text-faint">{riotDate(p._t)}</span>
                <span className="num w-[150px] shrink-0 truncate text-right text-faint">{txPaid(p)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
