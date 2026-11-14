import { MemoryRouter, useLocation, useNavigate } from "react-router";
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

function PathOnlyProbe({ dirty, pathOnly }: { dirty: boolean; pathOnly?: boolean }) {
  const navigate = useNavigate();
  const loc = useLocation();
  useUnsavedChangesGuard(dirty, "leave?", pathOnly === undefined ? undefined : { pathOnly });
  return (
    <>
      <div data-testid="where">{loc.pathname + loc.search}</div>
      {/* The Inventory's setSearchParams: a same-path replace. */}
      <button type="button" onClick={() => navigate("?q=1", { replace: true })}>
        filter
      </button>
      <button type="button" onClick={() => navigate({ search: "?q=2" })}>
        filter-object
      </button>
      <button type="button" onClick={() => navigate("/start#top")}>
        same-path-hash
      </button>
      <button type="button" onClick={() => navigate("/other?q=1")}>
        leave
      </button>
      <button type="button" onClick={() => navigate({ pathname: "/other" }, { replace: true })}>
        leave-object
      </button>
    </>
  );
}

function renderPathOnly(dirty: boolean, pathOnly?: boolean) {
  return render(
    <MemoryRouter initialEntries={["/start"]}>
      <PathOnlyProbe dirty={dirty} pathOnly={pathOnly} />
    </MemoryRouter>,
  );
}

describe("useUnsavedChangesGuard — pathOnly", () => {
  it("lets a same-path query-string change through without asking", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPathOnly(true, true);

    fireEvent.click(screen.getByText("filter"));
    expect(screen.getByTestId("where")).toHaveTextContent("/start?q=1");
    fireEvent.click(screen.getByText("filter-object"));
    expect(screen.getByTestId("where")).toHaveTextContent("/start?q=2");
    fireEvent.click(screen.getByText("same-path-hash"));

    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/start$/);
  });

  it("still asks before a change of path, and stays when the user declines", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPathOnly(true, true);

    fireEvent.click(screen.getByText("leave"));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith("leave?");
    fireEvent.click(screen.getByText("leave-object"));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/start$/);
  });

  it("leaves for another path when the user confirms", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPathOnly(true, true);

    fireEvent.click(screen.getByText("leave"));

    expect(screen.getByTestId("where")).toHaveTextContent("/other?q=1");
  });

  it("asks nothing for a change of path when nothing is unsaved", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPathOnly(false, true);

    fireEvent.click(screen.getByText("leave"));

    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByTestId("where")).toHaveTextContent("/other?q=1");
  });

  it.each([
    ["without options", undefined],
    ["with pathOnly: false", false],
  ])("asks for a same-path query change too %s (the full card page)", (_label, pathOnly) => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPathOnly(true, pathOnly);

    fireEvent.click(screen.getByText("filter"));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/start$/);

    fireEvent.click(screen.getByText("leave"));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/start$/);
  });
});

describe("useUnsavedChangesGuard — back / forward sentinel", () => {
  it("arms a history sentinel by default while dirty", () => {
    const push = vi.spyOn(window.history, "pushState");
    renderPathOnly(true);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("arms no sentinel with pathOnly, so same-path query writes leave history alone", () => {
    const push = vi.spyOn(window.history, "pushState");
    const back = vi.spyOn(window.history, "back");
    const view = renderPathOnly(true, true);
    expect(push).not.toHaveBeenCalled();
    view.unmount();
    expect(back).not.toHaveBeenCalled();
  });
});

describe("useUnsavedChangesGuard — reload / tab close", () => {
  it.each([undefined, true])("asks before unload while dirty (pathOnly: %s)", (pathOnly) => {
    renderPathOnly(true, pathOnly);
    const ev = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("lets the page unload when nothing is unsaved", () => {
    renderPathOnly(false, true);
    const ev = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});
