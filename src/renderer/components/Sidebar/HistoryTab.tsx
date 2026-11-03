import { useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { fileName } from "@shared/types";
import { useActions } from "../../actions";
import { useHistory, useRepo, useRevisionDetail } from "../../api/queries";
import { formatTime } from "../../selectors";
import { useUi } from "../../store/ui";
import { ContextMenu, type MenuEntry } from "../ContextMenu";

const ACTION_LABEL = { none: "", add: "A", modify: "M", delete: "D", move: "R", copy: "C" } as const;

/** Repository history (current branch): revisions → changed files → diff in the detail pane. */
export function HistoryTab() {
  const history = useHistory();
  const repo = useRepo().data;
  const selected = useUi((s) => s.historyRevision);
  const setSelected = useUi((s) => s.setHistoryRevision);
  const detail = useRevisionDetail(selected);
  const a = useActions();
  const [menu, setMenu] = useState<{ x: number; y: number; hash: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const revs = history.data ?? [];
  const virt = useVirtualizer({ count: revs.length, getScrollElement: () => ref.current, estimateSize: () => 40, overscan: 8 });

  const latest = revs[0];
  const menuItems = (hash: string): MenuEntry[] => {
    const r = revs.find((x) => x.hash === hash);
    const canAmend = !!r && r.hash === latest?.hash && !!repo?.aheadBy;
    return [
      { label: "Copy revision hash", onSelect: () => void navigator.clipboard?.writeText(hash) },
      { label: `Copy identifier (${repo?.branch ?? "branch"}@${r?.number ?? "?"})`, onSelect: () => void navigator.clipboard?.writeText(`${repo?.branch}@${r?.number}`) },
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
      <div className="group-title">
        <span className="grow">History · {repo?.branch}</span>
        <span className="hint">{revs.length ? `${revs.length} shown` : ""}</span>
      </div>
      <div ref={ref} style={{ flex: "1 1 55%", minHeight: 80, overflow: "auto" }} role="listbox" aria-label="Revisions">
        {history.isLoading && <div className="empty">Loading…</div>}
        {history.isError && <div className="empty">{history.error.message}</div>}
        <div style={{ height: virt.getTotalSize(), position: "relative" }}>
          {virt.getVirtualItems().map((vi) => {
            const r = revs[vi.index];
            if (!r) return null;
            return (
              <div
                key={r.hash}
                role="option"
                aria-selected={selected === r.hash}
                tabIndex={0}
                className={`rev-row${selected === r.hash ? " active" : ""}`}
                style={{ transform: `translateY(${vi.start}px)` }}
                onClick={() => setSelected(r.hash)}
                onKeyDown={(e) => e.key === "Enter" && setSelected(r.hash)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setSelected(r.hash);
                  setMenu({ x: e.clientX, y: e.clientY, hash: r.hash });
                }}
                title={r.hash}
              >
                <div className="row">
                  <span className="mono">#{r.number}</span>
                  <span className="grow dim">{r.author ?? "(no author)"}</span>
                  <span className="hint">{r.timestamp ? formatTime(r.timestamp) : ""}</span>
                </div>
                <div className="rev-msg">{r.message || <span className="hint">(no message)</span>}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="group-title">
        <span className="grow">{detail.data ? `#${detail.data.number} · ${detail.data.files.length} file(s)` : "Changed files"}</span>
      </div>
      <div style={{ flex: "1 1 45%", minHeight: 60, overflow: "auto" }} role="list" aria-label="Files in revision">
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
