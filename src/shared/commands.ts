// Equivalent `lore` CLI argv for each backend op. Used by CliBackend to run
// commands and by every backend to show a copy-pasteable command in the
// console log. Verified against docs/reference/lore-cli-commands.md (CLI 0.10.x).

export type Argv = string[];

const q = (s: string): string => (/^[\w@./:=-]+$/.test(s) ? s : JSON.stringify(s));
export const formatArgv = (argv: Argv): string => ["lore", ...argv].map(q).join(" ");

export const cli = {
  status: (o: { scan?: boolean; checkDirty?: boolean; paths?: string[] }): Argv => [
    "status",
    ...(o.scan ? ["--scan"] : []),
    ...(o.checkDirty ? ["--check-dirty"] : []),
    ...(o.paths ?? []),
  ],
  stage: (paths: string[]): Argv => ["stage", ...paths],
  unstage: (paths: string[]): Argv => ["unstage", ...paths],
  reset: (paths: string[], purge?: boolean): Argv => ["reset", ...(purge ? ["--purge"] : []), ...paths],
  dirty: (paths: string[]): Argv => ["dirty", ...paths],
  commit: (message: string): Argv => ["commit", message],
  push: (branch?: string): Argv => ["push", ...(branch ? [branch] : [])],
  sync: (o: { revision?: string; reset?: boolean; viewFile?: string; rootFiles?: string[]; dependencyRecursive?: boolean; dependencyTags?: string[] }): Argv => [
    "sync",
    ...(o.reset ? ["--reset"] : []),
    ...(o.viewFile ? ["--view", o.viewFile] : []),
    ...(o.rootFiles ?? []).flatMap((f) => ["--root-file", f]),
    ...(o.dependencyRecursive ? ["--dependency-recursive"] : []),
    ...(o.dependencyTags ?? []).flatMap((t) => ["--dependency-tag", t]),
    ...(o.revision ? [o.revision] : []),
  ],
  history: (length: number, branch?: string): Argv => ["history", ...(branch ? ["--branch", branch] : []), String(length)],
  fileHistory: (path: string, length: number): Argv => ["file", "history", path, String(length)],
  diff: (path: string, source?: string, target?: string): Argv => [
    "file",
    "diff",
    ...(source ? ["--source", source] : []),
    ...(target ? ["--target", target] : []),
    path,
  ],
  branchList: (): Argv => ["branch", "list"],
  branchSwitch: (name: string, reset?: boolean): Argv => ["branch", "switch", ...(reset ? ["--reset"] : []), name],
  branchCreate: (name: string): Argv => ["branch", "create", name],
  lockAcquire: (paths: string[]): Argv => ["lock", "acquire", ...paths],
  lockRelease: (paths: string[], owner?: string): Argv => ["lock", "release", ...(owner ? ["--owner", owner] : []), ...paths],
  lockStatus: (paths: string[]): Argv => ["lock", "status", ...paths],
  depList: (path: string, o: { reverse?: boolean; recursive?: boolean } = {}): Argv => ["file", "dependency", "list", ...(o.reverse ? ["--reverse"] : []), ...(o.recursive ? ["--recursive"] : []), path],
  depAdd: (path: string, deps: string[], tags: string[] = []): Argv => ["file", "dependency", "add", ...tags.flatMap((t) => ["--tag", t]), path, ...deps],
  depRemove: (path: string, deps: string[]): Argv => ["file", "dependency", "remove", path, ...deps],
  lockQuery: (o: { branch?: string; owner?: string; path?: string }): Argv => [
    "lock",
    "query",
    ...(o.branch ? ["--branch", o.branch] : []),
    ...(o.owner ? ["--owner", o.owner] : []),
    ...(o.path ? ["--path", o.path] : []),
  ],
  authInfo: (): Argv => ["auth", "info"],
  clone: (o: { url: string; path: string; branch?: string; viewFile?: string }): Argv => [
    "clone",
    ...(o.branch ? ["--branch", o.branch] : []),
    ...(o.viewFile ? ["--view", o.viewFile] : []),
    o.url,
    o.path,
  ],
  repoInfo: (): Argv => ["repository", "info"],
  repoCreate: (o: { name: string; remoteUrl?: string }): Argv => (o.remoteUrl ? ["repository", "create", `${o.remoteUrl.replace(/\/+$/, "")}/${o.name}`] : ["--offline", "repository", "create", o.name]),
  maintenance: (op: "verify" | "gc" | "flush" | "prune" | "updatePath"): Argv =>
    ({ verify: ["repository", "verify", "state"], gc: ["repository", "gc"], flush: ["repository", "flush"], prune: ["repository", "instance", "prune"], updatePath: ["repository", "update-path"] })[op],
  fileWrite: (path: string, output: string, revision?: string): Argv => ["file", "write", "--path", path, ...(revision ? ["--revision", revision] : []), "--output", output],
  repoList: (remoteUrl: string): Argv => ["repository", "list", remoteUrl],
  instanceList: (): Argv => ["repository", "instance", "list"],
} as const;

/** Commands the GUI deliberately does not implement (non-goals); shown verbatim. */
export const resolveViaCli = {
  mergeMine: (path: string): string => formatArgv(["branch", "merge", "resolve", "mine", path]),
  mergeTheirs: (path: string): string => formatArgv(["branch", "merge", "resolve", "theirs", path]),
  mergeAbort: (): string => formatArgv(["branch", "merge", "abort"]),
  /** Finish a merge left pending by sync: resolve conflicts, then commit the merge. */
  mergeCommit: (): string => formatArgv(["commit", "Merge"]),
};
