// Upstream drift guard: the pinned SDK's operation list must match
// src/main/lore/sdkCoverage.ts exactly, and "used" must mean used.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { SDK_COVERAGE } from "../../src/main/lore/sdkCoverage";

const require = createRequire(import.meta.url);
const sdkDts = join(dirname(require.resolve("@lore-vcs/sdk")), "index.d.ts");
const sdkOps = [...readFileSync(sdkDts, "utf8").matchAll(/^\s+(\w+): \(globalArgs: LoreGlobalArgs/gm)].map((m) => m[1] as string);
const backendSrc = readFileSync(join(__dirname, "../../src/main/lore/SdkBackend.ts"), "utf8");
const calledInBackend = new Set([...backendSrc.matchAll(/\.(\w+)\(/g)].map((m) => m[1] as string).filter((n) => sdkOps.includes(n)));

describe("SDK coverage manifest", () => {
  it("parses the SDK operation list", () => {
    expect(sdkOps.length).toBeGreaterThan(100);
  });

  it("classifies every SDK operation (new op in an SDK bump → add it to sdkCoverage.ts)", () => {
    const missing = sdkOps.filter((op) => !(op in SDK_COVERAGE));
    expect(missing, `unclassified SDK operations: ${missing.join(", ")}`).toEqual([]);
  });

  it("lists no operation the SDK no longer has (removed/renamed in an SDK bump)", () => {
    const stale = Object.keys(SDK_COVERAGE).filter((op) => !sdkOps.includes(op));
    expect(stale, `operations gone from the SDK: ${stale.join(", ")}`).toEqual([]);
  });

  it('"used" ⇔ actually called by SdkBackend', () => {
    const usedOps = Object.entries(SDK_COVERAGE).filter(([, c]) => c.status === "used").map(([op]) => op);
    expect(usedOps.filter((op) => !calledInBackend.has(op)), "marked used but not called").toEqual([]);
    expect([...calledInBackend].filter((op) => SDK_COVERAGE[op]?.status !== "used"), "called but not marked used").toEqual([]);
  });

  it("every exclusion has a reason", () => {
    for (const [op, c] of Object.entries(SDK_COVERAGE)) if (c.status === "excluded") expect(c.reason.length, op).toBeGreaterThan(10);
  });
});
