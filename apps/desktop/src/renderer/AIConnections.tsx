import { DEFAULT_CODEX_CONNECTION_MODEL } from "../shared/ai/codex-models";
import { HelpButton, HelpInput, HelpSelect, HelpSummary } from "./HelpControls";
import { useEffect, useRef, useState } from "react";
import {
  AI_TOOL_NAMES,
  type AIConnection,
  type AITool,
  type AIToolStatus,
} from "../shared/ai-connections";
import type { F16PreferencesReadModel } from "../shared/f16-preferences";

export function AIConnections({
  preferences,
  onSaved,
  onModels,
  active = true,
}: {
  readonly preferences: F16PreferencesReadModel;
  readonly onSaved: (value: F16PreferencesReadModel) => void;
  readonly active?: boolean;
  readonly onModels?: (
    tool: AITool,
    models: NonNullable<AIToolStatus["models"]>,
  ) => void;
}) {
  const connections = preferences.aiConnections ?? [];
  const initial =
    connections.find((value) => value.id === preferences.defaultConnectionId) ??
    connections[0];
  const empty: AIConnection = {
    id: "",
    name: "My Codex",
    tool: "codex",
    executable: "",
    extraArgs: [],
    authMode: "subscription",
    signInSource: "existing",
    revision: 1,
  };
  const [draft, setDraft] = useState(initial ?? empty);
  const [saved, setSaved] = useState(initial);
  const scope = initial
    ? preferences.taskProfiles.every(
        (profile) => profile.connectionId === initial.id,
      )
    : true;
  const [initialScope, setInitialScope] = useState(scope);
  const [useForAll, setUseForAll] = useState(scope);
  const [statuses, setStatuses] = useState<
    Partial<Record<AITool, AIToolStatus>>
  >({});
  const [checkedStatus, setCheckedStatus] = useState<AIToolStatus>();
  const [busy, setBusy] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const pending = useRef(false);
  const generation = useRef(0);
  const alive = useRef(true);
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(saved ?? empty) ||
    useForAll !== initialScope;

  useEffect(() => {
    const nextScope = saved
      ? preferences.taskProfiles.every(
          (profile) => profile.connectionId === saved.id,
        )
      : true;
    setUseForAll((current) => (current === initialScope ? nextScope : current));
    setInitialScope(nextScope);
  }, [preferences.taskProfiles, saved?.id]);

  function editLaunch(next: AIConnection) {
    ++generation.current;
    setCheckedStatus(undefined);
    setMessage("");
    setError("");
    setDraft(next);
  }

  async function check(value: AIConnection) {
    const request = ++generation.current;
    const response = await window.prmonitor?.checkAITools({
      ...(saved &&
      value.id === saved.id &&
      JSON.stringify(value) === JSON.stringify(saved)
        ? { connectionId: saved.id }
        : {}),
      tool: value.tool,
      ...(value.executable ? { executable: value.executable } : {}),
      extraArgs: value.extraArgs,
      authMode: value.authMode,
    });
    if (!alive.current || generation.current !== request) return;
    if (response?.ok && response.value.kind === "ai-tools") {
      const status = response.value.view.tools[0];
      if (status) {
        setCheckedStatus(status);
        setMessage(status.message);
        if (status.models?.length) onModels?.(value.tool, status.models);
        if (!value.executable && status.executable)
          setDraft((current) =>
            current.tool === value.tool
              ? { ...current, executable: status.executable! }
              : current,
          );
      }
    } else
      setError(
        response?.ok === false
          ? response.error.message
          : "The program could not be checked.",
      );
  }

  useEffect(() => {
    alive.current = true;
    let disposed = false;
    if (active && saved && JSON.stringify(draft) === JSON.stringify(saved)) {
      const savedCheck = check(saved);
      const request = generation.current;
      void savedCheck.catch(() => {
        if (!disposed && alive.current && generation.current === request)
          setError("The saved connection could not be checked.");
      });
    }
    const discoveryGeneration = generation.current;
    if (active)
      void Promise.all(
        (["codex", "claude", "copilot"] as const).map(async (tool) => {
          const response = await window.prmonitor?.checkAITools({
            tool,
            extraArgs: [],
            authMode: "subscription",
          });
          if (
            !disposed &&
            alive.current &&
            response?.ok &&
            response.value.kind === "ai-tools"
          ) {
            const status = response.value.view.tools[0];
            if (status)
              setStatuses((current) => ({
                ...current,
                [tool]: current[tool] ?? status,
              }));
          }
        }),
      ).catch(() => {
        if (
          !disposed &&
          alive.current &&
          generation.current === discoveryGeneration
        )
          setError("Programs could not be checked. Use Browse for program.");
      });
    return () => {
      disposed = true;
      alive.current = false;
      generation.current += 1;
    };
  }, [active]);

  async function action(run: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await run();
    } catch {
      if (alive.current)
        setError(
          "This action could not finish. Check the saved settings before trying again.",
        );
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }

  const status = checkedStatus;
  return (
    <section aria-labelledby="ai-connections-heading" aria-busy={busy}>
      <h3 id="ai-connections-heading">AI connections on this computer</h3>
      <p>
        Choose a program and save a named connection. Program detection,
        sign-in, and task readiness are checked separately.
      </p>
      <label>
        Saved connection
        <HelpSelect
          value={saved?.id ?? ""}
          disabled={busy}
          onChange={(event) => {
            const selected = connections.find(
              (value) => value.id === event.target.value,
            );
            editLaunch(selected ?? empty);
            const scope = selected
              ? preferences.taskProfiles.every(
                  (profile) => profile.connectionId === selected.id,
                )
              : true;
            setUseForAll(scope);
            setInitialScope(scope);
            setSaved(selected);
            if (selected) void check(selected);
            setMessage("");
            setError("");
          }}
        >
          <option value="">New connection</option>
          {connections.map((value) => (
            <option key={value.id} value={value.id}>
              {value.name}
            </option>
          ))}
        </HelpSelect>
      </label>
      <div className="preferences-form">
        <label>
          Connection name
          <HelpInput
            value={draft.name}
            maxLength={80}
            disabled={busy}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
          />
        </label>
        <label>
          AI tool
          <HelpSelect
            value={draft.tool}
            disabled={busy}
            onChange={(event) => {
              const tool = event.target.value as AITool;
              editLaunch({
                ...draft,
                tool,
                executable: statuses[tool]?.executable ?? "",
                extraArgs: [],
                authMode: "subscription",
                signInSource: "existing",
              });
              setMessage(
                statuses[tool]?.message ??
                  "Choose Browse for program, then check its compatibility.",
              );
            }}
          >
            {Object.entries(AI_TOOL_NAMES).map(([tool, name]) => (
              <option key={tool} value={tool}>
                {name}
                {statuses[tool as AITool]?.detected
                  ? statuses[tool as AITool]?.compatible
                    ? " — found"
                    : " — needs compatibility check"
                  : " — not found"}
              </option>
            ))}
          </HelpSelect>
        </label>
        <label>
          Program
          <HelpInput
            value={draft.executable}
            maxLength={4096}
            disabled={busy}
            onChange={(event) => {
              editLaunch({ ...draft, executable: event.target.value });
            }}
            aria-describedby="ai-program-help"
          />
        </label>
        <p id="ai-program-help">
          Choose the program installed on this computer. On Windows, choose its
          .exe file.
        </p>
        <HelpButton
          type="button"
          disabled={busy}
          onClick={() =>
            void action(async () => {
              const request = generation.current;
              const response = await window.prmonitor?.pickAIProgram();
              if (!alive.current || request !== generation.current) return;
              if (
                response?.ok &&
                response.value.kind === "ai-program" &&
                response.value.path
              ) {
                const next = { ...draft, executable: response.value.path };
                editLaunch(next);
                await check(next);
              } else if (response?.ok === false)
                setError(response.error.message);
            })
          }
        >
          Browse for program
        </HelpButton>
        <HelpButton
          type="button"
          disabled={busy}
          onClick={() => void action(() => check(draft))}
        >
          Check program and sign-in
        </HelpButton>
        {status ? (
          <p role="status">
            Program: {status.detected ? "found" : "not found"}. Version:{" "}
            {status.version ?? "unknown"}. Sign-in: {status.authentication}.
            Compatibility: {status.compatible ? "supported" : "needs attention"}
            . Work readiness:{" "}
            {status.workReadiness === "blocked"
              ? "blocked"
              : "checked separately"}
            .
          </p>
        ) : null}
        <label>
          Sign-in method
          <HelpSelect
            value={draft.authMode}
            disabled={busy || draft.tool !== "codex"}
            onChange={(event) => {
              editLaunch({
                ...draft,
                authMode: event.target.value as AIConnection["authMode"],
              });
            }}
          >
            <option value="subscription">Subscription sign-in</option>
            {draft.tool === "codex" ? (
              <option value="api">API key (separate usage charges)</option>
            ) : null}
          </HelpSelect>
        </label>
        <label>
          Sign-in source
          <HelpSelect
            value={draft.signInSource ?? "existing"}
            disabled={busy || draft.tool !== "codex"}
            onChange={(event) =>
              editLaunch({
                ...draft,
                signInSource: event.target.value as "existing" | "prmonitor",
              })
            }
          >
            <option value="existing">
              Existing {AI_TOOL_NAMES[draft.tool]} sign-in
            </option>
            {draft.tool === "codex" ? (
              <option value="prmonitor">Separate sign-in for PRMonitor</option>
            ) : null}
          </HelpSelect>
        </label>
        <p>
          Subscription mode will not switch to API billing. Existing sign-in
          uses the selected tool's own storage without copying credentials.{" "}
          {draft.tool === "codex"
            ? "For a separate sign-in, save this connection and use the browser button below."
            : "Sign in through the selected CLI, then check this connection."}
        </p>
        {draft.tool === "codex" ? (
          <HelpButton
            type="button"
            disabled={
              busy ||
              dirty ||
              !saved ||
              draft.tool !== "codex" ||
              draft.authMode !== "subscription" ||
              draft.signInSource !== "prmonitor"
            }
            help="Save this connection first, then sign in through Codex's browser flow for PRMonitor."
            onClick={() =>
              void action(async () => {
                if (!saved) return;
                const request = ++generation.current;
                setSigningIn(true);
                setMessage(
                  "Complete Codex sign-in in your browser. You can cancel here.",
                );
                try {
                  const response = await window.prmonitor?.signInAIConnection({
                    connectionId: saved.id,
                    expectedSettingsRevision: preferences.settingsRevision,
                  });
                  if (!alive.current || request !== generation.current) return;
                  if (response?.ok && response.value.kind === "ai-tools") {
                    const checked = response.value.view.tools[0];
                    setCheckedStatus(checked);
                    setMessage(
                      checked?.message ?? "Check this connection's sign-in.",
                    );
                  } else
                    setError(
                      response?.ok === false
                        ? response.error.message
                        : "Sign-in could not finish.",
                    );
                } finally {
                  if (alive.current) setSigningIn(false);
                }
              })
            }
          >
            Sign in for PRMonitor
          </HelpButton>
        ) : null}
        {signingIn ? (
          <HelpButton
            type="button"
            onClick={() => {
              if (!saved) return;
              ++generation.current;
              setMessage(
                "Cancelling sign-in. Wait for the program to close before retrying.",
              );
              void window.prmonitor?.cancelAIConnectionSignIn({
                connectionId: saved.id,
                expectedSettingsRevision: preferences.settingsRevision,
              });
            }}
          >
            Cancel sign-in
          </HelpButton>
        ) : null}
        <details>
          <HelpSummary>Extra launch options</HelpSummary>
          <p>
            One option per row. PRMonitor sets workspace and safety options.
            Codex supports --no-daemon when the selected version supports it.
          </p>
          {draft.extraArgs.map((arg, index) => (
            <div key={index}>
              <label>
                Option {index + 1}
                <HelpInput
                  value={arg}
                  disabled={busy}
                  onChange={(event) => {
                    editLaunch({
                      ...draft,
                      extraArgs: draft.extraArgs.map((value, row) =>
                        row === index ? event.target.value : value,
                      ),
                    });
                  }}
                />
              </label>
              <HelpButton
                type="button"
                disabled={busy}
                onClick={() =>
                  editLaunch({
                    ...draft,
                    extraArgs: draft.extraArgs.filter(
                      (_, row) => row !== index,
                    ),
                  })
                }
              >
                Remove option {index + 1}
              </HelpButton>
            </div>
          ))}
          <HelpButton
            type="button"
            disabled={busy || draft.extraArgs.length >= 16}
            onClick={() =>
              editLaunch({ ...draft, extraArgs: [...draft.extraArgs, ""] })
            }
          >
            Add option
          </HelpButton>
          <p>
            Launch preview (workspace, model, and safety options are added for
            each task):
          </p>
          <code>
            {[draft.executable, ...draft.extraArgs]
              .map((value) => JSON.stringify(value))
              .join(" ")}
          </code>
        </details>
        <label>
          <HelpInput
            type="checkbox"
            checked={useForAll}
            disabled={busy}
            onChange={(event) => setUseForAll(event.target.checked)}
          />{" "}
          Use this connection for all tasks
        </label>
        <p>
          Changes apply to new work. Current work keeps its saved settings.
          Advanced task choices remain available below.
        </p>
        <HelpButton
          type="button"
          disabled={busy || !dirty || !draft.name.trim() || !draft.executable}
          onClick={() =>
            void action(async () => {
              const request = generation.current;
              const connection = {
                ...draft,
                id: draft.id || `connection-${crypto.randomUUID()}`,
              };
              const response = await window.prmonitor?.saveAIConnection({
                expectedSettingsRevision: preferences.settingsRevision,
                connection,
                useForAllTasks: useForAll,
                modelId:
                  draft.tool === "codex"
                    ? DEFAULT_CODEX_CONNECTION_MODEL
                    : draft.tool === "claude"
                      ? "sonnet"
                      : checkedStatus?.tool === "copilot" &&
                          checkedStatus.models?.[0]
                        ? checkedStatus.models[0].modelId
                        : "gpt-5",
              });
              if (!alive.current || request !== generation.current) return;
              if (response?.ok && response.value.kind === "preferences") {
                const value = response.value.preferences;
                const committed = value.aiConnections?.find(
                  (item) => item.id === connection.id,
                );
                onSaved(value);
                if (committed) {
                  setInitialScope(useForAll);
                  setSaved(committed);
                  setDraft(committed);
                }
                setMessage(
                  "AI connection saved. Check setup to confirm task readiness.",
                );
              } else
                setError(
                  response?.ok === false
                    ? response.error.message
                    : "The connection could not be saved.",
                );
            })
          }
        >
          Save connection
        </HelpButton>
        <HelpButton
          type="button"
          disabled={busy || !dirty}
          onClick={() => {
            editLaunch(saved ?? empty);
            if (saved) void check(saved);
            setUseForAll(initialScope);
            setMessage("");
            setError("");
          }}
        >
          Discard changes
        </HelpButton>
      </div>
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
