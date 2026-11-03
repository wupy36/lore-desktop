// User-facing actions shared by toolbar, context menu, hotkeys and sidebar.
import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { FileEntry } from "@shared/types";
import { useApi } from "./api/client";
import { qk, useFiles, usePrefs, useRepo } from "./api/queries";
import type { MaintenanceOp, Prefs } from "@shared/types";
import { useActivity } from "./store/activity";
import { useUi } from "./store/ui";

export function useActions() {
  const api = useApi();
  const qc = useQueryClient();
  const files = useFiles().data;
  const repo = useRepo().data;
  const prefs = usePrefs().data;
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
        if (prefs?.confirmReset !== false && !confirmFn(`Discard local changes to ${changed.length} file(s)? This cannot be undone.`)) return;
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
      sync: () => run("sync", () => api.invoke("rev:sync", prefs?.syncDiscardLocal ? { reset: true } : {})),
      setPrefs: (patch: Partial<Prefs>) => run("preferences", () => api.invoke("prefs:set", patch)),
      maintenance: (op: MaintenanceOp) => run(`repository ${op}`, () => api.invoke("repo:maintenance", { op })),
      createRepository: (o: { path: string; name: string; remoteUrl?: string }) => run("create repository", () => api.invoke("repo:create", o)),
      switchBranch: (name: string) => run("switch", () => api.invoke("branch:switch", { name })),
      createBranch: (name: string) => run("create branch", () => api.invoke("branch:create", { name })),
      pickRepository: () => run("open repository", () => api.invoke("repo:pick", undefined)),
      openRepository: (path: string) => run("open repository", () => api.invoke("repo:open", { path })),
      clone: (url: string, path: string) => run("clone", () => api.invoke("repo:clone", { url, path })),
      pickFolder: (title?: string) => api.invoke("dialog:pickFolder", { title }).catch(() => null),
      createBranchAndSwitch: (name: string) => run("create branch", () => api.invoke("branch:create", { name })),
      branchAction: (name: string, action: "protect" | "unprotect" | "archive") => run(`branch ${action}`, () => api.invoke("branch:action", { name, action })),
      amend: (message: string) => run("amend", () => api.invoke("rev:amend", { message })),
      login: () =>
        run("sign in", async () => {
          try {
            qc.setQueryData(qk.auth, await api.invoke("auth:login", undefined));
          } finally {
            useUi.getState().setAuthPrompt(null);
          }
        }),
      logout: () => run("sign out", async () => qc.setQueryData(qk.auth, await api.invoke("auth:logout", undefined))),
      cancel: (opId: string) => run("cancel", () => api.invoke("op:cancel", { opId })),
      openExternalDiff: (path: string, source?: string, target?: string) => run("external diff", () => api.invoke("file:openExternalDiff", { path, source, target })),
    };
  }, [api, qc, run, selection, repo, prefs]);
}
