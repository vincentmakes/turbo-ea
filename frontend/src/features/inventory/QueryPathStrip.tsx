import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import OriginChip from "@/components/OriginChip";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useIsRtl } from "@/hooks/useIsRtl";
import {
  useFieldLabel,
  useOptionLabel,
  useSubtypeLabel,
  useTypeLabel,
} from "@/hooks/useResolveLabel";
import { getPhaseLabels } from "@/lib/lifecyclePhases";
import type {
  ActiveQuery,
  CardQueryHop,
  CardQueryWhere,
  CardType,
  FieldDef,
  RelationType,
} from "@/types";
import { APPROVAL_STATUS_OPTIONS, EMPTY_VALUE } from "./InventoryFilterSidebar";
import { hopRelationType, hopVerb } from "./queryPath";

interface Props {
  /** The query view in force, or null (renders nothing). */
  view: ActiveQuery | null;
  /** Leave the view: drops the query from the inventory. */
  onLeave: () => void;
}

/**
 * The strip above the inventory grid while a query view is applied: names the
 * view, says it was generated via MCP and is editable only there, and reads
 * the chain as a path — each card type with its conditions, then per hop an
 * arrow, the relation verb read from the side under view, and the next type.
 */
export default function QueryPathStrip({ view, onLeave }: Props) {
  if (!view) return null;
  return <Strip view={view} onLeave={onLeave} />;
}

function Strip({ view, onLeave }: { view: ActiveQuery; onLeave: () => void }) {
  const { t } = useTranslation(["inventory", "common"]);
  const { types, relationTypes } = useMetamodel();
  return (
    <Paper
      variant="outlined"
      data-testid="query-path-strip"
      sx={{ mb: 1, px: 1.5, py: 1, flexShrink: 0, display: "flex", flexDirection: "column", gap: 0.75 }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <OriginChip origin="mcp" />
        <Typography variant="body2" fontWeight={600}>
          {view.name}
        </Typography>
        <Tooltip title={t("inventory:queryView.generatedViaMcpHint")} describeChild>
          <Typography variant="caption" color="text.secondary">
            {t("inventory:queryView.generatedViaMcp")}
          </Typography>
        </Tooltip>
        <Box sx={{ flex: 1 }} />
        <IconButton
          size="small"
          aria-label={t("inventory:queryView.leave")}
          data-testid="query-path-leave"
          onClick={onLeave}
        >
          <MaterialSymbol icon="close" size={18} />
        </IconButton>
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
        <QueryNode
          typeKey={view.query.type}
          where={view.query.where}
          hops={view.query.related ?? []}
          types={types}
          relationTypes={relationTypes}
        />
      </Box>
    </Paper>
  );
}

function fieldsOf(type: CardType | undefined): FieldDef[] {
  return (type?.fields_schema ?? []).flatMap((s) => s.fields);
}

function QueryNode({
  typeKey,
  where,
  hops,
  types,
  relationTypes,
}: {
  typeKey: string;
  where?: CardQueryWhere;
  hops: CardQueryHop[];
  types: CardType[];
  relationTypes: RelationType[];
}) {
  const { t, i18n } = useTranslation(["inventory", "common"]);
  const typeLabel = useTypeLabel();
  const isRtl = useIsRtl();
  const type = types.find((ct) => ct.key === typeKey);
  return (
    <>
      <Chip
        size="small"
        variant="outlined"
        label={typeLabel(type) || typeKey}
        icon={type ? <MaterialSymbol icon={type.icon} size={16} color={type.color} /> : undefined}
        sx={{ fontWeight: 600, borderColor: type?.color, "& .MuiChip-icon": { ml: 0.5 } }}
      />
      <Conditions type={type} where={where} />
      {hops.map((hop, i) => {
        const rt = hopRelationType(hop, relationTypes);
        const verb = hopVerb(rt, typeKey, i18n.language, hop.relation) || hop.relation;
        return (
          <Fragment key={`${hop.relation}-${hop.type}-${i}`}>
            {i > 0 && (
              <Typography variant="body2" color="text.secondary">
                {t("inventory:queryView.and")}
              </Typography>
            )}
            <Box data-testid="query-path-hop" sx={{ display: "contents" }}>
              <MaterialSymbol
                icon="arrow_forward"
                size={18}
                style={{ transform: isRtl ? "scaleX(-1)" : undefined }}
              />
              <Typography variant="body2" color="text.secondary" fontStyle="italic">
                {hop.negate ? `${t("inventory:queryView.hasNo")} ${verb}` : verb}
              </Typography>
              <QueryNode
                typeKey={hop.type}
                where={hop.where}
                hops={hop.related ?? []}
                types={types}
                relationTypes={relationTypes}
              />
            </Box>
          </Fragment>
        );
      })}
    </>
  );
}

/** One outlined chip per condition of a node: `label: value, value`. */
function Conditions({ type, where }: { type: CardType | undefined; where?: CardQueryWhere }) {
  const { t } = useTranslation(["inventory", "common"]);
  const fieldLabel = useFieldLabel();
  const optLabel = useOptionLabel();
  const stLabel = useSubtypeLabel();
  if (!where) return null;
  const empty = t("inventory:filter.emptyValue");
  const chips: { key: string; label: string }[] = [];

  if (where.lifecycle_phase?.length) {
    const phases = getPhaseLabels(t);
    const values = where.lifecycle_phase.map((p) => (p === "none" ? empty : phases[p] ?? p));
    chips.push({ key: "lifecycle", label: `${t("inventory:columns.lifecycle")}: ${values.join(", ")}` });
  }
  if (where.subtype?.length) {
    const values = where.subtype.map((k) => {
      if (k === EMPTY_VALUE) return empty;
      const st = type?.subtypes?.find((s) => s.key === k);
      return st ? stLabel(st) : k;
    });
    chips.push({ key: "subtype", label: `${t("common:labels.subtype")}: ${values.join(", ")}` });
  }
  if (where.approval_status?.length) {
    const values = where.approval_status.map((k) => {
      const opt = APPROVAL_STATUS_OPTIONS.find((o) => o.key === k);
      return opt ? t(opt.tKey) : k;
    });
    chips.push({
      key: "approval",
      label: `${t("inventory:columns.approvalStatus")}: ${values.join(", ")}`,
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
    chips.push({
      key: `attr-${fieldKey}`,
      label: `${field ? fieldLabel(field) : fieldKey}: ${values.join(", ")}`,
    });
  }

  return (
    <>
      {chips.map((c) => (
        <Chip key={c.key} size="small" variant="outlined" label={c.label} />
      ))}
    </>
  );
}
