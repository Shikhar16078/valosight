import { useEffect, useMemo, useState } from "react";
import { useAccount } from "../lib/account";
import { api, type Account, type Rec } from "../lib/api";
import { useMoney } from "../lib/convert";
import { useSettings } from "../lib/settings";
import { DS, amountPaid, classifyAllVP, isRealMatch, matchMinutes, money, n0 } from "../lib/valorant";
import { Badge, Card, Page, Stat } from "../components/ui";
import { MonthlyChart, SERIES, monthSpan } from "../components/charts";

interface Row {
  a: Account;
  pay: Rec[];
  store: Rec[];
  matches: Rec[];
  audit: Rec[];
  logins: Rec[];
}

const label = (a: Account) => (a.game_name ? `${a.game_name}#${a.tagline ?? ""}` : a.username);

export function AllAccounts({ open }: { open: (id: number) => void }) {
  const { accounts } = useAccount();
  const { f } = useSettings();
  const m$ = useMoney();
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let live = true;
    setRows(null);
    const get = (id: number, ds: string) => api.records(id, ds).catch(() => [] as Rec[]);
    Promise.all(
      accounts.map(async (a) => {
        const [pay, store, matches, audit, logins] = await Promise.all([get(a.id, DS.payments), get(a.id, DS.store), get(a.id, DS.matches), get(a.id, DS.audit), get(a.id, DS.logins)]);
        return { a, pay, store, matches, audit, logins };
      }),
    ).then((r) => live && setRows(r));
    return () => {
      live = false;
    };
  }, [accounts]);

  const stats = useMemo(
    () =>
      (rows ?? []).map((r) => {
        const games = r.matches.filter(isRealMatch);
        const wins = games.filter((g) => g.game_outcome === "Win").length;
        const dec = games.filter((g) => g.game_outcome === "Win" || g.game_outcome === "Loss").length;
        const byCur = new Map<string, number>();
        for (const p of r.pay) byCur.set(p.currency_code, (byCur.get(p.currency_code) ?? 0) + amountPaid(p));
        return {
          r,
          byCur,
          games: games.length,
          hours: games.reduce((a, g) => a + (matchMinutes(g) ?? 0), 0) / 60,
          winRate: dec ? (wins / dec) * 100 : null,
          skins: classifyAllVP(r.store).filter((x) => x.category === "Skin").length,
          alerts: r.audit.filter((x) => x.event_type === "ANOMALOUS_ACTIVITY").length,
          ips: new Set(r.logins.map((l) => l.ip_address)).size,
          last: r.logins[r.logins.length - 1]?._t ?? r.matches[r.matches.length - 1]?._t ?? null,
        };
      }),
    [rows],
  );

  const totals = useMemo(() => {
    const cur = new Map<string, number>();
    let home = 0;
    let homeOk = !!m$.home;
    for (const s of stats)
      for (const [c, v] of s.byCur) {
        cur.set(c, (cur.get(c) ?? 0) + v);
        const h = c === m$.home ? v : m$.convert(v, c);
        if (h == null) homeOk = false;
        else home += h;
      }
    return {
      cur: [...cur.entries()].sort((a, b) => b[1] - a[1]),
      home: homeOk ? home : null,
      games: stats.reduce((a, s) => a + s.games, 0),
      hours: stats.reduce((a, s) => a + s.hours, 0),
      skins: stats.reduce((a, s) => a + s.skins, 0),
      alerts: stats.reduce((a, s) => a + s.alerts, 0),
    };
  }, [stats, m$]);

  const activity = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    for (const s of stats)
      for (const g of s.r.matches.filter(isRealMatch)) {
        if (!g._t) continue;
        const k = f.monthKey(g._t);
        const e = m.get(k) ?? {};
        e[`a${s.r.a.id}`] = (e[`a${s.r.a.id}`] ?? 0) + 1;
        m.set(k, e);
      }
    return monthSpan([...m.keys()]).map((k) => ({ month: k, ...(m.get(k) ?? {}) }));
  }, [stats, f]);

  const money1 = totals.cur[0];
  return (
    <Page code="∑ / All accounts" title="All accounts" sub={`${accounts.length} account${accounts.length === 1 ? "" : "s"} in this vault · times in ${f.tzLabel}`}>
      {!rows ? (
        <Card span={12}>
          <div className="py-10 text-center text-muted">Loading every account…</div>
        </Card>
      ) : (
        <>
          <Stat
            label="Spent across accounts"
            value={totals.home ?? money1?.[1] ?? 0}
            format={(v) => (totals.home != null ? money(v, m$.home) : money(v, money1?.[0] ?? "USD"))}
            tone="accent"
            sub={totals.home != null ? totals.cur.map(([c, v]) => money(v, c)).join(" + ") : totals.cur.length > 1 ? `+ ${totals.cur.slice(1).map(([c, v]) => money(v, c)).join(", ")} — set a home currency to combine` : "all payments"}
          />
          <Stat label="Matches" value={totals.games} sub={`${n0(totals.hours)} hours`} />
          <Stat label="Skins bought" value={totals.skins} />
          <Stat label="Riot alerts" value={totals.alerts} tone={totals.alerts ? "warn" : "default"} />

          <Card span={12} title="Side by side" hint="Click an account to open its dashboard" pad={false}>
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full text-[13.5px]">
                <thead>
                  <tr className="bg-panel-2 text-left text-[11.5px] uppercase tracking-[0.08em] text-muted">
                    <th className="px-4 py-2.5">Account</th>
                    <th className="px-4 py-2.5 text-right">Spent</th>
                    <th className="px-4 py-2.5 text-right">Payments</th>
                    <th className="px-4 py-2.5 text-right">Matches</th>
                    <th className="px-4 py-2.5 text-right">Hours</th>
                    <th className="px-4 py-2.5 text-right">Win rate</th>
                    <th className="px-4 py-2.5 text-right">Skins</th>
                    <th className="px-4 py-2.5 text-right">IPs</th>
                    <th className="px-4 py-2.5 text-right">Alerts</th>
                    <th className="px-4 py-2.5">Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((s, i) => (
                    <tr key={s.r.a.id} onClick={() => open(s.r.a.id)} className="cursor-pointer border-b border-line last:border-0 hover:bg-panel-2">
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES[i % SERIES.length] }} />
                          <span className="font-medium">{label(s.r.a)}</span>
                        </span>
                        <span className="num pl-[18px] text-[12px] text-muted">{s.r.a.username}</span>
                      </td>
                      <td className="num whitespace-nowrap px-4 py-2.5 text-right">{[...s.byCur].map(([c, v]) => m$.fmt(v, c)).join(" + ") || "—"}</td>
                      <td className="num px-4 py-2.5 text-right">{s.r.pay.length}</td>
                      <td className="num px-4 py-2.5 text-right">{n0(s.games)}</td>
                      <td className="num px-4 py-2.5 text-right">{n0(s.hours)}</td>
                      <td className="num px-4 py-2.5 text-right">{s.winRate == null ? "—" : `${s.winRate.toFixed(1)}%`}</td>
                      <td className="num px-4 py-2.5 text-right">{s.skins}</td>
                      <td className="num px-4 py-2.5 text-right">{s.ips}</td>
                      <td className="px-4 py-2.5 text-right">{s.alerts ? <Badge tone="warn">{s.alerts}</Badge> : <span className="text-faint">0</span>}</td>
                      <td className="num px-4 py-2.5">{f.date(s.last)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card span={12} title="Matches per month, by account">
            <MonthlyChart data={activity} series={stats.map((s, i) => ({ key: `a${s.r.a.id}`, label: label(s.r.a), color: SERIES[i % SERIES.length], stack: true }))} />
          </Card>
        </>
      )}
    </Page>
  );
}
