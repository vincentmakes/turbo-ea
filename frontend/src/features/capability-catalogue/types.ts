export interface FlatCapability {
  id: string;
  name: string;
  level: number;
  parent_id: string | null;
  description: string | null;
  aliases: string[];
  owner: string | null;
  tags: string[];
  industry: string | null;
  references: string[];
  in_scope: string[];
  out_of_scope: string[];
  deprecated: boolean;
  deprecation_reason: string | null;
  successor_id: string | null;
  metadata: Record<string, unknown>;
  /** Card id of an existing matching BusinessCapability, or null. */
  existing_card_id: string | null;
}

export interface CatalogueVersion {
  catalogue_version: string;
  schema_version: string;
  generated_at: string | null;
  node_count: number;
  source: "bundled" | "remote";
  bundled_version: string;
  fetched_at?: string | null;
}

export interface CataloguePayload {
  version: CatalogueVersion;
  capabilities: FlatCapability[];
}

export interface UpdateStatus {
  active_version: string;
  active_source: "bundled" | "remote";
  bundled_version: string;
  cached_remote_version: string | null;
  remote: {
    catalogue_version: string;
    schema_version: string | number;
    generated_at: string | null;
    node_count: number;
  } | null;
  update_available: boolean;
  error: string | null;
}

export interface ImportResult {
  created: { catalogue_id: string; card_id: string }[];
  skipped: { catalogue_id: string; card_id: string; reason: string }[];
  catalogue_version: string | null;
}
