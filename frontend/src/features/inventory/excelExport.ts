import * as XLSX from "xlsx";

import { api } from "@/api/client";
import i18n from "@/i18n";
import { typeLabel } from "@/hooks/useResolveLabel";
import type { Card, CardType, Relation, RelationType } from "@/types";

/**
 * Excel export — LeanIX-style multi-sheet workbook.
 *
 * For a single-type selection, only that type's card sheet is produced
 * (plus an optional `Relations` sheet if any of its relation types carry
 * attributes). For mixed selections, every card type present produces its
 * own sheet, and the workbook can be edited and re-imported in one shot.
 *
 * Card sheets carry:
 *   - core columns (id, type, name, parent_path, …)
 *   - `attr_<key>` columns derived from `fields_schema`
 *   - `rel:<relation_type_key>` columns for relation types whose source is
 *     this card type and whose `attributes_schema` is empty (the simple
 *     case that fits in a comma-separated cell)
 *
 * The `Relations` sheet captures relation rows for relation types that
 * carry attributes (cost, description, etc.) — these need a column per
 * attribute and so can't live inline on the card sheet.
 *
 * Reference encoding for relation cells and the Relations sheet: the
 * target card's `name` when unique within `(target_type, name)` across
 * the live set, otherwise the full `parent_path/name` (with `/` and `\\`
 * escapes mirroring `parent_path`). This matches the backend's
 * `CardResolver.resolve()` matching rules.
 */
const FORMAT_VERSION = "2";
const LIFECYCLE_PHASES = ["plan", "phaseIn", "active", "phaseOut", "endOfLife"] as const;
const MAX_PATH_DEPTH = 8;
const META_SHEET_NAME = "_Meta";
const RELATIONS_SHEET_NAME = "Relations";

export function encodePathSegment(name: string): string {
  return name.replace(/\\/g, "\\\\").replace(/\//g, "\\/");
}

function buildParentPath(card: Card, byId: Map<string, Card>): string {
  const segments: string[] = [];
  const seen = new Set<string>();
  let current = card.parent_id ? byId.get(card.parent_id) : undefined;
  while (current && !seen.has(current.id) && segments.length < MAX_PATH_DEPTH) {
    seen.add(current.id);
    segments.unshift(encodePathSegment(current.name));
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return segments.join(" / ");
}

/** Build the human-readable reference (`name` or `parent_path/name`) for a
 * relation target.
 *
 * Every name written into a ref **must** go through `encodePathSegment()`
 * — the importer reads cells with `decodePath()`, which treats `/` as the
 * segment separator. Card names commonly contain `/` ("SAP S/4HANA",
 * "MATLAB/Simulink", "CI/CD Pipelines"), and writing them raw would
 * cause the importer to read those names as two-segment paths and fail
 * to resolve any of them. Same goes for `\` (escapes its successor).
 *
 * Returns `name` alone when no other card of the same type shares that
 * name, the full path otherwise. The name part is always escaped. */
function buildCardRef(
  card: Card,
  byId: Map<string, Card>,
  nameAmbiguity: Set<string>,
): string {
  const key = `${card.type}|${card.name.trim().toLowerCase()}`;
  const ambiguous = nameAmbiguity.has(key);
  const safeName = encodePathSegment(card.name);
  if (!ambiguous) return safeName;
  const parentPath = buildParentPath(card, byId);
  if (!parentPath) return safeName;
  return `${parentPath} / ${safeName}`;
}

function exportTimestamp(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `_${pad(now.getHours())}${pad(now.getMinutes())}`
  );
}

function autoSizeColumns(rows: Record<string, unknown>[]): XLSX.ColInfo[] | undefined {
  if (rows.length === 0) return undefined;
  const headers = Object.keys(rows[0]);
  return headers.map((h) => {
    let maxLen = h.length;
    for (const r of rows) {
      const v = String(r[h] ?? "");
      if (v.length > maxLen) maxLen = v.length;
    }
    return { wch: Math.min(maxLen + 2, 60) };
  });
}

interface ExportOptions {
  canViewCosts?: boolean;
  /** Public-facing tenant URL written to `_Meta` for debugging cross-tenant imports. */
  tenantUrl?: string;
}

/**
 * Sheet-name → CardType. Spreadsheet sheet names are capped at 31 chars by
 * Excel and can't contain certain symbols; we use the type label, fall
 * back to the key if the label is too long or duplicates an existing name.
 */
function sheetNameForType(type: CardType, taken: Set<string>): string {
  const stripped = typeLabel(type, i18n.language).replace(/[\\/?*[\]:]/g, "_");
  const candidates = [stripped.slice(0, 31), type.key.slice(0, 31)];
  for (const c of candidates) {
    if (c && !taken.has(c)) {
      taken.add(c);
      return c;
    }
  }
  // Last resort: append a numeric suffix.
  let i = 2;
  while (taken.has(`${type.key.slice(0, 28)} ${i}`)) i++;
  const name = `${type.key.slice(0, 28)} ${i}`;
  taken.add(name);
  return name;
}

/**
 * Fetch every active relation in one round-trip and filter client-side to
 * outgoing edges from the export's source set. Replaces an earlier per-card
 * loop that was both O(N) HTTP calls and silently swallowed any single
 * failure into an empty list — making the workbook ship with empty `rel:`
 * columns when the network blipped on any one request.
 */
async function fetchOutgoingRelations(sourceIds: Set<string>): Promise<Relation[]> {
  if (sourceIds.size === 0) return [];
  const rels = await api.get<Relation[]>("/relations");
  return rels.filter((r) => sourceIds.has(r.source_id));
}

/**
 * Top up `byId` with cards we know we'll need to render relation refs but
 * that aren't part of the export's filtered slice. Uses `GET /cards?ids=`
 * (existing endpoint, batched up to ~200 ids per request to keep URLs
 * reasonable) so single-type exports still resolve cross-type targets to
 * proper `parent_path/name` refs.
 *
 * Walks ancestors too: the immediate target's parent chain is needed to
 * reconstruct the path. Bounded by MAX_PATH_DEPTH levels so a corrupt
 * cycle can't spin forever.
 */
async function enrichMissingTargets(
  byId: Map<string, Card>,
  targetIds: Iterable<string>,
): Promise<void> {
  const queue: string[] = [];
  for (const tid of targetIds) {
    if (!byId.has(tid)) queue.push(tid);
  }
  const CHUNK = 200;
  for (let depth = 0; depth < MAX_PATH_DEPTH && queue.length > 0; depth++) {
    const nextLevel: string[] = [];
    for (let i = 0; i < queue.length; i += CHUNK) {
      const chunk = queue.slice(i, i + CHUNK);
      let resp: { items: Card[] };
      try {
        resp = await api.get<{ items: Card[] }>(
          `/cards?ids=${chunk.join(",")}&page_size=${CHUNK}`,
        );
      } catch {
        // Permission-denied or transient error: skip this chunk. The
        // exporter will fall back to bare names for any target whose
        // full card we couldn't fetch.
        continue;
      }
      for (const card of resp.items) {
        if (!byId.has(card.id)) byId.set(card.id, card);
        if (card.parent_id && !byId.has(card.parent_id)) {
          nextLevel.push(card.parent_id);
        }
      }
    }
    queue.length = 0;
    queue.push(...nextLevel);
  }
}

/** Lightweight handle for a relation target — either the full card (best,
 * gives us parent_path for disambiguation) or just the embedded ref from
 * the relation payload (fallback when we couldn't fetch the card). */
type TargetHandle =
  | { kind: "card"; card: Card }
  | { kind: "ref"; type: string; name: string };

/** Build the human-readable reference for a target, in either form. */
function buildTargetRef(
  handle: TargetHandle,
  byId: Map<string, Card>,
  nameAmbiguity: Set<string>,
): string {
  if (handle.kind === "ref") {
    // We only have a bare name. Importer can still resolve unambiguous
    // matches; if it's ambiguous in the DB the import will surface the
    // candidates so the user can disambiguate manually.
    return encodePathSegment(handle.name);
  }
  return buildCardRef(handle.card, byId, nameAmbiguity);
}

/**
 * Build a row representation for a single card sheet. Pulls in core
 * columns, `attr_*`, `lifecycle_*`, and `rel:<key>` columns for each
 * applicable simple relation type.
 */
function buildCardRowForType(
  card: Card,
  type: CardType,
  byId: Map<string, Card>,
  outgoingByRelType: Map<string, TargetHandle[]>,
  inlineRelTypes: RelationType[],
  nameAmbiguity: Set<string>,
  attrFieldKeys: string[],
  attrIsCost: Map<string, boolean>,
  canViewCosts: boolean,
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: card.id,
    type: card.type,
    name: card.name,
    description: card.description ?? "",
    subtype: card.subtype ?? "",
    parent_path: buildParentPath(card, byId),
    external_id: card.external_id ?? "",
    reference: card.reference ?? "",
    alias: card.alias ?? "",
    approval_status: card.approval_status ?? "",
    tags: (card.tags || [])
      .map((tg) => (tg.group_name ? `${tg.group_name}: ${tg.name}` : tg.name))
      .join(", "),
  };

  for (const phase of LIFECYCLE_PHASES) {
    row[`lifecycle_${phase}`] = (card.lifecycle || {})[phase] ?? "";
  }

  for (const fieldKey of attrFieldKeys) {
    if (attrIsCost.get(fieldKey) && !canViewCosts) continue;
    const val = (card.attributes || {})[fieldKey];
    row[`attr_${fieldKey}`] = Array.isArray(val) ? val.join(", ") : (val ?? "");
  }

  for (const rt of inlineRelTypes) {
    const targets = outgoingByRelType.get(rt.key) || [];
    // Semicolons (not commas) separate targets within a cell — card names
    // are free-form and commonly contain `,` (e.g. "Acme, Inc."). Read by
    // `splitRelationCell()` in `excelImport.ts`, which also accepts the
    // old comma format for backwards compatibility with workbooks
    // exported before this convention.
    row[`rel:${rt.key}`] = targets
      .map((t) => buildTargetRef(t, byId, nameAmbiguity))
      .join("; ");
  }

  // Type is the same across the sheet; keep the column for clarity but
  // make sure each row has it.
  void type;
  return row;
}

/**
 * Build the multi-sheet workbook in memory without writing it to disk.
 *
 * Split out from `exportToExcel()` so unit tests can exercise the workbook
 * contents directly (we can't call `XLSX.writeFile` under jsdom). Production
 * callers should keep using `exportToExcel()` — this helper is exported
 * primarily for tests.
 */
export async function buildExportWorkbook(
  cards: Card[],
  typeConfig: CardType | undefined,
  allTypes: CardType[],
  relationTypes: RelationType[],
  options: ExportOptions = {},
): Promise<XLSX.WorkBook> {
  const { canViewCosts = true, tenantUrl } = options;

  // Index all cards (across types) by id so relation targets are resolvable
  // even when they belong to a different type than the row being written.
  const byId = new Map<string, Card>();
  for (const card of cards) byId.set(card.id, card);

  // Single round-trip: every active outgoing relation from the export set.
  // (See fetchOutgoingRelations for why this replaced the previous per-card loop.)
  const sourceIdSet = new Set(cards.map((c) => c.id));
  const allRelations = await fetchOutgoingRelations(sourceIdSet);

  // Top up `byId` with relation targets that aren't in the filtered export
  // (e.g. when the grid is filtered to Applications, the ITComponent on
  // the other end of each `depends_on` won't be in `cards`). Without this
  // we lose the parent_path needed for disambiguated refs — and previously
  // we dropped the relations entirely.
  await enrichMissingTargets(byId, allRelations.map((r) => r.target_id));

  // Detect (type, name) ambiguity across *every card we may reference* —
  // exported set plus the targets we just fetched. Bare names are safe
  // when unique; ambiguous names trigger the full parent_path encoding.
  const nameCounts = new Map<string, number>();
  for (const card of byId.values()) {
    const key = `${card.type}|${card.name.trim().toLowerCase()}`;
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  // Also account for targets whose card we couldn't fetch — use the
  // embedded ref's `type` + `name` from the relation payload. If the same
  // (type, name) appears more than once across these, treat it as ambiguous.
  for (const rel of allRelations) {
    if (!byId.has(rel.target_id) && rel.target) {
      const key = `${rel.target.type}|${rel.target.name.trim().toLowerCase()}`;
      nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    }
  }
  const nameAmbiguity = new Set<string>();
  for (const [key, count] of nameCounts) {
    if (count > 1) nameAmbiguity.add(key);
  }

  // Group relations by source_id then by relation_type_key for fast lookup
  // during row building. Use TargetHandle so a missing-from-byId target
  // still gets emitted via the embedded `rel.target` ref.
  const outgoingBySource = new Map<string, Map<string, TargetHandle[]>>();
  for (const rel of allRelations) {
    const targetCard = byId.get(rel.target_id);
    let handle: TargetHandle;
    if (targetCard) {
      handle = { kind: "card", card: targetCard };
    } else if (rel.target) {
      handle = { kind: "ref", type: rel.target.type, name: rel.target.name };
    } else {
      // No card, no embedded ref — nothing we can render. Skip silently;
      // this should be impossible given backend's _rel_to_response always
      // populates `target`.
      continue;
    }
    let perType = outgoingBySource.get(rel.source_id);
    if (!perType) {
      perType = new Map();
      outgoingBySource.set(rel.source_id, perType);
    }
    const list = perType.get(rel.type) || [];
    list.push(handle);
    perType.set(rel.type, list);
  }

  const wb = XLSX.utils.book_new();
  const takenSheetNames = new Set<string>();

  // Determine which types to emit. When a single typeConfig is provided,
  // restrict to that type; otherwise group the cards by their own `type`
  // and produce one sheet per group.
  const typesInExport: CardType[] = typeConfig
    ? [typeConfig]
    : (() => {
        const present = new Set(cards.map((c) => c.type));
        return allTypes.filter((t) => present.has(t.key));
      })();

  // Cache cost-field detection per type for the canViewCosts filter.
  const costKeysByType = new Map<string, Set<string>>();
  for (const t of allTypes) {
    const set = new Set<string>();
    for (const sec of t.fields_schema) {
      for (const f of sec.fields) {
        if (f.type === "cost") set.add(f.key);
      }
    }
    costKeysByType.set(t.key, set);
  }

  // Inline vs Relations-sheet split for relation types.
  // Inline: cardinality permits multiple sources/targets *and* no attributes.
  // Relations sheet: attribute-bearing relation types.
  const inlineRelTypes = relationTypes.filter(
    (rt) =>
      !rt.is_hidden && (!rt.attributes_schema || rt.attributes_schema.length === 0),
  );
  const attributeRelTypes = relationTypes.filter(
    (rt) =>
      !rt.is_hidden && rt.attributes_schema && rt.attributes_schema.length > 0,
  );

  // Per-type card sheets.
  for (const type of typesInExport) {
    const cardsOfType = cards.filter((c) => c.type === type.key);
    const attrFields = type.fields_schema.flatMap((s) => s.fields);
    const attrFieldKeys = attrFields.map((f) => f.key);
    const attrIsCost = new Map<string, boolean>();
    const costSet = costKeysByType.get(type.key) ?? new Set();
    for (const k of attrFieldKeys) attrIsCost.set(k, costSet.has(k));

    // Relation types whose forward direction starts from this type. Hidden
    // types and attribute-bearing types are excluded.
    const inlineForType = inlineRelTypes.filter((rt) => rt.source_type_key === type.key);

    const rows: Record<string, unknown>[] = [];
    for (const card of cardsOfType) {
      const outgoing =
        outgoingBySource.get(card.id) ?? new Map<string, TargetHandle[]>();
      rows.push(
        buildCardRowForType(
          card,
          type,
          byId,
          outgoing,
          inlineForType,
          nameAmbiguity,
          attrFieldKeys.filter((k) => !attrIsCost.get(k) || canViewCosts),
          attrIsCost,
          canViewCosts,
        ),
      );
    }

    // Ensure the sheet has at least a header row, even when the slice is
    // empty, so the re-import flow can still detect the type from the
    // sheet name and a clear column header set.
    const headerSeed = rows.length > 0
      ? rows
      : [
          buildCardRowForType(
            {
              id: "",
              type: type.key,
              name: "",
              description: "",
              subtype: "",
              status: "",
              approval_status: "",
              data_quality: 0,
              tags: [],
              stakeholders: [],
            } as Card,
            type,
            byId,
            new Map<string, TargetHandle[]>(),
            inlineForType,
            nameAmbiguity,
            attrFieldKeys,
            attrIsCost,
            canViewCosts,
          ),
        ];
    const ws = XLSX.utils.json_to_sheet(headerSeed);
    if (rows.length === 0) {
      // Strip the placeholder row but keep the header.
      const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
      range.e.r = 0;
      ws["!ref"] = XLSX.utils.encode_range(range);
    }
    ws["!cols"] = autoSizeColumns(headerSeed);
    XLSX.utils.book_append_sheet(wb, ws, sheetNameForType(type, takenSheetNames));
  }

  // Relations sheet (attribute-bearing only). The card-sheet inline columns
  // already cover simple relations.
  if (attributeRelTypes.length > 0) {
    const relRows: Record<string, unknown>[] = [];
    const attrColumnSet = new Set<string>();
    for (const rt of attributeRelTypes) {
      for (const f of rt.attributes_schema) {
        if (f.type === "cost" && !canViewCosts) continue;
        attrColumnSet.add(`attr_${f.key}`);
      }
    }
    for (const rel of allRelations) {
      const rt = attributeRelTypes.find((r) => r.key === rel.type);
      if (!rt) continue;
      // Build endpoint handles in the same TargetHandle shape used for inline
      // relations — full card when available, otherwise the embedded ref.
      const sourceCard = byId.get(rel.source_id);
      const targetCard = byId.get(rel.target_id);
      let sourceHandle: TargetHandle | null = null;
      if (sourceCard) {
        sourceHandle = { kind: "card", card: sourceCard };
      } else if (rel.source) {
        sourceHandle = { kind: "ref", type: rel.source.type, name: rel.source.name };
      }
      let targetHandle: TargetHandle | null = null;
      if (targetCard) {
        targetHandle = { kind: "card", card: targetCard };
      } else if (rel.target) {
        targetHandle = { kind: "ref", type: rel.target.type, name: rel.target.name };
      }
      if (!sourceHandle || !targetHandle) continue;
      const row: Record<string, unknown> = {
        action: "upsert",
        relation_type: rel.type,
        source_type: sourceHandle.kind === "card" ? sourceHandle.card.type : sourceHandle.type,
        source_ref: buildTargetRef(sourceHandle, byId, nameAmbiguity),
        target_type: targetHandle.kind === "card" ? targetHandle.card.type : targetHandle.type,
        target_ref: buildTargetRef(targetHandle, byId, nameAmbiguity),
        description: rel.description ?? "",
      };
      const costSet = new Set(
        (rt.attributes_schema || [])
          .filter((f) => f.type === "cost")
          .map((f) => f.key),
      );
      for (const colKey of attrColumnSet) {
        const fieldKey = colKey.slice(5);
        if (costSet.has(fieldKey) && !canViewCosts) continue;
        const val = (rel.attributes || {})[fieldKey];
        row[colKey] = Array.isArray(val) ? val.join(", ") : (val ?? "");
      }
      relRows.push(row);
    }
    if (relRows.length > 0) {
      const ws = XLSX.utils.json_to_sheet(relRows);
      ws["!cols"] = autoSizeColumns(relRows);
      XLSX.utils.book_append_sheet(wb, ws, RELATIONS_SHEET_NAME);
    }
  }

  // _Meta sheet — a small key/value table that helps the importer detect
  // older formats and a banner in the dialog when the source tenant differs.
  const metaRows: Record<string, unknown>[] = [
    { key: "format_version", value: FORMAT_VERSION },
    { key: "exported_at", value: new Date().toISOString() },
    { key: "card_count", value: cards.length },
    { key: "relation_count", value: allRelations.length },
  ];
  if (tenantUrl) metaRows.push({ key: "tenant_url", value: tenantUrl });
  const metaWs = XLSX.utils.json_to_sheet(metaRows);
  metaWs["!cols"] = autoSizeColumns(metaRows);
  XLSX.utils.book_append_sheet(wb, metaWs, META_SHEET_NAME);

  const typeLabelStr = typeConfig
    ? typeLabel(typeConfig, i18n.language)
    : "landscape";
  void typeLabelStr;
  return wb;
}

/** Render a single grid cell value to a flat string for the current-view
 * export. Mirrors what the grid shows: arrays join with ", ", tag refs
 * collapse to "Group: Tag", and plain objects fall back to their `name`. */
function stringifyViewCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value
      .map((v) => {
        if (v && typeof v === "object") {
          const ref = v as { name?: string; group_name?: string };
          if (ref.name) return ref.group_name ? `${ref.group_name}: ${ref.name}` : ref.name;
        }
        return String(v);
      })
      .join(", ");
  }
  if (typeof value === "object") {
    const ref = value as { name?: string };
    return ref.name ?? "";
  }
  return String(value);
}

interface CurrentViewOptions {
  /** Used for the sheet name and download filename (e.g. the card-type label). */
  sheetLabel?: string;
}

/**
 * "Export current view" — a flat, single-sheet WYSIWYG snapshot of the grid.
 *
 * Unlike {@link exportToExcel} (a multi-sheet, re-importable workbook with the
 * full field set), this writes exactly what's on screen: the `rows` are the
 * filtered+sorted grid rows, `columns` are the displayed columns in their
 * left-to-right order, and the header row uses each column's displayed name.
 * Values are pre-extracted from the grid by the caller (via AG Grid's
 * valueGetters/valueFormatters), so this stays in sync with rendering.
 *
 * This format is **not** suitable for re-import — it carries no card ids and a
 * user-arranged column subset. It's a sharing artifact, nothing more.
 */
export function buildCurrentViewWorkbook(
  rows: Record<string, unknown>[],
  columns: { colId: string; headerName: string }[],
  options: CurrentViewOptions = {},
): XLSX.WorkBook {
  // Build unique, stable header labels (two columns can share a display name;
  // object keys can't collide, so disambiguate with the colId on conflict).
  const usedHeaders = new Set<string>();
  const headerFor = new Map<string, string>();
  for (const col of columns) {
    let header = col.headerName?.trim() || col.colId;
    if (usedHeaders.has(header)) header = `${header} (${col.colId})`;
    usedHeaders.add(header);
    headerFor.set(col.colId, header);
  }

  const sheetRows = rows.map((row) => {
    const out: Record<string, string> = {};
    for (const col of columns) {
      out[headerFor.get(col.colId)!] = stringifyViewCell(row[col.colId]);
    }
    return out;
  });

  const headers = columns.map((c) => headerFor.get(c.colId)!);
  const ws =
    sheetRows.length > 0
      ? XLSX.utils.json_to_sheet(sheetRows, { header: headers })
      : XLSX.utils.aoa_to_sheet([headers]);
  ws["!cols"] = autoSizeColumns(
    sheetRows.length > 0 ? sheetRows : [Object.fromEntries(headers.map((h) => [h, ""]))],
  );
  const wb = XLSX.utils.book_new();
  const label = (options.sheetLabel || "View").replace(/[\\/?*[\]:]/g, "_").slice(0, 31) || "View";
  XLSX.utils.book_append_sheet(wb, ws, label);
  return wb;
}

export function exportCurrentViewToExcel(
  rows: Record<string, unknown>[],
  columns: { colId: string; headerName: string }[],
  options: CurrentViewOptions = {},
): void {
  const wb = buildCurrentViewWorkbook(rows, columns, options);
  XLSX.writeFile(wb, `${options.sheetLabel || "view"}_view_${exportTimestamp()}.xlsx`);
}

/**
 * Public entry point used by the Inventory page export buttons. Builds the
 * workbook via `buildExportWorkbook()` and triggers a browser download.
 */
export async function exportToExcel(
  cards: Card[],
  typeConfig: CardType | undefined,
  allTypes: CardType[],
  relationTypes: RelationType[],
  options: ExportOptions = {},
): Promise<void> {
  const wb = await buildExportWorkbook(cards, typeConfig, allTypes, relationTypes, options);
  const typeLabelStr = typeConfig
    ? typeLabel(typeConfig, i18n.language)
    : "landscape";
  XLSX.writeFile(wb, `${typeLabelStr}_export_${exportTimestamp()}.xlsx`);
}
