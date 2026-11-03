import { useActions } from "../../actions";
import { useActivity } from "../../store/activity";
import { formatSize } from "../../selectors";

export function TransferQueue() {
  const transfers = useActivity((s) => s.transfers);
  const actions = useActions();
  if (!transfers.length) return <div className="empty">No transfers. Sync, push, clone and branch switch show progress here.</div>;
  return (
    <div className="pane-body" role="table" aria-label="Transfer queue">
      {transfers.map((t) => {
        const pct = t.total ? Math.min(100, (t.current / t.total) * 100) : null;
        const amount = t.unit === "bytes" ? `${formatSize(t.current)}${t.total ? ` / ${formatSize(t.total)}` : ""}` : `${t.current}${t.total ? ` / ${t.total}` : ""} ${t.unit}`;
        return (
          <div key={t.id} className="list-row" role="row">
            <span style={{ width: 70 }} className={`state state-${t.state === "error" ? "deleted" : t.state === "done" ? "added" : t.state === "cancelled" ? "synced" : "staged"}`}>
              {t.state}
            </span>
            <span style={{ width: 260 }} className="grow">
              {t.label}
            </span>
            <div className={`progress${pct === null && t.state === "running" ? " indeterminate" : ""}`} style={{ width: 200 }} aria-valuenow={pct ?? undefined} role="progressbar">
              <div style={{ width: pct === null ? undefined : `${pct}%` }} />
            </div>
            <span className="hint" style={{ width: 160 }}>
              {amount}
            </span>
            <span className="hint" style={{ width: 70 }}>
              {(((t.endedAt ?? Date.now()) - t.startedAt) / 1000).toFixed(1)} s
            </span>
            {t.state === "running" && t.cancellable ? (
              <button className="mini" onClick={() => void actions.cancel(t.id)}>
                Cancel
              </button>
            ) : (
              <span className="hint">{t.error ?? ""}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
