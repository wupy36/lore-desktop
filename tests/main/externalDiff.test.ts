import { describe, expect, it } from "vitest";
import { buildDiffCommand, splitCommandLine } from "../../src/main/externalDiff";

describe("external diff command", () => {
  it("splits quoted Windows paths and keeps backslashes", () => {
    expect(splitCommandLine('"C:\\Program Files\\Beyond Compare 4\\BCompare.exe" "{base}" "{local}" /ro')).toEqual(["C:\\Program Files\\Beyond Compare 4\\BCompare.exe", "{base}", "{local}", "/ro"]);
    expect(splitCommandLine('code --diff {base} {local}')).toEqual(["code", "--diff", "{base}", "{local}"]);
    expect(splitCommandLine('tool ""')).toEqual(["tool", ""]);
    expect(() => splitCommandLine('tool "unterminated')).toThrow(/quote/);
  });

  it("substitutes per argument so spaces in temp paths stay one arg", () => {
    const r = buildDiffCommand('"C:\\BC\\BCompare.exe" "{base}" "{local}" /title1="{path}"', { base: "C:\\Temp\\a b\\base_x.uasset", local: "D:\\Repo\\x.uasset", path: "Content/x.uasset" });
    expect(r).toEqual({ exe: "C:\\BC\\BCompare.exe", args: ["C:\\Temp\\a b\\base_x.uasset", "D:\\Repo\\x.uasset", "/title1=Content/x.uasset"] });
  });

  it("requires a configured template with both placeholders", () => {
    expect(() => buildDiffCommand("", { base: "a", local: "b", path: "p" })).toThrow(/Preferences/);
    expect(() => buildDiffCommand("meld {base}", { base: "a", local: "b", path: "p" })).toThrow(/\{local\}/);
  });
});
