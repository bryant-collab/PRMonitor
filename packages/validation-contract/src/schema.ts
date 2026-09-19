import { z } from "zod";

export const VALIDATION_SCHEMA_VERSION = 1 as const;
export const DEFAULT_TIMEOUT_SECONDS = 600 as const;
export const MIN_TIMEOUT_SECONDS = 1 as const;
export const MAX_TIMEOUT_SECONDS = 3_600 as const;
export const DEFAULT_OUTPUT_LIMIT_BYTES = 1_048_576 as const;
export const MAX_OUTPUT_LIMIT_BYTES = 1_048_576 as const;

export const VALIDATION_PROFILE_PATH = ".prmonitor/validation.json" as const;

const stableIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const stableIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(stableIdPattern, "must start with a letter or digit and contain only letters, digits, '.', '_' or '-'");

function isRelativeDirectorySyntax(value: string): boolean {
  if (value.length === 0 || value.includes("\0") || /[\r\n]/u.test(value)) {
    return false;
  }

  // Validation configuration is portable across hosts. Reject both POSIX and
  // Windows absolute forms even when a profile is being inspected elsewhere.
  if (value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:/u.test(value)) {
    return false;
  }

  const segments = value.split(/[\\/]+/u);
  return !segments.some((segment) => segment === "..");
}

export const relativeWorkingDirectorySchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^(?![\\/])(?![A-Za-z]:)(?!.*(?:^|[\\/])\.\.(?:[\\/]|$)).+$/u, "must use relative non-traversing path syntax")
  .refine(isRelativeDirectorySyntax, {
    message: "must be a relative worktree directory without absolute or parent-traversal syntax",
  })
  .default(".");

export const executableSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^(?:[^\s\0\r\n]+|(?:[A-Za-z]:)?[\\/][^\0\r\n]+)$/u, "must be one executable token, not a shell command string")
  .refine((value) => !/[\0\r\n]/u.test(value), "must not contain control characters")
  .refine(
    (value) => !/\s/u.test(value) || /[\\/]/u.test(value) || /^[A-Za-z]:/u.test(value),
    "must be one executable token, not a shell command string",
  );

export const commandStepSchema = z
  .object({
    kind: z.literal("command"),
    id: stableIdSchema,
    label: z.string().min(1).max(256),
    executable: executableSchema,
    arguments: z.array(z.string().max(16_384)).max(512),
    workingDirectory: relativeWorkingDirectorySchema,
    timeoutSeconds: z
      .number()
      .int()
      .min(MIN_TIMEOUT_SECONDS)
      .max(MAX_TIMEOUT_SECONDS)
      .default(DEFAULT_TIMEOUT_SECONDS),
    outputLimitBytes: z
      .number()
      .int()
      .min(1)
      .max(MAX_OUTPUT_LIMIT_BYTES)
      .default(DEFAULT_OUTPUT_LIMIT_BYTES),
  })
  .strict();

export const manualStepSchema = z
  .object({
    kind: z.literal("manual"),
    id: stableIdSchema,
    label: z.string().min(1).max(256),
    instructions: z.string().min(1).max(16_384),
  })
  .strict();

// A plain union keeps the version-1 discriminator required while allowing the
// command-specific defaults to be applied by Zod before consumers see it.
export const validationStepSchema = z.union([commandStepSchema, manualStepSchema]);

export const validationProfileV1Schema = z
  .object({
    schemaVersion: z.literal(VALIDATION_SCHEMA_VERSION),
    steps: z.array(validationStepSchema).min(1).max(512),
  })
  .strict()
  .superRefine((profile, context) => {
    const seen = new Map<string, number>();
    profile.steps.forEach((step, index) => {
      const previousIndex = seen.get(step.id);
      if (previousIndex !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["steps", index, "id"],
          message: `duplicates step id declared at index ${previousIndex}`,
        });
      } else {
        seen.set(step.id, index);
      }
    });
  });

export const validationProfileSchema = validationProfileV1Schema;

export type CommandStep = z.infer<typeof commandStepSchema>;
export type ManualStep = z.infer<typeof manualStepSchema>;
export type ValidationStep = z.infer<typeof validationStepSchema>;
export type ValidationProfile = z.infer<typeof validationProfileV1Schema>;

export interface ProfileIssue {
  path: (string | number)[];
  message: string;
  code: string;
}

export type ProfileParseResult =
  | {
      ok: true;
      schemaVersion: typeof VALIDATION_SCHEMA_VERSION;
      profile: ValidationProfile;
    }
  | {
      ok: false;
      code: "INVALID_PROFILE" | "UNSUPPORTED_SCHEMA_VERSION";
      schemaVersion?: unknown;
      issues: ProfileIssue[];
    };

function profileIssues(error: z.ZodError): ProfileIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path,
    message: issue.message,
    code: issue.code,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseValidationProfile(input: unknown): ProfileParseResult {
  if (!isRecord(input)) {
    return {
      ok: false,
      code: "INVALID_PROFILE",
      issues: [{ path: [], message: "profile must be an object", code: "invalid_type" }],
    };
  }

  const version = input.schemaVersion;
  if (version !== VALIDATION_SCHEMA_VERSION) {
    return {
      ok: false,
      code: "UNSUPPORTED_SCHEMA_VERSION",
      schemaVersion: version,
      issues: [
        {
          path: ["schemaVersion"],
          message: `unsupported validation profile schema version: ${String(version)}`,
          code: "unsupported_schema_version",
        },
      ],
    };
  }

  const parsed = validationProfileV1Schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_PROFILE", issues: profileIssues(parsed.error) };
  }

  return { ok: true, schemaVersion: VALIDATION_SCHEMA_VERSION, profile: parsed.data };
}

export class ValidationProfileError extends Error {
  public readonly code: "INVALID_PROFILE" | "UNSUPPORTED_SCHEMA_VERSION";
  public readonly issues: ProfileIssue[];
  public readonly schemaVersion: unknown;

  public constructor(result: Extract<ProfileParseResult, { ok: false }>) {
    super(result.issues.map((issue) => `${issue.path.join(".") || "profile"}: ${issue.message}`).join("; "));
    this.name = "ValidationProfileError";
    this.code = result.code;
    this.issues = result.issues;
    this.schemaVersion = result.schemaVersion;
  }
}

export function assertValidationProfile(input: unknown): ValidationProfile {
  const result = parseValidationProfile(input);
  if (!result.ok) {
    throw new ValidationProfileError(result);
  }
  return result.profile;
}

export const VALIDATION_PROFILE_EXAMPLE: ValidationProfile = {
  schemaVersion: VALIDATION_SCHEMA_VERSION,
  steps: [
    {
      kind: "command",
      id: "unit-tests",
      label: "Unit tests",
      executable: "npm",
      arguments: ["test"],
      workingDirectory: ".",
      timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
      outputLimitBytes: DEFAULT_OUTPUT_LIMIT_BYTES,
    },
    {
      kind: "manual",
      id: "visual-check",
      label: "Visual check",
      instructions: "Inspect the affected screen at the supported desktop sizes.",
    },
  ],
};
