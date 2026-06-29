import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReportBuilderDialog from "./ReportBuilderDialog";

// Mock the metamodel hook with one card type that has a select field + numeric field.
vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    types: [
      {
        key: "Application",
        label: "Application",
        is_hidden: false,
        subtypes: [],
        translations: {},
        fields_schema: [
          {
            section: "g",
            fields: [
              {
                key: "businessCriticality",
                label: "Business Criticality",
                type: "single_select",
                options: [{ key: "high", label: "High" }],
              },
              { key: "costTotalAnnual", label: "Annual Cost", type: "cost" },
            ],
          },
        ],
      },
    ],
    relationTypes: [],
  }),
}));

// Tag groups fetch
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, get: vi.fn().mockResolvedValue([]) } };
});

beforeEach(() => vi.clearAllMocks());

describe("ReportBuilderDialog", () => {
  it("builds a spec from the form and hands it to onApply", async () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(
      <ReportBuilderDialog open onClose={onClose} initialSpec={null} onApply={onApply} />,
    );

    // Pick the card type (MUI Select).
    const user = userEvent.setup();
    const cardTypeSelect = screen.getByLabelText(/card type/i);
    await user.click(cardTypeSelect);
    await user.click(await screen.findByRole("option", { name: "Application" }));

    // Apply (default: one count measure, bar viz).
    await user.click(screen.getByRole("button", { name: /apply/i }));

    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    const spec = onApply.mock.calls[0][0];
    expect(spec.source.card_type).toBe("Application");
    expect(spec.measures).toEqual([{ agg: "count" }]);
    expect(spec.visualization.kind).toBe("bar");
    expect(onClose).toHaveBeenCalled();
  });

  it("disables Apply until a card type is chosen", () => {
    render(
      <ReportBuilderDialog open onClose={vi.fn()} initialSpec={null} onApply={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /apply/i })).toBeDisabled();
  });

  it("seeds the form from an existing spec", async () => {
    const onApply = vi.fn();
    render(
      <ReportBuilderDialog
        open
        onClose={vi.fn()}
        initialSpec={{
          title: "Seeded",
          source: { card_type: "Application" },
          measures: [{ agg: "count" }],
          visualization: { kind: "pie" },
        }}
        onApply={onApply}
      />,
    );
    expect(screen.getByDisplayValue("Seeded")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /apply/i }));
    await waitFor(() => expect(onApply).toHaveBeenCalled());
    expect(onApply.mock.calls[0][0].visualization.kind).toBe("pie");
  });
});
