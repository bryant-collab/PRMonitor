import {
  isEmptyRecoveryScope,
  recoveryScopeManagedPrId,
} from "../shared/recovery-attribution";
import type {
  F28RecoveryProjection,
  F28RecoveryScopeRecord,
} from "../shared/f28-recovery";

function scopeMessage(scope: F28RecoveryScopeRecord) {
  switch (scope.classification) {
    case "WAITING_FOR_NETWORK":
      return "PRMonitor is waiting for an internet connection. It will check eligible saved work when the connection returns.";
    case "INTERRUPTED":
      return scope.scope.kind === "ai_operation"
        ? "AI work stopped. Inspect its saved reports before choosing Continue AI Work."
        : "This work was interrupted. Open its saved result to inspect it.";
    case "UNCERTAIN":
      return scope.scope.kind === "publication"
        ? "The outcome of approved publication is not known. Open its saved result to check the remote outcome before trying again."
        : "The work outcome is not known. Inspect the saved evidence before trying again.";
    case "BLOCKED":
      return "PRMonitor could not continue this work. Inspect the saved result to see the permitted next action.";
    case "SAFE_TO_RETRY":
      return "PRMonitor can check this saved work again under the current recovery rules.";
    default:
      return "PRMonitor checked this saved work. Open support details for the recorded result.";
  }
}
export function ConnectionStatus({
  projection,
  busy,
  message,
  error,
  onCheck,
  onOpen,
  pullRequests = [],
}: {
  readonly projection?: F28RecoveryProjection;
  readonly pullRequests?: readonly {
    readonly id: string;
    readonly label: string;
  }[];
  readonly busy: boolean;
  readonly message: string;
  readonly error: string;
  readonly onCheck: () => void;
  readonly onOpen: (scope: F28RecoveryScopeRecord) => void;
}) {
  const attention =
    projection?.scopes.filter(
      (scope) =>
        !isEmptyRecoveryScope(scope.scope) &&
        ["INTERRUPTED", "UNCERTAIN", "BLOCKED", "WAITING_FOR_NETWORK"].includes(
          scope.classification,
        ),
    ) ?? [];
  return (
    <section
      className="connection-status"
      aria-labelledby="recovery-heading"
      aria-busy={busy}
    >
      <h2 id="recovery-heading">Connection and work status</h2>
      <p role="status">
        {projection === undefined
          ? "Connection and work status has not been checked."
          : attention.length === 0
            ? "No interrupted work needs action"
            : `${attention.length} saved work items need attention.`}
      </p>
      {projection?.lifecycle.online === false ? (
        <p role="status">PRMonitor is waiting for an internet connection.</p>
      ) : null}
      {attention.map((scope) => (
        <article className="surface" key={scope.scopeKey}>
          <h3>
            {scope.scope.kind === "application"
              ? "Application"
              : (pullRequests.find(
                  (pr) => pr.id === recoveryScopeManagedPrId(scope.scope),
                )?.label ?? "Saved PR work")}
          </h3>
          <p>{scopeMessage(scope)}</p>
          {scope.scope.kind === "application" ? null : (
            <button type="button" onClick={() => onOpen(scope)}>
              {recoveryScopeManagedPrId(scope.scope) !== undefined ||
              ["managed_pr", "review_bundle", "sync_operation"].includes(
                scope.scope.kind,
              )
                ? "Open saved work"
                : "Open Activity"}
            </button>
          )}
          <details>
            <summary>Raw support data (redacted)</summary>
            <pre tabIndex={0}>{JSON.stringify(scope, null, 2)}</pre>
          </details>
        </article>
      ))}
      <h3>Check interrupted work</h3>
      <p>
        PRMonitor checks saved work against local files and GitHub. It then
        retries only work that the current recovery rules allow. Work that needs
        your decision stays stopped.
      </p>
      <p>
        This check does not approve new changes or restart stopped AI work. It
        can check the outcome of changes you already approved.
      </p>
      <button type="button" onClick={onCheck} disabled={busy}>
        {busy ? "Checking interrupted work…" : "Check interrupted work"}
      </button>
      {message === "" ? null : (
        <p role="status" aria-live="polite">
          {message}
        </p>
      )}
      {error === "" ? null : <p role="alert">{error}</p>}
      {projection === undefined ? null : (
        <details>
          <summary>Raw support data (redacted)</summary>
          <pre tabIndex={0}>{JSON.stringify(projection, null, 2)}</pre>
        </details>
      )}
    </section>
  );
}
