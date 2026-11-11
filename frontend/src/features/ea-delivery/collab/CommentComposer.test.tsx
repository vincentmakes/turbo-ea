import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

// TipTap has no place in jsdom: a textarea carries the same contract.
vi.mock("../RichTextEditor", () => ({
  default: (props: { content: string; onChange: (v: string) => void; placeholder?: string }) => (
    <textarea aria-label={props.placeholder} value={props.content} onChange={(e) => props.onChange(e.target.value)} />
  ),
}));

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
