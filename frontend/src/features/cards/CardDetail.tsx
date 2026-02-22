import { useState, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import MuiCard from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import MenuItem from "@mui/material/MenuItem";
import IconButton from "@mui/material/IconButton";
import Alert from "@mui/material/Alert";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import LinearProgress from "@mui/material/LinearProgress";
import Tooltip from "@mui/material/Tooltip";
import Menu from "@mui/material/Menu";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import MaterialSymbol from "@/components/MaterialSymbol";
import ApprovalStatusBadge from "@/components/ApprovalStatusBadge";
import LifecycleBadge from "@/components/LifecycleBadge";
import EolLinkSection from "@/components/EolLinkSection";
import ErrorBoundary from "@/components/ErrorBoundary";
import ProcessFlowTab from "@/features/bpm/ProcessFlowTab";
import ProcessAssessmentPanel from "@/features/bpm/ProcessAssessmentPanel";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useCalculatedFields } from "@/hooks/useCalculatedFields";
import { useCurrency } from "@/hooks/useCurrency";
import { api } from "@/api/client";
import {
  DataQualityRing,
  DescriptionSection,
  LifecycleSection,
  AttributeSection,
  HierarchySection,
  RelationsSection,
  CommentsTab,
  TodosTab,
  StakeholdersTab,
  HistoryTab,
} from "@/features/cards/sections";
import type {
  Card,
  CardEffectivePermissions,
} from "@/types";

// ── Default permissions (allow everything until loaded) ─────────
const DEFAULT_PERMISSIONS: CardEffectivePermissions["effective"] = {
  can_view: true,
  can_edit: true,
  can_archive: true,
  can_delete: true,
  can_approval_status: true,
  can_manage_stakeholders: true,
  can_manage_relations: true,
  can_manage_documents: true,
  can_manage_comments: true,
  can_create_comments: true,
  can_bpm_edit: true,
  can_bpm_manage_drafts: true,
  can_bpm_approve: true,
};

// ── Main Detail Page ────────────────────────────────────────────
export default function CardDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { getType } = useMetamodel();
  const { isCalculated } = useCalculatedFields();
  const [card, setCard] = useState<Card | null>(null);
  const [tab, setTab] = useState(0);
  const [initialSubTab, setInitialSubTab] = useState<number | undefined>(undefined);
  const [error, setError] = useState("");
  const [relRefresh, setRelRefresh] = useState(0);
  const [approvalMenuAnchor, setApprovalMenuAnchor] = useState<HTMLElement | null>(
    null
  );
  const [perms, setPerms] = useState<CardEffectivePermissions["effective"]>(DEFAULT_PERMISSIONS);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Currency hook — must be before early returns to satisfy Rules of Hooks
  const { fmt: currencyFmt } = useCurrency();

  // Fetch effective permissions for this card
  useEffect(() => {
    if (!id) return;
    setPerms(DEFAULT_PERMISSIONS);
    api
      .get<CardEffectivePermissions>(`/cards/${id}/my-permissions`)
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
      .get<Card>(`/cards/${id}`)
      .then(setCard)
      .catch((e) => setError(e.message));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!card)
    return (
      <Box sx={{ p: 4 }}>
        <LinearProgress />
      </Box>
    );

  const typeConfig = getType(card.type);

  // ── Computed calculated field keys (no useMemo — investigating #310) ──
  let calcFieldKeys: string[] = [];
  try {
    for (const section of typeConfig?.fields_schema || []) {
      for (const field of section.fields || []) {
        if (isCalculated(card.type, field.key)) calcFieldKeys.push(field.key);
      }
    }
  } catch (err) {
    console.error("[CardDetail] calcFieldKeys error", err);
    calcFieldKeys = [];
  }

  // Section config: controls default expanded / hidden for built-in sections
  const sc = typeConfig?.section_config || {};
  const secExpanded = (key: string, fallback = true) => sc[key]?.defaultExpanded !== false ? fallback : false;
  const secHidden = (key: string) => !!sc[key]?.hidden;

  // Section ordering: custom sections exclude __description, which feeds DescriptionSection
  const customSections = (typeConfig?.fields_schema || []).filter((s) => s.section !== "__description");
  const descExtraSection = (typeConfig?.fields_schema || []).find((s) => s.section === "__description");
  const descExtraFields = descExtraSection?.fields || [];

  // Build section order from config or default
  const sectionOrder = (() => {
    const raw = (sc as Record<string, unknown>).__order as string[] | undefined;
    if (raw && Array.isArray(raw) && raw.length > 0) {
      const customKeys = customSections.map((_, i) => `custom:${i}`);
      const existing = new Set(raw);
      const result = [...raw];
      for (const k of customKeys) {
        if (!existing.has(k)) result.push(k);
      }
      if (!typeConfig?.has_hierarchy) return result.filter((k) => k !== "hierarchy");
      return result;
    }
    const order: string[] = ["description", "eol", "lifecycle"];
    customSections.forEach((_, i) => order.push(`custom:${i}`));
    if (typeConfig?.has_hierarchy) order.push("hierarchy");
    order.push("relations");
    return order;
  })();

  // Render a section by its key (used in the ordered section loop)
  const renderSection = (key: string) => {
    if (secHidden(key)) return null;
    const exp = secExpanded(key, key === "relations" ? false : true);

    if (key === "description") {
      return (
        <ErrorBoundary key={key} label="Description" inline>
          <DescriptionSection
            card={card}
            onSave={handleUpdate}
            canEdit={perms.can_edit}
            initialExpanded={exp}
            extraFields={descExtraFields.length > 0 ? descExtraFields : undefined}
            currencyFmt={currencyFmt}
          />
        </ErrorBoundary>
      );
    }
    if (key === "eol") {
      return (
        <ErrorBoundary key={key} label="End of Life" inline>
          <EolLinkSection card={card} onSave={handleUpdate} initialExpanded={exp ? undefined : false} />
        </ErrorBoundary>
      );
    }
    if (key === "lifecycle") {
      return (
        <ErrorBoundary key={key} label="Lifecycle" inline>
          <LifecycleSection card={card} onSave={handleUpdate} canEdit={perms.can_edit} initialExpanded={exp} />
        </ErrorBoundary>
      );
    }
    if (key === "hierarchy") {
      return (
        <ErrorBoundary key={key} label="Hierarchy" inline>
          <HierarchySection card={card} onUpdate={() => api.get<Card>(`/cards/${card.id}`).then(setCard)} canEdit={perms.can_edit} initialExpanded={exp} />
        </ErrorBoundary>
      );
    }
    if (key === "relations") {
      return (
        <ErrorBoundary key={key} label="Relations" inline>
          <RelationsSection fsId={card.id} cardTypeKey={card.type} refreshKey={relRefresh} canManageRelations={perms.can_manage_relations} initialExpanded={exp} />
        </ErrorBoundary>
      );
    }
    if (key.startsWith("custom:")) {
      const idx = parseInt(key.split(":")[1], 10);
      const section = customSections[idx];
      if (!section) return null;
      return (
        <ErrorBoundary key={key} label={section.section}>
          <AttributeSection
            section={section}
            card={card}
            onSave={handleUpdate}
            onRelationChange={() => setRelRefresh((n) => n + 1)}
            canEdit={perms.can_edit}
            calculatedFieldKeys={calcFieldKeys}
            initialExpanded={exp}
          />
        </ErrorBoundary>
      );
    }
    return null;
  };

  const handleUpdate = async (updates: Record<string, unknown>) => {
    const updated = await api.patch<Card>(`/cards/${card.id}`, updates);
    setCard(updated);
  };

  const handleApprovalAction = async (action: string) => {
    setApprovalMenuAnchor(null);
    await api.post(`/cards/${card.id}/approval-status?action=${action}`);
    const newStatus =
      action === "approve"
        ? "APPROVED"
        : action === "reject"
          ? "REJECTED"
          : "DRAFT";
    setCard({ ...card, approval_status: newStatus });
  };

  // ── Archive / Restore / Delete ───────────────────────────────
  const handleArchive = async () => {
    setArchiveDialogOpen(false);
    const updated = await api.post<Card>(`/cards/${card.id}/archive`);
    setCard(updated);
  };

  const handleRestore = async () => {
    const updated = await api.post<Card>(`/cards/${card.id}/restore`);
    setCard(updated);
  };

  const handleDelete = async () => {
    setDeleteDialogOpen(false);
    await api.delete(`/cards/${card.id}`);
    navigate("/inventory");
  };

  const isArchived = card.status === "ARCHIVED";
  const daysUntilPurge = card.archived_at
    ? Math.max(0, 30 - Math.floor((Date.now() - new Date(card.archived_at).getTime()) / 86400000))
    : null;

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
            {card.name}
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {typeConfig?.label || card.type}
            </Typography>
            {card.subtype && typeof card.subtype === "string" && (
              <Chip size="small" label={card.subtype} variant="outlined" sx={{ height: 20 }} />
            )}
          </Box>
        </Box>
        {/* Badges — wrap to second row on mobile */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: { xs: "100%", sm: "auto" }, justifyContent: { xs: "flex-end", sm: "flex-start" } }}>
          <DataQualityRing value={card.data_quality} />
          <LifecycleBadge lifecycle={card.lifecycle} />
          <ApprovalStatusBadge status={card.approval_status} />
          {perms.can_approval_status && (
            <Button
              size="small"
              variant="outlined"
              onClick={(e) => setApprovalMenuAnchor(e.currentTarget)}
              endIcon={<MaterialSymbol icon="arrow_drop_down" size={18} />}
            >
              Approval Status
            </Button>
          )}
        </Box>
        {perms.can_approval_status && (
          <Menu
            anchorEl={approvalMenuAnchor}
            open={!!approvalMenuAnchor}
            onClose={() => setApprovalMenuAnchor(null)}
          >
            <MenuItem
              onClick={() => handleApprovalAction("approve")}
              disabled={card.approval_status === "APPROVED"}
            >
              <MaterialSymbol icon="verified" size={18} color="#4caf50" />
              <Typography sx={{ ml: 1 }}>Approve</Typography>
            </MenuItem>
            <MenuItem
              onClick={() => handleApprovalAction("reject")}
              disabled={card.approval_status === "REJECTED"}
            >
              <MaterialSymbol icon="cancel" size={18} color="#f44336" />
              <Typography sx={{ ml: 1 }}>Reject</Typography>
            </MenuItem>
            <MenuItem
              onClick={() => handleApprovalAction("reset")}
              disabled={card.approval_status === "DRAFT"}
            >
              <MaterialSymbol icon="restart_alt" size={18} color="#9e9e9e" />
              <Typography sx={{ ml: 1 }}>Reset to Draft</Typography>
            </MenuItem>
          </Menu>
        )}
      </Box>

      {/* ── Archived banner ── */}
      {isArchived && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          action={
            <Box sx={{ display: "flex", gap: 1 }}>
              {perms.can_archive && (
                <Button size="small" color="inherit" onClick={handleRestore} startIcon={<MaterialSymbol icon="restore" size={18} />}>
                  Restore
                </Button>
              )}
              {perms.can_delete && (
                <Button size="small" color="error" onClick={() => setDeleteDialogOpen(true)} startIcon={<MaterialSymbol icon="delete_forever" size={18} />}>
                  Delete
                </Button>
              )}
            </Box>
          }
        >
          This card is archived.{daysUntilPurge !== null && ` It will be permanently deleted in ${daysUntilPurge} day${daysUntilPurge !== 1 ? "s" : ""}.`}
        </Alert>
      )}

      {/* ── Archive / Delete action buttons (active cards) ── */}
      {!isArchived && (perms.can_archive || perms.can_delete) && (
        <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mb: 1 }}>
          {perms.can_archive && (
            <Tooltip title="Archive this card">
              <Button
                size="small"
                color="warning"
                variant="outlined"
                onClick={() => setArchiveDialogOpen(true)}
                startIcon={<MaterialSymbol icon="archive" size={18} />}
              >
                Archive
              </Button>
            </Tooltip>
          )}
          {perms.can_delete && (
            <Tooltip title="Permanently delete this card">
              <Button
                size="small"
                color="error"
                variant="outlined"
                onClick={() => setDeleteDialogOpen(true)}
                startIcon={<MaterialSymbol icon="delete_forever" size={18} />}
              >
                Delete
              </Button>
            </Tooltip>
          )}
        </Box>
      )}

      {/* ── Archive confirmation dialog ── */}
      <Dialog open={archiveDialogOpen} onClose={() => setArchiveDialogOpen(false)}>
        <DialogTitle>Archive Card</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to archive <strong>{card.name}</strong>?
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Archived cards can be restored within 30 days. After that, they are permanently deleted.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setArchiveDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" color="warning" onClick={handleArchive}>Archive</Button>
        </DialogActions>
      </Dialog>

      {/* ── Delete confirmation dialog ── */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Permanently Delete Card</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to permanently delete <strong>{card.name}</strong>?
          </Typography>
          <Typography variant="body2" color="error" sx={{ mt: 1 }}>
            This action cannot be undone. The card and all its relations will be removed.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleDelete}>Delete Permanently</Button>
        </DialogActions>
      </Dialog>

      {/* ── Top-level tabs ── */}
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}
      >
        <Tab label="Card" />
        {card.type === "BusinessProcess" && <Tab label="Process Flow" />}
        {card.type === "BusinessProcess" && <Tab label="Assessments" />}
        <Tab label="Comments" />
        <Tab label="Todos" />
        <Tab label="Stakeholders" />
        <Tab label="History" />
      </Tabs>

      {/* ── Tab content ── */}
      {card.type === "BusinessProcess" ? (
        <>
          {tab === 0 && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {sectionOrder.map(renderSection)}
            </Box>
          )}
          {tab === 1 && <ErrorBoundary label="Process Flow"><MuiCard><CardContent><ProcessFlowTab processId={card.id} processName={card.name} initialSubTab={initialSubTab} /></CardContent></MuiCard></ErrorBoundary>}
          {tab === 2 && <ErrorBoundary label="Assessments"><MuiCard><CardContent><ProcessAssessmentPanel processId={card.id} /></CardContent></MuiCard></ErrorBoundary>}
          {tab === 3 && <ErrorBoundary label="Comments"><MuiCard><CardContent><CommentsTab fsId={card.id} canCreateComments={perms.can_create_comments} canManageComments={perms.can_manage_comments} /></CardContent></MuiCard></ErrorBoundary>}
          {tab === 4 && <ErrorBoundary label="Todos"><MuiCard><CardContent><TodosTab fsId={card.id} /></CardContent></MuiCard></ErrorBoundary>}
          {tab === 5 && <ErrorBoundary label="Stakeholders"><MuiCard><CardContent><StakeholdersTab card={card} onRefresh={() => api.get<Card>(`/cards/${card.id}`).then(setCard)} canManageStakeholders={perms.can_manage_stakeholders} /></CardContent></MuiCard></ErrorBoundary>}
          {tab === 6 && <ErrorBoundary label="History"><MuiCard><CardContent><HistoryTab fsId={card.id} /></CardContent></MuiCard></ErrorBoundary>}
        </>
      ) : (
        <>
          {tab === 0 && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {sectionOrder.map(renderSection)}
            </Box>
          )}
          {tab === 1 && <ErrorBoundary label="Comments"><MuiCard><CardContent><CommentsTab fsId={card.id} canCreateComments={perms.can_create_comments} canManageComments={perms.can_manage_comments} /></CardContent></MuiCard></ErrorBoundary>}
          {tab === 2 && <ErrorBoundary label="Todos"><MuiCard><CardContent><TodosTab fsId={card.id} /></CardContent></MuiCard></ErrorBoundary>}
          {tab === 3 && <ErrorBoundary label="Stakeholders"><MuiCard><CardContent><StakeholdersTab card={card} onRefresh={() => api.get<Card>(`/cards/${card.id}`).then(setCard)} canManageStakeholders={perms.can_manage_stakeholders} /></CardContent></MuiCard></ErrorBoundary>}
          {tab === 4 && <ErrorBoundary label="History"><MuiCard><CardContent><HistoryTab fsId={card.id} /></CardContent></MuiCard></ErrorBoundary>}
        </>
      )}
    </Box>
  );
}
