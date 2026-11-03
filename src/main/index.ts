import { join } from "node:path";
import { app, BrowserWindow, shell } from "electron";
import { Bus } from "./bus";
import { createHandlers } from "./handlers";
import { registerIpc } from "./ipc";
import { CliBackend } from "./lore/CliBackend";
import { instrument } from "./lore/instrument";
import type { LoreBackend } from "./lore/LoreBackend";
import { MockBackend } from "./lore/MockBackend";
import { OpRunner } from "./runner";

const argv = process.argv;
const useMock = argv.includes("--mock") || process.env.LORE_DESKTOP_MOCK === "1";
const useCli = argv.includes("--cli");
const repoArg = argv.find((a) => a.startsWith("--repo="))?.slice("--repo=".length);

async function createBackend(): Promise<LoreBackend> {
  if (useMock) return new MockBackend();
  if (useCli) return new CliBackend(process.env.LORE_EXE ?? "lore");
  const { SdkBackend } = await import("./lore/SdkBackend");
  return SdkBackend.create();
}

let win: BrowserWindow | null = null;

async function main() {
  await app.whenReady();
  const bus = new Bus();
  const runner = new OpRunner(bus);
  const raw = await createBackend();
  const backend = instrument(raw, bus);
  const handlers = createHandlers({ backend, runner, bus, info: { backend: raw.kind, version: app.getVersion(), platform: process.platform } });
  registerIpc(handlers, bus, () => win?.webContents ?? null);

  if (useMock) await backend.openRepository(repoArg ?? "D:/Lore/ShooterGame");
  else if (repoArg) await backend.openRepository(repoArg).catch((e: unknown) => console.error("open failed", e));

  win = new BrowserWindow({
    width: 1600,
    height: 960,
    backgroundColor: "#1b1d21",
    title: "Lore Desktop",
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once("ready-to-show", () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) await win.loadURL(devUrl);
  else await win.loadFile(join(__dirname, "../renderer/index.html"));

  app.on("window-all-closed", () => {
    runner.cancelAll();
    void raw.dispose().finally(() => app.quit());
  });
}

void main();
