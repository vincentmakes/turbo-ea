/**
 * What a card file attachment may be — the frontend's mirror of
 * `backend/app/services/attachment_validation.py`.
 *
 * The backend is the authority: it refuses anything whose bytes do not match
 * its extension, and stores the canonical MIME from its own table. This file
 * exists so the picker's `accept=`, the pre-upload checks and the Resources
 * filters name the same set without a round-trip — and
 * `backend/tests/services/test_upload_limits.py` reads it off disk and fails
 * if the two extension lists or the size cap ever drift apart.
 */

/** Keep in step with `MAX_ATTACHMENT_MB` in `attachment_validation.py`. */
export const MAX_ATTACHMENT_MB = 20;
export const MAX_ATTACHMENT_BYTES = MAX_ATTACHMENT_MB * 1024 * 1024;

export interface AttachmentFormat {
  /** Lowercase, leading dot. */
  ext: string;
  /** Canonical MIME the backend stores for this extension. */
  mime: string;
  /** An `admin:resources.mime.*` key. */
  labelKey: string;
  icon: string;
}

const ODF = "application/vnd.oasis.opendocument";
const OOXML = "application/vnd.openxmlformats-officedocument";

export const ATTACHMENT_FORMATS: readonly AttachmentFormat[] = [
  { ext: ".pdf", mime: "application/pdf", labelKey: "resources.mime.pdf", icon: "picture_as_pdf" },
  {
    ext: ".docx",
    mime: `${OOXML}.wordprocessingml.document`,
    labelKey: "resources.mime.docx",
    icon: "description",
  },
  {
    ext: ".xlsx",
    mime: `${OOXML}.spreadsheetml.sheet`,
    labelKey: "resources.mime.xlsx",
    icon: "table_chart",
  },
  {
    ext: ".pptx",
    mime: `${OOXML}.presentationml.presentation`,
    labelKey: "resources.mime.pptx",
    icon: "slideshow",
  },
  { ext: ".doc", mime: "application/msword", labelKey: "resources.mime.doc", icon: "description" },
  {
    ext: ".xls",
    mime: "application/vnd.ms-excel",
    labelKey: "resources.mime.xls",
    icon: "table_chart",
  },
  {
    ext: ".ppt",
    mime: "application/vnd.ms-powerpoint",
    labelKey: "resources.mime.ppt",
    icon: "slideshow",
  },
  { ext: ".odt", mime: `${ODF}.text`, labelKey: "resources.mime.odt", icon: "description" },
  { ext: ".ods", mime: `${ODF}.spreadsheet`, labelKey: "resources.mime.ods", icon: "table_chart" },
  { ext: ".odp", mime: `${ODF}.presentation`, labelKey: "resources.mime.odp", icon: "slideshow" },
  { ext: ".odg", mime: `${ODF}.graphics`, labelKey: "resources.mime.odg", icon: "image" },
  { ext: ".zip", mime: "application/zip", labelKey: "resources.mime.zip", icon: "folder_zip" },
  { ext: ".gz", mime: "application/gzip", labelKey: "resources.mime.gzip", icon: "folder_zip" },
  { ext: ".tgz", mime: "application/gzip", labelKey: "resources.mime.gzip", icon: "folder_zip" },
  { ext: ".tar", mime: "application/x-tar", labelKey: "resources.mime.tar", icon: "folder_zip" },
  {
    ext: ".7z",
    mime: "application/x-7z-compressed",
    labelKey: "resources.mime.7z",
    icon: "folder_zip",
  },
  { ext: ".msg", mime: "application/vnd.ms-outlook", labelKey: "resources.mime.msg", icon: "mail" },
  { ext: ".eml", mime: "message/rfc822", labelKey: "resources.mime.eml", icon: "mail" },
  { ext: ".png", mime: "image/png", labelKey: "resources.mime.png", icon: "image" },
  { ext: ".jpg", mime: "image/jpeg", labelKey: "resources.mime.jpeg", icon: "image" },
  { ext: ".jpeg", mime: "image/jpeg", labelKey: "resources.mime.jpeg", icon: "image" },
  { ext: ".gif", mime: "image/gif", labelKey: "resources.mime.gif", icon: "image" },
  { ext: ".webp", mime: "image/webp", labelKey: "resources.mime.webp", icon: "image" },
  { ext: ".svg", mime: "image/svg+xml", labelKey: "resources.mime.svg", icon: "image" },
  { ext: ".txt", mime: "text/plain", labelKey: "resources.mime.txt", icon: "description" },
  { ext: ".csv", mime: "text/csv", labelKey: "resources.mime.csv", icon: "table_chart" },
  { ext: ".md", mime: "text/markdown", labelKey: "resources.mime.md", icon: "description" },
  { ext: ".json", mime: "application/json", labelKey: "resources.mime.json", icon: "data_object" },
  { ext: ".xml", mime: "application/xml", labelKey: "resources.mime.xml", icon: "data_object" },
];

export const ACCEPTED_ATTACHMENT_EXTENSIONS: readonly string[] = ATTACHMENT_FORMATS.map(
  (f) => f.ext,
);

/** The file input's `accept=` list. */
export const ATTACHMENT_ACCEPT = ACCEPTED_ATTACHMENT_EXTENSIONS.join(",");

/** MIME → icon, for rendering a stored attachment's row. */
export const ATTACHMENT_MIME_ICONS: Record<string, string> = Object.fromEntries(
  ATTACHMENT_FORMATS.map((f) => [f.mime, f.icon]),
);

/**
 * One entry per *MIME* (jpg and jpeg share one, as do gz and tgz) — the
 * Resources filter sidebar filters on the stored MIME, not the extension.
 */
export const ATTACHMENT_MIME_TYPES: { id: string; labelKey: string; icon: string }[] =
  ATTACHMENT_FORMATS.reduce<{ id: string; labelKey: string; icon: string }[]>((acc, f) => {
    if (!acc.some((e) => e.id === f.mime)) {
      acc.push({ id: f.mime, labelKey: f.labelKey, icon: f.icon });
    }
    return acc;
  }, []);

/**
 * Whether a filename carries an accepted extension.
 *
 * Browsers do not enforce `accept=` on a drag-drop or an "All files" pick, so
 * this is what stops an obviously-wrong file before the upload round-trip.
 * The backend still checks the bytes — this only saves a wasted request.
 */
export function hasAcceptedExtension(filename: string): boolean {
  const name = (filename || "").trim().split(/[/\\]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return false;
  return ACCEPTED_ATTACHMENT_EXTENSIONS.includes(name.slice(dot).toLowerCase());
}
