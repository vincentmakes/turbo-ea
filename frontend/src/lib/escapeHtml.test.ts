import { describe, expect, it } from "vitest";
import { escapeHtml } from "./escapeHtml";

describe("escapeHtml", () => {
  it("escapes each of the five HTML-significant characters", () => {
    expect(escapeHtml("&")).toBe("&amp;");
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml(">")).toBe("&gt;");
    expect(escapeHtml('"')).toBe("&quot;");
    expect(escapeHtml("'")).toBe("&#39;");
  });

  it("escapes every occurrence, ampersands first so nothing is escaped twice", () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a> & <b>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt; &amp; &lt;b&gt;",
    );
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("leaves a plain string unchanged", () => {
    expect(escapeHtml("Cost by type 2026")).toBe("Cost by type 2026");
    expect(escapeHtml("")).toBe("");
  });
});
