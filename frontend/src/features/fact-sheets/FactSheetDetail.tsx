import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Alert from "@mui/material/Alert";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import LinearProgress from "@mui/material/LinearProgress";
import Tooltip from "@mui/material/Tooltip";
import Menu from "@mui/material/Menu";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import QualitySealBadge from "@/components/QualitySealBadge";
import LifecycleBadge from "@/components/LifecycleBadge";
import EolLinkSection from "@/components/EolLinkSection";
import VendorField from "@/components/VendorField";
import { useMetamodel } from "@/hooks/useMetamodel";
import { api } from "@/api/client";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Autocomplete from "@mui/material/Autocomplete";
import ProcessFlowTab from "@/features/bpm/ProcessFlowTab";
import ProcessAssessmentPanel from "@/features/bpm/ProcessAssessmentPanel";
import type {
  FactSheet,
  Relation,
  Comment as CommentType,
  Todo,
  EventEntry,
  FieldDef,
  SubscriptionRef,
  SubscriptionRoleDef,
  User,
  HierarchyData,
  FactSheetEffectivePermissions,
} from "@/types";

// ── Completion Ring ─────────────────────────────────────────────
function CompletionRing({ value }: { value: number }) {
  const size = 52;
  const sw = 5;
  const r = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (value / 100) * circ;
  const color = value >= 80 ? "#4caf50" : value >= 50 ? "#ff9800" : "#f44336";
  return (
    <Tooltip title={`${Math.round(value)}% complete`}>
      <Box
        sx={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: size,
          height: size,
        }}
      >
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="#e0e0e0"
            strokeWidth={sw}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={sw}
            strokeDasharray={circ}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        </svg>
        <Typography
          variant="caption"
          fontWeight={700}
          sx={{ position: "absolute" }}
        >
          {Math.round(value)}%
        </Typography>
      </Box>
    </Tooltip>
  );
}

// ── Lifecycle Phase Labels ──────────────────────────────────────
const PHASES = ["plan", "phaseIn", "active", "phaseOut", "endOfLife"] as const;
const PHASE_LABELS: Record<string, string> = {
  plan: "Plan",
  phaseIn: "Phase In",
  active: "Active",
  phaseOut: "Phase Out",
  endOfLife: "End of Life",
};

// ── Read-only field value renderer ──────────────────────────────
function FieldValue({ field, value }: { field: FieldDef; value: unknown }) {
  if (field.type === "single_select" && field.options) {
    const opt = field.options.find((o) => o.key === value);
    return opt ? (
      <Chip
        size="small"
        label={opt.label}
        sx={opt.color ? { bgcolor: opt.color, color: "#fff" } : {}}
      />
    ) : (
      <Typography variant="body2" color="text.secondary">
        —
      </Typography>
    );
  }
  if (field.type === "boolean") {
    return (
      <MaterialSymbol
        icon={value ? "check_circle" : "cancel"}
        size={18}
        color={value ? "#4caf50" : "#bdbdbd"}
      />
    );
  }
  return (
    <Typography variant="body2">
      {value != null && value !== "" ? String(value) : "—"}
    </Typography>
  );
}

// ── Field editor (inline) ───────────────────────────────────────
function FieldEditor({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (field.type) {
    case "single_select":
      return (
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>{field.label}</InputLabel>
          <Select
            value={(value as string) ?? ""}
            label={field.label}
            onChange={(e) => onChange(e.target.value || undefined)}
          >
            <MenuItem value="">
              <em>None</em>
            </MenuItem>
            {field.options?.map((opt) => (
              <MenuItem key={opt.key} value={opt.key}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  {opt.color && (
                    <Box
                      sx={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        bgcolor: opt.color,
                      }}
                    />
                  )}
                  {opt.label}
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      );
    case "number":
      return (
        <TextField
          size="small"
          label={field.label}
          type="number"
          value={value ?? ""}
          onChange={(e) =>
            onChange(e.target.value ? Number(e.target.value) : undefined)
          }
          sx={{ minWidth: 200 }}
        />
      );
    case "boolean":
      return (
        <FormControlLabel
          control={
            <Switch
              checked={!!value}
              onChange={(e) => onChange(e.target.checked)}
            />
          }
          label={field.label}
        />
      );
    case "date":
      return (
        <TextField
          size="small"
          label={field.label}
          type="date"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value || undefined)}
          InputLabelProps={{ shrink: true }}
          sx={{ minWidth: 200 }}
        />
      );
    default:
      return (
        <TextField
          size="small"
          label={field.label}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value || undefined)}
          sx={{ minWidth: 300 }}
        />
      );
  }
}

// ── Section: Description ────────────────────────────────────────
function DescriptionSection({
  fs,
  onSave,
  canEdit = true,
}: {
  fs: FactSheet;
  onSave: (u: Record<string, unknown>) => Promise<void>;
  canEdit?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(fs.name);
  const [description, setDescription] = useState(fs.description || "");

  useEffect(() => {
    setName(fs.name);
    setDescription(fs.description || "");
  }, [fs.name, fs.description]);

  const save = async () => {
    await onSave({ name, description });
    setEditing(false);
  };

  return (
    <Accordion defaultExpanded disableGutters>
      <AccordionSummary expandIcon={<MaterialSymbol icon="expand_more" size={20} />}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1 }}>
          <MaterialSymbol icon="description" size={20} color="#666" />
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
            <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
              <Button
                size="small"
                onClick={() => {
                  setName(fs.name);
                  setDescription(fs.description || "");
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
          <Typography variant="body2" color="text.secondary" whiteSpace="pre-wrap">
            {fs.description || "No description provided."}
          </Typography>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

// ── Section: Lifecycle ──────────────────────────────────────────
function LifecycleSection({
  fs,
  onSave,
  canEdit = true,
}: {
  fs: FactSheet;
  onSave: (u: Record<string, unknown>) => Promise<void>;
  canEdit?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [lifecycle, setLifecycle] = useState<Record<string, string>>(
    fs.lifecycle || {}
  );

  useEffect(() => {
    setLifecycle(fs.lifecycle || {});
  }, [fs.lifecycle]);

  const save = async () => {
    await onSave({ lifecycle });
    setEditing(false);
  };

  return (
    <Accordion defaultExpanded disableGutters>
      <AccordionSummary expandIcon={<MaterialSymbol icon="expand_more" size={20} />}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1 }}>
          <MaterialSymbol icon="timeline" size={20} color="#666" />
          <Typography fontWeight={600}>Lifecycle</Typography>
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
        {/* Timeline visualization */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 0, mb: 2 }}>
          {PHASES.map((phase, i) => {
            const date = lifecycle[phase];
            const now = new Date().toISOString().slice(0, 10);
            const isCurrent = date && date <= now;
            const isPast =
              i < PHASES.length - 1 &&
              PHASES.slice(i + 1).some((p) => lifecycle[p] && lifecycle[p]! <= now);
            return (
              <Box
                key={phase}
                sx={{
                  flex: 1,
                  textAlign: "center",
                  position: "relative",
                }}
              >
                <Box
                  sx={{
                    height: 4,
                    bgcolor: isPast || isCurrent ? "#1976d2" : "#e0e0e0",
                    borderRadius: i === 0 ? "2px 0 0 2px" : i === 4 ? "0 2px 2px 0" : 0,
                  }}
                />
                <Box
                  sx={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    bgcolor: isCurrent && !isPast ? "#1976d2" : isPast ? "#1976d2" : "#e0e0e0",
                    border: isCurrent && !isPast ? "2px solid #0d47a1" : "none",
                    position: "absolute",
                    top: -4,
                    left: "50%",
                    transform: "translateX(-50%)",
                  }}
                />
                <Typography
                  variant="caption"
                  display="block"
                  sx={{
                    mt: 1.5,
                    fontWeight: isCurrent && !isPast ? 700 : 400,
                    color: isCurrent || isPast ? "text.primary" : "text.secondary",
                  }}
                >
                  {PHASE_LABELS[phase]}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {date || "—"}
                </Typography>
              </Box>
            );
          })}
        </Box>
        {editing && (
          <Box>
            <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", mb: 2 }}>
              {PHASES.map((phase) => (
                <TextField
                  key={phase}
                  label={PHASE_LABELS[phase]}
                  type="date"
                  size="small"
                  value={lifecycle[phase] || ""}
                  onChange={(e) =>
                    setLifecycle({ ...lifecycle, [phase]: e.target.value })
                  }
                  InputLabelProps={{ shrink: true }}
                  sx={{ width: 170 }}
                />
              ))}
            </Box>
            <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
              <Button
                size="small"
                onClick={() => {
                  setLifecycle(fs.lifecycle || {});
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
        )}
      </AccordionDetails>
    </Accordion>
  );
}

// ── Section: Type-specific attributes ───────────────────────────
const VENDOR_ELIGIBLE_TYPES = ["ITComponent", "Application"];

function AttributeSection({
  section,
  fs,
  onSave,
  onRelationChange,
  canEdit = true,
}: {
  section: { section: string; fields: FieldDef[] };
  fs: FactSheet;
  onSave: (u: Record<string, unknown>) => Promise<void>;
  onRelationChange?: () => void;
  canEdit?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [attrs, setAttrs] = useState<Record<string, unknown>>(
    fs.attributes || {}
  );
  useEffect(() => {
    setAttrs(fs.attributes || {});
  }, [fs.attributes]);

  const save = async () => {
    await onSave({ attributes: attrs });
    setEditing(false);
  };

  const setAttr = (key: string, value: unknown) => {
    setAttrs((prev) => ({ ...prev, [key]: value }));
  };

  const isVendorField = (field: FieldDef) =>
    field.key === "vendor" && VENDOR_ELIGIBLE_TYPES.includes(fs.type);

  // Count filled fields in this section
  const filled = section.fields.filter((f) => {
    const v = (fs.attributes || {})[f.key];
    return v != null && v !== "" && v !== false;
  }).length;

  return (
    <Accordion disableGutters>
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
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mb: 2 }}>
              {section.fields.map((field) =>
                field.readonly ? (
                  <Box key={field.key} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ minWidth: 160 }}>
                      {field.label}
                    </Typography>
                    <FieldValue field={field} value={attrs[field.key]} />
                    <Chip size="small" label="auto" sx={{ height: 18, fontSize: "0.6rem", ml: 0.5 }} />
                  </Box>
                ) : isVendorField(field) ? (
                  <VendorField
                    key={field.key}
                    value={(attrs[field.key] as string) ?? ""}
                    onChange={(v) => setAttr(field.key, v)}
                    fsType={fs.type}
                    fsId={fs.id}
                    onRelationChange={onRelationChange}
                  />
                ) : (
                  <FieldEditor
                    key={field.key}
                    field={field}
                    value={attrs[field.key]}
                    onChange={(v) => setAttr(field.key, v)}
                  />
                )
              )}
            </Box>
            <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
              <Button
                size="small"
                onClick={() => {
                  setAttrs(fs.attributes || {});
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
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "180px 1fr" },
              rowGap: 1,
              columnGap: 2,
              alignItems: { sm: "center" },
            }}
          >
            {section.fields.map((field) => (
              <Box key={field.key} sx={{ display: "contents" }}>
                <Typography variant="body2" color="text.secondary">
                  {field.label}
                  {field.readonly && (
                    <Chip component="span" size="small" label="auto" sx={{ height: 16, fontSize: "0.55rem", ml: 0.5, verticalAlign: "middle" }} />
                  )}
                </Typography>
                <FieldValue
                  field={field}
                  value={(fs.attributes || {})[field.key]}
                />
              </Box>
            ))}
          </Box>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

// ── Section: Hierarchy ───────────────────────────────────────────
const LEVEL_COLORS = ["#1565c0", "#42a5f5", "#90caf9", "#bbdefb", "#e3f2fd"];

function HierarchySection({
  fs,
  onUpdate,
  canEdit = true,
}: {
  fs: FactSheet;
  onUpdate: () => void;
  canEdit?: boolean;
}) {
  const navigate = useNavigate();
  const { getType } = useMetamodel();
  const typeConfig = getType(fs.type);
  const [hierarchy, setHierarchy] = useState<HierarchyData | null>(null);

  // Parent picker state
  const [pickingParent, setPickingParent] = useState(false);
  const [parentSearch, setParentSearch] = useState("");
  const [parentOptions, setParentOptions] = useState<{ id: string; name: string }[]>([]);
  const [selectedParent, setSelectedParent] = useState<{ id: string; name: string } | null>(null);

  // Add child state
  const [addChildOpen, setAddChildOpen] = useState(false);
  const [childSearch, setChildSearch] = useState("");
  const [childOptions, setChildOptions] = useState<{ id: string; name: string }[]>([]);
  const [selectedChild, setSelectedChild] = useState<{ id: string; name: string } | null>(null);

  // Inline create state
  const [createMode, setCreateMode] = useState<"parent" | "child" | null>(null);
  const [createName, setCreateName] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [hierarchyError, setHierarchyError] = useState("");

  const loadHierarchy = useCallback(() => {
    api.get<HierarchyData>(`/fact-sheets/${fs.id}/hierarchy`).then(setHierarchy).catch(() => {});
  }, [fs.id]);

  useEffect(loadHierarchy, [loadHierarchy]);

  // Search parents (same type, exclude self and descendants)
  useEffect(() => {
    if (!pickingParent || parentSearch.length < 1) { setParentOptions([]); return; }
    const timer = setTimeout(() => {
      api
        .get<{ items: { id: string; name: string }[] }>(
          `/fact-sheets?type=${fs.type}&search=${encodeURIComponent(parentSearch)}&page_size=20`
        )
        .then((res) => {
          const childIds = new Set(hierarchy?.children.map((c) => c.id) || []);
          setParentOptions(res.items.filter((item) => item.id !== fs.id && !childIds.has(item.id)));
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [pickingParent, parentSearch, fs.id, fs.type, hierarchy]);

  // Search children (same type, exclude self)
  useEffect(() => {
    if (!addChildOpen || childSearch.length < 1) { setChildOptions([]); return; }
    const timer = setTimeout(() => {
      api
        .get<{ items: { id: string; name: string }[] }>(
          `/fact-sheets?type=${fs.type}&search=${encodeURIComponent(childSearch)}&page_size=20`
        )
        .then((res) => {
          const ancestorIds = new Set(hierarchy?.ancestors.map((a) => a.id) || []);
          setChildOptions(res.items.filter((item) => item.id !== fs.id && !ancestorIds.has(item.id)));
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [addChildOpen, childSearch, fs.id, fs.type, hierarchy]);

  const handleSetParent = async () => {
    if (!selectedParent) return;
    try {
      setHierarchyError("");
      await api.patch(`/fact-sheets/${fs.id}`, { parent_id: selectedParent.id });
      setPickingParent(false);
      setSelectedParent(null);
      setParentSearch("");
      loadHierarchy();
      onUpdate();
    } catch (err: unknown) {
      setHierarchyError(err instanceof Error ? err.message : "Failed to set parent");
    }
  };

  const handleRemoveParent = async () => {
    await api.patch(`/fact-sheets/${fs.id}`, { parent_id: null });
    loadHierarchy();
    onUpdate();
  };

  const handleAddChild = async () => {
    if (!selectedChild) return;
    try {
      setHierarchyError("");
      await api.patch(`/fact-sheets/${selectedChild.id}`, { parent_id: fs.id });
      setAddChildOpen(false);
      setSelectedChild(null);
      setChildSearch("");
      loadHierarchy();
    } catch (err: unknown) {
      setHierarchyError(err instanceof Error ? err.message : "Failed to add child");
    }
  };

  const handleRemoveChild = async (childId: string) => {
    await api.patch(`/fact-sheets/${childId}`, { parent_id: null });
    loadHierarchy();
  };

  const handleQuickCreate = async () => {
    if (!createName.trim()) return;
    setCreateLoading(true);
    setHierarchyError("");
    try {
      const created = await api.post<{ id: string; name: string }>("/fact-sheets", {
        type: fs.type,
        name: createName.trim(),
        ...(createMode === "child" ? { parent_id: fs.id } : {}),
      });
      if (createMode === "parent") {
        // Set the newly created fact sheet as parent
        await api.patch(`/fact-sheets/${fs.id}`, { parent_id: created.id });
        onUpdate();
      }
      setCreateMode(null);
      setCreateName("");
      loadHierarchy();
    } catch (err: unknown) {
      setHierarchyError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setCreateLoading(false);
    }
  };

  if (!typeConfig?.has_hierarchy) return null;

  const level = hierarchy?.level ?? 1;
  const levelColor = LEVEL_COLORS[Math.min(level - 1, LEVEL_COLORS.length - 1)];

  return (
    <Accordion defaultExpanded disableGutters>
      <AccordionSummary expandIcon={<MaterialSymbol icon="expand_more" size={20} />}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1 }}>
          <MaterialSymbol icon="account_tree" size={20} color="#666" />
          <Typography fontWeight={600}>Hierarchy</Typography>
          {hierarchy && (
            <Chip
              size="small"
              label={`Level ${level}`}
              sx={{ ml: 1, height: 20, fontSize: "0.7rem", bgcolor: levelColor, color: "#fff" }}
            />
          )}
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        {hierarchyError && (
          <Alert severity="error" onClose={() => setHierarchyError("")} sx={{ mb: 2 }}>
            {hierarchyError}
          </Alert>
        )}
        {!hierarchy ? (
          <LinearProgress />
        ) : (
          <Box>
            {/* Ancestor breadcrumb trail */}
            {hierarchy.ancestors.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mb: 0.5, display: "block" }}>
                  Path
                </Typography>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
                  {hierarchy.ancestors.map((ancestor, i) => {
                    const ancestorLevel = i + 1;
                    const aColor = LEVEL_COLORS[Math.min(ancestorLevel - 1, LEVEL_COLORS.length - 1)];
                    return (
                      <Box key={ancestor.id} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                        <Chip
                          size="small"
                          label={ancestor.name}
                          onClick={() => navigate(`/fact-sheets/${ancestor.id}`)}
                          sx={{ cursor: "pointer", borderColor: aColor, color: aColor, fontWeight: 500 }}
                          variant="outlined"
                        />
                        <MaterialSymbol icon="chevron_right" size={16} color="#bbb" />
                      </Box>
                    );
                  })}
                  <Chip
                    size="small"
                    label={fs.name}
                    sx={{ bgcolor: levelColor, color: "#fff", fontWeight: 600 }}
                  />
                </Box>
              </Box>
            )}

            {/* Parent */}
            <Box sx={{ mb: 2 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                  Parent
                </Typography>
              </Box>
              {hierarchy.ancestors.length > 0 ? (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Chip
                    size="small"
                    label={hierarchy.ancestors[hierarchy.ancestors.length - 1].name}
                    onClick={() => navigate(`/fact-sheets/${hierarchy.ancestors[hierarchy.ancestors.length - 1].id}`)}
                    sx={{ cursor: "pointer" }}
                    icon={<MaterialSymbol icon={typeConfig?.icon || "category"} size={16} />}
                  />
                  {canEdit && (
                    <IconButton size="small" onClick={() => setPickingParent(true)} title="Change parent">
                      <MaterialSymbol icon="edit" size={16} />
                    </IconButton>
                  )}
                  {canEdit && (
                    <IconButton size="small" onClick={handleRemoveParent} title="Remove parent">
                      <MaterialSymbol icon="link_off" size={16} color="#f44336" />
                    </IconButton>
                  )}
                </Box>
              ) : (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Typography variant="body2" color="text.secondary">No parent</Typography>
                  {canEdit && (
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<MaterialSymbol icon="add" size={16} />}
                      onClick={() => setPickingParent(true)}
                    >
                      Set Parent
                    </Button>
                  )}
                </Box>
              )}
            </Box>

            {/* Parent picker dialog */}
            <Dialog open={pickingParent} onClose={() => { setPickingParent(false); setCreateMode(null); setHierarchyError(""); }} maxWidth="sm" fullWidth>
              <DialogTitle>Set Parent</DialogTitle>
              <DialogContent>
                {hierarchyError && (
                  <Alert severity="error" onClose={() => setHierarchyError("")} sx={{ mb: 1, mt: 1 }}>
                    {hierarchyError}
                  </Alert>
                )}
                {!createMode ? (
                  <>
                    <Autocomplete
                      options={parentOptions}
                      getOptionLabel={(opt) => opt.name}
                      value={selectedParent}
                      onChange={(_, val) => setSelectedParent(val)}
                      inputValue={parentSearch}
                      onInputChange={(_, val) => setParentSearch(val)}
                      renderInput={(params) => (
                        <TextField {...params} size="small" label={`Search ${typeConfig?.label || fs.type}`} placeholder="Type to search..." sx={{ mt: 1 }} />
                      )}
                      noOptionsText={parentSearch ? "No results found" : "Type to search..."}
                      filterOptions={(x) => x}
                    />
                    <Button
                      size="small"
                      sx={{ mt: 1 }}
                      startIcon={<MaterialSymbol icon="add" size={16} />}
                      onClick={() => { setCreateMode("parent"); setCreateName(parentSearch); }}
                    >
                      Create new {typeConfig?.label || fs.type}
                    </Button>
                  </>
                ) : (
                  <Box sx={{ mt: 1, p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1, bgcolor: "action.hover" }}>
                    <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                      Create new {typeConfig?.label || fs.type} as parent
                    </Typography>
                    <TextField
                      fullWidth size="small" label="Name" value={createName}
                      onChange={(e) => setCreateName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleQuickCreate()}
                      autoFocus sx={{ mb: 1 }}
                    />
                    <Box sx={{ display: "flex", gap: 1 }}>
                      <Button size="small" variant="contained" onClick={handleQuickCreate} disabled={!createName.trim() || createLoading}>
                        Create & Set as Parent
                      </Button>
                      <Button size="small" onClick={() => setCreateMode(null)}>Back to search</Button>
                    </Box>
                  </Box>
                )}
              </DialogContent>
              <DialogActions>
                <Button onClick={() => { setPickingParent(false); setCreateMode(null); }}>Cancel</Button>
                {!createMode && (
                  <Button variant="contained" onClick={handleSetParent} disabled={!selectedParent}>
                    Set Parent
                  </Button>
                )}
              </DialogActions>
            </Dialog>

            {/* Children */}
            <Box>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                  Children
                </Typography>
                <Chip size="small" label={hierarchy.children.length} sx={{ height: 18, fontSize: "0.65rem" }} />
              </Box>
              {hierarchy.children.length > 0 ? (
                <List dense disablePadding>
                  {hierarchy.children.map((child) => (
                    <ListItem
                      key={child.id}
                      secondaryAction={
                        canEdit ? (
                          <IconButton size="small" onClick={() => handleRemoveChild(child.id)} title="Remove from hierarchy">
                            <MaterialSymbol icon="link_off" size={16} color="#999" />
                          </IconButton>
                        ) : undefined
                      }
                    >
                      <Box
                        component="div"
                        onClick={() => navigate(`/fact-sheets/${child.id}`)}
                        sx={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 1, "&:hover": { textDecoration: "underline" } }}
                      >
                        <MaterialSymbol icon={typeConfig?.icon || "category"} size={16} color={typeConfig?.color} />
                        <ListItemText primary={child.name} />
                      </Box>
                    </ListItem>
                  ))}
                </List>
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>No children</Typography>
              )}
              {canEdit && (
                <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<MaterialSymbol icon="add" size={16} />}
                    onClick={() => setAddChildOpen(true)}
                  >
                    Add Child
                  </Button>
                </Box>
              )}
            </Box>

            {/* Add child dialog */}
            <Dialog open={addChildOpen} onClose={() => { setAddChildOpen(false); setCreateMode(null); setHierarchyError(""); }} maxWidth="sm" fullWidth>
              <DialogTitle>Add Child</DialogTitle>
              <DialogContent>
                {hierarchyError && (
                  <Alert severity="error" onClose={() => setHierarchyError("")} sx={{ mb: 1, mt: 1 }}>
                    {hierarchyError}
                  </Alert>
                )}
                {createMode !== "child" ? (
                  <>
                    <Autocomplete
                      options={childOptions}
                      getOptionLabel={(opt) => opt.name}
                      value={selectedChild}
                      onChange={(_, val) => setSelectedChild(val)}
                      inputValue={childSearch}
                      onInputChange={(_, val) => setChildSearch(val)}
                      renderInput={(params) => (
                        <TextField {...params} size="small" label={`Search ${typeConfig?.label || fs.type}`} placeholder="Type to search..." sx={{ mt: 1 }} />
                      )}
                      noOptionsText={childSearch ? "No results found" : "Type to search..."}
                      filterOptions={(x) => x}
                    />
                    <Button
                      size="small"
                      sx={{ mt: 1 }}
                      startIcon={<MaterialSymbol icon="add" size={16} />}
                      onClick={() => { setCreateMode("child"); setCreateName(childSearch); }}
                    >
                      Create new {typeConfig?.label || fs.type}
                    </Button>
                  </>
                ) : (
                  <Box sx={{ mt: 1, p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1, bgcolor: "action.hover" }}>
                    <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                      Create new {typeConfig?.label || fs.type} as child
                    </Typography>
                    <TextField
                      fullWidth size="small" label="Name" value={createName}
                      onChange={(e) => setCreateName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleQuickCreate()}
                      autoFocus sx={{ mb: 1 }}
                    />
                    <Box sx={{ display: "flex", gap: 1 }}>
                      <Button size="small" variant="contained" onClick={handleQuickCreate} disabled={!createName.trim() || createLoading}>
                        Create & Add as Child
                      </Button>
                      <Button size="small" onClick={() => setCreateMode(null)}>Back to search</Button>
                    </Box>
                  </Box>
                )}
              </DialogContent>
              <DialogActions>
                <Button onClick={() => { setAddChildOpen(false); setCreateMode(null); }}>Cancel</Button>
                {createMode !== "child" && (
                  <Button variant="contained" onClick={handleAddChild} disabled={!selectedChild}>
                    Add Child
                  </Button>
                )}
              </DialogActions>
            </Dialog>
          </Box>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

// ── Section: Relations (with CRUD) ──────────────────────────────
function RelationsSection({ fsId, fsType, refreshKey = 0, canManageRelations = true }: { fsId: string; fsType: string; refreshKey?: number; canManageRelations?: boolean }) {
  const [relations, setRelations] = useState<Relation[]>([]);
  const { relationTypes, getType } = useMetamodel();
  const navigate = useNavigate();

  // Add relation dialog state
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addRelType, setAddRelType] = useState("");
  const [targetSearch, setTargetSearch] = useState("");
  const [searchResults, setSearchResults] = useState<{ id: string; name: string; type: string }[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<{ id: string; name: string; type: string } | null>(null);
  const [addError, setAddError] = useState("");

  // Inline create state
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createLoading, setCreateLoading] = useState(false);

  const load = useCallback(() => {
    api.get<Relation[]>(`/relations?fact_sheet_id=${fsId}`).then(setRelations).catch(() => {});
  }, [fsId]);

  useEffect(load, [load, refreshKey]);

  const relevantRTs = relationTypes.filter(
    (rt) => rt.source_type_key === fsType || rt.target_type_key === fsType
  );

  const selectedRT = relationTypes.find((rt) => rt.key === addRelType);
  const isSource = selectedRT ? selectedRT.source_type_key === fsType : true;
  const targetTypeKey = selectedRT
    ? (isSource ? selectedRT.target_type_key : selectedRT.source_type_key)
    : "";
  const targetTypeConfig = getType(targetTypeKey);

  // Search for target fact sheets when user types
  useEffect(() => {
    if (!targetTypeKey || targetSearch.length < 1) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      api
        .get<{ items: { id: string; name: string; type: string }[] }>(
          `/fact-sheets?type=${targetTypeKey}&search=${encodeURIComponent(targetSearch)}&page_size=20`
        )
        .then((res) => setSearchResults(res.items.filter((item) => item.id !== fsId)))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [targetTypeKey, targetSearch, fsId]);

  const handleAddRelation = async () => {
    if (!selectedRT || !selectedTarget) return;
    setAddError("");
    try {
      await api.post("/relations", {
        type: selectedRT.key,
        source_id: isSource ? fsId : selectedTarget.id,
        target_id: isSource ? selectedTarget.id : fsId,
      });
      load();
      setAddDialogOpen(false);
      setAddRelType("");
      setSelectedTarget(null);
      setTargetSearch("");
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Failed to create relation");
    }
  };

  const handleDeleteRelation = async (relId: string) => {
    await api.delete(`/relations/${relId}`);
    load();
  };

  // Create a new fact sheet and immediately select it as the relation target
  const handleQuickCreate = async () => {
    if (!createName.trim() || !targetTypeKey) return;
    setCreateLoading(true);
    try {
      const created = await api.post<{ id: string; name: string; type: string }>("/fact-sheets", {
        type: targetTypeKey,
        name: createName.trim(),
      });
      setSelectedTarget({ id: created.id, name: created.name, type: created.type });
      setCreateOpen(false);
      setCreateName("");
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Failed to create fact sheet");
    } finally {
      setCreateLoading(false);
    }
  };

  // Group relations by relation type – only show types that have relations
  const grouped = relevantRTs
    .map((rt) => {
      const rtIsSource = rt.source_type_key === fsType;
      const verb = rtIsSource ? rt.label : (rt.reverse_label || rt.label);
      const otherTypeKey = rtIsSource ? rt.target_type_key : rt.source_type_key;
      const otherType = getType(otherTypeKey);
      return { rt, verb, otherType, isSource: rtIsSource, rels: relations.filter((r) => r.type === rt.key) };
    })
    .filter(({ rels }) => rels.length > 0);

  return (
    <Accordion disableGutters>
      <AccordionSummary expandIcon={<MaterialSymbol icon="expand_more" size={20} />}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1 }}>
          <MaterialSymbol icon="hub" size={20} color="#666" />
          <Typography fontWeight={600}>Relations</Typography>
          <Chip size="small" label={relations.length} sx={{ ml: 1, height: 20, fontSize: "0.7rem" }} />
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        {canManageRelations && (
          <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<MaterialSymbol icon="add_link" size={16} />}
              onClick={() => setAddDialogOpen(true)}
            >
              Add Relation
            </Button>
          </Box>
        )}
        {grouped.length === 0 && (
          <Typography color="text.secondary" variant="body2">No relations yet.</Typography>
        )}
        {grouped.map(({ rt, verb, otherType, rels }) => (
          <Box key={rt.key} sx={{ mb: 2 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
              <Typography variant="subtitle2" fontWeight={600}>{verb}</Typography>
              <MaterialSymbol icon="arrow_forward" size={14} color="#bbb" />
              {otherType && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: otherType.color, flexShrink: 0 }} />
                  <Typography variant="subtitle2" color="text.secondary">{otherType.label}</Typography>
                </Box>
              )}
              <Chip size="small" label={rt.cardinality} variant="outlined" sx={{ height: 18, fontSize: "0.65rem" }} />
            </Box>
            <List dense disablePadding>
              {rels.map((r) => {
                const other = r.source_id === fsId ? r.target : r.source;
                return (
                  <ListItem
                    key={r.id}
                    secondaryAction={
                      canManageRelations ? (
                        <IconButton size="small" onClick={() => handleDeleteRelation(r.id)}>
                          <MaterialSymbol icon="close" size={16} color="#999" />
                        </IconButton>
                      ) : undefined
                    }
                  >
                    <Box
                      component="div"
                      onClick={() => other && navigate(`/fact-sheets/${other.id}`)}
                      sx={{ cursor: "pointer", "&:hover": { textDecoration: "underline" } }}
                    >
                      <ListItemText primary={other?.name || "Unknown"} secondary={other?.type} />
                    </Box>
                  </ListItem>
                );
              })}
            </List>
          </Box>
        ))}
      </AccordionDetails>

      {/* ── Add Relation Dialog ── */}
      <Dialog open={addDialogOpen} onClose={() => { setAddDialogOpen(false); setCreateOpen(false); }} maxWidth="sm" fullWidth>
        <DialogTitle>Add Relation</DialogTitle>
        <DialogContent>
          {addError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setAddError("")}>{addError}</Alert>}
          <FormControl fullWidth size="small" sx={{ mt: 1, mb: 2 }}>
            <InputLabel>Relation Type</InputLabel>
            <Select
              value={addRelType}
              label="Relation Type"
              onChange={(e) => { setAddRelType(e.target.value); setSelectedTarget(null); setTargetSearch(""); setCreateOpen(false); }}
            >
              {relevantRTs.map((rt) => {
                const rtIsSource = rt.source_type_key === fsType;
                const verb = rtIsSource ? rt.label : (rt.reverse_label || rt.label);
                const otherKey = rtIsSource ? rt.target_type_key : rt.source_type_key;
                const other = getType(otherKey);
                return (
                  <MenuItem key={rt.key} value={rt.key}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Typography variant="body2" fontWeight={500}>{verb}</Typography>
                      <MaterialSymbol icon="arrow_forward" size={14} color="#bbb" />
                      {other && (
                        <>
                          <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: other.color }} />
                          <Typography variant="body2">{other.label}</Typography>
                        </>
                      )}
                      <Chip size="small" label={rt.cardinality} variant="outlined" sx={{ height: 18, fontSize: "0.65rem" }} />
                    </Box>
                  </MenuItem>
                );
              })}
            </Select>
          </FormControl>
          {addRelType && !createOpen && (
            <>
              <Autocomplete
                options={searchResults}
                getOptionLabel={(opt) => opt.name}
                value={selectedTarget}
                onChange={(_, val) => setSelectedTarget(val)}
                inputValue={targetSearch}
                onInputChange={(_, val) => setTargetSearch(val)}
                renderOption={(props, opt) => {
                  const tConf = getType(opt.type);
                  return (
                    <li {...props} key={opt.id}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        {tConf && <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: tConf.color }} />}
                        <Typography variant="body2">{opt.name}</Typography>
                        <Typography variant="caption" color="text.secondary">{opt.type}</Typography>
                      </Box>
                    </li>
                  );
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    size="small"
                    label={`Search ${targetTypeConfig?.label || targetTypeKey}`}
                    placeholder="Type to search..."
                  />
                )}
                noOptionsText={targetSearch ? "No results found" : "Type to search..."}
                filterOptions={(x) => x}
              />
              <Button
                size="small"
                sx={{ mt: 1 }}
                startIcon={<MaterialSymbol icon="add" size={16} />}
                onClick={() => { setCreateOpen(true); setCreateName(targetSearch); }}
              >
                Create new {targetTypeConfig?.label || targetTypeKey}
              </Button>
            </>
          )}
          {addRelType && createOpen && (
            <Box sx={{ mt: 1, p: 2, border: "1px solid", borderColor: "divider", borderRadius: 1, bgcolor: "action.hover" }}>
              <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                Create new {targetTypeConfig?.label || targetTypeKey}
              </Typography>
              <TextField
                fullWidth
                size="small"
                label="Name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleQuickCreate()}
                autoFocus
                sx={{ mb: 1 }}
              />
              <Box sx={{ display: "flex", gap: 1 }}>
                <Button size="small" variant="contained" onClick={handleQuickCreate} disabled={!createName.trim() || createLoading}>
                  Create & Select
                </Button>
                <Button size="small" onClick={() => setCreateOpen(false)}>
                  Back to search
                </Button>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setAddDialogOpen(false); setCreateOpen(false); }}>Cancel</Button>
          <Button variant="contained" onClick={handleAddRelation} disabled={!selectedRT || !selectedTarget}>
            Add
          </Button>
        </DialogActions>
      </Dialog>
    </Accordion>
  );
}

// ── Tab: Comments ───────────────────────────────────────────────
function CommentsTab({ fsId, canCreateComments = true, canManageComments: _canManageComments = true }: { fsId: string; canCreateComments?: boolean; canManageComments?: boolean }) {
  const [comments, setComments] = useState<CommentType[]>([]);
  const [newComment, setNewComment] = useState("");

  const load = useCallback(() => {
    api
      .get<CommentType[]>(`/fact-sheets/${fsId}/comments`)
      .then(setComments)
      .catch(() => {});
  }, [fsId]);
  useEffect(load, [load]);

  const handleAdd = async () => {
    if (!newComment.trim()) return;
    await api.post(`/fact-sheets/${fsId}/comments`, { content: newComment });
    setNewComment("");
    load();
  };

  return (
    <Box>
      {canCreateComments && (
        <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
          <TextField
            fullWidth
            size="small"
            placeholder="Write a comment..."
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <Button
            variant="contained"
            onClick={handleAdd}
            disabled={!newComment.trim()}
          >
            Post
          </Button>
        </Box>
      )}
      {comments.length === 0 && (
        <Typography color="text.secondary" variant="body2">
          No comments yet.
        </Typography>
      )}
      {comments.map((c) => (
        <Card key={c.id} sx={{ mb: 1 }}>
          <CardContent sx={{ py: 1, "&:last-child": { pb: 1 } }}>
            <Box
              sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}
            >
              <Typography variant="subtitle2">
                {c.user_display_name || "User"}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {c.created_at ? new Date(c.created_at).toLocaleString() : ""}
              </Typography>
            </Box>
            <Typography variant="body2">{c.content}</Typography>
          </CardContent>
        </Card>
      ))}
    </Box>
  );
}

// ── Tab: Todos ──────────────────────────────────────────────────
function TodosTab({ fsId }: { fsId: string }) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newDesc, setNewDesc] = useState("");
  const [newAssignee, setNewAssignee] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api
      .get<Todo[]>(`/fact-sheets/${fsId}/todos`)
      .then(setTodos)
      .catch(() => {});
  }, [fsId]);
  useEffect(load, [load]);

  useEffect(() => {
    api.get<User[]>("/users").then(setUsers).catch(() => {});
  }, []);

  const handleAdd = async () => {
    if (!newDesc.trim() || saving) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { description: newDesc };
      if (newAssignee) payload.assigned_to = newAssignee;
      if (newDueDate) payload.due_date = newDueDate;
      await api.post(`/fact-sheets/${fsId}/todos`, payload);
      setNewDesc("");
      setNewAssignee("");
      setNewDueDate("");
      setDialogOpen(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (todo: Todo) => {
    const newStatus = todo.status === "open" ? "done" : "open";
    await api.patch(`/todos/${todo.id}`, { status: newStatus });
    setTodos(
      todos.map((t) => (t.id === todo.id ? { ...t, status: newStatus } : t))
    );
  };

  const handleDelete = async (todoId: string) => {
    await api.delete(`/todos/${todoId}`);
    load();
  };

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1 }}>
        <Button
          variant="contained"
          size="small"
          startIcon={<MaterialSymbol icon="add" size={18} />}
          sx={{ textTransform: "none" }}
          onClick={() => setDialogOpen(true)}
        >
          Add Todo
        </Button>
      </Box>
      <List dense>
        {todos.map((t) => (
          <ListItem
            key={t.id}
            secondaryAction={
              <IconButton size="small" onClick={() => handleDelete(t.id)}>
                <MaterialSymbol icon="close" size={16} color="#999" />
              </IconButton>
            }
          >
            <IconButton
              size="small"
              onClick={() => toggleStatus(t)}
              sx={{ mr: 1 }}
            >
              <MaterialSymbol
                icon={
                  t.status === "done"
                    ? "check_circle"
                    : "radio_button_unchecked"
                }
                size={20}
                color={t.status === "done" ? "#4caf50" : "#999"}
              />
            </IconButton>
            <ListItemText
              primary={t.description}
              secondary={
                <Box component="span" sx={{ display: "flex", gap: 1, mt: 0.25 }}>
                  {t.assignee_name && (
                    <Chip
                      size="small"
                      label={t.assignee_name}
                      icon={<MaterialSymbol icon="person" size={14} />}
                      variant="outlined"
                      sx={{ height: 20, fontSize: "0.7rem" }}
                    />
                  )}
                  {t.due_date && (
                    <Chip
                      size="small"
                      label={t.due_date}
                      icon={<MaterialSymbol icon="event" size={14} />}
                      variant="outlined"
                      sx={{ height: 20, fontSize: "0.7rem" }}
                    />
                  )}
                </Box>
              }
              sx={{
                textDecoration: t.status === "done" ? "line-through" : "none",
              }}
            />
          </ListItem>
        ))}
        {todos.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: "center" }}>
            No todos yet.
          </Typography>
        )}
      </List>

      {/* Add Todo Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Todo</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            label="Description"
            fullWidth
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            sx={{ mt: 1, mb: 2 }}
          />
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
            <Autocomplete
              options={users.filter((u) => u.is_active)}
              getOptionLabel={(u) => u.display_name}
              value={users.find((u) => u.id === newAssignee) || null}
              onChange={(_, val) => setNewAssignee(val?.id ?? "")}
              renderInput={(params) => (
                <TextField {...params} label="Assign to" size="small" />
              )}
              size="small"
            />
            <TextField
              label="Due date"
              type="date"
              size="small"
              InputLabelProps={{ shrink: true }}
              value={newDueDate}
              onChange={(e) => setNewDueDate(e.target.value)}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={!newDesc.trim() || saving} onClick={handleAdd}>
            {saving ? "Adding…" : "Add"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// ── Tab: Subscriptions ──────────────────────────────────────────
function SubscriptionsTab({ fs, onRefresh, canManageSubscriptions = true }: { fs: FactSheet; onRefresh: () => void; canManageSubscriptions?: boolean }) {
  const [subs, setSubs] = useState<SubscriptionRef[]>([]);
  const [roles, setRoles] = useState<SubscriptionRoleDef[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addRole, setAddRole] = useState("");
  const [addUserId, setAddUserId] = useState("");

  const load = useCallback(() => {
    api.get<SubscriptionRef[]>(`/fact-sheets/${fs.id}/subscriptions`).then(setSubs).catch(() => {});
  }, [fs.id]);

  useEffect(() => {
    load();
    api.get<SubscriptionRoleDef[]>(`/subscription-roles?type_key=${fs.type}`).then(setRoles).catch(() => {});
    api.get<User[]>("/users").then(setUsers).catch(() => {});
  }, [load, fs.type]);

  const handleAdd = async () => {
    if (!addRole || !addUserId) return;
    try {
      await api.post(`/fact-sheets/${fs.id}/subscriptions`, {
        user_id: addUserId,
        role: addRole,
      });
      load();
      onRefresh();
      setAddOpen(false);
      setAddRole("");
      setAddUserId("");
    } catch {
      /* silently ignore duplicates */
    }
  };

  const handleDelete = async (subId: string) => {
    await api.delete(`/subscriptions/${subId}`);
    load();
    onRefresh();
  };

  // Group by role
  const grouped = roles.map((role) => ({
    role,
    items: subs.filter((s) => s.role === role.key),
  }));

  return (
    <Box>
      {canManageSubscriptions && (
        <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<MaterialSymbol icon="person_add" size={16} />}
            onClick={() => setAddOpen(true)}
          >
            Add Subscription
          </Button>
        </Box>
      )}
      {grouped.map(({ role, items }) => (
        <Card key={role.key} sx={{ mb: 2 }}>
          <CardContent>
            <Typography variant="subtitle2" fontWeight={600} gutterBottom>
              {role.label}
            </Typography>
            {items.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No {role.label.toLowerCase()} assigned
              </Typography>
            ) : (
              <List dense disablePadding>
                {items.map((s) => (
                  <ListItem
                    key={s.id}
                    secondaryAction={
                      canManageSubscriptions ? (
                        <IconButton size="small" onClick={() => handleDelete(s.id)}>
                          <MaterialSymbol icon="close" size={16} />
                        </IconButton>
                      ) : undefined
                    }
                  >
                    <MaterialSymbol icon="person" size={20} />
                    <ListItemText
                      primary={s.user_display_name || s.user_email}
                      sx={{ ml: 1 }}
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </CardContent>
        </Card>
      ))}
      {/* Add subscription inline */}
      {addOpen && (
        <Card sx={{ mb: 2, border: "1px solid", borderColor: "primary.main" }}>
          <CardContent>
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
              Add Subscription
            </Typography>
            <Box sx={{ display: "flex", gap: 2, alignItems: "flex-end", flexWrap: "wrap" }}>
              <FormControl size="small" sx={{ minWidth: 200 }}>
                <InputLabel>Role</InputLabel>
                <Select value={addRole} label="Role" onChange={(e) => setAddRole(e.target.value)}>
                  {roles.map((r) => (
                    <MenuItem key={r.key} value={r.key}>{r.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 200 }}>
                <InputLabel>User</InputLabel>
                <Select value={addUserId} label="User" onChange={(e) => setAddUserId(e.target.value)}>
                  {users.filter((u) => u.is_active).map((u) => (
                    <MenuItem key={u.id} value={u.id}>{u.display_name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button size="small" variant="contained" onClick={handleAdd} disabled={!addRole || !addUserId}>
                Add
              </Button>
              <Button size="small" onClick={() => { setAddOpen(false); setAddRole(""); setAddUserId(""); }}>
                Cancel
              </Button>
            </Box>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}

// ── Tab: History ────────────────────────────────────────────────
function HistoryTab({ fsId }: { fsId: string }) {
  const [events, setEvents] = useState<EventEntry[]>([]);
  useEffect(() => {
    api
      .get<EventEntry[]>(`/fact-sheets/${fsId}/history`)
      .then(setEvents)
      .catch(() => {});
  }, [fsId]);

  return (
    <Box>
      {events.length === 0 && (
        <Typography color="text.secondary" variant="body2">
          No history yet.
        </Typography>
      )}
      {events.map((e) => (
        <Card key={e.id} sx={{ mb: 1 }}>
          <CardContent sx={{ py: 1, "&:last-child": { pb: 1 } }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Chip size="small" label={e.event_type} />
              <Typography variant="body2">
                {e.user_display_name || "System"}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ ml: "auto" }}
              >
                {e.created_at
                  ? new Date(e.created_at).toLocaleString()
                  : ""}
              </Typography>
            </Box>
          </CardContent>
        </Card>
      ))}
    </Box>
  );
}

// ── Default permissions (allow everything until loaded) ─────────
const DEFAULT_PERMISSIONS: FactSheetEffectivePermissions["effective"] = {
  can_view: true,
  can_edit: true,
  can_delete: true,
  can_quality_seal: true,
  can_manage_subscriptions: true,
  can_manage_relations: true,
  can_manage_documents: true,
  can_manage_comments: true,
  can_create_comments: true,
  can_bpm_edit: true,
  can_bpm_manage_drafts: true,
  can_bpm_approve: true,
};

// ── Main Detail Page ────────────────────────────────────────────
export default function FactSheetDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { getType } = useMetamodel();
  const [fs, setFs] = useState<FactSheet | null>(null);
  const [tab, setTab] = useState(0);
  const [initialSubTab, setInitialSubTab] = useState<number | undefined>(undefined);
  const [error, setError] = useState("");
  const [relRefresh, setRelRefresh] = useState(0);
  const [sealMenuAnchor, setSealMenuAnchor] = useState<HTMLElement | null>(
    null
  );
  const [perms, setPerms] = useState<FactSheetEffectivePermissions["effective"]>(DEFAULT_PERMISSIONS);

  // Fetch effective permissions for this fact sheet
  useEffect(() => {
    if (!id) return;
    setPerms(DEFAULT_PERMISSIONS);
    api
      .get<FactSheetEffectivePermissions>(`/fact-sheets/${id}/my-permissions`)
      .then((res) => setPerms(res.effective))
      .catch(() => {}); // keep defaults on error
  }, [id]);

  useEffect(() => {
    if (!id) return;
    // Read tab from URL search params (e.g. ?tab=1&subtab=1)
    const urlTab = searchParams.get("tab");
    const urlSubTab = searchParams.get("subtab");
    if (urlTab) {
      setTab(parseInt(urlTab, 10) || 0);
      // Clear the query params so they don't persist on navigation
      setSearchParams({}, { replace: true });
    } else {
      setTab(0);
    }
    if (urlSubTab) {
      setInitialSubTab(parseInt(urlSubTab, 10) || 0);
    } else {
      setInitialSubTab(undefined);
    }
    api
      .get<FactSheet>(`/fact-sheets/${id}`)
      .then(setFs)
      .catch((e) => setError(e.message));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!fs)
    return (
      <Box sx={{ p: 4 }}>
        <LinearProgress />
      </Box>
    );

  const typeConfig = getType(fs.type);

  const handleUpdate = async (updates: Record<string, unknown>) => {
    const updated = await api.patch<FactSheet>(`/fact-sheets/${fs.id}`, updates);
    setFs(updated);
  };

  const handleSealAction = async (action: string) => {
    setSealMenuAnchor(null);
    await api.post(`/fact-sheets/${fs.id}/quality-seal?action=${action}`);
    const newSeal =
      action === "approve"
        ? "APPROVED"
        : action === "reject"
          ? "REJECTED"
          : "DRAFT";
    setFs({ ...fs, quality_seal: newSeal });
  };

  return (
    <Box sx={{ maxWidth: 960, mx: "auto" }}>
      {/* ── Header ── */}
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: { xs: 1, sm: 2 }, mb: 3 }}>
        <IconButton onClick={() => navigate(-1)} sx={{ mr: { xs: -0.5, sm: 0 } }}>
          <MaterialSymbol icon="arrow_back" size={24} />
        </IconButton>
        {typeConfig && (
          <Box
            sx={{
              width: { xs: 32, sm: 40 },
              height: { xs: 32, sm: 40 },
              borderRadius: 2,
              bgcolor: typeConfig.color + "18",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <MaterialSymbol
              icon={typeConfig.icon}
              size={isMobile ? 20 : 24}
              color={typeConfig.color}
            />
          </Box>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant={isMobile ? "h6" : "h5"} fontWeight={700} noWrap>
            {fs.name}
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {typeConfig?.label || fs.type}
            </Typography>
            {fs.subtype && (
              <Chip size="small" label={fs.subtype} variant="outlined" sx={{ height: 20 }} />
            )}
          </Box>
        </Box>
        {/* Badges — wrap to second row on mobile */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: { xs: "100%", sm: "auto" }, justifyContent: { xs: "flex-end", sm: "flex-start" } }}>
          <CompletionRing value={fs.completion} />
          <LifecycleBadge lifecycle={fs.lifecycle} />
          <QualitySealBadge seal={fs.quality_seal} />
          {perms.can_quality_seal && (
            <Button
              size="small"
              variant="outlined"
              onClick={(e) => setSealMenuAnchor(e.currentTarget)}
              endIcon={<MaterialSymbol icon="arrow_drop_down" size={18} />}
            >
              Seal
            </Button>
          )}
        </Box>
        {perms.can_quality_seal && (
          <Menu
            anchorEl={sealMenuAnchor}
            open={!!sealMenuAnchor}
            onClose={() => setSealMenuAnchor(null)}
          >
            <MenuItem
              onClick={() => handleSealAction("approve")}
              disabled={fs.quality_seal === "APPROVED"}
            >
              <MaterialSymbol icon="verified" size={18} color="#4caf50" />
              <Typography sx={{ ml: 1 }}>Approve</Typography>
            </MenuItem>
            <MenuItem
              onClick={() => handleSealAction("reject")}
              disabled={fs.quality_seal === "REJECTED"}
            >
              <MaterialSymbol icon="cancel" size={18} color="#f44336" />
              <Typography sx={{ ml: 1 }}>Reject</Typography>
            </MenuItem>
            <MenuItem
              onClick={() => handleSealAction("reset")}
              disabled={fs.quality_seal === "DRAFT"}
            >
              <MaterialSymbol icon="restart_alt" size={18} color="#666" />
              <Typography sx={{ ml: 1 }}>Reset to Draft</Typography>
            </MenuItem>
          </Menu>
        )}
      </Box>

      {/* ── Top-level tabs ── */}
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}
      >
        <Tab label="Fact Sheet" />
        {fs.type === "BusinessProcess" && <Tab label="Process Flow" />}
        {fs.type === "BusinessProcess" && <Tab label="Assessments" />}
        <Tab label="Comments" />
        <Tab label="Todos" />
        <Tab label="Subscriptions" />
        <Tab label="History" />
      </Tabs>

      {/* ── Tab content ── */}
      {fs.type === "BusinessProcess" ? (
        <>
          {tab === 0 && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <DescriptionSection fs={fs} onSave={handleUpdate} canEdit={perms.can_edit} />
              <EolLinkSection fs={fs} onSave={handleUpdate} />
              <LifecycleSection fs={fs} onSave={handleUpdate} canEdit={perms.can_edit} />
              {typeConfig?.fields_schema.map((section) => (
                <AttributeSection
                  key={section.section}
                  section={section}
                  fs={fs}
                  onSave={handleUpdate}
                  onRelationChange={() => setRelRefresh((n) => n + 1)}
                  canEdit={perms.can_edit}
                />
              ))}
              <HierarchySection fs={fs} onUpdate={() => api.get<FactSheet>(`/fact-sheets/${fs.id}`).then(setFs)} canEdit={perms.can_edit} />
              <RelationsSection fsId={fs.id} fsType={fs.type} refreshKey={relRefresh} canManageRelations={perms.can_manage_relations} />
            </Box>
          )}
          {tab === 1 && <Card><CardContent><ProcessFlowTab processId={fs.id} processName={fs.name} initialSubTab={initialSubTab} /></CardContent></Card>}
          {tab === 2 && <Card><CardContent><ProcessAssessmentPanel processId={fs.id} /></CardContent></Card>}
          {tab === 3 && <Card><CardContent><CommentsTab fsId={fs.id} canCreateComments={perms.can_create_comments} canManageComments={perms.can_manage_comments} /></CardContent></Card>}
          {tab === 4 && <Card><CardContent><TodosTab fsId={fs.id} /></CardContent></Card>}
          {tab === 5 && <Card><CardContent><SubscriptionsTab fs={fs} onRefresh={() => api.get<FactSheet>(`/fact-sheets/${fs.id}`).then(setFs)} canManageSubscriptions={perms.can_manage_subscriptions} /></CardContent></Card>}
          {tab === 6 && <Card><CardContent><HistoryTab fsId={fs.id} /></CardContent></Card>}
        </>
      ) : (
        <>
          {tab === 0 && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <DescriptionSection fs={fs} onSave={handleUpdate} canEdit={perms.can_edit} />
              <EolLinkSection fs={fs} onSave={handleUpdate} />
              <LifecycleSection fs={fs} onSave={handleUpdate} canEdit={perms.can_edit} />
              {typeConfig?.fields_schema.map((section) => (
                <AttributeSection
                  key={section.section}
                  section={section}
                  fs={fs}
                  onSave={handleUpdate}
                  onRelationChange={() => setRelRefresh((n) => n + 1)}
                  canEdit={perms.can_edit}
                />
              ))}
              <HierarchySection fs={fs} onUpdate={() => api.get<FactSheet>(`/fact-sheets/${fs.id}`).then(setFs)} canEdit={perms.can_edit} />
              <RelationsSection fsId={fs.id} fsType={fs.type} refreshKey={relRefresh} canManageRelations={perms.can_manage_relations} />
            </Box>
          )}
          {tab === 1 && <Card><CardContent><CommentsTab fsId={fs.id} canCreateComments={perms.can_create_comments} canManageComments={perms.can_manage_comments} /></CardContent></Card>}
          {tab === 2 && <Card><CardContent><TodosTab fsId={fs.id} /></CardContent></Card>}
          {tab === 3 && <Card><CardContent><SubscriptionsTab fs={fs} onRefresh={() => api.get<FactSheet>(`/fact-sheets/${fs.id}`).then(setFs)} canManageSubscriptions={perms.can_manage_subscriptions} /></CardContent></Card>}
          {tab === 4 && <Card><CardContent><HistoryTab fsId={fs.id} /></CardContent></Card>}
        </>
      )}
    </Box>
  );
}
