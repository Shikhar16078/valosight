/**
 * The Recharts-based charts. Recharts and its dependencies are large, so this file is its own chunk: views import
 * `MonthlyChart` / `Donut` from `charts.tsx`, which loads this on demand and shows a placeholder meanwhile.
 */
import { useState, type ReactNode } from "react";
import { Bar, CartesianGrid, Cell, Line, ComposedChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useSettings } from "../lib/settings";
import { useInView } from "../lib/motion";
import { SERIES, type DonutProps, type MonthlyChartProps } from "./charts";

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

export function MonthlyChart({
  data,
  series,
  height = 260,
  yFormat = (v: number) => v.toLocaleString("en"),
  onPick,
}: MonthlyChartProps) {
  const { f } = useSettings();
  const [ref, seen] = useInView<HTMLDivElement>();
  const anim = !useReducedMotion();
  const hasLine = series.some((s) => s.line && (s.axis ?? "r") === "r");
  return (
    <div>
    {/* A legend whenever the chart uses more than one colour (bars as squares, lines as a line with a dot). */}
    {series.length > 1 && (
      <ul className="mb-2 flex flex-wrap justify-end gap-x-4 gap-y-1 text-[12px] text-muted">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            {s.line ? (
              <span className="relative h-2.5 w-4" aria-hidden>
                <span className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 rounded" style={{ background: s.color }} />
                <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: s.color }} />
              </span>
            ) : (
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
            )}
            {s.label}
          </li>
        ))}
      </ul>
    )}
    <div ref={ref} style={{ height }} className={onPick ? "chart-pick" : undefined}>
      {seen && (
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          onClick={
            onPick &&
            ((st) => {
              // No active bar (a click in the margin) gives null; Number(null) would be 0, the first month.
              const i = st?.activeTooltipIndex == null ? NaN : Number(st.activeTooltipIndex);
              const m = Number.isInteger(i) ? data[i]?.month : st?.activeLabel != null ? String(st.activeLabel) : undefined;
              if (m) onPick(m);
            })
          }
          data={data}
          margin={{ top: 8, right: hasLine ? 4 : 8, left: -8, bottom: 0 }}>
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
    </div>
  );
}

export function Donut({ data, format = (v) => v.toLocaleString("en"), center, onPick }: DonutProps) {
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
      <div ref={ref} className={`relative h-[180px] w-[180px] shrink-0 ${onPick ? "chart-pick" : ""}`} onMouseLeave={() => setHover(null)}>
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
              onClick={onPick && ((_, i) => onPick(data[i].label))}
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
            {...(onPick && { role: "button", tabIndex: 0, title: `Show ${d.label}`, onClick: () => onPick(d.label), onKeyDown: (e: React.KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPick(d.label)) })}
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

