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
import { useFullScreenDialog } from "@/hooks/useFullScreenDialog";
import { useFieldLabel, useTypeLabel } from "@/hooks/useResolveLabel";
import {
  buildFieldCatalog,
  groupFieldCatalog,
  MAX_CARD_LINES,
  type CardLabelSettings,
  type FieldGroup,
} from "@/lib/cardDisplayFields";
import { CheckRow, TypeHeading } from "./menuRows";
import type { CardType } from "@/types";

/** One extra non-field line a surface can print, beyond type and subtype. */
export interface CardDisplayLine {
  /** Stable id — the React key, and what a test grabs the row by. */
  key: string;
  label: string;
  checked: boolean;
  onToggle: () => void;
}

interface Props {
  /** Card-type keys actually in play — drives which fields are offered. */
  activeTypeKeys: string[];
  /** Re-scan the surface before the menu paints (DrawIO walks its canvas). */
  onOpen?: () => void;
  types: CardType[];
  labels: CardLabelSettings;
  onChange: (next: CardLabelSettings) => void;
  /**
   * Extra tick rows rendered under the type/subtype rows and above the field
   * groups, for lines a surface has that `CardLabelSettings` doesn't cover (the
   * Layered Dependency View's lifecycle badge). A declarative array rather than
   * a `children` slot on purpose: a hand-rolled row would miss the touch sizing
   * every other row gets, and a `Menu` cannot take a Fragment child.
   */
  extraLines?: CardDisplayLine[];
  /**
   * Labelled outlined button (the DrawIO toolbar, a row of labelled dropdowns)
   * or an icon-only button (the Layered Dependency View nav bar, a row of
   * glyphs). The count rides in the label for the first, in a badge for the
   * second.
   */
  trigger?: "button" | "icon";
  /**
   * Portal target. Both shells are MUI `Modal`s, which portal to
   * `document.body` by default and so render *behind* a fullscreened element —
   * pass the container on a surface that can go fullscreen.
   */
  container?: Element | null;
}

/**
 * "Show on card" dropdown — what each card says, as distinct from what colours
 * it.
 *
 * Shared by the DrawIO diagram toolbar and the Layered Dependency View so the
 * same landscape reads the same way in a report and on the diagram exported
 * from it: one catalogue, one set of tick rows, one grouping.
 *
 * Its own button rather than a section of a settings panel: on the diagram the
 * colour menu runs to roughly one row per field per card type, and in the LDV
 * this was a chip autocomplete buried under seven switches. Both made the
 * feature hard to find and, on a touch device, hard to work.
 *
 * Below `sm` the same rows render in a full-screen dialog instead of an
 * anchored menu — a long field list in a popper is unusable on a phone. A
 * dialog and not a bottom drawer: `useFullScreenDialog` is the established
 * pattern here, and a bottom sheet would be net-new vocabulary for one menu.
 */
export default function ShowOnCardSelector({
  activeTypeKeys,
  onOpen,
  types,
  labels,
  onChange,
  extraLines = [],
  trigger = "button",
  container,
}: Props) {
  const { t } = useTranslation(["common"]);
  const typeLabel = useTypeLabel();
  const fieldLabel = useFieldLabel();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const fullScreen = useFullScreenDialog();

  const groups = useMemo(() => {
    const catalog = buildFieldCatalog(types, new Set(activeTypeKeys));
    return groupFieldCatalog(catalog, types);
  }, [types, activeTypeKeys]);

  const shownCount =
    labels.fields.length +
    (labels.showType ? 1 : 0) +
    (labels.showSubtype ? 1 : 0) +
    extraLines.filter((l) => l.checked).length;

  const toggleField = (key: string) => {
    const next = labels.fields.includes(key)
      ? labels.fields.filter((k) => k !== key)
      : [...labels.fields, key];
    onChange({ ...labels, fields: next });
  };

  const groupLabel = (g: FieldGroup) =>
    g.kind === "shared" ? t("cardDisplay.sharedFields") : typeLabel(g.type);

  const buttonText = t("cardDisplay.showOnCard");

  const openMenu = (el: HTMLElement) => {
    onOpen?.();
    if (fullScreen) setSheetOpen(true);
    else setAnchorEl(el);
  };

  /* One row list, two shells — an anchored menu on a pointer device, a
     full-screen dialog on a phone. Built once so the two cannot drift.
     A flat array, never a Fragment: MUI clones a menu's top-level children to
     drive focus and keyboard navigation, and a Fragment reads as one child. */
  const rows: ReactNode[] = [
    <Box key="__hint" sx={{ px: 2, pb: 0.5 }}>
      <Typography variant="caption" color="text.secondary">
        {t("cardDisplay.linesHint", { count: MAX_CARD_LINES })}
      </Typography>
    </Box>,
    <CheckRow
      key="__type"
      checked={!!labels.showType}
      label={t("cardDisplay.cardTypeLine")}
      onToggle={() => onChange({ ...labels, showType: !labels.showType })}
    />,
    <CheckRow
      key="__subtype"
      checked={!!labels.showSubtype}
      label={t("cardDisplay.subtypeLine")}
      onToggle={() => onChange({ ...labels, showSubtype: !labels.showSubtype })}
    />,
    ...extraLines.map((l) => (
      <CheckRow key={l.key} checked={l.checked} label={l.label} onToggle={l.onToggle} />
    )),
    ...groups.flatMap((g) => [
      <TypeHeading
        key={`hdr-${g.kind === "shared" ? "shared" : g.type.key}`}
        type={g.kind === "type" ? g.type : undefined}
        label={groupLabel(g)}
      />,
      ...g.fields.map((f) => (
        <CheckRow
          key={f.key}
          checked={labels.fields.includes(f.key)}
          label={fieldLabel(f)}
          onToggle={() => toggleField(f.key)}
        />
      )),
    ]),
  ];

  if (groups.length === 0) {
    rows.push(
      <Box key="__empty" sx={{ px: 2, py: 1 }}>
        <Typography variant="caption" color="text.secondary">
          {t("cardDisplay.noFields")}
        </Typography>
      </Box>,
    );
  }

  return (
    <>
      <Tooltip title={buttonText}>
        {trigger === "icon" ? (
          <IconButton
            size="small"
            aria-label={buttonText}
            onClick={(e) => openMenu(e.currentTarget)}
          >
            <Badge
              badgeContent={shownCount}
              color="primary"
              sx={{
                "& .MuiBadge-badge": { height: 14, minWidth: 14, fontSize: "0.6rem" },
              }}
            >
              <MaterialSymbol icon="visibility" size={19} />
            </Badge>
          </IconButton>
        ) : (
          <Button
            size="small"
            variant="outlined"
            startIcon={<MaterialSymbol icon="visibility" size={18} />}
            endIcon={<MaterialSymbol icon="expand_more" size={16} />}
            onClick={(e) => openMenu(e.currentTarget)}
            sx={{
              textTransform: "none",
              fontSize: "0.8rem",
              minWidth: 0,
              maxWidth: 200,
              "& .MuiButton-startIcon, & .MuiButton-endIcon": { flexShrink: 0 },
            }}
          >
            <Box
              component="span"
              sx={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {shownCount > 0 ? `${buttonText} (${shownCount})` : buttonText}
            </Box>
          </Button>
        )}
      </Tooltip>

      {fullScreen ? (
        <Dialog
          fullScreen
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          container={container ?? undefined}
        >
          <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pb: 1 }}>
            <MaterialSymbol icon="visibility" size={20} />
            {buttonText}
          </DialogTitle>
          {/* MenuList, not a plain Box: it keeps role="menu" / role="menuitem"
              so the sheet and the dropdown expose the same tree to assistive
              tech and to tests. */}
          <MenuList sx={{ flex: 1, overflowY: "auto", py: 0 }}>{rows}</MenuList>
          <DialogActions>
            <Button onClick={() => setSheetOpen(false)} variant="contained">
              {t("actions.done")}
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
          <MenuSectionHeader icon="visibility" label={buttonText} count={shownCount} />
          {rows}
        </Menu>
      )}
    </>
  );
}
