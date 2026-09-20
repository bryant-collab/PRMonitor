import { app } from "electron";

export type FocusOutcome =
  | "created"
  | "focused"
  | "already-focused"
  | "focus-denied"
  | "timed-out"
  | "unsupported";

export interface WindowFocusResult {
  readonly outcome: FocusOutcome;
  readonly activeDesktopId?: string;
  readonly reasonCode?: string;
}

export interface WindowPlatformAdapter {
  readonly platform: NodeJS.Platform;
  readonly focusTimeoutMs: number;
  focus(window: FocusableWindow): Promise<WindowFocusResult>;
}

export interface FocusableWindow {
  isDestroyed(): boolean;
  isFocused(): boolean;
  show(): void;
  focus(): void;
}

function boundedTimeout(milliseconds: number): number {
  return Math.max(100, Math.min(milliseconds, 10_000));
}

export class ElectronWindowPlatformAdapter implements WindowPlatformAdapter {
  public readonly platform = process.platform;
  public readonly focusTimeoutMs: number;

  public constructor(focusTimeoutMs = 2_000) {
    this.focusTimeoutMs = boundedTimeout(focusTimeoutMs);
  }

  public async focus(window: FocusableWindow): Promise<WindowFocusResult> {
    if (window.isDestroyed())
      return { outcome: "focus-denied", reasonCode: "WINDOW_DESTROYED" };
    try {
      const alreadyFocused = window.isFocused();
      window.show();
      if (process.platform === "win32") app.focus({ steal: true });
      window.focus();
      return {
        outcome: alreadyFocused ? "already-focused" : "focused",
        ...(process.platform === "win32"
          ? { reasonCode: "FOREGROUND_ACTIVATION_BEST_EFFORT" }
          : {}),
      };
    } catch {
      return {
        outcome: "focus-denied",
        reasonCode: "FOREGROUND_ACTIVATION_DENIED",
      };
    }
  }
}

/**
 * Named adapter for the Windows handoff contract. Electron's supported
 * foreground API is deliberately kept here; a future native desktop
 * identity reader can replace this adapter without changing shared routing or
 * the window manager.
 */
export class WindowsWindowPlatformAdapter extends ElectronWindowPlatformAdapter {
  public override readonly platform = "win32" as const;
}
