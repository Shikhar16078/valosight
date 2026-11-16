import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { useAccount } from "../lib/account";
import { api } from "../lib/api";
import { ALL_TZ, COMMON_TZ, makeFormatters, useSettings, type DateFmt } from "../lib/settings";
import { HOME_CURRENCIES, currencySetup, useFx } from "../lib/convert";
import { useRecords } from "../lib/account";
import { DS, money } from "../lib/valorant";
import { Check, Download, Globe, MonitorSmartphone, Plus, RefreshCw, RotateCcw, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { Card, Page, Segmented, Switch } from "../components/ui";
import { THEMES, themeById, type Theme } from "../lib/themes";

const FMTS: DateFmt[] = ["dd-MMM-yyyy", "dd MMM yyyy", "MMM d, yyyy", "dd/MM/yyyy", "MM/dd/yyyy", "yyyy-MM-dd"];
const SAMPLE = "2026-11-14T15:41:17.000Z";

export function SettingsView() {
  const { settings, update, f } = useSettings();
  const { accounts, refresh } = useAccount();
  const [confirm, setConfirm] = useState<{ id: number; name: string; typed: string } | null>(null);

  return (
    <Page code="08 / Settings" title="Settings" sub="Saved in your vault, so they apply every time you open it.">
      <Card span={6} title="Timezone" hint="Riot stores everything in UTC. Pick how times are shown.">
        <select value={settings.tz} onChange={(e) => update({ tz: e.target.value })} className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2">
          <optgroup label="Common">
            {COMMON_TZ.map((t) => (
              <option key={t.tz} value={t.tz}>
                {t.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="All timezones">
            {ALL_TZ.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </optgroup>
        </select>
        <div className="num mt-3 text-muted">
          Example: {f.dateTime(SAMPLE, true)} {f.tzLabel}
        </div>
      </Card>

      <Card span={6} title="Date & time format">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {FMTS.map((d) => (
            <button key={d} onClick={() => update({ dateFmt: d })} className={`rounded-lg border px-3 py-2 text-left ${settings.dateFmt === d ? "border-accent bg-accent-soft" : "border-line hover:bg-panel-2"}`}>
              <div className="num font-medium">{makeFormatters({ ...settings, dateFmt: d }).date(SAMPLE)}</div>
              <div className="font-mono text-[11px] text-faint">{d}</div>
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between">
          <span className="text-muted">Clock</span>
          <Segmented value={settings.hour12 ? "12" : "24"} onChange={(v) => update({ hour12: v === "12" })} options={[{ value: "12", label: "12-hour" }, { value: "24", label: "24-hour" }]} />
        </div>
      </Card>

      <Card span={12} title="Show amounts in my currencies" hint="Riot charges in your store's currency. Add as many currencies as you like; every amount shows in all of them, using downloaded rates or your own.">
        <CurrencySettings />
      </Card>

      <Card span={12} title="Motion & effects" hint="Make the app as lively or as calm as you like. Effects stay off for movement if your device asks for reduced motion.">
        <EffectsSettings />
      </Card>

      <Card span={12} title="Theme" hint="Pick any theme, or follow your system between your favourite dark and light one.">
        <ThemePicker />
      </Card>

      <Card
        span={6}
        title="Accounts in this vault"
        hint="Removing an account deletes its data from this browser. Your original export files are not touched."
      >
        <ul className="divide-y divide-line">
          {accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2">
              <div>
                <div className="font-medium">
                  {a.game_name ?? a.username}
                  {a.tagline && <span className="text-muted">#{a.tagline}</span>}
                </div>
                <div className="num text-[12px] text-muted">
                  {a.username} · added {f.date(a.added_at)}
                </div>
              </div>
              <button onClick={() => setConfirm({ id: a.id, name: a.username, typed: "" })} className="rounded-md border border-line px-2.5 py-1 text-[12.5px] text-muted hover:border-accent hover:text-accent">
                Remove…
              </button>
            </li>
          ))}
        </ul>
        {confirm && (
          <div className="mt-3 rounded-lg border border-accent/40 bg-accent-soft p-3">
            <div className="text-[13px]">
              Type <b className="num">{confirm.name}</b> to remove this account from the vault.
            </div>
            <div className="mt-2 flex gap-2">
              <input autoFocus value={confirm.typed} onChange={(e) => setConfirm({ ...confirm, typed: e.target.value })} className="flex-1 rounded-md border border-line bg-panel px-2 py-1" />
              <button
                disabled={confirm.typed !== confirm.name}
                onClick={async () => {
                  await api.deleteAccount(confirm.id);
                  setConfirm(null);
                  refresh();
                }}
                className="rounded-md bg-accent px-3 py-1 text-[13px] font-medium text-white disabled:opacity-40"
              >
                Remove
              </button>
              <button onClick={() => setConfirm(null)} className="rounded-md border border-line px-3 py-1 text-[13px]">
                Cancel
              </button>
            </div>
          </div>
        )}
      </Card>

      <Card span={6} title="Backup & restore" hint="Your vault lives only in this browser. Download a backup to keep it safe, or to move it to another browser or device.">
        <BackupSettings />
      </Card>
    </Page>
  );
}

const mb = (n: number) => (n < 1024 ** 2 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`);

function BackupSettings() {
  const [store, setStore] = useState<{ persisted: boolean; usage: number | null } | null>(null);
  const [busy, setBusy] = useState<"backup" | "restore" | null>(null);
  const [pending, setPending] = useState<File | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.storage().then(setStore).catch(() => {});
  }, []);

  const download = async () => {
    setBusy("backup");
    setMsg(null);
    try {
      const blob = await api.backup();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `valosight-backup-${new Date().toISOString().slice(0, 10)}.valosight`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      setMsg({ ok: true, text: `Backup saved (${mb(blob.size)}). Keep it somewhere private: it holds your account data.` });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const restore = async (file: File) => {
    setBusy("restore");
    setMsg(null);
    try {
      await api.restore(file);
      window.location.reload(); // settings, accounts and caches all come from the restored vault
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
      setBusy(null);
      setPending(null);
    }
  };

  return (
    <div>
      {store && (
        <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px] ${store.persisted ? "border-line" : "border-loss/40 bg-loss/5"}`}>
          {store.persisted ? <ShieldCheck size={16} className="mt-0.5 shrink-0 text-win" /> : <ShieldAlert size={16} className="mt-0.5 shrink-0 text-loss" />}
          <div>
            {store.persisted ? "Protected: the browser won't clear this vault to free up space." : "Not protected yet: the browser may clear this vault if the device runs low on space. Keep a backup."}
            {store.usage != null && <span className="num text-muted"> · using {mb(store.usage)}</span>}
          </div>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={download} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50">
          <Download size={14} /> {busy === "backup" ? "Preparing…" : "Download backup"}
        </button>
        <button onClick={() => fileRef.current?.click()} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[13px] hover:border-accent hover:text-accent disabled:opacity-50">
          <RotateCcw size={14} /> Restore from backup…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".valosight,application/gzip,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) setPending(f);
          }}
        />
      </div>
      {pending && (
        <div className="mt-3 rounded-lg border border-loss/40 bg-loss/5 p-3 text-[13px]">
          <div>
            Replace everything in this browser's vault with <b className="num">{pending.name}</b>? Accounts, imports, tags and settings here will be swapped for the backup's.
          </div>
          <div className="mt-2 flex gap-2">
            <button onClick={() => restore(pending)} disabled={!!busy} className="rounded-md bg-loss px-3 py-1 text-[13px] font-medium text-white disabled:opacity-50">
              {busy === "restore" ? "Restoring…" : "Replace and restore"}
            </button>
            <button onClick={() => setPending(null)} disabled={!!busy} className="rounded-md border border-line px-3 py-1 text-[13px]">
              Cancel
            </button>
          </div>
        </div>
      )}
      {msg && <div className={`mt-3 text-[13px] ${msg.ok ? "text-muted" : "text-loss"}`}>{msg.text}</div>}
    </div>
  );
}

function CurrencySettings() {
  const { settings, update, f } = useSettings();
  const pay = useRecords(DS.payments, false);
  const used = [...new Set(pay.all.map((p) => p.currency_code).filter(Boolean))] as string[];
  const { targets, fx } = currencySetup(settings);
  const [adding, setAdding] = useState("");
  // Writing the new fields also clears the single-currency ones they replace.
  const save = (t: string[], f: Record<string, Record<string, number>>) => update({ homeCurrencies: t, fx: f, homeCurrency: "", rates: {} });
  const setRate = (to: string, from: string, v: number | null) => {
    const next = { ...fx, [to]: { ...(fx[to] ?? {}) } };
    if (v == null) delete next[to][from];
    else next[to][from] = v;
    save(targets, next);
  };
  const add = (c: string) => {
    if (!c || targets.includes(c)) return;
    save([...targets, c], fx);
    setAdding("");
  };
  const remove = (c: string) => {
    const next = { ...fx };
    delete next[c];
    save(
      targets.filter((t) => t !== c),
      next,
    );
  };
  const makePrimary = (c: string) => save([c, ...targets.filter((t) => t !== c)], fx);
  const available = HOME_CURRENCIES.filter((c) => !targets.includes(c));
  const fxs = useFx();
  const auto = !!settings.autoRates;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-3 rounded-xl border border-line bg-panel-2/50 px-4 py-3">
        <Globe size={18} className="mt-0.5 shrink-0 text-info" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">Get exchange rates automatically</div>
          <div className="text-[12.5px] text-muted">
            Downloads the European Central Bank's rate for every day you paid, plus today's rate (open.er-api.com for currencies the ECB doesn't cover), so each amount shows
            what it cost when you paid and what it's worth today.{" "}
            The rates come as the same public files for everyone, from Valosight's own site, so the download says nothing about you or your data.
          </div>
          {auto && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px]">
              {fxs.status === "syncing" && <span className="text-muted">Updating rates…</span>}
              {fxs.status === "ok" && !fxs.errors.length && <span className="text-win">Rates up to date</span>}
              {(fxs.status === "error" || fxs.errors.length > 0) && (
                <span className="text-warn" title={fxs.errors.join("\n")}>
                  Couldn't reach a rate service; using saved and manual rates.
                </span>
              )}
              {fxs.status !== "syncing" && (
                <button type="button" onClick={() => fxs.refresh(true)} className="inline-flex items-center gap-1 text-muted hover:text-ink hover:underline">
                  <RefreshCw size={12} /> Update now
                </button>
              )}
            </div>
          )}
        </div>
        <Switch label="Get exchange rates automatically" on={auto} onChange={(v) => update({ autoRates: v })} />
      </div>
      {!used.length && <div className="text-[12.5px] text-muted">No payments in this account yet, so there's nothing to convert.</div>}
      <div className="grid gap-3 lg:grid-cols-2">
      <AnimatePresence initial={false}>
        {targets.map((t, i) => (
          <motion.div
            key={t}
            layout
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            className="overflow-hidden rounded-xl border border-line bg-panel-2/50"
          >
            <div className="flex items-center gap-2 px-3 py-2">
              <span className="num rounded-md border border-info/25 bg-info-soft px-2 py-0.5 text-[13px] font-semibold text-info">{t}</span>
              {i === 0 ? (
                <span className="text-[12px] text-muted" title="Used where amounts in different currencies are added up">
                  Primary
                </span>
              ) : (
                <button type="button" onClick={() => makePrimary(t)} className="text-[12px] text-muted hover:text-ink hover:underline">
                  Make primary
                </button>
              )}
              <button type="button" onClick={() => remove(t)} aria-label={`Remove ${t}`} className="ml-auto rounded-md p-1 text-muted hover:bg-panel-3 hover:text-loss">
                <X size={15} />
              </button>
            </div>
            <div className="space-y-2 border-t border-line px-3 py-2.5">
              {used.filter((c) => c !== t).length === 0 && <div className="text-[12.5px] text-muted">Riot already charged you in {t}; nothing to convert.</div>}
              {used
                .filter((c) => c !== t)
                .map((c) => {
                  const live = auto ? fxs.rates?.latest[c]?.[t] : undefined;
                  const days = auto ? fxs.rates?.daily[c]?.[t] : undefined;
                  return live ? (
                    <div key={c} className="num flex flex-wrap items-baseline justify-between gap-x-3 rounded-lg border border-line bg-panel px-3 py-1.5 text-[13px]">
                      <span>
                        1 {c} = <b>{live.rate}</b> {t} <span className="text-muted">today</span>
                      </span>
                      <span className="text-[11.5px] text-faint">
                        {days?.length ? `daily since ${f.date(days[0][0])} · ` : "today only · "}
                        {live.source}
                      </span>
                    </div>
                  ) : (
                    <RateInput key={c} from={c} to={t} value={fx[t]?.[c]} onChange={(v) => setRate(t, c, v)} />
                  );
                })}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
      </div>
      <label className="field flex items-center gap-2 rounded-lg border border-dashed border-line-strong px-3 py-2">
        <Plus size={15} className="text-muted" />
        <span className="text-muted">{targets.length ? "Add another currency" : "Add a currency"}</span>
        <select value={adding} onChange={(e) => add(e.target.value)} className="ml-auto bg-transparent font-medium outline-none" aria-label="Add a display currency">
          <option value="">Choose…</option>
          {available.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** Rate field that keeps what you type (so "0.0…" works) and saves once it's a valid positive number. */
function RateInput({ from, to, value, onChange }: { from: string; to: string; value: number | undefined; onChange: (v: number | null) => void }) {
  const [text, setText] = useState(value != null ? String(value) : "");
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) setText(value != null ? String(value) : "");
  }, [value, focus]);
  useEffect(() => {
    if (!focus) return;
    const t = window.setTimeout(() => {
      const v = parseFloat(text);
      if (text.trim() === "") onChange(null);
      else if (Number.isFinite(v) && v > 0 && v !== value) onChange(v);
    }, 400);
    return () => window.clearTimeout(t);
  }, [text, focus]); // onChange/value come from the same render as `text`, so they are current here
  const v = parseFloat(text);
  return (
    <label className="field flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5">
      <span className="num shrink-0 text-[13px]">1 {from} =</span>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        placeholder="rate"
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onChange={(e) => setText(e.target.value.replace(/[^0-9.]/g, ""))}
        className="num w-full bg-transparent text-right outline-none"
      />
      <span className="num shrink-0 text-muted">{to}</span>
      {Number.isFinite(v) && v > 0 && <span className="num hidden shrink-0 text-[12px] text-faint sm:inline">· {money(1000, from)} ≈ {money(1000 * v, to)}</span>}
    </label>
  );
}

function ThemePicker() {
  const { settings, setTheme } = useSettings();
  const pick = (id: string) => () => setTheme(id);
  const active = settings.theme === "dark" ? settings.darkTheme : settings.theme === "light" ? settings.lightTheme : settings.theme;
  const dark = themeById(settings.darkTheme)?.name ?? "Vault";
  const light = themeById(settings.lightTheme)?.name ?? "Paper";
  return (
    <div className="space-y-5">
      {(["dark", "light"] as const).map((mode) => (
        <div key={mode}>
          <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted">{mode === "dark" ? "Dark" : "Light"}</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {THEMES.filter((t) => t.mode === mode).map((t) => (
              <ThemeTile key={t.id} t={t} on={active === t.id} onClick={pick(t.id)} />
            ))}
          </div>
        </div>
      ))}
      <button
        type="button"
        aria-pressed={settings.theme === "system"}
        onClick={pick("system")}
        className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left ${settings.theme === "system" ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong hover:bg-panel-2"}`}
      >
        <MonitorSmartphone size={18} className={settings.theme === "system" ? "text-accent" : "text-muted"} />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">Match my system</span>
          <span className="block text-[12.5px] text-muted">
            {dark} when your device is in dark mode, {light} when it's light. Picking a theme above sets which ones.
          </span>
        </span>
        {settings.theme === "system" && <Check size={16} className="text-accent" />}
      </button>
    </div>
  );
}

/** A real miniature of the theme: the tile carries the theme's attributes, so it uses its colours. */
function ThemeTile({ t, on, onClick }: { t: Theme; on: boolean; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={`${t.name} theme`}
      onClick={onClick}
      data-theme={t.mode}
      data-palette={t.id}
      className={`group relative overflow-hidden rounded-xl border text-left transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 ${on ? "border-[var(--accent)] shadow-[0_0_0_3px_var(--accent-soft)]" : "border-[var(--line-strong)] hover:shadow-[var(--shadow-2)]"}`}
      style={{ background: "radial-gradient(160px 90px at 15% -10%, var(--aurora-1), transparent 70%), radial-gradient(140px 90px at 100% 0%, var(--aurora-2), transparent 70%), var(--bg)", color: "var(--text)" }}
    >
      <div className="p-2.5">
        <div className="flex gap-1.5">
          <div className="w-6 space-y-1 rounded-md p-1" style={{ background: "var(--panel)" }}>
            <div className="h-1.5 rounded-sm" style={{ background: "var(--accent)" }} />
            <div className="h-1.5 rounded-sm" style={{ background: "var(--panel-3)" }} />
            <div className="h-1.5 rounded-sm" style={{ background: "var(--panel-3)" }} />
          </div>
          <div className="flex-1 space-y-1.5 rounded-md border p-1.5" style={{ background: "var(--panel)", borderColor: "var(--line)" }}>
            <div className="h-1.5 w-2/3 rounded-sm" style={{ background: "var(--text)", opacity: 0.85 }} />
            <div className="flex h-6 items-end gap-0.5">
              {[50, 80, 35, 95, 60, 75].map((h, i) => (
                <div key={i} className="flex-1 rounded-t-[2px]" style={{ height: `${h}%`, background: i % 3 === 1 ? "var(--win)" : "var(--accent)" }} />
              ))}
            </div>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <div>
            <div className="text-[13px] font-semibold leading-tight">{t.name}</div>
            <div className="text-[11px] leading-tight" style={{ color: "var(--muted)" }}>
              {t.blurb}
            </div>
          </div>
          <div className="flex -space-x-1">
            {["--accent", "--win", "--warn", "--info", "--violet"].map((v) => (
              <span key={v} className="h-3 w-3 rounded-full ring-2" style={{ background: `var(${v})`, ["--tw-ring-color" as string]: "var(--panel)" }} />
            ))}
          </div>
        </div>
      </div>
      {on && (
        <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full text-white" style={{ background: "var(--accent)" }}>
          <Check size={12} />
        </span>
      )}
    </button>
  );
}

function EffectsSettings() {
  const { settings, update } = useSettings();
  const row = (title: string, desc: string, control: React.ReactNode) => (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-line bg-panel-2/50 px-4 py-3">
      <div className="min-w-0">
        <div className="font-medium">{title}</div>
        <div className="text-[12.5px] text-muted">{desc}</div>
      </div>
      {control}
    </div>
  );
  return (
    <div className="grid gap-2.5 lg:grid-cols-2">
      {row("Cursor glow", "A soft light follows your mouse across cards.", <Switch label="Cursor glow" on={settings.spotlight} onChange={(v) => update({ spotlight: v })} />)}
      {row("Living background", "The background glows drift slowly.", <Switch label="Living background" on={settings.ambient} onChange={(v) => update({ ambient: v })} />)}
      {row("3D tilt", "Stat cards lean toward the pointer.", <Switch label="3D tilt" on={settings.tilt} onChange={(v) => update({ tilt: v })} />)}
      {row(
        "Neon card edges",
        "A glowing edge that circles each card. “Always” uses a little more battery.",
        <Segmented value={settings.neon} onChange={(v) => update({ neon: v })} options={[{ value: "off", label: "Off" }, { value: "hover", label: "Hover" }, { value: "always", label: "Always" }]} />,
      )}
      {row(
        "Animations",
        "“Reduced” stops movement in the app even if your device allows it.",
        <Segmented value={settings.motion} onChange={(v) => update({ motion: v })} options={[{ value: "system", label: "Full" }, { value: "reduced", label: "Reduced" }]} />,
      )}
    </div>
  );
}
