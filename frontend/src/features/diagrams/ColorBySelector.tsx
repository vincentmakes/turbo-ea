import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Menu from "@mui/material/Menu";
import Tooltip from "@mui/material/Tooltip";
import MaterialSymbol from "@/components/MaterialSymbol";
import MenuSectionHeader from "@/components/MenuSectionHeader";
import { useFieldLabel, useOptionLabel, useTypeLabel } from "@/hooks/useResolveLabel";
import { ChoiceRow, CheckRow, TypeHeading } from "./menuRows";
import { describeView, toggleFieldRule, type ViewResolvers, type ViewSource } from "./viewSource";
import type { CardType, FieldDef } from "@/types";

interface Props {
  /** Card-type keys actually present on the canvas — drives which fields are offered. */
  activeTypeKeys: string[];
  /** Re-scan the canvas before the menu paints, so the list reflects what is on
   *  it right now rather than whenever it last happened to be built. */
  onOpen?: () => void;
  types: CardType[];
  current: ViewSource;
  onChange: (next: ViewSource) => void;
}

/**
 * "Colour by" toolbar dropdown.
 *
 * Two shapes of setting, and the control says which is which:
 *
 *  - **Radios** for the two whole-canvas perspectives — card colours (the
 *    default, and what "nothing selected" means) and approval status.
 *  - **Checkboxes** for per-card-type field rules. Several types can each carry
 *    one at a time; ticking a second field within the same type replaces the
 *    first, because a card has exactly one fill.
 *
 * A global and a set of field rules are mutually exclusive: ticking a field
 * clears the global, choosing a global clears the rules. A card type with no
 * rule is left alone — it keeps its card-type colour, or a fill the user set by
 * hand. Painting every uncovered card one fallback colour is what used to grey
 * out an entire canvas as soon as one type was coloured by a field.
 */
export default function ColorBySelector({
  activeTypeKeys,
  onOpen,
  types,
  current,
  onChange,
}: Props) {
  const { t } = useTranslation(["diagrams", "common"]);
  const typeLabel = useTypeLabel();
  const fieldLabel = useFieldLabel();
  const optionLabel = useOptionLabel();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const resolvers = useMemo<ViewResolvers>(
    () => ({ typeLabel, fieldLabel, optionLabel, t }),
    [typeLabel, fieldLabel, optionLabel, t],
  );

  const typeMap = useMemo(() => new Map(types.map((tp) => [tp.key, tp] as const)), [types]);

  /** Only single-select fields: a perspective needs a bounded set of values to
   *  map onto a palette. */
  const fieldsByType = useMemo(() => {
    const result: Array<{ type: CardType; fields: FieldDef[] }> = [];
    for (const key of activeTypeKeys) {
      const tp = typeMap.get(key);
      if (!tp) continue;
      const fields: FieldDef[] = [];
      for (const section of tp.fields_schema ?? []) {
        for (const f of section.fields ?? []) {
          if (f.type === "single_select" && (f.options?.length ?? 0) > 0) fields.push(f);
        }
      }
      if (fields.length > 0) result.push({ type: tp, fields });
    }
    return result;
  }, [activeTypeKeys, typeMap]);

  const described = useMemo(
    () => describeView(current, types, resolvers),
    [current, types, resolvers],
  );

  const ruleCount = described.sections.length;
  const buttonText =
    current.kind === "card_fields" && ruleCount > 1
      ? t("viewSelector.buttonMore", { first: described.shortLabel, count: ruleCount - 1 })
      : described.shortLabel;

  /** Every active rule, one per line — the button can only show the first. */
  const tooltip =
    ruleCount > 1 ? (
      <Box sx={{ whiteSpace: "pre-line" }}>{described.sections.map((s) => s.title).join("\n")}</Box>
    ) : (
      buttonText
    );

  const activeFieldFor = (typeKey: string) =>
    current.kind === "card_fields" ? current.fields[typeKey] : undefined;

  return (
    <>
      <Tooltip title={tooltip}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<MaterialSymbol icon="palette" size={18} />}
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
            // `overflow`/`textOverflow` must NOT live on the Button root: it is
            // an inline-flex container, so `text-overflow` never applies to its
            // anonymous text child and the clip eats the icons at both ends.
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
            {buttonText}
          </Box>
        </Button>
      </Tooltip>
      <Menu
        open={!!anchorEl}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        slotProps={{ paper: { sx: { minWidth: 280, maxHeight: 520 } } }}
      >
        <MenuSectionHeader icon="palette" label={t("viewSelector.colorBy")} count={ruleCount} />

        <ChoiceRow
          checked={current.kind === "card_type"}
          label={t("viewSelector.cardType")}
          onSelect={() => onChange({ kind: "card_type" })}
        />
        <ChoiceRow
          checked={current.kind === "approval_status"}
          label={t("viewSelector.approvalStatus")}
          onSelect={() => onChange({ kind: "approval_status" })}
        />

        {fieldsByType.map(({ type, fields }) => [
          <TypeHeading key={`hdr-${type.key}`} type={type} label={typeLabel(type)} />,
          ...fields.map((f) => (
            <CheckRow
              key={`${type.key}-${f.key}`}
              checked={activeFieldFor(type.key) === f.key}
              label={fieldLabel(f)}
              onToggle={() => onChange(toggleFieldRule(current, type.key, f.key))}
            />
          )),
        ])}
      </Menu>
    </>
  );
}
