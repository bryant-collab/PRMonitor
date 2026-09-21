import type {
  ManagedPrInboxGroup,
  ManagedPrInboxReadModel,
} from "../shared/inbox";

interface ManagedPrInboxProps {
  readonly snapshot: ManagedPrInboxReadModel | undefined;
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly lastKnown: boolean;
  readonly onRetry: () => void;
  readonly onNavigate: (
    managedPrId: string,
    destination: "details" | "settings",
  ) => void;
  readonly onAddPr: () => void;
}

const stateLabels = {
  WATCHING: "WATCHING",
  WORKING: "WORKING",
  READY_FOR_REVIEW: "READY_FOR_REVIEW",
  NEEDS_ATTENTION: "NEEDS_ATTENTION",
} as const;

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function readableStatus(value: string): string {
  return value.toLowerCase().replaceAll("_", " ");
}

function InboxGroup({
  group,
  cards,
  onNavigate,
}: {
  readonly group: ManagedPrInboxGroup;
  readonly cards: ManagedPrInboxReadModel["cards"];
  readonly onNavigate: ManagedPrInboxProps["onNavigate"];
}) {
  if (cards.length === 0) return null;
  return (
    <section
      className={`inbox-group inbox-group-${group.id.toLowerCase()}`}
      aria-labelledby={`inbox-group-${group.id.toLowerCase()}`}
    >
      <div className="inbox-group-heading">
        <div>
          <p className="eyebrow">
            {group.id === "ACTION_NEEDED" ? "Human decision" : "Review state"}
          </p>
          <h3 id={`inbox-group-${group.id.toLowerCase()}`}>{group.label}</h3>
        </div>
        <span
          className="store-state"
          aria-label={`${group.count} ${group.label} pull requests`}
        >
          {group.count}
        </span>
      </div>
      <div className="inbox-card-list">
        {cards.map((card) => {
          const titleId = `inbox-card-title-${card.id}`;
          const descriptionId = `inbox-card-description-${card.id}`;
          return (
            <article
              className={`inbox-card inbox-card-${card.primaryState.toLowerCase()}`}
              key={card.id}
              aria-labelledby={titleId}
              aria-describedby={descriptionId}
            >
              <div className="inbox-card-heading">
                <div className="inbox-card-title-block">
                  <h4 id={titleId}>{card.title ?? card.reference}</h4>
                  <p className="inbox-reference">{card.reference}</p>
                </div>
                <span className="inbox-state" data-state={card.primaryState}>
                  {stateLabels[card.primaryState]}
                </span>
              </div>
              <p className="inbox-card-description" id={descriptionId}>
                {card.reason.what} {card.reason.why}
              </p>
              <dl className="inbox-card-details">
                <div>
                  <dt>State updated</dt>
                  <dd>{formatTimestamp(card.stateUpdatedAt)}</dd>
                </div>
                <div>
                  <dt>Next action</dt>
                  <dd>{readableStatus(card.reason.nextAction)}</dd>
                </div>
                <div>
                  <dt>Local clone</dt>
                  <dd>{readableStatus(card.localSetupStatus)}</dd>
                </div>
              </dl>
              {card.synchronization !== undefined ? (
                <div
                  className="inbox-sync-overlay"
                  role="status"
                  aria-label={`Synchronization status ${readableStatus(card.synchronization.status)}`}
                >
                  <span className="inbox-sync-label">
                    Synchronization overlay
                  </span>
                  <strong>{readableStatus(card.synchronization.status)}</strong>
                  <span>
                    {card.synchronization.reason.what}{" "}
                    {card.synchronization.reason.why}
                  </span>
                </div>
              ) : null}
              <div
                className="inbox-card-actions"
                aria-label={`Actions for ${card.reference}`}
              >
                <button
                  type="button"
                  onClick={() => onNavigate(card.id, "details")}
                >
                  Details
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => onNavigate(card.id, "settings")}
                >
                  Settings
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function ManagedPrInbox({
  snapshot,
  loading,
  error,
  lastKnown,
  onRetry,
  onNavigate,
  onAddPr,
}: ManagedPrInboxProps) {
  const cardsById = new Map(
    (snapshot?.cards ?? []).map((card) => [card.id, card]),
  );
  return (
    <section
      className="managed-pr-inbox"
      aria-labelledby="managed-pr-inbox-heading"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">Review inbox</p>
          <h2 id="managed-pr-inbox-heading">Managed pull requests</h2>
        </div>
        {snapshot !== undefined ? (
          <span
            className="store-state"
            aria-label={`${snapshot.counts.total} managed pull requests`}
          >
            {snapshot.counts.total} tracked
          </span>
        ) : null}
      </div>
      <p className="section-help">
        The inbox is read from main-process state. Synchronization appears as a
        separate overlay and never changes the review state.
      </p>
      {loading ? (
        <p className="inbox-status" role="status" aria-live="polite">
          Loading the managed pull-request inbox…
        </p>
      ) : null}
      {error !== undefined ? (
        <div className="inbox-error" role="alert">
          <strong>Inbox refresh failed.</strong>
          <span>{error}</span>
          <button type="button" onClick={onRetry}>
            Read again
          </button>
        </div>
      ) : null}
      {lastKnown && snapshot !== undefined ? (
        <p className="inbox-last-known" role="status">
          Showing last known inbox data.
        </p>
      ) : null}
      {!loading &&
      error === undefined &&
      snapshot !== undefined &&
      snapshot.cards.length === 0 ? (
        <div className="inbox-empty" role="status">
          <strong>No managed pull requests yet.</strong>
          <span>Add a pull request to begin watching it.</span>
          <button type="button" onClick={onAddPr}>
            Add PR
          </button>
        </div>
      ) : null}
      {snapshot !== undefined && snapshot.cards.length > 0 ? (
        <div className="inbox-groups">
          {snapshot.groups.map((group) => (
            <InboxGroup
              key={group.id}
              group={group}
              cards={group.cardIds.flatMap((id) => {
                const card = cardsById.get(id);
                return card === undefined ? [] : [card];
              })}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
