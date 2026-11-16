import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

/** Where the app lives. Change both when the custom domains go live (valosight.in / app.valosight.in). */
const APP_URL = "https://valosight-app.vercel.app";
const SITE_URL = "https://valosight.vercel.app";
const REPO_URL = "https://github.com/Shikhar16078/valosight";

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

function home(): Plugin {
  return {
    name: "valosight-home",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        let out = html.replaceAll("%APP_URL%", APP_URL).replaceAll("%SITE_URL%", SITE_URL).replaceAll("%REPO_URL%", REPO_URL);
        if (!ctx.server) out = out.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp()}" />`);
        // Vercel Web Analytics: cookieless visit counts, served from this site's own address (/_vercel/insights),
        // so the security policy stays "this site only". Only on Vercel, where that path exists.
        if (!ctx.server && process.env.VERCEL) out = out.replace("</body>", '    <script defer src="/_vercel/insights/script.js"></script>\n  </body>');
        return out;
      },
    },
  };
}

export default defineConfig({
  plugins: [home()],
  // The app's address, so links to it can carry the theme picked here (src/main.ts).
  define: { __APP_URL__: JSON.stringify(APP_URL) },
  server: { port: 5175, fs: { allow: [".", "../app/src/tokens.css", "../app/src/lib/themes.ts"] } },
  build: { outDir: "dist" },
});
