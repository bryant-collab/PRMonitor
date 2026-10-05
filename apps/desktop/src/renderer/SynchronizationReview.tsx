import { customerExplanation } from "./customer-copy";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveSynchronizationTarget } from "./synchronization-target";
import type { F26RetryAction } from "../shared/f26-conflict-resolution";
import type { F25ChangeEvidence } from "../shared/f25-synchronization";
import type {
  F27BatchReview,
  F27ResultReview,
} from "../shared/f27-synchronization";

interface SynchronizationReviewProps {
  readonly batchId?: string;
  readonly resultId?: string;
  readonly visible?: boolean;
}

function label(value: string): string {
  return value.toLowerCase().replaceAll("_", " ");
}

function short(value: string | undefined): string {
  if (value === undefined || value.length <= 16) return value ?? "not recorded";
  return `${value.slice(0, 8)}…${value.slice(-7)}`;
}

function actionId(prefix: string): string {
  return `f27-${prefix}-${Date.now().toString(36)}`;
}

function ChangeEvidenceDetails({
  title,
  evidence,
}: {
  readonly title: string;
  readonly evidence: F25ChangeEvidence;
}) {
  return (
    <details>
      <summary>{title}</summary>
      <dl className="profile-details synchronization-evidence">
        <div>
          <dt>Base / tip</dt>
          <dd>
            {short(evidence.baseSha)} → {short(evidence.tipSha)}
          </dd>
        </div>
        <div>
          <dt>Evidence</dt>
          <dd>
            {evidence.files.length} file(s);{" "}
            {evidence.complete ? "complete" : "incomplete"};{" "}
            {short(evidence.patchHash ?? evidence.evidenceHash)}
          </dd>
        </div>
      </dl>
      {evidence.files.length > 0 ? (
        <ul>
          {evidence.files.map((file) => (
            <li key={`${file.path}:${file.oldPath ?? ""}`}>
              {file.kind}: {file.path}
              {file.oldPath === undefined ? "" : ` (from ${file.oldPath})`}
            </li>
          ))}
        </ul>
      ) : null}
      {evidence.patch !== undefined ? (
        <pre className="synchronization-diff" tabIndex={0}>
          {evidence.patch}
        </pre>
      ) : null}
    </details>
  );
}

export function SynchronizationReview({
  batchId,
  resultId,
  visible = true,
}: SynchronizationReviewProps) {
  const [batches, setBatches] = useState<readonly F27BatchReview[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState(batchId);
  const [result, setResult] = useState<F27ResultReview>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState<
    "CLEAR_ALL" | "CLEAR_AI_ONLY" | "KEEP_AND_CANCEL"
  >("KEEP_AND_CANCEL");
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [completeDiff, setCompleteDiff] = useState(false);
  const [noCodeChange, setNoCodeChange] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [conflictInput, setConflictInput] = useState("");
  const requestedTarget = useRef({ batchId, resultId });
  const readGeneration = useRef(0);

  const readResult = useCallback(async (operationId: string) => {
    const generation = ++readGeneration.current;
    requestedTarget.current = { resultId: operationId, batchId: undefined };
    setResult(undefined);
    const response =
      await window.prmonitor?.readSynchronizationReviewResult(operationId);
    if (generation !== readGeneration.current) return;
    if (
      response?.ok &&
      response.value.kind === "synchronization-review-result"
    ) {
      setResult(response.value.result);
      setError("");
    } else if (response?.ok === false) setError(response.error.message);
  }, []);

  const load = useCallback(async () => {
    const generation = ++readGeneration.current;
    const response = await window.prmonitor?.listSynchronizationReviews();
    if (generation !== readGeneration.current) return;
    if (
      response?.ok &&
      response.value.kind === "synchronization-review-batches"
    ) {
      setBatches(response.value.batches);
      const { batch: currentBatch, row } = resolveSynchronizationTarget(
        response.value.batches,
        requestedTarget.current,
      );
      if (currentBatch !== undefined) setSelectedBatchId(currentBatch.batchId);
      if (row !== undefined) await readResult(row.operationId);
      else {
        setResult(undefined);
        setSelectedBatchId(currentBatch?.batchId);
        setError("The requested branch synchronization work is unavailable.");
      }
      return;
    }
    if (response?.ok === false) setError(response.error.message);
  }, [readResult]);

  useEffect(() => {
    requestedTarget.current = { batchId, resultId };
    setResult(undefined);
    setSelectedBatchId(batchId);
    void load();
    return () => {
      ++readGeneration.current;
    };
  }, [batchId, resultId, load]);

  const selectedBatch = useMemo(
    () => batches.find((item) => item.batchId === selectedBatchId),
    [batches, selectedBatchId],
  );
  const selectedChoiceAllowed =
    result === undefined ||
    choice === "KEEP_AND_CANCEL" ||
    (choice === "CLEAR_ALL"
      ? result.capabilities.clearAll
      : result.capabilities.clearOnlyAi);

  const run = useCallback(
    async (operation: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await operation();
        await load();
      } catch {
        setError(
          "The synchronization review action did not complete. Re-read the result and reconcile before retrying.",
        );
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const refreshResult = useCallback(
    async (kind: "worktree" | "freshness") => {
      if (result === undefined) return;
      await run(async () => {
        const response =
          kind === "worktree"
            ? await window.prmonitor?.refreshSynchronizationWorktree(
                result.operationId,
                result.revision,
              )
            : await window.prmonitor?.refreshSynchronizationFreshness({
                operationId: result.operationId,
                expectedRevision: result.revision,
              });
        if (
          response?.ok &&
          response.value.kind === "synchronization-review-result"
        )
          setResult(response.value.result);
        else if (response?.ok === false) setError(response.error.message);
      });
    },
    [result, run],
  );

  const actOnWorktree = useCallback(async () => {
    if (result === undefined) return;
    await run(async () => {
      const response = await window.prmonitor?.actOnSynchronizationWorktree({
        operationId: result.operationId,
        actionId: actionId("worktree"),
        choice,
        expectedRevision: result.revision,
        ...(choice === "CLEAR_ALL" ? { confirmed: confirmClearAll } : {}),
      });
      if (
        response?.ok &&
        response.value.kind === "synchronization-review-action"
      )
        setResult(response.value.result);
      else if (response?.ok === false) setError(response.error.message);
    });
  }, [choice, confirmClearAll, result, run]);

  const reevaluate = useCallback(async () => {
    if (result === undefined) return;
    await run(async () => {
      const response = await window.prmonitor?.reevaluateSynchronization({
        operationId: result.operationId,
        expectedRevision: result.revision,
        actionId: actionId("reevaluate"),
        choice,
        ...(choice === "CLEAR_ALL" ? { confirmed: confirmClearAll } : {}),
      });
      if (
        response?.ok &&
        response.value.kind === "synchronization-review-action"
      )
        setResult(response.value.result);
      else if (response?.ok === false) setError(response.error.message);
    });
  }, [choice, confirmClearAll, result, run]);

  const discard = useCallback(async () => {
    if (result === undefined) return;
    await run(async () => {
      const response = await window.prmonitor?.discardSynchronizationResult(
        result.operationId,
        result.revision,
      );
      if (
        response?.ok &&
        response.value.kind === "synchronization-review-action"
      )
        setResult(response.value.result);
      else if (response?.ok === false) setError(response.error.message);
    });
  }, [result, run]);

  const retryConflict = useCallback(
    async (kind: F26RetryAction["kind"]) => {
      if (result === undefined) return;
      const value = conflictInput.trim();
      if (
        (kind === "USER_ANSWER" || kind === "USER_DIRECTION") &&
        value === ""
      ) {
        setError("Enter the requested answer or direction before submitting.");
        return;
      }
      const action: F26RetryAction = {
        kind,
        ...(kind === "USER_ANSWER" ? { answer: value } : {}),
        ...(kind === "USER_DIRECTION" ? { direction: value } : {}),
        ...(kind === "MANUAL_EDIT_CONFIRMED"
          ? { manualEditConfirmed: true }
          : {}),
      };
      await run(async () => {
        const response = await window.prmonitor?.retrySynchronizationConflict(
          result.operationId,
          action,
          result.sourceVersion,
        );
        if (response?.ok === false) setError(response.error.message);
        else setConflictInput("");
      });
    },
    [conflictInput, result, run],
  );

  const approve = useCallback(async () => {
    if (result === undefined || !completeDiff) return;
    await run(async () => {
      const response =
        await window.prmonitor?.approveSynchronizationPublication({
          operationId: result.operationId,
          expectedRevision: result.revision,
          approvalId: actionId("approval"),
          idempotencyKey: `f27-publish-${result.operationId}`,
          candidateHash: result.candidateHash,
          commitMessage:
            commitMessage.trim() ||
            `Synchronize ${result.input.row.syncSourceBranch} into ${result.input.row.prHeadBranch}`,
          completeDiffAcknowledged: true,
          noCodeChangeAcknowledged:
            result.mergeOutcome === "NO_OP" ? noCodeChange : true,
        });
      if (
        response?.ok &&
        response.value.kind === "synchronization-review-publication"
      )
        setResult(response.value.result);
      else if (response?.ok === false) setError(response.error.message);
    });
  }, [commitMessage, completeDiff, noCodeChange, result, run]);

  const publish = useCallback(
    async (reconcile: boolean) => {
      if (result === undefined || result.publication === undefined) return;
      await run(async () => {
        const input = {
          operationId: result.operationId,
          idempotencyKey: result.publication!.idempotencyKey,
        };
        const response = reconcile
          ? await window.prmonitor?.reconcileSynchronizationPublication(input)
          : await window.prmonitor?.publishSynchronizationPublication(input);
        if (
          response?.ok &&
          response.value.kind === "synchronization-review-publication"
        )
          setResult(response.value.result);
        else if (response?.ok === false) setError(response.error.message);
      });
    },
    [result, run],
  );

  if (batches.length === 0 && result === undefined && error === "") return null;

  if (!visible) return null;
  return (
    <section
      className="synchronization-review"
      aria-labelledby="synchronization-review-heading"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">synchronization review result review</p>
          <h2 id="synchronization-review-heading">Synchronization results</h2>
        </div>
        <button type="button" onClick={() => void load()} disabled={busy}>
          Refresh results
        </button>
      </div>
      {error !== "" ? (
        <p className="form-message" role="alert">
          {error}
        </p>
      ) : null}
      {batches.length > 0 ? (
        <div className="synchronization-review-layout">
          <nav
            aria-label="Synchronization batches"
            className="synchronization-batch-list"
          >
            {batches.map((batch) => (
              <button
                type="button"
                className={
                  batch.batchId === selectedBatchId
                    ? "review-row selected"
                    : "review-row"
                }
                key={batch.batchId}
                onClick={() => {
                  setSelectedBatchId(batch.batchId);
                  const first = batch.rows[0];
                  if (first !== undefined) void readResult(first.operationId);
                }}
              >
                <span>{short(batch.batchId)}</span>
                <span>
                  {batch.counts.ready} ready · {batch.counts.attention}{" "}
                  attention
                </span>
              </button>
            ))}
          </nav>
          <div className="synchronization-review-content">
            {selectedBatch !== undefined ? (
              <>
                <p className="section-help">
                  Batch {short(selectedBatch.batchId)} ·{" "}
                  {selectedBatch.counts.total} results ·{" "}
                  {selectedBatch.counts.published} published ·{" "}
                  {selectedBatch.counts.stale} stale
                </p>
                <nav
                  aria-label="Results in selected synchronization batch"
                  className="synchronization-result-list"
                >
                  {selectedBatch.rows.map((row) => (
                    <button
                      type="button"
                      className={
                        row.operationId === result?.operationId
                          ? "review-row selected"
                          : "review-row"
                      }
                      key={row.operationId}
                      onClick={() => void readResult(row.operationId)}
                    >
                      <span>{short(row.operationId)}</span>
                      <span>
                        {label(row.status)} · {row.reason.what}
                      </span>
                    </button>
                  ))}
                </nav>
              </>
            ) : null}
            {result === undefined ? (
              <p className="empty-state">
                Select a synchronization result to review its exact evidence.
              </p>
            ) : (
              <article
                className="synchronization-result-card"
                aria-labelledby="synchronization-result-heading"
              >
                <div className="profile-card-heading">
                  <div>
                    <p className="eyebrow">{short(result.managedPrId)}</p>
                    <h3 id="synchronization-result-heading">
                      {label(result.status)}
                    </h3>
                  </div>
                  <span className="status-pill">
                    {label(result.mergeOutcome)}
                  </span>
                </div>
                <p className="profile-reason" role="status">
                  {customerExplanation(
                    result.reason.what,
                    "Inspect this saved result before taking the next action.",
                  )}{" "}
                  Next action: {label(result.nextAction)}.
                </p>
                <dl className="profile-details synchronization-evidence">
                  <div>
                    <dt>Source repository / branch</dt>
                    <dd>
                      {result.input.row.sourceRepository.key} /{" "}
                      {result.input.row.syncSourceBranch}
                    </dd>
                  </div>
                  <div>
                    <dt>Destination repository / branch</dt>
                    <dd>
                      {result.input.row.destinationRepository.key} /{" "}
                      {result.input.row.prHeadBranch}
                    </dd>
                  </div>
                  <div>
                    <dt>Source SHA</dt>
                    <dd>{short(result.input.row.syncSourceSha)}</dd>
                  </div>
                  <div>
                    <dt>PR head SHA</dt>
                    <dd>{short(result.input.row.prHeadSha)}</dd>
                  </div>
                  <div>
                    <dt>Merge base</dt>
                    <dd>{short(result.mergeBaseSha)}</dd>
                  </div>
                  <div>
                    <dt>Validation</dt>
                    <dd>{result.validation?.status ?? "not recorded"}</dd>
                  </div>
                  <div>
                    <dt>AI usage</dt>
                    <dd>
                      {result.aiUsage.providerInvoked
                        ? `${result.aiUsage.turns} turn(s)`
                        : "none"}
                    </dd>
                  </div>
                  <div>
                    <dt>Freshness</dt>
                    <dd>{result.freshness?.outcome ?? "not checked"}</dd>
                  </div>
                  <div>
                    <dt>Candidate hash</dt>
                    <dd>{short(result.candidateHash)}</dd>
                  </div>
                </dl>
                {result.sourceChangeEvidence !== undefined ? (
                  <ChangeEvidenceDetails
                    title="Source-side change evidence"
                    evidence={result.sourceChangeEvidence}
                  />
                ) : null}
                {result.prHeadChangeEvidence !== undefined ? (
                  <ChangeEvidenceDetails
                    title="PR-head-side change evidence"
                    evidence={result.prHeadChangeEvidence}
                  />
                ) : null}
                {result.worktree?.condition !== undefined ? (
                  <details>
                    <summary>Canonical worktree condition evidence</summary>
                    <dl className="profile-details synchronization-evidence">
                      <div>
                        <dt>Classification</dt>
                        <dd>
                          {label(result.worktree.condition.classification)}
                        </dd>
                      </div>
                      <div>
                        <dt>Fingerprint / revision</dt>
                        <dd>
                          {short(result.worktree.condition.currentFingerprint)}{" "}
                          / {short(result.worktree.condition.observedRevision)}
                        </dd>
                      </div>
                      <div>
                        <dt>Dirty paths</dt>
                        <dd>
                          {
                            result.worktree.condition.dirtySummary.changedPaths
                              .length
                          }
                        </dd>
                      </div>
                      <div>
                        <dt>Attribution</dt>
                        <dd>
                          {
                            result.worktree.condition.attribution
                              .aiAttributedPaths.length
                          }{" "}
                          AI-attributed,{" "}
                          {
                            result.worktree.condition.attribution
                              .unAttributedPaths.length
                          }{" "}
                          unattributed,{" "}
                          {
                            result.worktree.condition.attribution.overlapPaths
                              .length
                          }{" "}
                          overlap
                        </dd>
                      </div>
                    </dl>
                    {result.worktree.condition.dirtySummary.changedPaths
                      .length > 0 ? (
                      <ul>
                        {result.worktree.condition.dirtySummary.changedPaths.map(
                          (path) => (
                            <li key={path}>{path}</li>
                          ),
                        )}
                      </ul>
                    ) : null}
                  </details>
                ) : null}
                {result.conflicts.length > 0 ? (
                  <div
                    className="synchronization-conflicts"
                    aria-label="Synchronization conflicts"
                  >
                    <h4>Conflict paths</h4>
                    <ul>
                      {result.conflicts.map((conflict) => (
                        <li key={conflict.path}>{conflict.path}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {result.conflictResolution !== undefined ? (
                  <section
                    className="synchronization-conflict-review"
                    aria-labelledby="synchronization-conflict-review-heading"
                  >
                    <h4 id="synchronization-conflict-review-heading">
                      Semantic conflict review
                    </h4>
                    <dl className="profile-details synchronization-evidence">
                      <div>
                        <dt>Resolution status</dt>
                        <dd>{label(result.conflictResolution.status)}</dd>
                      </div>
                      <div>
                        <dt>Required next action</dt>
                        <dd>{label(result.conflictResolution.nextAction)}</dd>
                      </div>
                      <div>
                        <dt>AI task profile</dt>
                        <dd>
                          {result.conflictResolution.taskProfile.providerId} /{" "}
                          {result.conflictResolution.taskProfile.modelId} ·{" "}
                          {
                            result.conflictResolution.taskProfile
                              .configuredTurnBudget
                          }{" "}
                          turn budget
                        </dd>
                      </div>
                      <div>
                        <dt>Recorded AI usage</dt>
                        <dd>
                          {result.conflictResolution.usage.turns} turn(s),{" "}
                          {result.conflictResolution.usage.tokens} token(s)
                        </dd>
                      </div>
                    </dl>
                    {result.conflictResolution.consultationHistory.length >
                    0 ? (
                      <details>
                        <summary>
                          Consultation and competing-intent evidence
                        </summary>
                        {result.conflictResolution.consultationHistory.map(
                          (consultation) => (
                            <div
                              className="profile-reason"
                              key={consultation.id}
                            >
                              <strong>{label(consultation.kind)}</strong>
                              {consultation.question !== undefined ? (
                                <p>Question: {consultation.question}</p>
                              ) : null}
                              {consultation.competingIntents.length > 0 ? (
                                <ul>
                                  {consultation.competingIntents.map(
                                    (intent) => (
                                      <li key={intent}>{intent}</li>
                                    ),
                                  )}
                                </ul>
                              ) : null}
                            </div>
                          ),
                        )}
                      </details>
                    ) : null}
                    {result.conflictResolution.turnHistory.length > 0 ? (
                      <details>
                        <summary>Complete recorded turn reports</summary>
                        <ul>
                          {result.conflictResolution.turnHistory.map((turn) => (
                            <li key={turn.turnId}>
                              {turn.turnId}: {turn.providerStatus};{" "}
                              {turn.changedPaths.length} changed path(s);{" "}
                              {turn.remainingIssues.length} remaining issue(s)
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                    {result.conflictResolution.status === "AMBIGUOUS" ||
                    result.conflictResolution.status === "BLOCKED" ||
                    result.conflictResolution.status === "NEEDS_ATTENTION" ? (
                      <div className="synchronization-choice">
                        <label>
                          <span>Answer or direction</span>
                          <textarea
                            value={conflictInput}
                            onChange={(event) =>
                              setConflictInput(event.target.value)
                            }
                            maxLength={8_000}
                            rows={4}
                          />
                        </label>
                        <div className="synchronization-actions">
                          <button
                            type="button"
                            onClick={() => void retryConflict("USER_ANSWER")}
                            disabled={busy || conflictInput.trim() === ""}
                          >
                            Submit answer
                          </button>
                          <button
                            type="button"
                            onClick={() => void retryConflict("USER_DIRECTION")}
                            disabled={busy || conflictInput.trim() === ""}
                          >
                            Submit direction
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void retryConflict("MANUAL_EDIT_CONFIRMED")
                            }
                            disabled={busy}
                          >
                            Confirm manual edit
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void retryConflict("RETRY_RESOLUTION")
                            }
                            disabled={busy}
                          >
                            Retry resolution
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </section>
                ) : null}
                <div
                  className="synchronization-actions"
                  aria-label="Synchronization result actions"
                >
                  <button
                    type="button"
                    onClick={() => void refreshResult("freshness")}
                    disabled={busy || !result.capabilities.refreshFreshness}
                  >
                    Refresh remote freshness
                  </button>
                  <button
                    type="button"
                    onClick={() => void refreshResult("worktree")}
                    disabled={busy || !result.capabilities.inspect}
                  >
                    Refresh worktree evidence
                  </button>
                  <button
                    type="button"
                    onClick={() => void discard()}
                    disabled={busy || !result.capabilities.discard}
                  >
                    Discard result
                  </button>
                </div>
                {result.worktree !== undefined &&
                result.status !== "PUBLISHED" ? (
                  <fieldset className="synchronization-choice">
                    <legend>Worktree decision</legend>
                    <label>
                      <span>Choice</span>
                      <select
                        value={choice}
                        onChange={(event) =>
                          setChoice(event.target.value as typeof choice)
                        }
                      >
                        <option
                          value="CLEAR_ALL"
                          disabled={!result.capabilities.clearAll}
                        >
                          Clear All Changes
                        </option>
                        <option
                          value="CLEAR_AI_ONLY"
                          disabled={!result.capabilities.clearOnlyAi}
                        >
                          Clear Only AI Changes
                        </option>
                        <option value="KEEP_AND_CANCEL">
                          Keep Worktree and Cancel
                        </option>
                      </select>
                    </label>
                    {choice === "CLEAR_ALL" ? (
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={confirmClearAll}
                          onChange={(event) =>
                            setConfirmClearAll(event.target.checked)
                          }
                        />{" "}
                        I understand Clear All is destructive.
                      </label>
                    ) : null}
                    <div className="synchronization-actions">
                      <button
                        type="button"
                        onClick={() => void actOnWorktree()}
                        disabled={
                          busy ||
                          !selectedChoiceAllowed ||
                          (choice === "CLEAR_ALL" && !confirmClearAll)
                        }
                      >
                        Apply worktree choice
                      </button>
                      <button
                        type="button"
                        onClick={() => void reevaluate()}
                        disabled={
                          busy ||
                          !result.capabilities.reEvaluate ||
                          !selectedChoiceAllowed ||
                          (choice === "CLEAR_ALL" && !confirmClearAll)
                        }
                      >
                        Re-evaluate from current refs
                      </button>
                    </div>
                  </fieldset>
                ) : null}
                {result.capabilities.approvePublication ? (
                  <fieldset className="synchronization-choice">
                    <legend>Approve merge publication</legend>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={completeDiff}
                        onChange={(event) =>
                          setCompleteDiff(event.target.checked)
                        }
                      />{" "}
                      I reviewed the complete bounded diff evidence.
                    </label>
                    {result.mergeOutcome === "NO_OP" ? (
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={noCodeChange}
                          onChange={(event) =>
                            setNoCodeChange(event.target.checked)
                          }
                        />{" "}
                        I acknowledge this is a no-code-change result.
                      </label>
                    ) : null}
                    <label>
                      <span>Commit message</span>
                      <input
                        value={commitMessage}
                        onChange={(event) =>
                          setCommitMessage(event.target.value)
                        }
                        maxLength={512}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void approve()}
                      disabled={
                        busy ||
                        !completeDiff ||
                        (result.mergeOutcome === "NO_OP" && !noCodeChange)
                      }
                    >
                      Approve publication
                    </button>
                  </fieldset>
                ) : null}
                {result.publication !== undefined ? (
                  <div className="synchronization-choice">
                    <h4>Publication</h4>
                    <p>
                      {label(result.publication.phase)} ·{" "}
                      {label(result.publication.recoveryState)}
                      {result.publication.commitSha
                        ? ` · ${short(result.publication.commitSha)}`
                        : ""}
                    </p>
                    <div className="synchronization-actions">
                      <button
                        type="button"
                        onClick={() => void publish(false)}
                        disabled={busy || !result.capabilities.publish}
                      >
                        Publish merge
                      </button>
                      <button
                        type="button"
                        onClick={() => void publish(true)}
                        disabled={busy || !result.capabilities.reconcile}
                      >
                        Reconcile publication
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            )}
          </div>
        </div>
      ) : null}
      <details>
        <summary>Raw support data</summary>
        <pre tabIndex={0}>{JSON.stringify({ batches, result }, null, 2)}</pre>
      </details>
    </section>
  );
}
