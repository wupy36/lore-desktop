// Wraps any LoreBackend so every call is logged to the bus with its
// equivalent CLI command, args, duration and outcome (console log panel).
import type { LogEntry } from "@shared/types";
import type { Bus } from "../bus";
import { cli, formatArgv } from "@shared/commands";
import type { LoreBackend } from "./LoreBackend";

type AnyFn = (...a: unknown[]) => unknown;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous arg lists
type CmdBuilder = (...a: any[]) => string[];

/** Method -> CLI argv for display. Missing entries log without a command. */
const commandFor: Partial<Record<keyof LoreBackend, CmdBuilder>> = {
  status: cli.status,
  stage: cli.stage,
  unstage: cli.unstage,
  reset: (p: string[], o?: { purge?: boolean }) => cli.reset(p, o?.purge),
  markDirty: cli.dirty,
  commit: cli.commit,
  push: cli.push,
  sync: cli.sync,
  history: (o: { branch?: string; length: number }) => cli.history(o.length, o.branch),
  fileHistory: cli.fileHistory,
  diff: (o: { path: string; source?: string; target?: string }) => cli.diff(o.path, o.source, o.target),
  listBranches: cli.branchList,
  switchBranch: (n: string, o?: { reset?: boolean }) => cli.branchSwitch(n, o?.reset),
  createBranch: cli.branchCreate,
  lockAcquire: cli.lockAcquire,
  lockRelease: cli.lockRelease,
  lockQuery: cli.lockQuery,
  authInfo: cli.authInfo,
  cloneRepository: cli.clone,
  openRepository: cli.repoInfo,
  createRepository: cli.repoCreate,
  maintenance: cli.maintenance,
  exportFile: (p: string, rev: string | undefined, out: string) => cli.fileWrite(p, out, rev),
  listRemoteRepositories: cli.repoList,
  listInstances: cli.instanceList,
};

const SILENT = new Set<string>(["currentRepository", "kind", "canCancel", "dispose"]);
let logSeq = 0;

export function nextLogId(): number {
  return ++logSeq;
}

/** Strip the OpContext (functions/AbortSignal) before logging args. */
function loggableArgs(args: unknown[]): unknown[] {
  return args.filter((a) => !(a && typeof a === "object" && "signal" in a && "progress" in a));
}

function summarize(v: unknown): string {
  if (v === undefined) return "ok";
  if (Array.isArray(v)) return `${v.length} item(s)`;
  if (v && typeof v === "object" && "files" in v && Array.isArray((v as { files: unknown[] }).files)) {
    return `${(v as { files: unknown[] }).files.length} file(s)`;
  }
  return "ok";
}

export function instrument(backend: LoreBackend, bus: Bus): LoreBackend {
  return new Proxy(backend, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (typeof value !== "function" || typeof prop !== "string" || SILENT.has(prop)) {
        return typeof value === "function" ? (value as AnyFn).bind(target) : value;
      }
      return async (...args: unknown[]) => {
        const started = performance.now();
        const build = commandFor[prop as keyof LoreBackend];
        let command: string | null = null;
        try {
          command = build ? formatArgv(build(...args)) : null;
        } catch {
          command = null;
        }
        const base: Omit<LogEntry, "id" | "ts" | "level" | "durationMs" | "ok" | "message"> = {
          backend: target.kind,
          op: prop,
          command,
          args: loggableArgs(args),
        };
        try {
          const result: unknown = await (value as AnyFn).apply(target, args);
          bus.emit("log", { ...base, id: nextLogId(), ts: Date.now(), level: "info", durationMs: performance.now() - started, ok: true, message: summarize(result) });
          return result;
        } catch (e) {
          bus.emit("log", {
            ...base,
            id: nextLogId(),
            ts: Date.now(),
            level: "error",
            durationMs: performance.now() - started,
            ok: false,
            message: e instanceof Error ? e.message : String(e),
          });
          throw e;
        }
      };
    },
  });
}
