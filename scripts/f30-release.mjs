import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { extractFile, listPackage } from "@electron/asar";
import {
  access,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopRoot = path.join(root, "apps", "desktop");
const releaseRoot = path.join(root, "release");
const packageJson = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const desktopPackageJson = JSON.parse(
  await readFile(path.join(desktopRoot, "package.json"), "utf8"),
);
const lockfile = JSON.parse(
  await readFile(path.join(root, "package-lock.json"), "utf8"),
);

const MAX_SCAN_BYTES = 64 * 1024 * 1024;
const secretName =
  /(?:TYPESAFE_API_KEY|OPENAI_API_KEY|GITHUB_TOKEN|NPM_TOKEN|AWS_SECRET_ACCESS_KEY)/iu;
const secretAssignment =
  /(?:TYPESAFE_API_KEY|OPENAI_API_KEY|GITHUB_TOKEN|NPM_TOKEN|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*["']?[^\s"']{4,}/iu;
const localPath =
  /(?<![A-Za-z0-9])(?:[A-Za-z]:[\\/][^\r\n"']{2,}|\/(?:Users|home|private|tmp|var)\/[^\r\n"']{1,})/iu;
const textFile =
  /\.(?:[cm]?[jt]sx?|json|css|html?|svg|txt|md|map|ya?ml|xml|ini)$/iu;
const criteria = Array.from(
  { length: 77 },
  (_, index) => `APP-AC-${String(index + 1).padStart(2, "0")}`,
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function run(command, args, options = {}) {
  const executable =
    process.platform === "win32" && command === "npm" ? "npm.cmd" : command;
  return execFileSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.capture === false ? "inherit" : ["ignore", "pipe", "pipe"],
    windowsHide: true,
    shell: process.platform === "win32" && command === "npm",
    maxBuffer: 4 * 1024 * 1024,
  });
}

async function exists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function walk(directory) {
  const result = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await walk(candidate)));
    else result.push(candidate);
  }
  return result;
}

function releaseId() {
  const stamp = new Date()
    .toISOString()
    .replace(/[^0-9]/gu, "")
    .slice(0, 14);
  return `f30-${stamp}-${randomUUID().slice(0, 8)}`;
}

async function sourceIdentity() {
  const revision = run("git", ["rev-parse", "HEAD"]).trim();
  const status = run("git", ["status", "--porcelain"]).trim();
  return { revision, dirty: status.length > 0 };
}

async function generateIcon() {
  run("npm", ["--workspace", "@prmonitor/desktop", "run", "generate:icon"], {
    capture: false,
  });
}

async function packageInstaller() {
  await generateIcon();
  run("npm", ["--workspace", "@prmonitor/desktop", "run", "build"], {
    capture: false,
  });
  run(
    "npm",
    ["--workspace", "@prmonitor/desktop", "run", "package:installer"],
    { capture: false },
  );
}

async function scanPayload() {
  const unpacked = path.join(releaseRoot, "win-unpacked");
  if (!(await exists(unpacked)))
    throw new Error("F30_ARTIFACT_MISSING: release/win-unpacked is absent");
  const files = await walk(unpacked);
  const forbiddenNames = [];
  const findings = [];
  let scannedBytes = 0;
  const inspectText = (relative, content, checkLocalPaths) => {
    if (scannedBytes + content.length > MAX_SCAN_BYTES) {
      findings.push({ file: relative, code: "PAYLOAD_SCAN_LIMIT" });
      return;
    }
    scannedBytes += content.length;
    const text = content.toString("utf8");
    if (secretName.test(text) && secretAssignment.test(text))
      findings.push({ file: relative, code: "SECRET_SHAPED_CONTENT" });
    if (checkLocalPaths && localPath.test(text))
      findings.push({ file: relative, code: "LOCAL_PATH_CONTENT" });
  };

  for (const file of files) {
    const relative = path.relative(unpacked, file).replaceAll("\\", "/");
    if (
      /(^|\/)\.env(?:\.|$)|(?:^|\/)node_modules\/\.cache(?:\/|$)/iu.test(
        relative,
      )
    )
      forbiddenNames.push(relative);
    const info = await stat(file);
    if (
      relative !== "resources/app.asar" &&
      textFile.test(relative) &&
      info.size <= MAX_SCAN_BYTES
    ) {
      const content = await readFile(file);
      inspectText(relative, content, !/\/node_modules\//iu.test(relative));
    }
  }

  const archive = path.join(unpacked, "resources", "app.asar");
  let archiveFileCount = 0;
  if (await exists(archive)) {
    for (const entry of listPackage(archive)) {
      const archiveEntry = entry.replace(/^\\+/u, "");
      const relativeEntry = archiveEntry.replaceAll("\\", "/");
      if (
        !textFile.test(relativeEntry) ||
        /(^|\/)node_modules\//iu.test(relativeEntry)
      )
        continue;
      archiveFileCount += 1;
      inspectText(
        `resources/app.asar/${relativeEntry}`,
        extractFile(archive, archiveEntry),
        true,
      );
    }
  }

  if (forbiddenNames.length > 0 || findings.length > 0) {
    throw new Error(
      `F30_PAYLOAD_SCAN_FAILED:${JSON.stringify({ forbiddenNames, findings })}`,
    );
  }
  return { fileCount: files.length + archiveFileCount, scannedBytes };
}

async function installerArtifact() {
  const files = (await walk(releaseRoot)).filter((file) =>
    /\.exe$/iu.test(file),
  );
  const candidate = files.find(
    (file) =>
      path.dirname(file) === releaseRoot &&
      /^PRMonitor-[^/]+-x64\.exe$/iu.test(path.basename(file)),
  );
  if (candidate === undefined)
    throw new Error(
      "F30_INSTALLER_MISSING: no NSIS setup executable was produced",
    );
  const info = await stat(candidate);
  const bytes = await readFile(candidate);
  return {
    absolutePath: candidate,
    name: path.relative(releaseRoot, candidate).replaceAll("\\", "/"),
    bytes: info.size,
    sha256: sha256(bytes),
  };
}

async function createManifest({ allowDirty = false } = {}) {
  const identity = await sourceIdentity();
  if (identity.dirty && !allowDirty)
    throw new Error(
      "F30_SOURCE_DIRTY: release packaging requires a clean source revision (use --allow-dirty only for local inspection).",
    );
  const builderConfig = await readFile(
    path.join(desktopRoot, "electron-builder.yml"),
    "utf8",
  );
  if (
    !/target:[\s\S]{0,256}?nsis/iu.test(builderConfig) ||
    !/appId:\s*com\.prmonitor\.desktop/iu.test(builderConfig)
  )
    throw new Error(
      "F30_PACKAGING_CONFIG_INVALID: NSIS or stable app identity is missing",
    );
  const payloadScan = await scanPayload();
  const installer = await installerArtifact();
  const release = releaseId();
  const outputDirectory = path.join(releaseRoot, "f30", release);
  await mkdir(outputDirectory, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    kind: "f30-release-manifest",
    releaseId: release,
    generatedAt: new Date().toISOString(),
    product: {
      name: "PRMonitor",
      applicationId: "com.prmonitor.desktop",
      version: desktopPackageJson.version,
      executableName: "PRMonitor.exe",
    },
    source: identity,
    runtime: {
      node: process.versions.node,
      npm:
        process.env.npm_config_user_agent?.match(/npm\/([^ ]+)/u)?.[1] ??
        "unknown",
      electron: desktopPackageJson.devDependencies.electron,
      electronBuilder: desktopPackageJson.devDependencies["electron-builder"],
      lockfileVersion: lockfile.lockfileVersion,
    },
    target: { os: "windows-11", architecture: "x64" },
    packaging: {
      configurationSha256: sha256(builderConfig),
      target: "nsis",
      signed: false,
      releaseTier: "unsigned-internal-preview",
      updateChannel: "manual-installer",
      smartScreenNote:
        "Unsigned internal preview: Windows SmartScreen may warn. Do not label this candidate as a generally supported or trusted public release.",
    },
    artifacts: [
      {
        name: installer.name,
        kind: "installer",
        architecture: "x64",
        sha256: installer.sha256,
        bytes: installer.bytes,
      },
    ],
    evidenceBundleId: `f30-evidence-${sha256(`${release}:${installer.sha256}`).slice(0, 32)}`,
    payloadScan,
  };
  const manifestPath = path.join(outputDirectory, "release-manifest.json");
  const checksumPath = path.join(outputDirectory, "checksums.sha256");
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    checksumPath,
    `${installer.sha256}  ${installer.name}\n${sha256(JSON.stringify(manifest))}  release-manifest.json\n`,
    "utf8",
  );
  await writeFile(
    path.join(outputDirectory, "packaging-checks.json"),
    `${JSON.stringify(
      {
        releaseId: release,
        status: "passed",
        checks: [
          "nsis-installer-present",
          "stable-identity",
          "payload-secret-and-local-path-scan",
          "unsigned-manual-update-policy-recorded",
          "sha256-recorded",
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  process.stdout.write(`${manifestPath}\n`);
  return { release, manifestPath, manifest };
}

async function createTraceTemplate(output) {
  const trace = criteria.map((criterionId) => ({
    schemaVersion: 1,
    kind: "f30-criterion-evidence",
    criterionId,
    ownerFeature: "F30",
    evidenceTier: "credential-free-automated",
    status: "unverified",
    buildIdentity: "release-candidate-pending",
    environmentIdentity: "environment-pending",
    recordedAt: new Date().toISOString(),
    evidenceRefs: [],
    observation: "Evidence has not been recorded yet.",
  }));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(trace, null, 2)}\n`, "utf8");
  process.stdout.write(`${output}\n`);
}

async function gate(manifestPath, tracePath) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const rows = JSON.parse(await readFile(tracePath, "utf8"));
  const reasons = [];
  const byId = new Map();
  for (const row of rows) {
    if (byId.has(row.criterionId))
      reasons.push({
        code: "CRITERION_DUPLICATE",
        message: `The release trace contains ${row.criterionId} more than once.`,
        criterionId: row.criterionId,
      });
    byId.set(row.criterionId, row);
  }
  for (const criterionId of criteria) {
    const row = byId.get(criterionId);
    if (!row)
      reasons.push({
        code: "CRITERION_MISSING",
        message: `${criterionId} has no individual release evidence row.`,
        criterionId,
      });
    else if (
      !["passed", "approved-exception", "not-applicable"].includes(row.status)
    )
      reasons.push({
        code: "CRITERION_NOT_GREEN",
        message: `${criterionId} is ${row.status} and cannot release.`,
        criterionId,
      });
  }
  for (const criterionId of byId.keys()) {
    if (!criteria.includes(criterionId))
      reasons.push({
        code: "CRITERION_UNKNOWN",
        message: "The release trace contains an unknown criterion ID.",
      });
  }
  if (manifest.source?.dirty)
    reasons.push({
      code: "SOURCE_DIRTY",
      message: "The source revision is dirty.",
    });
  if (
    manifest.packaging?.signed !== false ||
    manifest.packaging?.releaseTier !== "unsigned-internal-preview" ||
    manifest.packaging?.updateChannel !== "manual-installer"
  )
    reasons.push({ code: "DISTRIBUTION_POLICY_MISMATCH" });
  const result = {
    schemaVersion: 1,
    kind: "f30-release-gate-result",
    gateId: `f30-gate-${sha256(`${manifest.releaseId}:${Date.now()}`).slice(0, 24)}`,
    generatedAt: new Date().toISOString(),
    decision: reasons.length === 0 ? "eligible" : "blocked",
    reasons,
    criterionCount: Math.min(byId.size, criteria.length),
    passedCriterionCount: [...byId.values()].filter(
      (row) => row.status === "passed",
    ).length,
  };
  const output = path.join(path.dirname(tracePath), "release-gate.json");
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${output}\n`);
  if (reasons.length > 0) process.exitCode = 1;
}

const args = process.argv.slice(2);
const command = args[0] ?? "help";
try {
  if (command === "package") {
    await packageInstaller();
    await createManifest({ allowDirty: args.includes("--allow-dirty") });
  } else if (command === "manifest") {
    await createManifest({ allowDirty: args.includes("--allow-dirty") });
  } else if (command === "trace-template") {
    await createTraceTemplate(
      args[1] ?? path.join(releaseRoot, "f30", "trace-template.json"),
    );
  } else if (command === "gate") {
    if (args[1] === undefined || args[2] === undefined)
      throw new Error(
        "F30_USAGE: gate requires a manifest path and trace path",
      );
    await gate(path.resolve(args[1]), path.resolve(args[2]));
  } else {
    process.stdout.write(
      "Usage: node scripts/f30-release.mjs <package|manifest|trace-template|gate> [options]\n",
    );
  }
} catch (error) {
  process.stderr.write(
    `f30-release: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
