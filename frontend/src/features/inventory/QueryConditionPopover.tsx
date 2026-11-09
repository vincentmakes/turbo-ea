import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Popover from "@mui/material/Popover";
import FilterSelect from "@/components/FilterSelect";
import TagPicker from "@/components/TagPicker";
import { useFieldLabel, useOptionLabel, useSubtypeLabel } from "@/hooks/useResolveLabel";
import { facetOptions } from "@/lib/fieldFacets";
import type { CardType, FieldDef, TagGroup } from "@/types";
import { APPROVAL_STATUS_OPTIONS, LIFECYCLE_PHASES } from "./InventoryFilterSidebar";
import { facetToLifecycle, lifecycleToFacet, type ConditionKind } from "./queryDraft";

interface Props {
  /** The chip the editor opens from; null keeps it closed. */
  anchorEl: HTMLElement | null;
  onClose: () => void;
  /** The card type of the node the condition sits on. */
  type: CardType | undefined;
  kind: ConditionKind;
  values: string[];
  tagGroups: TagGroup[];
  onChange: (values: string[]) => void;
}

function fieldOf(type: CardType | undefined, key: string): FieldDef | undefined {
  return (type?.fields_schema ?? []).flatMap((s) => s.fields).find((f) => f.key === key);
}

/**
 * The value editor of one condition chip in the query builder: the same
 * controls the inventory's facets use — a `FilterSelect` for lifecycle,
 * subtype, approval status and select / boolean fields, the `TagPicker` for
 * tags — so a condition is picked exactly like a filter.
 */
export default function QueryConditionPopover({
  anchorEl,
  onClose,
  type,
  kind,
  values,
  tagGroups,
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
        <Editor type={type} kind={kind} values={values} tagGroups={tagGroups} onChange={onChange} />
      </Box>
    </Popover>
  );
}

function Editor({
  type,
  kind,
  values,
  tagGroups,
  onChange,
}: Omit<Props, "anchorEl" | "onClose">) {
  const { t } = useTranslation(["inventory", "common", "cards"]);
  const stLabel = useSubtypeLabel();
  const fieldLabel = useFieldLabel();
  const optLabel = useOptionLabel();

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
