import { useState } from "react";
import { useActions } from "../../actions";
import { useBranches, useInstances, useRemotes, useRepo } from "../../api/queries";

/** Remote host part of a repository URL: lore://host:port/name -> lore://host:port */
const remoteRoot = (url: string | null | undefined) => (url ? url.replace(/\/[^/]+\/?$/, "") : null);

export function RepositoryTab() {
  const repo = useRepo().data;
  const branches = useBranches();
  const instances = useInstances();
  const remotes = useRemotes(remoteRoot(repo?.remoteUrl));
  const actions = useActions();
  const [newBranch, setNewBranch] = useState("");

  return (
    <div className="pane-body">
      <div className="group-title">
        <span className="grow">Remote repositories</span>
        <span className="hint mono">{remoteRoot(repo?.remoteUrl) ?? "no remote"}</span>
      </div>
      {remotes.isError && <div className="empty">{String(remotes.error.message)}</div>}
      {remotes.data?.map((r) => (
        <div key={r.id} className={`list-row${r.url === repo?.remoteUrl ? " active" : ""}`} title={`${r.url}\n${r.description}`}>
          <span>🗄</span>
          <span className="grow">{r.name}</span>
          <span className="hint">{r.description}</span>
        </div>
      ))}

      <div className="group-title">
        <span className="grow">Branches</span>
        <span className="hint">double-click to switch</span>
      </div>
      {branches.data?.map((b) => (
        <div
          key={b.id}
          className={`list-row${b.current ? " active" : ""}`}
          tabIndex={0}
          onDoubleClick={() => !b.current && window.confirm(`Switch to branch ${b.name}?`) && void actions.switchBranch(b.name)}
          onKeyDown={(e) => e.key === "Enter" && !b.current && window.confirm(`Switch to branch ${b.name}?`) && void actions.switchBranch(b.name)}
        >
          <span>{b.current ? "●" : "○"}</span>
          <span className="grow">{b.name}</span>
          {b.protected && <span className="badge">protected</span>}
          <span className="hint">{b.latest !== null ? `@${b.latest}` : ""}</span>
        </div>
      ))}
      <form
        className="row"
        style={{ padding: 6 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (newBranch.trim()) void actions.createBranch(newBranch.trim()).then(() => setNewBranch(""));
        }}
      >
        <input className="input" style={{ flex: 1 }} placeholder="New branch name" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} aria-label="New branch name" />
        <button className="mini" type="submit" disabled={!newBranch.trim()}>
          Create
        </button>
      </form>

      <div className="group-title">
        <span className="grow">Local instances</span>
      </div>
      {instances.data?.map((i) => (
        <div key={i.instanceId} className={`list-row${i.path === repo?.path ? " active" : ""}`} title={i.instanceId}>
          <span>📁</span>
          <span className="grow mono">{i.path}</span>
        </div>
      ))}
    </div>
  );
}
