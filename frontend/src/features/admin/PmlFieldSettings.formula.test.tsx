import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import PmlFieldSettings from "./PmlFieldSettings";

const provider = {
  id: "12345678-1234-1234-1234-123456789abc",
  name: "Licensing",
  type: "Provider",
};

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn() },
  apiErrorMessage: (error: Error) => error.message,
  isAbortError: () => false,
  ApiError: class extends Error {},
}));
vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({ types: [], relationTypes: [] }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("@/components/CardPicker", () => ({
  default: ({ label, onChange }: { label: string; onChange: (value: typeof provider) => void }) => (
    <button type="button" onClick={() => onChange(provider)}>
      {label}
    </button>
  ),
}));

const calculation = {
  result_type: "text",
  inputs: { provider: "provider.effective" },
  expression: 'IF(provider == licensing, "Licenze", "Servizi Intercompany")',
  rules: null,
  fallback: null,
};
const budget = {
  fields: [
    {
      key: "origin",
      label: "Origin",
      kind: "card_reference",
      card_type: "Provider",
    },
  ],
  visible_columns: [],
  provider_source: null,
};
const cost = {
  fields: [{ key: "aggregate", label: "Aggregate", kind: "calculated", calculation }],
  visible_columns: [],
  provider_source: { budget_field_key: "origin", allow_child_selection: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation(async (path) =>
    path === "/settings/pml/financial-fields"
      ? {
          budget,
          cost_item: cost,
          invoice: { fields: [], visible_columns: [], provider_source: null },
        }
      : provider,
  );
  vi.mocked(api.put).mockImplementation(async (_path, body) => body);
  vi.mocked(api.post).mockResolvedValue({ value: "Licenze", errors: {} });
});

it("saves and previews IF formulas with a selected Provider constant", async () => {
  render(<PmlFieldSettings />);
  await screen.findByText("Origin");
  fireEvent.click(screen.getByRole("tab", { name: "pml.fields.costItem" }));
  fireEvent.click(screen.getByRole("button", { name: "pml.fields.edit" }));
  fireEvent.click(screen.getByRole("button", { name: "pml.fields.addProviderConstant" }));
  fireEvent.change(screen.getByLabelText("pml.fields.providerConstantAlias"), {
    target: { value: "licensing" },
  });
  fireEvent.click(screen.getByRole("button", { name: "pml.fields.providerConstant" }));
  fireEvent.click(screen.getByRole("button", { name: "pml.fields.preview" }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      "/settings/pml/financial-fields/cost_item/preview",
      expect.objectContaining({
        configuration: expect.objectContaining({
          fields: [
            expect.objectContaining({
              calculation: expect.objectContaining({
                provider_constants: { licensing: provider.id },
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
      "/settings/pml/financial-fields/cost_item",
      expect.objectContaining({
        fields: [
          expect.objectContaining({
            calculation: expect.objectContaining({
              provider_constants: { licensing: provider.id },
            }),
          }),
        ],
      }),
    ),
  );
});

it("keeps existing Provider constants editable when the budget mapping was removed", async () => {
  const saved = {
    ...cost,
    provider_source: null,
    fields: [
      {
        ...cost.fields[0],
        calculation: {
          ...calculation,
          provider_constants: { licensing: provider.id },
        },
      },
    ],
  };
  vi.mocked(api.get).mockImplementation(async (path) =>
    path === "/settings/pml/financial-fields"
      ? {
          budget,
          cost_item: saved,
          invoice: { fields: [], visible_columns: [], provider_source: null },
        }
      : provider,
  );
  render(<PmlFieldSettings />);
  await screen.findByText("Origin");
  fireEvent.click(screen.getByRole("tab", { name: "pml.fields.costItem" }));
  fireEvent.click(screen.getByRole("button", { name: "pml.fields.edit" }));
  expect(screen.getByLabelText("pml.fields.providerConstantAlias")).toHaveValue("licensing");
  expect(screen.getByRole("button", { name: "pml.fields.addProviderConstant" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "pml.fields.save" }));
  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith(
      "/settings/pml/financial-fields/cost_item",
      expect.objectContaining({
        fields: [
          expect.objectContaining({
            calculation: expect.objectContaining({
              provider_constants: { licensing: provider.id },
            }),
          }),
        ],
      }),
    ),
  );
});
it("uses the shared formula editor and previews direct financial fields", async () => {
  const coreCost = {
    ...cost,
    fields: [
      {
        key: "otherServiceType",
        label: "Other service type",
        kind: "select",
        options: [{ id: "licencing", label: "Licenze", active: true }],
      },
      {
        ...cost.fields[0],
        calculation: {
          ...calculation,
          formula_engine: "core",
          inputs: {},
          expression: 'IF(data.otherServiceType == "licencing", "Licenze", "Altro")',
        },
      },
    ],
  };
  vi.mocked(api.get).mockImplementation(async (path) =>
    path === "/settings/pml/financial-fields"
      ? {
          budget,
          cost_item: coreCost,
          invoice: { fields: [], visible_columns: [], provider_source: null },
        }
      : provider,
  );
  render(<PmlFieldSettings />);
  await screen.findByText("Origin");
  fireEvent.click(screen.getByRole("tab", { name: "pml.fields.costItem" }));
  fireEvent.click(screen.getAllByRole("button", { name: "pml.fields.edit" })[1]);
  expect(screen.getByPlaceholderText("calculations.formulaPlaceholder")).toHaveValue(
    'IF(data.otherServiceType == "licencing", "Licenze", "Altro")',
  );
  fireEvent.mouseDown(screen.getByLabelText("pml.fields.sample otherServiceType"));
  fireEvent.click(screen.getByRole("option", { name: "Licenze" }));
  fireEvent.click(screen.getByRole("button", { name: "pml.fields.preview" }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      "/settings/pml/financial-fields/cost_item/preview",
      expect.objectContaining({ sample_values: { otherServiceType: "licencing" } }),
    ),
  );
});
it("previews fields referenced with nested budget paths", async () => {
  const coreCost = {
    ...cost,
    fields: [
      {
        ...cost.fields[0],
        calculation: {
          ...calculation,
          formula_engine: "core",
          inputs: {},
          expression: 'IF(data.budget.amount > 500, data.budget.initiative.name, "Altro")',
        },
      },
    ],
  };
  vi.mocked(api.get).mockImplementation(async (path) =>
    path === "/settings/pml/financial-fields"
      ? {
          budget,
          cost_item: coreCost,
          invoice: { fields: [], visible_columns: [], provider_source: null },
        }
      : provider,
  );
  render(<PmlFieldSettings />);
  await screen.findByText("Origin");
  fireEvent.click(screen.getByRole("tab", { name: "pml.fields.costItem" }));
  fireEvent.click(screen.getByRole("button", { name: "pml.fields.edit" }));
  fireEvent.change(screen.getByLabelText("pml.fields.sample budget.amount"), {
    target: { value: "900" },
  });
  fireEvent.change(screen.getByLabelText("pml.fields.sample budget.initiative.name"), {
    target: { value: "Project" },
  });
  fireEvent.click(screen.getByRole("button", { name: "pml.fields.preview" }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      "/settings/pml/financial-fields/cost_item/preview",
      expect.objectContaining({
        sample_values: { "budget.amount": "900", "budget.initiative.name": "Project" },
      }),
    ),
  );
});
it("reserves the nested budget while allowing a custom budget input and custom Provider name", async () => {
  const coreCost = {
    ...cost,
    fields: [
      { key: "budget", label: "Custom budget", kind: "number", active: true },
      { key: "providerEffective", label: "Custom provider value", kind: "text", active: true },
      {
        ...cost.fields[0],
        calculation: {
          ...calculation,
          formula_engine: "core",
          inputs: { customBudget: "budget" },
          expression: 'IF(data.providerEffective == "test", customBudget, data.budget.amount)',
        },
      },
    ],
  };
  vi.mocked(api.get).mockImplementation(async (path) =>
    path === "/settings/pml/financial-fields"
      ? {
          budget,
          cost_item: coreCost,
          invoice: { fields: [], visible_columns: [], provider_source: null },
        }
      : provider,
  );
  render(<PmlFieldSettings />);
  await screen.findByText("Origin");
  fireEvent.click(screen.getByRole("tab", { name: "pml.fields.costItem" }));
  fireEvent.click(screen.getAllByRole("button", { name: "pml.fields.edit" })[2]);
  expect(screen.getByLabelText("pml.fields.sample customBudget")).toBeInTheDocument();
  expect(screen.getByLabelText("pml.fields.sample providerEffective")).toBeInTheDocument();
  expect(screen.getByLabelText("pml.fields.sample budget.amount")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("pml.fields.sample providerEffective"), {
    target: { value: "test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "pml.fields.preview" }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      "/settings/pml/financial-fields/cost_item/preview",
      expect.objectContaining({ sample_values: { providerEffective: "test" } }),
    ),
  );
  const editor = screen.getByPlaceholderText("calculations.formulaPlaceholder");
  fireEvent.change(editor, { target: { value: "data.prov", selectionStart: 9, selectionEnd: 9 } });
  await waitFor(() => expect(screen.getAllByText("providerEffective")).toHaveLength(1));
});
