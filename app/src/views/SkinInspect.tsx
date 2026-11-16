/**
 * "Inspect": one skin in a large centred window, like the game's collection screen. A big render lit with the
 * edition's colour and the variant swatches on the left; the edition, purchase, levels and the rest of its
 * collection on the right. ← / → (or the arrows on the stage) step through your skins without closing.
 * Built from the sections in SkinDetail.tsx, in the shared window (components/InspectWindow.tsx).
 */
import { InspectHeader, InspectWash, InspectWindow, type InspectNav } from "../components/InspectWindow";
import { MissingNote, SkinBadges, SkinFacts, SkinFamily, SkinHero, SkinLevels, SkinVariants, useSkinModel, type SkinDetailProps } from "./SkinDetail";

interface InspectProps extends InspectNav {
  /** null = closed */
  detail: SkinDetailProps | null;
}

export function SkinInspect({ detail, ...nav }: InspectProps) {
  return (
    <InspectWindow open={!!detail} label={detail?.item.name ?? ""} {...nav}>
      {/* Keyed per purchase: stepping to another skin starts with its base variant, not the last one's pick. */}
      {detail && <Body key={detail.item.r.transaction_id} detail={detail} {...nav} />}
    </InspectWindow>
  );
}

function Body({ detail, ...nav }: InspectNav & { detail: SkinDetailProps }) {
  const m = useSkinModel(detail);
  return (
    <>
      {/* The whole window takes a soft wash of the edition's colour. */}
      <InspectWash tint={m.tint} />
      <InspectHeader eyebrow={m.skin?.weapon ?? detail.item.weapon} title={detail.item.name} {...nav} />

      {/* Wide: two columns that scroll on their own. Narrow: one column that scrolls as a whole, every part at
          its natural height (letting the columns shrink is what made sections overlap). */}
      <div className="scroll-thin relative z-10 grid min-h-0 flex-1 content-start gap-6 overflow-y-auto px-7 pb-7 pt-3 max-sm:px-5 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] md:content-stretch md:overflow-hidden">
        {/* Stage: the render and its variants. */}
        <div className="flex flex-col gap-5 md:min-h-0">
          <SkinHero m={m} className="h-56 shrink-0 md:h-auto md:min-h-[200px] md:flex-1" />
          <SkinVariants m={m} p={detail} big />
          <SkinBadges m={m} p={detail} />
        </div>
        {/* Details: scroll on their own so the stage stays put. */}
        <div className="scroll-thin min-h-0 space-y-7 md:-mr-3 md:overflow-y-auto md:pr-3">
          <SkinFacts m={m} p={detail} />
          <SkinLevels m={m} p={detail} />
          <SkinFamily m={m} p={detail} />
          {!m.skin && detail.item.category !== "Bundle" && <MissingNote />}
        </div>
      </div>
    </>
  );
}
