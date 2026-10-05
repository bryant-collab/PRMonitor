import type { ManagedPrReadModel } from "../../src/shared/managed-pr";
const server = {
  kind: "GITHUB_COM" as const,
  webOrigin: "https://github.com",
  apiBaseUrl: "https://api.github.com",
  host: "github.com",
  serverKey: "github.com",
};

function repository(owner: string, name: string) {
  return {
    schemaVersion: 1 as const,
    server,
    owner,
    name,
    key: `github:github.com/${owner}/${name}`,
    available: true as const,
  };
}

export function managedPrFixture(
  id: string,
  primaryState: ManagedPrReadModel["primaryState"],
  updatedAt: string,
  owner = "owner",
): ManagedPrReadModel {
  const base = repository(owner, "base");
  const head = repository("contributor", `${id}-fork`);
  return {
    schemaVersion: 1,
    id,
    canonicalUrl: `https://github.com/${owner}/base/pull/${id.length}`,
    pullRequestKey: `${base.key}#${id.length}`,
    serverId: "server-1",
    owner,
    repositoryName: "base",
    number: id.length,
    state: "OPEN",
    merged: false,
    title: `${id} title`,
    baseRepository: base,
    headRepository: head,
    prBaseBranch: "main",
    prHeadBranch: `feature/${id}`,
    prBaseSha: "a".repeat(40),
    prHeadSha: "b".repeat(40),
    primaryState,
    localSetupStatus: "LOCAL_CLONE_REQUIRED",
    configuration: {
      revisionId: `config-${id}`,
      revision: 1,
      context: null,
      syncSourceBranchOverride: null,
      contentHash: "a".repeat(64),
      source: "ADD_PR",
      createdAt: updatedAt,
    },
    version: 1,
    createdAt: updatedAt,
    updatedAt,
  };
}
