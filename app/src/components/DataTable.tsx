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
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import { Fragment, useMemo, useState, type ReactNode } from "react";

export interface Col<T> {
  id: string;
  header: string;
  value: (r: T) => string | number | null | undefined; // used for sort, search, export
  cell?: (r: T) => ReactNode;
  align?: "right" | "left";
  width?: number;
  mono?: boolean;
  wrap?: boolean;
}

const ALL = 1_000_000;
const PAGE_SIZES = [10, 25, 50, 100, ALL];

export function DataTable<T>({
  rows,
  cols,
  initialSort,
  pageSize = 25,
  filename = "export",
  rowTone,
  toolbar,
  searchPlaceholder = "Search…",
  expand,
}: {
  rows: T[];
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
  const sizeKey = `riotvault.rows.${filename}`;
  const [initialSize] = useState(() => {
    try {
      const v = Number(localStorage.getItem(sizeKey));
      return PAGE_SIZES.includes(v) ? v : pageSize;
    } catch {
      return pageSize;
    }
  });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const [sorting, setSorting] = useState<SortingState>(initialSort ? [initialSort] : []);
  const [q, setQ] = useState("");
  const columns = useMemo<ColumnDef<T>[]>(
    () =>
      cols.map((c) => ({
        id: c.id,
        header: c.header,
        accessorFn: (r: T) => c.value(r) ?? "",
        cell: (ctx) => (c.cell ? c.cell(ctx.row.original) : String(c.value(ctx.row.original) ?? "")),
        sortingFn: "alphanumeric",
        meta: c,
      })),
    [cols],
  );
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, globalFilter: q },
    onSortingChange: setSorting,
    onGlobalFilterChange: setQ,
    globalFilterFn: (row, _id, v) => {
      const s = String(v).toLowerCase();
      return cols.some((c) => String(c.value(row.original) ?? "").toLowerCase().includes(s));
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

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <label className="flex min-w-[220px] flex-1 items-center gap-2 field rounded-lg border border-line bg-panel-2 px-2.5 py-1.5">
          <Search size={15} className="text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} className="w-full bg-transparent outline-none placeholder:text-faint" />
        </label>
        {toolbar}
        <span className="num ml-auto text-[12px] text-muted">{total.toLocaleString("en")} rows</span>
        <button onClick={exportCsv} className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] font-medium hover:bg-panel-2">
          <Download size={14} /> CSV
        </button>
      </div>
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
                      className={`cursor-pointer select-none whitespace-nowrap border-b border-line bg-panel-2 px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted hover:text-ink ${c.align === "right" ? "text-right" : "text-left"}`}
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
          <tbody>
            {table.getRowModel().rows.map((r) => {
              const tone = rowTone?.(r.original);
              const isOpen = !!expand && open.has(r.id);
              return (
                <Fragment key={r.id}>
                  <tr
                    onClick={expand ? () => toggle(r.id) : undefined}
                    aria-expanded={expand ? isOpen : undefined}
                    className={`border-b border-line last:border-0 ${expand ? "cursor-pointer" : ""} ${tone === "accent" ? "bg-accent-soft" : tone === "warn" ? "bg-warn-soft" : isOpen ? "bg-panel-2" : "hover:bg-panel-2"}`}
                  >
                    {r.getVisibleCells().map((cell, i) => {
                      const c = cell.column.columnDef.meta as Col<T>;
                      return (
                        <td key={cell.id} className={`px-4 py-2.5 align-middle ${c.wrap ? "" : "whitespace-nowrap"} ${c.align === "right" ? "text-right" : ""} ${c.mono ? "num" : ""}`}>
                          {expand && i === 0 ? (
                            <span className="flex items-start gap-2">
                              <ChevronRight size={15} className={`mt-[3px] shrink-0 text-faint transition-transform ${isOpen ? "rotate-90 text-accent" : ""}`} />
                              <span className="min-w-0">{flexRender(cell.column.columnDef.cell, cell.getContext())}</span>
                            </span>
                          ) : (
                            flexRender(cell.column.columnDef.cell, cell.getContext())
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-line bg-panel-2">
                      <td colSpan={cols.length} className="px-4 pb-4 pt-1">
                        {expand!(r.original)}
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
          </tbody>
        </table>
      </div>
      {total > PAGE_SIZES[0] && (
        <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-2 border-t border-line px-4 py-2.5 text-[12.5px] text-muted">
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
              <button disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()} className="rounded-md border border-line p-1 disabled:opacity-30" aria-label="Previous page">
                <ChevronLeft size={15} />
              </button>
              <span className="num px-1">
                {pageIndex + 1} / {table.getPageCount()}
              </span>
              <button disabled={!table.getCanNextPage()} onClick={() => table.nextPage()} className="rounded-md border border-line p-1 disabled:opacity-30" aria-label="Next page">
                <ChevronRight size={15} />
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
