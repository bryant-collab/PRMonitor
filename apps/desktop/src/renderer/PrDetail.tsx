import { savedWorkTarget } from "./shell-routing";
import type { ReactNode } from "react";
import type { ManagedPrInboxCard } from "../shared/inbox";
import type { ManagedPrReadModel } from "../shared/managed-pr";
import type { ManagedPrWork } from "../shared/managed-pr-work";
import type { OpenTarget } from "../shared/routing";
import type { PrDetailTab } from "./shell-routing";
import { ActivityViewer } from "./ActivityViewer";

export const primaryLabels = {
  WATCHING: "Watching",
  WORKING: "Working",
  READY_FOR_REVIEW: "Ready for review",
  NEEDS_ATTENTION: "Needs attention",
} as const;
export function prSummary(card: ManagedPrInboxCard): string {
  switch (card.primaryState) {
    case "READY_FOR_REVIEW":
      return "Open the saved review to inspect the proposed changes and responses.";
    case "NEEDS_ATTENTION":
      return "Inspect the saved work to see what stopped and the permitted next action.";
    case "WORKING":
      return "PRMonitor is working on this pull request. Open its saved work for progress.";
    case "WATCHING":
      return "PRMonitor is watching for new feedback on this pull request.";
  }
}
const tabs: readonly [PrDetailTab, string][] = [
  ["overview", "Overview"],
  ["review", "Review"],
  ["sync", "Branch sync"],
  ["activity", "Activity"],
  ["settings", "PR settings"],
];

export function PrDetail({
  selectedId,
  card,
  details,
  work,
  error,
  tab,
  onTab,
  onBack,
  onOpen,
  onRetry,
  settings,
  historyBusy = false,
  onMoreHistory,
}: {
  readonly selectedId?: string;
  readonly card?: ManagedPrInboxCard;
  readonly details?: ManagedPrReadModel;
  readonly work?: ManagedPrWork;
  readonly error: string;
  readonly tab: PrDetailTab;
  readonly onTab: (tab: PrDetailTab) => void;
  readonly onBack: () => void;
  readonly onOpen: (target: OpenTarget) => void;
  readonly onRetry: () => void;
  readonly settings: ReactNode;
  readonly historyBusy?: boolean;
  readonly onMoreHistory?: () => void;
}) {
  if (card === undefined)
    return (
      <section
        className="pr-detail empty-detail"
        aria-label="Pull request details"
      >
        {selectedId === undefined ? (
          <p>Select a pull request to see its details</p>
        ) : (
          <>
            <p role={error === "" ? "status" : "alert"}>
              {error || "Loading pull request details."}
            </p>
            <button type="button" onClick={onBack}>
              Back to PR inbox
            </button>
            {error === "" ? null : (
              <button type="button" onClick={onRetry}>
                Retry details
              </button>
            )}
          </>
        )}
      </section>
    );
  return (
    <section className="pr-detail" aria-labelledby="selected-pr-heading">
      <header className="pr-detail-heading">
        <button type="button" className="narrow-back" onClick={onBack}>
          Back to PR inbox
        </button>
        <p>{card.reference}</p>
        <h2 id="selected-pr-heading">{card.title ?? card.reference}</h2>
        <p>{primaryLabels[card.primaryState]}</p>
        <nav role="tablist" aria-label="Pull request detail views">
          {tabs.map(([id, label]) => (
            <button
              type="button"
              key={id}
              role="tab"
              id={`pr-detail-tab-${id}`}
              aria-controls="pr-detail-panel"
              aria-selected={tab === id}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => onTab(id)}
              onKeyDown={(event) => {
                const index = tabs.findIndex(([value]) => value === id);
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? tabs.length - 1
                      : event.key === "ArrowRight"
                        ? (index + 1) % tabs.length
                        : event.key === "ArrowLeft"
                          ? (index + tabs.length - 1) % tabs.length
                          : undefined;
                if (next === undefined) return;
                event.preventDefault();
                const target = tabs[next]![0];
                onTab(target);
                const buttons =
                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                    '[role="tab"]',
                  );
                buttons?.[next]?.focus();
              }}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>
      <div
        className="pr-detail-content"
        role="tabpanel"
        id="pr-detail-panel"
        aria-labelledby={`pr-detail-tab-${tab}`}
        tabIndex={0}
        aria-label={`${card.reference} details`}
      >
        {error === "" ? null : (
          <p role="alert">
            {error}{" "}
            <button type="button" onClick={onRetry}>
              Retry details
            </button>
          </p>
        )}
        {tab === "overview" ? (
          <>
            <h3>Overview</h3>
            <p>{prSummary(card)}</p>
            {details === undefined && error === "" ? (
              <p role="status">Loading pull request details.</p>
            ) : null}
            {details === undefined ? null : (
              <dl className="profile-details">
                <div>
                  <dt>Base branch</dt>
                  <dd>
                    {details.baseRepository.owner}/{details.baseRepository.name}
                    : {details.prBaseBranch}
                    <br />
                    {details.prBaseSha}
                  </dd>
                </div>
                <div>
                  <dt>PR branch</dt>
                  <dd>
                    {details.headRepository.available
                      ? `${details.headRepository.owner}/${details.headRepository.name}`
                      : "Repository unavailable"}
                    : {details.prHeadBranch}
                    <br />
                    {details.prHeadSha}
                  </dd>
                </div>
                <div>
                  <dt>Local clone</dt>
                  <dd>
                    {details.localClone?.canonicalRoot ?? "No clone attached"}
                  </dd>
                </div>
                <div>
                  <dt>State updated</dt>
                  <dd>{new Date(card.stateUpdatedAt).toLocaleString()}</dd>
                </div>
              </dl>
            )}
            {card.synchronization === undefined ? null : (
              <p>
                Branch sync:{" "}
                {card.synchronization.status.toLowerCase().replaceAll("_", " ")}
                . Open Branch sync to inspect its saved result.
              </p>
            )}
            <button
              type="button"
              onClick={() =>
                onTab(card.primaryState === "WATCHING" ? "settings" : "review")
              }
            >
              {card.primaryState === "WATCHING"
                ? "Open PR settings"
                : "Inspect saved review"}
            </button>
            <details>
              <summary>Raw support data</summary>
              <pre tabIndex={0}>
                {JSON.stringify({ card, details }, null, 2)}
              </pre>
            </details>
          </>
        ) : null}
        {tab === "review" ? (
          <>
            <h3>Saved reviews</h3>
            {work === undefined ? (
              <p role="status">
                {error === ""
                  ? "Loading saved review history."
                  : "Saved review history could not be read."}
              </p>
            ) : work.reviews.length === 0 ? (
              <p>No saved review exists for this pull request yet.</p>
            ) : (
              work.reviews.map((review) => (
                <article key={review.bundleId}>
                  <p>
                    Saved review updated{" "}
                    {new Date(review.updatedAt).toLocaleString()}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      onOpen(savedWorkTarget("REVIEW_BUNDLE", review.bundleId))
                    }
                  >
                    Open full review workspace
                  </button>
                </article>
              ))
            )}
          </>
        ) : null}
        {tab === "sync" ? (
          <>
            <h3>Branch sync</h3>
            <p>
              Use the Inbox selection controls to inspect source and PR branch
              revisions before preparing a new batch.
            </p>
            {work === undefined ? (
              <p role="status">
                {error === ""
                  ? "Loading saved synchronization history."
                  : "Saved synchronization history could not be read."}
              </p>
            ) : work.synchronization.length === 0 ? (
              <p>
                No saved branch synchronization exists for this pull request
                yet.
              </p>
            ) : (
              work.synchronization.map((item, index) => (
                <article key={item.resultId}>
                  <p>Saved synchronization {index + 1}</p>
                  <button
                    type="button"
                    onClick={() =>
                      onOpen(
                        savedWorkTarget(
                          "SYNCHRONIZATION_RESULT",
                          item.resultId,
                        ),
                      )
                    }
                  >
                    Open synchronization result
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onOpen(
                        savedWorkTarget("SYNCHRONIZATION_BATCH", item.batchId),
                      )
                    }
                  >
                    Open batch
                  </button>
                </article>
              ))
            )}
          </>
        ) : null}
        {(tab === "review" || tab === "sync") &&
        work?.nextOffset !== undefined ? (
          <button type="button" disabled={historyBusy} onClick={onMoreHistory}>
            {historyBusy
              ? "Loading older saved work."
              : "Load older saved work"}
          </button>
        ) : null}
        {tab === "activity" ? (
          <ActivityViewer enabled managedPrId={card.id} onNavigate={onOpen} />
        ) : null}
        {tab === "settings" ? (
          details === undefined ? (
            <p role="status">
              {error === ""
                ? "Loading PR settings."
                : "PR settings could not be read."}
            </p>
          ) : (
            settings
          )
        ) : null}
      </div>
    </section>
  );
}
