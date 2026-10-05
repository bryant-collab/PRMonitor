import { useEffect, useRef } from "react";
import type { SetupReadinessProjection } from "../shared/setup-readiness";
import type { IpcResponse } from "../shared/ipc";

export type SetupDestination = "local" | "github" | "ai" | "tasks" | "policy";

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
  onAddPr,
}: {
  readonly readiness?: SetupReadinessProjection;
  readonly loading: boolean;
  readonly error?: string;
  readonly onRetry: () => void;
  readonly onRemediate: (destination: SetupDestination) => void;
  readonly onOpenInbox: () => void;
  readonly onOpenDiagnostics?: () => void;
  readonly onAddPr?: () => void;
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
        Configure the local tools, GitHub access, and AI settings PRMonitor
        needs to work. Progress is saved by each configuration action and
        checked again when you reopen PRMonitor.
      </p>
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
      {confirmedReadiness !== undefined ? (
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
                        <button
                          type="button"
                          onClick={() => onRemediate(check.remediation)}
                        >
                          {actions[check.remediation]}
                        </button>
                        {check.id === "local-prerequisites" ? (
                          <>
                            <p>
                              For a Git problem, install or repair Git and make
                              it available to PRMonitor, then Retry. For a
                              worktree path problem, review the configured root.
                              For a storage problem, inspect diagnostics and
                              recovery.
                            </p>
                            <button
                              type="button"
                              disabled={loading}
                              onClick={onRetry}
                            >
                              Retry local prerequisites
                            </button>
                            {onOpenDiagnostics !== undefined ? (
                              <button type="button" onClick={onOpenDiagnostics}>
                                Open diagnostics and recovery
                              </button>
                            ) : null}
                          </>
                        ) : null}
                        {check.id === "ai-access" ? (
                          <p>
                            For Codex, configure OPENAI_API_KEY in the approved
                            runtime environment used by the adapter, then Retry.
                            PRMonitor checks availability locally and does not
                            ask you to enter the key here.
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
      <div className="profile-actions">
        <button type="button" disabled={loading} onClick={onRetry}>
          Retry setup checks
        </button>
        <button
          type="button"
          disabled={loading || error !== undefined || readiness?.ready !== true}
          onClick={onOpenInbox}
        >
          Open PR inbox
        </button>
      </div>
      <p className="section-help">
        Optional: add a PR from the PR inbox, then configure its local clone in
        PR settings. Repository guidance, common instructions and work limits
        can be configured later in Settings.
      </p>
      {onAddPr === undefined ? null : (
        <button type="button" onClick={onAddPr}>
          Add PR
        </button>
      )}
    </section>
  );
}
