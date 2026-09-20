import { useCallback, useEffect, useRef, type MouseEvent } from "react";
import {
  APPLICATION_TITLE,
  INITIAL_STARTUP_STATUS,
  STARTUP_STATUS_ID,
} from "../shared/startup";

export function StartupApp() {
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = APPLICATION_TITLE;
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
          {INITIAL_STARTUP_STATUS.message}
        </div>
        <p className="scope-note">
          The application shell is ready for the next feature.
        </p>
      </main>
    </div>
  );
}
