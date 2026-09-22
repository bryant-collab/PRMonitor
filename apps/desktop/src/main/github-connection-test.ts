import type {
  GithubReasonCategory,
  GithubReasonCode,
  GithubReasonNextAction,
  GithubSafeReason,
} from "../shared/github-server";
import type { GithubCredentialBroker, GithubRequestCapability } from "./github-credential-broker";
import type {
  GithubCredentialOperationRecord,
  GithubServerProfileRecord,
} from "./persistence/repositories";

export const DEFAULT_GITHUB_CONNECTION_TIMEOUT_MS = 15_000;
export const MAX_GITHUB_CONNECTION_RESPONSE_BYTES = 128 * 1024;

export interface GithubHttpRequest {
  readonly method: "GET";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

export interface GithubHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly url: string;
}

export interface GithubHttpTransport {
  request(request: GithubHttpRequest): Promise<GithubHttpResponse>;
}

export class GithubHttpTransportError extends Error {
  public constructor(
    public readonly code: "RESPONSE_TOO_LARGE",
    message: string,
  ) {
    super(message);
    this.name = "GithubHttpTransportError";
  }
}

function headersFromResponse(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return headers;
}

async function readBoundedBody(response: Response): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    Number.isFinite(Number(contentLength)) &&
    Number(contentLength) > MAX_GITHUB_CONNECTION_RESPONSE_BYTES
  )
    throw new GithubHttpTransportError(
      "RESPONSE_TOO_LARGE",
      "The GitHub identity response exceeded the bounded response limit.",
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
      if (total > MAX_GITHUB_CONNECTION_RESPONSE_BYTES) {
        await reader.cancel();
        throw new GithubHttpTransportError(
          "RESPONSE_TOO_LARGE",
          "The GitHub identity response exceeded the bounded response limit.",
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

export class FetchGithubHttpTransport implements GithubHttpTransport {
  public async request(request: GithubHttpRequest): Promise<GithubHttpResponse> {
    if (request.method !== "GET")
      throw new GithubHttpTransportError(
        "RESPONSE_TOO_LARGE",
        "The GitHub connection boundary only permits read-only identity requests.",
      );
    const response = await fetch(request.url, {
      method: "GET",
      headers: request.headers,
      redirect: "manual",
      signal: request.signal,
    });
    return {
      status: response.status,
      headers: headersFromResponse(response),
      body: await readBoundedBody(response),
      url: response.url,
    };
  }
}

export interface GithubConnectionAccount {
  readonly login?: string;
  readonly name?: string;
}

export interface GithubConnectionTestSuccess {
  readonly ok: true;
  readonly account: GithubConnectionAccount;
  readonly verifiedAt: string;
  readonly endpoint: string;
}

export interface GithubConnectionTestFailure {
  readonly ok: false;
  readonly reason: GithubSafeReason;
  readonly endpoint: string;
}

export type GithubConnectionTestResult =
  | GithubConnectionTestSuccess
  | GithubConnectionTestFailure;

export interface GithubConnectionTestClock {
  now(): string;
}

function reason(
  code: GithubReasonCode,
  category: GithubReasonCategory,
  message: string,
  nextAction: GithubReasonNextAction,
  correlationId: string,
): GithubSafeReason {
  return { code, category, message, nextAction, correlationId };
}

function endpointFor(apiBaseUrl: string): string | undefined {
  try {
    const base = new URL(apiBaseUrl);
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash)
      return undefined;
    const endpoint = new URL("user", `${base.toString().replace(/\/$/u, "")}/`);
    if (endpoint.origin !== base.origin) return undefined;
    return endpoint.toString();
  } catch {
    return undefined;
  }
}

function sameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

function safeAccount(body: string): GithubConnectionAccount | undefined {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return undefined;
    const record = parsed as Record<string, unknown>;
    const login =
      typeof record.login === "string" && record.login.length <= 256
        ? record.login
        : undefined;
    const name =
      typeof record.name === "string" && record.name.length <= 256
        ? record.name
        : undefined;
    if (login === undefined && name === undefined) return undefined;
    return {
      ...(login === undefined ? {} : { login }),
      ...(name === undefined ? {} : { name }),
    };
  } catch {
    return undefined;
  }
}

function responseFailure(
  response: GithubHttpResponse,
  endpoint: string,
  correlationId: string,
): GithubConnectionTestFailure | undefined {
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.location;
    if (location !== undefined) {
      try {
        if (!sameOrigin(endpoint, new URL(location, endpoint).toString()))
          return {
            ok: false,
            endpoint,
            reason: reason(
              "CROSS_ORIGIN_REDIRECT",
              "REDIRECT",
              "The configured GitHub server attempted a cross-origin redirect; access was not forwarded.",
              "REVIEW_ENDPOINT",
              correlationId,
            ),
          };
      } catch {
        return {
          ok: false,
          endpoint,
          reason: reason(
            "REDIRECT_REJECTED",
            "REDIRECT",
            "The configured GitHub server returned an unsafe redirect.",
            "REVIEW_ENDPOINT",
            correlationId,
          ),
        };
      }
    }
    return {
      ok: false,
      endpoint,
      reason: reason(
        "REDIRECT_REJECTED",
        "REDIRECT",
        "The GitHub identity check does not follow redirects.",
        "REVIEW_ENDPOINT",
        correlationId,
      ),
    };
  }
  if (response.status === 401)
    return {
      ok: false,
      endpoint,
      reason: reason(
        "AUTHENTICATION_FAILED",
        "AUTHENTICATION",
        "GitHub rejected the configured access value.",
        "REPLACE_ACCESS",
        correlationId,
      ),
    };
  if (response.status === 403) {
    const rateLimited =
      response.headers["x-ratelimit-remaining"] === "0" ||
      response.headers["retry-after"] !== undefined;
    return {
      ok: false,
      endpoint,
      reason: rateLimited
        ? reason(
            "RATE_LIMITED",
            "RATE_LIMIT",
            "GitHub rate-limited the identity check.",
            "WAIT",
            correlationId,
          )
        : reason(
            "AUTHORIZATION_FAILED",
            "AUTHORIZATION",
            "The configured access value is not authorized for this GitHub server.",
            "REPLACE_ACCESS",
            correlationId,
          ),
    };
  }
  if (response.status === 404)
    return {
      ok: false,
      endpoint,
      reason: reason(
        "PROTOCOL_MISMATCH",
        "PROTOCOL",
        "The configured GitHub API did not expose the expected identity endpoint.",
        "REVIEW_ENDPOINT",
        correlationId,
      ),
    };
  if (response.status < 200 || response.status >= 300)
    return {
      ok: false,
      endpoint,
      reason: reason(
        "UNEXPECTED_RESPONSE",
        "PROTOCOL",
        "The GitHub identity check returned an unexpected response.",
        "RETRY",
        correlationId,
      ),
    };
  return undefined;
}

function classifyTransportFailure(
  error: unknown,
  signal: AbortSignal,
  timedOut: boolean,
  endpoint: string,
  correlationId: string,
): GithubConnectionTestFailure {
  if (timedOut)
    return {
      ok: false,
      endpoint,
      reason: reason(
        "REQUEST_TIMEOUT",
        "TIMEOUT",
        "The GitHub identity check timed out before verification completed.",
        "RETRY",
        correlationId,
      ),
    };
  if (signal.aborted)
    return {
      ok: false,
      endpoint,
      reason: reason(
        "REQUEST_CANCELLED",
        "CANCELLED",
        "The GitHub identity check was cancelled before verification completed.",
        "RETRY",
        correlationId,
      ),
    };
  if (error instanceof GithubHttpTransportError && error.code === "RESPONSE_TOO_LARGE")
    return {
      ok: false,
      endpoint,
      reason: reason(
        "RESPONSE_TOO_LARGE",
        "PROTOCOL",
        "The GitHub identity response was too large to process safely.",
        "RETRY",
        correlationId,
      ),
    };
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (/certificate|tls|secure connection|self[- ]signed/iu.test(message))
    return {
      ok: false,
      endpoint,
      reason: reason(
        "TLS_FAILED",
        "TLS",
        "The GitHub server certificate could not be validated.",
        "REVIEW_ENDPOINT",
        correlationId,
      ),
    };
  return {
    ok: false,
    endpoint,
    reason: reason(
      "NETWORK_FAILED",
      "NETWORK",
      "The GitHub server could not be reached safely.",
      "RETRY",
      correlationId,
    ),
  };
}

export async function testGithubConnection(input: {
  readonly profile: GithubServerProfileRecord;
  readonly revisionKind: "ACTIVE" | "CANDIDATE";
  readonly operation?: GithubCredentialOperationRecord;
  readonly broker: GithubCredentialBroker;
  readonly transport: GithubHttpTransport;
  readonly clock?: GithubConnectionTestClock;
  readonly correlationId: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}): Promise<GithubConnectionTestResult> {
  const endpoint = endpointFor(input.profile.apiBaseUrl);
  if (endpoint === undefined)
    return {
      ok: false,
      endpoint: input.profile.apiBaseUrl,
      reason: reason(
        "INSECURE_ENDPOINT",
        "VALIDATION",
        "The configured GitHub API endpoint is not a safe HTTPS origin.",
        "REVIEW_ENDPOINT",
        input.correlationId,
      ),
    };
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1_000, Math.min(input.timeoutMs ?? DEFAULT_GITHUB_CONNECTION_TIMEOUT_MS, 60_000)));
  const abort = () => controller.abort();
  input.signal?.addEventListener("abort", abort, { once: true });
  if (input.signal?.aborted) controller.abort();

  const send = async (capability: GithubRequestCapability): Promise<GithubConnectionTestResult> => {
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "PRMonitor/0.1",
    };
    capability.applyTo(headers);
    try {
      if (controller.signal.aborted)
        return classifyTransportFailure(
          new Error("request aborted"),
          controller.signal,
          timedOut,
          endpoint,
          input.correlationId,
        );
      const response = await input.transport.request({
        method: "GET",
        url: endpoint,
        headers,
        signal: controller.signal,
      });
      if (controller.signal.aborted)
        return classifyTransportFailure(
          new Error("request aborted"),
          controller.signal,
          timedOut,
          endpoint,
          input.correlationId,
        );
      if (!sameOrigin(response.url, endpoint))
        return {
          ok: false,
          endpoint,
          reason: reason(
            "CROSS_ORIGIN_REDIRECT",
            "REDIRECT",
            "The identity response came from a different origin; access was not accepted.",
            "REVIEW_ENDPOINT",
            input.correlationId,
          ),
        };
      const failure = responseFailure(response, endpoint, input.correlationId);
      if (failure !== undefined) return failure;
      const account = safeAccount(response.body);
      if (account === undefined)
        return {
          ok: false,
          endpoint,
          reason: reason(
            "MALFORMED_RESPONSE",
            "PROTOCOL",
            "The GitHub identity response did not contain a safe account summary.",
            "RETRY",
            input.correlationId,
          ),
        };
      return {
        ok: true,
        endpoint,
        account,
        verifiedAt: input.clock?.now() ?? new Date().toISOString(),
      };
    } catch (error) {
      return classifyTransportFailure(
        error,
        controller.signal,
        timedOut,
        endpoint,
        input.correlationId,
      );
    }
  };

  try {
    if (input.revisionKind === "CANDIDATE") {
      if (input.operation === undefined)
        return {
          ok: false,
          endpoint,
          reason: reason(
            "OPERATION_INTERRUPTED",
            "RECOVERY",
            "The pending GitHub access operation is incomplete and must be retried.",
            "RETRY",
            input.correlationId,
          ),
        };
      return await input.broker.withCandidateCapability({
        profile: input.profile,
        operation: input.operation,
        correlationId: input.correlationId,
        consumer: send,
      });
    }
    return await input.broker.withVerifiedCapability({
      profile: input.profile,
      correlationId: input.correlationId,
      consumer: send,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const brokerFailure = /protected|verified|active|pending/iu.test(message);
    return {
      ok: false,
      endpoint,
      reason: reason(
        brokerFailure ? "STORE_READ_FAILED" : "NETWORK_FAILED",
        brokerFailure ? "SECURE_STORAGE" : "NETWORK",
        brokerFailure
          ? "The protected GitHub access value could not be used. Replace it and retry."
          : "The GitHub identity check could not be completed safely.",
        brokerFailure ? "REPLACE_ACCESS" : "RETRY",
        input.correlationId,
      ),
    };
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", abort);
  }
}
