import { useState, useEffect } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import { useTheme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import { PHASES, PHASE_LABELS } from "@/features/cards/sections/cardDetailUtils";
import type { Card } from "@/types";

// ── Section: Lifecycle ──────────────────────────────────────────
function LifecycleSection({
  card,
  onSave,
  canEdit = true,
  initialExpanded = true,
}: {
  card: Card;
  onSave: (u: Record<string, unknown>) => Promise<void>;
  canEdit?: boolean;
  initialExpanded?: boolean;
}) {
  const theme = useTheme();
  const [editing, setEditing] = useState(false);
  const [lifecycle, setLifecycle] = useState<Record<string, string>>(
    card.lifecycle || {}
  );

  useEffect(() => {
    setLifecycle(card.lifecycle || {});
  }, [card.lifecycle]);

  const save = async () => {
    await onSave({ lifecycle });
    setEditing(false);
  };

  return (
    <Accordion defaultExpanded={initialExpanded} disableGutters>
      <AccordionSummary expandIcon={<MaterialSymbol icon="expand_more" size={20} />}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1 }}>
          <MaterialSymbol icon="timeline" size={20} />
          <Typography fontWeight={600}>Lifecycle</Typography>
        </Box>
        {!editing && canEdit && (
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
          >
            <MaterialSymbol icon="edit" size={16} />
          </IconButton>
        )}
      </AccordionSummary>
      <AccordionDetails>
        {/* Timeline visualization */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 0, mb: 2 }}>
          {PHASES.map((phase, i) => {
            const date = lifecycle[phase];
            const now = new Date().toISOString().slice(0, 10);
            const isCurrent = date && date <= now;
            const isPast =
              i < PHASES.length - 1 &&
              PHASES.slice(i + 1).some((p) => lifecycle[p] && lifecycle[p]! <= now);
            return (
              <Box
                key={phase}
                sx={{
                  flex: 1,
                  textAlign: "center",
                  position: "relative",
                }}
              >
                <Box
                  sx={{
                    height: 4,
                    bgcolor: isPast || isCurrent ? "#1976d2" : theme.palette.action.disabled,
                    borderRadius: i === 0 ? "2px 0 0 2px" : i === 4 ? "0 2px 2px 0" : 0,
                  }}
                />
                <Box
                  sx={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    bgcolor: isCurrent && !isPast ? "#1976d2" : isPast ? "#1976d2" : theme.palette.action.disabled,
                    border: isCurrent && !isPast ? "2px solid #0d47a1" : "none",
                    position: "absolute",
                    top: -4,
                    left: "50%",
                    transform: "translateX(-50%)",
                  }}
                />
                <Typography
                  variant="caption"
                  display="block"
                  sx={{
                    mt: 1.5,
                    fontWeight: isCurrent && !isPast ? 700 : 400,
                    color: isCurrent || isPast ? "text.primary" : "text.secondary",
                  }}
                >
                  {PHASE_LABELS[phase]}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {date || "—"}
                </Typography>
              </Box>
            );
          })}
        </Box>
        {editing && (
          <Box>
            <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", mb: 2 }}>
              {PHASES.map((phase) => (
                <TextField
                  key={phase}
                  label={PHASE_LABELS[phase]}
                  type="date"
                  size="small"
                  value={lifecycle[phase] || ""}
                  onChange={(e) =>
                    setLifecycle({ ...lifecycle, [phase]: e.target.value })
                  }
                  InputLabelProps={{ shrink: true }}
                  sx={{ width: 170 }}
                />
              ))}
            </Box>
            <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
              <Button
                size="small"
                onClick={() => {
                  setLifecycle(card.lifecycle || {});
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
              <Button size="small" variant="contained" onClick={save}>
                Save
              </Button>
            </Box>
          </Box>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

export default LifecycleSection;
