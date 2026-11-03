// Channel -> backend call table. Pure (no Electron), so the same handlers
// back real IPC (ipc.ts) and in-process test harnesses.
import type { Channel, In, Out } from "@shared/ipc";
import { defaultPrefs, Prefs, type AboutInfo } from "@shared/types";
import type { Bus } from "./bus";
import type { BackendKind, LoreBackend } from "./lore/LoreBackend";
import type { OpRunner } from "./runner";

export type Handlers = { [C in Channel]: (input: In<C>) => Promise<Out<C>> };

export interface HandlerDeps {
  backend: LoreBackend;
  runner: OpRunner;
  bus: Bus;
  info: { backend: BackendKind; version: string; platform: string };
  openExternalDiff?: (input: In<"file:openExternalDiff">) => Promise<void>;
  /** Native folder picker (Electron dialog); returns null when cancelled. */
  pickDirectory?: () => Promise<string | null>;
  /** Preference persistence; in-memory defaults when absent (tests, harnesses). */
  prefs?: { get(): Prefs; set(patch: Partial<Prefs>): Prefs };
  /** About screen data + bundled license texts (Electron-only). */
  about?: { info(): Promise<AboutInfo>; license(id: string): Promise<string | null> };
  /** FS watcher hooks: paused around ops that write the working tree, restarted on open. */
  watcher?: { pause(): void; resume(): void; start(root: string): void };
  /** Backfill for the console panel. */
  logHistory?: { list(): Out<"app:logHistory"> };
  /** Recent-repository persistence (Electron userData). */
  recents?: { list(): string[]; remember(path: string): void };
}

export function createHandlers({ backend: b, runner, bus, info, openExternalDiff, pickDirectory, recents, logHistory, watcher, prefs: prefsDep, about }: HandlerDeps): Handlers {
  const changed = (reason: string) => bus.emit("ws:changed", { reason });
  let memPrefs = defaultPrefs();
  const prefs = prefsDep ?? { get: () => memPrefs, set: (p: Partial<Prefs>) => (memPrefs = Prefs.parse({ ...memPrefs, ...p })) };
  /** Ops that write the working tree run with the watcher paused (their writes are not user edits). */
  const writesTree =
    <A extends unknown[]>(fn: (...a: A) => Promise<unknown>) =>
    async (...a: A) => {
      watcher?.pause();
      try {
        return await fn(...a);
      } finally {
        watcher?.resume();
      }
    };
  const opened = <R extends { path: string }>(r: R): R => {
    watcher?.start(r.path);
    return r;
  };
  return {
    "app:info": async () => info,
    "app:logHistory": async () => logHistory?.list() ?? [],
    "dialog:pickFolder": async () => (pickDirectory ? pickDirectory() : null),
    "repo:open": async ({ path }) => {
      const r = opened(await b.openRepository(path));
      recents?.remember(path);
      changed("open");
      return r;
    },
    "repo:current": async () => b.currentRepository(),
    "repo:pick": async () => {
      const path = pickDirectory ? await pickDirectory() : null;
      if (!path) return null;
      const r = opened(await b.openRepository(path));
      recents?.remember(path);
      changed("open");
      return r;
    },
    "repo:recent": async () => recents?.list() ?? [],
    "repo:clone": async (o) => ({ opId: runner.start("clone", `Clone ${o.url}`, writesTree(async (ctx) => { const r = opened(await b.cloneRepository(o, ctx)); recents?.remember(r.path); return r; }), { unit: "files", cancellable: b.canCancel }) }),
    "repo:instances": () => b.listInstances(),
    "repo:remoteList": ({ remoteUrl }) => b.listRemoteRepositories(remoteUrl),

    "ws:status": (o) => b.status(o),
    "ws:files": () => b.listFiles(),
    "ws:stage": async ({ paths }) => {
      await b.stage(paths);
      changed("stage");
      return { ok: true } as const;
    },
    "ws:unstage": async ({ paths }) => {
      await b.unstage(paths);
      changed("unstage");
      return { ok: true } as const;
    },
    "ws:reset": async ({ paths, purge }) => {
      await writesTree(() => b.reset(paths, { purge }))();
      changed("reset");
      return { ok: true } as const;
    },

    "rev:commit": async ({ message }) => {
      const r = await b.commit(message);
      changed("commit");
      return r;
    },
    "rev:push": async ({ branch }) => ({ opId: runner.start("push", `Push ${branch ?? "current branch"}`, (ctx) => b.push(branch, ctx), { unit: "fragments", cancellable: b.canCancel }) }),
    "rev:sync": async (o) => ({ opId: runner.start("sync", `Sync ${o.revision ?? "latest"}`, writesTree((ctx) => b.sync(o, ctx)), { unit: "files", cancellable: b.canCancel }) }),
    "rev:history": (o) => b.history(o),
    "file:history": ({ path, length }) => b.fileHistory(path, length),
    "file:diff": (o) => b.diff(o),
    "file:openExternalDiff": async (o) => {
      if (!openExternalDiff) throw new Error("No external diff tool configured");
      await openExternalDiff(o);
      return { ok: true } as const;
    },

    "branch:list": () => b.listBranches(),
    "branch:switch": async ({ name, reset }) => ({ opId: runner.start("switch", `Switch to ${name}`, writesTree((ctx) => b.switchBranch(name, { reset }, ctx)), { unit: "files", cancellable: b.canCancel }) }),
    "branch:create": async ({ name }) => {
      const br = await b.createBranch(name);
      changed("branch");
      return br;
    },

    "lock:acquire": async ({ paths }) => {
      const l = await b.lockAcquire(paths);
      changed("lock");
      return l;
    },
    "lock:release": async ({ paths }) => {
      await b.lockRelease(paths);
      changed("lock");
      return { ok: true } as const;
    },
    "lock:query": (q) => b.lockQuery(q),

    "auth:info": () => b.authInfo(),

    "view:get": async () => ({ rules: await b.getView() }),
    "view:apply": async ({ rules }) => ({ opId: runner.start("view", "Apply view filter", writesTree((ctx) => b.applyView(rules, ctx)), { unit: "files", cancellable: b.canCancel }) }),

    "prefs:get": async () => prefs.get(),
    "prefs:set": async (patch) => {
      const next = prefs.set(patch);
      bus.emit("prefs:changed", next);
      return next;
    },
    "app:about": async () =>
      about
        ? about.info()
        : { app: "Lore Desktop", version: info.version, backend: info.backend, sdkVersion: null, electron: "", chrome: "", node: "", platform: info.platform, arch: "", userData: "", licenses: [] },
    "app:license": async ({ id }) => ({ text: about ? await about.license(id) : null }),
    "repo:create": async (o) => {
      const r = opened(await b.createRepository(o));
      recents?.remember(r.path);
      changed("create");
      return r;
    },
    "repo:maintenance": async ({ op }) => ({
      opId: runner.start(
        `repo-${op}`,
        { verify: "Verify repository state", gc: "Garbage collection", flush: "Flush pending writes", prune: "Prune stale instances" }[op],
        async (ctx) => {
          const summary = await b.maintenance(op, ctx);
          ctx.progress({ current: 1, total: 1, unit: "items", label: summary });
        },
        { cancellable: false },
      ),
    }),
    "op:cancel": async ({ opId }) => ({ cancelled: runner.cancel(opId) }),
  };
}
