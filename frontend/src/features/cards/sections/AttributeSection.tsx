import { useState, useEffect } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import MaterialSymbol from "@/components/MaterialSymbol";
import VendorField from "@/components/VendorField";
import { FieldValue, FieldEditor } from "@/features/cards/sections/cardDetailUtils";
import { useCurrency } from "@/hooks/useCurrency";
import type { Card, FieldDef } from "@/types";

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
}: {
  section: { section: string; fields: FieldDef[]; defaultExpanded?: boolean; columns?: 1 | 2 };
  card: Card;
  onSave: (u: Record<string, unknown>) => Promise<void>;
  onRelationChange?: () => void;
  canEdit?: boolean;
  calculatedFieldKeys?: string[];
  initialExpanded?: boolean;
}) {
  const { fmt, symbol } = useCurrency();
  const [editing, setEditing] = useState(false);
  const [attrs, setAttrs] = useState<Record<string, unknown>>(
    card.attributes || {}
  );
  useEffect(() => {
    setAttrs(card.attributes || {});
  }, [card.attributes]);

  const save = async () => {
    await onSave({ attributes: attrs });
    setEditing(false);
  };

  const setAttr = (key: string, value: unknown) => {
    setAttrs((prev) => ({ ...prev, [key]: value }));
  };

  const isVendorField = (field: FieldDef) =>
    field.key === "vendor" && VENDOR_ELIGIBLE_TYPES.includes(card.type);

  // Count filled fields in this section
  const filled = section.fields.filter((f) => {
    const v = (card.attributes || {})[f.key];
    return v != null && v !== "" && v !== false;
  }).length;

  const is2Col = section.columns === 2;

  // Build ordered column items: each item is either a group or a standalone field
  type ColumnItem = { kind: "field"; field: FieldDef } | { kind: "group"; name: string; fields: FieldDef[] };

  const buildColumnItems = (colNum: 0 | 1): ColumnItem[] => {
    const items: ColumnItem[] = [];
    const seenGroups = new Set<string>();
    for (const field of section.fields) {
      const fieldCol = is2Col ? (field.column ?? 0) : 0;
      if (fieldCol !== colNum) continue;
      if (field.group) {
        if (seenGroups.has(field.group)) continue;
        seenGroups.add(field.group);
        // Collect all fields in this group that belong to this column
        const gFields = section.fields.filter((f) => f.group === field.group && (is2Col ? (f.column ?? 0) : 0) === colNum);
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
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "180px 1fr" }, rowGap: 1, columnGap: 2, alignItems: { sm: "center" } }}>
      {fields.map((field) => (
        <Box key={field.key} sx={{ display: "contents" }}>
          <Typography variant="body2" color="text.secondary">
            {field.label}
            {calculatedFieldKeys.includes(field.key) ? (
              <Chip component="span" size="small" label="calculated" sx={{ height: 16, fontSize: "0.55rem", ml: 0.5, verticalAlign: "middle" }} />
            ) : field.readonly ? (
              <Chip component="span" size="small" label="auto" sx={{ height: 16, fontSize: "0.55rem", ml: 0.5, verticalAlign: "middle" }} />
            ) : null}
          </Typography>
          <FieldValue field={field} value={(card.attributes || {})[field.key]} currencyFmt={fmt} />
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
            <Typography variant="body2" color="text.secondary" sx={{ minWidth: 160 }}>{field.label}</Typography>
            <FieldValue field={field} value={attrs[field.key]} currencyFmt={fmt} />
            <Chip size="small" label={calculatedFieldKeys.includes(field.key) ? "calculated" : "auto"} sx={{ height: 18, fontSize: "0.6rem", ml: 0.5 }} />
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
          <FieldEditor
            key={field.key}
            field={field}
            value={attrs[field.key]}
            onChange={(v) => setAttr(field.key, v)}
            currencySymbol={symbol}
          />
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
                {item.name}
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

  // Render the full section body with column layout
  const renderSectionBody = (isEdit: boolean) => {
    if (!is2Col) return renderColumnItems(col0Items, isEdit);
    return (
      <Box sx={{ display: "flex", gap: 3, flexDirection: { xs: "column", sm: "row" } }}>
        <Box sx={{ flex: 1 }}>{renderColumnItems(col0Items, isEdit)}</Box>
        {col1Items.length > 0 && (
          <Box sx={{ flex: 1 }}>{renderColumnItems(col1Items, isEdit)}</Box>
        )}
      </Box>
    );
  };

  return (
    <Accordion defaultExpanded={expanded} disableGutters>
      <AccordionSummary expandIcon={<MaterialSymbol icon="expand_more" size={20} />}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1 }}>
          <MaterialSymbol icon="tune" size={20} color="#666" />
          <Typography fontWeight={600}>{section.section}</Typography>
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
          <Box>
            {renderSectionBody(true)}
            <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end", mt: 2 }}>
              <Button
                size="small"
                onClick={() => {
                  setAttrs(card.attributes || {});
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
              <Button size="small" variant="contained" onClick={save}>
                Save
              </Button>
            </Box>
          </Box>
        ) : (
          <Box>
            {renderSectionBody(false)}
          </Box>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

export default AttributeSection;
