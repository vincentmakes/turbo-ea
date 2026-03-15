import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import Switch from "@mui/material/Switch";
import Tooltip from "@mui/material/Tooltip";
import Paper from "@mui/material/Paper";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useMetamodel } from "@/hooks/useMetamodel";
import { api, ApiError } from "@/api/client";
import type {
  ArchGap,
  ArchSolutionOption,
  CapabilityMappingResult,
  DependencyAnalysisResult,
  GapAnalysisResult,
} from "@/types";
import type { GNode, GEdge } from "@/features/reports/c4Layout";
import Step from "@mui/material/Step";
import StepLabel from "@mui/material/StepLabel";
import Stepper from "@mui/material/Stepper";
import CommitInitiativeDialog from "./CommitInitiativeDialog";
import {
  urgencyColor,
  effortColor,
  approachColor,
  ARCHITECT_STEPS,
  phaseToStepIndex,
} from "./utils";
import C4DiagramView from "@/features/reports/C4DiagramView";

// --- Option card component ---

function OptionCard({
  option,
  onSelect,
  loading,
}: {
  option: ArchSolutionOption;
  onSelect: () => void;
  loading: boolean;
}) {
  const { t } = useTranslation("admin");
  const { types } = useMetamodel();

  const typeInfo = (key: string) => types.find((tp) => tp.key === key);

  const impact = option.impactPreview;
  const hasImpact =
    impact &&
    ((impact.newComponents?.length ?? 0) > 0 ||
      (impact.modifiedComponents?.length ?? 0) > 0 ||
      (impact.newIntegrations?.length ?? 0) > 0 ||
      (impact.retiredComponents?.length ?? 0) > 0);

  return (
    <Card
      variant="outlined"
      sx={{ height: "100%", display: "flex", flexDirection: "column" }}
    >
      <CardContent sx={{ flex: 1 }}>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="flex-start"
          sx={{ mb: 1 }}
        >
          <Typography variant="subtitle1" fontWeight={700}>
            {option.title}
          </Typography>
          <Chip
            label={t(`archlens_architect_approach_${option.approach}`)}
            size="small"
            color={approachColor(option.approach)}
            sx={{ fontWeight: 600, textTransform: "capitalize" }}
          />
        </Stack>

        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mb: 1.5, lineHeight: 1.6 }}
        >
          {option.summary}
        </Typography>

        <Stack spacing={0.3} sx={{ mb: 1.5 }}>
          {option.pros?.map((p, i) => (
            <Typography key={`p${i}`} variant="caption" sx={{ color: "success.main" }}>
              + {p}
            </Typography>
          ))}
          {option.cons?.map((c, i) => (
            <Typography key={`c${i}`} variant="caption" color="text.secondary">
              - {c}
            </Typography>
          ))}
        </Stack>

        <Stack
          direction="row"
          spacing={0.5}
          flexWrap="wrap"
          useFlexGap
          sx={{ mb: 1.5 }}
        >
          {option.estimatedCost && (
            <Chip
              label={option.estimatedCost}
              size="small"
              variant="outlined"
              sx={{ fontSize: 10, height: 20 }}
            />
          )}
          {option.estimatedDuration && (
            <Chip
              label={option.estimatedDuration}
              size="small"
              variant="outlined"
              sx={{ fontSize: 10, height: 20 }}
            />
          )}
          {option.estimatedComplexity && (
            <Chip
              label={option.estimatedComplexity.replace("_", " ")}
              size="small"
              color={effortColor(
                option.estimatedComplexity === "very_high"
                  ? "high"
                  : option.estimatedComplexity,
              )}
              variant="outlined"
              sx={{ fontSize: 10, height: 20 }}
            />
          )}
        </Stack>

        {hasImpact && (
          <Box sx={{ borderTop: 1, borderColor: "divider", pt: 1.5 }}>
            <Typography
              variant="overline"
              color="text.secondary"
              sx={{ fontSize: 10, mb: 1, display: "block" }}
            >
              {t("archlens_architect_impact_preview")}
            </Typography>

            {(impact.newComponents?.length ?? 0) > 0 && (
              <Box sx={{ mb: 1 }}>
                <Typography
                  variant="caption"
                  fontWeight={600}
                  color="primary"
                  sx={{ display: "block", mb: 0.3 }}
                >
                  + {t("archlens_architect_new_components")}
                </Typography>
                {impact.newComponents.map((c, i) => {
                  const ti = typeInfo(c.cardTypeKey);
                  return (
                    <Stack
                      key={i}
                      direction="row"
                      spacing={0.5}
                      alignItems="center"
                      sx={{ ml: 1, mb: 0.3 }}
                    >
                      {ti && (
                        <MaterialSymbol icon={ti.icon} size={14} color={ti.color} />
                      )}
                      <Typography variant="caption">{c.name}</Typography>
                      {c.subtype && (
                        <Typography variant="caption" color="text.secondary">
                          ({c.subtype})
                        </Typography>
                      )}
                    </Stack>
                  );
                })}
              </Box>
            )}

            {(impact.modifiedComponents?.length ?? 0) > 0 && (
              <Box sx={{ mb: 1 }}>
                <Typography
                  variant="caption"
                  fontWeight={600}
                  color="warning.main"
                  sx={{ display: "block", mb: 0.3 }}
                >
                  ~ {t("archlens_architect_modified_components")}
                </Typography>
                {impact.modifiedComponents.map((c, i) => {
                  const ti = typeInfo(c.cardTypeKey);
                  return (
                    <Stack
                      key={i}
                      direction="row"
                      spacing={0.5}
                      alignItems="center"
                      sx={{ ml: 1, mb: 0.3 }}
                    >
                      {ti && (
                        <MaterialSymbol icon={ti.icon} size={14} color={ti.color} />
                      )}
                      <Typography variant="caption">{c.name}</Typography>
                      {c.change && (
                        <Typography variant="caption" color="text.secondary">
                          — {c.change}
                        </Typography>
                      )}
                    </Stack>
                  );
                })}
              </Box>
            )}

            {(impact.newIntegrations?.length ?? 0) > 0 && (
              <Box sx={{ mb: 1 }}>
                <Typography
                  variant="caption"
                  fontWeight={600}
                  sx={{ display: "block", mb: 0.3, color: "#0f7eb5" }}
                >
                  {t("archlens_architect_new_integrations")}
                </Typography>
                {impact.newIntegrations.map((intg, i) => (
                  <Stack
                    key={i}
                    direction="row"
                    spacing={0.5}
                    alignItems="center"
                    sx={{ ml: 1, mb: 0.3 }}
                  >
                    <Typography variant="caption">{intg.from}</Typography>
                    <MaterialSymbol icon="arrow_forward" size={12} color="#999" />
                    <Typography variant="caption">{intg.to}</Typography>
                    {intg.protocol && (
                      <Chip
                        label={intg.protocol}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: 9, height: 16, ml: 0.5 }}
                      />
                    )}
                  </Stack>
                ))}
              </Box>
            )}

            {(impact.retiredComponents?.length ?? 0) > 0 && (
              <Box sx={{ mb: 1 }}>
                <Typography
                  variant="caption"
                  fontWeight={600}
                  color="error"
                  sx={{ display: "block", mb: 0.3 }}
                >
                  - {t("archlens_architect_retired_components")}
                </Typography>
                {impact.retiredComponents.map((c, i) => {
                  const ti = typeInfo(c.cardTypeKey);
                  return (
                    <Stack
                      key={i}
                      direction="row"
                      spacing={0.5}
                      alignItems="center"
                      sx={{ ml: 1, mb: 0.3 }}
                    >
                      {ti && (
                        <MaterialSymbol icon={ti.icon} size={14} color={ti.color} />
                      )}
                      <Typography
                        variant="caption"
                        sx={{ textDecoration: "line-through" }}
                      >
                        {c.name}
                      </Typography>
                    </Stack>
                  );
                })}
              </Box>
            )}
          </Box>
        )}
      </CardContent>
      <Box sx={{ px: 2, pb: 2 }}>
        <Button
          variant="contained"
          fullWidth
          onClick={onSelect}
          disabled={loading}
          startIcon={
            loading ? (
              <CircularProgress size={16} />
            ) : (
              <MaterialSymbol icon="check" size={18} />
            )
          }
        >
          {t("archlens_architect_select_option")}
        </Button>
      </Box>
    </Card>
  );
}

// --- Gaps view component ---

/** Key for a specific recommendation within a gap: "gapIndex:recIndex" */
type RecKey = string;
const recKey = (gi: number, ri: number): RecKey => `${gi}:${ri}`;

function GapsView({
  gaps,
  summary,
  selectedRecs,
  onToggleRec,
}: {
  gaps: ArchGap[];
  summary?: string;
  selectedRecs?: Set<RecKey>;
  onToggleRec?: (key: RecKey) => void;
}) {
  const { t } = useTranslation("admin");

  if (gaps.length === 0) {
    return (
      <Alert severity="success">{t("archlens_arch_no_gaps")}</Alert>
    );
  }

  return (
    <>
      {summary && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Typography variant="body2" sx={{ lineHeight: 1.6 }}>
            {summary}
          </Typography>
        </Paper>
      )}
      <Stack spacing={3}>
        {gaps.map((gap, gi) => (
          <Paper
            key={gi}
            variant="outlined"
            sx={{
              borderTop: 3,
              borderColor:
                gap.urgency === "critical"
                  ? "error.main"
                  : gap.urgency === "high"
                    ? "warning.main"
                    : "grey.400",
            }}
          >
            <Box
              sx={{
                px: 2,
                py: 1.5,
                borderBottom: 1,
                borderColor: "divider",
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <Typography variant="subtitle2" fontWeight={700}>
                  {gap.capability}
                </Typography>
                {gap.urgency && (
                  <Chip
                    label={gap.urgency.toUpperCase()}
                    size="small"
                    color={urgencyColor(gap.urgency)}
                    sx={{ fontSize: 10, fontWeight: 700, height: 20 }}
                  />
                )}
              </Stack>
              {gap.impact && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  display="block"
                  sx={{ mt: 0.5 }}
                >
                  {t("archlens_arch_impact")}: {gap.impact}
                </Typography>
              )}
            </Box>
            <Box sx={{ p: 2 }}>
              <Typography
                variant="overline"
                color="text.secondary"
                sx={{ fontSize: 10, mb: 1.5, display: "block" }}
              >
                {t("archlens_arch_market_recommendations")}
              </Typography>
              <Grid container spacing={1.5}>
                {(gap.recommendations ?? []).map((rec, ri) => {
                  const rk = recKey(gi, ri);
                  const isSelected = selectedRecs?.has(rk);
                  const selectable = !!onToggleRec;
                  return (
                  <Grid item key={ri} xs={12} sm={6} md={4}>
                    <Paper
                      variant="outlined"
                      onClick={selectable ? () => onToggleRec(rk) : undefined}
                      sx={{
                        p: 2,
                        height: "100%",
                        bgcolor: isSelected
                          ? "action.selected"
                          : rec.recommended
                            ? "primary.50"
                            : undefined,
                        borderTop: 3,
                        borderColor:
                          ri === 0
                            ? "#FFD700"
                            : ri === 1
                              ? "#C0C0C0"
                              : "#CD7F32",
                        cursor: selectable ? "pointer" : undefined,
                        outline: isSelected ? "2px solid" : undefined,
                        outlineColor: isSelected ? "primary.main" : undefined,
                        transition: "outline 0.15s, background-color 0.15s",
                      }}
                    >
                      {selectable && (
                        <Checkbox
                          size="small"
                          checked={!!isSelected}
                          sx={{ float: "right", mt: -0.5, mr: -0.5 }}
                          tabIndex={-1}
                        />
                      )}
                      <Stack
                        direction="row"
                        spacing={1}
                        alignItems="center"
                        sx={{ mb: 0.5 }}
                      >
                        <Typography
                          variant="caption"
                          fontWeight={700}
                          sx={{
                            color:
                              ri === 0
                                ? "#B8860B"
                                : ri === 1
                                  ? "#808080"
                                  : "#8B4513",
                          }}
                        >
                          #{ri + 1}
                        </Typography>
                        <Typography variant="body2" fontWeight={600}>
                          {rec.name}
                        </Typography>
                        {rec.recommended && (
                          <Chip
                            label={t("archlens_arch_top_pick")}
                            size="small"
                            color="primary"
                            sx={{ fontSize: 10, height: 18 }}
                          />
                        )}
                      </Stack>
                      {rec.vendor && (
                        <Typography variant="caption" color="primary">
                          {rec.vendor}
                        </Typography>
                      )}
                      {rec.marketPosition && (
                        <Typography
                          variant="caption"
                          display="block"
                          sx={{ color: "info.main", fontStyle: "italic", mt: 0.3 }}
                        >
                          <MaterialSymbol
                            icon="monitoring"
                            size={11}
                            style={{ verticalAlign: "text-bottom", marginRight: 2 }}
                          />
                          {rec.marketPosition}
                        </Typography>
                      )}
                      {rec.principleAlignment &&
                        rec.principleAlignment !== "N/A" && (
                          <Typography
                            variant="caption"
                            display="block"
                            sx={{
                              color: rec.principleAlignment
                                .toLowerCase()
                                .includes("conflict")
                                ? "warning.main"
                                : "success.main",
                              mt: 0.3,
                            }}
                          >
                            <MaterialSymbol
                              icon="policy"
                              size={11}
                              style={{
                                verticalAlign: "text-bottom",
                                marginRight: 2,
                              }}
                            />
                            {rec.principleAlignment}
                          </Typography>
                        )}
                      {rec.why && (
                        <Typography
                          variant="caption"
                          display="block"
                          color="text.secondary"
                          sx={{ lineHeight: 1.5, my: 0.5 }}
                        >
                          {rec.why}
                        </Typography>
                      )}
                      {rec.pros?.map((p, i) => (
                        <Typography
                          key={`p${i}`}
                          variant="caption"
                          display="block"
                          sx={{ color: "success.main" }}
                        >
                          + {p}
                        </Typography>
                      ))}
                      {rec.cons?.map((c, i) => (
                        <Typography
                          key={`c${i}`}
                          variant="caption"
                          display="block"
                          color="text.secondary"
                        >
                          - {c}
                        </Typography>
                      ))}
                      <Stack
                        direction="row"
                        spacing={0.5}
                        sx={{ mt: 1 }}
                        flexWrap="wrap"
                        useFlexGap
                      >
                        {rec.estimatedCost && (
                          <Chip
                            label={rec.estimatedCost}
                            size="small"
                            variant="outlined"
                            sx={{ fontSize: 10, height: 20 }}
                          />
                        )}
                        {rec.integrationEffort && (
                          <Chip
                            label={`${rec.integrationEffort} ${t("archlens_arch_effort")}`}
                            size="small"
                            color={effortColor(rec.integrationEffort)}
                            variant="outlined"
                            sx={{ fontSize: 10, height: 20 }}
                          />
                        )}
                        {rec.deploymentModel && (
                          <Chip
                            label={rec.deploymentModel}
                            size="small"
                            variant="outlined"
                            icon={
                              <MaterialSymbol icon="cloud" size={12} />
                            }
                            sx={{ fontSize: 10, height: 20 }}
                          />
                        )}
                        {rec.licenseModel && (
                          <Chip
                            label={rec.licenseModel}
                            size="small"
                            variant="outlined"
                            icon={
                              <MaterialSymbol icon="license" size={12} />
                            }
                            sx={{ fontSize: 10, height: 20 }}
                          />
                        )}
                      </Stack>
                    </Paper>
                  </Grid>
                  );
                })}
              </Grid>
            </Box>
          </Paper>
        ))}
      </Stack>
    </>
  );
}

// --- Session persistence ---
const SESSION_KEY = "archlens-architect-session";

interface ObjectiveOption {
  id: string;
  name: string;
  description?: string;
  subtype?: string;
}

interface CapabilityOption {
  id: string;
  name: string;
  isNew: boolean;
}

interface ArchSession {
  archReq: string;
  archPhase: number;
  archQuestions: {
    question: string;
    why?: string;
    type?: string;
    options?: string[];
    nfrCategory?: string;
    answer: string;
  }[];
  phase1Answers: { question: string; answer: string }[];
  archOptions: ArchSolutionOption[] | null;
  selectedOptionId: string | null;
  selectedObjectives: ObjectiveOption[];
  selectedCapabilities: CapabilityOption[];
  gapResult: GapAnalysisResult | null;
  depsResult: DependencyAnalysisResult | null;
  capabilityMapping: CapabilityMappingResult | null;
}

function loadSession(): ArchSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ArchSession;
  } catch {
    return null;
  }
}

// --- Main page component ---
export default function ArchLensArchitect() {
  const { t } = useTranslation("admin");
  const { types, relationTypes } = useMetamodel();
  const saved = loadSession();
  const [archReq, setArchReq] = useState(saved?.archReq ?? "");
  const [archPhase, setArchPhase] = useState(saved?.archPhase ?? 0);
  const [archLoading, setArchLoading] = useState(false);
  const [archQuestions, setArchQuestions] = useState<
    {
      question: string;
      why?: string;
      type?: string;
      options?: string[];
      nfrCategory?: string;
      answer: string;
    }[]
  >(saved?.archQuestions ?? []);
  const [phase1Answers, setPhase1Answers] = useState<
    { question: string; answer: string }[]
  >(saved?.phase1Answers ?? []);
  const [archOptions, setArchOptions] = useState<ArchSolutionOption[] | null>(
    saved?.archOptions ?? null,
  );
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(
    saved?.selectedOptionId ?? null,
  );
  const [error, setError] = useState("");
  // Objective selection state
  const [selectedObjectives, setSelectedObjectives] = useState<ObjectiveOption[]>(
    saved?.selectedObjectives ?? [],
  );
  const [objectiveOptions, setObjectiveOptions] = useState<ObjectiveOption[]>([]);
  const [objectiveLoading, setObjectiveLoading] = useState(false);
  // Capability selection state
  const [selectedCapabilities, setSelectedCapabilities] = useState<
    CapabilityOption[]
  >(saved?.selectedCapabilities ?? []);
  const [capabilityOptions, setCapabilityOptions] = useState<
    { id: string; name: string; description?: string }[]
  >([]);
  const [capabilityLoading, setCapabilityLoading] = useState(false);
  // Gap analysis state (Phase 3b: product selection)
  const [gapResult, setGapResult] = useState<GapAnalysisResult | null>(
    saved?.gapResult ?? null,
  );
  const [selectedRecs, setSelectedRecs] = useState<Set<RecKey>>(new Set());
  // Dependency analysis state (Phase 3c)
  const [depsResult, setDepsResult] = useState<DependencyAnalysisResult | null>(
    saved?.depsResult ?? null,
  );
  const [selectedDeps, setSelectedDeps] = useState<Set<RecKey>>(new Set());
  // Capability mapping state
  const [capabilityMapping, setCapabilityMapping] =
    useState<CapabilityMappingResult | null>(saved?.capabilityMapping ?? null);
  // Assessment save/commit state
  const [assessmentId, setAssessmentId] = useState<string | null>(null);
  const [assessmentSaved, setAssessmentSaved] = useState(false);
  const [savingAssessment, setSavingAssessment] = useState(false);
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [snackMsg, setSnackMsg] = useState("");
  // Proposed card edit state: { cardId: editedName }
  const [editingCard, setEditingCard] = useState<{ id: string; name: string } | null>(null);

  const saveSession = useCallback(() => {
    const session: ArchSession = {
      archReq,
      archPhase,
      archQuestions,
      phase1Answers,
      archOptions,
      selectedOptionId,
      selectedObjectives,
      selectedCapabilities,
      gapResult,
      depsResult,
      capabilityMapping,
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }, [
    archReq,
    archPhase,
    archQuestions,
    phase1Answers,
    archOptions,
    selectedOptionId,
    selectedObjectives,
    selectedCapabilities,
    gapResult,
    depsResult,
    capabilityMapping,
  ]);

  useEffect(() => {
    saveSession();
  }, [saveSession]);

  // Load all objectives + capabilities once on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setObjectiveLoading(true);
      setCapabilityLoading(true);
      try {
        const [objs, caps] = await Promise.all([
          api.get<ObjectiveOption[]>("/archlens/architect/objectives"),
          api.get<{ id: string; name: string; description?: string }[]>(
            "/archlens/architect/capabilities",
          ),
        ]);
        if (!cancelled) {
          setObjectiveOptions(objs);
          setCapabilityOptions(caps);
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) {
          setObjectiveLoading(false);
          setCapabilityLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Build merged dependency graph from existing + proposed
  const buildMergedGraph = useCallback((): { nodes: GNode[]; edges: GEdge[] } => {
    if (!capabilityMapping) return { nodes: [], edges: [] };
    const existing = capabilityMapping.existingDependencies;
    const nodeMap = new Map<string, GNode>();

    // Add existing nodes
    if (existing?.nodes) {
      for (const n of existing.nodes) {
        nodeMap.set(n.id, {
          id: n.id,
          name: n.name,
          type: n.type,
          lifecycle: n.lifecycle,
          attributes: n.attributes,
          parent_id: n.parent_id,
          path: n.path,
        });
      }
    }

    // Add proposed cards as nodes with proposed=true (skip disabled)
    const disabledIds = new Set<string>();
    for (const card of capabilityMapping.proposedCards) {
      if (card.disabled) {
        disabledIds.add(card.id);
        continue;
      }
      if (!nodeMap.has(card.id)) {
        nodeMap.set(card.id, {
          id: card.id,
          name: card.name,
          type: card.cardTypeKey,
          proposed: card.isNew,
        });
      }
    }

    // Add capabilities as nodes (new ones are proposed)
    for (const cap of capabilityMapping.capabilities) {
      const id = cap.existingCardId || cap.id;
      if (!nodeMap.has(id)) {
        nodeMap.set(id, {
          id,
          name: cap.name,
          type: "BusinessCapability",
          proposed: cap.isNew,
        });
      }
    }

    // Existing edges
    const edges: GEdge[] = [];
    if (existing?.edges) {
      for (const e of existing.edges) {
        edges.push({
          source: e.source,
          target: e.target,
          type: e.type,
          label: e.label,
          reverse_label: e.reverse_label,
        });
      }
    }

    // Proposed relations as edges — enforce metamodel source/target direction
    for (const rel of capabilityMapping.proposedRelations) {
      // Skip relations involving disabled cards
      if (disabledIds.has(rel.sourceId) || disabledIds.has(rel.targetId)) continue;
      const resolveId = (refId: string): string => {
        // Check capabilities by id or existingCardId
        const cap = capabilityMapping.capabilities.find(
          (c) => c.id === refId || c.existingCardId === refId,
        );
        if (cap) return cap.existingCardId || cap.id;
        // If the ID is in the nodeMap already, use it directly
        if (nodeMap.has(refId)) return refId;
        return refId;
      };
      let sid = resolveId(rel.sourceId);
      let tid = resolveId(rel.targetId);
      if (!nodeMap.has(sid) || !nodeMap.has(tid)) continue;

      // Look up metamodel relation type to enforce correct direction
      const rt = relationTypes.find((r) => r.key === rel.relationType);
      if (rt) {
        const sType = nodeMap.get(sid)?.type;
        const tType = nodeMap.get(tid)?.type;
        // If the AI reversed source/target relative to the metamodel, swap them
        if (sType === rt.target_type_key && tType === rt.source_type_key) {
          [sid, tid] = [tid, sid];
        }
      }

      edges.push({
        source: sid,
        target: tid,
        type: rel.relationType,
        label: rt?.label || rel.label,
        reverse_label: rt?.reverse_label,
      });
    }

    // Remove orphan nodes (nodes with zero edges) from the diagram
    const connectedIds = new Set<string>();
    for (const e of edges) {
      connectedIds.add(e.source);
      connectedIds.add(e.target);
    }
    const filteredNodes = Array.from(nodeMap.values()).filter(
      (n) => connectedIds.has(n.id),
    );

    return { nodes: filteredNodes, edges };
  }, [capabilityMapping, relationTypes]);

  const extractQuestions = (
    data: Record<string, unknown>,
  ): {
    question: string;
    why?: string;
    type?: string;
    options?: string[];
    nfrCategory?: string;
  }[] => {
    const raw = Array.isArray(data)
      ? data
      : Array.isArray(data.questions)
        ? data.questions
        : Array.isArray(data.items)
          ? data.items
          : null;
    if (!raw) return [];
    return raw.map((q: Record<string, unknown> | string) =>
      typeof q === "string"
        ? { question: q }
        : {
            question: String(q.question || q.text || q.q || ""),
            why: q.why as string | undefined,
            type: (q.type as string) || "text",
            options: Array.isArray(q.options) ? q.options.map(String) : undefined,
            nfrCategory: q.nfrCategory as string | undefined,
          },
    );
  };

  const runPhase = async (phase: number) => {
    setArchLoading(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        phase,
        requirement: archReq,
        objectiveIds: selectedObjectives.map((o) => o.id),
        selectedCapabilities: selectedCapabilities.map((c) => ({
          id: c.id,
          name: c.name,
          isNew: c.isNew,
        })),
      };
      if (phase === 2) {
        const qa = archQuestions.map((q) => ({
          question: q.question,
          answer: q.answer,
        }));
        payload.phase1QA = qa;
        setPhase1Answers(qa);
      }
      if (phase === 3) {
        // Phase 3a: get solution options
        const phase2qa = archQuestions.map((q) => ({
          question: q.question,
          answer: q.answer,
        }));
        payload.allQA = [...phase1Answers, ...phase2qa];
        payload.objectiveIds = selectedObjectives.map((o) => o.id);
        const result = await api.post<{ options: ArchSolutionOption[] }>(
          "/archlens/architect/phase3/options",
          payload,
        );
        setArchOptions(
          Array.isArray(result.options) ? result.options : [],
        );
        setArchPhase(3);
        setArchQuestions([]);
        setArchLoading(false);
        return;
      }
      if (phase === 4) {
        // Phase 4 (3c): dependency analysis for selected products
        const selectedOpt = archOptions?.find((o) => o.id === selectedOptionId);
        payload.allQA = [
          ...phase1Answers,
          ...archQuestions.map((q) => ({
            question: q.question,
            answer: q.answer,
          })),
        ];
        payload.selectedOption = selectedOpt ?? null;
        // Build selected products from gap result
        const products: {
          name: string;
          vendor?: string;
          capability: string;
          pros?: string[];
          cons?: string[];
        }[] = [];
        if (gapResult && selectedRecs.size > 0) {
          gapResult.gaps.forEach((gap, gi) => {
            (gap.recommendations ?? []).forEach((rec, ri) => {
              if (selectedRecs.has(recKey(gi, ri))) {
                products.push({
                  capability: gap.capability,
                  name: rec.name,
                  vendor: rec.vendor,
                  pros: rec.pros,
                  cons: rec.cons,
                });
              }
            });
          });
        }
        payload.selectedProducts = products;
        const result = await api.post<DependencyAnalysisResult>(
          "/archlens/architect/phase3/deps",
          payload,
        );
        setDepsResult(result);
        // Pre-select recommended deps
        const preselected = new Set<RecKey>();
        (result.dependencies ?? []).forEach((dep, di) => {
          (dep.options ?? []).forEach((opt, oi) => {
            if (opt.recommended) preselected.add(recKey(di, oi));
          });
        });
        setSelectedDeps(preselected);
        setArchPhase(4);
        setArchLoading(false);
        return;
      }
      if (phase === 5) {
        // Phase 5: capability mapping with all selections
        const selectedOpt = archOptions?.find((o) => o.id === selectedOptionId);
        payload.allQA = [
          ...phase1Answers,
          ...archQuestions.map((q) => ({
            question: q.question,
            answer: q.answer,
          })),
        ];
        payload.selectedOption = selectedOpt ?? null;
        payload.objectiveIds = selectedObjectives.map((o) => o.id);
        // Build selected recommendations: products from 3b + deps from 3c
        const picks: {
          capability: string;
          recommendation: string;
          vendor?: string;
          role: "primary" | "dependency";
          pros?: string[];
          cons?: string[];
        }[] = [];
        if (gapResult && selectedRecs.size > 0) {
          gapResult.gaps.forEach((gap, gi) => {
            (gap.recommendations ?? []).forEach((rec, ri) => {
              if (selectedRecs.has(recKey(gi, ri))) {
                picks.push({
                  capability: gap.capability,
                  recommendation: rec.name,
                  vendor: rec.vendor,
                  role: "primary",
                  pros: rec.pros,
                  cons: rec.cons,
                });
              }
            });
          });
        }
        if (depsResult && selectedDeps.size > 0) {
          depsResult.dependencies.forEach((dep, di) => {
            (dep.options ?? []).forEach((opt, oi) => {
              if (selectedDeps.has(recKey(di, oi))) {
                picks.push({
                  capability: dep.need,
                  recommendation: opt.name,
                  vendor: opt.vendor,
                  role: "dependency",
                  pros: opt.pros,
                  cons: opt.cons,
                });
              }
            });
          });
        }
        payload.selectedRecommendations = picks;
        const result = await api.post<CapabilityMappingResult>(
          "/archlens/architect/phase3",
          payload,
        );
        setCapabilityMapping(result);
        setArchPhase(5);
        setArchQuestions([]);
        setArchLoading(false);
        return;
      }
      // Phase 1 or 2
      const result = await api.post<Record<string, unknown>>(
        `/archlens/architect/phase${phase}`,
        payload,
      );
      setArchPhase(phase);
      const questions = extractQuestions(result);
      setArchQuestions(
        questions.map((q) => ({
          question: q.question,
          why: q.why,
          type: q.type,
          options: q.options,
          nfrCategory: q.nfrCategory,
          answer: "",
        })),
      );
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setArchLoading(false);
    }
  };

  const selectOption = async (optionId: string) => {
    setSelectedOptionId(optionId);
    setArchLoading(true);
    setError("");
    try {
      const selectedOpt = archOptions?.find((o) => o.id === optionId);
      const payload: Record<string, unknown> = {
        requirement: archReq,
        allQA: [
          ...phase1Answers,
          ...archQuestions.map((q) => ({
            question: q.question,
            answer: q.answer,
          })),
        ],
        selectedOption: selectedOpt ?? null,
        objectiveIds: selectedObjectives.map((o) => o.id),
        selectedCapabilities: selectedCapabilities.map((c) => ({
          id: c.id,
          name: c.name,
          isNew: c.isNew,
        })),
      };
      const result = await api.post<GapAnalysisResult>(
        "/archlens/architect/phase3/gaps",
        payload,
      );
      setGapResult(result);
      // Pre-select recommended items
      const preselected = new Set<RecKey>();
      (result.gaps ?? []).forEach((gap, gi) => {
        (gap.recommendations ?? []).forEach((rec, ri) => {
          if (rec.recommended) preselected.add(recKey(gi, ri));
        });
      });
      setSelectedRecs(preselected);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setArchLoading(false);
    }
  };

  const toggleRec = useCallback((key: RecKey) => {
    setSelectedRecs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleDep = useCallback((key: RecKey) => {
    setSelectedDeps((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleAnswerChange = (index: number, value: string) => {
    setArchQuestions((prev) =>
      prev.map((q, i) => (i === index ? { ...q, answer: value } : q)),
    );
  };

  const allAnswered =
    archQuestions.length > 0 && archQuestions.every((q) => q.answer.trim());

  const reset = () => {
    setArchPhase(0);
    setArchQuestions([]);
    setPhase1Answers([]);
    setArchOptions(null);
    setSelectedOptionId(null);
    setSelectedObjectives([]);
    setSelectedCapabilities([]);
    setGapResult(null);
    setSelectedRecs(new Set());
    setDepsResult(null);
    setSelectedDeps(new Set());
    setCapabilityMapping(null);
    setError("");
    sessionStorage.removeItem(SESSION_KEY);
  };

  const chooseDifferent = () => {
    setArchPhase(3);
    setSelectedOptionId(null);
    setGapResult(null);
    setSelectedRecs(new Set());
    setDepsResult(null);
    setSelectedDeps(new Set());
    setCapabilityMapping(null);
    // Reset assessment so the updated session data gets saved on next commit
    setAssessmentId(null);
    setAssessmentSaved(false);
  };

  const handleSaveAssessment = async (): Promise<string | null> => {
    if (assessmentId) return assessmentId;
    setSavingAssessment(true);
    try {
      // Resolve selected recommendations from index keys to actual product data
      const resolvedRecs: Record<string, unknown>[] = [];
      if (gapResult) {
        gapResult.gaps.forEach((gap, gi) => {
          (gap.recommendations ?? []).forEach((rec, ri) => {
            if (selectedRecs.has(recKey(gi, ri))) {
              resolvedRecs.push({
                name: rec.name,
                vendor: rec.vendor,
                capability: gap.capability,
                role: "recommendation",
              });
            }
          });
        });
      }
      if (depsResult) {
        depsResult.dependencies.forEach((dep, di) => {
          (dep.options ?? []).forEach((opt, oi) => {
            if (selectedDeps.has(recKey(di, oi))) {
              resolvedRecs.push({
                name: opt.name,
                vendor: opt.vendor,
                capability: dep.need,
                role: "dependency",
              });
            }
          });
        });
      }

      const sessionData: Record<string, unknown> = {
        requirement: archReq,
        selectedObjectives,
        selectedCapabilities,
        phase1Questions: phase1Answers,
        phase2Questions: archQuestions,
        archOptions,
        selectedOptionId,
        gapResult,
        selectedRecommendations: resolvedRecs,
        depsResult,
        selectedDependencies: Array.from(selectedDeps),
        capabilityMapping,
      };
      const resp = await api.post<{ id: string }>("/archlens/assessments", {
        title: archReq.slice(0, 200),
        requirement: archReq,
        sessionData: sessionData,
      });
      setAssessmentId(resp.id);
      setAssessmentSaved(true);
      setSnackMsg(t("archlens_assessment_saved"));
      return resp.id;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      return null;
    } finally {
      setSavingAssessment(false);
    }
  };

  const handleCommit = async () => {
    const savedId = await handleSaveAssessment();
    if (savedId) {
      setCommitDialogOpen(true);
    }
  };

  // Determine if we're in Phase 3b (product selection) or 3c (deps view)
  const isGapsView =
    archPhase === 3 && selectedOptionId != null && gapResult != null;
  const isDepsView = archPhase === 4 && depsResult != null;
  const selectedOpt = archOptions?.find((o) => o.id === selectedOptionId);

  return (
    <Box>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ mb: 1 }}
      >
        <Typography variant="h6">{t("archlens_architect_title")}</Typography>
        {(archPhase > 0 || archOptions || capabilityMapping) && (
          <Button
            variant="outlined"
            size="small"
            startIcon={<MaterialSymbol icon="add" size={18} />}
            onClick={reset}
          >
            {t("archlens_architect_new_assessment")}
          </Button>
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t("archlens_architect_description")}
      </Typography>

      {error && (
        <Alert severity="error" onClose={() => setError("")} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper sx={{ p: 3 }}>
        <Stepper
          activeStep={phaseToStepIndex(archPhase)}
          alternativeLabel
          sx={{ mb: 3 }}
        >
          {ARCHITECT_STEPS.map((step) => (
            <Step
              key={step.key}
              completed={phaseToStepIndex(archPhase) > ARCHITECT_STEPS.indexOf(step)}
            >
              <StepLabel>{t(`archlens_architect_step_${step.key}`)}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {/* Phase 0: Business Requirements Input */}
        {archPhase === 0 && (
          <>
            <TextField
              label={t("archlens_architect_requirement")}
              value={archReq}
              onChange={(e) => setArchReq(e.target.value)}
              fullWidth
              multiline
              minRows={3}
              sx={{ mb: 2 }}
            />

            {/* Objective selection */}
            <Paper
              variant="outlined"
              sx={{ p: 2, mb: 2, borderLeft: 3, borderColor: "secondary.main" }}
            >
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t("archlens_architect_select_objectives")}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mb: 1.5 }}
              >
                {t("archlens_architect_objectives_hint")}
              </Typography>
              <Autocomplete
                multiple
                options={objectiveOptions}
                value={selectedObjectives}
                getOptionLabel={(o) => o.name}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                loading={objectiveLoading}
                onChange={(_, v) => setSelectedObjectives(v)}
                filterSelectedOptions
                openOnFocus
                renderOption={(props, option) => (
                  <li {...props} key={option.id}>
                    <Box>
                      <Typography variant="body2">{option.name}</Typography>
                      {option.description && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{
                            display: "block",
                            maxWidth: 400,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {option.description}
                        </Typography>
                      )}
                    </Box>
                  </li>
                )}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    size="small"
                    placeholder={t("archlens_architect_search_objectives")}
                  />
                )}
              />
            </Paper>

            {/* Capability selection (existing or free-text new) */}
            <Paper
              variant="outlined"
              sx={{ p: 2, mb: 2, borderLeft: 3, borderColor: "info.main" }}
            >
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t("archlens_architect_select_capabilities")}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mb: 1.5 }}
              >
                {t("archlens_architect_capabilities_hint")}
              </Typography>
              <Autocomplete
                multiple
                freeSolo
                options={capabilityOptions.map((c) => c.name)}
                value={selectedCapabilities.map((c) => c.name)}
                loading={capabilityLoading}
                onChange={(_, values) => {
                  const caps: CapabilityOption[] = values.map((v) => {
                    const existing = capabilityOptions.find((c) => c.name === v);
                    return existing
                      ? { id: existing.id, name: existing.name, isNew: false }
                      : { id: `new_${v}`, name: v, isNew: true };
                  });
                  setSelectedCapabilities(caps);
                }}
                filterSelectedOptions
                openOnFocus
                renderTags={(values, getTagProps) =>
                  values.map((v, i) => {
                    const cap = selectedCapabilities.find((c) => c.name === v);
                    return (
                      <Chip
                        {...getTagProps({ index: i })}
                        key={v}
                        label={
                          cap?.isNew
                            ? t("archlens_architect_new_capability", { name: v })
                            : v
                        }
                        size="small"
                        color={cap?.isNew ? "info" : "default"}
                        variant={cap?.isNew ? "filled" : "outlined"}
                      />
                    );
                  })
                }
                renderInput={(params) => (
                  <TextField
                    {...params}
                    size="small"
                    placeholder={t("archlens_architect_search_capabilities")}
                  />
                )}
              />
            </Paper>

            <Button
              variant="contained"
              onClick={() => runPhase(1)}
              disabled={
                archLoading ||
                !archReq ||
                selectedObjectives.length === 0
              }
              startIcon={
                archLoading ? <CircularProgress size={18} /> : undefined
              }
            >
              {t("archlens_architect_generate_questions")}
            </Button>
          </>
        )}

        {/* Phase 1 & 2: Questions */}
        {(archPhase === 1 || archPhase === 2) && !archLoading && (
          <>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {archPhase === 1
                ? t("archlens_architect_phase1_intro")
                : t("archlens_architect_phase2_intro")}
            </Typography>
            <Stack spacing={2} sx={{ mb: 2 }}>
              {archQuestions.map((q, i) => {
                const qType = q.type || "text";
                const hasOptions = q.options && q.options.length > 0;
                const selectedMulti =
                  qType === "multi" && q.answer
                    ? q.answer.split(", ").filter(Boolean)
                    : [];
                return (
                  <Paper
                    key={i}
                    variant="outlined"
                    sx={{ p: 2, borderLeft: 3, borderColor: "primary.main" }}
                  >
                    <Stack
                      direction="row"
                      alignItems="flex-start"
                      justifyContent="space-between"
                    >
                      <Stack
                        direction="row"
                        spacing={1.5}
                        alignItems="flex-start"
                        sx={{ flex: 1 }}
                      >
                        <Box
                          sx={{
                            width: 28,
                            height: 28,
                            borderRadius: "50%",
                            bgcolor: "primary.main",
                            color: "#fff",
                            fontSize: 13,
                            fontWeight: 700,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            mt: 0.2,
                          }}
                        >
                          {i + 1}
                        </Box>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="body2" fontWeight="bold">
                            {q.question}
                          </Typography>
                          {q.why && (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              fontStyle="italic"
                              sx={{ display: "block", mt: 0.3 }}
                            >
                              {t("archlens_arch_impact")}: {q.why}
                            </Typography>
                          )}
                        </Box>
                      </Stack>
                      {q.nfrCategory && (
                        <Chip
                          label={q.nfrCategory.replace("_", " ")}
                          size="small"
                          variant="outlined"
                          color="secondary"
                          sx={{
                            fontSize: 10,
                            textTransform: "capitalize",
                            ml: 1,
                          }}
                        />
                      )}
                    </Stack>

                    {qType === "choice" && hasOptions && (
                      <Stack
                        direction="row"
                        spacing={1}
                        flexWrap="wrap"
                        useFlexGap
                        sx={{ mt: 1.5 }}
                      >
                        {q.options!.map((opt) => (
                          <Chip
                            key={opt}
                            label={q.answer === opt ? `✓ ${opt}` : opt}
                            onClick={() => handleAnswerChange(i, opt)}
                            color={q.answer === opt ? "primary" : "default"}
                            variant={q.answer === opt ? "filled" : "outlined"}
                            sx={{
                              cursor: "pointer",
                              fontWeight: q.answer === opt ? 600 : 400,
                            }}
                          />
                        ))}
                      </Stack>
                    )}

                    {qType === "multi" && hasOptions && (
                      <Box sx={{ mt: 1.5 }}>
                        <Stack
                          direction="row"
                          spacing={1}
                          flexWrap="wrap"
                          useFlexGap
                        >
                          {q.options!.map((opt) => {
                            const isSelected = selectedMulti.includes(opt);
                            return (
                              <Chip
                                key={opt}
                                label={isSelected ? `✓ ${opt}` : opt}
                                onClick={() => {
                                  const next = isSelected
                                    ? selectedMulti.filter((s) => s !== opt)
                                    : [...selectedMulti, opt];
                                  handleAnswerChange(i, next.join(", "));
                                }}
                                color={isSelected ? "primary" : "default"}
                                variant={isSelected ? "filled" : "outlined"}
                                sx={{
                                  cursor: "pointer",
                                  fontWeight: isSelected ? 600 : 400,
                                }}
                              />
                            );
                          })}
                        </Stack>
                        <TextField
                          size="small"
                          fullWidth
                          placeholder={t("archlens_architect_custom_answer")}
                          sx={{ mt: 1 }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              const input = (
                                e.target as HTMLInputElement
                              ).value.trim();
                              if (input && !selectedMulti.includes(input)) {
                                handleAnswerChange(
                                  i,
                                  [...selectedMulti, input].join(", "),
                                );
                                (e.target as HTMLInputElement).value = "";
                              }
                            }
                          }}
                        />
                      </Box>
                    )}

                    {(qType === "text" ||
                      (!hasOptions &&
                        qType !== "choice" &&
                        qType !== "multi")) && (
                      <TextField
                        value={q.answer}
                        onChange={(e) => handleAnswerChange(i, e.target.value)}
                        fullWidth
                        multiline
                        minRows={2}
                        size="small"
                        placeholder={t("archlens_architect_answer_placeholder")}
                        sx={{ mt: 1.5 }}
                      />
                    )}
                  </Paper>
                );
              })}
            </Stack>
            <Stack direction="row" spacing={2}>
              {archPhase === 1 ? (
                <Button
                  variant="contained"
                  onClick={() => runPhase(2)}
                  disabled={!allAnswered}
                >
                  {t("archlens_architect_submit_phase2")}
                </Button>
              ) : (
                <Button
                  variant="contained"
                  onClick={() => runPhase(3)}
                  disabled={!allAnswered}
                  startIcon={<MaterialSymbol icon="hub" size={18} />}
                >
                  {t("archlens_architect_analyze_capabilities")}
                </Button>
              )}
              <Button variant="text" onClick={reset} color="inherit">
                {t("archlens_architect_start_over")}
              </Button>
            </Stack>
          </>
        )}

        {/* Phase 3a: Solution options */}
        {archPhase === 3 &&
          !archLoading &&
          !isGapsView &&
          archOptions &&
          archOptions.length > 0 && (
            <>
              <Typography variant="subtitle2" sx={{ mb: 2 }}>
                {t("archlens_architect_options_intro")}
              </Typography>
              <Grid container spacing={2} sx={{ mb: 2 }}>
                {archOptions.map((option) => (
                  <Grid item xs={12} md={6} key={option.id}>
                    <OptionCard
                      option={option}
                      onSelect={() => selectOption(option.id)}
                      loading={archLoading}
                    />
                  </Grid>
                ))}
              </Grid>
              <Stack direction="row" spacing={2}>
                <Button variant="text" onClick={reset} color="inherit">
                  {t("archlens_architect_start_over")}
                </Button>
              </Stack>
            </>
          )}

        {/* Phase 3b: Gaps for selected option */}
        {isGapsView && !archLoading && (
          <>
            {/* Selected option summary */}
            {selectedOpt && (
              <Paper
                variant="outlined"
                sx={{ p: 2, mb: 2, borderLeft: 3, borderColor: "primary.main" }}
              >
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="flex-start"
                >
                  <Box>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="subtitle2" fontWeight={700}>
                        {selectedOpt.title}
                      </Typography>
                      <Chip
                        label={t(
                          `archlens_architect_approach_${selectedOpt.approach}`,
                        )}
                        size="small"
                        color={approachColor(selectedOpt.approach)}
                        sx={{ fontWeight: 600 }}
                      />
                    </Stack>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mt: 0.5 }}
                    >
                      {selectedOpt.summary}
                    </Typography>
                  </Box>
                </Stack>
              </Paper>
            )}

            <Typography variant="subtitle2" sx={{ mb: 2 }}>
              {t("archlens_architect_gaps_intro")}
            </Typography>

            <GapsView
              gaps={gapResult.gaps}
              summary={gapResult.summary}
              selectedRecs={selectedRecs}
              onToggleRec={toggleRec}
            />

            {selectedRecs.size > 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: "block" }}>
                {t("archlens_architect_products_selected", { count: selectedRecs.size })}
              </Typography>
            )}

            <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
              <Button
                variant="contained"
                onClick={() => runPhase(4)}
                disabled={archLoading || selectedRecs.size === 0}
                startIcon={
                  archLoading ? (
                    <CircularProgress size={16} />
                  ) : (
                    <MaterialSymbol icon="device_hub" size={18} />
                  )
                }
              >
                {t("archlens_architect_analyse_deps")}
              </Button>
              <Button variant="outlined" onClick={chooseDifferent}>
                {t("archlens_architect_choose_different")}
              </Button>
              <Button variant="text" onClick={reset} color="inherit">
                {t("archlens_architect_start_over")}
              </Button>
            </Stack>
          </>
        )}

        {/* Phase 4 (3c): Dependencies for selected products */}
        {isDepsView && !archLoading && (
          <>
            {/* Selected products summary */}
            {selectedOpt && (
              <Paper
                variant="outlined"
                sx={{ p: 2, mb: 2, borderLeft: 3, borderColor: "primary.main" }}
              >
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
                  {selectedOpt.title}
                </Typography>
                {gapResult && selectedRecs.size > 0 && (
                  <Stack direction="row" spacing={0.5} flexWrap="wrap">
                    {gapResult.gaps.map((gap, gi) =>
                      (gap.recommendations ?? []).map((rec, ri) =>
                        selectedRecs.has(recKey(gi, ri)) ? (
                          <Chip
                            key={recKey(gi, ri)}
                            label={rec.name}
                            size="small"
                            color="primary"
                            variant="outlined"
                            sx={{ fontSize: 11 }}
                          />
                        ) : null,
                      ),
                    )}
                  </Stack>
                )}
              </Paper>
            )}

            <Typography variant="subtitle2" sx={{ mb: 2 }}>
              {t("archlens_architect_deps_intro")}
            </Typography>

            {depsResult.dependencies.length === 0 ? (
              <Alert severity="success" sx={{ mb: 2 }}>
                {t("archlens_architect_no_deps")}
              </Alert>
            ) : (
              <>
                {depsResult.summary && (
                  <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                    <Typography variant="body2" sx={{ lineHeight: 1.6 }}>
                      {depsResult.summary}
                    </Typography>
                  </Paper>
                )}
                <Stack spacing={3} sx={{ mb: 2 }}>
                  {depsResult.dependencies.map((dep, di) => (
                    <Paper
                      key={di}
                      variant="outlined"
                      sx={{
                        borderTop: 3,
                        borderColor:
                          dep.urgency === "critical"
                            ? "error.main"
                            : dep.urgency === "high"
                              ? "warning.main"
                              : "grey.400",
                      }}
                    >
                      <Box
                        sx={{
                          px: 2,
                          py: 1.5,
                          borderBottom: 1,
                          borderColor: "divider",
                        }}
                      >
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                          <Typography variant="subtitle2" fontWeight={700}>
                            {dep.need}
                          </Typography>
                          {dep.urgency && (
                            <Chip
                              label={dep.urgency.toUpperCase()}
                              size="small"
                              color={urgencyColor(dep.urgency)}
                              sx={{ fontSize: 10, fontWeight: 700, height: 20 }}
                            />
                          )}
                        </Stack>
                        {dep.reason && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            display="block"
                            sx={{ mt: 0.5 }}
                          >
                            {dep.reason}
                          </Typography>
                        )}
                      </Box>
                      <Box sx={{ p: 2 }}>
                        <Grid container spacing={1.5}>
                          {(dep.options ?? []).map((opt, oi) => {
                            const dk = recKey(di, oi);
                            const isSelected = selectedDeps.has(dk);
                            return (
                              <Grid item key={oi} xs={12} sm={6} md={4}>
                                <Paper
                                  variant="outlined"
                                  onClick={() => toggleDep(dk)}
                                  sx={{
                                    p: 2,
                                    height: "100%",
                                    bgcolor: isSelected
                                      ? "action.selected"
                                      : opt.recommended
                                        ? "primary.50"
                                        : undefined,
                                    cursor: "pointer",
                                    outline: isSelected ? "2px solid" : undefined,
                                    outlineColor: isSelected ? "primary.main" : undefined,
                                    transition: "outline 0.15s, background-color 0.15s",
                                  }}
                                >
                                  <Checkbox
                                    size="small"
                                    checked={isSelected}
                                    sx={{ float: "right", mt: -0.5, mr: -0.5 }}
                                    tabIndex={-1}
                                  />
                                  <Stack
                                    direction="row"
                                    spacing={1}
                                    alignItems="center"
                                    sx={{ mb: 0.5 }}
                                  >
                                    <Typography variant="body2" fontWeight={600}>
                                      {opt.name}
                                    </Typography>
                                    {opt.recommended && (
                                      <Chip
                                        label={t("archlens_arch_top_pick")}
                                        size="small"
                                        color="primary"
                                        sx={{ fontSize: 10, height: 18 }}
                                      />
                                    )}
                                  </Stack>
                                  {opt.vendor && (
                                    <Typography variant="caption" color="primary">
                                      {opt.vendor}
                                    </Typography>
                                  )}
                                  {opt.why && (
                                    <Typography
                                      variant="caption"
                                      display="block"
                                      color="text.secondary"
                                      sx={{ lineHeight: 1.5, my: 0.5 }}
                                    >
                                      {opt.why}
                                    </Typography>
                                  )}
                                  {opt.pros?.map((p, i) => (
                                    <Typography
                                      key={`p${i}`}
                                      variant="caption"
                                      display="block"
                                      sx={{ color: "success.main" }}
                                    >
                                      + {p}
                                    </Typography>
                                  ))}
                                  {opt.cons?.map((c, i) => (
                                    <Typography
                                      key={`c${i}`}
                                      variant="caption"
                                      display="block"
                                      color="text.secondary"
                                    >
                                      - {c}
                                    </Typography>
                                  ))}
                                  <Stack
                                    direction="row"
                                    spacing={0.5}
                                    sx={{ mt: 1 }}
                                    flexWrap="wrap"
                                  >
                                    {opt.estimatedCost && (
                                      <Chip
                                        label={opt.estimatedCost}
                                        size="small"
                                        variant="outlined"
                                        sx={{ fontSize: 10, height: 20 }}
                                      />
                                    )}
                                    {opt.integrationEffort && (
                                      <Chip
                                        label={`${t("archlens_arch_effort")}: ${opt.integrationEffort}`}
                                        size="small"
                                        color={effortColor(opt.integrationEffort)}
                                        sx={{ fontSize: 10, height: 20 }}
                                      />
                                    )}
                                  </Stack>
                                </Paper>
                              </Grid>
                            );
                          })}
                        </Grid>
                      </Box>
                    </Paper>
                  ))}
                </Stack>
              </>
            )}

            <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
              <Button
                variant="contained"
                onClick={() => runPhase(5)}
                disabled={archLoading}
                startIcon={
                  archLoading ? (
                    <CircularProgress size={16} />
                  ) : (
                    <MaterialSymbol icon="hub" size={18} />
                  )
                }
              >
                {t("archlens_architect_generate_capability_map")}
              </Button>
              <Button variant="outlined" onClick={chooseDifferent}>
                {t("archlens_architect_choose_different")}
              </Button>
              <Button variant="text" onClick={reset} color="inherit">
                {t("archlens_architect_start_over")}
              </Button>
            </Stack>
          </>
        )}

        {/* Phase 5: Capability mapping */}
        {archPhase === 5 &&
          !archLoading &&
          capabilityMapping &&
          (() => {
            const merged = buildMergedGraph();
            return (
              <>
                {capabilityMapping.summary && (
                  <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                    <Typography variant="body2" sx={{ lineHeight: 1.6 }}>
                      {capabilityMapping.summary}
                    </Typography>
                  </Paper>
                )}

                {/* Capabilities + Proposed cards */}
                <Grid container spacing={2} sx={{ mb: 2 }}>
                  <Grid item xs={12} md={6}>
                    <Paper variant="outlined" sx={{ p: 2, height: "100%" }}>
                      <Typography
                        variant="subtitle2"
                        fontWeight={700}
                        sx={{ mb: 1 }}
                      >
                        <MaterialSymbol
                          icon="account_tree"
                          size={16}
                          style={{
                            verticalAlign: "text-bottom",
                            marginRight: 4,
                          }}
                        />
                        {t("archlens_architect_capabilities")}
                      </Typography>
                      <Stack spacing={0.5}>
                        {capabilityMapping.capabilities.map((cap) => (
                          <Stack
                            key={cap.id}
                            direction="row"
                            spacing={1}
                            alignItems="center"
                          >
                            <Chip
                              label={
                                cap.isNew
                                  ? t("archlens_architect_new")
                                  : t("archlens_architect_existing")
                              }
                              size="small"
                              color={cap.isNew ? "primary" : "success"}
                              variant="outlined"
                              sx={{ fontSize: 10, height: 20, minWidth: 55 }}
                            />
                            <Typography variant="body2">{cap.name}</Typography>
                          </Stack>
                        ))}
                      </Stack>
                    </Paper>
                  </Grid>

                  <Grid item xs={12} md={6}>
                    <Paper variant="outlined" sx={{ p: 2, height: "100%" }}>
                      <Typography
                        variant="subtitle2"
                        fontWeight={700}
                        sx={{ mb: 1 }}
                      >
                        <MaterialSymbol
                          icon="add_circle"
                          size={16}
                          style={{
                            verticalAlign: "text-bottom",
                            marginRight: 4,
                          }}
                        />
                        {t("archlens_architect_proposed_cards")}
                      </Typography>
                      <Stack spacing={0.5}>
                        {capabilityMapping.proposedCards
                          .filter((c) => c.isNew)
                          .map((card) => {
                            const ti = types.find(
                              (tp) => tp.key === card.cardTypeKey,
                            );
                            const isEditing = editingCard?.id === card.id;
                            return (
                              <Stack
                                key={card.id}
                                direction="row"
                                spacing={0.5}
                                alignItems="center"
                                sx={{
                                  opacity: card.disabled ? 0.45 : 1,
                                  transition: "opacity 0.2s",
                                }}
                              >
                                <Tooltip
                                  title={
                                    card.disabled
                                      ? t("archlens_architect_enable_card")
                                      : t("archlens_architect_disable_card")
                                  }
                                  arrow
                                >
                                  <Switch
                                    size="small"
                                    checked={!card.disabled}
                                    onChange={() => {
                                      setCapabilityMapping((prev) => {
                                        if (!prev) return prev;
                                        return {
                                          ...prev,
                                          proposedCards:
                                            prev.proposedCards.map((c) =>
                                              c.id === card.id
                                                ? {
                                                    ...c,
                                                    disabled: !c.disabled,
                                                  }
                                                : c,
                                            ),
                                        };
                                      });
                                    }}
                                    sx={{ mr: 0.5 }}
                                  />
                                </Tooltip>
                                {ti && (
                                  <MaterialSymbol
                                    icon={ti.icon}
                                    size={14}
                                    color={
                                      card.disabled
                                        ? "inherit"
                                        : ti.color
                                    }
                                  />
                                )}
                                {isEditing ? (
                                  <>
                                    <TextField
                                      size="small"
                                      variant="standard"
                                      autoFocus
                                      value={editingCard.name}
                                      onChange={(e) =>
                                        setEditingCard({
                                          id: card.id,
                                          name: e.target.value,
                                        })
                                      }
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          setCapabilityMapping((prev) => {
                                            if (!prev) return prev;
                                            return {
                                              ...prev,
                                              proposedCards:
                                                prev.proposedCards.map((c) =>
                                                  c.id === card.id
                                                    ? {
                                                        ...c,
                                                        name:
                                                          editingCard.name,
                                                      }
                                                    : c,
                                                ),
                                            };
                                          });
                                          setEditingCard(null);
                                        } else if (e.key === "Escape") {
                                          setEditingCard(null);
                                        }
                                      }}
                                      inputProps={{
                                        style: {
                                          fontSize: 14,
                                          padding: 0,
                                        },
                                      }}
                                      sx={{ flex: 1, minWidth: 120 }}
                                    />
                                    <Tooltip
                                      title={t("common:actions.save")}
                                      arrow
                                    >
                                      <IconButton
                                        size="small"
                                        color="primary"
                                        onClick={() => {
                                          setCapabilityMapping((prev) => {
                                            if (!prev) return prev;
                                            return {
                                              ...prev,
                                              proposedCards:
                                                prev.proposedCards.map((c) =>
                                                  c.id === card.id
                                                    ? {
                                                        ...c,
                                                        name:
                                                          editingCard.name,
                                                      }
                                                    : c,
                                                ),
                                            };
                                          });
                                          setEditingCard(null);
                                        }}
                                      >
                                        <MaterialSymbol
                                          icon="check"
                                          size={16}
                                        />
                                      </IconButton>
                                    </Tooltip>
                                    <Tooltip
                                      title={t("common:actions.cancel")}
                                      arrow
                                    >
                                      <IconButton
                                        size="small"
                                        onClick={() =>
                                          setEditingCard(null)
                                        }
                                      >
                                        <MaterialSymbol
                                          icon="close"
                                          size={16}
                                        />
                                      </IconButton>
                                    </Tooltip>
                                  </>
                                ) : (
                                  <>
                                    <Typography
                                      variant="body2"
                                      sx={{
                                        flex: 1,
                                        textDecoration: card.disabled
                                          ? "line-through"
                                          : undefined,
                                      }}
                                    >
                                      {card.name}
                                    </Typography>
                                    {!card.disabled && (
                                      <Tooltip
                                        title={t("common:actions.edit")}
                                        arrow
                                      >
                                        <IconButton
                                          size="small"
                                          onClick={() =>
                                            setEditingCard({
                                              id: card.id,
                                              name: card.name,
                                            })
                                          }
                                        >
                                          <MaterialSymbol
                                            icon="edit"
                                            size={14}
                                          />
                                        </IconButton>
                                      </Tooltip>
                                    )}
                                  </>
                                )}
                                {card.subtype && (
                                  <Typography
                                    variant="caption"
                                    color="text.secondary"
                                  >
                                    ({card.subtype})
                                  </Typography>
                                )}
                              </Stack>
                            );
                          })}
                        {capabilityMapping.proposedCards.filter((c) => c.isNew)
                          .length === 0 && (
                          <Typography variant="caption" color="text.secondary">
                            {t("archlens_architect_no_new_cards")}
                          </Typography>
                        )}
                      </Stack>
                    </Paper>
                  </Grid>
                </Grid>

                {/* Proposed relations */}
                {capabilityMapping.proposedRelations.length > 0 && (
                  <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                    <Typography
                      variant="subtitle2"
                      fontWeight={700}
                      sx={{ mb: 1 }}
                    >
                      <MaterialSymbol
                        icon="share"
                        size={16}
                        style={{
                          verticalAlign: "text-bottom",
                          marginRight: 4,
                        }}
                      />
                      {t("archlens_architect_proposed_relations")} (
                      {capabilityMapping.proposedRelations.length})
                    </Typography>
                    <Stack spacing={0.3}>
                      {capabilityMapping.proposedRelations.map((rel, i) => {
                        const srcCard = capabilityMapping.proposedCards.find(
                          (c) => c.id === rel.sourceId,
                        );
                        const tgtCard = capabilityMapping.proposedCards.find(
                          (c) => c.id === rel.targetId,
                        );
                        const srcName =
                          srcCard?.name ||
                          capabilityMapping.capabilities.find(
                            (c) => c.id === rel.sourceId,
                          )?.name ||
                          capabilityMapping.existingDependencies?.nodes.find(
                            (n) => n.id === rel.sourceId,
                          )?.name ||
                          rel.sourceId;
                        const tgtName =
                          tgtCard?.name ||
                          capabilityMapping.capabilities.find(
                            (c) => c.id === rel.targetId,
                          )?.name ||
                          capabilityMapping.existingDependencies?.nodes.find(
                            (n) => n.id === rel.targetId,
                          )?.name ||
                          rel.targetId;
                        const relDisabled =
                          srcCard?.disabled || tgtCard?.disabled;
                        return (
                          <Stack
                            key={i}
                            direction="row"
                            spacing={0.5}
                            alignItems="center"
                            sx={{
                              opacity: relDisabled ? 0.4 : 1,
                              textDecoration: relDisabled
                                ? "line-through"
                                : undefined,
                            }}
                          >
                            <Typography variant="caption">
                              {srcName}
                            </Typography>
                            <MaterialSymbol
                              icon="arrow_forward"
                              size={12}
                              color="#999"
                            />
                            <Typography variant="caption">
                              {tgtName}
                            </Typography>
                            {rel.label && (
                              <Chip
                                label={rel.label}
                                size="small"
                                variant="outlined"
                                sx={{ fontSize: 9, height: 16, ml: 0.5 }}
                              />
                            )}
                          </Stack>
                        );
                      })}
                    </Stack>
                  </Paper>
                )}

                {/* Dependency Diagram */}
                {merged.nodes.length > 0 && (
                  <Paper
                    variant="outlined"
                    sx={{ mb: 2, overflow: "hidden", position: "relative" }}
                  >
                    <Box
                      sx={{
                        px: 2,
                        py: 1.5,
                        borderBottom: 1,
                        borderColor: "divider",
                      }}
                    >
                      <Typography variant="subtitle2" fontWeight={700}>
                        {t("archlens_architect_dependency_diagram")}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t("archlens_architect_dependency_diagram_hint")}
                      </Typography>
                    </Box>
                    <Box sx={{ height: { xs: 400, md: 600 } }}>
                      <C4DiagramView
                        nodes={merged.nodes}
                        edges={merged.edges}
                        types={types}
                        onNodeClick={() => {}}
                        onHome={() => {}}
                      />
                    </Box>
                  </Paper>
                )}

                <Stack direction="row" spacing={2} flexWrap="wrap">
                  <Button
                    variant="contained"
                    onClick={handleCommit}
                    disabled={savingAssessment}
                    startIcon={<MaterialSymbol icon="rocket_launch" size={18} />}
                  >
                    {t("archlens_commit_initiative")}
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={() => handleSaveAssessment()}
                    disabled={assessmentSaved || savingAssessment}
                    startIcon={<MaterialSymbol icon="save" size={18} />}
                  >
                    {assessmentSaved
                      ? t("archlens_assessment_saved")
                      : t("archlens_save_assessment")}
                  </Button>
                  <Button variant="outlined" onClick={chooseDifferent}>
                    {t("archlens_architect_choose_different")}
                  </Button>
                  <Button variant="text" onClick={reset} color="inherit">
                    {t("archlens_architect_start_over")}
                  </Button>
                </Stack>

                {capabilityMapping && assessmentId && (
                  <CommitInitiativeDialog
                    open={commitDialogOpen}
                    onClose={() => setCommitDialogOpen(false)}
                    assessmentId={assessmentId}
                    requirement={archReq}
                    capabilityMapping={capabilityMapping}
                    objectiveIds={selectedObjectives.map((o) => o.id)}
                    selectedOption={archOptions?.find(
                      (o) => o.id === selectedOptionId,
                    )}
                  />
                )}
              </>
            );
          })()}

        <Snackbar
          open={!!snackMsg}
          autoHideDuration={3000}
          onClose={() => setSnackMsg("")}
          message={snackMsg}
        />

        {archLoading && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, py: 3 }}>
            <CircularProgress size={24} />
            <Typography variant="body2" color="text.secondary">
              {archPhase < 3
                ? t("archlens_architect_loading")
                : selectedOptionId
                  ? t("archlens_architect_analyzing_gaps")
                  : t("archlens_architect_generating_options")}
            </Typography>
          </Box>
        )}
      </Paper>
    </Box>
  );
}
