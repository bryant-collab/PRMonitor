import type { ValidationSnapshot, CreateValidationSnapshotInput } from "./snapshot.js";
import { createValidationSnapshot } from "./snapshot.js";
import { resolveValidationProfile, type ResolveValidationInput, type ValidationResolution } from "./trust.js";

export type ValidationConsumerKind = "review" | "synchronization";

export interface ValidationConsumer {
  readonly kind: ValidationConsumerKind;
  resolveProfile(input: ResolveValidationInput): ValidationResolution;
  createSnapshot(input: CreateValidationSnapshotInput): Readonly<ValidationSnapshot>;
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
  };
}

export const reviewValidationConsumer = createValidationConsumer("review");
export const synchronizationValidationConsumer = createValidationConsumer("synchronization");
