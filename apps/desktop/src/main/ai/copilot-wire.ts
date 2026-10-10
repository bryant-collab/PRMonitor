import { z } from "zod";

export const COPILOT_MESSAGE_LIMIT = 2 * 1024 * 1024;
export const COPILOT_POLICY_LIMIT = 256 * 1024;
export const COPILOT_PENDING_LIMIT = 32;
export const COPILOT_POLICY_TIMEOUT = 3000;
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const sessionId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u);
const methods = z.enum([
  "start",
  "auth",
  "models",
  "hooks",
  "tools",
  "create",
  "resume",
  "model",
  "send",
  "abort",
  "disconnect",
  "stop",
]);
const messageSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("booted"),
      pid: id,
      birth: z
        .string()
        .regex(/^\d{1,20}$/u)
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("request"),
      id,
      method: methods,
      payload: z.unknown(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("reply"),
      id,
      ok: z.boolean(),
      payload: z.unknown().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("policy"),
      id,
      scope: id,
      sessionId,
      workingDirectory: z.string().max(4096),
      toolName: z.string().max(128),
      toolArgs: z.unknown(),
    })
    .strict(),
  z
    .object({ kind: z.literal("policy-result"), id, allow: z.boolean() })
    .strict(),
]);
export type CopilotWireMessage = z.infer<typeof messageSchema>;
export type CopilotMethod = z.infer<typeof methods>;
export function decodeCopilotMessage(value: unknown): CopilotWireMessage {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value) > COPILOT_MESSAGE_LIMIT
  )
    throw new Error("Copilot worker message exceeds its boundary.");
  const message = messageSchema.parse(JSON.parse(value));
  if (
    message.kind === "policy" &&
    Buffer.byteLength(value) > COPILOT_POLICY_LIMIT
  )
    throw new Error("Copilot policy request exceeds its boundary.");
  return message;
}
export function encodeCopilotMessage(message: CopilotWireMessage): string {
  const value = JSON.stringify(messageSchema.parse(message));
  if (Buffer.byteLength(value) > COPILOT_MESSAGE_LIMIT)
    throw new Error("Copilot worker message exceeds its boundary.");
  if (
    message.kind === "policy" &&
    Buffer.byteLength(value) > COPILOT_POLICY_LIMIT
  )
    throw new Error("Copilot policy request exceeds its boundary.");
  return value;
}
export const copilotStartSchema = z
  .object({
    executable: z.string().min(1).max(4096),
    cwd: z.string().min(1).max(4096),
    home: z.string().min(1).max(4096),
    env: z
      .record(z.string().max(128), z.string().max(32768))
      .refine((value) =>
        Object.keys(value).every((key) =>
          [
            "PATH",
            "Path",
            "PATHEXT",
            "SystemRoot",
            "WINDIR",
            "TEMP",
            "TMP",
            "HOME",
            "USERPROFILE",
            "APPDATA",
            "LOCALAPPDATA",
            "COPILOT_HOME",
          ].includes(key),
        ),
      ),
    noColor: z.boolean(),
  })
  .strict();
export const copilotSessionSchema = z
  .object({
    scope: id,
    root: z.string().min(1).max(4096),
    model: z.string().refine(copilotBareModel),
    reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
    write: z.boolean(),
    resumeId: sessionId.optional(),
  })
  .strict();
export function copilotBareModel(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$/u.test(value) && value !== "auto";
}
export const copilotSubscription = (value: {
  isAuthenticated: boolean;
  authType?: string;
  host?: string;
}): boolean =>
  value.isAuthenticated === true &&
  value.authType === "user" &&
  (value.host === "github.com" || value.host === "https://github.com");
