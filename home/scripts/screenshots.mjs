/**
 * Retakes the home page screenshots (public/shots/*.jpg) from the demo player, the same way every time:
 * a fixed window size, 2x for sharp screens, scrolled to the top, no scrollbar, animations finished.
 *
 * Needs the app's dev server (cd app && npm run dev → http://localhost:5174) and Google Chrome.
 * Run: cd home && npm run shots
 * Uses a throwaway Chrome profile, so it never touches your own browser or its data.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = process.env.APP_URL ?? "http://localhost:5174";
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = fileURLToPath(new URL("../public/shots/", import.meta.url));
const WIDTH = 1440;
const HEIGHT = 810;
const SCALE = 2;
const PAGES = ["overview", "money", "collection", "security"];
const PORT = 9333;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "valosight-shots-"));
const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  "--hide-scrollbars",
  "--no-first-run",
  "--no-default-browser-check",
  "about:blank",
]);

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    target = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      .then((r) => r.json())
      .then((l) => l.find((t) => t.type === "page"))
      .catch(() => undefined);
  }
  if (!target) throw new Error("Chrome didn't start");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
  const waitFor = async (expression, what, ms = 20000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) if (await evaluate(expression)) return;
    throw new Error(`timed out waiting for ${what}`);
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: false });
  // Dark theme, like most visitors' first look at the app.
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });

  // Load the demo player once (it's stored in this throwaway profile), then visit each page.
  await send("Page.navigate", { url: `${APP}/#demo:overview` });
  await waitFor(`document.body.innerText.includes("Demo Player")`, "the demo player to load");

  for (const page of PAGES) {
    await evaluate(`location.hash = "#${page}"; true`);
    await waitFor(`location.hash === "#${page}" && !document.querySelector(".skeleton")`, `the ${page} page`);
    // Let reveals, count-ups and charts finish; hide the "this is a demo" banner (the home page says so in its
    // caption) and the cursor-only effects; start at the very top.
    await sleep(2500);
    await evaluate(`(() => {
      document.querySelector("[data-demo-banner]")?.style.setProperty("display", "none");
      window.scrollTo(0, 0);
      return true;
    })()`);
    await sleep(600);
    const { data } = await send("Page.captureScreenshot", { format: "jpeg", quality: 82, captureBeyondViewport: false });
    writeFileSync(join(OUT, `${page}.jpg`), Buffer.from(data, "base64"));
    console.log(`shots/${page}.jpg`);
  }
  ws.close();
} finally {
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
