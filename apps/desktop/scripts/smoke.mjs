/* global Buffer, clearTimeout, process, setTimeout */

import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  lstat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifySmokeFailure,
  classifySandboxSubreason,
  classifyApplicationSmokeReason,
} from "./smoke-failure.mjs";
import { listPackage } from "@electron/asar";
import { forbiddenRuntimePayload } from "../../../scripts/runtime-payload.mjs";
import { assertWindowsBranding } from "../../../scripts/windows-branding.mjs";

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repositoryRoot = path.resolve(appRoot, "..", "..");
const releaseRoot = path.join(repositoryRoot, "release");
const ownerFile = ".prmonitor-smoke-owner.json";
const maxOutputBytes = 128 * 1024;
const smokeTimeoutMs = 30_000;
const readyPrefix = "PRMONITOR_SMOKE_READY:";

function pathKey(input) {
  const normalized = path.resolve(input);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isWithin(root, candidate) {
  const relative = path.relative(pathKey(root), pathKey(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function boundedAppend(state, chunk) {
  const next = Buffer.concat([state.bytes, Buffer.from(chunk)]);
  if (next.byteLength > maxOutputBytes) {
    state.overflow = true;
    state.bytes = next.subarray(0, maxOutputBytes);
  } else {
    state.bytes = next;
  }
}

function safeChildEnvironment({ nonce, userDataDir, cacheDir }) {
  // Secret-shaped names such as TYPESAFE_API_KEY, *_TOKEN, *_SECRET,
  // *_PASSWORD, and *_API_KEY are intentionally not allowlisted.
  const allowedNames = new Set([
    "PATH",
    "PATHEXT",
    "COMSPEC",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "TEMP",
    "TMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "CI",
    "DISPLAY",
    "WAYLAND_DISPLAY",
    "XAUTHORITY",
    "XDG_RUNTIME_DIR",
  ]);
  const source = process.env;
  const environment = {};
  for (const name of allowedNames) {
    const value = source[name];
    if (value !== undefined) environment[name] = value;
  }
  environment.PATH ??= process.env.PATH ?? "";
  environment.PRMONITOR_SMOKE = "1";
  environment.PRMONITOR_SMOKE_NONCE = nonce;
  environment.PRMONITOR_USER_DATA_DIR = userDataDir;
  environment.PRMONITOR_CACHE_DIR = cacheDir;
  environment.PRMONITOR_ISOLATED_ROOT = path.dirname(userDataDir);
  environment.PRMONITOR_WORKTREE_DIR = path.join(
    path.dirname(userDataDir),
    "worktrees",
  );
  return environment;
}

async function assertNoReparsePoints(root) {
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error(
      `cleanup refused: owner root is not a real directory: ${root}`,
    );
  const canonicalRoot = await stat(root).then(() => path.resolve(root));
  if (!isWithin(os.tmpdir(), canonicalRoot))
    throw new Error(
      `cleanup refused: owner root escaped the temporary directory: ${root}`,
    );

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const child = path.join(directory, entry.name);
      if (!isWithin(root, child))
        throw new Error(`cleanup refused: child escaped owner root: ${child}`);
      const childInfo = await lstat(child);
      if (childInfo.isSymbolicLink())
        throw new Error(`cleanup refused: reparse/symlink child: ${child}`);
      if (childInfo.isDirectory()) await visit(child);
    }
  }
  await visit(root);
}

async function cleanupOwnedDirectory(directory) {
  try {
    const markerPath = path.join(directory, ownerFile);
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    if (
      marker.owner !== "prmonitor-f01-smoke" ||
      marker.directory !== path.resolve(directory)
    ) {
      throw new Error("cleanup refused: ownership marker mismatch");
    }
    await assertNoReparsePoints(directory);
    await rm(directory, { recursive: true, force: false });
  } catch (error) {
    throw new Error(
      `SMOKE_CLEANUP_FAILED:${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

async function findArtifact() {
  const candidates =
    process.platform === "win32"
      ? [path.join(releaseRoot, "win-unpacked", "PRMonitor.exe")]
      : process.platform === "darwin"
        ? [
            path.join(
              releaseRoot,
              "mac",
              "PRMonitor.app",
              "Contents",
              "MacOS",
              "PRMonitor",
            ),
          ]
        : [
            path.join(releaseRoot, "linux-unpacked", "prmonitor"),
            path.join(releaseRoot, "linux-unpacked", "PRMonitor"),
          ];
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch {
      // Try the next platform-specific builder output name.
    }
  }
  throw new Error(
    `SMOKE_ARTIFACT_MISSING: expected an unpacked artifact under ${releaseRoot}`,
  );
}

async function assertArtifactShape(executable) {
  if (process.platform === "win32") {
    const { version } = JSON.parse(
      await readFile(path.join(appRoot, "package.json"), "utf8"),
    );
    await assertWindowsBranding(executable, {
      fileVersion: version,
      productVersion: `${version}.0`,
    });
  }
  const artifactDirectory =
    process.platform === "darwin"
      ? path
          .resolve(executable, "..", "..", "..")
          .replace(`${path.sep}Contents${path.sep}MacOS`, "")
      : path.dirname(executable);
  const required =
    process.platform === "darwin"
      ? [path.join(artifactDirectory, "Contents", "Resources", "app.asar")]
      : [path.join(artifactDirectory, "resources", "app.asar")];
  for (const file of required) {
    const info = await stat(file).catch(() => undefined);
    if (!info?.isFile())
      throw new Error(
        `SMOKE_ARTIFACT_INVALID: missing packaged application payload ${file}`,
      );
  }
  const names = await readdir(artifactDirectory, { recursive: true }).catch(
    () => [],
  );
  const forbidden = names.filter(
    (name) =>
      forbiddenRuntimePayload(name) ||
      /(^|[\\/])\.env(?:\.|$)|\.msi$|\.dmg$|\.deb$|\.appimage$|latest\.yml$/iu.test(
        name,
      ),
  );
  if (forbidden.length > 0)
    throw new Error(
      `SMOKE_ARTIFACT_INVALID: unexpected release files ${forbidden.join(", ")}`,
    );

  const payloadPath = required[0];
  for (const entry of listPackage(payloadPath))
    if (forbiddenRuntimePayload(entry)) forbidden.push(`app.asar/${entry}`);
  if (forbidden.length > 0)
    throw new Error(
      `SMOKE_ARTIFACT_INVALID: runtime state in package ${forbidden.join(", ")}`,
    );
  const payloadText = (await readFile(payloadPath)).toString("utf8");
  if (
    /(?:TYPESAFE_API_KEY|GITHUB_TOKEN|OPENAI_API_KEY|PRMONITOR_[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY))\s*[:=]/iu.test(
      payloadText,
    )
  ) {
    throw new Error(
      "SMOKE_ARTIFACT_INVALID: credential-shaped content found in packaged payload",
    );
  }
  const localPathVariants = [
    repositoryRoot,
    repositoryRoot.replaceAll(path.sep, "/"),
    repositoryRoot.replaceAll("\\", "\\\\"),
  ];
  if (localPathVariants.some((value) => payloadText.includes(value))) {
    throw new Error(
      "SMOKE_ARTIFACT_INVALID: local checkout path found in packaged payload",
    );
  }
}

function terminateChild(child) {
  if (child.killed || child.exitCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    try {
      execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      return;
    } catch {
      // Fall through to the portable signal path.
    }
  }
  child.kill("SIGTERM");
}

async function launchSmoke(executable, environment) {
  const nonce = environment.PRMONITOR_SMOKE_NONCE;
  const stdout = { bytes: Buffer.alloc(0), overflow: false };
  const stderr = { bytes: Buffer.alloc(0), overflow: false };
  const readyLines = [];
  // Native Electron startup can resolve/create its default profile before JS
  // applies app.setPath. Route that first lookup to this marked fixture too.
  const child = spawn(
    executable,
    [`--user-data-dir=${environment.PRMONITOR_USER_DATA_DIR}`],
    {
      cwd: repositoryRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  child.stdout.on("data", (chunk) => {
    boundedAppend(stdout, chunk);
    for (const line of Buffer.from(chunk).toString("utf8").split(/\r?\n/u)) {
      if (line.startsWith(readyPrefix)) readyLines.push(line);
    }
    if (stdout.overflow) terminateChild(child);
  });
  child.stderr.on("data", (chunk) => {
    boundedAppend(stderr, chunk);
    if (stderr.overflow) terminateChild(child);
  });

  const outcome = await new Promise((resolve) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      terminateChild(child);
    }, smokeTimeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ error, code: null, signal: null, timedOut });
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ error: undefined, code, signal, timedOut });
    });
  });

  if (stdout.overflow || stderr.overflow)
    throw new Error(
      "SMOKE_OUTPUT_LIMIT: child output exceeded the bounded capture limit",
    );
  if (outcome.error)
    throw new Error(`SMOKE_CHILD_START_FAILED:${outcome.error.message}`);
  if (outcome.timedOut)
    throw new Error(
      `SMOKE_TIMEOUT: no readiness and clean close within ${smokeTimeoutMs}ms`,
    );
  if (outcome.code !== 0) {
    const signal = outcome.signal ? ` signal=${outcome.signal}` : "";
    throw new Error(
      `SMOKE_CHILD_EXIT_FAILED: code=${String(outcome.code)}${signal} category=${classifySmokeFailure(stderr.bytes.toString("utf8"))} sandbox=${classifySandboxSubreason(stderr.bytes.toString("utf8"))} app=${classifyApplicationSmokeReason(stderr.bytes.toString("utf8"))}`,
    );
  }
  if (readyLines.length !== 1 || readyLines[0] !== `${readyPrefix}${nonce}`) {
    throw new Error(
      `SMOKE_READY_PROTOCOL_FAILED: expected exactly one nonce-bound readiness line (observed ${readyLines.length})`,
    );
  }
  return {
    stdout: stdout.bytes.toString("utf8"),
    stderr: stderr.bytes.toString("utf8"),
  };
}

async function main() {
  const executable = await findArtifact();
  await assertArtifactShape(executable);
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "prmonitor-f01-smoke-"),
  );
  const marker = {
    owner: "prmonitor-f01-smoke",
    directory: path.resolve(tempRoot),
    nonce: randomUUID(),
  };
  const userDataDir = path.join(tempRoot, "user-data");
  const cacheDir = path.join(tempRoot, "cache");
  await mkdir(userDataDir);
  await mkdir(cacheDir);
  await mkdir(path.join(tempRoot, "worktrees"));
  await writeFile(
    path.join(tempRoot, ".prmonitor-runtime-owner.json"),
    JSON.stringify({
      owner: "prmonitor-runtime-fixture",
      root: path.resolve(tempRoot),
    }),
  );
  await writeFile(
    path.join(tempRoot, ownerFile),
    `${JSON.stringify(marker)}\n`,
    "utf8",
  );

  try {
    const nonce = randomUUID();
    const environment = safeChildEnvironment({ nonce, userDataDir, cacheDir });
    const result = await launchSmoke(executable, environment);
    const outputDigest = createHash("sha256")
      .update(`${result.stdout}\n${result.stderr}`)
      .digest("hex")
      .slice(0, 12);
    process.stdout.write(
      `desktop-smoke: production artifact ready; bounded output digest ${outputDigest}\n`,
    );
  } finally {
    await cleanupOwnedDirectory(tempRoot);
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `desktop-smoke: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
