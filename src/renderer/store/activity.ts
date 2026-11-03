// Console log + transfer queue, fed by main-process bus events.
import { create } from "zustand";
import type { LogEntry, Transfer } from "@shared/types";

const MAX_LOG = 5000;

export interface ActivityState {
  log: LogEntry[];
  transfers: Transfer[]; // newest first
  lastError: string | null;
  pushLog(e: LogEntry): void;
  upsertTransfer(t: Transfer): void;
  setError(msg: string | null): void;
  clearLog(): void;
  clearFinished(): void;
}

export const useActivity = create<ActivityState>()((set) => ({
  log: [],
  transfers: [],
  lastError: null,
  pushLog: (e) =>
    set((s) => {
      const log = s.log.length >= MAX_LOG ? [...s.log.slice(s.log.length - MAX_LOG + 1), e] : [...s.log, e];
      return { log, lastError: e.ok === false ? `${e.op}: ${e.message}` : s.lastError };
    }),
  upsertTransfer: (t) =>
    set((s) => {
      const i = s.transfers.findIndex((x) => x.id === t.id);
      if (i < 0) return { transfers: [t, ...s.transfers] };
      // Ignore late progress after a terminal state (e.g. cancel reported first).
      const prev = s.transfers[i] as Transfer;
      if (prev.state !== "running" && t.state === "running") return s;
      const transfers = s.transfers.slice();
      transfers[i] = t;
      return { transfers, lastError: t.state === "error" ? `${t.label}: ${t.error ?? "failed"}` : s.lastError };
    }),
  setError: (lastError) => set({ lastError }),
  clearLog: () => set({ log: [] }),
  clearFinished: () => set((s) => ({ transfers: s.transfers.filter((t) => t.state === "running" || t.state === "queued") })),
}));
