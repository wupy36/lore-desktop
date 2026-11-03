import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsStore } from "../../src/main/settings";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "lore-desktop-settings-"));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("SettingsStore", () => {
  it("defaults when missing or corrupt", () => {
    expect(new SettingsStore(tmp()).get()).toEqual({ lastRepo: null, recentRepos: [], externalDiffTool: null });
    const d = tmp();
    writeFileSync(join(d, "settings.json"), "{not json");
    expect(new SettingsStore(d).get().recentRepos).toEqual([]);
  });

  it("remembers recents (dedup, case-insensitive, most recent first, capped) and persists", () => {
    const d = tmp();
    const s = new SettingsStore(d);
    for (let i = 0; i < 12; i++) s.rememberRepo(`C:\\Lore\\R${i}`);
    s.rememberRepo("c:\\lore\\r5");
    const got = new SettingsStore(d).get();
    expect(got.lastRepo).toBe("c:\\lore\\r5");
    expect(got.recentRepos[0]).toBe("c:\\lore\\r5");
    expect(got.recentRepos.length).toBe(10);
    expect(got.recentRepos.filter((p) => p.toLowerCase() === "c:\\lore\\r5").length).toBe(1);
    expect(JSON.parse(readFileSync(join(d, "settings.json"), "utf8")).lastRepo).toBe("c:\\lore\\r5");
  });

  it("forgets a repo that failed to open", () => {
    const s = new SettingsStore(tmp());
    s.rememberRepo("/a");
    s.forgetRepo("/a");
    expect(s.get()).toMatchObject({ lastRepo: null, recentRepos: [] });
  });
});
