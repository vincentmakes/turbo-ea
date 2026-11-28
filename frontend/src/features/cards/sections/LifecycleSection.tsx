import { useState, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import HelpTip from "@/components/HelpTip";
import { useLifecyclePhaseHelp } from "@/hooks/useLifecyclePhaseHelp";
import { PHASE_ICONS } from "@/components/LifecycleBadge";
import { PHASES, getPhaseLabels } from "@/lib/lifecyclePhases";
import { useDateFormat } from "@/hooks/useDateFormat";
import { todayIsoDate } from "@/lib/dates";
import { useSyncedExpanded } from "@/hooks/useSyncedExpanded";
import { focusFirstControl, useEditRequest } from "@/hooks/useEditRequest";
import {
  SECTION_SCROLL_MARGIN,
  sectionAnchor,
  type SectionEditRequest,
} from "@/features/cards/dataQualityJump";
import type { Card } from "@/types";
import { LIFECYCLE_PHASE_COLORS } from "@/theme/tokens";
import { useLifecycleOrderWarning } from "@/hooks/useLifecycleOrderWarning";
import LifecycleDateFields, {
  MaintainedPhaseChip,
  type PhaseAnnotation,
} from "./LifecycleDateFields";
import {
  lifecyclePayload,
  maintainedRefusal,
  type MaintainedLifecycle,
} from "./lifecycleMaintained";

// ── Section: Lifecycle ──────────────────────────────────────────
function LifecycleSection({
  card,
  onSave,
  canEdit = true,
  initialExpanded = true,
  onDirtyChange,
  onEditingChange,
  phaseAnnotation,
  expandOn,
  editOn,
  footer,
  maintained,
}: {
  card: Card;
  onSave: (u: Record<string, unknown>) => Promise<void>;
  canEdit?: boolean;
  initialExpanded?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * Notified when edit mode opens (`true`) and closes (`false`), whether or
   * not anything was typed. Card detail holds a live re-read while any
   * section is editing: replacing the card under an untouched form would make
   * its draft differ from the card and arm the leave guard.
   */
  onEditingChange?: (editing: boolean) => void;
  /**
   * Optional per-phase annotation. A caller that knows something this
   * component cannot — that a date differs from a stored baseline, say —
   * marks the phase and hangs its own control under it. Deliberately generic:
   * the component renders what it is given and knows nothing about why.
   */
  phaseAnnotation?: (phase: string) => PhaseAnnotation | null | undefined;
  /** A new value expands the section (a data-quality jump). */
  expandOn?: number;
  /** A data-quality jump: open in edit mode, on the first undated phase. */
  editOn?: SectionEditRequest;
  /**
   * Rendered at the end of the section, and only while it is expanded — so a
   * footer that loads its own data loads it only once the section is open.
   * Card detail puts the card's relation lifecycles here; the section itself
   * stays props-driven and fetches nothing.
   */
  footer?: ReactNode;
  /**
   * Phases an installed extension maintains, and its display name. Those
   * phases show a chip and are not editable; the save keeps them at their
   * stored values. Omitted or null, the section behaves exactly as before.
   */
  maintained?: MaintainedLifecycle | null;
}) {
  const { t } = useTranslation(["cards", "common"]);
  const theme = useTheme();
  const { formatDate } = useDateFormat();
  const phaseLabels = getPhaseLabels(t);
  const { phaseHelp } = useLifecyclePhaseHelp();
  const [expanded, setExpanded] = useSyncedExpanded(initialExpanded, expandOn);
  const [editing, setEditing] = useState(false);
  const [lifecycle, setLifecycle] = useState<Record<string, string>>(
    card.lifecycle || {}
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Keyed on the phase list's content, so a new card object with the same
  // lock (every save replaces it) keeps one Set identity.
  const lockedKey = (maintained?.phases ?? []).join("|");
  const lockedPhases = useMemo(
    () =>
      new Set(
        lockedKey.split("|").filter((p) => (PHASES as readonly string[]).includes(p)),
      ),
    [lockedKey],
  );
  const allLocked = PHASES.every((p) => lockedPhases.has(p));
  const editable = canEdit && !allLocked;

  // A data-quality jump opens the edit row, then focuses the first phase still
  // without a date once that row has rendered.
  const [focusPending, setFocusPending] = useState(false);
  useEditRequest(editOn, editable, () => {
    setEditing(true);
    setFocusPending(true);
  });
  useLayoutEffect(() => {
    if (!editing || !focusPending) return;
    const phase = PHASES.find((p) => !lifecycle[p] && !lockedPhases.has(p));
    if (phase) focusFirstControl(rootRef.current?.querySelector(`[data-phase="${phase}"]`));
    setFocusPending(false);
  }, [editing, focusPending, lifecycle, lockedPhases]);

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

  // Report edit mode (not dirtiness) so card detail can hold a live re-read.
  useEffect(() => {
    onEditingChange?.(editing);
    return () => onEditingChange?.(false);
  }, [editing, onEditingChange]);

  // Advisory only: a phase dated after one that should follow it is flagged,
  // never refused — real lifecycles do slip, and the save stays the user's call.
  const orderWarning = useLifecycleOrderWarning(lifecycle);

  const save = async () => {
    setSaveError(null);
    try {
      await onSave({ lifecycle: lifecyclePayload(lifecycle, lockedPhases) });
      setEditing(false);
    } catch (err) {
      // A refused maintained phase is worded here, in the UI language; any
      // other error shows the server's own text.
      const refusal = maintainedRefusal(err);
      setSaveError(
        refusal
          ? t("lifecycle.maintained.refused", {
              name: refusal.extension,
              phases: refusal.phases.map((p) => phaseLabels[p] ?? p).join(", "),
            })
          : err instanceof Error
            ? err.message
            : String(err),
      );
    }
  };

  return (
    <Accordion
      ref={rootRef}
      id={sectionAnchor("lifecycle")}
      expanded={expanded}
      onChange={(_, v) => setExpanded(v)}
      disableGutters
      sx={{ scrollMarginTop: SECTION_SCROLL_MARGIN }}
    >
      <AccordionSummary
        // A div, not the default <button>: the summary holds the edit icon
        // button, and a button may not contain a button.
        // ButtonBase keeps role="button", tabindex and Enter/Space.
        component="div"
        expandIcon={<MaterialSymbol icon="expand_more" size={20} />}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1 }}>
          <MaterialSymbol icon="timeline" size={20} />
          <Typography fontWeight={600}>{t("lifecycle.title")}</Typography>
        </Box>
        {!editing && editable && (
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
        <Box
          sx={{
            position: "relative",
            px: 1,
            pt: 3,
            pb: 1,
            mb: 2,
            // The track / fill / dots below stack 0 - 1 - 2 against each other and
            // nothing else. `position: relative` alone does not contain them, so
            // without this they resolve against whatever ancestor stacking context
            // happens to exist and out-paint it -- the card side panel's sticky
            // header (zIndex 1) lost to the dots at 2 and to the fill at 1 on DOM
            // order. `isolation` contains them without altering paint order the
            // way a `zIndex` here would.
            isolation: "isolate",
          }}
        >
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
            const now = todayIsoDate();
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
              gradient = LIFECYCLE_PHASE_COLORS[PHASES[0]];
            } else {
              const stops = PHASES.slice(0, currentIdx + 1)
                .map((phase, i) => {
                  const pct = (i / currentIdx) * 100;
                  return `${LIFECYCLE_PHASE_COLORS[phase]} ${pct.toFixed(2)}%`;
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
              const now = todayIsoDate();
              const isPast =
                i < PHASES.length - 1 &&
                PHASES.slice(i + 1).some(
                  (p) => lifecycle[p] && lifecycle[p]! <= now,
                );
              const isCurrent = !!date && date <= now && !isPast;
              const isReached = isCurrent || isPast;
              const phaseColor = LIFECYCLE_PHASE_COLORS[phase];
              const dotBg = isReached ? phaseColor : theme.palette.background.paper;
              const dotBorder = isReached
                ? phaseColor
                : theme.palette.action.disabled;
              const iconColor = isReached
                ? theme.palette.common.white
                : theme.palette.text.disabled;
              const annotation = phaseAnnotation?.(phase);
              const warning = orderWarning(phase);
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
                    <HelpTip text={phaseHelp(phase)} size={12} />
                  </Typography>
                  <Typography
                    variant="caption"
                    color={annotation?.highlighted ? "primary.main" : "text.secondary"}
                    sx={{
                      fontSize: "0.7rem",
                      fontWeight: annotation?.highlighted ? 700 : undefined,
                    }}
                  >
                    {date ? formatDate(date) : "—"}
                  </Typography>
                  {warning && (
                    <Tooltip title={warning}>
                      <Box
                        component="span"
                        role="img"
                        aria-label={warning}
                        sx={{ display: "inline-flex", ml: 0.5, verticalAlign: "middle" }}
                      >
                        <MaterialSymbol icon="warning" size={14} color={theme.palette.warning.main} />
                      </Box>
                    </Tooltip>
                  )}
                  {lockedPhases.has(phase) && (
                    <Box>
                      <MaintainedPhaseChip phase={phase} name={maintained?.name ?? ""} />
                    </Box>
                  )}
                  {annotation?.note}
                </Box>
              );
            })}
          </Box>
        </Box>
        {allLocked && canEdit && (
          <Typography
            variant="caption"
            color="text.secondary"
            display="block"
            data-testid="lifecycle-all-maintained"
            sx={{ mb: 1 }}
          >
            {t("lifecycle.maintained.allLocked", { name: maintained?.name ?? "" })}
          </Typography>
        )}
        {editing && (
          <Box>
            <LifecycleDateFields
              lifecycle={lifecycle}
              onChange={setLifecycle}
              phaseAnnotation={phaseAnnotation}
              lockedPhases={[...lockedPhases]}
              lockedBy={maintained?.name ?? ""}
            />
            {saveError && (
              <Alert severity="error" sx={{ mb: 1 }} onClose={() => setSaveError(null)}>
                {saveError}
              </Alert>
            )}
            <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
              <Button
                size="small"
                onClick={() => {
                  setLifecycle(card.lifecycle || {});
                  setSaveError(null);
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
        {expanded && footer}
      </AccordionDetails>
    </Accordion>
  );
}

export default LifecycleSection;
