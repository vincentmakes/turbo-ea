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
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import RichTextEditor from "./RichTextEditor";
import { plainListTags } from "./collab/discussionModel";
import { api } from "@/api/client";
import { invalidateDecisionOptions } from "@/components/DecisionPicker";

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

  it("takes the focus on each new focus request, and not without one", async () => {
    const { container, rerender } = render(
      <RichTextEditor variant="comment" content="<p>Half</p>" onChange={() => {}} />,
    );
    await screen.findByText("Half");
    const editable = container.querySelector(".tiptap") as HTMLElement;
    expect(editable).not.toHaveFocus();
    rerender(<RichTextEditor variant="comment" content="<p>Half</p>" onChange={() => {}} focusRequest={0} />);
    expect(editable).not.toHaveFocus();
    rerender(<RichTextEditor variant="comment" content="<p>Half</p>" onChange={() => {}} focusRequest={1} />);
    await waitFor(() => expect(editable).toHaveFocus());
    editable.blur();
    expect(editable).not.toHaveFocus();
    rerender(<RichTextEditor variant="comment" content="<p>Half</p>" onChange={() => {}} focusRequest={2} />);
    await waitFor(() => expect(editable).toHaveFocus());
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
 * What the editor writes for a loaded document (what the first edit sends):
 * `renderHTML` of every node. Mounting itself emits nothing.
 */
async function serialised(content: string): Promise<string> {
  const onChange = vi.fn();
  const { container } = render(
    <RichTextEditor content={content} onChange={onChange} mentions={["card", "decision"]} />,
  );
  await waitFor(() => expect(container.querySelector(".tiptap")).not.toBeNull());
  expect(onChange).not.toHaveBeenCalled();
  return editorOf(container).getHTML();
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
    // Editable: plain text to the keyboard (no link, no tab stop), and a
    // click only places the caret.
    const editable = await screen.findByText("@SAP ERP");
    expect(screen.queryByRole("link")).toBeNull();
    expect(editable).not.toHaveAttribute("tabindex");
    expect(editable).toHaveAttribute("data-kind", "card");
    await userEvent.click(editable);
    expect(screen.queryByTestId("card-page")).toBeNull();
    unmount();

    const second = render(page(true));
    const chip = await screen.findByRole("link", { name: "@SAP ERP" });
    expect(chip).toHaveAttribute("data-kind", "card");
    expect(chip).toHaveAttribute("tabindex", "0");
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
    fireEvent.keyDown(editorOf(container).view.dom, { key: "Enter", ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    // No edit at all: the key is not also a line break.
    expect(onChange).not.toHaveBeenCalled();
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

describe("RichTextEditor without edits", () => {
  it("emits nothing on mount or when it turns read-only and back", async () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<RichTextEditor content="" onChange={onChange} />);
    await waitFor(() => expect(container.querySelector(".tiptap")).not.toBeNull());
    const editor = editorOf(container);
    expect(editor.isEditable).toBe(true);
    rerender(<RichTextEditor content="" onChange={onChange} readOnly />);
    await waitFor(() => expect(editor.isEditable).toBe(false));
    rerender(<RichTextEditor content="" onChange={onChange} />);
    await waitFor(() => expect(editor.isEditable).toBe(true));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("turns a chip into a link when the editor turns read-only, and back", async () => {
    const doc = `<p><span data-type="mention" data-kind="card" data-id="${CARD_ID}">@SAP ERP</span></p>`;
    const page = (readOnly: boolean) => (
      <MemoryRouter>
        <RichTextEditor content={doc} onChange={() => {}} mentions={["card"]} readOnly={readOnly} />
      </MemoryRouter>
    );
    const { rerender } = render(page(false));
    await screen.findByText("@SAP ERP");
    expect(screen.queryByRole("link")).toBeNull();
    rerender(page(true));
    expect(await screen.findByRole("link", { name: "@SAP ERP" })).toHaveAttribute("tabindex", "0");
    rerender(page(false));
    await waitFor(() => expect(screen.queryByRole("link")).toBeNull());
    expect(screen.getByText("@SAP ERP")).not.toHaveAttribute("tabindex");
  });
});

describe("RichTextEditor comment lists", () => {
  it("strips start and type from every ordered list tag", () => {
    expect(plainListTags('<ol start="3"><li><p>a</p></li></ol><ol type="a"><li><p>b</p></li></ol>')).toBe(
      "<ol><li><p>a</p></li></ol><ol><li><p>b</p></li></ol>",
    );
    expect(plainListTags("<ul><li><p>a</p></li></ul><p>old</p>")).toBe("<ul><li><p>a</p></li></ul><p>old</p>");
  });

  it("writes a numbered list not starting at 1, or a lettered one, as a plain numbered list", async () => {
    const onChange = vi.fn();
    const { container } = render(<RichTextEditor content="<p>c</p>" onChange={onChange} variant="comment" />);
    await screen.findByText("c");
    const editor = editorOf(container);
    act(() => {
      editor.commands.setContent('<ol start="3"><li><p>third</p></li></ol><ol type="a"><li><p>x</p></li></ol>', {
        emitUpdate: true,
      });
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    // (The trailing empty paragraph is TipTap's own, after a list.)
    expect(onChange.mock.calls.at(-1)?.[0]).toBe("<ol><li><p>third</p></li></ol><ol><li><p>x</p></li></ol><p></p>");
    // The editor itself holds plain lists, so what is shown is what is sent.
    expect(editor.getHTML()).toBe("<ol><li><p>third</p></li></ol><ol><li><p>x</p></li></ol><p></p>");
  });

  it("keeps a document's list numbering", async () => {
    const onChange = vi.fn();
    const { container } = render(<RichTextEditor content="<p>c</p>" onChange={onChange} />);
    await screen.findByText("c");
    act(() => {
      editorOf(container).commands.setContent('<ol start="3"><li><p>third</p></li></ol>', { emitUpdate: true });
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)?.[0]).toBe('<ol start="3"><li><p>third</p></li></ol><p></p>');
  });
});

describe("RichTextEditor '@' popup lifetime", () => {
  const SAP = { id: CARD_ID, name: "SAP ERP", type: "Application" };
  const PORTAL = { id: DECISION_ID, name: "Customer Portal", type: "Application" };
  beforeEach(() => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.startsWith("/cards?")) {
        const search = new URLSearchParams(path.split("?")[1]).get("search")?.toLowerCase() ?? "";
        const items = [SAP, PORTAL].filter((c) => c.name.toLowerCase().includes(search));
        return { items, total: items.length };
      }
      return [];
    });
  });

  const type = (editor: Editor, text: string) =>
    act(() => {
      editor.chain().focus("end").insertContent(text).run();
    });

  it("closes when the editor loses focus", async () => {
    const { container } = render(
      <>
        <RichTextEditor content="<p>see</p>" onChange={() => {}} mentions={["card"]} />
        <input aria-label="elsewhere" />
      </>,
    );
    await screen.findByText("see");
    const editor = editorOf(container);
    type(editor, " @");
    await screen.findByRole("option", { name: /SAP ERP/ });
    act(() => {
      fireEvent.blur(editor.view.dom);
    });
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  });

  it("keeps one popup open on the page, and closes it with its editor", async () => {
    const page = (second: boolean) => (
      <>
        <RichTextEditor content="<p>one</p>" onChange={() => {}} mentions={["card"]} />
        {second && <RichTextEditor content="<p>two</p>" onChange={() => {}} mentions={["card"]} />}
      </>
    );
    const { container, rerender } = render(page(true));
    await screen.findByText("two");
    const [first, second] = Array.from(container.querySelectorAll(".tiptap")).map(
      (el) => (el as HTMLElement & { editor: Editor }).editor,
    );
    type(first, " @");
    await screen.findByRole("listbox");
    // "@" in the second editor closes the first one's popup.
    type(second, " @");
    await screen.findAllByRole("option", { name: /SAP ERP/ });
    expect(screen.getAllByRole("listbox")).toHaveLength(1);

    // The open popup goes with its editor.
    rerender(page(false));
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  });

  it("stops Escape at the popup: it closes the popup and nothing around the editor", async () => {
    const outer = vi.fn();
    const { container } = render(
      <div onKeyDown={(e) => outer(e.key)}>
        <RichTextEditor content="<p>see</p>" onChange={() => {}} mentions={["card"]} />
      </div>,
    );
    await screen.findByText("see");
    const editor = editorOf(container);
    type(editor, " @");
    await screen.findByRole("listbox");
    fireEvent.keyDown(editor.view.dom, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    expect(outer).not.toHaveBeenCalled();
    // Without a popup, Escape reaches the page as before.
    fireEvent.keyDown(editor.view.dom, { key: "Escape" });
    expect(outer).toHaveBeenCalledWith("Escape");
  });

  it("searches across a space and inserts the card in place of the whole query", async () => {
    const onChange = vi.fn();
    const { container } = render(<RichTextEditor content="<p>see</p>" onChange={onChange} mentions={["card"]} />);
    await screen.findByText("see");
    const editor = editorOf(container);
    type(editor, " @Customer Po");
    const option = await screen.findByRole("option", { name: /Customer Portal/ });
    await waitFor(() =>
      expect(screen.getAllByRole("option").filter((o) => o.dataset.testid !== "mention-browse")).toEqual([option]),
    );
    fireEvent.keyDown(editor.view.dom, { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    expect(onChange.mock.calls.at(-1)?.[0]).toBe(
      `<p>see <span data-type="mention" data-kind="card" data-id="${DECISION_ID}">@Customer Portal</span> </p>`,
    );
  });

  it("ends the search at two spaces in a row", async () => {
    const { container } = render(<RichTextEditor content="<p>see</p>" onChange={() => {}} mentions={["card"]} />);
    await screen.findByText("see");
    const editor = editorOf(container);
    type(editor, " @SAP ");
    await screen.findByRole("option", { name: /SAP ERP/ });
    type(editor, " ");
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    type(editor, "more");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("ends the search when typing goes on past a query that found nothing", async () => {
    const { container } = render(<RichTextEditor content="<p>see</p>" onChange={() => {}} mentions={["card"]} />);
    await screen.findByText("see");
    const editor = editorOf(container);
    type(editor, " @zz");
    // The search for "zz" has answered (with nothing).
    await waitFor(() =>
      expect(vi.mocked(api.get).mock.calls.some(([p]) => String(p).includes("search=zz"))).toBe(true),
    );
    await act(async () => {});
    await act(async () => {});
    expect(screen.getByText("No matches")).toBeInTheDocument();
    // Still open while nothing more is typed.
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    type(editor, " top");
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    expect(editor.getHTML()).toBe("<p>see @zz top</p>");
  });
});

describe("RichTextEditor Browse", () => {
  const ADR = {
    id: DECISION_ID,
    reference_number: "ADR-001",
    title: "Adopt Kafka",
    revision_number: 1,
    status: "draft",
  };
  const ADR2 = { ...ADR, id: CARD_ID, reference_number: "ADR-002", title: "Pick a CRM" };
  beforeEach(() => {
    invalidateDecisionOptions();
    vi.mocked(api.get).mockImplementation(async (path: string) =>
      path === "/adr?include_earlier=false" ? [ADR, ADR2] : [],
    );
  });

  const span = (id: string, text: string) =>
    `<span data-type="mention" data-kind="decision" data-id="${id}">${text}</span>`;

  it("offers the Mention button only in an editable editor with mentions", async () => {
    const { unmount } = render(<RichTextEditor content="<p>a</p>" onChange={() => {}} />);
    await screen.findByText("a");
    expect(screen.queryByText("alternate_email")).not.toBeInTheDocument();
    unmount();
    const second = render(
      <RichTextEditor content="<p>a</p>" onChange={() => {}} mentions={["decision"]} readOnly />,
    );
    await screen.findByText("a");
    expect(screen.queryByText("alternate_email")).not.toBeInTheDocument();
    second.unmount();
    render(<RichTextEditor content="<p>a</p>" onChange={() => {}} mentions={["decision"]} />);
    await screen.findByText("a");
    expect(screen.getByText("alternate_email").closest("button")).toHaveAttribute("aria-label", "Mention…");
  });

  it("inserts the picks at the caret from the toolbar, in pick order, spaced", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <RichTextEditor content="<p>see</p>" onChange={onChange} mentions={["decision"]} />,
    );
    await screen.findByText("see");
    act(() => {
      editorOf(container).commands.focus("end");
    });
    await user.click(screen.getByText("alternate_email").closest("button")!);
    const dialog = await screen.findByRole("dialog", { name: "Mention" });
    expect(screen.getByRole("button", { name: "Insert" })).toBeDisabled();
    await user.click(await screen.findByRole("checkbox", { name: "ADR-002 Pick a CRM" }));
    await user.click(screen.getByRole("checkbox", { name: "ADR-001 Adopt Kafka" }));
    await user.click(screen.getByRole("button", { name: "Insert" }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(onChange.mock.calls.at(-1)?.[0]).toBe(
      `<p>see${span(CARD_ID, "ADR-002 Pick a CRM")} ${span(DECISION_ID, "ADR-001 Adopt Kafka")} </p>`,
    );
    expect(editorOf(container).isFocused).toBe(true);
  });

  it("replaces the '@query' when opened from the popup, and Cancel leaves it as it was", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <RichTextEditor content="<p>see</p>" onChange={onChange} mentions={["decision"]} />,
    );
    await screen.findByText("see");
    const editor = editorOf(container);
    act(() => {
      editor.chain().focus("end").insertContent(" @Ado").run();
    });
    await screen.findByRole("option", { name: /ADR-001/ });
    fireEvent.keyDown(editor.view.dom, { key: "ArrowDown" });
    fireEvent.keyDown(editor.view.dom, { key: "Enter" });
    expect(await screen.findByRole("dialog", { name: "Mention" })).toBeInTheDocument();
    // The popup is closed while the dialog is open.
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    const calls = onChange.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onChange.mock.calls.length).toBe(calls);
    expect(editor.getHTML()).toBe("<p>see @Ado</p>");
    expect(editor.state.selection.from).toBe(9);

    act(() => {
      editor.chain().focus("end").insertContent(" @Ad").run();
    });
    await userEvent.click(await screen.findByTestId("mention-browse"));
    await user.click(await screen.findByRole("checkbox", { name: "ADR-001 Adopt Kafka" }));
    await user.click(screen.getByRole("button", { name: "Insert" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onChange.mock.calls.at(-1)?.[0]).toBe(`<p>see @Ado ${span(DECISION_ID, "ADR-001 Adopt Kafka")} </p>`);
  });

  const mentionButton = () => screen.getByText("alternate_email").closest("button")!;

  it("replaces the '@query' when the toolbar button is pressed while it is being typed", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <RichTextEditor content="<p>see</p>" onChange={onChange} mentions={["decision"]} />,
    );
    await screen.findByText("see");
    const editor = editorOf(container);
    act(() => {
      editor.chain().focus("end").insertContent(" @Ado").run();
    });
    await screen.findByRole("option", { name: /ADR-001/ });
    await user.click(mentionButton());
    await screen.findByRole("dialog", { name: "Mention" });
    await user.click(await screen.findByRole("checkbox", { name: "ADR-001 Adopt Kafka" }));
    await user.click(screen.getByRole("button", { name: "Insert" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onChange.mock.calls.at(-1)?.[0]).toBe(`<p>see ${span(DECISION_ID, "ADR-001 Adopt Kafka")} </p>`);
  });

  it("replaces the '@query' a blur closed, until the editor is focused again", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <RichTextEditor content="<p>see</p>" onChange={() => {}} mentions={["decision"]} />,
    );
    await screen.findByText("see");
    const editor = editorOf(container);
    act(() => {
      editor.chain().focus("end").insertContent(" @Ado").run();
    });
    await screen.findByRole("option", { name: /ADR-001/ });
    // The toolbar's own press: the editor loses focus first.
    act(() => {
      fireEvent.blur(editor.view.dom);
    });
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    await user.click(mentionButton());
    await user.click(await screen.findByRole("checkbox", { name: "ADR-001 Adopt Kafka" }));
    await user.click(screen.getByRole("button", { name: "Insert" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(editor.getHTML()).toBe(`<p>see ${span(DECISION_ID, "ADR-001 Adopt Kafka")} </p>`);

    // Blurred, then back in the editor: the toolbar inserts at the caret again.
    act(() => {
      editor.chain().focus("end").insertContent("@Ado").run();
    });
    await screen.findByRole("option", { name: /ADR-001/ });
    act(() => {
      fireEvent.blur(editor.view.dom);
    });
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    act(() => {
      fireEvent.focus(editor.view.dom);
    });
    await user.click(mentionButton());
    await user.click(await screen.findByRole("checkbox", { name: "ADR-002 Pick a CRM" }));
    await user.click(screen.getByRole("button", { name: "Insert" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(editor.getHTML()).toBe(
      `<p>see ${span(DECISION_ID, "ADR-001 Adopt Kafka")} @Ado${span(CARD_ID, "ADR-002 Pick a CRM")} </p>`,
    );
  });

  it("leaves one space after the last mention when a space already follows", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <RichTextEditor content="<p>ask and</p>" onChange={() => {}} mentions={["decision"]} />,
    );
    await screen.findByText("ask and");
    const editor = editorOf(container);
    // From the toolbar, the caret right after "ask".
    act(() => {
      editor.chain().focus().setTextSelection(4).run();
    });
    await user.click(mentionButton());
    await user.click(await screen.findByRole("checkbox", { name: "ADR-001 Adopt Kafka" }));
    await user.click(screen.getByRole("button", { name: "Insert" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(editor.getHTML()).toBe(`<p>ask${span(DECISION_ID, "ADR-001 Adopt Kafka")} and</p>`);

    // From the popup's Browse row, in place of "@Ad" typed before a space.
    act(() => {
      editor.commands.setContent("<p>ask and</p>", { emitUpdate: false });
      editor.chain().focus().setTextSelection(4).insertContent(" @Ad").run();
    });
    await screen.findByRole("option", { name: /ADR-001/ });
    await userEvent.click(screen.getByTestId("mention-browse"));
    await user.click(await screen.findByRole("checkbox", { name: "ADR-002 Pick a CRM" }));
    await user.click(screen.getByRole("button", { name: "Insert" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(editor.getHTML()).toBe(`<p>ask ${span(CARD_ID, "ADR-002 Pick a CRM")} and</p>`);
  });

  it("inserts nothing once the editor has turned read-only under the dialog", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const ui = (readOnly: boolean) => (
      <RichTextEditor content="<p>see</p>" onChange={onChange} mentions={["decision"]} readOnly={readOnly} />
    );
    const { container, rerender } = render(ui(false));
    await screen.findByText("see");
    act(() => {
      editorOf(container).commands.focus("end");
    });
    await user.click(mentionButton());
    await user.click(await screen.findByRole("checkbox", { name: "ADR-001 Adopt Kafka" }));
    rerender(ui(true));
    await user.click(screen.getByRole("button", { name: "Insert" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(editorOf(container).getHTML()).toBe("<p>see</p>");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("inserts at the caret when the text under the dialog was replaced and the '@query' is gone", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const ui = (content: string) => (
      <RichTextEditor content={content} onChange={onChange} mentions={["decision"]} />
    );
    const { container, rerender } = render(ui("<p>see the long text here</p>"));
    await screen.findByText("see the long text here");
    const editor = editorOf(container);
    act(() => {
      editor.chain().focus("end").insertContent(" @Ado").run();
    });
    await screen.findByRole("option", { name: /ADR-001/ });
    await userEvent.click(screen.getByTestId("mention-browse"));
    await user.click(await screen.findByRole("checkbox", { name: "ADR-001 Adopt Kafka" }));
    // A save reply replaces the text with a shorter one.
    rerender(ui("<p>x</p>"));
    await screen.findByText("x");
    act(() => {
      editor.commands.setTextSelection(2);
    });
    await user.click(screen.getByRole("button", { name: "Insert" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(editor.getHTML()).toBe(`<p>x${span(DECISION_ID, "ADR-001 Adopt Kafka")} </p>`);
  });

  it("passes the document's context to the popup's order", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.startsWith("/cards?ids=")) {
        return { items: [{ id: CARD_ID, name: "Zed", type: "Application" }], total: 1 };
      }
      if (path.startsWith("/cards?")) {
        return { items: [{ id: DECISION_ID, name: "Alpha", type: "Application" }], total: 1 };
      }
      return [];
    });
    const { container } = render(
      <RichTextEditor
        content="<p>see</p>"
        onChange={() => {}}
        mentions={["card"]}
        mentionContext={{ linkedCardIds: [CARD_ID] }}
      />,
    );
    await screen.findByText("see");
    act(() => {
      editorOf(container).chain().focus("end").insertContent(" @").run();
    });
    await screen.findByRole("option", { name: /Alpha/ });
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("option")
          .filter((o) => o.dataset.testid !== "mention-browse")
          .map((o) => o.textContent),
      ).toEqual(["Zed", "Alpha"]),
    );
  });
});
