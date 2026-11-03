import { useMemo, useState } from "react";
import { useView } from "../../api/queries";
import { ContextMenu } from "../ContextMenu";
import { useFiles } from "../../api/queries";
import { buildDirTree, type DirNode } from "../../selectors";
import { useUi } from "../../store/ui";

function flatten(node: DirNode, open: ReadonlySet<string>, depth: number, out: { node: DirNode; depth: number }[]) {
  for (const c of node.children) {
    out.push({ node: c, depth });
    if (open.has(c.path)) flatten(c, open, depth + 1, out);
  }
  return out;
}

export function WorkspaceTab() {
  const files = useFiles().data;
  const dir = useUi((s) => s.dir);
  const group = useUi((s) => s.group);
  const setDir = useUi((s) => s.setDir);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(["Content", "Source"]));
  const tree = useMemo(() => buildDirTree(files ?? []), [files]);
  const rows = useMemo(() => flatten(tree, open, 0, []), [tree, open]);
  const view = useView(true).data;
  const ruleCount = (view?.stored ?? []).length;
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null);

  const toggle = (p: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });

  return (
    <div className="pane-body" role="tree" aria-label="Workspace">
      <div className="group-title">
        <span className="grow">{ruleCount ? `View: ${ruleCount} rule(s) — sparse workspace` : "View: full repository"}</span>
        <button className="mini" onClick={() => useUi.getState().openViewEditor()} title="Edit which folders are on disk (lore sync --view)">
          Edit view…
        </button>
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: `Include ${menu.path}/ in view…`, onSelect: () => useUi.getState().openViewEditor(`!${menu.path}/**`) },
            { label: `Exclude ${menu.path}/ from view…`, onSelect: () => useUi.getState().openViewEditor(`${menu.path}/**`) },
          ]}
        />
      )}
      <div className={`list-row${dir === "" && !group ? " active" : ""}`} role="treeitem" onClick={() => setDir("")}>
        <span className="tree-toggle">▾</span>
        <span className="grow">/ (root)</span>
        <span className="hint">{tree.fileCount}</span>
      </div>
      {rows.map(({ node, depth }) => (
        <div
          key={node.path}
          role="treeitem"
          aria-expanded={node.children.length ? open.has(node.path) : undefined}
          tabIndex={0}
          className={`list-row${dir === node.path && !group ? " active" : ""}`}
          style={{ paddingLeft: 8 + (depth + 1) * 14 }}
          onClick={() => setDir(node.path)}
          onDoubleClick={() => toggle(node.path)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, path: node.path });
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") toggle(node.path);
            if (e.key === "Enter") setDir(node.path);
          }}
        >
          <span
            className="tree-toggle"
            onClick={(e) => {
              e.stopPropagation();
              toggle(node.path);
            }}
          >
            {node.children.length ? (open.has(node.path) ? "▾" : "▸") : ""}
          </span>
          <span className="grow">{node.name}</span>
          {node.changedCount > 0 && <span className="state state-modified">{node.changedCount}✎</span>}
          <span className="hint">{node.fileCount}</span>
        </div>
      ))}
    </div>
  );
}
