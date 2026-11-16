import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { api } from "./api";
import { applyTheme, resolveTheme, themeById, transitionTheme } from "./themes";

export type DateFmt = "dd-MMM-yyyy" | "dd MMM yyyy" | "yyyy-MM-dd" | "dd/MM/yyyy" | "MM/dd/yyyy" | "MMM d, yyyy";

export interface Settings {
  tz: string;
  dateFmt: DateFmt;
  hour12: boolean;
  /** A theme id from lib/themes.ts, or "system" (follows the OS between darkTheme and lightTheme). */
  theme: string;
  /** The dark and light themes last chosen: used by "system" and the quick dark/light toggle. */
  darkTheme: string;
  lightTheme: string;
  /** Soft glow that follows the mouse over cards. */
  spotlight: boolean;
  /** Rotating neon edge on cards. */
  neon: "off" | "hover" | "always";
  /** Slowly drifting background glows. */
  ambient: boolean;
  /** Cards tilt in 3D toward the pointer. */
  tilt: boolean;
  /** "system" follows the OS reduce-motion setting; "reduced" turns movement off in the app regardless. */
  motion: "system" | "reduced";
  /** Optional "show amounts also in…" currency, e.g. "INR". */
  homeCurrency: string;
  /** How many home-currency units one unit of each source currency is worth, e.g. { PHP: 1.48 }. */
  rates: Record<string, number>;
  /** Display currencies (first = primary, used for totals). Replaces homeCurrency/rates when set. */
  homeCurrencies?: string[];
  /** fx[target][source] = how many target units one source unit is worth. */
  fx?: Record<string, Record<string, number>>;
  /** Download exchange rates (past and today's) instead of typing them. Opt-in: it's the app's only internet use. */
  autoRates?: boolean;
}

export const DEFAULTS: Settings = { tz: "Asia/Kolkata", dateFmt: "dd-MMM-yyyy", hour12: true, theme: "vault", darkTheme: "vault", lightTheme: "paper", spotlight: true, neon: "hover", ambient: true, tilt: true, motion: "system", homeCurrency: "", rates: {} };

export const COMMON_TZ: { tz: string; label: string }[] = [
  { tz: "Asia/Kolkata", label: "IST · India" },
  { tz: "UTC", label: "UTC" },
  { tz: "America/Los_Angeles", label: "PST/PDT · US Pacific" },
  { tz: "America/Denver", label: "MST/MDT · US Mountain" },
  { tz: "America/Chicago", label: "CST/CDT · US Central" },
  { tz: "America/New_York", label: "EST/EDT · US Eastern" },
  { tz: "America/Sao_Paulo", label: "BRT · Brazil" },
  { tz: "Europe/London", label: "GMT/BST · UK" },
  { tz: "Europe/Berlin", label: "CET/CEST · Central Europe" },
  { tz: "Europe/Istanbul", label: "TRT · Türkiye" },
  { tz: "Asia/Dubai", label: "GST · Gulf" },
  { tz: "Asia/Karachi", label: "PKT · Pakistan" },
  { tz: "Asia/Dhaka", label: "BST · Bangladesh" },
  { tz: "Asia/Bangkok", label: "ICT · Thailand / Vietnam" },
  { tz: "Asia/Singapore", label: "SGT · Singapore / Malaysia" },
  { tz: "Asia/Manila", label: "PHT · Philippines" },
  { tz: "Asia/Tokyo", label: "JST · Japan" },
  { tz: "Asia/Seoul", label: "KST · Korea" },
  { tz: "Australia/Sydney", label: "AEST/AEDT · Australia East" },
  { tz: "Pacific/Auckland", label: "NZST/NZDT · New Zealand" },
];

export const ALL_TZ: string[] = (() => {
  try {
    return (Intl as any).supportedValuesOf("timeZone") as string[];
  } catch {
    return COMMON_TZ.map((t) => t.tz);
  }
})();

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export interface LocalParts {
  y: number;
  m: number; // 1-12
  d: number;
  h: number;
  mi: number;
  s: number;
  wd: number; // 0=Mon … 6=Sun
}
const WD: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const partsCache = new Map<string, LocalParts>();

export function localParts(iso: string, tz: string): LocalParts {
  const k = tz + iso;
  const hit = partsCache.get(k);
  if (hit) return hit;
  const o: any = {};
  for (const p of partsFormatter(tz).formatToParts(new Date(iso))) o[p.type] = p.value;
  const r = { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second, wd: WD[o.weekday] ?? 0 };
  if (partsCache.size > 200000) partsCache.clear();
  partsCache.set(k, r);
  return r;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function tzAbbr(tz: string, at = new Date()): string {
  try {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(at);
    const n = p.find((x) => x.type === "timeZoneName")?.value ?? tz;
    if (tz === "Asia/Kolkata") return "IST";
    if (tz === "Asia/Manila") return "PHT";
    if (tz === "Asia/Singapore") return "SGT";
    if (tz === "Asia/Dubai") return "GST";
    return n;
  } catch {
    return tz;
  }
}

export function makeFormatters(s: Settings) {
  const date = (iso?: string | null) => {
    if (!iso) return "—";
    const p = localParts(iso, s.tz);
    const M = MONTHS[p.m - 1];
    switch (s.dateFmt) {
      case "dd MMM yyyy":
        return `${pad(p.d)} ${M} ${p.y}`;
      case "yyyy-MM-dd":
        return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
      case "dd/MM/yyyy":
        return `${pad(p.d)}/${pad(p.m)}/${p.y}`;
      case "MM/dd/yyyy":
        return `${pad(p.m)}/${pad(p.d)}/${p.y}`;
      case "MMM d, yyyy":
        return `${M} ${p.d}, ${p.y}`;
      default:
        return `${pad(p.d)}-${M}-${p.y}`;
    }
  };
  const time = (iso?: string | null, secs = false) => {
    if (!iso) return "";
    const p = localParts(iso, s.tz);
    const tail = secs ? `:${pad(p.s)}` : "";
    if (!s.hour12) return `${pad(p.h)}:${pad(p.mi)}${tail}`;
    const h = p.h % 12 || 12;
    return `${h}:${pad(p.mi)}${tail} ${p.h < 12 ? "AM" : "PM"}`;
  };
  const dateTime = (iso?: string | null, secs = false) => (iso ? `${date(iso)} ${time(iso, secs)}` : "—");
  const monthKey = (iso: string) => {
    const p = localParts(iso, s.tz);
    return `${p.y}-${pad(p.m)}`;
  };
  const dayKey = (iso: string) => {
    const p = localParts(iso, s.tz);
    return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  };
  const monthLabel = (key: string) => {
    const [y, m] = key.split("-");
    return `${MONTHS[+m - 1]} ${y.slice(2)}`;
  };
  const relative = (iso?: string | null) => {
    if (!iso) return "—";
    const d = (Date.now() - new Date(iso).getTime()) / 864e5;
    if (d < 1) return "today";
    if (d < 2) return "yesterday";
    if (d < 45) return `${Math.round(d)} days ago`;
    if (d < 540) return `${Math.round(d / 30.4)} months ago`;
    return `${(d / 365).toFixed(1)} years ago`;
  };
  /** Label for a calendar day key (yyyy-mm-dd) — no timezone shift. */
  const dayLabel = (key: string) => (s.tz === "UTC" ? date(`${key}T00:00:00Z`) : makeFormatters({ ...s, tz: "UTC" }).date(`${key}T00:00:00Z`));
  return { date, time, dateTime, monthKey, dayKey, monthLabel, dayLabel, relative, tzLabel: tzAbbr(s.tz) };
}

export type Fmt = ReturnType<typeof makeFormatters>;

interface Ctx {
  settings: Settings;
  update: (p: Partial<Settings>) => void;
  /** Switch theme (an id or "system") with the animated dissolve (lib/themes.ts). */
  setTheme: (theme: string) => void;
  f: Fmt;
}
const SettingsCtx = createContext<Ctx | null>(null);

function validTz(tz: unknown) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: String(tz) });
    return true;
  } catch {
    return false;
  }
}

/**
 * A theme handed over by the home page: its links into the app carry `?theme=<id>` once the visitor has
 * picked one there. Read once and removed from the address, so it isn't bookmarked or shared.
 */
function takeThemeHandoff(): string | null {
  const url = new URL(window.location.href);
  const id = url.searchParams.get("theme");
  if (id === null) return null;
  url.searchParams.delete("theme");
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  return themeById(id) ? id : null;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [handoff] = useState(takeThemeHandoff);

  useEffect(() => {
    api
      .settings()
      .then((s) => {
        if (s.tz && !validTz(s.tz)) delete s.tz; // an unknown zone would make every date formatter throw
        // The home page's theme is only a starting point: a theme chosen in the app always wins.
        const t = handoff && !("theme" in s) ? themeById(handoff) : undefined;
        if (t) {
          const p: Partial<Settings> = { theme: t.id, ...(t.mode === "dark" ? { darkTheme: t.id } : { lightTheme: t.id }) };
          Object.assign(s, p);
          api.saveSettings(p).catch(() => {});
        }
        setSettings((cur) => ({ ...cur, ...s }));
      })
      .catch(() => {});
  }, [handoff]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyTheme(resolveTheme(settings.theme, settings, mq.matches));
    apply();
    const follow = () => transitionTheme(apply);
    mq.addEventListener("change", follow);
    return () => mq.removeEventListener("change", follow);
  }, [settings.theme, settings.darkTheme, settings.lightTheme]);

  const update = useCallback((p: Partial<Settings>) => {
    setSettings((cur) => ({ ...cur, ...p }));
    api.saveSettings(p).catch(() => {});
  }, []);

  // Effects are switched in CSS through attributes on <html>.
  useEffect(() => {
    const d = document.documentElement.dataset;
    d.spotlight = settings.spotlight ? "on" : "off";
    d.neon = settings.neon;
    d.motion = settings.motion;
  }, [settings.spotlight, settings.neon, settings.motion]);

  const setTheme = useCallback(
    (theme: string) => {
      const t = themeById(theme);
      const p: Partial<Settings> = { theme, ...(t ? (t.mode === "dark" ? { darkTheme: t.id } : { lightTheme: t.id }) : {}) };
      const next = { ...settings, ...p };
      // Every change of the switch (colours and React state, like the selected swatch) happens inside
      // the transition, after the browser has photographed the old theme, so the dissolve shows exactly it.
      transitionTheme(() => {
        flushSync(() => setSettings((cur) => ({ ...cur, ...p })));
        applyTheme(resolveTheme(theme, next, window.matchMedia("(prefers-color-scheme: dark)").matches));
      });
      api.saveSettings(p).catch(() => {});
    },
    [settings],
  );

  const f = useMemo(() => makeFormatters(settings), [settings]);
  return <SettingsCtx.Provider value={{ settings, update, setTheme, f }}>{children}</SettingsCtx.Provider>;
}

export function useSettings() {
  const c = useContext(SettingsCtx);
  if (!c) throw new Error("SettingsProvider missing");
  return c;
}
