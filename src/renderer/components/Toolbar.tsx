import { changeGroup } from "@shared/types";
import { useActions } from "../actions";
import { useAppInfo, useRepo } from "../api/queries";
import { useUi } from "../store/ui";

function T({ label, kbd, title, disabled, onClick }: { label: string; kbd?: string; title: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button className="tbtn" title={`${title}${kbd ? ` (${kbd})` : ""}`} disabled={disabled} onClick={onClick}>
      {label}
      {kbd && <span className="kbd">{kbd}</span>}
    </button>
  );
}

export function Toolbar() {
  const a = useActions();
  const repo = useRepo().data;
  const info = useAppInfo().data;
  const viewMode = useUi((s) => s.viewMode);
  const setViewMode = useUi((s) => s.setViewMode);
  const text = useUi((s) => s.text);
  const setText = useUi((s) => s.setText);
  const sel = a.selection;
  const changed = sel.filter((f) => changeGroup(f) !== null);

  return (
    <div className="toolbar" role="toolbar" aria-label="Main toolbar">
      <T label="⟳ Refresh" kbd="F5" title="Rescan working tree (lore status --scan)" onClick={() => void a.refresh(true)} />
      <T label="⇣ Sync" kbd="Ctrl+Shift+S" title="Fetch and merge remote revisions (lore sync)" onClick={() => void a.sync()} />
      <span className="tsep" />
      <T label="+ Stage" title="lore stage <paths>" disabled={!changed.some((f) => !f.staged)} onClick={() => void a.stage(changed)} />
      <T label="− Unstage" title="lore unstage <paths>" disabled={!sel.some((f) => f.staged)} onClick={() => void a.unstage()} />
      <T label="↺ Reset" title="Discard local changes (lore reset <paths>)" disabled={!changed.length} onClick={() => void a.reset()} />
      <T label="Revert unchanged" title="Clear dirty flags on files whose content matches (lore status --check-dirty)" onClick={() => void a.revertUnchanged()} />
      <span className="tsep" />
      <T label="✓ Commit" kbd="Ctrl+Enter" title="Focus commit message" onClick={() => (useUi.getState().setSidebarTab("changes"), setTimeout(() => document.querySelector<HTMLTextAreaElement>("textarea[aria-label='Commit message']")?.focus()))} />
      <T label="⇡ Push" title="Send local revisions to the remote (lore push)" disabled={!repo?.aheadBy} onClick={() => void a.push()} />
      <span className="tsep" />
      <T label="🔒 Lock" title="Acquire advisory lock (lore lock acquire)" disabled={!sel.length} onClick={() => void a.lock()} />
      <T label="🔓 Release" title="lore lock release" disabled={!sel.some((f) => f.lockOwner)} onClick={() => void a.release()} />
      <span className="tspacer" />
      <select className="input" value={viewMode} onChange={(e) => setViewMode(e.target.value as "all" | "changed")} aria-label="Show files">
        <option value="all">All files</option>
        <option value="changed">Changed only</option>
      </select>
      <input className="input" style={{ width: 220, marginLeft: 6 }} placeholder="Filter path…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Filter path" />
      <span className="tsep" />
      {repo && (
        <span className="badge" title={repo.path}>
          {repo.name} · {repo.branch}
          {repo.revision !== null ? `@${repo.revision}` : ""}
        </span>
      )}
      {!!repo?.aheadBy && <span className="badge ahead">{repo.aheadBy} to push</span>}
      {info && <span className={`badge${info.backend === "mock" ? " mock" : ""}`}>{info.backend}</span>}
    </div>
  );
}
