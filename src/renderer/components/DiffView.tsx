import type { DiffResult } from "@shared/types";
import { formatSize } from "../selectors";

export function DiffView({ diff, onExternal }: { diff: DiffResult; onExternal: () => void }) {
  if (diff.binary || diff.unified === null) {
    return (
      <div>
        <dl className="kv">
          <dt>Type</dt>
          <dd>Binary — no inline diff</dd>
          <dt>Source</dt>
          <dd className="mono">{diff.source ? `${formatSize(diff.source.size)} · ${diff.source.hash.slice(0, 16)}… @ ${diff.source.revision.slice(0, 12)}` : "—"}</dd>
          <dt>Target</dt>
          <dd className="mono">{diff.target ? `${formatSize(diff.target.size)} · ${diff.target.hash.slice(0, 16)}… @ ${diff.target.revision.slice(0, 12)}` : "—"}</dd>
          <dt>Δ size</dt>
          <dd>{diff.source && diff.target ? `${diff.target.size - diff.source.size >= 0 ? "+" : "−"}${formatSize(Math.abs(diff.target.size - diff.source.size))}` : "—"}</dd>
        </dl>
        <div style={{ padding: "0 8px" }}>
          <button className="btn" onClick={onExternal} title="Configure the tool in settings (Phase 3)">
            Open in external diff tool
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="diff" role="document" aria-label={`Diff of ${diff.path}`}>
      {diff.unified.split("\n").map((l, i) => {
        const cls = l.startsWith("+++") || l.startsWith("---") ? "meta" : l.startsWith("@@") ? "hunk" : l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : "";
        return (
          <div key={i} className={`l ${cls}`}>
            {l || " "}
          </div>
        );
      })}
    </div>
  );
}
