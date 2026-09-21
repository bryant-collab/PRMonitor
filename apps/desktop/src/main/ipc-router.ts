import {
  boundedIpcResponse,
  IPC_CHANNELS,
  IPC_MAX_RESPONSE_BYTES,
  parseIpcOpenTargetEvent,
  parseIpcRequest,
  type CurrentState,
  type IpcError,
  type IpcOpenTargetEvent,
  type IpcInboxUpdateEvent,
  type IpcRequest,
  type IpcResponse,
  type LifecycleStatus,
} from "../shared/ipc";
import { parseOpenTargetRecord, type OpenTarget } from "../shared/routing";
import type {
  GithubServerProfileInput,
  GithubServerProfileView,
  GithubServerSettingsView,
} from "../shared/github-server";
import type {
  ManagedPrAddInput,
  ManagedPrCloneInput,
  ManagedPrConfigurationInput,
  ManagedPrCandidateListView,
  ManagedPrOperationView,
  ManagedPrReadModel,
  ManagedPrListView,
} from "../shared/managed-pr";
import {
  isManagedPrInboxReadModel,
  type ManagedPrInboxReadModel,
} from "../shared/inbox";
import type { ManagedPrNavigationDestination } from "../shared/routing";

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
  readonly readGithubSettings?: () => GithubServerSettingsView;
  readonly upsertGithubProfile?: (
    input: GithubServerProfileInput,
  ) => GithubServerProfileView | Promise<GithubServerProfileView>;
  readonly submitGithubCredential?: (input: {
    readonly serverId: string;
    readonly token: string;
    readonly operationId: string;
  }) => Promise<{ readonly operationId: string; readonly profile: GithubServerProfileView }>;
  readonly testGithubConnection?: (input: {
    readonly serverId: string;
    readonly operationId: string;
  }) => Promise<{ readonly operationId: string; readonly profile: GithubServerProfileView }>;
  readonly retryGithubOperation?: (
    operationId: string,
  ) => Promise<{ readonly operationId: string; readonly profile: GithubServerProfileView }>;
  readonly cleanupGithubOperation?: (
    operationId: string,
  ) => Promise<{ readonly operationId: string; readonly profile: GithubServerProfileView }>;
  readonly removeGithubProfile?: (input: {
    readonly serverId: string;
    readonly operationId: string;
  }) => Promise<{ readonly operationId: string; readonly profile: GithubServerProfileView }>;
  readonly readManagedPrs?: () => ManagedPrListView;
  readonly readManagedPr?: (managedPrId: string) => Promise<ManagedPrReadModel | undefined>;
  readonly addManagedPr?: (input: ManagedPrAddInput) => Promise<ManagedPrOperationView>;
  readonly retryManagedPrAdd?: (attemptId: string) => Promise<ManagedPrOperationView>;
  readonly readManagedPrCandidates?: (managedPrId: string) => Promise<ManagedPrCandidateListView>;
  readonly pickManagedPrFolder?: () => Promise<string | undefined>;
  readonly attachManagedPrClone?: (input: ManagedPrCloneInput) => Promise<ManagedPrOperationView>;
  readonly clearManagedPrClone?: (input: { readonly managedPrId: string; readonly expectedVersion: number }) => Promise<ManagedPrOperationView>;
  readonly saveManagedPrConfiguration?: (input: ManagedPrConfigurationInput) => Promise<ManagedPrOperationView>;
  readonly readInbox?: () => ManagedPrInboxReadModel;
  readonly navigateManagedPr?: (
    managedPrId: string,
    destination: ManagedPrNavigationDestination,
  ) => OpenTarget;
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
  private readonly inboxSubscribers = new Set<number>();
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
    if (sender.isDestroyed?.()) {
      this.sessions.delete(sender.id);
      this.inboxSubscribers.delete(sender.id);
    }
  }

  public detachRenderer(senderId: number): void {
    this.sessions.delete(senderId);
    this.inboxSubscribers.delete(senderId);
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
      if (request.type === "github.settings.read") {
        if (this.services.readGithubSettings === undefined)
          throw new Error("PRMONITOR_GITHUB_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "github-settings",
            settings: this.services.readGithubSettings(),
          }),
        );
      }
      if (request.type === "github.profile.upsert") {
        if (this.services.upsertGithubProfile === undefined)
          throw new Error("PRMONITOR_GITHUB_SERVICE_NOT_READY");
        const profile = await this.services.upsertGithubProfile(request.payload);
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "github-profile",
            profile,
          }),
        );
      }
      if (request.type === "github.credential.submit") {
        if (this.services.submitGithubCredential === undefined)
          throw new Error("PRMONITOR_GITHUB_SERVICE_NOT_READY");
        const result = await this.services.submitGithubCredential({
          serverId: request.payload.serverId,
          token: request.payload.token,
          operationId: request.requestId,
        });
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "github-operation",
            operationId: result.operationId,
            profile: result.profile,
          }),
        );
      }
      if (request.type === "github.connection.test") {
        if (this.services.testGithubConnection === undefined)
          throw new Error("PRMONITOR_GITHUB_SERVICE_NOT_READY");
        const result = await this.services.testGithubConnection({
          serverId: request.payload.serverId,
          operationId: request.requestId,
        });
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "github-operation",
            operationId: result.operationId,
            profile: result.profile,
          }),
        );
      }
      if (request.type === "github.operation.retry") {
        if (this.services.retryGithubOperation === undefined)
          throw new Error("PRMONITOR_GITHUB_SERVICE_NOT_READY");
        const result = await this.services.retryGithubOperation(
          request.payload.operationId,
        );
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "github-operation",
            operationId: result.operationId,
            profile: result.profile,
          }),
        );
      }
      if (request.type === "github.operation.cleanup") {
        if (this.services.cleanupGithubOperation === undefined)
          throw new Error("PRMONITOR_GITHUB_SERVICE_NOT_READY");
        const result = await this.services.cleanupGithubOperation(
          request.payload.operationId,
        );
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "github-operation",
            operationId: result.operationId,
            profile: result.profile,
          }),
        );
      }
      if (request.type === "github.profile.remove") {
        if (this.services.removeGithubProfile === undefined)
          throw new Error("PRMONITOR_GITHUB_SERVICE_NOT_READY");
        const result = await this.services.removeGithubProfile({
          serverId: request.payload.serverId,
          operationId: request.requestId,
        });
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "github-operation",
            operationId: result.operationId,
            profile: result.profile,
          }),
        );
      }
      if (request.type === "managed-pr.list") {
        if (this.services.readManagedPrs === undefined)
          throw new Error("PRMONITOR_MANAGED_PR_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "managed-pr-list",
            value: this.services.readManagedPrs(),
          }),
        );
      }
      if (request.type === "inbox.read" || request.type === "inbox.subscribe") {
        if (this.services.readInbox === undefined)
          throw new Error("PRMONITOR_INBOX_SERVICE_NOT_READY");
        const snapshot = this.services.readInbox();
        if (request.type === "inbox.subscribe") this.inboxSubscribers.add(sender.id);
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "managed-pr-inbox",
            snapshot,
          }),
        );
      }
      if (request.type === "inbox.navigate") {
        if (this.services.navigateManagedPr === undefined)
          throw new Error("PRMONITOR_INBOX_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "navigation-target",
            target: this.services.navigateManagedPr(
              request.payload.managedPrId,
              request.payload.destination,
            ),
          }),
        );
      }
      if (request.type === "managed-pr.read") {
        if (this.services.readManagedPr === undefined)
          throw new Error("PRMONITOR_MANAGED_PR_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "managed-pr-details",
            managedPr: (await this.services.readManagedPr(request.payload.managedPrId)) ?? null,
          }),
        );
      }
      if (request.type === "managed-pr.add") {
        if (this.services.addManagedPr === undefined)
          throw new Error("PRMONITOR_MANAGED_PR_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "managed-pr-operation",
            operation: await this.services.addManagedPr(request.payload),
          }),
        );
      }
      if (request.type === "managed-pr.retry") {
        if (this.services.retryManagedPrAdd === undefined)
          throw new Error("PRMONITOR_MANAGED_PR_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "managed-pr-operation",
            operation: await this.services.retryManagedPrAdd(request.payload.attemptId),
          }),
        );
      }
      if (request.type === "managed-pr.candidates") {
        if (this.services.readManagedPrCandidates === undefined)
          throw new Error("PRMONITOR_MANAGED_PR_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "managed-pr-candidates",
            value: await this.services.readManagedPrCandidates(request.payload.managedPrId),
          }),
        );
      }
      if (request.type === "managed-pr.clone.pick") {
        if (this.services.pickManagedPrFolder === undefined)
          throw new Error("PRMONITOR_MANAGED_PR_SERVICE_NOT_READY");
        const selected = await this.services.pickManagedPrFolder();
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "managed-pr-folder",
            ...(selected === undefined ? {} : { path: selected }),
          }),
        );
      }
      if (request.type === "managed-pr.clone.attach") {
        if (this.services.attachManagedPrClone === undefined)
          throw new Error("PRMONITOR_MANAGED_PR_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "managed-pr-operation",
            operation: await this.services.attachManagedPrClone(request.payload),
          }),
        );
      }
      if (request.type === "managed-pr.clone.clear") {
        if (this.services.clearManagedPrClone === undefined)
          throw new Error("PRMONITOR_MANAGED_PR_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "managed-pr-operation",
            operation: await this.services.clearManagedPrClone(request.payload),
          }),
        );
      }
      if (request.type === "managed-pr.configuration.save") {
        if (this.services.saveManagedPrConfiguration === undefined)
          throw new Error("PRMONITOR_MANAGED_PR_SERVICE_NOT_READY");
        return boundedIpcResponse(
          successResponse(request.requestId, {
            kind: "managed-pr-operation",
            operation: await this.services.saveManagedPrConfiguration(request.payload),
          }),
        );
      }
      return errorResponse(
        "ipc-unknown",
        "UNKNOWN_CHANNEL",
        "The IPC request type is not allowlisted.",
      );
    } catch (error) {
      const safeMessage =
        error instanceof Error && error.message.length <= 512
          ? error.message
          : "The main-process handler failed safely.";
      return errorResponse(request.requestId, "HANDLER_FAILED", safeMessage);
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

  public publishInbox(snapshot: ManagedPrInboxReadModel): number {
    if (!isManagedPrInboxReadModel(snapshot)) return 0;
    let delivered = 0;
    const event: IpcInboxUpdateEvent = {
      schemaVersion: 1,
      type: "inbox-update",
      snapshot,
    };
    try {
      if (new TextEncoder().encode(JSON.stringify(event)).byteLength > IPC_MAX_RESPONSE_BYTES)
        return 0;
    } catch {
      return 0;
    }
    for (const senderId of this.inboxSubscribers) {
      const session = this.sessions.get(senderId);
      if (session === undefined || session.sender.isDestroyed?.()) {
        this.inboxSubscribers.delete(senderId);
        continue;
      }
      try {
        session.sender.send(IPC_CHANNELS.event, event);
        delivered += 1;
      } catch {
        this.sessions.delete(senderId);
        this.inboxSubscribers.delete(senderId);
      }
    }
    return delivered;
  }
}

export type IpcRequestHandler = (
  request: IpcRequest,
  sender: IpcSenderLike,
) => Promise<IpcResponse>;
