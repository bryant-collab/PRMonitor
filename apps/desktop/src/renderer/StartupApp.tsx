import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";
import {
  APPLICATION_TITLE,
  INITIAL_STARTUP_STATUS,
  STARTUP_STATUS_ID,
} from "../shared/startup";
import type { CurrentState } from "../shared/ipc";
import type {
  GithubCredentialOperationView,
  GithubServerProfileView,
  GithubServerSettingsView,
} from "../shared/github-server";

function operationNeedsAction(operation: GithubCredentialOperationView): boolean {
  return ["FAILED", "CANCELLED", "RECOVERY_REQUIRED", "CLEANUP_PENDING"].includes(
    operation.phase,
  );
}

function statusLabel(profile: GithubServerProfileView): string {
  return profile.status.toLowerCase().replaceAll("_", " ");
}

export function StartupApp() {
  const statusRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<CurrentState | undefined>();
  const [settings, setSettings] = useState<GithubServerSettingsView | undefined>();
  const [targetLabel, setTargetLabel] = useState("home");
  const [displayName, setDisplayName] = useState("");
  const [serverUrl, setServerUrl] = useState("https://github.com");
  const [selectedProfileId, setSelectedProfileId] = useState<string | undefined>();
  const [formMessage, setFormMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const tokenInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = APPLICATION_TITLE;
  }, []);

  useEffect(() => {
    let active = true;
    const bridge = window.prmonitor;
    if (bridge === undefined) return () => undefined;
    void bridge.ready().then(async () => {
      const [stateResponse, settingsResponse] = await Promise.all([
        bridge.readCurrentState(),
        bridge.readGithubSettings(),
      ]);
      if (!active) return;
      if (stateResponse.ok && stateResponse.value.kind === "current-state")
        setState(stateResponse.value.state);
      if (settingsResponse.ok && settingsResponse.value.kind === "github-settings") {
        setSettings(settingsResponse.value.settings);
        const first = settingsResponse.value.settings.profiles[0];
        if (first !== undefined) setSelectedProfileId(first.id);
      }
    });
    const unsubscribe = bridge.onOpenTarget((target) => {
      if (!active) return;
      setTargetLabel(
        target.kind === "HOME"
          ? "home"
          : `${target.kind.toLowerCase()}:${target.id ?? ""}`,
      );
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const focusStatus = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    statusRef.current?.focus();
  }, []);

  const refreshSettings = useCallback(async () => {
    const response = await window.prmonitor?.readGithubSettings();
    if (response?.ok && response.value.kind === "github-settings")
      setSettings(response.value.settings);
  }, []);

  const saveAndTest = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const bridge = window.prmonitor;
    if (bridge === undefined || busy) return;
    setBusy(true);
    setFormMessage("");
    try {
      const profileResponse = await bridge.upsertGithubProfile({
        displayName,
        serverUrl,
      });
      if (!profileResponse.ok || profileResponse.value.kind !== "github-profile") {
        setFormMessage(
          profileResponse.ok ? "The profile could not be saved." : profileResponse.error.message,
        );
        return;
      }
      const profile = profileResponse.value.profile;
      setSelectedProfileId(profile.id);
      const tokenInput = tokenInputRef.current;
      const token = tokenInput?.value ?? "";
      if (token.length === 0) {
        setFormMessage("Server profile saved. Enter a protected access value to test it.");
        return;
      }
      const credentialResponse = await bridge.submitGithubCredential(profile.id, token);
      if (!credentialResponse.ok) setFormMessage(credentialResponse.error.message);
      else setFormMessage("The protected connection operation was recorded.");
      await refreshSettings();
    } catch {
      setFormMessage("The server profile operation failed safely. Retry from this window.");
    } finally {
      if (tokenInputRef.current !== null) tokenInputRef.current.value = "";
      setBusy(false);
    }
  }, [busy, displayName, refreshSettings, serverUrl]);

  const runProfileAction = useCallback(
    async (action: "test" | "remove", profile: GithubServerProfileView) => {
      const bridge = window.prmonitor;
      if (bridge === undefined || busy) return;
      setBusy(true);
      try {
        const response =
          action === "test"
            ? await bridge.testGithubConnection(profile.id)
            : await bridge.removeGithubProfile(profile.id);
        if (!response.ok) setFormMessage(response.error.message);
        else setFormMessage(action === "test" ? "Connection test completed." : "Profile removal completed.");
        await refreshSettings();
      } catch {
        setFormMessage("The server action failed safely. Retry from this window.");
      } finally {
        setBusy(false);
      }
    },
    [busy, refreshSettings],
  );

  const runOperationAction = useCallback(
    async (action: "retry" | "cleanup", operation: GithubCredentialOperationView) => {
      const bridge = window.prmonitor;
      if (bridge === undefined || busy) return;
      setBusy(true);
      try {
        const response =
          action === "retry"
            ? await bridge.retryGithubOperation(operation.id)
            : await bridge.cleanupGithubOperation(operation.id);
        if (!response.ok) setFormMessage(response.error.message);
        else setFormMessage("The recovery operation completed.");
        await refreshSettings();
      } catch {
        setFormMessage("The recovery operation failed safely. Retry from this window.");
      } finally {
        setBusy(false);
      }
    },
    [busy, refreshSettings],
  );

  const selectedProfile = settings?.profiles.find(
    (profile) => profile.id === selectedProfileId,
  );

  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href={`#${STARTUP_STATUS_ID}`}
        onClick={focusStatus}
      >
        Skip to startup status
      </a>
      <main className="startup-card" aria-labelledby="startup-heading">
        <p className="eyebrow">Desktop foundation</p>
        <h1 id="startup-heading">{APPLICATION_TITLE}</h1>
        <div
          ref={statusRef}
          id={STARTUP_STATUS_ID}
          className="startup-status"
          role="status"
          aria-live="polite"
          data-prmonitor-ready={String(INITIAL_STARTUP_STATUS.ready)}
          tabIndex={0}
        >
          {state === undefined
            ? INITIAL_STARTUP_STATUS.message
            : `Main process ${state.lifecycle.phase.toLowerCase().replaceAll("_", " ")}.`}
        </div>
        <p className="scope-note">Current target: {targetLabel}.</p>
        <section className="server-settings" aria-labelledby="server-settings-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Secure access</p>
              <h2 id="server-settings-heading">GitHub servers</h2>
            </div>
            <span className="store-state" aria-label="Secure storage status">
              {settings === undefined
                ? "loading"
                : `secure storage ${settings.secureStore.state.toLowerCase()}`}
            </span>
          </div>
          <p className="section-help">
            Server identity is saved separately from the masked access value. Connection tests are read-only.
          </p>
          <form className="server-form" aria-label="Add or update GitHub server" onSubmit={(event) => void saveAndTest(event)}>
            <label>
              Display name
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                autoComplete="off"
                maxLength={120}
                placeholder="Company GitHub"
              />
            </label>
            <label>
              HTTPS server origin
              <input
                value={serverUrl}
                onChange={(event) => setServerUrl(event.target.value)}
                autoComplete="url"
                inputMode="url"
                maxLength={2048}
                placeholder="https://github.com or https://github.company.example"
              />
            </label>
            <label>
              Personal access value
              <input
                ref={tokenInputRef}
                type="password"
                autoComplete="new-password"
                maxLength={4096}
                aria-describedby="server-token-help"
              />
            </label>
            <p id="server-token-help" className="field-help">
              This masked field is cleared after submission and is never shown in server status.
            </p>
            <button type="submit" disabled={busy}>
              Save and Test
            </button>
          </form>
          {formMessage !== "" ? (
            <p className="form-message" role="status" aria-live="polite">
              {formMessage}
            </p>
          ) : null}
          {settings?.profiles.length === 0 ? (
            <p className="empty-state">No GitHub server profiles are configured yet.</p>
          ) : (
            <div className="profile-list" aria-label="Configured GitHub servers">
              {settings?.profiles.map((profile) => (
                <article
                  className={`profile-card${selectedProfile?.id === profile.id ? " profile-card-selected" : ""}`}
                  key={profile.id}
                >
                  <div className="profile-card-heading">
                    <div>
                      <h3>{profile.displayName}</h3>
                      <p>{profile.webOrigin}</p>
                    </div>
                    <span className={`status-pill status-${profile.status.toLowerCase()}`}>
                      {statusLabel(profile)}
                    </span>
                  </div>
                  <dl className="profile-details">
                    <div>
                      <dt>API base</dt>
                      <dd>{profile.apiBaseUrl}</dd>
                    </div>
                    <div>
                      <dt>Account</dt>
                      <dd>{profile.accountLogin ?? "Not verified"}</dd>
                    </div>
                  </dl>
                  {profile.reason !== undefined ? (
                    <p className="profile-reason" role="status">
                      {profile.reason.message} Next action: {profile.reason.nextAction.toLowerCase().replaceAll("_", " ")}.
                    </p>
                  ) : null}
                  <div className="profile-actions">
                    <button type="button" disabled={busy} onClick={() => void runProfileAction("test", profile)}>
                      Test Connection
                    </button>
                    <button type="button" className="secondary-button" disabled={busy} onClick={() => void runProfileAction("remove", profile)}>
                      Remove
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {settings?.operations.length ? (
            <div className="operation-list" aria-label="Recovery operations">
              <h3>Operations needing attention</h3>
              {settings.operations.map((operation) => (
                <div className="operation-row" key={operation.id}>
                  <span>{operation.kind.toLowerCase().replaceAll("_", " ")} · {operation.phase.toLowerCase().replaceAll("_", " ")}</span>
                  {operationNeedsAction(operation) ? (
                    <div className="profile-actions">
                      <button type="button" disabled={busy} onClick={() => void runOperationAction("retry", operation)}>
                        Retry
                      </button>
                      <button type="button" className="secondary-button" disabled={busy} onClick={() => void runOperationAction("cleanup", operation)}>
                        Clean up
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
