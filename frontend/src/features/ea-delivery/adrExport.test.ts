import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("file-saver", () => ({ saveAs: vi.fn() }));

import { saveAs } from "file-saver";
import { registerExtension, resetExtensionHost, UI_SDK_VERSION } from "@/lib/extensionHost";
import type { ArchitectureDecision } from "@/types";

import { adrDocxCover, exportAdrsToDocx } from "./adrExport";

const mockSaveAs = saveAs as ReturnType<typeof vi.fn>;

function adr(overrides: Partial<ArchitectureDecision> = {}): ArchitectureDecision {
  return {
    id: "adr-1",
    reference_number: "ADR-0001",
    title: "Adopt event bus",
    status: "signed",
    context: "<p>ctx</p>",
    decision: "<p>do it</p>",
    consequences: null,
    alternatives_considered: null,
    related_decisions: [],
    attributes: { "ext.savings": { total: 50000 } },
    created_by: "u1",
    signatories: [],
    signed_at: null,
    revision_number: 1,
    parent_id: null,
    linked_cards: [],
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

describe("exportAdrsToDocx — extension sections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetExtensionHost();
  });

  it("invokes registered export builders with the ADR and still saves the file", async () => {
    const build = vi.fn(() => [
      { heading: "Extra Section", paragraphs: ["Total: 50,000"], table: { headers: ["A"], rows: [["1"]] } },
    ]);
    registerExtension("daaf", {
      key: "daaf",
      sdkVersion: UI_SDK_VERSION,
      adrExportSections: [{ id: "savings", build }],
    });

    const a = adr();
    await exportAdrsToDocx([a]);

    expect(build).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledWith(a);
    expect(mockSaveAs).toHaveBeenCalledTimes(1);
  });

  it("skips a throwing builder without breaking the export", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerExtension("daaf", {
      key: "daaf",
      sdkVersion: UI_SDK_VERSION,
      adrExportSections: [
        {
          id: "boom",
          build: () => {
            throw new Error("kaboom");
          },
        },
      ],
    });

    await exportAdrsToDocx([adr()]);
    warn.mockRestore();
    // The export still completed and saved despite the extension throwing.
    expect(mockSaveAs).toHaveBeenCalledTimes(1);
  });

  it("a single decision gets the SoAW cover: document type over its name, no count, no date", () => {
    expect(adrDocxCover([adr()])).toEqual({
      title: "Architecture Decision Record",
      subtitle: "ADR-0001 — Adopt event bus",
      generatedOn: null,
    });
  });

  it("names a later revision 'ADR-0001 · Rev 2' on the cover", () => {
    expect(adrDocxCover([adr({ revision_number: 2 })]).subtitle).toBe(
      "ADR-0001 · Rev 2 — Adopt event bus",
    );
  });

  it("several decisions keep the collection cover with the count and date", () => {
    const cover = adrDocxCover([adr(), adr({ id: "adr-2", reference_number: "ADR-0002" })]);
    expect(cover.title).toBe("Architecture Decision Records");
    expect(cover.subtitle).toBe("2 decisions");
    expect(cover.generatedOn).toMatch(/^Generated on /);
  });

  it("names a single-decision export after its reference (the preview/editor Word button)", async () => {
    await exportAdrsToDocx([adr()]);
    const filename = String(mockSaveAs.mock.calls[0][1]);
    expect(filename).toMatch(/^ADR-0001_\d{4}-\d{2}-\d{2}_\d{4}\.docx$/);
  });

  it("names a later revision's file after its reference and revision", async () => {
    await exportAdrsToDocx([adr({ revision_number: 3 })]);
    const filename = String(mockSaveAs.mock.calls[0][1]);
    expect(filename).toMatch(/^ADR-0001-rev3_\d{4}-\d{2}-\d{2}_\d{4}\.docx$/);
  });

  it("exports a recorded decision, links, files and no signatories without failing", async () => {
    const build = vi.fn(() => []);
    registerExtension("daaf", {
      key: "daaf",
      sdkVersion: UI_SDK_VERSION,
      adrExportSections: [{ id: "savings", build }],
    });
    const recorded = adr({
      recorded_at: "2026-05-01T00:00:00Z",
      recorded_by: { user_id: "u1", display_name: "Ada" },
      decided_on: "2026-04-30",
      decision_makers: [{ user_id: "u1", display_name: "Ada" }],
      change_summary: "One\nTwo",
      links: {
        outgoing: [
          {
            id: "l1",
            kind: "revokes",
            note: null,
            decision: {
              id: "b",
              reference_number: "ADR-0002",
              revision_number: 1,
              title: "Old",
              status: "signed",
              standing: "revoked",
            },
          },
        ],
        incoming: [],
      },
      files: [
        { id: "f", name: "a.pdf", mime_type: "application/pdf", size: 1, created_at: null, created_by: null },
      ],
    });
    await exportAdrsToDocx([recorded, adr({ id: "adr-2", status: "draft", signatories: [] })]);
    expect(build).toHaveBeenCalledTimes(2);
    expect(mockSaveAs).toHaveBeenCalledTimes(1);
    expect(String(mockSaveAs.mock.calls[0][1])).toMatch(/^ADRs_/);
  });
});
