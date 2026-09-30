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
    // The SoAW cover: document type, then "reference — title — Revision n".
    expect(html).toContain('<h1 style="text-align:center;border:none;">Architecture Decision Record</h1>');
    expect(html).toContain(">ADR-0001 — Adopt event bus — Revision 2</p>");
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

describe("adrPrintDocument / printAdr", () => {
  it("names the document by reference and carries approver, approval date and print date in the footer", () => {
    const doc = adrPrintDocument(adr());
    expect(doc.title).toBe("ADR-0001 — Adopt event bus");
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
