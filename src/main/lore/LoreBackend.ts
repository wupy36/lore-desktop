// The single seam between the app and Lore. Lore is pre-1.0; when its API
// changes, only implementations of this interface change.
import type {
  AuthInfo,
  Branch,
  DiffResult,
  FileEntry,
  FileRevision,
  GraphRevision,
  Instance,
  DependencyEntry,
  Lock,
  LockResult,
  ReleaseResult,
  ViewPreview,
  RemoteRepo,
  RepoInfo,
  Revision,
  BranchAction,
  MaintenanceOp,
  RevisionDetail,
  StatusResult,
} from "@shared/types";

export type BackendKind = "sdk" | "cli" | "mock";

export interface Progress {
  current: number;
  total: number | null;
  unit: "files" | "bytes" | "fragments" | "items";
  label?: string;
}

/** Per-call context. `signal` aborts the op where the backend can (CLI: kill
 * the child; SDK: Lore's C API has no per-call cancel, so the result is
 * dropped). `progress` feeds the transfer queue. */
export interface OpContext {
  signal: AbortSignal;
  progress(p: Progress): void;
}

export interface StatusOptions {
  /** Walk the filesystem and reconcile dirty flags (`status --scan`). */
  scan?: boolean;
  /** Re-verify already-dirty files only (`status --check-dirty`). */
  checkDirty?: boolean;
  paths?: string[];
}

export interface SyncOptions {
  revision?: string; // revision identifier, e.g. `main@LATEST`
  reset?: boolean;
  viewFile?: string;
  /** Dependency-based selective sync (`--root-file`): only these files and their dependencies. */
  rootFiles?: string[];
  dependencyRecursive?: boolean;
  dependencyTags?: string[];
}

export interface CloneOptions {
  url: string;
  path: string;
  branch?: string;
  viewFile?: string;
}

export interface LoreBackend {
  readonly kind: BackendKind;
  /** Whether a long op actually stops when its AbortSignal fires. Lore's C API has
   * no per-call cancel, so the SDK backend reports false and the UI hides Cancel. */
  readonly canCancel: boolean;

  openRepository(path: string): Promise<RepoInfo>;
  currentRepository(): RepoInfo | null;
  cloneRepository(opts: CloneOptions, ctx: OpContext): Promise<RepoInfo>;
  /** `lore repository create`. No remote → local-only repository named `name` (`--offline`). */
  createRepository(o: { path: string; name: string; remoteUrl?: string }): Promise<RepoInfo>;
  /** Manage menu ops. Resolves to a one-line human summary. */
  maintenance(op: MaintenanceOp, ctx: OpContext): Promise<string>;
  /** Write `path` as of `revision` (default: the current revision) to `outPath` (`lore file write`). */
  exportFile(path: string, revision: string | undefined, outPath: string): Promise<void>;
  listInstances(): Promise<Instance[]>;
  listRemoteRepositories(remoteUrl: string): Promise<RemoteRepo[]>;

  status(opts: StatusOptions, ctx?: OpContext): Promise<StatusResult>;
  /** All files in the working tree (synced + changed), for the file table. */
  listFiles(): Promise<FileEntry[]>;
  stage(paths: string[], ctx?: OpContext): Promise<void>;
  unstage(paths: string[]): Promise<void>;
  reset(paths: string[], opts?: { purge?: boolean }): Promise<void>;
  /** Tell Lore these paths changed on disk (`lore dirty`). Fed by the FS watcher. */
  markDirty(paths: string[]): Promise<void>;

  commit(message: string, ctx?: OpContext): Promise<Revision>;
  push(branch: string | undefined, ctx: OpContext): Promise<void>;
  sync(opts: SyncOptions, ctx: OpContext): Promise<void>;
  history(opts: { branch?: string; length: number }): Promise<Revision[]>;
  /** History of the current (or every non-archived) branch, merged and deduplicated, newest first. */
  graph(opts: { scope: "current" | "all"; length: number }): Promise<GraphRevision[]>;
  fileHistory(path: string, length: number): Promise<FileRevision[]>;
  diff(opts: { path: string; source?: string; target?: string }): Promise<DiffResult>;
  /** Revision header, metadata and changed files (`lore revision info --metadata --delta`). */
  revisionDetail(revision: string): Promise<RevisionDetail>;
  /** Change the latest commit's message (`lore revision amend`). */
  amend(message: string): Promise<void>;

  listBranches(): Promise<Branch[]>;
  switchBranch(name: string, opts: { reset?: boolean }, ctx: OpContext): Promise<void>;
  /** Creates the branch at the current revision AND switches to it (Lore semantics). */
  createBranch(name: string): Promise<Branch>;
  branchAction(name: string, action: BranchAction): Promise<void>;

  /** Paths already locked are reported, not failed (Lore reports them as `ignored`). */
  lockAcquire(paths: string[]): Promise<LockResult>;
  lockRelease(paths: string[], opts?: { owner?: string }): Promise<ReleaseResult>;
  lockStatus(paths: string[]): Promise<Lock[]>;
  lockQuery(q: { branch?: string; owner?: string; path?: string }): Promise<Lock[]>;

  dependencies(path: string, opts: { reverse?: boolean; recursive?: boolean }): Promise<DependencyEntry[]>;
  dependencyAdd(path: string, dependencies: string[], tags?: string[]): Promise<void>;
  dependencyRemove(path: string, dependencies: string[]): Promise<void>;

  authInfo(): Promise<AuthInfo>;
  /** Browser/device login against the repository's server; `onPrompt` receives the URL + code to show. */
  authLogin(onPrompt: (p: { url: string; code: string }) => void): Promise<AuthInfo>;
  authLogout(): Promise<AuthInfo>;
  /** Commit identity override (`--identity`) for subsequent calls; null = use the repository config. */
  setIdentity(identity: string | null): void;

  getView(): Promise<string[]>;
  /** Dry run of applying `rules` as the view. */
  previewView(rules: string[]): Promise<ViewPreview>;
  /** Write the view filter and re-materialize (`sync --view <file>`). */
  applyView(rules: string[], ctx: OpContext): Promise<void>;

  dispose(): Promise<void>;
}

export class LoreError extends Error {
  constructor(
    message: string,
    readonly code: number | null = null,
  ) {
    super(message);
    this.name = "LoreError";
  }
}

export class CancelledError extends Error {
  constructor() {
    super("Operation cancelled");
    this.name = "CancelledError";
  }
}

export const noopContext: OpContext = { signal: new AbortController().signal, progress: () => {} };
