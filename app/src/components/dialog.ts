import { useEffect, useRef, type RefObject } from "react";

/**
 * Keyboard and focus for a modal panel (Drawer, InspectWindow): Esc closes, ← / → step (when given), Tab stays
 * inside the panel, the page behind can't scroll, and focus goes back to what opened it on close. Keys are left
 * alone while typing in a field or with a modifier held (Alt+← is the browser's Back), and a held key doesn't
 * auto-repeat through a list. Callbacks are read through a ref, so inline functions don't re-run the effect.
 */
export function useModal(open: boolean, panel: RefObject<HTMLElement | null>, keys: { onClose: () => void; onPrev?: () => void; onNext?: () => void }) {
  const k = useRef(keys);
  k.current = keys;
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return;
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (e.key === "Escape") k.current.onClose();
      else if (e.key === "Tab") {
        const el = panel.current;
        if (!el) return;
        const items = [...el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (!el.contains(document.activeElement) || (e.shiftKey && document.activeElement === first)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      } else if (!typing && !e.repeat && e.key === "ArrowLeft" && k.current.onPrev) k.current.onPrev();
      else if (!typing && !e.repeat && e.key === "ArrowRight" && k.current.onNext) k.current.onNext();
    };
    window.addEventListener("keydown", key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
      // Back to what opened it, only if focus would otherwise be lost (not when another window took it over),
      // and only if that element is still there.
      const now = document.activeElement;
      const lost = !now || now === document.body || !!panel.current?.contains(now);
      if (lost && opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [open, panel]);
}
