/**
 * One compact catalogue tile.
 *
 * The catalogue used to render two large cards per row carrying every field
 * an item had. At four-up that does not fit, and it did not need to: browsing
 * a store is scanning for the one you want, so the tile carries only what
 * distinguishes it — logo, name, a two-line description, its state, and the
 * single action most likely to be wanted — and everything else moves into the
 * detail drawer behind one click.
 *
 * The card body is a real `CardActionArea` (a `<button>`, so focus ring,
 * Enter/Space and ripple come for free). The action row is a *sibling* of it,
 * never a child: a `<button>` inside a `<button>` is invalid HTML. That is
 * also why the topical tag chips live in the drawer — they are the tile's
 * other would-be nested interactive.
 */
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import { useTranslation } from "react-i18next";
import EntitlementChip from "./EntitlementChip";
import ExtensionLogo from "./ExtensionLogo";
import { BuyButton, InstallButton, type StoreActionHandlers } from "./StoreActions";
import { tileActions } from "./storeActionRules";
import { storeEntitlement, type StoreItem } from "./types";

interface Props {
  item: StoreItem;
  /** Bundle logo of the installed extension of the same key, if any. */
  bundleLogoUrl?: string | null;
  handlers: StoreActionHandlers;
  onOpen: (key: string) => void;
}

/**
 * The one chip a tile has room for.
 *
 * A trial countdown or a lapsed licence outranks "Installed": those are the
 * states that need acting on, and knowing an extension is installed is the
 * least surprising thing on the page.
 */
function StateChip({ item }: { item: StoreItem }) {
  const { t } = useTranslation("admin");
  const ent = storeEntitlement(item);
  const urgent =
    ent.trial === true || ent.state === "grace" || ent.state === "expired";
  if (urgent) return <EntitlementChip ent={ent} />;
  if (item.installed_version) {
    return (
      <Chip
        size="small"
        color="success"
        variant="outlined"
        label={t("extensions.store.installedChip", "Installed {{version}}", {
          version: item.installed_version,
        })}
      />
    );
  }
  if (item.update_available) {
    return (
      <Chip
        size="small"
        color="info"
        label={t("extensions.store.updateAvailableChip", "Update available")}
      />
    );
  }
  if (item.free) {
    return <Chip size="small" color="info" label={t("extensions.store.free", "Free")} />;
  }
  if (item.entitlement_state !== "unlicensed") return <EntitlementChip ent={ent} />;
  return null;
}

export default function StoreTile({ item, bundleLogoUrl, handlers, onOpen }: Props) {
  const { t } = useTranslation("admin");
  const actions = tileActions(item, handlers.claimingKey);
  const claiming = handlers.claimingKey === item.key;

  return (
    <Card variant="outlined" sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <CardActionArea
        onClick={() => onOpen(item.key)}
        aria-label={t("extensions.store.openDetails", "Open details for {{name}}", {
          name: item.name,
        })}
        sx={{ flex: 1, p: 2, alignItems: "stretch", justifyContent: "flex-start" }}
      >
        <Stack spacing={1.25} sx={{ height: "100%" }}>
          <Stack direction="row" spacing={1.25} alignItems="flex-start">
            <ExtensionLogo
              extKey={item.key}
              name={item.name}
              bundleLogoUrl={bundleLogoUrl}
              catalogLogoUrl={item.logo}
              size={44}
            />
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 600,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {item.name}
            </Typography>
          </Stack>
          <Box>
            <StateChip item={item} />
          </Box>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              flex: 1,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {item.description}
          </Typography>
        </Stack>
      </CardActionArea>

      <Stack spacing={1} sx={{ px: 2, pb: 2, pt: 0 }}>
        {claiming && (
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t(
                "extensions.store.waitingPayment",
                "Waiting for payment confirmation — complete the checkout in the other browser tab…",
              )}
            </Typography>
            <LinearProgress sx={{ mt: 0.5 }} />
          </Box>
        )}
        <Typography variant="caption" color="text.secondary">
          {item.price}
        </Typography>
        <Stack direction="row" spacing={1}>
          {actions.includes("buy") && <BuyButton item={item} handlers={handlers} fullWidth />}
          {actions.includes("install") && (
            <InstallButton item={item} handlers={handlers} fullWidth />
          )}
        </Stack>
      </Stack>
    </Card>
  );
}
