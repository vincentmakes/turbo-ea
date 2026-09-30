import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPrintHtml,
  chipRow,
  escapeHtml,
  htmlIsEmpty,
  metaTable,
  openPrintWindow,
  printDocument,
  section,
  signatureGrid,
  tableHtml,
  textBlock,
  writePrintDocument,
} from "./printDocument";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("printDocument fragment builders", () => {
  it("escapeHtml escapes the five reserved characters", () => {
    expect(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;",
    );
  });

  it("htmlIsEmpty treats blank markup as empty", () => {
    expect(htmlIsEmpty(null)).toBe(true);
    expect(htmlIsEmpty("<p>  </p>")).toBe(true);
    expect(htmlIsEmpty("<p>x</p>")).toBe(false);
  });

  it("metaTable skips empty values and renders nothing when every value is empty", () => {
    expect(metaTable([["A", ""], ["B", null], ["C", undefined]])).toBe("");
    const html = metaTable([["Owner", "Ada <Lovelace>"], ["Empty", "  "]]);
    expect(html).toContain('<td class="meta-label">Owner</td>');
    expect(html).toContain("Ada &lt;Lovelace&gt;");
    expect(html).not.toContain("Empty");
  });

  it("tableHtml renders nothing without rows and escapes cells", () => {
    expect(tableHtml(["A"], [])).toBe("");
    const html = tableHtml(["Name"], [["<b>x</b>"]]);
    expect(html).toContain("<th>Name</th>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("section, textBlock and chipRow drop blank content", () => {
    expect(section("T", "")).toBe("");
    expect(section("T", "<p>x</p>")).toBe("<h2>T</h2><p>x</p>");
    expect(textBlock("  ")).toBe("");
    expect(textBlock("a\nb")).toBe('<p class="pre">a\nb</p>');
    expect(chipRow([null, "", "Open"])).toContain('<span class="doc-chip">Open</span>');
    expect(chipRow([null])).toBe("");
  });

  it("signatureGrid renders one card per signatory with the right state", () => {
    const html = signatureGrid(
      [
        { user_id: "1", display_name: "Ada", email: "ada@x", status: "signed", signed_at: "2026-06-01T10:00:00Z" },
        { user_id: "2", display_name: "Bob", status: "pending", signed_at: null },
      ],
      { approved: "Approved", pending: "Pending", signed: (d) => `Signed: ${d}` },
      (iso) => `@${iso}`,
    );
    expect(html).toContain('sig-card approved');
    expect(html).toContain('sig-card pending');
    expect(html).toContain("Signed: @2026-06-01T10:00:00Z");
    expect(html).toContain("ada@x");
    expect(signatureGrid([], { approved: "", pending: "", signed: () => "" }, (s) => s)).toBe("");
  });
});

describe("buildPrintHtml", () => {
  it("wraps the body in a full document with title, stylesheet, class and footer", () => {
    const html = buildPrintHtml({
      title: `R-1 <script>`,
      bodyHtml: `<h1>Hi</h1><table class="x" style="width:100%"><tr><td>c</td></tr></table>`,
      footerParts: ["Printed: today", "", "Approved by: Ada"],
    });
    expect(html).toMatch(/^<!DOCTYPE html><html lang="en" dir="ltr">/);
    expect(html).toContain("<title>R-1 &lt;script&gt;</title>");
    expect(html).toContain("@page { size: A4 portrait");
    expect(html).toContain('<body class="doc-print">');
    expect(html).toContain('class="x" style="width:100%"');
    expect(html).toContain('<div class="doc-print-footer">Printed: today  &middot;  Approved by: Ada</div>');
  });

  it("sanitises the body so stored rich text cannot carry a script into the pop-up", () => {
    const html = buildPrintHtml({
      title: "t",
      bodyHtml: `<p onclick="x()">ok</p><script>alert(1)</script><img src=x onerror=alert(1)>`,
    });
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("onclick");
    expect(html).toContain("<p>ok</p>");
    expect(html).not.toContain('<div class="doc-print-footer">');
  });

  it("honours a custom body class and stylesheet (the SoAW path)", () => {
    const html = buildPrintHtml({ title: "t", bodyHtml: "<p>x</p>", bodyClass: "soaw-preview", css: ".k{}" });
    expect(html).toContain('<body class="soaw-preview">');
    expect(html).toContain("<style>.k{}</style>");
  });
});

describe("pop-up window handling", () => {
  function fakeWindow() {
    return {
      document: { write: vi.fn(), close: vi.fn() },
      print: vi.fn(),
      close: vi.fn(),
    } as unknown as Window;
  }

  it("openPrintWindow alerts and returns null when the pop-up is blocked", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    expect(openPrintWindow()).toBeNull();
    expect(alertSpy).toHaveBeenCalledWith("Please allow pop-ups to export PDF.");
  });

  it("writePrintDocument writes once, closes the stream and prints after the delay", () => {
    vi.useFakeTimers();
    const win = fakeWindow();
    writePrintDocument(win, { title: "t", bodyHtml: "<p>x</p>" });
    expect(win.document.write).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(win.document.write).mock.calls[0][0])).toContain("<p>x</p>");
    expect(win.document.close).toHaveBeenCalledTimes(1);
    expect(win.print).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(win.print).toHaveBeenCalledTimes(1);
  });

  it("printDocument opens a blank window and fills it", () => {
    vi.useFakeTimers();
    const win = fakeWindow();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(win);
    printDocument({ title: "t", bodyHtml: "<p>y</p>", printDelayMs: 10 });
    expect(openSpy).toHaveBeenCalledWith("", "_blank");
    expect(win.document.write).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10);
    expect(win.print).toHaveBeenCalledTimes(1);
  });
});
