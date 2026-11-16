import { useMemo } from "react";
import { useAccount, useRecords } from "../lib/account";
import { useAnnotations } from "../lib/annotations";
import type { Rec } from "../lib/api";
import { ConvertedChips, PaidIn, useMoney } from "../lib/convert";
import { allocateVP, type Allocation } from "../lib/fifo";
import { localParts, useSettings } from "../lib/settings";
import { DS, amountPaid, classifyAllVP, isRealMatch, isVP, matchMinutes, money, n0, payMethod } from "../lib/valorant";
import { Badge, Card, Empty, KV, Page, Stat } from "../components/ui";
import { C, Donut, MonthlyChart, WeekHourHeatmap, monthSpan } from "../components/charts";
import { DataTable, type Col } from "../components/DataTable";

const WD = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
const IMPULSE_MIN = 15;

/** IP of the login event closest to `t` (within 6 h). `logins` must be sorted by time. */
export function nearestIp(logins: Rec[], t: string): string | null {
  const ts = Date.parse(t);
  let lo = 0,
    hi = logins.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (Date.parse(logins[mid]._t!) < ts) lo = mid + 1;
    else hi = mid;
  }
  let best: Rec | null = null,
    bd = 6 * 3600e3;
  for (let i = Math.max(0, lo - 30); i < Math.min(logins.length, lo + 30); i++) {
    const l = logins[i];
    if (!l.ip_address || l.ip_address === "Unknown") continue;
    const d = Math.abs(Date.parse(l._t!) - ts);
    if (d < bd) {
      bd = d;
      best = l;
    }
  }
  return best?.ip_address ?? null;
}

export function Money() {
  const { has } = useAccount();
  const { f, settings } = useSettings();
  const m$ = useMoney();
  const pay = useRecords(DS.payments);
  const payAll = useRecords(DS.payments, false);
  const store = useRecords(DS.store);
  const storeAll = useRecords(DS.store, false);
  const mh = useRecords(DS.matches);
  const logins = useRecords(DS.logins, false);
  const tags = useAnnotations("ip");

  const cur = useMemo(() => {
    const by = new Map<string, number>();
    for (const p of pay.data) by.set(p.currency_code ?? "?", (by.get(p.currency_code ?? "?") ?? 0) + amountPaid(p));
    return [...by.entries()].sort((a, b) => b[1] - a[1]);
  }, [pay.data]);
  const main = cur[0]?.[0] ?? payAll.all[0]?.currency_code ?? "USD";
  const total = cur[0]?.[1] ?? 0;
  const vpBought = pay.data.reduce((a, p) => a + (Number(p.game_currency_granted) || 0), 0);
  const vpItems = useMemo(() => classifyAllVP(store.data, storeAll.all), [store.data, storeAll.all]);
  const vpById = useMemo(() => new Map(classifyAllVP(storeAll.all).map((x) => [x.r.transaction_id, x])), [storeAll.all]);
  const vpSpent = vpItems.reduce((a, x) => a + x.cost, 0);

  // FIFO always runs over the full history so a filtered period still knows where earlier VP came from.
  const fifo = useMemo(() => allocateVP(payAll.all, storeAll.all), [payAll.all, storeAll.all]);

  const monthly = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pay.data) if (p.currency_code === main && p._t) m.set(f.monthKey(p._t), (m.get(f.monthKey(p._t)) ?? 0) + amountPaid(p));
    return monthSpan([...m.keys()]).map((k) => ({ month: k, spend: m.get(k) ?? 0 }));
  }, [pay.data, main, f]);

  const balance = useMemo(() => {
    const ev = new Map<string, { bought: number; spent: number }>();
    const get = (k: string) => ev.get(k) ?? (ev.set(k, { bought: 0, spent: 0 }), ev.get(k)!);
    for (const p of payAll.all) if (p._t) get(f.monthKey(p._t)).bought += Number(p.game_currency_granted) || 0;
    for (const r of storeAll.all) if (isVP(r) && r._t) get(f.monthKey(r._t)).spent += Number(r.spent_currency_amount) || 0;
    let run = 0;
    return monthSpan([...ev.keys()]).map((k) => {
      const e = ev.get(k) ?? { bought: 0, spent: 0 };
      run += e.bought - e.spent;
      return { month: k, bought: e.bought, spent: e.spent, balance: run };
    });
  }, [payAll.all, storeAll.all, f]);
  const lowest = Math.min(0, ...balance.map((b) => b.balance));

  const yearly = useMemo(() => {
    const m = new Map<number, { amt: number; n: number; vp: number; min: number; games: number }>();
    const get = (y: number) => m.get(y) ?? (m.set(y, { amt: 0, n: 0, vp: 0, min: 0, games: 0 }), m.get(y)!);
    for (const p of pay.data) {
      if (p.currency_code !== main || !p._t) continue;
      const e = get(localParts(p._t, settings.tz).y);
      e.amt += amountPaid(p);
      e.n++;
      e.vp += Number(p.game_currency_granted) || 0;
    }
    for (const g of mh.data) {
      if (!g._t || !isRealMatch(g)) continue;
      const e = get(localParts(g._t, settings.tz).y);
      e.min += matchMinutes(g) ?? 0;
      e.games++;
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [pay.data, mh.data, main, settings.tz]);
  const maxYear = Math.max(1, ...yearly.map(([, e]) => e.amt));

  const habits = useMemo(() => {
    const ps = pay.data.filter((p) => p._t).sort((a, b) => a._t!.localeCompare(b._t!));
    const spends = storeAll.all.filter((r) => isVP(r) && r._t).sort((a, b) => a._t!.localeCompare(b._t!));
    const impulse: { p: Rec; first: Rec; minutes: number }[] = [];
    for (const p of ps) {
      const t = Date.parse(p._t!);
      const s = spends.find((r) => Date.parse(r._t!) >= t && Date.parse(r._t!) - t <= IMPULSE_MIN * 60e3);
      if (s) impulse.push({ p, first: s, minutes: Math.max(0, Math.round((Date.parse(s._t!) - t) / 60e3)) });
    }
    const gaps = ps.slice(1).map((p, i) => (Date.parse(p._t!) - Date.parse(ps[i]._t!)) / 864e5);
    const median = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : null;
    const wd = Array(7).fill(0) as number[];
    for (const p of ps) wd[localParts(p._t!, settings.tz).wd]++;
    const topWd = wd.indexOf(Math.max(...wd));
    return { impulse, median, topWd: ps.length ? topWd : -1, topWdN: wd[topWd] ?? 0 };
  }, [pay.data, storeAll.all, settings.tz]);

  const vpWhere = useMemo(() => {
    const label = (c: string) => (c === "Skin" ? "Skins" : c === "Battle Pass" ? "Battle passes" : c === "Bundle" ? "Bundles" : "Unknown items");
    const m = new Map<string, number>();
    for (const x of vpItems) m.set(label(x.category), (m.get(label(x.category)) ?? 0) + x.cost);
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [vpItems]);

  const methods = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pay.data) m.set(payMethod(p.payment_method), (m.get(payMethod(p.payment_method)) ?? 0) + amountPaid(p));
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [pay.data]);

  const rows = useMemo(() => {
    let run = 0;
    const before = payAll.all.filter((p) => p.currency_code === main && pay.data[0]?._t && p._t! < pay.data[0]._t!).reduce((a, p) => a + amountPaid(p), 0);
    run = before;
    return pay.data.map((p) => {
      if (p.currency_code === main) run += amountPaid(p);
      const allocs = fifo.byPayment.get(payAll.all.find((x) => x.player_facing_purchase_id === p.player_facing_purchase_id) ?? p) ?? [];
      return { p, run, allocs, ip: logins.all.length ? nearestIp(logins.all, p._t!) : null };
    });
  }, [pay.data, payAll.all, logins.all, main, fifo]);

  const cols: Col<(typeof rows)[number]>[] = [
    { id: "date", header: "Date", value: (r) => r.p._t, cell: (r) => <span className="num">{f.date(r.p._t)}</span> },
    { id: "time", header: `Time (${f.tzLabel})`, value: (r) => f.time(r.p._t, true), mono: true },
    {
      id: "amt",
      header: "Amount",
      value: (r) => amountPaid(r.p),
      cell: (r) => (
        <span className="flex flex-col items-end leading-tight">
          <b className="num">{money(amountPaid(r.p), r.p.currency_code, 2)}</b>
          <PaidIn v={amountPaid(r.p)} cur={r.p.currency_code} t={r.p._t} />
        </span>
      ),
      align: "right",
    },
    { id: "vp", header: "Received", value: (r) => Number(r.p.game_currency_granted), cell: (r) => <span className="num">{n0(r.p.game_currency_granted)} {r.p.game_currency_type}</span>, align: "right" },
    {
      id: "bought",
      header: "Spent on",
      value: (r) => r.allocs.length,
      cell: (r) => (r.allocs.length ? <span className="text-[12.5px]">{new Set(r.allocs.map((a) => a.item)).size} items</span> : <span className="text-faint">—</span>),
    },
    { id: "method", header: "Method", value: (r) => payMethod(r.p.payment_method) },
    { id: "id", header: "Purchase ID", value: (r) => r.p.player_facing_purchase_id, mono: true },
    {
      id: "ip",
      header: "Login IP nearby",
      value: (r) => r.ip ?? "",
      cell: (r) =>
        r.ip ? (
          <span className="flex items-center gap-1.5">
            <span className="num text-[12.5px]">{r.ip.length > 22 ? r.ip.slice(0, 20) + "…" : r.ip}</span>
            {tags.map[r.ip] === "mine" ? <Badge tone="win">mine</Badge> : tags.map[r.ip] === "not-mine" ? <Badge tone="accent">not mine</Badge> : <Badge>untagged</Badge>}
          </span>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
    { id: "run", header: "Running total", value: (r) => r.run, cell: (r) => <span className="num text-muted">{money(r.run, main, 0)}</span>, align: "right" },
  ];

  if (!has(DS.payments)) return <Page code="01 / Money" title="Money"><Card><Empty title="No payment data">This export has no VALORANT payment records.</Empty></Card></Page>;

  return (
    <Page code="01 / Money" title="Real money & VP" loading={pay.loading || payAll.loading || store.loading || storeAll.loading || mh.loading} sub={`Amounts in the currency Riot charged${m$.targets.length ? ` (≈ ${m$.targets.join(", ")} using your rates)` : ""} · times in ${f.tzLabel}`}>
      <Stat
        label="Total paid"
        value={total}
        format={(v) => money(v, main)}
        tone="accent"
        extra={<ConvertedChips v={total} cur={main} items={pay.data.filter((p) => p.currency_code === main).map((p) => ({ v: amountPaid(p), t: p._t }))} />}
        sub={cur.length > 1 ? `+ ${cur.slice(1).map(([c, v]) => money(v, c)).join(", ")}` : `across ${pay.data.length} payments`}
      />
      <Stat label="Average payment" value={pay.data.length ? total / pay.data.length : 0} format={(v) => money(v, main)} sub={`largest ${money(Math.max(0, ...pay.data.map(amountPaid)), main)}`} />
      <Stat label="VP bought" value={vpBought} sub={`${total ? (vpBought / total).toFixed(2) : "—"} VP per ${main}`} />
      <Stat label="VP spent" value={vpSpent} tone={vpBought - vpSpent < 0 ? "default" : "win"} sub={`difference ${n0(vpBought - vpSpent)} VP (free VP not included)`} />

      <Card span={8} title="Spending per month" hint={`${main} paid each month`}>
        {monthly.length ? <MonthlyChart data={monthly} series={[{ key: "spend", label: "Paid", color: C.accent }]} yFormat={(v) => money(v, main)} /> : <Empty title="No payments in this period" />}
      </Card>
      <Card span={4} title="By year">
        <div className="space-y-3">
          {yearly
            .filter(([, e]) => e.n)
            .map(([y, e]) => (
              <div key={y}>
                <div className="flex items-baseline justify-between">
                  <span className="num font-medium">{y}</span>
                  <span className="num">{money(e.amt, main)}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-panel-2">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${(e.amt / maxYear) * 100}%`, transition: "width .6s" }} />
                </div>
                <div className="num mt-0.5 text-[12px] text-muted">
                  {e.n} payments · {n0(e.vp)} VP{m$.homeOnly(e.amt, main) ? ` · ${m$.homeOnly(e.amt, main)}` : ""}
                </div>
              </div>
            ))}
        </div>
      </Card>

      <Card
        span={12}
        title="VP balance over time"
        hint={
          lowest < 0
            ? `Bars: VP bought and spent each month · line: running balance. It dips to ${n0(lowest)} — that VP came from somewhere other than a payment (free VP, rewards or gifts).`
            : "Bars: VP bought and spent each month · line: running balance (bought − spent; free VP not included)"
        }
      >
        <MonthlyChart
          data={balance}
          height={260}
          series={[
            { key: "bought", label: "VP bought", color: C.info },
            { key: "spent", label: "VP spent", color: C.accent },
            { key: "balance", label: "Balance", color: C.warn, line: true, axis: "l" },
          ]}
        />
        <div className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-[13px] text-muted">
          <span>
            Estimated VP left: <b className="num text-ink">{n0(fifo.leftoverVP)}</b>
          </span>
          <span>
            VP spent without a matching payment: <b className="num text-ink">{n0(fifo.unfundedVP)}</b>
          </span>
        </div>
      </Card>

      <Card span={6} title="Cost per hour played" hint={`${main} paid ÷ time in matches, per year`} pad={false}>
        <table className="w-full text-[13.5px]">
          <thead>
            <tr className="bg-panel-2 text-left text-[11.5px] uppercase tracking-[0.08em] text-muted">
              <th className="px-5 py-2.5">Year</th>
              <th className="px-3 py-2.5 text-right">Paid</th>
              <th className="px-3 py-2.5 text-right">Hours</th>
              <th className="px-3 py-2.5 text-right">Per hour</th>
              <th className="px-5 py-2.5 text-right">Per match</th>
            </tr>
          </thead>
          <tbody>
            {yearly.map(([y, e]) => {
              const h = e.min / 60;
              return (
                <tr key={y} className="border-b border-line last:border-0">
                  <td className="num px-5 py-2.5 font-medium">{y}</td>
                  <td className="num px-3 py-2.5 text-right">{money(e.amt, main)}</td>
                  <td className="num px-3 py-2.5 text-right">{h.toFixed(0)}</td>
                  <td className="num px-3 py-2.5 text-right">{h >= 1 ? money(e.amt / h, main, 2) : "—"}</td>
                  <td className="num px-5 py-2.5 text-right">{e.games ? money(e.amt / e.games, main, 2) : "—"}</td>
                </tr>
              );
            })}
            {(() => {
              const t = yearly.reduce((a, [, e]) => ({ amt: a.amt + e.amt, min: a.min + e.min, games: a.games + e.games }), { amt: 0, min: 0, games: 0 });
              return (
                <tr className="bg-panel-2 font-semibold">
                  <td className="px-5 py-2.5">All</td>
                  <td className="num px-3 py-2.5 text-right">{money(t.amt, main)}</td>
                  <td className="num px-3 py-2.5 text-right">{(t.min / 60).toFixed(0)}</td>
                  <td className="num px-3 py-2.5 text-right">{t.min >= 60 ? money(t.amt / (t.min / 60), main, 2) : "—"}</td>
                  <td className="num px-5 py-2.5 text-right">{t.games ? money(t.amt / t.games, main, 2) : "—"}</td>
                </tr>
              );
            })()}
          </tbody>
        </table>
      </Card>

      <Card span={6} title="Spending habits">
        <KV k="You usually top up on" v={habits.topWd >= 0 ? `${WD[habits.topWd]} (${habits.topWdN}×)` : "—"} />
        <KV k="Typical gap between top-ups" v={habits.median != null ? `${Math.round(habits.median)} days` : "—"} />
        <KV k={`Bought something within ${IMPULSE_MIN} min of topping up`} v={`${habits.impulse.length} of ${pay.data.length} top-ups`} />
        {habits.impulse.length > 0 && (
          <ul className="mt-2 space-y-1 text-[12.5px] text-muted">
            {habits.impulse
              .slice(-5)
              .reverse()
              .map(({ p, first, minutes }) => (
                <li key={p.player_facing_purchase_id} className="flex justify-between gap-3">
                  <span className="num">{f.date(p._t)}</span>
                  <span className="truncate">
                    {money(amountPaid(p), p.currency_code)} → {(() => { const x = vpById.get(first.transaction_id); return x ? (x.category === "Battle Pass" ? x.pass : x.name) : first.item_name; })()} <span className="text-faint">({minutes} min)</span>
                  </span>
                </li>
              ))}
          </ul>
        )}
      </Card>

      <Card span={12} title="When you spend" hint="Top-ups and VP purchases by weekday and hour">
        <WeekHourHeatmap times={[...pay.data, ...store.data.filter(isVP)].map((r) => r._t!).filter(Boolean)} label="purchases" />
      </Card>

      <Card span={6} title="Where your VP went">
        <Donut data={vpWhere} format={(v) => `${n0(v)} VP`} center={<><div className="num text-xl font-medium">{n0(vpSpent)}</div><div className="text-[11px] uppercase tracking-widest text-muted">VP spent</div></>} />
      </Card>
      <Card span={6} title="Payment methods">
        <Donut data={methods} format={(v) => money(v, main)} />
        <div className="mt-4">
          <KV k="Country on payments" v={[...new Set(pay.data.map((p) => p.country_code))].join(", ") || "—"} />
          <KV k="Gifts sent" v={String(pay.data.filter((p) => p.recipient_id).length)} mono />
        </div>
      </Card>

      <Card span={12} title="Every payment" hint="Click a payment to see what its VP was spent on (oldest VP is used first — an estimate, Riot doesn't record this link)" pad={false}>
        <DataTable rows={rows} cols={cols} initialSort={{ id: "date", desc: true }} filename="payments" rowTone={(r) => (r.ip && tags.map[r.ip] === "not-mine" ? "accent" : undefined)} expand={(r) => <SpentOn allocs={r.allocs} />} />
      </Card>
    </Page>
  );
}

function SpentOn({ allocs }: { allocs: Allocation[] }) {
  const { f } = useSettings();
  if (!allocs.length) return <div className="py-2 pl-6 text-[13px] text-muted">None of this VP has been spent yet (or it went to items Riot didn't record).</div>;
  const vp = allocs.reduce((a, x) => a + x.vp, 0);
  return (
    <div className="pl-6">
      <ul className="divide-y divide-line">
        {allocs.map((a, i) => (
          <li key={i} className="grid grid-cols-[110px_1fr_auto_auto] items-baseline gap-x-4 py-1.5 text-[13px]">
            <span className="num text-muted">{f.date(a.item.t)}</span>
            <span className="truncate font-medium">
              {a.item.category === "Battle Pass" ? a.item.pass : a.item.name}
              {a.vp < a.item.cost && <span className="ml-2 text-[12px] font-normal text-faint">part of {n0(a.item.cost)} VP</span>}
            </span>
            <span className="num text-right">{n0(a.vp)} VP</span>
            <span className="num w-[110px] text-right text-muted">≈ {money(a.money, a.payment?.currency_code ?? "USD", 0)}</span>
          </li>
        ))}
      </ul>
      <div className="num mt-1 text-right text-[12px] text-muted">{n0(vp)} VP of this top-up used</div>
    </div>
  );
}
