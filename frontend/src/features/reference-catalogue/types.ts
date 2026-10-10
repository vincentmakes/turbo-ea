/** Generic catalogue node — shared across the three reference catalogues
 * (capability / business process / value stream).
 *
 * The browser only needs the fields it renders; per-catalogue services may
 * stick additional fields on the wire (e.g. `framework_refs` for processes,
 * `stage_order` / `capability_ids` / `process_ids` for value-stream stages).
 * Those extras are typed as optional here so the same `CatalogueNode[]`
 * works for every catalogue.
 */
export interface CatalogueNode {
  id: string;
  name: string;
  level: number;
  parent_id: string | null;
  description: string | null;
  aliases?: string[];
  industry?: string | null;
  /** Set on value-stream nodes which carry a list rather than a single string. */
  industries?: string[];
  references?: string[];
  in_scope?: string[];
  out_of_scope?: string[];
  deprecated?: boolean;
  deprecation_reason?: string | null;
  successor_id?: string | null;
  /** Card id of an existing matching card in the inventory, or null. */
  existing_card_id: string | null;

  // Process-specific extras
  framework_refs?: { framework: string; external_id: string; version?: string | null; url?: string | null }[];
  realizes_capability_ids?: string[];

  // Value-stream stage extras
  stage_order?: number | null;
  stage_name?: string | null;
  industry_variant?: string | null;
  notes?: string | null;
  capability_ids?: string[];
  process_ids?: string[];
}

export interface CatalogueVersion {
  catalogue_version: string;
  schema_version: string;
  generated_at: string | null;
  /** Total entries — `node_count` on capability + value-stream payloads, or
   *  `process_count` on the process payload. Either is rendered as "N items". */
  node_count?: number;
  process_count?: number;
  value_stream_count?: number;
  source: "bundled" | "remote";
  bundled_version: string;
  fetched_at?: string | null;
  available_locales: string[];
  active_locale: string;
}

export interface CataloguePayload {
  version: CatalogueVersion;
  /** Per-catalogue payloads vary the array key (`capabilities` /
   *  `processes` / `value_streams`), so the loader returns the array
   *  separately and the shared shell normalises it before rendering. */
  capabilities?: CatalogueNode[];
  processes?: CatalogueNode[];
  value_streams?: CatalogueNode[];
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
    node_count?: number;
  } | null;
  update_available: boolean;
  error: string | null;
}

export interface ImportResult {
  created: { catalogue_id: string; card_id: string }[];
  skipped: { catalogue_id: string; card_id: string; reason: string }[];
  relinked: { catalogue_id: string; card_id: string; new_parent_card_id: string }[];
  /** Entries the card write path refused (a name another card already uses at
   *  the same level) and the entries beneath a refused parent, with the reason
   *  the server gave. Absent from a backend older than 2.158.11. */
  failed?: { catalogue_id: string; reason: string }[];
  catalogue_version: string | null;
  /** Optional — only the process and value-stream services emit it. */
  auto_relations_created?: number;
}

/** Per-catalogue configuration consumed by the shared shell + browser. */
export interface CatalogueKindConfig {
  kind: "capability" | "process" | "valueStream";
  /** API path prefix (e.g. "/capability-catalogue"). */
  basePath: string;
  /** Field name on the GET payload that holds the array. */
  payloadKey: "capabilities" | "processes" | "value_streams";
  /** ID prefix used for stable sorting (e.g. "BC-", "BP-", "VS-"). */
  idPrefix: string;
  /** i18n namespace prefix on `cards.json` (e.g. "catalogue", "processCatalogue"). */
  i18nNamespace: string;
  /** Card type the imported cards will land as — used for "Open inventory". */
  inventoryCardType: string;
  /** Hex accent colour applied via CSS variables on the catalogue root. */
  accentColor: string;
  /** Hex selection colour (kept distinct from the navigation accent). */
  selectionColor: string;
  /** Render the level chip label — e.g. `(lvl) => "L" + lvl` for BC/BP, or
   *  `(lvl) => lvl === 1 ? "Stream" : "Stage"` for value streams. */
  levelLabel: (level: number) => string;
  /** Optional renderer for kind-specific extras shown in the detail dialog. */
  renderDetailExtras?: (node: CatalogueNode) => React.ReactNode;
  /** Resolves the user-menu icon for the page hero. */
  heroIcon: string;
}
