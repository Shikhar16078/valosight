#!/usr/bin/env node
/**
 * Publishes exchange rates as static files next to the web app, so the app never has to contact
 * a third party: every visitor downloads the same files from Valosight's own site.
 *
 *   public/rates/ecb/<year>.json  European Central Bank reference rates, EUR base, every business day
 *   public/rates/latest.json      today's ECB rates, plus open.er-api.com's for currencies the ECB lacks
 *
 * Runs before every build (`npm run build`) and on demand (`npm run rates`). Past years are
 * downloaded once and kept; the current year and the latest rates are refreshed each run.
 * Usage: node scripts/fetch-rates.mjs [--optional]   (--optional: keep going offline if files exist)
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "rates");
const FIRST_YEAR = 1999; // first ECB reference rate: 1999-01-04
const optional = process.argv.includes("--optional");

async function get(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Valosight rates build" }, signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (attempt >= 3) throw new Error(`${url}: ${e.message}`);
      await new Promise((ok) => setTimeout(ok, 1000 * attempt));
    }
  }
}

const write = (file, data) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data));
};

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const thisYear = Number(today.slice(0, 4));
  let fetched = 0;
  for (let y = FIRST_YEAR; y <= thisYear; y++) {
    const file = join(OUT, "ecb", `${y}.json`);
    // A finished year never changes; refresh the current one, and last year until mid-January.
    const settled = y < thisYear - 1 || (y === thisYear - 1 && today > `${thisYear}-01-15`);
    if (settled && existsSync(file)) continue;
    const d = await get(`https://api.frankfurter.dev/v1/${y}-01-01..${y}-12-31?base=EUR`);
    const rates = Object.fromEntries(Object.entries(d.rates ?? {}).filter(([day]) => day.startsWith(`${y}-`)));
    write(file, { base: "EUR", source: "European Central Bank via frankfurter.dev", year: y, rates });
    fetched++;
  }

  const ecb = await get("https://api.frankfurter.dev/v1/latest?base=EUR");
  const other = await get("https://open.er-api.com/v6/latest/USD");
  if (other.result !== "success") throw new Error("open.er-api.com returned no rates");
  write(join(OUT, "latest.json"), {
    updated: new Date().toISOString(),
    first_year: FIRST_YEAR,
    last_year: thisYear,
    ecb: { base: "EUR", date: ecb.date, rates: ecb.rates, source: "ECB via frankfurter.dev" },
    other: {
      base: "USD",
      date: new Date(Number(other.time_last_update_unix) * 1000).toISOString().slice(0, 10),
      rates: other.rates,
      source: "open.er-api.com",
    },
  });
  console.log(`Exchange rates: ${fetched} year file(s) downloaded, latest ECB rates from ${ecb.date}.`);
}

main().catch((e) => {
  const have = existsSync(join(OUT, "latest.json"));
  console.error(`Couldn't update exchange rates: ${e.message}`);
  if (optional && have) {
    console.error("Keeping the rates already downloaded.");
    return;
  }
  // A deploy without rates would leave the currency feature broken, so stop: the previous deploy stays live.
  process.exit(1);
});

