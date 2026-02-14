import { useState, useEffect, useCallback, useMemo } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import IconButton from "@mui/material/IconButton";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import CircularProgress from "@mui/material/CircularProgress";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import { EolLinkDialog } from "@/components/EolLinkSection";
import VendorField from "@/components/VendorField";
import { useMetamodel } from "@/hooks/useMetamodel";
import { api } from "@/api/client";
import type { FieldDef, FactSheet, EolCycle, EolProductMatch } from "@/types";

const EOL_ELIGIBLE_TYPES = ["Application", "ITComponent"];
const VENDOR_ELIGIBLE_TYPES = ["Application", "ITComponent"];

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (data: {
    type: string;
    subtype?: string;
    name: string;
    description?: string;
    parent_id?: string;
    attributes?: Record<string, unknown>;
    lifecycle?: Record<string, string>;
  }) => Promise<void>;
  initialType?: string;
}

interface ParentOption {
  id: string;
  name: string;
}

export default function CreateFactSheetDialog({
  open,
  onClose,
  onCreate,
  initialType,
}: Props) {
  const { types } = useMetamodel();

  const [selectedType, setSelectedType] = useState(initialType || "");
  const [subtype, setSubtype] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [parentInputValue, setParentInputValue] = useState("");
  const [parentOptions, setParentOptions] = useState<ParentOption[]>([]);
  const [parentLoading, setParentLoading] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [attributes, setAttributes] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [eolProduct, setEolProduct] = useState("");
  const [eolCycle, setEolCycle] = useState("");
  const [eolDialogOpen, setEolDialogOpen] = useState(false);

  // Auto-search EOL state
  const [eolSuggestions, setEolSuggestions] = useState<EolProductMatch[]>([]);
  const [eolSearching, setEolSearching] = useState(false);
  const [eolAutoSearchDone, setEolAutoSearchDone] = useState(false);

  const typeConfig = useMemo(
    () => types.find((t) => t.key === selectedType),
    [types, selectedType],
  );

  const hasSubtypes = !!(typeConfig?.subtypes && typeConfig.subtypes.length > 0);
  const hasHierarchy = !!typeConfig?.has_hierarchy;
  const isEolEligible = EOL_ELIGIBLE_TYPES.includes(selectedType);

  // Collect all required fields across all sections for the selected type
  const requiredFields = useMemo(() => {
    if (!typeConfig) return [];
    const fields: (FieldDef & { sectionName: string })[] = [];
    for (const section of typeConfig.fields_schema) {
      for (const field of section.fields) {
        if (field.required) {
          fields.push({ ...field, sectionName: section.section });
        }
      }
    }
    return fields;
  }, [typeConfig]);

  // Reset dependent fields when type changes
  useEffect(() => {
    setSubtype("");
    setParentId(null);
    setParentInputValue("");
    setParentOptions([]);
    setAttributes({});
    setError("");
    setEolProduct("");
    setEolCycle("");
    setEolSuggestions([]);
    setEolAutoSearchDone(false);
  }, [selectedType]);

  // Set initial type when dialog opens
  useEffect(() => {
    if (open && initialType) {
      setSelectedType(initialType);
    }
  }, [open, initialType]);

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setSelectedType(initialType || "");
      setSubtype("");
      setParentId(null);
      setParentInputValue("");
      setParentOptions([]);
      setName("");
      setDescription("");
      setAttributes({});
      setLoading(false);
      setError("");
      setEolProduct("");
      setEolCycle("");
      setEolDialogOpen(false);
      setEolSuggestions([]);
      setEolAutoSearchDone(false);
    }
  }, [open, initialType]);

  // Auto-search EOL when name changes (debounced)
  useEffect(() => {
    if (!isEolEligible || !name.trim() || name.trim().length < 2) {
      setEolSuggestions([]);
      setEolAutoSearchDone(false);
      return;
    }
    // Don't auto-search if already linked
    if (eolProduct && eolCycle) return;

    const timer = setTimeout(async () => {
      setEolSearching(true);
      try {
        const results = await api.get<EolProductMatch[]>(
          `/eol/products/fuzzy?search=${encodeURIComponent(name.trim())}&limit=5`
        );
        setEolSuggestions(results);
        setEolAutoSearchDone(true);
      } catch {
        setEolSuggestions([]);
        setEolAutoSearchDone(true);
      } finally {
        setEolSearching(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [name, isEolEligible, eolProduct, eolCycle]);

  // Fetch parent options when search query changes
  const fetchParentOptions = useCallback(
    async (query: string) => {
      if (!selectedType || !hasHierarchy) return;
      setParentLoading(true);
      try {
        const params = new URLSearchParams({
          type: selectedType,
          search: query,
          page_size: "20",
        });
        const res = await api.get<{ items: FactSheet[] }>(
          `/fact-sheets?${params.toString()}`,
        );
        setParentOptions(
          res.items.map((fs) => ({ id: fs.id, name: fs.name })),
        );
      } catch {
        setParentOptions([]);
      } finally {
        setParentLoading(false);
      }
    },
    [selectedType, hasHierarchy],
  );

  // Debounced parent search
  useEffect(() => {
    if (!hasHierarchy) return;
    const timer = setTimeout(() => {
      fetchParentOptions(parentInputValue);
    }, 300);
    return () => clearTimeout(timer);
  }, [parentInputValue, hasHierarchy, fetchParentOptions]);

  const setAttr = (key: string, value: unknown) => {
    setAttributes((prev) => ({ ...prev, [key]: value }));
  };

  const handleSelectSuggestion = (productName: string) => {
    setEolProduct(productName);
    setEolCycle(""); // User still needs to pick a cycle
    setEolDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!selectedType || !name.trim()) return;
    setLoading(true);
    setError("");
    try {
      const finalAttrs = { ...attributes };
      if (eolProduct && eolCycle) {
        finalAttrs.eol_product = eolProduct;
        finalAttrs.eol_cycle = eolCycle;
      }

      // For ITComponent: sync lifecycle dates from EOL data
      let lifecycle: Record<string, string> | undefined;
      if (selectedType === "ITComponent" && eolProduct && eolCycle) {
        try {
          const cycles = await api.get<EolCycle[]>(
            `/eol/products/${encodeURIComponent(eolProduct)}`
          );
          const match = cycles.find(
            (c) => String(c.cycle) === String(eolCycle)
          );
          if (match) {
            lifecycle = {};
            if (match.releaseDate) lifecycle.active = match.releaseDate;
            if (typeof match.support === "string")
              lifecycle.phaseOut = match.support;
            if (typeof match.eol === "string")
              lifecycle.endOfLife = match.eol;
          }
        } catch {
          // If fetching cycles fails, just create without lifecycle
        }
      }

      await onCreate({
        type: selectedType,
        subtype: subtype || undefined,
        name: name.trim(),
        description: description.trim() || undefined,
        parent_id: parentId || undefined,
        attributes:
          Object.keys(finalAttrs).length > 0 ? finalAttrs : undefined,
        lifecycle,
      });
      onClose();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to create fact sheet";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const renderField = (field: FieldDef) => {
    switch (field.type) {
      case "single_select":
        return (
          <FormControl fullWidth key={field.key} sx={{ mb: 2 }}>
            <InputLabel>{field.label}</InputLabel>
            <Select
              value={(attributes[field.key] as string) ?? ""}
              label={field.label}
              onChange={(e) => setAttr(field.key, e.target.value || undefined)}
            >
              <MenuItem value="">
                <em>None</em>
              </MenuItem>
              {field.options?.map((opt) => (
                <MenuItem key={opt.key} value={opt.key}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    {opt.color && (
                      <Box
                        sx={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          bgcolor: opt.color,
                          flexShrink: 0,
                        }}
                      />
                    )}
                    {opt.label}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        );

      case "number":
        return (
          <TextField
            key={field.key}
            fullWidth
            label={field.label}
            type="number"
            value={attributes[field.key] ?? ""}
            onChange={(e) =>
              setAttr(
                field.key,
                e.target.value ? Number(e.target.value) : undefined,
              )
            }
            sx={{ mb: 2 }}
          />
        );

      case "boolean":
        return (
          <FormControlLabel
            key={field.key}
            control={
              <Switch
                checked={!!attributes[field.key]}
                onChange={(e) => setAttr(field.key, e.target.checked)}
              />
            }
            label={field.label}
            sx={{ mb: 1, display: "block" }}
          />
        );

      case "date":
        return (
          <TextField
            key={field.key}
            fullWidth
            label={field.label}
            type="date"
            value={(attributes[field.key] as string) ?? ""}
            onChange={(e) => setAttr(field.key, e.target.value || undefined)}
            InputLabelProps={{ shrink: true }}
            sx={{ mb: 2 }}
          />
        );

      case "text":
      default:
        return (
          <TextField
            key={field.key}
            fullWidth
            label={field.label}
            value={(attributes[field.key] as string) ?? ""}
            onChange={(e) => setAttr(field.key, e.target.value || undefined)}
            sx={{ mb: 2 }}
          />
        );
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { maxWidth: 560, width: "100%" } }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          pb: 1,
        }}
      >
        Create Fact Sheet
        <IconButton
          aria-label="close"
          onClick={onClose}
          size="small"
          sx={{ color: "text.secondary" }}
        >
          <MaterialSymbol icon="close" size={20} />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ pt: 2 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
            {error}
          </Alert>
        )}

        {/* Type selector */}
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>Type</InputLabel>
          <Select
            value={selectedType}
            label="Type"
            onChange={(e) => setSelectedType(e.target.value)}
          >
            {types.map((t) => (
              <MenuItem key={t.key} value={t.key}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Box
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      bgcolor: t.color,
                      flexShrink: 0,
                    }}
                  />
                  <MaterialSymbol icon={t.icon} size={20} color={t.color} />
                  {t.label}
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Subtype selector */}
        {hasSubtypes && (
          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel>Subtype</InputLabel>
            <Select
              value={subtype}
              label="Subtype"
              onChange={(e) => setSubtype(e.target.value)}
            >
              <MenuItem value="">
                <em>None</em>
              </MenuItem>
              {typeConfig!.subtypes!.map((st) => (
                <MenuItem key={st.key} value={st.key}>
                  {st.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}

        {/* Parent selector */}
        {hasHierarchy && (
          <Autocomplete
            sx={{ mb: 2 }}
            options={parentOptions}
            getOptionLabel={(opt) => opt.name}
            isOptionEqualToValue={(opt, val) => opt.id === val.id}
            loading={parentLoading}
            value={
              parentId
                ? parentOptions.find((o) => o.id === parentId) || null
                : null
            }
            onChange={(_e, newValue) => {
              setParentId(newValue ? newValue.id : null);
            }}
            inputValue={parentInputValue}
            onInputChange={(_e, newInputValue) => {
              setParentInputValue(newInputValue);
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Parent"
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {parentLoading ? (
                        <CircularProgress color="inherit" size={18} />
                      ) : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
          />
        )}

        {/* Name */}
        <TextField
          fullWidth
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          sx={{ mb: 2 }}
        />

        {/* Description */}
        <TextField
          fullWidth
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          multiline
          rows={3}
          sx={{ mb: 2 }}
        />

        {/* EOL section - below description, with auto-search */}
        {isEolEligible && (
          <Box
            sx={{
              mt: 0,
              mb: 2,
              p: 1.5,
              border: "1px dashed",
              borderColor: eolProduct ? "success.main" : "divider",
              borderRadius: 1,
              ...(eolProduct
                ? { bgcolor: "rgba(76, 175, 80, 0.04)" }
                : {}),
            }}
          >
            {eolProduct && eolCycle ? (
              /* Already linked */
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                }}
              >
                <MaterialSymbol
                  icon="check_circle"
                  size={18}
                  color="#4caf50"
                />
                <Typography variant="body2">
                  Linked to{" "}
                  <strong>
                    {eolProduct} {eolCycle}
                  </strong>
                </Typography>
                <Box sx={{ ml: "auto", display: "flex", gap: 0.5 }}>
                  <Button
                    size="small"
                    onClick={() => setEolDialogOpen(true)}
                  >
                    Change
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    onClick={() => {
                      setEolProduct("");
                      setEolCycle("");
                      setEolAutoSearchDone(false);
                    }}
                  >
                    Remove
                  </Button>
                </Box>
              </Box>
            ) : (
              <Box>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    mb: eolSearching || (eolAutoSearchDone && eolSuggestions.length > 0) ? 1.5 : 0,
                  }}
                >
                  <MaterialSymbol icon="update" size={18} color="#666" />
                  <Typography variant="body2" color="text.secondary">
                    End-of-Life Tracking
                  </Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    sx={{ ml: "auto" }}
                    onClick={() => setEolDialogOpen(true)}
                  >
                    Manual Search
                  </Button>
                </Box>

                {/* Auto-search loading */}
                {eolSearching && (
                  <Box sx={{ mt: 1 }}>
                    <LinearProgress sx={{ mb: 0.5, borderRadius: 1 }} />
                    <Typography variant="caption" color="text.secondary">
                      Searching endoflife.date for "{name.trim()}"...
                    </Typography>
                  </Box>
                )}

                {/* Auto-search suggestions */}
                {!eolSearching && eolAutoSearchDone && eolSuggestions.length > 0 && (
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                      Suggested matches from endoflife.date:
                    </Typography>
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                      {eolSuggestions.map((s) => (
                        <Chip
                          key={s.name}
                          label={s.name}
                          size="small"
                          variant="outlined"
                          onClick={() => handleSelectSuggestion(s.name)}
                          icon={<MaterialSymbol icon="link" size={14} />}
                          sx={{
                            cursor: "pointer",
                            borderColor: s.score >= 0.7 ? "success.main" : "divider",
                            fontWeight: s.score >= 0.7 ? 600 : 400,
                            "&:hover": { bgcolor: "action.hover" },
                          }}
                        />
                      ))}
                    </Box>
                  </Box>
                )}

                {/* No matches found */}
                {!eolSearching && eolAutoSearchDone && eolSuggestions.length === 0 && name.trim().length >= 2 && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
                    No EOL matches found. Use "Manual Search" to look for variations.
                  </Typography>
                )}
              </Box>
            )}
          </Box>
        )}

        {/* Vendor field for eligible types */}
        {VENDOR_ELIGIBLE_TYPES.includes(selectedType) && (
          <Box sx={{ mb: 2 }}>
            <VendorField
              value={(attributes.vendor as string) ?? ""}
              onChange={(v) => setAttr("vendor", v)}
              fsType={selectedType}
              size="small"
            />
          </Box>
        )}

        {/* Required fields from schema (skip vendor since we render it above) */}
        {requiredFields.length > 0 && requiredFields.filter((f) => f.key !== "vendor").map((f) => renderField(f))}

        {/* EOL picker dialog */}
        <EolLinkDialog
          open={eolDialogOpen}
          onClose={() => setEolDialogOpen(false)}
          onLink={(product, cycle) => {
            setEolProduct(product);
            setEolCycle(cycle);
            setEolSuggestions([]);
          }}
          initialProduct={eolProduct || undefined}
        />
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} color="inherit">
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={!selectedType || !name.trim() || loading}
          startIcon={
            loading ? <CircularProgress size={18} color="inherit" /> : undefined
          }
        >
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}
