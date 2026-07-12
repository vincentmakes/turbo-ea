import { useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Alert from "@mui/material/Alert";
import MaterialSymbol from "@/components/MaterialSymbol";

/**
 * Type-aware editor for a field's `config` object. Renders each entry by the
 * runtime type of its value so nothing is ever `String(obj)`-ed into a text box:
 *   boolean            → Switch
 *   number             → number field
 *   string             → text field
 *   array of scalars   → compact editable list (add / remove / reorder)
 *   object / nested    → "Edit…" opening a validated JSON editor dialog
 * `readOnly` disables every control (used for extension-owned fields, whose
 * config is re-synced from the manifest and must not appear editable).
 */

function isScalarArray(v: unknown): v is (string | number)[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string" || typeof x === "number");
}

/** Editable list for an array of scalars (strings/numbers) — the rubric-row case. */
function ScalarArrayField({
  label,
  value,
  readOnly,
  onChange,
}: {
  label: string;
  value: (string | number)[];
  readOnly?: boolean;
  onChange: (next: (string | number)[]) => void;
}) {
  const { t } = useTranslation(["admin", "common"]);
  const numeric = value.length > 0 && value.every((x) => typeof x === "number");
  const setItem = (i: number, raw: string) => {
    const next = [...value];
    next[i] = numeric ? (raw === "" ? 0 : Number(raw)) : raw;
    onChange(next);
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const add = () => onChange([...value, numeric ? 0 : ""]);

  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      {value.map((item, i) => (
        <Box key={i} sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.5 }}>
          <TextField
            size="small"
            fullWidth
            type={numeric ? "number" : "text"}
            value={item}
            disabled={readOnly}
            onChange={(e) => setItem(i, e.target.value)}
          />
          {!readOnly && (
            <>
              <IconButton size="small" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t("common:actions.moveUp")}>
                <MaterialSymbol icon="arrow_upward" size={16} />
              </IconButton>
              <IconButton size="small" onClick={() => move(i, 1)} disabled={i === value.length - 1} aria-label={t("common:actions.moveDown")}>
                <MaterialSymbol icon="arrow_downward" size={16} />
              </IconButton>
              <IconButton size="small" onClick={() => remove(i)} aria-label={t("common:actions.remove")}>
                <MaterialSymbol icon="close" size={16} />
              </IconButton>
            </>
          )}
        </Box>
      ))}
      {!readOnly && (
        <Button size="small" startIcon={<MaterialSymbol icon="add" size={16} />} onClick={add}>
          {t("metamodel.fieldEditor.addItem")}
        </Button>
      )}
    </Box>
  );
}

/** A validated JSON editor dialog for a nested object/array config value. */
function JsonEntryDialog({
  label,
  value,
  readOnly,
  onClose,
  onSave,
}: {
  label: string;
  value: unknown;
  readOnly?: boolean;
  onClose: () => void;
  onSave: (parsed: unknown) => void;
}) {
  const { t } = useTranslation(["admin", "common"]);
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    try {
      onSave(JSON.parse(text));
    } catch {
      setError(t("metamodel.fieldEditor.invalidJson"));
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth disableRestoreFocus>
      <DialogTitle>{t("metamodel.fieldEditor.jsonEditorTitle", { key: label })}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 1, mt: 1 }}>
            {error}
          </Alert>
        )}
        <TextField
          fullWidth
          multiline
          minRows={6}
          maxRows={18}
          value={text}
          disabled={readOnly}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          slotProps={{ input: { sx: { fontFamily: "monospace", fontSize: "0.8rem" } } }}
          sx={{ mt: error ? 0 : 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{readOnly ? t("common:actions.close") : t("common:actions.cancel")}</Button>
        {!readOnly && (
          <Button variant="contained" onClick={save}>
            {t("common:actions.save")}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

export default function ConfigEditor({
  config,
  onChange,
  readOnly,
}: {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  readOnly?: boolean;
}) {
  const { t } = useTranslation(["admin", "common"]);
  const [jsonKey, setJsonKey] = useState<string | null>(null);
  const setEntry = (k: string, v: unknown) => onChange({ ...config, [k]: v });

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      {Object.entries(config).map(([k, v]) => {
        if (typeof v === "boolean") {
          return (
            <FormControlLabel
              key={k}
              control={
                <Switch checked={v} disabled={readOnly} onChange={(e) => setEntry(k, e.target.checked)} />
              }
              label={k}
            />
          );
        }
        if (typeof v === "number") {
          return (
            <TextField
              key={k}
              size="small"
              type="number"
              label={k}
              value={v}
              disabled={readOnly}
              onChange={(e) => setEntry(k, e.target.value === "" ? "" : Number(e.target.value))}
            />
          );
        }
        if (typeof v === "string") {
          return (
            <TextField
              key={k}
              size="small"
              label={k}
              value={v}
              disabled={readOnly}
              onChange={(e) => setEntry(k, e.target.value)}
            />
          );
        }
        if (isScalarArray(v)) {
          return (
            <ScalarArrayField
              key={k}
              label={k}
              value={v}
              readOnly={readOnly}
              onChange={(next) => setEntry(k, next)}
            />
          );
        }
        // Object or nested/mixed array → JSON editor (never String(obj)).
        return (
          <Box key={k} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography variant="body2" sx={{ flex: 1 }}>
              {k}
            </Typography>
            <Button
              size="small"
              startIcon={<MaterialSymbol icon={readOnly ? "visibility" : "edit"} size={16} />}
              onClick={() => setJsonKey(k)}
            >
              {readOnly ? t("common:actions.view") : t("metamodel.fieldEditor.editJson")}
            </Button>
          </Box>
        );
      })}
      {jsonKey !== null && (
        <JsonEntryDialog
          label={jsonKey}
          value={config[jsonKey]}
          readOnly={readOnly}
          onClose={() => setJsonKey(null)}
          onSave={(parsed) => {
            setEntry(jsonKey, parsed);
            setJsonKey(null);
          }}
        />
      )}
    </Box>
  );
}
