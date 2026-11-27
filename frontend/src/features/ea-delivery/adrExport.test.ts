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
    // Plain text around a mention is one run with it (same formatting merges).
    expect(texts).toContain("a Restricted card @SAP ERP");
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

  it("writes a picture nested in a list item as media", async () => {
    vi.mocked(api.getRaw).mockResolvedValue({
      blob: async () => ({ arrayBuffer: async () => PNG.slice().buffer }),
    } as unknown as Response);
    const { xml, media } = await exported([
      adr({ consequences: `<ul><li><p>Step one</p><img src="${PIC}" width="80" height="40"></li></ul>` }),
    ]);
    expect(media).toHaveLength(1);
    expect(xml.indexOf("Step one")).toBeLessThan(xml.indexOf("<w:drawing>"));
    expect(xml).toContain(`<wp:extent cx="${80 * 9525}" cy="${40 * 9525}"/>`);
  });

  it("fetches nothing for decisions without pictures", async () => {
    await exported([adr()]);
    expect(api.getRaw).not.toHaveBeenCalled();
  });
});

describe("exportAdrsToDocx — links and generated tables", () => {
  async function exportedPackage(decisions: ArchitectureDecision[]) {
    let captured: Parameters<typeof Packer.toBlob>[0] | null = null;
    const spy = vi.spyOn(Packer, "toBlob").mockImplementation(async (d) => {
      captured = d;
      return new Blob(["docx"]);
    });
    await exportAdrsToDocx(decisions);
    spy.mockRestore();
    const zip = await JSZip.loadAsync(await Packer.toBuffer(captured!));
    return {
      xml: await zip.file("word/document.xml")!.async("string"),
      rels: await zip.file("word/_rels/document.xml.rels")!.async("string"),
    };
  }

  it("writes a link in a section as a clickable hyperlink in the Hyperlink style", async () => {
    const { xml, rels } = await exportedPackage([
      adr({ decision: '<p>Read <a href="https://example.com/rfc">the RFC</a> first</p>' }),
    ]);
    const link = xml.match(/<w:hyperlink [^>]*>(?:(?!<\/w:hyperlink>)[\s\S])*<\/w:hyperlink>/)?.[0] ?? "";
    expect(link).toContain(">the RFC</w:t>");
    expect(link).toContain('<w:rStyle w:val="Hyperlink"/>');
    expect(link).not.toContain("<w:color ");
    const id = /r:id="([^"]+)"/.exec(link)?.[1];
    expect(id).toBeTruthy();
    expect(rels).toContain(`Id="${id}"`);
    expect(rels).toContain('Target="https://example.com/rfc" TargetMode="External"');
  });

  it("writes a table in a section as a real Word table with its header row repeated", async () => {
    const { xml } = await exportedPackage([
      adr({
        decision:
          '<table style="min-width: 50px"><colgroup><col style="min-width: 25px"><col style="min-width: 25px"></colgroup>' +
          '<tbody><tr><th colspan="1" rowspan="1"><p>Option</p></th><th colspan="1" rowspan="1"><p>Cost</p></th></tr>' +
          '<tr><td colspan="2" rowspan="1"><p>Merged verdict</p></td></tr></tbody></table>',
      }),
    ]);
    const stored = xml.split("<w:tbl>").find((t) => t.includes(">Merged verdict</w:t>")) ?? "";
    expect(stored).toContain('<w:gridCol w:w="4507"/><w:gridCol w:w="4507"/>');
    expect(stored).toContain("<w:tblHeader/>");
    expect(stored).toContain('<w:gridSpan w:val="2"/>');
    expect(stored).toContain(">Option</w:t>");
  });

  it("still draws the facts table with the shared table builder", async () => {
    const { xml } = await exportedPackage([adr()]);
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain('w:fill="f5f5f5"');
    expect(xml).toContain('w:color="cccccc"');
    expect(xml).toContain('<w:tblW w:type="pct" w:w="100%"/>');
  });
});

describe("exportAdrsToDocx — diagrams", () => {
  async function documentXml(decision: ArchitectureDecision) {
    let captured: Parameters<typeof Packer.toBlob>[0] | null = null;
    const spy = vi.spyOn(Packer, "toBlob").mockImplementation(async (d) => {
      captured = d;
      return new Blob(["docx"]);
    });
    await exportAdrsToDocx([decision]);
    spy.mockRestore();
    const zip = await JSZip.loadAsync(await Packer.toBuffer(captured!));
    return zip.file("word/document.xml")!.async("string");
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetExtensionHost();
  });

  it("lists the diagrams' names under their own heading, after the files", async () => {
    const xml = await documentXml(
      adr({
        files: [
          { id: "f", name: "a.pdf", mime_type: "application/pdf", size: 1, created_at: null, created_by: null },
        ],
        diagrams: [
          { id: "d1", name: "Landscape", thumbnail: "<svg><text>x</text></svg>", updated_at: null },
          { id: "d2", name: "Data flows", thumbnail: null, updated_at: null },
        ],
      }),
    );
    expect(xml).toContain(">Diagrams</w:t>");
    expect(xml).toContain(">Diagram</w:t>");
    expect(xml).toContain(">Landscape</w:t>");
    expect(xml).toContain(">Data flows</w:t>");
    expect(xml.indexOf(">a.pdf</w:t>")).toBeLessThan(xml.indexOf(">Diagrams</w:t>"));
    expect(xml).not.toContain("<svg");
  });

  it("names a rejected draft's outcome in the facts and the summary table", async () => {
    const rejected = adr({
      status: "draft",
      outcome: {
        kind: "rejected",
        at: "2026-11-27T10:00:00Z",
        by: { id: "u2", display_name: "Grace" },
        note: "Not costed",
      },
    });
    const single = await documentXml(rejected);
    expect(single).toContain(">Rejected</w:t>");
    expect(single).toContain("Not costed");
    expect(single).not.toContain(">Draft</w:t>");
  });

  it("writes no diagrams heading when there are none", async () => {
    expect(await documentXml(adr())).not.toContain(">Diagrams</w:t>");
    expect(await documentXml(adr({ diagrams: [] }))).not.toContain(">Diagrams</w:t>");
  });
});
