/**
 * The data-quality breakdown (#1334) docked as a narrow panel on the right of
 * a card page. A click on the score (the header's ring, the sticky bar's
 * figure) opens it, and it stays open while the reader fills what it
 * lists — through jumps, saves and the next card — until **Close**. Available
 * to everyone (the breakdown is not a TurboRPG feature) on windows of at least
 * `md` width; narrower, `DataQualityBreakdownHost` shows the same content in a
 * drawer. The page makes room for it (`DATA_QUALITY_PANEL_WIDTH`).
 *
 * A thin host over `DataQualityBreakdownContent`. It fetches the breakdown as
 * soon as it mounts and again whenever a save rescores the card (`value`
 * moves). A jump hands the target to the page and leaves the panel open; the
 * page then opens the slot's section in edit mode (`useEditRequest`).
 * Non-modal: it takes no focus and Esc does not close it.
 *
 * Fixed under the 64 px app bar at `DATA_QUALITY_PANEL_Z_INDEX` 1095 — above
 * the sticky score bar (1090), below the app bar (1100).
 */
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { DataQualityJumpTarget } from "@/features/cards/dataQualityJump";
import { APP_BAR_OFFSET } from "@/features/cards/gamification/useHeaderOffscreen";
import { DataQualityBreakdownContent } from "./DataQualityBreakdownContent";
import { useDataQualityBreakdown } from "./useDataQualityBreakdown";

export const DATA_QUALITY_PANEL_WIDTH = 320;
export const DATA_QUALITY_PANEL_Z_INDEX = 1095;

/** The breakdown's Close button, right of its headline in the panel and the drawer. */
export function DataQualityBreakdownCloseButton({
  onClose,
  testId,
}: {
  onClose: () => void;
  testId: string;
}) {
  const { t } = useTranslation("cards");
  return (
    <Tooltip title={t("dataQuality.closePanel")}>
      <IconButton
        size="small"
        aria-label={t("dataQuality.closePanel")}
        data-testid={testId}
        onClick={onClose}
        sx={{ my: -0.5, flexShrink: 0 }}
      >
        <MaterialSymbol icon="close" size={18} />
      </IconButton>
    </Tooltip>
  );
}

export function DataQualityBreakdownPanel({
  cardId,
  cardType,
  value,
  onJump,
  onClose,
}: {
  cardId: string;
  /** The card's type key, to name its fields. */
  cardType?: string;
  /** The card's stored score; a change refetches the breakdown. */
  value: number;
  /** Makes each unmet slot a link to where it is filled. */
  onJump?: (target: DataQualityJumpTarget) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation(["cards", "common"]);
  const breakdown = useDataQualityBreakdown(cardId, true, value);
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const headline = t("utils.dataQuality", { value: v });

  return (
    <Box
      component="aside"
      role="complementary"
      aria-label={headline}
      data-testid="data-quality-panel"
      sx={{
        position: "fixed",
        top: APP_BAR_OFFSET,
        right: 0,
        bottom: 0,
        width: DATA_QUALITY_PANEL_WIDTH,
        zIndex: DATA_QUALITY_PANEL_Z_INDEX,
        boxSizing: "border-box",
        bgcolor: "background.paper",
        borderLeft: 1,
        borderColor: "divider",
        overflowY: "auto",
        p: 2,
      }}
    >
      <DataQualityBreakdownContent
        value={v}
        cardType={cardType}
        breakdown={breakdown}
        onJump={onJump}
        action={
          <DataQualityBreakdownCloseButton onClose={onClose} testId="data-quality-panel-close" />
        }
      />
    </Box>
  );
}

export default DataQualityBreakdownPanel;
