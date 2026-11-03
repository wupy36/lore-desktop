import { join } from "node:path";
import { app, BrowserWindow, dialog, Menu, shell, type MenuItemConstructorOptions } from "electron";
import { Bus } from "./bus";
import { createHandlers, type Handlers } from "./handlers";
import { registerIpc } from "./ipc";
import { CliBackend } from "./lore/CliBackend";
import { instrument } from "./lore/instrument";
import type { LoreBackend } from "./lore/LoreBackend";
import { MockBackend } from "./lore/MockBackend";
import { OpRunner } from "./runner";
import { SettingsStore } from "./settings";

const argv = process.argv;
const forceMock = argv.includes("--mock") || process.env.LORE_DESKTOP_MOCK === "1";
const useCli = argv.includes("--cli");
const repoArg = argv.find((a) => a.startsWith("--repo="))?.slice("--repo=".length);

let win: BrowserWindow | null = null;

async function createBackend(): Promise<LoreBackend> {
  if (forceMock) return new MockBackend();
  if (useCli) return new CliBackend(process.env.LORE_EXE ?? "lore");
  try {
    const { SdkBackend } = await import("./lore/SdkBackend");
    return await SdkBackend.create();
  } catch (e) {
    // A launched app has no terminal: explain and offer the demo instead of dying.
    const detail = `${e instanceof Error ? e.message : String(e)}\n\nSet LORE_LIB_PATH to the Lore library to override its location.`;
    const { response } = await dialog.showMessageBox({
      type: "error",
      title: "Lore Desktop",
      message: "The Lore library could not be loaded.",
      detail,
      buttons: ["Run in demo (mock) mode", "Quit"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 1) {
      app.exit(1);
    }
    return new MockBackend();
  }
}

function buildMenu(handlers: Handlers, settings: SettingsStore): void {
  const open = (path: string) =>
    handlers["repo:open"]({ path }).catch((e: unknown) => dialog.showErrorBox("Open repository", e instanceof Error ? e.message : String(e)));
  const recent: MenuItemConstructorOptions[] = settings.get().recentRepos.map((p) => ({ label: p, click: () => void open(p) }));
  const template: MenuItemConstructorOptions[] = [
    {
      label: "&File",
      submenu: [
        {
          label: "&Open repository…",
          accelerator: "CmdOrCtrl+O",
          click: () =>
            void handlers["repo:pick"](undefined).catch((e: unknown) => dialog.showErrorBox("Open repository", e instanceof Error ? e.message : String(e))),
        },
        { label: "Open &recent", submenu: recent.length ? recent : [{ label: "(none)", enabled: false }] },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { label: "&Edit", submenu: [{ role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    {
      label: "&View",
      submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }],
    },
    {
      label: "&Help",
      submenu: [
        { label: "Lore documentation", click: () => void shell.openExternal("https://epicgames.github.io/lore/") },
        { label: "Open settings folder", click: () => void shell.openPath(app.getPath("userData")) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function main() {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on("second-instance", () => {
    if (win?.isMinimized()) win.restore();
    win?.focus();
  });

  await app.whenReady();
  const settings = new SettingsStore(app.getPath("userData"));
  const bus = new Bus();
  const runner = new OpRunner(bus);
  const raw = await createBackend();
  const backend = instrument(raw, bus);
  const handlers = createHandlers({
    backend,
    runner,
    bus,
    info: { backend: raw.kind, version: app.getVersion(), platform: process.platform },
    pickDirectory: async () => {
      const opts = { title: "Open Lore repository", properties: ["openDirectory" as const] };
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
    recents:
      raw.kind === "mock"
        ? undefined
        : {
            list: () => settings.get().recentRepos,
            remember: (p) => {
              settings.rememberRepo(p);
              buildMenu(handlers, settings);
            },
          },
  });
  registerIpc(handlers, bus, () => win?.webContents ?? null);
  buildMenu(handlers, settings);

  // Open on start: explicit --repo, else the mock fixture, else the last repository.
  const initial = repoArg ?? (raw.kind === "mock" ? "D:/Lore/ShooterGame" : settings.get().lastRepo);
  if (initial) {
    await backend.openRepository(initial).catch((e: unknown) => {
      console.error("open failed", e);
      if (!repoArg && raw.kind !== "mock") settings.forgetRepo(initial);
    });
  }

  win = new BrowserWindow({
    width: 1600,
    height: 960,
    backgroundColor: "#1b1d21",
    title: raw.kind === "mock" ? "Lore Desktop — demo data" : "Lore Desktop",
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
