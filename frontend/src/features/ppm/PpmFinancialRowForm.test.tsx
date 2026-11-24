import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "@/test/apiMock";
import type { PpmFinancials } from "@/types";
import PpmFinancialRowForm from "./PpmFinancialRowForm";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

const data = {
  initiative_id: "i1",
  budget_lines: [
    {
      id: "b1",
      fiscal_year: 2026,
      category: "opex",
      description: "Budget",
      amount: "100.13",
      total_cost_items: "0",
      provider_child_enabled: false,
      field_values: {},
      calculated_values: {},
      reference_display: {},
    },
  ],
  cost_items: [
    {
      id: "c1",
      budget_line_id: "b1",
      description: "Renewal",
      category: "opex",
      actual: "80",
      planned: "0",
      date: null,
      provider_child_id: "child-1",
      provider_child_enabled: false,
      field_values: {},
      calculated_values: {},
      reference_display: {},
    },
  ],
  invoices: [],
  invoice_access: true,
  field_definitions: { budget: { fields: [] }, cost_item: { fields: [] }, invoice: { fields: [] } },
} as unknown as PpmFinancials;

describe("PpmFinancialRowForm", () => {
  beforeEach(() => {
    mockApi.reset();
    mockApi.lenient({});
    mockApi.on("get", "/metamodel/types", []);
    mockApi.on("get", "/metamodel/relation-types", []);
  });

  it("creates a cost in the immutable budget context", async () => {
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <PpmFinancialRowForm
        initiativeId="i1"
        data={data}
        kind="cost"
        mode="create"
        parentId="b1"
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );
    await user.type(screen.getByLabelText(/description/i), "Renewal");
    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(mockApi.callsOf("post", "/ppm/initiatives/i1/costs")[0]?.body).toEqual(
        expect.objectContaining({ budget_line_id: "b1", description: "Renewal" }),
      ),
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it("sends invoice amount as decimal text and preserves zeroes in the document id", async () => {
    const user = userEvent.setup();
    render(
      <PpmFinancialRowForm
        initiativeId="i1"
        data={data}
        kind="invoice"
        mode="create"
        parentId="c1"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/invoice date/i), { target: { value: "2026-11-23" } });
    await user.type(screen.getByLabelText(/invoice (id|reference)/i), "00038");
    await user.type(screen.getByLabelText(/amount/i), "30.11");
    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(mockApi.callsOf("post", "/ppm/initiatives/i1/invoices")[0]?.body).toEqual(
        expect.objectContaining({
          cost_item_id: "c1",
          invoice_date: "2026-11-23",
          invoice_id: "00038",
          amount: "30.11",
        }),
      ),
    );
  });

  it("sends configurable invoice fields with the created record", async () => {
    const user = userEvent.setup();
    const rows = {
      ...data,
      field_definitions: {
        ...data.field_definitions,
        invoice: {
          visible_columns: ["purchase_order"],
          fields: [
            { key: "purchase_order", label: "Purchase order", kind: "text" },
            { key: "year", label: "Invoice year", kind: "calculated", result_type: "number" },
          ],
        },
      },
    } as PpmFinancials;
    render(
      <PpmFinancialRowForm
        initiativeId="i1"
        data={rows}
        kind="invoice"
        mode="create"
        parentId="c1"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/invoice date/i), { target: { value: "2026-11-23" } });
    await user.type(screen.getByLabelText(/invoice (id|reference)/i), "00038");
    await user.type(screen.getByLabelText(/amount/i), "30.11");
    await user.type(screen.getByLabelText(/purchase order/i), "000004");
    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(mockApi.callsOf("post", "/ppm/initiatives/i1/invoices")[0]?.body).toEqual(
        expect.objectContaining({ field_values: { purchase_order: "000004" } }),
      ),
    );
  });

  it("moves an invoice to a legacy unassigned cost item", async () => {
    const user = userEvent.setup();
    const invoice = {
      id: "inv1",
      initiative_id: "i1",
      cost_item_id: "c1",
      invoice_id: "00038",
      invoice_date: "2026-11-23",
      amount: "30.11",
    };
    const target = { ...data.cost_items[0], id: "c2", description: "Legacy", budget_line_id: null };
    const rows = { ...data, cost_items: [...data.cost_items, target] };
    render(
      <PpmFinancialRowForm
        initiativeId="i1"
        data={rows}
        kind="invoice"
        mode="move"
        row={invoice}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "Legacy" }));
    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(mockApi.callsOf("patch", "/ppm/invoices/inv1")[0]?.body).toEqual({
        cost_item_id: "c2",
      }),
    );
  });

  it("can clear a saved child when moving to a budget without hierarchy", async () => {
    const user = userEvent.setup();
    const second = { ...data.budget_lines[0], id: "b2", description: "Destination" };
    const rows = { ...data, budget_lines: [...data.budget_lines, second] };
    render(
      <PpmFinancialRowForm
        initiativeId="i1"
        data={rows}
        kind="cost"
        mode="move"
        row={data.cost_items[0]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "Destination" }));
    await user.click(screen.getByRole("button", { name: /use budget provider/i }));
    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(mockApi.callsOf("patch", "/ppm/costs/c1")[0]?.body).toEqual({
        budget_line_id: "b2",
        provider_child_id: null,
      }),
    );
  });

  it("keeps a saved child when hierarchy is disabled on an unrelated edit", async () => {
    const user = userEvent.setup();
    render(
      <PpmFinancialRowForm
        initiativeId="i1"
        data={data}
        kind="cost"
        mode="edit"
        row={data.cost_items[0]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(/provider child/i)).not.toBeInTheDocument();
    const description = screen.getByLabelText(/description/i);
    await user.clear(description);
    await user.type(description, "Updated");
    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(mockApi.callsOf("patch", "/ppm/costs/c1")[0]?.body).toEqual(
        expect.objectContaining({ description: "Updated" }),
      ),
    );
    expect(mockApi.callsOf("patch", "/ppm/costs/c1")[0].body).not.toHaveProperty(
      "provider_child_id",
    );
  });
  it("refreshes the parent after a stale destination while displaying the error", async () => {
    const user = userEvent.setup();
    const onStale = vi.fn();
    mockApi.fail("patch", "/ppm/costs/c1", 409, "Budget Provider changed; retry");
    render(
      <PpmFinancialRowForm
        initiativeId="i1"
        data={data}
        kind="cost"
        mode="move"
        row={data.cost_items[0]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onStale={onStale}
      />,
    );
    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onStale).toHaveBeenCalledOnce());
    expect(screen.getByRole("alert")).toHaveTextContent("PATCH /ppm/costs/c1 failed");
  });
  it("lets the user correct a Provider conflict without reloading the form", async () => {
    const user = userEvent.setup();
    const onStale = vi.fn();
    mockApi.fail("patch", "/ppm/costs/c1", 409, {
      code: "provider_children_incompatible",
      cost_ids: ["c1"],
    });
    render(
      <PpmFinancialRowForm
        initiativeId="i1"
        data={data}
        kind="cost"
        mode="move"
        row={data.cost_items[0]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onStale={onStale}
      />,
    );
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The selected Provider is incompatible with these Cost Items: " +
        data.cost_items[0].description,
    );
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(onStale).not.toHaveBeenCalled();
  });
  it("discards a chosen child when changing the destination budget", async () => {
    const user = userEvent.setup();
    const first = {
      ...data.budget_lines[0],
      id: "b2",
      description: "First destination",
      provider_child_enabled: true,
    };
    const second = { ...data.budget_lines[0], id: "b3", description: "Second destination" };
    const rows = { ...data, budget_lines: [...data.budget_lines, first, second] };
    mockApi.on("get", /provider-children/, {
      items: [{ id: "new-child", name: "Child provider", type: "Provider" }],
      total: 1,
    });
    render(
      <PpmFinancialRowForm
        initiativeId="i1"
        data={rows}
        kind="cost"
        mode="move"
        row={data.cost_items[0]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "First destination" }));
    await user.click(screen.getByLabelText(/^provider$/i));
    await user.click(await screen.findByRole("option", { name: /child provider/i }));
    await user.click(screen.getAllByRole("combobox")[0]);
    await user.click(screen.getByRole("option", { name: "Second destination" }));
    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(mockApi.callsOf("patch", "/ppm/costs/c1")[0]?.body).toEqual({ budget_line_id: "b3" }),
    );
  });
});

describe("PML new cost defaults", () => {
  it("sends the displayed unchecked required Boolean as false", async () => {
    mockApi.reset();
    mockApi.lenient({});
    const rows = {
      ...data,
      field_definitions: {
        ...data.field_definitions,
        cost_item: {
          fields: [{ key: "approved", label: "Approved", kind: "boolean", required: true }],
        },
      },
    } as PpmFinancials;
    render(
      <PpmFinancialRowForm
        initiativeId="i1"
        data={rows}
        kind="cost"
        mode="create"
        parentId="b1"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByRole("checkbox", { name: "Approved" })).not.toBeChecked();
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: "New" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(mockApi.callsOf("post", "/ppm/initiatives/i1/costs")[0]?.body).toEqual(
        expect.objectContaining({ field_values: { approved: false } }),
      ),
    );
  });
  it("defaults a new cost date to today and permits clearing it", async () => {
    mockApi.reset();
    mockApi.lenient({});
    render(
      <PpmFinancialRowForm
        initiativeId="i1"
        data={data}
        kind="cost"
        mode="create"
        parentId="b1"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    const date = screen.getByLabelText(/^date$/i) as HTMLInputElement;
    const today = new Date();
    const expected = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, "0"),
      String(today.getDate()).padStart(2, "0"),
    ].join("-");
    expect(date.value).toBe(expected);
    fireEvent.change(date, { target: { value: "" } });
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: "New" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(mockApi.callsOf("post", "/ppm/initiatives/i1/costs")[0]?.body).toEqual(
        expect.objectContaining({ date: null }),
      ),
    );
  });
});
