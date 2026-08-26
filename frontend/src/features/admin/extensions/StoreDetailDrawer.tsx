/**
 * Everything the compact tile could not hold, one click away.
 *
 * A right-hand drawer rather than a centred modal because browsing a
 * catalogue is exploratory: the drawer sits in the same place each time,
 * leaves the grid where it was, and is the shape this app already uses for
 * "tell me more about this row" (`CardDetailSidePanel`, `AuditLogBatchDrawer`).
 * Modals stay for the decisions — licence, uninstall, downgrade.
 */
import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useIsRtl } from "@/hooks/useIsRtl";
import EntitlementChip from "./EntitlementChip";
import ExtensionLogo from "./ExtensionLogo";
import ScreenshotLightbox from "./ScreenshotLightbox";
import {
  BuyButton,
  DemoButton,
  InstallButton,
  TrialButton,
  type StoreActionHandlers,
} from "./StoreActions";
import { canBuy, canInstall, canTrial } from "./storeActionRules";
import { MODEL_TAGS, storeEntitlement, type StoreItem } from "./types";

interface Props {
  item: StoreItem | null;
  bundleLogoUrl?: string | null;
  handlers: StoreActionHandlers;
  onClose: () => void;
  onToggleTag: (tag: string) => void;
}

export default function StoreDetailDrawer({
  item,
  bundleLogoUrl,
  handlers,
  onClose,
  onToggleTag,
}: Props) {
  const { t } = useTranslation("admin");
  const isRtl = useIsRtl();
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // MUI keeps the drawer mounted through its exit transition, so opening a
  // different item immediately after closing one would otherwise inherit the
  // previous item's scroll position and open lightbox.
  useEffect(() => {
    setZoomSrc(null);
    // Assigning scrollTop rather than calling scrollTo: jsdom implements the
    // property but not the method, and this needs no smooth behaviour.
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [item?.key]);

  const topical = (item?.tags ?? []).filter((tag) => !MODEL_TAGS.includes(tag));
  const screenshots = item?.screenshots ?? [];

  return (
    <Drawer
      // MUI does not mirror `anchor` for a right-to-left document; the two
      // existing drawers in this app predate `useIsRtl` and do not either.
      anchor={isRtl ? "left" : "right"}
      open={item !== null}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: "100%", sm: 520, md: 600 } } } }}
    >
      {item && (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <Stack
            direction="row"
            spacing={2}
            alignItems="flex-start"
            sx={{ p: 2, pb: 1.5 }}
          >
            <ExtensionLogo
              extKey={item.key}
              name={item.name}
              bundleLogoUrl={bundleLogoUrl}
              catalogLogoUrl={item.logo}
              size={64}
              radius={2}
            />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="h6">{item.name}</Typography>
              <Typography variant="caption" color="text.secondary">
                {item.key} · {item.version}
              </Typography>
            </Box>
            <IconButton
              onClick={onClose}
              size="small"
              aria-label={t("extensions.store.closeDetails", "Close details")}
            >
              <MaterialSymbol icon="close" size={20} />
            </IconButton>
          </Stack>

          <Stack
            direction="row"
            spacing={1}
            flexWrap="wrap"
            useFlexGap
            alignItems="center"
            sx={{ px: 2, pb: 1.5 }}
          >
            {item.installed_version && (
              <Chip
                size="small"
                color="success"
                variant="outlined"
                label={t("extensions.store.installedChip", "Installed {{version}}", {
                  version: item.installed_version,
                })}
              />
            )}
            {!item.installed_version && item.free && (
              <Chip size="small" color="info" label={t("extensions.store.free", "Free")} />
            )}
            {!item.free && item.entitlement_state !== "unlicensed" && (
              <EntitlementChip ent={storeEntitlement(item)} />
            )}
            <Box sx={{ flex: 1 }} />
            <Typography variant="subtitle2">{item.price}</Typography>
          </Stack>

          <Divider />

          <Box ref={bodyRef} sx={{ flex: 1, overflowY: "auto", p: 2 }}>
            <Typography variant="body2" sx={{ whiteSpace: "pre-line" }}>
              {item.long_description || item.description}
            </Typography>

            {topical.length > 0 && (
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>
                {topical.map((tag) => (
                  <Chip
                    key={tag}
                    size="small"
                    variant="outlined"
                    label={tag}
                    onClick={() => {
                      // Filtering the grid is pointless behind a drawer.
                      onToggleTag(tag);
                      onClose();
                    }}
                  />
                ))}
              </Stack>
            )}

            {screenshots.length > 0 && (
              <Stack spacing={1.5} sx={{ mt: 2 }}>
                {screenshots.map((src, index) => (
                  <Box
                    key={src}
                    component="img"
                    src={src}
                    alt={t("extensions.store.screenshotAlt", "{{name}} screenshot {{n}}", {
                      name: item.name,
                      n: index + 1,
                    })}
                    loading="lazy"
                    onClick={() => setZoomSrc(src)}
                    sx={{
                      width: "100%",
                      borderRadius: 1,
                      border: "1px solid",
                      borderColor: "divider",
                      cursor: "zoom-in",
                    }}
                  />
                ))}
              </Stack>
            )}

            {(item.homepage || item.license) && (
              <Stack
                direction="row"
                spacing={2}
                alignItems="center"
                flexWrap="wrap"
                useFlexGap
                sx={{ mt: 2, color: "text.secondary" }}
              >
                {item.homepage && (
                  <Link href={item.homepage} target="_blank" rel="noopener" variant="body2">
                    {t("extensions.store.source", "Source")}
                  </Link>
                )}
                {item.license && (
                  <Typography variant="body2">
                    {t("extensions.store.licenseLabel", "License")}:{" "}
                    {item.license_url ? (
                      <Link href={item.license_url} target="_blank" rel="noopener">
                        {item.license}
                      </Link>
                    ) : (
                      item.license
                    )}
                  </Typography>
                )}
              </Stack>
            )}
          </Box>

          <Divider />
          <Stack spacing={1} sx={{ p: 2 }}>
            {canInstall(item) && <InstallButton item={item} handlers={handlers} fullWidth />}
            {canBuy(item, handlers.claimingKey) && (
              <BuyButton item={item} handlers={handlers} fullWidth />
            )}
            {/* The two secondary actions share a row so their edges line up
                instead of stacking as two lone full-width bars. `minmax(0,
                1fr)`, not `1fr`: the implicit `auto` minimum is the button's
                min-content width, which overflows the track on a narrow
                drawer. A single secondary still spans the row. */}
            {(canTrial(item, handlers.claimingKey) || item.demo_url) && (
              <Box
                sx={{
                  display: "grid",
                  gap: 1,
                  gridTemplateColumns:
                    canTrial(item, handlers.claimingKey) && item.demo_url
                      ? "repeat(2, minmax(0, 1fr))"
                      : "minmax(0, 1fr)",
                }}
              >
                {canTrial(item, handlers.claimingKey) && (
                  <TrialButton item={item} handlers={handlers} fullWidth compact />
                )}
                {item.demo_url && <DemoButton item={item} fullWidth />}
              </Box>
            )}
          </Stack>
        </Box>
      )}
      <ScreenshotLightbox src={zoomSrc} onClose={() => setZoomSrc(null)} />
    </Drawer>
  );
}
