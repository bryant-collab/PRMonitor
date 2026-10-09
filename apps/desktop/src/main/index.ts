import { checkAITool } from "./ai/tool-detection";
import { recoveryActivityAttribution } from "../shared/recovery-attribution";
import { projectManagedPrWork } from "./managed-pr-work";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  powerMonitor,
  safeStorage,
} from "electron";
import { existsSync, mkdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { resolveRuntimePaths, type RuntimePaths } from "./runtime-paths";
import { fileURLToPath } from "node:url";
import {
  APPLICATION_ID,
  APPLICATION_TITLE,
  SMOKE_READY_PREFIX,
  STARTUP_STATUS_ID,
} from "../shared/startup";
import {
  OPEN_TARGET_QUEUE_MAX,
  OpenTargetQueue,
  type OpenTarget,
} from "../shared/routing";
import type { CurrentState, IpcError } from "../shared/ipc";
import { IPC_MAX_REQUEST_BYTES, IPC_MAX_RESPONSE_BYTES } from "../shared/ipc";
import {
  ACTIVITY_MAX_DETAIL_BYTES,
  ACTIVITY_MAX_SUMMARY_BYTES,
} from "../shared/activity";
import {
  createPersistenceRepositories,
  initializePersistence,
  type PersistenceRepositories,
  type PersistenceStore,
  createF07PersistenceRepositories,
  F10PersistenceRepositories,
  F11PersistenceRepositories,
  F12PersistenceRepositories,
  F13PersistenceRepositories,
  F14ValidationRepositories,
  F17PersistenceRepositories,
  F18PersistenceRepositories,
  F19PersistenceRepositories,
  F21PersistenceRepositories,
  F22PersistenceRepositories,
  F24PersistenceRepositories,
  F25PersistenceRepositories,
  F27PersistenceRepositories,
  F28RecoveryRepositories,
} from "./persistence";
import {
  createPersistenceLifecyclePersistence,
  LifecycleCoordinator,
  DEFAULT_SERVICE_HANDOFF_TIMEOUT_MS,
} from "./lifecycle";
import { IpcRouter } from "./ipc-router";
import {
  SetupReadinessService,
  setupGitHubAccess,
} from "./setup-readiness-service";
import { createSetupLocalPrerequisitesReader } from "./setup-local-prerequisites";
import {
  startupRecoveryReadiness,
  startupRecoveryRelaunchArguments,
} from "./setup-startup-recovery";
import { FetchGithubHttpTransport } from "./github-connection-test";
import { GithubServerService } from "./github-server-service";
import { ElectronSecureCredentialStore } from "./secure-credential-store";
import { PrimaryInstanceCoordinator } from "./instance-routing";
import {
  ElectronWindowPlatformAdapter,
  WindowsWindowPlatformAdapter,
} from "./platform-window";
import {
  WindowManager,
  type ManagedWindowLike,
  type WindowOpenResult,
} from "./window-manager";
import { ManagedPrService } from "./managed-pr-service";
import {
  createManagedPrInboxService,
  type ManagedPrInboxService,
} from "./managed-pr-inbox-service";
import { ActivityService } from "./activity-service";
import { F11EligibilityService } from "./f11-eligibility-service";
import type { F10PollRunResult } from "./pr-polling-contracts";
import type {
  F12SchedulerConfigurationInput,
  F12SchedulerControlResult,
  F12SchedulerSnapshot,
} from "../shared/control-plane";
import { resolveF12SchedulerConfiguration } from "../shared/control-plane";
import type {
  F16RepositoryIdentity,
  F16ValidationSummary,
} from "../shared/f16-preferences";
import { resolveValidationProfile } from "@prmonitor/validation-contract";
import {
  AIProviderRegistry,
  createCodexProvider,
  createClaudeProvider,
  createCopilotProvider,
} from "./ai";
import { ConnectionAuthentication } from "./ai/connection-authentication";
import { F13WorktreeService } from "./f13-service";
import { ElectronF13OsPathAdapter } from "./f13-os-adapter";
import { ValidationRunService } from "./f14-validation-runner";
import {
  createF16PreferencesRepository,
  F16PreferencesService,
} from "./f16-preferences-service";
import {
  AutomaticReviewCoordinator,
  type F18AutomaticReviewBoundary,
} from "./automatic-review-coordinator";
import { F18AIWorkAdapter } from "./automatic-review-ai-adapter";
import { F21AIWorkAdapter } from "./f21-ai-work-adapter";
import { F26AIWorkAdapter } from "./f26-ai-work-adapter";
import { F26ConflictResolutionService } from "./f26-conflict-resolution-service";
import { F21ConversationService } from "./f21-conversation-service";
import { F20WorkspaceService } from "./f20-workspace-service";
import { F22Coordinator } from "./f22-coordinator";
import { F23PublicationService } from "./f23-release-service";
import { F23DeterministicGitPublisher } from "./f23-release-git";
import { F27DeterministicGitPublisher } from "./f27-release-git";
import { F27SynchronizationService } from "./f27-synchronization-service";
import { createF23GithubResponsePublisher } from "./f23-release-github";
import { TrayNotificationCoordinator } from "./f19-coordinator";
import { ElectronF19NativeSurfaceAdapter } from "./f19-native-adapter";
import { createF19EffectiveBounds } from "../shared/f19-native-surfaces";
import {
  MAX_PERSISTED_JSON_BYTES,
  MAX_PERSISTED_TEXT_BYTES,
} from "./persistence/types";
import {
  F24SynchronizationService,
  type F24F13ReadinessResult,
} from "./f24-synchronization-service";
import {
  f24Fingerprint,
  f24BranchRefIdentity,
  f24Reason,
  type F24F16ConfigurationReference,
} from "../shared/f24-synchronization";
import { F25SynchronizationService } from "./f25-synchronization-service";
import {
  F28RecoveryCoordinator,
  type F28RecoveryOwner,
} from "./f28-recovery-service";
import { readOnlineState } from "./f28-connectivity";
import {
  createF29SecurityService,
  type F29SecurityService,
} from "./f29-security-service";
import { F30SupportDiagnosticsService } from "./f30-support-diagnostics";
import {
  F28_SCHEMA_VERSION,
  type F28OwnerOutcome,
  type F28LifecycleSnapshot,
  type F28RecoveryScopeInput,
} from "../shared/f28-recovery";

interface MainPrWatcher {
  readonly reconcileStartup: () => void;
  readonly runForManagedPrs: (
    managedPrIds: readonly string[] | undefined,
    signal?: AbortSignal,
  ) => Promise<F10PollRunResult>;
  readonly stop: () => void;
}

interface MainReviewScheduler {
  readonly start: () => void;
  readonly stop: () => void;
  readonly read: () => F12SchedulerSnapshot;
  readonly checkNow: (input: {
    readonly requestId: string;
    readonly managedPrId?: string;
  }) => Promise<F12SchedulerControlResult>;
  readonly pauseWatching: (input: {
    readonly requestId: string;
    readonly expectedRevision?: number;
  }) => F12SchedulerControlResult;
  readonly resumeWatching: (input: {
    readonly requestId: string;
    readonly expectedRevision?: number;
  }) => F12SchedulerControlResult;
  readonly updateConfiguration: (input: {
    readonly actor: string;
    readonly requestId: string;
    readonly configuration: F12SchedulerConfigurationInput;
    readonly expectedRevision?: number;
  }) => F12SchedulerSnapshot;
}

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
function applicationIconPath(): string | undefined {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, "prmonitor.png")]
    : [path.join(currentDirectory, "..", "..", "build", "prmonitor.png")];
  return candidates.find((candidate) => existsSync(candidate));
}

const smokeMode = process.env.PRMONITOR_SMOKE === "1";
const smokeNonce = process.env.PRMONITOR_SMOKE_NONCE;
const smokeTimeoutMs = 29_000;
let smokeReady = false;
let smokeTimer: NodeJS.Timeout | undefined;
let smokeWindow: BrowserWindow | undefined;
let persistenceStore: PersistenceStore | undefined;
let persistenceRepositories: PersistenceRepositories | undefined;
let lifecycle: LifecycleCoordinator | undefined;
let ipcRouter: IpcRouter | undefined;
let setupReadinessService: SetupReadinessService | undefined;
let setupReadinessTimer: NodeJS.Timeout | undefined;
let windowManager: WindowManager | undefined;
let githubServerService: GithubServerService | undefined;
let managedPrService: ManagedPrService | undefined;
let managedPrInboxService: ManagedPrInboxService | undefined;
let activityService: ActivityService | undefined;
let f11EligibilityService: F11EligibilityService | undefined;
let prWatcher: MainPrWatcher | undefined;
let reviewScheduler: MainReviewScheduler | undefined;
let f13WorktreeService: F13WorktreeService | undefined;
let f14ValidationService: ValidationRunService | undefined;
let f16PreferencesService: F16PreferencesService | undefined;
let connectionAuthentication: ConnectionAuthentication | undefined;
let automaticReviewCoordinator: F18AutomaticReviewBoundary | undefined;
let f22Coordinator: F22Coordinator | undefined;
let automaticReviewAiAdapter: F18AIWorkAdapter | undefined;
let f21AiWorkAdapter: F21AIWorkAdapter | undefined;
let f26AiWorkAdapter: F26AIWorkAdapter | undefined;
let f26ConflictResolutionService: F26ConflictResolutionService | undefined;
let f21ConversationService: F21ConversationService | undefined;
let f20WorkspaceService: F20WorkspaceService | undefined;
let f23PublicationService: F23PublicationService | undefined;
let f19PersistenceRepositories: F19PersistenceRepositories | undefined;
let f19Coordinator: TrayNotificationCoordinator | undefined;
let f24SynchronizationService: F24SynchronizationService | undefined;
let f25SynchronizationService: F25SynchronizationService | undefined;
let f27SynchronizationService: F27SynchronizationService | undefined;
let f28RecoveryCoordinator: F28RecoveryCoordinator | undefined;
let f29SecurityService: F29SecurityService | undefined;
let f30SupportDiagnostics: F30SupportDiagnosticsService | undefined;
let f28LifecycleListenersAttached = false;
let f28ResumeHandler: (() => void) | undefined;
let f28NetworkPollTimer: NodeJS.Timeout | undefined;
const pendingTargets = new OpenTargetQueue();
let lastAcceptedOpenTarget: OpenTarget | undefined;

const rendererEntry = path.join(
  currentDirectory,
  "..",
  "renderer",
  "index.html",
);
const preloadEntry = path.join(currentDirectory, "..", "preload", "index.cjs");

const F29_RENDERER_CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none';";

function configureF29BrowserWindowSecurity(window: BrowserWindow): void {
  const rendererRoot = path.resolve(path.dirname(rendererEntry));
  window.webContents.on("will-navigate", (event, url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "file:") {
        event.preventDefault();
        return;
      }
      const target = path.resolve(fileURLToPath(parsed));
      const relative = path.relative(rendererRoot, target);
      if (
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      )
        event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
  window.webContents.session.webRequest.onHeadersReceived(
    { urls: ["file://*/*"] },
    (details, callback) => {
      const responseHeaders = { ...(details.responseHeaders ?? {}) };
      responseHeaders["Content-Security-Policy"] = [
        F29_RENDERER_CONTENT_SECURITY_POLICY,
      ];
      callback({ responseHeaders });
    },
  );
}

function requestF28RendererReplacement(): void {
  const coordinator = f28RecoveryCoordinator;
  if (coordinator === undefined) return;
  const phase = lifecycle?.getStatus().phase;
  if (
    phase === "SHUTDOWN_REQUESTED" ||
    phase === "HANDING_OFF" ||
    phase === "STOPPED"
  )
    return;
  void coordinator
    .rendererReplaced(`f28-renderer-replaced-${randomUUID()}`)
    .catch(() => undefined);
}

function detachF28LifecycleListeners(): void {
  if (!f28LifecycleListenersAttached) return;
  if (f28ResumeHandler !== undefined)
    powerMonitor.removeListener("resume", f28ResumeHandler);
  if (f28NetworkPollTimer !== undefined) clearInterval(f28NetworkPollTimer);
  f28ResumeHandler = undefined;
  f28NetworkPollTimer = undefined;
  f28LifecycleListenersAttached = false;
}

let runtimePaths: RuntimePaths;
function configureRuntimePaths(): void {
  runtimePaths = resolveRuntimePaths({
    environment: process.env,
    packaged: app.isPackaged,
    customerRoot: path.join(app.getPath("appData"), APPLICATION_TITLE),
    appData: app.getPath("appData"),
    temporaryRoot: os.tmpdir(),
  });
  for (const directory of [
    runtimePaths.userData,
    runtimePaths.cache,
    runtimePaths.sessionData,
  ])
    mkdirSync(directory, { recursive: true });
  app.setPath("userData", runtimePaths.userData);
  app.setPath("cache", runtimePaths.cache);
  app.setPath("sessionData", runtimePaths.sessionData);
}

const accessibilityProbe = `(() => {
  const visible = (element) => {
    const style = window.getComputedStyle(element);
    return element.getClientRects().length > 0 && style.display !== "none" && style.visibility !== "hidden" && element.getAttribute("aria-hidden") !== "true";
  };
  const focusable = [...document.querySelectorAll("a[href], button, input, select, textarea, [tabindex]:not([tabindex=\\"-1\\"])" )]
    .filter((element) => visible(element) && !element.hasAttribute("disabled"));
  const skipLink = document.querySelector(".skip-link");
  const status = document.querySelector("#${STARTUP_STATUS_ID}");
  const heading = document.querySelectorAll("h1");
  const addForm = document.querySelector('form[aria-label="Add a pull request"]');
  const githubForm = document.querySelector('form[aria-label="Add or update GitHub server"]');
  const isAdd = addForm !== null && visible(addForm);
  const managedPrForm = isAdd ? addForm : githubForm;
  const managedPrHeading = document.querySelector(isAdd ? "#managed-pr-heading" : "#server-settings-heading");
  const managedPrControls = managedPrForm === null
    ? []
    : [...managedPrForm.querySelectorAll("input, textarea, select, button")];
  if (!skipLink || !status || !managedPrForm || !managedPrHeading) return { ok: false, reason: "required-target-missing" };
  const skipIndex = focusable.indexOf(skipLink);
  const statusIndex = focusable.indexOf(status);
  skipLink.focus();
  const skipFocused = document.activeElement === skipLink;
  skipLink.click();
  const enterMovesFocus = document.activeElement === status;
  return {
    ok: document.title === "${APPLICATION_TITLE}" &&
      heading.length === 1 && visible(heading[0]) &&
      status.getAttribute("role") === "status" &&
      status.getAttribute("aria-live") === "polite" &&
      status.getAttribute("data-prmonitor-ready") === "true" &&
      visible(managedPrForm) && visible(managedPrHeading) &&
      managedPrForm.getAttribute("aria-label") === (isAdd ? "Add a pull request" : "Add or update GitHub server") &&
      managedPrHeading.textContent?.trim() === (isAdd ? "Add PR" : "GitHub servers") &&
      managedPrControls.length >= (isAdd ? 7 : 4) &&
      managedPrControls.every((element) => element.tagName === "BUTTON" || element.labels?.length > 0 || element.getAttribute("aria-label") !== null) &&
      skipIndex >= 0 && statusIndex > skipIndex && skipFocused && enterMovesFocus,
    forcedColors: window.matchMedia("(forced-colors: active)").matches,
    title: document.title,
    headingCount: heading.length,
    statusRole: status.getAttribute("role"),
    statusLive: status.getAttribute("aria-live"),
    statusReady: status.getAttribute("data-prmonitor-ready"),
    skipIndex,
    statusIndex,
    skipFocused,
    enterMovesFocus,
  };
})()`;

function smokeFailure(reason: string, error?: unknown): void {
  const detail =
    error instanceof Error
      ? error.message
      : error === undefined
        ? ""
        : String(error);
  process.stderr.write(
    `PRMONITOR_SMOKE_ERROR:${reason}${detail ? `:${detail}` : ""}\n`,
  );
  if (smokeTimer !== undefined) clearTimeout(smokeTimer);
  app.exit(1);
}

async function runAccessibilityProbe(
  window: BrowserWindow,
): Promise<{ ok: boolean; forcedColors: boolean; reason?: string }> {
  // Fresh profiles start at GitHub setup. Probe its real visible form; ready
  // profiles exercise the focused Add PR route. Keep native keyboard/semantics checks.
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const opened = await window.webContents.executeJavaScript(
      `(() => {
      const setupForm = document.querySelector('form[aria-label="Add or update GitHub server"]');
      if (setupForm?.getClientRects().length) return true;
      const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === 'Add PR' && !item.disabled && item.getClientRects().length);
      if (!button) return false; button.click(); return true;
    })()`,
      true,
    );
    if (opened) break;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  // Route activation and the Add form's IPC reads complete asynchronously.
  // Reuse the existing probe deadline instead of assuming a fixed render delay.
  let formReady = false;
  while (Date.now() < deadline) {
    formReady = await window.webContents.executeJavaScript(
      `(() => {
        const add = document.querySelector('form[aria-label="Add a pull request"]');
        const github = document.querySelector('form[aria-label="Add or update GitHub server"]');
        const isAdd = Boolean(add?.getClientRects().length);
        const form = isAdd ? add : github;
        return Boolean(form?.getClientRects().length && document.querySelector(isAdd ? '#managed-pr-heading' : '#server-settings-heading') &&
          form.querySelectorAll('input, textarea, select, button').length >= (isAdd ? 7 : 4));
      })()`,
      true,
    );
    if (formReady) break;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  if (!formReady)
    return {
      ok: false,
      forcedColors: false,
      reason: "ACCESSIBILITY_TARGET_MISSING",
    };
  // Let the rendered route's pending layout/focus effects finish before the
  // native keyboard probe establishes its own starting point. A route may
  // legitimately focus a field instead of its heading after asynchronous reads.
  const routeSettled = await window.webContents.executeJavaScript(
    `new Promise(resolve => {
      const timer = setTimeout(() => resolve(false), ${Math.max(0, deadline - Date.now())});
      requestAnimationFrame(() => requestAnimationFrame(() => {
        clearTimeout(timer); resolve(true);
      }));
    })`,
    true,
  );
  if (!routeSettled)
    return {
      ok: false,
      forcedColors: false,
      reason: "ACCESSIBILITY_RENDERER_SETTLE_FAILED",
    };
  await window.webContents.executeJavaScript(
    `(() => {
    const optional = document.querySelector('.optional-pr-settings');
    if (optional) optional.open = true;
  })()`,
    true,
  );
  const normal = (await window.webContents.executeJavaScript(
    accessibilityProbe,
    true,
  )) as {
    ok: boolean;
    forcedColors: boolean;
  };
  if (!normal.ok)
    return { ...normal, reason: "ACCESSIBILITY_SEMANTICS_FAILED" };
  const normalKeyboard = await runKeyboardProbe(window, deadline);
  if (normalKeyboard !== "PASSED") {
    return {
      ok: false,
      forcedColors: false,
      reason: normalKeyboard,
    };
  }

  try {
    window.webContents.debugger.attach("1.3");
    await window.webContents.debugger.sendCommand(
      "Emulation.setEmulatedMedia",
      {
        features: [{ name: "forced-colors", value: "active" }],
      },
    );
    const forced = (await window.webContents.executeJavaScript(
      accessibilityProbe,
      true,
    )) as { ok: boolean; forcedColors: boolean };
    const forcedKeyboard = await runKeyboardProbe(window, deadline);
    await window.webContents.debugger.sendCommand(
      "Emulation.setEmulatedMedia",
      { features: [] },
    );
    window.webContents.debugger.detach();
    if (!forced.ok || !forced.forcedColors || forcedKeyboard !== "PASSED")
      return {
        ok: false,
        forcedColors: forced.forcedColors,
        reason:
          !forced.ok || !forced.forcedColors
            ? "ACCESSIBILITY_FORCED_COLORS_FAILED"
            : "ACCESSIBILITY_FORCED_KEYBOARD_FAILED",
      };
  } catch (error) {
    try {
      if (window.webContents.debugger.isAttached())
        window.webContents.debugger.detach();
    } catch {
      // Detaching is best effort after a failed probe; the smoke result remains failed.
    }
    throw new Error(
      `forced-colors probe unavailable: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return { ok: true, forcedColors: true };
}

async function runKeyboardProbe(
  window: BrowserWindow,
  deadline: number,
): Promise<
  | "PASSED"
  | "ACCESSIBILITY_WINDOW_FOCUS_FAILED"
  | "ACCESSIBILITY_BODY_FOCUS_FAILED"
  | "ACCESSIBILITY_TAB_FAILED"
  | "ACCESSIBILITY_ENTER_FAILED"
> {
  const waitForFocus = async (expression: string): Promise<boolean> => {
    while (Date.now() < deadline) {
      if (await window.webContents.executeJavaScript(expression, true))
        return true;
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    return false;
  };
  // sendInputEvent requires the containing BrowserWindow to be focused. This
  // is an owned smoke window; no input is sent until native and document focus
  // are observed, within the original shared accessibility deadline.
  window.focus();
  window.webContents.focus();
  while (!window.isFocused() && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  if (!window.isFocused()) return "ACCESSIBILITY_WINDOW_FOCUS_FAILED";
  await window.webContents.executeJavaScript(
    `(() => {
      const body = document.body;
      body.setAttribute("tabindex", "-1");
      body.focus();
    })()`,
    true,
  );
  try {
    if (
      !(await waitForFocus(
        "document.hasFocus() && document.activeElement === document.body",
      ))
    )
      return "ACCESSIBILITY_BODY_FOCUS_FAILED";
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "TAB" });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "TAB" });
    // Native input is processed by the renderer asynchronously. Observe its
    // actual focus result within the existing accessibility deadline.
    const tabTarget = await waitForFocus(
      `document.activeElement?.classList.contains("skip-link") === true`,
    );
    if (!tabTarget) return "ACCESSIBILITY_TAB_FAILED";

    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "ENTER" });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "ENTER" });
    const enterTarget = await waitForFocus(
      `document.activeElement?.id === "${STARTUP_STATUS_ID}"`,
    );
    return enterTarget ? "PASSED" : "ACCESSIBILITY_ENTER_FAILED";
  } finally {
    await window.webContents.executeJavaScript(
      'document.body.removeAttribute("tabindex")',
      true,
    );
  }
}

const F00_VALIDATION_BOUNDS_REVISION = "f00-validation-v1";

function resolveF16ValidationSummary(
  repository: F16RepositoryIdentity,
  operationId?: string,
): F16ValidationSummary {
  const resolution = resolveValidationProfile({
    repositoryId: repository.key,
    ...(operationId === undefined ? {} : { operationId }),
  });
  if (resolution.status === "unavailable") {
    return {
      status: resolution.status,
      phases: [],
      warningCode: resolution.warning.code,
      boundsRevision: F00_VALIDATION_BOUNDS_REVISION,
    };
  }
  if (resolution.status === "invalid") {
    return {
      status: resolution.status,
      source: resolution.source,
      phases: [],
      warningCode: resolution.warning.code,
      boundsRevision: F00_VALIDATION_BOUNDS_REVISION,
    };
  }
  const phases = [
    ...new Set(
      resolution.profile.steps.map((step) => step.phase ?? "post_change"),
    ),
  ];
  return {
    status: resolution.status,
    source: resolution.source,
    schemaVersion: resolution.profile.schemaVersion,
    contentHash: resolution.contentHash,
    ...(resolution.status === "ready"
      ? {
          authorization: {
            authorizationType: resolution.authorization.authorizationType,
            id: resolution.authorization.id,
          },
        }
      : {}),
    commandCount: resolution.profile.steps.filter(
      (step) => step.kind === "command",
    ).length,
    manualCheckCount: resolution.profile.steps.filter(
      (step) => step.kind === "manual",
    ).length,
    phases,
    ...(resolution.status === "confirmation_required"
      ? { warningCode: resolution.warning.code }
      : {}),
    boundsRevision: F00_VALIDATION_BOUNDS_REVISION,
  };
}

try {
  configureRuntimePaths();
} catch (error) {
  smokeFailure("SMOKE_RUNTIME_PATHS_INVALID", error);
}

app.setName(APPLICATION_TITLE);
if (process.platform === "win32") app.setAppUserModelId(APPLICATION_ID);

async function initializeMainProcessPersistence(): Promise<void> {
  const userDataDirectory = app.getPath("userData");
  f29SecurityService = createF29SecurityService({
    applicationDataRoot: userDataDirectory,
    platform: process.platform === "win32" ? "win32" : "posix",
  });
  const databasePath = path.join(
    userDataDirectory,
    "database",
    "prmonitor.sqlite",
  );
  const databaseAdmission = f29SecurityService.validateDatabasePath({
    databasePath,
  });
  if (!databaseAdmission.ok)
    throw new Error(`F29_${databaseAdmission.error.code}`);
  persistenceStore = await initializePersistence({
    databasePath,
    backupRoot: path.join(userDataDirectory, "backups"),
  });
  activityService = new ActivityService(persistenceStore);
  try {
    activityService.retain();
  } catch {
    // Activity maintenance is diagnostic only; it cannot block authoritative
    // application startup or be interpreted as workflow state.
  }
  const f03Repositories = createPersistenceRepositories(persistenceStore);
  persistenceRepositories = f03Repositories;
  f19PersistenceRepositories = new F19PersistenceRepositories(persistenceStore);
  const f13Root = runtimePaths.worktrees;
  await mkdir(f13Root, { recursive: true });
  const f13Repositories = new F13PersistenceRepositories(persistenceStore);
  f13WorktreeService = new F13WorktreeService({
    repositories: f13Repositories,
    defaultRoot: f13Root,
    os: new ElectronF13OsPathAdapter(),
    activity: {
      append: (event) => {
        activityService?.writer.append({
          eventId: `f13-activity-${randomUUID()}`,
          eventType: "OPERATION_PROGRESS",
          stage: "WORKTREE",
          correlationId: event.correlationId,
          ...(event.operationId === undefined
            ? {}
            : { operationId: event.operationId }),
          occurrenceAt: new Date().toISOString(),
          severity: "INFO",
          reason: {
            code: "PROGRESS",
            what: event.summary,
            why: "A deterministic F13 worktree operation recorded bounded evidence.",
            nextAction: "NONE",
          },
          summary: event.summary,
          details: { f13ReasonCode: event.reasonCode },
        });
      },
    },
  });
  await f13WorktreeService.reconcileStartup();
  const initializedF13WorktreeService = f13WorktreeService;
  if (initializedF13WorktreeService === undefined)
    throw new Error("PRMONITOR_F13_WORKTREE_SERVICE_NOT_READY");
  f14ValidationService = new ValidationRunService({
    repositories: new F14ValidationRepositories(persistenceStore),
    worktrees: initializedF13WorktreeService,
    activity: activityService?.writer,
  });
  await f14ValidationService.reconcileStartup();
  f11EligibilityService = new F11EligibilityService(
    new F11PersistenceRepositories(persistenceStore),
    { activity: activityService?.writer },
  );
  // Claims and holds are durable and must remain authoritative across renderer
  // recreation and ordinary process restart. F12/F18 consume this same service
  // when their scheduler and review workflows are introduced.
  f11EligibilityService.reconcileStartup();
  const f07Repositories = createF07PersistenceRepositories(persistenceStore);
  managedPrInboxService = createManagedPrInboxService({
    managedPrs: f07Repositories,
    persistence: persistenceRepositories,
  });
  githubServerService = new GithubServerService({
    repositories: persistenceRepositories,
    credentialStore: new ElectronSecureCredentialStore(
      path.join(userDataDirectory, "secure-credentials"),
      safeStorage,
    ),
    transport: new FetchGithubHttpTransport(),
  });
  githubServerService.reconcileStartup();
  managedPrService = new ManagedPrService({
    repositories: f07Repositories,
    profileForServerId: (serverId) =>
      githubServerService?.getVerifiedProfile(serverId),
    getPullRequest: (input) => {
      if (githubServerService === undefined)
        return Promise.reject(new Error("PRMONITOR_GITHUB_SERVICE_NOT_READY"));
      return githubServerService.getPullRequestMetadata(input);
    },
  });
  managedPrService.reconcileStartup();
  const f10Persistence = new F10PersistenceRepositories(persistenceStore, {
    f03Repositories,
    activity: activityService?.writer,
  });
  const { PrWatcher } = await import("./pr-watcher");
  const { ReviewScheduler } = await import("./review-scheduler");
  prWatcher = new PrWatcher({
    managedPrs: {
      listManagedPrs: () => f07Repositories.listManagedPrs(),
    },
    persistence: f10Persistence,
    githubClientForServer: (serverId) =>
      githubServerService?.getReadClient(serverId),
    profileForServerId: (serverId) =>
      githubServerService?.getVerifiedProfile(serverId),
    activity: activityService?.writer,
  });
  prWatcher.reconcileStartup();
  const f15ProviderRegistry = new AIProviderRegistry();
  connectionAuthentication = new ConnectionAuthentication(
    path.join(userDataDirectory, "ai-connections"),
  );
  f15ProviderRegistry.register(
    createCodexProvider({ connectionAuthentication }),
  );
  f15ProviderRegistry.register(
    createClaudeProvider({ authentication: connectionAuthentication }),
  );
  f15ProviderRegistry.register(
    createCopilotProvider({ authentication: connectionAuthentication }),
  );
  f16PreferencesService = new F16PreferencesService({
    repositories: createF16PreferencesRepository(f03Repositories),
    capabilities: {
      boundsRevision: "f15-options-v1",
      get: (providerId) =>
        f15ProviderRegistry.resolve(providerId)?.capabilities,
    },
    validation: {
      boundsRevision: F00_VALIDATION_BOUNDS_REVISION,
      resolve: ({ repository, operationId }) => ({
        summary: resolveF16ValidationSummary(repository, operationId),
        boundsRevision: F00_VALIDATION_BOUNDS_REVISION,
      }),
    },
    scheduler: {
      boundsRevision: "f12-scheduler-v1",
      validateConfiguration: ({ pollingIntervalMs, quietPeriodMs }) => {
        const current = reviewScheduler?.read().configuration;
        return resolveF12SchedulerConfiguration({
          intervalMs: pollingIntervalMs,
          quietPeriodMs,
          maxConcurrentPrs: current?.maxConcurrentPrs,
          readOnlyPollWhilePaused: current?.readOnlyPollWhilePaused,
        });
      },
      applyConfiguration: (configuration) => {
        if (reviewScheduler === undefined)
          throw new Error("PRMONITOR_SCHEDULER_SERVICE_NOT_READY");
        reviewScheduler.updateConfiguration({
          actor: "USER",
          requestId: `f16-operational-${randomUUID()}`,
          configuration,
        });
      },
    },
    worktreeRoot: {
      boundsRevision: "f13-root-v1",
      resolveRoot: (input) => initializedF13WorktreeService.resolveRoot(input),
    },
    ipcBoundsRevision: "f04-ipc-v1",
  });
  const initializedF16PreferencesService = f16PreferencesService;
  if (initializedF16PreferencesService === undefined)
    throw new Error("PRMONITOR_F16_PREFERENCES_SERVICE_NOT_READY");
  setupReadinessService = new SetupReadinessService({
    providers: f15ProviderRegistry,
    readPreferences: () => initializedF16PreferencesService.readPreferences(),
    readGitHubAccess: () => {
      if (githubServerService === undefined)
        throw new Error("PRMONITOR_GITHUB_SERVICE_NOT_READY");
      return setupGitHubAccess(githubServerService.readSettings());
    },
    readLocalPrerequisites: createSetupLocalPrerequisitesReader({
      resolveRoot: (input) => initializedF13WorktreeService.resolveRoot(input),
      readWorktreeRoot: () => {
        const root =
          initializedF16PreferencesService.readPreferences().operational
            .worktreeRoot;
        return {
          worktreeRoot: root?.canonicalPath ?? f13Root,
          rootRevision: root?.rootRevision ?? 0,
        };
      },
      persistenceHealthy: () =>
        persistenceStore !== undefined &&
        persistenceStore.health.status !== "recovery_required",
      protectedRoots: [
        path.join(userDataDirectory, "database"),
        path.join(userDataDirectory, "secure-credentials"),
      ],
      developerClonePaths: () =>
        managedPrService
          ?.list()
          .managedPrs.flatMap((pr) =>
            pr.localClone === undefined ? [] : [pr.localClone.canonicalRoot],
          ) ?? [],
    }),
  });
  const initializedF14ValidationService = f14ValidationService;
  if (initializedF14ValidationService === undefined)
    throw new Error("PRMONITOR_F14_VALIDATION_SERVICE_NOT_READY");
  const initializedF11EligibilityService = f11EligibilityService;
  if (initializedF11EligibilityService === undefined)
    throw new Error("PRMONITOR_F11_ELIGIBILITY_SERVICE_NOT_READY");
  const f17Persistence = new F17PersistenceRepositories(persistenceStore);
  const f25Persistence = new F25PersistenceRepositories(f03Repositories);
  f26AiWorkAdapter = new F26AIWorkAdapter({
    persistence: f17Persistence,
    provider: f15ProviderRegistry,
    f13: initializedF13WorktreeService,
    f14: initializedF14ValidationService,
    validation: {
      resolve: ({ repositoryId, operationId }) =>
        resolveValidationProfile({ repositoryId, operationId }),
    },
  });
  const initializedF26AiWorkAdapter = f26AiWorkAdapter;
  if (initializedF26AiWorkAdapter === undefined)
    throw new Error("PRMONITOR_F26_AI_ADAPTER_NOT_READY");
  f26ConflictResolutionService = new F26ConflictResolutionService({
    persistence: f25Persistence,
    managedPrs: {
      getManagedPr: (managedPrId) => f07Repositories.getManagedPr(managedPrId),
    },
    f16: initializedF16PreferencesService,
    f13: initializedF13WorktreeService,
    aiWork: initializedF26AiWorkAdapter,
    activity:
      activityService?.writer === undefined
        ? undefined
        : {
            append: (event) =>
              activityService?.writer.append({
                eventId: `f26-activity-${randomUUID()}`,
                eventType: "OPERATION_PROGRESS",
                stage: "WORKTREE",
                correlationId: event.correlationId,
                operationId: event.operationId,
                managedPrId: event.managedPrId,
                occurrenceAt: new Date().toISOString(),
                severity: "INFO",
                reason: {
                  code: "PROGRESS",
                  what: event.summary,
                  why: "F26 recorded bounded conflict-resolution evidence without publication authority.",
                  nextAction: "NONE",
                },
                summary: event.summary,
                details: {},
              }),
          },
  });
  const initializedF26ConflictResolutionService = f26ConflictResolutionService;
  if (initializedF26ConflictResolutionService === undefined)
    throw new Error("PRMONITOR_F26_SERVICE_NOT_READY");
  f25SynchronizationService = new F25SynchronizationService({
    persistence: f25Persistence,
    managedPrs: {
      getManagedPr: (managedPrId) => f07Repositories.getManagedPr(managedPrId),
    },
    f13: initializedF13WorktreeService,
    f14: initializedF14ValidationService,
    validation: {
      resolve: ({ repositoryId, operationId }) =>
        resolveValidationProfile({ repositoryId, operationId }),
    },
    conflictResolution: initializedF26ConflictResolutionService,
    worktreeRoot: {
      read: () => {
        const root =
          initializedF16PreferencesService.readPreferences().operational
            .worktreeRoot;
        return {
          ...(root?.canonicalPath === undefined
            ? {}
            : { canonicalPath: root.canonicalPath }),
          ...(root?.rootRevision === undefined
            ? {}
            : { rootRevision: root.rootRevision }),
        };
      },
    },
    activity:
      activityService?.writer === undefined
        ? undefined
        : {
            append: (event) =>
              activityService?.writer.append({
                eventId: `f25-activity-${randomUUID()}`,
                eventType: "OPERATION_PROGRESS",
                stage: "WORKTREE",
                correlationId: event.correlationId,
                ...(event.operationId === undefined
                  ? {}
                  : { operationId: event.operationId }),
                ...(event.managedPrId === undefined
                  ? {}
                  : { managedPrId: event.managedPrId }),
                occurrenceAt: new Date().toISOString(),
                severity: "INFO",
                reason: {
                  code: "PROGRESS",
                  what: event.summary,
                  why: "F25 recorded a bounded deterministic synchronization outcome.",
                  nextAction: "NONE",
                },
                summary: event.summary,
                details: { f25ReasonCode: event.reasonCode },
              }),
          },
  });
  await f25SynchronizationService.reconcileStartup();
  const f24Persistence = new F24PersistenceRepositories(persistenceStore);
  f24SynchronizationService = new F24SynchronizationService({
    inbox: {
      read: () => {
        if (managedPrInboxService === undefined)
          throw new Error("PRMONITOR_INBOX_SERVICE_NOT_READY");
        return managedPrInboxService.read();
      },
    },
    managedPrs: {
      getManagedPr: (managedPrId) => f07Repositories.getManagedPr(managedPrId),
    },
    github: {
      getReadClient: (serverId) => githubServerService?.getReadClient(serverId),
    },
    f16: {
      readReference: (): F24F16ConfigurationReference | undefined => {
        const preferences = initializedF16PreferencesService.readPreferences();
        const rootRevision = preferences.operational.worktreeRoot?.rootRevision;
        return {
          schemaVersion: 1,
          settingsRevision: preferences.settingsRevision,
          boundsRevision: preferences.boundsRevision,
          ...(rootRevision === undefined
            ? {}
            : { worktreeRootRevision: rootRevision }),
        };
      },
    },
    f13: {
      check: async (input): Promise<F24F13ReadinessResult> => {
        const preferences = initializedF16PreferencesService.readPreferences();
        const configuredRoot = preferences.operational.worktreeRoot;
        const result = await initializedF13WorktreeService.resolveRoot({
          ...(configuredRoot?.canonicalPath === undefined
            ? {}
            : { worktreeRoot: configuredRoot.canonicalPath }),
          ...(input.developerClonePath === undefined
            ? {}
            : { developerClonePaths: [input.developerClonePath] }),
          ...(input.rootRevision === undefined
            ? { rootRevision: configuredRoot?.rootRevision ?? 0 }
            : { rootRevision: input.rootRevision }),
          correlationId: input.correlationId,
        });
        const reason = result.reason;
        const mappedReason =
          reason === undefined
            ? undefined
            : f24Reason({
                code: "F13_NOT_READY",
                category: "F13_NOT_READY",
                what: reason.what,
                why: reason.why,
                nextAction:
                  reason.nextAction === "OPEN_SETTINGS"
                    ? "OPEN_PR_SETTINGS"
                    : reason.nextAction === "SELECT_WORKTREE_ACTION"
                      ? "SELECT_CLONE"
                      : reason.nextAction === "RECONCILE"
                        ? "RECONCILE"
                        : "RETRY_RESOLUTION",
                retryable: true,
                correlationId: input.correlationId,
              });
        return {
          ok: result.ok,
          rootRevision: result.rootRevision,
          evidenceRevision: f24Fingerprint({
            operationId: input.operationId,
            rootRevision: result.rootRevision,
            ok: result.ok,
            reason: reason?.code,
          }),
          ...(mappedReason === undefined ? {} : { reason: mappedReason }),
        };
      },
    },
    persistence: f24Persistence,
    handoff: {
      accept: (authorization) => {
        if (f25SynchronizationService === undefined)
          return Promise.resolve({
            status: "UNCERTAIN" as const,
            reason: f24Reason({
              code: "F25_NOT_READY",
              category: "HANDOFF",
              what: "The synchronization execution service is not ready.",
              why: "F24 will retain the authorization until the downstream durable owner can acknowledge it.",
              nextAction: "RECONCILE",
              retryable: true,
              correlationId: "f24-f25-not-ready",
            }),
          });
        return f25SynchronizationService
          .accept(authorization)
          .then((result) => ({
            status: result.status,
            ...(result.authorizationId === undefined
              ? {}
              : { authorizationId: result.authorizationId }),
            ...(result.reason === undefined
              ? {}
              : {
                  reason: f24Reason({
                    code: result.reason.code,
                    category: "HANDOFF",
                    what: result.reason.what,
                    why: result.reason.why,
                    nextAction:
                      result.reason.nextAction === "NONE"
                        ? "NONE"
                        : result.reason.nextAction === "RECONCILE"
                          ? "RECONCILE"
                          : "RETRY_RESOLUTION",
                    retryable: result.status !== "FAILED",
                    correlationId: result.reason.correlationId,
                  }),
                }),
          }));
      },
    },
  });
  const initializedF24SynchronizationService = f24SynchronizationService;
  if (initializedF24SynchronizationService === undefined)
    throw new Error("PRMONITOR_F24_SERVICE_NOT_READY");
  const f27Persistence = new F27PersistenceRepositories(f03Repositories);
  f27SynchronizationService = new F27SynchronizationService({
    f25: {
      readBatch: (batchId) => f25SynchronizationService?.readBatch(batchId),
      listBatches: () => f25SynchronizationService?.listBatches() ?? [],
      readResult: (operationId) =>
        f25SynchronizationService?.readResult(operationId),
    },
    persistence: f27Persistence,
    publication: f03Repositories,
    worktrees: initializedF13WorktreeService,
    freshness: {
      read: async (input) => {
        const checkedAt = new Date().toISOString();
        const managed = f07Repositories.getManagedPr(input.managedPrId);
        if (
          managed === undefined ||
          !managed.baseRepository.available ||
          !managed.headRepository.available ||
          managed.baseRepository.key !== input.sourceRepositoryKey ||
          managed.headRepository.key !== input.destinationRepositoryKey ||
          managed.prHeadBranch !== input.destinationBranch
        )
          return {
            outcome: "IDENTITY_MISMATCH" as const,
            checkedAt,
            ...(managed === undefined
              ? {}
              : {
                  sourceRepositoryKey: managed.baseRepository.key,
                  destinationRepositoryKey: managed.headRepository.key,
                  destinationBranch: managed.prHeadBranch,
                }),
          };
        const client = githubServerService?.getReadClient(managed.serverId);
        if (client === undefined)
          return { outcome: "UNAVAILABLE" as const, checkedAt };
        const sourceRepository = managed.baseRepository;
        const destinationRepository = managed.headRepository;
        const stateIdentity = {
          schemaVersion: 1 as const,
          server: sourceRepository.server,
          repository: sourceRepository,
          number: managed.number,
          key: managed.pullRequestKey,
        };
        const sourceRef = f24BranchRefIdentity(
          sourceRepository,
          input.sourceBranch,
        );
        const destinationRef = f24BranchRefIdentity(
          destinationRepository,
          input.destinationBranch,
        );
        let prState: Awaited<ReturnType<typeof client.getPullRequestState>>;
        let sourceRefResult: Awaited<ReturnType<typeof client.getBranchRef>>;
        let destinationRefResult: Awaited<
          ReturnType<typeof client.getBranchRef>
        >;
        try {
          [prState, sourceRefResult, destinationRefResult] = await Promise.all([
            client.getPullRequestState({
              serverId: managed.serverId,
              identity: stateIdentity,
              correlationId: `f27-${input.operationId}-pr`,
            }),
            client.getBranchRef({
              serverId: managed.serverId,
              ref: sourceRef,
              correlationId: `f27-${input.operationId}-source`,
            }),
            client.getBranchRef({
              serverId: managed.serverId,
              ref: destinationRef,
              correlationId: `f27-${input.operationId}-destination`,
            }),
          ]);
        } catch {
          return { outcome: "UNAVAILABLE" as const, checkedAt };
        }
        if (
          !prState.ok ||
          prState.outcome !== "UPDATED" ||
          !sourceRefResult.ok ||
          sourceRefResult.outcome !== "UPDATED" ||
          !destinationRefResult.ok ||
          destinationRefResult.outcome !== "UPDATED"
        )
          return { outcome: "UNAVAILABLE" as const, checkedAt };
        const observedSourceSha = sourceRefResult.value.sha;
        const observedHeadSha = destinationRefResult.value.sha;
        const identityMismatch =
          prState.value.identity.key !== managed.pullRequestKey ||
          sourceRefResult.value.identity.key !== sourceRef.key ||
          destinationRefResult.value.identity.key !== destinationRef.key;
        const moved =
          observedSourceSha !== input.expectedSourceSha ||
          observedHeadSha !== input.expectedHeadSha;
        return {
          outcome: identityMismatch
            ? ("IDENTITY_MISMATCH" as const)
            : prState.value.merged
              ? ("MERGED" as const)
              : prState.value.state !== "OPEN"
                ? ("CLOSED" as const)
                : moved
                  ? ("MOVED" as const)
                  : ("CURRENT" as const),
          checkedAt,
          sourceSha: observedSourceSha,
          headSha: observedHeadSha,
          state: prState.value.state,
          merged: prState.value.merged,
          sourceRepositoryKey: sourceRepository.key,
          destinationRepositoryKey: destinationRepository.key,
          sourceBranch: input.sourceBranch,
          destinationBranch: input.destinationBranch,
        };
      },
    },
    reevaluation: {
      start: async (input) => {
        const authorization =
          await initializedF24SynchronizationService.resolveForReevaluation(
            input.managedPrId,
          );
        const accepted = await f25SynchronizationService!.accept(authorization);
        const batch = f25SynchronizationService!
          .listBatches()
          .find(
            (candidate) =>
              candidate.idempotencyKey === authorization.idempotencyKey,
          );
        return {
          status: accepted.status,
          ...(batch === undefined ? {} : { batchId: batch.batchId }),
          ...(accepted.reason === undefined
            ? {}
            : {
                reason: {
                  code: accepted.reason.code,
                  what: accepted.reason.what,
                  why: accepted.reason.why,
                  nextAction:
                    accepted.reason.nextAction === "RECONCILE"
                      ? ("RECONCILE" as const)
                      : ("RETRY" as const),
                  correlationId: accepted.reason.correlationId,
                },
              }),
        };
      },
    },
    git: new F27DeterministicGitPublisher(),
    invalidation: {
      invalidatePublishedResult: async (invalidation) => {
        if (f22Coordinator === undefined) return;
        await f22Coordinator.observeManagedPr(invalidation.managedPrId);
      },
    },
  });
  automaticReviewAiAdapter = new F18AIWorkAdapter({
    persistence: f17Persistence,
    provider: f15ProviderRegistry,
    f13: initializedF13WorktreeService,
    f14: initializedF14ValidationService,
    validation: {
      resolve: ({ repositoryId, operationId }) =>
        resolveValidationProfile({ repositoryId, operationId }),
    },
  });
  const initializedAutomaticReviewAiAdapter = automaticReviewAiAdapter;
  if (initializedAutomaticReviewAiAdapter === undefined)
    throw new Error("PRMONITOR_F18_AI_ADAPTER_NOT_READY");
  automaticReviewCoordinator = new AutomaticReviewCoordinator({
    persistence: new F18PersistenceRepositories(f03Repositories),
    managedPrs: {
      getManagedPr: (managedPrId) => f07Repositories.getManagedPr(managedPrId),
    },
    events: {
      getEventVersion: (managedPrId, eventVersionId) =>
        initializedF11EligibilityService.persistence.getRemoteEventVersion(
          managedPrId,
          eventVersionId,
        ),
    },
    claims: {
      getClaim: (claimId) =>
        initializedF11EligibilityService.persistence.getClaim(claimId),
      getActiveClaim: (managedPrId) =>
        initializedF11EligibilityService.persistence.getActiveClaim(
          managedPrId,
        ),
      getActiveHold: (managedPrId) =>
        initializedF11EligibilityService.persistence.getActiveHold(managedPrId),
    },
    scheduler: {
      read: () => {
        if (reviewScheduler === undefined)
          throw new Error("PRMONITOR_SCHEDULER_SERVICE_NOT_READY");
        return reviewScheduler.read();
      },
    },
    f13: initializedF13WorktreeService,
    f14: initializedF14ValidationService,
    f16: initializedF16PreferencesService,
    aiWork: initializedAutomaticReviewAiAdapter,
    validation: {
      resolve: ({ repositoryId, operationId }) =>
        resolveValidationProfile({ repositoryId, operationId }),
    },
    activity:
      activityService?.writer === undefined
        ? undefined
        : {
            append: (event) =>
              activityService?.writer.append({
                eventId: event.eventId,
                eventType: "OPERATION_PROGRESS",
                stage: "REVIEW",
                correlationId: event.correlationId,
                operationId: event.operationId,
                managedPrId: event.managedPrId,
                occurrenceAt: new Date().toISOString(),
                severity:
                  event.severity === "WARN" ? "WARNING" : event.severity,
                reason: {
                  code: "PROGRESS",
                  what: event.summary,
                  why: "F18 recorded a bounded automatic-review workflow outcome.",
                  nextAction: "NONE",
                },
                summary: event.summary,
                details: {},
              }),
          },
  });
  const initializedAutomaticReviewCoordinator = automaticReviewCoordinator;
  if (initializedAutomaticReviewCoordinator === undefined)
    throw new Error("PRMONITOR_F18_COORDINATOR_NOT_READY");
  f22Coordinator = new F22Coordinator({
    persistence: new F22PersistenceRepositories(persistenceStore),
    bundles: initializedAutomaticReviewCoordinator,
    remote: {
      readCurrentHead: async (managedPrId) => {
        const managed = f07Repositories.getManagedPr(managedPrId);
        const fallbackIdentity = {
          serverId: managed?.serverId ?? "unknown-server",
          repositoryKey: managed?.baseRepository.key ?? "unknown-repository",
          ...(managed?.pullRequestKey === undefined
            ? {}
            : { pullRequestKey: managed.pullRequestKey }),
        };
        const unavailable = (what: string, why: string) => ({
          outcome: "UNAVAILABLE" as const,
          identity: fallbackIdentity,
          observationRevision:
            f10Persistence.getCurrentMetadata(managedPrId)?.version ?? 0,
          observedAt:
            f10Persistence.getCurrentMetadata(managedPrId)?.observedAt ??
            new Date(0).toISOString(),
          reason: {
            code: "REMOTE_HEAD_CHECK_UNAVAILABLE",
            what,
            why,
            nextAction: "RETRY",
            details: {},
          },
        });
        if (prWatcher === undefined)
          return unavailable(
            "The F10 remote-head reader is not ready.",
            "F22 cannot authorize an action without the authoritative polling boundary.",
          );
        let poll: F10PollRunResult;
        try {
          poll = await prWatcher.runForManagedPrs([managedPrId]);
        } catch {
          return unavailable(
            "The current pull-request head could not be verified.",
            "F10 did not complete an action-time remote observation.",
          );
        }
        const pullRequest = poll.resources.find(
          (resource) => resource.resource === "pull_request",
        );
        if (
          pullRequest === undefined ||
          (pullRequest.status !== "COMPLETED" &&
            pullRequest.status !== "NOT_MODIFIED")
        )
          return unavailable(
            "The current pull-request head could not be verified.",
            "F10 returned no completed action-time pull-request observation.",
          );
        const current = f10Persistence.getCurrentMetadata(managedPrId);
        if (current === undefined)
          return unavailable(
            "No current F10 pull-request metadata is available.",
            "F22 cannot classify a Review Bundle from an absent remote observation.",
          );
        return {
          outcome: "CURRENT" as const,
          identity: {
            serverId: current.metadata.identity.server.serverKey,
            repositoryKey: current.metadata.identity.repository.key,
            pullRequestKey: current.metadata.identity.key,
          },
          baseSha: current.metadata.baseSha,
          headSha: current.metadata.headSha,
          baseRepository: {
            serverId: current.metadata.baseRepository.server.serverKey,
            owner: current.metadata.baseRepository.owner,
            name: current.metadata.baseRepository.name,
            key: current.metadata.baseRepository.key,
          },
          ...(current.metadata.headRepository.available
            ? {
                headRepository: {
                  serverId: current.metadata.headRepository.server.serverKey,
                  owner: current.metadata.headRepository.owner,
                  name: current.metadata.headRepository.name,
                  key: current.metadata.headRepository.key,
                },
              }
            : {}),
          baseBranch: current.metadata.baseBranch,
          headBranch: current.metadata.headBranch,
          observationRevision: current.version,
          observedAt: poll.completedAt,
          attemptId: pullRequest.attemptId,
        };
      },
    },
    f13: initializedF13WorktreeService,
    f11: {
      getClaim: (claimId) =>
        initializedF11EligibilityService.persistence.getClaim(claimId),
      getHold: (holdId) =>
        initializedF11EligibilityService.persistence.getHold(holdId),
      getActiveClaim: (managedPrId) =>
        initializedF11EligibilityService.persistence.getActiveClaim(
          managedPrId,
        ),
      getActiveHold: (managedPrId) =>
        initializedF11EligibilityService.persistence.getActiveHold(managedPrId),
      listRetainedVersionIds: (managedPrId) =>
        initializedF11EligibilityService.listRetainedVersionIds(managedPrId),
      completeDiscard: (input) =>
        initializedF11EligibilityService.completeDiscard(input),
      transferForReevaluation: (input) =>
        initializedF11EligibilityService.transferForReevaluation(input),
      rollbackForReevaluation: (input) =>
        initializedF11EligibilityService.rollbackForReevaluation(input),
    },
    managedPr: {
      readIdentity: (managedPrId) => {
        const managed = f07Repositories.getManagedPr(managedPrId);
        return managed === undefined
          ? undefined
          : {
              serverId: managed.serverId,
              repositoryKey: managed.baseRepository.key,
              pullRequestKey: managed.pullRequestKey,
            };
      },
    },
    primaryReview: {
      read: (managedPrId) =>
        f07Repositories.getManagedPr(managedPrId)?.primaryState,
    },
    synchronization: {
      read: (managedPrId) => {
        const safeIdentifier = /^[A-Za-z0-9][A-Za-z0-9_.:/#-]*$/u;
        const result = f03Repositories
          .listSynchronizationResults()
          .filter((candidate) => candidate.managedPrId === managedPrId)
          .sort(
            (left, right) =>
              right.updatedAt.localeCompare(left.updatedAt) ||
              right.version - left.version ||
              right.id.localeCompare(left.id),
          )[0];
        if (result === undefined) return undefined;
        const status = safeIdentifier.test(result.status)
          ? result.status
          : "UNKNOWN";
        const reasonValue = result.reason;
        const reasonCode =
          typeof reasonValue === "object" &&
          reasonValue !== null &&
          !Array.isArray(reasonValue) &&
          "code" in reasonValue &&
          typeof reasonValue.code === "string" &&
          safeIdentifier.test(reasonValue.code)
            ? reasonValue.code
            : undefined;
        return {
          status,
          ...(reasonCode === undefined ? {} : { reasonCode }),
        };
      },
    },
    activeOperation: {
      read: (bundleId) => {
        if (f21ConversationService === undefined)
          return {
            operationId: "f21-conversation-unavailable",
            status: "UNCERTAIN",
          };
        try {
          const active = f21ConversationService.read(bundleId).activeOperation;
          return active === undefined
            ? undefined
            : {
                operationId: active.operationId,
                status: active.status,
              };
        } catch {
          return {
            operationId: "f21-conversation-read-failed",
            status: "UNCERTAIN",
          };
        }
      },
    },
    tasks: {
      readCurrentSummary: ({ managedPrId, repository }) => {
        const preferences = initializedF16PreferencesService.readPreferences();
        const profile = preferences.taskProfiles.find(
          (candidate) => candidate.taskType === "AUTOMATIC_REVIEW_REEVALUATION",
        );
        if (profile === undefined) throw new Error("F16_PROFILE_UNAVAILABLE");
        const repositorySettings = preferences.repositories.find(
          (candidate) => candidate.repository.key === repository.key,
        );
        const managed = f07Repositories.getManagedPr(managedPrId);
        const context = managed?.configuration.context;
        return {
          taskType: profile.taskType,
          profileId: profile.profileId,
          profileRevision: profile.revision,
          providerId: profile.providerId,
          modelId: profile.modelId,
          policyId: preferences.policy.policyId,
          policyRevision: preferences.policy.revision,
          effectivePreset: preferences.policy.preset,
          commonInstructionIds: preferences.selectedCommonInstructionIds,
          ...(repositorySettings?.validationSummary === undefined
            ? {}
            : {
                buildValidationStatus:
                  repositorySettings.validationSummary.status,
              }),
          ...(context === undefined || context === null || context.length === 0
            ? {}
            : {
                prIntentContextHash: createHash("sha256")
                  .update(context, "utf8")
                  .digest("hex"),
              }),
        };
      },
      resolveCurrent: async ({ managedPrId, operationId, repository }) => {
        const managed = f07Repositories.getManagedPr(managedPrId);
        const currentContext = managed?.configuration.context;
        const task = await initializedF16PreferencesService.resolveTask({
          taskType: "AUTOMATIC_REVIEW_REEVALUATION",
          phase: "REVIEW_PROPOSAL",
          repository: {
            serverId: repository.serverId,
            owner: repository.owner,
            name: repository.name,
            key: repository.key,
          },
          operationId,
          ...(typeof currentContext !== "string" || currentContext.length === 0
            ? {}
            : { prIntentContext: currentContext }),
        });
        return task;
      },
    },
    schedulerRevision: () => reviewScheduler?.read().schedulerRevision ?? 0,
  });
  await f22Coordinator.reconcileStartup();
  const initializedF22Coordinator = f22Coordinator;
  if (initializedF22Coordinator === undefined)
    throw new Error("PRMONITOR_F22_COORDINATOR_NOT_READY");
  f21AiWorkAdapter = new F21AIWorkAdapter({
    persistence: f17Persistence,
    provider: f15ProviderRegistry,
    f13: initializedF13WorktreeService,
    f14: initializedF14ValidationService,
    validation: {
      resolve: ({ repositoryId, operationId }) =>
        resolveValidationProfile({ repositoryId, operationId }),
    },
  });
  const initializedF21AiWorkAdapter = f21AiWorkAdapter;
  if (initializedF21AiWorkAdapter === undefined)
    throw new Error("PRMONITOR_F21_AI_ADAPTER_NOT_READY");
  if (initializedAutomaticReviewCoordinator.getReadModel === undefined)
    throw new Error("PRMONITOR_F21_F18_READ_MODEL_NOT_READY");
  if (
    initializedAutomaticReviewCoordinator.saveProposalInput === undefined ||
    initializedAutomaticReviewCoordinator.beginReviewRevision === undefined ||
    initializedAutomaticReviewCoordinator.finalizeReviewRevision === undefined
  )
    throw new Error("PRMONITOR_F21_F18_REVISION_BOUNDARY_NOT_READY");
  f21ConversationService = new F21ConversationService({
    persistence: new F21PersistenceRepositories(persistenceStore),
    bundles: {
      startAutomaticReview:
        initializedAutomaticReviewCoordinator.startAutomaticReview.bind(
          initializedAutomaticReviewCoordinator,
        ),
      recordDecision: initializedAutomaticReviewCoordinator.recordDecision.bind(
        initializedAutomaticReviewCoordinator,
      ),
      confirmReviewDecisions:
        initializedAutomaticReviewCoordinator.confirmReviewDecisions.bind(
          initializedAutomaticReviewCoordinator,
        ),
      saveDraftResponse:
        initializedAutomaticReviewCoordinator.saveDraftResponse.bind(
          initializedAutomaticReviewCoordinator,
        ),
      getReadModel: initializedAutomaticReviewCoordinator.getReadModel.bind(
        initializedAutomaticReviewCoordinator,
      ),
      saveProposalInput:
        initializedAutomaticReviewCoordinator.saveProposalInput.bind(
          initializedAutomaticReviewCoordinator,
        ),
      beginReviewRevision:
        initializedAutomaticReviewCoordinator.beginReviewRevision.bind(
          initializedAutomaticReviewCoordinator,
        ),
      finalizeReviewRevision:
        initializedAutomaticReviewCoordinator.finalizeReviewRevision.bind(
          initializedAutomaticReviewCoordinator,
        ),
    },
    f13: initializedF13WorktreeService,
    f16: initializedF16PreferencesService,
    aiWork: initializedF21AiWorkAdapter,
    f22: initializedF22Coordinator,
  });
  if (f21ConversationService === undefined)
    throw new Error("PRMONITOR_F21_CONVERSATION_SERVICE_NOT_READY");
  await f21ConversationService.reconcileStartup();
  f23PublicationService = new F23PublicationService({
    persistence: f03Repositories,
    bundles: initializedAutomaticReviewCoordinator,
    worktrees: initializedF13WorktreeService,
    f22: initializedF22Coordinator,
    managedPrs: {
      get: (managedPrId) => {
        const managed = f07Repositories.getManagedPr(managedPrId);
        return managed === undefined
          ? undefined
          : {
              managedPrId: managed.id,
              serverId: managed.serverId,
              owner: managed.owner,
              repositoryName: managed.repositoryName,
              number: managed.number,
            };
      },
    },
    git: new F23DeterministicGitPublisher(),
    responses:
      githubServerService === undefined
        ? undefined
        : createF23GithubResponsePublisher(githubServerService),
    hold: {
      completeAutomaticReview: (input) =>
        initializedF11EligibilityService.completeAutomaticReview(input),
    },
    validation: {
      readModel: (runId) => initializedF14ValidationService.readModel(runId),
    },
  });
  await f23PublicationService.reconcileStartup();
  await f27SynchronizationService?.reconcileStartup();
  reviewScheduler = new ReviewScheduler({
    managedPrs: {
      listManagedPrs: () => f07Repositories.listManagedPrs(),
    },
    persistence: new F12PersistenceRepositories(persistenceStore),
    poller: {
      poll: async ({ managedPrIds, signal }) => {
        if (prWatcher === undefined)
          throw new Error("PRMONITOR_PR_WATCHER_NOT_READY");
        const result = await prWatcher.runForManagedPrs(managedPrIds, signal);
        const observedIds =
          managedPrIds ??
          f07Repositories.listManagedPrs().map((managedPr) => managedPr.id);
        for (const managedPrId of observedIds) {
          try {
            const gates =
              await initializedF22Coordinator.observeManagedPr(managedPrId);
            for (const gate of gates) {
              if (
                gate.status !== "STALE" &&
                gate.status !== "INVALIDATED" &&
                gate.status !== "ATTENTION"
              )
                continue;
              const readModel =
                initializedAutomaticReviewCoordinator.getReadModel?.(
                  gate.bundleId,
                );
              if (readModel !== undefined)
                void f19Coordinator
                  ?.handleF22Gate(readModel, gate)
                  .catch(() => undefined);
            }
          } catch {
            // A missing or malformed Review Bundle is surfaced by its own
            // durable state; polling remains authoritative for F10/F11.
          }
        }
        return result;
      },
    },
    eligibility: f11EligibilityService,
    reviewWork: {
      startAutomaticReview: async (input) => {
        const result =
          await initializedAutomaticReviewCoordinator.startAutomaticReview(
            input,
          );
        if (
          result.outcome === "ACCEPTED" ||
          result.outcome === "ALREADY_ACCEPTED"
        ) {
          const readModel =
            initializedAutomaticReviewCoordinator.getReadModel?.(
              input.bundleId,
            );
          if (readModel !== undefined)
            void f19Coordinator
              ?.handleReviewBundleOutcome(readModel)
              .catch(() => undefined);
        }
        return {
          outcome: result.outcome,
          ...(result.reason === undefined
            ? {}
            : {
                reason: {
                  code: result.reason.code,
                  what: result.reason.what,
                  why: result.reason.why,
                  nextAction: [
                    "NONE",
                    "WAIT",
                    "RETRY",
                    "RECONCILE",
                    "REVIEW",
                    "FIX_INPUT",
                  ].includes(result.reason.nextAction)
                    ? (result.reason.nextAction as
                        | "NONE"
                        | "WAIT"
                        | "RETRY"
                        | "RECONCILE"
                        | "REVIEW"
                        | "FIX_INPUT")
                    : "RECONCILE",
                  details: {},
                },
              }),
        };
      },
    },
    activity: activityService?.writer,
  });
}

function refreshSetupReadiness(): void {
  const service = setupReadinessService;
  if (service === undefined) return;
  service.invalidate();
  void service
    .read()
    .then((projection) => {
      ipcRouter?.publishSetupReadiness(projection);
    })
    .catch(() => undefined);
}

function setupChange<T>(change: () => T): T {
  try {
    const result = change();
    if (result instanceof Promise) {
      return result.finally(refreshSetupReadiness) as T;
    }
    refreshSetupReadiness();
    return result;
  } catch (error) {
    refreshSetupReadiness();
    throw error;
  }
}

function createCurrentState(): CurrentState {
  if (lifecycle === undefined || persistenceStore === undefined) {
    throw new Error("PRMONITOR_MAIN_NOT_READY");
  }
  return {
    schemaVersion: 1,
    applicationTitle: "PRMonitor",
    lifecycle: lifecycle.getStatus(),
    persistence: {
      status: persistenceStore.health.status,
      schemaVersion: persistenceStore.health.schemaVersion,
    },
  };
}

function f28LifecycleSnapshot(): F28LifecycleSnapshot {
  const status = lifecycle?.getStatus();
  return {
    schemaVersion: F28_SCHEMA_VERSION,
    applicationSessionId: status?.sessionId ?? "lifecycle-missing",
    lifecyclePhase: status?.phase ?? "RECOVERY_REQUIRED",
    rendererAttached: windowManager?.visibleWindowId !== undefined,
    explicitShutdown:
      status?.phase === "SHUTDOWN_REQUESTED" ||
      status?.phase === "HANDING_OFF" ||
      status?.phase === "STOPPED",
    online: readOnlineState(),
    wallClockAt: new Date().toISOString(),
    monotonicNowMs: performance.now(),
  };
}

function f28OwnerOutcome(
  sessionId: string,
  scope: F28RecoveryScopeInput,
  input: {
    readonly classification: F28OwnerOutcome["classification"];
    readonly code: string;
    readonly what: string;
    readonly why: string;
    readonly nextAction: F28OwnerOutcome["reason"]["nextAction"];
    readonly retryable: boolean;
  },
): F28OwnerOutcome {
  const correlationId = `f28-${sessionId}-${scope.kind}`;
  const reason = {
    schemaVersion: F28_SCHEMA_VERSION,
    code: input.code,
    what: input.what,
    why: input.why,
    nextAction: input.nextAction,
    retryable: input.retryable,
    correlationId,
    evidenceRefs: [],
  };
  return {
    schemaVersion: F28_SCHEMA_VERSION,
    classification: input.classification,
    reason,
    evidenceRefs: [],
  };
}

function f28ManagedPrScopes(
  owner: string,
  stage: F28RecoveryScopeInput["stage"],
  kind: F28RecoveryScopeInput["kind"],
  fallbackId: string,
): readonly F28RecoveryScopeInput[] {
  const managed = managedPrService?.list().managedPrs ?? [];
  if (managed.length === 0)
    return [
      {
        schemaVersion: F28_SCHEMA_VERSION,
        kind,
        id: fallbackId,
        owner,
        stage,
      },
    ];
  return managed.map((pr) => ({
    schemaVersion: F28_SCHEMA_VERSION,
    kind,
    id: pr.id,
    owner,
    stage,
  }));
}

function createApplicationWindowManager(): void {
  const platform =
    process.platform === "win32"
      ? new WindowsWindowPlatformAdapter()
      : new ElectronWindowPlatformAdapter();
  windowManager = new WindowManager({
    rendererEntry,
    preloadEntry,
    platform,
    rendererReadyTimeoutMs: smokeMode ? 12_000 : 10_000,
    createWindow: ({ preload, show }) => {
      const created = new BrowserWindow({
        width: 720,
        height: 480,
        show,
        title: APPLICATION_TITLE,
        ...(applicationIconPath() === undefined
          ? {}
          : { icon: applicationIconPath() }),
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
          allowRunningInsecureContent: false,
          webviewTag: false,
          navigateOnDragDrop: false,
          sandbox: true,
          preload,
        },
      });
      configureF29BrowserWindowSecurity(created);
      return created as unknown as ManagedWindowLike;
    },
    sendTarget: (contents, target) =>
      ipcRouter?.deliverOpenTarget(contents.id, target) ?? false,
    onRendererAttached: (contents) => ipcRouter?.attachRenderer(contents),
    onRendererDetached: (contentsId) => {
      ipcRouter?.detachRenderer(contentsId);
      requestF28RendererReplacement();
    },
  });
}

async function openStartupRecoveryShell(error: unknown): Promise<void> {
  // No lifecycle service has started. Keep the failed database and all
  // committed configuration intact, and expose no domain action handlers.
  persistenceStore?.close();
  persistenceStore = undefined;
  const startedAt = new Date().toISOString();
  const status = {
    schemaVersion: 1 as const,
    phase: "RECOVERY_REQUIRED" as const,
    sessionId: `startup-recovery-${randomUUID()}`,
    correlationId: "startup-recovery",
    startedAt,
    updatedAt: startedAt,
    reasonCode: "LOCAL_INITIALIZATION_FAILED",
    incompleteHandoff: true,
  };
  let revision = 0;
  let retryRequested = false;
  ipcRouter = new IpcRouter(ipcMain, {
    security: f29SecurityService,
    readCurrentState: () => ({
      schemaVersion: 1,
      applicationTitle: "PRMonitor",
      lifecycle: status,
      persistence: { status: "recovery_required", schemaVersion: 0 },
    }),
    getLifecycleStatus: () => status,
    readSetupReadiness: async () => startupRecoveryReadiness(error, ++revision),
    retrySetupReadiness: async () => {
      if (!retryRequested) {
        retryRequested = true;
        setImmediate(() => {
          app.relaunch({
            args: startupRecoveryRelaunchArguments(
              process.argv.slice(1),
              lastAcceptedOpenTarget,
            ),
          });
          app.exit(0);
        });
      }
      return startupRecoveryReadiness(error, ++revision);
    },
    requestShutdown: async () => {
      setImmediate(() => app.quit());
      return { ok: true, status };
    },
    onRendererReady: (senderId) => windowManager?.markRendererReady(senderId),
  });
  ipcRouter.install();
  createApplicationWindowManager();
  const target = pendingTargets.dequeue();
  const openWork = windowManager?.open(target);
  for (
    let queued = pendingTargets.dequeue();
    queued !== undefined;
    queued = pendingTargets.dequeue()
  ) {
    void windowManager?.open(queued);
  }
  await openWork;
}

async function startMainProcess(): Promise<void> {
  try {
    await initializeMainProcessPersistence();
  } catch (error) {
    if (smokeMode) throw error;
    await openStartupRecoveryShell(error);
    return;
  }
  if (persistenceRepositories === undefined)
    throw new Error("PRMONITOR_REPOSITORIES_MISSING");
  lifecycle = new LifecycleCoordinator({
    persistence: createPersistenceLifecyclePersistence(
      persistenceRepositories,
      activityService?.writer,
    ),
    services: [
      {
        name: "review-scheduler",
        start: () => reviewScheduler?.start(),
        stopAdmission: () => reviewScheduler?.stop(),
        boundedStop: () => reviewScheduler?.stop(),
      },
      {
        name: "validation-runner",
        stopAdmission: () => f14ValidationService?.shutdown(),
        boundedStop: () => f14ValidationService?.shutdown(),
      },
      {
        name: "merge-conflict-ai-work",
        stopAdmission: () => f26AiWorkAdapter?.stopAdmission(),
        handoff: () => f26AiWorkAdapter?.handoff(),
        boundedStop: () => f26AiWorkAdapter?.boundedStop(),
      },
      {
        name: "synchronization-execution",
        stopAdmission: () => f25SynchronizationService?.shutdown(),
        boundedStop: () => f25SynchronizationService?.shutdown(),
      },
      {
        name: "automatic-review-ai-work",
        stopAdmission: () => automaticReviewAiAdapter?.stopAdmission(),
        handoff: () => automaticReviewAiAdapter?.handoff(),
        boundedStop: () => automaticReviewAiAdapter?.boundedStop(),
      },
      {
        name: "review-conversation-ai-work",
        stopAdmission: () => f21AiWorkAdapter?.stopAdmission(),
        handoff: () => f21AiWorkAdapter?.handoff(),
        boundedStop: () => f21AiWorkAdapter?.boundedStop(),
      },
    ],
  });
  const refreshManagedPrInbox = (): void => {
    try {
      managedPrInboxService?.refresh();
    } catch {
      // A malformed optional inbox projection must not change the outcome of
      // the authoritative managed-PR operation that triggered this refresh.
    }
  };

  if (
    automaticReviewCoordinator === undefined ||
    f13WorktreeService === undefined ||
    f14ValidationService === undefined
  )
    throw new Error("PRMONITOR_F20_DEPENDENCY_NOT_READY");
  f20WorkspaceService = new F20WorkspaceService({
    bundles: automaticReviewCoordinator,
    worktrees: f13WorktreeService,
    validation: f14ValidationService,
    f22: f22Coordinator,
    f19: {
      handleF22Gate: (readModel, gate) =>
        f19Coordinator?.handleF22Gate(readModel, gate) ??
        Promise.resolve({ outcome: "SUPPRESSED" }),
    },
  });

  const f28Owners: readonly F28RecoveryOwner[] = [
    {
      owner: "f28-scheduler",
      stage: "SCHEDULER",
      requiresNetwork: true,
      listScopes: () =>
        f28ManagedPrScopes(
          "f28-scheduler",
          "SCHEDULER",
          "managed_pr",
          "scheduler",
        ),
      reconcileSession: () => {
        prWatcher?.reconcileStartup();
        reviewScheduler?.read();
      },
      recover: ({ sessionId, scope }) => {
        return f28OwnerOutcome(sessionId, scope, {
          classification: "COMPLETED",
          code: "SCHEDULER_RECOVERY_RECONCILED",
          what: "Durable polling and scheduler state were re-read after the lifecycle event.",
          why: "The scheduler owns polling admission and can safely recover only its recorded state.",
          nextAction: "NONE",
          retryable: false,
        });
      },
    },
    {
      owner: "f28-holds",
      stage: "HOLDS",
      listScopes: () =>
        f28ManagedPrScopes("f28-holds", "HOLDS", "managed_pr", "holds"),
      reconcileSession: () => {
        f11EligibilityService?.reconcileStartup();
      },
      recover: ({ sessionId, scope }) => {
        return f28OwnerOutcome(sessionId, scope, {
          classification: "COMPLETED",
          code: "HOLDS_RECOVERY_RECONCILED",
          what: "Durable claims, holds, and feedback state were re-read.",
          why: "Existing hold state remains authoritative across restart and renderer replacement.",
          nextAction: "NONE",
          retryable: false,
        });
      },
    },
    {
      owner: "f28-local-work",
      stage: "LOCAL_WORK",
      listScopes: () =>
        f28ManagedPrScopes(
          "f28-local-work",
          "LOCAL_WORK",
          "managed_pr",
          "local-work",
        ),
      reconcileSession: async () => {
        await f13WorktreeService?.reconcileStartup();
        await f14ValidationService?.reconcileStartup();
      },
      recover: ({ sessionId, scope }) => {
        return f28OwnerOutcome(sessionId, scope, {
          classification: "COMPLETED",
          code: "LOCAL_WORK_RECOVERY_RECONCILED",
          what: "Worktree intents and interrupted validation runs were reconciled from durable evidence.",
          why: "Recovery preserves owned paths and never reruns validation or replaces a worktree automatically.",
          nextAction: "NONE",
          retryable: false,
        });
      },
    },
    {
      owner: "f28-ai",
      stage: "AI",
      listScopes: () =>
        f28ManagedPrScopes("f28-ai", "AI", "ai_operation", "ai-work"),
      reconcileSession: async () => {
        await f21ConversationService?.reconcileStartup();
        await f26AiWorkAdapter?.reconcileStartup();
      },
      recover: ({ sessionId, scope }) => {
        return f28OwnerOutcome(sessionId, scope, {
          classification: "COMPLETED",
          code: "AI_RECOVERY_RECONCILED",
          what: "In-flight AI work was reconciled to durable interrupted or uncertain state.",
          why: "Recovery does not invoke a provider or consume budget without a new explicit user turn.",
          nextAction: "NONE",
          retryable: false,
        });
      },
    },
    {
      owner: "f28-review-publication",
      stage: "REVIEW_PUBLICATION",
      requiresNetwork: true,
      listScopes: () =>
        f28ManagedPrScopes(
          "f28-review-publication",
          "REVIEW_PUBLICATION",
          "publication",
          "review-publication",
        ),
      reconcileSession: async () => {
        await f23PublicationService?.reconcileStartup();
      },
      recover: ({ sessionId, scope }) => {
        return f28OwnerOutcome(sessionId, scope, {
          classification: "COMPLETED",
          code: "REVIEW_PUBLICATION_RECOVERY_RECONCILED",
          what: "Review Bundle publication intents were reconciled by their durable evidence.",
          why: "Publication remains separate from AI recovery and never publishes without an existing authorized intent.",
          nextAction: "NONE",
          retryable: false,
        });
      },
    },
    {
      owner: "f28-sync-publication",
      stage: "SYNC_PUBLICATION",
      requiresNetwork: true,
      listScopes: () =>
        f28ManagedPrScopes(
          "f28-sync-publication",
          "SYNC_PUBLICATION",
          "publication",
          "sync-publication",
        ),
      reconcileSession: async () => {
        await f27SynchronizationService?.reconcileStartup();
      },
      recover: ({ sessionId, scope }) => {
        return f28OwnerOutcome(sessionId, scope, {
          classification: "COMPLETED",
          code: "SYNC_PUBLICATION_RECOVERY_RECONCILED",
          what: "Synchronization publication intents were reconciled by their durable evidence.",
          why: "Synchronization publication is independent from Review Bundle publication and never force-pushes during recovery.",
          nextAction: "NONE",
          retryable: false,
        });
      },
    },
  ];
  if (persistenceStore === undefined)
    throw new Error("PRMONITOR_PERSISTENCE_STORE_MISSING");
  f28RecoveryCoordinator = new F28RecoveryCoordinator({
    persistence: new F28RecoveryRepositories(persistenceStore),
    lifecycle: f28LifecycleSnapshot,
    owners: f28Owners,
    activity:
      activityService?.writer === undefined
        ? undefined
        : {
            append: (event) => {
              const reasonCode =
                event.event === "RETRY_SCHEDULED"
                  ? "RETRYING"
                  : event.event === "UNCERTAIN" || event.event === "BLOCKED"
                    ? "UNKNOWN_OUTCOME"
                    : event.event === "SESSION_STARTED"
                      ? "STARTED"
                      : event.event === "SESSION_COMPLETED"
                        ? "COMPLETED"
                        : "RECONCILED";
              const nextAction =
                event.event === "RETRY_SCHEDULED" ? "WAIT" : "NONE";
              activityService?.writer.append({
                eventId: `f28-activity-${randomUUID()}`,
                eventType: "OPERATION_PROGRESS",
                stage: "LIFECYCLE",
                correlationId: event.sessionId,
                ...(event.scopeKey === undefined
                  ? {}
                  : { operationId: event.scopeKey }),
                ...recoveryActivityAttribution(event.scope),
                occurrenceAt: event.occurrenceAt,
                severity:
                  event.event === "UNCERTAIN" || event.event === "BLOCKED"
                    ? "WARNING"
                    : "INFO",
                reason: {
                  code: reasonCode,
                  what: event.summary,
                  why: "F28 recovery activity is diagnostic; the durable recovery projection remains authoritative.",
                  nextAction,
                },
                summary: event.summary,
                details: {
                  f28Event: event.event,
                  f28Stage: event.stage,
                  f28ReasonCode: event.reasonCode,
                  ...(event.classification === undefined
                    ? {}
                    : { f28Classification: event.classification }),
                },
              });
            },
          },
  });
  await f28RecoveryCoordinator.startup(`f28-startup-${randomUUID()}`);

  f30SupportDiagnostics = new F30SupportDiagnosticsService({
    applicationVersion: app.getVersion(),
    sourceRevision: "runtime-build",
    readRuntime: () => ({
      node: process.versions.node,
      electron: process.versions.electron,
      platform: process.platform,
      architecture: process.arch,
    }),
    readPersistence: () => ({
      status: persistenceStore?.health.status ?? "recovery_required",
      schemaVersion: persistenceStore?.health.schemaVersion ?? 0,
    }),
    readLifecycle: () => {
      const status = lifecycle?.getStatus();
      return {
        phase: status?.phase ?? "RECOVERY_REQUIRED",
        incompleteHandoff: status?.incompleteHandoff ?? true,
        ...(status?.reasonCode === undefined
          ? {}
          : { reasonCode: status.reasonCode }),
      };
    },
    readRecovery: () => {
      const projection = f28RecoveryCoordinator?.read();
      return {
        status: projection?.status ?? "PARTIAL",
        scopes: projection?.summary.scopes ?? 0,
        completed: projection?.summary.completed ?? 0,
        attention: projection?.summary.attention ?? 0,
        retrying: projection?.summary.retrying ?? 0,
      };
    },
    readFeatureHealth: () => {
      const persistenceHealth = persistenceStore?.health;
      const recovery = f28RecoveryCoordinator?.read();
      return [
        {
          featureId: "F03",
          status:
            persistenceHealth?.status === "recovery_required"
              ? ("attention" as const)
              : ("healthy" as const),
          ...(persistenceHealth?.reasonCode === undefined
            ? {}
            : { reasonCode: persistenceHealth.reasonCode }),
        },
        {
          featureId: "F28",
          status:
            (recovery?.summary.attention ?? 0) > 0
              ? ("attention" as const)
              : ("healthy" as const),
        },
        {
          featureId: "F29",
          status: "healthy" as const,
        },
      ];
    },
    readActivity: () => {
      try {
        return (
          activityService?.query({ limit: 100, direction: "desc" }).events ?? []
        ).map((event) => ({
          eventId: event.eventId,
          eventType: event.eventType,
          stage: event.stage,
          severity: event.severity,
          reasonCode: event.reason.code,
          correlationId: event.correlationId,
          ...(event.operationId === undefined
            ? {}
            : { operationId: event.operationId }),
          occurrenceAt: event.occurrenceAt,
          recordedAt: event.recordedAt,
          summary: event.summary,
        }));
      } catch {
        return [];
      }
    },
  });

  ipcRouter = new IpcRouter(ipcMain, {
    security: f29SecurityService,
    readCurrentState: () => createCurrentState(),
    readSetupReadiness: () => {
      if (setupReadinessService === undefined)
        return Promise.reject(new Error("PRMONITOR_SETUP_SERVICE_NOT_READY"));
      return setupReadinessService.read();
    },
    retrySetupReadiness: () => {
      if (setupReadinessService === undefined)
        return Promise.reject(new Error("PRMONITOR_SETUP_SERVICE_NOT_READY"));
      return setupReadinessService.read();
    },
    getLifecycleStatus: () =>
      lifecycle?.getStatus() ?? {
        schemaVersion: 1,
        phase: "RECOVERY_REQUIRED" as const,
        sessionId: "lifecycle-missing",
        correlationId: "lifecycle-missing",
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        incompleteHandoff: true,
      },
    readRecovery: () => {
      const projection = f28RecoveryCoordinator?.read();
      if (projection === undefined)
        throw new Error("PRMONITOR_RECOVERY_PROJECTION_NOT_READY");
      return projection;
    },
    requestRecovery: () => {
      if (f28RecoveryCoordinator === undefined)
        return Promise.reject(
          new Error("PRMONITOR_RECOVERY_SERVICE_NOT_READY"),
        );
      return f28RecoveryCoordinator
        .request({
          trigger: "explicit",
          requestId: `f28-explicit-${randomUUID()}`,
        })
        .then((result) => result.projection);
    },
    exportSupportDiagnostics: async () => {
      if (f30SupportDiagnostics === undefined)
        return {
          ok: false as const,
          correlationId: `support-unavailable-${randomUUID().slice(0, 12)}`,
          code: "WRITE_FAILED" as const,
          message: "Support diagnostics are not ready yet.",
        };
      const owner = windowManager?.visibleWindow as BrowserWindow | undefined;
      const defaultPath = path.join(
        app.getPath("downloads"),
        `PRMonitor-support-${new Date().toISOString().replace(/[:.]/gu, "-")}.json`,
      );
      const selection =
        owner === undefined
          ? await dialog.showSaveDialog({
              title: "Export Support Diagnostics",
              defaultPath,
              filters: [
                { name: "PRMonitor diagnostics", extensions: ["json"] },
              ],
            })
          : await dialog.showSaveDialog(owner, {
              title: "Export Support Diagnostics",
              defaultPath,
              filters: [
                { name: "PRMonitor diagnostics", extensions: ["json"] },
              ],
            });
      if (selection.canceled || selection.filePath === undefined)
        return {
          ok: false as const,
          correlationId: `support-cancelled-${randomUUID().slice(0, 12)}`,
          code: "WRITE_FAILED" as const,
          message: "Support diagnostics export was cancelled.",
        };
      return f30SupportDiagnostics.exportTo(selection.filePath);
    },
    readScheduler: () => {
      if (reviewScheduler === undefined)
        throw new Error("PRMONITOR_SCHEDULER_SERVICE_NOT_READY");
      return reviewScheduler.read();
    },
    updateSchedulerConfiguration: (input) => {
      if (reviewScheduler === undefined)
        throw new Error("PRMONITOR_SCHEDULER_SERVICE_NOT_READY");
      return reviewScheduler.updateConfiguration({
        actor: "USER",
        requestId: input.requestId,
        configuration: input.configuration,
        ...(input.expectedRevision === undefined
          ? {}
          : { expectedRevision: input.expectedRevision }),
      });
    },
    checkSchedulerNow: (input) => {
      if (reviewScheduler === undefined)
        return Promise.reject(
          new Error("PRMONITOR_SCHEDULER_SERVICE_NOT_READY"),
        );
      return reviewScheduler.checkNow(input);
    },
    pauseWatching: (input) => {
      if (reviewScheduler === undefined)
        throw new Error("PRMONITOR_SCHEDULER_SERVICE_NOT_READY");
      return reviewScheduler.pauseWatching(input);
    },
    resumeWatching: (input) => {
      if (reviewScheduler === undefined)
        throw new Error("PRMONITOR_SCHEDULER_SERVICE_NOT_READY");
      return reviewScheduler.resumeWatching(input);
    },
    checkAITools: async (input) => {
      if (!input.connectionId) return { tools: [await checkAITool(input)] };
      const connection = f16PreferencesService
        ?.readPreferences()
        .aiConnections?.find((value) => value.id === input.connectionId);
      if (!connection || !connectionAuthentication)
        throw new Error("Select a saved AI connection first.");
      // A renderer may inspect a store only for its exact saved launch choices.
      if (
        connection.tool !== input.tool ||
        connection.executable !== input.executable ||
        connection.authMode !== input.authMode ||
        JSON.stringify(connection.extraArgs) !== JSON.stringify(input.extraArgs)
      )
        throw new Error("Save these launch choices before checking sign-in.");
      return { tools: [await connectionAuthentication.check(connection)] };
    },
    signInAIConnection: async (input) => {
      const preferences = f16PreferencesService?.readPreferences();
      const connection = preferences?.aiConnections?.find(
        (value) => value.id === input.connectionId,
      );
      if (!connection || !connectionAuthentication)
        throw new Error("Select a saved AI connection first.");
      if (preferences?.settingsRevision !== input.expectedSettingsRevision)
        throw new Error("AI settings changed. Reload before signing in.");
      await connectionAuthentication.signIn(connection);
      refreshSetupReadiness();
      return { tools: [await connectionAuthentication.check(connection)] };
    },
    cancelAIConnectionSignIn: async (input) => {
      const connection = f16PreferencesService
        ?.readPreferences()
        .aiConnections?.find((value) => value.id === input.connectionId);
      if (!connection || !connectionAuthentication)
        throw new Error("Select a saved AI connection first.");
      connectionAuthentication.cancel(connection.id);
      return { tools: [await connectionAuthentication.check(connection)] };
    },
    pickAIProgram: async () => {
      const owner = windowManager?.visibleWindow as unknown as
        BrowserWindow | undefined;
      const options = {
        title: "Browse for AI program",
        properties: ["openFile", "dontAddToRecent"] as (
          "openFile" | "dontAddToRecent"
        )[],
      };
      const selection = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options);
      return selection.canceled ? undefined : selection.filePaths[0];
    },
    saveAIConnection: async (input) => {
      if (!f16PreferencesService)
        throw new Error("AI settings are unavailable.");
      const status = await checkAITool({
        tool: input.connection.tool,
        executable: input.connection.executable,
        extraArgs: input.connection.extraArgs,
        authMode: input.connection.authMode,
      });
      if (!status.compatible || !status.executable)
        throw new Error(status.message);
      const executable = status.executable;
      if (
        input.connection.signInSource === "prmonitor" &&
        connectionAuthentication
      )
        await connectionAuthentication.home(input.connection, true);
      const preferences = setupChange(() =>
        f16PreferencesService!.saveAIConnection({
          ...input,
          connection: { ...input.connection, executable },
        }),
      );
      return preferences;
    },
    readPreferences: () => {
      if (f16PreferencesService === undefined)
        throw new Error("PRMONITOR_PREFERENCES_SERVICE_NOT_READY");
      return f16PreferencesService.readPreferences();
    },
    saveTaskProfile: (input) => {
      if (f16PreferencesService === undefined)
        throw new Error("PRMONITOR_PREFERENCES_SERVICE_NOT_READY");
      return setupChange(() => f16PreferencesService!.saveTaskProfile(input));
    },
    savePolicy: (input) => {
      if (f16PreferencesService === undefined)
        throw new Error("PRMONITOR_PREFERENCES_SERVICE_NOT_READY");
      return setupChange(() => f16PreferencesService!.savePolicy(input));
    },
    saveOperationalPreferences: (input) => {
      if (f16PreferencesService === undefined)
        return Promise.reject(
          new Error("PRMONITOR_PREFERENCES_SERVICE_NOT_READY"),
        );
      return setupChange(() => f16PreferencesService!.saveOperational(input));
    },
    saveCommonInstruction: (input) => {
      if (f16PreferencesService === undefined)
        throw new Error("PRMONITOR_PREFERENCES_SERVICE_NOT_READY");
      return f16PreferencesService.saveCommonInstruction(input);
    },
    deleteCommonInstruction: (input) => {
      if (f16PreferencesService === undefined)
        throw new Error("PRMONITOR_PREFERENCES_SERVICE_NOT_READY");
      return f16PreferencesService.deleteCommonInstruction(input);
    },
    saveCommonInstructionSelection: (input) => {
      if (f16PreferencesService === undefined)
        throw new Error("PRMONITOR_PREFERENCES_SERVICE_NOT_READY");
      return f16PreferencesService.saveCommonInstructionSelection(input);
    },
    saveRepositoryPreferences: (input) => {
      if (f16PreferencesService === undefined)
        throw new Error("PRMONITOR_PREFERENCES_SERVICE_NOT_READY");
      return f16PreferencesService.saveRepositorySettings(input);
    },
    requestShutdown: async () => {
      if (f19Coordinator !== undefined) {
        const result = await f19Coordinator.requestShutdown();
        if (result.ok) windowManager?.closeForShutdown();
        const allowedCodes: readonly IpcError["code"][] = [
          "HANDOFF_RECOVERY_REQUIRED",
          "SERVICE_START_FAILED",
          "SERVICE_STOP_FAILED",
          "SERVICE_STOP_TIMEOUT",
          "SERVICE_HANDOFF_TIMEOUT",
          "HANDLER_FAILED",
        ];
        return {
          ok: result.ok,
          status: result.status,
          ...(result.error === undefined
            ? {}
            : {
                error: {
                  code: allowedCodes.includes(
                    result.error.code as IpcError["code"],
                  )
                    ? (result.error.code as IpcError["code"])
                    : "HANDLER_FAILED",
                  message: result.error.message,
                  correlationId: result.error.correlationId,
                },
              }),
        };
      }
      const result = await lifecycle?.requestShutdown();
      if (result?.ok) windowManager?.closeForShutdown();
      return (
        result ?? {
          ok: false,
          status: lifecycle?.getStatus() ?? {
            schemaVersion: 1,
            phase: "RECOVERY_REQUIRED" as const,
            sessionId: "lifecycle-missing",
            correlationId: "lifecycle-missing",
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            incompleteHandoff: true,
          },
          error: {
            code: "HANDLER_FAILED",
            message: "Lifecycle coordinator is unavailable.",
            correlationId: "lifecycle-missing",
          },
        }
      );
    },
    readGithubSettings: () => {
      if (githubServerService === undefined)
        throw new Error("PRMONITOR_GITHUB_SERVICE_NOT_READY");
      return githubServerService.readSettings();
    },
    upsertGithubProfile: (input) => {
      if (githubServerService === undefined)
        throw new Error("PRMONITOR_GITHUB_SERVICE_NOT_READY");
      return setupChange(() => githubServerService!.upsertProfile(input));
    },
    submitGithubCredential: (input) => {
      if (githubServerService === undefined)
        return Promise.reject(new Error("PRMONITOR_GITHUB_SERVICE_NOT_READY"));
      return setupChange(() =>
        githubServerService!.submitCredential({
          serverId: input.serverId,
          value: input.token,
          operationId: input.operationId,
        }),
      );
    },
    testGithubConnection: (input) => {
      if (githubServerService === undefined)
        return Promise.reject(new Error("PRMONITOR_GITHUB_SERVICE_NOT_READY"));
      return setupChange(() => githubServerService!.testConnection(input));
    },
    retryGithubOperation: (operationId) => {
      if (githubServerService === undefined)
        return Promise.reject(new Error("PRMONITOR_GITHUB_SERVICE_NOT_READY"));
      return setupChange(() =>
        githubServerService!.retryOperation(operationId),
      );
    },
    cleanupGithubOperation: (operationId) => {
      if (githubServerService === undefined)
        return Promise.reject(new Error("PRMONITOR_GITHUB_SERVICE_NOT_READY"));
      return setupChange(() =>
        githubServerService!.cleanupOperation(operationId),
      );
    },
    removeGithubProfile: (input) => {
      if (githubServerService === undefined)
        return Promise.reject(new Error("PRMONITOR_GITHUB_SERVICE_NOT_READY"));
      return setupChange(() => githubServerService!.removeProfile(input));
    },
    readManagedPrs: () => {
      if (managedPrService === undefined)
        throw new Error("PRMONITOR_MANAGED_PR_SERVICE_NOT_READY");
      return managedPrService.list();
    },
    readManagedPr: (managedPrId) => {
      if (managedPrService === undefined)
        return Promise.reject(
          new Error("PRMONITOR_MANAGED_PR_SERVICE_NOT_READY"),
        );
      return managedPrService.read(managedPrId);
    },
    addManagedPr: (input) => {
      if (managedPrService === undefined)
        return Promise.reject(
          new Error("PRMONITOR_MANAGED_PR_SERVICE_NOT_READY"),
        );
      return managedPrService.add(input).then((result) => {
        refreshManagedPrInbox();
        return result;
      });
    },
    retryManagedPrAdd: (attemptId) => {
      if (managedPrService === undefined)
        return Promise.reject(
          new Error("PRMONITOR_MANAGED_PR_SERVICE_NOT_READY"),
        );
      return managedPrService.retryAdd(attemptId).then((result) => {
        refreshManagedPrInbox();
        return result;
      });
    },
    readManagedPrCandidates: (managedPrId) => {
      if (managedPrService === undefined)
        return Promise.reject(
          new Error("PRMONITOR_MANAGED_PR_SERVICE_NOT_READY"),
        );
      return managedPrService.candidates(managedPrId);
    },
    pickManagedPrFolder: async () => {
      const owner = windowManager?.visibleWindow as unknown as
        BrowserWindow | undefined;
      const options = {
        properties: ["openDirectory", "dontAddToRecent"] as (
          "openDirectory" | "dontAddToRecent"
        )[],
        title: "Choose an existing local Git clone",
      };
      const selection =
        owner === undefined
          ? await dialog.showOpenDialog(options)
          : await dialog.showOpenDialog(owner, options);
      return selection.canceled ? undefined : selection.filePaths[0];
    },
    attachManagedPrClone: (input) => {
      if (managedPrService === undefined)
        return Promise.reject(
          new Error("PRMONITOR_MANAGED_PR_SERVICE_NOT_READY"),
        );
      return managedPrService.attachClone(input).then((result) => {
        refreshManagedPrInbox();
        return result;
      });
    },
    clearManagedPrClone: (input) => {
      if (managedPrService === undefined)
        return Promise.reject(
          new Error("PRMONITOR_MANAGED_PR_SERVICE_NOT_READY"),
        );
      return managedPrService.clearClone(input).then((result) => {
        refreshManagedPrInbox();
        return result;
      });
    },
    saveManagedPrConfiguration: (input) => {
      if (managedPrService === undefined)
        return Promise.reject(
          new Error("PRMONITOR_MANAGED_PR_SERVICE_NOT_READY"),
        );
      return managedPrService.saveConfiguration(input).then((result) => {
        refreshManagedPrInbox();
        return result;
      });
    },
    readInbox: () => {
      if (managedPrInboxService === undefined)
        throw new Error("PRMONITOR_INBOX_SERVICE_NOT_READY");
      return managedPrInboxService.read();
    },
    readSynchronizationSelection: () => {
      if (f24SynchronizationService === undefined)
        throw new Error("PRMONITOR_F24_SERVICE_NOT_READY");
      return f24SynchronizationService.readSelection();
    },
    commandSynchronizationSelection: (input) => {
      if (f24SynchronizationService === undefined)
        throw new Error("PRMONITOR_F24_SERVICE_NOT_READY");
      return f24SynchronizationService.applySelection(input);
    },
    resetSynchronizationSelection: () => {
      if (f24SynchronizationService === undefined)
        throw new Error("PRMONITOR_F24_SERVICE_NOT_READY");
      return f24SynchronizationService.resetSelection();
    },
    resolveSynchronization: () => {
      if (f24SynchronizationService === undefined)
        return Promise.reject(new Error("PRMONITOR_F24_SERVICE_NOT_READY"));
      return f24SynchronizationService.openSynchronization();
    },
    confirmSynchronizationPreparation: (resolutionRevision) => {
      if (f24SynchronizationService === undefined)
        return Promise.reject(new Error("PRMONITOR_F24_SERVICE_NOT_READY"));
      return f24SynchronizationService.confirmPreparation({
        resolutionRevision,
        actor: "USER",
      });
    },
    readSynchronizationIntent: (intentId) => {
      if (f24SynchronizationService === undefined)
        throw new Error("PRMONITOR_F24_SERVICE_NOT_READY");
      return f24SynchronizationService.readPreparationIntent(intentId);
    },
    listSynchronizationIntents: () => {
      if (f24SynchronizationService === undefined)
        throw new Error("PRMONITOR_F24_SERVICE_NOT_READY");
      return f24SynchronizationService.listPreparationIntents();
    },
    reconcileSynchronizationIntent: (intentId) => {
      if (f24SynchronizationService === undefined)
        return Promise.reject(new Error("PRMONITOR_F24_SERVICE_NOT_READY"));
      return f24SynchronizationService.reconcilePreparation(intentId);
    },
    listSynchronizationBatches: () => {
      if (f25SynchronizationService === undefined)
        throw new Error("PRMONITOR_F25_SERVICE_NOT_READY");
      return f25SynchronizationService.listBatches();
    },
    readSynchronizationBatch: (batchId) => {
      if (f25SynchronizationService === undefined)
        throw new Error("PRMONITOR_F25_SERVICE_NOT_READY");
      return f25SynchronizationService.readBatch(batchId);
    },
    readSynchronizationResult: (operationId) => {
      if (f25SynchronizationService === undefined)
        throw new Error("PRMONITOR_F25_SERVICE_NOT_READY");
      return f25SynchronizationService.readResult(operationId);
    },
    retrySynchronizationConflict: (input) => {
      if (f25SynchronizationService === undefined)
        return Promise.reject(new Error("PRMONITOR_F25_SERVICE_NOT_READY"));
      return f25SynchronizationService.retryConflictResolution(input);
    },
    cancelSynchronizationOperation: (operationId) => {
      if (f25SynchronizationService === undefined)
        return Promise.reject(new Error("PRMONITOR_F25_SERVICE_NOT_READY"));
      return f25SynchronizationService.cancelOperation(operationId);
    },
    listSynchronizationReviews: () => {
      if (f27SynchronizationService === undefined)
        throw new Error("PRMONITOR_F27_SERVICE_NOT_READY");
      return f27SynchronizationService.listBatches();
    },
    readSynchronizationReviewBatch: (batchId) => {
      if (f27SynchronizationService === undefined)
        throw new Error("PRMONITOR_F27_SERVICE_NOT_READY");
      return f27SynchronizationService.readBatch(batchId);
    },
    readSynchronizationReviewResult: (operationId) => {
      if (f27SynchronizationService === undefined)
        throw new Error("PRMONITOR_F27_SERVICE_NOT_READY");
      return f27SynchronizationService.readResult(operationId);
    },
    refreshSynchronizationWorktree: (operationId, expectedRevision) => {
      if (f27SynchronizationService === undefined)
        return Promise.reject(new Error("PRMONITOR_F27_SERVICE_NOT_READY"));
      return f27SynchronizationService.refreshWorktree(
        operationId,
        expectedRevision,
      );
    },
    actOnSynchronizationWorktree: (input) => {
      if (f27SynchronizationService === undefined)
        return Promise.reject(new Error("PRMONITOR_F27_SERVICE_NOT_READY"));
      return f27SynchronizationService.actOnWorktree(input);
    },
    refreshSynchronizationFreshness: (input) => {
      if (f27SynchronizationService === undefined)
        return Promise.reject(new Error("PRMONITOR_F27_SERVICE_NOT_READY"));
      return f27SynchronizationService.refreshFreshness(input);
    },
    reevaluateSynchronization: (input) => {
      if (f27SynchronizationService === undefined)
        return Promise.reject(new Error("PRMONITOR_F27_SERVICE_NOT_READY"));
      return f27SynchronizationService.reevaluate(input);
    },
    discardSynchronizationResult: (input) => {
      if (f27SynchronizationService === undefined)
        throw new Error("PRMONITOR_F27_SERVICE_NOT_READY");
      return f27SynchronizationService.discard(input);
    },
    readSynchronizationPublication: (operationId) => {
      if (f27SynchronizationService === undefined)
        throw new Error("PRMONITOR_F27_SERVICE_NOT_READY");
      return f27SynchronizationService.readResult(operationId);
    },
    approveSynchronizationPublication: (input) => {
      if (f27SynchronizationService === undefined)
        return Promise.reject(new Error("PRMONITOR_F27_SERVICE_NOT_READY"));
      return f27SynchronizationService.approvePublication(input);
    },
    publishSynchronizationPublication: (input) => {
      if (f27SynchronizationService === undefined)
        return Promise.reject(new Error("PRMONITOR_F27_SERVICE_NOT_READY"));
      return f27SynchronizationService.publish(input);
    },
    reconcileSynchronizationPublication: (input) => {
      if (f27SynchronizationService === undefined)
        return Promise.reject(new Error("PRMONITOR_F27_SERVICE_NOT_READY"));
      return f27SynchronizationService.reconcile(input);
    },
    navigateManagedPr: (managedPrId, destination) => {
      if (managedPrInboxService === undefined)
        throw new Error("PRMONITOR_INBOX_SERVICE_NOT_READY");
      return managedPrInboxService.target(managedPrId, destination);
    },
    readActivity: (query) => {
      if (activityService === undefined)
        throw new Error("PRMONITOR_ACTIVITY_SERVICE_NOT_READY");
      return activityService.query(query);
    },
    navigateActivity: (eventId) => activityService?.relatedTarget(eventId),
    readReviewBundle: (bundleId) => {
      if (f20WorkspaceService === undefined)
        throw new Error("PRMONITOR_F20_WORKSPACE_SERVICE_NOT_READY");
      return f20WorkspaceService.read(bundleId);
    },
    readManagedPrWork: (managedPrId, offset) => {
      if (
        persistenceRepositories === undefined ||
        f27SynchronizationService === undefined
      )
        throw Error("SAVED_WORK_NOT_READY");
      return projectManagedPrWork(
        managedPrId,
        new F18PersistenceRepositories(
          persistenceRepositories,
        ).listForManagedPr(managedPrId),
        f27SynchronizationService.listBatches(),
        offset,
      );
    },
    readReviewBundlePublication: (bundleId) => {
      if (f23PublicationService === undefined)
        return Promise.reject(
          new Error("PRMONITOR_F23_PUBLICATION_SERVICE_NOT_READY"),
        );
      return f23PublicationService.read(bundleId);
    },
    approveReviewBundlePublication: (input) => {
      if (f23PublicationService === undefined)
        return Promise.reject(
          new Error("PRMONITOR_F23_PUBLICATION_SERVICE_NOT_READY"),
        );
      return f23PublicationService
        .approve(input)
        .then((result) => result.readModel);
    },
    publishReviewBundlePublication: (input) => {
      if (f23PublicationService === undefined)
        return Promise.reject(
          new Error("PRMONITOR_F23_PUBLICATION_SERVICE_NOT_READY"),
        );
      return f23PublicationService
        .publish(input)
        .then((result) => result.readModel);
    },
    reconcileReviewBundlePublication: (input) => {
      if (f23PublicationService === undefined)
        return Promise.reject(
          new Error("PRMONITOR_F23_PUBLICATION_SERVICE_NOT_READY"),
        );
      return f23PublicationService
        .reconcile(input)
        .then((result) => result.readModel);
    },
    retryReviewBundleResponses: (input) => {
      if (f23PublicationService === undefined)
        return Promise.reject(
          new Error("PRMONITOR_F23_PUBLICATION_SERVICE_NOT_READY"),
        );
      return f23PublicationService
        .retryResponses(input)
        .then((result) => result.readModel);
    },
    discardReviewBundlePublication: (input) => {
      if (f23PublicationService === undefined)
        return Promise.reject(
          new Error("PRMONITOR_F23_PUBLICATION_SERVICE_NOT_READY"),
        );
      return f23PublicationService
        .discard(input)
        .then((result) => result.readModel);
    },
    reconcileReviewBundleF22: async (bundleId) => {
      if (f20WorkspaceService === undefined)
        throw new Error("PRMONITOR_F20_WORKSPACE_SERVICE_NOT_READY");
      return f20WorkspaceService.reconcileF22(bundleId);
    },
    readReviewBundleDiff: (input) => {
      if (f20WorkspaceService === undefined)
        return Promise.reject(
          new Error("PRMONITOR_F20_WORKSPACE_SERVICE_NOT_READY"),
        );
      return f20WorkspaceService.readDiff(input);
    },
    recordReviewBundleDecision: (input) => {
      if (f20WorkspaceService === undefined)
        throw new Error("PRMONITOR_F20_WORKSPACE_SERVICE_NOT_READY");
      return f20WorkspaceService.recordDecision(input);
    },
    confirmReviewBundleDecisions: (input) => {
      if (f20WorkspaceService === undefined)
        return Promise.reject(
          new Error("PRMONITOR_F20_WORKSPACE_SERVICE_NOT_READY"),
        );
      return f20WorkspaceService.confirmDecisions(input);
    },
    saveReviewBundleDraft: (input) => {
      if (f20WorkspaceService === undefined)
        throw new Error("PRMONITOR_F20_WORKSPACE_SERVICE_NOT_READY");
      return f20WorkspaceService.saveDraft(input);
    },
    refreshReviewBundleWorktree: (input) => {
      if (f20WorkspaceService === undefined)
        return Promise.reject(
          new Error("PRMONITOR_F20_WORKSPACE_SERVICE_NOT_READY"),
        );
      return f20WorkspaceService.refreshWorktree(input);
    },
    previewReviewBundleDiscard: (input) => {
      if (f20WorkspaceService === undefined)
        return Promise.reject(
          new Error("PRMONITOR_F20_WORKSPACE_SERVICE_NOT_READY"),
        );
      return f20WorkspaceService.beginDiscard(input);
    },
    confirmReviewBundleDiscard: (input) => {
      if (f20WorkspaceService === undefined)
        return Promise.reject(
          new Error("PRMONITOR_F20_WORKSPACE_SERVICE_NOT_READY"),
        );
      return f20WorkspaceService.confirmDiscard(input);
    },
    previewReviewBundleReevaluation: (input) => {
      if (f20WorkspaceService === undefined)
        return Promise.reject(
          new Error("PRMONITOR_F20_WORKSPACE_SERVICE_NOT_READY"),
        );
      return f20WorkspaceService.beginReevaluation(input);
    },
    confirmReviewBundleReevaluation: (input) => {
      if (f20WorkspaceService === undefined)
        return Promise.reject(
          new Error("PRMONITOR_F20_WORKSPACE_SERVICE_NOT_READY"),
        );
      return f20WorkspaceService.confirmReevaluation(input);
    },
    reviewBundlePathAction: (input) => {
      if (f20WorkspaceService === undefined)
        return Promise.reject(
          new Error("PRMONITOR_F20_WORKSPACE_SERVICE_NOT_READY"),
        );
      return f20WorkspaceService.pathAction(input);
    },
    readReviewBundleConversation: (bundleId) => {
      if (f21ConversationService === undefined)
        throw new Error("PRMONITOR_F21_CONVERSATION_SERVICE_NOT_READY");
      return f21ConversationService.read(bundleId);
    },
    askReviewBundleConversation: (input) => {
      if (f21ConversationService === undefined)
        return Promise.reject(
          new Error("PRMONITOR_F21_CONVERSATION_SERVICE_NOT_READY"),
        );
      return f21ConversationService.ask(input);
    },
    requestReviewBundleRevision: (input) => {
      if (f21ConversationService === undefined)
        return Promise.reject(
          new Error("PRMONITOR_F21_CONVERSATION_SERVICE_NOT_READY"),
        );
      return f21ConversationService.requestRevision(input);
    },
    startNewReviewBundleOperation: (input) => {
      if (f21ConversationService === undefined)
        return Promise.reject(
          new Error("PRMONITOR_F21_CONVERSATION_SERVICE_NOT_READY"),
        );
      return f21ConversationService.startNewOperation(input);
    },
    saveReviewBundleProposalInput: (input) => {
      if (f21ConversationService === undefined)
        throw new Error("PRMONITOR_F21_CONVERSATION_SERVICE_NOT_READY");
      return f21ConversationService.saveProposalInput(input);
    },
    cancelReviewBundleConversation: (input) => {
      if (f21ConversationService === undefined)
        throw new Error("PRMONITOR_F21_CONVERSATION_SERVICE_NOT_READY");
      return f21ConversationService.cancel(input);
    },
    continueReviewBundleConversation: (input) => {
      if (f21ConversationService === undefined)
        return Promise.reject(
          new Error("PRMONITOR_F21_CONVERSATION_SERVICE_NOT_READY"),
        );
      return f21ConversationService.continue(input);
    },
    onRendererReady: (senderId) => {
      windowManager?.markRendererReady(senderId);
    },
  });
  ipcRouter.install();
  managedPrInboxService?.subscribe((snapshot) => {
    ipcRouter?.publishInbox(snapshot);
  });
  activityService?.subscribe((event) => {
    ipcRouter?.publishActivity(event);
  });

  createApplicationWindowManager();

  if (
    f19PersistenceRepositories === undefined ||
    managedPrInboxService === undefined ||
    reviewScheduler === undefined ||
    f13WorktreeService === undefined ||
    lifecycle === undefined
  )
    throw new Error("PRMONITOR_F19_DEPENDENCY_NOT_READY");
  const initializedF19PersistenceRepositories = f19PersistenceRepositories;
  const initializedManagedPrInboxService = managedPrInboxService;
  const initializedReviewScheduler = reviewScheduler;
  const initializedF13WorktreeService = f13WorktreeService;
  const initializedLifecycle = lifecycle;
  f19Coordinator = new TrayNotificationCoordinator({
    persistence: initializedF19PersistenceRepositories,
    surface: new ElectronF19NativeSurfaceAdapter(applicationIconPath()),
    inbox: {
      read: () => initializedManagedPrInboxService.read(),
      subscribe: (listener) =>
        initializedManagedPrInboxService.subscribe(listener),
    },
    scheduler: {
      read: () => initializedReviewScheduler.read(),
      pauseWatching: (input) => initializedReviewScheduler.pauseWatching(input),
      resumeWatching: (input) =>
        initializedReviewScheduler.resumeWatching(input),
    },
    window: {
      open: (target) =>
        windowManager?.open(target) ??
        Promise.resolve({
          ok: false,
          outcome: "focus-denied" as const,
          rendererReady: false,
          targetDelivered: 0,
          reasonCode: "WINDOW_MANAGER_UNAVAILABLE",
        }),
    },
    worktrees: {
      openWorktree: (input) =>
        initializedF13WorktreeService.openWorktree(input),
    },
    lifecycle: {
      requestShutdown: () => initializedLifecycle.requestShutdown(),
    },
    activity: activityService?.writer,
    bounds: createF19EffectiveBounds({
      shutdownTimeoutMs: DEFAULT_SERVICE_HANDOFF_TIMEOUT_MS,
      ipcMaxRequestBytes: IPC_MAX_REQUEST_BYTES,
      ipcMaxResponseBytes: IPC_MAX_RESPONSE_BYTES,
      activityMaxSummaryBytes: ACTIVITY_MAX_SUMMARY_BYTES,
      activityMaxDetailBytes: ACTIVITY_MAX_DETAIL_BYTES,
      persistenceMaxJsonBytes: MAX_PERSISTED_JSON_BYTES,
      persistenceMaxTextBytes: MAX_PERSISTED_TEXT_BYTES,
      activationQueueEntries: OPEN_TARGET_QUEUE_MAX,
    }),
    exitProcess: () => app.quit(),
  });
  const started = await lifecycle.start();
  if (!started.ok)
    throw new Error(
      started.error?.message ?? "PRMONITOR_LIFECYCLE_START_FAILED",
    );
  if (!f28LifecycleListenersAttached && f28RecoveryCoordinator !== undefined) {
    let lastOnline = readOnlineState();
    f28ResumeHandler = () => {
      void f28RecoveryCoordinator
        ?.wake(`f28-wake-${Date.now()}`)
        .catch(() => undefined);
    };
    powerMonitor.on("resume", f28ResumeHandler);
    f28NetworkPollTimer = setInterval(() => {
      const online = readOnlineState();
      if (online === lastOnline) return;
      lastOnline = online;
      const recovery = online
        ? f28RecoveryCoordinator?.online(`f28-online-${randomUUID()}`)
        : f28RecoveryCoordinator?.wake(`f28-offline-${randomUUID()}`);
      void recovery?.catch(() => undefined);
    }, 5_000);
    f28LifecycleListenersAttached = true;
  }
  await f19Coordinator.start();
  // Ambient local changes (Git, storage, authentication, filesystem access)
  // are rechecked while a view exists; this never starts domain work.
  setupReadinessTimer = setInterval(() => {
    if (windowManager?.visibleWindowId !== undefined) refreshSetupReadiness();
  }, 30_000);

  if (smokeMode && !smokeNonce) {
    smokeFailure("SMOKE_NONCE_MISSING");
    return;
  }
  if (smokeMode)
    smokeTimer = setTimeout(
      () => smokeFailure("READINESS_TIMEOUT"),
      smokeTimeoutMs,
    );

  const initialTarget = pendingTargets.dequeue();
  if (windowManager === undefined)
    throw new Error("PRMONITOR_WINDOW_MANAGER_NOT_READY");
  const openWork: Promise<WindowOpenResult> = windowManager.open(initialTarget);
  for (
    let target = pendingTargets.dequeue();
    target !== undefined;
    target = pendingTargets.dequeue()
  ) {
    void windowManager.open(target);
  }
  const openResult = await openWork;
  if (!openResult.ok && !smokeMode) return;
  if (smokeMode) {
    smokeWindow = windowManager.visibleWindow as BrowserWindow | undefined;
    if (smokeWindow === undefined) {
      smokeFailure("WINDOW_MISSING_AFTER_OPEN");
      return;
    }
    const probe = await runAccessibilityProbe(smokeWindow);
    if (!probe.ok || !probe.forcedColors || smokeReady) {
      smokeFailure(probe.reason ?? "ACCESSIBILITY_PROBE_FAILED");
      return;
    }
    smokeReady = true;
    process.stdout.write(`${SMOKE_READY_PREFIX}${smokeNonce}\n`, () => {
      if (!smokeWindow?.isDestroyed()) smokeWindow?.close();
      app.exit(0);
    });
  }
}

const primaryInstance = new PrimaryInstanceCoordinator({
  host: app,
  queue: pendingTargets,
  onAcceptedTarget: (target) => {
    lastAcceptedOpenTarget = target;
    if (windowManager !== undefined) void windowManager.open(target);
  },
});

if (primaryInstance.acquire(process.argv)) {
  app
    .whenReady()
    .then(() => startMainProcess())
    .catch((error: unknown) => smokeFailure("APP_START_FAILED", error));
}

app.on("will-quit", () => {
  connectionAuthentication?.dispose();
  connectionAuthentication = undefined;
  if (setupReadinessTimer !== undefined) clearInterval(setupReadinessTimer);
  setupReadinessTimer = undefined;
  setupReadinessService = undefined;
  detachF28LifecycleListeners();
  f28RecoveryCoordinator?.stop();
  f28RecoveryCoordinator = undefined;
  f19Coordinator?.stop();
  f19Coordinator = undefined;
  void f14ValidationService?.shutdown();
  f14ValidationService = undefined;
  prWatcher?.stop();
  prWatcher = undefined;
  reviewScheduler?.stop();
  reviewScheduler = undefined;
  githubServerService = undefined;
  managedPrService = undefined;
  f21ConversationService = undefined;
  f21AiWorkAdapter = undefined;
  f20WorkspaceService = undefined;
  persistenceStore?.close();
  persistenceStore = undefined;
});

app.on("window-all-closed", () => {
  // F04 deliberately keeps the main process alive. Only the explicit
  // Shutdown PRMonitor lifecycle request can begin normal termination.
});

app.on("activate", () => {
  if (windowManager !== undefined) void windowManager.open();
});
