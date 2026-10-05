import {
  APPLICATION_ACTIVITY_STAGES,
  APPLICATION_ACTIVITY_TYPES,
  PR_ACTIVITY_OWNERS,
  PR_ACTIVITY_STAGES,
  PR_ACTIVITY_TYPES,
} from "../../shared/activity-presentation";
import { MANAGED_PR_RECOVERY_ADAPTERS } from "../../shared/recovery-attribution";

// Only closed catalog constants enter SQL. User filters remain parameters.
const values = (catalog: readonly string[]) =>
  catalog.map((value) => `'${value}'`).join(", ");
const emptyScope = MANAGED_PR_RECOVERY_ADAPTERS.map(
  (adapter) =>
    `(s.owner = '${adapter.owner}' AND s.scope_kind = '${adapter.kind}' AND s.scope_id = '${adapter.emptyId}')`,
).join(" OR ");
const prAdapter = MANAGED_PR_RECOVERY_ADAPTERS.map(
  (adapter) =>
    `(s.owner = '${adapter.owner}' AND s.scope_kind = '${adapter.kind}')`,
).join(" OR ");
const matchingScope =
  "s.scope_key = activity_events.operation_id AND json_valid(activity_events.details_json) AND json_type(activity_events.details_json, '$.f28Event') = 'text'";
export const ACTIVITY_MANAGED_PR_SQL = `CASE WHEN EXISTS (SELECT 1 FROM f28_recovery_scopes s WHERE ${matchingScope}) THEN (SELECT s.scope_id FROM f28_recovery_scopes s WHERE ${matchingScope} AND (s.scope_kind = 'managed_pr' OR (${prAdapter})) AND NOT (${emptyScope}) LIMIT 1) ELSE managed_pr_id END`;
export const ACTIVITY_SCOPE_SQL = `CASE
  WHEN EXISTS (SELECT 1 FROM f28_recovery_scopes s WHERE ${matchingScope} AND (s.scope_kind = 'application' OR (${emptyScope}))) THEN 'APPLICATION'
  WHEN EXISTS (SELECT 1 FROM f28_recovery_scopes s WHERE ${matchingScope} AND s.scope_kind <> 'application' AND NOT (${emptyScope})) THEN 'PR_WORK'
  WHEN managed_pr_id IS NOT NULL OR work_item_json IS NOT NULL
    OR (json_valid(related_target_json) AND json_extract(related_target_json, '$.kind') IN ('MANAGED_PR','MANAGED_PR_SETTINGS','REVIEW_BUNDLE','SYNCHRONIZATION_BATCH','SYNCHRONIZATION_RESULT'))
    OR owner_type IN (${values(PR_ACTIVITY_OWNERS)})
    OR stage IN (${values(PR_ACTIVITY_STAGES)})
    OR event_type IN (${values(PR_ACTIVITY_TYPES)})
    OR reason_code IN (${values(PR_ACTIVITY_TYPES)})
  THEN 'PR_WORK'
  WHEN owner_type IN ('APPLICATION_LIFECYCLE', 'APPLICATION')
    OR stage IN (${values(APPLICATION_ACTIVITY_STAGES)})
    OR event_type IN (${values(APPLICATION_ACTIVITY_TYPES)})
    OR reason_code IN (${values(APPLICATION_ACTIVITY_TYPES)})
    OR reason_code IN ('LIFECYCLE_RUNNING','LIFECYCLE_STARTING')
  THEN 'APPLICATION'
  ELSE 'UNKNOWN' END`;
