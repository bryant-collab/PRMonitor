import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  lstat,
  realpath,
  readdir,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const require = createRequire(
  path.join(repository, "apps/desktop/package.json"),
);
const electron = require("electron");
const approvedPreview = await readFile(
  path.join(repository, "tests/fixtures/approved-reference.html"),
);
if (
  createHash("sha256").update(approvedPreview).digest("hex") !==
  "f7b3c0cd8ba6d0eed0c9ebe414187285daa7268dafc9dc7ee78f6afc6d4503a0"
)
  throw Error("E2E_REFERENCE_HASH_MISMATCH");
// Windows CI can expose Temp through an 8.3 alias. Persist F13's canonical
// ownership paths without changing its production path-movement guard.
const temporaryRoot = await realpath(os.tmpdir());
const root = await realpath(
  await mkdtemp(path.join(temporaryRoot, "prmonitor-setup-e2e-")),
);
await require("esbuild").build({
  entryPoints: [path.join(repository, "tests/setup-e2e-fixtures.ts")],
  outfile: path.join(root, "fixtures.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
});
const evidence = path.join(repository, "docs/evidence/setup-readiness");
await writeFile(path.join(root, "approved-preview.html"), approvedPreview);
await mkdir(evidence, { recursive: true });
await writeFile(
  path.join(root, ".setup-e2e-owner.json"),
  JSON.stringify({ owner: "prmonitor-setup-e2e", root: path.resolve(root) }),
);
await writeFile(
  path.join(root, ".prmonitor-runtime-owner.json"),
  JSON.stringify({
    owner: "prmonitor-runtime-fixture",
    root: path.resolve(root),
  }),
);
for (const child of [
  "user-data",
  "session-data",
  "home",
  "app-data",
  "local-app-data",
  "bootstrap-user-data",
  "cache",
  "worktrees",
])
  await mkdir(path.join(root, child));
await writeFile(
  path.join(root, "bootstrap-user-data", "database"),
  "setup-e2e-owned-path-obstruction",
);

// Only Windows bootstrap variables survive; authentication never inherits.
const environment = {};
for (const name of [
  "PATH",
  "Path",
  "PATHEXT",
  "COMSPEC",
  "SystemRoot",
  "SYSTEMROOT",
  "WINDIR",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "HOMEDRIVE",
  "HOMEPATH",
  "USERNAME",
  "USERDOMAIN",
]) {
  if (process.env[name] !== undefined) environment[name] = process.env[name];
}
Object.assign(environment, {
  TEMP: temporaryRoot,
  TMP: temporaryRoot,
  PRMONITOR_E2E_ROOT: root,
  PRMONITOR_E2E_EVIDENCE: evidence,
  HOME: path.join(root, "home"),
});
const results = [];
try {
  for (const stage of [
    "fresh",
    "partial",
    "restart",
    "lost-auth",
    "bootstrap-failure",
    "bootstrap-fixed",
    "shell",
    "guarded",
    "settings",
    "lifecycle",
    "retained-restart",
    "publication-uncertain",
    "add-success",
    "conditional-review",
    "conditional-settings",
  ]) {
    if (stage === "bootstrap-fixed")
      await rm(path.join(root, "bootstrap-user-data", "database"));
    const childEnvironment = { ...environment, PRMONITOR_E2E_STAGE: stage };
    if (stage !== "fresh" && stage !== "lost-auth")
      childEnvironment.OPENAI_API_KEY = "setup-e2e-nonsecret-fixture";
    const child = spawn(
      electron,
      [
        "--no-sandbox",
        "--disable-gpu",
        path.join(repository, "tests/setup-e2e-main.cjs"),
      ],
      {
        cwd: repository,
        env: childEnvironment,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    // Keep child diagnostics bounded and private to the owned temporary root.
    let output = "";
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => {
        output = (output + chunk.toString()).slice(-64000);
      });
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (process.platform === "win32" && child.pid) {
          try {
            execFileSync(
              "taskkill.exe",
              ["/PID", String(child.pid), "/T", "/F"],
              { stdio: "ignore", windowsHide: true },
            );
          } catch {
            child.kill();
          }
        } else child.kill();
        reject(new Error("E2E_PARENT_TIMEOUT"));
      }, 65000);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    await writeFile(path.join(root, `${stage}.log`), output);
    const result = JSON.parse(
      await readFile(path.join(root, `${stage}.json`), "utf8").catch(() => {
        throw new Error(`E2E_CHILD_NO_RESULT: exit ${code}`);
      }),
    );
    results.push(result);
    process.stdout.write(
      `setup-e2e: ${stage}: ${result.ok ? "PASS" : "FAIL"}\n`,
    );
    if (code !== 0 || !result.ok)
      throw new Error(result.error || "E2E_CHILD_FAILED");
  }
  await writeFile(
    path.join(evidence, "results.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        isolatedDataIdentity: createHash("sha256")
          .update(root)
          .digest("hex")
          .slice(0, 16),
        scenarios: results,
        limitations: [
          "DOM flash observation starts when renderer bridge is available; renderer coordination tests separately cover initial loading.",
          "Native guarded journeys use real persisted records and an owned Git worktree. No live provider or external publication was authorized; positive provider/publication effects are covered by service integration tests with controlled ports.",
          "Chromium zoom and forced-color emulation check reflow. Physical Windows DPI, independent text scaling, screen-reader speech and taskbar clicking require computer-control tooling unavailable in this execution environment.",
          "Native lifecycle acceptance invokes the real Electron menu item's callback; it does not claim a physical Windows taskbar click.",
        ],
      },
      null,
      2,
    ) + "\n",
  );
} catch (error) {
  process.stderr.write(`setup-e2e: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  const marker = JSON.parse(
    await readFile(path.join(root, ".setup-e2e-owner.json"), "utf8"),
  );
  if (
    marker.owner !== "prmonitor-setup-e2e" ||
    marker.root !== path.resolve(root)
  )
    throw Error("E2E_CLEANUP_OWNER_MISMATCH");
  const within = (parent, child) => {
    const relative = path.relative(path.resolve(parent), path.resolve(child));
    return (
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  };
  if (
    !within(temporaryRoot, root) ||
    path.resolve(temporaryRoot) === path.resolve(root)
  )
    throw Error("E2E_CLEANUP_OUTSIDE_TEMP");
  const visit = async (directory) => {
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory())
      throw Error("E2E_CLEANUP_REPARSE_POINT");
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name);
      if (!within(root, child)) throw Error("E2E_CLEANUP_OUTSIDE_OWNER");
      const stat = await lstat(child);
      if (stat.isSymbolicLink()) throw Error("E2E_CLEANUP_REPARSE_POINT");
      if (stat.isDirectory()) await visit(child);
    }
  };
  await visit(root);
  await rm(root, { recursive: true, force: false });
  process.stdout.write(
    "setup-e2e: marked isolated test state cleaned after ownership and path validation\n",
  );
}
