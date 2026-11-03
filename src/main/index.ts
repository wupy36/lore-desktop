import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { app, BrowserWindow, dialog, Menu, shell, type MenuItemConstructorOptions } from "electron";
import { createAbout } from "./about";
import { Bus, LogHistory } from "./bus";
import { buildDiffCommand } from "./externalDiff";
import { createHandlers, type Handlers } from "./handlers";
import { registerIpc } from "./ipc";
import { CliBackend } from "./lore/CliBackend";
import { instrument } from "./lore/instrument";
import type { LoreBackend } from "./lore/LoreBackend";
import { MockBackend } from "./lore/MockBackend";
import { OpRunner } from "./runner";
import { SettingsStore } from "./settings";
import { nodeWatch, RepoWatcher } from "./watcher";

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

interface MenuCtx {
  handlers: Handlers;
  settings: SettingsStore;
  bus: Bus;
}

function buildMenu({ handlers, settings, bus }: MenuCtx): void {
  const fail = (title: string) => (e: unknown) => dialog.showErrorBox(title, e instanceof Error ? e.message : String(e));
  const open = (path: string) => handlers["repo:open"]({ path }).catch(fail("Open repository"));
  const ui = (command: "preferences" | "about" | "createRepository" | "openRepository") => bus.emit("ui:command", { command });
  const maint = (op: "verify" | "gc" | "flush" | "prune") => () => void handlers["repo:maintenance"]({ op }).catch(fail("Repository"));
  const recent: MenuItemConstructorOptions[] = settings.get().recentRepos.map((p) => ({ label: p, click: () => void open(p) }));
  const template: MenuItemConstructorOptions[] = [
    {
      label: "&File",
      submenu: [
        { label: "&Open repository…", accelerator: "CmdOrCtrl+O", click: () => void handlers["repo:pick"](undefined).catch(fail("Open repository")) },
        { label: "Open &recent", submenu: recent.length ? recent : [{ label: "(none)", enabled: false }] },
        { label: "&New repository…", accelerator: "CmdOrCtrl+Shift+N", click: () => ui("createRepository") },
        { type: "separator" },
        { label: "&Preferences…", accelerator: "CmdOrCtrl+,", click: () => ui("preferences") },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { label: "&Edit", submenu: [{ role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    {
      label: "&Repository",
      submenu: [
        { label: "&Verify state", click: maint("verify") },
        { label: "&Garbage collect", click: maint("gc") },
        { label: "&Flush pending writes", click: maint("flush") },
        { label: "&Prune stale instances", click: maint("prune") },
        { type: "separator" },
        {
          label: "Show in file &manager",
          click: () => {
            const r = handlers["repo:current"](undefined);
            void r.then((repo) => repo && shell.openPath(repo.path));
          },
        },
      ],
    },
    {
      label: "&View",
      submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }],
    },
    {
      label: "&Help",
      submenu: [
        { label: "Lore documentation", click: () => void shell.openExternal("https://epicgames.github.io/lore/") },
        { label: "Open settings folder", click: () => void shell.openPath(app.getPath("userData")) },
        { type: "separator" },
        { label: "&About Lore Desktop", click: () => ui("about") },
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
  // Must be set before the SDK loads its native library.
  const libPath = settings.get().prefs.loreLibPath;
  if (libPath && !process.env.LORE_LIB_PATH) process.env.LORE_LIB_PATH = libPath;
  const bus = new Bus();
  const runner = new OpRunner(bus);
  const raw = await createBackend();
  const backend = instrument(raw, bus);
  const logHistory = new LogHistory(bus);
  const repoWatcher = new RepoWatcher({
    bus,
    watch: nodeWatch,
    markDirty: (paths) => backend.markDirty(paths),
    checkDirty: () => backend.status({ checkDirty: true }),
  });
  // The mock repository has no directory on disk.
  const watcher =
    raw.kind === "mock"
      ? undefined
      : {
          pause: () => repoWatcher.pause(),
          resume: () => repoWatcher.resume(),
          start: (root: string) => {
            watchedRoot = root;
            if (!settings.get().prefs.autoRefresh) return repoWatcher.stop();
            try {
              repoWatcher.start(root);
            } catch (e) {
              console.error("watch failed", e);
            }
          },
        };
  let watchedRoot: string | null = null;
  const handlers: Handlers = createHandlers({
    logHistory,
    prefs: { get: () => settings.get().prefs, set: (p) => settings.setPrefs(p) },
    about: createAbout(raw.kind),
    openExternalDiff: async ({ path, source, target }) => {
      const repo = backend.currentRepository();
      if (!repo) throw new Error("No repository open");
      const dir = mkdtempSync(join(tmpdir(), "lore-desktop-diff-"));
      const name = basename(path);
      const base = join(dir, `base_${name}`);
      await backend.exportFile(path, source, base);
      let local = join(repo.path, path);
      if (target) {
        local = join(dir, `target_${name}`);
        await backend.exportFile(path, target, local);
      }
      const { exe, args } = buildDiffCommand(settings.get().prefs.externalDiffTool, { base, local, path });
      const child = spawn(exe, args, { detached: true, stdio: "ignore", windowsHide: false });
      child.on("error", (e) => dialog.showErrorBox("External diff tool", `${exe}: ${e.message}`));
      child.unref();
    },
    watcher,
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
              buildMenu({ handlers, settings, bus });
            },
          },
  });
  registerIpc(handlers, bus, () => win?.webContents ?? null);
  buildMenu({ handlers, settings, bus });
  // Preference side effects that live in main.
  bus.on("prefs:changed", (p) => {
    if (!watcher || !watchedRoot) return;
    if (p.autoRefresh) watcher.start(watchedRoot);
    else repoWatcher.stop();
  });

  // Open on start: explicit --repo, else the mock fixture, else the last repository (if enabled).
  const initial = repoArg ?? (raw.kind === "mock" ? "D:/Lore/ShooterGame" : settings.get().prefs.reopenLastRepo ? settings.get().lastRepo : null);
  if (initial) {
    await backend
      .openRepository(initial)
      .then((r) => watcher?.start(r.path))
      .catch((e: unknown) => {
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
    repoWatcher.stop();
    runner.cancelAll();
    void raw.dispose().finally(() => app.quit());
  });
}

void main();
