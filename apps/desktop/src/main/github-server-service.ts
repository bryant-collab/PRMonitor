import { createHash, randomUUID } from "node:crypto";
import {
  validateGithubServerProfileInput,
  type GithubCredentialOperationView,
  type GithubSafeReason,
  type GithubServerProfileInput,
  type GithubServerProfileView,
  type GithubServerSettingsView,
} from "../shared/github-server";
import {
  testGithubConnection,
  type GithubConnectionTestResult,
  type GithubHttpTransport,
} from "./github-connection-test";
import {
  GithubCredentialBrokerError,
  SecureGithubCredentialBroker,
  type GithubCredentialBroker,
} from "./github-credential-broker";
import { GithubRestClient, type GithubReadClient } from "./github-rest-client";
import type {
  GithubPullRequestIdentity,
  GithubPullRequestMetadata,
  GithubRestResult,
} from "../shared/github-rest";
import {
  createOpaqueCredentialReference,
  SecureCredentialStoreError,
  type SecureCredentialStore,
} from "./secure-credential-store";
import type {
  GithubCredentialOperationRecord,
  GithubServerAuthRecord,
  GithubServerProfileRecord,
  PersistenceRepositories,
} from "./persistence/repositories";

export interface GithubServerServiceClock {
  now(): string;
}

export interface GithubServerServiceOptions {
  readonly repositories: PersistenceRepositories;
  readonly credentialStore: SecureCredentialStore;
  readonly transport: GithubHttpTransport;
  readonly clock?: GithubServerServiceClock;
  readonly connectionTimeoutMs?: number;
}

export interface GithubCredentialOperationResult {
  readonly operationId: string;
  readonly profile: GithubServerProfileView;
}

const DEFAULT_CLOCK: GithubServerServiceClock = {
  now: () => new Date().toISOString(),
};

function serverIdForOrigin(origin: string): string {
  return `github-server-${createHash("sha256").update(origin, "utf8").digest("hex").slice(0, 32)}`;
}

function operationId(): string {
  return `github-operation-${randomUUID()}`;
}

function isSafeOperationId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}

function safeReason(
  reason: Omit<GithubSafeReason, "correlationId">,
  correlationId: string,
): GithubSafeReason {
  return { ...reason, correlationId };
}

function genericReason(
  code: GithubSafeReason["code"],
  category: GithubSafeReason["category"],
  message: string,
  nextAction: GithubSafeReason["nextAction"],
  correlationId: string,
): GithubSafeReason {
  return safeReason({ code, category, message, nextAction }, correlationId);
}

function authReason(error: unknown, correlationId: string): GithubSafeReason {
  if (error instanceof SecureCredentialStoreError)
    return safeReason(
      {
        code: error.reason.code,
        category: error.reason.category,
        message: error.reason.message,
        nextAction:
          error.reason.code === "STORE_UNAVAILABLE" ||
          error.reason.code === "STORE_WEAK" ||
          error.reason.code === "STORE_NOT_READY"
            ? "ENABLE_SECURE_STORAGE"
            : error.reason.code === "STORE_RETIRE_FAILED" ||
                error.reason.code === "STORE_CLEANUP_FAILED"
              ? "CLEAN_UP"
              : "REPLACE_ACCESS",
      },
      correlationId,
    );
  if (error instanceof GithubCredentialBrokerError)
    return genericReason(
      error.state === "MISSING" ? "MISSING_ACCESS" : "STORE_READ_FAILED",
      "SECURE_STORAGE",
      error.message,
      error.state === "MISSING" ? "REPLACE_ACCESS" : "REPLACE_ACCESS",
      correlationId,
    );
  return genericReason(
    "UNEXPECTED_RESPONSE",
    "UNKNOWN",
    "The GitHub authentication operation could not be completed safely.",
    "RETRY",
    correlationId,
  );
}

function operationView(
  operation: GithubCredentialOperationRecord,
): GithubCredentialOperationView {
  return {
    schemaVersion: 1,
    id: operation.operationId,
    profileId: operation.serverId,
    kind: operation.operationKind,
    phase: operation.phase,
    ...(operation.candidateRevision === undefined
      ? {}
      : { candidateRevision: operation.candidateRevision }),
    ...(operation.reason === undefined ? {} : { reason: operation.reason }),
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
  };
}

export class GithubServerService {
  private readonly clock: GithubServerServiceClock;
  private readonly broker: GithubCredentialBroker;

  public constructor(private readonly options: GithubServerServiceOptions) {
    this.clock = options.clock ?? DEFAULT_CLOCK;
    this.broker = new SecureGithubCredentialBroker(options.credentialStore);
  }

  /**
   * Startup is deliberately conservative. A process stop can leave a store
   * write, test, activation, or cleanup uncertain, so no incomplete operation
   * is resumed or treated as verified without an explicit user action.
   */
  public reconcileStartup(): void {
    const interrupted = genericReason(
      "OPERATION_INTERRUPTED",
      "RECOVERY",
      "The GitHub authentication operation was interrupted and needs an explicit retry or cleanup.",
      "RETRY",
      "github-startup-reconcile",
    );
    for (const operation of this.options.repositories.listGithubCredentialOperations()) {
      if (
        operation.phase === "COMPLETED" ||
        operation.phase === "FAILED" ||
        operation.phase === "CANCELLED" ||
        operation.phase === "RECOVERY_REQUIRED"
      )
        continue;
      try {
        this.options.repositories.updateGithubCredentialOperation({
          operationId: operation.operationId,
          expectedVersion: operation.version,
          phase: "RECOVERY_REQUIRED",
          cleanupState:
            operation.previousActiveRef === undefined
              ? "NOT_REQUIRED"
              : "RECOVERY_REQUIRED",
          reason: interrupted,
        });
        const profile = this.options.repositories.getGithubServerProfile(
          operation.serverId,
        );
        const auth = profile?.auth;
        if (
          profile !== undefined &&
          auth !== undefined &&
          auth.status === "TESTING"
        ) {
          this.options.repositories.putGithubServerAuth({
            serverId: profile.serverId,
            status:
              auth.activeRef === undefined ? "RECOVERY_REQUIRED" : "VERIFIED",
            storeState: this.options.credentialStore.getStatus().state,
            activeRef: auth.activeRef,
            activeRevision: auth.activeRevision,
            candidateRef: auth.candidateRef,
            candidateRevision: auth.candidateRevision,
            accountLogin: auth.accountLogin,
            accountName: auth.accountName,
            verifiedAt: auth.verifiedAt,
            lastTestAt: auth.lastTestAt,
            reason: interrupted,
            expectedVersion: auth.version,
          });
        }
      } catch {
        // A concurrent deterministic writer owns reconciliation; the next
        // read/action will expose the durable state and retry path.
      }
    }
  }

  public readSettings(): GithubServerSettingsView {
    const status = this.options.credentialStore.getStatus();
    const profiles = this.options.repositories
      .listGithubServerProfiles()
      .filter((profile) => profile.auth?.status !== "REMOVED")
      .map((profile) => this.toView(profile));
    const operations = this.options.repositories
      .listGithubCredentialOperations()
      .filter((operation) => operation.phase !== "COMPLETED")
      .slice(0, 50)
      .map(operationView);
    return {
      schemaVersion: 1,
      secureStore: {
        state: status.state,
        ...(status.reason === undefined
          ? {}
          : {
              reason: genericReason(
                status.reason.code,
                status.reason.category,
                status.reason.message,
                status.state === "AVAILABLE" ? "NONE" : "ENABLE_SECURE_STORAGE",
                "github-settings",
              ),
            }),
      },
      profiles,
      operations,
    };
  }

  /**
   * F07 receives only a verified profile record. The request-scoped credential
   * capability stays inside the F06 client and never crosses this boundary.
   */
  public getVerifiedProfile(
    serverId: string,
  ): GithubServerProfileRecord | undefined {
    const profile = this.options.repositories.getGithubServerProfile(serverId);
    return profile?.auth?.status === "VERIFIED" &&
      profile.auth.activeRevision !== undefined
      ? profile
      : undefined;
  }

  /**
   * F10 receives a provider-neutral read client. The credential broker and
   * transport remain owned by this service and never cross into the watcher.
   */
  public getReadClient(serverId: string): GithubReadClient | undefined {
    const profile = this.getVerifiedProfile(serverId);
    if (profile === undefined) return undefined;
    return new GithubRestClient({
      broker: this.broker,
      transport: this.options.transport,
      profile,
      profileForServerId: (requestedServerId) =>
        requestedServerId === serverId
          ? this.getVerifiedProfile(requestedServerId)
          : undefined,
    });
  }

  /**
   * F23 receives the same verified profile and credential broker as F10, but
   * keeps the response mutation capability behind an explicit publication
   * accessor.  Read-only consumers continue to receive GithubReadClient.
   */
  public getPublicationClient(serverId: string): GithubRestClient | undefined {
    const profile = this.getVerifiedProfile(serverId);
    if (profile === undefined) return undefined;
    return new GithubRestClient({
      broker: this.broker,
      transport: this.options.transport,
      profile,
      profileForServerId: (requestedServerId) =>
        requestedServerId === serverId
          ? this.getVerifiedProfile(requestedServerId)
          : undefined,
    });
  }

  public getPullRequestMetadata(input: {
    readonly profile: GithubServerProfileRecord;
    readonly identity: GithubPullRequestIdentity;
    readonly correlationId: string;
    readonly signal?: AbortSignal;
  }): Promise<GithubRestResult<GithubPullRequestMetadata>> {
    const current = this.requireProfile(input.profile.serverId);
    const client = new GithubRestClient({
      broker: this.broker,
      transport: this.options.transport,
      profile: current,
    });
    return client.getPullRequest({
      profile: current,
      serverId: current.serverId,
      identity: input.identity,
      correlationId: input.correlationId,
      signal: input.signal,
    });
  }

  public upsertProfile(
    input: GithubServerProfileInput,
  ): GithubServerProfileView {
    const parsed = validateGithubServerProfileInput(input);
    if (!parsed.ok) {
      throw new GithubServerServiceError(
        parsed.error.code,
        parsed.error.message,
        parsed.error.nextAction,
      );
    }
    const serverId = serverIdForOrigin(parsed.value.identity.webOrigin);
    const existing = this.options.repositories.getGithubServerProfile(serverId);
    const activeRef = existing?.auth?.activeRef;
    this.options.repositories.putGithubServer({
      serverId,
      host: parsed.value.identity.host,
      apiBaseUrl: parsed.value.identity.apiBaseUrl,
      ...(activeRef === undefined ? {} : { credentialRef: activeRef }),
      metadata: {
        displayName: parsed.value.displayName,
        kind: parsed.value.identity.kind,
        webOrigin: parsed.value.identity.webOrigin,
      },
      ...(input.expectedVersion === undefined
        ? {}
        : { expectedVersion: input.expectedVersion }),
    });
    if (existing?.auth === undefined)
      this.options.repositories.putGithubServerAuth({
        serverId,
        status: "UNVERIFIED",
        storeState: this.options.credentialStore.getStatus().state,
      });
    return this.toView(
      this.options.repositories.getGithubServerProfile(serverId) ??
        this.requireProfile(serverId),
    );
  }

  public async submitCredential(input: {
    readonly serverId: string;
    readonly value: string;
    readonly operationId: string;
    readonly signal?: AbortSignal;
  }): Promise<GithubCredentialOperationResult> {
    if (!isSafeOperationId(input.operationId))
      throw new GithubServerServiceError(
        "INVALID_SERVER_URL",
        "The credential operation identity is invalid.",
        "FIX_INPUT",
      );
    const profile = this.requireProfile(input.serverId);
    const existing = this.options.repositories.getGithubCredentialOperation(
      input.operationId,
    );
    if (existing !== undefined)
      return this.finishExistingOperation(existing, profile);
    const auth = this.authOrDefault(profile);
    const candidateRevision =
      Math.max(auth.activeRevision ?? 0, auth.candidateRevision ?? 0) + 1;
    const candidateRef = createOpaqueCredentialReference();
    const created = this.options.repositories.createGithubCredentialOperation({
      operationId: input.operationId,
      idempotencyKey: `github-auth:${profile.serverId}:${input.operationId}`,
      serverId: profile.serverId,
      profileVersion: profile.version,
      operationKind: "SAVE_AND_TEST",
      phase: "INTENT",
      candidateRef,
      candidateRevision,
      ...(auth.activeRef === undefined
        ? {}
        : { previousActiveRef: auth.activeRef }),
      ...(auth.activeRevision === undefined
        ? {}
        : { previousActiveRevision: auth.activeRevision }),
      endpointSnapshot: this.endpointSnapshot(profile),
      cleanupState: auth.activeRef === undefined ? "NOT_REQUIRED" : "PENDING",
    });
    if (created.phase === "COMPLETED")
      return this.finishExistingOperation(created, profile);
    this.options.repositories.putGithubServerAuth({
      serverId: profile.serverId,
      status: "TESTING",
      storeState: this.options.credentialStore.getStatus().state,
      activeRef: auth.activeRef,
      activeRevision: auth.activeRevision,
      candidateRef,
      candidateRevision,
      accountLogin: auth.accountLogin,
      accountName: auth.accountName,
      verifiedAt: auth.verifiedAt,
      lastTestAt: auth.lastTestAt,
      reason: null,
      expectedVersion: auth.version,
    });

    try {
      await this.options.credentialStore.createCandidate({
        reference: candidateRef,
        value: input.value,
        signal: input.signal,
      });
    } catch (error) {
      return this.failCandidateOperation(created, profile, error);
    }
    const stored = this.options.repositories.updateGithubCredentialOperation({
      operationId: created.operationId,
      expectedVersion: created.version,
      phase: "CANDIDATE_STORED",
    });
    return this.runCandidateTest(
      stored,
      this.requireProfile(profile.serverId),
      input.signal,
    );
  }

  public async testConnection(input: {
    readonly serverId: string;
    readonly operationId?: string;
    readonly signal?: AbortSignal;
  }): Promise<GithubCredentialOperationResult> {
    const profile = this.requireProfile(input.serverId);
    const auth = this.authOrDefault(profile);
    const id = input.operationId ?? operationId();
    const existing = this.options.repositories.getGithubCredentialOperation(id);
    if (existing !== undefined)
      return this.finishExistingOperation(existing, profile);
    const created = this.options.repositories.createGithubCredentialOperation({
      operationId: id,
      idempotencyKey: `github-test:${profile.serverId}:${id}`,
      serverId: profile.serverId,
      profileVersion: profile.version,
      operationKind: "TEST_CONNECTION",
      phase: "INTENT",
      ...(auth.activeRef === undefined
        ? {}
        : { previousActiveRef: auth.activeRef }),
      ...(auth.activeRevision === undefined
        ? {}
        : { previousActiveRevision: auth.activeRevision }),
      endpointSnapshot: this.endpointSnapshot(profile),
    });
    if (auth.activeRef === undefined || auth.activeRevision === undefined) {
      const missing = genericReason(
        "MISSING_ACCESS",
        "SECURE_STORAGE",
        "Add a protected GitHub access value before testing this server.",
        "REPLACE_ACCESS",
        id,
      );
      this.options.repositories.updateGithubCredentialOperation({
        operationId: created.operationId,
        expectedVersion: created.version,
        phase: "FAILED",
        reason: missing,
      });
      const current = this.authOrDefault(this.requireProfile(profile.serverId));
      this.options.repositories.putGithubServerAuth({
        serverId: profile.serverId,
        status: "UNVERIFIED",
        storeState: this.options.credentialStore.getStatus().state,
        reason: missing,
        expectedVersion: current.version,
      });
      return {
        operationId: id,
        profile: this.toView(this.requireProfile(profile.serverId)),
      };
    }
    this.options.repositories.putGithubServerAuth({
      serverId: profile.serverId,
      status: "TESTING",
      storeState: this.options.credentialStore.getStatus().state,
      activeRef: auth.activeRef,
      activeRevision: auth.activeRevision,
      candidateRef: auth.candidateRef,
      candidateRevision: auth.candidateRevision,
      accountLogin: auth.accountLogin,
      accountName: auth.accountName,
      verifiedAt: auth.verifiedAt,
      lastTestAt: auth.lastTestAt,
      reason: null,
      expectedVersion: auth.version,
    });
    const testing = this.options.repositories.updateGithubCredentialOperation({
      operationId: created.operationId,
      expectedVersion: created.version,
      phase: "TESTING",
    });
    return this.runActiveTest(
      testing,
      this.requireProfile(profile.serverId),
      input.signal,
    );
  }

  public async retryOperation(
    credentialOperationId: string,
  ): Promise<GithubCredentialOperationResult> {
    const operation = this.options.repositories.getGithubCredentialOperation(
      credentialOperationId,
    );
    if (operation === undefined)
      throw new GithubServerServiceError(
        "RECOVERY_REQUIRED",
        "The credential operation no longer exists; refresh the server settings.",
        "RETRY",
      );
    const profile = this.requireProfile(operation.serverId);
    if (operation.phase === "COMPLETED")
      return this.finishExistingOperation(operation, profile);
    if (operation.operationKind === "SAVE_AND_TEST") {
      if (
        operation.previousActiveRef !== undefined &&
        profile.auth?.activeRef === operation.candidateRef &&
        profile.auth?.candidateRef === undefined
      )
        return this.cleanupOperation(operation.operationId);
      if (operation.candidateRef === undefined) {
        return {
          operationId: operation.operationId,
          profile: this.toView(profile),
        };
      }
      const testing = this.options.repositories.updateGithubCredentialOperation(
        {
          operationId: operation.operationId,
          expectedVersion: operation.version,
          phase: "TESTING",
          reason: null,
        },
      );
      return this.runCandidateTest(testing, profile);
    }
    if (operation.operationKind === "TEST_CONNECTION") {
      const testing = this.options.repositories.updateGithubCredentialOperation(
        {
          operationId: operation.operationId,
          expectedVersion: operation.version,
          phase: "TESTING",
          reason: null,
        },
      );
      return this.runActiveTest(testing, profile);
    }
    return this.retryRemoval(operation, profile);
  }

  public async cleanupOperation(
    credentialOperationId: string,
  ): Promise<GithubCredentialOperationResult> {
    const operation = this.options.repositories.getGithubCredentialOperation(
      credentialOperationId,
    );
    if (operation === undefined)
      throw new GithubServerServiceError(
        "RECOVERY_REQUIRED",
        "The credential operation no longer exists; refresh the server settings.",
        "RETRY",
      );
    const profile = this.requireProfile(operation.serverId);
    const currentActiveRef = profile.auth?.activeRef;
    const targetReference =
      currentActiveRef === operation.candidateRef &&
      operation.previousActiveRef !== undefined
        ? operation.previousActiveRef
        : operation.candidateRef;
    if (targetReference === undefined)
      return {
        operationId: operation.operationId,
        profile: this.toView(profile),
      };
    const pending = this.options.repositories.updateGithubCredentialOperation({
      operationId: operation.operationId,
      expectedVersion: operation.version,
      phase: "CLEANUP_PENDING",
      cleanupState: "PENDING",
    });
    try {
      await this.options.credentialStore.cleanup({
        reference: targetReference,
      });
      const currentProfile = this.requireProfile(profile.serverId);
      const currentAuth = this.authOrDefault(currentProfile);
      if (targetReference === operation.candidateRef) {
        this.options.repositories.putGithubServerAuth({
          serverId: profile.serverId,
          status:
            currentAuth.activeRef === undefined ? "UNVERIFIED" : "VERIFIED",
          storeState: this.options.credentialStore.getStatus().state,
          activeRef: currentAuth.activeRef,
          activeRevision: currentAuth.activeRevision,
          candidateRef: null,
          candidateRevision: null,
          accountLogin: currentAuth.accountLogin,
          accountName: currentAuth.accountName,
          verifiedAt: currentAuth.verifiedAt,
          lastTestAt: currentAuth.lastTestAt,
          reason: null,
          expectedVersion: currentAuth.version,
        });
      } else {
        this.options.repositories.putGithubServerAuth({
          serverId: profile.serverId,
          status:
            currentAuth.activeRef === undefined ? "UNVERIFIED" : "VERIFIED",
          storeState: this.options.credentialStore.getStatus().state,
          activeRef: currentAuth.activeRef,
          activeRevision: currentAuth.activeRevision,
          candidateRef: currentAuth.candidateRef,
          candidateRevision: currentAuth.candidateRevision,
          accountLogin: currentAuth.accountLogin,
          accountName: currentAuth.accountName,
          verifiedAt: currentAuth.verifiedAt,
          lastTestAt: currentAuth.lastTestAt,
          reason: null,
          expectedVersion: currentAuth.version,
        });
      }
      this.options.repositories.updateGithubCredentialOperation({
        operationId: pending.operationId,
        expectedVersion: pending.version,
        phase: "COMPLETED",
        candidateRef: null,
        candidateRevision: null,
        cleanupState: "COMPLETED",
        reason: null,
      });
    } catch (error) {
      this.options.repositories.updateGithubCredentialOperation({
        operationId: pending.operationId,
        expectedVersion: pending.version,
        phase: "RECOVERY_REQUIRED",
        cleanupState: "RECOVERY_REQUIRED",
        reason: authReason(error, pending.operationId),
      });
    }
    return {
      operationId: operation.operationId,
      profile: this.toView(this.requireProfile(profile.serverId)),
    };
  }

  private async retryRemoval(
    operation: GithubCredentialOperationRecord,
    profile: GithubServerProfileRecord,
  ): Promise<GithubCredentialOperationResult> {
    if (operation.previousActiveRef === undefined)
      return this.removeProfile({ serverId: profile.serverId });
    const pending = this.options.repositories.updateGithubCredentialOperation({
      operationId: operation.operationId,
      expectedVersion: operation.version,
      phase: "CLEANUP_PENDING",
      cleanupState: "PENDING",
      reason: null,
    });
    try {
      await this.options.credentialStore.retire({
        reference: operation.previousActiveRef,
      });
      const current = this.requireProfile(profile.serverId);
      const auth = this.authOrDefault(current);
      this.options.repositories.putGithubServerAuth({
        serverId: profile.serverId,
        status: "REMOVED",
        storeState: this.options.credentialStore.getStatus().state,
        activeRef: null,
        activeRevision: null,
        candidateRef: null,
        candidateRevision: null,
        reason: null,
        expectedVersion: auth.version,
      });
      this.options.repositories.updateGithubCredentialOperation({
        operationId: pending.operationId,
        expectedVersion: pending.version,
        phase: "COMPLETED",
        cleanupState: "COMPLETED",
        reason: null,
      });
    } catch (error) {
      const failure = authReason(error, operation.operationId);
      this.options.repositories.updateGithubCredentialOperation({
        operationId: pending.operationId,
        expectedVersion: pending.version,
        phase: "RECOVERY_REQUIRED",
        cleanupState: "RECOVERY_REQUIRED",
        reason: failure,
      });
    }
    return {
      operationId: operation.operationId,
      profile: this.toView(this.requireProfile(profile.serverId)),
    };
  }

  public async removeProfile(input: {
    readonly serverId: string;
    readonly operationId?: string;
  }): Promise<GithubCredentialOperationResult> {
    const profile = this.requireProfile(input.serverId);
    const auth = this.authOrDefault(profile);
    const id = input.operationId ?? operationId();
    const existing = this.options.repositories.getGithubCredentialOperation(id);
    if (existing !== undefined)
      return this.finishExistingOperation(existing, profile);
    const created = this.options.repositories.createGithubCredentialOperation({
      operationId: id,
      idempotencyKey: `github-remove:${profile.serverId}:${id}`,
      serverId: profile.serverId,
      profileVersion: profile.version,
      operationKind: "REMOVE",
      phase: "INTENT",
      ...(auth.activeRef === undefined
        ? {}
        : { previousActiveRef: auth.activeRef }),
      ...(auth.activeRevision === undefined
        ? {}
        : { previousActiveRevision: auth.activeRevision }),
      endpointSnapshot: this.endpointSnapshot(profile),
    });
    if (auth.activeRef === undefined) {
      this.options.repositories.putGithubServerAuth({
        serverId: profile.serverId,
        status: "REMOVED",
        storeState: this.options.credentialStore.getStatus().state,
        activeRef: null,
        activeRevision: null,
        candidateRef: null,
        candidateRevision: null,
        reason: null,
        expectedVersion: auth.version,
      });
      this.options.repositories.updateGithubCredentialOperation({
        operationId: created.operationId,
        expectedVersion: created.version,
        phase: "COMPLETED",
        cleanupState: "COMPLETED",
      });
      return {
        operationId: id,
        profile: this.toView(this.requireProfile(profile.serverId)),
      };
    }
    const pending = this.options.repositories.updateGithubCredentialOperation({
      operationId: created.operationId,
      expectedVersion: created.version,
      phase: "CLEANUP_PENDING",
      cleanupState: "PENDING",
    });
    try {
      await this.options.credentialStore.retire({ reference: auth.activeRef });
      this.options.repositories.putGithubServerAuth({
        serverId: profile.serverId,
        status: "REMOVED",
        storeState: this.options.credentialStore.getStatus().state,
        activeRef: null,
        activeRevision: null,
        candidateRef: null,
        candidateRevision: null,
        reason: null,
        expectedVersion: auth.version,
      });
      this.options.repositories.updateGithubCredentialOperation({
        operationId: pending.operationId,
        expectedVersion: pending.version,
        phase: "COMPLETED",
        cleanupState: "COMPLETED",
      });
    } catch (error) {
      this.options.repositories.putGithubServerAuth({
        serverId: profile.serverId,
        status: "RECOVERY_REQUIRED",
        storeState: this.options.credentialStore.getStatus().state,
        activeRef: auth.activeRef,
        activeRevision: auth.activeRevision,
        candidateRef: auth.candidateRef,
        candidateRevision: auth.candidateRevision,
        reason: authReason(error, id),
        expectedVersion: auth.version,
      });
      this.options.repositories.updateGithubCredentialOperation({
        operationId: pending.operationId,
        expectedVersion: pending.version,
        phase: "RECOVERY_REQUIRED",
        cleanupState: "RECOVERY_REQUIRED",
        reason: authReason(error, id),
      });
    }
    return {
      operationId: id,
      profile: this.toView(this.requireProfile(profile.serverId)),
    };
  }

  private async runCandidateTest(
    operation: GithubCredentialOperationRecord,
    profile: GithubServerProfileRecord,
    signal?: AbortSignal,
  ): Promise<GithubCredentialOperationResult> {
    const testing =
      operation.phase === "TESTING"
        ? operation
        : this.options.repositories.updateGithubCredentialOperation({
            operationId: operation.operationId,
            expectedVersion: operation.version,
            phase: "TESTING",
          });
    const result = await testGithubConnection({
      profile,
      revisionKind: "CANDIDATE",
      operation: testing,
      broker: this.broker,
      transport: this.options.transport,
      clock: this.clock,
      correlationId: testing.operationId,
      signal,
      timeoutMs: this.options.connectionTimeoutMs,
    });
    if (!result.ok) {
      return this.recordTestFailure(testing, profile, result);
    }
    return this.activateCandidate(testing, profile, result);
  }

  private async runActiveTest(
    operation: GithubCredentialOperationRecord,
    profile: GithubServerProfileRecord,
    signal?: AbortSignal,
  ): Promise<GithubCredentialOperationResult> {
    const result = await testGithubConnection({
      profile,
      revisionKind: "ACTIVE",
      broker: this.broker,
      transport: this.options.transport,
      clock: this.clock,
      correlationId: operation.operationId,
      signal,
      timeoutMs: this.options.connectionTimeoutMs,
    });
    if (!result.ok) return this.recordTestFailure(operation, profile, result);
    const auth = this.authOrDefault(profile);
    this.options.repositories.putGithubServerAuth({
      serverId: profile.serverId,
      status: "VERIFIED",
      storeState: this.options.credentialStore.getStatus().state,
      activeRef: auth.activeRef,
      activeRevision: auth.activeRevision,
      candidateRef: auth.candidateRef,
      candidateRevision: auth.candidateRevision,
      accountLogin: result.account.login,
      accountName: result.account.name,
      verifiedAt: result.verifiedAt,
      lastTestAt: result.verifiedAt,
      reason: null,
      expectedVersion: auth.version,
    });
    this.options.repositories.updateGithubCredentialOperation({
      operationId: operation.operationId,
      expectedVersion: operation.version,
      phase: "COMPLETED",
      reason: null,
      testResult: {
        ...(result.account.login === undefined
          ? {}
          : { login: result.account.login }),
        ...(result.account.name === undefined
          ? {}
          : { name: result.account.name }),
        verifiedAt: result.verifiedAt,
      },
      cleanupState: "NOT_REQUIRED",
    });
    return {
      operationId: operation.operationId,
      profile: this.toView(this.requireProfile(profile.serverId)),
    };
  }

  private async activateCandidate(
    operation: GithubCredentialOperationRecord,
    profile: GithubServerProfileRecord,
    result: Extract<GithubConnectionTestResult, { readonly ok: true }>,
  ): Promise<GithubCredentialOperationResult> {
    if (
      operation.candidateRef === undefined ||
      operation.candidateRevision === undefined
    )
      return this.recordTestFailure(operation, profile, {
        ok: false,
        endpoint: profile.apiBaseUrl,
        reason: genericReason(
          "RECOVERY_REQUIRED",
          "RECOVERY",
          "The verified candidate reference was lost before activation.",
          "RETRY",
          operation.operationId,
        ),
      });
    const auth = this.authOrDefault(profile);
    const verified = this.options.repositories.updateGithubCredentialOperation({
      operationId: operation.operationId,
      expectedVersion: operation.version,
      phase: "VERIFIED",
      reason: null,
      testResult: {
        ...(result.account.login === undefined
          ? {}
          : { login: result.account.login }),
        ...(result.account.name === undefined
          ? {}
          : { name: result.account.name }),
        verifiedAt: result.verifiedAt,
      },
    });
    this.options.repositories.putGithubServerAuth({
      serverId: profile.serverId,
      status: "VERIFIED",
      storeState: this.options.credentialStore.getStatus().state,
      activeRef: operation.candidateRef,
      activeRevision: operation.candidateRevision,
      candidateRef: null,
      candidateRevision: null,
      accountLogin: result.account.login,
      accountName: result.account.name,
      verifiedAt: result.verifiedAt,
      lastTestAt: result.verifiedAt,
      reason: null,
      expectedVersion: auth.version,
    });
    const activated = this.options.repositories.updateGithubCredentialOperation(
      {
        operationId: verified.operationId,
        expectedVersion: verified.version,
        phase: "ACTIVATED",
        cleanupState:
          operation.previousActiveRef === undefined
            ? "NOT_REQUIRED"
            : "PENDING",
      },
    );
    if (operation.previousActiveRef !== undefined) {
      const pending = this.options.repositories.updateGithubCredentialOperation(
        {
          operationId: activated.operationId,
          expectedVersion: activated.version,
          phase: "CLEANUP_PENDING",
          cleanupState: "PENDING",
        },
      );
      try {
        await this.options.credentialStore.retire({
          reference: operation.previousActiveRef,
        });
        this.options.repositories.updateGithubCredentialOperation({
          operationId: pending.operationId,
          expectedVersion: pending.version,
          phase: "COMPLETED",
          cleanupState: "COMPLETED",
          reason: null,
        });
      } catch (error) {
        const cleanupReason = authReason(error, operation.operationId);
        this.options.repositories.putGithubServerAuth({
          serverId: profile.serverId,
          status: "VERIFIED",
          storeState: this.options.credentialStore.getStatus().state,
          activeRef: operation.candidateRef,
          activeRevision: operation.candidateRevision,
          accountLogin: result.account.login,
          accountName: result.account.name,
          verifiedAt: result.verifiedAt,
          lastTestAt: result.verifiedAt,
          reason: cleanupReason,
          expectedVersion: this.authOrDefault(
            this.requireProfile(profile.serverId),
          ).version,
        });
        this.options.repositories.updateGithubCredentialOperation({
          operationId: pending.operationId,
          expectedVersion: pending.version,
          phase: "RECOVERY_REQUIRED",
          cleanupState: "RECOVERY_REQUIRED",
          reason: cleanupReason,
        });
      }
    } else {
      this.options.repositories.updateGithubCredentialOperation({
        operationId: activated.operationId,
        expectedVersion: activated.version,
        phase: "COMPLETED",
        cleanupState: "NOT_REQUIRED",
        reason: null,
      });
    }
    return {
      operationId: operation.operationId,
      profile: this.toView(this.requireProfile(profile.serverId)),
    };
  }

  private recordTestFailure(
    operation: GithubCredentialOperationRecord,
    profile: GithubServerProfileRecord,
    result: Extract<GithubConnectionTestResult, { readonly ok: false }>,
  ): GithubCredentialOperationResult {
    const current = this.authOrDefault(profile);
    const phase =
      result.reason.code === "REQUEST_CANCELLED" ||
      result.reason.code === "REQUEST_TIMEOUT"
        ? "CANCELLED"
        : "FAILED";
    this.options.repositories.updateGithubCredentialOperation({
      operationId: operation.operationId,
      expectedVersion: operation.version,
      phase,
      reason: result.reason,
    });
    this.options.repositories.putGithubServerAuth({
      serverId: profile.serverId,
      status:
        operation.operationKind === "TEST_CONNECTION"
          ? "NEEDS_ATTENTION"
          : current.activeRef === undefined
            ? result.reason.category === "SECURE_STORAGE"
              ? "SECURE_STORAGE_UNAVAILABLE"
              : "NEEDS_ATTENTION"
            : "VERIFIED",
      storeState: this.options.credentialStore.getStatus().state,
      activeRef: current.activeRef,
      activeRevision: current.activeRevision,
      candidateRef: current.candidateRef,
      candidateRevision: current.candidateRevision,
      accountLogin: current.accountLogin,
      accountName: current.accountName,
      verifiedAt: current.verifiedAt,
      lastTestAt: this.clock.now(),
      reason: result.reason,
      expectedVersion: current.version,
    });
    return {
      operationId: operation.operationId,
      profile: this.toView(this.requireProfile(profile.serverId)),
    };
  }

  private failCandidateOperation(
    operation: GithubCredentialOperationRecord,
    profile: GithubServerProfileRecord,
    error: unknown,
  ): GithubCredentialOperationResult {
    const failure = authReason(error, operation.operationId);
    this.options.repositories.updateGithubCredentialOperation({
      operationId: operation.operationId,
      expectedVersion: operation.version,
      phase: "FAILED",
      reason: failure,
    });
    const currentProfile = this.requireProfile(profile.serverId);
    const auth = this.authOrDefault(currentProfile);
    this.options.repositories.putGithubServerAuth({
      serverId: profile.serverId,
      status:
        auth.activeRef === undefined
          ? failure.code === "STORE_UNAVAILABLE" ||
            failure.code === "STORE_WEAK" ||
            failure.code === "STORE_NOT_READY"
            ? "SECURE_STORAGE_UNAVAILABLE"
            : "NEEDS_ATTENTION"
          : "VERIFIED",
      storeState: this.options.credentialStore.getStatus().state,
      activeRef: auth.activeRef,
      activeRevision: auth.activeRevision,
      candidateRef: auth.candidateRef,
      candidateRevision: auth.candidateRevision,
      accountLogin: auth.accountLogin,
      accountName: auth.accountName,
      verifiedAt: auth.verifiedAt,
      lastTestAt: this.clock.now(),
      reason: failure,
      expectedVersion: auth.version,
    });
    return {
      operationId: operation.operationId,
      profile: this.toView(this.requireProfile(profile.serverId)),
    };
  }

  private finishExistingOperation(
    operation: GithubCredentialOperationRecord,
    profile: GithubServerProfileRecord,
  ): GithubCredentialOperationResult {
    return {
      operationId: operation.operationId,
      profile: this.toView(this.requireProfile(profile.serverId)),
    };
  }

  private endpointSnapshot(profile: GithubServerProfileRecord) {
    return {
      serverId: profile.serverId,
      kind: profile.kind,
      webOrigin: profile.webOrigin,
      apiBaseUrl: profile.apiBaseUrl,
      profileVersion: profile.version,
    } as const;
  }

  private authOrDefault(
    profile: GithubServerProfileRecord,
  ): GithubServerAuthRecord {
    return (
      profile.auth ?? {
        serverId: profile.serverId,
        status: "UNVERIFIED",
        storeState: this.options.credentialStore.getStatus().state,
        version: 0,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      }
    );
  }

  private requireProfile(serverId: string): GithubServerProfileRecord {
    const profile = this.options.repositories.getGithubServerProfile(serverId);
    if (profile === undefined)
      throw new GithubServerServiceError(
        "PROFILE_REMOVED",
        "The GitHub server profile is no longer available.",
        "RETRY",
      );
    return profile;
  }

  private toView(profile: GithubServerProfileRecord): GithubServerProfileView {
    const auth = this.authOrDefault(profile);
    const storeStatus = this.options.credentialStore.getStatus();
    let status = auth.status;
    if (
      storeStatus.state !== "AVAILABLE" &&
      auth.activeRef === undefined &&
      auth.status !== "REMOVED"
    )
      status = "SECURE_STORAGE_UNAVAILABLE";
    return {
      schemaVersion: 1,
      id: profile.serverId,
      displayName: profile.displayName,
      kind: profile.kind,
      webOrigin: profile.webOrigin,
      apiBaseUrl: profile.apiBaseUrl,
      host: profile.host,
      status,
      version: profile.version,
      ...(auth.activeRevision === undefined
        ? {}
        : { activeRevision: auth.activeRevision }),
      ...(auth.candidateRevision === undefined
        ? {}
        : { candidateRevision: auth.candidateRevision }),
      ...(auth.accountLogin === undefined
        ? {}
        : { accountLogin: auth.accountLogin }),
      ...(auth.accountName === undefined
        ? {}
        : { accountName: auth.accountName }),
      ...(auth.verifiedAt === undefined ? {} : { verifiedAt: auth.verifiedAt }),
      ...(auth.lastTestAt === undefined ? {} : { lastTestAt: auth.lastTestAt }),
      ...(auth.reason === undefined ? {} : { reason: auth.reason }),
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }
}

export class GithubServerServiceError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly nextAction: string,
  ) {
    super(message);
    this.name = "GithubServerServiceError";
  }
}
