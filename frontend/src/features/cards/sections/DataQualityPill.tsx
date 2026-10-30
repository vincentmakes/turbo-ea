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
 * - a **click** (or Enter / Space) opens `DataQualityBreakdownPopover` — the
 *   same popover the sticky score bar opens — with every unmet slot, the slots
 *   that already count, and which required fields hold the score at 0.
 *
 * With `onJump`, each unmet slot in the popover is a link to where it is
 * filled; the tooltip's rows stay text — a tooltip is not interactive.
 *
 * When `value` changes (a save rescored the card) the fetched breakdown is
 * dropped, so the next hover fetches the fresh one (`useDataQualityBreakdown`).
 *
 * With `animate` (gamified data quality, an admin toggle) the fill is the
 * shared `ScoreBar` and the figure counts up; a `gain` pops the pill, pulses a
 * ring in the new band colour when the score changed band, and plays a
 * `ScoreGainBurst` over it. Without `animate` the pill is exactly the plain one.
 *
 * A gain with an `originAnchor` is flying in from the saved section
 * (`GainFlight`): the ghost previews the new level at once, but the fill, the
 * count-up, the pop and the burst wait for `impactNonce` to reach the gain's
 * nonce. The impact then flashes the pill white, expands a halo and a glow in
 * the band colour and sweeps a shine across the fill. A loss drains the bar and
 * counts the figure down at once, dims the figure, and — only when it has no
 * origin to fly to — floats a "−X%" over the pill; it never pops, flashes or
 * celebrates.
 */
import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { bandColor } from "@/lib/dataQualityBands";
import { STATUS_COLORS } from "@/theme/tokens";
import type { DataQualityJumpTarget } from "@/features/cards/dataQualityJump";
import { ImpactShine, ScoreBar } from "@/features/cards/gamification/ScoreBar";
import { GainLiveRegion } from "@/features/cards/gamification/GainLiveRegion";
import { ScoreGainBurst } from "@/features/cards/gamification/ScoreGainBurst";
import {
  GHOST_HOLD_MS,
  bandChanged,
  type ScoreGain,
} from "@/features/cards/gamification/scoreGain";
import { useAnimatedNumber } from "@/features/cards/gamification/useAnimatedNumber";
import { useDqMotionStyles } from "@/features/cards/gamification/useDqMotionStyles";
import { useReducedMotion } from "@/features/cards/gamification/useReducedMotion";
import { DataQualityBreakdownPopover } from "./DataQualityBreakdownPopover";
import { factorKey, unlocksScore, useFactorText } from "./dataQualityFactors";
import { useDataQualityBreakdown } from "./useDataQualityBreakdown";

/** Unmet slots the tooltip names before "+N more". */
const TOOLTIP_TOP = 3;

export function DataQualityPill({
  value,
  cardId,
  cardType,
  onJump,
  animate = false,
  gain: scoreGain = null,
  impactNonce = null,
  onRootRef,
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
  /** The nonce of the last gain whose orb has landed (`GainFlight`'s `onImpact`). */
  impactNonce?: number | null;
  /** Receives the animated pill's root, the orb's landing target. */
  onRootRef?: (el: HTMLElement | null) => void;
}) {
  const { t } = useTranslation(["cards", "common"]);
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const color = bandColor(v);
  const explains = !!cardId;
  const reduced = useReducedMotion();
  useDqMotionStyles(animate);
  const playing = animate ? scoreGain : null;
  const loss = playing?.direction === "loss";
  // A gain flying in from the saved section waits for its orb to land.
  const flying = !!playing && !loss && !!playing.originAnchor && !reduced;
  const landed = flying && impactNonce === playing.nonce;
  const waiting = flying && !landed;
  const shown = Math.round(
    useAnimatedNumber(
      waiting ? Math.max(0, Math.min(100, Math.round(playing.from))) : v,
      animate && !reduced,
      flying || loss ? 0 : GHOST_HOLD_MS,
      loss,
    ),
  );
  // The gain whose pop, glow and burst play now.
  const celebrating = playing && !loss && !waiting && !reduced ? playing : null;
  const showBurst = !!playing && (loss ? reduced || !playing.originAnchor : !waiting);

  // Fetch on first interest: hovered, focused, or the popover open.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const breakdown = useDataQualityBreakdown(cardId, hovered || focused || !!anchor, value);
  const { data, blocked, unmet } = breakdown;
  const text = useFactorText(cardType);

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
              {text.gain(f, blocked)}
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

  const open = (el: HTMLElement) => setAnchor(el);
  const interactive = explains
    ? {
        role: "button",
        tabIndex: 0,
        "aria-label": t("dataQuality.ariaLabel", { value: v }),
        "aria-haspopup": "dialog" as const,
        "aria-expanded": !!anchor,
        "data-testid": "data-quality-pill",
        onMouseEnter: () => setHovered(true),
        onMouseLeave: () => setHovered(false),
        onFocus: () => setFocused(true),
        onBlur: () => setFocused(false),
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
            ghostColor={loss ? STATUS_COLORS.error : undefined}
            fillOn={flying ? landed : undefined}
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
          // Remounted per loss, so the dim replays on the next one.
          key={loss && !reduced ? `dim-${playing.nonce}` : "figure"}
          variant="caption"
          fontWeight={700}
          data-testid="data-quality-figure"
          className={loss && !reduced ? "dq-dim" : undefined}
          sx={{
            position: "relative",
            color,
            lineHeight: 1,
            fontSize: "0.7rem",
          }}
        >
          {animate ? shown : v}%
        </Typography>
        {landed && (
          <Box
            key={`flash-${playing.nonce}`}
            component="span"
            aria-hidden
            data-testid="data-quality-flash"
            className="dq-flash"
            sx={{
              position: "absolute",
              inset: 0,
              bgcolor: "common.white",
              opacity: 0,
              pointerEvents: "none",
            }}
          />
        )}
        {landed && <ImpactShine key={`shine-${playing.nonce}`} testId="data-quality-shine" />}
      </Box>
    </Tooltip>
  );

  return (
    <>
      {animate ? (
        <Box
          ref={onRootRef}
          component="span"
          data-testid="data-quality-pill-motion"
          // Alternating the two class names restarts the pop on every gain.
          className={
            celebrating
              ? [
                  "dq-pop",
                  celebrating.nonce % 2 === 1 && "dq-pop-alt",
                  landed && "dq-impact",
                ]
                  .filter(Boolean)
                  .join(" ")
              : undefined
          }
          sx={{ position: "relative", display: "inline-flex" }}
        >
          {pill}
          {landed && (
            <Box
              key={`halo-${playing.nonce}`}
              component="span"
              aria-hidden
              data-testid="data-quality-halo"
              className="dq-halo"
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
          {landed && (
            <Box
              key={`impact-glow-${playing.nonce}`}
              component="span"
              aria-hidden
              data-testid="data-quality-impact-glow"
              className="dq-impact-glow"
              sx={{
                position: "absolute",
                inset: 0,
                borderRadius: "12px",
                // Static shadow; only the opacity animates.
                boxShadow: `0 0 18px 2px ${bandColor(playing.to)}`,
                pointerEvents: "none",
                opacity: 0,
              }}
            />
          )}
          {celebrating && !flying && bandChanged(celebrating.from, celebrating.to) && (
            <Box
              key={`glow-${celebrating.nonce}`}
              component="span"
              aria-hidden
              data-testid="data-quality-glow"
              className="dq-glow"
              sx={{
                position: "absolute",
                inset: 0,
                borderRadius: "12px",
                border: `2px solid ${bandColor(celebrating.to)}`,
                pointerEvents: "none",
                opacity: 0,
              }}
            />
          )}
          {showBurst && <ScoreGainBurst key={playing.nonce} gain={playing} />}
          <GainLiveRegion gain={playing} />
        </Box>
      ) : (
        pill
      )}
      {explains && (
        <DataQualityBreakdownPopover
          anchorEl={anchor}
          onClose={() => setAnchor(null)}
          value={v}
          cardType={cardType}
          breakdown={breakdown}
          onJump={onJump}
        />
      )}
    </>
  );
}

export default DataQualityPill;
