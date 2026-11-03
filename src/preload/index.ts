// Sandboxed preload: exposes only a typed invoke/subscribe API.
import { contextBridge, ipcRenderer } from "electron";
import { IPC_EVENT, IPC_INVOKE, type IpcResponse, type LoreApi } from "@shared/ipc";

const api: LoreApi = {
  async invoke(channel, input) {
    const r = (await ipcRenderer.invoke(IPC_INVOKE, channel, input)) as IpcResponse<never>;
    if (!r.ok) throw new Error(r.error);
    return r.value;
  },
  on(event, cb) {
    const listener = (_e: unknown, name: string, payload: unknown) => {
      if (name === event) cb(payload as never);
    };
    ipcRenderer.on(IPC_EVENT, listener);
    return () => ipcRenderer.removeListener(IPC_EVENT, listener);
  },
};

contextBridge.exposeInMainWorld("lore", api);
