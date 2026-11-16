/**
 * One battle pass in the Inspect window: your purchase, a note that Riot's export doesn't include progress, and
 * every reward the pass offered, chapter by chapter, with pictures (lib/passes.ts). Filter by reward type;
 * ← / → step through your passes newest first.
 */
import { ArrowUpRight, Gift, Info } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { InspectHeader, InspectWash, InspectWindow, type InspectNav } from "../components/InspectWindow";
import { SkinImage } from "../components/SkinImage";
import { SOFT, SOFT_CSS } from "../components/anim";
import { Badge, Segmented } from "../components/ui";
import type { BattlePass, Reward, RewardKind } from "../lib/passes";
import { useDateGuard } from "../lib/privacy-dates";
import { useSettings } from "../lib/settings";
import { money, n0, type VPItem } from "../lib/valorant";
import type { SkinDetailProps } from "./SkinDetail";

export interface PassDetailProps {
  item: VPItem;
  /** the pass's rewards; undefined while the list loads, null when it isn't available */
  pass: BattlePass | null | undefined;
  cost: SkinDetailProps["cost"];
  onShowPurchase?: () => void;
}

const KINDS: { kind: RewardKind; one: string; many: string }[] = [
  { kind: "skin", one: "Skin", many: "Skins" },
  { kind: "buddy", one: "Buddy", many: "Buddies" },
  { kind: "card", one: "Card", many: "Cards" },
  { kind: "spray", one: "Spray", many: "Sprays" },
  { kind: "title", one: "Title", many: "Titles" },
  { kind: "radianite", one: "Radianite", many: "Radianite" },
  { kind: "other", one: "Other", many: "Other" },
];
const kindLabel = (k: RewardKind) => KINDS.find((x) => x.kind === k)?.one ?? "Reward";
/**
 * How each picture sits in its box (always fitted whole, never cropped): skins are wide (up to 512×120, an Odin),
 * player cards tall (268×640), buddies and Radianite small squares (128 px, so they aren't blown up past it).
 */
const FIT: Record<RewardKind, string> = {
  skin: "p-2.5",
  card: "p-1.5",
  spray: "p-2",
  buddy: "p-3",
  radianite: "p-7",
  title: "",
  other: "",
};

export function PassInspect({ detail, ...nav }: InspectNav & { detail: PassDetailProps | null }) {
  return (
    <InspectWindow open={!!detail} label={detail?.item.pass ?? "Battle pass"} {...nav}>
      {detail && <Body detail={detail} {...nav} />}
    </InspectWindow>
  );
}

/** "EVOLUTION: ACT 1" → "Evolution" (episodes had names; yearly seasons don't). */
const episodeName = (contract: string | undefined) => {
  const m = /^\s*([A-Za-z]+)\s*:/.exec(contract ?? "");
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : null;
};

function Body({ detail, ...nav }: InspectNav & { detail: PassDetailProps }) {
  const { item, pass } = detail;
  const title = (item.pass ?? "Battle pass").replace(/\s*\(estimated\)$/, "");
  const ep = episodeName(pass?.name);
  return (
    <>
      <InspectWash tint="var(--accent)" />
      <InspectHeader eyebrow={ep ? `Battle pass · ${ep}` : "Battle pass"} title={title} {...nav} />
      <div className="scroll-thin relative z-10 min-h-0 flex-1 space-y-7 overflow-y-auto px-7 pb-8 pt-3 max-sm:px-5">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <Purchase detail={detail} />
          <section className="flex gap-3 rounded-2xl border border-info/25 bg-info/[0.06] px-5 py-4 text-[13px] leading-relaxed">
            <Info size={17} className="mt-0.5 shrink-0 text-info" />
            <div>
              <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-info">Your progress isn't in the data</h3>
              <p className="mt-1.5 text-muted">
                Riot's data export records that you bought this pass, not how far you played it, so Valosight can't tell which levels you actually completed. Below is everything the pass
                offered{pass ? ` across its ${pass.levels} levels` : ""}.
              </p>
            </div>
          </section>
        </div>
        {/* Cross-fade when stepping to another pass. */}
        <motion.div key={item.r.transaction_id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: SOFT.in, ease: SOFT.ease }}>
          <Rewards detail={detail} />
        </motion.div>
      </div>
    </>
  );
}

function Purchase({ detail }: { detail: PassDetailProps }) {
  const { item, cost } = detail;
  const { f } = useSettings();
  const guard = useDateGuard();
  return (
    <section className="rounded-2xl border border-win/25 bg-win/[0.06] px-5 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-win">Your purchase</h3>
        {detail.onShowPurchase && (
          <button type="button" onClick={detail.onShowPurchase} className={`flex items-center gap-1 text-[12px] text-muted transition-colors ${SOFT_CSS} hover:text-win`}>
            Show transaction <ArrowUpRight size={13} />
          </button>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-[13px]">
        <Fact k="Bought" v={item.t ? guard(item.t, f.date(item.t)) : "—"} />
        <Fact k="Price" v={`${n0(item.cost)} VP`} />
        <Fact k="≈ Real cost" v={cost?.cur ? `${money(cost.money, cost.cur)}${cost.partial ? " + free VP" : ""}` : "free VP"} />
        <Fact k="Which act" v={item.passEstimated ? "Estimated from the date" : item.act ? "Recorded by Riot" : "Not recorded"} />
      </dl>
    </section>
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

function Rewards({ detail }: { detail: PassDetailProps }) {
  const { item, pass } = detail;
  const [kind, setKind] = useState<RewardKind | "all">("all");
  const counts = useMemo(() => {
    const c = new Map<RewardKind, number>();
    for (const ch of pass?.chapters ?? []) for (const r of ch.rewards) c.set(r.kind, (c.get(r.kind) ?? 0) + 1);
    return c;
  }, [pass]);

  if (!item.act) return <Note>Riot didn't record which act this pass was for, and its date doesn't match one, so its rewards can't be shown.</Note>;
  if (pass === null) return <Note>The community catalogue (valorant-api.com) doesn't list this pass's rewards yet. It usually catches up within days of a new act.</Note>;
  if (pass === undefined)
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-3">
        {Array.from({ length: 14 }, (_, i) => (
          <div key={i} className="skeleton h-[172px] rounded-xl" />
        ))}
      </div>
    );

  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const options = [{ value: "all" as const, label: `All ${total}` }, ...KINDS.filter((k) => counts.get(k.kind)).map((k) => ({ value: k.kind, label: `${k.many} ${counts.get(k.kind)}` }))];
  const show = (r: Reward) => kind === "all" || r.kind === kind;
  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-display text-[15px] font-semibold tracking-[0.02em]">What the pass offered</h3>
        <div className="max-w-full overflow-x-auto">
          <Segmented value={kind} options={options} onChange={setKind} />
        </div>
      </div>
      <div className="space-y-6">
        <AnimatePresence initial={false}>
          {pass.chapters
            .filter((ch) => ch.rewards.some(show))
            .map((ch) => (
              <motion.div
                key={ch.n}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: SOFT.out } }}
                transition={{ duration: SOFT.in, ease: SOFT.ease }}
              >
                <div className="mb-2.5 flex items-baseline gap-2.5">
                  <h4 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">{ch.epilogue ? "Epilogue" : `Chapter ${ch.n}`}</h4>
                  <span className="num text-[11.5px] text-faint">
                    levels {ch.from}–{ch.to}
                  </span>
                </div>
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-3">
                  <AnimatePresence initial={false} mode="popLayout">
                    {/* Keyed by place in the chapter (not in the filtered list), so filtering animates instead of remounting. */}
                    {ch.rewards.map((r, i) => (show(r) ? <RewardTile key={`${ch.n}-${i}`} r={r} /> : null))}
                  </AnimatePresence>
                </ul>
              </motion.div>
            ))}
        </AnimatePresence>
      </div>
    </section>
  );
}

function RewardTile({ r }: { r: Reward }) {
  return (
    <motion.li
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: SOFT.out } }}
      transition={{ duration: SOFT.in, ease: SOFT.ease }}
      className={`group flex flex-col rounded-xl border p-2.5 transition-colors ${SOFT_CSS} ${r.free ? "border-line bg-panel-2/30" : "border-line bg-panel-2/55"} hover:border-line-strong`}
    >
      {/* The picture is pinned to the box (absolute), so it scales to fit instead of overflowing at its own size. */}
      <div className="relative h-[112px] overflow-hidden rounded-lg bg-[color-mix(in_oklab,var(--bg)_35%,transparent)]">
        {r.kind === "title" ? (
          <span className="absolute inset-0 grid place-items-center px-3 text-center font-display text-[15px] font-semibold leading-tight">“{r.name}”</span>
        ) : r.image ? (
          <SkinImage src={r.image} size="md" className={`absolute inset-0 h-full w-full transition-transform ${SOFT_CSS} group-hover:scale-[1.06] ${FIT[r.kind]}`} />
        ) : (
          <span className="absolute inset-0 grid place-items-center">
            <Gift size={26} className="text-faint" />
          </span>
        )}
      </div>
      <div className="mt-2 line-clamp-2 min-h-[2.75em] text-[12.5px] font-medium leading-snug" title={r.name}>
        {r.kind === "title" ? "Player title" : r.name}
      </div>
      <div className="mt-1 flex items-center gap-1.5 whitespace-nowrap text-[11.5px] text-faint">
        {r.free ? <Badge tone="info">Free</Badge> : <span className="num">Lv {r.level}</span>}
        <span className="truncate">· {kindLabel(r.kind)}</span>
      </div>
    </motion.li>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border border-line bg-panel-2/40 px-5 py-6 text-center text-[13px] text-muted">{children}</p>;
}
