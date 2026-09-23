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
 * replaced while the user is mid-edit -- e.g. an inline auto-save that
 * round-trips to the server and feeds the response back as the controlled
 * value. Native date inputs fire `change` on every keystroke that forms a valid
 * date, so on a locale like `DD.MM.YYYY` typing the year segment saved
 * `0002 -> 0020 -> 0202 ...` and each response reset the control, making it
 * impossible to type the year at all (issue #865, GRC Risk "Target date").
 *
 * This wrapper adds two guarantees the bare field does not:
 *  1. **Focus-protected display** -- while focused it renders a local draft and
 *     ignores incoming `value` changes, so a re-render never clobbers the caret.
 *  2. **Commit on blur** -- `onChange` fires once, with the final value, when the
 *     field is left, instead of once per intermediate valid date.
 *
 * Safari/WebKit fix (#1142): Safari does not reliably fire the
 * React-normalised `onChange` (bound to the native `input` event) when a
 * date is picked via the native calendar/scrubber widget -- only a native
 * `change` event fires, and sometimes only on blur. Chromium fires `input`
 * on every valid segment change, which the rest of this component assumes.
 * Attaching raw native `input` AND `change` listeners via a ref closes that
 * gap without affecting Chromium/Firefox behaviour (both events carry the
 * same `target.value` there, so the draft is simply set twice, a no-op).
 *
 * Also explicitly re-asserts `input.value` imperatively whenever `draft`
 * changes. React's controlled-value diffing can skip writing to the DOM
 * when its own record of the previous value did not change, but Safari can
 * independently retain a stale native widget value (observed as an empty
 * date field visually showing today's date) if the DOM was never touched
 * directly. Writing `input.value` unconditionally, keyed on the value we
 * intend to display, guarantees WebKit's native widget matches React state
 * even when React itself thinks nothing changed.
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
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Mirror external updates only while the user is not editing.
  useEffect(() => {
    if (!focused.current) setDraft(value ?? "");
  }, [value]);

  // Force the native DOM value to match `draft` on every render. Guards
  // against Safari retaining a stale internal widget value that React's
  // controlled-value diffing believes is already correct.
  useEffect(() => {
    const el = inputRef.current;
    if (el && el.value !== (draft ?? "")) {
      el.value = draft ?? "";
    }
  }, [draft]);

  // Safari does not reliably fire the React `input`-based onChange when a
  // date is picked via the native calendar widget. Native `change` (and a
  // redundant native `input`) listeners close that gap; harmless no-op
  // duplication on Chromium/Firefox, which already fire `input` correctly.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const handleNative = (e: Event) => {
      const v = (e.target as HTMLInputElement).value;
      setDraft(v);
    };
    el.addEventListener("input", handleNative);
    el.addEventListener("change", handleNative);
    return () => {
      el.removeEventListener("input", handleNative);
      el.removeEventListener("change", handleNative);
    };
  }, []);

  return (
    <TextField
      {...rest}
      type="date"
      value={draft}
      InputLabelProps={{ shrink: true, ...InputLabelProps }}
      inputRef={inputRef}
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
