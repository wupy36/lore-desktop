import { beforeEach, describe, expect, it } from "vitest";
import { MockBackend } from "../../src/main/lore/MockBackend";
import { CancelledError, LoreError, type OpContext } from "../../src/main/lore/LoreBackend";

const ctx = (signal = new AbortController().signal): OpContext & { seen: number[] } => {
  const seen: number[] = [];
  return { signal, progress: (p) => seen.push(p.current), seen };
};

describe("MockBackend", () => {
  let b: MockBackend;
  beforeEach(async () => {
    b = new MockBackend({ latencyMs: 0, stepMs: 1, progressSteps: 4 });
    await b.openRepository("D:/Lore/ShooterGame");
  });

  it("serves a large deterministic tree", async () => {
    const files = await b.listFiles();
    expect(files.length).toBeGreaterThan(10_000);
    expect(new Set(files.map((f) => f.path)).size).toBe(files.length);
    const again = await new MockBackend({ latencyMs: 0 }).openRepository("x").then(() => b.listFiles());
    expect(again.length).toBe(files.length);
  });

  it("status reports only changed files", async () => {
    const s = await b.status({ scan: true });
    expect(s.scanned).toBe(true);
    expect(s.files.length).toBeGreaterThan(0);
    expect(s.files.every((f) => f.dirty || f.staged || f.action !== "none")).toBe(true);
  });

  it("stage -> commit -> push", async () => {
    const path = "Source/Game/Player/HeroMovement.cpp";
    await b.stage([path]);
    let f = (await b.listFiles()).find((x) => x.path === path);
    expect(f?.staged).toBe(true);

    const rev = await b.commit("Tune movement");
    expect(rev.message).toBe("Tune movement");
    f = (await b.listFiles()).find((x) => x.path === path);
    expect(f).toMatchObject({ staged: false, dirty: false, action: "none", lastRevision: rev.number });
    expect(b.currentRepository()?.aheadBy).toBe(1);
    expect((await b.history({ length: 1 }))[0]?.hash).toBe(rev.hash);

    const c = ctx();
    await b.push(undefined, c);
    expect(c.seen.length).toBe(4);
    expect(b.currentRepository()?.aheadBy).toBe(0);
    await expect(b.push(undefined, ctx())).rejects.toBeInstanceOf(LoreError);
  });

  it("commit with nothing staged fails", async () => {
    const staged = (await b.listFiles()).filter((f) => f.staged).map((f) => f.path);
    await b.unstage(staged);
    await expect(b.commit("x")).rejects.toThrow(/Nothing staged/);
  });

  it("stages a directory recursively", async () => {
    await b.stage(["Content/Weapons/New"]);
    const news = (await b.listFiles()).filter((f) => f.path.startsWith("Content/Weapons/New/"));
    expect(news.length).toBe(9);
    expect(news.every((f) => f.staged)).toBe(true);
  });

  it("reset discards changes; untracked only removed with purge", async () => {
    const files = await b.listFiles();
    const mod = files.find((f) => f.action === "modify" && !f.staged) as { path: string };
    const add = files.find((f) => f.action === "add") as { path: string };
    await b.reset([mod.path, add.path]);
    const after = await b.listFiles();
    expect(after.find((f) => f.path === mod.path)).toMatchObject({ dirty: false, action: "none" });
    expect(after.find((f) => f.path === add.path)).toMatchObject({ action: "add", staged: false });
    await b.reset([add.path], { purge: true });
    expect((await b.listFiles()).some((f) => f.path === add.path)).toBe(false);
  });

  it("locks are exclusive per owner", async () => {
    const locks = await b.lockQuery({});
    const foreign = locks.find((l) => l.owner !== "me@studio.dev");
    expect(foreign).toBeDefined();
    await expect(b.lockAcquire([foreign!.path])).rejects.toThrow(/locked by/);
    const free = (await b.listFiles()).find((f) => f.binary && !f.lockOwner)!;
    const got = await b.lockAcquire([free.path]);
    expect(got[0]?.owner).toBe("me@studio.dev");
    await b.lockRelease([free.path]);
    expect((await b.lockQuery({ path: free.path })).length).toBe(0);
  });

  it("long ops honour cancellation", async () => {
    const ctrl = new AbortController();
    const p = b.sync({}, ctx(ctrl.signal));
    ctrl.abort();
    await expect(p).rejects.toBeInstanceOf(CancelledError);
  });

  it("diff: text gets unified, binary gets metadata", async () => {
    const text = await b.diff({ path: "Source/Game/Player/HeroMovement.cpp" });
    expect(text.binary).toBe(false);
    expect(text.unified).toMatch(/^--- a\//);
    const bin = (await b.listFiles()).find((f) => f.binary)!;
    const d = await b.diff({ path: bin.path });
    expect(d).toMatchObject({ binary: true, unified: null });
    expect(d.source?.size).toBeGreaterThan(0);
  });

  it("branch create/switch", async () => {
    await b.createBranch("feature/x");
    await expect(b.createBranch("feature/x")).rejects.toThrow(/exists/);
    await b.switchBranch("feature/x", {}, ctx());
    expect(b.currentRepository()?.branch).toBe("feature/x");
    expect((await b.listBranches()).find((x) => x.current)?.name).toBe("feature/x");
  });
});
