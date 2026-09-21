import { isSafeText } from "./domain/result";
import { parseOpenTargetRecord, type OpenTarget } from "./routing";
import {
  isGithubServerProfileView,
  isGithubServerSettingsView,
  type GithubServerProfileInput,
  type GithubServerProfileView,
  type GithubServerSettingsView,
} from "./github-server";

export const IPC_SCHEMA_VERSION = 1 as const;
export const IPC_MAX_REQUEST_BYTES = 16 * 1024;
export const IPC_MAX_RESPONSE_BYTES = 64 * 1024;

export const IPC_CHANNELS = {
  request: "prmonitor:ipc:v1:request",
  event: "prmonitor:ipc:v1:event",
} as const;

export type IpcRequestType =
  | "renderer.ready"
  | "app.read-current-state"
  | "lifecycle.status"
  | "lifecycle.shutdown"
  | "github.settings.read"
  | "github.profile.upsert"
  | "github.credential.submit"
  | "github.connection.test"
  | "github.operation.retry"
  | "github.operation.cleanup"
  | "github.profile.remove";

export interface IpcRequestBase {
  readonly schemaVersion: typeof IPC_SCHEMA_VERSION;
  readonly requestId: string;
  readonly type: IpcRequestType;
}

export type IpcRequest =
  | (IpcRequestBase & {
      readonly type: "renderer.ready";
      readonly payload: { readonly sessionId: string };
    })
  | (IpcRequestBase & {
      readonly type: "app.read-current-state";
      readonly payload: Record<string, never>;
    })
  | (IpcRequestBase & {
      readonly type: "lifecycle.status";
      readonly payload: Record<string, never>;
    })
  | (IpcRequestBase & {
      readonly type: "lifecycle.shutdown";
      readonly payload: { readonly command: "Shutdown PRMonitor" };
    })
  | (IpcRequestBase & {
      readonly type: "github.settings.read";
      readonly payload: Record<string, never>;
    })
  | (IpcRequestBase & {
      readonly type: "github.profile.upsert";
      readonly payload: GithubServerProfileInput;
    })
  | (IpcRequestBase & {
      readonly type: "github.credential.submit";
      readonly payload: { readonly serverId: string; readonly token: string };
    })
  | (IpcRequestBase & {
      readonly type: "github.connection.test";
      readonly payload: { readonly serverId: string };
    })
  | (IpcRequestBase & {
      readonly type: "github.operation.retry";
      readonly payload: { readonly operationId: string };
    })
  | (IpcRequestBase & {
      readonly type: "github.operation.cleanup";
      readonly payload: { readonly operationId: string };
    })
  | (IpcRequestBase & {
      readonly type: "github.profile.remove";
      readonly payload: { readonly serverId: string };
    });

export interface IpcError {
  readonly code:
    | "INVALID_REQUEST"
    | "UNKNOWN_CHANNEL"
    | "UNAUTHORIZED"
    | "HANDLER_FAILED"
    | "NOT_READY"
    | "SHUTDOWN_IN_PROGRESS"
    | "HANDOFF_RECOVERY_REQUIRED"
    | "SERVICE_START_FAILED"
    | "SERVICE_STOP_FAILED"
    | "SERVICE_STOP_TIMEOUT"
    | "SERVICE_HANDOFF_TIMEOUT";
  readonly message: string;
  readonly correlationId: string;
}

export type LifecyclePhase =
  | "STARTING"
  | "RUNNING"
  | "SHUTDOWN_REQUESTED"
  | "HANDING_OFF"
  | "STOPPED"
  | "RECOVERY_REQUIRED";

export interface LifecycleStatus {
  readonly schemaVersion: typeof IPC_SCHEMA_VERSION;
  readonly phase: LifecyclePhase;
  readonly sessionId: string;
  readonly correlationId: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly shutdownCommand?: "Shutdown PRMonitor";
  readonly reasonCode?: string;
  readonly incompleteHandoff: boolean;
}

export interface CurrentState {
  readonly schemaVersion: typeof IPC_SCHEMA_VERSION;
  readonly applicationTitle: "PRMonitor";
  readonly lifecycle: LifecycleStatus;
  readonly persistence: {
    readonly status: "healthy" | "upgraded" | "recovery_required";
    readonly schemaVersion: number;
  };
  readonly openTarget?: OpenTarget;
}

export type IpcResponseValue =
  | { readonly kind: "renderer-ready"; readonly sessionId: string }
  | { readonly kind: "current-state"; readonly state: CurrentState }
  | { readonly kind: "lifecycle-status"; readonly status: LifecycleStatus }
  | { readonly kind: "shutdown"; readonly status: LifecycleStatus }
  | { readonly kind: "github-settings"; readonly settings: GithubServerSettingsView }
  | { readonly kind: "github-profile"; readonly profile: GithubServerProfileView }
  | {
      readonly kind: "github-operation";
      readonly operationId: string;
      readonly profile: GithubServerProfileView;
    };

export type IpcResponse =
  | {
      readonly schemaVersion: typeof IPC_SCHEMA_VERSION;
      readonly requestId: string;
      readonly ok: true;
      readonly value: IpcResponseValue;
    }
  | {
      readonly schemaVersion: typeof IPC_SCHEMA_VERSION;
      readonly requestId: string;
      readonly ok: false;
      readonly error: IpcError;
    };

export interface IpcOpenTargetEvent {
  readonly schemaVersion: typeof IPC_SCHEMA_VERSION;
  readonly type: "open-target";
  readonly target: OpenTarget;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SECRET_KEY =
  /(?:token|secret|password|credential|authorization|cookie|prompt|api[_.-]?key|access[_.-]?key|environment|env)/iu;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const allowed = new Set(keys);
  return Object.keys(record).every((key) => allowed.has(key));
}

function safeRequestId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

function safeText(value: unknown, maximum = 2_048): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    !SECRET_KEY.test(value) &&
    isSafeText(value)
  );
}

function safeGithubIdentifier(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

function safeCredentialValue(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    byteLength(value) <= 4_096 &&
    [...value].every((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 31 && codePoint !== 127;
    })
  );
}

function safeProfileText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    byteLength(value) <= maximum &&
    isSafeText(value) &&
    [...value].every((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 31 && codePoint !== 127;
    })
  );
}

function hasExactKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => key in record) &&
    Object.keys(record).every((key) => allowed.has(key))
  );
}

function parseLifecycleStatus(value: unknown): value is LifecycleStatus {
  if (!isPlainRecord(value)) return false;
  if (
    !hasExactKeys(
      value,
      [
        "schemaVersion",
        "phase",
        "sessionId",
        "correlationId",
        "startedAt",
        "updatedAt",
        "incompleteHandoff",
      ],
      ["shutdownCommand", "reasonCode"],
    )
  )
    return false;
  return (
    value.schemaVersion === IPC_SCHEMA_VERSION &&
    typeof value.phase === "string" &&
    [
      "STARTING",
      "RUNNING",
      "SHUTDOWN_REQUESTED",
      "HANDING_OFF",
      "STOPPED",
      "RECOVERY_REQUIRED",
    ].includes(value.phase) &&
    safeRequestId(value.sessionId) &&
    safeRequestId(value.correlationId) &&
    safeText(value.startedAt, 64) &&
    safeText(value.updatedAt, 64) &&
    typeof value.incompleteHandoff === "boolean" &&
    (value.shutdownCommand === undefined ||
      value.shutdownCommand === "Shutdown PRMonitor") &&
    (value.reasonCode === undefined || safeText(value.reasonCode, 128))
  );
}

function parseCurrentState(value: unknown): value is CurrentState {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(
      value,
      ["schemaVersion", "applicationTitle", "lifecycle", "persistence"],
      ["openTarget"],
    )
  )
    return false;
  if (
    !parseLifecycleStatus(value.lifecycle) ||
    value.schemaVersion !== IPC_SCHEMA_VERSION ||
    value.applicationTitle !== "PRMonitor"
  )
    return false;
  if (
    !isPlainRecord(value.persistence) ||
    !hasExactKeys(value.persistence, ["status", "schemaVersion"])
  )
    return false;
  if (
    !["healthy", "upgraded", "recovery_required"].includes(
      String(value.persistence.status),
    ) ||
    typeof value.persistence.schemaVersion !== "number" ||
    !Number.isSafeInteger(value.persistence.schemaVersion) ||
    value.persistence.schemaVersion < 0
  )
    return false;
  return (
    value.openTarget === undefined || parseOpenTargetRecord(value.openTarget).ok
  );
}

function parseResponseValue(value: unknown): boolean {
  if (!isPlainRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "renderer-ready")
    return (
      hasExactKeys(value, ["kind", "sessionId"]) &&
      safeRequestId(value.sessionId)
    );
  if (value.kind === "current-state")
    return (
      hasExactKeys(value, ["kind", "state"]) && parseCurrentState(value.state)
    );
  if (value.kind === "lifecycle-status")
    return (
      hasExactKeys(value, ["kind", "status"]) &&
      parseLifecycleStatus(value.status)
    );
  if (value.kind === "shutdown")
    return (
      hasExactKeys(value, ["kind", "status"]) &&
      parseLifecycleStatus(value.status)
    );
  if (value.kind === "github-settings")
    return (
      hasExactKeys(value, ["kind", "settings"]) &&
      isGithubServerSettingsView(value.settings)
    );
  if (value.kind === "github-profile")
    return (
      hasExactKeys(value, ["kind", "profile"]) &&
      isGithubServerProfileView(value.profile)
    );
  if (value.kind === "github-operation")
    return (
      hasExactKeys(value, ["kind", "operationId", "profile"]) &&
      safeGithubIdentifier(value.operationId) &&
      isGithubServerProfileView(value.profile)
    );
  return false;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function invalidRequest(message: string): { ok: false; error: IpcError } {
  return {
    ok: false,
    error: {
      code: "INVALID_REQUEST",
      message,
      correlationId: "ipc-invalid-request",
    },
  };
}

export function parseIpcRequest(
  value: unknown,
):
  | { readonly ok: true; readonly value: IpcRequest }
  | { readonly ok: false; readonly error: IpcError } {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return invalidRequest("The IPC request could not be serialized safely.");
  }
  if (byteLength(serialized) > IPC_MAX_REQUEST_BYTES) {
    return invalidRequest("The IPC request exceeds the bounded limit.");
  }
  if (!isPlainRecord(value))
    return invalidRequest("The IPC request must be a plain object.");
  if (!hasOnlyKeys(value, ["schemaVersion", "requestId", "type", "payload"])) {
    return invalidRequest("The IPC request contains an unsupported field.");
  }
  if (
    value.schemaVersion !== IPC_SCHEMA_VERSION ||
    !safeRequestId(value.requestId) ||
    typeof value.type !== "string" ||
    !isPlainRecord(value.payload)
  ) {
    return invalidRequest(
      "The IPC request has an invalid version, identity, type, or payload.",
    );
  }
  const base = {
    schemaVersion: IPC_SCHEMA_VERSION,
    requestId: value.requestId,
    type: value.type,
  } as const;
  if (value.type === "renderer.ready") {
    if (
      !hasOnlyKeys(value.payload, ["sessionId"]) ||
      !safeRequestId(value.payload.sessionId)
    ) {
      return invalidRequest("The renderer-ready payload is invalid.");
    }
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: { sessionId: value.payload.sessionId },
      },
    };
  }
  if (
    value.type === "app.read-current-state" ||
    value.type === "lifecycle.status"
  ) {
    if (Object.keys(value.payload).length !== 0)
      return invalidRequest("This IPC request does not accept a payload.");
    return {
      ok: true,
      value: { ...base, type: value.type, payload: {} } as IpcRequest,
    };
  }
  if (value.type === "lifecycle.shutdown") {
    if (
      !hasOnlyKeys(value.payload, ["command"]) ||
      value.payload.command !== "Shutdown PRMonitor"
    ) {
      return invalidRequest(
        "Only the explicit Shutdown PRMonitor command is accepted.",
      );
    }
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: { command: "Shutdown PRMonitor" },
      },
    };
  }
  if (value.type === "github.credential.submit") {
    if (
      !hasExactKeys(value.payload, ["serverId", "token"]) ||
      !safeGithubIdentifier(value.payload.serverId) ||
      !safeCredentialValue(value.payload.token)
    ) {
      return invalidRequest("The protected access submission is invalid.");
    }
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: {
          serverId: value.payload.serverId,
          token: value.payload.token,
        },
      },
    };
  }
  if (value.type === "github.settings.read") {
    if (Object.keys(value.payload).length !== 0)
      return invalidRequest("The GitHub settings read does not accept a payload.");
    return { ok: true, value: { ...base, type: value.type, payload: {} } };
  }
  if (value.type === "github.profile.upsert") {
    if (
      !hasExactKeys(value.payload, ["displayName", "serverUrl"], ["expectedVersion"]) ||
      !safeProfileText(value.payload.displayName, 120) ||
      !safeProfileText(value.payload.serverUrl, 2_048) ||
      (value.payload.expectedVersion !== undefined &&
        (typeof value.payload.expectedVersion !== "number" ||
          !Number.isSafeInteger(value.payload.expectedVersion) ||
          value.payload.expectedVersion < 1))
    )
      return invalidRequest("The GitHub server profile input is invalid.");
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: {
          displayName: value.payload.displayName,
          serverUrl: value.payload.serverUrl,
          ...(value.payload.expectedVersion === undefined
            ? {}
            : { expectedVersion: value.payload.expectedVersion }),
        },
      },
    };
  }
  if (
    value.type === "github.connection.test" ||
    value.type === "github.profile.remove"
  ) {
    if (
      !hasExactKeys(value.payload, ["serverId"]) ||
      !safeGithubIdentifier(value.payload.serverId)
    )
      return invalidRequest("The GitHub server identifier is invalid.");
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: { serverId: value.payload.serverId },
      } as IpcRequest,
    };
  }
  if (
    value.type === "github.operation.retry" ||
    value.type === "github.operation.cleanup"
  ) {
    if (
      !hasExactKeys(value.payload, ["operationId"]) ||
      !safeGithubIdentifier(value.payload.operationId)
    )
      return invalidRequest("The GitHub operation identifier is invalid.");
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        payload: { operationId: value.payload.operationId },
      } as IpcRequest,
    };
  }
  return invalidRequest("The IPC request type is not allowlisted.");
}

export function parseIpcResponse(value: unknown): value is IpcResponse {
  if (
    !isPlainRecord(value) ||
    !safeRequestId(value.requestId) ||
    value.schemaVersion !== IPC_SCHEMA_VERSION
  )
    return false;
  if (value.ok === true)
    return (
      hasExactKeys(value, ["schemaVersion", "requestId", "ok", "value"]) &&
      parseResponseValue(value.value)
    );
  if (value.ok !== false || !isPlainRecord(value.error)) return false;
  return (
    hasExactKeys(value.error, ["code", "message", "correlationId"]) &&
    [
      "INVALID_REQUEST",
      "UNKNOWN_CHANNEL",
      "UNAUTHORIZED",
      "HANDLER_FAILED",
      "NOT_READY",
      "SHUTDOWN_IN_PROGRESS",
      "HANDOFF_RECOVERY_REQUIRED",
      "SERVICE_START_FAILED",
      "SERVICE_STOP_FAILED",
      "SERVICE_STOP_TIMEOUT",
      "SERVICE_HANDOFF_TIMEOUT",
    ].includes(String(value.error.code)) &&
    safeText(value.error.message, 1_024) &&
    safeRequestId(value.error.correlationId)
  );
}

export function parseIpcOpenTargetEvent(
  value: unknown,
): value is IpcOpenTargetEvent {
  if (
    !isPlainRecord(value) ||
    value.schemaVersion !== IPC_SCHEMA_VERSION ||
    value.type !== "open-target"
  )
    return false;
  return parseOpenTargetRecord(value.target).ok;
}

export function boundedIpcResponse(value: IpcResponse): IpcResponse {
  try {
    if (
      byteLength(JSON.stringify(value)) <= IPC_MAX_RESPONSE_BYTES &&
      parseIpcResponse(value)
    )
      return value;
  } catch {
    // Fall through to the fixed safe error response.
  }
  return {
    schemaVersion: IPC_SCHEMA_VERSION,
    requestId: value.requestId,
    ok: false,
    error: {
      code: "HANDLER_FAILED",
      message: "The response was not safe to deliver across the IPC boundary.",
      correlationId: "ipc-response-invalid",
    },
  };
}

export interface PrMonitorPreloadApi {
  readonly ready: () => Promise<IpcResponse>;
  readonly readCurrentState: () => Promise<IpcResponse>;
  readonly getLifecycleStatus: () => Promise<IpcResponse>;
  readonly requestShutdown: () => Promise<IpcResponse>;
  readonly readGithubSettings: () => Promise<IpcResponse>;
  readonly upsertGithubProfile: (
    input: GithubServerProfileInput,
  ) => Promise<IpcResponse>;
  readonly submitGithubCredential: (
    serverId: string,
    token: string,
  ) => Promise<IpcResponse>;
  readonly testGithubConnection: (serverId: string) => Promise<IpcResponse>;
  readonly retryGithubOperation: (operationId: string) => Promise<IpcResponse>;
  readonly cleanupGithubOperation: (operationId: string) => Promise<IpcResponse>;
  readonly removeGithubProfile: (serverId: string) => Promise<IpcResponse>;
  readonly onOpenTarget: (listener: (target: OpenTarget) => void) => () => void;
}

declare global {
  interface Window {
    readonly prmonitor?: PrMonitorPreloadApi;
  }
}
