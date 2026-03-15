import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Grid from "@mui/material/Grid";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useMetamodel } from "@/hooks/useMetamodel";
import { api, ApiError } from "@/api/client";
import type {
  ArchitectureResult,
  ArchSolutionOption,
  CapabilityMappingResult,
  CardType,
} from "@/types";
import type { GNode, GEdge } from "@/features/reports/c4Layout";
import {
  TYPE_COLORS,
  typeChipColor,
  urgencyColor,
  severityIcon,
  severityColor,
  effortColor,
  ARCHITECT_PHASES,
} from "./utils";
import ArchitectureDiagram from "./ArchitectureDiagram";
import C4DiagramView from "@/features/reports/C4DiagramView";

// --- TabPanel helper ---
function TabPanel({ children, value, index }: { children: React.ReactNode; value: number; index: number }) {
  return value === index ? <Box sx={{ pt: 2 }}>{children}</Box> : null;
}

// --- Architecture result view ---

function ArchitectureResultView({ arch, onReset, onChooseDifferent, types }: { arch: ArchitectureResult; onReset: () => void; onChooseDifferent?: () => void; types?: CardType[] }) {
  const { t } = useTranslation("admin");
  const [resultTab, setResultTab] = useState(0);

  const allComps = (arch.layers ?? []).flatMap(l => l.components ?? []);
  const existingCnt = allComps.filter(c => c.existsInLandscape || c.type === "existing").length;
  const newCnt = allComps.length - existingCnt;
  const gapCount = (arch.gaps ?? []).length;
  const criticalGaps = (arch.gaps ?? []).filter(g => g.urgency === "critical").length;
  const integrationCount = (arch.integrations ?? []).length;
  const hasStructuredData = (arch.layers?.length ?? 0) > 0 || gapCount > 0 || integrationCount > 0;

  if (!hasStructuredData) {
    return (
      <Box>
        {typeof arch.summary === "string" && (
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>{t("archlens_architect_summary")}</Typography>
            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{arch.summary}</Typography>
          </Paper>
        )}
        {typeof arch.architecture === "string" && (
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>{t("archlens_architect_result_title")}</Typography>
            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 13 }}>{arch.architecture}</Typography>
          </Paper>
        )}
        {(arch.layers?.length ?? 0) > 0 && (
          <Paper variant="outlined" sx={{ mb: 2 }}>
            <ArchitectureDiagram arch={arch} types={types} />
          </Paper>
        )}
        {!arch.summary && !arch.architecture && (
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, margin: 0 }}>{JSON.stringify(arch, null, 2)}</pre>
          </Paper>
        )}
        <Stack direction="row" spacing={2}>
          {onChooseDifferent && (
            <Button variant="outlined" onClick={onChooseDifferent}>{t("archlens_architect_choose_different")}</Button>
          )}
          <Button variant="outlined" onClick={onReset}>{t("archlens_architect_start_over")}</Button>
        </Stack>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={1}>
          <Box sx={{ flex: 1 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }} flexWrap="wrap">
              {arch.title && <Typography variant="h6" fontWeight={700}>{arch.title}</Typography>}
              {arch.architecturalPattern && <Chip label={arch.architecturalPattern} size="small" color="primary" variant="outlined" />}
            </Stack>
            {arch.summary && <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6, maxWidth: 760 }}>{arch.summary}</Typography>}
            {(arch.estimatedDuration || arch.estimatedComplexity) && (
              <Stack direction="row" spacing={2} sx={{ mt: 0.5 }}>
                {arch.estimatedDuration && <Typography variant="caption" color="text.secondary">{t("archlens_arch_timeline")}: <strong>{arch.estimatedDuration}</strong></Typography>}
                {arch.estimatedComplexity && <Typography variant="caption" color="text.secondary">{t("archlens_arch_complexity")}: <strong>{arch.estimatedComplexity.replace("_", " ")}</strong></Typography>}
              </Stack>
            )}
          </Box>
          <Stack direction="row" spacing={1}>
            {onChooseDifferent && (
              <Button variant="outlined" size="small" onClick={onChooseDifferent}>{t("archlens_architect_choose_different")}</Button>
            )}
            <Button variant="outlined" size="small" onClick={onReset}>{t("archlens_architect_start_over")}</Button>
          </Stack>
        </Stack>
        <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap">
          <Chip icon={<MaterialSymbol icon="check_circle" size={16} />} label={`${existingCnt} ${t("archlens_arch_existing_reused")}`} color="success" variant="outlined" size="small" />
          <Chip icon={<MaterialSymbol icon="add_circle" size={16} />} label={`${newCnt} ${t("archlens_arch_new_components")}`} color="primary" variant="outlined" size="small" />
          {gapCount > 0 && <Chip icon={<MaterialSymbol icon="report_problem" size={16} />} label={`${gapCount} ${t("archlens_arch_gaps")}${criticalGaps > 0 ? ` (${criticalGaps} ${t("archlens_arch_critical")})` : ""}`} color={criticalGaps > 0 ? "error" : "warning"} variant="outlined" size="small" />}
          <Chip icon={<MaterialSymbol icon="sync_alt" size={16} />} label={`${integrationCount} ${t("archlens_arch_integrations")}`} variant="outlined" size="small" />
        </Stack>
        {arch.nfrDecisions && Object.values(arch.nfrDecisions).some(Boolean) && (
          <Grid container spacing={1} sx={{ mt: 1 }}>
            {Object.entries(arch.nfrDecisions).map(([key, val]) => val ? (
              <Grid item key={key} xs={6} sm={4} md={3}>
                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  <Typography variant="overline" color="text.secondary" sx={{ fontSize: 10, lineHeight: 1.2 }}>{key}</Typography>
                  <Typography variant="caption" display="block" sx={{ lineHeight: 1.4 }}>{val}</Typography>
                </Paper>
              </Grid>
            ) : null)}
          </Grid>
        )}
      </Box>

      <Tabs value={resultTab} onChange={(_, v) => setResultTab(v)} sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}>
        <Tab label={t("archlens_architect_diagram")} />
        <Tab label={t("archlens_arch_tab_layers")} />
        <Tab label={`${t("archlens_arch_tab_gaps")}${gapCount > 0 ? ` (${gapCount})` : ""}`} />
        <Tab label={t("archlens_arch_tab_integrations")} />
        <Tab label={t("archlens_arch_tab_plan")} />
      </Tabs>

      <TabPanel value={resultTab} index={0}>
        <Paper variant="outlined">
          <ArchitectureDiagram arch={arch} types={types} />
        </Paper>
      </TabPanel>

      <TabPanel value={resultTab} index={1}>
        <Stack spacing={2}>
          {(arch.layers ?? []).map((layer, li) => (
            <Paper key={li} variant="outlined">
              <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Typography variant="subtitle2" fontWeight={700}>{layer.name}</Typography>
                <Typography variant="caption" color="text.secondary">{(layer.components ?? []).length} {t("archlens_arch_components")}</Typography>
              </Box>
              <Grid container spacing={0} sx={{ "& > *": { borderBottom: 1, borderRight: 1, borderColor: "divider" } }}>
                {(layer.components ?? []).map((comp, ci) => (
                  <Grid item key={ci} xs={12} sm={6} md={4}>
                    <Box sx={{ p: 2, borderLeft: 3, borderColor: TYPE_COLORS[comp.type] || "#999" }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1} sx={{ mb: 0.5 }}>
                        <Typography variant="body2" fontWeight={600}>{comp.name}</Typography>
                        <Chip label={comp.type === "existing" ? t("archlens_arch_in_landscape") : comp.type === "new" ? t("archlens_arch_custom_build") : t("archlens_arch_legend_recommended")} size="small" color={typeChipColor(comp.type)} variant="outlined" sx={{ fontSize: 10, height: 20 }} />
                      </Stack>
                      {comp.product && comp.product !== comp.name && <Typography variant="caption" color="primary" sx={{ fontWeight: 500 }}>{comp.product}</Typography>}
                      {comp.category && <Typography variant="caption" display="block" color="text.secondary">{comp.category}</Typography>}
                      {comp.role && <Typography variant="caption" display="block" color="text.secondary" sx={{ lineHeight: 1.5, mt: 0.5 }}>{comp.role}</Typography>}
                    </Box>
                  </Grid>
                ))}
              </Grid>
            </Paper>
          ))}
        </Stack>
      </TabPanel>

      <TabPanel value={resultTab} index={2}>
        {gapCount === 0 ? <Alert severity="success">{t("archlens_arch_no_gaps")}</Alert> : (
          <Stack spacing={3}>
            {(arch.gaps ?? []).map((gap, gi) => (
              <Paper key={gi} variant="outlined" sx={{ borderTop: 3, borderColor: gap.urgency === "critical" ? "error.main" : gap.urgency === "high" ? "warning.main" : "grey.400" }}>
                <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                    <Typography variant="subtitle2" fontWeight={700}>{gap.capability}</Typography>
                    {gap.urgency && <Chip label={gap.urgency.toUpperCase()} size="small" color={urgencyColor(gap.urgency)} sx={{ fontSize: 10, fontWeight: 700, height: 20 }} />}
                  </Stack>
                  {gap.impact && <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>{t("archlens_arch_impact")}: {gap.impact}</Typography>}
                </Box>
                <Box sx={{ p: 2 }}>
                  <Typography variant="overline" color="text.secondary" sx={{ fontSize: 10, mb: 1.5, display: "block" }}>{t("archlens_arch_market_recommendations")}</Typography>
                  <Grid container spacing={1.5}>
                    {(gap.recommendations ?? []).map((rec, ri) => (
                      <Grid item key={ri} xs={12} sm={6} md={4}>
                        <Paper variant="outlined" sx={{ p: 2, height: "100%", bgcolor: rec.recommended ? "primary.50" : undefined, borderTop: 3, borderColor: ri === 0 ? "#FFD700" : ri === 1 ? "#C0C0C0" : "#CD7F32" }}>
                          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                            <Typography variant="caption" fontWeight={700} sx={{ color: ri === 0 ? "#B8860B" : ri === 1 ? "#808080" : "#8B4513" }}>#{ri + 1}</Typography>
                            <Typography variant="body2" fontWeight={600}>{rec.name}</Typography>
                            {rec.recommended && <Chip label={t("archlens_arch_top_pick")} size="small" color="primary" sx={{ fontSize: 10, height: 18 }} />}
                          </Stack>
                          {rec.vendor && <Typography variant="caption" color="primary">{rec.vendor}</Typography>}
                          {rec.why && <Typography variant="caption" display="block" color="text.secondary" sx={{ lineHeight: 1.5, my: 0.5 }}>{rec.why}</Typography>}
                          {rec.pros?.map((p, i) => <Typography key={`p${i}`} variant="caption" display="block" sx={{ color: "success.main" }}>+ {p}</Typography>)}
                          {rec.cons?.map((c, i) => <Typography key={`c${i}`} variant="caption" display="block" color="text.secondary">- {c}</Typography>)}
                          <Stack direction="row" spacing={0.5} sx={{ mt: 1 }} flexWrap="wrap">
                            {rec.estimatedCost && <Chip label={rec.estimatedCost} size="small" variant="outlined" sx={{ fontSize: 10, height: 20 }} />}
                            {rec.integrationEffort && <Chip label={`${rec.integrationEffort} ${t("archlens_arch_effort")}`} size="small" color={effortColor(rec.integrationEffort)} variant="outlined" sx={{ fontSize: 10, height: 20 }} />}
                          </Stack>
                        </Paper>
                      </Grid>
                    ))}
                  </Grid>
                </Box>
              </Paper>
            ))}
          </Stack>
        )}
      </TabPanel>

      <TabPanel value={resultTab} index={3}>
        <Paper variant="outlined">
          <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider", display: "flex", justifyContent: "space-between" }}>
            <Typography variant="subtitle2" fontWeight={700}>{t("archlens_arch_integration_map")}</Typography>
            <Typography variant="caption" color="text.secondary">{integrationCount} {t("archlens_arch_integrations")}</Typography>
          </Box>
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("archlens_arch_from")}</TableCell>
                  <TableCell>{t("archlens_arch_to")}</TableCell>
                  <TableCell>{t("archlens_arch_protocol")}</TableCell>
                  <TableCell>{t("archlens_arch_direction")}</TableCell>
                  <TableCell>{t("archlens_arch_data_flows")}</TableCell>
                  <TableCell>{t("archlens_arch_notes")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(arch.integrations ?? []).map((intg, i) => (
                  <TableRow key={i}>
                    <TableCell><Typography variant="body2" fontWeight={600}>{intg.from}</Typography></TableCell>
                    <TableCell><Stack direction="row" spacing={0.5} alignItems="center"><MaterialSymbol icon="arrow_forward" size={14} color="#999" /><Typography variant="body2" fontWeight={600}>{intg.to}</Typography></Stack></TableCell>
                    <TableCell><Chip label={intg.protocol || "API"} size="small" color="primary" variant="outlined" sx={{ fontSize: 11 }} /></TableCell>
                    <TableCell><Chip label={intg.direction || "sync"} size="small" color={intg.direction === "async" ? "warning" : "default"} variant="outlined" sx={{ fontSize: 10 }} /></TableCell>
                    <TableCell><Typography variant="caption" color="text.secondary" sx={{ maxWidth: 200, display: "block" }}>{intg.dataFlows}</Typography></TableCell>
                    <TableCell><Typography variant="caption" color="text.secondary" sx={{ maxWidth: 180, display: "block" }}>{intg.notes}</Typography></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Paper>
      </TabPanel>

      <TabPanel value={resultTab} index={4}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <Paper variant="outlined" sx={{ height: "100%" }}>
              <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}>
                <Typography variant="subtitle2" fontWeight={700}>{t("archlens_arch_next_steps")}</Typography>
              </Box>
              <List dense disablePadding>
                {(arch.nextSteps ?? []).map((step, i) => {
                  const s = typeof step === "string" ? { step } : step;
                  return (
                    <ListItem key={i} sx={{ borderBottom: i < (arch.nextSteps?.length ?? 0) - 1 ? 1 : 0, borderColor: "divider", alignItems: "flex-start", py: 1.5 }}>
                      <Box sx={{ width: 26, height: 26, borderRadius: "50%", bgcolor: "primary.main", color: "#fff", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, mr: 1.5, mt: 0.3 }}>{i + 1}</Box>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="body2" sx={{ lineHeight: 1.5 }}>{s.step}</Typography>
                        <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }} flexWrap="wrap">
                          {s.owner && <Chip label={s.owner} size="small" color="primary" variant="outlined" sx={{ fontSize: 10, height: 18 }} />}
                          {s.timeline && <Chip label={s.timeline} size="small" variant="outlined" sx={{ fontSize: 10, height: 18 }} />}
                          {s.effort && <Chip label={s.effort} size="small" variant="outlined" sx={{ fontSize: 10, height: 18 }} />}
                        </Stack>
                      </Box>
                    </ListItem>
                  );
                })}
              </List>
            </Paper>
          </Grid>
          <Grid item xs={12} md={6}>
            <Paper variant="outlined" sx={{ height: "100%" }}>
              <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}>
                <Typography variant="subtitle2" fontWeight={700}>{t("archlens_arch_risks")}</Typography>
              </Box>
              <List dense disablePadding>
                {(arch.risks ?? []).map((risk, i) => {
                  const r = typeof risk === "string" ? { risk, severity: "medium" } : risk;
                  return (
                    <ListItem key={i} sx={{ borderBottom: i < (arch.risks?.length ?? 0) - 1 ? 1 : 0, borderColor: "divider", alignItems: "flex-start", py: 1.5 }}>
                      <MaterialSymbol icon={severityIcon(r.severity)} size={20} color={severityColor(r.severity)} style={{ marginRight: 8, marginTop: 2, flexShrink: 0 }} />
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="body2" fontWeight={500} sx={{ lineHeight: 1.5 }}>{r.risk}</Typography>
                        {r.mitigation && <Typography variant="caption" color="text.secondary" fontStyle="italic">{t("archlens_arch_mitigation")}: {r.mitigation}</Typography>}
                      </Box>
                    </ListItem>
                  );
                })}
              </List>
            </Paper>
          </Grid>
        </Grid>
      </TabPanel>
    </Box>
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

interface ArchSession {
  archReq: string;
  archPhase: number;
  archResult: Record<string, unknown> | null;
  archQuestions: { question: string; why?: string; type?: string; options?: string[]; nfrCategory?: string; answer: string }[];
  phase1Answers: { question: string; answer: string }[];
  archOptions: ArchSolutionOption[] | null;
  selectedOptionId: string | null;
  selectedObjectives: ObjectiveOption[];
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
  const { types } = useMetamodel();
  const saved = loadSession();
  const [archReq, setArchReq] = useState(saved?.archReq ?? "");
  const [archPhase, setArchPhase] = useState(saved?.archPhase ?? 0);
  const [archResult, setArchResult] = useState<Record<string, unknown> | null>(saved?.archResult ?? null);
  const [archLoading, setArchLoading] = useState(false);
  const [archQuestions, setArchQuestions] = useState<{ question: string; why?: string; type?: string; options?: string[]; nfrCategory?: string; answer: string }[]>(saved?.archQuestions ?? []);
  const [phase1Answers, setPhase1Answers] = useState<{ question: string; answer: string }[]>(saved?.phase1Answers ?? []);
  const [archOptions, setArchOptions] = useState<ArchSolutionOption[] | null>(saved?.archOptions ?? null);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(saved?.selectedOptionId ?? null);
  const [error, setError] = useState("");
  // Objective selection state
  const [selectedObjectives, setSelectedObjectives] = useState<ObjectiveOption[]>(saved?.selectedObjectives ?? []);
  const [objectiveSearch, setObjectiveSearch] = useState("");
  const [objectiveOptions, setObjectiveOptions] = useState<ObjectiveOption[]>([]);
  const [objectiveLoading, setObjectiveLoading] = useState(false);
  const objSearchTimer = useRef<ReturnType<typeof setTimeout>>();
  // Capability mapping state
  const [capabilityMapping, setCapabilityMapping] = useState<CapabilityMappingResult | null>(saved?.capabilityMapping ?? null);

  const saveSession = useCallback(() => {
    const session: ArchSession = { archReq, archPhase, archResult, archQuestions, phase1Answers, archOptions, selectedOptionId, selectedObjectives, capabilityMapping };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }, [archReq, archPhase, archResult, archQuestions, phase1Answers, archOptions, selectedOptionId, selectedObjectives, capabilityMapping]);

  useEffect(() => { saveSession(); }, [saveSession]);

  // Debounced objective search
  useEffect(() => {
    if (objectiveSearch.length < 2) { setObjectiveOptions([]); return; }
    clearTimeout(objSearchTimer.current);
    objSearchTimer.current = setTimeout(async () => {
      setObjectiveLoading(true);
      try {
        const results = await api.get<ObjectiveOption[]>(`/archlens/architect/objectives?search=${encodeURIComponent(objectiveSearch)}`);
        setObjectiveOptions(results);
      } catch { setObjectiveOptions([]); }
      finally { setObjectiveLoading(false); }
    }, 300);
    return () => clearTimeout(objSearchTimer.current);
  }, [objectiveSearch]);

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

    // Add proposed cards as nodes with proposed=true
    for (const card of capabilityMapping.proposedCards) {
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

    // Proposed relations as edges
    for (const rel of capabilityMapping.proposedRelations) {
      // Map sourceId/targetId: could reference capability ids or proposed card ids
      const resolveId = (refId: string): string => {
        // Check if it's a capability reference
        const cap = capabilityMapping.capabilities.find(c => c.id === refId);
        if (cap) return cap.existingCardId || cap.id;
        return refId;
      };
      const sid = resolveId(rel.sourceId);
      const tid = resolveId(rel.targetId);
      if (nodeMap.has(sid) && nodeMap.has(tid)) {
        edges.push({
          source: sid,
          target: tid,
          type: rel.relationType,
          label: rel.label,
        });
      }
    }

    return { nodes: Array.from(nodeMap.values()), edges };
  }, [capabilityMapping]);

  const extractQuestions = (data: Record<string, unknown>): { question: string; why?: string; type?: string; options?: string[]; nfrCategory?: string }[] => {
    const raw = Array.isArray(data) ? data
      : Array.isArray(data.questions) ? data.questions
      : Array.isArray(data.items) ? data.items
      : null;
    if (!raw) return [];
    return raw.map((q: Record<string, unknown> | string) =>
      typeof q === "string" ? { question: q }
        : {
            question: String(q.question || q.text || q.q || ""),
            why: q.why as string | undefined,
            type: (q.type as string) || "text",
            options: Array.isArray(q.options) ? q.options.map(String) : undefined,
            nfrCategory: q.nfrCategory as string | undefined,
          }
    );
  };

  const runPhase = async (phase: number) => {
    setArchLoading(true);
    setError("");
    try {
      const payload: Record<string, unknown> = { phase, requirement: archReq };
      if (phase === 2) {
        const qa = archQuestions.map(q => ({ question: q.question, answer: q.answer }));
        payload.phase1QA = qa;
        setPhase1Answers(qa);
      }
      if (phase === 3) {
        // Phase 3a: capability mapping with objectives
        const phase2qa = archQuestions.map(q => ({ question: q.question, answer: q.answer }));
        payload.allQA = [...phase1Answers, ...phase2qa];
        payload.objectiveIds = selectedObjectives.map(o => o.id);
        const result = await api.post<CapabilityMappingResult>("/archlens/architect/phase3/options", payload);
        setCapabilityMapping(result);
        setArchPhase(3);
        setArchQuestions([]);
        setArchLoading(false);
        return;
      }
      if (phase === 4) {
        // Phase 3b: generate architecture for selected option
        const selectedOpt = archOptions?.find(o => o.id === selectedOptionId);
        payload.allQA = [...phase1Answers, ...(archQuestions.map(q => ({ question: q.question, answer: q.answer })))];
        payload.selectedOption = selectedOpt ?? null;
        const result = await api.post<Record<string, unknown>>("/archlens/architect/phase3", payload);
        setArchResult(result);
        setArchPhase(4);
        setArchQuestions([]);
        setArchLoading(false);
        return;
      }
      // Phase 1 or 2
      const result = await api.post<Record<string, unknown>>(`/archlens/architect/phase${phase}`, payload);
      setArchResult(result);
      setArchPhase(phase);
      const questions = extractQuestions(result);
      setArchQuestions(questions.map(q => ({ question: q.question, why: q.why, type: q.type, options: q.options, nfrCategory: q.nfrCategory, answer: "" })));
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setArchLoading(false);
    }
  };

  const handleAnswerChange = (index: number, value: string) => {
    setArchQuestions(prev => prev.map((q, i) => i === index ? { ...q, answer: value } : q));
  };

  const allAnswered = archQuestions.length > 0 && archQuestions.every(q => q.answer.trim());

  const reset = () => {
    setArchPhase(0);
    setArchResult(null);
    setArchQuestions([]);
    setPhase1Answers([]);
    setArchOptions(null);
    setSelectedOptionId(null);
    setSelectedObjectives([]);
    setCapabilityMapping(null);
    setError("");
    sessionStorage.removeItem(SESSION_KEY);
  };

  const chooseDifferent = () => {
    setArchPhase(3);
    setArchResult(null);
    setSelectedOptionId(null);
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="h6">{t("archlens_architect_title")}</Typography>
        {(archPhase > 0 || archResult || archOptions || capabilityMapping) && (
          <Button variant="outlined" size="small" startIcon={<MaterialSymbol icon="add" size={18} />} onClick={reset}>
            {t("archlens_architect_new_assessment")}
          </Button>
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>{t("archlens_architect_description")}</Typography>

      {error && <Alert severity="error" onClose={() => setError("")} sx={{ mb: 2 }}>{error}</Alert>}

      <Paper sx={{ p: 3 }}>
        <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
          {ARCHITECT_PHASES.map(p => (
            <Chip key={p} label={`${t("archlens_phase")} ${p}`} color={archPhase >= p ? "primary" : "default"} variant={archPhase === p ? "filled" : "outlined"} size="small" />
          ))}
        </Stack>

        {archPhase === 0 && (
          <>
            <TextField label={t("archlens_architect_requirement")} value={archReq} onChange={e => setArchReq(e.target.value)} fullWidth multiline minRows={3} sx={{ mb: 2 }} />
            <Button variant="contained" onClick={() => runPhase(1)} disabled={archLoading || !archReq}
              startIcon={archLoading ? <CircularProgress size={18} /> : undefined}>
              {t("archlens_architect_generate_questions")}
            </Button>
          </>
        )}

        {(archPhase === 1 || archPhase === 2) && !archLoading && (
          <>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {archPhase === 1 ? t("archlens_architect_phase1_intro") : t("archlens_architect_phase2_intro")}
            </Typography>
            <Stack spacing={2} sx={{ mb: 2 }}>
              {archQuestions.map((q, i) => {
                const qType = q.type || "text";
                const hasOptions = q.options && q.options.length > 0;
                const selectedMulti = qType === "multi" && q.answer ? q.answer.split(", ").filter(Boolean) : [];
                return (
                <Paper key={i} variant="outlined" sx={{ p: 2, borderLeft: 3, borderColor: "primary.main" }}>
                  <Stack direction="row" alignItems="flex-start" justifyContent="space-between">
                    <Stack direction="row" spacing={1.5} alignItems="flex-start" sx={{ flex: 1 }}>
                      <Box sx={{ width: 28, height: 28, borderRadius: "50%", bgcolor: "primary.main", color: "#fff", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, mt: 0.2 }}>{i + 1}</Box>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="body2" fontWeight="bold">{q.question}</Typography>
                        {q.why && <Typography variant="caption" color="text.secondary" fontStyle="italic" sx={{ display: "block", mt: 0.3 }}>{t("archlens_arch_impact")}: {q.why}</Typography>}
                      </Box>
                    </Stack>
                    {q.nfrCategory && (
                      <Chip label={q.nfrCategory.replace("_", " ")} size="small" variant="outlined" color="secondary" sx={{ fontSize: 10, textTransform: "capitalize", ml: 1 }} />
                    )}
                  </Stack>

                  {qType === "choice" && hasOptions && (
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
                      {q.options!.map((opt) => (
                        <Chip
                          key={opt}
                          label={q.answer === opt ? `✓ ${opt}` : opt}
                          onClick={() => handleAnswerChange(i, opt)}
                          color={q.answer === opt ? "primary" : "default"}
                          variant={q.answer === opt ? "filled" : "outlined"}
                          sx={{ cursor: "pointer", fontWeight: q.answer === opt ? 600 : 400 }}
                        />
                      ))}
                    </Stack>
                  )}

                  {qType === "multi" && hasOptions && (
                    <Box sx={{ mt: 1.5 }}>
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        {q.options!.map((opt) => {
                          const isSelected = selectedMulti.includes(opt);
                          return (
                            <Chip
                              key={opt}
                              label={isSelected ? `✓ ${opt}` : opt}
                              onClick={() => {
                                const next = isSelected
                                  ? selectedMulti.filter(s => s !== opt)
                                  : [...selectedMulti, opt];
                                handleAnswerChange(i, next.join(", "));
                              }}
                              color={isSelected ? "primary" : "default"}
                              variant={isSelected ? "filled" : "outlined"}
                              sx={{ cursor: "pointer", fontWeight: isSelected ? 600 : 400 }}
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
                            const input = (e.target as HTMLInputElement).value.trim();
                            if (input && !selectedMulti.includes(input)) {
                              handleAnswerChange(i, [...selectedMulti, input].join(", "));
                              (e.target as HTMLInputElement).value = "";
                            }
                          }
                        }}
                      />
                    </Box>
                  )}

                  {(qType === "text" || (!hasOptions && qType !== "choice" && qType !== "multi")) && (
                    <TextField value={q.answer} onChange={e => handleAnswerChange(i, e.target.value)} fullWidth multiline minRows={2} size="small" placeholder={t("archlens_architect_answer_placeholder")} sx={{ mt: 1.5 }} />
                  )}
                </Paper>
                );
              })}
            </Stack>
            {archPhase === 2 && allAnswered && (
              <Paper variant="outlined" sx={{ p: 2, mb: 2, borderLeft: 3, borderColor: "secondary.main" }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  {t("archlens_architect_select_objectives")}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
                  {t("archlens_architect_objectives_hint")}
                </Typography>
                <Autocomplete
                  multiple
                  options={objectiveOptions}
                  value={selectedObjectives}
                  getOptionLabel={(o) => o.name}
                  isOptionEqualToValue={(a, b) => a.id === b.id}
                  loading={objectiveLoading}
                  onInputChange={(_, v) => setObjectiveSearch(v)}
                  onChange={(_, v) => setSelectedObjectives(v)}
                  filterSelectedOptions
                  renderOption={(props, option) => (
                    <li {...props} key={option.id}>
                      <Box>
                        <Typography variant="body2">{option.name}</Typography>
                        {option.description && (
                          <Typography variant="caption" color="text.secondary" sx={{ display: "block", maxWidth: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
                      InputProps={{
                        ...params.InputProps,
                        endAdornment: (
                          <>
                            {objectiveLoading && <CircularProgress size={16} />}
                            {params.InputProps.endAdornment}
                          </>
                        ),
                      }}
                    />
                  )}
                />
              </Paper>
            )}

            <Stack direction="row" spacing={2}>
              {archPhase === 1 ? (
                <Button variant="contained" onClick={() => runPhase(2)} disabled={!allAnswered}>
                  {t("archlens_architect_submit_phase2")}
                </Button>
              ) : (
                <Button variant="contained" onClick={() => runPhase(3)} disabled={!allAnswered || selectedObjectives.length === 0}
                  startIcon={<MaterialSymbol icon="hub" size={18} />}>
                  {t("archlens_architect_analyze_capabilities")}
                </Button>
              )}
              <Button variant="text" onClick={reset} color="inherit">{t("archlens_architect_start_over")}</Button>
            </Stack>
          </>
        )}

        {/* Phase 3: Capability mapping + dependency diagram */}
        {archPhase === 3 && !archLoading && capabilityMapping && (() => {
          const merged = buildMergedGraph();
          return (
            <>
              {capabilityMapping.summary && (
                <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                  <Typography variant="body2" sx={{ lineHeight: 1.6 }}>{capabilityMapping.summary}</Typography>
                </Paper>
              )}

              {/* Objectives + Capabilities summary */}
              <Grid container spacing={2} sx={{ mb: 2 }}>
                {/* Capabilities */}
                <Grid item xs={12} md={6}>
                  <Paper variant="outlined" sx={{ p: 2, height: "100%" }}>
                    <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                      <MaterialSymbol icon="account_tree" size={16} style={{ verticalAlign: "text-bottom", marginRight: 4 }} />
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

                {/* Proposed cards */}
                <Grid item xs={12} md={6}>
                  <Paper variant="outlined" sx={{ p: 2, height: "100%" }}>
                    <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                      <MaterialSymbol icon="add_circle" size={16} style={{ verticalAlign: "text-bottom", marginRight: 4 }} />
                      {t("archlens_architect_proposed_cards")}
                    </Typography>
                    <Stack spacing={0.5}>
                      {capabilityMapping.proposedCards.filter(c => c.isNew).map((card) => {
                        const ti = types.find(tp => tp.key === card.cardTypeKey);
                        return (
                          <Stack key={card.id} direction="row" spacing={1} alignItems="center">
                            {ti && <MaterialSymbol icon={ti.icon} size={14} color={ti.color} />}
                            <Typography variant="body2">{card.name}</Typography>
                            {card.subtype && <Typography variant="caption" color="text.secondary">({card.subtype})</Typography>}
                          </Stack>
                        );
                      })}
                      {capabilityMapping.proposedCards.filter(c => c.isNew).length === 0 && (
                        <Typography variant="caption" color="text.secondary">{t("archlens_architect_no_new_cards")}</Typography>
                      )}
                    </Stack>
                  </Paper>
                </Grid>
              </Grid>

              {/* Proposed relations summary */}
              {capabilityMapping.proposedRelations.length > 0 && (
                <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                    <MaterialSymbol icon="share" size={16} style={{ verticalAlign: "text-bottom", marginRight: 4 }} />
                    {t("archlens_architect_proposed_relations")} ({capabilityMapping.proposedRelations.length})
                  </Typography>
                  <Stack spacing={0.3}>
                    {capabilityMapping.proposedRelations.map((rel, i) => {
                      const srcName = capabilityMapping.proposedCards.find(c => c.id === rel.sourceId)?.name
                        || capabilityMapping.capabilities.find(c => c.id === rel.sourceId)?.name
                        || rel.sourceId;
                      const tgtName = capabilityMapping.proposedCards.find(c => c.id === rel.targetId)?.name
                        || capabilityMapping.capabilities.find(c => c.id === rel.targetId)?.name
                        || rel.targetId;
                      return (
                        <Stack key={i} direction="row" spacing={0.5} alignItems="center">
                          <Typography variant="caption">{srcName}</Typography>
                          <MaterialSymbol icon="arrow_forward" size={12} color="#999" />
                          <Typography variant="caption">{tgtName}</Typography>
                          {rel.label && <Chip label={rel.label} size="small" variant="outlined" sx={{ fontSize: 9, height: 16, ml: 0.5 }} />}
                        </Stack>
                      );
                    })}
                  </Stack>
                </Paper>
              )}

              {/* C4 Dependency Diagram */}
              {merged.nodes.length > 0 && (
                <Paper variant="outlined" sx={{ mb: 2 }}>
                  <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}>
                    <Typography variant="subtitle2" fontWeight={700}>
                      {t("archlens_architect_dependency_diagram")}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t("archlens_architect_dependency_diagram_hint")}
                    </Typography>
                  </Box>
                  <Box sx={{ height: 600 }}>
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

              <Stack direction="row" spacing={2}>
                <Button variant="text" onClick={reset} color="inherit">{t("archlens_architect_start_over")}</Button>
              </Stack>
            </>
          );
        })()}

        {/* Phase 4: Full architecture */}
        {archPhase === 4 && !archLoading && archResult && (
          <ArchitectureResultView
            arch={archResult as ArchitectureResult}
            onReset={reset}
            onChooseDifferent={archOptions ? chooseDifferent : undefined}
            types={types}
          />
        )}

        {archLoading && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, py: 3 }}>
            <CircularProgress size={24} />
            <Typography variant="body2" color="text.secondary">
              {archPhase < 3 ? t("archlens_architect_loading") : t("archlens_architect_analyzing_capabilities")}
            </Typography>
          </Box>
        )}
      </Paper>
    </Box>
  );
}
