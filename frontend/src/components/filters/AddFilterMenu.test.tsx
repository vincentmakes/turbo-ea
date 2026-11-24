import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { FilterCatalog } from "@/lib/fieldFilters";
import AddFilterMenu from "./AddFilterMenu";

interface Field {
  key: string;
  label: string;
  type: string;
}

const entry = (key: string, label: string) => ({
  field: { key, label, type: "single_select" } as Field,
  kind: "facet" as const,
  shownByDefault: false,
});

const SECTIONS: FilterCatalog<Field> = [
  {
    key: "Business",
    label: "Business",
    hidden: false,
    fields: [entry("owner", "Owner risk"), entry("risk", "Risk"), entry("prisk", "Prisk"), entry("reg", "Risk register")],
  },
  { key: "Compliance", label: "Compliance", hidden: true, fields: [entry("ai", "AI Act Class")] },
];

function open(onAdd = vi.fn()) {
  render(<AddFilterMenu sections={SECTIONS} onAdd={onAdd} />);
  fireEvent.click(screen.getByText("Add filter"));
  return { onAdd, search: screen.getByRole("textbox", { name: "Search fields" }) };
}

const optionNames = () => screen.getAllByRole("option").map((o) => o.textContent);

describe("AddFilterMenu", () => {
  it("opens on the chip with the search focused, every field under its section heading", () => {
    const { search } = open();
    expect(search).toHaveFocus();
    const listbox = screen.getByRole("listbox", { name: "Add filter" });
    expect(within(listbox).getByRole("group", { name: "Business" })).toBeInTheDocument();
    expect(within(listbox).getByRole("group", { name: "Compliance" })).toBeInTheDocument();
    expect(optionNames()).toEqual(["Owner risk", "Risk", "Prisk", "Risk register", "AI Act Class"]);
    // The kind glyph is decoration, not part of the option's name.
    expect(screen.getByRole("option", { name: "Risk" })).toBeInTheDocument();
    expect(screen.getAllByText("checklist")).toHaveLength(5);
  });

  it("ranks the raw input: exact, then starts with, then starts a word, then contains", () => {
    const { search } = open();
    fireEvent.change(search, { target: { value: "risk" } });
    expect(optionNames()).toEqual(["Risk", "Risk register", "Owner risk", "Prisk"]);
    expect(screen.queryByRole("group", { name: "Compliance" })).not.toBeInTheDocument();
  });

  it("matches on the section's label as well as the field's", () => {
    const { search } = open();
    fireEvent.change(search, { target: { value: "compl" } });
    expect(optionNames()).toEqual(["AI Act Class"]);
  });

  it("says so when no field matches, and the clear button brings the list back", () => {
    const { search } = open();
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText("No field matches")).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(search).toHaveValue("");
    expect(optionNames()).toHaveLength(5);
  });

  it("offers no clear button on an empty search", () => {
    open();
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
  });

  it("adds the clicked field and closes", async () => {
    const { onAdd } = open();
    fireEvent.click(screen.getByRole("option", { name: "AI Act Class" }));
    expect(onAdd).toHaveBeenCalledWith("ai");
    expect(onAdd).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  });

  it("moves through the list with the arrow keys, wrapping, and adds on Enter", () => {
    const { onAdd, search } = open();
    const selected = () => screen.getByRole("option", { selected: true }).textContent;
    expect(selected()).toBe("Owner risk");
    expect(search).toHaveAttribute("aria-activedescendant", screen.getByRole("option", { name: "Owner risk" }).id);
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(selected()).toBe("Risk");
    fireEvent.keyDown(search, { key: "ArrowUp" });
    fireEvent.keyDown(search, { key: "ArrowUp" });
    expect(selected()).toBe("AI Act Class");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(selected()).toBe("Owner risk");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onAdd).toHaveBeenCalledWith("risk");
  });

  it("starts the highlight over on a new search", () => {
    const { onAdd, search } = open();
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.change(search, { target: { value: "risk" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onAdd).toHaveBeenCalledWith("risk");
    fireEvent.click(screen.getByText("Add filter"));
    fireEvent.change(screen.getByRole("textbox", { name: "Search fields" }), { target: { value: "risk" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Search fields" }), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Search fields" }), { key: "Enter" });
    expect(onAdd).toHaveBeenLastCalledWith("reg");
  });

  it("ignores Enter and the arrows when nothing matches", () => {
    const { onAdd, search } = open();
    fireEvent.change(search, { target: { value: "zzz" } });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("follows the pointer", () => {
    open();
    fireEvent.mouseEnter(screen.getByRole("option", { name: "Prisk" }));
    expect(screen.getByRole("option", { selected: true })).toHaveTextContent("Prisk");
  });

  it("closes on Escape without adding, and reopens with the search emptied", async () => {
    const { onAdd, search } = open();
    fireEvent.change(search, { target: { value: "risk" } });
    fireEvent.keyDown(search, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    expect(onAdd).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Add filter"));
    expect(screen.getByRole("textbox", { name: "Search fields" })).toHaveValue("");
    expect(optionNames()).toHaveLength(5);
  });

  it("tells assistive tech the chip opens a popup", () => {
    render(<AddFilterMenu sections={SECTIONS} onAdd={vi.fn()} />);
    const chip = screen.getByRole("button", { name: /Add filter/ });
    expect(chip).toHaveAttribute("aria-haspopup", "dialog");
    expect(chip).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-expanded", "true");
  });
});
