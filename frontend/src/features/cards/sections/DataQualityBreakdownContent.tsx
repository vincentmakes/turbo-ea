/**
 * The data-quality breakdown itself (#1334): one body, three hosts. The
 * header's pill and the sticky score bar show it in `DataQualityBreakdownPopover`;
 * pinned, `DataQualityBreakdownPanel` docks it beside the page. The hosts own
 * the frame, the open / close state and the header action (pin or unpin);
 * this owns everything inside.
 *
 * - While empty required fields pin the score at 0, a warning names them and
 *   says what the score would be without them. The list is the backend's
 *   `blocked_by_required`, never recomputed here: the client's own banner
 *   (`missingRequiredFields`) also exempts calculated and auto fields, which
 *   the backend gate does not.
 * - **To raise the score** lists every unmet slot, gating fields first, then
 *   by gain, each with the gain it adds. With `onJump` each row is a link to
 *   where it is filled (`jumpTargetFor`); whether the host closes first is the
 *   host's call.
 * - **Already counted** lists the slots in place, behind a toggle.
 */
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Collapse from "@mui/material/Collapse";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { jumpTargetFor, type DataQualityJumpTarget } from "@/features/cards/dataQualityJump";
import { factorKey, unlocksScore, useFactorText } from "./dataQualityFactors";
import type { DataQualityBreakdownState } from "./useDataQualityBreakdown";

export function DataQualityBreakdownContent({
  value,
  cardType,
  breakdown,
  onJump,
  action,
}: {
  /** The score shown in the headline, already rounded. */
  value: number;
  /** The card's type key, to name its fields. */
  cardType?: string;
  breakdown: DataQualityBreakdownState;
  /** Makes each unmet slot a link to where it is filled. */
  onJump?: (target: DataQualityJumpTarget) => void;
  /** Shown at the right of the headline: the host's pin or unpin button. */
  action?: ReactNode;
}) {
  const { t } = useTranslation(["cards", "common"]);
  const text = useFactorText(cardType);
  const [showCounted, setShowCounted] = useState(false);
  const { data, loading, error, blocked, unmet, met } = breakdown;
  const headline = t("utils.dataQuality", { value });

  return (
    <>
      <Box
        data-testid="data-quality-breakdown-header"
        sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}
      >
        <Typography variant="subtitle2" sx={{ flex: 1, minWidth: 0 }}>
          {headline}
        </Typography>
        {action}
      </Box>
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
                        onClick={() => onJump(jumpTargetFor(f))}
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
                      label={text.gain(f, blocked)}
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
    </>
  );
}

export default DataQualityBreakdownContent;
