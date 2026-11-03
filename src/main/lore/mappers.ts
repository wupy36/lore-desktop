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
import { isBinaryPath, type FileAction, type FileEntry } from "@shared/types";

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
  branch: string;
  revision: number;
  revisionHash: string;
  localRevision: number;
}

export function mapStatusRevision(d: StatusRevisionData): StatusRevision {
  return {
    branch: String(d.branchName),
    revision: Number(d.revisionNumber),
    revisionHash: d.revision.toString(),
    localRevision: Number(d.revisionLocalNumber),
  };
}
