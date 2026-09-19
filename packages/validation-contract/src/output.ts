import { TextDecoder } from "node:util";

export const REDACTION_MARKER = "[REDACTED]" as const;
export const OUTPUT_TRUNCATION_MARKER = "\n[… output truncated …]\n" as const;
const REDACTION_PROCESS_CHUNK_BYTES = 64 * 1024;

export interface RedactionOptions {
  knownSecrets?: readonly string[];
  replacement?: string;
}

export interface RedactionResult {
  text: string;
  redacted: boolean;
}

function replaceKnownSecrets(text: string, secrets: readonly string[], replacement: string): RedactionResult {
  let output = text;
  let redacted = false;
  const orderedSecrets = [...new Set(secrets.filter((secret) => secret.length > 0))].sort(
    (left, right) => right.length - left.length,
  );
  for (const secret of orderedSecrets) {
    if (!output.includes(secret)) {
      continue;
    }
    output = output.split(secret).join(replacement);
    redacted = true;
  }
  return { text: output, redacted };
}

function replaceSensitiveAssignments(text: string, replacement: string): RedactionResult {
  let output = text;
  let redacted = false;
  // Quoted values are handled first so punctuation and spaces remain readable.
  output = output.replace(
    /(\b(?:token|password|passwd|secret|authorization|auth|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|client[ _-]?secret|credential)\b\s*[:=]\s*)(["'])(.*?)\2/giu,
    (_match, prefix: string, quote: string) => {
      redacted = true;
      return `${prefix}${quote}${replacement}${quote}`;
    },
  );
  output = output.replace(
    /(\b(?:authorization|auth)\b\s*[:=]\s*)(Bearer\s+)?([^\s,;&"'\u001b]+)/giu,
    (_match, prefix: string, scheme: string | undefined) => {
      redacted = true;
      return `${prefix}${scheme ?? ""}${replacement}`;
    },
  );
  output = output.replace(
    /(\b(?:token|password|passwd|secret|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|client[ _-]?secret|credential)\b\s*[:=]\s*)([^\s,;&"'\u001b]+)/giu,
    (_match, prefix: string) => {
      redacted = true;
      return `${prefix}${replacement}`;
    },
  );
  return { text: output, redacted };
}

export function redactText(text: string, options: RedactionOptions = {}): RedactionResult {
  const replacement = options.replacement ?? REDACTION_MARKER;
  const known = replaceKnownSecrets(text, options.knownSecrets ?? [], replacement);
  const assignments = replaceSensitiveAssignments(known.text, replacement);
  return { text: assignments.text, redacted: known.redacted || assignments.redacted };
}

export function normalizeDisplayOutput(text: string): string {
  // CSI and the common single-character ANSI escape forms are removed before
  // the result is displayed or sent to another application boundary.
  const withoutAnsi = text.replace(/\u001B(?:\[[0-?]*[ -/]*[@-~]|[@-Z\\-_])/gu, "");
  const normalizedNewlines = withoutAnsi.replace(/\r\n?/gu, "\n");
  return [...normalizedNewlines]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return character === "\n" || character === "\t" || codePoint >= 0x20;
    })
    .join("");
}

function safeUtf8PrefixLength(buffer: Buffer, maximum: number): number {
  let length = Math.min(buffer.length, maximum);
  while (length > 0 && length < buffer.length && ((buffer[length] ?? 0) & 0xc0) === 0x80) {
    length -= 1;
  }
  return length;
}

function safeUtf8SuffixStart(buffer: Buffer, minimumStart: number): number {
  let start = Math.max(0, minimumStart);
  while (start < buffer.length && start > 0 && ((buffer[start] ?? 0) & 0xc0) === 0x80) {
    start += 1;
  }
  return Math.min(start, buffer.length);
}

export interface OutputEvidence {
  text: string;
  originalByteCount: number;
  processedByteCount: number;
  retainedByteCount: number;
  omittedByteCount: number;
  truncated: boolean;
  truncationMarker?: string;
  redacted: boolean;
  safe: boolean;
  reason?: "REDACTION_FAILURE";
}

export interface StreamAccumulatorOptions extends RedactionOptions {
  limitBytes: number;
  /** Test and future runner hook; it must return redacted text or throw. */
  redactor?: (text: string) => RedactionResult;
}

function boundedMarker(limitBytes: number): Buffer {
  const marker = Buffer.from(OUTPUT_TRUNCATION_MARKER, "utf8");
  if (marker.length <= limitBytes) {
    return marker;
  }
  const safeLength = safeUtf8PrefixLength(marker, limitBytes);
  if (safeLength > 1) {
    return marker.subarray(0, safeLength);
  }
  return Buffer.from("!".repeat(limitBytes), "utf8");
}

export class StreamAccumulator {
  private readonly limitBytes: number;
  private readonly knownSecrets: readonly string[];
  private readonly replacement: string;
  private readonly redactor: (text: string) => RedactionResult;
  private readonly lookbehindBytes: number;
  private pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private retained: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private head: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private tail: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private marker: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private originalByteCount = 0;
  private processedByteCount = 0;
  private redacted = false;
  private truncated = false;
  private redactionFailed = false;

  public constructor(options: StreamAccumulatorOptions) {
    if (!Number.isInteger(options.limitBytes) || options.limitBytes < 1) {
      throw new RangeError("limitBytes must be a positive integer");
    }
    this.limitBytes = options.limitBytes;
    this.knownSecrets = [...(options.knownSecrets ?? [])];
    this.replacement = options.replacement ?? REDACTION_MARKER;
    this.redactor = options.redactor ?? ((text) => redactText(text, { knownSecrets: this.knownSecrets, replacement: this.replacement }));
    const largestSecret = this.knownSecrets.reduce((largest, secret) => Math.max(largest, Buffer.byteLength(secret, "utf8")), 0);
    this.lookbehindBytes = Math.max(256, largestSecret + 64);
  }

  public append(chunk: Uint8Array | string): void {
    if (this.redactionFailed) {
      return;
    }
    const buffer = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk);
    this.originalByteCount += buffer.length;
    for (let offset = 0; offset < buffer.length && !this.redactionFailed; offset += REDACTION_PROCESS_CHUNK_BYTES) {
      const inputChunk = buffer.subarray(offset, Math.min(buffer.length, offset + REDACTION_PROCESS_CHUNK_BYTES));
      this.pending = Buffer.concat([this.pending, inputChunk]);
      while (!this.redactionFailed && this.pending.length > this.lookbehindBytes) {
        const proposedLength = Math.min(
          this.pending.length - this.lookbehindBytes,
          REDACTION_PROCESS_CHUNK_BYTES,
        );
        const prefixLength = safeUtf8PrefixLength(this.pending, proposedLength);
        if (prefixLength === 0) {
          break;
        }
        const prefix = this.pending.subarray(0, prefixLength);
        this.pending = this.pending.subarray(prefixLength);
        this.processPrefix(prefix);
      }
    }
  }

  private processPrefix(prefix: Uint8Array): void {
    try {
      const result = this.redactor(new TextDecoder("utf-8").decode(prefix));
      this.redacted ||= result.redacted;
      const bytes = Buffer.from(result.text, "utf8");
      this.processedByteCount += bytes.length;
      this.appendProcessed(bytes);
    } catch {
      this.redactionFailed = true;
    }
  }

  private appendProcessed(bytes: Buffer): void {
    if (bytes.length === 0 || this.redactionFailed) {
      return;
    }
    if (!this.truncated) {
      if (this.retained.length + bytes.length <= this.limitBytes) {
        this.retained = Buffer.concat([this.retained, bytes]);
        return;
      }
      const combined = Buffer.concat([this.retained, bytes]);
      this.truncated = true;
      this.marker = boundedMarker(this.limitBytes);
      const available = Math.max(0, this.limitBytes - this.marker.length);
      const headBudget = Math.floor(available / 2);
      const tailBudget = available - headBudget;
      const headLength = safeUtf8PrefixLength(combined, headBudget);
      this.head = combined.subarray(0, headLength);
      const desiredTailStart = Math.max(headLength, combined.length - tailBudget);
      const tailStart = safeUtf8SuffixStart(combined, desiredTailStart);
      this.tail = combined.subarray(tailStart);
      this.retained = Buffer.alloc(0);
      return;
    }

    const available = Math.max(0, this.limitBytes - this.marker.length);
    const headBudget = Math.floor(available / 2);
    const tailBudget = available - headBudget;
    if (this.head.length > headBudget) {
      this.head = this.head.subarray(0, safeUtf8PrefixLength(this.head, headBudget));
    }
    if (tailBudget === 0) {
      this.tail = Buffer.alloc(0);
      return;
    }
    const combinedTail = Buffer.concat([this.tail, bytes]);
    const tailStart = Math.max(0, combinedTail.length - tailBudget);
    this.tail = combinedTail.subarray(safeUtf8SuffixStart(combinedTail, tailStart));
  }

  public finish(): OutputEvidence {
    if (!this.redactionFailed && this.pending.length > 0) {
      const pending = this.pending;
      this.pending = Buffer.alloc(0);
      this.processPrefix(pending);
    }

    if (this.redactionFailed) {
      return {
        text: "",
        originalByteCount: this.originalByteCount,
        processedByteCount: this.processedByteCount,
        retainedByteCount: 0,
        omittedByteCount: this.processedByteCount,
        truncated: this.truncated,
        ...(this.truncated ? { truncationMarker: OUTPUT_TRUNCATION_MARKER } : {}),
        redacted: false,
        safe: false,
        reason: "REDACTION_FAILURE",
      };
    }

    const bytes = this.truncated
      ? Buffer.concat([this.head, this.marker, this.tail])
      : this.retained;
    const text = normalizeDisplayOutput(new TextDecoder("utf-8").decode(bytes));
    return {
      text,
      originalByteCount: this.originalByteCount,
      processedByteCount: this.processedByteCount,
      retainedByteCount: bytes.length,
      omittedByteCount: Math.max(0, this.processedByteCount - bytes.length),
      truncated: this.truncated,
      ...(this.truncated ? { truncationMarker: OUTPUT_TRUNCATION_MARKER } : {}),
      redacted: this.redacted,
      safe: true,
    };
  }
}

export function createStreamAccumulator(options: StreamAccumulatorOptions): StreamAccumulator {
  return new StreamAccumulator(options);
}

export interface CapturedStreams {
  stdout: OutputEvidence;
  stderr: OutputEvidence;
}

export function captureStreams(
  input: {
    stdout?: Iterable<Uint8Array | string>;
    stderr?: Iterable<Uint8Array | string>;
    limitBytes: number;
    knownSecrets?: readonly string[];
  },
): CapturedStreams {
  const stdout = new StreamAccumulator({ limitBytes: input.limitBytes, knownSecrets: input.knownSecrets });
  const stderr = new StreamAccumulator({ limitBytes: input.limitBytes, knownSecrets: input.knownSecrets });
  for (const chunk of input.stdout ?? []) stdout.append(chunk);
  for (const chunk of input.stderr ?? []) stderr.append(chunk);
  return { stdout: stdout.finish(), stderr: stderr.finish() };
}
