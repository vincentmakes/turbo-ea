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
} from "docx";
import { saveAs } from "file-saver";
import {
  SOAW_TEMPLATE_SECTIONS,
  TOGAF_PHASES,
  type TemplateSectionDef,
} from "./soawTemplate";
import type { SoAWDocumentInfo, SoAWVersionEntry, SoAWSectionData } from "@/types";

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
        paragraphs.push(new Paragraph({ children: [new TextRun(text)] }));
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (tag === "p") {
      const runs = inlineRuns(el);
      if (runs.length > 0) paragraphs.push(new Paragraph({ children: runs }));
    } else if (tag === "h3" || tag === "h4") {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: el.textContent ?? "", bold: true })],
          heading: tag === "h3" ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_4,
        }),
      );
    } else if (tag === "ul" || tag === "ol") {
      el.querySelectorAll("li").forEach((li, idx) => {
        const prefix = tag === "ol" ? `${idx + 1}. ` : "- ";
        paragraphs.push(
          new Paragraph({
            children: [new TextRun(prefix + (li.textContent ?? ""))],
            indent: { left: 720 },
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
              color: "666666",
            }),
          ],
          indent: { left: 720 },
        }),
      );
    } else {
      // Recurse into unknown wrappers
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
      if (text) runs.push(new TextRun(text));
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const c = child as HTMLElement;
      const tag = c.tagName.toLowerCase();
      const text = c.textContent ?? "";
      runs.push(
        new TextRun({
          text,
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

/** Build a simple docx Table from column headers and row data. */
function buildDocxTable(columns: string[], rows: string[][]): Table {
  const headerCells = columns.map(
    (col) =>
      new TableCell({
        children: [
          new Paragraph({
            children: [new TextRun({ text: col, bold: true, size: 20 })],
          }),
        ],
        shading: { type: ShadingType.CLEAR, fill: "f0f0f0" },
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
                  children: [new TextRun({ text: cell, size: 20 })],
                }),
              ],
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
  const tables: (Paragraph | Table)[] = [];

  // Title
  tables.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "Statement of Architecture Work",
          bold: true,
          size: 36,
        }),
      ],
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
    }),
  );

  tables.push(
    new Paragraph({
      children: [new TextRun({ text: name, size: 28, color: "333333" })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    }),
  );

  // Document info table
  const infoRows = [
    ["Project Name", docInfo.project_name],
    ["Prepared By", docInfo.prepared_by],
    ["Title", docInfo.title],
    ["Reviewed By", docInfo.reviewed_by],
    ["Review Date", docInfo.review_date],
  ];
  tables.push(
    new Paragraph({
      children: [new TextRun({ text: "Document Information", bold: true, size: 24 })],
      heading: HeadingLevel.HEADING_2,
    }),
  );
  tables.push(
    buildDocxTable(
      ["Field", "Value"],
      infoRows,
    ),
  );
  tables.push(new Paragraph({ spacing: { after: 200 } }));

  // Version history
  if (versionHistory.some((v) => v.version || v.date)) {
    tables.push(
      new Paragraph({
        children: [
          new TextRun({ text: "Document Version History", bold: true, size: 24 }),
        ],
        heading: HeadingLevel.HEADING_2,
      }),
    );
    tables.push(
      buildDocxTable(
        ["Version", "Date", "Revised By", "Description"],
        versionHistory.map((v) => [v.version, v.date, v.revised_by, v.description]),
      ),
    );
    tables.push(new Paragraph({ spacing: { after: 200 } }));
  }

  // Sections
  let currentPart: string | null = null;

  const addSectionContent = (def: TemplateSectionDef, data: SoAWSectionData) => {
    if (data.hidden) return;

    // Part header
    if (def.part !== currentPart) {
      currentPart = def.part;
      tables.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `Part ${def.part}: ${def.part === "I" ? "Statement of Architecture Work" : "Baseline and Target Architectures"}`,
              bold: true,
              size: 28,
            }),
          ],
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 400, after: 200 },
        }),
      );
    }

    // Section heading
    const level =
      def.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
    tables.push(
      new Paragraph({
        children: [
          new TextRun({ text: def.title, bold: true, size: def.level === 2 ? 24 : 22 }),
        ],
        heading: level,
      }),
    );

    if (def.preamble) {
      tables.push(
        new Paragraph({
          children: [
            new TextRun({ text: def.preamble, italics: true, size: 20 }),
          ],
        }),
      );
    }

    if (def.type === "rich_text" && data.content) {
      for (const p of htmlToParagraphs(data.content)) {
        tables.push(p);
      }
    }

    if (def.type === "table" && data.table_data) {
      tables.push(
        buildDocxTable(data.table_data.columns, data.table_data.rows),
      );
    }

    if (def.type === "togaf_phases" && data.togaf_data) {
      tables.push(
        buildDocxTable(
          ["Phase", "In / Out"],
          TOGAF_PHASES.map((p) => [p.label, data.togaf_data?.[p.key] ?? ""]),
        ),
      );
    }

    tables.push(new Paragraph({ spacing: { after: 200 } }));

    // Insert custom sections after this template section
    for (const cs of customSections) {
      if (cs.insertAfter === def.id) {
        tables.push(
          new Paragraph({
            children: [new TextRun({ text: cs.title, bold: true, size: 22 })],
            heading: HeadingLevel.HEADING_3,
          }),
        );
        for (const p of htmlToParagraphs(cs.content)) {
          tables.push(p);
        }
        tables.push(new Paragraph({ spacing: { after: 200 } }));
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
      tables.push(
        new Paragraph({
          children: [new TextRun({ text: cs.title, bold: true, size: 22 })],
          heading: HeadingLevel.HEADING_3,
        }),
      );
      for (const p of htmlToParagraphs(cs.content)) {
        tables.push(p);
      }
      tables.push(new Paragraph({ spacing: { after: 200 } }));
    }
  }

  const doc = new Document({
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
        children: tables,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const filename = `${name || "SoAW"}_${new Date().toISOString().slice(0, 10)}.docx`;
  saveAs(blob, filename);
}

// ─── PDF export (print-based) ───────────────────────────────────────────────

export function exportToPdf(
  name: string,
  docInfo: SoAWDocumentInfo,
  versionHistory: SoAWVersionEntry[],
  sections: Record<string, SoAWSectionData>,
  customSections: { id: string; title: string; content: string; insertAfter: string }[],
) {
  const w = window.open("", "_blank");
  if (!w) {
    alert("Please allow pop-ups to export PDF.");
    return;
  }

  let html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${name || "SoAW"}</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; max-width: 800px; margin: 40px auto; color: #222; line-height: 1.6; font-size: 11pt; }
  h1 { font-size: 22pt; color: #1a1a2e; border-bottom: 2px solid #1976d2; padding-bottom: 8px; }
  h2 { font-size: 16pt; color: #333; margin-top: 28px; }
  h3 { font-size: 13pt; color: #444; margin-top: 20px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; font-size: 10pt; }
  th { background: #f5f5f5; font-weight: 600; }
  .meta-label { font-weight: 600; width: 140px; }
  .part-header { font-size: 18pt; color: #1976d2; margin-top: 36px; border-bottom: 2px solid #e0e0e0; padding-bottom: 6px; }
  .preamble { color: #666; font-style: italic; margin-bottom: 8px; }
  .custom-badge { display: inline-block; background: #1976d2; color: #fff; font-size: 9pt; padding: 1px 8px; border-radius: 3px; margin-right: 8px; }
  @media print { body { margin: 20px; } }
</style></head><body>`;

  // Title
  html += `<h1 style="text-align:center;border:none;">Statement of Architecture Work</h1>`;
  html += `<p style="text-align:center;font-size:14pt;color:#555;">${name}</p>`;

  // Doc info
  html += `<h2>Document Information</h2><table>`;
  html += `<tr><td class="meta-label">Project Name</td><td>${docInfo.project_name}</td></tr>`;
  html += `<tr><td class="meta-label">Prepared By</td><td>${docInfo.prepared_by}</td></tr>`;
  html += `<tr><td class="meta-label">Title</td><td>${docInfo.title}</td></tr>`;
  html += `<tr><td class="meta-label">Reviewed By</td><td>${docInfo.reviewed_by}</td></tr>`;
  html += `<tr><td class="meta-label">Review Date</td><td>${docInfo.review_date}</td></tr>`;
  html += `</table>`;

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
      html += `<table><tr><th>Phase</th><th>In / Out</th></tr>`;
      for (const p of TOGAF_PHASES) {
        html += `<tr><td>${p.label}</td><td style="text-align:center">${data.togaf_data[p.key] || "—"}</td></tr>`;
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

  html += `</body></html>`;

  w.document.write(html);
  w.document.close();

  // Give the browser a moment to render, then open print dialog
  setTimeout(() => w.print(), 400);
}
