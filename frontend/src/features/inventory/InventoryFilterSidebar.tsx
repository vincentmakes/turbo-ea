import { useState, useEffect, useCallback, useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Collapse from "@mui/material/Collapse";
import Tooltip from "@mui/material/Tooltip";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { FactSheetType, Bookmark, FieldDef } from "@/types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface Filters {
  types: string[];
  search: string;
  qualitySeals: string[];
  attributes: Record<string, string>; // key → value (single_select only for now)
}

interface Props {
  types: FactSheetType[];
  filters: Filters;
  onFiltersChange: (f: Filters) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  width: number;
  onWidthChange: (w: number) => void;
}

const SEAL_OPTIONS = [
  { key: "DRAFT", label: "Draft", color: "#9e9e9e" },
  { key: "APPROVED", label: "Approved", color: "#4caf50" },
  { key: "BROKEN", label: "Broken", color: "#ff9800" },
  { key: "REJECTED", label: "Rejected", color: "#f44336" },
];

const MIN_WIDTH = 220;
const MAX_WIDTH = 500;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function InventoryFilterSidebar({
  types,
  filters,
  onFiltersChange,
  collapsed,
  onToggleCollapse,
  width,
  onWidthChange,
}: Props) {
  const [tab, setTab] = useState(0);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    types: true,
    search: true,
    seals: false,
    attributes: false,
  });

  // Views state
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [editingBookmark, setEditingBookmark] = useState<Bookmark | null>(null);
  const [viewName, setViewName] = useState("");

  // Load bookmarks
  const loadBookmarks = useCallback(async () => {
    try {
      const bms = await api.get<Bookmark[]>("/bookmarks");
      setBookmarks(bms);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadBookmarks();
  }, [loadBookmarks]);

  // Derive attribute filter fields from selected types
  const attributeFields = useMemo(() => {
    const selectedTypes = filters.types.length > 0
      ? types.filter((t) => filters.types.includes(t.key))
      : [];
    if (selectedTypes.length !== 1) return [];
    const t = selectedTypes[0];
    const fields: FieldDef[] = [];
    for (const section of t.fields_schema) {
      for (const f of section.fields) {
        if (f.type === "single_select" && f.options && f.options.length > 0) {
          fields.push(f);
        }
      }
    }
    return fields;
  }, [types, filters.types]);

  const toggleSection = (key: string) =>
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const toggleType = (key: string) => {
    const next = filters.types.includes(key)
      ? filters.types.filter((t) => t !== key)
      : [...filters.types, key];
    onFiltersChange({ ...filters, types: next, attributes: {} });
  };

  const toggleSeal = (key: string) => {
    const next = filters.qualitySeals.includes(key)
      ? filters.qualitySeals.filter((s) => s !== key)
      : [...filters.qualitySeals, key];
    onFiltersChange({ ...filters, qualitySeals: next });
  };

  const setAttr = (key: string, value: string) => {
    const next = { ...filters.attributes };
    if (value) next[key] = value;
    else delete next[key];
    onFiltersChange({ ...filters, attributes: next });
  };

  const clearAll = () =>
    onFiltersChange({ types: [], search: "", qualitySeals: [], attributes: {} });

  const activeCount =
    filters.types.length +
    (filters.search ? 1 : 0) +
    filters.qualitySeals.length +
    Object.keys(filters.attributes).length;

  /* ---- Views actions ---- */

  const handleSaveView = async () => {
    if (!viewName.trim()) return;
    const payload = {
      name: viewName.trim(),
      fact_sheet_type: filters.types.length === 1 ? filters.types[0] : undefined,
      filters: {
        types: filters.types,
        search: filters.search,
        qualitySeals: filters.qualitySeals,
        attributes: filters.attributes,
      },
    };
    if (editingBookmark) {
      await api.patch(`/bookmarks/${editingBookmark.id}`, payload);
    } else {
      await api.post("/bookmarks", payload);
    }
    setSaveDialogOpen(false);
    setEditingBookmark(null);
    setViewName("");
    loadBookmarks();
  };

  const handleApplyView = (bm: Bookmark) => {
    const f = bm.filters as Filters | undefined;
    if (f) {
      onFiltersChange({
        types: f.types || [],
        search: f.search || "",
        qualitySeals: f.qualitySeals || [],
        attributes: f.attributes || {},
      });
    }
    setTab(0);
  };

  const handleDeleteView = async (bm: Bookmark) => {
    await api.delete(`/bookmarks/${bm.id}`);
    loadBookmarks();
  };

  const handleEditView = (bm: Bookmark) => {
    setEditingBookmark(bm);
    setViewName(bm.name);
    setSaveDialogOpen(true);
  };

  /* ---- Resize drag ---- */

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const onMove = (ev: MouseEvent) => {
      const newW = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW + (ev.clientX - startX)));
      onWidthChange(newW);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  /* ---- Collapsed rail ---- */

  if (collapsed) {
    return (
      <Box
        sx={{
          width: 44,
          minWidth: 44,
          borderRight: "1px solid #e0e0e0",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          pt: 1,
          bgcolor: "#fafafa",
        }}
      >
        <Tooltip title="Expand filters" placement="right">
          <IconButton size="small" onClick={onToggleCollapse}>
            <MaterialSymbol icon="chevron_right" size={20} />
          </IconButton>
        </Tooltip>
        {activeCount > 0 && (
          <Chip
            label={activeCount}
            size="small"
            color="primary"
            sx={{ mt: 1, minWidth: 24, height: 20, fontSize: 11 }}
          />
        )}
      </Box>
    );
  }

  /* ---- Expanded sidebar ---- */

  return (
    <Box sx={{ display: "flex", height: "100%" }}>
      <Box
        sx={{
          width,
          minWidth: MIN_WIDTH,
          borderRight: "1px solid #e0e0e0",
          display: "flex",
          flexDirection: "column",
          bgcolor: "#fafafa",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            px: 1.5,
            py: 0.5,
            borderBottom: "1px solid #e0e0e0",
          }}
        >
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            sx={{
              minHeight: 36,
              "& .MuiTab-root": { minHeight: 36, py: 0, textTransform: "none", fontSize: 13 },
            }}
          >
            <Tab label="Filters" />
            <Tab label="Views" />
          </Tabs>
          <IconButton size="small" onClick={onToggleCollapse}>
            <MaterialSymbol icon="chevron_left" size={20} />
          </IconButton>
        </Box>

        {/* Scrollable content */}
        <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
          {tab === 0 ? (
            /* ======================= FILTERS TAB ======================= */
            <>
              {/* Search */}
              <SectionHeader
                label="Search"
                icon="search"
                expanded={expandedSections.search}
                onToggle={() => toggleSection("search")}
              />
              <Collapse in={expandedSections.search}>
                <TextField
                  size="small"
                  fullWidth
                  placeholder="Search fact sheets..."
                  value={filters.search}
                  onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
                  sx={{ mb: 2 }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <MaterialSymbol icon="search" size={16} color="#999" />
                      </InputAdornment>
                    ),
                    ...(filters.search
                      ? {
                          endAdornment: (
                            <InputAdornment position="end">
                              <IconButton
                                size="small"
                                onClick={() => onFiltersChange({ ...filters, search: "" })}
                              >
                                <MaterialSymbol icon="close" size={14} />
                              </IconButton>
                            </InputAdornment>
                          ),
                        }
                      : {}),
                  }}
                />
              </Collapse>

              {/* Fact Sheet Types */}
              <SectionHeader
                label="Types"
                icon="category"
                expanded={expandedSections.types}
                onToggle={() => toggleSection("types")}
                count={filters.types.length}
              />
              <Collapse in={expandedSections.types}>
                <List dense disablePadding sx={{ mb: 1 }}>
                  {types
                    .filter((t) => !t.is_hidden)
                    .map((t) => (
                      <ListItemButton
                        key={t.key}
                        dense
                        onClick={() => toggleType(t.key)}
                        sx={{ py: 0.25, px: 1, borderRadius: 1 }}
                      >
                        <ListItemIcon sx={{ minWidth: 32 }}>
                          <Checkbox
                            size="small"
                            checked={filters.types.includes(t.key)}
                            disableRipple
                            sx={{ p: 0 }}
                          />
                        </ListItemIcon>
                        <MaterialSymbol icon={t.icon} size={16} color={t.color} />
                        <ListItemText
                          primary={t.label}
                          primaryTypographyProps={{
                            fontSize: 13,
                            ml: 0.75,
                            noWrap: true,
                          }}
                        />
                      </ListItemButton>
                    ))}
                </List>
              </Collapse>

              {/* Quality Seals */}
              <SectionHeader
                label="Quality Seal"
                icon="verified"
                expanded={expandedSections.seals}
                onToggle={() => toggleSection("seals")}
                count={filters.qualitySeals.length}
              />
              <Collapse in={expandedSections.seals}>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 2, px: 0.5 }}>
                  {SEAL_OPTIONS.map((s) => (
                    <Chip
                      key={s.key}
                      label={s.label}
                      size="small"
                      onClick={() => toggleSeal(s.key)}
                      variant={filters.qualitySeals.includes(s.key) ? "filled" : "outlined"}
                      sx={
                        filters.qualitySeals.includes(s.key)
                          ? { bgcolor: s.color, color: "#fff", borderColor: s.color }
                          : { borderColor: s.color, color: s.color }
                      }
                    />
                  ))}
                </Box>
              </Collapse>

              {/* Attribute Filters (only when single type selected) */}
              {attributeFields.length > 0 && (
                <>
                  <SectionHeader
                    label="Attributes"
                    icon="tune"
                    expanded={expandedSections.attributes}
                    onToggle={() => toggleSection("attributes")}
                    count={Object.keys(filters.attributes).length}
                  />
                  <Collapse in={expandedSections.attributes}>
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, mb: 2, px: 0.5 }}>
                      {attributeFields.map((field) => (
                        <FormControl key={field.key} size="small" fullWidth>
                          <InputLabel sx={{ fontSize: 13 }}>{field.label}</InputLabel>
                          <Select
                            value={filters.attributes[field.key] || ""}
                            label={field.label}
                            onChange={(e) => setAttr(field.key, e.target.value as string)}
                            sx={{ fontSize: 13 }}
                          >
                            <MenuItem value="">
                              <em>Any</em>
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
                      ))}
                    </Box>
                  </Collapse>
                </>
              )}

              <Divider sx={{ my: 1 }} />
              <Box sx={{ display: "flex", gap: 1 }}>
                {activeCount > 0 && (
                  <Button
                    size="small"
                    onClick={clearAll}
                    startIcon={<MaterialSymbol icon="filter_alt_off" size={16} />}
                    sx={{ textTransform: "none", fontSize: 12 }}
                  >
                    Clear all ({activeCount})
                  </Button>
                )}
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    setEditingBookmark(null);
                    setViewName("");
                    setSaveDialogOpen(true);
                  }}
                  startIcon={<MaterialSymbol icon="bookmark_add" size={16} />}
                  sx={{ textTransform: "none", fontSize: 12, ml: "auto" }}
                >
                  Save view
                </Button>
              </Box>
            </>
          ) : (
            /* ======================= VIEWS TAB ======================= */
            <>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  mb: 1,
                }}
              >
                <Typography variant="body2" fontWeight={600} fontSize={13}>
                  Saved Views
                </Typography>
                <Button
                  size="small"
                  onClick={() => {
                    setEditingBookmark(null);
                    setViewName("");
                    setSaveDialogOpen(true);
                  }}
                  startIcon={<MaterialSymbol icon="add" size={16} />}
                  sx={{ textTransform: "none", fontSize: 12 }}
                >
                  Save current
                </Button>
              </Box>

              {bookmarks.length === 0 ? (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ textAlign: "center", py: 4, fontSize: 13 }}
                >
                  No saved views yet.
                  <br />
                  Apply filters and click "Save current".
                </Typography>
              ) : (
                <List dense disablePadding>
                  {bookmarks.map((bm) => {
                    const bmFilters = bm.filters as Record<string, unknown> | undefined;
                    const bmTypes = (bmFilters?.types as string[]) || [];
                    const matchedType = bmTypes.length === 1
                      ? types.find((t) => t.key === bmTypes[0])
                      : null;
                    return (
                      <ListItemButton
                        key={bm.id}
                        sx={{ py: 0.5, px: 1, borderRadius: 1 }}
                        onClick={() => handleApplyView(bm)}
                      >
                        <ListItemIcon sx={{ minWidth: 28 }}>
                          {matchedType ? (
                            <MaterialSymbol
                              icon={matchedType.icon}
                              size={18}
                              color={matchedType.color}
                            />
                          ) : (
                            <MaterialSymbol icon="bookmark" size={18} color="#999" />
                          )}
                        </ListItemIcon>
                        <ListItemText
                          primary={bm.name}
                          primaryTypographyProps={{ fontSize: 13, noWrap: true }}
                          secondary={
                            matchedType
                              ? matchedType.label
                              : bmTypes.length > 1
                              ? `${bmTypes.length} types`
                              : "All types"
                          }
                          secondaryTypographyProps={{ fontSize: 11 }}
                        />
                        <Box
                          sx={{ display: "flex", gap: 0.25, ml: 0.5 }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <IconButton
                            size="small"
                            onClick={() => handleEditView(bm)}
                            sx={{ p: 0.25 }}
                          >
                            <MaterialSymbol icon="edit" size={14} color="#999" />
                          </IconButton>
                          <IconButton
                            size="small"
                            onClick={() => handleDeleteView(bm)}
                            sx={{ p: 0.25 }}
                          >
                            <MaterialSymbol icon="delete" size={14} color="#999" />
                          </IconButton>
                        </Box>
                      </ListItemButton>
                    );
                  })}
                </List>
              )}
            </>
          )}
        </Box>
      </Box>

      {/* Resize handle */}
      <Box
        onMouseDown={handleResizeMouseDown}
        sx={{
          width: 5,
          cursor: "col-resize",
          bgcolor: "transparent",
          "&:hover": { bgcolor: "primary.main", opacity: 0.3 },
          transition: "background-color 0.2s",
          zIndex: 1,
        }}
      />

      {/* Save / Edit view dialog */}
      <Dialog
        open={saveDialogOpen}
        onClose={() => setSaveDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {editingBookmark ? "Edit View" : "Save Current View"}
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="View name"
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
            sx={{ mt: 1 }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveView();
            }}
          />
          {!editingBookmark && activeCount > 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
              This will save your current {activeCount} active filter{activeCount > 1 ? "s" : ""}.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSaveView}
            disabled={!viewName.trim()}
          >
            {editingBookmark ? "Update" : "Save"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

/* ------------------------------------------------------------------ */
/*  Section header helper                                              */
/* ------------------------------------------------------------------ */

function SectionHeader({
  label,
  icon,
  expanded,
  onToggle,
  count,
}: {
  label: string;
  icon: string;
  expanded: boolean;
  onToggle: () => void;
  count?: number;
}) {
  return (
    <Box
      onClick={onToggle}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        py: 0.5,
        px: 0.5,
        cursor: "pointer",
        borderRadius: 1,
        userSelect: "none",
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <MaterialSymbol
        icon={expanded ? "expand_more" : "chevron_right"}
        size={16}
        color="#666"
      />
      <MaterialSymbol icon={icon} size={16} color="#666" />
      <Typography variant="body2" fontWeight={600} fontSize={12} sx={{ flex: 1 }}>
        {label}
      </Typography>
      {count != null && count > 0 && (
        <Chip label={count} size="small" color="primary" sx={{ height: 18, fontSize: 10 }} />
      )}
    </Box>
  );
}
