import { AlertTriangle, Check, CheckCircle2, Copy, CreditCard, Gavel, ShieldAlert, Sparkles } from "lucide-react";
import { useCreated, useDateGuard, useMaskIp } from "../lib/privacy-dates";
import { useMemo, useState, type ReactElement } from "react";
import { useAccount, useRecords } from "../lib/account";
import { useSettings } from "../lib/settings";
import { SpendFigure } from "../lib/convert";
import { DS, vpGroupOf, isActivePenalty, winStreaks, amountPaid, auditInfo, classifyAllVP, dedupeAudit, groupUpgrades, isRealMatch, isRP, matchMinutes, money, n0, parseUpgrade, payMethod, PENALTY, queueName } from "../lib/valorant";
import { allocateVP } from "../lib/fifo";
import { goTo } from "../lib/focus";
import { HIDDEN, PrivacyToggle, Sens, usePrivacy } from "../lib/privacy";
import { Card, KV, Page } from "../components/ui";
import { SOFT_CSS } from "../components/anim";
import { SkinImage } from "../components/SkinImage";
import { useSkinCatalog } from "../lib/skins";

export function Overview() {
  const { detail, range, inRange } = useAccount();
  const pv = usePrivacy();
  const cat = useSkinCatalog();
  const maskIp = useMaskIp();
  const { f } = useSettings();
  const info = (detail?.snapshots[DS.info] ?? {}) as Record<string, string>;
  const pay = useRecords(DS.payments);
  const mh = useRecords(DS.matches);
  const store = useRecords(DS.store);
  const audit = useRecords(DS.audit);
  const auditAll = useRecords(DS.audit, false);
  const pen = useRecords(DS.penalties);
  const logins = useRecords(DS.logins);
  // Cards link to the page with more on their topic, when that page exists for this account
  // (the same rule as the top bar: a page shows when any of its datasets has records).
  const has = (...ds: string[]) => ds.some((d) => detail?.datasets.some((x) => x.dataset === d && x.count > 0));
  const page = (to: string, ...ds: string[]) => (has(...ds) ? to : undefined);
  const toColl = !!page("collection", DS.store);

  const created = useCreated();

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
  const play = useMemo(() => {
    const best = winStreaks(games).bw;
    const sorted = [...games].sort((a, b) => (a._t ?? "").localeCompare(b._t ?? ""));
    const mins = games.map(matchMinutes).filter((x): x is number => x != null);
    const days = new Set(sorted.map((g) => (g._t ? f.dayKey(g._t) : ""))).size;
    return { best, longest: Math.max(0, ...mins), first: sorted[0]?._t ?? null, last: sorted.at(-1)?._t ?? null, days };
  }, [games, f]);
  const favMode = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of games) m.set(queueName(g), (m.get(queueName(g)) ?? 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!top) return null;
    const inMode = games.filter((g) => queueName(g) === top[0]);
    const w = inMode.filter((g) => g.game_outcome === "Win").length;
    const d = inMode.filter((g) => g.game_outcome === "Win" || g.game_outcome === "Loss").length;
    return { name: top[0], n: top[1], rate: d ? Math.round((w / d) * 100) : null };
  }, [games]);

  // ---- 1. Account: IPs (all time; Riot's ownership form asks about them) ----
  const loginsAll = useRecords(DS.logins, false);
  const ipInfo = useMemo(() => {
    const ls = loginsAll.all.filter((l) => l._t && l.ip_address && l.ip_address !== "Unknown");
    if (!ls.length) return null;
    // The creation IP is the very first login's, even when Riot recorded it as "Unknown": never a later one.
    const first = loginsAll.all.find((l) => l._t) ?? ls[0];
    const count = new Map<string, number>();
    for (const l of ls) count.set(l.ip_address, (count.get(l.ip_address) ?? 0) + 1);
    const [most, mostN] = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
    return { first, last: ls[ls.length - 1], most, mostN, unique: count.size, ips: [...count.keys()] };
  }, [loginsAll.all]);
  // Riot's login history starts when the account is made, so its first IP is the creation IP. If the first
  // login is noticeably later than the creation date (history trimmed), say so instead of guessing.
  const creationGap = (() => {
    if (!ipInfo || !created) return null;
    const d = Math.round((Date.parse(ipInfo.first._t ?? "") - Date.parse(created)) / 864e5);
    return d > 1 ? (d >= 60 ? `${Math.round(d / 30.44)} months` : `${d} days`) : null;
  })();

  // ---- 2. Money: where it went (real money, via the oldest-VP-first estimate) ----
  const payAll = useRecords(DS.payments, false);
  const where = useMemo(() => {
    const main = spend[0]?.[0];
    if (!main) return null;
    // The money paid in this period (in the main currency), split by what its VP bought, whenever that was.
    // Counting by purchase date instead could pull in VP from older top-ups and pass 100%.
    const by = new Map<string, number>([["Skins", 0], ["Battle passes", 0], ["Bundles", 0]]);
    const label = (c: string) => vpGroupOf(c).label;
    for (const [item, allocs] of allocateVP(payAll.all, store.all).byItem) {
      for (const a of allocs) if (a.payment?.currency_code === main && inRange(a.payment._t)) by.set(label(item.category), (by.get(label(item.category)) ?? 0) + a.money);
    }
    const spentOnItems = [...by.values()].reduce((a, b) => a + b, 0);
    const rows = [...by.entries()].filter(([, v]) => v > 0.5).map(([k, v]) => ({ k, v }));
    const left = Math.max(0, spend[0][1] - spentOnItems);
    if (left > 0.5) rows.push({ k: "Not spent yet", v: left });
    const methods = new Map<string, number>();
    for (const p of pay.data) if (p.currency_code === main) methods.set(payMethod(p.payment_method), (methods.get(payMethod(p.payment_method)) ?? 0) + amountPaid(p));
    const topMethod = [...methods.entries()].sort((a, b) => b[1] - a[1])[0];
    return { main, total: spend[0][1], rows, topMethod };
  }, [spend, store.all, payAll.all, pay.data, inRange, cat]); // eslint-disable-line react-hooks/exhaustive-deps -- cat: pass naming

  const byYear = useMemo(() => {
    const main = spend[0]?.[0];
    const m = new Map<string, { amt: number; n: number }>();
    for (const p of pay.data) {
      if (p.currency_code !== main || !p._t) continue;
      const y = f.monthKey(p._t).slice(0, 4);
      const e = m.get(y) ?? { amt: 0, n: 0 };
      e.amt += amountPaid(p);
      e.n++;
      m.set(y, e);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [pay.data, spend, f]);

  // ---- 3. Collection ----
  const vpItems = useMemo(() => classifyAllVP(store.data, store.all), [store.data, store.all, cat]); // `cat`: its act calendar names passes
  const latestSkins = useMemo(() => vpItems.filter((x) => x.category === "Skin").sort((a, b) => (b.t ?? "").localeCompare(a.t ?? "")).slice(0, 5), [vpItems]);
  const coll = useMemo(() => {
    const ups = groupUpgrades(store.data.filter(isRP).map(parseUpgrade));
    ups.delete("Unknown skin");
    const bought = vpItems.filter((x) => x.category === "Skin");
    const passes = vpItems.filter((x) => x.category === "Battle Pass");
    return {
      owned: new Set([...bought.map((x) => x.name), ...ups.keys()]).size,
      skinVP: bought.reduce((a, x) => a + x.cost, 0),
      passes: passes.length,
      passVP: passes.reduce((a, x) => a + x.cost, 0),
      bundles: vpItems.filter((x) => x.category === "Bundle").length,
      upgraded: ups.size,
    };
  }, [store.data, vpItems]);

  // ---- Needs attention (all time, so nothing important hides behind the period filter) ----
  const attention = useMemo(() => {
    const out: { text: string; to: string; tone: "accent" | "warn" }[] = [];
    const alertsAll = auditAll.all.filter((r) => r.event_type === "ANOMALOUS_ACTIVITY").length;
    if (alertsAll) out.push({ text: `${alertsAll} Riot “suspicious activity” alert${alertsAll === 1 ? "" : "s"}`, to: "security", tone: "accent" });
    const activePen = pen.all.filter((p) => isActivePenalty(p.status)).length;
    if (activePen) out.push({ text: `${activePen} active penalt${activePen === 1 ? "y" : "ies"}`, to: "conduct", tone: "accent" });
    return out;
  }, [auditAll.all, pen.all]);

  const feed = useMemo(() => {
    const ev: { t: string; icon: ReactElement; text: string; tone: "accent" | "win" | "warn" | "info" | "neutral"; tag: string; to: string; created?: boolean }[] = [];
    for (const p of pay.data) ev.push({ t: p._t!, icon: <CreditCard size={14} />, text: `Paid ${money(amountPaid(p), p.currency_code, 0)} for ${Number(p.game_currency_granted).toLocaleString("en")} ${p.game_currency_type ?? ""}`, tone: "info", tag: "Payment", to: "money" });
    for (const s of vpItems) if (s.category !== "Unknown") ev.push({ t: s.t, icon: <Sparkles size={14} />, text: s.category === "Battle Pass" ? s.pass! : s.name, tone: "neutral", tag: s.category, to: "collection" });
    for (const a of dedupeAudit(audit.data)) {
      const i = auditInfo(a);
      if (i.level >= 1) ev.push({ t: a._t!, icon: <ShieldAlert size={14} />, text: i.label, tone: i.level === 2 ? "accent" : "warn", tag: "Security", to: "security", created: a.event_type === "CREATED" });
    }
    for (const p of pen.data) ev.push({ t: p._t!, icon: <Gavel size={14} />, text: PENALTY[p.restriction_type] ?? p.restriction_type, tone: "warn", tag: "Penalty", to: "conduct" });
    return ev.filter((e) => e.t).sort((a, b) => b.t.localeCompare(a.t)).slice(0, 12);
  }, [pay.data, vpItems, audit.data, pen.data]);

  const rangeLabel = range.kind === "all" ? "All time" : range.kind === "year" ? String(range.y) : `Last ${range.days} days of data`;
  // Without a Riot ID the heading falls back to the sign-in username, which privacy mode hides.
  const name = info.game_name ? `${info.game_name}` : pv.name(detail?.username);
  const age = (() => {
    if (!created) return null;
    const mo = Math.floor((Date.now() - Date.parse(created)) / (30.44 * 864e5));
    return mo >= 12 ? `${Math.floor(mo / 12)}y ${mo % 12}m old` : `${mo}m old`;
  })();
  const WHERE_COLORS: Record<string, string> = { Skins: "var(--accent)", "Battle passes": "var(--win)", Bundles: "var(--info)", "Unknown items": "var(--warn)", "Not spent yet": "var(--line-strong)" };
  const guard = useDateGuard();
  const showIp = (ip: string) => goTo("security", { section: "logins", filter: "ip", value: ip });

  return (
    <Page code="00 / Overview" loading={pay.loading || mh.loading || store.loading || audit.loading || pen.loading || logins.loading} title="Account at a glance" sub={`${rangeLabel} · times in ${f.tzLabel}`}>
      {/* 1. The account: who, since when, and from where (IPs matter for Riot's ownership questions). */}
      <Card span={12} accent pad={false}>
        <div className="grid gap-x-10 gap-y-5 px-6 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="min-w-0">
            <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 font-display text-[34px] font-bold leading-none tracking-tight">
              {name}
              {info.tagline && <span className="text-muted">#{info.tagline}</span>}
            </div>
            <PrivacyToggle className="mt-1 shrink-0" />
            </div>
            {/* The facts Riot support asks about, given equal weight. */}
            <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4">
              <Fact k="Username" v={pv.name(detail?.username) || "—"} hint="what you sign in with" />
              <Fact k="Email" v={info.email ? pv.secret(info.email) : "—"} />
              <Fact k="Account created" v={created ? pv.secret(f.date(created)) : "—"} hint={age ? pv.secret(age) : undefined} />
              <Fact k="Store region" v={region ?? "—"} hint="country · currency Riot charges" />
              <Fact wide k="Data covers" v={((a, b) => (pv.hidden ? `${HIDDEN} → ${f.date(b)}` : `${f.date(a)} → ${f.date(b)}`))(detail?.datasets.map((d) => d.first).filter(Boolean).sort()[0] as string, detail?.datasets.map((d) => d.last).filter(Boolean).sort().at(-1) as string)} small />
            </div>
          </div>
          <div className="min-w-0 rounded-xl border border-line bg-panel-2/50 p-4">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <span className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-muted">IP addresses</span>
              {ipInfo && (
                <a href="#security" className={`num text-[12px] text-muted transition-colors ${SOFT_CSS} hover:text-accent`}>
                  {ipInfo.unique} different →
                </a>
              )}
            </div>
            {ipInfo ? (
              <div className="divide-y divide-line">
                <IpRow mask={maskIp} k="Account creation" secret ip={ipInfo.first.ip_address} sub={`${pv.secret(f.dateTime(ipInfo.first._t))}${creationGap && !pv.hidden ? ` · first recorded ${creationGap} after creation` : ""}`} strong onClick={() => showIp(ipInfo.first.ip_address)} />
                <IpRow mask={maskIp} k="Most used" ip={ipInfo.most} sub={`${n0(ipInfo.mostN)} login events`} onClick={() => showIp(ipInfo.most)} />
                <IpRow mask={maskIp} k="Latest" ip={ipInfo.last.ip_address} sub={guard(ipInfo.last._t, f.dateTime(ipInfo.last._t))} onClick={() => showIp(ipInfo.last.ip_address)} />
              </div>
            ) : (
              <div className="py-4 text-center text-[13px] text-muted">This export has no login history.</div>
            )}
          </div>
        </div>
      </Card>

      {/* Anything that needs the player, from any page. */}
      <div className={`col-span-12 flex flex-wrap items-center gap-2 rounded-xl border px-4 py-2.5 text-[13px] ${attention.length ? "border-accent/40 bg-accent-soft" : "border-win/30 bg-win/10"}`}>
        {attention.length ? (
          <>
            <AlertTriangle size={15} className="shrink-0 text-accent" />
            <span className="font-medium">Needs your attention:</span>
            {attention.map((a) => (
              <a key={a.text} href={`#${a.to}`} className={`rounded-full border border-accent/40 px-2.5 py-0.5 font-medium text-accent transition-colors ${SOFT_CSS} hover:bg-accent/10`}>
                {a.text} →
              </a>
            ))}
          </>
        ) : (
          <>
            <CheckCircle2 size={15} className="shrink-0 text-win" />
            <span>
              <b className="font-medium text-win">All clear.</b> <span className="text-muted">No Riot security alerts and no active penalties.</span>
            </span>
          </>
        )}
      </div>

      {/* 2. Money: the total (switchable currency), and where it went. */}
      <Card span={6} title="Money spent" to={page("money", DS.payments)}>
        {where && spend[0] ? (
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <SpendFigure
              v={spend[0][1]}
              cur={spend[0][0]}
              items={pay.data.filter((p) => p.currency_code === spend[0][0]).map((p) => ({ v: amountPaid(p), t: p._t }))}
              sub={
                <>
                  {pay.data.length} payments{spend.length > 1 ? ` · + ${spend.slice(1).map(([c, v]) => money(v, c)).join(", ")}` : ""}
                  {where.topMethod && (
                    <div>
                      mostly <b className="font-medium text-ink">{where.topMethod[0]}</b> ({Math.round((where.topMethod[1] / where.total) * 100)}%)
                    </div>
                  )}
                </>
              }
            />
            <div className="min-w-0">
              <div className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-muted" title="Estimated from which top-up's VP paid for each item (oldest VP first)">
                Where it went ≈
              </div>
              <div className="mb-2.5 flex h-2.5 overflow-hidden rounded-full bg-panel-2">
                {where.rows.map((r) => (
                  <div key={r.k} style={{ width: `${(r.v / where.total) * 100}%`, background: WHERE_COLORS[r.k] }} title={`${r.k}: ${money(r.v, where.main)}`} />
                ))}
              </div>
              <ul className="space-y-1 text-[13px]">
                {where.rows.map((r) => (
                  <li key={r.k} className="flex items-baseline justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: WHERE_COLORS[r.k] }} />
                      {r.k}
                    </span>
                    <span className="num text-muted">
                      {money(r.v, where.main)} <span className="text-faint">· {Math.round((r.v / where.total) * 100)}%</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            {byYear.length > 1 && (
              <div className="sm:col-span-2">
                <div className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-muted">By year</div>
                <ul className="space-y-1.5">
                  {byYear.map(([y, e]) => (
                    <li key={y} className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 text-[13px]">
                      <span className="num font-medium">{y}</span>
                      <div className="h-2 overflow-hidden rounded-full bg-panel-2">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${(e.amt / Math.max(...byYear.map(([, x]) => x.amt))) * 100}%` }} />
                      </div>
                      <span className="num text-[12px] text-muted">
                        {money(e.amt, spend[0][0])} <span className="text-faint">· {e.n}×</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="py-6 text-center text-muted">No payments in this period.</div>
        )}
      </Card>

      {/* 3. What the account owns. */}
      <Card span={6} title="Skins & battle passes" to={page("collection", DS.store)}>
        <div className="grid grid-cols-3 gap-3">
          <Tile k="Skins owned" v={coll.owned} hint={`${n0(coll.skinVP)} VP · ${coll.upgraded} upgraded`} tone="accent" onClick={toColl ? () => goTo("collection", { section: "skins", filter: "all" }) : undefined} />
          <Tile k="Battle passes" v={coll.passes} hint={`${n0(coll.passVP)} VP`} onClick={toColl ? () => goTo("collection", { filter: "passes" }) : undefined} />
          <Tile k="Bundles" v={coll.bundles} hint="bought whole" onClick={toColl ? () => goTo("collection", { section: "vp-purchases", filter: "category", value: "bundles" }) : undefined} />
        </div>
        {latestSkins.length > 0 && (
          <>
            <div className="mb-1.5 mt-4 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-muted">Latest skins</div>
            <ul className="divide-y divide-line">
              {latestSkins.map((s) => (
                <li key={s.r.transaction_id}>
                  <button type="button" disabled={!toColl} onClick={() => goTo("collection", { filter: "skin", value: s.name })} title={`Show ${s.name}`} className="-mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-panel-2">
                    {cat && <SkinImage src={cat.find(s.name)?.image} size="sm" className="h-7 w-16 shrink-0" />}
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{s.name}</span> <span className="text-faint">· {cat?.find(s.name)?.skin.weapon ?? s.weapon}</span>
                    </span>
                    <span className="num shrink-0 text-[12px] text-muted">
                      {guard(s.t, f.date(s.t))} · {n0(s.cost)} VP
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card span={6} title="Gameplay" hint="Real matches only (range & tutorial excluded)" to={page("matches", DS.matches)}>
        <div className="grid grid-cols-2 gap-3">
          <Tile k="Matches" v={games.length} hint={`on ${n0(play.days)} different days`} />
          <Tile k="Win rate" v={decided ? Math.round((wins / decided) * 1000) / 10 : 0} suffix="%" hint={`${n0(wins)} W · ${n0(decided - wins)} L`} />
          <Tile k="Time played" v={Math.round(hours)} suffix=" h" hint={hours >= 24 ? `≈ ${(hours / 24).toFixed(1)} days non-stop` : "in matches"} />
          <Tile k="Best win streak" v={play.best} hint="wins in a row" />
        </div>
        <div className="mt-3">
          <KV k="Most played mode" v={favMode ? `${favMode.name} · ${n0(favMode.n)} matches${favMode.rate != null ? ` · ${favMode.rate}% W` : ""}` : "—"} />
          <KV k="Longest match" v={play.longest ? `${Math.round(play.longest)} min` : "—"} mono />
          <KV k="Playing since" v={play.first ? <Sens>{`${pv.secret(f.date(play.first))} · last ${guard(play.last, f.date(play.last))}`}</Sens> : "—"} mono />
        </div>
      </Card>

      <Card span={6} title="Recent events" hint="Payments, purchases, security & penalties" pad={false}>
        <ul className="scroll-thin max-h-[330px] overflow-y-auto px-5 py-2">
          {feed.map((e, i) => (
            <li key={i} className="border-b border-dashed border-line last:border-0">
              <a href={`#${e.to}`} title={`Open ${e.to.charAt(0).toUpperCase() + e.to.slice(1)}`} className="-mx-2 flex gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-panel-2">
                <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${e.tone === "accent" ? "bg-accent-soft text-accent" : e.tone === "warn" ? "bg-warn-soft text-warn" : e.tone === "info" ? "bg-info-soft text-info" : "bg-panel-2 text-muted"}`}>{e.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{e.text}</div>
                  <div className="num text-[12px] text-muted">
                    <Sens>{e.created ? pv.secret(f.dateTime(e.t)) : guard(e.t, f.dateTime(e.t))}</Sens> · {e.tag}
                  </div>
                </div>
              </a>
            </li>
          ))}
          {!feed.length && <li className="py-10 text-center text-muted">Nothing in this period.</li>}
        </ul>
      </Card>

    </Page>
  );
}

function IpRow({ k, ip, sub, onClick, strong, secret, mask }: { k: string; ip: string; sub: string; onClick: () => void; strong?: boolean; /** fully hidden in privacy mode, not just partly */ secret?: boolean; /** masks other IPs (the creation IP can also be the most used or latest one) */ mask: (ip: string) => string }) {
  const pv = usePrivacy();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(ip).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };
  return (
    <div className={`-mx-2 grid grid-cols-[120px_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2 transition-colors ${SOFT_CSS} hover:bg-panel-3/60`}>
      <span className={`text-[12px] ${strong ? "font-semibold text-ink" : "text-muted"}`}>{k}</span>
      <button type="button" onClick={onClick} title="Show this IP on the Security page" className="min-w-0 text-left">
        <span className={`num block truncate font-medium ${strong ? "text-[16px] text-accent" : "text-[14px]"}`}>
          <Sens>{secret ? pv.secret(ip) : mask(ip)}</Sens>
        </span>
        <span className="num block text-[11.5px] text-faint">
          <Sens>{sub}</Sens>
        </span>
      </button>
      <span className="flex items-center gap-1.5">
        {!pv.hidden && (
          <button type="button" onClick={copy} aria-label={`Copy ${ip}`} title="Copy IP address" className="rounded-md p-1 text-faint hover:bg-panel-2 hover:text-ink">
            {copied ? <Check size={14} className="text-win" /> : <Copy size={14} />}
          </button>
        )}
      </span>
    </div>
  );
}

function Fact({ k, v, hint, small, wide }: { k: string; v: string; hint?: string; small?: boolean; /** take both columns */ wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? "col-span-2" : ""}`}>
      <div className="text-[11.5px] uppercase tracking-[0.12em] text-faint">{k}</div>
      <div className={`num mt-1 truncate font-medium ${small ? "text-[14px]" : "text-[18px] text-ink"}`}>
        <Sens>{v}</Sens>
      </div>
      {hint && (
        <div className="text-[11.5px] text-muted">
          <Sens>{hint}</Sens>
        </div>
      )}
    </div>
  );
}

function Tile({ k, v, hint, tone, suffix = "", onClick }: { k: string; v: number; hint?: string; tone?: "accent"; suffix?: string; onClick?: () => void }) {
  const body = (
    <>
      <div className={`num text-[24px] font-medium leading-none ${tone === "accent" ? "text-accent" : ""}`}>
        {v.toLocaleString("en")}
        {suffix}
      </div>
      <div className="mt-1.5 text-[12px] font-medium">{k}</div>
      {hint && <div className="num truncate text-[11px] text-faint">{hint}</div>}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="min-w-0 rounded-lg bg-panel-2 px-3 py-2.5 text-left transition-colors hover:bg-panel-3">
      {body}
    </button>
  ) : (
    <div className="min-w-0 rounded-lg bg-panel-2 px-3 py-2.5">{body}</div>
  );
}

