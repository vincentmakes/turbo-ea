import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { Box, IconButton, TextField, type TextFieldProps } from "@mui/material";
import { useForkRef } from "@mui/material/utils";
import { useTranslation } from "react-i18next";
import DateCalendarPopover from "@/components/DateCalendarPopover";
import type { DateFieldProps } from "@/components/DateField";
import MaterialSymbol from "@/components/MaterialSymbol";
import { outOfRange } from "@/lib/calendarGrid";
import {
  dateInputLocale,
  datePlaceholder,
  formatLocalDate,
  parseLocalDate,
} from "@/lib/datePlaceholder";

// Compact enough that a set date, the clear button and the calendar button
// all fit a 170px field (the lifecycle row) without clipping the year.
const ADORNMENT_BUTTON_SX = { p: 0.25, "&.MuiIconButton-edgeEnd": { mr: -0.5 } } as const;

/**
 * DateField's rendering on Safari (Mac, iPhone, iPad): a plain text field plus
 * the themed {@link DateCalendarPopover}, so every way into the field — click,
 * tap, the calendar icon, the keyboard — opens the same picker (#1142). A
 * native `<input type="date">` cannot do that on WebKit: its picker is drawn by
 * the operating system and opens on every click, whatever the page does.
 *
 * - **Shown** in the browser locale's numeric format (`24.07.2026`,
 *   `07/24/2026`, `2026/07/24`), with that format as the grey placeholder.
 * - **Typing** (Mac) is read back in the same order by `parseLocalDate`, on
 *   blur or Enter; anything that is not a real date keeps the last good value
 *   and shows an error naming the expected format. While focused, incoming
 *   `value` changes never replace what is being typed (#865).
 * - **Touch** (iPhone, iPad) is read-only with no on-screen keyboard: a tap
 *   opens the calendar, and a pick commits at once.
 */
export default function SafariDateField({
  value,
  onChange,
  onFocus,
  onBlur,
  onKeyDown,
  error,
  helperText,
  disabled,
  inputRef,
  InputProps,
  inputProps,
  slotProps,
  touch,
  ...rest
}: DateFieldProps & { touch: boolean }) {
  const { t } = useTranslation("common");
  const locale = useMemo(dateInputLocale, []);
  const committed = value ?? "";
  const [text, setText] = useState(() => formatLocalDate(committed, locale));
  const [invalid, setInvalid] = useState(false);
  const [calendar, setCalendar] = useState<{ autoFocusGrid: boolean } | null>(null);
  const focused = useRef(false);
  const lastCommitted = useRef(committed);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const ownInputRef = useRef<HTMLInputElement | null>(null);
  const handleInputRef = useForkRef(inputRef, ownInputRef);
  const calendarId = useId();
  const focusInCalendar = () =>
    !!document.getElementById(calendarId)?.contains(document.activeElement);

  // Mirror external updates only while the user is not editing.
  useEffect(() => {
    lastCommitted.current = committed;
    if (!focused.current) {
      setText(formatLocalDate(committed, locale));
      setInvalid(false);
    }
  }, [committed, locale]);

  const pattern = datePlaceholder(locale, {
    day: t("dateField.placeholder.day"),
    month: t("dateField.placeholder.month"),
    year: t("dateField.placeholder.year"),
  });

  const htmlInput = slotProps?.htmlInput;
  const rangeOf = (key: "min" | "max") => {
    for (const p of [htmlInput, inputProps]) {
      const v =
        typeof p === "object" && p !== null ? (p as Record<string, unknown>)[key] : undefined;
      if (typeof v === "string") return v;
    }
    return undefined;
  };
  const min = rangeOf("min");
  const max = rangeOf("max");
  const readOnly = [slotProps?.input, InputProps, htmlInput, inputProps].some(
    (p) => typeof p === "object" && p !== null && (p as { readOnly?: boolean }).readOnly,
  );
  const blocked = !!disabled || readOnly;

  const commit = (next: string) => {
    if (next === lastCommitted.current) return;
    lastCommitted.current = next;
    onChange(next);
  };

  /** Read the typed text; keep the last good value when it is not a date. */
  const commitText = (raw: string) => {
    const parsed = parseLocalDate(raw, locale);
    if (parsed === null || (parsed !== "" && outOfRange(parsed, min, max))) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setText(formatLocalDate(parsed, locale));
    commit(parsed);
  };

  const pickDate = (iso: string) => {
    const returnFocus = !touch && focusInCalendar();
    setText(formatLocalDate(iso, locale));
    setInvalid(false);
    commit(iso);
    setCalendar(null);
    // A keyboard pick hands focus back to the field, not to the page.
    if (returnFocus) ownInputRef.current?.focus();
  };

  const clearDate = () => {
    setText("");
    setInvalid(false);
    commit("");
    setCalendar(null);
  };

  const openCalendar = (autoFocusGrid: boolean) => {
    if (blocked) return;
    setCalendar({ autoFocusGrid });
  };

  const closeCalendar = () => {
    // Focus left inside the calendar goes back to the field, not the page.
    const inCalendar = focusInCalendar();
    setCalendar(null);
    if (inCalendar) ownInputRef.current?.focus();
  };

  const onFieldKey = (e: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented || e.target !== ownInputRef.current) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      openCalendar(true);
    } else if (e.key === "Escape" && calendar) {
      e.preventDefault();
      setCalendar(null);
    } else if (e.key === "Enter" && !touch) {
      commitText(text);
      setCalendar(null);
    } else if ((e.key === "Backspace" || e.key === "Delete") && touch && !blocked) {
      e.preventDefault();
      clearDate();
    }
  };

  const adornment = (
    <Box sx={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
      {committed !== "" && !blocked && (
        <IconButton
          size="small"
          sx={ADORNMENT_BUTTON_SX}
          aria-label={t("dateField.clear")}
          // Keep focus where it is: the clear must not first blur the field.
          onMouseDown={(e: MouseEvent) => e.preventDefault()}
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
        onMouseDown={(e: MouseEvent) => e.preventDefault()}
        onClick={() => (calendar ? setCalendar(null) : openCalendar(true))}
      >
        <MaterialSymbol icon="calendar_today" size={18} />
      </IconButton>
    </Box>
  );

  const inputSlot = composeSlot(InputProps, slotProps?.input, { endAdornment: adornment });
  const htmlInputSlot = composeSlot(inputProps, htmlInput, {
    autoComplete: "off",
    "aria-haspopup": "dialog",
    "aria-expanded": calendar !== null,
    "aria-controls": calendar ? calendarId : undefined,
    ...(touch && { readOnly: true, inputMode: "none" }),
  });

  return (
    <>
      <TextField
        {...rest}
        ref={rootRef}
        type="text"
        value={text}
        placeholder={pattern}
        disabled={disabled}
        inputRef={handleInputRef}
        error={invalid || error}
        helperText={invalid ? t("dateField.invalid", { pattern }) : helperText}
        slotProps={
          { ...slotProps, input: inputSlot, htmlInput: htmlInputSlot } as TextFieldProps["slotProps"]
        }
        onKeyDown={onFieldKey}
        onClick={(e) => {
          if (e.target === ownInputRef.current && !calendar) openCalendar(touch);
        }}
        onFocus={(e) => {
          focused.current = true;
          onFocus?.(e);
        }}
        onChange={(e) => {
          if (touch) return;
          setText(e.target.value);
          if (invalid) setInvalid(false);
        }}
        onBlur={(e) => {
          focused.current = false;
          if (!touch) commitText(text);
          onBlur?.(e);
        }}
      />
      {!blocked && (
        <DateCalendarPopover
          id={calendarId}
          open={calendar !== null}
          anchorEl={rootRef.current}
          value={committed}
          weekLocale={locale}
          min={min}
          max={max}
          autoFocusGrid={calendar?.autoFocusGrid ?? false}
          onSelect={pickDate}
          onClear={committed !== "" ? clearDate : undefined}
          onClose={closeCalendar}
        />
      )}
    </>
  );
}

type SlotValue = object | ((ownerState: unknown) => object) | undefined;

/**
 * Merge a TextField slot's props: our additions first, then the deprecated
 * top-level prop, then the slot prop — the caller always wins. Function-form
 * slot props are composed rather than replaced.
 */
function composeSlot(deprecated: object | undefined, slot: unknown, extras: object): SlotValue {
  if (typeof slot === "function") {
    return (ownerState: unknown) => ({
      ...extras,
      ...deprecated,
      ...(slot as (o: unknown) => object)(ownerState),
    });
  }
  return { ...extras, ...deprecated, ...(slot as object | undefined) };
}
