export interface User {
  id: string;
  email: string;
  display_name: string;
  role: string;
  is_active: boolean;
  created_at?: string;
}

export interface SubscriptionRoleDef {
  key: string;
  label: string;
  allowed_types: string[] | null;
}

export interface FieldOption {
  key: string;
  label: string;
  color?: string;
}

export interface FieldDef {
  key: string;
  label: string;
  type: "text" | "number" | "boolean" | "date" | "single_select" | "multiple_select";
  options?: FieldOption[];
  required?: boolean;
  weight?: number;
  readonly?: boolean;
}

export interface SubtypeDef {
  key: string;
  label: string;
}

export interface SectionDef {
  section: string;
  fields: FieldDef[];
}

export interface FactSheetType {
  key: string;
  label: string;
  description?: string;
  icon: string;
  color: string;
  category?: string;
  has_hierarchy: boolean;
  subtypes?: SubtypeDef[];
  fields_schema: SectionDef[];
  built_in: boolean;
  is_hidden: boolean;
  sort_order: number;
}

export interface RelationType {
  key: string;
  label: string;
  reverse_label?: string;
  description?: string;
  source_type_key: string;
  target_type_key: string;
  cardinality: "1:1" | "1:n" | "n:m";
  attributes_schema: FieldDef[];
  built_in: boolean;
  is_hidden: boolean;
  sort_order: number;
}

export interface TagRef {
  id: string;
  name: string;
  color?: string;
  group_name?: string;
}

export interface SubscriptionRef {
  id: string;
  user_id: string;
  user_display_name?: string;
  user_email?: string;
  role: string;
  role_label?: string;
}

export interface FactSheet {
  id: string;
  type: string;
  subtype?: string;
  name: string;
  description?: string;
  parent_id?: string;
  lifecycle?: Record<string, string>;
  attributes?: Record<string, unknown>;
  status: string;
  quality_seal: string;
  completion: number;
  external_id?: string;
  alias?: string;
  created_by?: string;
  updated_by?: string;
  created_at?: string;
  updated_at?: string;
  tags: TagRef[];
  subscriptions: SubscriptionRef[];
}

export interface HierarchyNode {
  id: string;
  name: string;
  type: string;
}

export interface HierarchyData {
  ancestors: HierarchyNode[];
  children: HierarchyNode[];
  level: number;
}

export interface FactSheetListResponse {
  items: FactSheet[];
  total: number;
  page: number;
  page_size: number;
}

export interface RelationRef {
  id: string;
  type: string;
  name: string;
}

export interface Relation {
  id: string;
  type: string;
  source_id: string;
  target_id: string;
  source?: RelationRef;
  target?: RelationRef;
  attributes?: Record<string, unknown>;
  description?: string;
  created_at?: string;
}

export interface Comment {
  id: string;
  fact_sheet_id: string;
  user_id: string;
  user_display_name?: string;
  content: string;
  parent_id?: string;
  created_at?: string;
  updated_at?: string;
  replies: Comment[];
}

export interface Todo {
  id: string;
  fact_sheet_id?: string;
  fact_sheet_name?: string;
  fact_sheet_type?: string;
  description: string;
  status: string;
  link?: string;
  is_system?: boolean;
  assigned_to?: string;
  assignee_name?: string;
  created_by?: string;
  due_date?: string;
  created_at?: string;
}

export interface TagGroup {
  id: string;
  name: string;
  description?: string;
  mode: string;
  mandatory: boolean;
  tags: Tag[];
}

export interface Tag {
  id: string;
  name: string;
  color?: string;
  tag_group_id: string;
}

export interface Bookmark {
  id: string;
  name: string;
  fact_sheet_type?: string;
  filters?: Record<string, unknown>;
  columns?: string[];
  sort?: Record<string, unknown>;
  is_default: boolean;
  created_at?: string;
}

export interface EventEntry {
  id: string;
  fact_sheet_id?: string;
  user_id?: string;
  user_display_name?: string;
  event_type: string;
  data?: Record<string, unknown>;
  created_at?: string;
}

export interface DashboardData {
  total_fact_sheets: number;
  by_type: Record<string, number>;
  avg_completion: number;
  quality_seals: Record<string, number>;
  recent_events: EventEntry[];
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export type NotificationType =
  | "todo_assigned"
  | "fact_sheet_updated"
  | "comment_added"
  | "quality_seal_changed"
  | "soaw_sign_requested"
  | "soaw_signed"
  | "survey_request";

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  is_read: boolean;
  data?: Record<string, unknown>;
  fact_sheet_id?: string;
  actor_id?: string;
  actor_name?: string;
  created_at?: string;
}

export interface NotificationListResponse {
  items: Notification[];
  total: number;
  page: number;
  page_size: number;
}

export interface NotificationPreferences {
  in_app: Record<string, boolean>;
  email: Record<string, boolean>;
}

// ---------------------------------------------------------------------------
// Statement of Architecture Work (SoAW)
// ---------------------------------------------------------------------------

export interface SoAWDocumentInfo {
  prepared_by: string;
  reviewed_by: string;
  review_date: string;
}

export interface SoAWVersionEntry {
  version: string;
  date: string;
  revised_by: string;
  description: string;
}

export interface SoAWSectionData {
  content: string;
  hidden: boolean;
  table_data?: { columns: string[]; rows: string[][] };
  togaf_data?: Record<string, string>;
}

export interface SoAWSignatory {
  user_id: string;
  display_name: string;
  email?: string;
  status: "pending" | "signed" | "rejected";
  signed_at: string | null;
}

export interface SoAW {
  id: string;
  name: string;
  initiative_id: string | null;
  status: "draft" | "in_review" | "approved" | "signed";
  document_info: SoAWDocumentInfo;
  version_history: SoAWVersionEntry[];
  sections: Record<string, SoAWSectionData>;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
  revision_number: number;
  parent_id: string | null;
  signatories: SoAWSignatory[];
  signed_at: string | null;
}

// ---------------------------------------------------------------------------
// Surveys
// ---------------------------------------------------------------------------

export interface SurveyField {
  key: string;
  section: string;
  label: string;
  type: string;
  options?: { key: string; label: string; color?: string }[];
  action: "maintain" | "confirm";
}

export interface SurveyTargetFilters {
  related_type?: string;
  related_ids?: string[];
  tag_ids?: string[];
  attribute_filters?: { key: string; op: string; value: string }[];
}

export interface Survey {
  id: string;
  name: string;
  description: string;
  message: string;
  status: "draft" | "active" | "closed";
  target_type_key: string;
  target_filters: SurveyTargetFilters;
  target_roles: string[];
  fields: SurveyField[];
  created_by?: string;
  creator_name?: string;
  sent_at?: string;
  closed_at?: string;
  created_at?: string;
  updated_at?: string;
  total_responses?: number;
  completed_responses?: number;
  applied_responses?: number;
}

export interface SurveyResponseDetail {
  id: string;
  survey_id: string;
  fact_sheet_id: string;
  fact_sheet_name?: string;
  fact_sheet_type?: string;
  user_id: string;
  user_display_name?: string;
  user_email?: string;
  status: "pending" | "completed";
  responses: Record<string, { current_value: unknown; new_value: unknown; confirmed: boolean }>;
  applied: boolean;
  responded_at?: string;
  applied_at?: string;
  created_at?: string;
}

export interface SurveyPreviewTarget {
  fact_sheet_id: string;
  fact_sheet_name: string;
  fact_sheet_type: string;
  users: { user_id: string; display_name: string; email: string; role: string }[];
}

export interface SurveyPreviewResult {
  total_fact_sheets: number;
  total_users: number;
  targets: SurveyPreviewTarget[];
}

export interface MySurveyItem {
  survey_id: string;
  survey_name: string;
  survey_message: string;
  survey_status: string;
  target_type_key: string;
  pending_count: number;
  items: { response_id: string; fact_sheet_id: string; fact_sheet_name: string }[];
}

export interface SurveyRespondForm {
  response_id: string;
  response_status: string;
  survey: { id: string; name: string; message: string };
  fact_sheet: { id: string; name: string; type: string; subtype?: string };
  fields: (SurveyField & { current_value: unknown })[];
  existing_responses: Record<string, { current_value: unknown; new_value: unknown; confirmed: boolean }>;
}

export interface BadgeCounts {
  open_todos: number;
  pending_surveys: number;
}

export interface DiagramSummary {
  id: string;
  name: string;
  description?: string;
  type: string;
  initiative_ids: string[];
  thumbnail?: string;
  fact_sheet_count: number;
  created_at?: string;
  updated_at?: string;
}
