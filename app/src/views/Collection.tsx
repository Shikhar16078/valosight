import { motion } from "motion/react";
import { useDateGuard } from "../lib/privacy-dates";
import { Sens, usePrivacy } from "../lib/privacy";
import { ChevronDown, ChevronsUpDown, Search, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAccount, useRecords } from "../lib/account";
import { localParts, useSettings } from "../lib/settings";
import { allocateVP } from "../lib/fifo";
import { useMoney } from "../lib/convert";
import { DS, EDITIONS, WEAPON_CLASSES, WEAPON_ORDER, weaponClass, classifyOther, editionOf, money, nightMarketBase, classifyAllVP, currencyUnit, groupUpgrades, isRP, isVP, n0, parseUpgrade, upgradeLabel, type SkinUpgrades, type Upgrade, type VPItem, VP_GROUPS } from "../lib/valorant";
import { Badge, Card, Chip, Empty, Page, Segmented, Stat, item } from "../components/ui";
import { DataTable, type Col, type Facet, type Preset } from "../components/DataTable";
import { Drawer } from "../components/Drawer";
import { Collapse, SOFT_CSS, Swap, useDebounced } from "../components/anim";
import { scrollToSection, useIntent } from "../lib/focus";
import { spotlight } from "../lib/motion";

type GroupBy = "class" | "weapon" | "edition" | "source" | "year";
type SortBy = "newest" | "oldest" | "price" | "name";
const GROUPS: { value: GroupBy; label: string }[] = [
  { value: "class", label: "Weapon type" },
  { value: "weapon", label: "Weapon (most skins first)" },
  { value: "edition", label: "Edition" },
  { value: "source", label: "Where bought" },
  { value: "year", label: "Year bought" },
];
const SORTS: { value: SortBy; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "price", label: "Price, high to low" },
  { value: "name", label: "Name, A–Z" },
];
type TlKind = "vp" | "rp" | "other";
const TL_KINDS: { value: TlKind; label: string }[] = [
  { value: "vp", label: "VP purchases" },
  { value: "rp", label: "Radianite upgrades" },
  { value: "other", label: "Other purchases" },
];
type TlEntry = { key: string; t: string; kind: TlKind; dot: string; title: string; detail: string; cost: string };
const SOURCES = ["Store", "Night Market", "Bundle"];
const PREFS_KEY = "riotvault.collection";

/** Position in a known order; unknown values ("—", a weapon Riot adds later) go last. */
const rank = (list: readonly string[], v: string) => (list.includes(v) ? list.indexOf(v) : list.length);

const sourceOf = (where: string) => (where === "Night Market" ? "Night Market" : where.startsWith("Bundle") || where === "Full Bundle" ? "Bundle" : "Store");

function loadPrefs(): { group: GroupBy; sort: SortBy } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    return { group: GROUPS.some((g) => g.value === p.group) ? p.group : "class", sort: SORTS.some((x) => x.value === p.sort) ? p.sort : "newest" };
  } catch {
    return { group: "class", sort: "newest" };
  }
}

const whereTone = (w: string) => (w === "Night Market" ? "win" : w.startsWith("Bundle") || w === "Full Bundle" ? "info" : "neutral") as "win" | "info" | "neutral";

export function Collection() {
  const { has } = useAccount();
  const { f, settings } = useSettings();
  const pv = usePrivacy();
  const guard = useDateGuard();
  const store = useRecords(DS.store);
  const storeAll = useRecords(DS.store, false);
  const payAll = useRecords(DS.payments, false);
  const m$ = useMoney();
  // real-money estimate per VP purchase, from the oldest top-up that still had VP
  const realCost = useMemo(() => {
    const fifo = allocateVP(payAll.all, storeAll.all);
    const m = new Map<string, { money: number; cur: string; partial: boolean }>();
    for (const [item, allocs] of fifo.byItem) {
      const paid = allocs.filter((a) => a.payment);
      m.set(item.r.transaction_id, { money: paid.reduce((a, x) => a + x.money, 0), cur: paid[0]?.payment?.currency_code ?? "", partial: paid.length < allocs.length });
    }
    return m;
  }, [payAll.all, storeAll.all]);
  const [view, setView] = useState<"weapon" | "timeline">("weapon");
  const [passesOpen, setPassesOpen] = useState(false);
  /** Skins drawer: every skin ("") or one weapon's; null = closed. */
  const [skinList, setSkinList] = useState<string | null>(null);
  const [vpPreset, setVpPreset] = useState<Preset<VPItem> | null>(null);
  const [otherCur, setOtherCur] = useState<string | null>(null);
  const [upView, setUpView] = useState<"skin" | "all">("skin");

  const vp = useMemo(() => classifyAllVP(store.data, storeAll.all), [store.data, storeAll.all]);
  // Memoized: editionById and the table facets depend on these, and a new list each render would reset the tables.
  const skins = useMemo(() => vp.filter((x) => x.category === "Skin"), [vp]);
  const passes = useMemo(() => vp.filter((x) => x.category === "Battle Pass"), [vp]);
  const bundles = useMemo(() => vp.filter((x) => x.category === "Bundle"), [vp]);
  const upgrades = useMemo<Upgrade[]>(() => store.data.filter(isRP).map(parseUpgrade), [store.data]);
  const upBySkin = useMemo(() => groupUpgrades(upgrades), [upgrades]);
  const rpSpent = upgrades.reduce((a, u) => a + u.cost, 0);
  const owned = useMemo(() => new Set(vp.map((x) => x.name)), [vp]);
  const editions = useMemo(() => {
    const order = ["Select", "Deluxe", "Premium", "Exclusive", "Ultra", "Melee"];
    const m = new Map<string, { n: number; vp: number }>();
    for (const s of skins) {
      const e = editionOf(s.where === "Night Market" ? nightMarketBase(s, skins).base : s.cost, s.weapon);
      const x = m.get(e) ?? { n: 0, vp: 0 };
      x.n++;
      x.vp += s.cost;
      m.set(e, x);
    }
    return order.filter((o) => m.has(o)).map((o) => [o, m.get(o)!] as const);
  }, [skins]);
  const nightMarket = useMemo(
    () =>
      skins
        .filter((s) => s.where === "Night Market")
        .map((s) => {
          const { base, how } = nightMarketBase(s, skins);
          return { s, base, how, saved: base - s.cost };
        }),
    [skins],
  );
  const upRows = useMemo(() => [...upBySkin.values()].sort((a, b) => b.last.localeCompare(a.last)), [upBySkin]);

  const byWeapon = useMemo(() => {
    const m = new Map<string, VPItem[]>();
    for (const s of skins) m.set(s.weapon, [...(m.get(s.weapon) ?? []), s]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length || WEAPON_ORDER.indexOf(a[0]) - WEAPON_ORDER.indexOf(b[0]));
  }, [skins]);

  // Weapon view: group / sort / filter (group and sort are remembered in this browser)
  const [prefs, setPrefs] = useState(loadPrefs);
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* private mode: just don't remember */
    }
  }, [prefs]);
  const [q, setQ] = useState("");
  const [eds, setEds] = useState<Set<string>>(new Set());
  const [srcs, setSrcs] = useState<Set<string>>(new Set());
  const [upgradedOnly, setUpgradedOnly] = useState(false);
  const toggle = (set: Set<string>, v: string) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    return n;
  };
  const filtersOn = !!q.trim() || eds.size > 0 || srcs.size > 0 || upgradedOnly;
  const clearFilters = () => {
    setQ("");
    setEds(new Set());
    setSrcs(new Set());
    setUpgradedOnly(false);
  };

  // Groups start folded (a compact overview of counts and VP); a search or filter opens everything so
  // matches are visible.
  // Each group keeps its own open state (so a click re-renders only that group, not the whole page);
  // "Expand all / Collapse all" and turning filters on/off send every group a new `bulk` command.
  const [bulk, setBulk] = useState({ open: false, n: 0 });
  const openAll = useRef(false); // set by the Skins card: clearing filters should then open, not fold
  useEffect(() => {
    setBulk((b) => ({ open: filtersOn || openAll.current, n: b.n + 1 }));
    openAll.current = false;
  }, [filtersOn]);

  /** Card clicks: open the skins grid (weapon view), optionally filtered, and scroll to it. */
  const showSkins = (f: { q?: string; eds?: string[]; srcs?: string[] } = {}) => {
    setView("weapon");
    setQ(f.q ?? "");
    setEds(new Set(f.eds ?? []));
    setSrcs(new Set(f.srcs ?? []));
    setUpgradedOnly(false);
    if (!f.q && !f.eds && !f.srcs) {
      openAll.current = true;
      setBulk((b) => ({ open: true, n: b.n + 1 }));
    }
    scrollToSection("skins");
  };
  // From the Money page: "VP spent" and the "Where your VP went" slices land on All VP purchases.
  useIntent("collection", !store.loading && !storeAll.loading, (i) => {
    // From Overview: the skins grid (all, or one skin) and the battle-pass list.
    if (i.filter === "all") return setSkinList("");
    if (i.filter === "skin" && i.value) return showSkins({ q: i.value });
    if (i.filter === "passes") return setPassesOpen(true);
    const g = i.filter === "category" ? VP_GROUPS.find((x) => x.key === i.value) : undefined;
    setVpPreset(g ? { label: g.label, test: (r) => r.category === g.category } : null);
  });

  const editionById = useMemo(() => {
    const m = new Map<VPItem, string>();
    for (const s of skins) m.set(s, editionOf(s.where === "Night Market" ? nightMarketBase(s, skins).base : s.cost, s.weapon));
    for (const b of bundles) m.set(b, "Bundle");
    return m;
  }, [skins, bundles]);

  const dq = useDebounced(q);
  const shown = useMemo(() => {
    const needle = dq.trim().toLowerCase();
    const list = [...skins, ...bundles].filter(
      (s) =>
        (!needle || s.name.toLowerCase().includes(needle) || s.weapon.toLowerCase().includes(needle)) &&
        (!eds.size || eds.has(editionById.get(s) ?? "")) &&
        (!srcs.size || srcs.has(sourceOf(s.where))) &&
        (!upgradedOnly || upBySkin.has(s.name)),
    );
    const cmp: Record<SortBy, (a: VPItem, b: VPItem) => number> = {
      newest: (a, b) => (b.t ?? "").localeCompare(a.t ?? ""),
      oldest: (a, b) => (a.t ?? "").localeCompare(b.t ?? ""),
      price: (a, b) => b.cost - a.cost || (b.t ?? "").localeCompare(a.t ?? ""),
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return list.sort(cmp[prefs.sort]);
  }, [skins, bundles, dq, eds, srcs, upgradedOnly, editionById, upBySkin, prefs.sort]);

  /** Sections (only for "Weapon type") each holding cards; other groupings are one untitled section. */
  const sections = useMemo(() => {
    const bucket = (key: (s: VPItem) => string) => {
      const m = new Map<string, VPItem[]>();
      for (const s of shown) m.set(key(s), [...(m.get(key(s)) ?? []), s]);
      return m;
    };
    const ordered = (m: Map<string, VPItem[]>, order: string[]) =>
      [...m.entries()].sort((a, b) => (order.indexOf(a[0]) + 1 || 999) - (order.indexOf(b[0]) + 1 || 999));
    const g = prefs.group;
    if (g === "class") {
      const byW = bucket((s) => s.weapon);
      return WEAPON_CLASSES.map((c) => ({ title: c.name, cards: ordered(new Map([...byW].filter(([w]) => weaponClass(w) === c.name)), WEAPON_ORDER) })).filter((x) => x.cards.length);
    }
    const cards =
      g === "weapon"
        ? [...bucket((s) => s.weapon).entries()].sort((a, b) => b[1].length - a[1].length || WEAPON_ORDER.indexOf(a[0]) - WEAPON_ORDER.indexOf(b[0]))
        : g === "edition"
          ? ordered(bucket((s) => editionById.get(s) ?? "Unknown"), [...EDITIONS, "Bundle"])
          : g === "source"
            ? ordered(bucket((s) => sourceOf(s.where)), SOURCES)
            : [...bucket((s) => String(s.t ? localParts(s.t, settings.tz).y : "Unknown")).entries()].sort((a, b) => b[0].localeCompare(a[0]));
    return [{ title: "", cards }];
  }, [shown, prefs.group, editionById, settings.tz]);

  const renderTile = useCallback(
    (s: VPItem) => (
      <SkinTile
        key={s.r.transaction_id}
        s={s}
        sub={[prefs.group !== "weapon" && prefs.group !== "class" && s.category === "Skin" ? s.weapon : null, prefs.group !== "edition" && editionById.get(s) !== "Bundle" ? editionById.get(s) : null, prefs.group === "year" || prefs.group === "source" ? null : guard(s.t, f.date(s.t))].filter(Boolean).join(" · ")}
        date={prefs.group === "year" || prefs.group === "source" ? guard(s.t, f.date(s.t)) : null}
        where={prefs.group !== "source" && s.where !== "Daily Store" ? s.where.replace(" (single item)", "") : null}
        badge={<UpgradeBadge u={upBySkin.get(s.name)} />}
      />
    ),
    [prefs.group, editionById, upBySkin, f, guard],
  );

  /** One flat list of groups, each a header plus its skins (weapon type keeps weapons together inside a class). */
  const groups = useMemo(
    () => (prefs.group === "class" ? sections.map((sec) => ({ title: sec.title, items: sec.cards.flatMap(([, l]) => l), parts: sec.cards })) : sections[0].cards.map(([title, items]) => ({ title, items, parts: undefined as [string, VPItem[]][] | undefined }))),
    [sections, prefs.group],
  );

  const other = useMemo(() => store.data.filter((r) => !isVP(r) && !isRP(r)).map(classifyOther).reverse(), [store.data]);
  const otherTotals = useMemo(() => {
    const m = new Map<string, { n: number; spent: number }>();
    for (const o of other) {
      const e = m.get(o.currency) ?? { n: 0, spent: 0 };
      e.n++;
      e.spent += o.cost;
      m.set(o.currency, e);
    }
    return [...m.entries()].sort((a, b) => b[1].spent - a[1].spent);
  }, [other]);

  // Timeline: VP purchases, Radianite upgrades and other purchases together, newest first, per year.
  // A skin's upgrades on the same day are one entry ("Level 2 → 4 · 2 variants") so the list stays short.
  const [tlKinds, setTlKinds] = useState<Set<TlKind>>(new Set(TL_KINDS.map((k) => k.value)));
  const timeline = useMemo(() => {
    const out: TlEntry[] = [];
    for (const s of vp)
      out.push({ key: s.r.transaction_id, t: s.t, kind: "vp", dot: s.category === "Skin" ? "bg-accent" : s.category === "Battle Pass" ? "bg-warn" : "bg-info", title: (s.category === "Battle Pass" ? s.pass : s.name) ?? s.name, detail: s.category === "Skin" ? s.weapon : s.category, cost: `${n0(s.cost)} VP` });
    const days = new Map<string, Upgrade[]>();
    for (const u of upgrades) {
      const k = `${f.dayKey(u.t)} ${u.skin}`;
      days.set(k, [...(days.get(k) ?? []), u]);
    }
    for (const [k, list] of days) {
      const levels = [...new Set(list.filter((u) => !u.variant).map((u) => u.level).filter((x): x is number => x != null))].sort((a, b) => a - b);
      const variants = list.filter((u) => u.variant).length;
      const parts = [levels.length > 1 ? `Level ${levels[0]} → ${levels[levels.length - 1]}` : levels.length ? `Level ${levels[0]}` : "", variants ? `${variants} variant${variants === 1 ? "" : "s"}` : ""].filter(Boolean);
      const skin = list[0].skin === "Unknown skin" ? "Unknown skin (not recorded)" : list[0].skin;
      out.push({ key: `rp ${k}`, t: list[list.length - 1].t, kind: "rp", dot: "bg-win", title: skin, detail: parts.join(" · ") || "Radianite upgrade", cost: `${n0(list.reduce((a, u) => a + u.cost, 0))} RP` });
    }
    for (const o of other) {
      const u = currencyUnit(o.currency);
      out.push({ key: o.r.transaction_id, t: o.t, kind: "other", dot: "bg-faint", title: o.name, detail: o.kind, cost: `${n0(o.cost)} ${u.short === "token" ? (o.cost === 1 ? "token" : "tokens") : u.short}` });
    }
    const m = new Map<number, TlEntry[]>();
    for (const e of out.filter((x) => x.t && tlKinds.has(x.kind)).sort((a, b) => b.t.localeCompare(a.t))) {
      const y = localParts(e.t, settings.tz).y;
      m.set(y, [...(m.get(y) ?? []), e]);
    }
    return [...m.entries()].sort((a, b) => b[0] - a[0]);
  }, [vp, upgrades, other, tlKinds, f, settings.tz]);

  const cols: Col<VPItem>[] = [
    { id: "date", header: "Date", value: (r) => r.t, cell: (r) => <span className="num">{guard(r.t, f.date(r.t))}</span> },
    { id: "name", header: "Item", value: (r) => (r.category === "Battle Pass" ? r.pass : r.name), cell: (r) => <span className="font-medium">{r.category === "Battle Pass" ? r.pass : r.name}</span> },
    { id: "weapon", header: "Weapon", value: (r) => r.weapon },
    { id: "cat", header: "Type", value: (r) => r.category, cell: (r) => <Badge tone={r.category === "Skin" ? "accent" : r.category === "Battle Pass" ? "warn" : r.category === "Bundle" ? "info" : "neutral"}>{r.category}</Badge> },
    { id: "cost", header: "VP", value: (r) => r.cost, cell: (r) => <span className="num">{n0(r.cost)}</span>, align: "right" },
    {
      id: "real",
      header: "≈ Real cost",
      value: (r) => realCost.get(r.r.transaction_id)?.money ?? 0,
      align: "right",
      cell: (r) => {
        const c = realCost.get(r.r.transaction_id);
        if (!c || !c.cur) return <span className="text-faint" title="No payment found for this VP (free VP, rewards…)">free VP</span>;
        return (
          <span className="num" title={m$.homeOnly(c.money, c.cur) ?? undefined}>
            {money(c.money, c.cur)}
            {c.partial && <span className="text-faint"> +free</span>}
          </span>
        );
      },
    },
    { id: "where", header: "Where bought", value: (r) => r.where, cell: (r) => <Badge tone={whereTone(r.where)}>{r.where}</Badge> },
    { id: "tx", header: "Transaction ID", secret: true, value: (r) => r.r.transaction_id, cell: (r) => <Sens className="num">{pv.id(r.r.transaction_id)}</Sens> },
  ];

  const vpFacets = useMemo<Facet<VPItem>[]>(
    () => [
    { id: "year", label: "Year", value: (r) => (r.t ? f.monthKey(r.t).slice(0, 4) : null), order: (a, b) => b.localeCompare(a) },
    { id: "cat", label: "Type", value: (r) => r.category },
    { id: "weapon", label: "Weapon", value: (r) => (r.category === "Skin" ? r.weapon : null), order: (a, b) => rank(WEAPON_ORDER, a) - rank(WEAPON_ORDER, b) },
    { id: "edition", label: "Edition", value: (r) => (r.category === "Skin" ? (editionById.get(r) ?? null) : null), order: (a, b) => rank(EDITIONS, a) - rank(EDITIONS, b) },
    { id: "where", label: "Bought from", value: (r) => sourceOf(r.where) },
    { id: "paid", label: "Paid with", value: (r) => (realCost.get(r.r.transaction_id)?.cur ? "Bought VP" : "Free VP") },
  ],
    [f, editionById, realCost],
  );
  const upFacets = useMemo<Facet<Upgrade>[]>(
    () => [
    { id: "year", label: "Year", value: (u) => (u.t ? f.monthKey(u.t).slice(0, 4) : null), order: (a, b) => b.localeCompare(a) },
    { id: "kind", label: "Kind", value: (u) => (u.variant ? "Variant" : u.level ? "Level" : "Not recorded") },
  ],
    [f],
  );

  const upCols: Col<SkinUpgrades>[] = [
    {
      id: "skin",
      header: "Skin",
      value: (r) => r.skin,
      cell: (r) => (
        <div className="min-w-0 max-w-[380px]">
          <div className="flex items-center gap-2">
            <span className="font-medium">{r.skin === "Unknown skin" ? "Unknown skin (name not recorded by Riot)" : r.skin}</span>
            {r.skin !== "Unknown skin" && !owned.has(r.skin) && <Badge tone="info">not bought separately</Badge>}
          </div>
          {r.perks.map((p) => (
            <div key={p} className="mt-0.5 whitespace-normal text-[12px] text-muted">
              {p}
            </div>
          ))}
        </div>
      ),
    },
    { id: "level", header: "Level", value: (r) => r.maxLevel, cell: (r) => (r.maxLevel ? <LevelPips level={r.maxLevel} /> : <span className="text-faint">—</span>) },
    {
      id: "variants",
      header: "Variants unlocked",
      wrap: true,
      value: (r) => r.variants.map((v) => v.color).join(", "),
      cell: (r) => (r.variants.length ? <span className="flex flex-wrap gap-1">{r.variants.map((v) => <Badge key={v.n}>{v.color}</Badge>)}</span> : <span className="text-faint">—</span>),
    },
    { id: "rp", header: "RP spent", value: (r) => r.rp, mono: true, align: "right" },
    { id: "count", header: "Upgrades", value: (r) => r.count, mono: true, align: "right" },
    { id: "first", header: "First upgrade", value: (r) => r.first, cell: (r) => <span className="num">{guard(r.first, f.date(r.first))}</span> },
    { id: "last", header: "Last upgrade", value: (r) => r.last, cell: (r) => <span className="num">{guard(r.last, f.date(r.last))}</span> },
  ];

  const evCols: Col<Upgrade>[] = [
    { id: "date", header: "Date", value: (u) => u.t, cell: (u) => <span className="num">{guard(u.t, f.date(u.t))}</span> },
    { id: "time", header: `Time (${f.tzLabel})`, value: (u) => f.time(u.t), mono: true },
    { id: "skin", header: "Skin", value: (u) => u.skin, cell: (u) => <span className="font-medium">{u.skin === "Unknown skin" ? "Unknown skin (not recorded)" : u.skin}</span> },
    { id: "what", header: "Upgrade", value: (u) => upgradeLabel(u), cell: (u) => <UpgradeChip u={u} /> },
    { id: "perk", header: "Unlocks", wrap: true, value: (u) => u.perk ?? "", cell: (u) => <span className="block max-w-[360px] text-[12.5px] text-muted">{u.perk}</span> },
    { id: "rp", header: "RP", value: (u) => u.cost, mono: true, align: "right" },
  ];

  if (!has(DS.store)) return <Page code="02 / Collection" title="Collection"><Card><Empty title="No store data">This export has no VALORANT store records.</Empty></Card></Page>;

  const fav = byWeapon.find(([w]) => w !== "Bundle" && w !== "Accessory");

  return (
    <Page
      loading={store.loading || storeAll.loading || payAll.loading}
      code="02 / Collection"
      title="Skins & battle passes"
      sub="Everything bought with VALORANT Points, plus the levels and colour variants you unlocked with Radianite."
      actions={<Segmented value={view} onChange={setView} options={[{ value: "weapon", label: "By weapon" }, { value: "timeline", label: "Timeline" }]} />}
    >
      <Stat label="Skins" onClick={() => setSkinList("")} action="List every skin" value={skins.length} tone="accent" sub={`${n0(skins.reduce((a, s) => a + s.cost, 0))} VP · ${skins.filter((s) => s.where === "Night Market").length} from Night Market`} />
      <Stat label="Battle passes" onClick={() => setPassesOpen(true)} action="List every battle pass" value={passes.length} sub={`${n0(passes.reduce((a, s) => a + s.cost, 0))} VP`} />
      <Stat label="Most collected" onClick={fav ? () => setSkinList(fav[0]) : undefined} action={fav ? `List your ${fav[0]} skins` : undefined} value={fav ? fav[0] : "—"} sub={fav ? `${fav[1].length} skins` : undefined} />
      <Stat label="Radianite spent" onClick={upRows.length ? () => scrollToSection("radianite") : undefined} action="Show Radianite upgrades" value={rpSpent} tone="win" sub={`${upgrades.length} upgrades on ${[...upBySkin.keys()].filter((k) => k !== "Unknown skin").length} skins`} />

      <Card span={6} title="Skins by edition" hint="Estimated from the regular price (Night Market buys use their estimated regular price). Click an edition to see its skins.">
        <div className="space-y-1">
          {editions.map(([e, x]) => (
            <button type="button" key={e} onClick={() => showSkins({ eds: [e] })} title={`Show ${e} skins`} className="grid w-[calc(100%+1rem)] grid-cols-[90px_1fr_auto] items-center gap-3 py-1 -mx-2 rounded-md px-2 text-left transition-colors hover:bg-panel-2">
              <span className="font-medium">{e}</span>
              <div className="h-2 overflow-hidden rounded-full bg-panel-2">
                <div className="h-full rounded-full bg-accent" style={{ width: `${(x.n / Math.max(1, ...editions.map(([, y]) => y.n))) * 100}%` }} />
              </div>
              <span className="num text-[12.5px] text-muted">
                {x.n} · {n0(x.vp)} VP
              </span>
            </button>
          ))}
        </div>
      </Card>
      <Card span={6} title="Night Market savings" hint="Regular price estimated from skins of the same collection you bought at full price, otherwise the next standard price" right={nightMarket.length ? <button type="button" onClick={() => showSkins({ srcs: ["Night Market"] })} className="whitespace-nowrap text-[12.5px] font-medium text-accent hover:underline">Show in grid</button> : undefined}>
        {nightMarket.length ? (
          <>
            <div className="num mb-3 text-[22px] font-medium text-win">
              {n0(nightMarket.reduce((a, x) => a + x.saved, 0))} VP <span className="text-[13px] font-normal text-muted">saved on {nightMarket.length} skins</span>
            </div>
            <ul className="divide-y divide-line">
              {nightMarket.map(({ s, base, how, saved }) => (
                <li key={s.r.transaction_id}>
                  <button type="button" onClick={() => showSkins({ q: s.name })} title={`Show ${s.name}`} className="flex w-[calc(100%+1rem)] items-baseline justify-between gap-3 py-1.5 text-[13px] -mx-2 rounded-md px-2 text-left transition-colors hover:bg-panel-2">
                  <span className="font-medium">{s.name}</span>
                  <span className="num text-muted">
                    {n0(s.cost)} <span className="text-faint" title={how === "collection" ? "Regular price from another skin in this collection" : "Next standard price above what you paid"}>instead of ~{n0(base)}{how === "tier" ? "*" : ""}</span> · <span className="text-win">−{Math.round((saved / base) * 100)}%</span>
                  </span>
                  </button>
                </li>
              ))}
            </ul>
            {nightMarket.some((x) => x.how === "tier") && <p className="mt-2 text-[12px] text-faint">* no other skin from that collection to compare with — next standard price used</p>}
          </>
        ) : (
          <div className="py-6 text-center text-muted">No Night Market purchases in this period.</div>
        )}
      </Card>

      <Swap k={view} className="col-span-12 grid grid-cols-12 gap-4">
      {view === "weapon" ? (
        <>
          <motion.div variants={item} initial="hidden" whileInView="show" viewport={{ once: true }} id="skins" className="panel col-span-12 scroll-mt-[72px] space-y-3 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="field flex min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-[13px]">
                <Search size={14} className="text-muted" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search skins or weapons" aria-label="Search skins" className="w-full bg-transparent outline-none placeholder:text-faint" />
                {q && (
                  <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="text-muted hover:text-ink">
                    <X size={14} />
                  </button>
                )}
              </label>
              <label className="field flex items-center gap-1.5 rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-[13px]">
                <span className="text-muted">Group by</span>
                <select value={prefs.group} onChange={(e) => setPrefs((p) => ({ ...p, group: e.target.value as GroupBy }))} className="bg-transparent font-medium outline-none">
                  {GROUPS.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field flex items-center gap-1.5 rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-[13px]">
                <span className="text-muted">Sort</span>
                <select value={prefs.sort} onChange={(e) => setPrefs((p) => ({ ...p, sort: e.target.value as SortBy }))} className="bg-transparent font-medium outline-none">
                  {SORTS.map((x) => (
                    <option key={x.value} value={x.value}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <ChipGroup label="Edition" hint="Estimated from the price paid (Night Market buys use the regular price)">
                {EDITIONS.filter((e) => [...editionById.values()].includes(e)).map((e) => (
                  <Chip key={e} on={eds.has(e)} onClick={() => setEds((x) => toggle(x, e))}>
                    {e}
                  </Chip>
                ))}
              </ChipGroup>
              <ChipGroup label="Bought from">
                {SOURCES.map((x) => (
                  <Chip key={x} on={srcs.has(x)} onClick={() => setSrcs((v) => toggle(v, x))}>
                    {x}
                  </Chip>
                ))}
              </ChipGroup>
              <Chip on={upgradedOnly} onClick={() => setUpgradedOnly((v) => !v)}>
                Upgraded with Radianite
              </Chip>
              <span className="num ml-auto flex items-center gap-3 text-[12.5px] text-muted">
                <button
                  type="button"
                  onClick={() => {
                    setBulk((b) => ({ open: !b.open, n: b.n + 1 }));
                  }}
                  className="flex items-center gap-1 font-medium text-ink hover:text-accent"
                >
                  <ChevronsUpDown size={13} />
                  {bulk.open ? "Collapse all" : "Expand all"}
                </button>
                <span>{shown.length} of {skins.length + bundles.length}</span>
                {filtersOn && (
                  <button type="button" onClick={clearFilters} className="ml-2 font-medium text-accent hover:underline">
                    Clear filters
                  </button>
                )}
              </span>
            </div>
          </motion.div>

          <Swap appear k={[dq, [...eds].join(), [...srcs].join(), upgradedOnly, prefs.group, prefs.sort].join("|")} className="col-span-12 grid grid-cols-12 gap-4">
          {!shown.length ? (
            <Card span={12}>
              <Empty title="Nothing matches">
                No skins match these filters.{" "}
                <button type="button" onClick={clearFilters} className="font-medium text-accent hover:underline">
                  Clear filters
                </button>
              </Empty>
            </Card>
          ) : (
            <section className="panel col-span-12 divide-y divide-line overflow-hidden">
              {groups.map((g) => (
                <SkinGroup
                  key={g.title}
                  title={g.title}
                  items={g.items}
                  parts={g.parts}
                  bulk={bulk}
                  tile={renderTile}
                />
              ))}
            </section>
          )}
          </Swap>
        </>
      ) : (
        <Card
          quick
          span={12}
          title="Purchase timeline"
          hint="Newest first · a skin's Radianite upgrades on one day are shown as one entry"
          right={
            <div className="flex flex-wrap gap-1.5">
              {TL_KINDS.map((k) => (
                <Chip key={k.value} on={tlKinds.has(k.value)} onClick={() => setTlKinds((x) => toggle(x, k.value) as Set<TlKind>)}>
                  {k.label}
                </Chip>
              ))}
            </div>
          }
        >
          <ul className="mb-5 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted" aria-label="Legend">
            {[
              ["bg-accent", "Skin", "vp"],
              ["bg-warn", "Battle pass", "vp"],
              ["bg-info", "Bundle", "vp"],
              ["bg-win", "Radianite upgrade", "rp"],
              ["bg-faint", "Other purchase", "other"],
            ]
              .filter(([, , k]) => tlKinds.has(k as TlKind))
              .map(([c, l]) => (
                <li key={l} className="flex items-center gap-1.5">
                  <span className={`h-2.5 w-2.5 rounded-full ${c}`} />
                  {l}
                </li>
              ))}
          </ul>
          <Swap k={[...tlKinds].sort().join()}>
          {!timeline.length ? (
            <Empty title="Nothing to show">Pick at least one kind of purchase above.</Empty>
          ) : (
            <div className="space-y-8">
              {timeline.map(([y, list]) => (
                <div key={y} className="grid gap-4 md:grid-cols-[90px_1fr]">
                  <div>
                    <div className="font-display text-3xl font-bold text-accent">{y}</div>
                    <div className="num text-[12px] text-muted">{list.length} entries</div>
                  </div>
                  <ol className="relative space-y-2 border-l border-line-strong pl-5">
                    {list.map((e) => (
                      <li key={e.key} className="relative">
                        <span className={`absolute -left-[25px] top-2 h-2.5 w-2.5 rounded-full ring-4 ring-[var(--panel)] ${e.dot}`} />
                        <div className="flex flex-wrap items-baseline gap-x-3">
                          <span className="num w-[110px] text-[12.5px] text-muted">{guard(e.t, f.date(e.t))}</span>
                          <span className="font-medium">{e.title}</span>
                          <span className={`text-[12.5px] ${e.kind === "rp" ? "text-win" : "text-muted"}`}>{e.detail}</span>
                          <span className="num ml-auto text-[13px] text-muted">{e.cost}</span>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          )}
          </Swap>
        </Card>
      )}
      </Swap>

      <Card id="vp-purchases" span={12} title="All VP purchases" hint="≈ Real cost: estimated from the top-up whose VP was used (oldest VP first)" pad={false}>
        <DataTable rows={vp} cols={cols} preset={vpPreset} onClearPreset={() => setVpPreset(null)} facets={vpFacets} initialSort={{ id: "date", desc: true }} filename="vp-purchases" rowTone={(r) => (r.category === "Unknown" ? "warn" : undefined)} />
      </Card>

      {upRows.length > 0 && (
        <Card
          id="radianite"
          span={12}
          title="Radianite upgrades"
          hint={upView === "skin" ? "Click a skin to see when each level and variant was unlocked" : "Every Radianite upgrade, one row each"}
          right={<Segmented value={upView} onChange={setUpView} options={[{ value: "skin", label: "By skin" }, { value: "all", label: "Every upgrade" }]} />}
          pad={false}
        >
          <Swap k={upView}>
          {upView === "skin" ? (
            <DataTable
              key="by-skin"
              rows={upRows}
              cols={upCols}
              initialSort={{ id: "last", desc: true }}
              filename="radianite-upgrades-by-skin"
              rowTone={(r) => (r.skin === "Unknown skin" ? "warn" : undefined)}
              expand={(r) => <UpgradeTimeline u={r} />}
            />
          ) : (
            <DataTable key="every" rows={upgrades} cols={evCols} initialSort={{ id: "date", desc: true }} filename="radianite-upgrades" facets={upFacets} searchPlaceholder="Search skin, level, colour…" />
          )}
          </Swap>
        </Card>
      )}

      {other.length > 0 && (
        <Card span={12} title="Other purchases" hint="Things bought with Kingdom Credits or agent recruitment tokens — newest first. Click a total to show only those.">
          <div className="mb-4 flex flex-wrap gap-3">
            {otherTotals.map(([cur, e]) => {
              const u = currencyUnit(cur);
              return (
                <button
                  type="button"
                  key={cur}
                  aria-pressed={otherCur === cur}
                  onClick={() => setOtherCur((c) => (c === cur ? null : cur))}
                  className={`rounded-lg border px-3.5 py-2 text-left transition-colors ${otherCur === cur ? "border-accent bg-accent-soft" : "border-line bg-panel-2 hover:border-line-strong"}`}
                >
                  <div className="text-[11.5px] uppercase tracking-[0.1em] text-muted">{u.many}</div>
                  <div className="num mt-0.5">
                    <span className="text-[17px] font-medium">{n0(e.spent)}</span> <span className="text-muted">{e.spent === 1 ? u.one : u.short === "token" ? "used" : "spent"}</span>
                    <span className="text-faint"> · {e.n} item{e.n === 1 ? "" : "s"}</span>
                  </div>
                </button>
              );
            })}
          </div>
          <Swap k={otherCur ?? "all"}>
          <ul className="divide-y divide-line">
            {other.filter((o) => !otherCur || o.currency === otherCur).map((o) => {
              const u = currencyUnit(o.currency);
              return (
                <li key={o.r.transaction_id} className="grid grid-cols-[96px_1fr_auto] items-center gap-x-4 gap-y-1 py-2.5 sm:grid-cols-[110px_1fr_130px_150px]">
                  <span className="num text-[12.5px] text-muted">{guard(o.t, f.date(o.t))}</span>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{o.name}</div>
                    {o.note && <div className="text-[12px] text-faint">{o.note}</div>}
                  </div>
                  <span className="hidden sm:block">
                    <Badge tone={o.kind === "Agent unlock" ? "info" : o.kind === "Agent gear" ? "warn" : "neutral"}>{o.kind}</Badge>
                  </span>
                  <span className="num whitespace-nowrap text-right">
                    {n0(o.cost)} <span className="text-muted">{u.short === "token" ? (o.cost === 1 ? "token" : "tokens") : u.short}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          </Swap>
        </Card>
      )}
      <Drawer
        open={skinList != null}
        onClose={() => setSkinList(null)}
        title={skinList ? `${skinList} skins · ${skins.filter((x) => x.weapon === skinList).length}` : `Skins · ${skins.length}`}
        hint={
          <>
            {n0((skinList ? skins.filter((x) => x.weapon === skinList) : skins).reduce((a, x) => a + x.cost, 0))} VP · newest first{skinList ? "" : ", by weapon"} ·{" "}
            <button
              type="button"
              onClick={() => {
                const w = skinList;
                setSkinList(null);
                showSkins(w ? { q: w } : {});
              }}
              className="font-medium text-accent hover:underline"
            >
              Open in the skins grid
            </button>
          </>
        }
      >
        {(() => {
          const list = skins.filter((x) => !skinList || x.weapon === skinList).sort((a, b) => (b.t ?? "").localeCompare(a.t ?? ""));
          const groups: [string, VPItem[]][] = skinList ? [[skinList, list]] : [...list.reduce((m, x) => m.set(x.weapon, [...(m.get(x.weapon) ?? []), x]), new Map<string, VPItem[]>())].sort((a, b) => WEAPON_ORDER.indexOf(a[0]) - WEAPON_ORDER.indexOf(b[0]));
          return groups.map(([w, l]) => (
            <section key={w}>
              {!skinList && (
                <div className="sticky top-0 z-10 flex items-baseline justify-between border-b border-line bg-panel-2 px-5 py-1.5 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-muted">
                  <span>{w}</span>
                  <span className="num font-normal normal-case tracking-normal">{l.length}</span>
                </div>
              )}
              <ul className="divide-y divide-line">
                {l.map((x) => (
                  <li key={x.r.transaction_id} className="flex items-start justify-between gap-3 px-5 py-2.5">
                    <div className="min-w-0">
                      <div className="font-medium">{x.name}</div>
                      <div className="num text-[12px] text-muted">
                        {guard(x.t, f.date(x.t))}
                        {editionById.get(x) && <span className="text-faint"> · {editionById.get(x)}</span>}
                        {x.where !== "Daily Store" && <span className="text-faint"> · {x.where.replace(" (single item)", "")}</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <UpgradeBadge u={upBySkin.get(x.name)} />
                      <span className="num text-[13px]">{n0(x.cost)} VP</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ));
        })()}
      </Drawer>
      <Drawer open={passesOpen} onClose={() => setPassesOpen(false)} title={`Battle passes · ${passes.length}`} hint={`${n0(passes.reduce((a, s) => a + s.cost, 0))} VP · newest first. Names marked "estimated" come from the act calendar.`}>
        <ul className="divide-y divide-line">
          {[...passes]
            .sort((a, b) => (b.t ?? "").localeCompare(a.t ?? ""))
            .map((p) => {
              const c = realCost.get(p.r.transaction_id);
              return (
                <li key={p.r.transaction_id} className="flex items-start justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <div className="font-medium">{p.pass ?? p.name}</div>
                    <div className="num text-[12px] text-muted">
                      {guard(p.t, f.date(p.t))}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="num text-[13px]">{n0(p.cost)} VP</div>
                    {c?.cur ? <div className="num text-[11.5px] text-faint">≈ {money(c.money, c.cur)}</div> : null}
                  </div>
                </li>
              );
            })}
          {!passes.length && <li className="px-5 py-10 text-center text-muted">No battle passes in this period.</li>}
        </ul>
      </Drawer>
    </Page>
  );
}

/** A full-width group header (folds the group) with its skins flowing as tiles underneath. */
/**
 * A full-width group header (folds the group) with its skins as tiles underneath. With `parts` (weapon type),
 * each weapon's skins sit together in their own labelled box, and the boxes flow side by side so small
 * weapons share a row instead of leaving gaps.
 */
const SkinGroup = memo(function SkinGroup({ title, items, parts, bulk, tile }: { title: string; items: VPItem[]; parts?: [string, VPItem[]][]; bulk: { open: boolean; n: number }; tile: (s: VPItem) => ReactNode }) {
  const [open, setOpen] = useState(bulk.open);
  useEffect(() => {
    setOpen(bulk.open);
  }, [bulk]);
  const onToggle = () => setOpen((o) => !o);
  return (
    <div>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-2.5 bg-panel-2 px-4 py-2.5 text-left transition-colors hover:bg-panel-3/60">
        <ChevronDown size={15} className={`shrink-0 text-muted transition-transform ${SOFT_CSS} ${open ? "" : "-rotate-90"}`} />
        <h2 className="font-display text-[15px] font-semibold uppercase tracking-[0.12em]">{title}</h2>
        <span className="num ml-auto text-[12px] text-muted">
          {items.length} · {n0(items.reduce((a, s) => a + s.cost, 0))} VP
        </span>
      </button>
      <Collapse open={open}>
            {parts ? (
              <div className="flex flex-wrap gap-2.5 p-3">
                {parts.map(([w, list]) => (
                  <div key={w} className="max-w-full rounded-xl border border-line bg-panel/40 p-2">
                    <div className="flex items-baseline justify-between gap-3 px-1 pb-1.5">
                      <span className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">{w}</span>
                      <span className="num text-[11.5px] text-muted">
                        {list.length} · {n0(list.reduce((a, s) => a + s.cost, 0))} VP
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2 [&>*]:w-[200px]">{list.map(tile)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid gap-2 p-3 [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]">{items.map(tile)}</div>
            )}
      </Collapse>
    </div>
  );
});

/** One skin as a small tile: name, a detail line, where it was bought / Radianite level, and its VP. */
function SkinTile({ s, sub, date, where, badge }: { s: VPItem; sub: string; date: string | null; where: string | null; badge: ReactNode }) {
  return (
    <div onPointerMove={spotlight} className="spot relative flex min-w-0 flex-col justify-between gap-1.5 rounded-lg border border-line bg-panel-2/60 px-3 py-2 transition-colors hover:border-line-strong hover:bg-panel-3/60">
      <div className="min-w-0">
        <div className="line-clamp-2 text-[13px] font-medium leading-snug" title={s.name}>
          {s.name}
        </div>
        {(sub || date) && <div className="num mt-0.5 truncate text-[11.5px] text-muted">{[sub, date].filter(Boolean).join(" · ")}</div>}
      </div>
      <div className="flex items-end gap-2">
        <div className="flex min-w-0 flex-wrap gap-1">
          {where && <Badge tone={whereTone(where)}>{where}</Badge>}
          {badge}
        </div>
        <span className="num ml-auto shrink-0 text-[12.5px]">{n0(s.cost)}</span>
      </div>
    </div>
  );
}

function LevelPips({ level, max = 4 }: { level: number; max?: number }) {
  const top = Math.max(max, level);
  return (
    <span className="inline-flex items-center gap-1.5" title={`Level ${level}`}>
      <span className="flex gap-0.5">
        {Array.from({ length: top }, (_, i) => (
          <span key={i} className={`h-2 w-3 rounded-[2px] ${i < level ? "bg-win" : "bg-line-strong"}`} />
        ))}
      </span>
      <span className="num text-[12px] text-muted">Lv {level}</span>
    </span>
  );
}

function UpgradeBadge({ u }: { u?: SkinUpgrades }) {
  if (!u || !u.maxLevel) return null;
  const title = [`Level ${u.maxLevel}`, u.variants.length ? `Variants: ${u.variants.map((v) => v.color).join(", ")}` : "", ...u.perks, `${u.rp} RP spent`].filter(Boolean).join(" · ");
  return (
    <span title={title}>
      <Badge tone="win">
        Lv {u.maxLevel}
        {u.variants.length > 0 && ` · ${u.variants.length} var`}
      </Badge>
    </span>
  );
}

function UpgradeChip({ u }: { u: Upgrade }) {
  return <Badge tone={u.variant ? "info" : u.level ? "win" : "neutral"}>{upgradeLabel(u)}</Badge>;
}

/** Vertical timeline of one skin's upgrades, oldest first. */
function UpgradeTimeline({ u }: { u: SkinUpgrades }) {
  const { f } = useSettings();
  const guard = useDateGuard();
  let running = 0;
  return (
    <ol className="relative ml-[22px] mt-1 space-y-2 border-l border-line-strong pl-5">
      {u.events.map((e, i) => {
        running += e.cost;
        return (
          <li key={e.r.transaction_id ?? i} className="relative">
            <span className={`absolute -left-[25.5px] top-[7px] h-2.5 w-2.5 rounded-full ring-4 ring-[var(--panel-2)] ${e.variant ? "bg-info" : "bg-win"}`} />
            <div className="grid grid-cols-[150px_150px_1fr_auto] items-baseline gap-x-4 max-md:grid-cols-[1fr_auto]">
              <span className="num text-[12.5px] text-muted">
                {guard(e.t, f.date(e.t))} <span className="text-faint">{f.time(e.t)}</span>
              </span>
              <span>
                <UpgradeChip u={e} />
              </span>
              <span className="text-[12.5px] text-muted max-md:col-span-2 max-md:order-last">{e.perk}</span>
              <span className="num whitespace-nowrap text-right text-[12.5px]">
                {e.cost} RP <span className="text-faint">· total {running}</span>
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ChipGroup({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <span className="text-[12.5px] text-muted" title={hint}>
        {label}
        {hint && <span className="text-faint"> (est.)</span>}
      </span>
      {children}
    </div>
  );
}

