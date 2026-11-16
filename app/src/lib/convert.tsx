import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type FxRates } from "./api";
import { useAccount, useRecords } from "./account";
import { useSettings, type Settings } from "./settings";
import { DS, money } from "./valorant";
import { CountUp, Stat } from "../components/ui";
import { Swap } from "../components/anim";

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

const SPEND_CUR_KEY = "riotvault.spendCurrency";

/** Currency switching for a "money spent" figure: the options, the chosen one (remembered), the value to show
 * and the pieces of UI (the one-line detail and the pills). Shared by SpendStat and Overview's Money card. */
function useSpendView(v: number, cur: string, items: { v: number; t: string | null }[]) {
  const { targets, thenNow, convert } = useMoney();
  const options = [cur, ...targets.filter((t) => t !== cur && convert(v, cur, t) != null)];
  const [pick, setPick] = useState<string>(() => {
    try {
      return localStorage.getItem(SPEND_CUR_KEY) ?? cur;
    } catch {
      return cur;
    }
  });
  const shown = options.includes(pick) ? pick : cur;
  const choose = (c: string) => {
    setPick(c);
    try {
      localStorage.setItem(SPEND_CUR_KEY, c);
    } catch {
      /* private mode: just don't remember */
    }
  };
  const tn = shown !== cur ? thenNow(items, cur, shown) : null;
  const now = shown !== cur ? (tn?.now ?? convert(v, cur, shown)) : null;
  const value = shown === cur ? v : (tn?.then ?? now ?? v);
  const detail =
    shown !== cur && now != null ? (
      <div className="num text-[12px] text-muted">
        {tn?.then != null ? (
          <>
            when paid · {money(now, shown)} today{" "}
            <span className="text-[11.5px]">
              <Delta then={tn.then} now={now} />
            </span>
          </>
        ) : (
          <>at today's rate</>
        )}
        <span className="text-faint"> · charged {money(v, cur)}</span>
      </div>
    ) : null;
  const pills =
    options.length > 1 ? (
      <div role="group" aria-label="Show in currency" className="flex flex-wrap gap-1">
        {options.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={shown === c}
            onClick={() => choose(c)}
            title={c === cur ? `What Riot charged, in ${c}` : `Converted to ${c}`}
            className={`num rounded-md px-1.5 py-0.5 text-[11px] font-semibold tracking-wide transition-colors duration-500 ${shown === c ? "bg-accent-soft text-accent" : "text-faint hover:bg-panel-2 hover:text-ink"}`}
          >
            {c}
          </button>
        ))}
      </div>
    ) : null;
  return { shown, value, detail, pills };
}

/**
 * A "money spent" stat card whose big number can be shown in the currency Riot charged or in any display
 * currency (small pills under the number; the choice is remembered in this browser). In a display currency
 * the number is what it cost on each payment's date, with today's value and the change on one plain line.
 */
export function SpendStat({ label, v, cur, items, sub, onClick, action }: { label: string; v: number; cur: string; items: { v: number; t: string | null }[]; sub?: ReactNode; onClick?: () => void; action?: string }) {
  const sv = useSpendView(v, cur, items);
  return (
    <Stat
      label={label}
      value={sv.value}
      format={(x) => money(x, sv.shown)}
      tone="accent"
      onClick={onClick}
      action={action}
      extra={
        <div className="space-y-1.5">
          <Swap k={sv.shown}>{sv.detail}</Swap>
          {sv.pills}
        </div>
      }
      sub={sub}
    />
  );
}

/** The same switchable figure, for use inside another card (no card of its own). */
export function SpendFigure({ v, cur, items, sub }: { v: number; cur: string; items: { v: number; t: string | null }[]; sub?: ReactNode }) {
  const sv = useSpendView(v, cur, items);
  return (
    <div className="space-y-1.5">
      <div className="num text-[30px] font-medium leading-none text-accent">
        <CountUp value={sv.value} format={(x) => money(x, sv.shown)} id="spend-figure" />
      </div>
      <Swap k={sv.shown}>{sv.detail}</Swap>
      {sv.pills}
      {sub && <div className="pt-0.5 text-[12.5px] text-muted">{sub}</div>}
    </div>
  );
}
