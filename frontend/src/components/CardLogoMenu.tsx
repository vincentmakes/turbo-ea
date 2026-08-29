/**
 * The "change this card's logo" menu — upload an image, pick a bundled brand
 * icon, or remove the logo the card already carries.
 *
 * One implementation for every surface that offers it (the card-detail header,
 * the Inventory grid's Logo column). What it encapsulates is a set of backend
 * contracts, not styling: which image formats the file picker may offer (the
 * server refuses everything else, SVG included), that the icon path posts a
 * slug instead of bytes, and that removing a logo is a DELETE — so a second
 * copy is exactly where they would drift apart.
 *
 * The caller owns the anchor and the card's state: it says which card and where
 * the menu hangs, and is handed the new `logo_updated_at` (or `null` on
 * removal) to write wherever it keeps that card.
 */
import { useRef, useState } from "react";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import { useTranslation } from "react-i18next";

import BrandIconPicker from "@/components/BrandIconPicker";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";

/** What the file picker offers — the backend's allow-list, minus SVG. */
export const CARD_LOGO_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

interface Props {
  /** The card being edited. `null` renders the file input only (no menu). */
  cardId: string | null;
  /** Whether the card already has a logo — decides Upload vs Replace, Remove. */
  hasLogo: boolean;
  anchorEl: HTMLElement | null;
  onClose: () => void;
  /** The card's new `logo_updated_at`, or null once the logo is removed. */
  onChanged: (cardId: string, logoUpdatedAt: string | null) => void;
  /** Success text for the caller's snackbar. */
  onNotify?: (message: string) => void;
  onError?: (message: string) => void;
}

interface LogoResponse {
  logo_updated_at: string | null;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function CardLogoMenu({
  cardId,
  hasLogo,
  anchorEl,
  onClose,
  onChanged,
  onNotify,
  onError,
}: Props) {
  const { t } = useTranslation("cards");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [iconPickerBusy, setIconPickerBusy] = useState(false);
  // The card whose menu item started the flow. The caller may clear `cardId`
  // (the Inventory drops its target when the menu closes) before the file
  // dialog — which is modal and browser-owned — comes back.
  const pendingIdRef = useRef<string | null>(null);

  const handleFilePicked = async (file: File | undefined) => {
    const id = pendingIdRef.current ?? cardId;
    if (!file || !id) return;
    try {
      const resp = await api.upload<LogoResponse>(`/cards/${id}/logo`, file);
      onChanged(id, resp.logo_updated_at);
      onNotify?.(t("logo.uploaded"));
    } catch (err) {
      onError?.(messageOf(err));
    }
  };

  const handleIconPicked = async (slug: string) => {
    const id = pendingIdRef.current ?? cardId;
    if (!id) return;
    setIconPickerBusy(true);
    try {
      // The bytes never leave the server: the slug is resolved against the
      // bundled pack, the same path `set_card_logos` takes over MCP.
      const resp = await api.upload<LogoResponse>(`/cards/${id}/logo`, undefined, "file", {
        icon_slug: slug,
      });
      onChanged(id, resp.logo_updated_at);
      setIconPickerOpen(false);
      onNotify?.(t("logo.uploaded"));
    } catch (err) {
      onError?.(messageOf(err));
    } finally {
      setIconPickerBusy(false);
    }
  };

  const handleRemove = async () => {
    const id = pendingIdRef.current ?? cardId;
    if (!id) return;
    try {
      await api.delete(`/cards/${id}/logo`);
      onChanged(id, null);
      onNotify?.(t("logo.removed"));
    } catch (err) {
      onError?.(messageOf(err));
    }
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={CARD_LOGO_ACCEPT}
        hidden
        onChange={(e) => {
          void handleFilePicked(e.target.files?.[0]);
          // Reset, or picking the same file twice fires no change event.
          e.target.value = "";
        }}
      />
      <Menu anchorEl={anchorEl} open={!!anchorEl && !!cardId} onClose={onClose}>
        <MenuItem
          onClick={() => {
            pendingIdRef.current = cardId;
            onClose();
            fileInputRef.current?.click();
          }}
        >
          <ListItemIcon>
            <MaterialSymbol icon="upload" size={20} />
          </ListItemIcon>
          <ListItemText>{hasLogo ? t("logo.replace") : t("logo.upload")}</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            pendingIdRef.current = cardId;
            onClose();
            setIconPickerOpen(true);
          }}
        >
          <ListItemIcon>
            <MaterialSymbol icon="apps" size={20} />
          </ListItemIcon>
          <ListItemText>{t("logo.pickIcon")}</ListItemText>
        </MenuItem>
        {hasLogo && (
          <MenuItem
            onClick={() => {
              pendingIdRef.current = cardId;
              onClose();
              void handleRemove();
            }}
          >
            <ListItemIcon>
              <MaterialSymbol icon="delete" size={20} />
            </ListItemIcon>
            <ListItemText>{t("logo.remove")}</ListItemText>
          </MenuItem>
        )}
      </Menu>

      <BrandIconPicker
        open={iconPickerOpen}
        onClose={() => setIconPickerOpen(false)}
        onPick={(slug) => void handleIconPicked(slug)}
        busy={iconPickerBusy}
      />
    </>
  );
}
