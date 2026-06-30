/**
 * KeyInput — validated text field for entity keys (field keys, option keys,
 * type keys, relation keys, subtype keys).
 *
 * Convention (matches existing metamodel):
 *   - CamelCase:  BusinessCapability, relAppToITC, costTotalAnnual
 *   - Plain lowercase: application, provider, system
 *   - Must start with a letter
 *   - Letters and digits only — no underscores, spaces, or special characters
 *   - No accented characters
 *
 * Provides real-time visual feedback as the user types.
 */
import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import TextField from "@mui/material/TextField";
import type { TextFieldProps } from "@mui/material/TextField";

/** Valid key: starts with a letter, then letters and digits only. */
const KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9]*$/;

export interface KeyInputProps
  extends Omit<TextFieldProps, "value" | "onChange" | "error" | "helperText"> {
  value: string;
  onChange: (value: string) => void;
  /** When true, auto-coerces input (strip invalid chars, accents). Default true. */
  autoFormat?: boolean;
  /** Additional validation error (e.g. "key already exists"). Shown when non-empty. */
  externalError?: string;
  /** When true, the key is locked and cannot be changed. */
  locked?: boolean;
  /** Text shown when locked. */
  lockedReason?: string;
  /**
   * When true, an empty value is treated as invalid and the border/label turn
   * red (no extra helper text) — used to flag a mandatory key field that still
   * needs filling in. Callers control *when* a key becomes required (e.g. once
   * the row's label has been typed) by toggling this prop, so the field is not
   * shown red on a pristine, not-yet-started row.
   */
  required?: boolean;
}

function validate(value: string): string {
  if (!value) return "";
  if (/^[0-9]/.test(value)) return "key.mustStartWithLetter";
  if (/_/.test(value)) return "key.noUnderscores";
  if (/\s/.test(value)) return "key.noSpaces";
  if (/[àáâãäåèéêëìíîïòóôõöùúûüýÿñçæœ]/i.test(value))
    return "key.noAccents";
  if (!KEY_PATTERN.test(value))
    return "key.lettersAndDigitsOnly";
  return "";
}

/** Auto-coerce a raw string into a valid key (strip invalid chars). */
function coerce(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-zA-Z0-9]/g, "");  // strip everything except letters + digits
}

export default function KeyInput({
  value,
  onChange,
  autoFormat = true,
  externalError,
  locked = false,
  lockedReason,
  required = false,
  ...rest
}: KeyInputProps) {
  const { t } = useTranslation("validation");
  const [touched, setTouched] = useState(false);
  const [internalError, setInternalError] = useState("");

  useEffect(() => {
    if (touched || value) {
      setInternalError(validate(value));
    }
  }, [value, touched]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setTouched(true);
      const raw = e.target.value;
      if (autoFormat) {
        onChange(coerce(raw));
      } else {
        onChange(raw);
      }
    },
    [onChange, autoFormat],
  );

  const errorKey = touched ? internalError : "";
  const displayError = externalError || (errorKey ? t(errorKey) : "");
  const showSuccess = touched && !externalError && !errorKey && value.length > 0;
  // A mandatory but still-empty key: flag the border/label red without adding
  // any error helper text. The caller toggles `required` (e.g. once the row's
  // label has been typed), so a not-yet-started row is never shown red.
  const requiredEmpty = required && !locked && !value;

  return (
    <TextField
      {...rest}
      value={value}
      onChange={handleChange}
      disabled={locked}
      error={!!displayError || requiredEmpty}
      helperText={
        locked
          ? lockedReason || t("key.cannotChange")
          : displayError || (showSuccess ? t("key.valid") : t("key.hint"))
      }
      slotProps={{
        input: {
          sx: {
            fontFamily: "monospace",
            fontSize: "0.85rem",
          },
        },
        formHelperText: {
          sx: {
            color: displayError ? "error.main" : showSuccess ? "success.main" : "text.secondary",
          },
        },
      }}
      color={showSuccess && !displayError ? "success" : displayError ? "error" : undefined}
    />
  );
}

/** Validate a key without the component — for programmatic checks. */
export function isValidKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}

/** Coerce a string to valid key format. */
export { coerce as coerceKey };
