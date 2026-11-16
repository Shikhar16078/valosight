import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, type ReactNode, useRef } from "react";
import { createPortal } from "react-dom";

/** A panel that slides in from the right with a list (e.g. every battle pass). Esc, ✕ or the backdrop close it. */
export function Drawer({ open, onClose, title, hint, children }: { open: boolean; onClose: () => void; title: ReactNode; hint?: ReactNode; children: ReactNode }) {
  // Read through a ref: callers pass inline functions, which must not re-run the effect (and re-lock scrolling).
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    window.addEventListener("keydown", key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} onClick={onClose} />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === "string" ? title : undefined}
            className="pop absolute inset-y-0 right-0 flex w-[min(460px,100vw)] flex-col rounded-none border-y-0 border-r-0"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.45, ease: [0.4, 0, 0.2, 1] }}
          >
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h2 className="font-display text-[16px] font-semibold uppercase tracking-[0.06em]">{title}</h2>
                {hint && <p className="mt-0.5 text-[12.5px] text-muted">{hint}</p>}
              </div>
              <button type="button" onClick={onClose} aria-label="Close" autoFocus className="rounded-md p-1 text-muted hover:bg-panel-2 hover:text-ink">
                <X size={18} />
              </button>
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">{children}</div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
