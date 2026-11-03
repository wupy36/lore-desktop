import { useState } from "react";
import { ContextMenu, type MenuEntry } from "../ContextMenu";
import { useActions } from "../../actions";
import {
  useBranches,
  useInstances,
  useRemotes,
  useRepo,
} from "../../api/queries";
import { CloneForm } from "../CloneForm";
import { useUi } from "../../store/ui";

/** Remote host part of a repository URL: lore://host:port/name -> lore://host:port */
const remoteRoot = (url: string | null | undefined) =>
  url ? url.replace(/\/[^/]+\/?$/, "") : null;

export function RepositoryTab() {
  const repo = useRepo().data;
  const branches = useBranches();
  const instances = useInstances();
  const remotes = useRemotes(remoteRoot(repo?.remoteUrl));
  const actions = useActions();
  const [newBranch, setNewBranch] = useState("");
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    name: string;
  } | null>(null);
  const [showRemotes, setShowRemotes] = useState(true);
  const confirmSwitch = (name: string) =>
    window.confirm(`Switch to branch ${name}?`) &&
    void actions.switchBranch(name);
  const branchMenu = (name: string): MenuEntry[] => {
    const b = branches.data?.find((x) => x.name === name);
    return [
      {
        label: "Switch to this branch",
        disabled: !!b?.current || !!b?.archived,
        onSelect: () => confirmSwitch(name),
      },
      {
        label: "Show history",
        onSelect: () => useUi.getState().setSidebarTab("history"),
      },
      "sep",
      {
        label: "Protect (block direct pushes)",
        disabled: b?.protected === true,
        onSelect: () => void actions.branchAction(name, "protect"),
      },
      {
        label: "Unprotect",
        disabled: b?.protected === false,
        onSelect: () => void actions.branchAction(name, "unprotect"),
      },
      {
        label: "Archive…",
        disabled: !!b?.current,
        onSelect: () =>
          window.confirm(
            `Archive branch ${name}? It disappears from the list (lore branch list --archived shows it).`,
          ) && void actions.branchAction(name, "archive"),
      },
      "sep",
      {
        label: "Copy name",
        onSelect: () => void navigator.clipboard?.writeText(name),
      },
    ];
  };

  return (
    <div className="pane-body">
      <div
        className="group-title"
        style={{ cursor: "pointer" }}
        onClick={() => setShowRemotes((v) => !v)}
        title={remoteRoot(repo?.remoteUrl) ?? "no remote"}
      >
        <span className="tree-toggle">{showRemotes ? "▾" : "▸"}</span>
        <span className="grow">
          Remote repositories {remotes.data ? `(${remotes.data.length})` : ""}
        </span>
        <span className="hint mono">
          {remoteRoot(repo?.remoteUrl)?.replace(/^lores?:\/\//, "") ??
            "no remote"}
        </span>
      </div>
      <div className="capped" hidden={!showRemotes}>
        {remotes.isError && (
          <div className="empty">{String(remotes.error.message)}</div>
        )}
        {remotes.data?.map((r) => (
          <div
            key={r.id}
            className={`list-row${r.url === repo?.remoteUrl ? " active" : ""}`}
            title={`${r.url}\n${r.description}`}
          >
            <span>🗄</span>
            <span className="grow">{r.name}</span>
            <span className="hint">{r.description}</span>
          </div>
        ))}
      </div>

      <div className="group-title">
        <span className="grow">Branches</span>
        <span className="hint">double-click to switch</span>
      </div>
      {branches.data?.map((b) => (
        <div
          key={b.id}
          className={`list-row${b.current ? " active" : ""}`}
          tabIndex={0}
          onDoubleClick={() => !b.current && confirmSwitch(b.name)}
          onKeyDown={(e) =>
            e.key === "Enter" && !b.current && confirmSwitch(b.name)
          }
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, name: b.name });
          }}
          title={`${b.name}${b.latestHash ? `\nlatest ${b.latestHash}` : ""}${b.creator ? `\ncreated by ${b.creator}` : ""}`}
        >
          <span>{b.current ? "●" : "○"}</span>
          <span className="grow">{b.name}</span>
          {b.protected && <span className="badge">protected</span>}
          {b.where !== "both" && (
            <span className={`badge where-${b.where}`}>
              {b.where === "local" ? "not pushed" : "remote"}
            </span>
          )}
          <span className="hint">
            {b.latest !== null ? `@${b.latest}` : ""}
          </span>
        </div>
      ))}
      <form
        className="row"
        style={{ padding: 6 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (newBranch.trim())
            void actions
              .createBranchAndSwitch(newBranch.trim())
              .then(() => setNewBranch(""));
        }}
      >
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder="New branch name"
          value={newBranch}
          onChange={(e) => setNewBranch(e.target.value)}
          aria-label="New branch name"
        />
        <button
          className="mini"
          type="submit"
          disabled={!newBranch.trim()}
          title="lore branch create — creates the branch at the current revision and switches to it"
        >
          Create &amp; switch
        </button>
      </form>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={branchMenu(menu.name)}
          onClose={() => setMenu(null)}
        />
      )}
      <div className="group-title">
        <span className="grow">Manage</span>
      </div>
      <div className="row" style={{ padding: 6, flexWrap: "wrap" }}>
        <button
          className="mini"
          onClick={() => void actions.maintenance("verify")}
          title="lore repository verify state"
        >
          Verify state
        </button>
        <button
          className="mini"
          onClick={() => void actions.maintenance("gc")}
          title="lore repository gc — full garbage collection of the local store"
        >
          Garbage collect
        </button>
        <button
          className="mini"
          onClick={() => void actions.maintenance("flush")}
          title="lore repository flush"
        >
          Flush
        </button>
        <button
          className="mini"
          onClick={() => void actions.maintenance("updatePath")}
          title="lore repository update-path — after moving this workspace folder"
        >
          Update path
        </button>
        <button
          className="mini"
          onClick={() => void actions.maintenance("prune")}
          title="lore repository instance prune — drop instances whose folders are gone"
        >
          Prune instances
        </button>
      </div>

      <CloneForm
        defaultUrl={
          remoteRoot(repo?.remoteUrl) ? `${remoteRoot(repo?.remoteUrl)}/` : ""
        }
      />

      <div className="group-title">
        <span className="grow">Instances of this store</span>
        <span
          className="hint"
          title="lore repository instance list: instances sharing this repository's store. Other workspaces are under File → Open recent."
        >
          ?
        </span>
      </div>
      {instances.data?.map((i) => (
        <div
          key={i.instanceId}
          className={`list-row${i.path === repo?.path ? " active" : ""}`}
          title={i.instanceId}
        >
          <span>📁</span>
          <span className="grow mono">{i.path}</span>
        </div>
      ))}
    </div>
  );
}
