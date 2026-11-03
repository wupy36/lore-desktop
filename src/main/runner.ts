// Runs long ops in the background: owns their AbortControllers, reports
// progress to the transfer queue, and never blocks the IPC reply.
import type { Transfer } from "@shared/types";
import type { Bus } from "./bus";
import { CancelledError, type OpContext, type Progress } from "./lore/LoreBackend";

let seq = 0;

export class OpRunner {
  private running = new Map<string, { ctrl: AbortController; transfer: Transfer }>();

  constructor(private readonly bus: Bus) {}

  /** Start `fn` in the background and return its op id immediately. */
  start(op: string, label: string, fn: (ctx: OpContext) => Promise<unknown>, opts: { cancellable?: boolean; unit?: Transfer["unit"] } = {}): string {
    const id = `${op}-${++seq}`;
    const ctrl = new AbortController();
    const transfer: Transfer = {
      id,
      op,
      label,
      state: "running",
      current: 0,
      total: null,
      unit: opts.unit ?? "items",
      startedAt: Date.now(),
      endedAt: null,
      error: null,
      cancellable: opts.cancellable ?? true,
    };
    this.running.set(id, { ctrl, transfer });
    this.bus.emit("transfer", { ...transfer });

    let lastEmit = 0;
    const ctx: OpContext = {
      signal: ctrl.signal,
      progress: (p: Progress) => {
        Object.assign(transfer, { current: p.current, total: p.total, unit: p.unit }, p.label ? { label: p.label } : {});
        const now = Date.now();
        // Throttle to ~20 Hz so a chatty op can't flood the renderer.
        if (now - lastEmit >= 50 || (p.total !== null && p.current >= p.total)) {
          lastEmit = now;
          this.bus.emit("transfer", { ...transfer });
        }
      },
    };

    const finish = (state: Transfer["state"], error: string | null) => {
      if (transfer.state !== "running") return;
      Object.assign(transfer, { state, error, endedAt: Date.now() });
      this.running.delete(id);
      this.bus.emit("transfer", { ...transfer });
      this.bus.emit("ws:changed", { reason: op });
    };

    void fn(ctx).then(
      () => finish(ctrl.signal.aborted ? "cancelled" : "done", null),
      (e: unknown) => finish(e instanceof CancelledError || ctrl.signal.aborted ? "cancelled" : "error", e instanceof Error ? e.message : String(e)),
    );
    return id;
  }

  cancel(id: string): boolean {
    const r = this.running.get(id);
    if (!r || !r.transfer.cancellable) return false;
    r.ctrl.abort();
    // Report cancellation now; the backend may take a moment to unwind.
    Object.assign(r.transfer, { state: "cancelled", endedAt: Date.now() });
    this.running.delete(id);
    this.bus.emit("transfer", { ...r.transfer });
    return true;
  }

  cancelAll(): void {
    for (const id of [...this.running.keys()]) this.cancel(id);
  }
}
