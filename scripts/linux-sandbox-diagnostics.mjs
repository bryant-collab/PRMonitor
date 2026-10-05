import { readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Read-only host diagnostics. No chmod, sysctl, sandbox bypass or test changes.
if (process.platform === "linux") {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const integer = async (file) => {
    const value = await readFile(file, "utf8").catch(() => "");
    return /^\d+\s*$/.test(value) ? Number(value) : "unavailable";
  };
  const status = await readFile("/proc/self/status", "utf8").catch(() => "");
  const helper = await stat(
    path.join(root, "release/linux-unpacked/chrome-sandbox"),
  ).catch(() => undefined);
  const probe = spawnSync(
    "unshare",
    ["--user", "--map-root-user", "--", "true"],
    { timeout: 5000, stdio: "ignore" },
  );
  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        userNamespaceEnabled: await integer(
          "/proc/sys/kernel/unprivileged_userns_clone",
        ),
        apparmorUserNamespaceRestriction: await integer(
          "/proc/sys/kernel/apparmor_restrict_unprivileged_userns",
        ),
        noNewPrivileges: Number(
          status.match(/^NoNewPrivs:\s*(\d+)/m)?.[1] ?? -1,
        ),
        seccomp: Number(status.match(/^Seccomp:\s*(\d+)/m)?.[1] ?? -1),
        sandboxHelper:
          helper === undefined
            ? "unavailable"
            : { uid: helper.uid, mode: (helper.mode & 0o7777).toString(8) },
        namespaceProbeExit: probe.status ?? "unavailable",
      },
      null,
      2,
    ),
  );
}
