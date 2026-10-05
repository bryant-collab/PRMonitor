import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { installerShortcutData } from "../../tests/installer-shortcut-data.mjs";

test("installed-data fixtures survive serialized snapshots and reject deleted database or profile without recreating them", async (t) => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "prmonitor-retained-test-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const data = path.join(root, "data"),
    evidence = path.join(root, "evidence");
  const denied = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("../../tests/installer-shortcut-data.mjs", import.meta.url),
      ),
      "seed",
      data,
      evidence,
    ],
    { env: { ...process.env, GITHUB_ACTIONS: "false" }, stdio: "pipe" },
  );
  assert.notEqual(
    denied.status,
    0,
    "The native CLI must reject an unauthorized runner.",
  );
  await assert.rejects(access(data), { code: "ENOENT" });
  await mkdir(data);
  await mkdir(evidence);
  await writeFile(
    path.join(data, ".installer-shortcut-owner.json"),
    JSON.stringify({
      owner: "prmonitor-installer-shortcuts",
      root: data,
    }),
  );
  await installerShortcutData("seed", data, evidence);
  // This compares against bytes parsed from disk, including an unseeded review
  // slot; direct comparison of two in-memory records missed the JSON mismatch.
  await installerShortcutData("assert", data, evidence);
  const database = path.join(data, "database", "prmonitor.sqlite");
  await rm(database);
  await assert.rejects(installerShortcutData("assert", data, evidence), {
    code: "ENOENT",
  });
  await assert.rejects(access(database), { code: "ENOENT" });
  await rm(data, { recursive: true });
  await assert.rejects(installerShortcutData("assert", data, evidence), {
    code: "ENOENT",
  });
  await assert.rejects(access(data), { code: "ENOENT" });
});
