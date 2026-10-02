import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { Packer, type Document } from "docx";
import { saveAs } from "file-saver";
import i18n from "@/i18n";
import { printDocument } from "@/lib/printDocument";
import type { SoAWDocumentInfo, SoAWSectionData, SoAWSignatory, SoAWVersionEntry } from "@/types";
import { getTemplateSections, getTogafPhases } from "./soawTemplate";
import { buildPreviewBody, exportToDocx, exportToPdf, PREVIEW_CSS } from "./soawExport";

vi.mock("file-saver", () => ({ saveAs: vi.fn() }));
// Keep `escapeHtml` real (it is what the body builder escapes with) and only
// stub the pop-up path, so no window is opened and no print dialog fires.
vi.mock("@/lib/printDocument", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/printDocument")>()),
  printDocument: vi.fn(),
}));

const mockSaveAs = vi.mocked(saveAs);
const mockPrintDocument = vi.mocked(printDocument);

// ─── fixtures ────────────────────────────────────────────────────────────────

/** `delivery:export.*` label, exactly as the exporter resolves it. */
const t = (key: string, opts?: Record<string, unknown>) =>
  String(i18n.t(`delivery:export.${key}`, opts as never));

type CustomSection = { id: string; title: string; content: string; insertAfter: string };

const EMPTY_INFO: SoAWDocumentInfo = { prepared_by: "", reviewed_by: "", review_date: "" };
const INFO: SoAWDocumentInfo = {
  prepared_by: "Ada <Lovelace>",
  reviewed_by: "   ",
  review_date: "2026-06-01",
};

const BLANK_VERSION: SoAWVersionEntry = { version: "", date: "", revised_by: "", description: "" };
const VERSION: SoAWVersionEntry = {
  version: "1.0",
  date: "2026-06-01",
  revised_by: "Ada",
  description: "Initial <b>draft</b>",
};

const SIGNED: SoAWSignatory = {
  user_id: "u1",
  display_name: "Grace <Hopper>",
  email: "grace@example.com",
  status: "signed",
  signed_at: "2026-06-02T09:30:00Z",
};
const PENDING: SoAWSignatory = {
  user_id: "u2",
  display_name: "Linus",
  status: "pending",
  signed_at: null,
};

const rich = (content: string, hidden = false): SoAWSectionData => ({ content, hidden });
const table = (columns: string[], rows: string[][]): SoAWSectionData => ({
  content: "",
  hidden: false,
  table_data: { columns, rows },
});
const togaf = (togaf_data: Record<string, string>): SoAWSectionData => ({
  content: "",
  hidden: false,
  togaf_data,
});

function def(id: string) {
  const found = getTemplateSections().find((d) => d.id === id);
  if (!found) throw new Error(`no template section ${id}`);
  return found;
}

const PART_I = `Part I: ${t("partI")}`;
const PART_II = `Part II: ${t("partII")}`;

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

/** `buildPreviewBody` with every optional argument defaulted. */
function body(
  sections: Record<string, SoAWSectionData>,
  custom: CustomSection[] = [],
  extra: {
    name?: string;
    docInfo?: SoAWDocumentInfo;
    versionHistory?: SoAWVersionEntry[];
    revisionNumber?: number;
    signatories?: SoAWSignatory[];
    signedAt?: string | null;
  } = {},
) {
  return buildPreviewBody(
    extra.name ?? "Cloud Migration",
    extra.docInfo ?? EMPTY_INFO,
    extra.versionHistory ?? [],
    sections,
    custom,
    extra.revisionNumber,
    extra.signatories,
    extra.signedAt,
  );
}

// ─── DOCX helpers ────────────────────────────────────────────────────────────

/** Replace `Packer.toBlob` with a capture so the test can read the model it was handed. */
function captureDocument(): () => Document {
  let captured: Document | null = null;
  vi.spyOn(Packer, "toBlob").mockImplementation(async (file) => {
    captured = file;
    return new Blob(["docx"]);
  });
  return () => {
    if (!captured) throw new Error("Packer.toBlob was not called");
    return captured;
  };
}

/** The `word/document.xml` of the package docx builds from the model. */
async function documentXml(doc: Document): Promise<string> {
  const zip = await JSZip.loadAsync(await Packer.toBuffer(doc));
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("word/document.xml missing from the generated package");
  return file.async("string");
}

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/** Every `<w:t>` text in document order. */
function texts(xml: string): string[] {
  return Array.from(xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g), (m) => decodeXml(m[1]));
}

/** The `<w:r>` element carrying exactly this text (run properties included). */
function runOf(xml: string, text: string): string {
  const literal = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(
    new RegExp(`<w:r>(?:(?!<\\/w:r>)[\\s\\S])*?<w:t(?:\\s[^>]*)?>${literal}<\\/w:t><\\/w:r>`),
  );
  if (!match) throw new Error(`no run with text "${text}"`);
  return match[0];
}

/** The `<w:p>` element whose first run carries this text (paragraph properties included). */
function paragraphOf(xml: string, text: string): string {
  const literal = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(
    new RegExp(`<w:p>(?:(?!<\\/w:p>)[\\s\\S])*?<w:t(?:\\s[^>]*)?>${literal}<\\/w:t>(?:(?!<\\/w:p>)[\\s\\S])*?<\\/w:p>`),
  );
  if (!match) throw new Error(`no paragraph with text "${text}"`);
  return match[0];
}

async function docx(
  sections: Record<string, SoAWSectionData>,
  custom: CustomSection[] = [],
  extra: { name?: string; docInfo?: SoAWDocumentInfo; versionHistory?: SoAWVersionEntry[] } = {},
) {
  const getDoc = captureDocument();
  await exportToDocx(
    extra.name ?? "Cloud Migration",
    extra.docInfo ?? EMPTY_INFO,
    extra.versionHistory ?? [],
    sections,
    custom,
  );
  return documentXml(getDoc());
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── buildPreviewBody ────────────────────────────────────────────────────────

describe("buildPreviewBody — title block", () => {
  it("opens with the document-type heading and the escaped name as subtitle", () => {
    const html = body({}, [], { name: `Cloud <Migration> & "Co"` });
    expect(html.startsWith(`<h1 style="text-align:center;border:none;">${t("soawTitle")}</h1>`)).toBe(true);
    expect(html).toContain(`<p style="text-align:center;font-size:14pt;color:#555;">Cloud &lt;Migration&gt; &amp; &quot;Co&quot;</p>`);
    expect(html).not.toContain("<Migration>");
  });

  it("appends the revision label only from the second revision on", () => {
    expect(body({})).not.toContain("Revision");
    expect(body({}, [], { revisionNumber: 1 })).not.toContain(t("revision", { number: 1 }));
    const third = body({}, [], { revisionNumber: 3 });
    expect(third).toContain(`Cloud Migration${t("revision", { number: 3 })}</p>`);
  });
});

describe("buildPreviewBody — document information", () => {
  it("omits the whole block when every field is blank", () => {
    const html = body({}, [], { docInfo: EMPTY_INFO });
    expect(html).not.toContain(`<h2>${t("documentInfo")}</h2>`);
    expect(html).not.toContain("meta-label");
  });

  it("keeps only the filled fields, in Prepared / Reviewed / Review-date order, escaped", () => {
    const html = body({}, [], { docInfo: INFO });
    expect(html).toContain(`<h2>${t("documentInfo")}</h2><table>`);
    expect(html).toContain(`<tr><td class="meta-label">${t("preparedBy")}</td><td>Ada &lt;Lovelace&gt;</td></tr>`);
    // Whitespace-only counts as empty.
    expect(html).not.toContain(t("reviewedBy"));
    expect(html).toContain(`<tr><td class="meta-label">${t("reviewDate")}</td><td>2026-06-01</td></tr>`);
    expect(html.indexOf(t("preparedBy"))).toBeLessThan(html.indexOf(t("reviewDate")));
  });
});

describe("buildPreviewBody — version history", () => {
  it("is gated on at least one entry carrying a version or a date", () => {
    expect(body({}, [], { versionHistory: [] })).not.toContain(t("versionHistory"));
    expect(body({}, [], { versionHistory: [BLANK_VERSION] })).not.toContain(t("versionHistory"));
    // A row with only an author and a description does not open the block.
    const authorOnly = { ...BLANK_VERSION, revised_by: "Ada", description: "x" };
    expect(body({}, [], { versionHistory: [authorOnly] })).not.toContain(t("versionHistory"));
    // A date alone does.
    const dateOnly = { ...BLANK_VERSION, date: "2026-06-01" };
    expect(body({}, [], { versionHistory: [dateOnly] })).toContain(`<h2>${t("versionHistory")}</h2>`);
  });

  it("renders the translated header row and one escaped row per entry, blank rows included", () => {
    const html = body({}, [], { versionHistory: [VERSION, BLANK_VERSION] });
    expect(html).toContain(
      `<h2>${t("versionHistory")}</h2><table><tr><th>${t("version")}</th><th>${t("date")}</th><th>${t("revisedBy")}</th><th>${t("description")}</th></tr>`,
    );
    expect(html).toContain(`<tr><td>1.0</td><td>2026-06-01</td><td>Ada</td><td>Initial &lt;b&gt;draft&lt;/b&gt;</td></tr>`);
    expect(html).toContain(`<tr><td></td><td></td><td></td><td></td></tr>`);
  });
});

describe("buildPreviewBody — template sections", () => {
  it("emits each Part header exactly once, before its first rendered section", () => {
    const html = body({
      "1.1": rich("<p>Background</p>"),
      "1.2": rich("<p>Scope</p>"),
      "4.1": rich("<p>Baseline</p>"),
      "5.1": rich("<p>Target</p>"),
    });
    expect(count(html, PART_I)).toBe(1);
    expect(count(html, PART_II)).toBe(1);
    expect(html).toContain(`<div class="part-header">${PART_I}</div><h3>${def("1.1").title}</h3>`);
    expect(html).toContain(`<div class="part-header">${PART_II}</div><h3>${def("4.1").title}</h3>`);
    expect(html.indexOf(PART_I)).toBeLessThan(html.indexOf(PART_II));
    expect(html.indexOf("<p>Scope</p>")).toBeLessThan(html.indexOf(PART_II));
  });

  it("skips a Part header whose sections are all empty", () => {
    const html = body({ "4.1": rich("<p>Baseline</p>") });
    expect(html).not.toContain(PART_I);
    expect(count(html, PART_II)).toBe(1);
  });

  it("skips hidden, blank and absent sections, and inserts stored rich text verbatim", () => {
    const html = body({
      "1.1": rich("<p>Because <strong>latency</strong></p>"),
      "1.2": rich("<p>Hidden but filled</p>", true),
      "2.2": rich("<p></p>"),
      "4.1": rich("<p>   </p><p><br></p>"),
      "2.1": table(["Objective", "Notes"], [["", "  "], ["", ""]]),
      "2.3": table(["Stakeholder", "Concern"], []),
      "3.1": togaf({ A: "", B: "  " }),
      "7.1": { content: "", hidden: false },
    });
    expect(html).toContain(`<h3>${def("1.1").title}</h3><p>Because <strong>latency</strong></p>`);
    for (const id of ["1.2", "2.2", "4.1", "2.1", "2.3", "3.1", "7.1", "5.1"]) {
      expect(html).not.toContain(def(id).title);
    }
    expect(html).not.toContain("Hidden but filled");
  });

  it("uses h2 for a level-2 section and h3 for a level-3 one", () => {
    const html = body({ "7.0": rich("<p>Risks</p>"), "7.2": table(["D", "S"], [["x", "y"]]) });
    expect(def("7.0").level).toBe(2);
    expect(html).toContain(`<h2>${def("7.0").title}</h2><p>Risks</p>`);
    expect(html).toContain(`<h3>${def("7.2").title}</h3>`);
  });

  it("renders a table section with its preamble, escaped headers and escaped cells", () => {
    const html = body({ "2.1": table(["Goal <1>", "Notes"], [["Cut cost & risk", "Q3"], ["", "n/a"]]) });
    expect(def("2.1").preamble).toBeTruthy();
    expect(html).toContain(`<h3>${def("2.1").title}</h3><p class="preamble">${def("2.1").preamble}</p>`);
    expect(html).toContain(`<table><tr><th>Goal &lt;1&gt;</th><th>Notes</th></tr>`);
    expect(html).toContain(`<tr><td>Cut cost &amp; risk</td><td>Q3</td></tr><tr><td></td><td>n/a</td></tr></table>`);
  });

  it("renders the TOGAF phases table with one row per phase and an em dash for a blank phase", () => {
    const html = body({ "3.1": togaf({ A: "Vision <doc>", RM: "Req. list" }) });
    expect(html).toContain(`<h3>${def("3.1").title}</h3><table><tr><th>${t("phase")}</th><th>${t("relevantArtefacts")}</th></tr>`);
    const phases = getTogafPhases();
    expect(phases).toHaveLength(9);
    expect(html).toContain(`<tr><td>${phases[0].label}</td><td>Vision &lt;doc&gt;</td></tr>`);
    expect(html).toContain(`<tr><td>${phases[1].label}</td><td>—</td></tr>`);
    expect(html).toContain(`<tr><td>${phases[8].label}</td><td>Req. list</td></tr>`);
    expect(count(html, "<td>—</td>")).toBe(7);
    for (let i = 1; i < phases.length; i++) {
      expect(html.indexOf(phases[i - 1].label)).toBeLessThan(html.indexOf(phases[i].label));
    }
  });
});

describe("buildPreviewBody — custom sections", () => {
  it("places a custom section right after its insertAfter anchor, with the badge and an escaped title", () => {
    const html = body({ "1.1": rich("<p>Background</p>"), "1.2": rich("<p>Scope</p>") }, [
      { id: "custom_1", title: "<script>alert(1)</script>", content: "<p>Injected?</p>", insertAfter: "1.1" },
    ]);
    expect(html).toContain(
      `<p>Background</p><h3><span class="custom-badge">${t("custom")}</span>&lt;script&gt;alert(1)&lt;/script&gt;</h3><p>Injected?</p><h3>${def("1.2").title}</h3>`,
    );
    expect(html).not.toContain("<script>");
  });

  it("appends a custom section with no anchor, or an unknown one, after the last template section", () => {
    const html = body({ "1.1": rich("<p>Background</p>"), "7.2": table(["D", "S"], [["a", "b"]]) }, [
      { id: "custom_a", title: "Appendix A", content: "<p>A</p>", insertAfter: "" },
      { id: "custom_b", title: "Appendix B", content: "", insertAfter: "9.9" },
    ]);
    const lastTemplate = html.indexOf(def("7.2").title);
    const a = html.indexOf("Appendix A");
    const b = html.indexOf("Appendix B");
    expect(lastTemplate).toBeLessThan(a);
    expect(a).toBeLessThan(b);
    expect(html).toContain(`<h3><span class="custom-badge">${t("custom")}</span>Appendix A</h3><p>A</p>`);
    // An empty body renders the heading alone.
    expect(html.endsWith(`<h3><span class="custom-badge">${t("custom")}</span>Appendix B</h3>`)).toBe(true);
  });

  it("keeps a custom section anchored after a hidden or empty template section, at the anchor's position", () => {
    // The editor lists such a section under its anchor, so the exports must
    // print it there too — the anchor's early return used to take it down.
    const html = body({ "1.1": rich("<p>Hidden</p>", true), "1.2": rich(""), "2.2": rich("<p>Kept</p>") }, [
      { id: "custom_h", title: "After hidden", content: "<p>h</p>", insertAfter: "1.1" },
      { id: "custom_e", title: "After empty", content: "<p>e</p>", insertAfter: "1.2" },
    ]);
    expect(html).toContain("<p>Kept</p>");
    expect(html).not.toContain("<p>Hidden</p>");
    expect(html).toContain(`<h3><span class="custom-badge">${t("custom")}</span>After hidden</h3><p>h</p>`);
    expect(html).toContain(`<h3><span class="custom-badge">${t("custom")}</span>After empty</h3><p>e</p>`);
    // Anchored on 1.1 and 1.2, so both come before the first printed section.
    expect(html.indexOf("After hidden")).toBeLessThan(html.indexOf("After empty"));
    expect(html.indexOf("After empty")).toBeLessThan(html.indexOf("<p>Kept</p>"));
  });
});

describe("buildPreviewBody — signatures", () => {
  it("renders nothing without signatories", () => {
    expect(body({})).not.toContain("soaw-signatures");
    expect(body({}, [], { signatories: [] })).not.toContain("soaw-signatures");
  });

  it("renders one card per signatory with status, escaped name, email and the signing date", () => {
    const html = body({}, [], { signatories: [SIGNED, PENDING] });
    const signedLabel = t("signed", { date: new Date(SIGNED.signed_at as string).toLocaleString() });
    expect(html).toContain(`<div class="soaw-signatures"><h2>${t("signatures")}</h2><div class="sig-grid">`);
    expect(html).not.toContain("fully-signed");
    expect(html).toContain(
      `<div class="sig-card approved"><div class="sig-status approved">&#10003; ${t("approved")}</div><div class="sig-name">Grace &lt;Hopper&gt;</div><div class="sig-detail">grace@example.com</div><div class="sig-detail">${signedLabel}</div></div>`,
    );
    expect(html).toContain(
      `<div class="sig-card pending"><div class="sig-status pending">&#9711; ${t("pending")}</div><div class="sig-name">Linus</div></div>`,
    );
    expect(html.endsWith("</div></div>")).toBe(true);
  });

  it("badges the heading once every signatory has signed", () => {
    const html = body({}, [], { signatories: [SIGNED, { ...SIGNED, user_id: "u3", display_name: "Ada" }] });
    expect(html).toContain(`<h2>${t("signatures")} <span class="sig-badge fully-signed">${t("fullySigned")}</span></h2>`);
  });

  it("renders a rejected signatory as a pending card (current behaviour)", () => {
    const html = body({}, [], { signatories: [{ ...PENDING, status: "rejected" }] });
    expect(html).toContain(`<div class="sig-card pending">`);
    expect(html).not.toContain("rejected");
  });

  it("places the signature block after the trailing custom sections", () => {
    const html = body({ "1.1": rich("<p>x</p>") }, [{ id: "c", title: "Appendix", content: "", insertAfter: "" }], {
      signatories: [PENDING],
    });
    expect(html.indexOf("Appendix")).toBeLessThan(html.indexOf("soaw-signatures"));
  });

  it("dates a signed signatory without a stamp of its own from the document-level signedAt", () => {
    // The PDF footer prints that value as the date of approval; the card in
    // the same document must not say the signature is undated.
    const undated: SoAWSignatory = { ...SIGNED, signed_at: null };
    const html = body({}, [], { signatories: [undated], signedAt: "2026-06-02T09:30:00Z" });
    expect(html).toContain(`<div class="sig-card approved">`);
    expect(html).toContain(t("signed", { date: new Date("2026-06-02T09:30:00Z").toLocaleString() }));
    // A signatory's own stamp still wins over the document's.
    const own = body({}, [], { signatories: [SIGNED], signedAt: "2026-06-02T09:30:00Z" });
    expect(own).toContain(t("signed", { date: new Date(SIGNED.signed_at!).toLocaleString() }));
    // A pending signatory never gets a date, whatever the document carries.
    const pending = body({}, [], { signatories: [PENDING], signedAt: "2026-06-02T09:30:00Z" });
    expect(pending).not.toContain(new Date("2026-06-02T09:30:00Z").toLocaleString());
  });
});

// ─── exportToPdf ─────────────────────────────────────────────────────────────

describe("exportToPdf", () => {
  const sections = { "1.1": rich("<p>Background</p>") };
  const custom: CustomSection[] = [{ id: "c", title: "Appendix", content: "<p>A</p>", insertAfter: "" }];

  it("hands the preview body, the SoAW stylesheet and the body class to the shared print path", () => {
    exportToPdf("Cloud Migration", INFO, [VERSION], sections, custom, 2, [SIGNED, PENDING], null);
    expect(mockPrintDocument).toHaveBeenCalledTimes(1);
    const opts = mockPrintDocument.mock.calls[0][0];
    expect(opts.title).toBe("Cloud Migration");
    expect(opts.bodyClass).toBe("soaw-preview");
    expect(opts.css).toBe(PREVIEW_CSS);
    expect(opts.bodyHtml).toBe(
      buildPreviewBody("Cloud Migration", INFO, [VERSION], sections, custom, 2, [SIGNED, PENDING], null),
    );
    expect(opts.bodyHtml).toContain(t("revision", { number: 2 }));
  });

  it("falls back to 'SoAW' as the window title when the document has no name", () => {
    exportToPdf("", EMPTY_INFO, [], sections, [], undefined, undefined, undefined);
    expect(mockPrintDocument.mock.calls[0][0].title).toBe("SoAW");
    expect(mockPrintDocument.mock.calls[0][0].bodyHtml).toContain(`color:#555;"></p>`);
  });

  it("a signed document's footer names the first approver, the approval date and the print date", () => {
    vi.setSystemTime(new Date(2026, 5, 15, 10, 30));
    const today = new Date().toLocaleDateString();
    exportToPdf("Cloud Migration", EMPTY_INFO, [], sections, [], 1, [PENDING, SIGNED], null);
    expect(mockPrintDocument.mock.calls[0][0].footerParts).toEqual([
      t("approvedBy", { name: SIGNED.display_name }),
      t("dateOfApproval", { date: new Date(SIGNED.signed_at as string).toLocaleDateString() }),
      t("printed", { date: today }),
    ]);
  });

  it("prefers the document-level signedAt over the approver's own timestamp", () => {
    vi.setSystemTime(new Date(2026, 5, 15, 10, 30));
    exportToPdf("Cloud Migration", EMPTY_INFO, [], sections, [], 1, [SIGNED], "2026-07-04T00:00:00Z");
    const parts = mockPrintDocument.mock.calls[0][0].footerParts ?? [];
    expect(parts[1]).toBe(t("dateOfApproval", { date: new Date("2026-07-04T00:00:00Z").toLocaleDateString() }));
    expect(parts[1]).not.toBe(t("dateOfApproval", { date: new Date(SIGNED.signed_at as string).toLocaleDateString() }));
  });

  it("omits the approval date when neither the document nor the approver carries one", () => {
    vi.setSystemTime(new Date(2026, 5, 15, 10, 30));
    exportToPdf("Cloud Migration", EMPTY_INFO, [], sections, [], 1, [{ ...SIGNED, signed_at: null }], null);
    expect(mockPrintDocument.mock.calls[0][0].footerParts).toEqual([
      t("approvedBy", { name: SIGNED.display_name }),
      t("printed", { date: new Date().toLocaleDateString() }),
    ]);
  });

  it("an unsigned document with signatories carries only the print date; one without carries no footer", () => {
    vi.setSystemTime(new Date(2026, 5, 15, 10, 30));
    exportToPdf("Cloud Migration", EMPTY_INFO, [], sections, [], 1, [PENDING], null);
    expect(mockPrintDocument.mock.calls[0][0].footerParts).toEqual([t("printed", { date: new Date().toLocaleDateString() })]);

    exportToPdf("Cloud Migration", EMPTY_INFO, [], sections, [], 1, [], null);
    expect(mockPrintDocument.mock.calls[1][0].footerParts).toEqual([]);

    exportToPdf("Cloud Migration", EMPTY_INFO, [], sections, []);
    expect(mockPrintDocument.mock.calls[2][0].footerParts).toEqual([]);
  });
});

// ─── exportToDocx ────────────────────────────────────────────────────────────

describe("exportToDocx — package and filename", () => {
  it("packs a real .docx Blob and names it after the SoAW with a local timestamp", async () => {
    vi.setSystemTime(new Date(2026, 5, 15, 9, 7));
    await exportToDocx("My SoAW", EMPTY_INFO, [], { "1.1": rich("<p>x</p>") }, []);
    expect(mockSaveAs).toHaveBeenCalledTimes(1);
    const [blob, filename] = mockSaveAs.mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
    expect((blob as Blob).size).toBeGreaterThan(0);
    expect(filename).toBe("My SoAW_2026-06-15_0907.docx");
  });

  it("falls back to 'SoAW' in the filename when the document has no name", async () => {
    vi.setSystemTime(new Date(2026, 11, 3, 23, 59));
    captureDocument();
    await exportToDocx("", EMPTY_INFO, [], {}, []);
    expect(mockSaveAs.mock.calls[0][1]).toBe("SoAW_2026-12-03_2359.docx");
  });
});

describe("exportToDocx — document content", () => {
  it("opens with the centred title and the name as a ruled subtitle", async () => {
    const xml = await docx({}, [], { name: "Cloud <Migration> & Co" });
    const all = texts(xml);
    expect(all[0]).toBe(t("soawTitle"));
    expect(all[1]).toBe("Cloud <Migration> & Co");
    expect(paragraphOf(xml, t("soawTitle"))).toContain(`<w:jc w:val="center"/>`);
    expect(runOf(xml, t("soawTitle"))).toContain("<w:b/>");
    // The blue rule under the subtitle is a bottom paragraph border; the raw
    // XML carries the name entity-escaped.
    const subtitle = paragraphOf(xml, "Cloud &lt;Migration&gt; &amp; Co");
    expect(subtitle).toContain(`<w:jc w:val="center"/>`);
    expect(subtitle).toContain(`<w:bottom w:val="single"`);
    expect(subtitle).toContain(`w:color="1976d2"`);
    expect(xml).not.toContain("<w:tbl>");
  });

  it("renders the document-information table only for filled fields, and the version-history table when gated in", async () => {
    const xml = await docx({}, [], { docInfo: INFO, versionHistory: [VERSION] });
    expect(count(xml, "<w:tbl>")).toBe(2);
    const all = texts(xml);
    expect(all).toContain(t("documentInfo"));
    expect(all).toContain(t("field"));
    expect(all).toContain(t("value"));
    expect(all).toContain(t("preparedBy"));
    expect(all).toContain("Ada <Lovelace>");
    expect(all).not.toContain(t("reviewedBy"));
    expect(all).toContain(t("reviewDate"));
    expect(all).toContain("2026-06-01");
    expect(all).toContain(t("versionHistory"));
    for (const h of [t("version"), t("date"), t("revisedBy"), t("description")]) expect(all).toContain(h);
    expect(all).toContain("Initial <b>draft</b>");
    expect(runOf(xml, t("field"))).toContain("<w:b/>");
    expect(xml).toContain(`w:fill="f5f5f5"`);
  });

  it("omits both metadata tables when the fields are blank and no entry carries a version or date", async () => {
    const xml = await docx({}, [], { docInfo: EMPTY_INFO, versionHistory: [BLANK_VERSION] });
    expect(xml).not.toContain("<w:tbl>");
    expect(texts(xml)).not.toContain(t("documentInfo"));
    expect(texts(xml)).not.toContain(t("versionHistory"));
  });

  it("emits each Part header once and skips hidden and empty sections", async () => {
    const xml = await docx({
      "1.1": rich("<p>Background</p>"),
      "1.2": rich("<p>Hidden</p>", true),
      "2.2": rich("<p> </p>"),
      "4.1": rich("<p>Baseline</p>"),
      "5.1": rich("<p>Target</p>"),
      "7.1": table(["R", "D", "P", "S"], [["", "", "", ""]]),
    });
    const all = texts(xml);
    expect(all.filter((s) => s === PART_I)).toHaveLength(1);
    expect(all.filter((s) => s === PART_II)).toHaveLength(1);
    expect(all.indexOf(PART_I)).toBeLessThan(all.indexOf(def("1.1").title));
    expect(all.indexOf("Background")).toBeLessThan(all.indexOf(PART_II));
    expect(all.indexOf(PART_II)).toBeLessThan(all.indexOf(def("4.1").title));
    expect(all).not.toContain(def("1.2").title);
    expect(all).not.toContain("Hidden");
    expect(all).not.toContain(def("2.2").title);
    expect(all).not.toContain(def("7.1").title);
    expect(runOf(xml, PART_I)).toContain(`<w:color w:val="1976d2"/>`);
  });

  it("sizes a level-2 heading larger than a level-3 one and renders the preamble in italics", async () => {
    const xml = await docx({ "7.0": rich("<p>Risks</p>"), "2.1": table(["O", "N"], [["Cut cost", "Q3"]]) });
    expect(runOf(xml, def("7.0").title)).toContain(`<w:sz w:val="32"/>`);
    expect(runOf(xml, def("2.1").title)).toContain(`<w:sz w:val="26"/>`);
    const preamble = def("2.1").preamble as string;
    expect(runOf(xml, preamble)).toContain("<w:i/>");
    expect(texts(xml).indexOf(preamble)).toBeLessThan(texts(xml).indexOf("Cut cost"));
  });

  it("renders a table section with a shaded, bold header row and one row per data row", async () => {
    const xml = await docx({ "7.2": table(["Description <x>", "Status"], [["Done & dusted", "closed"], ["Pending", ""]]) });
    expect(count(xml, "<w:tbl>")).toBe(1);
    expect(count(xml, "<w:tr>")).toBe(3);
    const all = texts(xml);
    expect(all).toContain("Description <x>");
    expect(all).toContain("Done & dusted");
    expect(runOf(xml, "Status")).toContain("<w:b/>");
    expect(runOf(xml, "closed")).not.toContain("<w:b/>");
    expect(xml).toContain(`<w:tblW w:type="pct" w:w="100%"/>`);
  });

  it("renders the TOGAF phases table with every phase in order", async () => {
    const xml = await docx({ "3.1": togaf({ A: "Vision", G: "Change log" }) });
    expect(count(xml, "<w:tbl>")).toBe(1);
    expect(count(xml, "<w:tr>")).toBe(1 + getTogafPhases().length);
    const all = texts(xml);
    expect(all).toContain(t("phase"));
    expect(all).toContain(t("relevantArtefacts"));
    expect(all).toContain("Vision");
    expect(all).toContain("Change log");
    const labels = getTogafPhases().map((p) => p.label);
    const positions = labels.map((l) => all.indexOf(l));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("converts rich text: inline marks, headings, lists, blockquotes, wrappers and loose text", async () => {
    const xml = await docx({
      "1.1": rich(
        "<p>plain <strong>bold</strong> <em>ital</em> <u>under</u> <s>gone</s> <del>del</del> <b>b2</b> <i>i2</i></p>" +
          "<h3>Sub heading</h3><h4>Minor heading</h4>" +
          "<ul><li>first</li><li>second</li></ul><ol><li>uno</li><li>dos</li></ol>" +
          "<blockquote>quoted</blockquote>" +
          "<div><p>wrapped</p>Loose text</div>",
      ),
    });
    const all = texts(xml);
    expect(all).toContain("plain ");
    expect(runOf(xml, "bold")).toContain("<w:b/>");
    expect(runOf(xml, "b2")).toContain("<w:b/>");
    expect(runOf(xml, "ital")).toContain("<w:i/>");
    expect(runOf(xml, "i2")).toContain("<w:i/>");
    expect(runOf(xml, "under")).toContain("<w:u ");
    expect(runOf(xml, "gone")).toContain("<w:strike/>");
    expect(runOf(xml, "del")).toContain("<w:strike/>");
    expect(runOf(xml, "plain ")).not.toContain("<w:b/>");
    expect(paragraphOf(xml, "Sub heading")).toContain(`<w:pStyle w:val="Heading3"/>`);
    expect(paragraphOf(xml, "Minor heading")).toContain(`<w:pStyle w:val="Heading4"/>`);
    expect(all).toContain("•  first");
    expect(all).toContain("•  second");
    expect(all).toContain("1. uno");
    expect(all).toContain("2. dos");
    expect(paragraphOf(xml, "1. uno")).toContain(`<w:ind w:left="720"/>`);
    expect(runOf(xml, "quoted")).toContain("<w:i/>");
    expect(paragraphOf(xml, "quoted")).toContain(`<w:ind w:left="720"/>`);
    expect(all).toContain("wrapped");
    expect(all).toContain("Loose text");
    expect(all.indexOf("wrapped")).toBeLessThan(all.indexOf("Loose text"));
  });

  it("places a custom section after its anchor and the unanchored ones at the end, skipping an empty body", async () => {
    const xml = await docx({ "1.1": rich("<p>Background</p>"), "1.2": rich("<p>Scope</p>") }, [
      { id: "c1", title: "Assumptions <1>", content: "<p>We assume</p>", insertAfter: "1.1" },
      { id: "c2", title: "Appendix A", content: "<p></p>", insertAfter: "" },
      { id: "c3", title: "Appendix B", content: "<p></p><p></p>", insertAfter: "9.9" },
      { id: "c4", title: "Orphan", content: "<p>lost</p>", insertAfter: "1.3" },
    ]);
    const all = texts(xml);
    const i = (s: string) => all.indexOf(s);
    expect(i("Background")).toBeLessThan(i("Assumptions <1>"));
    expect(i("Assumptions <1>")).toBeLessThan(i("We assume"));
    expect(i("We assume")).toBeLessThan(i(def("1.2").title));
    expect(i("Scope")).toBeLessThan(i("Appendix A"));
    expect(i("Appendix A")).toBeLessThan(i("Appendix B"));
    expect(i("Appendix B")).toBeLessThan(i("Orphan"));
    expect(all[all.length - 1]).toBe("lost");
    // `runOf` matches the raw XML, where the title is entity-escaped.
    expect(runOf(xml, "Assumptions &lt;1&gt;")).toContain("<w:b/>");
  });

  it("keeps a custom section anchored after a hidden template section, like the preview", async () => {
    const xml = await docx({ "1.1": rich("<p>Hidden</p>", true), "1.2": rich("<p>Scope</p>") }, [
      { id: "c", title: "After hidden", content: "<p>h</p>", insertAfter: "1.1" },
    ]);
    const all = texts(xml);
    expect(all).not.toContain("Hidden");
    expect(all.indexOf("After hidden")).toBeGreaterThanOrEqual(0);
    expect(all.indexOf("After hidden")).toBeLessThan(all.indexOf("Scope"));
    expect(all).toContain("h");
  });

  it("carries no signature block: the Word export takes no signatories (current behaviour)", async () => {
    const xml = await docx({ "1.1": rich("<p>x</p>") });
    expect(texts(xml)).not.toContain(t("signatures"));
    expect(exportToDocx.length).toBe(5);
  });
});
