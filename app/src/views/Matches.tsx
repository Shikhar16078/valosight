import { useEffect, useMemo, useRef, useState } from "react";
import { useCreated, useDateGuard } from "../lib/privacy-dates";
import { usePrivacy } from "../lib/privacy";
import { useAccount, useRecords } from "../lib/account";
import type { Rec } from "../lib/api";
import { useSettings } from "../lib/settings";
import { DS, isRealMatch, matchMinutes, n0, queueName, winStreaks } from "../lib/valorant";
import { buildSessions, tilt } from "../lib/sessions";
import { Badge, Bar, Card, Empty, Page, Stat } from "../components/ui";
import { C, CalendarHeatmap, MonthlyChart, WeekHourHeatmap, monthSpan } from "../components/charts";
import { DataTable, type Col, type Facet, type Preset } from "../components/DataTable";
import { SOFT_CSS } from "../components/anim";
import { scrollToSection } from "../lib/focus";

export function Matches() {
  const { has, years } = useAccount();
  const { f } = useSettings();
  const guard = useDateGuard();
  const mh = useRecords(DS.matches);
  const [mode, setMode] = useState<string>("all");

  const games = useMemo(() => mh.data.filter(isRealMatch), [mh.data]);
  const modes = useMemo(() => {
    const m = new Map<string, { n: number; w: number; l: number; min: number }>();
    for (const g of mh.data) {
      const k = queueName(g);
      const e = m.get(k) ?? { n: 0, w: 0, l: 0, min: 0 };
      e.n++;
      if (g.game_outcome === "Win") e.w++;
      if (g.game_outcome === "Loss") e.l++;
      e.min += matchMinutes(g) ?? 0;
      m.set(k, e);
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [mh.data]);

  const sel = useMemo(() => (mode === "all" ? games : mh.data.filter((g) => queueName(g) === mode)), [mode, games, mh.data]);
  const wins = sel.filter((g) => g.game_outcome === "Win").length;
  const losses = sel.filter((g) => g.game_outcome === "Loss").length;
  const mins = sel.map(matchMinutes).filter((x): x is number => x != null);
  const hours = mins.reduce((a, b) => a + b, 0) / 60;

  const monthly = useMemo(() => {
    const m = new Map<string, { w: number; l: number; o: number }>();
    for (const g of sel) {
      if (!g._t) continue;
      const k = f.monthKey(g._t);
      const e = m.get(k) ?? { w: 0, l: 0, o: 0 };
      if (g.game_outcome === "Win") e.w++;
      else if (g.game_outcome === "Loss") e.l++;
      else e.o++;
      m.set(k, e);
    }
    return monthSpan([...m.keys()]).map((k) => {
      const e = m.get(k) ?? { w: 0, l: 0, o: 0 };
      const d = e.w + e.l;
      return { month: k, win: e.w, loss: e.l, other: e.o, rate: d >= 5 ? Math.round((e.w / d) * 100) : null };
    });
  }, [sel, f]);

  const streaks = useMemo(() => winStreaks(sel), [sel]);
  // The calendar shows exact days: in privacy mode it leaves out the account-creation day, which is hidden.
  const created = useCreated();
  const { hidden } = usePrivacy();
  const calTimes = useMemo(() => {
    const day = hidden && created ? f.dayKey(created) : null;
    return sel.map((g) => g._t).filter((t): t is string => !!t && (!day || f.dayKey(t) !== day));
  }, [sel, hidden, created, f]);

  const sessions = useMemo(() => buildSessions(sel), [sel]);
  const t = useMemo(() => tilt(sessions), [sessions]);
  const byLen = useMemo(() => {
    const b = [
      { label: "1 game", min: 1, max: 1 },
      { label: "2–3 games", min: 2, max: 3 },
      { label: "4–6 games", min: 4, max: 6 },
      { label: "7+ games", min: 7, max: 1e9 },
    ];
    return b.map((x) => {
      const ss = sessions.filter((s) => s.games.length >= x.min && s.games.length <= x.max);
      const g = ss.flatMap((s) => s.games);
      const w = g.filter((m) => m.game_outcome === "Win").length;
      const d = g.filter((m) => m.game_outcome === "Win" || m.game_outcome === "Loss").length;
      return { ...x, sessions: ss.length, rate: d ? (w / d) * 100 : null };
    });
  }, [sessions]);
  const longest = sessions.reduce((a, s) => (s.games.length > (a?.games.length ?? 0) ? s : a), null as (typeof sessions)[number] | null);
  const [preset, setPreset] = useState<Preset<Rec> | null>(null);
  // The best-streak filter holds this selection's games: drop it when the mode or period changes.
  const streakPick = useRef(false);
  useEffect(() => {
    if (streakPick.current) {
      streakPick.current = false;
      setPreset(null);
    }
  }, [sel]);
  const matchFacets = useMemo<Facet<Rec>[]>(
    () => [
    { id: "year", label: "Year", value: (r) => (r._t ? f.monthKey(r._t).slice(0, 4) : null), order: (a, b) => b.localeCompare(a) },
    { id: "mode", label: "Mode", value: (r) => queueName(r) },
    { id: "res", label: "Result", value: (r) => r.game_outcome },
    { id: "server", label: "Server", value: (r) => String(r.realm_id ?? "").toUpperCase() || null },
  ],
    [f],
  );
  const [sortBy, setSortBy] = useState<{ id: string; desc: boolean } | null>(null);
  const showMatches = (p: Preset<Rec> | null, sort?: { id: string; desc: boolean }) => {
    streakPick.current = false;
    setPreset(p);
    setSortBy(sort ?? { id: "date", desc: true });
    scrollToSection("matches");
  };
  const maxMode = Math.max(1, ...modes.map(([, e]) => e.n));
  const cols: Col<Rec>[] = [
    { id: "date", header: "Date", value: (r) => r._t, cell: (r) => <span className="num">{guard(r._t, f.date(r._t))}</span> },
    { id: "start", header: `Start (${f.tzLabel})`, value: (r) => f.time(r._t), mono: true },
    { id: "len", header: "Minutes", value: (r) => Math.round(matchMinutes(r) ?? 0), mono: true, align: "right" },
    { id: "mode", header: "Mode", value: (r) => queueName(r) },
    { id: "res", header: "Result", value: (r) => r.game_outcome, cell: (r) => <Badge tone={r.game_outcome === "Win" ? "win" : r.game_outcome === "Loss" ? "loss" : "neutral"}>{r.game_outcome}</Badge> },
    { id: "server", header: "Server", value: (r) => String(r.realm_id ?? "").toUpperCase(), mono: true },
    { id: "id", header: "Match ID", value: (r) => r.game_id, mono: true },
  ];

  if (!has(DS.matches)) return <Page code="03 / Matches" title="Matches"><Card><Empty title="No match history">This export has no VALORANT match records.</Empty></Card></Page>;

  return (
    <Page
      loading={mh.loading}
      code="03 / Matches"
      title="Match history"
      sub={`${mode === "all" ? "All real matches (range & tutorial excluded)" : mode} · times in ${f.tzLabel}`}
      actions={
        <select value={mode} onChange={(e) => setMode(e.target.value)} className="rounded-lg border border-line bg-panel px-3 py-1.5">
          <option value="all">All modes</option>
          {modes.map(([k, e]) => (
            <option key={k} value={k}>
              {k} ({e.n})
            </option>
          ))}
        </select>
      }
    >
      <Stat label="Matches" onClick={() => showMatches(null)} action="Show every match" value={sel.length} sub={`${hours.toFixed(0)} hours played`} />
      <Stat label="Win rate" onClick={() => showMatches({ label: "Wins", test: (r) => r.game_outcome === "Win" })} action="Show your wins" value={wins + losses ? (wins / (wins + losses)) * 100 : 0} format={(v) => `${v.toFixed(1)}%`} tone="win" sub={`${wins} W · ${losses} L`} />
      <Stat label="Avg. match length" onClick={() => showMatches(null, { id: "len", desc: true })} action="Show matches, longest first" value={mins.length ? mins.reduce((a, b) => a + b, 0) / mins.length : 0} format={(v) => `${v.toFixed(0)} min`} sub={`longest ${Math.round(Math.max(0, ...mins))} min`} />
      <Stat label="Best win streak" onClick={streaks.bw ? () => { showMatches({ label: `Best win streak (${streaks.bw})`, test: (r) => streaks.best.has(r) }, { id: "date", desc: false }); streakPick.current = true; } : undefined} action="Show the games of your best win streak" value={streaks.bw} tone="accent" sub={`worst losing streak ${streaks.bl}`} />

      <Card span={8} title="Results per month" hint="Bars = matches · line = win rate (months with 5+ decided games) · click a month to see its matches">
        {monthly.length ? (
          <MonthlyChart
            onPick={(m) => showMatches({ label: f.monthLabel(m), test: (r) => !!r._t && f.monthKey(r._t) === m })}
            height={320}
            data={monthly}
            series={[
              { key: "win", label: "Wins", color: C.win, stack: true },
              { key: "loss", label: "Losses", color: C.loss, stack: true },
              { key: "other", label: "Other", color: C.muted, stack: true },
              { key: "rate", label: "Win rate", color: C.warn, line: true, format: (v) => `${v}%` },
            ]}
          />
        ) : (
          <Empty title="No matches in this period" />
        )}
      </Card>
      <ModesCard modes={modes} mode={mode} setMode={setMode} maxMode={maxMode} />

      <Card span={6} title="Play sessions" hint="A new session starts after a 30-minute break">
        <div className="grid grid-cols-3 gap-3">
          <MiniStat k="Sessions" v={sessions.length.toLocaleString("en")} />
          <MiniStat k="Games / session" v={sessions.length ? (sel.length / sessions.length).toFixed(1) : "—"} />
          <MiniStat k="Avg. length" v={sessions.length ? `${Math.round(sessions.reduce((a, s) => a + s.minutes, 0) / sessions.length)} min` : "—"} />
        </div>
        {longest && (
          <p className="mt-3 text-[13px] text-muted">
            Longest: <b className="text-ink">{longest.games.length} games</b> on <span className="num">{f.date(longest.start)}</span> ({Math.round(longest.minutes / 60 * 10) / 10} h)
          </p>
        )}
        <div className="mt-4 space-y-2">
          <div className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-muted">Win rate by session length</div>
          {byLen.map((b) => (
            <div key={b.label} className="grid grid-cols-[90px_1fr_120px] items-center gap-3 text-[13px]">
              <span>{b.label}</span>
              <div className="h-2 overflow-hidden rounded-full bg-panel-2">
                <div className="h-full rounded-full bg-win" style={{ width: `${b.rate ?? 0}%` }} />
              </div>
              <span className="num text-right text-muted">{b.rate == null ? "—" : `${b.rate.toFixed(0)}%`} · {b.sessions} sess.</span>
            </div>
          ))}
        </div>
      </Card>

      <Card span={6} title="Tilt check" hint="Win rate of your next game in the same session">
        <div className="grid grid-cols-2 gap-3">
          <TiltBox label="First game of a session" x={t.first} />
          <TiltBox label="After a win" x={t.afterWin} tone="win" />
          <TiltBox label="After a loss" x={t.afterLoss} tone="loss" />
          <TiltBox label="After 2+ losses in a row" x={t.after2Loss} tone="loss" />
        </div>
        <p className="mt-3 text-[12.5px] text-muted">
          {t.afterLoss.rate != null && t.afterWin.rate != null
            ? t.afterWin.rate - t.afterLoss.rate >= 5
              ? `You win ${(t.afterWin.rate - t.afterLoss.rate).toFixed(0)} points less often after a loss — a break after losing may help.`
              : "Losing a game doesn't noticeably change how your next game goes."
            : "Not enough games in sessions yet."}
        </p>
      </Card>

      <Card span={12} title="When you play" hint="Matches by weekday and hour">
        <WeekHourHeatmap times={sel.map((g) => g._t!).filter(Boolean)} />
      </Card>

      <Card span={12} title="Play calendar" hint={`Days you played, in ${f.tzLabel}`}>
        <CalendarHeatmap times={calTimes} years={years} />
      </Card>

      <Card id="matches" span={12} title="All matches" pad={false}>
        <DataTable rows={sel} cols={cols} preset={preset} onClearPreset={() => setPreset(null)} sortBy={sortBy} facets={matchFacets} initialSort={{ id: "date", desc: true }} filename="matches" />
      </Card>
    </Page>
  );
}

function MiniStat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg bg-panel-2 px-3 py-2">
      <div className="num text-[19px] font-medium">{v}</div>
      <div className="text-[11.5px] text-muted">{k}</div>
    </div>
  );
}

function TiltBox({ label, x, tone }: { label: string; x: { rate: number | null; n: number }; tone?: "win" | "loss" }) {
  return (
    <div className="rounded-lg bg-panel-2 px-3 py-2.5">
      <div className={`num text-[22px] font-medium ${tone === "win" ? "text-win" : tone === "loss" ? "text-loss" : ""}`}>{x.rate == null ? "—" : `${x.rate.toFixed(0)}%`}</div>
      <div className="text-[12px] text-muted">{label}</div>
      <div className="num text-[11px] text-faint">{x.n} games</div>
    </div>
  );
}

/**
 * Modes, as a list that scrolls inside the card. The card takes the chart's height (the list never sets the
 * row's height), so nothing resizes and the chart never stretches. Soft fades at the edges show there's more.
 */
function ModesCard({ modes, mode, setMode, maxMode }: { modes: [string, { n: number; w: number; l: number }][]; mode: string; setMode: (m: string) => void; maxMode: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ top: false, bottom: false });
  const measure = () => {
    const el = box.current;
    if (!el) return;
    setEdge({ top: el.scrollTop > 2, bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 2 });
  };
  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [modes.length]);
  const mask = `linear-gradient(to bottom, ${edge.top ? "transparent" : "#000"} 0, #000 28px, #000 calc(100% - 28px), ${edge.bottom ? "transparent" : "#000"} 100%)`;
  return (
    <Card fill span={4} title="Modes" hint={`${modes.length} modes · click one to filter the page`}>
      <div className="relative h-full min-h-[300px]">
        <div ref={box} onScroll={measure} className="scroll-thin absolute inset-0 space-y-0.5 overflow-y-auto pr-1" style={{ maskImage: mask, WebkitMaskImage: mask }}>
          {modes.map(([k, e]) => (
            <button
              key={k}
              onClick={() => setMode(mode === k ? "all" : k)}
              aria-pressed={mode === k}
              className={`grid w-full grid-cols-[minmax(0,1fr)_70px_auto] items-center gap-3 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors ${SOFT_CSS} hover:bg-panel-2 ${mode === k ? "bg-panel-2 ring-1 ring-line-strong" : ""}`}
            >
              <span className="truncate font-medium">{k}</span>
              <Bar value={e.n} max={maxMode} />
              <span className="num w-[86px] text-right text-[12px] text-muted">
                {n0(e.n)} · {e.w + e.l ? Math.round((e.w / (e.w + e.l)) * 100) + "% W" : "—"}
              </span>
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}
