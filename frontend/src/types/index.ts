export interface User {
  id: string;
  email: string;
  display_name: string;
  role: string;
  role_label?: string;
  role_color?: string;
  is_active: boolean;
  auth_provider?: string;
  has_password?: boolean;
  pending_setup?: boolean;
  created_at?: string;
  permissions?: Record<string, boolean>;
}

export interface AppRole {
  id: string;
  key: string;
  label: string;
  description?: string;
  is_system: boolean;
  is_default: boolean;
  is_archived: boolean;
  color: string;
  permissions: Record<string, boolean>;
  sort_order: number;
  user_count?: number;
  created_at?: string;
  updated_at?: string;
  archived_at?: string;
  archived_by?: string;
}

export interface StakeholderRoleDefinitionFull {
  id: string;
  card_type_key: string;
  key: string;
  label: string;
  description?: string;
  color: string;
  permissions: Record<string, boolean>;
  is_archived: boolean;
  sort_order: number;
  stakeholder_count?: number;
  created_at?: string;
  updated_at?: string;
  archived_at?: string;
  archived_by?: string;
}

export interface CardEffectivePermissions {
  app_level: Record<string, boolean>;
  stakeholder_roles: string[];
  card_level: Record<string, boolean>;
  effective: {
    can_view: boolean;
    can_edit: boolean;
    can_archive: boolean;
    can_delete: boolean;
    can_approval_status: boolean;
    can_manage_stakeholders: boolean;
    can_manage_relations: boolean;
    can_manage_documents: boolean;
    can_manage_comments: boolean;
    can_create_comments: boolean;
    can_bpm_edit: boolean;
    can_bpm_manage_drafts: boolean;
    can_bpm_approve: boolean;
  };
}

export interface SsoConfig {
  enabled: boolean;
  client_id?: string;
  tenant_id?: string;
  authorization_endpoint?: string;
  registration_enabled?: boolean;
}

export interface SsoInvitation {
  id: string;
  email: string;
  role: string;
  invited_by?: string;
  created_at?: string;
}

export interface StakeholderRoleDef {
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
  type: "text" | "number" | "cost" | "boolean" | "date" | "single_select" | "multiple_select";
  options?: FieldOption[];
  required?: boolean;
  weight?: number;
  readonly?: boolean;
  group?: string;
  column?: 0 | 1;
}

export interface SubtypeDef {
  key: string;
  label: string;
}

export interface SectionDef {
  section: string;
  fields: FieldDef[];
  defaultExpanded?: boolean;
  columns?: 1 | 2;
  groups?: string[];
}

export interface StakeholderRoleDefinition {
  key: string;
  label: string;
}

export interface SectionConfig {
  defaultExpanded?: boolean;
  hidden?: boolean;
  __order?: string[];
}

export interface CardType {
  key: string;
  label: string;
  description?: string;
  icon: string;
  color: string;
  category?: string;
  has_hierarchy: boolean;
  subtypes?: SubtypeDef[];
  fields_schema: SectionDef[];
  stakeholder_roles?: StakeholderRoleDefinition[];
  section_config?: Record<string, SectionConfig>;
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

export interface StakeholderRef {
  id: string;
  user_id: string;
  user_display_name?: string;
  user_email?: string;
  role: string;
  role_label?: string;
}

export interface Card {
  id: string;
  type: string;
  subtype?: string;
  name: string;
  description?: string;
  parent_id?: string;
  lifecycle?: Record<string, string>;
  attributes?: Record<string, unknown>;
  status: string;
  approval_status: string;
  data_quality: number;
  external_id?: string;
  alias?: string;
  archived_at?: string;
  created_by?: string;
  updated_by?: string;
  created_at?: string;
  updated_at?: string;
  tags: TagRef[];
  stakeholders: StakeholderRef[];
}

export interface Calculation {
  id: string;
  name: string;
  description?: string;
  target_type_key: string;
  target_field_key: string;
  formula: string;
  is_active: boolean;
  execution_order: number;
  last_error?: string;
  last_run_at?: string;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CalculatedFieldsMap {
  [typeKey: string]: string[];
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

export interface CardListResponse {
  items: Card[];
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
  card_id: string;
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
  card_id?: string;
  card_name?: string;
  card_type?: string;
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

export interface BookmarkShareEntry {
  user_id: string;
  display_name?: string;
  email?: string;
  can_edit: boolean;
}

export interface Bookmark {
  id: string;
  name: string;
  card_type?: string;
  filters?: Record<string, unknown>;
  columns?: string[];
  sort?: Record<string, unknown>;
  is_default: boolean;
  visibility: "private" | "public" | "shared";
  odata_enabled: boolean;
  owner_id: string;
  owner_name?: string;
  is_owner: boolean;
  can_edit: boolean;
  shared_with?: BookmarkShareEntry[];
  odata_url?: string | null;
  created_at?: string;
}

export interface SavedReport {
  id: string;
  owner_id: string;
  owner_name?: string;
  name: string;
  description?: string;
  report_type: string;
  config: Record<string, unknown>;
  thumbnail?: string;
  visibility: "private" | "public" | "shared";
  shared_with: string[];
  shared_with_users?: { id: string; display_name: string; email: string }[];
  is_owner: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface EventEntry {
  id: string;
  card_id?: string;
  user_id?: string;
  user_display_name?: string;
  event_type: string;
  data?: Record<string, unknown>;
  created_at?: string;
}

export interface DashboardData {
  total_cards: number;
  by_type: Record<string, number>;
  avg_data_quality: number;
  approval_statuses: Record<string, number>;
  data_quality_distribution: Record<string, number>;
  lifecycle_distribution: Record<string, number>;
  recent_events: EventEntry[];
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export type NotificationType =
  | "todo_assigned"
  | "card_updated"
  | "comment_added"
  | "approval_status_changed"
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
  card_id?: string;
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
  card_id: string;
  card_name?: string;
  card_type?: string;
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
  card_id: string;
  card_name: string;
  card_type: string;
  users: { user_id: string; display_name: string; email: string; role: string }[];
}

export interface SurveyPreviewResult {
  total_cards: number;
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
  items: { response_id: string; card_id: string; card_name: string }[];
}

export interface SurveyRespondForm {
  response_id: string;
  response_status: string;
  survey: { id: string; name: string; message: string };
  card: { id: string; name: string; type: string; subtype?: string };
  fields: (SurveyField & { current_value: unknown })[];
  existing_responses: Record<string, { current_value: unknown; new_value: unknown; confirmed: boolean }>;
}

export interface BadgeCounts {
  open_todos: number;
  pending_surveys: number;
}

// ---------------------------------------------------------------------------
// End of Life (endoflife.date)
// ---------------------------------------------------------------------------

export interface EolProduct {
  name: string;
}

export interface EolCycle {
  cycle: string;
  releaseDate?: string | null;
  eol?: string | boolean | null;
  latest?: string | null;
  latestReleaseDate?: string | null;
  lts?: string | boolean | null;
  support?: string | boolean | null;
  discontinued?: string | boolean | null;
  codename?: string | null;
  link?: string | null;
}

export interface EolProductMatch {
  name: string;
  score: number;
}

export interface MassEolCandidate {
  card_id: string;
  card_name: string;
  card_type: string;
  eol_product: string;
  score: number;
}

export interface MassEolResult {
  card_id: string;
  card_name: string;
  card_type: string;
  current_eol_product?: string | null;
  current_eol_cycle?: string | null;
  candidates: MassEolCandidate[];
}

export interface DiagramSummary {
  id: string;
  name: string;
  description?: string;
  type: string;
  initiative_ids: string[];
  thumbnail?: string;
  card_count: number;
  created_at?: string;
  updated_at?: string;
}

// ---------------------------------------------------------------------------
// Web Portals
// ---------------------------------------------------------------------------

export interface WebPortal {
  id: string;
  name: string;
  slug: string;
  description?: string;
  card_type: string;
  filters?: Record<string, unknown>;
  display_fields?: string[];
  card_config?: Record<string, unknown>;
  is_published: boolean;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
}

export interface PortalTypeInfo {
  key: string;
  label: string;
  icon: string;
  color: string;
  fields_schema: SectionDef[];
  subtypes?: SubtypeDef[];
}

export interface PortalRelationType {
  key: string;
  label: string;
  reverse_label?: string;
  source_type_key: string;
  target_type_key: string;
  other_type_key: string;
  other_type_label: string;
}

export interface PortalTagGroup {
  id: string;
  name: string;
  tags: { id: string; name: string; color?: string }[];
}

export interface PublicPortal {
  id: string;
  name: string;
  slug: string;
  description?: string;
  card_type: string;
  filters?: Record<string, unknown>;
  display_fields?: string[];
  card_config?: Record<string, unknown>;
  type_info: PortalTypeInfo | null;
  relation_types: PortalRelationType[];
  tag_groups: PortalTagGroup[];
}

export interface PortalCard {
  id: string;
  name: string;
  type: string;
  subtype?: string;
  description?: string;
  lifecycle?: Record<string, string>;
  attributes?: Record<string, unknown>;
  approval_status: string;
  data_quality: number;
  tags: { id: string; name: string; color?: string; group_name?: string }[];
  relations: {
    type: string;
    related_id: string;
    related_name: string;
    related_type: string;
    direction: string;
  }[];
  stakeholders: {
    role: string;
    display_name: string;
  }[];
  updated_at?: string;
}

export interface PortalCardListResponse {
  items: PortalCard[];
  total: number;
  page: number;
  page_size: number;
}

// ---------------------------------------------------------------------------
// BPM — BPMN 2.0 Diagrams, Process Elements, Assessments
// ---------------------------------------------------------------------------

export interface ProcessDiagramData {
  id: string;
  process_id: string;
  bpmn_xml: string;
  svg_thumbnail?: string;
  version: number;
  created_by?: string;
  created_at?: string;
}

export interface ProcessElement {
  id: string;
  process_id: string;
  bpmn_element_id: string;
  element_type: string;
  name?: string;
  documentation?: string;
  lane_name?: string;
  is_automated: boolean;
  sequence_order: number;
  application_id?: string;
  application_name?: string;
  data_object_id?: string;
  data_object_name?: string;
  it_component_id?: string;
  it_component_name?: string;
  custom_fields?: Record<string, unknown>;
}

export interface ProcessAssessment {
  id: string;
  process_id: string;
  assessor_id: string;
  assessor_name?: string;
  assessment_date: string;
  overall_score: number;
  efficiency: number;
  effectiveness: number;
  compliance: number;
  automation: number;
  notes?: string;
  action_items?: { title: string; description: string; due_date: string; status: string }[];
  created_at?: string;
}

export interface BpmDashboardData {
  total_processes: number;
  by_process_type: Record<string, number>;
  by_maturity: Record<string, number>;
  by_automation: Record<string, number>;
  by_risk: Record<string, number>;
  top_risk_processes: { id: string; name: string; risk: string; maturity: string }[];
  diagram_coverage: { with_diagram: number; total: number; percentage: number };
}

export interface BpmnTemplate {
  key: string;
  name: string;
  description: string;
  category: string;
  bpmn_xml?: string;
}

// ---------------------------------------------------------------------------
// Process Flow Versions (draft / published / archived workflow)
// ---------------------------------------------------------------------------

export interface ProcessFlowVersion {
  id: string;
  process_id: string;
  status: "draft" | "pending" | "published" | "archived";
  revision: number;
  bpmn_xml?: string;
  svg_thumbnail?: string;
  created_by?: string;
  created_by_name?: string;
  created_at?: string;
  submitted_by?: string;
  submitted_by_name?: string;
  submitted_at?: string;
  approved_by?: string;
  approved_by_name?: string;
  approved_at?: string;
  archived_at?: string;
  based_on_id?: string;
  draft_element_links?: Record<string, {
    application_id?: string;
    data_object_id?: string;
    it_component_id?: string;
    custom_fields?: Record<string, unknown>;
  }>;
}

export interface ProcessFlowPermissions {
  can_view_drafts: boolean;
  can_edit_draft: boolean;
  can_approve: boolean;
}
