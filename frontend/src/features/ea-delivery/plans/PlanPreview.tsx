/**
 * Read-only architecture-plan preview — the shareable deliverable. Renders the
 * plan header, the supported business objectives, the grouped change list, and
 * the merged before/after Layered Dependency View. Drafts can be committed
 * from here (gated on `arch_plans.commit`).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useAuth } from "@/hooks/useAuth";
import { useMetamodel } from "@/hooks/useMetamodel";
import { usePermissions } from "@/hooks/usePermissions";
import LayeredDependencyView, {
  LDV_CHANGE_COLORS,
} from "@/features/reports/LayeredDependencyView";
import type { GEdge, GNode } from "@/features/reports/layeredDependencyLayout";
import type {
  ArchitecturePlan,
  PlanCardRef,
  PlanChangeOp,
  PlanCommitResult,
} from "@/types";
import PlanCommitDialog from "./PlanCommitDialog";
import PlanInsightsPanel from "./PlanInsightsPanel";
import { buildPlanGraph } from "./planGraph";

const OP_META: Record<PlanChangeOp["op"], { icon: string; color: string }> = {
  add_card: { icon: "add_circle", color: LDV_CHANGE_COLORS.added },
  remove_card: { icon: "cancel", color: LDV_CHANGE_COLORS.removed },
  replace_card: { icon: "swap_horiz", color: LDV_CHANGE_COLORS.changed },
  add_relation: { icon: "add_link", color: LDV_CHANGE_COLORS.added },
  remove_relation: { icon: "link_off", color: LDV_CHANGE_COLORS.removed },
};

export default function PlanPreview() {
  const { t } = useTranslation(["delivery", "common"]);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { types, relationTypes } = useMetamodel();
  const { user } = useAuth();
  const { can } = usePermissions(user);

  const [plan, setPlan] = useState<ArchitecturePlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [commitOpen, setCommitOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api
      .get<ArchitecturePlan>(`/architecture-plans/${id}`)
      .then(setPlan)
      .catch((err) => setError(err.message || "Failed to load plan"))
      .finally(() => setLoading(false));
  }, [id]);

  const baseline = plan?.plan_data?.baseline;
  const changes = useMemo(() => plan?.plan_data?.changes ?? [], [plan?.plan_data]);
  const scope = (plan?.scope ?? {}) as Record<string, unknown>;
  const objectives = (scope.objectiveRefs as { id: string; name: string }[]) ?? [];

  const cardLookup = useMemo(() => {
    const refs =
      ((plan?.plan_data as Record<string, unknown> | undefined)?.cardRefs as Record<
        string,
        { name: string; type: string }
      >) ?? {};
    return new Map(Object.entries(refs));
  }, [plan?.plan_data]);

  const merged = useMemo(() => {
    if (!baseline) return { nodes: [] as GNode[], edges: [] as GEdge[] };
    return buildPlanGraph(baseline, changes, relationTypes, cardLookup);
  }, [baseline, changes, relationTypes, cardLookup]);

  const nodeName = useCallback(
    (nid: string) =>
      merged.nodes.find((n) => n.id === nid)?.name ?? cardLookup.get(nid)?.name ?? nid,
    [merged.nodes, cardLookup],
  );

  const describeOp = useCallback(
    (op: PlanChangeOp): string => {
      const refName = (ref: PlanCardRef) =>
        "proposed" in ref ? ref.proposed.name : nodeName(ref.existingCardId);
      switch (op.op) {
        case "add_card":
          return t("plan.opDesc.addCard", { name: refName(op.card) });
        case "remove_card":
          return t("plan.opDesc.removeCard", { name: nodeName(op.cardId) });
        case "replace_card":
          return t("plan.opDesc.replaceCard", {
            predecessor: nodeName(op.predecessorId),
            successor: refName(op.successor),
          });
        case "add_relation":
          return t("plan.opDesc.addRelation", {
            source: nodeName(op.sourceId),
            target: nodeName(op.targetId),
          });
        case "remove_relation":
          return t("plan.opDesc.removeRelation", {
            source: nodeName(op.sourceId),
            target: nodeName(op.targetId),
          });
      }
    },
    [nodeName, t],
  );

  const onCommitted = (result: PlanCommitResult) => {
    setPlan((prev) =>
      prev ? { ...prev, status: "committed", initiative_id: result.initiative_id } : prev,
    );
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (error || !plan) {
    return <Alert severity="error">{error || t("plan.notFound")}</Alert>;
  }

  const isDraft = plan.status === "draft";

  return (
    <Box sx={{ maxWidth: 1250, mx: "auto" }}>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
        <Button
          variant="text"
          size="small"
          onClick={() => navigate("/reports/ea-delivery")}
          startIcon={<MaterialSymbol icon="arrow_back" size={18} />}
        >
          {t("plan.backToDelivery")}
        </Button>
        <Box sx={{ flex: 1 }} />
        {isDraft && can("arch_plans.manage") && (
          <Button
            size="small"
            variant="outlined"
            onClick={() => navigate(`/ea-delivery/plans/${plan.id}`)}
            startIcon={<MaterialSymbol icon="edit" size={18} />}
          >
            {t("common:actions.edit")}
          </Button>
        )}
        {isDraft && can("arch_plans.commit") && changes.length > 0 && (
          <Button
            size="small"
            variant="contained"
            onClick={() => setCommitOpen(true)}
            startIcon={<MaterialSymbol icon="rocket_launch" size={18} />}
          >
            {t("plan.commit.title")}
          </Button>
        )}
      </Stack>

      <Paper sx={{ p: 3, mb: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="h6">{plan.title}</Typography>
          <Chip
            size="small"
            label={isDraft ? t("plan.status.draft") : t("plan.status.committed")}
            color={isDraft ? "primary" : "success"}
          />
        </Stack>
        {plan.description && (
          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-wrap" }}>
            {plan.description}
          </Typography>
        )}
        {objectives.length > 0 && (
          <Box sx={{ mt: 1.5 }}>
            <Typography variant="caption" fontWeight={600}>
              {t("plan.objectivesStep.title")}:
            </Typography>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
              {objectives.map((o) => (
                <Chip key={o.id} label={o.name} size="small" variant="outlined" />
              ))}
            </Stack>
          </Box>
        )}
        {plan.status === "committed" && plan.initiative_id && (
          <Alert
            severity="success"
            sx={{ mt: 2 }}
            action={
              <Button size="small" onClick={() => navigate(`/cards/${plan.initiative_id}`)}>
                {t("plan.commit.openInitiative")}
              </Button>
            }
          >
            {t("plan.linkedInitiative")}
          </Alert>
        )}
      </Paper>

      {changes.length > 0 && (
        <Paper sx={{ p: 3, mb: 2 }}>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5 }}>
            {t("plan.ops.title")}
          </Typography>
          <Stack spacing={0.5}>
            {changes.map((op, i) => (
              <Stack key={i} direction="row" spacing={1} alignItems="center">
                <MaterialSymbol icon={OP_META[op.op].icon} size={18} color={OP_META[op.op].color} />
                <Typography variant="body2">{describeOp(op)}</Typography>
              </Stack>
            ))}
          </Stack>
        </Paper>
      )}

      {baseline && changes.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <PlanInsightsPanel graph={merged} changes={changes} />
        </Box>
      )}

      {baseline && (
        <Paper sx={{ height: 560, mb: 2, overflow: "hidden" }}>
          <LayeredDependencyView
            nodes={merged.nodes}
            edges={merged.edges}
            types={types}
            onNodeClick={() => undefined}
            onHome={() => undefined}
          />
        </Paper>
      )}

      {commitOpen && (
        <PlanCommitDialog
          plan={plan}
          describeOp={describeOp}
          onClose={() => setCommitOpen(false)}
          onCommitted={onCommitted}
        />
      )}
    </Box>
  );
}
