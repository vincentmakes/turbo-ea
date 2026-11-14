import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("file-saver", () => ({ saveAs: vi.fn() }));
// Pictures are fetched through the API client; the tests answer for it.
vi.mock("@/api/client", () => ({ api: { getRaw: vi.fn() } }));

import JSZip from "jszip";
import { Packer } from "docx";
import { saveAs } from "file-saver";
import { api } from "@/api/client";
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

describe("exportAdrsToDocx — mentions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetExtensionHost();
  });

  it("writes the restricted and deleted labels and the resolved name into the text", async () => {
    let captured: Parameters<typeof Packer.toBlob>[0] | null = null;
    const spy = vi.spyOn(Packer, "toBlob").mockImplementation(async (file) => {
      captured = file;
      return new Blob(["docx"]);
    });
    await exportAdrsToDocx([
      adr({
        context:
          '<p>a <span data-type="mention" data-kind="card" data-restricted="true" data-token="ab12cd34"></span> ' +
          '<span data-type="mention" data-kind="card" data-id="0b0e5b1e-6a0e-4c43-9b8e-2d1c4a5f7e01">@SAP ERP</span></p>',
        consequences:
          '<ul><li><span data-type="mention" data-kind="decision" data-id="1c1f6c2f-7b1f-4d54-8c9f-3e2d5b6a8f02" data-missing="true"></span></li></ul>',
      }),
    ]);
    spy.mockRestore();
    const zip = await JSZip.loadAsync(await Packer.toBuffer(captured!));
    const xml = await zip.file("word/document.xml")!.async("string");
    const texts = Array.from(xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g), (m) => m[1]);
    expect(texts).toContain("Restricted card");
    expect(texts).toContain("@SAP ERP");
    expect(texts.some((x) => x.endsWith("Deleted decision"))).toBe(true);
  });
});

describe("exportAdrsToDocx — pictures", () => {
  const ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  const PIC = `/api/v1/document-images/adr/${ID}`;
  // A 1×1 PNG.
  const PNG = Uint8Array.from(
    atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="),
    (c) => c.charCodeAt(0),
  );

  async function exported(decisions: ArchitectureDecision[]) {
    let captured: Parameters<typeof Packer.toBlob>[0] | null = null;
    const spy = vi.spyOn(Packer, "toBlob").mockImplementation(async (d) => {
      captured = d;
      return new Blob(["docx"]);
    });
    await exportAdrsToDocx(decisions);
    spy.mockRestore();
    const zip = await JSZip.loadAsync(await Packer.toBuffer(captured!));
    const xml = await zip.file("word/document.xml")!.async("string");
    const media = Object.keys(zip.files).filter((f) => f.startsWith("word/media/") && !f.endsWith("/"));
    return { xml, media };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetExtensionHost();
  });

  it("writes a section holding only a picture, with the picture as media, fetched once", async () => {
    vi.mocked(api.getRaw).mockResolvedValue({
      blob: async () => ({ arrayBuffer: async () => PNG.slice().buffer }),
    } as unknown as Response);
    const { xml, media } = await exported([
      adr({ consequences: `<img src="${PIC}" width="120" height="60">`, alternatives_considered: `<img src="${PIC}">` }),
    ]);
    expect(api.getRaw).toHaveBeenCalledTimes(1);
    expect(api.getRaw).toHaveBeenCalledWith(`/document-images/adr/${ID}`);
    expect(xml).toContain(">Consequences</w:t>");
    expect(xml).toContain(">Alternatives Considered</w:t>");
    expect(media.length).toBeGreaterThanOrEqual(1);
    expect(xml).toContain(`<wp:extent cx="${120 * 9525}" cy="${60 * 9525}"/>`);
  });

  it("writes the placeholder line when the picture cannot be fetched", async () => {
    vi.mocked(api.getRaw).mockRejectedValue(new Error("403"));
    const { xml, media } = await exported([adr({ consequences: `<img src="${PIC}">` })]);
    expect(xml).toContain(">Consequences</w:t>");
    expect(xml).toContain(">[Picture not available]</w:t>");
    expect(media).toEqual([]);
  });

  it("fetches nothing for decisions without pictures", async () => {
    await exported([adr()]);
    expect(api.getRaw).not.toHaveBeenCalled();
  });
});
