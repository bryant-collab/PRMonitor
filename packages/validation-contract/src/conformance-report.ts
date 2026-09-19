import { readFile } from "node:fs/promises";
import {
  aggregateValidationEvidence,
  buildConfirmationSummary,
  captureStreams,
  createApprovalRecord,
  createValidationConsumer,
  hashValidationProfile,
  parseValidationProfile,
  resolveValidationProfile,
  type ValidationProfile,
} from "./index.js";

const repositoryId = "github:example/repo";
const profilePath = new URL("../fixtures/example-profile.json", import.meta.url);
const profile = JSON.parse(await readFile(profilePath, "utf8")) as unknown;
const parsed = parseValidationProfile(profile);
if (!parsed.ok) {
  throw new Error(`example profile is invalid: ${parsed.issues.map((issue) => issue.message).join("; ")}`);
}

const checkedInProfile = parsed.profile;
const approval = createApprovalRecord({
  repositoryId,
  source: "checked-in",
  profile: checkedInProfile,
  approvedAt: "2026-09-19T12:00:00.000Z",
});
const ready = resolveValidationProfile({
  repositoryId,
  checkedIn: { profile: checkedInProfile, approval },
});
const unavailable = resolveValidationProfile({ repositoryId });
const streams = captureStreams({
  limitBytes: 128,
  stdout: ["diagnostic token=synthetic-token\n", "x".repeat(256), "tail"],
  stderr: ["no errors"],
});
const aggregate = aggregateValidationEvidence({ automated: [], unavailableReason: "NO_PROFILE" });
const consumers = [createValidationConsumer("review"), createValidationConsumer("synchronization")];

const report = {
  profile: {
    parsed: true,
    schemaVersion: checkedInProfile.schemaVersion,
    stepKinds: checkedInProfile.steps.map((step) => step.kind),
    contentHash: hashValidationProfile(checkedInProfile),
  },
  resolution: {
    ready: ready.status,
    confirmationSummary: ready.status === "ready" ? buildConfirmationSummary(ready.profile, { source: ready.source, repositoryId }) : undefined,
    unavailable: unavailable.status,
  },
  output: {
    safe: streams.stdout.safe && streams.stderr.safe,
    truncated: streams.stdout.truncated || streams.stderr.truncated,
    retainedBytes: { stdout: streams.stdout.retainedByteCount, stderr: streams.stderr.retainedByteCount },
    secretVisible: streams.stdout.text.includes("synthetic-token"),
  },
  aggregation: { status: aggregate.status, reason: aggregate.reason },
  consumers: consumers.map((consumer) => consumer.kind),
} satisfies {
  profile: { parsed: boolean; schemaVersion: ValidationProfile["schemaVersion"]; stepKinds: string[]; contentHash: string };
  resolution: { ready: string; confirmationSummary: unknown; unavailable: string };
  output: { safe: boolean; truncated: boolean; retainedBytes: { stdout: number; stderr: number }; secretVisible: boolean };
  aggregation: { status: string; reason?: string };
  consumers: string[];
};

console.log(JSON.stringify(report, null, 2));
