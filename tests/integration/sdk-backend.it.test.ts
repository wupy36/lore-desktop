// Real Lore: SdkBackend against a running loreserver. Skipped unless
// LORE_IT_REMOTE is set, e.g.  LORE_IT_REMOTE=lore://127.0.0.1:41337 pnpm test:it
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SdkBackend } from "../../src/main/lore/SdkBackend";
import type { OpContext, Progress } from "../../src/main/lore/LoreBackend";

const REMOTE = process.env.LORE_IT_REMOTE;
const ctx = (): OpContext & { seen: Progress[] } => {
  const seen: Progress[] = [];
  return { signal: new AbortController().signal, progress: (p) => seen.push(p), seen };
};

describe.skipIf(!REMOTE)("SdkBackend (real Lore)", () => {
  let root: string;
  let b: SdkBackend;
  const name = `DesktopIT${Date.now().toString(36)}`;
  let seedPath: string;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "lore-desktop-it-"));
    b = await SdkBackend.create();
    // Seed a remote repository the way a user would with the CLI: create, add files, commit, push.
    seedPath = join(root, "seed");
    mkdirSync(join(seedPath, "Source"), { recursive: true });
    const { lore } = await import("@lore-vcs/sdk");
    const ok = (rc: number) => expect(rc).toBe(0);
    ok(await lore.repositoryCreate({ repositoryPath: seedPath }, { repositoryUrl: `${REMOTE}/${name}` }).waitAsync());
    writeFileSync(join(seedPath, "Source", "main.cpp"), "int main(){}\n");
    writeFileSync(join(seedPath, "Hero.uasset"), Buffer.alloc(200_000, 1));
    await b.openRepository(seedPath);
    await b.stage(["Source/main.cpp", "Hero.uasset"]);
    await b.commit("seed");
    await b.push(undefined, ctx());
  }, 60_000);

  afterAll(async () => {
    await b?.dispose();
    rmSync(root, { recursive: true, force: true });
  });

  it("clones, names the remote, and lists the full tree", async () => {
    const c = ctx();
    const repo = await b.cloneRepository({ url: `${REMOTE}/${name}`, path: join(root, "work") }, c);
    expect(repo).toMatchObject({ branch: "main", revision: 1, aheadBy: 0, offline: false, remoteUrl: `${REMOTE}/${name}` });
    const files = await b.listFiles();
    expect(files.map((f) => [f.path, f.action]).sort()).toEqual([
      ["Hero.uasset", "none"],
      ["Source/main.cpp", "none"],
    ]);
    expect(files.find((f) => f.path === "Hero.uasset")).toMatchObject({ size: 200_000, binary: true });
  });

  it("dirty → status → stage → unstage → reset", async () => {
    const work = join(root, "work");
    appendFileSync(join(work, "Source", "main.cpp"), "// edit\n");
    writeFileSync(join(work, "Source", "new.h"), "#pragma once\n");
    await b.markDirty(["Source/main.cpp", "Source/new.h"]);
    let s = await b.status({});
    expect(s.files.map((f) => [f.path, f.action, f.staged]).sort()).toEqual([
      ["Source/main.cpp", "modify", false],
      ["Source/new.h", "add", false],
    ]);
    await b.stage(["Source/main.cpp"]);
    expect((await b.status({})).files.find((f) => f.path === "Source/main.cpp")?.staged).toBe(true);
    await b.unstage(["Source/main.cpp"]);
    expect((await b.status({})).files.find((f) => f.path === "Source/main.cpp")?.staged).toBe(false);
    await b.reset(["Source/main.cpp"]);
    s = await b.status({ checkDirty: true });
    expect(s.files.map((f) => f.path)).toEqual(["Source/new.h"]);
  });

  it("commit → ahead by 1 → push → in sync", async () => {
    await b.stage(["Source/new.h"]);
    const rev = await b.commit("Add header");
    expect(rev).toMatchObject({ number: 2, message: "Add header" });
    expect(rev.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(b.currentRepository()).toMatchObject({ revision: 2, aheadBy: 1 });
    const files = await b.listFiles();
    expect(files.find((f) => f.path === "Source/new.h")).toMatchObject({ action: "none", staged: false });
    await b.push(undefined, ctx());
    expect(b.currentRepository()?.aheadBy).toBe(0);
  });

  it("sync brings another instance up to date", async () => {
    await b.openRepository(seedPath);
    expect(b.currentRepository()?.revision).toBe(1);
    const c = ctx();
    await b.sync({}, c);
    expect(b.currentRepository()?.revision).toBe(2);
    expect((await b.listFiles()).some((f) => f.path === "Source/new.h")).toBe(true);
  });

  it("lists instances and remote repositories", async () => {
    // `repository instance list` reports instances sharing THIS repository's store; independent
    // clones each have their own store, so only the open one is listed.
    const inst = await b.listInstances();
    // Paths come back in native form (Lore itself reports forward slashes on Windows).
    expect(inst.map((i) => i.path)).toEqual([normalize(seedPath)]);
    const remotes = await b.listRemoteRepositories(REMOTE as string);
    expect(remotes.some((r) => r.name === name)).toBe(true);
  });

  it("exports a file as of a revision (lore file write) for the external diff tool", async () => {
    await b.openRepository(join(root, "work"));
    const out = join(root, "base_main.cpp");
    await b.exportFile("Source/main.cpp", undefined, out);
    expect(readFileSync(out, "utf8")).toBe("int main(){}\n");
  });

  it("repository maintenance: verify, gc, flush, prune", async () => {
    for (const op of ["verify", "gc", "flush", "prune"] as const) {
      const msg = await b.maintenance(op, ctx());
      expect(msg.length, op).toBeGreaterThan(5);
    }
  });

  it("creates a local-only repository, then a server repository", async () => {
    const local = await b.createRepository({ path: join(root, "LocalOnly"), name: "LocalOnly" });
    expect(local).toMatchObject({ name: "LocalOnly", offline: true });
    expect(existsSync(join(root, "LocalOnly", ".lore"))).toBe(true);
    writeFileSync(join(root, "LocalOnly", "a.txt"), "a\n");
    await b.stage(["a.txt"]);
    expect((await b.commit("local")).number).toBe(1);

    const onlineName = `${name}Created`;
    const online = await b.createRepository({ path: join(root, onlineName), name: onlineName, remoteUrl: REMOTE as string });
    expect(online).toMatchObject({ offline: false, remoteUrl: `${REMOTE}/${onlineName}` });
    expect((await b.listRemoteRepositories(REMOTE as string)).some((r) => r.name === onlineName)).toBe(true);
  });

  it("history: messages, timestamps, branch names, and authors from --identity", async () => {
    await b.openRepository(join(root, "work"));
    b.setIdentity("ada@studio.dev");
    appendFileSync(join(root, "work", "Source", "main.cpp"), "// by ada\n");
    await b.stage(["Source/main.cpp"]);
    await b.commit("Ada edits main");
    b.setIdentity(null);
    const h = await b.history({ length: 10 });
    expect(h[0]).toMatchObject({ message: "Ada edits main", author: "ada@studio.dev", branch: "main" });
    expect(h.map((r) => r.message)).toEqual(expect.arrayContaining(["Add header", "seed"]));
    expect(h[0]!.timestamp).toBeGreaterThan(Date.now() - 600_000);
    expect(h[0]!.parents).toEqual([h[1]!.hash]);
  });

  it("file history lists the revisions that touched a file", async () => {
    const fh = await b.fileHistory("Source/main.cpp", 10);
    expect(fh.map((r) => r.message)).toEqual(["Ada edits main", "seed"]);
    expect(fh[1]).toMatchObject({ action: "add", path: "Source/main.cpp" });
  });

  it("diff: unified text against a revision, metadata for binaries", async () => {
    const work = join(root, "work");
    appendFileSync(join(work, "Source", "main.cpp"), "// local\n");
    const d = await b.diff({ path: "Source/main.cpp" });
    expect(d.binary).toBe(false);
    expect(d.unified).toContain("+// local");
    const older = await b.diff({ path: "Source/main.cpp", source: "main@1" });
    expect(older.unified).toContain("+// by ada");
    writeFileSync(join(work, "Hero.uasset"), Buffer.alloc(250_000, 2));
    const bin = await b.diff({ path: "Hero.uasset" });
    expect(bin).toMatchObject({ binary: true, unified: null });
    expect(bin.source?.size).toBe(200_000);
    expect(bin.target).toMatchObject({ revision: "working tree", size: 250_000 });
    expect(bin.source?.hash).not.toBe(bin.target?.hash);
    await b.reset(["Source/main.cpp", "Hero.uasset"]);
  });

  it("revision detail lists changed files and metadata", async () => {
    const [latest] = await b.history({ length: 1 });
    const d = await b.revisionDetail(latest!.hash);
    expect(d).toMatchObject({ number: latest!.number, message: "Ada edits main", author: "ada@studio.dev" });
    expect(d.files).toEqual([expect.objectContaining({ path: "Source/main.cpp" })]);
    expect(d.metadata.message).toBe("Ada edits main");
  });

  it("amend rewrites the latest (unpushed) commit message", async () => {
    await b.amend("Ada edits main (amended)");
    expect((await b.history({ length: 1 }))[0]?.message).toBe("Ada edits main (amended)");
  });

  it("graph: HEAD and unpushed flags, deduplicated across branches, newest first", async () => {
    // work has the amended commit unpushed (ahead 1).
    const g = await b.graph({ scope: "all", length: 50 });
    expect(new Set(g.map((r) => r.hash)).size).toBe(g.length);
    const head = g.find((r) => r.isHead);
    expect(head).toMatchObject({ message: "Ada edits main (amended)", pending: true, branch: "main" });
    expect(g.filter((r) => r.pending).map((r) => r.hash)).toEqual([head!.hash]);
    for (let i = 1; i < g.length; i++) expect(g[i - 1]!.timestamp).toBeGreaterThanOrEqual(g[i]!.timestamp);
    // Parents reference revisions in the set (linear history here).
    const ids = new Set(g.map((r) => r.hash));
    expect(g.filter((r) => r.parents.length).every((r) => r.parents.every((p) => ids.has(p)))).toBe(true);
    expect((await b.graph({ scope: "current", length: 50 })).length).toBe(g.length);
  });

  it("branches: create switches to it, list shows where it lives, protect/archive, switch back", async () => {
    const created = await b.createBranch("feature/it");
    expect(created).toMatchObject({ name: "feature/it", current: true, where: "local" });
    expect(b.currentRepository()?.branch).toBe("feature/it");
    let list = await b.listBranches();
    expect(list.find((x) => x.name === "main")).toMatchObject({ current: false });
    await b.switchBranch("main", {}, ctx());
    expect(b.currentRepository()?.branch).toBe("main");
    list = await b.listBranches();
    expect(list[0]).toMatchObject({ name: "main", current: true, latest: b.currentRepository()?.revision });
    await b.branchAction("main", "protect");
    await b.branchAction("main", "unprotect");
    await b.branchAction("feature/it", "archive");
    expect((await b.listBranches()).find((x) => x.name === "feature/it")?.archived ?? true).toBe(true);
  });

  it("account: identity source and an unauthenticated server is reported, not an error", async () => {
    let a = await b.authInfo();
    expect(a).toMatchObject({ authSupported: false, loggedIn: false, identitySource: expect.any(String) });
    expect(a.note).toMatch(/no authentication/);
    b.setIdentity("me@studio.dev");
    a = await b.authInfo();
    expect(a).toMatchObject({ identity: "me@studio.dev", identitySource: "preference" });
    b.setIdentity(null);
  });

  it("health: behind/ahead after the other instance pushes", async () => {
    // work is 1 ahead (amended commit, not pushed). Push it, then seed is behind by 1.
    await b.push(undefined, ctx());
    await b.openRepository(seedPath);
    expect(b.currentRepository()).toMatchObject({ behindBy: 1, aheadBy: 0, mergePending: false });
    await b.sync({}, ctx());
    expect(b.currentRepository()).toMatchObject({ behindBy: 0 });
  });

  it("reports Lore errors as LoreError with the message", async () => {
    await expect(b.commit("nothing staged")).rejects.toThrow(/./);
  });
});
