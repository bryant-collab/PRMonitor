import {
  recoveryScopeManagedPrId,
  isEmptyRecoveryScope,
} from "../shared/recovery-attribution";
import { createPrDetailReader } from "./pr-detail-reader";
import { savedWorkTarget } from "./shell-routing";
import { ConnectionStatus } from "./ConnectionStatus";
import { PrDetail } from "./PrDetail";
import {
  initialShellRoute,
  routeOpenTarget,
  routeAfterPrRemoval,
  type ShellDestination,
  type SettingsCategory,
  type PrDetailTab,
} from "./shell-routing";
import type { OpenTarget } from "../shared/routing";
import type { F12SchedulerSnapshot } from "../shared/control-plane";
import type { ManagedPrWork } from "../shared/managed-pr-work";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";
import {
  APPLICATION_TITLE,
  INITIAL_STARTUP_STATUS,
  STARTUP_STATUS_ID,
} from "../shared/startup";
import type { CurrentState } from "../shared/ipc";
import type { F28RecoveryProjection } from "../shared/f28-recovery";
import type {
  GithubCredentialOperationView,
  GithubServerProfileView,
  GithubServerSettingsView,
} from "../shared/github-server";
import type {
  AddPrAttemptView,
  ManagedPrCandidateView,
  ManagedPrReadModel,
} from "../shared/managed-pr";
import {
  acceptManagedPrInboxSnapshot,
  type ManagedPrInboxReadModel,
} from "../shared/inbox";
import type {
  F24PreparationIntent,
  F24SelectionCommandInput,
  F24SelectionSession,
  F24SynchronizationConfirmation,
} from "../shared/f24-synchronization";
import { ManagedPrInbox } from "./ManagedPrInbox";
import { ActivityViewer } from "./ActivityViewer";
import { Preferences } from "./Preferences";
import { ReviewBundleWorkspace } from "./ReviewBundleWorkspace";
import { SynchronizationReview } from "./SynchronizationReview";
import {
  SetupScreen,
  createSetupReader,
  setupLanding,
  type SetupDestination,
  type SetupReadState,
} from "./SetupScreen";

function operationNeedsAction(
  operation: GithubCredentialOperationView,
): boolean {
  return [
    "FAILED",
    "CANCELLED",
    "RECOVERY_REQUIRED",
    "CLEANUP_PENDING",
  ].includes(operation.phase);
}

function statusLabel(profile: GithubServerProfileView): string {
  return profile.status.toLowerCase().replaceAll("_", " ");
}

export function StartupApp() {
  const [route, setRoute] = useState(initialShellRoute);
  const destination = route.destination;
  const setDestination = useCallback(
    (
      next:
        ShellDestination | ((current: ShellDestination) => ShellDestination),
    ) =>
      setRoute((current) => ({
        ...current,
        destination:
          typeof next === "function" ? next(current.destination) : next,
      })),
    [],
  );
  const selectedManagedPrId = route.selectedManagedPrId;
  const setSelectedManagedPrId = (id: string | undefined) =>
    setRoute((current) => ({ ...current, selectedManagedPrId: id }));
  const [settingsCategory, setSettingsCategory] =
    useState<SettingsCategory>("github");
  const [managedWork, setManagedWork] = useState<ManagedPrWork>();
  const [historyBusy, setHistoryBusy] = useState(false);
  const historyGeneration = useRef(0);
  const historyBusyRef = useRef(false);
  const currentRoute = useRef(route);
  currentRoute.current = route;
  const [detailError, setDetailError] = useState("");
  const detailReader =
    useRef<ReturnType<typeof createPrDetailReader>>(undefined);
  const targetHandler = useRef<(target: OpenTarget) => void>(() => undefined);
  const [visitedReviews, setVisitedReviews] = useState<readonly string[]>([]);
  const [visitedSync, setVisitedSync] = useState<readonly OpenTarget[]>([]);
  const [scheduler, setScheduler] = useState<F12SchedulerSnapshot>();
  const [schedulerBusy, setSchedulerBusy] = useState(false);
  const schedulerBusyRef = useRef(false);
  const [schedulerMessage, setSchedulerMessage] = useState("");
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [recoveryError, setRecoveryError] = useState("");
  const prDrafts = useRef(
    new Map<string, { context: string; override: string; clone: string }>(),
  );
  const [prDraftScope, setPrDraftScope] = useState("add");
  const currentPrDraft = useRef({
    scope: "add",
    context: "",
    override: "",
    clone: "",
  });
  const [setupState, setSetupState] = useState<SetupReadState>({
    loading: true,
  });
  const setupReader = useRef<ReturnType<typeof createSetupReader>>(undefined);
  const {
    readiness: setupReadiness,
    loading: setupLoading,
    error: setupError,
  } = setupState;
  const readSetup = useCallback(async () => {
    await setupReader.current?.read();
  }, []);
  useEffect(() => {
    const bridge = window.prmonitor;
    const reader = createSetupReader(
      async () => {
        await bridge?.ready();
        return bridge?.readSetupReadiness();
      },
      (next) => {
        setSetupState(next);
        if (
          !next.loading &&
          next.error === undefined &&
          next.readiness !== undefined
        ) {
          setDestination((current) =>
            current === "home"
              ? next.readiness?.ready
                ? "inbox"
                : "setup"
              : current,
          );
        }
      },
      10000,
      async () => {
        await bridge?.ready();
        return bridge?.retrySetupReadiness();
      },
    );
    setupReader.current = reader;
    const unsubscribe = bridge?.onSetupReadinessUpdated(reader.updated);
    void reader.read();
    return () => {
      reader.dispose();
      unsubscribe?.();
      setupReader.current = undefined;
    };
  }, []);
  const statusRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<CurrentState | undefined>();
  const [recovery, setRecovery] = useState<F28RecoveryProjection>();
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [supportBusy, setSupportBusy] = useState(false);
  const [supportMessage, setSupportMessage] = useState("");
  const [settings, setSettings] = useState<
    GithubServerSettingsView | undefined
  >();

  const [displayName, setDisplayName] = useState("");
  const [serverUrl, setServerUrl] = useState("https://github.com");
  const [selectedProfileId, setSelectedProfileId] = useState<
    string | undefined
  >();
  const [formMessage, setFormMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const tokenInputRef = useRef<HTMLInputElement>(null);
  const [managedPrs, setManagedPrs] = useState<readonly ManagedPrReadModel[]>(
    [],
  );
  const [addAttempts, setAddAttempts] = useState<readonly AddPrAttemptView[]>(
    [],
  );

  const [managedDetails, setManagedDetails] = useState<ManagedPrReadModel>();
  const [managedCandidates, setManagedCandidates] = useState<
    readonly ManagedPrCandidateView[]
  >([]);
  const [managedMessage, setManagedMessage] = useState("");
  const [prUrl, setPrUrl] = useState("");
  const [addContext, setAddContext] = useState("");
  const [addOverride, setAddOverride] = useState("");
  const [addClonePath, setAddClonePath] = useState("");
  const [prContext, setPrContext] = useState("");
  const [prOverride, setPrOverride] = useState("");
  const [prClonePath, setPrClonePath] = useState("");
  const [inboxSnapshot, setInboxSnapshot] = useState<ManagedPrInboxReadModel>();
  const inboxScroll = useRef(0);
  const priorInboxIds = useRef<readonly string[]>([]);
  const [inboxLoading, setInboxLoading] = useState(true);
  const [inboxError, setInboxError] = useState<string>();
  const [inboxLastKnown, setInboxLastKnown] = useState(false);
  const [synchronizationSelection, setSynchronizationSelection] = useState<
    F24SelectionSession | undefined
  >();
  const [synchronizationConfirmation, setSynchronizationConfirmation] =
    useState<F24SynchronizationConfirmation>();
  const [preparationIntent, setPreparationIntent] =
    useState<F24PreparationIntent>();
  const [synchronizationBusy, setSynchronizationBusy] = useState(false);
  const [confirmingPreparation, setConfirmingPreparation] = useState(false);

  currentPrDraft.current = {
    scope: prDraftScope,
    context: prContext,
    override: prOverride,
    clone: prClonePath,
  };
  const rememberPrDraft = () => {
    const draft = currentPrDraft.current;
    prDrafts.current.set(draft.scope, {
      context: draft.context,
      override: draft.override,
      clone: draft.clone,
    });
  };
  const beginAddPr = () => {
    rememberPrDraft();
    setDestination("managed");
    requestAnimationFrame(focusAddPr);
  };
  useEffect(() => {
    document.title = APPLICATION_TITLE;
  }, []);

  useEffect(() => {
    let active = true;
    const bridge = window.prmonitor;
    if (bridge === undefined) return () => undefined;
    let hadInboxSnapshot = false;
    const unsubscribeInbox = bridge.onInboxUpdated((snapshot) => {
      if (!active) return;
      setInboxSnapshot((current) =>
        acceptManagedPrInboxSnapshot(current, snapshot),
      );
      setInboxLoading(false);
      setInboxError(undefined);
      setInboxLastKnown(false);
    });
    void bridge.ready().then(async () => {
      const [stateResponse, settingsResponse, recoveryResponse] =
        await Promise.all([
          bridge.readCurrentState(),
          bridge.readGithubSettings(),
          bridge.readRecovery(),
        ]);
      if (!active) return;
      if (stateResponse.ok && stateResponse.value.kind === "current-state")
        setState(stateResponse.value.state);
      if (
        settingsResponse.ok &&
        settingsResponse.value.kind === "github-settings"
      ) {
        setSettings(settingsResponse.value.settings);
        const first = settingsResponse.value.settings.profiles[0];
        if (first !== undefined) setSelectedProfileId(first.id);
      }
      if (recoveryResponse.ok && recoveryResponse.value.kind === "recovery")
        setRecovery(recoveryResponse.value.projection);
      const selectionResponse = await bridge.readSynchronizationSelection();
      if (
        active &&
        selectionResponse.ok &&
        selectionResponse.value.kind === "synchronization-selection"
      )
        setSynchronizationSelection(selectionResponse.value.selection);
      const intentResponse = await bridge.listSynchronizationIntents();
      if (
        active &&
        intentResponse.ok &&
        intentResponse.value.kind === "synchronization-intents"
      ) {
        const latestIntent = intentResponse.value.intents[0];
        if (latestIntent !== undefined) setPreparationIntent(latestIntent);
      }
      const managedResponse = await bridge.readManagedPrs();
      if (
        active &&
        managedResponse.ok &&
        managedResponse.value.kind === "managed-pr-list"
      ) {
        setManagedPrs(managedResponse.value.value.managedPrs);
        setAddAttempts(managedResponse.value.value.attempts);
      }
      if (!active) return;
      const inboxResponse = await bridge.readInbox();
      if (!active) return;
      if (inboxResponse.ok && inboxResponse.value.kind === "managed-pr-inbox") {
        const snapshot = inboxResponse.value.snapshot;
        hadInboxSnapshot = true;
        setInboxSnapshot((current) =>
          acceptManagedPrInboxSnapshot(current, snapshot),
        );
        setInboxError(undefined);
        setInboxLastKnown(false);
      } else {
        setInboxError(
          inboxResponse.ok
            ? "The inbox returned an invalid read model."
            : inboxResponse.error.message,
        );
      }
      setInboxLoading(false);
      const subscription = await bridge.subscribeInbox();
      if (!active) return;
      if (!subscription.ok || subscription.value.kind !== "managed-pr-inbox") {
        setInboxError(
          subscription.ok
            ? "The inbox subscription returned an invalid read model."
            : subscription.error.message,
        );
        setInboxLastKnown(hadInboxSnapshot);
      } else {
        const snapshot = subscription.value.snapshot;
        hadInboxSnapshot = true;
        setInboxSnapshot((current) =>
          acceptManagedPrInboxSnapshot(current, snapshot),
        );
        setInboxError(undefined);
        setInboxLastKnown(false);
      }
    });
    const unsubscribe = bridge.onOpenTarget((target) => {
      if (active) targetHandler.current(target);
    });
    return () => {
      active = false;
      unsubscribe();
      unsubscribeInbox();
    };
  }, [readSetup]);

  const requestRecovery = useCallback(async () => {
    const bridge = window.prmonitor;
    if (bridge === undefined || recoveryBusy) return;
    setRecoveryBusy(true);
    setRecoveryMessage("");
    setRecoveryError("");
    try {
      const response = await bridge.requestRecovery();
      if (response.ok && response.value.kind === "recovery") {
        const next = response.value.projection;
        setRecovery(next);
        setRecoveryMessage(
          next.status === "FAILED"
            ? "The interrupted-work check failed. Saved evidence remains available."
            : next.status === "PARTIAL"
              ? "The interrupted-work check finished partly. Inspect the saved work that still needs attention."
              : next.status === "RUNNING"
                ? "The interrupted-work check is still running."
                : next.summary.attention > 0
                  ? "The check finished. Some saved work needs your attention."
                  : "The check finished. No interrupted work needs action.",
        );
      } else
        setRecoveryError(
          "The interrupted-work check could not complete. Try Check interrupted work again.",
        );
    } catch {
      setRecoveryError(
        "The interrupted-work check could not complete. Check your connection, then try again.",
      );
    } finally {
      setRecoveryBusy(false);
    }
  }, [recoveryBusy]);

  const exportSupportDiagnostics = useCallback(async () => {
    const bridge = window.prmonitor;
    if (bridge === undefined || supportBusy) return;
    setSupportBusy(true);
    try {
      const response = await bridge.exportSupportDiagnostics();
      if (response.ok && response.value.kind === "support-diagnostics")
        setSupportMessage(
          `Diagnostics saved as ${response.value.fileName} (${response.value.bytes} bytes).`,
        );
      else
        setSupportMessage(
          response.ok
            ? "Diagnostics were not exported safely."
            : response.error.message,
        );
    } catch {
      setSupportMessage(
        "Diagnostics could not be exported safely. Choose another destination and retry.",
      );
    } finally {
      setSupportBusy(false);
    }
  }, [supportBusy]);

  const retryInbox = useCallback(async () => {
    const bridge = window.prmonitor;
    if (bridge === undefined) return;
    setInboxLoading(true);
    const response = await bridge.readInbox();
    if (response.ok && response.value.kind === "managed-pr-inbox") {
      const snapshot = response.value.snapshot;
      setInboxSnapshot((current) =>
        acceptManagedPrInboxSnapshot(current, snapshot),
      );
      setInboxError(undefined);
      setInboxLastKnown(false);
    } else {
      setInboxError(
        response.ok
          ? "The inbox returned an invalid read model."
          : response.error.message,
      );
      setInboxLastKnown(inboxSnapshot !== undefined);
    }
    setInboxLoading(false);
  }, [inboxSnapshot]);

  const loadOlderWork = async () => {
    const id = selectedManagedPrId,
      offset = managedWork?.nextOffset;
    if (id === undefined || offset === undefined || historyBusyRef.current)
      return;
    const generation = ++historyGeneration.current;
    historyBusyRef.current = true;
    setHistoryBusy(true);
    try {
      const response = await window.prmonitor?.readManagedPrWork(id, offset);
      if (
        generation !== historyGeneration.current ||
        currentRoute.current.selectedManagedPrId !== id
      )
        return;
      if (
        response?.ok &&
        response.value.kind === "managed-pr-work" &&
        response.value.work.managedPrId === id
      ) {
        const next = response.value.work;
        setManagedWork((current) =>
          current === undefined
            ? next
            : {
                ...next,
                reviews: [
                  ...new Map(
                    [...current.reviews, ...next.reviews].map((item) => [
                      item.bundleId,
                      item,
                    ]),
                  ).values(),
                ],
                synchronization: [
                  ...new Map(
                    [...current.synchronization, ...next.synchronization].map(
                      (item) => [item.resultId, item],
                    ),
                  ).values(),
                ],
              },
        );
      } else
        setDetailError(
          "Older saved work could not be read. Try Load older saved work again.",
        );
    } catch {
      if (generation === historyGeneration.current)
        setDetailError(
          "Older saved work could not be read. Try Load older saved work again.",
        );
    } finally {
      historyBusyRef.current = false;
      setHistoryBusy(false);
    }
  };

  const navigateFromInbox = useCallback(
    async (managedPrId: string, destination: "details" | "settings") => {
      const response = await window.prmonitor?.navigateManagedPr(
        managedPrId,
        destination,
      );
      if (response?.ok && response.value.kind === "navigation-target") {
        targetHandler.current(response.value.target);
        return;
      }
      setInboxError(
        response?.ok === false
          ? response.error.message
          : "Navigation was not completed safely.",
      );
    },
    [],
  );

  const commandSynchronizationSelection = useCallback(
    async (input: F24SelectionCommandInput) => {
      const bridge = window.prmonitor;
      if (bridge === undefined || synchronizationBusy) return;
      setSynchronizationBusy(true);
      try {
        const response = await bridge.commandSynchronizationSelection(input);
        if (
          response.ok &&
          response.value.kind === "synchronization-selection"
        ) {
          setSynchronizationSelection(response.value.selection);
          setSynchronizationConfirmation(undefined);
          setPreparationIntent(undefined);
          setInboxError(undefined);
        } else {
          setInboxError(
            response.ok
              ? "The synchronization selection returned an invalid result."
              : response.error.message,
          );
        }
      } catch {
        setInboxError(
          "The synchronization selection was not changed. Reload the inbox and retry.",
        );
      } finally {
        setSynchronizationBusy(false);
      }
    },
    [synchronizationBusy],
  );

  const openSynchronization = useCallback(async () => {
    const bridge = window.prmonitor;
    if (bridge === undefined || synchronizationBusy) return;
    setSynchronizationBusy(true);
    setPreparationIntent(undefined);
    try {
      const response = await bridge.resolveSynchronization();
      if (
        response.ok &&
        response.value.kind === "synchronization-confirmation"
      ) {
        setSynchronizationConfirmation(response.value.confirmation);
        setInboxError(undefined);
      } else {
        setInboxError(
          response.ok
            ? "The synchronization summary returned an invalid result."
            : response.error.message,
        );
      }
    } catch {
      setInboxError(
        "The synchronization summary could not be resolved. Retry after refreshing the inbox.",
      );
    } finally {
      setSynchronizationBusy(false);
    }
  }, [synchronizationBusy]);

  const confirmSynchronizationPreparation = useCallback(async () => {
    const bridge = window.prmonitor;
    const confirmation = synchronizationConfirmation;
    if (
      bridge === undefined ||
      confirmation === undefined ||
      confirmingPreparation
    )
      return;
    setConfirmingPreparation(true);
    try {
      const response = await bridge.confirmSynchronizationPreparation(
        confirmation.resolutionRevision,
      );
      if (response.ok && response.value.kind === "synchronization-intent") {
        setPreparationIntent(response.value.intent);
        setInboxError(undefined);
      } else {
        setInboxError(
          response.ok
            ? "The preparation intent returned an invalid result."
            : response.error.message,
        );
      }
    } catch {
      setInboxError(
        "Preparation was not confirmed. Review the current synchronization summary and retry.",
      );
    } finally {
      setConfirmingPreparation(false);
    }
  }, [confirmingPreparation, synchronizationConfirmation]);

  const focusAddPr = useCallback(() => {
    document
      .querySelector<HTMLInputElement>(
        'form[aria-label="Add a pull request"] input',
      )
      ?.focus();
  }, []);

  const focusStatus = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    statusRef.current?.focus();
  }, []);

  const refreshSettings = useCallback(async () => {
    const response = await window.prmonitor?.readGithubSettings();
    if (response?.ok && response.value.kind === "github-settings")
      setSettings(response.value.settings);
  }, []);

  const refreshManagedPrs = useCallback(async () => {
    const response = await window.prmonitor?.readManagedPrs();
    if (response?.ok && response.value.kind === "managed-pr-list") {
      setManagedPrs(response.value.value.managedPrs);
      setAddAttempts(response.value.value.attempts);
      return response.value.value.managedPrs;
    }
    return undefined;
  }, []);

  useEffect(() => {
    const reader = createPrDetailReader(
      {
        details: (id) =>
          window.prmonitor?.readManagedPr(id) ?? Promise.resolve(undefined),
        candidates: (id) =>
          window.prmonitor?.readManagedPrCandidates(id) ??
          Promise.resolve(undefined),
        work: (id) =>
          window.prmonitor?.readManagedPrWork(id) ?? Promise.resolve(undefined),
      },
      (next) => {
        setManagedDetails(next.details);
        setManagedWork(next.work);
        setManagedCandidates(next.candidates);
        setDetailError(next.error);
        if (next.details !== undefined) {
          const pr = next.details,
            saved = prDrafts.current.get(next.selectedId);
          setPrDraftScope(next.selectedId);
          setPrContext(saved?.context ?? pr.configuration.context ?? "");
          setPrOverride(
            saved?.override ?? pr.configuration.syncSourceBranchOverride ?? "",
          );
          setPrClonePath(saved?.clone ?? pr.localClone?.canonicalRoot ?? "");
        }
      },
    );
    detailReader.current = reader;
    return () => {
      reader.dispose();
      detailReader.current = undefined;
    };
  }, []);
  const openManagedPr = useCallback(async (managedPrId: string) => {
    ++historyGeneration.current;
    const draft = currentPrDraft.current;
    prDrafts.current.set(draft.scope, {
      context: draft.context,
      override: draft.override,
      clone: draft.clone,
    });
    await detailReader.current?.load(managedPrId);
  }, []);

  targetHandler.current = (target: OpenTarget) => {
    setRoute((current) => routeOpenTarget(current, target));
    if (target.kind === "HOME") {
      void readSetup();
      return;
    }
    const targetId = target.id;
    if (targetId === undefined) return;
    if (
      target.kind === "REVIEW_BUNDLE" ||
      target.kind === "SYNCHRONIZATION_RESULT"
    ) {
      const read =
        target.kind === "REVIEW_BUNDLE"
          ? window.prmonitor?.readReviewBundle(targetId)
          : window.prmonitor?.readSynchronizationReviewResult(targetId);
      void read
        ?.then((response) => {
          const owner = response?.ok
            ? response.value.kind === "review-bundle-workspace"
              ? response.value.workspace.managedPrId
              : response.value.kind === "synchronization-review-result"
                ? response.value.result.managedPrId
                : undefined
            : undefined;
          if (
            owner !== undefined &&
            managedPrs.some((pr) => pr.id === owner) &&
            currentRoute.current.target === target
          ) {
            setRoute((current) =>
              current.target === target
                ? { ...current, selectedManagedPrId: owner }
                : current,
            );
            void openManagedPr(owner);
          }
        })
        .catch(() => undefined);
    }

    if (target.kind === "MANAGED_PR" || target.kind === "MANAGED_PR_SETTINGS")
      void openManagedPr(targetId);
    if (target.kind === "REVIEW_BUNDLE")
      setVisitedReviews((current) =>
        current.includes(targetId) ? current : [...current, targetId],
      );
    if (
      target.kind === "SYNCHRONIZATION_BATCH" ||
      target.kind === "SYNCHRONIZATION_RESULT"
    )
      setVisitedSync((current) =>
        current.some(
          (item) => item.kind === target.kind && item.id === target.id,
        )
          ? current
          : [...current, target],
      );
  };
  useEffect(() => {
    if (inboxSnapshot !== undefined) {
      const ids = inboxSnapshot.cards.map((card) => card.id);
      const selected = currentRoute.current.selectedManagedPrId;
      if (
        selected !== undefined &&
        priorInboxIds.current.includes(selected) &&
        !ids.includes(selected)
      ) {
        detailReader.current?.invalidate();
        ++historyGeneration.current;
        setManagedDetails(undefined);
        setManagedWork(undefined);
        setManagedCandidates([]);
      }
      priorInboxIds.current = ids;
      setRoute((current) =>
        routeAfterPrRemoval(
          current,
          inboxSnapshot.cards.map((card) => card.id),
        ),
      );
    }
  }, [inboxSnapshot]);
  useEffect(() => {
    if (state === undefined) return;
    let active = true;
    const read = async () => {
      try {
        const response = await window.prmonitor?.readScheduler();
        if (
          active &&
          response?.ok &&
          response.value.kind === "scheduler-snapshot"
        )
          setScheduler(response.value.snapshot);
      } catch {
        if (active)
          setSchedulerMessage(
            "Monitoring status could not be read. Check Connection and work status.",
          );
      }
    };
    void read();
    const timer = setInterval(() => void read(), 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [state !== undefined]);
  const schedulerCommand = async (command: "check" | "pause" | "resume") => {
    const bridge = window.prmonitor;
    if (bridge === undefined || schedulerBusyRef.current) return;
    schedulerBusyRef.current = true;
    setSchedulerBusy(true);
    setSchedulerMessage("");
    try {
      const response = await (command === "check"
        ? bridge.checkSchedulerNow()
        : command === "pause"
          ? bridge.pauseWatching(scheduler?.pause.revision)
          : bridge.resumeWatching(scheduler?.pause.revision));
      if (response.ok && response.value.kind === "scheduler-operation") {
        setScheduler(response.value.operation.snapshot);
        setSchedulerMessage(
          command === "check"
            ? "The check request was recorded. Existing waiting and review rules still apply."
            : response.value.operation.snapshot.pause.paused
              ? "Watching is paused."
              : "Watching has resumed.",
        );
      } else
        setSchedulerMessage(
          "The monitoring command could not complete. Refresh the Inbox and try again.",
        );
    } catch {
      setSchedulerMessage(
        "The monitoring command could not complete. Check Connection and work status.",
      );
    } finally {
      schedulerBusyRef.current = false;
      setSchedulerBusy(false);
    }
  };

  const operationMessage = useCallback(
    (operation: {
      readonly status: string;
      readonly reason?: {
        readonly what: string;
        readonly why: string;
        readonly nextAction: string;
      };
    }) => {
      if (operation.reason === undefined)
        return `Managed PR operation ${operation.status.toLowerCase().replaceAll("_", " ")}.`;
      return `${operation.reason.what} ${operation.reason.why} Next action: ${operation.reason.nextAction.toLowerCase().replaceAll("_", " ")}.`;
    },
    [],
  );

  const addManagedPr = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const bridge = window.prmonitor;
      if (bridge === undefined || busy || selectedProfileId === undefined)
        return;
      setBusy(true);
      setManagedMessage("");
      try {
        const response = await bridge.addManagedPr({
          serverId: selectedProfileId,
          url: prUrl,
          context: addContext,
          syncSourceBranchOverride: addOverride,
          ...(addClonePath.length === 0
            ? {}
            : { localClonePath: addClonePath }),
        });
        if (!response.ok || response.value.kind !== "managed-pr-operation") {
          setManagedMessage(
            response.ok
              ? "The Add PR operation returned an invalid result."
              : response.error.message,
          );
        } else {
          setManagedMessage(operationMessage(response.value.operation));
          if (
            response.value.operation.managedPr !== undefined &&
            (currentRoute.current.selectedManagedPrId ===
              response.value.operation.managedPr.id ||
              currentRoute.current.destination === "managed")
          ) {
            setManagedDetails(response.value.operation.managedPr);
            setSelectedManagedPrId(response.value.operation.managedPr.id);
          }
          await refreshManagedPrs();
        }
      } catch {
        setManagedMessage(
          "The Add PR operation failed safely. Retry from the persisted state.",
        );
      } finally {
        setBusy(false);
      }
    },
    [
      busy,
      operationMessage,
      addClonePath,
      addContext,
      addOverride,
      prUrl,
      refreshManagedPrs,
      selectedProfileId,
    ],
  );

  const browseForClone = useCallback(async (scope: "add" | "pr") => {
    const owner = currentPrDraft.current.scope;
    const response = await window.prmonitor?.pickManagedPrFolder();
    if (
      response?.ok &&
      response.value.kind === "managed-pr-folder" &&
      response.value.path !== undefined
    ) {
      if (scope === "add") setAddClonePath(response.value.path);
      else if (currentPrDraft.current.scope === owner)
        setPrClonePath(response.value.path);
      else {
        const draft = prDrafts.current.get(owner);
        if (draft !== undefined)
          prDrafts.current.set(owner, { ...draft, clone: response.value.path });
      }
    }
  }, []);

  const saveManagedConfiguration = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const bridge = window.prmonitor;
      if (
        bridge === undefined ||
        busy ||
        managedDetails === undefined ||
        prDraftScope !== managedDetails.id ||
        selectedManagedPrId !== managedDetails.id
      )
        return;
      setBusy(true);
      setManagedMessage("");
      try {
        const response = await bridge.saveManagedPrConfiguration({
          managedPrId: managedDetails.id,
          expectedVersion: managedDetails.version,
          context: prContext,
          syncSourceBranchOverride: prOverride,
        });
        if (!response.ok || response.value.kind !== "managed-pr-operation") {
          setManagedMessage(
            response.ok
              ? "The configuration operation returned an invalid result."
              : response.error.message,
          );
        } else {
          setManagedMessage(operationMessage(response.value.operation));
          if (
            response.value.operation.managedPr !== undefined &&
            (currentRoute.current.selectedManagedPrId ===
              response.value.operation.managedPr.id ||
              currentRoute.current.destination === "managed")
          )
            setManagedDetails(response.value.operation.managedPr);
          await refreshManagedPrs();
        }
      } catch {
        setManagedMessage(
          "The configuration was not saved. Reload the managed PR and retry.",
        );
      } finally {
        setBusy(false);
      }
    },
    [
      busy,
      managedDetails,
      operationMessage,
      prContext,
      prOverride,
      prDraftScope,
      selectedManagedPrId,
      refreshManagedPrs,
    ],
  );

  const attachClone = useCallback(async () => {
    const bridge = window.prmonitor;
    if (
      bridge === undefined ||
      busy ||
      managedDetails === undefined ||
      prClonePath.length === 0
    )
      return;
    setBusy(true);
    setManagedMessage("");
    try {
      const response = await bridge.attachManagedPrClone({
        managedPrId: managedDetails.id,
        expectedVersion: managedDetails.version,
        path: prClonePath,
      });
      if (!response.ok || response.value.kind !== "managed-pr-operation")
        setManagedMessage(
          response.ok
            ? "The clone operation returned an invalid result."
            : response.error.message,
        );
      else {
        setManagedMessage(operationMessage(response.value.operation));
        if (
          response.value.operation.managedPr !== undefined &&
          (currentRoute.current.selectedManagedPrId ===
            response.value.operation.managedPr.id ||
            currentRoute.current.destination === "managed")
        )
          setManagedDetails(response.value.operation.managedPr);
        await refreshManagedPrs();
      }
    } catch {
      setManagedMessage(
        "The local clone was not attached. Choose another existing clone and retry.",
      );
    } finally {
      setBusy(false);
    }
  }, [busy, managedDetails, operationMessage, prClonePath, refreshManagedPrs]);

  const clearClone = useCallback(async () => {
    const bridge = window.prmonitor;
    if (bridge === undefined || busy || managedDetails === undefined) return;
    setBusy(true);
    setManagedMessage("");
    try {
      const response = await bridge.clearManagedPrClone(
        managedDetails.id,
        managedDetails.version,
      );
      if (!response.ok || response.value.kind !== "managed-pr-operation")
        setManagedMessage(
          response.ok
            ? "The clone operation returned an invalid result."
            : response.error.message,
        );
      else {
        setManagedMessage(operationMessage(response.value.operation));
        if (
          response.value.operation.managedPr !== undefined &&
          (currentRoute.current.selectedManagedPrId ===
            response.value.operation.managedPr.id ||
            currentRoute.current.destination === "managed")
        ) {
          setManagedDetails(response.value.operation.managedPr);
          setPrClonePath("");
        }
        await refreshManagedPrs();
      }
    } catch {
      setManagedMessage(
        "The local clone was not cleared. Reload the managed PR and retry.",
      );
    } finally {
      setBusy(false);
    }
  }, [busy, managedDetails, operationMessage, refreshManagedPrs]);

  const saveAndTest = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const bridge = window.prmonitor;
      if (bridge === undefined || busy) return;
      setBusy(true);
      setFormMessage("");
      try {
        const profileResponse = await bridge.upsertGithubProfile({
          displayName,
          serverUrl,
        });
        if (
          !profileResponse.ok ||
          profileResponse.value.kind !== "github-profile"
        ) {
          setFormMessage(
            profileResponse.ok
              ? "The profile could not be saved."
              : profileResponse.error.message,
          );
          return;
        }
        const profile = profileResponse.value.profile;
        setSelectedProfileId(profile.id);
        const tokenInput = tokenInputRef.current;
        const token = tokenInput?.value ?? "";
        if (token.length === 0) {
          setFormMessage(
            "Server profile saved. Enter a protected access value to test it.",
          );
          return;
        }
        const credentialResponse = await bridge.submitGithubCredential(
          profile.id,
          token,
        );
        if (!credentialResponse.ok)
          setFormMessage(credentialResponse.error.message);
        else setFormMessage("The protected connection operation was recorded.");
        await refreshSettings();
      } catch {
        setFormMessage(
          "The server profile operation failed safely. Retry from this window.",
        );
      } finally {
        if (tokenInputRef.current !== null) tokenInputRef.current.value = "";
        setBusy(false);
      }
    },
    [busy, displayName, refreshSettings, serverUrl],
  );

  const runProfileAction = useCallback(
    async (action: "test" | "remove", profile: GithubServerProfileView) => {
      const bridge = window.prmonitor;
      if (bridge === undefined || busy) return;
      setBusy(true);
      try {
        const response =
          action === "test"
            ? await bridge.testGithubConnection(profile.id)
            : await bridge.removeGithubProfile(profile.id);
        if (!response.ok) setFormMessage(response.error.message);
        else
          setFormMessage(
            action === "test"
              ? "Connection test completed."
              : "Profile removal completed.",
          );
        await refreshSettings();
      } catch {
        setFormMessage(
          "The server action failed safely. Retry from this window.",
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, refreshSettings],
  );

  const runOperationAction = useCallback(
    async (
      action: "retry" | "cleanup",
      operation: GithubCredentialOperationView,
    ) => {
      const bridge = window.prmonitor;
      if (bridge === undefined || busy) return;
      setBusy(true);
      try {
        const response =
          action === "retry"
            ? await bridge.retryGithubOperation(operation.id)
            : await bridge.cleanupGithubOperation(operation.id);
        if (!response.ok) setFormMessage(response.error.message);
        else setFormMessage("The recovery operation completed.");
        await refreshSettings();
      } catch {
        setFormMessage(
          "The recovery operation failed safely. Retry from this window.",
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, refreshSettings],
  );

  const selectedProfile = settings?.profiles.find(
    (profile) => profile.id === selectedProfileId,
  );
  const landing = setupLanding(
    destination,
    setupLoading || setupError !== undefined ? undefined : setupReadiness,
  );
  const remediate = (target: SetupDestination) => {
    setSettingsCategory(
      target === "local" ? "operational" : target === "ai" ? "tasks" : target,
    );
    setDestination("settings");
    const id =
      target === "github"
        ? "server-settings-heading"
        : target === "tasks" || target === "ai"
          ? "task-profiles-heading"
          : target === "policy"
            ? "policy-heading"
            : "operational-heading";
    requestAnimationFrame(() => {
      const heading = document.getElementById(id);
      heading?.setAttribute("tabindex", "-1");
      heading?.focus();
      heading?.scrollIntoView({ block: "start" });
    });
  };
  useEffect(() => {
    const id =
      landing === "activity"
        ? "activity-heading"
        : landing === "settings"
          ? "preferences-heading"
          : landing === "github"
            ? "server-settings-heading"
            : landing === "diagnostics"
              ? "support-diagnostics-heading"
              : landing === "managed"
                ? "managed-pr-heading"
                : landing === "target"
                  ? "review-bundle-heading"
                  : landing === "inbox"
                    ? "managed-pr-inbox-heading"
                    : undefined;
    if (id === undefined) return;
    const heading = document.getElementById(id);
    heading?.setAttribute("tabindex", "-1");
    heading?.focus();
  }, [landing]);

  const githubPanel = (
    <>
      <section
        className="server-settings"
        aria-labelledby="server-settings-heading"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Secure access</p>
            <h2 id="server-settings-heading">GitHub servers</h2>
          </div>
          <span className="store-state" aria-label="Secure storage status">
            {settings === undefined
              ? "loading"
              : `secure storage ${settings.secureStore.state.toLowerCase()}`}
          </span>
        </div>
        <p className="section-help">
          Server identity is saved separately from the masked access value.
          Connection tests are read-only.
        </p>
        <form
          className="server-form"
          aria-label="Add or update GitHub server"
          onSubmit={(event) => void saveAndTest(event)}
        >
          <label>
            Display name
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="off"
              maxLength={120}
              placeholder="Company GitHub"
            />
          </label>
          <label>
            HTTPS server origin
            <input
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
              autoComplete="url"
              inputMode="url"
              maxLength={2048}
              placeholder="https://github.com or https://github.company.example"
            />
          </label>
          <label>
            Personal access value
            <input
              ref={tokenInputRef}
              type="password"
              autoComplete="new-password"
              maxLength={4096}
              aria-describedby="server-token-help"
            />
          </label>
          <p id="server-token-help" className="field-help">
            This masked field is cleared after submission and is never shown in
            server status.
          </p>
          <button type="submit" disabled={busy}>
            Save and Test
          </button>
        </form>
        {formMessage !== "" ? (
          <p className="form-message" role="status" aria-live="polite">
            {formMessage}
          </p>
        ) : null}
        {settings?.profiles.length === 0 ? (
          <p className="empty-state">
            No GitHub server profiles are configured yet.
          </p>
        ) : (
          <div className="profile-list" aria-label="Configured GitHub servers">
            {settings?.profiles.map((profile) => (
              <article
                className={`profile-card${selectedProfile?.id === profile.id ? " profile-card-selected" : ""}`}
                key={profile.id}
              >
                <div className="profile-card-heading">
                  <div>
                    <h3>{profile.displayName}</h3>
                    <p>{profile.webOrigin}</p>
                  </div>
                  <span
                    className={`status-pill status-${profile.status.toLowerCase()}`}
                  >
                    {statusLabel(profile)}
                  </span>
                </div>
                <dl className="profile-details">
                  <div>
                    <dt>API base</dt>
                    <dd>{profile.apiBaseUrl}</dd>
                  </div>
                  <div>
                    <dt>Account</dt>
                    <dd>{profile.accountLogin ?? "Not verified"}</dd>
                  </div>
                </dl>
                {profile.reason !== undefined ? (
                  <p className="profile-reason" role="status">
                    {profile.reason.message} Next action:{" "}
                    {profile.reason.nextAction
                      .toLowerCase()
                      .replaceAll("_", " ")}
                    .
                  </p>
                ) : null}
                <div className="profile-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void runProfileAction("test", profile)}
                  >
                    Test Connection
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => void runProfileAction("remove", profile)}
                  >
                    Remove
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
        {settings?.operations.length ? (
          <div className="operation-list" aria-label="Recovery operations">
            <h3>Operations needing attention</h3>
            {settings.operations.map((operation) => (
              <div className="operation-row" key={operation.id}>
                <span>
                  {operation.kind.toLowerCase().replaceAll("_", " ")} ·{" "}
                  {operation.phase.toLowerCase().replaceAll("_", " ")}
                </span>
                {operationNeedsAction(operation) ? (
                  <div className="profile-actions">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void runOperationAction("retry", operation)
                      }
                    >
                      Retry
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      onClick={() =>
                        void runOperationAction("cleanup", operation)
                      }
                    >
                      Clean up
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </>
  );
  const addPanel = (
    <>
      <section
        className="managed-pr-settings"
        aria-labelledby="managed-pr-heading"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Managed pull requests</p>
            <h2 id="managed-pr-heading">Add PR</h2>
          </div>
          <span className="store-state" aria-label="Managed pull request count">
            {managedPrs.length} tracked
          </span>
        </div>
        <p className="section-help">
          Adding a URL records the remote identity first. A local clone is
          optional and is inspected without fetch, checkout, reset, or cleanup.
        </p>
        <form
          className="managed-pr-form"
          aria-label="Add a pull request"
          onSubmit={(event) => void addManagedPr(event)}
        >
          <label>
            Verified GitHub server
            <select
              value={selectedProfileId ?? ""}
              onChange={(event) => setSelectedProfileId(event.target.value)}
            >
              <option value="">Choose a server</option>
              {settings?.profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.displayName} ·{" "}
                  {profile.status.toLowerCase().replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            Pull-request URL
            <input
              value={prUrl}
              onChange={(event) => setPrUrl(event.target.value)}
              maxLength={2048}
              inputMode="url"
              autoComplete="off"
              aria-describedby="managed-pr-url-help"
              placeholder="https://github.com/owner/repository/pull/123"
            />
          </label>
          <p id="managed-pr-url-help" className="field-help">
            Use the selected server origin and the form
            /owner/repository/pull/number.
          </p>
          <details className="optional-pr-settings">
            <summary>Optional PR settings</summary>{" "}
            <label>
              PR Intent / Context{" "}
              <span className="label-optional">(optional)</span>
              <textarea
                value={addContext}
                onChange={(event) => setAddContext(event.target.value)}
                maxLength={32 * 1024}
                rows={4}
              />
            </label>
            <label>
              Synchronization source branch{" "}
              <span className="label-optional">(optional)</span>
              <input
                value={addOverride}
                onChange={(event) => setAddOverride(event.target.value)}
                maxLength={255}
                autoComplete="off"
                placeholder="Leave blank to use the PR base branch later"
              />
            </label>
            <label>
              Existing local clone{" "}
              <span className="label-optional">(optional)</span>
              <input
                value={addClonePath}
                onChange={(event) => setAddClonePath(event.target.value)}
                maxLength={4096}
                autoComplete="off"
                placeholder="Leave blank to add without a local clone"
              />
            </label>
          </details>{" "}
          <div className="profile-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => void browseForClone("add")}
            >
              Browse for clone
            </button>
            <button
              type="submit"
              disabled={
                busy || selectedProfileId === undefined || prUrl.length === 0
              }
            >
              Add Pull Request
            </button>
          </div>
        </form>
        {managedMessage !== "" ? (
          <p className="form-message" role="status" aria-live="polite">
            {managedMessage}
          </p>
        ) : null}
        {addAttempts.some((attempt) => attempt.status !== "SUCCEEDED") ? (
          <div
            className="managed-pr-attempts"
            aria-label="Add pull request recovery attempts"
          >
            <h3>Add PR attempts needing attention</h3>
            {addAttempts
              .filter((attempt) => attempt.status !== "SUCCEEDED")
              .map((attempt) => (
                <div className="operation-row" key={attempt.id}>
                  <span>
                    {attempt.normalizedUrl} ·{" "}
                    {attempt.status.toLowerCase().replaceAll("_", " ")}
                    {attempt.reason === undefined
                      ? ""
                      : ` · ${attempt.reason.what}`}
                  </span>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={async () => {
                      const response =
                        await window.prmonitor?.retryManagedPrAdd(attempt.id);
                      if (
                        response?.ok &&
                        response.value.kind === "managed-pr-operation"
                      ) {
                        setManagedMessage(
                          operationMessage(response.value.operation),
                        );
                        if (
                          response.value.operation.managedPr !== undefined &&
                          (currentRoute.current.selectedManagedPrId ===
                            response.value.operation.managedPr.id ||
                            currentRoute.current.destination === "managed")
                        )
                          setManagedDetails(response.value.operation.managedPr);
                        await refreshManagedPrs();
                      }
                    }}
                  >
                    Retry
                  </button>
                </div>
              ))}
          </div>
        ) : null}
      </section>
    </>
  );
  const prSettingsPanel = (
    <>
      {managedDetails !== undefined ? (
        <article
          className="managed-pr-details"
          aria-labelledby="managed-pr-details-heading"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">Persisted details</p>
              <h3 id="managed-pr-details-heading">
                {managedDetails.owner}/{managedDetails.repositoryName} #
                {managedDetails.number}
              </h3>
            </div>
            <span className="status-pill">
              revision {managedDetails.configuration.revision}
            </span>
          </div>
          <p className="section-help">
            This record keeps the PR repository and branch revisions. The
            repository default branch does not change the synchronization
            source. Leave the override blank to use the PR base branch.
          </p>
          <dl className="profile-details">
            <div>
              <dt>Canonical URL</dt>
              <dd>{managedDetails.canonicalUrl}</dd>
            </div>
            <div>
              <dt>Base repository / branch</dt>
              <dd>
                {managedDetails.baseRepository.owner}/
                {managedDetails.baseRepository.name} ·{" "}
                {managedDetails.prBaseBranch} · {managedDetails.prBaseSha}
              </dd>
            </div>
            <div>
              <dt>Head repository / branch</dt>
              <dd>
                {managedDetails.headRepository.available
                  ? `${managedDetails.headRepository.owner ?? ""}/${managedDetails.headRepository.name ?? ""}`
                  : `unavailable (${managedDetails.headRepository.reason})`}{" "}
                · {managedDetails.prHeadBranch} · {managedDetails.prHeadSha}
              </dd>
            </div>
            <div>
              <dt>Repository default branch</dt>
              <dd>
                {managedDetails.defaultBranch ?? "Not reported"} (informational)
              </dd>
            </div>
          </dl>
          <form
            className="managed-pr-form"
            aria-label="Edit pull request configuration"
            onSubmit={(event) => void saveManagedConfiguration(event)}
          >
            <label>
              PR Intent / Context
              <textarea
                value={prContext}
                onChange={(event) => setPrContext(event.target.value)}
                maxLength={32 * 1024}
                rows={4}
              />
            </label>
            <label>
              Synchronization source branch
              <input
                value={prOverride}
                onChange={(event) => setPrOverride(event.target.value)}
                maxLength={255}
                autoComplete="off"
              />
            </label>
            <div className="profile-actions">
              <button type="submit" disabled={busy}>
                Save new configuration revision
              </button>
            </div>
          </form>
          <div className="clone-panel">
            <h4>
              Local clone setup:{" "}
              {managedDetails.localSetupStatus
                .toLowerCase()
                .replaceAll("_", " ")}
            </h4>
            <label>
              Existing local clone path
              <input
                value={prClonePath}
                onChange={(event) => setPrClonePath(event.target.value)}
                maxLength={4096}
                autoComplete="off"
              />
            </label>
            {managedCandidates.length > 0 ? (
              <div
                className="clone-candidates"
                aria-label="Known local clone candidates"
              >
                <h5>Known candidates</h5>
                {managedCandidates.map((candidate) => (
                  <button
                    type="button"
                    className="link-button"
                    key={candidate.canonicalRoot}
                    onClick={() => setPrClonePath(candidate.canonicalRoot)}
                  >
                    {candidate.canonicalRoot} ·{" "}
                    {candidate.status.toLowerCase().replaceAll("_", " ")}
                  </button>
                ))}
              </div>
            ) : (
              <p className="field-help">
                No previously validated clone candidates are known for this base
                repository.
              </p>
            )}
            <div className="profile-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => void browseForClone("pr")}
              >
                Browse
              </button>
              <button
                type="button"
                disabled={busy || prClonePath.length === 0}
                onClick={() => void attachClone()}
              >
                Validate and attach
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={busy || managedDetails.localClone === undefined}
                onClick={() => void clearClone()}
              >
                Clear clone
              </button>
            </div>
          </div>
        </article>
      ) : null}
      {managedMessage === "" ? null : <p role="status">{managedMessage}</p>}
    </>
  );
  const supportPanel = (
    <>
      {" "}
      <section
        className="server-settings support-panel"
        aria-labelledby="support-diagnostics-heading"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Support</p>
            <h2 id="support-diagnostics-heading">Safe support diagnostics</h2>
          </div>
        </div>
        <p className="section-help">
          Export a bounded report with runtime, migration, lifecycle, recovery,
          feature-health, and safe activity summaries. Credentials, prompts,
          source, diffs, and local paths are omitted.
        </p>
        <button
          type="button"
          onClick={() => void exportSupportDiagnostics()}
          disabled={supportBusy || state === undefined}
        >
          {supportBusy
            ? "Preparing diagnostics…"
            : "Export Support Diagnostics"}
        </button>
        {supportMessage !== "" ? (
          <p className="form-message" role="status" aria-live="polite">
            {supportMessage}
          </p>
        ) : null}
      </section>
    </>
  );
  const category: SettingsCategory =
    landing === "github"
      ? "github"
      : landing === "diagnostics"
        ? "support"
        : settingsCategory;
  const showingSettings = ["settings", "github", "diagnostics"].includes(
    landing,
  );
  const categories: readonly [SettingsCategory, string][] = [
    ["github", "GitHub connections"],
    ["tasks", "AI task profiles"],
    ["policy", "Execution policy"],
    ["operational", "Monitoring and work limits"],
    ["instructions", "Common instructions"],
    ["repository", "Repository build and validation"],
    ["setup", "Setup"],
    ["support", "Support diagnostics"],
  ];
  const selectedCard = inboxSnapshot?.cards.find(
    (card) => card.id === selectedManagedPrId,
  );
  const watchingStatus =
    scheduler === undefined
      ? "Monitoring status unavailable"
      : scheduler.pause.paused
        ? "Watching paused"
        : "Watching";
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href={"#" + STARTUP_STATUS_ID}
        onClick={focusStatus}
      >
        Skip to startup status
      </a>
      <header className="shell-header">
        <h1 id="startup-heading">{APPLICATION_TITLE}</h1>
        <div
          ref={statusRef}
          id={STARTUP_STATUS_ID}
          className="startup-status"
          role="status"
          aria-live="polite"
          data-prmonitor-ready={String(INITIAL_STARTUP_STATUS.ready)}
          tabIndex={0}
        >
          {state === undefined
            ? INITIAL_STARTUP_STATUS.message
            : recovery?.lifecycle.online === false
              ? "Waiting for an internet connection"
              : recovery?.scopes.some(
                    (scope) =>
                      !isEmptyRecoveryScope(scope.scope) &&
                      ["INTERRUPTED", "UNCERTAIN", "BLOCKED"].includes(
                        scope.classification,
                      ),
                  )
                ? "Saved work needs attention. Open Connection and work status."
                : (inboxSnapshot?.counts.actionNeeded ?? 0) > 0
                  ? inboxSnapshot?.counts.actionNeeded +
                    " pull requests need a decision"
                  : watchingStatus}
        </div>
      </header>
      <nav className="shell-navigation" aria-label="PRMonitor destinations">
        <button
          type="button"
          aria-current={landing === "inbox" ? "page" : undefined}
          onClick={() => {
            setDestination("home");
            void readSetup();
          }}
        >
          PR inbox
        </button>
        <button
          type="button"
          aria-current={landing === "activity" ? "page" : undefined}
          onClick={() => setDestination("activity")}
        >
          Activity
        </button>
        <button
          type="button"
          aria-current={showingSettings ? "page" : undefined}
          onClick={() => setDestination("settings")}
        >
          Settings
        </button>
        <p>Application</p>
        <button
          type="button"
          aria-current={landing === "connection" ? "page" : undefined}
          onClick={() => setDestination("connection")}
        >
          Connection and work status
        </button>
        <button
          type="button"
          aria-current={landing === "setup" ? "page" : undefined}
          onClick={() => {
            setDestination("setup");
            void readSetup();
          }}
        >
          Setup
        </button>
      </nav>
      <main className="shell-content" aria-labelledby="startup-heading">
        {landing !== "setup" &&
        (setupReadiness?.ready !== true || setupError !== undefined) ? (
          <p className="setup-attention" role="status">
            <button type="button" onClick={() => setDestination("setup")}>
              Setup needs attention
            </button>{" "}
            Current work and edits remain available.
          </p>
        ) : null}
        {landing === "setup" || (showingSettings && category === "setup") ? (
          <>
            <SetupScreen
              readiness={setupReadiness}
              loading={setupLoading}
              error={setupError}
              onRetry={() => void setupReader.current?.retry()}
              onAddPr={beginAddPr}
              onRemediate={remediate}
              onOpenInbox={() => setDestination("inbox")}
              onOpenDiagnostics={() => {
                setSettingsCategory("support");
                setDestination("settings");
              }}
            />
            {route.target === undefined ? null : (
              <button
                type="button"
                onClick={() => targetHandler.current(route.target!)}
              >
                Return to saved target
              </button>
            )}
          </>
        ) : null}
        {landing === "inbox" ? (
          <ManagedPrInbox
            listScrollTop={inboxScroll.current}
            onListScroll={(top) => {
              inboxScroll.current = top;
            }}
            snapshot={inboxSnapshot}
            loading={inboxLoading}
            error={inboxError}
            lastKnown={inboxLastKnown}
            onRetry={() => void retryInbox()}
            onNavigate={(id, dest) => void navigateFromInbox(id, dest)}
            onAddPr={beginAddPr}
            selectedManagedPrId={selectedManagedPrId}
            selection={synchronizationSelection}
            confirmation={synchronizationConfirmation}
            preparationIntent={preparationIntent}
            selectionBusy={synchronizationBusy}
            confirmingPreparation={confirmingPreparation}
            onSelectionCommand={(input) =>
              void commandSynchronizationSelection(input)
            }
            onOpenSynchronization={() => void openSynchronization()}
            onResetSelection={() =>
              void (async () => {
                if (synchronizationBusy) return;
                setSynchronizationBusy(true);
                try {
                  const response =
                    await window.prmonitor?.resetSynchronizationSelection();
                  if (
                    response?.ok &&
                    response.value.kind === "synchronization-selection"
                  ) {
                    setSynchronizationSelection(response.value.selection);
                    setSynchronizationConfirmation(undefined);
                    setPreparationIntent(undefined);
                    setInboxError(undefined);
                  } else
                    setInboxError(
                      "Branch sync selection could not be reset. Refresh the Inbox and try again.",
                    );
                } catch {
                  setInboxError(
                    "Branch sync selection could not be reset. Refresh the Inbox and try again.",
                  );
                } finally {
                  setSynchronizationBusy(false);
                }
              })()
            }
            onConfirmPreparation={() =>
              void confirmSynchronizationPreparation()
            }
            toolbar={
              <div className="inbox-toolbar">
                <button type="button" onClick={beginAddPr}>
                  Add PR
                </button>
                <button
                  type="button"
                  disabled={schedulerBusy || scheduler === undefined}
                  onClick={() => void schedulerCommand("check")}
                >
                  Check all PRs now
                </button>
                <button
                  type="button"
                  disabled={schedulerBusy || scheduler === undefined}
                  onClick={() =>
                    void schedulerCommand(
                      scheduler?.pause.paused ? "resume" : "pause",
                    )
                  }
                >
                  {scheduler?.pause.paused
                    ? "Resume watching"
                    : "Pause watching"}
                </button>
                {schedulerMessage === "" ? null : (
                  <p role="status">{schedulerMessage}</p>
                )}
              </div>
            }
            detail={
              <PrDetail
                selectedId={selectedManagedPrId}
                card={selectedCard}
                details={managedDetails}
                work={managedWork}
                error={detailError}
                tab={route.detailTab}
                onTab={(tab: PrDetailTab) =>
                  setRoute((current) => ({ ...current, detailTab: tab }))
                }
                onBack={() => setSelectedManagedPrId(undefined)}
                onOpen={(target) => targetHandler.current(target)}
                onRetry={() =>
                  selectedManagedPrId === undefined
                    ? undefined
                    : void openManagedPr(selectedManagedPrId)
                }
                historyBusy={historyBusy}
                onMoreHistory={() => void loadOlderWork()}
                settings={prSettingsPanel}
              />
            }
          />
        ) : null}
        {landing === "managed" ? (
          <div className="focused-page">
            <button type="button" onClick={() => setDestination("inbox")}>
              Back to PR inbox
            </button>
            {addPanel}
          </div>
        ) : null}
        <ActivityViewer
          visible={landing === "activity"}
          enabled={state !== undefined && landing === "activity"}
          onAddPr={beginAddPr}
          pullRequests={managedPrs.map((pr) => ({
            id: pr.id,
            label: pr.owner + "/" + pr.repositoryName + " #" + pr.number,
          }))}
          onNavigate={(target) => targetHandler.current(target)}
        />
        {showingSettings ? (
          <section className="settings-page">
            <h2 id="settings-heading">Settings</h2>
            <nav
              className="settings-categories"
              aria-label="Settings categories"
            >
              {categories.map(([id, label]) => (
                <button
                  type="button"
                  key={id}
                  aria-pressed={category === id}
                  onClick={() => {
                    setSettingsCategory(id);
                    setDestination("settings");
                  }}
                >
                  {label}
                </button>
              ))}
            </nav>
            {category === "github" ? githubPanel : null}
            {category === "support" ? supportPanel : null}
          </section>
        ) : null}
        <Preferences
          enabled={state !== undefined}
          visible={
            showingSettings &&
            !["github", "support", "setup"].includes(category)
          }
          category={category}
        />
        {landing === "connection" ? (
          <ConnectionStatus
            pullRequests={managedPrs.map((pr) => ({
              id: pr.id,
              label: pr.owner + "/" + pr.repositoryName + " #" + pr.number,
            }))}
            projection={recovery}
            busy={recoveryBusy}
            message={recoveryMessage}
            error={recoveryError}
            onCheck={() => void requestRecovery()}
            onOpen={(scope) => {
              const prId = recoveryScopeManagedPrId(scope.scope);
              if (prId !== undefined) {
                void navigateFromInbox(prId, "details");
                return;
              }
              switch (scope.scope.kind) {
                case "managed_pr":
                  targetHandler.current(
                    savedWorkTarget("MANAGED_PR", scope.scope.id),
                  );
                  break;
                case "review_bundle":
                  targetHandler.current(
                    savedWorkTarget("REVIEW_BUNDLE", scope.scope.id),
                  );
                  break;
                case "sync_operation":
                  targetHandler.current(
                    savedWorkTarget("SYNCHRONIZATION_RESULT", scope.scope.id),
                  );
                  break;
                default:
                  setDestination("activity");
              }
            }}
          />
        ) : null}
        {landing === "target" ? (
          <button type="button" onClick={() => setDestination("inbox")}>
            Back to PR inbox
          </button>
        ) : null}
        {visitedReviews.map((id) => (
          <ReviewBundleWorkspace
            key={id}
            bundleId={id}
            activation={route.activation}
            visible={
              landing === "target" &&
              route.target?.kind === "REVIEW_BUNDLE" &&
              route.target.id === id
            }
          />
        ))}
        {visitedSync.map((target) => (
          <SynchronizationReview
            key={target.kind + ":" + target.id}
            activation={route.activation}
            onNavigate={(next) => targetHandler.current(next)}
            pullRequests={managedPrs.map((pr) => ({
              id: pr.id,
              label: pr.owner + "/" + pr.repositoryName + " #" + pr.number,
            }))}
            batchId={
              target.kind === "SYNCHRONIZATION_BATCH" ? target.id : undefined
            }
            resultId={
              target.kind === "SYNCHRONIZATION_RESULT" ? target.id : undefined
            }
            visible={
              landing === "target" &&
              route.target?.kind === target.kind &&
              route.target?.id === target.id
            }
          />
        ))}
      </main>
      <footer className="shell-footer">
        <span>{watchingStatus}</span>
        <button
          type="button"
          className="link-button"
          onClick={() => setDestination("connection")}
        >
          Connection and work status
        </button>
      </footer>
    </div>
  );
}
