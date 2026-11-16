/**
 * The app's shared, light transitions. Every show/hide, swap and resize uses these so motion feels the same
 * everywhere: slow and soft (about half a second in, a quarter out), opacity + small transforms only, never a
 * blur on anything big. CSS transitions and MotionConfig already respect reduced motion.
 */
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export const SOFT = { in: 0.5, out: 0.28, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] };
/** Tailwind classes for the same timing in CSS transitions. */
export const SOFT_CSS = "duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]";

/** Opens and closes its content by height (CSS grid 0fr ⇄ 1fr) with a fade. Content stays mounted. */
export function Collapse({ open, children, className = "" }: { open: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={`grid transition-[grid-template-rows] ${SOFT_CSS} ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"} ${className}`}>
      <div className="min-h-0 overflow-hidden" inert={!open}>
        <div className={`transition-[opacity,transform] ${SOFT_CSS} ${open ? "translate-y-0 opacity-100" : "-translate-y-1.5 opacity-0"}`}>{children}</div>
      </div>
    </div>
  );
}

/** Cross-fades between versions of its content: change `k` and the old fades out, the new settles in. */
export function Swap({ k, children, className, appear = false }: { k: string | number; children: ReactNode; className?: string; /** also fade in on first mount */ appear?: boolean }) {
  return (
    <AnimatePresence mode="wait" initial={appear}>
      <motion.div
        key={k}
        className={className}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4, transition: { duration: SOFT.out, ease: SOFT.ease } }}
        transition={{ duration: SOFT.in, ease: SOFT.ease }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/** A small thing (chip, button, badge) that scales and fades in and out with `show`. */
export function Pop({ show, children, className }: { show: boolean; children: ReactNode; className?: string }) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.span
          className={className ?? "inline-flex"}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9, transition: { duration: SOFT.out, ease: SOFT.ease } }}
          transition={{ duration: SOFT.in * 0.7, ease: SOFT.ease }}
        >
          {children}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/** Animates its own height to fit its content whenever the content resizes (rows added, list expanded…). */
export function AutoHeight({ children, className = "" }: { children: ReactNode; className?: string }) {
  const inner = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number | "auto">("auto");
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <motion.div className={`overflow-hidden ${className}`} initial={false} animate={{ height: h }} transition={{ duration: SOFT.in, ease: SOFT.ease }}>
      <div ref={inner}>{children}</div>
    </motion.div>
  );
}

/** Plays a gentle "settle" (dip and return) on an element whenever `key` changes after mount. */
export function useSettle<T extends HTMLElement>(key: unknown) {
  const ref = useRef<T>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const d = document.documentElement.dataset.motion;
    if (d === "reduced" || (d !== "full" && matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
    ref.current?.animate([{ opacity: 0.35, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], { duration: SOFT.in * 1000, easing: "cubic-bezier(0.4,0,0.2,1)" });
  }, [key]);
  return ref;
}

/** `value`, updated only after it has stopped changing for `ms` (e.g. a search box, so results settle once). */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Something that appears and disappears (a confirm box, an error): height + fade in and out. */
export function Reveal({ show, children, className }: { show: boolean; children: ReactNode; className?: string }) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          className={`overflow-hidden ${className ?? ""}`}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0, transition: { duration: SOFT.out, ease: SOFT.ease } }}
          transition={{ duration: SOFT.in, ease: SOFT.ease }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
