/**
 * The store's action buttons.
 *
 * The tile shows exactly one of these and the drawer shows all of them, so
 * each button is defined once here and the rules for when it applies live in
 * `storeActionRules.ts` — written twice, they drift.
 */
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { isUpdate } from "./storeActionRules";
import type { StoreItem } from "./types";

export interface StoreActionHandlers {
  onInstall: (item: StoreItem) => void;
  onBuy: (item: StoreItem) => void;
  onTrial: (item: StoreItem) => void;
  /**
   * Key of the item whose install/update is in flight — for the whole
   * pipeline, not just the request that starts it.
   */
  busyKey: string | null;
  /** An install/apply is in flight anywhere on the page. */
  isWorking: boolean;
  /** Key of the item whose purchase is being claimed, if any. */
  claimingKey: string | null;
}

export function InstallButton({
  item,
  handlers,
  fullWidth = false,
}: {
  item: StoreItem;
  handlers: StoreActionHandlers;
  fullWidth?: boolean;
}) {
  const { t } = useTranslation("admin");
  const update = isUpdate(item);
  // `busyKey` covers the WHOLE pipeline (download → verify → preview →
  // apply), not just the POST that starts it: a button that goes back to
  // "Install" a tenth of a second in reads as "nothing happened", and the
  // install takes seconds.
  const busy = handlers.busyKey === item.key;
  const label = busy
    ? update
      ? t("extensions.store.updating", "Updating…")
      : t("extensions.store.installing", "Installing…")
    : update
      ? t("extensions.store.update", "Update to {{version}}", { version: item.version })
      : t("extensions.store.install", "Install");
  return (
    <Button
      size="small"
      fullWidth={fullWidth}
      variant={
        !item.free && item.entitlement_state === "unlicensed" ? "outlined" : "contained"
      }
      disabled={handlers.busyKey !== null || handlers.isWorking}
      onClick={() => handlers.onInstall(item)}
      startIcon={
        busy ? (
          <CircularProgress size={14} color="inherit" />
        ) : (
          <MaterialSymbol icon={update ? "upgrade" : "download"} size={18} />
        )
      }
    >
      {label}
    </Button>
  );
}

export function BuyButton({
  item,
  handlers,
  fullWidth = false,
}: {
  item: StoreItem;
  handlers: StoreActionHandlers;
  fullWidth?: boolean;
}) {
  const { t } = useTranslation("admin");
  return (
    <Button
      size="small"
      fullWidth={fullWidth}
      variant="contained"
      onClick={() => handlers.onBuy(item)}
      startIcon={<MaterialSymbol icon="shopping_cart" size={18} />}
    >
      {t("extensions.store.buy", "Buy")}
    </Button>
  );
}

export function TrialButton({
  item,
  handlers,
  fullWidth = false,
  compact = false,
}: {
  item: StoreItem;
  handlers: StoreActionHandlers;
  fullWidth?: boolean;
  /** Tile variant: half a tile's width has no room for the full sentence. */
  compact?: boolean;
}) {
  const { t } = useTranslation("admin");
  return (
    <Button
      size="small"
      fullWidth={fullWidth}
      variant="outlined"
      onClick={() => handlers.onTrial(item)}
      startIcon={<MaterialSymbol icon="hourglass_top" size={18} />}
      sx={{ whiteSpace: "nowrap" }}
    >
      {compact
        ? t("extensions.store.tryFree", "Try free")
        : t("extensions.store.startTrial", "Start 30-day trial")}
    </Button>
  );
}

export function DemoButton({ item, fullWidth = false }: { item: StoreItem; fullWidth?: boolean }) {
  const { t } = useTranslation("admin");
  return (
    <Button
      size="small"
      color="inherit"
      fullWidth={fullWidth}
      component="a"
      href={item.demo_url}
      target="_blank"
      rel="noopener"
      startIcon={<MaterialSymbol icon="play_circle" size={18} />}
    >
      {t("extensions.store.seeInAction", "See it in action")}
    </Button>
  );
}
