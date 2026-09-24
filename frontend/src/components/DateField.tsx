import { useEffect, useMemo, useRef, useState } from "react";
import { TextField, type TextFieldProps } from "@mui/material";
import { useTranslation } from "react-i18next";
import SafariDateField from "@/components/SafariDateField";
import { currentDateInputEngine } from "@/lib/browserEngine";

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
 * The app's one date input. Every date field goes through it so the bugs
 * below cannot come back by copy-paste.
 *
 * **Two renderings, one API.** Chrome and Firefox get a native
 * `<input type="date">` ({@link NativeDateField}) and look exactly as they
 * always have. Safari — on Mac, iPhone and iPad — gets {@link SafariDateField}:
 * WebKit's native date picker is drawn by the operating system, cannot be
 * styled or suppressed, renders tiny, and fills an empty field with today's
 * date (#1142). The only way to give Safari one consistent picker is not to
 * render a native date input there at all.
 *
 * Both renderings share two guarantees a bare MUI `TextField type="date"` does
 * not give:
 *  1. **Focus-protected display** — while focused the field renders a local
 *     draft and ignores incoming `value` changes, so a parent that round-trips
 *     every edit through the server cannot clobber the caret (#865: on a
 *     `DD.MM.YYYY` locale typing the year saved `0002 → 0020 → 0202 …`).
 *  2. **Commit on blur** — `onChange` fires once, with the final value, when
 *     the field is left, instead of once per intermediate valid date.
 *
 * Neither depends on the display language or date format: values are ISO
 * `yyyy-mm-dd` throughout, and whatever is shown or parsed takes its order from
 * `Intl` for the browser's locale.
 */
export function DateField(props: DateFieldProps) {
  const engine = useMemo(currentDateInputEngine, []);
  if (engine === "other") return <NativeDateField {...props} />;
  return <SafariDateField {...props} touch={engine === "webkit-touch"} />;
}

/**
 * Native `<input type="date">` for Blink and Gecko, left otherwise untouched.
 *
 * Beyond the two shared guarantees it never assumes an event order: a change
 * that lands after the field has already blurred is committed at once, and
 * focusing never resets the draft. A date input's value stays `""` until every
 * segment is filled, so `validity.badInput` is what tells "cleared" apart from
 * "incomplete": leaving a half-typed date commits nothing and shows an error
 * until it is completed or cleared.
 */
function NativeDateField({
  value,
  onChange,
  onFocus,
  onBlur,
  error,
  helperText,
  ...rest
}: DateFieldProps) {
  const { t } = useTranslation("common");
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

  return (
    <TextField
      {...rest}
      type="date"
      value={draft}
      error={incomplete || error}
      helperText={incomplete ? t("dateField.incomplete") : helperText}
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
        // Already blurred (a native picker took focus): nothing else will commit.
        if (!partial && !focused.current) commit(next);
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
  );
}

export default DateField;
