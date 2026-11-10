import { describe, expect, it } from "vitest";
import { htmlToPlainText, looksLikeHtml, plainTextToHtml } from "./richTextCell";

describe("htmlToPlainText", () => {
  it("fills empty restricted / deleted mentions only when given labels", () => {
    const html =
      '<p>a <span data-type="mention" data-kind="card" data-restricted="true" data-token="ab12cd34"></span> ' +
      '<span data-type="mention" data-kind="card" data-id="x" data-missing="true"></span></p>';
    const labels = {
      restricted: { card: "R-card", decision: "R-dec", user: "R-user", other: "R" },
      missing: { card: "M-card", decision: "M-dec", user: "M-user", other: "M" },
    };
    expect(htmlToPlainText(html, labels)).toBe("a R-card M-card");
    expect(htmlToPlainText(html)).toBe("a");
  });

  it("returns an empty string for nothing", () => {
    expect(htmlToPlainText(null)).toBe("");
    expect(htmlToPlainText(undefined)).toBe("");
    expect(htmlToPlainText("")).toBe("");
  });

  it("separates paragraphs and headings by a blank line and keeps <br> as a line break", () => {
    expect(htmlToPlainText("<h2>Title</h2><p>One<br>two</p><p>Three</p>")).toBe(
      "Title\n\nOne\ntwo\n\nThree",
    );
  });

  it("writes bullets and numbered items with their markers", () => {
    expect(
      htmlToPlainText("<p>Intro</p><ul><li>a</li><li><strong>b</strong></li></ul><ol><li>x</li><li>y</li></ol>"),
    ).toBe("Intro\n\n- a\n- b\n\n1. x\n2. y");
  });

  it("drops formatting but keeps the text, collapsing whitespace", () => {
    expect(htmlToPlainText('<p>Use <a href="https://x.test">the   docs</a>\n now</p>')).toBe(
      "Use the docs now",
    );
  });

  it("decodes entities and leaves bare text alone", () => {
    expect(htmlToPlainText("a &amp; b &lt;c&gt;")).toBe("a & b <c>");
  });
});

describe("looksLikeHtml", () => {
  it("recognises markup and nothing else", () => {
    expect(looksLikeHtml("<p>x</p>")).toBe(true);
    expect(looksLikeHtml("line<br/>break")).toBe(true);
    expect(looksLikeHtml('<a href="x">y</a>')).toBe(true);
    expect(looksLikeHtml("a < b and c > d")).toBe(false);
    expect(looksLikeHtml("<placeholder>")).toBe(false);
  });
});

describe("plainTextToHtml", () => {
  it("returns an empty string for a blank cell", () => {
    expect(plainTextToHtml(undefined)).toBe("");
    expect(plainTextToHtml(null)).toBe("");
    expect(plainTextToHtml("  \n ")).toBe("");
  });

  it("turns blank lines into paragraphs and single line breaks into <br>", () => {
    expect(plainTextToHtml("One\ntwo\r\n\r\nThree")).toBe("<p>One<br>two</p><p>Three</p>");
  });

  it("builds bullet and numbered lists from runs of marked lines", () => {
    expect(plainTextToHtml("Intro\n- a\n* b\n• c\n\n1. x\n2) y")).toBe(
      "<p>Intro</p><ul><li>a</li><li>b</li><li>c</li></ul><ol><li>x</li><li>y</li></ol>",
    );
  });

  it("escapes text so a cell cannot inject markup", () => {
    expect(plainTextToHtml("a < b & \"c\"")).toBe("<p>a &lt; b &amp; &quot;c&quot;</p>");
    expect(plainTextToHtml("- <img src=x onerror=alert(1)>")).toBe(
      "<ul><li>&lt;img src=x onerror=alert(1)&gt;</li></ul>",
    );
  });

  it("passes a cell that already holds HTML through unchanged", () => {
    expect(plainTextToHtml("  <p><strong>Kept</strong></p> ")).toBe("<p><strong>Kept</strong></p>");
  });

  it("round-trips what the export writes", () => {
    const html = "<p>Intro<br>more</p><ul><li>a</li><li>b</li></ul><ol><li>x</li></ol><p>End</p>";
    expect(plainTextToHtml(htmlToPlainText(html))).toBe(html);
  });
});
