import { resolveTheme } from "./themes";
import type { Settings } from "./settings";

/**
 * The home page's address, carrying the app's current theme (`?theme=<id>`), so the home page opens in
 * the same colours. The home page adopts it only if the visitor never picked a theme there (home/src/main.ts),
 * the same rule the app uses for the theme the home page hands over.
 */
export function homeUrl(settings: Settings, path = "/") {
  const u = new URL(path, __HOME_URL__);
  const dark = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  u.searchParams.set("theme", resolveTheme(settings.theme, settings, dark).id);
  return u.href;
}
