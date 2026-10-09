import { HelpButton, HelpInput, HelpSummary } from "./HelpControls";
import { useState, type ReactNode } from "react";
import { primaryLabels, prSummary } from "./PrDetail";
import { customerExplanation } from "./customer-copy";
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
  readonly listScrollTop?: number;
  readonly onListScroll?: (top: number) => void;
  readonly detail?: ReactNode;
  readonly toolbar?: ReactNode;
  readonly selectedManagedPrId?: string;
  readonly snapshot: ManagedPrInboxReadModel | undefined;
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly lastKnown: boolean;
  readonly onRetry: () => void;
  readonly onNavigate: (
    managedPrId: string,
    destination: "details" | "settings",
  ) => void;
  readonly selection: F24SelectionSession | undefined;
  readonly confirmation: F24SynchronizationConfirmation | undefined;
  readonly preparationIntent: F24PreparationIntent | undefined;
  readonly selectionBusy: boolean;
  readonly confirmingPreparation: boolean;
  readonly onSelectionCommand: (input: F24SelectionCommandInput) => void;
  readonly onOpenSynchronization: () => void;
  readonly onResetSelection?: () => void;
  readonly onConfirmPreparation: () => void;
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
  selectedManagedPrId,
}: {
  readonly group: ManagedPrInboxGroup;
  readonly cards: ManagedPrInboxReadModel["cards"];
  readonly onNavigate: ManagedPrInboxProps["onNavigate"];
  readonly selection: ManagedPrInboxProps["selection"];
  readonly onSelectionCommand: ManagedPrInboxProps["onSelectionCommand"];
  readonly selectedManagedPrId?: string;
}) {
  if (cards.length === 0) return null;
  return (
    <section
      className="inbox-group"
      aria-labelledby={"inbox-group-" + group.id.toLowerCase()}
    >
      <h3 id={"inbox-group-" + group.id.toLowerCase()}>
        {group.label} <span>{group.count}</span>
      </h3>
      <div className="inbox-card-list">
        {cards.map((card) => (
          <article
            key={card.id}
            className={
              "inbox-card" +
              (selectedManagedPrId === card.id ? " inspected-pr" : "")
            }
          >
            <label className="inbox-card-selection">
              <HelpInput
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
                aria-label={"Select " + card.reference + " for synchronization"}
              />
              <span>Branch sync selection</span>
            </label>
            <HelpButton
              type="button"
              className="inbox-inspect"
              aria-pressed={selectedManagedPrId === card.id}
              onClick={() => onNavigate(card.id, "details")}
            >
              <span className="inbox-reference">{card.reference}</span>
              <strong>{card.title ?? card.reference}</strong>
              <span className="inbox-state" data-state={card.primaryState}>
                {primaryLabels[card.primaryState]}
              </span>
              <span>{prSummary(card)}</span>
              {card.synchronization === undefined ? null : (
                <span>
                  Branch sync: {readableStatus(card.synchronization.status)}
                </span>
              )}
            </HelpButton>
            <HelpButton
              type="button"
              className="link-button"
              onClick={() => onNavigate(card.id, "settings")}
            >
              PR settings
            </HelpButton>
          </article>
        ))}
      </div>
    </section>
  );
}

export function ManagedPrInbox({
  listScrollTop,
  onListScroll,
  detail,
  toolbar,
  selectedManagedPrId,
  snapshot,
  loading,
  error,
  lastKnown,
  onRetry,
  onNavigate,
  selection,
  confirmation,
  preparationIntent,
  selectionBusy,
  confirmingPreparation,
  onSelectionCommand,
  onOpenSynchronization,
  onResetSelection,
  onConfirmPreparation,
}: ManagedPrInboxProps) {
  const [filter, setFilter] = useState<"ACTION_NEEDED" | "WORKING" | "ALL">(
    "ALL",
  );
  const groups =
    snapshot?.groups.filter(
      (group) => filter === "ALL" || group.id === filter,
    ) ?? [];
  const visibleCount = groups.reduce((count, group) => count + group.count, 0);
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
          <h2 id="managed-pr-inbox-heading">PR inbox</h2>
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
      {toolbar}
      <div
        className="inbox-filters"
        role="group"
        aria-label="Filter pull requests"
      >
        {(
          [
            ["ACTION_NEEDED", "Needs attention"],
            ["WORKING", "Running"],
            ["ALL", "All PRs"],
          ] as const
        ).map(([id, label]) => (
          <HelpButton
            type="button"
            key={id}
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            {label}
          </HelpButton>
        ))}
      </div>
      {snapshot !== undefined && snapshot.cards.length > 0 ? (
        <div
          className="inbox-selection-toolbar"
          aria-label="Synchronization selection controls"
        >
          <div>
            <strong>{selection?.selectedCount ?? 0} selected</strong>
            <span>
              Select PRs for branch synchronization. Select all includes PRs
              hidden by the current filter.
            </span>
          </div>
          <div className="inbox-selection-actions">
            <HelpButton
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
            </HelpButton>
            <HelpButton
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
            </HelpButton>
            <HelpButton
              type="button"
              className="primary-button"
              disabled={selectionBusy || !(selection?.canOpen ?? false)}
              onClick={onOpenSynchronization}
            >
              {selection?.actionLabel ?? "Synchronize PR Branches"}
            </HelpButton>
          </div>
        </div>
      ) : null}
      {snapshot !== undefined &&
      selection !== undefined &&
      selection.projectionRevision !== snapshot.version ? (
        <p role="status">
          The PR inbox changed. Reset branch sync selection to select from the
          current inbox. This clears sync checkboxes and keeps the inspected PR.{" "}
          <HelpButton
            type="button"
            disabled={selectionBusy}
            onClick={onResetSelection}
          >
            Reset branch sync selection
          </HelpButton>
        </p>
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
          <HelpButton type="button" onClick={onRetry}>
            Read again
          </HelpButton>
        </div>
      ) : null}
      {lastKnown && snapshot !== undefined ? (
        <p className="inbox-last-known" role="status">
          Showing last known inbox data.
        </p>
      ) : null}
      <div
        className={
          "inbox-columns" +
          (selectedManagedPrId === undefined ? "" : " has-inspection")
        }
      >
        <div
          className="inbox-list"
          tabIndex={0}
          aria-label="Pull request list"
          ref={(element) => {
            if (element !== null && listScrollTop !== undefined)
              element.scrollTop = listScrollTop;
          }}
          onScroll={(event) => onListScroll?.(event.currentTarget.scrollTop)}
        >
          {!loading &&
          error === undefined &&
          snapshot !== undefined &&
          snapshot.cards.length === 0 ? (
            <div className="inbox-empty" role="status">
              <strong>No pull requests yet</strong>
              <span>Add a pull request to begin watching it.</span>
            </div>
          ) : null}
          {snapshot !== undefined && snapshot.cards.length > 0 ? (
            <div className="inbox-groups">
              {groups.map((group) => (
                <InboxGroup
                  key={group.id}
                  group={group}
                  cards={group.cardIds.flatMap((id) => {
                    const card = cardsById.get(id);
                    return card === undefined ? [] : [card];
                  })}
                  onNavigate={onNavigate}
                  selectedManagedPrId={selectedManagedPrId}
                  selection={selection}
                  onSelectionCommand={onSelectionCommand}
                />
              ))}
            </div>
          ) : null}
          {!loading &&
          snapshot !== undefined &&
          snapshot.cards.length > 0 &&
          visibleCount === 0 ? (
            <p role="status">
              No PRs match this filter. Choose All PRs to see the full list.
            </p>
          ) : null}
        </div>
        {detail}
      </div>
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
                  <strong>
                    {cardsById.get(row.managedPrId)?.reference ??
                      "Saved pull request"}
                  </strong>
                  <span
                    className={`sync-eligibility sync-${row.eligibility.toLowerCase()}`}
                  >
                    {readableStatus(row.eligibility)}
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
                  {customerExplanation(
                    `${row.reason.what} ${row.reason.why}`,
                    row.eligibility === "INELIGIBLE"
                      ? "This pull request cannot be prepared. Check its PR settings and refresh the summary."
                      : "This pull request can be prepared using the exact branches and revisions shown above.",
                  )}
                </p>
                <details>
                  <HelpSummary>Raw support data</HelpSummary>
                  <pre tabIndex={0}>
                    {JSON.stringify(
                      { managedPrId: row.managedPrId, reason: row.reason },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              </article>
            ))}
          </div>
          <div className="sync-confirmation-actions">
            <HelpButton
              type="button"
              className="primary-button"
              disabled={!confirmation.confirmEnabled || confirmingPreparation}
              onClick={onConfirmPreparation}
            >
              {confirmingPreparation
                ? "Recording preparation…"
                : "Confirm preparation"}
            </HelpButton>
            <span className="field-help">
              Ineligible rows remain visible and will be skipped.
            </span>
          </div>
        </section>
      ) : null}
      {preparationIntent !== undefined ? (
        <p className="sync-intent-status" role="status" aria-live="polite">
          Branch synchronization preparation is{" "}
          {preparationIntent.handoff.status.toLowerCase()}. No merge, push,
          response or AI work started. Publication still requires explicit
          approval.
        </p>
      ) : null}
    </section>
  );
}
