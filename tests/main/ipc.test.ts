import { describe, expect, it } from "vitest";
import { contract } from "@shared/ipc";
import { createInProcessApi } from "../../src/main/inProcessApi";
import { Bus } from "../../src/main/bus";
import { dispatch } from "../../src/main/dispatch";
import { createHandlers } from "../../src/main/handlers";
import { MockBackend } from "../../src/main/lore/MockBackend";
import { OpRunner } from "../../src/main/runner";
import type { LogEntry, Transfer } from "@shared/types";

const setup = async () => {
  const backend = new MockBackend({ latencyMs: 0, stepMs: 1, progressSteps: 3 });
  await backend.openRepository("D:/Lore/ShooterGame");
  return createInProcessApi(backend);
};

describe("IPC contract", () => {
  it("every handler output validates against its schema", async () => {
    const { api } = await setup();
    // Read-only channels with valid inputs; dispatch validates outputs.
    await api.invoke("app:info", undefined);
    await api.invoke("repo:current", undefined);
    await api.invoke("ws:files", undefined);
    await api.invoke("ws:status", { scan: true });
    await api.invoke("branch:list", undefined);
    await api.invoke("rev:history", { length: 10 });
    await api.invoke("file:history", { path: "Source/Game/Player/HeroMovement.cpp", length: 5 });
    await api.invoke("file:diff", { path: "Source/Game/Player/HeroMovement.cpp" });
    await api.invoke("lock:query", {});
    await api.invoke("auth:info", undefined);
    await api.invoke("view:get", undefined);
    await api.invoke("repo:instances", undefined);
    await api.invoke("repo:remoteList", { remoteUrl: "lore://127.0.0.1:41337" });
  });

  it("rejects unknown channels and invalid input", async () => {
    const backend = new MockBackend({ latencyMs: 0 });
    const bus = new Bus();
    const h = createHandlers({ backend, runner: new OpRunner(bus), bus, info: { backend: "mock", version: "t", platform: "t" } });
    expect(await dispatch(h, "nope", {})).toMatchObject({ ok: false });
    expect(await dispatch(h, "__proto__", {})).toMatchObject({ ok: false });
    expect(await dispatch(h, "ws:stage", { paths: [] })).toMatchObject({ ok: false, error: expect.stringMatching(/Invalid input/) });
    expect(await dispatch(h, "rev:commit", { message: "" })).toMatchObject({ ok: false });
  });

  it("backend errors become ok:false, not throws", async () => {
    const { api } = await setup();
    await expect(api.invoke("file:diff", { path: "missing.txt" })).rejects.toThrow(/not found/);
  });

  it("logs every backend call with its CLI equivalent", async () => {
    const { api, bus } = await setup();
    const logs: LogEntry[] = [];
    bus.on("log", (l) => logs.push(l));
    await api.invoke("ws:stage", { paths: ["Source/Game/Player/HeroMovement.cpp"] });
    await api.invoke("file:diff", { path: "missing.txt" }).catch(() => {});
    expect(logs[0]).toMatchObject({ op: "stage", command: "lore stage Source/Game/Player/HeroMovement.cpp", ok: true, backend: "mock" });
    expect(logs[1]).toMatchObject({ op: "diff", ok: false, level: "error" });
    expect(logs[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("long ops return an op id and stream transfer progress", async () => {
    const { api, bus } = await setup();
    const seen: Transfer[] = [];
    const done = new Promise<void>((res) => bus.on("transfer", (t) => (seen.push(t), t.state !== "running" && res())));
    const { opId } = await api.invoke("rev:sync", {});
    await done;
    expect(seen[0]).toMatchObject({ id: opId, state: "running" });
    expect(seen.at(-1)).toMatchObject({ id: opId, state: "done" });
  });

  it("op:cancel cancels a running op", async () => {
    const backend = new MockBackend({ latencyMs: 0, stepMs: 50, progressSteps: 50 });
    await backend.openRepository("x");
    const { api, bus } = createInProcessApi(backend);
    const states: string[] = [];
    bus.on("transfer", (t) => states.push(t.state));
    const { opId } = await api.invoke("rev:sync", {});
    expect(await api.invoke("op:cancel", { opId })).toEqual({ cancelled: true });
    expect(await api.invoke("op:cancel", { opId })).toEqual({ cancelled: false });
    expect(states.at(-1)).toBe("cancelled");
  });

  it("contract covers every handler", () => {
    const bus = new Bus();
    const h = createHandlers({ backend: new MockBackend(), runner: new OpRunner(bus), bus, info: { backend: "mock", version: "", platform: "" } });
    expect(Object.keys(h).sort()).toEqual(Object.keys(contract).sort());
  });
});
