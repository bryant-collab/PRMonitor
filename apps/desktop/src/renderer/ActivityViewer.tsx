import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ACTIVITY_SEVERITIES,
  ACTIVITY_STAGES,
  type ActivityEventView,
  type ActivityQuery,
} from "../shared/activity";
import {
  activityScope,
  presentActivity,
} from "../shared/activity-presentation";
import type { OpenTarget } from "../shared/routing";
import {
  createActivityReader,
  type ActivityReadState,
} from "./activity-reader";

interface ActivityViewerProps {
  readonly visible?: boolean;
  readonly enabled: boolean;
  readonly onNavigate?: (target: OpenTarget) => void;
  readonly onAddPr?: () => void;
  readonly managedPrId?: string;
  readonly pullRequests?: readonly {
    readonly id: string;
    readonly label: string;
  }[];
}
const defaultQuery: ActivityQuery = {
  view: "PR_WORK",
  limit: 50,
  direction: "desc",
};
const label = (value: string) => value.toLowerCase().replaceAll("_", " ");

export function ActivityRow({
  event,
  onOpen,
}: {
  readonly event: ActivityEventView;
  readonly onOpen?: (id: string) => void;
}) {
  const presentation = presentActivity(event);
  const date = new Date(event.recordedAt);
  return (
    <li className="activity-entry">
      <article aria-labelledby={`activity-event-${event.eventId}`}>
        <div className="activity-entry-heading">
          <time dateTime={event.recordedAt}>
            {Number.isNaN(date.valueOf())
              ? "Time unavailable"
              : new Intl.DateTimeFormat(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(date)}
          </time>
          <h3 id={`activity-event-${event.eventId}`}>{presentation.summary}</h3>
          <span
            className={`status-pill activity-severity-${event.severity.toLowerCase()}`}
          >
            {label(event.severity)}
          </span>
        </div>
        <span className="activity-attribution">
          {activityScope(event) === "APPLICATION"
            ? "Application"
            : (event.workItemLabel ??
              (activityScope(event) === "PR_WORK"
                ? "PR work"
                : "Unclassified event"))}
        </span>
        <details className="activity-event-details">
          <summary>View event details</summary>
          {presentation.explanation === undefined ? null : (
            <p>{presentation.explanation}</p>
          )}
          {presentation.nextAction === undefined ? null : (
            <p>{presentation.nextAction}</p>
          )}
          <p>
            Exact time (UTC):{" "}
            <time dateTime={event.recordedAt}>{event.recordedAt}</time>
          </p>
          {event.relatedTarget === undefined ? null : (
            <button
              type="button"
              className="secondary-button"
              onClick={() => onOpen?.(event.eventId)}
            >
              Open related work
            </button>
          )}
          <details>
            <summary>Raw support data (redacted)</summary>
            <pre tabIndex={0}>{JSON.stringify(event, null, 2)}</pre>
          </details>
        </details>
      </article>
    </li>
  );
}

export function ActivityViewer({
  visible = true,
  enabled,
  onNavigate,
  onAddPr,
  managedPrId: fixedPr,
  pullRequests = [],
}: ActivityViewerProps) {
  const [state, setState] = useState<ActivityReadState>({
    loading: true,
    lastKnown: false,
  });
  const [query, setQuery] = useState<ActivityQuery>({
    ...defaultQuery,
    ...(fixedPr === undefined ? {} : { managedPrId: fixedPr }),
  });
  const [selectedPr, setSelectedPr] = useState(fixedPr ?? "");
  const [correlationId, setCorrelationId] = useState("");
  const [workItemKey, setWorkItemKey] = useState("");
  const [severity, setSeverity] = useState("");
  const [stage, setStage] = useState("");
  const reader = useRef<ReturnType<typeof createActivityReader>>(undefined);
  const { snapshot, loading, error, lastKnown } = state;

  useEffect(() => {
    if (!enabled) return;
    const bridge = window.prmonitor;
    const next = createActivityReader(async (input, subscribe) => {
      await bridge?.ready();
      return subscribe
        ? bridge?.subscribeActivity(input)
        : bridge?.readActivity(input);
    }, setState);
    reader.current = next;
    const unsubscribe = bridge?.onActivityUpdated(next.updated);
    const initial = {
      ...query,
      ...(fixedPr === undefined ? {} : { managedPrId: fixedPr }),
    };
    setQuery(initial);
    void next.load(initial, "replace");
    return () => {
      next.dispose();
      unsubscribe?.();
      reader.current = undefined;
    };
  }, [enabled, fixedPr]);

  const changeQuery = (input: ActivityQuery) => {
    setQuery(input);
    void reader.current?.load(input, "replace");
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    changeQuery({
      view: query.view,
      limit: 50,
      direction: "desc",
      ...((fixedPr ?? selectedPr).trim() === ""
        ? {}
        : { managedPrId: (fixedPr ?? selectedPr).trim() }),
      ...(correlationId.trim() === ""
        ? {}
        : { correlationId: correlationId.trim() }),
      ...(workItemKey.trim() === "" ? {} : { workItemKey: workItemKey.trim() }),
      ...(severity === ""
        ? {}
        : { severity: severity as ActivityQuery["severity"] }),
      ...(stage === "" ? {} : { stage: stage as ActivityQuery["stage"] }),
    });
  };
  const openRelated = useCallback(
    async (eventId: string) => {
      const response = await window.prmonitor?.navigateActivity(eventId);
      if (response?.ok && response.value.kind === "activity-navigation")
        onNavigate?.(response.value.target);
      else
        setState((current) => ({
          ...current,
          error:
            "The related work is unavailable. Refresh activity to check again.",
        }));
    },
    [onNavigate],
  );
  const filtered = Object.keys(query).some(
    (key) =>
      !["view", "limit", "direction"].includes(key) &&
      query[key as keyof ActivityQuery] !== undefined,
  );
  const emptyPr = !filtered && query.view === "PR_WORK";

  return !visible ? null : (
    <section
      className="activity-viewer"
      aria-labelledby="activity-heading"
      aria-busy={loading}
    >
      <div className="section-heading">
        <h2 id="activity-heading">Activity</h2>
        <span aria-label="Activity event count">
          {snapshot === undefined ? "" : `${snapshot.events.length} shown`}
        </span>
      </div>
      <p className="section-help">
        See what PRMonitor has done and whether anything needs your attention.
      </p>
      <label>
        Activity view
        <select
          value={query.view ?? "PR_WORK"}
          onChange={(event) =>
            changeQuery({
              ...query,
              cursor: undefined,
              view: event.target.value as ActivityQuery["view"],
            })
          }
        >
          <option value="PR_WORK">PR work</option>
          <option value="APPLICATION">Application diagnostics</option>
          <option value="ALL">All activity</option>
        </select>
      </label>
      <form
        className="activity-filters"
        aria-label="Filter activity"
        onSubmit={submit}
      >
        {fixedPr === undefined ? (
          <label>
            Pull request
            <select
              value={selectedPr}
              onChange={(event) => setSelectedPr(event.target.value)}
            >
              <option value="">All pull requests</option>
              {pullRequests.map((pr) => (
                <option key={pr.id} value={pr.id}>
                  {pr.label}
                </option>
              ))}
              {selectedPr !== "" &&
              !pullRequests.some((pr) => pr.id === selectedPr) ? (
                <option value={selectedPr}>Saved pull request</option>
              ) : null}
            </select>
          </label>
        ) : (
          <p>Activity for the selected pull request</p>
        )}
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
        <details className="activity-advanced">
          <summary>Advanced filters</summary>
          <label>
            Correlation ID
            <input
              value={correlationId}
              onChange={(event) => setCorrelationId(event.target.value)}
              maxLength={128}
            />
          </label>
          <label>
            Work-item key
            <input
              value={workItemKey}
              onChange={(event) => setWorkItemKey(event.target.value)}
              maxLength={256}
              placeholder="PROJ-42 or owner/repo#42"
            />
          </label>
        </details>
        <button type="submit" disabled={loading}>
          Apply filters
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={loading}
          onClick={() => void reader.current?.load(query)}
        >
          Refresh activity
        </button>
      </form>
      <div className="activity-status" role="status" aria-live="polite">
        {loading ? "Loading activity…" : null}
        {lastKnown
          ? "Showing last-known activity. The latest read failed."
          : null}
      </div>
      {error === undefined ? null : <p role="alert">{error}</p>}
      {!loading && error === undefined && snapshot?.events.length === 0 ? (
        <div className="activity-empty">
          <h3>
            {filtered
              ? "No activity matches these filters"
              : emptyPr
                ? "No PR activity yet"
                : "No activity yet"}
          </h3>
          {emptyPr ? (
            <>
              <p>
                PRMonitor will record activity here when you add pull requests
                and work begins
              </p>
              <button type="button" onClick={onAddPr}>
                Add PR
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  changeQuery({ ...defaultQuery, view: "APPLICATION" })
                }
              >
                View application diagnostics
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      {snapshot === undefined ? null : (
        <>
          <ol className="activity-timeline" aria-label="Activity history">
            {snapshot.events.map((event) => (
              <ActivityRow
                key={event.eventId}
                event={event}
                onOpen={(id) => void openRelated(id)}
              />
            ))}
          </ol>
          <details className="activity-retention">
            <summary>About activity history</summary>
            <p>
              PRMonitor keeps activity for up to{" "}
              {snapshot.retention.policy.maxAgeDays} days,{" "}
              {snapshot.retention.policy.maxEvents.toLocaleString()} events, or{" "}
              {Math.round(snapshot.retention.policy.maxBytes / 1024 / 1024)}{" "}
              MiB. Saved reviews and work results have separate history.
            </p>
            {snapshot.retention.prunedBefore === undefined ? null : (
              <p>
                Older activity before {snapshot.retention.prunedBefore} may be
                unavailable.
              </p>
            )}
          </details>
        </>
      )}
      {snapshot?.hasMore ? (
        <button
          type="button"
          className="secondary-button"
          disabled={loading}
          onClick={() =>
            void reader.current?.load(
              { ...query, cursor: snapshot.nextCursor },
              "older",
            )
          }
        >
          Load older activity
        </button>
      ) : null}
    </section>
  );
}
