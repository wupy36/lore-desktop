import { createContext, useContext, type ReactNode } from "react";
import type { LoreApi } from "@shared/ipc";

declare global {
  interface Window {
    lore?: LoreApi;
  }
}

const ApiContext = createContext<LoreApi | null>(null);

export function ApiProvider({ api, children }: { api: LoreApi; children: ReactNode }) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function useApi(): LoreApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error("ApiProvider missing");
  return api;
}
