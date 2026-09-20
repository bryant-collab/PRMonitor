export const APPLICATION_TITLE = "PRMonitor";
export const STARTUP_STATUS_ID = "startup-status";
export const SMOKE_READY_PREFIX = "PRMONITOR_SMOKE_READY:";

export interface StartupStatus {
  readonly title: string;
  readonly ready: boolean;
  readonly message: string;
}

export const INITIAL_STARTUP_STATUS: StartupStatus = {
  title: APPLICATION_TITLE,
  ready: true,
  message: "The PRMonitor desktop shell is ready.",
};
