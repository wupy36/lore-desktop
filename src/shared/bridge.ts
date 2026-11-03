// Zod-free bits of the IPC contract, safe to import from the sandboxed preload.
import type { Channel, EventName, EventPayload, In, Out } from "./ipc";

export const IPC_INVOKE = "lore:invoke";
export const IPC_EVENT = "lore:event";

export type IpcResponse<T> = { ok: true; value: T } | { ok: false; error: string };

/** API exposed on `window.lore` by the preload script (and by test harnesses). */
export interface LoreApi {
  invoke<C extends Channel>(channel: C, input: In<C>): Promise<Out<C>>;
  on<E extends EventName>(event: E, cb: (payload: EventPayload<E>) => void): () => void;
}
