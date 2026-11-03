import { useEffect, useState } from "react";
import type { ViewPreview } from "@shared/types";
import { useActions } from "../actions";
import { useApi } from "../api/client";
import { useFiles, useView } from "../api/queries";
import { formatSize } from "../selectors";
import { useUi } from "../store/ui";
import { Modal } from "./Modal";

const HELP = `Every line EXCLUDES matching paths; "!" re-includes; the last rule matching a file decides.
Names without "/" match at any depth (*, *.uasset); paths match from the root (Content/Maps/**).
Include a folder with  !Folder/**   ·   exclude one with  Folder/**   ·   "*" first = start from nothing.`;

/** Edit the instance's view filter (.lore/view), preview with a dry-run sync, apply with `lore sync --view`. */
export function ViewEditor({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const view = useView(true);
  const append = useUi((s) => s.viewDraftAppend);
  const a = useActions();
  const files = useFiles().data;
  const [text, setText] = useState<string | null>(null);
  const [preview, setPreview] = useState<ViewPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (text !== null || !view.data) return;
    const base = view.data.rules.join("\n");
    setText(append ? `${base}${base ? "\n" : ""}${append}` : base);
  }, [view.data, append, text]);

  const rules = (text ?? "").split("\n").map((l) => l.trimEnd());
  const runPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      const p = await api.invoke("view:preview", { rules: rules.filter((r, i) => r || i < rules.length - 1) });
      // Lore's dry run reports size 0 for files it would remove; take sizes from the tree listing.
      const size = new Map((files ?? []).map((f) => [f.path, f.size]));
      const fill = (l: ViewPreview["remove"]) => l.map((f) => ({ ...f, size: f.size || size.get(f.path) || 0 }));
      setPreview({ materialize: fill(p.materialize), remove: fill(p.remove) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const apply = () => {
    const removing = preview?.remove.length ?? 0;
    if (removing && !window.confirm(`Apply the view? ${removing} file(s) will be removed from disk (they stay in the repository and come back if you include them again).`)) return;
    void a.applyView(rules.filter((r) => r.trim() !== "" || false)).then(onClose);
  };

  return (
    <Modal title="Workspace view" onClose={onClose} width={820}>
      <pre className="hint" style={{ whiteSpace: "pre-wrap", margin: "6px 2px" }}>
        {HELP}
      </pre>
      <div className="row" style={{ margin: "4px 0" }}>
        <button className="mini" onClick={() => (setText("# Full repository\n"), setPreview(null))}>
          Everything
        </button>
        <button className="mini" onClick={() => (setText("# Start from nothing, then include what you need\n*\n!*.uproject\n"), setPreview(null))}>
          Start sparse
        </button>
        <span className="hint grow">Applies to this workspace only; it never travels with commits or clones.</span>
      </div>
      <textarea
        className="input mono"
        style={{ width: "100%", height: 200, fontFamily: "var(--font-mono)" }}
        aria-label="View rules"
        spellCheck={false}
        value={text ?? ""}
        onChange={(e) => (setText(e.target.value), setPreview(null))}
      />
      {view.data && view.data.stored.length > 0 && view.data.rules !== view.data.stored && (
        <p className="hint">Lore stores this view normalized (lowercase, no comments): {view.data.stored.join(" · ")}</p>
      )}
      <div className="row" style={{ margin: "6px 0" }}>
        <button className="btn" disabled={busy} onClick={() => void runPreview()} title="lore --dry-run sync --view <file>">
          {busy ? "Previewing…" : "Preview"}
        </button>
        <button className="btn primary" disabled={!preview || busy} onClick={apply} title="lore sync --view <file>">
          Apply
        </button>
        {preview && (
          <span className="hint">
            +{preview.materialize.length} file(s) ({formatSize(preview.materialize.reduce((n, f) => n + f.size, 0))}) to fetch · −{preview.remove.length} file(s) (
            {formatSize(preview.remove.reduce((n, f) => n + f.size, 0))}) to remove from disk
          </span>
        )}
      </div>
      {error && <div className="cli-hint">{error}</div>}
      {preview && (preview.materialize.length > 0 || preview.remove.length > 0) && (
        <div className="view-preview" aria-label="View preview">
          {[...preview.remove.slice(0, 200).map((f) => ({ ...f, k: "−" })), ...preview.materialize.slice(0, 200).map((f) => ({ ...f, k: "+" }))].map((f) => (
            <div key={f.k + f.path} className={`list-row ${f.k === "+" ? "state-added" : "state-deleted"}`}>
              <span style={{ width: 14 }}>{f.k}</span>
              <span className="grow mono">{f.path}</span>
              <span className="hint">{f.size ? formatSize(f.size) : "—"}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
