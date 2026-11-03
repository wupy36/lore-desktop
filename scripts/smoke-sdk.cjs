// Launch the built app with the SDK backend on a real repository and report
// what the file table shows. Usage: node scripts/smoke-sdk.cjs <repoPath> [out.png]
const { _electron: electron } = require("playwright");
const path = require("node:path");

(async () => {
  const [repo, out = "smoke-sdk.png"] = process.argv.slice(2);
  if (!repo) throw new Error("usage: smoke-sdk.cjs <repoPath> [out.png]");
  const app = await electron.launch({ executablePath: require("electron"), args: [path.join(__dirname, ".."), `--repo=${repo}`, "--no-sandbox"], env: { ...process.env, ELECTRON_RENDERER_URL: "" } });
  const errors = [];
  const win = await app.firstWindow();
  win.on("pageerror", (e) => errors.push(String(e)));
  await win.setViewportSize({ width: 1400, height: 800 });
  await win.waitForSelector("[data-testid=file-table] [role=row][aria-rowindex]", { timeout: 20000 });
  await win.keyboard.press("F5"); // status --scan
  await win.waitForTimeout(800);
  const rows = await win.$$eval("[data-testid=file-table] [role=row][aria-rowindex]", (rs) => rs.map((r) => [r.getAttribute("title"), r.querySelector(".state")?.textContent]));
  const badge = await win.textContent(".toolbar .badge");
  const log = await win.$$eval(".log-row .c", (rs) => rs.map((r) => r.textContent));
  await win.screenshot({ path: out });
  console.log(JSON.stringify({ badge, rows, log, errors }, null, 1));
  await app.close();
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
