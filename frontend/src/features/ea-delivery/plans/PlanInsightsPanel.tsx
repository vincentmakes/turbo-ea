/**
 * The "consequences" panel for an architecture plan: a TOGAF-style gap analysis
 * (Added / Removed / Changed / Retained), an impact strip (cost delta, risk on
 * affected cards), and capability-coverage warnings. Rendered in both the editor
 * (live) and the read-only preview so a plan reads as an architecture decision,
 * not just a diagram. All figures come from the pure helpers in planInsights.ts.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useCurrency } from "@/hooks/useCurrency";
import { useMetamodel } from "@/hooks/useMetamodel";
import { LDV_CHANGE_COLORS } from "@/features/reports/LayeredDependencyView";
import type { PlanChangeOp } from "@/types";
import type { PlanGraph } from "./planGraph";
import {
  affectedRealCardIds,
  computeCapabilityCoverage,
  computeCostDelta,
  computeGapBuckets,
} from "./planInsights";
import { fetchAffectedRiskSummary } from "./planRisk";

const RETAINED_COLOR = "#78909c";

export default function PlanInsightsPanel({
  graph,
  changes,
}: {
  graph: PlanGraph;
  changes: PlanChangeOp[];
}) {
  const { t } = useTranslation("delivery");
  const { types } = useMetamodel();
  const { fmt } = useCurrency();

  const gap = useMemo(() => computeGapBuckets(graph), [graph]);
  const cost = useMemo(() => computeCostDelta(graph, types, changes), [graph, types, changes]);
  const coverage = useMemo(() => computeCapabilityCoverage(graph), [graph]);

  // Risk is an async fan-out over the affected real cards.
  const affectedIds = useMemo(() => affectedRealCardIds(changes), [changes]);
  const affectedKey = affectedIds.join(",");
  const [risk, setRisk] = useState<{ total: number; high: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setRisk(null);
    if (affectedIds.length === 0) {
      setRisk({ total: 0, high: 0 });
      return;
    }
    fetchAffectedRiskSummary(affectedIds).then((r) => {
      if (!cancelled) setRisk(r);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [affectedKey]);

  const deltaSign = cost.delta > 0 ? "+" : cost.delta < 0 ? "−" : "";
  const deltaColor =
    cost.delta > 0 ? LDV_CHANGE_COLORS.removed : cost.delta < 0 ? LDV_CHANGE_COLORS.added : "text.secondary";

  const gapItems: { key: string; label: string; count: number; color: string }[] = [
    { key: "added", label: t("plan.gap.added"), count: gap.added.length, color: LDV_CHANGE_COLORS.added },
    { key: "removed", label: t("plan.gap.removed"), count: gap.removed.length, color: LDV_CHANGE_COLORS.removed },
    { key: "changed", label: t("plan.gap.changed"), count: gap.changed.length, color: LDV_CHANGE_COLORS.changed },
    { key: "retained", label: t("plan.gap.retained"), count: gap.retained.length, color: RETAINED_COLOR },
  ];

  return (
    <Paper sx={{ p: 2.5 }}>
      <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5 }}>
        {t("plan.insights.title")}
      </Typography>

      {/* Gap analysis */}
      <Typography variant="overline" color="text.secondary">
        {t("plan.gap.title")}
      </Typography>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
          gap: 1,
          mt: 0.5,
          mb: 2,
        }}
      >
        {gapItems.map((g) => (
          <Box
            key={g.key}
            sx={{
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
              p: 1,
              borderLeft: `3px solid ${g.color}`,
            }}
          >
            <Typography variant="h5" fontWeight={700} sx={{ color: g.color, lineHeight: 1.1 }}>
              {g.count}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {g.label}
            </Typography>
          </Box>
        ))}
      </Box>

      <Divider sx={{ mb: 1.5 }} />

      {/* Impact strip: cost + risk */}
      <Typography variant="overline" color="text.secondary">
        {t("plan.insights.impact")}
      </Typography>
      <Stack direction="row" spacing={3} sx={{ mt: 0.5, mb: 1.5, flexWrap: "wrap" }} useFlexGap>
        <Box>
          <Typography variant="caption" color="text.secondary" display="block">
            {t("plan.insights.annualCost")}
          </Typography>
          <Typography variant="body2">
            {fmt.format(cost.before)} → {fmt.format(cost.after)}
          </Typography>
          <Typography variant="body2" sx={{ color: deltaColor, fontWeight: 600 }}>
            {deltaSign}
            {fmt.format(Math.abs(cost.delta))}
            {cost.approximate ? ` (${t("plan.insights.estimated")})` : ""}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary" display="block">
            {t("plan.insights.riskOnAffected")}
          </Typography>
          {risk === null ? (
            <Typography variant="body2" color="text.secondary">
              …
            </Typography>
          ) : (
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="body2">{risk.total}</Typography>
              {risk.high > 0 && (
                <Chip
                  size="small"
                  label={t("plan.insights.highCritical", { count: risk.high })}
                  sx={{ height: 20, bgcolor: LDV_CHANGE_COLORS.removed, color: "#fff" }}
                />
              )}
            </Stack>
          )}
        </Box>
      </Stack>

      {/* Capability coverage warnings */}
      {coverage.length > 0 && (
        <Alert
          severity="warning"
          icon={<MaterialSymbol icon="warning" size={20} />}
          sx={{ mt: 1 }}
        >
          <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
            {t("plan.insights.coverageTitle")}
          </Typography>
          <Stack spacing={0.25}>
            {coverage.map((c) => (
              <Typography key={c.capabilityId} variant="body2">
                {t("plan.insights.coverageItem", { name: c.capabilityName, count: c.baselineApps })}
              </Typography>
            ))}
          </Stack>
        </Alert>
      )}
    </Paper>
  );
}
