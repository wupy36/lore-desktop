// Phase 3 / Step B through the real UI on a real repository (SDK backend):
// History tab → revision → file → inline diff; file history in the detail pane;
// account dialog; health card; create & switch branch; command palette.
// Usage: node scripts/smoke-phase3.cjs [--exe=<packaged exe>] <repoPath> [outDir]
const { _electron: electron } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const exeArg = process.argv.find((a) => a.startsWith("--exe="))?.slice(6);
const [repo, outDir = "."] = process.argv.slice(2).filter((a) => !a.startsWith("--exe="));
const launch = (args) => (exeArg ? { executablePath: exeArg, args } : { executablePath: require("electron"), args: [path.join(__dirname, ".."), ...args] });

(async () => {
  if (!repo) throw new Error("usage: smoke-phase3.cjs <repoPath> [outDir]");
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), "lore-desktop-ud-"));
  const app = await electron.launch({ ...launch([`--repo=${repo}`, "--no-sandbox", `--user-data-dir=${ud}`]), env: { ...process.env, ELECTRON_RENDERER_URL: "" } });
  const errors = [];
  const win = await app.firstWindow();
  win.on("pageerror", (e) => errors.push(String(e)));
  await win.setViewportSize({ width: 1600, height: 900 });
  const step = async (name, fn) => {
    const t = Date.now();
    await fn();
    console.log(`ok ${name} (${Date.now() - t} ms)`);
  };
  const result = {};
  await win.waitForSelector("[data-testid=file-table] [role=row][aria-rowindex]", { timeout: 20000 });

  await step("history lists revisions with messages", async () => {
    await win.click("role=tab[name='History']");
    await win.waitForSelector("[aria-label=Revisions] [role=option]", { timeout: 15000 });
    result.revisions = await win.$$eval("[aria-label=Revisions] [role=option]:not([data-id=__working__])", (rs) => rs.slice(0, 3).map((r) => r.textContent));
    if (!result.revisions.length || !result.revisions[0].trim()) throw new Error("no revisions");
  });
  await step("graph rail renders and hover highlights parent edges", async () => {
    const first = "[aria-label=Revisions] [role=option]:not([data-id=__working__]) >> nth=0";
    if (!(await win.$("[aria-label=Revisions] svg.rail path.rail-line"))) throw new Error("no rail lines");
    await win.hover(first);
    // A vertical path has a zero-width box, so wait for presence, not visibility.
    await win.waitForSelector("[aria-label=Revisions] path.rail-line.hl", { state: "attached", timeout: 5000 });
  });
  await step("revision → files → inline diff vs parent", async () => {
    await win.click("[aria-label=Revisions] [role=option]:not([data-id=__working__]) >> nth=0");
    await win.waitForSelector("[aria-label='Files in revision'] [role=listitem]", { timeout: 10000 });
    await win.click("[aria-label='Files in revision'] [role=listitem] >> nth=0");
    const end = Date.now() + 15000;
    for (;;) {
      if (await win.$(".detail .diff, .detail dl:has-text('Binary')")) break;
      const msg = await win.textContent(".detail .pane-body .empty").catch(() => null);
      if (msg && !/^Loading/.test(msg)) throw new Error(`diff failed: ${msg}`);
      if (Date.now() > end) throw new Error("diff timed out");
      await new Promise((r) => setTimeout(r, 100));
    }
    result.diffHead = (await win.textContent(".detail .diff").catch(() => "binary")).slice(0, 120);
  });
  await step("detail pane file history", async () => {
    await win.click(".detail >> role=tab[name='History']");
    await win.waitForSelector(".detail [role=list] [role=listitem]", { timeout: 10000 });
    result.fileHistory = await win.$$eval(".detail [role=list] [role=listitem]", (rs) => rs.slice(0, 2).map((r) => r.textContent));
  });
  await win.screenshot({ path: path.join(outDir, "phase3-history.png") });

  await step("account dialog explains server auth", async () => {
    await win.click("button[title='Account and commit identity']");
    await win.waitForSelector("role=dialog[name='Account'] >> dl", { timeout: 10000 });
    result.account = (await win.textContent("role=dialog[name='Account']")).slice(0, 300);
    await win.keyboard.press("Escape");
  });
  const branch = `smoke-${Date.now().toString(36)}`;
  await step("create & switch branch, then palette switch back", async () => {
    await win.click("role=tab[name='Repository']");
    await win.fill("input[aria-label='New branch name']", branch);
    await win.click("button:has-text('Create & switch')");
    await win.waitForSelector(`.toolbar .badge:has-text('· ${branch}')`, { timeout: 15000 });
    await win.keyboard.press("Control+k");
    await win.fill("input[aria-label=Command]", "switch to branch main");
    win.once("dialog", (d) => d.accept());
    await win.keyboard.press("Enter");
    await win.waitForSelector(".toolbar .badge:has-text('· main')", { timeout: 20000 });
  });
  result.branches = await win.$$eval(".sidebar .list-row", (rs) => rs.map((r) => r.textContent).filter((t) => /○|●/.test(t)));
  await win.screenshot({ path: path.join(outDir, "phase3-branches.png") });
  console.log(JSON.stringify({ ...result, errors }, null, 1));
  await app.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
