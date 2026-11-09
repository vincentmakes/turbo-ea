import { Fragment, useMemo, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
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
import { getPhaseLabels } from "@/lib/lifecyclePhases";
import { pickFacetFields } from "@/lib/fieldFacets";
import type {
  ActiveQuery,
  CardQuery,
  CardQueryHop,
  CardQueryWhere,
  CardType,
  FieldDef,
  QueryDraft,
  RelationType,
  TagGroup,
} from "@/types";
import { APPROVAL_STATUS_OPTIONS, EMPTY_VALUE } from "./InventoryFilterSidebar";
import { hopRelationType, hopVerb } from "./queryPath";
import QueryConditionPopover from "./QueryConditionPopover";
import {
  MAX_CHAIN_DEPTH,
  appendHop,
  cardsChipLabel,
  chainNodes,
  conditionValues,
  draftProblem,
  pickedCardIds,
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
  display: "flex",
  flexDirection: "column",
  gap: 0.75,
} as const;
const ROW_SX = { display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" } as const;

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
  const { types, relationTypes } = useMetamodel();
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
      <Box sx={ROW_SX}>
        <QueryNode
          typeKey={view.query.type}
          where={view.query.where}
          hops={view.query.related ?? []}
          types={types}
          relationTypes={relationTypes}
          tagGroups={tagGroups}
          cardNames={cardNames}
        />
      </Box>
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

function QueryNode({
  typeKey,
  where,
  hops,
  types,
  relationTypes,
  tagGroups,
  cardNames,
}: {
  typeKey: string;
  where?: CardQueryWhere;
  hops: CardQueryHop[];
  types: CardType[];
  relationTypes: RelationType[];
  tagGroups: TagGroup[];
  cardNames: Map<string, CardNameEntry>;
}) {
  const type = types.find((ct) => ct.key === typeKey);
  const items = useConditionItems(type, where, tagGroups, cardNames);
  return (
    <>
      <TypeChip type={type} typeKey={typeKey} />
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
}: {
  fromType: string;
  hops: CardQueryHop[];
  types: CardType[];
  relationTypes: RelationType[];
  tagGroups: TagGroup[];
  cardNames: Map<string, CardNameEntry>;
  /** Join the first hop with "and" too (hops beside a chain hop). */
  leadingAnd?: boolean;
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

/** The condition chips of a node: `label: value, value` (`label` alone while still empty). */
function useConditionItems(
  type: CardType | undefined,
  where: CardQueryWhere | undefined,
  tagGroups: TagGroup[],
  cardNames: Map<string, CardNameEntry>,
): ConditionItem[] {
  const { t } = useTranslation(["inventory", "common"]);
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
      <Box sx={ROW_SX}>
        <EditChain
          query={draft.query}
          tagGroups={tagGroups}
          cardNames={cardNames}
          onChange={onChange}
        />
      </Box>
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
  index: number;
  kind: ConditionKind;
}

function EditChain({
  query,
  tagGroups,
  cardNames,
  onChange,
}: {
  query: CardQuery;
  tagGroups: TagGroup[];
  cardNames: Map<string, CardNameEntry>;
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
            {i === last && node.type && last < MAX_CHAIN_DEPTH && (
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
    const verb = relationLabel(c.rt, i18n.language, !c.isSource);
    return [{ ...c, label: `${verb} ${typeLabel(other)}`, other }];
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
  offer("lifecycle_phase", t("inventory:filter.lifecycle"));
  if ((type?.subtypes ?? []).length > 0) offer("subtype", t("common:labels.subtype"));
  offer("approval_status", t("inventory:columns.approvalStatus"));
  if (tagGroups.some((g) => g.tags.length > 0 && tagGroupApplies(g, typeKey))) {
    offer("tags", t("inventory:filter.tags"));
  }
  offer("cards", t("inventory:queryView.conditionCards"));
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
        {offers.map((o) => (
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
        ))}
      </Menu>
    </>
  );
}
