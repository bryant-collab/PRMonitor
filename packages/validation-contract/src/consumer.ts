import type { ValidationSnapshot, CreateValidationSnapshotInput } from "./snapshot.js";
import { createValidationSnapshot } from "./snapshot.js";
import { resolveValidationProfile, type ResolveValidationInput, type ValidationResolution } from "./trust.js";
import {
  aggregateValidationEvidence,
  type AggregateValidationEvidenceInput,
  type ValidationAggregate,
  validateRunAgainstSnapshot,
} from "./evidence.js";
import {
  prepareCommand,
  type PrepareCommandInput,
  type PrepareCommandResult,
} from "./execution.js";
import { captureStreams, type CapturedStreams } from "./output.js";
import type { ValidationRunEvidence } from "./evidence.js";

export type ValidationConsumerKind = "review" | "synchronization";

export interface ValidationConsumer {
  readonly kind: ValidationConsumerKind;
  resolveProfile(input: ResolveValidationInput): ValidationResolution;
  createSnapshot(input: CreateValidationSnapshotInput): Readonly<ValidationSnapshot>;
  prepareCommand(input: PrepareCommandInput): PrepareCommandResult;
  captureStreams(input: Parameters<typeof captureStreams>[0]): CapturedStreams;
  aggregateEvidence(input: AggregateValidationEvidenceInput): ValidationAggregate;
  validateRunAgainstSnapshot(
    run: ValidationRunEvidence,
    snapshot: ValidationSnapshot,
  ): ReturnType<typeof validateRunAgainstSnapshot>;
}

/**
 * Review preparation and branch synchronization deliberately share this exact
 * contract surface. The kind is descriptive for activity/audit consumers; it
 * never changes source, trust, path, timeout, redaction, or aggregation rules.
 */
export function createValidationConsumer(kind: ValidationConsumerKind): ValidationConsumer {
  return {
    kind,
    resolveProfile: resolveValidationProfile,
    createSnapshot: createValidationSnapshot,
    prepareCommand,
    captureStreams,
    aggregateEvidence: aggregateValidationEvidence,
    validateRunAgainstSnapshot,
  };
}

export const reviewValidationConsumer = createValidationConsumer("review");
export const synchronizationValidationConsumer = createValidationConsumer("synchronization");
