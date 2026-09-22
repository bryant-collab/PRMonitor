import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ACTIVITY_SEVERITIES,
  ACTIVITY_STAGES,
  isActivityQuerySnapshot,
  type ActivityEventView,
  type ActivityQuery,
  type ActivityQuerySnapshot,
} from "../shared/activity";
import type { OpenTarget } from "../shared/routing";

interface ActivityViewerProps {
  readonly enabled: boolean;
  readonly onNavigate?: (target: OpenTarget) => void;
}

const DEFAULT_QUERY: ActivityQuery = { limit: 50, direction: "desc" };

function label(value: string): string {
  return value.toLowerCase().replaceAll("_", " ");
}

function displayDetails(event: ActivityEventView): string {
  return JSON.stringify(event.details, null, 2);
}

function acceptSnapshot(
  previous: ActivityQuerySnapshot | undefined,
  next: ActivityQuerySnapshot,
): ActivityQuerySnapshot {
  if (previous === undefined) return next;
  const events = new Map<string, ActivityEventView>();
  for (const event of previous.events) events.set(event.eventId, event);
  for (const event of next.events) events.set(event.eventId, event);
  const ordered = [...events.values()].sort((left, right) => {
    const time = right.recordedAt.localeCompare(left.recordedAt);
    return time !== 0 ? time : right.eventId.localeCompare(left.eventId);
  });
  return {
    ...next,
    events: ordered.slice(0, 200),
    hasMore: next.hasMore,
  };
}

export function ActivityViewer({ enabled, onNavigate }: ActivityViewerProps) {
  const [snapshot, setSnapshot] = useState<ActivityQuerySnapshot>();
  const [query, setQuery] = useState<ActivityQuery>(DEFAULT_QUERY);
  const [managedPrId, setManagedPrId] = useState("");
  const [correlationId, setCorrelationId] = useState("");
  const [workItemKey, setWorkItemKey] = useState("");
  const [severity, setSeverity] = useState("");
  const [stage, setStage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [lastKnown, setLastKnown] = useState(false);

  const load = useCallback(
    async (nextQuery: ActivityQuery, append = false) => {
      const bridge = window.prmonitor;
      if (bridge === undefined) return;
      setLoading(true);
      try {
        const response = await bridge.readActivity(nextQuery);
        if (!response.ok || response.value.kind !== "activity-query") {
          setError(
            response.ok
              ? "The activity read returned an invalid snapshot."
              : response.error.message,
          );
          setLastKnown(snapshot !== undefined);
          return;
        }
        const nextSnapshot = response.value.snapshot;
        setSnapshot((current) =>
          append && current !== undefined
            ? acceptSnapshot(current, nextSnapshot)
            : nextSnapshot,
        );
        setError(undefined);
        setLastKnown(false);
      } catch {
        setError(
          "The activity history could not be read. Retry the read without changing operation state.",
        );
        setLastKnown(snapshot !== undefined);
      } finally {
        setLoading(false);
      }
    },
    [snapshot],
  );

  useEffect(() => {
    if (!enabled) return () => undefined;
    let active = true;
    const bridge = window.prmonitor;
    if (bridge === undefined) return () => undefined;
    const unsubscribe = bridge.onActivityUpdated((event) => {
      if (!active) return;
      setSnapshot((current) => {
        if (current === undefined) return current;
        if (
          current.events.some((existing) => existing.eventId === event.eventId)
        )
          return current;
        return acceptSnapshot(current, {
          ...current,
          generatedAt: event.recordedAt,
          events: [event],
        });
      });
    });
    void load(DEFAULT_QUERY).then(async () => {
      if (!active) return;
      const response = await bridge.subscribeActivity(DEFAULT_QUERY);
      if (!active) return;
      if (
        response.ok &&
        response.value.kind === "activity-query" &&
        isActivityQuerySnapshot(response.value.snapshot)
      ) {
        setSnapshot(response.value.snapshot);
        setError(undefined);
        setLastKnown(false);
      } else if (!response.ok) {
        setError(response.error.message);
        setLastKnown(snapshot !== undefined);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [enabled]);

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const nextQuery: ActivityQuery = {
        limit: 50,
        direction: "desc",
        ...(managedPrId.trim() === ""
          ? {}
          : { managedPrId: managedPrId.trim() }),
        ...(correlationId.trim() === ""
          ? {}
          : { correlationId: correlationId.trim() }),
        ...(workItemKey.trim() === ""
          ? {}
          : { workItemKey: workItemKey.trim() }),
        ...(severity === ""
          ? {}
          : { severity: severity as ActivityQuery["severity"] }),
        ...(stage === "" ? {} : { stage: stage as ActivityQuery["stage"] }),
      };
      setQuery(nextQuery);
      void load(nextQuery);
      void window.prmonitor?.subscribeActivity(nextQuery);
    },
    [correlationId, load, managedPrId, severity, stage, workItemKey],
  );

  const loadOlder = useCallback(() => {
    if (snapshot?.nextCursor === undefined) return;
    const older = { ...query, cursor: snapshot.nextCursor };
    void load(older, true);
  }, [load, query, snapshot]);

  const openRelated = useCallback(
    async (eventId: string) => {
      const response = await window.prmonitor?.navigateActivity(eventId);
      if (response?.ok && response.value.kind === "activity-navigation") {
        onNavigate?.(response.value.target);
        return;
      }
      setError(
        response?.ok === false
          ? response.error.message
          : "The related record is unavailable.",
      );
    },
    [onNavigate],
  );

  return (
    <section
      className="activity-viewer"
      aria-labelledby="activity-heading"
      aria-busy={loading}
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">Durable diagnostics</p>
          <h2 id="activity-heading">Activity</h2>
        </div>
        <span className="store-state" aria-label="Activity event count">
          {snapshot === undefined
            ? "loading"
            : `${snapshot.events.length} shown`}
        </span>
      </div>
      <p className="section-help">
        Activity is safe evidence for understanding background work. Owning
        records remain authoritative, and this view cannot start or change an
        operation.
      </p>
      <form
        className="activity-filters"
        aria-label="Filter activity"
        onSubmit={submit}
      >
        <label>
          Managed PR id
          <input
            value={managedPrId}
            onChange={(event) => setManagedPrId(event.target.value)}
            maxLength={128}
          />
        </label>
        <label>
          Correlation id
          <input
            value={correlationId}
            onChange={(event) => setCorrelationId(event.target.value)}
            maxLength={128}
          />
        </label>
        <label>
          Work item
          <input
            value={workItemKey}
            onChange={(event) => setWorkItemKey(event.target.value)}
            maxLength={256}
            placeholder="PROJ-42 or owner/repo#42"
          />
        </label>
        <label>
          Severity
          <select
            value={severity}
            onChange={(event) => setSeverity(event.target.value)}
          >
            <option value="">Any severity</option>
            {ACTIVITY_SEVERITIES.map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Stage
          <select
            value={stage}
            onChange={(event) => setStage(event.target.value)}
          >
            <option value="">Any stage</option>
            {ACTIVITY_STAGES.map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={loading}>
          Apply filters
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={loading}
          onClick={() => void load(query)}
        >
          Retry read
        </button>
      </form>
      <div className="activity-status" role="status" aria-live="polite">
        {loading && snapshot === undefined
          ? "Loading durable activity..."
          : null}
        {!loading && snapshot?.events.length === 0
          ? "No activity matches the current filters."
          : null}
        {lastKnown
          ? " Showing the last valid activity snapshot; the latest read needs a retry."
          : null}
        {error !== undefined ? ` ${error}` : null}
      </div>
      {snapshot === undefined ? null : (
        <p className="retention-note">
          Activity retention is bounded to{" "}
          {snapshot.retention.policy.maxAgeDays} days,{" "}
          {snapshot.retention.policy.maxEvents.toLocaleString("en-US")} events,
          or {Math.round(snapshot.retention.policy.maxBytes / 1024 / 1024)} MiB.{" "}
          {snapshot.retention.prunedBefore === undefined ? null : (
            <>
              Older history may be unavailable before{" "}
              {snapshot.retention.prunedBefore}.{" "}
            </>
          )}
          Authoritative operation records are retained separately.
        </p>
      )}
      {snapshot !== undefined && snapshot.events.length > 0 ? (
        <ol
          className="activity-timeline"
          aria-label="Correlated activity timeline"
        >
          {snapshot.events.map((event) => (
            <li key={event.eventId} className="activity-entry">
              <article aria-labelledby={`activity-event-${event.eventId}`}>
                <div className="activity-entry-heading">
                  <span
                    className={`status-pill activity-severity-${event.severity.toLowerCase()}`}
                  >
                    {label(event.severity)}
                  </span>
                  <time dateTime={event.recordedAt}>{event.recordedAt}</time>
                </div>
                <h3 id={`activity-event-${event.eventId}`}>{event.summary}</h3>
                <dl className="activity-details">
                  <div>
                    <dt>What</dt>
                    <dd>{event.reason.what}</dd>
                  </div>
                  <div>
                    <dt>Why</dt>
                    <dd>{event.reason.why}</dd>
                  </div>
                  <div>
                    <dt>Stage</dt>
                    <dd>{label(event.stage)}</dd>
                  </div>
                  <div>
                    <dt>Reason</dt>
                    <dd>{event.reason.code}</dd>
                  </div>
                  <div>
                    <dt>Correlation</dt>
                    <dd>{event.correlationId}</dd>
                  </div>
                  {event.operationId === undefined ? null : (
                    <div>
                      <dt>Operation</dt>
                      <dd>{event.operationId}</dd>
                    </div>
                  )}
                  {event.workItemLabel === undefined ? null : (
                    <div>
                      <dt>Work item</dt>
                      <dd>{event.workItemLabel}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Next action</dt>
                    <dd>{label(event.reason.nextAction)}</dd>
                  </div>
                </dl>
                <details>
                  <summary>Safe structured details</summary>
                  <pre>{displayDetails(event)}</pre>
                </details>
                {event.relatedTarget === undefined ? null : (
                  <button
                    type="button"
                    className="link-button activity-related-button"
                    onClick={() => void openRelated(event.eventId)}
                  >
                    Open related record
                  </button>
                )}
              </article>
            </li>
          ))}
        </ol>
      ) : null}
      {snapshot?.hasMore ? (
        <button
          type="button"
          className="secondary-button"
          disabled={loading}
          onClick={loadOlder}
        >
          Load older activity
        </button>
      ) : null}
    </section>
  );
}
