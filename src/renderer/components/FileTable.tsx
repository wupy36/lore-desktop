// Center file table: TanStack Table (sorting/columns) + TanStack Virtual
// (only visible rows are in the DOM, so 10k+ rows stay smooth).
import { useCallback, useMemo, useRef, useState } from "react";
import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { changeGroup, deriveFileState, fileExt, fileName, type FileEntry } from "@shared/types";
import { useActions } from "../actions";
import { useUi } from "../store/ui";
import { formatSize } from "../selectors";
import { ContextMenu, type MenuEntry } from "./ContextMenu";

export const ROW_H = 22;

const columns: ColumnDef<FileEntry>[] = [
  { id: "name", header: "Name", accessorFn: (f) => fileName(f.path), size: 320 },
  { id: "ext", header: "Ext", accessorFn: (f) => fileExt(f.path), size: 64 },
  {
    id: "state",
    header: "State",
    accessorFn: (f) => deriveFileState(f),
    size: 96,
    cell: (c) => <span className={`state state-${c.getValue<string>()}`}>{c.getValue<string>()}</span>,
  },
  { id: "size", header: "Size", accessorKey: "size", size: 90, cell: (c) => formatSize(c.getValue<number>()), meta: { num: true } },
  { id: "rev", header: "Last revision", accessorFn: (f) => f.lastRevision ?? -1, size: 100, cell: (c) => (c.getValue<number>() < 0 ? "—" : `#${c.getValue<number>()}`), meta: { num: true } },
  {
    id: "lock",
    header: "Lock owner",
    accessorFn: (f) => f.lockOwner ?? "",
    size: 150,
    cell: (c) => (c.getValue<string>() ? <span className="lock">🔒 {c.getValue<string>()}</span> : ""),
  },
  { id: "dir", header: "Folder", accessorFn: (f) => f.path.slice(0, Math.max(0, f.path.lastIndexOf("/"))), size: 360, meta: { dim: true } },
];

interface Props {
  files: FileEntry[];
  /** For tests: jsdom has no layout, so give the virtualizer a viewport. */
  initialRect?: { width: number; height: number };
}

export function FileTable({ files, initialRect }: Props) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const selected = useUi((s) => s.selected);
  const focused = useUi((s) => s.focused);
  const select = useUi((s) => s.select);
  const selectAll = useUi((s) => s.selectAll);
  const openDetail = useUi((s) => s.openDetail);
  const actions = useActions();

  const table = useReactTable({
    data: files,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (f) => f.path,
    columnResizeMode: "onChange",
  });
  const rows = table.getRowModel().rows;
  const ordered = useMemo(() => rows.map((r) => r.id), [rows]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_H, overscan: 20, initialRect });
  const totalW = table.getTotalSize();

  const moveFocus = useCallback(
    (delta: number, shift: boolean, abs?: number) => {
      if (!ordered.length) return;
      const cur = focused ? ordered.indexOf(focused) : -1;
      const next = Math.max(0, Math.min(ordered.length - 1, abs ?? cur + delta));
      const path = ordered[next] as string;
      select(path, { shift }, ordered);
      virt.scrollToIndex(next, { align: "auto" });
    },
    [focused, ordered, select, virt],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 400) / ROW_H) - 1);
    const map: Record<string, () => void> = {
      ArrowDown: () => moveFocus(1, e.shiftKey),
      ArrowUp: () => moveFocus(-1, e.shiftKey),
      PageDown: () => moveFocus(page, e.shiftKey),
      PageUp: () => moveFocus(-page, e.shiftKey),
      Home: () => moveFocus(0, e.shiftKey, 0),
      End: () => moveFocus(0, e.shiftKey, ordered.length - 1),
      Enter: () => {
        if (focused) openDetail(focused, "diff");
      },
      ContextMenu: () => setMenu({ x: 200, y: 200 }),
    };
    if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      selectAll(ordered);
      return;
    }
    const fn = map[e.key];
    if (fn) {
      e.preventDefault();
      fn();
    }
  };

  const sel = actions.selection;
  const anyChanged = sel.some((f) => changeGroup(f) !== null);
  const menuItems: MenuEntry[] = [
    { label: "Diff", shortcut: "Enter", disabled: sel.length !== 1, onSelect: () => sel[0] && openDetail(sel[0].path, "diff") },
    { label: "History", disabled: sel.length !== 1, onSelect: () => sel[0] && openDetail(sel[0].path, "history") },
    "sep",
    { label: "Stage", disabled: !sel.some((f) => !f.staged && changeGroup(f) !== null), onSelect: () => void actions.stage() },
    { label: "Unstage", disabled: !sel.some((f) => f.staged), onSelect: () => void actions.unstage() },
    { label: "Reset (discard changes)…", disabled: !anyChanged, onSelect: () => void actions.reset() },
    "sep",
    { label: "Lock", disabled: !sel.length || sel.every((f) => !!f.lockOwner), onSelect: () => void actions.lock() },
    { label: "Release lock", disabled: !sel.some((f) => f.lockOwner), onSelect: () => void actions.release() },
    "sep",
    { label: "Prefetch / include in view", disabled: true, onSelect: () => {} }, // Phase 4
  ];

  return (
    <div
      ref={scrollRef}
      className="grid pane-body"
      role="grid"
      aria-rowcount={rows.length}
      aria-multiselectable
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-testid="file-table"
    >
      <div className="grid-head" style={{ width: totalW }} role="row">
        {table.getFlatHeaders().map((h) => (
          <div
            key={h.id}
            role="columnheader"
            className="grid-hcell"
            style={{ width: h.getSize(), position: "relative" }}
            onClick={h.column.getToggleSortingHandler()}
            aria-sort={h.column.getIsSorted() === "asc" ? "ascending" : h.column.getIsSorted() === "desc" ? "descending" : "none"}
          >
            {flexRender(h.column.columnDef.header, h.getContext())}
            {{ asc: " ▲", desc: " ▼" }[h.column.getIsSorted() as string] ?? ""}
            <span
              onMouseDown={h.getResizeHandler()}
              onClick={(e) => e.stopPropagation()}
              style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 5, cursor: "col-resize" }}
            />
          </div>
        ))}
      </div>
      <div style={{ height: virt.getTotalSize(), width: totalW, position: "relative" }}>
        {virt.getVirtualItems().map((vi) => {
          const row = rows[vi.index];
          if (!row) return null;
          const isSel = selected.has(row.id);
          return (
            <div
              key={row.id}
              role="row"
              aria-selected={isSel}
              aria-rowindex={vi.index + 1}
              className={`grid-row${focused === row.id ? " focus" : ""}`}
              style={{ transform: `translateY(${vi.start}px)`, width: totalW }}
              onMouseDown={(e) => {
                if (e.button === 2 && isSel) return; // keep multi-selection for context menu
                select(row.id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }, ordered);
              }}
              onDoubleClick={() => openDetail(row.id, "diff")}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!isSel) select(row.id, {}, ordered);
                setMenu({ x: e.clientX, y: e.clientY });
              }}
              title={row.original.path}
            >
              {row.getVisibleCells().map((c) => {
                const meta = c.column.columnDef.meta as { num?: boolean; dim?: boolean } | undefined;
                return (
                  <div key={c.id} role="gridcell" className={`cell${meta?.num ? " num" : ""}${meta?.dim ? " dim" : ""}`} style={{ width: c.column.getSize() }}>
                    {flexRender(c.column.columnDef.cell, c.getContext())}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {rows.length === 0 && <div className="empty">No files match the current filter.</div>}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </div>
  );
}
