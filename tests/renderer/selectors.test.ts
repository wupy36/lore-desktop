import { describe, expect, it } from "vitest";
import { generateMockRepo } from "../../src/main/lore/mock/fixtures";
import { buildDirTree, filterFiles, formatSize, groupChanges } from "../../src/renderer/selectors";
import { useUi } from "../../src/renderer/store/ui";
import { useActivity } from "../../src/renderer/store/activity";

const { files } = generateMockRepo();

describe("selectors", () => {
  it("filters by dir, group, mode and text", () => {
    const base = { dir: "", group: null, viewMode: "all" as const, text: "" };
    expect(filterFiles(files, base).length).toBe(files.length);
    expect(filterFiles(files, { ...base, dir: "Content/Maps" }).every((f) => f.path.startsWith("Content/Maps/"))).toBe(true);
    expect(filterFiles(files, { ...base, dir: "Content/Map" }).length).toBe(0); // prefix must match a whole dir
    const g = groupChanges(files);
    expect(filterFiles(files, { ...base, group: "staged" }).length).toBe(g.staged.length);
    expect(filterFiles(files, { ...base, viewMode: "changed" }).length).toBe(g.staged.length + g.unstaged.length + g.untracked.length);
    expect(filterFiles(files, { ...base, text: "heromovement" }).length).toBe(1);
  });

  it("builds a dir tree with recursive counts", () => {
    const t = buildDirTree(files);
    expect(t.fileCount).toBe(files.length);
    const content = t.children.find((c) => c.name === "Content")!;
    expect(content.fileCount).toBe(files.filter((f) => f.path.startsWith("Content/")).length);
    expect(content.children.map((c) => c.name)).toEqual([...content.children.map((c) => c.name)].sort((a, b) => a.localeCompare(b)));
  });

  it("formats sizes", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(80 * 1024 * 1024)).toBe("80.0 MB");
  });
});

describe("ui store", () => {
  const order = ["a", "b", "c", "d", "e"];
  it("single, ctrl-toggle and shift-range selection", () => {
    const s = useUi.getState();
    s.select("b", {}, order);
    expect([...useUi.getState().selected]).toEqual(["b"]);
    s.select("d", { shift: true }, order);
    expect([...useUi.getState().selected]).toEqual(["b", "c", "d"]);
    s.select("c", { ctrl: true }, order);
    expect([...useUi.getState().selected].sort()).toEqual(["b", "d"]);
    s.selectAll(order);
    expect(useUi.getState().selected.size).toBe(5);
    s.clearSelection();
    expect(useUi.getState().selected.size).toBe(0);
  });
  it("clamps layout", () => {
    useUi.getState().setLayout({ sidebarW: 10, bottomH: 5000 });
    expect(useUi.getState().layout).toMatchObject({ sidebarW: 180, bottomH: 700 });
  });
  it("activity: transfer upsert ignores late progress after cancel", () => {
    const t = { id: "x", op: "sync", label: "s", state: "running" as const, current: 1, total: 10, unit: "files" as const, startedAt: 0, endedAt: null, error: null, cancellable: true };
    const a = useActivity.getState();
    a.upsertTransfer(t);
    a.upsertTransfer({ ...t, state: "cancelled", endedAt: 1 });
    a.upsertTransfer({ ...t, current: 5 });
    expect(useActivity.getState().transfers[0]?.state).toBe("cancelled");
  });
});
