import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("checkout keeps generated JSON byte-identical with Windows autocrlf enabled", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "prmonitor-checkout-test-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const schema = await readFile(
    path.join(root, "Specs/contracts/validation-profile.v1.schema.json"),
  );
  await copyFile(
    path.join(root, ".gitattributes"),
    path.join(directory, ".gitattributes"),
  );
  await writeFile(path.join(directory, "schema.json"), schema);
  const git = (...args) =>
    execFileSync("git", ["-c", "core.autocrlf=true", ...args], {
      cwd: directory,
      stdio: "pipe",
    });
  git("init");
  git("add", ".");
  await unlink(path.join(directory, "schema.json"));
  git("checkout-index", "--force", "schema.json");
  assert.deepEqual(await readFile(path.join(directory, "schema.json")), schema);
});

test("packaging never implicitly publishes from a CI environment", async () => {
  const { scripts } = JSON.parse(
    await readFile(path.join(root, "apps/desktop/package.json"), "utf8"),
  );
  for (const command of ["package", "package:installer"]) {
    assert.match(scripts[command], /electron-builder --publish never /u);
  }
});
