/* Read-only, closed-label observations of the real isolated application. */
const path = require("node:path");
const os = require("node:os");
const { DatabaseSync } = require("node:sqlite");
const stages = new Set([
  "LIFECYCLE",
  "SCHEDULER",
  "HOLDS",
  "LOCAL_WORK",
  "AI",
  "REVIEW_PUBLICATION",
  "SYNC_PUBLICATION",
  "FINALIZE",
]);
const reasons = new Set([
  "clean-exit",
  "abnormal-exit",
  "killed",
  "crashed",
  "oom",
  "launch-failed",
  "integrity-failure",
  "memory-eviction",
]);

const shutdownReasons = new Set([
  "SHUTDOWN_REQUESTED",
  "SHUTDOWN_INTENT_COMMITTED",
  "SERVICE_HANDOFF_STARTED",
  "SHUTDOWN_COMPLETE",
  "SERVICE_STOP_FAILED",
  "SERVICE_STOP_TIMEOUT",
  "SERVICE_HANDOFF_TIMEOUT",
  "SERVICE_HANDOFF_FAILED",
  "HANDOFF_RECOVERY_REQUIRED",
  "INCOMPLETE_LIFECYCLE_HANDOFF",
  "TRAY_REMOVAL_FAILED",
]);
exports.closedLifecycleObservation = function (status, intent) {
  const allowed = (value, values) =>
    values.includes(value) ? value : "UNKNOWN";
  const reason = (value) =>
    value === undefined
      ? undefined
      : shutdownReasons.has(value)
        ? value
        : "UNKNOWN";
  return {
    phase:
      status === undefined
        ? "NO_STATUS"
        : allowed(status.phase, [
            "STARTING",
            "RUNNING",
            "SHUTDOWN_REQUESTED",
            "HANDING_OFF",
            "STOPPED",
            "RECOVERY_REQUIRED",
          ]),
    reason: reason(status?.reasonCode),
    incompleteHandoff: status?.incompleteHandoff === true,
    shutdown:
      intent === undefined
        ? "NO_INTENT"
        : allowed(intent.state, [
            "REQUESTED",
            "HANDING_OFF",
            "COMPLETED",
            "RECOVERY_REQUIRED",
          ]),
    shutdownReason: reason(intent?.reasonCode),
  };
};

exports.observeStartup = function ({ app, root, bootstrap }) {
  const started = Date.now();
  const events = [];
  const git = {
    started: 0,
    completed: 0,
    exited: 0,
    active: 0,
    peakActive: 0,
    longestMs: 0,
  };
  const lifecycle = () => {
    let db;
    try {
      db = new DatabaseSync(
        path.join(
          root,
          bootstrap ? "bootstrap-user-data" : "user-data",
          "database/prmonitor.sqlite",
        ),
        { readOnly: true },
      );
      db.exec("PRAGMA busy_timeout=0");
      const setting = db
        .prepare(
          "SELECT value_json FROM settings WHERE setting_key = 'f04.lifecycle'",
        )
        .get();
      const intent = db
        .prepare(
          "SELECT payload_json FROM f19_shutdown_intents WHERE shutdown_id = 'application-shutdown'",
        )
        .get();
      return exports.closedLifecycleObservation(
        setting ? JSON.parse(setting.value_json) : undefined,
        intent ? JSON.parse(intent.payload_json) : undefined,
      );
    } catch {
      return { phase: "UNAVAILABLE", shutdown: "UNAVAILABLE" };
    } finally {
      db?.close();
    }
  };
  let acquired,
    windowsCreated = 0,
    windowsClosed = 0;
  const note = (event, extra = {}) => {
    if (events.length < 24)
      events.push({ event, elapsedMs: Date.now() - started, ...extra });
  };
  const lock = app.requestSingleInstanceLock.bind(app);
  app.requestSingleInstanceLock = (...args) => {
    acquired = lock(...args);
    note(acquired ? "PRIMARY_LOCK_ACQUIRED" : "PRIMARY_LOCK_REFUSED");
    return acquired;
  };
  app.once("ready", () => note("APP_READY"));
  app.on("browser-window-created", (_event, window) => {
    windowsCreated++;
    note("WINDOW_CREATED");
    window.once("closed", () => {
      windowsClosed++;
      note("WINDOW_CLOSED");
    });
    window.webContents.once("did-finish-load", () => note("RENDERER_LOADED"));
    window.webContents.on("render-process-gone", (_event, details) =>
      note("RENDERER_GONE", {
        reason: reasons.has(details.reason) ? details.reason : "UNKNOWN",
      }),
    );
    window.webContents.on("did-fail-load", (_event, code) =>
      note("RENDERER_LOAD_FAILED", { code }),
    );
  });
  app.on("child-process-gone", (_event, details) =>
    note("CHILD_PROCESS_GONE", {
      reason: reasons.has(details.reason) ? details.reason : "UNKNOWN",
    }),
  );
  const recovery = () => {
    let db;
    try {
      db = new DatabaseSync(
        path.join(
          root,
          bootstrap ? "bootstrap-user-data" : "user-data",
          "database/prmonitor.sqlite",
        ),
        { readOnly: true },
      );
      db.exec("PRAGMA busy_timeout=0");
      const row = db
        .prepare(
          "SELECT status, stage, scope_count, completed_count, attention_count, retry_count, created_at FROM f28_recovery_sessions ORDER BY created_at DESC LIMIT 1",
        )
        .get();
      if (!row) return { state: "NO_SESSION" };
      return {
        state: ["RUNNING", "COMPLETED", "PARTIAL", "FAILED"].includes(
          row.status,
        )
          ? row.status
          : "UNKNOWN",
        stage: stages.has(row.stage) ? row.stage : "UNKNOWN",
        scopes: row.scope_count,
        completed: row.completed_count,
        attention: row.attention_count,
        retries: row.retry_count,
        createdThisProcess: Date.parse(row.created_at) >= started,
        ageMs: Math.max(0, Date.now() - Date.parse(row.created_at)),
      };
    } catch {
      return { state: "UNAVAILABLE" };
    } finally {
      db?.close();
    }
  };
  return {
    note,
    trackGit(work, begin) {
      git.started++;
      git.active++;
      git.peakActive = Math.max(git.peakActive, git.active);
      let finished = false;
      const complete = () => {
        if (finished) return;
        finished = true;
        git.completed++;
        git.active--;
        git.longestMs = Math.max(git.longestMs, Date.now() - begin);
      };
      if (work?.once) {
        work.once("exit", () => git.exited++);
        work.once("close", complete);
        work.once("error", complete);
      } else complete();
    },
    snapshot() {
      let metrics = [];
      try {
        metrics = app.getAppMetrics();
      } catch {
        /* Before app ready. */
      }
      return {
        elapsedMs: Date.now() - started,
        appReady: app.isReady(),
        primaryLockAcquired: acquired ?? null,
        windowsCreated,
        windowsClosed,
        events,
        git: { ...git },
        appProcessCount: metrics.length,
        appWorkingSetMb: Math.round(
          metrics.reduce(
            (sum, metric) => sum + (metric.memory?.workingSetSize ?? 0),
            0,
          ) / 1024,
        ),
        freeMemoryMb: Math.round(os.freemem() / 1048576),
        recovery: recovery(),
        lifecycle: lifecycle(),
      };
    },
  };
};
