import type {
  GithubCredentialOperationRecord,
  GithubServerProfileRecord,
} from "./persistence/repositories";
import type { SecureCredentialStore } from "./secure-credential-store";

export type GithubCredentialAccessState =
  | "MISSING"
  | "UNVERIFIED"
  | "EXPIRED_OR_REJECTED"
  | "UNAVAILABLE"
  | "VERIFIED";

export class GithubCredentialBrokerError extends Error {
  public constructor(
    public readonly state: Exclude<GithubCredentialAccessState, "VERIFIED">,
    message: string,
  ) {
    super(message);
    this.name = "GithubCredentialBrokerError";
  }
}

/**
 * A request-scoped capability. Consumers can apply authorization to one
 * in-memory request, but cannot read a reusable token string or serialize the
 * capability into renderer/domain state.
 */
export class GithubRequestCapability {
  readonly #value: string;

  public constructor(
    public readonly serverId: string,
    public readonly apiBaseUrl: string,
    public readonly revision: number,
    public readonly correlationId: string,
    value: string,
  ) {
    this.#value = value;
  }

  public applyTo(headers: Record<string, string>): void {
    headers.Authorization = `Bearer ${this.#value}`;
  }
}

export interface GithubCredentialBroker {
  withVerifiedCapability<T>(input: {
    readonly profile: GithubServerProfileRecord;
    readonly correlationId: string;
    readonly consumer: (capability: GithubRequestCapability) => Promise<T>;
  }): Promise<T>;
  withCandidateCapability<T>(input: {
    readonly profile: GithubServerProfileRecord;
    readonly operation: GithubCredentialOperationRecord;
    readonly correlationId: string;
    readonly consumer: (capability: GithubRequestCapability) => Promise<T>;
  }): Promise<T>;
}

function ensureProfileIdentity(
  profile: GithubServerProfileRecord,
  expectedApiBaseUrl: string,
): void {
  if (profile.apiBaseUrl !== expectedApiBaseUrl)
    throw new GithubCredentialBrokerError(
      "UNVERIFIED",
      "The configured GitHub server identity changed and must be verified again.",
    );
}

export class SecureGithubCredentialBroker implements GithubCredentialBroker {
  public constructor(private readonly store: SecureCredentialStore) {}

  public async withVerifiedCapability<T>(input: {
    readonly profile: GithubServerProfileRecord;
    readonly correlationId: string;
    readonly consumer: (capability: GithubRequestCapability) => Promise<T>;
  }): Promise<T> {
    const auth = input.profile.auth;
    if (auth === undefined || auth.activeRef === undefined || auth.activeRevision === undefined)
      throw new GithubCredentialBrokerError(
        "MISSING",
        "The GitHub server profile has no active protected access value.",
      );
    if (auth.status !== "VERIFIED")
      throw new GithubCredentialBrokerError(
        auth.status === "NEEDS_ATTENTION" ? "EXPIRED_OR_REJECTED" : "UNVERIFIED",
        "The GitHub server profile is not verified for deterministic requests.",
      );
    ensureProfileIdentity(input.profile, input.profile.apiBaseUrl);
    return this.withReference({
      profile: input.profile,
      reference: auth.activeRef,
      revision: auth.activeRevision,
      correlationId: input.correlationId,
      consumer: input.consumer,
    });
  }

  public async withCandidateCapability<T>(input: {
    readonly profile: GithubServerProfileRecord;
    readonly operation: GithubCredentialOperationRecord;
    readonly correlationId: string;
    readonly consumer: (capability: GithubRequestCapability) => Promise<T>;
  }): Promise<T> {
    const auth = input.profile.auth;
    if (
      auth === undefined ||
      auth.candidateRef === undefined ||
      auth.candidateRevision === undefined ||
      input.operation.candidateRef === undefined ||
      input.operation.candidateRevision === undefined
    )
      throw new GithubCredentialBrokerError(
        "MISSING",
        "The GitHub server operation has no pending protected access value.",
      );
    if (
      auth.candidateRef !== input.operation.candidateRef ||
      auth.candidateRevision !== input.operation.candidateRevision
    )
      throw new GithubCredentialBrokerError(
        "UNVERIFIED",
        "The pending protected access value no longer matches its operation snapshot.",
      );
    ensureProfileIdentity(input.profile, input.operation.endpointSnapshot.apiBaseUrl);
    return this.withReference({
      profile: input.profile,
      reference: input.operation.candidateRef,
      revision: input.operation.candidateRevision,
      correlationId: input.correlationId,
      consumer: input.consumer,
    });
  }

  private async withReference<T>(input: {
    readonly profile: GithubServerProfileRecord;
    readonly reference: string;
    readonly revision: number;
    readonly correlationId: string;
    readonly consumer: (capability: GithubRequestCapability) => Promise<T>;
  }): Promise<T> {
    let value: string;
    try {
      value = await this.store.readForRequest({ reference: input.reference });
    } catch {
      throw new GithubCredentialBrokerError(
        "UNAVAILABLE",
        "The protected GitHub access value could not be recovered. Replace it and retry.",
      );
    }
    const capability = new GithubRequestCapability(
      input.profile.serverId,
      input.profile.apiBaseUrl,
      input.revision,
      input.correlationId,
      value,
    );
    return input.consumer(capability);
  }
}
