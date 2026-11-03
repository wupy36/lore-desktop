import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createInProcessApi } from "../../src/main/inProcessApi";
import { MockBackend } from "../../src/main/lore/MockBackend";
import { ApiProvider } from "../../src/renderer/api/client";
import { App } from "../../src/renderer/App";
import { useUi } from "../../src/renderer/store/ui";
import { sameView } from "../../src/main/handlers";

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 800, width: 1000, height: 800, toJSON: () => ({}) });
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  vi.spyOn(window, "confirm").mockReturnValue(true);
  useUi.setState({ modal: null, sidebarTab: "changes", bottomTab: "console", detailTab: "history", focused: null, selected: new Set(), viewDraftAppend: null, text: "", dir: "", group: null });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderApp() {
  const backend = new MockBackend({ latencyMs: 0, stepMs: 1, progressSteps: 2 });
  await backend.openRepository("D:/Lore/ShooterGame");
  const { api, bus } = createInProcessApi(backend);
  render(
    <ApiProvider api={api}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <App />
      </QueryClientProvider>
    </ApiProvider>,
  );
  await screen.findByTestId("file-table");
  return { backend, api, bus };
}

describe("Locks panel", () => {
  it("lists locks, releases your own, asks before releasing someone else's", async () => {
    const { backend } = await renderApp();
    fireEvent.click(screen.getByRole("tab", { name: "Locks" }));
    const panel = await screen.findByRole("region", { name: "Locks" });
    await waitFor(() => expect(within(panel).getAllByRole("row").length).toBeGreaterThan(5));
    const mine = within(panel).getAllByRole("row").find((r) => r.textContent?.includes("me@studio.dev"))!;
    const path = mine.querySelector(".mono")!.textContent!;
    fireEvent.click(within(mine).getByRole("button", { name: "Release" }));
    await waitFor(async () => expect((await backend.lockQuery({ path })).length).toBe(0));
    const theirs = within(panel).getAllByRole("row").find((r) => r.textContent?.includes("Release as owner"))!;
    fireEvent.click(within(theirs).getByRole("button", { name: /Release as owner/ }));
    expect(window.confirm).toHaveBeenCalled();
    expect(within(panel).getByText(/advisory/)).toBeTruthy();
  });
});

describe("Workspace view editor", () => {
  it("opens with the current rules + the appended include rule, previews, applies", async () => {
    const { backend } = await renderApp();
    useUi.getState().openViewEditor("!Content/Weapons/**");
    const box = (await screen.findByLabelText("View rules")) as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).toMatch(/^# Work on code[\s\S]*!Content\/Weapons\/\*\*$/));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(screen.getByText(/\+\d+ file\(s\) .* to fetch · −0 file\(s\)/)).toBeTruthy());
    expect(within(screen.getByLabelText("View preview")).getAllByText(/^Content\/Weapons\//).length).toBeGreaterThan(10);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(async () => expect(await backend.getView()).toContain("!Content/Weapons/**"));
  });

  it("Workspace tab shows the view and the tree menu appends include/exclude rules", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("tab", { name: "Workspace" }));
    expect(await screen.findByText(/View: \d+ rule\(s\) — sparse workspace/)).toBeTruthy();
    const content = screen.getAllByRole("treeitem").find((t) => t.textContent?.startsWith("▾Content") || t.textContent?.includes("Content"))!;
    fireEvent.contextMenu(content);
    fireEvent.click(await screen.findByRole("menuitem", { name: /Exclude Content\/ from view/ }));
    const box = (await screen.findByLabelText("View rules")) as HTMLTextAreaElement;
    await waitFor(() => expect(box.value.endsWith("Content/**")).toBe(true));
  });

  it("sameView ignores comments, blank lines and case (Lore normalizes .lore/view)", () => {
    expect(sameView(["# hi", "*", "", "!Source/**"], ["*", "!source/**"])).toBe(true);
    expect(sameView(["*"], ["*", "!x"])).toBe(false);
  });
});

describe("Dependencies tab", () => {
  it("shows depends-on / used-by, adds and removes, offers dependency sync", async () => {
    const { backend, bus } = await renderApp();
    const files = (await backend.listFiles()).map((f) => f.path);
    const map = files.find((p) => p.endsWith(".umap"))!;
    const cfg = files.find((p) => p.endsWith(".ini"))!;
    useUi.getState().openDetail(map, "deps");
    expect(await screen.findByText(/Depends on \(2\)/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Dependency path"), { target: { value: cfg } });
    fireEvent.change(screen.getByLabelText("Dependency tags"), { target: { value: "config, ini" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(screen.getByText(/Depends on \(3\)/)).toBeTruthy());
    expect((await backend.dependencies(map, {})).find((d) => d.path === cfg)?.tags).toEqual(["config", "ini"]);
    fireEvent.click(screen.getByRole("button", { name: `Remove dependency ${cfg}` }));
    await waitFor(() => expect(screen.getByText(/Depends on \(2\)/)).toBeTruthy());
    const ops: string[] = [];
    bus.on("transfer", (t) => ops.push(t.label));
    fireEvent.click(screen.getByRole("button", { name: "Sync this file + dependencies" }));
    await waitFor(() => expect(ops).toContain("Sync 1 file(s) + dependencies"));
  });
});
