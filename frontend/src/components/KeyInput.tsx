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
}

function validate(value: string): string {
  if (!value) return "";
  if (/^[0-9]/.test(value)) return "Must start with a letter";
  if (/_/.test(value)) return "Underscores are not allowed — use camelCase";
  if (/\s/.test(value)) return "Spaces are not allowed — use camelCase";
  if (/[àáâãäåèéêëìíîïòóôõöùúûüýÿñçæœ]/i.test(value))
    return "Accented characters are not allowed";
  if (!KEY_PATTERN.test(value))
    return "Only letters and digits allowed (camelCase)";
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
  ...rest
}: KeyInputProps) {
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

  const error = externalError || (touched ? internalError : "");
  const showSuccess = touched && !error && value.length > 0;

  return (
    <TextField
      {...rest}
      value={value}
      onChange={handleChange}
      disabled={locked}
      error={!!error}
      helperText={
        locked
          ? lockedReason || "Key cannot be changed after creation"
          : error || (showSuccess ? "Valid key" : "Letters and digits only, camelCase (e.g. businessFit)")
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
            color: error ? "error.main" : showSuccess ? "success.main" : "text.secondary",
          },
        },
      }}
      color={showSuccess && !error ? "success" : error ? "error" : undefined}
    />
  );
}

/** Validate a key without the component — for programmatic checks. */
export function isValidKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}

/** Coerce a string to valid key format. */
export { coerce as coerceKey };
