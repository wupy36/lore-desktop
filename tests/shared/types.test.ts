import { describe, expect, it } from "vitest";
import { changeGroup, deriveFileState, fileExt, fileName, type FileEntry } from "@shared/types";
import { cli, formatArgv } from "@shared/commands";

const f = (p: Partial<FileEntry>): FileEntry => ({ path: "a/b.txt", size: 1, action: "none", staged: false, dirty: false, conflict: false, fromPath: null, lastRevision: 1, lockOwner: null, binary: false, ...p });

describe("deriveFileState", () => {
  it.each([
    [{}, "synced"],
    [{ dirty: true, action: "modify" }, "modified"],
    [{ dirty: true, action: "modify", staged: true }, "staged"],
    [{ action: "add", dirty: true }, "untracked"],
    [{ action: "add", staged: true }, "added"],
    [{ action: "delete", dirty: true }, "deleted"],
    [{ action: "delete", staged: true }, "deleted"],
    [{ action: "move", dirty: true }, "modified"],
    [{ conflict: true, staged: true }, "conflict"],
  ] as const)("%o -> %s", (p, want) => expect(deriveFileState(f(p))).toBe(want));
});

describe("changeGroup", () => {
  it("groups by Lore flags", () => {
    expect(changeGroup(f({}))).toBeNull();
    expect(changeGroup(f({ staged: true, action: "modify" }))).toBe("staged");
    expect(changeGroup(f({ dirty: true, action: "modify" }))).toBe("unstaged");
    expect(changeGroup(f({ action: "add", dirty: true }))).toBe("untracked");
    expect(changeGroup(f({ action: "delete", dirty: true }))).toBe("unstaged");
  });
});

describe("path helpers", () => {
  it("name/ext", () => {
    expect(fileName("Content/Maps/Hub.umap")).toBe("Hub.umap");
    expect(fileExt("Content/Maps/Hub.UMAP")).toBe("umap");
    expect(fileExt(".loreignore")).toBe("");
  });
});

describe("CLI argv (docs/reference/lore-cli-commands.md)", () => {
  it("builds documented commands", () => {
    expect(cli.status({ scan: true })).toEqual(["status", "--scan"]);
    expect(cli.status({ checkDirty: true })).toEqual(["status", "--check-dirty"]);
    expect(cli.sync({ reset: true, viewFile: "v.txt", rootFiles: ["A.umap"], revision: "main@LATEST" })).toEqual(["sync", "--reset", "--view", "v.txt", "--root-file", "A.umap", "main@LATEST"]);
    expect(cli.reset(["x"], true)).toEqual(["reset", "--purge", "x"]);
    expect(cli.fileHistory("a.cpp", 50)).toEqual(["file", "history", "a.cpp", "50"]);
    expect(cli.lockQuery({ owner: "me" })).toEqual(["lock", "query", "--owner", "me"]);
    expect(cli.branchSwitch("dev", true)).toEqual(["branch", "switch", "--reset", "dev"]);
  });
  it("quotes args with spaces", () => {
    expect(formatArgv(cli.commit("Fix the thing"))).toBe('lore commit "Fix the thing"');
  });
});
