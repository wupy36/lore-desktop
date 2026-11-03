// LoreApi implemented in-process (no Electron): same handlers + dispatch as
// real IPC. Used by renderer component tests with MockBackend.
import type { LoreApi } from "@shared/bridge";
import { Bus } from "./bus";
import { dispatch } from "./dispatch";
import { createHandlers, type HandlerDeps } from "./handlers";
import { instrument } from "./lore/instrument";
import type { LoreBackend } from "./lore/LoreBackend";
import { OpRunner } from "./runner";

export function createInProcessApi(
  backend: LoreBackend,
  extra: Pick<HandlerDeps, "pickDirectory" | "recents" | "openExternalDiff"> = {},
): { api: LoreApi; bus: Bus; runner: OpRunner } {
  const bus = new Bus();
  const runner = new OpRunner(bus);
  const handlers = createHandlers({ backend: instrument(backend, bus), runner, bus, info: { backend: backend.kind, version: "test", platform: "test" }, ...extra });
  const api: LoreApi = {
    async invoke(channel, input) {
      const r = await dispatch(handlers, channel, input);
      if (!r.ok) throw new Error(r.error);
      return r.value as never;
    },
    on: (event, cb) => bus.on(event, cb),
  };
  return { api, bus, runner };
}
