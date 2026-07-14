import i18n from "@/i18n";
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
  PageBreak,
  convertInchesToTwip,
} from "docx";
import { saveAs } from "file-saver";
import { getExtensionAdrExportSections } from "@/lib/extensionHost";
import type { ArchitectureDecision } from "@/types";

// ─── style constants (mirroring soawExport.ts) ──────────────────────────────

const FONT = "Segoe UI";
const COLOR_BODY = "222222";
const COLOR_H1 = "1a1a2e";
const COLOR_H2 = "333333";
const COLOR_H3 = "444444";
const COLOR_PART = "1976d2";
const COLOR_SUBTITLE = "555555";
const COLOR_PREAMBLE = "666666";
const COLOR_BORDER = "cccccc";

const SIZE_BODY = 22; // 11pt
const SIZE_TITLE = 44; // 22pt
const SIZE_SUBTITLE = 28; // 14pt
const SIZE_PART = 36; // 18pt
const SIZE_H2 = 32; // 16pt
const SIZE_H3 = 26; // 13pt
const SIZE_TABLE = 20; // 10pt

const LINE_SPACING = 384;
const SPACING_AFTER_DEFAULT = 160;
const SPACING_PART_BEFORE = 540;
const SPACING_PART_AFTER = 200;
const SPACING_H2_BEFORE = 420;
const SPACING_H3_BEFORE = 300;
const SPACING_AFTER_TABLE = 240;

const CELL_BORDER = {
  style: BorderStyle.SINGLE,
  size: 1,
  color: COLOR_BORDER,
};

// ─── helpers (HTML → docx Paragraphs) ───────────────────────────────────────

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
        const prefix = tag === "ol" ? `${idx + 1}. ` : "•  ";
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

function htmlIsEmpty(html: string | null | undefined): boolean {
  if (!html) return true;
  const text = (new DOMParser().parseFromString(html, "text/html").body.textContent ?? "").trim();
  return !text;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

function statusLabel(status: string, t: (key: string) => string): string {
  if (status === "draft") return t("status.draft");
  if (status === "in_review") return t("status.inReview");
  if (status === "signed") return t("status.signed");
  return status;
}

// ─── ADR export ─────────────────────────────────────────────────────────────

/**
 * Export one or more ADRs to a single styled .docx file.
 * Each ADR starts on a new page with a title block, metadata table, and the
 * standard ADR sections (Context, Decision, Consequences, Alternatives,
 * Linked Cards, Signatures).
 */
export async function exportAdrsToDocx(adrs: ArchitectureDecision[]): Promise<void> {
  if (adrs.length === 0) return;
  const t = (key: string, opts?: Record<string, unknown>) =>
    String(i18n.t(`delivery:${key}`, opts as never));

  const children: (Paragraph | Table)[] = [];

  // ── Cover / document title ──
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: t("adr.export.title"),
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

  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: t("adr.export.subtitle", { count: adrs.length }),
          font: FONT,
          size: SIZE_SUBTITLE,
          color: COLOR_SUBTITLE,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 3, color: COLOR_PART, space: 8 },
      },
    }),
  );

  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: t("adr.export.generatedOn", { date: new Date().toLocaleDateString() }),
          italics: true,
          font: FONT,
          size: SIZE_BODY,
          color: COLOR_PREAMBLE,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    }),
  );

  // ── Table of contents (just a list of decisions) ──
  if (adrs.length > 1) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: t("adr.export.tableOfContents"),
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
        [t("adr.grid.reference"), t("adr.grid.title"), t("adr.grid.status")],
        adrs.map((a) => [a.reference_number, a.title, statusLabel(a.status, t)]),
      ),
    );
    children.push(new Paragraph({ spacing: { after: SPACING_AFTER_TABLE } }));
  }

  // ── Each ADR on its own page ──
  adrs.forEach((adr, idx) => {
    // Page break before every ADR after the first
    if (idx > 0) {
      children.push(
        new Paragraph({
          children: [new PageBreak()],
        }),
      );
    } else if (adrs.length > 1) {
      // After the TOC, also start the first decision on a new page
      children.push(
        new Paragraph({
          children: [new PageBreak()],
        }),
      );
    }

    // Part-style banner: reference + title
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `${adr.reference_number} — ${adr.title}`,
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

    // Metadata table (status, created, signed, signatories)
    const metaRows: [string, string][] = [];
    metaRows.push([t("adr.grid.status"), statusLabel(adr.status, t)]);
    if (adr.creator_name) metaRows.push([t("adr.grid.createdBy"), adr.creator_name]);
    if (adr.created_at) metaRows.push([t("adr.grid.created"), formatDate(adr.created_at)]);
    if (adr.updated_at) metaRows.push([t("adr.grid.lastModified"), formatDate(adr.updated_at)]);
    if (adr.signed_at) metaRows.push([t("adr.grid.signed"), formatDate(adr.signed_at)]);
    if (adr.revision_number && adr.revision_number > 1) {
      metaRows.push([
        t("adr.export.revisionLabel"),
        String(adr.revision_number),
      ]);
    }
    const signedNames = (adr.signatories ?? [])
      .filter((s) => s.status === "signed")
      .map((s) => s.display_name)
      .filter(Boolean);
    if (signedNames.length > 0) {
      metaRows.push([t("adr.grid.signedBy"), signedNames.join(", ")]);
    }

    children.push(
      buildDocxTable([t("export.field"), t("export.value")], metaRows),
    );
    children.push(new Paragraph({ spacing: { after: SPACING_AFTER_TABLE } }));

    // Section helper
    const addSection = (title: string, html: string | null) => {
      if (htmlIsEmpty(html)) return;
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: title,
              bold: true,
              font: FONT,
              size: SIZE_H2,
              color: COLOR_H2,
            }),
          ],
          spacing: { before: SPACING_H2_BEFORE, after: SPACING_AFTER_DEFAULT },
        }),
      );
      for (const p of htmlToParagraphs(html ?? "")) {
        children.push(p);
      }
    };

    addSection(t("adr.context"), adr.context);
    addSection(t("adr.decision"), adr.decision);
    addSection(t("adr.consequences"), adr.consequences);
    addSection(t("adr.alternativesConsidered"), adr.alternatives_considered);

    // Linked cards
    const linked = adr.linked_cards ?? [];
    if (linked.length > 0) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: t("adr.linkedCards"),
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
          [t("adr.export.cardName"), t("adr.export.cardType")],
          linked.map((c) => [c.name, c.type]),
        ),
      );
      children.push(new Paragraph({ spacing: { after: SPACING_AFTER_TABLE } }));
    }

    // Extension-contributed sections (SDK 1.3). Each
    // builder returns plain data that we render with the document's own styles;
    // a throwing builder is skipped so a bad extension never breaks the export.
    for (const { extKey, contribution } of getExtensionAdrExportSections()) {
      let sections;
      try {
        sections = contribution.build(adr as unknown as Record<string, unknown>);
      } catch (err) {
        console.warn(`[extension:${extKey}] ADR export builder threw — skipped`, err);
        continue;
      }
      for (const section of sections ?? []) {
        if (!section?.heading) continue;
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: section.heading,
                bold: true,
                font: FONT,
                size: SIZE_H2,
                color: COLOR_H2,
              }),
            ],
            spacing: { before: SPACING_H2_BEFORE, after: SPACING_AFTER_DEFAULT },
          }),
        );
        for (const para of section.paragraphs ?? []) {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: para, font: FONT, size: SIZE_BODY, color: COLOR_BODY })],
              spacing: { after: SPACING_AFTER_DEFAULT },
            }),
          );
        }
        if (section.table && section.table.headers.length > 0) {
          children.push(buildDocxTable(section.table.headers, section.table.rows));
          children.push(new Paragraph({ spacing: { after: SPACING_AFTER_TABLE } }));
        }
      }
    }

    // Signatures detail
    const sigs = adr.signatories ?? [];
    if (sigs.length > 0) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: t("adr.editor.signatures"),
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
          [t("adr.export.signatory"), t("adr.grid.status"), t("adr.grid.signed")],
          sigs.map((s) => [
            s.display_name + (s.email ? ` <${s.email}>` : ""),
            s.status === "signed" ? t("export.approved") : t("export.pending"),
            s.signed_at ? new Date(s.signed_at).toLocaleString() : "",
          ]),
        ),
      );
      children.push(new Paragraph({ spacing: { after: SPACING_AFTER_TABLE } }));
    }
  });

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: FONT, size: SIZE_BODY, color: COLOR_BODY },
          paragraph: { spacing: { line: LINE_SPACING } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const stamp = exportTimestamp();
  const filename =
    adrs.length === 1
      ? `${adrs[0].reference_number}_${stamp}.docx`
      : `ADRs_${stamp}.docx`;
  saveAs(blob, filename);
}

function exportTimestamp(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
}
