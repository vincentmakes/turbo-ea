import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useMetamodel } from "@/hooks/useMetamodel";
import { api } from "@/api/client";
import type {
  TurboLensAssessment,
  ArchSolutionOption,
  CapabilityMappingResult,
  DependencyAnalysisResult,
  GapAnalysisResult,
  RelationType,
} from "@/types";
import type { GNode, GEdge } from "@/features/reports/c4Layout";
import C4DiagramView from "@/features/reports/C4DiagramView";
import { approachColor, effortColor, urgencyColor } from "./utils";

function buildMergedGraph(
  mapping: CapabilityMappingResult,
  relationTypes: RelationType[],
): { nodes: GNode[]; edges: GEdge[] } {
  const nodes: GNode[] = [];
  const nodeMap = new Map<string, GNode>();
  const edges: GEdge[] = [];

  // Existing nodes from dependency graph
  const existing = mapping.existingDependencies || { nodes: [], edges: [] };
  for (const n of existing.nodes as GNode[]) {
    if (!nodeMap.has(n.id)) {
      nodeMap.set(n.id, n);
      nodes.push(n);
    }
  }
  for (const e of existing.edges as GEdge[]) {
    edges.push(e);
  }

  // Proposed cards
  for (const card of mapping.proposedCards) {
    if (!nodeMap.has(card.id)) {
      const node: GNode = {
        id: card.id,
        name: card.name,
        type: card.cardTypeKey,
        proposed: card.isNew,
      };
      nodeMap.set(card.id, node);
      nodes.push(node);
    }
  }

  // Capabilities (use existingCardId when available for consistent linking)
  for (const cap of mapping.capabilities) {
    const capId = cap.existingCardId || cap.id;
    if (!nodeMap.has(capId)) {
      const node: GNode = {
        id: capId,
        name: cap.name,
        type: "BusinessCapability",
        proposed: cap.isNew,
      };
      nodeMap.set(capId, node);
      nodes.push(node);
    }
  }

  // Resolve relation endpoints — handle dedup remapping + capability IDs
  const resolveId = (refId: string): string => {
    const cap = mapping.capabilities.find(
      (c) => c.id === refId || c.existingCardId === refId,
    );
    if (cap) return cap.existingCardId || cap.id;
    const pc = mapping.proposedCards.find(
      (c) => c.existingCardId === refId,
    );
    if (pc) return pc.id;
    return refId;
  };

  // Proposed relations — enforce metamodel source/target direction
  for (const rel of mapping.proposedRelations) {
    let sid = resolveId(rel.sourceId);
    let tid = resolveId(rel.targetId);
    if (!nodeMap.has(sid) || !nodeMap.has(tid)) continue;
    const rt = relationTypes.find((r) => r.key === rel.relationType);
    if (rt) {
      const sType = nodeMap.get(sid)?.type;
      const tType = nodeMap.get(tid)?.type;
      if (sType === rt.target_type_key && tType === rt.source_type_key) {
        [sid, tid] = [tid, sid];
      }
    }
    edges.push({
      source: sid,
      target: tid,
      type: rel.relationType || "",
      label: rt?.label || rel.label || "",
      reverse_label: rt?.reverse_label,
    });
  }

  return { nodes, edges };
}

export default function AssessmentViewer() {
  const { t } = useTranslation("admin");
  const { types, relationTypes } = useMetamodel();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [assessment, setAssessment] = useState<TurboLensAssessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api
      .get<TurboLensAssessment>(`/turbolens/assessments/${id}`)
      .then(setAssessment)
      .catch((err) => setError(err.message || "Failed to load assessment"))
      .finally(() => setLoading(false));
  }, [id]);

  const sd = assessment?.session_data as Record<string, unknown> | null;

  const requirement = (sd?.requirement as string) || (sd?.archReq as string) || "";
  const objectives = (sd?.selectedObjectives as { id: string; name: string }[]) || [];
  const capabilities =
    (sd?.selectedCapabilities as { id: string; name: string; isNew?: boolean }[]) || [];
  // Support both old format (phase1Questions/phase2Questions) and new (phase1Answers/archQuestions)
  const phase1Questions =
    (sd?.phase1Questions as { question: string; answer: string }[]) ||
    (sd?.phase1Answers as { question: string; answer: string }[]) ||
    [];
  const phase2Questions =
    (sd?.phase2Questions as { question: string; answer: string; nfrCategory?: string }[]) ||
    (sd?.phase2Answers as { question: string; answer: string; nfrCategory?: string }[]) ||
    (sd?.archQuestions as { question: string; answer: string; nfrCategory?: string }[]) ||
    [];
  const archOptions = (sd?.archOptions as ArchSolutionOption[]) || [];
  const selectedOptionId = sd?.selectedOptionId as string | null;
  const gapResult = sd?.gapResult as GapAnalysisResult | null;
  const selectedRecs = new Set<string>((sd?.selectedRecs as string[]) ?? []);
  const depsResult = sd?.depsResult as DependencyAnalysisResult | null;
  const selectedDeps = new Set<string>((sd?.selectedDeps as string[]) ?? []);
  const capabilityMapping = sd?.capabilityMapping as CapabilityMappingResult | null;
  const canResume = assessment?.status !== "committed";

  const merged = useMemo(() => {
    if (!capabilityMapping) return { nodes: [] as GNode[], edges: [] as GEdge[] };
    return buildMergedGraph(capabilityMapping, relationTypes);
  }, [capabilityMapping, relationTypes]);

  const nameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!capabilityMapping) return map;
    for (const c of capabilityMapping.proposedCards) {
      map.set(c.id, c.name);
      if (c.existingCardId) map.set(c.existingCardId, c.name);
    }
    for (const c of capabilityMapping.capabilities) {
      map.set(c.id, c.name);
      if (c.existingCardId) map.set(c.existingCardId, c.name);
    }
    for (const n of capabilityMapping.existingDependencies?.nodes ?? []) {
      map.set(n.id, n.name);
    }
    return map;
  }, [capabilityMapping]);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <Typography variant="body2" color="text.secondary">
          Loading...
        </Typography>
      </Box>
    );
  }

  if (error || !assessment) {
    return <Alert severity="error">{error || "Assessment not found"}</Alert>;
  }

  const typeInfo = (key: string) => types.find((tp) => tp.key === key);

  return (
    <Box sx={{ maxWidth: 1100, mx: "auto" }}>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
        <Button
          variant="text"
          size="small"
          onClick={() => navigate("/turbolens?tab=assessments")}
          startIcon={<MaterialSymbol icon="arrow_back" size={18} />}
        >
          {t("turbolens_assessments_title")}
        </Button>
      </Stack>

      <Paper sx={{ p: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Typography variant="h6">{assessment.title}</Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            {canResume && (
              <Button
                size="small"
                variant="contained"
                onClick={() => navigate(`/turbolens?tab=architect&resume=${assessment.id}`)}
                startIcon={<MaterialSymbol icon="play_arrow" size={18} />}
              >
                {t("turbolens_assessment_resume")}
              </Button>
            )}
            <Chip
              size="small"
              label={
                assessment.status === "committed"
                  ? t("turbolens_assessment_status_committed")
                  : t("turbolens_assessment_status_saved")
              }
              color={assessment.status === "committed" ? "success" : "primary"}
            />
            {assessment.created_by_name && (
              <Typography variant="caption" color="text.secondary">
                {t("turbolens_assessment_created_by")}: {assessment.created_by_name}
              </Typography>
            )}
          </Stack>
        </Stack>

        {assessment.status === "committed" && assessment.initiative_id && (
          <Alert
            severity="success"
            sx={{ mb: 2 }}
            action={
              <Button
                size="small"
                onClick={() => navigate(`/cards/${assessment.initiative_id}`)}
              >
                {t("turbolens_commit_open_initiative")}
              </Button>
            }
          >
            {t("turbolens_assessment_linked_initiative")}: {assessment.initiative_name}
          </Alert>
        )}

        {/* Phase 0: Requirements */}
        <SectionHeader icon="description" label={t("turbolens_assessment_phase_requirements")} />
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
            {requirement}
          </Typography>
          {objectives.length > 0 && (
            <Box sx={{ mt: 1 }}>
              <Typography variant="caption" fontWeight={600}>
                {t("turbolens_architect_select_objectives")}:
              </Typography>
              <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mt: 0.5 }}>
                {objectives.map((o) => (
                  <Chip key={o.id} label={o.name} size="small" variant="outlined" />
                ))}
              </Stack>
            </Box>
          )}
          {capabilities.length > 0 && (
            <Box sx={{ mt: 1 }}>
              <Typography variant="caption" fontWeight={600}>
                {t("turbolens_architect_select_capabilities")}:
              </Typography>
              <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mt: 0.5 }}>
                {capabilities.map((c) => (
                  <Chip
                    key={c.id}
                    label={c.name}
                    size="small"
                    variant="outlined"
                    color={c.isNew ? "primary" : "default"}
                  />
                ))}
              </Stack>
            </Box>
          )}
        </Paper>

        {/* Phase 1: Business Fit */}
        {phase1Questions.length > 0 && (
          <>
            <SectionHeader icon="business" label={t("turbolens_assessment_phase_business")} />
            <QAList questions={phase1Questions} />
          </>
        )}

        {/* Phase 2: Technical Fit */}
        {phase2Questions.length > 0 && (
          <>
            <SectionHeader icon="engineering" label={t("turbolens_assessment_phase_technical")} />
            <QAList questions={phase2Questions} />
          </>
        )}

        {/* Phase 3: Solution */}
        {archOptions.length > 0 && (
          <>
            <SectionHeader icon="lightbulb" label={t("turbolens_assessment_phase_solution")} />
            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
              <Grid container spacing={2}>
                {archOptions.map((opt) => (
                  <Grid item xs={12} md={6} key={opt.id}>
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 1.5,
                        borderColor:
                          opt.id === selectedOptionId ? "primary.main" : "divider",
                        borderWidth: opt.id === selectedOptionId ? 2 : 1,
                      }}
                    >
                      <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                        <Typography variant="subtitle2" fontWeight={700}>
                          {opt.title}
                        </Typography>
                        <Chip
                          label={opt.approach}
                          size="small"
                          color={approachColor(opt.approach)}
                          sx={{ textTransform: "capitalize" }}
                        />
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {opt.summary}
                      </Typography>
                      {opt.id === selectedOptionId && (
                        <Chip
                          label={t("turbolens_assessment_selected")}
                          size="small"
                          color="primary"
                          sx={{ mt: 0.5 }}
                        />
                      )}
                    </Paper>
                  </Grid>
                ))}
              </Grid>

            </Paper>
          </>
        )}

        {/* Phase 3b: Gap Analysis */}
        {gapResult && gapResult.gaps?.length > 0 && (
          <>
            <SectionHeader icon="troubleshoot" label={t("turbolens_assessment_phase_gaps")} />
            {gapResult.summary && (
              <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                <Typography variant="body2" sx={{ lineHeight: 1.6 }}>
                  {gapResult.summary}
                </Typography>
              </Paper>
            )}
            <Stack spacing={3} sx={{ mb: 2 }}>
              {gapResult.gaps.map((gap, gi) => (
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
                  <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}>
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
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                        {t("turbolens_arch_impact")}: {gap.impact}
                      </Typography>
                    )}
                  </Box>
                  {(gap.recommendations ?? []).length > 0 && (
                    <Box sx={{ p: 2 }}>
                      <Typography variant="overline" color="text.secondary" sx={{ fontSize: 10, mb: 1.5, display: "block" }}>
                        {t("turbolens_arch_market_recommendations")}
                      </Typography>
                      <Grid container spacing={1.5}>
                        {(gap.recommendations ?? []).map((rec, ri) => {
                          const rk = `${gi}:${ri}`;
                          const isSelected = selectedRecs.has(rk);
                          return (
                            <Grid item key={ri} xs={12} sm={6} md={4}>
                              <Paper
                                variant="outlined"
                                sx={{
                                  p: 2,
                                  height: "100%",
                                  bgcolor: isSelected ? "action.selected" : undefined,
                                  borderTop: 3,
                                  borderColor: ri === 0 ? "#FFD700" : ri === 1 ? "#C0C0C0" : "#CD7F32",
                                  outline: isSelected ? "2px solid" : undefined,
                                  outlineColor: isSelected ? "primary.main" : undefined,
                                }}
                              >
                                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                                  <Typography variant="caption" fontWeight={700} sx={{ color: ri === 0 ? "#B8860B" : ri === 1 ? "#808080" : "#8B4513" }}>
                                    #{ri + 1}
                                  </Typography>
                                  <Typography variant="body2" fontWeight={600}>{rec.name}</Typography>
                                  {isSelected && (
                                    <Chip label={t("turbolens_assessment_selected")} size="small" color="primary" sx={{ fontSize: 10, height: 18 }} />
                                  )}
                                </Stack>
                                {rec.vendor && <Typography variant="caption" color="primary">{rec.vendor}</Typography>}
                                {rec.why && (
                                  <Typography variant="caption" display="block" color="text.secondary" sx={{ lineHeight: 1.5, my: 0.5 }}>
                                    {rec.why}
                                  </Typography>
                                )}
                                {rec.pros?.map((p, i) => (
                                  <Typography key={`p${i}`} variant="caption" display="block" sx={{ color: "success.main" }}>+ {p}</Typography>
                                ))}
                                {rec.cons?.map((c, i) => (
                                  <Typography key={`c${i}`} variant="caption" display="block" color="text.secondary">- {c}</Typography>
                                ))}
                                <Stack direction="row" spacing={0.5} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
                                  {rec.estimatedCost && (
                                    <Chip label={rec.estimatedCost} size="small" variant="outlined" sx={{ fontSize: 10, height: 20 }} />
                                  )}
                                  {rec.integrationEffort && (
                                    <Chip label={`${rec.integrationEffort} ${t("turbolens_arch_effort")}`} size="small" color={effortColor(rec.integrationEffort)} variant="outlined" sx={{ fontSize: 10, height: 20 }} />
                                  )}
                                </Stack>
                              </Paper>
                            </Grid>
                          );
                        })}
                      </Grid>
                    </Box>
                  )}
                </Paper>
              ))}
            </Stack>
          </>
        )}

        {/* Phase 3c: Dependency Analysis */}
        {depsResult && depsResult.dependencies?.length > 0 && (
          <>
            <SectionHeader icon="hub" label={t("turbolens_assessment_phase_deps")} />
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
                  <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}>
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
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                        {dep.reason}
                      </Typography>
                    )}
                  </Box>
                  {(dep.options ?? []).length > 0 && (
                    <Box sx={{ p: 2 }}>
                      <Grid container spacing={1.5}>
                        {(dep.options ?? []).map((opt, oi) => {
                          const dk = `${di}:${oi}`;
                          const isSelected = selectedDeps.has(dk);
                          return (
                            <Grid item key={oi} xs={12} sm={6} md={4}>
                              <Paper
                                variant="outlined"
                                sx={{
                                  p: 2,
                                  height: "100%",
                                  bgcolor: isSelected ? "action.selected" : undefined,
                                  outline: isSelected ? "2px solid" : undefined,
                                  outlineColor: isSelected ? "primary.main" : undefined,
                                }}
                              >
                                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                                  <Typography variant="body2" fontWeight={600}>{opt.name}</Typography>
                                  {isSelected && (
                                    <Chip label={t("turbolens_assessment_selected")} size="small" color="primary" sx={{ fontSize: 10, height: 18 }} />
                                  )}
                                </Stack>
                                {opt.vendor && <Typography variant="caption" color="primary">{opt.vendor}</Typography>}
                                {opt.why && (
                                  <Typography variant="caption" display="block" color="text.secondary" sx={{ lineHeight: 1.5, my: 0.5 }}>
                                    {opt.why}
                                  </Typography>
                                )}
                                {opt.pros?.map((p, i) => (
                                  <Typography key={`p${i}`} variant="caption" display="block" sx={{ color: "success.main" }}>+ {p}</Typography>
                                ))}
                                {opt.cons?.map((c, i) => (
                                  <Typography key={`c${i}`} variant="caption" display="block" color="text.secondary">- {c}</Typography>
                                ))}
                                <Stack direction="row" spacing={0.5} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
                                  {opt.estimatedCost && (
                                    <Chip label={opt.estimatedCost} size="small" variant="outlined" sx={{ fontSize: 10, height: 20 }} />
                                  )}
                                  {opt.integrationEffort && (
                                    <Chip label={`${opt.integrationEffort} ${t("turbolens_arch_effort")}`} size="small" color={effortColor(opt.integrationEffort)} variant="outlined" sx={{ fontSize: 10, height: 20 }} />
                                  )}
                                </Stack>
                              </Paper>
                            </Grid>
                          );
                        })}
                      </Grid>
                    </Box>
                  )}
                </Paper>
              ))}
            </Stack>
          </>
        )}

        {/* Phase 5: Target Architecture */}
        {capabilityMapping && (
          <>
            <SectionHeader icon="architecture" label={t("turbolens_assessment_phase_target")} />
            {capabilityMapping.summary && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {capabilityMapping.summary}
              </Typography>
            )}
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={12} md={6}>
                <Paper variant="outlined" sx={{ p: 2, height: "100%" }}>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                    {t("turbolens_architect_capabilities")}
                  </Typography>
                  <Stack spacing={0.5}>
                    {capabilityMapping.capabilities.map((cap) => (
                      <Stack key={cap.id} direction="row" spacing={1} alignItems="center">
                        <Chip
                          label={cap.isNew ? t("turbolens_architect_new") : t("turbolens_architect_existing")}
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
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                    {t("turbolens_architect_proposed_cards")}
                  </Typography>
                  <Stack spacing={0.5}>
                    {capabilityMapping.proposedCards
                      .filter((c) => c.isNew)
                      .map((card) => {
                        const ti = typeInfo(card.cardTypeKey);
                        return (
                          <Stack key={card.id} direction="row" spacing={1} alignItems="center">
                            {ti && <MaterialSymbol icon={ti.icon} size={14} color={ti.color} />}
                            <Typography variant="body2">{card.name}</Typography>
                            {card.subtype && (
                              <Typography variant="caption" color="text.secondary">
                                ({card.subtype})
                              </Typography>
                            )}
                          </Stack>
                        );
                      })}
                  </Stack>
                </Paper>
              </Grid>
            </Grid>

            {capabilityMapping.proposedRelations.length > 0 && (
              <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                  {t("turbolens_architect_proposed_relations")} (
                  {capabilityMapping.proposedRelations.length})
                </Typography>
                <Stack spacing={0.3}>
                  {capabilityMapping.proposedRelations.map((rel, i) => {
                    const srcName = nameMap.get(rel.sourceId) ?? rel.sourceId;
                    const tgtName = nameMap.get(rel.targetId) ?? rel.targetId;
                    return (
                      <Stack key={i} direction="row" spacing={0.5} alignItems="center">
                        <Typography variant="caption">{srcName}</Typography>
                        <MaterialSymbol icon="arrow_forward" size={12} color="#999" />
                        <Typography variant="caption">{tgtName}</Typography>
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

            {merged.nodes.length > 0 && (
              <Paper variant="outlined" sx={{ mb: 2 }}>
                <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}>
                  <Typography variant="subtitle2" fontWeight={700}>
                    {t("turbolens_architect_dependency_diagram")}
                  </Typography>
                </Box>
                <Box sx={{ height: 500 }}>
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
          </>
        )}
      </Paper>
    </Box>
  );
}

function SectionHeader({ icon, label }: { icon: string; label: string }) {
  return (
    <>
      <Divider sx={{ my: 2 }} />
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <MaterialSymbol icon={icon} size={20} />
        <Typography variant="subtitle1" fontWeight={700}>
          {label}
        </Typography>
      </Stack>
    </>
  );
}

function QAList({
  questions,
}: {
  questions: { question: string; answer: string; nfrCategory?: string }[];
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Stack spacing={1.5}>
        {questions.map((q, i) => (
          <Box key={i}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="body2" fontWeight={600}>
                {q.question}
              </Typography>
              {q.nfrCategory && (
                <Chip label={q.nfrCategory} size="small" variant="outlined" sx={{ fontSize: 10, height: 18 }} />
              )}
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, whiteSpace: "pre-wrap" }}>
              {q.answer || "—"}
            </Typography>
          </Box>
        ))}
      </Stack>
    </Paper>
  );
}
