import { app, BrowserWindow, dialog, ipcMain, safeStorage } from "electron";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  APPLICATION_TITLE,
  SMOKE_READY_PREFIX,
  STARTUP_STATUS_ID,
} from "../shared/startup";
import { OpenTargetQueue } from "../shared/routing";
import type { CurrentState } from "../shared/ipc";
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
} from "./persistence";
import {
  createPersistenceLifecyclePersistence,
  LifecycleCoordinator,
} from "./lifecycle";
import { IpcRouter } from "./ipc-router";
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
import { AIProviderRegistry, createCodexProvider } from "./ai";
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
let automaticReviewCoordinator: F18AutomaticReviewBoundary | undefined;
let automaticReviewAiAdapter: F18AIWorkAdapter | undefined;
const pendingTargets = new OpenTargetQueue();

const rendererEntry = path.join(
  currentDirectory,
  "..",
  "renderer",
  "index.html",
);
const preloadEntry = path.join(currentDirectory, "..", "preload", "index.cjs");

function configureSmokePaths(): void {
  if (!smokeMode) return;
  const userDataDirectory = process.env.PRMONITOR_USER_DATA_DIR;
  const cacheDirectory = process.env.PRMONITOR_CACHE_DIR;
  if (
    !userDataDirectory ||
    !cacheDirectory ||
    !path.isAbsolute(userDataDirectory) ||
    !path.isAbsolute(cacheDirectory)
  ) {
    throw new Error("SMOKE_RUNTIME_PATHS_MISSING");
  }
  app.setPath("userData", userDataDirectory);
  app.setPath("cache", cacheDirectory);
}

const accessibilityProbe = `(() => {
  const visible = (element) => {
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getAttribute("aria-hidden") !== "true";
  };
  const focusable = [...document.querySelectorAll("a[href], button, input, select, textarea, [tabindex]:not([tabindex=\\"-1\\"])" )]
    .filter((element) => visible(element) && !element.hasAttribute("disabled"));
  const skipLink = document.querySelector(".skip-link");
  const status = document.querySelector("#${STARTUP_STATUS_ID}");
  const heading = document.querySelectorAll("h1");
  const managedPrForm = document.querySelector('form[aria-label="Add a pull request"]');
  const managedPrHeading = document.querySelector("#managed-pr-heading");
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
      managedPrForm.getAttribute("aria-label") === "Add a pull request" &&
      managedPrHeading.textContent?.trim() === "Add and manage a PR" &&
      managedPrControls.length >= 7 &&
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
): Promise<{ ok: boolean; forcedColors: boolean }> {
  const normal = (await window.webContents.executeJavaScript(
    accessibilityProbe,
    true,
  )) as {
    ok: boolean;
    forcedColors: boolean;
  };
  if (!normal.ok) return normal;
  if (!(await runKeyboardProbe(window))) {
    return { ok: false, forcedColors: false };
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
    const forcedKeyboard = await runKeyboardProbe(window);
    await window.webContents.debugger.sendCommand(
      "Emulation.setEmulatedMedia",
      { features: [] },
    );
    window.webContents.debugger.detach();
    if (!forced.ok || !forced.forcedColors || !forcedKeyboard)
      return { ok: false, forcedColors: forced.forcedColors };
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

async function runKeyboardProbe(window: BrowserWindow): Promise<boolean> {
  await window.webContents.executeJavaScript(
    `(() => {
      const body = document.body;
      body.setAttribute("tabindex", "-1");
      body.focus();
      body.removeAttribute("tabindex");
    })()`,
    true,
  );
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "TAB" });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "TAB" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const tabTarget = (await window.webContents.executeJavaScript(
    `document.activeElement?.classList.contains("skip-link") === true`,
    true,
  )) as boolean;

  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "ENTER" });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "ENTER" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const enterTarget = (await window.webContents.executeJavaScript(
    `document.activeElement?.id === "${STARTUP_STATUS_ID}"`,
    true,
  )) as boolean;
  return tabTarget && enterTarget;
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
  configureSmokePaths();
} catch (error) {
  smokeFailure("SMOKE_RUNTIME_PATHS_INVALID", error);
}

async function initializeMainProcessPersistence(): Promise<void> {
  const userDataDirectory = app.getPath("userData");
  persistenceStore = await initializePersistence({
    databasePath: path.join(userDataDirectory, "database", "prmonitor.sqlite"),
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
  const f13Root = path.join(userDataDirectory, "worktrees");
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
  f15ProviderRegistry.register(createCodexProvider());
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
  const initializedF14ValidationService = f14ValidationService;
  if (initializedF14ValidationService === undefined)
    throw new Error("PRMONITOR_F14_VALIDATION_SERVICE_NOT_READY");
  const initializedF11EligibilityService = f11EligibilityService;
  if (initializedF11EligibilityService === undefined)
    throw new Error("PRMONITOR_F11_ELIGIBILITY_SERVICE_NOT_READY");
  const f17Persistence = new F17PersistenceRepositories(persistenceStore);
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
  reviewScheduler = new ReviewScheduler({
    managedPrs: {
      listManagedPrs: () => f07Repositories.listManagedPrs(),
    },
    persistence: new F12PersistenceRepositories(persistenceStore),
    poller: {
      poll: ({ managedPrIds, signal }) => {
        if (prWatcher === undefined)
          return Promise.reject(new Error("PRMONITOR_PR_WATCHER_NOT_READY"));
        return prWatcher.runForManagedPrs(managedPrIds, signal);
      },
    },
    eligibility: f11EligibilityService,
    reviewWork: {
      startAutomaticReview: async (input) => {
        const result =
          await initializedAutomaticReviewCoordinator.startAutomaticReview(
            input,
          );
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

async function startMainProcess(): Promise<void> {
  await initializeMainProcessPersistence();
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
        name: "automatic-review-ai-work",
        stopAdmission: () => automaticReviewAiAdapter?.stopAdmission(),
        handoff: () => automaticReviewAiAdapter?.handoff(),
        boundedStop: () => automaticReviewAiAdapter?.boundedStop(),
      },
    ],
  });
  const started = await lifecycle.start();
  if (!started.ok)
    throw new Error(
      started.error?.message ?? "PRMONITOR_LIFECYCLE_START_FAILED",
    );
  const refreshManagedPrInbox = (): void => {
    try {
      managedPrInboxService?.refresh();
    } catch {
      // A malformed optional inbox projection must not change the outcome of
      // the authoritative managed-PR operation that triggered this refresh.
    }
  };

  ipcRouter = new IpcRouter(ipcMain, {
    readCurrentState: () => createCurrentState(),
    getLifecycleStatus: () => lifecycle?.getStatus() ?? started.status,
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
    readPreferences: () => {
      if (f16PreferencesService === undefined)
        throw new Error("PRMONITOR_PREFERENCES_SERVICE_NOT_READY");
      return f16PreferencesService.readPreferences();
    },
    saveTaskProfile: (input) => {
      if (f16PreferencesService === undefined)
        throw new Error("PRMONITOR_PREFERENCES_SERVICE_NOT_READY");
      return f16PreferencesService.saveTaskProfile(input);
    },
    savePolicy: (input) => {
      if (f16PreferencesService === undefined)
        throw new Error("PRMONITOR_PREFERENCES_SERVICE_NOT_READY");
      return f16PreferencesService.savePolicy(input);
    },
    saveOperationalPreferences: (input) => {
      if (f16PreferencesService === undefined)
        return Promise.reject(
          new Error("PRMONITOR_PREFERENCES_SERVICE_NOT_READY"),
        );
      return f16PreferencesService.saveOperational(input);
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
      const result = await lifecycle?.requestShutdown();
      if (result?.ok) windowManager?.closeForShutdown();
      return (
        result ?? {
          ok: false,
          status: started.status,
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
      return githubServerService.upsertProfile(input);
    },
    submitGithubCredential: (input) => {
      if (githubServerService === undefined)
        return Promise.reject(new Error("PRMONITOR_GITHUB_SERVICE_NOT_READY"));
      return githubServerService.submitCredential({
        serverId: input.serverId,
        value: input.token,
        operationId: input.operationId,
      });
    },
    testGithubConnection: (input) => {
      if (githubServerService === undefined)
        return Promise.reject(new Error("PRMONITOR_GITHUB_SERVICE_NOT_READY"));
      return githubServerService.testConnection(input);
    },
    retryGithubOperation: (operationId) => {
      if (githubServerService === undefined)
        return Promise.reject(new Error("PRMONITOR_GITHUB_SERVICE_NOT_READY"));
      return githubServerService.retryOperation(operationId);
    },
    cleanupGithubOperation: (operationId) => {
      if (githubServerService === undefined)
        return Promise.reject(new Error("PRMONITOR_GITHUB_SERVICE_NOT_READY"));
      return githubServerService.cleanupOperation(operationId);
    },
    removeGithubProfile: (input) => {
      if (githubServerService === undefined)
        return Promise.reject(new Error("PRMONITOR_GITHUB_SERVICE_NOT_READY"));
      return githubServerService.removeProfile(input);
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
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          preload,
        },
      });
      return created as unknown as ManagedWindowLike;
    },
    sendTarget: (contents, target) =>
      ipcRouter?.deliverOpenTarget(contents.id, target) ?? false,
    onRendererAttached: (contents) => ipcRouter?.attachRenderer(contents),
    onRendererDetached: (contentsId) => ipcRouter?.detachRenderer(contentsId),
  });

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
      smokeFailure("ACCESSIBILITY_PROBE_FAILED");
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
  void f14ValidationService?.shutdown();
  f14ValidationService = undefined;
  prWatcher?.stop();
  prWatcher = undefined;
  reviewScheduler?.stop();
  reviewScheduler = undefined;
  githubServerService = undefined;
  managedPrService = undefined;
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
