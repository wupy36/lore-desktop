// Anchorpoint/P4V-style revision timeline: graph rail + author-grouped cards.
import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { changeGroup, type GraphRevision } from "@shared/types";
import { useApi } from "../../api/client";
import { useAuth, useFiles, useRepo } from "../../api/queries";
import { colorSlot, initials, layoutGraph, timelineItems, type RevisionNode } from "../../graph/layout";
import { useUi } from "../../store/ui";
import { railWidth } from "./RevisionGraphRail";
import { CARD_H, HEADER_H, TimelineRow } from "./TimelineRow";

export const WORKING_ID = "__working__";

/** GraphRevision[] → graph nodes. Parents outside the loaded window are dropped (no dangling rails). */
export function toNodes(revs: readonly GraphRevision[], working: { count: number; author: string; head: string | null } | null): RevisionNode[] {
  const ids = new Set(revs.map((r) => r.hash));
  const nodes: RevisionNode[] = revs.map((r) => {
    const name = r.author ?? "(no author)";
    const parents = r.parents.filter((p) => ids.has(p));
    return {
      id: r.hash,
      parents,
      number: r.number,
      branch: r.branch,
      author: { name, avatarInitials: r.author ? initials(r.author) : "–", color: colorSlot(name) },
      message: r.message,
      timestamp: r.timestamp,
      pending: r.pending,
      isHead: r.isHead,
      nodeType: r.parents.length > 1 ? "merge" : "atom",
    };
  });
  if (working && working.count > 0 && working.head && ids.has(working.head)) {
    const head = revs.find((r) => r.hash === working.head);
    nodes.unshift({
      id: WORKING_ID,
      parents: [working.head],
      number: null,
      branch: head?.branch ?? "",
      author: { name: working.author, avatarInitials: initials(working.author), color: colorSlot(working.author) },
      message: `Working copy · ${working.count} local change(s)`,
      timestamp: Date.now(),
      pending: true,
      isHead: false,
      nodeType: "pending",
    });
  }
  return nodes;
}

export function LoreTimelineView({ onContextMenu }: { onContextMenu(hash: string, e: React.MouseEvent): void }) {
  const api = useApi();
  const repo = useRepo().data;
  const files = useFiles().data;
  const auth = useAuth().data;
  const [scope, setScope] = useState<"current" | "all">("all");
  const graph = useQuery({ queryKey: ["graph", scope], queryFn: () => api.invoke("rev:graph", { scope, length: 500 }), enabled: !!repo });
  const selected = useUi((s) => s.historyRevision);
  const setSelected = useUi((s) => s.setHistoryRevision);
  const [hovered, setHovered] = useState<string | null>(null);

  const changed = useMemo(() => (files ?? []).filter((f) => changeGroup(f) !== null).length, [files]);
  const { items, laneCount } = useMemo(() => {
    const nodes = toNodes(graph.data ?? [], { count: changed, author: auth?.identity ?? "You", head: repo?.revisionHash ?? null });
    const layout = layoutGraph(nodes, { primaryBranch: repo?.branch || undefined });
    return { items: timelineItems(layout), laneCount: layout.laneCount };
  }, [graph.data, changed, auth?.identity, repo?.revisionHash, repo?.branch]);

  const ref = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({ count: items.length, getScrollElement: () => ref.current, estimateSize: (i) => (items[i]?.kind === "header" ? HEADER_H : CARD_H), overscan: 12 });

  const commitIds = useMemo(() => items.flatMap((i) => (i.kind === "commit" ? [i.key] : [])), [items]);
  const select = useCallback(
    (id: string) => {
      if (id === WORKING_ID) useUi.getState().setSidebarTab("changes");
      else setSelected(id);
    },
    [setSelected],
  );
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const cur = selected ? commitIds.indexOf(selected) : -1;
    const next = commitIds[Math.max(0, Math.min(commitIds.length - 1, cur + (e.key === "ArrowDown" ? 1 : -1)))];
    if (!next || next === WORKING_ID) return;
    setSelected(next);
    const idx = items.findIndex((i) => i.key === next);
    if (idx >= 0) virt.scrollToIndex(idx, { align: "auto" });
  };

  return (
    <div className="timeline" style={{ "--rail-w": `${railWidth(laneCount)}px` } as React.CSSProperties}>
      <div className="group-title">
        <span className="grow">History</span>
        <div className="seg" role="radiogroup" aria-label="History scope">
          {(["current", "all"] as const).map((s) => (
            <button key={s} role="radio" aria-checked={scope === s} className={`seg-btn${scope === s ? " on" : ""}`} onClick={() => setScope(s)}>
              {s === "current" ? repo?.branch || "Current" : "All branches"}
            </button>
          ))}
        </div>
      </div>
      <div ref={ref} className="timeline-scroll" role="listbox" aria-label="Revisions" tabIndex={0} onKeyDown={onKeyDown} onMouseLeave={() => setHovered(null)}>
        {graph.isLoading && <div className="empty">Loading…</div>}
        {graph.isError && <div className="empty">{graph.error.message}</div>}
        <div style={{ height: virt.getTotalSize(), position: "relative" }}>
          {virt.getVirtualItems().map((vi) => {
            const item = items[vi.index];
            if (!item) return null;
            return (
              <div key={item.key} style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)` }}>
                <TimelineRow item={item} laneCount={laneCount} selected={item.kind === "commit" && item.key === selected} hovered={hovered} onHover={setHovered} onSelect={select} onContextMenu={onContextMenu} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
