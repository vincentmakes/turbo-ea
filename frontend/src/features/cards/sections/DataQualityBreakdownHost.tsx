/**
 * Where a card page shows the data-quality breakdown (#1334) once the reader
 * opens it: docked as `DataQualityBreakdownPanel` when the window is wide
 * enough (`docked`), otherwise in a temporary drawer from the right — the
 * small-screen fallback, which covers the page, so a jump from it closes it
 * before the page scrolls. Both show the one `DataQualityBreakdownContent`
 * with the same Close button; never fork a copy.
 */
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import type { DataQualityJumpTarget } from "@/features/cards/dataQualityJump";
import { DataQualityBreakdownContent } from "./DataQualityBreakdownContent";
import {
  DataQualityBreakdownCloseButton,
  DataQualityBreakdownPanel,
} from "./DataQualityBreakdownPanel";
import { useDataQualityBreakdown } from "./useDataQualityBreakdown";

export function DataQualityBreakdownHost({
  cardId,
  cardType,
  value,
  onJump,
  onClose,
  docked,
}: {
  cardId: string;
  /** The card's type key, to name its fields. */
  cardType?: string;
  /** The card's stored score; a change refetches the breakdown. */
  value: number;
  /** Makes each unmet slot a link to where it is filled. */
  onJump?: (target: DataQualityJumpTarget) => void;
  onClose: () => void;
  /** Dock beside the page (wide windows) rather than in a drawer. */
  docked: boolean;
}) {
  return docked ? (
    <DataQualityBreakdownPanel
      cardId={cardId}
      cardType={cardType}
      value={value}
      onJump={onJump}
      onClose={onClose}
    />
  ) : (
    <BreakdownDrawer
      cardId={cardId}
      cardType={cardType}
      value={value}
      onJump={onJump}
      onClose={onClose}
    />
  );
}

function BreakdownDrawer({
  cardId,
  cardType,
  value,
  onJump,
  onClose,
}: {
  cardId: string;
  cardType?: string;
  value: number;
  onJump?: (target: DataQualityJumpTarget) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation(["cards", "common"]);
  const breakdown = useDataQualityBreakdown(cardId, true, value);
  const v = Math.max(0, Math.min(100, Math.round(value)));

  return (
    <Drawer
      anchor="right"
      open
      onClose={onClose}
      data-testid="data-quality-drawer"
      PaperProps={{ sx: { width: { xs: "100%", sm: 380 } } }}
    >
      <Box role="region" aria-label={t("utils.dataQuality", { value: v })} sx={{ p: 2 }}>
        <DataQualityBreakdownContent
          value={v}
          cardType={cardType}
          breakdown={breakdown}
          onJump={
            onJump &&
            ((target) => {
              onClose();
              onJump(target);
            })
          }
          action={
            <DataQualityBreakdownCloseButton onClose={onClose} testId="data-quality-drawer-close" />
          }
        />
      </Box>
    </Drawer>
  );
}

export default DataQualityBreakdownHost;
