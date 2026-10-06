/**
 * TurboLens shell, first paint of a tab: the tab bodies are lazy chunks, so
 * until the selected one has loaded the shell shows a spinner in its place.
 *
 * Kept in its own file because a lazy chunk is fetched once per module graph:
 * any earlier test that opened the same tab would have loaded it already.
 */
import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";

vi.mock("@/features/turbolens/TurboLensDashboard", () => ({
  default: () => <div>dashboard body</div>,
}));

import { renderWithProviders } from "@/test/render";
import TurboLensPage from "./TurboLensPage";

describe("TurboLensPage tab loading", () => {
  it("shows a spinner until the selected tab's chunk has loaded", async () => {
    renderWithProviders(<TurboLensPage />, { route: "/turbolens" });

    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText("dashboard body")).not.toBeInTheDocument();

    expect(await screen.findByText("dashboard body")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());
  });
});
