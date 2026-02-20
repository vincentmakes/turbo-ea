import type { FieldDef } from "@/types";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

export function emptyField(): FieldDef {
  return { key: "", label: "", type: "text", required: false, weight: 0 };
}

export function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "\u2026" : text;
}
