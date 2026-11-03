// LoreBackend over the official JS SDK (@lore-vcs/sdk, koffi FFI over
// lore-capi). Runs in the Electron main process only.
//
// Phase 1: openRepository + status are wired (proven by spike/sdk-spike.mjs).
// Remaining ops land in Phase 2/3/4 and throw until then.
import type * as Sdk from "@lore-vcs/sdk";
import type * as SdkEnums from "@lore-vcs/sdk/types/enums";
import type { LoreGlobalArgs } from "@lore-vcs/sdk/types/args";
import type { LoreEventFFI } from "@lore-vcs/sdk/types/events";
import type { FileEntry, RepoInfo, StatusResult } from "@shared/types";
import { LoreError, type LoreBackend, type StatusOptions } from "./LoreBackend";
import { mapStatusFile, mapStatusRevision, type StatusRevision } from "./mappers";

type SdkModule = typeof Sdk;
type EnumsModule = typeof SdkEnums;

const notYet = (op: string, phase: number) => () => Promise.reject(new LoreError(`${op}: not implemented in SdkBackend yet (Phase ${phase})`));

export class SdkBackend implements LoreBackend {
  readonly kind = "sdk" as const;
  private repo: RepoInfo | null = null;

  private constructor(
    private readonly sdk: SdkModule,
    private readonly enums: EnumsModule,
  ) {}

  /** Loads the native library lazily so `--mock` never touches it. */
  static async create(): Promise<SdkBackend> {
    const [sdk, enums] = await Promise.all([import("@lore-vcs/sdk"), import("@lore-vcs/sdk/types/enums")]);
    return new SdkBackend(sdk, enums);
  }

  private globals(): LoreGlobalArgs {
    if (!this.repo) throw new LoreError("No repository open");
    return { repositoryPath: this.repo.path };
  }

  /** Run a fluent call, collecting COMPLETE status/error. `onEvent` runs inside the native callback. */
  private async run(call: { callback(fn: (e: LoreEventFFI) => void): { waitAsync(): Promise<number> } }, onEvent: (e: LoreEventFFI) => void): Promise<void> {
    const { LoreEventTag } = this.enums;
    let err: { code: number; message: string } | null = null;
    const rc = await call
      .callback((e) => {
        if (e.tag === LoreEventTag.COMPLETE) {
          if (e.data.status !== 0) err = { code: e.data.status, message: String(e.data.error?.message ?? "") };
          return;
        }
        onEvent(e);
      })
      .waitAsync();
    const failure = err as { code: number; message: string } | null;
    if (failure) throw new LoreError(failure.message || `Lore error ${failure.code}`, failure.code);
    if (rc !== 0) throw new LoreError(`Lore call failed to start (code ${rc})`, rc);
  }

  private async statusRaw(path: string, o: StatusOptions): Promise<{ rev: StatusRevision | null; files: FileEntry[] }> {
    const { LoreEventTag } = this.enums;
    let rev: StatusRevision | null = null;
    const files: FileEntry[] = [];
    await this.run(
      this.sdk.lore.repositoryStatus({ repositoryPath: path }, { staged: true, scan: !!o.scan, checkDirty: !!o.checkDirty, ...(o.paths?.length ? { paths: o.paths } : {}) }),
      (e) => {
        if (e.tag === LoreEventTag.REPOSITORY_STATUS_REVISION) rev = mapStatusRevision(e.data);
        else if (e.tag === LoreEventTag.REPOSITORY_STATUS_FILE) {
          const f = mapStatusFile(e.data);
          if (f) files.push(f);
        }
      },
    );
    return { rev, files };
  }

  async openRepository(path: string): Promise<RepoInfo> {
    const { rev } = await this.statusRaw(path, {});
    const r = rev as StatusRevision | null;
    this.repo = {
      path,
      name: path.split(/[\\/]/).filter(Boolean).pop() ?? path,
      remoteUrl: null, // Phase 2: repositoryInfo
      repositoryId: "",
      instanceId: "",
      branch: r?.branch ?? "",
      revision: r?.revision ?? null,
      revisionHash: r?.revisionHash ?? null,
      aheadBy: r ? Math.max(0, r.localRevision - r.revision) : 0,
      offline: false,
    };
    return { ...this.repo };
  }

  currentRepository(): RepoInfo | null {
    return this.repo ? { ...this.repo } : null;
  }

  async status(o: StatusOptions): Promise<StatusResult> {
    const path = this.globals().repositoryPath as string;
    const { rev, files } = await this.statusRaw(path, o);
    const r = rev as StatusRevision | null;
    return { branch: r?.branch ?? this.repo?.branch ?? "", revision: r?.revision ?? null, files, scanned: !!o.scan };
  }

  /** Phase 1: changed files only (from status). Phase 2 merges the full tree listing. */
  async listFiles(): Promise<FileEntry[]> {
    return (await this.status({})).files;
  }

  // Phase 2
  cloneRepository = notYet("clone", 2);
  listInstances = notYet("instance list", 2);
  listRemoteRepositories = notYet("repository list", 2);
  stage = notYet("stage", 2);
  unstage = notYet("unstage", 2);
  reset = notYet("reset", 2);
  commit = notYet("commit", 2);
  push = notYet("push", 2);
  sync = notYet("sync", 2);
  authInfo = notYet("auth info", 2);
  // Phase 3
  history = notYet("history", 3);
  fileHistory = notYet("file history", 3);
  diff = notYet("diff", 3);
  listBranches = notYet("branch list", 3);
  switchBranch = notYet("branch switch", 3);
  createBranch = notYet("branch create", 3);
  // Phase 4
  lockAcquire = notYet("lock acquire", 4);
  lockRelease = notYet("lock release", 4);
  lockQuery = notYet("lock query", 4);
  getView = notYet("view", 4);
  applyView = notYet("view apply", 4);

  async dispose(): Promise<void> {
    this.sdk.lore.shutdown();
  }
}
