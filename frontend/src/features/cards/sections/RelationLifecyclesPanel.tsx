import { Fragment, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import { api, isAbortError } from "@/api/client";
import ClickableCardName from "@/components/ClickableCardName";
import HelpTip from "@/components/HelpTip";
import LifecyclePhaseBar from "@/components/LifecyclePhaseBar";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useAbortableEffect } from "@/hooks/useLatestRequest";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useRelationLabel } from "@/hooks/useResolveLabel";
import { axisPct, axisTicks, fitAxis } from "@/lib/lifecycleBar";
import { getPhaseLabels, type LifecyclePhase } from "@/lib/lifecyclePhases";
import { hasLifecycleDates, todayLifecycleMs } from "@/lib/relationLifecycle";
import { sideKey } from "@/lib/relationSort";
import { STATUS_COLORS } from "@/theme/tokens";
import type { Relation } from "@/types";
import { RelationLifecyclePopover, RelationPhaseChip } from "./RelationLifecycleControls";
import {
  RELATION_LIFECYCLE_CAP,
  groupRelationLifecycles,
  stateCounts,
  visibleGroups,
} from "./relationLifecycleRows";

/** Row heights, shared by the name column and the timeline so rows line up. */
const AXIS_H = 20;
const CARD_ROW_H = 28;
const HEAD_H = 22;
const ROW_H = 44;
/** The dense bar's own row; centred in a relation row. */
const BAR_H = 28;

export interface RelationLifecyclesPanelProps {
  cardId: string;
  cardTypeKey: string;
  /** The card's own lifecycle, drawn as the "This card" reference bar. */
  cardLifecycle: Record<string, string> | undefined;
  /** Offers the clock that edits a relation's dates (with the type's Track lifecycle switch). */
  canManageRelations: boolean;
  /** A new value reloads the relations (another section changed them). */
  refreshKey?: number;
  /** A relation's dates were saved here. */
  onChanged?: () => void;
}

/**
 * The card's dated relations on one time axis, inside the Lifecycle section:
 * a "This card" reference bar, then one block per relation-type side headed
 * by its verb, each row the other card with its phase chip and a slim phase
 * bar, and one dashed Today line across all of them. Ended relations sit
 * behind a toggle, long lists behind "Show all".
 *
 * Renders nothing while loading, on a failed load, or when no relation of the
 * card carries dates — the section then reads exactly as before.
 */
export default function RelationLifecyclesPanel({
  cardId,
  cardTypeKey,
  cardLifecycle,
  canManageRelations,
  refreshKey = 0,
  onChanged,
}: RelationLifecyclesPanelProps) {
  const { t, i18n } = useTranslation(["cards", "common"]);
  const theme = useTheme();
  const { types, relationTypes } = useMetamodel();
  const relationLabel = useRelationLabel();
  const { formatDate } = useDateFormat();
  const [relations, setRelations] = useState<Relation[] | null>(null);
  const [showEnded, setShowEnded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<{ relation: Relation; anchor: HTMLElement } | null>(
    null,
  );

  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      try {
        const rows = await api.get<Relation[]>(`/relations?card_id=${cardId}`, { signal });
        if (!isCurrent()) return;
        setRelations(rows);
      } catch (e) {
        if (!isCurrent() || isAbortError(e)) return;
        setRelations(null);
      }
    },
    [cardId, refreshKey],
  );

  // Read once per render, so every row classifies against one day.
  const todayMs = todayLifecycleMs();
  const groups = useMemo(
    () =>
      groupRelationLifecycles({
        relations: relations ?? [],
        relationTypes,
        cardId,
        cardTypeKey,
        cardLifecycle,
        todayMs,
        locale: i18n.language,
      }),
    [relations, relationTypes, cardId, cardTypeKey, cardLifecycle, todayMs, i18n.language],
  );

  if (groups.length === 0) return null;

  const counts = stateCounts(groups);
  const shown = visibleGroups(groups, { showEnded, showAll });
  // Every dated relation sets the axis, shown or not, so a toggle never rescales.
  const axis = fitAxis(
    [cardLifecycle, ...groups.flatMap((g) => g.rows.map((r) => r.relation.lifecycle))],
    todayMs,
  );
  const ticks = axisTicks(axis, 6);
  const todayPct = axisPct(todayMs, axis);
  const phaseLabels = getPhaseLabels(t);
  const phaseLabel = (p: LifecyclePhase) => phaseLabels[p];
  const fmt = (iso: string | undefined) => (iso ? formatDate(iso) : "—");
  const typeColor = (key: string | undefined) => types.find((tp) => tp.key === key)?.color;
  const ownDated = hasLifecycleDates(cardLifecycle);
  const thisCard = t("lifecycle.relations.thisCard");
  const countChips = (["inEffect", "planned", "ended"] as const).filter((k) => counts[k] > 0);

  return (
    <Box
      data-testid="relation-lifecycles"
      sx={{ mt: 2, pt: 1.5, borderTop: 1, borderColor: "divider" }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap", mb: 1 }}>
        <Typography variant="subtitle2" fontWeight={600}>
          {t("lifecycle.relations.title")}
        </Typography>
        <HelpTip text={t("lifecycle.relations.help")} />
        <Box sx={{ flex: 1 }} />
        {countChips.map((k) => (
          <Chip
            key={k}
            size="small"
            variant="outlined"
            label={t(`lifecycle.relations.${k}`, { count: counts[k] })}
            sx={{ height: 20, fontSize: "0.7rem" }}
          />
        ))}
      </Box>

      <Box sx={{ display: "flex" }}>
        {/* Names */}
        <Box sx={{ width: "42%", minWidth: 120, maxWidth: 260, flexShrink: 0, pr: 1 }}>
          <Box sx={{ height: AXIS_H }} />
          <Box sx={{ height: CARD_ROW_H, display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
            <Typography variant="caption" fontWeight={600} noWrap>
              {thisCard}
            </Typography>
            {!ownDated && (
              <Typography variant="caption" color="text.secondary" noWrap>
                {t("lifecycle.relations.noOwnDates")}
              </Typography>
            )}
          </Box>
          {shown.groups.map((g) => (
            <Fragment key={sideKey(g.rt, g.isSource)}>
              <Box
                data-relation-group
                sx={{ height: HEAD_H, display: "flex", alignItems: "flex-end", minWidth: 0 }}
              >
                <Typography variant="caption" color="text.secondary" fontWeight={600} noWrap>
                  {relationLabel(g.rt, !g.isSource)}
                </Typography>
              </Box>
              {g.rows.map((row) => (
                <Box
                  key={row.relation.id}
                  data-relation-lifecycle-row
                  sx={{
                    height: ROW_H,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    minWidth: 0,
                    opacity: row.state === "ended" ? 0.6 : 1,
                  }}
                >
                  <Box
                    sx={{
                      minWidth: 0,
                      overflow: "hidden",
                      "& .MuiListItemText-root": { m: 0, minWidth: 0 },
                      "& .MuiListItemText-primary": {
                        fontSize: "0.82rem",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      },
                    }}
                  >
                    <ClickableCardName
                      name={row.other?.name ?? t("relations.unknown")}
                      to={row.other ? `/cards/${row.other.id}` : undefined}
                      dotColor={typeColor(row.other?.type)}
                    />
                  </Box>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
                    <RelationPhaseChip lifecycle={row.relation.lifecycle} todayMs={todayMs} />
                    {row.outlasts && row.state !== "ended" && (
                      <Tooltip
                        title={t("lifecycle.relations.outlastsCard", {
                          date: fmt(cardLifecycle?.endOfLife),
                        })}
                      >
                        <Box
                          component="span"
                          role="img"
                          aria-label={t("lifecycle.relations.outlastsCard", {
                            date: fmt(cardLifecycle?.endOfLife),
                          })}
                          sx={{ display: "inline-flex" }}
                        >
                          <MaterialSymbol icon="warning" size={14} color={theme.palette.warning.main} />
                        </Box>
                      </Tooltip>
                    )}
                    {g.rt.lifecycle_enabled && canManageRelations && (
                      <Tooltip title={t("relations.lifecycle.editDates")}>
                        <IconButton
                          size="small"
                          aria-label={t("relations.lifecycle.editDates")}
                          onClick={(e) => setEditing({ relation: row.relation, anchor: e.currentTarget })}
                          sx={{ p: 0.25, color: "primary.main" }}
                        >
                          <MaterialSymbol icon="schedule" size={16} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                </Box>
              ))}
            </Fragment>
          ))}
        </Box>

        {/* Timeline */}
        <Box data-testid="relation-lifecycles-timeline" sx={{ flex: 1, minWidth: 0, position: "relative" }}>
          <Box sx={{ position: "relative", height: AXIS_H, borderBottom: 1, borderColor: "divider" }}>
            {ticks.map((tick) => (
              <Typography
                key={tick.label}
                variant="caption"
                sx={{
                  position: "absolute",
                  left: `${tick.pct}%`,
                  transform: "translateX(-50%)",
                  fontSize: "0.65rem",
                  color: "text.secondary",
                }}
              >
                {tick.label}
              </Typography>
            ))}
          </Box>
          <Box sx={{ position: "relative", height: CARD_ROW_H }}>
            <LifecyclePhaseBar
              dense
              lifecycle={cardLifecycle}
              axis={axis}
              phaseLabel={phaseLabel}
              formatDate={fmt}
              titlePrefix={thisCard}
            />
          </Box>
          {shown.groups.map((g) => (
            <Fragment key={sideKey(g.rt, g.isSource)}>
              <Box sx={{ height: HEAD_H }} />
              {g.rows.map((row) => (
                <Box
                  key={row.relation.id}
                  sx={{
                    position: "relative",
                    height: ROW_H,
                    opacity: row.state === "ended" ? 0.5 : 1,
                  }}
                >
                  <Box sx={{ position: "absolute", top: (ROW_H - BAR_H) / 2, left: 0, right: 0, height: BAR_H }}>
                    <LifecyclePhaseBar
                      dense
                      lifecycle={row.relation.lifecycle}
                      axis={axis}
                      phaseLabel={phaseLabel}
                      formatDate={fmt}
                      titlePrefix={row.other?.name ?? t("relations.unknown")}
                    />
                  </Box>
                </Box>
              ))}
            </Fragment>
          ))}
          <Box sx={{ position: "relative", height: 16 }}>
            <Typography
              variant="caption"
              sx={{
                position: "absolute",
                left: `${todayPct}%`,
                transform: "translateX(-50%)",
                fontSize: "0.65rem",
                color: STATUS_COLORS.error,
                whiteSpace: "nowrap",
              }}
            >
              {t("lifecycle.relations.today")}
            </Typography>
          </Box>
          {/* One Today line across every row (the UTC day, as the server counts). */}
          <Box
            data-testid="relation-lifecycles-today"
            sx={{
              position: "absolute",
              left: `${todayPct}%`,
              top: 0,
              bottom: 16,
              width: 0,
              borderLeft: `2px dashed ${STATUS_COLORS.error}`,
              pointerEvents: "none",
              zIndex: 1,
            }}
          />
        </Box>
      </Box>

      {(counts.ended > 0 || shown.hidden > 0 || showAll) && (
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: 0.5 }}>
          {counts.ended > 0 && (
            <Button
              size="small"
              color="inherit"
              onClick={() => setShowEnded((v) => !v)}
              startIcon={<MaterialSymbol icon={showEnded ? "expand_less" : "expand_more"} size={16} />}
              sx={{ color: "text.secondary" }}
            >
              {showEnded ? t("relations.hideEnded") : t("relations.showEnded", { count: counts.ended })}
            </Button>
          )}
          {shown.hidden > 0 && (
            <Button size="small" onClick={() => setShowAll(true)}>
              {t("lifecycle.relations.showAll", { count: shown.shownTotal })}
            </Button>
          )}
          {showAll && shown.shownTotal > RELATION_LIFECYCLE_CAP && (
            <Button size="small" onClick={() => setShowAll(false)}>
              {t("lifecycle.relations.showFewer")}
            </Button>
          )}
        </Box>
      )}

      {editing && (
        <RelationLifecyclePopover
          anchorEl={editing.anchor}
          open
          onClose={() => setEditing(null)}
          relation={editing.relation}
          onSaved={(updated) => {
            // Overlay only what the PATCH changed: its `source` / `target` may
            // come back null or shallower than the list's, which would blank
            // the other card's name and link (as RelationsSection notes).
            setRelations((prev) =>
              prev
                ? prev.map((r) =>
                    r.id === updated.id ? { ...r, lifecycle: updated.lifecycle ?? r.lifecycle } : r,
                  )
                : prev,
            );
            onChanged?.();
          }}
        />
      )}
    </Box>
  );
}
