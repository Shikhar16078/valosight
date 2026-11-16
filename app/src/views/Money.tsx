import { useMemo } from "react";
import { useAccount, useRecords } from "../lib/account";
import { useAnnotations } from "../lib/annotations";
import type { Rec } from "../lib/api";
import { ConvertedChips, PaidIn, useMoney } from "../lib/convert";
import { allocateVP, type Allocation } from "../lib/fifo";
import { localParts, useSettings } from "../lib/settings";
import { DS, amountPaid, classifyAllVP, isVP, money, n0, payMethod } from "../lib/valorant";
import { Badge, Card, Empty, KV, Page, Stat } from "../components/ui";
import { C, Donut, MonthlyChart, monthSpan } from "../components/charts";
import { DataTable, type Col } from "../components/DataTable";

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
    const m = new Map<number, { amt: number; n: number; vp: number }>();
    const get = (y: number) => m.get(y) ?? (m.set(y, { amt: 0, n: 0, vp: 0 }), m.get(y)!);
    for (const p of pay.data) {
      if (p.currency_code !== main || !p._t) continue;
      const e = get(localParts(p._t, settings.tz).y);
      e.amt += amountPaid(p);
      e.n++;
      e.vp += Number(p.game_currency_granted) || 0;
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [pay.data, main, settings.tz]);
  const maxYear = Math.max(1, ...yearly.map(([, e]) => e.amt));

  // Riot sells VP in fixed top-up plans, so payments of the same amount and currency are the same plan.
  const plans = useMemo(() => {
    const m = new Map<string, { amt: number; cur: string; n: number; vp: number }>();
    for (const p of pay.data) {
      const amt = Math.round(amountPaid(p) * 100) / 100;
      const cur = p.currency_code ?? "?";
      const e = m.get(`${cur} ${amt}`) ?? (m.set(`${cur} ${amt}`, { amt, cur, n: 0, vp: 0 }), m.get(`${cur} ${amt}`)!);
      e.n++;
      e.vp = Math.max(e.vp, Number(p.game_currency_granted) || 0);
    }
    return [...m.values()].sort((a, b) => b.n - a.n || b.amt - a.amt);
  }, [pay.data]);
  const PLANS_SHOWN = 4;

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
    <Page code="01 / Money" title="Real money & VP" loading={pay.loading || payAll.loading || store.loading || storeAll.loading} sub={`Amounts in the currency Riot charged${m$.targets.length ? ` (≈ ${m$.targets.join(", ")} using your rates)` : ""} · times in ${f.tzLabel}`}>
      <Stat
        label="Total paid"
        value={total}
        format={(v) => money(v, main)}
        tone="accent"
        extra={<ConvertedChips v={total} cur={main} items={pay.data.filter((p) => p.currency_code === main).map((p) => ({ v: amountPaid(p), t: p._t }))} />}
        sub={cur.length > 1 ? `+ ${cur.slice(1).map(([c, v]) => money(v, c)).join(", ")}` : `across ${pay.data.length} payments`}
      />
      <Stat
        label="Most bought top-up"
        value={plans[0]?.amt ?? 0}
        format={(v) => (plans[0] ? money(v, plans[0].cur) : "—")}
        extra={
          plans[0] ? (
            <div className="text-[12.5px]">
              <div className="text-muted">
                bought <b className="num text-ink">{plans[0].n}×</b> · {n0(plans[0].vp)} VP each
              </div>
              {plans.length > 1 && (
                <ul className="mt-2 space-y-0.5 border-t border-line pt-2">
                  {plans.slice(1, PLANS_SHOWN).map((x) => (
                    <li key={`${x.cur} ${x.amt}`} className="flex items-baseline justify-between gap-3">
                      <span className="num">
                        {money(x.amt, x.cur)} <span className="text-faint">· {n0(x.vp)} VP</span>
                      </span>
                      <span className="num text-muted">{x.n}×</span>
                    </li>
                  ))}
                  {plans.length > PLANS_SHOWN && <li className="text-faint">+ {plans.length - PLANS_SHOWN} more plans</li>}
                </ul>
              )}
            </div>
          ) : undefined
        }
        sub={plans[0] ? undefined : "no top-ups in this period"}
      />
      <Stat label="VP bought" value={vpBought} sub={`${total ? (vpBought / total).toFixed(2) : "—"} VP per ${main}`} />
      <Stat label="VP spent" value={vpSpent} tone={vpBought - vpSpent < 0 ? "default" : "win"} sub={`difference ${n0(vpBought - vpSpent)} VP (free VP not included)`} />

      <Card span={6} title="Where your VP went">
        <Donut data={vpWhere} format={(v) => `${n0(v)} VP`} center={<><div className="num text-xl font-medium">{n0(vpSpent)}</div><div className="text-[11px] uppercase tracking-widest text-muted">VP spent</div></>} />
      </Card>
      <Card span={6} title="Payment methods">
        <Donut data={methods} format={(v) => money(v, main)} center={<><div className="num text-xl font-medium">{money(methods.reduce((a, m) => a + m.value, 0), main)}</div><div className="text-[11px] uppercase tracking-widest text-muted">Paid</div></>} />
        <div className="mt-4">
          <KV k="Country on payments" v={[...new Set(pay.data.map((p) => p.country_code))].join(", ") || "—"} />
          <KV k="Gifts sent" v={String(pay.data.filter((p) => p.recipient_id).length)} mono />
        </div>
      </Card>

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
