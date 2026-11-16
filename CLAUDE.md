# Valosight

Web app that turns a Riot Games personal-data export (.zip or extracted folder) into a private dashboard, entirely in the visitor's browser. Built for **any** Riot player, not just the author: multiple accounts, repeat imports, games/files we've never seen. Never hard-code the author's account, currency (PHP), region or timezone.

**Name:** user-facing name is **Valosight** ("Valo" = VALORANT + sight/intel), signed "by KsK". The credit "Crafted with ♥ by King KsK" in the footer is the author's own branding: keep it. Internal names were deliberately **not** renamed: env var `RIOTVAULT_TEST_ZIP`, `riotvault.*` localStorage keys, npm package `riot-vault-dashboard`. Brand constants live in `app/src/components/Logo.tsx` (`APP_NAME`, `AUTHOR`, `Logo`, `Wordmark`). The mark is a white V with an aim dot on an accent→violet gradient; `app/public/favicon.svg` is a static copy of it.

## Going public (decided 2026-11-15)

The public version is the **web build**: the engine runs in the visitor's browser (Web Worker + IndexedDB), so exports are never uploaded and there is no backend holding user data. Folders: `app/` is the app (was `dashboard/`), `home/` the home page (was `site/`), renamed 2026-11-15. Hosting: Vercel, two projects from this repo (`valosight-app` from `app/` → valosight-app.vercel.app; `valosight` from `home/` → valosight.vercel.app, the landing page) until the move to `valosight.in` / `app.valosight.in`, which must happen **before** public launch (browser storage is per-origin, so moving later strands users' vaults). Native installers were rejected (code-signing cost). The original Python engine (FastAPI + SQLite, `engine/`) and the desktop build were retired on 2026-11-15; it is in git history if ever needed. KsK's old local vault was converted to a `.valosight` backup (`data/`, gitignored) and verified identical.

## Layout

- `home/`: the landing page (Vercel project `valosight`, Root Directory `home`): static `index.html` (SEO; sections Why, not-a-backup warning, Account security + Riot's ownership questions, data-request tutorial, Privacy, FAQ) + `src/main.ts` (lucide icons, theme picker, reveal, gallery) + `src/home.css`. It imports the app's `app/src/tokens.css` and `lib/themes.ts`, so themes stay identical. CSP lives in `home/vercel.json` (copied into a meta tag by `vite.config.ts`, which also fills `%APP_URL%`/`%SITE_URL%`/`%REPO_URL%`); Vercel Web Analytics is injected only on Vercel builds, from the same-origin `/_vercel/insights` path. Screenshots in `home/public/shots/` show only the demo player. Theme hand-off: after a visitor picks a theme on the home page, `main.ts` adds `?theme=<id>` to every link into the app; `SettingsProvider` (`lib/settings.tsx`) removes it from the address and adopts it only if no theme was ever saved in the app (a theme chosen in the app always wins). The two sites are separate origins, so they can't share storage; once on `valosight.in` + `app.valosight.in` (same site), a shared cookie could sync it both ways. When the tutorial steps change on Riot's side, update them and the "last checked" date.
- Demo in the app: `lib/demo.ts`. The build serves `test/demo-export/Demo_Player-DEMO.zip` at `/demo/…`; `#demo` or `#demo:<page>` imports it (once) and opens it; a banner marks the demo account with "Remove demo". The landing page links to these.
- The Import page shows a danger-red "not a backup" notice (`NotABackup` in `views/Imports.tsx`): Valosight only reads exports and never stores them for the user; keep the original zip. Keep that message wherever imports happen.
- `test/demo-export/`: `Demo_Player-DEMO.zip`, a **fabricated** export (Demo Player#DEMO, EU/EUR, RFC 5737 IPs, example.com) for demos, sharing and CI, built deterministically by `make_demo_export.py` (fixed seed). CI checks the committed zip matches the script, and `export.test.ts` imports it. The generator is a standalone Python script (stdlib only), run with any `python3`. Never put real values in the generator; run its `--check-against <real export>` leak check after any change (path in CLAUDE.local.md).
- `app/src/engine/`: the engine, running in a Web Worker (originally ported from the retired Python engine): `datasets.ts`, `source.ts` (fflate), `vault.ts` (IndexedDB via `db.ts`; also backup/restore as a gzipped JSON `.valosight` file), `fx.ts`, `worker.ts` (RPC). `lib/engine-client.ts` talks to the worker. No raw-export copy is kept in the browser.
  - Tests: `engine.test.ts` (vitest + fake-indexeddb; synthetic exports: merge rules, time parsing, source limits, FX with a fake getter) and `export.test.ts` (whole-export tests on the demo player, or on a real export with `RIOTVAULT_TEST_ZIP`, read-only and hash-checked). Keep them green after any merge-rule change.
- Hosting pieces: `app/vercel.json` (build settings + security headers; its CSP is the **single source**, `vite.config.ts` copies it into a `<meta>` tag for local builds, minus `frame-ancestors`/`upgrade-insecure-requests`), `public/` (favicon, icons rendered from the logo, manifest), `pwa/sw.js` (service worker template; the vite plugin fills in the precache list and version), `src/lib/pwa.ts` (registration, `useOffline()`), `scripts/fetch-rates.mjs` (publishes ECB yearly files + latest rates to `public/rates/`, gitignored; runs in `build`). `.github/workflows/`: tests on push; daily Vercel redeploy hook to refresh rates.
- `app/`: React 19 + TypeScript + Vite 8, Tailwind v4, Recharts 3, TanStack Table **v8**, `motion` (import from `motion/react`), lucide-react. Fonts are bundled via @fontsource (Chakra Petch display, IBM Plex Sans/Mono), with no network at runtime.
  - `src/App.tsx` provider stack `SettingsProvider > MotionRoot > AccountProvider > FxProvider > Shell`. Hash routing (`#money`, …). `NAV` lists pages with a group and the datasets they `need` (hidden when missing).
  - **Top bar only, no sidebar** (removed on purpose; don't bring it back). Grid of 3: logo + wordmark on the left; centered `IconNav` (icons with gliding hover labels, group dividers); on the right `Freshness` (dot + hover card, amber when data is >30 days old), `ScopePill` (period filter, hidden on `NO_SCOPE` pages) and `AccountSwitcher` (avatar-only, at the far right, with a count badge when there are several accounts). A `ScrollProgress` bar sits under it.
  - `src/components/Footer.tsx` brand + privacy badge + "Fan-made and unofficial" disclaimer; "Where this comes from" (data files / imports / years covered); shortcuts; theme swatches. Bottom row: name + version badge (left), centered credit, Back to top. The credit stays at the true centre via `grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]`.
  - `src/components/ui.tsx` `Page` (title animation, `loading` → skeletons), `Card`, `Stat` (`extra` slot, tilt), `CountUp`, `Switch`, `Badge`, `Segmented`, `Bar`. `charts.tsx` Recharts wrappers (mount when in view). `DataTable.tsx` tables (search, sort, CSV export, expandable rows). `Ambient.tsx` background glows. `ErrorBoundary.tsx` per page (keyed by view + account).
  - `src/lib/valorant.ts` all game knowledge (dataset ids `DS`, queue names, payment-method labels, skin/battle-pass classification, weapon classes, audit labels, act calendar). Add new game knowledge here or in a sibling file, not in views.
  - `src/lib/settings.tsx` settings (stored in the vault via the API) + formatting via `Intl`. Always format dates through `useSettings().f`, never `toLocaleString`.
  - `src/lib/account.tsx` current account, period filter, `useRecords(dataset)`.
  - `src/lib/convert.tsx` money conversion (`useMoney`, `ConvertedChips`, `PaidIn`, `FxProvider`).
  - `src/lib/themes.ts`, `src/lib/motion.ts`, `src/lib/api.ts` (every engine call, through the worker client; includes `backup`, `restore`, `storage`), `fifo.ts` (VP→payment links), `network.ts`/`sessions.ts`/`incidents.ts` (security), `recovery.ts` (ownership answers).
  - Views: Overview, Money, Collection (group/sort/filter by weapon class etc.), Matches, Security, Conduct, DataBrowser (Raw data), AllAccounts, Recovery (Ownership answers), Imports, SettingsView.
  - `__APP_VERSION__` comes from package.json through Vite `define` (declared in `src/env.d.ts`).
- Build output (`app/dist/`, `home/dist/`) is not committed; Vercel builds it.
- `data/` (KsK's old vault and its converted backup) is personal data: gitignored, never commit.

## Commands

```bash
# the app with live reload → http://localhost:5174
cd app && npm run dev
# engine tests (synthetic + demo player); add RIOTVAULT_TEST_ZIP for a real export (read-only; local path in CLAUDE.local.md)
cd app && npm test
RIOTVAULT_TEST_ZIP=/path/to/export.zip npm test
# typecheck + production build → app/dist (downloads the exchange-rate files first), then serve it
cd app && npm run build && npm run preview
# the home page: dev / build → home/dist
cd home && npm run dev
cd home && npm run build
```

After an app change: build, then check it in the browser (pages load, no console errors) before calling it done.

## Rules

- Test exports are real people's only copies of their data: read-only. Never move, modify, extract into, or delete them. Extract copies only into temp dirs.
- Never commit personal data (exports, `data/`, real usernames/emails/IPs in tests or docs). Scan the diff for personal data before every commit. Machine-specific and author-specific notes go in `CLAUDE.local.md` (gitignored).
- Sources are only ever read; no copy of the export is kept.
- Dedupe semantics (covered by tests; keep them green):
  - Keyed datasets match on natural ID.
    - An export at least as new may update a record; an older one may not. "New" is measured by the watermark: the latest event in Riot's known event files, with future dates ignored.
    - Re-importing an export seen before never changes anything.
    - An export with no dates never updates.
  - A keyed ID that is blank or repeated inside one export becomes `<id>#<hash>`. `Vault._adopt` re-keys stored rows when that form changes, so they never duplicate.
  - Multiset datasets (no ID, e.g. login events) match on content + occurrence index.
    - Duplicates within one export are kept, but re-imports add nothing.
    - A spec `key` lists the identifying fields, so a field Riot adds later updates the record instead of duplicating it.
  - Records Riot later drops are never deleted. Snapshots are only stored when they change.
  - Unknown files must still import (list → multiset, object → snapshot).
- Sources are read within size limits (`source.ts`: 2 GiB total, 50k entries, compression ratio 200). Only `.json`, `.zip` and `.csv` entries are read (real exports include a `readme.csv`).
- Exchange rates (`engine/fx.ts`, `lib/convert.tsx`):
  - Opt-in via `settings.autoRates`. The app downloads them only from its own site (`/rates/…`, `fx.downloadStatic`): the same public files for everyone, published at build time by `scripts/fetch-rates.mjs` from the ECB (daily, via frankfurter.dev) and open.er-api.com (today's rate for non-ECB currencies). A daily Vercel redeploy keeps them fresh.
  - Rates are cached in `fx_daily` / `fx_latest`. `plan` checks coverage **per currency**, so a newly added one fetches its own history.
  - Display:
    - `settings.homeCurrencies` is a list of display currencies; the first is primary.
    - Each amount shows "when paid" (rate on each payment's date) vs "at today's rate", with a delta. ▲ is `text-win`, ▼ is `text-loss` (red).
    - Manual rates (`settings.fx[target][source]`) are the fallback. Legacy `homeCurrency`/`rates` are migrated by `currencySetup`.
- CSS: custom rules in `index.css` that can clash with Tailwind utilities must live in `@layer base` / `@layer components`. Unlayered CSS beats every utility; this broke `sticky`, `outline-none` and colour overrides once. Pill-shaped `label > select/input` wrappers use the `field` class for their focus ring. Cursor rules (pointer on clickables, etc.) live in `@layer base`. Buttons centre text by default, so a multi-line label inside a button needs `text-left items-start`.
- VP→payment links (`lib/fifo.ts`), Night Market regular prices, editions and inferred battle-pass names are estimates; label them as such in the UI.
- Always classify VP purchases with `classifyAllVP(records, allRecords)` (not `classifyVP` per record). It names unlabelled passes from the act calendar in `lib/valorant.ts` (`EPISODE_ACTS`, `SEASON_2025`, later years projected); update that calendar when Riot's schedule drifts.
- The ownership-answers draft is stored as annotation `recovery/draft`. Never auto-fill card numbers, PINs or PayPal IDs; the export doesn't have them.
- Themes:
  - 10 palettes are listed in `lib/themes.ts`:
    - dark: vault, abyss, viper, ember, nebula
    - light: paper, glacier, sage, sunflower, blossom
  - Colours live in `index.css` under `[data-palette="id"]`; depth/grain under `[data-theme="dark|light"]` on `<html>`.
  - Every palette must define the full colour set, including `--loss`, which is always red (losses and danger never use the brand accent).
  - `settings.theme` is a palette id, or `system`/`dark`/`light` combined with `darkTheme`/`lightTheme`.
  - Switch themes only via `setTheme(theme)`. It plays a calm 0.9 s dissolve (View Transitions: the new theme fades in over the old one; KsK rejected the circular reveal as unprofessional), with a colour cross-fade fallback, and respects reduced motion. The landing page uses the same dissolve.
- Effects (Settings → Motion & effects):
  - `spotlight` (cursor glow), `neon` (off/hover/always, a rotating conic border), `ambient`, `tilt` and `motion` (system/reduced) live in settings.
  - CSS reads them from `data-spotlight` / `data-neon` / `data-motion` on `<html>`; motion/react reads them via `MotionRoot`. Ambient glows are `components/Ambient.tsx` (transform-only).
  - Looping animations must be transform/opacity or the `--angle` conic border, and must stop under reduced motion.
- Design system (Aurora glass):
  - Tokens are in `index.css` (`--bg`, `--panel/-2/-3`, `--line`, `--accent`, `--violet`, `--info`, `--win`, `--loss`, `--shadow-1/2/3`, `--aurora-*`, `--focus`).
  - Popovers use `.pop`; cards use `.panel spot` (+ `lift` when clickable); highlighted cards use `.panel.corner` (a soft corner glow, **not** a top accent line; the author disliked the line).
  - Loading placeholders use `.skeleton`. Pass `loading` to `Page` so it shows skeletons instead of half-computed numbers.
  - Motion helpers are in `lib/motion.ts` (`useReveal`, `spotlight`, `useInView`, `lastShown`, `EASE_OUT`/`EASE_EMPH`). The app is wrapped in `MotionConfig reducedMotion`.
- React effects must use block bodies (`useEffect(() => { … })`); an expression body returning a value crashed page navigation once.
- Readability over flash:
  - Dates default to `dd-MMM-yyyy`. The clock defaults to **12-hour**, and 12h is listed first in toggles.
  - Times default to IST (`Asia/Kolkata`) but can be switched to any zone (Settings only; not in the top bar).
  - Numbers in tables use the `num` class (mono, tabular).
- The app makes no external requests: no CDNs, analytics or third-party calls (exchange rates come from the app's own site).
- The app's CSP allows `'self'` only (`connect-src 'self'`, no inline scripts, no eval). Never add third-party hosts to it; the engine fetches rates from `/rates/…` (`fx.downloadStatic`), never from the rate APIs. Any analytics must be a same-origin endpoint that stores counts only.
- The service worker caches only app files and `/rates/`; it must never cache or see user data, and never handle `/api/`.
- Git (repo is public at github.com/Shikhar16078/valosight, so the whole history is public):
  - **Never commit on your own.** Leave changes uncommitted until KsK says "commit". Then scan the changes for personal data and commit them as logical, industry-standard commits: one concern per commit (feature, fix, docs, tests, chore kept apart), an imperative summary line of 72 characters or fewer, and a body explaining what and why.
  - **Never push on your own.** Nothing goes to the remote until KsK explicitly says "push". Approval for one push doesn't cover later ones.
  - Branches: work on `develop` (Vercel preview builds); `main` is live (Vercel production) and only receives `develop` through a merge when KsK asks for a release.
