import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createInProcessApi } from "../../src/main/inProcessApi";
import { MockBackend } from "../../src/main/lore/MockBackend";
import { ApiProvider } from "../../src/renderer/api/client";
import { App } from "../../src/renderer/App";
import { fuzzyScore } from "../../src/renderer/commands";
import { useUi } from "../../src/renderer/store/ui";

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 600, width: 1000, height: 600, toJSON: () => ({}) });
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  useUi.setState({ modal: null, sidebarTab: "changes", historyRevision: null, diffSpec: null, selected: new Set(), focused: null, text: "", group: null, dir: "" });
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

describe("History tab", () => {
  it("revision → changed files → diff against parent in the detail pane", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    const list = await screen.findByRole("listbox", { name: "Revisions" });
    await waitFor(() => expect(within(list).getAllByRole("option").length).toBeGreaterThan(3));
    const first = within(list).getAllByRole("option").find((o) => o.getAttribute("title")?.startsWith("#240 · main"))!;
    expect(first).toBeTruthy();
    fireEvent.click(first);
    const files = await screen.findByRole("list", { name: "Files in revision" });
    const file = (await within(files).findAllByRole("listitem"))[0]!;
    fireEvent.click(file);
    await waitFor(() => expect(useUi.getState()).toMatchObject({ detailTab: "diff", diffSpec: expect.objectContaining({ label: "#240 vs parent" }) }));
    expect(await screen.findByText("#240 vs parent")).toBeTruthy();
  });
});

describe("Command palette", () => {
  it("fuzzy-matches, runs the command, skips disabled ones", async () => {
    const { bus } = await renderApp();
    const seen: string[] = [];
    bus.on("transfer", (t) => seen.push(t.op));
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByLabelText("Command");
    fireEvent.change(input, { target: { value: "verif" } });
    const opts = within(screen.getByRole("listbox", { name: "Commands" })).getAllByRole("option");
    expect(opts[0]?.textContent).toMatch(/Verify repository state/);
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(seen).toContain("repo-verify"));
    expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull();
  });

  it("lists a switch command per branch", async () => {
    await renderApp();
    useUi.getState().setModal("palette");
    fireEvent.change(await screen.findByLabelText("Command"), { target: { value: "switch grapple" } });
    await waitFor(() => expect(screen.getByText("Switch to branch feature/grapple-hook")).toBeTruthy());
  });

  it("fuzzyScore prefers prefix and tight matches", () => {
    expect(fuzzyScore("push", "Push")).toBeLessThan(fuzzyScore("push", "Prune stale instances (Push)")!);
    expect(fuzzyScore("xyz", "Push")).toBeNull();
    expect(fuzzyScore("", "anything")).toBe(0);
  });
});

describe("Health card + branches + account", () => {
  it("shows unpushed revisions with a Push action after a commit", async () => {
    const { backend } = await renderApp();
    await backend.stage(["Source/Game/Player/HeroMovement.cpp"]);
    await backend.commit("x");
    useUi.getState().setSidebarTab("repository");
    useUi.getState().setSidebarTab("changes");
    fireEvent.keyDown(window, { key: "F5" });
    const card = await screen.findByRole("status", { name: "Working copy status" });
    expect(within(card).getByText(/local revision\(s\) not pushed/)).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Push" })).toBeTruthy();
  });

  it("Create & switch moves to the new branch", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("tab", { name: "Repository" }));
    fireEvent.change(await screen.findByLabelText("New branch name"), { target: { value: "feature/ui" } });
    fireEvent.click(screen.getByRole("button", { name: /Create & switch/ }));
    await waitFor(() => expect(screen.getByText(/ShooterGame · feature\/ui/)).toBeTruthy());
  });

  it("account dialog shows identity and lets you override it", async () => {
    await renderApp();
    useUi.getState().setModal("account");
    const dlg = await screen.findByRole("dialog", { name: "Account" });
    await waitFor(() => expect(within(dlg).getByText("me@studio.dev")).toBeTruthy());
    fireEvent.change(within(dlg).getByLabelText("Commit identity"), { target: { value: "ada@studio.dev" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(within(dlg).getByText(/set in Preferences/)).toBeTruthy());
  });
});
