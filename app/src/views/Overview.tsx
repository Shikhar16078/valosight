import { CreditCard, Gavel, ShieldAlert, Sparkles } from "lucide-react";
import { useMemo, type ReactElement } from "react";
import { useAccount, useRecords } from "../lib/account";
import { useSettings } from "../lib/settings";
import { ConvertedChips } from "../lib/convert";
import { DS, amountPaid, auditInfo, classifyAllVP, classifyOther, groupUpgrades, isRealMatch, isRP, isVP, matchMinutes, money, n0, parseUpgrade, PENALTY } from "../lib/valorant";
import { Badge, Card, KV, Page, Stat } from "../components/ui";
import { C, CalendarHeatmap, MonthlyChart, monthSpan } from "../components/charts";

export function Overview() {
  const { detail, years, range } = useAccount();
  const { f } = useSettings();
  const info = (detail?.snapshots[DS.info] ?? {}) as Record<string, string>;
  const pay = useRecords(DS.payments);
  const mh = useRecords(DS.matches);
  const store = useRecords(DS.store);
  const audit = useRecords(DS.audit);
  const auditAll = useRecords(DS.audit, false);
  const pen = useRecords(DS.penalties);
  const logins = useRecords(DS.logins);

  const created = useMemo(() => {
    const c = auditAll.all.find((r) => r.event_type === "CREATED");
    if (c) return c._t;
    const firsts = detail?.datasets.map((d) => d.first).filter(Boolean) as string[];
    return firsts?.sort()[0] ?? null;
  }, [auditAll.all, detail]);

  const spend = useMemo(() => {
    const by = new Map<string, number>();
    for (const p of pay.data) by.set(p.currency_code ?? "?", (by.get(p.currency_code ?? "?") ?? 0) + amountPaid(p));
    return [...by.entries()].sort((a, b) => b[1] - a[1]);
  }, [pay.data]);
  const region = pay.all[0] ? `${pay.all[0].country_code ?? "?"} · ${pay.all[0].currency_code ?? "?"}` : null;

  const games = useMemo(() => mh.data.filter(isRealMatch), [mh.data]);
  const wins = games.filter((m) => m.game_outcome === "Win").length;
  const decided = games.filter((m) => m.game_outcome === "Win" || m.game_outcome === "Loss").length;
  const hours = games.reduce((a, m) => a + (matchMinutes(m) ?? 0), 0) / 60;
  const coll = useMemo(() => {
    const vp = classifyAllVP(store.data, store.all);
    const bought = vp.filter((x) => x.category === "Skin");
    const ups = groupUpgrades(store.data.filter(isRP).map(parseUpgrade));
    ups.delete("Unknown skin");
    const owned = new Set([...bought.map((x) => x.name), ...ups.keys()]);
    const other = store.data.filter((r) => !isVP(r) && !isRP(r)).map(classifyOther);
    return {
      owned: owned.size,
      bought: bought.length,
      passes: vp.filter((x) => x.category === "Battle Pass").length,
      passVP: vp.filter((x) => x.category === "Battle Pass").reduce((a, x) => a + x.cost, 0),
      bundles: vp.filter((x) => x.category === "Bundle").length,
      upgraded: ups.size,
      maxed: [...ups.values()].filter((u) => u.maxLevel >= 4).length,
      rp: store.data.filter(isRP).reduce((a, r) => a + (Number(r.spent_currency_amount) || 0), 0),
      agents: other.filter((o) => o.kind === "Agent unlock").length,
      otherItems: other.filter((o) => o.kind !== "Agent unlock").length,
    };
  }, [store.data]);
  const alerts = audit.data.filter((r) => r.event_type === "ANOMALOUS_ACTIVITY").length;
  const ips = new Set(logins.data.map((l) => l.ip_address)).size;

  const monthly = useMemo(() => {
    const m = new Map<string, { w: number; l: number; o: number; spend: number }>();
    const get = (k: string) => m.get(k) ?? (m.set(k, { w: 0, l: 0, o: 0, spend: 0 }), m.get(k)!);
    for (const g of games) {
      if (!g._t) continue;
      const e = get(f.monthKey(g._t));
      if (g.game_outcome === "Win") e.w++;
      else if (g.game_outcome === "Loss") e.l++;
      else e.o++;
    }
    return monthSpan([...m.keys()]).map((k) => ({ month: k, win: m.get(k)?.w ?? 0, loss: m.get(k)?.l ?? 0, other: m.get(k)?.o ?? 0 }));
  }, [games, f]);

  const feed = useMemo(() => {
    const ev: { t: string; icon: ReactElement; text: string; tone: "accent" | "win" | "warn" | "info" | "neutral"; tag: string }[] = [];
    for (const p of pay.data) ev.push({ t: p._t!, icon: <CreditCard size={14} />, text: `Paid ${money(amountPaid(p), p.currency_code, 0)} for ${Number(p.game_currency_granted).toLocaleString("en")} ${p.game_currency_type ?? ""}`, tone: "info", tag: "Payment" });
    for (const s of classifyAllVP(store.data, store.all)) if (s.category !== "Unknown") ev.push({ t: s.t, icon: <Sparkles size={14} />, text: s.category === "Battle Pass" ? s.pass! : s.name, tone: "neutral", tag: s.category });
    for (const a of audit.data) {
      const i = auditInfo(a);
      if (i.level >= 1) ev.push({ t: a._t!, icon: <ShieldAlert size={14} />, text: i.label, tone: i.level === 2 ? "accent" : "warn", tag: "Security" });
    }
    for (const p of pen.data) ev.push({ t: p._t!, icon: <Gavel size={14} />, text: PENALTY[p.restriction_type] ?? p.restriction_type, tone: "warn", tag: "Penalty" });
    return ev.filter((e) => e.t).sort((a, b) => b.t.localeCompare(a.t)).slice(0, 12);
  }, [pay.data, store.data, audit.data, pen.data]);

  const rangeLabel = range.kind === "all" ? "All time" : range.kind === "year" ? String(range.y) : `Last ${range.days} days of data`;
  const name = info.game_name ? `${info.game_name}` : detail?.username;

  return (
    <Page code="00 / Overview" loading={pay.loading || mh.loading || store.loading || audit.loading || pen.loading || logins.loading} title="Account at a glance" sub={`${rangeLabel} · times in ${f.tzLabel}`}>
      <Card span={12} accent pad={false}>
        <div className="flex flex-wrap items-center gap-x-10 gap-y-4 px-6 py-5">
          <div className="min-w-0">
            <div className="font-display text-[34px] font-bold leading-none tracking-tight">
              {name}
              {info.tagline && <span className="text-muted">#{info.tagline}</span>}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[13px] text-muted">
              <Badge>login · {detail?.username}</Badge>
              {region && <Badge tone="info">store · {region}</Badge>}
            </div>
          </div>
          <div className="grid flex-1 grid-cols-2 gap-x-8 gap-y-1 sm:grid-cols-4">
            <Meta k="Account created" v={f.date(created)} />
            <Meta k="Data covers" v={`${f.date(detail?.datasets.map((d) => d.first).filter(Boolean).sort()[0] as string)} → ${f.date(detail?.datasets.map((d) => d.last).filter(Boolean).sort().at(-1) as string)}`} />
            <Meta k="Last import" v={f.relative(detail?.imports[0]?.imported_at)} />
            <Meta k="Imports" v={String(detail?.imports.length ?? 0)} />
          </div>
        </div>
      </Card>

      <Stat
        label="Real money spent"
        value={spend[0]?.[1] ?? 0}
        format={(v) => money(v, spend[0]?.[0] ?? "USD")}
        tone="accent"
        extra={spend[0] && <ConvertedChips v={spend[0][1]} cur={spend[0][0]} items={pay.data.filter((p) => p.currency_code === spend[0][0]).map((p) => ({ v: amountPaid(p), t: p._t }))} />}
        sub={spend.length > 1 ? `+ ${spend.slice(1).map(([c, v]) => money(v, c)).join(", ")}` : `${pay.data.length} payments`}
      />
      <Stat label="Matches played" value={games.length} sub={`${hours.toFixed(0)} hours in game`} />
      <Stat label="Win rate" value={decided ? (wins / decided) * 100 : 0} format={(v) => `${v.toFixed(1)}%`} tone="win" sub={`${wins.toLocaleString("en")} W · ${(decided - wins).toLocaleString("en")} L`} />
      <Stat label="Security alerts" value={alerts} tone={alerts ? "warn" : "default"} sub={`${ips} different IP addresses`} />

      <Card span={8} title="Activity" hint="Matches per month (excluding range & tutorial)">
        {monthly.length ? (
          <MonthlyChart
            data={monthly}
            series={[
              { key: "win", label: "Wins", color: C.win, stack: true },
              { key: "loss", label: "Losses", color: C.loss, stack: true },
              { key: "other", label: "Draw / other", color: C.muted, stack: true },
            ]}
          />
        ) : (
          <div className="py-16 text-center text-muted">No matches in this period.</div>
        )}
      </Card>

      <Card span={4} title="Recent events" hint="Payments, purchases, security & penalties" pad={false}>
        <ul className="scroll-thin max-h-[300px] overflow-y-auto px-5 py-2">
          {feed.map((e, i) => (
            <li key={i} className="flex gap-3 border-b border-dashed border-line py-2.5 last:border-0">
              <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${e.tone === "accent" ? "bg-accent-soft text-accent" : e.tone === "warn" ? "bg-warn-soft text-warn" : e.tone === "info" ? "bg-info-soft text-info" : "bg-panel-2 text-muted"}`}>{e.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{e.text}</div>
                <div className="num text-[12px] text-muted">
                  {f.dateTime(e.t)} · {e.tag}
                </div>
              </div>
            </li>
          ))}
          {!feed.length && <li className="py-10 text-center text-muted">Nothing in this period.</li>}
        </ul>
      </Card>

      <Card span={12} title="Play calendar" hint={`Days you played, in ${f.tzLabel}`}>
        <CalendarHeatmap times={games.map((g) => g._t!).filter(Boolean)} years={years} />
      </Card>

      <Card span={12} title="Collection" right={<a href="#collection" className="text-[12.5px] text-accent hover:underline">Open →</a>}>
        <div className="grid gap-x-8 gap-y-3 lg:grid-cols-2">
        <div className="grid grid-cols-3 content-start gap-3">
          <Tile k="Skins owned" v={coll.owned} hint="bought or upgraded" tone="accent" />
          <Tile k="Battle passes" v={coll.passes} hint={`${n0(coll.passVP)} VP`} />
          <Tile k="Bundles" v={coll.bundles} hint="bought whole" />
        </div>
        <div className="lg:-mt-2">
          <KV k="Skins bought with VP" v={coll.bought.toLocaleString("en")} mono />
          <KV k="Skins upgraded with Radianite" v={`${coll.upgraded} (${coll.maxed} at level 4+)`} mono />
          <KV k="Radianite spent" v={`${n0(coll.rp)} RP`} mono />
          <KV k="Agents unlocked with tokens" v={String(coll.agents)} mono />
          <KV k="Other items (Kingdom Credits…)" v={String(coll.otherItems)} mono />
          <KV k="Penalties" v={pen.data.length.toLocaleString("en")} mono />
        </div>
        </div>
      </Card>
    </Page>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[11.5px] uppercase tracking-[0.12em] text-faint">{k}</div>
      <div className="num mt-0.5 text-[14px]">{v}</div>
    </div>
  );
}

function Tile({ k, v, hint, tone }: { k: string; v: number; hint?: string; tone?: "accent" }) {
  return (
    <div className="rounded-lg bg-panel-2 px-3 py-2.5">
      <div className={`num text-[24px] font-medium leading-none ${tone === "accent" ? "text-accent" : ""}`}>{v.toLocaleString("en")}</div>
      <div className="mt-1.5 text-[12px] font-medium">{k}</div>
      {hint && <div className="num text-[11px] text-faint">{hint}</div>}
    </div>
  );
}
