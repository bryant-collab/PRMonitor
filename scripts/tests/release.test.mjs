import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createPackage } from "@electron/asar";

const root = fileURLToPath(new URL("../../", import.meta.url));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function releaseFixture(t, version = "0.1.0") {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "prmonitor-release-test-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, "scripts"), { recursive: true });
  await mkdir(path.join(directory, "apps", "desktop"), { recursive: true });
  for (const file of [
    "scripts/f30-release.mjs",
    "scripts/runtime-payload.mjs",
    "package.json",
    "package-lock.json",
    "apps/desktop/package.json",
    "apps/desktop/electron-builder.yml",
  ]) {
    await copyFile(path.join(root, file), path.join(directory, file));
  }
  await symlink(
    path.join(root, "node_modules"),
    path.join(directory, "node_modules"),
    "junction",
  );
  await writeFile(
    path.join(directory, ".gitignore"),
    "node_modules/\nrelease/\n",
  );
  const git = (...args) =>
    execFileSync("git", args, { cwd: directory, stdio: "pipe" });
  git("init");
  git("add", ".");
  git(
    "-c",
    "user.name=Release test",
    "-c",
    "user.email=release-test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "Test fixture",
  );
  await mkdir(path.join(directory, "release", "win-unpacked"), {
    recursive: true,
  });
  await writeFile(
    path.join(directory, "release", "win-unpacked", "fixture.txt"),
    "Harmless synthetic payload, not a packaged application.\n",
  );
  const installerName = `PRMonitor-${version}-x64.exe`;
  const installerBytes = Buffer.from(
    "Synthetic installer fixture. Not executable.\n",
  );
  await writeFile(
    path.join(directory, "release", installerName),
    installerBytes,
  );
  const run = (...args) =>
    spawnSync(process.execPath, ["scripts/f30-release.mjs", ...args], {
      cwd: directory,
      encoding: "utf8",
    });
  return { directory, installerName, installerBytes, run };
}

test("manifest checksums match the exact pretty-printed bytes on disk", async (t) => {
  const fixture = await releaseFixture(t);
  const result = fixture.run("manifest");
  assert.equal(result.status, 0, result.stderr);
  const manifestPath = result.stdout.trim();
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.source.dirty, false);
  assert.equal(manifest.packaging.signed, false);
  assert.equal(
    manifestBytes.toString(),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  const checksums = await readFile(
    path.join(path.dirname(manifestPath), "checksums.sha256"),
    "utf8",
  );
  assert.equal(
    checksums,
    `${digest(fixture.installerBytes)}  ${fixture.installerName}\n${digest(manifestBytes)}  release-manifest.json\n`,
  );
  assert.notEqual(digest(manifestBytes), digest(JSON.stringify(manifest)));
});

test("release inspection rejects runtime state inside an archive and beside it", async (t) => {
  const fixture = await releaseFixture(t);
  const unpacked = path.join(fixture.directory, "release", "win-unpacked");
  await writeFile(
    path.join(unpacked, "state.sqlite-wal"),
    "fixture database journal",
  );
  assert.match(
    fixture.run("manifest").stderr,
    /F30_PAYLOAD_SCAN_FAILED.*state.sqlite-wal/u,
  );
  await rm(path.join(unpacked, "state.sqlite-wal"));
  const contents = path.join(fixture.directory, "archive-fixture");
  await mkdir(contents);
  await mkdir(path.join(unpacked, "resources"));
  await writeFile(path.join(contents, "state.sqlite"), "fixture database");
  await createPackage(contents, path.join(unpacked, "resources", "app.asar"));
  // The fixture source is deliberately outside the package and makes the test repository dirty.
  assert.match(
    fixture.run("manifest", "--allow-dirty").stderr,
    /F30_PAYLOAD_SCAN_FAILED.*state.sqlite/u,
  );
});

test("a stale installer from another version cannot enter the manifest", async (t) => {
  const fixture = await releaseFixture(t, "0.0.9");
  const result = fixture.run("manifest");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /F30_INSTALLER_MISSING/u);
});

test("dirty source is rejected unless explicitly requested for local inspection", async (t) => {
  const fixture = await releaseFixture(t);
  await writeFile(
    path.join(fixture.directory, "untracked.txt"),
    "Local inspection only.\n",
  );
  const rejected = fixture.run("manifest");
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /F30_SOURCE_DIRTY/u);
  const allowed = fixture.run("manifest", "--allow-dirty");
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.equal(
    JSON.parse(await readFile(allowed.stdout.trim(), "utf8")).source.dirty,
    true,
  );
});

test("an unverified 77-row trace cannot pass the final release gate", async (t) => {
  const fixture = await releaseFixture(t);
  const manifest = fixture.run("manifest");
  assert.equal(manifest.status, 0, manifest.stderr);
  const tracePath = path.join(fixture.directory, "release", "trace.json");
  const trace = fixture.run("trace-template", tracePath);
  assert.equal(trace.status, 0, trace.stderr);
  const result = fixture.run("gate", manifest.stdout.trim(), tracePath);
  assert.equal(result.status, 1, result.stderr);
  const gate = JSON.parse(await readFile(result.stdout.trim(), "utf8"));
  assert.equal(gate.decision, "blocked");
  assert.equal(gate.criterionCount, 77);
  assert.equal(gate.passedCriterionCount, 0);
  assert.equal(
    gate.reasons.filter((reason) => reason.code === "CRITERION_NOT_GREEN")
      .length,
    77,
  );
});

test("root build, check, and test resolve validation-contract before desktop", async () => {
  const { scripts } = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  for (const [command, prerequisite, consumer] of [
    ["build", "build:validation-contract", "build:desktop"],
    ["check", "check:validation-contract", "check:desktop"],
    ["test", "build:validation-contract", "test:desktop"],
  ]) {
    const steps = scripts[command].split(" && ");
    const dependency = steps.indexOf(`npm run ${prerequisite}`);
    const desktop = steps.indexOf(`npm run ${consumer}`);
    assert.ok(
      dependency >= 0 && desktop > dependency,
      `${command} must build the dependency first`,
    );
  }
});
