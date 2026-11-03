// External diff tool launcher. The template is a command line with
// placeholders {base} (file as of the source revision), {local} (working-tree
// file or target revision) and {path} (repo-relative path), e.g.
//   "C:\Program Files\Beyond Compare 4\BCompare.exe" "{base}" "{local}"
//   code --diff {base} {local}

/** Split a command line into argv. Double quotes group; backslashes are literal (Windows paths). */
export function splitCommandLine(cmd: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  let has = false;
  for (const ch of cmd.trim()) {
    if (ch === '"') {
      quoted = !quoted;
      has = true;
    } else if (!quoted && /\s/.test(ch)) {
      if (has) out.push(cur);
      cur = "";
      has = false;
    } else {
      cur += ch;
      has = true;
    }
  }
  if (quoted) throw new Error("Unbalanced quote in external diff command");
  if (has) out.push(cur);
  return out;
}

export function buildDiffCommand(template: string, vars: { base: string; local: string; path: string }): { exe: string; args: string[] } {
  if (!template.trim()) throw new Error("No external diff tool configured. Set one in Preferences.");
  if (!template.includes("{base}") || !template.includes("{local}")) throw new Error("The external diff command must contain {base} and {local}.");
  // Substitute per-argument so paths with spaces stay one argument.
  const argv = splitCommandLine(template).map((a) => a.replaceAll("{base}", vars.base).replaceAll("{local}", vars.local).replaceAll("{path}", vars.path));
  const [exe, ...args] = argv;
  if (!exe) throw new Error("External diff command is empty");
  return { exe, args };
}
