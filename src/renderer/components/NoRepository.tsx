import { useActions } from "../actions";
import { useAppInfo, useRecentRepos } from "../api/queries";

/** Shown instead of the panes until a repository is open (e.g. first launch of the installed app). */
export function NoRepository() {
  const a = useActions();
  const recent = useRecentRepos().data ?? [];
  const info = useAppInfo().data;
  return (
    <div className="no-repo" role="main" aria-label="No repository open">
      <h1>Lore Desktop</h1>
      <p className="hint">Open the folder of a Lore repository (the directory that contains <code>.lore</code>).</p>
      <button className="btn primary" onClick={() => void a.pickRepository()} autoFocus>
        Open repository… <span className="hint">Ctrl+O</span>
      </button>
      {recent.length > 0 && (
        <section aria-label="Recent repositories">
          <div className="group-title">Recent</div>
          {recent.map((p) => (
            <div key={p} className="list-row" tabIndex={0} onClick={() => void a.openRepository(p)} onKeyDown={(e) => e.key === "Enter" && void a.openRepository(p)}>
              <span>📁</span>
              <span className="grow mono">{p}</span>
            </div>
          ))}
        </section>
      )}
      <p className="hint">
        No repository yet? Clone one with <code>lore clone lore://host:41337/name C:\path</code>. Backend: {info?.backend ?? "…"} · v{info?.version ?? ""}
      </p>
    </div>
  );
}
