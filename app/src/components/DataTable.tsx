import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, Filter, Search, X } from "lucide-react";
import { motion } from "motion/react";
import { usePrivacy } from "../lib/privacy";
import { AutoHeight, Collapse, Pop, SOFT, SOFT_CSS } from "./anim";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export interface Col<T> {
  id: string;
  header: string;
  value: (r: T) => string | number | null | undefined; // used for sort, search, export
  cell?: (r: T) => ReactNode;
  align?: "right" | "left";
  width?: number;
  mono?: boolean;
  wrap?: boolean;
  /** Masked in privacy mode (IPs, IDs): left out of search then, so a guess can't be confirmed by the results. */
  secret?: boolean;
}

/** A filter set from outside the table (e.g. by clicking a card): shown as a removable chip in the toolbar. */
export interface Preset<T> {
  label: string;
  test: (r: T) => boolean;
}

/**
 * A dropdown filter in the table's toolbar (e.g. Year, Method). Its options are the distinct values in the
 * rows, with counts. `order` sorts them (default: most common first).
 */
export interface Facet<T> {
  id: string;
  label: string;
  value: (r: T) => string | null | undefined;
  order?: (a: string, b: string) => number;
  /**
   * Show this filter only when it applies (e.g. Weapon only for skins), given the other filters' picks and the
   * rows an outside `preset` leaves. Its own pick is dropped (and ignored) while it's hidden.
   */
  when?: (picked: Record<string, string>, rows: T[]) => boolean;
}

const ALL = 1_000_000;
const PAGE_SIZES = [10, 25, 50, 100, ALL];

export function DataTable<T>({
  rows,
  cols,
  initialSort,
  pageSize = 10,
  filename = "export",
  rowTone,
  toolbar,
  searchPlaceholder = "Search…",
  expand,
  preset,
  onClearPreset,
  sortBy,
  facets,
}: {
  /** Dropdown filters shown in the toolbar (see Facet). Pass them memoized (useMemo): a new array recounts. */
  facets?: Facet<T>[];
  rows: T[];
  /** Outside filter (see Preset); `onClearPreset` is called by the chip's ✕. */
  preset?: Preset<T> | null;
  onClearPreset?: () => void;
  /** Outside sort request; a new object re-applies it. */
  sortBy?: { id: string; desc: boolean } | null;
  cols: Col<T>[];
  initialSort?: { id: string; desc: boolean };
  pageSize?: number;
  filename?: string;
  rowTone?: (r: T) => "warn" | "accent" | undefined;
  toolbar?: ReactNode;
  searchPlaceholder?: string;
  /** When set, clicking a row opens this detail panel underneath it. */
  expand?: (r: T) => ReactNode;
}) {
  const { hidden } = usePrivacy();
  const sizeKey = `riotvault.rows.${filename}`;
  const [initialSize] = useState(() => {
    try {
      const v = Number(localStorage.getItem(sizeKey));
      return PAGE_SIZES.includes(v) ? v : pageSize;
    } catch {
      return pageSize;
    }
  });
  // Expanded rows are remembered by the row itself, not its index: filters change which row sits at index 3.
  const [open, setOpen] = useState<Set<T>>(new Set());
  const toggle = (id: T) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const [sorting, setSorting] = useState<SortingState>(initialSort ? [initialSort] : []);
  const [q, setQ] = useState("");
  useEffect(() => {
    if (sortBy) setSorting([sortBy]);
  }, [sortBy]);
  const [picked, setPickedRaw] = useState<Record<string, string>>({});
  const presetRows = useMemo(() => (preset ? rows.filter(preset.test) : rows), [rows, preset]);
  const applies = (fc: Facet<T>, p: Record<string, string>) => !fc.when || fc.when(p, presetRows);
  // A filter that stops applying (its `when` turns false) hides and lets go of its pick, so nothing filters invisibly.
  const setPicked = (next: Record<string, string> | ((p: Record<string, string>) => Record<string, string>)) =>
    setPickedRaw((p) => {
      const n = typeof next === "function" ? next(p) : next;
      const out = { ...n };
      for (const fc of facets ?? []) if (!applies(fc, out)) delete out[fc.id];
      return out;
    });
  // Views pass `facets` memoized (useMemo), so these recount only when the facets or rows really change, and
  // the table doesn't jump back to page 1 on every re-render.
  // Each facet's options are counted over the rows the other filters leave, so the numbers stay honest.
  const facetOptions = useMemo(
    () =>
      (facets ?? []).map((fc, _i, all) => {
        const base = presetRows.filter((r) => all.every((o) => o.id === fc.id || !picked[o.id] || !applies(o, picked) || (o.value(r) || "—") === picked[o.id]));
        const m = new Map<string, number>();
        for (const r of base) {
          const v = fc.value(r) || "—";
          m.set(v, (m.get(v) ?? 0) + 1);
        }
        // A picked value the rows no longer have (e.g. after changing the period) stays listed at 0, so the
        // dropdown shows it and the empty table has a visible reason instead of a silent "All".
        if (picked[fc.id] && !m.has(picked[fc.id])) m.set(picked[fc.id], 0);
        return { fc, opts: [...m.entries()].sort((a, b) => (fc.order ? fc.order(a[0], b[0]) : b[1] - a[1] || a[0].localeCompare(b[0]))) };
      }),
    [facets, presetRows, picked], // eslint-disable-line react-hooks/exhaustive-deps -- applies() reads the same inputs
  );
  const facetOn = Object.values(picked).some(Boolean);
  const data = useMemo(() => {
    let out = presetRows;
    const fs = facets;
    if (fs && facetOn) out = out.filter((r) => fs.every((fc) => !picked[fc.id] || !applies(fc, picked) || (fc.value(r) || "—") === picked[fc.id]));
    return out;
  }, [presetRows, picked, facetOn, facets]); // eslint-disable-line react-hooks/exhaustive-deps
  const columns = useMemo<ColumnDef<T>[]>(
    () =>
      cols.map((c) => ({
        id: c.id,
        header: c.header,
        accessorFn: (r: T) => c.value(r) ?? "",
        cell: (ctx) => (c.cell ? c.cell(ctx.row.original) : String(c.value(ctx.row.original) ?? "")),
        sortingFn: "alphanumeric",
        // Masked columns (IPs, IDs) can't be sorted while hidden: the order would hint at the hidden values.
        enableSorting: !(c.secret && hidden),
        meta: c,
      })),
    [cols, hidden],
  );
  // Columns offered in the sort control: masked ones are left out while hidden (like search).
  const sortable = useMemo(() => cols.filter((c) => !(c.secret && hidden)), [cols, hidden]);
  // Sorted by a masked column when privacy mode comes back on: back to the table's normal order.
  useEffect(() => {
    if (hidden && sorting[0] && cols.find((c) => c.id === sorting[0].id)?.secret) setSorting(initialSort ? [initialSort] : []);
  }, [hidden]); // eslint-disable-line react-hooks/exhaustive-deps
  const table = useReactTable({
    data,
    columns,
    // The search carries the privacy state too, so turning privacy mode on or off re-runs it (secret columns
    // are only searchable while revealed).
    state: { sorting, globalFilter: q ? { q, hidden } : "" },
    onSortingChange: setSorting,
    globalFilterFn: (row, _id, v: { q: string; hidden: boolean }) => {
      const s = v.q.toLowerCase();
      const hidden = v.hidden;
      return cols.some((c) => !(c.secret && hidden) && String(c.value(row.original) ?? "").toLowerCase().includes(s));
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: initialSize } },
    autoResetPageIndex: true,
  });

  const exportCsv = () => {
    const esc = (v: unknown) => {
      let s = String(v ?? "");
      // Text that starts like a formula (e.g. "=HYPERLINK(...)" in another player's name or a transcript)
      // would run when the CSV is opened in Excel or Sheets; a leading ' makes it plain text. Numbers are left as they are.
      if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.map((c) => esc(c.header)).join(",")];
    for (const r of table.getSortedRowModel().rows.filter((x) => table.getFilteredRowModel().rowsById[x.id]))
      lines.push(cols.map((c) => esc(c.value(r.original))).join(","));
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${filename}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  };

  const total = table.getFilteredRowModel().rows.length;
  const { pageIndex, pageSize: ps } = table.getState().pagination;

  // The rows fade in (opacity only, light enough for "All" rows) whenever what they show changes: a page, the
  // page size, the sort, a filter or new data. Not while typing a search (that would flicker), and not on the
  // first render. No sliding: moving rows sideways made the table wider than its box and flashed a scrollbar.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);
  const first = cols[0];
  const rowsKey = [pageIndex, ps, JSON.stringify(sorting), data.length, ...data.slice(0, 3).map((r) => String(first?.value(r) ?? ""))].join("|");
  const [everOpen, setEverOpen] = useState<Set<T>>(new Set());
  // Forget expanded rows that are no longer in the table (new period, new account, refetched rows).
  useEffect(() => {
    const keep = new Set(data);
    const prune = (s: Set<T>) => ([...s].every((r) => keep.has(r)) ? s : new Set([...s].filter((r) => keep.has(r))));
    setOpen(prune);
    setEverOpen(prune);
  }, [data]);
  useEffect(() => {
    if (open.size) setEverOpen((e) => (([...open].every((x) => e.has(x)) ? e : new Set([...e, ...open]))));
  }, [open]);
  const go = (i: number) => table.setPageIndex(i);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <label className="flex min-w-[220px] flex-1 items-center gap-2 field rounded-lg border border-line bg-panel-2 px-2.5 py-1.5">
          <Search size={15} className="text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} className="w-full bg-transparent outline-none placeholder:text-faint" />
        </label>
        {facetOptions.map(({ fc, opts }) => (
          <Pop key={fc.id} show={(opts.length > 1 || !!picked[fc.id]) && applies(fc, picked)}>
            <label className={`field flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] transition-colors ${SOFT_CSS} ${picked[fc.id] ? "border-accent bg-accent-soft" : "border-line bg-panel-2"}`}>
              <span className="text-muted">{fc.label}</span>
              <select value={picked[fc.id] ?? ""} onChange={(e) => setPicked((p) => ({ ...p, [fc.id]: e.target.value }))} className={`max-w-[160px] bg-transparent font-medium outline-none ${picked[fc.id] ? "text-accent" : ""}`}>
                <option value="">All</option>
                {opts.map(([v, n]) => (
                  <option key={v} value={v}>
                    {v} ({n})
                  </option>
                ))}
              </select>
            </label>
          </Pop>
        ))}
        <Pop show={facetOn}>
          <button type="button" onClick={() => setPicked({})} className="text-[12.5px] font-medium text-accent hover:underline">
            Clear filters
          </button>
        </Pop>
        <Pop show={!!preset}>
          <span className="flex items-center gap-1.5 rounded-full border border-accent bg-accent-soft py-0.5 pl-2.5 pr-1 text-[12.5px] font-medium text-accent">
            <Filter size={12} />
            {preset?.label}
            {onClearPreset && (
              <button type="button" onClick={onClearPreset} aria-label={`Remove filter: ${preset?.label}`} className="rounded-full p-0.5 hover:bg-accent/15">
                <X size={13} />
              </button>
            )}
          </span>
        </Pop>
        {toolbar}
        <span className="num ml-auto text-[12px] text-muted">{total.toLocaleString("en")} {total === 1 ? "row" : "rows"}</span>
        <button onClick={exportCsv} className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] font-medium hover:bg-panel-2">
          <Download size={14} /> CSV
        </button>
      </div>
      {total > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-2 border-b border-line px-4 py-2 text-[12.5px] text-muted">
          {/* Sorting, spelled out (clicking a column header does the same, but few people notice that). */}
          <SortControl cols={sortable} rows={data} sorting={sorting} onChange={(id, desc) => setSorting(id ? [{ id, desc }] : [])} />
          {total > PAGE_SIZES[0] && (
            <>
          <label className="flex items-center gap-2">
            Rows per page
            <select
              value={ps >= ALL ? "all" : ps}
              onChange={(e) => {
                const v = e.target.value === "all" ? ALL : Number(e.target.value);
                table.setPageSize(v);
                table.setPageIndex(0);
                try {
                  localStorage.setItem(sizeKey, String(v));
                } catch {
                  /* ignore */
                }
              }}
              className="num rounded-md border border-line bg-panel px-1.5 py-0.5 text-ink"
            >
              {PAGE_SIZES.filter((n) => n < ALL).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
              <option value="all">All</option>
            </select>
          </label>
          <span className="num">
            {total ? pageIndex * ps + 1 : 0}–{Math.min(total, (pageIndex + 1) * ps).toLocaleString("en")} of {total.toLocaleString("en")}
          </span>
          {ps < total && (
            <span className="flex items-center gap-1.5">
              <button disabled={!table.getCanPreviousPage()} onClick={() => go(pageIndex - 1)} className="rounded-md border border-line p-1 disabled:opacity-30" aria-label="Previous page">
                <ChevronLeft size={15} />
              </button>
              <span className="num px-1">
                {pageIndex + 1} / {table.getPageCount()}
              </span>
              <button disabled={!table.getCanNextPage()} onClick={() => go(pageIndex + 1)} className="rounded-md border border-line p-1 disabled:opacity-30" aria-label="Next page">
                <ChevronRight size={15} />
              </button>
            </span>
          )}
            </>
          )}
        </div>
      )}
      <AutoHeight>
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const c = h.column.columnDef.meta as Col<T>;
                  const s = h.column.getIsSorted();
                  return (
                    <th
                      key={h.id}
                      onClick={h.column.getToggleSortingHandler()}
                      style={{ width: c.width }}
                      className={`${h.column.getCanSort() ? "cursor-pointer hover:text-ink" : ""} select-none whitespace-nowrap border-b border-line bg-panel-2 px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted ${c.align === "right" ? "text-right" : "text-left"}`}
                    >
                      <span className="inline-flex items-center gap-1">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {s === "asc" ? <ArrowUp size={12} /> : s === "desc" ? <ArrowDown size={12} /> : null}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <motion.tbody key={rowsKey} initial={mounted.current ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ duration: SOFT.in, ease: SOFT.ease }}>
            {table.getRowModel().rows.map((r) => {
              const tone = rowTone?.(r.original);
              const isOpen = !!expand && open.has(r.original);
              return (
                <Fragment key={r.id}>
                  <tr
                    onClick={expand ? () => toggle(r.original) : undefined}
                    aria-expanded={expand ? isOpen : undefined}
                    className={`border-b border-line transition-colors ${SOFT_CSS} last:border-0 ${expand ? "cursor-pointer" : ""} ${tone === "accent" ? "bg-accent-soft" : tone === "warn" ? "bg-warn-soft" : isOpen ? "bg-panel-2" : "hover:bg-panel-2"}`}
                  >
                    {r.getVisibleCells().map((cell, i) => {
                      const c = cell.column.columnDef.meta as Col<T>;
                      return (
                        <td key={cell.id} className={`px-4 py-2.5 align-middle ${c.wrap ? "" : "whitespace-nowrap"} ${c.align === "right" ? "text-right" : ""} ${c.mono ? "num" : ""}`}>
                          {expand && i === 0 ? (
                            <span className="flex items-start gap-2">
                              <ChevronRight size={15} className={`mt-[3px] shrink-0 text-faint transition-transform ${SOFT_CSS} ${isOpen ? "rotate-90 text-accent" : ""}`} />
                              <span className="min-w-0">{flexRender(cell.column.columnDef.cell, cell.getContext())}</span>
                            </span>
                          ) : (
                            flexRender(cell.column.columnDef.cell, cell.getContext())
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  {/* Once opened, a row's detail stays mounted so it can slide closed as smoothly as it opened. */}
                  {expand && (isOpen || everOpen.has(r.original)) && (
                    <tr className={`bg-panel-2 ${isOpen ? "border-b border-line" : ""}`}>
                      <td colSpan={cols.length} className="p-0">
                        <Collapse open={isOpen}>
                          <div className="px-4 pb-4 pt-1">{expand(r.original)}</div>
                        </Collapse>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {total === 0 && (
              <tr>
                <td colSpan={cols.length} className="px-4 py-10 text-center text-muted">
                  Nothing matches.
                </td>
              </tr>
            )}
          </motion.tbody>
        </table>
      </div>
      </AutoHeight>
    </div>
  );
}

/** What a column holds, for the direction's wording. */
function sortKind<T>(c: Col<T>, rows: T[]): "date" | "number" | "text" {
  for (const r of rows.slice(0, 20)) {
    const v = c.value(r);
    if (v === null || v === undefined || v === "") continue;
    if (typeof v === "number") return "number";
    return /^\d{4}-\d{2}-\d{2}/.test(v) ? "date" : "text";
  }
  return "text";
}
const DIRECTION = {
  date: { desc: "Newest first", asc: "Oldest first" },
  number: { desc: "Highest first", asc: "Lowest first" },
  text: { desc: "Z → A", asc: "A → Z" },
};

/** "Sort by [Date ▾] [↓ Newest first]": the same sort as the column headers, visible. */
function SortControl<T>({ cols, rows, sorting, onChange }: { cols: Col<T>[]; rows: T[]; sorting: SortingState; onChange: (id: string | null, desc: boolean) => void }) {
  const cur = sorting[0];
  const col = cur ? cols.find((c) => c.id === cur.id) : undefined;
  const kind = col ? sortKind(col, rows) : "text";
  const desc = cur?.desc ?? false;
  return (
    <div className="mr-auto flex items-center gap-2">
      <label className={`field flex items-center gap-1.5 rounded-lg border px-2.5 py-1 transition-colors ${SOFT_CSS} border-line bg-panel-2`}>
        <ArrowUpDown size={13} className="text-faint" />
        <span>Sort by</span>
        <select
          value={col?.id ?? ""}
          onChange={(e) => {
            const id = e.target.value;
            const c = cols.find((x) => x.id === id);
            // A new column starts the natural way round: newest / highest first, A → Z for text.
            onChange(id || null, c ? sortKind(c, rows) !== "text" : false);
          }}
          className="max-w-[170px] bg-transparent font-medium text-ink outline-none"
        >
          {!col && <option value="">Default order</option>}
          {cols.map((c) => (
            <option key={c.id} value={c.id}>
              {c.header || c.id}
            </option>
          ))}
        </select>
      </label>
      {col && (
        <button
          type="button"
          onClick={() => onChange(col.id, !desc)}
          title="Reverse the order"
          className={`flex items-center gap-1.5 rounded-lg border border-line bg-panel-2 px-2.5 py-1 font-medium text-ink transition-colors ${SOFT_CSS} hover:border-line-strong`}
        >
          <ArrowDown size={13} className={`text-muted transition-transform ${SOFT_CSS} ${desc ? "" : "rotate-180"}`} />
          <motion.span key={`${kind}-${desc}`} initial={{ opacity: 0, y: desc ? -3 : 3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: SOFT.in, ease: SOFT.ease }}>
            {DIRECTION[kind][desc ? "desc" : "asc"]}
          </motion.span>
        </button>
      )}
    </div>
  );
}
