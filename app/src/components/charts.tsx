import { Suspense, useMemo, useState, type ReactNode } from "react";
import { localParts, useSettings } from "../lib/settings";
import { useInView } from "../lib/motion";
import { lazyRetry } from "../lib/lazy-retry";

// Recharts (and its dependencies) is a large download, so the charts that use it live in their own chunk, loaded
// as soon as a page with charts is loaded. Until it's here, each chart shows a placeholder of
// its own size, so nothing jumps.
const loadImpl = () => import("./charts-impl");
const LazyMonthly = lazyRetry(() => loadImpl().then((m) => ({ default: m.MonthlyChart })));
const LazyDonut = lazyRetry(() => loadImpl().then((m) => ({ default: m.Donut })));
// Pages that import this file draw charts, so fetch the chart code alongside them rather than when a chart mounts.
loadImpl().catch(() => {}); // a failure shows in the chart's error boundary when it mounts

export const C = {
  accent: "var(--accent)",
  loss: "var(--loss)",
  win: "var(--win)",
  warn: "var(--warn)",
  info: "var(--info)",
  muted: "var(--faint)",
};
export const SERIES = ["var(--accent)", "var(--win)", "var(--info)", "var(--warn)", "#a874e8", "#e86fb0", "#7fb24a", "var(--faint)"];

/** All month keys between first and last (inclusive). */
export function monthSpan(keys: string[]): string[] {
  if (!keys.length) return [];
  const s = [...keys].sort();
  let [y, m] = s[0].split("-").map(Number);
  const [ey, em] = s[s.length - 1].split("-").map(Number);
  const out: string[] = [];
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
  stack?: boolean;
  line?: boolean;
  /** Which y-axis a line uses: "r" (0–100 %, default) or "l" (same scale as the bars). */
  axis?: "l" | "r";
  format?: (v: number) => string;
}

export interface MonthlyChartProps {
  data: ({ month: string } & Record<string, number | string | null>)[];
  series: SeriesDef[];
  height?: number;
  yFormat?: (v: number) => string;
  /** Makes each month clickable (e.g. filter a table to that month). */
  onPick?: (month: string) => void;
}

export interface DonutProps {
  data: { label: string; value: number }[];
  format?: (v: number) => string;
  center?: ReactNode;
  /** Makes slices and legend rows clickable. */
  onPick?: (label: string) => void;
}

const BARS = [40, 65, 50, 80, 35, 70, 90, 55, 60, 75, 45, 85];

/** Bars over months (with optional lines). Loads Recharts on first use. */
export function MonthlyChart(props: MonthlyChartProps) {
  const height = props.height ?? 260;
  return (
    <Suspense
      fallback={
        <div aria-hidden>
          {props.series.length > 1 && <div className="skeleton mb-2 ml-auto h-[18px] w-48" />}
          <div className="flex items-end gap-2 pb-6 pl-14 pr-2 pt-2" style={{ height }}>
            {BARS.map((h, i) => (
              <div key={i} className="skeleton flex-1" style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>
      }
    >
      <LazyMonthly {...props} />
    </Suspense>
  );
}

/** A ring of shares with its legend. Loads Recharts on first use. */
export function Donut(props: DonutProps) {
  return (
    <Suspense
      fallback={
        <div className="flex flex-wrap items-center gap-6" aria-hidden>
          <div className="relative h-[180px] w-[180px] shrink-0">
            <div className="skeleton absolute inset-[6px] rounded-full [mask:radial-gradient(circle,transparent_57%,#000_58%)]" />
          </div>
          <div className="min-w-[180px] flex-1 space-y-2">
            {props.data.slice(0, 6).map((d) => (
              <div key={d.label} className="skeleton h-6 w-full" />
            ))}
          </div>
        </div>
      }
    >
      <LazyDonut {...props} />
    </Suspense>
  );
}

/** GitHub-style calendar of daily counts for one year (local timezone). */
export function CalendarHeatmap({ times, years, label = "matches" }: { times: string[]; years: number[]; label?: string }) {
  const { settings, f } = useSettings();
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of times) {
      const k = f.dayKey(t);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [times, f]);
  const avail = useMemo(() => {
    const ys = new Set<number>();
    for (const t of times) ys.add(localParts(t, settings.tz).y);
    return years.filter((y) => ys.has(y)).sort((a, b) => b - a);
  }, [times, years, settings.tz]);
  const [year, setYear] = useState<number | null>(null);
  const y = year && avail.includes(year) ? year : avail[0];
  const [hover, setHover] = useState<{ k: string; n: number } | null>(null);
  const [ref, seen] = useInView<HTMLDivElement>();
  if (!y) return null;

  const start = new Date(Date.UTC(y, 0, 1));
  const offset = (start.getUTCDay() + 6) % 7; // Monday first
  const days: { k: string; n: number; col: number; row: number }[] = [];
  for (let d = new Date(start); d.getUTCFullYear() === y; d.setUTCDate(d.getUTCDate() + 1)) {
    const i = Math.round((d.getTime() - start.getTime()) / 864e5) + offset;
    const k = d.toISOString().slice(0, 10);
    days.push({ k, n: counts.get(k) ?? 0, col: Math.floor(i / 7), row: i % 7 });
  }
  const max = Math.max(1, ...days.map((d) => d.n));
  const lvl = (n: number) => (n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)));
  const fill = ["var(--panel-2)", "color-mix(in srgb, var(--accent) 28%, var(--panel-2))", "color-mix(in srgb, var(--accent) 50%, var(--panel-2))", "color-mix(in srgb, var(--accent) 75%, var(--panel-2))", "var(--accent)"];
  const cols = Math.max(...days.map((d) => d.col)) + 1;
  const cell = 13,
    gap = 3;
  const months = Array.from({ length: 12 }, (_, m) => {
    const d = new Date(Date.UTC(y, m, 1));
    const i = Math.round((d.getTime() - start.getTime()) / 864e5) + offset;
    return { m, col: Math.floor(i / 7) };
  });
  const active = days.filter((d) => d.n).length;
  const total = days.reduce((a, b) => a + b.n, 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {avail.map((yy) => (
          <button key={yy} onClick={() => setYear(yy)} className={`num rounded-md px-2 py-0.5 text-[12.5px] ${yy === y ? "bg-accent text-[var(--on-accent)]" : "text-muted hover:bg-panel-2"}`}>
            {yy}
          </button>
        ))}
        <span className="ml-auto text-[12.5px] text-muted">
          {hover ? (
            <>
              <span className="num">{f.dayLabel(hover.k)}</span> · <b className="text-ink">{hover.n}</b> {label}
            </>
          ) : (
            <>
              <b className="num text-ink">{total.toLocaleString("en")}</b> {label} on <b className="num text-ink">{active}</b> days
            </>
          )}
        </span>
      </div>
      <div ref={ref} className="scroll-thin overflow-x-auto">
        <svg width={cols * (cell + gap) + 28} height={7 * (cell + gap) + 18} className="block">
          {months.map(({ m, col }) => (
            <text key={m} x={28 + col * (cell + gap)} y={10} className="fill-[var(--muted)] font-mono text-[10px]">
              {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m]}
            </text>
          ))}
          {["Mon", "", "Wed", "", "Fri", "", ""].map((d, i) => (
            <text key={i} x={0} y={18 + i * (cell + gap) + 10} className="fill-[var(--faint)] font-mono text-[9.5px]">
              {d}
            </text>
          ))}
          {days.map((d) => (
            <rect
              key={d.k}
              x={28 + d.col * (cell + gap)}
              y={18 + d.row * (cell + gap)}
              width={cell}
              height={cell}
              rx={3}
              className="heat-cell"
              fill={fill[lvl(d.n)]}
              stroke={d.n ? "none" : "var(--line)"}
              strokeWidth={0.5}
              style={{ opacity: seen ? 1 : 0, transition: `opacity .35s ease-out ${(d.col + d.row) * 4}ms` }}
              onMouseEnter={() => setHover(d)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}

/** Weekday × hour grid in the chosen timezone. */
export function WeekHourHeatmap({ times, label = "matches" }: { times: string[]; label?: string }) {
  const { settings, f } = useSettings();
  const grid = useMemo(() => {
    const g = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
    for (const t of times) {
      const p = localParts(t, settings.tz);
      g[p.wd][p.h]++;
    }
    return g;
  }, [times, settings.tz]);
  const max = Math.max(1, ...grid.flat());
  const [hover, setHover] = useState<string | null>(null);
  const [ref, seen] = useInView<HTMLDivElement>();
  const hr = (h: number) => (settings.hour12 ? `${h % 12 || 12}${h < 12 ? "a" : "p"}` : String(h).padStart(2, "0"));
  return (
    <div>
      <div className="mb-2 h-5 text-right text-[12.5px] text-muted">{hover ?? `Times shown in ${f.tzLabel}`}</div>
      <div ref={ref} className="scroll-thin overflow-x-auto">
        <div className="grid min-w-[620px] gap-[3px]" style={{ gridTemplateColumns: "36px repeat(24, minmax(0, 1fr))" }}>
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="text-center font-mono text-[9.5px] text-faint">
              {h % 3 === 0 ? hr(h) : ""}
            </div>
          ))}
          {grid.map((row, d) => (
            <div key={d} className="contents">
              <div className="font-mono text-[10.5px] leading-[22px] text-muted">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d]}</div>
              {row.map((n, h) => (
                <div
                  key={h}
                  onMouseEnter={() => setHover(`${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d]} ${hr(h)}:00 – ${n} ${label}`)}
                  onMouseLeave={() => setHover(null)}
                  className="heat-cell h-[22px] rounded-[4px] ring-inset ring-line [&:not([data-n])]:ring-[0.5px]"
                  data-n={n || undefined}
                  style={{
                    background: n ? `color-mix(in srgb, var(--accent) ${15 + (n / max) * 85}%, var(--panel-2))` : "var(--panel-2)",
                    opacity: seen ? 1 : 0,
                    transition: `opacity .35s ease-out ${(d + h) * 8}ms`,
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
