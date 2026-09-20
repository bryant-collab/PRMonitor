import {
  boundedIpcResponse,
  IPC_CHANNELS,
  parseIpcOpenTargetEvent,
  parseIpcRequest,
  type CurrentState,
  type IpcError,
  type IpcOpenTargetEvent,
  type IpcRequest,
  type IpcResponse,
  type LifecycleStatus,
} from "../shared/ipc";
import { parseOpenTargetRecord, type OpenTarget } from "../shared/routing";

export interface IpcSenderLike {
  readonly id: number;
  readonly isDestroyed?: () => boolean;
  send(channel: string, payload: unknown): void;
}

export interface IpcMainLike {
  handle(
    channel: string,
    listener: (
      event: { readonly sender: IpcSenderLike },
      payload: unknown,
    ) => Promise<IpcResponse>,
  ): void;
}

export interface IpcServices {
  readonly readCurrentState: (sessionId: string) => CurrentState;
  readonly getLifecycleStatus: () => LifecycleStatus;
  readonly requestShutdown: () => Promise<{
    readonly status: LifecycleStatus;
    readonly ok: boolean;
    readonly error?: IpcError;
  }>;
  readonly onRendererReady?: (senderId: number, sessionId: string) => void;
}

interface RendererSession {
  readonly sessionId: string;
  readonly sender: IpcSenderLike;
}

function errorResponse(
  requestId: string,
  code: IpcError["code"],
  message: string,
): IpcResponse {
  return {
    schemaVersion: 1,
    requestId,
    ok: false,
    error: { code, message, correlationId: `ipc-${requestId}` },
  };
}

function successResponse(
  requestId: string,
  value: Extract<IpcResponse, { readonly ok: true }>["value"],
): IpcResponse {
  return { schemaVersion: 1, requestId, ok: true, value };
}

export class IpcRouter {
  private readonly sessions = new Map<number, RendererSession>();
  private installed = false;

  public constructor(
    private readonly ipcMain: IpcMainLike,
    private readonly services: IpcServices,
  ) {}

  public install(): void {
    if (this.installed) return;
    this.installed = true;
    this.ipcMain.handle(IPC_CHANNELS.request, async (event, payload) =>
      this.handle(payload, event.sender),
    );
  }

  public attachRenderer(sender: IpcSenderLike): void {
    // The webContents object is kept only as a scoped reply/event target.
    // It never becomes application state or a capability supplied by the renderer.
    if (sender.isDestroyed?.()) this.sessions.delete(sender.id);
  }

  public detachRenderer(senderId: number): void {
    this.sessions.delete(senderId);
  }

  public async handle(
    payload: unknown,
    sender: IpcSenderLike,
  ): Promise<IpcResponse> {
    const parsed = parseIpcRequest(payload);
    if (!parsed.ok) {
      return {
        schemaVersion: 1,
        requestId: "ipc-invalid-request",
        ok: false,
        error: parsed.error,
      };
    }
    const request = parsed.value;
    try {
      if (request.type === "renderer.ready") {
        const existing = this.sessions.get(sender.id);
        if (
          existing !== undefined &&
          existing.sessionId !== request.payload.sessionId
        ) {
          return errorResponse(
            request.requestId,
            "UNAUTHORIZED",
            "The renderer session identity changed unexpectedly.",
          );
        }
        this.sessions.set(sender.id, {
          sessionId: request.payload.sessionId,
          sender,
        });
        this.services.onRendererReady?.(sender.id, request.payload.sessionId);
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "renderer-ready",
            sessionId: request.payload.sessionId,
          }),
        );
      }

      const session = this.sessions.get(sender.id);
      if (session === undefined)
        return errorResponse(
          request.requestId,
          "NOT_READY",
          "The renderer must complete its ready handshake first.",
        );
      if (session.sender !== sender || sender.isDestroyed?.()) {
        this.sessions.delete(sender.id);
        return errorResponse(
          request.requestId,
          "UNAUTHORIZED",
          "The renderer session is no longer active.",
        );
      }

      if (request.type === "app.read-current-state") {
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "current-state",
            state: this.services.readCurrentState(session.sessionId),
          }),
        );
      }
      if (request.type === "lifecycle.status") {
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "lifecycle-status",
            status: this.services.getLifecycleStatus(),
          }),
        );
      }
      if (request.type === "lifecycle.shutdown") {
        const result = await this.services.requestShutdown();
        if (!result.ok) {
          return boundedIpcResponse({
            schemaVersion: 1,
            requestId: request.requestId,
            ok: false,
            error: result.error ?? {
              code: "SHUTDOWN_IN_PROGRESS",
              message: "Shutdown requires lifecycle recovery.",
              correlationId: `ipc-${request.requestId}`,
            },
          });
        }
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "shutdown",
            status: result.status,
          }),
        );
      }
      return errorResponse(
        "ipc-unknown",
        "UNKNOWN_CHANNEL",
        "The IPC request type is not allowlisted.",
      );
    } catch {
      return errorResponse(
        request.requestId,
        "HANDLER_FAILED",
        "The main-process handler failed safely.",
      );
    }
  }

  public deliverOpenTarget(senderId: number, target: OpenTarget): boolean {
    const session = this.sessions.get(senderId);
    const parsedTarget = parseOpenTargetRecord(target);
    if (
      session === undefined ||
      !parsedTarget.ok ||
      session.sender.isDestroyed?.()
    )
      return false;
    const event: IpcOpenTargetEvent = {
      schemaVersion: 1,
      type: "open-target",
      target: parsedTarget.value,
    };
    if (!parseIpcOpenTargetEvent(event)) return false;
    try {
      session.sender.send(IPC_CHANNELS.event, event);
      return true;
    } catch {
      this.sessions.delete(senderId);
      return false;
    }
  }

  public hasSession(senderId: number): boolean {
    return this.sessions.has(senderId);
  }
}

export type IpcRequestHandler = (
  request: IpcRequest,
  sender: IpcSenderLike,
) => Promise<IpcResponse>;
