import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import {
  APPLICATION_TITLE,
  INITIAL_STARTUP_STATUS,
  STARTUP_STATUS_ID,
} from "../shared/startup";
import type { CurrentState } from "../shared/ipc";

export function StartupApp() {
  const statusRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<CurrentState | undefined>();
  const [targetLabel, setTargetLabel] = useState("home");

  useEffect(() => {
    document.title = APPLICATION_TITLE;
  }, []);

  useEffect(() => {
    let active = true;
    const bridge = window.prmonitor;
    if (bridge === undefined) return () => undefined;
    void bridge
      .ready()
      .then(() => bridge.readCurrentState())
      .then((response) => {
        if (!active || !response.ok || response.value.kind !== "current-state")
          return;
        setState(response.value.state);
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
      </main>
    </div>
  );
}
