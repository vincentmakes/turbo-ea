/**
 * Mount smoke test for the SoAW / ADR rich-text editor.
 *
 * Every toolbar button drives TipTap through a command that **StarterKit**
 * supplies — `toggleUnderline` included, which comes from StarterKit and not
 * from the `@tiptap/extension-underline` package `package.json` also declares
 * but never imports. That makes the toolbar a hostage to whatever StarterKit
 * happens to bundle: when an upgrade drops or renames a command,
 * `editor.chain().focus().toggleX` is `undefined` and the button throws the
 * moment somebody clicks it. Nothing else in the suite mounts this component,
 * so a TipTap bump could otherwise reach production on a green build.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RichTextEditor from "./RichTextEditor";

// jsdom ships Range but none of its *layout* methods, and ProseMirror calls
// `getClientRects()` on the selection after every dispatch to decide whether to
// scroll it into view. Unshimmed, each command raises an unhandled TypeError
// that fails the run even though every assertion passes — the same class of
// jsdom gap the AG Grid scrollbar probe closes in `src/test/setup.ts`. It lives
// here rather than in the global setup because this is the only file that
// mounts ProseMirror. Zero rects is the honest answer: nothing has layout.
beforeAll(() => {
  const empty = Object.assign([], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getClientRects ??= () => empty;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});

// Buttons are found by their icon ligature (MaterialSymbol renders it as the
// span's text), NOT by accessible name: MUI's Tooltip copies its title onto
// `aria-label`, so the accessible name is the *translated* label and querying
// by it would silently break on any wording change — and, worse, would make a
// `queryBy(...)` absence assertion pass vacuously.
const TOOLBAR_ICONS = [
  "format_bold",
  "format_italic",
  "format_underlined",
  "format_strikethrough",
  "title",
  "format_list_bulleted",
  "format_list_numbered",
  "format_quote",
  "horizontal_rule",
  "undo",
  "redo",
];

describe("RichTextEditor", () => {
  it("renders the content it is given", async () => {
    render(<RichTextEditor content="<p>Existing prose</p>" onChange={() => {}} />);
    expect(await screen.findByText("Existing prose")).toBeInTheDocument();
  });

  it("keeps every toolbar command StarterKit is expected to provide", async () => {
    const user = userEvent.setup();
    render(<RichTextEditor content="<p>Existing prose</p>" onChange={() => {}} />);
    await screen.findByText("Existing prose");

    // A command dropped by an upgrade makes `.toggleX` undefined, so the click
    // raises a TypeError instead of quietly doing nothing.
    for (const icon of TOOLBAR_ICONS) {
      const button = screen.getByText(icon).closest("button");
      expect(button, `no toolbar button for ${icon}`).not.toBeNull();
      await user.click(button!);
    }
  });

  it("actually edits the document through the chain", async () => {
    // Proves the commands run rather than merely existing: a horizontal rule
    // mutates the doc whatever the selection is, so onChange has to fire.
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RichTextEditor content="<p>Existing prose</p>" onChange={onChange} />);
    await screen.findByText("Existing prose");

    await user.click(screen.getByText("horizontal_rule").closest("button")!);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)?.[0]).toContain("<hr>");
  });

  it("drops the toolbar when read-only", async () => {
    const { unmount } = render(
      <RichTextEditor content="<p>Existing prose</p>" onChange={() => {}} />,
    );
    await screen.findByText("Existing prose");
    // Proves the absence assertion below is not vacuous: the icon IS found
    // when the toolbar renders.
    expect(screen.getByText("format_bold")).toBeInTheDocument();
    unmount();

    render(<RichTextEditor content="<p>Existing prose</p>" onChange={() => {}} readOnly />);
    await screen.findByText("Existing prose");
    expect(screen.queryByText("format_bold")).not.toBeInTheDocument();
  });
});
