import type { AccountDetail, Rec } from "./api";
import { amountPaid, classifyAllVP, isRP, money, n0, parseUpgrade, payMethod, groupUpgrades } from "./valorant";

/** One block of the response: a question with an answer, or a section heading. */
export interface RItem {
  id: string;
  kind: "q" | "section";
  question: string;
  answer: string;
  include: boolean;
  custom?: boolean;
}

export interface Suggestion {
  answer: string; // "" = nothing we can fill in
  hint?: string; // where it came from / what to check
  options?: string[]; // ready-worded quick answers shown as buttons
}

/** Common answers, offered as one-click buttons. */
const QUICK: Record<string, string[]> = {
  creator: ["I created this account myself.", "A family member created it for me.", "A friend created it for me."],
  emailAccess: ["Yes, I have access to all of these emails.", "Yes, but only to my current email.", "No, I no longer have access to the email on this account."],
  shared: ["No, nobody else has ever played on this account.", "Yes, a family member has played on it occasionally.", "Yes, a friend has played on it occasionally."],
  lostAccess: [
    "I still have access — I'm only verifying that I own this account.",
    "My account was compromised: someone changed my password and/or email without my permission.",
    "I forgot my password and can no longer reach the email on the account.",
  ],
  sms: ["I have never paid by SMS or mobile carrier billing."],
  paysafe: ["I did not use PaySafe cards."],
  paypalEmail: ["I did not use PayPal."],
  paypalIds: ["I don't have the PayPal transaction IDs."],
  cards: ["I have not used a credit or debit card."],
  prepaid: ["I did not use prepaid cards."],
};

export interface RecoveryData {
  detail: AccountDetail | null;
  info: Record<string, any>;
  phoneMasked: string | null;
  payments: Rec[];
  store: Rec[];
  matches: Rec[];
  logins: Rec[];
  audit: Rec[];
  ipTags: Record<string, string>;
}

/** Riot's ownership questionnaire (support form wording). */
export const TEMPLATE: { id: string; kind?: "section"; q: string }[] = [
  { id: "username", q: "Username (login name):" },
  { id: "riotId", q: 'What is your full Riot ID (previously "Summoner Name"), including your tag (Ex: RiotGames # NA1):' },
  { id: "shard", q: "Shard you play on (NA, EU, etc.):" },
  { id: "email", q: "Your current email address:" },
  { id: "ipv4", q: "Your current IPv4 address (Use https://www.whatismyip.com/ to find your IP address):" },
  { id: "creator", q: "Who made this account?" },
  { id: "allEmails", q: "All possible emails used on this account (take a couple of guesses!):" },
  { id: "emailAccess", q: "Do you have access to these emails?" },
  { id: "created", q: "Creation date of the account (Ex. AUG 20 2019):" },
  { id: "createdWhere", q: "Location where the account was created (City, Country):" },
  { id: "birthday", q: "Birthday on the account (Ex. DEC 21 1990):" },
  { id: "shared", q: "Has anyone else ever played on the account (including friends/family)?" },
  { id: "products", q: "Name any additional Riot products you play on this account." },
  { id: "lostAccess", q: "How did you lose access to this account? When was the last time you had access to the account?" },
  { id: "purchases", kind: "section", q: "If you've ever bought any in game currency (RP/VP/Coins etc.), please try to answer the questions below." },
  { id: "firstSpend", q: "What was the first thing you spent it on, be specific:" },
  { id: "paypalEmail", q: "Email address linked to PayPal account (if you had used multiple PayPal accounts, please add these email addresses as well):" },
  { id: "paypalIds", q: "Unique PayPal transaction IDs associated with purchase(s):" },
  { id: "sms", q: "Phone number, mobile provider, and country used for SMS transactions:" },
  { id: "paysafe", q: "Any PaySafe Card PIN/Transaction IDs:" },
  { id: "cards", q: "First 6 and last 4 digits of any credit cards used:" },
  { id: "prepaid", q: "RP card PIN numbers:" },
  { id: "txIds", q: "Any transaction or confirmation numbers received via email for this account:" },
  { id: "bonus", q: "BONUS: Please provide any other context you have for the account:" },
];

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
/** Riot's example format: "AUG 20 2019" (UTC, as Riot records it). */
export function riotDate(iso?: string | null): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${MON[+m[2] - 1]} ${m[3]} ${m[1]}` : "";
}

const SHARD: Record<string, string> = { ap: "AP (Asia-Pacific)", na: "NA (North America)", eu: "EU (Europe)", kr: "KR (Korea)", latam: "LATAM", br: "BR (Brazil)", pbe: "PBE" };
const PRODUCT: Record<string, string> = {
  valorant: "VALORANT",
  leagueoflegends: "League of Legends",
  teamfighttactics: "Teamfight Tactics",
  legendsofruneterra: "Legends of Runeterra",
  wildrift: "League of Legends: Wild Rift",
  "2xko": "2XKO",
};

const isV4 = (ip?: string) => !!ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip);

export function suggest(d: RecoveryData): Record<string, Suggestion> {
  const s: Record<string, Suggestion> = {};
  const info = d.info ?? {};
  const pays = [...d.payments].sort((a, b) => (a._t ?? "").localeCompare(b._t ?? ""));
  const vp = classifyAllVP(d.store).filter((x) => x.t).sort((a, b) => a.t.localeCompare(b.t));
  const logins = d.logins;
  const created = d.audit.find((r) => r.event_type === "CREATED")?._t ?? d.detail?.datasets.map((x) => x.first).filter(Boolean).sort()[0] ?? null;

  s.username = { answer: info.username ?? "", hint: "From account_info in your export" };
  s.riotId = { answer: info.game_name ? `${info.game_name} # ${info.tagline ?? ""}`.trim() : "", hint: "Riot ID as of your latest export — if you changed it, add older ones too" };

  const realms = [...new Set(d.matches.map((m) => String(m.realm_id ?? "").toLowerCase()).filter(Boolean))];
  s.shard = { answer: realms.map((r) => SHARD[r] ?? r.toUpperCase()).join(", "), hint: realms.length ? "From the server on your match history" : "No match history to tell the shard" };

  s.email = { answer: info.email ?? "", hint: "Email on the account at the time of your export" };

  const v4 = [...logins].reverse().filter((l) => isV4(l.ip_address));
  const mine = v4.find((l) => d.ipTags[l.ip_address] === "mine");
  const lastV4 = mine ?? v4[0];
  s.ipv4 = {
    answer: "",
    hint: lastV4
      ? `Check whatismyip.com for your IP right now. Last IPv4 in your export${mine ? " that you tagged as yours" : ""}: ${lastV4.ip_address} (${riotDate(lastV4._t)})`
      : "Check whatismyip.com for your IP right now",
  };

  s.creator = { answer: "I created this account myself.", hint: "Pick the option that fits, or write your own" };

  const emailChanges = d.audit.filter((r) => r.event_type === "USER_FIELD_CHANGED" && /email/i.test(r.description ?? "") && r.description !== "emailStatus");
  s.allEmails = {
    answer: info.email ?? "",
    hint: emailChanges.length
      ? `Your export shows the email address was changed on ${emailChanges.map((r) => riotDate(r._t)).join(", ")} — add the address(es) used before that`
      : "Add any other address you might have signed up with",
  };
  s.emailAccess = { answer: "", hint: "Yes / no for each email above" };

  s.created = { answer: riotDate(created), hint: created ? "Account creation event in your export (UTC date)" : "Not in your export" };

  const firstLogin = logins.find((l) => l.ip_address && l.ip_address !== "Unknown");
  s.createdWhere = { answer: "", hint: firstLogin ? `First login IP in your export: ${firstLogin.ip_address} (${riotDate(firstLogin._t)}). Write the city and country you were in.` : "Write the city and country you were in" };

  s.birthday = { answer: riotDate(info.date_of_birth), hint: "Date of birth on the account" };
  s.shared = { answer: "", hint: "Be honest — Riot can see logins from other places" };

  const prods = [...new Set((d.detail?.datasets ?? []).filter((x) => x.mode !== "snapshot" && x.count > 0).map((x) => PRODUCT[x.dataset.split("/")[0]]).filter(Boolean))];
  s.products = { answer: prods.join(", "), hint: "Games with activity in your export" };

  const lastLogin = [...logins].reverse().find((l) => /login|authentication|connected/i.test(l.event_type ?? ""));
  s.lostAccess = { answer: "", hint: lastLogin ? `Latest activity in your export: ${riotDate(lastLogin._t)} from ${lastLogin.ip_address}` : "Describe what happened and when" };

  s.purchases = { answer: "" };
  const firstPay = pays[0];
  const firstItem = vp.find((x) => x.category !== "Unknown");
  const parts: string[] = [];
  if (firstItem) parts.push(`${firstItem.category === "Battle Pass" ? `${firstItem.pass} battle pass` : firstItem.name} for ${n0(firstItem.cost)} VP on ${riotDate(firstItem.t)}`);
  if (firstPay) parts.push(`(my first VP purchase was ${n0(firstPay.game_currency_granted)} VP for ${money(amountPaid(firstPay), firstPay.currency_code, 2)} via ${payMethod(firstPay.payment_method)} on ${riotDate(firstPay._t)})`);
  s.firstSpend = { answer: parts.join(" "), hint: "Earliest VP purchase and top-up in your export" };

  const pp = pays.filter((p) => /paypal/i.test(p.payment_method ?? ""));
  s.paypalEmail = { answer: pp.length ? "" : "I did not use PayPal.", hint: pp.length ? `PayPal was used ${pp.length}× (${pp.map((p) => riotDate(p._t)).join(", ")}) — add the PayPal email` : "No PayPal payments in your export" };
  s.paypalIds = {
    answer: "",
    hint: pp.length ? `Riot's export doesn't include PayPal IDs — find these in PayPal activity: ${pp.map((p) => `${riotDate(p._t)} ${money(amountPaid(p), p.currency_code, 2)}`).join("; ")}` : "No PayPal payments in your export",
  };

  s.sms = { answer: "", hint: d.phoneMasked ? `Riot has a phone on file (${d.phoneMasked}) — only answer if you paid by SMS / carrier billing` : "Only if you paid by SMS / carrier billing" };

  const ps = pays.filter((p) => /paysafe/i.test(p.payment_method ?? ""));
  s.paysafe = { answer: ps.length ? "" : "I did not use PaySafe cards.", hint: ps.length ? `Paysafecard used ${ps.length}× — add PINs/IDs if you have them` : "No Paysafecard payments in your export" };

  const cards = pays.filter((p) => /card|adyen/i.test(p.payment_method ?? ""));
  s.cards = {
    answer: "",
    hint: cards.length
      ? `${cards.length} card/processor payments between ${riotDate(cards[0]._t)} and ${riotDate(cards[cards.length - 1]._t)} — copy first 6 / last 4 digits from your card or bank statement`
      : "No card payments in your export",
  };

  const prepaid = pays.filter((p) => /prepaid|giftcard|gift card|rp card|vp card|razer|codapay/i.test(p.payment_method ?? ""));
  s.prepaid = { answer: prepaid.length ? "" : "I did not use prepaid cards.", hint: prepaid.length ? `${prepaid.length} prepaid/gift payments in your export` : "No prepaid card payments in your export" };

  s.txIds = {
    answer: pays.map((p) => `${p.player_facing_purchase_id} — ${riotDate(p._t)} — ${money(amountPaid(p), p.currency_code, 2)} (${n0(p.game_currency_granted)} ${p.game_currency_type ?? "VP"})`).join("\n"),
    hint: pays.length ? `All ${pays.length} purchase IDs from your export (these match Riot's receipt emails)` : "No payments in your export",
  };

  const matches = d.matches.filter((m) => m._t);
  const ups = groupUpgrades(d.store.filter(isRP).map(parseUpgrade));
  ups.delete("Unknown skin");
  const skins = new Set([...vp.filter((x) => x.category === "Skin").map((x) => x.name), ...ups.keys()]);
  const byCur = new Map<string, number>();
  for (const p of pays) byCur.set(p.currency_code, (byCur.get(p.currency_code) ?? 0) + amountPaid(p));
  const favs = vp.filter((x) => x.category === "Skin").sort((a, b) => b.cost - a.cost).slice(0, 5).map((x) => x.name);
  const bonus: string[] = [];
  if (created) bonus.push(`Account created ${riotDate(created)}.`);
  if (matches.length) bonus.push(`I have played ${n0(matches.length)} VALORANT matches between ${riotDate(matches[0]._t)} and ${riotDate(matches[matches.length - 1]._t)}.`);
  if (pays.length) bonus.push(`I made ${pays.length} purchases totalling ${[...byCur].map(([c, v]) => money(v, c, 2)).join(" + ")}, using ${[...new Set(pays.map((p) => payMethod(p.payment_method).replace(/\s*\(method not specified\)/, "")))].join(", ")}.`);
  if (skins.size) bonus.push(`I own ${skins.size} skins, including ${favs.join(", ")}.`);
  s.bonus = { answer: bonus.join(" "), hint: "Summary written from your export — edit freely" };
  // "I didn't use X" only makes sense when the export shows X was never used
  const usedMethod: Record<string, boolean> = { paypalEmail: pp.length > 0, paysafe: ps.length > 0, cards: cards.length > 0, prepaid: prepaid.length > 0 };
  for (const [id, opts] of Object.entries(QUICK)) {
    const list = usedMethod[id] ? opts.filter((o) => !/^I (did not|have not) use/.test(o)) : opts;
    if (list.length) s[id] = { ...(s[id] ?? { answer: "" }), options: list };
  }
  return s;
}

/** Fresh list of items, answers pre-filled from suggestions. */
export function freshItems(sug: Record<string, Suggestion>): RItem[] {
  return TEMPLATE.map((t) => ({ id: t.id, kind: t.kind ?? "q", question: t.q, answer: sug[t.id]?.answer ?? "", include: true }));
}

export function renderText(items: RItem[], opts: { numbered: boolean; skipEmpty: boolean; title: string }): string {
  const out: string[] = [];
  if (opts.title.trim()) out.push(opts.title.trim(), "");
  let n = 0;
  for (const it of items) {
    if (!it.include) continue;
    if (it.kind === "section") {
      out.push(it.question.trim(), "");
      continue;
    }
    const a = it.answer.trim();
    if (!a && opts.skipEmpty) continue;
    n++;
    const q = opts.numbered ? `${n}. ${it.question.trim()}` : it.question.trim();
    const pad = opts.numbered ? "   " : "";
    out.push(q, ...(a ? a.split("\n").map((l) => pad + l) : [pad + "(not provided)"]), "");
  }
  return out.join("\n").trimEnd() + "\n";
}
