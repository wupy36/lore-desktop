import { useState } from "react";
import { fileName } from "@shared/types";
import { useActions } from "../../actions";
import { useHistory, useRepo, useRevisionDetail } from "../../api/queries";
import { useUi } from "../../store/ui";
import { ContextMenu, type MenuEntry } from "../ContextMenu";
import { LoreTimelineView } from "../timeline/LoreTimelineView";

const ACTION_LABEL = { none: "", add: "A", modify: "M", delete: "D", move: "R", copy: "C" } as const;

/** Repository history (current branch): revisions → changed files → diff in the detail pane. */
export function HistoryTab() {
  const history = useHistory();
  const repo = useRepo().data;
  const selected = useUi((s) => s.historyRevision);
  const detail = useRevisionDetail(selected);
  const a = useActions();
  const [menu, setMenu] = useState<{ x: number; y: number; hash: string } | null>(null);
  const revs = history.data ?? [];
  const latest = revs[0];

  const menuItems = (hash: string): MenuEntry[] => {
    const r = revs.find((x) => x.hash === hash);
    const canAmend = !!r && r.hash === latest?.hash && !!repo?.aheadBy;
    return [
      { label: "Copy revision hash", onSelect: () => void navigator.clipboard?.writeText(hash) },
      { label: r ? `Copy identifier (${r.branch || repo?.branch}@${r.number})` : "Copy identifier", disabled: !r, onSelect: () => r && void navigator.clipboard?.writeText(`${r.branch || repo?.branch}@${r.number}`) },
      "sep",
      {
        label: "Amend message…",
        disabled: !canAmend,
        onSelect: () => {
          const m = window.prompt("New commit message", r?.message ?? "");
          if (m && m.trim()) void a.amend(m.trim());
        },
      },
    ];
  };

  return (
    <div className="pane-body" style={{ display: "flex", flexDirection: "column" }}>
      <LoreTimelineView onContextMenu={(hash, e) => (useUi.getState().setHistoryRevision(hash), setMenu({ x: e.clientX, y: e.clientY, hash }))} />
      <div className="group-title">
        <span className="grow">{detail.data ? `#${detail.data.number} · ${detail.data.files.length} file(s)` : "Changed files"}</span>
      </div>
      <div style={{ flex: "1 1 40%", minHeight: 60, overflow: "auto" }} role="list" aria-label="Files in revision">
        {!selected && <div className="empty">Select a revision.</div>}
        {detail.isLoading && <div className="empty">Loading…</div>}
        {detail.isError && <div className="empty">{detail.error.message}</div>}
        {detail.data?.files.map((f) => (
          <div
            key={f.path}
            role="listitem"
            className="list-row"
            title={`${f.path} — click to diff against the parent revision`}
            onClick={() =>
              useUi.getState().openDiff({ path: f.path, source: detail.data?.parents[0] ?? undefined, target: detail.data?.hash, label: `#${detail.data?.number} vs parent` })
            }
          >
            <span className={`state state-${f.action === "add" ? "added" : f.action === "delete" ? "deleted" : "modified"}`} style={{ width: 14 }}>
              {ACTION_LABEL[f.action]}
            </span>
            <span className="grow">{fileName(f.path)}</span>
            <span className="hint">{f.path.slice(0, Math.max(0, f.path.lastIndexOf("/")))}</span>
          </div>
        ))}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.hash)} onClose={() => setMenu(null)} />}
    </div>
  );
}
