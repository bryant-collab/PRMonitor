/** Local, explicitly isolated NSIS acceptance. Never installs the customer app identity. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  lstat,
  rm,
  realpath,
} from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  canonicalTemporaryRoot,
  canonicalTempEnvironment,
  waitForInstallerSmoke,
  installerFailureLabel,
} from "./installer-e2e-support.mjs";
let currentPhase = "SETUP";

async function main() {
  assert.equal(process.platform, "win32");
  const repository = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const desktop = path.join(repository, "apps/desktop");
  const require = createRequire(path.join(desktop, "package.json"));
  const temporaryRoot = await canonicalTemporaryRoot(os.tmpdir());
  const root = await realpath(
    await mkdtemp(path.join(temporaryRoot, "prmonitor-installer-e2e-")),
  );
  const identity = `PRMonitor Acceptance ${randomUUID().slice(0, 8)}`;
  const prefix = path.join(root, "installed");
  const output = path.join(root, "packages");
  const userData = path.join(root, "user-data");
  let uninstaller;
  await writeFile(
    path.join(root, ".installer-owner.json"),
    JSON.stringify({ owner: "prmonitor-installer-e2e", root }),
  );
  await writeFile(
    path.join(root, ".prmonitor-runtime-owner.json"),
    JSON.stringify({ owner: "prmonitor-runtime-fixture", root }),
  );
  for (const name of ["user-data", "cache", "worktrees"])
    await mkdir(path.join(root, name));
  await require("esbuild").build({
    entryPoints: [path.join(repository, "tests/setup-e2e-fixtures.ts")],
    outfile: path.join(root, "fixtures.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
  });
  const fixtures = await import(
    pathToFileURL(path.join(root, "fixtures.mjs")).href
  );
  await fixtures.seedSavedReview(userData);
  const savedReviews = (await fixtures.readRetainedWork(userData)).reviews;
  const original = await fixtures.installerData(userData, true);
  const builder = require.resolve("electron-builder/out/cli/cli.js");
  const config = {
    appId: `com.prmonitor.acceptance.${identity.split(" ").at(-1)}`,
    productName: identity,
    executableName: "PRMonitor",
    artifactName: "acceptance-${version}.${ext}",
    directories: { output, buildResources: "build" },
    files: ["out/**/*", "package.json"],
    asar: true,
    extraResources: [{ from: "build/prmonitor.png", to: "prmonitor.png" }],
    win: {
      icon: "build/prmonitor.png",
      signAndEditExecutable: false,
      signExecutable: false,
      forceCodeSigning: false,
    },
    nsis: {
      oneClick: true,
      perMachine: false,
      allowToChangeInstallationDirectory: false,
      createDesktopShortcut: false,
      createStartMenuShortcut: false,
      runAfterFinish: false,
      deleteAppDataOnUninstall: false,
    },
  };
  const configPath = path.join(root, "builder.json");
  await writeFile(configPath, JSON.stringify(config));
  const childEnv = {};
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
  ])
    if (process.env[name] !== undefined) childEnv[name] = process.env[name];
  Object.assign(childEnv, {
    ...canonicalTempEnvironment(childEnv, temporaryRoot),
    PRMONITOR_SMOKE: "1",
    PRMONITOR_ISOLATED_ROOT: root,
    PRMONITOR_USER_DATA_DIR: userData,
    PRMONITOR_CACHE_DIR: path.join(root, "cache"),
    PRMONITOR_WORKTREE_DIR: path.join(root, "worktrees"),
  });
  async function smoke() {
    const nonce = randomUUID();
    {
      const child = spawn(path.join(prefix, "PRMonitor.exe"), [], {
        env: { ...childEnv, PRMONITOR_SMOKE_NONCE: nonce },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      await waitForInstallerSmoke(child, nonce);
    }
    assert.deepEqual(await fixtures.installerData(userData, false), original);
    assert.deepEqual(
      (await fixtures.readRetainedWork(userData)).reviews,
      savedReviews,
    );
  }
  const assertions = [];
  try {
    for (const version of ["0.1.0", "0.1.1"]) {
      currentPhase = `BUILD_${version.replaceAll(".", "_")}`;
      process.stdout.write(`installer-e2e: ${currentPhase}\n`);
      execFileSync(
        process.execPath,
        [
          builder,
          "--publish",
          "never",
          "--win",
          "nsis",
          "--x64",
          "--config",
          configPath,
          `--config.extraMetadata.version=${version}`,
        ],
        {
          cwd: desktop,
          env: childEnv,
          stdio: "pipe",
          windowsHide: true,
          timeout: 180000,
        },
      );
      const installer = path.join(output, `acceptance-${version}.exe`);
      currentPhase = `INSTALL_${version.replaceAll(".", "_")}`;
      process.stdout.write(`installer-e2e: ${currentPhase}\n`);
      execFileSync(installer, ["/S", `/D=${prefix}`], {
        env: childEnv,
        windowsHide: true,
        timeout: 60000,
      });
      assert.ok((await lstat(path.join(prefix, "PRMonitor.exe"))).isFile());
      uninstaller = (await readdir(prefix)).find(
        (name) => name.startsWith("Uninstall ") && name.endsWith(".exe"),
      );
      assert.ok(uninstaller);
      assert.deepEqual(await fixtures.installerData(userData, false), original);
      currentPhase = `SMOKE_${version.replaceAll(".", "_")}`;
      process.stdout.write(`installer-e2e: ${currentPhase}\n`);
      await smoke();
      assertions.push(
        `${version}: NSIS silent per-user install/upgrade in owned prefix; actual saved review history and SQLite setting/version/timestamps unchanged; installed sandboxed production app completes startup and accessibility smoke`,
      );
    }
    const artifact = await readFile(path.join(output, "acceptance-0.1.1.exe"));
    await writeFile(
      path.join(repository, "docs/evidence/backlog/installer-results.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          ok: true,
          canonicalTemporaryRoot: true,
          shortTempAlias:
            process.platform === "win32" && /~\d/.test(os.tmpdir()),
          assertions,
          installerSha256: createHash("sha256").update(artifact).digest("hex"),
          limitations: [
            "Test-only app identity and no shortcuts protect existing PRMonitor shortcuts. Shipping app identity, existing customer installation upgrade, signing and release are not claimed.",
          ],
        },
        null,
        2,
      ) + "\n",
    );
  } catch (error) {
    if (error instanceof Error) error.installerPhase = currentPhase;
    throw error;
  } finally {
    currentPhase = "CLEANUP";
    if (uninstaller)
      execFileSync(path.join(prefix, uninstaller), ["/S", `_?=${prefix}`], {
        env: childEnv,
        windowsHide: true,
        timeout: 60000,
      });
    const owner = JSON.parse(
      await readFile(path.join(root, ".installer-owner.json"), "utf8"),
    );
    assert.equal(owner.owner, "prmonitor-installer-e2e");
    assert.equal(owner.root, root);
    const relative = path.relative(temporaryRoot, await realpath(root));
    assert.ok(
      relative !== "" &&
        !relative.startsWith("..") &&
        !path.isAbsolute(relative),
    );
    const visit = async (directory) => {
      const directoryInfo = await lstat(directory);
      assert.ok(directoryInfo.isDirectory() && !directoryInfo.isSymbolicLink());
      for (const name of await readdir(directory)) {
        const child = path.join(directory, name);
        const info = await lstat(child);
        assert.equal(info.isSymbolicLink(), false);
        if (info.isDirectory()) await visit(child);
      }
    };
    await visit(root);
    await rm(root, { recursive: true, force: false });
    process.stdout.write(
      "installer-e2e: test identity uninstalled; marked owned Temp state cleaned\n",
    );
  }
}
main().catch(async (error) => {
  process.exitCode = 1;
  // Private diagnostic files stay in an owned local Temp directory, never in
  // public evidence or stdout/stderr. The public result uses closed labels.
  try {
    const privateRoot = await mkdtemp(
      path.join(
        await canonicalTemporaryRoot(os.tmpdir()),
        "prmonitor-installer-diagnostics-",
      ),
    );
    await writeFile(
      path.join(privateRoot, ".installer-diagnostics-owner.json"),
      JSON.stringify({
        owner: "prmonitor-installer-diagnostics",
        root: privateRoot,
      }),
    );
    await writeFile(
      path.join(privateRoot, "failure.json"),
      JSON.stringify(
        {
          phase: error?.installerPhase ?? currentPhase,
          message: error instanceof Error ? error.message : "",
          code: error?.code,
          status: error?.status,
          signal: error?.signal,
          stdout: error?.stdout?.toString("utf8"),
          stderr: error?.stderr?.toString("utf8"),
        },
        null,
        2,
      ),
    );
  } catch {
    process.stderr.write("installer-e2e: PRIVATE_DIAGNOSTICS_UNAVAILABLE\n");
  }
  process.stderr.write(`installer-e2e: ${installerFailureLabel(error)}\n`);
  process.stderr.write(
    `installer-e2e: phase=${error?.installerPhase ?? currentPhase}; private diagnostics retained locally\n`,
  );
});
