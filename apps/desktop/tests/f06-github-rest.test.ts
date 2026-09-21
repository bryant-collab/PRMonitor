import { describe, expect, it } from "vitest";
import { normalizeGithubServerUrl } from "../src/shared/github-server";
import { MAX_GITHUB_RESPONSE_BYTES } from "../src/shared/github-rest";
import {
  GithubRequestCapability,
  type GithubCredentialBroker,
} from "../src/main/github-credential-broker";
import {
  GithubRestClient,
  GithubRestTransportError,
  createGithubBranchRefIdentity,
  createGithubFeedbackScope,
  createGithubPullRequestIdentity,
  createGithubResponseTarget,
  parseGithubPullRequestUrl,
  type GithubRestHttpRequest,
  type GithubRestHttpResponse,
  type GithubRestTransport,
} from "../src/main/github-rest-client";
import type { GithubServerProfileRecord } from "../src/main/persistence/repositories";

const TIME = "2026-09-20T12:00:00.000Z";

function profileFor(
  serverUrl = "https://github.com",
): GithubServerProfileRecord {
  const identity = normalizeGithubServerUrl(serverUrl);
  if (!identity.ok) throw new Error("test server identity");
  return {
    id: "profile-github",
    schemaVersion: 1,
    version: 1,
    createdAt: TIME,
    updatedAt: TIME,
    payload: {},
    payloadHash: "fixture",
    serverId: "server-github",
    host: identity.value.host,
    apiBaseUrl: identity.value.apiBaseUrl,
    kind: identity.value.kind,
    webOrigin: identity.value.webOrigin,
    displayName: "Fixture GitHub",
  };
}

class FakeTransport implements GithubRestTransport {
  public readonly requests: GithubRestHttpRequest[] = [];
  public readonly responses: Array<GithubRestHttpResponse | Error> = [];

  public async request(
    request: GithubRestHttpRequest,
  ): Promise<GithubRestHttpResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response === undefined) throw new Error("fixture response missing");
    if (response instanceof Error) throw response;
    return {
      ...response,
      url: response.url || request.url,
    };
  }
}

function fixtureBroker(): GithubCredentialBroker {
  return {
    withVerifiedCapability: async ({ profile, correlationId, consumer }) =>
      consumer(
        new GithubRequestCapability(
          profile.serverId,
          profile.apiBaseUrl,
          1,
          correlationId,
          "fixture-access",
        ),
      ),
    withCandidateCapability: async ({ profile, correlationId, consumer }) =>
      consumer(
        new GithubRequestCapability(
          profile.serverId,
          profile.apiBaseUrl,
          1,
          correlationId,
          "fixture-access",
        ),
      ),
  };
}

function response(
  body: unknown,
  status = 200,
  headers: Record<string, string> = { "content-type": "application/json" },
): GithubRestHttpResponse {
  return {
    status,
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
    url: "",
  };
}

function client(
  transport: FakeTransport,
  profile = profileFor(),
): GithubRestClient {
  return new GithubRestClient({
    profile,
    broker: fixtureBroker(),
    transport,
    clock: { now: () => TIME },
  });
}

function pullRequest() {
  const parsed = parseGithubPullRequestUrl(
    "https://github.com/Acme/Widget/pull/42",
    profileFor(),
  );
  if (!parsed.ok) throw new Error(parsed.message);
  return createGithubPullRequestIdentity({
    server: parsed.value.server,
    owner: parsed.value.owner,
    repositoryName: parsed.value.repositoryName,
    number: parsed.value.number,
  });
}

describe("F06 URL and remote identity contracts", () => {
  it("canonicalizes supported GitHub.com and GHES URLs without collisions", () => {
    const github = profileFor();
    const first = parseGithubPullRequestUrl(
      "https://GITHUB.com/Acme/Widget/pull/42",
      github,
    );
    const second = parseGithubPullRequestUrl(
      "https://github.com/Acme/Widget/pull/42/",
      github,
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value.pullRequestKey).toBe(second.value.pullRequestKey);
      expect(first.value.normalizedUrl).toBe(
        "https://github.com/Acme/Widget/pull/42",
      );
    }

    const ghes = profileFor("https://ghe.example.test");
    const enterprise = parseGithubPullRequestUrl(
      "https://ghe.example.test/Acme/Widget/pull/42",
      ghes,
    );
    expect(enterprise.ok).toBe(true);
    if (enterprise.ok)
      expect(enterprise.value.server.apiBaseUrl).toBe(
        "https://ghe.example.test/api/v3",
      );
  });

  it.each([
    "http://github.com/Acme/Widget/pull/42",
    "https://github.com/Acme/Widget/pull/0",
    "https://github.com/Acme/Widget/pull/not-a-number",
    "https://github.com/Acme/Widget/pull/42?file=x",
    "https://github.com/Acme/Widget/pull/42#fragment",
    "https://github.com/Acme/%2FWidget/pull/42",
    "https://github.com/Acme/../Widget/pull/42",
    "https://other.example/Acme/Widget/pull/42",
  ])("rejects ambiguous or unsafe PR URL %s", (value) => {
    expect(parseGithubPullRequestUrl(value, profileFor()).ok).toBe(false);
  });
});

describe("F06 typed PR, repository, and ref resources", () => {
  it("preserves fork identities and keeps default_branch informational", async () => {
    const transport = new FakeTransport();
    transport.responses.push(
      response({
        number: 42,
        state: "open",
        merged: false,
        title: "Fixture PR",
        base: {
          ref: "release",
          sha: "base-sha",
          repo: {
            id: 10,
            name: "Widget",
            default_branch: "main",
            owner: { login: "Acme" },
          },
        },
        head: {
          ref: "release",
          sha: "head-sha",
          repo: {
            id: 20,
            name: "Widget",
            owner: { login: "Contributor" },
          },
        },
      }),
    );
    const result = await client(transport).getPullRequest({
      identity: pullRequest(),
      correlationId: "f06-pr",
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.outcome === "UPDATED") {
      expect(result.value.baseRepository.key).not.toBe(
        result.value.headRepository.key,
      );
      expect(result.value.baseBranch).toBe("release");
      expect(result.value.defaultBranch).toBe("main");
      expect(result.value.baseBranch).not.toBe(result.value.defaultBranch);
    }
    expect(transport.requests[0]).toMatchObject({
      method: "GET",
      url: "https://api.github.com/repos/Acme/Widget/pulls/42",
    });
  });

  it("requires the exact repository for a same-named branch", async () => {
    const transport = new FakeTransport();
    transport.responses.push(response({ object: { sha: "branch-sha" } }));
    const pr = pullRequest();
    const ref = createGithubBranchRefIdentity({
      repository: pr.repository,
      name: "release",
    });
    const result = await client(transport).getBranchRef({ ref });
    expect(result.ok).toBe(true);
    expect(transport.requests[0]?.url).toContain(
      "/repos/Acme/Widget/git/ref/heads/release",
    );
    expect(ref.repository.key).toContain(":repo:acme/widget");
  });

  it("maps an unavailable deleted head repository without falling back", async () => {
    const transport = new FakeTransport();
    transport.responses.push(
      response({
        number: 42,
        state: "closed",
        base: {
          ref: "main",
          sha: "base-sha",
          repo: {
            id: 10,
            name: "Widget",
            default_branch: "main",
            owner: { login: "Acme" },
          },
        },
        head: { ref: "feature", sha: "head-sha", repo: null },
      }),
    );
    const result = await client(transport).getPullRequest({
      identity: pullRequest(),
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.outcome === "UPDATED") {
      expect(result.value.headRepository.available).toBe(false);
      if (!result.value.headRepository.available)
        expect(result.value.headRepository.reason).toBe("DELETED");
    }
  });
});

describe("F06 independent feedback resources", () => {
  it("keeps conditional metadata independent and traverses bounded Link pages", async () => {
    const transport = new FakeTransport();
    const pr = pullRequest();
    const scope = createGithubFeedbackScope({
      pullRequest: pr,
      resource: "issue_comments",
    });
    transport.responses.push(
      response(
        [
          {
            id: 1,
            body: "first",
            user: { login: "reviewer" },
            created_at: TIME,
          },
        ],
        200,
        {
          "content-type": "application/json",
          etag: "comments-page-1",
          link: '<https://api.github.com/repos/Acme/Widget/issues/42/comments?page=2&per_page=100>; rel="next"',
        },
      ),
      response(
        [
          {
            id: 2,
            body: "second",
            user: { login: "reviewer" },
            updated_at: TIME,
          },
        ],
        200,
        { "content-type": "application/json", etag: "comments-page-2" },
      ),
    );
    const result = await client(transport).getFeedbackCollection({
      scope,
      conditional: { etag: "old-comments" },
      correlationId: "f06-comments",
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.outcome === "UPDATED") {
      expect(result.value.items.map((item) => item.identity.remoteId)).toEqual([
        "1",
        "2",
      ]);
      expect(result.value.items[1]?.updatedAt).toBe(TIME);
      expect(result.value.checkpoint.complete).toBe(true);
    }
    expect(transport.requests[0]?.headers["if-none-match"]).toBe(
      "old-comments",
    );
    expect(transport.requests[1]?.headers["if-none-match"]).toBeUndefined();
    expect(transport.requests[1]?.url).toContain("page=2");
  });

  it("returns 304 only for the requested resource", async () => {
    const transport = new FakeTransport();
    const pr = pullRequest();
    transport.responses.push(
      response("", 304, { etag: "pr-current" }),
      response([{ id: 3, body: "changed", user: { login: "reviewer" } }]),
    );
    const prResult = await client(transport).getPullRequest({
      identity: pr,
      conditional: { etag: "pr-old" },
    });
    const comments = await client(transport).getFeedbackPage({
      scope: createGithubFeedbackScope({
        pullRequest: pr,
        resource: "review_comments",
      }),
      conditional: { etag: "comments-old" },
    });
    expect(prResult).toMatchObject({ ok: true, outcome: "NOT_MODIFIED" });
    expect(comments).toMatchObject({ ok: true, outcome: "UPDATED" });
    expect(transport.requests[0]?.headers["if-none-match"]).toBe("pr-old");
    expect(transport.requests[1]?.headers["if-none-match"]).toBe(
      "comments-old",
    );
  });

  it("does not report malformed pagination as complete", async () => {
    const transport = new FakeTransport();
    const pr = pullRequest();
    transport.responses.push(
      response([{ id: 1, body: "first" }], 200, {
        "content-type": "application/json",
        link: '<https://evil.example/other?page=2>; rel="next"',
      }),
    );
    const result = await client(transport).getFeedbackCollection({
      scope: createGithubFeedbackScope({
        pullRequest: pr,
        resource: "reviews",
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.code).toBe("PAGINATION_INCOMPLETE");
  });
});

describe("F06 errors and response boundary", () => {
  it("fails closed for cancellation, redirects, malformed content, and oversized bodies", async () => {
    const cancelledTransport = new FakeTransport();
    const cancelledClient = client(cancelledTransport);
    const controller = new AbortController();
    controller.abort();
    const cancelled = await cancelledClient.getRepository({
      repository: pullRequest().repository,
      signal: controller.signal,
    });
    expect(cancelled).toMatchObject({
      ok: false,
      reason: { code: "REQUEST_CANCELLED" },
    });
    expect(cancelledTransport.requests).toHaveLength(0);

    const redirectTransport = new FakeTransport();
    redirectTransport.responses.push(
      response("", 302, { location: "https://evil.example/redirect" }),
    );
    const redirect = await client(redirectTransport).getRepository({
      repository: pullRequest().repository,
    });
    expect(redirect).toMatchObject({
      ok: false,
      reason: { code: "CROSS_ORIGIN_REDIRECT" },
    });

    const malformedTransport = new FakeTransport();
    malformedTransport.responses.push(
      response("<html>", 200, { "content-type": "text/html" }),
    );
    const malformed = await client(malformedTransport).getRepository({
      repository: pullRequest().repository,
    });
    expect(malformed).toMatchObject({
      ok: false,
      reason: { code: "PROTOCOL_ERROR" },
    });

    const oversizedTransport = new FakeTransport();
    oversizedTransport.responses.push(
      response("x".repeat(MAX_GITHUB_RESPONSE_BYTES + 1)),
    );
    const oversized = await client(oversizedTransport).getRepository({
      repository: pullRequest().repository,
    });
    expect(oversized).toMatchObject({
      ok: false,
      reason: { code: "RESPONSE_TOO_LARGE" },
    });
  });

  it("preserves duplicate pages and edited records without timestamps for F10 hashing", async () => {
    const transport = new FakeTransport();
    const scope = createGithubFeedbackScope({
      pullRequest: pullRequest(),
      resource: "reviews",
    });
    transport.responses.push(
      response(
        [{ id: 8, body: "same semantic content", user: { login: "reviewer" } }],
        200,
        {
          "content-type": "application/json",
          link: '<https://api.github.com/repos/Acme/Widget/pulls/42/reviews?page=2>; rel="next"',
        },
      ),
      response([
        { id: 8, body: "same semantic content", user: { login: "reviewer" } },
      ]),
    );
    const result = await client(transport).getFeedbackCollection({ scope });
    expect(result.ok).toBe(true);
    if (result.ok && result.outcome === "UPDATED") {
      expect(result.value.items).toHaveLength(2);
      expect(result.value.items[0]?.semanticInput).not.toHaveProperty(
        "createdAt",
      );
      expect(result.value.items[0]?.identity.key).toBe(
        result.value.items[1]?.identity.key,
      );
    }
  });

  it("normalizes rate limits without exposing response content", async () => {
    const transport = new FakeTransport();
    transport.responses.push(
      response("synthetic private body", 429, {
        "content-type": "application/json",
        "retry-after": "3",
        "x-ratelimit-reset": "1890000000",
      }),
    );
    const result = await client(transport).getRepository({
      repository: pullRequest().repository,
      correlationId: "f06-rate-limit",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.category).toBe("RATE_LIMIT");
      expect(result.reason.retryAfterMs).toBe(3_000);
      expect(result.reason.message).not.toContain("synthetic");
    }
  });

  it("normalizes authentication and permission failures without transport detail", async () => {
    const transport = new FakeTransport();
    transport.responses.push(response("secret-shaped server detail", 401));
    const authentication = await client(transport).getRepository({
      repository: pullRequest().repository,
    });
    expect(authentication).toMatchObject({
      ok: false,
      reason: { category: "AUTHENTICATION" },
    });
    if (!authentication.ok)
      expect(authentication.reason.message).not.toContain("secret-shaped");

    transport.responses.push(
      response("permission detail", 403, { "x-ratelimit-remaining": "0" }),
    );
    const rateLimited = await client(transport).getRepository({
      repository: pullRequest().repository,
    });
    expect(rateLimited).toMatchObject({
      ok: false,
      reason: { category: "RATE_LIMIT" },
    });
  });

  it("requires explicit approval context and never auto-retries an uncertain post", async () => {
    const transport = new FakeTransport();
    const pr = pullRequest();
    const target = createGithubResponseTarget({
      pullRequest: pr,
      source: "ISSUE_COMMENT",
      commentId: "99",
    });
    const api = client(transport);
    const missingApproval = await api.responses.postIssueComment({
      target,
      body: "reply",
      publication: {
        approvalId: "",
        ownerId: "review-bundle-1",
        approvedAt: TIME,
        reviewedSnapshotHash: "snapshot",
      },
    });
    expect(missingApproval.ok).toBe(false);
    expect(transport.requests).toHaveLength(0);

    transport.responses.push(
      new GithubRestTransportError("REQUEST_FAILED", "network after send"),
    );
    const uncertain = await api.responses.postIssueComment({
      target,
      body: "reply",
      publication: {
        approvalId: "approval-1",
        ownerId: "review-bundle-1",
        approvedAt: TIME,
        reviewedSnapshotHash: "snapshot",
      },
    });
    expect(uncertain).toMatchObject({ ok: false, outcome: "UNCERTAIN" });
    expect(transport.requests).toHaveLength(1);
  });

  it("posts only the exact typed response target and validates the remote id", async () => {
    const transport = new FakeTransport();
    transport.responses.push(response({ id: 123, created_at: TIME }));
    const pr = pullRequest();
    const target = createGithubResponseTarget({
      pullRequest: pr,
      source: "REVIEW_COMMENT_REPLY",
      commentId: "7",
    });
    const result = await client(transport).responses.postReviewCommentReply({
      target,
      body: "addressed",
      publication: {
        approvalId: "approval-1",
        ownerId: "review-bundle-1",
        approvedAt: TIME,
        reviewedSnapshotHash: "snapshot",
      },
    });
    expect(result.ok).toBe(true);
    expect(transport.requests[0]).toMatchObject({
      method: "POST",
      url: "https://api.github.com/repos/Acme/Widget/pulls/42/comments/7/replies",
    });
    expect(JSON.parse(transport.requests[0]?.body ?? "{}")).toEqual({
      body: "addressed",
    });
  });

  it("exercises the Add PR, watcher, synchronization, and publication handoffs", async () => {
    const transport = new FakeTransport();
    const profile = profileFor();
    const parsed = parseGithubPullRequestUrl(
      "https://github.com/Acme/Widget/pull/42",
      profile,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const identity = createGithubPullRequestIdentity({
      server: parsed.value.server,
      owner: parsed.value.owner,
      repositoryName: parsed.value.repositoryName,
      number: parsed.value.number,
    });
    const metadata = {
      number: 42,
      state: "open",
      merged: false,
      base: {
        ref: "release",
        sha: "base-sha",
        repo: {
          id: 10,
          name: "Widget",
          default_branch: "main",
          owner: { login: "Acme" },
        },
      },
      head: {
        ref: "feature",
        sha: "head-sha",
        repo: { id: 11, name: "Widget", owner: { login: "Acme" } },
      },
    };
    transport.responses.push(
      response(metadata),
      response("", 304, { etag: "pr-current" }),
      response([{ id: 1, body: "inline" }]),
      response([{ id: 2, body: "review" }]),
      response([{ id: 3, body: "issue" }]),
      response({ object: { sha: "source-sha" } }),
      response(metadata),
      response({ id: 4, created_at: TIME }),
    );
    const api = client(transport, profile);
    const added = await api.getPullRequest({
      identity,
      correlationId: "f07-add",
    });
    expect(added).toMatchObject({ ok: true, outcome: "UPDATED" });
    const prNotChanged = await api.getPullRequest({
      identity,
      conditional: { etag: "pr-old" },
      correlationId: "f10-pr",
    });
    expect(prNotChanged).toMatchObject({ ok: true, outcome: "NOT_MODIFIED" });
    for (const resource of [
      "review_comments",
      "reviews",
      "issue_comments",
    ] as const) {
      const feedback = await api.getFeedbackPage({
        scope: createGithubFeedbackScope({ pullRequest: identity, resource }),
        correlationId: `f10-${resource}`,
      });
      expect(feedback.ok).toBe(true);
    }
    const sourceRef = createGithubBranchRefIdentity({
      repository: identity.repository,
      name: "release",
    });
    const source = await api.getBranchRef({
      ref: sourceRef,
      correlationId: "f24-source",
    });
    expect(source).toMatchObject({ ok: true, outcome: "UPDATED" });
    const state = await api.verifyPullRequestState({
      identity,
      expectation: { expectedHeadSha: "head-sha", expectedBaseSha: "base-sha" },
      correlationId: "f27-state",
    });
    expect(state).toMatchObject({
      ok: true,
      outcome: "UPDATED",
      value: { matches: true },
    });
    const posted = await api.responses.postIssueComment({
      target: createGithubResponseTarget({
        pullRequest: identity,
        source: "ISSUE_COMMENT",
        commentId: "3",
      }),
      body: "approved response",
      publication: {
        approvalId: "approval-f23",
        ownerId: "bundle-f23",
        approvedAt: TIME,
        reviewedSnapshotHash: "snapshot-f23",
      },
    });
    expect(posted).toMatchObject({
      ok: true,
      outcome: "UPDATED",
      value: { remoteId: "4" },
    });
    expect(transport.requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "GET",
      "GET",
      "GET",
      "GET",
      "GET",
      "POST",
    ]);
  });
});
