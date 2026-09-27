import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  GithubReasonCode,
  GithubReasonCategory,
  GithubSecureStoreState,
} from "../shared/github-server";

export const MAX_GITHUB_CREDENTIAL_BYTES = 4_096;

export interface SecureStoreReason {
  readonly code: Extract<
    GithubReasonCode,
    | "STORE_UNAVAILABLE"
    | "STORE_WEAK"
    | "STORE_NOT_READY"
    | "STORE_WRITE_FAILED"
    | "STORE_READ_FAILED"
    | "STORE_RETIRE_FAILED"
    | "STORE_CLEANUP_FAILED"
  >;
  readonly category: Extract<GithubReasonCategory, "SECURE_STORAGE">;
  readonly message: string;
}

export interface SecureStoreStatus {
  readonly state: GithubSecureStoreState;
  readonly reason?: SecureStoreReason;
}

export class SecureCredentialStoreError extends Error {
  public constructor(
    public readonly reason: SecureStoreReason,
    options?: ErrorOptions,
  ) {
    super(reason.message, options);
    this.name = "SecureCredentialStoreError";
  }
}

export interface SecureCredentialStore {
  getStatus(): SecureStoreStatus;
  createCandidate(input: {
    readonly reference: string;
    readonly value: string;
    readonly signal?: AbortSignal;
  }): Promise<void>;
  readForRequest(input: {
    readonly reference: string;
    readonly signal?: AbortSignal;
  }): Promise<string>;
  retire(input: {
    readonly reference: string;
    readonly signal?: AbortSignal;
  }): Promise<void>;
  cleanup(input: {
    readonly reference: string;
    readonly signal?: AbortSignal;
  }): Promise<void>;
}

export interface ElectronSafeStorageLike {
  readonly isEncryptionAvailable: () => boolean;
  readonly encryptStringAsync?: (value: string) => Promise<Buffer>;
  readonly decryptStringAsync?: (
    value: Buffer,
  ) => Promise<{ readonly result: string; readonly shouldReEncrypt: boolean }>;
  readonly encryptString?: (value: string) => Buffer;
  readonly decryptString?: (value: Buffer) => string;
  readonly getSelectedStorageBackend?: () => string;
}

const REFERENCE_PATTERN = /^prmonitor\.github\.v1\.[0-9a-f-]{16,80}$/u;

function abortIfRequested(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new SecureCredentialStoreError({
      code: "STORE_WRITE_FAILED",
      category: "SECURE_STORAGE",
      message: "Secure storage work was cancelled before it completed.",
    });
  }
}

function validateReference(reference: string): void {
  if (!REFERENCE_PATTERN.test(reference)) {
    throw new SecureCredentialStoreError({
      code: "STORE_WRITE_FAILED",
      category: "SECURE_STORAGE",
      message: "The protected credential reference is invalid.",
    });
  }
}

function validateValue(value: string): void {
  if (
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > MAX_GITHUB_CREDENTIAL_BYTES ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  ) {
    throw new SecureCredentialStoreError({
      code: "STORE_WRITE_FAILED",
      category: "SECURE_STORAGE",
      message:
        "The protected access value is empty or exceeds the bounded input limit.",
    });
  }
}

function unavailableStatus(
  storage: ElectronSafeStorageLike,
): SecureStoreStatus {
  let encryptionAvailable: boolean;
  try {
    encryptionAvailable = storage.isEncryptionAvailable();
  } catch {
    return {
      state: "UNAVAILABLE",
      reason: {
        code: "STORE_UNAVAILABLE",
        category: "SECURE_STORAGE",
        message:
          "The host secure-storage service could not be queried. Enable it and retry.",
      },
    };
  }
  if (!encryptionAvailable) {
    const backend = storage.getSelectedStorageBackend?.();
    const notReady = backend === "unknown" || backend === undefined;
    return {
      state: notReady ? "NOT_READY" : "UNAVAILABLE",
      reason: {
        code: notReady ? "STORE_NOT_READY" : "STORE_UNAVAILABLE",
        category: "SECURE_STORAGE",
        message: notReady
          ? "The host secure-storage service is not ready yet. Retry after application startup completes."
          : "The host secure-storage service is unavailable. Enable it and retry.",
      },
    };
  }
  if (storage.getSelectedStorageBackend?.() === "basic_text") {
    return {
      state: "WEAK",
      reason: {
        code: "STORE_WEAK",
        category: "SECURE_STORAGE",
        message:
          "The host secure-storage backend is not strong enough for GitHub access values.",
      },
    };
  }
  return { state: "AVAILABLE" };
}

export function createOpaqueCredentialReference(): string {
  return `prmonitor.github.v1.${randomUUID()}`;
}

export class ElectronSecureCredentialStore implements SecureCredentialStore {
  public constructor(
    private readonly rootDirectory: string,
    private readonly storage: ElectronSafeStorageLike,
  ) {}

  public getStatus(): SecureStoreStatus {
    return unavailableStatus(this.storage);
  }

  public async createCandidate(input: {
    readonly reference: string;
    readonly value: string;
    readonly signal?: AbortSignal;
  }): Promise<void> {
    validateReference(input.reference);
    validateValue(input.value);
    abortIfRequested(input.signal);
    const status = this.getStatus();
    if (status.state !== "AVAILABLE") {
      throw new SecureCredentialStoreError(
        status.reason ?? {
          code: "STORE_UNAVAILABLE",
          category: "SECURE_STORAGE",
          message: "The host secure-storage service is unavailable.",
        },
      );
    }
    try {
      await mkdir(this.rootDirectory, { recursive: true });
      abortIfRequested(input.signal);
      const encrypted = this.storage.encryptStringAsync
        ? await this.storage.encryptStringAsync(input.value)
        : this.storage.encryptString?.(input.value);
      if (encrypted === undefined || encrypted.byteLength === 0)
        throw new Error("empty protected value");
      const target = this.fileFor(input.reference);
      const temporary = `${target}.${randomUUID()}.pending`;
      try {
        await writeFile(temporary, encrypted, { flag: "wx" });
        await rename(temporary, target).catch(async (error: unknown) => {
          // Replaying the same operation is idempotent. A pre-existing target
          // is treated as the already-created candidate; a different failure
          // remains an uncertain store write for the coordinator to reconcile.
          if ((error as NodeJS.ErrnoException).code === "EEXIST") return;
          throw error;
        });
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
    } catch (error) {
      if (error instanceof SecureCredentialStoreError) throw error;
      throw new SecureCredentialStoreError(
        {
          code: "STORE_WRITE_FAILED",
          category: "SECURE_STORAGE",
          message:
            "The protected access value could not be stored. Retry without using plaintext fallback.",
        },
        { cause: error },
      );
    }
  }

  public async readForRequest(input: {
    readonly reference: string;
    readonly signal?: AbortSignal;
  }): Promise<string> {
    validateReference(input.reference);
    abortIfRequested(input.signal);
    const status = this.getStatus();
    if (status.state !== "AVAILABLE") {
      throw new SecureCredentialStoreError(
        status.reason ?? {
          code: "STORE_UNAVAILABLE",
          category: "SECURE_STORAGE",
          message: "The host secure-storage service is unavailable.",
        },
      );
    }
    try {
      const encrypted = await readFile(this.fileFor(input.reference));
      abortIfRequested(input.signal);
      const result = this.storage.decryptStringAsync
        ? (await this.storage.decryptStringAsync(encrypted)).result
        : this.storage.decryptString?.(encrypted);
      if (result === undefined) throw new Error("decryption unavailable");
      validateValue(result);
      return result;
    } catch (error) {
      if (error instanceof SecureCredentialStoreError) {
        throw new SecureCredentialStoreError(
          {
            code: "STORE_READ_FAILED",
            category: "SECURE_STORAGE",
            message:
              "The protected access value could not be recovered. Replace it and retry.",
          },
          { cause: error },
        );
      }
      throw new SecureCredentialStoreError(
        {
          code: "STORE_READ_FAILED",
          category: "SECURE_STORAGE",
          message:
            "The protected access value could not be recovered. Replace it and retry.",
        },
        { cause: error },
      );
    }
  }

  public async retire(input: {
    readonly reference: string;
    readonly signal?: AbortSignal;
  }): Promise<void> {
    await this.remove(input, "STORE_RETIRE_FAILED");
  }

  public async cleanup(input: {
    readonly reference: string;
    readonly signal?: AbortSignal;
  }): Promise<void> {
    await this.remove(input, "STORE_CLEANUP_FAILED");
  }

  private async remove(
    input: { readonly reference: string; readonly signal?: AbortSignal },
    code: "STORE_RETIRE_FAILED" | "STORE_CLEANUP_FAILED",
  ): Promise<void> {
    validateReference(input.reference);
    abortIfRequested(input.signal);
    try {
      await unlink(this.fileFor(input.reference));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new SecureCredentialStoreError(
        {
          code,
          category: "SECURE_STORAGE",
          message:
            code === "STORE_RETIRE_FAILED"
              ? "The previous protected access value could not be retired; cleanup remains required."
              : "The pending protected access value could not be cleaned up; retry is required.",
        },
        { cause: error },
      );
    }
  }

  private fileFor(reference: string): string {
    return path.join(this.rootDirectory, `${reference}.bin`);
  }
}

export class InMemorySecureCredentialStore implements SecureCredentialStore {
  private readonly values = new Map<string, string>();

  public constructor(
    private readonly status: SecureStoreStatus = { state: "AVAILABLE" },
  ) {}

  public getStatus(): SecureStoreStatus {
    return this.status;
  }

  public async createCandidate(input: {
    readonly reference: string;
    readonly value: string;
    readonly signal?: AbortSignal;
  }): Promise<void> {
    validateReference(input.reference);
    validateValue(input.value);
    abortIfRequested(input.signal);
    this.assertAvailable();
    if (!this.values.has(input.reference))
      this.values.set(input.reference, input.value);
  }

  public async readForRequest(input: {
    readonly reference: string;
    readonly signal?: AbortSignal;
  }): Promise<string> {
    validateReference(input.reference);
    abortIfRequested(input.signal);
    this.assertAvailable();
    const value = this.values.get(input.reference);
    if (value === undefined)
      throw new SecureCredentialStoreError({
        code: "STORE_READ_FAILED",
        category: "SECURE_STORAGE",
        message:
          "The protected access value could not be recovered. Replace it and retry.",
      });
    return value;
  }

  public async retire(input: {
    readonly reference: string;
    readonly signal?: AbortSignal;
  }): Promise<void> {
    await this.remove(input, "STORE_RETIRE_FAILED");
  }

  public async cleanup(input: {
    readonly reference: string;
    readonly signal?: AbortSignal;
  }): Promise<void> {
    await this.remove(input, "STORE_CLEANUP_FAILED");
  }

  public has(reference: string): boolean {
    return this.values.has(reference);
  }

  private async remove(
    input: { readonly reference: string; readonly signal?: AbortSignal },
    code: "STORE_RETIRE_FAILED" | "STORE_CLEANUP_FAILED",
  ): Promise<void> {
    validateReference(input.reference);
    abortIfRequested(input.signal);
    this.assertAvailable();
    this.values.delete(input.reference);
    void code;
  }

  private assertAvailable(): void {
    if (this.status.state !== "AVAILABLE") {
      throw new SecureCredentialStoreError(
        this.status.reason ?? {
          code: "STORE_UNAVAILABLE",
          category: "SECURE_STORAGE",
          message: "The host secure-storage service is unavailable.",
        },
      );
    }
  }
}
