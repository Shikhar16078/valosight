import { useEffect, useMemo, useState } from "react";
import { PrivacyGate } from "../lib/privacy";
import { useAccount, useRecords } from "../lib/account";
import type { Rec } from "../lib/api";
import { useSettings } from "../lib/settings";
import { titleCase } from "../lib/valorant";
import { Badge, Card, Page } from "../components/ui";
import { DataTable, type Col } from "../components/DataTable";

const show = (v: unknown) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

export function DataBrowser() {
  const { detail } = useAccount();
  const { f } = useSettings();
  const list = useMemo(() => (detail?.datasets ?? []).filter((d) => d.count > 0), [detail]);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    if (!sel || !list.some((d) => d.dataset === sel)) setSel(list.find((d) => d.mode !== "snapshot")?.dataset ?? list[0]?.dataset ?? null);
  }, [list, sel]);
  const info = list.find((d) => d.dataset === sel);
  const recs = useRecords(sel && info?.mode !== "snapshot" ? sel : "__none__");

  const cols = useMemo<Col<Rec>[]>(() => {
    const keys: string[] = [];
    for (const r of recs.data.slice(0, 200)) for (const k of Object.keys(r)) if (!k.startsWith("_") && !keys.includes(k)) keys.push(k);
    return [
      { id: "_t", header: `Time (${f.tzLabel})`, value: (r) => r._t ?? "", cell: (r) => <span className="num">{r._t ? f.dateTime(r._t, true) : "—"}</span> },
      ...keys.map<Col<Rec>>((k) => ({ id: k, header: titleCase(k), value: (r) => show(r[k]), cell: (r) => <span title={show(r[k])} className="block max-w-[340px] truncate text-[13px]">{show(r[k])}</span> })),
    ];
  }, [recs.data, f]);

  return (
    <Page code="06 / Raw data" title="Every data file" sub="Exactly what Riot sent, merged across imports. Files from any game appear here, even ones this app has no special page for.">
      <PrivacyGate what="Raw data files">
      <Card span={3} title="Files" pad={false}>
        <ul className="scroll-thin max-h-[70vh] overflow-y-auto py-1">
          {list.map((d) => (
            <li key={d.dataset}>
              <button onClick={() => setSel(d.dataset)} className={`flex w-full items-start justify-between gap-2 px-4 py-2 text-left hover:bg-panel-2 ${sel === d.dataset ? "bg-panel-2" : ""}`}>
                <span className="min-w-0">
                  <span className={`block truncate text-[13px] ${sel === d.dataset ? "font-semibold text-accent" : "font-medium"}`}>{d.label ?? titleCase(d.dataset.split("/")[1])}</span>
                  <span className="block truncate font-mono text-[11px] text-faint">{d.dataset}</span>
                </span>
                <span className="num shrink-0 text-[12px] text-muted">{d.mode === "snapshot" ? "obj" : d.count.toLocaleString("en")}</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <div className="col-span-12 min-w-0 xl:col-span-9">
        {info && (
          <Card
            title={info.label ?? titleCase(info.dataset.split("/")[1])}
            hint={
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{info.dataset}</span>
                {!info.known && <Badge tone="info">new file type — shown as-is</Badge>}
                {info.first && (
                  <span className="num">
                    {f.date(info.first)} → {f.date(info.last)}
                  </span>
                )}
              </span>
            }
            pad={info.mode === "snapshot"}
          >
            {info.mode === "snapshot" ? (
              <pre className="scroll-thin overflow-x-auto rounded-lg bg-panel-2 p-4 font-mono text-[12.5px] leading-relaxed">{JSON.stringify(detail?.snapshots[info.dataset], null, 2)}</pre>
            ) : (
              <DataTable rows={recs.data} cols={cols} initialSort={{ id: "_t", desc: true }} filename={info.dataset.replace("/", "_")} />
            )}
          </Card>
        )}
      </div>
      </PrivacyGate>
    </Page>
  );
}
