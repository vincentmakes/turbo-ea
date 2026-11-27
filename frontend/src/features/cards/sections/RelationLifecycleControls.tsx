import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Popover from "@mui/material/Popover";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { PHASE_ICONS, getCurrentPhase } from "@/components/LifecycleBadge";
import { api } from "@/api/client";
import { useDateFormat } from "@/hooks/useDateFormat";
import { getPhaseLabels } from "@/lib/lifecyclePhases";
import {
  cleanRelationLifecycle,
  relationPhaseNote,
  todayLifecycleMs,
} from "@/lib/relationLifecycle";
import { LIFECYCLE_PHASE_COLORS, type LifecyclePhaseColorKey } from "@/theme/tokens";
import type { Relation } from "@/types";
import LifecycleDateFields from "./LifecycleDateFields";

/**
 * The phase a relation's note is drawn in: the card lifecycle's own icon and
 * colour, so a planned relation reads like a planned card. A planned relation
 * is in Plan or Phase In (whichever date has passed — Plan when none has); one
 * with an end ahead is Active or Phase Out; an ended one is End of Life.
 */
function notePhase(
  kind: "planned" | "until" | "ended",
  lifecycle: Record<string, string> | undefined,
): LifecyclePhaseColorKey {
  if (kind === "ended") return "endOfLife";
  const current = getCurrentPhase(lifecycle);
  if (kind === "planned") return current === "phaseIn" ? "phaseIn" : "plan";
  return current === "phaseOut" ? "phaseOut" : "active";
}

/**
 * The small outlined chip a relation row carries when its dates say something:
 * "Planned · from …", "Until …" or "Ended …". An undated relation — or one in
 * effect with no end in sight — renders nothing: it is active by default.
 * Shown for a relation of ANY type that carries dates, whatever the type's
 * Track lifecycle switch says (dates arrive by import and API too).
 */
export function RelationPhaseChip({
  lifecycle,
  todayMs = todayLifecycleMs(),
}: {
  lifecycle: Record<string, string> | undefined;
  todayMs?: number;
}) {
  const { t } = useTranslation(["cards", "common"]);
  const { formatDate } = useDateFormat();
  const note = relationPhaseNote(lifecycle, todayMs);
  if (!note) return null;
  const phase = notePhase(note.kind, lifecycle);
  const color = LIFECYCLE_PHASE_COLORS[phase];
  const label =
    note.kind === "ended"
      ? t("relations.lifecycle.ended", { date: formatDate(note.date) })
      : note.kind === "until"
        ? t("relations.lifecycle.until", { date: formatDate(note.date) })
        : note.date
          ? t("relations.lifecycle.plannedFrom", { date: formatDate(note.date) })
          : t("relations.lifecycle.planned");
  return (
    <Tooltip title={getPhaseLabels(t)[phase]}>
      <Chip
        size="small"
        variant="outlined"
        data-phase={phase}
        icon={<MaterialSymbol icon={PHASE_ICONS[phase]} size={16} />}
        label={label}
        sx={{
          height: 20,
          fontSize: "0.7rem",
          borderColor: color,
          color,
          "& .MuiChip-icon": { color },
        }}
      />
    </Tooltip>
  );
}

/**
 * The clock's popover: one date field per phase, the advisory order warning
 * the card lifecycle shows, a way to clear every date, Cancel / Save. Save
 * replaces the relation's lifecycle (`{}` clears it) and hands the updated
 * row back.
 */
export function RelationLifecyclePopover({
  anchorEl,
  open,
  onClose,
  relation,
  onSaved,
  disableRestoreFocus,
}: {
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  relation: Relation;
  onSaved: (updated: Relation) => void;
  /** Set when the popover opens from inside another dialog or popover. */
  disableRestoreFocus?: boolean;
}) {
  const { t } = useTranslation(["cards", "common"]);
  const [draft, setDraft] = useState<Record<string, string>>(relation.lifecycle ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setDraft(relation.lifecycle ?? {});
      setError("");
    }
  }, [open, relation.lifecycle]);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const updated = await api.patch<Relation>(`/relations/${relation.id}`, {
        lifecycle: cleanRelationLifecycle(draft),
      });
      onSaved(updated);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setSaving(false);
    }
  };

  const hasDraftDates = Object.keys(cleanRelationLifecycle(draft)).length > 0;

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      disableRestoreFocus={disableRestoreFocus}
      slotProps={{ paper: { sx: { p: 2, maxWidth: 580 } } }}
    >
      <Typography variant="caption" fontWeight={600} sx={{ display: "block", mb: 0.5 }}>
        {t("relations.lifecycle.title")}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
        {t("relations.lifecycle.help")}
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      <LifecycleDateFields lifecycle={draft} onChange={setDraft} disabled={saving} />
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Button
          size="small"
          color="inherit"
          startIcon={<MaterialSymbol icon="event_busy" size={16} />}
          onClick={() => setDraft({})}
          disabled={saving || !hasDraftDates}
        >
          {t("relations.lifecycle.clear")}
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={onClose} disabled={saving}>
          {t("common:actions.cancel")}
        </Button>
        <Button size="small" variant="contained" onClick={handleSave} disabled={saving}>
          {t("common:actions.save")}
        </Button>
      </Box>
    </Popover>
  );
}
