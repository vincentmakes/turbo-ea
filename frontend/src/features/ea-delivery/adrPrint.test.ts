import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerExtension, resetExtensionHost, UI_SDK_VERSION } from "@/lib/extensionHost";
import type { ArchitectureDecision } from "@/types";
import { adrPrintDocument, buildAdrPrintBody, printAdr } from "./adrPrint";

function adr(overrides: Partial<ArchitectureDecision> = {}): ArchitectureDecision {
  return {
    id: "adr-1",
    reference_number: "ADR-0001",
    title: "Adopt event bus",
    status: "signed",
    context: "<p>Because <strong>latency</strong></p>",
    decision: "<p>Use Kafka</p>",
    consequences: null,
    alternatives_considered: "<p> </p>",
    related_decisions: [],
    attributes: {},
    created_by: "u1",
    creator_name: "Ada Lovelace",
    signatories: [
      { user_id: "u2", display_name: "Grace Hopper", status: "signed", signed_at: "2026-06-02T09:30:00Z" },
      { user_id: "u3", display_name: "Linus", status: "pending", signed_at: null },
    ],
    signed_at: "2026-06-02T09:30:00Z",
    revision_number: 2,
    parent_id: null,
    linked_cards: [{ id: "c1", name: "NexaCore ERP", type: "Application" }],
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T12:00:00Z",
    ...overrides,
  };
}

beforeEach(() => resetExtensionHost());
afterEach(() => vi.restoreAllMocks());

describe("buildAdrPrintBody", () => {
  it("renders the metadata, sections, linked cards and signatures in document order", () => {
    const html = buildAdrPrintBody(adr());
    // The SoAW cover: document type, then "ADR-0001 · Rev 2 — title".
    expect(html).toContain('<h1 style="text-align:center;border:none;">Architecture Decision Record</h1>');
    expect(html).toContain(">ADR-0001 · Rev 2 — Adopt event bus</p>");
    expect(html).toContain("<h2>Document Information</h2>");
    expect(html).toContain("Signed");
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("Grace Hopper");
    expect(html).toContain("<h2>Context</h2><p>Because <strong>latency</strong></p>");
    expect(html).toContain("<h2>Decision</h2><p>Use Kafka</p>");
    // Empty / whitespace-only sections are omitted.
    expect(html).not.toContain("<h2>Consequences</h2>");
    expect(html).not.toContain("<h2>Alternatives");
    expect(html).toContain("NexaCore ERP");
    expect(html).toContain('<div class="doc-signatures"><h2>Signatures</h2>');
    expect(html).toContain('sig-card approved');
    expect(html).toContain('sig-card pending');
    expect(html).not.toContain("fully-signed");
    expect(html.indexOf("<h2>Context</h2>")).toBeLessThan(html.indexOf("NexaCore ERP"));
    expect(html.indexOf("NexaCore ERP")).toBeLessThan(html.indexOf("sig-grid"));
  });

  it("badges the signature heading once every signatory has signed, like the SoAW", () => {
    const html = buildAdrPrintBody(
      adr({ signatories: [{ user_id: "u2", display_name: "Grace", status: "signed", signed_at: "2026-06-02T09:30:00Z" }] }),
    );
    expect(html).toContain('<span class="sig-badge fully-signed">Fully Signed</span>');
  });

  it("escapes scalar fields so a hostile title renders as text", () => {
    const html = buildAdrPrintBody(adr({ title: `<script>alert(1)</script>` }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("renders extension export sections and skips a throwing builder", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerExtension("daaf", {
      key: "daaf",
      sdkVersion: UI_SDK_VERSION,
      adrExportSections: [
        {
          id: "savings",
          build: () => [
            { heading: "Savings", paragraphs: ["Total: 50,000"], table: { headers: ["Year"], rows: [["2026"]] } },
          ],
        },
        {
          id: "boom",
          build: () => {
            throw new Error("kaboom");
          },
        },
      ],
    });
    const html = buildAdrPrintBody(adr());
    expect(html).toContain("<h2>Savings</h2><p>Total: 50,000</p>");
    expect(html).toContain("<th>Year</th>");
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("buildAdrPrintBody — decision register", () => {
  const REGISTERED = adr({
    standing: "in_force",
    decided_on: "2026-06-01",
    effective_from: "2026-06-03",
    valid_until: "2027-06-01",
    decision_makers: [{ user_id: "u1", display_name: "Ada Lovelace" }],
    participants: [{ user_id: null, display_name: "Architecture Board" }],
    change_summary: "Narrowed to §3\nDropped the pilot",
    links: {
      outgoing: [
        {
          id: "l1",
          kind: "replaces",
          note: "§3 only",
          decision: {
            id: "b",
            reference_number: "ADR-0003",
            revision_number: 1,
            title: "Use RabbitMQ",
            status: "signed",
            standing: "superseded",
          },
        },
      ],
      incoming: [
        {
          id: null,
          kind: "relates",
          note: null,
          decision: {
            id: "c",
            reference_number: "ADR-0009",
            revision_number: 1,
            title: "Event naming",
            status: "signed",
            standing: "in_force",
          },
        },
      ],
    },
    files: [
      {
        id: "f1",
        name: "board-minutes.pdf",
        mime_type: "application/pdf",
        size: 10,
        created_at: null,
        created_by: null,
      },
    ],
  });

  it("lists the standing, the dates and the people in the facts table", () => {
    const html = buildAdrPrintBody(REGISTERED);
    expect(html).toContain('<td class="meta-label">Standing</td><td class="pre">In force</td>');
    expect(html).toContain('<td class="meta-label">Decided on</td>');
    expect(html).toContain('<td class="meta-label">Effective from</td>');
    expect(html).toContain('<td class="meta-label">Valid until</td>');
    expect(html).toContain(
      '<td class="meta-label">Decision makers</td><td class="pre">Ada Lovelace</td>',
    );
    expect(html).toContain(
      '<td class="meta-label">Participants</td><td class="pre">Architecture Board</td>',
    );
  });

  it("prints the change summary, both link directions with notes, and the file names", () => {
    const html = buildAdrPrintBody(REGISTERED);
    expect(html).toContain('<h2>Change summary</h2><p class="pre">Narrowed to §3\nDropped the pilot</p>');
    expect(html).toContain("<h2>Linked decisions</h2>");
    expect(html).toContain("<th>Relation</th><th>Decision</th><th>Note</th>");
    expect(html).toContain("<td>Replaces</td><td>ADR-0003 — Use RabbitMQ</td><td>§3 only</td>");
    expect(html).toContain("<td>Related to</td><td>ADR-0009 — Event naming</td><td></td>");
    expect(html).toContain("<h2>Files</h2>");
    expect(html).toContain("<td>board-minutes.pdf</td>");
    expect(html.indexOf("<h2>Linked decisions</h2>")).toBeLessThan(html.indexOf("<h2>Files</h2>"));
  });

  it("leaves out the empty register blocks", () => {
    const html = buildAdrPrintBody(adr());
    expect(html).not.toContain("Change summary");
    expect(html).not.toContain("Linked decisions");
    expect(html).not.toContain("<h2>Files</h2>");
    expect(html).not.toContain("Standing");
  });

  it("replaces the signatures with one line for a recorded decision", () => {
    const html = buildAdrPrintBody(
      adr({
        signatories: [],
        signed_at: null,
        recorded_at: "2026-05-01T08:00:00Z",
        recorded_by: { user_id: "u9", display_name: "Grace Hopper" },
      }),
    );
    expect(html).toContain('<td class="meta-label">Status</td><td class="pre">Recorded</td>');
    expect(html).toMatch(
      /<h2>Signatures<\/h2><p>Recorded by Grace Hopper on .+, not signed in Turbo EA\.<\/p>/,
    );
    expect(html).not.toContain("doc-signatures");
  });

  it("handles a signed decision with no signatories", () => {
    const html = buildAdrPrintBody(adr({ signatories: [] }));
    expect(html).not.toContain("doc-signatures");
    expect(adrPrintDocument(adr({ signatories: [] })).footerParts).toEqual([]);
  });
});

describe("adrPrintDocument / printAdr", () => {
  it("names the document by reference and carries approver, approval date and print date in the footer", () => {
    const doc = adrPrintDocument(adr());
    expect(doc.title).toBe("ADR-0001 · Rev 2 — Adopt event bus");
    expect(doc.footerParts?.[0]).toBe("Approved by: Grace Hopper");
    expect(doc.footerParts?.[1]).toMatch(/^Date of approval: /);
    expect(doc.footerParts?.[2]).toMatch(/^Printed: /);
  });

  it("a draft with no signatories has no footer, the SoAW rule", () => {
    const doc = adrPrintDocument(adr({ status: "draft", signatories: [], signed_at: null }));
    expect(doc.footerParts).toEqual([]);
  });

  it("writes into a pre-opened window when one is passed", () => {
    vi.useFakeTimers();
    const win = { document: { write: vi.fn(), close: vi.fn() }, print: vi.fn() } as unknown as Window;
    const openSpy = vi.spyOn(window, "open");
    printAdr(adr(), win);
    expect(openSpy).not.toHaveBeenCalled();
    expect(win.document.write).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("buildAdrPrintBody — mentions", () => {
  it("fills restricted and deleted mention labels, leaving resolved ones as written", () => {
    const html = buildAdrPrintBody(
      adr({
        context:
          '<p><span data-type="mention" data-kind="card" data-restricted="true" data-token="ab12cd34"></span> ' +
          '<span data-type="mention" data-kind="card" data-id="0b0e5b1e-6a0e-4c43-9b8e-2d1c4a5f7e01">@SAP ERP</span></p>',
        decision:
          '<p><span data-type="mention" data-kind="decision" data-id="1c1f6c2f-7b1f-4d54-8c9f-3e2d5b6a8f02" data-missing="true"></span></p>',
      }),
    );
    expect(html).toContain(
      '<p><span data-type="mention" data-kind="card" data-restricted="true" data-token="ab12cd34">Restricted card</span> ' +
        '<span data-type="mention" data-kind="card" data-id="0b0e5b1e-6a0e-4c43-9b8e-2d1c4a5f7e01">@SAP ERP</span></p>',
    );
    expect(html).toContain(
      '<p><span data-type="mention" data-kind="decision" data-id="1c1f6c2f-7b1f-4d54-8c9f-3e2d5b6a8f02" data-missing="true">Deleted decision</span></p>',
    );
  });
});
