/**
 * PpmHome — the loading state between picking a tab and its lazy body arriving.
 *
 * Kept apart from `PpmHome.test.tsx` on purpose: a lazy component suspends
 * only until its module has loaded once per test file, so the spinner can only
 * be seen by the first render of a fresh module graph.
 */
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";

vi.mock("@/features/ppm/PpmPortfolio", () => ({ default: () => <div data-testid="ppm-portfolio" /> }));
vi.mock("@/features/reports/EaDeliveryReport", () => ({
  default: () => <div data-testid="ea-delivery" />,
}));

import { renderWithProviders } from "@/test/render";
import PpmHome from "./PpmHome";

describe("PpmHome — lazy tab body", () => {
  it("shows a spinner until the tab body has loaded", async () => {
    renderWithProviders(<PpmHome />, { route: "/ppm", routes: [{ path: "/ppm" }] });
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(await screen.findByTestId("ppm-portfolio")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
