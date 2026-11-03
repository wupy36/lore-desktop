import { useMemo, useState } from "react";
import { useActions } from "../actions";
import { useDependencies, useFiles } from "../api/queries";
import { useUi } from "../store/ui";

/** File dependency graph (Lore `file dependency`): what this file needs, and what uses it. */
export function DepsTab({ path }: { path: string }) {
  const [recursive, setRecursive] = useState(false);
  const deps = useDependencies(path, { recursive });
  const usedBy = useDependencies(path, { reverse: true });
  const filesData = useFiles().data;
  const files = useMemo(() => filesData ?? [], [filesData]);
  const a = useActions();
  const [target, setTarget] = useState("");
  const [tags, setTags] = useState("");
  const open = (p: string) => useUi.getState().openDetail(p, "deps");
  const known = files.some((f) => f.path === target.trim());
  // Suggest from what's typed (≤30) instead of rendering every path as an <option>:
  // thousands of options cost a full DOM rebuild on every render of this tab.
  const suggestions = useMemo(() => {
    const q = target.trim().toLowerCase();
    if (q.length < 2) return [];
    const out: string[] = [];
    for (const f of files) {
      if (f.path.toLowerCase().includes(q) && f.path !== path) out.push(f.path);
      if (out.length >= 30) break;
    }
    return out;
  }, [target, files, path]);

  return (
    <div className="pane-body">
      <div className="group-title">
        <span className="grow">Depends on {deps.data ? `(${deps.data.length})` : ""}</span>
        <label className="hint">
          <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} /> recursive
        </label>
      </div>
      {deps.isError && <div className="empty">{deps.error.message}</div>}
      {deps.data?.length === 0 && <div className="empty">No dependencies.</div>}
      {deps.data?.map((d) => (
        <div key={d.path} className="list-row" style={{ paddingLeft: 8 + d.depth * 14 }}>
          <span className="grow mono" style={{ cursor: "pointer" }} onClick={() => open(d.path)} title={`Open ${d.path}`}>
            {d.path}
          </span>
          {d.tags.map((t) => (
            <span key={t} className="badge">
              {t}
            </span>
          ))}
          {d.depth === 0 && (
            <button className="mini" aria-label={`Remove dependency ${d.path}`} onClick={() => void a.depRemove(path, [d.path])}>
              ✕
            </button>
          )}
        </div>
      ))}
      <form
        className="row"
        style={{ padding: 6 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!target.trim()) return;
          void a.depAdd(path, [target.trim()], tags.split(",").map((t) => t.trim()).filter(Boolean)).then(() => setTarget(""));
        }}
      >
        <input className="input mono" style={{ flex: 2 }} list="dep-targets" placeholder="Add dependency (repository path)" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Dependency path" />
        <input className="input" style={{ flex: 1 }} placeholder="tags, comma-separated" value={tags} onChange={(e) => setTags(e.target.value)} aria-label="Dependency tags" />
        <button className="mini" type="submit" disabled={!target.trim()} title={known ? "lore file dependency add" : "Path not in the file list (Lore may still accept it)"}>
          Add
        </button>
        <datalist id="dep-targets">
          {suggestions.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </form>
      <p className="hint" style={{ padding: "0 8px" }}>
        Dependency changes are staged: they go to the server with your next commit that includes a file change.
      </p>

      <div className="group-title">
        <span className="grow">Used by {usedBy.data ? `(${usedBy.data.length})` : ""}</span>
      </div>
      {usedBy.data?.length === 0 && <div className="empty">Nothing depends on this file.</div>}
      {usedBy.data?.map((d) => (
        <div key={d.path} className="list-row">
          <span className="grow mono" style={{ cursor: "pointer" }} onClick={() => open(d.path)}>
            {d.path}
          </span>
        </div>
      ))}
      <div className="row" style={{ padding: 8 }}>
        <button className="btn" onClick={() => void a.syncWithDependencies([path])} title="lore sync --root-file <path> --dependency-recursive">
          Sync this file + dependencies
        </button>
      </div>
    </div>
  );
}
