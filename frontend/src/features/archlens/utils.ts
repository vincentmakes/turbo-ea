/**
 * Shared utilities for ArchLens feature — color mappers, formatters, types.
 */
import type { ChipProps } from "@mui/material/Chip";

// ── Status types ────────────────────────────────────────────────────────

export interface ArchLensStatus {
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
  canonical: "primary",
  alias: "secondary",
  subsidiary: "info",
  parent: "warning",
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

// ── Architect phases ────────────────────────────────────────────────────

export const ARCHITECT_PHASES = [1, 2, 3] as const;
