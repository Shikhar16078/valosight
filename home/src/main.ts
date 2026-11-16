import "./home.css";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  CircleCheck,
  CloudOff,
  createIcons,
  EyeOff,
  FlaskConical,
  Code,
  HardDrive,
  Info,
  LifeBuoy,
  Lightbulb,
  Lock,
  LockKeyhole,
  OctagonAlert,
  Palette,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Swords,
  TriangleAlert,
  User,
  Wallet,
  WifiOff,
} from "lucide";
// The app's own theme list, so the site offers exactly the same themes.
import { THEMES } from "../../app/src/lib/themes";

const root = document.documentElement;
root.classList.add("js");

createIcons({
  icons: {
    ArrowRight, BadgeCheck, Check, CircleCheck, CloudOff, EyeOff, FlaskConical, Code, HardDrive, Info, LifeBuoy, Lightbulb, Lock,
    LockKeyhole, OctagonAlert, Palette, ShieldAlert, ShieldCheck, Sparkles, Swords, TriangleAlert, User, Wallet, WifiOff,
  },
});

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ------------------------------------------------------------------ themes */
const KEY = "valosight.home.theme";
const saved = (() => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
})();

/**
 * Theme hand-off: once a visitor picks a theme here, every link into the app carries it as `?theme=<id>`.
 * The app adopts it only if that browser has never picked a theme inside the app (app/src/lib/settings.tsx).
 * The two sites are separate origins, so this link is the only way the choice can travel.
 */
function handOff(id: string) {
  for (const a of document.querySelectorAll<HTMLAnchorElement>(`a[href^="${__APP_URL__}"]`)) {
    const u = new URL(a.href);
    u.searchParams.set("theme", id);
    a.href = u.href;
  }
}

function apply(id: string) {
  const t = THEMES.find((x) => x.id === id) ?? THEMES[0];
  root.dataset.theme = t.mode;
  root.dataset.palette = t.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", getComputedStyle(root).getPropertyValue("--bg").trim() || "#0b0b10");
  for (const b of document.querySelectorAll<HTMLButtonElement>(".swatch")) b.setAttribute("aria-checked", String(b.dataset.palette === t.id));
}

/** A soft dissolve into the new theme, like the app; a plain switch without View Transitions or with reduced motion. */
function switchTheme(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* private mode: the choice just isn't remembered */
  }
  handOff(id);
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
  if (!doc.startViewTransition || reduceMotion()) return apply(id);
  const vt = doc.startViewTransition(() => {
    root.classList.add("theme-switching");
    apply(id);
  });
  vt.finished.finally(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));
}

const pop = document.getElementById("theme-pop")!;
const btn = document.getElementById("theme-btn")!;
for (const t of THEMES) {
  const s = document.createElement("button");
  s.className = "swatch";
  s.type = "button";
  s.dataset.palette = t.id; // the swatch shows that theme's real colours (tokens apply on any element)
  s.dataset.theme = t.mode;
  s.setAttribute("role", "menuitemradio");
  s.setAttribute("aria-label", `${t.name}: ${t.blurb}`);
  s.title = t.name;
  s.addEventListener("click", () => {
    switchTheme(t.id);
    toggle(false);
  });
  pop.querySelector(`.swatches[data-mode="${t.mode}"]`)!.append(s);
}
const toggle = (open = pop.hidden) => {
  pop.hidden = !open;
  btn.setAttribute("aria-expanded", String(open));
};
btn.addEventListener("click", (e) => {
  e.stopPropagation();
  toggle();
});
document.addEventListener("click", (e) => {
  if (!pop.hidden && !pop.contains(e.target as Node)) toggle(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") toggle(false);
});
apply(saved ?? (window.matchMedia("(prefers-color-scheme: light)").matches ? "paper" : "vault"));
if (saved && THEMES.some((t) => t.id === saved)) handOff(saved); // only a theme the visitor actually picked travels

/* ------------------------------------------------------------- nav + reveal */
const nav = document.querySelector(".nav")!;
const onScroll = () => nav.classList.toggle("scrolled", scrollY > 8);
addEventListener("scroll", onScroll, { passive: true });
onScroll();

const reveal = new IntersectionObserver(
  (entries) => {
    for (const e of entries)
      if (e.isIntersecting) {
        e.target.classList.add("in");
        reveal.unobserve(e.target);
      }
  },
  { rootMargin: "0px 0px -8% 0px" },
);
document.querySelectorAll("[data-reveal]").forEach((el, i) => {
  (el as HTMLElement).style.transitionDelay = `${Math.min((i % 6) * 60, 300)}ms`; // a gentle stagger within each group
  reveal.observe(el);
});

// Highlight the section you're reading in the nav.
const links = [...document.querySelectorAll<HTMLAnchorElement>(".links a")];
const spy = new IntersectionObserver(
  (entries) => {
    for (const e of entries) if (e.isIntersecting) for (const a of links) a.classList.toggle("active", a.hash === `#${e.target.id}`);
  },
  { rootMargin: "-45% 0px -50% 0px" },
);
for (const a of links) {
  const s = document.querySelector(a.hash);
  if (s) spy.observe(s);
}

/* ----------------------------------------------------------------- gallery */
const shot = document.getElementById("shot") as HTMLImageElement;
const ALT: Record<string, string> = {
  overview: "Overview page of the demo player",
  money: "Money page: total paid, VP bought and spent, spending per month and by year",
  collection: "Collection page: skins by weapon with Radianite upgrades and where each was bought",
  security: "Security page: Riot's suspicious-activity alert, the new IP address and related account changes",
};
for (const tab of document.querySelectorAll<HTMLButtonElement>(".tabs button")) {
  tab.addEventListener("click", () => {
    const name = tab.dataset.shot!;
    for (const t of document.querySelectorAll(".tabs button")) t.setAttribute("aria-selected", String(t === tab));
    const swap = () => {
      shot.src = `/shots/${name}.jpg`;
      shot.alt = ALT[name];
    };
    if (reduceMotion()) return swap();
    shot.classList.add("swapping");
    setTimeout(() => {
      swap();
      shot.decode().finally(() => shot.classList.remove("swapping"));
    }, 180);
  });
}
