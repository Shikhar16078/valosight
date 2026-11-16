/**
 * The pieces of a skin's details (shown in the Inspect window, SkinInspect.tsx). One skin, everything we know: the purchase from the export, plus Riot's catalogue (lib/skins.ts):
 * its picture and edition, every upgrade level (with which ones you unlocked and when), every variant (pick
 * one to see it), the Radianite spent, and the rest of its collection (which of those you own).
 */
import { ArrowUpRight, Check } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Swap, SOFT_CSS } from "../components/anim";
import { SkinImage } from "../components/SkinImage";
import { Badge } from "../components/ui";
import { useDateGuard } from "../lib/privacy-dates";
import { useSettings } from "../lib/settings";
import type { CatalogSkin, SkinCatalog, SkinMatch } from "../lib/skins";
import { money, n0, type SkinUpgrades, type Upgrade, type VPItem } from "../lib/valorant";

/** "KillBanner" → "Kill banner". Level 1 is the base skin; a later level Riot doesn't describe is "Upgrade". */
const kindLabel = (k: string, n: number) => (n === 1 ? "Base skin" : k ? (k === "VFX" ? "Visual effects" : k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/(?<= )\w/g, (c) => c.toLowerCase())) : "Upgrade");

/*
 * What's yours vs what's the game's: your purchase, unlocked levels/variants and owned skins are tinted green
 * ("yours") and clickable to their transaction; catalogue facts stay neutral.
 */
const YOURS = "bg-win/[0.08] text-ink";
const YOURS_HOVER = "hover:bg-win/[0.16]";
const variantNo = (label: string) => Number(/Variant\s+(\d+)/i.exec(label)?.[1] ?? 0);

export interface SkinDetailProps {
  item: VPItem;
  match: SkinMatch | null;
  upgrades?: SkinUpgrades;
  edition: string | undefined;
  cost?: { money: number; cur: string; partial: boolean };
  catalog: SkinCatalog | null;
  owned: Set<string>;
  /** a picture when the item isn't a catalogue skin (a bundle's art) */
  picture?: string | null;
  /** open another skin of yours (from its collection list) */
  onOpen: (name: string) => void;
  /** show this purchase in All VP purchases */
  onShowPurchase?: () => void;
  /** show one Radianite upgrade in the upgrades table */
  onShowUpgrade?: (u: Upgrade) => void;
}

/** Everything the skin sections need, worked out once. The Inspect window remounts it per skin (keyed), so state starts fresh. */
export function useSkinModel({ match, upgrades, catalog, owned, picture }: SkinDetailProps) {
  const { f } = useSettings();
  const guard = useDateGuard();
  const skin = match?.skin ?? null;
  const date = (t: string | null | undefined) => (t ? guard(t, f.date(t)) : "");

  // When each level and variant was unlocked, from the Radianite upgrades.
  const levelAt = new Map<number, Upgrade>();
  const variantAt = new Map<number, Upgrade>();
  for (const e of upgrades?.events ?? []) {
    if (e.level && !levelAt.has(e.level)) levelAt.set(e.level, e);
    if (e.variant && !variantAt.has(e.variant.n)) variantAt.set(e.variant.n, e);
  }
  const topLevel = Math.max(1, upgrades?.maxLevel ?? 0, match?.level ?? 0);

  const [pick, setPick] = useState(0); // the variant shown; 0 = base
  const chroma = skin?.chromas[pick] ?? null;
  const tint = skin?.edition?.color ?? "var(--accent)";
  const image = chroma?.image ?? match?.image ?? picture ?? null;

  const family = useMemo<CatalogSkin[]>(() => (skin?.theme && catalog ? catalog.skins.filter((s) => s.theme === skin.theme) : []), [skin, catalog]);
  const ownedInFamily = family.filter((s) => owned.has(s.name)).length;
  // A bundle's art (a 16:9 scene, not a weapon render on transparency): shown framed on its own blurred colours.
  const art = !skin && !match?.image && !!picture;
  return { skin, date, levelAt, variantAt, topLevel, pick, setPick, chroma, tint, image, art, family, ownedInFamily };
}
export type SkinModel = ReturnType<typeof useSkinModel>;

export const MissingNote = () => <p className="text-[12.5px] text-faint">This skin isn't in the game data yet, so only what your export says is shown.</p>;

/** The picture, lit with the edition's colour (like the game's store), cross-fading between variants. */
export function SkinHero({ m, className = "" }: { m: SkinModel; className?: string }) {
  return (
    // Absolutely placed: in a grid cell the picture can't shrink below its own height, so tall renders
    // (pistols) overflowed and got cut off. Here every render fits the box whatever its shape.
    <div
      className={`relative overflow-hidden rounded-2xl border bg-panel-2/50 ${className}`}
      style={{
        borderColor: `color-mix(in oklab, ${m.tint} 30%, var(--line))`,
        background: `radial-gradient(70% 90% at 50% 60%, color-mix(in oklab, ${m.tint} 22%, transparent), transparent 75%), color-mix(in oklab, var(--panel-2) 55%, transparent)`,
      }}
    >
      <Swap k={m.image ?? "none"} appear className="absolute inset-0 grid place-items-center p-4">
        {m.image && m.art ? (
          <>
            {/* The art's own colours fill the box (blurred, dimmed), and the art sits on them as a framed picture,
                so the rectangle blends in instead of floating on an empty box. Same file: one download. */}
            <SkinImage src={m.image} size="lg" fit="cover" className="absolute inset-0 h-full w-full scale-125 opacity-55 blur-2xl saturate-150" />
            <span aria-hidden className="absolute inset-0 bg-[radial-gradient(80%_70%_at_50%_50%,transparent,color-mix(in_oklab,var(--bg)_55%,transparent))]" />
            <div className="absolute inset-[7%] grid place-items-center">
              <SkinImage src={m.image} size="lg" className="max-h-full max-w-full rounded-xl shadow-[0_18px_50px_-12px_rgba(0,0,0,0.65)] ring-1 ring-white/10" />
            </div>
          </>
        ) : m.image ? (
          <SkinImage src={m.image} size="lg" className="absolute inset-[8%] h-[84%] w-[84%]" />
        ) : (
          <span className="text-[12.5px] text-faint">No picture</span>
        )}
      </Swap>
    </div>
  );
}

/** Variant swatches (unlocked ones ticked); picking one shows it in the hero. */
export function SkinVariants({ m, p, className = "", big = false }: { m: SkinModel; p: SkinDetailProps; className?: string; big?: boolean }) {
  const { skin, variantAt, pick, setPick, chroma, date } = m;
  if (!skin || skin.chromas.length < 2) return null;
  const size = big ? "h-14 w-14 rounded-xl" : "h-11 w-11 rounded-lg";
  return (
    <section className={className}>
      <Heading title="Variants" note={`${skin.chromas.filter((c, i) => i === 0 || variantAt.has(variantNo(c.label))).length} of ${skin.chromas.length} unlocked · pick one to see it`} />
      <div className="flex flex-wrap gap-2">
        {skin.chromas.map((c, i) => {
          const have = i === 0 || variantAt.has(variantNo(c.label));
          return (
            <button
              key={i}
              type="button"
              aria-pressed={pick === i}
              onClick={() => setPick(i)}
              title={c.label || "Base"}
              className={`relative grid ${size} place-items-center overflow-hidden border transition-[border-color,box-shadow,transform] ${SOFT_CSS} ${pick === i ? "border-accent shadow-[0_0_0_2px_var(--accent)]" : "border-line hover:-translate-y-0.5 hover:border-line-strong"} ${have ? "" : "opacity-50"}`}
            >
              {c.swatch ? <SkinImage src={c.swatch} size="xs" className="absolute inset-0 h-full w-full" /> : <span className="text-[11px] text-muted">Base</span>}
              {have && (
                <span className="absolute bottom-0.5 right-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-win text-[var(--bg)]">
                  <Check size={9} strokeWidth={3.5} />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <Swap k={pick} className="mt-2 text-[12.5px] text-muted">
        {(() => {
          const u = pick === 0 ? null : variantAt.get(variantNo(chroma?.label ?? ""));
          const label = chroma?.label || "Base look";
          if (pick === 0) return <YoursLink onClick={p.onShowPurchase}>{label} · came with your purchase</YoursLink>;
          if (u) return <YoursLink onClick={p.onShowUpgrade && (() => p.onShowUpgrade!(u))}>{label} · you unlocked it {date(u.t)}</YoursLink>;
          return <span>{label} · not unlocked</span>;
        })()}
      </Swap>
    </section>
  );
}

export function SkinLevels({ m, p }: { m: SkinModel; p: SkinDetailProps }) {
  const { skin, topLevel, levelAt, date } = m;
  if (!skin || skin.levels.length < 2) return null;
  return (
    <section>
      <Heading title="Levels" note={`${Math.min(topLevel, skin.levels.length)} of ${skin.levels.length} yours · click one to see its transaction`} />
      <ol className="space-y-1">
        {skin.levels.map((k, i) => {
          const n = i + 1;
          const on = n <= topLevel;
          const u = levelAt.get(n);
          const go = n === 1 ? p.onShowPurchase : u && p.onShowUpgrade ? () => p.onShowUpgrade!(u) : undefined;
          const row = (
            <>
              <Tick on={on} />
              <span className="num w-14 shrink-0 text-[12px] text-faint">Level {n}</span>
              <span className="flex-1">{kindLabel(k, n)}</span>
              <span className="num text-[12px] text-muted">{n === 1 ? date(p.item.t) : u ? date(u.t) : on ? "" : "locked"}</span>
              {go && <ArrowUpRight size={14} className={`text-win opacity-0 transition-opacity ${SOFT_CSS} group-hover:opacity-100`} />}
            </>
          );
          return (
            <li key={n}>
              {on && go ? (
                <button type="button" onClick={go} title={n === 1 ? "Show this purchase" : "Show this Radianite upgrade"} className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${SOFT_CSS} ${YOURS} ${YOURS_HOVER}`}>
                  {row}
                </button>
              ) : (
                <div className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] ${on ? YOURS : "text-muted"}`}>{row}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function SkinBadges({ m, p }: { m: SkinModel; p: SkinDetailProps }) {
  const { skin } = m;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
      {skin?.edition ? (
        <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-medium" style={{ borderColor: `${skin.edition.color ?? "#888"}66`, color: skin.edition.color ?? undefined }}>
          {skin.edition.icon && <SkinImage src={skin.edition.icon} size="xs" className="h-3.5 w-3.5" />}
          {skin.edition.name}
        </span>
      ) : (
        p.edition && <Badge>{p.edition === "Bundle" ? "Bundle" : `${p.edition} (est.)`}</Badge>
      )}
      {p.item.category !== "Bundle" && <Badge>{skin?.weapon ?? p.item.weapon}</Badge>}
      {p.item.where !== "Daily Store" && <Badge tone="info">{p.item.where.replace(" (single item)", "")}</Badge>}
    </div>
  );
}

export function SkinFacts({ m, p }: { m: SkinModel; p: SkinDetailProps }) {
  const { item, cost, upgrades } = p;
  return (
    <section className="rounded-2xl border border-win/25 bg-win/[0.06] px-5 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-win">Your purchase</h3>
        {p.onShowPurchase && (
          <button type="button" onClick={p.onShowPurchase} className={`flex items-center gap-1 text-[12px] text-muted transition-colors ${SOFT_CSS} hover:text-win`}>
            Show transaction <ArrowUpRight size={13} />
          </button>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-[13px]">
        <Fact k="Bought" v={m.date(item.t) || "—"} />
        <Fact k="Price" v={`${n0(item.cost)} VP`} />
        <Fact k="≈ Real cost" v={cost?.cur ? `${money(cost.money, cost.cur)}${cost.partial ? " + free VP" : ""}` : "free VP"} />
        {item.category === "Bundle" ? (
          <Fact k="Type" v="Full bundle" />
        ) : (
          <Fact k="Radianite" v={upgrades ? `${n0(upgrades.rp)} RP · ${upgrades.count} upgrade${upgrades.count === 1 ? "" : "s"}` : "not upgraded"} />
        )}
      </dl>
    </section>
  );
}

/** The rest of its collection (same theme): which you own; yours open on click. */
export function SkinFamily({ m, p }: { m: SkinModel; p: SkinDetailProps }) {
  const { family, ownedInFamily, skin } = m;
  if (family.length < 2) return null;
  return (
    <section>
      <Heading title={p.catalog?.themeName(skin?.theme) ? `${p.catalog.themeName(skin?.theme)} collection` : "Its collection"} note={`you own ${ownedInFamily} of ${family.length}`} />
      <ul className="space-y-1">
        {family.map((s) => {
          const have = p.owned.has(s.name);
          const self = s.name === skin?.name;
          return (
            <li key={s.name}>
              <button
                type="button"
                disabled={!have || self}
                onClick={() => p.onOpen(s.name)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${SOFT_CSS} ${have ? YOURS : "text-muted"} ${have && !self ? YOURS_HOVER : ""}`}
              >
                <SkinImage src={s.image} size="sm" className={`h-7 w-16 shrink-0 ${have ? "" : "opacity-40 grayscale"}`} />
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                {have ? <Badge tone="win">{self ? "this one" : "owned"}</Badge> : <span className="text-[12px] text-faint">{s.edition?.name ?? ""}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A line about something of yours that opens its transaction. */
function YoursLink({ onClick, children }: { onClick?: () => void; children: ReactNode }) {
  if (!onClick) return <span className="text-win">{children}</span>;
  return (
    <button type="button" onClick={onClick} className={`inline-flex items-center gap-1 text-win transition-opacity ${SOFT_CSS} hover:opacity-80`}>
      {children} <ArrowUpRight size={13} />
    </button>
  );
}

function Heading({ title, note }: { title: string; note?: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-muted">{title}</h3>
      {note && <span className="text-[12px] text-faint">{note}</span>}
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-[0.12em] text-faint">{k}</dt>
      <dd className="num mt-0.5 truncate">{v}</dd>
    </div>
  );
}

function Tick({ on }: { on: boolean }) {
  return (
    <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${on ? "border-win bg-win text-[var(--bg)]" : "border-line-strong"}`}>
      {on && <Check size={10} strokeWidth={3.5} />}
    </span>
  );
}
