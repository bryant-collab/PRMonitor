import { lstat, realpath, readdir } from "node:fs/promises";
import path from "node:path";
import { f29HasControlCharacter } from "../../shared/f29-security";

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
export interface ClaudePolicyMetadata {
  readonly supported: boolean;
  readonly reason:
    "compatible" | "launch_commands" | "billing_override" | "unknown";
}
/** Project only nonsecret policy decisions from the provider-owned settings API. */
export function projectClaudePolicy(value: unknown): ClaudePolicyMetadata {
  const settings = record(record(value)?.effective);
  if (!settings || !Array.isArray(record(value)?.sources))
    return { supported: false, reason: "unknown" };
  for (const key of [
    "hooks",
    "policyHelper",
    "apiKeyHelper",
    "awsAuthRefresh",
    "awsCredentialExport",
    "gcpAuthRefresh",
    "proxyAuthHelper",
    "otelHeadersHelper",
    "statusLine",
    "fileSuggestion",
    "processWrapper",
    "managedMcpServers",
    "enabledPlugins",
  ]) {
    const item = settings[key];
    if (
      item != null &&
      (typeof item !== "object" || Object.keys(item).length > 0)
    )
      return { supported: false, reason: "launch_commands" };
  }
  if (
    settings.env != null &&
    Object.keys(record(settings.env) ?? { unknown: true }).length > 0
  )
    return { supported: false, reason: "billing_override" };
  if (
    settings.forceLoginMethod != null &&
    settings.forceLoginMethod !== "claudeai"
  )
    return { supported: false, reason: "billing_override" };
  return { supported: true, reason: "compatible" };
}

export const CLAUDE_READ_TOOLS = ["Read", "Glob", "Grep"];
export function claudeTools(write: boolean): string[] {
  return [...CLAUDE_READ_TOOLS, ...(write ? ["Edit", "Write"] : [])];
}
function contained(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}
/** Additional file-tool guard; never turn a managed denial into an allow. */
export async function claudeToolPermitted(
  root: string,
  write: boolean,
  name: string,
  value: unknown,
): Promise<boolean> {
  if (!claudeTools(write).includes(name)) return false;
  const input = record(value);
  if (!input) return false;
  const fields: Record<string, string[]> = {
    Read: ["file_path", "offset", "limit", "pages"],
    Edit: ["file_path", "old_string", "new_string", "replace_all"],
    Write: ["file_path", "content"],
    Glob: ["path", "pattern"],
    Grep: [
      "path",
      "pattern",
      "glob",
      "output_mode",
      "-B",
      "-A",
      "-C",
      "context",
      "-n",
      "-i",
      "type",
      "head_limit",
      "offset",
      "multiline",
    ],
  };
  if (Object.keys(input).some((key) => !fields[name]?.includes(key)))
    return false;
  for (const key of ["pattern", "glob"])
    if (
      input[key] !== undefined &&
      (typeof input[key] !== "string" || f29HasControlCharacter(input[key]))
    )
      return false;
  const selected =
    name === "Read" || name === "Edit" || name === "Write"
      ? input.file_path
      : (input.path ?? ".");
  if (
    typeof selected !== "string" ||
    !selected ||
    f29HasControlCharacter(selected)
  )
    return false;
  if (
    (name === "Glob" || (name === "Grep" && input.glob !== undefined)) &&
    (typeof (name === "Glob" ? input.pattern : input.glob) !== "string" ||
      path.isAbsolute(String(name === "Glob" ? input.pattern : input.glob)) ||
      String(name === "Glob" ? input.pattern : input.glob)
        .split(/[\\/]/u)
        .some((part) => part === ".." || part.toLowerCase() === ".git"))
  )
    return false;
  const target = path.resolve(root, selected);
  if (
    !contained(root, target) ||
    path
      .relative(root, target)
      .split(/[\\/]/u)
      .some((part) => part.toLowerCase() === ".git")
  )
    return false;
  try {
    const rootInfo = await lstat(root);
    if (
      !rootInfo.isDirectory() ||
      rootInfo.isSymbolicLink() ||
      (await realpath(root)) !== root
    )
      return false;
    try {
      const info = await lstat(target);
      if (info.isFile() && info.nlink !== 1) return false;
      if (
        (name === "Glob" || name === "Grep") &&
        info.isDirectory() &&
        !(await searchableTree(target, root))
      )
        return false;
      return (
        !info.isSymbolicLink() &&
        contained(root, await realpath(target)) &&
        ((name !== "Write" && name !== "Edit") ||
          (info.isFile() && info.nlink === 1))
      );
    } catch (error) {
      if (name !== "Write" || !write || record(error)?.code !== "ENOENT")
        return false;
      const parent = path.dirname(target);
      return (
        contained(root, await realpath(parent)) &&
        (await lstat(parent)).isDirectory()
      );
    }
  } catch {
    return false;
  }
}

/** Search tools traverse files without another callback; verify that subtree first. */
async function searchableTree(
  directory: string,
  root: string,
): Promise<boolean> {
  const pending = [{ directory, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const next = pending.pop()!;
    if (next.depth > 32) return false;
    const entries = await readdir(next.directory, { withFileTypes: true });
    for (const entry of entries) {
      if (++count > 5000) return false;
      if (entry.name.toLowerCase() === ".git") {
        if (entry.isDirectory() || entry.isSymbolicLink()) return false;
        continue;
      }
      const target = path.join(next.directory, entry.name);
      const info = await lstat(target);
      if (
        info.isSymbolicLink() ||
        !contained(root, await realpath(target)) ||
        (info.isFile() && info.nlink !== 1)
      )
        return false;
      if (info.isDirectory())
        pending.push({ directory: target, depth: next.depth + 1 });
      else if (!info.isFile()) return false;
    }
  }
  return true;
}
