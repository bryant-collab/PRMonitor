import type { F23ResponsePublisher } from "./f23-release-service";
import type { F23CandidateResponse } from "../shared/f23-release";
import {
  createGithubFeedbackScope,
  createGithubPullRequestIdentity,
  createGithubResponseTarget,
} from "./github-rest-client";
import type { GithubServerService } from "./github-server-service";

function profileServer(profile: {
  readonly kind: "GITHUB_COM" | "GHES";
  readonly webOrigin: string;
  readonly apiBaseUrl: string;
  readonly host: string;
}) {
  return {
    kind: profile.kind,
    webOrigin: profile.webOrigin,
    apiBaseUrl: profile.apiBaseUrl,
    host: profile.host,
  } as const;
}

function responseTarget(
  response: F23CandidateResponse,
  server: ReturnType<typeof profileServer>,
) {
  const pullRequest = createGithubPullRequestIdentity({
    server,
    owner: response.target.owner,
    repositoryName: response.target.repositoryName,
    number: response.target.pullRequestNumber,
  });
  return createGithubResponseTarget({
    pullRequest,
    source: response.target.source,
    commentId: response.target.commentId,
  });
}

function mapResult(result: {
  readonly ok: boolean;
  readonly outcome: string;
  readonly value?: { readonly remoteId: string };
}): {
  readonly outcome: "CONFIRMED" | "UNCERTAIN" | "FAILED";
  readonly remoteId?: string;
  readonly reason?: string;
} {
  if (result.ok && result.outcome === "UPDATED" && result.value !== undefined)
    return { outcome: "CONFIRMED", remoteId: result.value.remoteId };
  return {
    outcome: result.outcome === "UNCERTAIN" ? "UNCERTAIN" : "FAILED",
    reason: result.outcome,
  };
}

export function createF23GithubResponsePublisher(
  service: GithubServerService,
): F23ResponsePublisher {
  const context = (response: F23CandidateResponse) => {
    const profile = service.getVerifiedProfile(response.target.serverId);
    if (profile === undefined) return undefined;
    const server = profileServer(profile);
    const target = responseTarget(response, server);
    return {
      profile,
      server,
      target,
      client: service.getPublicationClient(response.target.serverId),
    };
  };
  return {
    postResponse: async (input) => {
      const resolved = context(input.response);
      if (resolved?.client === undefined || resolved.profile === undefined)
        return { outcome: "FAILED", reason: "GITHUB_PROFILE_UNAVAILABLE" };
      const publication = {
        approvalId: input.approvalId,
        ownerId: input.ownerId,
        approvedAt: input.approvedAt,
        reviewedSnapshotHash: input.response.bodyHash,
      };
      const result =
        input.response.target.source === "ISSUE_COMMENT"
          ? await resolved.client.responses.postIssueComment({
              target: resolved.target,
              body: input.response.body,
              publication,
            })
          : await resolved.client.responses.postReviewCommentReply({
              target: resolved.target,
              body: input.response.body,
              publication,
            });
      return mapResult(result);
    },
    reconcileResponse: async (input) => {
      const resolved = context(input.response);
      if (resolved?.client === undefined || resolved.profile === undefined)
        return { outcome: "UNKNOWN", reason: "GITHUB_PROFILE_UNAVAILABLE" };
      const scope = createGithubFeedbackScope({
        pullRequest: resolved.target.pullRequest,
        resource:
          input.response.target.source === "ISSUE_COMMENT"
            ? "issue_comments"
            : "review_comments",
      });
      const result = await resolved.client.getFeedbackCollection({
        profile: resolved.profile,
        serverId: input.response.target.serverId,
        scope,
        correlationId: `f23-response-reconcile-${input.response.responseKey}`,
      });
      if (!result.ok) return { outcome: "UNKNOWN", reason: result.outcome };
      if (result.outcome === "NOT_MODIFIED")
        return { outcome: "UNKNOWN", reason: "FEEDBACK_NOT_MODIFIED" };
      const matches = result.value.items.filter(
        (item) => item.body === input.response.body,
      );
      if (matches.length !== 1)
        return {
          outcome: matches.length === 0 ? "ABSENT" : "UNKNOWN",
          reason:
            matches.length > 1 ? "MULTIPLE_MATCHING_RESPONSES" : undefined,
        };
      return {
        outcome: "CONFIRMED",
        remoteId: matches[0]?.identity.remoteId,
      };
    },
  };
}
