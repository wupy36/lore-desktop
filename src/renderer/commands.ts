// Command registry for the palette (Ctrl+K). Each command maps to an existing
// action, so the palette and the toolbar/menus can never disagree.
import type { Branch } from "@shared/types";
import type { useActions } from "./actions";
import { useUi } from "./store/ui";

export interface Command {
  id: string;
  title: string;
  group: string;
  keys?: string;
  /** Equivalent CLI, shown as a hint. */
  cli?: string;
  enabled?: boolean;
  run: () => void;
}

type Actions = ReturnType<typeof useActions>;

export function buildCommands(a: Actions, ctx: { hasRepo: boolean; branches: Branch[] }): Command[] {
  const ui = useUi.getState();
  const sel = a.selection;
  const r = ctx.hasRepo;
  const cmds: Command[] = [
    { id: "refresh", title: "Refresh (scan working tree)", group: "Workspace", keys: "F5", cli: "lore status --scan", enabled: r, run: () => void a.refresh(true) },
    { id: "revert-unchanged", title: "Revert unchanged files", group: "Workspace", cli: "lore status --check-dirty", enabled: r, run: () => void a.revertUnchanged() },
    { id: "stage", title: `Stage selection (${sel.length})`, group: "Workspace", cli: "lore stage", enabled: r && sel.length > 0, run: () => void a.stage() },
    { id: "unstage", title: `Unstage selection (${sel.length})`, group: "Workspace", cli: "lore unstage", enabled: r && sel.some((f) => f.staged), run: () => void a.unstage() },
    { id: "reset", title: `Reset selection (${sel.length})…`, group: "Workspace", cli: "lore reset", enabled: r && sel.length > 0, run: () => void a.reset() },
    { id: "commit", title: "Commit…", group: "Revisions", keys: "Ctrl+Enter", cli: "lore commit", enabled: r, run: () => (ui.setSidebarTab("changes"), setTimeout(() => document.querySelector<HTMLTextAreaElement>("textarea[aria-label='Commit message']")?.focus())) },
    { id: "push", title: "Push", group: "Revisions", keys: "Ctrl+Shift+P", cli: "lore push", enabled: r, run: () => void a.push() },
    { id: "sync", title: "Sync", group: "Revisions", keys: "Ctrl+Shift+S", cli: "lore sync", enabled: r, run: () => void a.sync() },
    { id: "history", title: "Show history", group: "Revisions", cli: "lore history", enabled: r, run: () => ui.setSidebarTab("history") },
    { id: "view", title: "Edit workspace view…", group: "Workspace", cli: "lore sync --view", enabled: r, run: () => ui.openViewEditor() },
    { id: "locks", title: "Show locks", group: "Locks", cli: "lore lock query", enabled: r, run: () => ui.setBottomTab("locks") },
    { id: "deps", title: `Dependencies of ${sel[0]?.path.split("/").pop() ?? "selection"}`, group: "Workspace", cli: "lore file dependency list", enabled: r && sel.length === 1, run: () => sel[0] && ui.openDetail(sel[0].path, "deps") },
    { id: "sync-deps", title: `Sync selection with dependencies (${sel.length})`, group: "Revisions", cli: "lore sync --root-file … --dependency-recursive", enabled: r && sel.length > 0, run: () => void a.syncWithDependencies(sel.map((f) => f.path)) },
    { id: "lock", title: `Lock selection (${sel.length})`, group: "Locks", cli: "lore lock acquire", enabled: r && sel.length > 0, run: () => void a.lock() },
    { id: "release", title: `Release locks on selection (${sel.length})`, group: "Locks", cli: "lore lock release", enabled: r && sel.some((f) => f.lockOwner), run: () => void a.release() },
    {
      id: "branch-create",
      title: "Create branch and switch to it…",
      group: "Branches",
      cli: "lore branch create",
      enabled: r,
      run: () => {
        const n = window.prompt("New branch name");
        if (n?.trim()) void a.createBranchAndSwitch(n.trim());
      },
    },
    ...ctx.branches
      .filter((b) => !b.current && !b.archived)
      .map((b) => ({ id: `switch:${b.name}`, title: `Switch to branch ${b.name}`, group: "Branches", cli: `lore branch switch ${b.name}`, enabled: r, run: () => void a.switchBranch(b.name) })),
    { id: "open", title: "Open repository…", group: "Repository", keys: "Ctrl+O", run: () => void a.pickRepository() },
    { id: "new", title: "New repository…", group: "Repository", keys: "Ctrl+Shift+N", cli: "lore repository create", run: () => ui.setModal("createRepository") },
    { id: "verify", title: "Verify repository state", group: "Repository", cli: "lore repository verify state", enabled: r, run: () => void a.maintenance("verify") },
    { id: "gc", title: "Garbage collect", group: "Repository", cli: "lore repository gc", enabled: r, run: () => void a.maintenance("gc") },
    { id: "flush", title: "Flush pending writes", group: "Repository", cli: "lore repository flush", enabled: r, run: () => void a.maintenance("flush") },
    { id: "prune", title: "Prune stale instances", group: "Repository", cli: "lore repository instance prune", enabled: r, run: () => void a.maintenance("prune") },
    { id: "update-path", title: "Update stored path (after moving the folder)", group: "Repository", cli: "lore repository update-path", enabled: r, run: () => void a.maintenance("updatePath") },
    { id: "account", title: "Account and commit identity…", group: "App", enabled: r, run: () => ui.setModal("account") },
    { id: "prefs", title: "Preferences…", group: "App", keys: "Ctrl+,", run: () => ui.setModal("preferences") },
    { id: "theme", title: "Toggle light/dark theme", group: "App", run: () => void a.setPrefs({ theme: document.documentElement.dataset.theme === "light" ? "dark" : "light" }) },
    { id: "changed-only", title: "Show only changed files", group: "View", run: () => ui.setViewMode(ui.viewMode === "changed" ? "all" : "changed") },
    { id: "about", title: "About Lore Desktop", group: "App", run: () => ui.setModal("about") },
  ];
  return cmds;
}

/** Subsequence fuzzy match; lower score = better. Null = no match. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return 0;
  const t = text.toLowerCase();
  let ti = 0;
  let score = 0;
  let last = -1;
  for (const ch of q) {
    const i = t.indexOf(ch, ti);
    if (i < 0) return null;
    score += last < 0 ? i : i - last - 1; // gaps cost
    last = i;
    ti = i + 1;
  }
  // Prefer matches at word starts.
  return score - (t.startsWith(q) ? 100 : t.includes(` ${q[0]}`) ? 10 : 0);
}
