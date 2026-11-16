/**
 * Privacy mode: hides what identifies the account (IP addresses, the sign-in username, the creation date) on
 * every page, for screenshots, screen shares and streams. Always on when the app opens; a reveal lasts only
 * until the next reload, import, backup restore or account switch. Masking replaces the text itself, so nothing can be recovered
 * from a screenshot. CSV exports keep the real values (exporting is deliberate).
 */
import { Eye, EyeOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

const KEY = "riotvault.privacy";
const DOT = "•";

export const maskIp = (ip: string | null | undefined) => {
  if (!ip) return "";
  if (ip === "Unknown") return ip;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip.split(".").slice(0, 2).join(".") + `.${DOT.repeat(3)}.${DOT.repeat(3)}`;
  if (ip.includes(":")) return ip.split(":").slice(0, 2).join(":") + `:${DOT.repeat(4)}:${DOT.repeat(4)}`;
  return DOT.repeat(6);
};

/** Fully hidden, always the same length (so not even the length leaks). For the sign-in username and other
 * values that must not show at all. The Riot ID (name#tag) is public, so it is never masked. */
export const HIDDEN = DOT.repeat(8);
export const maskName = (s: string | null | undefined) => (s ? HIDDEN : "");

const Ctx = createContext<{ hidden: boolean; setHidden: (v: boolean) => void }>({ hidden: true, setHidden: () => {} });

export function PrivacyProvider({ children }: { children: ReactNode }) {
  // Always starts hidden: a reveal is never remembered, so a reload (or a new tab) is safe to share.
  // Importing, restoring a backup and switching accounts hide it again too (see `useHideOn`).
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try {
      localStorage.removeItem(KEY); // from when a reveal used to be remembered
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    document.documentElement.dataset.privacy = hidden ? "on" : "off";
  }, [hidden]);
  const value = useMemo(() => ({ hidden, setHidden }), [hidden, setHidden]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Masking helpers that follow privacy mode. */
export function usePrivacy() {
  const { hidden, setHidden } = useContext(Ctx);
  return useMemo(
    () => ({
      hidden,
      setHidden,
      toggle: () => setHidden(!hidden),
      ip: (v: string | null | undefined) => (hidden ? maskIp(v) : (v ?? "")),
      /** IDs Riot support uses to confirm ownership (purchase / transaction IDs): first 4 characters only. */
      id: (v: string | null | undefined) => (hidden && v ? v.slice(0, 4) + DOT.repeat(6) : (v ?? "")),
      /** Fully hidden while privacy mode is on (e.g. the account creation IP or date). */
      secret: (v: string | null | undefined) => (hidden && v ? HIDDEN : (v ?? "")),
      name: (v: string | null | undefined) => (hidden ? maskName(v) : (v ?? "")),
    }),
    [hidden, setHidden],
  );
}

/** The eye button: "Hide / Show sensitive details". `compact` = icon only (top bar). */
export function PrivacyToggle({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const { hidden, toggle } = usePrivacy();
  const label = hidden ? "Show sensitive details" : "Hide sensitive details";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={!hidden}
      aria-label={label}
      title={`${label} (IP addresses, username, account creation date)`}
      className={
        compact
          ? `flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${hidden ? "text-muted hover:bg-panel-2 hover:text-ink" : "bg-warn-soft text-warn"} ${className}`
          : `flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12.5px] font-medium transition-colors ${hidden ? "border-line text-muted hover:border-line-strong hover:text-ink" : "border-warn/40 bg-warn-soft text-warn"} ${className}`
      }
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={hidden ? "off" : "on"}
          className="flex"
          initial={{ opacity: 0, scale: 0.6, rotate: -30 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          exit={{ opacity: 0, scale: 0.6, rotate: 30, transition: { duration: 0.12 } }}
          transition={{ type: "spring", stiffness: 500, damping: 26 }}
        >
          {hidden ? <EyeOff size={compact ? 16 : 14} /> : <Eye size={compact ? 16 : 14} />}
        </motion.span>
      </AnimatePresence>
      {!compact && <Sens>{hidden ? "Show details" : "Hide details"}</Sens>}
    </button>
  );
}

/** For pages that are mostly sensitive (Ownership answers, Raw data): a notice instead of the content. */
export function PrivacyGate({ what, children }: { what: string; children: ReactNode }) {
  const { hidden, toggle } = usePrivacy();
  if (!hidden) return <>{children}</>;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
      className="col-span-12 flex flex-col items-center gap-3 rounded-xl border border-line bg-panel-2/50 px-6 py-14 text-center"
    >
      <EyeOff size={26} className="text-muted" />
      <div className="font-medium">{what} are hidden while privacy mode is on</div>
      <p className="max-w-md text-[13px] text-muted">They include IP addresses, usernames and other details that identify your account. Show them when nobody else can see your screen.</p>
      <button type="button" onClick={toggle} className="mt-1 flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium hover:border-line-strong">
        <Eye size={14} /> Show sensitive details
      </button>
    </motion.div>
  );
}

/** Turns privacy mode back on whenever `key` changes (after the first render), e.g. the current account. */
export function useHideOn(key: unknown) {
  const { setHidden } = useContext(Ctx);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setHidden(true);
  }, [key, setHidden]);
}

/**
 * A sensitive value that dissolves between its masked and revealed forms (a soft blur + fade) instead of
 * snapping. Wrap the text of every masked value with it.
 */
export function Sens({ children, className = "" }: { children: string; className?: string }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={children}
        className={className}
        initial={{ opacity: 0, filter: "blur(6px)" }}
        animate={{ opacity: 1, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
        exit={{ opacity: 0, filter: "blur(6px)", transition: { duration: 0.28, ease: [0.4, 0, 1, 1] } }}
        transition={{ duration: 0.55, ease: [0, 0, 0.2, 1] }}
      >
        {children}
      </motion.span>
    </AnimatePresence>
  );
}
