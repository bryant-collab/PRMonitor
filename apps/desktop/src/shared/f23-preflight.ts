import { z } from "zod";
import {
  f22RemoteRepositoryEqual,
  type F22ActionGate,
} from "./f22-discard-reevaluation";

/**
 * F23 owns publication authority.  This is only the typed preflight that F23
 * consumes from F22; a true result proves current F22 evidence, never an
 * approval, commit, push, or response capability.
 */
export const f23F22PublicationPreflightSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("F23_F22_PUBLICATION_PREFLIGHT"),
    f22SafeForPublication: z.boolean(),
    publicationAuthorized: z.literal(false),
    reasonCode: z.string().min(1).max(128),
    gateRevision: z.number().int().nonnegative(),
    exactRemoteIdentity: z.boolean(),
    exactRemoteRefs: z.boolean(),
    expectedHeadSha: z.string().min(1).max(256),
    observedHeadSha: z.string().min(1).max(256).optional(),
    observationRevision: z.number().int().nonnegative().optional(),
  })
  .strict();

export type F23F22PublicationPreflight = z.infer<
  typeof f23F22PublicationPreflightSchema
>;

export interface F23PublicationPreflightOptions {
  /** The opaque observation returned by the action-time F22 remote read. */
  readonly freshRemoteObservation?: {
    readonly token: string;
    readonly observationRevision: number;
    readonly observedAt: string;
  };
  /** Override the wall clock in deterministic tests. */
  readonly now?: string;
  /** F22's bounded freshness window, in milliseconds. */
  readonly maxRemoteAgeMs?: number;
}

function exactRemoteIdentity(gate: F22ActionGate): boolean {
  const observed = gate.remote.observedIdentity;
  return (
    observed !== undefined &&
    observed.serverId === gate.remote.identity.serverId &&
    observed.repositoryKey === gate.remote.identity.repositoryKey &&
    observed.pullRequestKey === gate.remote.identity.pullRequestKey
  );
}

function exactRemoteRefs(gate: F22ActionGate): boolean {
  const expectedBaseRepository = gate.remote.expectedBaseRepository;
  const expectedHeadRepository = gate.remote.expectedHeadRepository;
  const observedBaseRepository = gate.remote.observedBaseRepository;
  const observedHeadRepository = gate.remote.observedHeadRepository;
  return (
    gate.remote.expectedBaseSha !== undefined &&
    gate.remote.observedBaseSha === gate.remote.expectedBaseSha &&
    expectedBaseRepository !== undefined &&
    expectedHeadRepository !== undefined &&
    f22RemoteRepositoryEqual(expectedBaseRepository, observedBaseRepository) &&
    f22RemoteRepositoryEqual(expectedHeadRepository, observedHeadRepository) &&
    gate.remote.expectedBaseBranch !== undefined &&
    gate.remote.expectedBaseBranch === gate.remote.observedBaseBranch &&
    gate.remote.expectedHeadBranch !== undefined &&
    gate.remote.expectedHeadBranch === gate.remote.observedHeadBranch
  );
}

function freshObservationMatches(
  gate: F22ActionGate,
  observation: F23PublicationPreflightOptions["freshRemoteObservation"],
  now: string,
  maxRemoteAgeMs: number,
): boolean {
  if (
    observation === undefined ||
    gate.remote.observationToken !== observation.token ||
    gate.remote.observationRevision !== observation.observationRevision ||
    gate.remote.observedAt !== observation.observedAt
  )
    return false;
  const age = Date.parse(now) - Date.parse(observation.observedAt);
  return (
    Number.isFinite(age) && age >= -maxRemoteAgeMs && age <= maxRemoteAgeMs
  );
}

export function f23PublicationPreflightFromF22(
  gate: F22ActionGate,
  options: F23PublicationPreflightOptions,
): F23F22PublicationPreflight {
  const identityVerified = exactRemoteIdentity(gate);
  const refsVerified = exactRemoteRefs(gate);
  const headVerified =
    gate.remote.observedHeadSha === gate.remote.expectedHeadSha;
  const freshObservationVerified = freshObservationMatches(
    gate,
    options.freshRemoteObservation,
    options.now ?? new Date().toISOString(),
    options.maxRemoteAgeMs ?? 5 * 60 * 1_000,
  );
  const f22SafeForPublication =
    gate.status === "CURRENT" &&
    gate.underlyingState !== "WORKING" &&
    gate.remote.observationRevision !== undefined &&
    identityVerified &&
    refsVerified &&
    headVerified &&
    freshObservationVerified &&
    gate.actions.publication === false;
  return f23F22PublicationPreflightSchema.parse({
    schemaVersion: 1,
    kind: "F23_F22_PUBLICATION_PREFLIGHT",
    f22SafeForPublication,
    publicationAuthorized: false,
    reasonCode: f22SafeForPublication
      ? "F22_EVIDENCE_CURRENT"
      : (gate.reason?.code ?? "F22_PUBLICATION_RECHECK_REQUIRED"),
    gateRevision: gate.gateRevision,
    exactRemoteIdentity: identityVerified,
    exactRemoteRefs: refsVerified,
    expectedHeadSha: gate.remote.expectedHeadSha,
    ...(gate.remote.observedHeadSha === undefined
      ? {}
      : { observedHeadSha: gate.remote.observedHeadSha }),
    ...(gate.remote.observationRevision === undefined
      ? {}
      : { observationRevision: gate.remote.observationRevision }),
  });
}
