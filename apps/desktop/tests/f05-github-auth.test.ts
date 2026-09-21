import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeGithubServerUrl } from "../src/shared/github-server";
import { parseIpcRequest, parseIpcResponse } from "../src/shared/ipc";
import {
  FetchGithubHttpTransport,
  type GithubHttpRequest,
  type GithubHttpResponse,
  type GithubHttpTransport,
} from "../src/main/github-connection-test";
import { GithubServerService } from "../src/main/github-server-service";
import { InMemorySecureCredentialStore } from "../src/main/secure-credential-store";
import {
  createPersistenceRepositories,
  initializePersistence,
  type PersistenceStore,
} from "../src/main/persistence";

const FIXED_TIME = "2026-09-20T00:00:00.000Z";

class FakeGithubTransport implements GithubHttpTransport {
  public readonly requests: GithubHttpRequest[] = [];
  public response: GithubHttpResponse = {
    status: 200,
    headers: {},
    body: JSON.stringify({ login: "octocat", name: "Octo" }),
    url: "https://api.github.com/user",
  };

  public async request(request: GithubHttpRequest): Promise<GithubHttpResponse> {
    this.requests.push({ ...request, headers: { ...request.headers } });
    return this.response;
  }
}

async function createService(options: {
  readonly store?: InMemorySecureCredentialStore;
  readonly transport?: FakeGithubTransport;
} = {}): Promise<{
  readonly service: GithubServerService;
  readonly transport: FakeGithubTransport;
  readonly store: InMemorySecureCredentialStore;
  readonly persistence: PersistenceStore;
  readonly cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "prmonitor-f05-test-"));
  const persistence = await initializePersistence(
    {
      databasePath: path.join(root, "database", "prmonitor.sqlite"),
      backupRoot: path.join(root, "backups"),
    },
    { clock: { now: () => FIXED_TIME } },
  );
  const transport = options.transport ?? new FakeGithubTransport();
  const store = options.store ?? new InMemorySecureCredentialStore();
  const service = new GithubServerService({
    repositories: createPersistenceRepositories(persistence, {
      clock: { now: () => FIXED_TIME },
    }),
    credentialStore: store,
    transport,
    clock: { now: () => FIXED_TIME },
    connectionTimeoutMs: 2_000,
  });
  return {
    service,
    transport,
    store,
    persistence,
    cleanup: async () => {
      persistence.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

describe("F05 GitHub server identity", () => {
  it("canonicalizes GitHub.com and GHES origins and rejects unsafe input", () => {
    expect(normalizeGithubServerUrl("https://github.com/")).toMatchObject({
      ok: true,
      value: {
        kind: "GITHUB_COM",
        webOrigin: "https://github.com",
        apiBaseUrl: "https://api.github.com",
      },
    });
    expect(normalizeGithubServerUrl("https://GHEs.example.test/")).toMatchObject({
      ok: true,
      value: {
        kind: "GHES",
        webOrigin: "https://ghes.example.test",
        apiBaseUrl: "https://ghes.example.test/api/v3",
      },
    });
    for (const value of [
      "http://github.com",
      "https://user:pass@github.com",
      "https://github.com/org",
      "https://github.com?token=secret",
      "https://github.com#fragment",
      "not a URL",
    ]) {
      expect(normalizeGithubServerUrl(value), value).toMatchObject({ ok: false });
    }
  });
});

describe("F05 secure GitHub authentication lifecycle", () => {
  it("persists intent, verifies through a read-only request, and exposes no secret in safe state", async () => {
    const fixture = await createService();
    try {
      const profile = fixture.service.upsertProfile({
        displayName: "GitHub.com",
        serverUrl: "https://github.com",
      });
      expect(profile.status).toBe("UNVERIFIED");
      const result = await fixture.service.submitCredential({
        serverId: profile.id,
        value: "synthetic-access-value",
        operationId: "request-save-1",
      });
      expect(result.profile.status).toBe("VERIFIED");
      expect(result.profile.accountLogin).toBe("octocat");
      expect(fixture.transport.requests[0]).toMatchObject({
        method: "GET",
        url: "https://api.github.com/user",
        headers: { Authorization: "Bearer synthetic-access-value" },
      });
      const settings = fixture.service.readSettings();
      const serialized = JSON.stringify(settings);
      expect(serialized).not.toContain("synthetic-access-value");
      expect(serialized).not.toContain("prmonitor.github.v1.");
      expect(
        fixture.persistence.readAll("SELECT * FROM github_servers"),
      ).not.toContainEqual(expect.objectContaining({ metadata_json: expect.stringContaining("synthetic-access-value") }));
      expect(
        fixture.persistence.readAll("SELECT * FROM github_credential_operations"),
      ).not.toContainEqual(expect.objectContaining({ reason_json: expect.stringContaining("synthetic-access-value") }));
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps the active value usable when a replacement fails", async () => {
    const fixture = await createService();
    try {
      const profile = fixture.service.upsertProfile({
        displayName: "GitHub.com",
        serverUrl: "https://github.com",
      });
      const first = await fixture.service.submitCredential({
        serverId: profile.id,
        value: "first-access-value",
        operationId: "request-first",
      });
      expect(first.profile.activeRevision).toBe(1);
      fixture.transport.response = {
        status: 401,
        headers: {},
        body: "not persisted",
        url: "https://api.github.com/user",
      };
      const failed = await fixture.service.submitCredential({
        serverId: profile.id,
        value: "replacement-access-value",
        operationId: "request-replacement",
      });
      expect(failed.profile.status).toBe("VERIFIED");
      expect(failed.profile.activeRevision).toBe(1);
      expect(failed.profile.candidateRevision).toBe(2);
      const settings = fixture.service.readSettings();
      expect(settings.operations.some((operation) => operation.phase === "FAILED")).toBe(true);
      expect(JSON.stringify(settings)).not.toContain("replacement-access-value");
    } finally {
      await fixture.cleanup();
    }
  });

  it("fails closed for unavailable secure storage and cross-origin responses", async () => {
    const unavailable = new InMemorySecureCredentialStore({
      state: "UNAVAILABLE",
      reason: {
        code: "STORE_UNAVAILABLE",
        category: "SECURE_STORAGE",
        message: "Synthetic secure storage is unavailable.",
      },
    });
    const unavailableFixture = await createService({ store: unavailable });
    try {
      const profile = unavailableFixture.service.upsertProfile({
        displayName: "Unavailable",
        serverUrl: "https://github.com",
      });
      const result = await unavailableFixture.service.submitCredential({
        serverId: profile.id,
        value: "never-plaintext-fallback",
        operationId: "request-unavailable",
      });
      expect(result.profile.status).toBe("SECURE_STORAGE_UNAVAILABLE");
      expect(JSON.stringify(unavailableFixture.service.readSettings())).not.toContain(
        "never-plaintext-fallback",
      );
    } finally {
      await unavailableFixture.cleanup();
    }

    const transport = new FakeGithubTransport();
    transport.response = {
      status: 200,
      headers: {},
      body: JSON.stringify({ login: "evil" }),
      url: "https://evil.example/user",
    };
    const fixture = await createService({ transport });
    try {
      const profile = fixture.service.upsertProfile({
        displayName: "Redirect test",
        serverUrl: "https://github.com",
      });
      const result = await fixture.service.submitCredential({
        serverId: profile.id,
        value: "synthetic-access-value",
        operationId: "request-cross-origin",
      });
      expect(result.profile.status).toBe("NEEDS_ATTENTION");
      expect(result.profile.reason?.code).toBe("CROSS_ORIGIN_REDIRECT");
    } finally {
      await fixture.cleanup();
    }
  });
});

describe("F05 IPC secret boundary", () => {
  it("allows only the dedicated submission and never echoes it in a response", () => {
    const request = parseIpcRequest({
      schemaVersion: 1,
      requestId: "request-secret",
      type: "github.credential.submit",
      payload: { serverId: "github-server-abc", token: "synthetic-token" },
    });
    expect(request.ok).toBe(true);
    expect(
      parseIpcRequest({
        schemaVersion: 1,
        requestId: "request-generic",
        type: "app.read-current-state",
        payload: { token: "synthetic-token" },
      }).ok,
    ).toBe(false);
    const response = {
      schemaVersion: 1,
      requestId: "request-secret",
      ok: true,
      value: {
        kind: "github-operation",
        operationId: "request-secret",
        profile: {
          schemaVersion: 1,
          id: "github-server-abc",
          displayName: "GitHub.com",
          kind: "GITHUB_COM",
          webOrigin: "https://github.com",
          apiBaseUrl: "https://api.github.com",
          host: "github.com",
          status: "VERIFIED",
          version: 1,
          activeRevision: 1,
          createdAt: FIXED_TIME,
          updatedAt: FIXED_TIME,
        },
      },
    } as const;
    expect(parseIpcResponse(response)).toBe(true);
    expect(JSON.stringify(response)).not.toContain("synthetic-token");
  });

  it("uses a bounded read-only transport shape", async () => {
    const requests: RequestInit[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input, init) => {
      requests.push(init ?? {});
      return new Response(JSON.stringify({ login: "octocat" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const transport = new FetchGithubHttpTransport();
      const controller = new AbortController();
      const response = await transport.request({
        method: "GET",
        url: "https://api.github.com/user",
        headers: { Authorization: "Bearer synthetic-token" },
        signal: controller.signal,
      });
      expect(response.status).toBe(200);
      expect(requests[0]).toMatchObject({ method: "GET", redirect: "manual" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
