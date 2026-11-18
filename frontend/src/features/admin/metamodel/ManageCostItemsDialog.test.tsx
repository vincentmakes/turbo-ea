import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockApi } from "@/test/apiMock";
import type { CostItemType } from "@/types";
import ManageCostItemsDialog, { TEXT_SUFFIXES } from "./ManageCostItemsDialog";
import adminEn from "@/i18n/locales/en/admin.json";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

const item = (over: Partial<CostItemType> & { key: string }): CostItemType => ({
  id: over.key,
  label: over.key,
  sort_order: 0,
  archived: false,
  translations: {},
  ...over,
});

const ITEMS = [
  item({ key: "licenses", label: "Licenses" }),
  item({ key: "legacy", label: "Legacy support", archived: true }),
];

const row = (key: string) => screen.getByTestId(`cost-item-row-${key}`);

function renderDialog() {
  const user = userEvent.setup();
  render(<ManageCostItemsDialog open onClose={vi.fn()} />);
  return user;
}

beforeEach(() => {
  mockApi.reset();
  mockApi.on("get", "/metamodel/cost-item-types", ITEMS);
});

describe("ManageCostItemsDialog", () => {
  it("lists active and archived items and explains the TCO rule", async () => {
    renderDialog();
    expect(await screen.findByText("Licenses")).toBeInTheDocument();
    expect(screen.getByText("Legacy support")).toBeInTheDocument();
    expect(
      screen.getByText(/Archived items cannot be added to a year, but amounts already entered/),
    ).toBeInTheDocument();
  });

  it("has no delete button", async () => {
    renderDialog();
    await screen.findByText("Licenses");
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("creates an item with key and label", async () => {
    mockApi.on("post", "/metamodel/cost-item-types", (_p, body) => ({
      ...item({ key: "support" }),
      ...(body as object),
    }));
    const user = renderDialog();
    await screen.findByText("Licenses");
    await user.click(screen.getByRole("button", { name: /new cost item/i }));
    await user.type(screen.getByLabelText(/^key/i), "support");
    await user.type(screen.getByLabelText(/^name/i), "Support");
    await user.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() =>
      expect(mockApi.callsOf("post", "/metamodel/cost-item-types")[0].body).toEqual({
        key: "support",
        label: "Support",
        translations: {},
      }),
    );
  });

  it("archives and unarchives through PATCH", async () => {
    mockApi.on("patch", /^\/metamodel\/cost-item-types\//, {});
    const user = renderDialog();
    await screen.findByText("Licenses");
    await user.click(within(row("licenses")).getByRole("button", { name: /archive/i }));
    await waitFor(() =>
      expect(mockApi.callsOf("patch", "/metamodel/cost-item-types/licenses")[0].body).toEqual({
        archived: true,
      }),
    );
    await user.click(within(row("legacy")).getByRole("button", { name: /restore/i }));
    await waitFor(() =>
      expect(mockApi.callsOf("patch", "/metamodel/cost-item-types/legacy")[0].body).toEqual({
        archived: false,
      }),
    );
  });

  it("shows the key of an existing item read-only and saves the label", async () => {
    mockApi.on("patch", /^\/metamodel\/cost-item-types\//, {});
    const user = renderDialog();
    await screen.findByText("Licenses");
    await user.click(within(row("licenses")).getByRole("button", { name: /edit/i }));
    expect(screen.getByLabelText(/^key/i)).toBeDisabled();
    const name = screen.getByLabelText(/^name/i);
    await user.clear(name);
    await user.type(name, "Software licenses");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(mockApi.callsOf("patch", "/metamodel/cost-item-types/licenses")[0].body).toEqual({
        label: "Software licenses",
        translations: {},
      }),
    );
  });

  it("reports a duplicate key (409)", async () => {
    mockApi.fail("post", "/metamodel/cost-item-types", 409, { error: "duplicate_key" });
    const user = renderDialog();
    await screen.findByText("Licenses");
    await user.click(screen.getByRole("button", { name: /new cost item/i }));
    await user.type(screen.getByLabelText(/^key/i), "licenses");
    await user.type(screen.getByLabelText(/^name/i), "Again");
    await user.click(screen.getByRole("button", { name: /^create$/i }));
    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
  });

  it("reports an invalid key (422)", async () => {
    mockApi.fail("post", "/metamodel/cost-item-types", 422, [{ msg: "bad" }]);
    const user = renderDialog();
    await screen.findByText("Licenses");
    await user.click(screen.getByRole("button", { name: /new cost item/i }));
    await user.type(screen.getByLabelText(/^key/i), "1bad");
    await user.type(screen.getByLabelText(/^name/i), "Bad");
    await user.click(screen.getByRole("button", { name: /^create$/i }));
    expect(await screen.findByText(/must start with a letter/i)).toBeInTheDocument();
  });
});

describe("ManageCostItemsDialog texts", () => {
  it("every list text key exists", () => {
    const messages = adminEn as Record<string, string>;
    for (const suffix of TEXT_SUFFIXES) {
      expect(messages[`metamodel.costItems.${suffix}`], suffix).toBeTruthy();
    }
  });
});
