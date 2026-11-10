/**
 * Single-select picker of an existing architecture decision, modelled on
 * `CardPicker`: browse on open, filter and rank the loaded list on the raw
 * input as you type (no debounce: the whole register is already in memory).
 *
 * The register is loaded once, on first open, with `include_earlier=false`, so
 * earlier revisions never appear: a link or a pick always names a chain's
 * current or open revision.
 */
import { useMemo, useState } from "react";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { SxProps, Theme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";

import { useApiQuery } from "@/hooks/useApiQuery";
import { cardSearchRank, compareByRank } from "@/lib/searchRank";
import { DecisionStateChip } from "@/features/ea-delivery/DecisionStandingChip";
import { decisionRefLabel } from "@/features/ea-delivery/decisionStanding";
import type { ArchitectureDecision, DecisionRef, DecisionStanding } from "@/types";

/** The register query the picker reads: current and open revisions only. */
export const DECISION_PICKER_PATH = "/adr?include_earlier=false";

/** What the picker can show as its value: a full row, or just a reference. */
export type DecisionPickerValue = DecisionRef & {
  status?: ArchitectureDecision["status"];
  standing?: DecisionStanding | null;
  recorded_at?: string | null;
};

/** Ranked on the title, with the reference as an equal-footing alias, so
 *  typing "ADR-012" is an exact hit and typing a title word ranks as usual. */
function rankable(o: DecisionPickerValue) {
  return { name: o.title, alias: o.reference_number };
}

/** Filter + rank on the raw input (exported for tests). */
export function filterAndRankDecisions<T extends DecisionPickerValue>(
  options: T[],
  query: string,
): T[] {
  const q = query.trim();
  if (!q) return options;
  const cmp = compareByRank(q);
  return options
    .filter((o) => cardSearchRank(rankable(o), q) >= 0)
    .sort((a, b) => cmp(rankable(a), rankable(b)));
}

export interface DecisionPickerProps {
  value: DecisionPickerValue | null;
  /** Called with the full register row picked, or null when cleared. */
  onChange: (adr: ArchitectureDecision | null) => void;
  /** Ids hidden from the list (self, already linked, …). */
  excludeIds?: Iterable<string>;
  /** Extra row filter (e.g. signed decisions only). */
  filter?: (adr: ArchitectureDecision) => boolean;
  /** When false, nothing is fetched. Defaults to true. */
  enabled?: boolean;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  disablePortal?: boolean;
  autoFocus?: boolean;
  size?: "small" | "medium";
  fullWidth?: boolean;
  error?: boolean;
  helperText?: string;
  noOptionsText?: string;
  sx?: SxProps<Theme>;
}

export default function DecisionPicker({
  value,
  onChange,
  excludeIds,
  filter,
  enabled = true,
  label,
  placeholder,
  disabled,
  disablePortal,
  autoFocus,
  size = "small",
  fullWidth,
  error,
  helperText,
  noOptionsText,
  sx,
}: DecisionPickerProps) {
  const { t } = useTranslation("delivery");
  const { t: tc } = useTranslation("common");

  // Latched on the first open: the register is fetched once, not per open.
  const [armed, setArmed] = useState(false);
  const { data, loading } = useApiQuery<ArchitectureDecision[]>(
    enabled && armed ? DECISION_PICKER_PATH : null,
  );

  const rows = useMemo(() => data ?? [], [data]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const excludeSet = useMemo(() => new Set(excludeIds ?? []), [excludeIds]);

  const options: DecisionPickerValue[] = useMemo(() => {
    const kept: DecisionPickerValue[] = rows
      .filter((r) => !excludeSet.has(r.id) && (!filter || filter(r)))
      .sort((a, b) =>
        a.reference_number === b.reference_number
          ? a.revision_number - b.revision_number
          : a.reference_number.localeCompare(b.reference_number, undefined, { numeric: true }),
      );
    // Keep the value resolvable so MUI neither warns nor blanks it.
    if (value && !kept.some((o) => o.id === value.id)) kept.unshift(value);
    return kept;
  }, [rows, excludeSet, filter, value]);

  const optionLabel = (o: DecisionPickerValue) => `${decisionRefLabel(o, t)} — ${o.title}`;

  return (
    <Autocomplete<DecisionPickerValue, false, false, false>
      value={value}
      onChange={(_, next) => {
        if (!next) {
          onChange(null);
          return;
        }
        const row = byId.get(next.id);
        if (row) onChange(row);
      }}
      onOpen={() => setArmed(true)}
      options={options}
      getOptionLabel={optionLabel}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      filterOptions={(opts, state) => filterAndRankDecisions(opts, state.inputValue)}
      loading={loading}
      disabled={disabled}
      disablePortal={disablePortal}
      openOnFocus
      fullWidth={fullWidth}
      size={size}
      sx={sx}
      noOptionsText={loading ? tc("labels.loading") : (noOptionsText ?? tc("labels.noResults"))}
      renderOption={(liProps, o) => {
        return (
          <li {...liProps} key={o.id}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%", minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, flexShrink: 0 }}>
                {decisionRefLabel(o, t)}
              </Typography>
              <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
                {o.title}
              </Typography>
              {o.status && (
                <DecisionStateChip
                  adr={{ status: o.status, standing: o.standing, recorded_at: o.recorded_at }}
                  sx={{ flexShrink: 0 }}
                />
              )}
            </Box>
          </li>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={placeholder ?? t("adr.links.pickerPlaceholder")}
          autoFocus={autoFocus}
          error={error}
          helperText={helperText}
          slotProps={{
            input: {
              ...params.InputProps,
              endAdornment: (
                <>
                  {loading ? <CircularProgress color="inherit" size={16} /> : null}
                  {params.InputProps.endAdornment}
                </>
              ),
            },
          }}
        />
      )}
    />
  );
}
