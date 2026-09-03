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
 *
 * A tile that opens a panel has to say so. The ripple only appears once you
 * are already pressing, so an `info` glyph sits in the corner as the resting
 * affordance and the whole tile lifts on hover — the icon is the promise that
 * there is more behind the click, the lift is the confirmation you are on a
 * target. Both are suppressed under `prefers-reduced-motion`.
 */
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import EntitlementChip from "./EntitlementChip";
import ExtensionLogo from "./ExtensionLogo";
import {
  BuyButton,
  InstallButton,
  TrialButton,
  type StoreActionHandlers,
} from "./StoreActions";
import { isUpdate, tileActions } from "./storeActionRules";
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
 * Ordered by what needs acting on. A trial countdown or a lapsed licence
 * outranks everything; an available update outranks plain "Installed",
 * because it is the one thing on an installed tile the admin can still do —
 * "Installed 1.0.0" on a tile whose button says "Update to 2.0.0" spends the
 * only chip slot restating the version the button is offering to replace.
 * Knowing an extension is installed is the least surprising thing here.
 */
function StateChip({ item }: { item: StoreItem }) {
  const { t } = useTranslation("admin");
  const ent = storeEntitlement(item);
  const urgent =
    ent.trial === true || ent.state === "grace" || ent.state === "expired";
  if (urgent) return <EntitlementChip ent={ent} />;
  if (isUpdate(item)) {
    return (
      <Chip
        size="small"
        color="info"
        label={t("extensions.store.updateAvailableChip", "Update available")}
      />
    );
  }
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
    <Card
      variant="outlined"
      sx={{
        position: "relative",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        transition: (theme) =>
          theme.transitions.create(["transform", "box-shadow", "border-color"], {
            duration: theme.transitions.duration.shorter,
          }),
        "&:hover": {
          transform: "translateY(-2px)",
          boxShadow: 3,
          borderColor: "primary.main",
        },
        // The icon is the tile's resting hint; hovering promotes it from a
        // quiet mark to the thing you are about to press.
        "&:hover .store-tile-info": { opacity: 1, color: "primary.main" },
        "@media (prefers-reduced-motion: reduce)": {
          transition: "none",
          "&:hover": { transform: "none", boxShadow: 1, borderColor: "primary.main" },
        },
      }}
    >
      <Tooltip title={t("extensions.store.moreDetails", "More details")}>
        <Box
          className="store-tile-info"
          aria-hidden
          sx={{
            position: "absolute",
            top: 8,
            insetInlineEnd: 8,
            display: "flex",
            opacity: 0.4,
            color: "text.secondary",
            pointerEvents: "none",
            transition: (theme) =>
              theme.transitions.create(["opacity", "color"], {
                duration: theme.transitions.duration.shorter,
              }),
            "@media (prefers-reduced-motion: reduce)": { transition: "none" },
          }}
        >
          <MaterialSymbol icon="info" size={18} />
        </Box>
      </Tooltip>
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
                pr: 2.5,
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
          {actions.includes("trial") && (
            <TrialButton item={item} handlers={handlers} fullWidth compact />
          )}
          {actions.includes("buy") && <BuyButton item={item} handlers={handlers} fullWidth />}
          {actions.includes("install") && (
            <InstallButton item={item} handlers={handlers} fullWidth />
          )}
        </Stack>
      </Stack>
    </Card>
  );
}
