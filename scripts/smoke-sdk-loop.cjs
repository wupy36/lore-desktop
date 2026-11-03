// End-to-end core loop through the real UI on a real repository (SDK backend):
// full tree listed → edit on disk → watcher marks it modified → stage (context
// menu) → commit (Ctrl+Enter) → push → in sync.
// Usage: node scripts/smoke-sdk-loop.cjs [--exe=<packaged exe>] <repoPath> [out.png]
const { _electron: electron } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const exeArg = process.argv.find((a) => a.startsWith("--exe="))?.slice(6);
const [repo, out = "smoke-sdk-loop.png"] = process.argv.slice(2).filter((a) => !a.startsWith("--exe="));
const launch = (args) => (exeArg ? { executablePath: exeArg, args } : { executablePath: require("electron"), args: [path.join(__dirname, ".."), ...args] });

(async () => {
  if (!repo) throw new Error("usage: smoke-sdk-loop.cjs <repoPath>");
  const app = await electron.launch({ ...launch([`--repo=${repo}`, "--no-sandbox"]), env: { ...process.env, ELECTRON_RENDERER_URL: "" } });
  const errors = [];
  const win = await app.firstWindow();
  win.on("pageerror", (e) => errors.push(String(e)));
  await win.setViewportSize({ width: 1500, height: 900 });
  const table = "[data-testid=file-table]";
  const row = (p) => `${table} [role=row][title="${p}"]`;
  const state = (p) => win.textContent(`${row(p)} .state`);
  // The app's CSP forbids eval, so poll from Node instead of page.waitForFunction.
  const waitState = async (p, want, timeout = 10000) => {
    const end = Date.now() + timeout;
    let got = null;
    while (Date.now() < end) {
      got = await win.textContent(`${row(p)} .state`).catch(() => null);
      if (got === want) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`${p}: expected ${want}, got ${got}`);
  };
  const step = async (name, fn) => {
    const t = Date.now();
    await fn();
    console.log(`ok ${name} (${Date.now() - t} ms)`);
  };

  await step("full tree listed (committed files shown as synced)", async () => {
    await win.waitForSelector(`${table} [role=row][aria-rowindex] .state-synced`, { timeout: 20000 });
  });
  const edited = `smoke-${Date.now().toString(36)}.txt`;
  await step("watcher picks up a new file", async () => {
    fs.writeFileSync(path.join(repo, edited), "hello from smoke\n");
    await win.waitForSelector(row(edited), { timeout: 10000 });
    if ((await state(edited)) !== "untracked") throw new Error(`expected untracked, got ${await state(edited)}`);
  });
  await step("stage via context menu", async () => {
    await win.click(row(edited), { button: "right" });
    await win.click("role=menuitem[name='Stage']");
    await waitState(edited, "added");
  });
  await step("commit with Ctrl+Enter", async () => {
    await win.click("role=tab[name='Changes']");
    await win.fill("textarea[aria-label='Commit message']", `Smoke ${edited}`);
    await win.press("textarea[aria-label='Commit message']", "Control+Enter");
    await win.waitForSelector(".badge.ahead", { timeout: 10000 });
    await waitState(edited, "synced");
  });
  await step("push", async () => {
    await win.click("button[title*='lore push']");
    await win.waitForSelector(".badge.ahead", { state: "detached", timeout: 20000 });
  });
  await win.click("role=tab[name=/Transfers/]");
  const transfers = await win.$$eval(".bottom [role=row]", (rs) => rs.map((r) => r.textContent));
  await win.click("role=tab[name='Console']");
  const log = await win.$$eval(".log-row .c", (rs) => rs.map((r) => r.textContent));
  await win.screenshot({ path: out });
  console.log(JSON.stringify({ badge: await win.textContent(".toolbar .badge"), transfers, log: log.slice(-12), errors }, null, 1));
  await app.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
