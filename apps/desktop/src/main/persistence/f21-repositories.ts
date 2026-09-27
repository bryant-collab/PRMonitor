import { decodeSnapshot, encodeSnapshot } from "./codecs";
import type { PersistenceClock, SqlRow } from "./types";
import type { PersistenceStore } from "./database";
import {
  f21ConversationMessageSchema,
  f21ConversationReadModelSchema,
  f21ConversationTurnRecordSchema,
  F21_MAX_TURNS,
  f21ProposalInputSchema,
  f21UserIntentSchema,
  type F21ConversationMessage,
  type F21ConversationReadModel,
  type F21ConversationTurnRecord,
  type F21ProposalEntryInput,
  type F21UserIntent,
} from "../../shared/f21-conversation";

export interface F21ConversationPersistencePort {
  readonly get: (bundleId: string) => F21ConversationReadModel | undefined;
  readonly saveReadModel: (input: {
    readonly readModel: F21ConversationReadModel;
    readonly expectedBundleVersion?: number;
  }) => F21ConversationReadModel;
  readonly recordIntent: (input: F21UserIntent) => {
    readonly created: boolean;
    readonly intent: F21UserIntent;
  };
  readonly recordMessage: (
    input: F21ConversationMessage,
  ) => F21ConversationMessage;
  readonly recordTurn: (
    input: F21ConversationTurnRecord,
  ) => F21ConversationTurnRecord;
  readonly recordProposalInput: (input: F21ProposalEntryInput) => {
    readonly created: boolean;
    readonly input: F21ProposalEntryInput;
  };
  readonly listMessages: (
    bundleId: string,
  ) => readonly F21ConversationMessage[];
  readonly listTurns: (
    bundleId: string,
  ) => readonly F21ConversationTurnRecord[];
  readonly listTurnsForOperation: (
    operationId: string,
  ) => readonly F21ConversationTurnRecord[];
  readonly listProposalInputs: (
    bundleId: string,
  ) => readonly F21ProposalEntryInput[];
}

function rowString(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`F21_ROW_${key}_INVALID`);
  return value;
}

function rowNumber(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    throw new Error(`F21_ROW_${key}_INVALID`);
  return value;
}

function payloadFromRow<T>(row: SqlRow): T {
  return decodeSnapshot<T>({
    schemaVersion: 1,
    payload: rowString(row, "payload_json"),
    payloadHash: rowString(row, "payload_hash"),
  });
}

function now(clock: PersistenceClock): string {
  return clock.now();
}

export class F21PersistenceRepositories implements F21ConversationPersistencePort {
  private readonly clock: PersistenceClock;

  public constructor(
    private readonly store: PersistenceStore,
    options: { readonly clock?: PersistenceClock } = {},
  ) {
    this.clock = options.clock ?? { now: () => new Date().toISOString() };
  }

  public get(bundleId: string): F21ConversationReadModel | undefined {
    return this.store.transaction(
      (transaction) => {
        const row = transaction.get(
          "SELECT * FROM f21_conversations WHERE bundle_id = ?",
          bundleId,
        );
        if (row === undefined) return undefined;
        const payload = f21ConversationReadModelSchema.parse(
          payloadFromRow<unknown>(row),
        );
        if (
          payload.bundleId !== rowString(row, "bundle_id") ||
          payload.bundleVersion !== rowNumber(row, "version") ||
          payload.evidenceRevision !== rowString(row, "evidence_revision")
        )
          throw new Error("F21_CONVERSATION_PROJECTION_MISMATCH");
        return payload;
      },
      { maxAttempts: 1 },
    );
  }

  public saveReadModel(input: {
    readonly readModel: F21ConversationReadModel;
    readonly expectedBundleVersion?: number;
  }): F21ConversationReadModel {
    const readModel = f21ConversationReadModelSchema.parse(input.readModel);
    const encoded = encodeSnapshot(readModel);
    return this.store.transaction((transaction) => {
      const current = transaction.get(
        "SELECT * FROM f21_conversations WHERE bundle_id = ?",
        readModel.bundleId,
      );
      const timestamp = now(this.clock);
      if (current === undefined) {
        if (input.expectedBundleVersion !== undefined)
          throw new Error("F21_CONVERSATION_CONFLICT");
        transaction.run(
          "INSERT INTO f21_conversations (bundle_id, version, evidence_revision, payload_json, payload_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          readModel.bundleId,
          readModel.bundleVersion,
          readModel.evidenceRevision,
          encoded.payload,
          encoded.payloadHash,
          timestamp,
          timestamp,
        );
      } else {
        const currentVersion = rowNumber(current, "version");
        if (
          input.expectedBundleVersion !== undefined &&
          input.expectedBundleVersion !== currentVersion
        )
          throw new Error("F21_CONVERSATION_CONFLICT");
        if (readModel.bundleVersion < currentVersion)
          throw new Error("F21_CONVERSATION_VERSION_REGRESSION");
        transaction.run(
          "UPDATE f21_conversations SET version = ?, evidence_revision = ?, payload_json = ?, payload_hash = ?, updated_at = ? WHERE bundle_id = ? AND version = ?",
          readModel.bundleVersion,
          readModel.evidenceRevision,
          encoded.payload,
          encoded.payloadHash,
          timestamp,
          readModel.bundleId,
          currentVersion,
        );
      }
      const row = transaction.get(
        "SELECT * FROM f21_conversations WHERE bundle_id = ?",
        readModel.bundleId,
      );
      if (row === undefined) throw new Error("F21_CONVERSATION_NOT_READABLE");
      return f21ConversationReadModelSchema.parse(payloadFromRow<unknown>(row));
    });
  }

  public recordIntent(input: F21UserIntent): {
    readonly created: boolean;
    readonly intent: F21UserIntent;
  } {
    const intent = f21UserIntentSchema.parse(input);
    const encoded = encodeSnapshot(intent);
    return this.store.transaction((transaction) => {
      const existing = transaction.get(
        "SELECT * FROM f21_conversation_intents WHERE idempotency_key = ?",
        intent.idempotencyKey,
      );
      if (existing !== undefined) {
        const stored = f21UserIntentSchema.parse(
          payloadFromRow<unknown>(existing),
        );
        if (
          stored.intentId !== intent.intentId ||
          stored.bundleId !== intent.bundleId
        )
          throw new Error("F21_INTENT_IDEMPOTENCY_CONFLICT");
        return { created: false, intent: stored };
      }
      transaction.run(
        "INSERT INTO f21_conversation_intents (intent_id, bundle_id, idempotency_key, mode, payload_json, payload_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        intent.intentId,
        intent.bundleId,
        intent.idempotencyKey,
        intent.mode,
        encoded.payload,
        encoded.payloadHash,
        intent.createdAt,
      );
      return { created: true, intent };
    });
  }

  public recordMessage(input: F21ConversationMessage): F21ConversationMessage {
    const message = f21ConversationMessageSchema.parse(input);
    const encoded = encodeSnapshot(message);
    return this.store.transaction((transaction) => {
      const existing = transaction.get(
        "SELECT * FROM f21_conversation_messages WHERE message_id = ?",
        message.messageId,
      );
      if (existing !== undefined)
        return f21ConversationMessageSchema.parse(
          payloadFromRow<unknown>(existing),
        );
      transaction.run(
        "INSERT INTO f21_conversation_messages (message_id, bundle_id, turn_id, sequence, role, payload_json, payload_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        message.messageId,
        message.bundleId,
        message.turnId,
        0,
        message.role,
        encoded.payload,
        encoded.payloadHash,
        message.createdAt,
      );
      return message;
    });
  }

  public recordTurn(
    input: F21ConversationTurnRecord,
  ): F21ConversationTurnRecord {
    const turn = f21ConversationTurnRecordSchema.parse(input);
    const encoded = encodeSnapshot(turn);
    return this.store.transaction((transaction) => {
      const existing = transaction.get(
        "SELECT * FROM f21_conversation_turns WHERE turn_id = ?",
        turn.turnId,
      );
      if (existing === undefined) {
        transaction.run(
          "INSERT INTO f21_conversation_turns (turn_id, bundle_id, operation_id, mode, status, payload_json, payload_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          turn.turnId,
          turn.bundleId,
          turn.operationId ?? null,
          turn.mode,
          turn.status,
          encoded.payload,
          encoded.payloadHash,
          turn.createdAt,
          turn.updatedAt,
        );
      } else {
        transaction.run(
          "UPDATE f21_conversation_turns SET operation_id = ?, mode = ?, status = ?, payload_json = ?, payload_hash = ?, updated_at = ? WHERE turn_id = ?",
          turn.operationId ?? null,
          turn.mode,
          turn.status,
          encoded.payload,
          encoded.payloadHash,
          turn.updatedAt,
          turn.turnId,
        );
      }
      return turn;
    });
  }

  public recordProposalInput(input: F21ProposalEntryInput): {
    readonly created: boolean;
    readonly input: F21ProposalEntryInput;
  } {
    const proposalInput = f21ProposalInputSchema.parse(input);
    const encoded = encodeSnapshot(proposalInput);
    return this.store.transaction((transaction) => {
      const existing = transaction.get(
        "SELECT * FROM f21_proposal_inputs WHERE command_id = ?",
        proposalInput.commandId,
      );
      if (existing !== undefined)
        return {
          created: false,
          input: f21ProposalInputSchema.parse(
            payloadFromRow<unknown>(existing),
          ),
        };
      transaction.run(
        "INSERT INTO f21_proposal_inputs (command_id, bundle_id, item_id, kind, payload_json, payload_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        proposalInput.commandId,
        proposalInput.bundleId,
        proposalInput.itemId,
        proposalInput.kind,
        encoded.payload,
        encoded.payloadHash,
        proposalInput.createdAt,
      );
      return { created: true, input: proposalInput };
    });
  }

  public listMessages(bundleId: string): readonly F21ConversationMessage[] {
    return this.store
      .readAll(
        "SELECT * FROM f21_conversation_messages WHERE bundle_id = ? ORDER BY created_at DESC, message_id DESC LIMIT ?",
        bundleId,
        F21_MAX_TURNS * 2,
      )
      .map((row) =>
        f21ConversationMessageSchema.parse(payloadFromRow<unknown>(row)),
      )
      .reverse();
  }

  public listTurns(bundleId: string): readonly F21ConversationTurnRecord[] {
    return this.store
      .readAll(
        "SELECT * FROM f21_conversation_turns WHERE bundle_id = ? ORDER BY created_at DESC, turn_id DESC LIMIT ?",
        bundleId,
        F21_MAX_TURNS,
      )
      .map((row) =>
        f21ConversationTurnRecordSchema.parse(payloadFromRow<unknown>(row)),
      )
      .reverse();
  }

  public listTurnsForOperation(
    operationId: string,
  ): readonly F21ConversationTurnRecord[] {
    return this.store.transaction(
      (transaction) => {
        const rows = transaction.all(
          "SELECT * FROM f21_conversation_turns WHERE operation_id = ? ORDER BY created_at ASC LIMIT ?",
          operationId,
          F21_MAX_TURNS,
        );
        return rows.map((row) =>
          f21ConversationTurnRecordSchema.parse(payloadFromRow<unknown>(row)),
        );
      },
      { maxAttempts: 1 },
    );
  }

  public listProposalInputs(
    bundleId: string,
  ): readonly F21ProposalEntryInput[] {
    return this.store
      .readAll(
        "SELECT * FROM f21_proposal_inputs WHERE bundle_id = ? ORDER BY created_at ASC, command_id ASC LIMIT 256",
        bundleId,
      )
      .map((row) => f21ProposalInputSchema.parse(payloadFromRow<unknown>(row)));
  }
}
