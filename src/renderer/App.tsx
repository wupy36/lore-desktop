import { useEffect, useMemo } from "react";
import { useFiles, useBusBridge, usePrefs, useRepo } from "./api/queries";
import { AboutDialog } from "./components/AboutDialog";
import { CreateRepoForm } from "./components/CreateRepoForm";
import { Modal } from "./components/Modal";
import { PreferencesDialog } from "./components/PreferencesDialog";
import { ViewEditor } from "./components/ViewEditor";
import { BottomPanel } from "./components/BottomPanel/BottomPanel";
import { DetailPane } from "./components/DetailPane";
import { FileTable } from "./components/FileTable";
import { NoRepository } from "./components/NoRepository";
import { AccountDialog } from "./components/AccountDialog";
import { CommandPalette } from "./components/CommandPalette";
import { ChangesTab } from "./components/Sidebar/ChangesTab";
import { HistoryTab } from "./components/Sidebar/HistoryTab";
import { RepositoryTab } from "./components/Sidebar/RepositoryTab";
import { WorkspaceTab } from "./components/Sidebar/WorkspaceTab";
import { Splitter } from "./components/Splitter";
import { Toolbar } from "./components/Toolbar";
import { useHotkeys } from "./hotkeys";
import { filterFiles } from "./selectors";
import { useActivity } from "./store/activity";
import { useUi, type SidebarTab } from "./store/ui";

const TABS: { id: SidebarTab; label: string }[] = [
  { id: "repository", label: "Repository" },
  { id: "workspace", label: "Workspace" },
  { id: "changes", label: "Changes" },
  { id: "history", label: "History" },
];

/** Theme / font size / density from preferences → attributes and CSS variables on <html>. */
function useApplyPrefs() {
  const prefs = usePrefs().data;
  useEffect(() => {
    if (!prefs) return;
    const el = document.documentElement;
    el.dataset.theme = prefs.theme;
    el.dataset.density = prefs.density;
    el.style.setProperty("--fs", `${prefs.fontSize}px`);
    el.style.setProperty("--fs-sm", `${prefs.fontSize - 1}px`);
  }, [prefs]);
}

function Modals() {
  const modal = useUi((s) => s.modal);
  const close = () => useUi.getState().setModal(null);
  if (modal === "preferences") return <PreferencesDialog onClose={close} />;
  if (modal === "about") return <AboutDialog onClose={close} />;
  if (modal === "account") return <AccountDialog onClose={close} />;
  if (modal === "palette") return <CommandPalette onClose={close} />;
  if (modal === "view") return <ViewEditor onClose={close} />;
  if (modal === "createRepository")
    return (
      <Modal title="New repository" onClose={close}>
        <CreateRepoForm onDone={close} />
      </Modal>
    );
  return null;
}

export function App() {
  useBusBridge();
  useHotkeys();
  useApplyPrefs();
  const files = useFiles();
  const repoQ = useRepo();
  const repo = repoQ.data;
  const ui = useUi();
  const lastError = useActivity((s) => s.lastError);
  const visible = useMemo(() => filterFiles(files.data ?? [], ui), [files.data, ui]);
  const { sidebarW, detailW, bottomH } = ui.layout;

  if (repoQ.isSuccess && !repo) {
    return (
      <div className="app">
        <Toolbar minimal />
        <NoRepository />
        <footer className="statusbar">{lastError && <span className="err">⚠ {lastError}</span>}</footer>
        <Modals />
      </div>
    );
  }

  return (
    <div className="app" style={{ "--sidebar-w": `${sidebarW}px`, "--detail-w": `${detailW}px`, "--bottom-h": `${bottomH}px` } as React.CSSProperties}>
      <Toolbar />
      <aside className="pane sidebar" aria-label="Sidebar">
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} className="tab" role="tab" aria-selected={ui.sidebarTab === t.id} onClick={() => ui.setSidebarTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        {ui.sidebarTab === "repository" && <RepositoryTab />}
        {ui.sidebarTab === "workspace" && <WorkspaceTab />}
        {ui.sidebarTab === "changes" && <ChangesTab />}
        {ui.sidebarTab === "history" && <HistoryTab />}
      </aside>
      <Splitter k="sidebarW" axis="x" sign={1} className="splitter-v" />
      <main className="pane center" aria-label="Files">
        <div className="pane-header">
          <span>{ui.group ? `Changes: ${ui.group}` : `/${ui.dir}`}</span>
          <span className="tspacer" />
          <span>
            {visible.length.toLocaleString()} file(s){ui.selected.size ? ` · ${ui.selected.size} selected` : ""}
          </span>
        </div>
        {files.isPending ? <div className="empty">Loading files…</div> : files.isError ? <div className="empty">{files.error.message}</div> : <FileTable files={visible} />}
      </main>
      <Splitter k="detailW" axis="x" sign={-1} className="splitter-v" />
      <aside className="pane detail" aria-label="Details">
        <div className="pane-header">Details</div>
        <DetailPane />
      </aside>
      <Splitter k="bottomH" axis="y" sign={-1} className="splitter-h" />
      <BottomPanel />
      <footer className="statusbar">
        <span>{repo ? repo.path : "No repository open"}</span>
        {repo && <span>{repo.remoteUrl ?? "no remote"}</span>}
        <span>{(files.data?.length ?? 0).toLocaleString()} files</span>
        {lastError && <span className="err" title={lastError}>⚠ {lastError}</span>}
      </footer>
      <Modals />
    </div>
  );
}
