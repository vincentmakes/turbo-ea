import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("file-saver", () => ({ saveAs: vi.fn() }));

import { saveAs } from "file-saver";
import { registerExtension, resetExtensionHost, UI_SDK_VERSION } from "@/lib/extensionHost";
import type { ArchitectureDecision } from "@/types";

import { exportAdrsToDocx } from "./adrExport";

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
});
