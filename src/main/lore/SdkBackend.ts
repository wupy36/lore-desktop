// LoreBackend over the official JS SDK (@lore-vcs/sdk, koffi FFI over
// lore-capi). Runs in the Electron main process only.
//
// Phase 2: repository open/clone/instances/remote list, status, full file
// listing (revision tree + status overlay), stage/unstage/reset/dirty,
// commit, push, sync — with per-op progress. History/diff/branches (Phase 3)
// and locks/views (Phase 4) still throw.
//
// Every call is serialized through one queue: Lore takes a repository lock per
// operation, and running e.g. a status refresh concurrently with a sync would
// only contend on it.
import { stat } from "node:fs/promises";
import { join, normalize } from "node:path";
import type * as Sdk from "@lore-vcs/sdk";
import type * as SdkEnums from "@lore-vcs/sdk/types/enums";
import type { LoreGlobalArgs } from "@lore-vcs/sdk/types/args";
import type { LoreEventFFI } from "@lore-vcs/sdk/types/events";
import type { FileEntry, Instance, MaintenanceOp, RemoteRepo, RepoInfo, Revision, StatusResult } from "@shared/types";
import { LoreError, type CloneOptions, type LoreBackend, type OpContext, type StatusOptions, type SyncOptions } from "./LoreBackend";
import {
  mapCloneProgress,
  mapCommitProgress,
  mapPushProgress,
  mapStatusFile,
  mapStatusRevision,
  mapSyncProgress,
  mergeTreeAndStatus,
  type StatusRevision,
  type TreeFile,
} from "./mappers";

type SdkModule = typeof Sdk;
type EnumsModule = typeof SdkEnums;
type Fluent = { callback(fn: (e: LoreEventFFI) => void): { waitAsync(): Promise<number> } };

const notYet = (op: string, phase: number) => () => Promise.reject(new LoreError(`${op}: not implemented in SdkBackend yet (Phase ${phase})`));
const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const TREE_CONCURRENCY = 8;

export class SdkBackend implements LoreBackend {
  readonly kind = "sdk" as const;
  readonly canCancel = false;
  private repo: RepoInfo | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  /** Committed tree listing, keyed by revision hash (a revision is immutable). */
  private treeCache: { hash: string; files: TreeFile[] } | null = null;

  private constructor(
    private readonly sdk: SdkModule,
    private readonly enums: EnumsModule,
  ) {}

  /** Loads the native library lazily so `--mock` never touches it. */
  static async create(): Promise<SdkBackend> {
    const [sdk, enums] = await Promise.all([import("@lore-vcs/sdk"), import("@lore-vcs/sdk/types/enums")]);
    return new SdkBackend(sdk, enums);
  }

  // ---- plumbing ----

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private requireRepo(): RepoInfo {
    if (!this.repo) throw new LoreError("No repository open");
    return this.repo;
  }

  /** Globals for the open repository. `workingDirectory` makes repo-relative paths resolve
   * against the repository, not the app's cwd (and is correct if the Lore service runs the call). */
  private globals(path = this.requireRepo().path): LoreGlobalArgs {
    return { repositoryPath: path, workingDirectory: path };
  }

  /** Run a fluent call. `onEvent` runs INSIDE the native callback: copy what you need. */
  private async run(call: Fluent, onEvent: (e: LoreEventFFI) => void = () => {}, signal?: AbortSignal): Promise<void> {
    const { LoreEventTag } = this.enums;
    let failure: { code: number; message: string } | null = null;
    const rc = await call
      .callback((e) => {
        if (e.tag === LoreEventTag.COMPLETE) {
          if (e.data.status !== 0) failure = { code: e.data.status, message: String(e.data.error?.message ?? "") };
          return;
        }
        // No per-call cancel in Lore: once aborted, stop forwarding events (results are dropped).
        if (!signal?.aborted) onEvent(e);
      })
      .waitAsync();
    const f = failure as { code: number; message: string } | null;
    if (f) throw new LoreError(f.message || `Lore error ${f.code}`, f.code);
    if (rc !== 0) throw new LoreError(`Lore call failed to start (code ${rc})`, rc);
  }

  private async statusRaw(path: string, o: StatusOptions & { revisionOnly?: boolean }): Promise<{ rev: StatusRevision | null; files: FileEntry[] }> {
    const { LoreEventTag } = this.enums;
    let rev: StatusRevision | null = null;
    const files: FileEntry[] = [];
    await this.run(
      this.sdk.lore.repositoryStatus(this.globals(path), {
        staged: true,
        scan: !!o.scan,
        checkDirty: !!o.checkDirty,
        revisionOnly: !!o.revisionOnly,
        ...(o.paths?.length ? { paths: o.paths } : {}),
      }),
      (e) => {
        if (e.tag === LoreEventTag.REPOSITORY_STATUS_REVISION) rev = mapStatusRevision(e.data);
        else if (e.tag === LoreEventTag.REPOSITORY_STATUS_FILE) {
          const f = mapStatusFile(e.data);
          if (f) files.push(f);
        }
      },
    );
    return { rev, files };
  }

  private async configGet(path: string, key: string): Promise<string | null> {
    const { LoreEventTag } = this.enums;
    let value: string | null = null;
    await this.run(this.sdk.lore.repositoryConfigGet(this.globals(path), { key }), (e) => {
      if (e.tag === LoreEventTag.REPOSITORY_CONFIG_GET) value = String(e.data.value);
    }).catch(() => undefined);
    return value;
  }

  private async remoteListRaw(url: string): Promise<{ id: string; name: string }[]> {
    const { LoreEventTag } = this.enums;
    const out: { id: string; name: string }[] = [];
    await this.run(this.sdk.lore.repositoryList({}, { url }), (e) => {
      if (e.tag === LoreEventTag.REPOSITORY_LIST_ENTRY) out.push({ id: e.data.id.toString(), name: String(e.data.name) });
    });
    return out;
  }

  /** Re-read branch/revision/ahead state into `this.repo` after an op. */
  private async refreshRepo(path: string): Promise<RepoInfo> {
    const { rev } = await this.statusRaw(path, { revisionOnly: true });
    const r = rev as StatusRevision | null;
    const prev = this.repo?.path === path ? this.repo : null;
    let remoteRoot = prev?.remoteUrl ? prev.remoteUrl.replace(/\/[^/]+\/?$/, "") : null;
    let remoteUrl = prev?.remoteUrl ?? null;
    if (!prev) {
      remoteRoot = await this.configGet(path, "remote_url");
      if (remoteRoot && r?.repositoryId) {
        // Name the remote repository by matching ids (the config only stores the server root).
        const entry = await this.remoteListRaw(remoteRoot)
          .then((list) => list.find((x) => x.id === r.repositoryId))
          .catch(() => undefined);
        remoteUrl = entry ? `${remoteRoot}/${entry.name}` : remoteRoot;
      }
    }
    this.repo = {
      path,
      name: baseName(path),
      remoteUrl,
      repositoryId: r?.repositoryId ?? "",
      instanceId: prev?.instanceId ?? "",
      branch: r?.branch ?? "",
      revision: r?.revision ?? null,
      revisionHash: r?.revisionHash ?? null,
      aheadBy: r?.aheadBy ?? 0,
      offline: r ? !r.remoteAvailable : true,
    };
    return { ...this.repo };
  }

  /** Breadth-first walk of the committed revision tree (low-level revision API). */
  private async listTree(path: string, repositoryId: string, revisionHash: string): Promise<TreeFile[]> {
    if (this.treeCache?.hash === revisionHash) return this.treeCache.files;
    const { LoreEventTag } = this.enums;
    const l = this.sdk.lore;
    let store = 0;
    await this.run(l.storageOpen({}, { repositoryPath: path }), (e) => {
      if (e.tag === LoreEventTag.STORAGE_OPENED) store = e.data.handleId;
    });
    let tree = 0;
    const files: TreeFile[] = [];
    try {
      await this.run(l.revisionTreeLoad({}, { store: { handleId: store }, repository: repositoryId, revisionHash }), (e) => {
        if (e.tag === LoreEventTag.REVISION_TREE_LOADED) tree = e.data.handleId;
      });
      const handle = { handleId: tree };
      let frontier: { id: number | null; prefix: string }[] = [{ id: null, prefix: "" }];
      while (frontier.length) {
        const next: { id: number; prefix: string }[] = [];
        for (let i = 0; i < frontier.length; i += TREE_CONCURRENCY) {
          await Promise.all(
            frontier.slice(i, i + TREE_CONCURRENCY).map(({ id, prefix }) =>
              this.run(l.revisionTreeListChildren({}, id === null ? { handle } : { handle, parentNodeId: id }), (e) => {
                if (e.tag !== LoreEventTag.REVISION_TREE_CHILD) return;
                const p = prefix + String(e.data.name);
                if (e.data.kind === 0) next.push({ id: e.data.nodeId, prefix: `${p}/` });
                else if (e.data.kind === 1) files.push({ path: p, size: Number(e.data.size) });
              }),
            ),
          );
        }
        frontier = next;
      }
    } finally {
      if (tree) await this.run(l.revisionTreeClose({}, { handle: { handleId: tree } })).catch(() => undefined);
      if (store) await this.run(l.storageClose({}, { handle: { handleId: store } })).catch(() => undefined);
    }
    this.treeCache = { hash: revisionHash, files };
    return files;
  }

  // ---- repository ----

  openRepository(path: string): Promise<RepoInfo> {
    return this.serial(async () => {
      this.repo = null;
      this.treeCache = null;
      return this.refreshRepo(path);
    });
  }

  currentRepository(): RepoInfo | null {
    return this.repo ? { ...this.repo } : null;
  }

  cloneRepository(o: CloneOptions, ctx: OpContext): Promise<RepoInfo> {
    return this.serial(async () => {
      const { LoreEventTag } = this.enums;
      await this.run(
        this.sdk.lore.repositoryClone(this.globals(o.path), {
          repositoryUrl: o.url,
          ...(o.branch ? { revision: `${o.branch}@LATEST` } : {}),
          ...(o.viewFile ? { view: o.viewFile } : {}),
        }),
        (e) => {
          if (e.tag === LoreEventTag.REPOSITORY_CLONE_PROGRESS) ctx.progress(mapCloneProgress(e.data));
        },
        ctx.signal,
      );
      this.repo = null;
      this.treeCache = null;
      return this.refreshRepo(o.path);
    });
  }

  createRepository(o: { path: string; name: string; remoteUrl?: string }): Promise<RepoInfo> {
    return this.serial(async () => {
      const remote = o.remoteUrl?.replace(/\/+$/, "");
      // Offline create takes the repository *name*; online create takes the full URL.
      await this.run(this.sdk.lore.repositoryCreate({ ...this.globals(o.path), offline: !remote }, { repositoryUrl: remote ? `${remote}/${o.name}` : o.name }));
      this.repo = null;
      this.treeCache = null;
      return this.refreshRepo(o.path);
    });
  }

  maintenance(op: MaintenanceOp, ctx: OpContext): Promise<string> {
    return this.serial(async () => {
      const { LoreEventTag } = this.enums;
      const l = this.sdk.lore;
      const g = this.globals();
      ctx.progress({ current: 0, total: null, unit: "items" });
      switch (op) {
        case "verify": {
          let healed = false;
          await this.run(l.repositoryVerifyState(g, {}), (e) => {
            if (e.tag === LoreEventTag.REPOSITORY_VERIFY_STATE_END) healed = !/^0*$/.test(e.data.healedStagedState.toString());
          });
          return healed ? "Repository state verified (staged state was healed)" : "Repository state is consistent";
        }
        case "gc":
          await this.run(l.repositoryGc(g, {}));
          return "Garbage collection complete";
        case "flush":
          await this.run(l.repositoryFlush(g, {}));
          return "Pending writes flushed";
        case "prune":
          await this.run(l.repositoryInstancePrune(g, {}));
          return "Stale instances pruned";
      }
    });
  }

  exportFile(path: string, revision: string | undefined, outPath: string): Promise<void> {
    return this.serial(() => this.run(this.sdk.lore.fileWrite(this.globals(), { path, output: outPath, ...(revision ? { revision } : {}) })));
  }

  listInstances(): Promise<Instance[]> {
    return this.serial(async () => {
      const { LoreEventTag } = this.enums;
      const out: Instance[] = [];
      const g = this.repo ? this.globals() : {};
      await this.run(this.sdk.lore.repositoryInstanceList(g, {}), (e) => {
        if (e.tag === LoreEventTag.REPOSITORY_INSTANCE && !e.data.stale) {
          // Lore reports forward slashes on Windows (C:/Users/...); use the native form the rest of the app uses.
          const path = normalize(String(e.data.path));
          out.push({ path, instanceId: e.data.instanceId.toString(), repositoryName: baseName(path) });
        }
      });
      return out;
    });
  }

  listRemoteRepositories(remoteUrl: string): Promise<RemoteRepo[]> {
    return this.serial(async () => (await this.remoteListRaw(remoteUrl)).map((r) => ({ ...r, url: `${remoteUrl}/${r.name}`, description: "" })));
  }

  // ---- workspace ----

  status(o: StatusOptions): Promise<StatusResult> {
    return this.serial(async () => {
      const repo = this.requireRepo();
      const { rev, files } = await this.statusRaw(repo.path, o);
      const r = rev as StatusRevision | null;
      return { branch: r?.branch ?? repo.branch, revision: r?.revision ?? null, files, scanned: !!o.scan };
    });
  }

  /** Committed tree (cached per revision) overlaid with tracked status. No disk walk. */
  listFiles(): Promise<FileEntry[]> {
    return this.serial(async () => {
      const repo = this.requireRepo();
      const { rev, files: changed } = await this.statusRaw(repo.path, {});
      const r = rev as StatusRevision | null;
      const tree = r && r.revisionHash && !/^0+$/.test(r.revisionHash) ? await this.listTree(repo.path, r.repositoryId, r.revisionHash) : [];
      // Lore doesn't read content of unstaged changes (dirty flags only), so status reports
      // size 0 for them; fill in the on-disk size for changed files (cheap: changed set only).
      await Promise.all(
        changed
          .filter((f) => f.size === 0 && f.action !== "delete")
          .map(async (f) => {
            f.size = await stat(join(repo.path, f.path)).then((st) => st.size, () => 0);
          }),
      );
      return mergeTreeAndStatus(tree, changed);
    });
  }

  stage(paths: string[], ctx?: OpContext): Promise<void> {
    return this.serial(async () => {
      const { LoreEventTag } = this.enums;
      await this.run(this.sdk.lore.fileStage(this.globals(), { paths }), (e) => {
        if (e.tag === LoreEventTag.FILE_STAGE_PROGRESS) ctx?.progress({ current: Number(e.data.count.totalCount), total: null, unit: "files" });
      });
    });
  }

  unstage(paths: string[]): Promise<void> {
    return this.serial(() => this.run(this.sdk.lore.fileUnstage(this.globals(), { paths })));
  }

  reset(paths: string[], o: { purge?: boolean } = {}): Promise<void> {
    return this.serial(() => this.run(this.sdk.lore.fileReset(this.globals(), { paths, purge: !!o.purge })));
  }

  markDirty(paths: string[]): Promise<void> {
    if (!paths.length) return Promise.resolve();
    return this.serial(() => this.run(this.sdk.lore.fileDirty(this.globals(), { paths })));
  }

  // ---- revisions ----

  commit(message: string, ctx?: OpContext): Promise<Revision> {
    return this.serial(async () => {
      const repo = this.requireRepo();
      const { LoreEventTag } = this.enums;
      let rev: Revision | null = null;
      await this.run(this.sdk.lore.revisionCommit(this.globals(), { message }), (e) => {
        if (e.tag === LoreEventTag.REVISION_COMMIT_REVISION) {
          const parent = e.data.parent.toString();
          rev = {
            number: Number(e.data.revisionNumber),
            hash: e.data.revision.toString(),
            branch: repo.branch,
            author: null, // not in the commit event; history (Phase 3) reports it
            timestamp: Date.now(),
            message,
            parents: /^0+$/.test(parent) ? [] : [parent],
          };
        } else if (e.tag === LoreEventTag.REVISION_COMMIT_PROGRESS) ctx?.progress(mapCommitProgress(e.data));
      });
      await this.refreshRepo(repo.path);
      const r = rev as Revision | null;
      if (!r) throw new LoreError("Commit completed without reporting a revision");
      return r;
    });
  }

  push(branch: string | undefined, ctx: OpContext): Promise<void> {
    return this.serial(async () => {
      const repo = this.requireRepo();
      const { LoreEventTag } = this.enums;
      await this.run(
        this.sdk.lore.branchPush(this.globals(), branch ? { branch } : {}),
        (e) => {
          if (e.tag === LoreEventTag.BRANCH_PUSH_FRAGMENT_PROGRESS) ctx.progress(mapPushProgress(e.data));
        },
        ctx.signal,
      );
      await this.refreshRepo(repo.path);
    });
  }

  sync(o: SyncOptions, ctx: OpContext): Promise<void> {
    return this.serial(async () => {
      const repo = this.requireRepo();
      const { LoreEventTag } = this.enums;
      await this.run(
        this.sdk.lore.revisionSync(this.globals(), {
          ...(o.revision ? { revision: o.revision } : {}),
          reset: !!o.reset,
          ...(o.viewFile ? { view: o.viewFile } : {}),
          ...(o.rootFiles?.length ? { rootFiles: o.rootFiles } : {}),
        }),
        (e) => {
          if (e.tag === LoreEventTag.REVISION_SYNC_PROGRESS) ctx.progress(mapSyncProgress(e.data));
        },
        ctx.signal,
      );
      await this.refreshRepo(repo.path);
    });
  }

  // Phase 2 (not in the core loop): auth
  authInfo = notYet("auth info", 2);
  // Phase 3
  history = notYet("history", 3);
  fileHistory = notYet("file history", 3);
  diff = notYet("diff", 3);
  listBranches = notYet("branch list", 3);
  switchBranch = notYet("branch switch", 3);
  createBranch = notYet("branch create", 3);
  // Phase 4
  lockAcquire = notYet("lock acquire", 4);
  lockRelease = notYet("lock release", 4);
  lockQuery = notYet("lock query", 4);
  getView = notYet("view", 4);
  applyView = notYet("view apply", 4);

  async dispose(): Promise<void> {
    await this.queue.catch(() => undefined);
    this.sdk.lore.shutdown();
  }
}
