import { useMemo } from "react";
import { deriveFileState, fileName, type ChangeGroup, type FileEntry } from "@shared/types";
import { useActions } from "../../actions";
import { useFiles, useRepo } from "../../api/queries";
import { HealthCard } from "../HealthCard";
import { groupChanges } from "../../selectors";
import { useUi } from "../../store/ui";

const TITLES: Record<ChangeGroup, string> = { staged: "Staged", unstaged: "Modified (not staged)", untracked: "Untracked (new)" };

export function ChangesTab() {
  const files = useFiles().data;
  const repo = useRepo().data;
  const groups = useMemo(() => groupChanges(files ?? []), [files]);
  const group = useUi((s) => s.group);
  const setGroup = useUi((s) => s.setGroup);
  const message = useUi((s) => s.commitMessage);
  const setMessage = useUi((s) => s.setCommitMessage);
  const openDetail = useUi((s) => s.openDetail);
  const actions = useActions();

  const canCommit = groups.staged.length > 0 && message.trim().length > 0;
  const commit = () => canCommit && void actions.commit(message.trim());

  const groupActions = (g: ChangeGroup, list: FileEntry[]) => (
    <>
      {g !== "staged" && (
        <button className="mini" disabled={!list.length} onClick={() => void actions.stage(list)} title="lore stage <paths>">
          Stage all
        </button>
      )}
      {g === "staged" && (
        <button className="mini" disabled={!list.length} onClick={() => void actions.unstage(list)} title="lore unstage <paths>">
          Unstage all
        </button>
      )}
      {g !== "untracked" && (
        <button className="mini" disabled={!list.length} onClick={() => void actions.reset(list)} title="lore reset <paths>">
          Reset
        </button>
      )}
    </>
  );

  return (
    <>
      <div className="pane-body">
        <HealthCard />
        {(Object.keys(TITLES) as ChangeGroup[]).map((g) => (
          <section key={g} aria-label={TITLES[g]}>
            <div className="group-title">
              <span className="grow" style={{ cursor: "pointer", color: group === g ? "var(--text)" : undefined }} onClick={() => setGroup(group === g ? null : g)} title="Show this group in the file table">
                {TITLES[g]} ({groups[g].length})
              </span>
              {groupActions(g, groups[g])}
            </div>
            {groups[g].slice(0, 500).map((f) => {
              const st = deriveFileState(f);
              return (
                <div key={f.path} className="list-row" title={f.path} onClick={() => openDetail(f.path, "diff")}>
                  <span className={`state state-${st}`} style={{ width: 64 }}>
                    {st}
                  </span>
                  <span className="grow">{fileName(f.path)}</span>
                  {g === "staged" ? (
                    <button className="mini" onClick={(e) => (e.stopPropagation(), void actions.unstage([f]))} aria-label={`Unstage ${f.path}`}>
                      −
                    </button>
                  ) : (
                    <button className="mini" onClick={(e) => (e.stopPropagation(), void actions.stage([f]))} aria-label={`Stage ${f.path}`}>
                      +
                    </button>
                  )}
                </div>
              );
            })}
            {groups[g].length > 500 && <div className="empty">…{groups[g].length - 500} more — click the group title to see all in the table.</div>}
          </section>
        ))}
      </div>
      <div className="commit-box">
        <textarea
          className="input"
          rows={3}
          placeholder="Commit message (Ctrl+Enter to commit)"
          aria-label="Commit message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              commit();
            }
          }}
        />
        <div className="row">
          <button className="btn primary" disabled={!canCommit} onClick={commit} title="lore commit <message> — records a revision locally">
            Commit {groups.staged.length ? `(${groups.staged.length})` : ""}
          </button>
          <button className="btn" disabled={!repo?.aheadBy} onClick={() => void actions.push()} title="lore push — sends local revisions to the remote">
            Push {repo?.aheadBy ? `(${repo.aheadBy})` : ""}
          </button>
          <span className="hint" style={{ marginLeft: "auto" }}>
            Commit and push are separate steps
          </span>
        </div>
      </div>
    </>
  );
}
