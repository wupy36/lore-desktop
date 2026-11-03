import { useMemo, useState } from "react";
import { useActions } from "../actions";
import { useBranches, useRepo } from "../api/queries";
import { buildCommands, fuzzyScore } from "../commands";
import { Modal } from "./Modal";

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const a = useActions();
  const repo = useRepo().data;
  const branchData = useBranches().data;
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const all = useMemo(() => buildCommands(a, { hasRepo: !!repo, branches: branchData ?? [] }), [a, repo, branchData]);
  const shown = useMemo(
    () =>
      all
        .map((c) => ({ c, s: fuzzyScore(q, `${c.title} ${c.group} ${c.cli ?? ""}`) }))
        .filter((x): x is { c: (typeof all)[number]; s: number } => x.s !== null)
        .sort((x, y) => Number(x.c.enabled === false) - Number(y.c.enabled === false) || x.s - y.s)
        .map((x) => x.c),
    [all, q],
  );
  const run = (i: number) => {
    const c = shown[i];
    if (!c || c.enabled === false) return;
    onClose();
    c.run();
  };

  return (
    <Modal title="Command palette" onClose={onClose} width={640}>
      <input
        className="input"
        style={{ width: "100%", height: 30, margin: "6px 0" }}
        placeholder="Type a command…"
        aria-label="Command"
        value={q}
        onChange={(e) => (setQ(e.target.value), setIdx(0))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setIdx((i) => Math.min(shown.length - 1, i + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setIdx((i) => Math.max(0, i - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            run(idx);
          }
        }}
      />
      <div role="listbox" aria-label="Commands" style={{ maxHeight: "55vh", overflow: "auto" }}>
        {shown.map((c, i) => (
          <div
            key={c.id}
            role="option"
            aria-selected={i === idx}
            aria-disabled={c.enabled === false}
            className={`list-row palette-row${i === idx ? " active" : ""}${c.enabled === false ? " disabled" : ""}`}
            onMouseEnter={() => setIdx(i)}
            onClick={() => run(i)}
          >
            <span className="hint" style={{ width: 84 }}>
              {c.group}
            </span>
            <span className="grow">{c.title}</span>
            {c.cli && <span className="hint mono">{c.cli}</span>}
            {c.keys && <span className="badge">{c.keys}</span>}
          </div>
        ))}
        {!shown.length && <div className="empty">No matching command.</div>}
      </div>
    </Modal>
  );
}
