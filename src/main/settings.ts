// Per-user app settings in userData/settings.json. Tolerates a missing or
// corrupt file (falls back to defaults) and writes atomically.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

const Settings = z.object({
  lastRepo: z.string().nullable().default(null),
  recentRepos: z.array(z.string()).default([]),
  /** Command template for binary diffs, e.g. `"C:\\Tools\\diff.exe" "{source}" "{target}"` (Phase 3). */
  externalDiffTool: z.string().nullable().default(null),
});
export type Settings = z.infer<typeof Settings>;

const MAX_RECENT = 10;

export class SettingsStore {
  private data: Settings;
  private readonly file: string;

  constructor(dir: string) {
    this.file = join(dir, "settings.json");
    let raw: unknown = {};
    try {
      raw = JSON.parse(readFileSync(this.file, "utf8"));
    } catch {
      raw = {};
    }
    const parsed = Settings.safeParse(raw);
    this.data = parsed.success ? parsed.data : Settings.parse({});
  }

  get(): Settings {
    return structuredClone(this.data);
  }

  rememberRepo(path: string): void {
    const recent = [path, ...this.data.recentRepos.filter((p) => p.toLowerCase() !== path.toLowerCase())].slice(0, MAX_RECENT);
    this.data = { ...this.data, lastRepo: path, recentRepos: recent };
    this.save();
  }

  forgetRepo(path: string): void {
    this.data = { ...this.data, lastRepo: this.data.lastRepo === path ? null : this.data.lastRepo, recentRepos: this.data.recentRepos.filter((p) => p !== path) };
    this.save();
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }
}
