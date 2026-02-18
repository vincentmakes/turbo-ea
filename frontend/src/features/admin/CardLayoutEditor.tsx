import { useState, useCallback } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Divider from "@mui/material/Divider";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type { CardType, SectionDef, FieldDef, SectionConfig } from "@/types";
import { api } from "@/api/client";
import MaterialSymbol from "@/components/MaterialSymbol";

// ── Built-in section definitions ────────────────────────────────

const BUILTIN_SECTIONS: { key: string; label: string; icon: string; onlyIf?: (t: CardType) => boolean }[] = [
  { key: "description", label: "Description", icon: "description" },
  { key: "eol", label: "End of Life", icon: "update" },
  { key: "lifecycle", label: "Lifecycle", icon: "timeline" },
  { key: "hierarchy", label: "Hierarchy", icon: "account_tree", onlyIf: (t) => t.has_hierarchy },
  { key: "relations", label: "Relations", icon: "hub" },
];

const DEFAULT_ORDER = ["description", "eol", "lifecycle", "__custom__", "hierarchy", "relations"];

function getSectionOrder(cfg: Record<string, SectionConfig>, customSections: SectionDef[], hasHierarchy: boolean): string[] {
  const raw = cfg?.__order as unknown as string[] | undefined;
  if (raw && Array.isArray(raw) && raw.length > 0) {
    // Validate: ensure all custom sections are present, add missing ones
    const customKeys = customSections.map((_, i) => `custom:${i}`);
    const existing = new Set(raw);
    const result = [...raw];
    for (const k of customKeys) {
      if (!existing.has(k)) result.push(k);
    }
    // Filter out hierarchy if not applicable
    if (!hasHierarchy) return result.filter((k) => k !== "hierarchy");
    return result;
  }
  // Default: description, eol, lifecycle, [custom sections], hierarchy, relations
  const order: string[] = [];
  for (const key of DEFAULT_ORDER) {
    if (key === "__custom__") {
      customSections.forEach((_, i) => order.push(`custom:${i}`));
    } else if (key === "hierarchy" && !hasHierarchy) {
      // skip
    } else {
      order.push(key);
    }
  }
  return order;
}

function getSectionInfo(key: string, customSections: SectionDef[], type: CardType) {
  if (key.startsWith("custom:")) {
    const idx = parseInt(key.split(":")[1], 10);
    const sec = customSections[idx];
    return sec ? { label: sec.section, icon: "tune", isCustom: true, idx, section: sec } : null;
  }
  const builtin = BUILTIN_SECTIONS.find((b) => b.key === key);
  if (!builtin) return null;
  if (builtin.onlyIf && !builtin.onlyIf(type)) return null;
  return { label: builtin.label, icon: builtin.icon, isCustom: false, idx: -1, section: null };
}

// ── Sortable Section Item ───────────────────────────────────────

function SortableSectionItem({
  id,
  sectionKey,
  info,
  cfg,
  expanded,
  onToggleExpand,
  onToggleCollapsed,
  onToggleHidden,
  onToggleColumns,
  children,
}: {
  id: string;
  sectionKey: string;
  info: { label: string; icon: string; isCustom: boolean };
  cfg: SectionConfig;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleCollapsed: () => void;
  onToggleHidden: () => void;
  onToggleColumns?: () => void;
  children?: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <Box
      ref={setNodeRef}
      style={style}
      sx={{
        border: 1,
        borderColor: cfg.hidden ? "action.disabled" : "divider",
        borderRadius: 1,
        mb: 0.75,
        bgcolor: cfg.hidden ? "action.disabledBackground" : "background.paper",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", px: 1, py: 0.5, gap: 0.5 }}>
        {/* Drag handle */}
        <Box {...attributes} {...listeners} sx={{ cursor: "grab", display: "flex", alignItems: "center", mr: 0.5, "&:active": { cursor: "grabbing" } }}>
          <MaterialSymbol icon="drag_indicator" size={18} color="#999" />
        </Box>
        {/* Section icon + name (clickable to expand/collapse) */}
        <Box
          onClick={(info.isCustom || sectionKey === "description") && !cfg.hidden ? onToggleExpand : undefined}
          sx={{ display: "flex", alignItems: "center", gap: 0.5, flex: 1, cursor: (info.isCustom || sectionKey === "description") && !cfg.hidden ? "pointer" : "default" }}
        >
          <MaterialSymbol icon={info.icon} size={18} color={cfg.hidden ? "#bbb" : "#666"} />
          <Typography variant="body2" fontWeight={600} sx={{ color: cfg.hidden ? "text.disabled" : "text.primary" }}>
            {info.label}
          </Typography>
        </Box>
        {/* Collapsed toggle */}
        <Tooltip title="Collapsed by default">
          <FormControlLabel
            control={<Switch size="small" checked={cfg.defaultExpanded === false} disabled={!!cfg.hidden} onChange={onToggleCollapsed} />}
            label={<Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.65rem" }}>Collapsed</Typography>}
            sx={{ mr: 0, ml: 0 }}
          />
        </Tooltip>
        {/* Hidden toggle */}
        <Tooltip title="Hidden from card detail">
          <FormControlLabel
            control={<Switch size="small" checked={!!cfg.hidden} onChange={onToggleHidden} />}
            label={<Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.65rem" }}>Hidden</Typography>}
            sx={{ mr: 0, ml: 0 }}
          />
        </Tooltip>
        {/* Column layout toggle (only for custom + description) */}
        {onToggleColumns && !cfg.hidden && (
          <Tooltip title={`Switch to ${(info as unknown as { section?: SectionDef }).section?.columns === 2 ? "1 column" : "2 columns"} layout`}>
            <IconButton size="small" onClick={onToggleColumns}>
              <MaterialSymbol icon={(info as unknown as { section?: SectionDef }).section?.columns === 2 ? "view_column" : "view_agenda"} size={16} />
            </IconButton>
          </Tooltip>
        )}
        {/* Expand to show fields */}
        {info.isCustom && !cfg.hidden && (
          <IconButton size="small" onClick={onToggleExpand}>
            <MaterialSymbol icon={expanded ? "expand_less" : "expand_more"} size={18} />
          </IconButton>
        )}
        {/* Description section - also expandable for adding fields */}
        {sectionKey === "description" && !cfg.hidden && (
          <IconButton size="small" onClick={onToggleExpand}>
            <MaterialSymbol icon={expanded ? "expand_less" : "expand_more"} size={18} />
          </IconButton>
        )}
      </Box>
      {expanded && !cfg.hidden && children}
    </Box>
  );
}

// ── Sortable Field Item ─────────────────────────────────────────

function SortableFieldItem({
  id,
  field,
  isProtected,
  isCalculated,
  onEdit,
  onDelete,
  onGroupChange,
  onColumnChange,
  showColumn,
  groups,
}: {
  id: string;
  field: FieldDef;
  isProtected?: boolean;
  isCalculated?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onGroupChange?: (group: string | undefined) => void;
  onColumnChange?: (col: 0 | 1) => void;
  showColumn?: boolean;
  groups: string[];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const [groupAnchor, setGroupAnchor] = useState<HTMLElement | null>(null);

  return (
    <Box
      ref={setNodeRef}
      style={style}
      sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1.5, py: 0.25, "&:hover": { bgcolor: "action.hover" }, borderRadius: 0.5 }}
    >
      <Box {...attributes} {...listeners} sx={{ cursor: "grab", display: "flex", "&:active": { cursor: "grabbing" } }}>
        <MaterialSymbol icon="drag_indicator" size={16} color="#ccc" />
      </Box>
      <Typography variant="body2" fontWeight={500} sx={{ minWidth: 80, flex: 1 }}>
        {field.label}
        {isProtected && <Chip component="span" size="small" label="required" sx={{ ml: 0.5, height: 16, fontSize: "0.55rem" }} />}
        {isCalculated && <Chip component="span" size="small" label="calc" color="info" sx={{ ml: 0.5, height: 16, fontSize: "0.55rem" }} />}
      </Typography>
      <Chip size="small" label={field.type} sx={{ bgcolor: fieldTypeColor(field.type), color: "#fff", height: 18, fontSize: 10 }} />
      {field.group && (
        <Chip size="small" label={field.group} variant="outlined" sx={{ height: 18, fontSize: 10 }} />
      )}
      {showColumn && (
        <Tooltip title="Column">
          <Chip
            size="small"
            label={`C${(field.column ?? 0) + 1}`}
            variant="outlined"
            onClick={() => onColumnChange?.(field.column === 1 ? 0 : 1)}
            sx={{ height: 18, fontSize: 10, cursor: "pointer" }}
          />
        </Tooltip>
      )}
      {/* Group menu */}
      {onGroupChange && (
        <>
          <Tooltip title="Assign to group">
            <IconButton size="small" onClick={(e) => setGroupAnchor(e.currentTarget)}>
              <MaterialSymbol icon="workspaces" size={14} color="#999" />
            </IconButton>
          </Tooltip>
          <Menu anchorEl={groupAnchor} open={!!groupAnchor} onClose={() => setGroupAnchor(null)}>
            <MenuItem onClick={() => { onGroupChange(undefined); setGroupAnchor(null); }}>
              <em>No group</em>
            </MenuItem>
            {groups.map((g) => (
              <MenuItem key={g} selected={field.group === g} onClick={() => { onGroupChange(g); setGroupAnchor(null); }}>
                {g}
              </MenuItem>
            ))}
          </Menu>
        </>
      )}
      {!isProtected && onEdit && (
        <IconButton size="small" onClick={onEdit}><MaterialSymbol icon="edit" size={16} /></IconButton>
      )}
      {!isProtected && onDelete && (
        <IconButton size="small" onClick={onDelete}><MaterialSymbol icon="delete" size={16} /></IconButton>
      )}
    </Box>
  );
}

function fieldTypeColor(type: string): string {
  const map: Record<string, string> = {
    text: "#1976d2", number: "#7b1fa2", cost: "#e65100", boolean: "#2e7d32",
    date: "#c2185b", single_select: "#00838f", multiple_select: "#4527a0",
  };
  return map[type] || "#666";
}

// ── Section Fields Panel (inside expanded section) ──────────────

function SectionFieldsPanel({
  sectionIdx,
  section,
  typeKey,
  fieldsSchema,
  calculatedFieldKeys,
  onRefresh,
  openAddField,
  openEditField,
  promptDeleteField,
}: {
  sectionIdx: number;
  section: SectionDef;
  typeKey: string;
  fieldsSchema: SectionDef[];
  calculatedFieldKeys: string[];
  onRefresh: () => void;
  openAddField: (si: number) => void;
  openEditField: (si: number, fi: number) => void;
  promptDeleteField: (si: number, fi: number) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const [newGroupName, setNewGroupName] = useState("");
  const [addingGroup, setAddingGroup] = useState(false);
  const [localGroups, setLocalGroups] = useState<string[]>([]);

  const persistedGroups = [...new Set(section.fields.map((f) => f.group).filter(Boolean))] as string[];
  const groups = [...new Set([...persistedGroups, ...localGroups])];
  const showColumn = section.columns === 2;

  const handleFieldDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = section.fields.findIndex((_, i) => `field-${sectionIdx}-${i}` === active.id);
    const newIdx = section.fields.findIndex((_, i) => `field-${sectionIdx}-${i}` === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const newFields = arrayMove(section.fields, oldIdx, newIdx);
    const schema = [...fieldsSchema];
    schema[sectionIdx] = { ...schema[sectionIdx], fields: newFields };
    await api.patch(`/metamodel/types/${typeKey}`, { fields_schema: schema });
    onRefresh();
  };

  const handleFieldGroupChange = async (fi: number, group: string | undefined) => {
    const schema = [...fieldsSchema];
    const fields = [...schema[sectionIdx].fields];
    fields[fi] = { ...fields[fi], group };
    schema[sectionIdx] = { ...schema[sectionIdx], fields };
    await api.patch(`/metamodel/types/${typeKey}`, { fields_schema: schema });
    onRefresh();
  };

  const handleFieldColumnChange = async (fi: number, col: 0 | 1) => {
    const schema = [...fieldsSchema];
    const fields = [...schema[sectionIdx].fields];
    fields[fi] = { ...fields[fi], column: col };
    schema[sectionIdx] = { ...schema[sectionIdx], fields };
    await api.patch(`/metamodel/types/${typeKey}`, { fields_schema: schema });
    onRefresh();
  };

  const handleAddGroup = () => {
    if (!newGroupName || groups.includes(newGroupName)) return;
    setLocalGroups((prev) => [...prev, newGroupName]);
    setAddingGroup(false);
    setNewGroupName("");
  };

  const fieldIds = section.fields.map((_, i) => `field-${sectionIdx}-${i}`);

  return (
    <Box sx={{ pb: 1 }}>
      {/* Column layout toggle */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, pb: 0.5 }}>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel sx={{ fontSize: "0.75rem" }}>Columns</InputLabel>
          <Select
            value={section.columns || 1}
            label="Columns"
            sx={{ height: 28, fontSize: "0.75rem" }}
            onChange={async (e) => {
              const schema = [...fieldsSchema];
              schema[sectionIdx] = { ...schema[sectionIdx], columns: e.target.value as 1 | 2 };
              await api.patch(`/metamodel/types/${typeKey}`, { fields_schema: schema });
              onRefresh();
            }}
          >
            <MenuItem value={1}>1 Column</MenuItem>
            <MenuItem value={2}>2 Columns</MenuItem>
          </Select>
        </FormControl>
        {groups.length > 0 && (
          <Typography variant="caption" color="text.secondary">
            Groups: {groups.join(", ")}
          </Typography>
        )}
      </Box>
      <Divider sx={{ mb: 0.5 }} />
      {/* Field list with DnD */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleFieldDragEnd}>
        <SortableContext items={fieldIds} strategy={verticalListSortingStrategy}>
          {section.fields.map((f, fi) => (
            <SortableFieldItem
              key={`field-${sectionIdx}-${fi}`}
              id={`field-${sectionIdx}-${fi}`}
              field={f}
              isCalculated={calculatedFieldKeys.includes(f.key)}
              onEdit={() => openEditField(sectionIdx, fi)}
              onDelete={() => promptDeleteField(sectionIdx, fi)}
              onGroupChange={(g) => handleFieldGroupChange(fi, g)}
              onColumnChange={(c) => handleFieldColumnChange(fi, c)}
              showColumn={showColumn}
              groups={groups}
            />
          ))}
        </SortableContext>
      </DndContext>
      {/* Add field / group buttons */}
      <Box sx={{ display: "flex", gap: 1, px: 1.5, pt: 0.5 }}>
        <Button size="small" startIcon={<MaterialSymbol icon="add" size={14} />} onClick={() => openAddField(sectionIdx)}>
          Field
        </Button>
        {addingGroup ? (
          <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
            <TextField size="small" placeholder="Group name" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} sx={{ width: 120, "& input": { py: 0.25, fontSize: "0.75rem" } }} />
            <Button size="small" onClick={handleAddGroup} disabled={!newGroupName}>Add</Button>
            <IconButton size="small" onClick={() => { setAddingGroup(false); setNewGroupName(""); }}><MaterialSymbol icon="close" size={14} /></IconButton>
          </Box>
        ) : (
          <Button size="small" startIcon={<MaterialSymbol icon="workspaces" size={14} />} onClick={() => setAddingGroup(true)}>
            Group
          </Button>
        )}
      </Box>
    </Box>
  );
}

// ── Description Section Fields (name + description are protected) ──

function DescriptionFieldsPanel({
  typeKey,
  fieldsSchema,
  calculatedFieldKeys,
  onRefresh,
  openAddField,
  openEditField,
  promptDeleteField,
}: {
  typeKey: string;
  fieldsSchema: SectionDef[];
  calculatedFieldKeys: string[];
  onRefresh: () => void;
  openAddField: (si: number) => void;
  openEditField: (si: number, fi: number) => void;
  promptDeleteField: (si: number, fi: number) => void;
}) {
  // Description section is stored as the first section in fields_schema with key "__description"
  // or we find it by convention. For backward compat, we create it if missing.
  const descIdx = fieldsSchema.findIndex((s) => s.section === "__description");
  const descSection = descIdx >= 0 ? fieldsSchema[descIdx] : null;

  // Built-in fields (not stored in schema - rendered directly in CardDetail)
  const builtinFields: FieldDef[] = [
    { key: "__name", label: "Name", type: "text", required: true, weight: 0 },
    { key: "__description", label: "Description", type: "text", required: false, weight: 1 },
  ];

  const customFields = descSection?.fields || [];
  const actualDescIdx = descIdx >= 0 ? descIdx : -1;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleFieldDragEnd = async (event: DragEndEvent) => {
    if (actualDescIdx < 0) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    // Only custom fields are draggable
    const oldIdx = customFields.findIndex((_, i) => `desc-field-${i}` === active.id);
    const newIdx = customFields.findIndex((_, i) => `desc-field-${i}` === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const newFields = arrayMove(customFields, oldIdx, newIdx);
    const schema = [...fieldsSchema];
    schema[actualDescIdx] = { ...schema[actualDescIdx], fields: newFields };
    await api.patch(`/metamodel/types/${typeKey}`, { fields_schema: schema });
    onRefresh();
  };

  const addFieldToDescription = async () => {
    if (actualDescIdx >= 0) {
      openAddField(actualDescIdx);
    } else {
      // Create __description section
      const schema: SectionDef[] = [...fieldsSchema, { section: "__description", fields: [] }];
      await api.patch(`/metamodel/types/${typeKey}`, { fields_schema: schema });
      onRefresh();
      // After refresh, user can add fields
    }
  };

  return (
    <Box sx={{ pb: 1 }}>
      {/* Built-in fields (not draggable/editable) */}
      {builtinFields.map((f) => (
        <Box key={f.key} sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1.5, py: 0.25 }}>
          <Box sx={{ width: 22 }} /> {/* placeholder for drag handle */}
          <Typography variant="body2" fontWeight={500} sx={{ flex: 1, color: "text.secondary" }}>
            {f.label}
            <Chip component="span" size="small" label="built-in" sx={{ ml: 0.5, height: 16, fontSize: "0.55rem" }} />
          </Typography>
          <Chip size="small" label={f.type} sx={{ bgcolor: fieldTypeColor(f.type), color: "#fff", height: 18, fontSize: 10 }} />
        </Box>
      ))}
      {/* Custom fields in description section */}
      {customFields.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleFieldDragEnd}>
          <SortableContext items={customFields.map((_, i) => `desc-field-${i}`)} strategy={verticalListSortingStrategy}>
            {customFields.map((f, fi) => (
              <SortableFieldItem
                key={`desc-field-${fi}`}
                id={`desc-field-${fi}`}
                field={f}
                isCalculated={calculatedFieldKeys.includes(f.key)}
                onEdit={() => openEditField(actualDescIdx, fi)}
                onDelete={() => promptDeleteField(actualDescIdx, fi)}
                groups={[]}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}
      <Box sx={{ px: 1.5, pt: 0.5 }}>
        <Button size="small" startIcon={<MaterialSymbol icon="add" size={14} />} onClick={addFieldToDescription}>
          Field
        </Button>
      </Box>
    </Box>
  );
}

// ── Main Component ──────────────────────────────────────────────

interface CardLayoutEditorProps {
  cardType: CardType;
  onRefresh: () => void;
  openAddField: (si: number) => void;
  openEditField: (si: number, fi: number) => void;
  promptDeleteField: (si: number, fi: number) => void;
  calculatedFieldKeys: string[];
}

export default function CardLayoutEditor({
  cardType,
  onRefresh,
  openAddField,
  openEditField,
  promptDeleteField,
  calculatedFieldKeys,
}: CardLayoutEditorProps) {
  const secCfg = (cardType.section_config || {}) as Record<string, SectionConfig> & { __order?: string[] };
  // Filter out __description from the visible custom sections list
  const customSections = cardType.fields_schema.filter((s) => s.section !== "__description");
  const sectionOrder = getSectionOrder(secCfg, customSections, cardType.has_hierarchy);

  // Auto-expand all editable sections (custom + description) for easier editing
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    initial.add("description");
    customSections.forEach((_, i) => initial.add(`custom:${i}`));
    return initial;
  });
  const [addSectionOpen, setAddSectionOpen] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const toggleExpand = (key: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const persistSectionConfig = useCallback(async (patch: Record<string, unknown>) => {
    const updated = { ...secCfg, ...patch };
    await api.patch(`/metamodel/types/${cardType.key}`, { section_config: updated });
    onRefresh();
  }, [secCfg, cardType.key, onRefresh]);

  const updateSectionProp = async (sectionKey: string, prop: Partial<SectionConfig>) => {
    await persistSectionConfig({ [sectionKey]: { ...(secCfg[sectionKey] || {}), ...prop } });
  };

  // Map custom:N keys back to fields_schema indices (excluding __description)
  const customToSchemaIdx = (customIdx: number) => {
    let count = 0;
    for (let i = 0; i < cardType.fields_schema.length; i++) {
      if (cardType.fields_schema[i].section === "__description") continue;
      if (count === customIdx) return i;
      count++;
    }
    return -1;
  };

  const handleSectionDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = sectionOrder.indexOf(String(active.id));
    const newIdx = sectionOrder.indexOf(String(over.id));
    if (oldIdx === -1 || newIdx === -1) return;
    const newOrder = arrayMove(sectionOrder, oldIdx, newIdx);
    await persistSectionConfig({ __order: newOrder });
  };

  const handleAddSection = async () => {
    if (!newSectionName) return;
    const schema = [...cardType.fields_schema, { section: newSectionName, fields: [] }];
    // Also update order to include new section
    const newCustomIdx = customSections.length; // will be appended
    const newOrder = [...sectionOrder, `custom:${newCustomIdx}`];
    await api.patch(`/metamodel/types/${cardType.key}`, {
      fields_schema: schema,
      section_config: { ...secCfg, __order: newOrder },
    });
    onRefresh();
    setNewSectionName("");
    setAddSectionOpen(false);
  };

  const handleToggleColumns = async (sectionIdx: number) => {
    const schema = [...cardType.fields_schema];
    const current = schema[sectionIdx].columns || 1;
    schema[sectionIdx] = { ...schema[sectionIdx], columns: current === 2 ? 1 : 2 };
    await api.patch(`/metamodel/types/${cardType.key}`, { fields_schema: schema });
    onRefresh();
  };

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.5 }}>
        Card Layout
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Drag to reorder sections. Expand sections to manage fields.
      </Typography>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSectionDragEnd}>
        <SortableContext items={sectionOrder} strategy={verticalListSortingStrategy}>
          {sectionOrder.map((key) => {
            const info = getSectionInfo(key, customSections, cardType);
            if (!info) return null;
            // For custom sections, get the section_config by key OR by section name
            const cfgForSection = key.startsWith("custom:")
              ? (secCfg[key] || secCfg[info.label] || {})
              : (secCfg[key] || {});

            // Get actual schema index for custom sections
            const schemaIdx = info.isCustom ? customToSchemaIdx(info.idx) : -1;

            return (
              <SortableSectionItem
                key={key}
                id={key}
                sectionKey={key}
                info={info}
                cfg={cfgForSection}
                expanded={expandedSections.has(key)}
                onToggleExpand={() => toggleExpand(key)}
                onToggleCollapsed={() => updateSectionProp(key, { defaultExpanded: cfgForSection.defaultExpanded === false })}
                onToggleHidden={() => updateSectionProp(key, { hidden: !cfgForSection.hidden })}
                onToggleColumns={info.isCustom && schemaIdx >= 0 ? () => handleToggleColumns(schemaIdx) : undefined}
              >
                {/* Render fields for custom sections */}
                {info.isCustom && info.section && schemaIdx >= 0 && (
                  <SectionFieldsPanel
                    sectionIdx={schemaIdx}
                    section={info.section}
                    typeKey={cardType.key}
                    fieldsSchema={cardType.fields_schema}
                    calculatedFieldKeys={calculatedFieldKeys}
                    onRefresh={onRefresh}
                    openAddField={openAddField}
                    openEditField={openEditField}
                    promptDeleteField={promptDeleteField}
                  />
                )}
                {/* Render fields for description section */}
                {key === "description" && (
                  <DescriptionFieldsPanel
                    typeKey={cardType.key}
                    fieldsSchema={cardType.fields_schema}
                    calculatedFieldKeys={calculatedFieldKeys}
                    onRefresh={onRefresh}
                    openAddField={openAddField}
                    openEditField={openEditField}
                    promptDeleteField={promptDeleteField}
                  />
                )}
              </SortableSectionItem>
            );
          })}
        </SortableContext>
      </DndContext>

      {/* Add section */}
      {addSectionOpen ? (
        <Box sx={{ display: "flex", gap: 1, alignItems: "center", mt: 1 }}>
          <TextField
            size="small"
            placeholder="Section name"
            value={newSectionName}
            onChange={(e) => setNewSectionName(e.target.value)}
            sx={{ flex: 1 }}
          />
          <Button size="small" variant="contained" onClick={handleAddSection} disabled={!newSectionName}>Add</Button>
          <IconButton size="small" onClick={() => { setAddSectionOpen(false); setNewSectionName(""); }}>
            <MaterialSymbol icon="close" size={18} />
          </IconButton>
        </Box>
      ) : (
        <Button size="small" startIcon={<MaterialSymbol icon="add" size={16} />} onClick={() => setAddSectionOpen(true)} sx={{ mt: 0.5 }}>
          Add Section
        </Button>
      )}
    </Box>
  );
}
