import { describe, expect, it } from "vitest";
import type { TurboLensComplianceFinding } from "@/types";
import { buildFindingPrintBody, findingPrintDocument } from "./findingPrint";

function finding(overrides: Partial<TurboLensComplianceFinding> = {}): TurboLensComplianceFinding {
  return {
    id: "f1",
    run_id: null,
    regulation: "eu_ai_act",
    regulation_article: "Art. 9 — Risk management system",
    card_id: "c1",
    card_name: "NexaCore ERP",
    card_type: "Application",
    card_has_ai_features: true,
    scope_type: "card",
    category: "risk_management",
    requirement: "Establish a risk management system.",
    status: "non_compliant",
    severity: "high",
    gap_description: "No documented process.",
    evidence: "Interview with owner",
    remediation: "Write and approve the process",
    ai_detected: true,
    risk_id: "r1",
    risk_reference: "R-000042",
    decision: "in_review",
    reviewed_by: "u1",
    reviewer_name: "Ada Lovelace",
    reviewed_at: "2026-05-01T09:00:00Z",
    review_note: "Owner notified",
    auto_resolved: false,
    last_seen_run_id: null,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-05-01T09:00:00Z",
    ...overrides,
  } as TurboLensComplianceFinding;
}

describe("buildFindingPrintBody", () => {
  it("renders regulation, article, scope, chips, sections and the review trail", () => {
    const html = buildFindingPrintBody(finding(), "EU AI Act");
    // The SoAW cover: document type, then "regulation — article".
    expect(html).toContain('<h1 style="text-align:center;border:none;">Compliance finding</h1>');
    expect(html).toContain(">EU AI Act — Art. 9 — Risk management system</p>");
    expect(html).toContain("<h2>Document Information</h2>");
    expect(html).not.toContain("doc-chip");
    expect(html).toContain('<td class="meta-label">Severity</td><td class="pre">High</td>');
    expect(html).toContain("AI detected");
    expect(html).toContain("NexaCore ERP (Application)");
    expect(html).toContain("Risk Management");
    expect(html).toContain("R-000042");
    expect(html).toContain("<h2>Requirement</h2>");
    expect(html).toContain("No documented process.");
    expect(html).toContain("Interview with owner");
    expect(html).toContain("Write and approve the process");
    expect(html).toContain("Ada Lovelace on ");
    expect(html).toContain("— Owner notified");
  });

  it("suppresses the placeholder gap, names landscape scope and skips an absent review", () => {
    const html = buildFindingPrintBody(
      finding({
        gap_description: "—",
        card_id: null,
        card_name: null,
        card_type: null,
        scope_type: "landscape",
        reviewer_name: null,
        reviewed_at: null,
        review_note: null,
        risk_reference: null,
        risk_id: null,
      }),
      "GDPR",
    );
    expect(html).not.toContain("<h2>Gap</h2>");
    expect(html).toContain(">GDPR — Art. 9 — Risk management system</p>");
    expect(html).toContain("Landscape-wide");
    expect(html).not.toContain("<h2>Reviewed</h2>");
    expect(html).not.toContain("Linked risk");
  });

  it("escapes scalar fields", () => {
    const html = buildFindingPrintBody(finding({ regulation_article: "<script>x</script>" }), "<b>EU</b>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>EU</b>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).toContain("&lt;b&gt;EU&lt;/b&gt;");
  });

  it("findingPrintDocument titles by regulation and article and dates the footer", () => {
    const doc = findingPrintDocument(finding(), "EU AI Act");
    expect(doc.title).toBe("EU AI Act — Art. 9 — Risk management system");
    expect(doc.footerParts?.[0]).toMatch(/^Printed: /);
  });
});
