import assert from "node:assert/strict";
import test from "node:test";
import { summarizeDescendants } from "../../tests/setup-process-diagnostics.mjs";

test("closed-process observations exclude unrelated processes and reused ancestry and publish only aggregate labels", () => {
  const summary = summarizeDescendants(
    [
      { pid: 30, parent: 20, created: 103, name: "git.exe", memory: 1048576 },
      {
        pid: 20,
        parent: 10,
        created: 102,
        name: "electron.exe",
        memory: 2097152,
      },
      {
        pid: 40,
        parent: 10,
        created: 99,
        name: "private-old.exe",
        memory: 999999,
      },
      {
        pid: 50,
        parent: 40,
        created: 104,
        name: "private-child.exe",
        memory: 999999,
      },
      {
        pid: 60,
        parent: 123,
        created: 104,
        name: "unrelated.exe",
        memory: 999999,
      },
      {
        pid: 70,
        parent: 20,
        created: 105,
        name: "private-tool.exe",
        memory: 1048576,
      },
    ],
    10,
    100,
  );
  assert.deepEqual(summary, {
    state: "OBSERVED",
    descendants: 3,
    kinds: { electron: 1, git: 1, other: 1 },
    workingSetMb: 4,
  });
  assert.doesNotMatch(JSON.stringify(summary), /private|unrelated|pid|parent/);
});
