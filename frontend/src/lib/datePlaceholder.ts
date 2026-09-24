import { isValidIso } from "@/lib/calendarGrid";

/**
 * The day/month/year placeholder a date field shows while it is empty —
 * e.g. `dd/mm/yyyy`, `tt.mm.jjjj`, `年/月/日`.
 *
 * Order and separators come from `Intl` for the given locale, never from
 * code, so every region's format is handled the same way; only the per-field
 * labels ("dd", "tt", "jj", …) come from the caller, i.e. from translations.
 */
export interface DatePlaceholderLabels {
  day: string;
  month: string;
  year: string;
}

// Any date works: only the part types and the literals between them are used.
const SAMPLE = new Date(Date.UTC(2000, 10, 22));

export function datePlaceholder(locale: string | undefined, labels: DatePlaceholderLabels): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      // Date fields are always Gregorian, whatever the locale's default
      // calendar (ar-SA would otherwise format in the Islamic calendar).
      calendar: "gregory",
      timeZone: "UTC",
    }).formatToParts(SAMPLE);
  } catch {
    return `${labels.year}-${labels.month}-${labels.day}`;
  }
  return parts
    .map((part) => {
      switch (part.type) {
        case "day":
          return labels.day;
        case "month":
          return labels.month;
        case "year":
          return labels.year;
        case "literal":
          return part.value;
        default:
          return "";
      }
    })
    .join("")
    .trim();
}

/**
 * The browser's own locale, region included (`en-GB`, `de-CH`, …) — the same
 * source Chrome lays its native date field out from, so Safari's themed field
 * shows, and reads, dates in the order Chrome's native one does.
 */
export function dateInputLocale(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return "en-US";
  }
}

const NUMERIC_PARTS: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  calendar: "gregory",
  numberingSystem: "latn",
  timeZone: "UTC",
};

function numericFormatter(locale: string | undefined): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(locale, NUMERIC_PARTS);
  } catch {
    return new Intl.DateTimeFormat("en-US", NUMERIC_PARTS);
  }
}

/** A stored ISO date in the locale's numeric format, e.g. `24.07.2026`. */
export function formatLocalDate(iso: string, locale: string | undefined): string {
  if (!isValidIso(iso)) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return numericFormatter(locale).format(new Date(Date.UTC(y, m - 1, d)));
}

/** The order the locale writes day, month and year in, e.g. `["day","month","year"]`. */
export function datePartOrder(locale: string | undefined): Array<"day" | "month" | "year"> {
  return numericFormatter(locale)
    .formatToParts(SAMPLE)
    .map((p) => p.type)
    .filter((t): t is "day" | "month" | "year" => t === "day" || t === "month" || t === "year");
}

// Arabic-Indic (U+0660–0669) and Extended Arabic-Indic (U+06F0–06F9) digits.
function toLatinDigits(text: string): string {
  return text.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (ch) =>
    String((ch.charCodeAt(0) & 0xf) % 10),
  );
}

/**
 * Reads a typed date back to ISO: `""` for a blank field, `null` when the text
 * is not a real date. The digit groups are taken in the locale's own
 * day/month/year order, so any separator works (`24.07.2026`, `24/7/2026`,
 * `24 07 2026`); the year must be written in full.
 */
export function parseLocalDate(text: string, locale: string | undefined): string | null {
  const trimmed = toLatinDigits(text).trim();
  if (trimmed === "") return "";
  const groups = trimmed.match(/\d+/g);
  const order = datePartOrder(locale);
  if (!groups || groups.length !== 3 || order.length !== 3) return null;
  if (/[^\d\s./\-,\u200e\u200f年月日]/.test(trimmed.replace(/\d+/g, ""))) return null;
  const parts: Record<string, string> = {};
  order.forEach((type, i) => (parts[type] = groups[i]));
  if (parts.year.length !== 4 || parts.month.length > 2 || parts.day.length > 2) return null;
  const iso = `${parts.year}-${parts.month.padStart(2, "0")}-${parts.day.padStart(2, "0")}`;
  return isValidIso(iso) ? iso : null;
}
