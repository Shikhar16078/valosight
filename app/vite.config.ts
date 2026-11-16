import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import pkg from "./package.json";


/** The Content-Security-Policy from vercel.json, so the hosted site and local builds enforce the same lock. */
function csp(): string {
  const conf = JSON.parse(readFileSync(new URL("./vercel.json", import.meta.url), "utf8"));
  const header = conf.headers.flatMap((h: { headers: { key: string; value: string }[] }) => h.headers).find((h: { key: string }) => h.key === "Content-Security-Policy");
  // A <meta> policy can't use frame-ancestors, and upgrade-insecure-requests would break plain-http localhost.
  return header.value
    .split(";")
    .map((d: string) => d.trim())
    .filter((d: string) => d && !d.startsWith("frame-ancestors") && !d.startsWith("upgrade-insecure-requests"))
    .join("; ");
}

function files(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p, base) : [relative(base, p).split("\\").join("/")];
  });
}

/** Security headers in the page, the app manifest and an offline service worker. */
function valosight(): Plugin {
  return {
    name: "valosight",
    apply: "build",
    transformIndexHtml() {
      const tags: { tag: string; attrs: Record<string, string>; injectTo: "head-prepend" | "head" }[] = [
        { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: csp() }, injectTo: "head-prepend" },
        { tag: "meta", attrs: { name: "referrer", content: "no-referrer" }, injectTo: "head" },
        { tag: "link", attrs: { rel: "manifest", href: "/manifest.webmanifest" }, injectTo: "head" },
        { tag: "meta", attrs: { name: "theme-color", content: "#0b0b10" }, injectTo: "head" },
        { tag: "link", attrs: { rel: "apple-touch-icon", href: "/apple-touch-icon.png" }, injectTo: "head" },
        { tag: "meta", attrs: { name: "description", content: "Your Riot data export as a private dashboard. Everything stays on your device." }, injectTo: "head" },
      ];
      return tags;
    },
    generateBundle(_, bundle) {
      // The fabricated demo player (test/demo-export), served from the app's own site for "Try the demo".
      const demoZip = readFileSync(fileURLToPath(new URL("../test/demo-export/Demo_Player-DEMO.zip", import.meta.url)));
      this.emitFile({ type: "asset", fileName: "demo/Demo_Player-DEMO.zip", source: demoZip });
      // Everything this release needs to run offline. Exchange rates are cached as they're used, and
      // .woff fonts are skipped: every browser with service workers uses the .woff2 copies.
      const own = [...new Set([...Object.keys(bundle), "demo/Demo_Player-DEMO.zip"])].filter((f) => !f.endsWith(".woff") && !f.endsWith(".map"));
      const pub = files(fileURLToPath(new URL("./public", import.meta.url))).filter((f) => !f.startsWith("rates/") && !f.startsWith("."));
      const precache = ["/", ...[...own, ...pub].sort().map((f) => `/${f}`)];
      // Built files carry a content hash in their name; the rest (demo, icons, manifest) keep their name when
      // they change, so their bytes go into the version too, or returning visitors would keep stale copies.
      const h = createHash("sha256").update(precache.join("\n"));
      for (const f of pub) h.update(readFileSync(fileURLToPath(new URL(`./public/${f}`, import.meta.url))));
      h.update(demoZip);
      const version = h.digest("hex").slice(0, 12);
      const source = readFileSync(new URL("./pwa/sw.js", import.meta.url), "utf8").replace("__VERSION__", version).replace("__PRECACHE__", JSON.stringify(precache, null, 1));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

/** The dev server serves the demo player at the same address the build does, so "Try the demo" works locally. */
function demoInDev(): Plugin {
  return {
    name: "valosight-demo-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/demo/Demo_Player-DEMO.zip", (_req, res) => {
        res.setHeader("Content-Type", "application/zip");
        res.end(readFileSync(fileURLToPath(new URL("../test/demo-export/Demo_Player-DEMO.zip", import.meta.url))));
      });
    },
  };
}

/** The home page (home/): the app's "Home" button links there. Change it when valosight.in goes live. */
const HOME_URL = "https://valosight.vercel.app";
/** The home page's dev server (`cd home && npm run dev`). */
const LOCAL_HOME_URL = "http://localhost:5175";

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss(), valosight(), demoInDev()],
  // The home page's dev server links here (home/vite.config.ts), so keep the port fixed.
  server: { port: 5174, strictPort: true },
  build: { chunkSizeWarningLimit: 1500 },
  worker: { format: "es" },
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __HOME_URL__: JSON.stringify(command === "serve" ? LOCAL_HOME_URL : HOME_URL) },
}));
