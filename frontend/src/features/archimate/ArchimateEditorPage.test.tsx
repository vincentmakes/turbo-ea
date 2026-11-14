import { useRef } from "react";
import { screen } from "@testing-library/react";
import { useLocation, useNavigate } from "react-router";
import { renderWithProviders, userWith } from "@/test/render";
import type { User } from "@/types";
import ArchimateEditorPage from "./ArchimateEditorPage";

// The editor itself is covered by ArchimateModeler.test.tsx; here only the page's wiring is asserted.
const mounts = vi.hoisted(() => ({ count: 0 }));
vi.mock("./ArchimateModeler", () => {
  function FakeModeler({ diagramId, onBack }: { diagramId: string; onBack?: () => void }) {
    const instance = useRef<number | null>(null);
    if (instance.current === null) instance.current = ++mounts.count;
    return (
      <div>
        <span>modeler:{diagramId}</span>
        <span>instance:{instance.current}</span>
        <button onClick={onBack}>back</button>
      </div>
    );
  }
  return { default: FakeModeler };
});

function Where() {
  const nav = useNavigate();
  return (
    <>
      <span>at:{useLocation().pathname}</span>
      <button onClick={() => nav("/admin/architectureStudio/d2")}>go-d2</button>
      <button onClick={() => nav("/admin/architectureStudio/d2", { replace: true })}>
        replace-d2
      </button>
    </>
  );
}

function renderPage(opts: { route?: string; user?: User } = {}) {
  return renderWithProviders(
    <>
      <ArchimateEditorPage />
      <Where />
    </>,
    {
      route: opts.route ?? "/admin/architectureStudio/d1",
      user: opts.user,
      routes: [
        { path: "/admin/architectureStudio/:id" },
        { path: "/admin/architectureStudio", element: <Where /> },
        { path: "/diagrams", element: <Where /> },
        { path: "/prior", element: <Where /> },
      ],
    },
  );
}

beforeEach(() => {
  mounts.count = 0;
});

// MemoryRouter never touches window.history, so `idx` (what react-router's browser history stores)
// is driven only by these replaceState calls.
afterEach(() => window.history.replaceState(null, ""));

describe("ArchimateEditorPage", () => {
  it("renders the editor for the route's diagram", () => {
    renderPage();
    expect(screen.getByText("modeler:d1")).toBeInTheDocument();
  });

  it("goes back to the previous page when the app navigated here", async () => {
    window.history.replaceState({ idx: 1 }, "");
    const { user } = renderPage({ route: "/prior" });
    await user.click(screen.getByRole("button", { name: "go-d2" }));
    await user.click(screen.getByRole("button", { name: "back" }));
    expect(screen.getByText("at:/prior")).toBeInTheDocument();
  });

  it("falls back to /diagrams on a deep link", async () => {
    window.history.replaceState({ idx: 0 }, "");
    const { user } = renderPage();
    await user.click(screen.getByRole("button", { name: "back" }));
    expect(screen.getByText("at:/diagrams")).toBeInTheDocument();
  });

  it('falls back to /diagrams when the entry key is not "default" but idx is 0', async () => {
    window.history.replaceState({ idx: 0 }, "");
    const { user } = renderPage({ route: "/prior" });
    await user.click(screen.getByRole("button", { name: "replace-d2" }));
    await user.click(screen.getByRole("button", { name: "back" }));
    expect(screen.getByText("at:/diagrams")).toBeInTheDocument();
  });

  it("falls back to /diagrams while the unsaved-changes sentinel is on the stack", async () => {
    window.history.replaceState(null, "");
    const { user } = renderPage({ route: "/prior" });
    await user.click(screen.getByRole("button", { name: "go-d2" }));
    await user.click(screen.getByRole("button", { name: "back" }));
    expect(screen.getByText("at:/diagrams")).toBeInTheDocument();
  });

  it("falls back to the studio list for a role without diagrams.view", async () => {
    window.history.replaceState({ idx: 0 }, "");
    const { user } = renderPage({ user: userWith("archimatediagrams.business.manage") });
    await user.click(screen.getByRole("button", { name: "back" }));
    expect(screen.getByText("at:/admin/architectureStudio")).toBeInTheDocument();
  });

  it("rebuilds the editor when the URL moves to another diagram", async () => {
    const { user } = renderPage();
    expect(screen.getByText("instance:1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "go-d2" }));
    expect(screen.getByText("modeler:d2")).toBeInTheDocument();
    expect(screen.getByText("instance:2")).toBeInTheDocument();
  });
});
