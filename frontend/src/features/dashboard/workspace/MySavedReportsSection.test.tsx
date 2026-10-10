/**
 * MySavedReportsSection: the user's saved reports as a grid of thumbnails, six
 * at most. A core report opens its report page; an extension report opens the
 * extension's route once that extension has registered; anything else is shown
 * but cannot be opened.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import { useLocation } from "react-router";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import { registerExtension, resetExtensionHost, UI_SDK_VERSION } from "@/lib/extensionHost";
import type { SavedReport } from "@/types";
import MySavedReportsSection from "./MySavedReportsSection";

const MINE = "/saved-reports?filter=my";

const report = (id: string, report_type: string, over: Partial<SavedReport> = {}): SavedReport => ({
  id,
  owner_id: "u1",
  name: `Report ${id}`,
  report_type,
  config: {},
  visibility: "private",
  shared_with: [],
  is_owner: true,
  ...over,
});

function registerRules() {
  registerExtension("rules", {
    key: "rules",
    sdkVersion: UI_SDK_VERSION,
    routes: [
      {
        id: "other",
        path: "/ext/rules/other",
        label: "Other",
        icon: "list",
        component: () => null,
      },
      {
        id: "board",
        path: "/ext/rules/board",
        label: "Board",
        icon: "rule",
        component: () => null,
      },
    ],
  });
}

function Where() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{pathname + search}</div>;
}

function renderSection() {
  return renderWithProviders(<MySavedReportsSection />, {
    routes: [{ path: "/" }, { path: "*", element: <Where /> }],
  });
}

/** The clickable tile around a report's name. */
const tileOf = async (name: string) =>
  (await screen.findByText(name)).parentElement!.parentElement as HTMLElement;

beforeEach(() => {
  mockApi.reset();
  resetExtensionHost();
});

afterEach(() => {
  resetExtensionHost();
});

describe("MySavedReportsSection", () => {
  it("loads the user's reports, showing progress until they arrive", async () => {
    mockApi.on("get", MINE, [report("a", "cost")]);
    renderSection();
    expect(screen.getByText("My Saved Reports")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(await screen.findByText("Report a")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(mockApi.callsOf("get", MINE)).toHaveLength(1);
  });

  it("lists six reports at most", async () => {
    mockApi.on(
      "get",
      MINE,
      Array.from({ length: 8 }, (_, i) => report(`r${i}`, "cost")),
    );
    renderSection();
    expect(await screen.findByText("Report r5")).toBeInTheDocument();
    expect(screen.queryByText("Report r6")).not.toBeInTheDocument();
  });

  it("says so when there are none", async () => {
    mockApi.on("get", MINE, []);
    renderSection();
    expect(await screen.findByText("You haven't saved any reports yet.")).toBeInTheDocument();
  });

  it("shows the empty state when the load fails", async () => {
    mockApi.fail("get", MINE, 500);
    renderSection();
    expect(await screen.findByText("You haven't saved any reports yet.")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("links to every saved report", async () => {
    mockApi.on("get", MINE, []);
    renderSection();
    expect(screen.getByRole("link", { name: "View all →" })).toHaveAttribute(
      "href",
      "/reports/saved",
    );
    await screen.findByText("You haven't saved any reports yet.");
  });

  it("shows the thumbnail when there is one, else the report type's icon", async () => {
    mockApi.on("get", MINE, [
      report("a", "cost", { thumbnail: "data:image/png;base64,AAAA" }),
      report("b", "lifecycle"),
      report("c", "mystery"),
    ]);
    renderSection();
    expect(await screen.findByRole("img", { name: "Report a" })).toHaveAttribute(
      "src",
      "data:image/png;base64,AAAA",
    );
    expect((await tileOf("Report b")).textContent).toBe("timelineReport b");
    expect((await tileOf("Report c")).textContent).toBe("analyticsReport c");
  });

  it("opens a core report on its page", async () => {
    mockApi.on("get", MINE, [report("a", "capability-map")]);
    const { user } = renderSection();
    expect(await tileOf("Report a")).toHaveStyle({ cursor: "pointer" });
    await user.click(screen.getByText("Report a"));
    expect(screen.getByTestId("where")).toHaveTextContent(
      "/reports/capability-map?saved_report_id=a",
    );
  });

  it("opens an extension report on the extension's route, with its icon", async () => {
    registerRules();
    mockApi.on("get", MINE, [report("a", "ext:rules:board")]);
    const { user } = renderSection();
    expect((await tileOf("Report a")).textContent).toBe("ruleReport a");
    await user.click(screen.getByText("Report a"));
    expect(screen.getByTestId("where")).toHaveTextContent("/ext/rules/board?saved_report_id=a");
  });

  it("resolves an extension report once the extension registers", async () => {
    mockApi.on("get", MINE, [report("a", "ext:rules:board")]);
    renderSection();
    expect((await tileOf("Report a")).textContent).toBe("analyticsReport a");
    act(() => registerRules());
    expect((await tileOf("Report a")).textContent).toBe("ruleReport a");
  });

  it.each([
    ["an unknown type", "mystery"],
    ["an extension that is not installed", "ext:gone:board"],
    ["a route the extension does not have", "ext:rules:missing"],
    ["a route of another extension", "ext:other:board"],
    ["a type that only looks like an extension's", "app:rules:board"],
  ])("cannot open %s", async (_label, type) => {
    registerRules();
    mockApi.on("get", MINE, [report("a", type)]);
    const { user } = renderSection();
    const tile = await tileOf("Report a");
    expect(tile).toHaveStyle({ cursor: "default" });
    expect(tile.textContent).toBe("analyticsReport a");
    await user.click(screen.getByText("Report a"));
    expect(screen.queryByTestId("where")).not.toBeInTheDocument();
  });

  it("names the report on hover", async () => {
    mockApi.on("get", MINE, [report("a", "cost")]);
    const { user } = renderSection();
    await user.hover(await tileOf("Report a"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Report a");
  });
});
