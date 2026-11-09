import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import OriginChip from "@/components/OriginChip";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useIsRtl } from "@/hooks/useIsRtl";
import { useReadableCardTypes } from "@/hooks/useReadableCardTypes";
import {
  relationLabel,
  useFieldLabel,
  useOptionLabel,
  useSubtypeLabel,
  useTypeLabel,
} from "@/hooks/useResolveLabel";
import { DATA_QUALITY_BANDS } from "@/lib/dataQualityBands";
import { getPhaseLabels } from "@/lib/lifecyclePhases";
import { pickFacetFields } from "@/lib/fieldFacets";
import type {
  ActiveQuery,
  CardQuery,
  CardQueryWhere,
  CardType,
  FieldDef,
  QueryDraft,
  TagGroup,
} from "@/types";
import { APPROVAL_STATUS_OPTIONS, EMPTY_VALUE } from "./InventoryFilterSidebar";
import {
  branchLineOffset,
  connectorSegments,
  CONNECTOR_STUB,
  type ConnectorBox,
  type ConnectorSegment,
} from "./branchConnector";
import { hopRelationType, hopVerb } from "./queryPath";
import QueryConditionPopover from "./QueryConditionPopover";
import {
  addBranch,
  appendHopAt,
  canAppend,
  canBranch,
  cardsChipLabel,
  conditionValues,
  draftProblem,
  nodeAt,
  pickedCardIds,
  relationChoices,
  removeCondition,
  removeHopAt,
  rows,
  setCondition,
  setIncludeDescendants,
  setStartType,
  tagChipsByGroup,
  toggleNegate,
  type ConditionKind,
  type Connective,
  type NodePath,
  type QueryRow,
  type RelationChoice,
} from "./queryDraft";
import { tagGroupApplies } from "@/lib/tagGroups";
import { useCardNames, type CardNameEntry } from "./useCardNames";

interface Props {
  /** The query view in force, or null. */
  view: ActiveQuery | null;
  /** The query being built or edited; puts the strip in edit mode. */
  draft?: QueryDraft | null;
  /** May the user change the view in force (shows the pencil)? */
  canEdit?: boolean;
  tagGroups?: TagGroup[];
  /** Leave the view: drops the query from the inventory. */
  onLeave: () => void;
  /** Start editing the view in force. */
  onEdit?: () => void;
  onDraftChange?: (draft: QueryDraft) => void;
  onSave?: () => void;
  onCancel?: () => void;
  saving?: boolean;
  /** The code of a refused save (`unknown_tag`, …). */
  error?: string | null;
}

const NOOP = () => {};
/** One empty list for every render, so the lines are not re-measured for nothing. */
const NO_TAG_GROUPS: TagGroup[] = [];

/**
 * The strip above the inventory grid while a query view is applied or being
 * built. In view mode it names the view and reads the query as lines of
 * chips — each card type with its conditions, then per hop an arrow, the
 * relation verb read from the side under view, and the next type. A branch
 * is a line of its own below, starting under the card it hangs from and
 * joined to it by a drawn connector carrying AND or OR. In edit mode the same
 * lines become the builder: the start type, each verb and each condition is
 * a chip that opens its editor, a circled plus under a card of the bottom
 * line adds the next branch, and the grid below is the live preview.
 */
export default function QueryPathStrip({
  view,
  draft = null,
  canEdit = false,
  tagGroups = NO_TAG_GROUPS,
  onLeave,
  onEdit = NOOP,
  onDraftChange = NOOP,
  onSave = NOOP,
  onCancel = NOOP,
  saving = false,
  error = null,
}: Props) {
  // Picked cards are named once for the whole strip, every node at once.
  const cardNames = useCardNames(pickedCardIds(draft?.query ?? view?.query ?? { type: "" }));
  if (draft) {
    return (
      <EditStrip
        draft={draft}
        viewName={view && view.viewId === draft.viewId ? view.name : null}
        tagGroups={tagGroups}
        cardNames={cardNames}
        onDraftChange={onDraftChange}
        onSave={onSave}
        onCancel={onCancel}
        saving={saving}
        error={error}
      />
    );
  }
  if (!view) return null;
  return (
    <ViewStrip
      view={view}
      canEdit={canEdit}
      tagGroups={tagGroups}
      cardNames={cardNames}
      onLeave={onLeave}
      onEdit={onEdit}
    />
  );
}

const STRIP_SX = {
  mb: 1,
  px: 1.5,
  py: 1,
  flexShrink: 0,
  minWidth: 0,
  maxWidth: "100%",
  display: "flex",
  flexDirection: "column",
  gap: 0.75,
} as const;
/** One line of the query: a wrapping row of chips, each at the top of its slot. */
const ROW_SX = { display: "flex", alignItems: "flex-start", gap: 0.75, flexWrap: "wrap" } as const;

function ViewStrip({
  view,
  canEdit,
  tagGroups,
  cardNames,
  onLeave,
  onEdit,
}: {
  view: ActiveQuery;
  canEdit: boolean;
  tagGroups: TagGroup[];
  cardNames: Map<string, CardNameEntry>;
  onLeave: () => void;
  onEdit: () => void;
}) {
  const { t } = useTranslation(["inventory", "common"]);
  return (
    <Paper variant="outlined" data-testid="query-path-strip" sx={STRIP_SX}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <OriginChip origin={view.createdVia} />
        <Typography variant="body2" fontWeight={600}>
          {view.name}
        </Typography>
        {view.createdVia === "mcp" && (
          <Tooltip title={t("inventory:queryView.createdViaMcpHint")} describeChild>
            <Typography variant="caption" color="text.secondary">
              {t("inventory:queryView.createdViaMcp")}
            </Typography>
          </Tooltip>
        )}
        <Box sx={{ flex: 1 }} />
        {canEdit && (
          <IconButton
            size="small"
            aria-label={t("inventory:queryView.edit")}
            data-testid="query-path-edit"
            onClick={onEdit}
          >
            <MaterialSymbol icon="edit" size={18} />
          </IconButton>
        )}
        <IconButton
          size="small"
          aria-label={t("inventory:queryView.leave")}
          data-testid="query-path-leave"
          onClick={onLeave}
        >
          <MaterialSymbol icon="close" size={18} />
        </IconButton>
      </Box>
      <QueryLines query={view.query} tagGroups={tagGroups} cardNames={cardNames} />
    </Paper>
  );
}

function fieldsOf(type: CardType | undefined): FieldDef[] {
  return (type?.fields_schema ?? []).flatMap((s) => s.fields);
}

function Arrow() {
  const isRtl = useIsRtl();
  return (
    <MaterialSymbol
      icon="arrow_forward"
      size={18}
      style={{ transform: isRtl ? "scaleX(-1)" : undefined }}
    />
  );
}

function TypeChip({ type, typeKey }: { type: CardType | undefined; typeKey: string }) {
  const typeLabel = useTypeLabel();
  return (
    <Chip
      size="small"
      variant="outlined"
      label={typeLabel(type) || typeKey}
      icon={type ? <MaterialSymbol icon={type.icon} size={16} color={type.color} /> : undefined}
      sx={{ fontWeight: 600, borderColor: type?.color, "& .MuiChip-icon": { ml: 0.5 } }}
    />
  );
}

/** One condition chip of a node. A tags condition gives one chip per tag group. */
interface ConditionItem {
  key: string;
  kind: ConditionKind;
  label: string;
  /** The tag ids this chip names (tags only). */
  tagIds?: string[];
}

/**
 * The condition chips of a node: `label: value, value` (`label` alone while
 * still empty). None while `enabled` is false — a caller that shows no chips
 * still calls the hook, but skips the work.
 */
function useConditionItems(
  type: CardType | undefined,
  where: CardQueryWhere | undefined,
  tagGroups: TagGroup[],
  cardNames: Map<string, CardNameEntry>,
  enabled = true,
): ConditionItem[] {
  const { t } = useTranslation(["inventory", "common"]);
  const fieldLabel = useFieldLabel();
  const optLabel = useOptionLabel();
  const stLabel = useSubtypeLabel();
  if (!enabled || !where) return [];
  const empty = t("inventory:filter.emptyValue");
  const items: ConditionItem[] = [];
  const labelOf = (name: string, values: string[]) =>
    values.length > 0 ? `${name}: ${values.join(", ")}` : name;

  if (where.lifecycle_phase) {
    const phases = getPhaseLabels(t);
    const values = where.lifecycle_phase.map((p) => (p === "none" ? empty : phases[p] ?? p));
    items.push({
      key: "lifecycle",
      kind: "lifecycle_phase",
      label: labelOf(t("inventory:columns.lifecycle"), values),
    });
  }
  if (where.subtype) {
    const values = where.subtype.map((k) => {
      if (k === EMPTY_VALUE) return empty;
      const st = type?.subtypes?.find((s) => s.key === k);
      return st ? stLabel(st) : k;
    });
    items.push({ key: "subtype", kind: "subtype", label: labelOf(t("common:labels.subtype"), values) });
  }
  if (where.approval_status) {
    const values = where.approval_status.map((k) => {
      const opt = APPROVAL_STATUS_OPTIONS.find((o) => o.key === k);
      return opt ? t(opt.tKey) : k;
    });
    items.push({
      key: "approval",
      kind: "approval_status",
      label: labelOf(t("inventory:columns.approvalStatus"), values),
    });
  }
  if (where.data_quality_band) {
    const values = where.data_quality_band.map((k) => {
      const band = DATA_QUALITY_BANDS.find((b) => b.key === k);
      return band ? t(`inventory:${band.tKey}`) : k;
    });
    items.push({
      key: "dataQuality",
      kind: "data_quality_band",
      label: labelOf(t("inventory:filter.dataQuality"), values),
    });
  }
  if (where.tags) {
    const chips = tagChipsByGroup(where.tags, tagGroups, t("inventory:queryView.unknownTag"));
    if (chips.length === 0) {
      items.push({ key: "tags", kind: "tags", label: t("inventory:filter.tags"), tagIds: [] });
    }
    for (const c of chips) {
      items.push({ key: `tags-${c.key}`, kind: "tags", label: c.label, tagIds: c.ids });
    }
  }
  if (where.cards) {
    items.push({
      key: "cards",
      kind: "cards",
      label: cardsChipLabel(where.cards, cardNames, !!where.include_descendants, {
        cardsLabel: t("inventory:queryView.cardsLabel"),
        hiddenCard: t("inventory:queryView.hiddenCard"),
        unknownCard: t("inventory:queryView.unknownCard"),
        subCards: t("inventory:queryView.subCards"),
      }),
    });
  }
  const fields = fieldsOf(type);
  for (const [fieldKey, raw] of Object.entries(where.attributes ?? {})) {
    const field = fields.find((f) => f.key === fieldKey);
    const values = raw.map((v) => {
      if (v === EMPTY_VALUE) return empty;
      if (field?.type === "boolean") {
        if (v === "true") return t("common:labels.yes");
        if (v === "false") return t("common:labels.no");
      }
      const opt = field?.options?.find((o) => o.key === v);
      return opt ? optLabel(opt) : v;
    });
    items.push({
      key: `attr-${fieldKey}`,
      kind: { attribute: fieldKey },
      label: labelOf(field ? fieldLabel(field) : fieldKey, values),
    });
  }
  return items;
}

/* ------------------------------------------------------------------ */
/*  Edit mode                                                          */
/* ------------------------------------------------------------------ */

function EditStrip({
  draft,
  viewName,
  tagGroups,
  cardNames,
  onDraftChange,
  onSave,
  onCancel,
  saving,
  error,
}: {
  draft: QueryDraft;
  viewName: string | null;
  tagGroups: TagGroup[];
  cardNames: Map<string, CardNameEntry>;
  onDraftChange: (draft: QueryDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  const { t } = useTranslation(["inventory", "common"]);
  const problem = draftProblem(draft.query);
  const onChange = (query: CardQuery) => onDraftChange({ ...draft, query });
  return (
    <Paper variant="outlined" data-testid="query-path-strip" sx={STRIP_SX}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <MaterialSymbol icon="view_in_ar" size={18} />
        <Typography variant="body2" fontWeight={600}>
          {draft.viewId ? t("inventory:queryView.editTitle") : t("inventory:queryView.newTitle")}
        </Typography>
        {viewName && (
          <Typography variant="body2" color="text.secondary">
            {viewName}
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        <Button size="small" data-testid="query-path-cancel" onClick={onCancel} sx={{ textTransform: "none" }}>
          {t("common:actions.cancel")}
        </Button>
        <Button
          size="small"
          variant="contained"
          data-testid="query-path-save"
          disabled={problem != null || saving}
          onClick={onSave}
          sx={{ textTransform: "none" }}
        >
          {t("common:actions.save")}
        </Button>
      </Box>
      <QueryLines
        query={draft.query}
        tagGroups={tagGroups}
        cardNames={cardNames}
        onChange={onChange}
      />
      {error && (
        <Typography variant="caption" color="error" role="alert">
          {t(`inventory:queryView.error.${error}`, { defaultValue: error })}
        </Typography>
      )}
    </Paper>
  );
}

const kindKey = (kind: ConditionKind) => (typeof kind === "object" ? `attr:${kind.attribute}` : kind);

interface OpenCondition {
  anchor: HTMLElement;
  path: NodePath;
  kind: ConditionKind;
}

/** A stable key for a node's path ("root", "r0", "r0.o1", …). */
const pathKey = (path: NodePath) =>
  path.map((s) => `${s.list === "related" ? "r" : "o"}${s.index}`).join(".") || "root";

/** Can the `+ relation` chip continue this row from its last node? */
function rowAppendable(query: CardQuery, row: QueryRow): boolean {
  return canAppend(query, row.nodes[row.nodes.length - 1].path);
}

/** Where a branch line sits and how its connector is drawn, once measured. */
interface LineLayout {
  offset: number;
  segments: ConnectorSegment[];
}

/** A branch line as the layout measures it: its key and its origin card's key. */
interface BranchLine {
  key: string;
  originKey: string;
}

/**
 * Measures every branch line's connector against the rendered strip: the
 * arrow after the origin card, with its marker (registered by `originRef`,
 * keyed by the origin card's path), and the line's badge
 * (`badgeRef`), relative to the lines container (`containerRef`). It runs
 * after every render — a line moved by the one above it is measured again on
 * the next pass, and an unchanged result renders nothing — and whenever the
 * container is resized (a wrapped chip, a narrower window).
 */
function useBranchLayout(branches: BranchLine[], isRtl: boolean, content: unknown) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const origins = useRef(new Map<string, HTMLElement>());
  const badges = useRef(new Map<string, HTMLElement>());
  // One ref callback per element for the strip's life: a new callback every
  // render would make React detach and re-attach every ref on each commit.
  const callbacks = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const branchesRef = useRef(branches);
  branchesRef.current = branches;
  const [layout, setLayout] = useState<Record<string, LineLayout>>({});
  // Bumped when something moves the chips without a render: a resize, a font.
  const [tick, setTick] = useState(0);

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const box = container.getBoundingClientRect();
    // Inline-start offsets: from the left in LTR, from the right in RTL.
    const startOf = (r: DOMRect) => Math.round(isRtl ? box.right - r.right : r.left - box.left);
    const endOf = (r: DOMRect) => Math.round(isRtl ? box.right - r.left : r.right - box.left);
    const topOf = (r: DOMRect) => Math.round(r.top - box.top);
    const bottomOf = (r: DOMRect) => Math.round(r.bottom - box.top);
    const arrows = Array.from(origins.current);
    // Every chip and every arrow with its verb, of every line: a node's box
    // only groups its pieces (`display: contents`), so its children are the
    // line's items. The item holding an origin's arrow says so.
    const items = Array.from(
      container.querySelectorAll<HTMLElement>('[data-testid="query-path-row"]'),
    )
      .flatMap((row) => Array.from(row.children))
      .flatMap((el) => (el.hasAttribute("data-query-node") ? Array.from(el.children) : [el]))
      .map((el) => {
        const r = el.getBoundingClientRect();
        const origin = arrows.find(([, arrow]) => el.contains(arrow))?.[0];
        const box: ConnectorBox = {
          start: startOf(r),
          end: endOf(r),
          top: topOf(r),
          bottom: bottomOf(r),
          origin,
        };
        return { el, box };
      });
    const next: Record<string, LineLayout> = {};
    for (const { key, originKey } of branchesRef.current) {
      const arrow = origins.current.get(originKey);
      const badge = badges.current.get(key);
      if (!arrow || !badge) continue;
      const a = arrow.getBoundingClientRect();
      const b = badge.getBoundingClientRect();
      const origin = {
        key: originKey,
        x: Math.round((startOf(a) + endOf(a)) / 2),
        top: topOf(a),
        bottom: bottomOf(a),
      };
      const end = { start: startOf(b), top: topOf(b), bottom: bottomOf(b) };
      next[key] = {
        offset: branchLineOffset(origin.x, Math.round(box.width)),
        // The badge's own item (with the plus under it) is where the connector ends.
        segments: connectorSegments(
          origin,
          end,
          items.filter((item) => !item.el.contains(badge)).map((item) => item.box),
        ),
      };
    }
    setLayout((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [isRtl]);

  // Measured when the lines change, after a resize or a font swap, and once
  // more after each new layout: a line moved by the one above it is measured
  // again, and an unchanged result stops there.
  useLayoutEffect(measure, [measure, content, tick, layout]);
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    const container = containerRef.current;
    const observer =
      container && typeof ResizeObserver !== "undefined" ? new ResizeObserver(bump) : null;
    observer?.observe(container as HTMLElement);
    // Material Symbols arrive after the first paint: until then an icon is
    // its ligature's text, and the swap moves chips without resizing the strip.
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    let live = true;
    if (fonts) {
      fonts.ready.then(() => live && bump());
      fonts.addEventListener("loadingdone", bump);
    }
    return () => {
      live = false;
      observer?.disconnect();
      fonts?.removeEventListener("loadingdone", bump);
    };
  }, []);

  const refFor = (map: Map<string, HTMLElement>, id: string, key: string) => {
    let callback = callbacks.current.get(id);
    if (!callback) {
      callback = (el: HTMLElement | null) => {
        if (el) map.set(key, el);
      };
      callbacks.current.set(id, callback);
    }
    return callback;
  };
  return {
    containerRef,
    layout,
    originRef: (key: string) => refFor(origins.current, `origin:${key}`, key),
    badgeRef: (key: string) => refFor(badges.current, `badge:${key}`, key),
  };
}

/**
 * The query as lines, one per row (`rows`): each a wrapping row of chips —
 * the card type with its conditions, then per hop an arrow, the relation verb
 * read from the side under view and the next card. A branch line starts
 * under the arrow after the card it hangs from, its AND / OR badge first; a
 * connector drawn from a marker under that arrow turns into the badge. In
 * edit mode a circled plus under a card of the bottom line opens the next
 * branch, and every chip opens its editor. Editable when `onChange` is given.
 */
function QueryLines({
  query,
  tagGroups,
  cardNames,
  onChange,
}: {
  query: CardQuery;
  tagGroups: TagGroup[];
  cardNames: Map<string, CardNameEntry>;
  onChange?: (query: CardQuery) => void;
}) {
  const { t, i18n } = useTranslation("inventory");
  const { types, relationTypes } = useMetamodel();
  const isRtl = useIsRtl();
  const readable = useReadableCardTypes();
  // The start chip's type menu: edit mode only, worked out once for the strip.
  const editing = !!onChange;
  const offered = useMemo(
    () => (editing ? readable.filter((ct) => !ct.is_hidden) : []),
    [editing, readable],
  );
  const [open, setOpen] = useState<OpenCondition | null>(null);
  const allRows = rows(query);
  const branches = allRows.flatMap((row) =>
    row.parentPath ? [{ key: pathKey(row.nodes[0].path), originKey: pathKey(row.parentPath) }] : [],
  );
  const originKeys = new Set(branches.map((b) => b.originKey));
  // A new object whenever what the lines show may have changed — the query,
  // the mode, a label or a card name arriving: the layout measures again.
  const content = useMemo(
    () => [query, editing, cardNames, tagGroups, types, relationTypes, i18n.language],
    [query, editing, cardNames, tagGroups, types, relationTypes, i18n.language],
  );
  const { containerRef, layout, originRef, badgeRef } = useBranchLayout(branches, isRtl, content);

  const openNode = open ? nodeAt(query, open.path) : undefined;
  const closeCondition = () => {
    if (open && openNode && onChange && conditionValues(openNode.where, open.kind)?.length === 0) {
      onChange(removeCondition(query, open.path, open.kind));
    }
    setOpen(null);
  };

  return (
    <Box
      ref={containerRef}
      data-testid="query-path-lines"
      sx={{ position: "relative", display: "flex", flexDirection: "column", gap: 1 }}
    >
      {allRows.map((row, r) => {
        const key = pathKey(row.nodes[0].path);
        // Only the bottom line offers pluses: the stack grows downward.
        const isLast = r === allRows.length - 1;
        const last = row.nodes[row.nodes.length - 1];
        const lineLayout = layout[key];
        return (
          <Box
            key={key}
            data-testid="query-path-row"
            sx={ROW_SX}
            // Measured in the reading direction, so placed on the physical
            // side by hand: inline styles stay out of the RTL stylis flip.
            style={
              row.connective
                ? {
                    [isRtl ? "marginRight" : "marginLeft"]: lineLayout?.offset ?? 0,
                    [isRtl ? "paddingRight" : "paddingLeft"]: CONNECTOR_STUB,
                  }
                : undefined
            }
          >
            {row.connective && (
              <Box
                data-testid="query-path-connective-stack"
                sx={{ display: "inline-flex", flexDirection: "column", alignItems: "center" }}
              >
                <Chip
                  ref={badgeRef(key)}
                  size="small"
                  data-testid="query-path-connective"
                  color={row.connective === "and" ? "primary" : "secondary"}
                  label={t(
                    row.connective === "and" ? "queryView.connectiveAnd" : "queryView.connectiveOr",
                  )}
                  sx={{ mt: "2px", height: 20, fontSize: 11, fontWeight: 700 }}
                />
                {onChange && isLast && row.parentPath && (
                  <SiblingBranchButton
                    query={query}
                    path={row.parentPath}
                    connective={row.connective}
                    onChange={onChange}
                  />
                )}
              </Box>
            )}
            {row.nodes.map((rn, i) => {
              const prev = i > 0 ? row.nodes[i - 1].path : row.parentPath;
              const fromType = prev ? (nodeAt(query, prev)?.type ?? "") : "";
              const nodeKey = pathKey(rn.path);
              // A branch leaves from the arrow after its card: the card's
              // continuation hop, always the next node of this line.
              const prevKey = i > 0 ? pathKey(row.nodes[i - 1].path) : null;
              return (
                <QueryNode
                  key={nodeKey}
                  query={query}
                  path={rn.path}
                  fromType={fromType}
                  branchable={isLast}
                  originRef={prevKey && originKeys.has(prevKey) ? originRef(prevKey) : null}
                  offered={offered}
                  tagGroups={tagGroups}
                  cardNames={cardNames}
                  onChange={onChange}
                  onOpenCondition={(anchor, kind) => setOpen({ anchor, path: rn.path, kind })}
                />
              );
            })}
            {onChange && rowAppendable(query, row) && (
              <AddHopChip
                fromType={nodeAt(query, last.path)?.type ?? ""}
                onPick={(relation, type) => onChange(appendHopAt(query, last.path, relation, type))}
              />
            )}
          </Box>
        );
      })}
      {branches.map(({ key }) =>
        layout[key] ? (
          <BranchConnector key={key} segments={layout[key].segments} isRtl={isRtl} />
        ) : null,
      )}
      {open && openNode && onChange && (
        <QueryConditionPopover
          anchorEl={open.anchor}
          onClose={closeCondition}
          type={types.find((ct) => ct.key === openNode.type)}
          kind={open.kind}
          values={conditionValues(openNode.where, open.kind) ?? []}
          tagGroups={tagGroups}
          cardNames={cardNames}
          includeDescendants={!!openNode.where?.include_descendants}
          onIncludeDescendantsChange={(on) => onChange(setIncludeDescendants(query, open.path, on))}
          onChange={(values) => onChange(setCondition(query, open.path, open.kind, values))}
        />
      )}
    </Box>
  );
}

const CONNECTOR_LINE = "2px solid currentColor";

/**
 * The drawn joint between a branch line and its origin card: a drop from the
 * marker under the arrow after that card, turning into the line's badge
 * (`connectorSegments`). Purely
 * visual — the badge itself names the operator.
 */
function BranchConnector({ segments, isRtl }: { segments: ConnectorSegment[]; isRtl: boolean }) {
  const [startSide, endSide] = isRtl ? (["Right", "Left"] as const) : (["Left", "Right"] as const);
  return (
    <Box
      aria-hidden
      data-testid="query-path-connector"
      sx={{ position: "absolute", inset: 0, pointerEvents: "none", color: "text.secondary" }}
    >
      {segments.map((s, i) => {
        const side = s.side === "start" ? startSide : endSide;
        return (
          <Box
            key={i}
            data-testid="query-path-connector-segment"
            style={{
              position: "absolute",
              top: s.top,
              [isRtl ? "right" : "left"]: s.start,
              width: s.width,
              height: s.height,
              [`border${side}`]: CONNECTOR_LINE,
              ...(s.bottom
                ? { borderBottom: CONNECTOR_LINE, [`borderBottom${side}Radius`]: 6 }
                : {}),
            }}
          />
        );
      })}
    </Box>
  );
}

/** Lines up an icon or a line of text with the 24px chips beside it. */
const SLOT_SX = { display: "inline-flex", alignItems: "center", minHeight: 24 } as const;

/**
 * One node of a line: the hop's arrow — with, under it, the marker a branch
 * line's connector leaves from when a branch hangs from the card before it —
 * and verb (none for the start card), the card with the branch plus under
 * it, and the card's conditions.
 */
function QueryNode({
  query,
  path,
  fromType,
  branchable,
  originRef,
  offered,
  tagGroups,
  cardNames,
  onChange,
  onOpenCondition,
}: {
  query: CardQuery;
  path: NodePath;
  /** The type of the node this hop leaves (empty for the start card). */
  fromType: string;
  /** Is this node's line the bottom one, the only line that offers pluses? */
  branchable: boolean;
  /** Registers the arrow and its marker when a branch line hangs from the card before it. */
  originRef: ((el: HTMLElement | null) => void) | null;
  /** The types the start chip offers (edit mode). */
  offered: CardType[];
  tagGroups: TagGroup[];
  cardNames: Map<string, CardNameEntry>;
  onChange?: (query: CardQuery) => void;
  onOpenCondition: (anchor: HTMLElement, kind: ConditionKind) => void;
}) {
  const { t, i18n } = useTranslation(["inventory", "common"]);
  const { types, relationTypes } = useMetamodel();
  const node = nodeAt(query, path);
  const typeKey = node?.type ?? "";
  const type = types.find((ct) => ct.key === typeKey);
  // View mode shows these chips; edit mode's `EditConditions` works out its own.
  const items = useConditionItems(type, node?.where, tagGroups, cardNames, !onChange);
  const hop = path.length > 0 && node && "relation" in node ? node : null;
  const rt = hop ? hopRelationType(hop, relationTypes) : undefined;
  const verb = hop ? hopVerb(rt, fromType, i18n.language, hop.relation) || hop.relation : "";

  return (
    <Box
      data-testid={hop ? "query-path-hop" : undefined}
      data-query-node=""
      sx={{ display: "contents" }}
    >
      {hop && (
        // The arrow never wraps away from its verb to the end of a line.
        <Box
          data-testid="query-path-hop-head"
          sx={{ display: "inline-flex", alignItems: "flex-start", gap: 0.75 }}
        >
          <Box
            ref={originRef ?? undefined}
            data-testid="query-path-arrow"
            sx={{ display: "inline-flex", flexDirection: "column", alignItems: "center" }}
          >
            <Box sx={SLOT_SX}>
              <Arrow />
            </Box>
            {originRef && (
              // Centred under the arrow, where the connector drops from.
              <Box
                data-testid="query-path-branch-origin"
                sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "text.secondary", mt: 0.5 }}
              />
            )}
          </Box>
          {onChange ? (
            <VerbChip
              verb={verb}
              negate={!!hop.negate}
              onToggleNegate={() => onChange(toggleNegate(query, path))}
              onRemove={() => onChange(removeHopAt(query, path))}
            />
          ) : (
            <Typography variant="body2" color="text.secondary" fontStyle="italic" sx={SLOT_SX}>
              {hop.negate ? `${t("inventory:queryView.hasNo")} ${verb}` : verb}
            </Typography>
          )}
        </Box>
      )}
      <Box
        data-testid="query-path-card"
        sx={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start" }}
      >
        {onChange && !hop ? (
          <StartTypeChip
            typeKey={typeKey}
            types={offered}
            onPick={(key) => onChange(setStartType(query, key))}
          />
        ) : (
          <TypeChip type={type} typeKey={typeKey} />
        )}
        {onChange && branchable && canBranch(query, path) && (
          <BranchButton query={query} path={path} typeKey={typeKey} onChange={onChange} />
        )}
      </Box>
      {!onChange &&
        items.map((c) => <Chip key={c.key} size="small" variant="outlined" label={c.label} />)}
      {onChange && typeKey && (
        <EditConditions
          type={type}
          typeKey={typeKey}
          where={node?.where}
          tagGroups={tagGroups}
          cardNames={cardNames}
          onOpen={onOpenCondition}
          onRemove={(kind) => onChange(removeCondition(query, path, kind))}
          onSetTags={(ids) =>
            onChange(
              ids.length > 0
                ? setCondition(query, path, "tags", ids)
                : removeCondition(query, path, "tags"),
            )
          }
          onAdd={(anchor, kind) => {
            onChange(setCondition(query, path, kind, []));
            onOpenCondition(anchor, kind);
          }}
        />
      )}
    </Box>
  );
}

/** The large circled plus that opens a branch (`query-path-branch*`). */
function PlusButton({
  label,
  testId,
  onClick,
}: {
  label: string;
  testId: string;
  onClick: (anchor: HTMLElement) => void;
}) {
  return (
    <Tooltip title={label}>
      <IconButton
        size="small"
        aria-label={label}
        data-testid={testId}
        onClick={(e) => onClick(e.currentTarget)}
        color="primary"
        sx={{ p: 0, mt: 0.25 }}
      >
        <MaterialSymbol icon="add_circle" size={24} />
      </IconButton>
    </Tooltip>
  );
}

/**
 * The circled plus under a card of the bottom line that already has a hop:
 * AND or OR, then the relation; the branch opens a new line below. A card
 * with no hop shows none (`canBranch`) — its first hop is the `+ relation`
 * chip's — and neither does a card on a line above the bottom one.
 */
function BranchButton({
  query,
  path,
  typeKey,
  onChange,
}: {
  query: CardQuery;
  path: NodePath;
  typeKey: string;
  onChange: (query: CardQuery) => void;
}) {
  const { t } = useTranslation("inventory");
  const options = useRelationOptions(typeKey);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [step, setStep] = useState<"connective" | Connective>("connective");
  if (options.length === 0) return null;
  const close = () => setAnchor(null);
  const choose = (connective: Connective) => setStep(connective);
  return (
    <>
      <PlusButton
        label={t("queryView.addBranch")}
        testId="query-path-branch"
        onClick={(el) => {
          setStep("connective");
          setAnchor(el);
        }}
      />
      <Menu anchorEl={anchor} open={anchor != null && step === "connective"} onClose={close}>
        <MenuItem disabled={!canBranch(query, path, "and")} onClick={() => choose("and")}>
          {t("queryView.connectiveAnd")}
        </MenuItem>
        <MenuItem disabled={!canBranch(query, path, "or")} onClick={() => choose("or")}>
          {t("queryView.connectiveOr")}
        </MenuItem>
      </Menu>
      <RelationMenu
        anchor={anchor != null && step !== "connective" ? anchor : null}
        options={options}
        onClose={close}
        onPick={(relation, type) => {
          close();
          if (step !== "connective") onChange(addBranch(query, path, step, relation, type));
        }}
      />
    </>
  );
}

/**
 * The circled plus under the bottom line's AND / OR badge: another branch
 * from the same card with the same operator (A OR B OR C), straight to the
 * relation menu. Hidden once the group or the tree is full (`canBranch`).
 */
function SiblingBranchButton({
  query,
  path,
  connective,
  onChange,
}: {
  query: CardQuery;
  /** The card the line branches from. */
  path: NodePath;
  connective: Connective;
  onChange: (query: CardQuery) => void;
}) {
  const { t } = useTranslation("inventory");
  const options = useRelationOptions(nodeAt(query, path)?.type ?? "");
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (options.length === 0 || !canBranch(query, path, connective)) return null;
  return (
    <>
      <PlusButton
        label={t(connective === "and" ? "queryView.addBranchAnd" : "queryView.addBranchOr")}
        testId="query-path-branch-sibling"
        onClick={setAnchor}
      />
      <RelationMenu
        anchor={anchor}
        options={options}
        onClose={() => setAnchor(null)}
        onPick={(relation, type) => onChange(addBranch(query, path, connective, relation, type))}
      />
    </>
  );
}

function useMenu() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return {
    anchor,
    open: (e: MouseEvent<HTMLElement>) => setAnchor(e.currentTarget),
    close: () => setAnchor(null),
  };
}

function StartTypeChip({
  typeKey,
  types,
  onPick,
}: {
  typeKey: string;
  types: CardType[];
  onPick: (key: string) => void;
}) {
  const { t, i18n } = useTranslation("inventory");
  const typeLabel = useTypeLabel();
  const menu = useMenu();
  const type = types.find((ct) => ct.key === typeKey);
  const sorted = useMemo(
    () => [...types].sort((a, b) => typeLabel(a).localeCompare(typeLabel(b), i18n.language)),
    [types, typeLabel, i18n.language],
  );
  return (
    <>
      <Chip
        size="small"
        variant="outlined"
        data-testid="query-path-start-type"
        label={typeKey ? typeLabel(type) || typeKey : t("queryView.chooseType")}
        icon={
          type ? (
            <MaterialSymbol icon={type.icon} size={16} color={type.color} />
          ) : (
            <MaterialSymbol icon="category" size={16} />
          )
        }
        onClick={menu.open}
        sx={{ fontWeight: 600, borderColor: type?.color, "& .MuiChip-icon": { ml: 0.5 } }}
      />
      <Menu anchorEl={menu.anchor} open={menu.anchor != null} onClose={menu.close}>
        {sorted.map((ct) => (
          <MenuItem
            key={ct.key}
            selected={ct.key === typeKey}
            onClick={() => {
              menu.close();
              onPick(ct.key);
            }}
          >
            <ListItemIcon>
              <MaterialSymbol icon={ct.icon} size={18} color={ct.color} />
            </ListItemIcon>
            <ListItemText>{typeLabel(ct)}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

function VerbChip({
  verb,
  negate,
  onToggleNegate,
  onRemove,
}: {
  verb: string;
  negate: boolean;
  onToggleNegate: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation("inventory");
  const menu = useMenu();
  return (
    <>
      <Chip
        size="small"
        variant="outlined"
        data-testid="query-path-verb"
        label={negate ? `${t("queryView.hasNo")} ${verb}` : verb}
        onClick={menu.open}
        sx={{ fontStyle: "italic", borderStyle: "dashed" }}
      />
      <Menu anchorEl={menu.anchor} open={menu.anchor != null} onClose={menu.close}>
        <MenuItem
          onClick={() => {
            menu.close();
            onToggleNegate();
          }}
        >
          <ListItemIcon>
            <Checkbox size="small" checked={negate} sx={{ p: 0 }} tabIndex={-1} />
          </ListItemIcon>
          <ListItemText>{t("queryView.hasNo")}</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            menu.close();
            onRemove();
          }}
        >
          <ListItemIcon>
            <MaterialSymbol icon="delete" size={18} />
          </ListItemIcon>
          <ListItemText>{t("queryView.removeHop")}</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}

/** A relation a hop can follow, with its menu label and the type it reaches. */
interface RelationOption extends RelationChoice {
  label: string;
  other: CardType;
}

/** Every visible relation a node of `fromType` can follow to a readable, visible type. */
function useRelationOptions(fromType: string): RelationOption[] {
  const { i18n } = useTranslation();
  const typeLabel = useTypeLabel();
  const { relationTypes } = useMetamodel();
  const readable = useReadableCardTypes();
  return relationChoices(
    fromType,
    relationTypes.filter((rt) => !rt.is_hidden),
  ).flatMap((c) => {
    const other = readable.find((ct) => ct.key === c.otherType && !ct.is_hidden);
    if (!other) return [];
    const verb = relationLabel(c.rt, i18n.language, !c.isSource);
    return [{ ...c, label: `${verb} ${typeLabel(other)}`, other }];
  });
}

/** The relation chooser the `+ relation` chip and the branch plus share. */
function RelationMenu({
  anchor,
  options,
  onClose,
  onPick,
}: {
  anchor: HTMLElement | null;
  options: RelationOption[];
  onClose: () => void;
  onPick: (relation: string, type: string) => void;
}) {
  return (
    <Menu anchorEl={anchor} open={anchor != null} onClose={onClose}>
      {options.map((c) => (
        <MenuItem
          key={`${c.key}-${c.isSource}`}
          onClick={() => {
            onClose();
            onPick(c.key, c.otherType);
          }}
        >
          <ListItemIcon>
            <MaterialSymbol icon={c.other.icon} size={18} color={c.other.color} />
          </ListItemIcon>
          <ListItemText>{c.label}</ListItemText>
        </MenuItem>
      ))}
    </Menu>
  );
}

function AddHopChip({
  fromType,
  onPick,
}: {
  fromType: string;
  onPick: (relation: string, type: string) => void;
}) {
  const { t } = useTranslation("inventory");
  const menu = useMenu();
  const options = useRelationOptions(fromType);
  if (options.length === 0) return null;
  return (
    <>
      <Chip
        size="small"
        variant="outlined"
        data-testid="query-path-add-hop"
        label={t("queryView.addRelation")}
        icon={<MaterialSymbol icon="add" size={16} />}
        onClick={menu.open}
        sx={{ borderStyle: "dashed" }}
      />
      <RelationMenu anchor={menu.anchor} options={options} onClose={menu.close} onPick={onPick} />
    </>
  );
}

function EditConditions({
  type,
  typeKey,
  where,
  tagGroups,
  cardNames,
  onOpen,
  onRemove,
  onSetTags,
  onAdd,
}: {
  type: CardType | undefined;
  typeKey: string;
  where: CardQueryWhere | undefined;
  tagGroups: TagGroup[];
  cardNames: Map<string, CardNameEntry>;
  onOpen: (anchor: HTMLElement, kind: ConditionKind) => void;
  onRemove: (kind: ConditionKind) => void;
  onSetTags: (ids: string[]) => void;
  onAdd: (anchor: HTMLElement, kind: ConditionKind) => void;
}) {
  const { t } = useTranslation(["inventory", "common"]);
  const fieldLabel = useFieldLabel();
  const items = useConditionItems(type, where, tagGroups, cardNames);
  const menu = useMenu();

  const taken = new Set(items.map((c) => kindKey(c.kind)));
  const offers: { kind: ConditionKind; label: string }[] = [];
  const offer = (kind: ConditionKind, label: string) => {
    if (!taken.has(kindKey(kind))) offers.push({ kind, label });
  };
  // "Specific cards" leads the menu, set apart by a divider from the
  // condition kinds that filter on a card's own values.
  offer("cards", t("inventory:queryView.conditionCards"));
  const cardsLeads = offers.length === 1;
  offer("lifecycle_phase", t("inventory:filter.lifecycle"));
  if ((type?.subtypes ?? []).length > 0) offer("subtype", t("common:labels.subtype"));
  offer("approval_status", t("inventory:columns.approvalStatus"));
  offer("data_quality_band", t("inventory:filter.dataQuality"));
  if (tagGroups.some((g) => g.tags.length > 0 && tagGroupApplies(g, typeKey))) {
    offer("tags", t("inventory:filter.tags"));
  }
  for (const f of pickFacetFields(type?.fields_schema ?? [])) {
    offer({ attribute: f.key }, fieldLabel(f));
  }

  return (
    <>
      {items.map((c) => (
        <Chip
          key={c.key}
          size="small"
          variant="outlined"
          label={c.label}
          onClick={(e) => onOpen(e.currentTarget, c.kind)}
          onDelete={() => {
            if (c.kind === "tags" && c.tagIds && c.tagIds.length > 0) {
              const drop = new Set(c.tagIds);
              onSetTags((where?.tags ?? []).filter((id) => !drop.has(id)));
            } else {
              onRemove(c.kind);
            }
          }}
        />
      ))}
      {/* Kept while nothing is left to add: the editor of the condition
          just added is anchored to it. */}
      <Chip
        size="small"
        variant="outlined"
        data-testid="query-path-add-condition"
        label={t("inventory:queryView.addCondition")}
        icon={<MaterialSymbol icon="filter_alt" size={16} />}
        onClick={menu.open}
        disabled={offers.length === 0}
        sx={{ borderStyle: "dashed" }}
      />
      <Menu anchorEl={menu.anchor} open={menu.anchor != null} onClose={menu.close}>
        {offers.flatMap((o, i) => {
          const item = (
            <MenuItem
              key={kindKey(o.kind)}
              onClick={() => {
                const anchor = menu.anchor;
                menu.close();
                if (anchor) onAdd(anchor, o.kind);
              }}
            >
              {o.label}
            </MenuItem>
          );
          return i === 0 && cardsLeads && offers.length > 1
            ? [item, <Divider key="cards-divider" />]
            : [item];
        })}
      </Menu>
    </>
  );
}
