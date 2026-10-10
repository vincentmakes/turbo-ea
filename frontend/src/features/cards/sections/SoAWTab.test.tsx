/**
 * SoAWTab: an initiative's Statements of Architecture Work on its card. It
 * lists them, opens or previews one, and — for someone who may manage them —
 * creates and deletes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

interface CreateProps {
  open: boolean;
  onClose: () => void;
  onCreated: (s: { id: string }) => void;
  fixedInitiativeId?: string;
}
const createSeen: CreateProps[] = [];
vi.mock("@/features/ea-delivery/CreateSoAWDialog", () => ({
  default: (props: CreateProps) => {
    createSeen.push(props);
    return props.open ? (
      <div role="dialog" aria-label="create soaw">
        <button type="button" onClick={() => props.onCreated({ id: "new-soaw" })}>
          created
        </button>
        <button type="button" onClick={props.onClose}>
          close
        </button>
      </div>
    ) : null;
  },
}));

import { mockApi } from "@/test/apiMock";
import type { SoAW } from "@/types";
import SoAWTab from "./SoAWTab";

const INITIATIVE = "init-1";
const LIST = `/soaw?initiative_id=${INITIATIVE}`;

function soaw(id: string, over: Partial<SoAW> = {}): SoAW {
  return {
    id,
    name: `SoAW ${id}`,
    initiative_id: INITIATIVE,
    status: "draft",
    document_info: {} as SoAW["document_info"],
    version_history: [],
    sections: {},
    revision_number: 1,
    parent_id: null,
    signatories: [],
    signed_at: null,
    updated_at: "2026-03-04T10:00:00Z",
    ...over,
  };
}

function Where() {
  const { pathname } = useLocation();
  return <div data-testid="where">{pathname}</div>;
}

function renderTab(canManage = true) {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={["/cards/x"]}>
      <Routes>
        <Route
          path="/cards/x"
          element={<SoAWTab initiativeId={INITIATIVE} canManage={canManage} />}
        />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  return user;
}

let confirmSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mockApi.reset();
  createSeen.length = 0;
  confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  confirmSpy.mockRestore();
});

describe("SoAWTab", () => {
  it("says so when the initiative has none", async () => {
    mockApi.on("get", LIST, []);
    renderTab();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(
      await screen.findByText(
        "No SoAWs yet. Create one to capture the scope, approach and sign-off for this initiative.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Statements of Architecture Work")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("reloads for another initiative", async () => {
    mockApi.on("get", LIST, [soaw("a")]);
    mockApi.on("get", "/soaw?initiative_id=init-2", [soaw("z", { name: "Other plan" })]);
    const view = render(
      <MemoryRouter>
        <SoAWTab initiativeId={INITIATIVE} canManage={false} />
      </MemoryRouter>,
    );
    await screen.findByText("SoAW a");
    view.rerender(
      <MemoryRouter>
        <SoAWTab initiativeId="init-2" canManage={false} />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Other plan")).toBeInTheDocument();
  });

  it("lists each SoAW with its status, revision and date", async () => {
    mockApi.on("get", LIST, [
      soaw("a", { name: "Cloud move", status: "in_review", revision_number: 3 }),
      soaw("b", { name: "Data hub", status: "signed", updated_at: undefined }),
    ]);
    renderTab();
    const rows = await screen.findAllByRole("row");
    expect(rows).toHaveLength(3); // header + two
    expect(
      screen.getByText("Scope, approach and sign-off for this initiative"),
    ).toBeInTheDocument();
    expect(
      within(rows[0])
        .getAllByRole("columnheader")
        .map((c) => c.textContent),
    ).toEqual(["Title", "Status", "Revision", "Updated", "Actions"]);
    const first = within(rows[1]);
    expect(first.getByRole("link", { name: "Cloud move" })).toHaveAttribute(
      "href",
      "/ea-delivery/soaw/a",
    );
    expect(first.getByText("in review")).toBeInTheDocument();
    expect(first.getByText("r3")).toBeInTheDocument();
    expect(
      first.getByText(new Date("2026-03-04T10:00:00Z").toLocaleDateString()),
    ).toBeInTheDocument();
    const second = within(rows[2]);
    expect(second.getByText("signed")).toBeInTheDocument();
    expect(second.getByText("—")).toBeInTheDocument();
  });

  it("previews and opens a SoAW", async () => {
    mockApi.on("get", LIST, [soaw("a")]);
    const user = renderTab();
    await user.click(await screen.findByRole("button", { name: "Preview" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/ea-delivery/soaw/a/preview");
  });

  it("opens a SoAW in the editor", async () => {
    mockApi.on("get", LIST, [soaw("a")]);
    const user = renderTab();
    await user.click(await screen.findByRole("button", { name: "Open" }));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/ea-delivery\/soaw\/a$/);
  });

  it("offers create and delete only to someone who may manage them", async () => {
    mockApi.on("get", LIST, [soaw("a")]);
    renderTab(false);
    await screen.findByText("SoAW a");
    expect(screen.queryByRole("button", { name: /New SoAW/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("creates one for this initiative and opens it", async () => {
    mockApi.on("get", LIST, []);
    const user = renderTab();
    await screen.findByText(/No SoAWs yet/);
    expect(createSeen.at(-1)).toMatchObject({ open: false, fixedInitiativeId: INITIATIVE });
    await user.click(screen.getByRole("button", { name: /New SoAW/ }));
    expect(screen.getByRole("dialog", { name: "create soaw" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "close" }));
    expect(screen.queryByRole("dialog", { name: "create soaw" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /New SoAW/ }));
    await user.click(screen.getByRole("button", { name: "created" }));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/ea-delivery\/soaw\/new-soaw$/);
  });

  it("deletes after confirming and reloads the list", async () => {
    mockApi.on("get", LIST, [soaw("a")]);
    mockApi.on("delete", "/soaw/a", {});
    const user = renderTab();
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    expect(confirmSpy).toHaveBeenCalledWith("Delete this SoAW? This cannot be undone.");
    await waitFor(() => expect(mockApi.callsOf("delete", "/soaw/a")).toHaveLength(1));
    await waitFor(() => expect(mockApi.callsOf("get", LIST)).toHaveLength(2));
  });

  it("deletes nothing when the confirmation is declined", async () => {
    confirmSpy.mockReturnValue(false);
    mockApi.on("get", LIST, [soaw("a")]);
    const user = renderTab();
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    expect(mockApi.callsOf("delete")).toEqual([]);
  });

  it("shows a failed load and lets it be dismissed", async () => {
    mockApi.fail("get", LIST, 500);
    const user = renderTab();
    const alert = await screen.findByRole("alert");
    // the error's message, which the mock client builds from the request
    expect(alert).toHaveTextContent(`GET ${LIST} failed`);
    await user.click(within(alert).getByRole("button"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a failed delete", async () => {
    mockApi.on("get", LIST, [soaw("a")]);
    mockApi.fail("delete", "/soaw/a", 403);
    const user = renderTab();
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("DELETE /soaw/a failed");
    expect(screen.getByText("SoAW a")).toBeInTheDocument();
  });
});
