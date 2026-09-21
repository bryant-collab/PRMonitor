import { randomUUID } from "node:crypto";
import {
  normalizeGithubServerUrl,
  type GithubServerIdentity,
} from "../shared/github-server";
import {
  MAX_GITHUB_BODY_BYTES,
  MAX_GITHUB_BRANCH_BYTES,
  MAX_GITHUB_PAGE_COUNT,
  MAX_GITHUB_PAGE_SIZE,
  MAX_GITHUB_PR_URL_BYTES,
  MAX_GITHUB_RESPONSE_BYTES,
  createBranchRefIdentity,
  createFeedbackResourceScope,
  createPullRequestIdentity,
  createRepositoryIdentity,
  createResponseTarget,
  remoteServerIdentity,
  type GithubAnyRepositoryIdentity,
  type GithubUnavailableRepositoryIdentity,
  type GithubApprovedPublicationContext,
  type GithubBranchRef,
  type GithubBranchRefIdentity,
  type GithubConditionalMetadata,
  type GithubCurrentStateExpectation,
  type GithubCurrentStateVerification,
  type GithubFeedbackAuthor,
  type GithubFeedbackCollection,
  type GithubFeedbackLocation,
  type GithubFeedbackPage,
  type GithubFeedbackRecord,
  type GithubFeedbackResourceScope,
  type GithubFeedbackSource,
  type GithubParsedPullRequestUrl,
  type GithubPostedResponse,
  type GithubPullRequestIdentity,
  type GithubPullRequestMetadata,
  type GithubPullRequestStateSnapshot,
  type GithubRemoteServerIdentity,
  type GithubRepositoryIdentity,
  type GithubRepositoryMetadata,
  type GithubResponsePost,
  type GithubResponseTarget,
  type GithubRestFailure,
  type GithubRestNextAction,
  type GithubRestReason,
  type GithubRestReasonCategory,
  type GithubRestReasonCode,
  type GithubRestResource,
  type GithubRestResult,
  type GithubRequestMetadata,
} from "../shared/github-rest";
import {
  GithubCredentialBrokerError,
  type GithubCredentialBroker,
  type GithubRequestCapability,
} from "./github-credential-broker";
import type { GithubServerProfileRecord } from "./persistence/repositories";

export const DEFAULT_GITHUB_REST_TIMEOUT_MS = 30_000;
export const DEFAULT_GITHUB_REST_PAGE_SIZE = 100;

export type GithubRestHttpMethod = "GET" | "POST";

export interface GithubRestHttpRequest {
  readonly method: GithubRestHttpMethod;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal: AbortSignal;
}

export interface GithubRestHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly url: string;
}

export interface GithubRestTransport {
  request(request: GithubRestHttpRequest): Promise<GithubRestHttpResponse>;
}

export class GithubRestTransportError extends Error {
  public constructor(
    public readonly code: "RESPONSE_TOO_LARGE" | "REQUEST_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "GithubRestTransportError";
  }
}

function normalizedHeaders(
  headers: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
}

async function readBoundedBody(response: Response): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    Number.isSafeInteger(Number(contentLength)) &&
    Number(contentLength) > MAX_GITHUB_RESPONSE_BYTES
  )
    throw new GithubRestTransportError(
      "RESPONSE_TOO_LARGE",
      "The GitHub response exceeded the bounded response limit.",
    );
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_GITHUB_RESPONSE_BYTES) {
        await reader.cancel();
        throw new GithubRestTransportError(
          "RESPONSE_TOO_LARGE",
          "The GitHub response exceeded the bounded response limit.",
        );
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

/** Production transport. Redirects are deliberately returned, never followed. */
export class FetchGithubRestTransport implements GithubRestTransport {
  public async request(
    request: GithubRestHttpRequest,
  ): Promise<GithubRestHttpResponse> {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body }),
      redirect: "manual",
      signal: request.signal,
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return {
      status: response.status,
      headers,
      body: await readBoundedBody(response),
      url: response.url,
    };
  }
}

export interface GithubUrlParseFailure {
  readonly ok: false;
  readonly code:
    | "INVALID_URL"
    | "UNSUPPORTED_SERVER"
    | "AMBIGUOUS_URL"
    | "INVALID_REPOSITORY"
    | "INVALID_NUMBER";
  readonly message: string;
}

export type GithubUrlParseResult =
  | {
      readonly ok: true;
      readonly value: GithubParsedPullRequestUrl;
    }
  | GithubUrlParseFailure;

type ServerInput = GithubServerIdentity | GithubServerProfileRecord;

function identityFromServerInput(input: ServerInput):
  | {
      readonly identity: GithubRemoteServerIdentity;
      readonly serverId?: string;
    }
  | undefined {
  const normalized = normalizeGithubServerUrl(input.webOrigin);
  if (!normalized.ok) return undefined;
  const serverId = "serverId" in input ? input.serverId : undefined;
  return {
    identity: remoteServerIdentity(normalized.value),
    ...(serverId === undefined ? {} : { serverId }),
  };
}

function safeUrlBytes(value: string): boolean {
  return new TextEncoder().encode(value).byteLength <= MAX_GITHUB_PR_URL_BYTES;
}

function rawPathHasAmbiguity(pathname: string): boolean {
  return (
    pathname.includes("//") ||
    /%(?:2f|2F|5c|5C|2e|2E)/u.test(pathname) ||
    pathname.split("/").some((part) => part === "." || part === "..") ||
    pathname.includes("\\")
  );
}

export function parseGithubPullRequestUrl(
  value: string,
  serverInput: ServerInput,
): GithubUrlParseResult {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !safeUrlBytes(value) ||
    /[?#]/u.test(value)
  )
    return {
      ok: false,
      code: "AMBIGUOUS_URL",
      message: "Use a supported pull-request URL without a query or fragment.",
    };
  const server = identityFromServerInput(serverInput);
  if (server === undefined)
    return {
      ok: false,
      code: "UNSUPPORTED_SERVER",
      message: "The configured GitHub server identity is not safe to use.",
    };
  const schemeSeparator = value.indexOf("://");
  const rawPathStart =
    schemeSeparator < 0 ? -1 : value.indexOf("/", schemeSeparator + 3);
  if (rawPathStart < 0 || rawPathHasAmbiguity(value.slice(rawPathStart)))
    return {
      ok: false,
      code: "AMBIGUOUS_URL",
      message:
        "Use an unambiguous pull-request path without encoded separators or traversal.",
    };
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return {
      ok: false,
      code: "INVALID_URL",
      message: "Enter a valid HTTPS GitHub pull-request URL.",
    };
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.origin.toLowerCase() !== server.identity.webOrigin.toLowerCase() ||
    rawPathHasAmbiguity(parsed.pathname)
  )
    return {
      ok: false,
      code: "AMBIGUOUS_URL",
      message:
        "Use only the configured HTTPS server origin and an unambiguous path.",
    };
  const parts = parsed.pathname.replace(/\/$/u, "").split("/");
  if (parts.length !== 5 || parts[0] !== "" || parts[4] === undefined) {
    return {
      ok: false,
      code: "INVALID_URL",
      message: "Use the form /owner/repository/pull/number.",
    };
  }
  const owner = parts[1];
  const repositoryName = parts[2];
  if (
    owner === undefined ||
    repositoryName === undefined ||
    parts[3] !== "pull" ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(owner) ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(repositoryName)
  )
    return {
      ok: false,
      code: "INVALID_REPOSITORY",
      message: "The pull-request repository path is not valid.",
    };
  const numberText = parts[4];
  if (numberText === undefined || !/^[1-9][0-9]{0,9}$/u.test(numberText))
    return {
      ok: false,
      code: "INVALID_NUMBER",
      message: "The pull-request number must be a positive bounded integer.",
    };
  const number = Number(numberText);
  if (!Number.isSafeInteger(number) || number < 1)
    return {
      ok: false,
      code: "INVALID_NUMBER",
      message: "The pull-request number must be a positive bounded integer.",
    };
  const repositoryKey = `${server.identity.serverKey}:repo:${owner.toLowerCase()}/${repositoryName.toLowerCase()}`;
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      server: server.identity,
      ...(server.serverId === undefined ? {} : { serverId: server.serverId }),
      owner,
      repositoryName,
      repositoryKey,
      number,
      pullRequestKey: `${repositoryKey}#${number}`,
      normalizedUrl: `${server.identity.webOrigin}/${encodeURIComponent(owner)}/${encodeURIComponent(repositoryName)}/pull/${number}`,
    },
  };
}

interface ReadSpec {
  readonly resource: GithubRestResource;
  readonly path: string;
  readonly scopeKey: string;
  readonly conditional?: GithubConditionalMetadata;
  readonly page?: number;
  readonly perPage?: number;
  readonly body?: undefined;
  readonly method: "GET";
}

interface MutationSpec {
  readonly resource: "response";
  readonly path: string;
  readonly scopeKey: string;
  readonly body: string;
  readonly method: "POST";
}

export interface GithubRestClientOptions {
  readonly broker: GithubCredentialBroker;
  readonly transport: GithubRestTransport;
  readonly profile?: GithubServerProfileRecord;
  readonly profileForServerId?: (
    serverId: string,
  ) => GithubServerProfileRecord | undefined;
  readonly profileForServer?: (
    server: GithubRemoteServerIdentity,
  ) => GithubServerProfileRecord | undefined;
  readonly clock?: { now(): string };
  readonly timeoutMs?: number;
  readonly maxPages?: number;
}

export interface GithubRestReadOptions {
  readonly profile?: GithubServerProfileRecord;
  readonly serverId?: string;
  readonly conditional?: GithubConditionalMetadata;
  readonly correlationId?: string;
  readonly signal?: AbortSignal;
}

export interface GithubFeedbackPageOptions extends GithubRestReadOptions {
  readonly conditional?: GithubConditionalMetadata;
  readonly page?: number;
  readonly perPage?: number;
  readonly maxPages?: number;
}

export type GithubFeedbackCollectionOptions = GithubFeedbackPageOptions;

function correlationId(input?: string): string {
  if (input !== undefined && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(input))
    return input;
  return `github-rest-${randomUUID()}`;
}

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function boundedString(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    bytes(value) <= maximum
    ? value
    : undefined;
}

function positiveId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0)
    return String(value);
  if (typeof value === "string" && /^[1-9][0-9]{0,19}$/u.test(value))
    return value;
  return undefined;
}

function sha(value: unknown): string | undefined {
  return boundedString(value, 128);
}

function failure(
  code: GithubRestReasonCode,
  category: GithubRestReasonCategory,
  message: string,
  nextAction: GithubRestNextAction,
  retryable: boolean,
  correlation: string,
  metadata: Omit<GithubRequestMetadata, "status"> & {
    readonly status?: number;
  },
  extra: Partial<
    Pick<GithubRestReason, "retryAfterMs" | "rateLimitResetAt">
  > = {},
  outcome: GithubRestFailure["outcome"] = "FAILED",
): GithubRestFailure {
  return {
    ok: false,
    outcome,
    reason: {
      code,
      category,
      retryable,
      message,
      nextAction,
      correlationId: correlation,
      ...extra,
    },
    metadata,
  };
}

function baseMetadata(
  resource: GithubRestResource,
  scopeKey: string,
  correlation: string,
  status?: number,
): Omit<GithubRequestMetadata, "status"> & { readonly status?: number } {
  return {
    schemaVersion: 1,
    correlationId: correlation,
    resource,
    scopeKey,
    ...(status === undefined ? {} : { status }),
  };
}

function readStatus(
  response: GithubRestHttpResponse,
): GithubRestReasonCategory | undefined {
  if (response.status === 400 || response.status === 422) return "VALIDATION";
  if (response.status === 408) return "TIMEOUT";
  if (response.status === 401) return "AUTHENTICATION";
  if (response.status === 403) return "AUTHORIZATION";
  if (response.status === 404) return "NOT_FOUND";
  if (response.status === 409) return "CONFLICT";
  if (response.status === 429) return "RATE_LIMIT";
  if (response.status >= 500) return "NETWORK";
  if (response.status >= 300) return "REDIRECT";
  return undefined;
}

function retryAfter(headers: Readonly<Record<string, string>>): {
  readonly retryAfterMs?: number;
  readonly rateLimitResetAt?: string;
} {
  const normalized = normalizedHeaders(headers);
  const retryAfterValue = normalized["retry-after"];
  const retryAfterSeconds =
    retryAfterValue === undefined ? NaN : Number(retryAfterValue);
  const retryAfterMs =
    Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
      ? Math.min(Math.floor(retryAfterSeconds * 1_000), 86_400_000)
      : undefined;
  const reset = Number(normalized["x-ratelimit-reset"] ?? NaN);
  const rateLimitResetAt =
    Number.isSafeInteger(reset) && reset > 0
      ? new Date(reset * 1_000).toISOString()
      : undefined;
  return {
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    ...(rateLimitResetAt === undefined ? {} : { rateLimitResetAt }),
  };
}

function contentTypeIsJson(headers: Readonly<Record<string, string>>): boolean {
  const contentType = normalizedHeaders(headers)["content-type"];
  return (
    contentType !== undefined &&
    /(?:application|text)\/(?:[^;]*\+)?json/iu.test(contentType)
  );
}

function sameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

function responseConditional(
  response: GithubRestHttpResponse,
): GithubConditionalMetadata | undefined {
  const headers = normalizedHeaders(response.headers);
  const etag = boundedString(headers.etag, 512);
  const lastModified = boundedString(headers["last-modified"], 128);
  if (etag === undefined && lastModified === undefined) return undefined;
  return {
    ...(etag === undefined ? {} : { etag }),
    ...(lastModified === undefined ? {} : { lastModified }),
  };
}

function validProfileIdentity(
  profile: GithubServerProfileRecord,
): GithubRemoteServerIdentity | undefined {
  const normalized = normalizeGithubServerUrl(profile.webOrigin);
  if (!normalized.ok || normalized.value.apiBaseUrl !== profile.apiBaseUrl)
    return undefined;
  if (
    profile.kind !== normalized.value.kind ||
    profile.host !== normalized.value.host
  )
    return undefined;
  return remoteServerIdentity(normalized.value);
}

function serverMatches(
  identity: GithubRemoteServerIdentity,
  profileIdentity: GithubRemoteServerIdentity,
): boolean {
  return identity.serverKey === profileIdentity.serverKey;
}

function encodePathPart(value: string): string {
  return encodeURIComponent(value);
}

function buildEndpoint(
  profile: GithubServerProfileRecord,
  path: string,
  query?: URLSearchParams,
): string | undefined {
  const identity = validProfileIdentity(profile);
  if (identity === undefined || !path.startsWith("/") || path.includes("//"))
    return undefined;
  try {
    const base = profile.apiBaseUrl.replace(/\/+$/u, "");
    const endpoint = new URL(`${base}${path}`);
    if (
      endpoint.protocol !== "https:" ||
      endpoint.origin !== new URL(base).origin
    )
      return undefined;
    if (query !== undefined) endpoint.search = query.toString();
    return endpoint.toString();
  } catch {
    return undefined;
  }
}

function pathForRepository(repository: GithubRepositoryIdentity): string {
  return `/repos/${encodePathPart(repository.owner)}/${encodePathPart(repository.name)}`;
}

function pathForPullRequest(pullRequest: GithubPullRequestIdentity): string {
  return `${pathForRepository(pullRequest.repository)}/pulls/${pullRequest.number}`;
}

function validPage(value: number): boolean {
  return (
    Number.isSafeInteger(value) && value >= 1 && value <= MAX_GITHUB_PAGE_COUNT
  );
}

function pageQuery(page: number, perPage: number): URLSearchParams {
  const query = new URLSearchParams();
  query.set("page", String(page));
  query.set("per_page", String(perPage));
  return query;
}

class GithubRestDecodeError extends Error {
  public constructor(
    public readonly decodeCode:
      | "MALFORMED_RESPONSE"
      | "PAGINATION_INCOMPLETE"
      | "PAGINATION_LIMIT_EXCEEDED",
  ) {
    super(decodeCode);
    this.name = "GithubRestDecodeError";
  }
}

function recordObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function repositoryFromPayload(
  value: unknown,
  server: GithubRemoteServerIdentity,
  unavailableReason: GithubUnavailableRepositoryIdentity["reason"] = "MISSING_FROM_PAYLOAD",
): GithubAnyRepositoryIdentity {
  const record = recordObject(value);
  if (record === undefined) {
    return {
      schemaVersion: 1,
      server,
      key: `${server.serverKey}:unavailable:${unavailableReason}`,
      available: false,
      reason: unavailableReason,
    };
  }
  const ownerRecord = recordObject(record.owner);
  const owner = boundedString(ownerRecord?.login ?? record.owner, 100);
  const name = boundedString(record.name, 100);
  const providerId =
    typeof record.id === "number" &&
    Number.isSafeInteger(record.id) &&
    record.id > 0
      ? record.id
      : undefined;
  if (owner === undefined || name === undefined) {
    return {
      schemaVersion: 1,
      server,
      ...(providerId === undefined ? {} : { providerId }),
      ...(owner === undefined ? {} : { owner }),
      ...(name === undefined ? {} : { name }),
      key: `${server.serverKey}:unavailable:${owner ?? "?"}/${name ?? "?"}`,
      available: false,
      reason: unavailableReason,
    };
  }
  try {
    return createRepositoryIdentity({
      server,
      owner,
      name,
      ...(providerId === undefined ? {} : { providerId }),
    });
  } catch {
    return {
      schemaVersion: 1,
      server,
      ...(providerId === undefined ? {} : { providerId }),
      owner,
      name,
      key: `${server.serverKey}:unavailable:${owner}/${name}`,
      available: false,
      reason: unavailableReason,
    };
  }
}

function authorFromPayload(value: unknown): GithubFeedbackAuthor {
  const record = recordObject(value);
  const id =
    typeof record?.id === "number" &&
    Number.isSafeInteger(record.id) &&
    record.id > 0
      ? record.id
      : undefined;
  const login = boundedString(record?.login, 256);
  const name = boundedString(record?.name, 256);
  return {
    ...(id === undefined ? {} : { id }),
    ...(login === undefined ? {} : { login }),
    ...(name === undefined ? {} : { name }),
  };
}

function locationFromPayload(
  value: Record<string, unknown>,
): GithubFeedbackLocation | undefined {
  const path = boundedString(value.path, 1_024);
  const diffHunk = boundedString(value.diff_hunk, 16_384);
  const line =
    typeof value.line === "number" &&
    Number.isSafeInteger(value.line) &&
    value.line > 0
      ? value.line
      : undefined;
  const startLine =
    typeof value.start_line === "number" &&
    Number.isSafeInteger(value.start_line) &&
    value.start_line > 0
      ? value.start_line
      : undefined;
  const position =
    typeof value.position === "number" &&
    Number.isSafeInteger(value.position) &&
    value.position > 0
      ? value.position
      : undefined;
  const side =
    value.side === "LEFT" || value.side === "RIGHT" ? value.side : undefined;
  const startSide =
    value.start_side === "LEFT" || value.start_side === "RIGHT"
      ? value.start_side
      : undefined;
  if (
    path === undefined &&
    diffHunk === undefined &&
    line === undefined &&
    startLine === undefined &&
    position === undefined &&
    side === undefined &&
    startSide === undefined
  )
    return undefined;
  return {
    ...(path === undefined ? {} : { path }),
    ...(line === undefined ? {} : { line }),
    ...(startLine === undefined ? {} : { startLine }),
    ...(position === undefined ? {} : { position }),
    ...(side === undefined ? {} : { side }),
    ...(startSide === undefined ? {} : { startSide }),
    ...(diffHunk === undefined ? {} : { diffHunk }),
  };
}

function nextPageFromResponse(
  response: GithubRestHttpResponse,
  payload: unknown,
  currentPage: number,
  maxPages: number,
): number | undefined {
  const headers = normalizedHeaders(response.headers);
  const link = headers.link;
  let candidate: number | undefined;
  if (link !== undefined) {
    for (const relation of link.split(",")) {
      const match = relation.match(/<([^>]+)>\s*;\s*rel=["']next["']/iu);
      if (match?.[1] === undefined) continue;
      let next: URL;
      try {
        next = new URL(match[1]);
      } catch {
        throw new GithubRestDecodeError("PAGINATION_INCOMPLETE");
      }
      if (
        !sameOrigin(next.toString(), response.url) ||
        next.pathname !== new URL(response.url).pathname
      )
        throw new GithubRestDecodeError("PAGINATION_INCOMPLETE");
      const pageText = next.searchParams.get("page");
      if (pageText === null || !/^[1-9][0-9]*$/u.test(pageText))
        throw new GithubRestDecodeError("PAGINATION_INCOMPLETE");
      candidate = Number(pageText);
      break;
    }
  }
  const headerNext = headers["x-next-page"];
  if (
    candidate === undefined &&
    headerNext !== undefined &&
    headerNext !== ""
  ) {
    if (!/^[1-9][0-9]*$/u.test(headerNext))
      throw new GithubRestDecodeError("PAGINATION_INCOMPLETE");
    candidate = Number(headerNext);
  }
  if (candidate === undefined) {
    const payloadRecord = recordObject(payload);
    const bodyNext = payloadRecord?.next_page ?? payloadRecord?.nextPage;
    if (bodyNext !== undefined && bodyNext !== null && bodyNext !== "") {
      if (
        (typeof bodyNext !== "number" &&
          (typeof bodyNext !== "string" || !/^[1-9][0-9]*$/u.test(bodyNext))) ||
        (typeof bodyNext === "number" && !Number.isSafeInteger(bodyNext))
      )
        throw new GithubRestDecodeError("PAGINATION_INCOMPLETE");
      candidate = Number(bodyNext);
    }
  }
  if (candidate !== undefined) {
    if (!Number.isSafeInteger(candidate) || candidate <= currentPage)
      throw new GithubRestDecodeError("PAGINATION_INCOMPLETE");
    if (candidate > maxPages)
      throw new GithubRestDecodeError("PAGINATION_LIMIT_EXCEEDED");
  }
  return candidate;
}

function arrayPayload(value: unknown): readonly unknown[] | undefined {
  if (Array.isArray(value)) return value;
  const record = recordObject(value);
  if (record === undefined) return undefined;
  if (Array.isArray(record.items)) return record.items;
  if (Array.isArray(record.data)) return record.data;
  return undefined;
}

function safeOptionalIso(value: unknown): string | undefined {
  const text = boundedString(value, 64);
  if (text === undefined) return undefined;
  return Number.isNaN(Date.parse(text)) ? undefined : text;
}

function feedbackFromPayload(
  value: unknown,
  source: GithubFeedbackSource,
  scope: GithubFeedbackResourceScope,
): GithubFeedbackRecord {
  const record = recordObject(value);
  const remoteId = positiveId(record?.id);
  if (record === undefined || remoteId === undefined)
    throw new GithubRestDecodeError("MALFORMED_RESPONSE");
  const body = boundedString(record.body, MAX_GITHUB_BODY_BYTES);
  const state = boundedString(record.state, 128);
  const createdAt = safeOptionalIso(record.created_at);
  const updatedAt = safeOptionalIso(record.updated_at ?? record.submitted_at);
  const location = locationFromPayload(record);
  const repository = scope.pullRequest.repository;
  const identity = {
    schemaVersion: 1 as const,
    source,
    resource: scope,
    remoteId,
    key: `${scope.key}:object:${remoteId}`,
  };
  const semanticInput: Readonly<Record<string, unknown>> = {
    source,
    remoteId,
    repositoryKey: repository.key,
    pullRequestKey: scope.pullRequest.key,
    author: authorFromPayload(record.user ?? record.author),
    ...(body === undefined ? {} : { body }),
    ...(state === undefined ? {} : { state }),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(location === undefined ? {} : { location }),
  };
  return {
    schemaVersion: 1,
    identity,
    source,
    pullRequest: scope.pullRequest,
    repository,
    author: authorFromPayload(record.user ?? record.author),
    ...(body === undefined ? {} : { body }),
    ...(state === undefined ? {} : { state }),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(location === undefined ? {} : { location }),
    semanticInput,
  };
}

function feedbackSource(
  resource: Exclude<GithubRestResource, "repository" | "branch_ref">,
): GithubFeedbackSource {
  if (resource === "review_comments") return "REVIEW_COMMENT";
  if (resource === "reviews") return "REVIEW";
  return "ISSUE_COMMENT";
}

function mutationPublicationValid(
  publication: GithubApprovedPublicationContext,
): boolean {
  return (
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(publication.approvalId) &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(publication.ownerId) &&
    bytes(publication.reviewedSnapshotHash) <= 256 &&
    publication.reviewedSnapshotHash.length > 0 &&
    !Number.isNaN(Date.parse(publication.approvedAt))
  );
}

function noStatusMetadata(
  resource: GithubRestResource,
  scopeKey: string,
  correlation: string,
): Omit<GithubRequestMetadata, "status"> & { readonly status?: number } {
  return baseMetadata(resource, scopeKey, correlation);
}

export interface GithubReadClient {
  getPullRequest(
    input: GithubRestReadOptions & {
      readonly identity: GithubPullRequestIdentity;
    },
  ): Promise<GithubRestResult<GithubPullRequestMetadata>>;
  getRepository(
    input: GithubRestReadOptions & {
      readonly repository: GithubRepositoryIdentity;
    },
  ): Promise<GithubRestResult<GithubRepositoryMetadata>>;
  getBranchRef(
    input: GithubRestReadOptions & { readonly ref: GithubBranchRefIdentity },
  ): Promise<GithubRestResult<GithubBranchRef>>;
  getPullRequestState(
    input: GithubRestReadOptions & {
      readonly identity: GithubPullRequestIdentity;
    },
  ): Promise<GithubRestResult<GithubPullRequestStateSnapshot>>;
  verifyPullRequestState(
    input: GithubRestReadOptions & {
      readonly identity: GithubPullRequestIdentity;
      readonly expectation: GithubCurrentStateExpectation;
    },
  ): Promise<GithubRestResult<GithubCurrentStateVerification>>;
  getFeedbackPage(
    input: GithubFeedbackPageOptions & {
      readonly scope: GithubFeedbackResourceScope;
    },
  ): Promise<GithubRestResult<GithubFeedbackPage>>;
  getFeedbackCollection(
    input: GithubFeedbackCollectionOptions & {
      readonly scope: GithubFeedbackResourceScope;
    },
  ): Promise<GithubRestResult<GithubFeedbackCollection>>;
}

export interface GithubResponseClient {
  postIssueComment(
    input: GithubResponsePost,
  ): Promise<GithubRestResult<GithubPostedResponse>>;
  postReviewCommentReply(
    input: GithubResponsePost,
  ): Promise<GithubRestResult<GithubPostedResponse>>;
}

type ApprovedResponseExecutor = (
  input: GithubRestReadOptions,
  spec: MutationSpec,
  target: GithubResponseTarget,
  publication: GithubApprovedPublicationContext,
) => Promise<GithubRestResult<GithubPostedResponse>>;

export class GithubRestClient implements GithubReadClient {
  public readonly responses: GithubResponseClient;
  private readonly defaultProfile: GithubServerProfileRecord | undefined;

  public constructor(private readonly options: GithubRestClientOptions) {
    this.defaultProfile = options.profile;
    this.responses = new GithubResponseClientImpl(
      (input, spec, target, publication) =>
        this.executeApprovedResponse(input, spec, target, publication),
    );
  }

  public getPullRequest(
    input: GithubRestReadOptions & {
      readonly identity: GithubPullRequestIdentity;
    },
  ): Promise<GithubRestResult<GithubPullRequestMetadata>> {
    const { identity } = input;
    const spec: ReadSpec = {
      method: "GET",
      resource: "pull_request",
      path: `${pathForPullRequest(identity)}`,
      scopeKey: identity.key,
      ...(input.conditional === undefined
        ? {}
        : { conditional: input.conditional }),
    };
    return this.executeRead(input, spec, identity.server, (value) =>
      this.decodePullRequest(value, identity),
    );
  }

  public getRepository(
    input: GithubRestReadOptions & {
      readonly repository: GithubRepositoryIdentity;
    },
  ): Promise<GithubRestResult<GithubRepositoryMetadata>> {
    const { repository } = input;
    const spec: ReadSpec = {
      method: "GET",
      resource: "repository",
      path: pathForRepository(repository),
      scopeKey: repository.key,
      ...(input.conditional === undefined
        ? {}
        : { conditional: input.conditional }),
    };
    return this.executeRead(input, spec, repository.server, (value) =>
      this.decodeRepository(value, repository.server),
    );
  }

  public getBranchRef(
    input: GithubRestReadOptions & { readonly ref: GithubBranchRefIdentity },
  ): Promise<GithubRestResult<GithubBranchRef>> {
    const { ref } = input;
    const spec: ReadSpec = {
      method: "GET",
      resource: "branch_ref",
      path: `${pathForRepository(ref.repository)}/git/ref/heads/${encodePathPart(ref.name)}`,
      scopeKey: ref.key,
      ...(input.conditional === undefined
        ? {}
        : { conditional: input.conditional }),
    };
    return this.executeRead(input, spec, ref.server, (value) => {
      const record = recordObject(value);
      const object = recordObject(record?.object);
      const refSha = sha(object?.sha);
      if (refSha === undefined)
        throw new GithubRestDecodeError("MALFORMED_RESPONSE");
      return { identity: ref, sha: refSha };
    });
  }

  public async getPullRequestState(
    input: GithubRestReadOptions & {
      readonly identity: GithubPullRequestIdentity;
    },
  ): Promise<GithubRestResult<GithubPullRequestStateSnapshot>> {
    const result = await this.getPullRequest(input);
    if (!result.ok || result.outcome === "NOT_MODIFIED") return result;
    return {
      ...result,
      value: {
        identity: result.value.identity,
        state: result.value.state,
        merged: result.value.merged,
        headSha: result.value.headSha,
        baseSha: result.value.baseSha,
      },
    };
  }

  public async verifyPullRequestState(
    input: GithubRestReadOptions & {
      readonly identity: GithubPullRequestIdentity;
      readonly expectation: GithubCurrentStateExpectation;
    },
  ): Promise<GithubRestResult<GithubCurrentStateVerification>> {
    const result = await this.getPullRequestState(input);
    if (!result.ok || result.outcome === "NOT_MODIFIED") return result;
    const mismatchFields: Array<
      GithubCurrentStateVerification["mismatchFields"][number]
    > = [];
    if (
      input.expectation.expectedState !== undefined &&
      input.expectation.expectedState !== result.value.state
    )
      mismatchFields.push("state");
    if (
      input.expectation.expectedMerged !== undefined &&
      input.expectation.expectedMerged !== result.value.merged
    )
      mismatchFields.push("merged");
    if (
      input.expectation.expectedHeadSha !== undefined &&
      input.expectation.expectedHeadSha !== result.value.headSha
    )
      mismatchFields.push("headSha");
    if (
      input.expectation.expectedBaseSha !== undefined &&
      input.expectation.expectedBaseSha !== result.value.baseSha
    )
      mismatchFields.push("baseSha");
    return {
      ...result,
      value: {
        current: result.value,
        matches: mismatchFields.length === 0,
        mismatchFields,
      },
    };
  }

  public getFeedbackPage(
    input: GithubFeedbackPageOptions & {
      readonly scope: GithubFeedbackResourceScope;
    },
  ): Promise<GithubRestResult<GithubFeedbackPage>> {
    const page = input.page ?? 1;
    const perPage = input.perPage ?? DEFAULT_GITHUB_REST_PAGE_SIZE;
    if (
      !validPage(page) ||
      !Number.isSafeInteger(perPage) ||
      perPage < 1 ||
      perPage > MAX_GITHUB_PAGE_SIZE
    ) {
      const invalidCorrelation = correlationId(input.correlationId);
      return Promise.resolve(
        failure(
          "INVALID_INPUT",
          "VALIDATION",
          "The GitHub page request is outside its bounded range.",
          "FIX_INPUT",
          false,
          invalidCorrelation,
          noStatusMetadata(
            input.scope.resource,
            input.scope.key,
            invalidCorrelation,
          ),
        ),
      );
    }
    const path = this.feedbackPath(input.scope);
    const spec: ReadSpec = {
      method: "GET",
      resource: input.scope.resource,
      path,
      scopeKey: input.scope.key,
      ...(input.conditional === undefined
        ? {}
        : { conditional: input.conditional }),
      page,
      perPage,
    };
    const source = feedbackSource(input.scope.resource);
    return this.executeRead(
      input,
      spec,
      input.scope.pullRequest.server,
      (value, response) => {
        const items = arrayPayload(value);
        if (items === undefined)
          throw new GithubRestDecodeError("MALFORMED_RESPONSE");
        const nextPage = nextPageFromResponse(
          response,
          value,
          page,
          input.maxPages ?? this.options.maxPages ?? MAX_GITHUB_PAGE_COUNT,
        );
        return {
          page,
          items: items.map((item) =>
            feedbackFromPayload(item, source, input.scope),
          ),
          nextPage,
        };
      },
    ).then((result) => {
      if (!result.ok || result.outcome === "NOT_MODIFIED") return result;
      const decoded = result.value as unknown as {
        readonly page: number;
        readonly items: readonly GithubFeedbackRecord[];
        readonly nextPage?: number;
      };
      const checkpoint = {
        page: decoded.page,
        perPage,
        ...(decoded.nextPage === undefined
          ? {}
          : { nextPage: decoded.nextPage }),
        complete: decoded.nextPage === undefined,
      };
      const metadata = { ...result.metadata, pagination: checkpoint };
      return {
        ...result,
        metadata,
        value: {
          resource: input.scope.resource,
          scope: input.scope,
          items: decoded.items,
          checkpoint,
        },
      };
    });
  }

  public async getFeedbackCollection(
    input: GithubFeedbackCollectionOptions & {
      readonly scope: GithubFeedbackResourceScope;
    },
  ): Promise<GithubRestResult<GithubFeedbackCollection>> {
    const maxPages =
      input.maxPages ?? this.options.maxPages ?? MAX_GITHUB_PAGE_COUNT;
    if (
      !Number.isSafeInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > MAX_GITHUB_PAGE_COUNT
    ) {
      const correlation = correlationId(input.correlationId);
      return failure(
        "INVALID_INPUT",
        "VALIDATION",
        "The page traversal limit is outside its bounded range.",
        "FIX_INPUT",
        false,
        correlation,
        noStatusMetadata(input.scope.resource, input.scope.key, correlation),
      );
    }
    let page = input.page ?? 1;
    const collectionCorrelation = correlationId(input.correlationId);
    const items: GithubFeedbackRecord[] = [];
    let lastMetadata: GithubRequestMetadata | undefined;
    let checkpoint: GithubFeedbackPage["checkpoint"] | undefined;
    for (let count = 0; count < maxPages; count += 1) {
      const pageResult = await this.getFeedbackPage({
        ...input,
        correlationId: collectionCorrelation,
        page,
        ...(count === 0 ? {} : { conditional: undefined }),
      });
      if (!pageResult.ok || pageResult.outcome === "NOT_MODIFIED")
        return pageResult;
      items.push(...pageResult.value.items);
      lastMetadata = pageResult.metadata;
      checkpoint = pageResult.value.checkpoint;
      if (checkpoint.nextPage === undefined) {
        return {
          ...pageResult,
          metadata: { ...lastMetadata, pagination: checkpoint },
          value: {
            resource: input.scope.resource,
            scope: input.scope,
            items,
            checkpoint,
          },
        };
      }
      page = checkpoint.nextPage;
    }
    return failure(
      "PAGINATION_LIMIT_EXCEEDED",
      "PROTOCOL",
      "The GitHub feedback page sequence did not finish within the bounded page limit.",
      "RETRY",
      false,
      collectionCorrelation,
      {
        ...noStatusMetadata(
          input.scope.resource,
          input.scope.key,
          collectionCorrelation,
        ),
        ...(lastMetadata === undefined ? {} : { status: lastMetadata.status }),
      },
    );
  }

  /** Internal gateway used only by the separate response capability. */
  private executeApprovedResponse(
    input: GithubRestReadOptions,
    spec: MutationSpec,
    target: GithubResponseTarget,
    publication: GithubApprovedPublicationContext,
  ): Promise<GithubRestResult<GithubPostedResponse>> {
    const correlation = correlationId(input.correlationId);
    const profile = this.resolveProfile(
      target.pullRequest.server,
      input.profile,
      input.serverId,
    );
    if (profile === undefined)
      return Promise.resolve(
        failure(
          "CAPABILITY_UNAVAILABLE",
          "AUTHENTICATION",
          "The verified GitHub server capability is unavailable.",
          "REPLACE_ACCESS",
          false,
          correlation,
          noStatusMetadata("pull_request", target.key, correlation),
        ),
      );
    if (!mutationPublicationValid(publication))
      return Promise.resolve(
        failure(
          "INVALID_INPUT",
          "VALIDATION",
          "An explicit approved publication context is required.",
          "FIX_INPUT",
          false,
          correlation,
          noStatusMetadata("pull_request", target.key, correlation),
        ),
      );
    return this.executeRequest(
      profile,
      input,
      spec,
      correlation,
      target.key,
      (value) => {
        const record = recordObject(value);
        const remoteId = positiveId(record?.id);
        if (remoteId === undefined)
          throw new GithubRestDecodeError("MALFORMED_RESPONSE");
        return {
          target,
          remoteId,
          ...(safeOptionalIso(record?.created_at) === undefined
            ? {}
            : { createdAt: safeOptionalIso(record?.created_at) }),
          ...(safeOptionalIso(record?.updated_at) === undefined
            ? {}
            : { updatedAt: safeOptionalIso(record?.updated_at) }),
        };
      },
    );
  }

  private resolveProfile(
    server: GithubRemoteServerIdentity,
    supplied?: GithubServerProfileRecord,
    serverId?: string,
  ): GithubServerProfileRecord | undefined {
    const profile =
      supplied ??
      this.defaultProfile ??
      (this.options.profileForServer === undefined
        ? serverId !== undefined &&
          this.options.profileForServerId !== undefined
          ? this.options.profileForServerId(serverId)
          : undefined
        : this.options.profileForServer(server));
    if (profile === undefined) return undefined;
    const identity = validProfileIdentity(profile);
    return identity !== undefined && serverMatches(server, identity)
      ? profile
      : undefined;
  }

  private async executeRead<T>(
    input: GithubRestReadOptions,
    spec: ReadSpec,
    server: GithubRemoteServerIdentity,
    decode: (value: unknown, response: GithubRestHttpResponse) => T,
  ): Promise<GithubRestResult<T>> {
    const correlation = correlationId(input.correlationId);
    const profile = this.resolveProfile(server, input.profile, input.serverId);
    if (profile === undefined)
      return failure(
        "CAPABILITY_UNAVAILABLE",
        "AUTHENTICATION",
        "The verified GitHub server capability is unavailable.",
        "REPLACE_ACCESS",
        false,
        correlation,
        noStatusMetadata(spec.resource, spec.scopeKey, correlation),
      );
    return this.executeRequest(
      profile,
      input,
      spec,
      correlation,
      spec.scopeKey,
      decode,
    );
  }

  private async executeRequest<T>(
    profile: GithubServerProfileRecord,
    input: GithubRestReadOptions,
    spec: ReadSpec | MutationSpec,
    correlation: string,
    scopeKey: string,
    decode: (value: unknown, response: GithubRestHttpResponse) => T,
  ): Promise<GithubRestResult<T>> {
    const endpoint = buildEndpoint(
      profile,
      spec.path,
      "page" in spec && spec.page !== undefined
        ? pageQuery(spec.page, spec.perPage ?? DEFAULT_GITHUB_REST_PAGE_SIZE)
        : undefined,
    );
    const metadata = noStatusMetadata(
      spec.resource === "response" ? "pull_request" : spec.resource,
      scopeKey,
      correlation,
    );
    if (endpoint === undefined)
      return failure(
        "UNSUPPORTED_SERVER",
        "UNSUPPORTED_SERVER",
        "The configured GitHub API endpoint is not a supported canonical HTTPS endpoint.",
        "REVIEW_ENDPOINT",
        false,
        correlation,
        metadata,
      );
    if ("page" in spec && (spec.page === undefined || !validPage(spec.page)))
      return failure(
        "INVALID_INPUT",
        "VALIDATION",
        "The GitHub page request is outside its bounded range.",
        "FIX_INPUT",
        false,
        correlation,
        metadata,
      );
    const timeoutMs = Math.max(
      1_000,
      Math.min(
        this.options.timeoutMs ?? DEFAULT_GITHUB_REST_TIMEOUT_MS,
        120_000,
      ),
    );
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const abort = () => controller.abort();
    input.signal?.addEventListener("abort", abort, { once: true });
    let requestStarted = false;
    try {
      if (input.signal?.aborted)
        return failure(
          "REQUEST_CANCELLED",
          "CANCELLED",
          "The GitHub request was cancelled before it started.",
          "RETRY",
          false,
          correlation,
          metadata,
        );
      return await this.options.broker.withVerifiedCapability({
        profile,
        correlationId: correlation,
        consumer: async (capability: GithubRequestCapability) => {
          const headers: Record<string, string> = {
            accept: "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
            "user-agent": "PRMonitor/0.1",
          };
          if ("conditional" in spec && spec.conditional !== undefined) {
            if (spec.conditional.etag !== undefined)
              headers["if-none-match"] = spec.conditional.etag;
            if (spec.conditional.lastModified !== undefined)
              headers["if-modified-since"] = spec.conditional.lastModified;
          }
          if (spec.method === "POST")
            headers["content-type"] = "application/json";
          capability.applyTo(headers);
          if (controller.signal.aborted)
            return failure(
              timedOut ? "REQUEST_TIMEOUT" : "REQUEST_CANCELLED",
              timedOut ? "TIMEOUT" : "CANCELLED",
              timedOut
                ? "The GitHub request timed out before it started."
                : "The GitHub request was cancelled before it started.",
              "RETRY",
              true,
              correlation,
              metadata,
            );
          try {
            requestStarted = true;
            const response = await this.options.transport.request({
              method: spec.method,
              url: endpoint,
              headers,
              ...(spec.body === undefined ? {} : { body: spec.body }),
              signal: controller.signal,
            });
            const responseHeaders = normalizedHeaders(response.headers);
            const resultMetadata = {
              schemaVersion: 1 as const,
              correlationId: correlation,
              resource:
                spec.resource === "response" ? "pull_request" : spec.resource,
              scopeKey,
              status: response.status,
              ...(responseConditional(response) === undefined
                ? {}
                : { conditional: responseConditional(response) }),
            } satisfies GithubRequestMetadata;
            if (!sameOrigin(response.url, endpoint))
              return failure(
                "CROSS_ORIGIN_REDIRECT",
                "REDIRECT",
                "The GitHub response came from a different origin and was rejected.",
                "REVIEW_ENDPOINT",
                false,
                correlation,
                resultMetadata,
              );
            if (response.status === 304)
              return {
                ok: true,
                outcome: "NOT_MODIFIED",
                metadata: resultMetadata,
              };
            if (response.status >= 300 && response.status < 400) {
              const location = responseHeaders.location;
              let crossOrigin = false;
              if (location !== undefined) {
                try {
                  crossOrigin = !sameOrigin(
                    new URL(location, endpoint).toString(),
                    endpoint,
                  );
                } catch {
                  crossOrigin = true;
                }
              }
              return failure(
                crossOrigin ? "CROSS_ORIGIN_REDIRECT" : "REDIRECT_REJECTED",
                "REDIRECT",
                crossOrigin
                  ? "The GitHub server attempted a cross-origin redirect; it was not followed."
                  : "The GitHub request returned a redirect; redirects are not followed.",
                "REVIEW_ENDPOINT",
                false,
                correlation,
                resultMetadata,
              );
            }
            const statusCategory = readStatus(response);
            if (statusCategory !== undefined) {
              const rate = retryAfter(response.headers);
              if (statusCategory === "RATE_LIMIT")
                return failure(
                  "RATE_LIMITED",
                  statusCategory,
                  "GitHub rate-limited this request.",
                  "WAIT",
                  true,
                  correlation,
                  resultMetadata,
                  rate,
                );
              if (
                statusCategory === "AUTHORIZATION" &&
                (responseHeaders["x-ratelimit-remaining"] === "0" ||
                  responseHeaders["retry-after"] !== undefined)
              )
                return failure(
                  "RATE_LIMITED",
                  "RATE_LIMIT",
                  "GitHub rate-limited this request.",
                  "WAIT",
                  true,
                  correlation,
                  resultMetadata,
                  rate,
                );
              if (statusCategory === "AUTHENTICATION")
                return failure(
                  "AUTHENTICATION_FAILED",
                  statusCategory,
                  "GitHub rejected the configured access value.",
                  "REPLACE_ACCESS",
                  false,
                  correlation,
                  resultMetadata,
                );
              if (statusCategory === "AUTHORIZATION")
                return failure(
                  "AUTHORIZATION_FAILED",
                  statusCategory,
                  "The configured access value is not authorized for this GitHub resource.",
                  "CONTACT_ADMIN",
                  false,
                  correlation,
                  resultMetadata,
                );
              if (statusCategory === "NOT_FOUND")
                return failure(
                  "NOT_FOUND",
                  statusCategory,
                  "The requested GitHub resource was not found or is not accessible.",
                  "FIX_INPUT",
                  false,
                  correlation,
                  resultMetadata,
                );
              if (statusCategory === "CONFLICT")
                return failure(
                  "CONFLICT",
                  statusCategory,
                  "GitHub rejected the request because the remote state conflicts with it.",
                  "RECONCILE",
                  false,
                  correlation,
                  resultMetadata,
                );
              if (statusCategory === "VALIDATION")
                return failure(
                  "VALIDATION_FAILED",
                  statusCategory,
                  "GitHub rejected the request as invalid.",
                  "FIX_INPUT",
                  false,
                  correlation,
                  resultMetadata,
                );
              if (statusCategory === "TIMEOUT")
                return failure(
                  "REQUEST_TIMEOUT",
                  "TIMEOUT",
                  "GitHub did not complete the request within its server timeout.",
                  "RETRY",
                  true,
                  correlation,
                  resultMetadata,
                );
              if (statusCategory === "NETWORK")
                return failure(
                  "NETWORK_FAILED",
                  statusCategory,
                  "GitHub returned a transient server failure.",
                  "RETRY",
                  true,
                  correlation,
                  resultMetadata,
                );
            }
            if (response.status < 200 || response.status >= 300)
              return failure(
                "PROTOCOL_ERROR",
                "PROTOCOL",
                "GitHub returned an unexpected response status.",
                "RETRY",
                false,
                correlation,
                resultMetadata,
              );
            if (bytes(response.body) > MAX_GITHUB_RESPONSE_BYTES)
              return failure(
                "RESPONSE_TOO_LARGE",
                "RESPONSE_TOO_LARGE",
                "The GitHub response exceeded the bounded response limit.",
                "RETRY",
                false,
                correlation,
                resultMetadata,
              );
            if (response.body.length === 0)
              return failure(
                "MALFORMED_RESPONSE",
                "MALFORMED_RESPONSE",
                "GitHub returned an empty response where structured data was required.",
                "RETRY",
                false,
                correlation,
                resultMetadata,
              );
            if (!contentTypeIsJson(response.headers))
              return failure(
                "PROTOCOL_ERROR",
                "PROTOCOL",
                "GitHub returned a non-JSON response for a structured operation.",
                "RETRY",
                false,
                correlation,
                resultMetadata,
              );
            let decoded: unknown;
            try {
              decoded = JSON.parse(response.body) as unknown;
            } catch {
              return failure(
                "MALFORMED_RESPONSE",
                "MALFORMED_RESPONSE",
                "GitHub returned malformed JSON.",
                "RETRY",
                false,
                correlation,
                resultMetadata,
              );
            }
            let value: T;
            try {
              value = decode(decoded, response);
            } catch (error) {
              if (error instanceof GithubRestDecodeError) {
                const code = error.decodeCode;
                return failure(
                  code,
                  code === "MALFORMED_RESPONSE"
                    ? "MALFORMED_RESPONSE"
                    : "PROTOCOL",
                  code === "MALFORMED_RESPONSE"
                    ? "GitHub returned a response missing required fields."
                    : "GitHub returned an incomplete or unsafe page sequence.",
                  "RETRY",
                  false,
                  correlation,
                  resultMetadata,
                );
              }
              return failure(
                "MALFORMED_RESPONSE",
                "MALFORMED_RESPONSE",
                "GitHub returned a response that could not be safely decoded.",
                "RETRY",
                false,
                correlation,
                resultMetadata,
              );
            }
            return {
              ok: true,
              outcome: "UPDATED",
              value,
              metadata: resultMetadata,
            };
          } catch (error) {
            if (timedOut)
              return spec.method === "POST" && requestStarted
                ? failure(
                    "MUTATION_UNCERTAIN",
                    "UNCERTAIN_MUTATION",
                    "The response request may have reached GitHub, but confirmation was lost.",
                    "RECONCILE",
                    false,
                    correlation,
                    metadata,
                    {},
                    "UNCERTAIN",
                  )
                : failure(
                    "REQUEST_TIMEOUT",
                    "TIMEOUT",
                    "The GitHub request timed out before completion.",
                    "RETRY",
                    true,
                    correlation,
                    metadata,
                  );
            if (controller.signal.aborted || input.signal?.aborted)
              return spec.method === "POST" && requestStarted
                ? failure(
                    "MUTATION_UNCERTAIN",
                    "UNCERTAIN_MUTATION",
                    "The response request may have reached GitHub, but confirmation was lost.",
                    "RECONCILE",
                    false,
                    correlation,
                    metadata,
                    {},
                    "UNCERTAIN",
                  )
                : failure(
                    "REQUEST_CANCELLED",
                    "CANCELLED",
                    "The GitHub request was cancelled before completion.",
                    "RETRY",
                    false,
                    correlation,
                    metadata,
                  );
            if (
              error instanceof GithubRestTransportError &&
              error.code === "RESPONSE_TOO_LARGE"
            )
              return failure(
                "RESPONSE_TOO_LARGE",
                "RESPONSE_TOO_LARGE",
                "The GitHub response exceeded the bounded response limit.",
                "RETRY",
                false,
                correlation,
                metadata,
              );
            const message = error instanceof Error ? error.message : "";
            if (
              /certificate|tls|secure connection|self[- ]signed/iu.test(message)
            )
              return failure(
                "TLS_FAILED",
                "TLS",
                "The GitHub server certificate could not be validated.",
                "REVIEW_ENDPOINT",
                false,
                correlation,
                metadata,
              );
            return spec.method === "POST" && requestStarted
              ? failure(
                  "MUTATION_UNCERTAIN",
                  "UNCERTAIN_MUTATION",
                  "The response request may have reached GitHub, but confirmation was lost.",
                  "RECONCILE",
                  false,
                  correlation,
                  metadata,
                  {},
                  "UNCERTAIN",
                )
              : failure(
                  "NETWORK_FAILED",
                  "NETWORK",
                  "The GitHub server could not be reached safely.",
                  "RETRY",
                  true,
                  correlation,
                  metadata,
                );
          }
        },
      });
    } catch (error) {
      if (error instanceof GithubCredentialBrokerError)
        return failure(
          "CAPABILITY_UNAVAILABLE",
          "AUTHENTICATION",
          "The verified GitHub server capability is unavailable.",
          "REPLACE_ACCESS",
          false,
          correlation,
          metadata,
        );
      return failure(
        "NETWORK_FAILED",
        "NETWORK",
        "The GitHub request could not be completed safely.",
        "RETRY",
        true,
        correlation,
        metadata,
      );
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abort);
    }
  }

  private feedbackPath(scope: GithubFeedbackResourceScope): string {
    const base = pathForPullRequest(scope.pullRequest);
    if (scope.resource === "review_comments") return `${base}/comments`;
    if (scope.resource === "reviews") return `${base}/reviews`;
    return `${pathForRepository(scope.pullRequest.repository)}/issues/${scope.pullRequest.number}/comments`;
  }

  private decodeRepository(
    value: unknown,
    server: GithubRemoteServerIdentity,
  ): GithubRepositoryMetadata {
    const record = recordObject(value);
    const repository = repositoryFromPayload(record, server);
    if (!repository.available)
      throw new GithubRestDecodeError("MALFORMED_RESPONSE");
    const defaultBranch = boundedString(
      record?.default_branch,
      MAX_GITHUB_BRANCH_BYTES,
    );
    if (record?.default_branch !== undefined && defaultBranch === undefined)
      throw new GithubRestDecodeError("MALFORMED_RESPONSE");
    return {
      identity: repository,
      ...(defaultBranch === undefined ? {} : { defaultBranch }),
      ...(typeof record?.private === "boolean"
        ? { isPrivate: record.private }
        : {}),
      ...(typeof record?.archived === "boolean"
        ? { isArchived: record.archived }
        : {}),
    };
  }

  private decodePullRequest(
    value: unknown,
    identity: GithubPullRequestIdentity,
  ): GithubPullRequestMetadata {
    const record = recordObject(value);
    const base = recordObject(record?.base);
    const head = recordObject(record?.head);
    const baseRepository = repositoryFromPayload(base?.repo, identity.server);
    if (
      !baseRepository.available ||
      baseRepository.key !== identity.repository.key
    )
      throw new GithubRestDecodeError("MALFORMED_RESPONSE");
    const headRepository = repositoryFromPayload(
      head?.repo,
      identity.server,
      head?.repo === null ? "DELETED" : "INACCESSIBLE",
    );
    const baseBranch = boundedString(base?.ref, MAX_GITHUB_BRANCH_BYTES);
    const headBranch = boundedString(head?.ref, MAX_GITHUB_BRANCH_BYTES);
    const baseSha = sha(base?.sha);
    const headSha = sha(head?.sha);
    const number =
      typeof record?.number === "number" && Number.isSafeInteger(record.number)
        ? record.number
        : undefined;
    const state =
      record?.state === "open"
        ? "OPEN"
        : record?.state === "closed"
          ? "CLOSED"
          : undefined;
    if (
      number !== identity.number ||
      baseBranch === undefined ||
      headBranch === undefined ||
      baseSha === undefined ||
      headSha === undefined ||
      state === undefined
    )
      throw new GithubRestDecodeError("MALFORMED_RESPONSE");
    const defaultBranch = boundedString(
      record?.base && base?.repo && recordObject(base.repo)?.default_branch,
      MAX_GITHUB_BRANCH_BYTES,
    );
    return {
      identity,
      number,
      state,
      merged: record?.merged === true,
      ...(boundedString(record?.title, 16_384) === undefined
        ? {}
        : { title: boundedString(record?.title, 16_384) }),
      baseRepository,
      headRepository,
      baseBranch,
      headBranch,
      baseSha,
      headSha,
      ...(defaultBranch === undefined ? {} : { defaultBranch }),
    };
  }
}

class GithubResponseClientImpl implements GithubResponseClient {
  public constructor(private readonly execute: ApprovedResponseExecutor) {}

  public postIssueComment(
    input: GithubResponsePost,
  ): Promise<GithubRestResult<GithubPostedResponse>> {
    return this.post(input, "ISSUE_COMMENT");
  }

  public postReviewCommentReply(
    input: GithubResponsePost,
  ): Promise<GithubRestResult<GithubPostedResponse>> {
    return this.post(input, "REVIEW_COMMENT_REPLY");
  }

  private post(
    input: GithubResponsePost,
    source: GithubResponseTarget["source"],
  ): Promise<GithubRestResult<GithubPostedResponse>> {
    const invalidCorrelation = `github-rest-${randomUUID()}`;
    if (
      input.target.source !== source ||
      input.body.length === 0 ||
      bytes(input.body) > MAX_GITHUB_BODY_BYTES
    )
      return Promise.resolve(
        failure(
          "INVALID_INPUT",
          "VALIDATION",
          "The response target or body is outside its bounded contract.",
          "FIX_INPUT",
          false,
          invalidCorrelation,
          noStatusMetadata(
            "pull_request",
            input.target.key,
            invalidCorrelation,
          ),
        ),
      );
    const repository = input.target.pullRequest.repository;
    const base = pathForRepository(repository);
    const path =
      source === "ISSUE_COMMENT"
        ? `${base}/issues/${input.target.pullRequest.number}/comments`
        : `${base}/pulls/${input.target.pullRequest.number}/comments/${encodePathPart(input.target.commentId)}/replies`;
    const spec: MutationSpec = {
      resource: "response",
      method: "POST",
      path,
      scopeKey: input.target.key,
      body: JSON.stringify({ body: input.body }),
    };
    return this.execute({}, spec, input.target, input.publication);
  }
}

export function createGithubPullRequestIdentity(input: {
  readonly server: GithubServerIdentity;
  readonly owner: string;
  readonly repositoryName: string;
  readonly number: number;
}): GithubPullRequestIdentity {
  const server = remoteServerIdentity(input.server);
  const repository = createRepositoryIdentity({
    server,
    owner: input.owner,
    name: input.repositoryName,
  });
  return createPullRequestIdentity({
    server,
    repository,
    number: input.number,
  });
}

export function createGithubRepositoryIdentity(input: {
  readonly server: GithubServerIdentity;
  readonly owner: string;
  readonly name: string;
  readonly providerId?: number;
}): GithubRepositoryIdentity {
  const server = remoteServerIdentity(input.server);
  return createRepositoryIdentity({
    server,
    owner: input.owner,
    name: input.name,
    ...(input.providerId === undefined ? {} : { providerId: input.providerId }),
  });
}

export function createGithubBranchRefIdentity(input: {
  readonly repository: GithubRepositoryIdentity;
  readonly name: string;
}): GithubBranchRefIdentity {
  return createBranchRefIdentity(input);
}

export function createGithubFeedbackScope(input: {
  readonly pullRequest: GithubPullRequestIdentity;
  readonly resource: Exclude<GithubRestResource, "repository" | "branch_ref">;
}): GithubFeedbackResourceScope {
  return createFeedbackResourceScope(input);
}

export function createGithubResponseTarget(input: {
  readonly pullRequest: GithubPullRequestIdentity;
  readonly source: GithubResponseTarget["source"];
  readonly commentId: string;
}): GithubResponseTarget {
  return createResponseTarget(input);
}
