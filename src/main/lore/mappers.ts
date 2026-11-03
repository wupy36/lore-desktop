// Lore SDK event payload -> app DTO. One of only two files allowed to import
// SDK types (see eslint.config.mjs). Must be called INSIDE the SDK callback:
// event data lives in native memory freed when the callback returns, so every
// field is copied into plain JS values here.
import { LoreFileAction, LoreNodeType, type LoreEventTag } from "@lore-vcs/sdk/types/enums";
import type { LoreEventFFI } from "@lore-vcs/sdk/types/events";

/** FFI payloads (hashes/ids are binary views with toString()). */
type FfiData<T extends LoreEventTag> = Extract<LoreEventFFI, { tag: T }>["data"];
type StatusFileData = FfiData<LoreEventTag.REPOSITORY_STATUS_FILE>;
type StatusRevisionData = FfiData<LoreEventTag.REPOSITORY_STATUS_REVISION>;
type SyncProgressData = FfiData<LoreEventTag.REVISION_SYNC_PROGRESS>;
type PushProgressData = FfiData<LoreEventTag.BRANCH_PUSH_FRAGMENT_PROGRESS>;
type CommitProgressData = FfiData<LoreEventTag.REVISION_COMMIT_PROGRESS>;
type CloneProgressData = FfiData<LoreEventTag.REPOSITORY_CLONE_PROGRESS>;
import { isBinaryPath, type FileAction, type FileEntry } from "@shared/types";
import type { Progress } from "./LoreBackend";

export function mapAction(a: LoreFileAction, dirtyOrStaged: boolean): FileAction {
  switch (a) {
    case LoreFileAction.ADD:
      return "add";
    case LoreFileAction.DELETE:
      return "delete";
    case LoreFileAction.MOVE:
      return "move";
    case LoreFileAction.COPY:
      return "copy";
    default:
      // KEEP with a dirty/staged flag is Lore's "modified".
      return dirtyOrStaged ? "modify" : "none";
  }
}

/** Returns null for directory/link nodes (the file table lists files only). */
export function mapStatusFile(d: StatusFileData): FileEntry | null {
  if (d.type !== LoreNodeType.FILE) return null;
  const staged = !!d.flagStaged;
  const dirty = !!d.flagDirty;
  const path = String(d.path);
  const from = String(d.fromPath ?? "");
  return {
    path,
    size: Number(d.size),
    action: mapAction(d.action, staged || dirty),
    staged,
    dirty,
    conflict: !!d.flagConflict && !!d.flagConflictUnresolved,
    fromPath: from.length ? from : null,
    lastRevision: null,
    lockOwner: null,
    binary: isBinaryPath(path),
  };
}

export interface StatusRevision {
  repositoryId: string;
  branch: string;
  revision: number;
  revisionHash: string;
  localRevision: number;
  remoteRevision: number;
  /** Local commits not on the remote branch yet. */
  aheadBy: number;
  remoteAvailable: boolean;
}

export function mapStatusRevision(d: StatusRevisionData): StatusRevision {
  const local = Number(d.revisionLocalNumber);
  const remote = Number(d.revisionRemoteNumber);
  const remoteAvailable = !!d.remoteAvailable;
  // Ahead count is only meaningful when the remote was reachable and the branch exists there;
  // a branch never pushed is "ahead" by all of its local revisions.
  const aheadBy = !d.isLocalAhead ? 0 : remoteAvailable && d.remoteBranchExist ? Math.max(1, local - remote) : Math.max(1, local);
  return {
    repositoryId: d.repository.toString(),
    branch: String(d.branchName),
    revision: Number(d.revisionNumber),
    revisionHash: d.revision.toString(),
    localRevision: local,
    remoteRevision: remote,
    aheadBy,
    remoteAvailable,
  };
}

const pct = (done: number, total: number): Pick<Progress, "current" | "total"> => ({ current: done, total: total > 0 ? total : null });

export function mapSyncProgress(d: SyncProgressData): Progress {
  const total = Number(d.fileUpdateTotal) + Number(d.fileDeleteTotal);
  // Until discovery completes the totals are still growing: report indeterminate.
  return { ...pct(Number(d.fileUpdate) + Number(d.fileDelete), d.discoveryComplete ? total : 0), unit: "files" };
}

export function mapPushProgress(d: PushProgressData): Progress {
  return { ...pct(Number(d.bytesTransferred), Number(d.bytesTotal)), unit: "bytes" };
}

export function mapCommitProgress(d: CommitProgressData): Progress {
  const c = d.count;
  return { ...pct(Number(c.fileCount), c.discoveryComplete ? Number(c.fileTotal) : 0), unit: "files" };
}

export function mapCloneProgress(d: CloneProgressData): Progress {
  const c = d.count;
  return { ...pct(Number(c.bytesTransferred), c.discoveryComplete ? Number(c.bytesTotal) : 0), unit: "bytes" };
}

export interface TreeFile {
  path: string;
  size: number;
}

/** Full file table = committed tree, overlaid with status entries (by path). Status-only paths
 * (adds, move/copy targets) are appended; a move's source path is dropped from the tree. */
export function mergeTreeAndStatus(tree: readonly TreeFile[], changed: readonly FileEntry[]): FileEntry[] {
  const byPath = new Map(changed.map((f) => [f.path, f]));
  const movedAway = new Set(changed.filter((f) => f.action === "move" && f.fromPath).map((f) => f.fromPath as string));
  const out: FileEntry[] = [];
  for (const t of tree) {
    if (movedAway.has(t.path)) continue;
    const c = byPath.get(t.path);
    if (c) {
      out.push(c);
      byPath.delete(t.path);
    } else {
      out.push({ path: t.path, size: t.size, action: "none", staged: false, dirty: false, conflict: false, fromPath: null, lastRevision: null, lockOwner: null, binary: isBinaryPath(t.path) });
    }
  }
  for (const c of byPath.values()) out.push(c);
  return out;
}
