import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createInProcessApi } from "../../src/main/inProcessApi";
import { MockBackend } from "../../src/main/lore/MockBackend";
import { ApiProvider } from "../../src/renderer/api/client";
import { App } from "../../src/renderer/App";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("first launch (no repository)", () => {
  it("shows the open screen, opens via the folder picker, remembers it", async () => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    const remembered: string[] = [];
    const pickDirectory = vi.fn(async () => "C:\\Lore\\ShooterGame");
    const { api } = createInProcessApi(new MockBackend({ latencyMs: 0 }), {
      pickDirectory,
      recents: { list: () => remembered, remember: (p) => void remembered.unshift(p) },
    });
    render(
      <ApiProvider api={api}>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <App />
        </QueryClientProvider>
      </ApiProvider>,
    );
    const btn = await screen.findByRole("button", { name: /Open repository…/ });
    expect(screen.queryByTestId("file-table")).toBeNull();
    fireEvent.click(btn);
    await waitFor(() => expect(pickDirectory).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText("Files")).toBeTruthy());
    expect(remembered).toEqual(["C:\\Lore\\ShooterGame"]);
    expect(screen.getByText(/ShooterGame · main/)).toBeTruthy();
  });

  it("cancelled picker stays on the open screen", async () => {
    const { api } = createInProcessApi(new MockBackend({ latencyMs: 0 }), { pickDirectory: async () => null });
    render(
      <ApiProvider api={api}>
        <QueryClientProvider client={new QueryClient()}>
          <App />
        </QueryClientProvider>
      </ApiProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Open repository…/ }));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole("main", { name: "No repository open" })).toBeTruthy();
  });
});
