import { describe, it, expect } from "vitest";
import {
  emptySeed,
  riskLevelChipColor,
  seedFromCompliance,
  seedFromCve,
} from "./riskDefaults";
import type {
  TurboLensComplianceFinding,
  TurboLensCveFinding,
} from "@/types";

function cve(overrides: Partial<TurboLensCveFinding> = {}): TurboLensCveFinding {
  return {
    id: "f1",
    run_id: "r1",
    card_id: "c1",
    card_name: "NexaCore ERP",
    card_type: "Application",
    cve_id: "CVE-2024-12345",
    vendor: "apache",
    product: "http_server",
    version: "2.4.58",
    cvss_score: 9.1,
    cvss_vector: "CVSS:3.1/AV:N/...",
    severity: "critical",
    attack_vector: "NETWORK",
    exploitability_score: 3.9,
    impact_score: 5.9,
    patch_available: false,
    published_date: "2024-05-01",
    last_modified_date: "2024-06-01",
    description: "Remote code execution.",
    nvd_references: null,
    priority: "critical",
    probability: "very_high",
    business_impact: "Fronts customer orders.",
    remediation: "Upgrade to 2.4.60.",
    status: "open",
    risk_id: null,
    risk_reference: null,
    created_at: null,
    ...overrides,
  };
}

function compliance(
  overrides: Partial<TurboLensComplianceFinding> = {},
): TurboLensComplianceFinding {
  return {
    id: "c1",
    run_id: "r1",
    regulation: "eu_ai_act",
    regulation_article: "Art. 6",
    card_id: "card-1",
    card_name: "Pricing Engine",
    scope_type: "card",
    category: "ai_governance",
    requirement: "Maintain a registry of high-risk AI systems.",
    status: "non_compliant",
    severity: "high",
    gap_description: "No registry exists.",
    evidence: null,
    remediation: "Create and maintain the registry.",
    ai_detected: true,
    risk_id: null,
    risk_reference: null,
    created_at: null,
    ...overrides,
  };
}

describe("seedFromCve", () => {
  it("prefills title, category, probability, impact and card link", () => {
    const seed = seedFromCve(cve());
    expect(seed.mode).toBe("cve");
    expect(seed.findingId).toBe("f1");
    expect(seed.category).toBe("security");
    expect(seed.title).toContain("CVE-2024-12345");
    expect(seed.title).toContain("NexaCore ERP");
    expect(seed.initial_probability).toBe("very_high");
    expect(seed.initial_impact).toBe("critical");
    expect(seed.mitigation).toBe("Upgrade to 2.4.60.");
    expect(seed.cardIds).toEqual(["c1"]);
    // Description includes description + business impact + CVSS.
    expect(seed.description).toContain("Remote code execution.");
    expect(seed.description).toContain("Business impact");
    expect(seed.description).toContain("CVSS 9.1");
  });

  it("falls back to safe defaults on unknown severity/probability", () => {
    const seed = seedFromCve(
      cve({ severity: "unknown", probability: "unknown" }),
    );
    expect(seed.initial_probability).toBe("medium");
    expect(seed.initial_impact).toBe("medium");
  });
});

describe("seedFromCompliance", () => {
  it("escalates probability for non_compliant findings", () => {
    const seed = seedFromCompliance(compliance());
    expect(seed.mode).toBe("compliance");
    expect(seed.category).toBe("compliance");
    expect(seed.initial_probability).toBe("high");
    expect(seed.initial_impact).toBe("high");
    expect(seed.title.startsWith("Art. 6")).toBe(true);
    expect(seed.mitigation).toBe("Create and maintain the registry.");
    expect(seed.cardIds).toEqual(["card-1"]);
    expect(seed.description).toContain("Maintain a registry");
    expect(seed.description).toContain("No registry exists.");
  });

  it("uses landscape title when there is no card link", () => {
    const seed = seedFromCompliance(
      compliance({ card_id: null, card_name: null, regulation_article: null }),
    );
    expect(seed.title.toLowerCase()).toContain("landscape");
    expect(seed.cardIds).toEqual([]);
  });

  it("defaults compliant findings to medium probability", () => {
    const seed = seedFromCompliance(compliance({ status: "partial" }));
    expect(seed.initial_probability).toBe("medium");
  });
});

describe("emptySeed", () => {
  it("returns a manual seed with optional card prefill", () => {
    const seed = emptySeed(["x", "y"]);
    expect(seed.mode).toBe("manual");
    expect(seed.cardIds).toEqual(["x", "y"]);
    expect(seed.category).toBe("operational");
  });
});

describe("riskLevelChipColor", () => {
  it("maps levels to MUI chip colors", () => {
    expect(riskLevelChipColor("critical")).toBe("error");
    expect(riskLevelChipColor("high")).toBe("warning");
    expect(riskLevelChipColor("medium")).toBe("info");
    expect(riskLevelChipColor("low")).toBe("success");
    expect(riskLevelChipColor(null)).toBe("default");
    expect(riskLevelChipColor(undefined)).toBe("default");
  });
});
