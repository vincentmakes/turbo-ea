import DOMPurify from "dompurify";
import { describe, expect, it } from "vitest";

import {
  buildPrintHtml,
  documentContent,
  documentHeader,
  metaTable,
  section,
  signatureBlock,
  tableHtml,
  textBlock,
} from "./printDocument";
import { sanitizeRichHtml } from "./richHtml";
import { PINNED_TABLES } from "@/test/fixtures/tableMarkup";

function anchors(html: string): HTMLAnchorElement[] {
  const div = document.createElement("div");
  div.innerHTML = html;
  return Array.from(div.querySelectorAll("a"));
}

describe("sanitizeRichHtml", () => {
  it("returns an empty string for nothing", () => {
    expect(sanitizeRichHtml("")).toBe("");
    expect(sanitizeRichHtml(null)).toBe("");
    expect(sanitizeRichHtml(undefined)).toBe("");
  });

  it("makes a stored anchor open in a new tab", () => {
    const [a] = anchors(sanitizeRichHtml('<p><a href="https://x.io">x</a></p>'));
    expect(a.getAttribute("href")).toBe("https://x.io");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("overrides a stored target and rel", () => {
    const [a] = anchors(
      sanitizeRichHtml('<a href="https://x.io" target="_self" rel="opener">x</a>'),
    );
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("keeps a mailto anchor", () => {
    const [a] = anchors(sanitizeRichHtml('<a href="mailto:ops@x.io">mail</a>'));
    expect(a.getAttribute("href")).toBe("mailto:ops@x.io");
    expect(a.getAttribute("target")).toBe("_blank");
  });

  it("strips the href from an anchor with a disallowed scheme or a relative path", () => {
    for (const href of ["javascript:alert(1)", "/cards/1", "ftp://x.io", ""]) {
      const [a] = anchors(sanitizeRichHtml(`<a href="${href}" target="_blank">x</a>`));
      expect(a).toBeDefined();
      expect(a.hasAttribute("href")).toBe(false);
      expect(a.hasAttribute("target")).toBe(false);
    }
  });

  it("trims an href before deciding whether it may stay", () => {
    const [a] = anchors(sanitizeRichHtml('<a href=" https://x.io">x</a>'));
    expect(a.getAttribute("href")?.trim()).toBe("https://x.io");
    expect(a.getAttribute("target")).toBe("_blank");
  });

  it("drops a stored rel along with a disallowed href", () => {
    const [a] = anchors(sanitizeRichHtml('<a href="javascript:alert(1)" rel="opener">x</a>'));
    expect(a.hasAttribute("href")).toBe(false);
    expect(a.hasAttribute("rel")).toBe(false);
  });

  it("leaves elements other than anchors alone", () => {
    const html = '<span title="t" target="_self">x</span>';
    expect(sanitizeRichHtml(html)).toBe(html);
  });

  it("links a text node that is nothing but a URL", () => {
    const [a] = anchors(sanitizeRichHtml("<p>https://x.io</p>"));
    expect(a.getAttribute("href")).toBe("https://x.io");
  });

  it("links a bare URL in a text node and hands punctuation back", () => {
    const out = sanitizeRichHtml("<p>see https://x.io/doc. Then</p>");
    const [a] = anchors(out);
    expect(a.getAttribute("href")).toBe("https://x.io/doc");
    expect(a.textContent).toBe("https://x.io/doc");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(out).toContain("</a>. Then");
  });

  it("does not wrap a URL that is already inside an anchor", () => {
    const out = sanitizeRichHtml('<p><a href="https://x.io">https://x.io</a></p>');
    expect(anchors(out)).toHaveLength(1);
  });

  it("links inside nested markup, across several text nodes", () => {
    const out = sanitizeRichHtml(
      "<ul><li>one https://a.io</li><li><strong>two</strong> https://b.io</li></ul>",
    );
    expect(anchors(out).map((a) => a.getAttribute("href"))).toEqual([
      "https://a.io",
      "https://b.io",
    ]);
  });

  it("still strips scripts and event handlers", () => {
    const out = sanitizeRichHtml(
      '<p>x https://a.io<script>alert(1)</script><img src=x onerror="alert(1)"></p>',
    );
    expect(out).not.toContain("<script");
    expect(out).not.toContain("onerror");
    expect(anchors(out)).toHaveLength(1);
  });

  it("is idempotent", () => {
    const once = sanitizeRichHtml("<p>go https://x.io now</p>");
    expect(sanitizeRichHtml(once)).toBe(once);
  });

  it("leaves the global DOMPurify instance without the anchor hook", () => {
    sanitizeRichHtml('<a href="https://x.io">x</a>');
    const [a] = anchors(DOMPurify.sanitize('<a href="https://x.io" target="_blank">x</a>'));
    // Default DOMPurify drops `target`; if the hook had leaked it would be
    // re-added here.
    expect(a.hasAttribute("target")).toBe(false);
  });

  it("leaves the global DOMPurify instance without the tag, attribute and style policy", () => {
    sanitizeRichHtml('<table style="background:red" bgcolor="red"><tr><td colspan="0">x</td></tr></table>');
    // The SVG-thumbnail sanitisers (ProcessNavigator, ProcessFlowTab) use the
    // global instance and must keep their SVG and its styles.
    const svg = '<svg><rect style="fill: red" width="5" height="5"></rect></svg>';
    expect(DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true } })).toBe(svg);
    expect(DOMPurify.sanitize('<div style="color: red" bgcolor="red">x</div>')).toBe(
      '<div style="color: red" bgcolor="red">x</div>',
    );
    expect(DOMPurify.sanitize('<table><tbody><tr><td colspan="0">x</td></tr></tbody></table>')).toBe(
      '<table><tbody><tr><td colspan="0">x</td></tr></tbody></table>',
    );
  });

  it("passes target through on a mention span, so ADD_ATTR target stays configured", () => {
    // `target` is not in DOMPurify's default allowlist: only ADD_ATTR keeps it
    // on an element the anchor stamp never reaches.
    expect(sanitizeRichHtml('<p target="x">a</p>')).toBe('<p target="x">a</p>');
  });
});

describe("sanitizeRichHtml mention spans", () => {
  const ID = "0b0e5b1e-6a0e-4c43-9b8e-2d1c4a5f7e01";

  it("makes a card mention a focusable link and keeps its data attributes", () => {
    expect(
      sanitizeRichHtml(`<p><span data-type="mention" data-kind="card" data-id="${ID}">@SAP</span></p>`),
    ).toBe(
      `<p><span data-type="mention" data-kind="card" data-id="${ID}" role="link" tabindex="0">@SAP</span></p>`,
    );
  });

  it("makes a decision mention a focusable link", () => {
    expect(
      sanitizeRichHtml(`<span data-type="mention" data-kind="decision" data-id="${ID}">ADR-1 T</span>`),
    ).toBe(
      `<span data-type="mention" data-kind="decision" data-id="${ID}" role="link" tabindex="0">ADR-1 T</span>`,
    );
  });

  it("gives a person, a restricted and a missing mention no link role, even a forged one", () => {
    const user = `<span data-type="mention" data-kind="user" data-id="${ID}" role="link" tabindex="0">@Ann</span>`;
    const restricted =
      '<span data-type="mention" data-kind="card" data-restricted="true" data-token="ab12cd34" role="link">Restricted card</span>';
    const missing = `<span data-type="mention" data-kind="card" data-id="${ID}" data-missing="true" tabindex="0">Deleted card</span>`;
    const forgedRestricted = `<span data-type="mention" data-kind="card" data-id="${ID}" data-restricted="true">x</span>`;
    expect(sanitizeRichHtml(user)).toBe(
      `<span data-type="mention" data-kind="user" data-id="${ID}">@Ann</span>`,
    );
    expect(sanitizeRichHtml(restricted)).toBe(
      '<span data-type="mention" data-kind="card" data-restricted="true" data-token="ab12cd34">Restricted card</span>',
    );
    expect(sanitizeRichHtml(missing)).toBe(
      `<span data-type="mention" data-kind="card" data-id="${ID}" data-missing="true">Deleted card</span>`,
    );
    expect(sanitizeRichHtml(forgedRestricted)).toBe(
      `<span data-type="mention" data-kind="card" data-id="${ID}" data-restricted="true">x</span>`,
    );
  });

  it("treats only a span as a mention, whatever another element claims", () => {
    expect(sanitizeRichHtml(`<p data-type="mention" data-kind="card" data-id="${ID}">x</p>`)).toBe(
      `<p data-type="mention" data-kind="card" data-id="${ID}">x</p>`,
    );
    expect(
      sanitizeRichHtml(
        `<a data-type="mention" data-kind="card" data-id="${ID}" href="https://example.com/a">x</a>`,
      ),
    ).toBe(
      `<a data-type="mention" data-kind="card" data-id="${ID}" href="https://example.com/a" target="_blank" rel="noopener noreferrer">x</a>`,
    );
  });

  it("does not touch the role of other spans, nor a mention with no kind", () => {
    expect(sanitizeRichHtml('<span role="note">n</span>')).toBe('<span role="note">n</span>');
    expect(sanitizeRichHtml(`<span data-type="mention" data-id="${ID}" role="link">x</span>`)).toBe(
      `<span data-type="mention" data-id="${ID}">x</span>`,
    );
  });
});

describe("sanitizeRichHtml — document pictures", () => {
  const ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  const ADR = `/api/v1/document-images/adr/${ID}`;
  const SOAW = `/api/v1/document-images/soaw/${ID}`;

  it("keeps a stored picture of either kind byte for byte", () => {
    const stored = `<img src="${ADR}" alt="Diagram" title="Flow" width="320" height="200" data-align="center">`;
    expect(sanitizeRichHtml(stored)).toBe(stored);
    expect(sanitizeRichHtml(`<img src="${SOAW}" data-align="right">`)).toBe(
      `<img src="${SOAW}" data-align="right">`,
    );
    expect(sanitizeRichHtml(`<img src="${SOAW}">`)).toBe(`<img src="${SOAW}">`);
  });

  it("canonicalises the src: lower-case id, and the same-origin absolute form made relative", () => {
    const upper = `/api/v1/document-images/adr/${ID.toUpperCase()}`;
    expect(sanitizeRichHtml(`<img src="${upper}">`)).toBe(`<img src="${ADR}">`);
    expect(sanitizeRichHtml(`<img src="${window.location.origin}${ADR}">`)).toBe(`<img src="${ADR}">`);
  });

  it("reduces a picture to the contract attributes, in the contract order", () => {
    const messy =
      `<img data-align="right" height="90" class="x" style="border:1px solid red" ` +
      `srcset="https://evil.example/a.png 2x" loading="lazy" width="120" title="T" alt="A" ` +
      `data-track="1" onerror="alert(1)" src="${ADR}">`;
    expect(sanitizeRichHtml(messy)).toBe(
      `<img src="${ADR}" alt="A" title="T" width="120" height="90" data-align="right">`,
    );
  });

  it.each([
    ["zero", "0"],
    ["over 4000", "4001"],
    ["a decimal", "12.5"],
    ["a unit", "120px"],
    ["a negative", "-5"],
    ["empty", ""],
  ])("drops a width or height that is %s", (_label, value) => {
    expect(sanitizeRichHtml(`<img src="${ADR}" width="${value}" height="${value}">`)).toBe(
      `<img src="${ADR}">`,
    );
  });

  it("keeps the bounds 1 and 4000", () => {
    expect(sanitizeRichHtml(`<img src="${ADR}" width="1" height="4000">`)).toBe(
      `<img src="${ADR}" width="1" height="4000">`,
    );
  });

  it.each(["left", "CENTER", "middle", ""])("drops a data-align of %j", (align) => {
    expect(sanitizeRichHtml(`<img src="${ADR}" data-align="${align}">`)).toBe(`<img src="${ADR}">`);
  });

  it("keeps an empty alt (a decorative picture says so)", () => {
    expect(sanitizeRichHtml(`<img src="${ADR}" alt="">`)).toBe(`<img src="${ADR}" alt="">`);
  });

  it.each([
    ["https", `https://cdn.example.com/a.png`],
    ["http", `http://cdn.example.com/a.png`],
    ["another origin with the route", `https://evil.example${ADR}`],
    ["protocol-relative", `//evil.example${ADR}`],
    ["data:", "data:image/png;base64,iVBORw0KGgo="],
    ["blob:", `blob:${window.location.origin}/0a1b2c3d`],
    ["another relative path", "/api/v1/file-attachments/1/download"],
    ["the route with a query", `${ADR}?x=1`],
    ["another kind", `/api/v1/document-images/card/${ID}`],
    ["no src", ""],
  ])("removes a picture whose src is %s, and keeps the text around it", (_label, src) => {
    const out = sanitizeRichHtml(`<p>before</p><img src="${src}" alt="x"><p>after</p>`);
    expect(out).toBe("<p>before</p><p>after</p>");
    expect(out).not.toContain("<img");
  });

  it("removes an img with no src attribute at all", () => {
    expect(sanitizeRichHtml(`<p>a<img alt="x">b</p>`)).toBe("<p>ab</p>");
  });

  it("never adds lazy loading", () => {
    expect(sanitizeRichHtml(`<img src="${ADR}">`)).not.toContain("loading");
  });

  it("is idempotent on a picture", () => {
    const once = sanitizeRichHtml(
      `<p>x</p><img title="t" src="${window.location.origin}${ADR}" width="10" data-align="center" class="c"><img src="https://x.example/y.png">`,
    );
    expect(sanitizeRichHtml(once)).toBe(once);
    expect(once).toBe(`<p>x</p><img src="${ADR}" title="t" width="10" data-align="center">`);
  });
});

describe("sanitizeRichHtml — tags the editor never writes", () => {
  it("removes a style element and never shows its CSS as text", () => {
    expect(sanitizeRichHtml("<p>x</p><style>*{display:none}</style>")).toBe("<p>x</p>");
    expect(sanitizeRichHtml("<p>a<style>p { color: red }</style>b</p>")).toBe("<p>ab</p>");
    const out = sanitizeRichHtml("<div><style>body{background:url(https://evil.example/x)}</style>t</div>");
    expect(out).toBe("<div>t</div>");
    expect(out).not.toContain("evil");
  });

  it.each([
    ["form", '<form action="https://evil.example/s" method="post"><p>a</p></form>', "<p>a</p>"],
    ["button", '<p><button type="submit" popovertarget="x">Go</button></p>', "<p>Go</p>"],
    ["textarea", "<p><textarea>typed</textarea></p>", "<p>typed</p>"],
    ["select / option", "<p><select><option>A</option><option>B</option></select></p>", "<p>AB</p>"],
    ["optgroup", '<p><select><optgroup label="g"><option>A</option></optgroup></select></p>', "<p>A</p>"],
    ["datalist", '<p><datalist id="d"><option value="v">L</option></datalist></p>', "<p>L</p>"],
    ["dialog", "<dialog open><p>over</p></dialog>", "<p>over</p>"],
    ["marquee", "<p><marquee>news</marquee></p>", "<p>news</p>"],
    ["picture", "<picture><p>alt</p></picture>", "<p>alt</p>"],
  ])("removes a %s but keeps the words inside it", (_label, html, expected) => {
    expect(sanitizeRichHtml(html)).toBe(expected);
  });

  it.each([
    ["input", '<p>a<input type="image" src="https://evil.example/x.png" formaction="https://e.x">b</p>'],
    ["source", '<p>a<source src="https://evil.example/v.mp4">b</p>'],
    ["track", '<p>a<track src="https://evil.example/t.vtt">b</p>'],
    ["empty button", "<p>a<button></button>b</p>"],
    ["empty form", "<p>a</p><form></form><p>b</p>"],
  ])("removes an empty %s", (_label, html) => {
    const out = sanitizeRichHtml(html);
    expect(out.replace(/<\/?p>/g, "")).toBe("ab");
    expect(out).not.toContain("evil");
  });

  it.each([
    ["video", '<p>a</p><video src="https://evil.example/v.mp4" poster="https://evil.example/p.png" autoplay>fallback</video><p>b</p>'],
    ["audio", '<p>a</p><audio src="https://evil.example/a.mp3" controls>fallback</audio><p>b</p>'],
    ["template", "<p>a</p><template><p>fallback</p></template><p>b</p>"],
    ["svg", '<p>a</p><svg><image href="https://evil.example/i.png"></image><text>fallback</text></svg><p>b</p>'],
    ["math", "<p>a</p><math><mi>fallback</mi></math><p>b</p>"],
    ["map / area", '<p>a</p><map name="m"><area href="https://evil.example" alt="fallback"></map><p>b</p>'],
  ])("removes a %s with what is inside it", (_label, html) => {
    expect(sanitizeRichHtml(html)).toBe("<p>a</p><p>b</p>");
  });

  it.each([
    ["iframe", '<iframe src="https://evil.example"></iframe>'],
    ["object", '<object data="https://evil.example/x.swf"></object>'],
    ["embed", '<embed src="https://evil.example/x.swf">'],
    ["link", '<link rel="stylesheet" href="https://evil.example/x.css">'],
    ["base", '<base href="https://evil.example/">'],
    ["meta", '<meta http-equiv="refresh" content="0;url=https://evil.example">'],
  ])("still removes an %s (not in DOMPurify's defaults)", (_label, tag) => {
    expect(sanitizeRichHtml(`<p>a</p>${tag}<p>b</p>`)).toBe("<p>a</p><p>b</p>");
  });

  it("keeps the form-ish tags the policy does not list, as a pasted page may carry them", () => {
    const html =
      '<fieldset><legend>L</legend><label for="x">N</label><output>1</output>' +
      '<meter value="1">m</meter><progress value="1">p</progress></fieldset>' +
      "<details><summary>S</summary><p>d</p></details>";
    expect(sanitizeRichHtml(html)).toBe(html);
  });
});

describe("sanitizeRichHtml — attributes that take a URL or open something", () => {
  it.each([
    ["background", '<table background="https://evil.example/b.png"><tbody><tr><td background="https://evil.example/c.png">x</td></tr></tbody></table>', "<table><tbody><tr><td>x</td></tr></tbody></table>"],
    ["bgcolor", '<table bgcolor="red"><tbody><tr><td bgcolor="#f00">x</td></tr></tbody></table>', "<table><tbody><tr><td>x</td></tr></tbody></table>"],
    ["cite", '<blockquote cite="https://evil.example/q"><p>q</p></blockquote><p><q cite="https://e.x">i</q><del cite="https://e.x">d</del></p>', "<blockquote><p>q</p></blockquote><p><q>i</q><del>d</del></p>"],
    ["popover", '<div popover="auto">x</div>', "<div>x</div>"],
    ["popovertarget / popovertargetaction", '<span popovertarget="p" popovertargetaction="show">x</span>', "<span>x</span>"],
    ["command / commandfor", '<span command="show-modal" commandfor="d">x</span>', "<span>x</span>"],
    ["srcset", '<span srcset="https://evil.example/a.png 2x">x</span>', "<span>x</span>"],
    ["poster", '<span poster="https://evil.example/p.png">x</span>', "<span>x</span>"],
    ["action", '<div action="https://evil.example/s">x</div>', "<div>x</div>"],
    ["formaction", '<div formaction="https://evil.example/s">x</div>', "<div>x</div>"],
    ["usemap", '<span usemap="#m">x</span>', "<span>x</span>"],
  ])("removes %s", (_label, html, expected) => {
    expect(sanitizeRichHtml(html)).toBe(expected);
  });

  it("does not keep the editor's colwidth model attribute", () => {
    expect(
      sanitizeRichHtml('<table><tbody><tr><td colspan="1" rowspan="1" colwidth="150">x</td></tr></tbody></table>'),
    ).toBe('<table><tbody><tr><td colspan="1" rowspan="1">x</td></tr></tbody></table>');
  });
});

describe("sanitizeRichHtml — inline style", () => {
  const table = (attrs: string) =>
    `<table${attrs}><colgroup><col></colgroup><tbody><tr><td>x</td></tr></tbody></table>`;
  const col = (attrs: string) =>
    `<table><colgroup><col${attrs}></colgroup><tbody><tr><td>x</td></tr></tbody></table>`;
  const td = (attrs: string) => `<table><tbody><tr><td${attrs}>x</td></tr></tbody></table>`;
  const th = (attrs: string) => `<table><tbody><tr><th${attrs}>x</th></tr></tbody></table>`;

  it.each([
    "width: 150px",
    "min-width: 50px",
    "width: 150px;",
    "min-width: 75px;",
    "width: 0px",
    "width: 99999px",
  ])("keeps %j on a table and a col, byte for byte", (value) => {
    expect(sanitizeRichHtml(table(` style="${value}"`))).toBe(table(` style="${value}"`));
    expect(sanitizeRichHtml(col(` style="${value}"`))).toBe(col(` style="${value}"`));
  });

  it.each([
    "text-align: left",
    "text-align: center",
    "text-align: right",
    "text-align: right;",
  ])("keeps %j on a td and a th, byte for byte", (value) => {
    expect(sanitizeRichHtml(td(` style="${value}"`))).toBe(td(` style="${value}"`));
    expect(sanitizeRichHtml(th(` style="${value}"`))).toBe(th(` style="${value}"`));
  });

  it.each([
    "width: 150px; background:url(https://evil.example/x)",
    "background: url(https://evil.example/x); width: 150px",
    "width:expression(alert(1))",
    "width: 150pt",
    "width: 150%",
    "width: 150",
    "width: 100000px",
    "width: -1px",
    "width: 1.5px",
    "WIDTH: 1px",
    "Width: 1px",
    "width: 1PX",
    "width:150px",
    "width:  150px",
    "width : 150px",
    "width: 150px;;",
    "width: 150px; min-width: 50px",
    "max-width: 150px",
    "height: 150px",
    "text-align: center",
    "",
  ])("drops %j on a table and a col", (value) => {
    expect(sanitizeRichHtml(table(` style="${value}"`))).toBe(table(""));
    expect(sanitizeRichHtml(col(` style="${value}"`))).toBe(col(""));
  });

  it.each([
    "width: 150px",
    "min-width: 50px",
    "text-align: justify",
    "text-align: start",
    "TEXT-ALIGN: left",
    "text-align: LEFT",
    "text-align:left",
    "text-align: left; color: red",
    "text-align: left;;",
    "background: url(https://evil.example/x)",
    "",
  ])("drops %j on a td and a th", (value) => {
    expect(sanitizeRichHtml(td(` style="${value}"`))).toBe(td(""));
    expect(sanitizeRichHtml(th(` style="${value}"`))).toBe(th(""));
  });

  it.each(["div", "p", "span", "tr", "tbody", "colgroup", "a", "h1", "li"])(
    "drops any style on a %s, even an allowed shape",
    (tag) => {
      for (const value of ["width: 150px", "text-align: center", "color: red"]) {
        const out = sanitizeRichHtml(`<${tag} style="${value}">x</${tag}>`);
        expect(out).not.toContain("style");
      }
    },
  );

  it("drops a style on a document picture with the rest of its non-contract attributes", () => {
    const src = "/api/v1/document-images/adr/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
    expect(sanitizeRichHtml(`<img src="${src}" style="width: 150px">`)).toBe(`<img src="${src}">`);
  });

  it("checks the trimmed value: surrounding spaces and newlines are trimmed, as DOMPurify trims every attribute", () => {
    expect(sanitizeRichHtml(table(' style=" width: 150px "'))).toBe(table(' style="width: 150px"'));
    expect(sanitizeRichHtml(td(' style="\ntext-align: left\n"'))).toBe(td(' style="text-align: left"'));
  });

  it("drops a value with a newline inside it", () => {
    expect(sanitizeRichHtml(table(' style="width:\n150px"'))).toBe(table(""));
    expect(sanitizeRichHtml(td(' style="text-align: left\ncolor: red"'))).toBe(td(""));
  });
});

describe("sanitizeRichHtml — cell spans", () => {
  const td = (attrs: string) => `<table><tbody><tr><td${attrs}>x</td></tr></tbody></table>`;

  it.each(["1", "2", "9", "10", "999", "1000"])("keeps colspan and rowspan %s", (value) => {
    const html = td(` colspan="${value}" rowspan="${value}"`);
    expect(sanitizeRichHtml(html)).toBe(html);
  });

  it.each(["0", "1001", "9999", "10000", "-1", "+2", "01", "1.5", "2px", "1e2", "two", ""])(
    "drops colspan and rowspan %j",
    (value) => {
      expect(sanitizeRichHtml(td(` colspan="${value}" rowspan="${value}"`))).toBe(td(""));
    },
  );

  it("judges colspan and rowspan separately", () => {
    expect(sanitizeRichHtml(td(' colspan="2" rowspan="0"'))).toBe(td(' colspan="2"'));
    expect(sanitizeRichHtml(td(' colspan="0" rowspan="3"'))).toBe(td(' rowspan="3"'));
  });

  it("leaves other numeric attributes alone", () => {
    const html = '<ol start="0"><li>x</li></ol>';
    expect(sanitizeRichHtml(html)).toBe(html);
  });
});

describe("sanitizeRichHtml — tables as the table extension writes them", () => {
  // `@tiptap/extension-table` 3.31.0 `renderHTML`: the table carries
  // `width: {total}px` when every column has a stored width, else
  // `min-width: {total}px`; each `<col>` carries `width: {w}px` or
  // `min-width: 25px` (cellMinWidth); every cell carries colspan and rowspan,
  // `colwidth` once resized, and `text-align: …` when it has an alignment.
  const header = (cells: string[]) => `<tr>${cells.map((c) => `<th colspan="1" rowspan="1"><p>${c}</p></th>`).join("")}</tr>`;

  it("keeps a plain table byte for byte", () => {
    const html =
      '<table style="min-width: 75px"><colgroup><col style="min-width: 25px"><col style="min-width: 25px"><col style="min-width: 25px"></colgroup>' +
      `<tbody>${header(["A", "B", "C"])}` +
      '<tr><td colspan="1" rowspan="1"><p>1</p></td><td colspan="1" rowspan="1"><p></p></td><td colspan="1" rowspan="1" style="text-align: right"><p>3</p></td></tr>' +
      "</tbody></table>";
    expect(sanitizeRichHtml(html)).toBe(html);
  });

  it("keeps a resized table, less the colwidth model attribute", () => {
    const html =
      '<table style="width: 450px"><colgroup><col style="width: 150px"><col style="width: 300px"></colgroup><tbody>' +
      '<tr><th colspan="1" rowspan="1" colwidth="150"><p>A</p></th><th colspan="1" rowspan="1" colwidth="300"><p>B</p></th></tr>' +
      '<tr><td colspan="1" rowspan="1" colwidth="150" style="text-align: center"><p>1</p></td><td colspan="1" rowspan="1" colwidth="300"><p>2</p></td></tr>' +
      "</tbody></table>";
    expect(sanitizeRichHtml(html)).toBe(html.replace(/ colwidth="\d+"/g, ""));
  });

  it("keeps a partly resized table (min-width on the table, a mix of cols)", () => {
    const html =
      '<table style="min-width: 175px"><colgroup><col style="width: 150px"><col style="min-width: 25px"></colgroup><tbody>' +
      '<tr><td colspan="1" rowspan="1"><p>1</p></td><td colspan="1" rowspan="1"><p>2</p></td></tr>' +
      "</tbody></table>";
    expect(sanitizeRichHtml(html)).toBe(html);
  });

  it("keeps a merged table byte for byte, less colwidth", () => {
    const html =
      '<table style="min-width: 75px"><colgroup><col style="min-width: 25px"><col style="min-width: 25px"><col style="min-width: 25px"></colgroup><tbody>' +
      `${header(["A", "B", "C"])}` +
      '<tr><td colspan="2" rowspan="2" colwidth="100,120"><p>merged</p></td><td colspan="1" rowspan="1"><p>x</p></td></tr>' +
      '<tr><td colspan="1" rowspan="1"><p>y</p></td></tr>' +
      "</tbody></table>";
    expect(sanitizeRichHtml(html)).toBe(html.replace(' colwidth="100,120"', ""));
  });

  it("is idempotent on a table", () => {
    const once = sanitizeRichHtml(
      '<table style="width: 300px; background:red" bgcolor="red"><colgroup><col style="width: 300px"></colgroup><tbody>' +
        '<tr><td colspan="1" rowspan="1" colwidth="300" style=" text-align: left "><p>https://x.io</p></td></tr></tbody></table>',
    );
    expect(sanitizeRichHtml(once)).toBe(once);
    expect(once).toBe(
      '<table><colgroup><col style="width: 300px"></colgroup><tbody><tr><td colspan="1" rowspan="1" style="text-align: left">' +
        '<p><a href="https://x.io" target="_blank" rel="noopener noreferrer">https://x.io</a></p></td></tr></tbody></table>',
    );
  });
});

describe("sanitizeRichHtml — the editor's real table markup", () => {
  // The strings `RichTextEditor.test.tsx` pins as the editor's `getHTML()`:
  // every inline style ends in `;`.
  it.each(PINNED_TABLES)("keeps %s, less colwidth only, and is idempotent", (_name, html) => {
    const once = sanitizeRichHtml(html);
    expect(once).toBe(html.replace(/ colwidth="[\d,]+"/g, ""));
    expect(sanitizeRichHtml(once)).toBe(once);
  });

  it("keeps the trailing-semicolon widths and the spans, and drops every colwidth", () => {
    const out = PINNED_TABLES.map(([, html]) => sanitizeRichHtml(html)).join("");
    expect(out).toContain('<table style="width: 350px;"><colgroup><col style="width: 150px;"><col style="width: 200px;">');
    expect(out).toContain('<table style="min-width: 75px;">');
    expect(out).toContain('<td colspan="2" rowspan="1"><p></p></td>');
    expect(out).not.toContain("colwidth");
  });
});

describe("sanitizeRichHtml — a print body", () => {
  it("keeps every class and every element a generated print body uses", () => {
    const body =
      documentHeader("Decision", "Use <SAP>") +
      metaTable([["Status", "Draft"]]) +
      section("Context", documentContent("<p>See <strong>this</strong></p>")) +
      tableHtml(["H"], [["v"]]) +
      textBlock("a\nb") +
      signatureBlock(
        [{ user_id: "u", display_name: "Ann", email: "a@x.io", status: "signed", signed_at: "2026-01-01T00:00:00Z" }],
        { title: "Signatures", fullySigned: "Fully", approved: "OK", pending: "Wait", signed: (d) => `Signed ${d}` },
        (iso) => iso,
      );
    // The parser's own normalisation (an implied tbody, `&#10003;` as ✓) is
    // all that changes: nothing is removed.
    const parsed = document.createElement("div");
    parsed.innerHTML = body;
    expect(sanitizeRichHtml(body)).toBe(parsed.innerHTML);
    const printed = buildPrintHtml({ title: "T", bodyHtml: body });
    expect(printed).toContain(`<body class="doc-print">${parsed.innerHTML}</body>`);
    expect(body).toContain('<h1 class="doc-title">');
    expect(body).toContain('<p class="doc-subtitle">');
  });
});
