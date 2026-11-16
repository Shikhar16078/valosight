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

/** Import the demo player (or find it, if it's already here). Returns its account id. */
export async function loadDemo(existing: { id: number; username: string }[]): Promise<number> {
  const have = existing.find(isDemoAccount);
  if (have) return have.id;
  const r = await fetch(`/demo/${DEMO_FILE}`, { credentials: "omit" });
  if (!r.ok) throw new Error(`Couldn't load the demo (${r.status}).`);
  const file = new File([await r.blob()], DEMO_FILE, { type: "application/zip" });
  const [res] = await api.upload([{ name: DEMO_FILE, file }], () => {});
  return res.account_id;
}
