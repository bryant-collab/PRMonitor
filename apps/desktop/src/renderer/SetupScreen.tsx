import { HelpButton } from "./HelpControls";
import { useEffect, useRef } from "react";
import type { SetupReadinessProjection } from "../shared/setup-readiness";
import type { IpcResponse } from "../shared/ipc";

export type SetupDestination = "local" | "github" | "ai" | "tasks" | "policy";
export type SetupStep = "github" | "ai" | "permissions" | "review";
export const setupSteps: readonly [SetupStep, string][] = [
  ["github", "GitHub"],
  ["ai", "AI connection"],
  ["permissions", "Work permissions"],
  ["review", "Review and finish"],
];

export function setupInitialStep(
  readiness?: SetupReadinessProjection,
): SetupStep {
  const complete = (id: string) =>
    readiness?.checks.some(
      (check) => check.id === id && check.status === "complete",
    ) === true;
  return !complete("github-access")
    ? "github"
    : !complete("ai-access") || !complete("ai-task-configuration")
      ? "ai"
      : !complete("working-policy")
        ? "permissions"
        : "review";
}

export function canAdvanceSetup(
  step: SetupStep,
  readiness?: SetupReadinessProjection,
): boolean {
  const complete = (id: string) =>
    readiness?.checks.some(
      (check) => check.id === id && check.status === "complete",
    ) === true;
  return step === "github"
    ? complete("github-access")
    : step === "ai"
      ? complete("ai-access") && complete("ai-task-configuration")
      : step === "permissions"
        ? complete("working-policy")
        : readiness?.ready === true;
}

export function SetupFooter({
  step,
  readiness,
  loading,
  error,
  onStep,
  onRetry,
  onFinish,
}: {
  readonly step: SetupStep;
  readonly readiness?: SetupReadinessProjection;
  readonly loading: boolean;
  readonly error?: string;
  readonly onStep: (step: SetupStep) => void;
  readonly onRetry: () => void;
  readonly onFinish: () => void;
}) {
  const index = setupSteps.findIndex(([id]) => id === step);
  const pendingAction = useRef(false);
  useEffect(() => {
    pendingAction.current = false;
  }, [step, loading]);
  const advance = () => {
    if (
      pendingAction.current ||
      loading ||
      error !== undefined ||
      !canAdvanceSetup(step, readiness)
    )
      return;
    pendingAction.current = true;
    if (index === setupSteps.length - 1) onFinish();
    else onStep(setupSteps[index + 1]![0]);
  };
  const explanation = loading
    ? "Checking saved setup…"
    : error !== undefined
      ? "Setup could not be checked. Choose Check saved setup to retry."
      : !canAdvanceSetup(step, readiness)
        ? step === "review"
          ? "Finish becomes available when every saved setup check passes."
          : "Save this step's settings, then choose Check saved setup before continuing."
        : undefined;
  return (
    <div>
      {explanation ? (
        <p id="setup-step-help" className="section-help">
          {explanation}
        </p>
      ) : null}
      <div className="profile-actions">
        <HelpButton
          type="button"
          disabled={index === 0 || loading}
          onClick={() => onStep(setupSteps[index - 1]![0])}
        >
          Back
        </HelpButton>
        <HelpButton
          type="button"
          disabled={loading}
          onClick={() => {
            if (pendingAction.current || loading) return;
            pendingAction.current = true;
            onRetry();
          }}
        >
          Check saved setup
        </HelpButton>
        <HelpButton
          type="button"
          disabled={
            loading || error !== undefined || !canAdvanceSetup(step, readiness)
          }
          help={
            step === "review"
              ? "Finish after all saved setup checks pass."
              : "Save this step's settings and pass its checks before continuing."
          }
          aria-describedby={explanation ? "setup-step-help" : undefined}
          onClick={advance}
        >
          {step === "review" ? "Finish setup" : "Next"}
        </HelpButton>
      </div>
    </div>
  );
}

const labels = {
  "local-prerequisites": "Local prerequisites",
  "github-access": "GitHub connection",
  "ai-access": "AI access",
  "ai-task-configuration": "AI task configuration",
  "working-policy": "Working policy",
} as const;
const actions: Record<SetupDestination, string> = {
  local: "Review local configuration",
  github: "Add or test GitHub server",
  ai: "Configure AI access",
  tasks: "Edit independent task profiles",
  policy: "Edit working policy",
};

export function acceptSetupReadiness(
  current: SetupReadinessProjection | undefined,
  incoming: SetupReadinessProjection,
): SetupReadinessProjection {
  return current !== undefined && current.revision > incoming.revision
    ? current
    : incoming;
}

export function setupLanding(
  destination: string,
  readiness: SetupReadinessProjection | undefined,
): string {
  return destination === "home"
    ? readiness?.ready
      ? "inbox"
      : "setup"
    : destination;
}

export interface SetupReadState {
  readonly readiness?: SetupReadinessProjection;
  readonly loading: boolean;
  readonly error?: string;
}

/** Renderer-only request coordination. Configuration remains main-process authority. */
export function createSetupReader(
  read: () => Promise<IpcResponse | undefined>,
  changed: (state: SetupReadState) => void,
  timeoutMs = 10000,
  retryRead: () => Promise<IpcResponse | undefined> = read,
) {
  let active = true;
  let generation = 0;
  let state: SetupReadState = { loading: true };
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const publish = (next: SetupReadState) => {
    state = next;
    changed(state);
  };
  const updated = (projection: SetupReadinessProjection) => {
    if (
      !active ||
      (state.readiness !== undefined &&
        projection.revision < state.readiness.revision)
    )
      return;
    ++generation;
    publish({
      readiness: acceptSetupReadiness(state.readiness, projection),
      loading: false,
    });
  };
  const load = async (source: () => Promise<IpcResponse | undefined>) => {
    const request = ++generation;
    publish({ readiness: state.readiness, loading: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        source(),
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), timeoutMs);
          timers.add(timer);
        }),
      ]);
      if (!active || generation !== request) return;
      if (response?.ok && response.value.kind === "setup-readiness") {
        publish({
          readiness: acceptSetupReadiness(
            state.readiness,
            response.value.projection,
          ),
          loading: false,
        });
      } else
        publish({
          readiness: state.readiness,
          loading: false,
          error:
            response?.ok === false
              ? response.error.message
              : "Setup could not be checked. Retry to confirm readiness.",
        });
    } catch {
      if (active && generation === request)
        publish({
          readiness: state.readiness,
          loading: false,
          error: "Setup could not be checked. Retry to confirm readiness.",
        });
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
        timers.delete(timer);
      }
    }
  };
  return {
    read: () => load(read),
    retry: () => load(retryRead),
    updated,
    dispose: () => {
      active = false;
      ++generation;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}

export function SetupScreen({
  readiness,
  loading,
  error,
  onRetry,
  onRemediate,
  onOpenInbox,
  onOpenDiagnostics,
  step,
  onStep,
  showActions = true,
}: {
  readonly readiness?: SetupReadinessProjection;
  readonly loading: boolean;
  readonly error?: string;
  readonly onRetry: () => void;
  readonly onRemediate: (destination: SetupDestination) => void;
  readonly onOpenInbox: () => void;
  readonly onOpenDiagnostics?: () => void;
  readonly step?: SetupStep;
  readonly onStep?: (step: SetupStep) => void;
  readonly showActions?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const confirmedReadiness = error === undefined ? readiness : undefined;
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    if (error !== undefined) errorRef.current?.focus();
  }, [error]);
  return (
    <section
      className="setup-screen"
      aria-labelledby="setup-heading"
      aria-busy={loading}
    >
      <h2 id="setup-heading" ref={heading} tabIndex={-1}>
        Set up PRMonitor
      </h2>
      <p>
        Connect GitHub, choose AI, and set work permissions. Each saved change
        is checked again when you reopen PRMonitor.
      </p>
      {step && onStep ? (
        <nav aria-label="Setup steps" className="setup-steps">
          {setupSteps.map(([id, label], index) => (
            <HelpButton
              type="button"
              key={id}
              aria-current={step === id ? "step" : undefined}
              onClick={() => onStep(id)}
            >
              {index + 1}. {label}
            </HelpButton>
          ))}
        </nav>
      ) : null}
      {step && step !== "review" ? (
        <p className="section-help">
          {step === "github"
            ? "Add a GitHub connection and test its access below."
            : step === "ai"
              ? "Save one AI connection for all tasks. Advanced choices are optional."
              : "Choose the permissions allowed for local AI work. Publishing still requires your decision."}
        </p>
      ) : null}
      {loading ? (
        <p role="status" aria-live="polite">
          Checking setup…
        </p>
      ) : null}
      {error !== undefined ? (
        <p role="alert" ref={errorRef} tabIndex={-1}>
          {error}
        </p>
      ) : null}
      <div aria-live="polite" role="status">
        {confirmedReadiness !== undefined
          ? `${confirmedReadiness.completedCount} of ${confirmedReadiness.checks.length} checks complete; ${confirmedReadiness.checks.length - confirmedReadiness.completedCount} remaining.`
          : "Setup readiness has not been confirmed."}
      </div>
      {confirmedReadiness !== undefined &&
      (step === undefined || step === "review") ? (
        <div className="setup-checks">
          {(
            ["Local checks", "GitHub connection", "AI configuration"] as const
          ).map((group, index) => (
            <section key={group} aria-label={group}>
              <h3>{group}</h3>
              {confirmedReadiness.checks
                .filter((check) =>
                  index === 0
                    ? check.id === "local-prerequisites"
                    : index === 1
                      ? check.id === "github-access"
                      : !["local-prerequisites", "github-access"].includes(
                          check.id,
                        ),
                )
                .map((check) => (
                  <article className="setup-check" key={check.id}>
                    <h4>{labels[check.id]}</h4>
                    <p>
                      <strong>{check.status.replaceAll("-", " ")}</strong>:{" "}
                      {check.description}
                    </p>
                    {check.status !== "complete" ? (
                      <>
                        <HelpButton
                          type="button"
                          onClick={() => onRemediate(check.remediation)}
                        >
                          {actions[check.remediation]}
                        </HelpButton>
                        {check.id === "local-prerequisites" ? (
                          <>
                            <p>
                              For a Git problem, install or repair Git and make
                              it available to PRMonitor, then Retry. For a
                              worktree path problem, review the configured root.
                              For a storage problem, inspect diagnostics and
                              recovery.
                            </p>
                            <HelpButton
                              type="button"
                              disabled={loading}
                              onClick={onRetry}
                            >
                              Retry local prerequisites
                            </HelpButton>
                            {onOpenDiagnostics !== undefined ? (
                              <HelpButton
                                type="button"
                                onClick={onOpenDiagnostics}
                              >
                                Open diagnostics and recovery
                              </HelpButton>
                            ) : null}
                          </>
                        ) : null}
                        {check.id === "ai-access" ? (
                          <p>
                            Choose a saved AI connection and check its program
                            and sign-in. Subscription access and API billing are
                            separate choices; PRMonitor will not switch between
                            them.
                          </p>
                        ) : null}
                      </>
                    ) : null}
                  </article>
                ))}
            </section>
          ))}
        </div>
      ) : null}
      {showActions ? (
        <div className="profile-actions">
          <HelpButton type="button" disabled={loading} onClick={onRetry}>
            Retry setup checks
          </HelpButton>
          <HelpButton
            type="button"
            disabled={
              loading || error !== undefined || readiness?.ready !== true
            }
            onClick={onOpenInbox}
          >
            Open PR inbox
          </HelpButton>
        </div>
      ) : null}
      <p className="section-help">
        Optional: add a PR from the PR inbox, then configure its local clone in
        PR settings. Repository guidance, common instructions and work limits
        can be configured later in Settings.
      </p>
    </section>
  );
}
