import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";

const execute = promisify(execFile);

// Inspect ancestry only. Never collect command lines, paths or environment.
export function summarizeDescendants(rows, rootPid, started) {
  const owned = new Set([rootPid]);
  const descendants = [];
  let added;
  do {
    added = false;
    for (const row of rows) {
      if (
        !owned.has(row.pid) &&
        owned.has(row.parent) &&
        row.created >= started
      ) {
        owned.add(row.pid);
        descendants.push(row);
        added = true;
      }
    }
  } while (added);
  const kinds = { electron: 0, git: 0, other: 0 };
  for (const row of descendants) {
    const name = String(row.name).toLowerCase();
    kinds[
      name === "electron.exe"
        ? "electron"
        : name === "git.exe"
          ? "git"
          : "other"
    ]++;
  }
  return {
    state: "OBSERVED",
    descendants: descendants.length,
    kinds,
    workingSetMb: Math.round(
      descendants.reduce((sum, row) => sum + row.memory, 0) / 1048576,
    ),
  };
}

export async function observeClosedProcessTree(rootPid, started) {
  if (process.platform !== "win32") return { state: "NOT_WINDOWS" };
  try {
    const { stdout } = await execute(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "@(Get-CimInstance Win32_Process | ForEach-Object { @{pid=[int]$_.ProcessId; parent=[int]$_.ParentProcessId; name=$_.Name; memory=[double]$_.WorkingSetSize; created=([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds()} }) | ConvertTo-Json -Compress",
      ],
      { windowsHide: true, timeout: 6000, maxBuffer: 1048576 },
    );
    return {
      ...summarizeDescendants(JSON.parse(stdout), rootPid, started),
      freeMemoryMb: Math.round(os.freemem() / 1048576),
    };
  } catch {
    return { state: "UNAVAILABLE" };
  }
}
