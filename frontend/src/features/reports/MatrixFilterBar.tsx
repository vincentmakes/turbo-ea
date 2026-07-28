import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import MaterialSymbol from "@/components/MaterialSymbol";
import FilterSelect from "@/components/FilterSelect";
import { useFieldLabel, useRelationLabel } from "@/hooks/useResolveLabel";
import type { RelationType } from "@/types";
import type { MatrixDimension, MatrixValue } from "./matrixDimensions";

export interface MatrixFilterState {
  /** Relation-type keys to keep. Empty means all. */
  relationTypes: string[];
  /** `${relationTypeKey}.${fieldKey}` → the values to keep. */
  attrValues: Record<string, string[]>;
  direction: "any" | "forward" | "reverse";
}

interface Props {
  /** Relation types connecting the two axes, in either orientation. */
  relationTypes: RelationType[];
  dimensions: MatrixDimension[];
  values: MatrixValue[];
  state: MatrixFilterState;
  onChange: (next: MatrixFilterState) => void;
  activeCount: number;
}

/** Filters shown before the "+N more" chip has been expanded. */
const COLLAPSED_FILTERS = 3;

/**
 * Relation filter for the Matrix report.
 *
 * Which controls appear is decided entirely by the metamodel: the relation
 * types that connect the chosen axes, and the `boolean` / `single_select`
 * dimensions those types declare. An admin who adds a dimension gets a filter
 * for it with no code change, and a pair whose relations carry no values shows
 * only the controls that still mean something.
 */
export default function MatrixFilterBar({
  relationTypes,
  dimensions,
  values,
  state,
  onChange,
  activeCount,
}: Props) {
  const { t } = useTranslation(["reports", "common"]);
  const fieldLabel = useFieldLabel();
  const relationLabel = useRelationLabel();
  const [showAll, setShowAll] = useState(false);

  // Only the relation types actually in scope contribute filters, so narrowing
  // by relation type also narrows the attribute filters on offer.
  const scopedTypeKeys = state.relationTypes.length > 0
    ? new Set(state.relationTypes)
    : new Set(relationTypes.map((rt) => rt.key));

  const filterableDimensions = useMemo(
    () => dimensions.filter(
      (d) => d.kind !== "scalar" && scopedTypeKeys.has(d.relationTypeKey),
    ),
    [dimensions, scopedTypeKeys],
  );

  if (relationTypes.length === 0) return null;

  const multipleTypes = relationTypes.length > 1;
  const visibleDimensions = showAll
    ? filterableDimensions
    : filterableDimensions.slice(0, COLLAPSED_FILTERS);
  const hiddenCount = filterableDimensions.length - visibleDimensions.length;

  const optionsFor = (dimension: MatrixDimension) => {
    if (dimension.kind === "flag") {
      // A flag is tri-state in storage — on, off, or never set. "Off" and
      // "unset" are different questions, so both are offered.
      return [
        { key: "true", label: t("common:labels.yes") },
        { key: "false", label: t("common:labels.no") },
      ];
    }
    return values
      .filter((v) => v.dimensionId === dimension.id)
      .map((v) => ({ key: v.optionKey as string, label: v.label, color: v.color }));
  };

  const labelFor = (dimension: MatrixDimension) => {
    const base = fieldLabel(dimension.field);
    if (!multipleTypes) return base;
    const rt = relationTypes.find((r) => r.key === dimension.relationTypeKey);
    return rt ? `${relationLabel(rt)} · ${base}` : base;
  };

  const setAttr = (dimensionId: string, next: string[]) => {
    const attrValues = { ...state.attrValues };
    if (next.length === 0) delete attrValues[dimensionId];
    else attrValues[dimensionId] = next;
    onChange({ ...state, attrValues });
  };

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        flexWrap: "wrap",
        bgcolor: "action.hover",
        borderRadius: 1.5,
        px: 1.5,
        py: 0.75,
        mb: 2,
      }}
    >
      <Typography
        variant="caption"
        sx={{ color: "text.secondary", fontWeight: 600, fontSize: "0.7rem", whiteSpace: "nowrap" }}
      >
        {t("matrix.filters")}
      </Typography>

      {multipleTypes && (
        <FilterSelect
          label={t("matrix.relationType")}
          options={relationTypes.map((rt) => ({ key: rt.key, label: relationLabel(rt) }))}
          value={state.relationTypes}
          onChange={(next) => onChange({ ...state, relationTypes: next })}
        />
      )}

      <ToggleButtonGroup
        exclusive
        size="small"
        value={state.direction}
        onChange={(_, next) => next && onChange({ ...state, direction: next })}
      >
        <ToggleButton value="any" sx={{ px: 1 }}>
          <Tooltip title={t("matrix.directionAny")}>
            <Box component="span" sx={{ display: "flex" }}>
              <MaterialSymbol icon="all_inclusive" size={16} />
            </Box>
          </Tooltip>
        </ToggleButton>
        <ToggleButton value="forward" sx={{ px: 1 }}>
          <Tooltip title={t("matrix.directionForward")}>
            <Box component="span" sx={{ display: "flex" }}>
              <MaterialSymbol icon="arrow_forward" size={16} />
            </Box>
          </Tooltip>
        </ToggleButton>
        <ToggleButton value="reverse" sx={{ px: 1 }}>
          <Tooltip title={t("matrix.directionReverse")}>
            <Box component="span" sx={{ display: "flex" }}>
              <MaterialSymbol icon="arrow_back" size={16} />
            </Box>
          </Tooltip>
        </ToggleButton>
      </ToggleButtonGroup>

      {visibleDimensions.map((dimension) => (
        <FilterSelect
          key={dimension.id}
          label={labelFor(dimension)}
          options={optionsFor(dimension)}
          value={state.attrValues[dimension.id] ?? []}
          onChange={(next) => setAttr(dimension.id, next)}
        />
      ))}

      {hiddenCount > 0 && (
        <Chip
          size="small"
          icon={<MaterialSymbol icon="add" size={14} />}
          label={t("matrix.moreFilters", { count: hiddenCount })}
          onClick={() => setShowAll(true)}
        />
      )}

      {activeCount > 0 && (
        <>
          <Typography variant="caption" sx={{ color: "text.secondary", ml: "auto" }}>
            {t("matrix.activeFilters", { count: activeCount })}
          </Typography>
          <Chip
            size="small"
            variant="outlined"
            icon={<MaterialSymbol icon="clear_all" size={14} />}
            label={t("matrix.clearFilters")}
            onClick={() => onChange({ relationTypes: [], attrValues: {}, direction: "any" })}
          />
        </>
      )}
    </Box>
  );
}
