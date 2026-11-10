/**
 * Single-select picker of an existing architecture decision, modelled on
 * `CardPicker`: browse on open, filter and rank the loaded list on the raw
 * input as you type (no debounce: the whole register is already in memory).
 *
 * The register is read with `include_earlier=false`, so earlier revisions never
 * appear: a link or a pick always names a chain's current or open revision.
 *
 * Every picker on the page shares ONE register fetch (`fetchDecisionOptions`:
 * a module-level cache plus an in-flight promise), so a links block with eight
 * rows sends one request, not eight. Nothing is fetched until a picker opens.
 * The shared list is reused for `DECISION_OPTIONS_MAX_AGE_MS`; a picker opened
 * after that shows the cached rows at once and refetches them, so a decision
 * created a moment ago (in another tab, by someone else) is offered on the next
 * open after the window. `invalidateDecisionOptions()` drops the cache outright.
 */
import { useEffect, useMemo, useState } from "react";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { SxProps, Theme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";

import { api } from "@/api/client";
import { useLatestRequest } from "@/hooks/useLatestRequest";
import { cardSearchRank, compareByRank } from "@/lib/searchRank";
import { DecisionStateChip } from "@/features/ea-delivery/DecisionStandingChip";
import { decisionRefLabel } from "@/features/ea-delivery/decisionStanding";
import type { ArchitectureDecision, DecisionRef, DecisionStanding } from "@/types";

/** The register query the picker reads: current and open revisions only. */
export const DECISION_PICKER_PATH = "/adr?include_earlier=false";

/** How long the shared register list is reused before an opening picker refetches it. */
export const DECISION_OPTIONS_MAX_AGE_MS = 15_000;

let _cache: { rows: ArchitectureDecision[]; at: number } | null = null;
let _inflight: Promise<ArchitectureDecision[]> | null = null;

/**
 * The register rows every decision picker offers, fetched once for all of
 * them: a fresh cache answers at once, a request in flight is shared, and only
 * otherwise is a new request sent. `now` is injectable for tests.
 */
export function fetchDecisionOptions(now: number = Date.now()): Promise<ArchitectureDecision[]> {
  if (_cache && now - _cache.at < DECISION_OPTIONS_MAX_AGE_MS) return Promise.resolve(_cache.rows);
  if (_inflight) return _inflight;
  const request: Promise<ArchitectureDecision[]> = api
    .get<ArchitectureDecision[]>(DECISION_PICKER_PATH)
    .then((rows) => {
      // A request dropped by `invalidateDecisionOptions` does not refill the cache.
      if (_inflight === request) _cache = { rows, at: now };
      return rows;
    })
    .finally(() => {
      if (_inflight === request) _inflight = null;
    });
  _inflight = request;
  return request;
}

/** The shared register rows, or null before the first fetch settles. */
export function cachedDecisionOptions(): ArchitectureDecision[] | null {
  return _cache?.rows ?? null;
}

/** Drop the shared list (and forget a request in flight): the next open refetches. */
export function invalidateDecisionOptions(): void {
  _cache = null;
  _inflight = null;
}

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

  // The shared register list: whatever is cached shows at once; each open
  // (while enabled) asks the shared fetch, which answers from a fresh cache.
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ArchitectureDecision[]>(() => cachedDecisionOptions() ?? []);
  const [loading, setLoading] = useState(false);
  const request = useLatestRequest();

  useEffect(() => {
    if (!open || !enabled) return;
    request
      .run(async ({ isCurrent }) => {
        const cached = cachedDecisionOptions();
        if (cached) setRows(cached);
        setLoading(cached === null);
        try {
          const next = await fetchDecisionOptions();
          if (isCurrent()) setRows(next);
        } catch {
          // An unreadable register leaves the picker with what it had.
        } finally {
          if (isCurrent()) setLoading(false);
        }
      })
      .catch(() => {});
  }, [open, enabled, request]);

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
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
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
