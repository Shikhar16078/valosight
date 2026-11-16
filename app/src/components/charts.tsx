import { useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, ComposedChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { localParts, useSettings } from "../lib/settings";
import { useInView } from "../lib/motion";

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

export function TooltipBox({ title, rows }: { title: ReactNode; rows: { label: string; value: ReactNode; color?: string }[] }) {
  return (
    <div className="pop px-3 py-2 text-[12.5px]">
      <div className="mb-1 font-semibold">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-6">
          <span className="flex items-center gap-1.5 text-muted">
            {r.color && <span className="h-2 w-2 rounded-sm" style={{ background: r.color }} />}
            {r.label}
          </span>
          <span className="num font-medium">{r.value}</span>
        </div>
      ))}
    </div>
  );
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

export function MonthlyChart({
  data,
  series,
  height = 260,
  yFormat = (v: number) => v.toLocaleString("en"),
}: {
  data: ({ month: string } & Record<string, number | string | null>)[];
  series: SeriesDef[];
  height?: number;
  yFormat?: (v: number) => string;
}) {
  const { f } = useSettings();
  const [ref, seen] = useInView<HTMLDivElement>();
  const anim = !useReducedMotion();
  const hasLine = series.some((s) => s.line && (s.axis ?? "r") === "r");
  return (
    <div ref={ref} style={{ height }}>
      {seen && (
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: hasLine ? 4 : 8, left: -8, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="2 4" />
          <XAxis dataKey="month" tickFormatter={f.monthLabel} tickLine={false} axisLine={false} minTickGap={18} />
          <YAxis yAxisId="l" tickFormatter={yFormat} tickLine={false} axisLine={false} width={56} />
          {hasLine && <YAxis yAxisId="r" orientation="right" tickLine={false} axisLine={false} width={44} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />}
          <Tooltip
            cursor={{ fill: "var(--panel-3)", opacity: 0.6 }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <TooltipBox
                  title={f.monthLabel(String(label))}
                  rows={series
                    .filter((s) => payload.some((p) => p.dataKey === s.key && p.value != null))
                    .map((s) => {
                      const v = Number(payload.find((p) => p.dataKey === s.key)?.value);
                      return { label: s.label, value: (s.format ?? yFormat)(v), color: s.color };
                    })}
                />
              ) : null
            }
          />
          {series.map((s, i) =>
            s.line ? (
              <Line key={s.key} yAxisId={s.axis ?? "r"} dataKey={s.key} stroke={s.color} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} type="linear" isAnimationActive={anim} animationBegin={300} animationDuration={700} animationEasing="ease-out" />
            ) : (
              <Bar
                key={s.key}
                yAxisId="l"
                dataKey={s.key}
                stackId={s.stack ? "a" : undefined}
                fill={s.color}
                radius={s.stack && i < series.filter((x) => !x.line).length - 1 ? 0 : [3, 3, 0, 0]}
                maxBarSize={28}
                isAnimationActive={anim}
                animationDuration={600}
                animationEasing="ease-out"
              />
            ),
          )}
        </ComposedChart>
      </ResponsiveContainer>
      )}
    </div>
  );
}

export function HBars({ data, format = (v) => v.toLocaleString("en"), color = C.accent, height }: { data: { label: string; value: number }[]; format?: (v: number) => string; color?: string; height?: number }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const anim = !useReducedMotion();
  return (
    <div ref={ref} style={{ height: height ?? Math.max(120, data.length * 34) }}>
      {seen && (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="label" width={150} tickLine={false} axisLine={false} tick={{ fontSize: 12.5, fill: "var(--text)", fontFamily: "IBM Plex Sans" }} />
          <Tooltip cursor={{ fill: "var(--panel-3)", opacity: 0.6 }} content={({ active, payload }) => (active && payload?.length ? <TooltipBox title={payload[0].payload.label} rows={[{ label: "Total", value: format(Number(payload[0].value)) }]} /> : null)} />
          <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive={anim} animationDuration={600} animationEasing="ease-out" label={{ position: "right", formatter: (v: any) => format(Number(v)), fill: "var(--muted)", fontSize: 11.5, fontFamily: "IBM Plex Mono" }} />
        </BarChart>
      </ResponsiveContainer>
      )}
    </div>
  );
}

export function Donut({ data, format = (v) => v.toLocaleString("en"), center }: { data: { label: string; value: number }[]; format?: (v: number) => string; center?: ReactNode }) {
  const total = data.reduce((a, b) => a + b.value, 0);
  const [hover, setHover] = useState<number | null>(null);
  const h = hover != null ? data[hover] : null;
  const pct = (v: number) => (total ? Math.round((v / total) * 100) : 0);
  const [ref, seen] = useInView<HTMLDivElement>();
  const anim = !useReducedMotion();
  // No floating tooltip: the hovered slice is described in the ring's centre, so nothing overlaps.
  return (
    <div className="flex flex-wrap items-center gap-6">
      {/* Clear the hover only when leaving the ring, not in the gaps between slices (that made the centre flicker). */}
      <div ref={ref} className="relative h-[180px] w-[180px] shrink-0" onMouseLeave={() => setHover(null)}>
        {seen && (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius={58}
              outerRadius={84}
              paddingAngle={2}
              stroke="none"
              startAngle={90}
              endAngle={-270}
              isAnimationActive={anim}
              animationDuration={800}
              animationEasing="ease-out"
              onMouseEnter={(_, i) => setHover(i)}
            >
              {data.map((_, i) => (
                <Cell
                  key={i}
                  fill={SERIES[i % SERIES.length]}
                  opacity={hover == null || hover === i ? 1 : 0.3}
                  style={{
                    // The hovered slice eases outward from the ring's centre; the others fade back.
                    transformBox: "view-box",
                    transformOrigin: "50% 50%",
                    transform: hover === i ? "scale(1.07)" : "scale(1)",
                    transition: anim ? "transform .35s cubic-bezier(0.22,1,0.36,1), opacity .3s ease" : "none",
                    outline: "none",
                  }}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        )}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={hover ?? "center"}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
            >
              {h ? (
                <>
                  <div className="num text-lg font-medium leading-tight">{format(h.value)}</div>
                  <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-tight text-muted">
                    {h.label} · {pct(h.value)}%
                  </div>
                </>
              ) : (
                center
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      <ul className="min-w-[180px] flex-1 space-y-0.5">
        {data.map((d, i) => (
          <li
            key={d.label}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            className={`flex items-center justify-between gap-3 rounded-md px-2 py-1 text-[13px] transition-[background-color,opacity] duration-300 ${hover === i ? "bg-panel-2" : ""} ${hover != null && hover !== i ? "opacity-50" : ""}`}
          >
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES[i % SERIES.length] }} />
              {d.label}
            </span>
            <span className="num text-muted">
              {format(d.value)} <span className="text-faint">· {pct(d.value)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
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
          <button key={yy} onClick={() => setYear(yy)} className={`num rounded-md px-2 py-0.5 text-[12.5px] ${yy === y ? "bg-accent text-white" : "text-muted hover:bg-panel-2"}`}>
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
