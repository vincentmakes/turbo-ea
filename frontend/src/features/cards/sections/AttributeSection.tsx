import { useState, useEffect, useRef } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import IconButton from "@mui/material/IconButton";
import MaterialSymbol from "@/components/MaterialSymbol";
import VendorField from "@/components/VendorField";
import Alert from "@mui/material/Alert";
import { useTranslation } from "react-i18next";
import { FieldValue, FieldEditor, isValidUrl, getUrlErrorMsg } from "@/features/cards/sections/cardDetailUtils";
import { useCurrency } from "@/hooks/useCurrency";
import { useResolveLabel, useFieldLabel } from "@/hooks/useResolveLabel";
import { ApiError } from "@/api/client";
import type { Card, FieldDef, SectionDef } from "@/types";

// ── Section: Type-specific attributes ───────────────────────────
const VENDOR_ELIGIBLE_TYPES = ["ITComponent", "Application"];

function AttributeSection({
  section,
  card,
  onSave,
  onRelationChange,
  canEdit = true,
  calculatedFieldKeys = [],
  initialExpanded,
  hiddenFieldKeys,
  canViewCosts = true,
}: {
  section: SectionDef & { defaultExpanded?: boolean; columns?: 1 | 2 };
  card: Card;
  onSave: (u: Record<string, unknown>) => Promise<void>;
  onRelationChange?: () => void;
  canEdit?: boolean;
  calculatedFieldKeys?: string[];
  initialExpanded?: boolean;
  hiddenFieldKeys?: Set<string>;
  canViewCosts?: boolean;
}) {
  const { t } = useTranslation(["cards", "common"]);
  const { fmt, symbol } = useCurrency();
  const rl = useResolveLabel();
  const fieldLabel = useFieldLabel();
  const [editing, setEditing] = useState(false);
  const [attrs, setAttrs] = useState<Record<string, unknown>>(
    card.attributes || {}
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setAttrs(card.attributes || {});
  }, [card.attributes]);

  // Filter out hidden fields for the active subtype
  const visibleFields = hiddenFieldKeys?.size
    ? section.fields.filter((f) => !hiddenFieldKeys.has(f.key))
    : section.fields;

  // Per-section badge filter (client-side only; not persisted). Distinct badges
  // among the visible fields drive a compact [All] + badge toggle row; picking a
  // badge narrows what renders. `null` = All. The filter value is the raw
  // `badge` string (stable across locales); the button shows the localized label.
  const [badgeFilter, setBadgeFilter] = useState<string | null>(null);
  const badgeOptions = visibleFields.reduce<{ value: string; label: string }[]>((acc, f) => {
    if (f.badge && !acc.some((b) => b.value === f.badge)) {
      acc.push({ value: f.badge, label: rl(f.badge, f.badgeTranslations) });
    }
    return acc;
  }, []);
  const filteredFields = badgeFilter
    ? visibleFields.filter((f) => f.badge === badgeFilter)
    : visibleFields;

  // Compute URL validation errors for all url-type fields in this section
  const urlErrors: Record<string, string> = {};
  for (const f of visibleFields) {
    if (f.type === "url") {
      const val = attrs[f.key];
      if (typeof val === "string" && val && !isValidUrl(val)) {
        urlErrors[f.key] = getUrlErrorMsg(t);
      }
    }
  }
  const hasValidationErrors = Object.keys(urlErrors).length > 0;

  const save = async () => {
    if (hasValidationErrors) return;
    setSaveError(null);
    try {
      await onSave({ attributes: attrs });
      // Collapsing the (tall) edit view to the compact read view — and the
      // parent shrinking the page after setCard — would otherwise dump the user
      // at the new page bottom. Capture this section's viewport offset, then
      // after the reflow scroll by the delta so the section stays put. Generic:
      // applies to every attribute section, and only nudges on save (never hooks
      // scroll events) so it doesn't fight the scroll-to-top FAB.
      const before = rootRef.current?.getBoundingClientRect().top ?? null;
      setEditing(false);
      if (before != null) {
        requestAnimationFrame(() => {
          const after = rootRef.current?.getBoundingClientRect().top;
          if (after != null) window.scrollBy(0, after - before);
        });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      setSaveError(msg);
    }
  };

  const setAttr = (key: string, value: unknown) => {
    setAttrs((prev) => ({ ...prev, [key]: value }));
  };

  const isVendorField = (field: FieldDef) =>
    field.key === "vendor" && VENDOR_ELIGIBLE_TYPES.includes(card.type);

  // Count filled fields in this section
  const filled = visibleFields.filter((f) => {
    const v = (card.attributes || {})[f.key];
    return v != null && v !== "" && v !== false;
  }).length;

  const is2Col = section.columns === 2;

  // Build ordered column items: each item is either a group or a standalone field
  type ColumnItem = { kind: "field"; field: FieldDef } | { kind: "group"; name: string; fields: FieldDef[] };

  const buildColumnItems = (colNum: 0 | 1): ColumnItem[] => {
    const items: ColumnItem[] = [];
    const seenGroups = new Set<string>();
    for (const field of filteredFields) {
      const fieldCol = is2Col ? (field.column ?? 0) : 0;
      if (fieldCol !== colNum) continue;
      if (field.group) {
        if (seenGroups.has(field.group)) continue;
        seenGroups.add(field.group);
        // Collect all fields in this group that belong to this column
        const gFields = filteredFields.filter((f) => f.group === field.group && (is2Col ? (f.column ?? 0) : 0) === colNum);
        items.push({ kind: "group", name: field.group, fields: gFields });
      } else {
        items.push({ kind: "field", field });
      }
    }
    return items;
  };

  const col0Items = buildColumnItems(0);
  const col1Items = is2Col ? buildColumnItems(1) : [];

  const expanded = initialExpanded ?? (section.defaultExpanded !== false);

  // Read-only field grid
  const renderReadGrid = (fields: FieldDef[]) => (
    <Box sx={{ display: "grid", gridTemplateColumns: "1fr", rowGap: 1, columnGap: 2, "@container (min-width: 480px)": { gridTemplateColumns: "180px 1fr", alignItems: "center" } }}>
      {fields.map((field) => (
        <Box key={field.key} sx={{ display: "contents" }}>
          <Typography variant="body2" color="text.secondary">
            {fieldLabel(field)}
            {calculatedFieldKeys.includes(field.key) ? (
              <Chip component="span" size="small" label={t("attributes.calculated")} sx={{ height: 16, fontSize: "0.55rem", ml: 0.5, verticalAlign: "middle" }} />
            ) : field.readonly ? (
              <Chip component="span" size="small" label={t("attributes.auto")} sx={{ height: 16, fontSize: "0.55rem", ml: 0.5, verticalAlign: "middle" }} />
            ) : null}
            {field.badge ? (
              <Chip component="span" size="small" color="primary" variant="outlined" label={rl(field.badge, field.badgeTranslations)} sx={{ height: 16, fontSize: "0.55rem", ml: 0.5, verticalAlign: "middle" }} />
            ) : null}
          </Typography>
          <FieldValue field={field} value={(card.attributes || {})[field.key]} currencyFmt={fmt} canViewCosts={canViewCosts} />
        </Box>
      ))}
    </Box>
  );

  // Edit field list
  const renderEditFields = (fields: FieldDef[]) => (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
      {fields.map((field) =>
        field.readonly || calculatedFieldKeys.includes(field.key) ? (
          <Box key={field.key} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography variant="body2" color="text.secondary" sx={{ minWidth: 160 }}>{fieldLabel(field)}</Typography>
            <FieldValue field={field} value={attrs[field.key]} currencyFmt={fmt} canViewCosts={canViewCosts} />
            <Chip size="small" label={calculatedFieldKeys.includes(field.key) ? t("attributes.calculated") : t("attributes.auto")} sx={{ height: 18, fontSize: "0.6rem", ml: 0.5 }} />
            {field.badge ? (
              <Chip size="small" color="primary" variant="outlined" label={rl(field.badge, field.badgeTranslations)} sx={{ height: 18, fontSize: "0.6rem", ml: 0.5 }} />
            ) : null}
          </Box>
        ) : isVendorField(field) ? (
          <VendorField
            key={field.key}
            value={(attrs[field.key] as string) ?? ""}
            onChange={(v) => setAttr(field.key, v)}
            cardTypeKey={card.type}
            fsId={card.id}
            onRelationChange={onRelationChange}
          />
        ) : (
          <Box key={field.key} sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
            {field.badge ? (
              <Box>
                <Chip size="small" color="primary" variant="outlined" label={rl(field.badge, field.badgeTranslations)} sx={{ height: 18, fontSize: "0.6rem" }} />
              </Box>
            ) : null}
            <FieldEditor
              field={field}
              value={attrs[field.key]}
              onChange={(v) => setAttr(field.key, v)}
              currencySymbol={symbol}
              error={urlErrors[field.key]}
              canViewCosts={canViewCosts}
            />
          </Box>
        )
      )}
    </Box>
  );

  // Render a list of column items (groups + standalone fields)
  const renderColumnItems = (items: ColumnItem[], isEdit: boolean) => (
    <>
      {items.map((item, i) => {
        if (item.kind === "group") {
          return (
            <Box key={`group-${item.name}`} sx={{ mb: 1.5 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, color: "text.secondary", borderBottom: 1, borderColor: "divider", pb: 0.5, mb: 1, mt: i > 0 ? 1 : 0 }}>
                {rl(item.name, section.groupTranslations?.[item.name])}
              </Typography>
              {isEdit ? renderEditFields(item.fields) : renderReadGrid(item.fields)}
            </Box>
          );
        }
        return (
          <Box key={item.field.key} sx={{ mb: isEdit ? 2.5 : 0.5 }}>
            {isEdit ? renderEditFields([item.field]) : renderReadGrid([item.field])}
          </Box>
        );
      })}
    </>
  );

  // Compact [All] + badge filter row (only when the section has badged fields)
  const renderBadgeFilter = () =>
    badgeOptions.length === 0 ? null : (
      <ToggleButtonGroup
        size="small"
        exclusive
        value={badgeFilter ?? "__all__"}
        onChange={(_e, val) => setBadgeFilter(val && val !== "__all__" ? val : null)}
        sx={{
          flexWrap: "wrap",
          gap: 0.5,
          mb: 2,
          "& .MuiToggleButton-root": {
            textTransform: "none",
            py: 0.25,
            px: 1.25,
            fontSize: "0.7rem",
            lineHeight: 1.4,
            border: 1,
            borderColor: "divider",
            borderRadius: "16px !important",
          },
        }}
      >
        <ToggleButton value="__all__">{t("attributes.filterAll")}</ToggleButton>
        {badgeOptions.map((b) => (
          <ToggleButton key={b.value} value={b.value}>{b.label}</ToggleButton>
        ))}
      </ToggleButtonGroup>
    );

  // Render the full section body with column layout
  const renderSectionBody = (isEdit: boolean) => (
    <>
      {renderBadgeFilter()}
      {!is2Col ? (
        renderColumnItems(col0Items, isEdit)
      ) : (
        <Box sx={{ display: "flex", gap: 3, flexDirection: "column", "@container (min-width: 780px)": { flexDirection: "row" } }}>
          <Box sx={{ flex: 1 }}>{renderColumnItems(col0Items, isEdit)}</Box>
          {col1Items.length > 0 && (
            <Box sx={{ flex: 1 }}>{renderColumnItems(col1Items, isEdit)}</Box>
          )}
        </Box>
      )}
    </>
  );

  return (
    <Accordion ref={rootRef} defaultExpanded={expanded} disableGutters>
      <AccordionSummary expandIcon={<MaterialSymbol icon="expand_more" size={20} />}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1 }}>
          <MaterialSymbol icon="tune" size={20} />
          <Typography fontWeight={600}>{rl(section.section, section.translations)}</Typography>
          <Chip
            size="small"
            label={`${filled}/${section.fields.length}`}
            sx={{ ml: 1, height: 20, fontSize: "0.7rem" }}
          />
        </Box>
        {!editing && canEdit && (
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
          >
            <MaterialSymbol icon="edit" size={16} />
          </IconButton>
        )}
      </AccordionSummary>
      <AccordionDetails>
        {editing && canEdit ? (
          <Box sx={{ containerType: "inline-size" }}>
            {renderSectionBody(true)}
            {saveError && (
              <Alert severity="error" sx={{ mt: 1 }} onClose={() => setSaveError(null)}>
                {saveError}
              </Alert>
            )}
            <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end", mt: 2 }}>
              <Button
                size="small"
                onClick={() => {
                  setAttrs(card.attributes || {});
                  setEditing(false);
                  setSaveError(null);
                }}
              >
                {t("common:actions.cancel")}
              </Button>
              <Button size="small" variant="contained" onClick={save} disabled={hasValidationErrors}>
                {t("common:actions.save")}
              </Button>
            </Box>
          </Box>
        ) : (
          <Box sx={{ containerType: "inline-size" }}>
            {renderSectionBody(false)}
          </Box>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

export default AttributeSection;
