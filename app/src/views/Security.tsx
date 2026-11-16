import { Check, X } from "lucide-react";
import { useCreated, useCreationIp, useDateGuard, useMaskIp } from "../lib/privacy-dates";
import { useMemo, useState } from "react";
import { useAccount, useRecords } from "../lib/account";
import type { Rec } from "../lib/api";
import { useSettings } from "../lib/settings";
import { AUDIT_KINDS, DS, auditInfo, auditKind, dedupeAudit, isPwEvent, type AuditKind } from "../lib/valorant";
import { networkOf } from "../lib/network";
import { Card, Empty, Page, Segmented, Stat } from "../components/ui";
import { C, MonthlyChart, monthSpan } from "../components/charts";
import { DataTable, type Col, type Facet, type Preset } from "../components/DataTable";
import { scrollToSection, useIntent } from "../lib/focus";
import { Sens, usePrivacy } from "../lib/privacy";
import { SOFT_CSS, Swap } from "../components/anim";

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

type View = "events" | "ip" | "net";
const LOGIN_TYPES = new Set(["Login", "Authentication"]);

export function Security() {
  const { has } = useAccount();
  const { f } = useSettings();
  const pv = usePrivacy();
  const guard = useDateGuard();
  const created = useCreated();
  const audit = useRecords(DS.audit);
  const auditAll = useRecords(DS.audit, false);
  const logins = useRecords(DS.logins);
  const DEFAULT_KINDS = () => new Set<AuditKind>(AUDIT_KINDS.filter((k) => k.on).map((k) => k.id));
  const [kinds, setKinds] = useState<Set<AuditKind>>(DEFAULT_KINDS);
  // One login card, three angles on the same events: every event, grouped by IP, grouped by network.
  const [view, setView] = useState<View>("events");
  const maskIp = useMaskIp();
  // The creation IP is fully hidden, so its network (its first two parts) is too.
  const creationIp = useCreationIp();
  const creationNet = creationIp && creationIp !== "Unknown" ? networkOf(creationIp) : null;
  // The IP to filter by, kept raw: the chip's label is masked at render time, so it follows privacy mode.
  const [ipPick, setIpPick] = useState<string | null>(null);
  const [loginPreset, setLoginPreset] = useState<Preset<Rec> | null>(null);
  const show = (v: View) => {
    setView(v);
    scrollToSection("logins");
  };
  // From Overview's IP rows: the By IP view filtered to that one address.
  useIntent("security", !logins.loading, (i) => {
    if (i.filter !== "ip" || !i.value) return;
    const ip = i.value;
    setView("ip");
    setIpPick(ip);
  });

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
  // Overview's IPs are all-time; say so when the picked one isn't in the selected period, instead of an unexplained empty table.
  const ipPreset = useMemo<Preset<IpRow> | null>(
    () => (ipPick ? { label: `${maskIp(ipPick)}${ipRows.some((r) => r.ip === ipPick) ? "" : " · not in this period"}`, test: (r) => r.ip === ipPick } : null),
    [ipPick, maskIp, ipRows],
  );

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

  const typed = useMemo(() => dedupeAudit(audit.data).map((a) => ({ a, kind: auditKind(a), ...auditInfo(a) })), [audit.data]);
  const kindCount = useMemo(() => {
    const m = new Map<AuditKind, number>();
    for (const x of typed) m.set(x.kind, (m.get(x.kind) ?? 0) + 1);
    return m;
  }, [typed]);
  const timeline = useMemo(() => typed.filter((x) => kinds.has(x.kind)).reverse(), [typed, kinds]);
  const kindKey = [...kinds].sort().join();
  const shownKinds = AUDIT_KINDS.filter((k) => kindCount.get(k.id));
  const allOn = shownKinds.every((k) => kinds.has(k.id));
  const toggleKind = (k: AuditKind) =>
    setKinds((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const monthly = useMemo(() => {
    const ev = new Map<string, number>();
    for (const l of logins.data) if (l._t) ev.set(f.monthKey(l._t), (ev.get(f.monthKey(l._t)) ?? 0) + 1);
    return monthSpan([...ev.keys()]).map((k) => ({ month: k, n: ev.get(k) ?? 0 }));
  }, [logins.data, f]);

  // Riot logs an email change as "user field changed: emailAddress" (it never says from what to what).
  // Signing up records the first email as a "change" minutes after the account is created: that's not a
  // change, so anything within a day of creation is left out.
  const signUpEnd = created ? Date.parse(created) + 864e5 : -Infinity;
  const emailEvents = audit.data.filter((a) => a.event_type === "USER_FIELD_CHANGED" && a.description === "emailAddress" && Date.parse(a._t ?? "") > signUpEnd);
  const emailCh = emailEvents.length;
  const lastEmail = emailEvents.at(-1)?._t ?? null;
  const showEmail = () => {
    setKinds(new Set<AuditKind>(["email"]));
    scrollToSection("timeline");
  };
  // Always all-time: "when did I last change my password" shouldn't depend on the period filter.
  const pwAll = useMemo(() => auditAll.all.filter(isPwEvent).length, [auditAll.all]);
  const lastPw = useMemo(() => auditAll.all.filter(isPwEvent).at(-1)?._t ?? null, [auditAll.all]);
  const pwAge = lastPw ? (Date.now() - Date.parse(lastPw)) / 864e5 : null;
  const showPw = () => {
    setKinds(new Set<AuditKind>(["password"]));
    scrollToSection("timeline");
  };

  const ipCols: Col<IpRow>[] = [
    { id: "ip", header: "IP address", secret: true, value: (r) => r.ip, cell: (r) => <Sens className="num text-[13px]">{maskIp(r.ip)}</Sens> },
    { id: "first", header: "First seen", value: (r) => r.first, cell: (r) => <Sens className="num">{guard(r.first, f.date(r.first))}</Sens> },
    { id: "last", header: "Last seen", value: (r) => r.last, cell: (r) => <Sens className="num">{guard(r.last, f.date(r.last))}</Sens> },
    { id: "events", header: "Events", value: (r) => r.events, mono: true, align: "right" },
    { id: "logins", header: "Logins", value: (r) => r.logins, mono: true, align: "right" },
    { id: "apps", header: "Apps", wrap: true, value: (r) => r.apps, cell: (r) => <span className="text-[12.5px] text-muted">{r.apps}</span> },
    { id: "kind", header: "Type", value: (r) => r.kind },
  ];
  const netCols: Col<NetRow>[] = [
    { id: "net", header: "Network", secret: true, value: (n) => n.net, cell: (n) => <Sens className="num text-[13px] font-medium">{n.net === creationNet && pv.hidden ? pv.secret(n.net) : n.net}</Sens> },
    { id: "ips", header: "IPs", value: (n) => n.ips.length, mono: true, align: "right" },
    { id: "first", header: "First seen", value: (n) => n.first, cell: (n) => <Sens className="num">{guard(n.first, f.date(n.first))}</Sens> },
    { id: "last", header: "Last seen", value: (n) => n.last, cell: (n) => <Sens className="num">{guard(n.last, f.date(n.last))}</Sens> },
    { id: "events", header: "Events", value: (n) => n.events, mono: true, align: "right" },
    { id: "logins", header: "Logins", value: (n) => n.logins, mono: true, align: "right" },
  ];
  const loginCols: Col<Rec>[] = [
    { id: "t", header: `Time (${f.tzLabel})`, value: (r) => r._t, cell: (r) => <Sens className="num">{guard(r._t, f.dateTime(r._t, true))}</Sens> },
    { id: "ev", header: "Event", value: (r) => r.event_type },
    { id: "ip", header: "IP address", secret: true, value: (r) => r.ip_address, cell: (r) => <Sens className="num text-[13px]">{maskIp(r.ip_address)}</Sens> },
    { id: "app", header: "App", value: (r) => r.product },
  ];
  const { loginFacets, ipFacets, netFacets } = useMemo(() => {
    const year = (t?: string | null) => (t ? f.monthKey(t).slice(0, 4) : null);
    const newest = (a: string, b: string) => b.localeCompare(a);
    const loginFacets: Facet<Rec>[] = [
    { id: "year", label: "Year", value: (r) => year(r._t), order: newest },
    { id: "ev", label: "Event", value: (r) => r.event_type },
    { id: "app", label: "App", value: (r) => r.product },
  ];
  const ipFacets: Facet<IpRow>[] = [
    { id: "year", label: "First seen", value: (r) => year(r.first), order: newest },
    { id: "kind", label: "Type", value: (r) => r.kind },
  ];
    const netFacets: Facet<NetRow>[] = [{ id: "year", label: "First seen", value: (n) => year(n.first), order: newest }];
    return { loginFacets, ipFacets, netFacets };
  }, [f]);

  if (!has(DS.logins) && !has(DS.audit)) return <Page code="04 / Security" title="Security"><Card><Empty title="No security data" /></Card></Page>;

  const VIEWS: Record<View, string> = { events: "Every login event", ip: "Grouped by IP address", net: "Grouped by network" };
  return (
    <Page code="04 / Security" title="Account security" loading={audit.loading || auditAll.loading || logins.loading} sub={`Logins, IP addresses and account changes · times in ${f.tzLabel}`}>
      <Stat
        label="Email changes"
        onClick={emailCh ? showEmail : undefined}
        action="Show only email changes in the timeline"
        value={emailCh || "No change"}
        tone={emailCh ? "warn" : "default"}
        sub={<Sens>{lastEmail ? `last on ${guard(lastEmail, f.date(lastEmail))}` : "same email since sign-up"}</Sens>}
      />
      <Stat
        label="Last password change"
        onClick={lastPw ? showPw : undefined}
        action="Show only password changes in the timeline"
        value={lastPw ? guard(lastPw, f.relative(lastPw)) : "Never"}
        tone={pwAge == null || pwAge > 365 ? "warn" : "default"}
        sub={<Sens>{lastPw ? `${guard(lastPw, f.date(lastPw))} · ${pwAll} change${pwAll === 1 ? "" : "s"} in total${pwAge! > 365 ? " · worth changing" : ""}` : "not in your export"}</Sens>}
      />
      <Stat label="Login events" onClick={logins.data.length ? () => show("events") : undefined} action="Show every login event" value={logins.data.length} sub="in this period" />
      <Stat label="IP addresses" onClick={ipRows.length ? () => show("ip") : undefined} action="Show logins grouped by IP" value={ipRows.length} sub={`across ${networks.length} network${networks.length === 1 ? "" : "s"}`} />


      <Card span={12} title="Login activity per month" hint="Click a month to see its login events">
        <MonthlyChart
          onPick={(m) => {
            setView("events");
            setLoginPreset({ label: f.monthLabel(m), test: (r) => !!r._t && f.monthKey(r._t) === m });
            scrollToSection("logins");
          }}
          data={monthly}
          series={[{ key: "n", label: "Login events", color: C.info }]}
          height={260}
        />
      </Card>

      <Card
        id="timeline"
        span={12}
        title="Account changes"
        hint="Newest first · filter on the right"
        pad={false}
      >
        <div className="grid lg:grid-cols-[minmax(0,1fr)_300px]">
        <Swap k={kindKey} className="min-w-0">
        <ol className="scroll-thin max-h-[560px] overflow-y-auto px-5 py-3">
          {timeline.map(({ a, label, level, detail }, i) => (
            <li key={i} className="grid grid-cols-[92px_14px_1fr] gap-2 py-1.5">
              {/* The account-created event dates the account, so privacy mode hides its date like the Overview does. */}
              <span className="num pt-0.5 text-[12px] text-muted">
                <Sens>{a.event_type === "CREATED" ? pv.secret(f.date(a._t)) : guard(a._t, f.date(a._t))}</Sens>
              </span>
              <span className={`mt-1.5 h-2.5 w-2.5 rounded-full ${level === 2 ? "bg-accent" : level === 1 ? "bg-warn" : "bg-line-strong"}`} />
              <span className={level === 2 ? "font-semibold text-accent" : level === 1 ? "font-medium" : "text-muted"}>
                {label}
                {/* Details can hold emails, phone numbers or old values: hidden in privacy mode. */}
                {detail && (
                  <span className="text-muted">
                    {" · "}
                    <Sens>{pv.secret(detail)}</Sens>
                  </span>
                )}
                {a.event_type !== "CREATED" || !pv.hidden ? (
                  <span className="num ml-2 text-[11.5px] text-faint">
                    <Sens>{guard(a._t, f.time(a._t))}</Sens>
                  </span>
                ) : null}
              </span>
            </li>
          ))}
          {!timeline.length && <li className="py-10 text-center text-muted">{kinds.size ? "Nothing of these kinds in this period." : "Nothing selected · pick the kinds of change you want on the right."}</li>}
        </ol>
        </Swap>

          {/* The card's controls: presets, one row per kind of change, and the dot legend. */}
          <aside className="flex flex-col gap-4 border-t border-line p-5 lg:border-l lg:border-t-0">
            <Segmented
              value={allOn ? "all" : kindKey === [...DEFAULT_KINDS()].sort().join() ? "key" : ("custom" as string)}
              onChange={(v) => setKinds(v === "all" ? new Set(shownKinds.map((k) => k.id)) : DEFAULT_KINDS())}
              options={[{ value: "key", label: "Important" }, { value: "all", label: "Everything" }]}
            />
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-muted">Show</span>
                <button
                  type="button"
                  onClick={() => setKinds(kinds.size ? new Set() : new Set(shownKinds.map((k) => k.id)))}
                  className={`rounded-full px-2 py-0.5 text-[12px] text-muted transition-colors ${SOFT_CSS} hover:bg-panel-2 hover:text-ink`}
                >
                  <Swap k={kinds.size ? "none" : "all"} className="flex items-center gap-1">
                    {kinds.size ? <X size={12} /> : <Check size={12} />}
                    {kinds.size ? "Select none" : "Select all"}
                  </Swap>
                </button>
              </div>
              <div role="group" aria-label="Show these changes" className="-mx-2 space-y-0.5">
                {shownKinds.map((k) => {
                  const on = kinds.has(k.id);
                  return (
                    <button
                      key={k.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleKind(k.id)}
                      className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors ${SOFT_CSS} hover:bg-panel-2 ${on ? "text-ink" : "text-muted"}`}
                    >
                      <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors ${SOFT_CSS} ${on ? "border-accent bg-accent text-[var(--on-accent)]" : "border-line-strong"}`}>
                        <Check size={11} strokeWidth={3} className={`transition-[opacity,transform] ${SOFT_CSS} ${on ? "scale-100 opacity-100" : "scale-50 opacity-0"}`} />
                      </span>
                      <span className="flex-1">{k.label}</span>
                      <span className="num text-[12px] text-faint">{kindCount.get(k.id)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mt-auto border-t border-line pt-3 text-[12px] text-muted">
              <TimelineLegend />
            </div>
          </aside>
        </div>
      </Card>



      <Card
        id="logins"
        span={12}
        title="Logins"
        hint={VIEWS[view]}
        right={<Segmented value={view} onChange={setView} options={[{ value: "events", label: "Events" }, { value: "ip", label: "By IP" }, { value: "net", label: "By network" }]} />}
        pad={false}
      >
        <Swap k={view}>
          {view === "events" ? (
            <DataTable rows={logins.data} cols={loginCols} preset={loginPreset} onClearPreset={() => setLoginPreset(null)} facets={loginFacets} initialSort={{ id: "t", desc: true }} filename="login-events" />
          ) : view === "ip" ? (
            <DataTable rows={ipRows} cols={ipCols} preset={ipPreset} onClearPreset={() => setIpPick(null)} facets={ipFacets} initialSort={{ id: "last", desc: true }} filename="ip-addresses" searchPlaceholder="Search IP, app…" />
          ) : (
            <DataTable
              rows={networks}
              cols={netCols}
              facets={netFacets}
              initialSort={{ id: "last", desc: true }}
              filename="ip-networks"
              searchPlaceholder="Search network…"
              expand={(n) => (
                <ul className="grid gap-x-6 gap-y-1 pl-6 sm:grid-cols-2 xl:grid-cols-3">
                  {n.ips.map((r) => (
                    <li key={r.ip} className="flex items-center justify-between gap-2 text-[12.5px]">
                      <Sens className="num truncate">{maskIp(r.ip)}</Sens>
                      <Sens className="num shrink-0 text-faint">{guard(r.last, f.date(r.last))}</Sens>
                    </li>
                  ))}
                </ul>
              )}
            />
          )}
        </Swap>
      </Card>
    </Page>
  );
}

/** What the timeline's dot colours mean. */
function TimelineLegend() {
  const items: [string, string][] = [["bg-accent", "Flagged by Riot"], ["bg-warn", "Important change"], ["bg-line-strong", "Other"]];
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-1">
      {items.map(([c, l]) => (
        <span key={l} className="inline-flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${c}`} />
          {l}
        </span>
      ))}
    </span>
  );
}
