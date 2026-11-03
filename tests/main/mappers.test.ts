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
