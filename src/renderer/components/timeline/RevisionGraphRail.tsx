// One row's slice of the revision graph: lines computed by layoutGraph(), drawn
// in a fixed-width SVG whose height equals the row height, so rails line up
// across rows (and under virtualization) without any global overlay.
import { memo } from "react";
import { Atom, CircleDashed, GitCommitHorizontal, GitMerge } from "lucide-react";
import type { NodeType, Segment } from "../../graph/layout";

export const LANE_W = 14;
export const RAIL_PAD = 8;

const ICONS = { atom: Atom, commit: GitCommitHorizontal, merge: GitMerge, pending: CircleDashed } as const;

export const railWidth = (laneCount: number) => RAIL_PAD * 2 + Math.max(1, laneCount) * LANE_W;
const x = (lane: number) => RAIL_PAD + lane * LANE_W + LANE_W / 2;

function path(s: Segment, h: number): string {
  const y1 = s.from.at === "top" ? 0 : h / 2;
  const y2 = s.to.at === "bottom" ? h : h / 2;
  const x1 = x(s.from.lane);
  const x2 = x(s.to.lane);
  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`;
  // Subway-style: leave vertically, cross over, arrive vertically.
  const my = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
}

export interface RailProps {
  segments: Segment[];
  laneCount: number;
  height: number;
  node?: { lane: number; color: number; type: NodeType; isHead: boolean; pending: boolean };
  /** Edge keys to emphasise (hovered node's parent edges); others dim. null = nothing hovered. */
  highlight: ((edges: string[]) => boolean) | null;
  nodeHighlighted?: boolean;
}

export const RevisionGraphRail = memo(function RevisionGraphRail({ segments, laneCount, height, node, highlight, nodeHighlighted }: RailProps) {
  const w = railWidth(laneCount);
  const r = 7.5;
  const Icon = node ? ICONS[node.type] : null;
  return (
    <svg className="rail" width={w} height={height} viewBox={`0 0 ${w} ${height}`} aria-hidden="true">
      {segments.map((s, i) => {
        const on = highlight ? highlight(s.edges) : false;
        return (
          <path
            key={i}
            d={path(s, height)}
            className={`rail-line g${s.color}${on ? " hl" : highlight ? " dim" : ""}`}
            strokeDasharray={s.dashed ? "3 3" : undefined}
            data-edges={s.edges.join(" ")}
          />
        );
      })}
      {node && Icon && (
        <g className={`rail-node g${node.color}${nodeHighlighted ? " hl" : highlight ? " dim" : ""}${node.isHead ? " head" : ""}`}>
          <circle cx={x(node.lane)} cy={height / 2} r={r} className="rail-node-bg" strokeDasharray={node.pending ? "2 2" : undefined} />
          <Icon x={x(node.lane) - 5.5} y={height / 2 - 5.5} width={11} height={11} strokeWidth={2.25} className="rail-icon" />
        </g>
      )}
    </svg>
  );
});
