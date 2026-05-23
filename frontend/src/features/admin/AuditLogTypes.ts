/**
 * Shared types for the audit-log admin pages. Matches the response
 * shape of `GET /api/v1/mutation-batches`.
 */

export interface AuditBatch {
  id: string;
  tool_name: string;
  actor_user_id: string | null;
  actor_display_name: string | null;
  origin: string;
  dry_run: boolean;
  confirm_token: string | null;
  summary: Record<string, unknown> | null;
  created_at: string;
  committed_at: string | null;
}
