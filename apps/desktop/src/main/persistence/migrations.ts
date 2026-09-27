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

const MIGRATION_6 = `
ALTER TABLE activity_events ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE activity_events ADD COLUMN event_type TEXT NOT NULL DEFAULT 'LEGACY_ACTIVITY';
ALTER TABLE activity_events ADD COLUMN stage TEXT NOT NULL DEFAULT 'SYSTEM';
ALTER TABLE activity_events ADD COLUMN operation_id TEXT;
ALTER TABLE activity_events ADD COLUMN parent_event_id TEXT;
ALTER TABLE activity_events ADD COLUMN causation_event_id TEXT;
ALTER TABLE activity_events ADD COLUMN attempt_id TEXT;
ALTER TABLE activity_events ADD COLUMN attempt_number INTEGER;
ALTER TABLE activity_events ADD COLUMN attempt_outcome TEXT;
ALTER TABLE activity_events ADD COLUMN managed_pr_id TEXT;
ALTER TABLE activity_events ADD COLUMN occurrence_at TEXT NOT NULL DEFAULT '';
ALTER TABLE activity_events ADD COLUMN recorded_at TEXT NOT NULL DEFAULT '';
ALTER TABLE activity_events ADD COLUMN summary TEXT NOT NULL DEFAULT 'Legacy activity event';
ALTER TABLE activity_events ADD COLUMN reason_what TEXT NOT NULL DEFAULT 'A legacy activity event was recorded.';
ALTER TABLE activity_events ADD COLUMN reason_why TEXT NOT NULL DEFAULT 'The event predates the structured activity contract.';
ALTER TABLE activity_events ADD COLUMN next_action TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE activity_events ADD COLUMN details_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE activity_events ADD COLUMN work_item_json TEXT;
ALTER TABLE activity_events ADD COLUMN work_item_key TEXT;
ALTER TABLE activity_events ADD COLUMN related_target_json TEXT;
ALTER TABLE activity_events ADD COLUMN payload_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE activity_events ADD COLUMN retention_state TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE activity_events ADD COLUMN owner_version INTEGER;
ALTER TABLE activity_events ADD COLUMN owner_revision INTEGER;

UPDATE activity_events
SET occurrence_at = CASE WHEN occurrence_at = '' THEN created_at ELSE occurrence_at END,
    recorded_at = CASE WHEN recorded_at = '' THEN created_at ELSE recorded_at END,
    details_json = CASE WHEN details_json = '{}' THEN payload_json ELSE details_json END;

CREATE TABLE IF NOT EXISTS activity_retention_runs (
  retention_run_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  deleted_count INTEGER NOT NULL DEFAULT 0,
  protected_count INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_activity_order
  ON activity_events(recorded_at, activity_event_id);
CREATE INDEX IF NOT EXISTS idx_activity_owner
  ON activity_events(owner_type, owner_id, recorded_at, activity_event_id);
CREATE INDEX IF NOT EXISTS idx_activity_managed_pr
  ON activity_events(managed_pr_id, recorded_at, activity_event_id);
CREATE INDEX IF NOT EXISTS idx_activity_operation
  ON activity_events(operation_id, recorded_at, activity_event_id);
CREATE INDEX IF NOT EXISTS idx_activity_severity
  ON activity_events(severity, recorded_at, activity_event_id);
CREATE INDEX IF NOT EXISTS idx_activity_reason
  ON activity_events(reason_code, recorded_at, activity_event_id);
CREATE INDEX IF NOT EXISTS idx_activity_stage
  ON activity_events(stage, recorded_at, activity_event_id);
CREATE INDEX IF NOT EXISTS idx_activity_work_item
  ON activity_events(work_item_key, recorded_at, activity_event_id);
PRAGMA user_version = 6;
`;

const MIGRATION_7 = `
CREATE TABLE IF NOT EXISTS f10_poll_runs (
  poll_run_id TEXT PRIMARY KEY,
  correlation_id TEXT NOT NULL,
  configuration_json TEXT NOT NULL,
  configuration_hash TEXT NOT NULL,
  managed_pr_count INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED', 'INTERRUPTED')),
  new_version_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  reason_json TEXT
);

CREATE TABLE IF NOT EXISTS f10_poll_resource_attempts (
  resource_attempt_id TEXT PRIMARY KEY,
  poll_run_id TEXT NOT NULL REFERENCES f10_poll_runs(poll_run_id),
  managed_pr_id TEXT NOT NULL REFERENCES managed_prs(managed_pr_id),
  server_id TEXT NOT NULL REFERENCES github_servers(server_id),
  repository_key TEXT NOT NULL,
  resource_kind TEXT NOT NULL CHECK (resource_kind IN ('pull_request', 'review_comments', 'reviews', 'issue_comments')),
  resource_key TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  request_json TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  prior_checkpoint_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'NOT_MODIFIED', 'FAILED', 'CANCELLED', 'INTERRUPTED', 'SKIPPED')),
  outcome TEXT NOT NULL CHECK (outcome IN ('PENDING', 'COMPLETED', 'NOT_MODIFIED', 'FAILED', 'CANCELLED', 'INTERRUPTED', 'SKIPPED')),
  reason_json TEXT,
  new_version_count INTEGER NOT NULL DEFAULT 0,
  observed_version_ids_json TEXT NOT NULL DEFAULT '[]',
  new_version_ids_json TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  started_at TEXT NOT NULL,
  committed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (poll_run_id, resource_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS f10_one_active_resource_attempt
  ON f10_poll_resource_attempts(managed_pr_id, resource_key)
  WHERE status IN ('PENDING', 'RUNNING');
CREATE INDEX IF NOT EXISTS idx_f10_poll_attempts_run
  ON f10_poll_resource_attempts(poll_run_id, resource_key);
CREATE INDEX IF NOT EXISTS idx_f10_poll_attempts_recovery
  ON f10_poll_resource_attempts(status, updated_at);

CREATE TABLE IF NOT EXISTS f10_pr_metadata_snapshots (
  managed_pr_id TEXT PRIMARY KEY REFERENCES managed_prs(managed_pr_id),
  observed_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  metadata_hash TEXT NOT NULL,
  last_attempt_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

PRAGMA user_version = 7;
`;

const MIGRATION_8 = `
ALTER TABLE remote_event_versions ADD COLUMN resource_attempt_id TEXT;
ALTER TABLE remote_event_versions ADD COLUMN resource_checkpoint_id TEXT;
ALTER TABLE remote_event_versions ADD COLUMN resource_observation_id TEXT;
CREATE INDEX IF NOT EXISTS idx_remote_events_resource_attempt
  ON remote_event_versions(resource_attempt_id, event_version_id);
CREATE INDEX IF NOT EXISTS idx_remote_events_resource_checkpoint
  ON remote_event_versions(resource_checkpoint_id, event_version_id);
PRAGMA user_version = 8;
`;

const MIGRATION_9 = `
CREATE TABLE IF NOT EXISTS f11_eligibility_decisions (
  decision_id TEXT PRIMARY KEY,
  managed_pr_id TEXT NOT NULL REFERENCES managed_prs(managed_pr_id),
  event_version_id TEXT NOT NULL REFERENCES remote_event_versions(event_version_id),
  decision TEXT NOT NULL CHECK (decision IN ('ELIGIBLE', 'DEFERRED_BY_HOLD', 'INELIGIBLE')),
  reason_code TEXT NOT NULL,
  reason_json TEXT NOT NULL,
  input_snapshot_json TEXT NOT NULL,
  configuration_snapshot_json TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (managed_pr_id, event_version_id)
);

CREATE TABLE IF NOT EXISTS f11_eligibility_history (
  evaluation_id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL REFERENCES f11_eligibility_decisions(decision_id),
  managed_pr_id TEXT NOT NULL REFERENCES managed_prs(managed_pr_id),
  event_version_id TEXT NOT NULL REFERENCES remote_event_versions(event_version_id),
  decision TEXT NOT NULL CHECK (decision IN ('ELIGIBLE', 'DEFERRED_BY_HOLD', 'INELIGIBLE')),
  reason_code TEXT NOT NULL,
  reason_json TEXT NOT NULL,
  input_snapshot_json TEXT NOT NULL,
  configuration_snapshot_json TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (decision_id, reason_code, input_snapshot_json, configuration_snapshot_json)
);

CREATE TABLE IF NOT EXISTS f11_event_associations (
  event_version_id TEXT PRIMARY KEY REFERENCES remote_event_versions(event_version_id),
  managed_pr_id TEXT NOT NULL REFERENCES managed_prs(managed_pr_id),
  state TEXT NOT NULL CHECK (state IN ('UNASSIGNED', 'ASSIGNED_TO_ACTIVE_BUNDLE', 'RETAINED_DURING_HOLD', 'HANDLED_BY_BUNDLE')),
  bundle_id TEXT,
  operation_id TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (managed_pr_id, event_version_id)
);

CREATE TABLE IF NOT EXISTS f11_event_association_history (
  history_id TEXT PRIMARY KEY,
  event_version_id TEXT NOT NULL REFERENCES remote_event_versions(event_version_id),
  managed_pr_id TEXT NOT NULL REFERENCES managed_prs(managed_pr_id),
  prior_state TEXT,
  next_state TEXT NOT NULL,
  bundle_id TEXT,
  operation_id TEXT,
  reason_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS f11_automatic_claims (
  claim_id TEXT PRIMARY KEY,
  managed_pr_id TEXT NOT NULL REFERENCES managed_prs(managed_pr_id),
  operation_id TEXT NOT NULL,
  bundle_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('ACTIVE', 'RELEASED', 'HANDLED')),
  event_version_ids_json TEXT NOT NULL,
  configuration_snapshot_json TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  outcome TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  released_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (managed_pr_id, operation_id),
  UNIQUE (managed_pr_id, bundle_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS f11_one_active_claim
  ON f11_automatic_claims(managed_pr_id) WHERE state = 'ACTIVE';

CREATE TABLE IF NOT EXISTS f11_holds (
  hold_id TEXT PRIMARY KEY,
  managed_pr_id TEXT NOT NULL REFERENCES managed_prs(managed_pr_id),
  claim_id TEXT NOT NULL REFERENCES f11_automatic_claims(claim_id),
  operation_id TEXT NOT NULL,
  bundle_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('ACTIVE', 'RELEASED')),
  reason_json TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  released_at TEXT,
  outcome TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS f11_one_active_hold
  ON f11_holds(managed_pr_id) WHERE state = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_f11_decisions_pr
  ON f11_eligibility_decisions(managed_pr_id, updated_at, event_version_id);
CREATE INDEX IF NOT EXISTS idx_f11_associations_pr_state
  ON f11_event_associations(managed_pr_id, state, updated_at, event_version_id);
CREATE INDEX IF NOT EXISTS idx_f11_claims_recovery
  ON f11_automatic_claims(state, updated_at, managed_pr_id);
CREATE INDEX IF NOT EXISTS idx_f11_history_event
  ON f11_event_association_history(managed_pr_id, event_version_id, created_at);

PRAGMA user_version = 9;
`;

const MIGRATION_10 = `
CREATE TABLE IF NOT EXISTS f12_scheduler_state (
  state_id INTEGER PRIMARY KEY CHECK (state_id = 1),
  poll_interval_ms INTEGER NOT NULL,
  quiet_period_ms INTEGER NOT NULL,
  max_concurrent_prs INTEGER NOT NULL,
  read_only_poll_while_paused INTEGER NOT NULL CHECK (read_only_poll_while_paused IN (0, 1)),
  paused INTEGER NOT NULL CHECK (paused IN (0, 1)),
  revision INTEGER NOT NULL,
  changed_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  request_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS f12_schedule_slots (
  managed_pr_id TEXT PRIMARY KEY REFERENCES managed_prs(managed_pr_id),
  state TEXT NOT NULL CHECK (state IN ('IDLE', 'RUNNING')),
  next_due_at TEXT NOT NULL,
  retry_at TEXT,
  retry_attempt INTEGER NOT NULL DEFAULT 0,
  last_request_id TEXT,
  last_outcome TEXT,
  reason_json TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_f12_schedule_due
  ON f12_schedule_slots(state, next_due_at, retry_at, managed_pr_id);

CREATE TABLE IF NOT EXISTS f12_poll_requests (
  request_id TEXT PRIMARY KEY,
  scope_key TEXT NOT NULL,
  managed_pr_ids_json TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('SCHEDULED', 'CHECK_NOW', 'RECOVERY')),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'UNCERTAIN')),
  scheduler_revision INTEGER NOT NULL,
  reason_json TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (request_id)
);

CREATE INDEX IF NOT EXISTS idx_f12_poll_requests_active
  ON f12_poll_requests(status, scope_key, updated_at);

CREATE TABLE IF NOT EXISTS f12_review_batches (
  batch_id TEXT PRIMARY KEY REFERENCES review_batches(batch_id),
  managed_pr_id TEXT NOT NULL REFERENCES managed_prs(managed_pr_id),
  state TEXT NOT NULL CHECK (state IN ('PENDING', 'READY', 'DISPATCHING', 'DISPATCHED', 'DEFERRED', 'FAILED', 'CANCELLED')),
  quiet_period_ms INTEGER NOT NULL,
  first_eligible_at TEXT NOT NULL,
  last_eligible_at TEXT NOT NULL,
  deadline_at TEXT NOT NULL,
  scheduler_revision INTEGER NOT NULL,
  dispatch_intent_id TEXT,
  claim_id TEXT,
  operation_id TEXT,
  bundle_id TEXT,
  reason_json TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS f12_one_open_batch_per_pr
  ON f12_review_batches(managed_pr_id)
  WHERE state IN ('PENDING', 'READY', 'DISPATCHING', 'DEFERRED');
CREATE INDEX IF NOT EXISTS idx_f12_batches_deadline
  ON f12_review_batches(state, deadline_at, managed_pr_id);

CREATE TABLE IF NOT EXISTS f12_review_batch_members (
  batch_id TEXT NOT NULL REFERENCES f12_review_batches(batch_id),
  managed_pr_id TEXT NOT NULL REFERENCES managed_prs(managed_pr_id),
  event_version_id TEXT NOT NULL REFERENCES remote_event_versions(event_version_id),
  first_eligible_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (batch_id, event_version_id),
  UNIQUE (managed_pr_id, event_version_id)
);

CREATE INDEX IF NOT EXISTS idx_f12_batch_members_pr
  ON f12_review_batch_members(managed_pr_id, created_at, event_version_id);

CREATE TABLE IF NOT EXISTS f12_dispatch_intents (
  intent_id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL UNIQUE REFERENCES f12_review_batches(batch_id),
  managed_pr_id TEXT NOT NULL REFERENCES managed_prs(managed_pr_id),
  event_version_ids_json TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  bundle_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'CLAIMED', 'HANDED_OFF', 'DEFERRED', 'FAILED', 'UNCERTAIN')),
  scheduler_revision INTEGER NOT NULL,
  claim_id TEXT,
  hold_id TEXT,
  reason_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_f12_dispatch_recovery
  ON f12_dispatch_intents(status, updated_at, managed_pr_id);

PRAGMA user_version = 10;
`;

const MIGRATION_11 = `
CREATE TABLE IF NOT EXISTS f13_operation_intents (
  operation_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  correlation_id TEXT NOT NULL,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  managed_pr_id TEXT,
  developer_clone_path TEXT NOT NULL,
  operation_kind TEXT NOT NULL CHECK (operation_kind IN ('REVIEW', 'CONVERSATION', 'SYNCHRONIZATION')),
  worktree_id TEXT NOT NULL UNIQUE REFERENCES worktrees(worktree_id),
  configured_root TEXT NOT NULL,
  root_revision INTEGER NOT NULL,
  canonical_path TEXT NOT NULL UNIQUE,
  source_repository_json TEXT NOT NULL,
  source_repository_hash TEXT NOT NULL,
  destination_repository_json TEXT,
  destination_repository_hash TEXT,
  refs_json TEXT NOT NULL,
  refs_hash TEXT NOT NULL,
  sha_snapshot_json TEXT NOT NULL,
  sha_snapshot_hash TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  reason_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_f13_intents_owner
  ON f13_operation_intents(owner_type, owner_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_f13_intents_recovery
  ON f13_operation_intents(lifecycle, updated_at);

CREATE TABLE IF NOT EXISTS f13_worktree_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES f13_operation_intents(operation_id),
  worktree_id TEXT NOT NULL REFERENCES worktrees(worktree_id),
  phase TEXT NOT NULL,
  turn_id TEXT,
  state_fingerprint TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  change_summary_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_f13_snapshots_operation
  ON f13_worktree_snapshots(operation_id, created_at, snapshot_id);
CREATE INDEX IF NOT EXISTS idx_f13_snapshots_turn
  ON f13_worktree_snapshots(operation_id, turn_id, phase, created_at);

CREATE TABLE IF NOT EXISTS f13_diff_evidence (
  diff_id TEXT PRIMARY KEY REFERENCES diffs(diff_id),
  operation_id TEXT NOT NULL REFERENCES f13_operation_intents(operation_id),
  worktree_id TEXT NOT NULL REFERENCES worktrees(worktree_id),
  diff_kind TEXT NOT NULL CHECK (diff_kind IN ('PROPOSED', 'CONTEXT')),
  patch_hash TEXT NOT NULL,
  patch_text TEXT,
  files_json TEXT NOT NULL,
  files_hash TEXT NOT NULL,
  untracked_files_json TEXT NOT NULL,
  untracked_files_hash TEXT NOT NULL,
  untracked_evidence_json TEXT NOT NULL,
  untracked_evidence_hash TEXT NOT NULL,
  complete INTEGER NOT NULL CHECK (complete IN (0, 1)),
  regeneration_contract TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_f13_diff_operation
  ON f13_diff_evidence(operation_id, diff_kind, created_at, diff_id);

CREATE TABLE IF NOT EXISTS f13_clear_actions (
  action_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES f13_operation_intents(operation_id),
  worktree_id TEXT NOT NULL REFERENCES worktrees(worktree_id),
  choice TEXT NOT NULL CHECK (choice IN ('CLEAR_ALL', 'CLEAR_AI_ONLY', 'KEEP_AND_CANCEL')),
  confirmation INTEGER NOT NULL CHECK (confirmation IN (0, 1)),
  before_snapshot_id TEXT,
  after_snapshot_id TEXT,
  current_snapshot_id TEXT,
  status TEXT NOT NULL,
  outcome_json TEXT NOT NULL DEFAULT '{}',
  reason_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_f13_clear_actions_operation
  ON f13_clear_actions(operation_id, created_at, action_id);

CREATE TABLE IF NOT EXISTS f13_path_actions (
  action_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES f13_operation_intents(operation_id),
  worktree_id TEXT NOT NULL REFERENCES worktrees(worktree_id),
  action TEXT NOT NULL CHECK (action IN ('OPEN_WORKTREE', 'OPEN_FILE', 'REVEAL_FILE')),
  requested_relative_path TEXT,
  resolved_path TEXT,
  outcome TEXT NOT NULL,
  reason_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_f13_path_actions_operation
  ON f13_path_actions(operation_id, created_at, action_id);

PRAGMA user_version = 11;
`;

const MIGRATION_12 = `
CREATE TABLE IF NOT EXISTS f14_validation_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  snapshot_projection_json TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (operation_id, snapshot_hash)
);

CREATE TABLE IF NOT EXISTS f14_validation_run_metadata (
  run_id TEXT PRIMARY KEY REFERENCES validation_runs(run_id),
  operation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  correlation_id TEXT NOT NULL,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  consumer TEXT NOT NULL CHECK (consumer IN ('review', 'synchronization')),
  requested_phase TEXT NOT NULL CHECK (requested_phase IN ('baseline', 'post_change', 'both')),
  snapshot_id TEXT,
  snapshot_hash TEXT,
  resolution_status TEXT NOT NULL CHECK (resolution_status IN ('ready', 'unavailable', 'confirmation_required', 'invalid')),
  status TEXT NOT NULL CHECK (status IN ('running', 'passed', 'failed', 'interrupted', 'not_run')),
  reason_code TEXT,
  warning_json TEXT NOT NULL DEFAULT '{}',
  warning_hash TEXT NOT NULL DEFAULT '',
  next_action TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_f14_validation_runs_operation
  ON f14_validation_run_metadata(operation_id, created_at, run_id);
CREATE INDEX IF NOT EXISTS idx_f14_validation_runs_recovery
  ON f14_validation_run_metadata(status, updated_at, run_id);

CREATE TABLE IF NOT EXISTS f14_validation_steps (
  run_id TEXT NOT NULL REFERENCES validation_runs(run_id),
  ordinal INTEGER NOT NULL,
  step_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('command', 'manual')),
  configured_phase TEXT NOT NULL CHECK (configured_phase IN ('baseline', 'post_change', 'both')),
  executed_phase TEXT CHECK (executed_phase IN ('baseline', 'post_change')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'passed', 'failed', 'interrupted', 'not_run')),
  evidence_json TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (run_id, ordinal),
  UNIQUE (run_id, step_id)
);

CREATE INDEX IF NOT EXISTS idx_f14_validation_steps_run
  ON f14_validation_steps(run_id, ordinal);

CREATE TABLE IF NOT EXISTS f14_validation_manual_attestations (
  run_id TEXT NOT NULL REFERENCES validation_runs(run_id),
  check_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('verified', 'failed', 'not_run')),
  evidence_json TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (run_id, check_id)
);

CREATE TABLE IF NOT EXISTS f14_validation_warnings (
  warning_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES validation_runs(run_id),
  code TEXT NOT NULL,
  warning_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (run_id, code)
);

PRAGMA user_version = 12;
`;

const MIGRATION_13 = `
/* F17 keeps its controller-owned lifecycle records separate from the legacy
   F15-compatible AI tables.  This lets the bounded controller add durable
   reservations and reconciliation without changing the earlier provider
   handoff semantics. */
CREATE TABLE IF NOT EXISTS f17_ai_work_operations (
  operation_id TEXT PRIMARY KEY,
  parent_operation_id TEXT REFERENCES f17_ai_work_operations(operation_id),
  operation_kind TEXT NOT NULL,
  task_type TEXT NOT NULL,
  status TEXT NOT NULL,
  configured_turn_budget INTEGER NOT NULL CHECK (configured_turn_budget BETWEEN 1 AND 10),
  consumed_turn_count INTEGER NOT NULL DEFAULT 0 CHECK (consumed_turn_count >= 0),
  reserved_turn_count INTEGER NOT NULL DEFAULT 0 CHECK (reserved_turn_count >= 0),
  history_revision INTEGER NOT NULL DEFAULT 0 CHECK (history_revision >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 0),
  idempotency_key TEXT UNIQUE,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS f17_ai_work_segments (
  segment_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES f17_ai_work_operations(operation_id),
  segment_index INTEGER NOT NULL CHECK (segment_index >= 0),
  status TEXT NOT NULL,
  interaction_mode TEXT NOT NULL CHECK (interaction_mode IN ('read_only', 'worktree_write')),
  turn_budget INTEGER NOT NULL CHECK (turn_budget BETWEEN 1 AND 10),
  consumed_turn_baseline INTEGER NOT NULL CHECK (consumed_turn_baseline >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 0),
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (operation_id, segment_index)
);

CREATE TABLE IF NOT EXISTS f17_ai_work_turn_intents (
  turn_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES f17_ai_work_operations(operation_id),
  segment_id TEXT NOT NULL REFERENCES f17_ai_work_segments(segment_id),
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  interaction_mode TEXT NOT NULL CHECK (interaction_mode IN ('read_only', 'worktree_write')),
  status TEXT NOT NULL,
  reservation TEXT NOT NULL CHECK (reservation IN ('NONE', 'RESERVED', 'CONSUMED', 'RELEASED', 'UNCERTAIN')),
  timeout_ms INTEGER NOT NULL CHECK (timeout_ms BETWEEN 1000 AND 3600000),
  deadline_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 0),
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  UNIQUE (segment_id, sequence)
);

CREATE TABLE IF NOT EXISTS f17_ai_work_turn_reports (
  turn_id TEXT PRIMARY KEY REFERENCES f17_ai_work_turn_intents(turn_id),
  report_json TEXT NOT NULL,
  report_hash TEXT NOT NULL,
  progress_json TEXT,
  usage_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS f17_ai_work_fingerprints (
  fingerprint_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES f17_ai_work_operations(operation_id),
  turn_id TEXT NOT NULL REFERENCES f17_ai_work_turn_intents(turn_id),
  fingerprint TEXT NOT NULL,
  classification TEXT NOT NULL,
  complete INTEGER NOT NULL CHECK (complete IN (0, 1)),
  material_progress INTEGER NOT NULL CHECK (material_progress IN (0, 1)),
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS f17_ai_work_confirmations (
  confirmation_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES f17_ai_work_operations(operation_id),
  kind TEXT NOT NULL,
  displayed_history_revision INTEGER NOT NULL CHECK (displayed_history_revision >= 0),
  selected_budget INTEGER NOT NULL CHECK (selected_budget BETWEEN 1 AND 10),
  confirmed INTEGER NOT NULL CHECK (confirmed IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'CONSUMED', 'CANCELLED', 'REJECTED')),
  snapshot_id TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 0),
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  consumed_at TEXT
);

CREATE TABLE IF NOT EXISTS f17_ai_work_reconciliations (
  reconciliation_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES f17_ai_work_operations(operation_id),
  turn_id TEXT NOT NULL REFERENCES f17_ai_work_turn_intents(turn_id),
  outcome TEXT NOT NULL CHECK (outcome IN ('INTERRUPTED', 'UNCERTAIN', 'CONFIRMED_TERMINAL')),
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_f17_ai_work_segments_operation
  ON f17_ai_work_segments(operation_id, segment_index);
CREATE INDEX IF NOT EXISTS idx_f17_ai_work_turns_operation
  ON f17_ai_work_turn_intents(operation_id, sequence);
CREATE INDEX IF NOT EXISTS idx_f17_ai_work_fingerprints_operation
  ON f17_ai_work_fingerprints(operation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_f17_ai_work_confirmations_operation
  ON f17_ai_work_confirmations(operation_id, status);

PRAGMA user_version = 13;
`;

const MIGRATION_14 = `
/* F19 stores native-surface intents separately from workflow state.  These
   records contain only bounded provider-neutral snapshots and opaque target
   identities; the OS effect is attempted only after the row is committed. */
CREATE TABLE IF NOT EXISTS f19_notification_deliveries (
  notification_id TEXT PRIMARY KEY,
  outcome_id TEXT NOT NULL,
  outcome_kind TEXT NOT NULL,
  outcome_revision INTEGER NOT NULL CHECK (outcome_revision >= 1),
  managed_pr_id TEXT,
  operation_id TEXT,
  category TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('PENDING', 'DELIVERED', 'DENIED', 'UNAVAILABLE', 'FAILED', 'UNKNOWN')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0 AND attempt_count <= 2),
  reconciliation_count INTEGER NOT NULL DEFAULT 0 CHECK (reconciliation_count >= 0 AND reconciliation_count <= 2),
  canonical_payload_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  last_reason_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (outcome_kind, outcome_id, outcome_revision, category)
);
CREATE INDEX IF NOT EXISTS idx_f19_notification_state
  ON f19_notification_deliveries(state, updated_at);
CREATE INDEX IF NOT EXISTS idx_f19_notification_pr
  ON f19_notification_deliveries(managed_pr_id, updated_at);

CREATE TABLE IF NOT EXISTS f19_shutdown_intents (
  shutdown_id TEXT PRIMARY KEY,
  command TEXT NOT NULL CHECK (command = 'Shutdown PRMonitor'),
  state TEXT NOT NULL CHECK (state IN ('REQUESTED', 'HANDING_OFF', 'COMPLETED', 'RECOVERY_REQUIRED')),
  correlation_id TEXT NOT NULL,
  lifecycle_correlation_id TEXT,
  reason_code TEXT NOT NULL,
  attempt_count INTEGER NOT NULL CHECK (attempt_count >= 1),
  version INTEGER NOT NULL CHECK (version >= 1),
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_f19_shutdown_state
  ON f19_shutdown_intents(state, updated_at);

PRAGMA user_version = 14;
`;

const MIGRATION_15 = `
/* F21 keeps explicit conversation/revision intent and bounded turn snapshots
   separate from F17 lifecycle rows.  The payload is provider-neutral JSON;
   external effects are admitted only after these rows commit. */
CREATE TABLE IF NOT EXISTS f21_conversations (
  bundle_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version >= 0),
  evidence_revision TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS f21_conversation_intents (
  intent_id TEXT PRIMARY KEY,
  bundle_id TEXT NOT NULL REFERENCES f21_conversations(bundle_id),
  idempotency_key TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK (mode IN ('READ_ONLY_CONVERSATION', 'REVIEW_REVISION')),
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS f21_conversation_messages (
  message_id TEXT PRIMARY KEY,
  bundle_id TEXT NOT NULL REFERENCES f21_conversations(bundle_id),
  turn_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (bundle_id, turn_id, sequence)
);

CREATE TABLE IF NOT EXISTS f21_conversation_turns (
  turn_id TEXT PRIMARY KEY,
  bundle_id TEXT NOT NULL REFERENCES f21_conversations(bundle_id),
  operation_id TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('READ_ONLY_CONVERSATION', 'REVIEW_REVISION')),
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS f21_proposal_inputs (
  command_id TEXT PRIMARY KEY,
  bundle_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('APPLY_QUESTION_ANSWER', 'SAVE_ENTRY_INSTRUCTION')),
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (bundle_id, item_id, kind, payload_hash)
);

CREATE INDEX IF NOT EXISTS idx_f21_intents_bundle
  ON f21_conversation_intents(bundle_id, created_at);
CREATE INDEX IF NOT EXISTS idx_f21_messages_bundle
  ON f21_conversation_messages(bundle_id, sequence);
CREATE INDEX IF NOT EXISTS idx_f21_turns_bundle
  ON f21_conversation_turns(bundle_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_f21_inputs_bundle
  ON f21_proposal_inputs(bundle_id, created_at);

PRAGMA user_version = 15;
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
  {
    version: 6,
    id: "F09-001-structured-activity-diagnostics",
    sql: MIGRATION_6,
    checksum: checksum(MIGRATION_6),
  },
  {
    version: 7,
    id: "F10-001-independent-feedback-polling",
    sql: MIGRATION_7,
    checksum: checksum(MIGRATION_7),
  },
  {
    version: 8,
    id: "F10-002-resource-version-references",
    sql: MIGRATION_8,
    checksum: checksum(MIGRATION_8),
  },
  {
    version: 9,
    id: "F11-001-eligibility-claims-and-holds",
    sql: MIGRATION_9,
    checksum: checksum(MIGRATION_9),
  },
  {
    version: 10,
    id: "F12-001-review-scheduler-control-plane",
    sql: MIGRATION_10,
    checksum: checksum(MIGRATION_10),
  },
  {
    version: 11,
    id: "F13-001-operation-owned-worktrees-and-evidence",
    sql: MIGRATION_11,
    checksum: checksum(MIGRATION_11),
  },
  {
    version: 12,
    id: "F14-001-deterministic-validation-evidence",
    sql: MIGRATION_12,
    checksum: checksum(MIGRATION_12),
  },
  {
    version: 13,
    id: "F17-001-bounded-ai-work-controller",
    sql: MIGRATION_13,
    checksum: checksum(MIGRATION_13),
  },
  {
    version: 14,
    id: "F19-001-native-surface-intents",
    sql: MIGRATION_14,
    checksum: checksum(MIGRATION_14),
  },
  {
    version: 15,
    id: "F21-001-explicit-review-conversations-and-revisions",
    sql: MIGRATION_15,
    checksum: checksum(MIGRATION_15),
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
