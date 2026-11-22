import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { api, ApiError } from "@/api/client";
import ColorPicker from "@/components/ColorPicker";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { CardType, LifecycleStage } from "@/types";
import { DEFAULT_OPTION_COLOR } from "./constants";

interface Props {
  open: boolean;
  cardType: CardType;
  onClose: () => void;
  onSaved: () => void;
}

type StageRow = LifecycleStage & { persisted: boolean };
const validStageKey = (key: string) => key.length <= 50 && /^[A-Za-z][A-Za-z0-9_]*$/.test(key);

export default function LifecycleStagesDialog({ open, cardType, onClose, onSaved }: Props) {
  const { t } = useTranslation(["admin", "common", "validation"]);
  const [stages, setStages] = useState<StageRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setStages((cardType.lifecycle_stages ?? []).map((stage) => ({ ...stage, persisted: true })));
      setError("");
    }
  }, [open, cardType]);

  const updateStage = (index: number, update: Partial<LifecycleStage>) => {
    setStages((previous) => previous.map((stage, i) => i === index ? { ...stage, ...update } : stage));
  };
  const move = (index: number, direction: number) => {
    setStages((previous) => {
      const next = [...previous];
      [next[index], next[index + direction]] = [next[index + direction], next[index]];
      return next;
    });
  };
  const keys = stages.map((stage) => stage.key);
  const invalid = stages.some((stage) => !validStageKey(stage.key) || !stage.label.trim() || Array.from(stage.label).length > 200)
    || new Set(keys).size !== keys.length;

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await api.put(`/metamodel/types/${encodeURIComponent(cardType.key)}/lifecycle-stages`, {
        stages: stages.map(({ persisted: _persisted, ...stage }) => ({ ...stage, label: stage.label.trim() })),
      });
      onSaved();
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setError(t("metamodel.lifecycleStages.inUse"));
      } else {
        setError(caught instanceof Error ? caught.message : t("metamodel.lifecycleStages.saveFailed"));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="md" fullWidth disableRestoreFocus>
      <DialogTitle>{t("metamodel.lifecycleStages.title")}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("metamodel.lifecycleStages.help")}
        </Typography>
        {stages.map((stage, index) => (
          <Box key={index} sx={{ display: "flex", gap: 1, mb: 1, alignItems: "flex-start", flexWrap: "wrap" }}>
            <TextField
              size="small"
              label={t("metamodel.fieldEditor.optionKeyLabel")}
              value={stage.key}
              onChange={(event) => updateStage(index, { key: event.target.value })}
              disabled={saving || stage.persisted}
              error={!!stage.key && !validStageKey(stage.key)}
              helperText={stage.persisted ? t("metamodel.lifecycleStages.keyLocked") : t("metamodel.lifecycleStages.keyHint")}
              slotProps={{ htmlInput: { maxLength: 50 } }}
              required
            />
            <TextField
              size="small"
              label={t("metamodel.fieldEditor.optionLabelLabel")}
              value={stage.label}
              onChange={(event) => updateStage(index, { label: event.target.value })}
              disabled={saving}
              required
            />
            <ColorPicker compact value={stage.color} disabled={saving} onChange={(color) => updateStage(index, { color })} />
            <IconButton aria-label={t("metamodel.lifecycleStages.moveUp")} disabled={saving || index === 0} onClick={() => move(index, -1)}>
              <MaterialSymbol icon="arrow_upward" size={18} />
            </IconButton>
            <IconButton aria-label={t("metamodel.lifecycleStages.moveDown")} disabled={saving || index === stages.length - 1} onClick={() => move(index, 1)}>
              <MaterialSymbol icon="arrow_downward" size={18} />
            </IconButton>
            <IconButton aria-label={t("common:actions.delete")} disabled={saving} onClick={() => setStages((previous) => previous.filter((_, i) => i !== index))}>
              <MaterialSymbol icon="close" size={18} />
            </IconButton>
          </Box>
        ))}
        <Button size="small" disabled={saving || stages.length >= 50} onClick={() => setStages((previous) => [...previous, { key: "", label: "", color: DEFAULT_OPTION_COLOR, persisted: false }])}>
          {t("metamodel.lifecycleStages.add")}
        </Button>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>{t("common:actions.cancel")}</Button>
        <Button variant="contained" onClick={save} disabled={saving || invalid}>{t("common:actions.save")}</Button>
      </DialogActions>
    </Dialog>
  );
}
