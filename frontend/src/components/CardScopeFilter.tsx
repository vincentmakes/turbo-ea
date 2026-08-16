import { useState } from "react";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import CardScopeDialog, { type CardScopeOption } from "@/components/CardScopeDialog";

/**
 * The report-toolbar control for scoping to a set of cards (#954): a chip
 * reading "All X" or "N X", opening the shared multi-select picker.
 *
 * A chip plus a modal rather than an inline multi-select, because chips for
 * more than two or three picks overflow a report toolbar and the list has to
 * be usable full-screen on a phone.
 *
 * Labels are props rather than an interpolated `"All {{entity}}"` string: the
 * noun would need declining per locale (gender in de/fr/es, case in ru,
 * agreement in ar). A report with a fixed card type passes its own keys; one
 * whose type is user-selectable falls back to the entity-neutral defaults.
 */
export default function CardScopeFilter({
  types,
  value,
  onChange,
  labelAll,
  labelCount,
  dialogTitle,
  helperText,
  tooltip,
  initialOptions,
  disabled,
  disabledReason,
}: {
  /** Card type key(s) to browse. */
  types: string | string[];
  /** Currently scoped ids (subtree roots). */
  value: string[];
  onChange: (ids: string[]) => void;
  /** Chip text with nothing scoped, e.g. "All capabilities". */
  labelAll?: string;
  /** Chip text when scoped, e.g. (n) => "3 capabilities". */
  labelCount?: (count: number) => string;
  dialogTitle?: string;
  helperText?: string;
  tooltip?: string;
  /** Cards the caller already holds, so the chips label without a round-trip. */
  initialOptions?: CardScopeOption[];
  /** Greys the chip out — e.g. no card type is selected yet to scope over. */
  disabled?: boolean;
  /** Shown instead of `tooltip` while disabled, to say why. */
  disabledReason?: string;
}) {
  const { t } = useTranslation(["common"]);
  const [open, setOpen] = useState(false);

  const count = value.length;
  const label =
    count > 0
      ? (labelCount?.(count) ?? t("cardScope.selected", { count }))
      : (labelAll ?? t("cardScope.chipAll"));

  const chip = (
    <Chip
      icon={<MaterialSymbol icon="account_tree" size={16} />}
      label={label}
      variant={count > 0 ? "filled" : "outlined"}
      color={count > 0 ? "primary" : "default"}
      onClick={disabled ? undefined : () => setOpen(true)}
      // Only offered when there is something to clear, so the chip stays a
      // plain button in its resting state.
      onDelete={count > 0 && !disabled ? () => onChange([]) : undefined}
      disabled={disabled}
      sx={{ height: 32 }}
    />
  );

  const title = disabled ? disabledReason : tooltip;

  return (
    <>
      {title ? (
        // A disabled MUI Chip swallows pointer events, so the tooltip needs a
        // wrapper that still receives them to explain why it is disabled.
        <Tooltip title={title}>
          <span style={{ display: "inline-flex" }}>{chip}</span>
        </Tooltip>
      ) : (
        chip
      )}
      <CardScopeDialog
        open={open}
        onClose={() => setOpen(false)}
        types={types}
        value={value}
        onChange={onChange}
        title={dialogTitle}
        helperText={helperText}
        initialOptions={initialOptions}
      />
    </>
  );
}
