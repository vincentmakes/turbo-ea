import { useEffect, useState, useMemo, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
import CircularProgress from "@mui/material/CircularProgress";
import MuiCard from "@mui/material/Card";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Autocomplete from "@mui/material/Autocomplete";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Divider from "@mui/material/Divider";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import type {
  Survey,
  SurveyField,
  SurveyTargetFilters,
  SurveyPreviewResult,
  Card,
  TagGroup,
  StakeholderRoleDef,
} from "@/types";

export default function SurveyBuilder() {
  const { t } = useTranslation(["admin", "common"]);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { types } = useMetamodel();

  const STEPS = [
    t("surveyBuilder.steps.basics"),
    t("surveyBuilder.steps.target"),
    t("surveyBuilder.steps.fields"),
    t("surveyBuilder.steps.previewSend"),
  ];

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
  const [relatedItems, setRelatedItems] = useState<Card[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [relatedSearch, setRelatedSearch] = useState("");
  const [relatedOptions, setRelatedOptions] = useState<Card[]>([]);
  const [tagGroups, setTagGroups] = useState<TagGroup[]>([]);
  const [roles, setRoles] = useState<StakeholderRoleDef[]>([]);
  const [attributeFilters, setAttributeFilters] = useState<
    { key: string; op: string; value: string }[]
  >([]);

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
        setTagIds(s.target_filters?.tag_ids || []);
        setAttributeFilters(s.target_filters?.attribute_filters || []);
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

  // Load tag groups and roles
  useEffect(() => {
    api.get<TagGroup[]>("/tag-groups").then(setTagGroups).catch(() => {});
    api.get<StakeholderRoleDef[]>("/stakeholder-roles").then(setRoles).catch(() => {});
  }, []);

  // Search cards for related filter
  useEffect(() => {
    if (!relatedSearch || relatedSearch.length < 2) {
      setRelatedOptions([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await api.get<{ items: Card[] }>(
          `/cards?search=${encodeURIComponent(relatedSearch)}&page_size=20`,
        );
        setRelatedOptions(res.items);
      } catch {
        // ignore
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [relatedSearch]);

  // Merge selected items with search results so selected values are always in options
  const mergedRelatedOptions = useMemo(() => {
    const ids = new Set(relatedOptions.map((o) => o.id));
    return [...relatedOptions, ...relatedItems.filter((item) => !ids.has(item.id))];
  }, [relatedOptions, relatedItems]);

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
          label: f.label,
          type: f.type,
          options: f.options,
        });
      }
    }
    return fields;
  }, [selectedType]);

  // All tags from all groups
  const allTags = useMemo(
    () => tagGroups.flatMap((g) => g.tags.map((tg) => ({ ...tg, group_name: g.name }))),
    [tagGroups],
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
        target_filters: {
          related_ids: relatedIds.length > 0 ? relatedIds : undefined,
          tag_ids: tagIds.length > 0 ? tagIds : undefined,
          attribute_filters: attributeFilters.length > 0 ? attributeFilters : undefined,
        } as SurveyTargetFilters,
        target_roles: targetRoles,
        fields: selectedFields,
      };

      if (surveyId) {
        await api.patch(`/surveys/${surveyId}`, body);
      } else {
        const created = await api.post<Survey>("/surveys", body);
        setSurveyId(created.id);
        window.history.replaceState(null, "", `/admin/surveys/${created.id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setSaving(false);
    }
  }, [name, description, message, targetTypeKey, targetRoles, relatedIds, tagIds, attributeFilters, selectedFields, surveyId]);

  // Preview targets
  const loadPreview = useCallback(async () => {
    if (!surveyId) {
      // Save first
      await saveDraft();
    }
    setPreviewing(true);
    setError("");
    try {
      // Save latest changes first
      const body = {
        name: name.trim() || "Untitled Survey",
        description,
        message,
        target_type_key: targetTypeKey,
        target_filters: {
          related_ids: relatedIds.length > 0 ? relatedIds : undefined,
          tag_ids: tagIds.length > 0 ? tagIds : undefined,
          attribute_filters: attributeFilters.length > 0 ? attributeFilters : undefined,
        } as SurveyTargetFilters,
        target_roles: targetRoles,
        fields: selectedFields,
      };

      let sid = surveyId;
      if (sid) {
        await api.patch(`/surveys/${sid}`, body);
      } else {
        const created = await api.post<Survey>("/surveys", body);
        sid = created.id;
        setSurveyId(created.id);
        window.history.replaceState(null, "", `/admin/surveys/${created.id}`);
      }

      const data = await api.post<SurveyPreviewResult>(`/surveys/${sid}/preview`, {});
      setPreview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setPreviewing(false);
    }
  }, [surveyId, name, description, message, targetTypeKey, targetRoles, relatedIds, tagIds, attributeFilters, selectedFields, saveDraft]);

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
                    {ct.label}
                  </Box>
                </MenuItem>
              ))}
          </TextField>

          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
            {t("surveyBuilder.target.filterRelated")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t("surveyBuilder.target.filterRelatedHint")}
          </Typography>
          <Autocomplete
            multiple
            filterSelectedOptions
            options={mergedRelatedOptions}
            getOptionLabel={(o) => `${o.name} (${o.type})`}
            isOptionEqualToValue={(opt, val) => opt.id === val.id}
            value={relatedItems}
            inputValue={relatedSearch}
            onInputChange={(_, val, reason) => {
              if (reason !== "reset") setRelatedSearch(val);
            }}
            onChange={(_, vals) => {
              setRelatedItems(vals);
              setRelatedIds(vals.map((v) => v.id));
            }}
            renderInput={(params) => (
              <TextField {...params} label={t("surveyBuilder.target.searchCards")} size="small" />
            )}
            renderTags={(vals, getTagProps) =>
              vals.map((v, i) => (
                <Chip {...getTagProps({ index: i })} key={v.id} label={v.name} size="small" />
              ))
            }
            sx={{ mb: 3 }}
            noOptionsText={relatedSearch.length < 2 ? t("common:labels.loading") : t("common:labels.noResults")}
          />

          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
            {t("surveyBuilder.target.filterTags")}
          </Typography>
          <Autocomplete
            multiple
            options={allTags}
            getOptionLabel={(tg) => `${tg.group_name}: ${tg.name}`}
            value={allTags.filter((tg) => tagIds.includes(tg.id))}
            onChange={(_, vals) => setTagIds(vals.map((v) => v.id))}
            renderInput={(params) => (
              <TextField {...params} label={t("surveyBuilder.target.selectTags")} size="small" />
            )}
            renderTags={(vals, getTagProps) =>
              vals.map((v, i) => (
                <Chip
                  {...getTagProps({ index: i })}
                  key={v.id}
                  label={v.name}
                  size="small"
                  sx={v.color ? { bgcolor: v.color, color: "#fff" } : undefined}
                />
              ))
            }
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
                  label="Field"
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
                  label="Operator"
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
                    label="Value"
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
                  <Typography variant="body2">{role.label}</Typography>
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
            {t("surveyBuilder.fields.description", { type: selectedType?.label || "card" })}
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
                          <Chip label={f.type} size="small" variant="outlined" />
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
                </MuiCard>
                <MuiCard variant="outlined" sx={{ p: 2, flex: 1, textAlign: "center" }}>
                  <Typography variant="h4" sx={{ fontWeight: 700, color: "#1976d2" }}>
                    {preview.total_users}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t("surveyBuilder.preview.usersToNotify")}
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

              {preview.total_cards === 0 && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  {t("surveyBuilder.preview.noMatches")}
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
                              {tp.users.map((u) => (
                                <Chip
                                  key={u.user_id}
                                  label={`${u.display_name} (${u.role})`}
                                  size="small"
                                  sx={{ mr: 0.5, mb: 0.5 }}
                                />
                              ))}
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
