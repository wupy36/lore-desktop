// Lore-free DTOs shared by main, preload and renderer. No Lore SDK types here:
// the SDK adapter maps its events into these shapes (src/main/lore/mappers.ts).
import { z } from "zod";

/** Change kind recorded on a working-tree node. Lore's own enum is KEEP/ADD/DELETE/MOVE/COPY;
 * "modify" is KEEP + dirty (or staged) and is derived by the mapper. */
export const FileAction = z.enum(["none", "add", "modify", "delete", "move", "copy"]);
export type FileAction = z.infer<typeof FileAction>;

/** Display state for the file table (derived, see deriveFileState). */
export const FileState = z.enum(["synced", "modified", "staged", "added", "deleted", "untracked", "conflict"]);
export type FileState = z.infer<typeof FileState>;

export const FileEntry = z.object({
  path: z.string(), // repo-relative, forward slashes
  size: z.number().nonnegative(),
  action: FileAction,
  staged: z.boolean(),
  dirty: z.boolean(),
  conflict: z.boolean(),
  fromPath: z.string().nullable(),
  lastRevision: z.number().int().nullable(), // revision number on current branch, when known
  lockOwner: z.string().nullable(),
  binary: z.boolean(),
});
export type FileEntry = z.infer<typeof FileEntry>;

export const RepoInfo = z.object({
  path: z.string(),
  name: z.string(),
  remoteUrl: z.string().nullable(),
  repositoryId: z.string(),
  instanceId: z.string(),
  branch: z.string(),
  revision: z.number().int().nullable(),
  revisionHash: z.string().nullable(),
  /** Local commits not yet pushed to the remote branch. */
  aheadBy: z.number().int().nonnegative(),
  /** Remote revisions not yet synced (remote latest − local latest when the remote is ahead). */
  behindBy: z.number().int().nonnegative().default(0),
  /** A merge (e.g. from sync) is in progress and must be committed or aborted. */
  mergePending: z.boolean().default(false),
  offline: z.boolean(),
});
export type RepoInfo = z.infer<typeof RepoInfo>;

export const RemoteRepo = z.object({ name: z.string(), id: z.string(), url: z.string(), description: z.string() });
export type RemoteRepo = z.infer<typeof RemoteRepo>;

export const Instance = z.object({ path: z.string(), instanceId: z.string(), repositoryName: z.string() });
export type Instance = z.infer<typeof Instance>;

export const Branch = z.object({
  name: z.string(),
  id: z.string(),
  latest: z.number().int().nullable(),
  /** Latest revision hash (local view); null when unknown. */
  latestHash: z.string().nullable().default(null),
  current: z.boolean(),
  /** null = unknown (Lore's branch list does not report protection). */
  protected: z.boolean().nullable(),
  archived: z.boolean(),
  /** Where the branch exists: only local (never pushed), only on the remote, or both. */
  where: z.enum(["local", "remote", "both"]).default("both"),
  creator: z.string().nullable().default(null),
});
export type Branch = z.infer<typeof Branch>;

export const Revision = z.object({
  number: z.number().int(),
  hash: z.string(),
  branch: z.string(),
  author: z.string().nullable(), // unauthenticated servers record no author
  timestamp: z.number(), // epoch ms
  message: z.string(),
  parents: z.array(z.string()),
});
export type Revision = z.infer<typeof Revision>;

/** A revision in the history graph: also flags local-only (unpushed) revisions and the checked-out one. */
export const GraphRevision = Revision.extend({ pending: z.boolean(), isHead: z.boolean() });
export type GraphRevision = z.infer<typeof GraphRevision>;

export const FileRevision = Revision.extend({ path: z.string(), action: FileAction, size: z.number(), fileHash: z.string() });
export type FileRevision = z.infer<typeof FileRevision>;

export const BlobMeta = z.object({ revision: z.string(), size: z.number(), hash: z.string() });
export type BlobMeta = z.infer<typeof BlobMeta>;

export const DiffResult = z.object({
  path: z.string(),
  binary: z.boolean(),
  /** Unified diff text (text files only). */
  unified: z.string().nullable(),
  source: BlobMeta.nullable(),
  target: BlobMeta.nullable(),
});
export type DiffResult = z.infer<typeof DiffResult>;

/** Locks are advisory in Lore. On a server without authentication every lock's owner is
 * reported as "<unknown>" and anyone can release it (verified against loreserver 0.12). */
export const UNKNOWN_OWNER = "<unknown>";
export const Lock = z.object({ path: z.string(), owner: z.string(), branch: z.string(), acquiredAt: z.number() });
export type Lock = z.infer<typeof Lock>;
export const LockResult = z.object({ acquired: z.array(z.string()), alreadyLocked: z.array(z.string()) });
export type LockResult = z.infer<typeof LockResult>;
export const ReleaseResult = z.object({ released: z.array(z.string()), notFound: z.boolean() });
export type ReleaseResult = z.infer<typeof ReleaseResult>;

/** One dependency edge as seen from the queried file (depth 0 = direct). */
export const DependencyEntry = z.object({ path: z.string(), tags: z.array(z.string()), depth: z.number().int() });
export type DependencyEntry = z.infer<typeof DependencyEntry>;

/** What applying a view would do to the working tree (dry-run sync). */
export const ViewPreview = z.object({
  materialize: z.array(z.object({ path: z.string(), size: z.number() })),
  remove: z.array(z.object({ path: z.string(), size: z.number() })),
});
export type ViewPreview = z.infer<typeof ViewPreview>;

export const AuthInfo = z.object({
  remote: z.string().nullable(),
  /** Identity recorded on commits (preference override, else .lore/config.toml `identity`). */
  identity: z.string().nullable(),
  identitySource: z.enum(["preference", "repository", "none"]).default("none"),
  /** Server has an auth endpoint (false for e.g. the demo server). */
  authSupported: z.boolean().default(false),
  loggedIn: z.boolean(),
  user: z.object({ id: z.string(), name: z.string() }).nullable().default(null),
  /** Human-readable status when the server can't be asked. */
  note: z.string().nullable().default(null),
});
export type AuthInfo = z.infer<typeof AuthInfo>;

export const StatusResult = z.object({
  branch: z.string(),
  revision: z.number().int().nullable(),
  files: z.array(FileEntry),
  scanned: z.boolean(),
});
export type StatusResult = z.infer<typeof StatusResult>;

// ---- event bus payloads (main -> renderer) ----

export const LogLevel = z.enum(["debug", "info", "warn", "error"]);
export type LogLevel = z.infer<typeof LogLevel>;

export const LogEntry = z.object({
  id: z.number().int(),
  ts: z.number(),
  level: LogLevel,
  backend: z.enum(["sdk", "cli", "mock"]),
  op: z.string(),
  /** Equivalent `lore …` command line, for copy/paste into a terminal. */
  command: z.string().nullable(),
  args: z.unknown(),
  durationMs: z.number().nullable(),
  ok: z.boolean().nullable(),
  message: z.string(),
});
export type LogEntry = z.infer<typeof LogEntry>;

export const TransferState = z.enum(["queued", "running", "done", "error", "cancelled"]);
export type TransferState = z.infer<typeof TransferState>;

export const Transfer = z.object({
  id: z.string(),
  op: z.string(),
  label: z.string(),
  state: TransferState,
  current: z.number(),
  total: z.number().nullable(),
  unit: z.enum(["files", "bytes", "fragments", "items"]),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  error: z.string().nullable(),
  cancellable: z.boolean(),
});
export type Transfer = z.infer<typeof Transfer>;

/** Derive a single display state from Lore's orthogonal staged/dirty flags + action. */
export function deriveFileState(f: Pick<FileEntry, "action" | "staged" | "dirty" | "conflict">): FileState {
  if (f.conflict) return "conflict";
  if (f.staged) {
    if (f.action === "add" || f.action === "copy") return "added";
    if (f.action === "delete") return "deleted";
    return "staged";
  }
  if (f.action === "add" || f.action === "copy") return "untracked";
  if (f.action === "delete") return "deleted";
  if (f.dirty || f.action !== "none") return "modified";
  return "synced";
}

export type ChangeGroup = "staged" | "unstaged" | "untracked";

/** Changes-tab grouping. Returns null for files with no local change. */
export function changeGroup(f: FileEntry): ChangeGroup | null {
  if (f.staged) return "staged";
  if (f.action === "add" || f.action === "copy") return "untracked";
  if (f.dirty || f.action !== "none") return "unstaged";
  return null;
}

export function fileName(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? path : path.slice(i + 1);
}

export function fileExt(path: string): string {
  const n = fileName(path);
  const i = n.lastIndexOf(".");
  return i <= 0 ? "" : n.slice(i + 1).toLowerCase();
}

/** Heuristic only (no Lore API marks binary-ness); used to pick inline vs external diff. */
export const BINARY_EXTS: ReadonlySet<string> = new Set(["uasset", "umap", "png", "wav", "fbx", "bin", "ubulk", "uexp", "dll", "exe", "psd", "tga", "jpg"]);
export const isBinaryPath = (path: string): boolean => BINARY_EXTS.has(fileExt(path));

// ---- preferences (persisted in userData/settings.json) ----

export const Prefs = z.object({
  theme: z.enum(["dark", "light", "system"]).default("dark"),
  fontSize: z.number().int().min(11).max(16).default(13),
  density: z.enum(["compact", "comfortable"]).default("compact"),
  /** Command line for binary/any-file diffs. Placeholders: {base} {local} {path}. Empty = not configured. */
  externalDiffTool: z.string().max(2000).default(""),
  reopenLastRepo: z.boolean().default(true),
  /** Watch the working tree and refresh automatically (`lore dirty` + `status --check-dirty`). */
  autoRefresh: z.boolean().default(true),
  confirmReset: z.boolean().default(true),
  /** Toolbar Sync discards local modifications to files the incoming revision changes (`sync --reset`). */
  syncDiscardLocal: z.boolean().default(false),
  /** Commit identity override passed to every Lore call (`--identity`). Empty = use .lore/config.toml. */
  identity: z.string().max(320).default(""),
  /** Override for the Lore native library (LORE_LIB_PATH). Applies on next start. */
  loreLibPath: z.string().max(2000).default(""),
});
export type Prefs = z.infer<typeof Prefs>;
export const defaultPrefs = (): Prefs => Prefs.parse({});

export const MaintenanceOp = z.enum(["verify", "gc", "flush", "prune", "updatePath"]);

export const RevisionDetail = Revision.extend({
  files: z.array(z.object({ path: z.string(), action: z.enum(["none", "add", "modify", "delete", "move", "copy"]), size: z.number(), fromPath: z.string().nullable() })),
  metadata: z.record(z.string(), z.string()),
});
export type RevisionDetail = z.infer<typeof RevisionDetail>;

export const BranchAction = z.enum(["protect", "unprotect", "archive"]);
export type BranchAction = z.infer<typeof BranchAction>;
export type MaintenanceOp = z.infer<typeof MaintenanceOp>;

export const AboutInfo = z.object({
  app: z.string(),
  version: z.string(),
  backend: z.enum(["sdk", "cli", "mock"]),
  sdkVersion: z.string().nullable(),
  electron: z.string(),
  chrome: z.string(),
  node: z.string(),
  platform: z.string(),
  arch: z.string(),
  userData: z.string(),
  licenses: z.array(z.object({ id: z.string(), title: z.string(), external: z.boolean() })),
});
export type AboutInfo = z.infer<typeof AboutInfo>;
