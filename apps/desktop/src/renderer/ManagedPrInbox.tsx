import type {
  ManagedPrInboxGroup,
  ManagedPrInboxReadModel,
} from "../shared/inbox";
import type {
  F24PreparationIntent,
  F24SelectionCommandInput,
  F24SelectionSession,
  F24SynchronizationConfirmation,
} from "../shared/f24-synchronization";

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
  readonly selection: F24SelectionSession | undefined;
  readonly confirmation: F24SynchronizationConfirmation | undefined;
  readonly preparationIntent: F24PreparationIntent | undefined;
  readonly selectionBusy: boolean;
  readonly confirmingPreparation: boolean;
  readonly onSelectionCommand: (input: F24SelectionCommandInput) => void;
  readonly onOpenSynchronization: () => void;
  readonly onConfirmPreparation: () => void;
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
  selection,
  onSelectionCommand,
}: {
  readonly group: ManagedPrInboxGroup;
  readonly cards: ManagedPrInboxReadModel["cards"];
  readonly onNavigate: ManagedPrInboxProps["onNavigate"];
  readonly selection: ManagedPrInboxProps["selection"];
  readonly onSelectionCommand: ManagedPrInboxProps["onSelectionCommand"];
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
              <label className="inbox-card-selection">
                <input
                  type="checkbox"
                  checked={
                    selection?.selectedManagedPrIds.includes(card.id) ?? false
                  }
                  onChange={() =>
                    onSelectionCommand({
                      command: "TOGGLE",
                      projectionRevision: selection?.projectionRevision ?? 0,
                      managedPrId: card.id,
                    })
                  }
                  aria-label={`Select ${card.reference} for synchronization`}
                />
                <span>Select for synchronization</span>
              </label>
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
  selection,
  confirmation,
  preparationIntent,
  selectionBusy,
  confirmingPreparation,
  onSelectionCommand,
  onOpenSynchronization,
  onConfirmPreparation,
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
      {snapshot !== undefined && snapshot.cards.length > 0 ? (
        <div
          className="inbox-selection-toolbar"
          aria-label="Synchronization selection controls"
        >
          <div>
            <strong>{selection?.selectedCount ?? 0} selected</strong>
            <span>
              Select pull requests to review exact source and destination refs
              before preparation.
            </span>
          </div>
          <div className="inbox-selection-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={selectionBusy}
              onClick={() =>
                onSelectionCommand({
                  command: "SELECT_ALL",
                  projectionRevision: snapshot.version,
                })
              }
            >
              Select all
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={selectionBusy || (selection?.selectedCount ?? 0) === 0}
              onClick={() =>
                onSelectionCommand({
                  command: "CLEAR",
                  projectionRevision: snapshot.version,
                })
              }
            >
              Clear
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={selectionBusy || !(selection?.canOpen ?? false)}
              onClick={onOpenSynchronization}
            >
              {selection?.actionLabel ?? "Synchronize PR Branches"}
            </button>
          </div>
        </div>
      ) : null}
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
          <strong>No pull requests yet</strong>
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
              selection={selection}
              onSelectionCommand={onSelectionCommand}
            />
          ))}
        </div>
      ) : null}
      {confirmation !== undefined ? (
        <section
          className="sync-confirmation"
          aria-labelledby="sync-confirmation-heading"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">Review before preparation</p>
              <h3 id="sync-confirmation-heading">
                Confirm synchronization preparation
              </h3>
            </div>
            <span className="store-state">
              {confirmation.eligibleCount} eligible /{" "}
              {confirmation.selectedCount} selected
            </span>
          </div>
          <p className="section-help">{confirmation.prepareOnlyMessage}</p>
          <div className="sync-confirmation-rows">
            {confirmation.rows.map((row) => (
              <article className="sync-confirmation-row" key={row.managedPrId}>
                <div className="sync-row-heading">
                  <strong>{row.managedPrId}</strong>
                  <span
                    className={`sync-eligibility sync-${row.eligibility.toLowerCase()}`}
                  >
                    {row.eligibility}
                  </span>
                </div>
                <dl className="sync-row-details">
                  <div>
                    <dt>Source repository</dt>
                    <dd>{row.sourceRepository.key}</dd>
                  </div>
                  <div>
                    <dt>Source branch</dt>
                    <dd>
                      {row.syncSourceBranch} (
                      {row.sourceProvenance.toLowerCase().replaceAll("_", " ")})
                    </dd>
                  </div>
                  <div>
                    <dt>Destination repository</dt>
                    <dd>{row.destinationRepository.key}</dd>
                  </div>
                  <div>
                    <dt>Destination branch</dt>
                    <dd>{row.prHeadBranch}</dd>
                  </div>
                  <div>
                    <dt>Current source SHA</dt>
                    <dd>{row.syncSourceSha ?? "Unavailable"}</dd>
                  </div>
                  <div>
                    <dt>Current head SHA</dt>
                    <dd>{row.prHeadSha ?? "Unavailable"}</dd>
                  </div>
                </dl>
                <p
                  className="sync-row-reason"
                  role={row.eligibility === "INELIGIBLE" ? "alert" : undefined}
                >
                  {row.reason.what} {row.reason.why} Next action:{" "}
                  {readableStatus(row.reason.nextAction)}.
                </p>
              </article>
            ))}
          </div>
          <div className="sync-confirmation-actions">
            <button
              type="button"
              className="primary-button"
              disabled={!confirmation.confirmEnabled || confirmingPreparation}
              onClick={onConfirmPreparation}
            >
              {confirmingPreparation
                ? "Recording preparation…"
                : "Confirm preparation"}
            </button>
            <span className="field-help">
              Ineligible rows remain visible and will be skipped.
            </span>
          </div>
        </section>
      ) : null}
      {preparationIntent !== undefined ? (
        <p className="sync-intent-status" role="status" aria-live="polite">
          Preparation intent {preparationIntent.snapshot.intentId} is{" "}
          {preparationIntent.handoff.status.toLowerCase()}. No merge, push,
          response, AI, or publication authority was granted.
        </p>
      ) : null}
    </section>
  );
}
