// About screen data and bundled license texts.
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, shell } from "electron";
import type { AboutInfo } from "@shared/types";
import type { BackendKind } from "./lore/LoreBackend";

/** build/licenses in dev; resources/licenses when packaged (electron-builder extraResources). */
function licensesDir(): string {
  return app.isPackaged ? join(process.resourcesPath, "licenses") : join(app.getAppPath(), "build", "licenses");
}

/** Electron ships its own license + Chromium credits next to the executable. */
function electronDir(): string {
  return dirname(process.execPath);
}

const LICENSES: { id: string; title: string; file: () => string; external?: boolean }[] = [
  { id: "app", title: "Lore Desktop (MIT)", file: () => join(licensesDir(), "LICENSE.txt") },
  { id: "third-party", title: "Third-party packages (Lore SDK, React, TanStack, …)", file: () => join(licensesDir(), "THIRD-PARTY-NOTICES.md") },
  { id: "electron", title: "Electron", file: () => join(electronDir(), "LICENSE") },
  { id: "chromium", title: "Chromium and its dependencies (opens in browser)", file: () => join(electronDir(), "LICENSES.chromium.html"), external: true },
];

function sdkVersion(): string | null {
  try {
    return (JSON.parse(readFileSync(join(licensesDir(), "versions.json"), "utf8")) as { sdk?: string }).sdk ?? null;
  } catch {
    return null;
  }
}

export function createAbout(backend: BackendKind) {
  return {
    async info(): Promise<AboutInfo> {
      return {
        app: "Lore Desktop",
        version: app.getVersion(),
        backend,
        sdkVersion: sdkVersion(),
        electron: process.versions.electron ?? "",
        chrome: process.versions.chrome ?? "",
        node: process.versions.node,
        platform: process.platform,
        arch: process.arch,
        userData: app.getPath("userData"),
        licenses: LICENSES.filter((l) => existsSync(l.file()) || (l.id === "electron" && existsSync(join(electronDir(), "LICENSE.electron.txt")))).map(({ id, title, external }) => ({ id, title, external: !!external })),
      };
    },
    async license(id: string): Promise<string | null> {
      const l = LICENSES.find((x) => x.id === id);
      if (!l) return null;
      let file = l.file();
      // Packaged apps name it LICENSE.electron.txt; node_modules/electron/dist names it LICENSE.
      if (l.id === "electron" && !existsSync(file)) file = join(electronDir(), "LICENSE.electron.txt");
      if (l.external) {
        await shell.openPath(file);
        return null;
      }
      return readFile(file, "utf8").catch(() => null);
    },
  };
}
