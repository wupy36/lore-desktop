// UI-only state (selection, tabs, filters, layout). Server/Lore state lives in TanStack Query.
import { create } from "zustand";
import type { ChangeGroup } from "@shared/types";

export type SidebarTab = "repository" | "workspace" | "changes" | "history";
export type BottomTab = "console" | "transfers" | "locks";
export type ViewMode = "all" | "changed";
export type DetailTab = "history" | "diff" | "deps";
export type Modal = "preferences" | "about" | "createRepository" | "account" | "palette" | "view" | null;
/** What the Diff tab compares. Absent source = current revision; absent target = working tree. */
export interface DiffSpec {
  path: string;
  source?: string;
  target?: string;
  label?: string;
}

export interface UiState {
  sidebarTab: SidebarTab;
  bottomTab: BottomTab;
  /** Directory filter from the Workspace tree ("" = repo root). */
  dir: string;
  /** Changes-tab group filter; overrides `dir` when set. */
  group: ChangeGroup | null;
  viewMode: ViewMode;
  text: string;
  selected: ReadonlySet<string>;
  anchor: string | null;
  focused: string | null;
  commitMessage: string;
  detailTab: DetailTab;
  modal: Modal;
  diffSpec: DiffSpec | null;
  /** Pending interactive login (URL + code to show). */
  authPrompt: { url: string; code: string } | null;
  /** Revision selected in the History tab (hash). */
  historyRevision: string | null;
  /** Rule appended when the view editor opens (from "Include/Exclude in view" actions). */
  viewDraftAppend: string | null;
  openViewEditor(append?: string): void;
  layout: { sidebarW: number; detailW: number; bottomH: number };

  setSidebarTab(t: SidebarTab): void;
  setBottomTab(t: BottomTab): void;
  setDir(dir: string): void;
  setGroup(g: ChangeGroup | null): void;
  setViewMode(m: ViewMode): void;
  setText(t: string): void;
  /** Click semantics: plain = single, ctrl = toggle, shift = range over `ordered`. */
  select(path: string, mod: { ctrl?: boolean; shift?: boolean }, ordered: readonly string[]): void;
  selectAll(ordered: readonly string[]): void;
  clearSelection(): void;
  setCommitMessage(m: string): void;
  /** Focus a file in the detail pane on the given tab. */
  openDetail(path: string, tab: DetailTab): void;
  setDetailTab(t: DetailTab): void;
  setModal(m: Modal): void;
  /** Show a specific comparison in the detail pane's Diff tab. */
  openDiff(spec: DiffSpec): void;
  setHistoryRevision(hash: string | null): void;
  setAuthPrompt(p: { url: string; code: string } | null): void;
  setLayout(p: Partial<UiState["layout"]>): void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const useUi = create<UiState>()((set, get) => ({
  sidebarTab: "changes",
  bottomTab: "console",
  dir: "",
  group: null,
  viewMode: "all",
  text: "",
  selected: new Set(),
  anchor: null,
  focused: null,
  commitMessage: "",
  detailTab: "history",
  modal: null,
  diffSpec: null,
  authPrompt: null,
  historyRevision: null,
  viewDraftAppend: null,
  openViewEditor: (append) => set({ modal: "view", viewDraftAppend: append ?? null }),
  layout: { sidebarW: 300, detailW: 380, bottomH: 200 },

  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
  setBottomTab: (bottomTab) => set({ bottomTab }),
  setDir: (dir) => set({ dir, group: null }),
  setGroup: (group) => set({ group }),
  setViewMode: (viewMode) => set({ viewMode }),
  setText: (text) => set({ text }),
  select: (path, mod, ordered) => {
    const s = get();
    if (mod.shift && s.anchor) {
      const a = ordered.indexOf(s.anchor);
      const b = ordered.indexOf(path);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const range = ordered.slice(lo, hi + 1);
        const next = mod.ctrl ? new Set([...s.selected, ...range]) : new Set(range);
        return set({ selected: next, focused: path });
      }
    }
    if (mod.ctrl) {
      const next = new Set(s.selected);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return set({ selected: next, anchor: path, focused: path });
    }
    set({ selected: new Set([path]), anchor: path, focused: path });
  },
  selectAll: (ordered) => set({ selected: new Set(ordered), focused: get().focused ?? ordered[0] ?? null }),
  clearSelection: () => set({ selected: new Set(), anchor: null, focused: null }),
  setCommitMessage: (commitMessage) => set({ commitMessage }),
  openDetail: (path, detailTab) => set((s) => ({ detailTab, diffSpec: s.diffSpec?.path === path ? s.diffSpec : null, focused: path, selected: s.selected.has(path) ? s.selected : new Set([path]), anchor: s.anchor ?? path })),
  setDetailTab: (detailTab) => set({ detailTab }),
  setModal: (modal) => set({ modal }),
  openDiff: (diffSpec) => set({ diffSpec, detailTab: "diff", focused: diffSpec.path }),
  setHistoryRevision: (historyRevision) => set({ historyRevision }),
  setAuthPrompt: (authPrompt) => set({ authPrompt }),
  setLayout: (p) =>
    set((s) => ({
      layout: {
        sidebarW: clamp(p.sidebarW ?? s.layout.sidebarW, 180, 700),
        detailW: clamp(p.detailW ?? s.layout.detailW, 220, 900),
        bottomH: clamp(p.bottomH ?? s.layout.bottomH, 60, 700),
      },
    })),
}));
