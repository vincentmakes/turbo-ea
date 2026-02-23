import { useEffect, useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { alpha, useTheme } from "@mui/material/styles";
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
import FilterSelect, { EMPTY_FILTER_KEY } from "@/components/FilterSelect";
import MaterialSymbol from "@/components/MaterialSymbol";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useSavedReport } from "@/hooks/useSavedReport";
import { useThumbnailCapture } from "@/hooks/useThumbnailCapture";
import { useTimeline } from "@/hooks/useTimeline";

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

const UNSET_COLOR = "#9e9e9e";
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

function isLightColor(hex: string): boolean {
  const c = hex.replace("#", "");
  if (c.length < 6) return true;
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 160;
}

/* ------------------------------------------------------------------ */
/*  Filter helpers                                                     */
/* ------------------------------------------------------------------ */

interface FilterState {
  attributeFilters: Record<string, string[]>;
  relationFilters: Record<string, string[]>;
  timelineDate: number;
  search: string;
}

function matchesFilters(
  app: AppData,
  filters: FilterState,
): boolean {
  if (!isAppAliveAtDate(app, filters.timelineDate)) return false;
  // Attribute filters
  const attrs = app.attributes || {};
  for (const [key, vals] of Object.entries(filters.attributeFilters)) {
    if (vals.length === 0) continue;
    const v = attrs[key] as string | undefined;
    const isEmpty = v === undefined || v === null || v === "";
    const wantEmpty = vals.includes(EMPTY_FILTER_KEY);
    const realVals = vals.filter((x) => x !== EMPTY_FILTER_KEY);
    if (wantEmpty && isEmpty) continue;
    if (realVals.length > 0 && realVals.includes(v as string)) continue;
    return false;
  }
  // Relation filters (e.g. Organization, Platform, etc.)
  for (const [typeKey, ids] of Object.entries(filters.relationFilters)) {
    if (ids.length === 0) continue;
    const appRels = app.relations.filter((r) => r.related_type === typeKey);
    const wantEmpty = ids.includes(EMPTY_FILTER_KEY);
    const realIds = ids.filter((x) => x !== EMPTY_FILTER_KEY);
    if (wantEmpty && appRels.length === 0) continue;
    if (realIds.length > 0 && appRels.some((r) => realIds.includes(r.related_id))) continue;
    return false;
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
  onGroupClick,
  onAppClick,
}: {
  group: GroupData;
  colorBy: string;
  selectFields: FieldDef[];
  onGroupClick: (g: GroupData) => void;
  onAppClick: (id: string) => void;
}) {
  const { t } = useTranslation(["reports"]);
  const count = group.apps.length;

  /* Build color-by distribution for the stacked bar */
  const colorSegments = useMemo(() => {
    if (!colorBy || count === 0) return [];
    const fd = selectFields.find((f) => f.key === colorBy);
    const counts = new Map<string, { color: string; label: string; n: number }>();
    for (const app of group.apps) {
      const val = (app.attributes || {})[colorBy] as string | undefined;
      const optKey = val || "__unset__";
      if (!counts.has(optKey)) {
        const opt = val ? fd?.options?.find((o) => o.key === val) : undefined;
        counts.set(optKey, {
          color: opt?.color || UNSET_COLOR,
          label: opt?.label || "Not set",
          n: 0,
        });
      }
      counts.get(optKey)!.n += 1;
    }
    return Array.from(counts.values()).filter((s) => s.n > 0);
  }, [colorBy, count, group.apps, selectFields]);

  return (
    <Box
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 2,
        overflow: "hidden",
        bgcolor: "background.paper",
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
          bgcolor: "action.hover",
          borderBottom: count > 0 ? 1 : "none",
          borderColor: "divider",
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
          label={t("portfolio.apps", { count })}
          sx={{
            height: 22,
            fontSize: "0.72rem",
            fontWeight: 600,
            bgcolor: count > 0
              ? (t) => alpha(t.palette.primary.main, 0.08)
              : "action.hover",
            color: count > 0 ? "primary.dark" : "text.disabled",
          }}
        />
      </Box>

      {/* Color-by stacked bar */}
      {colorSegments.length > 0 && (
        <Tooltip
          title={colorSegments
            .map((s) => `${s.label}: ${s.n} (${Math.round((s.n / count) * 100)}%)`)
            .join(" · ")}
        >
          <Box sx={{ height: 6, display: "flex" }}>
            {colorSegments.map((s, i) => (
              <Box
                key={i}
                sx={{
                  height: "100%",
                  width: `${(s.n / count) * 100}%`,
                  bgcolor: s.color,
                  transition: "width 0.3s",
                }}
              />
            ))}
          </Box>
        </Tooltip>
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

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function PortfolioReport() {
  const { t } = useTranslation(["reports", "common"]);
  const theme = useTheme();
  const { types: metamodelTypes } = useMetamodel();
  const saved = useSavedReport("portfolio");
  const { chartRef, thumbnail, captureAndSave } = useThumbnailCapture(() => saved.setSaveDialogOpen(true));

  // Data
  const [data, setData] = useState<ApiResponse | null>(null);
  const [drawer, setDrawer] = useState<DrawerData | null>(null);
  const [sidePanelCardId, setSidePanelCardId] = useState<string | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");

  // Controls — defaults are set dynamically after data loads
  const [groupByRaw, setGroupByRaw] = useState("");
  const [colorBy, setColorBy] = useState("");
  const [search, setSearch] = useState("");
  const [defaultsApplied, setDefaultsApplied] = useState(false);

  // Filters
  const [attrFilters, setAttrFilters] = useState<Record<string, string[]>>({});
  const [relationFilters, setRelationFilters] = useState<Record<string, string[]>>({});
  const [showAllRelFilters, setShowAllRelFilters] = useState(false);

  // Timeline
  const tl = useTimeline();

  // Table sort
  const [sortK, setSortK] = useState("name");
  const [sortD, setSortD] = useState<"asc" | "desc">("asc");

  // Load saved report config
  useEffect(() => {
    const cfg = saved.consumeConfig();
    tl.restore(cfg?.timelineDate as number | undefined);
    if (cfg) {
      if (cfg.view) setView(cfg.view as "chart" | "table");
      if (cfg.groupByRaw) setGroupByRaw(cfg.groupByRaw as string);
      if (cfg.colorBy != null) setColorBy(cfg.colorBy as string);
      if (cfg.search != null) setSearch(cfg.search as string);
      if (cfg.attrFilters) setAttrFilters(cfg.attrFilters as Record<string, string[]>);
      if (cfg.relationFilters) setRelationFilters(cfg.relationFilters as Record<string, string[]>);
      // Backwards compat: old saved configs may have filterOrgs
      if (cfg.filterOrgs) setRelationFilters((prev) => ({ ...prev, Organization: cfg.filterOrgs as string[] }));
      if (cfg.sortK) setSortK(cfg.sortK as string);
      if (cfg.sortD) setSortD(cfg.sortD as "asc" | "desc");
      setDefaultsApplied(true);
    }
  }, [saved.loadedConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const getConfig = () => ({ view, groupByRaw, colorBy, search, attrFilters, relationFilters, timelineDate: tl.persistValue, sortK, sortD });

  // Auto-persist config to localStorage
  useEffect(() => {
    saved.persistConfig(getConfig());
  }, [view, groupByRaw, colorBy, search, attrFilters, relationFilters, tl.timelineDate, sortK, sortD]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset all parameters to defaults
  const handleReset = useCallback(() => {
    saved.resetAll();
    setView("chart");
    setGroupByRaw("");
    setColorBy("");
    setSearch("");
    setAttrFilters({});
    setRelationFilters({});
    setShowAllRelFilters(false);
    tl.reset();
    setSortK("name");
    setSortD("asc");
    setDefaultsApplied(false);
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Apply defaults once data is available
  useEffect(() => {
    if (!data || defaultsApplied) return;
    // Set defaults from first available options
    if (!groupByRaw && groupByOptions.length > 0) {
      setGroupByRaw(groupByOptions[0].key);
    }
    if (!colorBy && selectFields.length > 0) {
      setColorBy(selectFields[0].key);
    }
    setDefaultsApplied(true);
  }, [data, groupByOptions, selectFields, defaultsApplied]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ensure groupByRaw has a valid default
  const groupByKey = useMemo(() => {
    if (groupByRaw && groupByOptions.find((o) => o.key === groupByRaw)) return groupByRaw;
    return groupByOptions[0]?.key || "";
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
      { key: "", label: t("portfolio.noColor") },
    ];
    for (const f of selectFields) {
      opts.push({ key: f.key, label: f.label });
    }
    return opts;
  }, [selectFields, t]);

  // Timeline range
  const { dateRange, yearMarks, hasLifecycleData } = useMemo(() => {
    const now = tl.todayMs;
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
  }, [data, tl.todayMs]);

  // Build filters state
  const filters = useMemo<FilterState>(
    () => ({
      attributeFilters: attrFilters,
      relationFilters,
      timelineDate: tl.timelineDate,
      search,
    }),
    [attrFilters, relationFilters, tl.timelineDate, search],
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

  // Color-by distribution for the ungrouped section
  const ungroupedColorSegments = useMemo(() => {
    if (!colorBy || ungrouped.length === 0) return [];
    const fd = selectFields.find((f) => f.key === colorBy);
    const counts = new Map<string, { color: string; label: string; n: number }>();
    for (const app of ungrouped) {
      const val = (app.attributes || {})[colorBy] as string | undefined;
      const optKey = val || "__unset__";
      if (!counts.has(optKey)) {
        const opt = val ? fd?.options?.find((o) => o.key === val) : undefined;
        counts.set(optKey, {
          color: opt?.color || UNSET_COLOR,
          label: opt?.label || "Not set",
          n: 0,
        });
      }
      counts.get(optKey)!.n += 1;
    }
    return Array.from(counts.values()).filter((s) => s.n > 0);
  }, [colorBy, ungrouped, selectFields]);

  // Summary stats
  const stats = useMemo(() => {
    const total = filteredApps.length;
    const withEol = filteredApps.filter(
      (a) => a.lifecycle?.endOfLife,
    ).length;
    return { total, withEol };
  }, [filteredApps]);

  // Color legend — built dynamically from schema
  const colorLegend = useMemo(() => {
    if (!colorBy) return null;
    const fd = selectFields.find((f) => f.key === colorBy);
    if (!fd?.options) return null;
    return fd.options
      .filter((o) => o.color)
      .map((o) => ({ label: o.label, color: o.color! }));
  }, [colorBy, selectFields]);

  const hasActiveFilters =
    Object.values(attrFilters).some((v) => v.length > 0) ||
    Object.values(relationFilters).some((v) => v.length > 0) ||
    search.length > 0;

  const clearFilters = useCallback(() => {
    setAttrFilters({});
    setRelationFilters({});
    setSearch("");
    tl.reset();
  }, [tl]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAppClick = useCallback((id: string) => {
    setDrawer(null);
    setSidePanelCardId(id);
  }, []);

  const handleGroupClick = useCallback((g: GroupData) => {
    setDrawer({ label: g.label, apps: g.apps });
  }, []);

  // Build relation filter options from groupable_types
  const relationFilterOptions = useMemo(() => {
    if (!data) return [];
    const out: { typeKey: string; label: string; icon: string; options: { key: string; label: string }[] }[] = [];
    for (const [typeKey, members] of Object.entries(data.groupable_types)) {
      if (members.length === 0) continue;
      const typeMeta = metamodelTypes.find((t) => t.key === typeKey);
      out.push({
        typeKey,
        label: typeMeta?.label || typeKey,
        icon: typeMeta?.icon || "link",
        options: members.map((m) => ({ key: m.id, label: m.name })),
      });
    }
    return out;
  }, [data, metamodelTypes]);

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

  const groupByLabel =
    groupByOptions.find((o) => o.key === groupByKey)?.label || t("common.group");

  const colorByLabel = colorByOptions.find((o) => o.key === colorBy)?.label || "";
  const activeFilterCount = Object.values(attrFilters).flat().length + Object.values(relationFilters).flat().length;

  const printParams = useMemo(() => {
    const params: { label: string; value: string }[] = [];
    params.push({ label: t("portfolio.groupBy"), value: groupByLabel });
    if (colorBy) params.push({ label: t("common.colorBy"), value: colorByLabel });
    if (search) params.push({ label: t("common.search"), value: search });
    if (tl.printParam) params.push(tl.printParam);
    if (view === "table") params.push({ label: t("common.view"), value: t("common.table") });
    if (activeFilterCount > 0) params.push({ label: t("common.filters"), value: t("common.filtersActive", { count: activeFilterCount }) });
    return params;
  }, [groupByLabel, colorBy, colorByLabel, search, tl.printParam, view, activeFilterCount, t]);

  if (!data)
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );

  return (
    <ReportShell
      title={t("portfolio.title")}
      icon="dashboard"
      iconColor="#0f7eb5"
      view={view}
      onViewChange={setView}
      chartRef={chartRef}
      onSaveReport={captureAndSave}
      savedReportName={saved.savedReportName ?? undefined}
      onResetSavedReport={saved.resetSavedReport}
      onReset={handleReset}
      printParams={printParams}
      toolbar={
        <>
          {/* Row 1: Main controls */}
          <TextField
            select
            size="small"
            label={t("portfolio.groupBy")}
            value={groupByKey}
            onChange={(e) => setGroupByRaw(e.target.value)}
            sx={{ minWidth: 200 }}
          >
            {groupByOptions.length > 0 && (
              <MenuItem disabled sx={{ opacity: 0.6, fontSize: "0.75rem", fontWeight: 600 }}>
                {t("portfolio.attributes")}
              </MenuItem>
            )}
            {groupByOptions
              .filter((o) => o.key.startsWith("attr:"))
              .map((o) => (
                <MenuItem key={o.key} value={o.key}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <MaterialSymbol icon={o.icon} size={16} color={theme.palette.text.secondary} />
                    {o.label}
                  </Box>
                </MenuItem>
              ))}
            {groupByOptions.some((o) => o.key.startsWith("rel:")) && (
              <MenuItem disabled sx={{ opacity: 0.6, fontSize: "0.75rem", fontWeight: 600 }}>
                {t("portfolio.relatedTypes")}
              </MenuItem>
            )}
            {groupByOptions
              .filter((o) => o.key.startsWith("rel:"))
              .map((o) => (
                <MenuItem key={o.key} value={o.key}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <MaterialSymbol icon={o.icon} size={16} color={theme.palette.text.secondary} />
                    {o.label}
                  </Box>
                </MenuItem>
              ))}
          </TextField>

          <TextField
            select
            size="small"
            label={t("portfolio.colorAppsBy")}
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
            label={t("common.search")}
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
              value={tl.timelineDate}
              onChange={tl.setTimelineDate}
              dateRange={dateRange}
              yearMarks={yearMarks}
              todayMs={tl.todayMs}
            />
          )}

          {/* Row 2: Filters */}
          <Box sx={{ width: "100%", pt: 0.5 }}>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                mb: 1,
              }}
            >
              <MaterialSymbol icon="filter_alt" size={16} color="#999" />
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontWeight: 600 }}
              >
                {t("portfolio.applicationFilters")}
              </Typography>
              {hasActiveFilters && (
                <Chip
                  size="small"
                  label={t("portfolio.clearAll")}
                  variant="outlined"
                  onDelete={clearFilters}
                  sx={{ fontSize: "0.7rem", height: 22, ml: 0.5 }}
                />
              )}
            </Box>
            <Box
              sx={{
                display: "flex",
                gap: 2,
                flexWrap: "wrap",
              }}
            >
              {/* Related By section */}
              {relationFilterOptions.length > 0 && (
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    flexWrap: "wrap",
                    bgcolor: "action.hover",
                    borderRadius: 1.5,
                    px: 1.5,
                    py: 0.75,
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{ color: "text.secondary", fontWeight: 600, fontSize: "0.7rem", whiteSpace: "nowrap" }}
                  >
                    {t("portfolio.relatedBy")}
                  </Typography>
                  {relationFilterOptions.slice(0, showAllRelFilters ? undefined : 2).map((rf) => (
                    <FilterSelect
                      key={rf.typeKey}
                      label={rf.label}
                      options={rf.options}
                      value={relationFilters[rf.typeKey] || []}
                      onChange={(v) =>
                        setRelationFilters((prev) => ({ ...prev, [rf.typeKey]: v }))
                      }
                    />
                  ))}
                  {!showAllRelFilters && relationFilterOptions.length > 2 && (
                    <Tooltip title={t("portfolio.showMore", { count: relationFilterOptions.length - 2 })}>
                      <Chip
                        size="small"
                        icon={<MaterialSymbol icon="add" size={14} />}
                        label={t("portfolio.more", { count: relationFilterOptions.length - 2 })}
                        onClick={() => setShowAllRelFilters(true)}
                        sx={{
                          height: 26,
                          fontSize: "0.72rem",
                          fontWeight: 500,
                          cursor: "pointer",
                          bgcolor: "background.paper",
                          border: "1px dashed",
                          borderColor: "divider",
                          "&:hover": { bgcolor: "action.hover" },
                        }}
                      />
                    </Tooltip>
                  )}
                  {showAllRelFilters && relationFilterOptions.length > 2 && (
                    <Chip
                      size="small"
                      label={t("portfolio.less")}
                      onClick={() => setShowAllRelFilters(false)}
                      sx={{
                        height: 26,
                        fontSize: "0.72rem",
                        cursor: "pointer",
                        bgcolor: "background.paper",
                        border: 1,
                        borderColor: "divider",
                      }}
                    />
                  )}
                </Box>
              )}

              {/* Own Fields section */}
              {selectFields.filter((f) => f.options && f.options.length > 0).length > 0 && (
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    flexWrap: "wrap",
                    bgcolor: "action.hover",
                    borderRadius: 1.5,
                    px: 1.5,
                    py: 0.75,
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{ color: "text.secondary", fontWeight: 600, fontSize: "0.7rem", whiteSpace: "nowrap" }}
                  >
                    {t("portfolio.fields")}
                  </Typography>
                  {selectFields
                    .filter((f) => f.options && f.options.length > 0)
                    .map((f) => (
                      <FilterSelect
                        key={f.key}
                        label={f.label}
                        options={(f.options || []).map((o) => ({
                          key: o.key,
                          label: o.label,
                          color: o.color,
                        }))}
                        value={attrFilters[f.key] || []}
                        onChange={(v) =>
                          setAttrFilters((prev) => ({ ...prev, [f.key]: v }))
                        }
                      />
                    ))}
                </Box>
              )}
            </Box>
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
                <strong>{stats.total}</strong> {t("portfolio.applications")}
              </Typography>
            </Box>
            {stats.withEol > 0 && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <MaterialSymbol icon="warning" size={16} color="#e65100" />
                <Typography variant="caption" color="text.secondary">
                  <strong>{stats.withEol}</strong> {t("portfolio.withEol")}
                </Typography>
              </Box>
            )}
            {ungrouped.length > 0 && (
              <Chip
                size="small"
                label={`${ungrouped.length} ${t("portfolio.ungrouped")}`}
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
                  {t("portfolio.notSet")}
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
                  ? t("portfolio.noAppsFiltered")
                  : t("portfolio.noAppsEmpty")}
              </Typography>
            </Box>
          ) : (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {/* Group cards grid */}
              <Box
                className="report-print-grid-4"
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
                    onGroupClick={handleGroupClick}
                    onAppClick={handleAppClick}
                  />
                ))}
              </Box>

              {/* Ungrouped section */}
              {ungrouped.length > 0 && (
                <Box
                  sx={{
                    border: "1px dashed",
                    borderColor: "divider",
                    borderRadius: 2,
                    overflow: "hidden",
                  }}
                >
                  <Box
                    sx={{
                      p: 1.5,
                      bgcolor: "action.hover",
                      borderBottom: "1px dashed",
                      borderColor: "divider",
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      cursor: "pointer",
                      "&:hover": { bgcolor: "action.selected" },
                    }}
                    onClick={() =>
                      setDrawer({
                        label: t("portfolio.ungroupedLabel", { groupBy: groupByLabel }),
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
                      sx={{ fontWeight: 600, color: "text.secondary", flex: 1 }}
                    >
                      {t("portfolio.notAssignedTo", { groupBy: groupByLabel })}
                    </Typography>
                    <Chip
                      size="small"
                      label={t("portfolio.apps", { count: ungrouped.length })}
                      sx={{
                        height: 22,
                        fontSize: "0.72rem",
                        bgcolor: (t) => alpha(t.palette.warning.main, 0.12),
                        color: "warning.dark",
                        fontWeight: 600,
                      }}
                    />
                  </Box>
                  {/* Color-by stacked bar */}
                  {ungroupedColorSegments.length > 0 && (
                    <Tooltip
                      title={ungroupedColorSegments
                        .map(
                          (s) =>
                            `${s.label}: ${s.n} (${Math.round((s.n / ungrouped.length) * 100)}%)`,
                        )
                        .join(" · ")}
                    >
                      <Box sx={{ height: 6, display: "flex" }}>
                        {ungroupedColorSegments.map((s, i) => (
                          <Box
                            key={i}
                            sx={{
                              height: "100%",
                              width: `${(s.n / ungrouped.length) * 100}%`,
                              bgcolor: s.color,
                              transition: "width 0.3s",
                            }}
                          />
                        ))}
                      </Box>
                    </Tooltip>
                  )}
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
                    {t("common:labels.name")}
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortK === "subtype"}
                    direction={sortK === "subtype" ? sortD : "asc"}
                    onClick={() => tableSort("subtype")}
                  >
                    {t("common:labels.subtype")}
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
                    onClick={() => setSidePanelCardId(app.id)}
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
                  {t("portfolio.applications")}
                </Typography>
              </Box>
              {drawer.apps.filter((a) => a.lifecycle?.endOfLife).length > 0 && (
                <Box sx={{ textAlign: "center", minWidth: 80 }}>
                  <Typography variant="h6" sx={{ fontWeight: 700, color: "#e65100" }}>
                    {drawer.apps.filter((a) => a.lifecycle?.endOfLife).length}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t("portfolio.eolRisk")}
                  </Typography>
                </Box>
              )}
            </Box>

            {/* Application list */}
            <Typography
              variant="subtitle2"
              sx={{ fontWeight: 600, mb: 1 }}
            >
              {t("portfolio.applications")} ({drawer.apps.length})
            </Typography>
            <List dense>
              {drawer.apps
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((a) => {
                  // Build secondary text dynamically from active color/group fields
                  const parts: string[] = [];
                  if (a.subtype) parts.push(a.subtype);
                  if (colorBy) {
                    const lbl = getAppColorLabel(a, colorBy, selectFields);
                    if (lbl && lbl !== "Not set") parts.push(lbl);
                  }
                  if (a.lifecycle?.endOfLife) parts.push(`EOL: ${a.lifecycle.endOfLife}`);

                  return (
                    <ListItemButton
                      key={a.id}
                      onClick={() => handleAppClick(a.id)}
                    >
                      <ListItemText
                        primary={a.name}
                        secondary={parts.join(" \u00B7 ") || undefined}
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
                  {t("portfolio.noAppsInGroup")}
                </Typography>
              )}
            </List>
          </Box>
        )}
      </Drawer>
      <CardDetailSidePanel
        cardId={sidePanelCardId}
        open={!!sidePanelCardId}
        onClose={() => setSidePanelCardId(null)}
      />
      <SaveReportDialog
        open={saved.saveDialogOpen}
        onClose={() => saved.setSaveDialogOpen(false)}
        reportType="portfolio"
        config={getConfig()}
        thumbnail={thumbnail}
      />
    </ReportShell>
  );
}
