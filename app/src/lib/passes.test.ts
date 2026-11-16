/** Battle-pass contents (lib/passes.ts): levels numbered across chapters, free rewards, pictures, cover. */
import { describe, expect, it } from "vitest";
import { buildPasses } from "./passes";

const U = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

describe("battle passes", () => {
  const passes = buildPasses({
    S2026A5: [
      "Season 2026 // Act V",
      [
        [0, [["s", "Gourmand Bandit", U(1)], ["b", "Gourmand Buddy", U(2)], ["r", "RADIANITE Points", U(3)]], [["t", "Left No Crumbs", null]]],
        [0, [["c", "Combo Crew Card", U(4)], ["s", "Verdant Cafe Stinger", U(5)]], []],
        [1, [["x", "Totem", null], ["p", "Snack Spray", U(6)]], []],
      ],
    ],
  });
  const p = passes.get("S2026A5")!;

  it("numbers levels across chapters and keeps free rewards apart", () => {
    expect(p.levels).toBe(7);
    expect(p.chapters.map((c) => [c.from, c.to, c.epilogue])).toEqual([[1, 3, false], [4, 5, false], [6, 7, true]]);
    expect(p.chapters[0].rewards.at(-1)).toMatchObject({ kind: "title", level: null, free: true, image: null });
    expect(p.chapters[1].rewards[1]).toMatchObject({ kind: "skin", level: 5 });
  });

  it("builds pictures on our own site", () => {
    expect(p.chapters[0].rewards[1].image).toBe(`/media/buddylevels/${U(2)}/displayicon.png`);
    expect(p.chapters[0].rewards[2].name).toBe("Radianite Points");
    expect(p.chapters[2].rewards[0].image).toBeNull();
  });
});
