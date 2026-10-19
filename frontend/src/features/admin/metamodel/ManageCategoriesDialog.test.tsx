import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockApi } from "@/test/apiMock";
import { invalidateCardTypeCategories } from "@/hooks/useCardTypeCategories";
import { makeCardType } from "@/test/fixtures/metamodel";
import type { CardTypeCategory } from "@/types";
import ManageCategoriesDialog from "./ManageCategoriesDialog";
import { usageByCategory } from "@/lib/cardTypeOrder";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

const cat = (over: Partial<CardTypeCategory> & { key: string }): CardTypeCategory => ({
  id: over.key,
  label: over.key,
  color: "#999999",
  sort_order: 0,
  built_in: false,
  translations: {},
  ...over,
});

const REGISTRY = [
  cat({ key: "Business Architecture", sort_order: 0, built_in: true, color: "#2889ff" }),
  cat({ key: "Security", label: "Security Layer", sort_order: 1 }),
  cat({ key: "Unused", sort_order: 2 }),
];

const TYPES = [
  makeCardType({ key: "Org", label: "Organization", category: "Business Architecture" }),
  makeCardType({ key: "Fw", label: "Firewall", category: "Security" }),
  makeCardType({ key: "Vpn", label: "VPN", category: " Security ", is_hidden: true }),
  makeCardType({ key: "Loose", label: "Loose", category: null }),
];

function renderDialog() {
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<ManageCategoriesDialog open onClose={onClose} types={TYPES} />);
  return { user, onClose };
}

const row = (key: string) => screen.getByTestId(`category-row-${key}`);

beforeEach(() => {
  mockApi.reset();
  invalidateCardTypeCategories(REGISTRY);
});

afterEach(() => {
  invalidateCardTypeCategories([]);
});

describe("usageByCategory", () => {
  it("counts types per trimmed category, hidden ones included", () => {
    expect(usageByCategory(TYPES)).toEqual({ "Business Architecture": 1, Security: 2 });
  });
});

describe("ManageCategoriesDialog", () => {
  it("lists each category with its resolved name and usage", () => {
    renderDialog();
    expect(within(row("Security")).getByText("Security Layer")).toBeInTheDocument();
    expect(within(row("Security")).getByText("2 card types")).toBeInTheDocument();
    expect(within(row("Business Architecture")).getByText("1 card type")).toBeInTheDocument();
    expect(within(row("Unused")).getByText("0 card types")).toBeInTheDocument();
  });

  it("locks a built-in row: lock chip, no edit, no delete", () => {
    renderDialog();
    const builtIn = row("Business Architecture");
    expect(within(builtIn).getByText("Built-in")).toBeInTheDocument();
    expect(
      within(builtIn).getByRole("button", { name: "Edit: Business Architecture" }),
    ).toBeDisabled();
    expect(
      within(builtIn).getByRole("button", { name: "Delete: Business Architecture" }),
    ).toBeDisabled();
    // Its place in the order can still move.
    expect(
      within(builtIn).getByRole("button", { name: "Move down: Business Architecture" }),
    ).toBeEnabled();
    expect(within(row("Security")).queryByText("Built-in")).not.toBeInTheDocument();
  });

  it("disables delete for a category in use, enables it when unused", () => {
    renderDialog();
    expect(within(row("Security")).getByRole("button", { name: /^Delete:/ })).toBeDisabled();
    expect(within(row("Unused")).getByRole("button", { name: /^Delete:/ })).toBeEnabled();
  });

  it("disables moving the first row up and the last row down", () => {
    renderDialog();
    expect(within(row("Business Architecture")).getByRole("button", { name: /^Move up:/ })).toBeDisabled();
    expect(within(row("Unused")).getByRole("button", { name: /^Move down:/ })).toBeDisabled();
  });

  it("reorders by PUTting every key and re-renders in the new order", async () => {
    mockApi.on("put", "/metamodel/categories/order", (_p: string, body: unknown) =>
      (body as { keys: string[] }).keys.map((key, i) => ({
        ...REGISTRY.find((c) => c.key === key)!,
        sort_order: i,
      })),
    );
    const { user } = renderDialog();
    await user.click(within(row("Security")).getByRole("button", { name: /^Move up:/ }));
    await waitFor(() =>
      expect(mockApi.callsOf("put", "/metamodel/categories/order")).toHaveLength(1),
    );
    expect(mockApi.callsOf("put")[0].body).toEqual({
      keys: ["Security", "Business Architecture", "Unused"],
    });
    await waitFor(() =>
      expect(screen.getAllByTestId(/^category-row-/).map((el) => el.dataset.testid)).toEqual([
        "category-row-Security",
        "category-row-Business Architecture",
        "category-row-Unused",
      ]),
    );
  });

  it("moves a row down", async () => {
    mockApi.on("put", "/metamodel/categories/order", (_p: string, body: unknown) =>
      (body as { keys: string[] }).keys.map((key, i) => ({
        ...REGISTRY.find((c) => c.key === key)!,
        sort_order: i,
      })),
    );
    const { user } = renderDialog();
    await user.click(within(row("Business Architecture")).getByRole("button", { name: /^Move down:/ }));
    await waitFor(() => expect(mockApi.callsOf("put")).toHaveLength(1));
    expect(mockApi.callsOf("put")[0].body).toEqual({
      keys: ["Security", "Business Architecture", "Unused"],
    });
  });

  it("edits a custom category through PATCH", async () => {
    mockApi.on("patch", "/metamodel/categories/Security", (_p: string, body: unknown) => ({
      ...REGISTRY[1],
      ...(body as object),
    }));
    mockApi.on("get", "/metamodel/categories", [
      REGISTRY[0],
      { ...REGISTRY[1], label: "Cyber" },
      REGISTRY[2],
    ]);
    const { user } = renderDialog();
    await user.click(within(row("Security")).getByRole("button", { name: /^Edit:/ }));
    const dialog = await screen.findByRole("dialog", { name: "Edit category" });
    const name = within(dialog).getByRole("textbox", { name: "Name" });
    expect(name).toHaveValue("Security Layer");
    await user.clear(name);
    await user.type(name, "Cyber");
    await user.type(within(dialog).getByRole("textbox", { name: "Français" }), " Cyber FR ");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockApi.callsOf("patch")).toHaveLength(1));
    expect(mockApi.callsOf("patch")[0].body).toEqual({
      label: "Cyber",
      color: "#999999",
      translations: { fr: "Cyber FR" },
    });
    await waitFor(() => expect(within(row("Security")).getByText("Cyber")).toBeInTheDocument());
  });

  it("deletes an unused category and re-reads the registry", async () => {
    mockApi.on("delete", "/metamodel/categories/Unused", undefined);
    mockApi.on("get", "/metamodel/categories", REGISTRY.slice(0, 2));
    const { user } = renderDialog();
    await user.click(within(row("Unused")).getByRole("button", { name: /^Delete:/ }));
    await waitFor(() => expect(screen.queryByTestId("category-row-Unused")).not.toBeInTheDocument());
    expect(mockApi.callsOf("delete")[0].path).toBe("/metamodel/categories/Unused");
    expect(mockApi.callsOf("get", "/metamodel/categories")).toHaveLength(1);
    expect(row("Business Architecture")).toBeInTheDocument();
  });

  it("a delete made while the cache holds a stale list keeps every server row", async () => {
    // The dialog's copy lacks "Data", which another tab created meanwhile.
    mockApi.on("delete", "/metamodel/categories/Unused", undefined);
    mockApi.on("get", "/metamodel/categories", [
      ...REGISTRY.slice(0, 2),
      cat({ key: "Data", sort_order: 3 }),
    ]);
    const { user } = renderDialog();
    await user.click(within(row("Unused")).getByRole("button", { name: /^Delete:/ }));
    expect(await screen.findByTestId("category-row-Data")).toBeInTheDocument();
    expect(screen.queryByTestId("category-row-Unused")).not.toBeInTheDocument();
  });

  it("shows a translated error when the server refuses a delete", async () => {
    mockApi.fail("delete", "/metamodel/categories/Unused", 409, {
      error: "types_present",
      types: ["Gizmo"],
      count: 1,
    });
    const { user } = renderDialog();
    await user.click(within(row("Unused")).getByRole("button", { name: /^Delete:/ }));
    expect(
      await screen.findByText("This category is still used by: Gizmo."),
    ).toBeInTheDocument();
    expect(row("Unused")).toBeInTheDocument();
  });

  it("creates a new category from the footer button", async () => {
    mockApi.on("post", "/metamodel/categories", cat({ key: "Data", sort_order: 3 }));
    mockApi.on("get", "/metamodel/categories", [...REGISTRY, cat({ key: "Data", sort_order: 3 })]);
    const { user } = renderDialog();
    await user.click(screen.getByRole("button", { name: /New category/ }));
    const dialog = await screen.findByRole("dialog", { name: "New category" });
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Data");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(await screen.findByTestId("category-row-Data")).toBeInTheDocument();
  });

  it("a create made while the cache is empty re-fetches the full registry", async () => {
    // The first load failed, so the hook holds []; rebuilding the cache from
    // that copy would leave the new category alone and drop the built-ins.
    invalidateCardTypeCategories([]);
    const data = cat({ key: "Data", sort_order: 3 });
    mockApi.on("post", "/metamodel/categories", data);
    mockApi.on("get", "/metamodel/categories", [...REGISTRY, data]);
    const { user } = renderDialog();
    expect(screen.queryAllByTestId(/^category-row-/)).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: /New category/ }));
    const dialog = await screen.findByRole("dialog", { name: "New category" });
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Data");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(screen.getAllByTestId(/^category-row-/).map((el) => el.dataset.testid)).toEqual([
        "category-row-Business Architecture",
        "category-row-Security",
        "category-row-Unused",
        "category-row-Data",
      ]),
    );
    expect(mockApi.callsOf("get", "/metamodel/categories")).toHaveLength(1);
  });

  it("closes", async () => {
    const { user, onClose } = renderDialog();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
