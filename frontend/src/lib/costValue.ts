/**
 * A cost attribute as a number, or 0. Cost fields carried no numeric check on
 * write before 2.157.9, so a value can arrive as text: a numeric string counts
 * (as the backend's `cost_value` reads it), anything else counts as nothing,
 * never a string concatenated into a sum.
 */

// A plain decimal, as the backend's `cost_value` reads it: digits, one point,
// an optional exponent, surrounding whitespace. Not everything `Number()`
// parses (`"0x10"` is not a cost), so the backend and frontend roll-ups agree.
// The digits before a point can be split only one way: `\d+\.?\d*` could split
// a run of digits between its two halves, so a long stored digit string that
// failed at its last character backtracked quadratically and froze the tab.
const PLAIN_DECIMAL = /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*$/;

/** Whether `v` is a string spelling a plain decimal number. */
export function isNumericText(v: unknown): v is string {
  return typeof v === "string" && PLAIN_DECIMAL.test(v);
}

/** `v` as a finite number, or 0 when it is not one. */
export function costValue(v: unknown): number {
  const n = typeof v === "number" ? v : isNumericText(v) ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}
