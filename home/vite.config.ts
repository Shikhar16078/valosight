import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
// The app's theme list: the boot script needs each theme's mode (dark/light).
import { DEFAULT_DARK, DEFAULT_LIGHT, THEMES } from "../app/src/lib/themes.ts";

/** Where the app lives. Change both when the custom domains go live (valosight.in / app.valosight.in). */
const APP_URL = "https://valosight-app.vercel.app";
/** The app's dev server (`cd app && npm run dev`): the home page's dev server links there instead. */
const LOCAL_APP_URL = "http://localhost:5174";
const SITE_URL = "https://valosight.vercel.app";
const REPO_URL = "https://github.com/Shikhar16078/valosight";
/** KsK's Discord server, advertised on the home page (nav, Community section, FAQ, footer). */
const DISCORD_URL = "https://discord.gg/MMK4nJqApZ";

/** The Content-Security-Policy from vercel.json, so local builds enforce the same lock as the hosted site. */
function csp(): string {
  const conf = JSON.parse(readFileSync(new URL("./vercel.json", import.meta.url), "utf8"));
  const value: string = conf.headers.flatMap((h: { headers: { key: string; value: string }[] }) => h.headers).find((h: { key: string }) => h.key === "Content-Security-Policy").value;
  // A <meta> policy can't use frame-ancestors, and upgrade-insecure-requests would break plain-http localhost.
  return value
    .split(";")
    .map((d) => d.trim())
    .filter((d) => d && !d.startsWith("frame-ancestors") && !d.startsWith("upgrade-insecure-requests"))
    .join("; ");
}

/**
 * /boot.js: a tiny classic script loaded in <head>, so it runs before the first paint (the CSP allows
 * only same-origin scripts, so it can't be inline). It applies the saved theme (or the one the app hands
 * over, or the OS preference) and marks JS as on, so the page never flashes the default theme or shows
 * sections that the reveal animation then hides. src/main.ts follows the same rules afterwards.
 */
function bootScript(): string {
  const modes = Object.fromEntries(THEMES.map((t) => [t.id, t.mode]));
  return `(function () {
  var M = ${JSON.stringify(modes)}, d = document.documentElement, id = null;
  d.classList.add("js");
  try {
    var saved = localStorage.getItem("valosight.home.theme");
    var handed = new URLSearchParams(location.search).get("theme");
    id = saved && M[saved] ? saved : handed && M[handed] ? handed : null;
  } catch (e) {}
  if (!id) id = matchMedia("(prefers-color-scheme: light)").matches ? ${JSON.stringify(DEFAULT_LIGHT)} : ${JSON.stringify(DEFAULT_DARK)};
  d.dataset.palette = id;
  d.dataset.theme = M[id];
})();
`;
}

function home(appUrl: string): Plugin {
  return {
    name: "valosight-home",
    configureServer(server) {
      server.middlewares.use("/boot.js", (_req, res) => {
        res.setHeader("Content-Type", "text/javascript");
        res.end(bootScript());
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "boot.js", source: bootScript() });
    },
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        let out = html.replaceAll("%APP_URL%", appUrl).replaceAll("%SITE_URL%", SITE_URL).replaceAll("%REPO_URL%", REPO_URL).replaceAll("%DISCORD_URL%", DISCORD_URL);
        if (!ctx.server) out = out.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp()}" />`);
        // Vercel Web Analytics: cookieless visit counts, served from this site's own address (/_vercel/insights),
        // so the security policy stays "this site only". Only on Vercel, where that path exists.
        if (!ctx.server && process.env.VERCEL) out = out.replace("</body>", '    <script defer src="/_vercel/insights/script.js"></script>\n  </body>');
        return out;
      },
    },
  };
}

export default defineConfig(({ command }) => {
  const appUrl = command === "serve" ? LOCAL_APP_URL : APP_URL;
  return {
    plugins: [home(appUrl)],
    // The app's address, so links to it can carry the theme picked here (src/main.ts).
    define: { __APP_URL__: JSON.stringify(appUrl) },
    server: { port: 5175, strictPort: true, fs: { allow: [".", "../app/src/tokens.css", "../app/src/lib/themes.ts"] } },
    build: { outDir: "dist" },
  };
});
