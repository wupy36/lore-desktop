// Phase 4 through the real UI on a real repository (SDK backend): lock a file
// from the context menu → Lock owner column + Locks tab → release; add a
// dependency in the Deps tab; edit the workspace view → preview → apply
// (file leaves the disk) → restore the full view.
// The repository must contain Source/main.cpp and Content/Hero.uasset (committed).
// Usage: node scripts/smoke-phase4.cjs [--exe=<packaged exe>] <repoPath> [outDir]
const { _electron: electron } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const exeArg = process.argv.find((a) => a.startsWith("--exe="))?.slice(6);
const [repo, outDir = "."] = process.argv.slice(2).filter((a) => !a.startsWith("--exe="));
const launch = (args) => (exeArg ? { executablePath: exeArg, args } : { executablePath: require("electron"), args: [path.join(__dirname, ".."), ...args] });

(async () => {
  if (!repo) throw new Error("usage: smoke-phase4.cjs <repoPath> [outDir]");
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), "lore-desktop-ud-"));
  const app = await electron.launch({ ...launch([`--repo=${repo}`, "--no-sandbox", `--user-data-dir=${ud}`]), env: { ...process.env, ELECTRON_RENDERER_URL: "" } });
  const errors = [];
  const win = await app.firstWindow();
  win.on("pageerror", (e) => errors.push(String(e)));
  win.on("dialog", (d) => void d.accept());
  await win.setViewportSize({ width: 1600, height: 900 });
  const row = (p) => `[data-testid=file-table] [role=row][title="${p}"]`;
  const poll = async (fn, what, timeout = 15000) => {
    const end = Date.now() + timeout;
    for (;;) {
      if (await fn()) return;
      if (Date.now() > end) throw new Error(`timed out: ${what}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  const step = async (name, fn) => {
    const t = Date.now();
    await fn();
    console.log(`ok ${name} (${Date.now() - t} ms)`);
  };
  await win.waitForSelector(row("Content/Hero.uasset"), { timeout: 20000 });

  await step("lock from context menu → Lock owner column", async () => {
    await win.click(row("Content/Hero.uasset"), { button: "right" });
    await win.click("role=menuitem[name='Lock']");
    await poll(async () => ((await win.textContent(row("Content/Hero.uasset"))) ?? "").includes("🔒"), "lock column");
  });
  await step("Locks tab lists it; release", async () => {
    await win.click("role=tab[name='Locks']");
    await win.waitForSelector("[aria-label=Locks] [role=row]:has-text('Content/Hero.uasset')", { timeout: 10000 });
    await win.screenshot({ path: path.join(outDir, "phase4-locks.png") });
    await win.click("[aria-label=Locks] [role=row]:has-text('Content/Hero.uasset') >> role=button[name=/^Release/]");
    await poll(async () => !(await win.$("[aria-label=Locks] [role=row]:has-text('Content/Hero.uasset')")), "lock released");
    await poll(async () => !((await win.textContent(row("Content/Hero.uasset"))) ?? "").includes("🔒"), "column cleared");
  });
  await step("Deps tab: add a dependency", async () => {
    await win.click(row("Source/main.cpp"));
    await win.click(".detail >> role=tab[name='Deps']");
    await win.fill("input[aria-label='Dependency path']", "Content/Hero.uasset");
    await win.fill("input[aria-label='Dependency tags']", "asset");
    await win.click(".detail >> role=button[name='Add']");
    await win.waitForSelector(".detail .list-row:has-text('Content/Hero.uasset')", { timeout: 10000 });
    await win.screenshot({ path: path.join(outDir, "phase4-deps.png") });
  });
  await step("view: preview → apply → file leaves the disk → restore", async () => {
    await win.click("role=tab[name='Workspace']");
    await win.click("button:has-text('Edit view…')");
    await win.fill("textarea[aria-label='View rules']", "# code only\n*\n!Source/**\n");
    await win.click("role=button[name='Preview']");
    await win.waitForSelector("[aria-label='View preview'] >> text=Content/Hero.uasset", { timeout: 10000 });
    await win.screenshot({ path: path.join(outDir, "phase4-view.png") });
    await win.click("role=button[name='Apply']");
    await poll(() => !fs.existsSync(path.join(repo, "Content", "Hero.uasset")), "Hero.uasset removed from disk", 20000);
    if (!fs.existsSync(path.join(repo, "Source", "main.cpp"))) throw new Error("Source/main.cpp should stay");
    await win.waitForSelector("text=/View: \\d+ rule\\(s\\)/", { timeout: 10000 });
    await win.click("button:has-text('Edit view…')");
    await win.click("role=button[name='Everything']");
    await win.click("role=button[name='Preview']");
    // Restoring brings back everything the sparse view removed (count depends on the repo).
    await win.waitForSelector("[aria-label='View preview'] .state-added:has-text('Content/Hero.uasset')", { timeout: 10000 });
    await win.click("role=button[name='Apply']");
    await poll(() => fs.existsSync(path.join(repo, "Content", "Hero.uasset")), "Hero.uasset restored", 20000);
  });
  console.log(JSON.stringify({ errors }, null, 1));
  await app.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
