import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import Popover from "@mui/material/Popover";
import Switch from "@mui/material/Switch";
import CardMultiPicker, { type PickedCard } from "@/components/CardMultiPicker";
import FilterSelect, { EMPTY_FILTER_KEY } from "@/components/FilterSelect";
import MaterialSymbol from "@/components/MaterialSymbol";
import TagPicker from "@/components/TagPicker";
import { useFieldLabel, useOptionLabel, useSubtypeLabel } from "@/hooks/useResolveLabel";
import { DATA_QUALITY_BANDS } from "@/lib/dataQualityBands";
import { EOL_STATUSES, EOL_STATUS_COLORS, EOL_STATUS_LABEL_KEYS } from "@/lib/eol";
import { facetOptions } from "@/lib/fieldFacets";
import type { CardType, FieldDef, TagGroup } from "@/types";
import { APPROVAL_STATUS_OPTIONS, LIFECYCLE_PHASES } from "./InventoryFilterSidebar";
import {
  cardNameLabel,
  facetToLifecycle,
  lifecycleToFacet,
  type ConditionKind,
} from "./queryDraft";
import type { CardNameEntry } from "./useCardNames";

interface Props {
  /** The chip the editor opens from; null keeps it closed. */
  anchorEl: HTMLElement | null;
  onClose: () => void;
  /** The card type of the node the condition sits on. */
  type: CardType | undefined;
  kind: ConditionKind;
  values: string[];
  tagGroups: TagGroup[];
  /** Names of the picked cards (a cards condition), resolved by the strip. */
  cardNames: Map<string, CardNameEntry>;
  /** "Include sub-cards" on a cards condition. */
  includeDescendants: boolean;
  onIncludeDescendantsChange: (on: boolean) => void;
  onChange: (values: string[]) => void;
}

function fieldOf(type: CardType | undefined, key: string): FieldDef | undefined {
  return (type?.fields_schema ?? []).flatMap((s) => s.fields).find((f) => f.key === key);
}

/**
 * The value editor of one condition chip in the query builder: the same
 * controls the inventory's facets use — a `FilterSelect` for lifecycle,
 * subtype, approval status, data quality, end of life and select / boolean fields, the `TagPicker` for
 * tags — so a condition is picked exactly like a filter. Specific cards are
 * picked in the shared `CardMultiPicker`, opened from the popover.
 */
export default function QueryConditionPopover({
  anchorEl,
  onClose,
  type,
  kind,
  values,
  tagGroups,
  cardNames,
  includeDescendants,
  onIncludeDescendantsChange,
  onChange,
}: Props) {
  // A field condition whose field the type no longer has (a stale query) has
  // no editor: the popover closes rather than open empty.
  const noEditor = typeof kind === "object" && !fieldOf(type, kind.attribute);
  const open = anchorEl != null;
  useEffect(() => {
    if (open && noEditor) onClose();
  }, [open, noEditor, onClose]);
  if (noEditor) return null;
  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
    >
      <Box data-testid="query-condition-popover" sx={{ p: 1.5, minWidth: 240, maxWidth: 360 }}>
        <Editor
          type={type}
          kind={kind}
          values={values}
          tagGroups={tagGroups}
          cardNames={cardNames}
          includeDescendants={includeDescendants}
          onIncludeDescendantsChange={onIncludeDescendantsChange}
          onChange={onChange}
        />
      </Box>
    </Popover>
  );
}

function Editor({
  type,
  kind,
  values,
  tagGroups,
  cardNames,
  includeDescendants,
  onIncludeDescendantsChange,
  onChange,
}: Omit<Props, "anchorEl" | "onClose">) {
  const { t } = useTranslation(["inventory", "common", "cards", "reports"]);
  const stLabel = useSubtypeLabel();
  const fieldLabel = useFieldLabel();
  const optLabel = useOptionLabel();

  if (kind === "cards") {
    return (
      <CardsPanel
        type={type}
        values={values}
        cardNames={cardNames}
        includeDescendants={includeDescendants}
        onIncludeDescendantsChange={onIncludeDescendantsChange}
        onChange={onChange}
      />
    );
  }

  if (kind === "tags") {
    return (
      <TagPicker
        groups={tagGroups}
        typeKey={type?.key}
        value={values}
        onChange={onChange}
        size="small"
        label={t("inventory:filter.tags")}
      />
    );
  }
  if (kind === "lifecycle_phase") {
    return (
      <FilterSelect
        label={t("inventory:filter.lifecycle")}
        options={LIFECYCLE_PHASES.map((p) => ({ key: p.key, label: t(p.tKey), color: p.color }))}
        value={lifecycleToFacet(values)}
        onChange={(v) => onChange(facetToLifecycle(v))}
      />
    );
  }
  if (kind === "subtype") {
    return (
      <FilterSelect
        label={t("common:labels.subtype")}
        options={(type?.subtypes ?? []).map((s) => ({ key: s.key, label: stLabel(s) }))}
        value={values}
        onChange={onChange}
      />
    );
  }
  if (kind === "approval_status") {
    return (
      <FilterSelect
        label={t("inventory:columns.approvalStatus")}
        allowEmpty={false}
        options={APPROVAL_STATUS_OPTIONS.map((o) => ({ key: o.key, label: t(o.tKey), color: o.color }))}
        value={values}
        onChange={onChange}
      />
    );
  }
  if (kind === "data_quality_band") {
    return (
      <FilterSelect
        label={t("inventory:filter.dataQuality")}
        allowEmpty={false}
        options={DATA_QUALITY_BANDS.map((b) => ({
          key: b.key,
          label: t(`inventory:${b.tKey}`),
          color: b.color,
        }))}
        value={values}
        onChange={onChange}
      />
    );
  }
  if (kind === "eol_status") {
    // The inventory EOL facet's vocabulary, labels and colours, with its
    // "(empty)" chip — the cards with no end of life recorded (`__empty__`) —
    // first, where every other editor here offers it.
    return (
      <FilterSelect
        label={t("inventory:filter.eol")}
        allowEmpty={false}
        options={[
          { key: EMPTY_FILTER_KEY, label: t("inventory:filter.emptyValue") },
          ...EOL_STATUSES.map((s) => ({
            key: s,
            label: t(`reports:${EOL_STATUS_LABEL_KEYS[s]}`),
            color: EOL_STATUS_COLORS[s],
          })),
        ]}
        value={values}
        onChange={onChange}
      />
    );
  }
  const field = fieldOf(type, kind.attribute);
  if (!field) return null;
  const options = facetOptions(field, { yes: t("common:labels.yes"), no: t("common:labels.no") }).map(
    (o) => ({
      key: o.key,
      label: field.type === "boolean" ? o.label : optLabel(o),
      color: o.color,
    }),
  );
  return (
    <FilterSelect
      label={fieldLabel(field)}
      options={options}
      value={values}
      onChange={onChange}
    />
  );
}

/**
 * The cards condition: the picked cards as removable chips, a button that
 * opens the shared multi-card picker on the node's type, and — on a type with
 * a hierarchy — the "Include sub-cards" switch. The picker is a dialog nested
 * in the popover, so the popover (and the empty condition it edits) stays
 * open while the user picks.
 */
function CardsPanel({
  type,
  values,
  cardNames,
  includeDescendants,
  onIncludeDescendantsChange,
  onChange,
}: Pick<
  Props,
  "type" | "values" | "cardNames" | "includeDescendants" | "onIncludeDescendantsChange" | "onChange"
>) {
  const { t } = useTranslation("inventory");
  const [pickerOpen, setPickerOpen] = useState(false);
  const labels = {
    hiddenCard: t("queryView.hiddenCard"),
    unknownCard: t("queryView.unknownCard"),
  };
  const labelOf = (id: string) => cardNameLabel(cardNames.get(id), id, labels);
  // Every current pick seeds the picker's basket, so a hidden or unknown
  // card shows its label there rather than a blank chip.
  const picked: PickedCard[] = values.map((id) => {
    const entry = cardNames.get(id);
    return entry?.kind === "card"
      ? { id, name: entry.name, type: entry.type }
      : { id, name: labelOf(id), type: type?.key ?? "" };
  });
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {values.length > 0 && (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
          {values.map((id) => (
            <Chip
              key={id}
              size="small"
              data-testid="query-cards-chip"
              label={labelOf(id)}
              onDelete={() => onChange(values.filter((v) => v !== id))}
            />
          ))}
        </Box>
      )}
      <Button
        size="small"
        variant="outlined"
        data-testid="query-cards-pick"
        startIcon={<MaterialSymbol icon="checklist" size={16} />}
        onClick={() => setPickerOpen((o) => !o)}
        sx={{ alignSelf: "flex-start", textTransform: "none" }}
      >
        {t("queryView.pickCards")}
      </Button>
      {type?.has_hierarchy && (
        <FormControlLabel
          control={
            <Switch
              size="small"
              data-testid="query-cards-subcards"
              checked={includeDescendants}
              onChange={(e) => onIncludeDescendantsChange(e.target.checked)}
            />
          }
          label={t("queryView.includeSubCards")}
        />
      )}
      <CardMultiPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        types={type?.key}
        value={values}
        mode="multi"
        initialOptions={picked}
        title={t("queryView.pickCards")}
        onChange={(ids) => {
          onChange(ids);
          setPickerOpen(false);
        }}
      />
    </Box>
  );
}
