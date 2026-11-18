import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  apiErrorMessage: (e: unknown, f: string) => (e instanceof Error && e.message ? e.message : f),
}));

import { api } from "@/api/client";
import type { LicenseMetricItem, LicenseTypeItem } from "@/types";
import LicenseItemDialog from "./LicenseItemDialog";

const type = (metric: string, key: string, label: string, archived = false): LicenseTypeItem => ({
  id: `${metric}-${key}`,
  metric_key: metric,
  key,
  label,
  sort_order: 1,
  archived,
  translations: {},
});
const metricOf = (
  key: string,
  label: string,
  types: LicenseTypeItem[],
  archived = false,
): LicenseMetricItem => ({ id: key, key, label, sort_order: 1, archived, translations: {}, types });
const catalogue: LicenseMetricItem[] = [
  metricOf("users", "Users", [type("users", "prod", "Prod"), type("users", "old", "Old", true)]),
  metricOf("installations", "Installations", [type("installations", "dev", "Dev")]),
  metricOf("cores", "Cores", [type("cores", "x", "Xeon")], true),
];
const cell = { metric: "users", key: "prod", licensed: 100, actual: 80 as number | null };

function setup(over: Partial<React.ComponentProps<typeof LicenseItemDialog>> = {}) {
  const onChanged = vi.fn();
  const onClose = vi.fn();
  render(
    <LicenseItemDialog
      cardId="c1"
      fiscalYear={2026}
      forecastYear={2027}
      cell={cell}
      catalogue={catalogue}
      onClose={onClose}
      onChanged={onChanged}
      {...over}
    />,
  );
  return { onChanged, onClose, user: userEvent.setup() };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.put).mockResolvedValue({} as never);
  vi.mocked(api.post).mockResolvedValue({} as never);
  vi.mocked(api.delete).mockResolvedValue({} as never);
});

describe("LicenseItemDialog", () => {
  it("PUTs integers to the cell path", async () => {
    const { user, onChanged } = setup();
    expect(screen.getByLabelText("License type")).toHaveValue("Prod");
    const licensed = screen.getByLabelText("Licensed");
    await user.clear(licensed);
    await user.type(licensed, "150");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/cards/c1/licenses/2026/items/users/prod", {
        licensed: 150,
        actual: 80,
      }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("sends actual null when Actual is cleared", async () => {
    const { user } = setup();
    await user.clear(screen.getByLabelText("Actual"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/cards/c1/licenses/2026/items/users/prod", {
        licensed: 100,
        actual: null,
      }),
    );
  });

  it("refuses a fraction or a negative count", async () => {
    const { user } = setup();
    const licensed = screen.getByLabelText("Licensed");
    await user.clear(licensed);
    await user.type(licensed, "1.5");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.clear(licensed);
    await user.type(licensed, "-3");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("adds a cell by choosing a metric, then a type of that metric", async () => {
    const { user } = setup({ cell: null });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
    expect(screen.getByLabelText("License type")).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByLabelText("Metric"));
    // an archived metric cannot be added to
    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual([
      "Users",
      "Installations",
    ]);
    await user.click(screen.getByRole("option", { name: "Installations" }));
    await user.click(screen.getByLabelText("License type"));
    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual(["Dev"]);
    await user.click(screen.getByRole("option", { name: "Dev" }));
    await user.type(screen.getByLabelText("Licensed"), "7");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/cards/c1/licenses/2026/items/installations/dev", {
        licensed: 7,
        actual: null,
      }),
    );
  });

  it("offers only the non-archived types of the chosen metric", async () => {
    const { user } = setup({ cell: null });
    await user.click(screen.getByLabelText("Metric"));
    await user.click(await screen.findByRole("option", { name: "Users" }));
    await user.click(screen.getByLabelText("License type"));
    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual(["Prod"]);
  });

  it("forgets the type when the metric changes", async () => {
    const { user } = setup({ cell: null });
    await user.click(screen.getByLabelText("Metric"));
    await user.click(await screen.findByRole("option", { name: "Users" }));
    await user.click(screen.getByLabelText("License type"));
    await user.click(await screen.findByRole("option", { name: "Prod" }));
    await user.type(screen.getByLabelText("Licensed"), "7");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    await user.click(screen.getByLabelText("Metric"));
    await user.click(await screen.findByRole("option", { name: "Installations" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("edits an archived pair: shown by its labels, saved to its own path", async () => {
    const { user } = setup({ cell: { metric: "cores", key: "x", licensed: 4, actual: 1 } });
    expect(screen.getByLabelText("Metric")).toHaveValue("Cores");
    expect(screen.getByLabelText("License type")).toHaveValue("Xeon");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/cards/c1/licenses/2026/items/cores/x", {
        licensed: 4,
        actual: 1,
      }),
    );
  });

  it("shows the server error for archived_metric", async () => {
    const { user } = setup();
    vi.mocked(api.put).mockRejectedValueOnce(new Error("archived_metric"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("This license metric is archived and cannot be added to a year."),
    ).toBeInTheDocument();
  });

  it("copies licensed to the Forecast year when ticked", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("checkbox", { name: "Copy licensed to Forecast (FY27)" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/cards/c1/licenses/2026/items/users/prod/copy-to-forecast",
      ),
    );
  });

  it("hides copy-to-forecast in the Forecast year and disables Actual", () => {
    setup({ fiscalYear: 2027, cell: { ...cell, actual: null } });
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByLabelText("Actual")).toBeDisabled();
  });

  it("shows the server error for archived_type", async () => {
    const { user, onChanged } = setup();
    vi.mocked(api.put).mockRejectedValueOnce(new Error("archived_type"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("This license type is archived and cannot be added to a year."),
    ).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("keeps the dialog open and says so when the saved counts' copy fails", async () => {
    const { user, onChanged } = setup();
    vi.mocked(api.post).mockRejectedValueOnce(new Error("year_out_of_range"));
    await user.click(screen.getByRole("checkbox", { name: /Copy licensed to Forecast/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/The counts were saved\./)).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledWith({ keepOpen: true });
  });

  it("deletes the cell", async () => {
    const { user, onChanged } = setup();
    await user.click(screen.getByRole("button", { name: /Delete/ }));
    await waitFor(() =>
      expect(api.delete).toHaveBeenCalledWith("/cards/c1/licenses/2026/items/users/prod"),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});
