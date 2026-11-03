// Collect licenses of everything shipped inside the app into build/licenses/:
//   THIRD-PARTY-NOTICES.md  runtime npm packages (renderer bundle + main + Lore SDK) and their dependency closure
//   LICENSE.txt             this app's license
//   versions.json           versions shown in About
// Run automatically by `pnpm build`.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "build", "licenses");
// Packages whose code ends up in out/ (bundled) or in the packaged node_modules.
const ROOTS = ["react", "react-dom", "@tanstack/react-query", "@tanstack/react-table", "@tanstack/react-virtual", "zustand", "zod", "@lore-vcs/sdk", "koffi"];

const pkgDir = (name, from = root) => {
  for (let d = from; ; d = dirname(d)) {
    const p = join(d, "node_modules", name);
    if (existsSync(join(p, "package.json"))) return p;
    if (dirname(d) === d) return null;
  }
};

const seen = new Map();
const visit = (name, from) => {
  const dir = pkgDir(name, from);
  if (!dir || seen.has(dir)) return;
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  seen.set(dir, pkg);
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) visit(dep, dir);
};
ROOTS.forEach((n) => visit(n, root));

const licenseFiles = (dir) => readdirSync(dir).filter((f) => /^(licen[cs]e|copying|notice|.*third-party-notices)/i.test(f));
const sections = [...seen.entries()]
  .sort(([, a], [, b]) => a.name.localeCompare(b.name))
  .map(([dir, pkg]) => {
    const texts = licenseFiles(dir).map((f) => readFileSync(join(dir, f), "utf8").trim());
    return `## ${pkg.name} ${pkg.version}\n\nLicense: ${pkg.license ?? "see below"}${pkg.repository ? `\nSource: ${typeof pkg.repository === "string" ? pkg.repository : pkg.repository.url}` : ""}\n\n${texts.join("\n\n---\n\n") || "(no license file in package)"}\n`;
  });

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "THIRD-PARTY-NOTICES.md"), `# Third-party notices\n\nLore Desktop includes the following packages.\n\n${sections.join("\n")}`);
writeFileSync(join(out, "LICENSE.txt"), readFileSync(join(root, "LICENSE"), "utf8"));
const ver = (n) => [...seen.values()].find((p) => p.name === n)?.version ?? null;
writeFileSync(join(out, "versions.json"), JSON.stringify({ sdk: ver("@lore-vcs/sdk"), koffi: ver("koffi") }, null, 2));
console.log(`licenses: ${seen.size} packages -> ${out}`);
