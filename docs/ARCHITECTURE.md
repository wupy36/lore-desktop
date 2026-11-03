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
| Workspace | Repository instance; `repository clone/info/instance list` · `repositoryClone/Info/InstanceList` | Open repository / recent list (all workspaces); Repository tab → instances of this store | `instance list` only returns instances **sharing this repository's store** (verified: an independent clone is not listed), so the cross-workspace list is the app's own recent list |
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

### Where an operation goes (information-architecture rule)

Adapted from LoreGUI's `docs/INFORMATION-ARCHITECTURE.md`. It keeps the app essentials-only as it grows:

| If the operation is… | Surface |
| --- | --- |
| part of the daily loop (status, stage, commit, push, sync, branch switch, history, diff, lock) | a pane, toolbar button, or hotkey |
| an action on one item (branch protect, file reset, lock release, revision restore) | that item's context or row menu |
| occasional or admin (verify, gc, flush, prune, metadata) | **Repository** menu / Manage group |
| rare, power-user or debugging (dump, store query, bisect) | not in the GUI; use the CLI (later: command palette) |

`src/main/lore/sdkCoverage.ts` records this decision for **every** SDK operation: `used`, `planned` (with where it will live), or `excluded` (with a reason). `tests/main/sdk-coverage.test.ts` fails when an SDK bump adds, removes or renames an operation, or when "used" and the actual calls in `SdkBackend` disagree.

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
- **Full file listing.** `status` reports only changed nodes, so the "all files" table comes from the committed tree via the low-level revision API: `storageOpen({repositoryPath})` → `revisionTreeLoad({store, repository, revisionHash})` → breadth-first `revisionTreeListChildren` (8 in flight) → close both. Status entries are then overlaid (`mergeTreeAndStatus`). The listing is cached per revision hash, since revisions are immutable. No disk walk: `.loreignore` and untracked junk are Lore's business, not the GUI's. Status reports size 0 for unstaged changes (Lore reads no content until stage), so the backend `stat`s just the changed files.
- **FS watcher.** Main-process recursive `fs.watch` (`src/main/watcher.ts`), debounced 300 ms. Changed paths go to `lore dirty` (Lore's recommended path for editors/tools, system-design §15.3), then `status --check-dirty` drops files whose content turns out unchanged. `.lore/` is ignored. The watcher is **paused** around ops that write the working tree (sync, reset, branch switch, clone, view), plus a 500 ms settle period, so Lore's own writes aren't reported as edits.
- **One queue per SdkBackend.** Every SDK call is serialized. Lore takes a repository lock per operation, so a watcher refresh during a sync would only contend. Reads queue behind long ops; the UI shows the last known state meanwhile.
- **Ahead/offline** come from the status revision event (`isLocalAhead`, `revisionLocalNumber`/`revisionRemoteNumber`, `remoteAvailable`, `remoteBranchExist`). The remote URL: `.lore/config.toml` only stores the server root (`remote_url`), so the repository name is found by matching the repository id in `repository list <remote_url>`.
- **Progress mapping** (`mappers.ts`): sync uses files (`fileUpdate+fileDelete` / totals); push, clone and commit use bytes or files. Totals are reported only after `discoveryComplete`, and as indeterminate before that.
- **Background service**: only affects the CLI backend (the SDK links the library in-process). CliBackend works unchanged when the user has enabled `lore service set-use-automatically true`.
- **Versions pinned exactly**, deliberately conservative (React 18.3.1, TanStack Table 8.20.5, zod 3.23.8, Vite 5.4.11, electron-vite 2.3.0, Electron 33.2.1, TypeScript 5.7.2). Newer majors exist (React 19, Table 9, zod 4, Vite 8); upgrading is a separate, mechanical step. `@lore-vcs/sdk` pinned to **0.12.0** (latest on npm).
- **Version skew**: CLI reference is generated from CLI 0.10.1; npm SDK is 0.12.0; the locally built CLI/server is 0.12.1-nightly. The commands used here exist in all three.
- **Mock fixtures** are generated from a seeded PRNG (`src/main/lore/mock/fixtures.ts`, ~12k files) instead of a large committed JSON file.
- **Sandboxed preload** must be CJS and dependency-free, so the zod-free bridge constants live in `src/shared/bridge.ts`.
- **Installers (spec §6 non-goal, lifted at the user's request).** electron-builder produces an NSIS per-user installer and a portable exe for Windows x64 (`electron-builder.yml`, [BUILD-WINDOWS.md](BUILD-WINDOWS.md)). Packaging constraints: koffi must `LoadLibrary` a real file, so `@lore-vcs/**` and `koffi/**` are `asarUnpack`ed. The SDK already rewrites `app.asar/node_modules/@lore-vcs/sdk…` to `app.asar.unpacked` (see `dist/functions/ffi.cjs`), which only matches a hoisted layout, hence `.npmrc` `node-linker=hoisted`. `pnpm.supportedArchitectures` installs the Windows platform package on any host. The builds are unsigned, and auto-update is still a non-goal.
- **Launch without flags.** A packaged app can't rely on `--repo`, so `repo:pick` (native folder dialog) and `repo:recent` were added, settings persist to `userData/settings.json`, and the last repository reopens on start. If the native library fails to load, a dialog offers demo (mock) mode instead of exiting.
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

**Windows: VERIFIED on CI** (`.github/workflows/windows.yml`, `windows-latest`, [run 3](https://github.com/wupy36/lore-desktop/actions/runs/41689263711), commit `77839df`). Lore CLI and `loreserver` 0.12.0 were installed with `install.ps1`.

| Check | Result |
| --- | --- |
| `pnpm typecheck / lint / test` | pass (50 tests) |
| `spike/sdk-spike.mjs` in Electron main (`platform: 'win32', arch: 'x64'`) | **PASS**: `repositoryStatus rc 0`, both files reported dirty |
| `spike/sdk-spike-online.mjs` against the local server | **PASS** |
| `pnpm dist:win:native`: NSIS installer and portable exe | built (`LoreDesktop-0.1.0-setup-x64.exe`, `-portable-x64.exe`) |
| Packaged `Lore Desktop.exe --mock` | pass: 12,012 rows / 51 in DOM, context-menu Stage, no errors |
| Packaged `Lore Desktop.exe --repo=<CLI-created repo>` (SDK backend) | pass: `DesktopDemo · main@1`, `Source/main.cpp` staged, `Source/new.h` untracked |

CI findings: GitHub's Windows runner kills processes a step started when that step ends, so `scripts/ci/start-loreserver.ps1` starts the server inside each step that needs it. electron-builder auto-publishes on CI unless told not to (`--publish never`, `publish: null`).

Not verified on Windows: running the NSIS installer interactively (install, shortcuts, uninstall) and the folder-picker dialog. Those need a desktop session. Manual steps are in [BUILD-WINDOWS.md](BUILD-WINDOWS.md).

**Packaged-app check on Linux.** `pnpm dist:dir`, then `scripts/smoke-mock.cjs --exe=dist/linux-unpacked/lore-desktop` and `scripts/smoke-sdk.cjs --exe=…`, both pass. This shows the SDK loads its native library from `app.asar.unpacked`. A cross-built `dist/win-unpacked` contains `lorelib-amd64-unknown-windows.dll` and koffi `win32_x64` only.

Observations: Electron 33 warns `--use-openssl-ca is not supported` when that `NODE_OPTIONS` flag is set in the environment (harmless). pnpm 10 needs `koffi` in `onlyBuiltDependencies`.

## 7. Phase status

### Step C (revision graph timeline) — done

An Anchorpoint/P4V-style history in the History tab: a graph rail (branch tracks, subway curves for forks and merges, icon nodes) next to commit cards grouped under author headers.

- **Stack note:** the brief described Tauri + Tailwind. This project is Electron + React with CSS tokens, so the same design is built on the existing stack (no Tailwind). Icons come from `lucide-react` 0.462.0 (pinned): `Atom` for commits, `GitMerge` for merges, `CircleDashed` for the working copy.
- **Data:** `rev:graph { scope: current | all, length }`. `SdkBackend.graph` merges `revisionHistory` for each non-archived branch (each continues into its parent branch, so overlaps dedupe by hash) and sorts newest first. It flags `isHead` (the revision the instance is on) and `pending`: unpushed revisions on the current branch (the newest `aheadBy` numbers), and every revision of a branch that exists only locally. Lore revision numbers are **not** unique across branches (main and a feature branch can both have #3), so the graph keys on hashes.
- **Layout** (`src/renderer/graph/layout.ts`, pure, 9 unit tests): lane assignment walks newest → oldest. A revision lands in the lane expecting it, its first parent continues straight down, and extra (merge) parents open lanes to the right. Lanes never shift sideways, so pass-throughs are straight lines. The current branch keeps lane 0 and color 0 (`primaryBranch`). Output is per-row segments (`top|mid → mid|bottom`), so every row draws its own SVG slice. That keeps rails aligned at any row height and works with list virtualization (no full-height overlay). Each segment carries the parent edges running along it (`child>parent`), which is what hover highlighting uses.
- **Rendering:** `RevisionGraphRail` (SVG: straight lines, cubic Bézier curves for lane changes, dashed for pending, filled node for HEAD), `TimelineRow` (author header with initials avatar, name and relative time; or commit card), `LoreTimelineView` (TanStack Virtual with two fixed row heights, scope toggle, hover state, ↑/↓ selection). A *Working copy · N local change(s)* node (dashed) sits above HEAD when there are local changes.
- **Interaction:** hovering a commit thickens its parent edges and dims everything else. Clicking selects it (changed files appear below, and clicking a file diffs it against the parent). The right-click menu copies the hash or identifier or amends the message. Clicking the working-copy node jumps to Changes.
- **Bug found by the new integration test:** `amend` gives the latest revision a new hash, but the backend didn't re-read repo state, so HEAD pointed at a revision that no longer exists. Fixed.

Verified: `pnpm test` (100), `pnpm test:it` (18, incl. graph HEAD/pending/dedupe/order on real Lore). Visually checked on demo data and on a real Lore repository built with the CLI: a feature branch with 3 commits by one author, a commit on main, `lore branch merge feature/statues`, and one unpushed commit. The graph shows the fork, the merge node, the purple feature lane merging back, author grouping and a dashed unpushed HEAD. `smoke-phase3.cjs` now also checks the rail and the hover highlight.

Not done: no inline branch-name labels on the rail (the branch is in the card tooltip). More than ~8 parallel lanes reuse colors. Only the newest 500 revisions are loaded (no paging yet).

### Phase 3 (history, diff, branches) + Step B (account, health, palette) — done

**What the SDK actually returns (verified by probing, not assumed):**
- **History events.** `revisionHistory` / `fileHistory` / `revisionInfo` emit a header event followed by `METADATA` events for that entry: `branch` (a branch *id*), `timestamp` (ms), `message`, and `created-by` / `committed-by` when an identity was set. The header itself has no author or message. `revisionInfo --delta` adds `REVISION_INFO_DELTA` per changed path.
- **Authors.** On an unauthenticated server commits record no author unless an identity is passed. The global `identity` arg (`--identity`) sets `committed-by`. The app exposes it as a preference (Account dialog).
- **`file diff`** returns a unified patch, defaulting to current revision → working tree. Lore diffs *any* file as text: a `.uasset` without NUL bytes yields a multi-hundred-KB patch. So known binary extensions never request a patch. Patches with NUL bytes or over 2 MB are shown as binary, with size and hash for both sides from `file info` (`--local` for the working copy) and the external-diff button.
- **`branch list`** reports each branch twice, once per location (0 = local, 1 = remote), so the app merges them by id and shows *not pushed* / *remote*. It doesn't report protection (shown as unknown) or revision numbers for other branches.
- **`branch create`** creates the branch at the current revision **and switches to it** (quickstart: "Create a branch … and switch your working tree to it"). The UI labels the button *Create & switch*.
- **Auth.** On a server without an auth endpoint (the demo server), `auth user info` fails with error 9, "authentication requires a configured auth endpoint". The Account dialog reports this as "server has no authentication", not as an error. Login uses `authLoginInteractive({ noBrowser: true })`; the `AUTH_URL` event (URL + user code) is shown with a link. **Not exercised against an authenticating server.**
- **Health** comes from the status revision event: `isRemoteAhead` + revision numbers → *N to sync*; `isLocalAhead` → *N to push*; both → *diverged*; non-zero `revisionMerged` → merge pending. Conflict resolution stays "resolve via CLI" with the exact commands (non-goal).

**UI**
- **History tab** (sidebar): virtualized revisions with number, author, date and message. Selecting one shows its changed files; clicking a file diffs it against the parent in the detail pane. Row menu: copy hash/identifier, *Amend message* (latest, unpushed only).
- **Detail pane:** a file-history row click diffs the working copy against that revision. The diff header says what is compared, with *vs working copy* and *External tool* buttons.
- **Branches** (Repository tab): *Create & switch*; double-click to switch; row menu with switch, protect, unprotect, archive, copy name; *not pushed* / *remote* badges.
- **Account** (toolbar 👤): commit identity and where it comes from, server, sign-in state or note, Sign in / Sign out, identity override.
- **Health card** at the top of the Changes tab: offline, N to sync (Sync), N to push (Push), diverged, merge pending / conflicts with CLI commands. Quiet when in sync.
- **Command palette** (Ctrl+K): every toolbar, menu and Manage action plus one *Switch to branch X* per branch, with fuzzy match, the CLI equivalent and shortcuts. Built from the same actions as the toolbar (`src/renderer/commands.ts`), so they can't drift.
- **Repository → Update stored path** (`lore repository update-path`) for moved workspaces.

**Verified**
- Windows CI [run 9](https://github.com/wupy36/lore-desktop/actions/runs/41698670355): green, including the real-Lore integration tests and `smoke-phase3.cjs` against the packaged exe.
- `pnpm test`: **87**. `pnpm test:it` against real Lore: **17**, covering history messages, timestamps, branch names and authors via identity; file history; text diff vs working tree and vs `main@1`; binary diff metadata; revision detail; amend; branch create (switches), list (local/both), switch, protect/unprotect/archive; account no-auth note and identity override; behind-by-1 after the other instance pushes, then sync.
- `scripts/smoke-phase3.cjs` in the real app (SDK backend): History → revision → file → inline diff; file history; account dialog; Create & switch, then palette → *Switch to branch main*. Added to Windows CI against the packaged exe.

**Known gaps**
- **Last revision column** is still empty on real repositories: no listing call returns per-file revision numbers, and per-file `file history` for 10k files is too slow. The detail pane shows it for the selected file.
- **Branch diff, file audit, revision restore and find** are classified "planned" in `sdkCoverage.ts`.
- **Interactive login** is untested against a real auth endpoint.

### Step A (from the LoreGUI comparison) — done

- **Preferences** (File → Preferences, Ctrl+,, toolbar ⚙). Options: theme (dark/light/system), font size, row density, reopen last repository, auto-refresh (watcher on/off), confirm before Reset, Sync discards local modifications (`sync --reset`), external diff tool, Lore library path. Stored in `userData/settings.json` under `prefs`, validated with zod; a bad value resets prefs only, never the recent-repository list.
- **External diff tool.** Command template with `{base}` `{local}` `{path}`. The base is exported with `lore file write` (`SdkBackend.exportFile`) to a temp folder; paths with spaces stay one argument. Reachable from the file context menu and the binary diff view.
- **About + licenses** (Help → About). Shows app, SDK, Electron, Chromium and Node versions and the settings folder. Licenses: the app, third-party npm packages (generated by `scripts/gen-licenses.mjs` on every build: 17 packages incl. the Lore SDK and its platform libraries' notices), Electron, Chromium (opened externally). Packaged under `resources/licenses`.
- **New repository** (File → New repository…, Ctrl+Shift+N, first-run screen). `lore repository create`: local-only (`--offline <name>`) or on a server (`<server>/<name>`).
- **Repository menu / Manage group:** verify state, garbage collect, flush, prune stale instances (run as transfers), plus show in file manager.
- **Error boundary:** a render crash shows the error with Reload / Copy details instead of a blank window.
- **SDK coverage manifest + drift test** (see §3).

Verified: `pnpm test` passes (76). `pnpm test:it` against real Lore passes (9), including create local and server, verify/gc/flush/prune, and `file write` export. In the real app (SDK backend, Xvfb): Preferences changes apply live (theme, density) and persist; the external diff tool was launched with the exported base, the working file and the path; About showed the SDK version and license texts; Repository → Verify state completed as a transfer. In the packaged Linux build, About finds the bundled licenses. Windows: only covered by CI (unit + integration); the dialogs haven't been clicked through on Windows.

### Phase 2 (core loop) — done

`SdkBackend` implements open (status revision + config + remote name), clone, instance list, remote repository list, status (`--scan` / `--check-dirty`), full file listing, stage, unstage, reset, dirty, commit, push, and sync, with per-op progress into the transfer queue. The FS watcher drives incremental refresh. The console backfills startup logs (`app:logHistory`). There is a clone form on the first-run screen and in the Repository tab.

Verified (Linux, SDK 0.12.0 against a locally built `loreserver` 0.12.1-nightly):
- `LORE_IT_REMOTE=lore://127.0.0.1:41337 pnpm test:it`: **6/6**. Seed and push a repo → clone (remote URL resolved by name) → full tree with sizes → dirty, status, stage, unstage, reset (`--check-dirty` clears) → commit (rev 2, ahead 1) → push (ahead 0) → sync another instance to rev 2 → instance and remote listing → Lore error surfaced.
- `scripts/smoke-sdk-loop.cjs` through the real UI: committed tree shown as synced → new file on disk appears as *untracked* via the watcher (~0.8 s) → Stage from the context menu → *added* → Ctrl+Enter commit → "1 to push" → Push → in sync. The console shows the `lore dirty`, `status --check-dirty`, `stage`, `commit`, and `push` lines.
- `pnpm test`: 60 unit and component tests (watcher, mappers, settings, IPC, MockBackend, UI).
- The Windows CI job runs the same integration tests, plus the UI loop against the packaged exe.

Untested / known gaps:
- **Cancel**: Lore has no per-call cancel, so SDK transfers show no Cancel button (`canCancel = false`).
- **Conflicts after sync**: files with unresolved conflicts are flagged and the Changes tab shows the CLI resolve commands, but no real conflicting sync has been exercised yet.
- **Auth** (`auth info/login`) is not wired; demo servers are unauthenticated.
- **Large trees**: tree listing cost is one native call per directory. Not yet measured on a 100k-file repository.
- **Last revision** column is empty for real repositories until Phase 3 (file history).
- **Watcher scale**: `fs.watch` recursive on very large trees (Linux inotify limits) is untested.

### Phase 1 (skeleton) — done

Verified:
- `pnpm typecheck`, `pnpm lint`, `pnpm test` (45 tests: adapters, mappers, IPC contract/dispatch, runner/cancel, selectors, stores, MockBackend-driven App and FileTable component tests) all green.
- `scripts/smoke-mock.cjs` on the built app under Xvfb: 12,012-row table with ~50 DOM rows (virtualized), context-menu Stage, Enter → inline diff, Ctrl+Shift+S → transfer queue, console log populated, no renderer errors.

Untested / not built yet:
- macOS (Linux verified locally, Windows verified on CI; see §6).
- (Phase 1 gaps for the SDK backend, log backfill and the watcher are closed by Phase 2, above.)
- CliBackend beyond process plumbing. Every op the app needs exists in the SDK, so the CLI fallback stays a stub until something is missing.
- View-filter editor (Phase 4).
