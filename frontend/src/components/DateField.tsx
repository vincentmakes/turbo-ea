import { useEffect, useRef, useState } from "react";
import { TextField, type TextFieldProps } from "@mui/material";
import { useTranslation } from "react-i18next";

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
 *  - **Empty looks empty.** An empty WebKit date input draws today's date as
 *    its placeholder, which reads as a real value. `data-empty` greys the
 *    segments while the field is empty and not being edited.
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
  inputProps,
  slotProps,
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

  const htmlInput = slotProps?.htmlInput;
  const emptyAttr = { "data-empty": draft === "" && !incomplete ? "true" : undefined };
  const mergedHtmlInput =
    typeof htmlInput === "function"
      ? (ownerState: Parameters<typeof htmlInput>[0]) => ({
          ...inputProps,
          ...htmlInput(ownerState),
          ...emptyAttr,
        })
      : { ...inputProps, ...htmlInput, ...emptyAttr };

  return (
    <TextField
      {...rest}
      type="date"
      value={draft}
      error={incomplete || error}
      helperText={incomplete ? t("dateField.incomplete") : helperText}
      slotProps={{ ...slotProps, htmlInput: mergedHtmlInput }}
      sx={[
        {
          "& input[data-empty]:not(:focus)::-webkit-datetime-edit": {
            color: "text.disabled",
          },
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
        // Already blurred (the picker took focus): nothing else will commit.
        if (!focused.current && !partial) commit(next);
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
