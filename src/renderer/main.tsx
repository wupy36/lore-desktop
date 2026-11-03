import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiProvider } from "./api/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./theme.css";

const api = window.lore;
const root = createRoot(document.getElementById("root") as HTMLElement);
if (!api) {
  root.render(<div className="empty">Preload bridge missing: window.lore is undefined.</div>);
} else {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });
  root.render(
    <StrictMode>
      <ApiProvider api={api}>
        <QueryClientProvider client={qc}>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </QueryClientProvider>
      </ApiProvider>
    </StrictMode>,
  );
}
