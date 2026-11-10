/**
 * Mount smoke test for the SoAW / ADR rich-text editor.
 *
 * Every toolbar button drives TipTap through a command that **StarterKit**
 * supplies — `toggleUnderline` included, which comes from StarterKit's own
 * bundled underline extension (`package.json` does not declare it). That makes the toolbar a hostage to whatever StarterKit
 * happens to bundle: when an upgrade drops or renames a command,
 * `editor.chain().focus().toggleX` is `undefined` and the button throws the
 * moment somebody clicks it. Nothing else in the suite mounts this component,
 * so a TipTap bump could otherwise reach production on a green build.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import RichTextEditor from "./RichTextEditor";
import { api } from "@/api/client";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn().mockResolvedValue([]) },
}));

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

  it("renders a stored link as a new-tab anchor", async () => {
    const { container } = render(
      <RichTextEditor content='<p>see <a href="https://x.io">x</a></p>' onChange={() => {}} />,
    );
    await screen.findByText("x");
    const a = container.querySelector(".tiptap a");
    expect(a).toHaveAttribute("href", "https://x.io");
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("refuses a javascript: link", async () => {
    const { container } = render(
      <RichTextEditor content='<p><a href="javascript:alert(1)">x</a></p>' onChange={() => {}} />,
    );
    await screen.findByText("x");
    expect(container.querySelector('.tiptap a[href^="javascript"]')).toBeNull();
  });

  it("turns a pasted address into a link", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(<RichTextEditor content="<p></p>" onChange={onChange} />);
    const editable = container.querySelector(".tiptap") as HTMLElement;
    // Focus rather than click: ProseMirror's mousedown handler calls
    // `document.elementFromPoint`, which jsdom does not implement.
    editable.focus();
    await user.paste("https://x.io/doc");
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)?.[0]).toContain('<a target="_blank" rel="noopener noreferrer" href="https://x.io/doc"');
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

// ---------------------------------------------------------------------------
// Mentions and the comment variant
// ---------------------------------------------------------------------------

/**
 * TipTap keeps its editor on the editable element ("for tests"). Typing "@"
 * through user-event does not work in jsdom (no selection ranges on a
 * contenteditable), so text goes in through editor commands, keys through
 * `fireEvent.keyDown` on the view (what ProseMirror listens to). Layout calls
 * on the way (`coordsAtPos` for the popup anchor) hit the Range stubs above.
 */
function editorOf(container: HTMLElement): Editor {
  return (container.querySelector(".tiptap") as HTMLElement & { editor: Editor }).editor;
}

const CARD_ID = "0b0e5b1e-6a0e-4c43-9b8e-2d1c4a5f7e01";
const DECISION_ID = "1c1f6c2f-7b1f-4d54-8c9f-3e2d5b6a8f02";

/**
 * What the editor reports for a loaded document: TipTap's `setEditable` on
 * mount emits an update, so `onChange` carries what `renderHTML` writes
 * without any edit (and Save would send it).
 */
async function serialised(content: string): Promise<string> {
  const onChange = vi.fn();
  render(<RichTextEditor content={content} onChange={onChange} mentions={["card", "decision"]} />);
  await waitFor(() => expect(onChange).toHaveBeenCalled());
  return onChange.mock.calls.at(-1)?.[0] as string;
}

describe("RichTextEditor mentions", () => {
  it("writes a labelled card mention back in canonical order with its label as text", async () => {
    const html = await serialised(
      `<p>see <span data-id="${CARD_ID}" data-type="mention" data-kind="card">@SAP ERP</span></p>`,
    );
    expect(html).toBe(
      `<p>see <span data-type="mention" data-kind="card" data-id="${CARD_ID}">@SAP ERP</span></p>`,
    );
  });

  it("keeps a decision label as the server wrote it and the archived flag", async () => {
    const html = await serialised(
      `<p><span data-type="mention" data-kind="decision" data-id="${DECISION_ID}">ADR-012 · Rev 2 Pick a CRM</span> ` +
        `<span data-type="mention" data-kind="card" data-id="${CARD_ID}" data-archived="true">@Old CRM</span></p>`,
    );
    expect(html).toBe(
      `<p><span data-type="mention" data-kind="decision" data-id="${DECISION_ID}">ADR-012 · Rev 2 Pick a CRM</span> ` +
        `<span data-type="mention" data-kind="card" data-id="${CARD_ID}" data-archived="true">@Old CRM</span></p>`,
    );
  });

  it("sends a restricted mention back byte for byte, token and no id", async () => {
    const restricted =
      '<p>a <span data-type="mention" data-kind="card" data-restricted="true" data-token="ab12cd34"></span> b</p>';
    const html = await serialised(restricted);
    expect(html).toBe(restricted);
  });

  it("keeps a missing mention empty and flagged", async () => {
    const missing = `<p><span data-type="mention" data-kind="card" data-id="${CARD_ID}" data-missing="true"></span></p>`;
    const html = await serialised(missing);
    expect(html).toBe(missing);
  });

  it("shows the reader's words on restricted and missing chips", async () => {
    const { container } = render(
      <RichTextEditor
        content={
          '<p><span data-type="mention" data-kind="card" data-restricted="true" data-token="ab12cd34"></span>' +
          ` <span data-type="mention" data-kind="decision" data-id="${DECISION_ID}" data-missing="true"></span></p>`
        }
        onChange={() => {}}
        mentions={["card", "decision"]}
      />,
    );
    expect(await screen.findByText("Restricted card")).toBeInTheDocument();
    expect(screen.getByText("Deleted decision")).toBeInTheDocument();
    // The chip carries the stored span's attributes, so the shared chip look applies.
    expect(container.querySelector('.tiptap span[data-restricted="true"]')).toHaveTextContent(
      "Restricted card",
    );
  });

  it("makes a card chip a link in a read-only editor, and only there", async () => {
    const doc = `<p><span data-type="mention" data-kind="card" data-id="${CARD_ID}">@SAP ERP</span></p>`;
    const page = (readOnly: boolean) => (
      <MemoryRouter initialEntries={["/doc"]}>
        <Routes>
          <Route
            path="/doc"
            element={
              <RichTextEditor content={doc} onChange={() => {}} mentions={["card"]} readOnly={readOnly} />
            }
          />
          <Route path="/cards/:id" element={<div data-testid="card-page" />} />
        </Routes>
      </MemoryRouter>
    );
    const { unmount } = render(page(false));
    const editable = await screen.findByRole("link", { name: "@SAP ERP" });
    await userEvent.click(editable);
    expect(screen.queryByTestId("card-page")).toBeNull();
    unmount();

    const second = render(page(true));
    const chip = await screen.findByRole("link", { name: "@SAP ERP" });
    expect(chip).toHaveAttribute("data-kind", "card");
    await userEvent.click(chip);
    expect(screen.getByTestId("card-page")).toBeInTheDocument();
    second.unmount();

    // Keyboard: Enter follows the chip, another key does not.
    render(page(true));
    const focused = await screen.findByRole("link", { name: "@SAP ERP" });
    fireEvent.keyDown(focused, { key: "a" });
    expect(screen.queryByTestId("card-page")).toBeNull();
    fireEvent.keyDown(focused, { key: "Enter" });
    expect(await screen.findByTestId("card-page")).toBeInTheDocument();
  });

  it("parses mention spans as plain text when mentions are off (other editors unchanged)", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <RichTextEditor
        content={`<p><span data-type="mention" data-kind="card" data-id="${CARD_ID}">@SAP ERP</span></p>`}
        onChange={onChange}
      />,
    );
    await screen.findByText("@SAP ERP");
    await user.click(screen.getByText("horizontal_rule").closest("button")!);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)?.[0]).toContain("<p>@SAP ERP</p>");
  });

  it("opens the popup on '@' after a space and inserts the picked card", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.startsWith("/cards?")) {
        return { items: [{ id: CARD_ID, name: "SAP ERP", type: "Application" }], total: 1 };
      }
      return [];
    });
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(
      <RichTextEditor content="<p>see</p>" onChange={onChange} mentions={["card"]} />,
    );
    await screen.findByText("see");
    const editor = editorOf(container);
    act(() => {
      editor.chain().focus("end").insertContent(" @").run();
    });
    const option = await screen.findByRole("option", { name: /SAP ERP/ });
    expect(screen.getByRole("listbox")).toHaveAttribute("aria-activedescendant", option.id);
    fireEvent.keyDown(editor.view.dom, { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    expect(onChange.mock.calls.at(-1)?.[0]).toBe(
      `<p>see <span data-type="mention" data-kind="card" data-id="${CARD_ID}">@SAP ERP</span> </p>`,
    );
  });

  it("does not open the popup inside an e-mail address", async () => {
    const { container } = render(
      <RichTextEditor content="<p>mail</p>" onChange={() => {}} mentions={["card"]} />,
    );
    await screen.findByText("mail");
    act(() => {
      editorOf(container).chain().focus("end").insertContent(" a@b").run();
    });
    await screen.findByText("mail a@b");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

describe("RichTextEditor comment variant", () => {
  it("drops the toolbar items the comment grammar does not allow", async () => {
    render(<RichTextEditor content="<p>c</p>" onChange={() => {}} variant="comment" />);
    await screen.findByText("c");
    expect(screen.queryByText("title")).not.toBeInTheDocument();
    expect(screen.queryByText("horizontal_rule")).not.toBeInTheDocument();
    expect(screen.queryByText("format_underlined")).not.toBeInTheDocument();
    expect(screen.getByText("format_quote")).toBeInTheDocument();
    expect(screen.getByText("format_bold")).toBeInTheDocument();
  });

  it("submits on Ctrl+Enter without inserting a line break", async () => {
    const onSubmit = vi.fn();
    const onChange = vi.fn();
    const { container } = render(
      <RichTextEditor content="<p>c</p>" onChange={onChange} variant="comment" onSubmit={onSubmit} />,
    );
    await screen.findByText("c");
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const before = onChange.mock.calls.length;
    fireEvent.keyDown(editorOf(container).view.dom, { key: "Enter", ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    // No edit at all: the key is not also a line break.
    expect(onChange).toHaveBeenCalledTimes(before);
    expect(container.querySelector(".tiptap br")).toBeNull();
  });

  it("leaves Ctrl+Enter inert while the mention popup is open", async () => {
    const onSubmit = vi.fn();
    const onChange = vi.fn();
    const { container } = render(
      <RichTextEditor
        content="<p>c</p>"
        onChange={onChange}
        variant="comment"
        onSubmit={onSubmit}
        mentions={["user"]}
      />,
    );
    await screen.findByText("c");
    const editor = editorOf(container);
    act(() => {
      editor.chain().focus("end").insertContent(" @").run();
    });
    await screen.findByRole("listbox");
    const html = editor.getHTML();
    fireEvent.keyDown(editor.view.dom, { key: "Enter", ctrlKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(editor.getHTML()).toBe(html);
  });

  it("keeps Ctrl+Enter a line break in a document", async () => {
    const onSubmit = vi.fn();
    const onChange = vi.fn();
    const { container } = render(
      <RichTextEditor content="<p>c</p>" onChange={onChange} onSubmit={onSubmit} />,
    );
    await screen.findByText("c");
    fireEvent.keyDown(editorOf(container).view.dom, { key: "Enter", ctrlKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toBe("<p><br>c</p>"));
  });
});
