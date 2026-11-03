// Electron IPC transport: one invoke channel, zod-validated in and out, plus
// a single event channel fanned out from the bus.
import { ipcMain, type WebContents } from "electron";
import { contract, events, IPC_EVENT, IPC_INVOKE, type Channel, type EventName, type IpcResponse } from "@shared/ipc";
import type { Bus } from "./bus";
import type { Handlers } from "./handlers";

export function registerIpc(handlers: Handlers, bus: Bus, getTarget: () => WebContents | null): () => void {
  ipcMain.handle(IPC_INVOKE, async (_e, channel: unknown, raw: unknown): Promise<IpcResponse<unknown>> => {
    if (typeof channel !== "string" || !(channel in contract)) return { ok: false, error: `Unknown channel: ${String(channel)}` };
    const c = channel as Channel;
    const spec = contract[c];
    const parsed = spec.input.safeParse(raw);
    if (!parsed.success) return { ok: false, error: `Invalid input for ${c}: ${parsed.error.message}` };
    try {
      const value = await (handlers[c] as (i: unknown) => Promise<unknown>)(parsed.data);
      const out = spec.output.safeParse(value);
      if (!out.success) return { ok: false, error: `Invalid output from ${c}: ${out.error.message}` };
      return { ok: true, value: out.data };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

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
