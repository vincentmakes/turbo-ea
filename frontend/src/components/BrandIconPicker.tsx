/**
 * Pick a card's logo from the bundled brand-icon pack.
 *
 * The pack ships several thousand marks, so the search runs server-side and
 * this only ever renders the page it was handed — no virtualisation, because
 * there is never a long list in the DOM to virtualise. That also means the
 * client does NOT hold the full set, which puts this in the sanctioned
 * exception to "filter the list you already have instantly": there is nothing
 * local to filter, so the debounce is the whole mechanism.
 *
 * Ranking is the server's (exact → prefix → contains, alphabetical within a
 * tier), deliberately mirroring card search — so typing "sap" puts SAP first
 * rather than the dozen brands that merely contain those letters. Do not
 * re-sort here: the order would then change when the response lands.
 */
import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";

import MaterialSymbol from "@/components/MaterialSymbol";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

export interface BrandIcon {
  /** Pack-qualified address, e.g. "logos:sap". What to pick and to render. */
  ref: string;
  slug: string;
  title: string;
  /** Which pack it came from — "logos" (colour) or "simpleicons" (mono). */
  pack: string;
  /** Only the monochrome pack has a single brand colour. */
  hex?: string;
}

/** One page of results. Small enough to render eagerly, large enough that a
 *  vague search still shows the mark you meant. */
const PAGE = 60;

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with the chosen slug; the caller owns the request and the error. */
  onPick: (slug: string) => void;
  /** Disables the grid while the caller's request is in flight. */
  busy?: boolean;
}

export function brandIconUrl(ref: string): string {
  // Public and same-origin, so a plain <img> renders it — the same reasoning
  // as a card's own logo. Always the pack-qualified `ref`, never a bare slug:
  // the picker shows one specific mark and must set exactly that one.
  return `/api/v1/card-logos/brand-icons/${encodeURIComponent(ref)}.png`;
}

export default function BrandIconPicker({ open, onClose, onPick, busy }: Props) {
  const { t } = useTranslation(["cards", "common"]);
  const [search, setSearch] = useState("");
  const [debounced, debouncing] = useDebouncedValue(search, 300);

  const { data, loading } = useApiQuery<{ items: BrandIcon[]; total: number }>(
    open
      ? `/card-logos/brand-icons?search=${encodeURIComponent(debounced)}&limit=${PAGE}`
      : null,
  );
  const items = data?.items ?? [];
  // OR the debounce's pending state into the spinner, so the grid never looks
  // settled while it is still showing the previous query's icons.
  const pending = loading || debouncing;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("cards:logo.pickIcon")}</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          size="small"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("cards:logo.searchIcons")}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <MaterialSymbol icon="search" size={18} />
                </InputAdornment>
              ),
              endAdornment: pending ? <CircularProgress size={16} /> : null,
            },
          }}
          sx={{ mb: 2 }}
        />

        {!pending && items.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
            {t("cards:logo.noIcons")}
          </Typography>
        )}

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(76px, 1fr))",
            gap: 1,
            opacity: busy ? 0.5 : 1,
            pointerEvents: busy ? "none" : "auto",
          }}
        >
          {items.map((icon) => (
            <Tooltip key={icon.ref} title={icon.title} enterDelay={400}>
              <Box
                component="button"
                type="button"
                onClick={() => onPick(icon.ref)}
                aria-label={icon.title}
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 0.5,
                  p: 1,
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 1,
                  bgcolor: "background.paper",
                  cursor: "pointer",
                  font: "inherit",
                  "&:hover": { borderColor: "primary.main", bgcolor: "action.hover" },
                }}
              >
                <Box
                  component="img"
                  src={brandIconUrl(icon.ref)}
                  alt=""
                  aria-hidden
                  loading="lazy"
                  sx={{ width: 32, height: 32, objectFit: "contain" }}
                />
                <Typography
                  variant="caption"
                  noWrap
                  sx={{ maxWidth: "100%", color: "text.secondary" }}
                >
                  {icon.title}
                </Typography>
              </Box>
            </Tooltip>
          ))}
        </Box>

        {data && data.total > items.length && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: "block" }}>
            {t("cards:logo.iconCount", { shown: items.length, total: data.total })}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
      </DialogActions>
    </Dialog>
  );
}
