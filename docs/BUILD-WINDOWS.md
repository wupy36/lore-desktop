# Windows: install or build Lore Desktop

Lore Desktop ships for Windows as two files:

| File | What it is |
| --- | --- |
| `LoreDesktop-<version>-setup-x64.exe` | Installer (per-user, no admin). Adds Start-menu and desktop shortcuts and an uninstaller. |
| `LoreDesktop-<version>-portable-x64.exe` | Single exe, no install. Settings still go to `%APPDATA%\Lore Desktop`. |

Requirements: Windows 10 or 11, **x64**. The Lore SDK ships only an x64 Windows library, so Windows on ARM is not supported.

## Option A: download a CI build

1. Open the repository's **Actions** tab, then the **windows** workflow, then the latest green run.
2. Download the **LoreDesktop-windows-x64** artifact and unzip it.
3. Run `LoreDesktop-…-setup-x64.exe` (or the portable exe).

The builds are **unsigned**, so SmartScreen shows "Windows protected your PC". Click **More info → Run anyway**.

## Option B: build it yourself on Windows

Prerequisites (one-time), in PowerShell:

```powershell
winget install Git.Git OpenJS.NodeJS.LTS
```

```powershell
corepack enable
```

You do not need Visual Studio, Python, or Rust: `koffi` and the Lore library come prebuilt.

Build:

```powershell
git clone https://github.com/wupy36/lore-desktop.git
```

```powershell
cd lore-desktop
```

```powershell
pnpm install
```

```powershell
pnpm dist:win:native
```

The output lands in `dist\`:

- `dist\LoreDesktop-0.1.0-setup-x64.exe`: the installer
- `dist\LoreDesktop-0.1.0-portable-x64.exe`: the portable exe
- `dist\win-unpacked\Lore Desktop.exe`: the app without an installer (handy for testing)

Optional check before packaging:

```powershell
pnpm typecheck; pnpm lint; pnpm test
```

> Building the Windows installer from Linux/macOS needs wine (NSIS). Without wine, `pnpm dist:win` still produces a runnable `dist/win-unpacked/` and then stops. Use Windows or CI for the installer.

## Using the app

- **First launch** shows *Open repository…* (Ctrl+O). Pick the folder that contains `.lore`. The app reopens the last repository on its next start; recent repositories are under **File → Open recent**.
- **No repository yet?** Install the Lore CLI and clone one:

  ```powershell
  irm https://raw.githubusercontent.com/EpicGames/lore/main/scripts/install.ps1 | iex
  ```

  ```powershell
  lore clone lore://<server>:41337/<repo> D:\Lore\<repo>
  ```

  To try everything locally, start the demo server (it stays in the foreground; use a second terminal):

  ```powershell
  $env:LORE_DEMO=1; irm https://raw.githubusercontent.com/EpicGames/lore/main/scripts/install.ps1 | iex
  ```

- **Demo mode (no Lore needed):** make a copy of the shortcut, open **Properties**, and append ` --mock` to *Target*, for example `"%LOCALAPPDATA%\Programs\Lore Desktop\Lore Desktop.exe" --mock`. The window title says "demo data".
- Other command-line options (shortcut target or terminal): `--repo=D:\Lore\MyRepo` (open this repository) and `--cli` (use the `lore` CLI instead of the SDK; `LORE_EXE` points at a specific `lore.exe`).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "The Lore library could not be loaded" on start | The installed files are incomplete. Reinstall. To test a different library build, set `LORE_LIB_PATH` to its `lorelib-amd64-unknown-windows.dll`. You can also choose *Run in demo (mock) mode* from the dialog. |
| SmartScreen blocks the exe | The build is unsigned: **More info → Run anyway**. |
| `irm … \| iex` is blocked | `Set-ExecutionPolicy -Scope Process Bypass`, then retry. |
| Firewall prompt for `loreserver.exe` | Allow on private networks. It listens on 41337 (QUIC/UDP + gRPC/TCP) and 41339 (HTTP). |
| `pnpm install` fails on long paths | `git config --global core.longpaths true` and enable Win32 long paths, or clone to a short path like `C:\src`. |
| Built from a copied `node_modules` (WSL/Linux) and the app can't find the DLL | Delete `node_modules` and run `pnpm install` on Windows. The platform library is chosen at install time. |
| Need logs | **View → Toggle DevTools** for renderer errors. Every Lore call is in the app's Console panel. Settings: **Help → Open settings folder**. |

## How the package is put together

- electron-builder (`electron-builder.yml`). Vite bundles main, preload, and renderer into `out/`. The only runtime `node_modules` are `@lore-vcs/sdk`, its Windows platform package (`lorelib-amd64-unknown-windows.dll`), and `koffi`.
- These sit in `resources\app.asar.unpacked\` because koffi has to `LoadLibrary` a real file. The SDK maps `app.asar\node_modules\@lore-vcs\sdk…` to `app.asar.unpacked` itself, which is why the repo uses `node-linker=hoisted` (`.npmrc`).
- Code signing is not set up. To add it later, give electron-builder a certificate via `CSC_LINK`/`CSC_KEY_PASSWORD`.
