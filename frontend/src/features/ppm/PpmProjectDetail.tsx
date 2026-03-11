import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import CircularProgress from "@mui/material/CircularProgress";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useResolveLabel } from "@/hooks/useResolveLabel";
import PpmOverviewTab from "./PpmOverviewTab";
import PpmReportsTab from "./PpmReportsTab";
import PpmCostTab from "./PpmCostTab";
import PpmRiskTab from "./PpmRiskTab";
import PpmTaskBoard from "./PpmTaskBoard";
import PpmGanttTab from "./PpmGanttTab";
import PpmCardDetailsTab from "./PpmCardDetailsTab";
import type { Card, PpmStatusReport, PpmCostLine, PpmBudgetLine, PpmRisk } from "@/types";

const TAB_KEYS = ["overview", "reports", "cost", "risks", "tasks", "gantt", "details"];

export default function PpmProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation("ppm");

  const { getType } = useMetamodel();
  const rl = useResolveLabel();
  const initialTab = TAB_KEYS.indexOf(searchParams.get("tab") || "overview");
  const [tab, setTab] = useState(initialTab >= 0 ? initialTab : 0);
  const [card, setCard] = useState<Card | null>(null);
  const [reports, setReports] = useState<PpmStatusReport[]>([]);
  const [costLines, setCostLines] = useState<PpmCostLine[]>([]);
  const [budgetLines, setBudgetLines] = useState<PpmBudgetLine[]>([]);
  const [risks, setRisks] = useState<PpmRisk[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!id) return;
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
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" mt={8}>
        <CircularProgress />
      </Box>
    );
  }

  if (!card) return null;

  const latestReport = reports[0] || null;

  return (
    <Box sx={{ p: 3, maxWidth: 1400, mx: "auto" }}>
      {/* Header */}
      <Box display="flex" alignItems="center" gap={1} mb={2}>
        <IconButton onClick={() => navigate("/ppm")}>
          <MaterialSymbol icon="arrow_back" size={20} />
        </IconButton>
        <Typography variant="h5" fontWeight={700}>
          {card.name}
        </Typography>
        {card.subtype && (() => {
          const typeConfig = getType(card.type);
          const st = typeConfig?.subtypes?.find(
            (s: { key: string }) => s.key === card.subtype,
          );
          const label = st ? rl(st.label, st.translations) : card.subtype;
          return (
            <Chip
              label={label}
              size="small"
              variant="outlined"
              sx={{ ml: 1 }}
            />
          );
        })()}
      </Box>

      {/* Tabs */}
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
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
      {tab === 5 && <PpmGanttTab initiativeId={id!} />}
      {tab === 6 && (
        <PpmCardDetailsTab
          card={card}
          canEdit
          onCardUpdate={(updated) => setCard(updated)}
        />
      )}
    </Box>
  );
}
