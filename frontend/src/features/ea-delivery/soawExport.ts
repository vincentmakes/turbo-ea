import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  HeadingLevel,
  AlignmentType,
  ShadingType,
  BorderStyle,
  convertInchesToTwip,
} from "docx";
import { saveAs } from "file-saver";
import {
  SOAW_TEMPLATE_SECTIONS,
  TOGAF_PHASES,
  type TemplateSectionDef,
} from "./soawTemplate";
import type { SoAWDocumentInfo, SoAWVersionEntry, SoAWSectionData, SoAWSignatory } from "@/types";

// ─── constants (matching PDF styles) ─────────────────────────────────────────

const FONT = "Segoe UI";
const COLOR_BODY = "222222"; // body text
const COLOR_H1 = "1a1a2e"; // h1
const COLOR_H2 = "333333"; // h2
const COLOR_H3 = "444444"; // h3
const COLOR_PART = "1976d2"; // part header (blue)
const COLOR_SUBTITLE = "555555"; // doc name subtitle
const COLOR_PREAMBLE = "666666"; // preamble italic text
const COLOR_BORDER = "cccccc"; // table borders

// Sizes in half-points (PDF pt × 2)
const SIZE_BODY = 22; // 11pt
const SIZE_TITLE = 44; // 22pt
const SIZE_SUBTITLE = 28; // 14pt
const SIZE_PART = 36; // 18pt
const SIZE_H2 = 32; // 16pt
const SIZE_H3 = 26; // 13pt
const SIZE_TABLE = 20; // 10pt

// Line spacing: 1.6× = 384 (240 = single)
const LINE_SPACING = 384;

// Spacing in twips
const SPACING_AFTER_DEFAULT = 160; // ~8pt
const SPACING_PART_BEFORE = 540; // ~27pt (36px)
const SPACING_PART_AFTER = 200;
const SPACING_H2_BEFORE = 420; // ~21pt (28px)
const SPACING_H3_BEFORE = 300; // ~15pt (20px)
const SPACING_AFTER_TABLE = 240;

const CELL_BORDER = {
  style: BorderStyle.SINGLE,
  size: 1,
  color: COLOR_BORDER,
};

// ─── helpers ────────────────────────────────────────────────────────────────

/** Parse simple HTML into an array of docx Paragraphs. */
function htmlToParagraphs(html: string): Paragraph[] {
  if (!html || html === "<p></p>") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const paragraphs: Paragraph[] = [];

  const processNode = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text) {
        paragraphs.push(
          new Paragraph({
            children: [new TextRun({ text, font: FONT, size: SIZE_BODY, color: COLOR_BODY })],
            spacing: { line: LINE_SPACING, after: SPACING_AFTER_DEFAULT },
          }),
        );
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (tag === "p") {
      const runs = inlineRuns(el);
      if (runs.length > 0) {
        paragraphs.push(
          new Paragraph({
            children: runs,
            spacing: { line: LINE_SPACING, after: SPACING_AFTER_DEFAULT },
          }),
        );
      }
    } else if (tag === "h3" || tag === "h4") {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: el.textContent ?? "",
              bold: true,
              font: FONT,
              size: SIZE_H3,
              color: COLOR_H3,
            }),
          ],
          heading: tag === "h3" ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_4,
          spacing: { before: SPACING_H3_BEFORE, after: SPACING_AFTER_DEFAULT },
        }),
      );
    } else if (tag === "ul" || tag === "ol") {
      el.querySelectorAll("li").forEach((li, idx) => {
        const prefix = tag === "ol" ? `${idx + 1}. ` : "\u2022  ";
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({
                text: prefix + (li.textContent ?? ""),
                font: FONT,
                size: SIZE_BODY,
                color: COLOR_BODY,
              }),
            ],
            indent: { left: 720 },
            spacing: { line: LINE_SPACING, after: 80 },
          }),
        );
      });
    } else if (tag === "blockquote") {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: el.textContent ?? "",
              italics: true,
              font: FONT,
              size: SIZE_BODY,
              color: COLOR_PREAMBLE,
            }),
          ],
          indent: { left: 720 },
          spacing: { line: LINE_SPACING, after: SPACING_AFTER_DEFAULT },
        }),
      );
    } else {
      el.childNodes.forEach(processNode);
    }
  };

  doc.body.childNodes.forEach(processNode);
  return paragraphs;
}

/** Convert inline HTML children to TextRun array. */
function inlineRuns(el: HTMLElement): TextRun[] {
  const runs: TextRun[] = [];
  el.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? "";
      if (text) runs.push(new TextRun({ text, font: FONT, size: SIZE_BODY, color: COLOR_BODY }));
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const c = child as HTMLElement;
      const tag = c.tagName.toLowerCase();
      const text = c.textContent ?? "";
      runs.push(
        new TextRun({
          text,
          font: FONT,
          size: SIZE_BODY,
          color: COLOR_BODY,
          bold: tag === "strong" || tag === "b",
          italics: tag === "em" || tag === "i",
          underline: tag === "u" ? {} : undefined,
          strike: tag === "s" || tag === "del",
        }),
      );
    }
  });
  return runs;
}

/** Build a docx Table with proper borders and styling matching the PDF. */
function buildDocxTable(columns: string[], rows: string[][]): Table {
  const cellBorders = {
    top: CELL_BORDER,
    bottom: CELL_BORDER,
    left: CELL_BORDER,
    right: CELL_BORDER,
  };

  const cellMargins = {
    top: convertInchesToTwip(0.04),
    bottom: convertInchesToTwip(0.04),
    left: convertInchesToTwip(0.07),
    right: convertInchesToTwip(0.07),
  };

  const headerCells = columns.map(
    (col) =>
      new TableCell({
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: col,
                bold: true,
                font: FONT,
                size: SIZE_TABLE,
                color: COLOR_BODY,
              }),
            ],
          }),
        ],
        shading: { type: ShadingType.CLEAR, fill: "f5f5f5" },
        borders: cellBorders,
        margins: cellMargins,
      }),
  );

  const dataRows = rows.map(
    (row) =>
      new TableRow({
        children: row.map(
          (cell) =>
            new TableCell({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: cell,
                      font: FONT,
                      size: SIZE_TABLE,
                      color: COLOR_BODY,
                    }),
                  ],
                }),
              ],
              borders: cellBorders,
              margins: cellMargins,
            }),
        ),
      }),
  );

  return new Table({
    rows: [new TableRow({ children: headerCells }), ...dataRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

// ─── DOCX export ────────────────────────────────────────────────────────────

export async function exportToDocx(
  name: string,
  docInfo: SoAWDocumentInfo,
  versionHistory: SoAWVersionEntry[],
  sections: Record<string, SoAWSectionData>,
  customSections: { id: string; title: string; content: string; insertAfter: string }[],
) {
  const children: (Paragraph | Table)[] = [];

  // ── Title ──
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "Statement of Architecture Work",
          bold: true,
          font: FONT,
          size: SIZE_TITLE,
          color: COLOR_H1,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
    }),
  );

  // Blue rule under title (simulated with a bottom-bordered paragraph)
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: name,
          font: FONT,
          size: SIZE_SUBTITLE,
          color: COLOR_SUBTITLE,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 3, color: COLOR_PART, space: 8 },
      },
    }),
  );

  // ── Document Information (hide empty fields, hide section if all empty) ──
  const docxDocInfoRows: [string, string][] = [
    ["Prepared By", docInfo.prepared_by],
    ["Reviewed By", docInfo.reviewed_by],
    ["Review Date", docInfo.review_date],
  ].filter(([, val]) => val?.trim()) as [string, string][];

  if (docxDocInfoRows.length > 0) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "Document Information",
            bold: true,
            font: FONT,
            size: SIZE_H2,
            color: COLOR_H2,
          }),
        ],
        spacing: { before: SPACING_H2_BEFORE, after: SPACING_AFTER_DEFAULT },
      }),
    );
    children.push(
      buildDocxTable(["Field", "Value"], docxDocInfoRows),
    );
    children.push(new Paragraph({ spacing: { after: SPACING_AFTER_TABLE } }));
  }

  // ── Version History ──
  if (versionHistory.some((v) => v.version || v.date)) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "Document Version History",
            bold: true,
            font: FONT,
            size: SIZE_H2,
            color: COLOR_H2,
          }),
        ],
        spacing: { before: SPACING_H2_BEFORE, after: SPACING_AFTER_DEFAULT },
      }),
    );
    children.push(
      buildDocxTable(
        ["Version", "Date", "Revised By", "Description"],
        versionHistory.map((v) => [v.version, v.date, v.revised_by, v.description]),
      ),
    );
    children.push(new Paragraph({ spacing: { after: SPACING_AFTER_TABLE } }));
  }

  // ── Sections ──
  let currentPart: string | null = null;

  const addSectionContent = (def: TemplateSectionDef, data: SoAWSectionData) => {
    if (data.hidden) return;
    if (isSectionEmpty(def, data)) return;

    // Part header
    if (def.part !== currentPart) {
      currentPart = def.part;
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `Part ${def.part}: ${def.part === "I" ? "Statement of Architecture Work" : "Baseline and Target Architectures"}`,
              bold: true,
              font: FONT,
              size: SIZE_PART,
              color: COLOR_PART,
            }),
          ],
          spacing: { before: SPACING_PART_BEFORE, after: SPACING_PART_AFTER },
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 3, color: "e0e0e0", space: 6 },
          },
        }),
      );
    }

    // Section heading
    const isH2 = def.level === 2;
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: def.title,
            bold: true,
            font: FONT,
            size: isH2 ? SIZE_H2 : SIZE_H3,
            color: isH2 ? COLOR_H2 : COLOR_H3,
          }),
        ],
        spacing: {
          before: isH2 ? SPACING_H2_BEFORE : SPACING_H3_BEFORE,
          after: SPACING_AFTER_DEFAULT,
        },
      }),
    );

    if (def.preamble) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: def.preamble,
              italics: true,
              font: FONT,
              size: SIZE_BODY,
              color: COLOR_PREAMBLE,
            }),
          ],
          spacing: { after: SPACING_AFTER_DEFAULT },
        }),
      );
    }

    if (def.type === "rich_text" && data.content) {
      for (const p of htmlToParagraphs(data.content)) {
        children.push(p);
      }
    }

    if (def.type === "table" && data.table_data) {
      children.push(
        buildDocxTable(data.table_data.columns, data.table_data.rows),
      );
    }

    if (def.type === "togaf_phases" && data.togaf_data) {
      children.push(
        buildDocxTable(
          ["Phase", "Relevant Artefacts"],
          TOGAF_PHASES.map((p) => [p.label, data.togaf_data?.[p.key] ?? ""]),
        ),
      );
    }

    children.push(new Paragraph({ spacing: { after: SPACING_AFTER_TABLE } }));

    // Insert custom sections after this template section
    for (const cs of customSections) {
      if (cs.insertAfter === def.id) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: cs.title,
                bold: true,
                font: FONT,
                size: SIZE_H3,
                color: COLOR_H3,
              }),
            ],
            spacing: { before: SPACING_H3_BEFORE, after: SPACING_AFTER_DEFAULT },
          }),
        );
        for (const p of htmlToParagraphs(cs.content)) {
          children.push(p);
        }
        children.push(new Paragraph({ spacing: { after: SPACING_AFTER_TABLE } }));
      }
    }
  };

  for (const def of SOAW_TEMPLATE_SECTIONS) {
    const data = sections[def.id] ?? { content: "", hidden: false };
    addSectionContent(def, data);
  }

  // Custom sections without insertAfter (append at end)
  for (const cs of customSections) {
    if (
      !cs.insertAfter ||
      !SOAW_TEMPLATE_SECTIONS.some((d) => d.id === cs.insertAfter)
    ) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: cs.title,
              bold: true,
              font: FONT,
              size: SIZE_H3,
              color: COLOR_H3,
            }),
          ],
          spacing: { before: SPACING_H3_BEFORE, after: SPACING_AFTER_DEFAULT },
        }),
      );
      for (const p of htmlToParagraphs(cs.content)) {
        children.push(p);
      }
      children.push(new Paragraph({ spacing: { after: SPACING_AFTER_TABLE } }));
    }
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: FONT,
            size: SIZE_BODY,
            color: COLOR_BODY,
          },
          paragraph: {
            spacing: { line: LINE_SPACING },
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440,
              right: 1440,
              bottom: 1440,
              left: 1440,
            },
          },
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const filename = `${name || "SoAW"}_${new Date().toISOString().slice(0, 10)}.docx`;
  saveAs(blob, filename);
}

// ─── Preview / PDF shared HTML ──────────────────────────────────────────────

export const PREVIEW_CSS = `
  body, .soaw-preview { font-family: 'Segoe UI', Arial, sans-serif; max-width: 800px; margin: 40px auto; color: #222; line-height: 1.6; font-size: 11pt; }
  .soaw-preview h1 { font-size: 22pt; color: #1a1a2e; border-bottom: 2px solid #1976d2; padding-bottom: 8px; }
  .soaw-preview h2 { font-size: 16pt; color: #333; margin-top: 28px; }
  .soaw-preview h3 { font-size: 13pt; color: #444; margin-top: 20px; }
  .soaw-preview table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  .soaw-preview th, .soaw-preview td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; font-size: 10pt; }
  .soaw-preview th { background: #f5f5f5; font-weight: 600; }
  .soaw-preview .meta-label { font-weight: 600; width: 140px; }
  .soaw-preview .part-header { font-size: 18pt; color: #1976d2; margin-top: 36px; border-bottom: 2px solid #e0e0e0; padding-bottom: 6px; }
  .soaw-preview .preamble { color: #666; font-style: italic; margin-bottom: 8px; }
  .soaw-preview .custom-badge { display: inline-block; background: #1976d2; color: #fff; font-size: 9pt; padding: 1px 8px; border-radius: 3px; margin-right: 8px; }
  .soaw-signatures { margin-top: 36px; border-top: 2px solid #e0e0e0; padding-top: 16px; }
  .soaw-signatures h2 { display: flex; align-items: center; gap: 8px; }
  .soaw-signatures .sig-badge { display: inline-block; font-size: 9pt; padding: 2px 10px; border-radius: 3px; font-weight: 600; }
  .soaw-signatures .sig-badge.signed { background: #e8f5e9; color: #2e7d32; }
  .soaw-signatures .sig-badge.fully-signed { background: #2e7d32; color: #fff; }
  .soaw-signatures .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .soaw-signatures .sig-card { padding: 12px; border: 1px solid #ccc; border-radius: 4px; }
  .soaw-signatures .sig-card.approved { border-color: #66bb6a; background: #f1f8e9; }
  .soaw-signatures .sig-card.pending { border-color: #ccc; background: #fafafa; }
  .soaw-signatures .sig-card .sig-status { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; font-weight: 700; font-size: 10pt; }
  .soaw-signatures .sig-card .sig-status.approved { color: #2e7d32; }
  .soaw-signatures .sig-card .sig-status.pending { color: #ed6c02; }
  .soaw-signatures .sig-card .sig-name { font-weight: 600; font-size: 10pt; }
  .soaw-signatures .sig-card .sig-detail { font-size: 9pt; color: #666; }
  @media print {
    body { margin: 20px; }
    .no-print { display: none !important; }
    .soaw-signatures .sig-grid { grid-template-columns: 1fr 1fr; }
    .soaw-signatures .sig-card.approved { border-color: #66bb6a; background: #f1f8e9 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    @page { @bottom-center { content: element(soaw-footer); } margin-bottom: 60px; }
    .soaw-print-footer { position: fixed; bottom: 0; left: 0; right: 0; text-align: center; font-size: 8pt; color: #888; border-top: 1px solid #ccc; padding-top: 4px; }
  }
`;

/** Check if a section has meaningful content worth rendering. */
function isSectionEmpty(def: TemplateSectionDef, data: SoAWSectionData): boolean {
  if (def.type === "rich_text") {
    const c = (data.content ?? "").replace(/<[^>]*>/g, "").trim();
    return !c;
  }
  if (def.type === "table") {
    if (!data.table_data || !data.table_data.rows || data.table_data.rows.length === 0) return true;
    return data.table_data.rows.every((row) => row.every((cell) => !cell?.trim()));
  }
  if (def.type === "togaf_phases") {
    if (!data.togaf_data) return true;
    return TOGAF_PHASES.every((p) => !(data.togaf_data?.[p.key] ?? "").trim());
  }
  return false;
}

/** Build the inner HTML body content for preview and PDF export. */
export function buildPreviewBody(
  name: string,
  docInfo: SoAWDocumentInfo,
  versionHistory: SoAWVersionEntry[],
  sections: Record<string, SoAWSectionData>,
  customSections: { id: string; title: string; content: string; insertAfter: string }[],
  revisionNumber?: number,
  signatories?: SoAWSignatory[],
  _signedAt?: string | null,
): string {
  let html = "";

  // Title
  html += `<h1 style="text-align:center;border:none;">Statement of Architecture Work</h1>`;
  const revLabel = revisionNumber && revisionNumber > 1 ? ` — Revision ${revisionNumber}` : "";
  html += `<p style="text-align:center;font-size:14pt;color:#555;">${name}${revLabel}</p>`;

  // Doc info (hide empty fields, hide entire section if all empty)
  const docInfoRows: [string, string][] = [
    ["Prepared By", docInfo.prepared_by],
    ["Reviewed By", docInfo.reviewed_by],
    ["Review Date", docInfo.review_date],
  ].filter(([, val]) => val?.trim()) as [string, string][];

  if (docInfoRows.length > 0) {
    html += `<h2>Document Information</h2><table>`;
    for (const [label, val] of docInfoRows) {
      html += `<tr><td class="meta-label">${label}</td><td>${val}</td></tr>`;
    }
    html += `</table>`;
  }

  // Version history
  if (versionHistory.some((v) => v.version || v.date)) {
    html += `<h2>Document Version History</h2><table><tr><th>Version</th><th>Date</th><th>Revised By</th><th>Description</th></tr>`;
    for (const v of versionHistory) {
      html += `<tr><td>${v.version}</td><td>${v.date}</td><td>${v.revised_by}</td><td>${v.description}</td></tr>`;
    }
    html += `</table>`;
  }

  // Sections
  let currentPart = "";

  const renderSection = (def: TemplateSectionDef, data: SoAWSectionData) => {
    if (data.hidden) return;
    if (isSectionEmpty(def, data)) return;

    if (def.part !== currentPart) {
      currentPart = def.part;
      html += `<div class="part-header">Part ${def.part}: ${def.part === "I" ? "Statement of Architecture Work" : "Baseline and Target Architectures"}</div>`;
    }

    const tag = def.level === 2 ? "h2" : "h3";
    html += `<${tag}>${def.title}</${tag}>`;

    if (def.preamble) {
      html += `<p class="preamble">${def.preamble}</p>`;
    }

    if (def.type === "rich_text" && data.content) {
      html += data.content;
    }

    if (def.type === "table" && data.table_data) {
      html += `<table><tr>${data.table_data.columns.map((c) => `<th>${c}</th>`).join("")}</tr>`;
      for (const row of data.table_data.rows) {
        html += `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`;
      }
      html += `</table>`;
    }

    if (def.type === "togaf_phases" && data.togaf_data) {
      html += `<table><tr><th>Phase</th><th>Relevant Artefacts</th></tr>`;
      for (const p of TOGAF_PHASES) {
        html += `<tr><td>${p.label}</td><td>${data.togaf_data[p.key] || "\u2014"}</td></tr>`;
      }
      html += `</table>`;
    }

    // Custom sections after this
    for (const cs of customSections) {
      if (cs.insertAfter === def.id) {
        html += `<h3><span class="custom-badge">Custom</span>${cs.title}</h3>`;
        html += cs.content || "";
      }
    }
  };

  for (const def of SOAW_TEMPLATE_SECTIONS) {
    renderSection(def, sections[def.id] ?? { content: "", hidden: false });
  }

  // Trailing custom sections
  for (const cs of customSections) {
    if (!cs.insertAfter || !SOAW_TEMPLATE_SECTIONS.some((d) => d.id === cs.insertAfter)) {
      html += `<h3><span class="custom-badge">Custom</span>${cs.title}</h3>`;
      html += cs.content || "";
    }
  }

  // Signature block (for PDF/print)
  if (signatories && signatories.length > 0) {
    const allSigned = signatories.every((s) => s.status === "signed");
    html += `<div class="soaw-signatures">`;
    html += `<h2>Signatures`;
    if (allSigned) html += ` <span class="sig-badge fully-signed">Fully Signed</span>`;
    html += `</h2>`;
    html += `<div class="sig-grid">`;
    for (const sig of signatories) {
      const isSig = sig.status === "signed";
      html += `<div class="sig-card ${isSig ? "approved" : "pending"}">`;
      html += `<div class="sig-status ${isSig ? "approved" : "pending"}">${isSig ? "&#10003; Approved" : "&#9711; Pending"}</div>`;
      html += `<div class="sig-name">${sig.display_name}</div>`;
      if (sig.email) html += `<div class="sig-detail">${sig.email}</div>`;
      if (isSig && sig.signed_at) html += `<div class="sig-detail">Signed: ${new Date(sig.signed_at).toLocaleString()}</div>`;
      html += `</div>`;
    }
    html += `</div></div>`;
  }

  return html;
}

// ─── PDF export (print-based) ───────────────────────────────────────────────

export function exportToPdf(
  name: string,
  docInfo: SoAWDocumentInfo,
  versionHistory: SoAWVersionEntry[],
  sections: Record<string, SoAWSectionData>,
  customSections: { id: string; title: string; content: string; insertAfter: string }[],
  revisionNumber?: number,
  signatories?: SoAWSignatory[],
  signedAt?: string | null,
) {
  const w = window.open("", "_blank");
  if (!w) {
    alert("Please allow pop-ups to export PDF.");
    return;
  }

  const body = buildPreviewBody(name, docInfo, versionHistory, sections, customSections, revisionNumber, signatories, signedAt);

  // Build footer for signed documents
  let footerHtml = "";
  if (signatories && signatories.length > 0) {
    const approver = signatories.find((s) => s.status === "signed");
    const approvalDate = signedAt ? new Date(signedAt).toLocaleDateString() : (approver?.signed_at ? new Date(approver.signed_at).toLocaleDateString() : "");
    const printDate = new Date().toLocaleDateString();
    const parts: string[] = [];
    if (approver) parts.push(`Approved by: ${approver.display_name}`);
    if (approvalDate) parts.push(`Date of approval: ${approvalDate}`);
    parts.push(`Printed: ${printDate}`);
    footerHtml = `<div class="soaw-print-footer">${parts.join("  &middot;  ")}</div>`;
  }

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${name || "SoAW"}</title>
<style>${PREVIEW_CSS}</style></head><body class="soaw-preview">${body}${footerHtml}</body></html>`;

  w.document.write(html);
  w.document.close();

  // Give the browser a moment to render, then open print dialog
  setTimeout(() => w.print(), 400);
}
