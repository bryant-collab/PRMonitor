import { app, BrowserWindow, dialog, ipcMain, safeStorage } from "electron";
import { mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  APPLICATION_TITLE,
  SMOKE_READY_PREFIX,
  STARTUP_STATUS_ID,
} from "../shared/startup";
import { OPEN_TARGET_QUEUE_MAX, OpenTargetQueue } from "../shared/routing";
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
} from "./persistence";
import {
  createPersistenceLifecyclePersistence,
  LifecycleCoordinator,
  DEFAULT_SERVICE_HANDOFF_TIMEOUT_MS,
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
import { F21AIWorkAdapter } from "./f21-ai-work-adapter";
import { F21ConversationService } from "./f21-conversation-service";
import { F20WorkspaceService } from "./f20-workspace-service";
import { F22Coordinator } from "./f22-coordinator";
import { F23PublicationService } from "./f23-release-service";
import { F23DeterministicGitPublisher } from "./f23-release-git";
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
  f24Reason,
  type F24F16ConfigurationReference,
} from "../shared/f24-synchronization";
import { F25SynchronizationService } from "./f25-synchronization-service";

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
let f22Coordinator: F22Coordinator | undefined;
let automaticReviewAiAdapter: F18AIWorkAdapter | undefined;
let f21AiWorkAdapter: F21AIWorkAdapter | undefined;
let f21ConversationService: F21ConversationService | undefined;
let f20WorkspaceService: F20WorkspaceService | undefined;
let f23PublicationService: F23PublicationService | undefined;
let f19PersistenceRepositories: F19PersistenceRepositories | undefined;
let f19Coordinator: TrayNotificationCoordinator | undefined;
let f24SynchronizationService: F24SynchronizationService | undefined;
let f25SynchronizationService: F25SynchronizationService | undefined;
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
  f19PersistenceRepositories = new F19PersistenceRepositories(persistenceStore);
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
  f25SynchronizationService = new F25SynchronizationService({
    persistence: new F25PersistenceRepositories(f03Repositories),
    managedPrs: {
      getManagedPr: (managedPrId) => f07Repositories.getManagedPr(managedPrId),
    },
    f13: initializedF13WorktreeService,
    f14: initializedF14ValidationService,
    validation: {
      resolve: ({ repositoryId, operationId }) =>
        resolveValidationProfile({ repositoryId, operationId }),
    },
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

  ipcRouter = new IpcRouter(ipcMain, {
    readCurrentState: () => createCurrentState(),
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
    cancelSynchronizationOperation: (operationId) => {
      if (f25SynchronizationService === undefined)
        return Promise.reject(new Error("PRMONITOR_F25_SERVICE_NOT_READY"));
      return f25SynchronizationService.cancelOperation(operationId);
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
    surface: new ElectronF19NativeSurfaceAdapter(),
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
  await f19Coordinator.start();

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
