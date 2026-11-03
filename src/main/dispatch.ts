// Validate-and-call for one IPC request. Pure (no Electron) so it is unit-testable
// and reusable by in-process harnesses.
import { contract, type Channel, type IpcResponse } from "@shared/ipc";
import type { Handlers } from "./handlers";

export async function dispatch(handlers: Handlers, channel: unknown, raw: unknown): Promise<IpcResponse<unknown>> {
  if (typeof channel !== "string" || !Object.hasOwn(contract, channel)) return { ok: false, error: `Unknown channel: ${String(channel)}` };
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
}
