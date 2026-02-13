import { useState, useEffect, useCallback } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import IconButton from "@mui/material/IconButton";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Tooltip from "@mui/material/Tooltip";
import LinearProgress from "@mui/material/LinearProgress";
import Divider from "@mui/material/Divider";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type {
  Transformation,
  TransformationTemplate,
  Impact,
  TransformationStatus,
  TemplateRequiredField,
  FSRef,
} from "@/types";

// ── Constants ───────────────────────────────────────────────────

const IMPACT_TYPE_COLORS: Record<string, string> = {
  introduction: "#4caf50",
  decommissioning: "#f44336",
  rollout: "#2196f3",
  withdrawal: "#ff9800",
  discontinuation: "#9c27b0",
  upgrade: "#00bcd4",
  replacement: "#795548",
  migration: "#607d8b",
  modification: "#9e9e9e",
};

const ACTION_LABELS: Record<string, string> = {
  create_fact_sheet: "Create Fact Sheet",
  archive_fact_sheet: "Archive Fact Sheet",
  set_field: "Set Field",
  copy_field: "Copy Field",
  create_relation: "Create Relation",
  remove_relation: "Remove Relation",
  remove_all_relations: "Remove All Relations",
  set_relation_validity: "Set Relation Validity",
  set_relation_field: "Set Relation Field",
  add_tag: "Add Tag",
  remove_tag: "Remove Tag",
  replace_tags: "Replace Tags",
};

const STATUS_CHIP_PROPS: Record<
  TransformationStatus,
  { label: string; color: "default" | "primary" | "success" }
> = {
  draft: { label: "Draft", color: "default" },
  planned: { label: "Planned", color: "primary" },
  executed: { label: "Executed", color: "success" },
};

// ── Helper: group templates by target_fact_sheet_type ────────────

function groupTemplatesByType(templates: TransformationTemplate[]) {
  const grouped: Record<string, TransformationTemplate[]> = {};
  for (const t of templates) {
    const key = t.target_fact_sheet_type;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(t);
  }
  return grouped;
}

// ── Helper: group impacts by execution_order ────────────────────

function groupImpactsByOrder(impacts: Impact[]) {
  const groups: Record<number, Impact[]> = {};
  for (const imp of impacts) {
    const order = imp.execution_order ?? 0;
    if (!groups[order]) groups[order] = [];
    groups[order].push(imp);
  }
  return Object.entries(groups)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([order, items]) => ({ order: Number(order), items }));
}

// ── Fact sheet search hook (debounced) ──────────────────────────

function useFactSheetSearch(typeKey: string, enabled: boolean) {
  const [inputValue, setInputValue] = useState("");
  const [options, setOptions] = useState<FSRef[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !typeKey || inputValue.length < 1) {
      setOptions([]);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      api
        .get<{ items: FSRef[] }>(
          `/fact-sheets?type=${encodeURIComponent(typeKey)}&search=${encodeURIComponent(inputValue)}&page_size=20`
        )
        .then((res) => setOptions(res.items))
        .catch(() => setOptions([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [typeKey, inputValue, enabled]);

  return { inputValue, setInputValue, options, loading };
}

// ── Sub-component: Impact row ───────────────────────────────────

function ImpactRow({
  impact,
  onToggleDisable,
}: {
  impact: Impact;
  onToggleDisable?: (impactId: string, disabled: boolean) => void;
}) {
  const typeColor = IMPACT_TYPE_COLORS[impact.impact_type] || "#9e9e9e";
  const actionLabel = ACTION_LABELS[impact.action] || impact.action;
  const targetName =
    impact.target_fact_sheet?.name || impact.source_fact_sheet?.name || "";

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        py: 1,
        px: 1.5,
        opacity: impact.is_disabled ? 0.45 : 1,
        bgcolor: impact.is_disabled ? "action.disabledBackground" : "transparent",
        borderRadius: 1,
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      {/* Impact type badge */}
      <Tooltip title={impact.impact_type}>
        <Box
          sx={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            bgcolor: typeColor,
            flexShrink: 0,
          }}
        />
      </Tooltip>

      {/* Action icon */}
      <MaterialSymbol
        icon={
          impact.action === "create_fact_sheet"
            ? "add_circle"
            : impact.action === "archive_fact_sheet"
              ? "archive"
              : impact.action === "set_field"
                ? "edit"
                : impact.action === "create_relation"
                  ? "add_link"
                  : impact.action === "remove_relation"
                    ? "link_off"
                    : impact.action === "remove_all_relations"
                      ? "link_off"
                      : "settings"
        }
        size={18}
        color="#666"
      />

      {/* Description */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" noWrap>
          {actionLabel}
          {impact.field_name && (
            <Typography component="span" variant="body2" color="text.secondary">
              {" "}
              &mdash; {impact.field_name}
            </Typography>
          )}
        </Typography>
        {targetName && (
          <Typography variant="caption" color="text.secondary" noWrap display="block">
            {targetName}
          </Typography>
        )}
      </Box>

      {/* Implied / Custom badge */}
      <Chip
        size="small"
        label={impact.is_implied ? "implied" : "custom"}
        variant="outlined"
        sx={{ height: 20, fontSize: "0.65rem" }}
      />

      {/* Toggle disable for implied impacts */}
      {impact.is_implied && onToggleDisable && (
        <Tooltip title={impact.is_disabled ? "Enable impact" : "Disable impact"}>
          <IconButton
            size="small"
            onClick={() => onToggleDisable(impact.id, !impact.is_disabled)}
          >
            <MaterialSymbol
              icon={impact.is_disabled ? "toggle_off" : "toggle_on"}
              size={22}
              color={impact.is_disabled ? "#bdbdbd" : "#4caf50"}
            />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}

// ── Sub-component: Create Dialog ────────────────────────────────

function CreateTransformationDialog({
  open,
  onClose,
  fsId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  fsId: string;
  onCreated: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [templates, setTemplates] = useState<TransformationTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<TransformationTemplate | null>(null);
  const [name, setName] = useState("");
  const [completionDate, setCompletionDate] = useState("");
  const [templateFields, setTemplateFields] = useState<Record<string, unknown>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Load templates
  useEffect(() => {
    if (!open) return;
    setTemplatesLoading(true);
    api
      .get<TransformationTemplate[]>("/transformations/templates")
      .then(setTemplates)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load templates"))
      .finally(() => setTemplatesLoading(false));
  }, [open]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setStep(1);
      setSelectedTemplate(null);
      setName("");
      setCompletionDate("");
      setTemplateFields({});
      setError("");
      setSaving(false);
    }
  }, [open]);

  const handleSelectTemplate = (template: TransformationTemplate) => {
    setSelectedTemplate(template);
    setName(template.name);
    setTemplateFields({});
    setStep(2);
  };

  const handleCreate = async () => {
    if (!selectedTemplate || !name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        initiative_id: fsId,
        template_id: selectedTemplate.id,
        template_fields: templateFields,
      };
      if (completionDate) payload.completion_date = completionDate;
      await api.post("/transformations", payload);
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create transformation");
    } finally {
      setSaving(false);
    }
  };

  const grouped = groupTemplatesByType(templates);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {step === 1 ? "Select Template" : "Configure Transformation"}
      </DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" onClose={() => setError("")} sx={{ mb: 2, mt: 1 }}>
            {error}
          </Alert>
        )}

        {step === 1 && (
          <>
            {templatesLoading && <LinearProgress sx={{ mb: 2 }} />}
            {!templatesLoading && templates.length === 0 && (
              <Typography color="text.secondary" variant="body2" sx={{ py: 2 }}>
                No templates available.
              </Typography>
            )}
            {Object.entries(grouped).map(([typeKey, tpls]) => (
              <Box key={typeKey} sx={{ mb: 2 }}>
                <Typography
                  variant="overline"
                  color="text.secondary"
                  sx={{ display: "block", mb: 0.5 }}
                >
                  {typeKey}
                </Typography>
                {tpls.map((tpl) => (
                  <Card
                    key={tpl.id}
                    sx={{
                      mb: 1,
                      cursor: "pointer",
                      border: "1px solid",
                      borderColor: "divider",
                      "&:hover": { borderColor: "primary.main", bgcolor: "action.hover" },
                    }}
                    onClick={() => handleSelectTemplate(tpl)}
                  >
                    <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                      <Typography variant="subtitle2" fontWeight={600}>
                        {tpl.name}
                      </Typography>
                      {tpl.description && (
                        <Typography variant="caption" color="text.secondary">
                          {tpl.description}
                        </Typography>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </Box>
            ))}
          </>
        )}

        {step === 2 && selectedTemplate && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
            <TextField
              label="Transformation Name"
              fullWidth
              size="small"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <TextField
              label="Completion Date"
              type="date"
              size="small"
              value={completionDate}
              onChange={(e) => setCompletionDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            {selectedTemplate.required_fields.length > 0 && (
              <>
                <Divider />
                <Typography variant="subtitle2" fontWeight={600}>
                  Template Fields
                </Typography>
                {selectedTemplate.required_fields.map((field) => (
                  <TemplateFieldInput
                    key={field.key}
                    field={field}
                    value={templateFields[field.key]}
                    onChange={(val) =>
                      setTemplateFields((prev) => ({ ...prev, [field.key]: val }))
                    }
                  />
                ))}
              </>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {step === 2 && (
          <Button
            onClick={() => {
              setStep(1);
              setSelectedTemplate(null);
            }}
            sx={{ mr: "auto" }}
          >
            Back
          </Button>
        )}
        <Button onClick={onClose}>Cancel</Button>
        {step === 2 && (
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={!name.trim() || saving}
          >
            {saving ? "Creating..." : "Create"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

// ── Sub-component: Template field input ─────────────────────────

function TemplateFieldInput({
  field,
  value,
  onChange,
}: {
  field: TemplateRequiredField;
  value: unknown;
  onChange: (val: unknown) => void;
}) {
  const search = useFactSheetSearch(
    field.fact_sheet_type || "",
    field.type === "fact_sheet_ref"
  );

  if (field.type === "fact_sheet_ref") {
    return (
      <Autocomplete
        options={search.options}
        getOptionLabel={(opt) => (opt as FSRef).name || ""}
        value={(value as FSRef) || null}
        onChange={(_, val) => onChange(val)}
        inputValue={search.inputValue}
        onInputChange={(_, val) => search.setInputValue(val)}
        loading={search.loading}
        renderInput={(params) => (
          <TextField
            {...params}
            size="small"
            label={field.label}
            required={field.required}
            placeholder="Type to search..."
          />
        )}
        noOptionsText={search.inputValue ? "No results found" : "Type to search..."}
        filterOptions={(x) => x}
        isOptionEqualToValue={(option, val) => option.id === val.id}
      />
    );
  }

  return (
    <TextField
      label={field.label}
      size="small"
      fullWidth
      required={field.required}
      value={(value as string) || ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// ── Sub-component: Detail/Edit Dialog ───────────────────────────

function TransformationDetailDialog({
  open,
  onClose,
  transformation,
  onRefresh,
}: {
  open: boolean;
  onClose: () => void;
  transformation: Transformation | null;
  onRefresh: () => void;
}) {
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  // Add custom impact state
  const [addImpactOpen, setAddImpactOpen] = useState(false);
  const [newImpactType, setNewImpactType] = useState("modification");
  const [newImpactAction, setNewImpactAction] = useState("set_field");
  const [newImpactFieldName, setNewImpactFieldName] = useState("");
  const [newImpactFieldValue, setNewImpactFieldValue] = useState("");
  const [newImpactTargetSearch, setNewImpactTargetSearch] = useState("");
  const [newImpactTargetOptions, setNewImpactTargetOptions] = useState<FSRef[]>([]);
  const [newImpactTarget, setNewImpactTarget] = useState<FSRef | null>(null);
  const [addImpactSaving, setAddImpactSaving] = useState(false);

  // Search for target fact sheet
  useEffect(() => {
    if (!addImpactOpen || newImpactTargetSearch.length < 1) {
      setNewImpactTargetOptions([]);
      return;
    }
    const timer = setTimeout(() => {
      api
        .get<{ items: FSRef[] }>(
          `/fact-sheets?search=${encodeURIComponent(newImpactTargetSearch)}&page_size=20`
        )
        .then((res) => setNewImpactTargetOptions(res.items))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [addImpactOpen, newImpactTargetSearch]);

  useEffect(() => {
    if (!open) {
      setError("");
      setAddImpactOpen(false);
      resetAddImpactForm();
    }
  }, [open]);

  const resetAddImpactForm = () => {
    setNewImpactType("modification");
    setNewImpactAction("set_field");
    setNewImpactFieldName("");
    setNewImpactFieldValue("");
    setNewImpactTarget(null);
    setNewImpactTargetSearch("");
  };

  if (!transformation) return null;

  const impactGroups = groupImpactsByOrder(transformation.impacts || []);

  const handleToggleDisable = async (impactId: string, disabled: boolean) => {
    setError("");
    try {
      await api.patch(`/transformations/${transformation.id}/impacts/${impactId}`, {
        is_disabled: disabled,
      });
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update impact");
    }
  };

  const handleStatusChange = async (newStatus: TransformationStatus) => {
    setError("");
    setActionLoading(true);
    try {
      if (newStatus === "executed") {
        await api.post(`/transformations/${transformation.id}/execute`);
      } else {
        await api.patch(`/transformations/${transformation.id}`, { status: newStatus });
      }
      onRefresh();
      if (newStatus === "executed") onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update status");
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddImpact = async () => {
    if (!newImpactTarget) return;
    setAddImpactSaving(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        impact_type: newImpactType,
        action: newImpactAction,
        target_fact_sheet_id: newImpactTarget.id,
        is_implied: false,
        is_disabled: false,
      };
      if (newImpactFieldName) payload.field_name = newImpactFieldName;
      if (newImpactFieldValue) payload.field_value = newImpactFieldValue;
      await api.post(
        `/transformations/${transformation.id}/impacts`,
        payload
      );
      resetAddImpactForm();
      setAddImpactOpen(false);
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add impact");
    } finally {
      setAddImpactSaving(false);
    }
  };

  const handleDeleteImpact = async (impactId: string) => {
    setError("");
    try {
      await api.delete(
        `/transformations/${transformation.id}/impacts/${impactId}`
      );
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete impact");
    }
  };

  const statusProps = STATUS_CHIP_PROPS[transformation.status];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <MaterialSymbol icon="transform" size={24} color="#666" />
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" fontWeight={700}>
              {transformation.name}
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5 }}>
              <Chip
                size="small"
                label={statusProps.label}
                color={statusProps.color}
              />
              {transformation.template && (
                <Typography variant="caption" color="text.secondary">
                  Template: {transformation.template.name}
                </Typography>
              )}
              {transformation.completion_date && (
                <Chip
                  size="small"
                  label={transformation.completion_date}
                  icon={<MaterialSymbol icon="event" size={14} />}
                  variant="outlined"
                  sx={{ height: 22, fontSize: "0.7rem" }}
                />
              )}
            </Box>
          </Box>
        </Box>
      </DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" onClose={() => setError("")} sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {actionLoading && <LinearProgress sx={{ mb: 2 }} />}

        {/* Impacts grouped by execution order */}
        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
          Impacts ({(transformation.impacts || []).length})
        </Typography>

        {impactGroups.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            No impacts defined yet.
          </Typography>
        )}

        {impactGroups.map(({ order, items }) => (
          <Box key={order} sx={{ mb: 2 }}>
            <Typography
              variant="overline"
              color="text.secondary"
              sx={{ display: "block", mb: 0.5 }}
            >
              Step {order + 1}
            </Typography>
            <Card variant="outlined">
              {items.map((impact, i) => (
                <Box key={impact.id}>
                  {i > 0 && <Divider />}
                  <Box sx={{ display: "flex", alignItems: "center" }}>
                    <Box sx={{ flex: 1 }}>
                      <ImpactRow
                        impact={impact}
                        onToggleDisable={
                          transformation.status !== "executed"
                            ? handleToggleDisable
                            : undefined
                        }
                      />
                    </Box>
                    {/* Delete button for custom (non-implied) impacts */}
                    {!impact.is_implied && transformation.status !== "executed" && (
                      <Tooltip title="Delete impact">
                        <IconButton
                          size="small"
                          onClick={() => handleDeleteImpact(impact.id)}
                          sx={{ mr: 1 }}
                        >
                          <MaterialSymbol icon="delete" size={18} color="#f44336" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                </Box>
              ))}
            </Card>
          </Box>
        ))}

        {/* Add Impact section */}
        {transformation.status !== "executed" && (
          <>
            {!addImpactOpen ? (
              <Button
                size="small"
                variant="outlined"
                startIcon={<MaterialSymbol icon="add" size={16} />}
                onClick={() => setAddImpactOpen(true)}
                sx={{ mt: 1 }}
              >
                Add Impact
              </Button>
            ) : (
              <Card
                variant="outlined"
                sx={{
                  mt: 1,
                  p: 2,
                  border: "1px solid",
                  borderColor: "primary.main",
                }}
              >
                <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1.5 }}>
                  Add Custom Impact
                </Typography>
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                    gap: 2,
                    mb: 2,
                  }}
                >
                  <FormControl size="small" fullWidth>
                    <InputLabel>Impact Type</InputLabel>
                    <Select
                      value={newImpactType}
                      label="Impact Type"
                      onChange={(e) => setNewImpactType(e.target.value)}
                    >
                      {Object.entries(IMPACT_TYPE_COLORS).map(([key, color]) => (
                        <MenuItem key={key} value={key}>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                            <Box
                              sx={{
                                width: 10,
                                height: 10,
                                borderRadius: "50%",
                                bgcolor: color,
                              }}
                            />
                            {key}
                          </Box>
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl size="small" fullWidth>
                    <InputLabel>Action</InputLabel>
                    <Select
                      value={newImpactAction}
                      label="Action"
                      onChange={(e) => setNewImpactAction(e.target.value)}
                    >
                      {Object.entries(ACTION_LABELS).map(([key, label]) => (
                        <MenuItem key={key} value={key}>
                          {label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <Autocomplete
                    options={newImpactTargetOptions}
                    getOptionLabel={(opt) => opt.name || ""}
                    value={newImpactTarget}
                    onChange={(_, val) => setNewImpactTarget(val)}
                    inputValue={newImpactTargetSearch}
                    onInputChange={(_, val) => setNewImpactTargetSearch(val)}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        size="small"
                        label="Target Fact Sheet"
                        placeholder="Type to search..."
                      />
                    )}
                    noOptionsText={
                      newImpactTargetSearch ? "No results found" : "Type to search..."
                    }
                    filterOptions={(x) => x}
                    isOptionEqualToValue={(option, val) => option.id === val.id}
                  />
                  {(newImpactAction === "set_field" ||
                    newImpactAction === "copy_field") && (
                    <>
                      <TextField
                        size="small"
                        label="Field Name"
                        value={newImpactFieldName}
                        onChange={(e) => setNewImpactFieldName(e.target.value)}
                        fullWidth
                      />
                      {newImpactAction === "set_field" && (
                        <TextField
                          size="small"
                          label="Field Value"
                          value={newImpactFieldValue}
                          onChange={(e) => setNewImpactFieldValue(e.target.value)}
                          fullWidth
                        />
                      )}
                    </>
                  )}
                </Box>
                <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
                  <Button
                    size="small"
                    onClick={() => {
                      setAddImpactOpen(false);
                      resetAddImpactForm();
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    onClick={handleAddImpact}
                    disabled={!newImpactTarget || addImpactSaving}
                  >
                    {addImpactSaving ? "Adding..." : "Add"}
                  </Button>
                </Box>
              </Card>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        {/* Status transition buttons */}
        {transformation.status === "draft" && (
          <Button
            variant="outlined"
            color="primary"
            onClick={() => handleStatusChange("planned")}
            disabled={actionLoading}
            startIcon={<MaterialSymbol icon="check" size={18} />}
            sx={{ mr: "auto" }}
          >
            Mark as Planned
          </Button>
        )}
        {transformation.status === "planned" && (
          <Button
            variant="contained"
            color="success"
            onClick={() => handleStatusChange("executed")}
            disabled={actionLoading}
            startIcon={<MaterialSymbol icon="play_arrow" size={18} />}
            sx={{ mr: "auto" }}
          >
            Execute
          </Button>
        )}
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Sub-component: Delete confirmation dialog ───────────────────

function DeleteConfirmDialog({
  open,
  onClose,
  transformation,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  transformation: Transformation | null;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setError("");
      setDeleting(false);
    }
  }, [open]);

  const handleDelete = async () => {
    if (!transformation) return;
    setDeleting(true);
    setError("");
    try {
      await api.delete(`/transformations/${transformation.id}`);
      onDeleted();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Delete Transformation</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" onClose={() => setError("")} sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Typography variant="body2">
          Are you sure you want to delete{" "}
          <strong>{transformation?.name}</strong>? This action cannot be undone.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={deleting}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="error"
          onClick={handleDelete}
          disabled={deleting}
        >
          {deleting ? "Deleting..." : "Delete"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Main Component: TransformationsTab ──────────────────────────

export default function TransformationsTab({ fsId, fsType }: { fsId: string; fsType?: string }) {
  const isInitiative = fsType === "Initiative";
  const [transformations, setTransformations] = useState<Transformation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Dialog states
  const [createOpen, setCreateOpen] = useState(false);
  const [detailTransformation, setDetailTransformation] = useState<Transformation | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Transformation | null>(null);

  const loadTransformations = useCallback(async () => {
    setLoading(true);
    try {
      const param = isInitiative
        ? `initiative_id=${fsId}`
        : `target_fact_sheet_id=${fsId}`;
      const res = await api.get<{ items: Transformation[]; total: number }>(
        `/transformations?${param}`
      );
      setTransformations(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load transformations");
    } finally {
      setLoading(false);
    }
  }, [fsId, isInitiative]);

  useEffect(() => {
    loadTransformations();
  }, [loadTransformations]);

  // When the detail dialog is open, reload its transformation data on refresh
  const handleDetailRefresh = useCallback(async () => {
    await loadTransformations();
    if (detailTransformation) {
      try {
        const updated = await api.get<Transformation>(
          `/transformations/${detailTransformation.id}`
        );
        setDetailTransformation(updated);
      } catch {
        // Transformation may have been deleted
        setDetailTransformation(null);
      }
    }
  }, [loadTransformations, detailTransformation]);

  if (error && transformations.length === 0) {
    return (
      <Alert severity="error" onClose={() => setError("")}>
        {error}
      </Alert>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 2,
        }}
      >
        <Typography variant="subtitle1" fontWeight={600}>
          Transformations
        </Typography>
        {isInitiative && (
          <Button
            variant="contained"
            size="small"
            startIcon={<MaterialSymbol icon="add" size={18} />}
            onClick={() => setCreateOpen(true)}
            sx={{ textTransform: "none" }}
          >
            New Transformation
          </Button>
        )}
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError("")} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {/* Empty state */}
      {!loading && transformations.length === 0 && (
        <Box sx={{ textAlign: "center", py: 4 }}>
          <MaterialSymbol icon="transform" size={48} color="#bdbdbd" />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {isInitiative
              ? "No transformations yet. Create one to define planned architecture changes."
              : "No transformations affect this fact sheet."}
          </Typography>
        </Box>
      )}

      {/* Transformation cards */}
      {transformations.map((t) => {
        const statusProps = STATUS_CHIP_PROPS[t.status];
        return (
          <Card
            key={t.id}
            sx={{
              mb: 1.5,
              cursor: "pointer",
              border: "1px solid",
              borderColor: "divider",
              "&:hover": { borderColor: "primary.light", boxShadow: 1 },
            }}
            onClick={() => setDetailTransformation(t)}
          >
            <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                }}
              >
                <MaterialSymbol icon="transform" size={20} color="#666" />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle2" fontWeight={600} noWrap>
                    {t.name}
                  </Typography>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.25 }}>
                    {t.template && (
                      <Typography variant="caption" color="text.secondary">
                        {t.template.name}
                      </Typography>
                    )}
                  </Box>
                </Box>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    flexShrink: 0,
                  }}
                >
                  {t.completion_date && (
                    <Tooltip title="Completion date">
                      <Chip
                        size="small"
                        label={t.completion_date}
                        icon={<MaterialSymbol icon="event" size={14} />}
                        variant="outlined"
                        sx={{ height: 22, fontSize: "0.7rem" }}
                      />
                    </Tooltip>
                  )}
                  <Tooltip title={`${t.impact_count} impact${t.impact_count !== 1 ? "s" : ""}`}>
                    <Chip
                      size="small"
                      label={t.impact_count}
                      icon={<MaterialSymbol icon="bolt" size={14} />}
                      variant="outlined"
                      sx={{ height: 22, fontSize: "0.7rem" }}
                    />
                  </Tooltip>
                  <Chip
                    size="small"
                    label={statusProps.label}
                    color={statusProps.color}
                  />
                  <Tooltip title="Delete">
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(t);
                      }}
                    >
                      <MaterialSymbol icon="delete" size={18} color="#999" />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>
            </CardContent>
          </Card>
        );
      })}

      {/* Dialogs */}
      <CreateTransformationDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        fsId={fsId}
        onCreated={loadTransformations}
      />

      <TransformationDetailDialog
        open={!!detailTransformation}
        onClose={() => setDetailTransformation(null)}
        transformation={detailTransformation}
        onRefresh={handleDetailRefresh}
      />

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        transformation={deleteTarget}
        onDeleted={loadTransformations}
      />
    </Box>
  );
}
