import { useState, useEffect, useCallback, useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Chip from "@mui/material/Chip";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";
import Alert from "@mui/material/Alert";
import Divider from "@mui/material/Divider";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useMetamodel } from "@/hooks/useMetamodel";
import { api } from "@/api/client";
import type {
  FactSheetType as FSType,
  RelationType as RType,
  FieldDef,
  FieldOption,
  SectionDef,
} from "@/types";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const FIELD_TYPE_OPTIONS: { value: FieldDef["type"]; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Boolean" },
  { value: "date", label: "Date" },
  { value: "single_select", label: "Single Select" },
  { value: "multiple_select", label: "Multiple Select" },
];

const CATEGORIES = [
  "Strategy & Transformation",
  "Business Architecture",
  "Application & Data",
  "Technical Architecture",
];

const LAYER_ORDER = [...CATEGORIES, "Other"];

const CARDINALITY_OPTIONS: ("1:1" | "1:n" | "n:m")[] = ["1:1", "1:n", "n:m"];

/* ------------------------------------------------------------------ */
/*  Graph layout constants                                             */
/* ------------------------------------------------------------------ */

const NODE_W = 160;
const NODE_H = 56;
const NODE_RX = 12;
const NODE_GAP_X = 48;
const LAYER_GAP_Y = 120;
const PAD_X = 80;
const PAD_Y = 60;
const LAYER_LABEL_W = 180;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fieldTypeColor(type: FieldDef["type"]): string {
  const map: Record<string, string> = {
    text: "#1976d2",
    number: "#ed6c02",
    boolean: "#9c27b0",
    date: "#2e7d32",
    single_select: "#0288d1",
    multiple_select: "#7b1fa2",
  };
  return map[type] || "#757575";
}

function emptyField(): FieldDef {
  return { key: "", label: "", type: "text", required: false, weight: 0 };
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "\u2026" : text;
}

/* ------------------------------------------------------------------ */
/*  Field Editor Dialog                                                */
/* ------------------------------------------------------------------ */

interface FieldEditorProps {
  open: boolean;
  field: FieldDef;
  onClose: () => void;
  onSave: (field: FieldDef) => void;
}

function FieldEditorDialog({ open, field: initial, onClose, onSave }: FieldEditorProps) {
  const [field, setField] = useState<FieldDef>(initial);

  useEffect(() => {
    if (open) setField({ ...initial });
  }, [open, initial]);

  const isSelect = field.type === "single_select" || field.type === "multiple_select";

  const updateOption = (idx: number, patch: Partial<FieldOption>) => {
    const opts = [...(field.options || [])];
    opts[idx] = { ...opts[idx], ...patch };
    setField({ ...field, options: opts });
  };

  const addOption = () => {
    setField({
      ...field,
      options: [...(field.options || []), { key: "", label: "" }],
    });
  };

  const removeOption = (idx: number) => {
    const opts = [...(field.options || [])];
    opts.splice(idx, 1);
    setField({ ...field, options: opts });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{initial.key ? "Edit Field" : "Add Field"}</DialogTitle>
      <DialogContent>
        <TextField
          fullWidth
          label="Key"
          value={field.key}
          onChange={(e) => setField({ ...field, key: e.target.value })}
          sx={{ mt: 1, mb: 2 }}
          disabled={!!initial.key}
        />
        <TextField
          fullWidth
          label="Label"
          value={field.label}
          onChange={(e) => setField({ ...field, label: e.target.value })}
          sx={{ mb: 2 }}
        />
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>Type</InputLabel>
          <Select
            value={field.type}
            label="Type"
            onChange={(e) =>
              setField({ ...field, type: e.target.value as FieldDef["type"] })
            }
          >
            {FIELD_TYPE_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Box sx={{ display: "flex", gap: 2, mb: 2, alignItems: "center" }}>
          <FormControlLabel
            control={
              <Switch
                checked={!!field.required}
                onChange={(e) =>
                  setField({ ...field, required: e.target.checked })
                }
              />
            }
            label="Required"
          />
          <TextField
            label="Weight"
            type="number"
            value={field.weight ?? 0}
            onChange={(e) =>
              setField({ ...field, weight: Number(e.target.value) })
            }
            sx={{ width: 120 }}
            size="small"
          />
        </Box>
        {isSelect && (
          <>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Options
            </Typography>
            {(field.options || []).map((opt, idx) => (
              <Box
                key={idx}
                sx={{ display: "flex", gap: 1, mb: 1, alignItems: "center" }}
              >
                <TextField
                  size="small"
                  label="Key"
                  value={opt.key}
                  onChange={(e) => updateOption(idx, { key: e.target.value })}
                  sx={{ flex: 1 }}
                />
                <TextField
                  size="small"
                  label="Label"
                  value={opt.label}
                  onChange={(e) => updateOption(idx, { label: e.target.value })}
                  sx={{ flex: 1 }}
                />
                <TextField
                  size="small"
                  type="color"
                  value={opt.color || "#1976d2"}
                  onChange={(e) => updateOption(idx, { color: e.target.value })}
                  sx={{ width: 56, p: 0 }}
                />
                <IconButton size="small" onClick={() => removeOption(idx)}>
                  <MaterialSymbol icon="close" size={18} />
                </IconButton>
              </Box>
            ))}
            <Button
              size="small"
              startIcon={<MaterialSymbol icon="add" size={16} />}
              onClick={addOption}
            >
              Add Option
            </Button>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => onSave(field)}
          disabled={!field.key || !field.label}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Type Detail Drawer                                                 */
/* ------------------------------------------------------------------ */

interface TypeDrawerProps {
  open: boolean;
  typeKey: string | null;
  types: FSType[];
  relationTypes: RType[];
  onClose: () => void;
  onRefresh: () => void;
  onCreateRelation: (preselectedTypeKey: string) => void;
}

function TypeDetailDrawer({
  open,
  typeKey,
  types,
  relationTypes,
  onClose,
  onRefresh,
  onCreateRelation,
}: TypeDrawerProps) {
  const fsType = types.find((t) => t.key === typeKey) || null;

  /* --- Editable header state --- */
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [color, setColor] = useState("#1976d2");
  const [icon, setIcon] = useState("category");
  const [hasHierarchy, setHasHierarchy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /* --- Subtype inline add --- */
  const [addSubOpen, setAddSubOpen] = useState(false);
  const [newSubKey, setNewSubKey] = useState("");
  const [newSubLabel, setNewSubLabel] = useState("");

  /* --- Field editor --- */
  const [fieldDialogOpen, setFieldDialogOpen] = useState(false);
  const [editingSectionIdx, setEditingSectionIdx] = useState(0);
  const [editingFieldIdx, setEditingFieldIdx] = useState<number | null>(null);
  const [editingField, setEditingField] = useState<FieldDef>(emptyField());

  /* --- Add section --- */
  const [addSectionOpen, setAddSectionOpen] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");

  /* --- Subscription roles --- */
  const [addRoleOpen, setAddRoleOpen] = useState(false);
  const [newRoleKey, setNewRoleKey] = useState("");
  const [newRoleLabel, setNewRoleLabel] = useState("");

  /* Initialise local state from the type whenever the drawer opens or the type changes */
  useEffect(() => {
    if (fsType) {
      setLabel(fsType.label);
      setDescription(fsType.description || "");
      setCategory(fsType.category || "");
      setColor(fsType.color);
      setIcon(fsType.icon);
      setHasHierarchy(fsType.has_hierarchy);
      setError(null);
      setAddSubOpen(false);
      setAddSectionOpen(false);
    }
  }, [fsType]);

  if (!fsType) return null;

  const connectedRelations = relationTypes.filter(
    (r) => r.source_type_key === fsType.key || r.target_type_key === fsType.key,
  );

  /* --- Save header --- */
  const handleSaveHeader = async () => {
    setSaving(true);
    try {
      await api.patch(`/metamodel/types/${fsType.key}`, {
        label,
        description: description || undefined,
        category,
        color,
        icon,
        has_hierarchy: hasHierarchy,
      });
      onRefresh();
      setError(null);
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
        ...(fsType.subtypes || []),
        { key: newSubKey, label: newSubLabel },
      ];
      await api.patch(`/metamodel/types/${fsType.key}`, { subtypes: updated });
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
      const updated = (fsType.subtypes || []).filter((s) => s.key !== subKey);
      await api.patch(`/metamodel/types/${fsType.key}`, { subtypes: updated });
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
    setEditingField({ ...fsType.fields_schema[sectionIdx].fields[fieldIdx] });
    setFieldDialogOpen(true);
  };

  const handleSaveField = async (field: FieldDef) => {
    try {
      const schema: SectionDef[] = fsType.fields_schema.map((s) => ({
        ...s,
        fields: [...s.fields],
      }));
      if (editingFieldIdx !== null) {
        schema[editingSectionIdx].fields[editingFieldIdx] = field;
      } else {
        schema[editingSectionIdx].fields.push(field);
      }
      await api.patch(`/metamodel/types/${fsType.key}`, {
        fields_schema: schema,
      });
      onRefresh();
      setFieldDialogOpen(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save field");
    }
  };

  const handleDeleteField = async (sectionIdx: number, fieldIdx: number) => {
    try {
      const schema: SectionDef[] = fsType.fields_schema.map((s) => ({
        ...s,
        fields: [...s.fields],
      }));
      schema[sectionIdx].fields.splice(fieldIdx, 1);
      await api.patch(`/metamodel/types/${fsType.key}`, {
        fields_schema: schema,
      });
      onRefresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete field");
    }
  };

  const handleAddSection = async () => {
    if (!newSectionName) return;
    try {
      const schema: SectionDef[] = [
        ...fsType.fields_schema,
        { section: newSectionName, fields: [] },
      ];
      await api.patch(`/metamodel/types/${fsType.key}`, {
        fields_schema: schema,
      });
      onRefresh();
      setNewSectionName("");
      setAddSectionOpen(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to add section");
    }
  };

  /* --- Subscription Roles --- */
  const handleAddRole = async () => {
    if (!newRoleKey || !newRoleLabel) return;
    try {
      const updated = [...(fsType.subscription_roles || []), { key: newRoleKey, label: newRoleLabel }];
      await api.patch(`/metamodel/types/${fsType.key}`, { subscription_roles: updated });
      onRefresh();
      setNewRoleKey("");
      setNewRoleLabel("");
      setAddRoleOpen(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to add role");
    }
  };

  const handleRemoveRole = async (roleKey: string) => {
    try {
      const updated = (fsType.subscription_roles || []).filter((r) => r.key !== roleKey);
      await api.patch(`/metamodel/types/${fsType.key}`, { subscription_roles: updated });
      onRefresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to remove role");
    }
  };

  /* --- Hide / Unhide --- */
  const handleToggleHidden = async () => {
    try {
      await api.patch(`/metamodel/types/${fsType.key}`, { is_hidden: !fsType.is_hidden });
      onRefresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update visibility");
    }
  };

  /* --- Render --- */
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: 600 } }}
    >
      <Box sx={{ p: 3, height: "100%", overflow: "auto" }}>
        {/* ---------- Header ---------- */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            mb: 2,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: "50%",
                bgcolor: color,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <MaterialSymbol icon={icon} size={24} color="#fff" />
            </Box>
            <Box>
              <Typography variant="h6" fontWeight={700} lineHeight={1.2}>
                {label || fsType.label}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {fsType.key}
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            <Tooltip title={fsType.is_hidden ? "Unhide type" : "Hide type"}>
              <IconButton size="small" onClick={handleToggleHidden}>
                <MaterialSymbol
                  icon={fsType.is_hidden ? "visibility_off" : "visibility"}
                  size={20}
                  color={fsType.is_hidden ? "#f57c00" : "#999"}
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
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* ---------- Editable fields ---------- */}
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mb: 3 }}>
          <TextField
            size="small"
            label="Label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <TextField
            size="small"
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            multiline
            rows={2}
          />
          <TextField
            size="small"
            label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            helperText="Free text. Common values: Strategy & Transformation, Business Architecture, Application & Data, Technical Architecture"
          />
          <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
            <TextField
              size="small"
              label="Icon name"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              sx={{ flex: 1 }}
              helperText="Material Symbols Outlined name"
            />
            <Box
              sx={{
                width: 40,
                height: 40,
                borderRadius: 1,
                bgcolor: "action.hover",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <MaterialSymbol icon={icon} size={24} color={color} />
            </Box>
          </Box>
          <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
            <TextField
              size="small"
              label="Color"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              sx={{ width: 120 }}
            />
            <Box
              sx={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                bgcolor: color,
                border: "1px solid",
                borderColor: "divider",
              }}
            />
            <Typography variant="body2" color="text.secondary">
              {color}
            </Typography>
          </Box>
          <FormControlLabel
            control={
              <Switch
                checked={hasHierarchy}
                onChange={(e) => setHasHierarchy(e.target.checked)}
              />
            }
            label="Supports Hierarchy (Parent / Child)"
          />
        </Box>

        <Divider sx={{ mb: 2 }} />

        {/* ---------- Subtypes ---------- */}
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
          Subtypes
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 1 }}>
          {(fsType.subtypes || []).map((s) => (
            <Chip
              key={s.key}
              label={`${s.label} (${s.key})`}
              onDelete={() => handleRemoveSubtype(s.key)}
              variant="outlined"
              size="small"
            />
          ))}
          {(!fsType.subtypes || fsType.subtypes.length === 0) && (
            <Typography variant="body2" color="text.secondary">
              No subtypes defined
            </Typography>
          )}
        </Box>
        {addSubOpen ? (
          <Box
            sx={{ display: "flex", gap: 1, alignItems: "center", mt: 1, mb: 2 }}
          >
            <TextField
              size="small"
              label="Key"
              value={newSubKey}
              onChange={(e) => setNewSubKey(e.target.value)}
              sx={{ flex: 1 }}
            />
            <TextField
              size="small"
              label="Label"
              value={newSubLabel}
              onChange={(e) => setNewSubLabel(e.target.value)}
              sx={{ flex: 1 }}
            />
            <Button
              size="small"
              variant="contained"
              onClick={handleAddSubtype}
              disabled={!newSubKey || !newSubLabel}
            >
              Add
            </Button>
            <IconButton
              size="small"
              onClick={() => {
                setAddSubOpen(false);
                setNewSubKey("");
                setNewSubLabel("");
              }}
            >
              <MaterialSymbol icon="close" size={18} />
            </IconButton>
          </Box>
        ) : (
          <Button
            size="small"
            startIcon={<MaterialSymbol icon="add" size={16} />}
            onClick={() => setAddSubOpen(true)}
            sx={{ mb: 2 }}
          >
            Add Subtype
          </Button>
        )}

        <Divider sx={{ mb: 2 }} />

        {/* ---------- Subscription Roles ---------- */}
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
          Subscription Roles
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 1 }}>
          {(fsType.subscription_roles || []).map((r) => (
            <Chip
              key={r.key}
              label={`${r.label} (${r.key})`}
              onDelete={() => handleRemoveRole(r.key)}
              variant="outlined"
              size="small"
            />
          ))}
          {(!fsType.subscription_roles || fsType.subscription_roles.length === 0) && (
            <Typography variant="body2" color="text.secondary">
              No roles defined (defaults: Responsible, Observer)
            </Typography>
          )}
        </Box>
        {addRoleOpen ? (
          <Box sx={{ display: "flex", gap: 1, alignItems: "center", mt: 1, mb: 2 }}>
            <TextField
              size="small"
              label="Key"
              value={newRoleKey}
              onChange={(e) => setNewRoleKey(e.target.value.replace(/\s+/g, "_").toLowerCase())}
              sx={{ flex: 1 }}
              placeholder="e.g. data_steward"
            />
            <TextField
              size="small"
              label="Label"
              value={newRoleLabel}
              onChange={(e) => setNewRoleLabel(e.target.value)}
              sx={{ flex: 1 }}
              placeholder="e.g. Data Steward"
            />
            <Button
              size="small"
              variant="contained"
              onClick={handleAddRole}
              disabled={!newRoleKey || !newRoleLabel}
            >
              Add
            </Button>
            <IconButton
              size="small"
              onClick={() => {
                setAddRoleOpen(false);
                setNewRoleKey("");
                setNewRoleLabel("");
              }}
            >
              <MaterialSymbol icon="close" size={18} />
            </IconButton>
          </Box>
        ) : (
          <Button
            size="small"
            startIcon={<MaterialSymbol icon="add" size={16} />}
            onClick={() => setAddRoleOpen(true)}
            sx={{ mb: 2 }}
          >
            Add Role
          </Button>
        )}

        <Divider sx={{ mb: 2 }} />

        {/* ---------- Fields ---------- */}
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
          Fields
        </Typography>
        {fsType.fields_schema.map((section, si) => (
          <Accordion
            key={si}
            defaultExpanded
            variant="outlined"
            disableGutters
            sx={{ mb: 1, "&:before": { display: "none" } }}
          >
            <AccordionSummary
              expandIcon={<MaterialSymbol icon="expand_more" size={20} />}
            >
              <Typography fontWeight={600} sx={{ mr: 1 }}>
                {section.section}
              </Typography>
              <Chip
                size="small"
                label={section.fields.length}
                sx={{ height: 20, fontSize: 11 }}
              />
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              <List dense disablePadding>
                {section.fields.map((f, fi) => (
                  <ListItem
                    key={f.key}
                    secondaryAction={
                      <Box sx={{ display: "flex", gap: 0.25 }}>
                        <IconButton
                          size="small"
                          onClick={() => openEditField(si, fi)}
                        >
                          <MaterialSymbol icon="edit" size={18} />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={() => handleDeleteField(si, fi)}
                        >
                          <MaterialSymbol icon="delete" size={18} />
                        </IconButton>
                      </Box>
                    }
                  >
                    <ListItemText
                      primary={
                        <Box
                          sx={{ display: "flex", alignItems: "center", gap: 1 }}
                        >
                          <Typography variant="body2" fontWeight={500}>
                            {f.label}
                          </Typography>
                          <Chip
                            size="small"
                            label={f.type}
                            sx={{
                              bgcolor: fieldTypeColor(f.type),
                              color: "#fff",
                              height: 20,
                              fontSize: 11,
                            }}
                          />
                          {f.required && (
                            <Chip
                              size="small"
                              label="Required"
                              color="error"
                              variant="outlined"
                              sx={{ height: 20, fontSize: 11 }}
                            />
                          )}
                        </Box>
                      }
                      secondary={`Weight: ${f.weight ?? 0}`}
                    />
                  </ListItem>
                ))}
              </List>
              <Button
                size="small"
                startIcon={<MaterialSymbol icon="add" size={16} />}
                onClick={() => openAddField(si)}
                sx={{ mt: 0.5 }}
              >
                Add Field
              </Button>
            </AccordionDetails>
          </Accordion>
        ))}
        {fsType.fields_schema.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            No field sections yet.
          </Typography>
        )}
        {addSectionOpen ? (
          <Box
            sx={{ display: "flex", gap: 1, alignItems: "center", mt: 1, mb: 2 }}
          >
            <TextField
              size="small"
              label="Section Name"
              value={newSectionName}
              onChange={(e) => setNewSectionName(e.target.value)}
              sx={{ flex: 1 }}
            />
            <Button
              size="small"
              variant="contained"
              onClick={handleAddSection}
              disabled={!newSectionName}
            >
              Add
            </Button>
            <IconButton
              size="small"
              onClick={() => {
                setAddSectionOpen(false);
                setNewSectionName("");
              }}
            >
              <MaterialSymbol icon="close" size={18} />
            </IconButton>
          </Box>
        ) : (
          <Button
            size="small"
            startIcon={<MaterialSymbol icon="add" size={16} />}
            onClick={() => setAddSectionOpen(true)}
            sx={{ mb: 2 }}
          >
            Add Section
          </Button>
        )}

        <Divider sx={{ mb: 2 }} />

        {/* ---------- Relations ---------- */}
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
          Relations
        </Typography>
        <List dense disablePadding>
          {connectedRelations.map((r) => {
            const isSource = r.source_type_key === fsType.key;
            const otherKey = isSource
              ? r.target_type_key
              : r.source_type_key;
            const otherType = types.find((t) => t.key === otherKey);
            return (
              <ListItem key={r.key} sx={{ pl: 0 }}>
                <ListItemText
                  primary={
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        flexWrap: "wrap",
                      }}
                    >
                      <Typography variant="body2" fontWeight={500}>
                        {isSource
                          ? r.label
                          : r.reverse_label || r.label}
                      </Typography>
                      <MaterialSymbol
                        icon={isSource ? "arrow_forward" : "arrow_back"}
                        size={16}
                        color="#999"
                      />
                      {otherType && (
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 0.5,
                          }}
                        >
                          <Box
                            sx={{
                              width: 14,
                              height: 14,
                              borderRadius: "50%",
                              bgcolor: otherType.color,
                              flexShrink: 0,
                            }}
                          />
                          <MaterialSymbol
                            icon={otherType.icon}
                            size={16}
                            color={otherType.color}
                          />
                          <Typography variant="body2">
                            {otherType.label}
                          </Typography>
                        </Box>
                      )}
                      <Chip
                        size="small"
                        label={r.cardinality}
                        variant="outlined"
                        sx={{ height: 20, fontSize: 11 }}
                      />
                    </Box>
                  }
                />
              </ListItem>
            );
          })}
        </List>
        {connectedRelations.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            No relations connected to this type.
          </Typography>
        )}
        <Button
          size="small"
          startIcon={<MaterialSymbol icon="add" size={16} />}
          onClick={() => onCreateRelation(fsType.key)}
        >
          Add Relation
        </Button>
      </Box>

      {/* --- Field editor dialog (rendered inside the drawer portal) --- */}
      <FieldEditorDialog
        open={fieldDialogOpen}
        field={editingField}
        onClose={() => setFieldDialogOpen(false)}
        onSave={handleSaveField}
      />
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */
/*  Metamodel Graph  (SVG)                                             */
/* ------------------------------------------------------------------ */

interface GraphProps {
  types: FSType[];
  relationTypes: RType[];
  onNodeClick: (key: string) => void;
}

function MetamodelGraph({ types, relationTypes, onNodeClick }: GraphProps) {
  const visibleTypes = types.filter((t) => !t.is_hidden);

  /* --- Build layers --- */
  const layers = useMemo(() => {
    const byCategory: Record<string, FSType[]> = {};
    for (const t of visibleTypes) {
      const cat = CATEGORIES.includes(t.category || "")
        ? t.category!
        : "Other";
      (byCategory[cat] ??= []).push(t);
    }
    return LAYER_ORDER.map((cat) => ({
      category: cat,
      nodes: byCategory[cat] || [],
    })).filter((l) => l.nodes.length > 0);
  }, [visibleTypes]);

  /* --- Compute positions --- */
  const layout = useMemo(() => {
    const map: Record<string, { x: number; y: number }> = {};
    const maxNodes = Math.max(...layers.map((l) => l.nodes.length), 1);
    const contentW =
      maxNodes * NODE_W + (maxNodes - 1) * NODE_GAP_X;
    const svgW = contentW + PAD_X * 2 + LAYER_LABEL_W;

    layers.forEach((layer, li) => {
      const n = layer.nodes.length;
      const layerW = n * NODE_W + (n - 1) * NODE_GAP_X;
      const startX = LAYER_LABEL_W + PAD_X + (contentW - layerW) / 2;
      const y = PAD_Y + li * (NODE_H + LAYER_GAP_Y);
      layer.nodes.forEach((node, ni) => {
        map[node.key] = {
          x: startX + ni * (NODE_W + NODE_GAP_X),
          y,
        };
      });
    });

    const svgH =
      layers.length * NODE_H +
      (layers.length - 1) * LAYER_GAP_Y +
      PAD_Y * 2;

    return { map, svgW, svgH, contentW };
  }, [layers]);

  /* --- Build edges --- */
  const edges = useMemo(() => {
    return relationTypes
      .filter(
        (r) =>
          layout.map[r.source_type_key] && layout.map[r.target_type_key],
      )
      .map((r) => {
        const src = layout.map[r.source_type_key];
        const tgt = layout.map[r.target_type_key];
        const srcCx = src.x + NODE_W / 2;
        const tgtCx = tgt.x + NODE_W / 2;

        let d: string;
        let labelX: number;
        let labelY: number;

        if (src.y < tgt.y) {
          /* Source layer is above target layer */
          const srcBotY = src.y + NODE_H;
          const tgtTopY = tgt.y;
          const midY = (srcBotY + tgtTopY) / 2;
          d = `M${srcCx},${srcBotY} C${srcCx},${midY} ${tgtCx},${midY} ${tgtCx},${tgtTopY}`;
          labelX = (srcCx + tgtCx) / 2;
          labelY = midY;
        } else if (src.y > tgt.y) {
          /* Source layer is below target layer */
          const srcTopY = src.y;
          const tgtBotY = tgt.y + NODE_H;
          const midY = (srcTopY + tgtBotY) / 2;
          d = `M${srcCx},${srcTopY} C${srcCx},${midY} ${tgtCx},${midY} ${tgtCx},${tgtBotY}`;
          labelX = (srcCx + tgtCx) / 2;
          labelY = midY;
        } else {
          /* Same layer -- arc below the nodes */
          const botY = src.y + NODE_H;
          const arcDrop = 50 + Math.abs(srcCx - tgtCx) * 0.15;
          const cpY = botY + arcDrop;
          d = `M${srcCx},${botY} C${srcCx},${cpY} ${tgtCx},${cpY} ${tgtCx},${botY}`;
          labelX = (srcCx + tgtCx) / 2;
          labelY = cpY - 6;
        }

        return { key: r.key, d, label: r.label, labelX, labelY };
      });
  }, [relationTypes, layout]);

  /* --- Category label y positions --- */
  const layerLabels = useMemo(() => {
    return layers.map((layer, li) => ({
      label: layer.category,
      y: PAD_Y + li * (NODE_H + LAYER_GAP_Y),
    }));
  }, [layers]);

  if (visibleTypes.length === 0) {
    return (
      <Box sx={{ p: 4, textAlign: "center" }}>
        <Typography color="text.secondary">
          No visible types to display. Create some fact sheet types first.
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        overflow: "auto",
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        bgcolor: "#fafbfc",
      }}
    >
      <svg
        width={layout.svgW}
        height={layout.svgH}
        style={{ display: "block", minWidth: layout.svgW }}
      >
        <defs>
          <marker
            id="mm-arrow"
            markerWidth="10"
            markerHeight="7"
            refX="10"
            refY="3.5"
            orient="auto"
          >
            <path d="M0,0 L10,3.5 L0,7 Z" fill="#b0b0b0" />
          </marker>
          <filter
            id="mm-shadow"
            x="-8%"
            y="-8%"
            width="120%"
            height="140%"
          >
            <feDropShadow
              dx="0"
              dy="2"
              stdDeviation="4"
              floodColor="#000"
              floodOpacity="0.12"
            />
          </filter>
        </defs>

        {/* ---- Layer backgrounds + labels ---- */}
        {layerLabels.map((ll) => (
          <g key={ll.label}>
            <rect
              x={LAYER_LABEL_W - 4}
              y={ll.y - 16}
              width={layout.svgW - LAYER_LABEL_W + 4 - PAD_X + 20}
              height={NODE_H + 32}
              rx={10}
              fill="#f0f1f3"
              stroke="#e2e4e8"
              strokeWidth={1}
              strokeDasharray="6 3"
            />
            <text
              x={16}
              y={ll.y + NODE_H / 2 + 5}
              fontSize={12}
              fontWeight={600}
              fill="#8a8f98"
              fontFamily="Inter, Roboto, system-ui, sans-serif"
            >
              {ll.label}
            </text>
          </g>
        ))}

        {/* ---- Edges ---- */}
        {edges.map((e) => (
          <g key={e.key}>
            <path
              d={e.d}
              fill="none"
              stroke="#c0c4cc"
              strokeWidth={1.5}
              markerEnd="url(#mm-arrow)"
            />
            <rect
              x={e.labelX - 36}
              y={e.labelY - 9}
              width={72}
              height={18}
              rx={4}
              fill="#fff"
              fillOpacity={0.9}
              stroke="#e0e0e0"
              strokeWidth={0.5}
            />
            <text
              x={e.labelX}
              y={e.labelY + 4}
              textAnchor="middle"
              fontSize={10}
              fill="#777"
              fontFamily="Inter, Roboto, system-ui, sans-serif"
            >
              {truncate(e.label, 14)}
            </text>
          </g>
        ))}

        {/* ---- Nodes ---- */}
        {visibleTypes.map((t) => {
          const pos = layout.map[t.key];
          if (!pos) return null;
          return (
            <g
              key={t.key}
              style={{ cursor: "pointer" }}
              onClick={() => onNodeClick(t.key)}
            >
              <rect
                x={pos.x}
                y={pos.y}
                width={NODE_W}
                height={NODE_H}
                rx={NODE_RX}
                fill={t.color}
                filter="url(#mm-shadow)"
              />
              {/* Icon via Material Symbols font */}
              <text
                x={pos.x + 14}
                y={pos.y + NODE_H / 2 + 7}
                fontFamily="Material Symbols Outlined"
                fontSize={22}
                fill="rgba(255,255,255,0.92)"
              >
                {t.icon}
              </text>
              {/* Label */}
              <text
                x={pos.x + 42}
                y={pos.y + NODE_H / 2 + 5}
                fontSize={12}
                fontWeight={600}
                fill="#fff"
                fontFamily="Inter, Roboto, system-ui, sans-serif"
              >
                {truncate(t.label, 14)}
              </text>
            </g>
          );
        })}
      </svg>
    </Box>
  );
}

/* ================================================================== */
/*  Main Component                                                     */
/* ================================================================== */

export default function MetamodelAdmin() {
  const { invalidateCache } = useMetamodel();

  const [tab, setTab] = useState(0);
  const [types, setTypes] = useState<FSType[]>([]);
  const [relationTypes, setRelationTypes] = useState<RType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHidden, setShowHidden] = useState(false);

  /* --- Drawer state --- */
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedTypeKey, setSelectedTypeKey] = useState<string | null>(null);

  /* --- Create type dialog --- */
  const [createTypeOpen, setCreateTypeOpen] = useState(false);
  const [newType, setNewType] = useState({
    key: "",
    label: "",
    icon: "category",
    color: "#1976d2",
    category: "Application & Data",
    has_hierarchy: false,
    description: "",
  });

  /* --- Create relation dialog --- */
  const [createRelOpen, setCreateRelOpen] = useState(false);
  const [newRel, setNewRel] = useState({
    key: "",
    label: "",
    reverse_label: "",
    source_type_key: "",
    target_type_key: "",
    cardinality: "1:n" as "1:1" | "1:n" | "n:m",
  });

  /* --- Edit relation dialog --- */
  const [editRelOpen, setEditRelOpen] = useState(false);
  const [editRel, setEditRel] = useState<RType | null>(null);

  /* ---- Data fetching ---- */
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [t, r] = await Promise.all([
        api.get<FSType[]>("/metamodel/types?include_hidden=true"),
        api.get<RType[]>("/metamodel/relation-types"),
      ]);
      setTypes(t);
      setRelationTypes(r);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const refresh = useCallback(() => {
    invalidateCache();
    fetchData();
  }, [invalidateCache, fetchData]);

  /* ---- Derived ---- */
  const displayTypes = showHidden
    ? types
    : types.filter((t) => !t.is_hidden);

  const autoRelKey =
    newRel.source_type_key && newRel.target_type_key
      ? `${newRel.source_type_key}_to_${newRel.target_type_key}`
      : "";

  /* ---- Handlers ---- */
  const handleCreateType = async () => {
    await api.post("/metamodel/types", {
      ...newType,
      fields_schema: [],
      built_in: false,
    });
    refresh();
    setCreateTypeOpen(false);
    setNewType({
      key: "",
      label: "",
      icon: "category",
      color: "#1976d2",
      category: "Application & Data",
      has_hierarchy: false,
      description: "",
    });
  };

  const handleCreateRelation = async () => {
    const finalKey = newRel.key || autoRelKey;
    await api.post("/metamodel/relation-types", {
      ...newRel,
      key: finalKey,
      attributes_schema: [],
      built_in: false,
    });
    refresh();
    setCreateRelOpen(false);
    setNewRel({
      key: "",
      label: "",
      reverse_label: "",
      source_type_key: "",
      target_type_key: "",
      cardinality: "1:n",
    });
  };

  const handleUpdateRelation = async () => {
    if (!editRel) return;
    await api.patch(`/metamodel/relation-types/${editRel.key}`, {
      label: editRel.label,
      reverse_label: editRel.reverse_label,
      cardinality: editRel.cardinality,
    });
    refresh();
    setEditRelOpen(false);
    setEditRel(null);
  };

  const handleDeleteRelation = async (key: string) => {
    await api.delete(`/metamodel/relation-types/${key}`);
    refresh();
  };

  const openCreateRelation = (preselectedTypeKey?: string) => {
    setNewRel({
      key: "",
      label: "",
      reverse_label: "",
      source_type_key: preselectedTypeKey || "",
      target_type_key: "",
      cardinality: "1:n",
    });
    setCreateRelOpen(true);
  };

  const handleNodeClick = (key: string) => {
    setSelectedTypeKey(key);
    setDrawerOpen(true);
  };

  const resolveType = (key: string) => types.find((t) => t.key === key);

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  return (
    <Box>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>
        Metamodel Configuration
      </Typography>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
        <Tab label="Fact Sheet Types" />
        <Tab label="Relation Types" />
        <Tab label="Metamodel Graph" />
      </Tabs>

      {/* ============================================================ */}
      {/*  TAB 0 -- Fact Sheet Types                                   */}
      {/* ============================================================ */}
      {tab === 0 && (
        <Box>
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              mb: 2,
            }}
          >
            <FormControlLabel
              control={
                <Switch
                  checked={showHidden}
                  onChange={(e) => setShowHidden(e.target.checked)}
                />
              }
              label="Show hidden types"
            />
            <Button
              variant="contained"
              startIcon={<MaterialSymbol icon="add" size={18} />}
              onClick={() => setCreateTypeOpen(true)}
            >
              New Type
            </Button>
          </Box>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 2,
            }}
          >
            {displayTypes.map((t) => {
              const fieldCount = t.fields_schema.reduce(
                (sum, s) => sum + s.fields.length,
                0,
              );
              const subtypeCount = (t.subtypes || []).length;
              const relCount = relationTypes.filter(
                (r) =>
                  r.source_type_key === t.key ||
                  r.target_type_key === t.key,
              ).length;

              return (
                <Card
                  key={t.key}
                  sx={{
                    cursor: "pointer",
                    transition: "box-shadow 0.2s, transform 0.15s",
                    "&:hover": { boxShadow: 6, transform: "translateY(-2px)" },
                    opacity: t.is_hidden ? 0.55 : 1,
                  }}
                  onClick={() => {
                    setSelectedTypeKey(t.key);
                    setDrawerOpen(true);
                  }}
                >
                  <CardContent>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1.5,
                        mb: 1,
                      }}
                    >
                      <Box
                        sx={{
                          width: 40,
                          height: 40,
                          borderRadius: "50%",
                          bgcolor: t.color,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <MaterialSymbol
                          icon={t.icon}
                          size={22}
                          color="#fff"
                        />
                      </Box>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography fontWeight={600} noWrap>
                          {t.label}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          noWrap
                        >
                          {t.category || "Uncategorized"}
                        </Typography>
                      </Box>
                      <Tooltip title={t.is_hidden ? "Unhide" : "Hide"}>
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            api
                              .patch(`/metamodel/types/${t.key}`, { is_hidden: !t.is_hidden })
                              .then(refresh);
                          }}
                        >
                          <MaterialSymbol
                            icon={t.is_hidden ? "visibility_off" : "visibility"}
                            size={18}
                            color={t.is_hidden ? "#f57c00" : "#bbb"}
                          />
                        </IconButton>
                      </Tooltip>
                    </Box>

                    <Box
                      sx={{
                        display: "flex",
                        gap: 0.5,
                        flexWrap: "wrap",
                        mb: 1,
                      }}
                    >
                      {t.has_hierarchy && (
                        <Chip
                          size="small"
                          label="Hierarchy"
                          variant="outlined"
                          sx={{ height: 22, fontSize: 11 }}
                        />
                      )}
                      {t.built_in && (
                        <Chip
                          size="small"
                          label="Built-in"
                          color="info"
                          sx={{ height: 22, fontSize: 11 }}
                        />
                      )}
                      {t.is_hidden && (
                        <Chip
                          size="small"
                          label="Hidden"
                          sx={{ height: 22, fontSize: 11 }}
                        />
                      )}
                    </Box>

                    <Box sx={{ display: "flex", gap: 2 }}>
                      <Typography variant="caption" color="text.secondary">
                        {fieldCount} field{fieldCount !== 1 ? "s" : ""}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {subtypeCount} subtype{subtypeCount !== 1 ? "s" : ""}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {relCount} relation{relCount !== 1 ? "s" : ""}
                      </Typography>
                    </Box>
                  </CardContent>
                </Card>
              );
            })}
          </Box>

          {displayTypes.length === 0 && !loading && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mt: 2, textAlign: "center" }}
            >
              No fact sheet types found.
            </Typography>
          )}
        </Box>
      )}

      {/* ============================================================ */}
      {/*  TAB 1 -- Relation Types                                     */}
      {/* ============================================================ */}
      {tab === 1 && (
        <Box>
          <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}>
            <Button
              variant="contained"
              startIcon={<MaterialSymbol icon="add" size={18} />}
              onClick={() => openCreateRelation()}
            >
              New Relation
            </Button>
          </Box>

          {relationTypes.map((rt) => {
            const srcType = resolveType(rt.source_type_key);
            const tgtType = resolveType(rt.target_type_key);
            return (
              <Card key={rt.key} sx={{ mb: 1 }}>
                <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1.5,
                      flexWrap: "wrap",
                    }}
                  >
                    {/* Source type */}
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0.5,
                      }}
                    >
                      {srcType && (
                        <>
                          <Box
                            sx={{
                              width: 12,
                              height: 12,
                              borderRadius: "50%",
                              bgcolor: srcType.color,
                              flexShrink: 0,
                            }}
                          />
                          <MaterialSymbol
                            icon={srcType.icon}
                            size={16}
                            color={srcType.color}
                          />
                        </>
                      )}
                      <Typography variant="body2" fontWeight={500}>
                        {srcType?.label || rt.source_type_key}
                      </Typography>
                    </Box>

                    <MaterialSymbol
                      icon="arrow_forward"
                      size={16}
                      color="#bbb"
                    />

                    {/* Verb */}
                    <Typography
                      variant="body2"
                      fontWeight={600}
                      color="primary.main"
                    >
                      {rt.label}
                    </Typography>

                    <MaterialSymbol
                      icon="arrow_forward"
                      size={16}
                      color="#bbb"
                    />

                    {/* Target type */}
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0.5,
                      }}
                    >
                      {tgtType && (
                        <>
                          <Box
                            sx={{
                              width: 12,
                              height: 12,
                              borderRadius: "50%",
                              bgcolor: tgtType.color,
                              flexShrink: 0,
                            }}
                          />
                          <MaterialSymbol
                            icon={tgtType.icon}
                            size={16}
                            color={tgtType.color}
                          />
                        </>
                      )}
                      <Typography variant="body2" fontWeight={500}>
                        {tgtType?.label || rt.target_type_key}
                      </Typography>
                    </Box>

                    <Box sx={{ flex: 1 }} />

                    <Chip
                      size="small"
                      label={rt.cardinality}
                      variant="outlined"
                      sx={{ height: 22, fontSize: 11 }}
                    />
                    {rt.built_in && (
                      <Chip
                        size="small"
                        label="Built-in"
                        color="info"
                        sx={{ height: 22, fontSize: 11 }}
                      />
                    )}

                    <Tooltip title="Edit">
                      <IconButton
                        size="small"
                        onClick={() => {
                          setEditRel({ ...rt });
                          setEditRelOpen(true);
                        }}
                      >
                        <MaterialSymbol icon="edit" size={18} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton
                        size="small"
                        onClick={() => handleDeleteRelation(rt.key)}
                      >
                        <MaterialSymbol icon="delete" size={18} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </CardContent>
              </Card>
            );
          })}

          {relationTypes.length === 0 && !loading && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ textAlign: "center", mt: 2 }}
            >
              No relation types defined yet.
            </Typography>
          )}
        </Box>
      )}

      {/* ============================================================ */}
      {/*  TAB 2 -- Metamodel Graph                                    */}
      {/* ============================================================ */}
      {tab === 2 && (
        <MetamodelGraph
          types={types}
          relationTypes={relationTypes}
          onNodeClick={handleNodeClick}
        />
      )}

      {/* ============================================================ */}
      {/*  Type Detail Drawer                                          */}
      {/* ============================================================ */}
      <TypeDetailDrawer
        open={drawerOpen}
        typeKey={selectedTypeKey}
        types={types}
        relationTypes={relationTypes}
        onClose={() => setDrawerOpen(false)}
        onRefresh={refresh}
        onCreateRelation={(preKey) => openCreateRelation(preKey)}
      />

      {/* ============================================================ */}
      {/*  Create Type Dialog                                          */}
      {/* ============================================================ */}
      <Dialog
        open={createTypeOpen}
        onClose={() => setCreateTypeOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Create Fact Sheet Type</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Key (e.g., MyCustomType)"
            value={newType.key}
            onChange={(e) => setNewType({ ...newType, key: e.target.value })}
            sx={{ mt: 1, mb: 2 }}
          />
          <TextField
            fullWidth
            label="Label"
            value={newType.label}
            onChange={(e) => setNewType({ ...newType, label: e.target.value })}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            label="Description"
            value={newType.description}
            onChange={(e) =>
              setNewType({ ...newType, description: e.target.value })
            }
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            label="Icon (Material Symbol name)"
            value={newType.icon}
            onChange={(e) => setNewType({ ...newType, icon: e.target.value })}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            label="Color"
            type="color"
            value={newType.color}
            onChange={(e) => setNewType({ ...newType, color: e.target.value })}
            sx={{ mb: 2 }}
          />
          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel>Category</InputLabel>
            <Select
              value={newType.category}
              label="Category"
              onChange={(e) =>
                setNewType({ ...newType, category: e.target.value })
              }
            >
              {CATEGORIES.map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControlLabel
            control={
              <Switch
                checked={newType.has_hierarchy}
                onChange={(e) =>
                  setNewType({ ...newType, has_hierarchy: e.target.checked })
                }
              />
            }
            label="Supports Hierarchy (Parent / Child)"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateTypeOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreateType}
            disabled={!newType.key || !newType.label}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* ============================================================ */}
      {/*  Create Relation Dialog                                      */}
      {/* ============================================================ */}
      <Dialog
        open={createRelOpen}
        onClose={() => setCreateRelOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Create Relation Type</DialogTitle>
        <DialogContent>
          <FormControl fullWidth sx={{ mt: 1, mb: 2 }}>
            <InputLabel>Source Type</InputLabel>
            <Select
              value={newRel.source_type_key}
              label="Source Type"
              onChange={(e) => {
                const src = e.target.value;
                setNewRel({
                  ...newRel,
                  source_type_key: src,
                  key:
                    src && newRel.target_type_key
                      ? `${src}_to_${newRel.target_type_key}`
                      : newRel.key,
                });
              }}
            >
              {types.map((t) => (
                <MenuItem key={t.key} value={t.key}>
                  <Box
                    sx={{ display: "flex", alignItems: "center", gap: 1 }}
                  >
                    <Box
                      sx={{
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        bgcolor: t.color,
                      }}
                    />
                    <MaterialSymbol icon={t.icon} size={16} color={t.color} />
                    {t.label}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel>Target Type</InputLabel>
            <Select
              value={newRel.target_type_key}
              label="Target Type"
              onChange={(e) => {
                const tgt = e.target.value;
                setNewRel({
                  ...newRel,
                  target_type_key: tgt,
                  key:
                    newRel.source_type_key && tgt
                      ? `${newRel.source_type_key}_to_${tgt}`
                      : newRel.key,
                });
              }}
            >
              {types.map((t) => (
                <MenuItem key={t.key} value={t.key}>
                  <Box
                    sx={{ display: "flex", alignItems: "center", gap: 1 }}
                  >
                    <Box
                      sx={{
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        bgcolor: t.color,
                      }}
                    />
                    <MaterialSymbol icon={t.icon} size={16} color={t.color} />
                    {t.label}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            fullWidth
            label="Key"
            value={newRel.key || autoRelKey}
            onChange={(e) => setNewRel({ ...newRel, key: e.target.value })}
            sx={{ mb: 2 }}
            helperText="Auto-generated from source + target"
          />
          <TextField
            fullWidth
            label='Label (verb, e.g., "uses")'
            value={newRel.label}
            onChange={(e) => setNewRel({ ...newRel, label: e.target.value })}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            label='Reverse Label (e.g., "is used by")'
            value={newRel.reverse_label}
            onChange={(e) =>
              setNewRel({ ...newRel, reverse_label: e.target.value })
            }
            sx={{ mb: 2 }}
          />
          <FormControl fullWidth>
            <InputLabel>Cardinality</InputLabel>
            <Select
              value={newRel.cardinality}
              label="Cardinality"
              onChange={(e) =>
                setNewRel({
                  ...newRel,
                  cardinality: e.target.value as "1:1" | "1:n" | "n:m",
                })
              }
            >
              {CARDINALITY_OPTIONS.map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateRelOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreateRelation}
            disabled={
              !newRel.source_type_key ||
              !newRel.target_type_key ||
              !(newRel.key || autoRelKey) ||
              !newRel.label
            }
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* ============================================================ */}
      {/*  Edit Relation Dialog                                        */}
      {/* ============================================================ */}
      <Dialog
        open={editRelOpen}
        onClose={() => setEditRelOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Edit Relation Type</DialogTitle>
        {editRel && (
          <>
            <DialogContent>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  mb: 2,
                  mt: 1,
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  {resolveType(editRel.source_type_key)?.label ||
                    editRel.source_type_key}
                </Typography>
                <MaterialSymbol
                  icon="arrow_forward"
                  size={16}
                  color="#bbb"
                />
                <Typography variant="body2" color="text.secondary">
                  {resolveType(editRel.target_type_key)?.label ||
                    editRel.target_type_key}
                </Typography>
              </Box>
              <TextField
                fullWidth
                label="Label"
                value={editRel.label}
                onChange={(e) =>
                  setEditRel({ ...editRel, label: e.target.value })
                }
                sx={{ mb: 2 }}
              />
              <TextField
                fullWidth
                label="Reverse Label"
                value={editRel.reverse_label || ""}
                onChange={(e) =>
                  setEditRel({
                    ...editRel,
                    reverse_label: e.target.value,
                  })
                }
                sx={{ mb: 2 }}
              />
              <FormControl fullWidth>
                <InputLabel>Cardinality</InputLabel>
                <Select
                  value={editRel.cardinality}
                  label="Cardinality"
                  onChange={(e) =>
                    setEditRel({
                      ...editRel,
                      cardinality: e.target.value as "1:1" | "1:n" | "n:m",
                    })
                  }
                >
                  {CARDINALITY_OPTIONS.map((c) => (
                    <MenuItem key={c} value={c}>
                      {c}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setEditRelOpen(false)}>Cancel</Button>
              <Button variant="contained" onClick={handleUpdateRelation}>
                Save
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
}
