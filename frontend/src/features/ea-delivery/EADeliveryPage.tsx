import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import MuiCard from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Checkbox from "@mui/material/Checkbox";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Alert from "@mui/material/Alert";
import Menu from "@mui/material/Menu";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useResolveMetaLabel } from "@/hooks/useResolveLabel";
import { api } from "@/api/client";
import CreateAdrDialog from "./CreateAdrDialog";
import AdrGrid from "./AdrGrid";
import AdrFilterSidebar, { type AdrFilters, EMPTY_ADR_FILTERS } from "./AdrFilterSidebar";
import { InitiativesTab } from "./initiatives";
import type { SoAW, DiagramSummary, EAPrinciple, ArchitectureDecision } from "@/types";
import type { useInitiativeData } from "./initiatives";

// ─── types ──────────────────────────────────────────────────────────────────

type PageTab = "initiatives" | "principles" | "decisions";

// ─── component ──────────────────────────────────────────────────────────────

export default function EADeliveryPage() {
  const { t } = useTranslation(["delivery", "common"]);
  const navigate = useNavigate();
  const { types: metamodelTypes } = useMetamodel();
  const rml = useResolveMetaLabel();

  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get("tab");
  const pageTab: PageTab =
    rawTab === "principles" || rawTab === "decisions" ? rawTab : "initiatives";
  const setPageTab = useCallback(
    (tab: PageTab) => setSearchParams({ tab }, { replace: true }),
    [setSearchParams],
  );

  // ── Principles tab state ────────────────────────────────────────────────
  const [principles, setPrinciples] = useState<EAPrinciple[]>([]);
  const [principlesLoading, setPrinciplesLoading] = useState(false);
  const [principlesTabEnabled, setPrinciplesTabEnabled] = useState<boolean | null>(null);

  // ── Decisions tab state ─────────────────────────────────────────────────
  const [adrs, setAdrs] = useState<ArchitectureDecision[]>([]);
  const [adrSearch, setAdrSearch] = useState("");
  const [adrFilters, setAdrFilters] = useState<AdrFilters>({ ...EMPTY_ADR_FILTERS });
  const [adrSidebarCollapsed, setAdrSidebarCollapsed] = useState(false);
  const [adrSidebarWidth, setAdrSidebarWidth] = useState(280);
  const [adrCreateOpen, setAdrCreateOpen] = useState(false);
  const [adrCreatePreLinkedCards, setAdrCreatePreLinkedCards] = useState<
    { id: string; name: string; type: string }[]
  >([]);

  // ── Create SoAW dialog state ────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newInitiativeId, setNewInitiativeId] = useState("");
  const [creating, setCreating] = useState(false);

  // ── Link diagram dialog state ───────────────────────────────────────────
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkInitiativeId, setLinkInitiativeId] = useState("");
  const [linkSelected, setLinkSelected] = useState<string[]>([]);
  const [linking, setLinking] = useState(false);

  // ── Create artefact menu ────────────────────────────────────────────────
  const [createMenuAnchor, setCreateMenuAnchor] = useState<HTMLElement | null>(null);
  const [createMenuInitiativeId, setCreateMenuInitiativeId] = useState("");

  // ── SoAW context menu ───────────────────────────────────────────────────
  const [ctxMenu, setCtxMenu] = useState<{
    anchor: HTMLElement;
    soaw: SoAW;
  } | null>(null);

  // ── Error state ─────────────────────────────────────────────────────────
  const [error, setError] = useState("");

  // ── Data from InitiativesTab (exposed via callback) ─────────────────────
  const dataRef = useRef<ReturnType<typeof useInitiativeData> | null>(null);

  // ── Check if principles tab is enabled ──────────────────────────────────
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

  // ── Fetch principles when tab is selected ───────────────────────────────
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
    return () => {
      cancelled = true;
    };
  }, [pageTab]);

  // ── Fetch ADRs for decisions tab ────────────────────────────────────────
  useEffect(() => {
    if (pageTab !== "decisions") return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get<ArchitectureDecision[]>("/adr");
        if (!cancelled) setAdrs(data);
      } catch {
        // non-critical
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pageTab]);

  // ── SoAW handlers ──────────────────────────────────────────────────────

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

  const handleCreateSoawForInitiative = useCallback((initiativeId: string) => {
    setNewInitiativeId(initiativeId);
    setCreateOpen(true);
  }, []);

  const openCreateMenu = useCallback(
    (e: React.MouseEvent<HTMLElement>, initiativeId: string) => {
      e.stopPropagation();
      setCreateMenuAnchor(e.currentTarget);
      setCreateMenuInitiativeId(initiativeId);
    },
    [],
  );

  const closeCreateMenu = () => {
    setCreateMenuAnchor(null);
    setCreateMenuInitiativeId("");
  };

  // ── Link diagram handlers ──────────────────────────────────────────────

  const openLinkDialog = useCallback(
    (initiativeId: string) => {
      setLinkInitiativeId(initiativeId);
      const allDiagrams = dataRef.current?.diagrams ?? [];
      const alreadyLinked = allDiagrams
        .filter((d) => d.card_ids.includes(initiativeId))
        .map((d) => d.id);
      setLinkSelected(alreadyLinked);
      setLinkOpen(true);
    },
    [],
  );

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
      const allDiagrams = dataRef.current?.diagrams ?? [];
      const promises = allDiagrams.map((d) => {
        const wasLinked = d.card_ids.includes(linkInitiativeId);
        const isNowLinked = linkSelected.includes(d.id);
        if (wasLinked === isNowLinked) return null;
        const newIds = isNowLinked
          ? [...d.card_ids, linkInitiativeId]
          : d.card_ids.filter((id) => id !== linkInitiativeId);
        return api.patch(`/diagrams/${d.id}`, { card_ids: newIds });
      });
      await Promise.all(promises.filter(Boolean));
      setLinkOpen(false);
      dataRef.current?.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error.linkDiagrams"));
    } finally {
      setLinking(false);
    }
  };

  // ── Unlink diagram handler ─────────────────────────────────────────────

  const handleUnlinkDiagram = useCallback(
    async (diagram: DiagramSummary, initiativeId: string) => {
      try {
        const newIds = diagram.card_ids.filter((id) => id !== initiativeId);
        await api.patch(`/diagrams/${diagram.id}`, { card_ids: newIds });
        dataRef.current?.refetch();
      } catch (e) {
        setError(e instanceof Error ? e.message : t("error.unlinkDiagram"));
      }
    },
    [t],
  );

  // ── Delete SoAW handler ────────────────────────────────────────────────

  const handleDeleteSoaw = async (id: string) => {
    if (!confirm(t("confirm.deleteSoaw"))) return;
    try {
      await api.delete(`/soaw/${id}`);
      dataRef.current?.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error.deleteSoaw"));
    }
    setCtxMenu(null);
  };

  // ── SoAW context menu handler ──────────────────────────────────────────

  const handleSoawContextMenu = useCallback(
    (anchor: HTMLElement, soaw: SoAW) => {
      setCtxMenu({ anchor, soaw });
    },
    [],
  );

  // ── ADR handlers ───────────────────────────────────────────────────────

  const openAdrCreateDialog = useCallback(
    (preLinked: { id: string; name: string; type: string }[] = []) => {
      setAdrCreatePreLinkedCards(preLinked);
      setAdrCreateOpen(true);
    },
    [],
  );

  const handleDeleteAdr = async (id: string) => {
    if (!confirm(t("adr.confirm.delete"))) return;
    try {
      await api.delete(`/adr/${id}`);
      setAdrs((prev) => prev.filter((a) => a.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error.deleteSoaw"));
    }
  };

  const handleDuplicateAdr = async (id: string) => {
    try {
      const dup = await api.post<ArchitectureDecision>(`/adr/${id}/duplicate`);
      navigate(`/ea-delivery/adr/${dup.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("adr.editor.error.duplicateFailed"));
    }
  };

  // ── ADR filter helpers ─────────────────────────────────────────────────

  const filteredAdrs = useMemo(() => {
    let list = adrs;
    if (adrFilters.statuses.length > 0) {
      list = list.filter((a) => adrFilters.statuses.includes(a.status));
    }
    if (adrFilters.cardTypes.length > 0) {
      list = list.filter((a) =>
        (a.linked_cards ?? []).some((c) => adrFilters.cardTypes.includes(c.type)),
      );
    }
    if (adrFilters.linkedCards.length > 0) {
      list = list.filter((a) =>
        (a.linked_cards ?? []).some((c) => adrFilters.linkedCards.includes(c.id)),
      );
    }
    if (adrFilters.dateCreatedFrom) {
      list = list.filter((a) => a.created_at && a.created_at >= adrFilters.dateCreatedFrom);
    }
    if (adrFilters.dateCreatedTo) {
      list = list.filter(
        (a) => a.created_at && a.created_at <= adrFilters.dateCreatedTo + "T23:59:59",
      );
    }
    if (adrFilters.dateModifiedFrom) {
      list = list.filter(
        (a) => a.updated_at && a.updated_at >= adrFilters.dateModifiedFrom,
      );
    }
    if (adrFilters.dateModifiedTo) {
      list = list.filter(
        (a) => a.updated_at && a.updated_at <= adrFilters.dateModifiedTo + "T23:59:59",
      );
    }
    if (adrFilters.dateSignedFrom) {
      list = list.filter((a) => a.signed_at && a.signed_at >= adrFilters.dateSignedFrom);
    }
    if (adrFilters.dateSignedTo) {
      list = list.filter(
        (a) => a.signed_at && a.signed_at <= adrFilters.dateSignedTo + "T23:59:59",
      );
    }
    if (adrFilters.signedBy.length > 0) {
      list = list.filter((a) =>
        a.signatories.some(
          (s) => s.status === "signed" && adrFilters.signedBy.includes(s.user_id),
        ),
      );
    }
    return list;
  }, [adrs, adrFilters]);

  const availableCardTypes = useMemo(() => {
    const typeKeys = new Set<string>();
    for (const adr of adrs) {
      for (const c of adr.linked_cards ?? []) typeKeys.add(c.type);
    }
    return [...typeKeys].map((key) => {
      const mt = metamodelTypes.find((t) => t.key === key);
      return {
        key,
        label: rml(key, mt?.translations, "label") || key,
        color: mt?.color ?? "#666",
      };
    });
  }, [adrs, metamodelTypes, rml]);

  const availableLinkedCards = useMemo(() => {
    const seen = new Map<
      string,
      { id: string; name: string; type: string; color: string }
    >();
    for (const adr of adrs) {
      for (const c of adr.linked_cards ?? []) {
        if (adrFilters.cardTypes.length > 0 && !adrFilters.cardTypes.includes(c.type))
          continue;
        if (!seen.has(c.id)) {
          const mt = metamodelTypes.find((t) => t.key === c.type);
          seen.set(c.id, {
            id: c.id,
            name: c.name,
            type: c.type,
            color: mt?.color ?? "#666",
          });
        }
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [adrs, metamodelTypes, adrFilters.cardTypes]);

  const availableSignatories = useMemo(() => {
    const seen = new Map<string, { userId: string; displayName: string }>();
    for (const adr of adrs) {
      for (const s of adr.signatories) {
        if (s.status === "signed" && !seen.has(s.user_id)) {
          seen.set(s.user_id, { userId: s.user_id, displayName: s.display_name });
        }
      }
    }
    return [...seen.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [adrs]);

  // ── Decisions tab panel ────────────────────────────────────────────────

  const renderDecisionsTab = () => (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - 180px)",
      }}
    >
      <Box
        sx={{
          display: "flex",
          flex: 1,
          minHeight: 0,
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          overflow: "hidden",
        }}
      >
        <AdrFilterSidebar
          filters={adrFilters}
          onFiltersChange={setAdrFilters}
          collapsed={adrSidebarCollapsed}
          onToggleCollapse={() => setAdrSidebarCollapsed((p) => !p)}
          width={adrSidebarWidth}
          onWidthChange={setAdrSidebarWidth}
          availableCardTypes={availableCardTypes}
          availableLinkedCards={availableLinkedCards}
          availableSignatories={availableSignatories}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <AdrGrid
            adrs={filteredAdrs}
            metamodelTypes={metamodelTypes}
            loading={false}
            quickFilterText={adrSearch}
            onQuickFilterChange={setAdrSearch}
            onEdit={(adr) => navigate(`/ea-delivery/adr/${adr.id}`)}
            onPreview={(adr) => navigate(`/ea-delivery/adr/${adr.id}/preview`)}
            onDuplicate={(adr) => handleDuplicateAdr(adr.id)}
            onDelete={(adr) => handleDeleteAdr(adr.id)}
          />
        </Box>
      </Box>
    </Box>
  );

  // ── Principles read-only panel ─────────────────────────────────────────

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
          <MaterialSymbol icon="bookmark_star" size={40} color="#bbb" />
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
                    <Box
                      sx={{ display: "flex", gap: 3, mt: 0.5, flexWrap: "wrap" }}
                    >
                      {p.rationale && (
                        <Box sx={{ flex: 1, minWidth: 200 }}>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            fontWeight={600}
                          >
                            {t("principles.rationale")}:
                          </Typography>
                          <Box
                            component="ul"
                            sx={{ m: 0, pl: 2, listStyleType: "'•  '" }}
                          >
                            {p.rationale
                              .split("\n")
                              .filter(Boolean)
                              .map((line, i) => (
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
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            fontWeight={600}
                          >
                            {t("principles.implications")}:
                          </Typography>
                          <Box
                            component="ul"
                            sx={{ m: 0, pl: 2, listStyleType: "'•  '" }}
                          >
                            {p.implications
                              .split("\n")
                              .filter(Boolean)
                              .map((line, i) => (
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

  // ── Main render ─────────────────────────────────────────────────────────

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
        {pageTab === "decisions" && (
          <Button
            variant="contained"
            size="small"
            startIcon={<MaterialSymbol icon="add" size={18} />}
            sx={{ textTransform: "none" }}
            onClick={() => openAdrCreateDialog()}
          >
            {t("adr.new")}
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
            icon={<MaterialSymbol icon="bookmark_star" size={18} />}
            iconPosition="start"
            label={t("tabs.principles")}
            sx={{ textTransform: "none", minHeight: 48 }}
          />
        )}
        <Tab
          value="decisions"
          icon={<MaterialSymbol icon="gavel" size={18} />}
          iconPosition="start"
          label={t("tabs.decisions")}
          sx={{ textTransform: "none", minHeight: 48 }}
        />
      </Tabs>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {/* Principles tab */}
      {pageTab === "principles" && renderPrinciplesTab()}

      {/* Decisions tab */}
      {pageTab === "decisions" && renderDecisionsTab()}

      {/* Initiatives tab */}
      {pageTab === "initiatives" && (
        <InitiativesTab
          onCreateSoaw={handleCreateSoawForInitiative}
          onCreateAdr={openAdrCreateDialog}
          onLinkDiagrams={openLinkDialog}
          onCreateArtefact={openCreateMenu}
          onUnlinkDiagram={handleUnlinkDiagram}
          onSoawContextMenu={handleSoawContextMenu}
          onDataReady={useCallback(
            (d: ReturnType<typeof useInitiativeData>) => {
              dataRef.current = d;
            },
            [],
          )}
        />
      )}

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
            {(dataRef.current?.initiatives ?? []).map((init) => (
              <MenuItem key={init.id} value={init.id}>
                {init.name}
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            variant="contained"
            disabled={!newName.trim() || creating}
            onClick={handleCreate}
          >
            {creating ? t("createDialog.creating") : t("common:actions.create")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Create ADR dialog */}
      <CreateAdrDialog
        open={adrCreateOpen}
        onClose={() => setAdrCreateOpen(false)}
        onCreated={(adr) => {
          dataRef.current?.refetch();
          navigate(`/ea-delivery/adr/${adr.id}`);
        }}
        preLinkedCards={adrCreatePreLinkedCards}
      />

      {/* Create artefact menu (SoAW or ADR) for initiative "+" button */}
      <Menu
        anchorEl={createMenuAnchor}
        open={Boolean(createMenuAnchor)}
        onClose={closeCreateMenu}
      >
        <MenuItem
          onClick={() => {
            const initId = createMenuInitiativeId;
            closeCreateMenu();
            handleCreateSoawForInitiative(initId);
          }}
        >
          <ListItemIcon>
            <MaterialSymbol icon="description" size={18} />
          </ListItemIcon>
          <ListItemText>{t("card.createSoawForInitiative")}</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            const initId = createMenuInitiativeId;
            const init = dataRef.current?.initiatives.find((i) => i.id === initId);
            closeCreateMenu();
            openAdrCreateDialog(
              init ? [{ id: init.id, name: init.name, type: init.type }] : [],
            );
          }}
        >
          <ListItemIcon>
            <MaterialSymbol icon="gavel" size={18} />
          </ListItemIcon>
          <ListItemText>{t("card.createAdrForInitiative")}</ListItemText>
        </MenuItem>
      </Menu>

      {/* Link diagrams dialog */}
      <Dialog
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t("linkDialog.title")}</DialogTitle>
        <DialogContent>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mb: 2 }}
            dangerouslySetInnerHTML={{
              __html: t("linkDialog.description", {
                name:
                  dataRef.current?.initiatives.find((i) => i.id === linkInitiativeId)
                    ?.name ?? "",
                interpolation: { escapeValue: true },
              }),
            }}
          />

          {(dataRef.current?.diagrams ?? []).length === 0 ? (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ py: 2, textAlign: "center" }}
            >
              {t("linkDialog.noDiagrams")}
            </Typography>
          ) : (
            <List dense sx={{ maxHeight: 400, overflow: "auto" }}>
              {(dataRef.current?.diagrams ?? []).map((d) => {
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
                          d.card_ids.length > 0
                            ? t("linkDialog.linkedToCardCount", {
                                count: d.card_ids.length,
                              })
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
          <Button onClick={() => setLinkOpen(false)}>
            {t("common:actions.cancel")}
          </Button>
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
