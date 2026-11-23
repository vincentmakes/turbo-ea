import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuList from "@mui/material/MenuList";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import MenuSectionHeader from "@/components/MenuSectionHeader";
import { CheckRow } from "@/components/cardDisplay/menuRows";
import { useFullScreenDialog } from "@/hooks/useFullScreenDialog";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useRelationLabel, useTypeLabel } from "@/hooks/useResolveLabel";
import type { CardType, RelationType } from "@/types";
import { relationFilterRows } from "./ldvViewModel";

interface Props {
  /** The card types — the Card types section's rows, and the names of each
   *  relation type's two ends. */
  types: CardType[];
  /**
   * Card-type key → how many cards of that type the view holds, counted BEFORE
   * the card-type filter runs. That is what keeps a hidden type listed (with
   * the number of cards ticking it would bring back) instead of disappearing
   * from its own menu the moment it is switched off.
   */
  typeCounts: Map<string, number>;
  hiddenTypeKeys: string[];
  onTypesChange: (hidden: string[]) => void;
  relationTypes: RelationType[];
  /**
   * Relation-type key → how many lines of that type the view holds, counted
   * BEFORE the relation-type filter runs, for the same reason as `typeCounts`.
   */
  relationCounts: Map<string, number>;
  /**
   * What to call a relation-type key the metamodel does not know (an ad-hoc
   * edge type drawn by a consumer such as TurboLens): the line's own label,
   * else its type.
   */
  relationFallbackLabels?: Map<string, string>;
  hiddenRelationTypeKeys: string[];
  onRelationTypesChange: (hidden: string[]) => void;
  /** The fullscreened element, when the view is fullscreen. */
  container?: Element | null;
}

/** Adds `key` to the hidden list, or takes it out if it is there. */
function toggled(hidden: string[], key: string): string[] {
  return hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key];
}

/** How many of `keys` are hidden. */
function countHidden(keys: readonly string[], hidden: readonly string[]): number {
  return keys.filter((k) => hidden.includes(k)).length;
}

/**
 * The Layered Dependency View's Filter button (the funnel) — which things the
 * diagram draws at all. One menu, two sections: **Card types**, then
 * **Relation types**, the same scope question asked of cards and of lines.
 *
 * Scope, not content: "Show on card" decides what a card *says* and the View
 * options popover how things are *drawn*, while this decides which cards and
 * lines are there to draw. Three buttons, three questions, and no setting
 * with two controls.
 *
 * A component of its own rather than JSX inside `LayeredDependencyView`
 * because that view cannot mount under jsdom — React Flow needs layout APIs
 * jsdom does not implement — so anything rendered inside it is untestable.
 * Same reason `LdvShowOnCard` and `LdvLineStyleSelect` are separate files, and
 * the menu shell deliberately mirrors `ShowOnCardSelector` so the menus in one
 * toolbar behave identically, phone sheet included.
 */
export default function LdvScopeFilter({
  types,
  typeCounts,
  hiddenTypeKeys,
  onTypesChange,
  relationTypes,
  relationCounts,
  relationFallbackLabels,
  hiddenRelationTypeKeys,
  onRelationTypesChange,
  container,
}: Props) {
  const { t } = useTranslation(["reports", "common"]);
  const typeLabel = useTypeLabel();
  const relationLabel = useRelationLabel();
  const { types: metamodelTypes } = useMetamodel();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const fullScreen = useFullScreenDialog();

  /* Only the types actually on the canvas, in metamodel order — which is also
     the order of the layer lanes they sit in. */
  const presentTypes = useMemo(
    () =>
      types
        .filter((tp) => typeCounts.has(tp.key))
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.key.localeCompare(b.key)),
    [types, typeCounts],
  );

  const relationRows = useMemo(
    () =>
      relationFilterRows({
        relationTypes,
        types,
        metamodelTypes,
        relationCounts,
        fallbackLabels: relationFallbackLabels,
        relationLabel,
        typeLabel,
      }),
    [
      relationTypes,
      types,
      metamodelTypes,
      relationCounts,
      relationFallbackLabels,
      relationLabel,
      typeLabel,
    ],
  );

  /* Count only what is hidden AND on this view: a key left over from another
     diagram would otherwise badge the button pointing at nothing the reader
     can see. */
  const hiddenTypeCount = countHidden(
    presentTypes.map((tp) => tp.key),
    hiddenTypeKeys,
  );
  const hiddenRelationCount = countHidden(
    relationRows.map((row) => row.key),
    hiddenRelationTypeKeys,
  );

  const buttonText = t("dependency.viewFilter");

  const openMenu = (el: HTMLElement) => {
    if (fullScreen) setSheetOpen(true);
    else setAnchorEl(el);
  };

  /* One section: its header with its own hidden count, its hint with its own
     Show all, then its rows. A section with no rows is not rendered at all —
     a view with no lines has no relation type to hide. */
  const section = (
    id: string,
    icon: string,
    label: string,
    hint: string,
    hiddenCount: number,
    onShowAll: () => void,
    rowNodes: ReactNode[],
  ): ReactNode[] =>
    rowNodes.length === 0
      ? []
      : [
          <MenuSectionHeader key={`${id}-header`} icon={icon} label={label} count={hiddenCount} />,
          <Box
            key={`${id}-hint`}
            sx={{ px: 2, pb: 0.5, display: "flex", alignItems: "center", gap: 1 }}
          >
            <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
              {hint}
            </Typography>
            {/* A plain Button, never a MenuItem — an action sitting in the
                keyboard tick sequence is a stray Enter away from undoing the
                whole section. */}
            <Button
              size="small"
              onClick={onShowAll}
              disabled={hiddenCount === 0}
              sx={{ textTransform: "none", fontSize: 12, minWidth: 0, px: 1, flexShrink: 0 }}
            >
              {t("dependency.showAllTypes")}
            </Button>
          </Box>,
          ...rowNodes,
        ];

  const sections = [
    section(
      "types",
      "category",
      t("dependency.cardTypes"),
      t("dependency.cardTypesHint"),
      hiddenTypeCount,
      () => onTypesChange([]),
      presentTypes.map((tp) => (
        <CheckRow
          key={`type:${tp.key}`}
          checked={!hiddenTypeKeys.includes(tp.key)}
          label={typeLabel(tp)}
          icon={tp.icon}
          iconColor={tp.color}
          trailing={typeCounts.get(tp.key)}
          onToggle={() => onTypesChange(toggled(hiddenTypeKeys, tp.key))}
        />
      )),
    ),
    section(
      "relations",
      "conversion_path",
      t("dependency.relationTypes"),
      t("dependency.relationTypesHint"),
      hiddenRelationCount,
      () => onRelationTypesChange([]),
      relationRows.map((row) => (
        <CheckRow
          key={`relation:${row.key}`}
          checked={!hiddenRelationTypeKeys.includes(row.key)}
          label={row.label}
          trailing={row.count}
          onToggle={() => onRelationTypesChange(toggled(hiddenRelationTypeKeys, row.key))}
        />
      )),
    ),
  ].filter((s) => s.length > 0);

  /* One row list, two shells — an anchored menu on a pointer device, a
     full-screen dialog on a phone (see ShowOnCardSelector). A flat array, never
     a Fragment: MUI clones a menu's top-level children to drive focus and
     keyboard navigation, and a Fragment reads as one child. A divider goes
     between two sections, never before the first. */
  const rows: ReactNode[] = sections.flatMap((s, i) =>
    i === 0 ? s : [<Divider key={`divider-${i}`} />, ...s],
  );

  return (
    <>
      <Tooltip title={buttonText}>
        <IconButton size="small" aria-label={buttonText} onClick={(e) => openMenu(e.currentTarget)}>
          <Badge
            badgeContent={hiddenTypeCount + hiddenRelationCount}
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
          slotProps={{ paper: { sx: { minWidth: 320, maxWidth: 440, maxHeight: 520 } } }}
        >
          {rows}
        </Menu>
      )}
    </>
  );
}
