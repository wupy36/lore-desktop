import { useMemo, useState } from "react";
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

  const toggle = (p: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });

  return (
    <div className="pane-body" role="tree" aria-label="Workspace">
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
