// Phase 0 spike: prove @lore-vcs/sdk loads and runs repositoryStatus.
// Runs under plain Node (`node sdk-spike.mjs`) or as Electron main
// (`electron sdk-spike.mjs`). Offline only: no server needed.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { lore } from "@lore-vcs/sdk";
import { LoreEventTag } from "@lore-vcs/sdk/types/enums";

const isElectron = !!process.versions.electron;
const t0 = performance.now();
const log = (...a) => console.log(`[spike +${(performance.now() - t0).toFixed(0)}ms]`, ...a);

async function main() {
  log("runtime", { node: process.versions.node, electron: process.versions.electron ?? null, platform: process.platform, arch: process.arch });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lore-spike-"));
  const repoPath = path.join(root, "SpikeRepo");
  const globals = { repositoryPath: repoPath, offline: true };

  const created = await lore.repositoryCreate(globals, { repositoryUrl: "SpikeRepo" })
    .filterByType(LoreEventTag.REPOSITORY_CREATE).collectAsync();
  log("repositoryCreate ok", created[0]?.data?.id ?? created[0]?.data);

  fs.writeFileSync(path.join(repoPath, "hello.txt"), "hello lore\n");
  fs.writeFileSync(path.join(repoPath, "asset.bin"), Buffer.alloc(4096, 7));

  const files = [];
  let completeStatus = null;
  const rc = await lore.repositoryStatus(globals, { staged: true, scan: true })
    .callback((ev) => {
      // Payload lives in native memory: copy inside the callback.
      if (ev.tag === LoreEventTag.REPOSITORY_STATUS_FILE) {
        const d = ev.data;
        files.push({ path: String(d.path), size: Number(d.size), action: d.action, staged: !!d.flagStaged, dirty: !!d.flagDirty });
      } else if (ev.tag === LoreEventTag.COMPLETE) {
        completeStatus = ev.data.status;
      }
    }).waitAsync();
  log("repositoryStatus rc", rc, "COMPLETE.status", completeStatus);
  log("status files", JSON.stringify(files));

  lore.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
  const ok = rc === 0 && completeStatus === 0 && files.length >= 2;
  log(ok ? "SPIKE PASS" : "SPIKE FAIL");
  return ok;
}

const run = () => main().then((ok) => (isElectron ? import("electron").then(({ app }) => app.exit(ok ? 0 : 1)) : process.exit(ok ? 0 : 1)))
  .catch((e) => { log("SPIKE ERROR", e?.stack ?? e); process.exit(2); });

if (isElectron) {
  const { app } = await import("electron");
  app.whenReady().then(run);
} else {
  run();
}
