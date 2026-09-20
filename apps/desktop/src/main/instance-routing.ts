import {
  parseLaunchArguments,
  parseOpenTarget,
  type OpenTarget,
  type OpenTargetQueue,
} from "../shared/routing";

export interface SingleInstanceHost {
  requestSingleInstanceLock(): boolean;
  on(
    event: "second-instance" | "open-url",
    listener: (...args: readonly unknown[]) => void,
  ): this;
  quit(): void;
}

export interface PrimaryInstanceCoordinatorOptions {
  readonly host: SingleInstanceHost;
  readonly queue: OpenTargetQueue;
  readonly onRejectedTarget?: (reason: string) => void;
  readonly onAcceptedTarget?: (target: OpenTarget) => void;
}

export class PrimaryInstanceCoordinator {
  private acquired = false;

  public constructor(
    private readonly options: PrimaryInstanceCoordinatorOptions,
  ) {}

  public acquire(initialArguments: readonly string[]): boolean {
    if (this.acquired) return true;
    let lock: boolean;
    try {
      lock = this.options.host.requestSingleInstanceLock();
    } catch {
      this.options.host.quit();
      return false;
    }
    if (!lock) {
      this.options.host.quit();
      return false;
    }
    this.acquired = true;
    this.options.host.on("second-instance", (...args: readonly unknown[]) => {
      const commandLine = Array.isArray(args[1]) ? args[1] : [];
      this.acceptArguments(commandLine as readonly string[]);
    });
    this.options.host.on("open-url", (...args: readonly unknown[]) => {
      const event = args[0] as { preventDefault?: () => void } | undefined;
      event?.preventDefault?.();
      const rawUrl = typeof args[1] === "string" ? args[1] : undefined;
      if (rawUrl !== undefined) this.acceptUrl(rawUrl);
    });
    this.acceptArguments(initialArguments);
    return true;
  }

  public acceptArguments(argumentsList: readonly string[]): boolean {
    const parsed = parseLaunchArguments(argumentsList);
    if (parsed === undefined) return false;
    if (!parsed.ok) {
      this.options.onRejectedTarget?.(parsed.error.reason.code);
      return false;
    }
    return this.enqueue(parsed.value);
  }

  public acceptUrl(rawUrl: string): boolean {
    const parsed = parseOpenTarget(rawUrl);
    if (!parsed.ok) {
      this.options.onRejectedTarget?.(parsed.error.reason.code);
      return false;
    }
    return this.enqueue(parsed.value);
  }

  private enqueue(target: OpenTarget): boolean {
    const accepted = this.options.queue.enqueue(target);
    if (accepted) this.options.onAcceptedTarget?.(target);
    return accepted;
  }
}
