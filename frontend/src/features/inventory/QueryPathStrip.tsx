import { useMemo, useState, type MouseEvent } from "react";
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

/**
 * The strip above the inventory grid while a query view is applied or being
 * built. In view mode it names the view and reads the query as a grid of
 * rows — each card type with its conditions, then per hop an arrow, the
 * relation verb read from the side under view, and the next type; a branch
 * ("and" / "or") is a row of its own starting under the card it hangs from.
 * In edit mode the same grid becomes the builder: the start type, each verb
 * and each condition is a chip that opens its editor, a circled plus under a
 * card adds a branch, and the grid below is the live preview.
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

/**
 * The strip never grows past its container: the grid scrolls sideways on its
 * own (`query-path-grid`), so the header row above it — title, Save, Cancel,
 * ×, pencil — stays on screen however wide the query gets.
 */
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
      <QueryGrid query={view.query} tagGroups={tagGroups} cardNames={cardNames} />
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
      <QueryGrid
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

/**
 * The query as a grid: one grid row per branch row, one column per depth.
 * A cell stacks a node's connector (connective, arrow, verb), its type chip,
 * its conditions and — in edit mode — its `+ condition` chip and branch plus.
 * A branch row leaves its parent's columns empty but for a faint corner arrow
 * in the parent's column. Editable when `onChange` is given.
 */
function QueryGrid({
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
  const { types } = useMetamodel();
  const isRtl = useIsRtl();
  const readable = useReadableCardTypes();
  // The start chip's type menu: edit mode only, worked out once for the grid.
  const editing = !!onChange;
  const offered = useMemo(
    () => (editing ? readable.filter((ct) => !ct.is_hidden) : []),
    [editing, readable],
  );
  const [open, setOpen] = useState<OpenCondition | null>(null);
  const allRows = rows(query);
  const appendable = allRows.map((row) => !!onChange && rowAppendable(query, row));
  const columns = Math.max(
    ...allRows.map((row, r) => row.depth + row.nodes.length + (appendable[r] ? 1 : 0)),
  );

  const openNode = open ? nodeAt(query, open.path) : undefined;
  const closeCondition = () => {
    if (open && openNode && onChange && conditionValues(openNode.where, open.kind)?.length === 0) {
      onChange(removeCondition(query, open.path, open.kind));
    }
    setOpen(null);
  };

  return (
    <Box
      data-testid="query-path-grid"
      sx={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, max-content)`,
        columnGap: 1.5,
        rowGap: 1,
        alignItems: "start",
        overflowX: "auto",
        maxWidth: "100%",
      }}
    >
      {allRows.map((row, r) => {
        const gridRow = r + 1;
        const last = row.nodes[row.nodes.length - 1];
        return (
          <Box key={pathKey(row.nodes[0].path)} data-testid="query-path-row" sx={{ display: "contents" }}>
            {row.parentPath && (
              <Box
                data-testid="query-path-branch-marker"
                sx={{ gridRow, gridColumn: row.depth, color: "text.disabled", pt: 0.25 }}
              >
                <MaterialSymbol
                  icon="subdirectory_arrow_right"
                  size={18}
                  style={{ transform: isRtl ? "scaleX(-1)" : undefined }}
                />
              </Box>
            )}
            {row.nodes.map((rn, i) => {
              const prev = i > 0 ? row.nodes[i - 1].path : row.parentPath;
              const fromType = prev ? (nodeAt(query, prev)?.type ?? "") : "";
              return (
                <NodeCell
                  key={pathKey(rn.path)}
                  query={query}
                  path={rn.path}
                  fromType={fromType}
                  connective={i === 0 ? row.connective : null}
                  gridRow={gridRow}
                  gridColumn={row.depth + i + 1}
                  offered={offered}
                  tagGroups={tagGroups}
                  cardNames={cardNames}
                  onChange={onChange}
                  onOpenCondition={(anchor, kind) => setOpen({ anchor, path: rn.path, kind })}
                />
              );
            })}
            {appendable[r] && onChange && (
              <Box sx={{ gridRow, gridColumn: row.depth + row.nodes.length + 1 }}>
                <AddHopChip
                  fromType={nodeAt(query, last.path)?.type ?? ""}
                  onPick={(relation, type) => onChange(appendHopAt(query, last.path, relation, type))}
                />
              </Box>
            )}
          </Box>
        );
      })}
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

/** The height of a connector line, so every type chip of a grid row lines up. */
const CONNECTOR_HEIGHT = 24;

/** One node of the grid: its connector, its type, its conditions and (editing) its plus. */
function NodeCell({
  query,
  path,
  fromType,
  connective,
  gridRow,
  gridColumn,
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
  /** "and" / "or" before a branch row's first hop. */
  connective: Connective | null;
  gridRow: number;
  gridColumn: number;
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
      sx={{
        gridRow,
        gridColumn,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 0.5,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minHeight: CONNECTOR_HEIGHT }}>
        {connective && (
          <Typography variant="body2" color="text.secondary">
            {t(`inventory:queryView.${connective}`)}
          </Typography>
        )}
        {hop && <Arrow />}
        {hop &&
          (onChange ? (
            <VerbChip
              verb={verb}
              negate={!!hop.negate}
              onToggleNegate={() => onChange(toggleNegate(query, path))}
              onRemove={() => onChange(removeHopAt(query, path))}
            />
          ) : (
            <Typography variant="body2" color="text.secondary" fontStyle="italic">
              {hop.negate ? `${t("inventory:queryView.hasNo")} ${verb}` : verb}
            </Typography>
          ))}
      </Box>
      {onChange && !hop ? (
        <StartTypeChip
          typeKey={typeKey}
          types={offered}
          onPick={(key) => onChange(setStartType(query, key))}
        />
      ) : (
        <TypeChip type={type} typeKey={typeKey} />
      )}
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
      {onChange && canBranch(query, path) && (
        <BranchButton query={query} path={path} typeKey={typeKey} onChange={onChange} />
      )}
    </Box>
  );
}

/**
 * The circled plus under a card that already has a hop: "And also…" /
 * "Or…", then the relation. A card with no hop shows none (`canBranch`) —
 * its first hop is the `+ relation` chip's.
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
      <Tooltip title={t("queryView.addBranch")}>
        <IconButton
          size="small"
          aria-label={t("queryView.addBranch")}
          data-testid="query-path-branch"
          onClick={(e) => {
            setStep("connective");
            setAnchor(e.currentTarget);
          }}
          sx={{ p: 0.25 }}
        >
          <MaterialSymbol icon="add_circle" size={18} />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={anchor != null && step === "connective"} onClose={close}>
        <MenuItem disabled={!canBranch(query, path, "and")} onClick={() => choose("and")}>
          {t("queryView.branchAnd")}
        </MenuItem>
        <MenuItem disabled={!canBranch(query, path, "or")} onClick={() => choose("or")}>
          {t("queryView.branchOr")}
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
