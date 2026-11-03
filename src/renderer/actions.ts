// User-facing actions shared by toolbar, context menu, hotkeys and sidebar.
import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { FileEntry } from "@shared/types";
import { useApi } from "./api/client";
import { qk, useFiles, useRepo } from "./api/queries";
import { useActivity } from "./store/activity";
import { useUi } from "./store/ui";

export function useActions() {
  const api = useApi();
  const qc = useQueryClient();
  const files = useFiles().data;
  const repo = useRepo().data;
  const selected = useUi((s) => s.selected);

  const byPath = useMemo(() => new Map((files ?? []).map((f) => [f.path, f])), [files]);
  const selection: FileEntry[] = useMemo(() => [...selected].map((p) => byPath.get(p)).filter((f): f is FileEntry => !!f), [selected, byPath]);

  const run = useCallback(async (label: string, fn: () => Promise<unknown>) => {
    try {
      useActivity.getState().setError(null);
      await fn();
    } catch (e) {
      useActivity.getState().setError(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const paths = (fs: FileEntry[]) => fs.map((f) => f.path);

  return useMemo(() => {
    const sel = selection;
    return {
      selection: sel,
      repo,
      refresh: (scan = true) =>
        run("refresh", async () => {
          await api.invoke("ws:status", { scan });
          await qc.invalidateQueries();
        }),
      revertUnchanged: () =>
        run("revert unchanged", async () => {
          await api.invoke("ws:status", { checkDirty: true });
          await qc.invalidateQueries({ queryKey: qk.files });
        }),
      stage: (fs: FileEntry[] = sel) => fs.length && run("stage", () => api.invoke("ws:stage", { paths: paths(fs) })),
      unstage: (fs: FileEntry[] = sel) => fs.length && run("unstage", () => api.invoke("ws:unstage", { paths: paths(fs) })),
      reset: (fs: FileEntry[] = sel, confirmFn: (m: string) => boolean = (m) => window.confirm(m)) => {
        const changed = fs.filter((f) => f.dirty || f.staged || f.action !== "none");
        if (!changed.length) return;
        if (!confirmFn(`Discard local changes to ${changed.length} file(s)? This cannot be undone.`)) return;
        return run("reset", () => api.invoke("ws:reset", { paths: paths(changed) }));
      },
      lock: (fs: FileEntry[] = sel) => fs.length && run("lock", () => api.invoke("lock:acquire", { paths: paths(fs) })),
      release: (fs: FileEntry[] = sel) => fs.length && run("release", () => api.invoke("lock:release", { paths: paths(fs) })),
      commit: (message: string) =>
        run("commit", async () => {
          await api.invoke("rev:commit", { message });
          useUi.getState().setCommitMessage("");
        }),
      push: () => run("push", () => api.invoke("rev:push", {})),
      sync: () => run("sync", () => api.invoke("rev:sync", {})),
      switchBranch: (name: string) => run("switch", () => api.invoke("branch:switch", { name })),
      createBranch: (name: string) => run("create branch", () => api.invoke("branch:create", { name })),
      pickRepository: () => run("open repository", () => api.invoke("repo:pick", undefined)),
      openRepository: (path: string) => run("open repository", () => api.invoke("repo:open", { path })),
      clone: (url: string, path: string) => run("clone", () => api.invoke("repo:clone", { url, path })),
      pickFolder: (title?: string) => api.invoke("dialog:pickFolder", { title }).catch(() => null),
      cancel: (opId: string) => run("cancel", () => api.invoke("op:cancel", { opId })),
      openExternalDiff: (path: string) => run("external diff", () => api.invoke("file:openExternalDiff", { path })),
    };
  }, [api, qc, run, selection, repo]);
}
