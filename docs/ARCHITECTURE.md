# lore-desktop architecture

An essentials-only, P4V-inspired desktop GUI for [Lore](https://github.com/EpicGames/lore). Lore is pre-1.0, so every Lore call goes through one adapter interface (`LoreBackend`) and nothing outside `src/main/lore/` knows Lore's API shapes.

## 1. Sources read

All facts below were checked against these sources (local clones at session time; Lore `main` @ `b8fc623`, lore-js `main` @ `1954191`):

| Source | Link |
| --- | --- |
| System design | [docs/explanation/system-design.md](https://github.com/EpicGames/lore/blob/main/docs/explanation/system-design.md) — §6 API-first, §12 sparseness, §15 state detection & staging |
| Glossary | [docs/glossary.md](https://github.com/EpicGames/lore/blob/main/docs/glossary.md) |
| CLI command reference | [docs/reference/lore-cli-commands.md](https://github.com/EpicGames/lore/blob/main/docs/reference/lore-cli-commands.md) (generated from CLI `0.10.1-nightly`) |
| Run commands through the background service | [docs/tutorials/run-commands-through-the-service.md](https://github.com/EpicGames/lore/blob/main/docs/tutorials/run-commands-through-the-service.md) |
| Roadmap | [docs/roadmap.md](https://github.com/EpicGames/lore/blob/main/docs/roadmap.md) |
| Quickstart / demo server | [docs/tutorials/quickstart.md](https://github.com/EpicGames/lore/blob/main/docs/tutorials/quickstart.md), [scripts/install.sh](https://github.com/EpicGames/lore/blob/main/scripts/install.sh) |
| C API (canonical) | [lore-capi/lore.h](https://github.com/EpicGames/lore/blob/main/lore-capi/lore.h) |
| JS SDK | [EpicGames/lore-js README](https://github.com/EpicGames/lore-js#readme), [examples/esm/example.ts](https://github.com/EpicGames/lore-js/blob/main/examples/esm/example.ts), [example-native.ts](https://github.com/EpicGames/lore-js/blob/main/examples/esm/example-native.ts), installed `@lore-vcs/sdk@0.12.0` typings |

Published docs site: <https://epicgames.github.io/lore/>.

## 2. Verified Lore model (what the GUI must respect)

- **The C header is the API; everything else wraps it.** The CLI is "one application that uses the API" (system-design §6.1). Every op the GUI needs exists as an `_async` C function and as a fluent JS method.
- **Filesystem is ground truth; no checkout step.** Edits need no "open for edit". Each working-tree node has two *orthogonal* local flags, **dirty** and **staged**, plus one action (glossary *Dirty*, *Stage*; system-design §15.2).
- **`status` does not walk the disk by default.** It reports the staged revision and files already marked dirty. `--scan` walks and reconciles; `--check-dirty` re-verifies only dirty files and clears ones whose content matches (CLI ref `lore status`).
- **Directory staging only stages files already marked dirty**; single-file paths are always checked against disk; `stage --scan` does both in one pass (CLI ref `lore stage`).
- **Staging pins the path, not the content** — the commit captures the file as it is at commit time (glossary *Stage (v)*).
- **Commit is local; push is separate.** `commit` produces a revision; `push` (alias of `branch push`) sends it. The SDK method is `branchPush`.
- **Sync ≠ "get latest" only.** `sync` fetches new remote revisions and *merges them with the local latest* (glossary *Sync*). `--reset` discards local modifications to match incoming; `--view <file>` changes the materialized subset.
- **Revision identifiers**: full 64-char hash, `[branch]@<n>`, `[branch]@LATEST`, `<branch>@<hash>`, optional `~<count>`. Partial hashes are *not* identifiers (glossary).
- **Locks are advisory.** "The storage, push, and merge paths never consult them" (glossary *Lock*); the roadmap lists enforcement as in-progress work. The UI labels locks "(advisory)".
- **View filter** = `.lore/view`, glob-based, per instance, applied on every materialization; changed with `sync --view <file>` (system-design §12.2). Not committed, not cloned.
- **Repository instance** = a working directory with its own view and staged state, id in `.lore/instance`; `repository instance list` enumerates them.
- **Background service**: `lore service set-executable <path>` + `set-use-automatically true` relays *CLI* commands to a per-user service over a local socket; `LORE_USE_SERVICE=0` overrides per command; `LORE_SERVICE_SOCKET` isolates a group of processes. Exit code 32 = service unreachable.
- **Event payloads are native memory** freed when the callback returns; copy inside the callback (lore-js README; `lore.h` header comment). FFI events carry binary hashes/ids with `toString()`.
- **No per-call cancellation in the C API.** Only `lore_shutdown()` ("best effort to cancel calls still executing"). See §5.
- **Progress events are per-op** (`REVISION_SYNC_PROGRESS`, `BRANCH_PUSH_FRAGMENT_PROGRESS`, `REPOSITORY_CLONE_PROGRESS`, `FILE_STAGE_PROGRESS`, …); the generic `LORE_EVENT_PROGRESS` payload is a placeholder.
- **Status file event** (`REPOSITORY_STATUS_FILE`): `path, size, action, type, flagStaged, flagDirty, flagConflict*, flagMerged, fromPath`. `LoreFileAction` is `KEEP | ADD | DELETE | MOVE | COPY` — there is **no MODIFY**; "modified" = `KEEP` with dirty/staged set.
- **Unauthenticated (demo) servers record no commit author** (quickstart). `Revision.author` is nullable.

## 3. P4V → Lore concept map (verified)

| P4V idea | Lore (CLI / SDK) | GUI treatment | Notes |
| --- | --- | --- | --- |
| Workspace | Repository instance; `repository clone/info/instance list` · `repositoryClone/Info/InstanceList` | Repository tab → local instances; open by path | ✓ exists |
| Depot / stream tree | `repository list <remote>`, `branch list/info` · `repositoryList`, `branchList` | Repository tab: remote repos + branches | No stream hierarchy; branches are flat named pointers |
| Pending changelist | Staged vs dirty flags; `status [--scan\|--check-dirty]`, `stage`, `unstage`, `dirty` | Changes tab: Staged / Modified (not staged) / Untracked | Single implicit "changelist" (the staged state). No numbered pending changelists — **does not exist** |
| Submit | `commit <msg>` then `push` | Commit and Push are separate buttons; badge "N to push" | ✓ two steps |
| Get Latest | `sync` (`--reset`, `--view`, revision id) · `revisionSync` | Sync (Ctrl+Shift+S) | Sync also merges with local latest |
| Revert | `reset <paths>` (`--purge` deletes untracked) · `fileReset` | Reset (confirm dialog) | Untracked files are only deleted with `--purge` |
| Revert Unchanged | `status --check-dirty` | "Revert unchanged" toolbar button | ✓ |
| Checkout / mark for add / delete | **None.** Detection via `dirty` / `--scan`; delete = remove file, then stage | No checkout UI. F5 runs `status --scan` | P4V-style "open for edit" **does not exist** by design |
| Exclusive lock | `lock acquire/release/status/query` · `lockFileAcquire/Release/Status/Query` | Lock / Release, Lock owner column | **Advisory** — never labelled "enforced" |
| Sparse / hydrate | View filter (`--view`), `clone --prefetch <file>`, `--root-file` + `--dependency-*` on clone/sync | Phase 4: view editor, "include in view", dependency sync | `--prefetch` exists **only on clone**; no standalone prefetch command — "Prefetch" on an existing instance = add to view + `sync --view` |
| File history / revision graph | `file history`, `revision history/info`, `file audit` · `fileHistory`, `revisionHistory`, `revisionInfo`, `fileAudit` | Detail pane history list | Graph view not in scope |
| Diff | `file diff`, `revision diff`, `branch diff` · `fileDiff`, `revisionDiff`, `branchDiff` | Inline unified diff (text); metadata + external tool (binary) | Binary detection is a GUI heuristic (extension) — Lore has no "is binary" flag in status |

Non-goals (shown as "resolve via CLI" with the exact command): merge/cherry-pick/revert conflicts, e.g. `lore branch merge resolve mine <path>`, `lore branch merge resolve theirs <path>`, `lore branch merge abort`.

## 4. Architecture

```
┌────────────── renderer (sandboxed, contextIsolation, no Node) ──────────────┐
│ React 18 · TanStack Table/Virtual/Query · Zustand (UI state only)          │
│ window.lore.invoke(channel, input) / window.lore.on(event, cb)             │
└───────────────────────────────▲──────────────────────────────────────────────┘
                 preload: contextBridge (0.6 kB, zod-free)
┌───────────────────────────────┴───────────── main ──────────────────────────┐
│ ipc.ts → dispatch.ts (zod-validate input AND output) → handlers.ts          │
│ runner.ts  long ops → op id, AbortController, throttled transfer events     │
│ bus.ts     log / transfer / ws:changed  ──► webContents.send                │
│ lore/instrument.ts  Proxy: logs every call + equivalent `lore …` command    │
│ lore/LoreBackend.ts  ◄── SdkBackend (default) · CliBackend · MockBackend    │
│                         └ mappers.ts: SDK events → shared DTOs (in-callback)│
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Contract**: `src/shared/ipc.ts` — every channel has `{ input, output }` zod schemas; DTOs in `src/shared/types.ts` are Lore-free. `contract covers every handler` is a test.
- **Type isolation**: ESLint `no-restricted-imports` forbids `@lore-vcs/sdk*` everywhere except `SdkBackend.ts` and `mappers.ts` (verified: a stray import fails lint).
- **SDK loading**: dynamic `import()` in `SdkBackend.create()`; the SDK is externalized from the main bundle. `--mock` never loads the native library.
- **Backend selection**: `--mock` (or `LORE_DESKTOP_MOCK=1`) → MockBackend; `--cli` → CliBackend (`LORE_EXE` overrides the executable); default → SdkBackend. `--repo=<path>` opens a repository at start.
- **Long ops** (sync, push, clone, branch switch, apply view) return `{ opId }` immediately; progress flows through `transfer` events (≤20 Hz), completion emits `ws:changed`, which the renderer debounces (100 ms) into query invalidation.
- **Console log**: every backend call → `LogEntry { backend, op, command, args, durationMs, ok, message }`. `command` is the equivalent CLI line from `src/shared/commands.ts`, which CliBackend also uses to build argv — one source of truth.
- **Pure core for tests**: `bus`, `runner`, `dispatch`, `handlers`, `MockBackend` have no Electron/Node imports; `inProcessApi.ts` wires them into a `LoreApi` so component tests run the real App against the real handlers + zod validation.

## 5. Decisions and deviations

- **Cancellation.** Lore's C API has no per-call cancel. SdkBackend "cancel" marks the transfer cancelled and drops the result; the native call runs to completion. CliBackend kills the child process. MockBackend honours `AbortSignal`. Transfers carry `cancellable` so the UI only offers Cancel where it is meaningful (Phase 2 sets SDK ops to `cancellable: false` unless we route them via CLI).
- **Full file listing.** `status` reports only changed nodes. A P4V-style "all files" table needs the tree: Phase 2 plan is `revisionTreeListChildren` (SDK) merged with status, falling back to an FS walk filtered by `.loreignore`. Phase 1 SdkBackend lists changed files only.
- **FS watcher** (Phase 2): main-process recursive watcher → `fileDirty` for touched paths (Lore's own recommended path for editors/tools, system-design §15.3) + debounced `status` refresh. Not built yet.
- **Background service**: only affects the CLI backend (the SDK links the library in-process). CliBackend works unchanged when the user has enabled `lore service set-use-automatically true`.
- **Versions pinned exactly**, deliberately conservative (React 18.3.1, TanStack Table 8.20.5, zod 3.23.8, Vite 5.4.11, electron-vite 2.3.0, Electron 33.2.1, TypeScript 5.7.2). Newer majors exist (React 19, Table 9, zod 4, Vite 8); upgrading is a separate, mechanical step. `@lore-vcs/sdk` pinned to **0.12.0** (latest on npm).
- **Version skew**: CLI reference is generated from CLI 0.10.1; npm SDK is 0.12.0; the locally built CLI/server is 0.12.1-nightly. The commands used here exist in all three.
- **Mock fixtures** are generated from a seeded PRNG (`src/main/lore/mock/fixtures.ts`, ~12k files) instead of a large committed JSON file.
- **Sandboxed preload** must be CJS and dependency-free, so the zod-free bridge constants live in `src/shared/bridge.ts`.
- **Tauri alternative** not pursued: the Electron spike passed. Tradeoff for the record: Tauri 2 gives a much smaller binary and a Rust backend that could link `lore-capi` natively (no koffi), at the cost of a second language and losing the official JS SDK.

## 6. Phase 0 spike result

**Goal:** prove `@lore-vcs/sdk` loads in Electron main and runs `repositoryStatus`.

Environment: Linux x64 cloud container (Node 22.23.4, Electron 33.2.1 / Node 20.18.1), `@lore-vcs/sdk@0.12.0` + `@lore-vcs/sdk-amd64-unknown-linux` (koffi 2.16.2).

| Test | Node 22 | Electron 33 main | Script |
| --- | --- | --- | --- |
| Load SDK, offline `repositoryCreate` → write 2 files → `repositoryStatus({ staged, scan })` | **PASS** (25 ms) | **PASS** (103 ms) | `spike/sdk-spike.mjs` |
| Online vs local `loreserver`: `repositoryCreate(lore://…)` → `fileStage` → `revisionCommit` → `branchPush` → `repositoryClone` → clean `repositoryStatus` | **PASS** | **PASS** | `spike/sdk-spike-online.mjs` |
| Real app (`out/`), SdkBackend, `--repo=<cli-created repo>`, F5 (`status --scan`) | — | **PASS**: table shows `Source/main.cpp` staged, `Source/new.h` untracked, branch `main@1` — identical to `lore status --scan` | `scripts/smoke-sdk.cjs` |

Electron main output (offline):

```text
[spike +33ms] runtime { node: '20.18.1', electron: '33.2.1', platform: 'linux', arch: 'x64' }
[spike +83ms] repositoryCreate ok 01a1a1e2802b765693d163687c1a81fe
[spike +103ms] repositoryStatus rc 0 COMPLETE.status 0
[spike +103ms] status files [{"path":"hello.txt","size":11,"action":1,"staged":false,"dirty":true},{"path":"asset.bin","size":4096,"action":1,"staged":false,"dirty":true}]
[spike +111ms] SPIKE PASS
```

Electron main output (online):

```text
[online +26ms] repositoryCreate { rc: 0, status: 0, progressEvents: 0 }
[online +37ms] fileStage { rc: 0, status: 0, progressEvents: 0 }
[online +48ms] revisionCommit { rc: 0, status: 0, progressEvents: 2 }
[online +67ms] branchPush { rc: 0, status: 0, progressEvents: 1 }
[online +88ms] repositoryClone { rc: 0, status: 0, progressEvents: 3 }
[online +95ms] repositoryStatus(clone) { rc: 0, status: 0, progressEvents: 0 }
[online +95ms] clone contents [ 'asset.bin', 'readme.txt' ] clean status files []
[online +115ms] ONLINE SPIKE PASS
```

**Demo server.** The README install script (`install.sh --demo`) downloads from GitHub Releases, which this container's proxy blocks (HTTP 403). Substitute: built `loreserver` and `lore` (0.12.1-nightly) from source with `cargo build --release -p lore-server -p lore-client` and started `loreserver` with no config — the same thing `--demo` does (single node, self-signed cert, temp store; QUIC/gRPC on 41337, HTTP health on 41339).

**Windows: UNTESTED.** No Windows host was available. The SDK ships `@lore-vcs/sdk-amd64-unknown-windows`; nothing in the spike is platform-specific. To verify on Windows:

```powershell
$env:LORE_DEMO=1; irm https://raw.githubusercontent.com/EpicGames/lore/main/scripts/install.ps1 | iex
cd lore-desktop\spike; npm install
npx electron sdk-spike.mjs
npx electron sdk-spike-online.mjs lore://127.0.0.1:41337
```

Observations: Electron 33 warns `--use-openssl-ca is not supported` when that `NODE_OPTIONS` flag is set in the environment (harmless). pnpm 10 needs `koffi` in `onlyBuiltDependencies`.

## 7. Phase status

### Phase 1 (skeleton) — done

Verified:
- `pnpm typecheck`, `pnpm lint`, `pnpm test` (45 tests: adapters, mappers, IPC contract/dispatch, runner/cancel, selectors, stores, MockBackend-driven App and FileTable component tests) all green.
- `scripts/smoke-mock.cjs` on the built app under Xvfb: 12,012-row table with ~50 DOM rows (virtualized), context-menu Stage, Enter → inline diff, Ctrl+Shift+S → transfer queue, console log populated, no renderer errors.

Untested / not built yet:
- Windows and macOS (Linux only so far).
- SdkBackend beyond open/status (stage, commit, push, sync, … are stubs that throw "Phase N").
- CliBackend beyond process plumbing.
- Logs emitted before the renderer subscribes (e.g. the startup `openRepository`) are not buffered.
- External diff tool configuration; view-filter editor; FS watcher.
