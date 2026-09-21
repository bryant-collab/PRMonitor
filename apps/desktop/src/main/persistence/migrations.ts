import { createHash } from "node:crypto";
import { PERSISTENCE_SCHEMA_VERSION, type MigrationDefinition } from "./types";
import type { SqliteDatabase } from "./types";

const MIGRATION_1 = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  migration_id TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  application_build TEXT NOT NULL,
  schema_version INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS persistence_health (
  health_id INTEGER PRIMARY KEY CHECK (health_id = 1),
  status TEXT NOT NULL,
  stage TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  database_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  reason_code TEXT,
  recommended_action TEXT,
  backup_path TEXT,
  details_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS backup_metadata (
  backup_id TEXT PRIMARY KEY,
  source_schema_version INTEGER NOT NULL,
  target_schema_version INTEGER NOT NULL,
  database_id TEXT NOT NULL,
  backup_path TEXT NOT NULL UNIQUE,
  owner_marker_path TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  verified_at TEXT,
  retained INTEGER NOT NULL DEFAULT 1 CHECK (retained IN (0, 1))
);
PRAGMA user_version = 1;
`;

const MIGRATION_2 = `
CREATE TABLE IF NOT EXISTS settings (
  setting_key TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  value_json TEXT NOT NULL,
  value_hash TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS configuration_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (owner_type, owner_id, revision),
  UNIQUE (owner_type, owner_id, payload_hash)
);
CREATE TABLE IF NOT EXISTS validation_profiles (
  profile_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, revision)
);
CREATE TABLE IF NOT EXISTS validation_approvals (
  approval_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  profile_revision INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS common_instructions (
  instruction_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (instruction_id, revision)
);
CREATE TABLE IF NOT EXISTS ai_task_profiles (
  profile_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, revision)
);
CREATE TABLE IF NOT EXISTS execution_policies (
  policy_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (policy_id, revision)
);
CREATE TABLE IF NOT EXISTS github_servers (
  server_id TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  api_base_url TEXT NOT NULL,
  credential_ref TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (host, api_base_url)
);
CREATE TABLE IF NOT EXISTS repositories (
  repository_id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES github_servers(server_id),
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  default_branch TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (server_id, owner, name)
);
CREATE TABLE IF NOT EXISTS resource_checkpoints (
  checkpoint_id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id TEXT NOT NULL REFERENCES github_servers(server_id),
  repository_id TEXT REFERENCES repositories(repository_id),
  resource_kind TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  etag TEXT,
  last_modified TEXT,
  pagination_cursor TEXT,
  observed_version INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  UNIQUE (server_id, repository_id, resource_kind, resource_key)
);
CREATE TABLE IF NOT EXISTS managed_prs (
  managed_pr_id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES github_servers(server_id),
  base_repository_id TEXT NOT NULL REFERENCES repositories(repository_id),
  head_repository_id TEXT NOT NULL REFERENCES repositories(repository_id),
  number INTEGER NOT NULL,
  base_branch TEXT NOT NULL,
  head_branch TEXT NOT NULL,
  base_sha TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  sync_source_branch_override TEXT,
  state TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  intent_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (server_id, base_repository_id, number)
);
CREATE TABLE IF NOT EXISTS remote_event_versions (
  event_version_id TEXT PRIMARY KEY,
  managed_pr_id TEXT NOT NULL REFERENCES managed_prs(managed_pr_id),
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_repository_id TEXT REFERENCES repositories(repository_id),
  observed_at TEXT NOT NULL,
  source_updated_at TEXT,
  semantic_hash TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (managed_pr_id, source_kind, source_id, semantic_hash)
);
CREATE TABLE IF NOT EXISTS resource_observations (
  observation_id TEXT PRIMARY KEY,
  managed_pr_id TEXT REFERENCES managed_prs(managed_pr_id),
  server_id TEXT NOT NULL REFERENCES github_servers(server_id),
  resource_kind TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  remote_identity TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  semantic_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE (server_id, resource_kind, resource_key, remote_identity, semantic_hash)
);
CREATE TABLE IF NOT EXISTS review_batches (
  batch_id TEXT PRIMARY KEY,
  managed_pr_id TEXT NOT NULL REFERENCES managed_prs(managed_pr_id),
  schema_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (managed_pr_id, payload_hash)
);
CREATE TABLE IF NOT EXISTS review_bundles (
  bundle_id TEXT PRIMARY KEY,
  managed_pr_id TEXT NOT NULL REFERENCES managed_prs(managed_pr_id),
  batch_id TEXT NOT NULL REFERENCES review_batches(batch_id),
  state TEXT NOT NULL,
  automatic_operation_key TEXT,
  schema_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (managed_pr_id, automatic_operation_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS review_bundles_one_active_operation
  ON review_bundles(managed_pr_id)
  WHERE state IN ('WORKING', 'READY_FOR_REVIEW', 'NEEDS_ATTENTION', 'PUBLISHING');
CREATE TABLE IF NOT EXISTS review_bundle_items (
  item_id TEXT PRIMARY KEY,
  bundle_id TEXT NOT NULL REFERENCES review_bundles(bundle_id),
  event_version_id TEXT NOT NULL REFERENCES remote_event_versions(event_version_id),
  schema_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  associated_at TEXT NOT NULL,
  UNIQUE (bundle_id, event_version_id)
);
CREATE TABLE IF NOT EXISTS review_holds (
  hold_id TEXT PRIMARY KEY,
  managed_pr_id TEXT NOT NULL REFERENCES managed_prs(managed_pr_id),
  bundle_id TEXT NOT NULL REFERENCES review_bundles(bundle_id),
  state TEXT NOT NULL CHECK (state IN ('ACTIVE', 'RELEASED')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  acquired_at TEXT NOT NULL,
  released_at TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS review_holds_one_active
  ON review_holds(managed_pr_id) WHERE state = 'ACTIVE';
CREATE TABLE IF NOT EXISTS transition_history (
  transition_id TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  prior_state TEXT,
  current_state TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (aggregate_type, aggregate_id, sequence)
);
CREATE TABLE IF NOT EXISTS handled_event_versions (
  event_version_id TEXT PRIMARY KEY REFERENCES remote_event_versions(event_version_id),
  bundle_id TEXT NOT NULL REFERENCES review_bundles(bundle_id),
  association_state TEXT NOT NULL,
  associated_at TEXT NOT NULL,
  handled_at TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS approvals (
  approval_id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  reviewed_snapshot_hash TEXT,
  approved_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_work_operations (
  operation_id TEXT PRIMARY KEY,
  managed_pr_id TEXT REFERENCES managed_prs(managed_pr_id),
  operation_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  task_profile_snapshot_json TEXT NOT NULL,
  task_profile_snapshot_hash TEXT NOT NULL,
  execution_policy_snapshot_json TEXT NOT NULL,
  execution_policy_snapshot_hash TEXT NOT NULL,
  input_snapshot_json TEXT NOT NULL,
  input_snapshot_hash TEXT NOT NULL,
  configured_turn_budget INTEGER NOT NULL CHECK (configured_turn_budget BETWEEN 1 AND 10),
  consumed_turn_count INTEGER NOT NULL DEFAULT 0 CHECK (consumed_turn_count >= 0),
  version INTEGER NOT NULL DEFAULT 1,
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_work_segments (
  segment_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES ai_work_operations(operation_id),
  segment_index INTEGER NOT NULL,
  status TEXT NOT NULL,
  configured_turn_budget INTEGER NOT NULL CHECK (configured_turn_budget BETWEEN 1 AND 10),
  consumed_turn_baseline INTEGER NOT NULL CHECK (consumed_turn_baseline >= 0),
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (operation_id, segment_index)
);
CREATE TABLE IF NOT EXISTS ai_work_turns (
  turn_id TEXT PRIMARY KEY,
  segment_id TEXT NOT NULL REFERENCES ai_work_segments(segment_id),
  turn_index INTEGER NOT NULL,
  status TEXT NOT NULL,
  deterministic_activity_json TEXT NOT NULL DEFAULT '{}',
  report_json TEXT NOT NULL DEFAULT '{}',
  validation_refs_json TEXT NOT NULL DEFAULT '[]',
  progress_classification TEXT,
  state_fingerprint TEXT,
  stop_reason_json TEXT,
  usage_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (segment_id, turn_index)
);
CREATE TABLE IF NOT EXISTS conversations (
  conversation_id TEXT PRIMARY KEY,
  operation_id TEXT REFERENCES ai_work_operations(operation_id),
  scope TEXT NOT NULL,
  opaque_reference TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS validation_runs (
  run_id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS validation_steps (
  run_id TEXT NOT NULL REFERENCES validation_runs(run_id),
  step_id TEXT NOT NULL,
  status TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  PRIMARY KEY (run_id, step_id)
);
CREATE TABLE IF NOT EXISTS validation_manual_checks (
  run_id TEXT NOT NULL REFERENCES validation_runs(run_id),
  check_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  PRIMARY KEY (run_id, check_id)
);
CREATE TABLE IF NOT EXISTS worktrees (
  worktree_id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  operation_kind TEXT NOT NULL,
  canonical_path TEXT NOT NULL,
  baseline_sha TEXT NOT NULL,
  current_sha TEXT,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (canonical_path)
);
CREATE TABLE IF NOT EXISTS diffs (
  diff_id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  baseline_sha TEXT NOT NULL,
  current_sha TEXT,
  diff_hash TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS synchronization_batches (
  synchronization_batch_id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS synchronization_results (
  synchronization_operation_id TEXT PRIMARY KEY,
  synchronization_batch_id TEXT NOT NULL REFERENCES synchronization_batches(synchronization_batch_id),
  managed_pr_id TEXT NOT NULL REFERENCES managed_prs(managed_pr_id),
  status TEXT NOT NULL,
  source_repository_id TEXT,
  destination_repository_id TEXT,
  source_branch TEXT,
  destination_branch TEXT,
  sync_source_sha TEXT,
  pr_head_sha TEXT,
  worktree_id TEXT REFERENCES worktrees(worktree_id),
  ai_operation_id TEXT REFERENCES ai_work_operations(operation_id),
  reason_json TEXT NOT NULL DEFAULT '{}',
  diff_id TEXT REFERENCES diffs(diff_id),
  validation_run_id TEXT REFERENCES validation_runs(run_id),
  payload_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS synchronization_conflicts (
  synchronization_operation_id TEXT NOT NULL REFERENCES synchronization_results(synchronization_operation_id),
  path TEXT NOT NULL,
  reason_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY (synchronization_operation_id, path)
);
CREATE TABLE IF NOT EXISTS publication_intents (
  publication_id TEXT PRIMARY KEY,
  publication_kind TEXT NOT NULL CHECK (publication_kind IN ('REVIEW_BUNDLE', 'SYNCHRONIZATION_RESULT')),
  owner_id TEXT NOT NULL,
  approval_id TEXT NOT NULL REFERENCES approvals(approval_id),
  idempotency_key TEXT NOT NULL,
  expected_baseline_sha TEXT,
  expected_source_sha TEXT,
  expected_head_sha TEXT,
  proposed_result_json TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  payload_hash TEXT NOT NULL DEFAULT '',
  phase TEXT NOT NULL,
  recovery_state TEXT NOT NULL,
  known_commit_sha TEXT,
  push_evidence_json TEXT NOT NULL DEFAULT '{}',
  payload_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (publication_kind, idempotency_key)
);
CREATE TABLE IF NOT EXISTS publication_responses (
  publication_id TEXT NOT NULL REFERENCES publication_intents(publication_id),
  response_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('PENDING', 'POSTED', 'FAILED', 'UNKNOWN')),
  idempotency_key TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  remote_id TEXT,
  error_code TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (publication_id, response_key),
  UNIQUE (publication_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS external_effects (
  effect_id TEXT PRIMARY KEY,
  publication_id TEXT REFERENCES publication_intents(publication_id),
  effect_kind TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL,
  known_remote_id TEXT,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stale_history (
  stale_id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  reason_json TEXT NOT NULL,
  observed_head_sha TEXT,
  current_head_sha TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS activity_events (
  activity_event_id TEXT PRIMARY KEY,
  correlation_id TEXT NOT NULL,
  owner_type TEXT,
  owner_id TEXT,
  severity TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_remote_events_pr ON remote_event_versions(managed_pr_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_transition_history_aggregate ON transition_history(aggregate_type, aggregate_id, sequence);
CREATE INDEX IF NOT EXISTS idx_ai_turns_segment ON ai_work_turns(segment_id, turn_index);
CREATE INDEX IF NOT EXISTS idx_sync_results_batch ON synchronization_results(synchronization_batch_id);
CREATE INDEX IF NOT EXISTS idx_activity_correlation ON activity_events(correlation_id, created_at);
PRAGMA user_version = 2;
`;

const MIGRATION_3 = `
CREATE TABLE IF NOT EXISTS github_server_auth (
  server_id TEXT PRIMARY KEY REFERENCES github_servers(server_id),
  status TEXT NOT NULL,
  store_state TEXT NOT NULL,
  active_ref TEXT,
  active_revision INTEGER,
  candidate_ref TEXT,
  candidate_revision INTEGER,
  account_login TEXT,
  account_name TEXT,
  verified_at TEXT,
  last_test_at TEXT,
  reason_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((active_ref IS NULL AND active_revision IS NULL) OR (active_ref IS NOT NULL AND active_revision IS NOT NULL AND active_revision > 0)),
  CHECK ((candidate_ref IS NULL AND candidate_revision IS NULL) OR (candidate_ref IS NOT NULL AND candidate_revision IS NOT NULL AND candidate_revision > 0))
);

CREATE TABLE IF NOT EXISTS github_credential_operations (
  operation_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  server_id TEXT NOT NULL REFERENCES github_servers(server_id),
  profile_version INTEGER NOT NULL,
  operation_kind TEXT NOT NULL,
  phase TEXT NOT NULL,
  candidate_ref TEXT,
  candidate_revision INTEGER,
  previous_active_ref TEXT,
  previous_active_revision INTEGER,
  endpoint_snapshot_json TEXT NOT NULL,
  reason_json TEXT NOT NULL DEFAULT '{}',
  test_result_json TEXT NOT NULL DEFAULT '{}',
  cleanup_state TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((candidate_ref IS NULL AND candidate_revision IS NULL) OR (candidate_ref IS NOT NULL AND candidate_revision IS NOT NULL AND candidate_revision > 0)),
  CHECK ((previous_active_ref IS NULL AND previous_active_revision IS NULL) OR (previous_active_ref IS NOT NULL AND previous_active_revision IS NOT NULL AND previous_active_revision > 0))
);

CREATE INDEX IF NOT EXISTS idx_github_credential_operations_server
  ON github_credential_operations(server_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_github_credential_operations_recovery
  ON github_credential_operations(phase, cleanup_state, updated_at);
PRAGMA user_version = 3;
`;

const MIGRATION_4 = `
CREATE TABLE IF NOT EXISTS f07_add_pr_attempts (
  attempt_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  canonical_pr_key TEXT NOT NULL UNIQUE,
  server_id TEXT NOT NULL REFERENCES github_servers(server_id),
  correlation_id TEXT NOT NULL,
  profile_version INTEGER NOT NULL,
  normalized_url TEXT NOT NULL,
  parsed_input_json TEXT NOT NULL,
  parsed_input_hash TEXT NOT NULL,
  context_present INTEGER NOT NULL CHECK (context_present IN (0, 1)),
  context_text TEXT,
  override_present INTEGER NOT NULL CHECK (override_present IN (0, 1)),
  override_text TEXT,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'SUCCEEDED', 'CANCELLED', 'FAILED', 'RECOVERY_REQUIRED')),
  managed_pr_id TEXT REFERENCES managed_prs(managed_pr_id),
  reason_json TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS f07_pr_configuration_revisions (
  revision_id TEXT PRIMARY KEY,
  managed_pr_id TEXT NOT NULL REFERENCES managed_prs(managed_pr_id),
  revision INTEGER NOT NULL,
  context_present INTEGER NOT NULL CHECK (context_present IN (0, 1)),
  context_text TEXT,
  override_present INTEGER NOT NULL CHECK (override_present IN (0, 1)),
  override_text TEXT,
  content_hash TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('ADD_PR', 'USER_EDIT')),
  created_at TEXT NOT NULL,
  UNIQUE (managed_pr_id, revision)
);

CREATE TABLE IF NOT EXISTS f07_managed_prs (
  managed_pr_id TEXT PRIMARY KEY REFERENCES managed_prs(managed_pr_id),
  server_id TEXT NOT NULL REFERENCES github_servers(server_id),
  canonical_pr_key TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  owner TEXT NOT NULL,
  repository_name TEXT NOT NULL,
  number INTEGER NOT NULL,
  base_repository_key TEXT NOT NULL,
  head_repository_key TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  head_branch TEXT NOT NULL,
  base_sha TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  remote_state TEXT NOT NULL CHECK (remote_state IN ('OPEN', 'CLOSED')),
  merged INTEGER NOT NULL CHECK (merged IN (0, 1)),
  default_branch TEXT,
  remote_snapshot_json TEXT NOT NULL,
  remote_snapshot_hash TEXT NOT NULL,
  primary_state TEXT NOT NULL,
  local_setup_status TEXT NOT NULL CHECK (local_setup_status IN ('LOCAL_CLONE_REQUIRED', 'VALID', 'DIRTY', 'MISSING', 'INVALID', 'UNKNOWN')),
  current_configuration_revision_id TEXT NOT NULL,
  current_configuration_revision INTEGER NOT NULL,
  last_operation_reason_json TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (server_id, canonical_pr_key)
);

CREATE TABLE IF NOT EXISTS f07_local_clone_associations (
  association_id TEXT PRIMARY KEY,
  managed_pr_id TEXT NOT NULL UNIQUE REFERENCES managed_prs(managed_pr_id),
  canonical_root TEXT NOT NULL,
  repository_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('VALID', 'DIRTY', 'MISSING', 'INVALID', 'UNKNOWN')),
  clean_state TEXT NOT NULL CHECK (clean_state IN ('CLEAN', 'DIRTY', 'UNKNOWN')),
  validation_snapshot_json TEXT NOT NULL,
  validated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_f07_add_attempts_status
  ON f07_add_pr_attempts(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_f07_clone_candidates
  ON f07_local_clone_associations(canonical_root, updated_at);
CREATE INDEX IF NOT EXISTS idx_f07_managed_prs_owner
  ON f07_managed_prs(server_id, owner, repository_name, number);
PRAGMA user_version = 4;
`;

const MIGRATION_5 = `
ALTER TABLE review_bundles ADD COLUMN stage TEXT NOT NULL DEFAULT 'FINAL_REVIEW';

CREATE TABLE IF NOT EXISTS review_bundle_item_decisions (
  decision_id TEXT PRIMARY KEY,
  bundle_id TEXT NOT NULL REFERENCES review_bundles(bundle_id),
  item_id TEXT NOT NULL REFERENCES review_bundle_items(item_id),
  decision TEXT NOT NULL CHECK (decision IN ('pending', 'accepted', 'overridden')),
  final_disposition TEXT NOT NULL CHECK (final_disposition IN ('fixed', 'pushback', 'question', 'no_change')),
  user_instructions TEXT,
  question_answer TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE (bundle_id, item_id)
);

CREATE TABLE IF NOT EXISTS review_bundle_item_decision_history (
  history_id TEXT PRIMARY KEY,
  bundle_id TEXT NOT NULL REFERENCES review_bundles(bundle_id),
  item_id TEXT NOT NULL REFERENCES review_bundle_items(item_id),
  decision TEXT NOT NULL,
  final_disposition TEXT NOT NULL,
  user_instructions TEXT,
  question_answer TEXT,
  action_id TEXT,
  created_at TEXT NOT NULL
);

ALTER TABLE synchronization_results ADD COLUMN sync_merge_base_sha TEXT;
ALTER TABLE synchronization_results ADD COLUMN source_change_evidence_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE synchronization_results ADD COLUMN pr_head_change_evidence_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE synchronization_results ADD COLUMN user_consultation_json TEXT;
ALTER TABLE synchronization_conflicts ADD COLUMN source_text TEXT;
ALTER TABLE synchronization_conflicts ADD COLUMN destination_text TEXT;
ALTER TABLE synchronization_conflicts ADD COLUMN merge_base_text TEXT;
ALTER TABLE synchronization_conflicts ADD COLUMN details_json TEXT NOT NULL DEFAULT '{}';

PRAGMA user_version = 5;
`;

function checksum(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

export const MIGRATIONS: readonly MigrationDefinition[] = [
  {
    version: 1,
    id: "F03-001-foundation-ledger",
    sql: MIGRATION_1,
    checksum: checksum(MIGRATION_1),
  },
  {
    version: 2,
    id: "F03-002-domain-record-families",
    sql: MIGRATION_2,
    checksum: checksum(MIGRATION_2),
  },
  {
    version: 3,
    id: "F05-001-secure-github-auth-records",
    sql: MIGRATION_3,
    checksum: checksum(MIGRATION_3),
  },
  {
    version: 4,
    id: "F07-001-managed-pr-add-and-configuration-records",
    sql: MIGRATION_4,
    checksum: checksum(MIGRATION_4),
  },
  {
    version: 5,
    id: "F02-F03-001-staged-review-and-sync-evidence",
    sql: MIGRATION_5,
    checksum: checksum(MIGRATION_5),
  },
];

export function currentMigrationVersion(): number {
  return PERSISTENCE_SCHEMA_VERSION;
}

export function migrationByVersion(
  version: number,
): MigrationDefinition | undefined {
  return MIGRATIONS.find((migration) => migration.version === version);
}

export function readUserVersion(database: SqliteDatabase): number {
  const row = database.prepare("PRAGMA user_version").get() as
    { user_version?: unknown } | undefined;
  return typeof row?.user_version === "number" ? row.user_version : 0;
}
