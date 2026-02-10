export type FactSheetType =
  | "application"
  | "business_capability"
  | "business_context"
  | "organization"
  | "objective"
  | "it_component"
  | "tech_category"
  | "provider"
  | "interface"
  | "data_object"
  | "initiative"
  | "platform";

export type FactSheetStatus = "active" | "archived";

export interface FactSheet {
  id: string;
  name: string;
  display_name: string | null;
  description: string | null;
  type: FactSheetType;
  status: FactSheetStatus;
  alias: string | null;
  external_id: string | null;
  parent_id: string | null;
  quality_seal: string | null;
  completion: number;
  lifecycle: Record<string, string> | null;
  attributes: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface FactSheetListResponse {
  items: FactSheet[];
  total: number;
  page: number;
  page_size: number;
}

export const FACT_SHEET_TYPE_LABELS: Record<FactSheetType, string> = {
  application: "Application",
  business_capability: "Business Capability",
  business_context: "Business Context",
  organization: "Organization",
  objective: "Objective",
  it_component: "IT Component",
  tech_category: "Tech Category",
  provider: "Provider",
  interface: "Interface",
  data_object: "Data Object",
  initiative: "Initiative",
  platform: "Platform",
};

export const FACT_SHEET_TYPE_ICONS: Record<FactSheetType, string> = {
  application: "apps",
  business_capability: "account_tree",
  business_context: "category",
  organization: "corporate_fare",
  objective: "flag",
  it_component: "memory",
  tech_category: "layers",
  provider: "storefront",
  interface: "swap_horiz",
  data_object: "database",
  initiative: "rocket_launch",
  platform: "hub",
};

// --- Enum options used by AG Grid cell editors and bulk edit ---

export const LIFECYCLE_PHASES = [
  "plan",
  "phase_in",
  "active",
  "phase_out",
  "end_of_life",
] as const;

export const BUSINESS_CRITICALITY_OPTIONS = [
  "administrative_service",
  "business_operational",
  "business_critical",
  "mission_critical",
] as const;

export const SUITABILITY_OPTIONS = [
  "unreasonable",
  "insufficient",
  "appropriate",
  "perfect",
] as const;

export const QUALITY_SEAL_OPTIONS = ["approved", "broken", "n_a"] as const;

// IT Component specific
export const IT_COMPONENT_CATEGORY_OPTIONS = [
  "SaaS",
  "IaaS",
  "PaaS",
  "Hardware",
  "Service",
  "DBMS",
  "OS",
] as const;

export const RESOURCE_CLASSIFICATION_OPTIONS = [
  "standard",
  "non_standard",
  "phasing_out",
] as const;
