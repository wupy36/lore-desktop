// Per-user app settings in userData/settings.json. Tolerates a missing or
// corrupt file (falls back to defaults) and writes atomically.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { Prefs } from "@shared/types";

const Settings = z.object({
  lastRepo: z.string().nullable().default(null),
  recentRepos: z.array(z.string()).default([]),
  prefs: Prefs.default({}),
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
    if (parsed.success) this.data = parsed.data;
    else {
      // Keep what is valid: a bad pref value must not wipe the recent-repository list.
      const r = (raw ?? {}) as Record<string, unknown>;
      const base = Settings.safeParse({ lastRepo: r.lastRepo, recentRepos: r.recentRepos });
      this.data = base.success ? base.data : Settings.parse({});
    }
  }

  get(): Settings {
    return structuredClone(this.data);
  }

  rememberRepo(path: string): void {
    const recent = [path, ...this.data.recentRepos.filter((p) => p.toLowerCase() !== path.toLowerCase())].slice(0, MAX_RECENT);
    this.data = { ...this.data, lastRepo: path, recentRepos: recent };
    this.save();
  }

  setPrefs(patch: Partial<Prefs>): Prefs {
    this.data = { ...this.data, prefs: Prefs.parse({ ...this.data.prefs, ...patch }) };
    this.save();
    return structuredClone(this.data.prefs);
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
