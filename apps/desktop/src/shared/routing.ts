import {
  failure,
  isSafeText,
  success,
  type DomainResult,
} from "./domain/result";

export const OPEN_TARGET_SCHEMA_VERSION = 1 as const;
export const OPEN_TARGET_MAX_BYTES = 2_048;
export const OPEN_TARGET_MAX_ID_LENGTH = 128;
/** F04's bounded main-process handoff queue consumed by F19 activation. */
export const OPEN_TARGET_QUEUE_MAX = 256;

export type OpenTargetKind =
  | "HOME"
  | "MANAGED_PR"
  | "MANAGED_PR_SETTINGS"
  | "REVIEW_BUNDLE"
  | "SYNCHRONIZATION_BATCH"
  | "SYNCHRONIZATION_RESULT";

export interface OpenTarget {
  readonly schemaVersion: typeof OPEN_TARGET_SCHEMA_VERSION;
  readonly kind: OpenTargetKind;
  readonly id?: string;
  readonly requestId: string;
}

export interface OpenTargetError {
  readonly code:
    | "INVALID_TARGET"
    | "UNSUPPORTED_TARGET"
    | "TARGET_TOO_LARGE"
    | "SECRET_IN_TARGET"
    | "DUPLICATE_TARGET_FIELDS";
  readonly message: string;
}

const TARGET_KIND_BY_HOST: Readonly<Record<string, OpenTargetKind>> = {
  home: "HOME",
  pr: "MANAGED_PR",
  "managed-pr": "MANAGED_PR",
  "pr-settings": "MANAGED_PR_SETTINGS",
  "review-bundle": "REVIEW_BUNDLE",
  "sync-batch": "SYNCHRONIZATION_BATCH",
  "sync-result": "SYNCHRONIZATION_RESULT",
};

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SECRET_PATTERN =
  /(?:token|secret|password|credential|authorization|cookie|api[_.-]?key|access[_.-]?key|private[_.-]?key)/iu;

function invalid(
  code: OpenTargetError["code"],
  message: string,
): DomainResult<OpenTarget> {
  return failure({
    schemaVersion: 1,
    kind: "domain-error",
    code: "INVALID_INPUT",
    category: "INVALID_INPUT",
    retryable: false,
    userAction: "FIX_INPUT",
    messageKey: `routing.${code.toLowerCase()}`,
    reason: {
      schemaVersion: 1,
      kind: "action-reason",
      code,
      messageKey: `routing.${code.toLowerCase()}`,
      what: message,
      why: "Open targets are view selectors only and must be bounded and provider-neutral.",
      nextAction: "FIX_INPUT",
      details: {},
    },
    details: {},
  });
}

function requestIdFor(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `route-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function validateIdentifier(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= OPEN_TARGET_MAX_ID_LENGTH &&
    IDENTIFIER_PATTERN.test(value) &&
    isSafeText(value)
  );
}

export function parseOpenTarget(raw: unknown): DomainResult<OpenTarget> {
  if (typeof raw !== "string" || !isSafeText(raw)) {
    return invalid("INVALID_TARGET", "The open target must be safe text.");
  }
  if (byteLength(raw) > OPEN_TARGET_MAX_BYTES) {
    return invalid(
      "TARGET_TOO_LARGE",
      "The open target exceeds the bounded limit.",
    );
  }
  if (SECRET_PATTERN.test(raw)) {
    return invalid(
      "SECRET_IN_TARGET",
      "The open target contains a secret-shaped value.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return invalid("INVALID_TARGET", "The open target is not a valid URL.");
  }
  if (parsed.protocol !== "prmonitor:" || parsed.username || parsed.password) {
    return invalid(
      "INVALID_TARGET",
      "Only the prmonitor scheme without credentials is supported.",
    );
  }
  const kind = TARGET_KIND_BY_HOST[parsed.hostname.toLowerCase()];
  if (kind === undefined) {
    return invalid(
      "UNSUPPORTED_TARGET",
      "The open target kind is not supported.",
    );
  }
  if (parsed.search || parsed.hash) {
    return invalid(
      "DUPLICATE_TARGET_FIELDS",
      "Open targets do not accept query or fragment fields.",
    );
  }

  const segments = parsed.pathname
    .split("/")
    .filter((segment) => segment.length > 0);
  if (kind === "HOME") {
    if (segments.length !== 0) {
      return invalid(
        "INVALID_TARGET",
        "The home target cannot carry an identifier.",
      );
    }
  } else if (segments.length !== 1 || !validateIdentifier(segments[0] ?? "")) {
    return invalid(
      "INVALID_TARGET",
      "The target identifier is invalid or path-like.",
    );
  }

  return success({
    schemaVersion: OPEN_TARGET_SCHEMA_VERSION,
    kind,
    ...(kind === "HOME" ? {} : { id: segments[0] }),
    requestId: requestIdFor(raw),
  });
}

export function parseOpenTargetRecord(
  value: unknown,
): DomainResult<OpenTarget> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(
      "INVALID_TARGET",
      "The normalized target must be an object.",
    );
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(["schemaVersion", "kind", "id", "requestId"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    return invalid(
      "INVALID_TARGET",
      "The normalized target contains an unsupported field.",
    );
  }
  if (
    record.schemaVersion !== OPEN_TARGET_SCHEMA_VERSION ||
    typeof record.kind !== "string" ||
    typeof record.requestId !== "string" ||
    !/^route-[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(record.requestId)
  ) {
    return invalid(
      "INVALID_TARGET",
      "The normalized target has invalid version or identity data.",
    );
  }
  const kind = record.kind as OpenTargetKind;
  if (!Object.values(TARGET_KIND_BY_HOST).includes(kind)) {
    return invalid(
      "UNSUPPORTED_TARGET",
      "The normalized target kind is not supported.",
    );
  }
  if (kind === "HOME") {
    if (record.id !== undefined) {
      return invalid(
        "INVALID_TARGET",
        "The home target cannot carry an identifier.",
      );
    }
  } else if (typeof record.id !== "string" || !validateIdentifier(record.id)) {
    return invalid(
      "INVALID_TARGET",
      "The normalized target identifier is invalid.",
    );
  }
  return success(record as unknown as OpenTarget);
}

export type ManagedPrNavigationDestination = "details" | "settings";

export function buildManagedPrTarget(
  managedPrId: string,
  destination: ManagedPrNavigationDestination,
): OpenTarget {
  if (!validateIdentifier(managedPrId))
    throw new Error("INVALID_MANAGED_PR_TARGET_ID");
  const kind: OpenTargetKind =
    destination === "settings" ? "MANAGED_PR_SETTINGS" : "MANAGED_PR";
  const requestId = requestIdFor(`prmonitor://${destination === "settings" ? "pr-settings" : "pr"}/${managedPrId}`);
  return {
    schemaVersion: OPEN_TARGET_SCHEMA_VERSION,
    kind,
    id: managedPrId,
    requestId,
  };
}

export function parseLaunchArguments(
  argv: readonly string[],
): DomainResult<OpenTarget> | undefined {
  for (const argument of argv) {
    if (argument.startsWith("prmonitor:")) return parseOpenTarget(argument);
  }
  return undefined;
}

export class OpenTargetQueue {
  private readonly pending: OpenTarget[] = [];
  private readonly seen = new Set<string>();

  public enqueue(target: OpenTarget): boolean {
    if (this.seen.has(target.requestId)) return false;
    if (this.pending.length >= OPEN_TARGET_QUEUE_MAX) return false;
    this.seen.add(target.requestId);
    this.pending.push(target);
    return true;
  }

  public dequeue(): OpenTarget | undefined {
    return this.pending.shift();
  }

  public requeueFront(target: OpenTarget): void {
    this.pending.unshift(target);
  }

  public get size(): number {
    return this.pending.length;
  }

  public hasSeen(requestId: string): boolean {
    return this.seen.has(requestId);
  }
}
