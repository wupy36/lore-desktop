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
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import type * as Sdk from "@lore-vcs/sdk";
import type * as SdkEnums from "@lore-vcs/sdk/types/enums";
import type { LoreGlobalArgs } from "@lore-vcs/sdk/types/args";
import type { LoreEventFFI } from "@lore-vcs/sdk/types/events";
import {
  isBinaryPath,
  type AuthInfo,
  type Branch,
  type BranchAction,
  type DiffResult,
  type FileEntry,
  type DependencyEntry,
  type FileRevision,
  type GraphRevision,
  type Lock,
  type LockResult,
  type ReleaseResult,
  type ViewPreview,
  type Instance,
  type MaintenanceOp,
  type RemoteRepo,
  type RepoInfo,
  type Revision,
  type RevisionDetail,
  type StatusResult,
} from "@shared/types";
import { LoreError, type CloneOptions, type LoreBackend, type OpContext, type StatusOptions, type SyncOptions } from "./LoreBackend";
import {
  mapAction,
  mapCloneProgress,
  metaValue,
  revisionFromMeta,
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

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const TREE_CONCURRENCY = 8;
/** Inline diffs above this are shown as binary/metadata (use the external diff tool). */
const MAX_PATCH_CHARS = 2_000_000;

export class SdkBackend implements LoreBackend {
  readonly kind = "sdk" as const;
  readonly canCancel = false;
  private repo: RepoInfo | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  /** Committed tree listing, keyed by revision hash (a revision is immutable). */
  private treeCache: { hash: string; files: TreeFile[] } | null = null;
  /** Branch id → name, for history entries (metadata carries the branch id). */
  private branchNames = new Map<string, string>();
  private identity: string | null = null;

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
    return { repositoryPath: path, workingDirectory: path, ...(this.identity ? { identity: this.identity } : {}) };
  }

  setIdentity(identity: string | null): void {
    this.identity = identity?.trim() || null;
  }

  /** Hash for a revision identifier. Lore accepts `[branch]@<n>`, `[branch]@LATEST`, full hashes. */
  private zeroHash = (h: string) => /^0*$/.test(h);

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
      behindBy: r?.behindBy ?? 0,
      mergePending: r?.mergePending ?? false,
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
        case "updatePath":
          await this.run(l.repositoryUpdatePath(g, {}));
          return `Stored path updated to ${g.repositoryPath}`;
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
      const merged = mergeTreeAndStatus(tree, changed);
      // Lock owner column: one query for the current branch (locks are few; files are many).
      const locks = await this.lockQueryRaw({ branch: repo.branch }).catch(() => [] as Lock[]);
      if (locks.length) {
        const owner = new Map(locks.map((l) => [l.path, l.owner]));
        for (const f of merged) f.lockOwner = owner.get(f.path) ?? null;
      }
      return merged;
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
          ...(o.dependencyRecursive ? { dependencyRecursive: true } : {}),
          ...(o.dependencyTags?.length ? { dependencyTags: o.dependencyTags } : {}),
        }),
        (e) => {
          if (e.tag === LoreEventTag.REVISION_SYNC_PROGRESS) ctx.progress(mapSyncProgress(e.data));
        },
        ctx.signal,
      );
      await this.refreshRepo(repo.path);
    });
  }

  // ---- history & diff (Phase 3) ----

  /** History events arrive as an entry followed by METADATA events for that entry. */
  history(o: { branch?: string; length: number }): Promise<Revision[]> {
    return this.serial(() => this.historyRaw(o));
  }

  /** Union of per-branch histories (each continues into its parent branch, so overlaps dedupe). */
  graph(o: { scope: "current" | "all"; length: number }): Promise<GraphRevision[]> {
    return this.serial(async () => {
      const repo = this.requireRepo();
      const branches = await this.branchesRaw();
      const targets = o.scope === "all" ? branches.filter((b) => !b.archived) : branches.filter((b) => b.name === repo.branch);
      const byHash = new Map<string, Revision>();
      for (const b of targets.length ? targets : [{ name: repo.branch }]) {
        const revs = await this.historyRaw({ branch: b.name, length: o.length }).catch(() => [] as Revision[]);
        for (const r of revs) if (!byHash.has(r.hash)) byHash.set(r.hash, r);
      }
      const localOnly = new Set(branches.filter((b) => b.where === "local").map((b) => b.name));
      // Unpushed on the current branch: the newest `aheadBy` revision numbers.
      const firstUnpushed = repo.revision !== null && repo.aheadBy > 0 ? repo.revision - repo.aheadBy + 1 : Infinity;
      return [...byHash.values()]
        .map((r) => ({
          ...r,
          isHead: r.hash === repo.revisionHash,
          pending: localOnly.has(r.branch) || (r.branch === repo.branch && r.number >= firstUnpushed),
        }))
        .sort((a, b) => b.timestamp - a.timestamp || b.number - a.number);
    });
  }

  private async historyRaw(o: { branch?: string; length: number }): Promise<Revision[]> {
    {
      const { LoreEventTag } = this.enums;
      await this.ensureBranchNames();
      const out: { head: { number: number; hash: string; parents: string[] }; meta: Record<string, string> }[] = [];
      await this.run(this.sdk.lore.revisionHistory(this.globals(), { length: o.length, ...(o.branch ? { branch: o.branch } : {}) }), (e) => {
        if (e.tag === LoreEventTag.REVISION_HISTORY_ENTRY) {
          out.push({ head: { number: Number(e.data.revisionNumber), hash: e.data.revision.toString(), parents: e.data.parent.map((p) => p.toString()).filter((p) => !this.zeroHash(p)) }, meta: {} });
        } else if (e.tag === LoreEventTag.METADATA && out.length) {
          (out[out.length - 1] as (typeof out)[number]).meta[String(e.data.key)] = metaValue(e.data.value);
        }
      });
      return out.map(({ head, meta }) => revisionFromMeta(head, meta, this.branchNames));
    }
  }

  fileHistory(path: string, length: number): Promise<FileRevision[]> {
    return this.serial(async () => {
      const { LoreEventTag } = this.enums;
      await this.ensureBranchNames();
      const out: { rev: Omit<FileRevision, "author" | "timestamp" | "message" | "branch">; meta: Record<string, string> }[] = [];
      await this.run(this.sdk.lore.fileHistory(this.globals(), { path, length }), (e) => {
        if (e.tag === LoreEventTag.FILE_HISTORY) {
          const d = e.data;
          const from = String(d.fromPath ?? "");
          out.push({
            rev: {
              number: Number(d.revisionNumber),
              hash: d.revision.toString(),
              parents: d.parent.map((p) => p.toString()).filter((p) => !this.zeroHash(p)),
              path: String(d.path),
              action: mapAction(d.action, true),
              size: Number(d.size),
              fileHash: String(d.address?.hash ?? ""),
              ...(from ? {} : {}),
            },
            meta: {},
          });
        } else if (e.tag === LoreEventTag.METADATA && out.length) {
          (out[out.length - 1] as (typeof out)[number]).meta[String(e.data.key)] = metaValue(e.data.value);
        }
      });
      return out.map(({ rev, meta }) => ({ ...revisionFromMeta(rev, meta, this.branchNames), ...rev }));
    });
  }

  /** Text: unified patch from `file diff`. Binary (Lore emits no patch): size/hash from `file info` on both sides. */
  diff(o: { path: string; source?: string; target?: string }): Promise<DiffResult> {
    return this.serial(async () => {
      const { LoreEventTag } = this.enums;
      const repo = this.requireRepo();
      let patch: string | null = null;
      let tooLarge = false;
      // Lore diffs anything as text (a .uasset without NUL bytes yields a huge patch), so known
      // binary types never ask for a patch; others are capped.
      if (!isBinaryPath(o.path)) {
        await this.run(
          this.sdk.lore.fileDiff(this.globals(), { paths: [o.path], ...(o.source ? { sourceRevision: o.source } : {}), ...(o.target ? { targetRevision: o.target } : {}), contextLines: 3 }),
          (e) => {
            if (e.tag !== LoreEventTag.FILE_DIFF) return;
            const text = String(e.data.patch);
            if (text.length > MAX_PATCH_CHARS || text.includes("\u0000")) tooLarge = true;
            else patch = text;
          },
        );
      }
      const info = async (revision: string | undefined, local: boolean) => {
        let meta: { revision: string; size: number; hash: string } | null = null;
        await this.run(this.sdk.lore.fileInfo(this.globals(), { paths: [o.path], ...(revision ? { revision } : {}), local }), (e) => {
          if (e.tag !== LoreEventTag.FILE_INFO) return;
          const d = e.data;
          meta = local
            ? { revision: "working tree", size: Number(d.localSize), hash: d.localHash.toString() }
            : { revision: revision ?? repo.revisionHash ?? "", size: Number(d.size), hash: d.hash.toString() };
        }).catch(() => undefined);
        return meta as { revision: string; size: number; hash: string } | null;
      };
      const source = await info(o.source, false);
      const target = o.target ? await info(o.target, false) : await info(undefined, true);
      const p = patch as string | null;
      const binary = isBinaryPath(o.path) || tooLarge || (p === null && !!source && !!target && source.hash !== target.hash);
      return { path: o.path, binary, unified: binary ? null : (p ?? ""), source, target };
    });
  }

  revisionDetail(revision: string): Promise<RevisionDetail> {
    return this.serial(async () => {
      const { LoreEventTag } = this.enums;
      await this.ensureBranchNames();
      let head: { number: number; hash: string; parents: string[] } | null = null;
      const meta: Record<string, string> = {};
      const files: RevisionDetail["files"] = [];
      await this.run(this.sdk.lore.revisionInfo(this.globals(), { revision, metadata: true, delta: true }), (e) => {
        if (e.tag === LoreEventTag.REVISION_INFO) head = { number: Number(e.data.revisionNumber), hash: e.data.revision.toString(), parents: e.data.parent.map((p) => p.toString()).filter((p) => !this.zeroHash(p)) };
        else if (e.tag === LoreEventTag.METADATA) meta[String(e.data.key)] = metaValue(e.data.value);
        else if (e.tag === LoreEventTag.REVISION_INFO_DELTA && e.data.flagFile) {
          const from = String(e.data.fromPath ?? "");
          files.push({ path: String(e.data.path), action: mapAction(e.data.action, !!e.data.flagModify || true), size: Number(e.data.size), fromPath: from || null });
        }
      });
      const h = head as { number: number; hash: string; parents: string[] } | null;
      if (!h) throw new LoreError(`Revision not found: ${revision}`);
      return { ...revisionFromMeta(h, meta, this.branchNames), files, metadata: meta };
    });
  }

  /** Amending rewrites the latest revision (new hash), so the repo state is re-read. */
  amend(message: string): Promise<void> {
    return this.serial(async () => {
      const repo = this.requireRepo();
      await this.run(this.sdk.lore.revisionAmend(this.globals(), { message }));
      await this.refreshRepo(repo.path);
    });
  }

  // ---- branches (Phase 3) ----

  private async branchesRaw(): Promise<Branch[]> {
    const { LoreEventTag } = this.enums;
    const byId = new Map<string, Branch & { locs: Set<number> }>();
    await this.run(this.sdk.lore.branchList(this.globals(), {}), (e) => {
      if (e.tag !== LoreEventTag.BRANCH_LIST_ENTRY) return;
      const d = e.data;
      const id = d.id.toString();
      const loc = Number(d.location);
      const prev = byId.get(id);
      const latest = d.latest.toString();
      const creator = String(d.creator ?? "");
      const entry = prev ?? { name: String(d.name), id, latest: null, latestHash: null, current: false, protected: null, archived: false, where: "both" as const, creator: null, locs: new Set<number>() };
      entry.locs.add(loc);
      // Prefer the local view of "latest" (location 0); remote only when the branch isn't local.
      if (loc === 0 || !entry.latestHash) entry.latestHash = this.zeroHash(latest) ? null : latest;
      entry.current ||= !!d.isCurrent;
      entry.archived ||= !!d.archived;
      if (creator && creator !== "<unknown>") entry.creator = creator;
      byId.set(id, entry);
    });
    this.branchNames = new Map([...byId.values()].map((b) => [b.id, b.name]));
    return [...byId.values()].map(({ locs, ...b }) => ({ ...b, where: locs.has(0) && locs.has(1) ? "both" : locs.has(0) ? "local" : "remote" }));
  }

  private async ensureBranchNames(): Promise<void> {
    if (!this.branchNames.size) await this.branchesRaw().catch(() => undefined);
  }

  listBranches(): Promise<Branch[]> {
    return this.serial(async () => {
      const repo = this.requireRepo();
      const list = await this.branchesRaw();
      // Revision number is known for the current branch (status); others show their hash.
      return list.map((b) => (b.current ? { ...b, latest: repo.revision } : b)).sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name));
    });
  }

  switchBranch(name: string, o: { reset?: boolean }, ctx: OpContext): Promise<void> {
    return this.serial(async () => {
      const repo = this.requireRepo();
      ctx.progress({ current: 0, total: null, unit: "files", label: `Switch to ${name}` });
      await this.run(this.sdk.lore.branchSwitch(this.globals(), { branch: name, reset: !!o.reset }), undefined, ctx.signal);
      await this.refreshRepo(repo.path);
    });
  }

  createBranch(name: string): Promise<Branch> {
    return this.serial(async () => {
      const repo = this.requireRepo();
      await this.run(this.sdk.lore.branchCreate(this.globals(), { branch: name }));
      await this.refreshRepo(repo.path);
      const b = (await this.branchesRaw()).find((x) => x.name === name);
      if (!b) throw new LoreError(`Branch ${name} was created but is not listed`);
      return { ...b, latest: b.current ? (this.repo?.revision ?? null) : null };
    });
  }

  branchAction(name: string, action: BranchAction): Promise<void> {
    const l = this.sdk.lore;
    return this.serial(() =>
      this.run(action === "protect" ? l.branchProtect(this.globals(), { branch: name }) : action === "unprotect" ? l.branchUnprotect(this.globals(), { branch: name }) : l.branchArchive(this.globals(), { branch: name })),
    );
  }

  // ---- account (step B) ----

  /** Lore error 9 = "Operation not supported: authentication requires a configured auth endpoint". */
  private static NO_AUTH = 9;

  authInfo(): Promise<AuthInfo> {
    return this.serial(() => this.authInfoRaw());
  }

  private async authInfoRaw(): Promise<AuthInfo> {
    const { LoreEventTag } = this.enums;
    const repo = this.requireRepo();
    const configured = (await this.configGet(repo.path, "identity"))?.trim() || null;
    const identity = this.identity ?? configured;
    const base: AuthInfo = {
      remote: repo.remoteUrl,
      identity,
      identitySource: this.identity ? "preference" : configured ? "repository" : "none",
      authSupported: false,
      loggedIn: false,
      user: null,
      note: null,
    };
    if (!repo.remoteUrl) return { ...base, note: "Local-only repository: no server to sign in to." };
    let user: { id: string; name: string } | null = null;
    try {
      await this.run(this.sdk.lore.authUserInfo(this.globals(), {}), (e) => {
        if (e.tag === LoreEventTag.AUTH_USER_INFO) user = { id: String(e.data.id), name: String(e.data.name) };
      });
    } catch (e) {
      const code = (e as { code?: number; returnCode?: number }).code ?? (e as { returnCode?: number }).returnCode;
      if (code === SdkBackend.NO_AUTH) return { ...base, note: "This server has no authentication configured (e.g. the demo server). Commits record the identity above." };
      return { ...base, authSupported: true, note: `Not signed in (${e instanceof Error ? e.message.split("\n")[0] : String(e)})` };
    }
    const u = user as { id: string; name: string } | null;
    return { ...base, authSupported: true, loggedIn: !!u, user: u };
  }

  authLogin(onPrompt: (p: { url: string; code: string }) => void): Promise<AuthInfo> {
    return this.serial(async () => {
      const { LoreEventTag } = this.enums;
      const repo = this.requireRepo();
      const remoteRoot = repo.remoteUrl?.replace(/\/[^/]+\/?$/, "");
      if (!remoteRoot) throw new LoreError("Local-only repository: there is no server to sign in to");
      await this.run(this.sdk.lore.authLoginInteractive(this.globals(), { remoteUrl: remoteRoot, noBrowser: true }), (e) => {
        if (e.tag === LoreEventTag.AUTH_URL) onPrompt({ url: String(e.data.url), code: String(e.data.userCode) });
      });
      return this.authInfoRaw();
    });
  }

  authLogout(): Promise<AuthInfo> {
    return this.serial(async () => {
      await this.run(this.sdk.lore.authLogout(this.globals(), {}));
      return this.authInfoRaw();
    });
  }

  // ---- locks (Phase 4; advisory in Lore) ----

  lockAcquire(paths: string[]): Promise<LockResult> {
    return this.serial(async () => {
      const { LoreEventTag } = this.enums;
      const acquired: string[] = [];
      let ignored = false;
      await this.run(this.sdk.lore.lockFileAcquire(this.globals(), { paths, branch: this.requireRepo().branch }), (e) => {
        if (e.tag === LoreEventTag.LOCK_FILE_ACQUIRE_BEGIN) ignored = !!e.data.ignored;
        else if (e.tag === LoreEventTag.LOCK_FILE_ACQUIRE) acquired.push(String(e.data.path));
      });
      // Lore flags the whole request `ignored` when the files were already locked.
      return ignored ? { acquired: [], alreadyLocked: acquired.length ? acquired : paths } : { acquired, alreadyLocked: paths.filter((p) => !acquired.includes(p)) };
    });
  }

  lockRelease(paths: string[], o: { owner?: string } = {}): Promise<ReleaseResult> {
    return this.serial(async () => {
      const { LoreEventTag } = this.enums;
      const released: string[] = [];
      let notFound = false;
      await this.run(this.sdk.lore.lockFileRelease(this.globals(), { paths, branch: this.requireRepo().branch, ...(o.owner ? { owner: o.owner } : {}) }), (e) => {
        if (e.tag === LoreEventTag.LOCK_FILE_RELEASE_BEGIN) notFound = !!e.data.notFound;
        else if (e.tag === LoreEventTag.LOCK_FILE_RELEASE) released.push(String(e.data.path));
      });
      return { released, notFound };
    });
  }

  lockStatus(paths: string[]): Promise<Lock[]> {
    return this.serial(async () => {
      const { LoreEventTag } = this.enums;
      const branch = this.requireRepo().branch;
      const out: Lock[] = [];
      await this.run(this.sdk.lore.lockFileStatus(this.globals(), { paths, branch }), (e) => {
        if (e.tag === LoreEventTag.LOCK_FILE_STATUS) out.push({ path: String(e.data.path), owner: String(e.data.owner), branch, acquiredAt: Number(e.data.lockedAt) });
      });
      return out;
    });
  }

  lockQuery(q: { branch?: string; owner?: string; path?: string }): Promise<Lock[]> {
    return this.serial(() => this.lockQueryRaw(q));
  }

  private async lockQueryRaw(q: { branch?: string; owner?: string; path?: string }): Promise<Lock[]> {
    const { LoreEventTag } = this.enums;
    await this.ensureBranchNames();
    const out: Lock[] = [];
    await this.run(this.sdk.lore.lockFileQuery(this.globals(), { ...(q.branch ? { branch: q.branch } : {}), ...(q.owner ? { owner: q.owner } : {}), ...(q.path ? { path: q.path } : {}) }), (e) => {
      if (e.tag !== LoreEventTag.LOCK_FILE_QUERY) return;
      const id = e.data.branch.toString();
      out.push({ path: String(e.data.path), owner: String(e.data.owner), branch: this.branchNames.get(id) ?? id, acquiredAt: Number(e.data.lockedAt) });
    });
    return out;
  }

  // ---- dependencies (Phase 4) ----

  dependencies(path: string, o: { reverse?: boolean; recursive?: boolean }): Promise<DependencyEntry[]> {
    return this.serial(async () => {
      const { LoreEventTag } = this.enums;
      const out: DependencyEntry[] = [];
      await this.run(this.sdk.lore.fileDependencyList(this.globals(), { paths: [path], reverse: !!o.reverse, recursive: !!o.recursive }), (e) => {
        if (e.tag === LoreEventTag.FILE_DEPENDENCY_LIST_ENTRY) out.push({ path: String(e.data.path), tags: e.data.tags.map(String), depth: Number(e.data.depth) });
      });
      return out;
    });
  }

  /** Flat parallel arrays: depCounts per source, tagCounts per dependency. */
  dependencyAdd(path: string, dependencies: string[], tags: string[] = []): Promise<void> {
    return this.serial(() =>
      this.run(
        this.sdk.lore.fileDependencyAdd(this.globals(), {
          paths: [path],
          dependencies,
          depCounts: [dependencies.length],
          tags: dependencies.flatMap(() => tags),
          tagCounts: dependencies.map(() => tags.length),
        }),
      ),
    );
  }

  dependencyRemove(path: string, dependencies: string[]): Promise<void> {
    return this.serial(() => this.run(this.sdk.lore.fileDependencyRemove(this.globals(), { paths: [path], dependencies, depCounts: [dependencies.length], tags: [], tagCounts: dependencies.map(() => 0) })));
  }

  // ---- views (Phase 4) ----

  /** The instance's view filter (`.lore/view`): gitignore-style, lines exclude, `!` re-includes. */
  getView(): Promise<string[]> {
    return this.serial(async () => {
      const text = await readFile(join(this.requireRepo().path, ".lore", "view"), "utf8").catch(() => "");
      return text.split(/\r?\n/).filter((l, i, a) => l !== "" || i < a.length - 1);
    });
  }

  private async withViewFile<T>(rules: string[], fn: (file: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), "lore-desktop-view-"));
    const file = join(dir, "view");
    // An empty view file means "no view" to some readers; a comment keeps it explicit.
    await writeFile(file, rules.length ? `${rules.join("\n")}\n` : "# full tree\n");
    try {
      return await fn(file);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  previewView(rules: string[]): Promise<ViewPreview> {
    return this.serial(() =>
      this.withViewFile(rules, async (file) => {
        const { LoreEventTag } = this.enums;
        const out: ViewPreview = { materialize: [], remove: [] };
        await this.run(this.sdk.lore.revisionSync({ ...this.globals(), dryRun: true }, { view: file }), (e) => {
          if (e.tag !== LoreEventTag.REVISION_SYNC_FILE || !e.data.flagFile) return;
          const item = { path: String(e.data.path), size: Number(e.data.size) };
          if (mapAction(e.data.action, true) === "delete") out.remove.push(item);
          else out.materialize.push(item);
        });
        return out;
      }),
    );
  }

  applyView(rules: string[], ctx: OpContext): Promise<void> {
    return this.serial(() =>
      this.withViewFile(rules, async (file) => {
        const { LoreEventTag } = this.enums;
        const repo = this.requireRepo();
        await this.run(
          this.sdk.lore.revisionSync(this.globals(), { view: file }),
          (e) => {
            if (e.tag === LoreEventTag.REVISION_SYNC_PROGRESS) ctx.progress(mapSyncProgress(e.data));
          },
          ctx.signal,
        );
        await this.refreshRepo(repo.path);
      }),
    );
  }

  async dispose(): Promise<void> {
    await this.queue.catch(() => undefined);
    this.sdk.lore.shutdown();
  }
}
