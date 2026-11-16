import { motion } from "motion/react";
import { usePrivacy } from "../lib/privacy";
import { ArrowUp, ArrowUpRight, Heart, Database, FileStack, HardDrive, LifeBuoy, Lock, RefreshCw, Settings, Upload } from "lucide-react";
import type { ReactNode } from "react";
import { useAccount } from "../lib/account";
import { useSettings } from "../lib/settings";
import { homeUrl } from "../lib/home";
import { THEMES } from "../lib/themes";
import { EASE_EMPH } from "../lib/motion";
import { useOffline } from "../lib/pwa";

import { APP_NAME, AUTHOR, Logo, Wordmark } from "./Logo";

/** Site footer: where the data comes from, shortcuts, a quick theme picker and the fine print. */
export function Footer({ go, empty }: { go: (v: string) => void; empty: boolean }) {
  const { detail } = useAccount();
  const pv = usePrivacy();
  const { settings, setTheme } = useSettings();
  const offline = useOffline();
  const files = detail?.datasets.filter((d) => d.count > 0).length ?? 0;
  const imports = detail?.imports.length ?? 0;
  const firsts = detail?.datasets.map((d) => d.first).filter(Boolean).sort() as string[] | undefined;
  const lasts = detail?.datasets.map((d) => d.last).filter(Boolean).sort() as string[] | undefined;
  const active = settings.theme === "system" ? null : settings.theme === "dark" ? settings.darkTheme : settings.theme === "light" ? settings.lightTheme : settings.theme;

  return (
    <motion.footer
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.6, ease: EASE_EMPH }}
      className="relative mt-10"
    >
      <div className="h-px bg-[linear-gradient(90deg,transparent,var(--accent)_30%,var(--violet)_70%,transparent)] opacity-60" />
      <div className="bg-[linear-gradient(180deg,color-mix(in_oklab,var(--panel)_55%,transparent),transparent)]">
        <div className="mx-auto grid max-w-[1400px] gap-10 px-4 pb-8 pt-10 sm:px-8 md:grid-cols-2 xl:grid-cols-[1.3fr_1.4fr_1fr_1fr]">
          {/* brand + privacy */}
          <div className="space-y-4">
            <div className="flex items-center gap-2.5">
              <Logo size={30} />
              <div>
                <Wordmark className="text-[17px]" />
                <div className="mt-1 text-[12.5px] text-muted">VALORANT intel on your own account.</div>
              </div>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-win/30 bg-win-soft px-3 py-1.5 text-[12.5px] text-win">
              <Lock size={13} /> Stays on this device · nothing is uploaded{offline === "ready" && " · works offline"}
            </div>
            <p className="text-[12px] text-faint">Fan-made and unofficial. Not affiliated with Riot Games.</p>
            <a href={homeUrl(settings)} className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-accent">
              {APP_NAME} home page <ArrowUpRight size={13} />
            </a>
          </div>

          {/* where this comes from */}
          <div>
            <FooterTitle>Where this comes from</FooterTitle>
            <p className="text-[13px] leading-relaxed text-muted">
              Everything here is read from Riot's personal-data export and stored only on this device. Each new export is merged in, and nothing you imported before is lost
              even if Riot stops including it.
            </p>
            {!empty && detail && (
              <div className="mt-3 grid grid-cols-3 gap-2">
                <Fact icon={<FileStack size={14} />} k="Data files" v={String(files)} />
                <Fact icon={<RefreshCw size={14} />} k="Imports" v={String(imports)} />
                <Fact icon={<HardDrive size={14} />} k="Covers" v={firsts?.length && lasts?.length ? `${pv.hidden ? "••••" : firsts[0].slice(0, 4)} → ${lasts[lasts.length - 1].slice(0, 4)}` : "—"} />
              </div>
            )}
          </div>

          {/* shortcuts */}
          <div>
            <FooterTitle>Shortcuts</FooterTitle>
            <ul className="space-y-1.5 text-[13.5px]">
              <FooterLink icon={<Upload size={14} />} onClick={() => go("import")}>
                Import a newer export
              </FooterLink>
              {!empty && (
                <>
                  <FooterLink icon={<LifeBuoy size={14} />} onClick={() => go("recovery")}>
                    Ownership answers
                  </FooterLink>
                  <FooterLink icon={<Database size={14} />} onClick={() => go("data")}>
                    Every data file
                  </FooterLink>
                </>
              )}
              <FooterLink icon={<Settings size={14} />} onClick={() => go("settings")}>
                Settings
              </FooterLink>
            </ul>
          </div>

          {/* themes */}
          <div>
            <FooterTitle>Theme</FooterTitle>
            <div className="grid w-max grid-cols-5 gap-2">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  title={`${t.name} · ${t.blurb}`}
                  aria-label={`${t.name} theme`}
                  aria-pressed={active === t.id}
                  onClick={() => setTheme(t.id)}
                  data-theme={t.mode}
                  data-palette={t.id}
                  className={`relative h-7 w-7 rounded-full border border-[var(--line-strong)] transition-transform duration-200 hover:scale-115 ${active === t.id ? "ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg)]" : ""}`}
                  style={{ background: "linear-gradient(135deg, var(--accent) 0 50%, var(--panel) 50% 100%)" }}
                />
              ))}
            </div>
            <div className="mt-2 text-[12.5px] text-muted">{active ? `${THEMES.find((t) => t.id === active)?.name} theme` : "Matching your system"}</div>
          </div>
        </div>

        <div className="mx-auto max-w-[1400px] px-4 sm:px-8">
        {/* Equal side columns keep the credit at the true centre whatever the sides contain. */}
        <div className="grid items-center gap-3 border-t border-line py-4 text-[12px] text-faint md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <span className="flex items-center gap-2 justify-self-center md:justify-self-start">
            {APP_NAME}
            <span className="num rounded-full border border-line px-2 py-0.5 text-[11px] text-muted" title="App version">
              v{__APP_VERSION__}
            </span>
          </span>
          <span className="group flex items-center gap-1.5 justify-self-center text-[12.5px] text-muted">
            Crafted with
            <motion.span
              aria-label="love"
              className="inline-flex text-accent"
              animate={{ scale: [1, 1.25, 1, 1.18, 1] }}
              transition={{ duration: 1.4, repeat: Infinity, repeatDelay: 1.2, ease: "easeInOut" }}
            >
              <Heart size={13} fill="currentColor" />
            </motion.span>
            by
            <span className="bg-[linear-gradient(90deg,var(--accent),var(--violet),var(--info),var(--accent))] bg-[length:300%_100%] bg-clip-text font-display text-[13.5px] font-bold tracking-wide text-transparent transition-[background-position] duration-[1.6s] ease-out [background-position:0%_0] group-hover:[background-position:100%_0]">
              {AUTHOR}
            </span>
          </span>
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="group flex items-center gap-1.5 justify-self-center rounded-full border border-line px-3 py-1 text-muted hover:border-line-strong hover:text-ink md:justify-self-end"
          >
            <ArrowUp size={13} className="transition-transform duration-300 group-hover:-translate-y-0.5" /> Back to top
          </button>
        </div>
        </div>
      </div>
    </motion.footer>
  );
}

function FooterTitle({ children }: { children: ReactNode }) {
  return <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted">{children}</div>;
}

function Fact({ icon, k, v }: { icon: ReactNode; k: string; v: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel-2/50 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[11px] text-muted">
        {icon}
        {k}
      </div>
      <div className="num mt-0.5 truncate text-[13px] text-ink" title={v}>
        {v}
      </div>
    </div>
  );
}

function FooterLink({ icon, onClick, children }: { icon: ReactNode; onClick: () => void; children: ReactNode }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="group flex items-center gap-2 text-muted hover:text-ink">
        <span className="text-faint transition-colors group-hover:text-accent">{icon}</span>
        <span className="relative">
          {children}
          <span className="absolute -bottom-0.5 left-0 h-px w-full origin-left scale-x-0 bg-accent transition-transform duration-300 group-hover:scale-x-100" />
        </span>
      </button>
    </li>
  );
}
