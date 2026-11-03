// Fallback LoreBackend that spawns the `lore` CLI (`--non-interactive`).
// Used when an SDK call is missing. Cancellation kills the child process.
// Phase 1: process plumbing only; parsing per command lands with each phase.
// Note: if `lore service set-use-automatically true` is configured, these
// commands are relayed to the per-user Lore service transparently.
import { spawn } from "node:child_process";
import type { RepoInfo } from "@shared/types";
import { type Argv, formatArgv } from "@shared/commands";
import { CancelledError, LoreError, type LoreBackend, type OpContext } from "./LoreBackend";

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runLore(exe: string, argv: Argv, opts: { cwd?: string; repository?: string; signal?: AbortSignal } = {}): Promise<CliResult> {
  const full = ["--non-interactive", "--no-pager", ...(opts.repository ? ["--repository", opts.repository] : []), ...argv];
  return new Promise((resolve, reject) => {
    const child = spawn(exe, full, { cwd: opts.cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    const onAbort = () => child.kill();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (e) => reject(new LoreError(`Failed to start ${formatArgv(full)}: ${e.message}`)));
    child.on("close", (code) => {
      opts.signal?.removeEventListener("abort", onAbort);
      if (opts.signal?.aborted) return reject(new CancelledError());
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

const notYet = (op: string) => () => Promise.reject(new LoreError(`${op}: not implemented in CliBackend yet`));

export class CliBackend implements LoreBackend {
  readonly kind = "cli" as const;
  readonly canCancel = true;
  private repo: RepoInfo | null = null;

  constructor(private readonly exe = "lore") {}

  async exec(argv: Argv, ctx?: OpContext): Promise<string> {
    const r = await runLore(this.exe, argv, { repository: this.repo?.path, signal: ctx?.signal });
    if (r.code !== 0) throw new LoreError(r.stderr.trim() || `${formatArgv(argv)} exited with ${r.code}`, r.code);
    return r.stdout;
  }

  async openRepository(path: string): Promise<RepoInfo> {
    this.repo = { path, name: path.split(/[\\/]/).filter(Boolean).pop() ?? path, remoteUrl: null, repositoryId: "", instanceId: "", branch: "", revision: null, revisionHash: null, aheadBy: 0, offline: false };
    return { ...this.repo };
  }

  currentRepository(): RepoInfo | null {
    return this.repo ? { ...this.repo } : null;
  }

  cloneRepository = notYet("clone");
  listInstances = notYet("instance list");
  listRemoteRepositories = notYet("repository list");
  status = notYet("status");
  listFiles = notYet("listFiles");
  stage = notYet("stage");
  unstage = notYet("unstage");
  reset = notYet("reset");
  markDirty = notYet("dirty");
  commit = notYet("commit");
  push = notYet("push");
  sync = notYet("sync");
  history = notYet("history");
  fileHistory = notYet("file history");
  diff = notYet("diff");
  listBranches = notYet("branch list");
  switchBranch = notYet("branch switch");
  createBranch = notYet("branch create");
  lockAcquire = notYet("lock acquire");
  lockRelease = notYet("lock release");
  lockQuery = notYet("lock query");
  authInfo = notYet("auth info");
  getView = notYet("view");
  applyView = notYet("view apply");
  async dispose(): Promise<void> {}
}
