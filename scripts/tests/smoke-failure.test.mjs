import assert from "node:assert/strict";
import test from "node:test";
import {
  classifySmokeFailure,
  classifySandboxSubreason,
  classifyApplicationSmokeReason,
} from "../../apps/desktop/scripts/smoke-failure.mjs";

test("smoke failures expose fixed categories without child-output contents", () => {
  for (const [stderr, category] of [
    ["FATAL: No usable sandbox!", "SANDBOX_SETUP_FAILED"],
    [
      "The SUID sandbox helper binary was found, but is not configured correctly",
      "SANDBOX_SETUP_FAILED",
    ],
    [
      "Failed to move to new namespace: Operation not permitted",
      "SANDBOX_SETUP_FAILED",
    ],
    ["Missing X server or $DISPLAY", "DISPLAY_SETUP_FAILED"],
    ["GPU process isn't usable. Goodbye.", "GPU_PROCESS_FAILED"],
    ["Unrecognized error containing private test text", "UNCLASSIFIED"],
  ]) {
    assert.equal(classifySmokeFailure(stderr), category);
  }
});

test("compatibility diagnostics expose only fixed application startup reasons", () => {
  assert.equal(
    classifyApplicationSmokeReason(
      "private/path PRMONITOR_SMOKE_ERROR:ACCESSIBILITY_PROBE_FAILED:private text",
    ),
    "ACCESSIBILITY_PROBE_FAILED",
  );
  assert.equal(
    classifyApplicationSmokeReason("PRMONITOR_SMOKE_ERROR:PRIVATE_TEXT"),
    "UNCLASSIFIED",
  );
});

test("sandbox subreasons distinguish helper configuration from namespace rejection without exposing child text", () => {
  assert.equal(
    classifySandboxSubreason(
      "private-path SUID sandbox helper binary must be owned by root and mode 4755",
    ),
    "HELPER_OWNERSHIP_OR_MODE",
  );
  assert.equal(
    classifySandboxSubreason(
      "private-path Failed to move to new namespace: Operation not permitted",
    ),
    "NAMESPACE_PERMISSION",
  );
  assert.equal(
    classifySandboxSubreason("No usable sandbox! private-path"),
    "NO_USABLE_SANDBOX",
  );
  assert.equal(
    classifySandboxSubreason("private unrecognized contents"),
    "UNCLASSIFIED",
  );
});
