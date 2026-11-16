/**
 * The large centred "Inspect" window (one skin, one battle pass): a dimmed, blurred page behind a glass panel
 * washed with a colour. Esc closes; ← / → (or the header arrows) step through the list without closing.
 * On phones it fills the screen. Callers render `InspectHeader` + their body inside.
 */
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SOFT, SOFT_CSS, Swap } from "./anim";
import { useModal } from "./dialog";

export interface InspectNav {
  onClose: () => void;
  /** step to the previous / next item (undefined at the ends) */
  onPrev?: () => void;
  onNext?: () => void;
  /** "12 of 45" */
  position?: { i: number; n: number };
}

export function InspectWindow({ open, label, onClose, onPrev, onNext, fit = false, children }: InspectNav & { open: boolean; label: string; /** as tall as its content (up to the usual size) instead of always full size */ fit?: boolean; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useModal(open, panel, { onClose, onPrev, onNext });

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4 max-sm:p-0">
          <motion.div
            className="absolute inset-0 bg-[color-mix(in_oklab,var(--bg)_60%,transparent)] backdrop-blur-[8px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: SOFT.out } }}
            transition={{ duration: SOFT.in, ease: SOFT.ease }}
            onClick={onClose}
          />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            className={`relative flex ${fit ? "max-h-[min(760px,calc(100dvh-2rem))]" : "h-[min(760px,calc(100dvh-2rem))]"} w-[min(1120px,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-line-strong bg-[color-mix(in_oklab,var(--panel)_90%,transparent)] shadow-[var(--shadow-3)] backdrop-blur-xl max-sm:h-full max-sm:max-h-none max-sm:w-full max-sm:rounded-none max-sm:border-0`}
            initial={{ opacity: 0, scale: 0.96, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8, transition: { duration: SOFT.out, ease: SOFT.ease } }}
            transition={{ duration: SOFT.in, ease: SOFT.ease }}
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** The window's soft wash: `tint` from the top-left (a skin's edition colour, the accent…), violet at the far corner. */
export function InspectWash({ tint }: { tint: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 transition-[background] ${SOFT_CSS}`}
      style={{ background: `radial-gradient(700px 420px at 22% 38%, color-mix(in oklab, ${tint} 16%, transparent), transparent 70%), radial-gradient(520px 300px at 100% 100%, color-mix(in oklab, var(--violet) 9%, transparent), transparent 70%)` }}
    />
  );
}

/** Eyebrow + title (cross-fading as you step through), the "n of N" counter, ← → and close. */
export function InspectHeader({ eyebrow, title, onClose, onPrev, onNext, position }: InspectNav & { eyebrow: ReactNode; title: string }) {
  return (
    <header className="relative z-10 flex items-center justify-between gap-4 px-7 pb-2 pt-5 max-sm:px-5">
      <div className="min-w-0">
        <Swap k={title} appear>
          <div className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-muted">{eyebrow}</div>
          <h2 className="truncate font-display text-[26px] font-semibold leading-tight tracking-[0.01em]">{title}</h2>
        </Swap>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {position && (
          <span className="num mr-1 text-[12px] text-faint max-sm:hidden">
            {position.i + 1} of {position.n}
          </span>
        )}
        <NavButton label="Previous (←)" onClick={onPrev}>
          <ChevronLeft size={17} />
        </NavButton>
        <NavButton label="Next (→)" onClick={onNext}>
          <ChevronRight size={17} />
        </NavButton>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          autoFocus
          className={`group ml-1 grid h-9 w-9 place-items-center rounded-full border border-line bg-panel-2/70 text-muted transition-colors ${SOFT_CSS} hover:border-line-strong hover:text-ink`}
        >
          <X size={17} className={`transition-transform ${SOFT_CSS} group-hover:rotate-90`} />
        </button>
      </div>
    </header>
  );
}

function NavButton({ label, onClick, children }: { label: string; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-label={label}
      title={label}
      className={`grid h-9 w-9 place-items-center rounded-full border border-line bg-panel-2/70 text-muted transition-colors ${SOFT_CSS} hover:border-line-strong hover:text-ink disabled:opacity-35 disabled:hover:border-line disabled:hover:text-muted`}
    >
      {children}
    </button>
  );
}
