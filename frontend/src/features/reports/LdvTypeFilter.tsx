import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuList from "@mui/material/MenuList";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import MenuSectionHeader from "@/components/MenuSectionHeader";
import { CheckRow } from "@/components/cardDisplay/menuRows";
import { useFullScreenDialog } from "@/hooks/useFullScreenDialog";
import { useTypeLabel } from "@/hooks/useResolveLabel";
import type { CardType } from "@/types";

interface Props {
  types: CardType[];
  /**
   * Card-type key → how many cards of that type the view holds, counted BEFORE
   * this filter runs. That is what keeps a hidden type listed (with the number
   * of cards ticking it would bring back) instead of disappearing from its own
   * menu the moment it is switched off.
   */
  typeCounts: Map<string, number>;
  hiddenTypeKeys: string[];
  onChange: (hidden: string[]) => void;
  /** The fullscreened element, when the view is fullscreen. */
  container?: Element | null;
}

/**
 * The Layered Dependency View's "Card types" toolbar button — which kinds of
 * card the diagram draws at all.
 *
 * Scope, not content: "Show on card" decides what a card *says* and the View
 * options popover how things are *drawn*, while this decides which cards are
 * there to draw. Three buttons, three questions, and no setting with two
 * controls.
 *
 * A component of its own rather than JSX inside `LayeredDependencyView`
 * because that view cannot mount under jsdom — React Flow needs layout APIs
 * jsdom does not implement — so anything rendered inside it is untestable.
 * Same reason `LdvShowOnCard` and `LdvLineStyleSelect` are separate files, and
 * the menu shell deliberately mirrors `ShowOnCardSelector` so the two menus in
 * one toolbar behave identically, phone sheet included.
 */
export default function LdvTypeFilter({
  types,
  typeCounts,
  hiddenTypeKeys,
  onChange,
  container,
}: Props) {
  const { t } = useTranslation(["reports", "common"]);
  const typeLabel = useTypeLabel();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const fullScreen = useFullScreenDialog();

  /* Only the types actually on the canvas, in metamodel order — which is also
     the order of the layer lanes they sit in. */
  const present = useMemo(
    () =>
      types
        .filter((tp) => typeCounts.has(tp.key))
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.key.localeCompare(b.key)),
    [types, typeCounts],
  );

  const hiddenSet = useMemo(() => new Set(hiddenTypeKeys), [hiddenTypeKeys]);

  /* Count only what is hidden AND on this canvas: a key left over from another
     diagram would otherwise put a badge on the button pointing at nothing the
     reader can see. */
  const hiddenCount = useMemo(
    () => present.reduce((n, tp) => n + (hiddenSet.has(tp.key) ? 1 : 0), 0),
    [present, hiddenSet],
  );

  const buttonText = t("dependency.cardTypes");

  const toggle = (key: string) =>
    onChange(
      hiddenSet.has(key) ? hiddenTypeKeys.filter((k) => k !== key) : [...hiddenTypeKeys, key],
    );

  const openMenu = (el: HTMLElement) => {
    if (fullScreen) setSheetOpen(true);
    else setAnchorEl(el);
  };

  /* One row list, two shells — an anchored menu on a pointer device, a
     full-screen dialog on a phone (see ShowOnCardSelector). A flat array, never
     a Fragment: MUI clones a menu's top-level children to drive focus and
     keyboard navigation, and a Fragment reads as one child. */
  const rows: ReactNode[] = [
    <Box key="__hint" sx={{ px: 2, pb: 0.5, display: "flex", alignItems: "center", gap: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
        {t("dependency.cardTypesHint")}
      </Typography>
      {/* A plain Button, never a MenuItem — an action sitting in the keyboard
          tick sequence is a stray Enter away from undoing the whole filter. */}
      <Button
        size="small"
        onClick={() => onChange([])}
        disabled={hiddenCount === 0}
        sx={{ textTransform: "none", fontSize: 12, minWidth: 0, px: 1, flexShrink: 0 }}
      >
        {t("dependency.showAllTypes")}
      </Button>
    </Box>,
    ...present.map((tp) => (
      <CheckRow
        key={tp.key}
        checked={!hiddenSet.has(tp.key)}
        label={typeLabel(tp)}
        icon={tp.icon}
        iconColor={tp.color}
        trailing={typeCounts.get(tp.key)}
        onToggle={() => toggle(tp.key)}
      />
    )),
  ];

  return (
    <>
      <Tooltip title={buttonText}>
        <IconButton size="small" aria-label={buttonText} onClick={(e) => openMenu(e.currentTarget)}>
          <Badge
            badgeContent={hiddenCount}
            color="primary"
            sx={{ "& .MuiBadge-badge": { height: 14, minWidth: 14, fontSize: "0.6rem" } }}
          >
            <MaterialSymbol icon="filter_alt" size={19} />
          </Badge>
        </IconButton>
      </Tooltip>

      {fullScreen ? (
        <Dialog
          fullScreen
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          container={container ?? undefined}
        >
          <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pb: 1 }}>
            <MaterialSymbol icon="filter_alt" size={20} />
            {buttonText}
          </DialogTitle>
          <MenuList sx={{ flex: 1, overflowY: "auto", py: 0 }}>{rows}</MenuList>
          <DialogActions>
            <Button onClick={() => setSheetOpen(false)} variant="contained">
              {t("common:actions.done")}
            </Button>
          </DialogActions>
        </Dialog>
      ) : (
        <Menu
          open={!!anchorEl}
          anchorEl={anchorEl}
          onClose={() => setAnchorEl(null)}
          container={container ?? undefined}
          slotProps={{ paper: { sx: { minWidth: 280, maxHeight: 520 } } }}
        >
          <MenuSectionHeader icon="filter_alt" label={buttonText} count={hiddenCount} />
          {rows}
        </Menu>
      )}
    </>
  );
}
