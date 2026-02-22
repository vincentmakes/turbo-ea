import { useState, useEffect } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Alert from "@mui/material/Alert";
import MaterialSymbol from "@/components/MaterialSymbol";
import { FieldValue, FieldEditor, isValidUrl, URL_ERROR_MSG } from "@/features/cards/sections/cardDetailUtils";
import { ApiError } from "@/api/client";
import type { Card, FieldDef } from "@/types";

// ── Section: Description ────────────────────────────────────────
function DescriptionSection({
  card,
  onSave,
  canEdit = true,
  initialExpanded = true,
  extraFields,
  currencyFmt,
}: {
  card: Card;
  onSave: (u: Record<string, unknown>) => Promise<void>;
  canEdit?: boolean;
  initialExpanded?: boolean;
  extraFields?: FieldDef[];
  currencyFmt?: Intl.NumberFormat;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(card.name);
  const [description, setDescription] = useState(card.description || "");
  const [attrs, setAttrs] = useState<Record<string, unknown>>(card.attributes || {});
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setName(card.name);
    setDescription(card.description || "");
    setAttrs(card.attributes || {});
  }, [card.name, card.description, card.attributes]);

  // URL validation for extra fields
  const urlErrors: Record<string, string> = {};
  if (extraFields) {
    for (const f of extraFields) {
      if (f.type === "url") {
        const val = attrs[f.key];
        if (typeof val === "string" && val && !isValidUrl(val)) {
          urlErrors[f.key] = URL_ERROR_MSG;
        }
      }
    }
  }
  const hasValidationErrors = Object.keys(urlErrors).length > 0;

  const save = async () => {
    if (hasValidationErrors) return;
    setSaveError(null);
    try {
      const updates: Record<string, unknown> = { name, description };
      if (extraFields && extraFields.length > 0) {
        updates.attributes = { ...(card.attributes || {}), ...attrs };
      }
      await onSave(updates);
      setEditing(false);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      setSaveError(msg);
    }
  };

  return (
    <Accordion defaultExpanded={initialExpanded} disableGutters>
      <AccordionSummary expandIcon={<MaterialSymbol icon="expand_more" size={20} />}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1 }}>
          <MaterialSymbol icon="description" size={20} />
          <Typography fontWeight={600}>Description</Typography>
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
            <TextField
              fullWidth
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              size="small"
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              multiline
              rows={4}
              size="small"
              sx={{ mb: 2 }}
            />
            {extraFields && extraFields.map((field) => (
              <Box key={field.key} sx={{ mb: 2 }}>
                <FieldEditor field={field} value={attrs[field.key]} onChange={(v) => setAttrs((prev) => ({ ...prev, [field.key]: v }))} error={urlErrors[field.key]} />
              </Box>
            ))}
            {saveError && (
              <Alert severity="error" sx={{ mb: 1 }} onClose={() => setSaveError(null)}>
                {saveError}
              </Alert>
            )}
            <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
              <Button
                size="small"
                onClick={() => {
                  setName(card.name);
                  setDescription(card.description || "");
                  setAttrs(card.attributes || {});
                  setEditing(false);
                  setSaveError(null);
                }}
              >
                Cancel
              </Button>
              <Button size="small" variant="contained" onClick={save} disabled={hasValidationErrors}>
                Save
              </Button>
            </Box>
          </Box>
        ) : (
          <Box>
            <Typography variant="body2" color="text.secondary" whiteSpace="pre-wrap" sx={{ mb: extraFields?.length ? 1 : 0 }}>
              {card.description || "No description provided."}
            </Typography>
            {extraFields && extraFields.length > 0 && (
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "180px 1fr" }, rowGap: 1, columnGap: 2, alignItems: { sm: "center" } }}>
                {extraFields.map((field) => (
                  <Box key={field.key} sx={{ display: "contents" }}>
                    <Typography variant="body2" color="text.secondary">{field.label}</Typography>
                    <FieldValue field={field} value={(card.attributes || {})[field.key]} currencyFmt={currencyFmt} />
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

export default DescriptionSection;
