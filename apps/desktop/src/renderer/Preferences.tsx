import { useEffect, useState } from "react";
import { customerExplanation } from "./customer-copy";
import type { SettingsCategory } from "./shell-routing";
import type { IpcResponse } from "../shared/ipc";
import type {
  F16CommonInstructionProfile,
  F16PolicyPreset,
  F16PreferencesReadModel,
  F16TaskProfileDraft,
  F16TaskProfileRevision,
  F16TaskType,
} from "../shared/f16-preferences";
import { F16_POLICY_PRESETS, F16_TASK_LABELS } from "../shared/f16-preferences";

interface PreferencesProps {
  readonly enabled: boolean;
  readonly visible?: boolean;
  readonly category?: SettingsCategory;
}

interface TaskDraftForm {
  readonly providerId: string;
  readonly modelId: string;
  readonly reasoningEffort: string;
  readonly providerOptions: string;
  readonly enabled: boolean;
}

interface RepositoryForm {
  readonly serverId: string;
  readonly owner: string;
  readonly name: string;
  readonly key: string;
  readonly buildInstructions: string;
}

const taskTypes: readonly F16TaskType[] = [
  "AUTOMATIC_REVIEW_REEVALUATION",
  "REVIEW_REVISION",
  "READ_ONLY_CONVERSATION",
  "MERGE_CONFLICT_RESOLUTION",
];

function responseMessage(response: IpcResponse, fallback: string): string {
  return response.ok ? fallback : response.error.message;
}

function readPreferencesValue(
  response: IpcResponse,
): F16PreferencesReadModel | undefined {
  return response.ok && response.value.kind === "preferences"
    ? response.value.preferences
    : undefined;
}

function taskDraft(profile: F16TaskProfileRevision): TaskDraftForm {
  return {
    providerId: profile.providerId,
    modelId: profile.modelId,
    reasoningEffort: profile.reasoningEffort ?? "",
    providerOptions: JSON.stringify(profile.providerOptions, null, 2),
    enabled: profile.enabled,
  };
}

function draftsFor(
  preferences: F16PreferencesReadModel,
): Record<F16TaskType, TaskDraftForm> {
  return Object.fromEntries(
    preferences.taskProfiles.map((profile) => [
      profile.taskType,
      taskDraft(profile),
    ]),
  ) as Record<F16TaskType, TaskDraftForm>;
}

function repositoryForm(preferences: F16PreferencesReadModel): RepositoryForm {
  const repository = preferences.repositories[0];
  return {
    serverId: repository?.repository.serverId ?? "",
    owner: repository?.repository.owner ?? "",
    name: repository?.repository.name ?? "",
    key: repository?.repository.key ?? "",
    buildInstructions: repository?.buildInstructions ?? "",
  };
}

function selectedOrder(
  preferences: F16PreferencesReadModel,
): readonly string[] {
  const selected = new Set(preferences.selectedCommonInstructionIds);
  return [
    ...preferences.selectedCommonInstructionIds,
    ...preferences.commonInstructionProfiles
      .map((profile) => profile.profileId)
      .filter((profileId) => !selected.has(profileId)),
  ];
}

type ValidationStatus =
  "ready" | "confirmation_required" | "invalid" | "unavailable";

function validationSummaryLabel(status: ValidationStatus | undefined): string {
  return status === undefined ? "not resolved" : status.replaceAll("_", " ");
}

export function Preferences({
  enabled,
  visible = true,
  category,
}: PreferencesProps) {
  const [selectedTask, setSelectedTask] = useState<F16TaskType>(taskTypes[0]!);
  const [preferences, setPreferences] = useState<F16PreferencesReadModel>();
  const [drafts, setDrafts] = useState<Record<F16TaskType, TaskDraftForm>>();
  const [policy, setPolicy] = useState<F16PolicyPreset>("AUTONOMOUS_WORKTREE");
  const [maxAiWorkTurns, setMaxAiWorkTurns] = useState("3");
  const [worktreeRoot, setWorktreeRoot] = useState("");
  const [pollingIntervalMs, setPollingIntervalMs] = useState("600000");
  const [quietPeriodMs, setQuietPeriodMs] = useState("600000");
  const [instructionId, setInstructionId] = useState<string>();
  const [instructionName, setInstructionName] = useState("");
  const [instructionText, setInstructionText] = useState("");
  const [instructionEnabled, setInstructionEnabled] = useState(true);
  const [instructionSelected, setInstructionSelected] = useState(false);
  const [instructionOrder, setInstructionOrder] = useState<readonly string[]>(
    [],
  );
  const [repository, setRepository] = useState<RepositoryForm>({
    serverId: "",
    owner: "",
    name: "",
    key: "",
    buildInstructions: "",
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    const response = await window.prmonitor?.readPreferences();
    if (response === undefined) return;
    const value = readPreferencesValue(response);
    if (value === undefined) {
      setError(
        responseMessage(
          response,
          "Preferences returned an invalid read model.",
        ),
      );
      return;
    }
    setPreferences(value);
    setDrafts(draftsFor(value));
    setPolicy(value.policy.preset);
    setMaxAiWorkTurns(String(value.operational.maxAiWorkTurns));
    setWorktreeRoot(value.operational.worktreeRoot?.configuredPath ?? "");
    setPollingIntervalMs(String(value.operational.pollingIntervalMs));
    setQuietPeriodMs(String(value.operational.quietPeriodMs));
    setInstructionOrder(selectedOrder(value));
    setRepository(repositoryForm(value));
  };

  useEffect(() => {
    if (enabled) void load();
  }, [enabled]);

  const commit = async (
    operation: (settingsRevision: number) => Promise<IpcResponse>,
  ) => {
    if (preferences === undefined || busy) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await operation(preferences.settingsRevision);
      const value = readPreferencesValue(response);
      if (value === undefined) {
        setError(
          responseMessage(
            response,
            "The Preferences operation returned an invalid result.",
          ),
        );
        return;
      }
      setPreferences(value);
      setDrafts((current) => {
        const next = draftsFor(value);
        if (current === undefined) return next;
        for (const type of taskTypes)
          if (
            JSON.stringify(current[type]) !== JSON.stringify(drafts?.[type]) ||
            preferences.taskProfiles.find((p) => p.taskType === type)
              ?.revision ===
              value.taskProfiles.find((p) => p.taskType === type)?.revision
          )
            next[type] = current[type];
        return next;
      });
      setInstructionOrder((current) => {
        const available = new Set(
          value.commonInstructionProfiles.map((p) => p.profileId),
        );
        const retained = current.filter((profileId) =>
          available.has(profileId),
        );
        const retainedIds = new Set(retained);
        return [
          ...retained,
          ...selectedOrder(value).filter(
            (profileId) => !retainedIds.has(profileId),
          ),
        ];
      });
      setMessage(`Saved Preferences revision ${value.settingsRevision}.`);
    } catch {
      setError(
        "The Preferences operation failed safely. Reload and retry from the current revision.",
      );
    } finally {
      setBusy(false);
    }
  };

  const saveTaskProfile = async (taskType: F16TaskType) => {
    const draft = drafts?.[taskType];
    if (preferences === undefined || draft === undefined) return;
    let providerOptions: F16TaskProfileDraft["providerOptions"];
    try {
      providerOptions = JSON.parse(
        draft.providerOptions,
      ) as F16TaskProfileDraft["providerOptions"];
    } catch {
      setError("Provider options must be valid JSON before they can be saved.");
      return;
    }
    await commit((settingsRevision) =>
      window.prmonitor!.saveTaskProfile({
        expectedSettingsRevision: settingsRevision,
        profile: {
          taskType,
          providerId: draft.providerId,
          modelId: draft.modelId,
          ...(draft.reasoningEffort.trim().length === 0
            ? {}
            : {
                reasoningEffort:
                  draft.reasoningEffort as F16TaskProfileDraft["reasoningEffort"],
              }),
          providerOptions,
          enabled: draft.enabled,
        },
      }),
    );
  };

  const editInstruction = (profile: F16CommonInstructionProfile) => {
    setInstructionId(profile.profileId);
    setInstructionName(profile.name);
    setInstructionText(profile.instructionText);
    setInstructionEnabled(profile.enabled);
    setInstructionSelected(
      preferences?.selectedCommonInstructionIds.includes(profile.profileId) ??
        false,
    );
  };

  const moveInstruction = (profileId: string, direction: -1 | 1) => {
    setInstructionOrder((current) => {
      const index = current.indexOf(profileId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length)
        return current;
      const next = [...current];
      const currentValue = next[index];
      const targetValue = next[nextIndex];
      if (currentValue === undefined || targetValue === undefined)
        return current;
      next[index] = targetValue;
      next[nextIndex] = currentValue;
      return next;
    });
  };

  if (!enabled || !visible) return null;
  if (preferences === undefined) {
    return (
      <section
        className="preferences-panel"
        aria-labelledby="preferences-heading"
      >
        <h2 id="preferences-heading">Preferences</h2>
        <p className="section-help">Loading AI settings…</p>
        {error !== "" ? (
          <p className="form-message" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section
      className="preferences-panel"
      aria-labelledby="preferences-heading"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">Settings</p>
          <h2 id="preferences-heading">Preferences</h2>
        </div>
        <span className="store-state" aria-label="Preferences revision">
          revision {preferences.settingsRevision}
        </span>
      </div>
      <p className="section-help">
        Changes apply to new work. Work that has already started keeps its saved
        settings.
      </p>
      {error !== "" ? (
        <p className="form-message" role="alert">
          {error}
        </p>
      ) : null}
      {message !== "" ? (
        <p className="form-message" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}

      {category === undefined || category === "tasks" ? (
        <section
          className="preference-section"
          aria-labelledby="task-profiles-heading"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">AI settings</p>
              <h3 id="task-profiles-heading">AI Task Profiles</h3>
            </div>
          </div>
          <p className="section-help">
            The four task types are separate revisioned profiles. Model and
            option compatibility is checked before a profile can become
            available.
          </p>
          <div className="preference-grid">
            <label>
              AI task
              <select
                value={selectedTask}
                onChange={(event) =>
                  setSelectedTask(event.target.value as F16TaskType)
                }
              >
                {taskTypes.map((type) => (
                  <option key={type} value={type}>
                    {F16_TASK_LABELS[type]}
                  </option>
                ))}
              </select>
            </label>
            {[selectedTask].map((taskType) => {
              const profile = preferences.taskProfiles.find(
                (candidate) => candidate.taskType === taskType,
              );
              const draft = drafts?.[taskType];
              if (profile === undefined || draft === undefined) return null;
              return (
                <article className="preference-card" key={taskType}>
                  <div className="profile-card-heading">
                    <div>
                      <h4>{F16_TASK_LABELS[taskType]}</h4>
                    </div>
                    <span
                      className={`status-pill status-${profile.availability.toLowerCase()}`}
                    >
                      {profile.availability.toLowerCase()}
                    </span>
                  </div>
                  <div className="preferences-form">
                    <label>
                      Provider
                      <input
                        value={draft.providerId}
                        onChange={(event) =>
                          setDrafts((current) =>
                            current === undefined
                              ? current
                              : {
                                  ...current,
                                  [taskType]: {
                                    ...draft,
                                    providerId: event.target.value,
                                  },
                                },
                          )
                        }
                        maxLength={128}
                      />
                    </label>
                    <label>
                      Model
                      <input
                        value={draft.modelId}
                        onChange={(event) =>
                          setDrafts((current) =>
                            current === undefined
                              ? current
                              : {
                                  ...current,
                                  [taskType]: {
                                    ...draft,
                                    modelId: event.target.value,
                                  },
                                },
                          )
                        }
                        maxLength={256}
                      />
                    </label>
                    <label>
                      Reasoning effort
                      <input
                        value={draft.reasoningEffort}
                        onChange={(event) =>
                          setDrafts((current) =>
                            current === undefined
                              ? current
                              : {
                                  ...current,
                                  [taskType]: {
                                    ...draft,
                                    reasoningEffort: event.target.value,
                                  },
                                },
                          )
                        }
                        maxLength={64}
                        placeholder="medium"
                      />
                    </label>
                    <label>
                      Provider options (JSON)
                      <textarea
                        value={draft.providerOptions}
                        onChange={(event) =>
                          setDrafts((current) =>
                            current === undefined
                              ? current
                              : {
                                  ...current,
                                  [taskType]: {
                                    ...draft,
                                    providerOptions: event.target.value,
                                  },
                                },
                          )
                        }
                        rows={3}
                        aria-describedby={`${taskType}-options-help`}
                      />
                    </label>
                    <p id={`${taskType}-options-help`} className="field-help">
                      Bounded JSON only; credential-shaped keys are rejected.
                    </p>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={draft.enabled}
                        onChange={(event) =>
                          setDrafts((current) =>
                            current === undefined
                              ? current
                              : {
                                  ...current,
                                  [taskType]: {
                                    ...draft,
                                    enabled: event.target.checked,
                                  },
                                },
                          )
                        }
                      />{" "}
                      Enable this task profile
                    </label>
                    <dl className="profile-details">
                      <div>
                        <dt>Profile revision</dt>
                        <dd>{profile.revision}</dd>
                      </div>
                      <div>
                        <dt>Compatibility</dt>
                        <dd>
                          {customerExplanation(
                            profile.availabilityReason,
                            profile.availability === "AVAILABLE"
                              ? "This task profile is available."
                              : "Check the provider, model and execution policy for this task.",
                          )}
                        </dd>
                      </div>
                    </dl>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void saveTaskProfile(taskType)}
                    >
                      Save task profile
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setDrafts((current) =>
                          current === undefined
                            ? current
                            : { ...current, [taskType]: taskDraft(profile) },
                        )
                      }
                    >
                      Discard task draft
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {category === undefined || category === "policy" ? (
        <section
          className="preference-section"
          aria-labelledby="policy-heading"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">Bounded execution matrix</p>
              <h3 id="policy-heading">Execution Policy</h3>
            </div>
            <span className="status-pill">
              {preferences.policy.preset.replaceAll("_", " ").toLowerCase()}
            </span>
          </div>
          <p className="section-help">
            Review proposals and read-only conversations cannot change code. No
            AI policy permits publication.
          </p>
          <label>
            Configured policy
            <select
              value={policy}
              onChange={(event) =>
                setPolicy(event.target.value as F16PolicyPreset)
              }
            >
              {F16_POLICY_PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {preferences.policyPresets.find(
                    (summary) => summary.preset === preset,
                  )?.label ?? preset}
                </option>
              ))}
            </select>
          </label>
          <div className="policy-summary-grid">
            {preferences.policyPresets.map((summary) => (
              <article
                className={`policy-summary${summary.preset === policy ? " policy-summary-selected" : ""}`}
                key={summary.preset}
              >
                <h4>{summary.label}</h4>
                <p>{summary.summary}</p>
                <small>
                  Sandbox: {summary.sandboxMode}; network:{" "}
                  {summary.networkAccess}; publication: unavailable
                </small>
              </article>
            ))}
          </div>
          <button
            type="button"
            disabled={busy || policy === preferences.policy.preset}
            onClick={() =>
              void commit((settingsRevision) =>
                window.prmonitor!.savePolicy({
                  expectedSettingsRevision: settingsRevision,
                  preset: policy,
                }),
              )
            }
          >
            Save execution policy
          </button>
        </section>
      ) : null}

      {category === undefined || category === "operational" ? (
        <section
          className="preference-section"
          aria-labelledby="operational-heading"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">monitoring / worktree handoff</p>
              <h3 id="operational-heading">Operational Preferences</h3>
            </div>
          </div>
          <p className="section-help">
            Timing values are validated by monitoring. The isolated-worktree
            root is validated by worktree and must already exist; Preferences
            never creates or removes it.
          </p>
          <div className="preferences-form">
            <label>
              Maximum AI Work Turns
              <input
                type="number"
                min={1}
                max={10}
                value={maxAiWorkTurns}
                onChange={(event) => setMaxAiWorkTurns(event.target.value)}
              />
            </label>
            <label>
              Isolated-worktree root
              <input
                value={worktreeRoot}
                onChange={(event) => setWorktreeRoot(event.target.value)}
                maxLength={32767}
                placeholder="Blank clears the saved root"
              />
            </label>
            <label>
              Polling interval (ms)
              <input
                type="number"
                min={60000}
                max={86400000}
                value={pollingIntervalMs}
                onChange={(event) => setPollingIntervalMs(event.target.value)}
              />
            </label>
            <label>
              Quiet period (ms)
              <input
                type="number"
                min={60000}
                max={86400000}
                value={quietPeriodMs}
                onChange={(event) => setQuietPeriodMs(event.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void commit((settingsRevision) =>
                  window.prmonitor!.saveOperationalPreferences({
                    expectedSettingsRevision: settingsRevision,
                    maxAiWorkTurns: Number(maxAiWorkTurns),
                    worktreeRoot:
                      worktreeRoot.trim().length === 0 ? null : worktreeRoot,
                    pollingIntervalMs: Number(pollingIntervalMs),
                    quietPeriodMs: Number(quietPeriodMs),
                  }),
                )
              }
            >
              Save operational preferences
            </button>
          </div>
          <dl className="profile-details">
            <div>
              <dt>Current root revision</dt>
              <dd>
                {preferences.operational.worktreeRoot?.rootRevision ??
                  "not configured"}
              </dd>
            </div>
            <div>
              <dt>AI can publish changes</dt>
              <dd>{String(preferences.policy.publicationAuthority)}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {category === undefined || category === "instructions" ? (
        <section
          className="preference-section"
          aria-labelledby="common-instructions-heading"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">Shared task instructions</p>
              <h3 id="common-instructions-heading">Common Instructions</h3>
            </div>
            <span className="store-state">
              {preferences.commonInstructionProfiles.length} profiles
            </span>
          </div>
          <p className="section-help">
            PRMonitor saves each instruction version and uses the selected
            order. Instruction text does not change the permissions for an
            operation.
          </p>
          <div className="preferences-form">
            <label>
              Profile name
              <input
                value={instructionName}
                onChange={(event) => setInstructionName(event.target.value)}
                maxLength={128}
              />
            </label>
            <label>
              Instruction text
              <textarea
                value={instructionText}
                onChange={(event) => setInstructionText(event.target.value)}
                maxLength={32768}
                rows={5}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={instructionEnabled}
                onChange={(event) =>
                  setInstructionEnabled(event.target.checked)
                }
              />{" "}
              Enabled
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={instructionSelected}
                onChange={(event) =>
                  setInstructionSelected(event.target.checked)
                }
              />{" "}
              Use for new tasks
            </label>
            <div className="profile-actions">
              <button
                type="button"
                disabled={
                  busy ||
                  instructionName.trim().length === 0 ||
                  instructionText.trim().length === 0
                }
                onClick={() =>
                  void commit((settingsRevision) =>
                    window.prmonitor!.saveCommonInstruction({
                      expectedSettingsRevision: settingsRevision,
                      ...(instructionId === undefined
                        ? {}
                        : { profileId: instructionId }),
                      name: instructionName,
                      instructionText,
                      enabled: instructionEnabled,
                      selected: instructionSelected,
                    }),
                  )
                }
              >
                {instructionId === undefined
                  ? "Create instruction"
                  : "Save instruction revision"}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setInstructionId(undefined);
                  setInstructionName("");
                  setInstructionText("");
                  setInstructionEnabled(true);
                  setInstructionSelected(false);
                }}
              >
                New
              </button>
            </div>
          </div>
          {preferences.commonInstructionProfiles.length === 0 ? (
            <p className="empty-state">
              No Common Instruction profiles are configured.
            </p>
          ) : (
            <div
              className="instruction-list"
              aria-label="Common Instruction profiles"
            >
              {instructionOrder.flatMap((profileId, index) => {
                const profile = preferences.commonInstructionProfiles.find(
                  (p) => p.profileId === profileId,
                );
                if (profile === undefined) return [];
                return (
                  <article className="preference-card" key={profile.profileId}>
                    <div className="profile-card-heading">
                      <div>
                        <h4>{profile.name}</h4>
                        <p>
                          revision {profile.revision} ·{" "}
                          {profile.enabled ? "enabled" : "disabled"}
                        </p>
                      </div>
                      <span className="status-pill">
                        {preferences.selectedCommonInstructionIds.includes(
                          profile.profileId,
                        )
                          ? `selected ${preferences.selectedCommonInstructionIds.indexOf(profile.profileId) + 1}`
                          : "not selected"}
                      </span>
                    </div>
                    <p className="instruction-preview">
                      {profile.instructionText}
                    </p>
                    <div className="profile-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => editInstruction(profile)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busy}
                        onClick={() =>
                          void commit((settingsRevision) =>
                            window.prmonitor!.deleteCommonInstruction({
                              expectedSettingsRevision: settingsRevision,
                              profileId: profile.profileId,
                            }),
                          )
                        }
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={index === 0}
                        onClick={() => moveInstruction(profile.profileId, -1)}
                      >
                        Move up
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={index === instructionOrder.length - 1}
                        onClick={() => moveInstruction(profile.profileId, 1)}
                      >
                        Move down
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void commit((settingsRevision) =>
                window.prmonitor!.saveCommonInstructionSelection({
                  expectedSettingsRevision: settingsRevision,
                  selectedProfileIds: instructionOrder.filter((profileId) =>
                    preferences.commonInstructionProfiles.some(
                      (profile) =>
                        profile.profileId === profileId &&
                        profile.enabled &&
                        preferences.selectedCommonInstructionIds.includes(
                          profileId,
                        ),
                    ),
                  ),
                }),
              )
            }
          >
            Save selected order
          </button>
        </section>
      ) : null}

      {category === undefined || category === "repository" ? (
        <section
          className="preference-section"
          aria-labelledby="repository-guidance-heading"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">
                validation settings / pull request configuration context
              </p>
              <h3 id="repository-guidance-heading">
                Repository Build &amp; Validation
              </h3>
            </div>
          </div>
          <p className="section-help">
            This is human guidance and a read-only validation summary. It does
            not execute commands, grant approval, or publish results.
          </p>
          <div className="preferences-form">
            <label>
              GitHub server ID
              <input
                value={repository.serverId}
                onChange={(event) =>
                  setRepository((current) => ({
                    ...current,
                    serverId: event.target.value,
                  }))
                }
                maxLength={256}
              />
            </label>
            <label>
              Repository owner
              <input
                value={repository.owner}
                onChange={(event) =>
                  setRepository((current) => ({
                    ...current,
                    owner: event.target.value,
                  }))
                }
                maxLength={256}
              />
            </label>
            <label>
              Repository name
              <input
                value={repository.name}
                onChange={(event) =>
                  setRepository((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                maxLength={256}
              />
            </label>
            <label>
              Repository key
              <input
                value={repository.key}
                onChange={(event) =>
                  setRepository((current) => ({
                    ...current,
                    key: event.target.value,
                  }))
                }
                maxLength={512}
                placeholder="server/owner/name"
              />
            </label>
            <label>
              Build guidance
              <textarea
                value={repository.buildInstructions}
                onChange={(event) =>
                  setRepository((current) => ({
                    ...current,
                    buildInstructions: event.target.value,
                  }))
                }
                maxLength={16384}
                rows={4}
                aria-describedby="build-guidance-help"
              />
            </label>
            <p id="build-guidance-help" className="field-help">
              Describe the repository’s build expectations in prose. validation
              settings owns structured validation profiles and execution.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void commit((settingsRevision) =>
                  window.prmonitor!.saveRepositoryPreferences({
                    expectedSettingsRevision: settingsRevision,
                    repository: {
                      serverId: repository.serverId,
                      owner: repository.owner,
                      name: repository.name,
                      key: repository.key,
                    },
                    buildInstructions: repository.buildInstructions,
                  }),
                )
              }
            >
              Save repository guidance
            </button>
          </div>
          {preferences.repositories.map((settings) => (
            <article className="preference-card" key={settings.repository.key}>
              <h4>
                {settings.repository.owner}/{settings.repository.name}
              </h4>
              <dl className="profile-details">
                <div>
                  <dt>Validation status</dt>
                  <dd>
                    {validationSummaryLabel(settings.validationSummary?.status)}
                  </dd>
                </div>
                <div>
                  <dt>Validation source</dt>
                  <dd>{settings.validationSummary?.source ?? "none"}</dd>
                </div>
                <div>
                  <dt>Commands / manual checks</dt>
                  <dd>
                    {settings.validationSummary === undefined
                      ? "not resolved"
                      : `${settings.validationSummary.commandCount ?? 0} / ${settings.validationSummary.manualCheckCount ?? 0}`}
                  </dd>
                </div>
              </dl>
              {settings.validationSummary?.warningCode !== undefined ? (
                <p className="profile-reason" role="status">
                  Check the validation profile for this repository before
                  running validation.
                </p>
              ) : null}
              <details>
                <summary>Raw support data</summary>
                <pre tabIndex={0}>
                  {JSON.stringify(settings.validationSummary ?? {}, null, 2)}
                </pre>
              </details>
            </article>
          ))}
        </section>
      ) : null}
    </section>
  );
}
