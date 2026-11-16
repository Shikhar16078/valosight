import { api } from "./api";

/**
 * The demo player: a fabricated export (test/demo-export, generated and leak-checked) that the web
 * build serves from its own site, so anyone can explore the app without their own Riot data.
 * Open the app at #demo (or #demo:<page>, e.g. #demo:security) to load it straight away.
 */
export const DEMO_USERNAME = "valosightdemo";
const DEMO_FILE = "Demo_Player-DEMO.zip";

export const isDemoAccount = (a: { username: string } | undefined | null) => a?.username === DEMO_USERNAME;

/** The page a #demo link asks for ("overview" unless it says #demo:<page>), or null if it isn't a demo link. */
export function demoTarget(hash = window.location.hash): string | null {
  const m = /^#demo(?::([a-z]+))?$/.exec(hash);
  return m ? m[1] || "overview" : null;
}

/**
 * Bump when the demo export is regenerated with different data. A demo imported from an older version is
 * removed and imported again (re-importing over it would add the new export's records next to the old ones).
 */
const DEMO_VERSION = "3";

/** Import the demo player (or find it, if it's already here and current). Returns its account id. */
export async function loadDemo(existing: { id: number; username: string }[]): Promise<number> {
  const have = existing.find(isDemoAccount);
  if (have) {
    // Can't tell its version (e.g. the vault is busy)? Keep it rather than risk losing it.
    const note = await api.annotations(have.id, "demo").catch(() => null);
    if (!note || note.version === DEMO_VERSION) return have.id;
  }
  // Download first, and only then replace an old demo: offline, the old one stays.
  let file: File;
  try {
    const r = await fetch(`/demo/${DEMO_FILE}`, { credentials: "omit" });
    if (!r.ok) throw new Error(`Couldn't load the demo (${r.status}).`);
    file = new File([await r.blob()], DEMO_FILE, { type: "application/zip" });
  } catch (e) {
    if (have) return have.id;
    throw e;
  }
  if (have) {
    await api.deleteAccount(have.id);
    api.clearCache();
  }
  const [res] = await api.upload([{ name: DEMO_FILE, file }], () => {});
  await api.setAnnotation(res.account_id, "demo", "version", DEMO_VERSION).catch(() => {}); // worst case: re-imported next time
  return res.account_id;
}
