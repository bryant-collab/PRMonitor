import { createRequire } from "node:module";
import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const {
  closedLifecycleObservation,
  observeStartup,
  userDataDirectoryForStage,
} = require("../../tests/setup-startup-diagnostics.cjs");

test("lifecycle diagnostics disclose only known phases and reasons, never persisted private fields", () => {
  const privateText = "private-session-fixture";
  const observation = closedLifecycleObservation(
    {
      phase: "RECOVERY_REQUIRED",
      reasonCode: "SERVICE_HANDOFF_TIMEOUT",
      incompleteHandoff: true,
      sessionId: privateText,
    },
    {
      state: "RECOVERY_REQUIRED",
      reasonCode: "SERVICE_HANDOFF_TIMEOUT",
      lifecycleCorrelationId: privateText,
    },
  );
  assert.deepEqual(observation, {
    phase: "RECOVERY_REQUIRED",
    reason: "SERVICE_HANDOFF_TIMEOUT",
    incompleteHandoff: true,
    shutdown: "RECOVERY_REQUIRED",
    shutdownReason: "SERVICE_HANDOFF_TIMEOUT",
  });
  assert.ok(!JSON.stringify(observation).includes(privateText));
  const unknown = closedLifecycleObservation(
    { phase: privateText, reasonCode: privateText },
    { state: privateText, reasonCode: privateText },
  );
  assert.equal(unknown.phase, "UNKNOWN");
  assert.equal(unknown.reason, "UNKNOWN");
  assert.equal(unknown.shutdown, "UNKNOWN");
  assert.equal(unknown.shutdownReason, "UNKNOWN");
  assert.ok(!JSON.stringify(unknown).includes(privateText));
});

test("startup observations read the launcher's exact isolated profile rather than copied base history", async () => {
  const temporaryRoot = path.resolve(os.tmpdir());
  const root = await mkdtemp(
    path.join(temporaryRoot, "prmonitor-diagnostics-"),
  );
  try {
    for (const [stage, status, recovery] of [
      ["shell", "RUNNING", "COMPLETED"],
      ["conditional-publication", "STARTING", "PARTIAL"],
      ["conditional-sync", "RECOVERY_REQUIRED", "RUNNING"],
      ["conditional-preferences", "STOPPED", "FAILED"],
      ["bootstrap-failure", "HANDING_OFF", "PARTIAL"],
    ]) {
      const userData = userDataDirectoryForStage(root, stage);
      await mkdir(path.join(userData, "database"), { recursive: true });
      const db = new DatabaseSync(
        path.join(userData, "database/prmonitor.sqlite"),
      );
      try {
        db.exec(
          "CREATE TABLE settings (setting_key TEXT, value_json TEXT); CREATE TABLE f19_shutdown_intents (shutdown_id TEXT, payload_json TEXT); CREATE TABLE f28_recovery_sessions (status TEXT, stage TEXT, scope_count INTEGER, completed_count INTEGER, attention_count INTEGER, retry_count INTEGER, created_at TEXT)",
        );
        db.prepare("INSERT INTO settings VALUES (?, ?)").run(
          "f04.lifecycle",
          JSON.stringify({
            phase: status,
            sessionId: "private-profile-identity",
          }),
        );
        db.prepare(
          "INSERT INTO f28_recovery_sessions VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).run(recovery, "LOCAL_WORK", 3, 1, 1, 1, new Date().toISOString());
      } finally {
        db.close();
      }
      const app = Object.assign(new EventEmitter(), {
        requestSingleInstanceLock: () => true,
        isReady: () => true,
        getAppMetrics: () => [],
      });
      const observer = observeStartup({ app, root, stage });
      const observed = observer.snapshot();
      assert.equal(observed.lifecycle.phase, status);
      assert.equal(observed.recovery.state, recovery);
      assert.equal(observed.recovery.stage, "LOCAL_WORK");
      assert.ok(!JSON.stringify(observed).includes("private-profile-identity"));
      assert.ok(!JSON.stringify(observed).includes(root));
    }
  } finally {
    const relative = path.relative(temporaryRoot, path.resolve(root));
    assert.ok(
      relative.startsWith("prmonitor-diagnostics-") &&
        !relative.includes(path.sep),
    );
    await rm(root, { recursive: true });
  }
});
