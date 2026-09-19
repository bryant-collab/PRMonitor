import { createHash } from "node:crypto";
import { z } from "zod";
import {
  assertValidationProfile,
  type CommandStep,
  type ManualStep,
  parseValidationProfile,
  type ProfileIssue,
  type ValidationProfile,
  VALIDATION_SCHEMA_VERSION,
} from "./schema.js";

export type ValidationSource = "one-run" | "saved" | "checked-in";

export const VALIDATION_SOURCES: readonly ValidationSource[] = ["one-run", "saved", "checked-in"];

export const VALIDATION_SECURITY_NOTICE =
  "Repository validation can execute repository-controlled code. PRMonitor limits the working directory, credentials, time, and captured output; the MVP does not claim an operating-system or network sandbox for validation processes.";

export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalValue(value: unknown): CanonicalJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("canonical JSON cannot contain a non-finite number");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalValue(item));
  }
  if (isPlainRecord(value)) {
    const result: { [key: string]: CanonicalJsonValue } = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item === undefined) {
        throw new TypeError(`canonical JSON cannot contain undefined property: ${key}`);
      }
      result[key] = canonicalValue(item);
    }
    return result;
  }
  throw new TypeError(`canonical JSON cannot contain value of type ${typeof value}`);
}

/** RFC-8785-shaped deterministic JSON for the contract's JSON-compatible data. */
export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeValidationProfile(input: unknown): ValidationProfile {
  return assertValidationProfile(input);
}

export function hashValidationProfile(input: unknown): string {
  return sha256Hex(canonicalizeJson(normalizeValidationProfile(input)));
}

export function canonicalProfileJson(input: unknown): string {
  return canonicalizeJson(normalizeValidationProfile(input));
}

export function normalizeSourceType(source: string): ValidationSource | undefined {
  switch (source) {
    case "one-run":
    case "one_run":
    case "oneRun":
      return "one-run";
    case "saved":
      return "saved";
    case "checked-in":
    case "checked_in":
    case "checkedIn":
      return "checked-in";
    default:
      return undefined;
  }
}

export interface ApprovalRecord {
  authorizationType: "approval";
  approvalId: string;
  repositoryId: string;
  source: "saved" | "checked-in";
  schemaVersion: typeof VALIDATION_SCHEMA_VERSION;
  contentHash: string;
  approvedAt: string;
  approvedBy?: string;
}

export interface OneRunAuthorizationRecord {
  authorizationType: "one-run";
  authorizationId: string;
  repositoryId: string;
  source: "one-run";
  operationId: string;
  schemaVersion: typeof VALIDATION_SCHEMA_VERSION;
  contentHash: string;
  authorizedAt: string;
  authorizedBy?: string;
  expiresAt?: string;
}

export type AuthorizationRecord = ApprovalRecord | OneRunAuthorizationRecord;

export const approvalRecordSchema = z
  .object({
    authorizationType: z.literal("approval"),
    approvalId: z.string().min(1).max(256),
    repositoryId: z.string().min(1).max(512),
    source: z.enum(["saved", "checked-in"]),
    schemaVersion: z.literal(VALIDATION_SCHEMA_VERSION),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    approvedAt: z.string().min(1).max(128),
    approvedBy: z.string().min(1).max(256).optional(),
  })
  .strict();

export const oneRunAuthorizationSchema = z
  .object({
    authorizationType: z.literal("one-run"),
    authorizationId: z.string().min(1).max(256),
    repositoryId: z.string().min(1).max(512),
    source: z.literal("one-run"),
    operationId: z.string().min(1).max(256),
    schemaVersion: z.literal(VALIDATION_SCHEMA_VERSION),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    authorizedAt: z.string().min(1).max(128),
    authorizedBy: z.string().min(1).max(256).optional(),
    expiresAt: z.string().min(1).max(128).optional(),
  })
  .strict();

export const authorizationRecordSchema = z.discriminatedUnion("authorizationType", [
  approvalRecordSchema,
  oneRunAuthorizationSchema,
]);

export const authorizationReferenceSchema = z
  .object({
    authorizationType: z.enum(["approval", "one-run"]),
    id: z.string().min(1).max(256),
  })
  .strict();

export interface AuthorizationReference {
  authorizationType: AuthorizationRecord["authorizationType"];
  id: string;
}

export interface ProfileSummaryCommand {
  kind: "command";
  id: string;
  label: string;
  executable: string;
  arguments: string[];
  workingDirectory: string;
  timeoutSeconds: number;
  outputLimitBytes: number;
}

export interface ProfileSummaryManual {
  kind: "manual";
  id: string;
  label: string;
  instructions: string;
}

export type ProfileSummaryStep = ProfileSummaryCommand | ProfileSummaryManual;

export interface ConfirmationSummary {
  source: ValidationSource;
  repositoryId: string;
  schemaVersion: typeof VALIDATION_SCHEMA_VERSION;
  contentHash: string;
  steps: ProfileSummaryStep[];
  securityNotice: string;
}

export interface CreateApprovalInput {
  repositoryId: string;
  source: "saved" | "checked-in";
  profile: unknown;
  approvedAt: string;
  approvedBy?: string;
  approvalId?: string;
}

export interface CreateOneRunAuthorizationInput {
  repositoryId: string;
  operationId: string;
  profile: unknown;
  authorizedAt: string;
  authorizedBy?: string;
  expiresAt?: string;
  authorizationId?: string;
}

function requiredIdentity(value: string, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

function stableRecordId(prefix: string, repositoryId: string, hash: string, operationId?: string): string {
  return `${prefix}-${sha256Hex(`${repositoryId}\n${hash}\n${operationId ?? ""}`).slice(0, 24)}`;
}

export function createApprovalRecord(input: CreateApprovalInput): ApprovalRecord {
  const repositoryId = requiredIdentity(input.repositoryId, "repositoryId");
  const profile = normalizeValidationProfile(input.profile);
  const contentHash = hashValidationProfile(profile);
  const record: ApprovalRecord = {
    authorizationType: "approval",
    approvalId: input.approvalId ?? stableRecordId("approval", repositoryId, contentHash, input.source),
    repositoryId,
    source: input.source,
    schemaVersion: VALIDATION_SCHEMA_VERSION,
    contentHash,
    approvedAt: requiredIdentity(input.approvedAt, "approvedAt"),
    ...(input.approvedBy === undefined ? {} : { approvedBy: requiredIdentity(input.approvedBy, "approvedBy") }),
  };
  const parsed = approvalRecordSchema.safeParse(record);
  if (!parsed.success) {
    throw new TypeError(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  }
  return parsed.data;
}

export function createOneRunAuthorization(input: CreateOneRunAuthorizationInput): OneRunAuthorizationRecord {
  const repositoryId = requiredIdentity(input.repositoryId, "repositoryId");
  const operationId = requiredIdentity(input.operationId, "operationId");
  const profile = normalizeValidationProfile(input.profile);
  const contentHash = hashValidationProfile(profile);
  const record: OneRunAuthorizationRecord = {
    authorizationType: "one-run",
    authorizationId:
      input.authorizationId ?? stableRecordId("one-run", repositoryId, contentHash, operationId),
    repositoryId,
    source: "one-run",
    operationId,
    schemaVersion: VALIDATION_SCHEMA_VERSION,
    contentHash,
    authorizedAt: requiredIdentity(input.authorizedAt, "authorizedAt"),
    ...(input.authorizedBy === undefined
      ? {}
      : { authorizedBy: requiredIdentity(input.authorizedBy, "authorizedBy") }),
    ...(input.expiresAt === undefined ? {} : { expiresAt: requiredIdentity(input.expiresAt, "expiresAt") }),
  };
  const parsed = oneRunAuthorizationSchema.safeParse(record);
  if (!parsed.success) {
    throw new TypeError(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  }
  return parsed.data;
}

export type TrustFailureReason =
  | "MISSING_AUTHORIZATION"
  | "REPOSITORY_MISMATCH"
  | "SOURCE_MISMATCH"
  | "SCHEMA_VERSION_MISMATCH"
  | "CONTENT_HASH_MISMATCH"
  | "OPERATION_MISMATCH"
  | "AUTHORIZATION_EXPIRED"
  | "INVALID_AUTHORIZATION";

export interface TrustEvaluation {
  trusted: boolean;
  reason?: TrustFailureReason;
  authorization?: AuthorizationReference;
}

export interface EvaluateTrustInput {
  repositoryId: string;
  source: ValidationSource;
  profile: unknown;
  operationId?: string;
  authorization?: AuthorizationRecord;
  now?: string;
  operationEnded?: boolean;
}

function isExpired(expiresAt: string | undefined, now: string | undefined): boolean {
  if (expiresAt === undefined || now === undefined) {
    return false;
  }
  const expires = Date.parse(expiresAt);
  const current = Date.parse(now);
  return Number.isFinite(expires) && Number.isFinite(current) && current >= expires;
}

function hasInvalidExpiration(expiresAt: string | undefined): boolean {
  return expiresAt !== undefined && !Number.isFinite(Date.parse(expiresAt));
}

export function evaluateTrust(input: EvaluateTrustInput): TrustEvaluation {
  let expectedHash: string;
  try {
    expectedHash = hashValidationProfile(input.profile);
  } catch {
    return { trusted: false, reason: "INVALID_AUTHORIZATION" };
  }

  if (input.authorization === undefined) {
    return { trusted: false, reason: "MISSING_AUTHORIZATION" };
  }

  const parsedAuthorization = authorizationRecordSchema.safeParse(input.authorization);
  if (!parsedAuthorization.success) {
    return { trusted: false, reason: "INVALID_AUTHORIZATION" };
  }
  const authorization = parsedAuthorization.data;

  if (authorization.repositoryId !== input.repositoryId) {
    return { trusted: false, reason: "REPOSITORY_MISMATCH" };
  }
  if (authorization.source !== input.source) {
    return { trusted: false, reason: "SOURCE_MISMATCH" };
  }
  if (authorization.schemaVersion !== VALIDATION_SCHEMA_VERSION) {
    return { trusted: false, reason: "SCHEMA_VERSION_MISMATCH" };
  }
  if (authorization.contentHash !== expectedHash) {
    return { trusted: false, reason: "CONTENT_HASH_MISMATCH" };
  }

  if (input.source === "one-run") {
    if (authorization.authorizationType !== "one-run") {
      return { trusted: false, reason: "INVALID_AUTHORIZATION" };
    }
    if (authorization.operationId !== input.operationId) {
      return { trusted: false, reason: "OPERATION_MISMATCH" };
    }
    if (input.operationEnded === true) {
      return { trusted: false, reason: "AUTHORIZATION_EXPIRED" };
    }
    if (hasInvalidExpiration(authorization.expiresAt)) {
      return { trusted: false, reason: "INVALID_AUTHORIZATION" };
    }
    if (isExpired(authorization.expiresAt, input.now)) {
      return { trusted: false, reason: "AUTHORIZATION_EXPIRED" };
    }
  } else if (authorization.authorizationType !== "approval") {
    return { trusted: false, reason: "INVALID_AUTHORIZATION" };
  }

  return {
    trusted: true,
    authorization: {
      authorizationType: authorization.authorizationType,
      id: authorization.authorizationType === "approval" ? authorization.approvalId : authorization.authorizationId,
    },
  };
}

export function buildConfirmationSummary(
  profileInput: unknown,
  input: { source: ValidationSource; repositoryId: string },
): ConfirmationSummary {
  const profile = normalizeValidationProfile(profileInput);
  const steps: ProfileSummaryStep[] = profile.steps.map((step): ProfileSummaryStep => {
    if (step.kind === "command") {
      const command: CommandStep = step;
      return {
        kind: "command",
        id: command.id,
        label: command.label,
        executable: command.executable,
        arguments: [...command.arguments],
        workingDirectory: command.workingDirectory,
        timeoutSeconds: command.timeoutSeconds,
        outputLimitBytes: command.outputLimitBytes,
      };
    }
    const manual: ManualStep = step;
    return {
      kind: "manual",
      id: manual.id,
      label: manual.label,
      instructions: manual.instructions,
    };
  });

  return {
    source: input.source,
    repositoryId: requiredIdentity(input.repositoryId, "repositoryId"),
    schemaVersion: VALIDATION_SCHEMA_VERSION,
    contentHash: hashValidationProfile(profile),
    steps,
    securityNotice: VALIDATION_SECURITY_NOTICE,
  };
}

export interface ProfileCandidate {
  profile: unknown;
  approval?: ApprovalRecord;
  authorization?: OneRunAuthorizationRecord;
  /** AI proposals are accepted only as candidate data; trust still requires authorization. */
  isAiProposal?: boolean;
}

export type CandidateInput = ProfileCandidate | unknown;

export interface ResolveValidationInput {
  repositoryId: string;
  operationId?: string;
  operationEnded?: boolean;
  now?: string;
  oneRun?: CandidateInput;
  oneRunOverride?: CandidateInput;
  saved?: CandidateInput;
  savedProfile?: CandidateInput;
  checkedIn?: CandidateInput;
  checkedInProfile?: CandidateInput;
}

export type ValidationResolution =
  | {
      status: "ready";
      source: ValidationSource;
      repositoryId: string;
      operationId?: string;
      profile: ValidationProfile;
      contentHash: string;
      authorization: AuthorizationReference;
      confirmation: ConfirmationSummary;
      isAiProposal: boolean;
    }
  | {
      status: "confirmation_required";
      source: ValidationSource;
      repositoryId: string;
      operationId?: string;
      profile: ValidationProfile;
      contentHash: string;
      confirmation: ConfirmationSummary;
      trustReason: TrustFailureReason;
      isAiProposal: boolean;
      warning: ValidationWarning;
    }
  | {
      status: "invalid";
      source: ValidationSource;
      repositoryId: string;
      operationId?: string;
      code: "INVALID_PROFILE" | "UNSUPPORTED_SCHEMA_VERSION";
      issues: ProfileIssue[];
      isAiProposal: boolean;
      warning: ValidationWarning;
    }
  | {
      status: "unavailable";
      source: undefined;
      repositoryId: string;
      operationId?: string;
      reason: "NO_PROFILE";
      warning: ValidationWarning;
    };

export interface ValidationWarning {
  code: "NO_PROFILE" | "CONFIRMATION_REQUIRED" | "INVALID_PROFILE" | "VALIDATION_REVIEW_REQUIRED";
  title: string;
  message: string;
  remediation: string;
}

export function validationWarning(
  code: ValidationWarning["code"],
  details: { status?: string; reason?: string } = {},
): ValidationWarning {
  switch (code) {
    case "NO_PROFILE":
      return {
        code,
        title: "Validation not run",
        message: "No safe validation profile is configured for this repository.",
        remediation: "Configure a saved profile or provide an approved checked-in profile before running validation.",
      };
    case "CONFIRMATION_REQUIRED":
      return {
        code,
        title: "Validation confirmation required",
        message: "The selected profile has not been explicitly authorized for this repository and operation.",
        remediation: "Review the exact commands, limits, directories, and manual checks, then confirm the profile or choose Run once.",
      };
    case "INVALID_PROFILE":
      return {
        code,
        title: "Validation profile is invalid",
        message: "The selected validation profile cannot be used because one or more fields are invalid.",
        remediation: "Correct the reported profile fields and load the profile again.",
      };
    case "VALIDATION_REVIEW_REQUIRED":
      return {
        code,
        title: "Review validation before publication",
        message: `Validation completed with status ${details.status ?? "not passing"}${
          details.reason === undefined ? "" : ` (${details.reason})`
        } and does not grant publication authority.`,
        remediation: "Inspect the recorded validation evidence and make the separate explicit publication decision.",
      };
  }
}

function candidateEnvelope(input: CandidateInput | undefined): ProfileCandidate | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (isPlainRecord(input) && Object.prototype.hasOwnProperty.call(input, "profile")) {
    return input as unknown as ProfileCandidate;
  }
  return { profile: input };
}

export function resolveValidationProfile(input: ResolveValidationInput): ValidationResolution {
  const repositoryId = requiredIdentity(input.repositoryId, "repositoryId");
  const selected = [
    {
      source: "one-run" as const,
      candidate: candidateEnvelope(input.oneRunOverride !== undefined ? input.oneRunOverride : input.oneRun),
    },
    {
      source: "saved" as const,
      candidate: candidateEnvelope(input.savedProfile !== undefined ? input.savedProfile : input.saved),
    },
    {
      source: "checked-in" as const,
      candidate: candidateEnvelope(input.checkedInProfile !== undefined ? input.checkedInProfile : input.checkedIn),
    },
  ].find(({ candidate }) => candidate !== undefined);

  if (selected === undefined) {
    return {
      status: "unavailable",
      source: undefined,
      repositoryId,
      ...(input.operationId === undefined ? {} : { operationId: input.operationId }),
      reason: "NO_PROFILE",
      warning: validationWarning("NO_PROFILE"),
    };
  }

  const isAiProposal = selected.candidate?.isAiProposal === true;
  const parsed = parseValidationProfile(selected.candidate?.profile);
  if (!parsed.ok) {
    return {
      status: "invalid",
      source: selected.source,
      repositoryId,
      ...(input.operationId === undefined ? {} : { operationId: input.operationId }),
      code: parsed.code,
      issues: parsed.issues,
      isAiProposal,
      warning: validationWarning("INVALID_PROFILE"),
    };
  }

  const profile = parsed.profile;
  const contentHash = hashValidationProfile(profile);
  const authorization = selected.candidate?.authorization ?? selected.candidate?.approval;
  const trust = evaluateTrust({
    repositoryId,
    source: selected.source,
    profile,
    operationId: input.operationId,
    authorization,
    now: input.now,
    operationEnded: input.operationEnded,
  });
  const confirmation = buildConfirmationSummary(profile, { source: selected.source, repositoryId });

  if (!trust.trusted || trust.authorization === undefined) {
    return {
      status: "confirmation_required",
      source: selected.source,
      repositoryId,
      ...(input.operationId === undefined ? {} : { operationId: input.operationId }),
      profile,
      contentHash,
      confirmation,
      trustReason: trust.reason ?? "MISSING_AUTHORIZATION",
      isAiProposal,
      warning: validationWarning("CONFIRMATION_REQUIRED"),
    };
  }

  return {
    status: "ready",
    source: selected.source,
    repositoryId,
    ...(input.operationId === undefined ? {} : { operationId: input.operationId }),
    profile,
    contentHash,
    authorization: trust.authorization,
    confirmation,
    isAiProposal,
  };
}
