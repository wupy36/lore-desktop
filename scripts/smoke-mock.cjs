// Launch the built app with --mock, wait for the file table, interact, screenshot.
// Usage: node scripts/smoke-mock.cjs [out.png]
const { _electron: electron } = require("playwright");
const path = require("node:path");

(async () => {
  const out = process.argv[2] ?? "smoke-mock.png";
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [path.join(__dirname, ".."), "--mock", "--no-sandbox"],
    env: { ...process.env, ELECTRON_RENDERER_URL: "" },
  });
  const errors = [];
  const win = await app.firstWindow();
  win.on("pageerror", (e) => errors.push(String(e)));
  win.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await win.setViewportSize({ width: 1600, height: 960 });
  await win.waitForSelector("[data-testid=file-table] [role=row][aria-rowindex]", { timeout: 20000 });
  const rowCount = await win.getAttribute("[data-testid=file-table]", "aria-rowcount");
  const domRows = await win.locator("[data-testid=file-table] [role=row][aria-rowindex]").count();

  // Select a modified text file via filter, open its diff.
  await win.fill("input[aria-label='Filter path']", "HeroMovement");
  await win.click("[data-testid=file-table] [role=row][aria-rowindex='1']");
  await win.keyboard.press("Enter");
  await win.waitForSelector(".diff", { timeout: 5000 });
  await win.fill("input[aria-label='Filter path']", "");
  // Stage it through the context menu.
  await win.fill("input[aria-label='Filter path']", "HeroMovement");
  await win.click("[data-testid=file-table] [role=row][aria-rowindex='1']", { button: "right" });
  await win.click("role=menuitem[name='Stage']");
  await win.waitForTimeout(400);
  const state = await win.textContent("[data-testid=file-table] [role=row][aria-rowindex='1'] .state");
  await win.fill("input[aria-label='Filter path']", "");
  // Sync to populate the transfer queue; scroll the big table.
  await win.keyboard.press("Control+Shift+S");
  await win.locator("[data-testid=file-table]").evaluate((el) => (el.scrollTop = 120000));
  await win.waitForTimeout(800);
  const consoleRows = await win.locator(".log-row").count();
  await win.screenshot({ path: out });
  console.log(JSON.stringify({ rowCount, domRows, stagedState: state, consoleRows, errors }, null, 1));
  await app.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
