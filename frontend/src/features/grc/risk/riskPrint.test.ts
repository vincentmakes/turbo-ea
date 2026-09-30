import { describe, expect, it } from "vitest";
import type { MitigationTask, Risk } from "@/types";
import { buildRiskPrintBody, PRINTED_CYCLES_PER_TASK, riskPrintDocument } from "./riskPrint";

function risk(overrides: Partial<Risk> = {}): Risk {
  return {
    id: "r1",
    reference: "R-000042",
    title: "Legacy CRM unsupported",
    description: "Vendor support ends.\nSecond line.",
    category: "technology",
    source_type: "compliance",
    source_ref: "F-1",
    initial_probability: "high",
    initial_impact: "critical",
    initial_level: "critical",
    residual_probability: null,
    residual_impact: null,
    residual_level: null,
    owner_id: "u1",
    owner_name: "Ada Lovelace",
    target_resolution_date: "2026-12-31",
    status: "in_progress",
    acceptance_rationale: null,
    accepted_by: null,
    accepted_at: null,
    created_by: "u1",
    created_at: "2026-01-05T10:00:00Z",
    updated_at: "2026-02-01T10:00:00Z",
    cards: [{ card_id: "c1", card_name: "NexaCore CRM", card_type: "Application", role: "affected" }],
    ...overrides,
  };
}

function task(overrides: Partial<MitigationTask> = {}): MitigationTask {
  return {
    id: "t1",
    reference: "T-000007",
    risk_id: "r1",
    title: "Review access rights",
    description: "Quarterly control",
    owner_id: "u2",
    owner_name: "Grace Hopper",
    recurrence_unit: "months",
    recurrence_interval: 6,
    lead_time_days: 7,
    is_active: true,
    created_by: "u1",
    created_at: "2026-01-06T00:00:00Z",
    updated_at: "2026-01-06T00:00:00Z",
    occurrences: [
      {
        id: "o1", task_id: "t1", sequence: 1, assigned_owner_id: "u2", assigned_owner_name: "Grace Hopper",
        due_date: "2026-03-01", status: "done", activated_at: null, completed_at: "2026-02-20T08:00:00Z",
        completed_by: "u2", completed_by_name: "Grace Hopper", owner_at_completion: "u2",
        owner_at_completion_name: "Grace Hopper", completion_notes: "All good", created_at: "", updated_at: "",
      },
      {
        id: "o2", task_id: "t1", sequence: 2, assigned_owner_id: "u2", assigned_owner_name: "Grace Hopper",
        due_date: "2026-09-01", status: "open", activated_at: null, completed_at: null, completed_by: null,
        completed_by_name: null, owner_at_completion: null, owner_at_completion_name: null,
        completion_notes: null, created_at: "", updated_at: "",
      },
    ],
    ...overrides,
  };
}

describe("buildRiskPrintBody", () => {
  it("renders identification, assessments, tasks with cycles, cards and audit with translated labels", () => {
    const html = buildRiskPrintBody(risk(), [task()]);
    // The SoAW cover: document type, then "reference — title".
    expect(html).toContain('<h1 style="text-align:center;border:none;">Risk</h1>');
    expect(html).toContain(">R-000042 — Legacy CRM unsupported</p>");
    expect(html).not.toContain("doc-chip");
    // Status, level and source are rows of the first table, not chips.
    expect(html).toContain('<td class="meta-label">Status</td><td class="pre">In progress</td>');
    expect(html).toContain('<td class="meta-label">Level</td><td class="pre">Critical</td>');
    expect(html).toContain("Technology");
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("Vendor support ends.\nSecond line.");
    expect(html).toContain("<h2>Initial assessment</h2>");
    expect(html).toContain("<h2>Residual assessment</h2>");
    expect(html).toContain("Not assessed yet");
    expect(html).toContain("<h3>T-000007 — Review access rights</h3>");
    expect(html).toContain("Every 6 months");
    expect(html).toContain("<td>Completed</td>");
    expect(html).toContain("<td>Open</td>");
    expect(html).toContain("by Grace Hopper — All good");
    expect(html).toContain("NexaCore CRM");
    expect(html).toContain("<h2>Audit</h2>");
    // Newest cycle listed first.
    expect(html.indexOf("<td>2</td>")).toBeLessThan(html.indexOf("<td>1</td>"));
  });

  it("shows residual values once assessed and the acceptance rationale once accepted", () => {
    const html = buildRiskPrintBody(
      risk({
        residual_probability: "low",
        residual_impact: "medium",
        residual_level: "low",
        status: "accepted",
        acceptance_rationale: "Cost of mitigation exceeds exposure",
        accepted_at: "2026-03-01T00:00:00Z",
      }),
      [],
    );
    expect(html).not.toContain("Not assessed yet");
    expect(html).toContain("Cost of mitigation exceeds exposure");
    expect(html).toContain("Acceptance rationale");
    expect(html).not.toContain("<h2>Mitigation tasks</h2>");
  });

  it("caps each task's history to the most recent cycles", () => {
    const many = Array.from({ length: PRINTED_CYCLES_PER_TASK + 5 }, (_, i) => ({
      ...task().occurrences[1],
      id: `o${i}`,
      sequence: i + 1,
    }));
    const html = buildRiskPrintBody(risk(), [task({ occurrences: many })]);
    expect(html).toContain(`<td>${PRINTED_CYCLES_PER_TASK + 5}</td>`);
    expect(html).not.toContain("<td>1</td>");
  });

  it("escapes scalar fields", () => {
    const html = buildRiskPrintBody(risk({ title: "<img src=x onerror=alert(1)>" }), []);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("riskPrintDocument names the document by reference and dates the footer", () => {
    const doc = riskPrintDocument(risk(), []);
    expect(doc.title).toBe("R-000042 — Legacy CRM unsupported");
    expect(doc.footerParts).toHaveLength(1);
    expect(doc.footerParts?.[0]).toMatch(/^Printed: /);
  });
});
