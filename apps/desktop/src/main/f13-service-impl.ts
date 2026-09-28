import { createHash, randomUUID } from "node:crypto";
import {
  access,
  constants as fsConstants,
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import {
  F13_MAX_FILE_COUNT,
  F13_MAX_PATCH_BYTES,
  F13_MAX_PATH_BYTES,
  F13_MAX_SNAPSHOT_FILE_BYTES,
  isF13OperationKind,
  isSafeF13RepositoryKey,
  isSafeF13Branch,
  isSafeF13Identifier,
  isSafeF13Sha,
} from "../shared/f13-contracts";
import type {
  F13AiTurnAfterResult,
  F13AiTurnBeforeResult,
  F13ChangeSummary,
  F13ClearChoice,
  F13ClearResult,
  F13DiffEvidence,
  F13DiffKind,
  F13FileEvidence,
  F13InspectionResult,
  F13OperationRequest,
  F13PathAction,
  F13PathActionResult,
  F13PreparationResult,
  F13ProviderAccess,
  F13ProviderWorktreeHandoff,
  F13ProviderWorktreeHandoffResult,
  F13RepositoryIdentity,
  F13ReviewOperationRequest,
  F13RootResolution,
  F13SafeReason,
  F13SnapshotManifest,
  F13SnapshotPhase,
  F13SnapshotRecord,
  F13SynchronizationChangeEvidence,
  F13SynchronizationEvidenceResult,
  F13SynchronizationMergeResult,
  F13SynchronizationOperationRequest,
  F13WorktreeCondition,
  F13WorktreeConditionKind,
  F13WorktreeDirtySummary,
  F13WorktreeNextAction,
  F13WorktreeRecord,
} from "../shared/f13-contracts";
import type {
  F13ClearActionRecord,
  F13PersistenceRepositories,
  F13OperationIntentRecord,
} from "./persistence/f13-repositories";
import {
  createF13GitCommandRunner,
  type F13GitCommandResult,
  type F13GitCommandRunner,
} from "./f13-git";

export interface F13OsPathAdapter {
  openDirectory(
    path: string,
  ): Promise<{ readonly ok: boolean; readonly reasonCode?: string }>;
  openFile(
    path: string,
  ): Promise<{ readonly ok: boolean; readonly reasonCode?: string }>;
  revealFile(
    path: string,
  ): Promise<{ readonly ok: boolean; readonly reasonCode?: string }>;
}

export interface F13ActivitySink {
  readonly append: (event: {
    readonly correlationId: string;
    readonly operationId?: string;
    readonly reasonCode: string;
    readonly summary: string;
  }) => void;
}

export interface F13WorktreeServiceOptions {
  readonly repositories: F13PersistenceRepositories;
  readonly git?: F13GitCommandRunner;
  readonly defaultRoot?: string;
  readonly registeredDeveloperClones?: readonly string[];
  readonly os?: F13OsPathAdapter;
  readonly activity?: F13ActivitySink;
  readonly now?: () => string;
  readonly gitTimeoutMs?: number;
}

interface InternalFileEvidence extends F13FileEvidence {
  readonly statusCode?: string;
}

interface ActualState {
  readonly manifest: F13SnapshotManifest;
  readonly statusText: string;
  readonly dirty: boolean;
  readonly fileMap: ReadonlyMap<string, InternalFileEvidence>;
}

interface F13MutationBackup {
  readonly target: string;
  readonly existed: boolean;
  readonly content?: Buffer;
  readonly mode?: number;
}

interface DiffNameStatus {
  readonly path: string;
  readonly kind: F13FileEvidence["kind"];
  readonly oldPath?: string;
  readonly statusCode?: string;
}

interface ContentValue {
  readonly exists: boolean;
  readonly hash?: string;
  readonly content?: Buffer;
  readonly sizeBytes?: number;
  readonly binary?: boolean;
  readonly complete: boolean;
}

class F13ServiceFailure extends Error {
  public constructor(public readonly reason: F13SafeReason) {
    super(reason.what);
    this.name = "F13ServiceFailure";
  }
}

function defaultNow(): string {
  return new Date().toISOString();
}

function boundedText(value: string, maximum: number): string {
  let result = "";
  for (const character of value) {
    if (Buffer.byteLength(result + character, "utf8") > maximum) break;
    result += character;
  }
  return result;
}

function safeReason(
  code: string,
  category: F13SafeReason["category"],
  what: string,
  why: string,
  nextAction: F13SafeReason["nextAction"],
  correlationId: string,
): F13SafeReason {
  return {
    code: boundedText(code, 128),
    category,
    what: boundedText(what, 512),
    why: boundedText(why, 512),
    nextAction,
    correlationId:
      typeof correlationId === "string" && isSafeF13Identifier(correlationId)
        ? correlationId
        : "f13-operation",
  };
}

function hashText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

function sameJson(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function pathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function pathEqual(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function sourceRepository(request: F13OperationRequest): F13RepositoryIdentity {
  return request.operationKind === "SYNCHRONIZATION"
    ? request.refs.sourceRepository
    : request.refs.baseRepository;
}

function expectedHeadSha(request: F13OperationRequest): string {
  return request.refs.prHeadSha;
}

function snapshotShaPayload(
  request: F13OperationRequest,
): Record<string, string> {
  if (request.operationKind === "SYNCHRONIZATION") {
    return {
      syncSourceSha: request.refs.syncSourceSha,
      prHeadSha: request.refs.prHeadSha,
      ...(request.refs.syncMergeBaseSha === undefined
        ? {}
        : { syncMergeBaseSha: request.refs.syncMergeBaseSha }),
      worktreeBaselineSha: request.refs.prHeadSha,
    };
  }
  return {
    prBaseSha: request.refs.prBaseSha,
    prHeadSha: request.refs.prHeadSha,
    worktreeBaselineSha: request.refs.prHeadSha,
  };
}

function operationRepository(
  request: F13OperationRequest,
): F13RepositoryIdentity {
  return sourceRepository(request);
}

function operationRootRevision(request: F13OperationRequest): number {
  return request.rootRevision ?? 1;
}

function worktreeIdFor(operationId: string): string {
  return `f13-wt-${hashText(operationId).slice(0, 32)}`;
}

function actionIdFor(operationId: string, suffix: string): string {
  return `f13-action-${hashText(`${operationId}:${suffix}:${randomUUID()}`).slice(0, 32)}`;
}

function snapshotIdFor(
  operationId: string,
  phase: F13SnapshotPhase,
  turnId?: string,
): string {
  return `f13-snapshot-${hashText(`${operationId}:${phase}:${turnId ?? ""}:${randomUUID()}`).slice(0, 32)}`;
}

function diffIdFor(
  operationId: string,
  kind: F13DiffKind,
  fingerprint: string,
): string {
  return `f13-diff-${hashText(`${operationId}:${kind}:${fingerprint}`).slice(0, 32)}`;
}

function statusKind(staged: string, worktree: string): F13FileEvidence["kind"] {
  const value = `${staged}${worktree}`;
  if (value === "??") return "untracked";
  if (value === "!!") return "ignored";
  if (staged === "R" || worktree === "R") return "renamed";
  if (staged === "C" || worktree === "C") return "copied";
  if (staged === "D" || worktree === "D") return "deleted";
  if (staged === "A" || worktree === "A") return "added";
  if (staged === "T" || worktree === "T") return "type_changed";
  if (staged === "M" || worktree === "M") return "modified";
  return "unknown";
}

function parseStatus(statusText: string): {
  readonly files: InternalFileEvidence[];
  readonly ignored: string[];
} {
  const tokens = statusText.split("\0");
  const files: InternalFileEvidence[] = [];
  const ignored: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined || token.length < 3) continue;
    const staged = token[0] ?? " ";
    const worktree = token[1] ?? " ";
    const rawPath = token.slice(3);
    if (rawPath.length === 0) continue;
    const normalizedPath = rawPath.replaceAll("\\", "/");
    const kind = statusKind(staged, worktree);
    if (kind === "ignored") {
      ignored.push(normalizedPath);
      continue;
    }
    const rename =
      staged === "R" || worktree === "R" || staged === "C" || worktree === "C";
    let oldPath: string | undefined;
    if (rename) {
      const old = tokens[index + 1];
      if (old !== undefined && old.length > 0) {
        oldPath = old.replaceAll("\\", "/");
        index += 1;
      }
    }
    files.push({
      path: normalizedPath,
      kind,
      staged: staged !== " " && staged !== "?",
      worktreeChanged: worktree !== " " && worktree !== "?",
      ...(oldPath === undefined ? {} : { oldPath }),
      statusCode: `${staged}${worktree}`,
    });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  ignored.sort((left, right) => left.localeCompare(right));
  return { files, ignored };
}

function parseNameStatus(output: string): DiffNameStatus[] {
  const tokens = output.split("\0");
  const result: DiffNameStatus[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined || token.length === 0) continue;
    const separator = token.indexOf("\t");
    const nulSeparatedCode = separator < 0 && /^[A-Z][0-9]*$/u.test(token);
    const code = nulSeparatedCode ? token : token.slice(0, separator);
    const rawPath = nulSeparatedCode
      ? tokens[index + 1]
      : token.slice(separator + 1);
    if (rawPath === undefined) continue;
    const filePath = rawPath.replaceAll("\\", "/");
    if (filePath.length === 0) continue;
    const old =
      code.startsWith("R") || code.startsWith("C")
        ? nulSeparatedCode
          ? tokens[index + 1]
          : tokens[index + 1]
        : undefined;
    if (nulSeparatedCode) index += 1;
    if (
      nulSeparatedCode &&
      old !== undefined &&
      (code.startsWith("R") || code.startsWith("C"))
    ) {
      const newPath = tokens[index + 1];
      if (newPath !== undefined) {
        index += 1;
        result.push({
          path: newPath.replaceAll("\\", "/"),
          kind: code.startsWith("R") ? "renamed" : "copied",
          oldPath: filePath,
          statusCode: code,
        });
        continue;
      }
    }
    const first = code[0] ?? "M";
    const kind: F13FileEvidence["kind"] =
      first === "A"
        ? "added"
        : first === "D"
          ? "deleted"
          : first === "R"
            ? "renamed"
            : first === "C"
              ? "copied"
              : first === "T"
                ? "type_changed"
                : "modified";
    result.push({
      path: filePath,
      kind,
      ...(old === undefined ? {} : { oldPath: old.replaceAll("\\", "/") }),
      statusCode: code,
    });
  }
  result.sort((left, right) => left.path.localeCompare(right.path));
  return result;
}

function resultReason(
  result: F13GitCommandResult,
  correlationId: string,
  operationId: string,
): F13SafeReason {
  if (result.cancelled)
    return safeReason(
      "GIT_CANCELLED",
      "CANCELLED",
      "The Git operation was cancelled before its outcome was confirmed.",
      "The owned path and durable intent were preserved for reconciliation.",
      "RECONCILE",
      correlationId,
    );
  if (result.timedOut)
    return safeReason(
      "GIT_TIMEOUT",
      "RECOVERY",
      "The Git operation exceeded its bounded timeout.",
      "The command may have changed an operation-owned path, so the result must be reconciled before retrying.",
      "RECONCILE",
      correlationId,
    );
  if (result.outputLimitExceeded)
    return safeReason(
      "GIT_OUTPUT_LIMIT",
      "LIMIT",
      "Git produced more evidence than F13 can safely retain.",
      "The authoritative result was not truncated; inspect or narrow the operation before retrying.",
      "RETRY",
      correlationId,
    );
  return safeReason(
    `GIT_FAILED_${operationId.slice(0, 24)}`,
    "GIT",
    "Git could not complete the requested bounded operation.",
    "The operation-owned evidence remains available and no unrelated workspace was targeted.",
    "RETRY",
    correlationId,
  );
}

function bytesWithin(value: string, maximum: number): boolean {
  return Buffer.byteLength(value, "utf8") <= maximum;
}

function isRelativePath(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !path.isAbsolute(value) &&
    !value.includes("\u0000") &&
    !value.includes("\r") &&
    !value.includes("\n") &&
    !/(^|[\\/])\.\.(?:$|[\\/])/u.test(value)
  );
}

function decodeContent(file: F13FileEvidence | undefined): Buffer | undefined {
  if (file?.contentBase64 === undefined || file.contentComplete !== true)
    return undefined;
  try {
    return Buffer.from(file.contentBase64, "base64");
  } catch {
    return undefined;
  }
}

function fileStateEqual(
  left: F13FileEvidence | undefined,
  right: F13FileEvidence | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    left.contentHash === right.contentHash &&
    left.kind === right.kind &&
    left.sizeBytes === right.sizeBytes &&
    left.binary === right.binary
  );
}

function manifestFiles(
  snapshot: F13SnapshotRecord,
): Map<string, F13FileEvidence> {
  return new Map(snapshot.manifest.files.map((file) => [file.path, file]));
}

function manifestPaths(snapshot: F13SnapshotRecord): string[] {
  return [
    ...new Set([
      ...snapshot.manifest.files.map((file) => file.path),
      ...snapshot.manifest.ignoredFiles,
    ]),
  ].sort((left, right) => left.localeCompare(right));
}

function changedPaths(
  before: Map<string, F13FileEvidence>,
  after: Map<string, F13FileEvidence>,
): string[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths]
    .filter((item) => !fileStateEqual(before.get(item), after.get(item)))
    .sort((left, right) => left.localeCompare(right));
}

function changeSummary(
  before: F13SnapshotRecord,
  after: F13SnapshotRecord,
): F13ChangeSummary {
  const beforeFiles = manifestFiles(before);
  const afterFiles = manifestFiles(after);
  const changed = changedPaths(beforeFiles, afterFiles);
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  const renamed: string[] = [];
  const binary: string[] = [];
  const untracked: string[] = [];
  const manualOrUnknown: string[] = [];
  for (const filePath of changed) {
    const previous = beforeFiles.get(filePath);
    const current = afterFiles.get(filePath);
    const selected = current ?? previous;
    if (current?.kind === "untracked") untracked.push(filePath);
    if (
      current?.kind === "added" ||
      (previous === undefined && current !== undefined)
    )
      added.push(filePath);
    else if (
      current?.kind === "deleted" ||
      (current === undefined && previous !== undefined)
    )
      deleted.push(filePath);
    else if (current?.kind === "renamed" || current?.kind === "copied")
      renamed.push(filePath);
    else modified.push(filePath);
    if (selected?.binary === true) binary.push(filePath);
    if (selected?.contentComplete !== true) manualOrUnknown.push(filePath);
  }
  const summary = {
    changed,
    added: added.sort(),
    modified: modified.sort(),
    deleted: deleted.sort(),
    renamed: renamed.sort(),
    binary: binary.sort(),
    untracked: untracked.sort(),
    manualOrUnknown: manualOrUnknown.sort(),
  };
  return { ...summary, hash: hashText(stableJson(summary)) };
}

function snapshotFileIsDirty(file: F13FileEvidence | undefined): boolean {
  return (
    file !== undefined &&
    (file.kind === "untracked" || file.staged || file.worktreeChanged)
  );
}

function dirtySummary(actual: ActualState): F13WorktreeDirtySummary {
  const files = [...actual.fileMap.values()].filter(
    (file) => file.kind !== "ignored" && snapshotFileIsDirty(file),
  );
  const changedPaths = files
    .map((file) => file.path)
    .sort((left, right) => left.localeCompare(right));
  const trackedPaths = files
    .filter((file) => file.kind !== "untracked")
    .map((file) => file.path)
    .sort((left, right) => left.localeCompare(right));
  const stagedPaths = files
    .filter((file) => file.staged)
    .map((file) => file.path)
    .sort((left, right) => left.localeCompare(right));
  const untrackedPaths = files
    .filter((file) => file.kind === "untracked")
    .map((file) => file.path)
    .sort((left, right) => left.localeCompare(right));
  const ignoredPaths = [...actual.manifest.ignoredFiles].sort((left, right) =>
    left.localeCompare(right),
  );
  const summary = {
    changedPaths,
    trackedPaths,
    stagedPaths,
    untrackedPaths,
    ignoredPaths,
  };
  return { ...summary, hash: hashText(stableJson(summary)) };
}

function emptyDirtySummary(): F13WorktreeDirtySummary {
  const summary = {
    changedPaths: [],
    trackedPaths: [],
    stagedPaths: [],
    untrackedPaths: [],
    ignoredPaths: [],
  } as const;
  return { ...summary, hash: hashText(stableJson(summary)) };
}

function conditionActions(
  classification: F13WorktreeConditionKind,
): readonly F13WorktreeNextAction[] {
  switch (classification) {
    case "CLEAN":
      return [
        "INSPECT_CHANGES",
        "VALIDATE_WORKTREE",
        "CONTINUE_AI_WORK",
        "REVALIDATE_FOR_PUBLICATION",
      ];
    case "AI_ATTRIBUTED_ONLY":
      return [
        "INSPECT_CHANGES",
        "VALIDATE_WORKTREE",
        "CONTINUE_AI_WORK",
        "REQUEST_WORKTREE_DECISION",
        "CLEAR_ONLY_AI_CHANGES",
        "CLEAR_ALL_CHANGES",
        "KEEP_WORKTREE_AND_CANCEL",
        "REVALIDATE_FOR_PUBLICATION",
      ];
    case "UNATTRIBUTED_CHANGES":
      return [
        "INSPECT_CHANGES",
        "REFRESH_EVIDENCE",
        "REQUEST_WORKTREE_DECISION",
        "KEEP_WORKTREE_AND_CANCEL",
      ];
    case "MIXED_OR_OVERLAP":
      return [
        "INSPECT_CHANGES",
        "REFRESH_EVIDENCE",
        "REQUEST_WORKTREE_DECISION",
        "KEEP_WORKTREE_AND_CANCEL",
      ];
    case "STALE_OR_UNKNOWN":
      return ["REFRESH_EVIDENCE", "RECONCILE"];
  }
}

function conditionEvidenceRef(input: {
  readonly currentFingerprint: string;
  readonly beforeSnapshotId?: string;
  readonly afterSnapshotId?: string;
  readonly turnSnapshotIds?: readonly {
    readonly beforeSnapshotId: string;
    readonly afterSnapshotId: string;
  }[];
  readonly aiAttributedPaths: readonly string[];
  readonly unAttributedPaths: readonly string[];
  readonly overlapPaths: readonly string[];
}): string {
  return `f13-condition-${hashText(stableJson(input)).slice(0, 32)}`;
}

function worktreeCondition(input: {
  readonly expectedRevision: string;
  readonly actual?: ActualState;
  readonly currentSnapshot?: F13SnapshotRecord;
  readonly beforeSnapshot?: F13SnapshotRecord;
  readonly afterSnapshot?: F13SnapshotRecord;
  readonly aiTurnPairs?: readonly {
    readonly beforeSnapshot: F13SnapshotRecord;
    readonly afterSnapshot: F13SnapshotRecord;
  }[];
}): F13WorktreeCondition {
  const actual = input.actual;
  const currentFingerprint =
    actual?.manifest.stateFingerprint ??
    input.currentSnapshot?.stateFingerprint ??
    "unknown";
  const observedRevision = actual?.manifest.headSha ?? "UNKNOWN";
  const summary =
    actual === undefined ? emptyDirtySummary() : dirtySummary(actual);
  const currentChangedPaths = summary.changedPaths;
  const rawTurnPairs =
    input.aiTurnPairs ??
    (input.beforeSnapshot === undefined || input.afterSnapshot === undefined
      ? []
      : [
          {
            beforeSnapshot: input.beforeSnapshot,
            afterSnapshot: input.afterSnapshot,
          },
        ]);
  const turnPairs = [...rawTurnPairs].sort((left, right) =>
    left.beforeSnapshot.snapshotId.localeCompare(
      right.beforeSnapshot.snapshotId,
    ),
  );
  const firstBefore = turnPairs[0]?.beforeSnapshot ?? input.beforeSnapshot;
  const lastAfter = turnPairs.at(-1)?.afterSnapshot ?? input.afterSnapshot;
  const turnSnapshotIds = turnPairs.map((pair) => ({
    beforeSnapshotId: pair.beforeSnapshot.snapshotId,
    afterSnapshotId: pair.afterSnapshot.snapshotId,
  }));
  const evidenceSnapshotFields = {
    ...(firstBefore === undefined
      ? {}
      : { beforeSnapshotId: firstBefore.snapshotId }),
    ...(lastAfter === undefined
      ? {}
      : { afterSnapshotId: lastAfter.snapshotId }),
    ...(turnSnapshotIds.length === 0 ? {} : { turnSnapshotIds }),
  };
  const unknown = (
    classification: F13WorktreeConditionKind,
    complete = false,
  ): F13WorktreeCondition => {
    const aiAttributedPaths: readonly string[] = [];
    const unAttributedPaths = [...currentChangedPaths];
    const overlapPaths: readonly string[] = [];
    const evidenceInput = {
      currentFingerprint,
      ...evidenceSnapshotFields,
      aiAttributedPaths,
      unAttributedPaths,
      overlapPaths,
    };
    return {
      schemaVersion: 1,
      classification,
      currentFingerprint,
      observedRevision,
      expectedRevision: input.expectedRevision,
      dirtySummary: summary,
      attribution: {
        evidenceRef: conditionEvidenceRef(evidenceInput),
        ...evidenceSnapshotFields,
        aiAttributedPaths,
        unAttributedPaths,
        overlapPaths,
        complete,
      },
      permittedNextActions: conditionActions(classification),
    };
  };

  if (
    actual === undefined ||
    observedRevision === "UNKNOWN" ||
    observedRevision !== input.expectedRevision ||
    !actual.manifest.complete
  )
    return unknown("STALE_OR_UNKNOWN");

  if (currentChangedPaths.length === 0) {
    const evidenceInput = {
      currentFingerprint,
      aiAttributedPaths: [],
      unAttributedPaths: [],
      overlapPaths: [],
    };
    return {
      schemaVersion: 1,
      classification: "CLEAN",
      currentFingerprint,
      observedRevision,
      expectedRevision: input.expectedRevision,
      dirtySummary: summary,
      attribution: {
        evidenceRef: conditionEvidenceRef(evidenceInput),
        aiAttributedPaths: [],
        unAttributedPaths: [],
        overlapPaths: [],
        complete: true,
      },
      permittedNextActions: conditionActions("CLEAN"),
    };
  }

  if (turnPairs.length === 0) return unknown("UNATTRIBUTED_CHANGES", false);
  if (
    turnPairs.some(
      (pair) =>
        !pair.beforeSnapshot.manifest.complete ||
        !pair.afterSnapshot.manifest.complete,
    )
  )
    return unknown("STALE_OR_UNKNOWN", false);

  const currentFiles = actual.fileMap;
  const aiEvidenceByPath = new Map<
    string,
    Array<{
      readonly beforeFile: F13FileEvidence | undefined;
      readonly afterFile: F13FileEvidence | undefined;
    }>
  >();
  const overlapEvidencePaths = new Set<string>();
  for (const pair of turnPairs) {
    const pairBeforeFiles = manifestFiles(pair.beforeSnapshot);
    const pairAfterFiles = manifestFiles(pair.afterSnapshot);
    for (const filePath of changedPaths(pairBeforeFiles, pairAfterFiles)) {
      const evidence = aiEvidenceByPath.get(filePath) ?? [];
      evidence.push({
        beforeFile: pairBeforeFiles.get(filePath),
        afterFile: pairAfterFiles.get(filePath),
      });
      aiEvidenceByPath.set(filePath, evidence);
    }
  }
  for (const [filePath, evidence] of aiEvidenceByPath) {
    const afterStates = evidence.map((item) => item.afterFile);
    if (
      evidence.some(
        (item) =>
          snapshotFileIsDirty(item.beforeFile) &&
          !afterStates.some((afterFile) =>
            fileStateEqual(item.beforeFile, afterFile),
          ),
      )
    )
      overlapEvidencePaths.add(filePath);
  }
  const aiChangedPaths = new Set(aiEvidenceByPath.keys());
  const beforeStatesByPath = new Map<string, (F13FileEvidence | undefined)[]>();
  for (const [filePath, evidence] of aiEvidenceByPath)
    beforeStatesByPath.set(
      filePath,
      evidence.map((item) => item.beforeFile),
    );
  const aiStatesByPath = new Map<string, (F13FileEvidence | undefined)[]>();
  for (const [filePath, evidence] of aiEvidenceByPath)
    aiStatesByPath.set(
      filePath,
      evidence.map((item) => item.afterFile),
    );
  const aiAttributedPaths: string[] = [];
  const unAttributedPaths: string[] = [];
  const overlapPaths: string[] = [];
  for (const filePath of currentChangedPaths) {
    const current = currentFiles.get(filePath);
    const aiStates = aiStatesByPath.get(filePath) ?? [];
    const beforeStates = beforeStatesByPath.get(filePath) ?? [];
    if (!aiChangedPaths.has(filePath)) {
      unAttributedPaths.push(filePath);
      continue;
    }
    if (overlapEvidencePaths.has(filePath)) {
      overlapPaths.push(filePath);
      continue;
    }
    if (
      aiStates.length > 0 &&
      aiStates.every((state) => fileStateEqual(state, aiStates[0])) &&
      fileStateEqual(current, aiStates[0])
    ) {
      aiAttributedPaths.push(filePath);
      continue;
    }
    if (beforeStates.some((state) => fileStateEqual(current, state))) {
      unAttributedPaths.push(filePath);
      continue;
    }
    overlapPaths.push(filePath);
  }
  const classification: F13WorktreeConditionKind =
    overlapPaths.length > 0 ||
    (aiAttributedPaths.length > 0 && unAttributedPaths.length > 0)
      ? "MIXED_OR_OVERLAP"
      : aiAttributedPaths.length > 0
        ? "AI_ATTRIBUTED_ONLY"
        : "UNATTRIBUTED_CHANGES";
  const evidenceInput = {
    currentFingerprint,
    ...evidenceSnapshotFields,
    aiAttributedPaths: [...aiAttributedPaths].sort(),
    unAttributedPaths: [...unAttributedPaths].sort(),
    overlapPaths: [...overlapPaths].sort(),
  };
  return {
    schemaVersion: 1,
    classification,
    currentFingerprint,
    observedRevision,
    expectedRevision: input.expectedRevision,
    dirtySummary: summary,
    attribution: {
      evidenceRef: conditionEvidenceRef(evidenceInput),
      ...evidenceSnapshotFields,
      aiAttributedPaths: evidenceInput.aiAttributedPaths,
      unAttributedPaths: evidenceInput.unAttributedPaths,
      overlapPaths: evidenceInput.overlapPaths,
      complete: true,
    },
    permittedNextActions: conditionActions(classification),
  };
}

function providerWorktreeHandoff(input: {
  readonly worktree: F13WorktreeRecord;
  readonly snapshot: F13SnapshotRecord;
  readonly access: F13ProviderAccess;
}): F13ProviderWorktreeHandoff {
  const { worktree, snapshot, access } = input;
  return {
    schemaVersion: 1,
    operationId: worktree.operationId,
    worktreeId: worktree.worktreeId,
    ownerType: worktree.ownerType,
    ownerId: worktree.ownerId,
    operationKind: worktree.operationKind,
    canonicalPath: worktree.canonicalPath,
    access,
    ownership: {
      kind: "OPERATION_OWNED",
      ownerType: worktree.ownerType,
      ownerId: worktree.ownerId,
    },
    actualState: {
      snapshotId: snapshot.snapshotId,
      stateFingerprint: snapshot.stateFingerprint,
      baselineRevision: snapshot.manifest.worktreeBaselineSha,
      expectedHeadRevision: snapshot.manifest.expectedHeadSha,
      ...(snapshot.manifest.headSha === undefined
        ? {}
        : { currentHeadRevision: snapshot.manifest.headSha }),
      files: snapshot.manifest.files.map((file) => {
        const {
          contentBase64: _contentBase64,
          contentComplete: _contentComplete,
          ...metadata
        } = file;
        return metadata;
      }),
      ignoredFiles: [...snapshot.manifest.ignoredFiles],
      complete: snapshot.manifest.complete,
    },
    permittedCapabilities: {
      readFiles: true,
      writeFiles: access === "WORKTREE_WRITE",
      executeCommands: false,
      network: false,
      publication: false,
    },
  };
}

interface LineEdit {
  readonly start: number;
  readonly end: number;
  readonly replacement: readonly string[];
}

function lineEdits(
  base: readonly string[],
  changed: readonly string[],
): LineEdit[] {
  const rows = base.length + 1;
  const columns = changed.length + 1;
  const lcs = Array.from({ length: rows }, () =>
    Array<number>(columns).fill(0),
  );
  for (let row = base.length - 1; row >= 0; row -= 1) {
    for (let column = changed.length - 1; column >= 0; column -= 1) {
      lcs[row]![column] =
        base[row] === changed[column]
          ? 1 + (lcs[row + 1]?.[column + 1] ?? 0)
          : Math.max(lcs[row + 1]?.[column] ?? 0, lcs[row]?.[column + 1] ?? 0);
    }
  }
  const edits: LineEdit[] = [];
  let baseIndex = 0;
  let changedIndex = 0;
  let editStart: number | undefined;
  let replacement: string[] = [];
  const flush = (end: number): void => {
    if (editStart === undefined) return;
    edits.push({ start: editStart, end, replacement });
    editStart = undefined;
    replacement = [];
  };
  while (baseIndex < base.length || changedIndex < changed.length) {
    if (
      baseIndex < base.length &&
      changedIndex < changed.length &&
      base[baseIndex] === changed[changedIndex]
    ) {
      flush(baseIndex);
      baseIndex += 1;
      changedIndex += 1;
      continue;
    }
    const deleteScore = lcs[baseIndex + 1]?.[changedIndex] ?? 0;
    const insertScore = lcs[baseIndex]?.[changedIndex + 1] ?? 0;
    if (
      baseIndex < base.length &&
      (changedIndex >= changed.length || deleteScore >= insertScore)
    ) {
      editStart ??= baseIndex;
      baseIndex += 1;
    } else {
      editStart ??= baseIndex;
      const value = changed[changedIndex];
      if (value !== undefined) replacement.push(value);
      changedIndex += 1;
    }
  }
  flush(base.length);
  return edits;
}

function rangesOverlap(left: LineEdit, right: LineEdit): boolean {
  if (left.start === left.end && right.start === right.end)
    return left.start === right.start;
  return left.start < right.end && right.start < left.end;
}

function applyEdits(
  base: readonly string[],
  edits: readonly LineEdit[],
): string[] {
  const ordered = [...edits].sort((left, right) => left.start - right.start);
  const result: string[] = [];
  let cursor = 0;
  for (const edit of ordered) {
    result.push(...base.slice(cursor, edit.start));
    result.push(...edit.replacement);
    cursor = edit.end;
  }
  result.push(...base.slice(cursor));
  return result;
}

function removeAiChange(
  base: Buffer,
  ai: Buffer,
  current: Buffer,
): { readonly ok: true; readonly content: Buffer } | { readonly ok: false } {
  if (ai.equals(current)) return { ok: true, content: base };
  if (base.equals(current)) return { ok: true, content: current };
  const baseLines = base.toString("utf8").split("\n");
  const aiLines = ai.toString("utf8").split("\n");
  const currentLines = current.toString("utf8").split("\n");
  const aiEdits = lineEdits(baseLines, aiLines);
  const manualEdits = lineEdits(baseLines, currentLines);
  if (
    aiEdits.some((aiEdit) =>
      manualEdits.some((manualEdit) => rangesOverlap(aiEdit, manualEdit)),
    )
  )
    return { ok: false };
  return {
    ok: true,
    content: Buffer.from(applyEdits(baseLines, manualEdits).join("\n"), "utf8"),
  };
}

function fileMapFromManifest(
  manifest: F13SnapshotManifest,
): Map<string, F13FileEvidence> {
  return new Map(manifest.files.map((file) => [file.path, file]));
}

export class F13WorktreeService {
  private readonly git: F13GitCommandRunner;
  private readonly now: () => string;
  private readonly defaultRoot?: string;
  private readonly registeredDeveloperClones: readonly string[];
  private readonly os?: F13OsPathAdapter;
  private readonly timeoutMs: number;

  public constructor(private readonly options: F13WorktreeServiceOptions) {
    this.git = options.git ?? createF13GitCommandRunner();
    this.now = options.now ?? defaultNow;
    this.defaultRoot = options.defaultRoot;
    this.registeredDeveloperClones = options.registeredDeveloperClones ?? [];
    this.os = options.os;
    this.timeoutMs = Math.max(
      250,
      Math.min(options.gitTimeoutMs ?? 60_000, 300_000),
    );
  }

  public async resolveRoot(input: {
    readonly worktreeRoot?: string;
    readonly developerClonePaths?: readonly string[];
    readonly rootRevision?: number;
    readonly correlationId?: string;
  }): Promise<F13RootResolution> {
    const correlationId = input.correlationId ?? "f13-root";
    const configuredPath = input.worktreeRoot ?? this.defaultRoot;
    const rootRevision = input.rootRevision ?? 1;
    if (
      configuredPath === undefined ||
      typeof configuredPath !== "string" ||
      !path.isAbsolute(configuredPath) ||
      !bytesWithin(configuredPath, F13_MAX_PATH_BYTES) ||
      configuredPath.includes("\u0000") ||
      configuredPath.includes("\r") ||
      configuredPath.includes("\n")
    )
      return {
        ok: false,
        rootRevision,
        ...(configuredPath === undefined ? {} : { configuredPath }),
        reason: safeReason(
          "WORKTREE_ROOT_INVALID",
          "VALIDATION",
          "The isolated-worktree root is not a bounded absolute path.",
          "Choose a local directory that is not the developer clone and does not contain untrusted path syntax.",
          "OPEN_SETTINGS",
          correlationId,
        ),
      };
    if (!Number.isInteger(rootRevision) || rootRevision < 0)
      return {
        ok: false,
        rootRevision,
        configuredPath,
        reason: safeReason(
          "WORKTREE_ROOT_REVISION_INVALID",
          "VALIDATION",
          "The isolated-worktree root revision is invalid.",
          "Reload the saved worktree setting before starting another operation.",
          "OPEN_SETTINGS",
          correlationId,
        ),
      };

    let canonicalPath: string;
    try {
      const info = await lstat(configuredPath);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error("not-directory");
      canonicalPath = await realpath(configuredPath);
      await access(
        canonicalPath,
        fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK,
      );
    } catch {
      return {
        ok: false,
        rootRevision,
        configuredPath,
        reason: safeReason(
          "WORKTREE_ROOT_UNAVAILABLE",
          "FILESYSTEM",
          "The isolated-worktree root is missing or not writable.",
          "Create or select an existing local directory with read and write access; F13 did not create or remove anything.",
          "OPEN_SETTINGS",
          correlationId,
        ),
      };
    }
    const clonePaths = [
      ...this.registeredDeveloperClones,
      ...(input.developerClonePaths ?? []),
    ];
    for (const clonePath of clonePaths) {
      if (
        !path.isAbsolute(clonePath) ||
        !bytesWithin(clonePath, F13_MAX_PATH_BYTES) ||
        clonePath.includes("\u0000") ||
        clonePath.includes("\r") ||
        clonePath.includes("\n")
      )
        return {
          ok: false,
          rootRevision,
          configuredPath,
          reason: safeReason(
            "DEVELOPER_CLONE_PATH_INVALID",
            "VALIDATION",
            "A registered developer clone path is invalid.",
            "F13 only compares the worktree root against bounded absolute clone paths.",
            "FIX_INPUT",
            correlationId,
          ),
        };
      let canonicalClone: string;
      try {
        canonicalClone = await realpath(clonePath);
      } catch {
        canonicalClone = path.resolve(clonePath);
      }
      if (
        pathWithin(canonicalClone, canonicalPath) ||
        pathWithin(canonicalPath, canonicalClone)
      )
        return {
          ok: false,
          rootRevision,
          configuredPath,
          reason: safeReason(
            "WORKTREE_ROOT_OVERLAPS_DEVELOPER_CLONE",
            "VALIDATION",
            "The isolated-worktree root overlaps a registered developer clone.",
            "Choose a separate application-owned directory so F13 cannot target developer work.",
            "OPEN_SETTINGS",
            correlationId,
          ),
        };
    }
    return { ok: true, configuredPath, canonicalPath, rootRevision };
  }

  public async prepare(
    input: F13OperationRequest,
  ): Promise<F13PreparationResult> {
    const validation = this.validateRequest(input);
    if (validation !== undefined) return { ok: false, reason: validation };
    const existing = this.options.repositories.getOperation(input.operationId);
    if (existing !== undefined) {
      const mismatch = this.validateAgainstExisting(input, existing);
      if (mismatch !== undefined)
        return this.failurePreparation(existing, mismatch);
      if (existing.lifecycle === "ACTIVE" || existing.lifecycle === "DIRTY") {
        const inspection = await this.inspectOperation(
          input.operationId,
          input.ownerId,
        );
        return {
          ok: inspection.ok,
          worktree: inspection.worktree,
          ...(inspection.snapshot === undefined ? {} : { inspection }),
          ...(inspection.reason === undefined
            ? {}
            : { reason: inspection.reason }),
        };
      }
      if (
        existing.lifecycle === "RETAINED" ||
        existing.lifecycle === "CLEARED" ||
        existing.lifecycle === "RELEASED"
      )
        return this.failurePreparation(
          existing,
          safeReason(
            "WORKTREE_MUTATION_NOT_ALLOWED",
            "CONFLICT",
            "The operation worktree is no longer open for a new preparation attempt.",
            "A retained, cleared, or released worktree requires an explicit new operation identity before mutation can resume.",
            "RECONCILE",
            input.correlationId,
          ),
        );
      return this.continuePreparation(input, existing);
    }

    const existingByKey =
      this.options.repositories.getOperationByIdempotencyKey(
        input.idempotencyKey,
      );
    if (
      existingByKey !== undefined &&
      existingByKey.operationId !== input.operationId
    )
      return {
        ok: false,
        reason: safeReason(
          "WORKTREE_IDEMPOTENCY_CONFLICT",
          "CONFLICT",
          "The idempotency key is already owned by another operation.",
          "F13 will not attach a new operation to an existing durable path or intent.",
          "RECONCILE",
          input.correlationId,
        ),
      };
    const root = await this.resolveRoot({
      worktreeRoot: input.worktreeRoot,
      developerClonePaths: [input.developerClonePath],
      rootRevision: operationRootRevision(input),
      correlationId: input.correlationId,
    });
    if (!root.ok || root.canonicalPath === undefined)
      return {
        ok: false,
        ...(root.reason === undefined ? {} : { reason: root.reason }),
      };
    const canonicalPath = this.deriveWorktreePath(root.canonicalPath, input);
    let intent: F13OperationIntentRecord;
    try {
      intent = this.options.repositories.reserveOperation({
        operationId: input.operationId,
        idempotencyKey: input.idempotencyKey,
        correlationId: input.correlationId,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        ...(input.managedPrId === undefined
          ? {}
          : { managedPrId: input.managedPrId }),
        developerClonePath: path.resolve(input.developerClonePath),
        operationKind: input.operationKind,
        worktreeId: worktreeIdFor(input.operationId),
        configuredRoot: root.canonicalPath,
        rootRevision: root.rootRevision,
        canonicalPath,
        sourceRepository: sourceRepository(input),
        ...(input.operationKind === "SYNCHRONIZATION"
          ? { destinationRepository: input.refs.destinationRepository }
          : {}),
        refs: input.refs,
        shaSnapshot: snapshotShaPayload(input),
        initialBaselineSha: expectedHeadSha(input),
      }).intent;
    } catch {
      return {
        ok: false,
        reason: safeReason(
          "WORKTREE_RESERVATION_CONFLICT",
          "CONFLICT",
          "The operation-owned path or identity could not be reserved.",
          "Another durable operation owns the path or idempotency identity; F13 did not perform Git or filesystem work.",
          "RECONCILE",
          input.correlationId,
        ),
      };
    }
    return this.continuePreparation(input, intent);
  }

  public async prepareReview(
    input: F13ReviewOperationRequest,
  ): Promise<F13PreparationResult> {
    return this.prepare(input);
  }

  public async prepareSynchronization(
    input: F13SynchronizationOperationRequest,
  ): Promise<F13PreparationResult> {
    return this.prepare(input);
  }

  /**
   * Reads both sides of the exact persisted synchronization graph.  The
   * caller cannot replace either SHA or repository identity after F13 has
   * reserved the operation.
   */
  public async readSynchronizationEvidence(input: {
    readonly operationId: string;
    readonly ownerId: string;
  }): Promise<F13SynchronizationEvidenceResult> {
    const intent = this.options.repositories.getOperation(input.operationId);
    if (intent === undefined)
      return {
        ok: false,
        worktree: this.placeholderWorktree(input.operationId),
        reason: safeReason(
          "WORKTREE_NOT_FOUND",
          "NOT_FOUND",
          "The synchronization worktree was not found in durable state.",
          "The operation must be reconciled before its exact Git evidence can be read.",
          "RECONCILE",
          "f13-sync-evidence",
        ),
      };
    if (intent.ownerId !== input.ownerId)
      return {
        ok: false,
        worktree: this.worktreeRecord(intent),
        reason: safeReason(
          "WORKTREE_OWNER_CONFLICT",
          "CONFLICT",
          "The synchronization evidence request does not own the operation worktree.",
          "F13 will not expose or mutate operation evidence to an unrelated owner.",
          "RECONCILE",
          intent.correlationId,
        ),
      };
    if (intent.operationKind !== "SYNCHRONIZATION")
      return {
        ok: false,
        worktree: this.worktreeRecord(intent),
        reason: safeReason(
          "OPERATION_KIND_MISMATCH",
          "VALIDATION",
          "The durable operation is not a synchronization operation.",
          "F25 cannot reuse a review or conversation worktree for synchronization.",
          "FIX_INPUT",
          intent.correlationId,
        ),
      };
    const refs = intent.refs as F13SynchronizationOperationRequest["refs"];
    let operation = intent;
    let mergeBaseSha = baseShaFromIntent(operation);
    if (!isSafeF13Sha(mergeBaseSha) || mergeBaseSha === refs.prHeadSha) {
      const mergeBase = await this.runGit(
        ["merge-base", refs.syncSourceSha, refs.prHeadSha],
        operation.canonicalPath,
        operation,
      );
      mergeBaseSha = mergeBase.stdout.trim();
      if (!mergeBase.ok || !isSafeF13Sha(mergeBaseSha))
        return {
          ok: false,
          worktree: this.worktreeRecord(operation),
          reason: safeReason(
            "MERGE_BASE_UNAVAILABLE",
            "GIT",
            "The synchronization merge base could not be read from the operation-owned repository.",
            "F25 will not compare source and destination changes without an exact common ancestor.",
            "RETRY",
            operation.correlationId,
          ),
        };
      try {
        operation = this.options.repositories.resolveSynchronizationMergeBase({
          operationId: operation.operationId,
          expectedVersion: operation.version,
          mergeBaseSha,
        });
      } catch {
        operation =
          this.options.repositories.getOperation(operation.operationId) ??
          operation;
      }
    }
    const sourceChangeEvidence = await this.readSynchronizationSideEvidence(
      operation,
      mergeBaseSha,
      refs.syncSourceSha,
      "SOURCE",
    );
    if (sourceChangeEvidence === undefined)
      return {
        ok: false,
        worktree: this.worktreeRecord(operation),
        mergeBaseSha,
        reason: safeReason(
          "SYNC_SOURCE_EVIDENCE_UNAVAILABLE",
          "GIT",
          "The exact source-side change evidence could not be read.",
          "F25 will not classify or merge a synchronization with incomplete source evidence.",
          "RETRY",
          operation.correlationId,
        ),
      };
    const destinationChangeEvidence =
      await this.readSynchronizationSideEvidence(
        operation,
        mergeBaseSha,
        refs.prHeadSha,
        "DESTINATION",
      );
    if (destinationChangeEvidence === undefined)
      return {
        ok: false,
        worktree: this.worktreeRecord(operation),
        mergeBaseSha,
        sourceChangeEvidence,
        reason: safeReason(
          "SYNC_DESTINATION_EVIDENCE_UNAVAILABLE",
          "GIT",
          "The exact destination-side change evidence could not be read.",
          "F25 will not classify or merge a synchronization with incomplete destination evidence.",
          "RETRY",
          operation.correlationId,
        ),
      };
    return {
      ok: true,
      worktree: this.worktreeRecord(operation),
      mergeBaseSha,
      sourceChangeEvidence,
      destinationChangeEvidence,
    };
  }

  /**
   * Performs only the deterministic, no-commit merge requested by F25.  A
   * conflict or an uncertain Git process leaves the operation-owned worktree
   * in place for F26; this method never selects ours/theirs and never commits.
   */
  public async mergeSynchronization(input: {
    readonly operationId: string;
    readonly ownerId: string;
    readonly signal?: AbortSignal;
  }): Promise<F13SynchronizationMergeResult> {
    const intent = this.options.repositories.getOperation(input.operationId);
    if (intent === undefined)
      return {
        ok: false,
        outcome: "FAILED",
        worktree: this.placeholderWorktree(input.operationId),
        conflictPaths: [],
        reason: safeReason(
          "WORKTREE_NOT_FOUND",
          "NOT_FOUND",
          "The synchronization worktree was not found in durable state.",
          "The operation must be reconciled before a no-commit merge can run.",
          "RECONCILE",
          "f13-sync-merge",
        ),
      };
    if (intent.ownerId !== input.ownerId)
      return {
        ok: false,
        outcome: "FAILED",
        worktree: this.worktreeRecord(intent),
        conflictPaths: [],
        reason: safeReason(
          "WORKTREE_OWNER_CONFLICT",
          "CONFLICT",
          "The synchronization merge request does not own the operation worktree.",
          "F13 will not grant merge authority to an unrelated owner.",
          "RECONCILE",
          intent.correlationId,
        ),
      };
    if (intent.operationKind !== "SYNCHRONIZATION")
      return {
        ok: false,
        outcome: "FAILED",
        worktree: this.worktreeRecord(intent),
        conflictPaths: [],
        reason: safeReason(
          "OPERATION_KIND_MISMATCH",
          "VALIDATION",
          "The durable operation is not a synchronization operation.",
          "F25 cannot merge a review or conversation worktree.",
          "FIX_INPUT",
          intent.correlationId,
        ),
      };
    const before = await this.inspectOperation(
      intent.operationId,
      input.ownerId,
      "INSPECTION",
    );
    if (!before.ok || before.condition.classification !== "CLEAN")
      return {
        ok: false,
        outcome:
          before.reason?.code === "GIT_CANCELLED" ? "UNCERTAIN" : "FAILED",
        worktree: before.worktree,
        inspection: before,
        conflictPaths: [],
        ...(before.reason === undefined
          ? {
              reason: safeReason(
                "SYNC_WORKTREE_NOT_CLEAN",
                "CONFLICT",
                "The synchronization worktree was not clean before merge.",
                "F25 will not overwrite or merge over pre-existing operation-owned changes.",
                "RECONCILE",
                intent.correlationId,
              ),
            }
          : { reason: before.reason }),
      };
    const refs = intent.refs as F13SynchronizationOperationRequest["refs"];
    const merge = await this.runGit(
      ["merge", "--no-commit", "--no-ff", "--", refs.syncSourceSha],
      intent.canonicalPath,
      intent,
      input.signal,
    );
    const after = await this.inspectOperation(
      intent.operationId,
      input.ownerId,
      "AFTER_MERGE",
    );
    const conflictPaths = this.conflictPaths(after);
    if (conflictPaths.length > 0) {
      const reason = safeReason(
        "SYNC_CONFLICT_DETECTED",
        "CONFLICT",
        "Git reported an unresolved synchronization conflict in the operation-owned worktree.",
        "F25 preserved the conflicting worktree and will not choose either side or create a commit.",
        "MANUAL_RESOLUTION",
        intent.correlationId,
      );
      try {
        this.options.repositories.updateLifecycle({
          operationId: intent.operationId,
          lifecycle: "CONFLICT",
          reason,
        });
      } catch {
        // The returned conflict evidence remains authoritative for F25/F26.
      }
      return {
        ok: false,
        outcome: "CONFLICT_DETECTED",
        worktree: after.worktree,
        inspection: after,
        conflictPaths,
        reason,
      };
    }
    if (!merge.ok) {
      const uncertain =
        merge.cancelled || merge.timedOut || merge.outputLimitExceeded;
      return {
        ok: false,
        outcome: uncertain ? "UNCERTAIN" : "FAILED",
        worktree: after.worktree,
        inspection: after,
        conflictPaths,
        reason: resultReason(merge, intent.correlationId, intent.operationId),
      };
    }
    if (!after.ok || after.condition.classification === "STALE_OR_UNKNOWN")
      return {
        ok: false,
        outcome: "UNCERTAIN",
        worktree: after.worktree,
        inspection: after,
        conflictPaths,
        ...(after.reason === undefined
          ? {
              reason: safeReason(
                "SYNC_MERGE_STATE_UNCERTAIN",
                "RECOVERY",
                "The no-commit merge completed but its resulting worktree state could not be confirmed.",
                "F25 preserved the operation-owned path and requires reconciliation before another effect.",
                "RECONCILE",
                intent.correlationId,
              ),
            }
          : { reason: after.reason }),
      };
    return {
      ok: true,
      outcome: "CLEAN_MERGE",
      worktree: after.worktree,
      inspection: after,
      conflictPaths: [],
    };
  }

  private async readSynchronizationSideEvidence(
    intent: F13OperationIntentRecord,
    baseSha: string,
    tipSha: string,
    side: "SOURCE" | "DESTINATION",
  ): Promise<F13SynchronizationChangeEvidence | undefined> {
    const result = await this.runGit(
      [
        "diff",
        "--name-status",
        "-z",
        "--find-renames",
        "--find-copies",
        baseSha,
        tipSha,
        "--",
      ],
      intent.canonicalPath,
      intent,
    );
    if (!result.ok) return undefined;
    const names = parseNameStatus(result.stdout);
    if (
      names.length > F13_MAX_FILE_COUNT ||
      names.some((file) => !bytesWithin(file.path, F13_MAX_PATH_BYTES))
    )
      return undefined;
    const files = names.map(
      (file) =>
        ({
          path: file.path,
          kind: file.kind,
          staged: false,
          worktreeChanged: true,
          ...(file.oldPath === undefined ? {} : { oldPath: file.oldPath }),
          ...(file.statusCode === undefined
            ? {}
            : { statusCode: file.statusCode }),
        }) satisfies F13FileEvidence,
    );
    return {
      schemaVersion: 1,
      side,
      baseSha,
      tipSha,
      files,
      evidenceHash: hashText(stableJson({ side, baseSha, tipSha, files })),
      complete: true,
    };
  }

  private conflictPaths(inspection: F13InspectionResult): readonly string[] {
    return (inspection.snapshot?.manifest.files ?? [])
      .filter((file) =>
        /^(?:DD|AU|UD|UA|DU|AA|UU)$/u.test(file.statusCode ?? ""),
      )
      .map((file) => file.path)
      .sort((left, right) => left.localeCompare(right));
  }

  private async continuePreparation(
    input: F13OperationRequest,
    intent: F13OperationIntentRecord,
  ): Promise<F13PreparationResult> {
    let operation = intent;
    try {
      this.assertOwner(input.ownerId, operation);
      operation = this.options.repositories.updateLifecycle({
        operationId: operation.operationId,
        expectedVersion: operation.version,
        lifecycle: "PREPARING",
      });
      const operationDirectory = path.dirname(operation.canonicalPath);
      const sourcePath = path.join(operationDirectory, "source-repository");
      if (!pathWithin(operation.configuredRoot, sourcePath))
        throw new F13ServiceFailure(
          safeReason(
            "OPERATION_SOURCE_OUTSIDE_ROOT",
            "VALIDATION",
            "The derived operation source path is outside the recorded root.",
            "The operation was not allowed to start with an unsafe path boundary.",
            "RECONCILE",
            operation.correlationId,
          ),
        );
      await mkdir(operationDirectory, { recursive: true });
      await this.ensureSourceRepository(input, operation, sourcePath);
      let mergeBaseSha: string | undefined;
      try {
        mergeBaseSha = await this.verifyRequestedObjects(
          input,
          operation,
          sourcePath,
        );
      } catch (error) {
        if (
          !(error instanceof F13ServiceFailure) ||
          error.reason.code !== "EXACT_OBJECT_UNAVAILABLE"
        )
          throw error;
        await this.materializeRequestedObjects(input, operation, sourcePath);
        mergeBaseSha = await this.verifyRequestedObjects(
          input,
          operation,
          sourcePath,
        );
      }
      if (mergeBaseSha !== undefined)
        operation = this.options.repositories.resolveSynchronizationMergeBase({
          operationId: operation.operationId,
          expectedVersion: operation.version,
          mergeBaseSha,
        });
      await this.ensureWorktree(input, operation, sourcePath);
      const inspection = await this.inspectOperation(
        operation.operationId,
        input.ownerId,
        "PREPARE",
      );
      if (!inspection.ok || inspection.reason !== undefined)
        return {
          ok: false,
          worktree: inspection.worktree,
          inspection,
          ...(inspection.reason === undefined
            ? {}
            : { reason: inspection.reason }),
        };
      return {
        ok: true,
        worktree: inspection.worktree,
        inspection,
      };
    } catch (error) {
      const reason =
        error instanceof F13ServiceFailure
          ? error.reason
          : safeReason(
              "WORKTREE_PREPARATION_FAILED",
              "RECOVERY",
              "The operation-owned worktree could not be prepared safely.",
              "The durable intent was preserved and can be reconciled or retried without changing the developer clone.",
              "RECONCILE",
              operation.correlationId,
            );
      try {
        this.options.repositories.updateLifecycle({
          operationId: operation.operationId,
          lifecycle: reason.category === "CONFLICT" ? "CONFLICT" : "UNKNOWN",
          reason,
        });
      } catch {
        // The original safe reason remains the service result; persistence will
        // be reconciled by the next startup scan.
      }
      this.emit(operation, reason.code, "Worktree preparation stopped safely.");
      return { ok: false, worktree: this.worktreeRecord(operation), reason };
    }
  }

  private validateAgainstExisting(
    input: F13OperationRequest,
    existing: F13OperationIntentRecord,
  ): F13SafeReason | undefined {
    if (
      existing.ownerId !== input.ownerId ||
      existing.ownerType !== input.ownerType
    )
      return safeReason(
        "WORKTREE_OWNER_CONFLICT",
        "CONFLICT",
        "The operation identity is owned by a different caller.",
        "A worktree cannot be claimed, inspected for mutation, or cleared by another operation owner.",
        "RECONCILE",
        input.correlationId,
      );
    if (existing.operationKind !== input.operationKind)
      return safeReason(
        "WORKTREE_OPERATION_KIND_CONFLICT",
        "CONFLICT",
        "The operation identity was previously reserved for another operation kind.",
        "Review, conversation, and synchronization worktrees are never interchangeable.",
        "RECONCILE",
        input.correlationId,
      );
    if (
      existing.managedPrId !== input.managedPrId ||
      !pathEqual(
        existing.developerClonePath,
        path.resolve(input.developerClonePath),
      )
    )
      return safeReason(
        "WORKTREE_INPUT_CONFLICT",
        "CONFLICT",
        "The operation identity was reused with a different approved local source or managed PR.",
        "F13 binds retries to the original validated clone and operation ownership evidence.",
        "RECONCILE",
        input.correlationId,
      );
    const existingRefs = existing.refs as Record<string, unknown>;
    const inputRefs =
      input.operationKind === "SYNCHRONIZATION" &&
      input.refs.syncMergeBaseSha === undefined &&
      typeof existingRefs.syncMergeBaseSha === "string"
        ? { ...input.refs, syncMergeBaseSha: existingRefs.syncMergeBaseSha }
        : input.refs;
    const existingShaSnapshot = existing.shaSnapshot as Record<string, unknown>;
    const inputShaSnapshot = snapshotShaPayload(input);
    const normalizedShaSnapshot =
      input.operationKind === "SYNCHRONIZATION" &&
      input.refs.syncMergeBaseSha === undefined &&
      typeof existingShaSnapshot.syncMergeBaseSha === "string"
        ? {
            ...inputShaSnapshot,
            syncMergeBaseSha: existingShaSnapshot.syncMergeBaseSha,
          }
        : inputShaSnapshot;
    if (
      !sameJson(existingRefs, inputRefs) ||
      !sameJson(existingShaSnapshot, normalizedShaSnapshot)
    )
      return safeReason(
        "WORKTREE_SNAPSHOT_CONFLICT",
        "CONFLICT",
        "The operation identity was reused with different repository or SHA snapshots.",
        "Immutable remote and baseline identities cannot be replaced by a retry.",
        "RECONCILE",
        input.correlationId,
      );
    return undefined;
  }

  private validateRequest(
    input: F13OperationRequest,
  ): F13SafeReason | undefined {
    const identifiers = [
      [input.operationId, "operation identifier"],
      [input.idempotencyKey, "operation idempotency key"],
      [input.ownerType, "operation owner type"],
      [input.ownerId, "operation owner identifier"],
      [input.correlationId, "correlation identifier"],
    ] as const;
    if (identifiers.some(([value]) => !isSafeF13Identifier(value)))
      return safeReason(
        "F13_IDENTIFIER_INVALID",
        "VALIDATION",
        "The operation contains an invalid or oversized identity.",
        "Use bounded provider-neutral identifiers without path separators or control characters.",
        "FIX_INPUT",
        input.correlationId,
      );
    if (
      !isF13OperationKind(input.operationKind) ||
      typeof input.developerClonePath !== "string" ||
      !path.isAbsolute(input.developerClonePath)
    )
      return safeReason(
        "F13_REQUEST_INVALID",
        "VALIDATION",
        "The worktree request is malformed.",
        "An explicit operation kind and absolute validated developer clone are required.",
        "FIX_INPUT",
        input.correlationId,
      );
    const repositories =
      input.operationKind === "SYNCHRONIZATION"
        ? [input.refs.sourceRepository, input.refs.destinationRepository]
        : [input.refs.baseRepository, input.refs.headRepository];
    for (const repository of repositories) {
      if (
        !isSafeF13Identifier(repository.serverId) ||
        !isSafeF13Identifier(repository.owner) ||
        !isSafeF13Identifier(repository.name)
      )
        return safeReason(
          "REPOSITORY_IDENTITY_INVALID",
          "VALIDATION",
          "The request does not contain a bounded server-scoped repository identity.",
          "F13 requires explicit repository identity and will not select a same-named repository or default branch.",
          "FIX_INPUT",
          input.correlationId,
        );
      if (
        repository.key !== undefined &&
        !isSafeF13RepositoryKey(repository.key)
      )
        return safeReason(
          "REPOSITORY_KEY_INVALID",
          "VALIDATION",
          "The repository identity key is invalid.",
          "Use the provider-neutral repository key supplied by the GitHub identity boundary.",
          "FIX_INPUT",
          input.correlationId,
        );
    }
    if (
      input.developerCloneRepository !== undefined &&
      !sameJson(input.developerCloneRepository, sourceRepository(input))
    )
      return safeReason(
        "DEVELOPER_CLONE_REPOSITORY_MISMATCH",
        "CONFLICT",
        "The declared developer clone identity does not match the requested source repository.",
        "F13 will not use a local clone as a substitute for a different server-scoped repository.",
        "FIX_INPUT",
        input.correlationId,
      );
    const branches =
      input.operationKind === "SYNCHRONIZATION"
        ? [input.refs.sourceBranch, input.refs.destinationBranch]
        : [input.refs.baseBranch, input.refs.headBranch];
    if (branches.some((branch) => !isSafeF13Branch(branch)))
      return safeReason(
        "REF_INVALID",
        "VALIDATION",
        "The request contains an invalid branch or ref name.",
        "F13 only materializes the explicit bounded refs supplied by the owning workflow.",
        "FIX_INPUT",
        input.correlationId,
      );
    const shas =
      input.operationKind === "SYNCHRONIZATION"
        ? [
            input.refs.syncSourceSha,
            input.refs.prHeadSha,
            input.refs.syncMergeBaseSha,
          ]
        : [input.refs.prBaseSha, input.refs.prHeadSha];
    if (shas.some((sha) => sha !== undefined && !isSafeF13Sha(sha)))
      return safeReason(
        "SHA_INVALID",
        "VALIDATION",
        "The request contains a malformed commit SHA.",
        "F13 requires exact bounded commit identities and never guesses a replacement ref.",
        "FIX_INPUT",
        input.correlationId,
      );
    if (!bytesWithin(input.developerClonePath, F13_MAX_PATH_BYTES))
      return safeReason(
        "DEVELOPER_CLONE_PATH_INVALID",
        "VALIDATION",
        "The validated developer clone path is oversized.",
        "Select a shorter validated local clone; F13 did not inspect or mutate it.",
        "FIX_INPUT",
        input.correlationId,
      );
    if (
      input.developerClonePath.includes("\u0000") ||
      input.developerClonePath.includes("\r") ||
      input.developerClonePath.includes("\n")
    )
      return safeReason(
        "DEVELOPER_CLONE_PATH_INVALID",
        "VALIDATION",
        "The validated developer clone path contains control characters.",
        "F13 only passes a bounded canonical filesystem path to the Git boundary.",
        "FIX_INPUT",
        input.correlationId,
      );
    return undefined;
  }

  private deriveWorktreePath(root: string, input: F13OperationRequest): string {
    const repository = operationRepository(input);
    const candidate = path.join(
      root,
      "operations",
      repository.serverId,
      repository.owner,
      repository.name,
      input.operationKind.toLowerCase(),
      input.operationId,
      "worktree",
    );
    if (
      !bytesWithin(candidate, F13_MAX_PATH_BYTES) ||
      !pathWithin(root, candidate)
    )
      throw new F13ServiceFailure(
        safeReason(
          "WORKTREE_PATH_INVALID",
          "VALIDATION",
          "The derived operation path exceeds the local path policy.",
          "Use shorter bounded repository and operation identities or choose a shorter root.",
          "OPEN_SETTINGS",
          input.correlationId,
        ),
      );
    return candidate;
  }

  private assertOwner(ownerId: string, intent: F13OperationIntentRecord): void {
    if (ownerId !== intent.ownerId)
      throw new F13ServiceFailure(
        safeReason(
          "WORKTREE_OWNER_CONFLICT",
          "CONFLICT",
          "The declared operation owner does not own this worktree.",
          "F13 refused to inspect for mutation or change a worktree owned by another operation.",
          "RECONCILE",
          intent.correlationId,
        ),
      );
  }

  private async ensureSourceRepository(
    input: F13OperationRequest,
    intent: F13OperationIntentRecord,
    sourcePath: string,
  ): Promise<void> {
    const developerClone = await lstat(input.developerClonePath).catch(
      () => undefined,
    );
    if (developerClone === undefined)
      throw new F13ServiceFailure(
        safeReason(
          "LOCAL_CLONE_REQUIRED",
          "NOT_FOUND",
          "The approved developer clone is missing.",
          "F13 requires the F07-validated local source and will not silently choose another repository or default branch.",
          "OPEN_SETTINGS",
          intent.correlationId,
        ),
      );
    if (!developerClone.isDirectory() || developerClone.isSymbolicLink())
      throw new F13ServiceFailure(
        safeReason(
          "LOCAL_CLONE_INVALID",
          "VALIDATION",
          "The approved developer clone is not a real local directory.",
          "F13 will not follow a symlink or use a non-directory as the source for operation-owned Git data.",
          "OPEN_SETTINGS",
          intent.correlationId,
        ),
      );
    const sourceEntry = await lstat(sourcePath).catch(() => undefined);
    if (sourceEntry?.isSymbolicLink())
      throw new F13ServiceFailure(
        safeReason(
          "OPERATION_SOURCE_INVALID",
          "FILESYSTEM",
          "The operation-owned source path is a symbolic link.",
          "F13 keeps operation-owned Git data beneath the recorded root and will not follow a redirected source path.",
          "RECONCILE",
          intent.correlationId,
        ),
      );
    const exists = sourceEntry?.isDirectory() === true;
    if (!exists) {
      const result = await this.runGit(
        [
          "clone",
          "--no-hardlinks",
          "--no-checkout",
          "--",
          input.developerClonePath,
          sourcePath,
        ],
        path.dirname(sourcePath),
        intent,
      );
      if (!result.ok)
        throw new F13ServiceFailure(
          resultReason(result, intent.correlationId, intent.operationId),
        );
    }
    const root = await this.gitRoot(sourcePath, intent);
    if (
      root === undefined ||
      !pathWithin(intent.configuredRoot, root) ||
      pathEqual(root, path.resolve(input.developerClonePath))
    )
      throw new F13ServiceFailure(
        safeReason(
          "OPERATION_SOURCE_INVALID",
          "GIT",
          "The operation-owned Git source could not be proven separate from the developer clone.",
          "F13 requires a separate source/cache before creating a worktree.",
          "RECONCILE",
          intent.correlationId,
        ),
      );
    const bare = await this.runGit(
      ["rev-parse", "--is-bare-repository"],
      sourcePath,
      intent,
    );
    if (!bare.ok || bare.stdout.trim() !== "false")
      throw new F13ServiceFailure(
        safeReason(
          "OPERATION_SOURCE_NOT_WORKTREE",
          "GIT",
          "The operation-owned Git source is not a usable non-bare repository.",
          "F13 cannot safely prepare an isolated worktree from this source.",
          "RECONCILE",
          intent.correlationId,
        ),
      );
  }

  private async gitRoot(
    directory: string,
    intent: F13OperationIntentRecord,
  ): Promise<string | undefined> {
    const result = await this.runGit(
      ["rev-parse", "--show-toplevel"],
      directory,
      intent,
    );
    if (!result.ok) return undefined;
    try {
      return await realpath(result.stdout.trim());
    } catch {
      return undefined;
    }
  }

  private mutationBlockReason(
    intent: F13OperationIntentRecord,
  ): F13SafeReason | undefined {
    if (intent.lifecycle === "ACTIVE" || intent.lifecycle === "DIRTY")
      return undefined;
    return safeReason(
      "WORKTREE_MUTATION_NOT_ALLOWED",
      "CONFLICT",
      "The operation worktree is not in an owner-mutable lifecycle.",
      "F13 preserves retained, cleared, released, interrupted, and uncertain worktrees until the owning workflow explicitly reconciles them.",
      "RECONCILE",
      intent.correlationId,
    );
  }

  private async verifyRequestedObjects(
    input: F13OperationRequest,
    intent: F13OperationIntentRecord,
    sourcePath: string,
  ): Promise<string | undefined> {
    const shas =
      input.operationKind === "SYNCHRONIZATION"
        ? [
            input.refs.syncSourceSha,
            input.refs.prHeadSha,
            input.refs.syncMergeBaseSha,
          ]
        : [input.refs.prBaseSha, input.refs.prHeadSha];
    for (const sha of shas) {
      if (sha === undefined) continue;
      const result = await this.runGit(
        ["rev-parse", "--verify", "--quiet", `${sha}^{commit}`],
        sourcePath,
        intent,
      );
      if (
        !result.ok ||
        result.stdout.trim().toLowerCase() !== sha.toLowerCase()
      )
        throw new F13ServiceFailure(
          safeReason(
            "EXACT_OBJECT_UNAVAILABLE",
            "GIT",
            "The exact requested commit object is not available in the approved source.",
            "F13 will not fetch an implicit ref, choose a default branch, or substitute a same-named repository.",
            "RETRY",
            intent.correlationId,
          ),
        );
    }
    if (input.operationKind === "SYNCHRONIZATION") {
      const result = await this.runGit(
        ["merge-base", input.refs.syncSourceSha, input.refs.prHeadSha],
        sourcePath,
        intent,
      );
      const mergeBaseSha = result.stdout.trim();
      if (!result.ok || !isSafeF13Sha(mergeBaseSha))
        throw new F13ServiceFailure(
          safeReason(
            "MERGE_BASE_UNAVAILABLE",
            "GIT",
            "The synchronization merge base could not be calculated deterministically.",
            "The synchronization workflow must re-resolve the exact source and PR-head objects.",
            "RETRY",
            intent.correlationId,
          ),
        );
      if (
        input.refs.syncMergeBaseSha !== undefined &&
        mergeBaseSha.toLowerCase() !== input.refs.syncMergeBaseSha.toLowerCase()
      )
        throw new F13ServiceFailure(
          safeReason(
            "SYNC_MERGE_BASE_MISMATCH",
            "CONFLICT",
            "The supplied synchronization merge base does not match the approved source and PR-head objects.",
            "F13 will not describe source-side changes from a caller-supplied merge base that Git cannot reproduce.",
            "RETRY",
            intent.correlationId,
          ),
        );
      return input.refs.syncMergeBaseSha === undefined
        ? mergeBaseSha
        : undefined;
    }
    return undefined;
  }

  private async materializeRequestedObjects(
    input: F13OperationRequest,
    intent: F13OperationIntentRecord,
    sourcePath: string,
  ): Promise<void> {
    const requested =
      input.operationKind === "SYNCHRONIZATION"
        ? [
            input.refs.syncSourceSha,
            input.refs.prHeadSha,
            input.refs.syncMergeBaseSha,
          ]
        : [input.refs.prBaseSha, input.refs.prHeadSha];
    for (const sha of [...new Set(requested)]) {
      if (sha === undefined) continue;
      const result = await this.runGit(
        ["fetch", "--no-tags", "--no-prune", input.developerClonePath, sha],
        sourcePath,
        intent,
      );
      if (!result.ok)
        throw new F13ServiceFailure(
          safeReason(
            "EXACT_OBJECT_MATERIALIZATION_FAILED",
            "GIT",
            "The requested commit could not be materialized in the operation-owned source.",
            "F13 fetched only the explicit SHA from the approved local clone and did not guess another ref or repository.",
            "RETRY",
            intent.correlationId,
          ),
        );
    }
  }

  private async ensureWorktree(
    input: F13OperationRequest,
    intent: F13OperationIntentRecord,
    sourcePath: string,
  ): Promise<void> {
    const worktreeEntry = await lstat(intent.canonicalPath).catch(
      () => undefined,
    );
    if (worktreeEntry?.isSymbolicLink())
      throw new F13ServiceFailure(
        safeReason(
          "WORKTREE_PATH_UNAVAILABLE",
          "FILESYSTEM",
          "The operation worktree path is a symbolic link.",
          "F13 will not attach or inspect a redirected path as an operation-owned worktree.",
          "RECONCILE",
          intent.correlationId,
        ),
      );
    const exists = worktreeEntry?.isDirectory() === true;
    if (!exists) {
      const result = await this.runGit(
        [
          "worktree",
          "add",
          "--detach",
          intent.canonicalPath,
          expectedHeadSha(input),
        ],
        sourcePath,
        intent,
      );
      if (!result.ok) {
        const reason =
          result.timedOut || result.cancelled || result.outputLimitExceeded
            ? resultReason(result, intent.correlationId, intent.operationId)
            : safeReason(
                "WORKTREE_CREATE_FAILED",
                "GIT",
                "Git could not create the operation-owned detached worktree.",
                "The path was left for reconciliation rather than being silently removed.",
                "RECONCILE",
                intent.correlationId,
              );
        throw new F13ServiceFailure(reason);
      }
    }
    const registered = await this.isRegisteredWorktree(intent, sourcePath);
    if (!registered)
      throw new F13ServiceFailure(
        safeReason(
          "WORKTREE_NOT_REGISTERED",
          "STALE",
          "The operation path is not registered by the operation-owned Git source.",
          "F13 will not trust a replacement directory that merely happens to contain the requested commit.",
          "RECONCILE",
          intent.correlationId,
        ),
      );
    const head = await this.runGit(
      ["rev-parse", "HEAD"],
      intent.canonicalPath,
      intent,
    );
    if (
      !head.ok ||
      head.stdout.trim().toLowerCase() !== expectedHeadSha(input).toLowerCase()
    )
      throw new F13ServiceFailure(
        safeReason(
          "WORKTREE_HEAD_MISMATCH",
          "STALE",
          "The operation worktree is not checked out at the requested PR-head SHA.",
          "F13 will not report a worktree ready when its exact baseline cannot be proven.",
          "RECONCILE",
          intent.correlationId,
        ),
      );
  }

  private async isRegisteredWorktree(
    intent: F13OperationIntentRecord,
    sourcePath: string,
  ): Promise<boolean> {
    const listed = await this.runGit(
      ["worktree", "list", "--porcelain"],
      sourcePath,
      intent,
    );
    if (!listed.ok) return false;
    return listed.stdout
      .split(/\r?\n/u)
      .filter((line) => line.startsWith("worktree "))
      .map((line) => path.resolve(line.slice("worktree ".length).trim()))
      .some((candidate) => pathEqual(candidate, intent.canonicalPath));
  }

  private async runGit(
    args: readonly string[],
    cwd: string,
    intent: F13OperationIntentRecord,
    signal?: AbortSignal,
  ): Promise<F13GitCommandResult> {
    const result = await this.git.run(args, {
      cwd,
      timeoutMs: this.timeoutMs,
      signal,
    });
    if (!result.ok)
      this.emit(
        intent,
        "GIT_COMMAND_FAILED",
        "A bounded Git operation did not complete.",
      );
    return result;
  }

  public async inspectOperation(
    operationId: string,
    ownerId: string,
    phase: F13SnapshotPhase = "INSPECTION",
  ): Promise<F13InspectionResult> {
    const intent = this.options.repositories.getOperation(operationId);
    if (intent === undefined) {
      const reason = safeReason(
        "WORKTREE_NOT_FOUND",
        "NOT_FOUND",
        "The requested operation-owned worktree does not exist in durable state.",
        "Refresh the operation list before attempting another action.",
        "RECONCILE",
        "f13-inspect",
      );
      return {
        ok: false,
        worktree: this.placeholderWorktree(operationId),
        condition: worktreeCondition({ expectedRevision: "UNKNOWN" }),
        reason,
      };
    }
    if (ownerId !== intent.ownerId) {
      const reason = safeReason(
        "WORKTREE_OWNER_CONFLICT",
        "CONFLICT",
        "The declared operation owner cannot inspect this worktree for mutation.",
        "Only the recorded owner may request operation-bound mutation or cleanup; unrelated worktrees are not inspected.",
        "RECONCILE",
        intent.correlationId,
      );
      return {
        ok: false,
        worktree: this.worktreeRecord(intent),
        condition: worktreeCondition({
          expectedRevision: expectedHeadFromIntent(intent),
        }),
        reason,
      };
    }
    return this.inspectInternal(intent, phase);
  }

  public readClearAction(input: {
    readonly actionId: string;
    readonly operationId: string;
    readonly ownerId: string;
    readonly choice: F13ClearChoice;
  }): F13ClearActionRecord | undefined {
    const intent = this.options.repositories.getOperation(input.operationId);
    if (intent === undefined || intent.ownerId !== input.ownerId)
      return undefined;
    const action = this.options.repositories.getClearAction(input.actionId);
    if (
      action === undefined ||
      action.operationId !== intent.operationId ||
      action.worktreeId !== intent.worktreeId ||
      action.choice !== input.choice
    )
      return undefined;
    return action;
  }

  /**
   * Read-only provider context.  The path and state are derived from the
   * durable operation intent and a fresh inspection; callers cannot submit a
   * replacement path or provider-reported Git state through this API.
   */
  public async getProviderWorktreeHandoff(input: {
    readonly operationId: string;
    readonly ownerId: string;
  }): Promise<F13ProviderWorktreeHandoffResult> {
    const inspection = await this.inspectOperation(
      input.operationId,
      input.ownerId,
      "INSPECTION",
    );
    if (!inspection.ok || inspection.snapshot === undefined)
      return {
        ok: false,
        ...(inspection.reason === undefined
          ? {}
          : { reason: inspection.reason }),
      };
    return {
      ok: true,
      handoff: providerWorktreeHandoff({
        worktree: inspection.worktree,
        snapshot: inspection.snapshot,
        access: "READ_ONLY",
      }),
    };
  }

  private async inspectInternal(
    intent: F13OperationIntentRecord,
    phase: F13SnapshotPhase,
    turnId?: string,
    captureTree = phase === "BEFORE_AI" ||
      phase === "AFTER_AI" ||
      phase === "AFTER_MERGE" ||
      phase === "CLEAR_BEFORE" ||
      phase === "CLEAR_AFTER",
  ): Promise<F13InspectionResult> {
    try {
      const actual = await this.collectActualState(
        intent,
        phase,
        turnId,
        captureTree,
      );
      const snapshotId = snapshotIdFor(intent.operationId, phase, turnId);
      const snapshot = this.options.repositories.saveSnapshot({
        snapshotId,
        operationId: intent.operationId,
        worktreeId: intent.worktreeId,
        phase,
        ...(turnId === undefined ? {} : { turnId }),
        stateFingerprint: actual.manifest.stateFingerprint,
        manifest: actual.manifest,
      });
      const aiTurnPairs = this.aiTurnPairsForCondition(
        intent.operationId,
        phase,
        turnId,
        snapshot,
      );
      const condition = worktreeCondition({
        expectedRevision: expectedHeadFromIntent(intent),
        actual,
        currentSnapshot: snapshot,
        ...(aiTurnPairs.length === 0 ? {} : { aiTurnPairs }),
      });
      const proposedDiff = await this.materializeDiff(
        intent,
        actual,
        "PROPOSED",
      );
      const contextDiff = await this.materializeDiff(intent, actual, "CONTEXT");
      const stale = actual.manifest.headSha !== expectedHeadFromIntent(intent);
      const conditionReason =
        condition.classification === "STALE_OR_UNKNOWN" && !stale
          ? safeReason(
              "WORKTREE_CONDITION_UNVERIFIED",
              "RECOVERY",
              "The current worktree condition could not be verified completely.",
              "F13 preserved the worktree and will not let downstream actions rely on incomplete evidence.",
              "RECONCILE",
              intent.correlationId,
            )
          : undefined;
      const terminalLifecycle =
        intent.lifecycle === "RETAINED" ||
        intent.lifecycle === "CLEARED" ||
        intent.lifecycle === "RELEASED";
      const lifecycle = terminalLifecycle
        ? intent.lifecycle
        : stale || conditionReason !== undefined
          ? "UNKNOWN"
          : actual.dirty
            ? "DIRTY"
            : "ACTIVE";
      const reason = stale
        ? safeReason(
            "WORKTREE_HEAD_MOVED",
            "STALE",
            "The operation worktree HEAD moved away from its recorded baseline.",
            "F13 preserved the worktree and evidence; the owning workflow must explicitly re-evaluate it.",
            "RECONCILE",
            intent.correlationId,
          )
        : conditionReason;
      const updated = this.options.repositories.updateLifecycle({
        operationId: intent.operationId,
        lifecycle,
        currentSha: actual.manifest.headSha,
        reason: reason ?? intent.reason,
        payload: {
          stateFingerprint: actual.manifest.stateFingerprint,
          snapshotId,
          proposedDiffId: proposedDiff.diffId,
          contextDiffId: contextDiff.diffId,
        },
      });
      const updatedWorktree = this.worktreeRecord(updated);
      this.emit(
        intent,
        "WORKTREE_INSPECTED",
        "The current operation worktree state was inspected.",
      );
      return {
        ok: !stale && conditionReason === undefined,
        worktree: updatedWorktree,
        condition,
        snapshot,
        proposedDiff,
        contextDiff,
        ...(reason === undefined ? {} : { reason }),
      };
    } catch (error) {
      const reason =
        error instanceof F13ServiceFailure
          ? error.reason
          : safeReason(
              "WORKTREE_INSPECTION_FAILED",
              "RECOVERY",
              "The current operation worktree state could not be inspected completely.",
              "Previous immutable evidence was preserved and the worktree needs reconciliation before downstream work.",
              "RECONCILE",
              intent.correlationId,
            );
      try {
        this.options.repositories.updateLifecycle({
          operationId: intent.operationId,
          lifecycle: "UNKNOWN",
          reason,
        });
      } catch {
        // Preserve the service reason even when a persistence retry is needed.
      }
      this.emit(
        intent,
        reason.code,
        "Worktree inspection returned an attention result.",
      );
      return {
        ok: false,
        worktree: this.worktreeRecord(intent),
        condition: worktreeCondition({
          expectedRevision: expectedHeadFromIntent(intent),
        }),
        reason,
      };
    }
  }

  private async collectActualState(
    intent: F13OperationIntentRecord,
    phase: F13SnapshotPhase,
    turnId: string | undefined,
    captureTree: boolean,
  ): Promise<ActualState> {
    let info: Awaited<ReturnType<typeof lstat>>;
    try {
      info = await lstat(intent.canonicalPath);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error("not-directory");
      const canonical = await realpath(intent.canonicalPath);
      if (!pathEqual(canonical, intent.canonicalPath))
        throw new Error("path-moved");
    } catch {
      throw new F13ServiceFailure(
        safeReason(
          "WORKTREE_PATH_UNAVAILABLE",
          "FILESYSTEM",
          "The recorded operation worktree path is missing or moved.",
          "F13 preserved the durable record and will not recreate or remove an uncertain path implicitly.",
          "RECONCILE",
          intent.correlationId,
        ),
      );
    }
    const sourcePath = path.join(
      path.dirname(intent.canonicalPath),
      "source-repository",
    );
    const sourceEntry = await lstat(sourcePath).catch(() => undefined);
    if (
      sourceEntry === undefined ||
      !sourceEntry.isDirectory() ||
      sourceEntry.isSymbolicLink() ||
      !(await this.isRegisteredWorktree(intent, sourcePath))
    )
      throw new F13ServiceFailure(
        safeReason(
          "WORKTREE_REGISTRATION_UNPROVEN",
          "RECOVERY",
          "The recorded worktree is not provably attached to its operation-owned Git source.",
          "F13 preserved the durable operation and will not trust a replacement repository at the same filesystem path.",
          "RECONCILE",
          intent.correlationId,
        ),
      );
    const headResult = await this.runGit(
      ["rev-parse", "HEAD"],
      intent.canonicalPath,
      intent,
    );
    if (!headResult.ok)
      throw new F13ServiceFailure(
        resultReason(headResult, intent.correlationId, intent.operationId),
      );
    const statusResult = await this.runGit(
      [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--ignored=matching",
      ],
      intent.canonicalPath,
      intent,
    );
    if (!statusResult.ok)
      throw new F13ServiceFailure(
        resultReason(statusResult, intent.correlationId, intent.operationId),
      );
    const parsed = parseStatus(statusResult.stdout);
    if (
      parsed.files.length > F13_MAX_FILE_COUNT ||
      parsed.ignored.length > F13_MAX_FILE_COUNT
    )
      throw new F13ServiceFailure(
        safeReason(
          "SNAPSHOT_FILE_LIMIT",
          "LIMIT",
          "The operation worktree contains more changed or ignored files than F13 can snapshot safely.",
          "F13 will not truncate actual state and present an incomplete manifest as authoritative.",
          "RETRY",
          intent.correlationId,
        ),
      );
    const manifestFiles = captureTree
      ? await this.captureTrackedTree(intent, parsed.files)
      : await this.enrichStatusFiles(intent, parsed.files);
    const ignoredEvidence = await this.captureIgnoredEvidence(
      intent,
      parsed.ignored,
    );
    const complete =
      manifestFiles.length <= F13_MAX_FILE_COUNT &&
      manifestFiles.every((file) => file.contentComplete !== false);
    const fileMap = new Map(manifestFiles.map((file) => [file.path, file]));
    const statusHash = hashText(statusResult.stdout);
    const headSha = headResult.stdout.trim();
    const fingerprintPayload = {
      headSha,
      status: statusHash,
      files: manifestFiles,
      ignored: parsed.ignored,
      ignoredEvidence,
    };
    const stateFingerprint = hashText(stableJson(fingerprintPayload));
    const snapshotManifest: F13SnapshotManifest = {
      schemaVersion: 1,
      operationId: intent.operationId,
      worktreeId: intent.worktreeId,
      phase,
      ...(turnId === undefined ? {} : { turnId }),
      headSha,
      expectedHeadSha: expectedHeadFromIntent(intent),
      prBaseSha: baseShaFromIntent(intent),
      worktreeBaselineSha: baselineShaFromIntent(intent),
      files: manifestFiles,
      ignoredFiles: parsed.ignored,
      statusTextHash: statusHash,
      stateFingerprint,
      complete,
      gitErrors: [],
      capturedAt: this.now(),
    };
    return {
      manifest: snapshotManifest,
      statusText: statusResult.stdout,
      dirty: parsed.files.length > 0,
      fileMap,
    };
  }

  private async enrichStatusFiles(
    intent: F13OperationIntentRecord,
    statusFiles: readonly InternalFileEvidence[],
  ): Promise<InternalFileEvidence[]> {
    const files: InternalFileEvidence[] = [];
    for (const file of statusFiles) {
      const content = await this.readContent(intent.canonicalPath, file.path);
      if (!content.exists) {
        files.push({
          ...file,
          ...(file.kind === "deleted" ? { contentComplete: true } : {}),
        });
        continue;
      }
      files.push({
        ...file,
        ...(content.hash === undefined ? {} : { contentHash: content.hash }),
        ...(content.sizeBytes === undefined
          ? {}
          : { sizeBytes: content.sizeBytes }),
        ...(content.binary === undefined ? {} : { binary: content.binary }),
        contentComplete: content.complete,
      });
    }
    return files;
  }

  private async captureIgnoredEvidence(
    intent: F13OperationIntentRecord,
    paths: readonly string[],
  ): Promise<readonly Record<string, unknown>[]> {
    const evidence: Record<string, unknown>[] = [];
    for (const filePath of paths) {
      const content = await this.readContent(intent.canonicalPath, filePath);
      evidence.push({
        path: filePath,
        exists: content.exists,
        ...(content.hash === undefined ? {} : { hash: content.hash }),
        ...(content.sizeBytes === undefined
          ? {}
          : { sizeBytes: content.sizeBytes }),
        ...(content.binary === undefined ? {} : { binary: content.binary }),
        complete: content.complete,
      });
    }
    return evidence;
  }

  private async captureTrackedTree(
    intent: F13OperationIntentRecord,
    statusFiles: readonly InternalFileEvidence[],
  ): Promise<InternalFileEvidence[]> {
    const tracked = await this.runGit(
      ["ls-files", "-z", "--cached"],
      intent.canonicalPath,
      intent,
    );
    if (!tracked.ok)
      throw new F13ServiceFailure(
        resultReason(tracked, intent.correlationId, intent.operationId),
      );
    const paths = new Set<string>();
    for (const value of tracked.stdout.split("\0")) {
      if (value.length > 0) paths.add(value.replaceAll("\\", "/"));
    }
    for (const file of statusFiles) paths.add(file.path);
    if (paths.size > F13_MAX_FILE_COUNT)
      throw new F13ServiceFailure(
        safeReason(
          "SNAPSHOT_FILE_LIMIT",
          "LIMIT",
          "The operation worktree contains more files than F13 can snapshot safely.",
          "No incomplete manifest is treated as authoritative for downstream work.",
          "RETRY",
          intent.correlationId,
        ),
      );
    const statusByPath = new Map(statusFiles.map((file) => [file.path, file]));
    const files: InternalFileEvidence[] = [];
    let bytes = 0;
    for (const filePath of [...paths].sort((left, right) =>
      left.localeCompare(right),
    )) {
      const status = statusByPath.get(filePath);
      const content = await this.readContent(intent.canonicalPath, filePath);
      const base: InternalFileEvidence = status ?? {
        path: filePath,
        kind: "unknown",
        staged: false,
        worktreeChanged: false,
      };
      const contentBase64 =
        content.content === undefined
          ? undefined
          : content.content.toString("base64");
      const nextBytes =
        bytes +
        (contentBase64 === undefined
          ? 0
          : Buffer.byteLength(contentBase64, "utf8"));
      const canPersistContent = content.complete && nextBytes <= 450 * 1024;
      if (canPersistContent) bytes = nextBytes;
      files.push({
        ...base,
        ...(content.hash === undefined ? {} : { contentHash: content.hash }),
        ...(content.sizeBytes === undefined
          ? {}
          : { sizeBytes: content.sizeBytes }),
        ...(content.binary === undefined ? {} : { binary: content.binary }),
        ...(canPersistContent && contentBase64 !== undefined
          ? { contentBase64, contentComplete: true }
          : { contentComplete: false }),
      });
    }
    return files;
  }

  private async readContent(
    worktree: string,
    relativePath: string,
  ): Promise<ContentValue> {
    if (
      !isRelativePath(relativePath) ||
      !bytesWithin(relativePath, F13_MAX_PATH_BYTES)
    )
      return { exists: false, complete: false };
    const candidate = path.resolve(worktree, relativePath);
    if (!pathWithin(worktree, candidate))
      return { exists: false, complete: false };
    try {
      const fileInfo = await lstat(candidate);
      if (!fileInfo.isFile() || fileInfo.isSymbolicLink())
        return { exists: false, complete: false };
      const canonical = await realpath(candidate);
      if (!pathWithin(worktree, canonical))
        return { exists: false, complete: false };
      const hash = createHash("sha256");
      const chunks: Buffer[] = [];
      let total = 0;
      let binary = false;
      const stream = createReadStream(canonical);
      for await (const chunk of stream) {
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        hash.update(value);
        if (value.includes(0)) binary = true;
        if (total <= F13_MAX_SNAPSHOT_FILE_BYTES) chunks.push(value);
        total += value.byteLength;
      }
      const complete = total <= F13_MAX_SNAPSHOT_FILE_BYTES;
      return {
        exists: true,
        hash: hash.digest("hex"),
        sizeBytes: total,
        ...(complete ? { content: Buffer.concat(chunks) } : {}),
        binary,
        complete,
      };
    } catch {
      return { exists: false, complete: false };
    }
  }

  private async materializeDiff(
    intent: F13OperationIntentRecord,
    actual: ActualState,
    kind: F13DiffKind,
  ): Promise<F13DiffEvidence> {
    const baseline =
      kind === "PROPOSED"
        ? baselineShaFromIntent(intent)
        : baseShaFromIntent(intent);
    const patchResult = await this.runGit(
      [
        "diff",
        "--binary",
        "--no-ext-diff",
        "--no-color",
        "--full-index",
        "--find-renames",
        baseline,
        "--",
      ],
      intent.canonicalPath,
      intent,
    );
    if (!patchResult.ok)
      throw new F13ServiceFailure(
        resultReason(patchResult, intent.correlationId, intent.operationId),
      );
    if (!bytesWithin(patchResult.stdout, F13_MAX_PATCH_BYTES))
      throw new F13ServiceFailure(
        safeReason(
          "DIFF_OUTPUT_LIMIT",
          "LIMIT",
          "The complete Git diff exceeds F13's bounded evidence limit.",
          "The result is not presented as a truncated authoritative diff.",
          "RETRY",
          intent.correlationId,
        ),
      );
    const names = await this.runGit(
      [
        "diff",
        "--name-status",
        "-z",
        "--find-renames",
        "--find-copies",
        baseline,
        "--",
      ],
      intent.canonicalPath,
      intent,
    );
    if (!names.ok)
      throw new F13ServiceFailure(
        resultReason(names, intent.correlationId, intent.operationId),
      );
    const diffFiles = parseNameStatus(names.stdout);
    const untrackedFiles = [...actual.fileMap.values()]
      .filter((file) => file.kind === "untracked")
      .map((file) => file.path)
      .sort((left, right) => left.localeCompare(right));
    const untrackedEvidence = [...actual.fileMap.values()]
      .filter((file) => file.kind === "untracked")
      .map((file) => ({
        path: file.path,
        kind: file.kind,
        staged: file.staged,
        worktreeChanged: file.worktreeChanged,
        ...(file.contentHash === undefined
          ? {}
          : { contentHash: file.contentHash }),
        ...(file.sizeBytes === undefined ? {} : { sizeBytes: file.sizeBytes }),
        ...(file.binary === undefined ? {} : { binary: file.binary }),
      }))
      .sort((left, right) => left.path.localeCompare(right.path));
    const files = diffFiles.map((file) => {
      const current = actual.fileMap.get(file.path);
      return {
        ...(current ?? {
          path: file.path,
          kind: file.kind,
          staged: false,
          worktreeChanged: true,
        }),
        kind: file.kind,
        ...(file.oldPath === undefined ? {} : { oldPath: file.oldPath }),
      } satisfies F13FileEvidence;
    });
    const patchHash = hashText(patchResult.stdout);
    const diffHash = hashText(
      stableJson({
        kind,
        baseline,
        current: actual.manifest.headSha,
        patchHash,
        files,
        untrackedFiles,
        untrackedEvidence,
      }),
    );
    const diffId = diffIdFor(intent.operationId, kind, diffHash);
    return this.options.repositories.saveDiff({
      diffId,
      operationId: intent.operationId,
      worktreeId: intent.worktreeId,
      kind,
      baselineSha: baseline,
      currentSha: actual.manifest.headSha,
      diffHash,
      patchHash,
      patch: patchResult.stdout,
      files,
      untrackedFiles,
      untrackedEvidence,
      complete: true,
      regenerationContract: `git diff --binary --no-ext-diff --no-color --full-index ${baseline} -- plus current non-ignored untracked files under the recorded worktree path`,
    });
  }

  public async beginAiTurn(input: {
    readonly operationId: string;
    readonly ownerId: string;
    readonly turnId: string;
    readonly acknowledgeUnattributedChanges?: boolean;
  }): Promise<F13AiTurnBeforeResult> {
    const intent = this.options.repositories.getOperation(input.operationId);
    if (intent === undefined)
      return {
        ok: false,
        reason: safeReason(
          "WORKTREE_NOT_FOUND",
          "NOT_FOUND",
          "The AI-turn worktree was not found.",
          "The operation must be reconciled before a mutating turn can start.",
          "RECONCILE",
          "f13-ai-turn",
        ),
      };
    if (intent.ownerId !== input.ownerId)
      return {
        ok: false,
        reason: safeReason(
          "WORKTREE_OWNER_CONFLICT",
          "CONFLICT",
          "The AI turn does not own the operation worktree.",
          "F13 refused to grant mutation authority to another owner.",
          "RECONCILE",
          intent.correlationId,
        ),
      };
    const mutationBlock = this.mutationBlockReason(intent);
    if (mutationBlock !== undefined)
      return { ok: false, reason: mutationBlock };
    if (!isSafeF13Identifier(input.turnId))
      return {
        ok: false,
        reason: safeReason(
          "TURN_ID_INVALID",
          "VALIDATION",
          "The AI turn identifier is invalid.",
          "Use a bounded turn identity from the AI work controller.",
          "FIX_INPUT",
          intent.correlationId,
        ),
      };
    const inspection = await this.inspectInternal(
      intent,
      "BEFORE_AI",
      input.turnId,
      true,
    );
    if (!inspection.ok || inspection.snapshot === undefined)
      return { ok: false, reason: inspection.reason };
    const explicitlyAcknowledgedUnattributed =
      inspection.condition.classification === "UNATTRIBUTED_CHANGES" &&
      input.acknowledgeUnattributedChanges === true;
    if (
      !inspection.condition.permittedNextActions.includes("CONTINUE_AI_WORK") &&
      !explicitlyAcknowledgedUnattributed
    )
      return {
        ok: false,
        reason: safeReason(
          "WORKTREE_CONDITION_UNVERIFIED",
          "CONFLICT",
          "The current worktree condition is not verified for another AI turn.",
          "F13 preserved the worktree and requires an explicit decision or fresh evidence before AI work continues.",
          "SELECT_WORKTREE_ACTION",
          intent.correlationId,
        ),
      };
    this.emit(
      intent,
      "AI_TURN_SNAPSHOT_BEFORE",
      "The operation worktree was snapshotted before a mutating turn.",
    );
    return {
      ok: true,
      snapshot: inspection.snapshot,
      mutationRoot: intent.canonicalPath,
      worktree: providerWorktreeHandoff({
        worktree: inspection.worktree,
        snapshot: inspection.snapshot,
        access: "WORKTREE_WRITE",
      }),
    };
  }

  public async completeAiTurn(input: {
    readonly operationId: string;
    readonly ownerId: string;
    readonly turnId: string;
    readonly beforeSnapshotId: string;
  }): Promise<F13AiTurnAfterResult> {
    const intent = this.options.repositories.getOperation(input.operationId);
    if (intent === undefined)
      return {
        ok: false,
        beforeSnapshotId: input.beforeSnapshotId,
        reason: safeReason(
          "WORKTREE_NOT_FOUND",
          "NOT_FOUND",
          "The AI-turn worktree was not found.",
          "The turn evidence must be reconciled before it can be completed.",
          "RECONCILE",
          "f13-ai-turn",
        ),
      };
    if (intent.ownerId !== input.ownerId)
      return {
        ok: false,
        beforeSnapshotId: input.beforeSnapshotId,
        reason: safeReason(
          "WORKTREE_OWNER_CONFLICT",
          "CONFLICT",
          "The AI turn does not own the operation worktree.",
          "F13 refused to inspect or attribute another operation's changes.",
          "RECONCILE",
          intent.correlationId,
        ),
      };
    const mutationBlock = this.mutationBlockReason(intent);
    if (mutationBlock !== undefined)
      return {
        ok: false,
        beforeSnapshotId: input.beforeSnapshotId,
        reason: mutationBlock,
      };
    const before = this.options.repositories.getSnapshot(
      input.beforeSnapshotId,
    );
    if (
      before === undefined ||
      before.operationId !== input.operationId ||
      before.turnId !== input.turnId ||
      before.phase !== "BEFORE_AI"
    )
      return {
        ok: false,
        beforeSnapshotId: input.beforeSnapshotId,
        reason: safeReason(
          "BEFORE_SNAPSHOT_MISSING",
          "RECOVERY",
          "The immutable before-turn snapshot is missing or belongs to another turn.",
          "F13 cannot attribute changes from filenames or model claims alone.",
          "RECONCILE",
          intent.correlationId,
        ),
      };
    const inspection = await this.inspectInternal(
      intent,
      "AFTER_AI",
      input.turnId,
      true,
    );
    if (inspection.snapshot === undefined)
      return {
        ok: false,
        beforeSnapshotId: input.beforeSnapshotId,
        reason: inspection.reason,
      };
    const after = inspection.snapshot;
    const summary = changeSummary(before, after);
    const saved = this.options.repositories.saveSnapshot({
      snapshotId: snapshotIdFor(input.operationId, "AFTER_AI", input.turnId),
      operationId: after.operationId,
      worktreeId: after.worktreeId,
      phase: "AFTER_AI",
      turnId: input.turnId,
      stateFingerprint: after.stateFingerprint,
      manifest: after.manifest,
      changeSummary: summary,
    });
    this.emit(
      intent,
      "AI_TURN_SNAPSHOT_AFTER",
      "The operation worktree was snapshotted after a mutating turn.",
    );
    return {
      ok: inspection.ok,
      beforeSnapshotId: input.beforeSnapshotId,
      snapshot: saved,
      changeSummary: summary,
      worktree: providerWorktreeHandoff({
        worktree: inspection.worktree,
        snapshot: saved,
        access: "WORKTREE_WRITE",
      }),
      ...(inspection.reason === undefined ? {} : { reason: inspection.reason }),
    };
  }

  public async clearChanges(input: {
    readonly operationId: string;
    readonly ownerId: string;
    readonly choice: F13ClearChoice;
    readonly actionId?: string;
    readonly confirmed?: boolean;
    readonly beforeSnapshotId?: string;
    readonly afterSnapshotId?: string;
  }): Promise<F13ClearResult> {
    const intent = this.options.repositories.getOperation(input.operationId);
    if (intent === undefined)
      return {
        ok: false,
        choice: input.choice,
        worktree: this.placeholderWorktree(input.operationId),
        removed: [],
        preserved: [],
        remaining: [],
        reason: safeReason(
          "WORKTREE_NOT_FOUND",
          "NOT_FOUND",
          "The operation-owned worktree was not found.",
          "F13 cannot clear a path without a durable owner record.",
          "RECONCILE",
          "f13-clear",
        ),
      };
    if (intent.ownerId !== input.ownerId)
      return {
        ok: false,
        choice: input.choice,
        worktree: this.worktreeRecord(intent),
        removed: [],
        preserved: [],
        remaining: [],
        reason: safeReason(
          "WORKTREE_OWNER_CONFLICT",
          "CONFLICT",
          "The clear request does not own the operation worktree.",
          "F13 refused to inspect or mutate an unrelated operation path.",
          "RECONCILE",
          intent.correlationId,
        ),
      };
    const mutationBlock = this.mutationBlockReason(intent);
    if (mutationBlock !== undefined)
      return {
        ok: false,
        choice: input.choice,
        worktree: this.worktreeRecord(intent),
        removed: [],
        preserved: [],
        remaining: [],
        reason: mutationBlock,
      };

    const currentInspection = await this.inspectInternal(
      intent,
      "CLEAR_BEFORE",
      undefined,
      true,
    );
    const currentSnapshot = currentInspection.snapshot;
    const currentFiles =
      currentSnapshot === undefined
        ? new Map<string, F13FileEvidence>()
        : manifestFiles(currentSnapshot);
    const currentPaths = [...currentFiles.keys()].sort((left, right) =>
      left.localeCompare(right),
    );
    if (currentSnapshot !== undefined)
      currentPaths.push(...currentSnapshot.manifest.ignoredFiles);
    currentPaths.sort((left, right) => left.localeCompare(right));
    const actionId =
      input.actionId ?? actionIdFor(intent.operationId, input.choice);
    try {
      this.options.repositories.saveClearAction({
        actionId,
        operationId: intent.operationId,
        worktreeId: intent.worktreeId,
        choice: input.choice,
        confirmation: input.confirmed === true,
        ...(input.beforeSnapshotId === undefined
          ? {}
          : { beforeSnapshotId: input.beforeSnapshotId }),
        ...(input.afterSnapshotId === undefined
          ? {}
          : { afterSnapshotId: input.afterSnapshotId }),
        ...(currentSnapshot === undefined
          ? {}
          : { currentSnapshotId: currentSnapshot.snapshotId }),
        status: "PENDING",
      });
    } catch {
      const reason = safeReason(
        "CLEAR_INTENT_PERSISTENCE_FAILED",
        "RECOVERY",
        "The clear decision could not be recorded durably.",
        "F13 made no Git or filesystem mutation and preserved the inspected worktree for reconciliation.",
        "RECONCILE",
        intent.correlationId,
      );
      return {
        ok: false,
        choice: input.choice,
        worktree: this.worktreeRecord(intent),
        removed: [],
        preserved: currentPaths,
        remaining: currentPaths,
        reason,
      };
    }
    if (!currentInspection.ok) {
      const reason =
        currentInspection.reason ??
        safeReason(
          "WORKTREE_INSPECTION_FAILED",
          "RECOVERY",
          "The current worktree could not be inspected.",
          "No clear operation was attempted.",
          "RECONCILE",
          intent.correlationId,
        );
      this.options.repositories.updateClearAction({
        actionId,
        status: "BLOCKED",
        outcome: {
          removed: [],
          preserved: currentPaths,
          remaining: currentPaths,
        },
        reason,
      });
      return {
        ok: false,
        choice: input.choice,
        worktree: this.worktreeRecord(intent),
        removed: [],
        preserved: currentPaths,
        remaining: currentPaths,
        reason,
      };
    }

    if (input.choice === "KEEP_AND_CANCEL") {
      const reason = safeReason(
        "WORKTREE_RETAINED",
        "VALIDATION",
        "The operation worktree was kept unchanged.",
        "The current worktree and all immutable evidence remain available for inspection.",
        "NONE",
        intent.correlationId,
      );
      this.options.repositories.updateLifecycle({
        operationId: intent.operationId,
        lifecycle: "RETAINED",
        reason,
      });
      this.options.repositories.updateClearAction({
        actionId,
        status: "COMPLETED",
        outcome: {
          removed: [],
          preserved: currentPaths,
          remaining: currentPaths,
        },
        reason,
      });
      return {
        ok: true,
        choice: input.choice,
        worktree: this.worktreeRecord(
          this.options.repositories.getOperation(intent.operationId) ?? intent,
        ),
        removed: [],
        preserved: currentPaths,
        remaining: currentPaths,
        reason,
      };
    }

    if (input.choice === "CLEAR_ALL" && input.confirmed !== true) {
      const reason = safeReason(
        "DESTRUCTIVE_CONFIRMATION_REQUIRED",
        "VALIDATION",
        "Clear All Changes requires explicit destructive confirmation.",
        "F13 displayed the current change summary and made no filesystem or Git mutation.",
        "SELECT_WORKTREE_ACTION",
        intent.correlationId,
      );
      this.options.repositories.updateClearAction({
        actionId,
        status: "BLOCKED",
        outcome: {
          removed: [],
          preserved: currentPaths,
          remaining: currentPaths,
        },
        reason,
      });
      return {
        ok: false,
        choice: input.choice,
        worktree: this.worktreeRecord(intent),
        removed: [],
        preserved: currentPaths,
        remaining: currentPaths,
        reason,
      };
    }

    if (input.choice === "CLEAR_ALL")
      return this.clearAllChanges(intent, actionId, currentPaths);

    return this.clearOnlyAiChanges(
      intent,
      actionId,
      currentSnapshot,
      input.beforeSnapshotId,
      input.afterSnapshotId,
    );
  }

  public async clear(
    input: Parameters<F13WorktreeService["clearChanges"]>[0],
  ): Promise<F13ClearResult> {
    return this.clearChanges(input);
  }

  private async clearAllChanges(
    intent: F13OperationIntentRecord,
    actionId: string,
    beforePaths: readonly string[],
  ): Promise<F13ClearResult> {
    try {
      const reset = await this.runGit(
        ["reset", "--hard", "HEAD"],
        intent.canonicalPath,
        intent,
      );
      if (!reset.ok)
        throw new F13ServiceFailure(
          resultReason(reset, intent.correlationId, intent.operationId),
        );
      const clean = await this.runGit(
        ["clean", "-fd"],
        intent.canonicalPath,
        intent,
      );
      if (!clean.ok)
        throw new F13ServiceFailure(
          resultReason(clean, intent.correlationId, intent.operationId),
        );
    } catch (error) {
      const reason =
        error instanceof F13ServiceFailure
          ? error.reason
          : safeReason(
              "CLEAR_ALL_UNCERTAIN",
              "RECOVERY",
              "Clear All Changes did not produce a confirmed outcome.",
              "The worktree was preserved for reconciliation and was not reported clean.",
              "RECONCILE",
              intent.correlationId,
            );
      try {
        this.options.repositories.updateLifecycle({
          operationId: intent.operationId,
          lifecycle: "UNKNOWN",
          reason,
        });
        this.options.repositories.updateClearAction({
          actionId,
          status: "UNKNOWN",
          reason,
        });
      } catch {
        // Durable recovery will inspect the operation on startup.
      }
      return {
        ok: false,
        choice: "CLEAR_ALL",
        worktree: this.worktreeRecord(intent),
        removed: [],
        preserved: [],
        remaining: beforePaths,
        reason,
      };
    }
    const after = await this.inspectInternal(
      intent,
      "CLEAR_AFTER",
      undefined,
      true,
    );
    const remaining =
      after.snapshot === undefined
        ? beforePaths
        : manifestPaths(after.snapshot);
    const removed = beforePaths.filter(
      (filePath) => !remaining.includes(filePath),
    );
    let worktree = after.worktree;
    let reason = after.reason;
    if (after.ok) {
      const clearedReason = safeReason(
        "WORKTREE_CLEARED",
        "CANCELLED",
        "The requested non-ignored worktree changes were cleared.",
        "Ignored files remain by policy and are listed in the preserved state.",
        "NONE",
        intent.correlationId,
      );
      try {
        const cleared = this.options.repositories.updateLifecycle({
          operationId: intent.operationId,
          lifecycle: "CLEARED",
          currentSha: after.worktree.currentHeadSha,
          reason: clearedReason,
        });
        worktree = this.worktreeRecord(cleared);
      } catch {
        reason = safeReason(
          "CLEAR_OUTCOME_PERSISTENCE_UNCERTAIN",
          "RECOVERY",
          "Git cleared the requested changes, but the cleared lifecycle could not be committed.",
          "The refreshed snapshot remains authoritative and the operation should be reconciled before another mutation.",
          "RECONCILE",
          intent.correlationId,
        );
      }
    }
    try {
      this.options.repositories.updateClearAction({
        actionId,
        status: after.ok && reason === undefined ? "COMPLETED" : "UNKNOWN",
        afterSnapshotId: after.snapshot?.snapshotId,
        outcome: { removed, preserved: remaining, remaining },
        ...(reason === undefined ? {} : { reason }),
      });
    } catch {
      reason = safeReason(
        "CLEAR_OUTCOME_PERSISTENCE_UNCERTAIN",
        "RECOVERY",
        "The clear command completed, but its durable outcome could not be recorded.",
        "The operation worktree and refreshed snapshot were preserved for reconciliation.",
        "RECONCILE",
        intent.correlationId,
      );
    }
    return {
      ok: after.ok && reason === undefined,
      choice: "CLEAR_ALL",
      worktree,
      removed,
      preserved: remaining,
      remaining,
      ...(reason === undefined ? {} : { reason }),
    };
  }

  private async clearOnlyAiChanges(
    intent: F13OperationIntentRecord,
    actionId: string,
    currentSnapshot: F13SnapshotRecord | undefined,
    beforeSnapshotId: string | undefined,
    afterSnapshotId: string | undefined,
  ): Promise<F13ClearResult> {
    const before =
      beforeSnapshotId === undefined
        ? this.latestSnapshot(intent.operationId, "BEFORE_AI")
        : this.options.repositories.getSnapshot(beforeSnapshotId);
    const after =
      afterSnapshotId === undefined
        ? this.latestSnapshot(intent.operationId, "AFTER_AI")
        : this.options.repositories.getSnapshot(afterSnapshotId);
    const current = currentSnapshot;
    const blocked = (reason: F13SafeReason): F13ClearResult => {
      try {
        this.options.repositories.updateLifecycle({
          operationId: intent.operationId,
          lifecycle: "RETAINED",
          reason,
        });
        this.options.repositories.updateClearAction({
          actionId,
          status: "BLOCKED",
          reason,
          outcome: {
            removed: [],
            preserved: current === undefined ? [] : manifestPaths(current),
          },
        });
      } catch {
        // Preserve the safe user-facing reason if a later reconciliation is needed.
      }
      const remaining = current === undefined ? [] : manifestPaths(current);
      return {
        ok: false,
        choice: "CLEAR_AI_ONLY",
        worktree: this.worktreeRecord(intent),
        removed: [],
        preserved: remaining,
        remaining,
        reason,
      };
    };
    if (before === undefined || after === undefined || current === undefined)
      return blocked(
        safeReason(
          "AI_SNAPSHOT_MISSING",
          "RECOVERY",
          "Clear Only AI Changes requires immutable before, after, and current snapshots.",
          "F13 will not claim ownership from filenames or provider prose alone.",
          "RECONCILE",
          intent.correlationId,
        ),
      );
    if (
      before.operationId !== intent.operationId ||
      after.operationId !== intent.operationId ||
      before.worktreeId !== intent.worktreeId ||
      after.worktreeId !== intent.worktreeId ||
      current.operationId !== intent.operationId ||
      current.worktreeId !== intent.worktreeId ||
      before.phase !== "BEFORE_AI" ||
      after.phase !== "AFTER_AI" ||
      before.turnId === undefined ||
      after.turnId !== before.turnId
    )
      return blocked(
        safeReason(
          "AI_SNAPSHOT_MISMATCH",
          "CONFLICT",
          "The requested AI snapshots do not belong to one operation turn.",
          "F13 will not mutate a worktree from evidence belonging to another operation or turn.",
          "RECONCILE",
          intent.correlationId,
        ),
      );
    if (
      !before.manifest.complete ||
      !after.manifest.complete ||
      !current.manifest.complete
    )
      return blocked(
        safeReason(
          "AI_ATTRIBUTION_INCOMPLETE",
          "LIMIT",
          "The three-way attribution evidence is incomplete.",
          "F13 preserved the complete current worktree rather than guessing across an over-limit or unreadable file.",
          "MANUAL_RESOLUTION",
          intent.correlationId,
        ),
      );

    const beforeFiles = fileMapFromManifest(before.manifest);
    const afterFiles = fileMapFromManifest(after.manifest);
    const currentFiles = fileMapFromManifest(current.manifest);
    const paths = changedPaths(beforeFiles, afterFiles);
    const plans: Array<{
      readonly path: string;
      readonly kind: "write" | "delete";
      readonly content?: Buffer;
    }> = [];
    const preserved = new Set<string>();
    for (const filePath of current.manifest.ignoredFiles)
      preserved.add(filePath);
    for (const filePath of paths) {
      const base = beforeFiles.get(filePath);
      const ai = afterFiles.get(filePath);
      const now = currentFiles.get(filePath);
      const baseContent = decodeContent(base);
      const aiContent = decodeContent(ai);
      const currentContent = decodeContent(now);
      const same = (
        left: F13FileEvidence | undefined,
        right: F13FileEvidence | undefined,
      ): boolean => {
        if (left === undefined || right === undefined) return left === right;
        return left.contentHash !== undefined && right.contentHash !== undefined
          ? left.contentHash === right.contentHash
          : fileStateEqual(left, right);
      };
      if (same(now, ai)) {
        if (base === undefined) plans.push({ path: filePath, kind: "delete" });
        else if (baseContent !== undefined)
          plans.push({ path: filePath, kind: "write", content: baseContent });
        else
          return blocked(
            safeReason(
              "AI_ATTRIBUTION_CONTENT_UNAVAILABLE",
              "RECOVERY",
              "F13 could not reconstruct the pre-turn file safely.",
              "The current worktree was left unchanged and requires manual resolution.",
              "MANUAL_RESOLUTION",
              intent.correlationId,
            ),
          );
        continue;
      }
      if (same(now, base)) {
        preserved.add(filePath);
        continue;
      }
      if (
        base === undefined ||
        ai === undefined ||
        baseContent === undefined ||
        aiContent === undefined ||
        currentContent === undefined ||
        base.binary === true ||
        ai.binary === true ||
        now?.binary === true
      )
        return blocked(
          safeReason(
            "AI_MANUAL_OVERLAP",
            "CONFLICT",
            "AI and manual changes overlap or include an unsafe binary/file replacement.",
            "Clear Only AI Changes is fail-closed and left the complete worktree unchanged.",
            "MANUAL_RESOLUTION",
            intent.correlationId,
          ),
        );
      const merged = removeAiChange(baseContent, aiContent, currentContent);
      if (!merged.ok)
        return blocked(
          safeReason(
            "AI_MANUAL_OVERLAP",
            "CONFLICT",
            "AI and manual edits overlap the same lines and cannot be separated safely.",
            "F13 did not guess which change to remove; preserve or resolve the worktree manually.",
            "MANUAL_RESOLUTION",
            intent.correlationId,
          ),
        );
      if (!merged.content.equals(currentContent))
        plans.push({ path: filePath, kind: "write", content: merged.content });
      else preserved.add(filePath);
    }
    const planPaths = new Set(plans.map((plan) => plan.path));
    for (const filePath of currentFiles.keys())
      if (!planPaths.has(filePath)) preserved.add(filePath);
    const mutations: Array<{
      readonly plan: (typeof plans)[number];
      readonly backup: F13MutationBackup;
    }> = [];
    try {
      for (const plan of plans) {
        const target = await this.prepareMutationTarget(
          intent.canonicalPath,
          plan.path,
        );
        const backup = await this.mutationBackup(target);
        if (plan.kind === "delete" && !backup.existed)
          throw new Error("missing-delete-target");
        mutations.push({ plan, backup });
      }
      for (const mutation of mutations) {
        if (mutation.plan.kind === "delete") {
          await unlink(mutation.backup.target);
        } else {
          await writeFile(
            mutation.backup.target,
            mutation.plan.content ?? Buffer.alloc(0),
          );
        }
      }
    } catch {
      const rolledBack = await this.rollbackMutationBackups(mutations);
      const reason = safeReason(
        rolledBack ? "AI_CLEAR_ROLLED_BACK" : "AI_CLEAR_UNCERTAIN",
        "RECOVERY",
        rolledBack
          ? "Clear Only AI Changes failed and its partial filesystem effect was rolled back."
          : "Clear Only AI Changes did not produce a confirmed outcome.",
        rolledBack
          ? "F13 restored the recorded worktree files and preserved the operation for explicit reconciliation."
          : "F13 could not prove that every partial mutation was reversed; the worktree was preserved for manual inspection and reconciliation.",
        "RECONCILE",
        intent.correlationId,
      );
      try {
        this.options.repositories.updateLifecycle({
          operationId: intent.operationId,
          lifecycle: rolledBack ? "RETAINED" : "UNKNOWN",
          reason,
        });
        this.options.repositories.updateClearAction({
          actionId,
          status: rolledBack ? "BLOCKED" : "UNKNOWN",
          reason,
          outcome: {
            removed: [],
            preserved: [...preserved],
            remaining: [
              ...currentFiles.keys(),
              ...current.manifest.ignoredFiles,
            ],
          },
        });
      } catch {
        // Startup reconciliation remains authoritative.
      }
      return {
        ok: false,
        choice: "CLEAR_AI_ONLY",
        worktree: this.worktreeRecord(intent),
        removed: [],
        preserved: [...preserved].sort(),
        remaining: [
          ...currentFiles.keys(),
          ...current.manifest.ignoredFiles,
        ].sort(),
        reason,
      };
    }
    const refreshed = await this.inspectInternal(
      intent,
      "CLEAR_AFTER",
      undefined,
      true,
    );
    const remaining =
      refreshed.snapshot === undefined
        ? [...currentFiles.keys(), ...current.manifest.ignoredFiles].sort()
        : manifestPaths(refreshed.snapshot);
    const removed = plans
      .map((plan) => plan.path)
      .filter((filePath) => !remaining.includes(filePath));
    let reason = refreshed.reason;
    try {
      this.options.repositories.updateClearAction({
        actionId,
        status: refreshed.ok ? "COMPLETED" : "UNKNOWN",
        afterSnapshotId: refreshed.snapshot?.snapshotId,
        outcome: { removed, preserved: [...preserved].sort(), remaining },
        ...(reason === undefined ? {} : { reason }),
      });
    } catch {
      reason = safeReason(
        "CLEAR_OUTCOME_PERSISTENCE_UNCERTAIN",
        "RECOVERY",
        "The AI-only clear command completed, but its durable outcome could not be recorded.",
        "The operation worktree and refreshed snapshot were preserved for reconciliation.",
        "RECONCILE",
        intent.correlationId,
      );
    }
    return {
      ok: refreshed.ok && reason === undefined,
      choice: "CLEAR_AI_ONLY",
      worktree: refreshed.worktree,
      removed,
      preserved: [...preserved].sort(),
      remaining,
      ...(reason === undefined ? {} : { reason }),
    };
  }

  public async openWorktree(input: {
    readonly operationId: string;
  }): Promise<F13PathActionResult> {
    return this.pathAction(input.operationId, "OPEN_WORKTREE");
  }

  public async openFile(input: {
    readonly operationId: string;
    readonly relativePath: string;
  }): Promise<F13PathActionResult> {
    return this.pathAction(input.operationId, "OPEN_FILE", input.relativePath);
  }

  public async revealFile(input: {
    readonly operationId: string;
    readonly relativePath: string;
  }): Promise<F13PathActionResult> {
    return this.pathAction(
      input.operationId,
      "REVEAL_FILE",
      input.relativePath,
    );
  }

  private async pathAction(
    operationId: string,
    action: F13PathAction,
    relativePath?: string,
  ): Promise<F13PathActionResult> {
    const intent = this.options.repositories.getOperation(operationId);
    const actionId = actionIdFor(
      operationId,
      `${action}:${relativePath ?? ""}`,
    );
    if (intent === undefined) {
      const reason = safeReason(
        "WORKTREE_NOT_FOUND",
        "NOT_FOUND",
        "The recorded operation worktree was not found.",
        "F13 will not open an arbitrary caller path.",
        "RECONCILE",
        "f13-path",
      );
      return { ok: false, action, reason };
    }
    let target = intent.canonicalPath;
    if (action !== "OPEN_WORKTREE") {
      if (
        relativePath === undefined ||
        !isRelativePath(relativePath) ||
        !bytesWithin(relativePath, F13_MAX_PATH_BYTES)
      ) {
        const reason = safeReason(
          "PATH_ESCAPE_REJECTED",
          "VALIDATION",
          "The requested file path is not a safe relative path inside the operation worktree.",
          "F13 only accepts recorded operation identity plus a bounded relative path.",
          "FIX_INPUT",
          intent.correlationId,
        );
        this.options.repositories.savePathAction({
          actionId,
          operationId,
          worktreeId: intent.worktreeId,
          action,
          ...(relativePath === undefined
            ? {}
            : { requestedRelativePath: relativePath }),
          outcome: "REJECTED",
          reason,
        });
        return { ok: false, action, reason };
      }
      target = this.safeTarget(intent.canonicalPath, relativePath);
    }
    try {
      const info = await lstat(target);
      if (info.isSymbolicLink()) throw new Error("symlink");
      const canonical = await realpath(target);
      if (!pathWithin(intent.canonicalPath, canonical))
        throw new Error("outside");
      target = canonical;
      if (action === "OPEN_WORKTREE" && !info.isDirectory())
        throw new Error("not-directory");
      if (action !== "OPEN_WORKTREE" && !info.isFile())
        throw new Error("not-file");
    } catch {
      const reason = safeReason(
        "PATH_UNAVAILABLE",
        "FILESYSTEM",
        "The recorded operation target is missing or moved.",
        "F13 preserved Git state and will not open an arbitrary replacement path.",
        "RECONCILE",
        intent.correlationId,
      );
      this.options.repositories.savePathAction({
        actionId,
        operationId,
        worktreeId: intent.worktreeId,
        action,
        ...(relativePath === undefined
          ? {}
          : { requestedRelativePath: relativePath }),
        resolvedPath: target,
        outcome: "REJECTED",
        reason,
      });
      return { ok: false, action, resolvedPath: target, reason };
    }
    if (this.os === undefined) {
      const reason = safeReason(
        "OS_ADAPTER_UNAVAILABLE",
        "FILESYSTEM",
        "The operating-system open/reveal adapter is unavailable.",
        "The canonical managed path remains available for copying or retry after the main-process adapter is ready.",
        "RETRY",
        intent.correlationId,
      );
      this.options.repositories.savePathAction({
        actionId,
        operationId,
        worktreeId: intent.worktreeId,
        action,
        ...(relativePath === undefined
          ? {}
          : { requestedRelativePath: relativePath }),
        resolvedPath: target,
        outcome: "UNSUPPORTED",
        reason,
      });
      return { ok: false, action, resolvedPath: target, reason };
    }
    const result =
      action === "OPEN_WORKTREE"
        ? await this.os.openDirectory(target)
        : action === "OPEN_FILE"
          ? await this.os.openFile(target)
          : await this.os.revealFile(target);
    let reason = result.ok
      ? undefined
      : safeReason(
          "OS_ACTION_FAILED",
          "FILESYSTEM",
          "The operating-system open/reveal action failed.",
          "The managed path remains canonical and can be retried without changing Git state.",
          "RETRY",
          intent.correlationId,
        );
    try {
      this.options.repositories.savePathAction({
        actionId,
        operationId,
        worktreeId: intent.worktreeId,
        action,
        ...(relativePath === undefined
          ? {}
          : { requestedRelativePath: relativePath }),
        resolvedPath: target,
        outcome: result.ok ? "SUCCEEDED" : "FAILED",
        ...(reason === undefined ? {} : { reason }),
      });
    } catch {
      reason = safeReason(
        "OS_ACTION_PERSISTENCE_UNCERTAIN",
        "RECOVERY",
        "The operating-system action completed, but its durable outcome could not be recorded.",
        "The canonical target remains unchanged and should be reconciled before retrying the action.",
        "RECONCILE",
        intent.correlationId,
      );
    }
    return {
      ok: result.ok && reason === undefined,
      action,
      resolvedPath: target,
      ...(reason === undefined ? {} : { reason }),
    };
  }

  private safeTarget(worktreePath: string, relativePath: string): string {
    if (
      !isRelativePath(relativePath) ||
      !bytesWithin(relativePath, F13_MAX_PATH_BYTES)
    )
      throw new Error("F13_PATH_INVALID");
    const candidate = path.resolve(worktreePath, relativePath);
    if (!pathWithin(worktreePath, candidate))
      throw new Error("F13_PATH_ESCAPE");
    return candidate;
  }

  private async prepareMutationTarget(
    worktreePath: string,
    relativePath: string,
  ): Promise<string> {
    const target = this.safeTarget(worktreePath, relativePath);
    const worktreeInfo = await lstat(worktreePath);
    if (!worktreeInfo.isDirectory() || worktreeInfo.isSymbolicLink())
      throw new Error("F13_WORKTREE_TARGET_UNSAFE");
    const canonicalWorktree = await realpath(worktreePath);
    if (!pathEqual(canonicalWorktree, worktreePath))
      throw new Error("F13_WORKTREE_SYMLINK");
    const parts = relativePath.split(/[\\/]/u);
    let current = worktreePath;
    for (const [index, part] of parts.entries()) {
      current = path.join(current, part);
      const info = await lstat(current).catch(() => undefined);
      if (info === undefined) throw new Error("F13_MUTATION_PARENT_MISSING");
      if (info.isSymbolicLink()) throw new Error("F13_MUTATION_SYMLINK");
      const canonical = await realpath(current);
      if (!pathWithin(canonicalWorktree, canonical))
        throw new Error("F13_MUTATION_PATH_ESCAPE");
      if (index < parts.length - 1 && !info.isDirectory())
        throw new Error("F13_MUTATION_PARENT_NOT_DIRECTORY");
      if (index === parts.length - 1 && !info.isFile())
        throw new Error("F13_MUTATION_TARGET_NOT_FILE");
    }
    return target;
  }

  private async mutationBackup(target: string): Promise<F13MutationBackup> {
    const info = await lstat(target).catch(() => undefined);
    if (info === undefined) return { target, existed: false };
    if (info.isSymbolicLink() || !info.isFile())
      throw new Error("F13_MUTATION_TARGET_UNSAFE");
    return {
      target,
      existed: true,
      content: await readFile(target),
      mode: info.mode,
    };
  }

  private async rollbackMutationBackups(
    mutations: readonly {
      readonly backup: F13MutationBackup;
    }[],
  ): Promise<boolean> {
    try {
      for (const { backup } of [...mutations].reverse()) {
        const current = await lstat(backup.target).catch(() => undefined);
        if (current?.isSymbolicLink() || current?.isDirectory()) return false;
        if (backup.existed) {
          if (backup.content === undefined) return false;
          await writeFile(backup.target, backup.content);
          if (backup.mode !== undefined)
            await chmod(backup.target, backup.mode);
        } else if (current !== undefined) {
          if (!current.isFile()) return false;
          await unlink(backup.target);
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  public async releaseWorktree(input: {
    readonly operationId: string;
    readonly ownerId: string;
  }): Promise<{ readonly ok: boolean; readonly reason?: F13SafeReason }> {
    const intent = this.options.repositories.getOperation(input.operationId);
    if (intent === undefined)
      return {
        ok: false,
        reason: safeReason(
          "WORKTREE_NOT_FOUND",
          "NOT_FOUND",
          "The operation worktree was not found.",
          "No release was attempted.",
          "RECONCILE",
          "f13-release",
        ),
      };
    if (intent.ownerId !== input.ownerId)
      return {
        ok: false,
        reason: safeReason(
          "WORKTREE_OWNER_CONFLICT",
          "CONFLICT",
          "The operation owner does not own this worktree.",
          "F13 did not release or delete an unrelated operation path.",
          "RECONCILE",
          intent.correlationId,
        ),
      };
    this.options.repositories.updateLifecycle({
      operationId: input.operationId,
      lifecycle: "RELEASED",
    });
    return { ok: true };
  }

  public async reconcileStartup(): Promise<void> {
    for (const intent of this.options.repositories.listOperationsForRecovery()) {
      const available = await lstat(intent.canonicalPath)
        .then((info) => info.isDirectory() && !info.isSymbolicLink())
        .catch(() => false);
      if (!available) {
        const reason = safeReason(
          "WORKTREE_RECONCILIATION_REQUIRED",
          "RECOVERY",
          "The durable F13 operation has no provable worktree path after restart.",
          "F13 preserved intent and will not create a duplicate path automatically.",
          "RECONCILE",
          intent.correlationId,
        );
        try {
          this.options.repositories.updateLifecycle({
            operationId: intent.operationId,
            lifecycle: "UNKNOWN",
            reason,
          });
        } catch {
          // The next startup can retry the same durable reconciliation.
        }
        continue;
      }
      try {
        await this.inspectInternal(intent, "INSPECTION");
      } catch {
        // inspectInternal already records a bounded recovery result.
      }
    }
  }

  public getWorktree(operationId: string): F13WorktreeRecord | undefined {
    const intent = this.options.repositories.getOperation(operationId);
    return intent === undefined ? undefined : this.worktreeRecord(intent);
  }

  private latestSnapshot(
    operationId: string,
    phase: F13SnapshotPhase,
  ): F13SnapshotRecord | undefined {
    return this.options.repositories
      .listSnapshots({ operationId })
      .filter((snapshot) => snapshot.phase === phase)
      .at(-1);
  }

  private aiTurnPairsForCondition(
    operationId: string,
    phase: F13SnapshotPhase,
    turnId: string | undefined,
    currentSnapshot: F13SnapshotRecord,
  ): readonly {
    readonly beforeSnapshot: F13SnapshotRecord;
    readonly afterSnapshot: F13SnapshotRecord;
  }[] {
    const snapshots = this.options.repositories.listSnapshots({ operationId });
    const storedAfterSnapshots = snapshots.filter(
      (snapshot) =>
        snapshot.phase === "AFTER_AI" &&
        (turnId === undefined || snapshot.turnId !== turnId),
    );
    const afterCandidates =
      phase === "AFTER_AI" && turnId !== undefined
        ? [...storedAfterSnapshots, currentSnapshot]
        : storedAfterSnapshots;
    const afterByTurn = new Map<string, F13SnapshotRecord>();
    for (const afterSnapshot of afterCandidates) {
      if (afterSnapshot.turnId === undefined) continue;
      const existing = afterByTurn.get(afterSnapshot.turnId);
      if (
        existing === undefined ||
        (existing.changeSummary === undefined &&
          afterSnapshot.changeSummary !== undefined) ||
        (existing.changeSummary === afterSnapshot.changeSummary &&
          existing.snapshotId.localeCompare(afterSnapshot.snapshotId) < 0)
      )
        afterByTurn.set(afterSnapshot.turnId, afterSnapshot);
    }
    const pairs: Array<{
      readonly beforeSnapshot: F13SnapshotRecord;
      readonly afterSnapshot: F13SnapshotRecord;
    }> = [];
    for (const afterSnapshot of afterByTurn.values()) {
      const beforeSnapshot = snapshots
        .filter(
          (snapshot) =>
            snapshot.phase === "BEFORE_AI" &&
            snapshot.turnId === afterSnapshot.turnId,
        )
        .at(-1);
      if (beforeSnapshot !== undefined)
        pairs.push({ beforeSnapshot, afterSnapshot });
    }
    return pairs;
  }

  private worktreeRecord(intent: F13OperationIntentRecord): F13WorktreeRecord {
    const persisted = this.options.repositories.readWorktree(
      intent.operationId,
    );
    const sha = intent.shaSnapshot as Record<string, unknown>;
    return {
      worktreeId: intent.worktreeId,
      operationId: intent.operationId,
      ...(intent.managedPrId === undefined
        ? {}
        : { managedPrId: intent.managedPrId }),
      ownerType: intent.ownerType,
      ownerId: intent.ownerId,
      operationKind: intent.operationKind,
      canonicalPath: intent.canonicalPath,
      configuredRoot: intent.configuredRoot,
      rootRevision: intent.rootRevision,
      lifecycle: intent.lifecycle,
      refs: intent.refs as F13WorktreeRecord["refs"],
      sourceRepository: intent.sourceRepository,
      ...(intent.destinationRepository === undefined
        ? {}
        : { destinationRepository: intent.destinationRepository }),
      ...(persisted?.currentHeadSha === undefined
        ? {}
        : { currentHeadSha: persisted.currentHeadSha }),
      worktreeBaselineSha:
        typeof sha.worktreeBaselineSha === "string"
          ? sha.worktreeBaselineSha
          : "",
      available: ["ACTIVE", "DIRTY", "RETAINED", "CLEARED"].includes(
        intent.lifecycle,
      ),
      ...(intent.reason === undefined ? {} : { reason: intent.reason }),
      version: intent.version,
      createdAt: intent.createdAt,
      updatedAt: intent.updatedAt,
    };
  }

  private placeholderWorktree(operationId: string): F13WorktreeRecord {
    return {
      worktreeId: "f13-unavailable",
      operationId: isSafeF13Identifier(operationId) ? operationId : "unknown",
      ownerType: "UNKNOWN",
      ownerId: "unknown",
      operationKind: "REVIEW",
      canonicalPath: "",
      configuredRoot: "",
      rootRevision: 0,
      refs: {
        baseRepository: {
          serverId: "unknown",
          owner: "unknown",
          name: "unknown",
        },
        headRepository: {
          serverId: "unknown",
          owner: "unknown",
          name: "unknown",
        },
        baseBranch: "unknown",
        headBranch: "unknown",
        prBaseSha: "0000000",
        prHeadSha: "0000000",
      },
      sourceRepository: {
        serverId: "unknown",
        owner: "unknown",
        name: "unknown",
      },
      lifecycle: "UNKNOWN",
      worktreeBaselineSha: "0000000",
      available: false,
      version: 0,
      createdAt: "",
      updatedAt: "",
    };
  }

  private failurePreparation(
    intent: F13OperationIntentRecord,
    reason: F13SafeReason,
  ): F13PreparationResult {
    return { ok: false, worktree: this.worktreeRecord(intent), reason };
  }

  private emit(
    intent: F13OperationIntentRecord,
    reasonCode: string,
    summary: string,
  ): void {
    try {
      this.options.activity?.append({
        correlationId: intent.correlationId,
        operationId: intent.operationId,
        reasonCode,
        summary,
      });
    } catch {
      // Diagnostics never changes authoritative F13 state.
    }
  }
}

function expectedHeadFromIntent(intent: F13OperationIntentRecord): string {
  const value = intent.shaSnapshot as Record<string, unknown>;
  return typeof value.prHeadSha === "string" ? value.prHeadSha : "";
}

function baseShaFromIntent(intent: F13OperationIntentRecord): string {
  const value = intent.shaSnapshot as Record<string, unknown>;
  if (typeof value.prBaseSha === "string") return value.prBaseSha;
  if (typeof value.syncMergeBaseSha === "string") return value.syncMergeBaseSha;
  return expectedHeadFromIntent(intent);
}

function baselineShaFromIntent(intent: F13OperationIntentRecord): string {
  const value = intent.shaSnapshot as Record<string, unknown>;
  return typeof value.worktreeBaselineSha === "string"
    ? value.worktreeBaselineSha
    : expectedHeadFromIntent(intent);
}
