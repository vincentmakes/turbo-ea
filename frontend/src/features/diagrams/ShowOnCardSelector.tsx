import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Menu from "@mui/material/Menu";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import MenuSectionHeader from "@/components/MenuSectionHeader";
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

interface Props {
  /** Card-type keys actually present on the canvas — drives which fields are offered. */
  activeTypeKeys: string[];
  /** Re-scan the canvas before the menu paints. */
  onOpen?: () => void;
  types: CardType[];
  labels: CardLabelSettings;
  onChange: (next: CardLabelSettings) => void;
}

/**
 * "Show on card" toolbar dropdown — what each shape says, as distinct from what
 * colours it.
 *
 * Its own button rather than a section of the colour menu: per-type colour
 * rules make that list roughly one row per field per card type, so sharing a
 * menu meant scrolling past every colour option to reach these.
 *
 * Fields are filed under the card type that owns them, using the same catalogue
 * the Layered Dependency View offers, so a field reads the same in a report and
 * on the diagram exported from it.
 */
export default function ShowOnCardSelector({
  activeTypeKeys,
  onOpen,
  types,
  labels,
  onChange,
}: Props) {
  const { t } = useTranslation(["diagrams", "common"]);
  const typeLabel = useTypeLabel();
  const fieldLabel = useFieldLabel();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const groups = useMemo(() => {
    const catalog = buildFieldCatalog(types, new Set(activeTypeKeys));
    return groupFieldCatalog(catalog, types);
  }, [types, activeTypeKeys]);

  const shownCount =
    labels.fields.length + (labels.showType ? 1 : 0) + (labels.showSubtype ? 1 : 0);

  const toggleField = (key: string) => {
    const next = labels.fields.includes(key)
      ? labels.fields.filter((k) => k !== key)
      : [...labels.fields, key];
    onChange({ ...labels, fields: next });
  };

  const groupLabel = (g: FieldGroup) =>
    g.kind === "shared" ? t("viewSelector.sharedFields") : typeLabel(g.type);

  const buttonText = t("viewSelector.showOnCard");

  return (
    <>
      <Tooltip title={buttonText}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<MaterialSymbol icon="visibility" size={18} />}
          endIcon={<MaterialSymbol icon="expand_more" size={16} />}
          onClick={(e) => {
            onOpen?.();
            setAnchorEl(e.currentTarget);
          }}
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
      </Tooltip>
      <Menu
        open={!!anchorEl}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        slotProps={{ paper: { sx: { minWidth: 280, maxHeight: 520 } } }}
      >
        <MenuSectionHeader
          icon="visibility"
          label={t("viewSelector.showOnCard")}
          count={shownCount}
        />
        <Box sx={{ px: 2, pb: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            {t("viewSelector.linesHint", { count: MAX_CARD_LINES })}
          </Typography>
        </Box>

        <CheckRow
          checked={!!labels.showType}
          label={t("viewSelector.cardTypeLine")}
          onToggle={() => onChange({ ...labels, showType: !labels.showType })}
        />
        <CheckRow
          checked={!!labels.showSubtype}
          label={t("viewSelector.subtypeLine")}
          onToggle={() => onChange({ ...labels, showSubtype: !labels.showSubtype })}
        />

        {groups.map((g) => [
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
        ])}
      </Menu>
    </>
  );
}
