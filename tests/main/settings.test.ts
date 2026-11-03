import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsStore } from "../../src/main/settings";
import { defaultPrefs } from "@shared/types";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "lore-desktop-settings-"));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("SettingsStore", () => {
  it("defaults when missing or corrupt", () => {
    expect(new SettingsStore(tmp()).get()).toEqual({ lastRepo: null, recentRepos: [], prefs: defaultPrefs() });
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

  it("persists prefs and validates them", () => {
    const d = tmp();
    const s = new SettingsStore(d);
    expect(s.setPrefs({ theme: "light", fontSize: 14 })).toMatchObject({ theme: "light", fontSize: 14, density: "compact" });
    expect(new SettingsStore(d).get().prefs).toMatchObject({ theme: "light", fontSize: 14 });
    expect(() => s.setPrefs({ fontSize: 99 })).toThrow();
  });

  it("a corrupt pref value does not wipe recent repositories", () => {
    const d = tmp();
    writeFileSync(join(d, "settings.json"), JSON.stringify({ lastRepo: "/a", recentRepos: ["/a", "/b"], prefs: { theme: "neon" } }));
    const got = new SettingsStore(d).get();
    expect(got.recentRepos).toEqual(["/a", "/b"]);
    expect(got.prefs).toEqual(defaultPrefs());
  });
});
