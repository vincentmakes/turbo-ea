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
import { useMetamodel } from "@/hooks/useMetamodel";
import { useRelationLabel, useTypeLabel } from "@/hooks/useResolveLabel";
import type { CardType, RelationType } from "@/types";

const ICON = "conversion_path";

interface Props {
  relationTypes: RelationType[];
  /**
   * The card types, to name each relation type's two ends. A consumer may pass
   * only the types on its canvas, so an end missing here is looked up in the
   * whole metamodel before falling back to its raw key.
   */
  types: CardType[];
  /**
   * Relation-type key → how many lines of that type the view holds, counted
   * BEFORE this filter runs, so a hidden relation type stays listed with the
   * number of lines ticking it would bring back.
   */
  relationCounts: Map<string, number>;
  /**
   * What to call a key the metamodel does not know (an ad-hoc edge type drawn
   * by a consumer such as TurboLens): the line's own label, else its type.
   */
  fallbackLabels?: Map<string, string>;
  hiddenRelationTypeKeys: string[];
  onChange: (hidden: string[]) => void;
  /** The fullscreened element, when the view is fullscreen. */
  container?: Element | null;
}

interface Row {
  key: string;
  label: string;
  sortOrder: number;
  known: boolean;
}

/**
 * The Layered Dependency View's "Relation types" toolbar button — which kinds
 * of line the diagram draws at all. The sibling of `LdvTypeFilter`, and the
 * same shell: an anchored menu on a pointer device, a full-screen sheet on a
 * phone, and a separate file because the view cannot mount under jsdom.
 *
 * A row is named by its forward verb (UI_GUIDELINES §3.13) followed by the two
 * card types it joins, because several relation types may share a verb — or a
 * card-type pair — and the reader has to tell them apart.
 */
export default function LdvRelationFilter({
  relationTypes,
  types,
  relationCounts,
  fallbackLabels,
  hiddenRelationTypeKeys,
  onChange,
  container,
}: Props) {
  const { t } = useTranslation(["reports", "common"]);
  const relationLabel = useRelationLabel();
  const typeLabel = useTypeLabel();
  const { types: allTypes } = useMetamodel();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const fullScreen = useFullScreenDialog();

  /* Only the relation types drawn on this view, in (sort_order, key) order;
     a key the metamodel does not know goes last, by key. */
  const present = useMemo<Row[]>(() => {
    const rtByKey = new Map(relationTypes.map((rt) => [rt.key, rt]));
    const typeByKey = new Map(types.map((tp) => [tp.key, tp]));
    const metamodelTypeByKey = new Map(allTypes.map((tp) => [tp.key, tp]));
    const end = (key: string) =>
      typeLabel(typeByKey.get(key) ?? metamodelTypeByKey.get(key)) || key;
    const rows = [...relationCounts.keys()].map((key): Row => {
      const rt = rtByKey.get(key);
      if (!rt) {
        return {
          key,
          label: fallbackLabels?.get(key) || key,
          sortOrder: 0,
          known: false,
        };
      }
      return {
        key,
        label: `${relationLabel(rt)} · ${end(rt.source_type_key)} → ${end(rt.target_type_key)}`,
        sortOrder: rt.sort_order ?? 0,
        known: true,
      };
    });
    return rows.sort(
      (a, b) =>
        Number(b.known) - Number(a.known) ||
        a.sortOrder - b.sortOrder ||
        a.key.localeCompare(b.key),
    );
  }, [
    relationTypes,
    types,
    allTypes,
    relationCounts,
    fallbackLabels,
    relationLabel,
    typeLabel,
  ]);

  const hiddenSet = useMemo(() => new Set(hiddenRelationTypeKeys), [hiddenRelationTypeKeys]);

  /* Count only what is hidden AND on this view — a key left over from another
     diagram must not badge the button. */
  const hiddenCount = useMemo(
    () => present.reduce((n, row) => n + (hiddenSet.has(row.key) ? 1 : 0), 0),
    [present, hiddenSet],
  );

  const buttonText = t("dependency.relationTypes");

  const toggle = (key: string) =>
    onChange(
      hiddenSet.has(key)
        ? hiddenRelationTypeKeys.filter((k) => k !== key)
        : [...hiddenRelationTypeKeys, key],
    );

  const openMenu = (el: HTMLElement) => {
    if (fullScreen) setSheetOpen(true);
    else setAnchorEl(el);
  };

  /* A flat array, never a Fragment — see LdvTypeFilter. */
  const rows: ReactNode[] = [
    <Box key="__hint" sx={{ px: 2, pb: 0.5, display: "flex", alignItems: "center", gap: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
        {t("dependency.relationTypesHint")}
      </Typography>
      {/* A plain Button, never a MenuItem (see LdvTypeFilter). */}
      <Button
        size="small"
        onClick={() => onChange([])}
        disabled={hiddenCount === 0}
        sx={{ textTransform: "none", fontSize: 12, minWidth: 0, px: 1, flexShrink: 0 }}
      >
        {t("dependency.showAllTypes")}
      </Button>
    </Box>,
    ...present.map((row) => (
      <CheckRow
        key={row.key}
        checked={!hiddenSet.has(row.key)}
        label={row.label}
        trailing={relationCounts.get(row.key)}
        onToggle={() => toggle(row.key)}
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
            <MaterialSymbol icon={ICON} size={19} />
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
            <MaterialSymbol icon={ICON} size={20} />
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
          <MenuSectionHeader icon={ICON} label={buttonText} count={hiddenCount} />
          {rows}
        </Menu>
      )}
    </>
  );
}
