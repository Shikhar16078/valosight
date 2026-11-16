import { AlertTriangle } from "lucide-react";
import { useMemo, useState } from "react";
import { useAccount, useRecords } from "../lib/account";
import { useAnnotations, type IpTag } from "../lib/annotations";
import type { Rec } from "../lib/api";
import { useSettings } from "../lib/settings";
import { DS, auditInfo } from "../lib/valorant";
import { networkOf } from "../lib/network";
import { buildIncidents } from "../lib/incidents";
import { Badge, Card, Empty, Page, Segmented, Stat } from "../components/ui";
import { C, MonthlyChart, monthSpan } from "../components/charts";
import { DataTable, type Col } from "../components/DataTable";

interface IpRow {
  ip: string;
  first: string;
  last: string;
  events: number;
  logins: number;
  apps: string;
  kind: string;
}

interface NetRow {
  net: string;
  ips: IpRow[];
  first: string;
  last: string;
  events: number;
  logins: number;
}

const LOGIN_TYPES = new Set(["Login", "Authentication"]);

export function TagPicker({ ip, value, onChange }: { ip: string; value?: string; onChange: (ip: string, v: IpTag | null) => void }) {
  const opts: { v: IpTag; label: string; cls: string }[] = [
    { v: "mine", label: "Mine", cls: "bg-win-soft text-win" },
    { v: "unsure", label: "?", cls: "bg-warn-soft text-warn" },
    { v: "not-mine", label: "Not me", cls: "bg-accent-soft text-accent" },
  ];
  return (
    <div className="inline-flex gap-1">
      {opts.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(ip, value === o.v ? null : o.v)}
          className={`rounded-md border px-2 py-0.5 text-[12px] font-medium transition-colors ${value === o.v ? `${o.cls} border-transparent` : "border-line text-faint hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Security() {
  const { has } = useAccount();
  const { f } = useSettings();
  const audit = useRecords(DS.audit);
  const loginsAll = useRecords(DS.logins, false);
  const logins = useRecords(DS.logins);
  const tags = useAnnotations("ip");
  const [showAll, setShowAll] = useState(false);
  const [ipFilter, setIpFilter] = useState<"all" | "untagged" | "mine" | "not-mine">("all");

  const ipRows = useMemo<IpRow[]>(() => {
    const m = new Map<string, IpRow & { appset: Set<string> }>();
    for (const l of logins.data) {
      const ip = l.ip_address ?? "Unknown";
      let e = m.get(ip);
      if (!e) {
        e = { ip, first: l._t!, last: l._t!, events: 0, logins: 0, apps: "", appset: new Set(), kind: ip === "Unknown" ? "—" : ip.includes(":") ? "IPv6" : "IPv4" };
        m.set(ip, e);
      }
      e.last = l._t!;
      e.events++;
      if (LOGIN_TYPES.has(l.event_type)) e.logins++;
      if (l.product) e.appset.add(l.product);
    }
    return [...m.values()].map(({ appset, ...r }) => ({ ...r, apps: [...appset].sort().join(", ") }));
  }, [logins.data]);

  const firstSeen = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of loginsAll.all) if (!m.has(l.ip_address)) m.set(l.ip_address, l._t!);
    return m;
  }, [loginsAll.all]);

  const alerts = useMemo(
    () =>
      audit.data
        .filter((a) => a.event_type === "ANOMALOUS_ACTIVITY")
        .map((a) => {
          const t = Date.parse(a._t!);
          const near = new Map<string, number>();
          for (const l of loginsAll.all) {
            const d = Date.parse(l._t!) - t;
            if (d > -24 * 3600e3 && d < 6 * 3600e3 && l.ip_address !== "Unknown") near.set(l.ip_address, (near.get(l.ip_address) ?? 0) + 1);
          }
          return { a, ips: [...near.entries()].sort((x, y) => y[1] - x[1]) };
        }),
    [audit.data, loginsAll.all],
  );

  const timeline = useMemo(() => audit.data.map((a) => ({ a, ...auditInfo(a) })).filter((x) => showAll || x.level >= 1).reverse(), [audit.data, showAll]);

  const monthly = useMemo(() => {
    const ev = new Map<string, number>();
    const fresh = new Map<string, number>();
    for (const l of logins.data) if (l._t) ev.set(f.monthKey(l._t), (ev.get(f.monthKey(l._t)) ?? 0) + 1);
    for (const [ip, t] of firstSeen) if (ip !== "Unknown" && logins.data.length && t >= logins.data[0]._t! && t <= logins.data[logins.data.length - 1]._t!) fresh.set(f.monthKey(t), (fresh.get(f.monthKey(t)) ?? 0) + 1);
    return { ev: monthSpan([...ev.keys()]).map((k) => ({ month: k, n: ev.get(k) ?? 0 })), fresh: monthSpan([...ev.keys()]).map((k) => ({ month: k, n: fresh.get(k) ?? 0 })) };
  }, [logins.data, firstSeen, f]);

  const pw = audit.data.filter((a) => a.event_type === "PASSWORD_CHANGE" || a.event_type === "PASSWORD_RESET").length;
  const tagged = ipRows.filter((r) => tags.map[r.ip]).length;
  const notMine = ipRows.filter((r) => tags.map[r.ip] === "not-mine").length;
  const shownIps = ipRows.filter((r) => (ipFilter === "all" ? true : ipFilter === "untagged" ? !tags.map[r.ip] : tags.map[r.ip] === ipFilter));

  const networks = useMemo<NetRow[]>(() => {
    const m = new Map<string, NetRow>();
    for (const r of ipRows) {
      const k = networkOf(r.ip);
      const e = m.get(k) ?? { net: k, ips: [], first: r.first, last: r.last, events: 0, logins: 0 };
      e.ips.push(r);
      if (r.first < e.first) e.first = r.first;
      if (r.last > e.last) e.last = r.last;
      e.events += r.events;
      e.logins += r.logins;
      m.set(k, e);
    }
    return [...m.values()];
  }, [ipRows]);
  const netTag = (n: NetRow): string | undefined => {
    const t = new Set(n.ips.map((r) => tags.map[r.ip] ?? ""));
    return t.size === 1 ? [...t][0] || undefined : "mixed";
  };
  const tagNetwork = (n: NetRow, v: IpTag | null) => tags.setMany(Object.fromEntries(n.ips.filter((r) => r.ip !== "Unknown").map((r) => [r.ip, v])));
  const netCols: Col<NetRow>[] = [
    { id: "net", header: "Network", value: (n) => n.net, cell: (n) => <span className="num text-[13px] font-medium">{n.net}</span> },
    {
      id: "tag",
      header: "Tag whole network",
      value: (n) => netTag(n) ?? "",
      cell: (n) => (
        <span className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <TagPicker ip={n.net} value={netTag(n) === "mixed" ? undefined : netTag(n)} onChange={(_, v) => tagNetwork(n, v)} />
          {netTag(n) === "mixed" && <Badge tone="warn">mixed</Badge>}
        </span>
      ),
    },
    { id: "ips", header: "IPs", value: (n) => n.ips.length, mono: true, align: "right" },
    { id: "first", header: "First seen", value: (n) => n.first, cell: (n) => <span className="num">{f.date(n.first)}</span> },
    { id: "last", header: "Last seen", value: (n) => n.last, cell: (n) => <span className="num">{f.date(n.last)}</span> },
    { id: "events", header: "Events", value: (n) => n.events, mono: true, align: "right" },
    { id: "logins", header: "Logins", value: (n) => n.logins, mono: true, align: "right" },
  ];
  const incidents = useMemo(() => buildIncidents(audit.data, loginsAll.all).reverse(), [audit.data, loginsAll.all]);

  const ipCols: Col<IpRow>[] = [
    { id: "ip", header: "IP address", value: (r) => r.ip, cell: (r) => <span className="num text-[13px]">{r.ip}</span> },
    { id: "tag", header: "Is this you?", value: (r) => tags.map[r.ip] ?? "", cell: (r) => <TagPicker ip={r.ip} value={tags.map[r.ip]} onChange={tags.set} /> },
    { id: "first", header: "First seen", value: (r) => r.first, cell: (r) => <span className="num">{f.date(r.first)}</span> },
    { id: "last", header: "Last seen", value: (r) => r.last, cell: (r) => <span className="num">{f.date(r.last)}</span> },
    { id: "events", header: "Events", value: (r) => r.events, mono: true, align: "right" },
    { id: "logins", header: "Logins", value: (r) => r.logins, mono: true, align: "right" },
    { id: "apps", header: "Apps", wrap: true, value: (r) => r.apps, cell: (r) => <span className="text-[12.5px] text-muted">{r.apps}</span> },
    { id: "kind", header: "Type", value: (r) => r.kind },
  ];

  const loginCols: Col<Rec>[] = [
    { id: "t", header: `Time (${f.tzLabel})`, value: (r) => r._t, cell: (r) => <span className="num">{f.dateTime(r._t, true)}</span> },
    { id: "ev", header: "Event", value: (r) => r.event_type },
    { id: "ip", header: "IP address", value: (r) => r.ip_address, cell: (r) => <span className="num text-[13px]">{r.ip_address}</span> },
    { id: "tag", header: "Tag", value: (r) => tags.map[r.ip_address] ?? "", cell: (r) => (tags.map[r.ip_address] === "mine" ? <Badge tone="win">mine</Badge> : tags.map[r.ip_address] === "not-mine" ? <Badge tone="accent">not me</Badge> : tags.map[r.ip_address] === "unsure" ? <Badge tone="warn">unsure</Badge> : null) },
    { id: "app", header: "App", value: (r) => r.product },
  ];

  if (!has(DS.logins) && !has(DS.audit)) return <Page code="04 / Security" title="Security"><Card><Empty title="No security data" /></Card></Page>;

  return (
    <Page code="04 / Security" title="Account security" loading={audit.loading || loginsAll.loading || logins.loading} sub={`Logins, IP addresses and account changes · times in ${f.tzLabel}`}>
      <Stat label="Riot alerts" value={alerts.length} tone={alerts.length ? "accent" : "default"} sub="“suspicious activity” flags" />
      <Stat label="Password changes" value={pw} tone={pw ? "warn" : "default"} sub="changes + email resets" />
      <Stat label="IP addresses" value={ipRows.length} sub={`${tagged} tagged · ${ipRows.length - tagged} untagged`} />
      <Stat label="Marked “not me”" value={notMine} tone={notMine ? "accent" : "win"} sub={notMine ? "review payments from these IPs" : "tag IPs below"} />

      {alerts.length > 0 && (
        <Card span={12} title="Riot flagged suspicious activity" hint="IPs that logged in from 24 h before to 6 h after each alert. New = first time this IP ever appeared." accent>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[...alerts].reverse().map(({ a, ips }) => (
              <div key={a._t} className="rounded-xl border border-line bg-panel-2 p-4">
                <div className="flex items-center gap-2 text-accent">
                  <AlertTriangle size={16} />
                  <span className="num font-medium">{f.dateTime(a._t)}</span>
                </div>
                <ul className="mt-3 space-y-2">
                  {ips.length === 0 && <li className="text-muted">No logins recorded around this time.</li>}
                  {ips.map(([ip, n]) => {
                    const fs = firstSeen.get(ip);
                    const isNew = fs && Math.abs(Date.parse(fs) - Date.parse(a._t!)) < 3 * 864e5;
                    return (
                      <li key={ip} className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1.5 text-[12.5px]" title={ip}>
                          <span className="num truncate">{ip}</span>
                          <span className="num shrink-0 text-faint">×{n}</span>
                          {isNew && <Badge tone="accent">new</Badge>}
                        </span>
                        <span className="shrink-0">
                          <TagPicker ip={ip} value={tags.map[ip]} onChange={tags.set} />
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      )}

      {incidents.length > 0 && (
        <Card span={12} title="Security incidents" hint="Account changes that happened close together (within 2 h), with IPs seen for the first time around them">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {incidents.map((inc) => (
              <div key={inc.start} className={`rounded-xl border p-4 ${inc.severity === "alert" ? "border-accent/50 bg-accent-soft" : "border-line bg-panel-2"}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="num font-medium">{f.date(inc.start)}</span>
                  <span className="num text-[12px] text-muted">
                    {f.time(inc.start)}
                    {inc.end !== inc.start && ` – ${f.time(inc.end)}`}
                  </span>
                </div>
                <ol className="mt-2 space-y-1 text-[13px]">
                  {inc.events.map((e, i) => (
                    <li key={i} className="flex gap-2">
                      <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${e.level === 2 ? "bg-accent" : "bg-warn"}`} />
                      <span className={e.level === 2 ? "font-semibold text-accent" : ""}>{e.label}</span>
                    </li>
                  ))}
                </ol>
                {inc.newIps.length > 0 && (
                  <div className="mt-3 border-t border-line pt-2">
                    <div className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted">New IPs around this time</div>
                    <ul className="mt-1 space-y-1">
                      {inc.newIps.map(({ ip }) => (
                        <li key={ip} className="flex items-center justify-between gap-2 text-[12.5px]">
                          <span className="num truncate" title={ip}>
                            {ip}
                          </span>
                          <span className="shrink-0">
                            <TagPicker ip={ip} value={tags.map[ip]} onChange={tags.set} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card span={5} title="Security timeline" right={<Segmented value={showAll ? "all" : "key"} onChange={(v) => setShowAll(v === "all")} options={[{ value: "key", label: "Important" }, { value: "all", label: "Everything" }]} />} pad={false}>
        <ol className="scroll-thin max-h-[560px] overflow-y-auto px-5 py-3">
          {timeline.map(({ a, label, level, detail }, i) => (
            <li key={i} className="grid grid-cols-[92px_14px_1fr] gap-2 py-1.5">
              <span className="num pt-0.5 text-[12px] text-muted">{f.date(a._t)}</span>
              <span className={`mt-1.5 h-2.5 w-2.5 rounded-full ${level === 2 ? "bg-accent" : level === 1 ? "bg-warn" : "bg-line-strong"}`} />
              <span className={level === 2 ? "font-semibold text-accent" : level === 1 ? "font-medium" : "text-muted"}>
                {label}
                {detail && <span className="text-muted"> · {detail}</span>}
                <span className="num ml-2 text-[11.5px] text-faint">{f.time(a._t)}</span>
              </span>
            </li>
          ))}
          {!timeline.length && <li className="py-10 text-center text-muted">Nothing in this period.</li>}
        </ol>
      </Card>

      <div className="col-span-12 grid gap-4 xl:col-span-7">
        <Card title="Login activity per month">
          <MonthlyChart data={monthly.ev} series={[{ key: "n", label: "Login events", color: C.info }]} height={220} />
        </Card>
        <Card title="New IP addresses per month" hint="Spikes mean logins from places not seen before">
          <MonthlyChart data={monthly.fresh} series={[{ key: "n", label: "New IPs", color: C.warn }]} height={200} />
        </Card>
      </div>

      <Card span={12} title="Networks" hint="IPs grouped by provider range (IPv4 first two numbers, IPv6 first two blocks). Tag a whole network in one click; click a row to see its IPs." pad={false}>
        <DataTable
          rows={networks}
          cols={netCols}
          initialSort={{ id: "last", desc: true }}
          filename="ip-networks"
          searchPlaceholder="Search network…"
          rowTone={(n) => (netTag(n) === "not-mine" ? "accent" : undefined)}
          expand={(n) => (
            <ul className="grid gap-x-6 gap-y-1 pl-6 sm:grid-cols-2 xl:grid-cols-3">
              {n.ips.map((r) => (
                <li key={r.ip} className="flex items-center justify-between gap-2 text-[12.5px]">
                  <span className="num truncate" title={r.ip}>
                    {r.ip}
                  </span>
                  <span className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <span className="num text-faint">{f.date(r.last)}</span>
                    <TagPicker ip={r.ip} value={tags.map[r.ip]} onChange={tags.set} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        />
      </Card>

      <Card span={12} title="IP addresses" hint="Tag each IP — tags are saved in your vault and used on the Money page" pad={false}>
        <DataTable
          rows={shownIps}
          cols={ipCols}
          initialSort={{ id: "last", desc: true }}
          filename="ip-addresses"
          searchPlaceholder="Search IP, app…"
          rowTone={(r) => (tags.map[r.ip] === "not-mine" ? "accent" : undefined)}
          toolbar={
            <Segmented
              value={ipFilter}
              onChange={setIpFilter}
              options={[
                { value: "all", label: "All" },
                { value: "untagged", label: "Untagged" },
                { value: "mine", label: "Mine" },
                { value: "not-mine", label: "Not me" },
              ]}
            />
          }
        />
      </Card>

      <Card span={12} title="Every login event" pad={false}>
        <DataTable rows={logins.data} cols={loginCols} initialSort={{ id: "t", desc: true }} filename="login-events" pageSize={50} rowTone={(r) => (tags.map[r.ip_address] === "not-mine" ? "accent" : undefined)} />
      </Card>
    </Page>
  );
}
