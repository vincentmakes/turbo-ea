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
