import { describe, expect, it } from "vitest";
import { colorSlot, initials, layoutGraph, relativeTime, timelineItems, type RevisionNode } from "../../src/renderer/graph/layout";

const n = (id: string, parents: string[], extra: Partial<RevisionNode> = {}): RevisionNode => ({
  id,
  parents,
  number: null,
  branch: "main",
  author: { name: "ada", avatarInitials: "AD", color: 0 },
  message: id,
  timestamp: 0,
  pending: false,
  isHead: false,
  nodeType: parents.length > 1 ? "merge" : "atom",
  ...extra,
});
const lanesOf = (g: ReturnType<typeof layoutGraph>) => g.rows.map((r) => `${r.node.id}@${r.lane}`);

describe("layoutGraph", () => {
  it("linear history stays in lane 0 with straight mid→bottom edges", () => {
    const g = layoutGraph([n("c", ["b"]), n("b", ["a"]), n("a", [])]);
    expect(lanesOf(g)).toEqual(["c@0", "b@0", "a@0"]);
    expect(g.laneCount).toBe(1);
    expect(g.rows[0]!.segments).toEqual([{ from: { lane: 0, at: "mid" }, to: { lane: 0, at: "bottom" }, color: 0, dashed: false, edges: ["c>b"] }]);
    expect(g.rows[1]!.segments.map((s) => s.edges)).toEqual([["c>b"], ["b>a"]]);
    expect(g.rows[2]!.segments.map((s) => s.edges)).toEqual([["b>a"]]); // root: arrives, nothing leaves
  });

  it("merge opens a second lane; the branch tip lands in it; the fork point curves back", () => {
    // m (merge of a2 + f2) ← a2 ← a1 ; f2 ← f1 ← a1
    const g = layoutGraph([
      n("m", ["a2", "f2"]),
      n("f2", ["f1"], { branch: "feature" }),
      n("a2", ["a1"]),
      n("f1", ["a1"], { branch: "feature" }),
      n("a1", []),
    ]);
    expect(lanesOf(g)).toEqual(["m@0", "f2@1", "a2@0", "f1@1", "a1@0"]);
    expect(g.laneCount).toBe(2);
    // Merge row: one edge straight down lane 0, one curve to lane 1, colored by the feature branch.
    const merge = g.rows[0]!.segments;
    expect(merge).toContainEqual(expect.objectContaining({ from: { lane: 0, at: "mid" }, to: { lane: 1, at: "bottom" }, edges: expect.arrayContaining(["m>f2"]), color: 1 }));
    // f1's parent a1 is already expected by lane 0, so f1 curves back into lane 0 right below itself
    // (git-log style) and lane 1 is free again.
    expect(g.rows[3]!.segments).toContainEqual(expect.objectContaining({ from: { lane: 1, at: "mid" }, to: { lane: 0, at: "bottom" }, edges: expect.arrayContaining(["f1>a1"]), color: 1 }));
    // The shared line into a1 carries both edges, so hovering f1 highlights it too.
    expect(g.rows[4]!.segments).toEqual([expect.objectContaining({ from: { lane: 0, at: "top" }, to: { lane: 0, at: "mid" }, edges: ["a2>a1", "f1>a1"] })]);
    // Lane 1 passes straight through a2's row.
    expect(g.rows[2]!.segments).toContainEqual(expect.objectContaining({ from: { lane: 1, at: "top" }, to: { lane: 1, at: "bottom" }, edges: expect.arrayContaining(["f2>f1"]) }));
  });

  it("frees lanes after a fork so later branches reuse them", () => {
    const g = layoutGraph([n("m2", ["m1", "g1"]), n("g1", ["m1"], { branch: "g" }), n("m1", ["m0", "f1"]), n("f1", ["m0"], { branch: "f" }), n("m0", [])]);
    expect(g.laneCount).toBe(2);
    expect(lanesOf(g)).toEqual(["m2@0", "g1@1", "m1@0", "f1@1", "m0@0"]);
  });

  it("a parent outside the loaded window keeps its lane open to the end", () => {
    const g = layoutGraph([n("b", ["a"]), n("x", ["zzz"], { branch: "other" })]);
    expect(lanesOf(g)).toEqual(["b@0", "x@1"]);
    expect(g.rows[1]!.segments).toContainEqual(expect.objectContaining({ from: { lane: 0, at: "top" }, to: { lane: 0, at: "bottom" }, edges: expect.arrayContaining(["b>a"]) }));
  });

  it("pending (unpushed / working copy) edges are dashed", () => {
    const g = layoutGraph([n("__working__", ["h"], { pending: true, nodeType: "pending" }), n("h", ["g"], { pending: true }), n("g", [])]);
    expect(g.rows[0]!.segments[0]).toMatchObject({ dashed: true, edges: expect.arrayContaining(["__working__>h"]) });
    expect(g.rows[1]!.segments.find((s) => s.edges.includes("h>g"))).toMatchObject({ dashed: true });
  });
});

describe("primary branch", () => {
  it("keeps the trunk in lane 0 even when a newer side branch comes first", () => {
    const g = layoutGraph([n("f1", ["m2"], { branch: "feature" }), n("m2", ["m1"]), n("m1", [])], { primaryBranch: "main" });
    expect(lanesOf(g)).toEqual(["f1@1", "m2@0", "m1@0"]);
    expect(g.rows[1]!.color).toBe(0);
    // m2 is expected by f1's lane (1) — it still lands where f1 points, then the trunk continues.
    expect(g.rows.map((r) => r.lanesBefore.length)).toEqual([0, 2, 1]);
  });
  it("without the option, the newest revision takes lane 0", () => {
    const g = layoutGraph([n("f1", ["m2"], { branch: "feature" }), n("m2", ["m1"]), n("m1", [])]);
    expect(lanesOf(g)).toEqual(["f1@0", "m2@0", "m1@0"]);
  });
});

describe("timeline items", () => {
  it("adds an author header when the author or the day changes", () => {
    const day = Date.UTC(2026, 10, 3, 12);
    const g = layoutGraph([
      n("c", ["b"], { author: { name: "matt", avatarInitials: "MA", color: 1 }, timestamp: day }),
      n("b", ["a"], { author: { name: "matt", avatarInitials: "MA", color: 1 }, timestamp: day - 3600_000 }),
      n("a", ["z"], { author: { name: "cat", avatarInitials: "CA", color: 2 }, timestamp: day - 7200_000 }),
      n("z", [], { author: { name: "cat", avatarInitials: "CA", color: 2 }, timestamp: day - 3 * 86_400_000 }),
    ]);
    expect(timelineItems(g).map((i) => (i.kind === "header" ? `H:${i.author.name}` : i.key))).toEqual(["H:matt", "c", "b", "H:cat", "a", "H:cat", "z"]);
  });

  it("initials, color slots and relative time", () => {
    expect(initials("ada@studio.dev")).toBe("AD");
    expect(initials("matthaus.bauer@studio.dev")).toBe("MB");
    expect(initials("Catherine Bell")).toBe("CB");
    expect(colorSlot("ada")).toBe(colorSlot("ada"));
    const now = new Date(2026, 10, 3, 15, 0).getTime();
    expect(relativeTime(new Date(2026, 10, 3, 9, 42).getTime(), now)).toBe("09:42");
    expect(relativeTime(new Date(2026, 10, 2, 9, 5).getTime(), now)).toBe("Yesterday 09:05");
    expect(relativeTime(new Date(2026, 9, 31, 9, 5).getTime(), now)).toBe("3 days ago");
    expect(relativeTime(new Date(2026, 8, 1).getTime(), now)).toBe("2026-09-01");
  });
});
