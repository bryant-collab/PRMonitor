import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  F20ActionId,
  F20DecisionDisposition,
  F20DiffMode,
  F20DiffView,
  F20WorkspaceItem,
  F20WorkspaceReadModel,
} from "../shared/f20-workspace";
import type {
  F21ConversationMode,
  F21ConversationReadModel,
} from "../shared/f21-conversation";
import type {
  F22DiscardPreview,
  F22ReevaluationPreview,
} from "../shared/f22-discard-reevaluation";
import { F22ChoiceControls } from "./F22ChoiceControls";

interface ReviewBundleWorkspaceProps {
  readonly bundleId: string;
}

const diffModes: readonly {
  readonly id: F20DiffMode;
  readonly label: string;
}[] = [
  { id: "RELEVANT", label: "Relevant Diff" },
  { id: "PROPOSED_WORKTREE", label: "Proposed Worktree Diff" },
  { id: "PR_CONTEXT", label: "PR Context Diff" },
];

const dispositions: readonly F20DecisionDisposition[] = [
  "fixed",
  "pushback",
  "question",
  "no_change",
];

function readable(value: string): string {
  return value.toLowerCase().replaceAll("_", " ");
}

function action(
  workspace: F20WorkspaceReadModel,
  id: F20ActionId,
): F20WorkspaceReadModel["actions"][number] | undefined {
  return workspace.actions.find((candidate) => candidate.id === id);
}

function formatTimestamp(value: string | undefined): string {
  if (value === undefined) return "Not recorded";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(parsed);
}

function itemLabel(item: F20WorkspaceItem): string {
  if (item.decisionStatus === "UNDECIDED") return "Undecided";
  if (item.decisionStatus === "QUESTION_NEEDS_ANSWER")
    return "Question needs answer";
  return readable(item.decisionStatus);
}

function responseError(response: {
  readonly ok: boolean;
  readonly error?: { readonly message: string };
}): string {
  return response.ok
    ? "The main process returned an invalid Review Bundle response."
    : (response.error?.message ?? "The Review Bundle action failed safely.");
}

function DiffLines({
  view,
  fileActionsEnabled = false,
  onCopy = () => undefined,
  onFileAction = () => undefined,
}: {
  readonly view: F20DiffView;
  readonly fileActionsEnabled?: boolean;
  readonly onCopy?: () => void;
  readonly onFileAction?: (
    action: "OPEN_FILE" | "REVEAL_FILE",
    path: string,
  ) => void;
}) {
  const [showContext, setShowContext] = useState(false);
  return (
    <>
      <div className="review-diff-toolbar">
        <p className="review-diff-message" role="status">
          {view.message}
        </p>
        <button
          type="button"
          className="secondary-button"
          onClick={() => setShowContext((current) => !current)}
        >
          {showContext
            ? "Collapse unchanged context"
            : "Show unchanged context"}
        </button>
        <button type="button" className="secondary-button" onClick={onCopy}>
          Copy displayed diff
        </button>
      </div>
      {view.files.length === 0 ? (
        <p className="review-empty" role="status">
          No file content is available in this diff view.
        </p>
      ) : (
        <div className="review-diff-files" aria-label="Diff files">
          {view.files.map((file, fileIndex) => (
            <article
              className="review-diff-file"
              id={`review-diff-file-${fileIndex}`}
              key={`${file.path}-${fileIndex}`}
              data-syntax={file.syntax}
            >
              <header className="review-diff-file-heading">
                <div>
                  <h4>{file.path}</h4>
                  {file.oldPath !== undefined ? (
                    <p>Renamed from {file.oldPath}</p>
                  ) : null}
                </div>
                <div className="review-diff-file-actions">
                  <span
                    className="review-diff-marker"
                    aria-label={`File marker ${file.marker}`}
                  >
                    {file.marker}
                  </span>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={!fileActionsEnabled || file.binary}
                    onClick={() => onFileAction("OPEN_FILE", file.path)}
                  >
                    Open file
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={!fileActionsEnabled}
                    onClick={() => onFileAction("REVEAL_FILE", file.path)}
                  >
                    Reveal file
                  </button>
                </div>
              </header>
              {file.binary ? (
                <p className="review-diff-binary">
                  Binary file; line content is not rendered.
                </p>
              ) : file.hunks.length === 0 ? (
                <p className="review-diff-binary">
                  File metadata is available; no text hunks were supplied.
                </p>
              ) : (
                <div className="review-diff-hunks">
                  {file.hunks.map((hunk) => (
                    <section className="review-diff-hunk" key={hunk.hunkId}>
                      <h5>{hunk.header}</h5>
                      <div
                        className="review-diff-lines"
                        role="table"
                        aria-label={`${file.path} ${hunk.header}`}
                      >
                        {hunk.lines.map((line) => {
                          const isContext = line.kind === "CONTEXT";
                          return (
                            <div
                              className={`review-diff-line review-diff-line-${line.kind.toLowerCase()}${isContext && !showContext ? " review-diff-line-context-collapsed" : ""}`}
                              key={line.lineId}
                              role="row"
                            >
                              <span
                                className="review-diff-line-number"
                                aria-label="Old line"
                              >
                                {line.oldLine ?? ""}
                              </span>
                              <span
                                className="review-diff-line-number"
                                aria-label="New line"
                              >
                                {line.newLine ?? ""}
                              </span>
                              <code className="review-diff-line-text">
                                {line.text}
                              </code>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {view.untrackedFiles.length > 0 ? (
        <p className="review-evidence-note">
          Untracked files: {view.untrackedFiles.join(", ")}
        </p>
      ) : null}
    </>
  );
}

function ValidationPanel({
  label,
  validation,
}: {
  readonly label: string;
  readonly validation: F20WorkspaceReadModel["baselineValidation"];
}) {
  if (validation === undefined) return null;
  return (
    <section
      className="review-evidence-panel"
      aria-labelledby={`validation-${label}`}
    >
      <h3 id={`validation-${label}`}>{label} validation</h3>
      <p
        className={`review-validation-status review-validation-${validation.status}`}
      >
        Deterministic result: {readable(validation.status)}
      </p>
      <dl className="review-evidence-grid">
        <div>
          <dt>Phase</dt>
          <dd>{readable(validation.phase)}</dd>
        </div>
        <div>
          <dt>Run</dt>
          <dd>{validation.runId}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{formatTimestamp(validation.startedAt)}</dd>
        </div>
        <div>
          <dt>Completed</dt>
          <dd>{formatTimestamp(validation.completedAt)}</dd>
        </div>
        <div>
          <dt>Next action</dt>
          <dd>{readable(validation.nextAction)}</dd>
        </div>
      </dl>
      {validation.reason !== undefined ? (
        <p className="review-evidence-note">
          Reason: {readable(validation.reason)}
        </p>
      ) : null}
      {validation.steps.length === 0 ? (
        <p className="review-empty">No validation steps were recorded.</p>
      ) : (
        <div className="review-validation-steps">
          {validation.steps.map((step) => (
            <article className="review-validation-step" key={step.stepId}>
              <h4>{step.stepId}</h4>
              <p>
                {readable(step.status)} · {readable(step.kind)}
              </p>
              {step.command !== undefined ? (
                <code className="review-command">
                  {[step.command.executable, ...(step.command.arguments ?? [])]
                    .filter(Boolean)
                    .join(" ")}
                </code>
              ) : null}
              {step.workingDirectory !== undefined ? (
                <p>Working directory: {step.workingDirectory}</p>
              ) : null}
              {step.exitCode !== undefined ? (
                <p>Exit code: {step.exitCode ?? "not reported"}</p>
              ) : null}
              {step.stdout !== undefined ? (
                <details>
                  <summary>stdout</summary>
                  <pre>{step.stdout}</pre>
                </details>
              ) : null}
              {step.stderr !== undefined ? (
                <details>
                  <summary>stderr</summary>
                  <pre>{step.stderr}</pre>
                </details>
              ) : null}
            </article>
          ))}
        </div>
      )}
      {validation.manualAttestations.length > 0 ? (
        <ul className="review-evidence-list">
          {validation.manualAttestations.map((attestation) => (
            <li key={attestation.checkId}>
              {attestation.checkId}: {readable(attestation.outcome)}
            </li>
          ))}
        </ul>
      ) : null}
      {validation.warningCodes.length > 0 ? (
        <p className="review-evidence-note">
          Warnings: {validation.warningCodes.join(", ")}
        </p>
      ) : null}
    </section>
  );
}

export function ReviewBundleWorkspace({
  bundleId,
}: ReviewBundleWorkspaceProps) {
  const [workspace, setWorkspace] = useState<F20WorkspaceReadModel>();
  const [conversation, setConversation] = useState<F21ConversationReadModel>();
  const [selectedItemId, setSelectedItemId] = useState<string>();
  const [diffMode, setDiffMode] = useState<F20DiffMode>("PROPOSED_WORKTREE");
  const [diff, setDiff] = useState<F20DiffView>();
  const [loading, setLoading] = useState(true);
  const [diffLoading, setDiffLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [actionMessage, setActionMessage] = useState("");
  const [answer, setAnswer] = useState("");
  const [overrideDisposition, setOverrideDisposition] =
    useState<F20DecisionDisposition>("no_change");
  const [overrideInstruction, setOverrideInstruction] = useState("");
  const [draftText, setDraftText] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationMode, setConversationMode] = useState<F21ConversationMode>(
    "READ_ONLY_CONVERSATION",
  );
  const [conversationText, setConversationText] = useState("");
  const [acknowledgeUnattributed, setAcknowledgeUnattributed] = useState(false);
  const [newOperationBudget, setNewOperationBudget] = useState(1);
  const [f22Preview, setF22Preview] = useState<
    F22DiscardPreview | F22ReevaluationPreview | undefined
  >();
  const [f22Choice, setF22Choice] = useState<
    "NO_CHANGES" | "CLEAR_ALL" | "CLEAR_AI_ONLY" | "KEEP_AND_CANCEL"
  >("NO_CHANGES");
  const [f22Confirmed, setF22Confirmed] = useState(false);
  const [f22ActionId, setF22ActionId] = useState<string>();
  const [
    f22SelectedRetainedEventVersionIds,
    setF22SelectedRetainedEventVersionIds,
  ] = useState<string[]>([]);

  const selectedItem = useMemo(
    () => workspace?.items.find((item) => item.itemId === selectedItemId),
    [selectedItemId, workspace],
  );

  const readWorkspace = useCallback(async () => {
    const bridge = window.prmonitor;
    if (bridge === undefined) {
      setError(
        "The renderer bridge is unavailable. Reopen PRMonitor to retry.",
      );
      setLoading(false);
      return;
    }
    setLoading(true);
    const response = await bridge.readReviewBundle(bundleId);
    if (response.ok && response.value.kind === "review-bundle-workspace") {
      const nextWorkspace = response.value.workspace;
      setWorkspace(nextWorkspace);
      const pendingF22 = nextWorkspace.f22PendingAction;
      if (
        pendingF22?.status === "PENDING" &&
        pendingF22.phase === "PREVIEW_READY" &&
        pendingF22.preview !== undefined
      ) {
        setF22ActionId(pendingF22.actionId);
        setF22Preview(pendingF22.preview);
        setF22Choice(pendingF22.preview.requiredChoice);
        setF22SelectedRetainedEventVersionIds(
          pendingF22.preview.kind === "F22_REEVALUATION_PREVIEW"
            ? [...pendingF22.preview.selectedRetainedEventVersionIds]
            : [],
        );
        setF22Confirmed(false);
      } else if (pendingF22?.status === "PENDING") {
        setF22ActionId(pendingF22.actionId);
        setF22Preview(undefined);
        setF22SelectedRetainedEventVersionIds([]);
      } else {
        setF22ActionId(undefined);
        setF22Preview(undefined);
        setF22SelectedRetainedEventVersionIds([]);
      }
      setSelectedItemId((current) =>
        nextWorkspace.items.some((item) => item.itemId === current)
          ? current
          : nextWorkspace.items[0]?.itemId,
      );
      setError(undefined);
      const conversationResponse =
        await bridge.readReviewBundleConversation(bundleId);
      if (
        conversationResponse.ok &&
        conversationResponse.value.kind === "review-bundle-conversation"
      )
        setConversation(conversationResponse.value.conversation);
    } else {
      setError(responseError(response));
    }
    setLoading(false);
  }, [bundleId]);

  useEffect(() => {
    setDiff(undefined);
    setWorkspace(undefined);
    setConversation(undefined);
    setSelectedItemId(undefined);
    void readWorkspace();
  }, [readWorkspace]);

  useEffect(() => {
    if (selectedItem === undefined) return;
    setAnswer(selectedItem.decision.answer ?? "");
    setOverrideDisposition(
      selectedItem.decision.decision === "pending"
        ? selectedItem.recommendation.disposition
        : selectedItem.decision.finalDisposition,
    );
    setOverrideInstruction(selectedItem.decision.instruction ?? "");
    setDraftText(
      selectedItem.responseDraft ?? selectedItem.proposedResponse ?? "",
    );
  }, [selectedItem]);

  const runDecision = useCallback(
    async (input: {
      readonly decision: "accepted" | "overridden";
      readonly finalDisposition: F20DecisionDisposition;
      readonly instruction?: string;
      readonly answer?: string;
    }) => {
      if (workspace === undefined || selectedItem === undefined || busy) return;
      if (
        input.finalDisposition === "question" &&
        input.answer?.trim() === ""
      ) {
        setActionMessage(
          "This question needs a bounded answer before the decision can be saved.",
        );
        return;
      }
      setBusy(true);
      setActionMessage("");
      const response = await window.prmonitor?.recordReviewBundleDecision({
        bundleId: workspace.bundleId,
        itemId: selectedItem.itemId,
        decision: input.decision,
        finalDisposition: input.finalDisposition,
        ...(input.instruction === undefined || input.instruction.length === 0
          ? {}
          : { instruction: input.instruction }),
        ...(input.answer === undefined || input.answer.length === 0
          ? {}
          : { answer: input.answer }),
        expectedVersion: workspace.version,
        actionId: `renderer-decision-${workspace.bundleId}-${selectedItem.itemId}-${input.decision}-${input.finalDisposition}`,
      });
      if (response?.ok && response.value.kind === "review-bundle-workspace") {
        setWorkspace(response.value.workspace);
        setActionMessage(
          "The human decision was committed. Original recommendation remains available.",
        );
      } else if (response !== undefined) {
        setActionMessage(responseError(response));
        await readWorkspace();
      }
      setBusy(false);
    },
    [busy, readWorkspace, selectedItem, workspace],
  );

  const confirmDecisions = useCallback(async () => {
    if (workspace === undefined || busy) return;
    const capability = action(workspace, "CONFIRM_DECISIONS");
    if (!capability?.enabled) {
      setActionMessage(
        capability?.explanation ??
          "Every item and question must be complete first.",
      );
      return;
    }
    setBusy(true);
    const response = await window.prmonitor?.confirmReviewBundleDecisions(
      workspace.bundleId,
      workspace.version,
      `renderer-confirm-${workspace.bundleId}-${workspace.version}`,
    );
    if (response?.ok && response.value.kind === "review-bundle-workspace") {
      setWorkspace(response.value.workspace);
      setActionMessage(
        "The owning review workflow accepted the complete human decision set.",
      );
    } else if (response !== undefined) {
      setActionMessage(responseError(response));
      await readWorkspace();
    }
    setBusy(false);
  }, [busy, readWorkspace, workspace]);

  const saveDraft = useCallback(async () => {
    if (workspace === undefined || selectedItem === undefined || busy) return;
    if (draftText.trim().length === 0) {
      setActionMessage("A response draft cannot be empty.");
      return;
    }
    setBusy(true);
    const response = await window.prmonitor?.saveReviewBundleDraft({
      bundleId: workspace.bundleId,
      eventVersionId: selectedItem.eventVersionId,
      text: draftText,
      expectedVersion: workspace.version,
      actionId: `renderer-draft-${workspace.bundleId}-${selectedItem.eventVersionId}-${workspace.version}`,
    });
    if (response?.ok && response.value.kind === "review-bundle-workspace") {
      setWorkspace(response.value.workspace);
      setActionMessage(
        "Draft saved locally for later publication approval; nothing was posted.",
      );
    } else if (response !== undefined) {
      setActionMessage(responseError(response));
      await readWorkspace();
    }
    setBusy(false);
  }, [busy, draftText, readWorkspace, selectedItem, workspace]);

  const saveProposalInput = useCallback(
    async (
      kind: "APPLY_QUESTION_ANSWER" | "SAVE_ENTRY_INSTRUCTION",
      text: string,
    ) => {
      if (workspace === undefined || selectedItem === undefined || busy) return;
      if (text.trim().length === 0) {
        setActionMessage("Proposal input cannot be empty.");
        return;
      }
      setBusy(true);
      const commandId = `renderer-proposal-input-${workspace.bundleId}-${selectedItem.itemId}-${Date.now()}`;
      const response = await window.prmonitor?.saveReviewBundleProposalInput({
        schemaVersion: 1,
        commandId,
        bundleId: workspace.bundleId,
        itemId: selectedItem.itemId,
        kind,
        text,
        expectedBundleVersion: workspace.version,
        actionId: commandId,
        createdAt: new Date().toISOString(),
      });
      if (
        response?.ok &&
        response.value.kind === "review-bundle-conversation"
      ) {
        setConversation(response.value.conversation);
        await readWorkspace();
        setActionMessage(
          kind === "APPLY_QUESTION_ANSWER"
            ? "The answer was applied explicitly to this proposal item."
            : "The entry instruction was saved with the proposal history.",
        );
      } else if (response !== undefined) {
        setActionMessage(responseError(response));
      }
      setBusy(false);
    },
    [busy, readWorkspace, selectedItem, workspace],
  );

  const submitConversation = useCallback(async () => {
    if (workspace === undefined || conversation === undefined || busy) return;
    const message = conversationText.trim();
    if (message.length === 0) {
      setActionMessage(
        "Enter a question or explicit revision instruction first.",
      );
      return;
    }
    if (
      conversationMode === "READ_ONLY_CONVERSATION" &&
      !conversation.capabilities.canAsk
    ) {
      setActionMessage(
        "The Review Bundle is working; read-only conversation is paused.",
      );
      return;
    }
    if (
      conversationMode === "REVIEW_REVISION" &&
      !conversation.capabilities.canRequestRevision
    ) {
      setActionMessage(
        "Complete every proposal decision and question answer before requesting a revision.",
      );
      return;
    }
    setBusy(true);
    const intentId = `renderer-f21-${workspace.bundleId}-${Date.now()}`;
    const intent = {
      schemaVersion: 1 as const,
      intentId,
      bundleId: workspace.bundleId,
      mode: conversationMode,
      message,
      ...(selectedItem === undefined ? {} : { itemIds: [selectedItem.itemId] }),
      expectedBundleVersion: workspace.version,
      ...(conversationMode === "REVIEW_REVISION"
        ? {
            expectedEvidenceRevision: conversation.evidenceRevision,
            acknowledgeUnattributedChanges:
              acknowledgeUnattributed || undefined,
          }
        : {}),
      idempotencyKey: intentId,
      actionId: intentId,
      createdAt: new Date().toISOString(),
    };
    const response =
      conversationMode === "READ_ONLY_CONVERSATION"
        ? await window.prmonitor?.askReviewBundleConversation(intent)
        : await window.prmonitor?.requestReviewBundleRevision(intent);
    if (response?.ok && response.value.kind === "review-bundle-conversation") {
      setConversation(response.value.conversation);
      setConversationText("");
      if (conversationMode === "REVIEW_REVISION") await readWorkspace();
      setActionMessage(
        conversationMode === "READ_ONLY_CONVERSATION"
          ? "Read-only answer recorded; no files or worktree state were changed."
          : "Revision finished with a deterministic Review Bundle result.",
      );
    } else if (response !== undefined) {
      setActionMessage(responseError(response));
    }
    setBusy(false);
  }, [
    acknowledgeUnattributed,
    busy,
    conversation,
    conversationMode,
    conversationText,
    readWorkspace,
    selectedItem,
    workspace,
  ]);

  const useLatestAnswer = useCallback(() => {
    const latestAnswer = conversation?.turns.at(-1)?.answer;
    if (latestAnswer === undefined) {
      setActionMessage("The latest read-only turn did not return an answer.");
      return;
    }
    setAnswer(latestAnswer);
    void saveProposalInput("APPLY_QUESTION_ANSWER", latestAnswer);
  }, [conversation, saveProposalInput]);

  const continueConversation = useCallback(async () => {
    const active = conversation?.activeOperation;
    if (workspace === undefined || active === undefined || busy) return;
    setBusy(true);
    const response = await window.prmonitor?.continueReviewBundleConversation({
      bundleId: workspace.bundleId,
      operationId: active.operationId,
      expectedBundleVersion: workspace.version,
    });
    if (response?.ok && response.value.kind === "review-bundle-conversation") {
      setConversation(response.value.conversation);
      await readWorkspace();
      setActionMessage("The explicitly continued AI turn was recorded.");
    } else if (response !== undefined) {
      setActionMessage(responseError(response));
    }
    setBusy(false);
  }, [busy, conversation, readWorkspace, workspace]);

  const cancelConversation = useCallback(async () => {
    const active = conversation?.activeOperation;
    if (workspace === undefined || active === undefined || busy) return;
    setBusy(true);
    const response = await window.prmonitor?.cancelReviewBundleConversation({
      bundleId: workspace.bundleId,
      operationId: active.operationId,
    });
    if (response?.ok && response.value.kind === "review-bundle-conversation") {
      setConversation(response.value.conversation);
      await readWorkspace();
      setActionMessage(
        "The AI turn was cancelled and its evidence was preserved.",
      );
    } else if (response !== undefined) {
      setActionMessage(responseError(response));
    }
    setBusy(false);
  }, [busy, conversation, readWorkspace, workspace]);

  const startNewOperation = useCallback(async () => {
    const active = conversation?.activeOperation;
    if (
      workspace === undefined ||
      conversation === undefined ||
      active === undefined ||
      !conversation.capabilities.canStartNewOperation ||
      busy
    )
      return;
    setBusy(true);
    const intentId = `renderer-f21-new-${workspace.bundleId}-${Date.now()}`;
    const response = await window.prmonitor?.startNewReviewBundleOperation({
      schemaVersion: 1,
      intentId,
      bundleId: workspace.bundleId,
      mode: "REVIEW_REVISION",
      message:
        conversationText.trim() ||
        "Start a new bounded revision operation using the preserved review scope.",
      expectedBundleVersion: workspace.version,
      expectedEvidenceRevision: conversation.evidenceRevision,
      priorOperationId: active.operationId,
      selectedBudget: newOperationBudget,
      ...(acknowledgeUnattributed
        ? { acknowledgeUnattributedChanges: true }
        : {}),
      idempotencyKey: intentId,
      actionId: intentId,
      createdAt: new Date().toISOString(),
    });
    if (response?.ok && response.value.kind === "review-bundle-conversation") {
      setConversation(response.value.conversation);
      setConversationText("");
      await readWorkspace();
      setActionMessage("A new explicitly budgeted AI operation was recorded.");
    } else if (response !== undefined) {
      setActionMessage(responseError(response));
    }
    setBusy(false);
  }, [
    acknowledgeUnattributed,
    busy,
    conversation,
    conversationText,
    newOperationBudget,
    readWorkspace,
    workspace,
  ]);

  const loadDiff = useCallback(
    async (mode: F20DiffMode) => {
      if (
        workspace === undefined ||
        (mode === "RELEVANT" && selectedItem === undefined)
      )
        return;
      setDiffMode(mode);
      setDiffLoading(true);
      const response = await window.prmonitor?.readReviewBundleDiff(
        workspace.bundleId,
        mode,
        mode === "RELEVANT" ? selectedItem?.itemId : undefined,
      );
      if (response?.ok && response.value.kind === "review-bundle-diff") {
        setDiff(response.value.diff);
        setActionMessage("");
      } else if (response !== undefined) {
        setActionMessage(responseError(response));
      }
      setDiffLoading(false);
    },
    [selectedItem, workspace],
  );

  const refreshWorktree = useCallback(async () => {
    if (workspace === undefined || busy) return;
    setBusy(true);
    const response = await window.prmonitor?.refreshReviewBundleWorktree(
      workspace.bundleId,
      workspace.version,
    );
    if (response?.ok && response.value.kind === "review-bundle-workspace") {
      setWorkspace(response.value.workspace);
      setActionMessage("Fresh F13 worktree condition evidence was loaded.");
    } else if (response !== undefined) {
      setActionMessage(responseError(response));
      await readWorkspace();
    }
    setBusy(false);
  }, [busy, readWorkspace, workspace]);

  const beginF22 = useCallback(
    async (kind: "DISCARD" | "REEVALUATE") => {
      if (workspace === undefined || busy) return;
      setBusy(true);
      const idempotencyKey = `renderer-f22-${kind.toLowerCase()}-${workspace.bundleId}-${Date.now()}`;
      const response =
        kind === "DISCARD"
          ? await window.prmonitor?.previewReviewBundleDiscard({
              bundleId: workspace.bundleId,
              idempotencyKey,
              expectedGateRevision: workspace.f22?.gateRevision,
            })
          : await window.prmonitor?.previewReviewBundleReevaluation({
              bundleId: workspace.bundleId,
              idempotencyKey,
              ...(f22SelectedRetainedEventVersionIds.length === 0
                ? {}
                : {
                    selectedRetainedEventVersionIds:
                      f22SelectedRetainedEventVersionIds,
                  }),
              expectedGateRevision: workspace.f22?.gateRevision,
            });
      if (response?.ok && response.value.kind === "review-bundle-f22") {
        setWorkspace(response.value.workspace);
        setF22Preview(response.value.preview);
        setF22ActionId(response.value.actionId);
        if (response.value.preview !== undefined)
          setF22Choice(response.value.preview.requiredChoice);
        setF22SelectedRetainedEventVersionIds(
          response.value.preview?.kind === "F22_REEVALUATION_PREVIEW"
            ? [...response.value.preview.selectedRetainedEventVersionIds]
            : [],
        );
        setF22Confirmed(false);
        setActionMessage(
          kind === "DISCARD"
            ? "Review the discard choice. No worktree changes have been made."
            : "Review the fresh-head re-evaluation preview. No new worktree or AI operation has started.",
        );
      } else if (response !== undefined) {
        setActionMessage(responseError(response));
      }
      setBusy(false);
    },
    [busy, f22SelectedRetainedEventVersionIds, workspace],
  );

  const confirmF22 = useCallback(async () => {
    if (
      workspace === undefined ||
      f22Preview === undefined ||
      f22ActionId === undefined ||
      busy
    )
      return;
    setBusy(true);
    const input = {
      actionId: f22ActionId,
      bundleId: workspace.bundleId,
      choice: f22Choice,
      ...(f22Confirmed ? { confirmed: true } : {}),
      expectedActionVersion: f22Preview.actionRevision,
      expectedGateRevision: workspace.f22?.gateRevision,
    } as const;
    const response =
      f22Preview.kind === "F22_DISCARD_PREVIEW"
        ? await window.prmonitor?.confirmReviewBundleDiscard(input)
        : await window.prmonitor?.confirmReviewBundleReevaluation(input);
    if (response?.ok && response.value.kind === "review-bundle-f22") {
      setWorkspace(response.value.workspace);
      if (
        response.value.outcome === "COMPLETED" ||
        response.value.outcome === "CANCELLED"
      ) {
        setF22Preview(undefined);
        setF22ActionId(undefined);
        setF22SelectedRetainedEventVersionIds([]);
      }
      setActionMessage(
        response.value.outcome === "COMPLETED"
          ? "The explicit F22 action completed and its durable evidence is available."
          : response.value.outcome === "CANCELLED"
            ? "The operation worktree was kept and the F22 action was cancelled."
            : "The F22 action remains gated; inspect the deterministic reason below.",
      );
    } else if (response !== undefined) {
      setActionMessage(responseError(response));
      await readWorkspace();
    }
    setBusy(false);
  }, [
    busy,
    f22ActionId,
    f22Choice,
    f22Confirmed,
    f22Preview,
    readWorkspace,
    workspace,
  ]);

  const cancelF22Preview = useCallback(async () => {
    const pendingF22 = workspace?.f22PendingAction;
    const actionKind =
      f22Preview?.kind === "F22_DISCARD_PREVIEW" ||
      pendingF22?.action === "DISCARD"
        ? "DISCARD"
        : "REEVALUATE";
    const expectedActionVersion =
      f22Preview?.actionRevision ?? pendingF22?.version;
    if (
      workspace === undefined ||
      f22ActionId === undefined ||
      expectedActionVersion === undefined ||
      busy
    )
      return;
    setBusy(true);
    const input = {
      actionId: f22ActionId,
      bundleId: workspace.bundleId,
      choice: "KEEP_AND_CANCEL" as const,
      expectedActionVersion,
      expectedGateRevision: workspace.f22?.gateRevision,
    };
    const response =
      actionKind === "DISCARD"
        ? await window.prmonitor?.confirmReviewBundleDiscard(input)
        : await window.prmonitor?.confirmReviewBundleReevaluation(input);
    if (response?.ok && response.value.kind === "review-bundle-f22") {
      setWorkspace(response.value.workspace);
      if (
        response.value.outcome === "COMPLETED" ||
        response.value.outcome === "CANCELLED"
      ) {
        setF22Preview(undefined);
        setF22ActionId(undefined);
        setF22SelectedRetainedEventVersionIds([]);
      }
      setActionMessage(
        response.value.outcome === "CANCELLED"
          ? "The preview was closed; the worktree was kept and the F22 action was cancelled."
          : "The F22 preview remains gated; inspect the deterministic reason below.",
      );
    } else if (response !== undefined) {
      setActionMessage(responseError(response));
      await readWorkspace();
    }
    setBusy(false);
  }, [busy, f22ActionId, f22Preview, readWorkspace, workspace]);

  const reconcileF22 = useCallback(async () => {
    if (workspace === undefined || busy) return;
    setBusy(true);
    const response = await window.prmonitor?.reconcileReviewBundleF22(
      workspace.bundleId,
    );
    if (response?.ok && response.value.kind === "review-bundle-workspace") {
      setWorkspace(response.value.workspace);
      setF22ActionId(undefined);
      setF22Preview(undefined);
      setF22SelectedRetainedEventVersionIds([]);
      setActionMessage(
        response.value.workspace.f22PendingAction?.status === "UNKNOWN"
          ? "F22 still needs deterministic reconciliation; no effect was retried."
          : "F22 durable action reconciliation completed.",
      );
    } else if (response !== undefined) {
      setActionMessage(responseError(response));
    }
    setBusy(false);
  }, [busy, workspace]);

  const pathAction = useCallback(
    async (
      requestedAction: "OPEN_WORKTREE" | "OPEN_FILE" | "REVEAL_FILE",
      relativePath?: string,
    ) => {
      if (workspace === undefined || busy) return;
      setBusy(true);
      const response = await window.prmonitor?.reviewBundlePathAction({
        bundleId: workspace.bundleId,
        action: requestedAction,
        ...(relativePath === undefined ? {} : { relativePath }),
        expectedVersion: workspace.version,
      });
      if (response?.ok && response.value.kind === "review-bundle-path-action") {
        setActionMessage(
          response.value.result.ok
            ? "The canonical worktree action completed."
            : (response.value.result.reason?.what ??
                "The canonical worktree action was not completed."),
        );
      } else if (response !== undefined) {
        setActionMessage(responseError(response));
      }
      setBusy(false);
    },
    [busy, workspace],
  );

  const copyWorktreePath = useCallback(async () => {
    if (workspace?.worktree === undefined) return;
    try {
      await navigator.clipboard.writeText(workspace.worktree.canonicalPath);
      setActionMessage(
        "The recorded operation-owned worktree path was copied.",
      );
    } catch {
      setActionMessage(
        "The path could not be copied. It remains visible for manual selection.",
      );
    }
  }, [workspace]);

  const copyDisplayedDiff = useCallback(async () => {
    if (diff?.copyableText === undefined) {
      setActionMessage("No diff text is available to copy.");
      return;
    }
    try {
      await navigator.clipboard.writeText(diff.copyableText);
      setActionMessage("The displayed read-only diff was copied.");
    } catch {
      setActionMessage(
        "The diff could not be copied. It remains selectable for manual copy.",
      );
    }
  }, [diff]);

  const f22Condition = f22Preview?.worktreeCondition;
  const f22ReevaluationPreview =
    f22Preview?.kind === "F22_REEVALUATION_PREVIEW" ? f22Preview : undefined;

  if (loading) {
    return (
      <section
        className="review-bundle-workspace"
        aria-labelledby="review-bundle-heading"
      >
        <p role="status">Loading the committed Review Bundle…</p>
      </section>
    );
  }
  if (error !== undefined || workspace === undefined) {
    return (
      <section
        className="review-bundle-workspace"
        aria-labelledby="review-bundle-heading"
      >
        <h2 id="review-bundle-heading">Review Bundle</h2>
        <div className="review-error" role="alert">
          <strong>Review Bundle unavailable.</strong>
          <span>
            {error ?? "No committed workspace projection was returned."}
          </span>
          <button type="button" onClick={() => void readWorkspace()}>
            Reload Review Bundle
          </button>
        </div>
      </section>
    );
  }

  const stateClass = workspace.statePresentation.semantic.toLowerCase();
  const proposal = workspace.stage === "PROPOSAL_REVIEW";
  const accept = action(workspace, "ACCEPT_RECOMMENDATION");
  const override = action(workspace, "OVERRIDE_RECOMMENDATION");
  const draftAction = action(workspace, "SAVE_RESPONSE_DRAFT");
  const worktreeAction = action(workspace, "OPEN_WORKTREE");
  const copyWorktreeAction = action(workspace, "COPY_WORKTREE_PATH");
  const condition = workspace.worktree?.condition;
  const unsafeCondition =
    condition !== undefined &&
    ["UNATTRIBUTED_CHANGES", "MIXED_OR_OVERLAP", "STALE_OR_UNKNOWN"].includes(
      condition.classification,
    );

  return (
    <section
      className="review-bundle-workspace"
      aria-labelledby="review-bundle-heading"
    >
      <header className={`review-bundle-header review-state-${stateClass}`}>
        <div>
          <p className="eyebrow">Review Bundle workspace</p>
          <h2 id="review-bundle-heading">
            {workspace.pullRequest.title ??
              workspace.pullRequest.baseRepository.name}
          </h2>
          <p className="review-reference">
            {workspace.pullRequest.baseRepository.owner}/
            {workspace.pullRequest.baseRepository.name} ·{" "}
            {workspace.pullRequest.baseBranch} ←{" "}
            {workspace.pullRequest.headBranch}
          </p>
        </div>
        <div
          className="review-state-summary"
          role={workspace.state === "NEEDS_ATTENTION" ? "alert" : "status"}
        >
          <strong>{workspace.statePresentation.label}</strong>
          <span>{readable(workspace.stage)}</span>
          <span>Evidence revision {workspace.evidenceRevision}</span>
        </div>
      </header>

      <div className="review-guidance">
        <strong>{workspace.statePresentation.what}</strong>
        <span>{workspace.statePresentation.why}</span>
        <span>
          Next action: {readable(workspace.statePresentation.nextAction)}
        </span>
        {workspace.statePresentation.preservedEvidence.map((evidence) => (
          <span key={evidence}>{evidence}</span>
        ))}
      </div>

      {workspace.f22 !== undefined ? (
        <section
          className="review-f22-panel"
          aria-labelledby="review-f22-heading"
          role={workspace.f22.status === "CURRENT" ? "region" : "alert"}
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">F22 deterministic action gate</p>
              <h3 id="review-f22-heading">{readable(workspace.f22.status)}</h3>
            </div>
            <span className="review-authority-label">
              Remote head {workspace.f22.remote.expectedHeadSha}
              {workspace.f22.remote.observedHeadSha === undefined
                ? " · not observed"
                : ` · observed ${workspace.f22.remote.observedHeadSha}`}
            </span>
          </div>
          {workspace.f22.reason !== undefined ? (
            <p className="review-evidence-note">
              {workspace.f22.reason.what} {workspace.f22.reason.why}
            </p>
          ) : null}
          {workspace.f22PendingAction?.status === "UNKNOWN" ? (
            <>
              <p className="review-evidence-note" role="alert">
                F22 stopped during a delegated effect. The worktree, hold, and
                evidence remain preserved until the main process reconciles the
                durable action.
              </p>
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => void reconcileF22()}
              >
                Reconcile F22 action
              </button>
            </>
          ) : null}
          {workspace.f22.retainedCandidateEventVersionIds !== undefined &&
          workspace.f22.retainedCandidateEventVersionIds.length > 0 ? (
            <fieldset className="review-f22-scope">
              <legend>Retain feedback for re-evaluation (optional)</legend>
              <p className="review-evidence-note">
                Select retained event versions before opening the re-evaluation
                preview. The original bundle feedback is always included.
              </p>
              {workspace.f22.retainedCandidateEventVersionIds.map(
                (eventVersionId) => (
                  <label key={eventVersionId} className="review-checkbox">
                    <input
                      type="checkbox"
                      disabled={busy || f22Preview !== undefined}
                      checked={f22SelectedRetainedEventVersionIds.includes(
                        eventVersionId,
                      )}
                      onChange={(event) =>
                        setF22SelectedRetainedEventVersionIds((current) =>
                          event.target.checked
                            ? [...new Set([...current, eventVersionId])]
                            : current.filter(
                                (value) => value !== eventVersionId,
                              ),
                        )
                      }
                    />
                    {eventVersionId}
                  </label>
                ),
              )}
            </fieldset>
          ) : null}
          <div className="review-f22-actions">
            {workspace.f22PendingAction?.status === "PENDING" &&
            f22Preview === undefined ? (
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => void cancelF22Preview()}
              >
                Cancel pending F22 action
              </button>
            ) : null}
            {workspace.f22.actions.discard &&
            workspace.f22PendingAction === undefined ? (
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => void beginF22("DISCARD")}
              >
                Discard Review Bundle
              </button>
            ) : null}
            {workspace.f22.actions.reevaluate &&
            workspace.f22PendingAction === undefined ? (
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => void beginF22("REEVALUATE")}
              >
                Re-evaluate at current head
              </button>
            ) : null}
          </div>
          {f22Preview !== undefined && f22ActionId !== undefined ? (
            <div className="review-f22-choice" aria-live="polite">
              <p>{f22Preview.confirmationText}</p>
              <section
                className="review-f22-evidence"
                aria-labelledby="review-f22-evidence-heading"
              >
                <h4 id="review-f22-evidence-heading">F22 evidence</h4>
                {f22Condition !== undefined ? (
                  <>
                    <dl className="review-evidence-grid">
                      <div>
                        <dt>Worktree condition</dt>
                        <dd>{readable(f22Condition.classification)}</dd>
                      </div>
                      <div>
                        <dt>Fingerprint</dt>
                        <dd>{f22Condition.currentFingerprint}</dd>
                      </div>
                      <div>
                        <dt>Observed revision</dt>
                        <dd>{f22Condition.observedRevision}</dd>
                      </div>
                      <div>
                        <dt>Expected revision</dt>
                        <dd>{f22Condition.expectedRevision}</dd>
                      </div>
                      <div>
                        <dt>Changed paths</dt>
                        <dd>{f22Condition.dirtySummary.changedPaths.length}</dd>
                      </div>
                      <div>
                        <dt>Tracked / staged</dt>
                        <dd>
                          {f22Condition.dirtySummary.trackedPaths.length} /{" "}
                          {f22Condition.dirtySummary.stagedPaths.length}
                        </dd>
                      </div>
                      <div>
                        <dt>Untracked / ignored</dt>
                        <dd>
                          {f22Condition.dirtySummary.untrackedPaths.length} /{" "}
                          {f22Condition.dirtySummary.ignoredPaths.length}
                        </dd>
                      </div>
                      <div>
                        <dt>Attribution</dt>
                        <dd>
                          {f22Condition.attribution.complete
                            ? "Complete"
                            : "Incomplete"}
                        </dd>
                      </div>
                    </dl>
                    {f22Condition.dirtySummary.changedPaths.length > 0 ? (
                      <ul className="review-evidence-list">
                        {f22Condition.dirtySummary.changedPaths.map((path) => (
                          <li key={path}>{path}</li>
                        ))}
                      </ul>
                    ) : null}
                    <p className="review-evidence-note">
                      AI-attributed:{" "}
                      {f22Condition.attribution.aiAttributedPaths.length};
                      developer/unattributed:{" "}
                      {f22Condition.attribution.unAttributedPaths.length};
                      overlap: {f22Condition.attribution.overlapPaths.length}.
                    </p>
                  </>
                ) : (
                  <p className="review-evidence-note">
                    No worktree condition was recorded; F22 will not infer a
                    safe clear choice.
                  </p>
                )}
                {f22ReevaluationPreview !== undefined ? (
                  <>
                    <dl className="review-evidence-grid">
                      <div>
                        <dt>Remote server / repository</dt>
                        <dd>
                          {f22ReevaluationPreview.remote.identity.serverId} /{" "}
                          {f22ReevaluationPreview.remote.identity.repositoryKey}
                        </dd>
                      </div>
                      <div>
                        <dt>Expected base / head</dt>
                        <dd>
                          {f22ReevaluationPreview.remote.expectedBaseSha ??
                            "Not recorded"}{" "}
                          / {f22ReevaluationPreview.remote.expectedHeadSha}
                        </dd>
                      </div>
                      <div>
                        <dt>Expected base repository / branch</dt>
                        <dd>
                          {f22ReevaluationPreview.remote.expectedBaseRepository
                            ? f22ReevaluationPreview.remote
                                .expectedBaseRepository.owner +
                              "/" +
                              f22ReevaluationPreview.remote
                                .expectedBaseRepository.name
                            : "Not recorded"}{" "}
                          /{" "}
                          {f22ReevaluationPreview.remote.expectedBaseBranch ??
                            "Not recorded"}
                        </dd>
                      </div>
                      <div>
                        <dt>Expected head repository / branch</dt>
                        <dd>
                          {f22ReevaluationPreview.remote.expectedHeadRepository
                            ? f22ReevaluationPreview.remote
                                .expectedHeadRepository.owner +
                              "/" +
                              f22ReevaluationPreview.remote
                                .expectedHeadRepository.name
                            : "Not recorded"}{" "}
                          /{" "}
                          {f22ReevaluationPreview.remote.expectedHeadBranch ??
                            "Not recorded"}
                        </dd>
                      </div>
                      <div>
                        <dt>Observed base / head</dt>
                        <dd>
                          {f22ReevaluationPreview.remote.observedBaseSha ??
                            "Not observed"}{" "}
                          /{" "}
                          {f22ReevaluationPreview.remote.observedHeadSha ??
                            "Not observed"}
                        </dd>
                      </div>
                      <div>
                        <dt>Observed base repository / branch</dt>
                        <dd>
                          {f22ReevaluationPreview.remote.observedBaseRepository
                            ? f22ReevaluationPreview.remote
                                .observedBaseRepository.owner +
                              "/" +
                              f22ReevaluationPreview.remote
                                .observedBaseRepository.name
                            : "Not observed"}{" "}
                          /{" "}
                          {f22ReevaluationPreview.remote.observedBaseBranch ??
                            "Not observed"}
                        </dd>
                      </div>
                      <div>
                        <dt>Observed head repository / branch</dt>
                        <dd>
                          {f22ReevaluationPreview.remote.observedHeadRepository
                            ? f22ReevaluationPreview.remote
                                .observedHeadRepository.owner +
                              "/" +
                              f22ReevaluationPreview.remote
                                .observedHeadRepository.name
                            : "Not observed"}{" "}
                          /{" "}
                          {f22ReevaluationPreview.remote.observedHeadBranch ??
                            "Not observed"}
                        </dd>
                      </div>
                      <div>
                        <dt>Observation revision</dt>
                        <dd>
                          {f22ReevaluationPreview.remote.observationRevision}
                        </dd>
                      </div>
                      <div>
                        <dt>Hold</dt>
                        <dd>
                          {f22ReevaluationPreview.holdRemainsActive
                            ? "Remains active"
                            : "Not active"}
                        </dd>
                      </div>
                      <div>
                        <dt>Publication</dt>
                        <dd>
                          {f22ReevaluationPreview.publicationAuthorized
                            ? "Authorized"
                            : "Not authorized"}
                        </dd>
                      </div>
                    </dl>
                    <p className="review-evidence-note">
                      Original feedback event versions:{" "}
                      {f22ReevaluationPreview.originalEventVersionIds.join(
                        ", ",
                      )}
                    </p>
                    <p className="review-evidence-note">
                      Retained event versions selected:{" "}
                      {f22ReevaluationPreview.selectedRetainedEventVersionIds
                        .length === 0
                        ? "None"
                        : f22ReevaluationPreview.selectedRetainedEventVersionIds.join(
                            ", ",
                          )}
                    </p>
                    <dl className="review-evidence-grid">
                      <div>
                        <dt>Task type</dt>
                        <dd>
                          {f22ReevaluationPreview.configuration.taskType ??
                            "Not recorded"}
                        </dd>
                      </div>
                      <div>
                        <dt>Profile</dt>
                        <dd>
                          {f22ReevaluationPreview.configuration.profileId ??
                            "Not recorded"}{" "}
                          (revision{" "}
                          {f22ReevaluationPreview.configuration
                            .profileRevision ?? "not recorded"}
                          )
                        </dd>
                      </div>
                      <div>
                        <dt>Provider / model</dt>
                        <dd>
                          {f22ReevaluationPreview.configuration.providerId ??
                            "Not recorded"}{" "}
                          /{" "}
                          {f22ReevaluationPreview.configuration.modelId ??
                            "Not recorded"}
                        </dd>
                      </div>
                      <div>
                        <dt>Policy</dt>
                        <dd>
                          {f22ReevaluationPreview.configuration.policyId ??
                            "Not recorded"}
                        </dd>
                      </div>
                      <div>
                        <dt>Common Instructions</dt>
                        <dd>
                          {f22ReevaluationPreview.configuration
                            .commonInstructionIds.length === 0
                            ? "None recorded"
                            : f22ReevaluationPreview.configuration.commonInstructionIds.join(
                                ", ",
                              )}
                        </dd>
                      </div>
                      <div>
                        <dt>Build &amp; Validation</dt>
                        <dd>
                          {f22ReevaluationPreview.configuration
                            .buildValidationStatus ?? "Not recorded"}
                        </dd>
                      </div>
                      <div>
                        <dt>PR Intent / Context</dt>
                        <dd>
                          {f22ReevaluationPreview.configuration
                            .prIntentContextHash ?? "Not recorded"}
                        </dd>
                      </div>
                    </dl>
                  </>
                ) : null}
              </section>
              <F22ChoiceControls
                requiredChoice={f22Preview.requiredChoice}
                choice={f22Choice}
                confirmed={f22Confirmed}
                busy={busy}
                onChoiceChange={setF22Choice}
                onConfirmedChange={setF22Confirmed}
                onConfirm={() => void confirmF22()}
                onClose={() => void cancelF22Preview()}
              />
            </div>
          ) : null}
        </section>
      ) : null}

      {actionMessage !== "" ? (
        <p className="review-action-message" role="status" aria-live="polite">
          {actionMessage}
        </p>
      ) : null}

      <div className="review-workspace-grid">
        <nav
          className="review-item-navigation"
          aria-label="Review Bundle items"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">Feedback items</p>
              <h3>{workspace.itemCount} items</h3>
            </div>
            <span className="store-state">
              {workspace.decisionSummary.decided}/
              {workspace.decisionSummary.total} decided
            </span>
          </div>
          {workspace.items.length === 0 ? (
            <p className="review-empty">No persisted feedback items.</p>
          ) : null}
          <ol>
            {workspace.items.map((item) => (
              <li key={item.itemId}>
                <button
                  type="button"
                  className={
                    item.itemId === selectedItemId
                      ? "review-item-button selected"
                      : "review-item-button"
                  }
                  aria-current={
                    item.itemId === selectedItemId ? "true" : undefined
                  }
                  onClick={() => setSelectedItemId(item.itemId)}
                >
                  <span>Item {item.order + 1}</span>
                  <strong>{itemLabel(item)}</strong>
                  <small>
                    {item.feedback.path ?? item.feedback.sourceKind}
                  </small>
                </button>
              </li>
            ))}
          </ol>
          {proposal ? (
            <button
              type="button"
              disabled={
                !action(workspace, "CONFIRM_DECISIONS")?.enabled || busy
              }
              onClick={() => void confirmDecisions()}
            >
              Continue to implementation
            </button>
          ) : null}
        </nav>

        <div className="review-item-detail">
          {selectedItem === undefined ? (
            <p className="review-empty">
              Select an item to inspect its immutable feedback and evidence.
            </p>
          ) : (
            <>
              <article
                className="review-detail-card"
                aria-labelledby="review-item-heading"
              >
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Item {selectedItem.order + 1}</p>
                    <h3 id="review-item-heading">{itemLabel(selectedItem)}</h3>
                  </div>
                  <span className="review-authority-label">
                    Immutable feedback
                  </span>
                </div>
                <dl className="review-evidence-grid">
                  <div>
                    <dt>Source</dt>
                    <dd>
                      {selectedItem.feedback.sourceKind} ·{" "}
                      {selectedItem.feedback.sourceId}
                    </dd>
                  </div>
                  <div>
                    <dt>Author</dt>
                    <dd>{selectedItem.feedback.author ?? "Not recorded"}</dd>
                  </div>
                  <div>
                    <dt>Observed</dt>
                    <dd>{formatTimestamp(selectedItem.feedback.observedAt)}</dd>
                  </div>
                  <div>
                    <dt>Version</dt>
                    <dd>
                      {selectedItem.feedback.eventVersionId} ·{" "}
                      {selectedItem.feedback.semanticHash}
                    </dd>
                  </div>
                  <div>
                    <dt>Location</dt>
                    <dd>
                      {selectedItem.feedback.path ?? "Not recorded"}
                      {selectedItem.feedback.line === undefined
                        ? ""
                        : `:${selectedItem.feedback.line}`}
                    </dd>
                  </div>
                </dl>
                <h4>Original feedback</h4>
                <pre className="review-feedback">
                  {selectedItem.feedback.body ??
                    "No feedback body was recorded."}
                </pre>
                {selectedItem.feedback.diffHunk !== undefined ? (
                  <details>
                    <summary>Original feedback hunk</summary>
                    <pre className="review-feedback">
                      {selectedItem.feedback.diffHunk}
                    </pre>
                  </details>
                ) : null}
              </article>

              <article
                className="review-detail-card"
                aria-labelledby="review-recommendation-heading"
              >
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Semantic proposal</p>
                    <h3 id="review-recommendation-heading">
                      Recommendation and decision
                    </h3>
                  </div>
                  <span className="review-authority-label">
                    F15 structured result / F18 human decision
                  </span>
                </div>
                <dl className="review-evidence-grid">
                  <div>
                    <dt>Assessment</dt>
                    <dd>{readable(selectedItem.recommendation.assessment)}</dd>
                  </div>
                  <div>
                    <dt>Proposed disposition</dt>
                    <dd>{readable(selectedItem.recommendation.disposition)}</dd>
                  </div>
                  <div>
                    <dt>Effective decision</dt>
                    <dd>
                      {readable(selectedItem.decision.finalDisposition)} ·{" "}
                      {readable(selectedItem.decision.decision)}
                    </dd>
                  </div>
                </dl>
                <p>{selectedItem.recommendation.explanation}</p>
                {selectedItem.recommendation.implementationProposal !==
                undefined ? (
                  <div className="review-subpanel">
                    <h4>Proposed implementation</h4>
                    <p>
                      {
                        selectedItem.recommendation.implementationProposal
                          .summary
                      }
                    </p>
                    {selectedItem.recommendation.implementationProposal
                      .acceptanceNotes !== undefined ? (
                      <p>
                        Acceptance notes:{" "}
                        {
                          selectedItem.recommendation.implementationProposal
                            .acceptanceNotes
                        }
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {selectedItem.relatedFiles.length > 0 ? (
                  <p>Related files: {selectedItem.relatedFiles.join(", ")}</p>
                ) : (
                  <p className="review-evidence-note">
                    No related files were supplied by the proposal.
                  </p>
                )}
                {proposal ? (
                  <div className="review-decision-controls">
                    <p className="review-control-help">
                      These controls authorize implementation planning only.
                      They are not publication approval.
                    </p>
                    <div className="review-button-row">
                      <button
                        type="button"
                        disabled={!accept?.enabled || busy}
                        onClick={() =>
                          void runDecision({
                            decision: "accepted",
                            finalDisposition:
                              selectedItem.recommendation.disposition,
                            answer:
                              selectedItem.recommendation.disposition ===
                              "question"
                                ? answer
                                : undefined,
                          })
                        }
                      >
                        Accept recommendation
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={!override?.enabled || busy}
                        onClick={() =>
                          void runDecision({
                            decision: "overridden",
                            finalDisposition: overrideDisposition,
                            instruction: overrideInstruction,
                            answer:
                              overrideDisposition === "question"
                                ? answer
                                : undefined,
                          })
                        }
                      >
                        Override recommendation
                      </button>
                    </div>
                    <label>
                      Override disposition
                      <select
                        value={overrideDisposition}
                        onChange={(event) =>
                          setOverrideDisposition(
                            event.target.value as F20DecisionDisposition,
                          )
                        }
                      >
                        {dispositions.map((value) => (
                          <option value={value} key={value}>
                            {readable(value)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Override instructions{" "}
                      <textarea
                        value={overrideInstruction}
                        maxLength={64 * 1024}
                        onChange={(event) =>
                          setOverrideInstruction(event.target.value)
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={
                        !proposal ||
                        busy ||
                        overrideInstruction.trim().length === 0
                      }
                      onClick={() =>
                        void saveProposalInput(
                          "SAVE_ENTRY_INSTRUCTION",
                          overrideInstruction,
                        )
                      }
                    >
                      Save entry instruction
                    </button>
                    {selectedItem.questionAnswerRequired ||
                    overrideDisposition === "question" ? (
                      <label>
                        Question answer (required before implementation)
                        <textarea
                          value={answer}
                          maxLength={64 * 1024}
                          onChange={(event) => setAnswer(event.target.value)}
                          aria-describedby="review-question-help"
                        />
                      </label>
                    ) : null}
                    {selectedItem.questionAnswerRequired ||
                    overrideDisposition === "question" ? (
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={
                          !proposal || busy || answer.trim().length === 0
                        }
                        onClick={() =>
                          void saveProposalInput(
                            "APPLY_QUESTION_ANSWER",
                            answer,
                          )
                        }
                      >
                        Save question answer
                      </button>
                    ) : null}
                    {selectedItem.questionAnswerRequired ||
                    overrideDisposition === "question" ? (
                      <p id="review-question-help" className="field-help">
                        An empty answer keeps this item incomplete and blocks
                        implementation.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </article>

              {!proposal ? (
                <article
                  className="review-detail-card"
                  aria-labelledby="review-response-heading"
                >
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">Response</p>
                      <h3 id="review-response-heading">
                        Proposed response draft
                      </h3>
                    </div>
                    <span className="review-authority-label">
                      Never posted by F20
                    </span>
                  </div>
                  <label>
                    Draft response
                    <textarea
                      value={draftText}
                      maxLength={64 * 1024}
                      disabled={!draftAction?.enabled || busy}
                      onChange={(event) => setDraftText(event.target.value)}
                    />
                  </label>
                  <p className="review-control-help">
                    Saved text is a draft for the later publication workflow. It
                    is not a posted, resolved, or approved GitHub response.
                  </p>
                  <button
                    type="button"
                    disabled={!draftAction?.enabled || busy}
                    onClick={() => void saveDraft()}
                  >
                    Save response draft
                  </button>
                </article>
              ) : null}
            </>
          )}
        </div>
      </div>

      {conversation !== undefined ? (
        <section
          className="review-conversation-panel"
          aria-labelledby="review-conversation-heading"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">Explicit AI conversation</p>
              <h3 id="review-conversation-heading">
                Ask first, or revise the worktree
              </h3>
            </div>
            <span className="review-authority-label">
              No publication authority
            </span>
          </div>
          <p className="review-control-help">
            Ask / clarify is read-only. Revise worktree is a separate, explicit
            mutating turn gated by the committed decisions and fresh F13
            evidence.
          </p>
          <fieldset className="review-conversation-modes">
            <legend>Conversation mode</legend>
            <label>
              <input
                type="radio"
                name={`f21-mode-${workspace.bundleId}`}
                value="READ_ONLY_CONVERSATION"
                checked={conversationMode === "READ_ONLY_CONVERSATION"}
                onChange={() => setConversationMode("READ_ONLY_CONVERSATION")}
              />
              Ask / clarify (read-only)
            </label>
            <label>
              <input
                type="radio"
                name={`f21-mode-${workspace.bundleId}`}
                value="REVIEW_REVISION"
                checked={conversationMode === "REVIEW_REVISION"}
                onChange={() => setConversationMode("REVIEW_REVISION")}
              />
              Revise worktree (explicit code/test/reply change)
            </label>
          </fieldset>
          {conversationMode === "REVIEW_REVISION" &&
          condition?.classification === "UNATTRIBUTED_CHANGES" ? (
            <label className="review-acknowledgement">
              <input
                type="checkbox"
                checked={acknowledgeUnattributed}
                onChange={(event) =>
                  setAcknowledgeUnattributed(event.target.checked)
                }
              />
              I acknowledge the unattributed worktree changes and want F21 to
              revalidate this exact worktree.
            </label>
          ) : null}
          <label>
            {conversationMode === "READ_ONLY_CONVERSATION"
              ? "Question or clarification"
              : "Explicit revision instruction"}
            <textarea
              value={conversationText}
              maxLength={64 * 1024}
              disabled={busy}
              onChange={(event) => setConversationText(event.target.value)}
              aria-describedby="review-conversation-help"
            />
          </label>
          <p id="review-conversation-help" className="field-help">
            Conversation text is stored with the immutable task snapshot. It
            never changes mode implicitly.
          </p>
          <div className="review-button-row">
            <button
              type="button"
              disabled={
                busy ||
                (conversationMode === "READ_ONLY_CONVERSATION"
                  ? !conversation.capabilities.canAsk
                  : !conversation.capabilities.canRequestRevision)
              }
              onClick={() => void submitConversation()}
            >
              {conversationMode === "READ_ONLY_CONVERSATION"
                ? "Ask read-only question"
                : "Request explicit revision"}
            </button>
            {conversation.activeOperation?.permittedNextAction ===
            "CONTINUE_AI_WORK" ? (
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => void continueConversation()}
              >
                Continue AI Work
              </button>
            ) : null}
            {conversation.capabilities.canCancel ? (
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => void cancelConversation()}
              >
                Cancel AI Work
              </button>
            ) : null}
            {conversation.capabilities.canStartNewOperation ? (
              <>
                <label className="review-budget-field">
                  New turn budget
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={newOperationBudget}
                    disabled={busy}
                    onChange={(event) =>
                      setNewOperationBudget(
                        Math.max(
                          1,
                          Math.min(10, Number(event.target.value) || 1),
                        ),
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void startNewOperation()}
                >
                  Start new AI Work budget
                </button>
              </>
            ) : null}
          </div>
          {conversation.turns.at(-1)?.progress.length ? (
            <ol
              className="review-conversation-progress"
              aria-label="Safe AI progress"
            >
              {conversation.turns.at(-1)?.progress.map((event) => (
                <li key={`${event.sequence}-${event.occurredAt}`}>
                  {event.summary}
                </li>
              ))}
            </ol>
          ) : null}
          {conversation.lastRevision?.status === "NEEDS_ATTENTION" ? (
            <p className="review-conversation-attention" role="alert">
              Revision needs attention:{" "}
              {conversation.lastRevision.reasons.join(" ")}
            </p>
          ) : null}
          <div
            className="review-conversation-transcript"
            aria-live="polite"
            aria-label="Conversation transcript"
          >
            {conversation.messages.length === 0 ? (
              <p className="review-empty">
                No conversation turns have been recorded.
              </p>
            ) : (
              conversation.messages.map((message) => (
                <article
                  className={`review-conversation-message review-conversation-${message.role}`}
                  key={message.messageId}
                >
                  <strong>{message.role === "user" ? "You" : "AI"}</strong>
                  <p>{message.text}</p>
                </article>
              ))
            )}
          </div>
          {conversation.turns.at(-1)?.answer !== undefined ? (
            <div className="review-conversation-answer">
              <h4>Latest read-only answer</h4>
              <p>{conversation.turns.at(-1)?.answer}</p>
              {selectedItem?.questionAnswerRequired ? (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={useLatestAnswer}
                >
                  Use as answer
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <section
        className="review-evidence-section"
        aria-labelledby="review-evidence-heading"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Deterministic evidence</p>
            <h3 id="review-evidence-heading">
              Validation, AI work, configuration, and worktree
            </h3>
          </div>
          <span className="review-authority-label">
            Claims and evidence remain separate
          </span>
        </div>
        <div className="review-evidence-panels">
          <ValidationPanel
            label="Baseline"
            validation={workspace.baselineValidation}
          />
          <ValidationPanel
            label="Post-change"
            validation={workspace.postChangeValidation}
          />
          <article className="review-evidence-panel">
            <h3>Effective AI configuration</h3>
            <dl className="review-evidence-grid">
              <div>
                <dt>Task type</dt>
                <dd>{readable(workspace.configuration.taskType)}</dd>
              </div>
              <div>
                <dt>Provider / model</dt>
                <dd>
                  {workspace.configuration.providerId ?? "Deterministic"} /{" "}
                  {workspace.configuration.modelId ?? "None"}
                </dd>
              </div>
              <div>
                <dt>Profile revision</dt>
                <dd>{workspace.configuration.profileRevision ?? "None"}</dd>
              </div>
              <div>
                <dt>Policy</dt>
                <dd>
                  {workspace.configuration.effectivePreset ??
                    "Deterministic path"}{" "}
                  · {workspace.configuration.sandboxMode ?? "No provider"}
                </dd>
              </div>
              <div>
                <dt>Common Instructions</dt>
                <dd>
                  {workspace.configuration.commonInstructionIds.length === 0
                    ? "None recorded"
                    : workspace.configuration.commonInstructionIds.join(", ")}
                </dd>
              </div>
            </dl>
            {workspace.configuration.prIntentContext !== undefined ? (
              <details>
                <summary>PR Intent / Context snapshot</summary>
                <pre className="review-feedback">
                  {workspace.configuration.prIntentContext}
                </pre>
              </details>
            ) : null}
          </article>
          <article className="review-evidence-panel">
            <h3>AI Work Turn Reports</h3>
            {workspace.proposalWork === undefined &&
            workspace.implementationWork === undefined ? (
              <p>
                Zero AI usage: no provider work was recorded for this result.
              </p>
            ) : (
              <>
                {workspace.proposalWork !== undefined ? (
                  <AiWorkSummary
                    label="Proposal"
                    summary={workspace.proposalWork}
                  />
                ) : null}
                {workspace.implementationWork !== undefined ? (
                  <AiWorkSummary
                    label="Implementation"
                    summary={workspace.implementationWork}
                  />
                ) : null}
              </>
            )}
          </article>
        </div>
      </section>

      {workspace.worktree !== undefined ? (
        <section
          className={`review-worktree-panel${unsafeCondition ? " review-worktree-unsafe" : ""}`}
          aria-labelledby="review-worktree-heading"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">Operation-owned worktree</p>
              <h3 id="review-worktree-heading">Worktree and reproducibility</h3>
            </div>
            <span className="review-authority-label">F13 deterministic</span>
          </div>
          <p className="review-path">{workspace.worktree.canonicalPath}</p>
          <div className="review-button-row">
            <button
              type="button"
              disabled={!worktreeAction?.enabled || busy}
              onClick={() => void pathAction("OPEN_WORKTREE")}
            >
              Open worktree
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={!copyWorktreeAction?.enabled || busy}
              onClick={() => void copyWorktreePath()}
            >
              Copy worktree path
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => void refreshWorktree()}
            >
              Refresh evidence
            </button>
          </div>
          <dl className="review-evidence-grid">
            <div>
              <dt>prBaseSha</dt>
              <dd>{workspace.worktree.prBaseSha}</dd>
            </div>
            <div>
              <dt>prHeadSha</dt>
              <dd>{workspace.worktree.prHeadSha}</dd>
            </div>
            <div>
              <dt>worktreeBaselineSha</dt>
              <dd>{workspace.worktree.worktreeBaselineSha}</dd>
            </div>
            <div>
              <dt>Snapshot</dt>
              <dd>
                {workspace.worktree.snapshotId} ·{" "}
                {workspace.worktree.stateFingerprint}
              </dd>
            </div>
          </dl>
          {condition === undefined ? (
            <p className="review-evidence-note">
              No fresh WorktreeCondition is committed yet. Refresh evidence
              before destructive, validation, or publication-related decisions.
            </p>
          ) : (
            <div
              className="review-condition"
              role={unsafeCondition ? "alert" : "status"}
            >
              <strong>
                Worktree condition: {readable(condition.classification)}
              </strong>
              <span>Observed revision: {condition.observedRevision}</span>
              <span>Fingerprint: {condition.currentFingerprint}</span>
              <span>
                Changed paths:{" "}
                {condition.dirtySummary.changedPaths.length === 0
                  ? "none"
                  : condition.dirtySummary.changedPaths.join(", ")}
              </span>
              <span>
                Attribution evidence:{" "}
                {condition.attribution.complete ? "complete" : "incomplete"};
                AI-attributed {condition.attribution.aiAttributedPaths.length},
                un-attributed {condition.attribution.unAttributedPaths.length},
                overlap {condition.attribution.overlapPaths.length}
              </span>
              <span>
                Permitted next actions:{" "}
                {condition.permittedNextActions.map(readable).join(", ")}
              </span>
              {unsafeCondition ? (
                <span>
                  This condition blocks clear, replace, validate-against, and
                  publication-as-verified actions until the owning workflow
                  obtains fresh evidence or an explicit decision.
                </span>
              ) : null}
            </div>
          )}
          {workspace.worktree.changedFiles.length > 0 ? (
            <p>
              Recorded changed files:{" "}
              {workspace.worktree.changedFiles.join(", ")}
            </p>
          ) : null}
        </section>
      ) : null}

      <section
        className="review-diff-panel"
        aria-labelledby="review-diff-heading"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Read-only diff inspection</p>
            <h3 id="review-diff-heading">Complete diff viewer</h3>
          </div>
          <span className="review-authority-label">
            No editing or per-hunk acceptance
          </span>
        </div>
        <div
          className="review-diff-mode-buttons"
          role="group"
          aria-label="Diff modes"
        >
          {diffModes.map((mode) => (
            <button
              type="button"
              key={mode.id}
              className={diffMode === mode.id ? "selected" : "secondary-button"}
              disabled={mode.id === "RELEVANT" && selectedItem === undefined}
              onClick={() => void loadDiff(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>
        {diffLoading ? (
          <p role="status">Loading deterministic F13 diff evidence…</p>
        ) : null}
        {diff !== undefined ? (
          <>
            <p className="review-diff-purpose">
              <strong>{diff.authority}</strong> · {diff.purpose}
            </p>
            <dl className="review-evidence-grid">
              <div>
                <dt>prBaseSha</dt>
                <dd>{diff.prBaseSha}</dd>
              </div>
              <div>
                <dt>prHeadSha</dt>
                <dd>{diff.prHeadSha}</dd>
              </div>
              <div>
                <dt>worktreeBaselineSha</dt>
                <dd>{diff.worktreeBaselineSha}</dd>
              </div>
              <div>
                <dt>Publication eligible</dt>
                <dd>
                  {diff.publicationEligible
                    ? "Proposed Worktree Diff only"
                    : "No"}
                </dd>
              </div>
            </dl>
            <DiffLines view={diff} />
          </>
        ) : (
          <p className="review-empty">
            Choose a diff mode to load an explicit read-only view. Opening the
            workspace does not run Git or validation.
          </p>
        )}
      </section>
      {diff !== undefined && diff.files.length > 0 ? (
        <section
          className="review-diff-file-actions-panel"
          aria-labelledby="review-diff-file-actions-heading"
        >
          <div className="section-heading">
            <h3 id="review-diff-file-actions-heading">Recorded file actions</h3>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void copyDisplayedDiff()}
            >
              Copy displayed diff
            </button>
          </div>
          <p className="review-control-help">
            Open or reveal only files present in the deterministic F13 diff
            evidence.
          </p>
          <div className="review-diff-file-actions-list">
            {diff.files.map((file) => (
              <div className="review-diff-file-action" key={file.path}>
                <code>{file.path}</code>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={
                    action(workspace, "OPEN_FILE")?.enabled !== true || busy
                  }
                  onClick={() => void pathAction("OPEN_FILE", file.path)}
                >
                  Open file
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={
                    action(workspace, "REVEAL_FILE")?.enabled !== true || busy
                  }
                  onClick={() => void pathAction("REVEAL_FILE", file.path)}
                >
                  Reveal file
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}

function AiWorkSummary({
  label,
  summary,
}: {
  readonly label: string;
  readonly summary: NonNullable<F20WorkspaceReadModel["proposalWork"]>;
}) {
  return (
    <details className="review-ai-summary" open={summary.attention}>
      <summary>
        {label}: {readable(summary.status)} · remaining budget{" "}
        {summary.remainingBudget}
      </summary>
      <p>
        Next action: {readable(summary.nextAction)} · Attention:{" "}
        {summary.attention ? "yes" : "no"}
      </p>
      <p>
        Usage:{" "}
        {Object.entries(summary.usage)
          .map(([key, value]) => `${key}=${value}`)
          .join(", ") || "not reported"}
      </p>
      <ol className="review-turn-list">
        {summary.reports.map((report) => (
          <li key={report.turnId}>
            <strong>{report.turnId}</strong>
            <span>Provider claim: {report.providerStatus}</span>
            <span>
              Actual changed files:{" "}
              {report.actualChangedFiles.join(", ") || "none recorded"}
            </span>
            <span>
              Deterministic problems:{" "}
              {report.deterministicProblems.join("; ") || "none"}
            </span>
            <span>Next action: {readable(report.nextAction)}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}
