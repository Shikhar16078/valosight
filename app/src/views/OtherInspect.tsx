/**
 * One "other" purchase (Kingdom Credits, agent recruitment tokens) in the Inspect window: the item's picture when
 * Riot named it (a spray, gun buddy, player card, flex), your purchase, and what Riot did or didn't record.
 * ← / → step through the list as shown, newest first.
 */
import { ArrowUpRight, Info } from "lucide-react";
import { InspectHeader, InspectWash, InspectWindow, type InspectNav } from "../components/InspectWindow";
import { SkinImage } from "../components/SkinImage";
import { SOFT_CSS } from "../components/anim";
import { useDateGuard } from "../lib/privacy-dates";
import { useSettings } from "../lib/settings";
import { currencyUnit, n0, type OtherItem } from "../lib/valorant";

export interface OtherDetailProps {
  item: OtherItem;
  /** the item's own picture (named accessories), else null */
  image: string | null;
  /** the icon of what was spent (Kingdom Credits, an agent token) */
  currencyIcon: string | null;
  onShowInList?: () => void;
}

const SOURCE: Record<string, string> = {
  Accessory: "Accessory store",
  Agentboardstatmodules: "Agent gear",
  "Character Level": "Agent recruitment",
};

/** What Riot leaves out for each kind, said plainly. */
function explain(o: OtherItem): string | null {
  if (o.kind === "Agent unlock") return "Riot's export records that an agent was recruited with a token, but not which agent.";
  if (o.kind === "Agent gear") return "Riot's export records agent gear only by an internal catalogue number, which the public game data doesn't list, so the item can't be named.";
  if (o.note) return "Riot's export doesn't name this item.";
  return null;
}

export function OtherInspect({ detail, ...nav }: InspectNav & { detail: OtherDetailProps | null }) {
  return (
    <InspectWindow open={!!detail} label={detail?.item.name ?? ""} fit {...nav}>
      {detail && <Body key={detail.item.r.transaction_id} detail={detail} {...nav} />}
    </InspectWindow>
  );
}

function Body({ detail, ...nav }: InspectNav & { detail: OtherDetailProps }) {
  const { item, image, currencyIcon } = detail;
  const { f } = useSettings();
  const guard = useDateGuard();
  const u = currencyUnit(item.currency);
  const unit = u.short === "token" ? (item.cost === 1 ? "token" : "tokens") : u.many;
  const src = String(item.r.transaction_source ?? "").trim();
  const why = explain(item);
  return (
    <>
      <InspectWash tint="var(--accent)" />
      <InspectHeader eyebrow={item.kind} title={item.name} {...nav} />
      <div className="scroll-thin relative z-10 grid min-h-0 flex-1 content-start gap-6 overflow-y-auto px-7 pb-7 pt-3 max-sm:px-5 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Stage item={item} image={image} currencyIcon={currencyIcon} />
        <div className="space-y-5">
          <section className="rounded-2xl border border-win/25 bg-win/[0.06] px-5 py-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-win">Your purchase</h3>
              {detail.onShowInList && (
                <button type="button" onClick={detail.onShowInList} className={`flex items-center gap-1 text-[12px] text-muted transition-colors ${SOFT_CSS} hover:text-win`}>
                  Show in list <ArrowUpRight size={13} />
                </button>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-[13px]">
              <Fact k="Bought" v={item.t ? guard(item.t, f.date(item.t)) : "—"} />
              <Fact k="Paid" v={`${n0(item.cost)} ${unit}`} />
              <Fact k="Type" v={item.kind} />
              <Fact k="Where" v={SOURCE[src] ?? (src || "Not recorded")} />
            </dl>
          </section>
          {why && (
            <section className="flex gap-3 rounded-2xl border border-info/25 bg-info/[0.06] px-5 py-4 text-[13px] leading-relaxed">
              <Info size={17} className="mt-0.5 shrink-0 text-info" />
              <p className="text-muted">{why}</p>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * The item's picture, laid out for its shape and resolution: a player card shows all three of its pictures (tall,
 * wide and small, as the game uses them); gun buddies, flex and currency icons are only 128 px, so they're shown
 * near that size instead of blown up and blurry; sprays fill the stage.
 */
function Stage({ item, image, currencyIcon }: { item: OtherItem; image: string | null; currencyIcon: string | null }) {
  const card = image && /\/largeart\.png$/.test(image) ? image.replace(/\/largeart\.png$/, "") : null;
  const small = !card && (item.kind === "Gun buddy" || item.kind === "Flex");
  return (
    <div
      className="relative h-72 overflow-hidden rounded-2xl border border-line md:h-[440px]"
      style={{ background: "radial-gradient(70% 90% at 50% 60%, color-mix(in oklab, var(--accent) 18%, transparent), transparent 75%), color-mix(in oklab, var(--panel-2) 55%, transparent)" }}
    >
      {card ? (
        <div className="absolute inset-0 flex items-center justify-center gap-5 p-5 md:gap-7 md:p-7">
          <Art src={`${card}/largeart.png`} label="Tall" tall className="min-h-0 w-auto flex-1" />
          <div className="flex min-w-0 max-w-[340px] flex-1 flex-col justify-center gap-5">
            <Art src={`${card}/wideart.png`} label="Wide" className="h-auto w-full" />
            <Art src={`${card}/smallart.png`} label="Small" className="h-20 w-20 md:h-24 md:w-24" />
          </div>
        </div>
      ) : image ? (
        <SkinImage src={image} size={small ? "md" : "lg"} className={small ? "absolute inset-0 m-auto h-[min(60%,208px)] w-[min(60%,208px)]" : "absolute inset-[8%] h-[84%] w-[84%]"} />
      ) : (
        <div className="absolute inset-0 grid place-items-center">
          <div className="flex flex-col items-center gap-3 text-center">
            <SkinImage src={currencyIcon} size="sm" className="h-20 w-20 opacity-40" />
            <span className="text-[12.5px] text-faint">No picture: Riot didn't name the item</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** One picture of a player card, with a small caption under it. */
function Art({ src, label, className, tall = false }: { src: string; label: string; className: string; tall?: boolean }) {
  return (
    <figure className={`flex min-h-0 shrink-0 flex-col justify-center gap-1.5 ${tall ? "h-full items-center" : "items-start"}`}>
      <SkinImage src={src} size="md" className={`min-h-0 rounded-lg shadow-[var(--shadow-2)] ${className}`} />
      <figcaption className="text-[11px] uppercase tracking-[0.12em] text-faint">{label}</figcaption>
    </figure>
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
