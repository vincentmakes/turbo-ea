import { Fragment, useMemo, useState, type MouseEvent, type ReactNode } from "react";
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
import { alpha, darken } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import OriginChip from "@/components/OriginChip";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useIsRtl } from "@/hooks/useIsRtl";
import { useReadableCardTypes } from "@/hooks/useReadableCardTypes";
import {
  useFieldLabel,
  useOptionLabel,
  useSubtypeLabel,
  useTypeLabel,
} from "@/hooks/useResolveLabel";
import { DATA_QUALITY_BANDS } from "@/lib/dataQualityBands";
import { EOL_STATUSES, EOL_STATUS_LABEL_KEYS, typeTracksEol } from "@/lib/eol";
import { getPhaseLabels } from "@/lib/lifecyclePhases";
import { pickFacetFields } from "@/lib/fieldFacets";
import { readableTextColor } from "@/lib/color";
import type {
  ActiveQuery,
  CardQuery,
  CardQueryHop,
  CardQuerySet,
  CardQueryWhere,
  CardType,
  FieldDef,
  QueryDraft,
  RelationType,
  TagGroup,
} from "@/types";
import { APPROVAL_STATUS_OPTIONS, EMPTY_VALUE } from "./InventoryFilterSidebar";
import { hopRelationType, hopVerb } from "./queryPath";
import { relationSideLabel } from "./relationColumns";
import QueryConditionPopover from "./QueryConditionPopover";
import {
  MAX_CHAIN_DEPTH,
  appendHop,
  cardsChipLabel,
  chainNodes,
  conditionValues,
  relationChoices,
  removeCondition,
  removeHopAt,
  setCondition,
  setIncludeDescendants,
  setStartType,
  tagChipsByGroup,
  toggleNegate,
  type ConditionKind,
} from "./queryDraft";
import {
  addLine,
  canAddHop,
  canAddLine,
  isSetLevelProblem,
  lineCount,
  linesOf,
  matchKeyAt,
  pickedCardIdsOf,
  removeLine,
  setProblem,
  updateLine,
  type LineConnective,
  type QueryLine,
} from "./querySet";
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
  /** The code the card list refused the query in force (or the draft) with
   *  (`eol_view_required`); shown under the lines in both modes. */
  queryError?: string | null;
  /** May the user see end-of-life status (`eol.view`)? Offers the EOL condition. */
  canViewEol?: boolean;
  /** View mode: the steps (`matchNodes` keys) whose matched cards show in a column. */
  matchedKeys?: readonly string[];
  /**
   * View mode: switches a step's matched-cards column on or off. Given, every
   * card type pill after the first of its line (and not behind "has no")
   * becomes a toggle; edit mode never offers it.
   */
  onToggleMatched?: (key: string) => void;
}

/** The pills of one line of a view that switch a matched-cards column. */
interface PillSwitches {
  /** The line's place among all the query's lines. */
  line: number;
  /** The key of the node at a place in the line (`matchKeyAt`), null for none. */
  keyAt: (line: number, indices: readonly number[]) => string | null;
  pressed: readonly string[];
  onToggle: (key: string) => void;
}

const NOOP = () => {};
const NO_KEYS: readonly string[] = [];
const NO_INDICES: readonly number[] = [];

/**
 * The strip above the inventory grid while a query view is applied or being
 * built. In view mode it names the view and reads the chain as a path — each
 * card type with its conditions, then per hop an arrow, the relation verb
 * read from the side under view, and the next type. In edit mode the same
 * path becomes the builder: the start type, each verb and each condition is a
 * chip that opens its editor, and the grid below is the live preview.
 */
export default function QueryPathStrip({
  view,
  draft = null,
  canEdit = false,
  tagGroups = [],
  onLeave,
  onEdit = NOOP,
  onDraftChange = NOOP,
  onSave = NOOP,
  onCancel = NOOP,
  saving = false,
  error = null,
  queryError = null,
  canViewEol = false,
  matchedKeys = NO_KEYS,
  onToggleMatched,
}: Props) {
  // Picked cards are named once for the whole strip, every line and node at once.
  const cardNames = useCardNames(pickedCardIdsOf(draft?.query ?? view?.query ?? { type: "" }));
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
        error={error ?? queryError}
        canViewEol={canViewEol}
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
      error={queryError}
      matchedKeys={matchedKeys}
      onToggleMatched={onToggleMatched}
    />
  );
}

const STRIP_SX = {
  mb: 1,
  px: 1.5,
  py: 1,
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  gap: 0.75,
} as const;
const ROW_SX = { display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" } as const;
const BADGE_SX = { height: 20, fontSize: 11, fontWeight: 700, letterSpacing: 0.5 } as const;

/**
 * The query's lines one below the other: an AND badge on its own row between
 * the lines of a group, a divider carrying an OR badge between groups, and
 * `groupEnd` (edit mode's plus) under each group's last line. A plain query
 * is one line with neither.
 */
function LineStack({
  query,
  lineKeys,
  renderLine,
  lineEnd,
  groupEnd,
}: {
  query: CardQuerySet;
  /** A stable key per line, in reading order (edit mode); else lines are keyed by place. */
  lineKeys?: string[];
  /** One line's chips; `index` is the line's place among all lines. */
  renderLine: (line: QueryLine, index: number) => ReactNode;
  /** Beside the line, outside its wrapping chips (edit mode's ×). */
  lineEnd?: (line: QueryLine) => ReactNode;
  groupEnd?: (group: number) => ReactNode;
}) {
  const { t } = useTranslation("inventory");
  const lines = linesOf(query);
  return (
    <>
      {lines.map((l, k) => (
        <Fragment key={lineKeys?.[k] ?? `${l.group}-${l.line}`}>
          {l.connective === "and" && (
            <Box data-testid="query-line-and">
              <Chip size="small" color="primary" label={t("queryView.connectiveAnd")} sx={BADGE_SX} />
            </Box>
          )}
          {l.connective === "or" && (
            <Divider data-testid="query-group-or" sx={{ my: 0.5 }}>
              <Chip size="small" color="secondary" label={t("queryView.connectiveOr")} sx={BADGE_SX} />
            </Divider>
          )}
          <Box data-testid="query-line" sx={{ display: "flex", alignItems: "flex-start", gap: 0.5 }}>
            <Box sx={{ ...ROW_SX, flex: 1, minWidth: 0 }}>{renderLine(l, k)}</Box>
            {lineEnd?.(l)}
          </Box>
          {groupEnd && lines[k + 1]?.group !== l.group && groupEnd(l.group)}
        </Fragment>
      ))}
    </>
  );
}

function ViewStrip({
  view,
  canEdit,
  tagGroups,
  cardNames,
  onLeave,
  onEdit,
  error,
  matchedKeys,
  onToggleMatched,
}: {
  view: ActiveQuery;
  canEdit: boolean;
  tagGroups: TagGroup[];
  cardNames: Map<string, CardNameEntry>;
  onLeave: () => void;
  onEdit: () => void;
  error: string | null;
  matchedKeys: readonly string[];
  onToggleMatched?: (key: string) => void;
}) {
  const { t } = useTranslation(["inventory", "common"]);
  const { types, relationTypes } = useMetamodel();
  // Every pill's key comes from `matchNodes`, the numbering the page and the
  // server use, never from a count kept here.
  const keyAt = useMemo(() => matchKeyAt(view.query), [view.query]);
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
      <LineStack
        query={view.query}
        renderLine={({ query }, index) => (
          <QueryNode
            typeKey={query.type}
            where={query.where}
            hops={query.related ?? []}
            types={types}
            relationTypes={relationTypes}
            tagGroups={tagGroups}
            cardNames={cardNames}
            switches={
              onToggleMatched
                ? { line: index, keyAt, pressed: matchedKeys, onToggle: onToggleMatched }
                : undefined
            }
            indices={NO_INDICES}
          />
        )}
      />
      {error && <StripError code={error} />}
    </Paper>
  );
}

/** A refusal code read out under the lines (`queryView.error.<code>`). */
function StripError({ code }: { code: string }) {
  const { t } = useTranslation("inventory");
  return (
    <Typography variant="caption" color="error" role="alert" data-testid="query-path-error">
      {t(`queryView.error.${code}`, { defaultValue: code })}
    </Typography>
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

function TypeChip({
  type,
  typeKey,
  switchKey = null,
  pressed = false,
  onToggle,
}: {
  type: CardType | undefined;
  typeKey: string;
  /** The step's `matchNodes` key when the pill switches its matched-cards column. */
  switchKey?: string | null;
  pressed?: boolean;
  onToggle?: (key: string) => void;
}) {
  const { t } = useTranslation("inventory");
  const typeLabel = useTypeLabel();
  const label = typeLabel(type) || typeKey;
  if (!switchKey || !onToggle) {
    return (
      <Chip
        size="small"
        variant="outlined"
        label={label}
        icon={type ? <MaterialSymbol icon={type.icon} size={16} color={type.color} /> : undefined}
        sx={{ fontWeight: 600, borderColor: type?.color, "& .MuiChip-icon": { ml: 0.5 } }}
      />
    );
  }
  // A switch: outlined as any pill while off (with a pointer and a hover
  // tint), filled in its type colour with a column icon while on. The name
  // is explicit so the icons' ligature text never enters it.
  const color = type?.color;
  const contrast = color ? readableTextColor(color) : undefined;
  const hover = pressed
    ? { bgcolor: color ? darken(color, 0.12) : "action.selected" }
    : { bgcolor: color ? alpha(color, 0.12) : "action.hover" };
  return (
    <Tooltip
      title={pressed ? t("queryMatches.pillHideHint") : t("queryMatches.pillShowHint")}
      describeChild
    >
      <Chip
        size="small"
        variant={pressed ? "filled" : "outlined"}
        clickable
        onClick={() => onToggle(switchKey)}
        aria-pressed={pressed}
        aria-label={
          pressed
            ? t("queryMatches.pillHideLabel", { type: label })
            : t("queryMatches.pillShowLabel", { type: label })
        }
        data-testid="query-path-match-switch"
        data-match-key={switchKey}
        data-pressed={String(pressed)}
        label={
          pressed ? (
            <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
              {label}
              <MaterialSymbol icon="view_column" size={14} />
            </Box>
          ) : (
            label
          )
        }
        icon={
          type ? (
            <MaterialSymbol icon={type.icon} size={16} color={pressed ? contrast : type.color} />
          ) : undefined
        }
        sx={{
          fontWeight: 600,
          cursor: "pointer",
          border: 1,
          borderColor: color ?? "divider",
          ...(pressed ? { bgcolor: color, color: contrast } : {}),
          "& .MuiChip-icon": { ml: 0.5, ...(pressed ? { color: contrast } : {}) },
          "&:hover, &.MuiChip-clickable:hover": hover,
          "&.Mui-focusVisible": hover,
        }}
      />
    </Tooltip>
  );
}

function QueryNode({
  typeKey,
  where,
  hops,
  types,
  relationTypes,
  tagGroups,
  cardNames,
  switches,
  indices,
}: {
  typeKey: string;
  where?: CardQueryWhere;
  hops: CardQueryHop[];
  types: CardType[];
  relationTypes: RelationType[];
  tagGroups: TagGroup[];
  cardNames: Map<string, CardNameEntry>;
  /** The line's pill switches (view mode only). */
  switches?: PillSwitches;
  /** The node's place in its line (`[]` for the line's first card); its
   *  key, if any, comes from `switches.keyAt`. */
  indices?: readonly number[];
}) {
  const type = types.find((ct) => ct.key === typeKey);
  const items = useConditionItems(type, where, tagGroups, cardNames);
  const switchKey = switches && indices ? switches.keyAt(switches.line, indices) : null;
  return (
    <>
      <TypeChip
        type={type}
        typeKey={typeKey}
        switchKey={switchKey}
        pressed={switchKey != null && !!switches?.pressed.includes(switchKey)}
        onToggle={switches?.onToggle}
      />
      {items.map((c) => (
        <Chip key={c.key} size="small" variant="outlined" label={c.label} />
      ))}
      <ReadOnlyHops
        fromType={typeKey}
        hops={hops}
        types={types}
        relationTypes={relationTypes}
        tagGroups={tagGroups}
        cardNames={cardNames}
        switches={switches}
        parentIndices={indices}
      />
    </>
  );
}

/** Hops rendered as text: an arrow, the verb, the nested node; siblings joined by "and". */
function ReadOnlyHops({
  fromType,
  hops,
  types,
  relationTypes,
  tagGroups,
  cardNames,
  leadingAnd = false,
  switches,
  parentIndices,
}: {
  fromType: string;
  hops: CardQueryHop[];
  types: CardType[];
  relationTypes: RelationType[];
  tagGroups: TagGroup[];
  cardNames: Map<string, CardNameEntry>;
  /** Join the first hop with "and" too (hops beside a chain hop). */
  leadingAnd?: boolean;
  /** The line's pill switches (view mode only). */
  switches?: PillSwitches;
  /** The place of the node these hops leave (`[]` for the line's first card). */
  parentIndices?: readonly number[];
}) {
  const { t, i18n } = useTranslation(["inventory", "common"]);
  return (
    <>
      {hops.map((hop, i) => {
        const rt = hopRelationType(hop, relationTypes);
        const verb = hopVerb(rt, fromType, i18n.language, hop.relation) || hop.relation;
        return (
          <Fragment key={`${hop.relation}-${hop.type}-${i}`}>
            {(i > 0 || leadingAnd) && (
              <Typography variant="body2" color="text.secondary">
                {t("inventory:queryView.and")}
              </Typography>
            )}
            <Box data-testid="query-path-hop" sx={{ display: "contents" }}>
              <Arrow />
              <Typography variant="body2" color="text.secondary" fontStyle="italic">
                {hop.negate ? `${t("inventory:queryView.hasNo")} ${verb}` : verb}
              </Typography>
              <QueryNode
                typeKey={hop.type}
                where={hop.where}
                hops={hop.related ?? []}
                types={types}
                relationTypes={relationTypes}
                tagGroups={tagGroups}
                cardNames={cardNames}
                switches={switches}
                indices={parentIndices && [...parentIndices, i]}
              />
            </Box>
          </Fragment>
        );
      })}
    </>
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

const isEolStatus = (k: string) => (EOL_STATUSES as readonly string[]).includes(k);

/** The condition chips of a node: `label: value, value` (`label` alone while still empty). */
function useConditionItems(
  type: CardType | undefined,
  where: CardQueryWhere | undefined,
  tagGroups: TagGroup[],
  cardNames: Map<string, CardNameEntry>,
): ConditionItem[] {
  const { t } = useTranslation(["inventory", "common", "reports"]);
  const fieldLabel = useFieldLabel();
  const optLabel = useOptionLabel();
  const stLabel = useSubtypeLabel();
  if (!where) return [];
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
  if (where.eol_status) {
    const values = where.eol_status.map((k) => {
      if (k === EMPTY_VALUE) return empty;
      // Only the four statuses the grammar takes; anything else reads as it is.
      return isEolStatus(k) ? t(`reports:${EOL_STATUS_LABEL_KEYS[k]}`) : k;
    });
    items.push({
      key: "eol",
      kind: "eol_status",
      label: labelOf(t("inventory:filter.eol"), values),
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
  canViewEol,
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
  canViewEol: boolean;
}) {
  const { t } = useTranslation(["inventory", "common"]);
  const problem = setProblem(draft.query);
  const set = draft.query;
  const onChange = (query: CardQuerySet) => onDraftChange({ ...draft, query });
  const lineIds = useLineIds(lineCount(set));
  const removable = lineCount(set) > 1;
  // A refused save says why; otherwise what the set breaks as a whole (an
  // MCP-written view opened here can), never a line still being filled in.
  const shownError = error ?? (isSetLevelProblem(problem) ? problem : null);
  const hopsLeft = canAddHop(set);
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
      <LineStack
        query={set}
        lineKeys={lineIds.ids}
        renderLine={(l) => (
          <EditChain
            query={l.query}
            start={l.fixedType ? "fixed" : l.typeLocked ? "locked" : "choose"}
            canAddHop={hopsLeft}
            tagGroups={tagGroups}
            cardNames={cardNames}
            canViewEol={canViewEol}
            onChange={(q) => onChange(updateLine(set, l.group, l.line, q))}
          />
        )}
        lineEnd={(l) =>
          removable && (
            <IconButton
              size="small"
              aria-label={t("inventory:queryView.removeLine")}
              data-testid="query-line-remove"
              onClick={() => {
                lineIds.remove(flatIndex(set, l.group, l.line));
                onChange(removeLine(set, l.group, l.line));
              }}
              sx={{ p: 0.25 }}
            >
              <MaterialSymbol icon="close" size={18} />
            </IconButton>
          )
        }
        groupEnd={(group) =>
          canAddLine(set) && (
            <AddLineButton
              key={`add-${group}`}
              canAnd={!!linesOf(set).find((l) => l.group === group)?.query.type}
              onPick={(connective) => {
                const next = addLine(set, group, connective);
                if (next === set) return;
                // Both connectives put the new line right after the group's last.
                lineIds.insert(afterGroup(set, group));
                onChange(next);
              }}
            />
          )
        }
      />
      {shownError && <StripError code={shownError} />}
    </Paper>
  );
}

let lineSeq = 0;
const newLineId = () => `line-${++lineSeq}`;

/** A line's place in reading order. */
function flatIndex(set: CardQuerySet, group: number, line: number): number {
  return linesOf(set).findIndex((l) => l.group === group && l.line === line);
}

/** The reading-order index just after a group's last line. */
function afterGroup(set: CardQuerySet, group: number): number {
  return linesOf(set).filter((l) => l.group <= group).length;
}

/**
 * A stable id per line, in reading order, so a removed line takes its own
 * editor state with it instead of handing it to the line that moves up. Ids
 * are made on mount and for an added line, dropped with a removed one, and
 * made afresh whenever the count no longer matches (Cancel, another view).
 */
function useLineIds(count: number) {
  const [kept, setKept] = useState<string[]>(() => Array.from({ length: count }, newLineId));
  const fallback = useMemo(() => Array.from({ length: count }, newLineId), [count]);
  const ids = kept.length === count ? kept : fallback;
  return {
    ids,
    insert: (at: number) => setKept([...ids.slice(0, at), newLineId(), ...ids.slice(at)]),
    remove: (at: number) => setKept(ids.filter((_, i) => i !== at)),
  };
}

const kindKey = (kind: ConditionKind) => (typeof kind === "object" ? `attr:${kind.attribute}` : kind);

interface OpenCondition {
  anchor: HTMLElement;
  index: number;
  kind: ConditionKind;
}

/** How a line's start chip behaves: a chooser, fixed (an AND line), or locked by AND lines. */
type StartMode = "choose" | "fixed" | "locked";

/** The circled plus under a group: AND adds a line to it, OR a group after it. */
function AddLineButton({
  canAnd,
  onPick,
}: {
  /** The group has a card type yet (an AND line starts from it). */
  canAnd: boolean;
  onPick: (connective: LineConnective) => void;
}) {
  const { t } = useTranslation("inventory");
  const menu = useMenu();
  const pick = (connective: LineConnective) => {
    menu.close();
    onPick(connective);
  };
  return (
    <Box>
      <IconButton
        color="primary"
        aria-label={t("queryView.addLine")}
        data-testid="query-add-line"
        onClick={menu.open}
        sx={{ p: 0.25 }}
      >
        <MaterialSymbol icon="add_circle" size={24} />
      </IconButton>
      <Menu anchorEl={menu.anchor} open={menu.anchor != null} onClose={menu.close}>
        <MenuItem disabled={!canAnd} onClick={() => pick("and")}>
          {t("queryView.connectiveAnd")}
        </MenuItem>
        <MenuItem onClick={() => pick("or")}>{t("queryView.connectiveOr")}</MenuItem>
      </Menu>
    </Box>
  );
}

function EditChain({
  query,
  start,
  canAddHop: hopsLeft,
  tagGroups,
  cardNames,
  canViewEol,
  onChange,
}: {
  query: CardQuery;
  start: StartMode;
  /** The set is under its relation cap: offer "+ Relation". */
  canAddHop: boolean;
  tagGroups: TagGroup[];
  cardNames: Map<string, CardNameEntry>;
  canViewEol: boolean;
  onChange: (query: CardQuery) => void;
}) {
  const { i18n } = useTranslation();
  const { types, relationTypes } = useMetamodel();
  const readable = useReadableCardTypes();
  const offered = useMemo(() => readable.filter((ct) => !ct.is_hidden), [readable]);
  const [open, setOpen] = useState<OpenCondition | null>(null);
  const nodes = chainNodes(query);
  const last = nodes.length - 1;

  const openNode = open ? nodes[open.index] : undefined;
  const closeCondition = () => {
    if (open && openNode && conditionValues(openNode.where, open.kind)?.length === 0) {
      onChange(removeCondition(query, open.index, open.kind));
    }
    setOpen(null);
  };

  return (
    <>
      {nodes.map((node, i) => {
        const type = types.find((ct) => ct.key === node.type);
        const prevType = i > 0 ? nodes[i - 1].type : "";
        const rt = node.relation ? hopRelationType({ relation: node.relation }, relationTypes) : undefined;
        const verb =
          (node.relation && hopVerb(rt, prevType, i18n.language, node.relation)) || node.relation || "";
        return (
          <Fragment key={i}>
            {i === 0 ? (
              <StartTypeChip
                typeKey={node.type}
                types={offered}
                mode={start}
                onPick={(key) => onChange(setStartType(query, key))}
              />
            ) : (
              <Box data-testid="query-path-hop" sx={{ display: "contents" }}>
                <Arrow />
                <VerbChip
                  verb={verb}
                  negate={!!node.negate}
                  onToggleNegate={() => onChange(toggleNegate(query, i))}
                  onRemove={() => onChange(removeHopAt(query, i))}
                />
                <TypeChip type={type} typeKey={node.type} />
              </Box>
            )}
            {node.type && (
              <EditConditions
                type={type}
                typeKey={node.type}
                where={node.where}
                tagGroups={tagGroups}
                cardNames={cardNames}
                canViewEol={canViewEol}
                onOpen={(anchor, kind) => setOpen({ anchor, index: i, kind })}
                onRemove={(kind) => onChange(removeCondition(query, i, kind))}
                onSetTags={(ids) =>
                  onChange(
                    ids.length > 0
                      ? setCondition(query, i, "tags", ids)
                      : removeCondition(query, i, "tags"),
                  )
                }
                onAdd={(anchor, kind) => {
                  onChange(setCondition(query, i, kind, []));
                  setOpen({ anchor, index: i, kind });
                }}
              />
            )}
            {node.extra && (
              <ReadOnlyHops
                fromType={node.type}
                hops={node.extra}
                types={types}
                relationTypes={relationTypes}
                tagGroups={tagGroups}
                cardNames={cardNames}
                leadingAnd
              />
            )}
            {i === last && node.type && last < MAX_CHAIN_DEPTH && hopsLeft && (
              <AddHopChip
                fromType={node.type}
                types={offered}
                relationTypes={relationTypes}
                onPick={(relation, type) => onChange(appendHop(query, relation, type))}
              />
            )}
          </Fragment>
        );
      })}
      {open && openNode && (
        <QueryConditionPopover
          anchorEl={open.anchor}
          onClose={closeCondition}
          type={types.find((ct) => ct.key === openNode.type)}
          kind={open.kind}
          values={conditionValues(openNode.where, open.kind) ?? []}
          tagGroups={tagGroups}
          cardNames={cardNames}
          includeDescendants={!!openNode.where?.include_descendants}
          onIncludeDescendantsChange={(on) => onChange(setIncludeDescendants(query, open.index, on))}
          onChange={(values) => onChange(setCondition(query, open.index, open.kind, values))}
        />
      )}
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
  mode,
  onPick,
}: {
  typeKey: string;
  types: CardType[];
  mode: StartMode;
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
  const chip = (
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
      onClick={mode === "choose" ? menu.open : undefined}
      disabled={mode === "locked"}
      sx={{
        fontWeight: 600,
        borderColor: type?.color,
        "& .MuiChip-icon": { ml: 0.5 },
        // Locked, not gone: the type still holds (as the sidebar's locked types).
        "&.Mui-disabled": { opacity: 0.7 },
      }}
    />
  );
  if (mode === "fixed") {
    return (
      <Tooltip title={t("queryView.sameCardHint")} describeChild>
        {chip}
      </Tooltip>
    );
  }
  if (mode === "locked") {
    // A disabled chip fires no events: the span carries the tooltip.
    return (
      <Tooltip title={t("queryView.typeLockedByAnd")} describeChild>
        <span data-testid="query-path-start-type-locked">{chip}</span>
      </Tooltip>
    );
  }
  return (
    <>
      {chip}
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

function AddHopChip({
  fromType,
  types,
  relationTypes,
  onPick,
}: {
  fromType: string;
  types: CardType[];
  relationTypes: RelationType[];
  onPick: (relation: string, type: string) => void;
}) {
  const { t, i18n } = useTranslation("inventory");
  const typeLabel = useTypeLabel();
  const menu = useMenu();
  const choices = relationChoices(
    fromType,
    relationTypes.filter((rt) => !rt.is_hidden),
  ).flatMap((c) => {
    const other = types.find((ct) => ct.key === c.otherType);
    if (!other) return [];
    return [
      { ...c, label: relationSideLabel(c.rt, c.isSource, typeLabel(other), i18n.language), other },
    ];
  });
  if (choices.length === 0) return null;
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
      <Menu anchorEl={menu.anchor} open={menu.anchor != null} onClose={menu.close}>
        {choices.map((c) => (
          <MenuItem
            key={`${c.key}-${c.isSource}`}
            onClick={() => {
              menu.close();
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
    </>
  );
}

function EditConditions({
  type,
  typeKey,
  where,
  tagGroups,
  cardNames,
  canViewEol,
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
  /** The user has `eol.view`: the EOL condition may be offered. */
  canViewEol: boolean;
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
  // End of life only where the type tracks it and the reader may see it —
  // the server refuses the condition otherwise.
  if (canViewEol && typeTracksEol(type)) offer("eol_status", t("inventory:filter.eol"));
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
