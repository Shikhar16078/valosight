import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type Account, type AccountDetail, type Rec } from "./api";
import { localParts, useSettings } from "./settings";

export type Range = { kind: "all" } | { kind: "year"; y: number } | { kind: "last"; days: number };

interface Ctx {
  accounts: Account[];
  accountId: number | null;
  setAccountId: (id: number) => void;
  detail: AccountDetail | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  range: Range;
  setRange: (r: Range) => void;
  inRange: (iso: string | null | undefined) => boolean;
  years: number[];
  has: (ds: string) => boolean;
}

const AccountCtx = createContext<Ctx | null>(null);
const LS = "riotvault.account";

export function AccountProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setId] = useState<number | null>(null);
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>({ kind: "all" });

  const refresh = useCallback(async () => {
    api.clearCache();
    try {
      const list = await api.accounts();
      setAccounts(list);
      setError(null);
      setId((cur) => {
        if (cur && list.some((a) => a.id === cur)) return cur;
        let saved: number | null = null;
        try {
          saved = Number(localStorage.getItem(LS)) || null;
        } catch {
          /* ignore */
        }
        return list.find((a) => a.id === saved)?.id ?? list[0]?.id ?? null;
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (accountId == null) {
      setDetail(null);
      return;
    }
    let live = true;
    api.account(accountId).then((d) => live && setDetail(d)).catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [accountId, accounts]);

  const setAccountId = useCallback((id: number) => {
    setId(id);
    setRange({ kind: "all" });
    try {
      localStorage.setItem(LS, String(id));
    } catch {
      /* ignore */
    }
  }, []);

  const years = useMemo(() => {
    if (!detail) return [];
    const ys = new Set<number>();
    for (const d of detail.datasets)
      if (d.first && d.last) for (let y = +d.first.slice(0, 4); y <= +d.last.slice(0, 4); y++) ys.add(y);
    return [...ys].sort((a, b) => b - a);
  }, [detail]);

  const inRange = useCallback(
    (iso: string | null | undefined) => {
      if (range.kind === "all") return true;
      if (!iso) return false;
      if (range.kind === "year") return localParts(iso, settings.tz).y === range.y;
      const end = detail?.datasets.reduce((m, d) => (d.last && d.last > m ? d.last : m), "") || new Date().toISOString();
      return Date.parse(iso) >= Date.parse(end) - range.days * 864e5;
    },
    [range, settings.tz, detail],
  );

  const has = useCallback(
    (ds: string) => !!detail?.datasets.some((d) => d.dataset === ds && (d.mode === "snapshot" || d.count > 0)),
    [detail],
  );

  return (
    <AccountCtx.Provider
      value={{ accounts, accountId, setAccountId, detail, loading, error, refresh, range, setRange, inRange, years, has }}
    >
      {children}
    </AccountCtx.Provider>
  );
}

export function useAccount() {
  const c = useContext(AccountCtx);
  if (!c) throw new Error("AccountProvider missing");
  return c;
}

/** Records of a dataset for the current account. `filtered` applies the global date range. */
export function useRecords(ds: string, filtered = true) {
  const { accountId, inRange, has, detail } = useAccount();
  const [all, setAll] = useState<Rec[] | null>(null);
  const exists = has(ds);
  useEffect(() => {
    setAll(null);
    if (accountId == null || !detail) return;
    if (!exists) {
      setAll([]);
      return;
    }
    let live = true;
    api.records(accountId, ds).then((r) => live && setAll(r)).catch(() => live && setAll([]));
    return () => {
      live = false;
    };
  }, [accountId, ds, exists, detail]);
  const data = useMemo(() => (all && filtered ? all.filter((r) => inRange(r._t)) : all), [all, filtered, inRange]);
  return { data: data ?? [], all: all ?? [], loading: all === null };
}
