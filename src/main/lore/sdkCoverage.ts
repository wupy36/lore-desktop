// Every operation exported by the pinned @lore-vcs/sdk, classified. Enforced by
// tests/main/sdk-coverage.test.ts: an SDK bump that adds, renames or removes an
// operation fails the build until this table is updated (Lore is pre-1.0 and
// its API moves). "used" entries must actually be called by SdkBackend.

export type Coverage =
  | { status: "used" }
  | { status: "planned"; when: "B" | "Phase 3" | "Phase 4"; surface: string }
  | { status: "excluded"; reason: string };

const used: Coverage = { status: "used" };
const planned = (when: "B" | "Phase 3" | "Phase 4", surface: string): Coverage => ({ status: "planned", when, surface });
const excluded = (reason: string): Coverage => ({ status: "excluded", reason });

const NON_GOAL_MERGE = excluded("Non-goal: merge/cherry-pick/revert conflict UI — shown as 'resolve via CLI' with the exact command");
const NON_GOAL_LINKS = excluded("Non-goal: links and layers");
const LOW_LEVEL_STORAGE = excluded("Low-level storage API; the app only opens a handle to read the revision tree");
const LOW_LEVEL_TREE = excluded("Low-level revision-tree editing; the app only reads the tree");
const METADATA = excluded("Metadata editing not in scope yet (palette candidate)");
const POWER_USER = excluded("Debug / power-user; use the CLI");

export const SDK_COVERAGE: Record<string, Coverage> = {
  // auth — Account panel (step B)
  authClear: planned("B", "Account panel"),
  authList: planned("B", "Account panel"),
  authLocalUserInfo: planned("B", "Account panel"),
  authLoginInteractive: planned("B", "Account panel / Connect"),
  authLoginWithToken: planned("B", "Account panel / Connect"),
  authLogout: planned("B", "Account panel"),
  authUserInfo: planned("B", "Toolbar identity badge"),

  // branch
  branchArchive: planned("Phase 3", "Branch row menu"),
  branchCreate: planned("Phase 3", "Repository tab"),
  branchDiff: planned("Phase 3", "Branch row menu"),
  branchInfo: planned("Phase 3", "Branch row menu"),
  branchLatestList: planned("Phase 3", "Repository tab"),
  branchList: planned("Phase 3", "Repository tab"),
  branchMergeAbort: NON_GOAL_MERGE,
  branchMergeInto: NON_GOAL_MERGE,
  branchMergeResolve: NON_GOAL_MERGE,
  branchMergeResolveMine: NON_GOAL_MERGE,
  branchMergeResolveTheirs: NON_GOAL_MERGE,
  branchMergeRestart: NON_GOAL_MERGE,
  branchMergeStart: NON_GOAL_MERGE,
  branchMergeUnresolve: NON_GOAL_MERGE,
  branchMetadataClear: METADATA,
  branchMetadataGet: METADATA,
  branchMetadataSet: METADATA,
  branchProtect: planned("Phase 3", "Branch row menu"),
  branchPush: used,
  branchReset: excluded("Rewrites the local latest pointer; advanced, use the CLI"),
  branchSwitch: planned("Phase 3", "Repository tab"),
  branchUnprotect: planned("Phase 3", "Branch row menu"),

  // file
  fileAudit: planned("Phase 3", "Detail pane (per-line attribution)"),
  fileDependencyAdd: planned("Phase 4", "Dependencies tab"),
  fileDependencyList: planned("Phase 4", "Dependencies tab / dependency sync"),
  fileDependencyRemove: planned("Phase 4", "Dependencies tab"),
  fileDiff: planned("Phase 3", "Detail pane diff"),
  fileDirty: used,
  fileDirtyCopy: excluded("Watcher reports plain dirty paths; Lore classifies the action from disk"),
  fileDirtyMove: excluded("Watcher reports plain dirty paths; Lore classifies the action from disk"),
  fileDump: POWER_USER,
  fileHash: POWER_USER,
  fileHistory: planned("Phase 3", "Detail pane history"),
  fileInfo: planned("Phase 3", "Detail pane / Last revision column"),
  fileMetadataClear: METADATA,
  fileMetadataGet: METADATA,
  fileMetadataList: METADATA,
  fileMetadataSet: METADATA,
  fileObliterate: excluded("Destructive admin operation; use the CLI"),
  fileReset: used,
  fileResetToLastMerged: NON_GOAL_MERGE,
  fileStage: used,
  fileStageMerge: NON_GOAL_MERGE,
  fileStageMove: excluded("Rename/move UI not in scope; moves are picked up by the scan"),
  fileUnstage: used,
  fileWrite: used,

  // layer / link
  layerAdd: NON_GOAL_LINKS,
  layerList: NON_GOAL_LINKS,
  layerRemove: NON_GOAL_LINKS,
  linkAdd: NON_GOAL_LINKS,
  linkInfo: NON_GOAL_LINKS,
  linkList: NON_GOAL_LINKS,
  linkListStaged: NON_GOAL_LINKS,
  linkRemove: NON_GOAL_LINKS,
  linkUpdate: NON_GOAL_LINKS,

  // lock
  lockFileAcquire: planned("Phase 4", "Lock / file row menu"),
  lockFileQuery: planned("Phase 4", "Locks panel"),
  lockFileRelease: planned("Phase 4", "Lock / file row menu"),
  lockFileStatus: planned("Phase 4", "Locks panel / Lock owner column"),

  // notification
  notificationSubscribe: excluded("Streaming; live updates come from the FS watcher for now"),
  notificationUnsubscribe: excluded("Streaming; live updates come from the FS watcher for now"),

  // repository
  repositoryClone: used,
  repositoryConfigGet: used,
  repositoryCreate: used,
  repositoryDelete: excluded("Non-goal: server administration"),
  repositoryDump: POWER_USER,
  repositoryFlush: used,
  repositoryGc: used,
  repositoryInfo: excluded("Superseded by status + config + repository list for the open repository"),
  repositoryInstanceList: used,
  repositoryInstancePrune: used,
  repositoryList: used,
  repositoryMetadataClear: METADATA,
  repositoryMetadataGet: METADATA,
  repositoryMetadataSet: METADATA,
  repositoryRelease: excluded("Per-call repository handles are managed by Lore"),
  repositoryStatus: used,
  repositoryStoreImmutableQuery: POWER_USER,
  repositoryUpdatePath: planned("B", "Manage menu: after moving a workspace folder"),
  repositoryVerifyState: used,

  // revision
  revisionAmend: planned("Phase 3", "History row menu (latest commit message)"),
  revisionBisect: POWER_USER,
  revisionCherryPick: NON_GOAL_MERGE,
  revisionCommit: used,
  revisionDiff: planned("Phase 3", "History: compare revisions"),
  revisionFind: planned("Phase 3", "History search"),
  revisionHistory: planned("Phase 3", "History"),
  revisionInfo: planned("Phase 3", "History detail"),
  revisionMetadataClear: METADATA,
  revisionMetadataGet: METADATA,
  revisionMetadataList: METADATA,
  revisionMetadataSet: METADATA,
  revisionRestore: planned("Phase 3", "History row menu: restore files to a revision"),
  revisionRevert: NON_GOAL_MERGE,
  revisionRevertAbort: NON_GOAL_MERGE,
  revisionRevertResolve: NON_GOAL_MERGE,
  revisionRevertResolveMine: NON_GOAL_MERGE,
  revisionRevertResolveTheirs: NON_GOAL_MERGE,
  revisionRevertRestart: NON_GOAL_MERGE,
  revisionRevertUnresolve: NON_GOAL_MERGE,
  revisionSync: used,
  revisionTreeAdd: LOW_LEVEL_TREE,
  revisionTreeClose: used,
  revisionTreeCommit: LOW_LEVEL_TREE,
  revisionTreeDelete: LOW_LEVEL_TREE,
  revisionTreeInfo: LOW_LEVEL_TREE,
  revisionTreeListChildren: used,
  revisionTreeLoad: used,
  revisionTreeMetadataClear: LOW_LEVEL_TREE,
  revisionTreeMetadataGet: LOW_LEVEL_TREE,
  revisionTreeMetadataSet: LOW_LEVEL_TREE,
  revisionTreeModify: LOW_LEVEL_TREE,
  revisionTreeMove: LOW_LEVEL_TREE,
  revisionTreeNodeInfo: LOW_LEVEL_TREE,
  revisionTreeNodePath: LOW_LEVEL_TREE,
  revisionTreeResolvePath: LOW_LEVEL_TREE,

  // service — relays CLI commands only; the app links Lore in-process
  serviceSetExecutable: excluded("Lore service relays CLI commands; the app runs Lore in-process"),
  serviceSetUseAutomatically: excluded("Lore service relays CLI commands; the app runs Lore in-process"),
  serviceStart: excluded("Lore service relays CLI commands; the app runs Lore in-process"),
  serviceStatus: excluded("Lore service relays CLI commands; the app runs Lore in-process"),
  serviceStop: excluded("Lore service relays CLI commands; the app runs Lore in-process"),

  // shared store
  sharedStoreCreate: excluded("Non-goal: shared-store management"),
  sharedStoreInfo: excluded("Non-goal: shared-store management"),
  sharedStoreList: excluded("Non-goal: shared-store management"),
  sharedStoreSetUseAutomatically: excluded("Non-goal: shared-store management"),

  // storage
  storageClose: used,
  storageCopy: LOW_LEVEL_STORAGE,
  storageFlush: LOW_LEVEL_STORAGE,
  storageGet: LOW_LEVEL_STORAGE,
  storageGetFile: LOW_LEVEL_STORAGE,
  storageGetFileResolved: LOW_LEVEL_STORAGE,
  storageGetMetadata: LOW_LEVEL_STORAGE,
  storageGetResolved: LOW_LEVEL_STORAGE,
  storageMutableCompareAndSwap: LOW_LEVEL_STORAGE,
  storageMutableList: LOW_LEVEL_STORAGE,
  storageMutableLoad: LOW_LEVEL_STORAGE,
  storageMutableStore: LOW_LEVEL_STORAGE,
  storageObliterate: LOW_LEVEL_STORAGE,
  storageOpen: used,
  storagePut: LOW_LEVEL_STORAGE,
  storagePutFile: LOW_LEVEL_STORAGE,
  storagePutFileResolved: LOW_LEVEL_STORAGE,
  storagePutResolved: LOW_LEVEL_STORAGE,
  storageUpload: LOW_LEVEL_STORAGE,
};
