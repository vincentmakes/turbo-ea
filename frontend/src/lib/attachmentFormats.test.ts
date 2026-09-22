import { describe, it, expect } from "vitest";
import {
  ACCEPTED_ATTACHMENT_EXTENSIONS,
  ATTACHMENT_ACCEPT,
  ATTACHMENT_FORMATS,
  ATTACHMENT_MIME_ICONS,
  ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_MB,
  hasAcceptedExtension,
} from "./attachmentFormats";

describe("attachment format table", () => {
  it("keeps the byte cap derived from the megabyte one", () => {
    expect(MAX_ATTACHMENT_MB).toBe(20);
    expect(MAX_ATTACHMENT_BYTES).toBe(20 * 1024 * 1024);
  });

  it("gives every row a label key and an icon", () => {
    for (const f of ATTACHMENT_FORMATS) {
      expect(f.labelKey, f.ext).toMatch(/^resources\.mime\./);
      expect(f.icon, f.ext).toBeTruthy();
      expect(f.ext, f.ext).toMatch(/^\.[a-z0-9]+$/);
      expect(f.mime, f.ext).toContain("/");
    }
  });

  it("lists no extension twice", () => {
    expect(new Set(ACCEPTED_ATTACHMENT_EXTENSIONS).size).toBe(
      ACCEPTED_ATTACHMENT_EXTENSIONS.length,
    );
  });

  it("builds the picker's accept list from the table", () => {
    expect(ATTACHMENT_ACCEPT.split(",")).toEqual([...ACCEPTED_ATTACHMENT_EXTENSIONS]);
  });

  it("collapses the filter list to one row per MIME", () => {
    // .jpg and .jpeg are one stored type, as are .gz and .tgz — two filter
    // rows for one type would look like two kinds of file.
    const ids = ATTACHMENT_MIME_TYPES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("image/jpeg");
    expect(ids.filter((i) => i === "image/jpeg")).toHaveLength(1);
    expect(ids.filter((i) => i === "application/gzip")).toHaveLength(1);
  });

  it("maps every MIME to an icon", () => {
    for (const f of ATTACHMENT_FORMATS) {
      expect(ATTACHMENT_MIME_ICONS[f.mime], f.mime).toBeTruthy();
    }
  });
});

describe("hasAcceptedExtension", () => {
  it("accepts a listed extension regardless of case", () => {
    expect(hasAcceptedExtension("report.pdf")).toBe(true);
    expect(hasAcceptedExtension("REPORT.PDF")).toBe(true);
    expect(hasAcceptedExtension("Photo.JpEg")).toBe(true);
  });

  it("reads the last suffix, so a tarball is a .gz", () => {
    expect(hasAcceptedExtension("archive.tar.gz")).toBe(true);
  });

  it("rejects an extension that is not on the list", () => {
    expect(hasAcceptedExtension("setup.exe")).toBe(false);
    expect(hasAcceptedExtension("script.js")).toBe(false);
  });

  it("rejects a name with no usable extension", () => {
    expect(hasAcceptedExtension("README")).toBe(false);
    expect(hasAcceptedExtension("trailing.")).toBe(false);
    // A dotfile is a hidden file, not an extension.
    expect(hasAcceptedExtension(".pdf")).toBe(false);
    expect(hasAcceptedExtension("")).toBe(false);
  });

  it("ignores any directory part of the name", () => {
    expect(hasAcceptedExtension("C:\\Users\\me\\report.pdf")).toBe(true);
    expect(hasAcceptedExtension("/home/me/notes.md")).toBe(true);
  });

  it("covers the formats this change added", () => {
    for (const name of ["a.zip", "a.msg", "a.eml", "a.odt", "a.7z", "a.csv", "a.webp"]) {
      expect(hasAcceptedExtension(name), name).toBe(true);
    }
  });
});
