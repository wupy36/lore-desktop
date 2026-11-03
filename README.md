# lore-desktop

An open-source, essentials-only desktop GUI for the [Lore](https://github.com/EpicGames/lore) version control system. Dense, dark-first, multi-pane, table-centric — layout inspired by P4V, semantics strictly Lore's.

> Status: Phase 3 + Step B. On a real repository (SDK backend): open/clone/create, full file tree, status with FS-watcher refresh, stage/unstage/reset, commit, push, sync, history, file history, text/binary diff, branches (create/switch/protect/archive), account & commit identity, working-copy health, command palette. Locks and views (Phase 4) run on mock data only. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Install on Windows

Download the installer from the **windows** workflow in the Actions tab, or build it with `pnpm dist:win:native`. See [docs/BUILD-WINDOWS.md](docs/BUILD-WINDOWS.md).

## Run from source

```bash
pnpm install
pnpm dev:mock          # dev server + Electron, mock data, no Lore install needed
pnpm build && pnpm start:mock
```

Against a real repository (SDK backend, default):

```bash
pnpm build
npx electron . --repo=/path/to/lore/repository
```

Flags: `--mock` (fixtures), `--cli` (spawn `lore`, override with `LORE_EXE`), `--repo=<path>`. Without `--repo` the app reopens the last repository or shows *Open repository…* (Ctrl+O).

Package: `pnpm dist:win:native` (on Windows: NSIS installer + portable exe), `pnpm dist:dir` (unpacked app for the current OS).

## Check

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Integration tests against a real Lore server (for example the demo server, `loreserver` with no config):

```bash
LORE_IT_REMOTE=lore://127.0.0.1:41337 pnpm test:it
```

Smoke tests on the built app (need a display; use `xvfb-run -a` on headless Linux):

```bash
node scripts/smoke-mock.cjs mock.png
node scripts/smoke-sdk.cjs /path/to/repo sdk.png
node scripts/smoke-sdk-loop.cjs /path/to/repo loop.png   # edit -> watcher -> stage -> commit -> push
```

## Hotkeys

| Key | Action |
| --- | --- |
| F5 | Refresh (`lore status --scan`) |
| Ctrl+Shift+S | Sync |
| Ctrl+Shift+P | Push |
| Ctrl+O | Open repository |
| Ctrl+Shift+N | New repository |
| Ctrl+, | Preferences |
| Ctrl+K | Command palette |
| Ctrl+Enter | Commit (in message box) |
| ↑/↓, PgUp/PgDn, Home/End (+Shift) | Move / extend selection in file table |
| Ctrl+A | Select all |
| Enter | Diff selected file |

## Layout

```
src/shared/   Lore-free DTOs (zod), IPC contract, CLI argv builders
src/main/     Electron main: IPC dispatch, op runner, event bus
  lore/       LoreBackend interface + Sdk/Cli/Mock backends (only place Lore is touched)
src/preload/  contextBridge (typed invoke/on)
src/renderer/ React UI
spike/        Phase 0 SDK spikes
docs/         ARCHITECTURE.md
```

## License

MIT
