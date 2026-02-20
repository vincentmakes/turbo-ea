import { useState, useEffect, useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import IconButton from "@mui/material/IconButton";
import Alert from "@mui/material/Alert";
import MaterialSymbol from "@/components/MaterialSymbol";
import ColorPicker from "@/components/ColorPicker";
import KeyInput, { isValidKey } from "@/components/KeyInput";
import { api } from "@/api/client";
import type { FieldDef, FieldOption } from "@/types";
import { FIELD_TYPE_OPTIONS } from "./constants";

/* ------------------------------------------------------------------ */
/*  Field Editor Dialog                                                */
/* ------------------------------------------------------------------ */

export interface FieldEditorProps {
  open: boolean;
  field: FieldDef;
  typeKey: string;
  fieldKey: string;
  onClose: () => void;
  onSave: (field: FieldDef) => void;
  /** True if this field is the target of an active calculation */
  isCalculated?: boolean;
}

export default function FieldEditorDialog({ open, field: initial, typeKey, fieldKey, onClose, onSave, isCalculated }: FieldEditorProps) {
  const [field, setField] = useState<FieldDef>(initial);

  // Track which option keys existed before editing — these are locked
  const originalOptionKeys = useMemo(
    () => new Set((initial.options || []).map((o) => o.key).filter(Boolean)),
    [initial],
  );

  // Option deletion confirmation
  const [deleteOptConfirm, setDeleteOptConfirm] = useState<{
    idx: number;
    optionKey: string;
    optionLabel: string;
    cardCount: number | null; // null = loading
  } | null>(null);

  useEffect(() => {
    if (open) {
      setField({ ...initial });
      setDeleteOptConfirm(null);
    }
  }, [open, initial]);

  const isSelect = field.type === "single_select" || field.type === "multiple_select";

  const updateOption = (idx: number, patch: Partial<FieldOption>) => {
    const opts = [...(field.options || [])];
    opts[idx] = { ...opts[idx], ...patch };
    setField({ ...field, options: opts });
  };

  const addOption = () => {
    setField({
      ...field,
      options: [...(field.options || []), { key: "", label: "" }],
    });
  };

  const removeOption = (idx: number) => {
    const opts = [...(field.options || [])];
    opts.splice(idx, 1);
    setField({ ...field, options: opts });
    setDeleteOptConfirm(null);
  };

  const promptRemoveOption = (idx: number) => {
    const opt = (field.options || [])[idx];
    if (!opt) return;

    // New options (not yet saved) can be removed without confirmation
    if (!originalOptionKeys.has(opt.key)) {
      removeOption(idx);
      return;
    }

    // Existing option — check usage
    setDeleteOptConfirm({ idx, optionKey: opt.key, optionLabel: opt.label, cardCount: null });
    if (typeKey && fieldKey) {
      api
        .get<{ card_count: number }>(
          `/metamodel/types/${typeKey}/option-usage?field_key=${encodeURIComponent(fieldKey)}&option_key=${encodeURIComponent(opt.key)}`,
        )
        .then((r) => setDeleteOptConfirm((prev) => (prev ? { ...prev, cardCount: r.card_count } : null)))
        .catch(() => setDeleteOptConfirm((prev) => (prev ? { ...prev, cardCount: 0 } : null)));
    } else {
      setDeleteOptConfirm((prev) => (prev ? { ...prev, cardCount: 0 } : null));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{initial.key ? "Edit Field" : "Add Field"}</DialogTitle>
      <DialogContent>
        {isCalculated && (
          <Alert severity="info" sx={{ mb: 2, mt: 1 }}>
            This field is managed by a calculation. The field type is locked
            to prevent breaking the formula. Labels and colors can be changed freely.
          </Alert>
        )}
        <KeyInput
          fullWidth
          label="Key"
          value={field.key}
          onChange={(v) => setField({ ...field, key: v })}
          sx={{ mt: 1, mb: 2 }}
          size="small"
          locked={!!initial.key}
          lockedReason="Field key cannot be changed after creation"
        />
        <TextField
          fullWidth
          label="Label"
          value={field.label}
          onChange={(e) => setField({ ...field, label: e.target.value })}
          sx={{ mb: 2 }}
        />
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>Type</InputLabel>
          <Select
            value={field.type}
            label="Type"
            disabled={!!isCalculated}
            onChange={(e) =>
              setField({ ...field, type: e.target.value as FieldDef["type"] })
            }
          >
            {FIELD_TYPE_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Box sx={{ display: "flex", gap: 2, mb: 2, alignItems: "center" }}>
          <FormControlLabel
            control={
              <Switch
                checked={!!field.required}
                onChange={(e) =>
                  setField({ ...field, required: e.target.checked })
                }
              />
            }
            label="Required"
          />
          <TextField
            label="Weight"
            type="number"
            value={field.weight ?? 0}
            onChange={(e) =>
              setField({ ...field, weight: Number(e.target.value) })
            }
            sx={{ width: 120 }}
            size="small"
          />
        </Box>
        {isSelect && (
          <>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Options
            </Typography>
            {(field.options || []).map((opt, idx) => (
              <Box key={idx}>
                <Box
                  sx={{ display: "flex", gap: 1, mb: deleteOptConfirm?.idx === idx ? 0.5 : 1, alignItems: "flex-start" }}
                >
                  <KeyInput
                    size="small"
                    label="Key"
                    value={opt.key}
                    onChange={(v) => updateOption(idx, { key: v })}
                    sx={{ flex: 1 }}
                    locked={originalOptionKeys.has(opt.key)}
                    lockedReason="Key is locked"
                  />
                  <TextField
                    size="small"
                    label="Label"
                    value={opt.label}
                    onChange={(e) => updateOption(idx, { label: e.target.value })}
                    sx={{ flex: 1 }}
                    helperText=" "
                  />
                  <ColorPicker
                    compact
                    value={opt.color || "#1976d2"}
                    onChange={(c) => updateOption(idx, { color: c })}
                  />
                  <IconButton size="small" onClick={() => promptRemoveOption(idx)}>
                    <MaterialSymbol icon="close" size={18} />
                  </IconButton>
                </Box>
                {deleteOptConfirm?.idx === idx && (
                  <Alert
                    severity={deleteOptConfirm.cardCount === null ? "info" : deleteOptConfirm.cardCount > 0 ? "warning" : "info"}
                    sx={{ mb: 1, py: 0.5 }}
                    action={
                      <Box sx={{ display: "flex", gap: 0.5 }}>
                        <Button size="small" color="inherit" onClick={() => setDeleteOptConfirm(null)}>
                          Cancel
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          disabled={deleteOptConfirm.cardCount === null}
                          onClick={() => removeOption(idx)}
                        >
                          Remove
                        </Button>
                      </Box>
                    }
                  >
                    {deleteOptConfirm.cardCount === null
                      ? "Checking usage..."
                      : deleteOptConfirm.cardCount > 0
                        ? `"${deleteOptConfirm.optionLabel}" is used by ${deleteOptConfirm.cardCount} card(s). Their value will be cleared on save.`
                        : `No cards use "${deleteOptConfirm.optionLabel}". Safe to remove.`}
                  </Alert>
                )}
              </Box>
            ))}
            <Button
              size="small"
              startIcon={<MaterialSymbol icon="add" size={16} />}
              onClick={addOption}
            >
              Add Option
            </Button>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => onSave(field)}
          disabled={!field.key || !field.label || (!initial.key && !isValidKey(field.key)) || (isSelect && (field.options || []).some((o) => o.key && !isValidKey(o.key) && !originalOptionKeys.has(o.key)))}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
