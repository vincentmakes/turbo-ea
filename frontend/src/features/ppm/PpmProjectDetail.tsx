import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router";
import Box from "@mui/material/Box";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import CircularProgress from "@mui/material/CircularProgress";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api, ApiError } from "@/api/client";
import { useCardSubtypeLabel } from "@/hooks/useCardSubtypeLabel";
import PpmOverviewTab from "./PpmOverviewTab";
import PpmReportsTab from "./PpmReportsTab";
import PpmCostTab from "./PpmCostTab";
import PpmRiskTab from "./PpmRiskTab";
import PpmTaskBoard from "./PpmTaskBoard";
import PpmGanttTab from "./PpmGanttTab";
import CardDetailContent from "@/features/cards/CardDetailContent";
import type { Card, CardEffectivePermissions, PpmStatusReport, PpmCostLine, PpmBudgetLine, PpmRisk } from "@/types";

const TAB_KEYS = ["overview", "reports", "cost", "risks", "tasks", "gantt", "details"];

export default function PpmProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useTranslation(["ppm", "common"]);

  const subtypeLabel = useCardSubtypeLabel();
  const initialTab = TAB_KEYS.indexOf(searchParams.get("tab") || "overview");
  const [tab, setTab] = useState(initialTab >= 0 ? initialTab : 0);

  const handleTabChange = useCallback(
    (_: unknown, v: number) => {
      setTab(v);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", TAB_KEYS[v]);
        return next;
      }, { replace: true });
    },
    [setSearchParams],
  );
  const [card, setCard] = useState<Card | null>(null);
  const [reports, setReports] = useState<PpmStatusReport[]>([]);
  const [costLines, setCostLines] = useState<PpmCostLine[]>([]);
  const [budgetLines, setBudgetLines] = useState<PpmBudgetLine[]>([]);
  const [risks, setRisks] = useState<PpmRisk[]>([]);
  const [perms, setPerms] = useState<CardEffectivePermissions["effective"]>({
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
    can_manage_adr_links: true,
    can_manage_diagram_links: true,
    can_view_costs: true,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    if (!id) return;
    setError("");
    try {
      const [c, r, cl, bl, ri] = await Promise.all([
        api.get<Card>(`/cards/${id}`),
        api.get<PpmStatusReport[]>(`/ppm/initiatives/${id}/reports`),
        api.get<PpmCostLine[]>(`/ppm/initiatives/${id}/costs`),
        api.get<PpmBudgetLine[]>(`/ppm/initiatives/${id}/budgets`),
        api.get<PpmRisk[]>(`/ppm/initiatives/${id}/risks`),
      ]);
      setCard(c);
      setReports(r);
      setCostLines(cl);
      setBudgetLines(bl);
      setRisks(ri);
      // Fetch effective permissions (non-blocking)
      api
        .get<CardEffectivePermissions>(`/cards/${id}/my-permissions`)
        .then((res) => setPerms(res.effective))
        .catch(() => {});
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setError(t("common:errors.forbidden"));
      } else if (e instanceof ApiError && e.status === 404) {
        setError(t("common:errors.notFound"));
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // When PPM has budget/cost lines, mark card cost fields as auto-computed
  const ppmAutoFieldKeys = useMemo(() => {
    const keys: string[] = [];
    if (budgetLines.length > 0) keys.push("costBudget");
    if (costLines.length > 0) keys.push("costActual");
    return keys;
  }, [budgetLines.length, costLines.length]);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" mt={8}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !card) {
    return (
      <Box sx={{ p: { xs: 1.5, sm: 3 }, maxWidth: 1400, mx: "auto" }}>
        <Box display="flex" alignItems="center" gap={1} mb={2}>
          <IconButton sx={{ flexShrink: 0 }} onClick={() => navigate("/ppm")}>
            <MaterialSymbol icon="arrow_back" size={20} />
          </IconButton>
        </Box>
        <Alert severity="error">{error || t("common:errors.notFound")}</Alert>
      </Box>
    );
  }

  const latestReport = reports[0] || null;

  return (
    <Box sx={{ p: { xs: 1.5, sm: 3 }, maxWidth: 1400, mx: "auto" }}>
      {/* Header */}
      <Box display="flex" alignItems="center" gap={1} mb={2}>
        <IconButton sx={{ flexShrink: 0 }} onClick={() => navigate("/ppm")}>
          <MaterialSymbol icon="arrow_back" size={20} />
        </IconButton>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            variant="h5"
            fontWeight={700}
            noWrap
            sx={{ fontSize: { xs: "1.25rem", sm: "1.5rem" } }}
          >
            {card.name}
          </Typography>
        </Box>
        {card.subtype && (
          <Chip
            label={subtypeLabel(card.type, card.subtype)}
            size="small"
            variant="outlined"
            sx={{ marginInlineStart: 1, flexShrink: 0 }}
          />
        )}
      </Box>

      {/* Tabs */}
      <Tabs
        value={tab}
        onChange={handleTabChange}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{ mb: 3 }}
      >
        <Tab label={t("overview")} />
        <Tab label={t("statusReports")} />
        <Tab label={t("budgetAndCosts")} />
        <Tab label={t("riskManagement")} />
        <Tab label={t("tasks")} />
        <Tab label={t("gantt")} />
        <Tab label={t("cardDetails")} />
      </Tabs>

      {/* Tab Content */}
      {tab === 0 && (
        <PpmOverviewTab
          card={card}
          latestReport={latestReport}
          costLines={costLines}
          budgetLines={budgetLines}
        />
      )}
      {tab === 1 && (
        <PpmReportsTab
          initiativeId={id!}
          reports={reports}
          onRefresh={loadData}
        />
      )}
      {tab === 2 && (
        <PpmCostTab
          initiativeId={id!}
          costLines={costLines}
          onRefresh={loadData}
        />
      )}
      {tab === 3 && (
        <PpmRiskTab
          initiativeId={id!}
          risks={risks}
          onRefresh={loadData}
        />
      )}
      {tab === 4 && <PpmTaskBoard initiativeId={id!} />}
      {tab === 5 && <PpmGanttTab initiativeId={id!} card={card ?? undefined} />}
      {tab === 6 && (
        <CardDetailContent
          key={card.id}
          card={card}
          perms={perms}
          onCardUpdate={(updated) => setCard(updated)}
          showBpmTabs={false}
          showPpmTab={false}
          autoFieldKeys={ppmAutoFieldKeys}
        />
      )}
    </Box>
  );
}
