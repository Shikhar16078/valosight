import { createContext, useContext, useEffect, useRef, useState, type PointerEvent } from "react";

/** Motion tokens (keep in step with --ease-* in index.css). */
export const EASE_EMPH = [0.16, 1, 0.3, 1] as const;

/** Position of a card within its page, so cards above the fold enter one after another. */
export const StaggerIndex = createContext(0);
const STAGGER = 0.04;
const MAX_DELAY = 0.24;

export const revealVariants = {
  hidden: { opacity: 0, y: 14, scale: 0.985, filter: "blur(4px)" },
  show: (i: number = 0) => ({ opacity: 1, y: 0, scale: 1, filter: "blur(0px)", transitionEnd: { filter: "none" }, transition: { duration: 0.5, ease: EASE_EMPH, delay: Math.min(i * STAGGER, MAX_DELAY) } }),
};

/** Props for a motion element that fades up the first time it scrolls into view. */
export function useReveal() {
  const i = useContext(StaggerIndex);
  return { variants: revealVariants, custom: i, initial: "hidden", whileInView: "show", viewport: { once: true, amount: 0.08 } } as const;
}

/** Soft spotlight that follows the pointer across a `.spot` card (CSS draws it from --mx/--my). */
export function spotlight(e: PointerEvent<HTMLElement>) {
  if (e.pointerType !== "mouse") return;
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty("--mx", `${e.clientX - r.left}px`);
  el.style.setProperty("--my", `${e.clientY - r.top}px`);
}

/** True once the element has been on screen; charts mount then so their draw-in animation is seen. */
export function useInView<T extends Element>(margin = "0px 0px -10% 0px") {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, margin]);
  return [ref, seen] as const;
}

/** Last value each counter showed, so returning to a page doesn't re-count from zero. */
export const lastShown = new Map<string, number>();
