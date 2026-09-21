import type { PrimaryPrState } from "./domain/primary";
import type { ManagedPrReadModel, ManagedPrReason } from "./managed-pr";

export const MANAGED_PR_INBOX_SCHEMA_VERSION = 1 as const;
export const MAX_INBOX_CARDS = 5_000;
export const MAX_INBOX_TEXT_BYTES = 2_048;

export type ManagedPrInboxGroupId = "ACTION_NEEDED" | "WORKING" | "WATCHING";

export type ManagedPrInboxNextAction =
  "OPEN_DETAILS" | "RETRY" | "WAIT" | "NONE";

export interface ManagedPrInboxReason {
  readonly code: string;
  readonly what: string;
  readonly why: string;
  readonly nextAction: ManagedPrInboxNextAction;
}

export type ManagedPrInboxSynchronizationStatus =
  | "WAITING"
  | "MERGING"
  | "RESOLVING_CONFLICTS"
  | "READY_TO_PUBLISH"
  | "NEEDS_ATTENTION"
  | "STALE"
  | "PUBLISHING"
  | "PUBLISHED"
  | "DISCARDED"
  | "FAILED"
  | "SKIPPED";

export interface ManagedPrInboxSynchronizationOverlay {
  readonly id: string;
  readonly status: ManagedPrInboxSynchronizationStatus;
  readonly version: number;
  readonly updatedAt: string;
  readonly reason: ManagedPrInboxReason;
}

export interface ManagedPrInboxRepositoryReference {
  readonly serverId: string;
  readonly key: string;
  readonly owner: string;
  readonly name: string;
}

export interface ManagedPrInboxCard {
  readonly schemaVersion: typeof MANAGED_PR_INBOX_SCHEMA_VERSION;
  readonly id: string;
  readonly pullRequestKey: string;
  readonly number: number;
  readonly reference: string;
  readonly title?: string;
  readonly repository: ManagedPrInboxRepositoryReference;
  readonly baseRepositoryKey: string;
  readonly headRepositoryKey: string;
  readonly primaryState: PrimaryPrState;
  readonly stateUpdatedAt: string;
  readonly localSetupStatus: ManagedPrReadModel["localSetupStatus"];
  readonly reason: ManagedPrInboxReason;
  readonly synchronization?: ManagedPrInboxSynchronizationOverlay;
}

export interface ManagedPrInboxGroup {
  readonly id: ManagedPrInboxGroupId;
  readonly label: string;
  readonly cardIds: readonly string[];
  readonly count: number;
}

export interface ManagedPrInboxReadModel {
  readonly schemaVersion: typeof MANAGED_PR_INBOX_SCHEMA_VERSION;
  readonly kind: "managed-pr-inbox";
  readonly version: number;
  readonly generatedAt: string;
  readonly cards: readonly ManagedPrInboxCard[];
  readonly groups: readonly ManagedPrInboxGroup[];
  readonly counts: {
    readonly total: number;
    readonly actionNeeded: number;
    readonly working: number;
    readonly watching: number;
  };
}

export interface ManagedPrInboxSynchronizationSource {
  readonly id: string;
  readonly managedPrId: string;
  readonly status: string;
  readonly version: number;
  readonly updatedAt: string;
}

export class ManagedPrInboxProjectionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ManagedPrInboxProjectionError";
  }
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SECRET_SHAPED =
  /(?:token|secret|password|credential|authorization|cookie|api[_.-]?key|access[_.-]?key|environment|prompt)/iu;
const SYNC_STATUSES = new Set<ManagedPrInboxSynchronizationStatus>([
  "WAITING",
  "MERGING",
  "RESOLVING_CONFLICTS",
  "READY_TO_PUBLISH",
  "NEEDS_ATTENTION",
  "STALE",
  "PUBLISHING",
  "PUBLISHED",
  "DISCARDED",
  "FAILED",
  "SKIPPED",
]);

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function safeText(value: string, maximum = MAX_INBOX_TEXT_BYTES): string {
  if (
    value.length === 0 ||
    byteLength(value) > maximum ||
    SECRET_SHAPED.test(value) ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  ) {
    throw new ManagedPrInboxProjectionError(
      "The managed-PR inbox contains unsafe display text.",
    );
  }
  return value;
}

function safeId(value: string): string {
  if (!SAFE_ID.test(value))
    throw new ManagedPrInboxProjectionError(
      "The managed-PR inbox contains an unsafe identity.",
    );
  return value;
}

function reasonFromState(state: PrimaryPrState): ManagedPrInboxReason {
  if (state === "READY_FOR_REVIEW")
    return {
      code: "READY_FOR_REVIEW",
      what: "Review work is ready for inspection.",
      why: "A persisted review result is waiting for your explicit review decision.",
      nextAction: "OPEN_DETAILS",
    };
  if (state === "NEEDS_ATTENTION")
    return {
      code: "NEEDS_ATTENTION",
      what: "Review work needs attention.",
      why: "The persisted review operation stopped before it reached a reviewable result.",
      nextAction: "OPEN_DETAILS",
    };
  if (state === "WORKING")
    return {
      code: "WORKING",
      what: "PRMonitor is working on this pull request.",
      why: "A persisted operation is active; no additional decision is requested yet.",
      nextAction: "WAIT",
    };
  return {
    code: "WATCHING",
    what: "Watching this pull request.",
    why: "No persisted review action is waiting for you.",
    nextAction: "NONE",
  };
}

function mapNextAction(
  action: ManagedPrReason["nextAction"],
): ManagedPrInboxNextAction {
  if (action === "RETRY") return "RETRY";
  if (action === "WAIT") return "WAIT";
  if (action === "NONE") return "NONE";
  return "OPEN_DETAILS";
}

function safeManagedReason(
  state: PrimaryPrState,
  reason: ManagedPrReason | undefined,
): ManagedPrInboxReason {
  if (reason === undefined) return reasonFromState(state);
  return {
    code: safeText(reason.code, 128),
    what: safeText(reason.what),
    why: safeText(reason.why),
    nextAction: mapNextAction(reason.nextAction),
  };
}

function synchronizationReason(
  status: ManagedPrInboxSynchronizationStatus,
): ManagedPrInboxReason {
  if (status === "WAITING")
    return {
      code: "SYNC_WAITING",
      what: "Branch synchronization is waiting.",
      why: "The synchronization result has not started or is waiting for its next deterministic step.",
      nextAction: "WAIT",
    };
  if (status === "MERGING")
    return {
      code: "SYNC_MERGING",
      what: "Branch synchronization is merging.",
      why: "The isolated synchronization worktree is being prepared.",
      nextAction: "WAIT",
    };
  if (status === "RESOLVING_CONFLICTS")
    return {
      code: "SYNC_RESOLVING_CONFLICTS",
      what: "Branch synchronization is resolving conflicts.",
      why: "The synchronization worktree contains conflicts that are still being handled.",
      nextAction: "WAIT",
    };
  if (status === "READY_TO_PUBLISH")
    return {
      code: "SYNC_READY_TO_PUBLISH",
      what: "A synchronized branch is ready to publish.",
      why: "The merge result is waiting for explicit publication approval.",
      nextAction: "OPEN_DETAILS",
    };
  if (status === "NEEDS_ATTENTION" || status === "FAILED")
    return {
      code: `SYNC_${status}`,
      what: "Branch synchronization needs attention.",
      why: "The persisted synchronization result did not complete successfully.",
      nextAction: "OPEN_DETAILS",
    };
  if (status === "STALE")
    return {
      code: "SYNC_STALE",
      what: "The synchronization result is stale.",
      why: "A source or destination branch moved after this result was prepared.",
      nextAction: "OPEN_DETAILS",
    };
  if (status === "PUBLISHING")
    return {
      code: "SYNC_PUBLISHING",
      what: "Branch synchronization is publishing.",
      why: "Publication is in progress and remains controlled by the main process.",
      nextAction: "WAIT",
    };
  if (status === "PUBLISHED")
    return {
      code: "SYNC_PUBLISHED",
      what: "Branch synchronization was published.",
      why: "The persisted synchronization result records a completed publication.",
      nextAction: "NONE",
    };
  if (status === "DISCARDED")
    return {
      code: "SYNC_DISCARDED",
      what: "The synchronization result was discarded.",
      why: "No synchronization publication is waiting for you.",
      nextAction: "NONE",
    };
  return {
    code: "SYNC_SKIPPED",
    what: "Branch synchronization was skipped.",
    why: "The persisted synchronization result contains no publication-ready work.",
    nextAction: "NONE",
  };
}

function groupFor(state: PrimaryPrState): ManagedPrInboxGroupId {
  return state === "READY_FOR_REVIEW" || state === "NEEDS_ATTENTION"
    ? "ACTION_NEEDED"
    : state;
}

function groupLabel(id: ManagedPrInboxGroupId): string {
  if (id === "ACTION_NEEDED") return "Action needed";
  if (id === "WORKING") return "Working";
  return "Watching";
}

function normalizedReference(card: ManagedPrInboxCard): string {
  return card.reference.toLowerCase();
}

function compareCards(
  left: ManagedPrInboxCard,
  right: ManagedPrInboxCard,
): number {
  const statePriority = (state: PrimaryPrState): number =>
    state === "NEEDS_ATTENTION" ? 0 : state === "READY_FOR_REVIEW" ? 1 : 0;
  const group = groupFor(left.primaryState);
  if (group === "ACTION_NEEDED" && groupFor(right.primaryState) === group)
    if (statePriority(left.primaryState) !== statePriority(right.primaryState))
      return (
        statePriority(left.primaryState) - statePriority(right.primaryState)
      );
  const updated = right.stateUpdatedAt.localeCompare(left.stateUpdatedAt);
  if (updated !== 0) return updated;
  const reference = normalizedReference(left).localeCompare(
    normalizedReference(right),
  );
  if (reference !== 0) return reference;
  return left.id.localeCompare(right.id);
}

function overlayFor(
  source: ManagedPrInboxSynchronizationSource | undefined,
): ManagedPrInboxSynchronizationOverlay | undefined {
  if (
    source === undefined ||
    !SYNC_STATUSES.has(source.status as ManagedPrInboxSynchronizationStatus)
  )
    return undefined;
  const status = source.status as ManagedPrInboxSynchronizationStatus;
  return {
    id: safeId(source.id),
    status,
    version: source.version,
    updatedAt: safeText(source.updatedAt, 64),
    reason: synchronizationReason(status),
  };
}

export function projectManagedPrInbox(input: {
  readonly managedPrs: readonly ManagedPrReadModel[];
  readonly synchronizationResults?: readonly ManagedPrInboxSynchronizationSource[];
  readonly version: number;
  readonly generatedAt: string;
}): ManagedPrInboxReadModel {
  if (!Number.isSafeInteger(input.version) || input.version < 1)
    throw new ManagedPrInboxProjectionError(
      "The inbox projection version is invalid.",
    );
  const syncByPr = new Map<string, ManagedPrInboxSynchronizationSource>();
  for (const source of input.synchronizationResults ?? []) {
    const existing = syncByPr.get(source.managedPrId);
    if (
      existing === undefined ||
      source.updatedAt > existing.updatedAt ||
      (source.updatedAt === existing.updatedAt &&
        source.version > existing.version) ||
      (source.updatedAt === existing.updatedAt &&
        source.version === existing.version &&
        source.id > existing.id)
    )
      syncByPr.set(source.managedPrId, source);
  }
  if (input.managedPrs.length > MAX_INBOX_CARDS)
    throw new ManagedPrInboxProjectionError(
      "The managed-PR inbox exceeds its bounded card limit.",
    );

  const seenIds = new Set<string>();
  const cards = input.managedPrs.map((managedPr): ManagedPrInboxCard => {
    if (seenIds.has(managedPr.id))
      throw new ManagedPrInboxProjectionError(
        "The managed-PR inbox contains a duplicate identity.",
      );
    seenIds.add(managedPr.id);
    const repository = {
      serverId: safeId(managedPr.serverId),
      key: safeText(managedPr.baseRepository.key),
      owner: safeText(managedPr.owner, 256),
      name: safeText(managedPr.repositoryName, 256),
    };
    const reference = `${repository.owner}/${repository.name} #${managedPr.number}`;
    return {
      schemaVersion: MANAGED_PR_INBOX_SCHEMA_VERSION,
      id: safeId(managedPr.id),
      pullRequestKey: safeText(managedPr.pullRequestKey),
      number: managedPr.number,
      reference,
      ...(managedPr.title === undefined
        ? {}
        : { title: safeText(managedPr.title, 512) }),
      repository,
      baseRepositoryKey: safeText(managedPr.baseRepository.key),
      headRepositoryKey: safeText(managedPr.headRepository.key),
      primaryState: managedPr.primaryState,
      stateUpdatedAt: safeText(managedPr.updatedAt, 64),
      localSetupStatus: managedPr.localSetupStatus,
      reason: safeManagedReason(
        managedPr.primaryState,
        managedPr.lastOperationReason,
      ),
      ...(overlayFor(syncByPr.get(managedPr.id)) === undefined
        ? {}
        : { synchronization: overlayFor(syncByPr.get(managedPr.id)) }),
    };
  });

  const grouped = new Map<ManagedPrInboxGroupId, ManagedPrInboxCard[]>([
    ["ACTION_NEEDED", []],
    ["WORKING", []],
    ["WATCHING", []],
  ]);
  for (const card of cards)
    grouped.get(groupFor(card.primaryState))?.push(card);
  for (const group of grouped.values()) group.sort(compareCards);
  const groupIds: readonly ManagedPrInboxGroupId[] = [
    "ACTION_NEEDED",
    "WORKING",
    "WATCHING",
  ];
  const groups = groupIds.map((id): ManagedPrInboxGroup => {
    const groupCards = grouped.get(id) ?? [];
    return {
      id,
      label: groupLabel(id),
      cardIds: groupCards.map((card) => card.id),
      count: groupCards.length,
    };
  });
  return {
    schemaVersion: MANAGED_PR_INBOX_SCHEMA_VERSION,
    kind: "managed-pr-inbox",
    version: input.version,
    generatedAt: safeText(input.generatedAt, 64),
    cards: groupIds.flatMap((id) => grouped.get(id) ?? []),
    groups,
    counts: {
      total: cards.length,
      actionNeeded: grouped.get("ACTION_NEEDED")?.length ?? 0,
      working: grouped.get("WORKING")?.length ?? 0,
      watching: grouped.get("WATCHING")?.length ?? 0,
    },
  };
}

function exactKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => key in record) &&
    Object.keys(record).every((key) => allowed.has(key))
  );
}

function isSafeText(
  value: unknown,
  maximum = MAX_INBOX_TEXT_BYTES,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    byteLength(value) <= maximum &&
    !SECRET_SHAPED.test(value) &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  );
}

function isInboxReason(value: unknown): value is ManagedPrInboxReason {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  return (
    exactKeys(record, ["code", "what", "why", "nextAction"]) &&
    isSafeText(record.code, 128) &&
    isSafeText(record.what) &&
    isSafeText(record.why) &&
    ["OPEN_DETAILS", "RETRY", "WAIT", "NONE"].includes(
      String(record.nextAction),
    )
  );
}

function isInboxCard(value: unknown): value is ManagedPrInboxCard {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  if (
    !exactKeys(
      record,
      [
        "schemaVersion",
        "id",
        "pullRequestKey",
        "number",
        "reference",
        "repository",
        "baseRepositoryKey",
        "headRepositoryKey",
        "primaryState",
        "stateUpdatedAt",
        "localSetupStatus",
        "reason",
      ],
      ["title", "synchronization"],
    ) ||
    record.schemaVersion !== MANAGED_PR_INBOX_SCHEMA_VERSION
  )
    return false;
  if (
    !SAFE_ID.test(String(record.id)) ||
    !isSafeText(record.pullRequestKey) ||
    typeof record.number !== "number" ||
    !Number.isSafeInteger(record.number) ||
    record.number < 1 ||
    !isSafeText(record.reference) ||
    !isSafeText(record.baseRepositoryKey) ||
    !isSafeText(record.headRepositoryKey) ||
    !isSafeText(record.stateUpdatedAt, 64) ||
    !isInboxReason(record.reason)
  )
    return false;
  if (
    !["WATCHING", "WORKING", "READY_FOR_REVIEW", "NEEDS_ATTENTION"].includes(
      String(record.primaryState),
    )
  )
    return false;
  if (
    ![
      "LOCAL_CLONE_REQUIRED",
      "VALID",
      "DIRTY",
      "MISSING",
      "INVALID",
      "UNKNOWN",
    ].includes(String(record.localSetupStatus))
  )
    return false;
  if (record.title !== undefined && !isSafeText(record.title, 512))
    return false;
  if (
    typeof record.repository !== "object" ||
    record.repository === null ||
    Array.isArray(record.repository)
  )
    return false;
  const repository = record.repository as Record<string, unknown>;
  if (
    !exactKeys(repository, ["serverId", "key", "owner", "name"]) ||
    !SAFE_ID.test(String(repository.serverId)) ||
    !isSafeText(repository.key) ||
    !isSafeText(repository.owner, 256) ||
    !isSafeText(repository.name, 256)
  )
    return false;
  if (record.synchronization !== undefined) {
    if (
      typeof record.synchronization !== "object" ||
      record.synchronization === null ||
      Array.isArray(record.synchronization)
    )
      return false;
    const sync = record.synchronization as Record<string, unknown>;
    if (
      !exactKeys(sync, ["id", "status", "version", "updatedAt", "reason"]) ||
      !SAFE_ID.test(String(sync.id)) ||
      !SYNC_STATUSES.has(
        String(sync.status) as ManagedPrInboxSynchronizationStatus,
      ) ||
      typeof sync.version !== "number" ||
      !Number.isSafeInteger(sync.version) ||
      sync.version < 1 ||
      !isSafeText(sync.updatedAt, 64) ||
      !isInboxReason(sync.reason)
    )
      return false;
  }
  return true;
}

export function isManagedPrInboxReadModel(
  value: unknown,
): value is ManagedPrInboxReadModel {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  if (
    !exactKeys(record, [
      "schemaVersion",
      "kind",
      "version",
      "generatedAt",
      "cards",
      "groups",
      "counts",
    ]) ||
    record.schemaVersion !== MANAGED_PR_INBOX_SCHEMA_VERSION ||
    record.kind !== "managed-pr-inbox" ||
    typeof record.version !== "number" ||
    !Number.isSafeInteger(record.version) ||
    record.version < 1 ||
    !isSafeText(record.generatedAt, 64) ||
    !Array.isArray(record.cards) ||
    record.cards.length > MAX_INBOX_CARDS ||
    !record.cards.every(isInboxCard)
  )
    return false;
  const cardIds = new Set(
    (record.cards as ManagedPrInboxCard[]).map((card) => card.id),
  );
  if (cardIds.size !== record.cards.length) return false;
  if (
    !Array.isArray(record.groups) ||
    record.groups.length !== 3 ||
    !record.groups.every((group) => {
      if (typeof group !== "object" || group === null || Array.isArray(group))
        return false;
      const candidate = group as Record<string, unknown>;
      return (
        exactKeys(candidate, ["id", "label", "cardIds", "count"]) &&
        ["ACTION_NEEDED", "WORKING", "WATCHING"].includes(
          String(candidate.id),
        ) &&
        isSafeText(candidate.label, 64) &&
        Array.isArray(candidate.cardIds) &&
        candidate.cardIds.every(
          (id) => typeof id === "string" && SAFE_ID.test(id),
        ) &&
        typeof candidate.count === "number" &&
        Number.isSafeInteger(candidate.count) &&
        candidate.count >= 0
      );
    })
  )
    return false;
  const groupIds = new Set<string>();
  const groupedCardIds: string[] = [];
  for (const group of record.groups as ManagedPrInboxGroup[]) {
    if (groupIds.has(group.id) || group.count !== group.cardIds.length)
      return false;
    groupIds.add(group.id);
    groupedCardIds.push(...group.cardIds);
  }
  if (
    new Set(groupedCardIds).size !== groupedCardIds.length ||
    groupedCardIds.length !== cardIds.size ||
    groupedCardIds.some((id) => !cardIds.has(id))
  )
    return false;
  if (
    typeof record.counts !== "object" ||
    record.counts === null ||
    Array.isArray(record.counts)
  )
    return false;
  const counts = record.counts as Record<string, unknown>;
  return (
    exactKeys(counts, ["total", "actionNeeded", "working", "watching"]) &&
    [counts.total, counts.actionNeeded, counts.working, counts.watching].every(
      (count) =>
        typeof count === "number" && Number.isSafeInteger(count) && count >= 0,
    ) &&
    counts.total === cardIds.size &&
    counts.actionNeeded ===
      (record.groups as ManagedPrInboxGroup[])[0]?.count &&
    counts.working === (record.groups as ManagedPrInboxGroup[])[1]?.count &&
    counts.watching === (record.groups as ManagedPrInboxGroup[])[2]?.count
  );
}

export function acceptManagedPrInboxSnapshot(
  previous: ManagedPrInboxReadModel | undefined,
  next: ManagedPrInboxReadModel,
): ManagedPrInboxReadModel | undefined {
  if (!isManagedPrInboxReadModel(next)) return previous;
  if (previous === undefined || next.version > previous.version) return next;
  return previous;
}
