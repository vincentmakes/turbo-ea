import { describe, expect, it } from "vitest";

import { richHtmlHasContent } from "./richHtmlContent";

const ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("richHtmlHasContent", () => {
  it.each([null, undefined, "", "<p></p>", "<p>   </p>", "<p><br></p>", "<ul><li> </li></ul>"])(
    "is false for blank markup %j",
    (html) => {
      expect(richHtmlHasContent(html)).toBe(false);
    },
  );

  it("is true for visible text", () => {
    expect(richHtmlHasContent("<p>x</p>")).toBe(true);
    expect(richHtmlHasContent("plain")).toBe(true);
  });

  it.each(["adr", "soaw"])("is true for a section holding only a %s picture", (kind) => {
    expect(richHtmlHasContent(`<img src="/api/v1/document-images/${kind}/${ID}">`)).toBe(true);
  });

  it("counts the same-origin absolute form of a picture", () => {
    expect(
      richHtmlHasContent(`<img src="${window.location.origin}/api/v1/document-images/adr/${ID}">`),
    ).toBe(true);
  });

  it("does not count a picture the sanitiser would remove", () => {
    expect(richHtmlHasContent('<p></p><img src="https://cdn.example.com/a.png">')).toBe(false);
    expect(richHtmlHasContent('<img src="data:image/png;base64,AAAA">')).toBe(false);
    expect(richHtmlHasContent("<img>")).toBe(false);
  });

  it("finds a picture after an external one", () => {
    expect(
      richHtmlHasContent(
        `<img src="https://x.example/a.png"><img src="/api/v1/document-images/soaw/${ID}">`,
      ),
    ).toBe(true);
  });

  it("counts a restricted or deleted mention, which the reader sees as words", () => {
    expect(
      richHtmlHasContent('<p><span data-type="mention" data-restricted="true" data-kind="card"></span></p>'),
    ).toBe(true);
    expect(
      richHtmlHasContent('<p><span data-type="mention" data-missing="true" data-kind="user"></span></p>'),
    ).toBe(true);
  });

  it("does not count an empty span that is not a labelled mention", () => {
    expect(richHtmlHasContent('<p><span data-type="mention" data-kind="card"></span></p>')).toBe(false);
    expect(richHtmlHasContent('<p><span data-restricted="true"></span></p>')).toBe(false);
    expect(richHtmlHasContent('<p><span data-type="mention" data-restricted="false"></span></p>')).toBe(
      false,
    );
  });
});
