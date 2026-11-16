/**
 * Colour themes. Each theme's colours live in index.css under [data-palette="<id>"]; its mode
 * (dark/light: shadows, grain, color-scheme) under [data-theme="<mode>"]. Both attributes can sit
 * on any element, which is how the Settings previews render each theme for real.
 */
export interface Theme {
  id: string;
  name: string;
  mode: "dark" | "light";
  blurb: string;
}

export const THEMES: Theme[] = [
  { id: "vault", name: "Vault", mode: "dark", blurb: "Radiant red on ink" },
  { id: "abyss", name: "Abyss", mode: "dark", blurb: "Electric blue on deep navy" },
  { id: "viper", name: "Viper", mode: "dark", blurb: "Toxic green on black" },
  { id: "ember", name: "Ember", mode: "dark", blurb: "Molten orange on charcoal" },
  { id: "nebula", name: "Nebula", mode: "dark", blurb: "Violet and magenta on night" },
  { id: "paper", name: "Paper", mode: "light", blurb: "Crisp red on warm white" },
  { id: "glacier", name: "Glacier", mode: "light", blurb: "Cool blue on ice" },
  { id: "sage", name: "Sage", mode: "light", blurb: "Leaf green on soft mint" },
  { id: "sunflower", name: "Sunflower", mode: "light", blurb: "Golden amber on cream" },
  { id: "blossom", name: "Blossom", mode: "light", blurb: "Rose pink on blush" },
];

export const DEFAULT_DARK = "vault";
export const DEFAULT_LIGHT = "paper";

export const themeById = (id: string | undefined) => THEMES.find((t) => t.id === id);

/** The setting may be a theme id, "system", or a value from before themes existed ("dark"/"light"). */
export function resolveTheme(setting: string, prefs: { darkTheme?: string; lightTheme?: string }, systemDark: boolean): Theme {
  const dark = themeById(prefs.darkTheme) ?? themeById(DEFAULT_DARK)!;
  const light = themeById(prefs.lightTheme) ?? themeById(DEFAULT_LIGHT)!;
  if (setting === "dark") return dark;
  if (setting === "light") return light;
  if (setting === "system") return systemDark ? dark : light;
  return themeById(setting) ?? dark;
}

export function applyTheme(t: Theme, el: HTMLElement = document.documentElement) {
  el.dataset.theme = t.mode;
  el.dataset.palette = t.id;
}

let switching = 0;

/**
 * Switch theme with a soft dissolve: the new theme fades in over the old one across the whole page
 * (View Transitions; the timing lives in index.css). Browsers without it get a colour cross-fade;
 * reduced motion switches instantly.
 *
 * `change` must make every DOM change of the switch (React state included, via flushSync): the
 * browser photographs the page just before calling it and fades from that photo to the result.
 * While the switch runs, `.theme-switching` turns off CSS transitions and pauses looping animations
 * (index.css). Otherwise every hover fade on the page starts at once when the colours change
 * (~140 of them on Settings), smearing the new theme in and stalling the dissolve.
 */
export function transitionTheme(change: () => void) {
  const root = document.documentElement;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches || root.dataset.motion === "reduced";
  if (reduce) {
    change();
    return;
  }
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
  if (!doc.startViewTransition) {
    root.classList.add("theme-fade");
    change();
    window.setTimeout(() => root.classList.remove("theme-fade"), 700);
    return;
  }
  const vt = doc.startViewTransition(() => {
    switching++;
    root.classList.add("theme-switching");
    change();
  });
  vt.finished
    .catch(() => {})
    .finally(() => {
      // Wait a frame so the restored transitions don't see the colour change as something to animate.
      requestAnimationFrame(() => {
        if (--switching <= 0) {
          switching = 0;
          root.classList.remove("theme-switching");
        }
      });
    });
}
