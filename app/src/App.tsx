import { AnimatePresence, MotionConfig, motion, useScroll, useSpring } from "motion/react";
import { PrivacyProvider, PrivacyToggle, Sens, useHideOn, usePrivacy } from "./lib/privacy";
import { APP_NAME, Logo, Wordmark } from "./components/Logo";
import { CalendarRange, Check, ChevronDown, Database, FlaskConical, Gavel, House, LayoutDashboard, LifeBuoy, Settings, Users, Shield, Sparkles, Swords, Upload, Wallet } from "lucide-react";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { AccountProvider, useAccount, type Range } from "./lib/account";
import { SettingsProvider, useSettings } from "./lib/settings";
import { homeUrl } from "./lib/home";
import { DS } from "./lib/valorant";
import { EASE_EMPH } from "./lib/motion";
import { Loading, PageSkeleton } from "./components/ui";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { lazyRetry } from "./lib/lazy-retry";
import { Ambient } from "./components/Ambient";
import { Footer } from "./components/Footer";
import { FxProvider } from "./lib/convert";
import { api } from "./lib/api";
import { clearPictureCache } from "./lib/pwa";
import { demoTarget, isDemoAccount, loadDemo } from "./lib/demo";

type ViewId = "overview" | "money" | "collection" | "matches" | "security" | "conduct" | "data" | "recovery" | "accounts" | "import" | "settings";

/** One shared request per chunk, whether prefetching or rendering asks first; a failed one (offline) is retried. */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () =>
    (p ??= load().catch((e) => {
      p = null;
      throw e;
    }));
}

// Each page is its own chunk, so the first screen only downloads the page it shows. The others are fetched in
// the background once the browser is idle (and on hover/focus of their top-bar icon), so switching stays instant.
const LOADERS = {
  overview: once(() => import("./views/Overview").then((m) => ({ default: m.Overview }))),
  money: once(() => import("./views/Money").then((m) => ({ default: m.Money }))),
  collection: once(() => import("./views/Collection").then((m) => ({ default: m.Collection }))),
  matches: once(() => import("./views/Matches").then((m) => ({ default: m.Matches }))),
  security: once(() => import("./views/Security").then((m) => ({ default: m.Security }))),
  conduct: once(() => import("./views/Conduct").then((m) => ({ default: m.Conduct }))),
  data: once(() => import("./views/DataBrowser").then((m) => ({ default: m.DataBrowser }))),
  import: once(() => import("./views/Imports").then((m) => ({ default: m.Imports }))),
  settings: once(() => import("./views/SettingsView").then((m) => ({ default: m.SettingsView }))),
  recovery: once(() => import("./views/Recovery").then((m) => ({ default: m.Recovery }))),
  accounts: once(() => import("./views/AllAccounts").then((m) => ({ default: m.AllAccounts }))),
};

const prefetchPage = (v: string) => {
  if (Object.hasOwn(LOADERS, v)) LOADERS[v as ViewId]().catch(() => {});
};

const Overview = lazyRetry(LOADERS.overview);
const Money = lazyRetry(LOADERS.money);
const Collection = lazyRetry(LOADERS.collection);
const Matches = lazyRetry(LOADERS.matches);
const Security = lazyRetry(LOADERS.security);
const Conduct = lazyRetry(LOADERS.conduct);
const DataBrowser = lazyRetry(LOADERS.data);
const Imports = lazyRetry(LOADERS.import);
const SettingsView = lazyRetry(LOADERS.settings);
const Recovery = lazyRetry(LOADERS.recovery);
const AllAccounts = lazyRetry(LOADERS.accounts);

// The page in the address is needed first: ask for it now, alongside the engine and the catalogue (main.tsx).
// (With no accounts yet the app shows Import instead; that chunk is small and follows right after.)
prefetchPage(window.location.hash.slice(1).split(":")[0] || "overview");

/** Load every other page's code once the first screen is up and the browser has nothing else to do. */
function usePrefetchPages(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const all = () => {
      for (const v of Object.keys(LOADERS) as ViewId[]) prefetchPage(v);
    };
    if ("requestIdleCallback" in window) {
      const id = requestIdleCallback(all, { timeout: 4000 });
      return () => cancelIdleCallback(id);
    }
    const t = setTimeout(all, 1500);
    return () => clearTimeout(t);
  }, [ready]);
}

/** Shown while a page's code downloads: the same frame and placeholders a page shows while its data loads. */
function PageFallback() {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pb-16 pt-6 sm:px-8" aria-busy>
      <div className="mb-6" aria-hidden>
        <div className="skeleton h-3 w-24" />
        <div className="skeleton mt-2 h-[30px] w-56" />
      </div>
      <div className="grid grid-cols-12 gap-4">
        <PageSkeleton />
      </div>
    </div>
  );
}
type Group = "Insights" | "Tools" | "Account recovery" | "App";
const NAV: { id: ViewId; label: string; icon: ReactNode; group: Group; needs?: string[] }[] = [
  { id: "overview", label: "Overview", icon: <LayoutDashboard size={17} />, group: "Insights" },
  { id: "money", label: "Money", icon: <Wallet size={17} />, group: "Insights", needs: [DS.payments] },
  { id: "collection", label: "Collection", icon: <Sparkles size={17} />, group: "Insights", needs: [DS.store] },
  { id: "matches", label: "Matches", icon: <Swords size={17} />, group: "Insights", needs: [DS.matches] },
  { id: "security", label: "Security", icon: <Shield size={17} />, group: "Insights", needs: [DS.logins, DS.audit] },
  { id: "conduct", label: "Conduct", icon: <Gavel size={17} />, group: "Insights", needs: [DS.penalties, DS.vReports, DS.lolReports, DS.tftReports] },
  { id: "data", label: "Raw data", icon: <Database size={17} />, group: "Tools" },
  { id: "accounts", label: "All accounts", icon: <Users size={17} />, group: "Tools" },
  { id: "recovery", label: "Ownership answers", icon: <LifeBuoy size={17} />, group: "Account recovery" },
  { id: "import", label: "Import data", icon: <Upload size={17} />, group: "App" },
  { id: "settings", label: "Settings", icon: <Settings size={17} />, group: "App" },
];
/** Pages where the period filter does nothing, so the top bar hides it. */
const NO_SCOPE: ViewId[] = ["import", "settings", "recovery", "accounts"];
const STALE_DAYS = 30;

function useHashView(): [ViewId, (v: ViewId) => void] {
  const read = () => (window.location.hash.slice(1) as ViewId) || "overview";
  const [v, setV] = useState<ViewId>(read);
  useEffect(() => {
    const on = () => setV(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return [v, (n) => (window.location.hash = n)];
}

function useClickAway<T extends HTMLElement>(open: boolean, close: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const k = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", k);
    };
  }, [open, close]);
  return ref;
}

function AccountSwitcher({ go }: { go: (v: ViewId) => void }) {
  const { accounts, accountId, setAccountId } = useAccount();
  const { f } = useSettings();
  const [open, setOpen] = useState(false);
  const ref = useClickAway<HTMLDivElement>(open, () => setOpen(false));
  const cur = accounts.find((a) => a.id === accountId);
  const initials = (s: string) => s.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();
  const pv = usePrivacy();
  const name = (cur?.game_name ?? pv.name(cur?.username)) || "No account";
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${name}. Switch account`}
        title={`${name} · ${accounts.length} account${accounts.length === 1 ? "" : "s"}`}
        className={`group relative flex h-9 w-9 items-center justify-center rounded-full p-[2px] transition-transform duration-200 hover:scale-105 ${open ? "bg-[linear-gradient(135deg,var(--accent),var(--violet))]" : "bg-line-strong hover:bg-[linear-gradient(135deg,var(--accent),var(--violet))]"}`}
      >
        <span className="flex h-full w-full items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--accent),var(--violet))] font-display text-[12px] font-bold text-white ring-2 ring-[var(--bg)]">
          {initials(name)}
        </span>
        {accounts.length > 1 && (
          <span className="num absolute -bottom-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-line bg-panel-3 px-1 text-[9.5px] font-semibold text-ink">
            {accounts.length}
          </span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }} className="pop absolute right-0 top-full z-50 mt-2 w-[290px] overflow-hidden p-1">
            <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Your accounts</div>
            {accounts.map((a) => (
              <button
                key={a.id}
                onClick={() => {
                  setAccountId(a.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-panel-2"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-panel-2 font-display text-[12px] font-bold">{initials(a.game_name ?? (pv.hidden ? "?" : a.username))}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {a.game_name ?? <Sens>{pv.name(a.username)}</Sens>}
                    {a.tagline && <span className="text-muted">#{a.tagline}</span>}
                  </span>
                  <span className="num block text-[11.5px] text-muted">data to {f.date(a.data_until)}</span>
                </span>
                {a.id === accountId && <Check size={15} className="text-accent" />}
              </button>
            ))}
            {accounts.length > 1 && (
              <button
                onClick={() => {
                  setOpen(false);
                  go("accounts");
                }}
                className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-line px-3 py-2 text-left text-[13px] hover:bg-panel-2"
              >
                <Users size={14} /> Compare all accounts
              </button>
            )}
            <button
              onClick={() => {
                setOpen(false);
                go("import");
              }}
              className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-line px-3 py-2 text-left text-[13px] text-accent hover:bg-panel-2"
            >
              <Upload size={14} /> Add or update an account
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function useScrolled(px = 8) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const f = () => setOn(window.scrollY > px);
    f();
    window.addEventListener("scroll", f, { passive: true });
    return () => window.removeEventListener("scroll", f);
  }, [px]);
  return on;
}

const PERIODS = [
  { v: "all", label: "All time" },
  { v: "d30", label: "Last 30 days" },
  { v: "d90", label: "Last 90 days" },
  { v: "d365", label: "Last 12 months" },
];

/** The period filter as one pill; timezone and clock live in Settings. */
function ScopePill() {
  const { range, setRange, years } = useAccount();
  const [open, setOpen] = useState(false);
  const ref = useClickAway<HTMLDivElement>(open, () => setOpen(false));
  const val = range.kind === "all" ? "all" : range.kind === "year" ? `y${range.y}` : `d${range.days}`;
  const set = (v: string) => setRange((v === "all" ? { kind: "all" } : v[0] === "y" ? { kind: "year", y: +v.slice(1) } : { kind: "last", days: +v.slice(1) }) as Range);
  const label = PERIODS.find((p) => p.v === val)?.label ?? val.slice(1);
  const chip = (on: boolean) => `num rounded-full border px-2.5 py-1 text-[12.5px] ${on ? "border-accent bg-accent-soft font-medium text-accent" : "border-line text-muted hover:border-line-strong hover:text-ink"}`;
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex h-8 items-center gap-2 rounded-full border px-3 text-[13px] ${val !== "all" ? "border-accent/50 bg-accent-soft" : "border-line bg-panel-2 hover:border-line-strong hover:bg-panel-3"}`}
      >
        <CalendarRange size={14} className={val !== "all" ? "text-accent" : "text-muted"} />
        <span className="whitespace-nowrap font-medium">{label}</span>
        <ChevronDown size={14} className={`text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Period"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: EASE_EMPH }}
            className="pop absolute right-0 top-full z-50 mt-2 w-[300px] origin-top-right space-y-3 p-3"
          >
            <div>
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-muted">Period</div>
              <div className="flex flex-wrap gap-1.5">
                {PERIODS.map((p) => (
                  <button key={p.v} aria-pressed={val === p.v} onClick={() => set(p.v)} className={chip(val === p.v)}>
                    {p.label}
                  </button>
                ))}
                {years.map((y) => (
                  <button key={y} aria-pressed={val === `y${y}`} onClick={() => set(`y${y}`)} className={chip(val === `y${y}`)}>
                    {y}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Pulsing dot: how fresh this account's data is. Turns amber once the newest record is a month old. */
function Freshness() {
  const { accounts, accountId, detail } = useAccount();
  const { f } = useSettings();
  const until = accounts.find((a) => a.id === accountId)?.data_until;
  if (!until || !detail) return null;
  const days = Math.floor((Date.now() - Date.parse(until)) / 864e5);
  const stale = days > STALE_DAYS;
  const tone = stale ? "bg-warn" : "bg-win";
  const dot = (
    <span className="relative flex h-2.5 w-2.5">
      {!stale && <span className={`absolute inline-flex h-full w-full animate-[ping_2.4s_cubic-bezier(0,0,0.2,1)_infinite] rounded-full opacity-50 ${tone}`} />}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${tone}`} />
    </span>
  );
  return (
    <div className="group relative flex">
      <span
        tabIndex={0}
        role="status"
        aria-label={stale ? `Data is ${days} days old` : `Data up to ${f.date(until)}`}
        className={`flex h-8 items-center gap-2 rounded-full ${stale ? "border border-warn/40 bg-warn-soft px-2.5 text-[12.5px] text-warn" : "w-8 justify-center hover:bg-panel-2"}`}
      >
        {dot}
        {stale && <span className="hidden sm:inline">{days} days old</span>}
      </span>
      <div className="pop pointer-events-none absolute right-0 top-full z-50 mt-2 w-max max-w-[260px] translate-y-1 px-3 py-2 text-[12.5px] opacity-0 transition-[opacity,transform] duration-200 group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100">
        <div className="font-medium">{stale ? "Your data is getting old" : "Data is fresh"}</div>
        <div className="text-muted">
          Newest record <span className="num text-ink">{f.date(until)}</span> · imported {f.relative(detail.imports[0]?.imported_at)}
        </div>
        {stale && <div className="mt-1 text-warn">Request a new export from Riot and import it.</div>}
      </div>
    </div>
  );
}

function IconNav({ items, view, go, className }: { items: typeof NAV; view: ViewId; go: (v: ViewId) => void; className: string }) {
  // Which icon is pointed at (or keyboard-focused). One shared pill glides to it and swaps its text at once,
  // so sliding across the icons never shows the previous page's name.
  const [tip, setTip] = useState<{ id: ViewId; x: number } | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const point = (id: ViewId, el: HTMLElement) => {
    const nav = navRef.current;
    if (!nav) return;
    const r = el.getBoundingClientRect();
    setTip({ id, x: r.left + r.width / 2 - nav.getBoundingClientRect().left + nav.scrollLeft });
  };
  const cur = tip ? items.find((n) => n.id === tip.id) : null;
  return (
    <nav ref={navRef} aria-label="Pages" className={`scroll-thin relative min-w-0 items-center gap-0.5 overflow-x-auto md:overflow-visible ${className}`} onPointerLeave={() => setTip(null)}>
      {items.map((n, i) => (
        <span key={n.id} className="flex items-center">
          {i > 0 && items[i - 1].group !== n.group && <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden />}
          <button
            onClick={() => go(n.id)}
            onPointerEnter={(e) => {
              prefetchPage(n.id);
              if (e.pointerType === "mouse") point(n.id, e.currentTarget);
            }}
            onFocus={(e) => {
              prefetchPage(n.id);
              if (e.currentTarget.matches(":focus-visible")) point(n.id, e.currentTarget);
            }}
            onBlur={() => setTip(null)}
            aria-label={n.label}
            aria-current={view === n.id ? "page" : undefined}
            className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${view === n.id ? "text-accent" : n.group === "Account recovery" ? "text-warn hover:bg-panel-2" : "text-muted hover:bg-panel-2 hover:text-ink"}`}
          >
            {view === n.id && (
              <motion.span layoutId="topnav-active" className="absolute inset-0 rounded-lg bg-accent-soft ring-1 ring-accent/30" transition={{ type: "spring", stiffness: 500, damping: 40 }} />
            )}
            <motion.span className="relative" animate={{ y: tip?.id === n.id ? -1 : 0, scale: tip?.id === n.id ? 1.12 : 1 }} transition={{ type: "spring", stiffness: 500, damping: 22 }}>
              {n.icon}
            </motion.span>
          </button>
        </span>
      ))}
      <AnimatePresence>
        {tip && cur && (
          <motion.span
            key="tip"
            aria-hidden
            className="pointer-events-none absolute left-0 top-full z-40 mt-2 flex w-0 justify-center"
            initial={{ opacity: 0, y: -4, x: tip.x }}
            animate={{ opacity: 1, y: 0, x: tip.x }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
            transition={{ x: { type: "spring", stiffness: 700, damping: 45 }, default: { duration: 0.15, ease: "easeOut" } }}
          >
            <span className={`pop whitespace-nowrap px-2.5 py-1 text-[12px] font-medium ${cur.group === "Account recovery" ? "text-warn" : "text-ink"}`}>
              {cur.label}
              {cur.group !== "Account recovery" && <span className="ml-1.5 text-faint">{cur.group}</span>}
            </span>
          </motion.span>
        )}
      </AnimatePresence>
    </nav>
  );
}

/** The app's only navigation: logo + account on the left, pages in the middle, data scope on the right. */
function TopBar({ view, items, go, empty }: { view: ViewId; items: typeof NAV; go: (v: ViewId) => void; empty: boolean }) {
  const scrolled = useScrolled();
  const { settings } = useSettings();
  return (
    <div
      className={`sticky top-0 z-30 bg-[color-mix(in_oklab,var(--bg)_72%,transparent)] backdrop-blur-xl backdrop-saturate-150 transition-shadow duration-300 ${scrolled ? "shadow-[0_10px_30px_-18px_rgb(0_0_0/0.6)]" : ""}`}
    >
      {/* Phones: logo + controls on one row, the page icons scroll on a second. From md: one row of three. */}
      <div className="mx-auto grid max-w-[1400px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2 sm:px-8 md:h-14 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:py-0">
        <div className="flex min-w-0 items-center gap-3">
          <button onClick={() => go(empty ? "import" : "overview")} className="flex shrink-0 items-center gap-2 rounded-lg" aria-label={`${APP_NAME}: ${empty ? "import data" : "overview"}`}>
            <Logo />
            <Wordmark by className="hidden text-[15px] xl:inline-flex" />
          </button>
        </div>
        <div className="col-span-2 row-start-2 flex min-w-0 justify-start md:col-span-1 md:row-start-auto md:justify-center">
          <IconNav items={items} view={view} go={go} className="flex" />
        </div>
        <div className="flex min-w-0 items-center justify-end gap-2">
          {!empty && <PrivacyToggle compact />}
          {!empty && <Freshness />}
          {!empty && !NO_SCOPE.includes(view) && <ScopePill />}
          {/* Back to the home page, styled like its "Open the app" button so the two products match. Carries the
              app's theme. The avatar stays at the far right. */}
          <a
            href={homeUrl(settings)}
            title={`${APP_NAME} home page`}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-[10px] bg-[linear-gradient(110deg,var(--accent),color-mix(in_oklab,var(--accent)_65%,var(--violet)))] px-2.5 text-[14px] font-semibold text-white shadow-[0_4px_14px_-8px_color-mix(in_oklab,var(--accent)_55%,transparent)] transition-[transform,box-shadow] duration-200 hover:-translate-y-px hover:shadow-[0_6px_18px_-8px_color-mix(in_oklab,var(--accent)_70%,transparent)] sm:px-3.5"
          >
            <House size={16} />
            <span className="hidden sm:inline">Back to home</span>
          </a>
          {!empty && <AccountSwitcher go={go} />}
        </div>
      </div>
      <div className="relative h-px bg-[linear-gradient(90deg,transparent,var(--line-strong)_20%,var(--line-strong)_80%,transparent)]">
        <ScrollProgress />
      </div>
    </div>
  );
}

/** How far down the page you are: a thin glowing line under the top bar. */
function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const x = useSpring(scrollYProgress, { stiffness: 200, damping: 30, restDelta: 0.001 });
  return (
    <motion.div
      aria-hidden
      className="absolute inset-x-0 -top-px h-[2px] origin-left bg-[linear-gradient(90deg,var(--accent),var(--violet))] shadow-[0_0_10px_var(--accent)]"
      style={{ scaleX: x }}
    />
  );
}

function Shell() {
  const { accounts, accountId, loading, error, has, setAccountId, refresh } = useAccount();
  useHideOn(accountId); // switching accounts goes back to privacy mode (here, as the Shell is always mounted)
  const [view, go] = useHashView();
  usePrefetchPages(!loading);
  const [demo, setDemo] = useState<{ busy: boolean; error?: string }>({ busy: false });

  // #demo (or #demo:<page>) loads the made-up demo player and opens it.
  useEffect(() => {
    const target = demoTarget();
    if (loading || !target || demo.busy) return;
    setDemo({ busy: true });
    loadDemo(accounts)
      .then(async (id) => {
        await refresh();
        setAccountId(id);
        setDemo({ busy: false });
        go((NAV.some((n) => n.id === target) ? target : "overview") as ViewId);
      })
      .catch(async (e: Error) => {
        await refresh().catch(() => {}); // an old demo may have been removed before the import failed
        setDemo({ busy: false, error: e.message });
        go("import");
      });
  }, [view, loading]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view]);

  if (loading || demo.busy)
    return (
      <>
        {demo.busy && <div className="pt-10 text-center font-display text-lg text-muted">Loading the demo player…</div>}
        <Loading />
      </>
    );
  if (error && !accounts.length)
    return (
      <div className="flex min-h-screen items-center justify-center p-8 text-center">
        <div>
          <div className="font-display text-2xl font-semibold">{APP_NAME} couldn't start</div>
          <p className="mt-2 text-muted">{error}</p>
        </div>
      </div>
    );

  const noAccounts = accounts.length === 0;
  const current = accounts.find((a) => a.id === accountId);
  const removeDemo = async () => {
    if (!current) return;
    await api.deleteAccount(current.id);
    if (accounts.length <= 1) clearPictureCache(); // the last account: nothing left that pictures belong to
    await refresh();
    go(accounts.length > 1 ? "overview" : "import");
  };
  const effective: ViewId = noAccounts && view !== "settings" ? "import" : view;
  const visible = NAV.filter((n) => !n.needs || n.needs.some(has));
  const topItems = visible.filter((n) => n.id !== "accounts" || accounts.length > 1);
  const page = {
    overview: <Overview />,
    money: <Money />,
    collection: <Collection />,
    matches: <Matches />,
    security: <Security />,
    conduct: <Conduct />,
    data: <DataBrowser />,
    import: (
      <Imports
        onImported={(id) => {
          setAccountId(id);
          go("overview");
        }}
      />
    ),
    settings: <SettingsView />,
    recovery: <Recovery />,
    accounts: (
      <AllAccounts
        open={(id) => {
          setAccountId(id);
          go("overview");
        }}
      />
    ),
  }[effective] ?? <Overview />;

  return (
    <div className="min-h-screen">
      <Ambient />
      <main className="min-w-0">
        <TopBar view={effective} items={noAccounts ? NAV.filter((n) => n.group === "App") : topItems} go={go} empty={noAccounts} />
        {isDemoAccount(current) && (
          <div data-demo-banner className="mx-auto max-w-[1400px] px-4 pt-4 sm:px-8">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-info/30 bg-info-soft px-4 py-2.5 text-[13px]">
              <FlaskConical size={16} className="shrink-0 text-info" />
              <span className="min-w-0 flex-1 basis-[15rem]">
                You're exploring <b>Demo Player#DEMO</b>, a made-up account. Nothing here is real data.
              </span>
              <button onClick={() => go("import")} className="rounded-md border border-line-strong px-2.5 py-1 font-medium hover:border-accent hover:text-accent">
                Use my own export
              </button>
              <button onClick={removeDemo} className="rounded-md px-2.5 py-1 text-muted hover:text-loss">
                Remove demo
              </button>
            </div>
          </div>
        )}
        {/* Enter-only page transition: no exit animation to wait for between pages. */}
        <motion.div key={effective} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: EASE_EMPH }}>
            {noAccounts && effective === "import" && (
              <div className="mx-auto max-w-[1400px] px-4 pt-10 sm:px-8">
                <div className="panel corner p-6">
                  <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-accent">Welcome</div>
                  <h1 className="mt-1 font-display text-3xl font-bold">Turn your Riot data export into a dashboard</h1>
                  <ol className="mt-3 list-decimal space-y-1 pl-5 text-muted">
                    <li>Request your data from Riot (privacy / data request on Riot's support site) and download the .zip they email you.</li>
                    <li>Drop it below. Add more accounts the same way.</li>
                    <li>When you request a newer export later, import it too — only new records are added.</li>
                  </ol>
                  <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
                    <button onClick={() => go("demo" as ViewId)} className="inline-flex items-center gap-2 rounded-lg border border-line-strong px-4 py-2 font-medium hover:border-accent hover:text-accent">
                      <FlaskConical size={16} /> Try it with a demo player
                    </button>
                    <span className="text-[13px] text-muted">No export yet? Riot can take up to 30 days. Explore a made-up account first.</span>
                    {demo.error && <span className="w-full text-[13px] text-loss">{demo.error}</span>}
                  </div>
                </div>
              </div>
            )}
            <ErrorBoundary key={`${effective}:${accountId}`}>
              <Suspense fallback={<PageFallback />}>{page}</Suspense>
            </ErrorBoundary>
        </motion.div>
        <Footer go={(v) => go(v as ViewId)} empty={noAccounts} />
      </main>
    </div>
  );
}

/** Respects the OS reduce-motion setting, or turns motion off entirely from Settings. */
function MotionRoot({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  return <MotionConfig reducedMotion={settings.motion === "reduced" ? "always" : "user"}>{children}</MotionConfig>;
}

export default function App() {
  return (
    <PrivacyProvider>
    <SettingsProvider>
      <MotionRoot>
        <AccountProvider>
          <FxProvider>
            <Shell />
          </FxProvider>
        </AccountProvider>
      </MotionRoot>
    </SettingsProvider>
    </PrivacyProvider>
  );
}
