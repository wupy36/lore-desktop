import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createInProcessApi } from "../../src/main/inProcessApi";
import { MockBackend } from "../../src/main/lore/MockBackend";
import { ApiProvider } from "../../src/renderer/api/client";
import { App } from "../../src/renderer/App";
import { toNodes, WORKING_ID } from "../../src/renderer/components/timeline/LoreTimelineView";
import { useUi } from "../../src/renderer/store/ui";
import type { GraphRevision } from "@shared/types";

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(2000);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 400, bottom: 2000, width: 400, height: 2000, toJSON: () => ({}) });
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  useUi.setState({ modal: null, sidebarTab: "history", historyRevision: null, diffSpec: null });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderHistory() {
  const backend = new MockBackend({ latencyMs: 0 });
  await backend.openRepository("D:/Lore/ShooterGame");
  const { api } = createInProcessApi(backend);
  render(
    <ApiProvider api={api}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <App />
      </QueryClientProvider>
    </ApiProvider>,
  );
  const list = await screen.findByRole("listbox", { name: "Revisions" });
  await waitFor(() => expect(within(list).getAllByRole("option").length).toBeGreaterThan(10));
  return { list };
}

describe("revision timeline", () => {
  it("toNodes drops parents outside the window and prepends the working copy", () => {
    const rev = (hash: string, parents: string[]): GraphRevision => ({ hash, parents, number: 1, branch: "main", author: "ada@studio.dev", timestamp: 1, message: hash, pending: false, isHead: hash === "b" });
    const nodes = toNodes([rev("b", ["a", "zzz"]), rev("a", ["gone"])], { count: 3, author: "me@studio.dev", head: "b" });
    expect(nodes.map((n) => [n.id, n.parents])).toEqual([
      [WORKING_ID, ["b"]],
      ["b", ["a"]],
      ["a", []],
    ]);
    expect(nodes[1]).toMatchObject({ nodeType: "merge", author: { avatarInitials: "AD" } }); // two parents in Lore = merge, even if one is off-window
    expect(nodes[0]).toMatchObject({ nodeType: "pending", pending: true, message: "Working copy · 3 local change(s)" });
  });

  it("renders the working copy, author headers, a merge, branch lanes and HEAD", async () => {
    const { list } = await renderHistory();
    const opts = within(list).getAllByRole("option");
    expect(opts[0]?.textContent).toMatch(/Working copy · \d+ local change/);
    expect(screen.getAllByText("HEAD")).toHaveLength(1);
    expect(screen.getAllByText("merge").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/catherine\.bell|matthaus\.bauer|matt\.rivera/).length).toBeGreaterThan(0); // author headers
    // More than one lane: the rail is wider than a single lane.
    const rail = list.querySelector("svg.rail") as SVGSVGElement;
    expect(Number(rail.getAttribute("width"))).toBeGreaterThan(30);
    // Unpushed feature branch: dashed rail.
    expect(list.querySelector("path[stroke-dasharray]")).toBeTruthy();
  });

  it("hover highlights the node's parent edges and dims the rest", async () => {
    const { list } = await renderHistory();
    const merge = within(list).getAllByRole("option").find((o) => o.textContent?.includes("Merge dev into main"))!;
    fireEvent.mouseEnter(merge);
    const id = merge.getAttribute("data-id")!;
    await waitFor(() => expect(list.querySelectorAll("path.rail-line.hl").length).toBeGreaterThanOrEqual(2));
    for (const p of list.querySelectorAll("path.rail-line.hl")) expect(p.getAttribute("data-edges")).toContain(`${id}>`);
    expect(list.querySelectorAll("path.rail-line.dim").length).toBeGreaterThan(0);
    fireEvent.mouseLeave(merge);
    await waitFor(() => expect(list.querySelectorAll("path.rail-line.hl").length).toBe(0));
  });

  it("scope toggle: current branch hides other branches; selecting opens files", async () => {
    const { list } = await renderHistory();
    expect(within(list).getAllByRole("option").some((o) => o.getAttribute("title")?.includes("feature/ui-polish"))).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "main" }));
    await waitFor(() => expect(within(list).getAllByRole("option").some((o) => o.getAttribute("title")?.includes("feature/ui-polish"))).toBe(false));
    const head = within(list).getAllByRole("option").find((o) => o.textContent?.includes("HEAD"))!;
    fireEvent.click(head);
    expect(await screen.findByText(/#240 · \d+ file\(s\)/)).toBeTruthy();
    fireEvent.keyDown(list, { key: "ArrowDown" });
    await waitFor(() => expect(screen.getByText(/#239 · \d+ file\(s\)/)).toBeTruthy());
  });
});
