// Working-tree watcher. Lore has no in-core watcher by design: tools report
// changed paths with `lore dirty` (system-design §15.3). We do that, then let
// `status --check-dirty` drop files whose content turned out unchanged.
//
// While an op that writes the working tree runs (sync, reset, switch, clone,
// view), events are suppressed: those writes are Lore's own, not user edits.
import type { Bus } from "./bus";

export interface WatchHandle {
  close(): void;
}
/** Injected so tests don't touch the filesystem. Calls back with repo-relative paths (any separator). */
export type WatchFn = (root: string, onChange: (relPath: string) => void) => WatchHandle;

export interface WatcherDeps {
  bus: Bus;
  watch: WatchFn;
  markDirty(paths: string[]): Promise<void>;
  checkDirty(): Promise<unknown>;
  debounceMs?: number;
  /** After resume(), ignore events for this long (late FS notifications from Lore's own writes). */
  settleMs?: number;
}

const IGNORED = /(^|\/)\.lore(\/|$)/;

export class RepoWatcher {
  private handle: WatchHandle | null = null;
  private pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private paused = 0;
  private quietUntil = 0;
  private flushing: Promise<void> | null = null;

  constructor(private readonly d: WatcherDeps) {}

  start(root: string): void {
    this.stop();
    this.handle = this.d.watch(root, (rel) => this.onChange(rel));
  }

  stop(): void {
    this.handle?.close();
    this.handle = null;
    this.pending.clear();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Suppress events while Lore writes the working tree. Nestable. */
  pause(): void {
    this.paused++;
  }

  resume(): void {
    this.paused = Math.max(0, this.paused - 1);
    if (this.paused === 0) this.quietUntil = Date.now() + (this.d.settleMs ?? 500);
  }

  private onChange(rel: string): void {
    const path = rel.replace(/\\/g, "/").replace(/^\.\//, "");
    if (!path || IGNORED.test(path)) return;
    if (this.paused > 0 || Date.now() < this.quietUntil) return;
    this.pending.add(path);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.d.debounceMs ?? 300);
  }

  /** Exposed for tests. */
  async flush(): Promise<void> {
    if (this.flushing) await this.flushing;
    const paths = [...this.pending];
    this.pending.clear();
    this.timer = null;
    if (!paths.length) return;
    this.flushing = (async () => {
      try {
        await this.d.markDirty(paths);
        await this.d.checkDirty();
        this.d.bus.emit("ws:changed", { reason: "fs" });
      } catch {
        // Logged by the instrumented backend; a failed refresh must not kill the watcher.
      }
    })();
    await this.flushing;
    this.flushing = null;
  }
}

/** Node implementation: recursive fs.watch (Windows, macOS, Linux on Node ≥ 20). */
export const nodeWatch: WatchFn = (root, onChange) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- keep this module importable without Node in tests
  const fs = require("node:fs") as typeof import("node:fs");
  const w = fs.watch(root, { recursive: true }, (_event, file) => {
    if (file) onChange(String(file));
  });
  w.on("error", () => undefined);
  return { close: () => w.close() };
};
