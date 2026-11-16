/**
 * "Go there and show me": clicking a card scrolls to the section it's about and filters it.
 *
 * Within a page, a view sets its own filter state and calls `scrollToSection(id)`.
 * Across pages, `goTo(page, intent)` stores the request and changes the hash; the target view reads it with
 * `useIntent(page, apply)` once its data has loaded, applies the filter, and scrolls.
 */
import { useEffect, useRef } from "react";

export interface Intent {
  /** id of the section (a Card's `id`) to scroll to */
  section?: string;
  /** what to filter it by; each view decides what the keys mean */
  filter?: string;
  value?: string;
}

const EVENT = "valosight:intent";
let pending: { page: string; intent: Intent; at: number } | null = null;
// A request is for the click that made it: drop it if its page doesn't take it soon, or the person goes
// elsewhere first, so it can't fire much later when that page is opened from the top bar.
const FRESH_MS = 30_000;
addEventListener("hashchange", () => {
  if (pending && window.location.hash.slice(1).split(":")[0] !== pending.page) pending = null;
});

export function goTo(page: string, intent: Intent) {
  pending = { page, intent, at: Date.now() };
  if (window.location.hash.slice(1) === page) window.dispatchEvent(new Event(EVENT));
  else window.location.hash = page;
}

/** Runs `apply` with a pending request for this page (on arrival, or when already on it). Waits for `ready`. */
export function useIntent(page: string, ready: boolean, apply: (i: Intent) => void) {
  const fn = useRef(apply);
  fn.current = apply;
  useEffect(() => {
    if (!ready) return;
    const take = () => {
      if (pending && Date.now() - pending.at > FRESH_MS) pending = null;
      if (pending?.page !== page) return;
      const { intent } = pending;
      pending = null;
      fn.current(intent);
      if (intent.section) scrollToSection(intent.section);
    };
    take();
    window.addEventListener(EVENT, take);
    return () => window.removeEventListener(EVENT, take);
  }, [page, ready]);
}

/**
 * Smoothly scrolls a section into view (instantly under reduced motion), once it exists.
 * `flash`: briefly ring the section, so it's obvious where you landed (e.g. a short table at the page bottom,
 * which can't scroll to the top of the screen). `delay`: wait for a view switch to settle first.
 */
export function scrollToSection(id: string, { flash = false, delay = 0 }: { flash?: boolean; delay?: number } = {}) {
  if (delay) {
    setTimeout(() => scrollToSection(id, { flash }), delay);
    return;
  }
  const reduced = document.documentElement.dataset.motion === "reduced" || (document.documentElement.dataset.motion !== "full" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  let tries = 0;
  const go = () => {
    const el = document.getElementById(id);
    if (!el) {
      if (tries++ < 40) setTimeout(go, 50);
      return;
    }
    // Two frames: let a filter that was just applied render first, so we land on the final layout.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        // A section shorter than the screen is centred; a taller one starts at the top.
        el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: el.offsetHeight < innerHeight * 0.7 ? "center" : "start" });
        if (flash && !reduced)
          el.animate(
            [{ boxShadow: "0 0 0 2px var(--accent), 0 0 32px -6px var(--accent)" }, { boxShadow: "0 0 0 2px transparent, 0 0 32px -6px transparent" }],
            { duration: 1800, delay: 350, easing: "cubic-bezier(0.4,0,0.2,1)" },
          );
      }),
    );
  };
  go();
}
