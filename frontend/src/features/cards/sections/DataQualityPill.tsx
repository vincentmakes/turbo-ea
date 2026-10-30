/**
 * The data-quality pill on a card's header, and what it says about itself (#1334).
 *
 * Without `cardId` it is the plain pill: the score and a "{{value}}% data
 * quality" tooltip. With `cardId` it also explains the score: on first hover,
 * focus or click it fetches `GET /cards/{id}/data-quality` — the breakdown the
 * backend scorer computes, so it can never disagree with the stored score —
 * and then
 *
 * - the **tooltip** lists the three unmet slots that would raise the score
 *   most, each with the score the card would reach;
 * - a **click** (or Enter / Space) opens a popover with every unmet slot, the
 *   slots that already count, and — while empty required fields pin the score
 *   at 0 — which fields those are and what the score would be without them.
 *
 * The required-field list is the backend's `blocked_by_required`, never
 * recomputed here: the client's own banner (`missingRequiredFields`) also
 * exempts calculated and auto fields, which the backend gate does not.
 *
 * With `onJump`, each unmet slot in the popover is a link to where it is
 * filled (`jumpTargetFor`): a click closes the popover and hands the target to
 * the page, which opens the tab and scrolls to the section. The tooltip's rows
 * stay text — a tooltip is not interactive.
 *
 * When `value` changes (a save rescored the card) the fetched breakdown is
 * dropped, so the next hover fetches the fresh one.
 *
 * With `animate` (gamified data quality, an admin toggle) the fill is the
 * shared `ScoreBar` and the figure counts up; a `gain` pops the pill, pulses a
 * ring in the new band colour when the score changed band, and plays a
 * `ScoreGainBurst` over it. Without `animate` the pill is exactly the plain one.
 */
import { useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Collapse from "@mui/material/Collapse";
import Link from "@mui/material/Link";
import Popover from "@mui/material/Popover";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useFieldLabel, useRelationLabel, useTypeLabel } from "@/hooks/useResolveLabel";
import { bandColor } from "@/lib/dataQualityBands";
import { jumpTargetFor, type DataQualityJumpTarget } from "@/features/cards/dataQualityJump";
import { ScoreBar } from "@/features/cards/gamification/ScoreBar";
import { ScoreGainBurst } from "@/features/cards/gamification/ScoreGainBurst";
import {
  GHOST_HOLD_MS,
  bandChanged,
  type ScoreGain,
} from "@/features/cards/gamification/scoreGain";
import { useAnimatedNumber } from "@/features/cards/gamification/useAnimatedNumber";
import { useDqMotionStyles } from "@/features/cards/gamification/useDqMotionStyles";
import { useReducedMotion } from "@/features/cards/gamification/useReducedMotion";
import type { DataQualityBreakdown, DataQualityFactor, FieldDef } from "@/types";

/** Unmet slots the tooltip names before "+N more". */
const TOOLTIP_TOP = 3;

/** A field whose emptiness pins the score at 0: it unlocks every other gain. */
function unlocksScore(f: DataQualityFactor, blocked: string[]): boolean {
  return f.kind === "field" && blocked.includes(f.key);
}

/** Unmet slots: the required fields holding the score at 0 first (nothing
 * else moves it until they are filled), then the biggest gain; ties keep the
 * server's order. */
function rankUnmet(factors: DataQualityFactor[], blocked: string[]): DataQualityFactor[] {
  const unlocks = (f: DataQualityFactor) => (unlocksScore(f, blocked) ? 1 : 0);
  return factors
    .filter((f) => !f.filled)
    .sort(
      (a, b) => unlocks(b) - unlocks(a) || (b.gain ?? 0) - (a.gain ?? 0),
    );
}

/** A relation type mandatory on both ends of a self-referencing type is two
 * slots with one key, told apart by `side`. */
function factorKey(f: DataQualityFactor): string {
  return `${f.kind}:${f.key}:${f.side ?? ""}`;
}

/** How each factor reads: the action that fills it, and its name once it counts. */
function useFactorText(cardType: string | undefined) {
  const { t } = useTranslation(["cards", "common"]);
  const { getType, relationTypes } = useMetamodel();
  const fieldLabel = useFieldLabel();
  const relLabel = useRelationLabel();
  const typeLabel = useTypeLabel();

  return useMemo(() => {
    const fields = new Map<string, FieldDef>();
    for (const section of (cardType && getType(cardType)?.fields_schema) || []) {
      for (const f of section.fields || []) fields.set(f.key, f);
    }
    const relation = (f: DataQualityFactor) => {
      const rt = relationTypes.find((r) => r.key === f.key);
      if (!rt) return null;
      return {
        verb: relLabel(rt, f.side === "target"),
        type: typeLabel(f.other_type_key ? getType(f.other_type_key) : undefined),
      };
    };
    const action = (f: DataQualityFactor): string => {
      switch (f.kind) {
        case "field": {
          const def = fields.get(f.key);
          return def ? t("dataQuality.fillField", { field: fieldLabel(def) }) : t("dataQuality.fillAField");
        }
        case "description":
          return t("dataQuality.addDescription");
        case "lifecycle":
          return t("dataQuality.setLifecycle");
        case "relation": {
          const r = relation(f);
          return r ? t("dataQuality.addRelation", r) : t("dataQuality.addRequiredRelation");
        }
        case "tag_group":
          return t("dataQuality.addTag", { group: f.name ?? "" });
        case "stakeholders":
          return t("dataQuality.assignStakeholder");
      }
    };
    const noun = (f: DataQualityFactor): string => {
      switch (f.kind) {
        case "field": {
          const def = fields.get(f.key);
          return def ? fieldLabel(def) : t("dataQuality.field");
        }
        case "description":
          return t("dataQuality.description");
        case "lifecycle":
          return t("dataQuality.lifecycle");
        case "relation": {
          const r = relation(f);
          return r ? t("dataQuality.relation", r) : t("dataQuality.requiredRelation");
        }
        case "tag_group":
          return f.name ?? "";
        case "stakeholders":
          return t("dataQuality.stakeholders");
      }
    };
    const requiredField = (key: string) => {
      const def = fields.get(key);
      return def ? fieldLabel(def) : t("dataQuality.field");
    };
    return { action, noun, requiredField };
  }, [cardType, getType, relationTypes, fieldLabel, relLabel, typeLabel, t]);
}

export function DataQualityPill({
  value,
  cardId,
  cardType,
  onJump,
  animate = false,
  gain: scoreGain = null,
}: {
  value: number;
  /** Turns on the breakdown tooltip and popover. */
  cardId?: string;
  /** The card's type key, to name its fields. */
  cardType?: string;
  /** Makes each unmet slot in the popover a link to where it is filled. */
  onJump?: (target: DataQualityJumpTarget) => void;
  /** Gamified data quality: animate the fill and the figure. */
  animate?: boolean;
  /** The save's gain to play (`useScoreGain`); only read with `animate`. */
  gain?: ScoreGain | null;
}) {
  const { t } = useTranslation(["cards", "common"]);
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const color = bandColor(v);
  const explains = !!cardId;
  const reduced = useReducedMotion();
  useDqMotionStyles(animate);
  const shown = Math.round(useAnimatedNumber(v, animate && !reduced, GHOST_HOLD_MS));
  const playing = animate ? scoreGain : null;

  // Fetch on first interest; forget it when the score moves (adjusting state
  // during render, so the stale breakdown never paints).
  const [active, setActive] = useState(false);
  const [seenValue, setSeenValue] = useState(value);
  if (seenValue !== value) {
    setSeenValue(value);
    setActive(false);
  }
  const { data, loading, error } = useApiQuery<DataQualityBreakdown>(
    explains && active ? `/cards/${cardId}/data-quality` : null,
  );
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [showCounted, setShowCounted] = useState(false);
  const text = useFactorText(cardType);

  const blocked = useMemo(() => data?.blocked_by_required ?? [], [data]);
  const unmet = useMemo(() => (data ? rankUnmet(data.factors, blocked) : []), [data, blocked]);
  const met = useMemo(() => (data ? data.factors.filter((f) => f.filled) : []), [data]);
  // What filling the slot adds to the score. A gating field shows no figure:
  // nothing moves the score while another required field is still empty, and
  // the alert already says what the score would be.
  const gain = (f: DataQualityFactor) =>
    unlocksScore(f, blocked)
      ? t("dataQuality.required")
      : t("dataQuality.raiseTo", { pct: f.gain });

  const headline = t("utils.dataQuality", { value: v });
  const tooltip =
    explains && data ? (
      <Box>
        <Typography variant="caption" fontWeight={700} component="div">
          {headline}
        </Typography>
        {blocked.length > 0 && (
          <Typography variant="caption" component="div">
            {t("dataQuality.blockedShort")}
          </Typography>
        )}
        {unmet.slice(0, TOOLTIP_TOP).map((f) => (
          <Typography key={factorKey(f)} variant="caption" component="div">
            {text.action(f)}{" "}
            {/* The gain reads as the good news it is: green, like the chip below. */}
            <Box
              component="span"
              sx={{ fontWeight: 700, ...(!unlocksScore(f, blocked) && { color: "success.light" }) }}
            >
              {gain(f)}
            </Box>
          </Typography>
        ))}
        {unmet.length > TOOLTIP_TOP && (
          <Typography variant="caption" component="div" sx={{ opacity: 0.8, mt: 0.25 }}>
            {t("dataQuality.more", { count: unmet.length - TOOLTIP_TOP })}
          </Typography>
        )}
      </Box>
    ) : (
      headline
    );

  const open = (el: HTMLElement) => {
    setActive(true);
    setAnchor(el);
  };
  const interactive = explains
    ? {
        role: "button",
        tabIndex: 0,
        "aria-label": t("dataQuality.ariaLabel", { value: v }),
        "aria-haspopup": "dialog" as const,
        "aria-expanded": !!anchor,
        "data-testid": "data-quality-pill",
        onMouseEnter: () => setActive(true),
        onFocus: () => setActive(true),
        onClick: (e: MouseEvent<HTMLElement>) => open(e.currentTarget),
        onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open(e.currentTarget);
          }
        },
      }
    : {};

  // The tooltip stands down while the popover says the same, in full.
  const pill = (
    <Tooltip title={anchor ? "" : tooltip}>
      <Box
        {...interactive}
        sx={{
          position: "relative",
          height: 24,
          minWidth: 52,
          borderRadius: "12px",
          border: `1px solid ${color}`,
          overflow: "hidden",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: "transparent",
          px: 1,
          boxSizing: "border-box",
          ...(explains && { cursor: "pointer" }),
        }}
      >
        {animate ? (
          <ScoreBar
            value={v}
            color={color}
            animate
            ghostFrom={playing?.from ?? null}
            height="100%"
            radius={0}
            track={false}
            sx={{ position: "absolute", inset: 0, opacity: 0.18 }}
          />
        ) : (
          <Box
            sx={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 0,
              width: `${v}%`,
              bgcolor: color,
              opacity: 0.18,
            }}
          />
        )}
        <Typography
          variant="caption"
          fontWeight={700}
          sx={{
            position: "relative",
            color,
            lineHeight: 1,
            fontSize: "0.7rem",
          }}
        >
          {animate ? shown : v}%
        </Typography>
      </Box>
    </Tooltip>
  );

  return (
    <>
      {animate ? (
        <Box
          component="span"
          data-testid="data-quality-pill-motion"
          // Alternating the two class names restarts the pop on every gain.
          className={
            playing && !reduced
              ? playing.nonce % 2 === 1
                ? "dq-pop dq-pop-alt"
                : "dq-pop"
              : undefined
          }
          sx={{ position: "relative", display: "inline-flex" }}
        >
          {pill}
          {playing && !reduced && bandChanged(playing.from, playing.to) && (
            <Box
              key={`glow-${playing.nonce}`}
              component="span"
              aria-hidden
              data-testid="data-quality-glow"
              className="dq-glow"
              sx={{
                position: "absolute",
                inset: 0,
                borderRadius: "12px",
                border: `2px solid ${bandColor(playing.to)}`,
                pointerEvents: "none",
                opacity: 0,
              }}
            />
          )}
          {playing && <ScoreGainBurst key={playing.nonce} gain={playing} />}
        </Box>
      ) : (
        pill
      )}
      {explains && (
        <Popover
          open={!!anchor}
          anchorEl={anchor}
          onClose={() => setAnchor(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
          transformOrigin={{ vertical: "top", horizontal: "left" }}
          slotProps={{ paper: { sx: { p: 2, width: 340, maxWidth: "calc(100vw - 32px)" } } }}
        >
          <Box role="dialog" aria-label={headline}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {headline}
            </Typography>
            {loading && !data && <CircularProgress size={20} />}
            {error && !data && <Alert severity="error">{t("dataQuality.loadError")}</Alert>}
            {data && (
              <>
                {blocked.length > 0 && (
                  <Alert severity="warning" sx={{ mb: 1.5 }}>
                    {t("dataQuality.blockedByRequired", {
                      fields: blocked.map(text.requiredField).join(", "),
                    })}{" "}
                    {t("dataQuality.wouldBe", { pct: data.ungated_score })}
                  </Alert>
                )}
                {unmet.length > 0 ? (
                  <>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>
                      {t("dataQuality.toRaise")}
                    </Typography>
                    <Box component="ul" sx={{ listStyle: "none", p: 0, m: 0, mb: 1 }}>
                      {unmet.map((f) => (
                        <Box
                          component="li"
                          key={factorKey(f)}
                          sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.25 }}
                        >
                          {onJump ? (
                            <Link
                              component="button"
                              variant="body2"
                              underline="hover"
                              onClick={() => {
                                setAnchor(null);
                                onJump(jumpTargetFor(f));
                              }}
                              sx={{ flex: 1, minWidth: 0, textAlign: "left" }}
                            >
                              {text.action(f)}
                            </Link>
                          ) : (
                            <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
                              {text.action(f)}
                            </Typography>
                          )}
                          <Chip
                            size="small"
                            variant="outlined"
                            // Green for a gain; a gating field stays neutral.
                            color={unlocksScore(f, blocked) ? "default" : "success"}
                            label={gain(f)}
                            sx={{ height: 20, fontSize: "0.7rem", flexShrink: 0 }}
                          />
                        </Box>
                      ))}
                    </Box>
                  </>
                ) : (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {t("dataQuality.complete")}
                  </Typography>
                )}
                {met.length > 0 && (
                  <>
                    <Button
                      size="small"
                      onClick={() => setShowCounted((s) => !s)}
                      aria-expanded={showCounted}
                      endIcon={
                        <MaterialSymbol icon={showCounted ? "expand_less" : "expand_more"} size={16} />
                      }
                      sx={{ px: 0, textTransform: "none" }}
                    >
                      {`${t("dataQuality.alreadyCounted")} (${met.length})`}
                    </Button>
                    <Collapse in={showCounted} unmountOnExit>
                      <Box component="ul" sx={{ listStyle: "none", p: 0, m: 0 }}>
                        {met.map((f) => (
                          <Box
                            component="li"
                            key={factorKey(f)}
                            sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.25 }}
                          >
                            <Box component="span" sx={{ color: "success.main", display: "inline-flex" }}>
                              <MaterialSymbol icon="check_circle" size={16} />
                            </Box>
                            <Typography variant="body2">{text.noun(f)}</Typography>
                          </Box>
                        ))}
                      </Box>
                    </Collapse>
                  </>
                )}
              </>
            )}
          </Box>
        </Popover>
      )}
    </>
  );
}

export default DataQualityPill;
