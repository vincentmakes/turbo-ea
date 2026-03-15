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
  ArchLensAssessment,
  ArchSolutionOption,
  CapabilityMappingResult,
  GapAnalysisResult,
  RelationType,
} from "@/types";
import type { GNode, GEdge } from "@/features/reports/c4Layout";
import C4DiagramView from "@/features/reports/C4DiagramView";
import { approachColor, urgencyColor } from "./utils";

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
        proposed: true,
      };
      nodeMap.set(card.id, node);
      nodes.push(node);
    }
  }

  // Capabilities
  for (const cap of mapping.capabilities) {
    if (!nodeMap.has(cap.id)) {
      const node: GNode = {
        id: cap.id,
        name: cap.name,
        type: "BusinessCapability",
        proposed: cap.isNew,
      };
      nodeMap.set(cap.id, node);
      nodes.push(node);
    }
  }

  // Proposed relations — enforce metamodel source/target direction
  for (const rel of mapping.proposedRelations) {
    let sid = rel.sourceId;
    let tid = rel.targetId;
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
  const [assessment, setAssessment] = useState<ArchLensAssessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api
      .get<ArchLensAssessment>(`/archlens/assessments/${id}`)
      .then(setAssessment)
      .catch((err) => setError(err.message || "Failed to load assessment"))
      .finally(() => setLoading(false));
  }, [id]);

  const sd = assessment?.session_data as Record<string, unknown> | null;

  const requirement = (sd?.requirement as string) || "";
  const objectives = (sd?.selectedObjectives as { id: string; name: string }[]) || [];
  const capabilities =
    (sd?.selectedCapabilities as { id: string; name: string; isNew?: boolean }[]) || [];
  const phase1Questions =
    (sd?.phase1Questions as { question: string; answer: string }[]) || [];
  const phase2Questions =
    (sd?.phase2Questions as { question: string; answer: string; nfrCategory?: string }[]) || [];
  const archOptions = (sd?.archOptions as ArchSolutionOption[]) || [];
  const selectedOptionId = sd?.selectedOptionId as string | null;
  const gapResult = sd?.gapResult as GapAnalysisResult | null;
  const capabilityMapping = sd?.capabilityMapping as CapabilityMappingResult | null;

  const merged = useMemo(() => {
    if (!capabilityMapping) return { nodes: [] as GNode[], edges: [] as GEdge[] };
    return buildMergedGraph(capabilityMapping, relationTypes);
  }, [capabilityMapping, relationTypes]);

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
          onClick={() => navigate("/archlens?tab=assessments")}
          startIcon={<MaterialSymbol icon="arrow_back" size={18} />}
        >
          {t("archlens_assessments_title")}
        </Button>
      </Stack>

      <Paper sx={{ p: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Typography variant="h6">{assessment.title}</Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip
              size="small"
              label={
                assessment.status === "committed"
                  ? t("archlens_assessment_status_committed")
                  : t("archlens_assessment_status_saved")
              }
              color={assessment.status === "committed" ? "success" : "primary"}
            />
            {assessment.created_by_name && (
              <Typography variant="caption" color="text.secondary">
                {t("archlens_assessment_created_by")}: {assessment.created_by_name}
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
                {t("archlens_commit_open_initiative")}
              </Button>
            }
          >
            {t("archlens_assessment_linked_initiative")}: {assessment.initiative_name}
          </Alert>
        )}

        {/* Phase 0: Requirements */}
        <SectionHeader icon="description" label={t("archlens_assessment_phase_requirements")} />
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
            {requirement}
          </Typography>
          {objectives.length > 0 && (
            <Box sx={{ mt: 1 }}>
              <Typography variant="caption" fontWeight={600}>
                {t("archlens_architect_select_objectives")}:
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
                {t("archlens_architect_select_capabilities")}:
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
            <SectionHeader icon="business" label={t("archlens_assessment_phase_business")} />
            <QAList questions={phase1Questions} />
          </>
        )}

        {/* Phase 2: Technical Fit */}
        {phase2Questions.length > 0 && (
          <>
            <SectionHeader icon="engineering" label={t("archlens_assessment_phase_technical")} />
            <QAList questions={phase2Questions} />
          </>
        )}

        {/* Phase 3: Solution */}
        {archOptions.length > 0 && (
          <>
            <SectionHeader icon="lightbulb" label={t("archlens_assessment_phase_solution")} />
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
                          label={t("archlens_assessment_selected")}
                          size="small"
                          color="primary"
                          sx={{ mt: 0.5 }}
                        />
                      )}
                    </Paper>
                  </Grid>
                ))}
              </Grid>

              {gapResult && gapResult.gaps?.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                    Gap Analysis
                  </Typography>
                  {gapResult.gaps.map((gap, i) => (
                    <Stack key={i} direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                      <Chip
                        label={gap.urgency || "medium"}
                        size="small"
                        color={urgencyColor(gap.urgency)}
                        sx={{ fontSize: 10, height: 18 }}
                      />
                      <Typography variant="caption">{gap.capability}</Typography>
                    </Stack>
                  ))}
                </Box>
              )}
            </Paper>
          </>
        )}

        {/* Phase 5: Target Architecture */}
        {capabilityMapping && (
          <>
            <SectionHeader icon="architecture" label={t("archlens_assessment_phase_target")} />
            {capabilityMapping.summary && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {capabilityMapping.summary}
              </Typography>
            )}
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={12} md={6}>
                <Paper variant="outlined" sx={{ p: 2, height: "100%" }}>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                    {t("archlens_architect_capabilities")}
                  </Typography>
                  <Stack spacing={0.5}>
                    {capabilityMapping.capabilities.map((cap) => (
                      <Stack key={cap.id} direction="row" spacing={1} alignItems="center">
                        <Chip
                          label={cap.isNew ? t("archlens_architect_new") : t("archlens_architect_existing")}
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
                    {t("archlens_architect_proposed_cards")}
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
                  {t("archlens_architect_proposed_relations")} (
                  {capabilityMapping.proposedRelations.length})
                </Typography>
                <Stack spacing={0.3}>
                  {capabilityMapping.proposedRelations.map((rel, i) => {
                    const srcName =
                      capabilityMapping.proposedCards.find((c) => c.id === rel.sourceId)?.name ||
                      capabilityMapping.capabilities.find((c) => c.id === rel.sourceId)?.name ||
                      rel.sourceId;
                    const tgtName =
                      capabilityMapping.proposedCards.find((c) => c.id === rel.targetId)?.name ||
                      capabilityMapping.capabilities.find((c) => c.id === rel.targetId)?.name ||
                      rel.targetId;
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
                    {t("archlens_architect_dependency_diagram")}
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
