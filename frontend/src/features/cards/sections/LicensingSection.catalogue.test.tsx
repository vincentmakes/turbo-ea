import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
  apiErrorMessage: (e: unknown, f: string) => (e instanceof Error && e.message ? e.message : f),
  isAbortError: () => false,
}));
vi.mock("@/components/charts/EChart", () => import("@/test/echartMock").then((m) => m.echartModule()));
vi.mock("@/hooks/useLicenseCatalogue", () => ({ useLicenseCatalogue: vi.fn() }));

import { api } from "@/api/client";
import { useLicenseCatalogue } from "@/hooks/useLicenseCatalogue";
import { installResizeObserver } from "@/test/dom";
import { echartState } from "@/test/echartMock";
import type { CardLicensesResponse } from "@/types";
import LicensingSection from "./LicensingSection";

const response: CardLicensesResponse = {
  can_edit: true,
  years: [2022, 2023, 2024, 2025, 2026, 2027].map((fy) => ({
    fiscal_year: fy,
    is_current: fy === 2026,
    is_forecast: fy === 2027,
    confirmed: true,
    fallback_from: null,
    status: fy === 2027 ? null : "compliant",
    metrics: [
      {
        metric: "users",
        types: [{ key: "prod", licensed: 10, actual: 5, pct: 50, no_licence: false, status: "compliant" }],
        has_actual: true,
        status: "compliant",
        worst_pct: 50,
        worst_no_licence: false,
        licensed_total: 10,
        actual_total: 5,
      },
    ],
  })),
};

const hook = (over: Partial<ReturnType<typeof useLicenseCatalogue>>) =>
  vi.mocked(useLicenseCatalogue).mockReturnValue({
    metrics: [],
    loading: false,
    failed: false,
    reload: vi.fn(),
    ...over,
  });

beforeEach(() => {
  installResizeObserver();
  echartState.reset();
  vi.mocked(api.get).mockResolvedValue(response as never);
});

describe("LicensingSection while the catalogue is not there", () => {
  it("draws nothing, never a bar labelled with a raw key, while the catalogue loads", async () => {
    hook({ loading: true });
    const { container } = render(<LicensingSection cardId="c1" />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
    expect(echartState.props).toHaveLength(0);
  });

  it("says the licenses could not be loaded when the catalogue failed", async () => {
    hook({ failed: true });
    render(<LicensingSection cardId="c1" />);
    expect(await screen.findByText("Could not load the licenses of this card.")).toBeInTheDocument();
    expect(echartState.props).toHaveLength(0);
  });
});
