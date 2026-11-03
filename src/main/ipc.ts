// Electron IPC transport: one invoke channel (zod-validated both ways via
// dispatch) plus a single event channel fanned out from the bus.
import { ipcMain, type WebContents } from "electron";
import { events, IPC_EVENT, IPC_INVOKE, type EventName } from "@shared/ipc";
import type { Bus } from "./bus";
import { dispatch } from "./dispatch";
import type { Handlers } from "./handlers";

export function registerIpc(handlers: Handlers, bus: Bus, getTarget: () => WebContents | null): () => void {
  ipcMain.handle(IPC_INVOKE, (_e, channel: unknown, raw: unknown) => dispatch(handlers, channel, raw));
  const unsubs = (Object.keys(events) as EventName[]).map((name) =>
    bus.on(name, (payload) => {
      const wc = getTarget();
      if (wc && !wc.isDestroyed()) wc.send(IPC_EVENT, name, payload);
    }),
  );
  return () => {
    ipcMain.removeHandler(IPC_INVOKE);
    unsubs.forEach((u) => u());
  };
}
