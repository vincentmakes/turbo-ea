/** Helpers that derive ``CreateRiskDialog`` seed values from TurboLens findings. */
import type {
  Risk,
  RiskCategory,
  RiskImpact,
  RiskProbability,
  TurboLensComplianceFinding,
  TurboLensCveFinding,
} from "@/types";

const CVE_SEVERITY_TO_IMPACT: Record<string, RiskImpact> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
};

const COMPLIANCE_SEVERITY_TO_IMPACT: Record<string, RiskImpact> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
  info: "low",
};

function safeProbability(v: string | null | undefined): RiskProbability {
  if (v === "very_high" || v === "high" || v === "medium" || v === "low") return v;
  return "medium";
}

function safeImpact(v: string | null | undefined): RiskImpact {
  if (v === "critical" || v === "high" || v === "medium" || v === "low") return v;
  return "medium";
}

export interface RiskDialogSeed {
  mode: "manual" | "cve" | "compliance";
  title: string;
  description: string;
  category: RiskCategory;
  initial_probability: RiskProbability;
  initial_impact: RiskImpact;
  mitigation: string;
  cardIds: string[];
  /** If set, CreateRiskDialog calls the promote endpoint with this finding id. */
  findingId?: string;
}

export function seedFromCve(finding: TurboLensCveFinding): RiskDialogSeed {
  return {
    mode: "cve",
    findingId: finding.id,
    title: `${finding.cve_id} on ${finding.card_name ?? finding.product ?? finding.card_id}`,
    description: composeCveDescription(finding),
    category: "security",
    initial_probability: safeProbability(finding.probability),
    initial_impact: safeImpact(CVE_SEVERITY_TO_IMPACT[finding.severity]),
    mitigation: finding.remediation ?? "",
    cardIds: [finding.card_id],
  };
}

export function seedFromCompliance(finding: TurboLensComplianceFinding): RiskDialogSeed {
  const where = finding.card_name ?? "landscape";
  const base = finding.regulation_article
    ? `${finding.regulation_article}: ${where}`
    : `${finding.regulation.toUpperCase()}: ${where}`;
  const descriptionParts = [finding.requirement, finding.gap_description].filter(
    (p) => p && p.trim(),
  );
  return {
    mode: "compliance",
    findingId: finding.id,
    title: base,
    description: descriptionParts.join("\n\n"),
    category: "compliance",
    initial_probability: finding.status === "non_compliant" ? "high" : "medium",
    initial_impact: safeImpact(COMPLIANCE_SEVERITY_TO_IMPACT[finding.severity]),
    mitigation: finding.remediation ?? "",
    cardIds: finding.card_id ? [finding.card_id] : [],
  };
}

export function emptySeed(cardIds: string[] = []): RiskDialogSeed {
  return {
    mode: "manual",
    title: "",
    description: "",
    category: "operational",
    initial_probability: "medium",
    initial_impact: "medium",
    mitigation: "",
    cardIds,
  };
}

function composeCveDescription(finding: TurboLensCveFinding): string {
  const blocks: string[] = [];
  if (finding.description) blocks.push(finding.description);
  if (finding.business_impact) blocks.push(`Business impact: ${finding.business_impact}`);
  if (finding.cvss_score != null) {
    blocks.push(
      `CVSS ${finding.cvss_score.toFixed(1)} (${finding.severity}), attack vector: ${
        finding.attack_vector ?? "unknown"
      }.`,
    );
  }
  return blocks.join("\n\n");
}

/** Pick a UI chip colour based on a risk level. Used by both list + detail. */
export function riskLevelChipColor(
  level: Risk["initial_level"] | null | undefined,
): "error" | "warning" | "info" | "success" | "default" {
  switch (level) {
    case "critical":
      return "error";
    case "high":
      return "warning";
    case "medium":
      return "info";
    case "low":
      return "success";
    default:
      return "default";
  }
}
