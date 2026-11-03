// Phase 0 online spike against a local loreserver (demo mode):
// create remote repo -> write -> stage -> commit -> branchPush -> clone -> status.
// Usage: node sdk-spike-online.mjs lore://127.0.0.1:41337
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { lore } from "@lore-vcs/sdk";
import { LoreEventTag } from "@lore-vcs/sdk/types/enums";

const remote = process.argv.find((a) => /^lores?:\/\//.test(a)) ?? "lore://127.0.0.1:41337";
const t0 = performance.now();
const log = (...a) => console.log(`[online +${(performance.now() - t0).toFixed(0)}ms]`, ...a);

async function call(name, fluent, onEvent = () => {}) {
  let status = null;
  let message = "";
  let progress = 0;
  const rc = await fluent
    .callback((ev) => {
      if (ev.tag === LoreEventTag.COMPLETE) {
        status = ev.data.status;
        message = String(ev.data.error?.message ?? "");
      } else if (String(LoreEventTag[ev.tag] ?? "").endsWith("PROGRESS")) progress++;
      else onEvent(ev);
    })
    .waitAsync();
  log(name, { rc, status, progressEvents: progress, ...(message ? { message } : {}) });
  if (rc !== 0 || status !== 0) throw new Error(`${name} failed: ${message || rc}`);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lore-online-"));
const name = `Spike${randomUUID().slice(0, 8)}`;
const url = `${remote}/${name}`;
const work = path.join(root, name);
const cloneDir = path.join(root, `${name}_clone`);
let ok = false;
try {
  await call("repositoryCreate", lore.repositoryCreate({ repositoryPath: work }, { repositoryUrl: url }));
  fs.writeFileSync(path.join(work, "readme.txt"), "hello from lore-desktop spike\n");
  fs.writeFileSync(path.join(work, "asset.bin"), Buffer.alloc(1 << 20, 3));
  await call("fileStage", lore.fileStage({ repositoryPath: work }, { paths: [path.join(work, "readme.txt"), path.join(work, "asset.bin")] }));
  await call("revisionCommit", lore.revisionCommit({ repositoryPath: work }, { message: "spike commit" }));
  await call("branchPush", lore.branchPush({ repositoryPath: work }, {}));
  await call("repositoryClone", lore.repositoryClone({ repositoryPath: cloneDir }, { repositoryUrl: url }));
  const files = [];
  await call("repositoryStatus(clone)", lore.repositoryStatus({ repositoryPath: cloneDir }, { staged: true, scan: true }), (ev) => {
    if (ev.tag === LoreEventTag.REPOSITORY_STATUS_FILE) files.push(String(ev.data.path));
  });
  const cloned = fs.readdirSync(cloneDir).filter((f) => !f.startsWith("."));
  log("clone contents", cloned, "clean status files", files);
  ok = cloned.includes("readme.txt") && cloned.includes("asset.bin") && files.length === 0;
} catch (e) {
  log("ERROR", e?.message ?? e);
} finally {
  lore.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
  log(ok ? "ONLINE SPIKE PASS" : "ONLINE SPIKE FAIL");
  process.exit(ok ? 0 : 1);
}
