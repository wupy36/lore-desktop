// Pure derivations over the file list (unit-tested; no React).
import { changeGroup, type ChangeGroup, type FileEntry } from "@shared/types";

export interface FileFilter {
  dir: string;
  group: ChangeGroup | null;
  viewMode: "all" | "changed";
  text: string;
}

export function filterFiles(files: readonly FileEntry[], f: FileFilter): FileEntry[] {
  const prefix = f.dir ? `${f.dir}/` : "";
  const needle = f.text.trim().toLowerCase();
  return files.filter((x) => {
    if (f.group) {
      if (changeGroup(x) !== f.group) return false;
    } else {
      if (prefix && !x.path.startsWith(prefix)) return false;
      if (f.viewMode === "changed" && changeGroup(x) === null) return false;
    }
    return !needle || x.path.toLowerCase().includes(needle);
  });
}

export function groupChanges(files: readonly FileEntry[]): Record<ChangeGroup, FileEntry[]> {
  const out: Record<ChangeGroup, FileEntry[]> = { staged: [], unstaged: [], untracked: [] };
  for (const f of files) {
    const g = changeGroup(f);
    if (g) out[g].push(f);
  }
  return out;
}

export interface DirNode {
  name: string;
  path: string;
  children: DirNode[];
  fileCount: number; // recursive
  changedCount: number; // recursive
}

export function buildDirTree(files: readonly FileEntry[]): DirNode {
  const root: DirNode = { name: "", path: "", children: [], fileCount: 0, changedCount: 0 };
  const index = new Map<string, DirNode>([["", root]]);
  for (const f of files) {
    const changed = changeGroup(f) !== null;
    const parts = f.path.split("/");
    parts.pop();
    let node = root;
    node.fileCount++;
    if (changed) node.changedCount++;
    let acc = "";
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      let next = index.get(acc);
      if (!next) {
        next = { name: part, path: acc, children: [], fileCount: 0, changedCount: 0 };
        index.set(acc, next);
        node.children.push(next);
      }
      next.fileCount++;
      if (changed) next.changedCount++;
      node = next;
    }
  }
  const sort = (n: DirNode) => {
    n.children.sort((a, b) => a.name.localeCompare(b.name));
    n.children.forEach(sort);
  };
  sort(root);
  return root;
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

export function formatTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
