/**
 * A card's data-quality breakdown (#1334), fetched on first interest.
 *
 * `active` is whether someone is looking right now (the pill is hovered or
 * focused, the breakdown panel is open). Nothing is fetched until it first
 * turns true; from then on the breakdown is kept for the score it was fetched
 * at, so looking again costs nothing. When `value` moves (a save rescored the
 * card) the breakdown is dropped at once — the stale one never paints — and
 * fetched afresh the next time someone looks, or straight away if someone is
 * looking.
 */
import { useMemo, useState } from "react";
import { useApiQuery } from "@/hooks/useApiQuery";
import type { DataQualityBreakdown, DataQualityFactor } from "@/types";
import { rankUnmet } from "./dataQualityFactors";

export interface DataQualityBreakdownState {
  data: DataQualityBreakdown | undefined;
  loading: boolean;
  error: Error | null;
  /** The required fields holding the score at 0 (`blocked_by_required`). */
  blocked: string[];
  /** Slots still to fill, gating fields first, then by gain. */
  unmet: DataQualityFactor[];
  /** Slots that already count. */
  met: DataQualityFactor[];
}

const NONE: string[] = [];

export function useDataQualityBreakdown(
  cardId: string | undefined,
  active: boolean,
  value: number,
): DataQualityBreakdownState {
  // The score the breakdown is held for; null until someone first looks.
  // Adjusted during render, so a stale breakdown is never painted.
  const [armedFor, setArmedFor] = useState<number | null>(null);
  if (active && cardId && armedFor !== value) setArmedFor(value);
  const armed = !!cardId && armedFor === value;

  const query = useApiQuery<DataQualityBreakdown>(
    armed ? `/cards/${cardId}/data-quality` : null,
    // A rescore while someone is looking keeps the path: refetch on the key.
    { refetchKey: armedFor ?? undefined, keepPreviousData: false },
  );
  const data = armed ? query.data : undefined;

  const blocked = data?.blocked_by_required ?? NONE;
  const unmet = useMemo(() => (data ? rankUnmet(data.factors, blocked) : []), [data, blocked]);
  const met = useMemo(() => (data ? data.factors.filter((f) => f.filled) : []), [data]);

  return {
    data,
    loading: armed && query.loading,
    error: armed ? query.error : null,
    blocked,
    unmet,
    met,
  };
}
