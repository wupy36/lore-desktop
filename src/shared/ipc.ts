// Typed IPC contract. Every request channel declares a zod schema for its input
// and output; main validates both directions (src/main/ipc.ts).
import { z } from "zod";
import {
  AboutInfo,
  AuthInfo,
  BranchAction,
  RevisionDetail,
  Branch,
  DiffResult,
  FileEntry,
  FileRevision,
  GraphRevision,
  Instance,
  Lock,
  LogEntry,
  MaintenanceOp,
  Prefs,
  RemoteRepo,
  RepoInfo,
  Revision,
  StatusResult,
  Transfer,
} from "./types";

const Paths = z.object({ paths: z.array(z.string()).min(1) });
const Ok = z.object({ ok: z.literal(true) });

/** Long-running ops return immediately with an op id; progress arrives on `transfer`. */
export const OpHandle = z.object({ opId: z.string() });

export const contract = {
  /** Log entries emitted before the renderer subscribed (startup open, etc.). */
  "app:logHistory": { input: z.void(), output: z.array(LogEntry) },
  /** Native folder picker; null when cancelled. */
  "dialog:pickFolder": { input: z.object({ title: z.string().optional() }), output: z.string().nullable() },
  "app:info": { input: z.void(), output: z.object({ backend: z.enum(["sdk", "cli", "mock"]), version: z.string(), platform: z.string() }) },
  "repo:open": { input: z.object({ path: z.string() }), output: RepoInfo },
  "repo:current": { input: z.void(), output: RepoInfo.nullable() },
  /** Show a folder picker and open the chosen repository; null when cancelled. */
  "repo:pick": { input: z.void(), output: RepoInfo.nullable() },
  "repo:recent": { input: z.void(), output: z.array(z.string()) },
  "repo:clone": { input: z.object({ url: z.string(), path: z.string(), branch: z.string().optional(), viewFile: z.string().optional() }), output: OpHandle },
  "repo:instances": { input: z.void(), output: z.array(Instance) },
  "repo:remoteList": { input: z.object({ remoteUrl: z.string() }), output: z.array(RemoteRepo) },

  "ws:status": { input: z.object({ scan: z.boolean().optional(), checkDirty: z.boolean().optional() }), output: StatusResult },
  "ws:files": { input: z.void(), output: z.array(FileEntry) },
  "ws:stage": { input: Paths, output: Ok },
  "ws:unstage": { input: Paths, output: Ok },
  "ws:reset": { input: Paths.extend({ purge: z.boolean().optional() }), output: Ok },

  "rev:commit": { input: z.object({ message: z.string().min(1) }), output: Revision },
  "rev:push": { input: z.object({ branch: z.string().optional() }), output: OpHandle },
  "rev:sync": { input: z.object({ revision: z.string().optional(), reset: z.boolean().optional(), viewFile: z.string().optional(), rootFiles: z.array(z.string()).optional() }), output: OpHandle },
  /** History across the current or all branches, deduplicated, newest first (for the graph view). */
  "rev:graph": { input: z.object({ scope: z.enum(["current", "all"]), length: z.number().int().positive().max(5000) }), output: z.array(GraphRevision) },
  "rev:info": { input: z.object({ revision: z.string() }), output: RevisionDetail },
  "rev:amend": { input: z.object({ message: z.string().min(1) }), output: z.object({ ok: z.literal(true) }) },
  "rev:history": { input: z.object({ branch: z.string().optional(), length: z.number().int().positive().max(5000) }), output: z.array(Revision) },
  "file:history": { input: z.object({ path: z.string(), length: z.number().int().positive().max(1000) }), output: z.array(FileRevision) },
  "file:diff": { input: z.object({ path: z.string(), source: z.string().optional(), target: z.string().optional() }), output: DiffResult },
  "file:openExternalDiff": { input: z.object({ path: z.string(), source: z.string().optional(), target: z.string().optional() }), output: Ok },

  "branch:list": { input: z.void(), output: z.array(Branch) },
  "branch:switch": { input: z.object({ name: z.string(), reset: z.boolean().optional() }), output: OpHandle },
  "branch:create": { input: z.object({ name: z.string().regex(/^[\w./-]+$/, "letters, digits, . _ - / only") }), output: Branch },
  "branch:action": { input: z.object({ name: z.string().min(1), action: BranchAction }), output: z.object({ ok: z.literal(true) }) },

  "lock:acquire": { input: Paths, output: z.array(Lock) },
  "lock:release": { input: Paths, output: Ok },
  "lock:query": { input: z.object({ branch: z.string().optional(), owner: z.string().optional(), path: z.string().optional() }), output: z.array(Lock) },

  "auth:info": { input: z.void(), output: AuthInfo },
  /** Device/browser login against the open repository's server. Progress (URL, code) arrives as `auth:prompt`. */
  "auth:login": { input: z.void(), output: AuthInfo },
  "auth:logout": { input: z.void(), output: AuthInfo },

  "view:get": { input: z.void(), output: z.object({ rules: z.array(z.string()) }) },
  "view:apply": { input: z.object({ rules: z.array(z.string()) }), output: OpHandle },

  "prefs:get": { input: z.void(), output: Prefs },
  "prefs:set": { input: Prefs.partial(), output: Prefs },
  "app:about": { input: z.void(), output: AboutInfo },
  /** Text of a bundled license; `external` licenses (large HTML) are opened in the system viewer instead. */
  "app:license": { input: z.object({ id: z.string() }), output: z.object({ text: z.string().nullable() }) },
  /** `lore repository create`: local-only when no remote is given (`--offline <name>`). */
  "repo:create": { input: z.object({ path: z.string().min(1), name: z.string().regex(/^[\w.-]+$/, "letters, digits, . _ - only"), remoteUrl: z.string().optional() }), output: RepoInfo },
  /** Repository maintenance (Manage menu): verify state, gc, flush, prune stale instances. */
  "repo:maintenance": { input: z.object({ op: MaintenanceOp }), output: OpHandle },
  "op:cancel": { input: z.object({ opId: z.string() }), output: z.object({ cancelled: z.boolean() }) },
} as const;

export type Contract = typeof contract;
export type Channel = keyof Contract;
export type In<C extends Channel> = z.input<Contract[C]["input"]>;
export type Out<C extends Channel> = z.output<Contract[C]["output"]>;

/** Push events main -> renderer. */
export const events = {
  log: LogEntry,
  transfer: Transfer,
  /** Workspace state changed (after a mutating op or an FS-watch trigger). */
  "ws:changed": z.object({ reason: z.string() }),
  "prefs:changed": Prefs,
  /** Interactive login: open `url` (and show `code`) to finish signing in. */
  "auth:prompt": z.object({ url: z.string(), code: z.string() }),
  /** Menu-bar commands that open renderer screens. */
  "ui:command": z.object({ command: z.enum(["preferences", "about", "createRepository", "openRepository", "account", "palette"]) }),
} as const;
export type EventName = keyof typeof events;
export type EventPayload<E extends EventName> = z.output<(typeof events)[E]>;

export { IPC_EVENT, IPC_INVOKE, type IpcResponse, type LoreApi } from "./bridge";
