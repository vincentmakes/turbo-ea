import { alpha, type Theme } from "@mui/material/styles";

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
      // Native date inputs are always Gregorian (WebKit forces it), whatever
      // the locale's default calendar.
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
 * source Chrome lays its native date field out from. DateField pins WebKit's
 * date input to it via `lang`, so the placeholder built here and the segments
 * Safari shows once the field is focused are in the same order.
 */
export function dateInputLocale(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return "en-US";
  }
}

/**
 * Near-invisible background for the date `<input>`, so WebKit greys its
 * placeholder segments instead of drawing them as a real date.
 *
 * An empty WebKit date field shows today's date as its placeholder
 * (`DateTimeEditElement`: `m_placeholderDate = currentLocalTime()`), and
 * `DateTimeFieldElement::resolveCustomStyle` overrides the `color` of every
 * empty segment — author CSS on `::-webkit-datetime-edit*` cannot win — with
 * `RenderTheme::datePlaceholderTextColor(hostText, hostBackground)`. That
 * lightens the text when it is darker than the input's *own* background and
 * darkens it otherwise, comparing luminance with alpha ignored. MUI's input
 * background is transparent, which WebKit reads as black: dark text is then
 * never "darker than black", gets darkened, and today's date renders exactly
 * like a stored one (#1142). A 1%-alpha copy of the surface colour is
 * invisible on any background but carries the surface's luminance, so the
 * comparison goes the right way in both light and dark mode. Other engines do
 * not derive placeholder colour from the background and are unaffected.
 */
export function webkitPlaceholderBackdrop(theme: Theme): string {
  return alpha(theme.palette.background.paper, 0.01);
}
