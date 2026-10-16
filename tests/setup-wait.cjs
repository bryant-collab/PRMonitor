/* Harness-only budgets. Production startup and safety gates are unchanged. */
const ASSERTION_TIMEOUT_MS = 15000;
// Observed Windows cold startup reached 24.7s. Keep this separate from UI
// assertions and below the existing 55s child / 65s parent stage watchdogs.
const STARTUP_WINDOW_TIMEOUT_MS = 30000;

async function withDeadline(
  operation,
  label,
  timeoutMs = ASSERTION_TIMEOUT_MS,
) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`E2E_STEP_TIMEOUT:${label}`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForCondition(operation, label, options = {}) {
  const {
    timeoutMs = ASSERTION_TIMEOUT_MS,
    now = Date.now,
    sleep = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = options;
  const end = now() + timeoutMs;
  while (now() < end) {
    const value = await operation();
    if (now() >= end) break;
    if (value) return value;
    await sleep(80);
  }
  throw new Error(`E2E_WAIT:${label}`);
}

module.exports = {
  ASSERTION_TIMEOUT_MS,
  STARTUP_WINDOW_TIMEOUT_MS,
  withDeadline,
  waitForCondition,
};
