import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Box, IconButton, TextField, type TextFieldProps } from "@mui/material";
import { type Theme } from "@mui/material/styles";
import { useForkRef } from "@mui/material/utils";
import { useTranslation } from "react-i18next";
import DateCalendarPopover from "@/components/DateCalendarPopover";
import MaterialSymbol from "@/components/MaterialSymbol";
import { currentDateInputEngine } from "@/lib/browserEngine";
import {
  datePlaceholder,
  dateInputLocale,
  webkitPlaceholderBackdrop,
} from "@/lib/datePlaceholder";

export type DateFieldProps = Omit<
  TextFieldProps,
  "type" | "value" | "onChange" | "defaultValue"
> & {
  /** ISO date string (`yyyy-mm-dd`), or `""` when empty. */
  value: string;
  /** Called with the committed ISO date string when the field is left (blur). */
  onChange: (value: string) => void;
};

/**
 * Shared native date input (`<input type="date">`).
 *
 * A bare MUI `TextField type="date"` is unsafe whenever its `value` prop can be
 * replaced while the user is mid-edit — e.g. an inline auto-save that
 * round-trips to the server and feeds the response back as the controlled
 * value. Native date inputs fire `change` on every keystroke that forms a valid
 * date, so on a locale like `DD.MM.YYYY` typing the year segment saved
 * `0002 → 0020 → 0202 …` and each response reset the control, making it
 * impossible to type the year at all (issue #865, GRC Risk "Target date").
 *
 * This wrapper adds two guarantees the bare field does not:
 *  1. **Focus-protected display** — while focused it renders a local draft and
 *     ignores incoming `value` changes, so a re-render never clobbers the caret.
 *  2. **Commit on blur** — `onChange` fires once, with the final value, when the
 *     field is left, instead of once per intermediate valid date.
 *
 * It is also written to survive WebKit (issue #1142), without depending on
 * the display language or date format — it reads only the input's ISO
 * `value` (always `yyyy-mm-dd` or `""`) and `validity.badInput`, never the
 * rendered text:
 *  - **Event order is not assumed.** Safari's native calendar can take focus,
 *    so a pick may arrive as `blur → change → focus`. A change that lands while
 *    the field is not focused is committed at once, and focusing never resets
 *    the draft (that reset is what threw the picked date away).
 *  - **A half-typed date is flagged, not dropped.** A date input's value stays
 *    `""` until every segment is filled; `badInput` is what tells "cleared"
 *    apart from "incomplete". Leaving an incomplete field commits nothing and
 *    shows an error until it is completed or cleared.
 *  - **Empty looks empty, as in Chrome.** WebKit fills every empty segment
 *    with today's date and there is no way to make it show a day/month/year
 *    pattern instead. So on WebKit, while the field is empty and not focused,
 *    the native segments are hidden (`opacity`, since WebKit overrides their
 *    `color`) and a placeholder built by {@link datePlaceholder} is drawn in
 *    their place — order and separators from `Intl`, labels from i18n. The
 *    input's `lang` is pinned to the same locale ({@link dateInputLocale}),
 *    because WebKit lays its segments out from `lang`: the placeholder and the
 *    segments that appear on focus are then always in the same order. Once
 *    focused, WebKit's own greyed segments show (see
 *    {@link webkitPlaceholderBackdrop}).
 *  - **A calendar button on every WebKit engine** (Safari on Mac, iPhone and
 *    iPad), which has none of its own — Chrome's is part of its native widget.
 *    It opens `DateCalendarPopover`, a themed MUI calendar, because WebKit's
 *    native popover is drawn by the OS, cannot be styled and renders tiny.
 *  - **A clear button on WebKit while a date is set.** iOS's picker Reset
 *    re-selects the old date on its wheel and can leave it in the field, so the
 *    field offers its own clear, which commits `""` at once. Touch WebKit also
 *    commits every picker change immediately rather than on blur.
 *
 * Every native date input in the app should use this component so the bug
 * cannot be reintroduced by copy-paste.
 */
export function DateField({
  value,
  onChange,
  onFocus,
  onBlur,
  sx,
  error,
  helperText,
  disabled,
  inputRef,
  InputProps,
  inputProps,
  slotProps,
  ...rest
}: DateFieldProps) {
  const { t } = useTranslation("common");
  const engine = useMemo(currentDateInputEngine, []);
  const locale = useMemo(dateInputLocale, []);
  const ownInputRef = useRef<HTMLInputElement | null>(null);
  const handleInputRef = useForkRef(inputRef, ownInputRef);
  const committed = value ?? "";
  const [draft, setDraft] = useState(committed);
  const [incomplete, setIncomplete] = useState(false);
  const focused = useRef(false);
  // The last value handed to (or received from) the parent, so a commit is
  // never repeated whichever of blur / change arrives last.
  const lastCommitted = useRef(committed);

  // Mirror external updates only while the user is not editing.
  useEffect(() => {
    lastCommitted.current = committed;
    if (!focused.current) {
      setDraft(committed);
      setIncomplete(false);
    }
  }, [committed]);

  const commit = (next: string) => {
    if (next === lastCommitted.current) return;
    lastCommitted.current = next;
    onChange(next);
  };

  const webkit = engine !== "other";
  const showPlaceholder = webkit && draft === "" && !incomplete;
  const readOnly = [
    slotProps?.input,
    InputProps,
    slotProps?.htmlInput,
    inputProps,
  ].some(
    (p) =>
      typeof p === "object" &&
      p !== null &&
      (p as { readOnly?: boolean }).readOnly,
  );

  // WebKit's native date popover is drawn by macOS / iOS, cannot be styled
  // and renders tiny, so the calendar button opens the themed one instead.
  // The input is deliberately not focused: on iOS that would also raise the
  // native wheel underneath.
  const [calendarAnchor, setCalendarAnchor] = useState<HTMLElement | null>(
    null,
  );
  const openPicker = () => {
    const input = ownInputRef.current;
    if (!input) return;
    setCalendarAnchor(
      input.closest<HTMLElement>(".MuiFormControl-root") ?? input,
    );
  };

  const pickDate = (iso: string) => {
    const input = ownInputRef.current;
    if (input) input.value = iso;
    setDraft(iso);
    setIncomplete(false);
    // A whole date picked at once: no partial dates to protect (#865).
    commit(iso);
    setCalendarAnchor(null);
  };

  const rangeOf = (key: "min" | "max") => {
    for (const p of [slotProps?.htmlInput, inputProps]) {
      const v =
        typeof p === "object" && p !== null
          ? (p as Record<string, unknown>)[key]
          : undefined;
      if (typeof v === "string") return v;
    }
    return undefined;
  };

  // iOS's own picker Reset re-selects the old date on its wheel and cannot be
  // relied on to leave the field empty, so WebKit gets a clear of its own that
  // bypasses the native picker entirely.
  const clearDate = () => {
    const input = ownInputRef.current;
    if (input) input.value = "";
    setDraft("");
    setIncomplete(false);
    commit("");
  };

  const inputExtras: Record<string, ReactNode> = {};
  if (showPlaceholder) {
    inputExtras.startAdornment = (
      <Box
        component="span"
        aria-hidden
        data-date-placeholder=""
        sx={{
          // Zero-width and in flow: an adorned-start input moves its padding to
          // the root, so the text starts exactly where the input's would, in
          // every variant, size and direction.
          width: 0,
          flexShrink: 0,
          overflow: "visible",
          whiteSpace: "nowrap",
          pointerEvents: "none",
          color: "text.disabled",
        }}
      >
        {datePlaceholder(locale, {
          day: t("dateField.placeholder.day"),
          month: t("dateField.placeholder.month"),
          year: t("dateField.placeholder.year"),
        })}
      </Box>
    );
  }
  if (webkit) {
    const blocked = disabled || readOnly;
    inputExtras.endAdornment = (
      <Box sx={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
        {draft !== "" && !blocked && (
          <IconButton
            size="small"
            sx={ADORNMENT_BUTTON_SX}
            aria-label={t("dateField.clear")}
            // Keep focus where it is: the clear must not first blur the field.
            onMouseDown={(e) => e.preventDefault()}
            onClick={clearDate}
          >
            <MaterialSymbol icon="close" size={18} />
          </IconButton>
        )}
        <IconButton
          size="small"
          edge="end"
          sx={ADORNMENT_BUTTON_SX}
          aria-label={t("dateField.openPicker")}
          disabled={blocked}
          onClick={openPicker}
        >
          <MaterialSymbol icon="calendar_today" size={18} />
        </IconButton>
      </Box>
    );
  }

  return (
    <>
      <TextField
        {...rest}
        type="date"
        value={draft}
        disabled={disabled}
        inputRef={handleInputRef}
        error={incomplete || error}
        helperText={incomplete ? t("dateField.incomplete") : helperText}
        slotProps={
          {
            ...slotProps,
            // The deprecated InputProps / inputProps are only defaults for these
            // two slots inside TextField, so they are folded in here — otherwise
            // passing either slot would silently drop them.
            input: composeSlot(InputProps, slotProps?.input, inputExtras),
            htmlInput: composeSlot(
              inputProps,
              slotProps?.htmlInput,
              webkit ? { lang: locale } : {},
            ),
          } as TextFieldProps["slotProps"]
        }
        sx={[
          // WebKit only: Blink derives its own placeholder colour from the
          // input's background too, and the backdrop would turn Chrome's grey
          // native placeholder black.
          webkit &&
            ((theme: Theme) => ({
              "& input[type=date]": {
                backgroundColor: webkitPlaceholderBackdrop(theme),
              },
            })),
          showPlaceholder && {
            "& input:not(:focus)::-webkit-datetime-edit": { opacity: 0 },
            "& input:not(:focus)::-webkit-date-and-time-value": { opacity: 0 },
            "& .Mui-focused [data-date-placeholder]": { visibility: "hidden" },
          },
          // Our button replaces any native indicator, so a field never shows two.
          webkit && {
            "& input::-webkit-calendar-picker-indicator": { display: "none" },
          },
          ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
        ]}
        onFocus={(e) => {
          focused.current = true;
          onFocus?.(e);
        }}
        onChange={(e) => {
          const input = e.target as HTMLInputElement;
          const next = input.value;
          const partial = input.validity?.badInput ?? false;
          setDraft(next);
          if (!partial) setIncomplete(false);
          // Commit now when the field is already blurred (the picker took focus,
          // so nothing else will), and always on touch WebKit: its only input
          // is the picker — whole dates or Reset's "" — never segment typing,
          // so the per-keystroke partial dates #865 guards against cannot occur.
          if (!partial && (!focused.current || engine === "webkit-touch"))
            commit(next);
        }}
        onBlur={(e) => {
          focused.current = false;
          const input = e.currentTarget as HTMLInputElement;
          if (input.validity?.badInput) {
            setIncomplete(true);
          } else {
            setIncomplete(false);
            commit(input.value);
          }
          onBlur?.(e);
        }}
      />
      {webkit && (
        <DateCalendarPopover
          open={calendarAnchor !== null}
          anchorEl={calendarAnchor}
          value={draft}
          weekLocale={locale}
          min={rangeOf("min")}
          max={rangeOf("max")}
          onSelect={pickDate}
          onClear={
            draft !== ""
              ? () => {
                  clearDate();
                  setCalendarAnchor(null);
                }
              : undefined
          }
          onClose={() => setCalendarAnchor(null)}
        />
      )}
    </>
  );
}

// Compact enough that a set date, the clear button and the calendar button
// all fit a 170px field (the lifecycle row) without clipping the year.
const ADORNMENT_BUTTON_SX = {
  p: 0.25,
  "&.MuiIconButton-edgeEnd": { mr: -0.5 },
} as const;

type SlotValue = object | ((ownerState: unknown) => object) | undefined;

/**
 * Merge a TextField slot's props: our additions first, then the deprecated
 * top-level prop, then the slot prop — the caller always wins. Function-form
 * slot props are composed rather than replaced.
 */
function composeSlot(
  deprecated: object | undefined,
  slot: unknown,
  extras: object,
): SlotValue {
  if (typeof slot === "function") {
    return (ownerState: unknown) => ({
      ...extras,
      ...deprecated,
      ...(slot as (o: unknown) => object)(ownerState),
    });
  }
  return { ...extras, ...deprecated, ...(slot as object | undefined) };
}

export default DateField;
