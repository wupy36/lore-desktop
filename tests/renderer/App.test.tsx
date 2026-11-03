// MockBackend-driven component tests: the real App over the real handlers,
// dispatch and zod validation, with an in-process transport instead of IPC.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createInProcessApi } from "../../src/main/inProcessApi";
import { MockBackend } from "../../src/main/lore/MockBackend";
import { ApiProvider } from "../../src/renderer/api/client";
import { App } from "../../src/renderer/App";
import { FileTable } from "../../src/renderer/components/FileTable";
import { useUi } from "../../src/renderer/store/ui";
import { generateMockRepo } from "../../src/main/lore/mock/fixtures";

// jsdom has no layout: give elements a size so TanStack Virtual renders rows.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 600, width: 1000, height: 600, toJSON: () => ({}) });
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  useUi.setState({ selected: new Set(), focused: null, anchor: null, text: "", dir: "", group: null, viewMode: "all", sidebarTab: "changes", commitMessage: "" });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderApp() {
  const backend = new MockBackend({ latencyMs: 0, stepMs: 1, progressSteps: 2 });
  await backend.openRepository("D:/Lore/ShooterGame");
  const { api } = createInProcessApi(backend);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ApiProvider api={api}>
      <QueryClientProvider client={qc}>
        <App />
      </QueryClientProvider>
    </ApiProvider>,
  );
  const table = await screen.findByTestId("file-table");
  await waitFor(() => expect(within(table).getAllByRole("row").length).toBeGreaterThan(5));
  return { backend, table };
}

describe("FileTable", () => {
  it("virtualizes 12k rows", () => {
    const { files } = generateMockRepo();
    render(<ApiProviderStub><FileTable files={files} initialRect={{ width: 1000, height: 600 }} /></ApiProviderStub>);
    const grid = screen.getByRole("grid");
    expect(grid.getAttribute("aria-rowcount")).toBe(String(files.length));
    const rendered = within(grid).getAllByRole("row").length;
    expect(rendered).toBeLessThan(100); // header + visible + overscan only
  });

  it("keyboard navigation moves focus and extends selection", () => {
    const { files } = generateMockRepo();
    render(<ApiProviderStub><FileTable files={files.slice(0, 50)} initialRect={{ width: 1000, height: 600 }} /></ApiProviderStub>);
    const grid = screen.getByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    fireEvent.keyDown(grid, { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(grid, { key: "ArrowDown", shiftKey: true });
    expect(useUi.getState().selected.size).toBe(3);
    fireEvent.keyDown(grid, { key: "End" });
    expect(useUi.getState().focused).toBe(files[49]?.path);
  });
});

function ApiProviderStub({ children }: { children: React.ReactNode }) {
  const api = createInProcessApi(new MockBackend({ latencyMs: 0 })).api;
  return (
    <ApiProvider api={api}>
      <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
    </ApiProvider>
  );
}

describe("App (MockBackend)", () => {
  it("populates all panes", async () => {
    await renderApp();
    expect(screen.getByRole("toolbar")).toBeTruthy();
    expect(screen.getByText(/Staged \(\d+\)/)).toBeTruthy();
    expect(screen.getByText(/Modified \(not staged\)/)).toBeTruthy();
    expect(screen.getByText(/Untracked \(new\)/)).toBeTruthy();
    expect(screen.getByRole("log", { name: "Console log" })).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/12,0\d\d file\(s\)/)).toBeTruthy());
  });

  it("stages via context menu, commits with Ctrl+Enter, shows push count", async () => {
    const { backend, table } = await renderApp();
    fireEvent.change(screen.getByLabelText("Filter path"), { target: { value: "HeroMovement" } });
    const row = await waitFor(() => within(table).getByTitle("Source/Game/Player/HeroMovement.cpp"));
    fireEvent.mouseDown(row);
    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Stage" }));
    await waitFor(() => expect(within(row).getByText("staged")).toBeTruthy());

    const box = screen.getByLabelText("Commit message");
    fireEvent.change(box, { target: { value: "Tune hero movement" } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    });
    await waitFor(() => expect(backend.currentRepository()?.aheadBy).toBe(1));
    await waitFor(() => expect(screen.getByText("1 to push")).toBeTruthy());
    expect((box as HTMLTextAreaElement).value).toBe("");
  });

  it("sync shows up in the transfer queue", async () => {
    await renderApp();
    fireEvent.keyDown(window, { key: "S", ctrlKey: true, shiftKey: true });
    fireEvent.click(screen.getByRole("tab", { name: /Transfers/ }));
    await waitFor(() => expect(screen.getByText(/Sync main@LATEST|Sync latest/)).toBeTruthy());
    await waitFor(() => expect(screen.getByText("done")).toBeTruthy());
  });
});
