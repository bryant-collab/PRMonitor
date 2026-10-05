import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

export const RUNTIME_OWNER_FILE = ".prmonitor-runtime-owner.json";
const key = (value: string) =>
  process.platform === "win32"
    ? path.resolve(value).toLowerCase()
    : path.resolve(value);
const within = (root: string, candidate: string) => {
  const relative = path.relative(key(root), key(candidate));
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
};
export interface RuntimePaths {
  readonly userData: string;
  readonly cache: string;
  readonly sessionData: string;
  readonly worktrees: string;
  readonly mode: "production" | "development" | "isolated";
}

/** Runs before persistence. Automated and manual development cannot silently use customer state. */
export function resolveRuntimePaths(input: {
  readonly environment: NodeJS.ProcessEnv;
  readonly packaged: boolean;
  readonly customerRoot: string;
  readonly appData: string;
  readonly temporaryRoot: string;
}): RuntimePaths {
  const env = input.environment;
  const automated =
    env.PRMONITOR_SMOKE === "1" ||
    env.PRMONITOR_TEST_MODE === "1" ||
    env.PRMONITOR_ISOLATED_ROOT !== undefined ||
    env.NODE_ENV === "test" ||
    env.VITEST === "true";
  if (automated) {
    const root = env.PRMONITOR_ISOLATED_ROOT;
    const userData = env.PRMONITOR_USER_DATA_DIR;
    const cache = env.PRMONITOR_CACHE_DIR;
    const worktrees = env.PRMONITOR_WORKTREE_DIR;
    if (
      ![root, userData, cache, worktrees].every(
        (value) => value !== undefined && path.isAbsolute(value),
      )
    )
      throw Error("ISOLATED_RUNTIME_PATHS_MISSING");
    const ownedRoot = root as string;
    if (
      !within(input.temporaryRoot, ownedRoot) ||
      key(input.temporaryRoot) === key(ownedRoot) ||
      within(input.customerRoot, ownedRoot) ||
      within(ownedRoot, input.customerRoot)
    )
      throw Error("ISOLATED_RUNTIME_ROOT_UNSAFE");
    const rootInfo = lstatSync(ownedRoot);
    if (
      !rootInfo.isDirectory() ||
      rootInfo.isSymbolicLink() ||
      key(realpathSync(ownedRoot)) !== key(ownedRoot)
    )
      throw Error("ISOLATED_RUNTIME_REPARSE_POINT");
    const marker = JSON.parse(
      readFileSync(path.join(ownedRoot, RUNTIME_OWNER_FILE), "utf8"),
    ) as { owner?: string; root?: string };
    if (
      marker.owner !== "prmonitor-runtime-fixture" ||
      marker.root === undefined ||
      key(marker.root) !== key(ownedRoot)
    )
      throw Error("ISOLATED_RUNTIME_OWNER_MISMATCH");
    for (const child of [userData, cache, worktrees] as string[]) {
      if (!within(ownedRoot, child) || key(child) === key(ownedRoot))
        throw Error("ISOLATED_RUNTIME_PATH_OUTSIDE_OWNER");
      let current = path.resolve(child);
      while (key(current) !== key(ownedRoot)) {
        if (
          existsSync(current) &&
          (lstatSync(current).isSymbolicLink() ||
            key(realpathSync(current)) !== key(current))
        )
          throw Error("ISOLATED_RUNTIME_REPARSE_POINT");
        current = path.dirname(current);
      }
    }
    const roots = [userData, cache, worktrees] as string[];
    for (let i = 0; i < roots.length; i++)
      for (let j = i + 1; j < roots.length; j++)
        if (within(roots[i]!, roots[j]!) || within(roots[j]!, roots[i]!))
          throw Error("ISOLATED_RUNTIME_ROOTS_OVERLAP");
    return {
      mode: "isolated",
      userData: userData as string,
      cache: cache as string,
      sessionData: path.join(cache as string, "session"),
      worktrees: worktrees as string,
    };
  }
  if (
    env.PRMONITOR_USER_DATA_DIR !== undefined ||
    env.PRMONITOR_CACHE_DIR !== undefined ||
    env.PRMONITOR_WORKTREE_DIR !== undefined
  )
    throw Error("RUNTIME_PATH_OVERRIDE_REQUIRES_ISOLATION");
  const production =
    input.packaged || env.PRMONITOR_USE_PRODUCTION_PROFILE === "1";
  const userData = production
    ? input.customerRoot
    : path.join(input.appData, "PRMonitor Development");
  const cache = path.join(userData, "cache");
  return {
    mode: production ? "production" : "development",
    userData,
    cache,
    sessionData: path.join(cache, "session"),
    worktrees: path.join(userData, "worktrees"),
  };
}
