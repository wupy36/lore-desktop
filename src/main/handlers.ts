// Channel -> backend call table. Pure (no Electron), so the same handlers
// back real IPC (ipc.ts) and in-process test harnesses.
import type { Channel, In, Out } from "@shared/ipc";
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
  /** Recent-repository persistence (Electron userData). */
  recents?: { list(): string[]; remember(path: string): void };
}

export function createHandlers({ backend: b, runner, bus, info, openExternalDiff, pickDirectory, recents }: HandlerDeps): Handlers {
  const changed = (reason: string) => bus.emit("ws:changed", { reason });
  return {
    "app:info": async () => info,
    "repo:open": async ({ path }) => {
      const r = await b.openRepository(path);
      recents?.remember(path);
      changed("open");
      return r;
    },
    "repo:current": async () => b.currentRepository(),
    "repo:pick": async () => {
      const path = pickDirectory ? await pickDirectory() : null;
      if (!path) return null;
      const r = await b.openRepository(path);
      recents?.remember(path);
      changed("open");
      return r;
    },
    "repo:recent": async () => recents?.list() ?? [],
    "repo:clone": async (o) => ({ opId: runner.start("clone", `Clone ${o.url}`, (ctx) => b.cloneRepository(o, ctx), { unit: "files" }) }),
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
      await b.reset(paths, { purge });
      changed("reset");
      return { ok: true } as const;
    },

    "rev:commit": async ({ message }) => {
      const r = await b.commit(message);
      changed("commit");
      return r;
    },
    "rev:push": async ({ branch }) => ({ opId: runner.start("push", `Push ${branch ?? "current branch"}`, (ctx) => b.push(branch, ctx), { unit: "fragments" }) }),
    "rev:sync": async (o) => ({ opId: runner.start("sync", `Sync ${o.revision ?? "latest"}`, (ctx) => b.sync(o, ctx), { unit: "files" }) }),
    "rev:history": (o) => b.history(o),
    "file:history": ({ path, length }) => b.fileHistory(path, length),
    "file:diff": (o) => b.diff(o),
    "file:openExternalDiff": async (o) => {
      if (!openExternalDiff) throw new Error("No external diff tool configured");
      await openExternalDiff(o);
      return { ok: true } as const;
    },

    "branch:list": () => b.listBranches(),
    "branch:switch": async ({ name, reset }) => ({ opId: runner.start("switch", `Switch to ${name}`, (ctx) => b.switchBranch(name, { reset }, ctx), { unit: "files" }) }),
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
    "view:apply": async ({ rules }) => ({ opId: runner.start("view", "Apply view filter", (ctx) => b.applyView(rules, ctx), { unit: "files" }) }),

    "op:cancel": async ({ opId }) => ({ cancelled: runner.cancel(opId) }),
  };
}
