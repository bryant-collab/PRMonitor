import { OpenTargetQueue, type OpenTarget } from "../shared/routing";
import type {
  FocusOutcome,
  WindowFocusResult,
  WindowPlatformAdapter,
} from "./platform-window";

export interface RendererContentsLike {
  readonly id: number;
  send(channel: string, payload: unknown): void;
}

export interface ManagedWindowLike {
  readonly webContents: RendererContentsLike;
  on(event: string, listener: (...args: readonly unknown[]) => void): this;
  once(event: string, listener: (...args: readonly unknown[]) => void): this;
  removeListener(
    event: string,
    listener: (...args: readonly unknown[]) => void,
  ): this;
  isDestroyed(): boolean;
  isFocused(): boolean;
  show(): void;
  focus(): void;
  close(): void;
  destroy(): void;
  loadFile(file: string): Promise<void>;
}

export interface WindowOpenResult {
  readonly ok: boolean;
  readonly outcome: "created" | "focused" | FocusOutcome;
  readonly windowId?: number;
  readonly rendererReady: boolean;
  readonly targetDelivered: number;
  readonly activeDesktopId?: string;
  readonly reasonCode?: string;
}

export interface WindowManagerOptions {
  readonly rendererEntry: string;
  readonly preloadEntry: string;
  readonly createWindow: (options: {
    readonly preload: string;
    readonly show: boolean;
  }) => ManagedWindowLike;
  readonly platform: WindowPlatformAdapter;
  readonly rendererReadyTimeoutMs?: number;
  readonly sendTarget: (
    contents: RendererContentsLike,
    target: OpenTarget,
  ) => boolean;
  readonly onRendererAttached?: (contents: RendererContentsLike) => void;
  readonly onRendererDetached?: (contentsId: number, reason: string) => void;
}

const NOOP_RESULT: WindowOpenResult = {
  ok: false,
  outcome: "focus-denied",
  rendererReady: false,
  targetDelivered: 0,
  reasonCode: "WINDOW_MANAGER_UNAVAILABLE",
};

export class WindowManager {
  private readonly pendingTargets = new OpenTargetQueue();
  private readonly rendererReadyTimeoutMs: number;
  private window: ManagedWindowLike | undefined;
  private readonly cleanupByWindow = new WeakMap<
    ManagedWindowLike,
    () => void
  >();
  private readonly contentsIdByWindow = new WeakMap<
    ManagedWindowLike,
    number
  >();
  private openWork: Promise<WindowOpenResult> | undefined;
  private ready = false;
  private readyWaiter:
    | {
        readonly contentsId: number;
        readonly promise: Promise<boolean>;
        resolve(value: boolean): void;
      }
    | undefined;

  public constructor(private readonly options: WindowManagerOptions) {
    this.rendererReadyTimeoutMs = Math.max(
      250,
      Math.min(options.rendererReadyTimeoutMs ?? 10_000, 60_000),
    );
  }

  public get visibleWindow(): ManagedWindowLike | undefined {
    return this.window;
  }

  public get visibleWindowId(): number | undefined {
    return this.window === undefined
      ? undefined
      : this.contentsIdByWindow.get(this.window);
  }

  public async open(target?: OpenTarget): Promise<WindowOpenResult> {
    if (target !== undefined) this.pendingTargets.enqueue(target);
    if (this.openWork !== undefined) return this.openWork;
    const currentWindow = this.window;
    if (
      currentWindow !== undefined &&
      !currentWindow.isDestroyed() &&
      this.ready
    ) {
      const focus = await this.focus(currentWindow);
      const focusOk =
        focus.outcome !== "focus-denied" &&
        focus.outcome !== "timed-out" &&
        focus.outcome !== "unsupported";
      const delivered = focusOk ? this.flushTargets() : 0;
      return {
        ok: focusOk,
        outcome: "focused",
        windowId: currentWindow.webContents.id,
        rendererReady: true,
        targetDelivered: delivered,
        ...(focus.activeDesktopId === undefined
          ? {}
          : { activeDesktopId: focus.activeDesktopId }),
        ...(focus.reasonCode === undefined
          ? {}
          : { reasonCode: focus.reasonCode }),
      };
    }

    this.openWork = this.createAndOpen();
    try {
      return await this.openWork;
    } finally {
      this.openWork = undefined;
    }
  }

  public markRendererReady(contentsId: number): boolean {
    if (
      this.window === undefined ||
      this.window.isDestroyed() ||
      this.window.webContents.id !== contentsId
    )
      return false;
    this.ready = true;
    if (this.readyWaiter?.contentsId === contentsId)
      this.readyWaiter.resolve(true);
    return true;
  }

  public closeForShutdown(): void {
    const current = this.window;
    if (current === undefined || current.isDestroyed()) return;
    current.close();
  }

  private async createAndOpen(): Promise<WindowOpenResult> {
    if (this.window !== undefined && !this.window.isDestroyed())
      return NOOP_RESULT;
    const created = this.options.createWindow({
      preload: this.options.preloadEntry,
      show: false,
    });
    this.window = created;
    this.ready = false;
    const contentsId = created.webContents.id;
    this.contentsIdByWindow.set(created, contentsId);
    const closed = (..._args: readonly unknown[]) =>
      this.onClosed(created, "WINDOW_CLOSED");
    const crashed = (..._args: readonly unknown[]) => {
      this.onClosed(created, "RENDERER_FAILED");
      if (!created.isDestroyed()) created.destroy();
    };
    created.once("closed", closed);
    created.on("render-process-gone", crashed);
    this.cleanupByWindow.set(created, () => {
      created.removeListener("render-process-gone", crashed);
    });
    this.options.onRendererAttached?.(created.webContents);
    let targetDelivered = 0;
    try {
      await created.loadFile(this.options.rendererEntry);
      const rendererReady = await this.waitForReady(contentsId);
      if (!rendererReady || this.window !== created || created.isDestroyed()) {
        this.onClosed(created, "RENDERER_READY_TIMEOUT");
        if (!created.isDestroyed()) created.destroy();
        return {
          ok: false,
          outcome: "timed-out",
          windowId: contentsId,
          rendererReady: false,
          targetDelivered,
          reasonCode: "RENDERER_READY_TIMEOUT",
        };
      }
      const focus = await this.focus(created);
      const focusOk =
        focus.outcome !== "focus-denied" &&
        focus.outcome !== "timed-out" &&
        focus.outcome !== "unsupported";
      targetDelivered = focusOk ? this.flushTargets() : 0;
      return {
        ok: focusOk,
        outcome: "created",
        windowId: contentsId,
        rendererReady: true,
        targetDelivered,
        ...(focus.activeDesktopId === undefined
          ? {}
          : { activeDesktopId: focus.activeDesktopId }),
        ...(focus.reasonCode === undefined
          ? {}
          : { reasonCode: focus.reasonCode }),
      };
    } catch {
      this.onClosed(created, "WINDOW_CREATE_FAILED");
      if (!created.isDestroyed()) created.destroy();
      return {
        ok: false,
        outcome: "focus-denied",
        windowId: contentsId,
        rendererReady: false,
        targetDelivered,
        reasonCode: "WINDOW_CREATE_FAILED",
      };
    }
  }

  private waitForReady(contentsId: number): Promise<boolean> {
    if (this.ready && this.window?.webContents.id === contentsId)
      return Promise.resolve(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resolveWaiter!: (value: boolean) => void;
    const promise = new Promise<boolean>((resolve) => {
      resolveWaiter = resolve;
      timer = setTimeout(() => resolve(false), this.rendererReadyTimeoutMs);
    }).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
      if (this.readyWaiter?.contentsId === contentsId)
        this.readyWaiter = undefined;
    });
    this.readyWaiter = { contentsId, promise, resolve: resolveWaiter };
    return promise;
  }

  private flushTargets(): number {
    if (!this.ready || this.window === undefined || this.window.isDestroyed())
      return 0;
    let delivered = 0;
    while (this.pendingTargets.size > 0) {
      const target = this.pendingTargets.dequeue();
      if (target === undefined) break;
      if (!this.options.sendTarget(this.window.webContents, target)) {
        this.pendingTargets.requeueFront(target);
        break;
      }
      delivered += 1;
    }
    return delivered;
  }

  private async focus(window: ManagedWindowLike): Promise<WindowFocusResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.options.platform.focus(window),
        new Promise<WindowFocusResult>((resolve) => {
          timer = setTimeout(
            () =>
              resolve({ outcome: "timed-out", reasonCode: "FOCUS_TIMEOUT" }),
            this.options.platform.focusTimeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private onClosed(window: ManagedWindowLike, reason: string): void {
    if (this.window !== window) return;
    const contentsId = this.contentsIdByWindow.get(window);
    this.cleanupByWindow.get(window)?.();
    this.cleanupByWindow.delete(window);
    this.contentsIdByWindow.delete(window);
    this.window = undefined;
    this.ready = false;
    if (this.readyWaiter !== undefined) this.readyWaiter.resolve(false);
    if (contentsId !== undefined)
      this.options.onRendererDetached?.(contentsId, reason);
  }
}

export type BrowserWindowFactory = WindowManagerOptions["createWindow"];
