/**
 * The skin catalogue (lib/skins.ts): resolving purchase names as Riot writes them, collection and bundle
 * lookups, and battle-pass naming from Riot's act calendar. Uses a small made-up catalogue (the real one is
 * published at build time and isn't in the repo).
 */
import { afterEach, describe, expect, it } from "vitest";
import { buildCatalog } from "./skins";
import { buildAccessories } from "./accessories";
import { classifyAllVP, setOfficialActs } from "./valorant";

const U = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const cat = buildCatalog({
  version: "test",
  tiers: [{ name: "Premium", rank: 2, color: "#d1548d", icon: null }],
  skins: [
    ["Reaver Odin", "Odin", 0, U(100), U(1), ["", "VFX", "Animation", "Finisher"], [["", U(10), 3], ["Variant 1 Red", U(11), 3], ["Variant 2 Black", U(12), 3]]],
    ["Nocturnum Classic", "Classic", 0, U(101), null, ["", "VFX", "", "KillBanner"], [["", U(20), 1]]],
  ],
  themes: { [U(100)]: "Reaver" },
  acts: [["S2026A1", "2026-01-07"], ["S2026A2", "2026-05-01"]],
  bundles: [["Flower", U(30)]],
  passCards: [["S2026A5", U(40)]],
  currencies: [["Kingdom Credits", U(50)], ["Agent Tokens", U(51)]],
});

describe("skin catalogue", () => {
  it("resolves names as they appear in exports", () => {
    expect(cat.find("Reaver Odin")?.skin.weapon).toBe("Odin");
    expect(cat.find("reaver  odin LEVEL 3")?.level).toBe(3);
    const v = cat.find("Reaver Odin Level 4\r\n(Variant 2 Black)");
    expect(v?.chroma?.label).toBe("Variant 2 Black");
    expect(v?.image).toBe(`/media/weaponskinchromas/${U(12)}/fullrender.png`);
    // Riot sometimes cuts the name off, and some levels carry a description.
    expect(cat.find("Reaver Odin Level 4\n(Variant 2 Bl")?.chroma?.label).toBe("Variant 2 Black");
    expect(cat.find("Nocturnum Classic Level 4 Kill Banner")?.level).toBe(4);
    expect(cat.find("Revive Me, Jett! Spray")).toBeNull();
    expect(cat.find("")).toBeNull();
  });

  it("prefers the base variant's render over the skin icon", () => {
    expect(cat.find("Reaver Odin")?.image).toBe(`/media/weaponskinchromas/${U(10)}/fullrender.png`);
    expect(cat.find("Reaver Odin")?.skin.edition?.name).toBe("Premium");
  });

  it("names collections and finds bundle art", () => {
    expect(cat.themeName(cat.find("Reaver Odin")?.skin.theme)).toBe("Reaver");
    expect(cat.themeName(null)).toBeNull();
    expect(cat.findBundle("Flower Bundle")?.image).toBe(`/media/bundles/${U(30)}/displayicon.png`);
    expect(cat.findBundle("Nope Bundle")).toBeNull();
    expect(cat.passImage("S2026A5")).toBe(`/media/playercards/${U(40)}/wideart.png`);
    expect(cat.passImage("E1A1")).toBeNull();
    // Purchase files and the game data name currencies differently.
    expect(cat.currencyIcon("Kingdom Credits")).toBe(`/media/currencies/${U(50)}/displayicon.png`);
    expect(cat.currencyIcon("Character Recruitment Token")).toBe(`/media/currencies/${U(51)}/displayicon.png`);
    expect(cat.currencyIcon("Gold")).toBeNull();
  });
});

describe("battle passes and Riot's act calendar", () => {
  afterEach(() => setOfficialActs([]));
  // An unnamed 1,000 VP pass bought on 1 April 2026: the projected calendar puts Act 2 in early March,
  // Riot's (here) starts it in May, so the two disagree.
  const pass = { _t: "2026-04-01T12:00:00Z", transaction_id: "t1", item_type: "BP Bundle", item_name: "Assorted BP Items", transaction_source: "", spent_currency_name: "Valorant Points", spent_currency_amount: 1000 };

  it("uses the official act dates when the catalogue has them", () => {
    expect(classifyAllVP([pass])[0].pass).toMatch(/Season 2026 · Act 2/);
    setOfficialActs(cat.acts);
    expect(classifyAllVP([pass])[0].pass).toMatch(/Season 2026 · Act 1/);
  });
});

describe("accessories", () => {
  it("finds sprays, buddies, cards and flex by the names Riot writes", () => {
    const a = buildAccessories({ s: [["Revive Me, Jett! Spray", U(60), 1]], b: [["Gourmand Buddy", U(61)]], c: [["Combo Crew Card", U(62)]], f: [["Bolt Prism Flex", U(63)]] });
    expect(a.image("revive me,  jett! spray")).toBe(`/media/sprays/${U(60)}/fulltransparenticon.png`);
    expect(a.image("Gourmand Buddy")).toBe(`/media/buddylevels/${U(61)}/displayicon.png`);
    expect(a.image("Combo Crew Card")).toBe(`/media/playercards/${U(62)}/largeart.png`);
    expect(a.image("Bolt Prism Flex")).toBe(`/media/flex/${U(63)}/displayicon.png`);
    expect(a.image("Agent gear item")).toBeNull();
  });
});
