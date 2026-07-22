/**
 * Architecture Planning editor — the manual (no-AI) counterpart of the
 * TurboLens Architect. The architect optionally names the business objectives
 * the change supports, picks scope cards, captures a snapshotted baseline of
 * the surrounding landscape, then applies change operations (add / remove /
 * replace card, add / remove relation). A live Layered Dependency View renders
 * the merged before/after diagram with diff indicators.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CardPicker, { type CardOption } from "@/components/CardPicker";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useRelationLabel, useSubtypeLabel, useTypeLabel } from "@/hooks/useResolveLabel";
import LayeredDependencyView, {
  LDV_CHANGE_COLORS,
} from "@/features/reports/LayeredDependencyView";
import type { GEdge, GNode } from "@/features/reports/layeredDependencyLayout";
import type {
  ArchitecturePlan,
  PlanBaseline,
  PlanCardRef,
  PlanChangeOp,
  PlanProposedCard,
  RelationType,
} from "@/types";
import BlastRadiusNotice from "./BlastRadiusNotice";
import MultiCardPicker from "./MultiCardPicker";
import PlanInsightsPanel from "./PlanInsightsPanel";
import { buildPlanGraph, validatePlanOps } from "./planGraph";
import { deriveScopeFromObjectives } from "./planScope";

const OP_META: Record<PlanChangeOp["op"], { icon: string; color: string }> = {
  add_card: { icon: "add_circle", color: LDV_CHANGE_COLORS.added },
  remove_card: { icon: "cancel", color: LDV_CHANGE_COLORS.removed },
  replace_card: { icon: "swap_horiz", color: LDV_CHANGE_COLORS.changed },
  add_relation: { icon: "add_link", color: LDV_CHANGE_COLORS.added },
  remove_relation: { icon: "link_off", color: LDV_CHANGE_COLORS.removed },
};

/** Persisted alongside baseline/changes so existing-card refs stay resolvable. */
type CardRefMap = Record<string, { name: string; type: string }>;

interface NodeOption {
  id: string;
  name: string;
  type: string;
}

function newTempId(): string {
  return `tmp:${crypto.randomUUID()}`;
}

export default function PlanEditor() {
  const { t } = useTranslation(["delivery", "common"]);
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { types, relationTypes } = useMetamodel();
  const typeLabel = useTypeLabel();
  const relationLabel = useRelationLabel();

  const [loading, setLoading] = useState(!!id);
  const [error, setError] = useState("");
  const [snackbar, setSnackbar] = useState("");
  const [saving, setSaving] = useState(false);

  // Plan document state
  const [planId, setPlanId] = useState<string | null>(id ?? null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [initiative, setInitiative] = useState<CardOption | null>(null);
  const [objectives, setObjectives] = useState<CardOption[]>([]);
  const [scopeCards, setScopeCards] = useState<CardOption[]>([]);
  const [depth, setDepth] = useState(2);
  const [baseline, setBaseline] = useState<PlanBaseline | null>(null);
  const [baselineCapturedAt, setBaselineCapturedAt] = useState<string | undefined>();
  const [changes, setChanges] = useState<PlanChangeOp[]>([]);
  const [cardRefs, setCardRefs] = useState<CardRefMap>({});
  const [capturing, setCapturing] = useState(false);
  const [deriving, setDeriving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [openDialog, setOpenDialog] = useState<PlanChangeOp["op"] | null>(null);

  // ── Load an existing plan ─────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api
      .get<ArchitecturePlan>(`/architecture-plans/${id}`)
      .then((p) => {
        if (p.status === "committed") {
          navigate(`/ea-delivery/plans/${p.id}/preview`, { replace: true });
          return;
        }
        setPlanId(p.id);
        setTitle(p.title);
        setDescription(p.description ?? "");
        const scope = (p.scope ?? {}) as Record<string, unknown>;
        setDepth((scope.depth as number) || 2);
        setObjectives((scope.objectiveRefs as CardOption[]) ?? []);
        setScopeCards((scope.cardRefs as CardOption[]) ?? []);
        const pd = (p.plan_data ?? {}) as Record<string, unknown>;
        setBaseline((pd.baseline as PlanBaseline) ?? null);
        setBaselineCapturedAt(pd.baselineCapturedAt as string | undefined);
        setChanges((pd.changes as PlanChangeOp[]) ?? []);
        setCardRefs((pd.cardRefs as CardRefMap) ?? {});
        if (p.initiative_id) {
          api
            .get<{ id: string; name: string; type: string }>(`/cards/${p.initiative_id}`)
            .then((c) => setInitiative({ id: c.id, name: c.name, type: c.type }))
            .catch(() => undefined);
        }
      })
      .catch((err) => setError(err.message || "Failed to load plan"))
      .finally(() => setLoading(false));
  }, [id, navigate]);

  // Pre-link the initiative from ?initiative=<id> (New-from-workspace flow)
  const initiativeParam = searchParams.get("initiative");
  useEffect(() => {
    if (!initiativeParam || id) return;
    api
      .get<{ id: string; name: string; type: string }>(`/cards/${initiativeParam}`)
      .then((c) => setInitiative({ id: c.id, name: c.name, type: c.type }))
      .catch(() => undefined);
  }, [initiativeParam, id]);

  // ── Baseline capture ──────────────────────────────────────────────────
  const captureBaseline = useCallback(async () => {
    if (scopeCards.length === 0) return;
    setCapturing(true);
    setError("");
    try {
      const results = await Promise.all(
        scopeCards.map((c) =>
          api.get<{ nodes: GNode[]; edges: GEdge[] }>(
            `/reports/dependencies?center_id=${c.id}&depth=${depth}`,
          ),
        ),
      );
      const nodeMap = new Map<string, GNode>();
      const edgeKeys = new Set<string>();
      const edges: GEdge[] = [];
      for (const r of results) {
        for (const n of r.nodes) if (!nodeMap.has(n.id)) nodeMap.set(n.id, n);
        for (const e of r.edges) {
          const key = `${e.type}|${e.source}|${e.target}`;
          if (!edgeKeys.has(key)) {
            edgeKeys.add(key);
            edges.push(e);
          }
        }
      }
      // Objectives from the first step join the baseline (Strategy layer)
      // so the diagram shows the "why" alongside the change.
      for (const o of objectives) {
        if (!nodeMap.has(o.id)) {
          nodeMap.set(o.id, { id: o.id, name: o.name, type: o.type });
        }
      }
      setBaseline({ nodes: [...nodeMap.values()], edges });
      setBaselineCapturedAt(new Date().toISOString());
      setDirty(true);
    } catch (err) {
      setError((err as Error).message || "Failed to capture baseline");
    } finally {
      setCapturing(false);
    }
  }, [scopeCards, depth, objectives]);

  // ── Strategy-driven scope: derive the affected landscape from objectives ──
  const deriveScope = useCallback(async () => {
    if (objectives.length === 0) return;
    setDeriving(true);
    setError("");
    try {
      const { baseline: derived } = await deriveScopeFromObjectives(objectives, depth);
      setBaseline(derived);
      setBaselineCapturedAt(new Date().toISOString());
      // Record the objectives as the scope provenance so a later Refresh works.
      setScopeCards((prev) => {
        const byId = new Map(prev.map((c) => [c.id, c]));
        for (const o of objectives) if (!byId.has(o.id)) byId.set(o.id, o);
        return [...byId.values()];
      });
      setDirty(true);
    } catch (err) {
      setError((err as Error).message || "Failed to derive scope");
    } finally {
      setDeriving(false);
    }
  }, [objectives, depth]);

  // ── Merged graph + validation ─────────────────────────────────────────
  const cardLookup = useMemo(() => {
    const map = new Map<string, { name: string; type: string }>();
    for (const [cid, ref] of Object.entries(cardRefs)) map.set(cid, ref);
    return map;
  }, [cardRefs]);

  const merged = useMemo(() => {
    if (!baseline) return { nodes: [] as GNode[], edges: [] as GEdge[] };
    return buildPlanGraph(baseline, changes, relationTypes, cardLookup);
  }, [baseline, changes, relationTypes, cardLookup]);

  const opErrors = useMemo(() => {
    if (!baseline) return [];
    return validatePlanOps(baseline, changes);
  }, [baseline, changes]);
  const errorByIndex = useMemo(
    () => new Map(opErrors.map((e) => [e.index, e])),
    [opErrors],
  );

  const nodeName = useCallback(
    (nid: string) =>
      merged.nodes.find((n) => n.id === nid)?.name ?? cardLookup.get(nid)?.name ?? nid,
    [merged.nodes, cardLookup],
  );

  // ── Change-op helpers ─────────────────────────────────────────────────
  const addChange = useCallback((op: PlanChangeOp, refs?: CardRefMap) => {
    setChanges((prev) => [...prev, op]);
    if (refs) setCardRefs((prev) => ({ ...prev, ...refs }));
    setDirty(true);
  }, []);

  const removeChange = useCallback((index: number) => {
    setChanges((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  }, []);

  // ── Save ──────────────────────────────────────────────────────────────
  const save = useCallback(async () => {
    if (!title.trim()) {
      setError(t("plan.titleRequired"));
      return;
    }
    setSaving(true);
    setError("");
    const payload = {
      title: title.trim(),
      description: description || null,
      initiative_id: initiative?.id ?? null,
      scope: {
        cardIds: scopeCards.map((c) => c.id),
        depth,
        objectiveIds: objectives.map((o) => o.id),
        cardRefs: scopeCards,
        objectiveRefs: objectives,
      },
      plan_data: {
        ...(baseline ? { baseline } : {}),
        changes,
        ...(baselineCapturedAt ? { baselineCapturedAt } : {}),
        cardRefs,
      },
    };
    try {
      if (planId) {
        await api.patch(`/architecture-plans/${planId}`, payload);
      } else {
        const created = await api.post<ArchitecturePlan>("/architecture-plans", payload);
        setPlanId(created.id);
        navigate(`/ea-delivery/plans/${created.id}`, { replace: true });
      }
      setDirty(false);
      setSnackbar(t("plan.saved"));
    } catch (err) {
      setError((err as Error).message || "Failed to save plan");
    } finally {
      setSaving(false);
    }
  }, [
    title,
    description,
    initiative,
    scopeCards,
    depth,
    objectives,
    baseline,
    baselineCapturedAt,
    changes,
    cardRefs,
    planId,
    navigate,
    t,
  ]);

  // ── Op description for the change list ────────────────────────────────
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

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 1250, mx: "auto" }}>
      {/* Header */}
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
        {planId && (
          <Button
            size="small"
            variant="outlined"
            onClick={() => navigate(`/ea-delivery/plans/${planId}/preview`)}
            startIcon={<MaterialSymbol icon="visibility" size={18} />}
          >
            {t("plan.preview")}
          </Button>
        )}
        <Button
          size="small"
          variant="contained"
          onClick={save}
          disabled={saving || (!dirty && !!planId)}
          startIcon={<MaterialSymbol icon="save" size={18} />}
        >
          {t("common:actions.save")}
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      <Paper sx={{ p: 3, mb: 2 }}>
        <Stack spacing={2}>
          <TextField
            label={t("plan.titleLabel")}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setDirty(true);
            }}
            size="small"
            fullWidth
            required
          />
          <TextField
            label={t("plan.descriptionLabel")}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setDirty(true);
            }}
            size="small"
            fullWidth
            multiline
            minRows={2}
          />
          <CardPicker
            types="Initiative"
            value={initiative}
            onChange={(v) => {
              setInitiative(v);
              setDirty(true);
            }}
            label={t("plan.scopeStep.initiative")}
          />
        </Stack>
      </Paper>

      {/* Step 1: objectives (optional) */}
      <Paper sx={{ p: 3, mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.5 }}>
          {t("plan.objectivesStep.title")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {t("plan.objectivesStep.hint")}
        </Typography>
        <MultiCardPicker
          types="Objective"
          values={objectives}
          onChange={(v) => {
            setObjectives(v);
            setDirty(true);
          }}
          label={t("plan.objectivesStep.placeholder")}
        />
        {objectives.length > 0 && (
          <Box sx={{ mt: 1.5 }}>
            <Button
              variant="outlined"
              size="small"
              onClick={deriveScope}
              disabled={deriving}
              startIcon={
                deriving ? <CircularProgress size={16} /> : <MaterialSymbol icon="account_tree" size={18} />
              }
            >
              {t("plan.derive.button")}
            </Button>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1.5 }}>
              {t("plan.derive.hint")}
            </Typography>
          </Box>
        )}
      </Paper>

      {/* Step 2: scope + baseline capture */}
      <Paper sx={{ p: 3, mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.5 }}>
          {t("plan.scopeStep.title")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {t("plan.scopeStep.hint")}
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems="flex-start">
          <Box sx={{ flex: 1, width: "100%" }}>
            <MultiCardPicker
              values={scopeCards}
              onChange={(v) => {
                setScopeCards(v);
                setDirty(true);
              }}
              label={t("plan.scopeStep.addCard")}
            />
          </Box>
          <TextField
            select
            size="small"
            label={t("plan.scopeStep.depth")}
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
            sx={{ width: 110 }}
          >
            {[1, 2, 3].map((d) => (
              <MenuItem key={d} value={d}>
                {d}
              </MenuItem>
            ))}
          </TextField>
          <Button
            variant={baseline ? "outlined" : "contained"}
            onClick={captureBaseline}
            disabled={scopeCards.length === 0 || capturing}
            startIcon={
              capturing ? (
                <CircularProgress size={16} />
              ) : (
                <MaterialSymbol icon={baseline ? "refresh" : "center_focus_strong"} size={18} />
              )
            }
          >
            {baseline ? t("plan.baseline.refresh") : t("plan.scopeStep.capture")}
          </Button>
        </Stack>
        {baseline && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
            {t("plan.baseline.captured", {
              nodes: baseline.nodes.length,
              edges: baseline.edges.length,
            })}
          </Typography>
        )}
        {opErrors.length > 0 && (
          <Alert severity="warning" sx={{ mt: 1.5 }}>
            {t("plan.ops.invalid", { count: opErrors.length })}
          </Alert>
        )}
      </Paper>

      {/* Step 3+4: toolbox, ops list, live preview */}
      {baseline ? (
        <>
          <Paper sx={{ p: 3, mb: 2 }}>
            <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5 }}>
              {t("plan.ops.title")}
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
              {(Object.keys(OP_META) as PlanChangeOp["op"][]).map((op) => (
                <Button
                  key={op}
                  size="small"
                  variant="outlined"
                  onClick={() => setOpenDialog(op)}
                  startIcon={
                    <MaterialSymbol icon={OP_META[op].icon} size={18} color={OP_META[op].color} />
                  }
                >
                  {t(`plan.op.${camel(op)}`)}
                </Button>
              ))}
            </Stack>

            {changes.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>
                {t("plan.ops.empty")}
              </Typography>
            ) : (
              <Stack spacing={0.5}>
                {changes.map((op, i) => {
                  const invalid = errorByIndex.get(i);
                  return (
                    <Stack
                      key={i}
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      sx={{
                        px: 1,
                        py: 0.5,
                        borderRadius: 1,
                        bgcolor: "action.hover",
                        ...(invalid ? { outline: "1px solid", outlineColor: "warning.main" } : {}),
                      }}
                    >
                      <MaterialSymbol
                        icon={OP_META[op.op].icon}
                        size={18}
                        color={OP_META[op.op].color}
                      />
                      <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                        {describeOp(op)}
                      </Typography>
                      {invalid && (
                        <Tooltip title={t("plan.ops.invalidOp")}>
                          <MaterialSymbol icon="warning" size={16} color="#ed6c02" />
                        </Tooltip>
                      )}
                      <IconButton size="small" onClick={() => removeChange(i)}>
                        <MaterialSymbol icon="delete" size={16} />
                      </IconButton>
                    </Stack>
                  );
                })}
              </Stack>
            )}
          </Paper>

          {changes.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <PlanInsightsPanel graph={merged} changes={changes} />
            </Box>
          )}

          <Paper sx={{ height: 560, mb: 2, overflow: "hidden" }}>
            <LayeredDependencyView
              nodes={merged.nodes}
              edges={merged.edges}
              types={types}
              onNodeClick={() => undefined}
              onHome={() => undefined}
            />
          </Paper>
        </>
      ) : (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t("plan.baseline.empty")}
        </Alert>
      )}

      {/* ── Change-op dialogs ── */}
      {openDialog === "add_card" && (
        <CardRefDialog
          title={t("plan.op.addCard")}
          types={types}
          onClose={() => setOpenDialog(null)}
          onConfirm={(ref, refs) => {
            addChange({ op: "add_card", card: ref }, refs);
            setOpenDialog(null);
          }}
        />
      )}
      {openDialog === "remove_card" && (
        <NodeSelectDialog
          title={t("plan.op.removeCard")}
          label={t("plan.dialog.selectCard")}
          options={merged.nodes
            .filter((n) => !n.proposed && n.changeState !== "removed")
            .map((n) => ({ id: n.id, name: n.name, type: n.type }))}
          typeLabelOf={(tk) => typeLabel(types.find((x) => x.key === tk) ?? { key: tk, label: tk })}
          showImpact
          onClose={() => setOpenDialog(null)}
          onConfirm={(node) => {
            addChange({ op: "remove_card", cardId: node.id });
            setOpenDialog(null);
          }}
        />
      )}
      {openDialog === "replace_card" && (
        <ReplaceCardDialog
          types={types}
          nodes={merged.nodes
            .filter((n) => !n.proposed && n.changeState !== "removed")
            .map((n) => ({ id: n.id, name: n.name, type: n.type }))}
          typeLabelOf={(tk) => typeLabel(types.find((x) => x.key === tk) ?? { key: tk, label: tk })}
          onClose={() => setOpenDialog(null)}
          onConfirm={(predecessorId, successor, refs) => {
            addChange({ op: "replace_card", predecessorId, successor }, refs);
            setOpenDialog(null);
          }}
        />
      )}
      {openDialog === "add_relation" && (
        <AddRelationDialog
          nodes={merged.nodes.map((n) => ({ id: n.id, name: n.name, type: n.type }))}
          relationTypes={relationTypes}
          relationLabelOf={(rt) => relationLabel(rt)}
          typeLabelOf={(tk) => typeLabel(types.find((x) => x.key === tk) ?? { key: tk, label: tk })}
          onClose={() => setOpenDialog(null)}
          onConfirm={(sourceId, targetId, relationType) => {
            addChange({ op: "add_relation", sourceId, targetId, relationType });
            setOpenDialog(null);
          }}
        />
      )}
      {openDialog === "remove_relation" && (
        <RemoveRelationDialog
          edges={merged.edges.filter((e) => e.changeState !== "removed")}
          nodeName={nodeName}
          onClose={() => setOpenDialog(null)}
          onConfirm={(edge) => {
            addChange({
              op: "remove_relation",
              sourceId: edge.source,
              targetId: edge.target,
              relationType: edge.type,
            });
            setOpenDialog(null);
          }}
        />
      )}

      <Snackbar
        open={!!snackbar}
        autoHideDuration={2500}
        onClose={() => setSnackbar("")}
        message={snackbar}
      />
    </Box>
  );
}

function camel(op: PlanChangeOp["op"]): string {
  return op.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());
}

/* ------------------------------------------------------------------ */
/*  Dialog: pick an existing card OR propose a new one                 */
/* ------------------------------------------------------------------ */

function CardRefForm({
  types,
  value,
  onChange,
}: {
  types: {
    key: string;
    label: string;
    is_hidden: boolean;
    subtypes?: { key: string; label: string }[];
  }[];
  value: RefForm;
  onChange: (v: RefForm) => void;
}) {
  const { t } = useTranslation(["delivery", "common"]);
  const typeLabel = useTypeLabel();
  const subtypeLabel = useSubtypeLabel();
  const visibleTypes = types.filter((tp) => !tp.is_hidden);
  const selectedType = visibleTypes.find((tp) => tp.key === value.typeKey);

  return (
    <Stack spacing={2} sx={{ mt: 0.5 }}>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={value.mode}
        onChange={(_, mode) => mode && onChange({ ...value, mode })}
      >
        <ToggleButton value="existing">{t("plan.dialog.fromInventory")}</ToggleButton>
        <ToggleButton value="new">{t("plan.dialog.proposeNew")}</ToggleButton>
      </ToggleButtonGroup>
      {value.mode === "existing" ? (
        <CardPicker
          value={value.existing}
          onChange={(v) => onChange({ ...value, existing: v })}
          label={t("plan.dialog.selectCard")}
          autoFocus
        />
      ) : (
        <>
          <TextField
            label={t("common:labels.name")}
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            size="small"
            fullWidth
            autoFocus
          />
          <TextField
            select
            label={t("common:labels.type")}
            value={value.typeKey}
            onChange={(e) => onChange({ ...value, typeKey: e.target.value, subtype: "" })}
            size="small"
            fullWidth
          >
            {visibleTypes.map((tp) => (
              <MenuItem key={tp.key} value={tp.key}>
                {typeLabel(tp)}
              </MenuItem>
            ))}
          </TextField>
          {(selectedType?.subtypes?.length ?? 0) > 0 && (
            <TextField
              select
              label={t("common:labels.subtype")}
              value={value.subtype}
              onChange={(e) => onChange({ ...value, subtype: e.target.value })}
              size="small"
              fullWidth
            >
              <MenuItem value="">{t("common:labels.none")}</MenuItem>
              {selectedType!.subtypes!.map((s) => (
                <MenuItem key={s.key} value={s.key}>
                  {subtypeLabel(s)}
                </MenuItem>
              ))}
            </TextField>
          )}
          <TextField
            label={t("plan.dialog.estimatedCost")}
            value={value.estimatedCost}
            onChange={(e) => onChange({ ...value, estimatedCost: e.target.value })}
            size="small"
            fullWidth
            type="number"
            helperText={t("plan.dialog.estimatedCostHint")}
          />
        </>
      )}
    </Stack>
  );
}

interface RefForm {
  mode: "existing" | "new";
  existing: CardOption | null;
  name: string;
  typeKey: string;
  subtype: string;
  estimatedCost: string;
}

const EMPTY_REF_FORM: RefForm = {
  mode: "existing",
  existing: null,
  name: "",
  typeKey: "Application",
  subtype: "",
  estimatedCost: "",
};

function refFromForm(form: RefForm): {
  ref: PlanCardRef;
  refs?: CardRefMap;
} | null {
  if (form.mode === "existing") {
    if (!form.existing) return null;
    return {
      ref: { existingCardId: form.existing.id },
      refs: { [form.existing.id]: { name: form.existing.name, type: form.existing.type } },
    };
  }
  if (!form.name.trim()) return null;
  const est = form.estimatedCost.trim() === "" ? undefined : Number(form.estimatedCost);
  const proposed: PlanProposedCard = {
    tempId: newTempId(),
    name: form.name.trim(),
    cardTypeKey: form.typeKey,
    ...(form.subtype ? { subtype: form.subtype } : {}),
    ...(est !== undefined && Number.isFinite(est) ? { estimatedCost: est } : {}),
  };
  return { ref: { proposed } };
}

function CardRefDialog({
  title,
  types,
  onClose,
  onConfirm,
}: {
  title: string;
  types: Parameters<typeof CardRefForm>[0]["types"];
  onClose: () => void;
  onConfirm: (ref: PlanCardRef, refs?: CardRefMap) => void;
}) {
  const { t } = useTranslation("common");
  const [form, setForm] = useState({ ...EMPTY_REF_FORM });
  const result = refFromForm(form);
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth disableRestoreFocus>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <CardRefForm types={types} value={form} onChange={setForm} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("actions.cancel")}</Button>
        <Button
          variant="contained"
          disabled={!result}
          onClick={() => result && onConfirm(result.ref, result.refs)}
        >
          {t("actions.add")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Dialog: select a node already on the diagram                       */
/* ------------------------------------------------------------------ */

function NodeSelectDialog({
  title,
  label,
  options,
  typeLabelOf,
  showImpact,
  onClose,
  onConfirm,
}: {
  title: string;
  label: string;
  options: NodeOption[];
  typeLabelOf: (typeKey: string) => string;
  showImpact?: boolean;
  onClose: () => void;
  onConfirm: (node: NodeOption) => void;
}) {
  const { t } = useTranslation("common");
  const [value, setValue] = useState<NodeOption | null>(null);
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth disableRestoreFocus>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <NodeAutocomplete
          label={label}
          options={options}
          value={value}
          onChange={setValue}
          typeLabelOf={typeLabelOf}
          autoFocus
        />
        {showImpact && value && !value.id.startsWith("tmp:") && (
          <BlastRadiusNotice cardId={value.id} />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("actions.cancel")}</Button>
        <Button variant="contained" disabled={!value} onClick={() => value && onConfirm(value)}>
          {t("actions.confirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function NodeAutocomplete({
  label,
  options,
  value,
  onChange,
  typeLabelOf,
  autoFocus,
}: {
  label: string;
  options: NodeOption[];
  value: NodeOption | null;
  onChange: (v: NodeOption | null) => void;
  typeLabelOf: (typeKey: string) => string;
  autoFocus?: boolean;
}) {
  return (
    <Autocomplete
      options={options}
      value={value}
      onChange={(_, v) => onChange(v)}
      getOptionLabel={(o) => o.name}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      size="small"
      sx={{ mt: 1 }}
      renderOption={(props, opt) => (
        <li {...props} key={opt.id}>
          <Stack direction="row" spacing={1} alignItems="baseline" sx={{ minWidth: 0 }}>
            <Typography variant="body2" noWrap>
              {opt.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {typeLabelOf(opt.type)}
            </Typography>
          </Stack>
        </li>
      )}
      renderInput={(params) => <TextField {...params} label={label} autoFocus={autoFocus} />}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Dialog: replace card                                               */
/* ------------------------------------------------------------------ */

function ReplaceCardDialog({
  types,
  nodes,
  typeLabelOf,
  onClose,
  onConfirm,
}: {
  types: Parameters<typeof CardRefForm>[0]["types"];
  nodes: NodeOption[];
  typeLabelOf: (typeKey: string) => string;
  onClose: () => void;
  onConfirm: (predecessorId: string, successor: PlanCardRef, refs?: CardRefMap) => void;
}) {
  const { t } = useTranslation(["delivery", "common"]);
  const [predecessor, setPredecessor] = useState<NodeOption | null>(null);
  const [form, setForm] = useState({ ...EMPTY_REF_FORM });
  const result = refFromForm(form);
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth disableRestoreFocus>
      <DialogTitle>{t("plan.op.replaceCard")}</DialogTitle>
      <DialogContent>
        <NodeAutocomplete
          label={t("plan.dialog.predecessor")}
          options={nodes}
          value={predecessor}
          onChange={setPredecessor}
          typeLabelOf={typeLabelOf}
          autoFocus
        />
        {predecessor && !predecessor.id.startsWith("tmp:") && (
          <BlastRadiusNotice cardId={predecessor.id} />
        )}
        <Typography variant="subtitle2" sx={{ mt: 2 }}>
          {t("plan.dialog.successor")}
        </Typography>
        <CardRefForm types={types} value={form} onChange={setForm} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        <Button
          variant="contained"
          disabled={!predecessor || !result}
          onClick={() =>
            predecessor && result && onConfirm(predecessor.id, result.ref, result.refs)
          }
        >
          {t("common:actions.confirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Dialog: add relation                                               */
/* ------------------------------------------------------------------ */

function AddRelationDialog({
  nodes,
  relationTypes,
  relationLabelOf,
  typeLabelOf,
  onClose,
  onConfirm,
}: {
  nodes: NodeOption[];
  relationTypes: RelationType[];
  relationLabelOf: (rt: RelationType) => string;
  typeLabelOf: (typeKey: string) => string;
  onClose: () => void;
  onConfirm: (sourceId: string, targetId: string, relationType: string) => void;
}) {
  const { t } = useTranslation(["delivery", "common"]);
  const [source, setSource] = useState<NodeOption | null>(null);
  const [target, setTarget] = useState<NodeOption | null>(null);
  const [relationType, setRelationType] = useState("");

  // Only relation types valid for the picked endpoints (either direction —
  // the merge flips to the metamodel direction automatically).
  const validTypes = useMemo(() => {
    if (!source || !target) return [];
    return relationTypes.filter(
      (rt) =>
        !rt.is_hidden &&
        ((rt.source_type_key === source.type && rt.target_type_key === target.type) ||
          (rt.source_type_key === target.type && rt.target_type_key === source.type)),
    );
  }, [relationTypes, source, target]);

  useEffect(() => {
    if (validTypes.length === 1) setRelationType(validTypes[0].key);
    else if (!validTypes.some((rt) => rt.key === relationType)) setRelationType("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validTypes]);

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth disableRestoreFocus>
      <DialogTitle>{t("plan.op.addRelation")}</DialogTitle>
      <DialogContent>
        <NodeAutocomplete
          label={t("plan.dialog.source")}
          options={nodes.filter((n) => n.id !== target?.id)}
          value={source}
          onChange={setSource}
          typeLabelOf={typeLabelOf}
          autoFocus
        />
        <NodeAutocomplete
          label={t("plan.dialog.target")}
          options={nodes.filter((n) => n.id !== source?.id)}
          value={target}
          onChange={setTarget}
          typeLabelOf={typeLabelOf}
        />
        <TextField
          select
          label={t("plan.dialog.relationType")}
          value={relationType}
          onChange={(e) => setRelationType(e.target.value)}
          size="small"
          fullWidth
          sx={{ mt: 2 }}
          disabled={!source || !target}
          helperText={
            source && target && validTypes.length === 0
              ? t("plan.dialog.noRelationType")
              : undefined
          }
        >
          {validTypes.map((rt) => (
            <MenuItem key={rt.key} value={rt.key}>
              {relationLabelOf(rt)}
            </MenuItem>
          ))}
        </TextField>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        <Button
          variant="contained"
          disabled={!source || !target || !relationType}
          onClick={() => source && target && onConfirm(source.id, target.id, relationType)}
        >
          {t("common:actions.add")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Dialog: remove relation                                            */
/* ------------------------------------------------------------------ */

function RemoveRelationDialog({
  edges,
  nodeName,
  onClose,
  onConfirm,
}: {
  edges: GEdge[];
  nodeName: (id: string) => string;
  onClose: () => void;
  onConfirm: (edge: GEdge) => void;
}) {
  const { t } = useTranslation(["delivery", "common"]);
  const [index, setIndex] = useState<number | "">("");
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth disableRestoreFocus>
      <DialogTitle>{t("plan.op.removeRelation")}</DialogTitle>
      <DialogContent>
        <TextField
          select
          label={t("plan.dialog.selectEdge")}
          value={index}
          onChange={(e) => setIndex(Number(e.target.value))}
          size="small"
          fullWidth
          sx={{ mt: 1 }}
        >
          {edges.map((e, i) => (
            <MenuItem key={i} value={i}>
              {`${nodeName(e.source)} — ${e.label || e.type} → ${nodeName(e.target)}`}
            </MenuItem>
          ))}
        </TextField>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        <Button
          variant="contained"
          color="error"
          disabled={index === ""}
          onClick={() => index !== "" && onConfirm(edges[index])}
        >
          {t("common:actions.remove")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
