import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockApi } from "@/test/apiMock";
import { invalidateCardTypeCategories } from "@/hooks/useCardTypeCategories";
import type { CardTypeCategory } from "@/types";
import CategoryCombobox from "./CategoryCombobox";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

const REGISTRY: CardTypeCategory[] = [
  {
    id: "c1",
    key: "Business Architecture",
    label: "Business Architecture",
    color: "#2889ff",
    sort_order: 0,
    built_in: true,
    translations: {},
  },
  {
    id: "c2",
    key: "Application & Data",
    label: "Application & Data",
    color: "#0f7eb5",
    sort_order: 1,
    built_in: true,
    translations: {},
  },
];

function Harness({
  initial,
  onChange,
  canCreate,
}: {
  initial: string | null;
  onChange: (k: string | null) => void;
  canCreate?: boolean;
}) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <>
      <CategoryCombobox
        value={value}
        canCreate={canCreate}
        onChange={(k) => {
          setValue(k);
          onChange(k);
        }}
      />
      <output data-testid="value">{value ?? "null"}</output>
    </>
  );
}

function renderCombo(initial: string | null = null, canCreate?: boolean) {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<Harness initial={initial} onChange={onChange} canCreate={canCreate} />);
  return { user, onChange, combo: screen.getByRole("combobox", { name: "Category" }) };
}

beforeEach(() => {
  mockApi.reset();
  invalidateCardTypeCategories(REGISTRY);
});

afterEach(() => {
  invalidateCardTypeCategories([]);
});

describe("CategoryCombobox", () => {
  it("lists the registry in order, each with its colour dot", async () => {
    const { user, combo } = renderCombo();
    await user.click(combo);
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "Business Architecture",
      "Application & Data",
    ]);
    expect(within(options[0]).getByTestId("category-dot")).toBeInTheDocument();
  });

  it("shows null as uncategorized", () => {
    const { combo } = renderCombo(null);
    expect(combo).toHaveValue("");
    expect(combo).toHaveAttribute("placeholder", "Uncategorized");
  });

  it("selects a key", async () => {
    const { user, combo, onChange } = renderCombo();
    await user.click(combo);
    await user.click(await screen.findByRole("option", { name: "Application & Data" }));
    expect(onChange).toHaveBeenLastCalledWith("Application & Data");
    expect(combo).toHaveValue("Application & Data");
  });

  it("keeps a stored value the registry does not know, under its raw name", () => {
    const { combo } = renderCombo("Legacy Layer");
    expect(combo).toHaveValue("Legacy Layer");
  });

  it("offers no create row for a name that already exists, whatever its case", async () => {
    const { user, combo } = renderCombo();
    await user.type(combo, "application & data");
    expect(screen.queryByText(/Create category/)).not.toBeInTheDocument();
  });

  it("creates a category inline and selects it", async () => {
    const security = {
      id: "c3",
      key: "Security",
      label: "Security",
      color: "#999999",
      sort_order: 2,
      built_in: false,
      translations: {},
    };
    mockApi.on("post", "/metamodel/categories", security);
    mockApi.on("get", "/metamodel/categories", [...REGISTRY, security]);
    const { user, combo, onChange } = renderCombo();
    await user.type(combo, "Security");
    await user.click(await screen.findByRole("option", { name: /Create category “Security”/ }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveValue("Security");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("Security"));
    const [call] = mockApi.callsOf("post", "/metamodel/categories");
    expect(call.body).toMatchObject({ label: "Security", color: "#999999" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("value")).toHaveTextContent("Security");
    // The registry was re-fetched: the new category is an ordinary option now.
    expect(mockApi.callsOf("get", "/metamodel/categories")).toHaveLength(1);
    await user.click(combo);
    expect(await screen.findByRole("option", { name: "Security" })).toBeInTheDocument();
  });

  it("keeps the dialog open with a translated error on a duplicate", async () => {
    mockApi.fail("post", "/metamodel/categories", 409, {
      error: "category_exists",
      message: "exists",
      key: "Security",
    });
    const { user, combo, onChange } = renderCombo();
    await user.type(combo, "Security");
    await user.click(await screen.findByRole("option", { name: /Create category/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(
      await within(dialog).findByText("A category with this name already exists."),
    ).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("cancelling the create dialog leaves the value alone", async () => {
    const { user, combo, onChange } = renderCombo("Business Architecture");
    await user.clear(combo);
    await user.type(combo, "Nope");
    await user.click(await screen.findByRole("option", { name: /Create category/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("post")).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalledWith("Nope");
  });

  it("offers no create row when creation is off", async () => {
    const { user, combo } = renderCombo(null, false);
    await user.type(combo, "Security");
    expect(screen.queryByText(/Create category/)).not.toBeInTheDocument();
  });
});
