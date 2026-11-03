// Fixture-backed LoreBackend. Lets the whole app run with `--mock` and no
// Lore install. Stateful: stage/commit/push/sync/locks mutate in-memory data.
// Environment-agnostic (no Node imports) so renderer tests can use it.
import type {
  AuthInfo,
  Branch,
  DiffResult,
  FileEntry,
  FileRevision,
  Instance,
  Lock,
  RemoteRepo,
  RepoInfo,
  Revision,
  StatusResult,
} from "@shared/types";
import { generateMockRepo, mulberry32, type MockRepoData } from "./mock/fixtures";
import {
  CancelledError,
  LoreError,
  type CloneOptions,
  type LoreBackend,
  type OpContext,
  type StatusOptions,
  type SyncOptions,
} from "./LoreBackend";

export interface MockOptions {
  /** Simulated latency per call, ms. 0 in tests. */
  latencyMs?: number;
  /** Steps for simulated long ops (sync/push/clone). */
  progressSteps?: number;
  stepMs?: number;
  identity?: string;
  seed?: number;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError());
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(new CancelledError())), { once: true });
  });

const clone = <T>(v: T): T => structuredClone(v);

export class MockBackend implements LoreBackend {
  readonly kind = "mock" as const;
  readonly canCancel = true;
  private data: MockRepoData;
  private repo: RepoInfo | null = null;
  private byPath = new Map<string, FileEntry>();
  private readonly opts: Required<MockOptions>;

  constructor(opts: MockOptions = {}) {
    this.opts = { latencyMs: 40, progressSteps: 20, stepMs: 120, identity: "me@studio.dev", seed: 1337, ...opts };
    this.data = generateMockRepo(this.opts.seed);
    this.reindex();
  }

  private reindex() {
    this.byPath = new Map(this.data.files.map((f) => [f.path, f]));
  }

  private async delay(signal?: AbortSignal) {
    if (this.opts.latencyMs > 0) await sleep(this.opts.latencyMs, signal);
  }

  private requireRepo(): RepoInfo {
    if (!this.repo) throw new LoreError("No repository open");
    return this.repo;
  }

  private currentBranch(): Branch {
    const b = this.data.branches.find((x) => x.current);
    if (!b) throw new LoreError("No current branch");
    return b;
  }

  /** Expand directory paths to the files beneath them (Lore stages directories recursively). */
  private resolve(paths: string[]): FileEntry[] {
    const out = new Set<FileEntry>();
    for (const p of paths) {
      const exact = this.byPath.get(p);
      if (exact) {
        out.add(exact);
        continue;
      }
      const prefix = p === "." || p === "" ? "" : p.replace(/\/?$/, "/");
      let hit = false;
      for (const f of this.data.files) {
        if (f.path.startsWith(prefix)) {
          out.add(f);
          hit = true;
        }
      }
      if (!hit) throw new LoreError(`Path not found in repository: ${p}`);
    }
    return [...out];
  }

  private async simulate(ctx: OpContext, unit: "files" | "fragments", total: number, label: string) {
    const steps = this.opts.progressSteps;
    for (let i = 1; i <= steps; i++) {
      await sleep(this.opts.stepMs, ctx.signal);
      ctx.progress({ current: Math.round((total * i) / steps), total, unit, label });
    }
  }

  // ---- repository ----

  async openRepository(path: string): Promise<RepoInfo> {
    await this.delay();
    const b = this.currentBranch();
    const head = this.data.revisions[0];
    this.repo = {
      path,
      name: path.split(/[\\/]/).filter(Boolean).pop() ?? "ShooterGame",
      remoteUrl: this.data.remotes[0]?.url ?? null,
      repositoryId: this.data.remotes[0]?.id ?? "mock",
      instanceId: "0192f0c4-6a1e-7c3b-9f00-mockinstance",
      branch: b.name,
      revision: head?.number ?? null,
      revisionHash: head?.hash ?? null,
      aheadBy: 0,
      offline: false,
    };
    return clone(this.repo);
  }

  currentRepository(): RepoInfo | null {
    return this.repo ? clone(this.repo) : null;
  }

  async cloneRepository(o: CloneOptions, ctx: OpContext): Promise<RepoInfo> {
    await this.simulate(ctx, "files", this.data.files.length, `Clone ${o.url}`);
    return this.openRepository(o.path);
  }

  async listInstances(): Promise<Instance[]> {
    await this.delay();
    return [
      { path: "D:/Lore/ShooterGame", instanceId: "0192f0c4-6a1e-7c3b-9f00-mockinstance", repositoryName: "ShooterGame" },
      { path: "D:/Lore/ShooterGame-release", instanceId: "0192f0c4-6a1e-7c3b-9f00-mockrelease", repositoryName: "ShooterGame" },
    ];
  }

  async listRemoteRepositories(_remoteUrl: string): Promise<RemoteRepo[]> {
    await this.delay();
    return clone(this.data.remotes);
  }

  // ---- workspace ----

  async status(o: StatusOptions): Promise<StatusResult> {
    await this.delay();
    const repo = this.requireRepo();
    if (o.checkDirty) {
      // Simulate "revert unchanged": a few dirty-but-identical files drop out.
      for (const f of this.data.files) {
        if (f.dirty && !f.staged && f.action === "modify" && f.path.endsWith("0")) Object.assign(f, { dirty: false, action: "none" });
      }
    }
    const files = this.data.files.filter((f) => f.dirty || f.staged || f.action !== "none" || f.conflict);
    return { branch: repo.branch, revision: repo.revision, files: clone(files), scanned: !!o.scan };
  }

  async listFiles(): Promise<FileEntry[]> {
    await this.delay();
    this.requireRepo();
    return clone(this.data.files);
  }

  async stage(paths: string[]): Promise<void> {
    await this.delay();
    for (const f of this.resolve(paths)) if (f.dirty || f.action !== "none") f.staged = true;
  }

  async unstage(paths: string[]): Promise<void> {
    await this.delay();
    for (const f of this.resolve(paths)) f.staged = false;
  }

  async reset(paths: string[], o: { purge?: boolean } = {}): Promise<void> {
    await this.delay();
    const targets = this.resolve(paths);
    const drop = new Set<FileEntry>();
    for (const f of targets) {
      if (f.action === "add") {
        // Untracked files only disappear with --purge; resetting a staged add just unstages it.
        if (o.purge) drop.add(f);
        else f.staged = false;
        continue;
      }
      Object.assign(f, { staged: false, dirty: false, action: "none", conflict: false, fromPath: null });
    }
    if (drop.size) {
      this.data.files = this.data.files.filter((f) => !drop.has(f));
      this.reindex();
    }
  }

  async markDirty(paths: string[]): Promise<void> {
    for (const p of paths) {
      const f = this.byPath.get(p);
      if (f && f.action === "none") Object.assign(f, { dirty: true, action: "modify" });
    }
  }

  // ---- revisions ----

  async commit(message: string): Promise<Revision> {
    await this.delay();
    const repo = this.requireRepo();
    const staged = this.data.files.filter((f) => f.staged);
    if (staged.length === 0) throw new LoreError("Nothing staged to commit");
    const head = this.data.revisions[0];
    const number = (head?.number ?? 0) + 1;
    const rnd = mulberry32(number * 7919);
    const rev: Revision = {
      number,
      hash: Array.from({ length: 64 }, () => Math.floor(rnd() * 16).toString(16)).join(""),
      branch: repo.branch,
      author: this.opts.identity,
      timestamp: Date.now(),
      message,
      parents: head ? [head.hash] : [],
    };
    this.data.revisions.unshift(rev);
    const removed = new Set<FileEntry>();
    for (const f of staged) {
      if (f.action === "delete") removed.add(f);
      else Object.assign(f, { staged: false, dirty: false, action: "none", lastRevision: number, fromPath: null });
    }
    if (removed.size) {
      this.data.files = this.data.files.filter((f) => !removed.has(f));
      this.reindex();
    }
    Object.assign(repo, { revision: number, revisionHash: rev.hash, aheadBy: repo.aheadBy + 1 });
    this.currentBranch().latest = number;
    return clone(rev);
  }

  async push(_branch: string | undefined, ctx: OpContext): Promise<void> {
    const repo = this.requireRepo();
    if (repo.aheadBy === 0) throw new LoreError("Nothing to push: local branch matches remote");
    await this.simulate(ctx, "fragments", repo.aheadBy * 128, `Push ${repo.branch}`);
    repo.aheadBy = 0;
  }

  async sync(o: SyncOptions, ctx: OpContext): Promise<void> {
    const repo = this.requireRepo();
    await this.simulate(ctx, "files", 400, `Sync ${o.revision ?? `${repo.branch}@LATEST`}`);
    if (o.reset) {
      for (const f of this.data.files) if (!f.staged && f.action === "modify") Object.assign(f, { dirty: false, action: "none" });
    }
    if (o.viewFile) this.data.view = [`# from ${o.viewFile}`];
  }

  async history(o: { branch?: string; length: number }): Promise<Revision[]> {
    await this.delay();
    const revs = o.branch && o.branch !== this.currentBranch().name ? this.data.revisions.slice(-20).map((r) => ({ ...r, branch: o.branch as string })) : this.data.revisions;
    return clone(revs.slice(0, o.length));
  }

  async fileHistory(path: string, length: number): Promise<FileRevision[]> {
    await this.delay();
    const f = this.byPath.get(path);
    if (!f) throw new LoreError(`Path not found in repository: ${path}`);
    if (f.lastRevision === null) return [];
    const rnd = mulberry32(path.length * 31 + f.lastRevision);
    const out: FileRevision[] = [];
    for (const r of this.data.revisions) {
      if (r.number > f.lastRevision) continue;
      if (out.length > 0 && rnd() > 0.15 && r.number !== 1) continue;
      out.push({ ...r, path, action: out.length === 0 && r.number === 1 ? "add" : "modify", size: Math.max(64, Math.round(f.size * (0.6 + rnd() * 0.5))), fileHash: r.hash.slice(0, 16) + path.length.toString(16).padStart(48, "0") });
      if (out.length >= length) break;
    }
    return clone(out);
  }

  async diff(o: { path: string; source?: string; target?: string }): Promise<DiffResult> {
    await this.delay();
    const f = this.byPath.get(o.path);
    if (!f) throw new LoreError(`Path not found in repository: ${o.path}`);
    const head = this.data.revisions[0];
    const source = { revision: o.source ?? head?.hash ?? "", size: Math.round(f.size * 0.97), hash: (head?.hash ?? "").slice(0, 32) + "a".repeat(32) };
    const target = { revision: o.target ?? "working tree", size: f.size, hash: (head?.hash ?? "").slice(0, 32) + "b".repeat(32) };
    if (f.binary) return { path: o.path, binary: true, unified: null, source, target };
    const name = o.path.split("/").pop() ?? o.path;
    const unified = [
      `--- a/${o.path}`,
      `+++ b/${o.path}`,
      "@@ -12,7 +12,9 @@",
      ` // ${name}`,
      " #include \"CoreMinimal.h\"",
      "-static constexpr float RecoilScale = 1.0f;",
      "+static constexpr float RecoilScale = 0.85f;",
      "+static constexpr float RecoilRecovery = 6.0f;",
      " ",
      " void Tick(float DeltaSeconds)",
      " {",
      "-    ApplyRecoil(DeltaSeconds);",
      "+    ApplyRecoil(DeltaSeconds * RecoilScale);",
      "+    RecoverRecoil(DeltaSeconds * RecoilRecovery);",
      " }",
    ].join("\n");
    return { path: o.path, binary: false, unified, source, target };
  }

  // ---- branches ----

  async listBranches(): Promise<Branch[]> {
    await this.delay();
    return clone(this.data.branches);
  }

  async switchBranch(name: string, _o: { reset?: boolean }, ctx: OpContext): Promise<void> {
    const repo = this.requireRepo();
    const target = this.data.branches.find((b) => b.name === name);
    if (!target) throw new LoreError(`Branch not found: ${name}`);
    await this.simulate(ctx, "files", 250, `Switch to ${name}`);
    for (const b of this.data.branches) b.current = b === target;
    Object.assign(repo, { branch: name, revision: target.latest, aheadBy: 0 });
  }

  async createBranch(name: string): Promise<Branch> {
    await this.delay();
    if (this.data.branches.some((b) => b.name === name)) throw new LoreError(`Branch already exists: ${name}`);
    const b: Branch = { name, id: name.padEnd(32, "0").slice(0, 32), latest: this.requireRepo().revision, current: false, protected: false, archived: false };
    this.data.branches.push(b);
    return clone(b);
  }

  // ---- locks (advisory in Lore) ----

  async lockAcquire(paths: string[]): Promise<Lock[]> {
    await this.delay();
    const repo = this.requireRepo();
    const acquired: Lock[] = [];
    for (const p of paths) {
      const f = this.byPath.get(p);
      if (!f) throw new LoreError(`Path not found in repository: ${p}`);
      if (f.lockOwner && f.lockOwner !== this.opts.identity) throw new LoreError(`${p} is locked by ${f.lockOwner}`);
      if (f.lockOwner === this.opts.identity) continue;
      f.lockOwner = this.opts.identity;
      const l: Lock = { path: p, owner: this.opts.identity, branch: repo.branch, acquiredAt: Date.now() };
      this.data.locks.push(l);
      acquired.push(l);
    }
    return clone(acquired);
  }

  async lockRelease(paths: string[]): Promise<void> {
    await this.delay();
    const set = new Set(paths);
    for (const p of paths) {
      const f = this.byPath.get(p);
      if (f?.lockOwner && f.lockOwner !== this.opts.identity) throw new LoreError(`${p} is locked by ${f.lockOwner}; release requires --owner`);
      if (f) f.lockOwner = null;
    }
    this.data.locks = this.data.locks.filter((l) => !set.has(l.path));
  }

  async lockQuery(q: { branch?: string; owner?: string; path?: string }): Promise<Lock[]> {
    await this.delay();
    return clone(this.data.locks.filter((l) => (!q.branch || l.branch === q.branch) && (!q.owner || l.owner === q.owner) && (!q.path || l.path === q.path)));
  }

  async authInfo(): Promise<AuthInfo> {
    await this.delay();
    return { remote: this.data.remotes[0]?.url ?? null, identity: this.opts.identity, loggedIn: true };
  }

  // ---- views ----

  async getView(): Promise<string[]> {
    await this.delay();
    return [...this.data.view];
  }

  async applyView(rules: string[], ctx: OpContext): Promise<void> {
    await this.simulate(ctx, "files", 300, "Re-materialize view");
    this.data.view = [...rules];
  }

  async dispose(): Promise<void> {}
}
