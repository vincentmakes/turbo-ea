import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const apiMock = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock("@/api/client", () => ({ api: apiMock, isAbortError: () => false }));

const enabledLocalesMock = vi.hoisted(() => ({ value: ["en", "de"] as string[] }));
vi.mock("@/hooks/useEnabledLocales", () => ({
  useEnabledLocales: () => ({ enabledLocales: enabledLocalesMock.value }),
}));

const invalidateMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useLifecyclePhaseHelp", () => ({
  invalidateLifecyclePhaseHelp: invalidateMock,
}));

import LifecyclePhaseHelpPanel from "./LifecyclePhaseHelpPanel";

const STORED = { active: { en: "In production use." } };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tabNames = () => screen.queryAllByRole("tab").map((tab) => tab.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  enabledLocalesMock.value = ["en", "de"];
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

  it("shows the intro, no load error and no saved notice on a clean load", async () => {
    render(<LifecyclePhaseHelpPanel />);
    await screen.findByDisplayValue("In production use.");
    expect(
      screen.getByText(/Explain what each lifecycle phase means in your organisation\./),
    ).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
    expect(screen.queryByText("Lifecycle phase help saved")).not.toBeInTheDocument();
  });

  it("offers English first, then only the enabled languages", async () => {
    enabledLocalesMock.value = ["fr", "de"];
    render(<LifecyclePhaseHelpPanel />);
    await screen.findByDisplayValue("In production use.");
    // English is always offered (even when not listed) and listed once.
    expect(tabNames()).toEqual(["English", "Deutsch", "Français"]);
  });

  it("lists English once when it is among the enabled languages", async () => {
    enabledLocalesMock.value = ["en", "de"];
    render(<LifecyclePhaseHelpPanel />);
    await screen.findByDisplayValue("In production use.");
    expect(tabNames()).toEqual(["English", "Deutsch"]);
  });

  it("follows a change of the enabled languages", async () => {
    const { rerender } = render(<LifecyclePhaseHelpPanel />);
    await screen.findByDisplayValue("In production use.");
    expect(tabNames()).toEqual(["English", "Deutsch"]);
    enabledLocalesMock.value = ["en", "de", "fr"];
    rerender(<LifecyclePhaseHelpPanel />);
    expect(tabNames()).toEqual(["English", "Deutsch", "Français"]);
  });

  it("shows no language tabs when English is the only language", async () => {
    enabledLocalesMock.value = ["en"];
    render(<LifecyclePhaseHelpPanel />);
    await screen.findByDisplayValue("In production use.");
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("edits English by default and writes only the active language", async () => {
    apiMock.get.mockResolvedValue({
      phases: { active: { en: "In production use.", de: "In Betrieb." } },
    });
    apiMock.patch.mockImplementation(async (_path: string, body: unknown) => body);
    const user = userEvent.setup();
    render(<LifecyclePhaseHelpPanel />);
    const active = await screen.findByDisplayValue("In production use.");
    // The English tab shows no English hint in its own fields.
    expect(active).not.toHaveAttribute("placeholder");
    expect(screen.getByLabelText("Help for Plan")).not.toHaveAttribute("placeholder");

    await user.type(active, " Now.");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1));
    expect(apiMock.patch.mock.calls[0][1]).toEqual({
      phases: { active: { en: "In production use. Now.", de: "In Betrieb." } },
    });
  });

  it("starts from an empty draft when the server sends no phases", async () => {
    apiMock.get.mockResolvedValue({});
    apiMock.patch.mockResolvedValue({ phases: {} });
    const user = userEvent.setup();
    render(<LifecyclePhaseHelpPanel />);
    const save = await screen.findByRole("button", { name: "Save" });
    await waitFor(() => expect(save).toBeEnabled());
    expect(screen.getByLabelText("Help for Active")).toHaveValue("");
    await user.click(save);
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1));
    expect(apiMock.patch.mock.calls[0][1]).toEqual({ phases: {} });
  });

  it("caps each text at 2000 characters", async () => {
    render(<LifecyclePhaseHelpPanel />);
    const field = await screen.findByDisplayValue("In production use.");
    expect(field).toHaveAttribute("maxlength", "2000");
    expect(field).toHaveAttribute("data-phase", "active");
  });

  it("shows a spinner and no fields while the help loads", async () => {
    const gate = deferred<{ phases: typeof STORED }>();
    apiMock.get.mockReturnValue(gate.promise);
    render(<LifecyclePhaseHelpPanel />);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByLabelText("Help for Active")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    await act(async () => {
      gate.resolve({ phases: STORED });
    });
    expect(await screen.findByDisplayValue("In production use.")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows a load error, keeps the fields and disables Save without data", async () => {
    apiMock.get.mockRejectedValue(new Error("down"));
    render(<LifecyclePhaseHelpPanel />);
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Help for Active")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("disables Save while saving and re-enables it afterwards", async () => {
    const gate = deferred<{ phases: typeof STORED }>();
    apiMock.patch.mockReturnValue(gate.promise);
    const user = userEvent.setup();
    render(<LifecyclePhaseHelpPanel />);
    await screen.findByDisplayValue("In production use.");
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    await user.click(save);
    expect(save).toBeDisabled();
    await act(async () => {
      gate.resolve({ phases: STORED });
    });
    await waitFor(() => expect(save).toBeEnabled());
  });

  it("re-enables Save after a failed save", async () => {
    apiMock.patch.mockRejectedValue(new Error("down"));
    const user = userEvent.setup();
    render(<LifecyclePhaseHelpPanel />);
    await screen.findByDisplayValue("In production use.");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Could not save the lifecycle phase help. Please try again.");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("shows what the server stored and clears an earlier error on the next save", async () => {
    apiMock.patch
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce({ phases: { active: { en: "Trimmed." } } });
    const user = userEvent.setup();
    render(<LifecyclePhaseHelpPanel />);
    await screen.findByDisplayValue("In production use.");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Could not save the lifecycle phase help. Please try again.");

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByDisplayValue("Trimmed.")).toBeInTheDocument();
    expect(
      screen.queryByText("Could not save the lifecycle phase help. Please try again."),
    ).not.toBeInTheDocument();
    expect(invalidateMock).toHaveBeenCalledWith({ active: { en: "Trimmed." } });
  });

  it("dismisses the saved notice", async () => {
    apiMock.patch.mockResolvedValue({ phases: STORED });
    const user = userEvent.setup();
    render(<LifecyclePhaseHelpPanel />);
    await screen.findByDisplayValue("In production use.");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Lifecycle phase help saved")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByText("Lifecycle phase help saved")).not.toBeInTheDocument(),
    );
  });
});
