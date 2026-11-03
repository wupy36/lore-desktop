// Revision graph ("subway map") layout. Pure: revisions in, per-row SVG
// segments out. Each timeline row draws only its own slice, so the graph
// aligns with any row height and works under list virtualization.
//
// Lanes are columns. Walking revisions newest → oldest, a lane "expects" a
// parent hash; a revision lands in the first lane expecting it (other lanes
// expecting it curve in = a branch point seen from above), its first parent
// continues in the same lane, and extra parents (merges) open or join lanes.
// Lanes never shift sideways, so a pass-through is always a straight line.

export type NodeType = "atom" | "commit" | "merge" | "pending";

export interface RevisionNode {
  id: string; // revision hash (or "__working__" for the working-copy node)
  parents: string[];
  number: number | null;
  branch: string;
  author: { name: string; avatarInitials: string; color: number };
  message: string;
  timestamp: number; // epoch ms
  /** Not on the server yet (unpushed revision, or the working copy). Drawn dashed. */
  pending: boolean;
  isHead: boolean;
  nodeType: NodeType;
}

/** A row-local line. `top`/`bottom` are row edges, `mid` is the node's row center. */
export interface Segment {
  from: { lane: number; at: "top" | "mid" };
  to: { lane: number; at: "mid" | "bottom" };
  color: number;
  dashed: boolean;
  /** `${child}>${parent}` for every parent edge running along this segment (hover highlight). */
  edges: string[];
}

export interface Lane {
  parent: string;
  child: string;
  color: number;
  dashed: boolean;
  /** Edges that joined this lane further up (a branch curving back in). */
  joined: string[];
}

const laneEdges = (l: Lane) => [`${l.child}>${l.parent}`, ...l.joined];

export interface LayoutRow {
  node: RevisionNode;
  lane: number;
  color: number;
  segments: Segment[];
  /** Lane occupancy above this row (headers between rows draw these straight through). */
  lanesBefore: (Lane | null)[];
}

export interface GraphLayout {
  rows: LayoutRow[];
  laneCount: number;
}

export const PALETTE_SIZE = 8;

export interface LayoutOptions {
  /** This branch keeps lane 0 and color 0 (the trunk stays on the left, like Anchorpoint/P4V);
   * other branches open lanes from 1. */
  primaryBranch?: string;
}

export function layoutGraph(nodes: readonly RevisionNode[], opts: LayoutOptions = {}): GraphLayout {
  let lanes: (Lane | null)[] = [];
  const branchColor = new Map<string, number>(opts.primaryBranch ? [[opts.primaryBranch, 0]] : []);
  const colorFor = (branch: string) => {
    let c = branchColor.get(branch);
    if (c === undefined) branchColor.set(branch, (c = branchColor.size % PALETTE_SIZE));
    return c;
  };
  // Branch of each revision, to color a merge parent's lane by *its* branch.
  const branchOf = new Map(nodes.map((n) => [n.id, n.branch]));
  const rows: LayoutRow[] = [];
  let laneCount = 0;

  for (const node of nodes) {
    const before = lanes.slice();
    const expecting = before.flatMap((l, i) => (l?.parent === node.id ? [i] : []));
    const reserve = opts.primaryBranch !== undefined;
    const firstFree = (from: number) => {
      for (let j = from; j < before.length; j++) if (before[j] === null) return j;
      return Math.max(before.length, from);
    };
    const isPrimary = reserve && node.branch === opts.primaryBranch;
    const lane = isPrimary && !before[0] ? 0 : (expecting[0] ?? firstFree(reserve ? 1 : 0));
    const color = isPrimary ? 0 : expecting.length ? (before[expecting[0] as number] as Lane).color : colorFor(node.branch);
    const segments: Segment[] = [];

    // Edges arriving from above: children of this node.
    for (const i of expecting) {
      const l = before[i] as Lane;
      segments.push({ from: { lane: i, at: "top" }, to: { lane, at: "mid" }, color: l.color, dashed: l.dashed, edges: laneEdges(l) });
    }

    const after = before.slice();
    for (const i of expecting) after[i] = null;

    const freeSlot = (prefer: number) => {
      for (let j = Math.max(prefer, reserve ? 1 : 0); j < after.length; j++) if (after[j] === null || after[j] === undefined) return j;
      return Math.max(after.length, prefer);
    };

    node.parents.forEach((p, k) => {
      const existing = after.findIndex((l) => l?.parent === p);
      const edge = `${node.id}>${p}`;
      if (existing >= 0) {
        // Parent already expected by another lane: curve into it (no new lane).
        segments.push({ from: { lane, at: "mid" }, to: { lane: existing, at: "bottom" }, color: k === 0 ? color : (after[existing] as Lane).color, dashed: node.pending, edges: [edge] });
        const target = after[existing] as Lane;
        after[existing] = { ...target, joined: [...target.joined, edge] };
        return;
      }
      // First parent continues straight down this lane; extra (merge) parents open a lane to the right.
      const slot = k === 0 ? lane : freeSlot(lane + 1);
      const c = k === 0 ? color : colorFor(branchOf.get(p) ?? `${node.id}#${k}`);
      after[slot] = { parent: p, child: node.id, color: c, dashed: node.pending, joined: [] };
      segments.push({ from: { lane, at: "mid" }, to: { lane: slot, at: "bottom" }, color: c, dashed: node.pending, edges: [edge] });
    });

    // Straight pass-throughs for lanes untouched by this row.
    before.forEach((l, i) => {
      // Use the lane as it continues below (it may have gained joined edges in this row).
      if (l && l.parent !== node.id) {
        const cur = (after[i] as Lane | null) ?? l;
        segments.push({ from: { lane: i, at: "top" }, to: { lane: i, at: "bottom" }, color: l.color, dashed: l.dashed, edges: laneEdges(cur) });
      }
    });

    // Sparse slots (a reserved lane 0 not yet used) are null, not holes.
    for (let j = 0; j < after.length; j++) if (after[j] === undefined) after[j] = null;
    while (after.length && after[after.length - 1] === null) after.pop();
    laneCount = Math.max(laneCount, before.length, after.length, lane + 1);
    rows.push({ node, lane, color, segments, lanesBefore: before });
    lanes = after;
  }
  return { rows, laneCount };
}

// ---- presentation helpers (pure) ----

export function initials(name: string): string {
  const base = name.includes("@") ? (name.split("@")[0] as string) : name;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  return base.slice(0, 2).toUpperCase() || "?";
}

/** Stable small hash → avatar color slot. */
export function colorSlot(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % PALETTE_SIZE;
}

export function relativeTime(ts: number, now = Date.now()): string {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  const time = `${p(d.getHours())}:${p(d.getMinutes())}`;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.floor((startOfToday.getTime() - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return time;
  if (days === 1) return `Yesterday ${time}`;
  if (days < 7) return `${days} days ago`;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export type TimelineItem =
  | { kind: "header"; key: string; author: RevisionNode["author"]; timestamp: number; lanes: (Lane | null)[] }
  | { kind: "commit"; key: string; row: LayoutRow };

/** Interleave author headers: a new header when the author changes or a different day starts. */
export function timelineItems(layout: GraphLayout): TimelineItem[] {
  const out: TimelineItem[] = [];
  let lastAuthor: string | null = null;
  let lastDay = "";
  for (const row of layout.rows) {
    const n = row.node;
    const day = n.timestamp ? new Date(n.timestamp).toDateString() : "";
    if (n.author.name !== lastAuthor || day !== lastDay) {
      out.push({ kind: "header", key: `h:${n.id}`, author: n.author, timestamp: n.timestamp, lanes: row.lanesBefore });
      lastAuthor = n.author.name;
      lastDay = day;
    }
    out.push({ kind: "commit", key: n.id, row });
  }
  return out;
}
