import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
const require = createRequire(import.meta.url);
const {
  ASSERTION_TIMEOUT_MS,
  STARTUP_WINDOW_TIMEOUT_MS,
  withDeadline,
  waitForCondition,
} = require("../../tests/setup-wait.cjs");

function clock() {
  let elapsed = 0;
  return {
    now: () => elapsed,
    sleep: async (milliseconds) => {
      elapsed += milliseconds;
    },
  };
}

for (const readyAt of [18217, 24699]) {
  test(`startup budget observes a window after ${readyAt}ms without changing assertion budget`, async () => {
    const startup = clock();
    const window = {};
    assert.equal(
      await waitForCondition(
        () => startup.now() >= readyAt && window,
        "window",
        { ...startup, timeoutMs: STARTUP_WINDOW_TIMEOUT_MS },
      ),
      window,
    );
    const assertion = clock();
    await assert.rejects(
      waitForCondition(() => assertion.now() >= readyAt, "renderer", assertion),
      /^Error: E2E_WAIT:renderer$/,
    );
    assert.ok(assertion.now() >= ASSERTION_TIMEOUT_MS);
    assert.ok(assertion.now() < ASSERTION_TIMEOUT_MS + 80);
  });
}

test("missing startup window still fails at the bounded startup deadline", async () => {
  const time = clock();
  await assert.rejects(
    waitForCondition(() => false, "window", {
      ...time,
      timeoutMs: STARTUP_WINDOW_TIMEOUT_MS,
    }),
    /^Error: E2E_WAIT:window$/,
  );
  assert.equal(time.now(), STARTUP_WINDOW_TIMEOUT_MS);
});

test("ready condition returns immediately and operation failures retain their identity", async () => {
  const time = clock();
  const value = {};
  assert.equal(await waitForCondition(() => value, "ready", time), value);
  assert.equal(time.now(), 0);
  const error = Error("fixture-error");
  await assert.rejects(
    waitForCondition(
      () => {
        throw error;
      },
      "ready",
      time,
    ),
    (caught) => caught === error,
  );
});

test("a blocked event loop cannot accept a window after the startup deadline", async () => {
  let elapsed = 0;
  let polls = 0;
  await assert.rejects(
    waitForCondition(() => ++polls > 1, "window", {
      timeoutMs: STARTUP_WINDOW_TIMEOUT_MS,
      now: () => elapsed,
      sleep: async () => {
        elapsed = STARTUP_WINDOW_TIMEOUT_MS + 1;
      },
    }),
    /^Error: E2E_WAIT:window$/,
  );
  assert.equal(polls, 1);
});

test("only initial window startup opts into the extra budget; stage watchdogs remain", async () => {
  const main = await readFile(
    new URL("../../tests/setup-e2e-main.cjs", import.meta.url),
    "utf8",
  );
  const parent = await readFile(
    new URL("../../tests/setup-e2e.mjs", import.meta.url),
    "utf8",
  );
  assert.equal(
    (main.match(/\n      STARTUP_WINDOW_TIMEOUT_MS,/g) ?? []).length,
    1,
  );
  assert.match(main, /"window",\n      STARTUP_WINDOW_TIMEOUT_MS/);
  assert.match(main, /55000,/);
  assert.match(parent, /65000\)/);
  for (const event of [
    "WINDOW_WAIT_STARTED",
    "WINDOW_WAIT_COMPLETED",
    "WINDOW_WAIT_FAILED",
  ])
    assert.ok(main.includes(`startupDiagnostics.note("${event}"`));
});

test("an operation completing at or after its deadline cannot return a late success", async () => {
  for (const duration of [
    STARTUP_WINDOW_TIMEOUT_MS,
    STARTUP_WINDOW_TIMEOUT_MS + 1,
  ]) {
    let elapsed = 0;
    await assert.rejects(
      waitForCondition(
        async () => {
          elapsed = duration;
          return {};
        },
        "window",
        {
          timeoutMs: STARTUP_WINDOW_TIMEOUT_MS,
          now: () => elapsed,
          sleep: async () => {
            throw Error("must not sleep after deadline");
          },
        },
      ),
      /^Error: E2E_WAIT:window$/,
    );
  }
});

test("a stalled renderer operation reports its exact step", async () => {
  await assert.rejects(
    withDeadline(() => new Promise(() => {}), "reference-frame-evaluation", 5),
    /^Error: E2E_STEP_TIMEOUT:reference-frame-evaluation$/,
  );
});
