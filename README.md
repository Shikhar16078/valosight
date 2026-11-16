<div align="center">

<img src="app/public/favicon.svg" width="88" alt="Valosight logo" />

# Valosight

**Your Riot data, finally readable.**

Riot will email you everything they hold about your account. It arrives as a zip of raw JSON files.<br />
Valosight turns that zip into a private dashboard of your spending, skins, matches and account security,<br />
and it never sends the zip anywhere.

**[Open Valosight](https://valosight-app.vercel.app)** · [How privacy works](#your-data-never-leaves-your-device) · [Run it yourself](#run-it-yourself)

<sub>Fan-made and unofficial · Free · Open source</sub>

</div>

---

## What it answers

- **"How much have I actually spent on VALORANT?"** Every payment, by month and year, in the currency Riot charged you, converted into your own currencies at the rate on the day you paid *and* at today's rate.
- **"Where did all that VP go?"** Skins grouped by weapon, battle passes, bundles, Night Market buys and Radianite upgrades, with a purchase timeline.
- **"How am I really playing?"** Results by month, win rate, modes, the hours and days you play, streaks, and a calendar of every day you played.
- **"Is my account safe?"** Riot's suspicious-activity flags, password, 2FA and email changes, and every IP address that logged in, with first and last seen. Tag IPs as *mine* or *not me* to spot logins or payments that weren't you.
- **"Can I prove this account is mine?"** An ownership-answers page that gathers what Riot support asks for during account recovery (first login, first purchase, payment history) from your own data.
- **"What else is in there?"** Penalties and report counts, plus a browser for every file in the export, including games and file types Valosight has no dedicated page for yet.

Got several accounts? Import each export and switch between them from the avatar in the top-right corner. Requested a newer export? Import it too: Valosight adds only what's new and keeps everything it had, even records Riot has since stopped sending.

## Your data never leaves your device

This is the whole point, so here is exactly how it works:

- **Your zip is read in your browser.** When you choose your export, the page opens it right there on your device. It is never uploaded. There is no Valosight server that could receive it, and no database of ours that could store it.
- **Your vault lives in your browser.** The dashboard's data is saved in your browser's own storage on your device. Nobody else can read it, including us. Clear it any time from Settings, or with your browser's "clear site data".
- **Your original file is never changed.** Valosight only reads the export. It never edits, moves or deletes it.
- **No accounts, no tracking cookies.** You don't sign up, and nothing identifies you.
- **Your browser enforces it.** The site ships a strict security policy that only lets the page talk to Valosight's own address. Even if a bug tried to send your data somewhere else, the browser would block it.
- **Exchange rates come from us, not a third party.** If you turn on *automatic exchange rates* in Settings, the app downloads public rate files published on Valosight's own site. Everyone downloads the same files, so the request says nothing about you. It's off until you switch it on, and you can type rates by hand instead.

**Don't take our word for it:**

- Read the code. It's all in this repository; the import engine is in [`app/src/engine/`](app/src/engine/).
- Open your browser's developer tools, go to the **Network** tab, and import your export. You'll see no request carrying your data.
- Load the page once, turn off your Wi-Fi, then import. It still works: the app keeps a copy of itself on your device and never needs the internet for your data. The Import page tells you when it's ready to go offline.
- Look at the security policy your browser receives (developer tools → Network → the page → Response headers → `Content-Security-Policy`). It allows connections to `'self'` only.

> **Keep a backup.** Since your vault lives only in your browser, clearing your browser data deletes it. **Settings → Backup & restore** saves the whole vault as one file you can keep, or restore in another browser or on another device.

## Getting your Riot export

1. Go to Riot's support site and send a **privacy / personal-data request** ("request a copy of my data") while signed in to the account.
2. Riot emails you a download link, usually within a few days. Download the `.zip`.
3. Open **[Valosight](https://valosight-app.vercel.app)** and drop the zip in. Done.

You can also drop in the extracted folder, or a folder holding several accounts' exports at once.

## Make it yours

- **10 themes**, five dark and five light, or follow your system's dark mode
- **Any timezone**, your choice of date format, 12- or 24-hour clock
- **Several display currencies** side by side, with live or manual exchange rates
- **Motion & effects** you can dial up (glow, neon borders, ambient light, tilt) or switch off; reduced-motion settings are respected
- Every table can be **searched, sorted and exported to CSV**

## FAQ

<details>
<summary><b>Is this made by Riot?</b></summary>

No. Valosight is an independent fan project. It reads the export Riot gives you; it doesn't talk to Riot's servers, and it needs no Riot login.
</details>

<details>
<summary><b>Which games does it cover?</b></summary>

VALORANT gets the full dashboard. Account security, penalties and reports cover every Riot game. Data from League of Legends, TFT, Wild Rift, 2XKO and anything else in your export is imported and browsable on the Raw data page, so nothing is lost when dedicated pages arrive.
</details>

<details>
<summary><b>Does it work on my phone?</b></summary>

Yes. It runs in any modern browser on desktop or mobile, and you can install it like an app: **Install** in Chrome or Edge's address bar, or **Share → Add to Home Screen** on iPhone. Installed, it opens in its own window and works offline. Big exports are easier to handle on a computer.
</details>

<details>
<summary><b>What happens if I import the same export twice?</b></summary>

Nothing changes. Every record is recognised, so re-importing is always safe. An older export can never overwrite newer data either.
</details>

<details>
<summary><b>Some numbers are labelled "estimate". Why?</b></summary>

Riot's export doesn't say everything directly. Which payment funded which purchase, Night Market regular prices, and unlabelled battle-pass names are worked out from dates and amounts, and the app marks them as estimates.
</details>

## Run it yourself

Prefer not to use a website at all? You can run Valosight entirely on your own computer, from this source code.

**In your browser, from your own machine** (needs [Node.js](https://nodejs.org) 20+):

```bash
cd app
npm install
npm run build
npm run preview     # then open the address it prints
```

That's exactly the app on the website, with the same privacy: it runs in your browser and your data stays there. Load it once and it also works offline.

## For developers

```
app/                  React 19 + TypeScript + Vite, Tailwind v4, Recharts, TanStack Table, Motion
  src/engine/         the in-browser engine: zip reading, dataset rules, merge & de-duplication, IndexedDB vault
  src/views/          one file per page
  src/lib/            game knowledge (valorant.ts), settings, currency conversion, API client
  pwa/sw.js           the service worker that makes the app work offline (stores app files only)
  public/             icons and manifest; rates/ is generated at build time
  vercel.json         hosting config, including the security headers
home/                 the home page (valosight.vercel.app): static HTML, same themes as the app
test/demo-export/     the fabricated demo player and the script that builds it
```

| Command (in `app/`) | What it does |
| --- | --- |
| `npm run dev` | the app with live reload |
| `npm run build` | production build → `app/dist` (downloads the exchange-rate files first) |
| `npm run preview` | serve the production build locally |
| `npm run rates` | refresh the published exchange-rate files in `public/rates/` |
| `npm test` | engine tests on synthetic exports and the demo player, no real data needed |

You can also run the whole-export tests on your own export. It's only read, never changed:

```bash
RIOTVAULT_TEST_ZIP=/path/to/export.zip npm test
```

### How merging works

Each file in an export becomes a *dataset* (`folder/file`). Records with a natural ID (purchase ID, transaction ID, match ID) are matched on it, and a **newer** export may update them, for example a penalty that has since expired. Records without an ID, like login and security events, are matched on their content and counted, so an event that genuinely happened twice is kept twice, while importing the same export again adds nothing. Files Valosight doesn't recognise are still imported, so a game or file type Riot adds later is never lost.

---

<div align="center">

Crafted with ♥ by **King KsK**

<sub>Released under the [MIT License](LICENSE).</sub>

<sub>Valosight isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc.</sub>

</div>
