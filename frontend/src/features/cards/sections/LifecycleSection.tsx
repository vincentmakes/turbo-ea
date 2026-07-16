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
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { PHASE_ICONS } from "@/components/LifecycleBadge";
import { PHASES, getPhaseLabels } from "@/features/cards/sections/cardDetailUtils";
import { useDateFormat } from "@/hooks/useDateFormat";
import type { Card } from "@/types";

const PHASE_PALETTE: Record<string, string> = {
  plan: "#9e9e9e",
  phaseIn: "#1976d2",
  active: "#2e7d32",
  phaseOut: "#ed6c02",
  endOfLife: "#c62828",
};

// ── Section: Lifecycle ──────────────────────────────────────────
function LifecycleSection({
  card,
  onSave,
  canEdit = true,
  initialExpanded = true,
  onDirtyChange,
}: {
  card: Card;
  onSave: (u: Record<string, unknown>) => Promise<void>;
  canEdit?: boolean;
  initialExpanded?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation(["cards", "common"]);
  const theme = useTheme();
  const { formatDate } = useDateFormat();
  const phaseLabels = getPhaseLabels(t);
  const [editing, setEditing] = useState(false);
  const [lifecycle, setLifecycle] = useState<Record<string, string>>(
    card.lifecycle || {}
  );

  // Re-sync the draft from the card prop only while NOT editing, so saving
  // another section (which replaces the whole card object in the parent) can't
  // clobber this section's in-progress draft (issue #843).
  useEffect(() => {
    if (!editing) setLifecycle(card.lifecycle || {});
  }, [card.lifecycle, editing]);

  // Report unsaved-changes state up so the page can warn on navigation (#843).
  const dirty =
    editing &&
    JSON.stringify(lifecycle) !== JSON.stringify(card.lifecycle || {});
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  const save = async () => {
    await onSave({ lifecycle });
    setEditing(false);
  };

  return (
    <Accordion defaultExpanded={initialExpanded} disableGutters>
      <AccordionSummary expandIcon={<MaterialSymbol icon="expand_more" size={20} />}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1 }}>
          <MaterialSymbol icon="timeline" size={20} />
          <Typography fontWeight={600}>{t("lifecycle.title")}</Typography>
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
        <Box sx={{ position: "relative", px: 1, pt: 3, pb: 1, mb: 2 }}>
          {/* Connecting track behind the dots */}
          <Box
            sx={{
              position: "absolute",
              left: `calc(${100 / (PHASES.length * 2)}% + 8px)`,
              right: `calc(${100 / (PHASES.length * 2)}% + 8px)`,
              top: 36,
              height: 6,
              borderRadius: 3,
              bgcolor: theme.palette.action.hover,
              zIndex: 0,
            }}
          />
          {(() => {
            const now = new Date().toISOString().slice(0, 10);
            // Determine current phase index (latest phase whose date has passed)
            let currentIdx = -1;
            for (let i = PHASES.length - 1; i >= 0; i--) {
              const d = lifecycle[PHASES[i]];
              if (d && d <= now) {
                currentIdx = i;
                break;
              }
            }
            if (currentIdx < 0) return null;
            // Progress fill goes from start dot to the current dot, stopping
            // at each reached phase color so the gradient walks through every
            // phase the card has been through (e.g. grey → blue → green → orange).
            const fillLeftPct = 100 / (PHASES.length * 2);
            const fillRightPct =
              100 - ((currentIdx * 2 + 1) * 100) / (PHASES.length * 2);
            let gradient: string;
            if (currentIdx === 0) {
              // Single phase reached — fill is zero-width, just render the colour.
              gradient = PHASE_PALETTE[PHASES[0]];
            } else {
              const stops = PHASES.slice(0, currentIdx + 1)
                .map((phase, i) => {
                  const pct = (i / currentIdx) * 100;
                  return `${PHASE_PALETTE[phase]} ${pct.toFixed(2)}%`;
                })
                .join(", ");
              gradient = `linear-gradient(90deg, ${stops})`;
            }
            return (
              <Box
                sx={{
                  position: "absolute",
                  left: `calc(${fillLeftPct}% + 8px)`,
                  right: `calc(${fillRightPct}% + 8px)`,
                  top: 36,
                  height: 6,
                  borderRadius: 3,
                  background: gradient,
                  zIndex: 1,
                  transition: "all 0.3s ease",
                }}
              />
            );
          })()}
          <Box
            sx={{
              display: "flex",
              alignItems: "flex-start",
              position: "relative",
              zIndex: 2,
            }}
          >
            {PHASES.map((phase, i) => {
              const date = lifecycle[phase];
              const now = new Date().toISOString().slice(0, 10);
              const isPast =
                i < PHASES.length - 1 &&
                PHASES.slice(i + 1).some(
                  (p) => lifecycle[p] && lifecycle[p]! <= now,
                );
              const isCurrent = !!date && date <= now && !isPast;
              const isReached = isCurrent || isPast;
              const phaseColor = PHASE_PALETTE[phase];
              const dotBg = isReached ? phaseColor : theme.palette.background.paper;
              const dotBorder = isReached
                ? phaseColor
                : theme.palette.action.disabled;
              const iconColor = isReached
                ? "#fff"
                : theme.palette.text.disabled;
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
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      bgcolor: dotBg,
                      border: `2px solid ${dotBorder}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      mx: "auto",
                      boxShadow: isCurrent
                        ? `0 0 0 4px ${phaseColor}33`
                        : "none",
                      transition: "all 0.2s ease",
                    }}
                  >
                    <MaterialSymbol
                      icon={PHASE_ICONS[phase] || "circle"}
                      size={16}
                      color={iconColor}
                    />
                  </Box>
                  <Typography
                    variant="caption"
                    display="block"
                    sx={{
                      mt: 1,
                      fontWeight: isCurrent ? 700 : 500,
                      color: isReached ? "text.primary" : "text.secondary",
                      lineHeight: 1.2,
                    }}
                  >
                    {phaseLabels[phase]}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ fontSize: "0.7rem" }}
                  >
                    {date ? formatDate(date) : "—"}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        </Box>
        {editing && (
          <Box>
            <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", mb: 2 }}>
              {PHASES.map((phase) => (
                <TextField
                  key={phase}
                  label={phaseLabels[phase]}
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
                {t("common:actions.cancel")}
              </Button>
              <Button size="small" variant="contained" onClick={save}>
                {t("common:actions.save")}
              </Button>
            </Box>
          </Box>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

export default LifecycleSection;
