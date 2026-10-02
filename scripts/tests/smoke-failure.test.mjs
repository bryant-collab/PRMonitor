import assert from "node:assert/strict";
import test from "node:test";
import { classifySmokeFailure } from "../../apps/desktop/scripts/smoke-failure.mjs";

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
