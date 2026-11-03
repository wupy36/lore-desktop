import { resolveViaCli } from "@shared/commands";

/** Non-goal: conflict UIs. Show the exact CLI command instead. */
export const resolveViaCliHint = (path: string): string => `${resolveViaCli.mergeMine(path)}   # or: resolve theirs`;
