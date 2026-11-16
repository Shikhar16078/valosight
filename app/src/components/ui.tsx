import { animate, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { Children, useEffect, useRef, type PointerEvent, type ReactNode } from "react";
import { useSettings } from "../lib/settings";
import { EASE_EMPH, StaggerIndex, lastShown, revealVariants, spotlight, useReveal } from "../lib/motion";

export function Page({
  code,
  title,
  sub,
  children,
  actions,
  loading = false,
}: {
  code: string;
  title: string;
  sub?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  /** While the page's data is loading, show placeholders instead of half-computed numbers. */
  loading?: boolean;
}) {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pb-16 pt-6 sm:px-8">
      <motion.header initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, ease: EASE_EMPH }} className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-accent">{code}</div>
          <h1 className="font-display text-[30px] font-semibold leading-tight tracking-tight" aria-label={title}>
            {title.split(" ").map((w, i) => (
              <motion.span
                key={i}
                aria-hidden
                className="inline-block whitespace-pre"
                initial={{ opacity: 0, y: "0.45em", filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={{ duration: 0.55, ease: EASE_EMPH, delay: 0.05 + i * 0.06 }}
              >
                {w + " "}
              </motion.span>
            ))}
          </h1>
          {sub && <p className="mt-1 max-w-2xl text-muted">{sub}</p>}
        </div>
        {actions}
      </motion.header>
      <div className="grid grid-cols-12 gap-4">
        {loading ? (
          <PageSkeleton />
        ) : (
          Children.toArray(children).map((c, i) => (
            <StaggerIndex.Provider key={i} value={i}>
              {c}
            </StaggerIndex.Provider>
          ))
        )}
      </div>
    </div>
  );
}

/** Placeholder shaped like a typical page: four stats, a chart and a table. */
export function PageSkeleton() {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="panel col-span-12 px-5 py-4 sm:col-span-6 xl:col-span-3" aria-hidden>
          <div className="skeleton h-3 w-20" />
          <div className="skeleton mt-3 h-7 w-28" />
          <div className="skeleton mt-3 h-3 w-36" />
        </div>
      ))}
      <div className="panel col-span-12 p-5 xl:col-span-8" aria-hidden>
        <div className="skeleton h-4 w-40" />
        <div className="mt-6 flex h-[200px] items-end gap-2">
          {[40, 65, 50, 80, 35, 70, 90, 55, 60, 75, 45, 85].map((h, i) => (
            <div key={i} className="skeleton flex-1" style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>
      <div className="panel col-span-12 space-y-3 p-5 xl:col-span-4" aria-hidden>
        <div className="skeleton h-4 w-32" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="skeleton h-8 w-full" />
        ))}
      </div>
      <span className="sr-only" role="status">
        Loading…
      </span>
    </>
  );
}

const SPAN: Record<number, string> = {
  3: "col-span-12 sm:col-span-6 xl:col-span-3",
  4: "col-span-12 md:col-span-6 xl:col-span-4",
  5: "col-span-12 xl:col-span-5",
  6: "col-span-12 xl:col-span-6",
  7: "col-span-12 xl:col-span-7",
  8: "col-span-12 xl:col-span-8",
  12: "col-span-12",
};

/** @deprecated use useReveal(); kept so `variants={item}` still animates with its parent. */
export const item = revealVariants;

export function Card({
  span = 12,
  title,
  hint,
  right,
  children,
  className = "",
  pad = true,
  accent = false,
}: {
  span?: number;
  title?: ReactNode;
  hint?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  pad?: boolean;
  accent?: boolean;
}) {
  const reveal = useReveal();
  return (
    <motion.section {...reveal} onPointerMove={spotlight} className={`panel spot ${accent ? "corner" : ""} ${SPAN[span] ?? SPAN[12]} min-w-0 ${className}`}>
      {(title || right) && (
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="font-display text-[15px] font-semibold uppercase tracking-[0.06em]">{title}</h2>
            {hint && <p className="mt-0.5 text-[12.5px] text-muted">{hint}</p>}
          </div>
          {right}
        </div>
      )}
      <div className={pad ? "p-5" : ""}>{children}</div>
    </motion.section>
  );
}

/** Animated number. With `id`, it continues from the value it last showed instead of starting at 0. */
export function CountUp({ value, format, id }: { value: number; format: (v: number) => string; id?: string }) {
  const reduce = useReducedMotion();
  const from = useRef(id != null ? (lastShown.get(id) ?? 0) : 0);
  const mv = useMotionValue(reduce ? value : from.current);
  const text = useTransform(mv, (v) => format(v));
  useEffect(() => {
    if (id != null) lastShown.set(id, value);
    if (reduce || mv.get() === value) {
      mv.set(value);
      return;
    }
    const c = animate(mv, value, { duration: 0.9, ease: EASE_EMPH });
    return () => c.stop();
  }, [value, mv, id, reduce]);
  return <motion.span>{text}</motion.span>;
}

export function Stat({
  label,
  value,
  format = (v) => Math.round(v).toLocaleString("en"),
  sub,
  extra,
  tone = "default",
  span = 3,
}: {
  label: string;
  value: number | string;
  format?: (v: number) => string;
  sub?: ReactNode;
  /** Shown right under the number, e.g. converted-currency chips. */
  extra?: ReactNode;
  tone?: "default" | "accent" | "win" | "warn";
  span?: number;
}) {
  const color = { default: "text-ink", accent: "text-accent", win: "text-win", warn: "text-warn" }[tone];
  const reveal = useReveal();
  const tilt = useTilt();
  const attention = tone === "warn" && typeof value === "number" && value > 0;
  return (
    <motion.div
      {...reveal}
      {...tilt.bind}
      style={tilt.style}
      whileHover={{ y: -3 }}
      className={`panel spot ${attention ? "breathe" : ""} ${SPAN[span] ?? SPAN[3]} min-w-0 px-5 py-4 hover:shadow-[var(--shadow-2)]`}
    >
      <div className="text-[12px] font-medium uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className={`num mt-1.5 truncate text-[28px] font-medium leading-none ${color}`}>
        {typeof value === "number" ? <CountUp value={value} format={format} id={`stat:${label}`} /> : value}
      </div>
      {extra && <div className="mt-2.5">{extra}</div>}
      {sub && <div className="mt-2 truncate text-[12.5px] text-muted">{sub}</div>}
    </motion.div>
  );
}

/** 3D tilt toward the pointer (Settings → Motion & effects), springy and small. Also feeds the spotlight. */
export function useTilt(max = 5) {
  const { settings } = useSettings();
  const reduce = useReducedMotion();
  const on = settings.tilt && !reduce;
  const rx = useSpring(0, { stiffness: 220, damping: 18 });
  const ry = useSpring(0, { stiffness: 220, damping: 18 });
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    spotlight(e);
    if (!on || e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    ry.set(((e.clientX - r.left) / r.width - 0.5) * 2 * max);
    rx.set(-((e.clientY - r.top) / r.height - 0.5) * 2 * max);
  };
  const onPointerLeave = () => {
    rx.set(0);
    ry.set(0);
  };
  return { bind: { onPointerMove, onPointerLeave }, style: { rotateX: rx, rotateY: ry, transformPerspective: 900 } };
}

/** On/off switch with a springy knob. */
export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border px-0.5 ${on ? "justify-end border-accent bg-accent shadow-[0_0_14px_-4px_var(--accent)]" : "justify-start border-line-strong bg-panel-3"}`}
    >
      <motion.span layout transition={{ type: "spring", stiffness: 600, damping: 32 }} className="h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.35)]" />
    </button>
  );
}

const TONES = {
  neutral: "bg-panel-2 text-muted border-line",
  accent: "bg-accent-soft text-accent border-transparent",
  loss: "bg-loss-soft text-loss border-transparent",
  win: "bg-win-soft text-win border-transparent",
  warn: "bg-warn-soft text-warn border-transparent",
  info: "bg-info-soft text-info border-transparent",
};
export function Badge({ tone = "neutral", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11.5px] font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong px-6 py-12 text-center">
      <div className="font-display text-lg font-semibold">{title}</div>
      {children && <div className="mt-1 max-w-md text-muted">{children}</div>}
    </div>
  );
}

export function Loading() {
  return (
    <div className="mx-auto grid max-w-[1400px] grid-cols-12 gap-4 px-8 pt-24">
      {[3, 3, 3, 3, 8, 4].map((s, i) => (
        <div key={i} className={`${SPAN[s]} skeleton h-28 rounded-[14px]`} />
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-panel-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`relative rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors ${value === o.value ? "text-ink" : "text-muted hover:text-ink"}`}
        >
          {value === o.value && (
            <motion.span layoutId={`seg-${options.map((x) => x.value).join()}`} className="absolute inset-0 rounded-md bg-panel shadow-[var(--shadow-2)] ring-1 ring-line" transition={{ type: "spring", bounce: 0.15, duration: 0.4 }} />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Bar({ value, max, tone = "accent" }: { value: number; max: number; tone?: "accent" | "win" | "warn" | "info" }) {
  const c = { accent: "bg-accent", win: "bg-win", warn: "bg-warn", info: "bg-info" }[tone];
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel-2">
      <motion.div
        className={`h-full origin-left rounded-full ${c}`}
        style={{ width: `${max ? (value / max) * 100 : 0}%` }}
        initial={{ scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.7, ease: EASE_EMPH }}
      />
    </div>
  );
}

export function KV({ k, v, mono = false }: { k: ReactNode; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-dashed border-line py-2 last:border-0">
      <span className="text-muted">{k}</span>
      <span className={`text-right ${mono ? "num" : "font-medium"}`}>{v}</span>
    </div>
  );
}
