import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import i18n from "@/i18n";
import { toLocalDate } from "@/lib/dates";

export type DateFormatKey =
  | "MM/DD/YYYY"
  | "DD/MM/YYYY"
  | "YYYY-MM-DD"
  | "DD MMM YYYY"
  | "MMM DD, YYYY";

export const DEFAULT_DATE_FORMAT: DateFormatKey = "DD MMM YYYY";

export const DATE_FORMAT_OPTIONS: DateFormatKey[] = [
  "MM/DD/YYYY",
  "DD/MM/YYYY",
  "YYYY-MM-DD",
  "DD MMM YYYY",
  "MMM DD, YYYY",
];

let _cache: DateFormatKey | null = null;
let _inflight: Promise<DateFormatKey> | null = null;
const _listeners = new Set<(f: DateFormatKey) => void>();

function notify(f: DateFormatKey) {
  _cache = f;
  for (const fn of _listeners) fn(f);
}

function _fetchOnce(): Promise<DateFormatKey> {
  if (_cache) return Promise.resolve(_cache);
  if (_inflight) return _inflight;
  _inflight = api
    .get<{ date_format: string }>("/settings/date-format")
    .then((r) => {
      const next = (DATE_FORMAT_OPTIONS as string[]).includes(r.date_format)
        ? (r.date_format as DateFormatKey)
        : DEFAULT_DATE_FORMAT;
      notify(next);
      return next;
    })
    .catch(() => {
      notify(DEFAULT_DATE_FORMAT);
      return DEFAULT_DATE_FORMAT;
    })
    .finally(() => {
      _inflight = null;
    });
  return _inflight;
}

/**
 * The short month name in the **interface** language, not the browser's.
 *
 * Passing `undefined` to `Intl` (as this did before) used the browser locale,
 * so an Arabic interface on an English browser showed "20 Jan 2025" — and in a
 * right-to-left page that Latin-only string reads "Jan 2025 20". The calendar
 * is pinned to Gregorian because the day and year beside it come from the
 * Gregorian `Date` getters (`fa` would otherwise name a Persian month). `Intl`
 * may wrap the name in LRM/RLM marks; they are stripped as in
 * `lib/datePlaceholder.ts`, since the caller lays out the parts itself. An
 * unusable locale tag falls back to English rather than throwing on render.
 */
export function shortMonth(d: Date, locale: string | undefined): string {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat(locale, { month: "short", calendar: "gregory" });
  } catch {
    formatter = new Intl.DateTimeFormat("en", { month: "short", calendar: "gregory" });
  }
  return formatter.format(d).replace(/[\u200e\u200f]/g, "");
}

/**
 * Format a value as its **local** calendar day.
 *
 * Parsed with `toLocalDate`, not `new Date` — a bare `YYYY-MM-DD` from the API
 * is a calendar day, and `new Date` reads it as UTC midnight while the getters
 * below read local, showing the previous day everywhere west of UTC (#1016).
 * Full ISO timestamps carry their own offset and are unaffected.
 *
 * The month name (`MMM` formats) follows `locale`, which defaults to the
 * current interface language; day, year and the numeric month are always
 * ASCII digits, whatever the language.
 */
export function formatDateWith(
  fmt: DateFormatKey,
  value: Date | string | number | null | undefined,
  locale: string | undefined = i18n.language,
): string {
  const d = toLocalDate(value);
  if (!d) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  switch (fmt) {
    case "MM/DD/YYYY":
      return `${mm}/${dd}/${yyyy}`;
    case "DD/MM/YYYY":
      return `${dd}/${mm}/${yyyy}`;
    case "YYYY-MM-DD":
      return `${yyyy}-${mm}-${dd}`;
    case "MMM DD, YYYY":
      return `${shortMonth(d, locale)} ${dd}, ${yyyy}`;
    case "DD MMM YYYY":
    default:
      return `${dd} ${shortMonth(d, locale)} ${yyyy}`;
  }
}

export function formatDateTimeWith(
  fmt: DateFormatKey,
  value: Date | string | number | null | undefined,
  locale: string | undefined = i18n.language,
): string {
  const d = toLocalDate(value);
  if (!d) return "";
  const datePart = formatDateWith(fmt, d, locale);
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${datePart} ${hh}:${mi}`;
}

export function invalidateDateFormat(next: DateFormatKey) {
  notify(next);
}

export function getCachedDateFormat(): DateFormatKey {
  return _cache ?? DEFAULT_DATE_FORMAT;
}

/**
 * The workspace date format, bound to the interface language: `formatDate` /
 * `formatDateTime` change identity when either changes, so a language switch
 * re-renders every date with the new month names.
 */
export function useDateFormat() {
  const { i18n: i18nInstance } = useTranslation();
  const locale = i18nInstance.language;
  const [dateFormat, setDateFormat] = useState<DateFormatKey>(
    _cache ?? DEFAULT_DATE_FORMAT,
  );
  const [loading, setLoading] = useState(!_cache);

  useEffect(() => {
    _listeners.add(setDateFormat);
    if (!_cache) {
      _fetchOnce().finally(() => setLoading(false));
    }
    return () => {
      _listeners.delete(setDateFormat);
    };
  }, []);

  const formatDate = useCallback(
    (value: Date | string | number | null | undefined) =>
      formatDateWith(dateFormat, value, locale),
    [dateFormat, locale],
  );

  const formatDateTime = useCallback(
    (value: Date | string | number | null | undefined) =>
      formatDateTimeWith(dateFormat, value, locale),
    [dateFormat, locale],
  );

  const invalidate = useCallback((next: DateFormatKey) => {
    notify(next);
  }, []);

  const example = useMemo(
    () => formatDateWith(dateFormat, new Date(2026, 3, 29), locale),
    [dateFormat, locale],
  );

  return {
    dateFormat,
    loading,
    formatDate,
    formatDateTime,
    invalidate,
    example,
  };
}
