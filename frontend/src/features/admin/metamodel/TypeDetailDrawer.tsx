import { useState, useEffect } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";
import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import Divider from "@mui/material/Divider";
import CircularProgress from "@mui/material/CircularProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import ColorPicker from "@/components/ColorPicker";
import IconPicker from "@/components/IconPicker";
import KeyInput, { isValidKey } from "@/components/KeyInput";
import CardLayoutEditor from "@/features/admin/CardLayoutEditor";
import { api } from "@/api/client";
import type {
  CardType as FSType,
  RelationType as RType,
  FieldDef,
  SectionDef,
} from "@/types";
import { emptyField } from "./helpers";
import FieldEditorDialog from "./FieldEditorDialog";
import StakeholderRolePanel from "./StakeholderRolePanel";

/* ------------------------------------------------------------------ */
/*  Type Detail Dialog (full-width, 2-panel layout)                    */
/* ------------------------------------------------------------------ */

export interface TypeDrawerProps {
  open: boolean;
  typeKey: string | null;
  types: FSType[];
  relationTypes: RType[];
  onClose: () => void;
  onRefresh: () => void;
  onCreateRelation: (preselectedTypeKey: string) => void;
}

export default function TypeDetailDrawer({
  open,
  typeKey,
  types,
  relationTypes,
  onClose,
  onRefresh,
  onCreateRelation,
}: TypeDrawerProps) {
  const cardTypeKey = types.find((t) => t.key === typeKey) || null;

  /* --- Editable header state --- */
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [color, setColor] = useState("#1976d2");
  const [icon, setIcon] = useState("category");
  const [hasHierarchy, setHasHierarchy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [snack, setSnack] = useState("");

  /* --- Subtype inline add --- */
  const [addSubOpen, setAddSubOpen] = useState(false);
  const [newSubKey, setNewSubKey] = useState("");
  const [newSubLabel, setNewSubLabel] = useState("");

  /* --- Field editor --- */
  const [fieldDialogOpen, setFieldDialogOpen] = useState(false);
  const [editingSectionIdx, setEditingSectionIdx] = useState(0);
  const [editingFieldIdx, setEditingFieldIdx] = useState<number | null>(null);
  const [editingField, setEditingField] = useState<FieldDef>(emptyField());

  /* --- Field deletion confirmation --- */
  const [deleteFieldConfirm, setDeleteFieldConfirm] = useState<{
    sectionIdx: number;
    fieldIdx: number;
    fieldKey: string;
    fieldLabel: string;
    cardCount: number | null; // null = loading
  } | null>(null);

  /* --- Section deletion confirmation --- */
  const [deleteSectionConfirm, setDeleteSectionConfirm] = useState<{
    sectionIdx: number;
    sectionName: string;
    fieldCount: number;
    cardCount: number | null; // null = loading
  } | null>(null);

  /* --- Add section --- */

  /* --- Calculated fields map (type_key → field_keys[]) --- */
  const [calculatedFieldKeys, setCalculatedFieldKeys] = useState<string[]>([]);
  useEffect(() => {
    if (!open || !cardTypeKey) return;
    api
      .get<Record<string, string[]>>("/calculations/calculated-fields")
      .then((map) => setCalculatedFieldKeys(map[cardTypeKey.key] || []))
      .catch(() => setCalculatedFieldKeys([]));
  }, [open, cardTypeKey]);

  /* Initialise local state from the type whenever the dialog opens or the type changes */
  useEffect(() => {
    if (cardTypeKey) {
      setLabel(cardTypeKey.label);
      setDescription(cardTypeKey.description || "");
      setCategory(cardTypeKey.category || "");
      setColor(cardTypeKey.color);
      setIcon(cardTypeKey.icon);
      setHasHierarchy(cardTypeKey.has_hierarchy);
      setError(null);
      setAddSubOpen(false);
      setDeleteFieldConfirm(null);
      setDeleteSectionConfirm(null);
    }
  }, [cardTypeKey]);

  if (!cardTypeKey) return null;

  const connectedRelations = relationTypes.filter(
    (r) => r.source_type_key === cardTypeKey.key || r.target_type_key === cardTypeKey.key,
  );

  /* --- Save header --- */
  const handleSaveHeader = async () => {
    setSaving(true);
    try {
      await api.patch(`/metamodel/types/${cardTypeKey.key}`, {
        label,
        description: description || undefined,
        category,
        color,
        icon,
        has_hierarchy: hasHierarchy,
      });
      onRefresh();
      setError(null);
      setSnack("Type saved");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  /* --- Subtypes --- */
  const handleAddSubtype = async () => {
    if (!newSubKey || !newSubLabel) return;
    try {
      const updated = [
        ...(cardTypeKey.subtypes || []),
        { key: newSubKey, label: newSubLabel },
      ];
      await api.patch(`/metamodel/types/${cardTypeKey.key}`, { subtypes: updated });
      onRefresh();
      setNewSubKey("");
      setNewSubLabel("");
      setAddSubOpen(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to add subtype");
    }
  };

  const handleRemoveSubtype = async (subKey: string) => {
    try {
      const updated = (cardTypeKey.subtypes || []).filter((s) => s.key !== subKey);
      await api.patch(`/metamodel/types/${cardTypeKey.key}`, { subtypes: updated });
      onRefresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to remove subtype");
    }
  };

  /* --- Fields --- */
  const openAddField = (sectionIdx: number) => {
    setEditingSectionIdx(sectionIdx);
    setEditingFieldIdx(null);
    setEditingField(emptyField());
    setFieldDialogOpen(true);
  };

  const openEditField = (sectionIdx: number, fieldIdx: number) => {
    setEditingSectionIdx(sectionIdx);
    setEditingFieldIdx(fieldIdx);
    setEditingField({ ...cardTypeKey.fields_schema[sectionIdx].fields[fieldIdx] });
    setFieldDialogOpen(true);
  };

  const handleSaveField = async (field: FieldDef) => {
    try {
      const schema: SectionDef[] = cardTypeKey.fields_schema.map((s) => ({
        ...s,
        fields: [...s.fields],
      }));
      if (editingFieldIdx !== null) {
        schema[editingSectionIdx].fields[editingFieldIdx] = field;
      } else {
        schema[editingSectionIdx].fields.push(field);
      }
      await api.patch(`/metamodel/types/${cardTypeKey.key}`, {
        fields_schema: schema,
      });
      onRefresh();
      setFieldDialogOpen(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save field");
    }
  };

  const promptDeleteField = (sectionIdx: number, fieldIdx: number) => {
    const field = cardTypeKey.fields_schema[sectionIdx].fields[fieldIdx];
    setDeleteFieldConfirm({
      sectionIdx,
      fieldIdx,
      fieldKey: field.key,
      fieldLabel: field.label,
      cardCount: null,
    });
    api
      .get<{ card_count: number }>(
        `/metamodel/types/${cardTypeKey.key}/field-usage?field_key=${encodeURIComponent(field.key)}`,
      )
      .then((r) => setDeleteFieldConfirm((prev) => (prev ? { ...prev, cardCount: r.card_count } : null)))
      .catch(() => setDeleteFieldConfirm((prev) => (prev ? { ...prev, cardCount: 0 } : null)));
  };

  const confirmDeleteField = async () => {
    if (!deleteFieldConfirm) return;
    const { sectionIdx, fieldIdx } = deleteFieldConfirm;
    setDeleteFieldConfirm(null);
    try {
      const schema: SectionDef[] = cardTypeKey.fields_schema.map((s) => ({
        ...s,
        fields: [...s.fields],
      }));
      schema[sectionIdx].fields.splice(fieldIdx, 1);
      await api.patch(`/metamodel/types/${cardTypeKey.key}`, {
        fields_schema: schema,
      });
      onRefresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete field");
    }
  };


  /* --- Section deletion --- */
  const promptDeleteSection = (sectionIdx: number) => {
    const section = cardTypeKey.fields_schema[sectionIdx];
    if (!section || section.section === "__description") return;
    const fieldKeys = section.fields.map((f) => f.key);
    setDeleteSectionConfirm({
      sectionIdx,
      sectionName: section.section,
      fieldCount: fieldKeys.length,
      cardCount: null,
    });
    if (fieldKeys.length === 0) {
      setDeleteSectionConfirm((prev) => (prev ? { ...prev, cardCount: 0 } : null));
    } else {
      api
        .get<{ card_count: number }>(
          `/metamodel/types/${cardTypeKey.key}/section-usage?field_keys=${encodeURIComponent(fieldKeys.join(","))}`,
        )
        .then((r) => setDeleteSectionConfirm((prev) => (prev ? { ...prev, cardCount: r.card_count } : null)))
        .catch(() => setDeleteSectionConfirm((prev) => (prev ? { ...prev, cardCount: 0 } : null)));
    }
  };

  const confirmDeleteSection = async () => {
    if (!deleteSectionConfirm) return;
    const { sectionIdx } = deleteSectionConfirm;
    setDeleteSectionConfirm(null);
    try {
      // Remove the section from fields_schema
      const schema = cardTypeKey.fields_schema.filter((_, i) => i !== sectionIdx);
      // Rebuild section_config.__order: remove the deleted custom:N key and re-index
      const secCfg = (cardTypeKey.section_config || {}) as Record<string, unknown> & { __order?: string[] };
      const customSections = cardTypeKey.fields_schema.filter((s) => s.section !== "__description");
      const deletedCustomIdx = customSections.findIndex(
        (s) => cardTypeKey.fields_schema.indexOf(s) === sectionIdx,
      );
      let newOrder = secCfg.__order as string[] | undefined;
      if (newOrder && Array.isArray(newOrder)) {
        // Remove the deleted key and re-index higher custom indices
        newOrder = newOrder
          .filter((k) => k !== `custom:${deletedCustomIdx}`)
          .map((k) => {
            if (k.startsWith("custom:")) {
              const idx = parseInt(k.split(":")[1], 10);
              if (idx > deletedCustomIdx) return `custom:${idx - 1}`;
            }
            return k;
          });
      }
      await api.patch(`/metamodel/types/${cardTypeKey.key}`, {
        fields_schema: schema,
        section_config: { ...secCfg, __order: newOrder },
      });
      onRefresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete section");
    }
  };

  /* --- Hide / Unhide --- */
  const handleToggleHidden = async () => {
    try {
      await api.patch(`/metamodel/types/${cardTypeKey.key}`, { is_hidden: !cardTypeKey.is_hidden });
      onRefresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update visibility");
    }
  };

  /* --- Render --- */
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="lg"
      PaperProps={{ sx: { height: "90vh", maxHeight: "90vh" } }}
    >
      {/* ---------- Header ---------- */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 3, py: 1.5,
          borderBottom: 1, borderColor: "divider",
          flexShrink: 0,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              bgcolor: color,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <MaterialSymbol icon={icon} size={22} color="#fff" />
          </Box>
          <Box>
            <Typography variant="h6" fontWeight={700} lineHeight={1.2}>
              {label || cardTypeKey.label}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {cardTypeKey.key}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
          <Tooltip title={cardTypeKey.is_hidden ? "Unhide type" : "Hide type"}>
            <IconButton size="small" onClick={handleToggleHidden}>
              <MaterialSymbol
                icon={cardTypeKey.is_hidden ? "visibility_off" : "visibility"}
                size={20}
                color={cardTypeKey.is_hidden ? "#f57c00" : "#999"}
              />
            </IconButton>
          </Tooltip>
          <Button
            variant="contained"
            size="small"
            onClick={handleSaveHeader}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
          <IconButton onClick={onClose}>
            <MaterialSymbol icon="close" size={22} />
          </IconButton>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mx: 3, mt: 1.5 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* ---------- Single scrollable body ---------- */}
      <Box sx={{ flex: 1, overflow: "auto", px: 4, py: 3 }}>
        {/* -- Type Properties -- */}
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>
          Type Properties
        </Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "1fr 1fr 1fr" }, gap: 2.5, mb: 1.5 }}>
          <TextField
            size="small"
            label="Label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <TextField
            size="small"
            label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            helperText="e.g. Business Architecture"
          />
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
              Icon
            </Typography>
            <IconPicker value={icon} onChange={setIcon} color={color} />
          </Box>
        </Box>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2.5, mb: 2.5 }}>
          <TextField
            size="small"
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            multiline
            rows={2}
          />
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            <ColorPicker
              value={color}
              onChange={setColor}
              disabled={!!cardTypeKey?.built_in}
              label={cardTypeKey?.built_in ? "Color (built-in)" : "Color"}
            />
            <FormControlLabel
              control={<Switch checked={hasHierarchy} onChange={(e) => setHasHierarchy(e.target.checked)} />}
              label="Supports Hierarchy (Parent / Child)"
            />
          </Box>
        </Box>

        {/* -- Subtypes + Relations (side by side) -- */}
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 3, mb: 3 }}>
          {/* Subtypes */}
          <Box>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
              Subtypes
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 1.5 }}>
              {(cardTypeKey.subtypes || []).map((s) => (
                <Chip
                  key={s.key}
                  label={`${s.label} (${s.key})`}
                  onDelete={() => handleRemoveSubtype(s.key)}
                  variant="outlined"
                  size="small"
                />
              ))}
              {(!cardTypeKey.subtypes || cardTypeKey.subtypes.length === 0) && (
                <Typography variant="body2" color="text.secondary">
                  No subtypes defined
                </Typography>
              )}
            </Box>
            {addSubOpen ? (
              <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                <KeyInput
                  size="small"
                  label="Key"
                  value={newSubKey}
                  onChange={setNewSubKey}
                  sx={{ flex: 1 }}
                />
                <TextField
                  size="small"
                  label="Label"
                  value={newSubLabel}
                  onChange={(e) => setNewSubLabel(e.target.value)}
                  sx={{ flex: 1 }}
                />
                <Button size="small" variant="contained" onClick={handleAddSubtype} disabled={!newSubKey || !newSubLabel || !isValidKey(newSubKey)}>
                  Add
                </Button>
                <IconButton size="small" onClick={() => { setAddSubOpen(false); setNewSubKey(""); setNewSubLabel(""); }}>
                  <MaterialSymbol icon="close" size={18} />
                </IconButton>
              </Box>
            ) : (
              <Button size="small" startIcon={<MaterialSymbol icon="add" size={16} />} onClick={() => setAddSubOpen(true)}>
                Add Subtype
              </Button>
            )}
          </Box>

          {/* Relations */}
          <Box>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
              Relations
            </Typography>
            {connectedRelations.length > 0 ? (
              <List dense disablePadding sx={{ mb: 1 }}>
                {connectedRelations.map((r) => {
                  const isSource = r.source_type_key === cardTypeKey.key;
                  const otherKey = isSource ? r.target_type_key : r.source_type_key;
                  const otherType = types.find((t) => t.key === otherKey);
                  return (
                    <ListItem key={r.key} sx={{ pl: 0, py: 0.25 }}>
                      <ListItemText
                        primary={
                          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
                            <Typography variant="body2" fontWeight={500}>
                              {isSource ? r.label : r.reverse_label || r.label}
                            </Typography>
                            <MaterialSymbol icon={isSource ? "arrow_forward" : "arrow_back"} size={14} color="#999" />
                            {otherType && (
                              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                                <Box sx={{ width: 12, height: 12, borderRadius: "50%", bgcolor: otherType.color, flexShrink: 0 }} />
                                <Typography variant="body2">{otherType.label}</Typography>
                              </Box>
                            )}
                            <Chip size="small" label={r.cardinality} variant="outlined" sx={{ height: 20, fontSize: 11 }} />
                          </Box>
                        }
                      />
                    </ListItem>
                  );
                })}
              </List>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                No relations connected to this type.
              </Typography>
            )}
            <Button size="small" startIcon={<MaterialSymbol icon="add" size={16} />} onClick={() => onCreateRelation(cardTypeKey.key)}>
              Add Relation
            </Button>
          </Box>
        </Box>

        {/* -- Stakeholder Roles -- */}
        <StakeholderRolePanel
          typeKey={cardTypeKey.key}
          onError={(msg) => setError(msg)}
        />

        <Divider sx={{ my: 3 }} />

        {/* -- Card Layout -- */}
        {cardTypeKey && (
          <CardLayoutEditor
            cardType={cardTypeKey}
            onRefresh={onRefresh}
            openAddField={openAddField}
            openEditField={openEditField}
            promptDeleteField={promptDeleteField}
            promptDeleteSection={promptDeleteSection}
            calculatedFieldKeys={calculatedFieldKeys}
          />
        )}
      </Box>

      {/* --- Field deletion confirmation dialog --- */}
      <Dialog open={!!deleteFieldConfirm} onClose={() => setDeleteFieldConfirm(null)} maxWidth="xs" fullWidth disableRestoreFocus>
        <DialogTitle>Delete Field</DialogTitle>
        <DialogContent>
          {deleteFieldConfirm && (
            <>
              <Typography variant="body2" sx={{ mb: 2 }}>
                Are you sure you want to delete the field <strong>"{deleteFieldConfirm.fieldLabel}"</strong> ({deleteFieldConfirm.fieldKey})?
              </Typography>
              {deleteFieldConfirm.cardCount === null ? (
                <Alert severity="info" icon={<CircularProgress size={18} />}>
                  Checking how many cards use this field...
                </Alert>
              ) : deleteFieldConfirm.cardCount > 0 ? (
                <Alert severity="warning">
                  <strong>{deleteFieldConfirm.cardCount} card(s)</strong> have data for this field. Deleting it will permanently remove that data from all of them.
                </Alert>
              ) : (
                <Alert severity="info">No cards have data for this field. It can be safely deleted.</Alert>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteFieldConfirm(null)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            disabled={deleteFieldConfirm?.cardCount === null}
            onClick={confirmDeleteField}
          >
            Delete Field
          </Button>
        </DialogActions>
      </Dialog>

      {/* --- Section deletion confirmation dialog --- */}
      <Dialog open={!!deleteSectionConfirm} onClose={() => setDeleteSectionConfirm(null)} maxWidth="xs" fullWidth disableRestoreFocus>
        <DialogTitle>Delete Section</DialogTitle>
        <DialogContent>
          {deleteSectionConfirm && (
            <>
              <Typography variant="body2" sx={{ mb: 2 }}>
                Are you sure you want to delete the section <strong>"{deleteSectionConfirm.sectionName}"</strong>
                {deleteSectionConfirm.fieldCount > 0
                  ? ` and its ${deleteSectionConfirm.fieldCount} field(s)?`
                  : "?"}
              </Typography>
              {deleteSectionConfirm.cardCount === null ? (
                <Alert severity="info" icon={<CircularProgress size={18} />}>
                  Checking how many cards use fields in this section...
                </Alert>
              ) : deleteSectionConfirm.fieldCount === 0 ? (
                <Alert severity="info">This section has no fields. It can be safely deleted.</Alert>
              ) : deleteSectionConfirm.cardCount > 0 ? (
                <Alert severity="warning">
                  <strong>{deleteSectionConfirm.cardCount} card(s)</strong> have data for fields in this section. Deleting it will permanently remove that data from all of them.
                </Alert>
              ) : (
                <Alert severity="info">No cards have data for fields in this section. It can be safely deleted.</Alert>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteSectionConfirm(null)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            disabled={deleteSectionConfirm?.cardCount === null}
            onClick={confirmDeleteSection}
          >
            Delete Section
          </Button>
        </DialogActions>
      </Dialog>

      {/* --- Field editor dialog --- */}
      <FieldEditorDialog
        open={fieldDialogOpen}
        field={editingField}
        typeKey={cardTypeKey.key}
        fieldKey={editingField.key}
        isCalculated={calculatedFieldKeys.includes(editingField.key)}
        onClose={() => setFieldDialogOpen(false)}
        onSave={handleSaveField}
      />

      <Snackbar
        open={!!snack}
        autoHideDuration={4000}
        onClose={() => setSnack("")}
        message={snack}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Dialog>
  );
}
