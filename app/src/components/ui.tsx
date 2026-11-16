import { animate, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { ArrowUpRight, Check } from "lucide-react";
import { Children, useEffect, useRef, type PointerEvent, type ReactNode } from "react";
import { useSettings } from "../lib/settings";
import { EASE_EMPH, StaggerIndex, lastShown, revealVariants, spotlight, useReveal } from "../lib/motion";
import { useAccount } from "../lib/account";
import { SOFT, SOFT_CSS, useSettle } from "./anim";

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
  // Changing the period or the account settles the page's content (a soft dip and return), so it's clear
  // everything below now shows something else.
  const { range, accountId } = useAccount();
  const grid = useSettle<HTMLDivElement>(`${JSON.stringify(range)}|${accountId}`);
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
      <div ref={grid} className="grid grid-cols-12 gap-4">
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
  to,
  id,
  quick = false,
  fill = false,
}: {
  /** Stretch the card's body to the card's full height (e.g. a chart that should match its row). */
  fill?: boolean;
  /** Anchor for "jump here" clicks (see lib/focus.ts). */
  id?: string;
  /** A quick opacity-only entrance instead of the blur reveal: for very tall cards that appear on a click
   * (blurring a big layer is slow and made them feel late). */
  quick?: boolean;
  span?: number;
  title?: ReactNode;
  hint?: ReactNode;
  right?: ReactNode;
  /** A page (hash route) this card has more of: adds an "Open →" link to the header. */
  to?: string;
  children: ReactNode;
  className?: string;
  pad?: boolean;
  accent?: boolean;
}) {
  const reveal = useReveal();
  const side = right ?? (to ? <OpenLink to={to} /> : null);
  return (
    <motion.section {...(quick ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.22, ease: "easeOut" } } : reveal)} id={id} onPointerMove={spotlight} className={`panel spot scroll-mt-[72px] ${fill ? "flex flex-col" : ""} ${accent ? "corner" : ""} ${SPAN[span] ?? SPAN[12]} min-w-0 ${className}`}>
      {(title || side) && (
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="font-display text-[15px] font-semibold uppercase tracking-[0.06em]">{title}</h2>
            {hint && <p className="mt-0.5 text-[12.5px] text-muted">{hint}</p>}
          </div>
          {side}
        </div>
      )}
      <div className={`${pad ? "p-5" : ""} ${fill ? "min-h-0 flex-1" : ""}`}>{children}</div>
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
  to,
  onClick,
  action,
}: {
  label: string;
  /** A page (hash route) the whole card opens. */
  to?: string;
  /** Makes the card a button (e.g. jump to and filter a section, or open a drawer). */
  onClick?: () => void;
  /** Tooltip for `onClick`, e.g. "Show every battle pass". */
  action?: string;
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
  // A card that opens a page is a real link: keyboard, middle-click and "open in new tab" all work.
  // A card with `onClick` acts as a button (it may hold links or chips, so it can't be a real <button>).
  const Box = (to ? motion.a : motion.div) as typeof motion.a;
  const clickable = !!to || !!onClick;
  return (
    <Box
      {...reveal}
      {...tilt.bind}
      style={tilt.style}
      whileHover={{ y: -3 }}
      href={to ? `#${to}` : undefined}
      title={to ? `Open ${pageName(to)}` : action}
      {...(onClick && {
        role: "button",
        tabIndex: 0,
        onClick: (e: React.MouseEvent) => {
          if ((e.target as HTMLElement).closest("a, button")) return; // a link or chip inside the card
          onClick();
        },
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
          e.preventDefault();
          onClick();
        },
      })}
      className={`panel spot group/stat relative ${SPAN[span] ?? SPAN[3]} block min-w-0 px-5 py-4 hover:shadow-[var(--shadow-2)] ${clickable ? "cursor-pointer" : ""}`}
    >
      {clickable && (
        <ArrowUpRight
          size={16}
          aria-hidden
          className="absolute right-4 top-4 text-faint opacity-0 transition-[opacity,transform] duration-200 group-hover/stat:translate-x-0.5 group-hover/stat:-translate-y-0.5 group-hover/stat:text-accent group-hover/stat:opacity-100 group-focus-visible/stat:opacity-100"
        />
      )}
      <div className="pr-6 text-[12px] font-medium uppercase tracking-[0.12em] text-muted">{label}</div>
      {/* truncate clips at the line box; the padding (cancelled by the margin) keeps descenders like g and y. */}
      <div className={`num -mb-1 mt-1.5 truncate pb-1 text-[28px] font-medium leading-none ${color}`}>
        {typeof value === "number" ? <CountUp value={value} format={format} id={`stat:${label}`} /> : value}
      </div>
      {extra && <div className="mt-2.5">{extra}</div>}
      {sub && <div className="mt-2 truncate text-[12.5px] text-muted">{sub}</div>}
    </Box>
  );
}

/** "matches" → "Matches", "import" → "Import" (for link titles). */
const pageName = (to: string) => to.charAt(0).toUpperCase() + to.slice(1);

/** The "Open →" link in a card header that leads to the page with more on the topic. */
export function OpenLink({ to, label = "Open" }: { to: string; label?: string }) {
  return (
    <a href={`#${to}`} title={`Open ${pageName(to)}`} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[12.5px] text-accent hover:underline">
      {label} <ArrowUpRight size={13} />
    </a>
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
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: SOFT.in, ease: SOFT.ease }}
      className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong px-6 py-12 text-center"
    >
      <div className="font-display text-lg font-semibold">{title}</div>
      {children && <div className="mt-1 max-w-md text-muted">{children}</div>}
    </motion.div>
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

/** A toggle pill for filter rows (on: accent with a tick). */
export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`flex items-center rounded-full border px-2.5 py-0.5 text-[12.5px] transition-colors ${SOFT_CSS} ${on ? "border-accent bg-accent-soft font-medium text-accent" : "border-line text-muted hover:border-line-strong hover:text-ink"}`}
    >
      <span className={`grid transition-[grid-template-columns,opacity] ${SOFT_CSS} ${on ? "grid-cols-[1fr] opacity-100" : "grid-cols-[0fr] opacity-0"}`}>
        <span className="overflow-hidden pr-1">
          <Check size={12} />
        </span>
      </span>
      {children}
    </button>
  );
}
