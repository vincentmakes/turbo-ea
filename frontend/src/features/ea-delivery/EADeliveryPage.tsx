import React, { useEffect, useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import MuiCard from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardActionArea from "@mui/material/CardActionArea";
import Chip from "@mui/material/Chip";
import Checkbox from "@mui/material/Checkbox";
import Collapse from "@mui/material/Collapse";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import Menu from "@mui/material/Menu";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import InputAdornment from "@mui/material/InputAdornment";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Paper from "@mui/material/Paper";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useResolveMetaLabel, useResolveLabel } from "@/hooks/useResolveLabel";
import { api } from "@/api/client";
import type { Card, SoAW, DiagramSummary, Relation, EAPrinciple } from "@/types";

// ─── helpers ────────────────────────────────────────────────────────────────

const SOAW_STATUS_COLORS: Record<string, "default" | "warning" | "success" | "info"> = {
  draft: "default",
  in_review: "warning",
  approved: "success",
  signed: "info",
};

const INITIATIVE_STATUS_COLORS: Record<string, string> = {
  onTrack: "#4caf50",
  atRisk: "#ff9800",
  offTrack: "#d32f2f",
  onHold: "#9e9e9e",
  completed: "#1976d2",
};

interface InitiativeGroup {
  initiative: Card;
  diagrams: DiagramSummary[];
  soaws: SoAW[];
}

type ViewMode = "cards" | "list";
type StatusFilter = "ACTIVE" | "ARCHIVED" | "";
type PageTab = "initiatives" | "principles";

// ─── component ──────────────────────────────────────────────────────────────

export default function EADeliveryPage() {
  const { t } = useTranslation(["delivery", "common"]);
  const navigate = useNavigate();
  const { types: metamodelTypes } = useMetamodel();
  const rml = useResolveMetaLabel();
  const rl = useResolveLabel();

  const SOAW_STATUS_LABELS: Record<string, string> = {
    draft: t("status.draft"),
    in_review: t("status.inReview"),
    approved: t("status.approved"),
    signed: t("status.signed"),
  };

  const INITIATIVE_STATUS_LABELS: Record<string, string> = {
    onTrack: t("initiativeStatus.onTrack"),
    atRisk: t("initiativeStatus.atRisk"),
    offTrack: t("initiativeStatus.offTrack"),
    onHold: t("initiativeStatus.onHold"),
    completed: t("initiativeStatus.completed"),
  };

  const [pageTab, setPageTab] = useState<PageTab>("initiatives");
  const [initiatives, setInitiatives] = useState<Card[]>([]);
  const [diagrams, setDiagrams] = useState<DiagramSummary[]>([]);
  const [soaws, setSoaws] = useState<SoAW[]>([]);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Principles tab state
  const [principles, setPrinciples] = useState<EAPrinciple[]>([]);
  const [principlesLoading, setPrinciplesLoading] = useState(false);
  const [principlesTabEnabled, setPrinciplesTabEnabled] = useState<boolean | null>(null);

  // filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ACTIVE");
  const [subtypeFilter, setSubtypeFilter] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");

  // create SoAW dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newInitiativeId, setNewInitiativeId] = useState("");
  const [creating, setCreating] = useState(false);

  // link diagram dialog
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkInitiativeId, setLinkInitiativeId] = useState("");
  const [linkSelected, setLinkSelected] = useState<string[]>([]);
  const [linking, setLinking] = useState(false);

  // context menu for SoAW card
  const [ctxMenu, setCtxMenu] = useState<{
    anchor: HTMLElement;
    soaw: SoAW;
  } | null>(null);

  // get Initiative subtypes from metamodel
  const initiativeType = useMemo(
    () => metamodelTypes.find((t) => t.key === "Initiative"),
    [metamodelTypes],
  );
  const subtypes = initiativeType?.subtypes ?? [];

  // ── data fetching ───────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const statusParam = statusFilter ? `&status=${statusFilter}` : "&status=ACTIVE,ARCHIVED";
      const [initRes, diagRes, soawRes] = await Promise.all([
        api.get<{ items: Card[] }>(
          `/cards?type=Initiative&page_size=500${statusParam}`,
        ),
        api.get<DiagramSummary[]>("/diagrams"),
        api.get<SoAW[]>("/soaw"),
      ]);
      setInitiatives(initRes.items);
      setDiagrams(diagRes);
      setSoaws(soawRes);
      // Auto-expand first initiative on initial load
      if (initRes.items.length > 0 && Object.keys(expanded).length === 0) {
        setExpanded({ [initRes.items[0].id]: true });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error.loadData"));
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Check if principles tab is enabled
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<{ enabled: boolean }>("/settings/principles-display");
        setPrinciplesTabEnabled(res.enabled);
      } catch {
        setPrinciplesTabEnabled(false);
      }
    })();
  }, []);

  // Fetch principles when the tab is selected
  useEffect(() => {
    if (pageTab !== "principles") return;
    let cancelled = false;
    setPrinciplesLoading(true);
    (async () => {
      try {
        const data = await api.get<EAPrinciple[]>("/metamodel/principles");
        if (!cancelled) setPrinciples(data.filter((p) => p.is_active));
      } catch {
        // non-critical
      } finally {
        if (!cancelled) setPrinciplesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [pageTab]);

  // Fetch relations for initiatives (for list view)
  useEffect(() => {
    if (viewMode !== "list" || initiatives.length === 0) {
      setRelations([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const allRels: Relation[] = [];
        // Fetch relations in batches to avoid too many parallel requests
        const batchSize = 10;
        for (let i = 0; i < initiatives.length; i += batchSize) {
          const batch = initiatives.slice(i, i + batchSize);
          const results = await Promise.all(
            batch.map((init) =>
              api.get<Relation[]>(`/relations?card_id=${init.id}`),
            ),
          );
          if (cancelled) return;
          for (const rels of results) allRels.push(...rels);
        }
        if (!cancelled) setRelations(allRels);
      } catch {
        // non-critical — list view will just show no relations
      }
    })();
    return () => { cancelled = true; };
  }, [viewMode, initiatives]);

  // ── filter initiatives ────────────────────────────────────────────────

  const filteredInitiatives = useMemo(() => {
    let list = initiatives;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          (i.description ?? "").toLowerCase().includes(q),
      );
    }
    if (subtypeFilter) {
      list = list.filter((i) => i.subtype === subtypeFilter);
    }
    return list;
  }, [initiatives, search, subtypeFilter]);

  // ── group artefacts by initiative ───────────────────────────────────────

  const groups: InitiativeGroup[] = useMemo(() => {
    return filteredInitiatives.map((init) => ({
      initiative: init,
      diagrams: diagrams.filter((d) => d.initiative_ids.includes(init.id)),
      soaws: soaws.filter((s) => s.initiative_id === init.id),
    }));
  }, [filteredInitiatives, diagrams, soaws]);

  const unlinkedSoaws = useMemo(
    () => soaws.filter((s) => !s.initiative_id),
    [soaws],
  );

  const unlinkedDiagrams = useMemo(
    () => diagrams.filter((d) => d.initiative_ids.length === 0),
    [diagrams],
  );

  // ── helpers for list view ─────────────────────────────────────────────

  const getRelationsForInitiative = useCallback(
    (initId: string) => {
      return relations.filter(
        (r) => r.source_id === initId || r.target_id === initId,
      );
    },
    [relations],
  );

  const getRelatedSummary = useCallback(
    (initId: string) => {
      const rels = getRelationsForInitiative(initId);
      const grouped: Record<string, { type: string; names: string[] }> = {};
      for (const r of rels) {
        const other = r.source_id === initId ? r.target : r.source;
        if (!other) continue;
        if (!grouped[other.type]) grouped[other.type] = { type: other.type, names: [] };
        if (!grouped[other.type].names.includes(other.name)) {
          grouped[other.type].names.push(other.name);
        }
      }
      return Object.values(grouped);
    },
    [getRelationsForInitiative],
  );

  const getTypeColor = useCallback(
    (typeKey: string) => {
      return metamodelTypes.find((t) => t.key === typeKey)?.color ?? "#666";
    },
    [metamodelTypes],
  );

  const getTypeLabel = useCallback(
    (typeKey: string) => {
      const tp = metamodelTypes.find((t) => t.key === typeKey);
      return rml(tp?.key ?? "", tp?.translations, "label") || typeKey;
    },
    [metamodelTypes, rml],
  );

  // ── create SoAW ────────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const created = await api.post<SoAW>("/soaw", {
        name: newName.trim(),
        initiative_id: newInitiativeId || null,
      });
      setCreateOpen(false);
      setNewName("");
      setNewInitiativeId("");
      navigate(`/ea-delivery/soaw/${created.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error.createSoaw"));
    } finally {
      setCreating(false);
    }
  };

  const handleCreateForInitiative = (initiativeId: string) => {
    setNewInitiativeId(initiativeId);
    setCreateOpen(true);
  };

  // ── link diagram dialog ────────────────────────────────────────────────

  const openLinkDialog = (initiativeId: string) => {
    setLinkInitiativeId(initiativeId);
    const alreadyLinked = diagrams
      .filter((d) => d.initiative_ids.includes(initiativeId))
      .map((d) => d.id);
    setLinkSelected(alreadyLinked);
    setLinkOpen(true);
  };

  const toggleLinkDiagram = (diagramId: string) => {
    setLinkSelected((prev) =>
      prev.includes(diagramId)
        ? prev.filter((id) => id !== diagramId)
        : [...prev, diagramId],
    );
  };

  const handleLinkDiagrams = async () => {
    if (!linkInitiativeId) return;
    setLinking(true);
    try {
      const promises = diagrams.map((d) => {
        const wasLinked = d.initiative_ids.includes(linkInitiativeId);
        const isNowLinked = linkSelected.includes(d.id);
        if (wasLinked === isNowLinked) return null;
        const newIds = isNowLinked
          ? [...d.initiative_ids, linkInitiativeId]
          : d.initiative_ids.filter((id) => id !== linkInitiativeId);
        return api.patch(`/diagrams/${d.id}`, { initiative_ids: newIds });
      });
      await Promise.all(promises.filter(Boolean));
      setLinkOpen(false);
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error.linkDiagrams"));
    } finally {
      setLinking(false);
    }
  };

  // ── delete SoAW ────────────────────────────────────────────────────────

  const handleDeleteSoaw = async (id: string) => {
    if (!confirm(t("confirm.deleteSoaw"))) return;
    try {
      await api.delete(`/soaw/${id}`);
      setSoaws((prev) => prev.filter((s) => s.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error.deleteSoaw"));
    }
    setCtxMenu(null);
  };

  // ── unlink a single diagram from an initiative ─────────────────────────

  const handleUnlinkDiagram = async (diagram: DiagramSummary, initiativeId: string) => {
    try {
      const newIds = diagram.initiative_ids.filter((id) => id !== initiativeId);
      await api.patch(`/diagrams/${diagram.id}`, { initiative_ids: newIds });
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error.unlinkDiagram"));
    }
  };

  // ── toggle expansion ───────────────────────────────────────────────────

  const toggle = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  // ── shared card renderers ──────────────────────────────────────────────

  const renderDiagramCard = (d: DiagramSummary, initiativeId?: string) => (
    <MuiCard key={`d-${d.id}-${initiativeId ?? ""}`} variant="outlined" sx={{ mb: 1 }}>
      <CardActionArea
        onClick={() => navigate(`/diagrams/${d.id}`)}
        sx={{ p: 1.5, display: "flex", justifyContent: "flex-start" }}
      >
        <MaterialSymbol icon="schema" size={20} color="#1976d2" />
        <Typography sx={{ ml: 1, fontSize: "0.9rem", flex: 1 }}>
          {d.name}
        </Typography>
        {d.initiative_ids.length > 1 && (
          <Tooltip title={t("diagram.linkedToInitiatives", { count: d.initiative_ids.length })}>
            <Chip
              label={t("diagram.linkedToInitiatives", { count: d.initiative_ids.length })}
              size="small"
              variant="outlined"
              sx={{ mr: 0.5 }}
            />
          </Tooltip>
        )}
        <Chip label={t("diagram.label")} size="small" color="info" variant="outlined" />
        {initiativeId && (
          <Tooltip title={t("diagram.unlinkTooltip")}>
            <IconButton
              size="small"
              sx={{ ml: 0.5 }}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                handleUnlinkDiagram(d, initiativeId);
              }}
            >
              <MaterialSymbol icon="link_off" size={18} />
            </IconButton>
          </Tooltip>
        )}
      </CardActionArea>
    </MuiCard>
  );

  const renderSoawCard = (s: SoAW) => (
    <MuiCard key={`s-${s.id}`} variant="outlined" sx={{ mb: 1 }}>
      <CardActionArea
        onClick={() => navigate(`/ea-delivery/soaw/${s.id}`)}
        sx={{ p: 1.5, display: "flex", justifyContent: "flex-start" }}
      >
        <MaterialSymbol icon="description" size={20} color="#e65100" />
        <Typography sx={{ ml: 1, fontSize: "0.9rem", flex: 1 }}>
          {s.name}
          {s.revision_number > 1 && (
            <Typography component="span" sx={{ ml: 0.5, fontSize: "0.8rem", color: "text.secondary" }}>
              {t("soaw.revision", { number: s.revision_number })}
            </Typography>
          )}
        </Typography>
        <Chip
          label={SOAW_STATUS_LABELS[s.status] ?? s.status}
          size="small"
          color={SOAW_STATUS_COLORS[s.status] ?? "default"}
          sx={{ mr: 1 }}
        />
        <Chip label={t("soaw.label")} size="small" variant="outlined" />
        <Tooltip title={t("soaw.previewTooltip")}>
          <IconButton
            size="small"
            sx={{ ml: 0.5 }}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              navigate(`/ea-delivery/soaw/${s.id}/preview`);
            }}
          >
            <MaterialSymbol icon="visibility" size={18} />
          </IconButton>
        </Tooltip>
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setCtxMenu({ anchor: e.currentTarget, soaw: s });
          }}
        >
          <MaterialSymbol icon="more_vert" size={18} />
        </IconButton>
      </CardActionArea>
    </MuiCard>
  );

  // ── list view renderer ────────────────────────────────────────────────

  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const toggleRow = (id: string) =>
    setExpandedRows((prev) => ({ ...prev, [id]: !prev[id] }));

  const renderListView = () => {
    const getInitDiagrams = (id: string) =>
      diagrams.filter((d) => d.initiative_ids.includes(id));
    const getInitSoaws = (id: string) =>
      soaws.filter((s) => s.initiative_id === id);

    const totalCols = 9;

    return (
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: "action.hover" }}>
              <TableCell sx={{ fontWeight: 600 }}>{t("list.name")}</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>{t("list.subtype")}</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>{t("list.status")}</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>{t("list.businessValue")}</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>{t("list.effort")}</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>{t("list.timeline")}</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>{t("list.artefacts")}</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>{t("list.relatedElements")}</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 80 }}>{t("list.actions")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredInitiatives.length === 0 && (
              <TableRow>
                <TableCell colSpan={totalCols} sx={{ textAlign: "center", py: 4, color: "text.secondary" }}>
                  {t("empty.noMatch")}
                </TableCell>
              </TableRow>
            )}
            {filteredInitiatives.map((init) => {
              const attrs = (init.attributes ?? {}) as Record<string, unknown>;
              const initStatus = attrs.initiativeStatus as string | undefined;
              const businessValue = attrs.businessValue as string | undefined;
              const effort = attrs.effort as string | undefined;
              const startDate = attrs.startDate as string | undefined;
              const endDate = attrs.endDate as string | undefined;
              const initDiagrams = getInitDiagrams(init.id);
              const initSoaws = getInitSoaws(init.id);
              const dCount = initDiagrams.length;
              const sCount = initSoaws.length;
              const artefactCount = dCount + sCount;
              const relatedGroups = getRelatedSummary(init.id);
              const isRowOpen = expandedRows[init.id] ?? false;

              return (
                <React.Fragment key={init.id}>
                  <TableRow
                    hover
                    sx={{
                      cursor: "pointer",
                      opacity: init.status === "ARCHIVED" ? 0.6 : 1,
                      "&:hover": { bgcolor: "action.hover" },
                      // Remove bottom border when expanded so the sub-row connects visually
                      ...(isRowOpen && { "& > td": { borderBottom: "none" } }),
                    }}
                    onClick={() => navigate(`/cards/${init.id}`)}
                  >
                    {/* Name */}
                    <TableCell>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <MaterialSymbol icon="rocket_launch" size={18} color="#33cc58" />
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {init.name}
                        </Typography>
                        {init.status === "ARCHIVED" && (
                          <Chip label={t("common:status.archived")} size="small" variant="outlined" color="default" sx={{ height: 20, fontSize: "0.7rem" }} />
                        )}
                      </Box>
                    </TableCell>

                    {/* Subtype */}
                    <TableCell>
                      {init.subtype ? (
                        <Chip label={init.subtype} size="small" sx={{ textTransform: "capitalize" }} />
                      ) : (
                        <Typography variant="body2" color="text.secondary">-</Typography>
                      )}
                    </TableCell>

                    {/* Initiative Status */}
                    <TableCell>
                      {initStatus ? (
                        <Chip
                          label={INITIATIVE_STATUS_LABELS[initStatus] ?? initStatus}
                          size="small"
                          sx={{
                            bgcolor: INITIATIVE_STATUS_COLORS[initStatus] ?? "#9e9e9e",
                            color: "#fff",
                            fontWeight: 500,
                          }}
                        />
                      ) : (
                        <Typography variant="body2" color="text.secondary">-</Typography>
                      )}
                    </TableCell>

                    {/* Business Value */}
                    <TableCell>
                      {businessValue ? (
                        <Chip
                          label={businessValue.charAt(0).toUpperCase() + businessValue.slice(1)}
                          size="small"
                          variant="outlined"
                          sx={{
                            borderColor:
                              businessValue === "high" ? "#2e7d32" :
                              businessValue === "medium" ? "#ff9800" : "#9e9e9e",
                            color:
                              businessValue === "high" ? "#2e7d32" :
                              businessValue === "medium" ? "#ff9800" : "#9e9e9e",
                          }}
                        />
                      ) : (
                        <Typography variant="body2" color="text.secondary">-</Typography>
                      )}
                    </TableCell>

                    {/* Effort */}
                    <TableCell>
                      {effort ? (
                        <Chip
                          label={effort.charAt(0).toUpperCase() + effort.slice(1)}
                          size="small"
                          variant="outlined"
                          sx={{
                            borderColor:
                              effort === "high" ? "#d32f2f" :
                              effort === "medium" ? "#ff9800" : "#4caf50",
                            color:
                              effort === "high" ? "#d32f2f" :
                              effort === "medium" ? "#ff9800" : "#4caf50",
                          }}
                        />
                      ) : (
                        <Typography variant="body2" color="text.secondary">-</Typography>
                      )}
                    </TableCell>

                    {/* Timeline */}
                    <TableCell>
                      {startDate || endDate ? (
                        <Typography variant="body2" sx={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                          {startDate ? new Date(startDate).toLocaleDateString() : "?"}{" "}
                          {" - "}
                          {endDate ? new Date(endDate).toLocaleDateString() : "?"}
                        </Typography>
                      ) : (
                        <Typography variant="body2" color="text.secondary">-</Typography>
                      )}
                    </TableCell>

                    {/* Artefacts — clickable to expand sub-row */}
                    <TableCell
                      onClick={(e) => {
                        e.stopPropagation();
                        if (artefactCount > 0) toggleRow(init.id);
                      }}
                      sx={artefactCount > 0 ? {
                        cursor: "pointer",
                        "&:hover": { bgcolor: "action.selected" },
                        borderRadius: 1,
                      } : undefined}
                    >
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                        {artefactCount > 0 && (
                          <MaterialSymbol
                            icon={isRowOpen ? "expand_more" : "chevron_right"}
                            size={16}
                          />
                        )}
                        {sCount > 0 && (
                          <Chip
                            icon={<MaterialSymbol icon="description" size={14} />}
                            label={t("list.soawCount", { count: sCount })}
                            size="small"
                            variant="outlined"
                            sx={{ height: 22, fontSize: "0.75rem" }}
                          />
                        )}
                        {dCount > 0 && (
                          <Chip
                            icon={<MaterialSymbol icon="schema" size={14} />}
                            label={t("list.diagramCount", { count: dCount })}
                            size="small"
                            variant="outlined"
                            color="info"
                            sx={{ height: 22, fontSize: "0.75rem" }}
                          />
                        )}
                        {artefactCount === 0 && (
                          <Typography variant="body2" color="text.secondary">-</Typography>
                        )}
                      </Box>
                    </TableCell>

                    {/* Related Elements */}
                    <TableCell>
                      <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", maxWidth: 280 }}>
                        {relatedGroups.length > 0 ? (
                          relatedGroups.map(({ type, names }) => (
                            <Tooltip key={type} title={names.join(", ")}>
                              <Chip
                                label={`${names.length} ${getTypeLabel(type)}`}
                                size="small"
                                sx={{
                                  height: 22,
                                  fontSize: "0.75rem",
                                  bgcolor: getTypeColor(type) + "18",
                                  color: getTypeColor(type),
                                  borderColor: getTypeColor(type) + "40",
                                  border: "1px solid",
                                }}
                              />
                            </Tooltip>
                          ))
                        ) : (
                          <Typography variant="body2" color="text.secondary">
                            {relations.length > 0 ? "-" : "..."}
                          </Typography>
                        )}
                      </Box>
                    </TableCell>

                    {/* Actions */}
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Box sx={{ display: "flex" }}>
                        <Tooltip title={t("card.createSoaw")}>
                          <IconButton
                            size="small"
                            onClick={() => handleCreateForInitiative(init.id)}
                          >
                            <MaterialSymbol icon="add_circle_outline" size={18} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t("card.linkDiagrams")}>
                          <IconButton
                            size="small"
                            onClick={() => openLinkDialog(init.id)}
                          >
                            <MaterialSymbol icon="link" size={18} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </TableCell>
                  </TableRow>

                  {/* Expandable artefact sub-row */}
                  {artefactCount > 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={totalCols}
                        sx={{ py: 0, bgcolor: isRowOpen ? "action.hover" : "transparent" }}
                      >
                        <Collapse in={isRowOpen} timeout="auto" unmountOnExit>
                          <Box sx={{ py: 1.5, px: 1 }}>
                            {initDiagrams.map((d) => renderDiagramCard(d, init.id))}
                            {initSoaws.map(renderSoawCard)}
                          </Box>
                        </Collapse>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    );
  };

  // ── render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  // ── Principles read-only panel ────────────────────────────────────────

  const renderPrinciplesTab = () => {
    if (principlesLoading) {
      return (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      );
    }
    if (principles.length === 0) {
      return (
        <Box
          sx={{
            py: 6,
            textAlign: "center",
            border: "1px dashed",
            borderColor: "divider",
            borderRadius: 2,
          }}
        >
          <MaterialSymbol icon="gavel" size={40} color="#bbb" />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t("principles.empty")}
          </Typography>
        </Box>
      );
    }
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        {principles.map((p, idx) => (
          <MuiCard key={p.id} variant="outlined">
            <CardContent sx={{ py: 2, "&:last-child": { pb: 2 } }}>
              <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5 }}>
                <Typography
                  variant="caption"
                  sx={{
                    bgcolor: "primary.main",
                    color: "#fff",
                    borderRadius: "50%",
                    width: 24,
                    height: 24,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 700,
                    flexShrink: 0,
                    mt: 0.25,
                  }}
                >
                  {idx + 1}
                </Typography>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 0.25 }}>
                    {p.title}
                  </Typography>
                  {p.description && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                      {p.description}
                    </Typography>
                  )}
                  {(p.rationale || p.implications) && (
                    <Box sx={{ display: "flex", gap: 3, mt: 0.5, flexWrap: "wrap" }}>
                      {p.rationale && (
                        <Box sx={{ flex: 1, minWidth: 200 }}>
                          <Typography variant="caption" color="text.secondary" fontWeight={600}>
                            {t("principles.rationale")}:
                          </Typography>
                          <Box
                            component="ul"
                            sx={{ m: 0, pl: 2, listStyleType: "'•  '" }}
                          >
                            {p.rationale.split("\n").filter(Boolean).map((line, i) => (
                              <Typography
                                key={i}
                                component="li"
                                variant="caption"
                                color="text.secondary"
                                sx={{ py: 0.1 }}
                              >
                                {line}
                              </Typography>
                            ))}
                          </Box>
                        </Box>
                      )}
                      {p.implications && (
                        <Box sx={{ flex: 1, minWidth: 200 }}>
                          <Typography variant="caption" color="text.secondary" fontWeight={600}>
                            {t("principles.implications")}:
                          </Typography>
                          <Box
                            component="ul"
                            sx={{ m: 0, pl: 2, listStyleType: "'•  '" }}
                          >
                            {p.implications.split("\n").filter(Boolean).map((line, i) => (
                              <Typography
                                key={i}
                                component="li"
                                variant="caption"
                                color="text.secondary"
                                sx={{ py: 0.1 }}
                              >
                                {line}
                              </Typography>
                            ))}
                          </Box>
                        </Box>
                      )}
                    </Box>
                  )}
                </Box>
              </Box>
            </CardContent>
          </MuiCard>
        ))}
      </Box>
    );
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
        <MaterialSymbol icon="architecture" size={28} color="#1976d2" />
        <Typography variant="h5" sx={{ ml: 1, fontWeight: 700 }}>
          {t("page.title")}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {pageTab === "initiatives" && (
          <Button
            variant="contained"
            size="small"
            startIcon={<MaterialSymbol icon="add" size={18} />}
            sx={{ textTransform: "none" }}
            onClick={() => {
              setNewInitiativeId("");
              setCreateOpen(true);
            }}
          >
            {t("header.newSoaw")}
          </Button>
        )}
      </Box>

      {/* Tabs */}
      <Tabs
        value={pageTab}
        onChange={(_, v) => setPageTab(v)}
        sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}
      >
        <Tab
          value="initiatives"
          icon={<MaterialSymbol icon="rocket_launch" size={18} />}
          iconPosition="start"
          label={t("tabs.initiatives")}
          sx={{ textTransform: "none", minHeight: 48 }}
        />
        {principlesTabEnabled && (
          <Tab
            value="principles"
            icon={<MaterialSymbol icon="gavel" size={18} />}
            iconPosition="start"
            label={t("tabs.principles")}
            sx={{ textTransform: "none", minHeight: 48 }}
          />
        )}
      </Tabs>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {/* Principles tab */}
      {pageTab === "principles" && renderPrinciplesTab()}

      {/* Initiatives tab — Filter bar */}
      {pageTab === "initiatives" && (<>

      {/* Filter bar */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          mb: 2,
          flexWrap: "wrap",
        }}
      >
        {/* Search */}
        <TextField
          size="small"
          placeholder={t("header.searchInitiatives")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ minWidth: 220 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <MaterialSymbol icon="search" size={20} />
                </InputAdornment>
              ),
            },
          }}
        />

        {/* Status filter */}
        <TextField
          select
          size="small"
          label={t("filter.status")}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          sx={{ minWidth: 130 }}
        >
          <MenuItem value="ACTIVE">{t("filter.active")}</MenuItem>
          <MenuItem value="ARCHIVED">{t("filter.archived")}</MenuItem>
          <MenuItem value="">{t("filter.all")}</MenuItem>
        </TextField>

        {/* Subtype filter */}
        <TextField
          select
          size="small"
          label={t("filter.subtype")}
          value={subtypeFilter}
          onChange={(e) => setSubtypeFilter(e.target.value)}
          sx={{ minWidth: 130 }}
        >
          <MenuItem value="">{t("filter.allSubtypes")}</MenuItem>
          {subtypes.map((st) => (
            <MenuItem key={st.key} value={st.key}>
              {rl(st.key, st.translations)}
            </MenuItem>
          ))}
        </TextField>

        <Box sx={{ flex: 1 }} />

        {/* Result count */}
        <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
          {t("header.resultCount", { count: filteredInitiatives.length })}
        </Typography>

        {/* View toggle */}
        <ToggleButtonGroup
          value={viewMode}
          exclusive
          onChange={(_, v) => v && setViewMode(v)}
          size="small"
        >
          <ToggleButton value="cards">
            <Tooltip title={t("view.cardView")}>
              <Box sx={{ display: "flex", alignItems: "center" }}>
                <MaterialSymbol icon="dashboard" size={20} />
              </Box>
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="list">
            <Tooltip title={t("view.listView")}>
              <Box sx={{ display: "flex", alignItems: "center" }}>
                <MaterialSymbol icon="view_list" size={20} />
              </Box>
            </Tooltip>
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Empty state */}
      {initiatives.length === 0 && soaws.length === 0 && diagrams.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t("empty.noInitiatives")}
        </Alert>
      )}

      {/* List view */}
      {viewMode === "list" && renderListView()}

      {/* Cards view */}
      {viewMode === "cards" && (
        <>
          {filteredInitiatives.length === 0 && initiatives.length > 0 && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {t("empty.noMatch")}
            </Alert>
          )}

          {/* Initiative groups */}
          {groups.map(({ initiative, soaws: initSoaws, diagrams: initDiagrams }) => {
            const isOpen = expanded[initiative.id] ?? false;
            const artefactCount = initSoaws.length + initDiagrams.length;

            return (
              <MuiCard
                key={initiative.id}
                sx={{
                  mb: 2,
                  borderLeft: `4px solid ${initiative.status === "ARCHIVED" ? "#999" : "#33cc58"}`,
                  opacity: initiative.status === "ARCHIVED" ? 0.7 : 1,
                }}
              >
                {/* Initiative header */}
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    px: 2,
                    py: 1.5,
                    cursor: "pointer",
                    "&:hover": { bgcolor: "action.hover" },
                  }}
                  onClick={() => toggle(initiative.id)}
                >
                  <IconButton size="small" sx={{ mr: 1 }}>
                    <MaterialSymbol
                      icon={isOpen ? "expand_more" : "chevron_right"}
                      size={20}
                    />
                  </IconButton>
                  <MaterialSymbol icon="rocket_launch" size={22} color={initiative.status === "ARCHIVED" ? "#999" : "#33cc58"} />
                  <Typography sx={{ ml: 1, fontWeight: 600, flex: 1 }}>
                    {initiative.name}
                  </Typography>
                  {initiative.status === "ARCHIVED" && (
                    <Chip label={t("common:status.archived")} size="small" variant="outlined" color="default" sx={{ mr: 1 }} />
                  )}
                  {initiative.subtype && (
                    <Chip
                      label={initiative.subtype}
                      size="small"
                      sx={{ mr: 1, textTransform: "capitalize" }}
                    />
                  )}
                  {(() => {
                    const initStatus = (initiative.attributes as Record<string, unknown>)?.initiativeStatus as string | undefined;
                    return initStatus ? (
                      <Chip
                        label={INITIATIVE_STATUS_LABELS[initStatus] ?? initStatus}
                        size="small"
                        sx={{
                          mr: 1,
                          bgcolor: INITIATIVE_STATUS_COLORS[initStatus] ?? "#9e9e9e",
                          color: "#fff",
                          fontWeight: 500,
                        }}
                      />
                    ) : null;
                  })()}
                  <Chip
                    label={t("card.artefactCount", { count: artefactCount })}
                    size="small"
                    variant="outlined"
                    sx={{ mr: 1 }}
                  />
                  <Tooltip title={t("card.linkDiagramsTooltip")}>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        openLinkDialog(initiative.id);
                      }}
                      sx={{ mr: 0.5 }}
                    >
                      <MaterialSymbol icon="link" size={20} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t("card.createSoawTooltip")}>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCreateForInitiative(initiative.id);
                      }}
                    >
                      <MaterialSymbol icon="add_circle_outline" size={20} />
                    </IconButton>
                  </Tooltip>
                </Box>

                {/* Artefact list */}
                <Collapse in={isOpen}>
                  <Box sx={{ px: 2, pb: 2 }}>
                    {artefactCount === 0 && (
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ py: 2, textAlign: "center" }}
                      >
                        {t("empty.noArtefacts")}{" "}
                        <Box
                          component="span"
                          sx={{
                            color: "primary.main",
                            cursor: "pointer",
                            "&:hover": { textDecoration: "underline" },
                          }}
                          onClick={() => openLinkDialog(initiative.id)}
                        >
                          {t("empty.linkDiagram")}
                        </Box>
                        {t("empty.or")}
                        <Box
                          component="span"
                          sx={{
                            color: "primary.main",
                            cursor: "pointer",
                            "&:hover": { textDecoration: "underline" },
                          }}
                          onClick={() => handleCreateForInitiative(initiative.id)}
                        >
                          {t("empty.createSoaw")}
                        </Box>
                        .
                      </Typography>
                    )}

                    {/* Diagram cards */}
                    {initDiagrams.map((d) => renderDiagramCard(d, initiative.id))}

                    {/* SoAW cards */}
                    {initSoaws.map(renderSoawCard)}
                  </Box>
                </Collapse>
              </MuiCard>
            );
          })}

          {/* Unlinked artefacts */}
          {(unlinkedSoaws.length > 0 || unlinkedDiagrams.length > 0) && (
            <MuiCard sx={{ mb: 2, borderLeft: "4px solid #999" }}>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  px: 2,
                  py: 1.5,
                  cursor: "pointer",
                  "&:hover": { bgcolor: "action.hover" },
                }}
                onClick={() => toggle("__unlinked__")}
              >
                <IconButton size="small" sx={{ mr: 1 }}>
                  <MaterialSymbol
                    icon={expanded["__unlinked__"] ? "expand_more" : "chevron_right"}
                    size={20}
                  />
                </IconButton>
                <MaterialSymbol icon="folder_open" size={22} color="#999" />
                <Typography
                  sx={{ ml: 1, fontWeight: 600, flex: 1, color: "text.secondary" }}
                >
                  {t("unlinked.title")}
                </Typography>
                <Chip
                  label={t("card.artefactCount", { count: unlinkedSoaws.length + unlinkedDiagrams.length })}
                  size="small"
                  variant="outlined"
                />
              </Box>
              <Collapse in={expanded["__unlinked__"] ?? false}>
                <Box sx={{ px: 2, pb: 2 }}>
                  {unlinkedDiagrams.map((d) => renderDiagramCard(d))}
                  {unlinkedSoaws.map(renderSoawCard)}
                </Box>
              </Collapse>
            </MuiCard>
          )}
        </>
      )}

      </>)}

      {/* Context menu for SoAW */}
      <Menu
        anchorEl={ctxMenu?.anchor}
        open={!!ctxMenu}
        onClose={() => setCtxMenu(null)}
      >
        <MenuItem
          onClick={() => {
            if (ctxMenu) navigate(`/ea-delivery/soaw/${ctxMenu.soaw.id}/preview`);
            setCtxMenu(null);
          }}
        >
          <ListItemIcon>
            <MaterialSymbol icon="visibility" size={18} />
          </ListItemIcon>
          <ListItemText>{t("menu.preview")}</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (ctxMenu) navigate(`/ea-delivery/soaw/${ctxMenu.soaw.id}`);
            setCtxMenu(null);
          }}
        >
          <ListItemIcon>
            <MaterialSymbol icon="edit" size={18} />
          </ListItemIcon>
          <ListItemText>{t("menu.edit")}</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => ctxMenu && handleDeleteSoaw(ctxMenu.soaw.id)}
          sx={{ color: "error.main" }}
        >
          <ListItemIcon>
            <MaterialSymbol icon="delete" size={18} color="#d32f2f" />
          </ListItemIcon>
          <ListItemText>{t("menu.delete")}</ListItemText>
        </MenuItem>
      </Menu>

      {/* Create SoAW dialog */}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t("createDialog.title")}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            label={t("createDialog.documentName")}
            fullWidth
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            sx={{ mt: 1, mb: 2 }}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <TextField
            select
            label={t("createDialog.initiative")}
            fullWidth
            value={newInitiativeId}
            onChange={(e) => setNewInitiativeId(e.target.value)}
            helperText={t("createDialog.initiativeHelper")}
          >
            <MenuItem value="">
              <em>{t("common:labels.none")}</em>
            </MenuItem>
            {initiatives.map((init) => (
              <MenuItem key={init.id} value={init.id}>
                {init.name}
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>{t("common:actions.cancel")}</Button>
          <Button
            variant="contained"
            disabled={!newName.trim() || creating}
            onClick={handleCreate}
          >
            {creating ? t("createDialog.creating") : t("common:actions.create")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Link diagrams dialog */}
      <Dialog
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {t("linkDialog.title")}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}
            dangerouslySetInnerHTML={{
              __html: t("linkDialog.description", {
                name: initiatives.find((i) => i.id === linkInitiativeId)?.name ?? "",
                interpolation: { escapeValue: true },
              }),
            }}
          />

          {diagrams.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: "center" }}>
              {t("linkDialog.noDiagrams")}
            </Typography>
          ) : (
            <List dense sx={{ maxHeight: 400, overflow: "auto" }}>
              {diagrams.map((d) => {
                const isChecked = linkSelected.includes(d.id);
                return (
                  <ListItem key={d.id} disablePadding>
                    <ListItemButton onClick={() => toggleLinkDiagram(d.id)} dense>
                      <ListItemIcon sx={{ minWidth: 36 }}>
                        <Checkbox
                          edge="start"
                          checked={isChecked}
                          tabIndex={-1}
                          disableRipple
                          size="small"
                        />
                      </ListItemIcon>
                      <ListItemIcon sx={{ minWidth: 32 }}>
                        <MaterialSymbol icon="schema" size={18} color="#1976d2" />
                      </ListItemIcon>
                      <ListItemText
                        primary={d.name}
                        secondary={
                          d.initiative_ids.length > 0
                            ? t("linkDialog.linkedToCount", { count: d.initiative_ids.length })
                            : t("linkDialog.notLinked")
                        }
                      />
                    </ListItemButton>
                  </ListItem>
                );
              })}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLinkOpen(false)}>{t("common:actions.cancel")}</Button>
          <Button
            variant="contained"
            disabled={linking}
            onClick={handleLinkDiagrams}
          >
            {linking ? t("linkDialog.saving") : t("linkDialog.saveLinks")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
