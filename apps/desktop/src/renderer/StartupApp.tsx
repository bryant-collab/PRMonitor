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
  const statusRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<CurrentState | undefined>();
  const [recovery, setRecovery] = useState<F28RecoveryProjection>();
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [supportBusy, setSupportBusy] = useState(false);
  const [supportMessage, setSupportMessage] = useState("");
  const [settings, setSettings] = useState<
    GithubServerSettingsView | undefined
  >();
  const [targetLabel, setTargetLabel] = useState("home");
  const [reviewBundleId, setReviewBundleId] = useState<string>();
  const [synchronizationBatchId, setSynchronizationBatchId] =
    useState<string>();
  const [synchronizationResultId, setSynchronizationResultId] =
    useState<string>();
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
  const [selectedManagedPrId, setSelectedManagedPrId] = useState<string>();
  const [managedDetails, setManagedDetails] = useState<ManagedPrReadModel>();
  const [managedCandidates, setManagedCandidates] = useState<
    readonly ManagedPrCandidateView[]
  >([]);
  const [managedMessage, setManagedMessage] = useState("");
  const [prUrl, setPrUrl] = useState("");
  const [prContext, setPrContext] = useState("");
  const [prOverride, setPrOverride] = useState("");
  const [prClonePath, setPrClonePath] = useState("");
  const [inboxSnapshot, setInboxSnapshot] = useState<ManagedPrInboxReadModel>();
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
      if (!active) return;
      if (target.kind === "REVIEW_BUNDLE" && target.id !== undefined)
        setReviewBundleId(target.id);
      if (target.kind === "SYNCHRONIZATION_BATCH" && target.id !== undefined) {
        setSynchronizationBatchId(target.id);
        setSynchronizationResultId(undefined);
      }
      if (target.kind === "SYNCHRONIZATION_RESULT" && target.id !== undefined) {
        setSynchronizationResultId(target.id);
        setSynchronizationBatchId(undefined);
      }
      setTargetLabel(
        target.kind === "HOME"
          ? "home"
          : `${target.kind.toLowerCase()}:${target.id ?? ""}`,
      );
    });
    return () => {
      active = false;
      unsubscribe();
      unsubscribeInbox();
    };
  }, []);

  const requestRecovery = useCallback(async () => {
    const bridge = window.prmonitor;
    if (bridge === undefined || recoveryBusy) return;
    setRecoveryBusy(true);
    try {
      const response = await bridge.requestRecovery();
      if (response.ok && response.value.kind === "recovery")
        setRecovery(response.value.projection);
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

  const navigateFromInbox = useCallback(
    async (managedPrId: string, destination: "details" | "settings") => {
      const response = await window.prmonitor?.navigateManagedPr(
        managedPrId,
        destination,
      );
      if (response?.ok && response.value.kind === "navigation-target") {
        setTargetLabel(
          `${response.value.target.kind.toLowerCase()}:${response.value.target.id ?? ""}`,
        );
        if (destination === "details") void openManagedPr(managedPrId);
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

  const openManagedPr = useCallback(async (managedPrId: string) => {
    const response = await window.prmonitor?.readManagedPr(managedPrId);
    if (
      response?.ok &&
      response.value.kind === "managed-pr-details" &&
      response.value.managedPr !== null
    ) {
      setSelectedManagedPrId(managedPrId);
      setManagedDetails(response.value.managedPr);
      setPrContext(response.value.managedPr.configuration.context ?? "");
      setPrOverride(
        response.value.managedPr.configuration.syncSourceBranchOverride ?? "",
      );
      setPrClonePath(response.value.managedPr.localClone?.canonicalRoot ?? "");
      setManagedCandidates([]);
      const candidatesResponse =
        await window.prmonitor?.readManagedPrCandidates(managedPrId);
      if (
        candidatesResponse?.ok &&
        candidatesResponse.value.kind === "managed-pr-candidates"
      )
        setManagedCandidates(candidatesResponse.value.value.candidates);
    }
  }, []);

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
          context: prContext,
          syncSourceBranchOverride: prOverride,
          ...(prClonePath.length === 0 ? {} : { localClonePath: prClonePath }),
        });
        if (!response.ok || response.value.kind !== "managed-pr-operation") {
          setManagedMessage(
            response.ok
              ? "The Add PR operation returned an invalid result."
              : response.error.message,
          );
        } else {
          setManagedMessage(operationMessage(response.value.operation));
          if (response.value.operation.managedPr !== undefined) {
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
      prClonePath,
      prContext,
      prOverride,
      prUrl,
      refreshManagedPrs,
      selectedProfileId,
    ],
  );

  const browseForClone = useCallback(async () => {
    const response = await window.prmonitor?.pickManagedPrFolder();
    if (
      response?.ok &&
      response.value.kind === "managed-pr-folder" &&
      response.value.path !== undefined
    )
      setPrClonePath(response.value.path);
  }, []);

  const saveManagedConfiguration = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const bridge = window.prmonitor;
      if (bridge === undefined || busy || managedDetails === undefined) return;
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
          if (response.value.operation.managedPr !== undefined)
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
        if (response.value.operation.managedPr !== undefined)
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
        if (response.value.operation.managedPr !== undefined) {
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

  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href={`#${STARTUP_STATUS_ID}`}
        onClick={focusStatus}
      >
        Skip to startup status
      </a>
      <main className="startup-card" aria-labelledby="startup-heading">
        <p className="eyebrow">Desktop foundation</p>
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
            : `Main process ${state.lifecycle.phase.toLowerCase().replaceAll("_", " ")}.`}
        </div>
        <p className="scope-note">Current target: {targetLabel}.</p>
        {recovery !== undefined ? (
          <section
            className="server-settings recovery-panel"
            aria-labelledby="recovery-heading"
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">Durable recovery</p>
                <h2 id="recovery-heading">Restart and connection recovery</h2>
              </div>
              <span className="store-state" aria-label="Recovery status">
                {recovery.status.toLowerCase()}
              </span>
            </div>
            <p className="section-help" role="status" aria-live="polite">
              {recovery.summary.attention > 0
                ? `${recovery.summary.attention} item${recovery.summary.attention === 1 ? "" : "s"} need attention.`
                : recovery.summary.retrying > 0
                  ? `${recovery.summary.retrying} item${recovery.summary.retrying === 1 ? " is" : "s are"} waiting to retry safely.`
                  : "No recovery action is waiting for attention."}
            </p>
            <div className="recovery-summary" aria-label="Recovery summary">
              <span>{recovery.summary.scopes} scopes</span>
              <span>{recovery.summary.completed} completed</span>
              <span>{recovery.summary.attention} attention</span>
              <span>{recovery.summary.retrying} retrying</span>
            </div>
            {recovery.scopes.some((scope) => scope.reason !== undefined) ? (
              <ul className="recovery-list">
                {recovery.scopes
                  .filter((scope) => scope.reason !== undefined)
                  .slice(0, 8)
                  .map((scope) => (
                    <li key={scope.scopeKey}>
                      <strong>{scope.scope.kind.replaceAll("_", " ")}</strong>{" "}
                      <span>{scope.scope.id}</span>: {scope.reason?.what}
                    </li>
                  ))}
              </ul>
            ) : null}
            <button
              type="button"
              onClick={() => void requestRecovery()}
              disabled={recoveryBusy}
            >
              {recoveryBusy ? "Reconciling…" : "Reconcile now"}
            </button>
          </section>
        ) : null}
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
            Export a bounded report with runtime, migration, lifecycle,
            recovery, feature-health, and safe activity summaries. Credentials,
            prompts, source, diffs, and local paths are omitted.
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
        <ManagedPrInbox
          snapshot={inboxSnapshot}
          loading={inboxLoading}
          error={inboxError}
          lastKnown={inboxLastKnown}
          onRetry={() => void retryInbox()}
          onNavigate={(managedPrId, destination) =>
            void navigateFromInbox(managedPrId, destination)
          }
          onAddPr={focusAddPr}
          selection={synchronizationSelection}
          confirmation={synchronizationConfirmation}
          preparationIntent={preparationIntent}
          selectionBusy={synchronizationBusy}
          confirmingPreparation={confirmingPreparation}
          onSelectionCommand={(input) =>
            void commandSynchronizationSelection(input)
          }
          onOpenSynchronization={() => void openSynchronization()}
          onConfirmPreparation={() => void confirmSynchronizationPreparation()}
        />
        {reviewBundleId !== undefined ? (
          <ReviewBundleWorkspace bundleId={reviewBundleId} />
        ) : null}
        <SynchronizationReview
          batchId={synchronizationBatchId}
          resultId={synchronizationResultId}
        />
        <ActivityViewer
          enabled={state !== undefined}
          onNavigate={(target) => {
            setTargetLabel(`${target.kind.toLowerCase()}:${target.id ?? ""}`);
          }}
        />
        <Preferences enabled={state !== undefined} />
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
              This masked field is cleared after submission and is never shown
              in server status.
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
            <div
              className="profile-list"
              aria-label="Configured GitHub servers"
            >
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
        <section
          className="managed-pr-settings"
          aria-labelledby="managed-pr-heading"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">Managed pull requests</p>
              <h2 id="managed-pr-heading">Add and manage a PR</h2>
            </div>
            <span
              className="store-state"
              aria-label="Managed pull request count"
            >
              {managedPrs.length} tracked
            </span>
          </div>
          <p className="section-help">
            Adding a URL records the remote identity first. A local clone is
            optional and is inspected without fetch, checkout, reset, or
            cleanup.
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
            <label>
              PR Intent / Context{" "}
              <span className="label-optional">(optional)</span>
              <textarea
                value={prContext}
                onChange={(event) => setPrContext(event.target.value)}
                maxLength={32 * 1024}
                rows={4}
              />
            </label>
            <label>
              Synchronization source branch{" "}
              <span className="label-optional">(optional)</span>
              <input
                value={prOverride}
                onChange={(event) => setPrOverride(event.target.value)}
                maxLength={255}
                autoComplete="off"
                placeholder="Leave blank to use the PR base branch later"
              />
            </label>
            <label>
              Existing local clone{" "}
              <span className="label-optional">(optional)</span>
              <input
                value={prClonePath}
                onChange={(event) => setPrClonePath(event.target.value)}
                maxLength={4096}
                autoComplete="off"
                placeholder="Leave blank to add without a local clone"
              />
            </label>
            <div className="profile-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => void browseForClone()}
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
                          if (response.value.operation.managedPr !== undefined)
                            setManagedDetails(
                              response.value.operation.managedPr,
                            );
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
          {managedPrs.length === 0 ? (
            <p className="empty-state">
              No managed pull requests yet. Add one with a verified server
              profile.
            </p>
          ) : (
            <div className="managed-pr-list" aria-label="Managed pull requests">
              {managedPrs.map((managedPr) => (
                <article
                  className={`managed-pr-card${selectedManagedPrId === managedPr.id ? " managed-pr-card-selected" : ""}`}
                  key={managedPr.id}
                >
                  <div className="profile-card-heading">
                    <div>
                      <h3>
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => void openManagedPr(managedPr.id)}
                        >
                          {managedPr.owner}/{managedPr.repositoryName} #
                          {managedPr.number}
                        </button>
                      </h3>
                      <p>
                        {managedPr.prBaseBranch} ← {managedPr.prHeadBranch} ·{" "}
                        {managedPr.primaryState
                          .toLowerCase()
                          .replaceAll("_", " ")}
                      </p>
                    </div>
                    <span className="status-pill">
                      {managedPr.localSetupStatus
                        .toLowerCase()
                        .replaceAll("_", " ")}
                    </span>
                  </div>
                  <dl className="profile-details">
                    <div>
                      <dt>Base</dt>
                      <dd>
                        {managedPr.baseRepository.owner}/
                        {managedPr.baseRepository.name} · {managedPr.prBaseSha}
                      </dd>
                    </div>
                    <div>
                      <dt>Head</dt>
                      <dd>
                        {managedPr.headRepository.available
                          ? `${managedPr.headRepository.owner ?? ""}/${managedPr.headRepository.name ?? ""}`
                          : `unavailable (${managedPr.headRepository.reason})`}{" "}
                        · {managedPr.prHeadSha}
                      </dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          )}
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
                Remote identity and SHAs are immutable inputs to this record.
                The default branch is informational; a blank override remains
                blank.
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
                    {managedDetails.defaultBranch ?? "Not reported"}{" "}
                    (informational)
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
                    No previously validated clone candidates are known for this
                    base repository.
                  </p>
                )}
                <div className="profile-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => void browseForClone()}
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
        </section>
      </main>
    </div>
  );
}
