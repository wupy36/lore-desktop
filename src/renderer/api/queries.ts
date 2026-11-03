import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Channel, In } from "@shared/ipc";
import { useActivity } from "../store/activity";
import { useApi } from "./client";

export const qk = {
  repo: ["repo"] as const,
  info: ["info"] as const,
  files: ["files"] as const,
  branches: ["branches"] as const,
  instances: ["instances"] as const,
  remotes: (url: string) => ["remotes", url] as const,
  history: (branch?: string) => ["history", branch ?? ""] as const,
  fileHistory: (path: string) => ["fileHistory", path] as const,
  diff: (path: string, source?: string, target?: string) => ["diff", path, source ?? "", target ?? ""] as const,
  locks: ["locks"] as const,
  auth: ["auth"] as const,
  view: ["view"] as const,
};

export const useAppInfo = () => {
  const api = useApi();
  return useQuery({ queryKey: qk.info, queryFn: () => api.invoke("app:info", undefined), staleTime: Infinity });
};
export const useRepo = () => {
  const api = useApi();
  return useQuery({ queryKey: qk.repo, queryFn: () => api.invoke("repo:current", undefined) });
};
/** True once a repository is open; repo-scoped queries wait for it. */
const useHasRepo = () => !!useRepo().data;

export const useFiles = () => {
  const api = useApi();
  return useQuery({ queryKey: qk.files, queryFn: () => api.invoke("ws:files", undefined), staleTime: 30_000, enabled: useHasRepo() });
};
export const useBranches = () => {
  const api = useApi();
  return useQuery({ queryKey: qk.branches, queryFn: () => api.invoke("branch:list", undefined), enabled: useHasRepo() });
};
export const useRecentRepos = () => {
  const api = useApi();
  return useQuery({ queryKey: ["recent"], queryFn: () => api.invoke("repo:recent", undefined) });
};
export const useInstances = () => {
  const api = useApi();
  return useQuery({ queryKey: qk.instances, queryFn: () => api.invoke("repo:instances", undefined), staleTime: 60_000 });
};
export const useRemotes = (url: string | null | undefined) => {
  const api = useApi();
  return useQuery({ queryKey: qk.remotes(url ?? ""), queryFn: () => api.invoke("repo:remoteList", { remoteUrl: url as string }), enabled: !!url, staleTime: 60_000 });
};
export const useHistory = (branch?: string) => {
  const api = useApi();
  return useQuery({ queryKey: qk.history(branch), queryFn: () => api.invoke("rev:history", { branch, length: 200 }) });
};
export const useFileHistory = (path: string | null) => {
  const api = useApi();
  return useQuery({ queryKey: qk.fileHistory(path ?? ""), queryFn: () => api.invoke("file:history", { path: path as string, length: 100 }), enabled: !!path });
};
export const useDiff = (path: string | null, enabled: boolean, source?: string) => {
  const api = useApi();
  return useQuery({ queryKey: qk.diff(path ?? "", source), queryFn: () => api.invoke("file:diff", { path: path as string, source }), enabled: !!path && enabled });
};
export const useLocks = () => {
  const api = useApi();
  return useQuery({ queryKey: qk.locks, queryFn: () => api.invoke("lock:query", {}), enabled: useHasRepo() });
};

/** Bridge bus events -> activity store + query invalidation (debounced). */
export function useBusBridge() {
  const api = useApi();
  const qc = useQueryClient();
  useEffect(() => {
    const { pushLog, upsertTransfer } = useActivity.getState();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const offs = [
      api.on("log", pushLog),
      api.on("transfer", upsertTransfer),
      api.on("ws:changed", () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          for (const key of [qk.files, qk.repo, ["recent"], qk.branches, qk.locks, ["history"], ["fileHistory"], ["diff"]]) void qc.invalidateQueries({ queryKey: key });
        }, 100);
      }),
    ];
    return () => {
      if (timer) clearTimeout(timer);
      offs.forEach((o) => o());
    };
  }, [api, qc]);
}

/** Generic mutation over one IPC channel; errors surface in the status bar (and the console via main). */
export function useInvoke<C extends Channel>(channel: C) {
  const api = useApi();
  return useMutation({
    mutationFn: (input: In<C>) => api.invoke(channel, input),
    onError: (e: Error) => useActivity.getState().setError(`${channel}: ${e.message}`),
  });
}
