import { useState, useEffect, useCallback, useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";

import {
  DndContext,
  closestCenter,
  pointerWithin,
  rectIntersection,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  DragOverlay,
  type CollisionDetection,
  type UniqueIdentifier,
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

// ── Constants ────────────────────────────────────────────────────

const BUILTIN_SECTIONS: { key: string; label: string; icon: string; onlyIf?: (t: CardType) => boolean }[] = [
  { key: "description", label: "Description", icon: "description" },
  { key: "eol", label: "End of Life", icon: "update" },
  { key: "lifecycle", label: "Lifecycle", icon: "timeline" },
  { key: "hierarchy", label: "Hierarchy", icon: "account_tree", onlyIf: (t) => t.has_hierarchy },
  { key: "relations", label: "Relations", icon: "hub" },
];

const DEFAULT_ORDER = ["description", "eol", "lifecycle", "__custom__", "hierarchy", "relations"];

// ── Helpers ──────────────────────────────────────────────────────

function getSectionOrder(cfg: Record<string, SectionConfig>, customSections: SectionDef[], hasHierarchy: boolean): string[] {
  const raw = cfg?.__order as unknown as string[] | undefined;
  if (raw && Array.isArray(raw) && raw.length > 0) {
    const customKeys = customSections.map((_, i) => `custom:${i}`);
    const existing = new Set(raw);
    const result = [...raw];
    for (const k of customKeys) { if (!existing.has(k)) result.push(k); }
    if (!hasHierarchy) return result.filter((k) => k !== "hierarchy");
    return result;
  }
  const order: string[] = [];
  for (const key of DEFAULT_ORDER) {
    if (key === "__custom__") customSections.forEach((_, i) => order.push(`custom:${i}`));
    else if (key === "hierarchy" && !hasHierarchy) { /* skip */ }
    else order.push(key);
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

function fieldTypeColor(type: string): string {
  const map: Record<string, string> = {
    text: "#1976d2", number: "#7b1fa2", cost: "#e65100", boolean: "#2e7d32",
    date: "#c2185b", single_select: "#00838f", multiple_select: "#4527a0",
  };
  return map[type] || "#666";
}

// ── Container ↔ Fields conversion ────────────────────────────────

type Containers = Record<string, string[]>;

function fieldsToContainers(fields: FieldDef[], columns: 1 | 2, explicitGroups?: string[]): Containers {
  const c: Containers = { "col-0": [] };
  if (columns === 2) c["col-1"] = [];

  const groupCol = new Map<string, string>(); // group name → column key

  for (const field of fields) {
    const colKey = columns === 2 && field.column === 1 ? "col-1" : "col-0";

    if (field.group) {
      const gid = `group:${field.group}`;
      if (!c[gid]) {
        c[gid] = [];
        // Place group in the column of its first field
        const targetCol = groupCol.get(field.group) ?? colKey;
        c[targetCol].push(gid);
        groupCol.set(field.group, targetCol);
      }
      c[gid].push(field.key);
    } else {
      c[colKey].push(field.key);
    }
  }

  // Add explicit empty groups that weren't created from fields
  for (const g of explicitGroups || []) {
    const gid = `group:${g}`;
    if (!c[gid]) {
      c[gid] = [];
      c["col-0"].push(gid);
    }
  }

  return c;
}

function containersToFields(containers: Containers, fieldMap: Map<string, FieldDef>): FieldDef[] {
  const result: FieldDef[] = [];
  const seen = new Set<string>();

  const processCol = (colKey: string, colNum: 0 | 1) => {
    for (const itemId of containers[colKey] || []) {
      if (itemId.startsWith("group:")) {
        const gname = itemId.slice(6);
        for (const fk of containers[itemId] || []) {
          if (seen.has(fk)) continue;
          const f = fieldMap.get(fk);
          if (f) { result.push({ ...f, group: gname, column: colNum }); seen.add(fk); }
        }
      } else {
        if (seen.has(itemId)) continue;
        const f = fieldMap.get(itemId);
        if (f) { result.push({ ...f, group: undefined, column: colNum }); seen.add(itemId); }
      }
    }
  };

  processCol("col-0", 0);
  processCol("col-1", 1);
  return result;
}

// ── FieldCard (display component, used by sortable wrapper + overlay) ──

function FieldCard({
  field,
  isCalc,
  isProtected,
  onEdit,
  onDelete,
  isDragging,
}: {
  field: FieldDef;
  isCalc?: boolean;
  isProtected?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  isDragging?: boolean;
}) {
  return (
    <Box
      sx={{
        display: "flex", alignItems: "center", gap: 0.75,
        px: 1.25, py: 0.75,
        bgcolor: isDragging ? "primary.50" : "background.paper",
        border: 1, borderColor: isDragging ? "primary.main" : "grey.200",
        borderRadius: 1,
        "&:hover .field-actions": { opacity: 1 },
      }}
    >
      {field.required && (
        <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: "#1976d2", flexShrink: 0 }} />
      )}
      <Typography variant="body2" fontWeight={500} sx={{ flex: 1 }} noWrap>
        {field.label}
        {isCalc && <Chip component="span" size="small" label="calc" color="info" sx={{ ml: 0.5, height: 16, fontSize: "0.6rem" }} />}
      </Typography>
      <Chip size="small" label={field.type.replace("_", " ")} sx={{ bgcolor: fieldTypeColor(field.type), color: "#fff", height: 18, fontSize: "0.6rem" }} />
      {(!isProtected && (onEdit || onDelete)) && (
        <Box className="field-actions" sx={{ display: "flex", gap: 0.25, opacity: 0, transition: "opacity 0.15s" }}>
          {onEdit && <IconButton size="small" onClick={onEdit} sx={{ p: 0.25 }}><MaterialSymbol icon="edit" size={16} /></IconButton>}
          {onDelete && <IconButton size="small" onClick={onDelete} sx={{ p: 0.25 }}><MaterialSymbol icon="delete" size={16} /></IconButton>}
        </Box>
      )}
    </Box>
  );
}

// ── SortableFieldCard ────────────────────────────────────────────

function SortableFieldCard({
  id, field, isCalc, onEdit, onDelete,
}: {
  id: string; field: FieldDef; isCalc?: boolean;
  onEdit?: () => void; onDelete?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data: { type: "field", field },
  });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  return (
    <Box ref={setNodeRef} style={style} sx={{ mb: 0.75 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        <Box {...attributes} {...listeners} sx={{ cursor: "grab", display: "flex", flexShrink: 0, "&:active": { cursor: "grabbing" } }}>
          <MaterialSymbol icon="drag_indicator" size={16} color="#bbb" />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <FieldCard field={field} isCalc={isCalc} onEdit={onEdit} onDelete={onDelete} isDragging={isDragging} />
        </Box>
      </Box>
    </Box>
  );
}

// ── SortableGroupCard ────────────────────────────────────────────

function SortableGroupCard({
  id, groupName, children, onRename, onRemove,
}: {
  id: string; groupName: string; children: React.ReactNode;
  onRename?: (newName: string) => void;
  onRemove?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data: { type: "group", groupName },
  });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  // Inner droppable for accepting fields when group is empty
  const { setNodeRef: innerRef, isOver } = useDroppable({ id });

  const [renaming, setRenaming] = useState(false);
  const [rname, setRname] = useState(groupName);

  const commitRename = () => {
    if (rname && rname !== groupName && onRename) onRename(rname);
    setRenaming(false);
  };

  return (
    <Box ref={setNodeRef} style={style} sx={{ mb: 0.75 }}>
      <Box
        sx={{
          border: 2, borderColor: isOver ? "primary.main" : "grey.300",
          borderRadius: 1.5, borderStyle: "dashed",
          bgcolor: isOver ? "primary.50" : "grey.50",
          transition: "border-color 0.2s, background-color 0.2s",
        }}
      >
        {/* Group header */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 1.25, py: 0.5, borderBottom: 1, borderColor: "grey.200", bgcolor: "grey.100", borderRadius: "6px 6px 0 0" }}>
          <Box {...attributes} {...listeners} sx={{ cursor: "grab", display: "flex", "&:active": { cursor: "grabbing" } }}>
            <MaterialSymbol icon="drag_indicator" size={16} color="#999" />
          </Box>
          <MaterialSymbol icon="workspaces" size={16} color="#666" />
          {renaming ? (
            <TextField
              size="small" autoFocus value={rname}
              onChange={(e) => setRname(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") { setRname(groupName); setRenaming(false); } }}
              sx={{ flex: 1, "& input": { py: 0.25, fontSize: "0.85rem" } }}
            />
          ) : (
            <Typography
              variant="body2" fontWeight={600}
              sx={{ flex: 1, color: "text.secondary", cursor: onRename ? "pointer" : "default" }}
              onDoubleClick={onRename ? () => { setRname(groupName); setRenaming(true); } : undefined}
            >
              {groupName}
            </Typography>
          )}
          {!renaming && onRename && (
            <Tooltip title="Rename group">
              <IconButton size="small" onClick={() => { setRname(groupName); setRenaming(true); }} sx={{ p: 0.25 }}>
                <MaterialSymbol icon="edit" size={14} />
              </IconButton>
            </Tooltip>
          )}
          {onRemove && (
            <Tooltip title="Remove group (fields move to column)">
              <IconButton size="small" onClick={onRemove} sx={{ p: 0.25 }}>
                <MaterialSymbol icon="close" size={14} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
        {/* Group body (droppable) */}
        <Box ref={innerRef} sx={{ p: 0.75, minHeight: 40 }}>
          {children}
          {(!children || (Array.isArray(children) && (children as React.ReactNode[]).every(c => c == null))) && (
            <Typography variant="body2" color="text.disabled" sx={{ display: "block", textAlign: "center", py: 1 }}>
              Drag fields here
            </Typography>
          )}
        </Box>
      </Box>
    </Box>
  );
}

// ── DroppableColumn ──────────────────────────────────────────────

function DroppableColumn({ id, label, children, isEmpty }: {
  id: string; label: string; children: React.ReactNode; isEmpty: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <Box
      ref={setNodeRef}
      sx={{
        flex: 1, minHeight: 80, p: 1.5,
        border: 2, borderColor: isOver ? "primary.main" : "grey.300",
        borderStyle: "dashed", borderRadius: 2,
        bgcolor: isOver ? "primary.50" : "transparent",
        transition: "border-color 0.2s, background-color 0.2s",
      }}
    >
      <Typography variant="body2" fontWeight={600} color="text.secondary" sx={{ mb: 1, display: "block" }}>
        {label}
      </Typography>
      {children}
      {isEmpty && (
        <Typography variant="body2" color="text.disabled" sx={{ display: "block", textAlign: "center", py: 2.5 }}>
          Drag fields here
        </Typography>
      )}
    </Box>
  );
}

// ── VisualFieldLayout (per-section visual DnD editor) ────────────

function VisualFieldLayout({
  sectionIdx, section, typeKey, fieldsSchema, calculatedFieldKeys,
  onRefresh, openAddField, openEditField, promptDeleteField,
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
  const cols = section.columns || 1;
  const [containers, setContainers] = useState<Containers>(() => fieldsToContainers(section.fields, cols, section.groups));
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const [cloned, setCloned] = useState<Containers | null>(null);
  const [addingGroup, setAddingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  const fieldMap = useMemo(() => {
    const m = new Map<string, FieldDef>();
    for (const f of section.fields) m.set(f.key, f);
    return m;
  }, [section.fields]);

  // Sync containers when section data changes from outside
  useEffect(() => {
    setContainers(fieldsToContainers(section.fields, cols, section.groups));
  }, [section.fields, cols, section.groups]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Find which container holds an item (for fields: returns group or column; for groups: returns self)
  const findContainer = useCallback((id: string): string | undefined => {
    if (id in containers) return id;
    return Object.keys(containers).find((k) => containers[k].includes(id));
  }, [containers]);

  // Find which column a group lives in
  const findGroupColumn = useCallback((groupId: string): string | undefined => {
    return ["col-0", "col-1"].find((ck) => (containers[ck] || []).includes(groupId));
  }, [containers]);

  // Custom collision detection: prioritize groups (inner containers) over columns
  const collisionDetection: CollisionDetection = useCallback((args) => {
    const pointer = pointerWithin(args);
    if (pointer.length > 0) {
      const groupHit = pointer.find((c) => String(c.id).startsWith("group:"));
      const activeType = args.active.data.current?.type;

      if (groupHit && activeType !== "group") {
        const groupId = String(groupHit.id);
        const activeId = String(args.active.id);
        const groupItems = containers[groupId] || [];

        // If the active field is already in this group, prefer field-level
        // collisions so reordering within the group works
        if (groupItems.includes(activeId)) {
          const fieldHits = pointer.filter(
            (c) => !String(c.id).startsWith("group:") && !String(c.id).startsWith("col-"),
          );
          if (fieldHits.length > 0) {
            return closestCenter({
              ...args,
              droppableContainers: args.droppableContainers.filter((c) =>
                fieldHits.some((p) => p.id === c.id),
              ),
            });
          }
        }
        // Field coming from outside the group → target the group container
        return [groupHit];
      }
      return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => pointer.some((p) => p.id === c.id)) });
    }
    return rectIntersection(args);
  }, [containers]);

  // Persist containers to backend
  const saveContainers = useCallback(async (c: Containers) => {
    const newFields = containersToFields(c, fieldMap);
    // Extract all group names (including empty groups) so they survive round-trips
    const groups = Object.keys(c).filter(k => k.startsWith("group:")).map(k => k.slice(6));
    const schema = [...fieldsSchema];
    schema[sectionIdx] = { ...schema[sectionIdx], fields: newFields, groups };
    await api.patch(`/metamodel/types/${typeKey}`, { fields_schema: schema });
    onRefresh();
  }, [fieldMap, fieldsSchema, sectionIdx, typeKey, onRefresh]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id);
    setCloned(JSON.parse(JSON.stringify(containers)));
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeStr = String(active.id);
    const overStr = String(over.id);
    const activeType = active.data.current?.type;

    if (activeType === "group") {
      // Group movement: find source column, resolve target column
      const fromCol = findGroupColumn(activeStr);
      const toCol = overStr.startsWith("col-") ? overStr : findGroupColumn(overStr);
      if (!fromCol || !toCol || fromCol === toCol) return;

      setContainers((prev) => {
        const fromItems = [...(prev[fromCol] || [])];
        const toItems = [...(prev[toCol] || [])];
        const activeIdx = fromItems.indexOf(activeStr);
        if (activeIdx === -1) return prev;
        fromItems.splice(activeIdx, 1);
        // Insert at end of target column or near the over item
        const overIdx = toItems.indexOf(overStr);
        toItems.splice(overIdx >= 0 ? overIdx : toItems.length, 0, activeStr);
        return { ...prev, [fromCol]: fromItems, [toCol]: toItems };
      });
      return;
    }

    // Field movement: use findContainer (returns group or column)
    const from = findContainer(activeStr);
    const to = findContainer(overStr);
    if (!from || !to || from === to) return;

    setContainers((prev) => {
      const fromItems = [...(prev[from] || [])];
      const toItems = [...(prev[to] || [])];
      const activeIdx = fromItems.indexOf(activeStr);
      if (activeIdx === -1) return prev;
      fromItems.splice(activeIdx, 1);
      const overIdx = toItems.indexOf(overStr);
      const insertAt = overStr in prev ? toItems.length : (overIdx >= 0 ? overIdx : toItems.length);
      toItems.splice(insertAt, 0, activeStr);
      return { ...prev, [from]: fromItems, [to]: toItems };
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) { if (cloned) setContainers(cloned); return; }

    const activeStr = String(active.id);
    const overStr = String(over.id);
    const activeType = active.data.current?.type;

    // For groups, find the column they live in for same-container reordering
    if (activeType === "group") {
      const col = findGroupColumn(activeStr);
      const overCol = findGroupColumn(overStr);
      if (col && col === overCol) {
        const items = containers[col];
        const oldIdx = items.indexOf(activeStr);
        const newIdx = items.indexOf(overStr);
        if (oldIdx !== -1 && newIdx !== -1 && oldIdx !== newIdx) {
          const updated = { ...containers, [col]: arrayMove(items, oldIdx, newIdx) };
          setContainers(updated);
          saveContainers(updated);
          return;
        }
      }
      saveContainers(containers);
      return;
    }

    // For fields, use findContainer
    const container = findContainer(activeStr);
    const overContainer = findContainer(overStr);

    if (container && container === overContainer) {
      const items = containers[container];
      const oldIdx = items.indexOf(activeStr);
      const newIdx = items.indexOf(overStr);
      if (oldIdx !== -1 && newIdx !== -1 && oldIdx !== newIdx) {
        const updated = { ...containers, [container]: arrayMove(items, oldIdx, newIdx) };
        setContainers(updated);
        saveContainers(updated);
        return;
      }
    }
    // Cross-container move already handled in onDragOver — just save
    saveContainers(containers);
  };

  const handleDragCancel = () => {
    if (cloned) setContainers(cloned);
    setActiveId(null);
  };

  // Column count change
  const handleColumnChange = async (_: unknown, val: number | null) => {
    if (!val || val === cols) return;
    const schema = [...fieldsSchema];
    if (val === 1 && cols === 2) {
      // Merge col-1 into col-0
      const c = containers as Containers;
      const merged = [...(c["col-0"] || []), ...(c["col-1"] || [])];
      const newC: Containers = { ...c, "col-0": merged };
      delete newC["col-1"];
      const newFields = containersToFields(newC, fieldMap);
      const groups = Object.keys(newC).filter(k => k.startsWith("group:")).map(k => k.slice(6));
      schema[sectionIdx] = { ...schema[sectionIdx], columns: 1, fields: newFields, groups };
    } else {
      schema[sectionIdx] = { ...schema[sectionIdx], columns: val as 1 | 2 };
    }
    await api.patch(`/metamodel/types/${typeKey}`, { fields_schema: schema });
    onRefresh();
  };

  // Add a new group
  const handleAddGroup = async () => {
    if (!newGroupName) return;
    const gid = `group:${newGroupName}`;
    if (containers[gid]) return; // already exists
    const updated = { ...containers, [gid]: [], "col-0": [...(containers["col-0"] || []), gid] };
    setContainers(updated);
    setAddingGroup(false);
    setNewGroupName("");
    await saveContainers(updated);
  };

  // Remove a group (move its fields back to the column)
  const handleRemoveGroup = async (gid: string) => {
    const groupFields = containers[gid] || [];
    // Find which column the group is in
    const colKey = ["col-0", "col-1"].find((ck) => (containers[ck] || []).includes(gid)) || "col-0";
    const colItems = [...(containers[colKey] || [])];
    const gIdx = colItems.indexOf(gid);
    // Replace the group with its fields
    colItems.splice(gIdx, 1, ...groupFields);
    const updated = { ...containers, [colKey]: colItems };
    delete updated[gid];
    setContainers(updated);
    await saveContainers(updated);
  };

  // Rename a group
  const handleRenameGroup = async (oldGid: string, newName: string) => {
    const newGid = `group:${newName}`;
    if (newGid === oldGid || containers[newGid]) return; // no-op or already exists

    const updated: Containers = {};
    for (const [k, v] of Object.entries(containers)) {
      if (k === oldGid) {
        // Rename the group container
        updated[newGid] = v;
      } else {
        // Replace old gid reference in column items
        updated[k] = v.map((item) => (item === oldGid ? newGid : item));
      }
    }
    setContainers(updated);
    await saveContainers(updated);
  };

  // Find field index in the original section.fields for edit/delete callbacks
  const findFieldIdx = (fieldKey: string) => section.fields.findIndex((f) => f.key === fieldKey);

  // Render items in a container (column or inside a group)
  const renderItems = (containerId: string) => {
    const items = containers[containerId] || [];
    return items.map((itemId) => {
      if (itemId.startsWith("group:")) {
        const gname = itemId.slice(6);
        const groupItems = containers[itemId] || [];
        return (
          <SortableContext key={itemId} id={itemId} items={groupItems} strategy={verticalListSortingStrategy}>
            <SortableGroupCard
              id={itemId}
              groupName={gname}
              onRename={(newName) => handleRenameGroup(itemId, newName)}
              onRemove={() => handleRemoveGroup(itemId)}
            >
              {groupItems.map((fk) => {
                const f = fieldMap.get(fk);
                if (!f) return null;
                const fi = findFieldIdx(fk);
                return (
                  <SortableFieldCard
                    key={fk} id={fk} field={f}
                    isCalc={calculatedFieldKeys.includes(fk)}
                    onEdit={fi >= 0 ? () => openEditField(sectionIdx, fi) : undefined}
                    onDelete={fi >= 0 ? () => promptDeleteField(sectionIdx, fi) : undefined}
                  />
                );
              })}
            </SortableGroupCard>
          </SortableContext>
        );
      }
      const f = fieldMap.get(itemId);
      if (!f) return null;
      const fi = findFieldIdx(itemId);
      return (
        <SortableFieldCard
          key={itemId} id={itemId} field={f}
          isCalc={calculatedFieldKeys.includes(itemId)}
          onEdit={fi >= 0 ? () => openEditField(sectionIdx, fi) : undefined}
          onDelete={fi >= 0 ? () => promptDeleteField(sectionIdx, fi) : undefined}
        />
      );
    });
  };

  // Determine what the active dragged item is for the DragOverlay
  const activeField = activeId && !String(activeId).startsWith("group:") ? fieldMap.get(String(activeId)) : null;
  const activeGroup = activeId && String(activeId).startsWith("group:") ? String(activeId).slice(6) : null;

  return (
    <Box sx={{ pb: 1.5, px: 1.5 }}>
      {/* Toolbar: column toggle + group add */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
        <ToggleButtonGroup size="small" exclusive value={cols} onChange={handleColumnChange} sx={{ height: 30 }}>
          <ToggleButton value={1} sx={{ px: 1.25, py: 0, fontSize: "0.8rem" }}>
            <MaterialSymbol icon="view_agenda" size={16} />&nbsp;1 Col
          </ToggleButton>
          <ToggleButton value={2} sx={{ px: 1.25, py: 0, fontSize: "0.8rem" }}>
            <MaterialSymbol icon="view_column" size={16} />&nbsp;2 Col
          </ToggleButton>
        </ToggleButtonGroup>

        <Box sx={{ flex: 1 }} />

        {addingGroup ? (
          <Box sx={{ display: "flex", gap: 0.75, alignItems: "center" }}>
            <TextField
              size="small" placeholder="Group name" autoFocus
              value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAddGroup(); }}
              sx={{ width: 150 }}
            />
            <Button size="small" onClick={handleAddGroup} disabled={!newGroupName}>Add</Button>
            <IconButton size="small" onClick={() => { setAddingGroup(false); setNewGroupName(""); }}>
              <MaterialSymbol icon="close" size={16} />
            </IconButton>
          </Box>
        ) : (
          <Button size="small" startIcon={<MaterialSymbol icon="workspaces" size={16} />} onClick={() => setAddingGroup(true)}>
            Group
          </Button>
        )}

        <Button size="small" startIcon={<MaterialSymbol icon="add" size={16} />} onClick={() => openAddField(sectionIdx)}>
          Field
        </Button>
      </Box>

      {/* Visual layout */}
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <Box sx={{ display: "flex", gap: 2 }}>
          {/* Column 1 */}
          <SortableContext id="col-0" items={containers["col-0"] || []} strategy={verticalListSortingStrategy}>
            <DroppableColumn id="col-0" label="Column 1" isEmpty={(containers["col-0"] || []).length === 0}>
              {renderItems("col-0")}
            </DroppableColumn>
          </SortableContext>

          {/* Column 2 */}
          {cols === 2 && (
            <SortableContext id="col-1" items={containers["col-1"] || []} strategy={verticalListSortingStrategy}>
              <DroppableColumn id="col-1" label="Column 2" isEmpty={(containers["col-1"] || []).length === 0}>
                {renderItems("col-1")}
              </DroppableColumn>
            </SortableContext>
          )}
        </Box>

        <DragOverlay dropAnimation={null}>
          {activeField && <FieldCard field={activeField} isDragging />}
          {activeGroup && (
            <Box sx={{ border: 2, borderColor: "primary.main", borderStyle: "dashed", borderRadius: 1, p: 1, bgcolor: "primary.50", minWidth: 120 }}>
              <Typography variant="caption" fontWeight={600}>{activeGroup}</Typography>
            </Box>
          )}
        </DragOverlay>
      </DndContext>
    </Box>
  );
}

// ── DescriptionFieldsPanel ───────────────────────────────────────

function DescriptionFieldsPanel({
  typeKey, fieldsSchema, calculatedFieldKeys,
  onRefresh, openAddField, openEditField, promptDeleteField,
}: {
  typeKey: string; fieldsSchema: SectionDef[]; calculatedFieldKeys: string[];
  onRefresh: () => void;
  openAddField: (si: number) => void;
  openEditField: (si: number, fi: number) => void;
  promptDeleteField: (si: number, fi: number) => void;
}) {
  const descIdx = fieldsSchema.findIndex((s) => s.section === "__description");
  const descSection = descIdx >= 0 ? fieldsSchema[descIdx] : null;
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
      const schema: SectionDef[] = [...fieldsSchema, { section: "__description", fields: [] }];
      await api.patch(`/metamodel/types/${typeKey}`, { fields_schema: schema });
      onRefresh();
    }
  };

  const builtinFields: FieldDef[] = [
    { key: "__name", label: "Name", type: "text", required: true, weight: 0 },
    { key: "__description", label: "Description", type: "text", required: false, weight: 1 },
  ];

  return (
    <Box sx={{ pb: 1.5, px: 1.5 }}>
      {builtinFields.map((f) => (
        <Box key={f.key} sx={{ mb: 0.75 }}>
          <FieldCard field={f} isProtected />
        </Box>
      ))}
      {customFields.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleFieldDragEnd}>
          <SortableContext items={customFields.map((_, i) => `desc-field-${i}`)} strategy={verticalListSortingStrategy}>
            {customFields.map((f, fi) => (
              <SortableFieldCard
                key={`desc-field-${fi}`} id={`desc-field-${fi}`} field={f}
                isCalc={calculatedFieldKeys.includes(f.key)}
                onEdit={() => openEditField(actualDescIdx, fi)}
                onDelete={() => promptDeleteField(actualDescIdx, fi)}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}
      <Button size="small" startIcon={<MaterialSymbol icon="add" size={14} />} onClick={addFieldToDescription} sx={{ mt: 0.5 }}>
        Field
      </Button>
    </Box>
  );
}

// ── SortableSectionItem ──────────────────────────────────────────

function SortableSectionItem({
  id, sectionKey, info, cfg, expanded, onToggleExpand,
  onToggleCollapsed, onToggleHidden, onDelete, children,
}: {
  id: string; sectionKey: string;
  info: { label: string; icon: string; isCustom: boolean };
  cfg: SectionConfig; expanded: boolean;
  onToggleExpand: () => void;
  onToggleCollapsed: () => void;
  onToggleHidden: () => void;
  onDelete?: () => void;
  children?: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const canExpand = (info.isCustom || sectionKey === "description") && !cfg.hidden;

  return (
    <Box ref={setNodeRef} style={style} sx={{ border: 1, borderColor: cfg.hidden ? "action.disabled" : "divider", borderRadius: 1.5, mb: 1, bgcolor: cfg.hidden ? "action.disabledBackground" : "background.paper" }}>
      <Box sx={{ display: "flex", alignItems: "center", px: 1.5, py: 0.75, gap: 0.75 }}>
        <Box {...attributes} {...listeners} sx={{ cursor: "grab", display: "flex", mr: 0.5, "&:active": { cursor: "grabbing" } }}>
          <MaterialSymbol icon="drag_indicator" size={20} color="#999" />
        </Box>
        <Box onClick={canExpand ? onToggleExpand : undefined} sx={{ display: "flex", alignItems: "center", gap: 0.75, flex: 1, cursor: canExpand ? "pointer" : "default" }}>
          <MaterialSymbol icon={info.icon} size={20} color={cfg.hidden ? "#bbb" : "#666"} />
          <Typography variant="body2" fontWeight={600} sx={{ color: cfg.hidden ? "text.disabled" : "text.primary" }}>{info.label}</Typography>
        </Box>
        <Tooltip title="Collapsed by default">
          <FormControlLabel
            control={<Switch size="small" checked={cfg.defaultExpanded === false} disabled={!!cfg.hidden} onChange={onToggleCollapsed} />}
            label={<Typography variant="caption" color="text.secondary">Collapsed</Typography>}
            sx={{ mr: 0, ml: 0 }}
          />
        </Tooltip>
        <Tooltip title="Hidden from card detail">
          <FormControlLabel
            control={<Switch size="small" checked={!!cfg.hidden} onChange={onToggleHidden} />}
            label={<Typography variant="caption" color="text.secondary">Hidden</Typography>}
            sx={{ mr: 0, ml: 0 }}
          />
        </Tooltip>
        {onDelete && (
          <Tooltip title="Delete section">
            <IconButton size="small" onClick={onDelete}>
              <MaterialSymbol icon="delete" size={18} color="#999" />
            </IconButton>
          </Tooltip>
        )}
        {canExpand && (
          <IconButton size="small" onClick={onToggleExpand}>
            <MaterialSymbol icon={expanded ? "expand_less" : "expand_more"} size={20} />
          </IconButton>
        )}
      </Box>
      {expanded && !cfg.hidden && children}
    </Box>
  );
}

// ── Main CardLayoutEditor ────────────────────────────────────────

interface CardLayoutEditorProps {
  cardType: CardType;
  onRefresh: () => void;
  openAddField: (si: number) => void;
  openEditField: (si: number, fi: number) => void;
  promptDeleteField: (si: number, fi: number) => void;
  promptDeleteSection?: (si: number) => void;
  calculatedFieldKeys: string[];
}

export default function CardLayoutEditor({
  cardType, onRefresh, openAddField, openEditField, promptDeleteField, promptDeleteSection, calculatedFieldKeys,
}: CardLayoutEditorProps) {
  const secCfg = (cardType.section_config || {}) as Record<string, SectionConfig> & { __order?: string[] };
  const customSections = cardType.fields_schema.filter((s) => s.section !== "__description");
  const sectionOrder = getSectionOrder(secCfg, customSections, cardType.has_hierarchy);

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
    const newCustomIdx = customSections.length;
    const newOrder = [...sectionOrder, `custom:${newCustomIdx}`];
    await api.patch(`/metamodel/types/${cardType.key}`, {
      fields_schema: schema,
      section_config: { ...secCfg, __order: newOrder },
    });
    onRefresh();
    setNewSectionName("");
    setAddSectionOpen(false);
    setExpandedSections((prev) => new Set([...prev, `custom:${newCustomIdx}`]));
  };

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>
        Card Layout
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Drag sections to reorder. Expand to manage fields, columns, and groups.
      </Typography>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSectionDragEnd}>
        <SortableContext items={sectionOrder} strategy={verticalListSortingStrategy}>
          {sectionOrder.map((key) => {
            const info = getSectionInfo(key, customSections, cardType);
            if (!info) return null;
            const cfgForSection = key.startsWith("custom:")
              ? (secCfg[key] || secCfg[info.label] || {})
              : (secCfg[key] || {});
            const schemaIdx = info.isCustom ? customToSchemaIdx(info.idx) : -1;

            return (
              <SortableSectionItem
                key={key} id={key} sectionKey={key} info={info} cfg={cfgForSection}
                expanded={expandedSections.has(key)}
                onToggleExpand={() => toggleExpand(key)}
                onToggleCollapsed={() => updateSectionProp(key, { defaultExpanded: cfgForSection.defaultExpanded === false })}
                onToggleHidden={() => updateSectionProp(key, { hidden: !cfgForSection.hidden })}
                onDelete={info.isCustom && promptDeleteSection && schemaIdx >= 0 ? () => promptDeleteSection(schemaIdx) : undefined}
              >
                {info.isCustom && info.section && schemaIdx >= 0 && (
                  <VisualFieldLayout
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

      {addSectionOpen ? (
        <Box sx={{ display: "flex", gap: 1, alignItems: "center", mt: 1 }}>
          <TextField size="small" placeholder="Section name" value={newSectionName} autoFocus
            onChange={(e) => setNewSectionName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAddSection(); }}
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
