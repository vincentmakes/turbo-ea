import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";

// TipTap has no place in jsdom: a textarea carries the same contract.
// It takes the focus on each new `focusRequest`, as the real editor does
// (`RichTextEditor.test.tsx` covers that half).
vi.mock("../RichTextEditor", async () => {
  const { useEffect, useRef } = await import("react");
  return {
    default: function Editor(props: {
      content: string;
      onChange: (v: string) => void;
      placeholder?: string;
      focusRequest?: number;
    }) {
      const ref = useRef<HTMLTextAreaElement | null>(null);
      const focusRequest = props.focusRequest ?? 0;
      useEffect(() => {
        if (focusRequest > 0) ref.current?.focus();
      }, [focusRequest]);
      return (
        <textarea
          ref={ref}
          aria-label={props.placeholder}
          data-focus-request={focusRequest}
          value={props.content}
          onChange={(e) => props.onChange(e.target.value)}
        />
      );
    },
  };
});

import { renderWithProviders } from "@/test/render";
import CommentComposer from "./CommentComposer";
import { clearAllDrafts, readDraft, writeDraft } from "./commentDrafts";
import { GENERAL_SECTION, type SectionOption } from "./discussionModel";

const SHORT: SectionOption[] = [
  { key: GENERAL_SECTION, label: "General" },
  { key: "context", label: "Context" },
  { key: "decision", label: "Decision" },
];
const LONG: SectionOption[] = [
  { key: GENERAL_SECTION, label: "General" },
  ...["1.1 Scope", "1.2 Vision", "2.1 Objectives", "2.2 Constraints", "3.1 Process", "4.1 Baseline", "4.2 Target"].map(
    (label, i) => ({ key: `s${i + 1}`, label }),
  ),
];

function renderComposer(props: Partial<React.ComponentProps<typeof CommentComposer>> = {}) {
  const onSubmit = vi.fn(async () => undefined);
  const view = renderWithProviders(
    <CommentComposer placeholder="Start a thread" submitLabel="Post" onSubmit={onSubmit} {...props} />,
  );
  const type = (value: string) =>
    fireEvent.change(screen.getByRole("textbox", { name: "Start a thread" }), { target: { value } });
  return { ...view, onSubmit, type };
}

const group = () => within(screen.getByRole("group", { name: "Section" }));
const chipNames = () =>
  group()
    .getAllByRole("button")
    .map((b) => b.querySelector(".MuiChip-label")?.textContent);
const pressed = (name: string) => group().getByRole("button", { name }).getAttribute("aria-pressed");

beforeEach(() => clearAllDrafts());

describe("CommentComposer section chips", () => {
  it("chooses one section, moves the choice, and clears it by clicking it again", async () => {
    const { user, onSubmit, type } = renderComposer({ sections: SHORT });
    expect(chipNames()).toEqual(["Context", "Decision"]);
    expect(pressed("Context")).toBe("false");

    await user.click(group().getByRole("button", { name: "Context" }));
    expect(pressed("Context")).toBe("true");
    await user.click(group().getByRole("button", { name: "Decision" }));
    expect(pressed("Context")).toBe("false");
    expect(pressed("Decision")).toBe("true");

    type("<p>Why?</p>");
    await user.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("<p>Why?</p>", "decision"));

    await user.click(group().getByRole("button", { name: "Decision" }));
    expect(pressed("Decision")).toBe("false");
    type("<p>Again</p>");
    await user.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() => expect(onSubmit).toHaveBeenLastCalledWith("<p>Again</p>", ""));
  });

  it("is reachable from the keyboard", async () => {
    const { user } = renderComposer({ sections: SHORT });
    group().getByRole("button", { name: "Context" }).focus();
    await user.keyboard("{Enter}");
    expect(pressed("Context")).toBe("true");
  });

  it("has no chips on a reply or an edit", () => {
    renderComposer({ initialBody: "<p>x</p>" });
    expect(screen.queryByRole("group", { name: "Section" })).toBeNull();
  });

  it("shows a long list's used sections and keeps the rest behind More…, searchable", async () => {
    const { user } = renderComposer({ sections: LONG, usedSections: ["s4", null, "s2"] });
    expect(chipNames()).toEqual(["1.2 Vision", "2.2 Constraints", "More…"]);

    await user.click(group().getByRole("button", { name: /More…/ }));
    const search = await screen.findByRole("combobox", { name: "Find a section" });
    expect(search).toHaveFocus();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "1.1 Scope",
      "2.1 Objectives",
      "3.1 Process",
      "4.1 Baseline",
      "4.2 Target",
    ]);
    await user.type(search, "targ");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["4.2 Target"]);
    await user.click(screen.getByRole("option", { name: "4.2 Target" }));

    await waitFor(() => expect(screen.queryByRole("combobox", { name: "Find a section" })).toBeNull());
    expect(chipNames()).toEqual([
      "1.2 Vision",
      "2.2 Constraints",
      "4.2 Target",
      "More…",
    ]);
    expect(pressed("4.2 Target")).toBe("true");
  });

  it("closes the More… list on Escape without picking, and puts focus back on More…", async () => {
    const { user } = renderComposer({ sections: LONG, usedSections: ["s4"] });
    await user.click(group().getByRole("button", { name: /More…/ }));
    const search = await screen.findByRole("combobox", { name: "Find a section" });
    expect(search).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("combobox", { name: "Find a section" })).toBeNull());
    expect(chipNames()).toEqual(["2.2 Constraints", "More…"]);
    expect(pressed("2.2 Constraints")).toBe("false");
    await waitFor(() => expect(group().getByRole("button", { name: /More…/ })).toHaveFocus());
  });

  it("closes the More… list on a click away, and puts focus back on More…", async () => {
    const { user } = renderComposer({ sections: LONG, usedSections: ["s4"] });
    await user.click(group().getByRole("button", { name: /More…/ }));
    await screen.findByRole("combobox", { name: "Find a section" });
    const backdrop = document.querySelector(".MuiPopover-root .MuiBackdrop-root") as HTMLElement;
    await user.click(backdrop);
    await waitFor(() => expect(screen.queryByRole("combobox", { name: "Find a section" })).toBeNull());
    await waitFor(() => expect(group().getByRole("button", { name: /More…/ })).toHaveFocus());
  });

  it("puts focus on the chip of the section just chosen from More…", async () => {
    const { user } = renderComposer({ sections: LONG, usedSections: ["s4"] });
    await user.click(group().getByRole("button", { name: /More…/ }));
    const search = await screen.findByRole("combobox", { name: "Find a section" });
    await user.type(search, "scope");
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(screen.queryByRole("combobox", { name: "Find a section" })).toBeNull());
    expect(pressed("1.1 Scope")).toBe("true");
    await waitFor(() => expect(group().getByRole("button", { name: "1.1 Scope" })).toHaveFocus());
  });

  it("keeps the chosen section in the draft and restores it", async () => {
    const first = renderComposer({ sections: SHORT, draftKey: "adr:a1:new" });
    await first.user.click(group().getByRole("button", { name: "Decision" }));
    first.type("<p>Half</p>");
    expect(readDraft("adr:a1:new")).toEqual({ body: "<p>Half</p>", section: "decision" });
    first.unmount();

    renderComposer({ sections: SHORT, draftKey: "adr:a1:new" });
    expect(pressed("Decision")).toBe("true");
    expect(screen.getByRole("textbox", { name: "Start a thread" })).toHaveValue("<p>Half</p>");
  });

  it("drops a kept section the document no longer has, or General, and starts general", () => {
    writeDraft("k1", { body: "", section: "gone" });
    const a = renderComposer({ sections: SHORT, draftKey: "k1" });
    expect(group().queryByRole("button", { pressed: true })).toBeNull();
    a.unmount();
    writeDraft("k2", { body: "", section: GENERAL_SECTION });
    renderComposer({ sections: SHORT, draftKey: "k2" });
    expect(group().queryByRole("button", { pressed: true })).toBeNull();
  });
});

describe("CommentComposer section request (a section marker)", () => {
  type Request = { section: string; request: number } | null;

  /** The composer with buttons that send requests, as the shared view does. */
  function Harness(props: Partial<React.ComponentProps<typeof CommentComposer>> & { onApplied?: () => void }) {
    const { onApplied, ...rest } = props;
    const [req, setReq] = useState<Request>(null);
    const [n, setN] = useState(0);
    const ask = (section: string) => {
      setN(n + 1);
      setReq({ section, request: n + 1 });
    };
    return (
      <>
        <button type="button" onClick={() => ask("decision")}>
          ask decision
        </button>
        <button type="button" onClick={() => ask("s6")}>
          ask s6
        </button>
        <button type="button" onClick={() => ask("gone")}>
          ask gone
        </button>
        <button type="button" onClick={() => ask(GENERAL_SECTION)}>
          ask general
        </button>
        <CommentComposer
          placeholder="Start a thread"
          submitLabel="Post"
          onSubmit={async () => undefined}
          sectionRequest={req}
          onSectionRequestApplied={() => {
            onApplied?.();
            setReq(null);
          }}
          {...rest}
        />
      </>
    );
  }

  const editor = () => screen.getByRole("textbox", { name: "Start a thread" });

  it("chooses the section, keeps the text typed, writes the draft and takes the focus", async () => {
    const onApplied = vi.fn();
    const { user } = renderWithProviders(
      <Harness sections={SHORT} draftKey="adr:a1:new" onApplied={onApplied} />,
    );
    fireEvent.change(editor(), { target: { value: "<p>Half</p>" } });
    expect(editor()).not.toHaveFocus();
    await user.click(screen.getByRole("button", { name: "ask decision" }));
    expect(pressed("Decision")).toBe("true");
    expect(pressed("Context")).toBe("false");
    expect(editor()).toHaveValue("<p>Half</p>");
    expect(readDraft("adr:a1:new")).toEqual({ body: "<p>Half</p>", section: "decision" });
    await waitFor(() => expect(editor()).toHaveFocus());
    expect(editor()).toHaveAttribute("data-focus-request", "1");
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it("applies the same section asked twice, over a chip the reader changed in between", async () => {
    const { user } = renderWithProviders(<Harness sections={SHORT} />);
    await user.click(screen.getByRole("button", { name: "ask decision" }));
    expect(pressed("Decision")).toBe("true");
    await user.click(group().getByRole("button", { name: "Context" }));
    expect(pressed("Context")).toBe("true");
    await user.click(screen.getByRole("button", { name: "ask decision" }));
    expect(pressed("Decision")).toBe("true");
    expect(pressed("Context")).toBe("false");
    expect(editor()).toHaveAttribute("data-focus-request", "2");
  });

  it("leaves a chip the reader picks after a request alone on later renders", async () => {
    const onApplied = vi.fn();
    const { user } = renderWithProviders(<Harness sections={SHORT} onApplied={onApplied} />);
    await user.click(screen.getByRole("button", { name: "ask decision" }));
    await user.click(group().getByRole("button", { name: "Context" }));
    fireEvent.change(editor(), { target: { value: "<p>Typed</p>" } });
    expect(pressed("Context")).toBe("true");
    expect(pressed("Decision")).toBe("false");
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it("ignores a section the document does not offer, and General", async () => {
    const onApplied = vi.fn();
    const { user } = renderWithProviders(<Harness sections={SHORT} draftKey="k9" onApplied={onApplied} />);
    await user.click(group().getByRole("button", { name: "Context" }));
    await user.click(screen.getByRole("button", { name: "ask gone" }));
    expect(pressed("Context")).toBe("true");
    await user.click(screen.getByRole("button", { name: "ask general" }));
    expect(pressed("Context")).toBe("true");
    expect(readDraft("k9")).toEqual({ body: "", section: "context" });
    expect(editor()).toHaveAttribute("data-focus-request", "0");
    expect(editor()).not.toHaveFocus();
    // Each request is still answered, so it is cleared.
    expect(onApplied).toHaveBeenCalledTimes(2);
  });

  it("shows the chosen section's chip, pressed, in a long list", async () => {
    const { user } = renderWithProviders(<Harness sections={LONG} usedSections={["s4"]} />);
    expect(chipNames()).toEqual(["2.2 Constraints", "More…"]);
    await user.click(screen.getByRole("button", { name: "ask s6" }));
    expect(chipNames()).toEqual(["2.2 Constraints", "4.1 Baseline", "More…"]);
    expect(pressed("4.1 Baseline")).toBe("true");
  });

  it("posts the thread with the section asked for, and does not ask the fresh editor for the focus", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const { user } = renderWithProviders(<Harness sections={SHORT} onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: "ask decision" }));
    fireEvent.change(editor(), { target: { value: "<p>Why?</p>" } });
    await user.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("<p>Why?</p>", "decision"));
    await waitFor(() => expect(editor()).toHaveValue(""));
    expect(editor()).toHaveAttribute("data-focus-request", "0");
  });

  it("does nothing on a reply or an edit (no sections)", async () => {
    const onApplied = vi.fn();
    const { user } = renderWithProviders(<Harness initialBody="<p>x</p>" draftKey="r1" onApplied={onApplied} />);
    await user.click(screen.getByRole("button", { name: "ask decision" }));
    expect(screen.queryByRole("group", { name: "Section" })).toBeNull();
    expect(editor()).toHaveAttribute("data-focus-request", "0");
    expect(readDraft("r1")).toBeUndefined();
    expect(onApplied).not.toHaveBeenCalled();
  });
});

