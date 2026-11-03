import { resolveViaCli } from "@shared/commands";
import { useActions } from "../actions";
import { useFiles, useRepo } from "../api/queries";

/** Working-copy health at the top of the Changes tab. Quiet when everything is in sync. */
export function HealthCard() {
  const repo = useRepo().data;
  const files = useFiles().data ?? [];
  const a = useActions();
  if (!repo) return null;
  const conflicts = files.filter((f) => f.conflict);
  const items: { tone: "warn" | "info" | "error"; text: string; action?: { label: string; run: () => void }; cli?: string[] }[] = [];

  if (repo.offline && repo.remoteUrl) items.push({ tone: "warn", text: "Server unreachable — working offline. Push and Sync will fail until it is back." });
  if (repo.mergePending)
    items.push({
      tone: "error",
      text: conflicts.length ? `Merge in progress with ${conflicts.length} unresolved conflict(s). Resolve via CLI, then commit the merge.` : "Merge in progress. Commit to finish it, or abort via CLI.",
      cli: [...conflicts.slice(0, 3).flatMap((f) => [resolveViaCli.mergeMine(f.path), resolveViaCli.mergeTheirs(f.path)]), resolveViaCli.mergeAbort()],
    });
  else if (conflicts.length) items.push({ tone: "error", text: `${conflicts.length} file(s) in conflict. Resolve via CLI.`, cli: conflicts.slice(0, 3).map((f) => resolveViaCli.mergeMine(f.path)) });
  if (repo.behindBy && repo.aheadBy) items.push({ tone: "warn", text: `Diverged: ${repo.aheadBy} local and ${repo.behindBy} remote revision(s). Sync merges them; then push.`, action: { label: "Sync", run: () => void a.sync() } });
  else if (repo.behindBy) items.push({ tone: "info", text: `${repo.behindBy} new revision(s) on the server.`, action: { label: "Sync", run: () => void a.sync() } });
  else if (repo.aheadBy) items.push({ tone: "info", text: `${repo.aheadBy} local revision(s) not pushed yet.`, action: { label: "Push", run: () => void a.push() } });

  if (!items.length) return null;
  return (
    <div className="health" role="status" aria-label="Working copy status">
      {items.map((it, i) => (
        <div key={i} className={`health-item ${it.tone}`}>
          <div className="row">
            <span className="grow">{it.text}</span>
            {it.action && (
              <button className="mini" onClick={it.action.run}>
                {it.action.label}
              </button>
            )}
          </div>
          {it.cli?.map((c) => (
            <code key={c}>{c}</code>
          ))}
        </div>
      ))}
    </div>
  );
}
