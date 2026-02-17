import { useState, useEffect, useCallback, useMemo, memo } from "react";
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
import Checkbox from "@mui/material/Checkbox";
import CircularProgress from "@mui/material/CircularProgress";
import Collapse from "@mui/material/Collapse";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useMetamodel } from "@/hooks/useMetamodel";
import { api } from "@/api/client";
import type {
  CardType as FSType,
  RelationType as RType,
  FieldDef,
  FieldOption,
  SectionDef,
  StakeholderRoleDefinitionFull,
} from "@/types";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const FIELD_TYPE_OPTIONS: { value: FieldDef["type"]; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "cost", label: "Cost" },
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
const LAYER_GAP_Y = 140;
const PAD_X = 80;
const PAD_Y = 80;
const LAYER_LABEL_W = 180;

/* Edge routing */
const TRACK_GAP = 10;
const TRACK_MARGIN = 16;
const SAME_LAYER_ARC_BASE = 32;
const SAME_LAYER_ARC_STEP = 18;
const CORNER_R = 10;
const LABEL_W = 84;
const LABEL_H = 20;

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
/*  Stakeholder Role Panel                                            */
/* ------------------------------------------------------------------ */

interface StakeholderRolePanelProps {
  typeKey: string;
  onError: (msg: string) => void;
}

function StakeholderRolePanel({ typeKey, onError }: StakeholderRolePanelProps) {
  const [roles, setRoles] = useState<StakeholderRoleDefinitionFull[]>([]);
  const [permissionsSchema, setPermissionsSchema] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [expandedRole, setExpandedRole] = useState<string | null>(null);

  /* --- Create role form --- */
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    key: "",
    label: "",
    description: "",
    color: "#1976d2",
    permissions: {} as Record<string, boolean>,
  });
  const [createSaving, setCreateSaving] = useState(false);

  /* --- Edit role form --- */
  const [editRoleKey, setEditRoleKey] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    label: "",
    description: "",
    color: "#1976d2",
    permissions: {} as Record<string, boolean>,
  });
  const [editSaving, setEditSaving] = useState(false);

  /* --- Fetch roles + permissions schema --- */
  const fetchRoles = useCallback(async () => {
    try {
      const data = await api.get<StakeholderRoleDefinitionFull[]>(
        `/metamodel/types/${typeKey}/stakeholder-roles`,
      );
      setRoles(data);
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Failed to fetch stakeholder roles");
    }
  }, [typeKey, onError]);

  const fetchPermissionsSchema = useCallback(async () => {
    try {
      const data = await api.get<Record<string, string>>("/stakeholder-roles/permissions-schema");
      setPermissionsSchema(data);
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Failed to fetch permissions schema");
    }
  }, [onError]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchRoles(), fetchPermissionsSchema()]).finally(() => setLoading(false));
  }, [fetchRoles, fetchPermissionsSchema]);

  /* Reset state when typeKey changes */
  useEffect(() => {
    setExpandedRole(null);
    setCreateOpen(false);
    setEditRoleKey(null);
  }, [typeKey]);

  /* --- Filter by archived --- */
  const displayRoles = showArchived ? roles : roles.filter((r) => !r.is_archived);

  /* --- Create role --- */
  const handleCreate = async () => {
    if (!createForm.key || !createForm.label) return;
    setCreateSaving(true);
    try {
      await api.post(`/metamodel/types/${typeKey}/stakeholder-roles`, {
        key: createForm.key,
        label: createForm.label,
        description: createForm.description || undefined,
        color: createForm.color,
        permissions: createForm.permissions,
      });
      await fetchRoles();
      setCreateForm({ key: "", label: "", description: "", color: "#1976d2", permissions: {} });
      setCreateOpen(false);
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Failed to create role");
    } finally {
      setCreateSaving(false);
    }
  };

  /* --- Edit role --- */
  const startEdit = (role: StakeholderRoleDefinitionFull) => {
    setEditRoleKey(role.key);
    setEditForm({
      label: role.label,
      description: role.description || "",
      color: role.color,
      permissions: { ...role.permissions },
    });
    setExpandedRole(role.key);
  };

  const handleSaveEdit = async () => {
    if (!editRoleKey) return;
    setEditSaving(true);
    try {
      await api.patch(`/metamodel/types/${typeKey}/stakeholder-roles/${editRoleKey}`, {
        label: editForm.label,
        description: editForm.description || undefined,
        color: editForm.color,
        permissions: editForm.permissions,
      });
      await fetchRoles();
      setEditRoleKey(null);
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Failed to update role");
    } finally {
      setEditSaving(false);
    }
  };

  const cancelEdit = () => {
    setEditRoleKey(null);
  };

  /* --- Archive / Restore --- */
  const handleArchive = async (roleKey: string) => {
    try {
      await api.post(`/metamodel/types/${typeKey}/stakeholder-roles/${roleKey}/archive`);
      await fetchRoles();
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Failed to archive role");
    }
  };

  const handleRestore = async (roleKey: string) => {
    try {
      await api.post(`/metamodel/types/${typeKey}/stakeholder-roles/${roleKey}/restore`);
      await fetchRoles();
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Failed to restore role");
    }
  };

  /* --- Permission checkbox helper --- */
  const renderPermissionEditor = (
    perms: Record<string, boolean>,
    onChange: (key: string, val: boolean) => void,
  ) => (
    <Box sx={{ mt: 1 }}>
      <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
        Permissions
      </Typography>
      {Object.entries(permissionsSchema).map(([permKey, permDesc]) => (
        <Box
          key={permKey}
          sx={{
            display: "flex",
            alignItems: "center",
            py: 0.25,
            "&:hover": { bgcolor: "action.hover" },
            borderRadius: 1,
          }}
        >
          <Checkbox
            size="small"
            checked={!!perms[permKey]}
            onChange={(e) => onChange(permKey, e.target.checked)}
            sx={{ p: 0.5 }}
          />
          <Box sx={{ ml: 0.5, minWidth: 0, flex: 1 }}>
            <Typography variant="body2" fontWeight={500} sx={{ lineHeight: 1.3 }}>
              {permKey}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2 }}>
              {permDesc}
            </Typography>
          </Box>
        </Box>
      ))}
    </Box>
  );

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  return (
    <Box>
      {/* Header row */}
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          Stakeholder Roles
        </Typography>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
          }
          label={<Typography variant="caption">Show archived</Typography>}
          sx={{ mr: 0 }}
        />
      </Box>

      {/* Role list */}
      {displayRoles.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {showArchived ? "No stakeholder roles defined." : "No active stakeholder roles. Create one below."}
        </Typography>
      )}

      {displayRoles.map((role) => {
        const isEditing = editRoleKey === role.key;
        const isExpanded = expandedRole === role.key;

        return (
          <Card
            key={role.key}
            variant="outlined"
            sx={{
              mb: 1,
              opacity: role.is_archived ? 0.6 : 1,
              borderLeft: `4px solid ${role.color}`,
            }}
          >
            <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
              {/* Role header row */}
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    bgcolor: role.color,
                    flexShrink: 0,
                  }}
                />
                <Typography variant="body2" fontWeight={600} sx={{ flex: 1 }}>
                  {role.label}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {role.key}
                </Typography>
                {role.is_archived && (
                  <Chip size="small" label="Archived" sx={{ height: 20, fontSize: 11 }} />
                )}
                {typeof role.stakeholder_count === "number" && (
                  <Chip
                    size="small"
                    label={`${role.stakeholder_count} sub${role.stakeholder_count !== 1 ? "s" : ""}`}
                    variant="outlined"
                    sx={{ height: 20, fontSize: 11 }}
                  />
                )}
                <IconButton
                  size="small"
                  onClick={() => setExpandedRole(isExpanded ? null : role.key)}
                >
                  <MaterialSymbol
                    icon={isExpanded ? "expand_less" : "expand_more"}
                    size={18}
                  />
                </IconButton>
                {!role.is_archived && (
                  <IconButton size="small" onClick={() => startEdit(role)}>
                    <MaterialSymbol icon="edit" size={18} />
                  </IconButton>
                )}
                {role.is_archived ? (
                  <Tooltip title="Restore">
                    <IconButton size="small" onClick={() => handleRestore(role.key)}>
                      <MaterialSymbol icon="restore" size={18} />
                    </IconButton>
                  </Tooltip>
                ) : (
                  <Tooltip title="Archive">
                    <IconButton size="small" onClick={() => handleArchive(role.key)}>
                      <MaterialSymbol icon="archive" size={18} />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>

              {/* Description */}
              {role.description && !isEditing && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
                  {role.description}
                </Typography>
              )}

              {/* Expanded content */}
              <Collapse in={isExpanded}>
                <Box sx={{ mt: 1.5 }}>
                  {isEditing ? (
                    /* --- Inline edit form --- */
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                      <TextField
                        size="small"
                        label="Label"
                        value={editForm.label}
                        onChange={(e) => setEditForm({ ...editForm, label: e.target.value })}
                        fullWidth
                      />
                      <TextField
                        size="small"
                        label="Description"
                        value={editForm.description}
                        onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                        multiline
                        rows={2}
                        fullWidth
                      />
                      <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                        <TextField
                          size="small"
                          label="Color"
                          type="color"
                          value={editForm.color}
                          onChange={(e) => setEditForm({ ...editForm, color: e.target.value })}
                          sx={{ width: 120 }}
                        />
                        <Box
                          sx={{
                            width: 24,
                            height: 24,
                            borderRadius: "50%",
                            bgcolor: editForm.color,
                            border: "1px solid",
                            borderColor: "divider",
                          }}
                        />
                      </Box>
                      {renderPermissionEditor(editForm.permissions, (key, val) =>
                        setEditForm({
                          ...editForm,
                          permissions: { ...editForm.permissions, [key]: val },
                        }),
                      )}
                      <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end", mt: 1 }}>
                        <Button size="small" onClick={cancelEdit}>
                          Cancel
                        </Button>
                        <Button
                          size="small"
                          variant="contained"
                          onClick={handleSaveEdit}
                          disabled={editSaving || !editForm.label}
                        >
                          {editSaving ? "Saving..." : "Save"}
                        </Button>
                      </Box>
                    </Box>
                  ) : (
                    /* --- Read-only permission display --- */
                    <Box>
                      <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
                        Permissions
                      </Typography>
                      {Object.keys(permissionsSchema).length === 0 ? (
                        <Typography variant="caption" color="text.secondary">
                          No permissions defined.
                        </Typography>
                      ) : (
                        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                          {Object.entries(permissionsSchema).map(([permKey]) => (
                            <Chip
                              key={permKey}
                              size="small"
                              label={permKey}
                              variant={role.permissions[permKey] ? "filled" : "outlined"}
                              color={role.permissions[permKey] ? "success" : "default"}
                              sx={{
                                height: 22,
                                fontSize: 11,
                                opacity: role.permissions[permKey] ? 1 : 0.5,
                              }}
                            />
                          ))}
                        </Box>
                      )}
                    </Box>
                  )}
                </Box>
              </Collapse>
            </CardContent>
          </Card>
        );
      })}

      {/* Create role form */}
      {createOpen ? (
        <Card variant="outlined" sx={{ mt: 1, mb: 2, borderStyle: "dashed" }}>
          <CardContent sx={{ py: 2, "&:last-child": { pb: 2 } }}>
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1.5 }}>
              New Stakeholder Role
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              <TextField
                size="small"
                label="Key"
                value={createForm.key}
                onChange={(e) =>
                  setCreateForm({ ...createForm, key: e.target.value.replace(/\s+/g, "_").toLowerCase() })
                }
                placeholder="e.g. data_steward"
                fullWidth
              />
              <TextField
                size="small"
                label="Label"
                value={createForm.label}
                onChange={(e) => setCreateForm({ ...createForm, label: e.target.value })}
                placeholder="e.g. Data Steward"
                fullWidth
              />
              <TextField
                size="small"
                label="Description"
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                multiline
                rows={2}
                fullWidth
              />
              <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                <TextField
                  size="small"
                  label="Color"
                  type="color"
                  value={createForm.color}
                  onChange={(e) => setCreateForm({ ...createForm, color: e.target.value })}
                  sx={{ width: 120 }}
                />
                <Box
                  sx={{
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    bgcolor: createForm.color,
                    border: "1px solid",
                    borderColor: "divider",
                  }}
                />
              </Box>
              {renderPermissionEditor(createForm.permissions, (key, val) =>
                setCreateForm({
                  ...createForm,
                  permissions: { ...createForm.permissions, [key]: val },
                }),
              )}
              <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end", mt: 1 }}>
                <Button
                  size="small"
                  onClick={() => {
                    setCreateOpen(false);
                    setCreateForm({ key: "", label: "", description: "", color: "#1976d2", permissions: {} });
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  onClick={handleCreate}
                  disabled={createSaving || !createForm.key || !createForm.label}
                >
                  {createSaving ? "Creating..." : "Create"}
                </Button>
              </Box>
            </Box>
          </CardContent>
        </Card>
      ) : (
        <Button
          size="small"
          startIcon={<MaterialSymbol icon="add" size={16} />}
          onClick={() => setCreateOpen(true)}
          sx={{ mb: 2 }}
        >
          Add Role
        </Button>
      )}
    </Box>
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

  /* Initialise local state from the type whenever the drawer opens or the type changes */
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
      setAddSectionOpen(false);
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

  const handleDeleteField = async (sectionIdx: number, fieldIdx: number) => {
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

  const handleAddSection = async () => {
    if (!newSectionName) return;
    try {
      const schema: SectionDef[] = [
        ...cardTypeKey.fields_schema,
        { section: newSectionName, fields: [] },
      ];
      await api.patch(`/metamodel/types/${cardTypeKey.key}`, {
        fields_schema: schema,
      });
      onRefresh();
      setNewSectionName("");
      setAddSectionOpen(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to add section");
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

        {/* ---------- Stakeholder Roles ---------- */}
        <StakeholderRolePanel
          typeKey={cardTypeKey.key}
          onError={(msg) => setError(msg)}
        />

        <Divider sx={{ mb: 2 }} />

        {/* ---------- Fields ---------- */}
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
          Fields
        </Typography>
        {cardTypeKey.fields_schema.map((section, si) => (
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
        {cardTypeKey.fields_schema.length === 0 && (
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
            const isSource = r.source_type_key === cardTypeKey.key;
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
          onClick={() => onCreateRelation(cardTypeKey.key)}
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
/*  Metamodel Graph  — edge routing helpers                            */
/* ------------------------------------------------------------------ */

interface ClassifiedEdge {
  rel: RType;
  srcLayerIdx: number;
  tgtLayerIdx: number;
  direction: "down" | "up" | "same";
  /** Gap indices the edge must route through (ordered src→tgt) */
  gapsUsed: number[];
  /** One track Y per gap, filled during assignment */
  trackY: number[];
}

interface GapInfo {
  topY: number;
  bottomY: number;
}

interface Corridor {
  centerX: number;
  width: number;
}

/**
 * Convert a polyline of waypoints into an SVG path with rounded corners.
 * Adjacent co-linear segments are collapsed automatically.
 */
function segmentsToPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return "";
  const parts: string[] = [`M${pts[0].x},${pts[0].y}`];

  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const next = i < pts.length - 1 ? pts[i + 1] : null;

    if (
      !next ||
      (prev.x === curr.x && curr.x === next.x) ||
      (prev.y === curr.y && curr.y === next.y)
    ) {
      parts.push(`L${curr.x},${curr.y}`);
    } else {
      // Corner — apply rounding
      const legA = Math.max(Math.abs(curr.x - prev.x), Math.abs(curr.y - prev.y));
      const legB = Math.max(Math.abs(next.x - curr.x), Math.abs(next.y - curr.y));
      const r = Math.min(CORNER_R, legA / 2, legB / 2);
      if (r < 1) {
        parts.push(`L${curr.x},${curr.y}`);
        continue;
      }
      const dx1 = Math.sign(curr.x - prev.x);
      const dy1 = Math.sign(curr.y - prev.y);
      const dx2 = Math.sign(next.x - curr.x);
      const dy2 = Math.sign(next.y - curr.y);
      const ax = curr.x - (dx1 !== 0 ? dx1 * r : 0);
      const ay = curr.y - (dy1 !== 0 ? dy1 * r : 0);
      const bx = curr.x + (dx2 !== 0 ? dx2 * r : 0);
      const by = curr.y + (dy2 !== 0 ? dy2 * r : 0);
      parts.push(`L${ax},${ay}`);
      parts.push(`Q${curr.x},${curr.y} ${bx},${by}`);
    }
  }
  return parts.join(" ");
}

/* ------------------------------------------------------------------ */
/*  Metamodel Graph  (SVG)                                             */
/* ------------------------------------------------------------------ */

interface GraphProps {
  types: FSType[];
  relationTypes: RType[];
  onNodeClick: (key: string) => void;
}

const MetamodelGraph = memo(function MetamodelGraph({ types, relationTypes, onNodeClick }: GraphProps) {
  const visibleTypes = useMemo(() => types.filter((t) => !t.is_hidden), [types]);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  /* ================================================================ */
  /*  Build layers                                                     */
  /* ================================================================ */
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

  /* ================================================================ */
  /*  Compute node positions                                           */
  /* ================================================================ */
  const layout = useMemo(() => {
    const map: Record<string, { x: number; y: number }> = {};
    const maxNodes = Math.max(...layers.map((l) => l.nodes.length), 1);
    const contentW = maxNodes * NODE_W + (maxNodes - 1) * NODE_GAP_X;
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

    return { map, svgW, contentW };
  }, [layers]);

  /* ================================================================ */
  /*  Build edges — track-based routing                                */
  /* ================================================================ */
  const edges = useMemo(() => {
    const visible = relationTypes.filter(
      (r) => layout.map[r.source_type_key] && layout.map[r.target_type_key],
    );
    if (visible.length === 0) return [];

    // -- Build layer-index lookup --
    const layerIdx: Record<string, number> = {};
    layers.forEach((layer, li) => {
      layer.nodes.forEach((n) => { layerIdx[n.key] = li; });
    });

    // -- Classify edges --
    const classified: ClassifiedEdge[] = visible.map((r) => {
      const sli = layerIdx[r.source_type_key];
      const tli = layerIdx[r.target_type_key];
      const direction: ClassifiedEdge["direction"] =
        sli < tli ? "down" : sli > tli ? "up" : "same";
      const gapsUsed: number[] = [];
      if (direction === "down") {
        for (let g = sli; g < tli; g++) gapsUsed.push(g);
      } else if (direction === "up") {
        // ordered from source toward target (high→low)
        for (let g = sli - 1; g >= tli; g--) gapsUsed.push(g);
      }
      return { rel: r, srcLayerIdx: sli, tgtLayerIdx: tli, direction, gapsUsed, trackY: [] };
    });

    // -- Compute gap geometry --
    const gaps: GapInfo[] = [];
    for (let i = 0; i < layers.length - 1; i++) {
      const topY = PAD_Y + i * (NODE_H + LAYER_GAP_Y) + NODE_H + TRACK_MARGIN;
      const bottomY = PAD_Y + (i + 1) * (NODE_H + LAYER_GAP_Y) - TRACK_MARGIN;
      gaps.push({ topY, bottomY });
    }

    // -- Compute corridors per layer (vertical pass-through between nodes) --
    const corridorsPerLayer: Corridor[][] = layers.map((layer) => {
      const positions = layer.nodes
        .map((n) => layout.map[n.key])
        .filter(Boolean)
        .sort((a, b) => a.x - b.x);
      const corrs: Corridor[] = [];
      // Left margin corridor
      if (positions.length > 0) {
        const leftBound = LAYER_LABEL_W;
        if (positions[0].x - leftBound > 20) {
          corrs.push({ centerX: (leftBound + positions[0].x) / 2, width: positions[0].x - leftBound });
        }
      }
      // Inter-node corridors
      for (let i = 0; i < positions.length - 1; i++) {
        const right = positions[i].x + NODE_W;
        const left = positions[i + 1].x;
        corrs.push({ centerX: (right + left) / 2, width: left - right });
      }
      // Right margin corridor
      if (positions.length > 0) {
        const lastRight = positions[positions.length - 1].x + NODE_W;
        const svgRight = layout.svgW - PAD_X;
        if (svgRight - lastRight > 20) {
          corrs.push({ centerX: (lastRight + svgRight) / 2, width: svgRight - lastRight });
        }
      }
      return corrs;
    });

    // -- Port assignment --
    const bottomPorts: Record<string, string[]> = {};
    const topPorts: Record<string, string[]> = {};

    for (const e of classified) {
      const r = e.rel;
      if (e.direction === "same") {
        // Same-layer edges exit/enter from the top
        (topPorts[r.source_type_key] ??= []).push(r.key);
        if (r.source_type_key !== r.target_type_key) {
          (topPorts[r.target_type_key] ??= []).push(r.key);
        }
      } else if (e.direction === "down") {
        (bottomPorts[r.source_type_key] ??= []).push(r.key);
        (topPorts[r.target_type_key] ??= []).push(r.key);
      } else {
        (topPorts[r.source_type_key] ??= []).push(r.key);
        (bottomPorts[r.target_type_key] ??= []).push(r.key);
      }
    }

    // Sort ports by the x-position of the other end for minimal crossings
    const sortPorts = (ports: Record<string, string[]>) => {
      for (const nodeKey of Object.keys(ports)) {
        ports[nodeKey].sort((a, b) => {
          const ra = visible.find((v) => v.key === a)!;
          const rb = visible.find((v) => v.key === b)!;
          const otherA = ra.source_type_key === nodeKey ? ra.target_type_key : ra.source_type_key;
          const otherB = rb.source_type_key === nodeKey ? rb.target_type_key : rb.source_type_key;
          return (layout.map[otherA]?.x ?? 0) - (layout.map[otherB]?.x ?? 0);
        });
      }
    };
    sortPorts(bottomPorts);
    sortPorts(topPorts);

    const portXOffset = (nodeKey: string, edgeKey: string, side: "top" | "bottom"): number => {
      const ports = side === "bottom" ? bottomPorts[nodeKey] : topPorts[nodeKey];
      if (!ports) return NODE_W / 2;
      const idx = ports.indexOf(edgeKey);
      const n = ports.length;
      const margin = NODE_W * 0.15;
      const span = NODE_W - 2 * margin;
      return margin + (n === 1 ? span / 2 : (idx / (n - 1)) * span);
    };

    // -- Assign tracks (unique Y per edge per gap) --
    for (let g = 0; g < gaps.length; g++) {
      const gap = gaps[g];
      const inGap = classified.filter((e) => e.gapsUsed.includes(g));
      if (inGap.length === 0) continue;

      // Sort by interpolated X at this gap for minimal crossings
      inGap.sort((a, b) => {
        const interp = (e: ClassifiedEdge) => {
          const srcX = layout.map[e.rel.source_type_key].x + NODE_W / 2;
          const tgtX = layout.map[e.rel.target_type_key].x + NODE_W / 2;
          const total = e.gapsUsed.length;
          const pos = e.gapsUsed.indexOf(g);
          const t = total === 1 ? 0.5 : (pos + 0.5) / total;
          return srcX + (tgtX - srcX) * t;
        };
        return interp(a) - interp(b);
      });

      const n = inGap.length;
      const totalH = (n - 1) * TRACK_GAP;
      const centerY = (gap.topY + gap.bottomY) / 2;
      const startY = centerY - totalH / 2;

      inGap.forEach((edge, i) => {
        const localIdx = edge.gapsUsed.indexOf(g);
        edge.trackY[localIdx] = startY + i * TRACK_GAP;
      });
    }

    // -- Choose corridor X for multi-gap edges passing through intermediate layers --
    // Track usage per corridor per layer so parallel verticals don't overlap
    const corridorUsage: Record<string, number> = {};

    const chooseCorridorX = (intermediateLayerIdx: number, idealX: number): number => {
      const corrs = corridorsPerLayer[intermediateLayerIdx];
      if (!corrs || corrs.length === 0) return idealX; // fallback
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < corrs.length; i++) {
        const dist = Math.abs(corrs[i].centerX - idealX);
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
      }
      const key = `${intermediateLayerIdx}-${bestIdx}`;
      const used = corridorUsage[key] ?? 0;
      corridorUsage[key] = used + 1;
      // Spread parallel verticals within the corridor
      const maxInCorridor = Math.max(1, Math.floor(corrs[bestIdx].width / 8));
      const offset = (used - (maxInCorridor - 1) / 2) * 6;
      return corrs[bestIdx].centerX + Math.max(-corrs[bestIdx].width / 2 + 4, Math.min(corrs[bestIdx].width / 2 - 4, offset));
    };

    // -- Build paths --
    const sameLayerCount: Record<number, number> = {};

    const rawEdges = classified.map((edge) => {
      const r = edge.rel;
      const srcPos = layout.map[r.source_type_key];
      const tgtPos = layout.map[r.target_type_key];
      let d: string;
      let labelX: number;
      let labelY: number;

      if (edge.direction === "same") {
        // Same-layer arc above the nodes
        const arcIdx = sameLayerCount[edge.srcLayerIdx] ?? 0;
        sameLayerCount[edge.srcLayerIdx] = arcIdx + 1;

        const srcPx = srcPos.x + portXOffset(r.source_type_key, r.key, "top");
        const tgtPx = tgtPos.x + portXOffset(r.target_type_key, r.key, "top");
        const nodeTopY = srcPos.y;
        const arcY = nodeTopY - SAME_LAYER_ARC_BASE - arcIdx * SAME_LAYER_ARC_STEP;

        // Self-loop (same type to same type)
        if (r.source_type_key === r.target_type_key) {
          const cx = srcPos.x + NODE_W / 2;
          const loopW = 24;
          const pts = [
            { x: cx - loopW, y: nodeTopY },
            { x: cx - loopW, y: arcY },
            { x: cx + loopW, y: arcY },
            { x: cx + loopW, y: nodeTopY },
          ];
          d = segmentsToPath(pts);
          labelX = cx;
          labelY = arcY;
        } else {
          const pts = [
            { x: srcPx, y: nodeTopY },
            { x: srcPx, y: arcY },
            { x: tgtPx, y: arcY },
            { x: tgtPx, y: nodeTopY },
          ];
          d = segmentsToPath(pts);
          labelX = (srcPx + tgtPx) / 2;
          labelY = arcY;
        }
      } else {
        // Cross-layer edge (single-gap or multi-gap)
        const goingDown = edge.direction === "down";
        const srcSide = goingDown ? "bottom" : "top";
        const tgtSide = goingDown ? "top" : "bottom";
        const srcPx = srcPos.x + portXOffset(r.source_type_key, r.key, srcSide);
        const tgtPx = tgtPos.x + portXOffset(r.target_type_key, r.key, tgtSide);
        const srcEdgeY = goingDown ? srcPos.y + NODE_H : srcPos.y;
        const tgtEdgeY = goingDown ? tgtPos.y : tgtPos.y + NODE_H;

        const pts: { x: number; y: number }[] = [{ x: srcPx, y: srcEdgeY }];
        let curX = srcPx;

        for (let gi = 0; gi < edge.gapsUsed.length; gi++) {
          const trackAtGap = edge.trackY[gi];

          // Vertical from current position to the track
          pts.push({ x: curX, y: trackAtGap });

          if (gi < edge.gapsUsed.length - 1) {
            // Multi-gap: route through intermediate layer via a corridor
            const gapIdx = edge.gapsUsed[gi];
            const nextGapIdx = edge.gapsUsed[gi + 1];
            // The intermediate layer is between these two gaps
            const intermediateLayer = goingDown
              ? Math.max(gapIdx, nextGapIdx)   // the lower gap index + 1
              : Math.min(gapIdx, nextGapIdx) + 1;

            const idealX = srcPx + (tgtPx - srcPx) * ((gi + 1) / edge.gapsUsed.length);
            const corridorX = chooseCorridorX(intermediateLayer, idealX);

            // Horizontal to corridor
            pts.push({ x: corridorX, y: trackAtGap });
            curX = corridorX;
            // The next iteration will draw vertical from corridorX to the next track
          } else {
            // Last gap: horizontal to target port X
            pts.push({ x: tgtPx, y: trackAtGap });
            curX = tgtPx;
          }
        }

        // Final vertical to target
        pts.push({ x: curX, y: tgtEdgeY });

        d = segmentsToPath(pts);

        // Label at the middle gap's track
        const midGap = Math.floor(edge.gapsUsed.length / 2);
        labelY = edge.trackY[midGap];
        // Label X at the midpoint of the horizontal segment in that gap
        if (edge.gapsUsed.length === 1) {
          labelX = (srcPx + tgtPx) / 2;
        } else {
          labelX = (srcPx + tgtPx) / 2;
        }
      }

      return { key: r.key, d, label: r.label, labelX, labelY, srcType: r.source_type_key, tgtType: r.target_type_key };
    });

    // -- Resolve label overlaps --
    type Rect = { x: number; y: number; w: number; h: number };
    const rectsOverlap = (a: Rect, b: Rect) =>
      a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

    const nodeRects: Rect[] = Object.values(layout.map).map((pos) => ({
      x: pos.x, y: pos.y, w: NODE_W, h: NODE_H,
    }));

    const placedLabels: Rect[] = [];
    for (const edge of rawEdges) {
      let lx = edge.labelX - LABEL_W / 2;
      let ly = edge.labelY - LABEL_H / 2;
      let labelRect: Rect = { x: lx, y: ly, w: LABEL_W, h: LABEL_H };

      const allBlocked = [...nodeRects, ...placedLabels];
      let hasOverlap = allBlocked.some((r) => rectsOverlap(labelRect, r));

      if (hasOverlap) {
        let resolved = false;
        for (let dy = -LABEL_H; dy <= LABEL_H * 3; dy += 6) {
          if (dy === 0) continue;
          const tryRect: Rect = { x: lx, y: ly + dy, w: LABEL_W, h: LABEL_H };
          if (!allBlocked.some((r) => rectsOverlap(tryRect, r))) {
            ly += dy;
            labelRect = tryRect;
            resolved = true;
            break;
          }
        }
        if (!resolved) {
          for (let dx = LABEL_W; dx <= LABEL_W * 3; dx += LABEL_W * 0.5) {
            for (const sign of [1, -1]) {
              const tryRect: Rect = { x: lx + dx * sign, y: ly, w: LABEL_W, h: LABEL_H };
              if (!allBlocked.some((r) => rectsOverlap(tryRect, r))) {
                lx += dx * sign;
                labelRect = tryRect;
                resolved = true;
                break;
              }
            }
            if (resolved) break;
          }
        }
      }

      placedLabels.push(labelRect);
      edge.labelX = lx + LABEL_W / 2;
      edge.labelY = ly + LABEL_H / 2;
    }

    return rawEdges;
  }, [relationTypes, layout, layers]);

  /* ================================================================ */
  /*  Derived layout values                                            */
  /* ================================================================ */
  const layerLabels = useMemo(() => {
    return layers.map((layer, li) => ({
      label: layer.category,
      y: PAD_Y + li * (NODE_H + LAYER_GAP_Y),
    }));
  }, [layers]);

  // Compute dynamic SVG height accounting for same-layer arcs above layer 0
  const svgDimensions = useMemo(() => {
    // Count same-layer edges per layer to determine arc space needed above layer 0
    const layerIdx: Record<string, number> = {};
    layers.forEach((layer, li) => {
      layer.nodes.forEach((n) => { layerIdx[n.key] = li; });
    });
    let maxArcLift = 0;
    const sameCountPerLayer: Record<number, number> = {};
    for (const r of relationTypes) {
      if (!layout.map[r.source_type_key] || !layout.map[r.target_type_key]) continue;
      const sli = layerIdx[r.source_type_key];
      const tli = layerIdx[r.target_type_key];
      if (sli === tli) {
        sameCountPerLayer[sli] = (sameCountPerLayer[sli] ?? 0) + 1;
      }
    }
    for (const [, count] of Object.entries(sameCountPerLayer)) {
      const lift = SAME_LAYER_ARC_BASE + (count - 1) * SAME_LAYER_ARC_STEP;
      if (lift > maxArcLift) maxArcLift = lift;
    }
    const effectivePadY = Math.max(PAD_Y, maxArcLift + 24);

    const svgH =
      layers.length * NODE_H +
      (layers.length - 1) * LAYER_GAP_Y +
      effectivePadY + PAD_Y;

    return { svgW: layout.svgW, svgH };
  }, [layers, layout, relationTypes]);

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  if (visibleTypes.length === 0) {
    return (
      <Box sx={{ p: 4, textAlign: "center" }}>
        <Typography color="text.secondary">
          No visible types to display. Create some card types first.
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
        width={svgDimensions.svgW}
        height={svgDimensions.svgH}
        style={{ display: "block", minWidth: svgDimensions.svgW }}
      >
        <style>{`
          .mm-edge:hover > path, .mm-edge-hl > path { stroke: #e67700; stroke-width: 2; }
          .mm-edge:hover > path[marker-end], .mm-edge-hl > path[marker-end] { marker-end: url(#mm-arrow-hover); }
          .mm-edge:hover .mm-edge-label rect, .mm-edge-hl .mm-edge-label rect { fill: #e67700; fill-opacity: 1; stroke: #c45d00; }
          .mm-edge:hover .mm-edge-label text, .mm-edge-hl .mm-edge-label text { fill: #fff; font-weight: 600; }
        `}</style>
        <defs>
          <marker
            id="mm-arrow"
            markerWidth="9"
            markerHeight="6"
            refX="9"
            refY="3"
            orient="auto"
          >
            <path d="M0,0.5 L9,3 L0,5.5 Z" fill="#b0b8c4" />
          </marker>
          <marker
            id="mm-arrow-hover"
            markerWidth="9"
            markerHeight="6"
            refX="9"
            refY="3"
            orient="auto"
          >
            <path d="M0,0.5 L9,3 L0,5.5 Z" fill="#e67700" />
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
              width={svgDimensions.svgW - LAYER_LABEL_W + 4 - PAD_X + 20}
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
          <g key={e.key} className={`mm-edge${hoveredNode && (e.srcType === hoveredNode || e.tgtType === hoveredNode) ? " mm-edge-hl" : ""}`}>
            <path
              d={e.d}
              fill="none"
              stroke="#c8ccd4"
              strokeWidth={1.2}
              markerEnd="url(#mm-arrow)"
            />
            {/* Invisible wider hit area for hover */}
            <path
              d={e.d}
              fill="none"
              stroke="transparent"
              strokeWidth={12}
            />
            <g className="mm-edge-label">
              <rect
                x={e.labelX - 42}
                y={e.labelY - 10}
                width={84}
                height={20}
                rx={5}
                fill="#fff"
                fillOpacity={0.92}
                stroke="#e0e2e6"
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
                {truncate(e.label, 16)}
              </text>
            </g>
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
              onMouseEnter={() => setHoveredNode(t.key)}
              onMouseLeave={() => setHoveredNode(null)}
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
});

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
  const [showHiddenRels, setShowHiddenRels] = useState(false);

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

  /* --- Delete relation confirmation --- */
  const [deleteRelConfirm, setDeleteRelConfirm] = useState<{
    key: string;
    label: string;
    builtIn: boolean;
    instanceCount: number | null; // null = not yet fetched
  } | null>(null);

  /* ---- Data fetching ---- */
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [t, r] = await Promise.all([
        api.get<FSType[]>("/metamodel/types?include_hidden=true"),
        api.get<RType[]>("/metamodel/relation-types?include_hidden=true"),
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

  const displayRelationTypes = showHiddenRels
    ? relationTypes
    : relationTypes.filter((r) => !r.is_hidden);

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

  const promptDeleteRelation = (rt: RType) => {
    setDeleteRelConfirm({
      key: rt.key,
      label: `${resolveType(rt.source_type_key)?.label ?? rt.source_type_key} → ${resolveType(rt.target_type_key)?.label ?? rt.target_type_key}`,
      builtIn: rt.built_in,
      instanceCount: null,
    });
    // Fetch instance count for the warning message
    api
      .get<{ instance_count: number }>(`/metamodel/relation-types/${rt.key}/instance-count`)
      .then((resp) => {
        setDeleteRelConfirm((prev) =>
          prev ? { ...prev, instanceCount: resp.instance_count } : null
        );
      })
      .catch(() => {
        setDeleteRelConfirm((prev) =>
          prev ? { ...prev, instanceCount: 0 } : null
        );
      });
  };

  const confirmDeleteRelation = async () => {
    if (!deleteRelConfirm) return;
    try {
      const resp = await api.delete<{ status?: string }>(
        `/metamodel/relation-types/${deleteRelConfirm.key}?force=true`
      );
      if (resp?.status === "hidden") {
        setShowHiddenRels(true);
      }
      refresh();
      setDeleteRelConfirm(null);
    } catch {
      // Shouldn't fail with force=true, but just in case
    }
  };

  const handleRestoreRelation = async (key: string) => {
    await api.post(`/metamodel/relation-types/${key}/restore`);
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

  const handleNodeClick = useCallback((key: string) => {
    setSelectedTypeKey(key);
    setDrawerOpen(true);
  }, []);

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
        <Tab label="Card Types" />
        <Tab label="Relation Types" />
        <Tab label="Metamodel Graph" />
      </Tabs>

      {/* ============================================================ */}
      {/*  TAB 0 -- Card Types                                   */}
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
              No card types found.
            </Typography>
          )}
        </Box>
      )}

      {/* ============================================================ */}
      {/*  TAB 1 -- Relation Types                                     */}
      {/* ============================================================ */}
      {tab === 1 && (
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
                  checked={showHiddenRels}
                  onChange={(e) => setShowHiddenRels(e.target.checked)}
                />
              }
              label="Show hidden relations"
            />
            <Button
              variant="contained"
              startIcon={<MaterialSymbol icon="add" size={18} />}
              onClick={() => openCreateRelation()}
            >
              New Relation
            </Button>
          </Box>

          {displayRelationTypes.map((rt) => {
            const srcType = resolveType(rt.source_type_key);
            const tgtType = resolveType(rt.target_type_key);
            return (
              <Card key={rt.key} sx={{ mb: 1, opacity: rt.is_hidden ? 0.5 : 1 }}>
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
                    {rt.is_hidden && (
                      <Chip
                        size="small"
                        label="Hidden"
                        color="warning"
                        sx={{ height: 22, fontSize: 11 }}
                      />
                    )}

                    {rt.is_hidden ? (
                      <Tooltip title="Restore">
                        <IconButton
                          size="small"
                          onClick={() => handleRestoreRelation(rt.key)}
                        >
                          <MaterialSymbol icon="restore" size={18} />
                        </IconButton>
                      </Tooltip>
                    ) : (
                      <>
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
                            onClick={() => promptDeleteRelation(rt)}
                          >
                            <MaterialSymbol icon="delete" size={18} />
                          </IconButton>
                        </Tooltip>
                      </>
                    )}
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
        <DialogTitle>Create Card Type</DialogTitle>
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

      {/* ============================================================ */}
      {/*  Delete Relation Confirmation Dialog                          */}
      {/* ============================================================ */}
      <Dialog
        open={!!deleteRelConfirm}
        onClose={() => setDeleteRelConfirm(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete Relation Type?</DialogTitle>
        <DialogContent>
          {deleteRelConfirm && (
            <>
              <Typography variant="body2" sx={{ mt: 1, mb: 1 }}>
                <strong>{deleteRelConfirm.label}</strong>
              </Typography>
              {deleteRelConfirm.instanceCount === null ? (
                <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : deleteRelConfirm.instanceCount > 0 ? (
                <Alert severity="warning">
                  This relation type has{" "}
                  <strong>{deleteRelConfirm.instanceCount}</strong> relation
                  instance(s) linking cards together. Deleting it will
                  permanently remove all of them.
                </Alert>
              ) : deleteRelConfirm.builtIn ? (
                <Alert severity="info">
                  This built-in relation type will be hidden and can be
                  restored later.
                </Alert>
              ) : (
                <Alert severity="info">
                  This relation type has no instances and will be permanently
                  deleted.
                </Alert>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteRelConfirm(null)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            disabled={deleteRelConfirm?.instanceCount === null}
            onClick={confirmDeleteRelation}
          >
            {deleteRelConfirm?.builtIn && deleteRelConfirm.instanceCount === 0
              ? "Hide"
              : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
