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
import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from "vitest";
import { act, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { CellSelection, columnResizingPluginKey, tableEditingKey } from "@tiptap/pm/tables";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import RichTextEditor from "./RichTextEditor";
import { KEY_INVOCATION_MS } from "./tableContextMenu";
import { tableHandlesKey } from "./tableHandles";
import { plainListTags } from "./collab/discussionModel";
import { api } from "@/api/client";
import { invalidateDecisionOptions } from "@/components/DecisionPicker";
import { invalidateFileUploadsEnabled } from "@/hooks/useFileUploadsEnabled";
import { MAX_DOCUMENT_IMAGE_BYTES } from "@/lib/attachmentFormats";
import {
  PINNED_TABLES,
  TABLE_2X2,
  TABLE_3X3,
  TABLE_COLSPAN_HEADER,
  TABLE_MERGED,
  TABLE_MERGED_RESIZED,
  TABLE_NO_HEADER,
  TABLE_ONE_RESIZED,
  TABLE_RESIZED,
  TABLE_ROWSPAN,
} from "@/test/fixtures/tableMarkup";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn().mockResolvedValue([]), upload: vi.fn() },
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
  "code",
  "format_h3",
  "format_h4",
  "format_list_bulleted",
  "format_list_numbered",
  "format_quote",
  "code_blocks",
  "horizontal_rule",
  "image",
  "undo",
  "redo",
];

// Buttons that open a dialog: not clicked blindly with the rest (see
// "RichTextEditor links").
const DIALOG_ICONS = ["link"];

// Buttons that open a menu: not clicked blindly either (see "RichTextEditor
// tables").
const MENU_ICONS = ["table"];

// Shown only while a picture is selected (see "RichTextEditor pictures").
const ALIGN_ICONS = ["format_align_left", "format_align_center", "format_align_right"];

describe("RichTextEditor", () => {
  it("renders the content it is given", async () => {
    render(<RichTextEditor content="<p>Existing prose</p>" onChange={() => {}} />);
    expect(await screen.findByText("Existing prose")).toBeInTheDocument();
  });

  it("keeps every toolbar command StarterKit is expected to provide", async () => {
    const user = userEvent.setup();
    invalidateFileUploadsEnabled(true);
    render(<RichTextEditor content="<p>Existing prose</p>" onChange={() => {}} imageKind="adr" />);
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
    expect(screen.queryByText("format_h3")).not.toBeInTheDocument();
    expect(screen.queryByText("format_h4")).not.toBeInTheDocument();
    expect(screen.queryByText("code_blocks")).not.toBeInTheDocument();
    expect(screen.queryByText("horizontal_rule")).not.toBeInTheDocument();
    expect(screen.queryByText("table")).not.toBeInTheDocument();
    // The comment grammar keeps <a> and <code>.
    expect(screen.getByText("code")).toBeInTheDocument();
    expect(screen.getByText("link")).toBeInTheDocument();
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

// ---------------------------------------------------------------------------
// Pictures (decision and SoAW sections)
// ---------------------------------------------------------------------------

const IMG_ID = "2d2a7d3a-8c2a-4e65-9da0-4f3e6c7b9a03";
const IMG_ID2 = "3e3b8e4b-9d3b-4f76-8eb1-5a4f7d8cab04";
const ADR_IMG = `/api/v1/document-images/adr/${IMG_ID}`;
const ADR_IMG2 = `/api/v1/document-images/adr/${IMG_ID2}`;
const SOAW_IMG = `/api/v1/document-images/soaw/${IMG_ID}`;

/**
 * The exact `<img>` strings the editor emits — the server's canonical form is
 * aligned to these (src, alt, title, width, height, data-align; double
 * quotes; no self-closing slash). A load with no edit must give them back
 * byte for byte, or every load counts as an edit.
 */
const BARE = `<img src="${ADR_IMG}">`;
const SIZED = `<img src="${ADR_IMG}" width="320" height="240">`;
const CENTRED = `<img src="${ADR_IMG}" width="320" height="240" data-align="center">`;

const png = (name = "a.png", type = "image/png") => new File(["png"], name, { type });

function imageEditor(props: Partial<React.ComponentProps<typeof RichTextEditor>> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <RichTextEditor content="<p>text</p>" onChange={onChange} imageKind="adr" {...props} />,
  );
  return { ...utils, onChange };
}

async function mounted(container: HTMLElement): Promise<Editor> {
  await waitFor(() => expect(container.querySelector(".tiptap")).not.toBeNull());
  return editorOf(container);
}

/** A clipboard as ProseMirror reads it on a paste event. */
function clipboard(files: File[], html = "", text = "") {
  return {
    files,
    types: [...(html ? ["text/html"] : []), ...(text ? ["text/plain"] : []), ...(files.length ? ["Files"] : [])],
    getData: (type: string) => (type === "text/html" ? html : type === "text/plain" ? text : ""),
  };
}

describe("RichTextEditor pictures", () => {
  beforeEach(() => {
    invalidateFileUploadsEnabled(true);
    vi.mocked(api.upload).mockReset();
    vi.mocked(api.get).mockResolvedValue([]);
  });

  it.each([
    ["a bare picture", BARE],
    ["a sized picture", SIZED],
    ["a sized, centred picture", CENTRED],
    ["a right-aligned picture between paragraphs", `<p>a</p><img src="${ADR_IMG}" data-align="right"><p>b</p>`],
  ])("gives %s back byte for byte, with no edit reported", async (_label, html) => {
    const { container, onChange } = imageEditor({ content: html });
    const editor = await mounted(container);
    expect(editor.getHTML()).toBe(html);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("stores a picture loaded with an upper-case uuid under the lower-case route", async () => {
    const { container, onChange } = imageEditor({
      content: `<img src="/api/v1/document-images/adr/${IMG_ID.toUpperCase()}" width="320" height="240">`,
    });
    const editor = await mounted(container);
    // The given string differs from the editor's, so the content sync re-sets
    // it (adding TipTap's trailing paragraph); nothing is reported as an edit.
    expect(editor.getHTML()).toBe(`${SIZED}<p></p>`);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("emits a stable string for the three contract shapes", async () => {
    const { container } = imageEditor({ content: `${BARE}${SIZED}${CENTRED}` });
    const editor = await mounted(container);
    expect(editor.getHTML()).toBe(
      `<img src="${ADR_IMG}">` +
        `<img src="${ADR_IMG}" width="320" height="240">` +
        `<img src="${ADR_IMG}" width="320" height="240" data-align="center">`,
    );
  });

  it("shows a stored picture through the resize view, its alignment on the container", async () => {
    const { container } = imageEditor({ content: CENTRED });
    await mounted(container);
    const box = container.querySelector(".tiptap [data-resize-container]") as HTMLElement;
    expect(box).not.toBeNull();
    expect(box.dataset.align).toBe("center");
    const img = box.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(ADR_IMG);
    expect(img.getAttribute("data-align")).toBe("center");
    expect(img.style.width).toBe("320px");
    expect(box.querySelectorAll("[data-resize-handle]")).toHaveLength(4);
  });

  it("keeps a stored picture in a read-only editor", async () => {
    const { container } = imageEditor({ content: `<p>a</p>${SIZED}`, readOnly: true });
    const editor = await mounted(container);
    expect(editor.getHTML()).toBe(`<p>a</p>${SIZED}`);
  });

  it("reports no edit from a locked document's own upkeep", async () => {
    // A final picture makes TipTap append an empty paragraph on the next
    // transaction: the selection in a read-only editor, or the editor locking.
    const onChange = vi.fn();
    const ui = (readOnly: boolean) => (
      <RichTextEditor content={`<p>a</p>${BARE}`} onChange={onChange} imageKind="adr" readOnly={readOnly} />
    );
    const { container, rerender } = render(ui(true));
    const editor = await mounted(container);
    act(() => {
      editor.commands.setNodeSelection(3);
    });
    expect(editor.getHTML()).toBe(`<p>a</p>${BARE}<p></p>`);
    expect(onChange).not.toHaveBeenCalled();
    rerender(ui(false));
    await waitFor(() => expect(editor.isEditable).toBe(true));
    act(() => {
      editor.commands.insertContentAt(1, "x");
    });
    // Editable again, an edit is reported as before.
    expect(onChange).toHaveBeenLastCalledWith(`<p>xa</p>${BARE}<p></p>`);
  });

  it("drops a picture without a picture store (no imageKind) and in a comment", async () => {
    const first = render(<RichTextEditor content={`<p>a</p>${BARE}`} onChange={() => {}} />);
    expect((await mounted(first.container)).getHTML()).toBe("<p>a</p>");
    first.unmount();
    const second = render(
      <RichTextEditor content={`<p>a</p>${BARE}`} onChange={() => {}} variant="comment" imageKind="adr" />,
    );
    expect((await mounted(second.container)).getHTML()).toBe("<p>a</p>");
  });

  it("drops external, data: and other-kind pictures on setContent, and makes a pasted absolute copy relative", async () => {
    const { container } = imageEditor();
    const editor = await mounted(container);
    act(() => {
      editor.commands.setContent(
        '<p>a</p><img src="https://tracker.example/p.png"><img src="data:image/png;base64,AAAA">' +
          `<img src="${SOAW_IMG}"><img src="${window.location.origin}${ADR_IMG}" width="10">`,
        { emitUpdate: false },
      );
    });
    // (The trailing empty paragraph is TipTap's own, after a final block.)
    expect(editor.getHTML()).toBe(`<p>a</p><img src="${ADR_IMG}" width="10"><p></p>`);
  });

  it("drops external, data: and other-kind pictures in pasted HTML", async () => {
    const { container, onChange } = imageEditor({ content: "<p>x</p>" });
    const editor = await mounted(container);
    act(() => {
      editor.commands.focus("end");
    });
    fireEvent.paste(editor.view.dom, {
      clipboardData: clipboard(
        [],
        '<p>pasted</p><img src="https://tracker.example/p.png"><img src="data:image/png;base64,AAAA">' +
          `<img src="${SOAW_IMG}"><img src="${ADR_IMG}">`,
      ),
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const html = editor.getHTML();
    expect(html).toContain("pasted");
    expect(html.match(/<img/g)).toHaveLength(1);
    expect(html).toContain(BARE);
    expect(api.upload).not.toHaveBeenCalled();
  });

  it("uploads a pasted picture file and inserts it at the caret", async () => {
    vi.mocked(api.upload).mockResolvedValue({ id: IMG_ID, src: ADR_IMG, mime_type: "image/png", size: 3 });
    const { container, onChange } = imageEditor({ content: "<p>text</p>" });
    const editor = await mounted(container);
    act(() => {
      editor.commands.focus("end");
    });
    const file = png();
    fireEvent.paste(editor.view.dom, { clipboardData: clipboard([file]) });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(api.upload).toHaveBeenCalledWith("/document-images/adr", file, "file");
    expect(onChange.mock.calls.at(-1)?.[0]).toBe(`<p>text</p>${BARE}<p></p>`);
  });

  it("uploads to the SoAW store in a SoAW section", async () => {
    vi.mocked(api.upload).mockResolvedValue({ id: IMG_ID, src: SOAW_IMG, mime_type: "image/png", size: 3 });
    const { container, onChange } = imageEditor({ imageKind: "soaw" });
    const editor = await mounted(container);
    act(() => {
      editor.commands.focus("end");
    });
    fireEvent.paste(editor.view.dom, { clipboardData: clipboard([png()]) });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(vi.mocked(api.upload).mock.calls[0][0]).toBe("/document-images/soaw");
    expect(onChange.mock.calls.at(-1)?.[0]).toContain(`<img src="${SOAW_IMG}">`);
  });

  it("builds the src from the id when the answer's src is not this kind's route", async () => {
    vi.mocked(api.upload).mockResolvedValue({
      id: IMG_ID,
      src: "https://elsewhere.example/x.png",
      mime_type: "image/png",
      size: 3,
    });
    const { container, onChange } = imageEditor();
    const editor = await mounted(container);
    act(() => {
      editor.commands.focus("end");
    });
    fireEvent.paste(editor.view.dom, { clipboardData: clipboard([png()]) });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)?.[0]).toContain(BARE);
  });

  it("refuses an answer it cannot turn into a route", async () => {
    vi.mocked(api.upload).mockResolvedValue({ id: "nope", src: "nope", mime_type: "image/png", size: 3 });
    const { container, onChange } = imageEditor();
    const editor = await mounted(container);
    fireEvent.paste(editor.view.dom, { clipboardData: clipboard([png()]) });
    expect(await screen.findByText("The picture could not be uploaded")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("pastes clipboard HTML with text as text, not its rendered picture", async () => {
    const { container, onChange } = imageEditor({ content: "<p>x</p>" });
    const editor = await mounted(container);
    act(() => {
      editor.commands.focus("end");
    });
    fireEvent.paste(editor.view.dom, {
      clipboardData: clipboard([png()], "<table><tr><td>cell</td></tr></table>", "cell"),
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(api.upload).not.toHaveBeenCalled();
    expect(editor.getHTML()).toContain("cell");
  });

  it("uploads the file of a browser 'Copy image' (an <img> alone in the HTML)", async () => {
    vi.mocked(api.upload).mockResolvedValue({ id: IMG_ID, src: ADR_IMG, mime_type: "image/png", size: 3 });
    const { container, onChange } = imageEditor();
    const editor = await mounted(container);
    fireEvent.paste(editor.view.dom, {
      clipboardData: clipboard([png()], '<meta charset="utf-8"><img src="https://site.example/a.png">'),
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(api.upload).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls.at(-1)?.[0]).toContain(BARE);
    expect(onChange.mock.calls.at(-1)?.[0]).not.toContain("site.example");
  });

  it.each([
    ["the wrong type", png("a.svg", "image/svg+xml"), "Only PNG, JPEG, GIF or WebP pictures can be inserted"],
    [
      "a picture over 5 MB",
      Object.defineProperty(png(), "size", { value: MAX_DOCUMENT_IMAGE_BYTES + 1 }),
      "The picture is larger than 5 MB",
    ],
  ])("refuses %s with the reason and uploads nothing", async (_label, file, reason) => {
    const user = userEvent.setup();
    const { container, onChange } = imageEditor();
    const editor = await mounted(container);
    fireEvent.paste(editor.view.dom, { clipboardData: clipboard([file]) });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(reason);
    expect(api.upload).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    // Dismissible.
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("uploads the good files of a mixed paste and names the refused one", async () => {
    vi.mocked(api.upload).mockResolvedValue({ id: IMG_ID, src: ADR_IMG, mime_type: "image/png", size: 3 });
    const { container, onChange } = imageEditor();
    const editor = await mounted(container);
    fireEvent.paste(editor.view.dom, { clipboardData: clipboard([png("a.svg", "image/svg+xml"), png()]) });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(api.upload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Only PNG, JPEG, GIF or WebP pictures can be inserted");
  });

  it("shows the server's reason for a failed upload, or a generic one", async () => {
    vi.mocked(api.upload).mockRejectedValueOnce(new Error("File uploads are disabled"));
    const { container, onChange } = imageEditor();
    const editor = await mounted(container);
    fireEvent.paste(editor.view.dom, { clipboardData: clipboard([png()]) });
    expect(await screen.findByRole("alert")).toHaveTextContent("File uploads are disabled");
    vi.mocked(api.upload).mockRejectedValueOnce(new Error(""));
    fireEvent.paste(editor.view.dom, { clipboardData: clipboard([png()]) });
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("The picture could not be uploaded"),
    );
    vi.mocked(api.upload).mockRejectedValueOnce("not an error");
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
    });
    fireEvent.paste(editor.view.dom, { clipboardData: clipboard([png()]) });
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("The picture could not be uploaded"),
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(editor.getHTML()).toBe("<p>text</p>");
  });

  it("shows progress while an upload runs", async () => {
    let resolve!: (v: unknown) => void;
    vi.mocked(api.upload).mockReturnValue(new Promise((r) => (resolve = r)));
    const { container, onChange } = imageEditor();
    const editor = await mounted(container);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    fireEvent.paste(editor.view.dom, { clipboardData: clipboard([png()]) });
    expect(await screen.findByRole("progressbar", { name: "Uploading picture…" })).toBeInTheDocument();
    await act(async () => {
      resolve({ id: IMG_ID, src: ADR_IMG, mime_type: "image/png", size: 3 });
    });
    await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());
    expect(onChange).toHaveBeenCalled();
  });

  it("inserts nothing when the editor turned read-only while the upload ran", async () => {
    let resolve!: (v: unknown) => void;
    vi.mocked(api.upload).mockReturnValue(new Promise((r) => (resolve = r)));
    const onChange = vi.fn();
    const ui = (readOnly: boolean) => (
      <RichTextEditor content="<p>text</p>" onChange={onChange} imageKind="adr" readOnly={readOnly} />
    );
    const { container, rerender } = render(ui(false));
    const editor = await mounted(container);
    fireEvent.paste(editor.view.dom, { clipboardData: clipboard([png()]) });
    await waitFor(() => expect(api.upload).toHaveBeenCalled());
    rerender(ui(true));
    await waitFor(() => expect(editor.isEditable).toBe(false));
    await act(async () => {
      resolve({ id: IMG_ID, src: ADR_IMG, mime_type: "image/png", size: 3 });
    });
    await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());
    expect(editor.getHTML()).toBe("<p>text</p>");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("inserts nothing when the editor was destroyed while the upload ran", async () => {
    let resolve!: (v: unknown) => void;
    vi.mocked(api.upload).mockReturnValue(new Promise((r) => (resolve = r)));
    const { container, onChange } = imageEditor();
    const editor = await mounted(container);
    fireEvent.paste(editor.view.dom, { clipboardData: clipboard([png()]) });
    await waitFor(() => expect(api.upload).toHaveBeenCalled());
    const insert = vi.spyOn(editor, "chain");
    act(() => editor.destroy());
    await act(async () => {
      resolve({ id: IMG_ID, src: ADR_IMG, mime_type: "image/png", size: 3 });
    });
    expect(insert).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("inserts a picture chosen through the toolbar button", async () => {
    vi.mocked(api.upload)
      .mockResolvedValueOnce({ id: IMG_ID, src: ADR_IMG, mime_type: "image/png", size: 3 })
      .mockResolvedValueOnce({ id: IMG_ID2, src: ADR_IMG2, mime_type: "image/png", size: 3 });
    const user = userEvent.setup();
    const { container, onChange } = imageEditor();
    const editor = await mounted(container);
    act(() => {
      editor.commands.focus("end");
    });
    const input = screen.getByTestId("rich-text-image-input") as HTMLInputElement;
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", "image/png,image/jpeg,image/gif,image/webp");
    const click = vi.spyOn(input, "click");
    await user.click(screen.getByText("image").closest("button")!);
    expect(click).toHaveBeenCalled();
    const a = png("a.png");
    const b = png("b.png");
    fireEvent.change(input, { target: { files: [a, b] } });
    await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain(ADR_IMG2));
    // In the order chosen, one after the other.
    expect(onChange.mock.calls.at(-1)?.[0]).toBe(
      `<p>text</p><img src="${ADR_IMG}"><img src="${ADR_IMG2}"><p></p>`,
    );
    expect(vi.mocked(api.upload).mock.calls.map((c) => c[1])).toEqual([a, b]);
    expect(input.value).toBe("");
  });

  it("ignores an empty pick", async () => {
    const { container } = imageEditor();
    await mounted(container);
    fireEvent.change(screen.getByTestId("rich-text-image-input"), { target: { files: [] } });
    expect(api.upload).not.toHaveBeenCalled();
  });

  it("inserts a dropped picture where it was dropped", async () => {
    vi.mocked(api.upload).mockResolvedValue({ id: IMG_ID, src: ADR_IMG, mime_type: "image/png", size: 3 });
    const { container, onChange } = imageEditor({ content: "<p>one</p><p>two</p>" });
    const editor = await mounted(container);
    // jsdom has no layout: answer the coordinates lookup with "between the
    // two paragraphs" (position 5).
    editor.view.posAtCoords = () => ({ pos: 5, inside: -1 });
    const file = png();
    fireEvent.drop(editor.view.dom, {
      clientX: 10,
      clientY: 10,
      dataTransfer: { files: [file], types: ["Files"], getData: () => "" },
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(api.upload).toHaveBeenCalledWith("/document-images/adr", file, "file");
    expect(onChange.mock.calls.at(-1)?.[0]).toBe(`<p>one</p>${BARE}<p>two</p>`);
  });

  it("takes a drop without files as ProseMirror's own", async () => {
    const { container } = imageEditor({ content: "<p>one</p>" });
    const editor = await mounted(container);
    editor.view.posAtCoords = () => ({ pos: 1, inside: -1 });
    fireEvent.drop(editor.view.dom, {
      dataTransfer: { files: [], types: ["text/plain"], getData: (t: string) => (t === "text/plain" ? "dropped" : "") },
    });
    await waitFor(() => expect(editor.getHTML()).toContain("dropped"));
    expect(api.upload).not.toHaveBeenCalled();
  });

  it("sets and clears the alignment of the selected picture", async () => {
    const user = userEvent.setup();
    const { container, onChange } = imageEditor({ content: `<p>a</p>${SIZED}` });
    const editor = await mounted(container);
    for (const icon of ALIGN_ICONS) expect(screen.queryByText(icon)).not.toBeInTheDocument();
    act(() => {
      editor.commands.setNodeSelection(3);
    });
    const button = (icon: string) => screen.getByText(icon).closest("button")!;
    await waitFor(() => expect(screen.getByText("format_align_left")).toBeInTheDocument());
    // Left (no attribute) is the active one.
    expect(button("format_align_left")).toHaveAttribute("aria-label", "Align left");
    const active = (icon: string) => getComputedStyle(button(icon)).backgroundColor;
    const idle = active("format_align_center");
    expect(active("format_align_left")).not.toBe(idle);

    await user.click(button("format_align_center"));
    await waitFor(() =>
      expect(onChange.mock.calls.at(-1)?.[0]).toBe(
        `<p>a</p><img src="${ADR_IMG}" width="320" height="240" data-align="center"><p></p>`,
      ),
    );
    expect((container.querySelector("[data-resize-container]") as HTMLElement).dataset.align).toBe("center");
    await waitFor(() => expect(active("format_align_center")).not.toBe(active("format_align_right")));
    expect(active("format_align_left")).toBe(active("format_align_right"));

    await user.click(button("format_align_right"));
    await waitFor(() =>
      expect(onChange.mock.calls.at(-1)?.[0]).toBe(
        `<p>a</p><img src="${ADR_IMG}" width="320" height="240" data-align="right"><p></p>`,
      ),
    );
    expect((container.querySelector("[data-resize-container]") as HTMLElement).dataset.align).toBe("right");

    await user.click(button("format_align_left"));
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toBe(`<p>a</p>${SIZED}<p></p>`));
    expect((container.querySelector("[data-resize-container]") as HTMLElement).dataset.align).toBeUndefined();

    // Moving the selection off the picture hides the buttons again.
    act(() => {
      editor.commands.setTextSelection(1);
    });
    await waitFor(() => expect(screen.queryByText("format_align_left")).not.toBeInTheDocument());
  });

  describe("offers no way to insert one", () => {
    // A paste nobody handles, with no text in it, sends ProseMirror to its
    // fallback (`capturePaste`), which refocuses the view 50 ms later. Let
    // that run while the editor still exists: after unmount it throws an
    // uncaught TypeError into whichever test runs next.
    afterEach(async () => {
      await act(() => new Promise((resolve) => setTimeout(resolve, 80)));
    });

    const select = (container: HTMLElement) =>
      act(() => {
        editorOf(container).commands.setNodeSelection(3);
      });

    it("proves the controls exist when everything allows them", async () => {
      const { container } = imageEditor({ content: `<p>a</p>${BARE}` });
      await mounted(container);
      select(container);
      expect(screen.getByText("image")).toBeInTheDocument();
      expect(screen.getByTestId("rich-text-image-input")).toBeInTheDocument();
      expect(await screen.findByText("format_align_center")).toBeInTheDocument();
    });

    it.each([
      ["read-only", { readOnly: true }],
      ["on the comment variant", { variant: "comment" as const }],
      ["without imageKind", { imageKind: undefined }],
    ])("%s", async (_label, props) => {
      const { container, onChange } = imageEditor({ content: `<p>a</p>${BARE}`, ...props });
      const editor = await mounted(container);
      if (editor.getHTML().includes("<img")) select(container);
      expect(screen.queryByText("image")).not.toBeInTheDocument();
      expect(screen.queryByTestId("rich-text-image-input")).not.toBeInTheDocument();
      for (const icon of ALIGN_ICONS) expect(screen.queryByText(icon)).not.toBeInTheDocument();
      fireEvent.paste(editor.view.dom, { clipboardData: clipboard([png()]) });
      await act(async () => {});
      expect(api.upload).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
    });

    it("when file uploads are switched off", async () => {
      invalidateFileUploadsEnabled(false);
      const { container, onChange } = imageEditor({ content: `<p>a</p>${BARE}` });
      const editor = await mounted(container);
      select(container);
      expect(screen.getByText("format_bold")).toBeInTheDocument();
      expect(screen.queryByText("image")).not.toBeInTheDocument();
      expect(screen.queryByTestId("rich-text-image-input")).not.toBeInTheDocument();
      editor.view.posAtCoords = () => ({ pos: 1, inside: -1 });
      fireEvent.paste(editor.view.dom, { clipboardData: clipboard([png()]) });
      fireEvent.drop(editor.view.dom, {
        dataTransfer: { files: [png()], types: ["Files"], getData: () => "" },
      });
      await act(async () => {});
      expect(api.upload).not.toHaveBeenCalled();
      // The stored picture stays, alone (the selection added TipTap's
      // trailing paragraph, an edit of its own).
      expect(editor.getHTML()).toBe(`<p>a</p>${BARE}<p></p>`);
      expect(onChange.mock.calls.every(([html]) => html === `<p>a</p>${BARE}<p></p>`)).toBe(true);

      // Aligning is not an upload: a stored picture can still be aligned.
      const user = userEvent.setup();
      act(() => {
        editor.commands.setNodeSelection(3);
      });
      await user.click((await screen.findByText("format_align_center")).closest("button")!);
      await waitFor(() =>
        expect(onChange.mock.calls.at(-1)?.[0]).toBe(
          `<p>a</p><img src="${ADR_IMG}" data-align="center"><p></p>`,
        ),
      );
      expect(screen.getByText("format_align_right")).toBeInTheDocument();
      expect(screen.getByText("format_align_left")).toBeInTheDocument();
      expect(api.upload).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// Links, code and headings
// ---------------------------------------------------------------------------

const A = (href: string, text: string) =>
  `<a target="_blank" rel="noopener noreferrer" href="${href}">${text}</a>`;

describe("RichTextEditor links", () => {
  const linkButton = () => screen.getByText("link").closest("button")!;
  const urlField = () => screen.getByTestId("link-url") as HTMLInputElement;
  const background = (icon: string) => getComputedStyle(screen.getByText(icon).closest("button")!).backgroundColor;

  async function linkEditor(content: string, props: Partial<Parameters<typeof RichTextEditor>[0]> = {}) {
    const onChange = vi.fn();
    const utils = render(<RichTextEditor content={content} onChange={onChange} {...props} />);
    await waitFor(() => expect(utils.container.querySelector(".tiptap")).not.toBeNull());
    return { ...utils, onChange, editor: editorOf(utils.container) };
  }

  it("is a toolbar button in both variants, kept apart from the blind clicks", async () => {
    for (const icon of DIALOG_ICONS) expect(TOOLBAR_ICONS).not.toContain(icon);
    const { unmount } = await linkEditor("<p>a</p>");
    expect(linkButton()).toHaveAttribute("aria-label", "Link");
    unmount();
    await linkEditor("<p>a</p>", { variant: "comment" });
    expect(linkButton()).toHaveAttribute("aria-label", "Link");
  });

  it("links the selected text, normalising the address, and leaves the caret outside it", async () => {
    const user = userEvent.setup();
    const { editor, onChange } = await linkEditor("<p>hello world</p>");
    act(() => {
      editor.commands.setTextSelection({ from: 7, to: 12 });
    });
    await user.click(linkButton());
    const dialog = await screen.findByRole("dialog", { name: "Link" });
    expect(urlField()).toHaveValue("");
    // Text is selected: nothing to ask; no existing link: nothing to remove.
    expect(screen.queryByTestId("link-text")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove link" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open in new tab" })).not.toBeInTheDocument();
    await user.type(urlField(), "example.com");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(onChange.mock.calls.at(-1)?.[0]).toBe(`<p>hello ${A("https://example.com", "world")}</p>`);
    expect(editor.isFocused).toBe(true);
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.from).toBe(12);
    // The mark is inclusive (autolink), yet what is typed next is not linked.
    act(() => {
      editor.view.dispatch(editor.state.tr.insertText("!"));
    });
    expect(editor.getHTML()).toBe(`<p>hello ${A("https://example.com", "world")}!</p>`);
  });

  it("shows the button active while the caret is in a link, and not elsewhere", async () => {
    const { editor } = await linkEditor('<p>see <a href="https://x.io">site</a> now</p>');
    act(() => {
      editor.commands.setTextSelection(2);
    });
    await waitFor(() => expect(background("link")).toBe(background("format_bold")));
    act(() => {
      editor.commands.setTextSelection(7);
    });
    await waitFor(() => expect(background("link")).not.toBe(background("format_bold")));
  });

  it("edits the whole link under the caret, its address prefilled", async () => {
    const user = userEvent.setup();
    const { editor, onChange } = await linkEditor(
      '<p>see <a href="https://x.io">the site</a> and <a href="https://z.io">z</a></p>',
    );
    act(() => {
      editor.commands.setTextSelection(7);
    });
    await user.click(linkButton());
    await screen.findByRole("dialog", { name: "Link" });
    expect(urlField()).toHaveValue("https://x.io");
    expect(screen.queryByTestId("link-text")).not.toBeInTheDocument();
    await user.clear(urlField());
    await user.type(urlField(), "https://y.io{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // The neighbouring link is untouched.
    expect(onChange.mock.calls.at(-1)?.[0]).toBe(
      `<p>see ${A("https://y.io", "the site")} and ${A("https://z.io", "z")}</p>`,
    );
    expect(editor.state.selection.from).toBe(13);
    expect(editor.state.selection.empty).toBe(true);
  });

  it("removes the link under the caret", async () => {
    const user = userEvent.setup();
    const { editor, onChange } = await linkEditor('<p>see <a href="https://x.io">the site</a> now</p>');
    act(() => {
      editor.commands.setTextSelection(7);
    });
    await user.click(linkButton());
    await user.click(await screen.findByRole("button", { name: "Remove link" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onChange.mock.calls.at(-1)?.[0]).toBe("<p>see the site now</p>");
    expect(editor.isFocused).toBe(true);
  });

  it("inserts the text as a link at an empty caret, the address as text when none is given", async () => {
    const user = userEvent.setup();
    const { editor, onChange } = await linkEditor("<p>go</p>");
    act(() => {
      editor.commands.setTextSelection(3);
    });
    await user.click(linkButton());
    await screen.findByRole("dialog", { name: "Link" });
    await user.type(urlField(), "ann@x.io");
    await user.type(screen.getByTestId("link-text"), " Ann");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onChange.mock.calls.at(-1)?.[0]).toBe(`<p>go${A("mailto:ann@x.io", " Ann")}</p>`);
    expect(editor.state.selection.from).toBe(7);

    await user.click(linkButton());
    await screen.findByRole("dialog", { name: "Link" });
    await user.type(urlField(), "x.io{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onChange.mock.calls.at(-1)?.[0]).toBe(
      `<p>go${A("mailto:ann@x.io", " Ann")}${A("https://x.io", "https://x.io")}</p>`,
    );
    act(() => {
      editor.view.dispatch(editor.state.tr.insertText("!"));
    });
    expect(editor.getHTML()).toMatch(/https:\/\/x\.io<\/a>!<\/p>$/);
  });

  it("refuses an address it cannot store and changes nothing", async () => {
    const user = userEvent.setup();
    const { editor, onChange } = await linkEditor("<p>hello world</p>");
    act(() => {
      editor.commands.setTextSelection({ from: 7, to: 12 });
    });
    await user.click(linkButton());
    await screen.findByRole("dialog", { name: "Link" });
    await user.type(urlField(), "ftp://x.io{Enter}");
    expect(await screen.findByText(/Enter a web address/)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Link" })).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(editor.getHTML()).toBe("<p>hello world</p>");
  });

  it("gives the selection back on Cancel, the caret where it was inside a link", async () => {
    const user = userEvent.setup();
    const { editor, onChange } = await linkEditor('<p>hello world <a href="https://x.io">site</a></p>');
    act(() => {
      editor.commands.setTextSelection({ from: 7, to: 12 });
    });
    await user.click(linkButton());
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect([editor.state.selection.from, editor.state.selection.to]).toEqual([7, 12]);
    expect(editor.isFocused).toBe(true);

    act(() => {
      editor.commands.setTextSelection(15);
    });
    await user.click(linkButton());
    await screen.findByRole("dialog", { name: "Link" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Not the link's whole range, which the dialog would have edited.
    expect([editor.state.selection.from, editor.state.selection.to]).toEqual([15, 15]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("applies nothing once the editor has turned read-only under the dialog", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container, rerender } = render(<RichTextEditor content="<p>hello world</p>" onChange={onChange} />);
    await screen.findByText("hello world");
    const editor = editorOf(container);
    act(() => {
      editor.commands.setTextSelection({ from: 7, to: 12 });
    });
    await user.click(linkButton());
    await user.type(await screen.findByTestId("link-url"), "x.io");
    rerender(<RichTextEditor content="<p>hello world</p>" onChange={onChange} readOnly />);
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(editor.getHTML()).toBe("<p>hello world</p>");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("changes nothing when the saved range no longer fits the document", async () => {
    const user = userEvent.setup();
    const { editor } = await linkEditor("<p>hello world</p>");
    act(() => {
      editor.commands.setTextSelection({ from: 7, to: 12 });
    });
    await user.click(linkButton());
    await user.type(await screen.findByTestId("link-url"), "x.io");
    act(() => {
      editor.commands.setContent("<p>hi</p>");
    });
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(editor.getHTML()).toBe("<p>hi</p>");
  });

  it("loads a stored ftp:, tel: or relative anchor as plain text, and still refuses javascript:", async () => {
    const html = await serialised(
      '<p><a href="ftp://x.io">f</a> <a href="example.com">r</a> <a href="tel:+41">t</a> ' +
        '<a href="javascript:alert(1)">j</a> <a href="mailto:a@b.io">m</a> <a href="HTTP://X.IO">h</a></p>',
    );
    expect(html).toBe(`<p>f r t j ${A("mailto:a@b.io", "m")} ${A("HTTP://X.IO", "h")}</p>`);
  });

  it("never renders an href it would not store, whatever set it", async () => {
    const { editor } = await linkEditor("<p>hello</p>");
    act(() => {
      editor.chain().setTextSelection({ from: 1, to: 6 }).setLink({ href: "example.com" }).run();
    });
    expect(editor.getHTML()).toBe('<p><a target="_blank" rel="noopener noreferrer">hello</a></p>');
  });

  it("autolinks a typed www. host and a bare address, and no other scheme", async () => {
    const { editor } = await linkEditor("<p></p>");
    act(() => {
      editor.chain().focus("end").insertContent("www.x.io ").run();
    });
    expect(editor.getHTML()).toBe(`<p>${A("https://www.x.io", "www.x.io")} </p>`);
    act(() => {
      editor.chain().focus("end").insertContent("ann@x.io ").run();
    });
    expect(editor.getHTML()).toBe(`<p>${A("https://www.x.io", "www.x.io")} ${A("mailto:ann@x.io", "ann@x.io")} </p>`);
    act(() => {
      editor.commands.setContent("<p></p>");
      editor.chain().focus("end").insertContent("ftp://x.io ").run();
    });
    expect(editor.getHTML()).toBe("<p>ftp://x.io </p>");
  });

  it("links a pasted www. host with the stored attributes", async () => {
    const user = userEvent.setup();
    const { container, onChange } = await linkEditor("<p></p>");
    (container.querySelector(".tiptap") as HTMLElement).focus();
    await user.paste("www.x.io/doc");
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    // https://, as when typed (TipTap's own paste rule would give http://).
    expect(onChange.mock.calls.at(-1)?.[0]).toBe(`<p>${A("https://www.x.io/doc", "www.x.io/doc")}</p>`);
  });

  it.each([
    ["http://x.io/a", "http://x.io/a"],
    ["HTTP://X.IO", "HTTP://X.IO"],
    ["ann@x.io", "mailto:ann@x.io"],
    ["example.com", "https://example.com"],
  ])("links a pasted %s as %s", async (pasted, href) => {
    const user = userEvent.setup();
    const { container, onChange } = await linkEditor("<p></p>");
    (container.querySelector(".tiptap") as HTMLElement).focus();
    await user.paste(`see ${pasted} now`);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)?.[0]).toBe(`<p>see ${A(href, pasted)} now</p>`);
  });

  it("links the selection under a pasted bare host with the same https href", async () => {
    const user = userEvent.setup();
    const { container, editor } = await linkEditor("<p>hello world</p>");
    (container.querySelector(".tiptap") as HTMLElement).focus();
    act(() => {
      editor.commands.setTextSelection({ from: 7, to: 12 });
    });
    await user.paste("www.x.io");
    await waitFor(() => expect(editor.getHTML()).toBe(`<p>hello ${A("https://www.x.io", "world")}</p>`));
  });

  it("does not link the selection under a pasted ftp: address", async () => {
    const user = userEvent.setup();
    const { container, editor } = await linkEditor("<p>hello world</p>");
    (container.querySelector(".tiptap") as HTMLElement).focus();
    act(() => {
      editor.commands.setTextSelection({ from: 7, to: 12 });
    });
    await user.paste("ftp://x.io");
    await waitFor(() => expect(editor.getHTML()).not.toBe("<p>hello world</p>"));
    expect(editor.getHTML()).not.toContain("<a");
  });

  it("links the selection under a pasted web address", async () => {
    const user = userEvent.setup();
    const { container, editor } = await linkEditor("<p>hello world</p>");
    (container.querySelector(".tiptap") as HTMLElement).focus();
    act(() => {
      editor.commands.setTextSelection({ from: 7, to: 12 });
    });
    await user.paste("https://x.io");
    await waitFor(() => expect(editor.getHTML()).toBe(`<p>hello ${A("https://x.io", "world")}</p>`));
  });
});

describe("RichTextEditor Ctrl/Cmd+K", () => {
  it("opens the link dialog and takes the key from the page", async () => {
    const { container } = render(<RichTextEditor content="<p>a</p>" onChange={() => {}} />);
    await screen.findByText("a");
    // false: default prevented, so the app's search shortcut leaves it alone.
    expect(fireEvent.keyDown(editorOf(container).view.dom, { key: "k", ctrlKey: true })).toBe(false);
    expect(await screen.findByRole("dialog", { name: "Link" })).toBeInTheDocument();
  });

  it("is left to the page in a read-only editor, from the start or after locking", async () => {
    const { container, unmount } = render(<RichTextEditor content="<p>a</p>" onChange={() => {}} readOnly />);
    await screen.findByText("a");
    expect(fireEvent.keyDown(editorOf(container).view.dom, { key: "k", ctrlKey: true })).toBe(true);
    unmount();

    const second = render(<RichTextEditor content="<p>b</p>" onChange={() => {}} />);
    await screen.findByText("b");
    second.rerender(<RichTextEditor content="<p>b</p>" onChange={() => {}} readOnly />);
    expect(fireEvent.keyDown(editorOf(second.container).view.dom, { key: "k", ctrlKey: true })).toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("RichTextEditor link clicks", () => {
  type ClickInit = { button?: number; ctrlKey?: boolean; metaKey?: boolean; target: Element };
  const click = (editor: Editor, init: ClickInit) =>
    editor.view.someProp("handleClick", (f) =>
      f(editor.view, 2, { button: 0, ctrlKey: false, metaKey: false, ...init } as unknown as MouseEvent),
    ) ?? false;

  let open: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    open = vi.fn();
    vi.stubGlobal("open", open);
    return () => vi.unstubAllGlobals();
  });

  it("places the caret on a plain click and opens the link on Ctrl/Cmd+click", async () => {
    const { container } = render(
      <RichTextEditor content='<p><a href="https://x.io/a"><strong>x</strong></a></p>' onChange={() => {}} />,
    );
    await screen.findByText("x");
    const editor = editorOf(container);
    const inner = container.querySelector(".tiptap a strong")!;
    expect(click(editor, { target: inner })).toBe(false);
    expect(click(editor, { target: inner, ctrlKey: true, button: 1 })).toBe(false);
    expect(open).not.toHaveBeenCalled();

    expect(click(editor, { target: inner, ctrlKey: true })).toBe(true);
    expect(open).toHaveBeenLastCalledWith("https://x.io/a", "_blank", "noopener,noreferrer");
    expect(click(editor, { target: inner, metaKey: true })).toBe(true);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("opens nothing for text, an anchor outside the editor, or one without an href", async () => {
    const { container } = render(<RichTextEditor content="<p>hello</p>" onChange={() => {}} />);
    await screen.findByText("hello");
    const editor = editorOf(container);
    expect(click(editor, { target: container.querySelector(".tiptap p")!, ctrlKey: true })).toBe(false);
    const outside = document.createElement("a");
    outside.setAttribute("href", "https://x.io");
    document.body.appendChild(outside);
    expect(click(editor, { target: outside, ctrlKey: true })).toBe(false);
    outside.remove();
    act(() => {
      editor.chain().setTextSelection({ from: 1, to: 6 }).setLink({ href: "example.com" }).run();
    });
    expect(click(editor, { target: container.querySelector(".tiptap a")!, ctrlKey: true })).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it("leaves a read-only editor's link to the browser", async () => {
    const { container } = render(
      <RichTextEditor content='<p><a href="https://x.io">x</a></p>' onChange={() => {}} readOnly />,
    );
    await screen.findByText("x");
    const editor = editorOf(container);
    const a = container.querySelector(".tiptap a")!;
    expect(click(editor, { target: a })).toBe(false);
    expect(click(editor, { target: a, ctrlKey: true })).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(a).toHaveAttribute("target", "_blank");
  });
});

describe("RichTextEditor code and headings", () => {
  const press = async (icon: string) => {
    await userEvent.setup().click(screen.getByText(icon).closest("button")!);
  };
  const background = (icon: string) => getComputedStyle(screen.getByText(icon).closest("button")!).backgroundColor;

  async function selected(content: string) {
    const onChange = vi.fn();
    const { container } = render(<RichTextEditor content={content} onChange={onChange} />);
    await waitFor(() => expect(container.querySelector(".tiptap")).not.toBeNull());
    const editor = editorOf(container);
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 4 });
    });
    return { onChange, editor };
  }

  it.each([
    ["code", "<p><code>abc</code></p>", "Inline code"],
    ["code_blocks", "<pre><code>abc</code></pre>", "Code block"],
    ["format_h3", "<h3>abc</h3>", "Heading"],
    ["format_h4", "<h4>abc</h4>", "Sub-heading"],
  ])("%s toggles its node on and off", async (icon, html, label) => {
    // A second paragraph: a block left last gains TipTap's trailing paragraph.
    const { onChange } = await selected("<p>abc</p><p>z</p>");
    expect(screen.getByText(icon).closest("button")).toHaveAttribute("aria-label", label);
    const idle = background(icon);
    await press(icon);
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toBe(`${html}<p>z</p>`));
    await waitFor(() => expect(background(icon)).not.toBe(idle));
    await press(icon);
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toBe("<p>abc</p><p>z</p>"));
  });

  it("switches a heading between the two levels", async () => {
    const { onChange } = await selected("<h3>abc</h3><p>z</p>");
    await press("format_h4");
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toBe("<h4>abc</h4><p>z</p>"));
    await press("format_h3");
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toBe("<h3>abc</h3><p>z</p>"));
  });

  it("keeps inline code in a comment", async () => {
    const onChange = vi.fn();
    const { container } = render(<RichTextEditor content="<p>abc</p>" onChange={onChange} variant="comment" />);
    await screen.findByText("abc");
    act(() => {
      editorOf(container).commands.setTextSelection({ from: 1, to: 4 });
    });
    await press("code");
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toBe("<p><code>abc</code></p>"));
  });
});

// ---------------------------------------------------------------------------
// Tables (document variant only)
// ---------------------------------------------------------------------------

/** A table as the editor writes it, from rows of cells (`th`/`td` helpers). */
function table(cols: number, rows: string[][]): string {
  return (
    `<table style="min-width: ${cols * 25}px;"><colgroup>${'<col style="min-width: 25px;">'.repeat(cols)}</colgroup><tbody>` +
    rows.map((r) => `<tr>${r.join("")}</tr>`).join("") +
    "</tbody></table>"
  );
}
const th = (text = "") => `<th colspan="1" rowspan="1"><p>${text}</p></th>`;
const td = (text = "") => `<td colspan="1" rowspan="1"><p>${text}</p></td>`;

/** A header row A B, a body row c d, and a paragraph after (no trailing-paragraph noise). */
const ABCD = `${table(2, [[th("A"), th("B")], [td("c"), td("d")]])}<p>z</p>`;

/** Every cell's position, in document order. */
function cellPositions(editor: Editor): number[] {
  const cells: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") cells.push(pos);
  });
  return cells;
}

/** The position of a text node whose text is exactly `text`. */
function textAt(editor: Editor, text: string): number {
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === text) at = pos;
  });
  expect(at, `no text "${text}"`).toBeGreaterThan(-1);
  return at;
}

/** Sets each listed cell's `colwidth` in one transaction. */
function setWidths(editor: Editor, widths: (number[] | null)[]) {
  act(() => {
    const tr = editor.state.tr;
    cellPositions(editor).forEach((pos, i) => {
      const node = tr.doc.nodeAt(pos)!;
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, colwidth: widths[i] ?? null });
    });
    editor.view.dispatch(tr);
  });
}

async function tableEditor(content: string, props: Partial<React.ComponentProps<typeof RichTextEditor>> = {}) {
  const onChange = vi.fn();
  const utils = render(<RichTextEditor content={content} onChange={onChange} {...props} />);
  await waitFor(() => expect(utils.container.querySelector(".tiptap")).not.toBeNull());
  return { ...utils, onChange, editor: editorOf(utils.container) };
}

const tableButton = () => screen.getByText("table").closest("button")!;

async function openTableMenu() {
  fireEvent.click(tableButton());
  return screen.findByRole("menu");
}

const ITEM_KEYS = [
  "insert",
  "selectRow",
  "selectColumn",
  "addRowBefore",
  "addRowAfter",
  "addColumnBefore",
  "addColumnAfter",
  "moveRowUp",
  "moveRowDown",
  "moveColumnBefore",
  "moveColumnAfter",
  "deleteRow",
  "deleteColumn",
  "toggleHeaderRow",
  "mergeCells",
  "splitCell",
  "deleteTable",
] as const;
type ItemKey = (typeof ITEM_KEYS)[number];

/** Which items the open menu offers. */
function enabledItems(): ItemKey[] {
  return ITEM_KEYS.filter(
    (key) => screen.getByTestId(`table-${key}`).getAttribute("aria-disabled") !== "true",
  );
}

describe("RichTextEditor tables", () => {
  it("is a menu button of the document toolbar, kept apart from the blind clicks", async () => {
    for (const icon of MENU_ICONS) expect(TOOLBAR_ICONS).not.toContain(icon);
    await tableEditor("<p>a</p>");
    expect(tableButton()).toHaveAttribute("aria-label", "Table");
    expect(tableButton()).toHaveAttribute("aria-haspopup", "menu");
    expect(tableButton()).toHaveAttribute("aria-expanded", "false");
    await openTableMenu();
    expect(tableButton()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "Insert table",
      "Select row",
      "Select column",
      "Add row above",
      "Add row below",
      "Add column before",
      "Add column after",
      "Move row up",
      "Move row down",
      "Move column before",
      "Move column after",
      "Delete row",
      "Delete column",
      "Merge cells",
      "Split cell",
      "Delete table",
    ]);
    expect(screen.getByRole("menuitemcheckbox")).toHaveTextContent("Header row");
  });

  it("inserts a 3×3 table with a header row from the menu, and closes it", async () => {
    const { onChange, editor } = await tableEditor("<p></p>");
    act(() => {
      editor.commands.focus("end");
    });
    await openTableMenu();
    fireEvent.click(screen.getByTestId("table-insert"));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    // The empty paragraph is replaced; a table left last gains TipTap's
    // trailing paragraph.
    expect(onChange.mock.calls.at(-1)?.[0]).toBe(`${TABLE_3X3}<p></p>`);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    // The caret is in the first header cell.
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(editor.state.selection.$from.node(-1).type.name).toBe("tableHeader");
  });

  it("gives the focus back to the editor after an action", async () => {
    const { editor } = await tableEditor(ABCD);
    act(() => {
      editor.commands.setTextSelection(textAt(editor, "c"));
    });
    (editor.view.dom as HTMLElement).blur();
    await openTableMenu();
    expect(editor.isFocused).toBe(false);
    fireEvent.click(screen.getByTestId("table-addRowAfter"));
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    await waitFor(() => expect(editor.view.dom).toHaveFocus());
    expect(tableButton()).not.toHaveFocus();
  });

  it("gives the focus back to the button when closed without an action", async () => {
    const { editor, onChange } = await tableEditor(ABCD);
    const menu = await openTableMenu();
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    await waitFor(() => expect(tableButton()).toHaveFocus());
    expect(editor.view.dom).not.toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each<[ItemKey, string]>([
    ["addRowBefore", table(2, [[th("A"), th("B")], [td(), td()], [td("c"), td("d")]])],
    ["addRowAfter", table(2, [[th("A"), th("B")], [td("c"), td("d")], [td(), td()]])],
    // "Before" is the previous column index (to the right in a right-to-left document).
    ["addColumnBefore", table(3, [[th(), th("A"), th("B")], [td(), td("c"), td("d")]])],
    ["addColumnAfter", table(3, [[th("A"), th(), th("B")], [td("c"), td(), td("d")]])],
    ["deleteRow", table(2, [[th("A"), th("B")]])],
    ["deleteColumn", table(1, [[th("B")], [td("d")]])],
    ["toggleHeaderRow", table(2, [[td("A"), td("B")], [td("c"), td("d")]])],
    ["deleteTable", ""],
  ])("runs %s from the menu with the caret in a body cell", async (key, html) => {
    const { editor, onChange } = await tableEditor(ABCD);
    act(() => {
      editor.commands.setTextSelection(textAt(editor, "c"));
    });
    await openTableMenu();
    fireEvent.click(screen.getByTestId(`table-${key}`));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)?.[0]).toBe(`${html}<p>z</p>`);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("merges a multi-cell selection and splits it again from the menu", async () => {
    const { editor, onChange } = await tableEditor(ABCD);
    const cells = cellPositions(editor);
    act(() => {
      editor.commands.setCellSelection({ anchorCell: cells[2], headCell: cells[3] });
    });
    expect(editor.state.selection).toBeInstanceOf(CellSelection);
    await openTableMenu();
    // Both columns are selected: the table keeps at least one, and neither moves.
    expect(enabledItems()).toEqual([
      "selectRow",
      "selectColumn",
      "addRowBefore",
      "addRowAfter",
      "addColumnBefore",
      "addColumnAfter",
      "deleteRow",
      "toggleHeaderRow",
      "mergeCells",
      "deleteTable",
    ]);
    fireEvent.click(screen.getByTestId("table-mergeCells"));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const merged =
      table(2, [[th("A"), th("B")], ['<td colspan="2" rowspan="1"><p>c</p><p>d</p></td>']]) + "<p>z</p>";
    expect(onChange.mock.calls.at(-1)?.[0]).toBe(merged);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

    act(() => {
      editor.commands.setTextSelection(textAt(editor, "c"));
    });
    await openTableMenu();
    expect(enabledItems()).toContain("splitCell");
    expect(enabledItems()).not.toContain("mergeCells");
    fireEvent.click(screen.getByTestId("table-splitCell"));
    await waitFor(() =>
      expect(onChange.mock.calls.at(-1)?.[0]).toBe(
        table(2, [[th("A"), th("B")], ['<td colspan="1" rowspan="1"><p>c</p><p>d</p></td>', td()]]) +
          "<p>z</p>",
      ),
    );
  });

  it("offers only Insert outside a table", async () => {
    const { editor } = await tableEditor(ABCD);
    act(() => {
      editor.commands.setTextSelection(textAt(editor, "z"));
    });
    await openTableMenu();
    expect(enabledItems()).toEqual(["insert"]);
    expect(screen.getByRole("menuitemcheckbox")).toHaveAttribute("aria-checked", "false");
  });

  it("offers everything but Insert, Merge, Split and the moves it cannot make with the caret in a cell", async () => {
    const { editor } = await tableEditor(ABCD);
    act(() => {
      editor.commands.setTextSelection(textAt(editor, "c"));
    });
    await openTableMenu();
    // No table inside a table from the menu, though the command would allow it.
    expect(editor.can().insertTable({ rows: 3, cols: 3, withHeaderRow: true })).toBe(true);
    // The body row neither crosses the header row nor leaves the table; the
    // first column moves only after.
    expect(enabledItems()).toEqual([
      "selectRow",
      "selectColumn",
      "addRowBefore",
      "addRowAfter",
      "addColumnBefore",
      "addColumnAfter",
      "moveColumnAfter",
      "deleteRow",
      "deleteColumn",
      "toggleHeaderRow",
      "deleteTable",
    ]);
  });

  it("selects the caret's row from the menu with no edit reported, and gives the editor the focus", async () => {
    const { editor, onChange } = await tableEditor(ABCD);
    act(() => {
      editor.commands.setTextSelection(textAt(editor, "c"));
    });
    await openTableMenu();
    fireEvent.click(screen.getByTestId("table-selectRow"));
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    await waitFor(() => expect(editor.view.dom).toHaveFocus());
    const selection = editor.state.selection as CellSelection;
    expect(selection).toBeInstanceOf(CellSelection);
    expect(selection.isRowSelection()).toBe(true);
    expect(selection.isColSelection()).toBe(false);
    const cells = cellPositions(editor);
    expect([selection.$anchorCell.pos, selection.$headCell.pos].sort((a, b) => a - b)).toEqual([cells[2], cells[3]]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("counts the rows a selection deletes, and refuses to delete every row", async () => {
    const three = `${table(2, [[th("A"), th("B")], [td("c"), td("d")], [td("e"), td("f")]])}<p>z</p>`;
    const { editor, onChange } = await tableEditor(three);
    const cells = cellPositions(editor);
    act(() => {
      editor.commands.setCellSelection({ anchorCell: cells[2], headCell: cells[4] });
    });
    await openTableMenu();
    expect(screen.getByTestId("table-deleteRow")).toHaveTextContent(/^Delete 2 rows$/);
    expect(screen.getByTestId("table-deleteColumn")).toHaveTextContent(/^Delete column$/);
    expect(enabledItems()).toContain("deleteRow");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

    act(() => {
      editor.commands.setCellSelection({ anchorCell: cells[0], headCell: cells[5] });
    });
    await openTableMenu();
    expect(screen.getByTestId("table-deleteRow")).toHaveTextContent(/^Delete 3 rows$/);
    expect(screen.getByTestId("table-deleteColumn")).toHaveTextContent(/^Delete 2 columns$/);
    expect(enabledItems()).not.toContain("deleteRow");
    expect(enabledItems()).not.toContain("deleteColumn");
    fireEvent.click(screen.getByTestId("table-deleteRow"));
    expect(editor.getHTML()).toBe(three);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("moves a row from the menu", async () => {
    const three = `${table(2, [[th("A"), th("B")], [td("c"), td("d")], [td("e"), td("f")]])}<p>z</p>`;
    const { editor, onChange } = await tableEditor(three);
    act(() => {
      editor.commands.setTextSelection(textAt(editor, "c"));
    });
    await openTableMenu();
    fireEvent.click(screen.getByTestId("table-moveRowDown"));
    await waitFor(() =>
      expect(onChange.mock.calls.at(-1)?.[0]).toBe(
        `${table(2, [[th("A"), th("B")], [td("e"), td("f")], [td("c"), td("d")]])}<p>z</p>`,
      ),
    );
    expect((editor.state.selection as CellSelection).isRowSelection()).toBe(true);
  });

  it("shows whether the table has a header row, and toggles it back on", async () => {
    const { editor, onChange } = await tableEditor(`${table(2, [[td("A"), td("B")], [td("c"), td("d")]])}<p>z</p>`);
    act(() => {
      editor.commands.setTextSelection(textAt(editor, "c"));
    });
    await openTableMenu();
    const toggle = screen.getByRole("menuitemcheckbox");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle.textContent).toBe("Header row");
    fireEvent.click(toggle);
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toBe(ABCD));
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    await openTableMenu();
    expect(screen.getByRole("menuitemcheckbox")).toHaveAttribute("aria-checked", "true");
    // The tick is the item's icon.
    expect(screen.getByRole("menuitemcheckbox")).toHaveTextContent(/^checkHeader row$/);
  });

  it("marks the button while the caret is in a table", async () => {
    const { editor } = await tableEditor(ABCD);
    act(() => {
      editor.commands.setTextSelection(textAt(editor, "z"));
    });
    const outside = getComputedStyle(tableButton()).backgroundColor;
    act(() => {
      editor.commands.setTextSelection(textAt(editor, "c"));
    });
    await waitFor(() => expect(getComputedStyle(tableButton()).backgroundColor).not.toBe(outside));
  });

  describe("stored markup", () => {
    it("pins what the commands write: a fresh table, resized, merged, split, header row off", async () => {
      const { editor } = await tableEditor("<p>z</p>");
      const fresh = (rows: number, cols: number, withHeaderRow = true) =>
        act(() => {
          editor.commands.setContent("", { emitUpdate: false });
          editor.commands.insertTable({ rows, cols, withHeaderRow });
        });
      // A table last in the text gains TipTap's trailing paragraph.
      fresh(3, 3);
      expect(editor.getHTML()).toBe(`${TABLE_3X3}<p></p>`);

      fresh(2, 2);
      expect(editor.getHTML()).toBe(`${TABLE_2X2}<p></p>`);

      // What a drag commits: the column's width on each of its cells.
      setWidths(editor, [[150], null, [150], null]);
      expect(editor.getHTML()).toBe(`${TABLE_ONE_RESIZED}<p></p>`);

      setWidths(editor, [[150], [200], [150], [200]]);
      expect(editor.getHTML()).toBe(`${TABLE_RESIZED}<p></p>`);

      let cells = cellPositions(editor);
      act(() => {
        editor.commands.setCellSelection({ anchorCell: cells[2], headCell: cells[3] });
        editor.commands.mergeCells();
      });
      expect(editor.getHTML()).toBe(`${TABLE_MERGED_RESIZED}<p></p>`);

      fresh(2, 2);
      cells = cellPositions(editor);
      act(() => {
        editor.commands.setCellSelection({ anchorCell: cells[2], headCell: cells[3] });
        editor.commands.mergeCells();
      });
      expect(editor.getHTML()).toBe(`${TABLE_MERGED}<p></p>`);

      act(() => {
        editor.commands.setTextSelection(cellPositions(editor)[2] + 2);
        editor.commands.splitCell();
      });
      expect(editor.getHTML()).toBe(`${TABLE_2X2}<p></p>`);

      act(() => {
        editor.commands.setTextSelection(cellPositions(editor)[0] + 2);
        editor.commands.toggleHeaderRow();
      });
      expect(editor.getHTML()).toBe(`${TABLE_NO_HEADER}<p></p>`);
    });

    it("carries a width set on one cell to the rest of its column", async () => {
      const { editor } = await tableEditor(`${TABLE_2X2}<p>z</p>`);
      act(() => {
        editor.commands.setTextSelection(cellPositions(editor)[0] + 2);
        editor.commands.setCellAttribute("colwidth", [150]);
      });
      // prosemirror-tables' `fixTables` evens the column out.
      expect(editor.getHTML()).toBe(`${TABLE_ONE_RESIZED}<p>z</p>`);
    });

    it.each(PINNED_TABLES)("gives %s back byte for byte, with no edit reported", async (_label, html) => {
      for (const stored of [html, `<p>a</p>${html}<p>z</p>`]) {
        const { editor, onChange, unmount } = await tableEditor(stored);
        expect(editor.getHTML()).toBe(stored);
        expect(onChange).not.toHaveBeenCalled();
        unmount();
      }
    });

    it("adds the trailing paragraph after a final table on the first transaction, reported only when editable", async () => {
      const editable = await tableEditor(TABLE_2X2);
      expect(editable.editor.getHTML()).toBe(TABLE_2X2);
      act(() => {
        editable.editor.commands.setTextSelection(cellPositions(editable.editor)[0] + 2);
      });
      expect(editable.editor.getHTML()).toBe(`${TABLE_2X2}<p></p>`);
      expect(editable.onChange).toHaveBeenCalledTimes(1);
      expect(editable.onChange).toHaveBeenLastCalledWith(`${TABLE_2X2}<p></p>`);
      editable.unmount();

      const locked = await tableEditor(TABLE_2X2, { readOnly: true });
      act(() => {
        locked.editor.commands.setTextSelection(cellPositions(locked.editor)[0] + 2);
      });
      expect(locked.editor.getHTML()).toBe(`${TABLE_2X2}<p></p>`);
      expect(locked.onChange).not.toHaveBeenCalled();
    });

    it("normalises a plain table written through the API, with no edit reported", async () => {
      const { editor, onChange } = await tableEditor("<table><tr><th>A</th><td>b</td></tr></table>");
      // The given string differs from the editor's, so the content sync
      // re-sets it (adding the trailing paragraph).
      expect(editor.getHTML()).toBe(
        '<table style="min-width: 50px;"><colgroup><col style="min-width: 25px;"><col style="min-width: 25px;"></colgroup><tbody>' +
          '<tr><th colspan="1" rowspan="1"><p>A</p></th><td colspan="1" rowspan="1"><p>b</p></td></tr>' +
          "</tbody></table><p></p>",
      );
      expect(onChange).not.toHaveBeenCalled();
    });

    it("rebuilds a stored table's style from its cells and drops other styles", async () => {
      const { editor } = await tableEditor(
        '<table style="width: 999px; background: red"><colgroup><col style="width: 7px"></colgroup><tbody>' +
          '<tr><td colwidth="150" style="color: red"><p>a</p></td></tr></tbody></table><p>z</p>',
      );
      expect(editor.getHTML()).toBe(
        '<table style="width: 150px;"><colgroup><col style="width: 150px;"></colgroup><tbody>' +
          '<tr><td colspan="1" rowspan="1" colwidth="150"><p>a</p></td></tr></tbody></table><p>z</p>',
      );
    });

    it("keeps bold, a link, a mention and a picture inside a cell", async () => {
      const cell =
        '<td colspan="1" rowspan="1"><p><strong>b</strong> <a target="_blank" rel="noopener noreferrer" href="https://x.io">x</a> ' +
        `<span data-type="mention" data-kind="card" data-id="${CARD_ID}">@SAP ERP</span></p>` +
        `<img src="${ADR_IMG}" width="320" height="240"></td>`;
      const stored =
        '<table style="min-width: 25px;"><colgroup><col style="min-width: 25px;"></colgroup><tbody>' +
        `<tr>${cell}</tr></tbody></table><p>z</p>`;
      const { editor, onChange, container } = await tableEditor(stored, {
        mentions: ["card"],
        imageKind: "adr",
      });
      expect(editor.getHTML()).toBe(stored);
      expect(onChange).not.toHaveBeenCalled();
      const domCell = container.querySelector(".tiptap td")!;
      expect(domCell.querySelector("strong")).toHaveTextContent("b");
      expect(domCell.querySelector('a[href="https://x.io"]')).toHaveTextContent("x");
      expect(domCell.querySelector('[data-type="mention"]')).not.toBeNull();
      expect(domCell.querySelector("[data-resize-container] img")).toHaveAttribute("src", ADR_IMG);
    });
  });

  describe("read-only and resizing", () => {
    const resizing = (editor: Editor) => columnResizingPluginKey.getState(editor.state);

    it("scrolls a wide table in its own wrapper, never the editable root", async () => {
      // The shared display rules let a read-only surface's root scroll; the
      // editor overrides that, so its resize handles are never clipped.
      const { container } = await tableEditor(`${TABLE_RESIZED}<p>z</p>`);
      const root = container.querySelector(".tiptap") as HTMLElement;
      const wrapper = root.querySelector(":scope > .tableWrapper") as HTMLElement;
      expect(wrapper).not.toBeNull();
      expect(getComputedStyle(root).overflowX).toBe("visible");
      expect(getComputedStyle(wrapper).overflowX).toBe("auto");
    });

    it("keeps a stored table in a read-only editor, with no toolbar", async () => {
      const { editor } = await tableEditor(`${TABLE_RESIZED}<p>z</p>`, { readOnly: true });
      expect(editor.getHTML()).toBe(`${TABLE_RESIZED}<p>z</p>`);
      expect(screen.queryByText("table")).not.toBeInTheDocument();
      expect(screen.queryByText("format_bold")).not.toBeInTheDocument();
    });

    it("registers column resizing whatever the editor's state, and keeps it across a lock change", async () => {
      const doc = `${TABLE_RESIZED}<p>z</p>`;
      const onChange = vi.fn();
      const { container, rerender } = render(<RichTextEditor content={doc} onChange={onChange} readOnly />);
      const editor = await mounted(container);
      expect(resizing(editor)).toEqual({ activeHandle: -1, dragging: false });

      // The resize plugin's own view: wrapped, with the columns' widths.
      const view = () => container.querySelector(".tiptap > .tableWrapper > table")!;
      expect(view()).not.toBeNull();
      expect(
        Array.from(view().querySelectorAll(":scope > colgroup > col")).map(
          (c) => (c as HTMLElement).style.width,
        ),
      ).toEqual(["150px", "200px"]);
      expect((view() as HTMLElement).style.width).toBe("350px");

      rerender(<RichTextEditor content={doc} onChange={onChange} />);
      await waitFor(() => expect(editor.isEditable).toBe(true));
      expect(resizing(editor)).toEqual({ activeHandle: -1, dragging: false });
      // The same view keeps the colgroup in step with an edit while editing.
      setWidths(editor, [[90], [200], [90], [200]]);
      expect((view().querySelector("col") as HTMLElement).style.width).toBe("90px");
      expect((view() as HTMLElement).style.width).toBe("290px");

      rerender(<RichTextEditor content={doc} onChange={onChange} readOnly />);
      await waitFor(() => expect(editor.isEditable).toBe(false));
      expect(resizing(editor)).toEqual({ activeHandle: -1, dragging: false });
    });

    it("refuses a resize handle while locked and shows one once unlocked", async () => {
      const doc = `${TABLE_2X2}<p>z</p>`;
      const onChange = vi.fn();
      const { container, rerender } = render(<RichTextEditor content={doc} onChange={onChange} readOnly />);
      const editor = await mounted(container);
      // jsdom has no layout: the first header cell is given a box, and a
      // pointer 2px inside its right edge; `posAtCoords` cannot measure
      // either, so it answers with that cell's inside.
      const firstCell = cellPositions(editor)[0];
      vi.spyOn(editor.view, "posAtCoords").mockReturnValue({ pos: firstCell + 2, inside: firstCell });
      const headerCell = container.querySelector(".tiptap th")!;
      vi.spyOn(headerCell, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 20));
      const cellDom = headerCell.querySelector("p")!;
      fireEvent.mouseMove(cellDom, { clientX: 98, clientY: 10 });
      expect(resizing(editor)?.activeHandle).toBe(-1);
      expect(container.querySelector(".column-resize-handle")).toBeNull();

      rerender(<RichTextEditor content={doc} onChange={onChange} />);
      await waitFor(() => expect(editor.isEditable).toBe(true));
      fireEvent.mouseMove(cellDom, { clientX: 98, clientY: 10 });
      expect(resizing(editor)?.activeHandle).toBe(firstCell);
      expect(container.querySelector(".tiptap th .column-resize-handle")).not.toBeNull();
      expect(container.querySelector(".tiptap")).toHaveClass("resize-cursor");
      // Showing a handle is not an edit.
      expect(onChange).not.toHaveBeenCalled();
    });

    it("moves between cells with Tab and Shift-Tab, and Tab in the last cell adds a row", async () => {
      const { editor, onChange } = await tableEditor(ABCD);
      const inCell = () => editor.state.selection.$from.parent.textContent;
      act(() => {
        editor.commands.setTextSelection(textAt(editor, "A"));
      });
      fireEvent.keyDown(editor.view.dom, { key: "Tab" });
      expect(inCell()).toBe("B");
      fireEvent.keyDown(editor.view.dom, { key: "Tab" });
      expect(inCell()).toBe("c");
      fireEvent.keyDown(editor.view.dom, { key: "Tab", shiftKey: true });
      expect(inCell()).toBe("B");
      expect(onChange).not.toHaveBeenCalled();
      act(() => {
        editor.commands.setTextSelection(textAt(editor, "d"));
      });
      fireEvent.keyDown(editor.view.dom, { key: "Tab" });
      expect(onChange).toHaveBeenLastCalledWith(
        `${table(2, [[th("A"), th("B")], [td("c"), td("d")], [td(), td()]])}<p>z</p>`,
      );
    });
  });

  describe("comment variant", () => {
    it("has no table nodes: a loaded table flattens to its cells' paragraphs", async () => {
      const { editor } = await tableEditor(
        "<table><tbody><tr><th><p>A</p></th><td><p>b</p></td></tr><tr><td>c</td><td>d</td></tr></tbody></table>",
        { variant: "comment" },
      );
      // Cells holding bare text run together into one paragraph.
      expect(editor.getHTML()).toBe("<p>A</p><p>b</p><p>cd</p>");
      expect(screen.queryByText("table")).not.toBeInTheDocument();
    });

    it("flattens a pasted table, where a document keeps it", async () => {
      const html =
        "<table><tr><th>A</th><td><p>b</p><p>b2</p></td></tr><tr><td>c</td><td>d</td></tr></table>";
      const paste = (editor: Editor) =>
        act(() => {
          editor.commands.setTextSelection(2);
          fireEvent.paste(editor.view.dom, { clipboardData: clipboard([], html) });
        });

      const comment = await tableEditor("<p>q</p>", { variant: "comment" });
      paste(comment.editor);
      // The first cell joins the paragraph pasted into.
      expect(comment.editor.getHTML()).toBe("<p>qA</p><p>b</p><p>b2</p><p>cd</p>");
      comment.unmount();

      const doc = await tableEditor("<p>q</p>");
      paste(doc.editor);
      expect(doc.editor.getHTML()).toBe(
        "<p>q</p>" +
          table(2, [
            [th("A"), '<td colspan="1" rowspan="1"><p>b</p><p>b2</p></td>'],
            [td("c"), td("d")],
          ]) +
          "<p></p>",
      );
    });
  });
});

// ---------------------------------------------------------------------------
// The right-click menu in a table (document variant only)
// ---------------------------------------------------------------------------

describe("RichTextEditor table right-click menu", () => {
  /** The paragraph (`p`) inside the rendered cell whose text is `text`. */
  const cellText = (container: HTMLElement, text: string) => {
    const found = Array.from(container.querySelectorAll(".tiptap td p, .tiptap th p")).find(
      (p) => p.textContent === text,
    );
    expect(found, `no cell "${text}"`).toBeDefined();
    return found as HTMLElement;
  };
  /** A pointer right-click at (240, 120); false when it was prevented. */
  const rightClick = (target: Element, init: MouseEventInit = {}) =>
    fireEvent.contextMenu(target, { clientX: 240, clientY: 120, button: 2, ...init });
  /** A right-click whose event carries its own `pointerType` (a PointerEvent in Chrome). */
  const rightClickAs = (target: Element, pointerType: string) => {
    const event = createEvent.contextMenu(target, { clientX: 240, clientY: 120, button: 2 });
    Object.defineProperty(event, "pointerType", { value: pointerType });
    return fireEvent(target, event);
  };
  /** A `pointerdown` of that type (jsdom has no PointerEvent). */
  const pointerDown = (target: Element, pointerType: string) => {
    const event = createEvent.pointerDown(target, { button: 0 });
    Object.defineProperty(event, "pointerType", { value: pointerType });
    fireEvent(target, event);
  };
  const actionsMenu = () => screen.queryByRole("menu", { name: "Table actions" });
  const paperOf = (menu: HTMLElement) => menu.closest(".MuiPaper-root") as HTMLElement;
  const caretIn = (editor: Editor) => editor.state.selection.$head.parent.textContent;
  const caretAt = (editor: Editor, pos: number) =>
    act(() => {
      editor.commands.setTextSelection(pos);
    });

  /** A body cell holding a link, a body cell holding a picture, then a paragraph. */
  const RICH =
    table(2, [
      [th("A"), th("B")],
      [
        '<td colspan="1" rowspan="1"><p>see <a target="_blank" rel="noopener noreferrer" href="https://x.io">x</a></p></td>',
        `<td colspan="1" rowspan="1"><img src="${ADR_IMG}"><p>pic</p></td>`,
      ],
    ]) + "<p>z</p>";
  /** A body cell holding a card mention. */
  const MENTIONED =
    table(1, [
      [th("A")],
      [`<td colspan="1" rowspan="1"><p>by <span data-type="mention" data-kind="card" data-id="${CARD_ID}">@SAP ERP</span></p></td>`],
    ]) + "<p>z</p>";

  describe("opens", () => {
    it("on a right-click in a cell, prevented, with the context set at the pointer", async () => {
      const { container, editor, onChange } = await tableEditor(ABCD);
      caretAt(editor, textAt(editor, "A"));
      expect(rightClick(cellText(container, "d"))).toBe(false);
      const menu = await screen.findByRole("menu", { name: "Table actions" });
      expect(paperOf(menu).style.top).toBe("120px");
      expect(paperOf(menu).style.left).toBe("240px");
      const labels = within(menu)
        .getAllByRole("menuitem")
        .map((i) => i.textContent);
      expect(labels[0]).toBe("Select row");
      expect(labels).not.toContain("Insert table");
      expect(labels).toHaveLength(15);
      // The caret followed the click into the cell, at its start (no layout).
      expect(editor.state.selection.from).toBe(textAt(editor, "d"));
      expect(editor.state.selection.empty).toBe(true);
      expect(onChange).not.toHaveBeenCalled();
    });

    it("puts the caret where the pointer is when that lands inside the clicked cell", async () => {
      const { container, editor } = await tableEditor(ABCD);
      caretAt(editor, textAt(editor, "A"));
      const d = textAt(editor, "d");
      const posAtCoords = vi
        .spyOn(editor.view, "posAtCoords")
        .mockReturnValue({ pos: d + 1, inside: -1 });
      rightClick(cellText(container, "d"));
      expect(posAtCoords).toHaveBeenCalledWith({ left: 240, top: 120 });
      expect(editor.state.selection.from).toBe(d + 1);
      expect(editor.state.selection.empty).toBe(true);
    });

    it("puts the caret at the cell's start when the pointer lands outside it, or cannot be measured", async () => {
      const { container, editor } = await tableEditor(ABCD);
      const c = textAt(editor, "c");
      const d = textAt(editor, "d");
      const posAtCoords = vi.spyOn(editor.view, "posAtCoords");

      caretAt(editor, textAt(editor, "A"));
      posAtCoords.mockReturnValue({ pos: c, inside: -1 });
      rightClick(cellText(container, "d"));
      expect(editor.state.selection.from).toBe(d);

      caretAt(editor, textAt(editor, "A"));
      // Just past the cell's content (its closing token).
      posAtCoords.mockReturnValue({ pos: d + 3, inside: -1 });
      rightClick(cellText(container, "d"));
      expect(editor.state.selection.from).toBe(d);

      caretAt(editor, textAt(editor, "A"));
      posAtCoords.mockImplementation(() => {
        throw new Error("no layout");
      });
      expect(rightClick(cellText(container, "d"))).toBe(false);
      expect(editor.state.selection.from).toBe(d);
    });

    it("accepts the pointer at the very start and end of the cell's content", async () => {
      const { container, editor } = await tableEditor(ABCD);
      const d = textAt(editor, "d");
      const posAtCoords = vi.spyOn(editor.view, "posAtCoords");
      // The cell's content runs from the paragraph's opening (d - 1) to its closing (d + 2).
      caretAt(editor, textAt(editor, "A"));
      posAtCoords.mockReturnValue({ pos: d + 2, inside: -1 });
      rightClick(cellText(container, "d"));
      expect(editor.state.selection.from).toBe(d + 1);
      caretAt(editor, textAt(editor, "A"));
      posAtCoords.mockReturnValue({ pos: d - 1, inside: -1 });
      rightClick(cellText(container, "d"));
      expect(editor.state.selection.from).toBe(d);
    });

    it("on a mention chip in a cell, whose node view keeps its events from ProseMirror's props", async () => {
      const { container, editor, onChange } = await tableEditor(MENTIONED, { mentions: ["card"] });
      const chip = container.querySelector('.tiptap td [data-type="mention"]')!;
      expect(chip).not.toBeNull();
      let chipPos = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "mention") chipPos = pos;
      });
      // The pointer is on the chip; the caret goes just before it.
      vi.spyOn(editor.view, "posAtCoords").mockReturnValue({ pos: chipPos, inside: chipPos });
      caretAt(editor, textAt(editor, "A"));
      expect(fireEvent.mouseDown(chip, { button: 2, clientX: 240, clientY: 120 })).toBe(false);
      fireEvent.mouseUp(chip, { button: 2, clientX: 240, clientY: 120 });
      expect(rightClick(chip)).toBe(false);
      expect(await screen.findByRole("menu", { name: "Table actions" })).toBeInTheDocument();
      expect(editor.state.selection).not.toBeInstanceOf(NodeSelection);
      expect(editor.state.selection.empty).toBe(true);
      expect(editor.state.selection.from).toBe(chipPos);
      expect(onChange).not.toHaveBeenCalled();
    });

    it("after a touch press, once the next press is a mouse's", async () => {
      const { container } = await tableEditor(ABCD);
      const d = cellText(container, "d");
      pointerDown(d, "touch");
      pointerDown(d, "mouse");
      expect(rightClick(d)).toBe(false);
      expect(await screen.findByRole("menu", { name: "Table actions" })).toBeInTheDocument();
    });

    it("on a right-click carrying a mouse pointer type, whatever the last press was", async () => {
      const { container } = await tableEditor(ABCD);
      const d = cellText(container, "d");
      pointerDown(d, "touch");
      expect(rightClickAs(d, "mouse")).toBe(false);
      expect(await screen.findByRole("menu", { name: "Table actions" })).toBeInTheDocument();
    });
  });

  describe("is left to the browser", () => {
    async function expectLeft(prevented: boolean) {
      expect(prevented).toBe(true);
      // Nothing opens, now or after React has settled.
      await act(async () => {});
      expect(actionsMenu()).not.toBeInTheDocument();
    }

    it("with Shift held", async () => {
      const { container, editor } = await tableEditor(ABCD);
      caretAt(editor, textAt(editor, "A"));
      await expectLeft(rightClick(cellText(container, "d"), { shiftKey: true }));
      // The selection is not moved either.
      expect(caretIn(editor)).toBe("A");
    });

    it("in a locked editor", async () => {
      const { container, editor } = await tableEditor(ABCD, { readOnly: true });
      caretAt(editor, textAt(editor, "A"));
      await expectLeft(rightClick(cellText(container, "d")));
      expect(caretIn(editor)).toBe("A");
    });

    it("outside a table", async () => {
      const { container } = await tableEditor(ABCD);
      const after = Array.from(container.querySelectorAll(".tiptap > p")).find((p) => p.textContent === "z")!;
      await expectLeft(rightClick(after));
    });

    it("on a link inside a cell", async () => {
      const { container } = await tableEditor(RICH);
      await expectLeft(rightClick(container.querySelector('.tiptap td a[href="https://x.io"]')!));
    });

    it("on a picture inside a cell", async () => {
      const { container } = await tableEditor(RICH, { imageKind: "adr" });
      const img = container.querySelector(".tiptap td img")!;
      expect(img).toHaveAttribute("src", ADR_IMG);
      await expectLeft(rightClick(img));
    });

    it("next to a link or a picture in the same cell, where the menu opens", async () => {
      const { container } = await tableEditor(RICH, { imageKind: "adr" });
      expect(rightClick(cellText(container, "pic"))).toBe(false);
      expect(await screen.findByRole("menu", { name: "Table actions" })).toBeInTheDocument();
    });

    it("after a touch press", async () => {
      const { container } = await tableEditor(ABCD);
      const d = cellText(container, "d");
      pointerDown(d, "touch");
      await expectLeft(rightClick(d));
    });

    it("on a right-click that says it comes from touch", async () => {
      const { container } = await tableEditor(ABCD);
      await expectLeft(rightClickAs(cellText(container, "d"), "touch"));
    });

    it("in a comment, which has no tables", async () => {
      const { container } = await tableEditor(
        "<table><tbody><tr><td><p>b</p></td></tr></tbody></table>",
        { variant: "comment" },
      );
      expect(container.querySelector(".tiptap td")).toBeNull();
      await expectLeft(rightClick(container.querySelector(".tiptap p")!));
    });
  });

  describe("from the keyboard (Shift+F10, the Menu key: zero coordinates)", () => {
    const keyboard = (target: Element, init: MouseEventInit = {}) =>
      fireEvent.contextMenu(target, { clientX: 0, clientY: 0, ...init });

    it("opens on the caret's cell, anchored inside its bottom edge", async () => {
      const { container, editor } = await tableEditor(ABCD);
      caretAt(editor, textAt(editor, "d"));
      const cell = cellText(container, "d").closest("td")!;
      vi.spyOn(cell, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 30, 300, 40));
      expect(keyboard(editor.view.dom, { shiftKey: true })).toBe(false);
      const menu = await screen.findByRole("menu", { name: "Table actions" });
      // Bottom 70 less 4; left 10 plus half the width, at most 120.
      expect(paperOf(menu).style.top).toBe("66px");
      expect(paperOf(menu).style.left).toBe("130px");
      expect(caretIn(editor)).toBe("d");
    });

    it("anchors on a narrow cell's middle, and on a cell selection's head cell", async () => {
      const { container, editor } = await tableEditor(ABCD);
      const cells = cellPositions(editor);
      act(() => {
        editor.commands.setCellSelection({ anchorCell: cells[0], headCell: cells[2] });
      });
      const cell = cellText(container, "c").closest("td")!;
      vi.spyOn(cell, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 30, 100, 40));
      expect(keyboard(editor.view.dom)).toBe(false);
      const menu = await screen.findByRole("menu", { name: "Table actions" });
      expect(paperOf(menu).style.top).toBe("66px");
      expect(paperOf(menu).style.left).toBe("70px");
      expect(editor.state.selection).toBeInstanceOf(CellSelection);
    });

    it("is left to the browser with the caret outside a table", async () => {
      const { editor } = await tableEditor(ABCD);
      caretAt(editor, textAt(editor, "z"));
      expect(keyboard(editor.view.dom)).toBe(true);
      await act(async () => {});
      expect(actionsMenu()).not.toBeInTheDocument();
    });

    it("is left to the browser in a locked editor", async () => {
      const { editor } = await tableEditor(ABCD, { readOnly: true });
      caretAt(editor, textAt(editor, "d"));
      expect(keyboard(editor.view.dom)).toBe(true);
      await act(async () => {});
      expect(actionsMenu()).not.toBeInTheDocument();
    });
  });

  describe("from the keyboard, recognised by its key (Chromium gives the caret's coordinates)", () => {
    // `performance.now` is page-wide: give it back after each test.
    afterEach(() => {
      vi.restoreAllMocks();
    });
    /** A key press that invokes the menu, then its `contextmenu` on the editor's root at (240, 120). */
    const invoke = (editor: Editor, key: KeyboardEventInit, init: MouseEventInit = {}) => {
      fireEvent.keyDown(editor.view.dom, key);
      return fireEvent.contextMenu(editor.view.dom, { clientX: 240, clientY: 120, ...init });
    };
    const MENU_KEY = { key: "ContextMenu" };
    const SHIFT_F10 = { key: "F10", shiftKey: true };
    /** Gives the caret's cell a box: bottom 70, left 10, 300 wide. */
    const boxCell = (container: HTMLElement, text: string) => {
      const cell = cellText(container, text).closest("td, th")!;
      vi.spyOn(cell, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 30, 300, 40));
    };
    const expectAnchoredOnCell = async () => {
      const menu = await screen.findByRole("menu", { name: "Table actions" });
      expect(paperOf(menu).style.top).toBe("66px");
      expect(paperOf(menu).style.left).toBe("130px");
    };
    const expectNoMenu = async () => {
      await act(async () => {});
      expect(actionsMenu()).not.toBeInTheDocument();
    };

    it("opens on the caret's cell after the Menu key", async () => {
      const { container, editor, onChange } = await tableEditor(ABCD);
      caretAt(editor, textAt(editor, "d"));
      boxCell(container, "d");
      expect(invoke(editor, MENU_KEY)).toBe(false);
      await expectAnchoredOnCell();
      expect(caretIn(editor)).toBe("d");
      expect(onChange).not.toHaveBeenCalled();
    });

    it("opens on the caret's cell after Shift+F10, Shift and all", async () => {
      const { container, editor } = await tableEditor(ABCD);
      caretAt(editor, textAt(editor, "d"));
      boxCell(container, "d");
      fireEvent.keyDown(editor.view.dom, { key: "Shift", shiftKey: true });
      expect(invoke(editor, SHIFT_F10, { shiftKey: true })).toBe(false);
      await expectAnchoredOnCell();
    });

    it("opens with the caret on a link inside a cell: there is no pointer on the link", async () => {
      const { container, editor } = await tableEditor(RICH);
      caretAt(editor, textAt(editor, "x"));
      boxCell(container, "see x");
      expect(invoke(editor, MENU_KEY)).toBe(false);
      await expectAnchoredOnCell();
    });

    it("is not F10 without Shift", async () => {
      const { editor } = await tableEditor(ABCD);
      caretAt(editor, textAt(editor, "d"));
      // A pointer-like event on the root, outside every cell: left alone.
      expect(invoke(editor, { key: "F10" })).toBe(true);
      await expectNoMenu();
    });

    it("is left to the browser with the caret outside a table, or in a locked editor", async () => {
      const open = await tableEditor(ABCD);
      caretAt(open.editor, textAt(open.editor, "z"));
      expect(invoke(open.editor, MENU_KEY)).toBe(true);
      await expectNoMenu();
      open.unmount();

      const locked = await tableEditor(ABCD, { readOnly: true });
      caretAt(locked.editor, textAt(locked.editor, "d"));
      expect(invoke(locked.editor, MENU_KEY)).toBe(true);
      await expectNoMenu();
    });

    it("is cancelled by a pointer press between the key and the contextmenu", async () => {
      const { container, editor } = await tableEditor(ABCD);
      caretAt(editor, textAt(editor, "d"));
      fireEvent.keyDown(editor.view.dom, MENU_KEY);
      pointerDown(editor.view.dom, "mouse");
      expect(fireEvent.contextMenu(editor.view.dom, { clientX: 240, clientY: 120 })).toBe(true);
      await expectNoMenu();
      // A mouse press cancels it too (a macOS Ctrl+click is a pointer). The
      // left button's press reaches ProseMirror's own handler, which asks the
      // document what is under the pointer; jsdom has no answer.
      Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => null });
      try {
        fireEvent.keyDown(editor.view.dom, MENU_KEY);
        fireEvent.mouseDown(cellText(container, "c"), { button: 0, ctrlKey: true });
        expect(fireEvent.contextMenu(editor.view.dom, { clientX: 240, clientY: 120, ctrlKey: true })).toBe(true);
        await expectNoMenu();
      } finally {
        delete (document as { elementFromPoint?: unknown }).elementFromPoint;
      }
    });

    it("is cancelled by another key, not by a bare modifier", async () => {
      const { container, editor } = await tableEditor(ABCD);
      caretAt(editor, textAt(editor, "d"));
      fireEvent.keyDown(editor.view.dom, MENU_KEY);
      fireEvent.keyDown(editor.view.dom, { key: "a" });
      expect(fireEvent.contextMenu(editor.view.dom, { clientX: 240, clientY: 120 })).toBe(true);
      await expectNoMenu();

      boxCell(container, "d");
      fireEvent.keyDown(editor.view.dom, MENU_KEY);
      fireEvent.keyDown(editor.view.dom, { key: "Control", ctrlKey: true });
      fireEvent.keyUp(editor.view.dom, MENU_KEY);
      expect(fireEvent.contextMenu(editor.view.dom, { clientX: 240, clientY: 120 })).toBe(false);
      await expectAnchoredOnCell();
    });

    it("is taken by one contextmenu only: the next right-click is a pointer's", async () => {
      const { container, editor } = await tableEditor(RICH);
      caretAt(editor, textAt(editor, "pic"));
      expect(invoke(editor, MENU_KEY)).toBe(false);
      fireEvent.keyDown(await screen.findByRole("menu", { name: "Table actions" }), { key: "Escape" });
      await waitFor(() => expect(actionsMenu()).not.toBeInTheDocument());
      expect(rightClick(container.querySelector('.tiptap td a[href="https://x.io"]')!)).toBe(true);
      await expectNoMenu();
    });

    it("goes stale after KEY_INVOCATION_MS: a later right-click on a link stays the browser's", async () => {
      const { container, editor } = await tableEditor(RICH);
      caretAt(editor, textAt(editor, "pic"));
      const now = vi.spyOn(performance, "now").mockReturnValue(5000);
      fireEvent.keyDown(editor.view.dom, MENU_KEY);
      now.mockReturnValue(5000 + KEY_INVOCATION_MS + 1);
      expect(rightClick(container.querySelector('.tiptap td a[href="https://x.io"]')!)).toBe(true);
      await expectNoMenu();
    });

    it("is still valid at exactly KEY_INVOCATION_MS", async () => {
      const { container, editor } = await tableEditor(ABCD);
      caretAt(editor, textAt(editor, "d"));
      boxCell(container, "d");
      const now = vi.spyOn(performance, "now").mockReturnValue(5000);
      fireEvent.keyDown(editor.view.dom, MENU_KEY);
      now.mockReturnValue(5000 + KEY_INVOCATION_MS);
      expect(fireEvent.contextMenu(editor.view.dom, { clientX: 240, clientY: 120 })).toBe(false);
      await expectAnchoredOnCell();
    });
  });

  describe("the selection", () => {
    it("keeps a cell selection that holds the clicked cell", async () => {
      const { container, editor } = await tableEditor(ABCD);
      const cells = cellPositions(editor);
      act(() => {
        editor.commands.setCellSelection({ anchorCell: cells[2], headCell: cells[3] });
      });
      const before = editor.state.selection;
      expect(rightClick(cellText(container, "d"))).toBe(false);
      expect(editor.state.selection).toBe(before);
      await screen.findByRole("menu", { name: "Table actions" });
    });

    it("moves the caret into a clicked cell outside the cell selection", async () => {
      const { container, editor } = await tableEditor(ABCD);
      const cells = cellPositions(editor);
      act(() => {
        editor.commands.setCellSelection({ anchorCell: cells[2], headCell: cells[3] });
      });
      rightClick(cellText(container, "A"));
      expect(editor.state.selection).not.toBeInstanceOf(CellSelection);
      expect(editor.state.selection.from).toBe(textAt(editor, "A"));
      expect(editor.state.selection.empty).toBe(true);
    });

    it("keeps a text selection inside the clicked cell", async () => {
      const { container, editor } = await tableEditor(ABCD);
      const d = textAt(editor, "d");
      act(() => {
        editor.commands.setTextSelection({ from: d, to: d + 1 });
      });
      // Where the pointer is would collapse it, were it not kept.
      vi.spyOn(editor.view, "posAtCoords").mockReturnValue({ pos: d, inside: -1 });
      rightClick(cellText(container, "d"));
      expect(editor.state.selection.from).toBe(d);
      expect(editor.state.selection.to).toBe(d + 1);
    });

    it("moves a text selection that reaches outside the clicked cell", async () => {
      const { container, editor } = await tableEditor(ABCD);
      act(() => {
        editor.commands.setTextSelection({ from: textAt(editor, "c"), to: textAt(editor, "d") + 1 });
      });
      rightClick(cellText(container, "d"));
      expect(editor.state.selection.from).toBe(textAt(editor, "d"));
      expect(editor.state.selection.empty).toBe(true);
    });
  });

  describe("the menu", () => {
    it("runs an action on the clicked cell, closes, and gives the editor the focus", async () => {
      const { container, editor, onChange } = await tableEditor(ABCD);
      caretAt(editor, textAt(editor, "A"));
      (editor.view.dom as HTMLElement).blur();
      rightClick(cellText(container, "c"));
      const menu = await screen.findByRole("menu", { name: "Table actions" });
      fireEvent.click(within(menu).getByTestId("table-addRowAfter"));
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenLastCalledWith(
        `${table(2, [[th("A"), th("B")], [td("c"), td("d")], [td(), td()]])}<p>z</p>`,
      );
      await waitFor(() => expect(actionsMenu()).not.toBeInTheDocument());
      await waitFor(() => expect(editor.view.dom).toHaveFocus());
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("closes on Escape and gives the editor the focus with the clicked cell's caret, reporting no edit", async () => {
      const { container, editor, onChange } = await tableEditor(ABCD);
      caretAt(editor, textAt(editor, "A"));
      rightClick(cellText(container, "d"));
      const menu = await screen.findByRole("menu", { name: "Table actions" });
      fireEvent.keyDown(menu, { key: "Escape" });
      await waitFor(() => expect(actionsMenu()).not.toBeInTheDocument());
      await waitFor(() => expect(editor.view.dom).toHaveFocus());
      expect(caretIn(editor)).toBe("d");
      expect(onChange).not.toHaveBeenCalled();
    });

    it("closes on a right-click on itself, which is prevented", async () => {
      const { container } = await tableEditor(ABCD);
      rightClick(cellText(container, "d"));
      const menu = await screen.findByRole("menu", { name: "Table actions" });
      expect(rightClick(menu)).toBe(false);
      await waitFor(() => expect(actionsMenu()).not.toBeInTheDocument());
    });

    it("is mounted for a locked editor too, and stays closed there", async () => {
      const { container } = await tableEditor(ABCD, { readOnly: true });
      rightClick(cellText(container, "d"));
      await act(async () => {});
      expect(actionsMenu()).not.toBeInTheDocument();
    });
  });

  describe("the right button's press", () => {
    const resizing = (editor: Editor) => columnResizingPluginKey.getState(editor.state);
    const press = (target: Element, init: MouseEventInit = {}) =>
      fireEvent.mouseDown(target, { button: 2, clientX: 240, clientY: 120, ...init });

    it("is prevented in a cell, and leaves the selection where it was", async () => {
      const { container, editor } = await tableEditor(ABCD);
      caretAt(editor, textAt(editor, "A"));
      expect(press(cellText(container, "d"))).toBe(false);
      expect(caretIn(editor)).toBe("A");
    });

    it("starts no resize drag on an active resize handle, where the left button does", async () => {
      const { container, editor } = await tableEditor(`${TABLE_2X2}<p>z</p>`);
      // As in "refuses a resize handle while locked…": a box for the first
      // header cell and the pointer 2px inside its right edge.
      const firstCell = cellPositions(editor)[0];
      vi.spyOn(editor.view, "posAtCoords").mockReturnValue({ pos: firstCell + 2, inside: firstCell });
      const headerCell = container.querySelector(".tiptap th")!;
      vi.spyOn(headerCell, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 20));
      const cellDom = headerCell.querySelector("p")!;
      fireEvent.mouseMove(cellDom, { clientX: 98, clientY: 10 });
      expect(resizing(editor)?.activeHandle).toBe(firstCell);

      expect(press(cellDom, { clientX: 98, clientY: 10 })).toBe(false);
      expect(resizing(editor)?.dragging).toBeFalsy();

      // The same press with the left button starts one: the handle was live.
      fireEvent.mouseDown(cellDom, { button: 0, clientX: 98, clientY: 10 });
      expect(resizing(editor)?.dragging).toBeTruthy();
      fireEvent.mouseUp(window, { button: 0, clientX: 98, clientY: 10 });
    });

    it.each<[string, Partial<React.ComponentProps<typeof RichTextEditor>>, MouseEventInit, string]>([
      ["with Shift held", {}, { shiftKey: true }, "d"],
      ["in a locked editor", { readOnly: true }, {}, "d"],
      ["on a link", {}, {}, "link"],
      ["outside a table", {}, {}, "z"],
    ])("is not prevented %s", async (_name, props, init, where) => {
      const { container, editor } = await tableEditor(RICH.replace("<p>z</p>", ABCD), props);
      vi.spyOn(editor.view, "posAtCoords").mockReturnValue(null);
      const target =
        where === "link"
          ? container.querySelector('.tiptap td a[href="https://x.io"]')!
          : where === "z"
            ? Array.from(container.querySelectorAll(".tiptap > p")).find((p) => p.textContent === "z")!
            : cellText(container, where);
      expect(press(target, init)).toBe(true);
    });

    it("is not prevented for the left button", async () => {
      const { container, editor } = await tableEditor(ABCD);
      vi.spyOn(editor.view, "posAtCoords").mockReturnValue(null);
      expect(fireEvent.mouseDown(cellText(container, "d"), { button: 0 })).toBe(true);
    });

    it("is not prevented after a touch press", async () => {
      const { container, editor } = await tableEditor(ABCD);
      vi.spyOn(editor.view, "posAtCoords").mockReturnValue(null);
      const d = cellText(container, "d");
      pointerDown(d, "touch");
      expect(press(d)).toBe(true);
    });
  });
});

describe("RichTextEditor table handles", () => {
  /** A header row A B C, body rows d e f and g h i, then a paragraph. */
  const GRID = `${table(3, [
    [th("A"), th("B"), th("C")],
    [td("d"), td("e"), td("f")],
    [td("g"), td("h"), td("i")],
  ])}<p>z</p>`;

  /** The paragraph (`p`) inside the rendered cell whose text is `text`. */
  const cellText = (container: HTMLElement, text: string) => {
    const found = Array.from(container.querySelectorAll(".tiptap td > p, .tiptap th > p")).find(
      (p) => p.textContent === text,
    );
    expect(found, `no cell "${text}"`).toBeDefined();
    return found as HTMLElement;
  };
  /** Every handle drawn: its kind and the text of the cell it sits in. */
  const handles = (container: HTMLElement) =>
    Array.from(container.querySelectorAll(".tiptap [data-table-handle]")).map(
      (el) =>
        `${el.getAttribute("data-table-handle")}@${Array.from(el.parentElement!.children)
          .filter((c) => c.tagName === "P")
          .map((c) => c.textContent)
          .join("")}`,
    );
  /** The handle of `kind` in the cell whose text is `text`. */
  const handle = (container: HTMLElement, kind: string, text: string) => {
    const found = cellText(container, text).parentElement!.querySelector(
      `:scope > [data-table-handle="${kind}"]`,
    );
    expect(found, `no ${kind} handle in "${text}"`).not.toBeNull();
    return found as HTMLElement;
  };
  const hover = (container: HTMLElement, text: string) =>
    fireEvent.mouseMove(cellText(container, text), { clientX: 400, clientY: 400 });
  const actionsMenu = () => screen.queryByRole("menu", { name: "Table actions" });
  const paperOf = (menu: HTMLElement) => menu.closest(".MuiPaper-root") as HTMLElement;
  const menuItems = (menu: HTMLElement) =>
    Array.from(menu.querySelectorAll('[role^="menuitem"]')).map((i) => i.textContent);
  const caretInto = (editor: Editor, text: string) =>
    act(() => {
      editor.commands.setTextSelection(textAt(editor, text));
      editor.view.focus();
    });
  /** The text of every selected cell, in document order. */
  const selectedTexts = (editor: Editor) => {
    const { selection } = editor.state;
    expect(selection).toBeInstanceOf(CellSelection);
    const out: { pos: number; text: string }[] = [];
    (selection as CellSelection).forEachCell((cell, pos) => out.push({ pos, text: cell.textContent }));
    return out.sort((a, b) => a.pos - b.pos).map((c) => c.text);
  };
  /** The position of the cell holding the caret. */
  const caretCell = (editor: Editor) => editor.state.selection.$head.before(-1);
  /** The position of a cell selection's head cell. */
  const headCell = (editor: Editor) => (editor.state.selection as CellSelection).$headCell.pos;

  // `columnResizing` measures every move near a cell's edge (`posAtCoords`),
  // which asks the document what is under the pointer; jsdom has no answer.
  // Focus going back to the editor after a grip's menu scrolls a cell
  // selection into view, which jsdom does not implement.
  beforeEach(() => {
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => null });
    vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  });
  afterEach(() => {
    delete (document as { elementFromPoint?: unknown }).elementFromPoint;
    vi.restoreAllMocks();
  });

  describe("show", () => {
    it("the hovered cell's grips, '+' and append bars, as labelled buttons, reporting no edit", async () => {
      const { container, editor, onChange } = await tableEditor(GRID);
      const html = editor.getHTML();
      expect(handles(container)).toEqual([]);
      hover(container, "e");
      expect(handles(container)).toEqual([
        "column@B",
        "insert-column@B",
        "append-column@C",
        "row@d",
        "insert-row@d",
        "append-column@f",
        "append-row@g",
        "append-row@h",
        "append-row@i",
        "append-column@i",
      ]);
      const named = [
        ["row", "d", "Row actions"],
        ["column", "B", "Column actions"],
        ["insert-row", "d", "Insert a row here"],
        ["insert-column", "B", "Insert a column here"],
        ["append-row", "g", "Add a row at the end"],
        ["append-column", "C", "Add a column at the end"],
      ];
      for (const [kind, text, label] of named) {
        const el = handle(container, kind, text);
        expect(screen.getByRole("button", { name: label })).toBe(el);
        expect(el).toHaveAttribute("title", label);
        expect(el).toHaveAttribute("contenteditable", "false");
        expect(el.querySelector("span")).toHaveAttribute("aria-hidden", "true");
        expect(el.querySelector("span")).toHaveClass("material-symbols-outlined");
      }
      expect(handle(container, "row", "d")).toHaveTextContent("drag_indicator");
      expect(handle(container, "column", "B")).toHaveTextContent("drag_indicator");
      expect(handle(container, "insert-row", "d")).toHaveTextContent("add");
      // The further segments of a bar only widen it.
      for (const [kind, text] of [
        ["append-row", "h"],
        ["append-row", "i"],
        ["append-column", "f"],
        ["append-column", "i"],
      ]) {
        const el = handle(container, kind, text);
        expect(el).toHaveAttribute("aria-hidden", "true");
        expect(el).not.toHaveAttribute("role");
        expect(el).not.toHaveAttribute("aria-label");
      }
      expect(editor.getHTML()).toBe(html);
      expect(onChange).not.toHaveBeenCalled();
    });

    it("follow the pointer, stay over the gutter and go when it leaves the table or the editor", async () => {
      const { container, editor, onChange } = await tableEditor(GRID);
      hover(container, "e");
      const state = tableHandlesKey.getState(editor.state);
      // A move inside the same cell dispatches nothing.
      fireEvent.mouseMove(cellText(container, "e"), { clientX: 410, clientY: 400 });
      expect(tableHandlesKey.getState(editor.state)).toBe(state);
      hover(container, "i");
      expect(handles(container).filter((h) => /^(row|column)@/.test(h))).toEqual(["column@C", "row@g"]);
      // The wrapper's padding (the gutter the handles sit in) keeps them.
      fireEvent.mouseMove(container.querySelector(".tiptap > .tableWrapper")!);
      expect(handles(container)).toContain("row@g");
      // A handle stops every event: a move over it keeps the hover too.
      fireEvent.mouseMove(handle(container, "row", "g"));
      expect(handles(container)).toContain("row@g");
      const z = Array.from(container.querySelectorAll(".tiptap > p")).find((p) => p.textContent === "z")!;
      fireEvent.mouseMove(z);
      expect(handles(container)).toEqual([]);
      hover(container, "e");
      expect(handles(container)).toContain("row@d");
      fireEvent.mouseLeave(container.querySelector(".tiptap")!);
      expect(handles(container)).toEqual([]);
      expect(onChange).not.toHaveBeenCalled();
    });

    it("at the caret without a hover while the editor has the focus, and not once it is blurred", async () => {
      const { container, editor, onChange } = await tableEditor(GRID);
      act(() => {
        editor.commands.setTextSelection(textAt(editor, "e"));
      });
      expect(handles(container)).toEqual([]);
      caretInto(editor, "e");
      expect(handles(container)).toContain("row@d");
      expect(handles(container)).toContain("column@B");
      // The hovered row and the caret's row each show their grip.
      hover(container, "i");
      expect(handles(container).filter((h) => /^(row|column)@/.test(h))).toEqual([
        "column@B",
        "column@C",
        "row@d",
        "row@g",
      ]);
      fireEvent.mouseLeave(container.querySelector(".tiptap")!);
      act(() => {
        (editor.view.dom as HTMLElement).blur();
      });
      expect(handles(container)).toEqual([]);
      expect(onChange).not.toHaveBeenCalled();
    });

    it("none in a locked editor, from the start or after locking with the caret in a table", async () => {
      const locked = await tableEditor(GRID, { readOnly: true });
      hover(locked.container, "e");
      expect(handles(locked.container)).toEqual([]);
      expect(tableHandlesKey.getState(locked.editor.state)?.hover).toBeNull();
      locked.unmount();

      const { container, editor, onChange, rerender } = await tableEditor(GRID);
      caretInto(editor, "e");
      hover(container, "e");
      expect(handles(container)).toContain("row@d");
      rerender(<RichTextEditor content={GRID} onChange={onChange} readOnly />);
      expect(handles(container)).toEqual([]);
      hover(container, "i");
      expect(handles(container)).toEqual([]);
      // Unlocked again: the hover from before the lock is forgotten.
      rerender(<RichTextEditor content={GRID} onChange={onChange} />);
      act(() => {
        (editor.view.dom as HTMLElement).blur();
      });
      expect(handles(container)).toEqual([]);
      hover(container, "h");
      expect(handles(container)).toContain("row@g");
      expect(onChange).not.toHaveBeenCalled();
    });

    it("none in a comment, which has no tables", async () => {
      const { container } = await tableEditor(GRID, { variant: "comment" });
      fireEvent.mouseMove(container.querySelector(".tiptap p")!);
      expect(container.querySelector("[data-table-handle]")).toBeNull();
    });
  });

  describe("a grip", () => {
    it("on a row selects the row and opens the row menu at the grip, Header row on the first row only", async () => {
      const { container, editor, onChange } = await tableEditor(GRID);
      const html = editor.getHTML();
      hover(container, "e");
      const grip = handle(container, "row", "d");
      vi.spyOn(grip, "getBoundingClientRect").mockReturnValue(new DOMRect(30, 50, 10, 24));
      const focus = vi.spyOn(editor.view, "focus");
      expect(fireEvent.click(grip)).toBe(false);
      expect(focus).toHaveBeenCalled();
      expect((editor.state.selection as CellSelection).isRowSelection()).toBe(true);
      expect(selectedTexts(editor)).toEqual(["d", "e", "f"]);
      // The grip's cell stays the selection's head, so its handles stay put.
      expect(headCell(editor)).toBe(textAt(editor, "d") - 2);
      const menu = await screen.findByRole("menu", { name: "Table actions" });
      expect(paperOf(menu).style.top).toBe("74px");
      expect(paperOf(menu).style.left).toBe("30px");
      expect(menuItems(menu)).toEqual([
        "Add row above",
        "Add row below",
        "Move row up",
        "Move row down",
        "Delete row",
      ]);
      fireEvent.keyDown(menu, { key: "Escape" });
      await waitFor(() => expect(actionsMenu()).not.toBeInTheDocument());
      await waitFor(() => expect(editor.view.dom).toHaveFocus());

      hover(container, "B");
      fireEvent.click(handle(container, "row", "A"));
      expect(selectedTexts(editor)).toEqual(["A", "B", "C"]);
      const first = await screen.findByRole("menu", { name: "Table actions" });
      expect(within(first).getByTestId("table-toggleHeaderRow")).toHaveTextContent("Header row");
      expect(within(first).getByTestId("table-toggleHeaderRow")).toHaveAttribute("aria-checked", "true");
      fireEvent.keyDown(first, { key: "Escape" });
      await waitFor(() => expect(actionsMenu()).not.toBeInTheDocument());
      expect(editor.getHTML()).toBe(html);
      expect(onChange).not.toHaveBeenCalled();
    });

    it("on a column selects the column and opens the column menu at the grip", async () => {
      const { container, editor, onChange } = await tableEditor(GRID);
      hover(container, "h");
      const grip = handle(container, "column", "B");
      vi.spyOn(grip, "getBoundingClientRect").mockReturnValue(new DOMRect(90, 12, 60, 10));
      fireEvent.click(grip);
      expect((editor.state.selection as CellSelection).isColSelection()).toBe(true);
      expect(selectedTexts(editor)).toEqual(["B", "e", "h"]);
      expect(headCell(editor)).toBe(textAt(editor, "B") - 2);
      const menu = await screen.findByRole("menu", { name: "Table actions" });
      expect(paperOf(menu).style.top).toBe("22px");
      expect(paperOf(menu).style.left).toBe("90px");
      expect(menuItems(menu)).toEqual([
        "Add column before",
        "Add column after",
        "Move column before",
        "Move column after",
        "Delete column",
      ]);
      // An action from it acts on the grip's column.
      fireEvent.click(within(menu).getByTestId("table-deleteColumn"));
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenLastCalledWith(
        `${table(2, [[th("A"), th("C")], [td("d"), td("f")], [td("g"), td("i")]])}<p>z</p>`,
      );
    });

    it("on a cell merged across two rows stands for both", async () => {
      const { container, editor } = await tableEditor(`${TABLE_ROWSPAN}<p>z</p>`);
      const cells = cellPositions(editor);
      fireEvent.mouseMove(container.querySelectorAll(".tiptap td")[2], { clientX: 400, clientY: 400 });
      const grips = container.querySelectorAll('.tiptap [data-table-handle="row"]');
      expect(grips).toHaveLength(1);
      expect(editor.view.posAtDOM(grips[0].parentElement!, 0) - 1).toBe(cells[2]);
      fireEvent.click(grips[0]);
      expect(selectedTexts(editor)).toHaveLength(3);
      const menu = await screen.findByRole("menu", { name: "Table actions" });
      expect(within(menu).getByTestId("table-deleteRow")).toHaveTextContent("Delete 2 rows");
    });

    it("on a header cell merged across two columns stands for both", async () => {
      const { container, editor } = await tableEditor(`${TABLE_COLSPAN_HEADER}<p>z</p>`);
      fireEvent.mouseMove(container.querySelectorAll(".tiptap td")[1], { clientX: 400, clientY: 400 });
      const grips = container.querySelectorAll('.tiptap [data-table-handle="column"]');
      expect(grips).toHaveLength(1);
      expect(grips[0].parentElement!.tagName).toBe("TH");
      fireEvent.click(grips[0]);
      expect((editor.state.selection as CellSelection).isColSelection()).toBe(true);
      const menu = await screen.findByRole("menu", { name: "Table actions" });
      expect(within(menu).getByTestId("table-deleteColumn")).toHaveTextContent("Delete 2 columns");
    });

    it("opens its menu on a right-click too, and keeps the browser's menu on a '+'", async () => {
      const { container, editor } = await tableEditor(GRID);
      hover(container, "e");
      const plus = handle(container, "insert-row", "d");
      expect(fireEvent.contextMenu(plus, { button: 2, clientX: 240, clientY: 120 })).toBe(true);
      expect(actionsMenu()).not.toBeInTheDocument();
      expect(editor.state.selection).not.toBeInstanceOf(CellSelection);
      const grip = handle(container, "row", "d");
      vi.spyOn(grip, "getBoundingClientRect").mockReturnValue(new DOMRect(30, 50, 10, 24));
      expect(fireEvent.contextMenu(grip, { button: 2, clientX: 240, clientY: 120 })).toBe(false);
      expect(selectedTexts(editor)).toEqual(["d", "e", "f"]);
      const menu = await screen.findByRole("menu", { name: "Table actions" });
      // The grip's menu at the grip, not the right-click menu at the pointer.
      expect(menuItems(menu)[0]).toBe("Add row above");
      expect(paperOf(menu).style.top).toBe("74px");
      expect(paperOf(menu).style.left).toBe("30px");
    });

    it("keeps the handles of the caret's cell while its menu has the focus", async () => {
      const { container, editor } = await tableEditor(GRID);
      hover(container, "e");
      fireEvent.click(handle(container, "column", "B"));
      await screen.findByRole("menu", { name: "Table actions" });
      fireEvent.mouseLeave(container.querySelector(".tiptap")!);
      await waitFor(() => expect(editor.view.dom).not.toHaveFocus());
      act(() => {
        editor.view.dispatch(editor.state.tr);
      });
      expect(handles(container)).toContain("column@B");
    });

    it("does nothing once it is no longer drawn", async () => {
      const { container, editor, onChange } = await tableEditor(GRID);
      hover(container, "e");
      const grip = handle(container, "row", "d");
      const plus = handle(container, "insert-row", "d");
      fireEvent.mouseLeave(container.querySelector(".tiptap")!);
      expect(grip.isConnected).toBe(false);
      fireEvent.click(grip);
      fireEvent.click(plus);
      await act(async () => {});
      expect(actionsMenu()).not.toBeInTheDocument();
      expect(editor.state.selection).not.toBeInstanceOf(CellSelection);
      expect(onChange).not.toHaveBeenCalled();
    });

    it("does nothing once the editor is locked", async () => {
      const { container, editor, onChange, rerender } = await tableEditor(GRID);
      hover(container, "e");
      const grip = handle(container, "row", "d");
      const plus = handle(container, "insert-row", "d");
      rerender(<RichTextEditor content={GRID} onChange={onChange} readOnly />);
      fireEvent.click(grip);
      expect(fireEvent.contextMenu(grip, { button: 2, clientX: 240, clientY: 120 })).toBe(true);
      fireEvent.click(plus);
      await act(async () => {});
      expect(actionsMenu()).not.toBeInTheDocument();
      expect(editor.state.selection).not.toBeInstanceOf(CellSelection);
      expect(editor.getHTML()).toBe(GRID);
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("a press on a handle", () => {
    it("is prevented, keeping the focus and the selection, and starts no cell selection or resize", async () => {
      const { container, editor } = await tableEditor(`${TABLE_2X2}<p>z</p>`);
      const resizing = () => columnResizingPluginKey.getState(editor.state);
      // As in "starts no resize drag on an active resize handle…": the
      // pointer 2px inside the first header cell's right edge.
      const firstCell = cellPositions(editor)[0];
      vi.spyOn(editor.view, "posAtCoords").mockReturnValue({ pos: firstCell + 2, inside: firstCell });
      const headerCell = container.querySelector(".tiptap th")!;
      vi.spyOn(headerCell, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 20));
      fireEvent.mouseMove(headerCell.querySelector("p")!, { clientX: 98, clientY: 10 });
      expect(resizing()?.activeHandle).toBe(firstCell);
      act(() => {
        editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      });
      const before = editor.state.selection;

      for (const kind of ["column", "insert-column", "row"]) {
        const el = headerCell.querySelector(`:scope > [data-table-handle="${kind}"]`)!;
        expect(el, kind).not.toBeNull();
        expect(fireEvent.pointerDown(el, { button: 0 })).toBe(false);
        expect(fireEvent.mouseDown(el, { button: 0, clientX: 98, clientY: 10 })).toBe(false);
        expect(resizing()?.dragging).toBeFalsy();
        expect(tableEditingKey.getState(editor.state)).toBeNull();
        expect(editor.state.selection.eq(before)).toBe(true);
        expect(editor.view.dom).not.toHaveFocus();
        fireEvent.mouseUp(el, { button: 0 });
      }
      // Leaving the editor still reaches the resize plugin.
      fireEvent.mouseLeave(container.querySelector(".tiptap")!);
      expect(resizing()?.activeHandle).toBe(-1);
    });
  });

  describe("'+'", () => {
    it("between rows inserts a row after the hovered row, the caret in its first cell, one undo step", async () => {
      const { container, editor, onChange } = await tableEditor(GRID);
      hover(container, "e");
      expect(fireEvent.click(handle(container, "insert-row", "d"))).toBe(false);
      const inserted = `${table(3, [
        [th("A"), th("B"), th("C")],
        [td("d"), td("e"), td("f")],
        [td(), td(), td()],
        [td("g"), td("h"), td("i")],
      ])}<p>z</p>`;
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenLastCalledWith(inserted);
      expect(caretCell(editor)).toBe(cellPositions(editor)[6]);
      expect(editor.state.selection.empty).toBe(true);
      expect(editor.view.dom).toHaveFocus();
      act(() => {
        editor.commands.undo();
      });
      expect(editor.getHTML()).toBe(GRID);
    });

    it("between rows goes after the last row a merged first-column cell spans", async () => {
      const content = `${table(2, [
        [th("A"), th("B")],
        ['<td colspan="1" rowspan="2"><p>m</p></td>', td("b")],
        [td("c")],
        [td("d"), td("e")],
      ])}<p>z</p>`;
      const { container, editor, onChange } = await tableEditor(content);
      hover(container, "b");
      fireEvent.click(handle(container, "insert-row", "m"));
      expect(onChange).toHaveBeenLastCalledWith(
        `${table(2, [
          [th("A"), th("B")],
          ['<td colspan="1" rowspan="2"><p>m</p></td>', td("b")],
          [td("c")],
          [td(), td()],
          [td("d"), td("e")],
        ])}<p>z</p>`,
      );
      expect(caretCell(editor)).toBe(cellPositions(editor)[5]);
    });

    it("between columns inserts a column after the hovered column, a header cell on the header row", async () => {
      const { container, editor, onChange } = await tableEditor(GRID);
      hover(container, "e");
      fireEvent.click(handle(container, "insert-column", "B"));
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenLastCalledWith(
        `${table(4, [
          [th("A"), th("B"), th(), th("C")],
          [td("d"), td("e"), td(), td("f")],
          [td("g"), td("h"), td(), td("i")],
        ])}<p>z</p>`,
      );
      expect(caretCell(editor)).toBe(cellPositions(editor)[2]);
      act(() => {
        editor.commands.undo();
      });
      expect(editor.getHTML()).toBe(GRID);
    });
  });

  it("sit in a gutter the wrapper keeps whether the editor is locked or not", async () => {
    for (const readOnly of [false, true]) {
      const { container, unmount } = await tableEditor(GRID, { readOnly });
      const wrapper = container.querySelector(".tiptap > .tableWrapper") as HTMLElement;
      const style = getComputedStyle(wrapper);
      expect([style.paddingTop, style.paddingBottom, style.boxSizing]).toEqual(["16px", "16px", "border-box"]);
      expect(style.maxWidth).toBe("calc(100% + 16px)");
      unmount();
    }
  });

  describe("the append bars", () => {
    it("under the table add a row at the end from any segment, the caret in its first cell", async () => {
      for (const segment of ["g", "i"]) {
        const { container, editor, onChange, unmount } = await tableEditor(GRID);
        hover(container, "e");
        fireEvent.click(handle(container, "append-row", segment));
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenLastCalledWith(
          `${table(3, [
            [th("A"), th("B"), th("C")],
            [td("d"), td("e"), td("f")],
            [td("g"), td("h"), td("i")],
            [td(), td(), td()],
          ])}<p>z</p>`,
        );
        expect(caretCell(editor)).toBe(cellPositions(editor)[9]);
        act(() => {
          editor.commands.undo();
        });
        expect(editor.getHTML()).toBe(GRID);
        unmount();
      }
    });

    it("after the table add a column at the end, the caret in its first cell", async () => {
      const { container, editor, onChange } = await tableEditor(GRID);
      hover(container, "e");
      fireEvent.click(handle(container, "append-column", "f"));
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenLastCalledWith(
        `${table(4, [
          [th("A"), th("B"), th("C"), th()],
          [td("d"), td("e"), td("f"), td()],
          [td("g"), td("h"), td("i"), td()],
        ])}<p>z</p>`,
      );
      expect(caretCell(editor)).toBe(cellPositions(editor)[3]);
      act(() => {
        editor.commands.undo();
      });
      expect(editor.getHTML()).toBe(GRID);
    });
  });
});
