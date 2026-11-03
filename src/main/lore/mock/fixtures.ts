// Deterministic mock repository: a UE-style game project with ~12k files.
// Generated (seeded PRNG) rather than stored as JSON to keep the repo small.
import { BINARY_EXTS, type Branch, type FileEntry, type Lock, type RemoteRepo, type Revision } from "@shared/types";

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}



const AUTHORS = ["ada@studio.dev", "ben@studio.dev", "chen@studio.dev", "dana@studio.dev", null];
const MESSAGES = [
  "Tune weapon recoil curves",
  "Add footstep audio for gravel",
  "Fix nav mesh seam in Level_02",
  "Refactor inventory component",
  "Lightmap rebuild for Hub",
  "Update character LODs",
  "Hook up interaction prompt UI",
  "Optimize occlusion culling",
  "New VFX for muzzle flash",
  "Config: bump streaming pool size",
];

interface Tree {
  dir: string;
  exts: string[];
  count: number;
}

const TREES: Tree[] = [
  { dir: "Source/Game/Player", exts: ["cpp", "h"], count: 420 },
  { dir: "Source/Game/Weapons", exts: ["cpp", "h"], count: 380 },
  { dir: "Source/Game/AI", exts: ["cpp", "h"], count: 300 },
  { dir: "Source/Game/UI", exts: ["cpp", "h"], count: 260 },
  { dir: "Source/Engine/Render", exts: ["cpp", "h", "usf"], count: 640 },
  { dir: "Config", exts: ["ini"], count: 60 },
  { dir: "Content/Characters/Hero", exts: ["uasset"], count: 1400 },
  { dir: "Content/Characters/Enemies", exts: ["uasset"], count: 1900 },
  { dir: "Content/Weapons", exts: ["uasset"], count: 1300 },
  { dir: "Content/Environment/Props", exts: ["uasset"], count: 2300 },
  { dir: "Content/Maps", exts: ["umap"], count: 40 },
  { dir: "Content/Audio/SFX", exts: ["wav", "uasset"], count: 1500 },
  { dir: "Content/Textures", exts: ["png", "uasset"], count: 1500 },
];

export interface MockRepoData {
  files: FileEntry[];
  revisions: Revision[]; // newest first
  branches: Branch[];
  locks: Lock[];
  remotes: RemoteRepo[];
  view: string[];
}

const hex = (rnd: () => number, n: number) => Array.from({ length: n }, () => Math.floor(rnd() * 16).toString(16)).join("");

export function generateMockRepo(seed = 1337): MockRepoData {
  const rnd = mulberry32(seed);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)] as T;
  const now = Date.UTC(2026, 10, 1, 12, 0, 0);

  const revCount = 240;
  const revisions: Revision[] = [];
  for (let n = revCount; n >= 1; n--) {
    revisions.push({
      number: n,
      hash: hex(rnd, 64),
      branch: "main",
      author: pick(AUTHORS),
      timestamp: now - (revCount - n) * 3_600_000 * 7,
      message: `${pick(MESSAGES)} (#${n})`,
      parents: [],
    });
  }
  for (let i = 0; i < revisions.length - 1; i++) (revisions[i] as Revision).parents = [(revisions[i + 1] as Revision).hash];

  const files: FileEntry[] = [];
  for (const t of TREES) {
    for (let i = 0; i < t.count; i++) {
      const ext = pick(t.exts);
      const sub = i % 7 === 0 ? `Sub${i % 13}/` : "";
      const base = t.dir.split("/").pop() ?? "File";
      const path = `${t.dir}/${sub}${base}_${String(i).padStart(4, "0")}.${ext}`;
      const binary = BINARY_EXTS.has(ext);
      files.push({
        path,
        size: binary ? Math.floor(rnd() * 80_000_000) + 4096 : Math.floor(rnd() * 60_000) + 200,
        action: "none",
        staged: false,
        dirty: false,
        conflict: false,
        fromPath: null,
        lastRevision: Math.floor(rnd() * revCount) + 1,
        lockOwner: null,
        binary,
      });
    }
  }
  files.push(
    { path: ".loreignore", size: 312, action: "none", staged: false, dirty: false, conflict: false, fromPath: null, lastRevision: 1, lockOwner: null, binary: false },
    { path: "Game.uproject", size: 1820, action: "none", staged: false, dirty: false, conflict: false, fromPath: null, lastRevision: 3, lockOwner: null, binary: false },
  );

  // Local changes: modified (dirty), staged, deleted, untracked.
  const mutate = (count: number, fn: (f: FileEntry) => void) => {
    for (let i = 0; i < count; i++) fn(pick(files));
  };
  mutate(48, (f) => Object.assign(f, { dirty: true, action: "modify" }));
  mutate(12, (f) => Object.assign(f, { dirty: true, staged: true, action: "modify" }));
  mutate(3, (f) => Object.assign(f, { dirty: true, action: "delete" }));
  for (let i = 0; i < 9; i++) {
    const path = `Content/Weapons/New/WPN_Prototype_${i}.uasset`;
    files.push({ path, size: 2_000_000 + i * 1000, action: "add", staged: i < 2, dirty: true, conflict: false, fromPath: null, lastRevision: null, lockOwner: null, binary: true });
  }
  files.push({ path: "Source/Game/Player/HeroMovement.cpp", size: 18_204, action: "modify", staged: false, dirty: true, conflict: false, fromPath: null, lastRevision: 231, lockOwner: null, binary: false });

  const locks: Lock[] = [];
  const binaries = files.filter((f) => f.binary && f.action === "none");
  for (let i = 0; i < 25; i++) {
    const f = pick(binaries);
    const owner = pick(["ada@studio.dev", "ben@studio.dev", "me@studio.dev"]);
    f.lockOwner = owner;
    locks.push({ path: f.path, owner, branch: "main", acquiredAt: now - i * 600_000 });
  }

  const branches: Branch[] = [
    { name: "main", id: hex(rnd, 32), latest: revCount, latestHash: revisions[0]?.hash ?? null, current: true, protected: true, archived: false, where: "both", creator: "ada@studio.dev" },
    { name: "dev", id: hex(rnd, 32), latest: 37, latestHash: null, current: false, protected: false, archived: false, where: "both", creator: "ben@studio.dev" },
    { name: "feature/grapple-hook", id: hex(rnd, 32), latest: 12, latestHash: null, current: false, protected: false, archived: false, where: "local", creator: "me@studio.dev" },
    { name: "release/0.3", id: hex(rnd, 32), latest: 4, latestHash: null, current: false, protected: true, archived: false, where: "remote", creator: "chen@studio.dev" },
  ];

  const remotes: RemoteRepo[] = [
    { name: "ShooterGame", id: hex(rnd, 32), url: "lore://127.0.0.1:41337/ShooterGame", description: "First-person shooter main project" },
    { name: "SharedPlugins", id: hex(rnd, 32), url: "lore://127.0.0.1:41337/SharedPlugins", description: "Engine plugins shared across titles" },
    { name: "Cinematics", id: hex(rnd, 32), url: "lore://127.0.0.1:41337/Cinematics", description: "Sequencer assets" },
  ];

  return { files, revisions, branches, locks, remotes, view: ["Source/**", "Config/**", "Content/Characters/**", "Content/Maps/**"] };
}
