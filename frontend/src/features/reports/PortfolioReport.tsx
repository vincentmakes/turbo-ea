import { useEffect, useRef, useState, useMemo, useCallback } from "react";
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
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import Collapse from "@mui/material/Collapse";
import LinearProgress from "@mui/material/LinearProgress";
import ReportShell from "./ReportShell";
import SaveReportDialog from "./SaveReportDialog";
import TimelineSlider from "@/components/TimelineSlider";
import FilterSelect from "@/components/FilterSelect";
import TagPicker from "@/components/TagPicker";
import type { TagGroup } from "@/types";
import MaterialSymbol from "@/components/MaterialSymbol";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useSavedReport } from "@/hooks/useSavedReport";
import { useThumbnailCapture } from "@/hooks/useThumbnailCapture";
import { useTimeline } from "@/hooks/useTimeline";
import {
  useTypeLabel,
  useRelationLabel,
  useFieldLabel,
  useOptionLabel,
} from "@/hooks/useResolveLabel";
import { useAiStatus } from "@/hooks/useAiStatus";
import type { PortfolioInsightsResponse, StructuredInsight } from "@/types";
import {
  appColorBucket,
  buildColorLegend,
  buildColorSegments,
  extractRelSubtypes,
  getAppColor,
  getAppColorLabel,
  LIFECYCLE_PHASES,
  matchesFilters,
  parseDate,
  pickSelectFields,
  relationMemberMatchesSubtypeFilters,
  relSubtypeComposite,
  REL_SUBTYPE_PREFIX,
  resolveColorBy,
  UNSET_COLOR,
} from "./portfolioHelpers";
import type {
  AppData,
  ColorLabels,
  ColorResolution,
  FieldDef,
  FilterState,
  RelSubtype,
  RelTypeDef,
  SectionDef,
  TagGroupDef,
} from "./portfolioHelpers";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

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
  tag_groups?: TagGroupDef[];
}

interface GroupData {
  key: string;
  label: string;
  apps: AppData[];
}

interface DrawerData {
  label: string;
  apps: AppData[];
  /** Related card id this group represents, for per-member subtype colouring. */
  memberId?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function isLightColor(hex: string): boolean {
  const c = hex.replace("#", "");
  if (c.length < 6) return true;
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 160;
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
  // When grouping by a related type, only place a card under a member for which
  // this returns true. Used to honour relation-subtype filters per group-member
  // (e.g. "Owner" shows an app under an org only if that org owns it).
  memberMatch?: (app: AppData, memberId: string) => boolean,
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
    const seen = new Set<string>();
    for (const rel of app.relations) {
      if (rel.related_type !== mode.typeKey) continue;
      if (!buckets.has(rel.related_id) || seen.has(rel.related_id)) continue;
      if (memberMatch && !memberMatch(app, rel.related_id)) continue;
      seen.add(rel.related_id);
      buckets.get(rel.related_id)!.push(app);
      grouped.add(app.id);
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
  colorRes,
  colorLabels,
  colorMemberId,
  onClick,
}: {
  app: AppData;
  colorRes: ColorResolution;
  colorLabels: ColorLabels;
  colorMemberId?: string;
  onClick: () => void;
}) {
  const color = getAppColor(app, colorRes, colorLabels, colorMemberId);
  const colorLabel = getAppColorLabel(app, colorRes, colorLabels, colorMemberId);
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
  colorRes,
  colorLabels,
  colorMemberId,
  onGroupClick,
  onAppClick,
  countLabel,
}: {
  group: GroupData;
  colorRes: ColorResolution;
  colorLabels: ColorLabels;
  /** Related card id this group represents, when colouring per group-member. */
  colorMemberId?: string;
  onGroupClick: (g: GroupData) => void;
  onAppClick: (id: string) => void;
  countLabel: (count: number) => string;
}) {
  const count = group.apps.length;

  /* Build color-by distribution for the stacked bar */
  const colorSegments = useMemo(
    () => buildColorSegments(group.apps, colorRes, colorLabels, colorMemberId),
    [group.apps, colorRes, colorLabels, colorMemberId],
  );

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
          label={countLabel(count)}
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
                colorRes={colorRes}
                colorLabels={colorLabels}
                colorMemberId={colorMemberId}
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

interface PortfolioReportProps {
  /** Card type key to load. Defaults to "Application" for the legacy
   * Application Portfolio route. */
  initialCardType?: string;
  /** When true, render a card-type picker in the toolbar so the user can
   * switch between any visible card type — used by the Flexible Portfolio. */
  showTypeSelector?: boolean;
  /** Distinct key for saved-report persistence so the Application Portfolio
   * and Flexible Portfolio keep independent localStorage state. */
  savedReportKey?: string;
  /** Title override (defaults to the resolved card type label, then to the
   * generic Application Portfolio title for backwards compatibility). */
  titleOverride?: string;
}

export default function PortfolioReport({
  initialCardType = "Application",
  showTypeSelector = false,
  savedReportKey = "portfolio",
  titleOverride,
}: PortfolioReportProps = {}) {
  const { t } = useTranslation(["reports", "common"]);
  const theme = useTheme();
  const { types: metamodelTypes } = useMetamodel();
  const typeLabel = useTypeLabel();
  const relLabel = useRelationLabel();
  const fieldLabel = useFieldLabel();
  const optLabel = useOptionLabel();
  const saved = useSavedReport(savedReportKey);
  const { chartRef, thumbnail, captureAndSave } = useThumbnailCapture(() => saved.setSaveDialogOpen(true));

  // Data
  const [cardType, setCardType] = useState<string>(initialCardType);
  const [data, setData] = useState<ApiResponse | null>(null);
  // Tracks the card type that the currently-loaded `data` belongs to. Used to
  // gate the defaults- and persist-effects so they don't fire while data is
  // stale (between picking a new type and the fresh fetch resolving).
  const [dataCardType, setDataCardType] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerData | null>(null);
  const [sidePanelCardId, setSidePanelCardId] = useState<string | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");

  // AI insights
  const { aiStatus } = useAiStatus();
  const [aiInsights, setAiInsights] = useState<PortfolioInsightsResponse | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiOpen, setAiOpen] = useState(false);

  // Controls — defaults are set dynamically after data loads
  const [groupByRaw, setGroupByRaw] = useState("");
  const [colorBy, setColorBy] = useState("");
  const [search, setSearch] = useState("");
  const [defaultsApplied, setDefaultsApplied] = useState(false);

  // Filters
  const [attrFilters, setAttrFilters] = useState<Record<string, string[]>>({});
  const [relationFilters, setRelationFilters] = useState<Record<string, string[]>>({});
  // Keyed by RelSubtype.composite (`relTypeKey::fieldKey`).
  const [relSubtypeFilters, setRelSubtypeFilters] = useState<Record<string, string[]>>({});
  const [tagFilterIds, setTagFilterIds] = useState<string[]>([]);
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
      if (showTypeSelector && cfg.cardType) setCardType(cfg.cardType as string);
      if (cfg.view) setView(cfg.view as "chart" | "table");
      if (cfg.groupByRaw) setGroupByRaw(cfg.groupByRaw as string);
      if (cfg.colorBy != null) setColorBy(cfg.colorBy as string);
      if (cfg.search != null) setSearch(cfg.search as string);
      if (cfg.attrFilters) setAttrFilters(cfg.attrFilters as Record<string, string[]>);
      if (cfg.relationFilters) setRelationFilters(cfg.relationFilters as Record<string, string[]>);
      if (cfg.relSubtypeFilters)
        setRelSubtypeFilters(cfg.relSubtypeFilters as Record<string, string[]>);
      // Migrate prior `{groupId: tagIds[]}` shape to a flat `string[]`
      if (cfg.tagFilterIds) {
        setTagFilterIds(cfg.tagFilterIds as string[]);
      } else if (cfg.tagFilters && typeof cfg.tagFilters === "object") {
        const flat: string[] = [];
        for (const vals of Object.values(cfg.tagFilters as Record<string, string[]>)) {
          if (Array.isArray(vals)) flat.push(...vals);
        }
        setTagFilterIds(flat);
      }
      // Backwards compat: old saved configs may have filterOrgs
      if (cfg.filterOrgs) setRelationFilters((prev) => ({ ...prev, Organization: cfg.filterOrgs as string[] }));
      if (cfg.sortK) setSortK(cfg.sortK as string);
      if (cfg.sortD) setSortD(cfg.sortD as "asc" | "desc");
      setDefaultsApplied(true);
    }
  }, [saved.loadedConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const getConfig = () => ({ cardType, view, groupByRaw, colorBy, search, attrFilters, relationFilters, relSubtypeFilters, tagFilterIds, timelineDate: tl.persistValue, sortK, sortD });

  // Auto-persist config to localStorage. Skip the very first run so that on
  // mount we don't overwrite a previously-saved config with the initial
  // defaults (the consume-config effect runs alongside this one but its state
  // updates have not yet flushed when this closure is first invoked). Also
  // skip while data is stale (between switching card types and the new fetch
  // resolving) — otherwise we'd persist transient empty groupByRaw/colorBy
  // that would prevent defaults from re-applying on the next load.
  const skipFirstPersistRef = useRef(true);
  useEffect(() => {
    if (skipFirstPersistRef.current) {
      skipFirstPersistRef.current = false;
      return;
    }
    if (dataCardType !== cardType) return;
    saved.persistConfig(getConfig());
  }, [cardType, dataCardType, view, groupByRaw, colorBy, search, attrFilters, relationFilters, relSubtypeFilters, tagFilterIds, tl.timelineDate, sortK, sortD]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset all parameters to defaults
  const handleReset = useCallback(() => {
    saved.resetAll();
    setCardType(initialCardType);
    setView("chart");
    setGroupByRaw("");
    setColorBy("");
    setSearch("");
    setAttrFilters({});
    setRelationFilters({});
    setRelSubtypeFilters({});
    setTagFilterIds([]);
    setShowAllRelFilters(false);
    tl.reset();
    setSortK("name");
    setSortD("asc");
    setDefaultsApplied(false);
  }, [saved, initialCardType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch data — refetches whenever the user picks a different card type.
  useEffect(() => {
    let cancelled = false;
    const fetchedFor = cardType;
    setData(null);
    setDataCardType(null);
    setAiInsights(null);
    setAiOpen(false);
    api
      .get<ApiResponse>(`/reports/app-portfolio?type=${encodeURIComponent(cardType)}`)
      .then((r) => {
        if (cancelled) return;
        setData(r);
        setDataCardType(fetchedFor);
      });
    return () => {
      cancelled = true;
    };
  }, [cardType]);

  // Switching card types invalidates field/relation/tag selections because
  // the keys they reference don't exist on the new type. Clear them so the
  // "Apply defaults once data is available" effect re-picks valid values.
  const handleCardTypeChange = useCallback((nextType: string) => {
    if (nextType === cardType) return;
    setCardType(nextType);
    setGroupByRaw("");
    setColorBy("");
    setAttrFilters({});
    setRelationFilters({});
    setRelSubtypeFilters({});
    setTagFilterIds([]);
    setShowAllRelFilters(false);
    setDefaultsApplied(false);
  }, [cardType]);

  // Derived data — resolve field & option labels for the current locale
  const selectFields = useMemo(() => {
    const raw = data ? pickSelectFields(data.fields_schema) : [];
    return raw.map((f) => ({
      ...f,
      label: fieldLabel(f),
      options: f.options?.map((o) => ({
        ...o,
        label: optLabel(o),
      })),
    }));
  }, [data, fieldLabel, optLabel]);

  // Relation subtypes — single_select attributes on relation types touching
  // the current card type (e.g. "is used by · Usage Type"), tagged with the
  // related card type they connect to. The active subset (scoped to the
  // current Group By, below) drives the Color By and filter controls.
  const allRelSubtypes = useMemo<RelSubtype[]>(() => {
    if (!data) return [];
    return extractRelSubtypes(data.relation_types as RelTypeDef[], cardType).map(
      ({ relType, field }) => {
        const relVerb =
          relType.source_type_key === cardType
            ? relLabel(relType)
            : relLabel(relType, true);
        const fieldVerb = fieldLabel(field);
        return {
          composite: relSubtypeComposite(relType.key, field.key),
          relTypeKey: relType.key,
          fieldKey: field.key,
          relatedTypeKey: relType.other_type_key,
          comboLabel: `${relVerb} · ${fieldVerb}`,
          options: (field.options ?? []).map((o) => ({
            ...o,
            label: optLabel(o),
          })),
        };
      },
    );
  }, [data, cardType, relLabel, fieldLabel, optLabel]);

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
        const label = typeLabel(typeMeta) || typeKey;
        const icon = typeMeta?.icon || "link";
        opts.push({ key: `rel:${typeKey}`, label, icon });
      }
    }

    return opts;
  }, [data, selectFields, metamodelTypes, typeLabel]);

  // Apply defaults once data is available. Skip when `data` is stale (loaded
  // for a previous card type) — otherwise we'd pick options from the old
  // type's schema right after the user switches types.
  useEffect(() => {
    if (!data || dataCardType !== cardType || defaultsApplied) return;
    // Set defaults from first available options
    if (!groupByRaw && groupByOptions.length > 0) {
      setGroupByRaw(groupByOptions[0].key);
    }
    if (!colorBy && selectFields.length > 0) {
      setColorBy(selectFields[0].key);
    }
    setDefaultsApplied(true);
  }, [data, dataCardType, cardType, groupByOptions, selectFields, defaultsApplied]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Relation subtypes are only meaningful relative to a related card type, so
  // we surface them only while grouping by that type. Each card chip then sits
  // under exactly one related card (the group member), which lets us colour by
  // that single relation rather than aggregating across all of them.
  const relSubtypes = useMemo<RelSubtype[]>(() => {
    if (groupByMode.kind !== "relation") return [];
    return allRelSubtypes.filter((s) => s.relatedTypeKey === groupByMode.typeKey);
  }, [allRelSubtypes, groupByMode]);

  // Color-by options: "none" + own single_select fields + relation subtypes.
  // Relation subtypes are keyed `rel:<composite>` so they never collide with a
  // card's own field key, and grouped under a "Relation Subtypes" subheader.
  const colorByOptions = useMemo(() => {
    const opts: { key: string; label: string; group: "none" | "field" | "rel" }[] = [
      { key: "", label: t("portfolio.noColor"), group: "none" },
    ];
    for (const f of selectFields) {
      opts.push({ key: f.key, label: f.label, group: "field" });
    }
    for (const s of relSubtypes) {
      opts.push({
        key: `${REL_SUBTYPE_PREFIX}${s.composite}`,
        label: s.comboLabel,
        group: "rel",
      });
    }
    return opts;
  }, [selectFields, relSubtypes, t]);

  // Changing Group By changes which relation subtypes are in scope. Drop any
  // subtype filter that no longer applies, and reset a Color By that points at
  // a now-unavailable subtype, so a stale selection can't linger invisibly.
  useEffect(() => {
    const valid = new Set(relSubtypes.map((s) => s.composite));
    setRelSubtypeFilters((prev) => {
      const next: Record<string, string[]> = {};
      let changed = false;
      for (const [k, v] of Object.entries(prev)) {
        if (valid.has(k)) next[k] = v;
        else changed = true;
      }
      return changed ? next : prev;
    });
    if (
      colorBy.startsWith(REL_SUBTYPE_PREFIX) &&
      !relSubtypes.some((s) => `${REL_SUBTYPE_PREFIX}${s.composite}` === colorBy)
    ) {
      setColorBy(selectFields[0]?.key ?? "");
    }
  }, [relSubtypes]); // eslint-disable-line react-hooks/exhaustive-deps

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
      relSubtypeFilters,
      relSubtypes,
      tagFilterIds,
      tagGroups: data?.tag_groups || [],
      timelineDate: tl.timelineDate,
      search,
    }),
    [attrFilters, relationFilters, relSubtypeFilters, relSubtypes, tagFilterIds, data, tl.timelineDate, search],
  );

  // Resolve the active Color By into a descriptor + shared bucket labels.
  const colorRes = useMemo<ColorResolution>(
    () => resolveColorBy(colorBy, selectFields, relSubtypes),
    [colorBy, selectFields, relSubtypes],
  );
  const colorLabels = useMemo<ColorLabels>(
    () => ({ notSet: t("portfolio.notSet"), multiple: t("portfolio.multiple") }),
    [t],
  );
  // When colouring by a relation subtype the report is, by construction,
  // grouped by that subtype's related type — so each chip maps to one group
  // member and is coloured by that single relation (no false "Multiple").
  const perMemberColor = colorRes.kind === "rel";

  // Filtered apps
  const filteredApps = useMemo(() => {
    if (!data) return [];
    return data.items.filter((a) => matchesFilters(a, filters));
  }, [data, filters]);

  // When grouping by a related type, honour active relation-subtype filters
  // per group-member, so a card lands only under the related cards whose
  // relationship matches (e.g. "Owner" → only under orgs that own it).
  const relMemberMatch = useCallback(
    (app: AppData, memberId: string) =>
      relationMemberMatchesSubtypeFilters(app, memberId, relSubtypeFilters, relSubtypes),
    [relSubtypeFilters, relSubtypes],
  );

  // Grouped data
  const { groups, ungrouped } = useMemo(() => {
    if (!data) return { groups: [], ungrouped: [] };
    return groupApps(filteredApps, groupByMode, selectFields, data.groupable_types, relMemberMatch);
  }, [filteredApps, groupByMode, selectFields, data, relMemberMatch]);

  // Color-by distribution for the ungrouped section
  const ungroupedColorSegments = useMemo(
    () => buildColorSegments(ungrouped, colorRes, colorLabels),
    [ungrouped, colorRes, colorLabels],
  );

  // Summary stats
  const stats = useMemo(() => {
    const total = filteredApps.length;
    const withEol = filteredApps.filter(
      (a) => a.lifecycle?.endOfLife,
    ).length;
    return { total, withEol };
  }, [filteredApps]);

  // Color legend — built dynamically from schema / relation subtype options
  const colorLegend = useMemo(
    () => buildColorLegend(colorRes, colorLabels, filteredApps),
    [colorRes, colorLabels, filteredApps],
  );

  const hasActiveFilters =
    Object.values(attrFilters).some((v) => v.length > 0) ||
    Object.values(relationFilters).some((v) => v.length > 0) ||
    Object.values(relSubtypeFilters).some((v) => v.length > 0) ||
    tagFilterIds.length > 0 ||
    search.length > 0;

  const clearFilters = useCallback(() => {
    setAttrFilters({});
    setRelationFilters({});
    setRelSubtypeFilters({});
    setTagFilterIds([]);
    setSearch("");
    tl.reset();
  }, [tl]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAppClick = useCallback((id: string) => {
    setDrawer(null);
    setSidePanelCardId(id);
  }, []);

  // AI insights handler
  const handleGenerateInsights = useCallback(async () => {
    if (!data) return;
    setAiLoading(true);
    setAiError("");
    setAiOpen(true);
    try {
      // Build attribute distributions
      const attrDist: Record<string, Record<string, number>> = {};
      for (const f of selectFields) {
        const counts: Record<string, number> = {};
        for (const app of filteredApps) {
          const v = (app.attributes || {})[f.key] as string | undefined;
          const k = v || "Not set";
          counts[k] = (counts[k] || 0) + 1;
        }
        attrDist[f.label] = counts;
      }

      // Build lifecycle phase counts
      const lcCounts: Record<string, number> = {};
      for (const app of filteredApps) {
        const lc = app.lifecycle;
        if (!lc) {
          lcCounts["No lifecycle"] = (lcCounts["No lifecycle"] || 0) + 1;
          continue;
        }
        const now = Date.now();
        const phases = ["plan", "phaseIn", "active", "phaseOut", "endOfLife"];
        let current = "Unknown";
        for (const p of phases) {
          const d = lc[p] ? new Date(lc[p]).getTime() : null;
          if (d && d <= now) current = p;
        }
        lcCounts[current] = (lcCounts[current] || 0) + 1;
      }

      // Build group summaries
      const groupSummaries = groups.map((g) => {
        const breakdown: Record<string, number> = {};
        if (colorRes.kind !== "none") {
          for (const app of g.apps) {
            const bucket = appColorBucket(app, colorRes, colorLabels);
            const k = bucket.isUnset ? "Not set" : bucket.label;
            breakdown[k] = (breakdown[k] || 0) + 1;
          }
        }
        return { name: g.label, count: g.apps.length, breakdown };
      });

      // Build human-readable filter descriptions for AI context
      const activeFilterDescs: string[] = [];
      if (search) activeFilterDescs.push(`Search: "${search}"`);
      for (const [key, vals] of Object.entries(attrFilters)) {
        if (vals.length > 0) {
          const field = selectFields.find((f) => f.key === key);
          activeFilterDescs.push(`${field?.label || key}: ${vals.join(", ")}`);
        }
      }
      if (tl.timelineDate) activeFilterDescs.push(`Timeline date: ${tl.timelineDate}`);

      const res = await api.post<PortfolioInsightsResponse>("/ai/portfolio-insights", {
        total_apps: filteredApps.length,
        group_by: groupByRaw || null,
        color_by: colorBy || null,
        groups: groupSummaries,
        attribute_summary: attrDist,
        lifecycle_summary: lcCounts,
        active_filters: activeFilterDescs,
      });
      setAiInsights(res);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setAiLoading(false);
    }
  }, [data, filteredApps, groups, selectFields, colorBy, colorRes, colorLabels, groupByRaw, attrFilters, search, tl.timelineDate, t]);

  const handleGroupClick = useCallback((g: GroupData) => {
    // g.key is the related card id for relation groups — keep it so the drawer
    // can colour chips per group-member when colouring by a relation subtype.
    setDrawer({ label: g.label, apps: g.apps, memberId: g.key });
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
        label: typeLabel(typeMeta) || typeKey,
        icon: typeMeta?.icon || "link",
        options: members.map((m) => ({ key: m.id, label: m.name })),
      });
    }
    return out;
  }, [data, metamodelTypes, typeLabel]);

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
  const activeFilterCount = Object.values(attrFilters).flat().length + Object.values(relationFilters).flat().length + Object.values(relSubtypeFilters).flat().length + tagFilterIds.length;

  // Visible card types — populates the optional type selector and resolves
  // the localised label of the currently-selected type for dynamic strings.
  const cardTypeOptions = useMemo(() => {
    return metamodelTypes
      .filter((tp) => !tp.is_hidden)
      .map((tp) => ({
        key: tp.key,
        label: typeLabel(tp),
        icon: tp.icon || "category",
        color: tp.color,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [metamodelTypes, typeLabel]);
  const currentType = metamodelTypes.find((tp) => tp.key === cardType);
  const currentTypeLabel = typeLabel(currentType) || cardType;
  const typeIcon = currentType?.icon || "dashboard";
  const typeColor = currentType?.color || "#0f7eb5";

  // Title falls back to the legacy hardcoded "Application Portfolio" string
  // when the type is Application so existing screenshots/tests stay valid.
  const resolvedTitle = titleOverride
    ? titleOverride
    : showTypeSelector
      ? t("flexiblePortfolio.titleFor", { type: currentTypeLabel })
      : cardType === "Application"
        ? t("portfolio.title")
        : t("flexiblePortfolio.titleFor", { type: currentTypeLabel });

  // Group/ungrouped count chip — "{n} apps" for the legacy Application
  // Portfolio (preserves wording); "{n} {typeLabel}" once the user picks
  // a different type so the pill matches the cards on screen.
  const countLabel = useCallback(
    (n: number) =>
      cardType === "Application"
        ? t("portfolio.apps", { count: n })
        : `${n} ${currentTypeLabel}`,
    [cardType, currentTypeLabel, t],
  );

  // Noun used after the summary stat ("12 applications" vs "12 Business
  // Process"). Application Portfolio keeps the localised plural "applications"
  // string for back-compat; other types fall back to the singular type label.
  const typeNoun =
    cardType === "Application" ? t("portfolio.applications") : currentTypeLabel;

  // Empty-state messages, parameterised by type for the Flexible Portfolio.
  const noItemsFiltered =
    cardType === "Application"
      ? t("portfolio.noAppsFiltered")
      : t("portfolio.noItemsFiltered", { type: currentTypeLabel });
  const noItemsEmpty =
    cardType === "Application"
      ? t("portfolio.noAppsEmpty")
      : t("portfolio.noItemsEmpty", { type: currentTypeLabel });
  const noItemsInGroup =
    cardType === "Application"
      ? t("portfolio.noAppsInGroup")
      : t("portfolio.noItemsInGroup", { type: currentTypeLabel });

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
      title={resolvedTitle}
      icon={typeIcon}
      iconColor={typeColor}
      paginateRowSelector="[data-export-row]"
      view={view}
      onViewChange={setView}
      chartRef={chartRef}
      onSaveReport={captureAndSave}
      savedReportName={saved.savedReportName ?? undefined}
      onResetSavedReport={saved.resetSavedReport}
      onReset={handleReset}
      printParams={printParams}
      actions={
        aiStatus.portfolio_insights_enabled ? (
          <Tooltip title={t("portfolio.aiInsights")}>
            <span>
              <IconButton
                size="small"
                onClick={() => {
                  if (aiOpen) {
                    setAiOpen(false);
                  } else if (aiInsights) {
                    setAiOpen(true);
                  } else {
                    handleGenerateInsights();
                  }
                }}
                disabled={aiLoading || filteredApps.length === 0}
                sx={{ color: aiOpen ? "primary.main" : "#1976d2" }}
              >
                {aiLoading ? (
                  <CircularProgress size={18} />
                ) : (
                  <MaterialSymbol icon="auto_awesome" size={20} />
                )}
              </IconButton>
            </span>
          </Tooltip>
        ) : undefined
      }
      toolbar={
        <>
          {/* Row 1: Main controls */}
          {showTypeSelector && (
            <TextField
              select
              size="small"
              label={t("flexiblePortfolio.cardType")}
              value={cardType}
              onChange={(e) => handleCardTypeChange(e.target.value)}
              sx={{ minWidth: 200 }}
            >
              {cardTypeOptions.map((o) => (
                <MenuItem key={o.key} value={o.key}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <MaterialSymbol icon={o.icon} size={16} color={o.color || theme.palette.text.secondary} />
                    {o.label}
                  </Box>
                </MenuItem>
              ))}
            </TextField>
          )}
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
            label={
              cardType === "Application"
                ? t("portfolio.colorAppsBy")
                : t("common.colorBy")
            }
            value={colorBy}
            onChange={(e) => setColorBy(e.target.value)}
            sx={{ minWidth: 180 }}
          >
            {colorByOptions
              .filter((o) => o.group !== "rel")
              .map((o) => (
                <MenuItem key={o.key} value={o.key}>
                  {o.label}
                </MenuItem>
              ))}
            {colorByOptions.some((o) => o.group === "rel") && (
              <MenuItem disabled sx={{ opacity: 0.6, fontSize: "0.75rem", fontWeight: 600 }}>
                {t("portfolio.relationSubtypes")}
              </MenuItem>
            )}
            {colorByOptions
              .filter((o) => o.group === "rel")
              .map((o) => (
                <MenuItem key={o.key} value={o.key}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <MaterialSymbol icon="link" size={16} color={theme.palette.text.secondary} />
                    {o.label}
                  </Box>
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
                {t("portfolio.typeFilters", { type: currentTypeLabel })}
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

              {/* Tags section */}
              {(data?.tag_groups || []).length > 0 && (
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
                    {t("portfolio.tags")}
                  </Typography>
                  <TagPicker
                    groups={(data?.tag_groups || []) as unknown as TagGroup[]}
                    value={tagFilterIds}
                    onChange={setTagFilterIds}
                    size="small"
                    label={t("portfolio.tags")}
                    placeholder=""
                    sx={{ minWidth: 180, maxWidth: 320 }}
                  />
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

              {/* Relation Subtypes section — hidden when the card type's
                  relations carry no single_select subtype attributes. */}
              {relSubtypes.length > 0 && (
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
                    {t("portfolio.relationSubtypes")}
                  </Typography>
                  {relSubtypes.map((sub) => (
                    <FilterSelect
                      key={sub.composite}
                      label={sub.comboLabel}
                      options={sub.options.map((o) => ({
                        key: o.key,
                        label: o.label,
                        color: o.color,
                      }))}
                      value={relSubtypeFilters[sub.composite] || []}
                      onChange={(v) =>
                        setRelSubtypeFilters((prev) => ({ ...prev, [sub.composite]: v }))
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
              <MaterialSymbol icon={typeIcon} size={16} color={typeColor} />
              <Typography variant="caption" color="text.secondary">
                <strong>{stats.total}</strong> {typeNoun}
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
      {/* AI Insights panel */}
      <Collapse in={aiOpen}>
        <Paper
          sx={{
            p: 2,
            mb: 2,
            border: 1,
            borderColor: "primary.main",
            bgcolor: alpha(theme.palette.primary.main, 0.03),
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
            <MaterialSymbol icon="insights" size={20} color={theme.palette.primary.main} />
            <Typography variant="subtitle2" fontWeight={700}>
              {t("portfolio.aiInsightsTitle")}
            </Typography>
            {aiInsights?.model && (
              <Chip label={aiInsights.model} size="small" variant="outlined" sx={{ ml: "auto" }} />
            )}
            <IconButton size="small" onClick={() => setAiOpen(false)} sx={{ ml: aiInsights?.model ? 0 : "auto" }}>
              <MaterialSymbol icon="close" size={18} />
            </IconButton>
          </Box>

          {aiLoading && <LinearProgress sx={{ mb: 1 }} />}

          {aiError && (
            <Alert severity="error" sx={{ mb: 1 }} onClose={() => setAiError("")}>
              {aiError}
            </Alert>
          )}

          {aiInsights && aiInsights.insights.length > 0 && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              {aiInsights.insights
                .filter((ins) => typeof ins !== "string")
                .map((insight, i) => {
                const si = insight as StructuredInsight;
                return (
                  <Paper
                    key={i}
                    variant="outlined"
                    sx={{ p: 1.5 }}
                  >
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.75 }}>
                      <MaterialSymbol icon="lightbulb" size={18} color={theme.palette.primary.main} />
                      <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }}>
                        {si.title}
                      </Typography>
                    </Box>
                    <Typography variant="body2" sx={{ mb: 0.5 }}>
                      {si.observation}
                    </Typography>
                    {si.recommendation && (
                      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.5, mt: 0.5 }}>
                        <MaterialSymbol icon="subdirectory_arrow_right" size={16} color={theme.palette.primary.main} style={{ marginTop: 2 }} />
                        <Typography variant="body2" color="primary.dark" fontWeight={500}>
                          {si.recommendation}
                        </Typography>
                      </Box>
                    )}
                  </Paper>
                );
              })}
            </Box>
          )}

          {aiInsights && aiInsights.insights.length === 0 && !aiLoading && (
            <Typography variant="body2" color="text.secondary">
              {t("portfolio.aiNoInsights")}
            </Typography>
          )}

          {aiInsights && !aiLoading && (
            <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 1 }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<MaterialSymbol icon="refresh" size={16} />}
                sx={{ textTransform: "none" }}
                onClick={handleGenerateInsights}
              >
                {t("portfolio.aiRegenerate")}
              </Button>
            </Box>
          )}
        </Paper>
      </Collapse>

      {view === "chart" ? (
        <>
          {groups.length === 0 && ungrouped.length === 0 ? (
            <Box sx={{ py: 8, textAlign: "center" }}>
              <Typography color="text.secondary">
                {hasActiveFilters ? noItemsFiltered : noItemsEmpty}
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
                  <Box key={g.key} data-export-row>
                    <GroupCard
                      group={g}
                      colorRes={colorRes}
                      colorLabels={colorLabels}
                      colorMemberId={perMemberColor ? g.key : undefined}
                      onGroupClick={handleGroupClick}
                      onAppClick={handleAppClick}
                      countLabel={countLabel}
                    />
                  </Box>
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
                      label={countLabel(ungrouped.length)}
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
                          colorRes={colorRes}
                          colorLabels={colorLabels}
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
                        t("common.colorBy")}
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
                  ? getAppColorLabel(app, colorRes, colorLabels) || "\u2014"
                  : null;
                const colorDot = colorBy
                  ? getAppColor(app, colorRes, colorLabels)
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
                  {typeNoun}
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
              {typeNoun} ({drawer.apps.length})
            </Typography>
            <List dense>
              {drawer.apps
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((a) => {
                  // Build secondary text dynamically from active color/group fields
                  const parts: string[] = [];
                  if (a.subtype) parts.push(a.subtype);
                  if (colorBy) {
                    const lbl = getAppColorLabel(
                      a,
                      colorRes,
                      colorLabels,
                      perMemberColor ? drawer.memberId : undefined,
                    );
                    if (lbl) parts.push(lbl);
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
                            bgcolor: getAppColor(
                              a,
                              colorRes,
                              colorLabels,
                              perMemberColor ? drawer.memberId : undefined,
                            ),
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
                  {noItemsInGroup}
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
        reportType={savedReportKey}
        config={getConfig()}
        thumbnail={thumbnail}
      />
    </ReportShell>
  );
}
