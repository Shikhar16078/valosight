import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SOFT, SOFT_CSS } from "./anim";
import { useModal } from "./dialog";

/**
 * A floating glass panel that slides in from the right (lists: your skins, battle passes, voice transcripts).
 * Esc, ✕ or a click on the dimmed page close it. On phones it fills the screen.
 */
export function Drawer({ open, onClose, title, hint, children }: { open: boolean; onClose: () => void; title: ReactNode; hint?: ReactNode; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  useModal(open, panel, { onClose });

  // The header gets a soft shadow once the content scrolls under it.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    if (open) setScrolled(false);
  }, [open]);

  const glow = "var(--accent)";
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div
            className="absolute inset-0 bg-[color-mix(in_oklab,var(--bg)_55%,transparent)] backdrop-blur-[6px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: SOFT.out } }}
            transition={{ duration: SOFT.in, ease: SOFT.ease }}
            onClick={onClose}
          />
          <motion.aside
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === "string" ? title : undefined}
            className="absolute inset-y-3 right-3 flex w-[min(500px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-line-strong bg-[color-mix(in_oklab,var(--panel)_88%,transparent)] shadow-[var(--shadow-3)] backdrop-blur-xl max-sm:inset-0 max-sm:w-full max-sm:rounded-none max-sm:border-0"
            initial={{ x: 48, opacity: 0, scale: 0.985 }}
            animate={{ x: 0, opacity: 1, scale: 1 }}
            exit={{ x: 48, opacity: 0, scale: 0.985, transition: { duration: SOFT.out, ease: SOFT.ease } }}
            transition={{ duration: SOFT.in, ease: SOFT.ease }}
          >
            {/* Corner light, like highlighted cards (.corner): warm from the top-left, cooler at the bottom-right. */}
            <div
              aria-hidden
              className={`pointer-events-none absolute inset-0 transition-[background] ${SOFT_CSS}`}
              style={{
                background: `radial-gradient(520px 260px at 0% 0%, color-mix(in oklab, ${glow} 16%, transparent), transparent 70%), radial-gradient(420px 220px at 100% 100%, color-mix(in oklab, var(--violet) 10%, transparent), transparent 70%)`,
              }}
            />
            <header className={`relative z-10 flex items-start justify-between gap-4 px-6 pb-4 pt-5 transition-shadow ${SOFT_CSS} ${scrolled ? "shadow-[0_10px_24px_-18px_rgba(0,0,0,0.7)]" : ""}`}>
              <div className="min-w-0">
                <h2 className="font-display text-[18px] font-semibold leading-tight tracking-[0.02em]">{title}</h2>
                {hint && <p className="mt-1 text-[12.5px] leading-snug text-muted">{hint}</p>}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                autoFocus
                className={`group grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line bg-panel-2/70 text-muted transition-colors ${SOFT_CSS} hover:border-line-strong hover:text-ink`}
              >
                <X size={16} className={`transition-transform ${SOFT_CSS} group-hover:rotate-90`} />
              </button>
            </header>
            <div className="scroll-thin relative z-10 min-h-0 flex-1 overflow-y-auto" onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}>
              {children}
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
