/**
 * Each section with an edit mode reports it through `onEditingChange` — open
 * (`true`) and closed (`false`), whether or not anything was typed — so card
 * detail can hold a live re-read while a form is open. Omitting the prop
 * changes nothing.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() },
  ApiError: class extends Error {},
}));
vi.mock("@/components/VendorField", () => ({
  default: ({ value }: { value: string }) => <input aria-label="Vendor" defaultValue={value} />,
}));
vi.mock("@/hooks/useCurrency", () => ({
  useCurrency: () => ({ fmt: (n: number) => String(n), fmtShort: (n: number) => String(n), symbol: "$" }),
}));
vi.mock("@/hooks/useDateFormat", () => ({
  useDateFormat: () => ({ formatDate: (v: string) => `d:${v}` }),
}));

import { api } from "@/api/client";
import i18n from "@/i18n";
import type { Card, SectionDef } from "@/types";
import AttributeSection from "./AttributeSection";
import DescriptionSection from "./DescriptionSection";
import LifecycleSection from "./LifecycleSection";
import TagsSection from "./TagsSection";

const card = {
  id: "card-1",
  type: "Application",
  name: "App",
  description: "Text",
  attributes: { a: "x" },
  lifecycle: { active: "2024-01-01" },
  tags: [],
} as unknown as Card;

const section: SectionDef & { columns?: 1 | 2 } = {
  section: "Digital",
  columns: 1,
  fields: [{ key: "a", label: "Alpha", type: "text" }],
};

const save = () => i18n.t("common:actions.save");
const cancel = () => i18n.t("common:actions.cancel");
/** The pencil renders the "edit" ligature. */
const pencil = () => screen.getByText("edit");

beforeEach(() => {
  // AttributeSection snaps its header into view after a save; jsdom has no layout.
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(api.get).mockReset();
  vi.mocked(api.get).mockResolvedValue([]);
});

const cases = [
  {
    name: "DescriptionSection",
    renderIt: (onEditingChange?: (e: boolean) => void, onSave = async () => {}) =>
      render(<DescriptionSection card={card} onSave={onSave} onEditingChange={onEditingChange} />),
  },
  {
    name: "LifecycleSection",
    renderIt: (onEditingChange?: (e: boolean) => void, onSave = async () => {}) =>
      render(<LifecycleSection card={card} onSave={onSave} onEditingChange={onEditingChange} />),
  },
  {
    name: "AttributeSection",
    renderIt: (onEditingChange?: (e: boolean) => void, onSave = async () => {}) =>
      render(
        <AttributeSection
          section={section}
          card={card}
          onSave={onSave}
          initialExpanded
          onEditingChange={onEditingChange}
        />,
      ),
  },
];

describe.each(cases)("$name — onEditingChange", ({ renderIt }) => {
  it("reports edit mode opening and closing, with nothing typed", () => {
    const onEditingChange = vi.fn();
    renderIt(onEditingChange);
    expect(onEditingChange.mock.calls).toEqual([[false]]);

    fireEvent.click(pencil());
    expect(onEditingChange).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByRole("button", { name: cancel() }));
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
  });

  it("reports edit mode closing after a save", async () => {
    const onEditingChange = vi.fn();
    const onSave = vi.fn(async () => {});
    renderIt(onEditingChange, onSave);
    fireEvent.click(pencil());
    expect(onEditingChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: save() }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onEditingChange).toHaveBeenLastCalledWith(false));
  });

  it("reports false on unmount while editing", () => {
    const onEditingChange = vi.fn();
    const { unmount } = renderIt(onEditingChange);
    fireEvent.click(pencil());
    unmount();
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
  });

  it("works unchanged without the prop", () => {
    renderIt(undefined);
    fireEvent.click(pencil());
    expect(screen.getByRole("button", { name: save() })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: cancel() }));
    expect(screen.queryByRole("button", { name: save() })).not.toBeInTheDocument();
  });
});

describe("TagsSection — onEditingChange", () => {
  const GROUP = {
    id: "g1",
    name: "Domain",
    mode: "multi",
    mandatory: false,
    restrict_to_types: null,
    tags: [{ id: "t1", name: "Finance", color: null, tag_group_id: "g1" }],
  };

  it("reports the tag editor opening and closing", async () => {
    vi.mocked(api.get).mockResolvedValue([GROUP]);
    const onEditingChange = vi.fn();
    render(<TagsSection card={card} onUpdate={() => {}} onEditingChange={onEditingChange} />);
    expect(onEditingChange.mock.calls).toEqual([[false]]);

    fireEvent.click(await screen.findByRole("button", { name: "Edit tags" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(onEditingChange).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByRole("button", { name: cancel() }));
    await waitFor(() => expect(onEditingChange).toHaveBeenLastCalledWith(false));
  });

  it("opens the editor without the prop", async () => {
    vi.mocked(api.get).mockResolvedValue([GROUP]);
    render(<TagsSection card={card} onUpdate={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit tags" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
