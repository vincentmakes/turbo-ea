/**
 * The slim score bar that follows the reader down a card page once its header
 * (and the pill in it) has scrolled away. Gamified data quality only: the page
 * mounts it while the admin toggle is on, and slides it in and out with the
 * header's visibility.
 *
 * Fixed under the 64 px app bar, at `zIndex` 1090 — below the app bar (1100)
 * and the impersonation banner (1099). It plays a gain exactly as the pill
 * does, through the same `ScoreBar` and `ScoreGainBurst`: while it is open its
 * figure (`onFigureRef`) is where a gain's orb lands, so a gain with an origin
 * waits for `impactNonce`, then flashes, haloes, glows and shines. A loss
 * drains the bar, counts down and dims the figure, as on the pill.
 *
 * The figure is handed over only once the bar has finished sliding in, and
 * taken back (`null`) as it starts sliding out: measured mid-slide it sits
 * above the viewport, and an orb aimed there flies off the top of the page.
 *
 * With `onOpenBreakdown` the figure itself is the button: a small outlined
 * chip holding the score and a trailing chevron (`93% ›`), whose tooltip says
 * **Raise score**. A click asks the page to open the data-quality breakdown —
 * the same panel a click on the header's pill opens — and `breakdownOpen` says
 * whether it is open. Without it the figure is a plain box. Either way the
 * figure is the orb's landing target. While the breakdown is docked beside the
 * page the page passes its width as `rightInset`, so the bar ends where the
 * panel starts.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Slide from "@mui/material/Slide";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { bandColor } from "@/lib/dataQualityBands";
import { STATUS_COLORS } from "@/theme/tokens";
import { GHOST_HOLD_MS, type ScoreGain } from "./scoreGain";
import { ScoreBar } from "./ScoreBar";
import { ScoreGainBurst } from "./ScoreGainBurst";
import { APP_BAR_OFFSET } from "./useHeaderOffscreen";
import { useAnimatedNumber } from "./useAnimatedNumber";
import { useReducedMotion } from "./useReducedMotion";

export const STICKY_SCORE_BAR_Z_INDEX = 1090;
/** The bar's fixed height, border included: what a jumped-to section clears. */
export const STICKY_SCORE_BAR_HEIGHT = 44;

export function StickyScoreBar({
  open,
  name,
  value,
  gain,
  impactNonce = null,
  onFigureRef,
  onOpenBreakdown,
  breakdownOpen = false,
  rightInset = 0,
}: {
  open: boolean;
  name: string;
  value: number;
  gain: ScoreGain | null;
  /** The nonce of the last gain whose orb has landed (`GainFlight`'s `onImpact`). */
  impactNonce?: number | null;
  /** Receives the figure's box, the orb's landing target while the bar is open. */
  onFigureRef?: (el: HTMLElement | null) => void;
  /** Makes the figure the button that opens the data-quality breakdown. */
  onOpenBreakdown?: () => void;
  /** Whether the breakdown is open (the figure button's `aria-expanded`). */
  breakdownOpen?: boolean;
  /** Pixels kept free on the right: the docked breakdown panel's width. */
  rightInset?: number;
}) {
  const { t } = useTranslation("cards");
  const reduced = useReducedMotion();

  // The figure's box, handed over once the Slide has entered and withdrawn as
  // it starts to leave or when the bar unmounts. Under reduced motion the orb
  // never flies, so the figure is handed over as soon as it exists.
  const [figure, setFigure] = useState<HTMLElement | null>(null);
  const [entered, setEntered] = useState(false);
  const ready = entered || reduced;
  useEffect(() => {
    if (!onFigureRef) return;
    onFigureRef(ready ? figure : null);
    return () => onFigureRef(null);
  }, [figure, onFigureRef, ready]);

  return (
    <Slide
      direction="down"
      in={open}
      mountOnEnter
      unmountOnExit
      appear={!reduced}
      onEntered={() => setEntered(true)}
      onExit={() => setEntered(false)}
    >
      <Box
        data-testid="sticky-score-bar"
        role="region"
        aria-label={t("dataQuality.stickyBarLabel")}
        sx={{
          position: "fixed",
          top: APP_BAR_OFFSET,
          left: 0,
          right: rightInset,
          zIndex: STICKY_SCORE_BAR_Z_INDEX,
          height: STICKY_SCORE_BAR_HEIGHT,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          bgcolor: "background.paper",
          borderBottom: 1,
          borderColor: "divider",
          px: { xs: 2, sm: 3 },
        }}
      >
        <StickyScoreBarContent
          name={name}
          value={value}
          gain={gain}
          impactNonce={impactNonce}
          onFigureRef={setFigure}
          onOpenBreakdown={onOpenBreakdown}
          breakdownOpen={breakdownOpen}
        />
      </Box>
    </Slide>
  );
}

/**
 * What the bar shows. Mounted and unmounted with the Slide's child, so its
 * first render knows which change was already on the page: a gain that played
 * before the bar opened (the reader scrolled up, then down again) is **not**
 * replayed — the bar shows the score it led to and nothing bursts.
 */
function StickyScoreBarContent({
  name,
  value,
  gain: latest,
  impactNonce,
  onFigureRef,
  onOpenBreakdown,
  breakdownOpen,
}: {
  name: string;
  value: number;
  gain: ScoreGain | null;
  impactNonce: number | null;
  onFigureRef: (el: HTMLElement | null) => void;
  onOpenBreakdown?: () => void;
  breakdownOpen: boolean;
}) {
  const { t } = useTranslation("cards");
  const reduced = useReducedMotion();
  // The change already on the page when the bar opened: never ours to play.
  const [staleNonce] = useState(() => latest?.nonce ?? null);
  const gain = latest && latest.nonce !== staleNonce ? latest : null;
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const color = bandColor(v);
  const loss = gain?.direction === "loss";
  const flying = !!gain && !loss && !!gain.originAnchor && !reduced;
  const landed = flying && impactNonce === gain.nonce;
  const waiting = flying && !landed;
  const shown = Math.round(
    useAnimatedNumber(
      waiting ? Math.max(0, Math.min(100, Math.round(gain.from))) : v,
      !reduced,
      flying || loss ? 0 : GHOST_HOLD_MS,
      loss,
    ),
  );
  const showBurst = !!gain && (loss ? reduced || !gain.originAnchor : !waiting);

  const figureContent = (
    <>
      <Typography
        key={loss && !reduced ? `dim-${gain.nonce}` : "figure"}
        variant="caption"
        fontWeight={700}
        data-testid="sticky-score-value"
        className={loss && !reduced ? "dq-dim" : undefined}
        sx={{ color, minWidth: 36, textAlign: "right" }}
      >
        {shown}%
      </Typography>
      {landed && (
        <>
          <Box
            key={`flash-${gain.nonce}`}
            aria-hidden
            data-testid="sticky-score-flash"
            className="dq-flash"
            sx={{
              position: "absolute",
              inset: 0,
              borderRadius: "inherit",
              bgcolor: "common.white",
              opacity: 0,
              pointerEvents: "none",
            }}
          />
          <Box
            key={`halo-${gain.nonce}`}
            aria-hidden
            data-testid="sticky-score-halo"
            className="dq-halo"
            sx={{
              position: "absolute",
              inset: 0,
              borderRadius: "inherit",
              border: `2px solid ${bandColor(gain.to)}`,
              opacity: 0,
              pointerEvents: "none",
            }}
          />
          <Box
            key={`impact-glow-${gain.nonce}`}
            aria-hidden
            data-testid="sticky-score-impact-glow"
            className="dq-impact-glow"
            sx={{
              position: "absolute",
              inset: 0,
              borderRadius: "inherit",
              // Static shadow; only the opacity animates.
              boxShadow: `0 0 18px 2px ${bandColor(gain.to)}`,
              opacity: 0,
              pointerEvents: "none",
            }}
          />
        </>
      )}
      {showBurst && <ScoreGainBurst key={gain.nonce} gain={gain} placement="inline" />}
    </>
  );

  return (
  <Box
    sx={{
      maxWidth: 960,
      mx: "auto",
      flex: 1,
      minWidth: 0,
      display: "flex",
      alignItems: "center",
      gap: 1.5,
    }}
  >
    <Typography
      variant="body2"
      fontWeight={600}
      noWrap
      sx={{ minWidth: 0, flex: "0 1 auto", maxWidth: "40%" }}
    >
      {name}
    </Typography>
    <ScoreBar
      value={v}
      color={color}
      animate
      ghostFrom={gain?.from ?? null}
      ghostColor={loss ? STATUS_COLORS.error : undefined}
      fillOn={flying ? landed : undefined}
      shineKey={landed ? gain.nonce : null}
      height={10}
      radius={5}
      sx={{ flex: 1, minWidth: 48 }}
    />
    {onOpenBreakdown ? (
      <Tooltip title={t("dataQuality.raiseScore")}>
        <ButtonBase
          ref={onFigureRef}
          data-testid="sticky-score-figure"
          className={landed ? "dq-impact" : undefined}
          aria-label={t("dataQuality.ariaLabel", { value: v })}
          aria-haspopup="dialog"
          aria-expanded={breakdownOpen}
          onClick={() => onOpenBreakdown()}
          sx={{
            position: "relative",
            display: "inline-flex",
            alignItems: "center",
            flexShrink: 0,
            gap: 0.25,
            px: 1,
            py: 0.25,
            border: "1px solid",
            borderColor: "divider",
            borderRadius: "999px",
            color: "text.secondary",
            "&:hover": { bgcolor: "action.hover" },
            "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main" },
          }}
        >
          {figureContent}
          <MaterialSymbol icon="chevron_right" size={16} />
        </ButtonBase>
      </Tooltip>
    ) : (
      <Box
        ref={onFigureRef}
        data-testid="sticky-score-figure"
        className={landed ? "dq-impact" : undefined}
        sx={{ position: "relative", display: "inline-flex", flexShrink: 0, borderRadius: "4px" }}
      >
        {figureContent}
      </Box>
    )}
  </Box>
  );
}

export default StickyScoreBar;
