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
  const linked = spawnSync(
    "ldd",
    [path.join(root, "release/linux-unpacked/prmonitor")],
    { timeout: 5000, maxBuffer: 131072, encoding: "utf8" },
  );
  const linkText = `${linked.stdout ?? ""}\n${linked.stderr ?? ""}`;
  const libc = spawnSync("getconf", ["GNU_LIBC_VERSION"], {
    timeout: 5000,
    encoding: "utf8",
  });
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
        libcVersion: /^glibc \d+\.\d+$/.test(libc.stdout?.trim() ?? "")
          ? libc.stdout.trim()
          : "unavailable",
        linkerExit: linked.status ?? "unavailable",
        missingLibraryNames: [
          ...linkText.matchAll(/^\s*(lib[A-Za-z0-9_.+-]+) => not found/gm),
        ].map((match) => match[1]),
        referencedLibcVersions: [
          ...new Set(
            [...linkText.matchAll(/GLIBC(?:XX)?_\d+(?:\.\d+)+/g)].map(
              (match) => match[0],
            ),
          ),
        ],
      },
      null,
      2,
    ),
  );
}
