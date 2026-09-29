import { Menu, Notification, Tray, nativeImage } from "electron";
import { existsSync } from "node:fs";
import type {
  F19NativeDeliveryResult,
  F19NativeNotificationAction,
  F19NativeNotificationRequest,
  F19TrayCommand,
  F19TrayMenuModel,
} from "../shared/f19-native-surfaces";

export interface F19TrayTargetActivation {
  readonly activationId: string;
  readonly action: "OPEN_TARGET" | "OPEN_WORKTREE";
}

export interface F19NativeSurfaceCallbacks {
  readonly onCommand: (command: F19TrayCommand) => void;
  readonly onTarget: (activation: F19TrayTargetActivation) => void;
}

export interface F19TrayHandle {
  readonly id: string;
  update(menu: F19TrayMenuModel): void;
  destroy(): void;
}

export interface F19NativeSurfaceCapabilities {
  readonly tray: boolean;
  readonly notifications: boolean;
  readonly notificationActions: boolean;
}

export interface F19NativeSurfaceAdapter {
  readonly capabilities: F19NativeSurfaceCapabilities;
  createTray(callbacks: F19NativeSurfaceCallbacks): F19TrayHandle;
  deliverNotification(
    request: F19NativeNotificationRequest,
    callbacks: F19NativeSurfaceCallbacks,
  ): Promise<F19NativeDeliveryResult>;
}

const TRANSPARENT_TRAY_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function trayAction(
  callback: () => void,
  label: string,
): { readonly label: string; readonly click: () => void } {
  return { label, click: callback };
}

function nativeAction(action: F19NativeNotificationAction): {
  readonly type: "button";
  readonly text: string;
} {
  return { type: "button", text: action.label };
}

/**
 * Electron-only implementation.  The coordinator receives only this
 * platform-neutral adapter and therefore remains deterministic in tests.
 */
export class ElectronF19NativeSurfaceAdapter implements F19NativeSurfaceAdapter {
  public constructor(private readonly iconPath?: string) {}

  public readonly capabilities: F19NativeSurfaceCapabilities = {
    tray: true,
    notifications:
      typeof (Notification as unknown as { isSupported?: () => boolean })
        .isSupported !== "function" ||
      (Notification as unknown as { isSupported: () => boolean }).isSupported(),
    notificationActions:
      process.platform === "win32" || process.platform === "darwin",
  };

  public createTray(callbacks: F19NativeSurfaceCallbacks): F19TrayHandle {
    const icon =
      this.iconPath !== undefined && existsSync(this.iconPath)
        ? nativeImage.createFromPath(this.iconPath)
        : nativeImage.createFromDataURL(TRANSPARENT_TRAY_ICON);
    const tray = new Tray(icon);
    tray.setToolTip("PRMonitor");
    tray.on("click", () => callbacks.onCommand("OPEN_APP"));
    let destroyed = false;
    return {
      id: `tray-${process.pid}`,
      update: (model) => {
        if (destroyed) return;
        const entries = model.entries.map((entry) =>
          trayAction(
            () =>
              callbacks.onTarget({
                activationId: entry.id,
                action: "OPEN_TARGET",
              }),
            `${entry.semanticState}: ${entry.label}`,
          ),
        );
        if (model.overflowed)
          entries.push(
            trayAction(
              () =>
                callbacks.onTarget({
                  activationId: "more:home",
                  action: "OPEN_TARGET",
                }),
              "More in PRMonitor",
            ),
          );
        tray.setContextMenu(
          Menu.buildFromTemplate([
            {
              label: `${model.needsReviewCount} PRs need review`,
              enabled: false,
            },
            {
              label: model.paused ? "Watching paused" : "Watching active",
              enabled: false,
            },
            ...entries,
            { type: "separator" },
            trayAction(() => callbacks.onCommand("OPEN_APP"), "Open PRMonitor"),
            trayAction(
              () => callbacks.onCommand(model.paused ? "RESUME" : "PAUSE"),
              model.commands.pauseOrResume,
            ),
            trayAction(
              () => callbacks.onCommand("SHUTDOWN"),
              "Shutdown PRMonitor",
            ),
          ]),
        );
      },
      destroy: () => {
        if (destroyed) return;
        destroyed = true;
        tray.destroy();
      },
    };
  }

  public deliverNotification(
    request: F19NativeNotificationRequest,
    callbacks: F19NativeSurfaceCallbacks,
  ): Promise<F19NativeDeliveryResult> {
    if (!this.capabilities.notifications)
      return Promise.resolve({
        state: "UNAVAILABLE",
        reasonCode: "NOT_SUPPORTED",
      });
    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (result: F19NativeDeliveryResult): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        resolve(result);
      };
      try {
        const notification = new Notification({
          id: request.notificationId,
          title: request.title,
          body: request.body,
          ...(this.capabilities.notificationActions
            ? { actions: request.actions.map(nativeAction) }
            : {}),
        });
        notification.once("show", () => finish({ state: "DELIVERED" }));
        notification.once("failed", (_event, error) =>
          finish({ state: "FAILED", reasonCode: error.slice(0, 128) }),
        );
        notification.on("click", () =>
          callbacks.onTarget({
            activationId: request.notificationId,
            action: "OPEN_TARGET",
          }),
        );
        notification.on("action", (event) => {
          const action = request.actions[event.actionIndex];
          if (action !== undefined)
            callbacks.onTarget({
              activationId: request.notificationId,
              action: action.action,
            });
        });
        notification.show();
        timer = setTimeout(
          () =>
            finish({ state: "UNKNOWN", reasonCode: "NATIVE_RESULT_TIMEOUT" }),
          2_000,
        );
      } catch {
        finish({ state: "FAILED", reasonCode: "NATIVE_NOTIFICATION_FAILED" });
      }
    });
  }
}
