import { useMemo, useState } from "react";
import { useDateGuard } from "../lib/privacy-dates";
import { PrivacyGate } from "../lib/privacy";
import { useAccount, useRecords } from "../lib/account";
import type { Rec } from "../lib/api";
import { useSettings } from "../lib/settings";
import { DS, PENALTY, titleCase, isActivePenalty } from "../lib/valorant";
import { Badge, Card, Empty, Page, Stat } from "../components/ui";
import { DataTable, type Col, type Facet, type Preset } from "../components/DataTable";
import { Drawer } from "../components/Drawer";
import { scrollToSection } from "../lib/focus";

const statusTone = (s: string) => (isActivePenalty(s) ? "accent" : /overturn/i.test(s) ? "win" : "neutral") as "accent" | "win" | "neutral";

function Reports({ title, data }: { title: string; data: { reports_made?: Record<string, number>; reports_received?: Record<string, number> } }) {
  const keys = [...new Set([...Object.keys(data.reports_made ?? {}), ...Object.keys(data.reports_received ?? {})])];
  const rows = keys
    .map((k) => ({ k, made: data.reports_made?.[k] ?? 0, got: data.reports_received?.[k] ?? 0 }))
    .sort((a, b) => b.made + b.got - (a.made + a.got));
  const max = Math.max(1, ...rows.flatMap((r) => [r.made, r.got]));
  const tm = rows.reduce((a, r) => a + r.made, 0);
  const tg = rows.reduce((a, r) => a + r.got, 0);
  return (
    <Card span={12} title={title} hint="Counts only — Riot does not include who reported whom">
      {rows.length === 0 ? (
        <div className="py-6 text-center text-muted">No reports recorded.</div>
      ) : (
        <>
          {/* Mirrored around a centred Reason column: each side's bar grows outward from the middle and its
              number sits at the bar's end. Bars share one scale; 40px is kept for the number. */}
          <div className="mb-3 grid grid-cols-[minmax(0,1fr)_200px_minmax(0,1fr)] items-center gap-4 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-muted">
            <span className="text-right text-info">You reported · {tm}</span>
            <span className="text-center">Reason</span>
            <span className="text-warn">Against you · {tg}</span>
          </div>
          <div className="space-y-1.5">
            {rows.map((r) => (
              <div key={r.k} className="grid grid-cols-[minmax(0,1fr)_200px_minmax(0,1fr)] items-center gap-4">
                <div className="flex items-center justify-end gap-2">
                  {r.made > 0 && (
                    <>
                      <span className="num text-[13px]">{r.made}</span>
                      <div className="h-3 rounded-l-full bg-info" style={{ width: `calc((100% - 40px) * ${r.made / max})` }} />
                    </>
                  )}
                </div>
                <span className="truncate text-center text-[13px]">{titleCase(r.k)}</span>
                <div className="flex items-center gap-2">
                  {r.got > 0 && (
                    <>
                      <div className="h-3 rounded-r-full bg-warn" style={{ width: `calc((100% - 40px) * ${r.got / max})` }} />
                      <span className="num text-[13px]">{r.got}</span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

export function Conduct() {
  const { detail } = useAccount();
  const { f } = useSettings();
  const guard = useDateGuard();
  const pen = useRecords(DS.penalties);
  const tr = useRecords(DS.transcripts);
  const reports = [
    { ds: DS.vReports, title: "VALORANT reports" },
    { ds: DS.lolReports, title: "League of Legends reports" },
    { ds: DS.tftReports, title: "TFT reports" },
  ].filter((r) => {
    const d = detail?.snapshots[r.ds];
    return d && (Object.keys(d.reports_made ?? {}).length || Object.keys(d.reports_received ?? {}).length);
  });

  const active = pen.data.filter((p) => isActivePenalty(p.status)).length;
  const overturned = pen.data.filter((p) => /overturn/i.test(p.status ?? "")).length;
  const lines = useMemo(() => tr.data.reduce((a, t) => a + (t.chat_lines?.filter((l: any) => l.transcript).length ?? 0), 0), [tr.data]);

  const [preset, setPreset] = useState<Preset<Rec> | null>(null);
  const [trOpen, setTrOpen] = useState(false);
  const showPenalties = (p: Preset<Rec> | null) => {
    setPreset(p);
    scrollToSection("penalties");
  };
  const mmss = (ms: unknown) => {
    const t = Math.floor(Number(ms) / 1000);
    return Number.isFinite(t) ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}` : "";
  };

  const penFacets = useMemo<Facet<Rec>[]>(
    () => [
    { id: "status", label: "Status", value: (r) => titleCase(r.status ?? "") || null },
    { id: "type", label: "Penalty", value: (r) => PENALTY[r.restriction_type] ?? (titleCase(r.restriction_type ?? "") || null) },
    { id: "game", label: "Game", value: (r) => r.scope },
  ],
    [],
  );

  const cols: Col<Rec>[] = [
    { id: "date", header: "Date", value: (r) => r._t, cell: (r) => <span className="num">{guard(r._t, f.dateTime(r._t))}</span> },
    { id: "type", header: "Penalty", value: (r) => PENALTY[r.restriction_type] ?? titleCase(r.restriction_type ?? "") },
    { id: "reason", header: "Reason", value: (r) => titleCase(r.restriction_reason ?? "") },
    { id: "sentence", header: "Sentence", value: (r) => titleCase(r.sentence ?? "") },
    { id: "status", header: "Status", value: (r) => r.status, cell: (r) => <Badge tone={statusTone(r.status ?? "")}>{titleCase(r.status ?? "")}</Badge> },
    { id: "by", header: "Issued", value: (r) => (r.is_manual ? "By a person" : "Automatic") },
    { id: "game", header: "Game", value: (r) => r.scope },
  ];

  return (
    <Page code="05 / Conduct" loading={pen.loading || tr.loading} title="Penalties & reports" sub={`Times in ${f.tzLabel}`}>
      <Stat label="Penalties" onClick={pen.data.length ? () => showPenalties(null) : undefined} action="Show every penalty" value={pen.data.length} />
      <Stat label="Active now" onClick={active ? () => showPenalties({ label: "Active", test: (r) => isActivePenalty(r.status) }) : undefined} action="Show active penalties" value={active} tone={active ? "accent" : "win"} sub={active ? "currently restricted" : "nothing active"} />
      <Stat label="Overturned" onClick={overturned ? () => showPenalties({ label: "Overturned", test: (r) => /overturn/i.test(r.status ?? "") }) : undefined} action="Show overturned penalties" value={overturned} tone="win" />
      <Stat label="Voice transcripts" onClick={tr.data.length ? () => setTrOpen(true) : undefined} action="Read your voice transcripts" value={tr.data.length} sub={`${lines} lines with text`} />

      {reports
        .filter((r) => r.ds === DS.vReports)
        .map((r) => (
          <Reports key={r.ds} title={r.title} data={detail!.snapshots[r.ds]} />
        ))}

      <Card id="penalties" span={12} title="Penalty history" pad={false}>
        {pen.data.length ? <DataTable rows={pen.data} cols={cols} preset={preset} onClearPreset={() => setPreset(null)} facets={penFacets} initialSort={{ id: "date", desc: true }} filename="penalties" rowTone={(r) => (isActivePenalty(r.status) ? "accent" : undefined)} /> : <div className="p-5"><Empty title="No penalties">Clean record.</Empty></div>}
      </Card>

      {reports
        .filter((r) => r.ds !== DS.vReports)
        .map((r) => (
          <Reports key={r.ds} title={r.title} data={detail!.snapshots[r.ds]} />
        ))}
      <Drawer open={trOpen} onClose={() => setTrOpen(false)} title={`Voice transcripts · ${tr.data.length}`} hint="What Riot's voice evaluation transcribed, newest first. Times are from the start of the recording.">
        <PrivacyGate what="Voice transcripts">
        <ol className="divide-y divide-line">
          {[...tr.data]
            .sort((a, b) => (b._t ?? "").localeCompare(a._t ?? ""))
            .map((t, i) => {
              const ls = (t.chat_lines ?? []).filter((l: any) => l.transcript);
              return (
                <li key={t._id ?? i} className="px-5 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="num text-[12.5px] font-medium">{t._t ? f.dateTime(t._t) : "Date not recorded"}</span>
                    <span className="num text-[12px] text-muted">{ls.length} lines</span>
                  </div>
                  <ul className="mt-1.5 space-y-0.5 text-[13px]">
                    {ls.map((l: any, j: number) => (
                      <li key={j} className="grid grid-cols-[44px_1fr] gap-2">
                        <span className="num text-[11.5px] text-faint">{mmss(l.time_start)}</span>
                        <span>{l.transcript}</span>
                      </li>
                    ))}
                    {!ls.length && <li className="text-muted">No speech was transcribed.</li>}
                  </ul>
                </li>
              );
            })}
        </ol>
        </PrivacyGate>
      </Drawer>
    </Page>
  );
}
