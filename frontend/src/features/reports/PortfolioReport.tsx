import { useEffect, useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Chip from "@mui/material/Chip";
import Autocomplete from "@mui/material/Autocomplete";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";
import ReportShell from "./ReportShell";
import SaveReportDialog from "./SaveReportDialog";
import TimelineSlider from "@/components/TimelineSlider";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useSavedReport } from "@/hooks/useSavedReport";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AppRelation {
  relation_type: string;
  related_id: string;
  related_name: string;
  related_type: string;
}

interface AppData {
  id: string;
  name: string;
  subtype?: string;
  attributes?: Record<string, unknown>;
  lifecycle?: Record<string, string>;
  relations: AppRelation[];
  org_ids: string[];
}

interface FieldOption {
  key: string;
  label: string;
  color?: string;
}

interface FieldDef {
  key: string;
  label: string;
  type: string;
  options?: FieldOption[];
}

interface SectionDef {
  section: string;
  fields: FieldDef[];
}

interface RelTypeDef {
  key: string;
  label: string;
  reverse_label?: string;
  source_type_key: string;
  target_type_key: string;
  other_type_key: string;
}

interface OrgRef {
  id: string;
  name: string;
}

interface ApiResponse {
  items: AppData[];
  fields_schema: SectionDef[];
  relation_types: RelTypeDef[];
  groupable_types: Record<string, { id: string; name: string; type: string }[]>;
  organizations: OrgRef[];
}

interface GroupData {
  key: string;
  label: string;
  apps: AppData[];
}

interface DrawerData {
  label: string;
  apps: AppData[];
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** Well-known option colors for common Application fields */
const KNOWN_COLORS: Record<string, Record<string, { label: string; color: string }>> = {
  timeModel: {
    tolerate: { label: "Tolerate", color: "#ff9800" },
    invest: { label: "Invest", color: "#4caf50" },
    migrate: { label: "Migrate", color: "#2196f3" },
    eliminate: { label: "Eliminate", color: "#d32f2f" },
  },
  businessCriticality: {
    missionCritical: { label: "Mission Critical", color: "#d32f2f" },
    businessCritical: { label: "Business Critical", color: "#f57c00" },
    businessOperational: { label: "Business Operational", color: "#fbc02d" },
    administrativeService: { label: "Administrative", color: "#9e9e9e" },
  },
  functionalSuitability: {
    perfect: { label: "Perfect", color: "#2e7d32" },
    appropriate: { label: "Appropriate", color: "#66bb6a" },
    insufficient: { label: "Insufficient", color: "#f57c00" },
    unreasonable: { label: "Unreasonable", color: "#d32f2f" },
  },
  technicalSuitability: {
    fullyAppropriate: { label: "Fully Appropriate", color: "#2e7d32" },
    adequate: { label: "Adequate", color: "#66bb6a" },
    unreasonable: { label: "Unreasonable", color: "#f57c00" },
    inappropriate: { label: "Inappropriate", color: "#d32f2f" },
  },
  hostingType: {
    onPremise: { label: "On-Premise", color: "#5c6bc0" },
    cloudSaaS: { label: "Cloud (SaaS)", color: "#26a69a" },
    cloudPaaS: { label: "Cloud (PaaS)", color: "#42a5f5" },
    cloudIaaS: { label: "Cloud (IaaS)", color: "#7e57c2" },
    hybrid: { label: "Hybrid", color: "#ff7043" },
  },
};

const UNSET_COLOR = "#e0e0e0";
const DEFAULT_APP_COLOR = "#0f7eb5";

const LIFECYCLE_PHASES = ["plan", "phaseIn", "active", "phaseOut", "endOfLife"];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function pickSelectFields(schema: SectionDef[]): FieldDef[] {
  const out: FieldDef[] = [];
  for (const s of schema)
    for (const f of s.fields)
      if (f.type === "single_select") out.push(f);
  return out;
}

function getAppColor(
  app: AppData,
  colorBy: string,
  selectFields: FieldDef[],
): string {
  if (!colorBy) return DEFAULT_APP_COLOR;
  const val = (app.attributes || {})[colorBy] as string | undefined;
  if (!val) return UNSET_COLOR;
  // Check known colors first
  const known = KNOWN_COLORS[colorBy]?.[val];
  if (known) return known.color;
  // Fall back to field option color from schema
  const fd = selectFields.find((f) => f.key === colorBy);
  const opt = fd?.options?.find((o) => o.key === val);
  return opt?.color || UNSET_COLOR;
}

function getAppColorLabel(
  app: AppData,
  colorBy: string,
  selectFields: FieldDef[],
): string | null {
  if (!colorBy) return null;
  const val = (app.attributes || {})[colorBy] as string | undefined;
  if (!val) return "Not set";
  const known = KNOWN_COLORS[colorBy]?.[val];
  if (known) return known.label;
  const fd = selectFields.find((f) => f.key === colorBy);
  const opt = fd?.options?.find((o) => o.key === val);
  return opt?.label || val;
}

function parseDate(s: string | undefined): number | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function isAppAliveAtDate(app: AppData, dateMs: number): boolean {
  const lc = app.lifecycle;
  if (!lc) return true;
  const dates = LIFECYCLE_PHASES.map((p) => parseDate(lc[p])).filter(
    (d): d is number => d != null,
  );
  if (dates.length === 0) return true;
  if (Math.min(...dates) > dateMs) return false;
  const eol = parseDate(lc.endOfLife);
  if (eol != null && eol <= dateMs) return false;
  return true;
}

function isLightColor(color: string): boolean {
  return (
    color === UNSET_COLOR ||
    color === "#fbc02d" ||
    color === "#ff9800" ||
    color === "#66bb6a"
  );
}

/* ------------------------------------------------------------------ */
/*  Filter helpers                                                     */
/* ------------------------------------------------------------------ */

interface FilterState {
  orgIds: string[];
  attributeFilters: Record<string, string[]>;
  timelineDate: number;
  search: string;
}

function matchesFilters(
  app: AppData,
  filters: FilterState,
): boolean {
  if (!isAppAliveAtDate(app, filters.timelineDate)) return false;
  if (
    filters.orgIds.length > 0 &&
    !filters.orgIds.some((o) => app.org_ids.includes(o))
  )
    return false;
  const attrs = app.attributes || {};
  for (const [key, vals] of Object.entries(filters.attributeFilters)) {
    if (vals.length > 0 && !vals.includes(attrs[key] as string)) return false;
  }
  if (
    filters.search &&
    !app.name.toLowerCase().includes(filters.search.toLowerCase())
  )
    return false;
  return true;
}

/* ------------------------------------------------------------------ */
/*  Grouping logic                                                     */
/* ------------------------------------------------------------------ */

type GroupByMode = { kind: "attribute"; fieldKey: string } | { kind: "relation"; typeKey: string };

function groupApps(
  apps: AppData[],
  mode: GroupByMode,
  selectFields: FieldDef[],
  groupableTypes: Record<string, { id: string; name: string; type: string }[]>,
): { groups: GroupData[]; ungrouped: AppData[] } {
  if (mode.kind === "attribute") {
    const field = selectFields.find((f) => f.key === mode.fieldKey);
    const options = field?.options || [];
    const buckets = new Map<string, AppData[]>();
    const ungrouped: AppData[] = [];

    for (const opt of options) buckets.set(opt.key, []);
    for (const app of apps) {
      const val = (app.attributes || {})[mode.fieldKey] as string | undefined;
      if (val && buckets.has(val)) {
        buckets.get(val)!.push(app);
      } else {
        ungrouped.push(app);
      }
    }

    const groups: GroupData[] = [];
    for (const opt of options) {
      const items = buckets.get(opt.key) || [];
      groups.push({ key: opt.key, label: opt.label, apps: items });
    }
    return { groups, ungrouped };
  }

  // Relation grouping
  const members = groupableTypes[mode.typeKey] || [];
  const buckets = new Map<string, AppData[]>();
  const grouped = new Set<string>();

  for (const m of members) buckets.set(m.id, []);
  for (const app of apps) {
    for (const rel of app.relations) {
      if (rel.related_type === mode.typeKey && buckets.has(rel.related_id)) {
        buckets.get(rel.related_id)!.push(app);
        grouped.add(app.id);
      }
    }
  }

  const groups: GroupData[] = [];
  for (const m of members) {
    const items = buckets.get(m.id) || [];
    if (items.length > 0) {
      groups.push({ key: m.id, label: m.name, apps: items });
    }
  }
  groups.sort((a, b) => b.apps.length - a.apps.length);

  const ungrouped = apps.filter((a) => !grouped.has(a.id));
  return { groups, ungrouped };
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function AppChip({
  app,
  colorBy,
  selectFields,
  onClick,
}: {
  app: AppData;
  colorBy: string;
  selectFields: FieldDef[];
  onClick: () => void;
}) {
  const color = getAppColor(app, colorBy, selectFields);
  const colorLabel = getAppColorLabel(app, colorBy, selectFields);
  const light = isLightColor(color);
  const tip = colorLabel ? `${app.name} \u2014 ${colorLabel}` : app.name;

  return (
    <Tooltip title={tip}>
      <Chip
        size="small"
        label={app.name}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        sx={{
          bgcolor: color,
          color: light ? "#333" : "#fff",
          fontWeight: 500,
          fontSize: "0.72rem",
          maxWidth: 180,
          cursor: "pointer",
          "&:hover": { opacity: 0.85 },
        }}
      />
    </Tooltip>
  );
}

function GroupCard({
  group,
  colorBy,
  selectFields,
  totalApps,
  onGroupClick,
  onAppClick,
}: {
  group: GroupData;
  colorBy: string;
  selectFields: FieldDef[];
  totalApps: number;
  onGroupClick: (g: GroupData) => void;
  onAppClick: (id: string) => void;
}) {
  const count = group.apps.length;
  const pct = totalApps > 0 ? Math.round((count / totalApps) * 100) : 0;

  return (
    <Box
      sx={{
        border: "1px solid #e0e0e0",
        borderRadius: 2,
        overflow: "hidden",
        bgcolor: "#fff",
        cursor: "pointer",
        transition: "box-shadow 0.2s",
        "&:hover": { boxShadow: 3 },
        display: "flex",
        flexDirection: "column",
      }}
      onClick={() => onGroupClick(group)}
    >
      {/* Header */}
      <Box
        sx={{
          p: 1.5,
          bgcolor: "#f5f8fc",
          borderBottom: count > 0 ? "1px solid #e0e0e0" : "none",
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
      >
        <Typography
          variant="subtitle2"
          sx={{ fontWeight: 700, flex: 1 }}
          noWrap
        >
          {group.label}
        </Typography>
        <Chip
          size="small"
          label={`${count} apps`}
          sx={{
            height: 22,
            fontSize: "0.72rem",
            fontWeight: 600,
            bgcolor: count > 0 ? "#e3f2fd" : "#f5f5f5",
            color: count > 0 ? "#1565c0" : "#999",
          }}
        />
        {pct > 0 && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontSize: "0.7rem" }}
          >
            {pct}%
          </Typography>
        )}
      </Box>

      {/* Progress bar */}
      {totalApps > 0 && (
        <Box sx={{ height: 3, bgcolor: "#f0f0f0" }}>
          <Box
            sx={{
              height: "100%",
              width: `${pct}%`,
              bgcolor: "#1976d2",
              borderRadius: "0 2px 2px 0",
              transition: "width 0.3s",
            }}
          />
        </Box>
      )}

      {/* App chips */}
      {count > 0 && (
        <Box sx={{ p: 1.5, display: "flex", flexWrap: "wrap", gap: 0.5, flex: 1 }}>
          {group.apps
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((app) => (
              <AppChip
                key={app.id}
                app={app}
                colorBy={colorBy}
                selectFields={selectFields}
                onClick={() => onAppClick(app.id)}
              />
            ))}
        </Box>
      )}
    </Box>
  );
}

function FilterSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { key: string; label: string; color?: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <Autocomplete
      multiple
      size="small"
      limitTags={1}
      options={options.map((o) => o.key)}
      getOptionLabel={(key) =>
        options.find((o) => o.key === key)?.label ?? key
      }
      value={value}
      onChange={(_, v) => onChange(v)}
      disableCloseOnSelect
      renderTags={(vals, getTagProps) =>
        vals.map((key, i) => {
          const opt = options.find((o) => o.key === key);
          return (
            <Chip
              size="small"
              label={opt?.label ?? key}
              {...getTagProps({ index: i })}
              key={key}
              sx={{
                bgcolor: opt?.color ?? undefined,
                color: opt?.color ? "#fff" : undefined,
                fontWeight: 500,
                fontSize: "0.72rem",
                maxWidth: 120,
              }}
            />
          );
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={value.length === 0 ? "All" : ""}
        />
      )}
      sx={{ width: 200 }}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function PortfolioReport() {
  const navigate = useNavigate();
  const { types: metamodelTypes } = useMetamodel();
  const saved = useSavedReport("portfolio");

  // Data
  const [data, setData] = useState<ApiResponse | null>(null);
  const [drawer, setDrawer] = useState<DrawerData | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");

  // Controls
  const [groupByRaw, setGroupByRaw] = useState("attr:businessCriticality");
  const [colorBy, setColorBy] = useState("timeModel");
  const [search, setSearch] = useState("");

  // Filters
  const [filterOrgs, setFilterOrgs] = useState<string[]>([]);
  const [attrFilters, setAttrFilters] = useState<Record<string, string[]>>({});

  // Timeline
  const todayMs = useMemo(() => Date.now(), []);
  const [timelineDate, setTimelineDate] = useState(todayMs);

  // Table sort
  const [sortK, setSortK] = useState("name");
  const [sortD, setSortD] = useState<"asc" | "desc">("asc");

  // Load saved report config
  useEffect(() => {
    const cfg = saved.consumeConfig();
    if (cfg) {
      if (cfg.view) setView(cfg.view as "chart" | "table");
      if (cfg.groupByRaw) setGroupByRaw(cfg.groupByRaw as string);
      if (cfg.colorBy != null) setColorBy(cfg.colorBy as string);
      if (cfg.search != null) setSearch(cfg.search as string);
      if (cfg.filterOrgs) setFilterOrgs(cfg.filterOrgs as string[]);
      if (cfg.attrFilters) setAttrFilters(cfg.attrFilters as Record<string, string[]>);
      if (cfg.timelineDate) setTimelineDate(cfg.timelineDate as number);
      if (cfg.sortK) setSortK(cfg.sortK as string);
      if (cfg.sortD) setSortD(cfg.sortD as "asc" | "desc");
    }
  }, [saved.loadedConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const getConfig = () => ({ view, groupByRaw, colorBy, search, filterOrgs, attrFilters, timelineDate, sortK, sortD });

  // Fetch data
  useEffect(() => {
    api
      .get<ApiResponse>("/reports/app-portfolio")
      .then((r) => setData(r));
  }, []);

  // Derived data
  const selectFields = useMemo(
    () => (data ? pickSelectFields(data.fields_schema) : []),
    [data],
  );

  // Build group-by options from schema + relation types
  const groupByOptions = useMemo(() => {
    if (!data) return [];
    const opts: { key: string; label: string; icon: string }[] = [];

    // Attribute-based grouping (single_select fields)
    for (const f of selectFields) {
      if (f.options && f.options.length > 0) {
        opts.push({ key: `attr:${f.key}`, label: f.label, icon: "tune" });
      }
    }

    // Relation-based grouping
    for (const [typeKey, members] of Object.entries(data.groupable_types)) {
      if (members.length > 0) {
        const typeMeta = metamodelTypes.find((t) => t.key === typeKey);
        const label = typeMeta?.label || typeKey;
        const icon = typeMeta?.icon || "link";
        opts.push({ key: `rel:${typeKey}`, label, icon });
      }
    }

    return opts;
  }, [data, selectFields, metamodelTypes]);

  // Ensure groupByRaw has a valid default
  const groupByKey = useMemo(() => {
    if (groupByOptions.find((o) => o.key === groupByRaw)) return groupByRaw;
    return groupByOptions[0]?.key || "attr:businessCriticality";
  }, [groupByRaw, groupByOptions]);

  const groupByMode = useMemo<GroupByMode>(() => {
    if (groupByKey.startsWith("attr:")) {
      return { kind: "attribute", fieldKey: groupByKey.slice(5) };
    }
    return { kind: "relation", typeKey: groupByKey.slice(4) };
  }, [groupByKey]);

  // Color-by options: all single_select fields + "none"
  const colorByOptions = useMemo(() => {
    const opts: { key: string; label: string }[] = [
      { key: "", label: "No color" },
    ];
    for (const f of selectFields) {
      opts.push({ key: f.key, label: f.label });
    }
    return opts;
  }, [selectFields]);

  // Timeline range
  const { dateRange, yearMarks, hasLifecycleData } = useMemo(() => {
    const now = todayMs;
    const pad3y = 3 * 365.25 * 86400000;
    const empty = {
      dateRange: { min: now - pad3y, max: now + pad3y },
      yearMarks: [] as { value: number; label: string }[],
      hasLifecycleData: false,
    };
    if (!data) return empty;

    let minD = Infinity;
    let maxD = -Infinity;
    let hasLC = false;
    for (const app of data.items) {
      const lc = app.lifecycle || {};
      for (const p of LIFECYCLE_PHASES) {
        const d = parseDate(lc[p]);
        if (d != null) {
          minD = Math.min(minD, d);
          maxD = Math.max(maxD, d);
          hasLC = true;
        }
      }
    }

    if (!hasLC) return empty;

    const pad = 365.25 * 86400000;
    minD -= pad;
    maxD += pad;
    const marks: { value: number; label: string }[] = [];
    const sy = new Date(minD).getFullYear();
    const ey = new Date(maxD).getFullYear();
    for (let y = sy; y <= ey + 1; y++) {
      const t = new Date(y, 0, 1).getTime();
      if (t >= minD && t <= maxD) marks.push({ value: t, label: String(y) });
    }

    return { dateRange: { min: minD, max: maxD }, yearMarks: marks, hasLifecycleData: hasLC };
  }, [data, todayMs]);

  // Build filters state
  const filters = useMemo<FilterState>(
    () => ({
      orgIds: filterOrgs,
      attributeFilters: attrFilters,
      timelineDate,
      search,
    }),
    [filterOrgs, attrFilters, timelineDate, search],
  );

  // Filtered apps
  const filteredApps = useMemo(() => {
    if (!data) return [];
    return data.items.filter((a) => matchesFilters(a, filters));
  }, [data, filters]);

  // Grouped data
  const { groups, ungrouped } = useMemo(() => {
    if (!data) return { groups: [], ungrouped: [] };
    return groupApps(filteredApps, groupByMode, selectFields, data.groupable_types);
  }, [filteredApps, groupByMode, selectFields, data]);

  // Summary stats
  const stats = useMemo(() => {
    const total = filteredApps.length;
    const withEol = filteredApps.filter(
      (a) => a.lifecycle?.endOfLife,
    ).length;
    return { total, withEol };
  }, [filteredApps]);

  // Color legend
  const colorLegend = useMemo(() => {
    if (!colorBy) return null;
    const known = KNOWN_COLORS[colorBy];
    if (known) return Object.values(known);
    const fd = selectFields.find((f) => f.key === colorBy);
    if (!fd?.options) return null;
    return fd.options
      .filter((o) => o.color)
      .map((o) => ({ label: o.label, color: o.color! }));
  }, [colorBy, selectFields]);

  const hasActiveFilters =
    filterOrgs.length > 0 ||
    Object.values(attrFilters).some((v) => v.length > 0) ||
    search.length > 0;

  const clearFilters = useCallback(() => {
    setFilterOrgs([]);
    setAttrFilters({});
    setSearch("");
    setTimelineDate(todayMs);
  }, [todayMs]);

  const handleAppClick = useCallback(
    (id: string) => {
      setDrawer(null);
      navigate(`/cards/${id}`);
    },
    [navigate],
  );

  const handleGroupClick = useCallback((g: GroupData) => {
    setDrawer({ label: g.label, apps: g.apps });
  }, []);

  const orgOptions = useMemo(
    () => (data?.organizations || []).map((o) => ({ key: o.id, label: o.name })),
    [data],
  );

  // Table helpers
  const tableSort = (k: string) => {
    setSortD(sortK === k && sortD === "asc" ? "desc" : "asc");
    setSortK(k);
  };

  const tableSorted = useMemo(() => {
    const dir = sortD === "asc" ? 1 : -1;
    return [...filteredApps].sort((a, b) => {
      if (sortK === "name") return a.name.localeCompare(b.name) * dir;
      if (sortK === "subtype")
        return (a.subtype || "").localeCompare(b.subtype || "") * dir;
      // Attribute column
      const av = ((a.attributes || {})[sortK] as string) || "";
      const bv = ((b.attributes || {})[sortK] as string) || "";
      return av.localeCompare(bv) * dir;
    });
  }, [filteredApps, sortK, sortD]);

  if (!data)
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );

  const groupByLabel =
    groupByOptions.find((o) => o.key === groupByKey)?.label || "Group";

  return (
    <ReportShell
      title="Application Portfolio"
      icon="dashboard"
      iconColor="#0f7eb5"
      view={view}
      onViewChange={setView}
      onSaveReport={() => saved.setSaveDialogOpen(true)}
      savedReportName={saved.savedReportName ?? undefined}
      onResetSavedReport={saved.resetSavedReport}
      toolbar={
        <>
          {/* Row 1: Main controls */}
          <TextField
            select
            size="small"
            label="Group by"
            value={groupByKey}
            onChange={(e) => setGroupByRaw(e.target.value)}
            sx={{ minWidth: 200 }}
          >
            {groupByOptions.length > 0 && (
              <MenuItem disabled sx={{ opacity: 0.6, fontSize: "0.75rem", fontWeight: 600 }}>
                Attributes
              </MenuItem>
            )}
            {groupByOptions
              .filter((o) => o.key.startsWith("attr:"))
              .map((o) => (
                <MenuItem key={o.key} value={o.key}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <MaterialSymbol icon={o.icon} size={16} color="#666" />
                    {o.label}
                  </Box>
                </MenuItem>
              ))}
            {groupByOptions.some((o) => o.key.startsWith("rel:")) && (
              <MenuItem disabled sx={{ opacity: 0.6, fontSize: "0.75rem", fontWeight: 600 }}>
                Related Types
              </MenuItem>
            )}
            {groupByOptions
              .filter((o) => o.key.startsWith("rel:"))
              .map((o) => (
                <MenuItem key={o.key} value={o.key}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <MaterialSymbol icon={o.icon} size={16} color="#666" />
                    {o.label}
                  </Box>
                </MenuItem>
              ))}
          </TextField>

          <TextField
            select
            size="small"
            label="Color apps by"
            value={colorBy}
            onChange={(e) => setColorBy(e.target.value)}
            sx={{ minWidth: 180 }}
          >
            {colorByOptions.map((o) => (
              <MenuItem key={o.key} value={o.key}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            size="small"
            label="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ minWidth: 160 }}
            slotProps={{
              input: {
                startAdornment: (
                  <MaterialSymbol
                    icon="search"
                    size={18}
                    color="#999"
                  />
                ),
              },
            }}
          />

          {/* Timeline slider */}
          {hasLifecycleData && (
            <TimelineSlider
              value={timelineDate}
              onChange={setTimelineDate}
              dateRange={dateRange}
              yearMarks={yearMarks}
              todayMs={todayMs}
            />
          )}

          {/* Row 2: Filters */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              flexWrap: "wrap",
              width: "100%",
              pt: 0.5,
            }}
          >
            <MaterialSymbol icon="filter_alt" size={18} color="#999" />
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontWeight: 600 }}
            >
              Filters:
            </Typography>

            {orgOptions.length > 0 && (
              <FilterSelect
                label="Organization"
                options={orgOptions}
                value={filterOrgs}
                onChange={setFilterOrgs}
              />
            )}

            {selectFields
              .filter((f) => f.options && f.options.length > 0)
              .slice(0, 5)
              .map((f) => (
                <FilterSelect
                  key={f.key}
                  label={f.label}
                  options={(f.options || []).map((o) => ({
                    key: o.key,
                    label: o.label,
                    color: o.color || KNOWN_COLORS[f.key]?.[o.key]?.color,
                  }))}
                  value={attrFilters[f.key] || []}
                  onChange={(v) =>
                    setAttrFilters((prev) => ({ ...prev, [f.key]: v }))
                  }
                />
              ))}

            {hasActiveFilters && (
              <Chip
                size="small"
                label="Clear all"
                variant="outlined"
                onDelete={clearFilters}
                sx={{ fontSize: "0.72rem" }}
              />
            )}
          </Box>
        </>
      }
      legend={
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            flexWrap: "wrap",
          }}
        >
          {/* Summary stats */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 3 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <MaterialSymbol icon="apps" size={16} color="#1976d2" />
              <Typography variant="caption" color="text.secondary">
                <strong>{stats.total}</strong> applications
              </Typography>
            </Box>
            {stats.withEol > 0 && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <MaterialSymbol icon="warning" size={16} color="#e65100" />
                <Typography variant="caption" color="text.secondary">
                  <strong>{stats.withEol}</strong> with EOL
                </Typography>
              </Box>
            )}
            {ungrouped.length > 0 && (
              <Chip
                size="small"
                label={`${ungrouped.length} ungrouped`}
                color="warning"
                variant="outlined"
                sx={{ fontSize: "0.72rem" }}
              />
            )}
          </Box>

          {/* Color legend */}
          {colorBy && colorLegend && colorLegend.length > 0 && (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                ml: 2,
              }}
            >
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontWeight: 600 }}
              >
                {colorByOptions.find((o) => o.key === colorBy)?.label}:
              </Typography>
              {colorLegend.map((item) => (
                <Box
                  key={item.label}
                  sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
                >
                  <Box
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      bgcolor: item.color,
                      flexShrink: 0,
                    }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {item.label}
                  </Typography>
                </Box>
              ))}
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    bgcolor: UNSET_COLOR,
                    flexShrink: 0,
                  }}
                />
                <Typography variant="caption" color="text.secondary">
                  Not set
                </Typography>
              </Box>
            </Box>
          )}
        </Box>
      }
    >
      {view === "chart" ? (
        <>
          {groups.length === 0 && ungrouped.length === 0 ? (
            <Box sx={{ py: 8, textAlign: "center" }}>
              <Typography color="text.secondary">
                {hasActiveFilters
                  ? "No applications match current filters."
                  : "No applications found. Create applications to see the portfolio."}
              </Typography>
            </Box>
          ) : (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {/* Group cards grid */}
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: {
                    xs: "1fr",
                    sm: "1fr 1fr",
                    md: "1fr 1fr 1fr",
                    lg: "1fr 1fr 1fr 1fr",
                  },
                  gap: 2,
                }}
              >
                {groups.map((g) => (
                  <GroupCard
                    key={g.key}
                    group={g}
                    colorBy={colorBy}
                    selectFields={selectFields}
                    totalApps={stats.total}
                    onGroupClick={handleGroupClick}
                    onAppClick={handleAppClick}
                  />
                ))}
              </Box>

              {/* Ungrouped section */}
              {ungrouped.length > 0 && (
                <Box
                  sx={{
                    border: "1px dashed #ccc",
                    borderRadius: 2,
                    overflow: "hidden",
                  }}
                >
                  <Box
                    sx={{
                      p: 1.5,
                      bgcolor: "#fafafa",
                      borderBottom: "1px dashed #ccc",
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      cursor: "pointer",
                      "&:hover": { bgcolor: "#f5f5f5" },
                    }}
                    onClick={() =>
                      setDrawer({
                        label: `Ungrouped (not linked to any ${groupByLabel})`,
                        apps: ungrouped,
                      })
                    }
                  >
                    <MaterialSymbol
                      icon="help_outline"
                      size={18}
                      color="#999"
                    />
                    <Typography
                      variant="subtitle2"
                      sx={{ fontWeight: 600, color: "#666", flex: 1 }}
                    >
                      Not assigned to any {groupByLabel}
                    </Typography>
                    <Chip
                      size="small"
                      label={`${ungrouped.length} apps`}
                      sx={{
                        height: 22,
                        fontSize: "0.72rem",
                        bgcolor: "#fff3e0",
                        color: "#e65100",
                        fontWeight: 600,
                      }}
                    />
                  </Box>
                  <Box
                    sx={{
                      p: 1.5,
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 0.5,
                    }}
                  >
                    {ungrouped
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((app) => (
                        <AppChip
                          key={app.id}
                          app={app}
                          colorBy={colorBy}
                          selectFields={selectFields}
                          onClick={() => handleAppClick(app.id)}
                        />
                      ))}
                  </Box>
                </Box>
              )}
            </Box>
          )}
        </>
      ) : (
        /* Table view */
        <Paper variant="outlined" sx={{ overflow: "auto" }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>
                  <TableSortLabel
                    active={sortK === "name"}
                    direction={sortK === "name" ? sortD : "asc"}
                    onClick={() => tableSort("name")}
                  >
                    Name
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortK === "subtype"}
                    direction={sortK === "subtype" ? sortD : "asc"}
                    onClick={() => tableSort("subtype")}
                  >
                    Subtype
                  </TableSortLabel>
                </TableCell>
                {groupByMode.kind === "attribute" && (
                  <TableCell>
                    <TableSortLabel
                      active={sortK === groupByMode.fieldKey}
                      direction={
                        sortK === groupByMode.fieldKey ? sortD : "asc"
                      }
                      onClick={() => tableSort(groupByMode.fieldKey)}
                    >
                      {groupByLabel}
                    </TableSortLabel>
                  </TableCell>
                )}
                {groupByMode.kind === "relation" && (
                  <TableCell>{groupByLabel}</TableCell>
                )}
                {colorBy && (
                  <TableCell>
                    <TableSortLabel
                      active={sortK === colorBy}
                      direction={sortK === colorBy ? sortD : "asc"}
                      onClick={() => tableSort(colorBy)}
                    >
                      {colorByOptions.find((o) => o.key === colorBy)?.label ||
                        "Color"}
                    </TableSortLabel>
                  </TableCell>
                )}
              </TableRow>
            </TableHead>
            <TableBody>
              {tableSorted.map((app) => {
                const attrs = app.attributes || {};
                const groupVal =
                  groupByMode.kind === "attribute"
                    ? (() => {
                        const val = attrs[groupByMode.fieldKey] as string;
                        const fd = selectFields.find(
                          (f) => f.key === groupByMode.fieldKey,
                        );
                        return (
                          fd?.options?.find((o) => o.key === val)?.label ||
                          val ||
                          "\u2014"
                        );
                      })()
                    : app.relations
                        .filter(
                          (r) => r.related_type === groupByMode.typeKey,
                        )
                        .map((r) => r.related_name)
                        .join(", ") || "\u2014";
                const colorVal = colorBy
                  ? getAppColorLabel(app, colorBy, selectFields) || "\u2014"
                  : null;
                const colorDot = colorBy
                  ? getAppColor(app, colorBy, selectFields)
                  : null;

                return (
                  <TableRow
                    key={app.id}
                    hover
                    sx={{ cursor: "pointer" }}
                    onClick={() => navigate(`/cards/${app.id}`)}
                  >
                    <TableCell sx={{ fontWeight: 500 }}>
                      {app.name}
                    </TableCell>
                    <TableCell>{app.subtype || "\u2014"}</TableCell>
                    <TableCell>{groupVal}</TableCell>
                    {colorBy && (
                      <TableCell>
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 0.5,
                          }}
                        >
                          <Box
                            sx={{
                              width: 10,
                              height: 10,
                              borderRadius: "50%",
                              bgcolor: colorDot,
                            }}
                          />
                          {colorVal}
                        </Box>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Paper>
      )}

      {/* Detail drawer */}
      <Drawer
        anchor="right"
        open={!!drawer}
        onClose={() => setDrawer(null)}
        PaperProps={{ sx: { width: { xs: "100%", sm: 420 } } }}
      >
        {drawer && (
          <Box sx={{ p: 2 }}>
            <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
              <Typography variant="h6" sx={{ fontWeight: 700, flex: 1 }}>
                {drawer.label}
              </Typography>
              <IconButton onClick={() => setDrawer(null)}>
                <MaterialSymbol icon="close" size={20} />
              </IconButton>
            </Box>

            {/* Summary metrics */}
            <Box sx={{ display: "flex", gap: 3, mb: 2 }}>
              <Box sx={{ textAlign: "center", minWidth: 80 }}>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  {drawer.apps.length}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Applications
                </Typography>
              </Box>
              {drawer.apps.filter((a) => a.lifecycle?.endOfLife).length > 0 && (
                <Box sx={{ textAlign: "center", minWidth: 80 }}>
                  <Typography variant="h6" sx={{ fontWeight: 700, color: "#e65100" }}>
                    {drawer.apps.filter((a) => a.lifecycle?.endOfLife).length}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    EOL Risk
                  </Typography>
                </Box>
              )}
            </Box>

            {/* Application list */}
            <Typography
              variant="subtitle2"
              sx={{ fontWeight: 600, mb: 1 }}
            >
              Applications ({drawer.apps.length})
            </Typography>
            <List dense>
              {drawer.apps
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((a) => {
                  const attrs = a.attributes || {};
                  const critVal = attrs.businessCriticality as
                    | string
                    | undefined;
                  const timeVal = attrs.timeModel as string | undefined;
                  return (
                    <ListItemButton
                      key={a.id}
                      onClick={() => handleAppClick(a.id)}
                    >
                      <ListItemText
                        primary={a.name}
                        secondary={
                          [
                            a.subtype,
                            critVal &&
                              KNOWN_COLORS.businessCriticality?.[critVal]
                                ?.label,
                            timeVal &&
                              KNOWN_COLORS.timeModel?.[timeVal]?.label,
                            a.lifecycle?.endOfLife &&
                              `EOL: ${a.lifecycle.endOfLife}`,
                          ]
                            .filter(Boolean)
                            .join(" \u00B7 ") || undefined
                        }
                      />
                      {colorBy && (
                        <Box
                          sx={{
                            width: 12,
                            height: 12,
                            borderRadius: "50%",
                            bgcolor: getAppColor(a, colorBy, selectFields),
                            flexShrink: 0,
                            ml: 1,
                          }}
                        />
                      )}
                      {a.lifecycle?.endOfLife && (
                        <MaterialSymbol
                          icon="warning"
                          size={16}
                          color="#e65100"
                        />
                      )}
                    </ListItemButton>
                  );
                })}
              {drawer.apps.length === 0 && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ py: 2, textAlign: "center" }}
                >
                  No applications in this group
                </Typography>
              )}
            </List>
          </Box>
        )}
      </Drawer>
      <SaveReportDialog
        open={saved.saveDialogOpen}
        onClose={() => saved.setSaveDialogOpen(false)}
        reportType="portfolio"
        config={getConfig()}
      />
    </ReportShell>
  );
}
