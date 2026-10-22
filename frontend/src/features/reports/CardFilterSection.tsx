import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import FilterSelect from "@/components/FilterSelect";
import MaterialSymbol from "@/components/MaterialSymbol";
import TagPicker from "@/components/TagPicker";
import type { TagGroup } from "@/types";
import ReportFilterSection from "./ReportFilterSection";
import { countActiveFilters, hasActiveFilters } from "./cardFilters";
import type { CardFilterValue, RelationFilterOption } from "./cardFilters";
import type { FieldDef, RelSubtype, TagGroupDef } from "./portfolioHelpers";

/** Relation facets shown before the "+N more" fold. */
const VISIBLE_RELATION_FACETS = 2;

export interface CardFilterSectionProps {
  /** Header label, already translated ("Application Filters"). */
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  value: CardFilterValue;
  onChange: (next: CardFilterValue) => void;
  relationOptions: RelationFilterOption[];
  tagGroups: TagGroupDef[];
  subtypeOptions: { key: string; label: string }[];
  /** The card type's own facet fields, labels and options resolved. */
  fields: FieldDef[];
  relSubtypes: RelSubtype[];
  /** The report's search box, which Clear all also empties. */
  search?: string;
  onClearAll: () => void;
  /** Shown in place of the filter rows when they cannot apply. */
  disabledReason?: string;
  /** Extra content after the rows (a match count, …). */
  children?: ReactNode;
}

/** The grey sub-section every filter row sits in. */
function FilterRow({ title, children }: { title: string; children: ReactNode }) {
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
      }}
    >
      <Typography
        variant="caption"
        sx={{ color: "text.secondary", fontWeight: 600, fontSize: "0.7rem", whiteSpace: "nowrap" }}
      >
        {title}
      </Typography>
      {children}
    </Box>
  );
}

/**
 * The card filter section shared by the Portfolio, Flexible Portfolio and
 * Lifecycle reports: Related by (with *Include sub-cards*), Tags, the card's
 * own Fields (subtype first) and Relation subtypes, under one collapsible
 * header with a count and Clear all. It only renders: the report owns the
 * value, builds the options and does the matching.
 */
export default function CardFilterSection({
  label,
  collapsed,
  onToggle,
  value,
  onChange,
  relationOptions,
  tagGroups,
  subtypeOptions,
  fields,
  relSubtypes,
  search = "",
  onClearAll,
  disabledReason,
  children,
}: CardFilterSectionProps) {
  const { t } = useTranslation(["reports", "common"]);
  const [showAllRelations, setShowAllRelations] = useState(false);
  const active = hasActiveFilters(value, search);
  const set = (patch: Partial<CardFilterValue>) => onChange({ ...value, ...patch });
  const hidden = relationOptions.length - VISIBLE_RELATION_FACETS;
  const anyHierarchical = relationOptions.some((o) => o.hierarchical);

  return (
    <ReportFilterSection
      label={label}
      collapsed={collapsed}
      onToggle={onToggle}
      count={countActiveFilters(value)}
      clearAllLabel={active ? t("portfolio.clearAll") : undefined}
      onClearAll={active ? onClearAll : undefined}
    >
      {disabledReason ? (
        <Typography variant="body2" color="text.secondary">
          {disabledReason}
        </Typography>
      ) : (
        <>
          {relationOptions.length > 0 && (
            <FilterRow title={t("portfolio.relatedBy")}>
              {relationOptions
                .slice(0, showAllRelations ? undefined : VISIBLE_RELATION_FACETS)
                .map((rf) => (
                  <FilterSelect
                    key={rf.typeKey}
                    label={rf.label}
                    options={rf.options}
                    value={value.relationFilters[rf.typeKey] || []}
                    onChange={(v) =>
                      set({ relationFilters: { ...value.relationFilters, [rf.typeKey]: v } })
                    }
                  />
                ))}
              {!showAllRelations && hidden > 0 && (
                <Tooltip title={t("portfolio.showMore", { count: hidden })}>
                  <Chip
                    size="small"
                    icon={<MaterialSymbol icon="add" size={14} />}
                    label={t("portfolio.more", { count: hidden })}
                    onClick={() => setShowAllRelations(true)}
                    sx={{
                      height: 26,
                      fontSize: "0.72rem",
                      fontWeight: 500,
                      cursor: "pointer",
                      bgcolor: "background.paper",
                      border: "1px dashed",
                      borderColor: "divider",
                      "&:hover": { bgcolor: "action.hover" },
                    }}
                  />
                </Tooltip>
              )}
              {showAllRelations && hidden > 0 && (
                <Chip
                  size="small"
                  label={t("portfolio.less")}
                  onClick={() => setShowAllRelations(false)}
                  sx={{
                    height: 26,
                    fontSize: "0.72rem",
                    cursor: "pointer",
                    bgcolor: "background.paper",
                    border: 1,
                    borderColor: "divider",
                  }}
                />
              )}
              {anyHierarchical && (
                <Tooltip title={t("cardFilters.includeSubCardsTooltip")} describeChild>
                  <FormControlLabel
                    sx={{ ml: 0.5, mr: 0 }}
                    control={
                      <Switch
                        size="small"
                        checked={value.includeDescendants}
                        onChange={(_, v) => set({ includeDescendants: v })}
                      />
                    }
                    label={
                      <Typography variant="body2" color="text.secondary">
                        {t("cardFilters.includeSubCards")}
                      </Typography>
                    }
                  />
                </Tooltip>
              )}
            </FilterRow>
          )}

          {tagGroups.length > 0 && (
            <FilterRow title={t("portfolio.tags")}>
              <TagPicker
                groups={tagGroups as unknown as TagGroup[]}
                value={value.tagFilterIds}
                onChange={(v) => set({ tagFilterIds: v })}
                size="small"
                label={t("portfolio.tags")}
                placeholder=""
                sx={{ minWidth: 180, maxWidth: 320 }}
              />
            </FilterRow>
          )}

          {/* The card's subtype first, then its own facet fields. */}
          {(subtypeOptions.length > 0 || fields.length > 0) && (
            <FilterRow title={t("portfolio.fields")}>
              {subtypeOptions.length > 0 && (
                <FilterSelect
                  label={t("portfolio.filters.subtype")}
                  options={subtypeOptions}
                  value={value.subtypeFilters}
                  onChange={(v) => set({ subtypeFilters: v })}
                />
              )}
              {fields.map((f) => (
                <FilterSelect
                  key={f.key}
                  label={f.label}
                  options={(f.options || []).map((o) => ({
                    key: o.key,
                    label: o.label,
                    color: o.color,
                  }))}
                  value={value.attrFilters[f.key] || []}
                  onChange={(v) => set({ attrFilters: { ...value.attrFilters, [f.key]: v } })}
                />
              ))}
            </FilterRow>
          )}

          {relSubtypes.length > 0 && (
            <FilterRow title={t("portfolio.relationSubtypes")}>
              {relSubtypes.map((sub) => (
                <FilterSelect
                  key={sub.composite}
                  label={sub.comboLabel}
                  options={sub.options.map((o) => ({
                    key: o.key,
                    label: o.label,
                    color: o.color,
                  }))}
                  value={value.relSubtypeFilters[sub.composite] || []}
                  onChange={(v) =>
                    set({ relSubtypeFilters: { ...value.relSubtypeFilters, [sub.composite]: v } })
                  }
                />
              ))}
            </FilterRow>
          )}
          {children}
        </>
      )}
    </ReportFilterSection>
  );
}
