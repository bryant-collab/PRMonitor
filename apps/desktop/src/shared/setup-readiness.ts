import { z } from "zod";

export const SETUP_CHECK_IDS = [
  "local-prerequisites",
  "github-access",
  "ai-access",
  "ai-task-configuration",
  "working-policy",
] as const;

export const setupReadinessCheckSchema = z
  .object({
    id: z.enum(SETUP_CHECK_IDS),
    status: z.enum([
      "checking",
      "complete",
      "incomplete",
      "temporarily-unavailable",
    ]),
    description: z.string().min(1).max(1024),
    remediation: z.enum(["local", "github", "ai", "tasks", "policy"]),
  })
  .strict();
export type SetupReadinessCheck = z.infer<typeof setupReadinessCheckSchema>;

export const setupReadinessSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    ready: z.boolean(),
    completedCount: z.number().int().min(0).max(5),
    checks: z.array(setupReadinessCheckSchema).length(5),
  })
  .strict()
  .superRefine((value, context) => {
    const completed = value.checks.filter(
      (check) => check.status === "complete",
    ).length;
    if (
      value.completedCount !== completed ||
      value.ready !== (completed === 5) ||
      value.checks.some((check, index) => check.id !== SETUP_CHECK_IDS[index])
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "SETUP_PROJECTION_INVALID",
      });
    }
  });
export type SetupReadiness = z.infer<typeof setupReadinessSchema>;
export type SetupReadinessProjection = SetupReadiness;

export function isSetupReadiness(value: unknown): value is SetupReadiness {
  return setupReadinessSchema.safeParse(value).success;
}
