import type { FieldDef } from "@/types";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

export const FIELD_TYPE_OPTIONS: { value: FieldDef["type"]; tKey: string }[] = [
  { value: "text", tKey: "common:fieldTypes.text" },
  { value: "number", tKey: "common:fieldTypes.number" },
  { value: "cost", tKey: "common:fieldTypes.cost" },
  { value: "boolean", tKey: "common:fieldTypes.boolean" },
  { value: "date", tKey: "common:fieldTypes.date" },
  { value: "url", tKey: "common:fieldTypes.url" },
  { value: "single_select", tKey: "common:fieldTypes.singleSelect" },
  { value: "multiple_select", tKey: "common:fieldTypes.multipleSelect" },
];

export const CATEGORIES = [
  "Strategy & Transformation",
  "Business Architecture",
  "Application & Data",
  "Technical Architecture",
];

export const LAYER_ORDER = [...CATEGORIES, "Other"];

export const CARDINALITY_OPTIONS: ("1:1" | "1:n" | "n:m")[] = ["1:1", "1:n", "n:m"];

/* ------------------------------------------------------------------ */
/*  Graph layout constants                                             */
/* ------------------------------------------------------------------ */

export const NODE_W = 160;
export const NODE_H = 56;
export const NODE_RX = 12;
export const NODE_GAP_X = 48;
export const LAYER_GAP_Y = 140;
export const PAD_X = 80;
export const PAD_Y = 80;
export const LAYER_LABEL_W = 180;

/* Edge routing */
export const TRACK_GAP = 10;
export const TRACK_MARGIN = 16;
export const SAME_LAYER_ARC_BASE = 32;
export const SAME_LAYER_ARC_STEP = 18;
export const CORNER_R = 10;
export const LABEL_W = 84;
export const LABEL_H = 20;
