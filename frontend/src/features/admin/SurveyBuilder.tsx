import { useEffect, useState, useMemo, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
import Card from "@mui/material/Card";
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
  FactSheet,
  TagGroup,
  SubscriptionRoleDef,
} from "@/types";

const STEPS = ["Basics", "Target", "Fields", "Preview & Send"];

export default function SurveyBuilder() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { types } = useMetamodel();

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
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [relatedSearch, setRelatedSearch] = useState("");
  const [relatedOptions, setRelatedOptions] = useState<FactSheet[]>([]);
  const [tagGroups, setTagGroups] = useState<TagGroup[]>([]);
  const [roles, setRoles] = useState<SubscriptionRoleDef[]>([]);

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
        setSelectedFields(s.fields || []);
        setSurveyId(s.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load survey");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  // Load tag groups and roles
  useEffect(() => {
    api.get<TagGroup[]>("/tag-groups").then(setTagGroups).catch(() => {});
    api.get<SubscriptionRoleDef[]>("/subscription-roles").then(setRoles).catch(() => {});
  }, []);

  // Search fact sheets for related filter
  useEffect(() => {
    if (!relatedSearch || relatedSearch.length < 2) {
      setRelatedOptions([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await api.get<{ items: FactSheet[] }>(
          `/fact-sheets?search=${encodeURIComponent(relatedSearch)}&page_size=20`,
        );
        setRelatedOptions(res.items);
      } catch {
        // ignore
      }
    }, 300);
    return () => clearTimeout(t);
  }, [relatedSearch]);

  // Get the selected type's fields schema
  const selectedType = useMemo(
    () => types.find((t) => t.key === targetTypeKey),
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
    () => tagGroups.flatMap((g) => g.tags.map((t) => ({ ...t, group_name: g.name }))),
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
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [name, description, message, targetTypeKey, targetRoles, relatedIds, tagIds, selectedFields, surveyId]);

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
      setError(e instanceof Error ? e.message : "Failed to preview");
    } finally {
      setPreviewing(false);
    }
  }, [surveyId, name, description, message, targetTypeKey, targetRoles, relatedIds, tagIds, selectedFields, saveDraft]);

  // Send survey
  const handleSend = async () => {
    if (!surveyId) return;
    setSending(true);
    setError("");
    try {
      await api.post(`/surveys/${surveyId}/send`, {});
      navigate(`/admin/surveys/${surveyId}/results`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send survey");
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
      setError("Survey name is required");
      return;
    }
    if (activeStep === 1 && !targetTypeKey) {
      setError("Please select a target fact sheet type");
      return;
    }
    if (activeStep === 1 && targetRoles.length === 0) {
      setError("Please select at least one subscription role");
      return;
    }
    if (activeStep === 2 && selectedFields.length === 0) {
      setError("Please select at least one field");
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
        <Tooltip title="Back to Surveys">
          <IconButton onClick={() => navigate("/admin/surveys")}>
            <MaterialSymbol icon="arrow_back" size={22} />
          </IconButton>
        </Tooltip>
        <MaterialSymbol icon="assignment" size={28} color="#1976d2" />
        <Typography variant="h5" sx={{ fontWeight: 700, flex: 1 }}>
          {id ? "Edit Survey" : "New Survey"}
        </Typography>
        {surveyId && (
          <Chip label="Draft" size="small" color="default" />
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
        <Card sx={{ p: 3 }}>
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
            Survey Details
          </Typography>
          <TextField
            label="Survey Name"
            fullWidth
            value={name}
            onChange={(e) => setName(e.target.value)}
            sx={{ mb: 2 }}
            required
          />
          <TextField
            label="Description"
            fullWidth
            multiline
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            sx={{ mb: 2 }}
            helperText="Optional internal description (not shown to respondents)"
          />
          <TextField
            label="Message to Respondents"
            fullWidth
            multiline
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            helperText="This message will be shown to targeted users when they open the survey"
          />
        </Card>
      )}

      {/* Step 2: Target */}
      {activeStep === 1 && (
        <Card sx={{ p: 3 }}>
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
            Target Fact Sheets
          </Typography>

          <TextField
            select
            label="Fact Sheet Type"
            fullWidth
            value={targetTypeKey}
            onChange={(e) => {
              setTargetTypeKey(e.target.value);
              setSelectedFields([]);
            }}
            sx={{ mb: 3 }}
            required
          >
            {types
              .filter((t) => !t.is_hidden)
              .map((t) => (
                <MenuItem key={t.key} value={t.key}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <MaterialSymbol icon={t.icon} size={18} color={t.color} />
                    {t.label}
                  </Box>
                </MenuItem>
              ))}
          </TextField>

          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
            Filter by Related Fact Sheets (optional)
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Only target fact sheets that are related to specific items (e.g., all Applications related to the Sales organization)
          </Typography>
          <Autocomplete
            multiple
            options={relatedOptions}
            getOptionLabel={(o) => `${o.name} (${o.type})`}
            value={relatedOptions.filter((o) => relatedIds.includes(o.id))}
            onInputChange={(_, val) => setRelatedSearch(val)}
            onChange={(_, vals) => setRelatedIds(vals.map((v) => v.id))}
            renderInput={(params) => (
              <TextField {...params} label="Search fact sheets..." size="small" />
            )}
            renderTags={(vals, getTagProps) =>
              vals.map((v, i) => (
                <Chip {...getTagProps({ index: i })} key={v.id} label={v.name} size="small" />
              ))
            }
            sx={{ mb: 3 }}
            noOptionsText={relatedSearch.length < 2 ? "Type to search..." : "No results"}
          />

          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
            Filter by Tags (optional)
          </Typography>
          <Autocomplete
            multiple
            options={allTags}
            getOptionLabel={(t) => `${t.group_name}: ${t.name}`}
            value={allTags.filter((t) => tagIds.includes(t.id))}
            onChange={(_, vals) => setTagIds(vals.map((v) => v.id))}
            renderInput={(params) => (
              <TextField {...params} label="Select tags..." size="small" />
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

          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
            Target Subscription Roles
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Which roles should receive the survey for each matched fact sheet?
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
                      Only for: {role.allowed_types.join(", ")}
                    </Typography>
                  )}
                </Box>
              }
            />
          ))}
        </Card>
      )}

      {/* Step 3: Fields */}
      {activeStep === 2 && (
        <Card sx={{ p: 3 }}>
          <Typography variant="h6" sx={{ mb: 1, fontWeight: 600 }}>
            Select Fields
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Choose which fields respondents should maintain or confirm for each {selectedType?.label || "fact sheet"}.
          </Typography>

          {!selectedType && (
            <Alert severity="warning">Please select a fact sheet type first.</Alert>
          )}

          {selectedType && allFields.length === 0 && (
            <Alert severity="info">This type has no configurable fields.</Alert>
          )}

          {allFields.length > 0 && (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox" />
                    <TableCell>Section</TableCell>
                    <TableCell>Field</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Action</TableCell>
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
                              <MenuItem value="maintain">Maintain</MenuItem>
                              <MenuItem value="confirm">Confirm</MenuItem>
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
              {selectedFields.length} field{selectedFields.length !== 1 ? "s" : ""} selected
              ({selectedFields.filter((f) => f.action === "maintain").length} maintain,{" "}
              {selectedFields.filter((f) => f.action === "confirm").length} confirm)
            </Typography>
          )}
        </Card>
      )}

      {/* Step 4: Preview & Send */}
      {activeStep === 3 && (
        <Card sx={{ p: 3 }}>
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
            Preview & Send
          </Typography>

          {previewing && (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress />
            </Box>
          )}

          {!previewing && preview && (
            <>
              <Box sx={{ display: "flex", gap: 3, mb: 3 }}>
                <Card variant="outlined" sx={{ p: 2, flex: 1, textAlign: "center" }}>
                  <Typography variant="h4" sx={{ fontWeight: 700, color: "#1976d2" }}>
                    {preview.total_fact_sheets}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Fact Sheets
                  </Typography>
                </Card>
                <Card variant="outlined" sx={{ p: 2, flex: 1, textAlign: "center" }}>
                  <Typography variant="h4" sx={{ fontWeight: 700, color: "#1976d2" }}>
                    {preview.total_users}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Users to Notify
                  </Typography>
                </Card>
                <Card variant="outlined" sx={{ p: 2, flex: 1, textAlign: "center" }}>
                  <Typography variant="h4" sx={{ fontWeight: 700, color: "#1976d2" }}>
                    {selectedFields.length}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Fields
                  </Typography>
                </Card>
              </Box>

              {preview.total_fact_sheets === 0 && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  No fact sheets matched your filters, or no subscribers were found with the selected roles.
                  Go back and adjust your targeting criteria.
                </Alert>
              )}

              {preview.targets.length > 0 && (
                <>
                  <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                    Target Breakdown
                  </Typography>
                  <TableContainer sx={{ maxHeight: 400, mb: 3 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell>Fact Sheet</TableCell>
                          <TableCell>Users</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {preview.targets.map((t) => (
                          <TableRow key={t.fact_sheet_id}>
                            <TableCell>{t.fact_sheet_name}</TableCell>
                            <TableCell>
                              {t.users.map((u) => (
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
                Message Preview
              </Typography>
              <Card variant="outlined" sx={{ p: 2, mb: 2, bgcolor: "grey.50" }}>
                <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                  {message || "(No message set)"}
                </Typography>
              </Card>

              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                Fields
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
                Load Preview
              </Button>
            </Box>
          )}
        </Card>
      )}

      {/* Navigation buttons */}
      <Box sx={{ display: "flex", justifyContent: "space-between", mt: 3 }}>
        <Button
          disabled={activeStep === 0}
          onClick={handleBack}
          startIcon={<MaterialSymbol icon="arrow_back" size={18} />}
        >
          Back
        </Button>
        <Box sx={{ display: "flex", gap: 1 }}>
          {targetTypeKey && name.trim() && (
            <Button
              variant="outlined"
              onClick={saveDraft}
              disabled={saving}
              sx={{ textTransform: "none" }}
            >
              {saving ? "Saving..." : "Save Draft"}
            </Button>
          )}
          {activeStep < STEPS.length - 1 ? (
            <Button
              variant="contained"
              onClick={handleNext}
              endIcon={<MaterialSymbol icon="arrow_forward" size={18} />}
              sx={{ textTransform: "none" }}
            >
              Next
            </Button>
          ) : (
            <Button
              variant="contained"
              color="success"
              onClick={handleSend}
              disabled={
                sending ||
                !preview ||
                preview.total_fact_sheets === 0
              }
              startIcon={<MaterialSymbol icon="send" size={18} />}
              sx={{ textTransform: "none" }}
            >
              {sending ? "Sending..." : "Send Survey"}
            </Button>
          )}
        </Box>
      </Box>
    </Box>
  );
}
