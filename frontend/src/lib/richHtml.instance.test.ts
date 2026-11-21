/**
 * `./richHtml` is imported statically, once, and never re-evaluated inside a
 * test: a module body evaluated during a test makes its policy constants count
 * as covered by that test alone under mutation testing, so every mutant of the
 * sanitiser policy would be run against this test only.
 */
import createDOMPurify from "dompurify";
import { expect, it, vi } from "vitest";

import { sanitizeRichHtml } from "./richHtml";

vi.mock("dompurify", async (importOriginal) => {
  const actual = await importOriginal<typeof import("dompurify")>();
  return { default: vi.fn((w: Window) => actual.default(w)) };
});

it("sanitizeRichHtml builds its private sanitiser once, so the hook is added once", () => {
  expect(sanitizeRichHtml('<p onclick="x()">one</p><script>bad()</script>')).toBe("<p>one</p>");
  expect(sanitizeRichHtml('<p><a href="https://x.io">two</a><img src=x onerror=bad()></p>')).toBe(
    '<p><a href="https://x.io" target="_blank" rel="noopener noreferrer">two</a></p>',
  );
  expect(vi.mocked(createDOMPurify)).toHaveBeenCalledTimes(1);
});
