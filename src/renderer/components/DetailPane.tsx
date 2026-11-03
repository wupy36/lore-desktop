import { useMemo } from "react";
import { deriveFileState } from "@shared/types";
import { useActions } from "../actions";
import { useDiff, useFileHistory, useFiles } from "../api/queries";
import { formatSize, formatTime } from "../selectors";
import { useUi } from "../store/ui";
import { DiffView } from "./DiffView";

export function DetailPane() {
  const focused = useUi((s) => s.focused);
  const tab = useUi((s) => s.detailTab);
  const setTab = useUi((s) => s.setDetailTab);
  const files = useFiles().data;
  const file = useMemo(() => files?.find((f) => f.path === focused) ?? null, [files, focused]);
  const isNew = !!file && (file.action === "add" || file.action === "copy");
  const history = useFileHistory(file && !isNew ? file.path : null);
  const diff = useDiff(file?.path ?? null, tab === "diff");
  const actions = useActions();

  if (!file) return <div className="empty">Select a file to see its history and diff.</div>;
  const st = deriveFileState(file);

  return (
    <>
      <dl className="kv">
        <dt>Path</dt>
        <dd className="mono">{file.path}</dd>
        <dt>State</dt>
        <dd className={`state state-${st}`}>{st}</dd>
        <dt>Size</dt>
        <dd>{formatSize(file.size)}</dd>
        <dt>Lock</dt>
        <dd className="lock">{file.lockOwner ?? "—"} {file.lockOwner && <span className="hint">(advisory)</span>}</dd>
        {file.fromPath && (
          <>
            <dt>From</dt>
            <dd className="mono">{file.fromPath}</dd>
          </>
        )}
      </dl>
      <div className="tabs" role="tablist">
        <button className="tab" role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>
          History
        </button>
        <button className="tab" role="tab" aria-selected={tab === "diff"} onClick={() => setTab("diff")}>
          Diff
        </button>
      </div>
      <div className="pane-body">
        {tab === "history" &&
          (isNew ? (
            <div className="empty">New file — no history yet.</div>
          ) : history.isLoading ? (
            <div className="empty">Loading…</div>
          ) : history.isError ? (
            <div className="empty">{history.error.message}</div>
          ) : (
            <div role="list">
              {history.data?.map((r) => (
                <div key={r.hash} role="listitem" className="list-row" style={{ height: "auto", padding: "4px 8px", alignItems: "flex-start", flexDirection: "column", gap: 0 }} title={r.hash}>
                  <div className="row" style={{ width: "100%" }}>
                    <span className="mono">#{r.number}</span>
                    <span className="grow dim">{r.author ?? "(no author)"}</span>
                    <span className="hint">{formatTime(r.timestamp)}</span>
                  </div>
                  <div className="grow" style={{ whiteSpace: "normal" }}>
                    {r.message}
                  </div>
                </div>
              ))}
            </div>
          ))}
        {tab === "diff" &&
          (diff.isLoading ? (
            <div className="empty">Loading diff…</div>
          ) : diff.isError ? (
            <div className="empty">{diff.error.message}</div>
          ) : diff.data ? (
            <DiffView diff={diff.data} onExternal={() => void actions.openExternalDiff(file.path)} />
          ) : null)}
      </div>
    </>
  );
}
