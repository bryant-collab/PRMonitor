import { describe, expect, it } from "vitest";
import {
  F29_THREAT_MODEL_ENTRIES,
  createF29ControlledEnvironment,
  createF29SecurityReason,
  evaluateF29Capability,
  evaluateF29EffectAdmission,
  f29ContainsSecretShape,
  f29PathWithin,
  parseF29OpenTarget,
  parseF29PullRequestUrl,
  parseF29SecurityReason,
  prepareF29GitInvocation,
  projectF29SafeValue,
  redactF29Text,
  validateF29OwnedPath,
  validateF29PathSyntax,
  validateF29ThreatModel,
  type F29PolicySnapshot,
} from "../src/shared/f29-security";
import { F29SecurityService } from "../src/main/f29-security-service";

describe("F29 security contracts", () => {
  it("keeps the threat model complete and versioned", () => {
    expect(F29_THREAT_MODEL_ENTRIES).toHaveLength(10);
    expect(validateF29ThreatModel()).toMatchObject({ ok: true });
  });

  it("redacts known and shaped secrets before diagnostics cross a boundary", () => {
    const result = redactF29Text(
      'Authorization: Bearer bearer-secret password="password-secret" token=known-secret',
      { knownSecrets: ["known-secret", "bearer-secret", "password-secret"] },
    );
    expect(result).toMatchObject({ ok: true, redacted: true });
    if (!result.ok) return;
    expect(result.text).not.toContain("known-secret");
    expect(result.text).not.toContain("password-secret");
    expect(result.text).toContain("[REDACTED]");
    expect(f29ContainsSecretShape("token=known-secret")).toBe(true);
  });

  it("rejects raw SDK objects and preserves only bounded safe projections", () => {
    const sdkLike = Object.create({ invoke() {} }) as { token: string };
    sdkLike.token = "never-persist";
    expect(projectF29SafeValue(sdkLike).ok).toBe(false);
    const safe = projectF29SafeValue({ status: "failed", token: "secret" });
    expect(safe).toMatchObject({ ok: true });
    if (!safe.ok) return;
    expect(JSON.stringify(safe.value)).not.toContain("secret");
    expect(JSON.stringify(safe.value)).not.toContain('"token"');
  });

  it("round-trips safe reasons and rejects secret-bearing evidence", () => {
    const reason = createF29SecurityReason({
      code: "PATH_OUTSIDE_OPERATION",
      boundary: "filesystem_worktree",
      operationId: "operation-1",
      what: "The requested target is outside the operation worktree.",
      why: "The path owner could not be proven.",
      nextAction: "RECONCILE",
      retryable: false,
      evidenceRefs: ["CT-F29-04"],
      safeEvidence: { expectedType: "file" },
    });
    expect(reason).toMatchObject({ ok: true });
    if (!reason.ok) return;
    expect(parseF29SecurityReason(reason.value)).toMatchObject({ ok: true });
    expect(
      createF29SecurityReason({
        ...reason.value,
        safeEvidence: { token: "secret" },
      }).ok,
    ).toBe(false);
  });

  it("accepts only configured HTTPS pull-request identity and view-only routes", () => {
    const parsed = parseF29PullRequestUrl(
      "https://github.example.invalid/acme/monitor/pull/42",
      "https://github.example.invalid",
    );
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    expect(parsed.value.identity).toBe(
      "https://github.example.invalid:repo:acme/monitor#42",
    );
    expect(
      parseF29PullRequestUrl(
        "https://github.example.invalid/acme/monitor/pull/42?token=secret",
        "https://github.example.invalid",
      ).ok,
    ).toBe(false);
    expect(
      parseF29PullRequestUrl(
        "https://evil.example/acme/monitor/pull/42",
        "https://github.example.invalid",
      ).ok,
    ).toBe(false);
    expect(
      parseF29OpenTarget("prmonitor://review-bundle/bundle-1"),
    ).toMatchObject({
      ok: true,
    });
  });

  it("blocks traversal, UNC/device paths, stale ownership, and protected targets", () => {
    expect(
      validateF29PathSyntax("C:\\worktrees\\operation\\file.ts", {
        platform: "win32",
      }).ok,
    ).toBe(true);
    expect(
      validateF29PathSyntax("C:relative\\file.ts", { platform: "win32" }).ok,
    ).toBe(false);
    expect(
      validateF29PathSyntax("\\\\server\\share\\file.ts", {
        platform: "win32",
      }).ok,
    ).toBe(false);
    expect(
      f29PathWithin("C:\\Worktrees\\Op", "c:\\worktrees\\op\\file.ts", "win32"),
    ).toBe(true);
    expect(
      validateF29OwnedPath({
        operationId: "operation-1",
        ownerOperationId: "operation-1",
        operationRoot: "C:\\Worktrees\\Op",
        canonicalPath: "C:\\Developer\\repo\\file.ts",
        expectedType: "file",
        actualType: "file",
        developerClonePath: "C:\\Developer\\repo",
        platform: "win32",
      }).ok,
    ).toBe(false);
    expect(
      validateF29OwnedPath({
        operationId: "operation-1",
        ownerOperationId: "operation-2",
        operationRoot: "C:\\Worktrees\\Op",
        canonicalPath: "C:\\Worktrees\\Op\\file.ts",
        expectedType: "file",
        actualType: "file",
        platform: "win32",
      }).ok,
    ).toBe(false);
  });

  it("constructs no-shell Git invocations and rejects force or control injection", () => {
    const valid = prepareF29GitInvocation({
      operationId: "operation-1",
      repositoryIdentity: "github:repo:acme/monitor",
      cwd: "C:\\Worktrees\\Op",
      args: ["status", "--porcelain=v1"],
      expectedShas: ["0123456789abcdef0123456789abcdef01234567"],
      platform: "win32",
    });
    expect(valid).toMatchObject({ ok: true });
    if (!valid.ok) return;
    expect(valid.value.shell).toBe(false);
    expect(
      prepareF29GitInvocation({
        operationId: "operation-1",
        repositoryIdentity: "github:repo:acme/monitor",
        cwd: "C:\\Worktrees\\Op",
        args: ["push", "--force"],
        platform: "win32",
      }).ok,
    ).toBe(false);
    expect(
      prepareF29GitInvocation({
        operationId: "operation-1",
        repositoryIdentity: "github:repo:acme/monitor",
        cwd: "C:\\Worktrees\\Op",
        args: ["status\u0000"],
        platform: "win32",
      }).ok,
    ).toBe(false);
  });

  it("keeps child environments explicit and rejects credential-shaped values", () => {
    const environment = createF29ControlledEnvironment({
      source: {
        PATH: "C:\\tools",
        NODE_ENV: "test",
        GITHUB_TOKEN: "synthetic",
        UNRELATED: "dropped",
      },
    });
    expect(environment).toMatchObject({ ok: false });
    const bounded = createF29ControlledEnvironment({
      source: { PATH: "C:\\tools", NODE_ENV: "test", UNRELATED: "dropped" },
    });
    expect(bounded).toMatchObject({ ok: true, value: { PATH: "C:\\tools" } });
    if (bounded.ok) expect(bounded.value.UNRELATED).toBeUndefined();
  });

  it("fails closed when provider policy or publication authority would broaden", () => {
    const policy: F29PolicySnapshot = {
      taskType: "REVIEW_REVISION",
      interactionMode: "worktree_write",
      sandboxMode: "workspace-write",
      networkAccess: "disabled",
      approvalPolicy: "on-request",
      controlledEnvironment: true,
      writableRoot: "C:\\Worktrees\\Op",
      publicationAuthority: false,
      snapshotHash: "policy-1",
    };
    expect(
      evaluateF29Capability({
        operationId: "operation-1",
        worktreeOperationId: "operation-1",
        policy,
        requestedNetworkAccess: "enabled",
      }).ok,
    ).toBe(false);
    expect(
      evaluateF29Capability({
        operationId: "operation-1",
        worktreeOperationId: "operation-1",
        policy,
        requestedPublicationAuthority: true,
      }).ok,
    ).toBe(false);
    expect(
      evaluateF29EffectAdmission({
        operationId: "operation-1",
        expectedOperationId: "operation-1",
        actor: "provider",
        ownerService: "review_publication",
        humanApproval: true,
        persistedIntent: true,
        freshState: true,
      }).ok,
    ).toBe(false);
    expect(
      evaluateF29EffectAdmission({
        operationId: "operation-1",
        expectedOperationId: "operation-1",
        actor: "main_service",
        ownerService: "review_publication",
        humanApproval: true,
        persistedIntent: true,
        freshState: true,
        forceRequested: true,
      }).ok,
    ).toBe(false);
  });
});

describe("F29 main-process hardening", () => {
  it("admits only app-data SQLite and preserves safe IPC rejection", () => {
    const service = new F29SecurityService({
      applicationDataRoot: "C:\\Users\\test\\AppData\\Roaming\\PRMonitor",
      platform: "win32",
    });
    expect(
      service.validateDatabasePath({
        databasePath:
          "C:\\Users\\test\\AppData\\Roaming\\PRMonitor\\database\\prmonitor.sqlite",
      }).ok,
    ).toBe(true);
    expect(
      service.validateDatabasePath({
        databasePath: "C:\\worktrees\\prmonitor.sqlite",
      }).ok,
    ).toBe(false);
    const request = {
      schemaVersion: 1 as const,
      requestId: "request-1",
      type: "app.read-current-state" as const,
      payload: {},
    };
    expect(
      service.authorizeRequest({
        request,
        senderId: 4,
        sessionId: "renderer-1",
      }),
    ).toMatchObject({ ok: true });
    expect(
      service.authorizeRequest({
        request,
        senderId: -1,
        sessionId: "renderer-1",
      }),
    ).toMatchObject({ ok: false, error: { code: "SECURITY_BLOCKED" } });
  });

  it("revalidates the canonical target immediately before an OS open", async () => {
    const fs = {
      realpath: async (value: string) => value,
      lstat: async (value: string) => ({
        isFile: () => value.endsWith(".ts"),
        isDirectory: () => !value.endsWith(".ts"),
        isSymbolicLink: () => false,
      }),
    };
    const guarded = await new F29SecurityService({
      platform: "posix",
      fileSystem: fs,
    }).resolveOwnedPath({
      operationId: "operation-1",
      ownerOperationId: "operation-1",
      operationRoot: "/tmp/worktrees/operation-1",
      targetPath: "/tmp/worktrees/operation-1/src/index.ts",
      expectedType: "file",
    });
    expect(guarded).toMatchObject({ ok: true });
  });
});
