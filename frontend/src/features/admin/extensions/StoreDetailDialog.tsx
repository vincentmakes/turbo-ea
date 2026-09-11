/**
 * Everything the compact tile could not hold, one click away — built around
 * the screenshots.
 *
 * A large centred dialog rather than the side drawer it replaces: a listing
 * is sold by its pictures, and a 600px panel showed them as a strip of
 * thumbnails you had to zoom one by one. Here the gallery takes the wider
 * column — one screenshot at a time, arrows, thumbnails, click to view full
 * size — and the description, tags, credits and actions sit beside it, so
 * reading and looking happen together. On a phone it fills the screen.
 *
 * "What's new" is the store's published release notes for the listed
 * version (or from the installed version to it when an update is offered),
 * read through core's own changelog proxy. The store is optional — an
 * air-gapped instance simply has no such section.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import ExtensionChangelog from "@/components/ExtensionChangelog";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useFullScreenDialog } from "@/hooks/useFullScreenDialog";
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
import {
  MODEL_TAGS,
  STORE_CATEGORIES,
  storeEntitlement,
  type ExtensionNotes,
  type StoreItem,
} from "./types";

interface Props {
  item: StoreItem | null;
  bundleLogoUrl?: string | null;
  handlers: StoreActionHandlers;
  onClose: () => void;
  onToggleTag: (tag: string) => void;
}

/** The release-notes query for an item: the listed version, from the installed one when updating. */
export function changelogPath(item: StoreItem | null): string | null {
  if (!item || !item.version) return null;
  const params = new URLSearchParams({ version: item.version });
  if (item.installed_version && item.update_available) {
    params.set("from_version", item.installed_version);
  }
  return `/admin/extensions/store/changelog/${encodeURIComponent(item.key)}?${params}`;
}

export default function StoreDetailDialog({
  item,
  bundleLogoUrl,
  handlers,
  onClose,
  onToggleTag,
}: Props) {
  const { t } = useTranslation("admin");
  const isRtl = useIsRtl();
  const fullScreen = useFullScreenDialog();
  const [hero, setHero] = useState(0);
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // MUI keeps the dialog mounted through its exit transition, so opening a
  // different item immediately after closing one would otherwise inherit the
  // previous item's screenshot, scroll position and open lightbox.
  useEffect(() => {
    setHero(0);
    setZoomSrc(null);
    // Assigning scrollTop rather than calling scrollTo: jsdom implements the
    // property but not the method, and this needs no smooth behaviour.
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [item?.key]);

  // Not `keepPreviousData`: the notes of the item just closed must never show
  // under the name of the one just opened while its own request is in flight.
  const { data: notes } = useApiQuery<ExtensionNotes>(changelogPath(item), {
    keepPreviousData: false,
  });

  const topical = (item?.tags ?? []).filter((tag) => !MODEL_TAGS.includes(tag));
  // The store section this item is listed under. Deliberately not clickable:
  // the tag chips below filter the grid, and a section is not a filter.
  const category = (STORE_CATEGORIES as readonly string[]).includes(
    item?.category ?? "",
  )
    ? item!.category!
    : null;
  const screenshots = item?.screenshots ?? [];
  const total = screenshots.length;
  const current = total ? Math.min(hero, total - 1) : 0;
  const prev = () => setHero((i) => (i + total - 1) % total);
  const next = () => setHero((i) => (i + 1) % total);
  const onGalleryKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (total < 2) return;
    // Physical arrows: in a right-to-left document the "forward" key is Left.
    const forward = isRtl ? "ArrowLeft" : "ArrowRight";
    const backward = isRtl ? "ArrowRight" : "ArrowLeft";
    if (e.key === forward) {
      e.preventDefault();
      next();
    } else if (e.key === backward) {
      e.preventDefault();
      prev();
    }
  };

  return (
    <Dialog
      open={item !== null}
      onClose={onClose}
      fullWidth
      maxWidth="lg"
      fullScreen={fullScreen}
      aria-labelledby="store-detail-title"
      slotProps={{
        // A fixed height, so the two columns scroll independently instead of
        // the dialog growing with the longest one. Full screen has its own.
        paper: {
          sx: fullScreen ? undefined : { height: "90vh", maxHeight: "90vh" },
        },
      }}
    >
      {item && (
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            minHeight: 0,
          }}
        >
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
              <Typography variant="h6" id="store-detail-title">
                {item.name}
              </Typography>
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
                label={t(
                  "extensions.store.installedChip",
                  "Installed {{version}}",
                  {
                    version: item.installed_version,
                  },
                )}
              />
            )}
            {!item.installed_version && item.free && (
              <Chip
                size="small"
                color="info"
                label={t("extensions.store.free", "Free")}
              />
            )}
            {category && (
              <Chip
                size="small"
                variant="outlined"
                label={t(`extensions.store.category.${category}`, category)}
              />
            )}
            {!item.free && item.entitlement_state !== "unlicensed" && (
              <EntitlementChip ent={storeEntitlement(item)} />
            )}
            <Box sx={{ flex: 1 }} />
            <Typography variant="subtitle2">{item.price}</Typography>
          </Stack>

          <Divider />

          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              // One scroller on a phone, one per column beside each other. A
              // plain block on phones, not a one-column grid: auto grid rows
              // inside a fixed-height container share the height equally
              // instead of sizing to their content, and the text then
              // overlapped the gallery.
              display: { xs: "block", md: "grid" },
              gridTemplateColumns: {
                md: total > 0 ? "minmax(0, 3fr) minmax(0, 2fr)" : "1fr",
              },
              overflow: { xs: "auto", md: "hidden" },
            }}
          >
            {total > 0 && (
              <Box
                onKeyDown={onGalleryKey}
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 1.5,
                  minHeight: 0,
                  overflowY: { md: "auto" },
                  p: 2.5,
                  borderRight: { md: 1 },
                  borderBottom: { xs: 1, md: 0 },
                  borderColor: { xs: "divider", md: "divider" },
                }}
              >
                <Box
                  sx={{
                    position: "relative",
                    flex: { xs: "none", md: 1 },
                    minHeight: { xs: 0, md: 240 },
                    minWidth: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 1,
                    border: "1px solid",
                    borderColor: "divider",
                    bgcolor: "action.hover",
                    overflow: "hidden",
                  }}
                >
                  <Box
                    component="img"
                    src={screenshots[current]}
                    alt={t(
                      "extensions.store.screenshotAlt",
                      "{{name}} screenshot {{n}}",
                      {
                        name: item.name,
                        n: current + 1,
                      },
                    )}
                    title={t(
                      "extensions.store.zoomScreenshot",
                      "View full size",
                    )}
                    role="button"
                    tabIndex={0}
                    onClick={() => setZoomSrc(screenshots[current])}
                    onKeyDown={(e: KeyboardEvent<HTMLElement>) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setZoomSrc(screenshots[current]);
                      }
                    }}
                    sx={{
                      maxWidth: "100%",
                      maxHeight: { xs: "55vh", md: "100%" },
                      objectFit: "contain",
                      cursor: "zoom-in",
                    }}
                  />
                  {total > 1 && (
                    <>
                      <IconButton
                        onClick={prev}
                        aria-label={t(
                          "extensions.store.previousScreenshot",
                          "Previous screenshot",
                        )}
                        sx={{
                          position: "absolute",
                          insetInlineStart: 8,
                          bgcolor: "background.paper",
                        }}
                      >
                        <MaterialSymbol
                          icon={isRtl ? "chevron_right" : "chevron_left"}
                          size={22}
                        />
                      </IconButton>
                      <IconButton
                        onClick={next}
                        aria-label={t(
                          "extensions.store.nextScreenshot",
                          "Next screenshot",
                        )}
                        sx={{
                          position: "absolute",
                          insetInlineEnd: 8,
                          bgcolor: "background.paper",
                        }}
                      >
                        <MaterialSymbol
                          icon={isRtl ? "chevron_left" : "chevron_right"}
                          size={22}
                        />
                      </IconButton>
                    </>
                  )}
                </Box>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ flexShrink: 0 }}
                  >
                    {t(
                      "extensions.store.screenshotOf",
                      "Screenshot {{n}} of {{total}}",
                      {
                        n: current + 1,
                        total,
                      },
                    )}
                  </Typography>
                  {total > 1 && (
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ overflowX: "auto", flex: 1, minWidth: 0, py: 0.5 }}
                    >
                      {screenshots.map((src, index) => (
                        <ButtonBase
                          key={src}
                          onClick={() => setHero(index)}
                          aria-label={t(
                            "extensions.store.showScreenshot",
                            "Show screenshot {{n}}",
                            {
                              n: index + 1,
                            },
                          )}
                          aria-pressed={index === current}
                          sx={{
                            flexShrink: 0,
                            width: 72,
                            height: 48,
                            borderRadius: 1,
                            overflow: "hidden",
                            border: "2px solid",
                            borderColor:
                              index === current ? "primary.main" : "divider",
                          }}
                        >
                          <Box
                            component="img"
                            src={src}
                            alt=""
                            loading="lazy"
                            sx={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                            }}
                          />
                        </ButtonBase>
                      ))}
                    </Stack>
                  )}
                </Stack>
              </Box>
            )}

            <Box
              ref={bodyRef}
              sx={{ minHeight: 0, overflowY: { md: "auto" }, p: 2.5 }}
            >
              <Typography variant="body2" sx={{ whiteSpace: "pre-line" }}>
                {item.long_description || item.description}
              </Typography>

              {topical.length > 0 && (
                <Stack
                  direction="row"
                  spacing={1}
                  flexWrap="wrap"
                  useFlexGap
                  sx={{ mt: 2 }}
                >
                  {topical.map((tag) => (
                    <Chip
                      key={tag}
                      size="small"
                      variant="outlined"
                      label={tag}
                      onClick={() => {
                        // Filtering the grid is pointless behind a dialog.
                        onToggleTag(tag);
                        onClose();
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
                    <Link
                      href={item.homepage}
                      target="_blank"
                      rel="noopener"
                      variant="body2"
                    >
                      {t("extensions.store.source", "Source")}
                    </Link>
                  )}
                  {item.license && (
                    <Typography variant="body2">
                      {t("extensions.store.licenseLabel", "License")}:{" "}
                      {item.license_url ? (
                        <Link
                          href={item.license_url}
                          target="_blank"
                          rel="noopener"
                        >
                          {item.license}
                        </Link>
                      ) : (
                        item.license
                      )}
                    </Typography>
                  )}
                </Stack>
              )}

              {notes?.notes && (
                <Box sx={{ mt: 3 }}>
                  <Divider sx={{ mb: 2 }} />
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    {t("extensions.store.whatsNew", "What's new")}
                  </Typography>
                  <ExtensionChangelog
                    notes={notes.notes}
                    version={notes.version}
                    fromVersion={notes.from_version}
                    name={item.name}
                    maxHeight="none"
                  />
                </Box>
              )}
            </Box>
          </Box>

          <Divider />
          <Stack
            direction="row"
            spacing={1}
            flexWrap="wrap"
            useFlexGap
            justifyContent="flex-end"
            sx={{ p: 2 }}
          >
            {item.demo_url && <DemoButton item={item} />}
            {canTrial(item, handlers.claimingKey) && (
              <TrialButton item={item} handlers={handlers} compact />
            )}
            {canBuy(item, handlers.claimingKey) && (
              <BuyButton item={item} handlers={handlers} />
            )}
            {canInstall(item) && (
              <InstallButton item={item} handlers={handlers} />
            )}
          </Stack>
        </Box>
      )}
      <ScreenshotLightbox src={zoomSrc} onClose={() => setZoomSrc(null)} />
    </Dialog>
  );
}
