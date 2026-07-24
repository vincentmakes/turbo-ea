import { useEffect, useRef, useState } from "react";
import { TextField, type TextFieldProps } from "@mui/material";

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
 * Every native date input in the app should use this component so the bug
 * cannot be reintroduced by copy-paste.
 */
export function DateField({
  value,
  onChange,
  onFocus,
  onBlur,
  InputLabelProps,
  ...rest
}: DateFieldProps) {
  const [draft, setDraft] = useState(value ?? "");
  const focused = useRef(false);

  // Mirror external updates only while the user is not editing.
  useEffect(() => {
    if (!focused.current) setDraft(value ?? "");
  }, [value]);

  return (
    <TextField
      {...rest}
      type="date"
      value={draft}
      InputLabelProps={{ shrink: true, ...InputLabelProps }}
      onFocus={(e) => {
        focused.current = true;
        setDraft(value ?? "");
        onFocus?.(e);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        focused.current = false;
        if (draft !== (value ?? "")) onChange(draft);
        onBlur?.(e);
      }}
    />
  );
}

export default DateField;
