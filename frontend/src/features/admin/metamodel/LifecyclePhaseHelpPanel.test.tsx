import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const apiMock = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock("@/api/client", () => ({ api: apiMock }));

vi.mock("@/hooks/useEnabledLocales", () => ({
  useEnabledLocales: () => ({ enabledLocales: ["en", "de"] }),
}));

const invalidateMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useLifecyclePhaseHelp", () => ({
  invalidateLifecyclePhaseHelp: invalidateMock,
}));

import LifecyclePhaseHelpPanel from "./LifecyclePhaseHelpPanel";

const STORED = { active: { en: "In production use." } };

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ phases: STORED });
});

describe("LifecyclePhaseHelpPanel", () => {
  it("loads the stored help into one field per phase", async () => {
    render(<LifecyclePhaseHelpPanel />);
    expect(await screen.findByDisplayValue("In production use.")).toBeInTheDocument();
    expect(apiMock.get).toHaveBeenCalledWith(
      "/settings/lifecycle-phase-help",
      expect.anything(),
    );
    for (const phase of ["Plan", "Phase In", "Active", "Phase Out", "End of Life"]) {
      expect(screen.getByLabelText(`Help for ${phase}`)).toBeInTheDocument();
    }
  });

  it("saves edits in two languages and pushes the stored result to every card", async () => {
    const stored = {
      active: { en: "In production use." },
      phaseOut: { en: "Being replaced.", de: "Wird abgelöst." },
    };
    apiMock.patch.mockResolvedValue({ phases: stored });
    const user = userEvent.setup();
    render(<LifecyclePhaseHelpPanel />);
    await screen.findByDisplayValue("In production use.");

    await user.type(screen.getByLabelText("Help for Phase Out"), "Being replaced.");
    await user.click(screen.getByRole("tab", { name: "Deutsch" }));
    // The German field shows the English text only as a hint.
    const outDe = screen.getByLabelText("Help for Phase Out");
    expect(outDe).toHaveValue("");
    expect(outDe).toHaveAttribute("placeholder", "Being replaced.");
    await user.type(outDe, "Wird abgelöst.");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1));
    expect(apiMock.patch).toHaveBeenCalledWith("/settings/lifecycle-phase-help", {
      phases: {
        active: { en: "In production use." },
        phaseOut: { en: "Being replaced.", de: "Wird abgelöst." },
      },
    });
    expect(invalidateMock).toHaveBeenCalledWith(stored);
    expect(await screen.findByText("Lifecycle phase help saved")).toBeInTheDocument();
  });

  it("shows a failed save in the panel and does not push anything", async () => {
    apiMock.patch.mockRejectedValue(new Error("down"));
    const user = userEvent.setup();
    render(<LifecyclePhaseHelpPanel />);
    await screen.findByDisplayValue("In production use.");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("Could not save the lifecycle phase help. Please try again."),
    ).toBeInTheDocument();
    expect(invalidateMock).not.toHaveBeenCalled();
  });
});
