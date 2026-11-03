import { describe, expect, it, vi } from "vitest";
import { Bus } from "../../src/main/bus";
import { RepoWatcher, type WatchFn } from "../../src/main/watcher";

function setup() {
  let emit: (p: string) => void = () => {};
  const watch: WatchFn = (_root, cb) => ((emit = cb), { close: vi.fn() });
  const markDirty = vi.fn(async (_p: string[]) => {});
  const checkDirty = vi.fn(async () => {});
  const bus = new Bus();
  const changed = vi.fn();
  bus.on("ws:changed", changed);
  const w = new RepoWatcher({ bus, watch, markDirty, checkDirty, debounceMs: 10_000, settleMs: 0 });
  w.start("/repo");
  return { w, emit: (p: string) => emit(p), markDirty, checkDirty, changed };
}

describe("RepoWatcher", () => {
  it("batches changes, normalizes separators, then dirty + check-dirty + ws:changed", async () => {
    const t = setup();
    t.emit("Source\\main.cpp");
    t.emit("Source/main.cpp");
    t.emit("Content/A.uasset");
    await t.w.flush();
    expect(t.markDirty).toHaveBeenCalledWith(["Source/main.cpp", "Content/A.uasset"]);
    expect(t.checkDirty).toHaveBeenCalledOnce();
    expect(t.changed).toHaveBeenCalledWith({ reason: "fs" });
  });

  it("ignores Lore's own .lore directory", async () => {
    const t = setup();
    t.emit(".lore/mutable/x");
    t.emit("sub\\.lore\\lock");
    await t.w.flush();
    expect(t.markDirty).not.toHaveBeenCalled();
  });

  it("suppresses events while paused (Lore writing the working tree)", async () => {
    const t = setup();
    t.w.pause();
    t.emit("synced.txt");
    t.w.resume();
    await t.w.flush();
    expect(t.markDirty).not.toHaveBeenCalled();
    t.emit("edited.txt");
    await t.w.flush();
    expect(t.markDirty).toHaveBeenCalledWith(["edited.txt"]);
  });

  it("survives backend errors", async () => {
    const t = setup();
    t.markDirty.mockRejectedValueOnce(new Error("locked"));
    t.emit("a");
    await t.w.flush();
    t.emit("b");
    await t.w.flush();
    expect(t.markDirty).toHaveBeenCalledTimes(2);
  });
});
