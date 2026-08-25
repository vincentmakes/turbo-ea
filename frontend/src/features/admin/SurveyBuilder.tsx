import { useEffect, useState, useMemo, useCallback } from "react";
import { useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Stepper from "@mui/material/Stepper";
import Step from "@mui/material/Step";
import StepLabel from "@mui/material/StepLabel";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Chip from "@mui/material/Chip";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import CircularProgress from "@mui/material/CircularProgress";
import MuiCard from "@mui/material/Card";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Divider from "@mui/material/Divider";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import MaterialSymbol from "@/components/MaterialSymbol";
import CardPicker, { type CardOption } from "@/components/CardPicker";
import TagPicker from "@/components/TagPicker";
import { useExtensionFieldTypes } from "@/lib/extensionHost";
import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import {
  useTypeLabel,
  useRelationLabel,
  useFieldLabel,
  useOptionLabel,
} from "@/hooks/useResolveLabel";
import { FIELD_TYPE_OPTIONS } from "@/features/admin/metamodel/constants";
import { useDateFormat } from "@/hooks/useDateFormat";
import {
  MAX_STALENESS_BY_UNIT,
  STALENESS_PRESETS,
  matchStalenessPreset,
  parseStalenessWindow,
  stalenessCutoffDate,
} from "@/lib/staleness";
import type {
  Survey,
  SurveyField,
  SurveyTargetFilters,
  SurveyPreviewResult,
  Card,
  TagGroup,
  StakeholderRoleDef,
  StalenessUnit,
  StalenessWindow,
} from "@/types";

export default function SurveyBuilder() {
  const { t } = useTranslation(["admin", "common"]);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { types, relationTypes } = useMetamodel();
  const extFieldTypes = useExtensionFieldTypes();
  const typeLabel = useTypeLabel();
  const { formatDate } = useDateFormat();
  // An ext.* field whose extension isn't installed+enabled+licensed is absent
  // from the registry — surveying it will degrade to a plain input (and, if the
  // extension is uninstalled, collect into an orphan attribute). Warn the admin.
  const isInactiveExtType = (fieldType: string) =>
    fieldType.startsWith("ext.") && !extFieldTypes[fieldType];
  const relLabel = useRelationLabel();
  const fieldLabel = useFieldLabel();
  const optLabel = useOptionLabel();

  const STEPS = [
    t("surveyBuilder.steps.basics"),
    t("surveyBuilder.steps.target"),
    t("surveyBuilder.steps.fields"),
    t("surveyBuilder.steps.previewSend"),
  ];

  const fieldTypeLabel = (type: string): string => {
    const opt = FIELD_TYPE_OPTIONS.find((o) => o.value === type);
    return opt ? t(opt.tKey) : type;
  };

  const [activeStep, setActiveStep] = useState(0);
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [surveyId, setSurveyId] = useState(id || "");

  // Step 1 — Basics
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("");

  // Step 2 — Target
  const [targetTypeKey, setTargetTypeKey] = useState("");
  const [targetRoles, setTargetRoles] = useState<string[]>([]);
  const [relatedIds, setRelatedIds] = useState<string[]>([]);
  const [relatedItems, setRelatedItems] = useState<CardOption[]>([]);
  const [cardIds, setCardIds] = useState<string[]>([]);
  const [cardItems, setCardItems] = useState<CardOption[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [tagGroups, setTagGroups] = useState<TagGroup[]>([]);
  const [roles, setRoles] = useState<StakeholderRoleDef[]>([]);
  const [attributeFilters, setAttributeFilters] = useState<
    { key: string; op: string; value: string }[]
  >([]);
  // Staleness window. `staleness` is the only thing that reaches
  // target_filters; the draft/unit pair backs the Custom row and survives
  // switching to a preset and back, so a typed value isn't lost on a detour.
  const [staleness, setStaleness] = useState<StalenessWindow | null>(null);
  const [stalenessCustom, setStalenessCustom] = useState(false);
  const [stalenessDraft, setStalenessDraft] = useState("180");
  const [stalenessUnit, setStalenessUnit] = useState<StalenessUnit>("days");

  // Step 3 — Fields
  const [selectedFields, setSelectedFields] = useState<SurveyField[]>([]);

  // Step 4 — Preview
  const [preview, setPreview] = useState<SurveyPreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // Load existing survey if editing
  useEffect(() => {
    if (!id) return;
    const load = async () => {
      try {
        const s = await api.get<Survey>(`/surveys/${id}`);
        setName(s.name);
        setDescription(s.description);
        setMessage(s.message);
        setTargetTypeKey(s.target_type_key);
        setTargetRoles(s.target_roles || []);
        setRelatedIds(s.target_filters?.related_ids || []);
        setCardIds(s.target_filters?.card_ids || []);
        setTagIds(s.target_filters?.tag_ids || []);
        setAttributeFilters(s.target_filters?.attribute_filters || []);
        // Through the parser, not a cast: a window stored by an extension
        // template or edited by hand degrades to "Any" rather than rendering NaN.
        const stored = parseStalenessWindow(s.target_filters?.not_updated_for);
        setStaleness(stored);
        setStalenessCustom(stored !== null && matchStalenessPreset(stored) === "custom");
        if (stored) {
          setStalenessDraft(String(stored.value));
          setStalenessUnit(stored.unit);
        }
        setSelectedFields(s.fields || []);
        setSurveyId(s.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("common:errors.generic"));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  useEffect(() => {
    api.get<TagGroup[]>("/tag-groups").then(setTagGroups).catch(() => {});
  }, []);

  // Roles are per card type. Scoped to the target type once one is chosen, so
  // the list stops offering roles that type does not define — those could never
  // match a card and only pad the list. Unscoped until then, purely so the
  // section isn't empty before a type is picked.
  useEffect(() => {
    const path = targetTypeKey
      ? `/stakeholder-roles?type_key=${encodeURIComponent(targetTypeKey)}`
      : "/stakeholder-roles";
    api.get<StakeholderRoleDef[]>(path).then(setRoles).catch(() => {});
  }, [targetTypeKey]);

  // Hydrate the selected chips when an existing survey is opened: the survey
  // stores ids, and a picker needs names. Covers both card filters — related
  // cards used to be left un-hydrated, so the field rendered empty while the
  // ids were still in state, and touching it wiped the filter.
  useEffect(() => {
    const wanted: [string[], CardOption[], React.Dispatch<React.SetStateAction<CardOption[]>>][] = [
      [cardIds, cardItems, setCardItems],
      [relatedIds, relatedItems, setRelatedItems],
    ];
    for (const [ids, held, setHeld] of wanted) {
      const missing = ids.filter((id) => !held.some((c) => c.id === id));
      if (missing.length === 0) continue;
      Promise.all(missing.map((id) => api.get<Card>(`/cards/${id}`).catch(() => null))).then(
        (cards) => {
          const fetched = cards.filter((c): c is Card => !!c);
          if (fetched.length === 0) return;
          setHeld((prev) => {
            const known = new Set(prev.map((c) => c.id));
            return [
              ...prev,
              ...fetched
                .filter((c) => !known.has(c.id))
                .map((c) => ({ id: c.id, name: c.name, type: c.type })),
            ];
          });
        },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardIds, relatedIds]);

  // Get the selected type's fields schema
  const selectedType = useMemo(
    () => types.find((ct) => ct.key === targetTypeKey),
    [types, targetTypeKey],
  );

  const allFields = useMemo(() => {
    if (!selectedType) return [];
    const fields: { section: string; key: string; label: string; type: string; options?: { key: string; label: string; color?: string }[] }[] = [];
    for (const section of selectedType.fields_schema || []) {
      for (const f of section.fields || []) {
        fields.push({
          section: section.section,
          key: f.key,
          label: fieldLabel(f),
          type: f.type,
          options: f.options?.map((o) => ({ ...o, label: optLabel(o) })),
        });
      }
    }
    return fields;
  }, [selectedType, fieldLabel, optLabel]);

  // Stakeholder role key → display label. The preview payload carries keys, and
  // rendering those leaks slugs like "technicalApplicationOwner" into the UI.
  const roleLabel = useMemo(() => {
    const byKey = new Map(roles.map((r) => [r.key, r]));
    return (key: string) => {
      // typeLabel returns "" for an unknown entity, so fall back to the key —
      // a role archived since the draft was written still renders something.
      const def = byKey.get(key);
      return def ? typeLabel(def) : key;
    };
  }, [roles, typeLabel]);

  // Relation types the surveyed card type can participate in, expanded into one
  // entry per direction (a self-referential relation yields both). Each becomes
  // a selectable survey "field" with kind === "relation".
  const allRelations = useMemo(() => {
    if (!targetTypeKey) return [];
    const relatedTypeLabel = (key: string) => {
      const ct = types.find((c) => c.key === key);
      return ct ? typeLabel(ct) : key;
    };
    const entries: {
      key: string;
      relation_type_key: string;
      direction: "outgoing" | "incoming";
      related_type_key: string;
      label: string;
      relatedTypeLabel: string;
    }[] = [];
    for (const rt of relationTypes) {
      if (rt.is_hidden) continue;
      if (rt.source_type_key === targetTypeKey) {
        entries.push({
          key: `rel:${rt.key}:outgoing`,
          relation_type_key: rt.key,
          direction: "outgoing",
          related_type_key: rt.target_type_key,
          label: relLabel(rt),
          relatedTypeLabel: relatedTypeLabel(rt.target_type_key),
        });
      }
      if (rt.target_type_key === targetTypeKey) {
        entries.push({
          key: `rel:${rt.key}:incoming`,
          relation_type_key: rt.key,
          direction: "incoming",
          related_type_key: rt.source_type_key,
          label: relLabel(rt, true),
          relatedTypeLabel: relatedTypeLabel(rt.source_type_key),
        });
      }
    }
    return entries;
  }, [relationTypes, targetTypeKey, types, typeLabel, relLabel]);

  // The date the window resolves to, shown to the admin before anything is
  // saved. Computed client-side by the mirror of the backend helper — no
  // round-trip, and it cannot disagree with what the query will match.
  const stalenessCutoff = useMemo(
    () => (staleness ? stalenessCutoffDate(staleness) : null),
    [staleness],
  );

  // One builder for both the save and the preview payloads. These were two
  // byte-identical literals; a filter added to one and not the other is
  // exactly how a preview ends up describing a different set than the send.
  const buildTargetFilters = useCallback(
    (): SurveyTargetFilters => ({
      card_ids: cardIds.length > 0 ? cardIds : undefined,
      related_ids: relatedIds.length > 0 ? relatedIds : undefined,
      tag_ids: tagIds.length > 0 ? tagIds : undefined,
      attribute_filters: attributeFilters.length > 0 ? attributeFilters : undefined,
      not_updated_for: staleness ?? undefined,
    }),
    [cardIds, relatedIds, tagIds, attributeFilters, staleness],
  );

  // Save draft
  const saveDraft = useCallback(async () => {
    setSaving(true);
    setError("");
    try {
      const body = {
        name: name.trim() || "Untitled Survey",
        description,
        message,
        target_type_key: targetTypeKey,
        target_filters: buildTargetFilters(),
        target_roles: targetRoles,
        fields: selectedFields,
      };

      if (surveyId) {
        await api.patch(`/surveys/${surveyId}`, body);
        return surveyId;
      }
      const created = await api.post<Survey>("/surveys", body);
      setSurveyId(created.id);
      window.history.replaceState(null, "", `/admin/surveys/${created.id}`);
      // Returned, not just stored: `setSurveyId` does not update the `surveyId`
      // a caller already captured, so a caller that awaited us and then read
      // that variable would still see "" and create a *second* survey.
      return created.id;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
      return null;
    } finally {
      setSaving(false);
    }
  }, [name, description, message, targetTypeKey, targetRoles, buildTargetFilters, selectedFields, surveyId]);

  // Preview targets. The preview reads the *persisted* survey, so the draft has
  // to be written first — `saveDraft` both creates-or-updates and hands back the
  // id to preview, which is what keeps this from minting a second draft.
  const loadPreview = useCallback(async () => {
    const sid = await saveDraft();
    if (!sid) return; // save failed; saveDraft has already surfaced the error
    setPreviewing(true);
    setError("");
    try {
      const data = await api.post<SurveyPreviewResult>(`/surveys/${sid}/preview`, {});
      setPreview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setPreviewing(false);
    }
  }, [saveDraft]);

  // Send survey
  const handleSend = async () => {
    if (!surveyId) return;
    setSending(true);
    setError("");
    try {
      await api.post(`/surveys/${surveyId}/send`, {});
      navigate(`/admin/surveys/${surveyId}/results`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setSending(false);
    }
  };

  const toggleField = (field: typeof allFields[number]) => {
    const exists = selectedFields.find((f) => f.key === field.key);
    if (exists) {
      setSelectedFields((prev) => prev.filter((f) => f.key !== field.key));
    } else {
      setSelectedFields((prev) => [
        ...prev,
        { key: field.key, section: field.section, label: field.label, type: field.type, options: field.options, action: "maintain" },
      ]);
    }
  };

  const toggleRelation = (rel: typeof allRelations[number]) => {
    const exists = selectedFields.find((f) => f.key === rel.key);
    if (exists) {
      setSelectedFields((prev) => prev.filter((f) => f.key !== rel.key));
    } else {
      setSelectedFields((prev) => [
        ...prev,
        {
          key: rel.key,
          section: "",
          label: rel.label,
          type: "relation",
          kind: "relation",
          relation_type_key: rel.relation_type_key,
          direction: rel.direction,
          related_type_key: rel.related_type_key,
          action: "maintain",
        },
      ]);
    }
  };

  const setFieldAction = (key: string, action: "maintain" | "confirm") => {
    setSelectedFields((prev) =>
      prev.map((f) => (f.key === key ? { ...f, action } : f)),
    );
  };

  const handleNext = async () => {
    if (activeStep === 0 && !name.trim()) {
      setError(t("surveyBuilder.validation.nameRequired"));
      return;
    }
    if (activeStep === 1 && !targetTypeKey) {
      setError(t("surveyBuilder.validation.typeRequired"));
      return;
    }
    if (activeStep === 1 && targetRoles.length === 0) {
      setError(t("surveyBuilder.validation.rolesRequired"));
      return;
    }
    if (activeStep === 2 && selectedFields.length === 0) {
      setError(t("surveyBuilder.validation.fieldsRequired"));
      return;
    }

    setError("");

    // Auto-save on step changes
    if (targetTypeKey && name.trim()) {
      await saveDraft();
    }

    if (activeStep === 3) {
      // Load preview when entering the last step
    }

    setActiveStep((prev) => Math.min(prev + 1, STEPS.length - 1));

    // Auto-load preview on step 4
    if (activeStep === 2) {
      setTimeout(() => loadPreview(), 100);
    }
  };

  const handleBack = () => {
    setError("");
    setActiveStep((prev) => Math.max(prev - 1, 0));
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", mb: 3, gap: 1 }}>
        <Tooltip title={t("surveyBuilder.backTooltip")}>
          <IconButton onClick={() => navigate("/admin/surveys")}>
            <MaterialSymbol icon="arrow_back" size={22} />
          </IconButton>
        </Tooltip>
        <MaterialSymbol icon="assignment" size={28} color="#1976d2" />
        <Typography variant="h5" sx={{ fontWeight: 700, flex: 1 }}>
          {id ? t("surveyBuilder.editSurvey") : t("surveyBuilder.newSurvey")}
        </Typography>
        {surveyId && (
          <Chip label={t("common:status.draft")} size="small" color="default" />
        )}
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
        {STEPS.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {/* Step 1: Basics */}
      {activeStep === 0 && (
        <MuiCard sx={{ p: 3 }}>
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
            {t("surveyBuilder.basics.title")}
          </Typography>
          <TextField
            label={t("surveyBuilder.basics.name")}
            fullWidth
            value={name}
            onChange={(e) => setName(e.target.value)}
            sx={{ mb: 2 }}
            required
          />
          <TextField
            label={t("surveyBuilder.basics.description")}
            fullWidth
            multiline
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            sx={{ mb: 2 }}
            helperText={t("surveyBuilder.basics.descriptionHelper")}
          />
          <TextField
            label={t("surveyBuilder.basics.message")}
            fullWidth
            multiline
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            helperText={t("surveyBuilder.basics.messageHelper")}
          />
        </MuiCard>
      )}

      {/* Step 2: Target */}
      {activeStep === 1 && (
        <MuiCard sx={{ p: 3 }}>
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
            {t("surveyBuilder.target.title")}
          </Typography>

          <TextField
            select
            label={t("common:labels.type")}
            fullWidth
            value={targetTypeKey}
            onChange={(e) => {
              setTargetTypeKey(e.target.value);
              setSelectedFields([]);
              setAttributeFilters([]);
              // Roles are defined per type, so a type change invalidates them
              // exactly as it does the fields and attribute filters above.
              setTargetRoles([]);
            }}
            sx={{ mb: 3 }}
            required
          >
            {types
              .filter((ct) => !ct.is_hidden)
              .map((ct) => (
                <MenuItem key={ct.key} value={ct.key}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <MaterialSymbol icon={ct.icon} size={18} color={ct.color} />
                    {typeLabel(ct)}
                  </Box>
                </MenuItem>
              ))}
          </TextField>

          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
            {t("surveyBuilder.target.filterSpecific")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t("surveyBuilder.target.filterSpecificHint")}
          </Typography>
          <CardPicker
            multiple
            types={targetTypeKey}
            enabled={!!targetTypeKey}
            disabled={!targetTypeKey}
            value={cardItems}
            onChange={(vals) => {
              setCardItems(vals);
              setCardIds(vals.map((v) => v.id));
            }}
            label={t("surveyBuilder.target.searchSpecificCards")}
            fullWidth
            sx={{ mb: 3 }}
            noOptionsText={
              !targetTypeKey ? t("surveyBuilder.target.selectTypeFirst") : undefined
            }
          />

          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
            {t("surveyBuilder.target.filterRelated")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t("surveyBuilder.target.filterRelatedHint")}
          </Typography>
          <CardPicker
            multiple
            value={relatedItems}
            onChange={(vals) => {
              setRelatedItems(vals);
              setRelatedIds(vals.map((v) => v.id));
            }}
            label={t("surveyBuilder.target.searchCards")}
            fullWidth
            sx={{ mb: 3 }}
          />

          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
            {t("surveyBuilder.target.filterTags")}
          </Typography>
          <TagPicker
            groups={tagGroups}
            value={tagIds}
            onChange={setTagIds}
            typeKey={targetTypeKey || undefined}
            size="small"
            label={t("surveyBuilder.target.selectTags")}
            sx={{ mb: 3 }}
          />

          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
            {t("surveyBuilder.target.filterAttributes")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t("surveyBuilder.target.filterAttributesHint")}
          </Typography>

          {attributeFilters.map((af, idx) => {
            const needsValue = af.op !== "is_empty" && af.op !== "is_not_empty";
            return (
              <Box key={idx} sx={{ display: "flex", gap: 1, mb: 1, alignItems: "center" }}>
                <TextField
                  select
                  size="small"
                  label={t("surveyBuilder.fields.columns.field")}
                  value={af.key}
                  onChange={(e) => {
                    const updated = [...attributeFilters];
                    updated[idx] = { ...af, key: e.target.value };
                    setAttributeFilters(updated);
                  }}
                  sx={{ minWidth: 180, flex: 1 }}
                >
                  {allFields.map((f) => (
                    <MenuItem key={f.key} value={f.key}>
                      {f.label}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  size="small"
                  label={t("surveyBuilder.target.operatorLabel")}
                  value={af.op}
                  onChange={(e) => {
                    const updated = [...attributeFilters];
                    updated[idx] = { ...af, op: e.target.value };
                    setAttributeFilters(updated);
                  }}
                  sx={{ minWidth: 140 }}
                >
                  <MenuItem value="eq">{t("surveyBuilder.target.operators.eq")}</MenuItem>
                  <MenuItem value="ne">{t("surveyBuilder.target.operators.ne")}</MenuItem>
                  <MenuItem value="gt">{t("surveyBuilder.target.operators.gt")}</MenuItem>
                  <MenuItem value="gte">{t("surveyBuilder.target.operators.gte")}</MenuItem>
                  <MenuItem value="lt">{t("surveyBuilder.target.operators.lt")}</MenuItem>
                  <MenuItem value="lte">{t("surveyBuilder.target.operators.lte")}</MenuItem>
                  <MenuItem value="contains">{t("surveyBuilder.target.operators.contains")}</MenuItem>
                  <MenuItem value="is_empty">{t("surveyBuilder.target.operators.isEmpty")}</MenuItem>
                  <MenuItem value="is_not_empty">{t("surveyBuilder.target.operators.isNotEmpty")}</MenuItem>
                </TextField>
                {needsValue && (
                  <TextField
                    size="small"
                    label={t("surveyBuilder.target.valueLabel")}
                    value={af.value}
                    onChange={(e) => {
                      const updated = [...attributeFilters];
                      updated[idx] = { ...af, value: e.target.value };
                      setAttributeFilters(updated);
                    }}
                    sx={{ flex: 1 }}
                  />
                )}
                <IconButton
                  size="small"
                  onClick={() =>
                    setAttributeFilters((prev) => prev.filter((_, i) => i !== idx))
                  }
                >
                  <MaterialSymbol icon="close" size={18} color="#999" />
                </IconButton>
              </Box>
            );
          })}

          <Button
            size="small"
            startIcon={<MaterialSymbol icon="add" size={16} />}
            sx={{ textTransform: "none", mb: 1 }}
            disabled={!targetTypeKey}
            onClick={() =>
              setAttributeFilters((prev) => [...prev, { key: "", op: "eq", value: "" }])
            }
          >
            {t("surveyBuilder.target.addAttributeFilter")}
          </Button>

          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
            {t("surveyBuilder.target.filterStale")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t("surveyBuilder.target.filterStaleHint")}
          </Typography>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={stalenessCustom ? "custom" : matchStalenessPreset(staleness)}
            onChange={(_, key: string | null) => {
              // MUI hands back null when the active button is re-clicked;
              // an exclusive group has no "deselected" state to fall into.
              if (!key) return;
              if (key === "custom") {
                setStalenessCustom(true);
                setStaleness(
                  parseStalenessWindow({ value: Number(stalenessDraft), unit: stalenessUnit }),
                );
                return;
              }
              setStalenessCustom(false);
              setStaleness(STALENESS_PRESETS.find((p) => p.key === key)?.window ?? null);
            }}
            sx={{ flexWrap: "wrap" }}
          >
            {STALENESS_PRESETS.map((p) => (
              <ToggleButton key={p.key} value={p.key} sx={{ textTransform: "none" }}>
                {t(`surveyBuilder.target.stalePresets.${p.key}`)}
              </ToggleButton>
            ))}
            <ToggleButton value="custom" sx={{ textTransform: "none" }}>
              {t("surveyBuilder.target.stalePresets.custom")}
            </ToggleButton>
          </ToggleButtonGroup>

          {stalenessCustom && (
            <Box sx={{ display: "flex", gap: 1, mt: 1.5, alignItems: "flex-start" }}>
              <TextField
                size="small"
                type="number"
                sx={{ width: 140 }}
                label={t("surveyBuilder.target.staleValueLabel")}
                value={stalenessDraft}
                inputProps={{ min: 1, max: MAX_STALENESS_BY_UNIT[stalenessUnit] }}
                error={stalenessDraft !== "" && staleness === null}
                helperText={
                  stalenessDraft !== "" && staleness === null
                    ? t("surveyBuilder.target.staleInvalid", {
                        max: MAX_STALENESS_BY_UNIT[stalenessUnit],
                      })
                    : " "
                }
                onChange={(e) => {
                  // Keep the raw text so the field can be cleared mid-typing;
                  // an unparseable draft simply yields no window to save.
                  setStalenessDraft(e.target.value);
                  setStaleness(
                    parseStalenessWindow({ value: Number(e.target.value), unit: stalenessUnit }),
                  );
                }}
              />
              <TextField
                select
                size="small"
                sx={{ width: 150 }}
                label={t("surveyBuilder.target.staleUnitLabel")}
                value={stalenessUnit}
                helperText=" "
                onChange={(e) => {
                  const unit = e.target.value as StalenessUnit;
                  setStalenessUnit(unit);
                  setStaleness(parseStalenessWindow({ value: Number(stalenessDraft), unit }));
                }}
              >
                <MenuItem value="days">{t("surveyBuilder.target.staleUnits.days")}</MenuItem>
                <MenuItem value="months">{t("surveyBuilder.target.staleUnits.months")}</MenuItem>
              </TextField>
            </Box>
          )}

          {stalenessCutoff && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mt: 1, mb: 2 }}
            >
              {t("surveyBuilder.target.staleCutoff", { date: formatDate(stalenessCutoff) })}
            </Typography>
          )}

          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
            {t("surveyBuilder.target.stakeholderRoles")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t("surveyBuilder.target.stakeholderRolesHint")}
          </Typography>
          {roles.map((role) => (
            <FormControlLabel
              key={role.key}
              control={
                <Checkbox
                  checked={targetRoles.includes(role.key)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setTargetRoles((prev) => [...prev, role.key]);
                    } else {
                      setTargetRoles((prev) => prev.filter((r) => r !== role.key));
                    }
                  }}
                />
              }
              label={
                <Box>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                    {role.color && (
                      <Box
                        sx={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          bgcolor: role.color,
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <Typography variant="body2">{typeLabel(role)}</Typography>
                  </Box>
                  {role.allowed_types && (
                    <Typography variant="caption" color="text.secondary">
                      {t("surveyBuilder.target.onlyFor", { types: role.allowed_types.join(", ") })}
                    </Typography>
                  )}
                </Box>
              }
            />
          ))}
        </MuiCard>
      )}

      {/* Step 3: Fields */}
      {activeStep === 2 && (
        <MuiCard sx={{ p: 3 }}>
          <Typography variant="h6" sx={{ mb: 1, fontWeight: 600 }}>
            {t("surveyBuilder.fields.title")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("surveyBuilder.fields.description", { type: selectedType ? typeLabel(selectedType) : "card" })}
          </Typography>

          {!selectedType && (
            <Alert severity="warning">{t("surveyBuilder.fields.noTypeSelected")}</Alert>
          )}

          {selectedType && allFields.length === 0 && (
            <Alert severity="info">{t("surveyBuilder.fields.noFields")}</Alert>
          )}

          {allFields.length > 0 && (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox" />
                    <TableCell>{t("surveyBuilder.fields.columns.section")}</TableCell>
                    <TableCell>{t("surveyBuilder.fields.columns.field")}</TableCell>
                    <TableCell>{t("surveyBuilder.fields.columns.type")}</TableCell>
                    <TableCell>{t("surveyBuilder.fields.columns.action")}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {allFields.map((f) => {
                    const selected = selectedFields.find((sf) => sf.key === f.key);
                    return (
                      <TableRow
                        key={f.key}
                        hover
                        onClick={() => toggleField(f)}
                        sx={{ cursor: "pointer" }}
                      >
                        <TableCell padding="checkbox">
                          <Checkbox checked={!!selected} size="small" />
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" color="text.secondary">
                            {f.section}
                          </Typography>
                        </TableCell>
                        <TableCell>{f.label}</TableCell>
                        <TableCell>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                            <Chip label={fieldTypeLabel(f.type)} size="small" variant="outlined" />
                            {isInactiveExtType(f.type) && (
                              <Tooltip title={t("surveyBuilder.fields.inactiveExtType")}>
                                <Box component="span" sx={{ display: "inline-flex" }}>
                                  <MaterialSymbol icon="warning" size={16} color="#ed6c02" />
                                </Box>
                              </Tooltip>
                            )}
                          </Box>
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {selected && (
                            <TextField
                              select
                              size="small"
                              value={selected.action}
                              onChange={(e) =>
                                setFieldAction(f.key, e.target.value as "maintain" | "confirm")
                              }
                              sx={{ minWidth: 120 }}
                            >
                              <MenuItem value="maintain">{t("surveyBuilder.fields.maintain")}</MenuItem>
                              <MenuItem value="confirm">{t("surveyBuilder.fields.confirm")}</MenuItem>
                            </TextField>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          {selectedType && (
            <>
              <Divider sx={{ my: 3 }} />
              <Typography variant="h6" sx={{ mb: 1, fontWeight: 600 }}>
                {t("surveyBuilder.relations.title")}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t("surveyBuilder.relations.description")}
              </Typography>

              {allRelations.length === 0 ? (
                <Alert severity="info">{t("surveyBuilder.relations.noRelations")}</Alert>
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell padding="checkbox" />
                        <TableCell>{t("surveyBuilder.relations.columns.relation")}</TableCell>
                        <TableCell>{t("surveyBuilder.relations.columns.relatedType")}</TableCell>
                        <TableCell>{t("surveyBuilder.fields.columns.action")}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {allRelations.map((r) => {
                        const selected = selectedFields.find((sf) => sf.key === r.key);
                        return (
                          <TableRow
                            key={r.key}
                            hover
                            onClick={() => toggleRelation(r)}
                            sx={{ cursor: "pointer" }}
                          >
                            <TableCell padding="checkbox">
                              <Checkbox checked={!!selected} size="small" />
                            </TableCell>
                            <TableCell>{r.label}</TableCell>
                            <TableCell>
                              <Chip label={r.relatedTypeLabel} size="small" variant="outlined" />
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              {selected && (
                                <TextField
                                  select
                                  size="small"
                                  value={selected.action}
                                  onChange={(e) =>
                                    setFieldAction(r.key, e.target.value as "maintain" | "confirm")
                                  }
                                  sx={{ minWidth: 120 }}
                                >
                                  <MenuItem value="maintain">
                                    {t("surveyBuilder.fields.maintain")}
                                  </MenuItem>
                                  <MenuItem value="confirm">
                                    {t("surveyBuilder.fields.confirm")}
                                  </MenuItem>
                                </TextField>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </>
          )}

          {selectedFields.length > 0 && (
            <Typography variant="body2" sx={{ mt: 2 }} color="text.secondary">
              {t("surveyBuilder.fields.selectedCount", {
                count: selectedFields.length,
                maintain: selectedFields.filter((f) => f.action === "maintain").length,
                confirm: selectedFields.filter((f) => f.action === "confirm").length,
              })}
            </Typography>
          )}
        </MuiCard>
      )}

      {/* Step 4: Preview & Send */}
      {activeStep === 3 && (
        <MuiCard sx={{ p: 3 }}>
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
            {t("surveyBuilder.preview.title")}
          </Typography>

          {previewing && (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress />
            </Box>
          )}

          {!previewing && preview && (
            <>
              <Box sx={{ display: "flex", gap: 3, mb: 3 }}>
                <MuiCard variant="outlined" sx={{ p: 2, flex: 1, textAlign: "center" }}>
                  <Typography variant="h4" sx={{ fontWeight: 700, color: "#1976d2" }}>
                    {preview.total_cards}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t("surveyBuilder.preview.cards")}
                  </Typography>
                  {/* A card is only reachable through a stakeholder holding a
                      target role, so the tile is a subset of what the filters
                      matched. Say so, or thin ownership reads as a filter that
                      is too narrow. */}
                  {preview.total_matched !== preview.total_cards && (
                    <Typography variant="caption" color="text.secondary">
                      {t("surveyBuilder.preview.ofMatched", { count: preview.total_matched })}
                    </Typography>
                  )}
                </MuiCard>
                <MuiCard variant="outlined" sx={{ p: 2, flex: 1, textAlign: "center" }}>
                  <Typography variant="h4" sx={{ fontWeight: 700, color: "#1976d2" }}>
                    {preview.total_users}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t("surveyBuilder.preview.usersToNotify")}
                  </Typography>
                  {/* One person on several cards is one user but several
                      requests — show both so the headcount isn't read as the
                      amount of work being created. */}
                  <Typography variant="caption" color="text.secondary">
                    {t("surveyBuilder.preview.requests", { count: preview.total_requests })}
                  </Typography>
                </MuiCard>
                <MuiCard variant="outlined" sx={{ p: 2, flex: 1, textAlign: "center" }}>
                  <Typography variant="h4" sx={{ fontWeight: 700, color: "#1976d2" }}>
                    {selectedFields.length}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t("surveyBuilder.preview.fields")}
                  </Typography>
                </MuiCard>
              </Box>

              {preview.total_cards === 0 && preview.total_matched === 0 && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  {t("surveyBuilder.preview.noMatches")}
                </Alert>
              )}

              {preview.total_matched > preview.total_cards && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  <AlertTitle sx={{ fontSize: "0.875rem", fontWeight: 600 }}>
                    {t("surveyBuilder.preview.skippedTitle", {
                      count: preview.total_matched - preview.total_cards,
                    })}
                  </AlertTitle>
                  {t("surveyBuilder.preview.skippedHint")}
                  {preview.skipped.length > 0 && (
                    <Box sx={{ mt: 1, display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                      {preview.skipped.map((c) => (
                        <Chip
                          key={c.card_id}
                          label={c.card_name}
                          size="small"
                          variant="outlined"
                          component="a"
                          href={`/cards/${c.card_id}`}
                          target="_blank"
                          clickable
                        />
                      ))}
                      {preview.total_matched - preview.total_cards > preview.skipped.length && (
                        <Typography variant="caption" color="text.secondary" sx={{ alignSelf: "center" }}>
                          {t("surveyBuilder.preview.skippedTruncated", {
                            count: preview.skipped.length,
                          })}
                        </Typography>
                      )}
                    </Box>
                  )}
                </Alert>
              )}

              {preview.targets.length > 0 && (
                <>
                  <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                    {t("surveyBuilder.preview.targetBreakdown")}
                  </Typography>
                  <TableContainer sx={{ maxHeight: 400, mb: 3 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell>{t("surveyBuilder.preview.columns.card")}</TableCell>
                          <TableCell>{t("surveyBuilder.preview.columns.users")}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {preview.targets.map((tp) => (
                          <TableRow key={tp.card_id}>
                            <TableCell>{tp.card_name}</TableCell>
                            <TableCell>
                              {tp.users.map((u) => {
                                const named = u.roles.map(roleLabel).filter(Boolean).join(", ");
                                return (
                                  <Chip
                                    key={u.user_id}
                                    label={named ? `${u.display_name} (${named})` : u.display_name}
                                    size="small"
                                    sx={{ mr: 0.5, mb: 0.5 }}
                                  />
                                );
                              })}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </>
              )}

              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                {t("surveyBuilder.preview.messagePreview")}
              </Typography>
              <MuiCard variant="outlined" sx={{ p: 2, mb: 2, bgcolor: "action.hover" }}>
                <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                  {message || t("surveyBuilder.preview.noMessage")}
                </Typography>
              </MuiCard>

              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                {t("surveyBuilder.preview.fields")}
              </Typography>
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 3 }}>
                {selectedFields.map((f) => (
                  <Chip
                    key={f.key}
                    label={`${f.label} (${f.action})`}
                    size="small"
                    color={f.action === "maintain" ? "primary" : "default"}
                    variant="outlined"
                  />
                ))}
              </Box>
            </>
          )}

          {!previewing && !preview && (
            <Box sx={{ textAlign: "center", py: 4 }}>
              <Button variant="outlined" onClick={loadPreview}>
                {t("surveyBuilder.preview.loadPreview")}
              </Button>
            </Box>
          )}
        </MuiCard>
      )}

      {/* Navigation buttons */}
      <Box sx={{ display: "flex", justifyContent: "space-between", mt: 3 }}>
        <Button
          disabled={activeStep === 0}
          onClick={handleBack}
          startIcon={<MaterialSymbol icon="arrow_back" size={18} />}
        >
          {t("common:actions.back")}
        </Button>
        <Box sx={{ display: "flex", gap: 1 }}>
          {targetTypeKey && name.trim() && (
            <Button
              variant="outlined"
              onClick={saveDraft}
              disabled={saving}
              sx={{ textTransform: "none" }}
            >
              {saving ? t("surveyBuilder.savingDraft") : t("surveyBuilder.saveDraft")}
            </Button>
          )}
          {activeStep < STEPS.length - 1 ? (
            <Button
              variant="contained"
              onClick={handleNext}
              endIcon={<MaterialSymbol icon="arrow_forward" size={18} />}
              sx={{ textTransform: "none" }}
            >
              {t("common:actions.next")}
            </Button>
          ) : (
            <Button
              variant="contained"
              color="success"
              onClick={handleSend}
              disabled={
                sending ||
                !preview ||
                preview.total_cards === 0
              }
              startIcon={<MaterialSymbol icon="send" size={18} />}
              sx={{ textTransform: "none" }}
            >
              {sending ? t("surveyBuilder.sendingSurvey") : t("surveyBuilder.sendSurvey")}
            </Button>
          )}
        </Box>
      </Box>
    </Box>
  );
}
