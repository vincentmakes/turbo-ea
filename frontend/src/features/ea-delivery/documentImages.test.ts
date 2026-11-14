import { describe, it, expect, vi, beforeEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { api } from "@/api/client";
import { MAX_DOCUMENT_IMAGE_BYTES, MAX_DOCUMENT_IMAGE_MB } from "@/lib/attachmentFormats";
import {
  DOCUMENT_IMAGE_ACCEPT,
  DOCUMENT_IMAGE_CSS,
  clipboardHtmlHasText,
  documentImagePath,
  documentImageSrc,
  imageRefusal,
  isDocumentImageSrc,
  uploadDocumentImage,
} from "./documentImages";
import {
  createDocumentImageExtension,
  parseAlign,
  parseDimension,
  renderDimension,
} from "./documentImageExtension";

vi.mock("@/api/client", () => ({
  api: { upload: vi.fn() },
}));

const ID = "0b0e5b1e-6a0e-4c43-9b8e-2d1c4a5f7e01";
const ADR_SRC = `/api/v1/document-images/adr/${ID}`;

describe("attachmentFormats picture cap", () => {
  it("is 5 MB", () => {
    expect(MAX_DOCUMENT_IMAGE_MB).toBe(5);
    expect(MAX_DOCUMENT_IMAGE_BYTES).toBe(5 * 1024 * 1024);
  });
});

describe("documentImageSrc", () => {
  it("builds the relative route of a kind", () => {
    expect(documentImageSrc("adr", ID)).toBe(ADR_SRC);
    expect(documentImageSrc("soaw", ID)).toBe(`/api/v1/document-images/soaw/${ID}`);
  });
});

describe("isDocumentImageSrc / documentImagePath", () => {
  it("accepts this kind's relative route", () => {
    expect(isDocumentImageSrc(ADR_SRC, "adr")).toBe(true);
    expect(documentImagePath(ADR_SRC, "adr")).toBe(ADR_SRC);
    expect(isDocumentImageSrc(`/api/v1/document-images/soaw/${ID}`, "soaw")).toBe(true);
  });

  it("accepts an upper-case uuid and gives it back lower-cased", () => {
    const upper = `/api/v1/document-images/adr/${ID.toUpperCase()}`;
    expect(isDocumentImageSrc(upper, "adr")).toBe(true);
    expect(documentImagePath(upper, "adr")).toBe(ADR_SRC);
    expect(documentImagePath(`${window.location.origin}${upper}`, "adr")).toBe(ADR_SRC);
  });

  it("accepts the same path absolutised against this page's origin, and gives it back relative", () => {
    const absolute = `${window.location.origin}${ADR_SRC}`;
    expect(isDocumentImageSrc(absolute, "adr")).toBe(true);
    expect(documentImagePath(absolute, "adr")).toBe(ADR_SRC);
  });

  it.each([
    ["another kind", `/api/v1/document-images/soaw/${ID}`],
    ["another origin", `https://evil.example${ADR_SRC}`],
    ["a protocol-relative URL", `//evil.example${ADR_SRC}`],
    ["a lookalike origin", `${window.location.origin}.evil.example${ADR_SRC}`],
    ["a data: URL", "data:image/png;base64,AAAA"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a query string", `${ADR_SRC}?x=1`],
    ["a fragment", `${ADR_SRC}#x`],
    ["a trailing path", `${ADR_SRC}/download`],
    ["a trailing slash", `${ADR_SRC}/`],
    ["a leading path", `/x${ADR_SRC}`],
    ["a non-UUID id", "/api/v1/document-images/adr/123"],
    ["an upper-case route prefix", `/API/V1/Document-Images/adr/${ID}`],
    ["an upper-case kind", `/api/v1/document-images/ADR/${ID}`],
    ["a dot-segment", `/api/v1/document-images/adr/../adr/${ID}`],
    ["an empty string", ""],
    ["null", null],
    ["undefined", undefined],
  ])("refuses %s", (_label, src) => {
    expect(isDocumentImageSrc(src, "adr")).toBe(false);
    expect(documentImagePath(src, "adr")).toBeNull();
  });
});

describe("imageRefusal", () => {
  const file = (type: string, size = 10) => ({ type, size });

  it.each(["image/png", "image/jpeg", "image/gif", "image/webp"])("accepts %s", (type) => {
    expect(imageRefusal(file(type))).toBeNull();
  });

  it.each(["image/svg+xml", "application/pdf", "", "image/bmp"])("refuses the type %s", (type) => {
    expect(imageRefusal(file(type))).toBe("Only PNG, JPEG, GIF or WebP pictures can be inserted");
  });

  it("accepts exactly the cap and refuses one byte more", () => {
    expect(imageRefusal(file("image/png", MAX_DOCUMENT_IMAGE_BYTES))).toBeNull();
    expect(imageRefusal(file("image/png", MAX_DOCUMENT_IMAGE_BYTES + 1))).toBe(
      "The picture is larger than 5 MB",
    );
  });

  it("names the type before the size", () => {
    expect(imageRefusal(file("image/svg+xml", MAX_DOCUMENT_IMAGE_BYTES + 1))).toBe(
      "Only PNG, JPEG, GIF or WebP pictures can be inserted",
    );
  });

  it("offers the same four types to the file picker", () => {
    expect(DOCUMENT_IMAGE_ACCEPT).toBe("image/png,image/jpeg,image/gif,image/webp");
  });
});

describe("uploadDocumentImage", () => {
  beforeEach(() => vi.mocked(api.upload).mockReset());

  it("posts the file to the kind's store and returns the answer", async () => {
    const answer = { id: ID, src: ADR_SRC, mime_type: "image/png", size: 3 };
    vi.mocked(api.upload).mockResolvedValue(answer);
    const f = new File(["abc"], "a.png", { type: "image/png" });
    await expect(uploadDocumentImage("adr", f)).resolves.toEqual(answer);
    expect(api.upload).toHaveBeenCalledWith("/document-images/adr", f, "file");
    await uploadDocumentImage("soaw", f);
    expect(api.upload).toHaveBeenLastCalledWith("/document-images/soaw", f, "file");
  });
});

describe("clipboardHtmlHasText", () => {
  it("is false for nothing, whitespace, or pictures alone", () => {
    expect(clipboardHtmlHasText("")).toBe(false);
    expect(clipboardHtmlHasText("   ")).toBe(false);
    expect(clipboardHtmlHasText('<meta charset="utf-8"><img src="https://x.io/a.png">')).toBe(false);
    expect(clipboardHtmlHasText("<p> </p>")).toBe(false);
  });

  it("is true when any text is there", () => {
    expect(clipboardHtmlHasText("<table><tr><td>42</td></tr></table>")).toBe(true);
    expect(clipboardHtmlHasText('<p>a</p><img src="x">')).toBe(true);
  });
});

describe("DOCUMENT_IMAGE_CSS", () => {
  it("caps the width and aligns with logical margins", () => {
    expect(DOCUMENT_IMAGE_CSS).toBe(
      [
        "img { max-width: 100%; height: auto; }",
        'img[data-align="center"] { display: block; margin-inline: auto; }',
        'img[data-align="right"] { display: block; margin-inline-start: auto; }',
      ].join("\n"),
    );
  });
});

describe("documentImageExtension attribute helpers", () => {
  it("parses only center and right as an alignment", () => {
    expect(parseAlign("center")).toBe("center");
    expect(parseAlign("right")).toBe("right");
    expect(parseAlign("left")).toBeNull();
    expect(parseAlign("CENTER")).toBeNull();
    expect(parseAlign("")).toBeNull();
    expect(parseAlign(null)).toBeNull();
    expect(parseAlign(undefined)).toBeNull();
  });

  it("parses a dimension of 1 to 4000 written as digits", () => {
    expect(parseDimension("1")).toBe(1);
    expect(parseDimension("640")).toBe(640);
    expect(parseDimension("4000")).toBe(4000);
    expect(parseDimension("0")).toBeNull();
    expect(parseDimension("4001")).toBeNull();
    expect(parseDimension("12.5")).toBeNull();
    expect(parseDimension("-3")).toBeNull();
    expect(parseDimension("100px")).toBeNull();
    expect(parseDimension(" 100")).toBeNull();
    expect(parseDimension("")).toBeNull();
    expect(parseDimension(null)).toBeNull();
  });

  it("renders a measured size as a bounded integer", () => {
    expect(renderDimension(320)).toBe("320");
    expect(renderDimension(320.6)).toBe("321");
    expect(renderDimension(0.2)).toBe("1");
    expect(renderDimension(5000)).toBe("4000");
    expect(renderDimension(4000)).toBe("4000");
    expect(renderDimension(1)).toBe("1");
    expect(renderDimension(null)).toBeNull();
    expect(renderDimension("320")).toBeNull();
    expect(renderDimension(Number.NaN)).toBeNull();
    expect(renderDimension(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

/** A bare TipTap editor (no React) with the given picture node. */
function editorWith(image: ReturnType<typeof createDocumentImageExtension> | typeof Image, content = "<p></p>") {
  return new Editor({ extensions: [StarterKit, image], content });
}

describe("createDocumentImageExtension", () => {
  it("is a block node with the resize view, aspect ratio kept", () => {
    const ext = createDocumentImageExtension("adr");
    expect(ext.name).toBe("image");
    expect(ext.options.inline).toBe(false);
    expect(ext.options.allowBase64).toBe(false);
    expect(ext.options.resize).toEqual({
      enabled: true,
      directions: ["top-left", "top-right", "bottom-left", "bottom-right"],
      minWidth: 32,
      minHeight: 32,
      alwaysPreserveAspectRatio: true,
    });
  });

  it("keeps a typed markdown picture as text (the stock node would make one)", () => {
    const typed = "![x](https://e.com/a.png)";
    // Input rules run on typed text: the closing ")" is the keystroke.
    const type = (e: Editor) => {
      e.commands.insertContent(typed.slice(0, -1));
      const { from, to } = e.state.selection;
      const handled = e.view.someProp("handleTextInput", (f) =>
        f(e.view, from, to, ")", () => e.state.tr.insertText(")", from, to)),
      );
      if (!handled) e.view.dispatch(e.state.tr.insertText(")", from, to));
    };
    // Control: the stock extension's input rule turns this into a picture.
    const stock = editorWith(Image);
    type(stock);
    expect(stock.getHTML()).toContain('<img src="https://e.com/a.png" alt="x">');
    stock.destroy();

    const ours = editorWith(createDocumentImageExtension("adr"));
    type(ours);
    expect(ours.getHTML()).toBe(`<p>${typed}</p>`);
    ours.destroy();
  });

  it("drops a picture of another kind and keeps its own kind's", () => {
    const soawSrc = `/api/v1/document-images/soaw/${ID}`;
    const html = `<img src="${ADR_SRC}"><img src="${soawSrc}">`;
    const adr = editorWith(createDocumentImageExtension("adr"), html);
    expect(adr.getHTML()).toBe(`<img src="${ADR_SRC}">`);
    adr.destroy();
    const soaw = editorWith(createDocumentImageExtension("soaw"), html);
    expect(soaw.getHTML()).toBe(`<img src="${soawSrc}">`);
    soaw.destroy();
  });

  it("drops unsafe dimensions and alignments, keeps alt and title", () => {
    const e = editorWith(
      createDocumentImageExtension("adr"),
      `<img src="${ADR_SRC}" alt="Plan" title="T" width="99999" height="1.5" data-align="left" class="x" style="color:red">`,
    );
    expect(e.getHTML()).toBe(`<img src="${ADR_SRC}" alt="Plan" title="T">`);
    e.destroy();
  });

  it("writes attributes in the canonical order whatever order they came in", () => {
    const e = editorWith(
      createDocumentImageExtension("adr"),
      `<img data-align="right" height="200" width="300" title="T" alt="A" src="${ADR_SRC}">`,
    );
    expect(e.getHTML()).toBe(
      `<img src="${ADR_SRC}" alt="A" title="T" width="300" height="200" data-align="right">`,
    );
    e.destroy();
  });
});
