import { useMemo, useState } from "react";
import { UNKNOWN_OWNER } from "@shared/types";
import { useActions } from "../../actions";
import { useAuth, useLocks } from "../../api/queries";
import { formatTime } from "../../selectors";

/** Locks on the server (advisory in Lore). Release your own; releasing someone else's is an owner action. */
export function LocksPanel() {
  const locks = useLocks();
  const auth = useAuth().data;
  const a = useActions();
  const [mine, setMine] = useState(false);
  const me = auth?.user?.name ?? auth?.identity ?? null;
  const ownerless = (locks.data ?? []).some((l) => l.owner === UNKNOWN_OWNER);
  const rows = useMemo(() => (locks.data ?? []).filter((l) => !mine || l.owner === me || l.owner === UNKNOWN_OWNER), [locks.data, mine, me]);

  return (
    <div className="pane-body" role="region" aria-label="Locks">
      <div className="row" style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)" }}>
        <span className="hint grow">
          {locks.data ? `${locks.data.length} lock(s)` : ""} · Locks are advisory: Lore does not block pushes to locked files.
          {ownerless && " This server has no authentication, so lock owners are not tracked and anyone can release any lock."}
        </span>
        <label className="hint">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> mine
        </label>
        <button className="mini" onClick={() => void locks.refetch()}>
          Refresh
        </button>
      </div>
      {locks.isError && <div className="empty">{locks.error.message}</div>}
      {locks.data && !rows.length && <div className="empty">No locks{mine ? " held by you" : ""}.</div>}
      {rows.map((l) => {
        const own = l.owner === me || l.owner === UNKNOWN_OWNER;
        return (
          <div key={`${l.branch}:${l.path}`} className="list-row" role="row">
            <span className="lock">🔒</span>
            <span className="grow mono" title={l.path}>
              {l.path}
            </span>
            <span className="dim" style={{ width: 180 }}>
              {l.owner === UNKNOWN_OWNER ? "owner unknown" : l.owner}
            </span>
            <span className="hint" style={{ width: 120 }}>
              {l.branch}
            </span>
            <span className="hint" style={{ width: 120 }}>
              {l.acquiredAt ? formatTime(l.acquiredAt) : ""}
            </span>
            {own ? (
              <button className="mini" onClick={() => void a.releasePaths([l.path])}>
                Release
              </button>
            ) : (
              <button className="mini" onClick={() => window.confirm(`Release ${l.owner}'s lock on ${l.path}? They may still be editing it.`) && void a.releasePaths([l.path], l.owner)}>
                Release as owner…
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
