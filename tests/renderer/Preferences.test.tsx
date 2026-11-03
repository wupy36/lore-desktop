import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createInProcessApi } from "../../src/main/inProcessApi";
import { MockBackend } from "../../src/main/lore/MockBackend";
import { ApiProvider } from "../../src/renderer/api/client";
import { App } from "../../src/renderer/App";
import { useUi } from "../../src/renderer/store/ui";

afterEach(() => {
  cleanup();
  useUi.setState({ modal: null });
  document.documentElement.removeAttribute("data-theme");
});

async function renderApp() {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  const backend = new MockBackend({ latencyMs: 0 });
  await backend.openRepository("D:/Lore/ShooterGame");
  const { api, bus } = createInProcessApi(backend);
  render(
    <ApiProvider api={api}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <App />
      </QueryClientProvider>
    </ApiProvider>,
  );
  await screen.findByRole("toolbar");
  return { api, bus };
}

describe("Preferences / About / New repository", () => {
  it("opens from the menu command and applies theme, font size and density", async () => {
    const { bus } = await renderApp();
    bus.emit("ui:command", { command: "preferences" });
    const dialog = await screen.findByRole("dialog", { name: "Preferences" });
    expect(dialog).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "light" } });
    fireEvent.change(screen.getByLabelText("Font size"), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText("Row density"), { target: { value: "comfortable" } });
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    await waitFor(() => expect(document.documentElement.style.getPropertyValue("--fs")).toBe("15px"));
    expect(document.documentElement.dataset.density).toBe("comfortable");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("text prefs commit on blur, not per keystroke", async () => {
    const { api } = await renderApp();
    useUi.getState().setModal("preferences");
    const input = await screen.findByLabelText("External diff tool");
    fireEvent.change(input, { target: { value: 'meld "{base}" "{local}"' } });
    expect((await api.invoke("prefs:get", undefined)).externalDiffTool).toBe("");
    fireEvent.blur(input);
    await waitFor(async () => expect((await api.invoke("prefs:get", undefined)).externalDiffTool).toBe('meld "{base}" "{local}"'));
  });

  it("About lists version and backend; New repository shows the exact command", async () => {
    await renderApp();
    useUi.getState().setModal("about");
    expect(await screen.findByRole("dialog", { name: "About Lore Desktop" })).toBeTruthy();
    expect(await screen.findByText("mock")).toBeTruthy();
    useUi.getState().setModal("createRepository");
    fireEvent.change(await screen.findByLabelText("Repository name"), { target: { value: "MyGame" } });
    fireEvent.change(screen.getByLabelText("Repository parent folder"), { target: { value: "D:\\Lore" } });
    expect(screen.getByText(/lore --offline repository create MyGame → D:\\Lore\\MyGame/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Server URL"), { target: { value: "lore://127.0.0.1:41337" } });
    expect(screen.getByText(/lore repository create lore:\/\/127.0.0.1:41337\/MyGame/)).toBeTruthy();
  });
});
