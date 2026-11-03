import { memo } from "react";
import { relativeTime, type Segment, type TimelineItem } from "../../graph/layout";
import { RevisionGraphRail } from "./RevisionGraphRail";

export const HEADER_H = 30;
export const CARD_H = 38;

/** Lane pass-throughs for an author header: every occupied lane runs straight through. */
function passThrough(lanes: TimelineItem & { kind: "header" }): Segment[] {
  return lanes.lanes.flatMap((l, i) => (l ? [{ from: { lane: i, at: "top" as const }, to: { lane: i, at: "bottom" as const }, color: l.color, dashed: l.dashed, edges: [`${l.child}>${l.parent}`, ...l.joined] }] : []));
}

export interface TimelineRowProps {
  item: TimelineItem;
  laneCount: number;
  selected: boolean;
  hovered: string | null;
  onHover(id: string | null): void;
  onSelect(id: string): void;
  onContextMenu(id: string, e: React.MouseEvent): void;
}

export const TimelineRow = memo(function TimelineRow({ item, laneCount, selected, hovered, onHover, onSelect, onContextMenu }: TimelineRowProps) {
  const highlight = hovered ? (edges: string[]) => edges.some((e) => e.startsWith(`${hovered}>`)) : null;

  if (item.kind === "header") {
    const a = item.author;
    return (
      <div className="tl-row tl-header" style={{ height: HEADER_H }}>
        <RevisionGraphRail segments={passThrough(item)} laneCount={laneCount} height={HEADER_H} highlight={highlight} />
        <span className={`avatar a${a.color}`} aria-hidden="true">
          {a.avatarInitials}
        </span>
        <span className="tl-author" title={a.name}>
          {a.name}
        </span>
        <span className="hint tl-time">{relativeTime(item.timestamp)}</span>
      </div>
    );
  }

  const { node, lane, color, segments } = item.row;
  const isHover = hovered === node.id;
  return (
    <div
      className={`tl-row tl-commit${selected ? " selected" : ""}${isHover ? " hover" : ""}`}
      style={{ height: CARD_H }}
      role="option"
      aria-selected={selected}
      data-id={node.id}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onSelect(node.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(node.id, e);
      }}
      title={`${node.number !== null ? `#${node.number} · ` : ""}${node.branch}${node.pending ? " · not pushed" : ""}\n${node.id}\n\n${node.message}`}
    >
      <RevisionGraphRail
        segments={segments}
        laneCount={laneCount}
        height={CARD_H}
        node={{ lane, color, type: node.nodeType, isHead: node.isHead, pending: node.pending }}
        highlight={highlight}
        nodeHighlighted={isHover}
      />
      <div className={`tl-card${node.isHead ? " head" : ""}${node.pending ? " pending" : ""}`}>
        <span className="tl-msg">{node.message || <span className="hint">(no message)</span>}</span>
        {node.isHead && <span className="badge tl-tag">HEAD</span>}
        {node.nodeType === "merge" && <span className="hint tl-tag">merge</span>}
      </div>
    </div>
  );
});
