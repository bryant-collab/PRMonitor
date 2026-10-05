import { test } from "node:test";
import assert from "node:assert/strict";
import { forbiddenRuntimePayload } from "../runtime-payload.mjs";

test("packaged and archive paths reject runtime state, cache and fixtures", () => {
  for (const entry of [
    "resources/state.sqlite",
    "\\state.sqlite-wal",
    "out/state.db-shm",
    "profile/Cache/data",
    "profile/Code Cache/js/1",
    "backups/state.json",
    "out/.prmonitor-runtime-owner.json",
    "runtime-fixtures/review.json",
    "tests/fixtures/approved-reference.html",
    "sessionData/network",
    "userData/preferences.json",
    "node_modules/.cache/index",
    "profile/Session Storage/1",
  ])
    assert.equal(forbiddenRuntimePayload(entry), true, entry);
  for (const entry of [
    "out/main/index.js",
    "out/renderer/index.html",
    "package.json",
    "node_modules/sdk/schema.json",
    "resources/app.asar",
    "out/renderer/assets/ActivityViewer.js",
  ])
    assert.equal(forbiddenRuntimePayload(entry), false, entry);
});
