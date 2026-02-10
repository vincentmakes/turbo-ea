export type RelationType =
  | "application_to_business_capability"
  | "application_to_it_component"
  | "application_to_organization"
  | "application_to_data_object"
  | "application_provides_interface"
  | "application_consumes_interface"
  | "it_component_to_provider"
  | "it_component_to_tech_category"
  | "interface_to_data_object"
  | "initiative_to_application"
  | "objective_to_initiative"
  | "objective_to_business_capability"
  | "requires";

export interface FactSheetSummary {
  id: string;
  name: string;
  type: string;
}

export interface Relation {
  id: string;
  type: RelationType;
  from_fact_sheet_id: string;
  to_fact_sheet_id: string;
  description: string | null;
  active_from: string | null;
  active_until: string | null;
  attributes: Record<string, unknown> | null;
  from_fact_sheet: FactSheetSummary | null;
  to_fact_sheet: FactSheetSummary | null;
  created_at: string;
  updated_at: string;
}

export interface RelationListResponse {
  items: Relation[];
  total: number;
}

export const RELATION_TYPE_LABELS: Record<RelationType, string> = {
  application_to_business_capability: "Application \u2192 Business Capability",
  application_to_it_component: "Application \u2192 IT Component",
  application_to_organization: "Application \u2192 Organization",
  application_to_data_object: "Application \u2192 Data Object",
  application_provides_interface: "Application provides Interface",
  application_consumes_interface: "Application consumes Interface",
  it_component_to_provider: "IT Component \u2192 Provider",
  it_component_to_tech_category: "IT Component \u2192 Tech Category",
  interface_to_data_object: "Interface \u2192 Data Object",
  initiative_to_application: "Initiative \u2192 Application",
  objective_to_initiative: "Objective \u2192 Initiative",
  objective_to_business_capability: "Objective \u2192 Business Capability",
  requires: "Requires",
};
