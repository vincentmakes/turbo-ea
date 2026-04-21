/**
 * Shared utilities for TurboLens feature — color mappers, formatters, types.
 */
import type { ChipProps } from "@mui/material/Chip";

// ── Status types ────────────────────────────────────────────────────────

export interface TurboLensStatus {
  ai_configured: boolean;
  ready: boolean;
}

// ── Cost formatting ─────────────────────────────────────────────────────

export function formatCost(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return value.toFixed(0);
}

// ── Color mappers ───────────────────────────────────────────────────────

type ChipColor = ChipProps["color"];

const STATUS_COLORS: Record<string, ChipColor> = {
  confirmed: "success",
  dismissed: "default",
  investigating: "warning",
  pending: "info",
  open: "info",
  resolved: "success",
  completed: "success",
  failed: "error",
  running: "warning",
};

export function statusColor(status: string): ChipColor {
  return STATUS_COLORS[status] ?? "default";
}

const PRIORITY_COLORS: Record<string, ChipColor> = {
  critical: "error",
  high: "error",
  medium: "warning",
  low: "info",
};

export function priorityColor(priority: string): ChipColor {
  return PRIORITY_COLORS[priority] ?? "default";
}

const EFFORT_COLORS: Record<string, ChipColor> = {
  high: "error",
  medium: "warning",
  low: "success",
};

export function effortColor(effort: string): ChipColor {
  return EFFORT_COLORS[effort] ?? "default";
}

const VENDOR_TYPE_COLORS: Record<string, ChipColor> = {
  vendor: "primary",
  product: "secondary",
  platform: "info",
  module: "warning",
  unknown: "default",
};

export function vendorTypeColor(vendorType: string): ChipColor {
  return VENDOR_TYPE_COLORS[vendorType] ?? "default";
}

// ── Architecture result color helpers ───────────────────────────────────

export const TYPE_COLORS: Record<string, string> = {
  existing: "#4caf50",
  new: "#2196f3",
  recommended: "#ff9800",
};

export function typeChipColor(
  tp: string,
): "success" | "primary" | "warning" {
  return tp === "existing"
    ? "success"
    : tp === "new"
      ? "primary"
      : "warning";
}

export function urgencyColor(
  u?: string,
): "error" | "warning" | "default" {
  return u === "critical"
    ? "error"
    : u === "high"
      ? "warning"
      : "default";
}

export function severityIcon(s?: string): string {
  return s === "high"
    ? "error"
    : s === "medium"
      ? "warning"
      : "check_circle";
}

export function severityColor(s?: string): string {
  return s === "high"
    ? "#d32f2f"
    : s === "medium"
      ? "#ed6c02"
      : "#2e7d32";
}

// ── Architect steps ─────────────────────────────────────────────────────

/** High-level stepper groups that map internal archPhase numbers to UI steps. */
export const ARCHITECT_STEPS = [
  { key: "requirements", phases: [0] },
  { key: "business_fit", phases: [1] },
  { key: "technical_fit", phases: [2] },
  { key: "solution_options", phases: [3] },
  { key: "product_selection", phases: [3.5] },
  { key: "dependencies", phases: [4] },
  { key: "target", phases: [5] },
] as const;

/** Map an archPhase number to the ARCHITECT_STEPS index (0-based). */
export function phaseToStepIndex(phase: number): number {
  for (let i = 0; i < ARCHITECT_STEPS.length; i++) {
    if ((ARCHITECT_STEPS[i].phases as readonly number[]).includes(phase)) return i;
  }
  return 0;
}

const APPROACH_COLORS: Record<string, ChipColor> = {
  buy: "info",
  build: "primary",
  extend: "warning",
  reuse: "success",
};

export function approachColor(approach: string): ChipColor {
  return APPROACH_COLORS[approach] ?? "default";
}

// ── Security & Compliance color helpers ─────────────────────────────────

const CVE_SEVERITY_COLORS: Record<string, ChipColor> = {
  critical: "error",
  high: "error",
  medium: "warning",
  low: "info",
  unknown: "default",
};

export function cveSeverityColor(severity: string): ChipColor {
  return CVE_SEVERITY_COLORS[severity] ?? "default";
}

const CVE_STATUS_COLORS: Record<string, ChipColor> = {
  open: "error",
  acknowledged: "info",
  in_progress: "warning",
  mitigated: "success",
  accepted: "default",
};

export function cveStatusColor(status: string): ChipColor {
  return CVE_STATUS_COLORS[status] ?? "default";
}

const PROBABILITY_COLORS: Record<string, ChipColor> = {
  very_high: "error",
  high: "warning",
  medium: "info",
  low: "success",
  unknown: "default",
};

export function probabilityColor(probability: string): ChipColor {
  return PROBABILITY_COLORS[probability] ?? "default";
}

const COMPLIANCE_STATUS_COLORS: Record<string, ChipColor> = {
  compliant: "success",
  partial: "warning",
  non_compliant: "error",
  not_applicable: "default",
  review_needed: "info",
};

export function complianceStatusColor(status: string): ChipColor {
  return COMPLIANCE_STATUS_COLORS[status] ?? "default";
}

/** 5x5 risk matrix cell background based on (probability index, severity index). */
export function riskMatrixColor(probIdx: number, sevIdx: number): string {
  // Lower index = more severe. Blend probability + severity into a hot/cold scale.
  const heat = (4 - probIdx) + (4 - sevIdx);
  if (heat >= 7) return "rgba(211, 47, 47, 0.28)";   // deep red
  if (heat >= 5) return "rgba(245, 124, 0, 0.24)";   // orange
  if (heat >= 3) return "rgba(251, 192, 45, 0.22)";  // amber
  if (heat >= 1) return "rgba(56, 142, 60, 0.18)";   // green
  return "rgba(117, 117, 117, 0.12)";                 // grey
}
