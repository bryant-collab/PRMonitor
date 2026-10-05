import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  mkdtemp,
  mkdir,
  realpath,
  symlink,
  unlink,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  canonicalTemporaryRoot,
  canonicalTempEnvironment,
  waitForInstallerSmoke,
  installerFailureLabel,
} from "../../tests/installer-e2e-support.mjs";

function child() {
  const value = new EventEmitter();
  value.stdout = new EventEmitter();
  value.stderr = new EventEmitter();
  value.killed = false;
  value.kill = () => {
    value.killed = true;
  };
  return value;
}

test("installer failures never disclose child diagnostics or private spawn paths", async () => {
  const value = child();
  const pending = waitForInstallerSmoke(value, "fixture-nonce");
  value.stdout.emit(
    "data",
    Buffer.from("C:/private/customer-state private-value"),
  );
  value.stderr.emit(
    "data",
    Buffer.from(
      "private-value SUID sandbox helper binary must be owned by root",
    ),
  );
  value.emit("close", 1);
  await assert.rejects(pending, (error) => {
    assert.match(
      error.message,
      /^INSTALLER_SMOKE_FAILED:SANDBOX_SETUP_FAILED:digest=[a-f0-9]{12}$/,
    );
    assert.equal(error.message.includes("private"), false);
    return true;
  });
  const spawned = child();
  const spawnPending = waitForInstallerSmoke(spawned, "fixture-nonce");
  spawned.emit("error", Error("C:/private/customer-state private-value"));
  await assert.rejects(spawnPending, {
    message: "INSTALLER_SMOKE_SPAWN_FAILED",
  });
  assert.equal(
    installerFailureLabel(
      Error("uncontrolled C:/private/customer-state private-value"),
    ),
    "INSTALLER_ACCEPTANCE_FAILED",
  );
  assert.equal(
    installerFailureLabel(Error("INSTALLER_SMOKE_FAILED:private-value")),
    "INSTALLER_ACCEPTANCE_FAILED",
  );
});

test("installer smoke bounds output, ends timed-out children and requires the matching ready marker after stream close", async () => {
  const value = child();
  const pending = waitForInstallerSmoke(value, "fixture-nonce", {
    maxBytes: 8,
  });
  value.stderr.emit("data", Buffer.from("unbounded private-value"));
  await assert.rejects(pending, { message: "INSTALLER_SMOKE_OUTPUT_LIMIT" });
  assert.equal(value.killed, true);
  const timeout = child();
  await assert.rejects(
    waitForInstallerSmoke(timeout, "fixture-nonce", { timeoutMs: 10 }),
    { message: "INSTALLER_SMOKE_TIMEOUT" },
  );
  assert.equal(timeout.killed, true);
  const ready = child();
  const readyPending = waitForInstallerSmoke(ready, "fixture-nonce");
  ready.emit("exit", 0);
  ready.stdout.emit("data", Buffer.from("PRMONITOR_SMOKE_READY:fixture-nonce"));
  ready.emit("close", 0);
  await readyPending;
  const mismatched = child();
  const mismatchPending = waitForInstallerSmoke(mismatched, "fixture-nonce");
  mismatched.stdout.emit(
    "data",
    Buffer.from("PRMONITOR_SMOKE_READY:other-nonce"),
  );
  mismatched.emit("close", 0);
  await assert.rejects(
    mismatchPending,
    /INSTALLER_SMOKE_FAILED:UNCLASSIFIED:digest=/,
  );
});

test("installer resolves a real Temp alias and propagates canonical Temp to its children", async () => {
  const temp = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(temp, "prmonitor-installer-path-test-"));
  const target = path.join(root, "target"),
    alias = path.join(root, "alias");
  await mkdir(target);
  await symlink(
    target,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  try {
    const canonical = await canonicalTemporaryRoot(alias);
    assert.equal(canonical, await realpath(target));
    assert.deepEqual(
      canonicalTempEnvironment(
        { TEMP: alias, TMP: alias, PATH: "fixture-path" },
        canonical,
      ),
      { TEMP: canonical, TMP: canonical, PATH: "fixture-path" },
    );
  } finally {
    // Unlink only our test alias, then remove its verified Temp-owned root.
    await unlink(alias);
    const relative = path.relative(temp, await realpath(root));
    assert.ok(
      relative !== "" &&
        !relative.startsWith("..") &&
        !path.isAbsolute(relative),
    );
    await rm(root, { recursive: true });
  }
});
