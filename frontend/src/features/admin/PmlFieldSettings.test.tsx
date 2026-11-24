import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "@/api/client";
import PmlFieldSettings from "./PmlFieldSettings";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn() },
  apiErrorMessage: (e: Error) => e.message,
  isAbortError: () => false,
  ApiError: class extends Error {
    constructor(
      message: string,
      public status: number,
      public detail: unknown,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/hooks/useMetamodel", () => ({ useMetamodel: () => ({ types: [], relationTypes: [] }) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

const configs = {
  budget: {
    fields: [
      {
        key: "provider",
        label: "Provider",
        kind: "card_reference",
        card_type: "Provider",
        active: true,
        required: false,
        options: [],
      },
    ],
    visible_columns: ["provider"],
    provider_source: null,
  },
  cost_item: { fields: [], visible_columns: [], provider_source: null },
  invoice: { fields: [], visible_columns: [], provider_source: null },
};

describe("PmlFieldSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue(structuredClone(configs));
    vi.mocked(api.put).mockImplementation(async (_url, body) => body);
  });

  it("saves a section without replacing its neighbours and preserves protected definitions", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      ...configs,
      budget: {
        ...configs.budget,
        fields: [
          ...configs.budget.fields,
          { key: "hidden", label: "Hidden", kind: "calculated", protected: true },
        ],
      },
    });
    render(<PmlFieldSettings />);
    await screen.findByText("Provider");
    fireEvent.click(screen.getByRole("button", { name: "pml.fields.save" }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        "/settings/pml/financial-fields/budget",
        expect.objectContaining({
          fields: expect.arrayContaining([{ key: "hidden", keep_existing: true }]),
        }),
      ),
    );
    expect(api.put).toHaveBeenCalledTimes(1);
  });

  it("exposes budget Provider inheritance and prevents invoice Provider selection", async () => {
    render(<PmlFieldSettings />);
    await screen.findByText("Provider");
    fireEvent.click(screen.getByRole("tab", { name: "pml.fields.costItem" }));
    expect(screen.getByLabelText("pml.fields.providerSource")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "pml.fields.invoice" }));
    expect(screen.queryByLabelText("pml.fields.providerSource")).not.toBeInTheDocument();
  });
  it("previews ordered rules with example values", async () => {
    const calculation = {
      result_type: "text",
      inputs: { amount: "amount" },
      expression: null,
      rules: [
        { when: { op: "gt", input: "amount", value: 5 }, then: "High" },
        { when: { op: "gt", input: "amount", value: 1 }, then: "Low" },
      ],
      fallback: null,
    };
    vi.mocked(api.get).mockResolvedValueOnce({
      ...configs,
      budget: {
        fields: [{ key: "rating", label: "Rating", kind: "calculated", active: true, calculation }],
        visible_columns: [],
        provider_source: null,
      },
    });
    vi.mocked(api.post).mockResolvedValueOnce({ value: "High", errors: {} });
    render(<PmlFieldSettings />);
    await screen.findByText("Rating");
    fireEvent.click(screen.getByRole("button", { name: "pml.fields.edit" }));
    fireEvent.change(screen.getByLabelText("pml.fields.sample amount"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "pml.fields.preview" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/settings/pml/financial-fields/budget/preview",
        expect.objectContaining({
          field_key: "rating",
          sample_values: { amount: "10" },
          configuration: expect.objectContaining({
            fields: [expect.objectContaining({ calculation })],
          }),
        }),
      ),
    );
    expect(await screen.findByText(/High/)).toBeInTheDocument();
  });

  it("shows the field and dependency when the server rejects configuration", async () => {
    vi.mocked(api.put).mockRejectedValueOnce(
      new ApiError("HTTP 422", 422, {
        provider_source: "An active budget Provider field is required",
      }),
    );
    render(<PmlFieldSettings />);
    await screen.findByText("Provider");
    fireEvent.click(screen.getByRole("button", { name: "pml.fields.save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "provider_source: An active budget Provider field is required",
    );
  });
  it("round-trips nested ordered rule conditions without changing their structure", async () => {
    const calculation = {
      result_type: "text",
      inputs: { amount: "amount" },
      expression: null,
      rules: [
        {
          when: {
            op: "all",
            conditions: [
              { op: "gt", input: "amount", value: 5 },
              { op: "not", condition: { op: "eq", input: "amount", value: 7 } },
            ],
          },
          then: "High",
        },
      ],
      fallback: null,
    };
    vi.mocked(api.get).mockResolvedValueOnce({
      ...configs,
      budget: {
        fields: [{ key: "rating", label: "Rating", kind: "calculated", active: true, calculation }],
        visible_columns: [],
        provider_source: null,
      },
    });
    render(<PmlFieldSettings />);
    await screen.findByText("Rating");
    fireEvent.click(screen.getByRole("button", { name: "pml.fields.edit" }));
    expect(screen.getAllByLabelText("pml.fields.conditionMode")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "pml.fields.save" }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        "/settings/pml/financial-fields/budget",
        expect.objectContaining({ fields: [expect.objectContaining({ calculation })] }),
      ),
    );
  });
  it("moves configured columns with their fields while retaining standard columns", async () => {
    const first = { key: "one", label: "One", kind: "text", active: true };
    const second = { key: "two", label: "Two", kind: "text", active: true };
    vi.mocked(api.get).mockResolvedValueOnce({
      ...configs,
      budget: {
        fields: [first, second],
        visible_columns: ["amount", "one", "two"],
        provider_source: null,
      },
    });
    render(<PmlFieldSettings />);
    await screen.findByText("One");
    fireEvent.click(screen.getAllByRole("button", { name: "pml.fields.moveDown" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "pml.fields.save" }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        "/settings/pml/financial-fields/budget",
        expect.objectContaining({
          fields: [second, first],
          visible_columns: ["amount", "two", "one"],
        }),
      ),
    );
  });

  it("previews an independent calculation without sending protected definitions", async () => {
    const calculation = {
      result_type: "number",
      inputs: { amount: "amount" },
      expression: "amount * 2",
      rules: null,
      fallback: null,
    };
    vi.mocked(api.get).mockResolvedValueOnce({
      ...configs,
      budget: {
        fields: [
          { key: "hidden", label: "Hidden", kind: "calculated", protected: true },
          { key: "double", label: "Double", kind: "calculated", active: true, calculation },
        ],
        visible_columns: ["hidden", "double"],
        provider_source: null,
      },
    });
    vi.mocked(api.post).mockResolvedValueOnce({ value: 0, errors: {} });
    render(<PmlFieldSettings />);
    await screen.findByText("Double");
    fireEvent.click(screen.getAllByRole("button", { name: "pml.fields.edit" })[1]);
    fireEvent.change(screen.getByLabelText("pml.fields.sample amount"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "pml.fields.preview" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/settings/pml/financial-fields/budget/preview",
        expect.objectContaining({
          sample_values: { amount: "0" },
          configuration: expect.objectContaining({
            fields: [expect.objectContaining({ key: "double" })],
            visible_columns: ["double"],
          }),
        }),
      ),
    );
  });

  it("keeps editing controls disabled until the section save completes", async () => {
    let resolveSave!: (value: unknown) => void;
    vi.mocked(api.put).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    render(<PmlFieldSettings />);
    await screen.findByText("Provider");
    fireEvent.click(screen.getByRole("button", { name: "pml.fields.save" }));
    expect(screen.getByRole("button", { name: "pml.fields.add" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "pml.fields.invoice" })).toBeDisabled();
    resolveSave(configs.budget);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "pml.fields.add" })).toBeEnabled(),
    );
  });
  it("allows discarding a new incomplete field", async () => {
    render(<PmlFieldSettings />);
    await screen.findByText("Provider");
    fireEvent.click(screen.getByRole("button", { name: "pml.fields.add" }));
    expect(screen.getByLabelText("pml.fields.key")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "pml.fields.discard" }));
    expect(screen.queryByLabelText("pml.fields.key")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "pml.fields.save" }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/settings/pml/financial-fields/budget", configs.budget),
    );
  });

  it("preserves a Provider and relation with generic Aruba-style cost fields and rules", async () => {
    const provider = {
      key: "origin",
      label: "Origine Costi",
      kind: "card_reference",
      card_type: "Provider",
      relation_type: "supports",
      active: true,
      required: false,
      options: [],
    };
    const management = {
      key: "management",
      label: "Gestione intercompany",
      kind: "select",
      active: true,
      options: [
        { id: "plafond", label: "Plafond", active: true },
        { id: "canone", label: "Canone", active: true },
        { id: "progetto", label: "Progetto", active: true },
        { id: "na", label: "N.A.", active: true },
      ],
    };
    const purchase = { key: "order", label: "OdA", kind: "text", active: true };
    const aggregate = {
      key: "aggregate",
      label: "Origine Costi Aggregato",
      kind: "calculated",
      active: true,
      calculation: {
        result_type: "text",
        inputs: { provider: "provider.effective" },
        expression: null,
        rules: [
          {
            when: { op: "eq", input: "provider", value: "12345678-1234-1234-1234-123456789abc" },
            then: "Licenze",
          },
        ],
        fallback: null,
      },
    };
    const budget = { fields: [provider], visible_columns: ["origin"], provider_source: null };
    const cost = {
      fields: [management, purchase, aggregate],
      visible_columns: ["management", "order", "aggregate"],
      provider_source: { budget_field_key: "origin", allow_child_selection: true },
    };
    vi.mocked(api.get).mockResolvedValueOnce({ ...configs, budget, cost_item: cost });
    render(<PmlFieldSettings />);
    await screen.findByText("Origine Costi");
    fireEvent.click(screen.getByRole("button", { name: "pml.fields.save" }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/settings/pml/financial-fields/budget", budget),
    );
    fireEvent.click(screen.getByRole("tab", { name: "pml.fields.costItem" }));
    fireEvent.click(screen.getByRole("button", { name: "pml.fields.save" }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/settings/pml/financial-fields/cost_item", cost),
    );
  });
  it("sends a boolean example as a boolean in the formula preview", async () => {
    const calculation = {
      result_type: "boolean",
      inputs: { selected: "approved" },
      expression: "selected",
      rules: null,
      fallback: null,
    };
    vi.mocked(api.get).mockResolvedValueOnce({
      ...configs,
      budget: {
        fields: [
          { key: "approved", label: "Approved", kind: "boolean", active: true },
          { key: "result", label: "Result", kind: "calculated", active: true, calculation },
        ],
        visible_columns: [],
        provider_source: null,
      },
    });
    vi.mocked(api.post).mockResolvedValueOnce({ value: true, errors: {} });
    render(<PmlFieldSettings />);
    await screen.findByText("Result");
    fireEvent.click(screen.getAllByRole("button", { name: "pml.fields.edit" })[1]);
    fireEvent.mouseDown(screen.getByLabelText("pml.fields.sample selected"));
    fireEvent.click(screen.getByRole("option", { name: "pml.fields.yes" }));
    fireEvent.click(screen.getByRole("button", { name: "pml.fields.preview" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/settings/pml/financial-fields/budget/preview",
        expect.objectContaining({ sample_values: { approved: true } }),
      ),
    );
  });
});

describe("PML calculation precision and aliases", () => {
  it("preserves numeric rule, fallback and sample digits", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      ...configs,
      budget: {
        fields: [
          {
            key: "rating",
            label: "Rating",
            kind: "calculated",
            active: true,
            calculation: {
              result_type: "number",
              inputs: { amount: "amount" },
              expression: null,
              rules: [{ when: { op: "gt", input: "amount", value: 5 }, then: 1 }],
              fallback: 0,
            },
          },
        ],
        visible_columns: [],
        provider_source: null,
      },
    });
    vi.mocked(api.post).mockResolvedValueOnce({ value: "0", errors: {} });
    render(<PmlFieldSettings />);
    await screen.findByText("Rating");
    fireEvent.click(screen.getByRole("button", { name: "pml.fields.edit" }));
    const precise = "9007199254740993";
    fireEvent.change(screen.getByLabelText("pml.fields.conditionValue"), {
      target: { value: precise },
    });
    fireEvent.change(screen.getByLabelText("pml.fields.result"), { target: { value: precise } });
    fireEvent.change(screen.getByLabelText("pml.fields.fallback"), { target: { value: precise } });
    fireEvent.change(screen.getByLabelText("pml.fields.sample amount"), {
      target: { value: precise },
    });
    fireEvent.click(screen.getByRole("button", { name: "pml.fields.preview" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          sample_values: { amount: precise },
          configuration: expect.objectContaining({
            fields: [
              expect.objectContaining({
                calculation: expect.objectContaining({
                  fallback: precise,
                  rules: [
                    expect.objectContaining({
                      then: precise,
                      when: expect.objectContaining({ value: precise }),
                    }),
                  ],
                }),
              }),
            ],
          }),
        }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "pml.fields.save" }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          fields: [
            expect.objectContaining({
              calculation: expect.objectContaining({
                fallback: precise,
                rules: [
                  expect.objectContaining({
                    then: precise,
                    when: expect.objectContaining({ value: precise }),
                  }),
                ],
              }),
            }),
          ],
        }),
      ),
    );
  });
  it("keeps aliases in place while typing and avoids overwriting an existing alias", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      ...configs,
      budget: {
        fields: [
          {
            key: "rating",
            label: "Rating",
            kind: "calculated",
            active: true,
            calculation: {
              result_type: "number",
              inputs: { first: "amount", second: "amount" },
              expression: "first",
              rules: null,
              fallback: null,
            },
          },
        ],
        visible_columns: [],
        provider_source: null,
      },
    });
    render(<PmlFieldSettings />);
    await screen.findByText("Rating");
    fireEvent.click(screen.getByRole("button", { name: "pml.fields.edit" }));
    const aliases = screen.getAllByLabelText("pml.fields.inputAlias") as HTMLInputElement[];
    fireEvent.change(aliases[0], { target: { value: "first_new" } });
    expect(
      (screen.getAllByLabelText("pml.fields.inputAlias") as HTMLInputElement[]).map((x) => x.value),
    ).toEqual(["first_new", "second"]);
    fireEvent.change(screen.getAllByLabelText("pml.fields.inputAlias")[0], {
      target: { value: "second" },
    });
    expect(screen.getAllByLabelText("pml.fields.inputAlias")).toHaveLength(2);
  });
});
