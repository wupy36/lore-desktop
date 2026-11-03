import { describe, expect, it } from "vitest";
import { LoreFileAction, LoreNodeType } from "@lore-vcs/sdk/types/enums";
import { mapAction, mapStatusFile } from "../../src/main/lore/mappers";

type StatusFile = Parameters<typeof mapStatusFile>[0];
const ev = (p: Partial<Record<string, unknown>>) =>
  ({ path: "Content/A.uasset", size: 10, action: LoreFileAction.KEEP, type: LoreNodeType.FILE, flagStaged: 0, flagMerged: 0, flagConflict: 0, flagConflictUnresolved: 0, flagConflictAutomerged: 0, flagConflictMine: 0, flagConflictTheirs: 0, flagDirty: 1, fromPath: "", ...p }) as unknown as StatusFile;

describe("SDK mappers", () => {
  it("KEEP + dirty is modify; KEEP clean is none", () => {
    expect(mapAction(LoreFileAction.KEEP, true)).toBe("modify");
    expect(mapAction(LoreFileAction.KEEP, false)).toBe("none");
    expect(mapAction(LoreFileAction.ADD, true)).toBe("add");
    expect(mapAction(LoreFileAction.MOVE, true)).toBe("move");
  });
  it("maps a status file event to a plain DTO", () => {
    expect(mapStatusFile(ev({}))).toEqual({ path: "Content/A.uasset", size: 10, action: "modify", staged: false, dirty: true, conflict: false, fromPath: null, lastRevision: null, lockOwner: null, binary: true });
    expect(mapStatusFile(ev({ action: LoreFileAction.MOVE, fromPath: "Old/A.uasset", flagStaged: 1 }))).toMatchObject({ action: "move", staged: true, fromPath: "Old/A.uasset" });
  });
  it("drops directory nodes", () => {
    expect(mapStatusFile(ev({ type: LoreNodeType.DIRECTORY }))).toBeNull();
  });
  it("only unresolved conflicts count", () => {
    expect(mapStatusFile(ev({ flagConflict: 1, flagConflictUnresolved: 0 }))?.conflict).toBe(false);
    expect(mapStatusFile(ev({ flagConflict: 1, flagConflictUnresolved: 1 }))?.conflict).toBe(true);
  });
});

import { mapStatusRevision, mapSyncProgress, mergeTreeAndStatus } from "../../src/main/lore/mappers";
import type { FileEntry } from "@shared/types";

type Rev = Parameters<typeof mapStatusRevision>[0];
const revEv = (p: Record<string, unknown>) =>
  ({ repository: { toString: () => "r1" }, branchName: "main", revision: { toString: () => "ab" }, revisionNumber: 3, revisionLocalNumber: 3, revisionRemoteNumber: 3, isLocalAhead: 0, isRemoteAhead: 0, remoteAvailable: 1, remoteBranchExist: 1, revisionMerged: { toString: () => "0".repeat(64) }, ...p }) as unknown as Rev;

describe("status revision → ahead count", () => {
  it("in sync", () => expect(mapStatusRevision(revEv({})).aheadBy).toBe(0));
  it("two local commits", () => expect(mapStatusRevision(revEv({ revisionLocalNumber: 5, isLocalAhead: 1 })).aheadBy).toBe(2));
  it("branch never pushed", () => expect(mapStatusRevision(revEv({ revisionLocalNumber: 2, revisionRemoteNumber: 0, isLocalAhead: 1, remoteBranchExist: 0 })).aheadBy).toBe(2));
  it("offline", () => expect(mapStatusRevision(revEv({ remoteAvailable: 0 })).remoteAvailable).toBe(false));
  it("behind by remote revisions", () => expect(mapStatusRevision(revEv({ revisionRemoteNumber: 6, isRemoteAhead: 1 })).behindBy).toBe(3));
  it("not behind when the remote is unreachable", () => expect(mapStatusRevision(revEv({ revisionRemoteNumber: 6, isRemoteAhead: 1, remoteAvailable: 0 })).behindBy).toBe(0));
  it("merge pending", () => expect(mapStatusRevision(revEv({ revisionMerged: { toString: () => "ab".repeat(32) } })).mergePending).toBe(true));
});

describe("progress", () => {
  it("sync is indeterminate until discovery completes", () => {
    type P = Parameters<typeof mapSyncProgress>[0];
    expect(mapSyncProgress({ fileUpdate: 3, fileUpdateTotal: 10, fileDelete: 0, fileDeleteTotal: 0, discoveryComplete: 0 } as unknown as P)).toMatchObject({ current: 3, total: null });
    expect(mapSyncProgress({ fileUpdate: 3, fileUpdateTotal: 10, fileDelete: 1, fileDeleteTotal: 2, discoveryComplete: 1 } as unknown as P)).toMatchObject({ current: 4, total: 12 });
  });
});

describe("mergeTreeAndStatus", () => {
  const f = (p: Partial<FileEntry>): FileEntry => ({ path: "x", size: 1, action: "none", staged: false, dirty: false, conflict: false, fromPath: null, lastRevision: null, lockOwner: null, binary: false, ...p });
  it("overlays status on the committed tree", () => {
    const out = mergeTreeAndStatus(
      [{ path: "a.txt", size: 5 }, { path: "old.txt", size: 2 }, { path: "gone.txt", size: 3 }],
      [f({ path: "new.txt", action: "add", dirty: true }), f({ path: "moved.txt", action: "move", fromPath: "old.txt", staged: true }), f({ path: "gone.txt", action: "delete", dirty: true })],
    );
    expect(out.map((x) => [x.path, x.action])).toEqual([
      ["a.txt", "none"],
      ["gone.txt", "delete"],
      ["new.txt", "add"],
      ["moved.txt", "move"],
    ]);
  });
});

import { metaValue, revisionFromMeta } from "../../src/main/lore/mappers";
describe("revision metadata", () => {
  it("reads tagged metadata values and prefers committed-by", () => {
    expect(metaValue({ tag: 6, tagName: "string", data: "hello" })).toBe("hello");
    expect(metaValue({ tag: 5, tagName: "numeric", data: 1793730303012 })).toBe("1793730303012");
    const r = revisionFromMeta({ number: 3, hash: "h", parents: ["p"] }, { message: "m", timestamp: "1793730303012", branch: "id1", "created-by": "a", "committed-by": "b" }, new Map([["id1", "main"]]));
    expect(r).toEqual({ number: 3, hash: "h", parents: ["p"], branch: "main", author: "b", timestamp: 1793730303012, message: "m" });
    expect(revisionFromMeta({ number: 1, hash: "h", parents: [] }, {}, new Map()).author).toBeNull();
  });
});
