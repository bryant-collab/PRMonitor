import { createRequire } from "node:module";
import assert from "node:assert/strict";
import test from "node:test";
const require = createRequire(import.meta.url);
const {
  closedLifecycleObservation,
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
