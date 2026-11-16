import { useMemo } from "react";
import { useAccount, useRecords } from "../lib/account";
import type { Rec } from "../lib/api";
import { useSettings } from "../lib/settings";
import { DS, PENALTY, titleCase } from "../lib/valorant";
import { Badge, Card, Empty, Page, Stat } from "../components/ui";
import { DataTable, type Col } from "../components/DataTable";

const statusTone = (s: string) => (/active/i.test(s) ? "accent" : /overturn/i.test(s) ? "win" : "neutral") as "accent" | "win" | "neutral";

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
          <div className="mb-3 grid grid-cols-[1fr_minmax(0,1fr)_170px_minmax(0,1fr)] items-center gap-3 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-muted">
            <span className="text-right text-info">You reported · {tm}</span>
            <span />
            <span className="text-center">Reason</span>
            <span className="text-warn">Against you · {tg}</span>
          </div>
          <div className="space-y-1.5">
            {rows.map((r) => (
              <div key={r.k} className="grid grid-cols-[1fr_minmax(0,1fr)_170px_minmax(0,1fr)] items-center gap-3">
                <span className="num text-right text-[13px]">{r.made || ""}</span>
                <div className="flex justify-end">
                  <div className="h-3 rounded-l-full bg-info" style={{ width: `${(r.made / max) * 100}%` }} />
                </div>
                <span className="truncate text-center text-[13px]">{titleCase(r.k)}</span>
                <div className="flex items-center gap-2">
                  <div className="h-3 rounded-r-full bg-warn" style={{ width: `${(r.got / max) * 100}%` }} />
                  <span className="num text-[13px]">{r.got || ""}</span>
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

  const active = pen.data.filter((p) => /active/i.test(p.status ?? "")).length;
  const overturned = pen.data.filter((p) => /overturn/i.test(p.status ?? "")).length;
  const lines = useMemo(() => tr.data.reduce((a, t) => a + (t.chat_lines?.filter((l: any) => l.transcript).length ?? 0), 0), [tr.data]);

  const cols: Col<Rec>[] = [
    { id: "date", header: "Date", value: (r) => r._t, cell: (r) => <span className="num">{f.dateTime(r._t)}</span> },
    { id: "type", header: "Penalty", value: (r) => PENALTY[r.restriction_type] ?? titleCase(r.restriction_type ?? "") },
    { id: "reason", header: "Reason", value: (r) => titleCase(r.restriction_reason ?? "") },
    { id: "sentence", header: "Sentence", value: (r) => titleCase(r.sentence ?? "") },
    { id: "status", header: "Status", value: (r) => r.status, cell: (r) => <Badge tone={statusTone(r.status ?? "")}>{titleCase(r.status ?? "")}</Badge> },
    { id: "by", header: "Issued", value: (r) => (r.is_manual ? "By a person" : "Automatic") },
    { id: "game", header: "Game", value: (r) => r.scope },
  ];

  return (
    <Page code="05 / Conduct" loading={pen.loading || tr.loading} title="Penalties & reports" sub={`Times in ${f.tzLabel}`}>
      <Stat label="Penalties" value={pen.data.length} />
      <Stat label="Active now" value={active} tone={active ? "accent" : "win"} sub={active ? "currently restricted" : "nothing active"} />
      <Stat label="Overturned" value={overturned} tone="win" />
      <Stat label="Voice transcripts" value={tr.data.length} sub={`${lines} lines with text`} />

      <Card span={12} title="Penalty history" pad={false}>
        {pen.data.length ? <DataTable rows={pen.data} cols={cols} initialSort={{ id: "date", desc: true }} filename="penalties" rowTone={(r) => (/active/i.test(r.status ?? "") ? "accent" : undefined)} /> : <div className="p-5"><Empty title="No penalties">Clean record.</Empty></div>}
      </Card>

      {reports.map((r) => (
        <Reports key={r.ds} title={r.title} data={detail!.snapshots[r.ds]} />
      ))}
    </Page>
  );
}
