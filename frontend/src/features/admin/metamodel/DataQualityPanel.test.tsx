import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DataQualityPanel from "./DataQualityPanel";
import { api } from "@/api/client";
import type { CardType } from "@/types";

vi.mock("@/api/client", () => ({
  api: { patch: vi.fn().mockResolvedValue({}) },
}));

function makeType(overrides: Partial<CardType> = {}): CardType {
  return {
    key: "Application",
    label: "Application",
    icon: "apps",
    color: "#0f7eb5",
    has_hierarchy: false,
    has_successors: false,
    subtypes: [],
    fields_schema: [
      { section: "Details", fields: [{ key: "vendor", label: "Vendor", type: "text", weight: 2 }] },
    ],
    built_in: true,
    is_hidden: false,
    sort_order: 0,
    ...overrides,
  };
}

describe("DataQualityPanel built-in factors", () => {
  it("renders all five built-in factors, each with a weight tier", () => {
    render(<DataQualityPanel cardType={makeType()} onRefresh={() => {}} />);

    // All five built-in factor rows are present.
    expect(screen.getByText("Description")).toBeInTheDocument();
    expect(screen.getByText("Lifecycle")).toBeInTheDocument();
    expect(screen.getByText("Mandatory relations")).toBeInTheDocument();
    expect(screen.getByText("Mandatory tags")).toBeInTheDocument();
    expect(screen.getByText("Stakeholder roles")).toBeInTheDocument();

    // One slider per built-in (5) + one per field (1) = 6.
    expect(screen.getAllByRole("slider")).toHaveLength(6);
  });

  it("shows the configured weight for lifecycle (and defaults the rest to Normal)", () => {
    const cardType = makeType({
      section_config: { __dataQuality: { lifecycle: 3, description: 0 } },
    });
    render(<DataQualityPanel cardType={cardType} onRefresh={() => {}} />);

    // Lifecycle configured to Critical (3), description to Ignore (0),
    // relations/tags default to Normal (1).
    expect(screen.getByText("Critical (3)")).toBeInTheDocument();
    expect(screen.getByText("Ignore (0)")).toBeInTheDocument();
    expect(screen.getAllByText("Normal (1)").length).toBeGreaterThanOrEqual(2);
  });
});

describe("DataQualityPanel saving", () => {
  const patch = api.patch as unknown as Mock;

  beforeEach(() => {
    patch.mockReset();
    patch.mockResolvedValue({});
  });

  /** The Lifecycle slider: built-ins render in a fixed order, Lifecycle second. */
  const lifecycleSlider = () => screen.getAllByRole("slider")[1];

  it("locks every slider and says it is saving while a weight change is in flight", async () => {
    let resolvePatch: (v: unknown) => void = () => {};
    patch.mockImplementation(() => new Promise((resolve) => (resolvePatch = resolve)));
    const onRefresh = vi.fn();
    render(<DataQualityPanel cardType={makeType()} onRefresh={onRefresh} />);

    fireEvent.change(lifecycleSlider(), { target: { value: 3 } });

    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0][1]).toEqual({ section_config: { __dataQuality: { lifecycle: 3 } } });
    expect(await screen.findByRole("status")).toHaveTextContent("Saving...");
    for (const s of screen.getAllByRole("slider")) expect(s).toBeDisabled();
    // A second change while the first is in flight is refused.
    fireEvent.change(screen.getAllByRole("slider")[0], { target: { value: 0 } });
    expect(patch).toHaveBeenCalledTimes(1);

    resolvePatch({});
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    for (const s of screen.getAllByRole("slider")) expect(s).toBeEnabled();
  });

  it("shows a failed save in the panel, does not refresh and snaps the slider back", async () => {
    patch.mockRejectedValue(new Error("rescore failed"));
    const onRefresh = vi.fn();
    render(<DataQualityPanel cardType={makeType()} onRefresh={onRefresh} />);
    expect(screen.queryByText("Critical (3)")).toBeNull();

    fireEvent.change(lifecycleSlider(), { target: { value: 3 } });

    expect(await screen.findByRole("alert")).toHaveTextContent("rescore failed");
    expect(onRefresh).not.toHaveBeenCalled();
    // The slider is back on the stored weight (Normal) and usable again.
    await waitFor(() => expect(screen.queryByText("Critical (3)")).toBeNull());
    expect(lifecycleSlider()).toBeEnabled();

    // The next successful change clears the message.
    patch.mockResolvedValue({});
    fireEvent.change(lifecycleSlider(), { target: { value: 2 } });
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("writes a field weight into fields_schema", async () => {
    const onRefresh = vi.fn();
    render(<DataQualityPanel cardType={makeType()} onRefresh={onRefresh} />);
    fireEvent.change(screen.getAllByRole("slider")[5], { target: { value: 0 } });
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0][1]).toEqual({
      fields_schema: [
        { section: "Details", fields: [{ key: "vendor", label: "Vendor", type: "text", weight: 0 }] },
      ],
    });
  });
});
