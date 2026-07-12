import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import NavbarStyleCard from "./NavbarStyleCard";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), patch: vi.fn() },
}));

import { api } from "@/api/client";

function mockGet(navbar: { navbar_bg: string; navbar_fg: string }) {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === "/settings/navbar-style") return Promise.resolve(navbar);
    if (url === "/settings/app-title") return Promise.resolve({ app_title: "Turbo EA" });
    return Promise.resolve({});
  });
}

describe("NavbarStyleCard", () => {
  const onSaved = vi.fn();
  const onError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders 7 preset tiles plus a Custom tile", async () => {
    mockGet({ navbar_bg: "#1a1a2e", navbar_fg: "#ffffff" });
    render(<NavbarStyleCard onSaved={onSaved} onError={onError} />);

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith("/settings/navbar-style"),
    );
    expect(screen.getAllByRole("radio")).toHaveLength(8);
    expect(screen.getByRole("radio", { name: "Navy (default)" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Custom" })).toBeInTheDocument();
  });

  it("selects the preset matching the stored style", async () => {
    mockGet({ navbar_bg: "#1b5e20", navbar_fg: "#ffffff" });
    render(<NavbarStyleCard onSaved={onSaved} onError={onError} />);

    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "Forest" })).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );
    expect(screen.getByRole("radio", { name: "Custom" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("marks Custom as selected when the stored style matches no preset", async () => {
    mockGet({ navbar_bg: "#123456", navbar_fg: "#ffffff" });
    render(<NavbarStyleCard onSaved={onSaved} onError={onError} />);

    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "Custom" })).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );
  });

  it("renders a live preview strip", async () => {
    mockGet({ navbar_bg: "#1a1a2e", navbar_fg: "#ffffff" });
    render(<NavbarStyleCard onSaved={onSaved} onError={onError} />);

    await waitFor(() =>
      expect(screen.getByTestId("navbar-style-preview")).toBeInTheDocument(),
    );
    // Sample nav items rendered inside the preview
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Inventory")).toBeInTheDocument();
    expect(screen.getByText("Reports")).toBeInTheDocument();
  });

  it("reveals two color pickers in custom mode", async () => {
    mockGet({ navbar_bg: "#1a1a2e", navbar_fg: "#ffffff" });
    render(<NavbarStyleCard onSaved={onSaved} onError={onError} />);
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith("/settings/navbar-style"),
    );

    expect(screen.queryByText("Background")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
    expect(screen.getByText("Background")).toBeInTheDocument();
    expect(screen.getByText("Text")).toBeInTheDocument();
  });

  it("shows a contrast warning for a low-contrast pair", async () => {
    mockGet({ navbar_bg: "#ffffff", navbar_fg: "#fffff0" });
    render(<NavbarStyleCard onSaved={onSaved} onError={onError} />);

    await waitFor(() =>
      expect(
        screen.getByText(/Low contrast between text and background/),
      ).toBeInTheDocument(),
    );
  });

  it("does not warn for the default navy/white pair", async () => {
    mockGet({ navbar_bg: "#1a1a2e", navbar_fg: "#ffffff" });
    render(<NavbarStyleCard onSaved={onSaved} onError={onError} />);
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith("/settings/navbar-style"),
    );

    expect(
      screen.queryByText(/Low contrast between text and background/),
    ).not.toBeInTheDocument();
  });

  it("saves the selected preset and reports success", async () => {
    mockGet({ navbar_bg: "#1a1a2e", navbar_fg: "#ffffff" });
    vi.mocked(api.patch).mockResolvedValue({
      navbar_bg: "#1b5e20",
      navbar_fg: "#ffffff",
    });
    render(<NavbarStyleCard onSaved={onSaved} onError={onError} />);
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith("/settings/navbar-style"),
    );

    fireEvent.click(screen.getByRole("radio", { name: "Forest" }));
    fireEvent.click(screen.getByRole("button", { name: /Save$/ }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/settings/navbar-style", {
        navbar_bg: "#1b5e20",
        navbar_fg: "#ffffff",
      }),
    );
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith("Navigation bar style updated"),
    );
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports an error when saving fails", async () => {
    mockGet({ navbar_bg: "#1a1a2e", navbar_fg: "#ffffff" });
    vi.mocked(api.patch).mockRejectedValue(new Error("boom"));
    render(<NavbarStyleCard onSaved={onSaved} onError={onError} />);
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith("/settings/navbar-style"),
    );

    fireEvent.click(screen.getByRole("button", { name: /Save$/ }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith("boom"));
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("reset-to-default applies the navy preset locally", async () => {
    mockGet({ navbar_bg: "#4a148c", navbar_fg: "#ffffff" });
    render(<NavbarStyleCard onSaved={onSaved} onError={onError} />);
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "Plum" })).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
    expect(screen.getByRole("radio", { name: "Navy (default)" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // Not saved yet
    expect(api.patch).not.toHaveBeenCalled();
  });
});
