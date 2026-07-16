import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUnsavedChangesGuard } from "./useUnsavedChangesGuard";

function Probe({ dirty }: { dirty: boolean }) {
  const navigate = useNavigate();
  const loc = useLocation();
  useUnsavedChangesGuard(dirty, "leave?");
  return (
    <>
      <div data-testid="path">{loc.pathname}</div>
      {/* Mirrors RelationsSection: programmatic navigate(), not an <a href>. */}
      <button type="button" onClick={() => navigate("/other")}>
        go
      </button>
    </>
  );
}

function renderProbe(dirty: boolean) {
  return render(
    <MemoryRouter initialEntries={["/start"]}>
      <Probe dirty={dirty} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useUnsavedChangesGuard blocks in-app navigation", () => {
  it("cancels a programmatic navigate() when dirty and the user declines", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderProbe(true);
    expect(screen.getByTestId("path")).toHaveTextContent("/start");

    fireEvent.click(screen.getByText("go"));

    expect(confirm).toHaveBeenCalledWith("leave?");
    // Navigation blocked — still on the original route.
    expect(screen.getByTestId("path")).toHaveTextContent("/start");
  });

  it("allows a programmatic navigate() when dirty and the user confirms", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderProbe(true);

    fireEvent.click(screen.getByText("go"));

    expect(screen.getByTestId("path")).toHaveTextContent("/other");
  });

  it("does not prompt when there are no unsaved changes", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderProbe(false);

    fireEvent.click(screen.getByText("go"));

    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByTestId("path")).toHaveTextContent("/other");
  });
});
