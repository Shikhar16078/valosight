import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type FxRates } from "./api";
import { useAccount, useRecords } from "./account";
import { useSettings, type Settings } from "./settings";
import { DS, money } from "./valorant";

export const HOME_CURRENCIES = ["INR", "USD", "EUR", "GBP", "PHP", "SGD", "MYR", "IDR", "THB", "VND", "JPY", "KRW", "AUD", "NZD", "CAD", "BRL", "MXN", "TRY", "AED", "PKR", "BDT"];

/** Display currencies and the user's own rates: `fx[target][source]` = target units per 1 source unit. */
export function currencySetup(s: Settings): { targets: string[]; fx: Record<string, Record<string, number>> } {
  if (s.homeCurrencies) return { targets: s.homeCurrencies, fx: s.fx ?? {} };
  // Settings from before several currencies were supported: one homeCurrency + rates.
  return s.homeCurrency ? { targets: [s.homeCurrency], fx: { [s.homeCurrency]: s.rates ?? {} } } : { targets: [], fx: {} };
}

// ---------------------------------------------------------------- downloaded rates

interface FxState {
  rates: FxRates | null;
  status: "off" | "syncing" | "ok" | "error";
  errors: string[];
  /** Currencies Riot charged this account in (the "from" side of every conversion). */
  charged: string[];
  refresh: (force?: boolean) => void;
}
const FxCtx = createContext<FxState>({ rates: null, status: "off", errors: [], charged: [], refresh: () => {} });

/** Keeps downloaded rates in sync for this account's currencies when automatic rates are on. */
export function FxProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const { accountId } = useAccount();
  const pay = useRecords(DS.payments, false);
  const { targets } = currencySetup(settings);
  const charged = useMemo(() => [...new Set(pay.all.map((p) => p.currency_code).filter(Boolean))].sort() as string[], [pay.all]);
  const start = useMemo(() => (pay.all.map((p) => p._t).filter(Boolean).sort()[0] as string | undefined)?.slice(0, 10) ?? "2020-01-01", [pay.all]);
  const [rates, setRates] = useState<FxRates | null>(null);
  const [status, setStatus] = useState<FxState["status"]>("off");
  const [errors, setErrors] = useState<string[]>([]);
  const [nonce, setNonce] = useState<{ n: number; force: boolean }>({ n: 0, force: false });
  const key = `${settings.autoRates ? 1 : 0}|${accountId}|${charged.join()}|${targets.join()}|${start}`;

  useEffect(() => {
    if (!settings.autoRates || !charged.length || !targets.length) {
      setStatus("off");
      setRates(null);
      return;
    }
    let live = true;
    setStatus("syncing");
    api
      .fxSync(charged, targets, start, nonce.force)
      .then((r) => {
        if (live) setErrors(r.errors);
        return api.fx(charged, targets);
      })
      .then((r) => {
        if (!live) return;
        setRates(r);
        setStatus("ok");
      })
      .catch((e: Error) => {
        if (!live) return;
        setErrors([e.message]);
        setStatus("error");
        api.fx(charged, targets).then((r) => live && setRates(r), () => {}); // still use whatever is cached
      });
    return () => {
      live = false;
    };
  }, [key, nonce]); // key covers every input above

  const refresh = useCallback((force = true) => setNonce((n) => ({ n: n.n + 1, force })), []);
  return <FxCtx.Provider value={{ rates, status, errors, charged, refresh }}>{children}</FxCtx.Provider>;
}

export const useFx = () => useContext(FxCtx);

/** Rate on `day` from a sorted [[day, rate]] list: that day, or the last business day before it. */
function rateOn(days: [string, number][], day: string): number | null {
  if (!days.length) return null;
  let lo = 0,
    hi = days.length - 1;
  if (day < days[0][0]) return days[0][1];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (days[mid][0] <= day) lo = mid;
    else hi = mid - 1;
  }
  return days[lo][1];
}

// ---------------------------------------------------------------- conversion

export interface Converted {
  cur: string;
  value: number;
}

/**
 * Money in the currency Riot charged, plus every display currency the user added. Rates come from
 * the download (when on) or the user's own. `home` is the first display currency, used for totals.
 */
export function useMoney() {
  const { settings } = useSettings();
  const { rates } = useFx();
  const { targets, fx } = useMemo(() => currencySetup(settings), [settings]);
  const home = targets[0] ?? "";

  /** Today's rate: downloaded, else the user's own. */
  const rateNow = useCallback(
    (from: string, to: string): number | null => {
      if (!to || from === to) return null;
      const r = rates?.latest[from]?.[to]?.rate ?? fx[to]?.[from];
      return r && r > 0 ? r : null;
    },
    [rates, fx],
  );
  /** Rate on the day of `iso`: downloaded history, else today's rate. */
  const rateAt = useCallback(
    (from: string, to: string, iso: string | null | undefined): number | null => {
      const days = rates?.daily[from]?.[to];
      if (days && iso) return rateOn(days, iso.slice(0, 10));
      return rateNow(from, to);
    },
    [rates, rateNow],
  );
  const hasHistory = useCallback((from: string, to: string) => !!rates?.daily[from]?.[to]?.length, [rates]);

  const convert = useCallback(
    (v: number, cur: string, to: string = home): number | null => {
      const r = rateNow(cur, to);
      return r == null ? null : v * r;
    },
    [rateNow, home],
  );
  const conversions = useCallback(
    (v: number, cur: string): Converted[] =>
      targets.flatMap((t) => {
        const c = convert(v, cur, t);
        return c == null ? [] : [{ cur: t, value: c }];
      }),
    [targets, convert],
  );
  /** What payments cost on the day they were made, and what the same amount is worth today. */
  const thenNow = useCallback(
    (items: { v: number; t: string | null }[], cur: string, to: string) => {
      const now = rateNow(cur, to);
      if (now == null) return null;
      const total = items.reduce((a, x) => a + x.v, 0);
      const then = hasHistory(cur, to) ? items.reduce((a, x) => a + x.v * (rateAt(cur, to, x.t) ?? now), 0) : null;
      return { then, now: total * now };
    },
    [rateNow, rateAt, hasHistory],
  );
  const fmt = useCallback(
    (v: number, cur: string, digits = 0) => {
      const cs = conversions(v, cur);
      return cs.length ? `${money(v, cur, digits)} ≈ ${cs.map((c) => money(c.value, c.cur, digits)).join(" · ")}` : money(v, cur, digits);
    },
    [conversions],
  );
  const homeOnly = useCallback(
    (v: number, cur: string, digits = 0) => {
      const cs = conversions(v, cur);
      return cs.length ? `≈ ${cs.map((c) => money(c.value, c.cur, digits)).join(" · ")}` : null;
    },
    [conversions],
  );
  return { fmt, convert, conversions, homeOnly, home, targets, rateNow, rateAt, hasHistory, thenNow };
}

const pct = (then: number, now: number) => (then ? ((now - then) / then) * 100 : 0);

function Delta({ then, now }: { then: number; now: number }) {
  const d = pct(then, now);
  if (Math.abs(d) < 0.05) return <span className="text-faint">±0%</span>;
  return (
    <span
      className={d > 0 ? "text-win" : "text-loss"}
      title={d > 0 ? "Worth more in this currency today than when you paid" : "Worth less in this currency today than when you paid"}
    >
      {d > 0 ? "▲" : "▼"} {Math.abs(d).toFixed(1)}%
    </span>
  );
}

/**
 * Converted amounts, emphasised. With `items` (each payment's amount and date) and downloaded
 * history, every currency shows what it cost on the day you paid next to today's value.
 */
export function ConvertedChips({ v, cur, items, digits = 0 }: { v: number; cur: string; items?: { v: number; t: string | null }[]; digits?: number }) {
  const { targets, thenNow, convert } = useMoney();
  const rows = targets.flatMap((to) => {
    if (to === cur) return [];
    const tn = items ? thenNow(items, cur, to) : null;
    const now = tn?.now ?? convert(v, cur, to);
    return now == null ? [] : [{ to, then: tn?.then ?? null, now }];
  });
  if (!rows.length) return null;
  return (
    <span className="flex flex-col gap-1.5">
      {rows.map((r) =>
        r.then != null ? (
          <span key={r.to} className="num grid grid-cols-[auto_1fr_auto] items-baseline gap-x-2 rounded-lg border border-info/25 bg-info-soft px-2.5 py-1.5">
            <span className="text-[10.5px] font-semibold tracking-wide text-info">{r.to}</span>
            <span className="text-[15px] font-medium text-ink" title="What you paid, at the exchange rate on each payment's date">
              {money(r.then, r.to, digits)} <span className="text-[11px] font-normal text-muted">when paid</span>
            </span>
            <span className="text-[11.5px]">
              <Delta then={r.then} now={r.now} />
            </span>
            <span />
            <span className="text-[12px] text-muted" title="The same amount at today's exchange rate">
              {money(r.now, r.to, digits)} at today's rate
            </span>
            <span />
          </span>
        ) : (
          <span
            key={r.to}
            title={`Converted with today's ${cur} → ${r.to} rate`}
            className="num inline-flex w-fit items-baseline gap-1 rounded-md border border-info/25 bg-info-soft px-2 py-0.5 text-[14px] font-medium text-ink"
          >
            <span className="text-info">≈</span>
            {money(r.now, r.to, digits)}
            <span className="text-[10.5px] font-semibold tracking-wide text-info">{r.to}</span>
          </span>
        ),
      )}
    </span>
  );
}

/** One payment in each display currency: at its own date's rate, with today's value after it. */
export function PaidIn({ v, cur, t }: { v: number; cur: string; t: string | null }) {
  const { targets, rateAt, rateNow, hasHistory } = useMoney();
  const parts = targets.flatMap((to) => {
    const now = rateNow(cur, to);
    if (now == null) return [];
    const then = hasHistory(cur, to) ? rateAt(cur, to, t) : null;
    return [{ to, then: then != null ? v * then : null, now: v * now }];
  });
  if (!parts.length) return null;
  return (
    <span className="num flex flex-col items-end text-[11.5px] leading-tight">
      {parts.map((p) => (
        <span key={p.to} title={p.then != null ? "At the rate on the payment date · at today's rate" : "At today's rate"}>
          <span className="text-ink">≈ {money(p.then ?? p.now, p.to)}</span>
          {p.then != null && <span className="text-faint"> · {money(p.now, p.to)} today</span>}
        </span>
      ))}
    </span>
  );
}
